/**
 * RFC 5545 §3.3.10 recurrence rules (docs/EVENTS.md §4.3, §4.5, §5.2): the
 * {@link RRule} value, its strict text syntax ({@link parseRRule},
 * {@link formatRRule}), semantic equality ({@link rruleEquals}), the
 * reading of `UNTIL` as a wall-clock end ({@link untilInZone},
 * {@link untilEndDate}) and the writing of an end date as an `UNTIL`
 * ({@link formatUntil}).
 *
 * **Syntax accepted by {@link parseRRule}.** `NAME=VALUE` parts separated by
 * `;`, in any order, with an optional `RRULE:` prefix and one optional trailing
 * `;`. Names and enumerated values (`FREQ`, weekday codes, `SKIP`, the `T` and
 * `Z` of an `UNTIL`) are ASCII case-insensitive (RFC 5545 §3.1); `RSCALE`
 * values and `X-` names are stored uppercase, `X-` values verbatim. Numbers are
 * plain ASCII digits with the RFC's digit counts, signed only where the RFC
 * allows a sign. A `RangeError` is thrown for whitespace, an empty value, a
 * repeated name, an unknown name (other than an `X-` part), a value outside its
 * RFC range, `COUNT` together with `UNTIL`, a missing `FREQ`, `INTERVAL=0` and
 * `COUNT=0`. Combinations the RFC discourages but that are well formed (an
 * ordinal `BYDAY` in a weekly rule, `BYWEEKNO` outside yearly rules, `SKIP`
 * without `RSCALE`) are accepted: expansion and recognition decide what they
 * mean (§4.5, §4.6). `BYMONTH` holds Gregorian months `1…12`, so an RFC 7529
 * leap month (`BYMONTH=5L`) does not parse; such rules stay as stored text on
 * every platform (§4.9).
 *
 * **Minute precision.** Event times have minute precision (§3.3), so an `UNTIL`
 * date-time keeps its minute: seconds are dropped when reading (`165959Z` is
 * 16:59, rounded down) and written as `59`, the end of that minute, which is
 * the form §4.4 writes (`UNTIL=20261231T215959Z`). Every occurrence that starts
 * on a whole minute stays on the same side of the until.
 * @module
 */

import {
  type GregorianDate,
  MIN_JULIAN_DAY_NUMBER,
  addGregorianDays,
  assertValidGregorian,
  isValidGregorian,
  toJulianDayNumber,
} from '../gregorian.ts';
import { fail, isInteger, isRecord, pad, readBooleanOption, readOptions, show } from '../internal.ts';
import { type Weekday, isWeekday } from '../weekday.ts';
import {
  type LocalDateTime,
  type ZoneResolver,
  assertKnownZone,
  assertValidLocalDateTime,
  copyDate,
  copyLocal,
  fromAbsoluteMinutes,
  isValidLocalDateTime,
  toAbsoluteMinutes,
  utcToZoned,
  zonedToUtcAbsolute,
} from './time.ts';

/** `FREQ` values, lowercase. */
export type Frequency = 'secondly' | 'minutely' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/** One `BYDAY` entry: a weekday with an optional ordinal (`2TU` is `{ weekday: 2, ordinal: 2 }`). */
export interface WeekdayNum {
  readonly weekday: Weekday;
  /** `±1…53`, or `null` for every such weekday. */
  readonly ordinal: number | null;
}

/** An `UNTIL` value as written: a date, a floating date-time or a UTC date-time (seconds dropped). */
export type RRuleUntil =
  | { readonly kind: 'date'; readonly date: GregorianDate }
  | { readonly kind: 'floating'; readonly value: LocalDateTime }
  | { readonly kind: 'utc'; readonly value: LocalDateTime };

