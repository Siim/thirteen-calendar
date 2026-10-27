/**
 * The platform-neutral event model (docs/EVENTS.md §3.1, §3.5, §2.11, §2.14,
 * §4.9, §5.2): calendars, drafts, stored events and occurrences; draft
 * validation and defaults; the editor's start, end and all-day rules; the
 * three-way merge every save uses; and alerts (presets, descriptions and fire
 * times).
 *
 * All wall-clock values of a draft are in the draft's `timeZone` (the device
 * zone for new events; `null` = floating, always `null` for all-day events),
 * and every end is in end-of-day form (§3.1.1): an all-day event runs from
 * `T00:00` of its first day to `T24:00` of its last day.
 * @module
 */

import { formatThirteen } from '../format.ts';
import { type GregorianDate, assertValidGregorian, gregorianEquals, toJulianDayNumber } from '../gregorian.ts';
import { fail, isInteger, isRecord, pad, plainEquals, readBooleanOption, readOptions, show } from '../internal.ts';
import { type CalendarSystemId, DEFAULT_SYSTEM_ID, getCalendarSystem } from '../systems/index.ts';
import { toThirteen } from '../thirteen.ts';
import { type EventRecurrence, adaptRecurrenceToStart, assertValidRecurrence, copyRecurrence } from './recurrence.ts';
import { thirteenEncodingForm, thirteenRuleIncludes } from './thirteen-rules.ts';
import {
  type LocalDateTime,
  type ZoneResolver,
  EARLIEST_ABSOLUTE,
  LATEST_END_ABSOLUTE,
  assertKnownZone,
  assertValidLocalDateTime,
  copyLocal,
  fromAbsoluteEnd,
  fromAbsoluteMinutes,
  toAbsoluteMinutes,
  zonedToUtc,
} from './time.ts';

// ---------------------------------------------------------------------------
// Types (§3.1)
// ---------------------------------------------------------------------------

/** "Show as". Thirteen offers Busy and Free; the others are kept as read. */
export type Availability = 'busy' | 'free' | 'tentative' | 'unavailable';

/** An event's status. */
export type EventStatus = 'confirmed' | 'tentative' | 'canceled';

/** Why an event cannot be changed in Thirteen (§3.5, first matching reason). */
export type ReadOnlyReason =
  | 'calendar'
  | 'subscribed'
  | 'birthday'
  | 'invitation'
  | 'no-write-permission'
  | 'historical';

/** The kind of account a calendar belongs to (§3.4). */
export type CalendarAccountKind =
  | 'icloud'
  | 'google'
  | 'exchange'
  | 'caldav'
  | 'device'
  | 'subscribed'
  | 'birthdays'
  | 'other';

/**
 * An alert. Relative alerts count from the occurrence's start (for all-day
 * events, from `T00:00` of its day: "1 day before at 09:00" is `-900`).
 * Absolute alerts are a device wall clock; they are kept as read and never
 * offered in the pickers.
 */
export type Alarm =
  /** Negative = before the start. */
  | { readonly kind: 'relative'; readonly offsetMinutes: number }
  /** Device wall clock. */
  | { readonly kind: 'absolute'; readonly at: LocalDateTime };

/** A calendar as the editor and the views see it (§3.4). */
export interface CalendarInfo {
  readonly id: string;
  readonly title: string;
  /** `'#rrggbb'`, sRGB. */
  readonly color: string;
  /** Groups the Calendars list. */
  readonly accountId: string;
  /** `'iCloud'`, `'liis.kask@example.com'`, `'On My iPhone'`. */
  readonly accountTitle: string;
  readonly accountKind: CalendarAccountKind;
  readonly writable: boolean;
  /** Whether the calendar keeps 13-month repeats that are not Exchange-safe (§3.5). */
  readonly thirteenRepeats: 'all' | 'gregorian-only';
  /** `null`: no known limit. */
  readonly maxAlarms: number | null;
  readonly supportsAvailability: boolean;
  /** `false` on Android. */
  readonly supportsUrl: boolean;
  readonly isPlatformDefault: boolean;
}

/** What the editor edits. Wall-clock values are in `timeZone` (device zone for new events). */
export interface EventDraft {
  readonly title: string;
  /** `''` = none (same for `notes` and `url`). */
  readonly location: string;
  readonly notes: string;
  readonly url: string;
  readonly allDay: boolean;
  /** All-day: `T00:00` of the first day. */
  readonly start: LocalDateTime;
  /** End-of-day form (§3.1.1); all-day: `T24:00` of the last day. */
  readonly end: LocalDateTime;
  /** IANA id; `null` = floating; always `null` for all-day. */
  readonly timeZone: string | null;
  readonly calendarId: string;
  /** §4; `null` = does not repeat. */
  readonly recurrence: EventRecurrence | null;
  readonly alarms: readonly Alarm[];
  readonly availability: Availability;
}

/** A stored event as read from the platform (series master or single event). */
export interface CalendarEvent extends EventDraft {
  /** §3.2. */
  readonly id: string;
  readonly status: EventStatus;
  readonly readOnly: ReadOnlyReason | null;
  readonly organizer: { readonly name: string; readonly isCurrentUser: boolean } | null;
  readonly attendeeCount: number;
  /** §3.5: true for writable events and for invitations whose store keeps per-user alerts. */
  readonly alarmsEditable: boolean;
  readonly selfStatus: 'accepted' | 'declined' | 'tentative' | 'needs-action' | null;
}

/** One occurrence as the views lay it out, in the DEVICE's wall clock. Platforms keep richer objects by key. */
export interface EventOccurrence {
  /** Unique among the occurrences passed to one call (§3.2). */
  readonly key: string;
  readonly calendarId: string;
  readonly title: string;
  readonly allDay: boolean;
  readonly start: LocalDateTime;
  /** End-of-day form. */
  readonly end: LocalDateTime;
}

