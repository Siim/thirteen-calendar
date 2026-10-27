/**
 * The mockup data set (docs/EVENTS.md §6.7): `fixtures/mockup/mockup-events.json`,
 * which every fake store (Apple `FakeCalendarStore`, Android
 * `FakeCalendarRepository`, Windows `FakeEventStore`, web `MemoryEventStore`),
 * screenshot run and board frame loads, so screens match across platforms. No
 * team copies the §6.7 table into code; this file is generated from
 * {@link MOCKUP_EVENT_ROWS} by `pnpm fixtures`, and a staleness test fails
 * until it is regenerated.
 *
 * The file holds, after its envelope (`now` and `deviceZone`: Monday,
 * October 19, 2026, 09:41 in Europe/Tallinn; `window`: 2026-01-01 to
 * 2027-12-31):
 *
 * - `calendars`: the six calendars as `CalendarInfo` JSON (§3.1, §3.4), in
 *   the Calendars list's order;
 * - `events`: each event as `CalendarEvent` JSON (§3.1: the `EventDraft`
 *   fields in the event's zone, then `id`, `status`, `readOnly`, `organizer`,
 *   `attendeeCount`, `alarmsEditable`, `selfStatus`), plus `rrule`, the one
 *   `RRULE` value it is stored as on Apple and in `.ics` (`recurrenceToRRule`:
 *   a Gregorian rule, or a 13-month rule's encoding), and `marker`, the
 *   `X-THIRTEEN-RULE` value of a 13-month rule (both `null` without them).
 *   Ids and occurrence keys follow the Windows and web form of §3.2:
 *   `{calendarId}/{uid}` and `{calendarId}/{uid}|{original start}` (a date
 *   for all-day events);
 * - `occurrences`: every occurrence from 2026-01-01T00:00 to
 *   2027-12-31T24:00 as `EventOccurrence` JSON in the device's wall clock,
 *   expanded with `expandSeries` and sorted by the order key of §5.3.
 *
 * The `monthLayouts`, `weekLayouts`, `dayLayouts`, `agendas` and `yearMarks`
 * cases built on the mockup set (IFC October 2026) take their occurrences from
 * {@link mockupOccurrences}, so they are built from the same data as this file.
 */

import type { CalendarSystemId, GregorianDate } from '../src/index.ts';
import {
  type Alarm,
  type CalendarEvent,
  type CalendarInfo,
  type EventOccurrence,
  type EventRecurrence,
  type ThirteenRule,
  type ZoneResolver,
  diffMinutesLocal,
  formatLocalDateTime,
  formatRRule,
  parseLocalDateTime,
  parseRRule,
} from '../src/events/index.ts';
import { compareCodePoints } from '../src/events/layout.ts';
import { type DeviceWindow, expandSeries } from '../src/events/occurrences.ts';
import { recurrenceToRRule } from '../src/events/recurrence.ts';
import { formatThirteenRuleText } from '../src/events/thirteen-rules.ts';
import {
  type AlarmJson,
  type CalendarJson,
  type LocalJson,
  type RecurrenceJson,
  alarmJson,
  calendarJson,
  dateJson,
  localJson,
  recurrenceJson,
} from './events-fixtures.ts';
import { type OccurrenceJson, occurrenceFromJson, occurrenceJson } from './layout-fixtures.ts';
import { intlZoneResolver } from './zone-resolvers.ts';

/** Repository-relative location of the mockup data file. */
export const MOCKUP_FILE_URL: URL = new URL('../../../fixtures/mockup/mockup-events.json', import.meta.url);

/** The board's "now" (§6.7): Monday, October 19, 2026 = IFC Thursday, October 12, 2026, 09:41. */
export const MOCKUP_NOW = '2026-10-19T09:41';
/** The device zone of the data set; every timed event is in it. */
export const MOCKUP_ZONE = 'Europe/Tallinn';
/** The expansion window of `occurrences`: 2026-01-01 through 2027-12-31. */
export const MOCKUP_WINDOW: { readonly from: LocalJson; readonly to: LocalJson } = {
  from: '2026-01-01T00:00',
  to: '2027-12-31T24:00',
};

// ---------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------