/** A parsed `RRULE` (or `EXRULE`) value. Lists keep their input order. */
export interface RRule {
  readonly freq: Frequency;
  /** `>= 1`, default 1. */
  readonly interval: number;
  readonly count: number | null;
  /** Never both `count` and `until`. */
  readonly until: RRuleUntil | null;
  readonly bySecond: readonly number[];
  readonly byMinute: readonly number[];
  readonly byHour: readonly number[];
  readonly byDay: readonly WeekdayNum[];
  /** `±1…31`. */
  readonly byMonthDay: readonly number[];
  /** `±1…366`. */
  readonly byYearDay: readonly number[];
  /** `±1…53`. */
  readonly byWeekNo: readonly number[];
  /** `1…12`. */
  readonly byMonth: readonly number[];
  /** `±1…366`. */
  readonly bySetPos: readonly number[];
  readonly wkst: Weekday | null;
  /** RFC 7529 `RSCALE`. */
  readonly rscale: string | null;
  /** RFC 7529 `SKIP`. */
  readonly skip: string | null;
  /** `X-NAME=VALUE` parts, kept in order. */
  readonly extensions: readonly (readonly [string, string])[];
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const FREQUENCIES: readonly Frequency[] = ['secondly', 'minutely', 'hourly', 'daily', 'weekly', 'monthly', 'yearly'];
const WEEKDAY_CODES: readonly string[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const SKIP_VALUES: readonly string[] = ['OMIT', 'BACKWARD', 'FORWARD'];
/** Largest `INTERVAL` and `COUNT`: every port holds them in a 32-bit signed integer. */
const MAX_COUNT = 2_147_483_647;

type NumberListKey = 'bySecond' | 'byMinute' | 'byHour' | 'byMonthDay' | 'byYearDay' | 'byWeekNo' | 'byMonth' | 'bySetPos';

interface NumberListPart {
  readonly key: NumberListKey;
  readonly name: string;
  /** Signed parts are `±1…max` (never 0); unsigned parts are `min…max`. */
  readonly signed: boolean;
  readonly min: number;
  readonly max: number;
  /** The RFC's digit count (`1*2DIGIT`, `1*3DIGIT`). */
  readonly pattern: RegExp;
}

/** The numeric list parts in canonical order; `BYDAY` is written between `BYHOUR` and `BYMONTHDAY`. */
const NUMBER_LISTS: readonly NumberListPart[] = [
  { key: 'bySecond', name: 'BYSECOND', signed: false, min: 0, max: 60, pattern: /^\d{1,2}$/ },
  { key: 'byMinute', name: 'BYMINUTE', signed: false, min: 0, max: 59, pattern: /^\d{1,2}$/ },
  { key: 'byHour', name: 'BYHOUR', signed: false, min: 0, max: 23, pattern: /^\d{1,2}$/ },
  { key: 'byMonthDay', name: 'BYMONTHDAY', signed: true, min: 1, max: 31, pattern: /^[+-]?\d{1,2}$/ },
  { key: 'byYearDay', name: 'BYYEARDAY', signed: true, min: 1, max: 366, pattern: /^[+-]?\d{1,3}$/ },
  { key: 'byWeekNo', name: 'BYWEEKNO', signed: true, min: 1, max: 53, pattern: /^[+-]?\d{1,2}$/ },
  { key: 'byMonth', name: 'BYMONTH', signed: false, min: 1, max: 12, pattern: /^\d{1,2}$/ },
  { key: 'bySetPos', name: 'BYSETPOS', signed: true, min: 1, max: 366, pattern: /^[+-]?\d{1,3}$/ },
];
/** `BYDAY` comes after this many entries of {@link NUMBER_LISTS} (BYSECOND, BYMINUTE, BYHOUR). */
const BYDAY_POSITION = 3;

const NAME = /^[A-Za-z0-9-]+$/;
const RSCALE = /^[A-Z0-9-]+$/;
const X_NAME = /^X-[A-Z0-9-]+$/;
/** An `X-` value: any characters above U+0020 except `;` and U+007F. */
const X_VALUE = /^[^\u0000- ;\u007f]+$/;
const BYDAY_ITEM = /^(?:([+-]?)(\d{1,2}))?([A-Za-z]{2})$/;
const COUNT_TEXT = /^\d{1,10}$/;

// ---------------------------------------------------------------------------
// iCalendar DATE and DATE-TIME text (shared with date-lists.ts and the ics module)
// ---------------------------------------------------------------------------

/** A DATE or DATE-TIME value of iCalendar text, minute precision. @internal */
export type ICalTextValue =
  | { readonly kind: 'date'; readonly date: GregorianDate }
  | { readonly kind: 'local' | 'utc'; readonly value: LocalDateTime };

const ICAL_VALUE = /^(\d{4})(\d{2})(\d{2})(?:[Tt](\d{2})(\d{2})(\d{2})([Zz]?))?$/;

/**
 * Parses `yyyyMMdd`, `yyyyMMddTHHmmss` or `yyyyMMddTHHmmssZ` (RFC 5545 §3.3.4,
 * §3.3.5; `T` and `Z` in either case). Years 0001…9999, hours 00…23, minutes
 * 00…59, seconds 00…60 (a leap second); seconds are dropped. `null` for
 * anything else.
 * @internal
 */
export function parseICalValue(text: string): ICalTextValue | null {
  const match = ICAL_VALUE.exec(text);
  if (match === null) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (!isValidGregorian(date)) return null;
  if (match[4] === undefined) return { kind: 'date', date };
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 60) return null;
  return { kind: match[7] === '' ? 'local' : 'utc', value: { date, minute: hour * 60 + minute } };
}

/** `yyyyMMdd`. Input must be valid. @internal */
export function formatICalDate(date: GregorianDate): string {
  return `${pad(date.year, 4)}${pad(date.month, 2)}${pad(date.day, 2)}`;
}

/** `yyyyMMddTHHmmss`, with `Z` when `utc`. `value.minute` must be `0…1439`. @internal */
export function formatICalDateTime(value: LocalDateTime, seconds: number, utc: boolean): string {
  const time = `${pad(Math.floor(value.minute / 60), 2)}${pad(value.minute % 60, 2)}${pad(seconds, 2)}`;
  return `${formatICalDate(value.date)}T${time}${utc ? 'Z' : ''}`;
}

/** The iCalendar weekday code (`SU`…`SA`) of a valid weekday. @internal */
export function weekdayCode(weekday: Weekday): string {
  return WEEKDAY_CODES[weekday]!;
}

/** The weekday of a code (`SU`…`SA`, ASCII case-insensitive), or `null`. @internal */
export function parseWeekdayCode(text: string): Weekday | null {
  if (!/^[A-Za-z]{2}$/.test(text)) return null;
  const index = WEEKDAY_CODES.indexOf(text.toUpperCase());
  return index < 0 ? null : (index as Weekday);
}

// ---------------------------------------------------------------------------
// Validation and copies
// ---------------------------------------------------------------------------

function untilProblem(value: unknown): string | null {
  if (!isRecord(value)) return `until must be an object, got ${show(value)}`;
  switch (value.kind) {
    case 'date':
      return isValidGregorian(value.date) ? null : `until date must be a valid Gregorian date, got ${show(value.date)}`;
    case 'floating':
    case 'utc':
      return isValidLocalDateTime(value.value) && value.value.minute < 1440
        ? null
        : `until value must be a local date-time with minute 0..1439, got ${show(value.value)}`;
    default:
      return `until kind must be 'date', 'floating' or 'utc', got ${show(value.kind)}`;
  }
}

function countProblem(name: string, value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) return null;
  return isInteger(value) && value >= 1 && value <= MAX_COUNT
    ? null
    : `${name} must be an integer 1..${MAX_COUNT}${nullable ? ' or null' : ''}, got ${show(value)}`;
}

