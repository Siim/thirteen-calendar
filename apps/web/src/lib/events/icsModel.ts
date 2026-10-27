/**
 * The web's event model on iCalendar documents (docs/EVENTS.md §3.3, §3.6,
 * §4.4, §4.7, §4.9): what a stored UID group means as core's
 * `CalendarEvent`, its occurrences as the views need them, and every change
 * of §4.7 applied to one UID group of a parsed document.
 *
 * Pure functions on `IcsCalendar`s from `@thirteen/core/ics`. Every change
 * returns new calendars; the store serializes them (`serializeICalendar`
 * copies every untouched group, kept component and `VTIMEZONE` byte for byte,
 * and writes the properties of untouched fields of an edited group as read).
 *
 * Rules kept here:
 * - only the changed field groups are written (`mergeDraft`, §4.9 rule 1);
 * - an unchanged recurrence keeps its property lines (rule 2); a rule whose
 *   only change is its end keeps its text with a new `COUNT=` or `UNTIL=`
 *   (rule 4); `EXDATE`s added to those read go after them;
 * - a new start time, zone or all-day setting of a series retimes every
 *   `RECURRENCE-ID`, `EXDATE` and `RDATE` and the `UNTIL` of every rule
 *   (`retimeExceptions`, `withRetimedUntils`), it never re-encodes (rule 4);
 * - an edited event keeps its `TZID` string when its zone did not change
 *   (`FLE Standard Time` stays `FLE Standard Time`);
 * - every user change adds one to `SEQUENCE` and sets `LAST-MODIFIED`.
 */

import {
  type Alarm,
  type Availability,
  type CalendarEvent,
  type CalendarSystemId,
  type DraftField,
  type DraftIssue,
  type EventDraft,
  type EventRecurrence,
  type EventStatus,
  type ExtraDate,
  type GregorianDate,
  type LocalDateTime,
  type OriginalDate,
  type Recognition,
  type RepeatEnd,
  type RRule,
  type ThirteenRule,
  type ZoneResolver,
  DEFAULT_SYSTEM_ID,
  addGregorianDays,
  addMinutesLocal,
  applyToSeries,
  changedFields,
  compareGregorian,
  compareLocalDateTime,
  diffGregorianDays,
  diffMinutesLocal,
  encodeThirteenRule,
  endRecurrenceBefore,
  expandRecurrence,
  formatThirteenRuleText,
  gregorianEquals,
  mergeDraft,
  normalizeEventEnd,
  recognizeRecurrence,
  recurrenceToRRule,
  retimeExceptions,
  rruleEquals,
  splitRecurrence,
  utcToZoned,
  validateDraft,
  zonedToUtc,
} from '@thirteen/core';
import {
  type IcsAlarm,
  type IcsCalendar,
  type IcsDateValue,
  type IcsEvent,
  type IcsExpandedEvent,
  type IcsGroup,
  type IcsProperty,
  type IcsRdate,
  allDayEnd,
  expandCalendar,
  icsRecognitionInput,
  mergeTimeZones,
  removeGroup,
  replaceGroup,
  resolveTzid,
  untilFor,
  withRetimedUntils,
} from '@thirteen/core/ics';
import {
  type DeleteRequest,
  EventStoreError,
  type ResolvedOccurrence,
  type SaveRequest,
  type StoreCalendar,
  type StoreOccurrence,
  type WriteResult,
  occurrenceKey,
  parseOccurrenceKey,
} from '@thirteen/ui/headless';

const DAY = 1440;
const FIRST_EDITABLE: GregorianDate = { year: 1583, month: 1, day: 1 };
const LAST_END: LocalDateTime = { date: { year: 9999, month: 12, day: 31 }, minute: DAY };

export interface ModelContext {
  /** The platform's zone data (Intl). */
  readonly zones: ZoneResolver;
  /** The device's IANA zone: occurrences are in its wall clock. */
  readonly deviceZone: string;
  readonly systemId?: CalendarSystemId;
}

export interface WriteContext extends ModelContext {
  /** The time of the change, a UTC wall clock (`LAST-MODIFIED`, `DTSTAMP` and `CREATED` of new events). */
  readonly now: LocalDateTime;
  /** A new UID (lowercase UUID v4, §3.2). */
  readonly newUid: () => string;
}

/** What the model needs to know about a calendar besides its document. */
export interface CalendarMeta {
  readonly id: string;
  readonly kind: 'local' | 'subscription';
  readonly writable: boolean;
  readonly title: string;
}

// ---------------------------------------------------------------------------
// Zones of one document
// ---------------------------------------------------------------------------

/**
 * The zones a document's values use: an IANA id (Intl), the IANA id a
 * Windows id maps to, `UTC`, or a zone only the document's own `VTIMEZONE`
 * defines (named by its `TZID`). One resolver answers for all of them, so
 * core's `zonedToUtc` and `utcToZoned` convert between any two.
 */
export class DocumentZones {
  readonly resolver: ZoneResolver;
  private readonly own = new Map<string, ZoneResolver>();
  private readonly handles = new Map<string, string | null>();

  constructor(
    readonly calendar: IcsCalendar,
    readonly zones: ZoneResolver,
  ) {
    const own = this.own;
    this.resolver = {
      isKnown: (name) => own.has(name) || safeKnown(zones, name),
      offsetMinutesAt: (name, utc) => (own.get(name) ?? zones).offsetMinutesAt(name, utc),
    };
  }

  /** The zone of a `TZID`: IANA id, the mapped Windows id, the `TZID` of a file-defined zone, or null (unknown: floating). */
  zoneOfTzid(tzid: string): string | null {
    if (this.handles.has(tzid)) return this.handles.get(tzid)!;
    const handle = resolveTzid(tzid, this.calendar, this.zones);
    let zone: string | null = null;
    if (handle.kind === 'iana' || handle.kind === 'windows') zone = handle.zone;
    else if (handle.kind === 'vtimezone' && handle.resolver !== null) {
      zone = handle.tzid;
      this.own.set(handle.tzid, handle.resolver);
    }
    this.handles.set(tzid, zone);
    return zone;
  }

  /** The zone a value is in; null for dates, floating values and unknown `TZID`s. */
  zoneOf(value: IcsDateValue): string | null {
    if (value.kind === 'utc') return 'UTC';
    if (value.kind !== 'zoned') return null;
    return this.zoneOfTzid(value.tzid);
  }

  /** A value as a wall clock in `zone` (null: floating, kept as written). null when it leaves years 1 to 9999. */
  inZone(value: IcsDateValue, zone: string | null): LocalDateTime | null {
    if (value.kind === 'date') return { date: value.date, minute: 0 };
    const own = this.zoneOf(value);
    if (own === null || zone === null || own === zone) return value.value;
    const utc = zonedToUtc(value.value, own, this.resolver);
    return utc === null ? null : utcToZoned(utc, zone, this.resolver);
  }

  /** A value as a UTC wall clock; floating values and dates through `floatingZone` (the device's). */
  toUtc(value: IcsDateValue, floatingZone: string): LocalDateTime | null {
    if (value.kind === 'utc') return value.value;
    const local = value.kind === 'date' ? { date: value.date, minute: 0 } : value.value;
    const zone = this.zoneOf(value) ?? floatingZone;
    return zonedToUtc(local, zone, this.resolver);
  }
}