const ICLOUD = { accountId: 'icloud', accountTitle: 'iCloud', accountKind: 'icloud' } as const;
const GOOGLE = { accountId: 'google', accountTitle: 'liis.kask@example.com', accountKind: 'google' } as const;
const WRITABLE = { writable: true, thirteenRepeats: 'all', maxAlarms: null, supportsAvailability: true, supportsUrl: true } as const;
const READ_ONLY = { writable: false, thirteenRepeats: 'all', maxAlarms: null, supportsAvailability: false, supportsUrl: true } as const;

/**
 * The six calendars of §6.7 in the Calendars list's order (grouped by
 * account: iCloud, the Google account, Subscribed, Other; board E1). Home is
 * the platform default.
 */
export const MOCKUP_CALENDARS: readonly CalendarInfo[] = [
  { id: 'home', title: 'Home', color: '#ea580c', ...ICLOUD, ...WRITABLE, isPlatformDefault: true },
  { id: 'family', title: 'Family', color: '#16a34a', ...ICLOUD, ...WRITABLE, isPlatformDefault: false },
  { id: 'work', title: 'Work', color: '#2563eb', ...GOOGLE, ...WRITABLE, isPlatformDefault: false },
  { id: 'running-club', title: 'Running club', color: '#0d9488', ...GOOGLE, ...WRITABLE, isPlatformDefault: false },
  {
    id: 'holidays',
    title: 'Holidays in Estonia',
    color: '#57534e',
    accountId: 'subscriptions',
    accountTitle: 'Subscribed',
    accountKind: 'subscribed',
    ...READ_ONLY,
    isPlatformDefault: false,
  },
  {
    id: 'birthdays',
    title: 'Birthdays',
    color: '#9333ea',
    accountId: 'other',
    accountTitle: 'Other',
    accountKind: 'birthdays',
    ...READ_ONLY,
    isPlatformDefault: false,
  },
];

// ---------------------------------------------------------------------------
// Events (the §6.7 table)
// ---------------------------------------------------------------------------

/** One row of the §6.7 table. Times are wall clock in {@link MOCKUP_ZONE}. */
export interface MockupEventRow {
  readonly uid: string;
  readonly calendarId: string;
  readonly title: string;
  readonly location?: string;
  readonly notes?: string;
  /** `YYYY-MM-DD` for an all-day event, else `YYYY-MM-DDTHH:MM`: the first occurrence (`DTSTART`). */
  readonly start: string;
  /** The last day of an all-day event, or the end wall clock of a timed one. */
  readonly end: string;
  readonly repeat?: EventRecurrence;
  readonly alarms?: readonly Alarm[];
  /** An invitation: organized by someone else, with this many invitees. */
  readonly invitation?: { readonly organizer: string; readonly attendeeCount: number };
}

const repeat = (rule: EventRecurrence['rule']): EventRecurrence => ({ rule, end: { kind: 'never' }, extraDates: [], exceptDates: [] });
const gregorian = (text: string) => repeat({ kind: 'rrule', rrule: parseRRule(text) });
const thirteen = (rule: ThirteenRule) => repeat({ kind: 'thirteen', rule });
const before = (minutes: number): Alarm => ({ kind: 'relative', offsetMinutes: -minutes });
const IFC: CalendarSystemId = 'ifc';
/** IFC Friday (weekday 5): month days 6, 13, 20 and 27. */
const FRIDAY = 5;

/**
 * The §6.7 table, in its order. Repeating events start on the table's
 * explicit `DTSTART`; the others are single events on the date shown. Yoga
 * and Recycling pickup start on IFC January 6 (Gregorian January 6, 2026), an
 * IFC Friday. Book club's notes are the board's (frame A3).
 */