function inListRange(part: NumberListPart, value: number): boolean {
  return part.signed ? value !== 0 && Math.abs(value) <= part.max : value >= part.min && value <= part.max;
}

function listRange(part: NumberListPart): string {
  return part.signed ? `-${part.max}..-1 or 1..${part.max}` : `${part.min}..${part.max}`;
}

function isWeekdayNum(value: unknown): boolean {
  if (!isRecord(value) || !isWeekday(value.weekday)) return false;
  const ordinal = value.ordinal;
  return ordinal === null || (isInteger(ordinal) && ordinal !== 0 && Math.abs(ordinal) <= 53);
}

function isExtension(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'string' &&
    X_NAME.test(value[0]) &&
    X_VALUE.test(value[1])
  );
}

function rruleProblem(value: unknown): string | null {
  if (!isRecord(value)) return `expected an object, got ${show(value)}`;
  if (!FREQUENCIES.includes(value.freq as Frequency)) {
    return `freq must be one of ${FREQUENCIES.join(', ')}, got ${show(value.freq)}`;
  }
  const problem =
    countProblem('interval', value.interval, false) ??
    countProblem('count', value.count, true) ??
    (value.until === null ? null : untilProblem(value.until));
  if (problem !== null) return problem;
  if (value.count !== null && value.until !== null) return 'count and until cannot both be set';
  for (const part of NUMBER_LISTS) {
    const list = value[part.key];
    if (!Array.isArray(list) || !list.every((v) => isInteger(v) && inListRange(part, v))) {
      return `${part.key} must be an array of integers ${listRange(part)}, got ${show(list)}`;
    }
  }
  if (!Array.isArray(value.byDay) || !value.byDay.every(isWeekdayNum)) {
    return `byDay must be an array of { weekday: 0..6, ordinal: -53..-1, 1..53 or null }, got ${show(value.byDay)}`;
  }
  if (value.wkst !== null && !isWeekday(value.wkst)) return `wkst must be a weekday 0..6 or null, got ${show(value.wkst)}`;
  if (value.rscale !== null && !(typeof value.rscale === 'string' && RSCALE.test(value.rscale))) {
    return `rscale must be null or uppercase letters, digits and '-', got ${show(value.rscale)}`;
  }
  if (value.skip !== null && !SKIP_VALUES.includes(value.skip as string)) {
    return `skip must be null or one of ${SKIP_VALUES.join(', ')}, got ${show(value.skip)}`;
  }
  if (!Array.isArray(value.extensions) || !value.extensions.every(isExtension)) {
    return `extensions must be an array of [X-NAME, value] pairs (uppercase name; value without spaces, controls or ';'), got ${show(value.extensions)}`;
  }
  return null;
}

