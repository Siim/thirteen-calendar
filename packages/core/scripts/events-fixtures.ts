/**
 * Section builders for `fixtures/events.json` (docs/EVENTS.md §5.5), the golden
 * file the Swift, Kotlin and C# ports test against.
 *
 * Task C1 provides the sections `localDateTimes`, `endForms`, `wallClock`,
 * `zoneMath`, `drafts`, `newDrafts`, `merges`, `seriesEdits` and `alarms`
 * ({@link C1_SECTIONS}), plus the JSON forms of §5.5 for the values they use. Task C2 provides
 * `rrules`, `rruleEquality`, `untils` and `dateLists` ({@link C2_SECTIONS})
 * and the `RRule`, `RRuleUntil` and `DateListValue` JSON forms. Task C3
 * provides `thirteenRules` and `ruleFromStart` ({@link C3_SECTIONS}). Task C6
 * added `seriesEdits` and moved `untils` to real zones (v3.2), and assembles
 * the file (envelope, `tzVersion`, `counts`, `zones`, `zoneOffsets`,
 * serialization) in `events-file.ts` from these builders and those of
 * `recurrence-fixtures.ts` and `layout-fixtures.ts`.
 *
 * Every builder is pure and deterministic. Cases are listed in tables so the
 * counts are exact; expected values come from the engine and are pinned by
 * hand-written assertions in `test/events/`. JSON forms: dates
 * `"YYYY-MM-DD"`, wall-clock times `"YYYY-MM-DDTHH:MM"` (`T24:00` in ends),
 * objects with the fields of their TypeScript type in declaration order, and
 * `null` expected values where the function throws.
 */

import {
  type CalendarSystemId,
  type GregorianDate,
  type IntercalaryDayId,
  type Weekday,
  createMonthDate,
  fromThirteen,
  getCalendarSystem,
  parseISODate,
  toISODate,
} from '../src/index.ts';
import {
  type Alarm,
  type CalendarInfo,
  type DateListForm,
  type DateListValue,
  type DraftField,
  type DraftIssue,
  type EndedRule,
  type EventDraft,
  type EventRecurrence,
  type ExtraDate,
  type Frequency,
  type LocalDateTime,
  type RRule,
  type RRuleUntil,
  type RepeatEnd,
  type RepeatRule,
  type ThirteenRule,
  type ZoneResolver,
  addMinutesLocal,
  alarmPresets,
  applyToSeries,
  displayEnd,
  formatDateList,
  formatLocalDateTime,
  formatRRule,
  formatUntil,
  mergeDraft,
  moveDraftStart,
  newEventDraft,
  normalizeEventEnd,
  occurrenceDays,
  parseDateList,
  parseLocalDateTime,
  parseRRule,
  rruleEquals,
  setDraftAllDay,
  tryParseLocalDateTime,
  tryParseRRule,
  untilEndDate,
  untilInZone,
  utcToZoned,
  validateDraft,
  zonedToUtc,
} from '../src/events/index.ts';
import {
  type RdatePart,
  type ThirteenEncodingForm,
  type ThirteenRuleKind,
  encodeThirteenRule,
  formatDetachedUri,
  formatThirteenRuleText,
  formatThirteenRuleUri,
  thirteenRuleDatesInYear,
  thirteenRuleFor,
  thirteenRuleRdateParts,
  thirteenRuleRdates,
} from '../src/events/thirteen-rules.ts';
import type { OriginalDate } from '../src/events/recurrence.ts';
import { type SyntheticZone, intlZoneResolver, syntheticZoneResolver } from './zone-resolvers.ts';

// ---------------------------------------------------------------------------
// JSON forms (§5.5)
// ---------------------------------------------------------------------------

/** `"YYYY-MM-DD"`. */
export type DateJson = string;
/** `"YYYY-MM-DDTHH:MM"`. */
export type LocalJson = string;
export type AlarmJson = { readonly kind: 'relative'; readonly offsetMinutes: number } | { readonly kind: 'absolute'; readonly at: LocalJson };
export type RepeatEndJson =
  | { readonly kind: 'never' }
  | { readonly kind: 'count'; readonly count: number }
  | { readonly kind: 'until'; readonly date: DateJson };
/** `RRuleUntil` with its date or wall clock as text. */
export type RRuleUntilJson =
  | { readonly kind: 'date'; readonly date: DateJson }
  | { readonly kind: 'floating' | 'utc'; readonly value: LocalJson };
/** `RRule` with every field of §5.2 in declaration order, weekdays as numbers. */
export interface RRuleJson {
  readonly freq: Frequency;
  readonly interval: number;
  readonly count: number | null;
  readonly until: RRuleUntilJson | null;
  readonly bySecond: readonly number[];
  readonly byMinute: readonly number[];
  readonly byHour: readonly number[];
  readonly byDay: readonly { readonly weekday: Weekday; readonly ordinal: number | null }[];
  readonly byMonthDay: readonly number[];
  readonly byYearDay: readonly number[];
  readonly byWeekNo: readonly number[];
  readonly byMonth: readonly number[];
  readonly bySetPos: readonly number[];
  readonly wkst: Weekday | null;
  readonly rscale: string | null;
  readonly skip: string | null;
  readonly extensions: readonly (readonly [string, string])[];
}
/** `DateListValue` with its date or wall clock as text. */
export type DateListValueJson =
  | { readonly kind: 'date'; readonly date: DateJson }
  | { readonly kind: 'utc' | 'floating'; readonly value: LocalJson }
  | { readonly kind: 'zoned'; readonly value: LocalJson; readonly tzid: string };
/** `rrule` values are their canonical `formatRRule` text. */
export type RepeatRuleJson =
  | { readonly kind: 'rrule'; readonly rrule: string }
  | { readonly kind: 'thirteen'; readonly rule: ThirteenRule }
  | { readonly kind: 'dates' }
  | {
      readonly kind: 'foreign';
      readonly rules: readonly { readonly rrule: string; readonly end: RepeatEndJson }[];
      readonly exrules: readonly { readonly rrule: string; readonly end: RepeatEndJson }[];
    };
/** A date string when `minute` and `durationMinutes` are both null. */
export type ExtraDateJson =
  | DateJson
  | { readonly date: DateJson; readonly minute: number | null; readonly durationMinutes: number | null };
/** A date string when `minute` is null. */
export type OriginalDateJson = DateJson | { readonly date: DateJson; readonly minute: number | null };
export interface RecurrenceJson {
  readonly rule: RepeatRuleJson;
  readonly end: RepeatEndJson;
  readonly extraDates: readonly ExtraDateJson[];
  readonly exceptDates: readonly OriginalDateJson[];
}
export interface DraftJson {
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
  readonly availability: EventDraft['availability'];
}
/** `CalendarInfo` holds no dates, so its JSON is the value itself. */
export type CalendarJson = CalendarInfo;

export const dateJson = (date: GregorianDate): DateJson => toISODate(date);
export const dateFromJson = (text: DateJson): GregorianDate => parseISODate(text);
export const localJson = (value: LocalDateTime): LocalJson => formatLocalDateTime(value);
export const localFromJson = (text: LocalJson): LocalDateTime => parseLocalDateTime(text);

export function alarmJson(alarm: Alarm): AlarmJson {
  return alarm.kind === 'relative'
    ? { kind: 'relative', offsetMinutes: alarm.offsetMinutes }
    : { kind: 'absolute', at: localJson(alarm.at) };
}

export function alarmFromJson(json: AlarmJson): Alarm {
  return json.kind === 'relative'
    ? { kind: 'relative', offsetMinutes: json.offsetMinutes }
    : { kind: 'absolute', at: localFromJson(json.at) };
}

export function repeatEndJson(end: RepeatEnd): RepeatEndJson {
  if (end.kind === 'until') return { kind: 'until', date: dateJson(end.date) };
  return end.kind === 'count' ? { kind: 'count', count: end.count } : { kind: 'never' };
}

export function repeatEndFromJson(json: RepeatEndJson): RepeatEnd {
  if (json.kind === 'until') return { kind: 'until', date: dateFromJson(json.date) };
  return json.kind === 'count' ? { kind: 'count', count: json.count } : { kind: 'never' };
}

export function rruleUntilJson(until: RRuleUntil): RRuleUntilJson {
  return until.kind === 'date' ? { kind: 'date', date: dateJson(until.date) } : { kind: until.kind, value: localJson(until.value) };
}

export function rruleUntilFromJson(json: RRuleUntilJson): RRuleUntil {
  return json.kind === 'date' ? { kind: 'date', date: dateFromJson(json.date) } : { kind: json.kind, value: localFromJson(json.value) };
}

export function rruleJson(rule: RRule): RRuleJson {
  return {
    freq: rule.freq,
    interval: rule.interval,
    count: rule.count,
    until: rule.until === null ? null : rruleUntilJson(rule.until),
    bySecond: [...rule.bySecond],
    byMinute: [...rule.byMinute],
    byHour: [...rule.byHour],
    byDay: rule.byDay.map((d) => ({ weekday: d.weekday, ordinal: d.ordinal })),
    byMonthDay: [...rule.byMonthDay],
    byYearDay: [...rule.byYearDay],
    byWeekNo: [...rule.byWeekNo],
    byMonth: [...rule.byMonth],
    bySetPos: [...rule.bySetPos],
    wkst: rule.wkst,
    rscale: rule.rscale,
    skip: rule.skip,
    extensions: rule.extensions.map(([name, value]) => [name, value] as const),
  };
}

export function rruleFromJson(json: RRuleJson): RRule {
  return {
    freq: json.freq,
    interval: json.interval,
    count: json.count,
    until: json.until === null ? null : rruleUntilFromJson(json.until),
    bySecond: [...json.bySecond],
    byMinute: [...json.byMinute],
    byHour: [...json.byHour],
    byDay: json.byDay.map((d) => ({ weekday: d.weekday, ordinal: d.ordinal })),
    byMonthDay: [...json.byMonthDay],
    byYearDay: [...json.byYearDay],
    byWeekNo: [...json.byWeekNo],
    byMonth: [...json.byMonth],
    bySetPos: [...json.bySetPos],
    wkst: json.wkst,
    rscale: json.rscale,
    skip: json.skip,
    extensions: json.extensions.map(([name, value]) => [name, value] as const),
  };
}

export function dateListValueJson(value: DateListValue): DateListValueJson {
  switch (value.kind) {
    case 'date':
      return { kind: 'date', date: dateJson(value.date) };
    case 'zoned':
      return { kind: 'zoned', value: localJson(value.value), tzid: value.tzid };
    default:
      return { kind: value.kind, value: localJson(value.value) };
  }
}

export function dateListValueFromJson(json: DateListValueJson): DateListValue {
  switch (json.kind) {
    case 'date':
      return { kind: 'date', date: dateFromJson(json.date) };
    case 'zoned':
      return { kind: 'zoned', value: localFromJson(json.value), tzid: json.tzid };
    default:
      return { kind: json.kind, value: localFromJson(json.value) };
  }
}

export const endedRuleJson = (rule: EndedRule) => ({ rrule: formatRRule(rule.rrule), end: repeatEndJson(rule.end) });
export const endedRuleFromJson = (json: { readonly rrule: string; readonly end: RepeatEndJson }): EndedRule => ({
  rrule: parseRRule(json.rrule),
  end: repeatEndFromJson(json.end),
});

export function ruleJson(rule: RepeatRule): RepeatRuleJson {
  switch (rule.kind) {
    case 'rrule':
      return { kind: 'rrule', rrule: formatRRule(rule.rrule) };
    case 'thirteen':
      return { kind: 'thirteen', rule: { ...rule.rule } };
    case 'dates':
      return { kind: 'dates' };
    case 'foreign':
      return { kind: 'foreign', rules: rule.rules.map(endedRuleJson), exrules: rule.exrules.map(endedRuleJson) };
  }
}