export const MOCKUP_EVENT_ROWS: readonly MockupEventRow[] = [
  {
    uid: 'rent',
    calendarId: 'home',
    title: 'Rent',
    start: '2026-01-01',
    end: '2026-01-01',
    repeat: thirteen({ kind: 'monthly', system: IFC, day: 1 }),
  },
  {
    uid: 'half-marathon',
    calendarId: 'running-club',
    title: 'Half marathon',
    location: 'Tartu',
    start: '2026-10-10T09:00',
    end: '2026-10-10T12:00',
  },
  { uid: 'team-offsite', calendarId: 'work', title: 'Team offsite, Pärnu', start: '2026-10-12', end: '2026-10-14' },
  { uid: 'kodak-call', calendarId: 'work', title: 'Kodak archive call', start: '2026-10-15T16:00', end: '2026-10-15T16:45' },
  { uid: 'lunch-jaan', calendarId: 'home', title: 'Lunch with Jaan', start: '2026-10-16T12:00', end: '2026-10-16T13:00' },
  { uid: 'long-run', calendarId: 'running-club', title: 'Long run', start: '2026-10-17T08:00', end: '2026-10-17T10:00' },
  { uid: 'family-brunch', calendarId: 'family', title: 'Family brunch', start: '2026-10-18T11:00', end: '2026-10-18T13:00' },
  { uid: 'school-break', calendarId: 'family', title: 'Autumn school break', start: '2026-10-19', end: '2026-10-25' },
  {
    uid: 'sprint-planning',
    calendarId: 'work',
    title: 'Sprint planning',
    start: '2026-01-12T09:30',
    end: '2026-01-12T10:30',
    repeat: gregorian('FREQ=WEEKLY;INTERVAL=2'),
  },
  {
    uid: 'one-on-one',
    calendarId: 'work',
    title: '1:1 with Marta',
    start: '2026-01-05T11:00',
    end: '2026-01-05T11:30',
    repeat: gregorian('FREQ=WEEKLY'),
  },
  {
    uid: 'dentist',
    calendarId: 'home',
    title: 'Dentist, Dr. Tamm',
    location: 'Tartu mnt 18',
    start: '2026-10-19T15:40',
    end: '2026-10-19T16:20',
  },
  {
    uid: 'book-club',
    calendarId: 'home',
    title: 'Book club: Cotsworth',
    location: 'Raamatukoi',
    notes: "Chapter 4: Eastman's letters to the League of Nations.",
    start: '2026-01-12T19:00',
    end: '2026-01-12T21:00',
    repeat: thirteen({ kind: 'monthly', system: IFC, day: 12 }),
    alarms: [before(60)],
  },
  {
    uid: 'yoga',
    calendarId: 'running-club',
    title: 'Yoga',
    start: '2026-01-06T07:15',
    end: '2026-01-06T08:15',
    repeat: thirteen({ kind: 'weekly', system: IFC, weekday: FRIDAY, interval: 1 }),
  },
  {
    uid: 'design-review',
    calendarId: 'work',
    title: 'Design review',
    location: 'Room Sol',
    start: '2026-10-21T14:00',
    end: '2026-10-21T15:30',
    alarms: [before(15)],
    invitation: { organizer: 'Marta Kask', attendeeCount: 6 },
  },
  { uid: 'design-review-prep', calendarId: 'work', title: 'Design review prep', start: '2026-10-21T13:00', end: '2026-10-21T14:15' },
  { uid: 'flight-ams', calendarId: 'family', title: 'Flight TLL to AMS', start: '2026-10-24T06:10', end: '2026-10-24T08:20' },
  { uid: 'amsterdam-trip', calendarId: 'family', title: 'Amsterdam trip', start: '2026-10-24', end: '2026-10-26' },
  { uid: 'payday', calendarId: 'home', title: 'Payday', start: '2026-01-25', end: '2026-01-25', repeat: gregorian('FREQ=MONTHLY') },
  {
    uid: 'recycling',
    calendarId: 'home',
    title: 'Recycling pickup',
    start: '2026-01-06',
    end: '2026-01-06',
    repeat: thirteen({ kind: 'weekly', system: IFC, weekday: FRIDAY, interval: 2 }),
  },
  { uid: 'halloween', calendarId: 'holidays', title: 'Halloween', start: '2026-10-31', end: '2026-10-31' },
  { uid: 'all-souls', calendarId: 'holidays', title: "All Souls' Day", start: '2026-11-02', end: '2026-11-02' },
  { uid: 'ilona', calendarId: 'birthdays', title: "Ilona's birthday", start: '2026-11-04', end: '2026-11-04' },
  { uid: 'nye-dinner', calendarId: 'family', title: "New Year's Eve dinner", start: '2026-12-31T19:00', end: '2026-12-31T23:30' },
  { uid: 'winter-break', calendarId: 'family', title: 'Winter break', start: '2026-12-28', end: '2027-01-03' },
];