/**
 * Validates an {@link RRule}: every field present, with a value
 * {@link parseRRule} could have produced (ranges, uppercase `rscale`, `skip`
 * and `X-` names, never both `count` and `until`).
 * @throws RangeError with a descriptive message.
 * @internal
 */
export function assertValidRRule(value: unknown, context = 'rrule'): asserts value is RRule {
  const problem = rruleProblem(value);
  if (problem !== null) fail(`Invalid ${context}: ${problem}`);
}

/**
 * Validates an {@link RRuleUntil}.
 * @throws RangeError with a descriptive message.
 * @internal
 */
export function assertValidUntil(value: unknown): asserts value is RRuleUntil {
  const problem = untilProblem(value);
  if (problem !== null) fail(`Invalid UNTIL: ${problem}`);
}

function copyUntil(until: RRuleUntil): RRuleUntil {
  return until.kind === 'date' ? { kind: 'date', date: copyDate(until.date) } : { kind: until.kind, value: copyLocal(until.value) };
}

/** A fresh copy of a valid rule with exactly its documented fields, in declaration order. @internal */
export function copyRRule(rule: RRule): RRule {
  return {
    freq: rule.freq,
    interval: rule.interval,
    count: rule.count,
    until: rule.until === null ? null : copyUntil(rule.until),
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

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parses an `RRULE` (or `EXRULE`) value with the strict grammar of the module
 * documentation. Accepts an optional `RRULE:` prefix (any case) and one
 * trailing `;`; parts may come in any order and any case.
 *
 * `parseRRule('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261116T165959Z')` is a
 * weekly rule on Monday and Wednesday until 2026-11-16T16:59 UTC.
 * @throws RangeError for malformed text, a value outside its RFC range,
 * `COUNT` with `UNTIL`, or a repeated or unknown name.
 */
export function parseRRule(text: string): RRule {
  if (typeof text !== 'string') fail(`RRULE text must be a string, got ${show(text)}`);
  const bad = (why: string): never => fail(`Invalid RRULE ${show(text)}: ${why}`);
  let body = /^RRULE:/i.test(text) ? text.slice(6) : text;
  if (body.endsWith(';')) body = body.slice(0, -1);
  if (body === '') bad('FREQ is required');

  let freq: Frequency | null = null;
  let interval = 1;
  let count: number | null = null;
  let until: RRuleUntil | null = null;
  const lists: Record<NumberListKey, number[]> = {
    bySecond: [],
    byMinute: [],
    byHour: [],
    byMonthDay: [],
    byYearDay: [],
    byWeekNo: [],
    byMonth: [],
    bySetPos: [],
  };
  let byDay: WeekdayNum[] = [];
  let wkst: Weekday | null = null;
  let rscale: string | null = null;
  let skip: string | null = null;
  const extensions: (readonly [string, string])[] = [];
  const seen = new Set<string>();

  const items = (name: string, value: string): string[] => {
    const parts = value.split(',');
    if (parts.includes('')) bad(`${name} has an empty list item`);
    return parts;
  };
  const counter = (name: string, value: string): number => {
    const number = COUNT_TEXT.test(value) ? Number(value) : Number.NaN;
    if (!(number >= 1 && number <= MAX_COUNT)) bad(`${name} must be an integer 1..${MAX_COUNT}, got ${show(value)}`);
    return number;
  };

  for (const part of body.split(';')) {
    const eq = part.indexOf('=');
    const rawName = eq < 0 ? part : part.slice(0, eq);
    if (eq < 0 || !NAME.test(rawName)) bad(`expected NAME=VALUE, got ${show(part)}`);
    const name = rawName.toUpperCase();
    const value = part.slice(eq + 1);
    if (value === '') bad(`${name} has no value`);
    if (seen.has(name)) bad(`${name} appears more than once`);
    seen.add(name);

    const list = NUMBER_LISTS.find((p) => p.name === name);
    if (list !== undefined) {
      lists[list.key] = items(name, value).map((item) => {
        const number = list.pattern.test(item) ? Number(item) : Number.NaN;
        if (!inListRange(list, number)) bad(`${name} values must be ${listRange(list)}, got ${show(item)}`);
        return number;
      });
      continue;
    }
    switch (name) {
      case 'FREQ': {
        const lower = /^[A-Za-z]+$/.test(value) ? value.toLowerCase() : '';
        if (!FREQUENCIES.includes(lower as Frequency)) bad(`unknown FREQ ${show(value)}`);
        freq = lower as Frequency;
        break;
      }
      case 'INTERVAL':
        interval = counter(name, value);
        break;
      case 'COUNT':
        count = counter(name, value);
        break;
      case 'UNTIL': {
        const parsed = parseICalValue(value);
        if (parsed === null) bad(`UNTIL must be yyyyMMdd, yyyyMMddTHHmmss or yyyyMMddTHHmmssZ, got ${show(value)}`);
        until =
          parsed!.kind === 'date'
            ? { kind: 'date', date: parsed!.date }
            : { kind: parsed!.kind === 'utc' ? 'utc' : 'floating', value: parsed!.value };
        break;
      }
      case 'BYDAY':
        byDay = items(name, value).map((item) => {
          const match = BYDAY_ITEM.exec(item);
          const weekday = match === null ? null : parseWeekdayCode(match[3]!);
          const size = match?.[2] === undefined ? null : Number(match[2]);
          if (weekday === null || size === 0 || (size !== null && size > 53)) {
            bad(`BYDAY values must be SU..SA with an optional ordinal -53..-1 or 1..53, got ${show(item)}`);
          }
          return { weekday: weekday!, ordinal: size === null ? null : match![1] === '-' ? -size : size };
        });
        break;
      case 'WKST': {
        const weekday = parseWeekdayCode(value);
        if (weekday === null) bad(`WKST must be SU..SA, got ${show(value)}`);
        wkst = weekday;
        break;
      }
      case 'RSCALE':
        if (!NAME.test(value)) bad(`RSCALE must be letters, digits and '-', got ${show(value)}`);
        rscale = value.toUpperCase();
        break;
      case 'SKIP': {
        const upper = /^[A-Za-z]+$/.test(value) ? value.toUpperCase() : '';
        if (!SKIP_VALUES.includes(upper)) bad(`SKIP must be OMIT, BACKWARD or FORWARD, got ${show(value)}`);
        skip = upper;
        break;
      }
      default:
        if (!X_NAME.test(name)) bad(`unknown part ${name}`);
        if (!X_VALUE.test(value)) bad(`${name} has a space, a control character or ';' in its value`);
        extensions.push([name, value]);
    }
  }
  if (freq === null) bad('FREQ is required');
  if (count !== null && until !== null) bad('COUNT and UNTIL cannot both be present');
  return {
    freq: freq!,
    interval,
    count,
    until,
    bySecond: lists.bySecond,
    byMinute: lists.byMinute,
    byHour: lists.byHour,
    byDay,
    byMonthDay: lists.byMonthDay,
    byYearDay: lists.byYearDay,
    byWeekNo: lists.byWeekNo,
    byMonth: lists.byMonth,
    bySetPos: lists.bySetPos,
    wkst,
    rscale,
    skip,
    extensions,
  };
}

/** Like {@link parseRRule} but returns `null` instead of throwing. */
export function tryParseRRule(text: string): RRule | null {
  try {
    return parseRRule(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** The text of an `UNTIL` value as {@link formatRRule} writes it. */
function untilValueText(until: RRuleUntil): string {
  if (until.kind === 'date') return formatICalDate(until.date);
  return formatICalDateTime(until.value, 59, until.kind === 'utc');
}

/**
 * The canonical text of a rule, without a prefix:
 * `FREQ;INTERVAL (if not 1);COUNT or UNTIL;BYSECOND;BYMINUTE;BYHOUR;BYDAY;
 * BYMONTHDAY;BYYEARDAY;BYWEEKNO;BYMONTH;BYSETPOS;WKST;RSCALE;SKIP;X- parts`.
 * Empty lists are left out, list values keep their stored order, numbers have
 * no leading zeros and no `+`. A date-time `UNTIL` is written with seconds
 * `59` (see the module documentation). `parseRRule(formatRRule(rule))` equals
 * `rule`.
 *
 * `formatRRule(parseRRule('byday=+2tu;freq=monthly;interval=1'))` is
 * `'FREQ=MONTHLY;BYDAY=2TU'`.
 * @throws RangeError for an invalid rule (see {@link assertValidRRule}).
 */
export function formatRRule(rule: RRule): string {
  assertValidRRule(rule);
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.count !== null) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== null) parts.push(`UNTIL=${untilValueText(rule.until)}`);
  NUMBER_LISTS.forEach((list, index) => {
    if (index === BYDAY_POSITION && rule.byDay.length > 0) {
      parts.push(`BYDAY=${rule.byDay.map((d) => `${d.ordinal ?? ''}${weekdayCode(d.weekday)}`).join(',')}`);
    }
    const values = rule[list.key];
    if (values.length > 0) parts.push(`${list.name}=${values.join(',')}`);
  });
  if (rule.wkst !== null) parts.push(`WKST=${weekdayCode(rule.wkst)}`);
  if (rule.rscale !== null) parts.push(`RSCALE=${rule.rscale}`);
  if (rule.skip !== null) parts.push(`SKIP=${rule.skip}`);
  for (const [name, value] of rule.extensions) parts.push(`${name}=${value}`);
  return parts.join(';');
}

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function untilEquals(a: RRuleUntil | null, b: RRuleUntil | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && untilValueText(a) === untilValueText(b);
}

/**
 * `true` when two rules mean the same: equal `freq` and `interval`, equal
 * `count` and `until` (same kind and value), every list compared as a set
 * (order and duplicates ignored; `BYDAY` entries by weekday and ordinal), and
 * the RFC defaults applied: no `WKST` equals `WKST=MO`, no `RSCALE` equals
 * `RSCALE=GREGORIAN` and no `SKIP` equals `SKIP=OMIT` (RFC 7529). `X-` parts
 * are compared as a set of name and value pairs.
 *
 * `ignoreEnd` leaves out `count` and `until`, `ignoreWkst` leaves out `wkst`;
 * recognition compares a marker's encoding with the stored rule with both
 * (§4.5).
 * @throws RangeError for an invalid rule or options.
 */
export function rruleEquals(a: RRule, b: RRule, options?: { ignoreEnd?: boolean; ignoreWkst?: boolean }): boolean {
  assertValidRRule(a, 'first rrule');
  assertValidRRule(b, 'second rrule');
  const opts = readOptions(options, ['ignoreEnd', 'ignoreWkst'], 'rruleEquals');
  const ignoreEnd = readBooleanOption(opts, 'ignoreEnd', 'rruleEquals') ?? false;
  const ignoreWkst = readBooleanOption(opts, 'ignoreWkst', 'rruleEquals') ?? false;
  if (a.freq !== b.freq || a.interval !== b.interval) return false;
  if (!ignoreEnd && (a.count !== b.count || !untilEquals(a.until, b.until))) return false;
  if (!NUMBER_LISTS.every((list) => sameSet(a[list.key], b[list.key]))) return false;
  const dayKeys = (rule: RRule) => rule.byDay.map((d) => `${d.ordinal ?? 0}:${d.weekday}`);
  if (!sameSet(dayKeys(a), dayKeys(b))) return false;
  if (!ignoreWkst && (a.wkst ?? 1) !== (b.wkst ?? 1)) return false;
  if ((a.rscale ?? 'GREGORIAN') !== (b.rscale ?? 'GREGORIAN') || (a.skip ?? 'OMIT') !== (b.skip ?? 'OMIT')) return false;
  const extensionKeys = (rule: RRule) => rule.extensions.map(([name, value]) => `${name}=${value}`);
  return sameSet(extensionKeys(a), extensionKeys(b));
}

// ---------------------------------------------------------------------------
// UNTIL in the event's zone (§4.5)
// ---------------------------------------------------------------------------

/**
 * An `UNTIL` as a wall-clock value in the event's zone (§4.5), rounded down to
 * the minute (seconds were dropped when parsing):
 *
 * - a DATE until becomes `D T24:00`, so it includes its whole day;
 * - a floating until is kept as it is;
 * - a UTC until is converted to `zone` with {@link utcToZoned}. With `zone`
 *   null (a floating or all-day event) its wall clock is kept as it is, as
 *   `ical.js` reads it; a platform that wants the device's zone passes it.
 *
 * `UNTIL=20261116T165959Z` in `Europe/Tallinn` is `2026-11-16T18:59`.
 * @returns the until in the event's zone, or `null` when a UTC until converts
 * to a wall clock outside years 1 to 9999.
 * @throws RangeError for an invalid until, or a `zone` that is empty or not
 * known to `zones`.
 */
export function untilInZone(until: RRuleUntil, zone: string | null, zones: ZoneResolver): LocalDateTime | null {
  assertValidUntil(until);
  if (zone !== null) assertKnownZone(zone, zones);
  if (until.kind === 'date') return { date: copyDate(until.date), minute: 1440 };
  if (until.kind === 'floating' || zone === null) return copyLocal(until.value);
  return utcToZoned(until.value, zone, zones);
}

/**
 * The last original date whose occurrence, starting at `startMinute`, starts at
 * or before `until` (§4.5): `until.date` when `startMinute` is at or before
 * `until.minute`, else the day before. `UNTIL=20261116T165959Z` on a 19:00
 * Tallinn event is 18:59 local, so the end date is November 15 (a weekly
 * Monday series ends on November 9). A DATE until (`D T24:00`) gives `D`.
 * @throws RangeError for an invalid `until` (minute 1440 allowed), a
 * `startMinute` outside `0…1439`, or a result before 0001-01-01.
 */
export function untilEndDate(until: LocalDateTime, startMinute: number): GregorianDate {
  assertValidLocalDateTime(until, 'until');
  if (!isInteger(startMinute) || startMinute < 0 || startMinute > 1439) {
    fail(`Start minute must be an integer 0..1439, got ${show(startMinute)}`);
  }
  if (startMinute <= until.minute) return copyDate(until.date);
  if (toJulianDayNumber(until.date) === MIN_JULIAN_DAY_NUMBER) {
    fail(`No date before 0001-01-01: an occurrence at minute ${startMinute} starts after the until 0001-01-01 minute ${until.minute}`);
  }
  return addGregorianDays(until.date, -1);
}

/** Absolute minute of 9999-12-31T23:59, the last UTC minute an `UNTIL` can name. */
const LAST_UNTIL_ABSOLUTE = toAbsoluteMinutes({ date: { year: 9999, month: 12, day: 31 }, minute: 1439 });

/**
 * The `UNTIL` value text that ends a rule after `endDate`, the end date of
 * {@link untilEndDate} (§4.4 Ends, §4.7 retiming), without the `UNTIL=`:
 *
 * - all-day (`allDay` true; `zone` is ignored): the date, `yyyyMMdd`;
 * - floating (`zone` null): 23:59:59 of `endDate`, `yyyyMMddT235959`;
 * - zoned: the instant of 23:59:59 of `endDate` in `zone` (with the gap
 *   and overlap rule of `zonedToUtc`), as UTC `yyyyMMddTHHmmssZ`. An instant
 *   after 9999-12-31T23:59:59Z (the end of 9999-12-31 west of UTC) is written
 *   as `99991231T235959Z`: no occurrence that can be represented starts later,
 *   so the rule still keeps every one of them.
 *
 * Read back with {@link untilInZone} and {@link untilEndDate}, the value
 * ends the series on `endDate` again. A Tallinn
 * series that ends on November 9, 2026 gets
 * `formatUntil(2026-11-09, false, 'Europe/Tallinn', zones)` =
 * `'20261109T215959Z'`.
 * @throws RangeError for an invalid date or flag, or (timed, zoned) a `zone`
 * that is empty or not known to `zones`.
 */
export function formatUntil(endDate: GregorianDate, allDay: boolean, zone: string | null, zones: ZoneResolver): string {
  assertValidGregorian(endDate);
  if (typeof allDay !== 'boolean') fail(`allDay must be a boolean, got ${show(allDay)}`);
  if (allDay) return formatICalDate(endDate);
  const endOfDay: LocalDateTime = { date: endDate, minute: 1439 };
  if (zone === null) return formatICalDateTime(endOfDay, 59, false);
  assertKnownZone(zone, zones);
  const utc = Math.min(zonedToUtcAbsolute(toAbsoluteMinutes(endOfDay), zone, zones), LAST_UNTIL_ABSOLUTE);
  return formatICalDateTime(fromAbsoluteMinutes(utc)!, 59, true);
}