export function ruleFromJson(json: RepeatRuleJson): RepeatRule {
  switch (json.kind) {
    case 'rrule':
      return { kind: 'rrule', rrule: parseRRule(json.rrule) };
    case 'thirteen':
      return { kind: 'thirteen', rule: { ...json.rule } };
    case 'dates':
      return { kind: 'dates' };
    case 'foreign':
      return { kind: 'foreign', rules: json.rules.map(endedRuleFromJson), exrules: json.exrules.map(endedRuleFromJson) };
  }
}

export function extraDateJson(extra: ExtraDate): ExtraDateJson {
  return extra.minute === null && extra.durationMinutes === null
    ? dateJson(extra.date)
    : { date: dateJson(extra.date), minute: extra.minute, durationMinutes: extra.durationMinutes };
}

export function extraDateFromJson(json: ExtraDateJson): ExtraDate {
  return typeof json === 'string'
    ? { date: dateFromJson(json), minute: null, durationMinutes: null }
    : { date: dateFromJson(json.date), minute: json.minute, durationMinutes: json.durationMinutes };
}

export function originalDateJson(value: OriginalDate): OriginalDateJson {
  return value.minute === null ? dateJson(value.date) : { date: dateJson(value.date), minute: value.minute };
}

export function originalDateFromJson(json: OriginalDateJson): OriginalDate {
  return typeof json === 'string' ? { date: dateFromJson(json), minute: null } : { date: dateFromJson(json.date), minute: json.minute };
}

export function recurrenceJson(recurrence: EventRecurrence): RecurrenceJson {
  return {
    rule: ruleJson(recurrence.rule),
    end: repeatEndJson(recurrence.end),
    extraDates: recurrence.extraDates.map(extraDateJson),
    exceptDates: recurrence.exceptDates.map(originalDateJson),
  };
}

export function recurrenceFromJson(json: RecurrenceJson): EventRecurrence {
  return {
    rule: ruleFromJson(json.rule),
    end: repeatEndFromJson(json.end),
    extraDates: json.extraDates.map(extraDateFromJson),
    exceptDates: json.exceptDates.map(originalDateFromJson),
  };
}

export function draftJson(draft: EventDraft): DraftJson {
  return {
    title: draft.title,
    location: draft.location,
    notes: draft.notes,
    url: draft.url,
    allDay: draft.allDay,
    start: localJson(draft.start),
    end: localJson(draft.end),
    timeZone: draft.timeZone,
    calendarId: draft.calendarId,
    recurrence: draft.recurrence === null ? null : recurrenceJson(draft.recurrence),
    alarms: draft.alarms.map(alarmJson),
    availability: draft.availability,
  };
}

export function draftFromJson(json: DraftJson): EventDraft {
  return {
    title: json.title,
    location: json.location,
    notes: json.notes,
    url: json.url,
    allDay: json.allDay,
    start: localFromJson(json.start),
    end: localFromJson(json.end),
    timeZone: json.timeZone,
    calendarId: json.calendarId,
    recurrence: json.recurrence === null ? null : recurrenceFromJson(json.recurrence),
    alarms: json.alarms.map(alarmFromJson),
    availability: json.availability,
  };
}

export function calendarJson(calendar: CalendarInfo): CalendarJson {
  return {
    id: calendar.id,
    title: calendar.title,
    color: calendar.color,
    accountId: calendar.accountId,
    accountTitle: calendar.accountTitle,
    accountKind: calendar.accountKind,
    writable: calendar.writable,
    thirteenRepeats: calendar.thirteenRepeats,
    maxAlarms: calendar.maxAlarms,
    supportsAvailability: calendar.supportsAvailability,
    supportsUrl: calendar.supportsUrl,
    isPlatformDefault: calendar.isPlatformDefault,
  };
}

// ---------------------------------------------------------------------------
// Section entry shapes (§5.5)
// ---------------------------------------------------------------------------

/** `localDateTimes`: `parseLocalDateTime(text)`; `formatted` is `formatLocalDateTime` of the result. */
export interface LocalDateTimeCase {
  readonly text: string;
  readonly valid: boolean;
  readonly formatted: string | null;
}

/**
 * `endForms`, each field one function of the case's inputs:
 * `normalized` = `normalizeEventEnd(start, end)`, `days` =
 * `occurrenceDays(start, end)`, `display` = `displayEnd(end)`; `null` where it throws.
 */
export interface EndFormCase {
  readonly start: LocalJson;
  readonly end: LocalJson;
  readonly normalized: LocalJson | null;
  readonly days: readonly DateJson[] | null;
  readonly display: LocalJson | null;
}

/** `wallClock`: `addMinutesLocal(from, minutes)`. */
export interface WallClockCase {
  readonly from: LocalJson;
  readonly minutes: number;
  readonly expected: LocalJson | null;
}

/**
 * `zoneMath`: `zonedToUtc(local, zone.name)` or `utcToZoned(utc, zone.name)`
 * with a resolver for the synthetic `zone` table (see `zone-resolvers.ts`).
 */
export type ZoneMathCase =
  | { readonly zone: SyntheticZone; readonly local: LocalJson; readonly expected: LocalJson | null }
  | { readonly zone: SyntheticZone; readonly utc: LocalJson; readonly expected: LocalJson | null };

/**
 * `rrules`: `parseRRule(text)`; `formatted` is `formatRRule` of the result.
 * Both are `null` when the text does not parse.
 */
export interface RRuleCase {
  readonly text: string;
  readonly parsed: RRuleJson | null;
  readonly formatted: string | null;
}

/**
 * `rruleEquality`: `rruleEquals(parseRRule(a), parseRRule(b), { ignoreEnd, ignoreWkst })`.
 * `ignoreWkst` is the second option of §5.2 (recognition passes both, §4.5).
 */
export interface RRuleEqualityCase {
  readonly a: string;
  readonly b: string;
  readonly ignoreEnd: boolean;
  readonly ignoreWkst: boolean;
  readonly equal: boolean;
}

/**
 * `untils`: `inZone` = `untilInZone(until, zone, zones)`; `endDate` =
 * `untilEndDate(inZone, startMinute)`, `null` when `inZone` is null or it
 * throws; `text` = `formatUntil(endDate, allDay, zone, zones)`, `null` when
 * `endDate` is. `zone` is an IANA id (`null`: a floating or all-day event);
 * `zones` is the `zoneOffsets` resolver (§5.5).
 */
export interface UntilCase {
  readonly until: RRuleUntilJson;
  readonly zone: string | null;
  readonly startMinute: number;
  readonly inZone: LocalJson | null;
  readonly endDate: DateJson | null;
  readonly allDay: boolean;
  readonly text: string | null;
}

/**
 * `dateLists`: `parseDateList(text)`; `formatted` is `formatDateList` of the
 * result in `form`. Both are `null` where they throw (a list that mixes kinds
 * parses but has no single form).
 */
export interface DateListCase {
  readonly text: string;
  readonly parsed: readonly DateListValueJson[] | null;
  readonly form: DateListForm;
  readonly formatted: string | null;
}

/** `drafts`: `validateDraft(draft, calendar)`. */
export interface DraftCase {
  readonly draft: DraftJson;
  readonly calendar: CalendarJson;
  readonly issues: readonly DraftIssue[];
}

/**
 * `newDrafts`: `newEventDraft(day, now, NEW_DRAFT_CALENDAR_ID, { allDay })`
 * (no `timeZone` option, so timed drafts are floating).
 */
export interface NewDraftCase {
  readonly day: DateJson;
  readonly now: LocalJson;
  readonly allDay: boolean;
  readonly expected: DraftJson;
}

/** `merges`: `mergeDraft(original, edited, current)`. */
export interface MergeCase {
  readonly original: DraftJson;
  readonly edited: DraftJson;
  readonly current: DraftJson;
  readonly expected: { readonly merged: DraftJson; readonly written: readonly DraftField[]; readonly conflicts: readonly DraftField[] };
}

/** `seriesEdits`: `applyToSeries(master, opened, edited, override)`. */
export interface SeriesEditCase {
  readonly master: DraftJson;
  readonly opened: DraftJson;
  readonly edited: DraftJson;
  readonly override: DraftJson | null;
  readonly expected: {
    readonly master: DraftJson;
    readonly override: DraftJson | null;
    readonly written: readonly DraftField[];
    readonly retime: { readonly minuteDelta: number; readonly allDay: 'to-all-day' | 'to-timed' | null } | null;
  };
}

/** `alarms`: `alarmPresets(allDay, { allowAfterStart, use24Hour })`. */
export interface AlarmPresetsCase {
  readonly allDay: boolean;
  readonly allowAfterStart: boolean;
  readonly use24Hour: boolean;
  readonly presets: readonly { readonly id: string; readonly label: string; readonly alarm: AlarmJson | null }[];
}

// ---------------------------------------------------------------------------
// Shared inputs
// ---------------------------------------------------------------------------

function attempt<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

const L = parseLocalDateTime;
const D = parseISODate;

/** The calendar id every `newDrafts` case passes. */
export const NEW_DRAFT_CALENDAR_ID = 'home';

/** Calendars the `drafts` cases validate against. */
export const FIXTURE_CALENDARS: {
  readonly home: CalendarInfo;
  readonly exchange: CalendarInfo;
  readonly subscribed: CalendarInfo;
  readonly noAlerts: CalendarInfo;
  readonly exchangeReadOnly: CalendarInfo;
} = {
  home: {
    id: 'home',
    title: 'Home',
    color: '#ea580c',
    accountId: 'icloud',
    accountTitle: 'iCloud',
    accountKind: 'icloud',
    writable: true,
    thirteenRepeats: 'all',
    maxAlarms: null,
    supportsAvailability: true,
    supportsUrl: true,
    isPlatformDefault: true,
  },
  exchange: {
    id: 'work',
    title: 'Work',
    color: '#2563eb',
    accountId: 'exchange',
    accountTitle: 'Exchange',
    accountKind: 'exchange',
    writable: true,
    thirteenRepeats: 'gregorian-only',
    maxAlarms: 1,
    supportsAvailability: true,
    supportsUrl: true,
    isPlatformDefault: false,
  },
  subscribed: {
    id: 'holidays',
    title: 'Holidays in Estonia',
    color: '#57534e',
    accountId: 'subscriptions',
    accountTitle: 'Subscriptions',
    accountKind: 'subscribed',
    writable: false,
    thirteenRepeats: 'all',
    maxAlarms: null,
    supportsAvailability: false,
    supportsUrl: true,
    isPlatformDefault: false,
  },
  noAlerts: {
    id: '7',
    title: 'Thirteen',
    color: '#16a34a',
    accountId: 'LOCAL/Thirteen',
    accountTitle: 'Thirteen',
    accountKind: 'device',
    writable: true,
    thirteenRepeats: 'all',
    maxAlarms: 0,
    supportsAvailability: true,
    supportsUrl: false,
    isPlatformDefault: false,
  },
  exchangeReadOnly: {
    id: 'shared',
    title: 'Team (Exchange)',
    color: '#4f46e5',
    accountId: 'exchange',
    accountTitle: 'Exchange',
    accountKind: 'exchange',
    writable: false,
    thirteenRepeats: 'gregorian-only',
    maxAlarms: 1,
    supportsAvailability: true,
    supportsUrl: true,
    isPlatformDefault: false,
  },
};

const never: RepeatEnd = { kind: 'never' };

function thirteen(rule: ThirteenRule, end: RepeatEnd = never): EventRecurrence {
  return { rule: { kind: 'thirteen', rule }, end, extraDates: [], exceptDates: [] };
}
const monthly = (day: number, system: CalendarSystemId = 'ifc'): ThirteenRule => ({ kind: 'monthly', system, day });
const weekly = (weekday: Weekday, interval: 1 | 2 = 1, system: CalendarSystemId = 'ifc'): ThirteenRule => ({
  kind: 'weekly',
  system,
  weekday,
  interval,
});
const yearly = (month: number, day: number, system: CalendarSystemId = 'ifc'): ThirteenRule => ({ kind: 'yearly', system, month, day });
const intercalary = (id: IntercalaryDayId, system: CalendarSystemId = 'ifc'): ThirteenRule => ({ kind: 'intercalary', system, id });
const relative = (offsetMinutes: number): Alarm => ({ kind: 'relative', offsetMinutes });