/** A mockup event: `CalendarEvent` JSON plus its stored `RRULE` and marker (see the module documentation). */
export interface MockupEventJson {
  readonly title: string;
  readonly location: string;
  readonly notes: string;
  readonly url: string;
  readonly allDay: boolean;
  readonly start: LocalJson;
  readonly end: LocalJson;
  readonly timeZone: string | null;
  readonly calendarId: string;
  readonly recurrence: RecurrenceJson | null;
  readonly alarms: readonly AlarmJson[];
  readonly availability: CalendarEvent['availability'];
  readonly id: string;
  readonly status: CalendarEvent['status'];
  readonly readOnly: CalendarEvent['readOnly'];
  readonly organizer: CalendarEvent['organizer'];
  readonly attendeeCount: number;
  readonly alarmsEditable: boolean;
  readonly selfStatus: CalendarEvent['selfStatus'];
  readonly rrule: string | null;
  readonly marker: string | null;
}

/** The whole mockup file. */
export interface MockupFile {
  readonly version: 1;
  readonly generatedBy: '@thirteen/core';
  readonly spec: 'docs/EVENTS.md';
  readonly now: LocalJson;
  readonly deviceZone: string;
  readonly window: { readonly from: LocalJson; readonly to: LocalJson };
  readonly calendars: readonly CalendarJson[];
  readonly events: readonly MockupEventJson[];
  readonly occurrences: readonly OccurrenceJson[];
}

/** Top-level keys of the mockup file, in file order. */
export const MOCKUP_KEYS: readonly (keyof MockupFile)[] = [
  'version',
  'generatedBy',
  'spec',
  'now',
  'deviceZone',
  'window',
  'calendars',
  'events',
  'occurrences',
];

/**
 * The `CalendarEvent` of a row: read-only reasons by the first matching rule
 * of §3.5 (a subscription, Birthdays, a calendar that is not writable, an
 * invitation), alerts editable for writable events and for the invitation (a
 * Google calendar keeps each person's own alerts; the board offers Edit
 * Alerts, frame G1), all-day events Free and timed ones Busy (§2.11).
 */
export function mockupEvent(row: MockupEventRow): CalendarEvent {
  const calendar = MOCKUP_CALENDARS.find((c) => c.id === row.calendarId);
  if (calendar === undefined) throw new RangeError(`Mockup event ${row.uid}: unknown calendar ${row.calendarId}`);
  const allDay = !row.start.includes('T');
  let readOnly: CalendarEvent['readOnly'] = null;
  if (calendar.accountKind === 'subscribed') readOnly = 'subscribed';
  else if (calendar.accountKind === 'birthdays') readOnly = 'birthday';
  else if (!calendar.writable) readOnly = 'calendar';
  else if (row.invitation !== undefined) readOnly = 'invitation';
  return {
    title: row.title,
    location: row.location ?? '',
    notes: row.notes ?? '',
    url: '',
    allDay,
    start: parseLocalDateTime(allDay ? `${row.start}T00:00` : row.start),
    end: parseLocalDateTime(allDay ? `${row.end}T24:00` : row.end),
    timeZone: allDay ? null : MOCKUP_ZONE,
    calendarId: row.calendarId,
    recurrence: row.repeat ?? null,
    alarms: row.alarms ?? [],
    availability: allDay ? 'free' : 'busy',
    id: `${row.calendarId}/${row.uid}`,
    status: 'confirmed',
    readOnly,
    organizer: row.invitation === undefined ? null : { name: row.invitation.organizer, isCurrentUser: false },
    attendeeCount: row.invitation?.attendeeCount ?? 0,
    alarmsEditable: readOnly === null || readOnly === 'invitation',
    selfStatus: row.invitation === undefined ? null : 'accepted',
  };
}