function safeKnown(zones: ZoneResolver, name: string): boolean {
  try {
    return zones.isKnown(name) === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

interface Duration {
  readonly negative: boolean;
  readonly days: number;
  readonly seconds: number;
}

/** An RFC 5545 duration (`P1D`, `PT1H30M`, `-PT15M`, `P2W`), or null. */
export function parseIcsDuration(text: string): Duration | null {
  const t = text.trim().toUpperCase();
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(t);
  if (m === null || /P$|T$/.test(t)) return null;
  const n = (s: string | undefined) => (s === undefined ? 0 : Number(s));
  return { negative: m[1] === '-', days: n(m[2]) * 7 + n(m[3]), seconds: n(m[4]) * 3600 + n(m[5]) * 60 + n(m[6]) };
}

/** `PT1H30M`, `PT0M`, `P1DT2H`. */
function formatMinutesDuration(total: number): string {
  const days = Math.floor(total / DAY);
  const hours = Math.floor((total % DAY) / 60);
  const minutes = total % 60;
  let text = 'P';
  if (days > 0) text += `${days}D`;
  if (hours > 0 || minutes > 0 || days === 0) {
    text += 'T';
    if (hours > 0) text += `${hours}H`;
    if (minutes > 0 || hours === 0) text += `${minutes}M`;
  }
  return text;
}

/** iCalendar TEXT escaping (RFC 5545 §3.3.11), for property values written as `IcsProperty`. */
function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

const utcValue = (value: LocalDateTime): IcsDateValue => ({ kind: 'utc', value });

const clampDay = (date: GregorianDate, delta: number): GregorianDate => {
  try {
    return addGregorianDays(date, delta);
  } catch {
    return date;
  }
};

/** The last day an all-day end (end-of-day form) covers. */
function lastDayOf(start: LocalDateTime, end: LocalDateTime): GregorianDate {
  if (end.minute === 0 && compareGregorian(end.date, start.date) > 0) return addGregorianDays(end.date, -1);
  return end.date;
}

/** A value in the form of `form` (a date, floating, UTC, or the same `TZID`) at `date` and `minute`. */
function valueLike(form: IcsDateValue, date: GregorianDate, minute: number): IcsDateValue {
  const value: LocalDateTime = { date, minute };
  switch (form.kind) {
    case 'date':
      return { kind: 'date', date };
    case 'floating':
      return { kind: 'floating', value };
    case 'utc':
      return { kind: 'utc', value };
    case 'zoned':
      return { kind: 'zoned', value, tzid: form.tzid };
  }
}

const startMinuteOf = (event: IcsEvent): number => (event.start.kind === 'date' ? 0 : event.start.value.minute);

const sameOriginal = (a: { date: GregorianDate; minute: number | null }, b: { date: GregorianDate; minute: number | null }) =>
  gregorianEquals(a.date, b.date) && a.minute === b.minute;

/** The date a stored start names in its own zone (a `DATE`, or the wall clock as written). */
const startDateOf = (event: IcsEvent): GregorianDate => (event.start.kind === 'date' ? event.start.date : event.start.value.date);

/** Same kind of start, same `TZID`, same time of day: an `UNTIL` written for one means the same last occurrence for the other. */
function sameStartForm(a: IcsDateValue, b: IcsDateValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'date' || b.kind === 'date') return true;
  if (a.kind === 'zoned' && b.kind === 'zoned' && a.tzid !== b.tzid) return false;
  return a.value.minute === b.value.minute;
}

/**
 * Whether a 13-month rule has the same `RRULE` encoding from both starts
 * (§4.9 rule 3): an "every 2 weeks" rule's `BYYEARDAY` list follows its
 * fortnight, so a start moved by one week needs the new list.
 */
function sameThirteenEncoding(rule: ThirteenRule, from: GregorianDate, to: GregorianDate): boolean {
  if (gregorianEquals(from, to)) return true;
  try {
    return rruleEquals(encodeThirteenRule(rule, from).rrule, encodeThirteenRule(rule, to).rrule, { ignoreEnd: true });
  } catch {
    return false;
  }
}

/** A repeat with no occurrence left (the head of a "future" change whose only dates are excluded): its group shows nothing. */
function hasNoOccurrence(recurrence: EventRecurrence, start: GregorianDate): boolean {
  let from = start;
  for (const x of recurrence.extraDates) if (compareGregorian(x.date, from) < 0) from = x.date;
  try {
    return expandRecurrence(recurrence, start, { from, to: LAST_END.date }, { limit: 1 }).occurrences.length === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** An event's start and end in `zone` (its own), end-of-day form (§3.1.1), as RFC 5545 reads DTEND and DURATION. */
export function eventTimes(zones: DocumentZones, event: IcsEvent, zone: string | null): { allDay: boolean; start: LocalDateTime; end: LocalDateTime } {
  const allDay = event.start.kind === 'date';
  const start = zones.inZone(event.start, zone) ?? (event.start.kind === 'date' ? { date: event.start.date, minute: 0 } : event.start.value);
  if (allDay) {
    let days = 1;
    if (event.end !== null) {
      const endDate = event.end.kind === 'date' ? event.end.date : event.end.value.date;
      days = Math.max(1, diffGregorianDays(endDate, start.date));
    } else if (event.duration !== null) {
      const d = parseIcsDuration(event.duration);
      if (d !== null && !d.negative) days = Math.max(1, d.days + Math.ceil(d.seconds / 86400));
    }
    let last: GregorianDate;
    try {
      last = addGregorianDays(start.date, days - 1);
    } catch {
      last = LAST_END.date;
    }
    return { allDay, start: { date: start.date, minute: 0 }, end: { date: last, minute: DAY } };
  }
  let end: LocalDateTime = start;
  if (event.end !== null) {
    end = zones.inZone(event.end, zone) ?? LAST_END;
  } else if (event.duration !== null) {
    const d = parseIcsDuration(event.duration);
    if (d !== null && !d.negative) {
      try {
        const wall = addMinutesLocal(start, d.days * DAY);
        const exact = Math.trunc(d.seconds / 60);
        if (zone === null || exact === 0) end = addMinutesLocal(wall, exact);
        else {
          const utc = zonedToUtc(wall, zone, zones.resolver);
          const moved = utc === null ? null : utcToZoned(addMinutesLocal(utc, exact), zone, zones.resolver);
          end = moved ?? addMinutesLocal(wall, exact);
        }
      } catch {
        end = LAST_END;
      }
    }
  }
  if (compareLocalDateTime(end, start) < 0) end = start;
  return { allDay, start, end: normalizeEventEnd(start, end) };
}

const ALERT_ACTIONS = new Set(['DISPLAY', 'AUDIO']);

/** A `VALARM` as core's `Alarm` (absolute alerts in the device's wall clock); null for alarms that are not alerts (`ACTION:NONE`, email). */
export function alarmOf(alarm: IcsAlarm, zones: DocumentZones, deviceZone: string, lengthMinutes: number): Alarm | null {
  if (!ALERT_ACTIONS.has(alarm.action.toUpperCase())) return null;
  const trigger = alarm.trigger;
  if (trigger.kind === 'relative') {
    return { kind: 'relative', offsetMinutes: trigger.related === 'end' ? trigger.minutes + lengthMinutes : trigger.minutes };
  }
  const utc = zones.toUtc(trigger.value, deviceZone);
  const at = utc === null ? null : utcToZoned(utc, deviceZone, zones.resolver);
  return at === null ? null : { kind: 'absolute', at };
}

function alarmsOf(event: IcsEvent, zones: DocumentZones, deviceZone: string, lengthMinutes: number): Alarm[] {
  return event.alarms.flatMap((a) => {
    const alarm = alarmOf(a, zones, deviceZone, lengthMinutes);
    return alarm === null ? [] : [alarm];
  });
}

const BUSY_STATUS: Readonly<Record<string, Availability>> = { FREE: 'free', BUSY: 'busy', TENTATIVE: 'tentative', OOF: 'unavailable', WORKINGELSEWHERE: 'busy' };

/** `TRANSP` (`OPAQUE` busy, `TRANSPARENT` free) and `X-MICROSOFT-CDO-BUSYSTATUS` (§3.3). */
export function availabilityOf(event: IcsEvent): Availability {
  const busy = event.extra.find((p) => p.name === 'X-MICROSOFT-CDO-BUSYSTATUS');
  const mapped = busy === undefined ? undefined : BUSY_STATUS[busy.value.toUpperCase()];
  if (mapped !== undefined) return mapped;
  return event.transp === 'TRANSPARENT' ? 'free' : 'busy';
}

export function statusOf(event: IcsEvent): EventStatus {
  return event.status === 'CANCELLED' || event.status === 'CANCELED' ? 'canceled' : event.status === 'TENTATIVE' ? 'tentative' : 'confirmed';
}

const paramOf = (p: IcsProperty, name: string) => p.params.find(([k]) => k === name)?.[1] ?? null;
const unquote = (s: string) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

function organizerOf(event: IcsEvent): CalendarEvent['organizer'] {
  const p = event.extra.find((x) => x.name === 'ORGANIZER');
  if (p === undefined) return null;
  const cn = paramOf(p, 'CN');
  return { name: cn !== null ? unquote(cn) : p.value.replace(/^mailto:/i, ''), isCurrentUser: false };
}

export const attendeeCountOf = (event: IcsEvent): number => event.extra.filter((p) => p.name === 'ATTENDEE').length;

/** The repeat a stored master means (§4.5); null for a single event. */
export function recognitionOf(calendar: IcsCalendar, master: IcsEvent, ctx: ModelContext): Recognition | null {
  if (master.rrules.length === 0 && master.rdates.length === 0) return null;
  return recognizeRecurrence(icsRecognitionInput(master, calendar, ctx.zones), ctx.systemId ?? DEFAULT_SYSTEM_ID);
}

function isHistorical(zones: DocumentZones, event: IcsEvent): boolean {
  const start = zones.inZone(event.start, zones.zoneOf(event.start));
  return start !== null && compareGregorian(start.date, FIRST_EDITABLE) < 0;
}

/** The read-only reason of §3.5 on the web: subscriptions, then events before 1583. */
function readOnlyOf(meta: CalendarMeta, zones: DocumentZones, event: IcsEvent): CalendarEvent['readOnly'] {
  if (meta.kind === 'subscription') return 'subscribed';
  if (!meta.writable) return 'calendar';
  return isHistorical(zones, event) ? 'historical' : null;
}

/** A master, single event or override as core's `CalendarEvent`: times in its own zone. */
export function eventOf(
  calendar: IcsCalendar,
  meta: CalendarMeta,
  member: IcsEvent,
  recurrence: EventRecurrence | null,
  ctx: ModelContext,
  zones = new DocumentZones(calendar, ctx.zones),
): CalendarEvent {
  const zone = zones.zoneOf(member.start);
  const times = eventTimes(zones, member, zone);
  return {
    id: `${meta.id}/${member.uid}`,
    title: member.summary,
    location: member.location,
    notes: member.description,
    url: member.url,
    allDay: times.allDay,
    start: times.start,
    end: times.end,
    timeZone: times.allDay ? null : zone,
    calendarId: meta.id,
    recurrence,
    alarms: alarmsOf(member, zones, ctx.deviceZone, diffMinutesLocal(times.end, times.start)),
    availability: availabilityOf(member),
    status: statusOf(member),
    readOnly: readOnlyOf(meta, zones, member),
    organizer: organizerOf(member),
    attendeeCount: attendeeCountOf(member),
    alarmsEditable: meta.kind === 'local' && meta.writable,
    selfStatus: null,
  };
}

export function draftOf(event: CalendarEvent): EventDraft {
  return {
    title: event.title,
    location: event.location,
    notes: event.notes,
    url: event.url,
    allDay: event.allDay,
    start: event.start,
    end: event.end,
    timeZone: event.timeZone,
    calendarId: event.calendarId,
    recurrence: event.recurrence,
    alarms: event.alarms,
    availability: event.availability,
  };
}

// ---------------------------------------------------------------------------
// Occurrences
// ---------------------------------------------------------------------------

function storeOccurrence(meta: CalendarMeta, zones: DocumentZones, group: IcsGroup, e: IcsExpandedEvent, ctx: ModelContext): StoreOccurrence {
  const component = e.component;
  return {
    key: e.key,
    calendarId: e.calendarId,
    title: e.title,
    allDay: e.allDay,
    start: e.start,
    end: e.end,
    eventId: `${meta.id}/${e.uid}`,
    originalDate: e.originalDate,
    originalMinute: e.originalMinute,
    overrideId: component === group.master ? null : e.key,
    startUtc: e.startUtc,
    location: component.location,
    status: e.status,
    recurring: e.recurring,
    readOnly: readOnlyOf(meta, zones, group.master ?? component),
    attendeeCount: attendeeCountOf(component),
    alarms: meta.kind === 'subscription' ? [] : alarmsOf(component, zones, ctx.deviceZone, diffMinutesLocal(e.end, e.start)),
  };
}

export interface DeviceRange {
  readonly from: LocalDateTime;
  readonly to: LocalDateTime;
}

/**
 * The occurrences of a document in a window of the device's wall clock, as
 * the views need them (one `expandSeries` per UID group through core's
 * `expandCalendar`; keys of §3.2). Subscribed events never alert (§2.17).
 */
export function calendarOccurrences(calendar: IcsCalendar, meta: CalendarMeta, window: DeviceRange, ctx: ModelContext, options: { readonly limit?: number } = {}): StoreOccurrence[] {
  const zones = new DocumentZones(calendar, ctx.zones);
  const { events } = expandCalendar(calendar, ctx.deviceZone, ctx.zones, window, ctx.systemId ?? DEFAULT_SYSTEM_ID, {
    calendarId: meta.id,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  return events.map((e) => storeOccurrence(meta, zones, calendar.groups[e.group]!, e, ctx));
}

/** `[Jan 1 00:00, Dec 31 24:00)` of a year in the device's wall clock. */
export function yearWindow(year: number): DeviceRange {
  return { from: { date: { year, month: 1, day: 1 }, minute: 0 }, to: { date: { year, month: 12, day: 31 }, minute: DAY } };
}

// ---------------------------------------------------------------------------
// Resolving an occurrence (§3.2)
// ---------------------------------------------------------------------------

/** A resolved occurrence with the stored components behind it. */
export interface IcsResolved extends ResolvedOccurrence {
  readonly calendar: IcsCalendar;
  readonly meta: CalendarMeta;
  readonly group: IcsGroup;
  /** The component this occurrence shows (the master, or its override). */
  readonly component: IcsEvent;
  /** The override component, when the occurrence is one. */
  readonly override: IcsEvent | null;
  /** An override shown on its own (no master, or a repeated `RECURRENCE-ID`). */
  readonly orphan: boolean;
  readonly recognition: Recognition | null;
  readonly zones: DocumentZones;
}

function parseOriginalDate(text: string): GregorianDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2})?(?:#\d+)*$/.exec(text);
  return m === null ? null : { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Finds the occurrence with `key` in a calendar's document, with its event and the draft the editor opens; null when it no longer resolves. */
export function resolveInCalendar(calendar: IcsCalendar, meta: CalendarMeta, key: string, ctx: ModelContext): IcsResolved | null {
  const parsed = parseOccurrenceKey(key);
  if (parsed === null) return null;
  const prefix = `${meta.id}/`;
  if (!parsed.eventId.startsWith(prefix)) return null;
  const uid = parsed.eventId.slice(prefix.length);
  const date = parseOriginalDate(parsed.original);
  if (date === null) return null;
  const groups = calendar.groups.filter((g) => g.uid === uid);
  if (groups.length === 0) return null;
  const subset: IcsCalendar = { ...calendar, groups };
  const zones = new DocumentZones(calendar, ctx.zones);
  // Around the original date, and around where an override moved it.
  const days = [date];
  for (const group of groups) {
    for (const override of group.overrides) {
      const original = override.recurrenceId === null ? null : zones.inZone(override.recurrenceId, null);
      if (original !== null && gregorianEquals(original.date, date)) {
        days.push(override.start.kind === 'date' ? override.start.date : override.start.value.date);
      }
    }
  }
  for (const day of days) {
    const window = { from: { date: clampDay(day, -2), minute: 0 }, to: { date: clampDay(day, 2), minute: DAY } };
    const { events } = expandCalendar(subset, ctx.deviceZone, ctx.zones, window, ctx.systemId ?? DEFAULT_SYSTEM_ID, { calendarId: meta.id });
    const found = events.find((e) => e.key === key);
    if (found === undefined) continue;
    const group = groups[found.group]!;
    const occurrence = storeOccurrence(meta, zones, group, found, ctx);
    const master = group.master;
    const override = found.component === master ? null : found.component;
    const orphan = found.orphan;
    const recognition = master === null ? null : recognitionOf(calendar, master, ctx);
    const owner = master !== null && !orphan ? master : found.component;
    const event = eventOf(calendar, meta, owner, owner === master ? (recognition?.recurrence ?? null) : null, ctx, zones);
    let draft: EventDraft;
    if (override !== null && !orphan) {
      const own = eventOf(calendar, meta, override, null, ctx, zones);
      draft = { ...draftOf(own), calendarId: meta.id, recurrence: event.recurrence };
    } else if (override !== null) {
      draft = draftOf(event);
    } else {
      draft = shiftedDraft(event, found.originalDate, found.originalMinute);
    }
    const isFirst = orphan || event.recurrence === null || (gregorianEquals(found.originalDate, event.start.date) && found.originalMinute === null);
    return { occurrence, event, draft, isFirst, calendar, meta, group, component: found.component, override, orphan, recognition, zones };
  }
  return null;
}

/** The occurrence of `master` on `date` (at `minute`, or the master's start minute), with the master's length. */
function shiftedDraft(master: CalendarEvent, date: GregorianDate, minute: number | null): EventDraft {
  const start: LocalDateTime = { date, minute: master.allDay ? 0 : (minute ?? master.start.minute) };
  const length = diffMinutesLocal(master.end, master.start);
  let end: LocalDateTime;
  try {
    end = normalizeEventEnd(start, addMinutesLocal(start, length));
  } catch {
    end = LAST_END;
  }
  return { ...draftOf(master), start, end };
}

// ---------------------------------------------------------------------------
// Writing fields
// ---------------------------------------------------------------------------

/** The form of a timed draft's values: the stored `TZID` when the zone did not change, else the draft's zone, `Z` for UTC, floating. */
function timedValueForm(zones: DocumentZones, stored: IcsDateValue | null, timeZone: string | null): IcsDateValue {
  const at: LocalDateTime = { date: { year: 2000, month: 1, day: 1 }, minute: 0 };
  if (timeZone === null) return { kind: 'floating', value: at };
  if (stored !== null && stored.kind !== 'date' && zones.zoneOf(stored) === timeZone) return stored;
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') return { kind: 'utc', value: at };
  // A TZID the document already defines for this zone (Outlook's `FLE Standard Time` after an all-day round trip).
  const defined = zones.calendar.timeZones.find((t) => zones.zoneOfTzid(t.tzid) === timeZone);
  return { kind: 'zoned', value: at, tzid: defined?.tzid ?? timeZone };
}

/** `DTSTART`, `DTEND` and `DURATION` of a draft (§3.3): all-day as dates (no `DTEND` on 9999-12-31, §3.1.1), timed with `DTEND`. */
function timeValues(zones: DocumentZones, stored: IcsEvent | null, draft: EventDraft): Pick<IcsEvent, 'start' | 'end' | 'duration'> {
  if (draft.allDay) {
    const last = lastDayOf(draft.start, draft.end);
    const { end, duration } = allDayEnd(draft.start.date, compareGregorian(last, draft.start.date) < 0 ? draft.start.date : last);
    return { start: { kind: 'date', date: draft.start.date }, end, duration };
  }
  const form = timedValueForm(zones, stored?.start ?? null, draft.timeZone);
  const endWall: LocalDateTime = draft.end.minute === DAY ? { date: clampDay(draft.end.date, 1), minute: 0 } : draft.end;
  return { start: valueLike(form, draft.start.date, draft.start.minute), end: valueLike(form, endWall.date, endWall.minute), duration: null };
}

/** The `VALARM`s for `alarms`: stored ones that still match are kept as read, non-alert alarms are kept, new ones are `ACTION:DISPLAY`. */
function alarmValues(zones: DocumentZones, stored: IcsEvent | null, alarms: readonly Alarm[], title: string, deviceZone: string, lengthMinutes: number): IcsAlarm[] {
  const remaining = [...alarms];
  const out: IcsAlarm[] = [];
  for (const alarm of stored?.alarms ?? []) {
    const mapped = alarmOf(alarm, zones, deviceZone, lengthMinutes);
    if (mapped === null) {
      out.push(alarm);
      continue;
    }
    const index = remaining.findIndex((a) => deepEqual(a, mapped));
    if (index >= 0) {
      out.push(alarm);
      remaining.splice(index, 1);
    }
  }
  for (const alarm of remaining) {
    const description: IcsProperty = { name: 'DESCRIPTION', params: [], value: escapeText(title === '' ? 'Reminder' : title) };
    if (alarm.kind === 'relative') {
      out.push({ action: 'DISPLAY', trigger: { kind: 'relative', minutes: alarm.offsetMinutes, related: 'start' }, extra: [description] });
    } else {
      const utc = zonedToUtc(alarm.at, deviceZone, zones.resolver);
      if (utc !== null) out.push({ action: 'DISPLAY', trigger: { kind: 'absolute', value: utcValue(utc) }, extra: [description] });
    }
  }
  return out;
}

const BUSY_STATUS_TEXT: Readonly<Record<Availability, string>> = { busy: 'BUSY', free: 'FREE', tentative: 'TENTATIVE', unavailable: 'OOF' };

function availabilityValues(stored: IcsEvent, availability: Availability): Pick<IcsEvent, 'transp' | 'extra'> {
  const transp = availability === 'free' ? 'TRANSPARENT' : 'OPAQUE';
  let extra = stored.extra;
  if (stored.extra.some((p) => p.name === 'X-MICROSOFT-CDO-BUSYSTATUS')) {
    extra = stored.extra.map((p) => (p.name === 'X-MICROSOFT-CDO-BUSYSTATUS' ? { ...p, value: BUSY_STATUS_TEXT[availability] } : p));
  } else if (availability === 'tentative' || availability === 'unavailable') {
    extra = [...stored.extra, { name: 'X-MICROSOFT-CDO-BUSYSTATUS', params: [], value: BUSY_STATUS_TEXT[availability] }];
  }
  return { transp, extra };
}

/**
 * A component with the written field groups of `merged` (title, location,
 * notes, URL, time, alerts, show as); `SEQUENCE` + 1 and `LAST-MODIFIED` now.
 * Repeat and calendar are the caller's.
 */
function applyFields(zones: DocumentZones, member: IcsEvent, merged: EventDraft, written: readonly DraftField[], ctx: WriteContext): IcsEvent {
  let next: IcsEvent = { ...member, sequence: member.sequence + 1, lastModified: utcValue(ctx.now), raw: null };
  if (written.includes('title')) next = { ...next, summary: merged.title };
  if (written.includes('location')) next = { ...next, location: merged.location };
  if (written.includes('notes')) next = { ...next, description: merged.notes };
  if (written.includes('url')) next = { ...next, url: merged.url };
  if (written.includes('time')) next = { ...next, ...timeValues(zones, member, merged) };
  if (written.includes('alarms')) {
    const length = Math.max(0, diffMinutesLocal(merged.end, merged.start));
    next = { ...next, alarms: alarmValues(zones, member, merged.alarms, merged.title, ctx.deviceZone, length) };
  }
  if (written.includes('availability')) next = { ...next, ...availabilityValues(next, merged.availability) };
  return next;
}

/** A new component for a draft (a new event, the tail of a split, a new override); `base` gives the properties Thirteen does not edit. */
function newComponent(zones: DocumentZones, uid: string, draft: EventDraft, ctx: WriteContext, base: IcsEvent | null): IcsEvent {
  const length = Math.max(0, diffMinutesLocal(draft.end, draft.start));
  const blank: IcsEvent = {
    uid,
    uidDerived: false,
    recurrenceId: null,
    sequence: 0,
    summary: draft.title,
    location: draft.location,
    description: draft.notes,
    url: draft.url,
    ...timeValues(zones, base, draft),
    rrules: [],
    exrules: [],
    rdates: [],
    exdates: [],
    status: base?.status ?? null,
    transp: null,
    thirteenRule: null,
    alarms: alarmValues(zones, base, draft.alarms, draft.title, ctx.deviceZone, length),
    created: utcValue(ctx.now),
    lastModified: utcValue(ctx.now),
    dtstamp: utcValue(ctx.now),
    importedLastModified: null,
    extra: base?.extra ?? [],
    raw: null,
    original: null,
    line: null,
  };
  return { ...blank, ...availabilityValues(blank, draft.availability) };
}

// ---------------------------------------------------------------------------
// Writing recurrence
// ---------------------------------------------------------------------------

interface StoredExcept {
  readonly value: IcsDateValue;
  readonly original: OriginalDate | null;
}

interface StoredExtra {
  readonly rdate: IcsRdate;
  readonly extra: OriginalDate | null;
}

/** The stored `EXDATE`s with the original dates they mean (minute null: the series' time or a DATE value). */
function storedExcepts(zones: DocumentZones, master: IcsEvent): StoredExcept[] {
  const zone = zones.zoneOf(master.start);
  const allDay = master.start.kind === 'date';
  const startMinute = startMinuteOf(master);
  return master.exdates.map((value) => {
    const local = zones.inZone(value, zone);
    if (local === null) return { value, original: null };
    const minute = allDay || value.kind === 'date' || local.minute === startMinute ? null : local.minute;
    return { value, original: { date: local.date, minute } };
  });
}

/** The stored `RDATE`s with the extra dates they mean. */
function storedExtras(zones: DocumentZones, master: IcsEvent): StoredExtra[] {
  const zone = zones.zoneOf(master.start);
  const allDay = master.start.kind === 'date';
  const startMinute = startMinuteOf(master);
  return master.rdates.map((rdate) => {
    const local = zones.inZone(rdate.value, zone);
    if (local === null) return { rdate, extra: null };
    const minute = allDay || rdate.value.kind === 'date' || local.minute === startMinute ? null : local.minute;
    return { rdate, extra: { date: local.date, minute } };
  });
}

function exceptValue(master: IcsEvent, x: OriginalDate): IcsDateValue {
  return valueLike(master.start, x.date, x.minute ?? startMinuteOf(master));
}

function extraValue(master: IcsEvent, x: ExtraDate, period: string | null = null): IcsRdate {
  const value: IcsDateValue = master.start.kind === 'date' ? { kind: 'date', date: x.date } : valueLike(master.start, x.date, x.minute ?? startMinuteOf(master));
  return { value, period: period ?? (x.durationMinutes === null ? null : formatMinutesDuration(x.durationMinutes)) };
}

/** `EXDATE` values for `exceptDates`, reusing stored values (their form) where they mean the same date. */
function exdateValues(master: IcsEvent, stored: readonly StoredExcept[], list: readonly OriginalDate[]): IcsDateValue[] {
  const pool = [...stored];
  return list.map((x) => {
    const index = pool.findIndex((s) => s.original !== null && sameOriginal(s.original, x));
    if (index >= 0) return pool.splice(index, 1)[0]!.value;
    return exceptValue(master, x);
  });
}

function rdateValues(master: IcsEvent, stored: readonly StoredExtra[], list: readonly ExtraDate[]): IcsRdate[] {
  const pool = [...stored];
  return list.map((x) => {
    const index = pool.findIndex((s) => s.extra !== null && sameOriginal(s.extra, x));
    if (index >= 0) return pool.splice(index, 1)[0]!.rdate;
    return extraValue(master, x);
  });
}

/** A repeat's end as `COUNT` / `UNTIL` of a rule of `master` (`UNTIL` the end of the day in the event's zone, §4.4). */
function endParts(end: RepeatEnd, master: IcsEvent, calendar: IcsCalendar, zones: ZoneResolver): Pick<RRule, 'count' | 'until'> {
  if (end.kind === 'count') return { count: end.count, until: null };
  if (end.kind === 'until') return { count: null, until: untilFor(end.date, master, calendar, zones) };
  return { count: null, until: null };
}

/** The `RRULE` of an `rrule` or `thirteen` repeat (§4.3, §4.4), its `UNTIL` in the event's form. */
function singleRule(recurrence: EventRecurrence, master: IcsEvent, calendar: IcsCalendar, zones: ZoneResolver, startDate: GregorianDate): RRule {
  const rule = recurrenceToRRule(recurrence, startDate)!;
  const until = rule.until === null ? null : rule.until.kind === 'date' ? untilFor(rule.until.date, master, calendar, zones) : rule.until;
  return { ...rule, until };
}

/**
 * Writes a recurrence onto `master` (whose start is already the new one).
 * `stored` is the component as read and `old` its recognized recurrence
 * (null for a single event). The rule's text is kept when the rule is
 * unchanged (only its end patched), `RDATE`s and `EXDATE`s are kept where they
 * still mean the same dates, and `EXDATE`s added after the stored ones are
 * appended (§4.9).
 */
function withRecurrence(
  calendar: IcsCalendar,
  zones: DocumentZones,
  master: IcsEvent,
  stored: IcsEvent,
  old: EventRecurrence | null,
  next: EventRecurrence | null,
  startDate: GregorianDate,
): IcsEvent {
  if (next === null) return { ...master, rrules: [], exrules: [], rdates: [], exdates: [], thirteenRule: null };
  const platform = zones.zones;
  let rrules: readonly RRule[] = stored.rrules;
  let exrules: readonly RRule[] = stored.exrules;
  let thirteenRule = stored.thirteenRule;
  const extras = storedExtras(zones, stored);
  const rdatesAreExtras =
    old !== null &&
    deepEqual(
      extras.map((s) => s.extra),
      old.extraDates.map((x) => ({ date: x.date, minute: x.minute })),
    );
  // A 13-month rule keeps its text only while its encoding is the same from the new start (§4.9 rule 3).
  const ruleKept =
    old !== null &&
    deepEqual(old.rule, next.rule) &&
    (next.rule.kind !== 'thirteen' || sameThirteenEncoding(next.rule.rule, startDateOf(stored), startDate));
  if (ruleKept) {
    // A new end, or an UNTIL that was written for another time, zone or all-day setting (the tail of a
    // split at a new time: §4.7 "UNTIL is retimed too"; an all-day tail gets a DATE UNTIL).
    const endChanged = !deepEqual(old.end, next.end);
    const untilMoved = next.end.kind === 'until' && !sameStartForm(master.start, stored.start);
    if ((endChanged || untilMoved) && (next.rule.kind === 'rrule' || next.rule.kind === 'thirteen')) {
      const fresh = singleRule(next, master, calendar, platform, startDate);
      rrules = stored.rrules.length === 1 ? [{ ...stored.rrules[0]!, count: fresh.count, until: fresh.until }] : [fresh];
    }
  } else if (old !== null && old.rule.kind === 'foreign' && next.rule.kind === 'foreign' && next.rule.rules.length === stored.rrules.length && next.rule.exrules.length === stored.exrules.length) {
    // A foreign rule whose rules only got new ends (the head of a split).
    const rules = next.rule.rules;
    const ex = next.rule.exrules;
    rrules = stored.rrules.map((r, i) => (deepEqual(old.rule.kind === 'foreign' ? old.rule.rules[i]?.end : null, rules[i]!.end) ? r : { ...r, ...endParts(rules[i]!.end, master, calendar, platform) }));
    exrules = stored.exrules.map((r, i) => (deepEqual(old.rule.kind === 'foreign' ? old.rule.exrules[i]?.end : null, ex[i]!.end) ? r : { ...r, ...endParts(ex[i]!.end, master, calendar, platform) }));
  } else {
    switch (next.rule.kind) {
      case 'rrule':
        rrules = [singleRule(next, master, calendar, platform, startDate)];
        exrules = [];
        thirteenRule = null;
        break;
      case 'thirteen':
        rrules = [singleRule(next, master, calendar, platform, startDate)];
        exrules = [];
        thirteenRule = formatThirteenRuleText(next.rule.rule);
        break;
      case 'foreign':
        rrules = next.rule.rules.map((r) => ({ ...r.rrule, ...endParts(r.end, master, calendar, platform) }));
        exrules = next.rule.exrules.map((r) => ({ ...r.rrule, ...endParts(r.end, master, calendar, platform) }));
        thirteenRule = null;
        break;
      case 'dates':
        rrules = [];
        exrules = [];
        thirteenRule = null;
        break;
    }
  }
  // Extra dates: kept as read while they still mean the same dates.
  let rdates: readonly IcsRdate[] = stored.rdates;
  const extrasSame = old !== null && deepEqual(old.extraDates, next.extraDates);
  if (!(extrasSame && (rdatesAreExtras || ruleKept))) rdates = rdateValues(master, rdatesAreExtras ? extras : [], next.extraDates);
  // Excluded dates: kept as read, then the ones added after them.
  const excepts = storedExcepts(zones, stored);
  let exdates: readonly IcsDateValue[];
  const prefix = excepts.length <= next.exceptDates.length && excepts.every((s, i) => s.original !== null && sameOriginal(s.original, next.exceptDates[i]!));
  if (prefix) exdates = [...stored.exdates, ...next.exceptDates.slice(excepts.length).map((x) => exceptValue(master, x))];
  else exdates = exdateValues(master, excepts, next.exceptDates);
  return { ...master, rrules: [...rrules], exrules: [...exrules], rdates: [...rdates], exdates: [...exdates], thirteenRule };
}

/** An override's original occurrence in the series' zone (minute null: the series' time). */
function originalOf(zones: DocumentZones, master: IcsEvent, override: IcsEvent): OriginalDate | null {
  if (override.recurrenceId === null) return null;
  const local = zones.inZone(override.recurrenceId, zones.zoneOf(master.start));
  if (local === null) return null;
  const allDay = master.start.kind === 'date';
  const minute = allDay || override.recurrenceId.kind === 'date' || local.minute === startMinuteOf(master) ? null : local.minute;
  return { date: local.date, minute };
}

/**
 * The original dates of a series' overrides (its RECURRENCE-IDs in the series'
 * zone), for the losses line of the drag span question (§2.11, B4): what
 * `splitRecurrence` or `retimeExceptions` would drop. `[]` for a single event.
 */
export function overrideDatesIn(calendar: IcsCalendar, uid: string, ctx: ModelContext): OriginalDate[] {
  const zones = new DocumentZones(calendar, ctx.zones);
  const out: OriginalDate[] = [];
  for (const group of calendar.groups) {
    if (group.uid !== uid || group.master === null) continue;
    for (const override of group.overrides) {
      const original = originalOf(zones, group.master, override);
      if (original !== null) out.push(original);
    }
  }
  return out;
}

type RetimeOptions = { readonly minuteDelta: number; readonly allDay: 'to-all-day' | 'to-timed' | null };

function retimeExtra(extra: OriginalDate, options: RetimeOptions): OriginalDate | null {
  if (options.allDay === 'to-all-day') return { date: extra.date, minute: null };
  if (options.allDay === null && extra.minute !== null) {
    const total = extra.minute + options.minuteDelta;
    const days = Math.floor(total / DAY);
    try {
      return { date: addGregorianDays(extra.date, days), minute: total - days * DAY };
    } catch {
      return null;
    }
  }
  return extra;
}

/**
 * Retimes a stored master's exceptions for a new start time, date, zone or
 * all-day setting (§4.7 "Retiming"): `EXDATE`s, `RDATE`s (their `PERIOD`
 * text kept), the `UNTIL` of every stored rule (only its `UNTIL=` part, unless
 * the repeat itself changed) and the overrides' `RECURRENCE-ID`s.
 */
function retimed(
  calendar: IcsCalendar,
  zones: DocumentZones,
  stored: IcsEvent,
  master: IcsEvent,
  old: EventRecurrence,
  next: EventRecurrence,
  overrides: readonly IcsEvent[],
  oldStart: LocalDateTime,
  newStart: LocalDateTime,
  options: RetimeOptions,
  repeatChanged: boolean,
): { master: IcsEvent; overrides: (IcsEvent | null)[] } {
  const originals = overrides.map((o) => originalOf(zones, stored, o));
  const result = retimeExceptions(
    old,
    originals.filter((o): o is OriginalDate => o !== null),
    oldStart.date,
    newStart.date,
    next,
    options,
  );
  let out: IcsEvent;
  const exdates = result.recurrence.exceptDates.map((x) => exceptValue(master, x));
  // A 13-month rule whose encoding depends on the start (the fortnight of "every 2 weeks") is written anew.
  const reencode = next.rule.kind === 'thirteen' && !sameThirteenEncoding(next.rule.rule, oldStart.date, newStart.date);
  if (repeatChanged || reencode) {
    out = withRecurrence(calendar, zones, master, stored, old, result.recurrence, newStart.date);
    out = { ...out, exdates, rdates: result.recurrence.extraDates.map((x) => extraValue(master, x)) };
  } else {
    out = withRetimedUntils({ ...master, rrules: stored.rrules, exrules: stored.exrules }, result.untils, calendar, zones.zones);
    // RDATEs keep their PERIOD text; each is found again by the value the retime gave it.
    const remaining = [...result.recurrence.extraDates];
    const rdates: IcsRdate[] = [];
    for (const { rdate, extra } of storedExtras(zones, stored)) {
      if (extra === null) continue;
      const candidate = retimeExtra(extra, options);
      const index = candidate === null ? -1 : remaining.findIndex((x) => sameOriginal(x, candidate));
      if (index < 0) continue;
      const x = remaining.splice(index, 1)[0]!;
      rdates.push(extraValue(master, x, options.allDay === 'to-all-day' ? null : rdate.period));
    }
    for (const x of remaining) rdates.push(extraValue(master, x));
    out = { ...out, thirteenRule: stored.thirteenRule, exdates, rdates };
  }
  // Overrides follow their originals (null: dropped by the retime), in their order.
  const startMinute = startMinuteOf(out);
  const moved = overrides.map((override, i): IcsEvent | null => {
    const from = originals[i];
    if (from === null || from === undefined) return null;
    const entry = result.overrides.find((m) => sameOriginal(m.from, from));
    if (entry === undefined || entry.to === null) return null;
    return { ...override, recurrenceId: valueLike(out.start, entry.to.date, entry.to.minute ?? startMinute), raw: null };
  });
  return { master: out, overrides: moved };
}

// ---------------------------------------------------------------------------
// Changes (§4.7)
// ---------------------------------------------------------------------------

/** The documents a change reads and writes, by calendar id. */
export interface Workspace {
  calendar(id: string): IcsCalendar | null;
  meta(id: string): (CalendarMeta & { readonly info: StoreCalendar }) | null;
  set(id: string, calendar: IcsCalendar): void;
}

export interface ChangeResult extends WriteResult {
  /** Groups written both here and elsewhere (`editor.changedElsewhere`). */
  readonly conflicts: readonly DraftField[];
}

/** Issues of the groups that are written: an untouched imported URL never blocks a title change. */
function issuesFor(draft: EventDraft, info: StoreCalendar, written: readonly DraftField[] | null): DraftIssue[] {
  const all = validateDraft(draft, info);
  if (written === null) return all;
  const has = (f: DraftField) => written.includes(f);
  return all.filter((issue) => {
    switch (issue) {
      case 'invalid-url':
        return has('url');
      case 'end-before-start':
      case 'out-of-range':
        return has('time');
      case 'too-many-alarms':
        return has('alarms');
      case 'calendar-read-only':
        return true;
      default:
        return has('recurrence') || has('time');
    }
  });
}

function assertValid(draft: EventDraft, info: StoreCalendar, written: readonly DraftField[] | null): void {
  const issues = issuesFor(draft, info, written);
  if (issues.length > 0) throw new EventStoreError('invalid', `The event can't be saved: ${issues.join(', ')}.`, issues);
}

function writableCalendar(ws: Workspace, id: string) {
  const meta = ws.meta(id);
  if (meta === null) throw new EventStoreError('not-found', 'This calendar no longer exists.');
  if (meta.kind !== 'local' || !meta.writable) throw new EventStoreError('read-only', `${meta.title} can't be changed.`);
  const calendar = ws.calendar(id);
  if (calendar === null) throw new EventStoreError('generic', `${meta.title} couldn't be read.`);
  return { meta, calendar };
}

/** The calendar id of a key or event id (`{calendarId}/{uid}...`). */
export function calendarIdOf(keyOrId: string): string {
  const slash = keyOrId.indexOf('/');
  return slash < 0 ? '' : keyOrId.slice(0, slash);
}

function resolveOrThrow(ws: Workspace, key: string, ctx: ModelContext): IcsResolved {
  const calendarId = calendarIdOf(key);
  const meta = ws.meta(calendarId);
  const calendar = ws.calendar(calendarId);
  const resolved = meta === null || calendar === null ? null : resolveInCalendar(calendar, meta, key, ctx);
  if (resolved === null) throw new EventStoreError('occurrence-gone', 'This event changed in another app. Open it again to edit it.');
  return resolved;
}

/** Puts a group into a calendar, bringing the `VTIMEZONE`s it uses from `from`. */
function putGroup(target: IcsCalendar, group: IcsGroup, from: IcsCalendar): IcsCalendar {
  return replaceGroup(from === target ? target : mergeTimeZones(target, from), group);
}

/** A group under another UID (every member, master and overrides). */
function withUid(group: IcsGroup, uid: string): IcsGroup {
  const rename = (member: IcsEvent): IcsEvent => ({ ...member, uid, uidDerived: false, raw: null });
  return { uid, master: group.master === null ? null : rename(group.master), overrides: group.overrides.map(rename) };
}

/**
 * Writes a group into its calendar, or moves it to another one (`calendar`
 * changed); returns the UID it is stored under. A move into a calendar that
 * already holds that UID (the same file imported into both, §3.2) takes a new
 * UID, so the other calendar's event is never replaced (§3.6).
 */
function placeGroup(ws: Workspace, sourceId: string, source: IcsCalendar, targetId: string, group: IcsGroup, original: IcsCalendar, ctx: WriteContext): string {
  if (targetId === sourceId) {
    ws.set(sourceId, replaceGroup(source, group));
    return group.uid;
  }
  ws.set(sourceId, source === original ? removeGroup(source, group.uid) : source);
  const { calendar: target } = writableCalendar(ws, targetId);
  const moved = target.groups.some((g) => g.uid === group.uid) ? withUid(group, ctx.newUid()) : group;
  ws.set(targetId, putGroup(target, moved, original));
  return moved.uid;
}

const keyOf = (calendarId: string, uid: string, draft: EventDraft) => {
  const id = `${calendarId}/${uid}`;
  return { eventId: id, key: occurrenceKey({ id, allDay: draft.allDay, start: draft.start }, draft.start.date, null) };
};

/** Adds a new event (§2.11): a new UID group with a new lowercase UUID. */
export function createIn(ws: Workspace, draft: EventDraft, ctx: WriteContext): ChangeResult {
  const { meta, calendar } = writableCalendar(ws, draft.calendarId);
  assertValid(draft, meta.info, null);
  const zones = new DocumentZones(calendar, ctx.zones);
  const uid = ctx.newUid();
  let master = newComponent(zones, uid, draft, ctx, null);
  master = withRecurrence(calendar, zones, master, master, null, draft.recurrence, draft.start.date);
  ws.set(meta.id, replaceGroup(calendar, { uid, master, overrides: [] }));
  return { ...keyOf(meta.id, uid, draft), conflicts: [] };
}

function assertEditable(resolved: IcsResolved): void {
  const { meta, event } = resolved;
  if (meta.kind !== 'local' || !meta.writable || (event.readOnly !== null && event.readOnly !== 'historical')) {
    throw new EventStoreError('read-only', `${meta.title} can't be changed.`);
  }
}

/** An editor save or a move (§2.11, §4.7) applied to the stored group: a three-way merge with what is stored now. */
export function saveIn(ws: Workspace, request: Omit<SaveRequest, 'kind'>, ctx: WriteContext): ChangeResult {
  const resolved = resolveOrThrow(ws, request.key, ctx);
  assertEditable(resolved);
  const { meta, calendar, group, zones, event: master, occurrence } = resolved;
  const info = ws.meta(meta.id)!.info;
  if (master.readOnly === 'historical') throw new EventStoreError('read-only', 'Events before 1583 can only be deleted or get new alerts.');
  const target = ws.meta(request.draft.calendarId);
  if (target === null) throw new EventStoreError('not-found', 'This calendar no longer exists.');
  if (target.kind !== 'local' || !target.writable) throw new EventStoreError('read-only', `${target.title} can't be changed.`);

  // An override shown on its own (an invited instance): edited like a single event; Repeat stays Never.
  if (resolved.orphan) {
    const component = resolved.component;
    const current = draftOf(eventOf(calendar, meta, component, null, ctx, zones));
    const { merged, written, conflicts } = mergeDraft(request.original, request.draft, current);
    const own: EventDraft = { ...merged, calendarId: meta.id, recurrence: null };
    assertValid(own, info, written.filter((f) => f !== 'recurrence' && f !== 'calendar'));
    const next = applyFields(zones, component, own, written, ctx);
    const overrides = group.overrides.map((o) => (o === component ? next : o));
    ws.set(meta.id, replaceGroup(calendar, { uid: group.uid, master: group.master, overrides }));
    return { eventId: master.id, key: request.key, conflicts };
  }

  const stored = group.master!;
  const recurring = master.recurrence !== null;
  const span = recurring ? request.span : 'all';

  // This occurrence only: add or replace its override (RECURRENCE-ID in the DTSTART form, SEQUENCE + 1).
  if (span === 'this') {
    const existing = resolved.override;
    const { merged, written, conflicts } = mergeDraft(request.original, request.draft, resolved.draft);
    const own: EventDraft = { ...merged, calendarId: meta.id, recurrence: null };
    const ownWritten = written.filter((f) => f !== 'recurrence' && f !== 'calendar');
    assertValid(own, info, ownWritten);
    let override: IcsEvent;
    if (existing !== null) {
      override = applyFields(zones, existing, own, ownWritten, ctx);
    } else {
      const recurrenceId = valueLike(stored.start, occurrence.originalDate, occurrence.originalMinute ?? startMinuteOf(stored));
      override = { ...newComponent(zones, group.uid, own, ctx, stored), recurrenceId, sequence: stored.sequence + 1 };
    }
    const overrides = existing === null ? [...group.overrides, override] : group.overrides.map((o) => (o === existing ? override : o));
    ws.set(meta.id, replaceGroup(calendar, { uid: group.uid, master: stored, overrides }));
    return { eventId: master.id, key: request.key, conflicts };
  }

  const old = resolved.recognition?.recurrence ?? null;

  // Future events from a later occurrence: split (§4.7).
  if (span === 'future' && !resolved.isFirst && old !== null) {
    const ruleChanged = changedFields(request.original, request.draft).includes('recurrence');
    const originals = group.overrides.map((o) => originalOf(zones, stored, o));
    const split = splitRecurrence(
      old,
      master.start.date,
      occurrence.originalDate,
      originals.filter((o): o is OriginalDate => o !== null),
      { recurrence: request.draft.recurrence, start: request.draft.start.date, ruleChanged },
    );
    const { merged, written, conflicts } = mergeDraft(request.original, request.draft, resolved.draft);
    const tailDraft: EventDraft = { ...merged, recurrence: split.tail };
    const targetInfo = ws.meta(merged.calendarId)!;
    assertValid(tailDraft, targetInfo.info, written);
    // Head: the stored master ends before the occurrence; overrides on or after it leave with it.
    const bumped: IcsEvent = { ...stored, sequence: stored.sequence + 1, lastModified: utcValue(ctx.now), raw: null };
    const head = withRecurrence(calendar, zones, bumped, stored, old, split.head, master.start.date);
    const kept = group.overrides.filter((_, i) => {
      const original = originals[i];
      return original !== null && original !== undefined && compareGregorian(original.date, occurrence.originalDate) < 0;
    });
    // A head with no occurrence left (every earlier date deleted alone) goes with its group.
    const headEmpty = kept.length === 0 && (split.head === null || hasNoOccurrence(split.head, master.start.date));
    const source = headEmpty ? removeGroup(calendar, group.uid) : replaceGroup(calendar, { uid: group.uid, master: head, overrides: kept });
    // Tail: a new UID from the occurrence, with the carried exceptions.
    const tailUid = ctx.newUid();
    let tail = newComponent(zones, tailUid, tailDraft, ctx, stored);
    if (split.tail !== null) {
      // A kept rule keeps its stored text (WKST and part order included), with the tail's end.
      const keepText = !ruleChanged && stored.rrules.length === 1 && (old.rule.kind === 'rrule' || old.rule.kind === 'thirteen');
      const template: IcsEvent = keepText ? { ...stored, rdates: [], exdates: [] } : tail;
      tail = withRecurrence(calendar, zones, tail, template, keepText ? { ...old, extraDates: [], exceptDates: [] } : null, split.tail, merged.start.date);
      if (split.tail.rule.kind === 'thirteen') tail = { ...tail, thirteenRule: formatThirteenRuleText(split.tail.rule.rule) };
    }
    const tailStartMinute = startMinuteOf(tail);
    const carried: IcsEvent[] = [];
    if (split.tail !== null) {
      group.overrides.forEach((o, i) => {
        const from = originals[i];
        if (from === null || from === undefined) return;
        const entry = split.overrides.find((m) => sameOriginal(m.from, from));
        if (entry === undefined || entry.to === null) return;
        carried.push({ ...o, uid: tailUid, recurrenceId: valueLike(tail.start, entry.to.date, entry.to.minute ?? tailStartMinute), raw: null, line: null });
      });
    }
    const tailGroup: IcsGroup = { uid: tailUid, master: tail, overrides: carried };
    if (merged.calendarId === meta.id) {
      ws.set(meta.id, replaceGroup(source, tailGroup));
    } else {
      ws.set(meta.id, source);
      const { calendar: other } = writableCalendar(ws, merged.calendarId);
      ws.set(merged.calendarId, putGroup(other, tailGroup, calendar));
    }
    return { ...keyOf(merged.calendarId, tailUid, merged), conflicts };
  }

  // The whole series from its first occurrence, or a single event. A first occurrence that was changed on
  // its own (an override at DTSTART) is the occurrence the user edited: it goes through applyToSeries below.
  if (!recurring || (resolved.isFirst && resolved.override === null)) {
    const current = draftOf(master);
    const { merged, written, conflicts } = mergeDraft(request.original, request.draft, current);
    const targetInfo = ws.meta(merged.calendarId)!;
    assertValid(merged, targetInfo.info, written);
    let next = applyFields(zones, stored, merged, written, ctx);
    let overrides: IcsEvent[] = [...group.overrides];
    // A new start time, date, zone or all-day setting retimes; a new end alone does not (§4.7).
    const startChanged =
      written.includes('time') && (!deepEqual(current.start, merged.start) || current.allDay !== merged.allDay || current.timeZone !== merged.timeZone);
    const repeatChanged = written.includes('recurrence');
    if (old !== null && merged.recurrence !== null && (startChanged || repeatChanged)) {
      const allDay = current.allDay === merged.allDay ? null : merged.allDay ? 'to-all-day' : 'to-timed';
      const minuteDelta = !startChanged || merged.allDay || current.allDay ? 0 : merged.start.minute - current.start.minute;
      const options: RetimeOptions = startChanged ? { minuteDelta, allDay } : { minuteDelta: 0, allDay: null };
      const out = retimed(calendar, zones, stored, next, old, merged.recurrence, group.overrides, current.start, merged.start, options, repeatChanged);
      next = out.master;
      overrides = out.overrides.filter((o): o is IcsEvent => o !== null);
    } else if (merged.recurrence === null) {
      next = withRecurrence(calendar, zones, next, stored, old, null, merged.start.date);
      overrides = [];
    } else if (old === null) {
      next = withRecurrence(calendar, zones, next, stored, null, merged.recurrence, merged.start.date);
    }
    const uid = placeGroup(ws, meta.id, calendar, merged.calendarId, { uid: group.uid, master: next, overrides }, calendar, ctx);
    return { ...keyOf(merged.calendarId, uid, merged), conflicts };
  }

  // All events from a later occurrence (repeats set in another app, §2.11), and the whole series from a
  // first occurrence that was changed on its own: the changes made on the opened occurrence go to the
  // master and to that occurrence (applyToSeries, §4.7).
  const existing = resolved.override;
  const first = resolved.isFirst;
  const opened = existing === null ? null : first ? resolved.draft : draftOf(eventOf(calendar, meta, existing, null, ctx, zones));
  const applied = applyToSeries(draftOf(master), request.original, request.draft, opened);
  let series = applied.master;
  // From the first occurrence a new date moves the series with it, as it does without the override.
  const dayShift = first && applied.retime !== null ? diffGregorianDays(request.draft.start.date, request.original.start.date) : 0;
  if (dayShift !== 0) {
    try {
      series = {
        ...series,
        start: { date: addGregorianDays(series.start.date, dayShift), minute: series.start.minute },
        end: { date: addGregorianDays(series.end.date, dayShift), minute: series.end.minute },
      };
    } catch {
      throw new EventStoreError('invalid', "The event can't be saved: out-of-range.", ['out-of-range']);
    }
  }
  const targetInfo = ws.meta(series.calendarId)!;
  assertValid(series, targetInfo.info, applied.written);
  // Conflicts are those of the opened occurrence: what was changed here and, since it opened, elsewhere.
  const conflicts = first ? mergeDraft(request.original, request.draft, resolved.draft).conflicts : [];
  let next = applyFields(zones, stored, series, applied.written, ctx);
  let overrides: IcsEvent[] = [...group.overrides];
  let edited: IcsEvent | null = existing;
  const repeatChanged = first && applied.written.includes('recurrence');
  if (first && series.recurrence === null) {
    // Repeat Never from the first occurrence: the event becomes what the opened occurrence shows.
    const own = mergeDraft(request.original, request.draft, resolved.draft).merged;
    const single: EventDraft = { ...own, recurrence: null };
    const differs = changedFields(draftOf(master), single).filter((f) => f !== 'recurrence' && f !== 'calendar');
    assertValid(single, targetInfo.info, differs);
    next = applyFields(zones, stored, single, differs, ctx);
    next = withRecurrence(calendar, zones, next, stored, old, null, single.start.date);
    const uid = placeGroup(ws, meta.id, calendar, single.calendarId, { uid: group.uid, master: next, overrides: [] }, calendar, ctx);
    return { ...keyOf(single.calendarId, uid, single), conflicts };
  }
  if ((applied.retime !== null || repeatChanged) && old !== null) {
    const options = applied.retime ?? { minuteDelta: 0, allDay: null };
    const out = retimed(calendar, zones, stored, next, old, series.recurrence ?? old, group.overrides, master.start, series.start, options, repeatChanged);
    next = out.master;
    // The edited override follows its original too.
    edited = existing === null ? null : (out.overrides[group.overrides.indexOf(existing)] ?? null);
    overrides = out.overrides.filter((o): o is IcsEvent => o !== null);
  }
  if (edited !== null && applied.override !== null) {
    const ownWritten = applied.written.filter((f) => f !== 'recurrence' && f !== 'calendar');
    const changed = applyFields(zones, edited, { ...applied.override, recurrence: null }, ownWritten, ctx);
    overrides = overrides.map((o) => (o === edited ? changed : o));
  }
  const uid = placeGroup(ws, meta.id, calendar, series.calendarId, { uid: group.uid, master: next, overrides }, calendar, ctx);
  if (first) return { ...keyOf(series.calendarId, uid, series), conflicts };
  const eventId = `${series.calendarId}/${uid}`;
  const original = parseOccurrenceKey(request.key)?.original ?? null;
  return { eventId, key: eventId === master.id ? request.key : original === null ? null : `${eventId}|${original}`, conflicts };
}

/** "Delete this event", "this event only", "all future events" (§4.7). Historical events stay deletable (§3.5). */
export function deleteIn(ws: Workspace, request: Omit<DeleteRequest, 'kind'>, ctx: WriteContext): ChangeResult {
  const resolved = resolveOrThrow(ws, request.key, ctx);
  assertEditable(resolved);
  const { meta, calendar, group, zones, event: master, occurrence } = resolved;
  // An override shown on its own: that component goes (and the group once empty).
  if (resolved.orphan) {
    const overrides = group.overrides.filter((o) => o !== resolved.component);
    ws.set(meta.id, replaceGroup(calendar, { uid: group.uid, master: group.master, overrides }));
    return { eventId: group.master === null && overrides.length === 0 ? null : master.id, key: null, conflicts: [] };
  }
  const stored = group.master!;
  const old = resolved.recognition?.recurrence ?? null;
  const whole = old === null || request.span === 'all' || (request.span === 'future' && resolved.isFirst);
  if (whole) {
    ws.set(meta.id, removeGroup(calendar, group.uid));
    return { eventId: null, key: null, conflicts: [] };
  }
  const bumped: IcsEvent = { ...stored, sequence: stored.sequence + 1, lastModified: utcValue(ctx.now), raw: null };
  if (request.span === 'this') {
    // EXDATE at the occurrence (at an extra date's own time when it has one); its override goes.
    const value = valueLike(stored.start, occurrence.originalDate, occurrence.originalMinute ?? startMinuteOf(stored));
    const overrides = group.overrides.filter((o) => o !== resolved.override);
    ws.set(meta.id, replaceGroup(calendar, { uid: group.uid, master: { ...bumped, exdates: [...stored.exdates, value] }, overrides }));
    return { eventId: master.id, key: null, conflicts: [] };
  }
  const head = endRecurrenceBefore(old, master.start.date, occurrence.originalDate);
  const overrides = group.overrides.filter((o) => {
    const original = originalOf(zones, stored, o);
    return original !== null && compareGregorian(original.date, occurrence.originalDate) < 0;
  });
  // Nothing left before the occurrence (its earlier dates were all deleted alone): the whole group goes,
  // never a series whose only dates are excluded (it could not be opened, and would still be exported).
  if (head === null || (overrides.length === 0 && hasNoOccurrence(head, master.start.date))) {
    ws.set(meta.id, removeGroup(calendar, group.uid));
    return { eventId: null, key: null, conflicts: [] };
  }
  const next = withRecurrence(calendar, zones, bumped, stored, old, head, master.start.date);
  ws.set(meta.id, replaceGroup(calendar, { uid: group.uid, master: next, overrides }));
  return { eventId: master.id, key: null, conflicts: [] };
}

/** Changes only the alerts (§3.5): of the master and every override of the series, or of the one component shown on its own. */
export function setAlarmsIn(ws: Workspace, key: string, alarms: readonly Alarm[], ctx: WriteContext): ChangeResult {
  const resolved = resolveOrThrow(ws, key, ctx);
  const { meta, calendar, group, zones, event } = resolved;
  if (!event.alarmsEditable) throw new EventStoreError('read-only', 'The alerts of this event cannot be changed.');
  const change = (member: IcsEvent): IcsEvent => {
    const own = eventOf(calendar, meta, member, null, ctx, zones);
    if (deepEqual(own.alarms, alarms)) return member;
    return applyFields(zones, member, { ...draftOf(own), alarms }, ['alarms'], ctx);
  };
  const updated: IcsGroup = resolved.orphan
    ? { uid: group.uid, master: group.master, overrides: group.overrides.map((o) => (o === resolved.component ? change(o) : o)) }
    : { uid: group.uid, master: group.master === null ? null : change(group.master), overrides: group.overrides.map(change) };
  ws.set(meta.id, replaceGroup(calendar, updated));
  return { eventId: event.id, key, conflicts: [] };
}