/** Book club: Cotsworth from the mockup data set (§6.7): 2026-10-19 = IFC October 12, 19:00 to 21:00. */
const BOOK_CLUB: EventDraft = {
  title: 'Book club: Cotsworth',
  location: 'Raamatukoi',
  notes: '',
  url: '',
  allDay: false,
  start: L('2026-10-19T19:00'),
  end: L('2026-10-19T21:00'),
  timeZone: 'Europe/Tallinn',
  calendarId: 'home',
  recurrence: thirteen(monthly(12)),
  alarms: [relative(-60)],
  availability: 'busy',
};

/** Autumn school break (§6.7): all day, October 19 to 25, 2026. */
const SCHOOL_BREAK: EventDraft = {
  title: 'Autumn school break',
  location: '',
  notes: '',
  url: '',
  allDay: true,
  start: L('2026-10-19T00:00'),
  end: L('2026-10-25T24:00'),
  timeZone: null,
  calendarId: 'home',
  recurrence: null,
  alarms: [],
  availability: 'free',
};

/** A single timed event: Dentist, Dr. Tamm (§6.7), 15:40 to 16:20. */
const DENTIST: EventDraft = {
  title: 'Dentist, Dr. Tamm',
  location: 'Tartu mnt 18',
  notes: '',
  url: '',
  allDay: false,
  start: L('2026-10-19T15:40'),
  end: L('2026-10-19T16:20'),
  timeZone: 'Europe/Tallinn',
  calendarId: 'home',
  recurrence: null,
  alarms: [],
  availability: 'busy',
};