function mockupEventJson(event: CalendarEvent): MockupEventJson {
  const rrule = event.recurrence === null ? null : recurrenceToRRule(event.recurrence, event.start.date);
  return {
    title: event.title,
    location: event.location,
    notes: event.notes,
    url: event.url,
    allDay: event.allDay,
    start: localJson(event.start),
    end: localJson(event.end),
    timeZone: event.timeZone,
    calendarId: event.calendarId,
    recurrence: event.recurrence === null ? null : recurrenceJson(event.recurrence),
    alarms: event.alarms.map(alarmJson),
    availability: event.availability,
    id: event.id,
    status: event.status,
    readOnly: event.readOnly,
    organizer: event.organizer === null ? null : { name: event.organizer.name, isCurrentUser: event.organizer.isCurrentUser },
    attendeeCount: event.attendeeCount,
    alarmsEditable: event.alarmsEditable,
    selfStatus: event.selfStatus,
    rrule: rrule === null ? null : formatRRule(rrule),
    marker: event.recurrence?.rule.kind === 'thirteen' ? formatThirteenRuleText(event.recurrence.rule.rule) : null,
  };
}

/**
 * The order key of §5.3: start, then bars (all-day, or 24 hours or more)
 * before dots, longer first, title, key (titles and keys by code points).
 */
export function compareOccurrences(a: EventOccurrence, b: EventOccurrence): number {
  const byStart = Math.sign(diffMinutesLocal(a.start, b.start));
  if (byStart !== 0) return byStart;
  const length = (o: EventOccurrence) => diffMinutesLocal(o.end, o.start);
  const bar = (o: EventOccurrence) => (o.allDay || length(o) >= 1440 ? 0 : 1);
  return bar(a) - bar(b) || length(b) - length(a) || compareCodePoints(a.title, b.title) || compareCodePoints(a.key, b.key);
}

/** The occurrence key of §3.2 on Windows and web: `{calendarId}/{uid}|{original start, or date}`. */
function occurrenceKey(event: CalendarEvent, originalDate: GregorianDate, originalMinute: number | null): string {
  if (event.allDay) return `${event.id}|${dateJson(originalDate)}`;
  return `${event.id}|${formatLocalDateTime({ date: originalDate, minute: originalMinute ?? event.start.minute })}`;
}

/**
 * Every occurrence of `events` that overlaps `window` (device wall clock in
 * {@link MOCKUP_ZONE}), expanded with `expandSeries`, in order-key order.
 * @throws RangeError when an event does not expand cleanly (truncated,
 * unsupported, out of range or with orphans).
 */
export function expandMockup(events: readonly CalendarEvent[], window: DeviceWindow, zones: ZoneResolver): EventOccurrence[] {
  const occurrences: EventOccurrence[] = [];
  for (const event of events) {
    const series = {
      id: event.id,
      recurrence: event.recurrence,
      allDay: event.allDay,
      start: event.start,
      end: event.end,
      zone: event.timeZone,
      overrides: [],
    };
    const result = expandSeries(series, window, MOCKUP_ZONE, zones);
    if (result.truncated || result.unsupported || result.outOfRange > 0 || result.orphans.length > 0) {
      throw new RangeError(`Mockup event ${event.id} does not expand cleanly`);
    }
    for (const o of result.occurrences) {
      occurrences.push({
        key: occurrenceKey(event, o.originalDate, o.originalMinute),
        calendarId: event.calendarId,
        title: event.title,
        allDay: o.allDay,
        start: o.start,
        end: o.end,
      });
    }
  }
  return occurrences.sort(compareOccurrences);
}

/**
 * The mockup file. `zones` answers for Europe/Tallinn: Node's `Intl` by
 * default, the recording resolver when `pnpm fixtures` writes the files.
 */
export function buildMockupEvents(zones: ZoneResolver = intlZoneResolver()): MockupFile {
  const events = MOCKUP_EVENT_ROWS.map(mockupEvent);
  const window: DeviceWindow = { from: parseLocalDateTime(MOCKUP_WINDOW.from), to: parseLocalDateTime(MOCKUP_WINDOW.to) };
  return {
    version: 1,
    generatedBy: '@thirteen/core',
    spec: 'docs/EVENTS.md',
    now: MOCKUP_NOW,
    deviceZone: MOCKUP_ZONE,
    window: { from: MOCKUP_WINDOW.from, to: MOCKUP_WINDOW.to },
    calendars: MOCKUP_CALENDARS.map(calendarJson),
    events: events.map(mockupEventJson),
    occurrences: expandMockup(events, window, zones).map(occurrenceJson),
  };
}

/** The file's occurrences as `EventOccurrence` values, for the layout sections built on the mockup set. */
export function mockupOccurrences(file: MockupFile): EventOccurrence[] {
  return file.occurrences.map(occurrenceFromJson);
}