/** A problem {@link validateDraft} reports; each is shown under its field (§2.11). */
export type DraftIssue =
  | 'end-before-start'
  | 'out-of-range'
  | 'until-before-start'
  | 'calendar-read-only'
  | 'thirteen-repeat-not-allowed'
  | 'too-many-alarms'
  | 'repeat-not-on-start'
  | 'invalid-url'
  | 'count-out-of-range';

/** What happened to the repeat when the start moved (the §2.11 table, {@link adaptRecurrenceToStart}). */
export type RepeatChange = 'none' | 'adapted' | 'converted' | 'dropped';

/** The field groups of a draft that saves write independently (§2.11, §4.9). `time` is all-day, start, end and zone. */
export type DraftField =
  | 'title'
  | 'location'
  | 'notes'
  | 'url'
  | 'time'
  | 'recurrence'
  | 'calendar'
  | 'alarms'
  | 'availability';

/** One row of an alert picker (§2.14). */
export interface AlarmPreset {
  /** Stable id, e.g. `'before-15m'` or `'before-1d-at-0900'`. */
  readonly id: string;
  /** The row's text, e.g. `'15 minutes before'`, `'1 day before at 09:00'`. */
  readonly label: string;
  /** `null` for "None". */
  readonly alarm: Alarm | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY = 1440;
const ISSUE_ORDER: readonly DraftIssue[] = [
  'end-before-start',
  'out-of-range',
  'until-before-start',
  'calendar-read-only',
  'thirteen-repeat-not-allowed',
  'too-many-alarms',
  'repeat-not-on-start',
  'invalid-url',
  'count-out-of-range',
];
const FIELD_ORDER: readonly DraftField[] = [
  'title',
  'location',
  'notes',
  'url',
  'time',
  'recurrence',
  'calendar',
  'alarms',
  'availability',
];
const AVAILABILITIES: readonly Availability[] = ['busy', 'free', 'tentative', 'unavailable'];
const ACCOUNT_KINDS: readonly CalendarAccountKind[] = [
  'icloud',
  'google',
  'exchange',
  'caldav',
  'device',
  'subscribed',
  'birthdays',
  'other',
];
/** 1583-01-01T00:00, the earliest start Thirteen creates or edits (§3.1.1). */
const EARLIEST_EDITABLE_START = toJulianDayNumber({ year: 1583, month: 1, day: 1 }) * DAY;
/** 9999-12-29T24:00, the latest timed end Thirteen creates or edits (§3.1.1). */
const LATEST_EDITABLE_TIMED_END = (toJulianDayNumber({ year: 9999, month: 12, day: 29 }) + 1) * DAY;
/** "After {n} times" allows 1 to 999 on every platform (§2.11). */
const MAX_COUNT = 999;
/** 09:00, the default start of a timed event on a day that is not today, and the time of all-day alert presets. */
const NINE = 9 * 60;

// ---------------------------------------------------------------------------
// Validation and copies
// ---------------------------------------------------------------------------

function alarmProblem(value: unknown): string | null {
  if (!isRecord(value)) return `expected an alarm object, got ${show(value)}`;
  if (value.kind === 'relative') {
    return isInteger(value.offsetMinutes) ? null : `offsetMinutes must be an integer, got ${show(value.offsetMinutes)}`;
  }
  if (value.kind === 'absolute') {
    try {
      assertValidLocalDateTime(value.at, 'absolute alarm time', false);
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }
  return `alarm kind must be 'relative' or 'absolute', got ${show(value.kind)}`;
}

function assertValidAlarm(value: unknown): asserts value is Alarm {
  const problem = alarmProblem(value);
  if (problem !== null) fail(`Invalid alarm: ${problem}`);
}

function copyAlarm(alarm: Alarm): Alarm {
  return alarm.kind === 'relative'
    ? { kind: 'relative', offsetMinutes: alarm.offsetMinutes }
    : { kind: 'absolute', at: copyLocal(alarm.at) };
}

function draftProblem(value: unknown): string | null {
  if (!isRecord(value)) return `expected an object, got ${show(value)}`;
  for (const key of ['title', 'location', 'notes', 'url', 'calendarId'] as const) {
    if (typeof value[key] !== 'string') return `${key} must be a string, got ${show(value[key])}`;
  }
  if (typeof value.allDay !== 'boolean') return `allDay must be a boolean, got ${show(value.allDay)}`;
  try {
    assertValidLocalDateTime(value.start, 'start', false);
    assertValidLocalDateTime(value.end, 'end');
    if (value.recurrence !== null) assertValidRecurrence(value.recurrence);
    if (!Array.isArray(value.alarms)) return `alarms must be an array, got ${show(value.alarms)}`;
    value.alarms.forEach(assertValidAlarm);
  } catch (error) {
    return (error as Error).message;
  }
  if (value.timeZone !== null && (typeof value.timeZone !== 'string' || value.timeZone === '')) {
    return `timeZone must be a non-empty string or null, got ${show(value.timeZone)}`;
  }
  if (value.allDay) {
    if (value.timeZone !== null) return `an all-day draft has timeZone null, got ${show(value.timeZone)}`;
    if (value.start.minute !== 0) return 'an all-day draft starts at T00:00';
    if (value.end.minute !== 0 && value.end.minute !== DAY) return 'an all-day draft ends at T24:00 (or T00:00) of a day';
  }
  if (!AVAILABILITIES.includes(value.availability as Availability)) {
    return `availability must be one of ${AVAILABILITIES.join(', ')}, got ${show(value.availability)}`;
  }
  return null;
}

/**
 * Validates a draft's shape (every field present with the documented type;
 * all-day drafts start at `T00:00`, end at `T24:00` or `T00:00`, and have no
 * zone). States the user can fix (an end before the start, a count of 0) are
 * not shape errors; {@link validateDraft} reports them.
 */
function assertValidDraft(value: unknown, context: string): asserts value is EventDraft {
  const problem = draftProblem(value);
  if (problem !== null) fail(`Invalid ${context}: ${problem}`);
}

function assertValidCalendar(value: unknown): asserts value is CalendarInfo {
  const problem = ((): string | null => {
    if (!isRecord(value)) return `expected an object, got ${show(value)}`;
    for (const key of ['id', 'title', 'accountId', 'accountTitle'] as const) {
      if (typeof value[key] !== 'string') return `${key} must be a string, got ${show(value[key])}`;
    }
    if (typeof value.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.color)) {
      return `color must be '#rrggbb', got ${show(value.color)}`;
    }
    if (!ACCOUNT_KINDS.includes(value.accountKind as CalendarAccountKind)) {
      return `accountKind is not a known kind: ${show(value.accountKind)}`;
    }
    for (const key of ['writable', 'supportsAvailability', 'supportsUrl', 'isPlatformDefault'] as const) {
      if (typeof value[key] !== 'boolean') return `${key} must be a boolean, got ${show(value[key])}`;
    }
    if (value.thirteenRepeats !== 'all' && value.thirteenRepeats !== 'gregorian-only') {
      return `thirteenRepeats must be 'all' or 'gregorian-only', got ${show(value.thirteenRepeats)}`;
    }
    if (value.maxAlarms !== null && !(isInteger(value.maxAlarms) && value.maxAlarms >= 0)) {
      return `maxAlarms must be a non-negative integer or null, got ${show(value.maxAlarms)}`;
    }
    return null;
  })();
  if (problem !== null) fail(`Invalid calendar: ${problem}`);
}

/** A fresh copy with only the {@link EventDraft} fields, in declaration order. */
function copyDraft(draft: EventDraft): EventDraft {
  return {
    title: draft.title,
    location: draft.location,
    notes: draft.notes,
    url: draft.url,
    allDay: draft.allDay,
    start: copyLocal(draft.start),
    end: copyLocal(draft.end),
    timeZone: draft.timeZone,
    calendarId: draft.calendarId,
    recurrence: draft.recurrence === null ? null : copyRecurrence(draft.recurrence),
    alarms: draft.alarms.map(copyAlarm),
    availability: draft.availability,
  };
}

function readZoneOption(value: unknown, context: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value === '') {
    fail(`${context} option 'timeZone' must be a non-empty string or null, got ${show(value)}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// URL check (§2.11)
// ---------------------------------------------------------------------------

const SCHEME_WITH_AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const isPort = (text: string) => /^\d{1,5}$/.test(text) && Number(text) <= 65535;
const HOST_LABEL = /^[\p{L}\p{N}\p{M}_-]+$/u;

/**
 * The editor's URL rule (§2.11; the editor adds `https://` when the scheme is
 * missing). A URL is valid when it has no whitespace or control characters and
 *
 * - it starts with `scheme://` and its host (after any `user@`, before any
 *   `:port`, `/`, `?` or `#`) is not empty; or
 * - it has no `scheme://` and reads as a host with at least one dot,
 *   `localhost` or a bracketed IPv6 address, optionally followed by `:port`
 *   and a path, query or fragment (`example.com/a?b`, `localhost:3000`).
 *
 * Host labels are letters, digits, marks, `_` and `-` (any script); ports are
 * 1 to 5 digits up to 65535.
 */
function isValidEventUrl(text: string): boolean {
  if (/[\s\p{Cc}]/u.test(text)) return false;
  const scheme = SCHEME_WITH_AUTHORITY.exec(text);
  const rest = scheme === null ? text : text.slice(scheme[0].length);
  const authority = rest.split(/[/?#]/, 1)[0]!;
  let host = authority.slice(authority.lastIndexOf('@') + 1);
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    if (close < 2) return false;
    const after = host.slice(close + 1);
    if (after !== '' && !(after.startsWith(':') && isPort(after.slice(1)))) return false;
    return /^\[[0-9A-Fa-f:.]+\]$/.test(host.slice(0, close + 1));
  }
  const colon = host.lastIndexOf(':');
  if (colon >= 0) {
    if (!isPort(host.slice(colon + 1))) return false;
    host = host.slice(0, colon);
  }
  if (host === '') return false;
  const labels = host.split('.');
  if (!labels.every((label) => HOST_LABEL.test(label))) return false;
  return scheme !== null || labels.length >= 2 || host.toLowerCase() === 'localhost';
}

// ---------------------------------------------------------------------------
// Validation (§2.11, §3.1.1, §3.5)
// ---------------------------------------------------------------------------

/**
 * Every issue of a draft for the target calendar, in this order (§5.2); `[]`
 * means the draft can be saved:
 *
 * 1. `end-before-start`: a timed end before its start (equal is a valid
 *    zero-length event), or an all-day end that leaves no day (last day before
 *    the first).
 * 2. `out-of-range`: the start is before 1583-01-01, or a timed end is after
 *    9999-12-29T24:00 (§3.1.1; all-day events may end 9999-12-31T24:00).
 * 3. `until-before-start`: the repeat ends on a date before the start date.
 * 4. `calendar-read-only`: the calendar is not writable.
 * 5. `thirteen-repeat-not-allowed`: a 13-month repeat whose encoding is not
 *    Exchange-safe (§4.3) in a `gregorian-only` calendar.
 * 6. `too-many-alarms`: more alarms than the calendar's `maxAlarms`.
 * 7. `repeat-not-on-start`: a 13-month repeat that does not produce the start
 *    date (a monthly, weekly or yearly rule on another day or on an
 *    intercalary day, an intercalary rule on another day).
 * 8. `invalid-url`: a non-empty URL that fails the editor's URL rule
 *    (`example`, `http://`, anything with spaces).
 * 9. `count-out-of-range`: "After {n} times" outside 1 to 999.
 *
 * Gregorian, `dates` and `foreign` repeats may start on a day their rule skips
 * (the start stays the first occurrence, as in RFC 5545). An alert-only edit of
 * an invitation (§3.5) writes no other field and is not validated with this.
 * @throws RangeError for a malformed draft or calendar (see the shape rules of
 * {@link EventDraft}); never for an issue above.
 */
export function validateDraft(draft: EventDraft, calendar: CalendarInfo): DraftIssue[] {
  assertValidDraft(draft, 'event draft');
  assertValidCalendar(calendar);
  const issues = new Set<DraftIssue>();
  const start = toAbsoluteMinutes(draft.start);
  const end = toAbsoluteMinutes(draft.end);
  if (draft.allDay ? end <= start : end < start) issues.add('end-before-start');
  if (start < EARLIEST_EDITABLE_START || (!draft.allDay && end > LATEST_EDITABLE_TIMED_END)) issues.add('out-of-range');
  if (!calendar.writable) issues.add('calendar-read-only');
  if (calendar.maxAlarms !== null && draft.alarms.length > calendar.maxAlarms) issues.add('too-many-alarms');
  if (draft.url !== '' && !isValidEventUrl(draft.url)) issues.add('invalid-url');
  const recurrence = draft.recurrence;
  if (recurrence !== null) {
    const repeatEnd = recurrence.end;
    if (repeatEnd.kind === 'until' && toJulianDayNumber(repeatEnd.date) < toJulianDayNumber(draft.start.date)) {
      issues.add('until-before-start');
    }
    const countInRange = (count: number) => isInteger(count) && count >= 1 && count <= MAX_COUNT;
    if (repeatEnd.kind === 'count' && !countInRange(repeatEnd.count)) issues.add('count-out-of-range');
    if (recurrence.rule.kind === 'thirteen') {
      const rule = recurrence.rule.rule;
      // Exchange keeps forms (a) and (c) only (§4.3); the start is always the first occurrence (§4.2).
      if (calendar.thirteenRepeats === 'gregorian-only' && thirteenEncodingForm(rule) === 'byyearday') {
        issues.add('thirteen-repeat-not-allowed');
      }
      if (!thirteenRuleIncludes(rule, draft.start.date, draft.start.date)) issues.add('repeat-not-on-start');
    }
  }
  return ISSUE_ORDER.filter((issue) => issues.has(issue));
}

// ---------------------------------------------------------------------------
// Defaults and editor rules (§2.11)
// ---------------------------------------------------------------------------

/**
 * A new event's draft (§2.11): untitled, no location, notes or URL, repeat
 * Never, no alerts.
 *
 * - Timed (default): on `day` at the next whole hour after `now` when `day` is
 *   today (`now.date`), or at 23:00 when the next whole hour would be
 *   tomorrow; on any other day at 09:00. One hour long (23:00 ends `T24:00`).
 *   Show as Busy. `timeZone` is `options.timeZone` (pass the device zone;
 *   default `null`, floating).
 * - All-day (`options.allDay`, when created from an all-day row or bar): the
 *   whole of `day`, `timeZone` `null` whatever the option says, Show as Free.
 *
 * At 10:20 the draft is 11:00 to 12:00; at 10:00 it is 11:00 to 12:00 too.
 * @param now the device's wall clock (minute `0…1439`).
 * @param calendarId the default calendar (§2.15).
 * @throws RangeError for invalid arguments or options.
 */
export function newEventDraft(
  day: GregorianDate,
  now: LocalDateTime,
  calendarId: string,
  options?: { allDay?: boolean; timeZone?: string | null },
): EventDraft {
  assertValidGregorian(day);
  assertValidLocalDateTime(now, 'now', false);
  if (typeof calendarId !== 'string') fail(`calendarId must be a string, got ${show(calendarId)}`);
  const bag = readOptions(options, ['allDay', 'timeZone'], 'newEventDraft');
  const allDay = readBooleanOption(bag, 'allDay', 'newEventDraft') ?? false;
  const zone = readZoneOption(bag.timeZone, 'newEventDraft');
  const dayStart = toJulianDayNumber(day) * DAY;
  let startMinute = 0;
  let length = DAY;
  if (!allDay) {
    const nextHour = (Math.floor(now.minute / 60) + 1) * 60;
    startMinute = gregorianEquals(day, now.date) ? Math.min(nextHour, 23 * 60) : NINE;
    length = 60;
  }
  const start = dayStart + startMinute;
  return {
    title: '',
    location: '',
    notes: '',
    url: '',
    allDay,
    start: fromAbsoluteMinutes(start)!,
    end: fromAbsoluteEnd(start + length, start)!,
    timeZone: allDay ? null : zone,
    calendarId,
    recurrence: null,
    alarms: [],
    availability: allDay ? 'free' : 'busy',
  };
}

/** Clamps an end to the supported range of end values. */
function endAt(absolute: number, startAbsolute: number): LocalDateTime {
  const clamped = Math.min(Math.max(absolute, EARLIEST_ABSOLUTE), LATEST_END_ABSOLUTE);
  return fromAbsoluteEnd(clamped, startAbsolute)!;
}

/**
 * Moves a draft's start, as changing Starts or dragging does (§2.11): the end
 * moves by the same amount (the wall-clock duration, or the number of days of
 * an all-day event, is kept), and the repeat is re-derived from the new start
 * with {@link adaptRecurrenceToStart}, which reports the change so that none is
 * silent (`'converted'` and `'dropped'` show a notice).
 *
 * An end that would pass 9999-12-31T24:00 stops there ({@link validateDraft}
 * then reports `out-of-range` for timed events). Every other field is kept.
 * @param start the new start (minute `0…1439`; `T00:00` for all-day drafts).
 * @param systemId accepted for API symmetry; 13-month rules are re-derived in
 *   their own system (§4.2), so the result does not depend on it.
 * @throws RangeError for a malformed draft, an invalid start or system.
 */
export function moveDraftStart(
  draft: EventDraft,
  start: LocalDateTime,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): { draft: EventDraft; repeatChange: RepeatChange } {
  assertValidDraft(draft, 'event draft');
  assertValidLocalDateTime(start, 'new start', false);
  getCalendarSystem(systemId);
  if (draft.allDay && start.minute !== 0) fail('An all-day draft starts at T00:00');
  const oldStart = toAbsoluteMinutes(draft.start);
  const newStart = toAbsoluteMinutes(start);
  const end = endAt(newStart + toAbsoluteMinutes(draft.end) - oldStart, newStart);
  let recurrence: EventRecurrence | null = null;
  let repeatChange: RepeatChange = 'none';
  if (draft.recurrence !== null) {
    const adapted = adaptRecurrenceToStart(draft.recurrence, draft.start.date, start.date);
    recurrence = adapted.recurrence;
    repeatChange = adapted.change;
  }
  return { draft: { ...copyDraft(draft), start: copyLocal(start), end, recurrence }, repeatChange };
}

/**
 * Turns all-day on or off (§2.11).
 *
 * - On: keeps the dates the event covers (a timed event from 22:00 to 01:30
 *   becomes a two-day all-day event; one ending at midnight covers one day),
 *   `T00:00` of the first day to `T24:00` of the last, `timeZone` `null`, and
 *   Show as Free unless `availabilityTouched` (the user chose Show as in this
 *   editor).
 * - Off: the first day at `previousTimes.start` to the last day at
 *   `previousTimes.end` (minutes; pass the times the draft had before it
 *   became all-day), or 09:00 to 10:00; an end that would come before the
 *   start moves to the next day. Show as Busy unless `availabilityTouched`.
 *   The zone is `timeZone` (§3.1, §3.3): pass the device zone for a new
 *   event, and the zone the draft had before it became all-day for an
 *   existing one (as `previousTimes` does for its times), so turning all-day
 *   on and off again leaves the time group unchanged. Without it (or with
 *   `null`) the event is floating.
 *
 * Repeat and alerts are kept. Setting the current value returns a copy.
 * @throws RangeError for a malformed draft or options (`previousTimes.start`
 * must be `0…1439`, `previousTimes.end` `0…1440`, `timeZone` a non-empty
 * string or null).
 */
export function setDraftAllDay(
  draft: EventDraft,
  allDay: boolean,
  options?: { previousTimes?: { start: number; end: number }; availabilityTouched?: boolean; timeZone?: string | null },
): EventDraft {
  assertValidDraft(draft, 'event draft');
  if (typeof allDay !== 'boolean') fail(`allDay must be a boolean, got ${show(allDay)}`);
  const bag = readOptions(options, ['previousTimes', 'availabilityTouched', 'timeZone'], 'setDraftAllDay');
  const touched = readBooleanOption(bag, 'availabilityTouched', 'setDraftAllDay') ?? false;
  const zone = readZoneOption(bag.timeZone, 'setDraftAllDay');
  const previous = bag.previousTimes;
  if (previous !== undefined) {
    if (
      !isRecord(previous) ||
      !isInteger(previous.start) ||
      previous.start < 0 ||
      previous.start >= DAY ||
      !isInteger(previous.end) ||
      previous.end < 0 ||
      previous.end > DAY
    ) {
      fail(`setDraftAllDay option 'previousTimes' must be { start: 0..1439, end: 0..1440 }, got ${show(previous)}`);
    }
  }
  const copy = copyDraft(draft);
  if (allDay === draft.allDay) return copy;
  const startAbsolute = toAbsoluteMinutes(draft.start);
  const endAbsolute = toAbsoluteMinutes(draft.end);
  const firstDay = toJulianDayNumber(draft.start.date);
  if (allDay) {
    // The last covered day: the date of the end in end-of-day form, or the first day.
    const lastDay = endAbsolute > startAbsolute ? Math.ceil(endAbsolute / DAY) - 1 : firstDay;
    return {
      ...copy,
      allDay: true,
      start: fromAbsoluteMinutes(firstDay * DAY)!,
      end: fromAbsoluteEnd((lastDay + 1) * DAY, firstDay * DAY)!,
      timeZone: null,
      availability: touched ? draft.availability : 'free',
    };
  }
  const lastDay = endAbsolute > startAbsolute ? endAbsolute / DAY - 1 : firstDay;
  const startMinute = isRecord(previous) ? (previous.start as number) : NINE;
  const endMinute = isRecord(previous) ? (previous.end as number) : NINE + 60;
  const start = firstDay * DAY + startMinute;
  let end = lastDay * DAY + endMinute;
  if (end < start) end += DAY;
  return {
    ...copy,
    allDay: false,
    start: fromAbsoluteMinutes(start)!,
    end: endAt(end, start),
    timeZone: zone,
    availability: touched ? draft.availability : 'busy',
  };
}

// ---------------------------------------------------------------------------
// Changes and the three-way merge (§2.11, §4.9)
// ---------------------------------------------------------------------------

function alarmsEqual(a: readonly Alarm[], b: readonly Alarm[]): boolean {
  return (
    a.length === b.length &&
    a.every((alarm, i) => {
      const other = b[i]!;
      if (alarm.kind === 'relative') return other.kind === 'relative' && other.offsetMinutes === alarm.offsetMinutes;
      return other.kind === 'absolute' && toAbsoluteMinutes(other.at) === toAbsoluteMinutes(alarm.at);
    })
  );
}

function groupEquals(field: DraftField, a: EventDraft, b: EventDraft): boolean {
  switch (field) {
    case 'title':
    case 'location':
    case 'notes':
    case 'url':
    case 'availability':
      return a[field] === b[field];
    case 'calendar':
      return a.calendarId === b.calendarId;
    case 'time':
      return (
        a.allDay === b.allDay &&
        a.timeZone === b.timeZone &&
        toAbsoluteMinutes(a.start) === toAbsoluteMinutes(b.start) &&
        toAbsoluteMinutes(a.end) === toAbsoluteMinutes(b.end)
      );
    case 'recurrence':
      return plainEquals(a.recurrence, b.recurrence);
    case 'alarms':
      return alarmsEqual(a.alarms, b.alarms);
  }
}

/**
 * The field groups in which `b` differs from `a`, in {@link DraftField} order.
 * `time` compares all-day, zone and the start and end moments (`D T24:00`
 * equals `D+1 T00:00`); `recurrence` compares the whole value structurally
 * (lists in order); `alarms` compares the list in order. Properties other than
 * the {@link EventDraft} fields are ignored.
 * @throws RangeError for a malformed draft.
 */
export function changedFields(a: EventDraft, b: EventDraft): DraftField[] {
  assertValidDraft(a, 'event draft');
  assertValidDraft(b, 'event draft');
  return FIELD_ORDER.filter((field) => !groupEquals(field, a, b));
}

/**
 * Three-way merge (§2.11, §4.9): the groups where `edited` differs from
 * `original` are "written" and taken from `edited`; every other group is taken
 * from `current` (the event as fetched again at save time), so changes made
 * elsewhere to groups the user did not touch are kept and not written. A
 * written group is a "conflict" when `current` also differs from `original`
 * and from `edited` (both sides changed it differently; the user's change
 * wins, and the editor shows `editor.changedElsewhere`). Platforms write only
 * the `written` groups. `merged` is a fresh draft with only the
 * {@link EventDraft} fields.
 * @throws RangeError for a malformed draft.
 */
export function mergeDraft(
  original: EventDraft,
  edited: EventDraft,
  current: EventDraft,
): { merged: EventDraft; written: DraftField[]; conflicts: DraftField[] } {
  assertValidDraft(original, 'original draft');
  assertValidDraft(edited, 'edited draft');
  assertValidDraft(current, 'current draft');
  const written = FIELD_ORDER.filter((field) => !groupEquals(field, original, edited));
  const conflicts = written.filter(
    (field) => !groupEquals(field, original, current) && !groupEquals(field, edited, current),
  );
  const from = (field: DraftField) => (written.includes(field) ? edited : current);
  const time = from('time');
  const recurrence = from('recurrence').recurrence;
  const merged: EventDraft = {
    title: from('title').title,
    location: from('location').location,
    notes: from('notes').notes,
    url: from('url').url,
    allDay: time.allDay,
    start: copyLocal(time.start),
    end: copyLocal(time.end),
    timeZone: time.timeZone,
    calendarId: from('calendar').calendarId,
    recurrence: recurrence === null ? null : copyRecurrence(recurrence),
    alarms: from('alarms').alarms.map(copyAlarm),
    availability: from('availability').availability,
  };
  return { merged, written, conflicts };
}

/**
 * The time group the series master takes in {@link applyToSeries}: its own
 * first date, the edited occurrence's start minute (an absolute wall-clock
 * time), the edited length (wall-clock minutes for timed events, days for
 * all-day events), the all-day setting and the zone. An end that would pass
 * 9999-12-31T24:00 stops there, as in {@link moveDraftStart}.
 */
function seriesTime(master: EventDraft, edited: EventDraft): Pick<EventDraft, 'allDay' | 'start' | 'end' | 'timeZone'> {
  const firstDay = toJulianDayNumber(master.start.date);
  const editedStart = toAbsoluteMinutes(edited.start);
  const editedEnd = toAbsoluteMinutes(edited.end);
  if (edited.allDay) {
    const days = Math.max(1, Math.ceil((editedEnd - editedStart) / DAY));
    const start = firstDay * DAY;
    return { allDay: true, start: fromAbsoluteMinutes(start)!, end: endAt(start + days * DAY, start), timeZone: null };
  }
  const start = firstDay * DAY + edited.start.minute;
  return {
    allDay: false,
    start: fromAbsoluteMinutes(start)!,
    end: endAt(start + editedEnd - editedStart, start),
    timeZone: edited.timeZone,
  };
}

/** `base` with the groups in `fields` taken from `from` (the time group from `time`). */
function withGroups(
  base: EventDraft,
  from: EventDraft,
  fields: readonly DraftField[],
  time: Pick<EventDraft, 'allDay' | 'start' | 'end' | 'timeZone'>,
): EventDraft {
  const pick = (field: DraftField) => (fields.includes(field) ? from : base);
  const recurrence = pick('recurrence').recurrence;
  return {
    title: pick('title').title,
    location: pick('location').location,
    notes: pick('notes').notes,
    url: pick('url').url,
    allDay: time.allDay,
    start: copyLocal(time.start),
    end: copyLocal(time.end),
    timeZone: time.timeZone,
    calendarId: pick('calendar').calendarId,
    recurrence: recurrence === null ? null : copyRecurrence(recurrence),
    alarms: pick('alarms').alarms.map(copyAlarm),
    availability: pick('availability').availability,
  };
}

/**
 * "Save for all events" (§4.7, §2.11): applies the changes the user made on
 * one occurrence (`opened` as shown, `edited` as saved) to the series
 * `master`, fetched again at save time, without taking the occurrence's
 * date. Used for repeats set in another app (`editable: false`), whose rule
 * is anchored on the master's own first date.
 *
 * - `written` is {@link changedFields}`(opened, edited)`: the groups the user
 *   changed. Every written group except the time group is taken from
 *   `edited`; every other group keeps the master's current value, so changes
 *   made elsewhere meanwhile are kept (as in {@link mergeDraft}).
 * - Time group, when written: the master keeps its own start date and takes
 *   the edited start minute as an absolute wall-clock time (never a delta
 *   from `opened`, which may be an override with a time of its own), the
 *   edited length (minutes for timed events, days for all-day events), the
 *   all-day setting and the zone. When it is not written, the master's time
 *   group is not touched.
 * - `override` (the edited occurrence's stored override, or `null`) gets the
 *   same written groups, its time group as `edited`'s own date and time, so
 *   the occurrence the user edited shows the change. Its repeat is never
 *   changed (an override has none of its own). Other overrides keep their
 *   values.
 * - `retime`: the `retimeExceptions` options the platform then applies, as
 *   for a retime of the first occurrence. `minuteDelta` is the master's new
 *   start minute minus its old one; `allDay` is `'to-all-day'` or
 *   `'to-timed'` when the master's setting flips, else `null`. `retime` is
 *   `null` when the time group is not written.
 *
 * Results are fresh drafts with only the {@link EventDraft} fields.
 * @throws RangeError for a malformed draft.
 */
export function applyToSeries(
  master: EventDraft,
  opened: EventDraft,
  edited: EventDraft,
  override: EventDraft | null,
): {
  master: EventDraft;
  override: EventDraft | null;
  written: DraftField[];
  retime: { minuteDelta: number; allDay: 'to-all-day' | 'to-timed' | null } | null;
} {
  assertValidDraft(master, 'series master');
  assertValidDraft(opened, 'opened draft');
  assertValidDraft(edited, 'edited draft');
  if (override !== null) assertValidDraft(override, 'override');
  const written = FIELD_ORDER.filter((field) => !groupEquals(field, opened, edited));
  const timeWritten = written.includes('time');
  const time = timeWritten ? seriesTime(master, edited) : master;
  const merged = withGroups(master, edited, written, time);
  const retime = timeWritten
    ? {
        minuteDelta: time.start.minute - master.start.minute,
        allDay: time.allDay === master.allDay ? null : time.allDay ? ('to-all-day' as const) : ('to-timed' as const),
      }
    : null;
  const mergedOverride =
    override === null
      ? null
      : withGroups(
          override,
          edited,
          written.filter((field) => field !== 'recurrence'),
          timeWritten ? edited : override,
        );
  return { master: merged, override: mergedOverride, written, retime };
}

// ---------------------------------------------------------------------------
// Alerts (§2.14)
// ---------------------------------------------------------------------------

/**
 * When an alert fires, as a UTC wall clock (§2.14), for platforms that plan
 * alerts themselves (Windows, web):
 *
 * - a relative alert on a timed occurrence: the occurrence's start instant
 *   (`occurrence.startUtc`) plus the offset, exactly;
 * - a relative alert on an all-day occurrence: its wall-clock time on its day
 *   in the device's zone (`occurrence.start` is the date at `T00:00`; "On the
 *   day at 09:00" is 09:00 on that date even on a daylight saving day; a time
 *   in a DST gap moves forward as in {@link zonedToUtc});
 * - an absolute alert: its device wall clock in the device's zone.
 *
 * @param occurrence `startUtc` is required for timed occurrences and ignored
 *   for all-day ones: pass the `startUtc` of the expanded occurrence
 *   (`expandSeries`, `eventsFromCalendar`). Rebuilding it from the device wall
 *   clock with `zonedToUtc` takes the earlier instant in a fall-back hour, so
 *   an occurrence that falls in the device's repeated hour would alert an
 *   hour early.
 * @returns the UTC wall clock, or `null` when it falls outside years 1 to 9999.
 * @throws RangeError for an invalid alarm or occurrence, or an unknown zone.
 */
export function alarmFireTime(
  alarm: Alarm,
  occurrence: { allDay: boolean; start: LocalDateTime; startUtc: LocalDateTime | null },
  deviceZone: string,
  zones: ZoneResolver,
): LocalDateTime | null {
  assertValidAlarm(alarm);
  if (!isRecord(occurrence) || typeof occurrence.allDay !== 'boolean') {
    fail(`Invalid occurrence: expected { allDay, start, startUtc }, got ${show(occurrence)}`);
  }
  assertValidLocalDateTime(occurrence.start, 'occurrence start', false);
  if (occurrence.startUtc !== null) assertValidLocalDateTime(occurrence.startUtc, 'occurrence startUtc');
  assertKnownZone(deviceZone, zones);
  if (alarm.kind === 'absolute') return zonedToUtc(alarm.at, deviceZone, zones);
  if (occurrence.allDay) {
    if (occurrence.start.minute !== 0) fail('An all-day occurrence starts at T00:00');
    const wall = fromAbsoluteMinutes(toAbsoluteMinutes(occurrence.start) + alarm.offsetMinutes);
    return wall === null ? null : zonedToUtc(wall, deviceZone, zones);
  }
  if (occurrence.startUtc === null) fail('A timed occurrence needs startUtc to place a relative alert');
  return fromAbsoluteMinutes(toAbsoluteMinutes(occurrence.startUtc) + alarm.offsetMinutes);
}

/** `{time}` of the copy catalogue: `09:00`, or `9:00 AM` in 12-hour form. */
function clockLabel(minute: number, use24Hour: boolean): string {
  const hour = Math.floor(minute / 60);
  const minutes = pad(minute % 60, 2);
  if (use24Hour) return `${pad(hour, 2)}:${minutes}`;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minutes} ${hour < 12 ? 'AM' : 'PM'}`;
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** The text of a relative alert (copy catalogue `alert.*`). */
function describeRelative(offset: number, allDay: boolean, use24Hour: boolean): string {
  if (allDay) {
    const days = Math.floor(offset / DAY);
    const time = clockLabel(offset - days * DAY, use24Hour);
    if (days === 0) return `On the day at ${time}`;
    if (days === -7) return `1 week before at ${time}`;
    if (days < 0) return `${count(-days, 'day', 'days')} before at ${time}`;
    return `${count(offset, 'minute', 'minutes')} after`;
  }
  if (offset === 0) return 'At time of event';
  if (offset > 0) return `${count(offset, 'minute', 'minutes')} after`;
  const before = -offset;
  if (before === 7 * DAY) return '1 week before';
  if (before % DAY === 0) return `${count(before / DAY, 'day', 'days')} before`;
  if (before % 60 === 0) return `${count(before / 60, 'hour', 'hours')} before`;
  return `${count(before, 'minute', 'minutes')} before`;
}

function readUse24Hour(bag: Record<string, unknown>, context: string): boolean {
  return readBooleanOption(bag, 'use24Hour', context) ?? true;
}

const TIMED_PRESETS: readonly (readonly [string, number | null])[] = [
  ['none', null],
  ['at-time', 0],
  ['before-5m', -5],
  ['before-10m', -10],
  ['before-15m', -15],
  ['before-30m', -30],
  ['before-1h', -60],
  ['before-2h', -120],
  ['before-1d', -DAY],
  ['before-2d', -2 * DAY],
  ['before-1w', -7 * DAY],
];

const ALL_DAY_PRESETS: readonly (readonly [string, number | null])[] = [
  ['none', null],
  ['day-at-0900', NINE],
  ['before-1d-at-0900', NINE - DAY],
  ['before-2d-at-0900', NINE - 2 * DAY],
  ['before-1w-at-0900', NINE - 7 * DAY],
];

/**
 * The rows of the Alert and Second alert pickers (§2.14), in order:
 *
 * - timed: None, At time of event, 5, 10, 15 and 30 minutes, 1 and 2 hours,
 *   1 and 2 days, 1 week before;
 * - all-day: None, On the day at 09:00, 1 day, 2 days and 1 week before at
 *   09:00 (relative to `T00:00` of the day: `540`, `-900`, `-2340`, `-9540`).
 *
 * `allowAfterStart: false` (Android until gate V14) leaves out "On the day at
 * 09:00", the one preset after an all-day event's start. Labels use
 * `use24Hour` (default `true`: `09:00`; `false`: `9:00 AM`).
 * @throws RangeError for invalid options.
 */
export function alarmPresets(allDay: boolean, options?: { allowAfterStart?: boolean; use24Hour?: boolean }): AlarmPreset[] {
  if (typeof allDay !== 'boolean') fail(`allDay must be a boolean, got ${show(allDay)}`);
  const bag = readOptions(options, ['allowAfterStart', 'use24Hour'], 'alarmPresets');
  const allowAfterStart = readBooleanOption(bag, 'allowAfterStart', 'alarmPresets') ?? true;
  const use24Hour = readUse24Hour(bag, 'alarmPresets');
  return (allDay ? ALL_DAY_PRESETS : TIMED_PRESETS)
    .filter(([, offset]) => allowAfterStart || offset === null || offset <= 0)
    .map(([id, offset]) =>
      offset === null
        ? { id, label: 'None', alarm: null }
        : { id, label: describeRelative(offset, allDay, use24Hour), alarm: { kind: 'relative', offsetMinutes: offset } },
    );
}

/**
 * The text of any alert, for picker rows and the details view (§2.14,
 * copy catalogue `alert.*`): the preset labels of {@link alarmPresets}, and
 * for alerts set by another app `45 minutes before`, `90 minutes before`,
 * `3 hours before`, `14 days before`, `10 minutes after`, all-day
 * `2 days before at 18:30`, and absolute alerts
 * `At 08:00 on Thursday, October 12, 2026` (the date in the 13-month system
 * `systemId`, long style with weekday; `At 08:00 on Year Day 2026`).
 *
 * Two call shapes: the §5.2 listing's `describeAlarm(alarm, allDay, options?)`
 * (absolute alerts in the default system, IFC), and
 * `describeAlarm(alarm, allDay, systemId?, options?)`, with `systemId` before
 * the options as SPEC §4.1 orders it, for absolute alerts in another system.
 * @throws RangeError for an invalid alarm, system or options.
 */
export function describeAlarm(alarm: Alarm, allDay: boolean, options?: { use24Hour?: boolean }): string;
export function describeAlarm(alarm: Alarm, allDay: boolean, systemId?: CalendarSystemId, options?: { use24Hour?: boolean }): string;
export function describeAlarm(
  alarm: Alarm,
  allDay: boolean,
  systemOrOptions?: CalendarSystemId | { use24Hour?: boolean },
  maybeOptions?: { use24Hour?: boolean },
): string {
  assertValidAlarm(alarm);
  if (typeof allDay !== 'boolean') fail(`allDay must be a boolean, got ${show(allDay)}`);
  // The §5.2 shape passes the options third; a system id is a string.
  const optionsThird = isRecord(systemOrOptions);
  if (optionsThird && maybeOptions !== undefined) fail('describeAlarm takes the options once: (alarm, allDay, options) or (alarm, allDay, systemId, options)');
  const systemId = optionsThird || systemOrOptions === undefined ? DEFAULT_SYSTEM_ID : systemOrOptions;
  const options = optionsThird ? systemOrOptions : maybeOptions;
  getCalendarSystem(systemId);
  const use24Hour = readUse24Hour(readOptions(options, ['use24Hour'], 'describeAlarm'), 'describeAlarm');
  if (alarm.kind === 'relative') return describeRelative(alarm.offsetMinutes, allDay, use24Hour);
  const date = formatThirteen(toThirteen(alarm.at.date, systemId), { style: 'long', includeWeekday: true });
  return `At ${clockLabel(alarm.at.minute, use24Hour)} on ${date}`;
}