/** A single event on `start` (and an end), on another wall clock. */
function at(base: EventDraft, start: string, end: string, extra: Partial<EventDraft> = {}): EventDraft {
  return { ...base, start: L(start), end: L(end), ...extra };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const LOCAL_TEXTS: readonly string[] = [
  '2026-10-19T09:30',
  '2026-10-19T00:00',
  '2026-10-19T23:59',
  '2026-10-19T24:00',
  '2026-10-19T24:01',
  '2026-10-19T25:00',
  '2026-10-19T09:60',
  '2024-02-29T10:00',
  '2026-02-29T10:00',
  '2026-13-01T00:00',
  '2026-00-10T00:00',
  '0001-01-01T00:00',
  '9999-12-31T23:59',
  '9999-12-31T24:00',
  '0000-12-31T00:00',
  '10000-01-01T00:00',
  '2026-10-19T9:30',
  '2026-10-19T09:30:00',
  '2026-10-19T09:30Z',
  '2026-10-19T09:30+03:00',
  '2026-10-19 09:30',
  '2026-10-19t09:30',
  '2026-10-19',
  ' 2026-10-19T09:30',
  '2026-10-19T09:30 ',
  '+2026-10-19T09:30',
  '26-10-19T09:30',
  '2026-10-19T-1:00',
  '',
];

/** `localDateTimes` (§5.5): accepted and rejected texts, `T24:00` accepted (it is a valid end). */
export function buildLocalDateTimes(): LocalDateTimeCase[] {
  return LOCAL_TEXTS.map((text) => {
    const parsed = tryParseLocalDateTime(text);
    return { text, valid: parsed !== null, formatted: parsed === null ? null : formatLocalDateTime(parsed) };
  });
}

const END_FORMS: readonly (readonly [start: string, end: string])[] = [
  ['2026-10-19T09:00', '2026-10-19T10:00'],
  ['2026-10-19T23:00', '2026-10-20T00:00'],
  ['2026-10-19T23:00', '2026-10-19T24:00'],
  ['2026-10-19T09:00', '2026-10-19T24:00'],
  ['2026-10-19T00:00', '2026-10-19T00:00'],
  ['2026-10-19T00:00', '2026-10-18T24:00'],
  ['2026-10-19T09:30', '2026-10-19T09:30'],
  ['2026-10-19T22:00', '2026-10-20T01:30'],
  ['2026-10-19T10:00', '2026-10-22T00:00'],
  ['2026-10-19T00:00', '2026-10-21T24:00'],
  ['2026-10-19T00:00', '2026-10-22T00:00'],
  ['2026-12-31T22:00', '2027-01-01T02:00'],
  ['2024-06-16T20:00', '2024-06-18T08:00'],
  ['9999-12-31T00:00', '9999-12-31T24:00'],
  ['9999-12-31T23:00', '9999-12-31T24:00'],
  ['0001-01-01T00:00', '0001-01-01T00:00'],
  ['2026-10-19T10:00', '2026-10-19T09:00'],
  ['2026-10-19T00:00', '2026-10-18T23:59'],
  ['2026-10-19T24:00', '2026-10-20T01:00'],
];

/** `endForms` (§5.5): end-of-day form, days covered, picker display. */
export function buildEndForms(): EndFormCase[] {
  return END_FORMS.map(([startText, endText]) => {
    const start = L(startText);
    const end = L(endText);
    const normalized = attempt(() => normalizeEventEnd(start, end));
    const days = attempt(() => occurrenceDays(start, end));
    const display = attempt(() => displayEnd(end));
    return {
      start: startText,
      end: endText,
      normalized: normalized === null ? null : localJson(normalized),
      days: days === null ? null : days.map(dateJson),
      display: display === null ? null : localJson(display),
    };
  });
}

const WALL_CLOCK: readonly (readonly [from: string, minutes: number])[] = [
  ['2026-10-19T09:30', 30],
  ['2026-10-19T09:30', 0],
  ['2026-10-19T09:30', -570],
  ['2026-10-19T09:30', -571],
  ['2026-10-19T23:30', 30],
  ['2026-10-19T23:30', 90],
  ['2026-10-19T24:00', 0],
  ['2026-10-19T24:00', 60],
  ['2026-12-30T12:00', 1440],
  ['2026-12-31T12:00', 1440],
  ['2024-06-16T12:00', 1440],
  ['2024-06-17T00:00', 1440],
  ['2024-02-28T23:00', 120],
  ['2026-01-01T00:30', -60],
  ['2026-10-19T09:30', 525_600],
  ['2026-10-19T09:30', 1.5],
  ['9999-12-31T23:00', 59],
  ['9999-12-31T23:00', 60],
  ['9999-12-31T24:00', 0],
  ['0001-01-01T00:30', -30],
  ['0001-01-01T00:30', -31],
];

/** `wallClock` (§5.5): `addMinutesLocal`, across Year Day and Leap Day and the range edges. */
export function buildWallClock(): WallClockCase[] {
  return WALL_CLOCK.map(([from, minutes]) => {
    const result = attempt(() => addMinutesLocal(L(from), minutes));
    return { from, minutes, expected: result === null ? null : localJson(result) };
  });
}

/** Synthetic zones of the `zoneMath` section. */
export const SYNTHETIC_ZONES: {
  readonly europe: SyntheticZone;
  readonly halfHour: SyntheticZone;
  readonly skippedDay: SyntheticZone;
  readonly midnight: SyntheticZone;
  readonly east: SyntheticZone;
  readonly west: SyntheticZone;
} = {
  /** +02:00, +03:00 in summer: a 1-hour spring-forward gap and fall-back overlap (Tallinn 2026). */
  europe: {
    name: 'Test/Europe',
    offset: 120,
    transitions: [
      { at: '2026-03-29T01:00', offset: 180 },
      { at: '2026-10-25T01:00', offset: 120 },
    ],
  },
  /** +10:30, +11:00 from 02:00 local: a 30-minute gap (Lord Howe 2026). */
  halfHour: { name: 'Test/HalfHour', offset: 630, transitions: [{ at: '2026-10-03T15:30', offset: 660 }] },
  /** −10:00, +14:00 from the end of December 29: December 30 never happens (Apia 2011). */
  skippedDay: { name: 'Test/SkippedDay', offset: -600, transitions: [{ at: '2011-12-30T10:00', offset: 840 }] },
  /** −03:00, −02:00 from 00:00 local: midnight is skipped (Sao Paulo 2018); back at midnight in February. */
  midnight: {
    name: 'Test/Midnight',
    offset: -180,
    transitions: [
      { at: '2018-11-04T03:00', offset: -120 },
      { at: '2019-02-17T02:00', offset: -180 },
    ],
  },
  /** +14:00, no transitions: the year 1 edge. */
  east: { name: 'Test/East', offset: 840, transitions: [] },
  /** −12:00, no transitions: the year 9999 edge. */
  west: { name: 'Test/West', offset: -720, transitions: [] },
};

const ZONE_MATH: readonly (readonly [zone: keyof typeof SYNTHETIC_ZONES, direction: 'local' | 'utc', value: string])[] = [
  ['europe', 'local', '2026-07-01T12:00'],
  ['europe', 'local', '2026-03-29T02:59'],
  ['europe', 'local', '2026-03-29T03:00'],
  ['europe', 'local', '2026-03-29T03:30'],
  ['europe', 'local', '2026-03-29T04:00'],
  ['europe', 'local', '2026-10-25T02:59'],
  ['europe', 'local', '2026-10-25T03:00'],
  ['europe', 'local', '2026-10-25T03:30'],
  ['europe', 'local', '2026-10-25T04:00'],
  ['europe', 'local', '2026-10-25T24:00'],
  ['europe', 'utc', '2026-03-29T00:59'],
  ['europe', 'utc', '2026-03-29T01:00'],
  ['europe', 'utc', '2026-10-25T00:30'],
  ['europe', 'utc', '2026-10-25T01:30'],
  ['halfHour', 'local', '2026-10-04T02:15'],
  ['halfHour', 'local', '2026-10-04T02:30'],
  ['halfHour', 'utc', '2026-10-03T15:29'],
  ['halfHour', 'utc', '2026-10-03T15:30'],
  ['skippedDay', 'local', '2011-12-30T09:00'],
  ['skippedDay', 'local', '2011-12-29T23:59'],
  ['skippedDay', 'local', '2011-12-31T00:00'],
  ['skippedDay', 'utc', '2011-12-30T09:59'],
  ['skippedDay', 'utc', '2011-12-30T10:00'],
  ['midnight', 'local', '2018-11-04T00:00'],
  ['midnight', 'local', '2018-11-03T24:00'],
  ['midnight', 'local', '2019-02-16T23:30'],
  ['midnight', 'utc', '2018-11-04T03:00'],
  ['east', 'local', '0001-01-01T13:59'],
  ['east', 'local', '0001-01-01T14:00'],
  ['east', 'utc', '9999-12-31T09:59'],
  ['east', 'utc', '9999-12-31T10:00'],
  ['west', 'local', '9999-12-31T11:59'],
  ['west', 'local', '9999-12-31T12:00'],
  ['west', 'local', '9999-12-31T24:00'],
  ['west', 'utc', '0001-01-01T12:00'],
  ['west', 'utc', '0001-01-01T11:59'],
];

/**
 * `zoneMath` (§5.5): `zonedToUtc` and `utcToZoned` on synthetic zones: a
 * spring-forward gap, a fall-back overlap, a 30-minute gap, a skipped day, a
 * transition at midnight, ends at 24:00, and the year 1 and 9999 edges (null).
 */
export function buildZoneMath(): ZoneMathCase[] {
  return ZONE_MATH.map(([key, direction, text]) => {
    const zone = SYNTHETIC_ZONES[key];
    const resolver = syntheticZoneResolver(zone);
    const value = L(text);
    const result = direction === 'local' ? zonedToUtc(value, zone.name, resolver) : utcToZoned(value, zone.name, resolver);
    const expected = result === null ? null : localJson(result);
    return direction === 'local' ? { zone, local: text, expected } : { zone, utc: text, expected };
  });
}

/** `[draft, calendar]` pairs of the `drafts` section, by what they show. */
function draftInputs(): (readonly [EventDraft, CalendarInfo])[] {
  const { home, exchange, subscribed, noAlerts, exchangeReadOnly } = FIXTURE_CALENDARS;
  const single = { ...BOOK_CLUB, recurrence: null };
  const withUrl = (url: string): readonly [EventDraft, CalendarInfo] => [{ ...DENTIST, url }, home];
  const repeat = (recurrence: EventRecurrence, start: string, end: string, calendar = home): readonly [EventDraft, CalendarInfo] => [
    at(BOOK_CLUB, start, end, { recurrence, alarms: [] }),
    calendar,
  ];
  const allDay = (start: string, end: string, recurrence: EventRecurrence | null): EventDraft =>
    at(SCHOOL_BREAK, start, end, { recurrence });
  return [
    // Valid drafts.
    [BOOK_CLUB, home],
    [SCHOOL_BREAK, home],
    [DENTIST, home],
    [at(DENTIST, '2026-10-19T15:40', '2026-10-19T15:40'), home],
    [at(DENTIST, '2026-10-19T23:00', '2026-10-19T24:00'), home],
    [at(DENTIST, '2026-10-19T23:00', '2026-10-20T00:00'), home],
    [at(DENTIST, '2026-10-19T22:00', '2026-10-20T01:30', { timeZone: null }), home],
    // end-before-start
    [at(DENTIST, '2026-10-19T15:40', '2026-10-19T15:39'), home],
    [allDay('2026-10-19T00:00', '2026-10-18T24:00', null), home],
    [allDay('2026-10-19T00:00', '2026-10-19T00:00', null), home],
    [allDay('2026-10-19T00:00', '2026-10-19T24:00', null), home],
    // out-of-range (§3.1.1)
    [at(DENTIST, '1582-12-31T10:00', '1582-12-31T11:00'), home],
    [at(DENTIST, '1583-01-01T00:00', '1583-01-01T01:00'), home],
    [allDay('1582-10-15T00:00', '1582-10-15T24:00', null), home],
    [at(DENTIST, '9999-12-29T23:00', '9999-12-29T24:00'), home],
    [at(DENTIST, '9999-12-30T09:00', '9999-12-30T10:00'), home],
    [at(DENTIST, '9999-12-29T23:00', '9999-12-30T00:01'), home],
    [allDay('9999-12-31T00:00', '9999-12-31T24:00', null), home],
    [at(DENTIST, '9999-12-31T10:00', '9999-12-31T09:00'), home],
    // until-before-start
    repeat(thirteen(monthly(12), { kind: 'until', date: D('2026-10-18') }), '2026-10-19T19:00', '2026-10-19T21:00'),
    repeat(thirteen(monthly(12), { kind: 'until', date: D('2026-10-19') }), '2026-10-19T19:00', '2026-10-19T21:00'),
    // calendar-read-only
    [single, subscribed],
    // thirteen-repeat-not-allowed (§4.3: only forms a and c are Exchange-safe)
    repeat(thirteen(monthly(12)), '2026-10-19T19:00', '2026-10-19T21:00', exchange),
    repeat(thirteen(weekly(4)), '2026-10-19T19:00', '2026-10-19T21:00', exchange),
    repeat(thirteen(weekly(4, 2)), '2026-10-19T19:00', '2026-10-19T21:00', exchange),
    repeat(thirteen(yearly(11, 12)), '2026-10-19T19:00', '2026-10-19T21:00', exchange),
    repeat(thirteen(yearly(4, 12)), '2026-04-06T19:00', '2026-04-06T21:00', exchange),
    repeat(thirteen(yearly(3, 3)), '2026-02-28T19:00', '2026-02-28T21:00', exchange),
    repeat(thirteen(yearly(3, 4)), '2026-03-01T19:00', '2026-03-01T21:00', exchange),
    repeat(thirteen(yearly(6, 28)), '2026-06-17T19:00', '2026-06-17T21:00', exchange),
    repeat(thirteen(yearly(7, 1)), '2026-06-18T19:00', '2026-06-18T21:00', exchange),
    repeat(thirteen(intercalary('year-day')), '2026-12-31T19:00', '2026-12-31T21:00', exchange),
    repeat(thirteen(intercalary('leap-day')), '2024-06-17T19:00', '2024-06-17T21:00', exchange),
    repeat(thirteen(yearly(3, 3, 'positivist')), '2026-02-28T19:00', '2026-02-28T21:00', exchange),
    repeat(thirteen(yearly(3, 4, 'positivist')), '2026-03-01T19:00', '2026-03-01T21:00', exchange),
    repeat(thirteen(intercalary('year-day', 'positivist')), '2026-12-31T19:00', '2026-12-31T21:00', exchange),
    repeat(thirteen(intercalary('leap-day', 'positivist')), '2024-12-31T19:00', '2024-12-31T21:00', exchange),
    repeat(thirteen(monthly(12)), '2026-10-19T19:00', '2026-10-19T21:00', home),
    [allDay('2026-10-19T00:00', '2026-10-19T24:00', thirteen(monthly(12))), exchange],
    // The drag check of §2.11: an IFC March 3 yearly repeat (form a, which Exchange keeps) dragged to
    // March 4 for future events follows the start and needs form b.
    [
      moveDraftStart(at(BOOK_CLUB, '2026-02-28T19:00', '2026-02-28T21:00', { recurrence: thirteen(yearly(3, 3)) }), L('2026-03-01T19:00'))
        .draft,
      exchange,
    ],
    // too-many-alarms
    [{ ...single, alarms: [relative(-60), relative(-15)] }, exchange],
    [{ ...single, alarms: [relative(-60)] }, exchange],
    [{ ...single, alarms: [relative(-60)] }, noAlerts],
    [{ ...single, alarms: [] }, noAlerts],
    [{ ...single, alarms: [relative(-60), relative(-15), relative(0)] }, home],
    // repeat-not-on-start (§4.2)
    repeat(thirteen(monthly(12)), '2026-10-20T19:00', '2026-10-20T21:00'),
    repeat(thirteen(weekly(4)), '2026-10-20T19:00', '2026-10-20T21:00'),
    repeat(thirteen(weekly(4, 2)), '2026-10-21T19:00', '2026-10-21T21:00'),
    repeat(thirteen(yearly(11, 12)), '2026-10-20T19:00', '2026-10-20T21:00'),
    repeat(thirteen(monthly(28)), '2026-12-31T19:00', '2026-12-31T21:00'),
    repeat(thirteen(intercalary('year-day')), '2026-12-30T19:00', '2026-12-30T21:00'),
    repeat(thirteen(intercalary('leap-day')), '2024-06-18T19:00', '2024-06-18T21:00'),
    repeat(thirteen(monthly(12, 'positivist')), '2024-10-19T19:00', '2024-10-19T21:00'),
    repeat(thirteen(monthly(12)), '2024-10-19T19:00', '2024-10-19T21:00'),
    repeat(thirteen(intercalary('year-day', 'positivist')), '2024-12-30T19:00', '2024-12-30T21:00'),
    repeat({ rule: { kind: 'dates' }, end: never, extraDates: [], exceptDates: [] }, '2026-10-20T19:00', '2026-10-20T21:00'),
    // invalid-url (§2.11)
    withUrl('https://example.com'),
    withUrl('example.com'),
    withUrl('example.com/path?x=1#top'),
    withUrl('zoom.us/j/123456'),
    withUrl('localhost:3000'),
    withUrl('http://intranet/page'),
    withUrl('https://user:secret@example.com:8443/a'),
    withUrl('https://[::1]:8080/'),
    withUrl('https://tähtpäev.ee'),
    withUrl('example'),
    withUrl('http://'),
    withUrl('not a url'),
    withUrl(' https://example.com'),
    withUrl('https://example..com'),
    withUrl('https://example.com:99999'),
    withUrl('javascript:alert(1)'),
    // count-out-of-range
    repeat(thirteen(monthly(12), { kind: 'count', count: 1 }), '2026-10-19T19:00', '2026-10-19T21:00'),
    repeat(thirteen(monthly(12), { kind: 'count', count: 999 }), '2026-10-19T19:00', '2026-10-19T21:00'),
    repeat(thirteen(monthly(12), { kind: 'count', count: 0 }), '2026-10-19T19:00', '2026-10-19T21:00'),
    repeat(thirteen(monthly(12), { kind: 'count', count: 1000 }), '2026-10-19T19:00', '2026-10-19T21:00'),
    repeat(thirteen(monthly(12), { kind: 'count', count: 2.5 }), '2026-10-19T19:00', '2026-10-19T21:00'),
    // Every issue at once, in order.
    [
      at(BOOK_CLUB, '1582-10-20T19:00', '1582-10-20T18:00', {
        recurrence: thirteen(monthly(12), { kind: 'until', date: D('1582-10-19') }),
        alarms: [relative(-60), relative(-15)],
        url: 'example',
      }),
      exchangeReadOnly,
    ],
    [
      at(BOOK_CLUB, '9999-12-30T19:00', '9999-12-30T18:00', {
        recurrence: thirteen(weekly(0), { kind: 'count', count: 0 }),
        alarms: [relative(-60), relative(-15)],
        url: 'http://',
      }),
      exchangeReadOnly,
    ],
  ];
}

/** `drafts` (§5.5): every `DraftIssue` of `validateDraft`, alone and together, and valid drafts. */
export function buildDrafts(): DraftCase[] {
  return draftInputs().map(([draft, calendar]) => ({
    draft: draftJson(draft),
    calendar: calendarJson(calendar),
    issues: validateDraft(draft, calendar),
  }));
}

const NEW_DRAFTS: readonly (readonly [day: string, now: string, allDay: boolean])[] = [
  ['2026-10-19', '2026-10-19T10:20', false],
  ['2026-10-19', '2026-10-19T10:00', false],
  ['2026-10-19', '2026-10-19T00:00', false],
  ['2026-10-19', '2026-10-19T09:41', false],
  ['2026-10-19', '2026-10-19T21:59', false],
  ['2026-10-19', '2026-10-19T22:00', false],
  ['2026-10-19', '2026-10-19T23:00', false],
  ['2026-10-19', '2026-10-19T23:30', false],
  ['2026-10-19', '2026-10-19T23:59', false],
  ['2026-10-20', '2026-10-19T10:20', false],
  ['2026-10-18', '2026-10-19T10:20', false],
  ['2024-06-17', '2026-10-19T09:41', false],
  ['2026-12-31', '2026-12-31T23:30', false],
  ['9999-12-31', '9999-12-31T23:30', false],
  ['0001-01-01', '2026-10-19T09:41', false],
  ['2026-10-19', '2026-10-19T10:20', true],
  ['2026-10-21', '2026-10-19T10:20', true],
  ['2026-12-31', '2026-10-19T10:20', true],
  ['9999-12-31', '9999-12-31T23:30', true],
];

/** `newDrafts` (§5.5): the §2.11 defaults today, on other days, near midnight, all-day, at the range edges. */
export function buildNewDrafts(): NewDraftCase[] {
  return NEW_DRAFTS.map(([day, now, allDay]) => ({
    day,
    now,
    allDay,
    expected: draftJson(newEventDraft(D(day), L(now), NEW_DRAFT_CALENDAR_ID, { allDay })),
  }));
}

/** `[original, edited, current]` triples of the `merges` section. */
function mergeInputs(): (readonly [EventDraft, EventDraft, EventDraft])[] {
  const o = BOOK_CLUB;
  const later = { start: L('2026-10-19T20:00'), end: L('2026-10-19T22:00') };
  return [
    // Nothing changed anywhere.
    [o, o, o],
    // One field changed here: written.
    [o, { ...o, title: 'Book club: The Calendar' }, o],
    // One field changed elsewhere: kept, not written.
    [o, o, { ...o, notes: 'Bring the Cotsworth pamphlet.' }],
    // The same field changed on both sides differently: conflict, the edit wins.
    [o, { ...o, title: 'Book club (moved)' }, { ...o, title: 'Book club: Cotsworth and Comte' }],
    // Both sides made the same change: written, no conflict.
    [o, { ...o, location: 'Rahva Raamat' }, { ...o, location: 'Rahva Raamat' }],
    // A time change here and a notes change elsewhere.
    [o, { ...o, ...later }, { ...o, notes: 'Bring the Cotsworth pamphlet.' }],
    // A recurrence change here and an alert change elsewhere.
    [o, { ...o, recurrence: thirteen(weekly(4)) }, { ...o, alarms: [relative(-15)] }],
    // A recurrence end change here; the same rule elsewhere with another end: conflict.
    [
      o,
      { ...o, recurrence: thirteen(monthly(12), { kind: 'count', count: 10 }) },
      { ...o, recurrence: thirteen(monthly(12), { kind: 'until', date: D('2027-06-30') }) },
    ],
    // Alerts changed on both sides differently: conflict.
    [o, { ...o, alarms: [relative(-60), relative(-1440)] }, { ...o, alarms: [] }],
    // Calendar changed here, Show as elsewhere.
    [o, { ...o, calendarId: 'family' }, { ...o, availability: 'free' }],
    // All-day turned on here (the time group, zone included), location elsewhere.
    [
      o,
      { ...o, allDay: true, start: L('2026-10-19T00:00'), end: L('2026-10-19T24:00'), timeZone: null, availability: 'free' },
      { ...o, location: 'Rahva Raamat' },
    ],
    // URL set to the same value on both sides; Show as changed on both sides differently.
    [
      o,
      { ...o, url: 'https://example.com/club', availability: 'free' },
      { ...o, url: 'https://example.com/club', availability: 'tentative' },
    ],
    // Only the zone changed here; time changed elsewhere: conflict on time.
    [o, { ...o, timeZone: 'America/New_York' }, { ...o, ...later }],
    // A midnight end written as D+1 T00:00 elsewhere is the same moment: not a change.
    [
      at(o, '2026-10-19T23:00', '2026-10-19T24:00'),
      { ...at(o, '2026-10-19T23:00', '2026-10-19T24:00'), title: 'Late club' },
      at(o, '2026-10-19T23:00', '2026-10-20T00:00'),
    ],
    // Several groups on both sides, some overlapping.
    [
      o,
      { ...o, title: 'Book club', location: '', ...later, alarms: [] },
      { ...o, title: 'Book club', notes: 'Room 2', recurrence: null, alarms: [relative(-30)] },
    ],
  ];
}

/** `merges` (§5.5): the three-way merge of §2.11 and §4.9. */
export function buildMerges(): MergeCase[] {
  return mergeInputs().map(([original, edited, current]) => {
    const { merged, written, conflicts } = mergeDraft(original, edited, current);
    return {
      original: draftJson(original),
      edited: draftJson(edited),
      current: draftJson(current),
      expected: { merged: draftJson(merged), written, conflicts },
    };
  });
}

/** A repeat set in another app (§4.5 foreign): the Monday of ISO week 20 every year. */
const WEEK_20: EventRecurrence = {
  rule: { kind: 'foreign', rules: [{ rrule: parseRRule('FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO'), end: never }], exrules: [] },
  end: never,
  extraDates: [],
  exceptDates: [],
};

/** The `seriesEdits` master: a 19:00 Tallinn series from Monday, May 11, 2026 (the first Monday of week 20). */
const BOARD_MEETING: EventDraft = {
  title: 'Board meeting',
  location: 'Room Sol',
  notes: '',
  url: '',
  allDay: false,
  start: L('2026-05-11T19:00'),
  end: L('2026-05-11T20:00'),
  timeZone: 'Europe/Tallinn',
  calendarId: 'work',
  recurrence: WEEK_20,
  alarms: [relative(-15)],
  availability: 'busy',
};

/** The same series all-day, from May 11, 2026. */
const BOARD_DAY: EventDraft = {
  ...BOARD_MEETING,
  title: 'Board day',
  allDay: true,
  start: L('2026-05-11T00:00'),
  end: L('2026-05-11T24:00'),
  timeZone: null,
  availability: 'free',
};

/** `[master, opened, edited, override]` rows of the `seriesEdits` section. */
function seriesEditInputs(): (readonly [EventDraft, EventDraft, EventDraft, EventDraft | null])[] {
  // The 5th occurrence: Monday, May 13, 2030.
  const fifth = at(BOARD_MEETING, '2030-05-13T19:00', '2030-05-13T20:00');
  // An override of it with a time of its own, 20:00 to 21:00 (overrides have no repeat).
  const own = { ...at(BOARD_MEETING, '2030-05-13T20:00', '2030-05-13T21:00'), recurrence: null };
  const day = at(BOARD_DAY, '2030-05-13T00:00', '2030-05-13T24:00');
  return [
    // 19:00 to 19:30 on the 5th occurrence: the master keeps May 11, 2026 and takes 19:30 (minuteDelta 30).
    [BOARD_MEETING, fifth, at(fifth, '2030-05-13T19:30', '2030-05-13T20:30'), null],
    // The same edit on the override at 20:00: the master takes 19:30 as an absolute time, the override 19:30 on its date.
    [BOARD_MEETING, own, at(own, '2030-05-13T19:30', '2030-05-13T20:30'), own],
    // All-day turned on (Show as becomes Free with it).
    [BOARD_MEETING, fifth, setDraftAllDay(fifth, true), null],
    // All-day turned off on an all-day series: 10:00 to 11:00 in Tallinn (Show as becomes Busy with it).
    [BOARD_DAY, day, setDraftAllDay(day, false, { previousTimes: { start: 600, end: 660 }, timeZone: 'Europe/Tallinn' }), null],
    // A length change only: the master ends at 21:15.
    [BOARD_MEETING, fifth, at(fifth, '2030-05-13T19:00', '2030-05-13T21:15'), null],
    // An all-day length change: two days.
    [BOARD_DAY, day, at(day, '2030-05-13T00:00', '2030-05-14T24:00'), null],
    // A zone change only.
    [BOARD_MEETING, fifth, { ...fifth, timeZone: 'Europe/Helsinki' }, null],
    // A later time that crosses midnight: 23:30 to 00:30.
    [BOARD_MEETING, fifth, at(fifth, '2030-05-13T23:30', '2030-05-14T00:30'), null],
    // A title change on the override occurrence: the master and that override get it, each keeps its time.
    [BOARD_MEETING, own, { ...own, title: 'Annual board meeting' }, own],
    // A title change with the time group untouched.
    [BOARD_MEETING, fifth, { ...fifth, title: 'Annual board meeting' }, null],
    // Another app changed the master's notes meanwhile: kept; the location change is written.
    [{ ...BOARD_MEETING, notes: 'Agenda in the shared folder.' }, fifth, { ...fifth, location: 'Room Luna' }, null],
    // Alerts and calendar changed.
    [BOARD_MEETING, fifth, { ...fifth, calendarId: 'home', alarms: [relative(-60)] }, null],
  ];
}

/** `seriesEdits` (§5.5, §4.7): `applyToSeries`, "Save for all events" on a repeat set in another app. */
export function buildSeriesEdits(): SeriesEditCase[] {
  return seriesEditInputs().map(([master, opened, edited, override]) => {
    const result = applyToSeries(master, opened, edited, override);
    return {
      master: draftJson(master),
      opened: draftJson(opened),
      edited: draftJson(edited),
      override: override === null ? null : draftJson(override),
      expected: {
        master: draftJson(result.master),
        override: result.override === null ? null : draftJson(result.override),
        written: result.written,
        retime: result.retime === null ? null : { minuteDelta: result.retime.minuteDelta, allDay: result.retime.allDay },
      },
    };
  });
}

/** `alarms` (§5.5): both kinds, with and without the after-start preset, 12 and 24-hour labels. */
export function buildAlarms(): AlarmPresetsCase[] {
  const cases: AlarmPresetsCase[] = [];
  for (const allDay of [false, true]) {
    for (const allowAfterStart of [true, false]) {
      for (const use24Hour of [true, false]) {
        cases.push({
          allDay,
          allowAfterStart,
          use24Hour,
          presets: alarmPresets(allDay, { allowAfterStart, use24Hour }).map((p) => ({
            id: p.id,
            label: p.label,
            alarm: p.alarm === null ? null : alarmJson(p.alarm),
          })),
        });
      }
    }
  }
  return cases;
}

/**
 * The C1 sections in publication order (§6.0), each with its builder. Task C6
 * calls these to write `fixtures/events.json`.
 */
export const C1_SECTIONS = {
  localDateTimes: buildLocalDateTimes,
  endForms: buildEndForms,
  wallClock: buildWallClock,
  zoneMath: buildZoneMath,
  drafts: buildDrafts,
  newDrafts: buildNewDrafts,
  merges: buildMerges,
  seriesEdits: buildSeriesEdits,
  alarms: buildAlarms,
} as const;

// ---------------------------------------------------------------------------
// C2: rrules, rruleEquality, untils, dateLists
// ---------------------------------------------------------------------------

/**
 * The §4.3 (b) day-of-year list of an IFC rule on `monthDays` in every month
 * (`p` for months 1 to 6, `p - 366` for months 7 to 13), as `BYYEARDAY` text.
 * Written out here so the `rrules` cases do not depend on task C3.
 */
function ifcYearDays(monthDays: readonly number[]): string {
  const values: number[] = [];
  for (let month = 1; month <= 13; month++) {
    for (const day of monthDays) values.push(28 * (month - 1) + day - (month <= 6 ? 0 : 366));
  }
  return values.join(',');
}

/** Every IFC month on the 12th (§4.3 table). */
const IFC_MONTHLY_12 = ifcYearDays([12]);
/** Every IFC week on Thursday: Apple's 52-value weekly list (§4.3 table). */
const IFC_WEEKLY_THURSDAY = ifcYearDays([5, 12, 19, 26]);

const RRULE_TEXTS: readonly string[] = [
  // Every frequency, INTERVAL, COUNT and the three UNTIL forms.
  'FREQ=SECONDLY;COUNT=10',
  'FREQ=MINUTELY;INTERVAL=15',
  'FREQ=HOURLY;INTERVAL=2',
  'FREQ=DAILY',
  'FREQ=WEEKLY',
  'FREQ=MONTHLY',
  'FREQ=YEARLY',
  'FREQ=WEEKLY;INTERVAL=2',
  'FREQ=DAILY;INTERVAL=1',
  'FREQ=DAILY;COUNT=10',
  'FREQ=DAILY;COUNT=2147483647',
  'FREQ=DAILY;INTERVAL=3;UNTIL=20261231',
  'FREQ=WEEKLY;UNTIL=20261116T165959Z',
  'FREQ=WEEKLY;UNTIL=20261116T170000Z',
  'FREQ=WEEKLY;UNTIL=20261116T190000',
  'FREQ=DAILY;UNTIL=20261116t165959z',
  'FREQ=DAILY;UNTIL=20241231T235960Z',
  'FREQ=DAILY;UNTIL=00010101',
  'FREQ=DAILY;UNTIL=99991231T235959Z',
  // BY parts, ordinals, set positions, week numbers, year days.
  'FREQ=DAILY;BYHOUR=9;BYMINUTE=30;BYSECOND=0',
  'FREQ=DAILY;BYHOUR=9,17',
  'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  'FREQ=MONTHLY;BYDAY=-1FR',
  'FREQ=MONTHLY;BYDAY=2TU',
  'FREQ=MONTHLY;BYDAY=+3WE',
  'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
  'FREQ=MONTHLY;BYDAY=SA,SU;BYSETPOS=1',
  'FREQ=MONTHLY;BYMONTHDAY=19',
  'FREQ=MONTHLY;BYMONTHDAY=-1',
  'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1,15',
  'FREQ=MONTHLY;BYMONTHDAY=01',
  'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=19',
  'FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'FREQ=YEARLY;BYMONTH=3,9;BYMONTHDAY=1',
  'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
  'FREQ=YEARLY;BYWEEKNO=1;BYDAY=MO',
  'FREQ=YEARLY;BYWEEKNO=-1,53;BYDAY=53MO,-53SU',
  'FREQ=YEARLY;BYYEARDAY=366',
  'FREQ=YEARLY;BYYEARDAY=-1',
  'FREQ=YEARLY;BYYEARDAY=365',
  `FREQ=YEARLY;BYYEARDAY=${IFC_MONTHLY_12}`,
  `FREQ=YEARLY;BYYEARDAY=${IFC_WEEKLY_THURSDAY}`,
  `FREQ=YEARLY;BYYEARDAY=${IFC_MONTHLY_12};COUNT=13;WKST=SU`,
  'FREQ=YEARLY;INTERVAL=4;UNTIL=20960617',
  'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=29',
  'FREQ=WEEKLY;BYDAY=MO,MO',
  // Discouraged by the RFC but well formed: kept for expansion and recognition to judge.
  'FREQ=WEEKLY;BYDAY=1MO',
  'FREQ=MONTHLY;BYMONTHDAY=31;SKIP=FORWARD',
  // WKST, the RFC 5545 example pair.
  'FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO',
  'FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU',
  // Prefix, case, order, trailing semicolon.
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'rrule:freq=weekly;byday=mo',
  'FREQ=Weekly;ByDay=Mo;wkst=su',
  'BYDAY=MO;FREQ=WEEKLY',
  'COUNT=5;BYMONTHDAY=1;FREQ=MONTHLY;INTERVAL=2',
  'FREQ=DAILY;',
  // Case mapping is ASCII only (a Turkish locale must not turn `i` into a dotted capital).
  'freq=daily;interval=2;wkst=fr',
  // RFC 7529 and extension parts.
  'RSCALE=HEBREW;FREQ=YEARLY;BYMONTHDAY=1',
  'RSCALE=gregorian;FREQ=MONTHLY;BYMONTHDAY=31;SKIP=backward',
  'FREQ=DAILY;X-NAME=1',
  'FREQ=WEEKLY;X-EVOLUTION-ENDDATE=20261116T170000Z;BYDAY=MO;x-lower=Value',
  // Errors.
  '',
  'BYDAY=MO',
  'FREQ=FORTNIGHTLY',
  'FREQ=DAILY;COUNT=3;UNTIL=20261231',
  'FREQ=DAILY;INTERVAL=0',
  'FREQ=DAILY;INTERVAL=-1',
  'FREQ=DAILY;COUNT=0',
  'FREQ=DAILY;COUNT=2147483648',
  'FREQ=DAILY;FREQ=WEEKLY',
  'FREQ=WEEKLY;BYDAY=MO;byday=TU',
  'FREQ=DAILY;FOO=1',
  'EXRULE:FREQ=DAILY',
  'FREQ=DAILY; COUNT=2',
  'FREQ=DAILY;;COUNT=2',
  'FREQ=DAILY;COUNT=',
  'FREQ=MONTHLY;BYMONTHDAY=1,,15',
  'FREQ=MONTHLY;BYMONTHDAY=32',
  'FREQ=MONTHLY;BYMONTHDAY=0',
  'FREQ=YEARLY;BYYEARDAY=367',
  'FREQ=YEARLY;BYWEEKNO=54',
  'FREQ=YEARLY;BYMONTH=13',
  'FREQ=YEARLY;BYMONTH=+3',
  'FREQ=MONTHLY;BYSETPOS=0',
  'FREQ=DAILY;BYHOUR=24',
  'FREQ=DAILY;BYMINUTE=60',
  'FREQ=DAILY;BYSECOND=61',
  'FREQ=WEEKLY;BYDAY=XX',
  'FREQ=MONTHLY;BYDAY=0MO',
  'FREQ=MONTHLY;BYDAY=54MO',
  'FREQ=MONTHLY;BYDAY=+MO',
  'FREQ=WEEKLY;WKST=MON',
  'FREQ=DAILY;UNTIL=20260230',
  'FREQ=DAILY;UNTIL=00001231',
  'FREQ=DAILY;UNTIL=20261116T240000Z',
  'FREQ=DAILY;UNTIL=2026-11-16',
  'FREQ=DAILY;UNTIL=20261116T1659Z',
  'RSCALE=HEBREW;FREQ=YEARLY;BYMONTH=5L;BYMONTHDAY=8;SKIP=FORWARD',
  'FREQ=DAILY;SKIP=SOMETIMES',
  'FREQ=DAILY;X-NAME=a b',
  // Digits are ASCII only (Arabic-Indic digits are not a count).
  'FREQ=DAILY;COUNT=\u0661\u0660',
];

/**
 * `rrules` (§5.5): every part and frequency, the three `UNTIL` forms (seconds
 * dropped; written back as `59`), prefix, case and order, RFC 7529 and `X-`
 * parts, the 13- and 52-value `BYYEARDAY` lists of §4.3, and the errors the
 * spec lists (each `null`).
 */
export function buildRRules(): RRuleCase[] {
  return RRULE_TEXTS.map((text) => {
    const parsed = tryParseRRule(text);
    return { text, parsed: parsed === null ? null : rruleJson(parsed), formatted: parsed === null ? null : formatRRule(parsed) };
  });
}

const RRULE_EQUALITY: readonly (readonly [a: string, b: string, ignoreEnd: boolean, ignoreWkst: boolean])[] = [
  ['FREQ=WEEKLY;BYDAY=MO,WE', 'FREQ=WEEKLY;BYDAY=WE,MO', false, false],
  ['FREQ=WEEKLY;BYDAY=MO', 'FREQ=WEEKLY;BYDAY=MO,MO', false, false],
  ['FREQ=DAILY;BYHOUR=9;BYMINUTE=0', 'FREQ=DAILY;BYMINUTE=0;BYHOUR=9', false, false],
  ['FREQ=DAILY', 'FREQ=DAILY;INTERVAL=1', false, false],
  ['FREQ=DAILY', 'FREQ=DAILY;INTERVAL=2', false, false],
  ['FREQ=DAILY', 'FREQ=WEEKLY', false, false],
  ['FREQ=DAILY;COUNT=5', 'FREQ=DAILY;COUNT=6', false, false],
  ['FREQ=DAILY;COUNT=5', 'FREQ=DAILY;COUNT=6', true, false],
  ['FREQ=DAILY;COUNT=5', 'FREQ=DAILY;UNTIL=20261231', true, false],
  ['FREQ=DAILY', 'FREQ=DAILY;UNTIL=20261231', false, false],
  ['FREQ=DAILY;UNTIL=20261231', 'FREQ=DAILY;UNTIL=20261231T235959Z', false, false],
  ['FREQ=DAILY;UNTIL=20261231T235959Z', 'FREQ=DAILY;UNTIL=20261231T235900Z', false, false],
  ['FREQ=DAILY;UNTIL=20261231T235959Z', 'FREQ=DAILY;UNTIL=20261231T235959', false, false],
  ['FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;WKST=MO', false, false],
  ['FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;WKST=SU', false, false],
  ['FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;WKST=SU', false, true],
  ['FREQ=MONTHLY;BYDAY=1MO', 'FREQ=MONTHLY;BYDAY=MO', false, false],
  ['FREQ=MONTHLY;BYDAY=+1MO', 'FREQ=MONTHLY;BYDAY=1MO', false, false],
  ['FREQ=MONTHLY;BYDAY=-1MO', 'FREQ=MONTHLY;BYDAY=1MO', false, false],
  ['FREQ=MONTHLY;BYMONTHDAY=-1', 'FREQ=MONTHLY;BYMONTHDAY=31', false, false],
  [`FREQ=YEARLY;BYYEARDAY=${IFC_MONTHLY_12}`, `FREQ=YEARLY;BYYEARDAY=${IFC_MONTHLY_12.split(',').reverse().join(',')},12,-18`, false, false],
  [`FREQ=YEARLY;BYYEARDAY=${IFC_MONTHLY_12};COUNT=13`, `FREQ=YEARLY;BYYEARDAY=${IFC_MONTHLY_12};WKST=SU`, true, true],
  [`FREQ=YEARLY;BYYEARDAY=${IFC_MONTHLY_12};COUNT=13`, `FREQ=YEARLY;BYYEARDAY=${IFC_MONTHLY_12};WKST=SU`, true, false],
  [`FREQ=YEARLY;BYYEARDAY=${IFC_WEEKLY_THURSDAY}`, `FREQ=YEARLY;BYYEARDAY=${IFC_MONTHLY_12}`, false, false],
  ['FREQ=YEARLY;BYYEARDAY=12', 'FREQ=YEARLY;BYYEARDAY=-354', false, false],
  ['FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=19', 'FREQ=YEARLY', false, false],
  ['FREQ=DAILY', 'FREQ=DAILY;RSCALE=GREGORIAN', false, false],
  ['FREQ=DAILY;RSCALE=GREGORIAN', 'FREQ=DAILY;RSCALE=HEBREW', false, false],
  ['RSCALE=GREGORIAN;FREQ=MONTHLY;BYMONTHDAY=31', 'RSCALE=GREGORIAN;FREQ=MONTHLY;BYMONTHDAY=31;SKIP=OMIT', false, false],
  ['RSCALE=GREGORIAN;FREQ=MONTHLY;BYMONTHDAY=31', 'RSCALE=GREGORIAN;FREQ=MONTHLY;BYMONTHDAY=31;SKIP=BACKWARD', false, false],
  ['FREQ=DAILY;X-A=1', 'FREQ=DAILY', false, false],
  ['FREQ=DAILY;X-A=1;X-B=2', 'FREQ=DAILY;X-B=2;X-A=1', false, false],
  ['FREQ=DAILY;X-A=1', 'FREQ=DAILY;X-A=2', false, false],
];

/**
 * `rruleEquality` (§5.5): lists as sets (order and duplicates), part order, the
 * `INTERVAL`, `WKST`, `RSCALE` and `SKIP` defaults, ends with and without
 * `ignoreEnd`, `WKST` with and without `ignoreWkst`, ordinals, and the
 * recognition comparison of a 13-value `BYYEARDAY` list (§4.5).
 */
export function buildRRuleEquality(): RRuleEqualityCase[] {
  return RRULE_EQUALITY.map(([a, b, ignoreEnd, ignoreWkst]) => ({
    a,
    b,
    ignoreEnd,
    ignoreWkst,
    equal: rruleEquals(parseRRule(a), parseRRule(b), { ignoreEnd, ignoreWkst }),
  }));
}

const TALLINN = 'Europe/Tallinn';
const NEW_YORK = 'America/New_York';
const KIRITIMATI = 'Pacific/Kiritimati';

/**
 * The `untils` rows: the `UNTIL` value, the event's zone (`null`: floating or
 * all-day), the series' start minute and whether it is all-day.
 */
const UNTILS: readonly (readonly [until: string, zone: string | null, startMinute: number, allDay: boolean])[] = [
  // §4.5: 18:59 local on a 19:00 weekly series ends the day before (the series' last Monday is November 9).
  ['20261116T165959Z', TALLINN, 1140, false],
  // 02:00 local (UTC+2) on a 19:00 event: November 15.
  ['20261116T000000Z', TALLINN, 1140, false],
  // Exactly at the occurrence's start: included.
  ['20261116T170000Z', TALLINN, 1140, false],
  // An end-of-day value, as Thirteen writes it (§4.4).
  ['20261231T215959Z', TALLINN, 1140, false],
  ['20261231T215959Z', TALLINN, 0, false],
  // A DATE until includes its whole day, on a timed and on an all-day series.
  ['20261231', TALLINN, 1439, false],
  ['20261231', null, 0, true],
  // Floating untils are kept as they are.
  ['20261116T185900', TALLINN, 1140, false],
  ['20261116T190000', null, 1140, false],
  // A UTC until on a floating or all-day event: its wall clock as is.
  ['20261116T170000Z', null, 1140, false],
  ['20261116T000000Z', null, 0, true],
  // The event's zone decides: the same UNTIL on a New York and a Tallinn 19:00 event.
  ['20261116T235959Z', NEW_YORK, 1140, false],
  ['20261116T235959Z', TALLINN, 1140, false],
  // New York in summer: the UTC hour of the written end differs from winter.
  ['20260715T225959Z', NEW_YORK, 1140, false],
  ['20260716T035959Z', NEW_YORK, 600, false],
  // Across the spring-forward gap and the fall-back overlap.
  ['20260329T003000Z', TALLINN, 150, false],
  ['20260329T013000Z', TALLINN, 150, false],
  ['20261025T003000Z', TALLINN, 210, false],
  ['20261025T013000Z', TALLINN, 211, false],
  ['20260308T070000Z', NEW_YORK, 180, false],
  // The range edges: a UTC until outside years 1 to 9999 in the event's zone, and the end of 9999-12-31.
  ['99991231T235959Z', KIRITIMATI, 0, false],
  ['00010101T000000Z', NEW_YORK, 0, false],
  ['99991231', KIRITIMATI, 1439, false],
  ['99991231', NEW_YORK, 1439, false],
  ['00010101T003000', null, 60, false],
  ['00010101T010000', null, 60, false],
];

/**
 * `untils` (§5.5): `untilInZone`, `untilEndDate` and `formatUntil` for the
 * §4.5 examples, an until exactly at an occurrence's start, end-of-day, DATE,
 * floating and UTC untils on zoned, floating and all-day events, the same
 * instant in two event zones, New York in winter and summer, DST gaps and
 * overlaps, and the year 1 and 9999 edges. Runs through `zones` (Node's
 * `Intl` by default; the recording resolver when task C6 writes the file, so
 * every port replays it through the `zoneOffsets` table).
 */
export function buildUntils(zones: ZoneResolver = intlZoneResolver()): UntilCase[] {
  return UNTILS.map(([text, zone, startMinute, allDay]) => {
    const until = parseRRule(`FREQ=DAILY;UNTIL=${text}`).until!;
    const inZone = untilInZone(until, zone, zones);
    const endDate = inZone === null ? null : attempt(() => untilEndDate(inZone, startMinute));
    return {
      until: rruleUntilJson(until),
      zone,
      startMinute,
      inZone: inZone === null ? null : localJson(inZone),
      endDate: endDate === null ? null : dateJson(endDate),
      allDay,
      text: endDate === null ? null : formatUntil(endDate, allDay, zone, zones),
    };
  });
}

const DATE_LISTS: readonly (readonly [text: string, form: DateListForm])[] = [
  // The three forms of §4.4 for the same occurrences (19:00 in Tallinn is 17:00 UTC in winter).
  ['20261116,20261214', 'date'],
  ['Europe/Tallinn;20261116T190000,20261214T190000', 'zoned'],
  ['20261116T170000Z,20261214T170000Z', 'utc'],
  ['20261019', 'date'],
  ['00010101,99991231', 'date'],
  ['UTC;20261019,20261116', 'date'],
  // Empty lists.
  ['', 'date'],
  ['', 'zoned'],
  [' \r\n', 'utc'],
  // Whitespace, line breaks, empty values, seconds, lowercase.
  [' 20261019 , 20261116 ', 'date'],
  [' Europe/Tallinn ; 20261116T190000 ,20261214T190000\r\n', 'zoned'],
  ['20261019\r\n20261116\n20261214\r20270111', 'date'],
  ['20261019,,20261116,', 'date'],
  ['Europe/Tallinn;20261116T190030', 'zoned'],
  ['20261116t170000z', 'utc'],
  // Mixed lists as Google writes them back: they parse, but have no single form.
  ['Europe/Tallinn;20261116T190000,20261214T170000Z', 'zoned'],
  ['20261116T170000Z\nEurope/Tallinn;20261214T190000', 'utc'],
  ['Europe/Tallinn;20261116T190000\nAmerica/New_York;20261214T130000', 'zoned'],
  ['20261116T190000', 'zoned'],
  // Bad values.
  ['2026-10-19', 'date'],
  ['20260230', 'date'],
  ['00001231', 'date'],
  ['20261116T1900', 'utc'],
  ['Europe/Tallinn;20261116T250000', 'zoned'],
  [';20261116T190000', 'zoned'],
  // Digits are ASCII only (fullwidth digits are not a date).
  ['\uff12\uff10\uff12\uff16\uff11\uff10\uff11\uff19', 'date'],
];

/**
 * `dateLists` (§5.5): the all-day, `TZID;` and UTC forms, mixed lists as Google
 * writes them back, whitespace and line breaks, empty lists, bad values
 * (`null`), and each form formatted from the same occurrences.
 */
export function buildDateLists(): DateListCase[] {
  return DATE_LISTS.map(([text, form]) => {
    const parsed = attempt(() => parseDateList(text));
    const formatted = parsed === null ? null : attempt(() => formatDateList(parsed, form));
    return { text, parsed: parsed === null ? null : parsed.map(dateListValueJson), form, formatted };
  });
}

/**
 * The C2 sections in publication order (§6.0, between `zoneMath` and
 * `thirteenRules`), each with its builder. Task C6 calls these to write
 * `fixtures/events.json`.
 */
export const C2_SECTIONS = {
  rrules: buildRRules,
  rruleEquality: buildRRuleEquality,
  untils: buildUntils,
  dateLists: buildDateLists,
} as const;

// ---------------------------------------------------------------------------
// C3: thirteenRules, ruleFromStart
// ---------------------------------------------------------------------------

/** `ThirteenRule` JSON is the rule itself (§5.5): its fields in declaration order. */
export type ThirteenRuleJson = ThirteenRule;
/** `RdatePart` with its dates as text. */
export interface RdatePartJson {
  readonly part: number;
  readonly start: DateJson;
  readonly dates: readonly DateJson[];
}

/**
 * `thirteenRules` (§5.5). Each case pins, for one rule and start:
 *
 * - `datesIn`: `thirteenRuleDatesInYear(rule, year, start)` for each listed year
 *   (the rule's own dates, not limited by the start);
 * - `encoding`: `encodeThirteenRule(rule, start)`, the `rrule` as its canonical
 *   `formatRRule` text;
 * - `marker`: `formatThirteenRuleText(rule)` (and `parseThirteenRuleText` back);
 * - `uri`: `formatThirteenRuleUri(rule, end, { series, part })` as `text` (and
 *   `parseThirteenRuleUri` back to the other fields);
 * - `rdates`: `thirteenRuleRdates(rule, start, end, horizon)` with the default
 *   `maxValues` (400);
 * - `parts`: `thirteenRuleRdateParts(rule, start, end, horizon, { maxValues })`, or
 *   `null`;
 * - `detached`: `formatDetachedUri(series, original)` as `text` (and
 *   `parseDetachedUri` back), or `null`. This field is not in the §5.5 list;
 *   it carries the "detached URIs" cases the §5.5 case list asks for.
 */
export interface ThirteenRuleCase {
  readonly rule: ThirteenRuleJson;
  readonly start: DateJson;
  readonly datesIn: readonly { readonly year: number; readonly dates: readonly DateJson[] }[];
  readonly encoding: {
    readonly form: ThirteenEncodingForm;
    readonly rrule: string;
    readonly exchangeSafe: boolean;
    readonly cap: DateJson | null;
  };
  readonly marker: string;
  readonly uri: { readonly end: RepeatEndJson; readonly series: string | null; readonly part: number | null; readonly text: string };
  readonly rdates: { readonly end: RepeatEndJson; readonly horizon: DateJson; readonly dates: readonly DateJson[]; readonly truncated: boolean };
  readonly parts: {
    readonly end: RepeatEndJson;
    readonly horizon: DateJson;
    readonly maxValues: number;
    readonly parts: readonly RdatePartJson[];
  } | null;
  readonly detached: { readonly series: string; readonly original: DateJson; readonly text: string } | null;
}

/** `ruleFromStart` (§5.5): `thirteenRuleFor(kind, start, system)`, `null` when the start cannot carry the kind. */
export interface RuleFromStartCase {
  readonly kind: ThirteenRuleKind;
  readonly start: DateJson;
  readonly system: CalendarSystemId;
  readonly rule: ThirteenRuleJson | null;
}

export const rdatePartJson = (part: RdatePart): RdatePartJson => ({
  part: part.part,
  start: dateJson(part.start),
  dates: part.dates.map(dateJson),
});

/** The series id of the parts cases' marker URIs (a lowercase UUID v4). */
export const FIXTURE_SERIES_ID = '7f1c2a9e-3b4d-4c5e-8f60-718293a4b5c6';

interface ThirteenRuleRow {
  readonly rule: ThirteenRule;
  readonly start: string;
  readonly years: readonly number[];
  /** `rdates` end and horizon; also the URI's end unless `uri` says otherwise. */
  readonly end: RepeatEnd;
  readonly horizon: string;
  readonly uri?: { readonly end?: RepeatEnd; readonly series: string | null; readonly part: number | null };
  readonly parts?: { readonly end: RepeatEnd; readonly horizon: string; readonly maxValues: number };
  readonly detached?: { readonly series: string; readonly original: string };
}

const LAST_DAY = '9999-12-31';
const count = (n: number): RepeatEnd => ({ kind: 'count', count: n });
const until = (iso: string): RepeatEnd => ({ kind: 'until', date: D(iso) });
const startOf = (rule: ThirteenRule, year: number, month: number, day: number): string =>
  toISODate(fromThirteen(createMonthDate(year, month, day, rule.system)));

/**
 * Monthly rules (§5.5): IFC and Positivist days 1, 12 and 28 with starts in
 * 2026 (common), 2028 (leap), 2099, 2100 (not leap) and 9998, each starting in
 * a different 13-month month and ending in a different way.
 */
function monthlyRows(): ThirteenRuleRow[] {
  const starts: readonly (readonly [year: number, month: number, years: readonly number[], end: RepeatEnd, horizon: string])[] = [
    [2026, 1, [2026, 2028], never, '2026-12-31'],
    [2028, 6, [2028, 2029], count(13), LAST_DAY],
    [2099, 13, [2099, 2100], until('2100-03-31'), LAST_DAY],
    [2100, 7, [2100, 2104], never, '2101-06-30'],
    [9998, 12, [9998, 9999], never, LAST_DAY],
  ];
  const rows: ThirteenRuleRow[] = [];
  for (const system of ['ifc', 'positivist'] as const) {
    for (const day of [1, 12, 28]) {
      for (const [year, month, years, end, horizon] of starts) {
        const rule = monthly(day, system);
        // Every IFC month on the 12th from 2026 is the Book club of the mockup set; Android writes it
        // through 2036 ("Saved as a list of dates through 2036", §2.13).
        const bookClub = system === 'ifc' && day === 12 && year === 2026;
        rows.push({ rule, start: startOf(rule, year, month, day), years, end, horizon: bookClub ? '2036-12-31' : horizon });
      }
    }
  }
  return rows;
}

/** Rotating ends for the weekly cases: a count, an until and an endless list with a near horizon. */
function weeklyEnd(weekday: number): { end: RepeatEnd; horizon: string } {
  switch (weekday % 3) {
    case 0:
      return { end: count(5), horizon: LAST_DAY };
    case 1:
      return { end: until('2026-12-31'), horizon: LAST_DAY };
    default:
      return { end: never, horizon: '2026-12-31' };
  }
}

/**
 * Weekly rules (§5.5): IFC and Positivist, every weekday, every week (starting
 * in week 2 of 13-month month 11, IFC October, 2026) and every 2 weeks
 * (starting in week 1 to 4 by weekday, so both fortnight phases occur), plus
 * the phase from days 3 and 17 (IFC Tuesday, Positivist Wednesday) and the
 * repeat picker's "Every 2 IFC weeks on Thursday" from October 19, 2026. The
 * dates of the leap year 2028 are pinned (the start year too for the picker's
 * weekly rule); the `RDATE` lists pin the dates after the start.
 */
function weeklyRows(): ThirteenRuleRow[] {
  const rows: ThirteenRuleRow[] = [];
  const firstDay = (system: CalendarSystemId, weekday: number) =>
    ((weekday - getCalendarSystem(system).weekStartsOn + 7) % 7) + 1;
  for (const interval of [1, 2] as const) {
    for (const system of ['ifc', 'positivist'] as const) {
      for (const weekday of [0, 1, 2, 3, 4, 5, 6] as const) {
        const rule = weekly(weekday, interval, system);
        const week = interval === 1 ? 1 : weekday % 4;
        // Every IFC week on Thursday from October 19, 2026 (§4.3 table) is written through 2029 (§4.4).
        const picker = interval === 1 && system === 'ifc' && weekday === 4;
        const { end, horizon } = picker ? { end: never, horizon: '2029-12-31' } : weeklyEnd(weekday);
        const years = picker ? [2026, 2028] : [2028];
        rows.push({ rule, start: startOf(rule, 2026, 11, firstDay(system, weekday) + 7 * week), years, end, horizon });
      }
    }
  }
  const extra: readonly (readonly [ThirteenRule, number, RepeatEnd, string])[] = [
    [weekly(2, 2, 'ifc'), 3, count(4), LAST_DAY],
    [weekly(3, 2, 'positivist'), 3, until('2027-01-31'), LAST_DAY],
    [weekly(3, 2, 'positivist'), 17, never, '2026-12-31'],
    // Every 2 IFC weeks on Thursday from October 19, 2026, written through 2031 (§4.4).
    [weekly(4, 2, 'ifc'), 12, never, '2031-12-31'],
  ];
  for (const [rule, day, end, horizon] of extra) {
    rows.push({ rule, start: startOf(rule, 2026, 11, day), years: [2028], end, horizon });
  }
  return rows;
}

/**
 * Yearly rules (§5.5): IFC January 1, March 3 (day 59, form a), March 4 (day
 * 60, form b; also from February 29, 2028), April 12 (the §4.3 table), June 28
 * (day 168), Sol 1, October 12 (the repeat picker's example), December 28,
 * Positivist Aristotle 3 and 4 and Bichat 28. Android writes 10 years.
 */
function yearlyRows(): ThirteenRuleRow[] {
  const dates: readonly (readonly [ThirteenRule, number])[] = [
    [yearly(1, 1), 2026],
    [yearly(3, 3), 2026],
    [yearly(3, 4), 2026],
    [yearly(3, 4), 2028],
    [yearly(4, 12), 2026],
    [yearly(6, 28), 2026],
    [yearly(7, 1), 2026],
    [yearly(11, 12), 2026],
    [yearly(13, 28), 2026],
    [yearly(3, 3, 'positivist'), 2026],
    [yearly(3, 4, 'positivist'), 2026],
    [yearly(13, 28, 'positivist'), 2026],
  ];
  return dates.map(([rule, year]) => {
    const yearlyRule = rule as Extract<ThirteenRule, { kind: 'yearly' }>;
    return {
      rule,
      start: startOf(rule, year, yearlyRule.month, yearlyRule.day),
      years: [year, year + 1, year === 2026 ? 2028 : 2032],
      end: never,
      horizon: `${year + 10}-12-31`,
    };
  });
}

/**
 * Intercalary rules (§5.5): IFC Year Day, IFC Leap Day from 2024 (cap 2096),
 * 2096 (cap 2096) and 2104 (cap 2196), Positivist All the Dead (common and
 * leap start) and Holy Women from 2024, and the range edges: Leap Day from 9904
 * (cap 9996), Year Day written through 9999-12-31 and Year Day on 9999-12-31.
 */
function intercalaryRows(): ThirteenRuleRow[] {
  return [
    { rule: intercalary('year-day'), start: '2026-12-31', years: [2026, 2027, 2028], end: never, horizon: '2036-12-31' },
    { rule: intercalary('leap-day'), start: '2024-06-17', years: [2024, 2025, 2028, 2096, 2100, 2104], end: never, horizon: '2036-12-31' },
    { rule: intercalary('leap-day'), start: '2096-06-17', years: [2096, 2100, 2104], end: never, horizon: '2106-12-31' },
    { rule: intercalary('leap-day'), start: '2104-06-17', years: [2104, 2196, 2200, 2204], end: count(3), horizon: LAST_DAY },
    { rule: intercalary('year-day', 'positivist'), start: '2026-12-31', years: [2026, 2027, 2028], end: never, horizon: '2036-12-31' },
    { rule: intercalary('year-day', 'positivist'), start: '2024-12-30', years: [2024, 2025], end: until('2027-12-31'), horizon: LAST_DAY },
    { rule: intercalary('leap-day', 'positivist'), start: '2024-12-31', years: [2024, 2025, 2028], end: until('2040-01-01'), horizon: LAST_DAY },
    { rule: intercalary('leap-day'), start: '9904-06-17', years: [9904, 9996, 9999], end: never, horizon: LAST_DAY },
    { rule: intercalary('year-day'), start: '9990-12-31', years: [9999], end: never, horizon: LAST_DAY },
    { rule: intercalary('year-day'), start: '9999-12-31', years: [9999], end: never, horizon: LAST_DAY },
  ];
}

/**
 * Edge cases (§5.5): rules from 0001-01-01; the 400-value truncation of an
 * endless weekly list; Android parts of a weekly series started in 2020 with the
 * 2029 horizon (two parts), the 2035 horizon (the second part grows to full, a
 * third is appended, the first is identical and the 2029 second part is a
 * prefix of the new one) and a count of 999 (the same two full parts and a
 * longer third), and a monthly series written to 9999-12-31 in parts of 101;
 * marker URIs with `series` and `part`; detached URIs for numeric, Google and
 * Exchange ids and ids that need percent-encoding. With 400 values per part a
 * weekly series from 2020 needs a horizon in 2035 for a third part (802
 * occurrences), which is why §5.5's 2033 horizon is 2035 here.
 */
function edgeRows(): ThirteenRuleRow[] {
  const series2020 = weekly(3, 1);
  const start2020 = startOf(series2020, 2020, 1, 4);
  const partsRow = (
    horizon: string,
    end: RepeatEnd,
    part: number,
    detached: { readonly series: string; readonly original: string },
  ): ThirteenRuleRow => ({
    rule: series2020,
    start: start2020,
    years: [],
    end: count(3),
    horizon: LAST_DAY,
    uri: { end, series: FIXTURE_SERIES_ID, part },
    parts: { end, horizon, maxValues: 400 },
    detached,
  });
  const lastMonthly = monthly(28);
  return [
    { rule: monthly(1), start: '0001-01-01', years: [1, 4], end: count(3), horizon: LAST_DAY },
    { rule: yearly(1, 1, 'positivist'), start: '0001-01-01', years: [1, 2], end: never, horizon: '0010-12-31' },
    { rule: weekly(4, 1), start: '2026-10-19', years: [2026], end: never, horizon: LAST_DAY, uri: { series: FIXTURE_SERIES_ID, part: 1 } },
    partsRow('2029-12-31', never, 2, { series: '4521', original: '2027-09-20' }),
    partsRow('2035-12-31', never, 3, { series: '6h3k2j1g0f9e8d7c6b5a4z3y2x_R20200104T080000', original: '2031-06-28' }),
    partsRow(LAST_DAY, count(999), 3, { series: 'AAMkAGI2TG93/x+Yw==', original: '2039-03-15' }),
    {
      rule: lastMonthly,
      start: startOf(lastMonthly, 9990, 1, 28),
      years: [9990],
      end: count(2),
      horizon: LAST_DAY,
      uri: { series: FIXTURE_SERIES_ID, part: 2 },
      parts: { end: never, horizon: LAST_DAY, maxValues: 100 },
      detached: { series: 'Kalender 7 & \u00dcberweisung', original: '9999-12-30' },
    },
  ];
}

function thirteenRuleCase(row: ThirteenRuleRow): ThirteenRuleCase {
  const start = D(row.start);
  const encoding = encodeThirteenRule(row.rule, start);
  const uriEnd = row.uri?.end ?? row.end;
  const extras = { series: row.uri?.series ?? null, part: row.uri?.part ?? null };
  const rdates = thirteenRuleRdates(row.rule, start, row.end, D(row.horizon));
  return {
    rule: { ...row.rule },
    start: row.start,
    datesIn: row.years.map((year) => ({ year, dates: thirteenRuleDatesInYear(row.rule, year, start).map(dateJson) })),
    encoding: {
      form: encoding.form,
      rrule: formatRRule(encoding.rrule),
      exchangeSafe: encoding.exchangeSafe,
      cap: encoding.cap === null ? null : dateJson(encoding.cap),
    },
    marker: formatThirteenRuleText(row.rule),
    uri: { end: repeatEndJson(uriEnd), ...extras, text: formatThirteenRuleUri(row.rule, uriEnd, extras) },
    rdates: { end: repeatEndJson(row.end), horizon: row.horizon, dates: rdates.dates.map(dateJson), truncated: rdates.truncated },
    parts:
      row.parts === undefined
        ? null
        : {
            end: repeatEndJson(row.parts.end),
            horizon: row.parts.horizon,
            maxValues: row.parts.maxValues,
            parts: thirteenRuleRdateParts(row.rule, start, row.parts.end, D(row.parts.horizon), {
              maxValues: row.parts.maxValues,
            }).map(rdatePartJson),
          },
    detached:
      row.detached === undefined
        ? null
        : { ...row.detached, text: formatDetachedUri(row.detached.series, D(row.detached.original)) },
  };
}

/**
 * `thirteenRules` (§5.5): monthly, weekly, every 2 weeks, yearly and
 * intercalary rules of both systems with their dates, encodings (forms a to c),
 * markers, URIs, `RDATE` lists (form d) with every kind of end, the 400-value
 * truncation, Android parts and detached URIs.
 */
export function buildThirteenRules(): ThirteenRuleCase[] {
  return [...monthlyRows(), ...weeklyRows(), ...yearlyRows(), ...intercalaryRows(), ...edgeRows()].map(thirteenRuleCase);
}

const RULE_FROM_START: readonly (readonly [start: string, system: CalendarSystemId])[] = [
  // A month day in both systems: IFC Thursday, October 12 and Positivist Friday, Descartes 12.
  ['2026-10-19', 'ifc'],
  ['2026-10-19', 'positivist'],
  // Year Day (IFC) and All the Dead (Positivist) in a common year.
  ['2026-12-31', 'ifc'],
  ['2026-12-31', 'positivist'],
  // IFC Leap Day; Positivist All the Dead and Holy Women in a leap year.
  ['2024-06-17', 'ifc'],
  ['2024-12-30', 'positivist'],
  ['2024-12-31', 'positivist'],
  // The range edges.
  ['0001-01-01', 'ifc'],
  ['9999-12-31', 'positivist'],
];

/**
 * `ruleFromStart` (§5.5): every kind from a month day in both systems, from
 * Year Day, Leap Day, All the Dead and Holy Women (only the intercalary kind
 * gives a rule), and from the first and last supported days.
 */
export function buildRuleFromStart(): RuleFromStartCase[] {
  const kinds: readonly ThirteenRuleKind[] = ['monthly', 'weekly', 'biweekly', 'yearly', 'intercalary'];
  return RULE_FROM_START.flatMap(([start, system]) =>
    kinds.map((kind) => {
      const rule = thirteenRuleFor(kind, D(start), system);
      return { kind, start, system, rule: rule === null ? null : { ...rule } };
    }),
  );
}

/**
 * The C3 sections in publication order (§6.0, between `dateLists` and
 * `expansions`), each with its builder. Task C6 calls these to write
 * `fixtures/events.json`.
 */
export const C3_SECTIONS = {
  thirteenRules: buildThirteenRules,
  ruleFromStart: buildRuleFromStart,
} as const;
