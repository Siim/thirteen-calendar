/**
 * Wall-clock date-times for events (docs/EVENTS.md §3.1, §3.1.1, §3.3, §5.2).
 *
 * Every event value in the engine is a **wall-clock** {@link LocalDateTime}
 * with minute precision; the engine holds no time zone database. Platforms
 * answer one question through {@link ZoneResolver} ("which UTC offset is in
 * force at this instant?") and every conversion rule lives here, in
 * {@link zonedToUtc} and {@link utcToZoned}, so all four engines agree on DST
 * gaps, overlaps and the edges of years 1 to 9999.
 *
 * **End-of-day form** (§3.1.1). Ends are exclusive. An end at `D+1 T00:00`
 * that is later than its start is written `D T24:00` (`minute` 1440), which
 * keeps an all-day event on 9999-12-31 inside the supported range and makes the
 * days an occurrence covers simply `start.date … end.date`. Minute 1440 is
 * accepted wherever a value may be an end; {@link compareLocalDateTime}
 * treats `D T24:00` and `D+1 T00:00` as the same moment, and arithmetic never
 * returns 24:00.
 * @module
 */

import {
  type GregorianDate,
  MAX_JULIAN_DAY_NUMBER,
  MIN_JULIAN_DAY_NUMBER,
  assertValidGregorian,
  fromJulianDayNumber,
  isValidGregorian,
  toISODate,
  toJulianDayNumber,
  tryParseISODate,
} from '../gregorian.ts';
import { fail, isInteger, isRecord, pad, show } from '../internal.ts';

/** A wall-clock moment with minute precision. `minute` is 0...1439, or 1440 ("24:00") in an end value. */
export interface LocalDateTime {
  readonly date: GregorianDate;
  /** Minutes after midnight, `0…1439`; `1440` (`T24:00`) only in an end value (§3.1.1). */
  readonly minute: number;
}

/**
 * Answers UTC offsets for IANA zone ids. Implemented per platform (Foundation
 * `TimeZone`, `java.time` `ZoneRules`, `TimeZoneInfo.GetUtcOffset`, `Intl`);
 * every conversion rule lives in core ({@link zonedToUtc}, {@link utcToZoned}).
 */
export interface ZoneResolver {
  /** `true` when the platform has rules for `tzid` (an IANA id such as `Europe/Tallinn`, or `UTC`). */
  isKnown(tzid: string): boolean;
  /**
   * The UTC offset in force at the UTC instant `utc`, in whole minutes east of
   * UTC (Tallinn in summer: `180`; New York in winter: `-300`). Must be an
   * integer between -1439 and 1439; offsets with seconds (local mean time)
   * are truncated toward zero by the resolver. Core only asks about instants
   * from 0001-01-01T00:00 to 9999-12-31T23:59 UTC.
   */
  offsetMinutesAt(tzid: string, utc: LocalDateTime): number;
}

/** Minutes in a day. */
const DAY = 1440;
/** Absolute minute of 0001-01-01T00:00. */
const MIN_ABSOLUTE = MIN_JULIAN_DAY_NUMBER * DAY;
/** Absolute minute of 9999-12-31T23:59, the last plain (non-end) value. */
const MAX_ABSOLUTE = MAX_JULIAN_DAY_NUMBER * DAY + DAY - 1;
/** Absolute minute of 9999-12-31T24:00, the last end value. */
const MAX_END_ABSOLUTE = (MAX_JULIAN_DAY_NUMBER + 1) * DAY;

// ---------------------------------------------------------------------------
// Validation and internal helpers (shared with the other events modules)
// ---------------------------------------------------------------------------

function localProblem(value: unknown, allowEndOfDay: boolean): string | null {
  if (!isRecord(value)) return `expected an object { date, minute }, got ${show(value)}`;
  if (!isValidGregorian(value.date)) return `date must be a valid Gregorian date in years 1..9999, got ${show(value.date)}`;
  const max = allowEndOfDay ? DAY : DAY - 1;
  if (!isInteger(value.minute) || value.minute < 0 || value.minute > max) {
    const note = allowEndOfDay ? '' : ' (24:00 is only allowed in an end)';
    return `minute must be an integer 0..${max}${note}, got ${show(value.minute)}`;
  }
  return null;
}

/**
 * Validates a {@link LocalDateTime}. With `allowEndOfDay` (the default) minute
 * 1440 is accepted; without it only `0…1439`.
 * @throws RangeError naming `context`.
 * @internal
 */
export function assertValidLocalDateTime(
  value: unknown,
  context: string,
  allowEndOfDay = true,
): asserts value is LocalDateTime {
  const problem = localProblem(value, allowEndOfDay);
  if (problem !== null) fail(`Invalid ${context}: ${problem}`);
}

/** `true` when `value` is a valid {@link LocalDateTime} (minute 1440 allowed). @internal */
export function isValidLocalDateTime(value: unknown): value is LocalDateTime {
  return localProblem(value, true) === null;
}

/** A fresh `{ year, month, day }` record. @internal */
export function copyDate(date: GregorianDate): GregorianDate {
  return { year: date.year, month: date.month, day: date.day };
}

/** A fresh copy of a valid {@link LocalDateTime}. @internal */
export function copyLocal(value: LocalDateTime): LocalDateTime {
  return { date: copyDate(value.date), minute: value.minute };
}

/**
 * Minutes since the proleptic Julian Day epoch: a sortable, subtractable key in
 * which `D T24:00` and `D+1 T00:00` are the same number. Input must be valid.
 * @internal
 */
export function toAbsoluteMinutes(value: LocalDateTime): number {
  return toJulianDayNumber(value.date) * DAY + value.minute;
}

/**
 * The plain value (minute `0…1439`) at an absolute minute, or `null` outside
 * 0001-01-01T00:00 … 9999-12-31T23:59.
 * @internal
 */
export function fromAbsoluteMinutes(absolute: number): LocalDateTime | null {
  if (absolute < MIN_ABSOLUTE || absolute > MAX_ABSOLUTE) return null;
  const jdn = Math.floor(absolute / DAY);
  return { date: fromJulianDayNumber(jdn), minute: absolute - jdn * DAY };
}

/**
 * The end value at an absolute minute in end-of-day form: a midnight later
 * than `startAbsolute` is written as 24:00 of the day before. `null` outside
 * 0001-01-01T00:00 … 9999-12-31T24:00.
 * @internal
 */
export function fromAbsoluteEnd(absolute: number, startAbsolute: number): LocalDateTime | null {
  if (absolute < MIN_ABSOLUTE || absolute > MAX_END_ABSOLUTE) return null;
  if (absolute > startAbsolute && absolute % DAY === 0) {
    return { date: fromJulianDayNumber(absolute / DAY - 1), minute: DAY };
  }
  return fromAbsoluteMinutes(absolute);
}

/** Absolute minute of 0001-01-01T00:00, the earliest representable value. @internal */
export const EARLIEST_ABSOLUTE: number = MIN_ABSOLUTE;
/** Absolute minute of 9999-12-31T24:00, the latest representable end. @internal */
export const LATEST_END_ABSOLUTE: number = MAX_END_ABSOLUTE;

/** `HH:MM` for a minute `0…1440` (`24:00` for 1440). */
function clockText(minute: number): string {
  return `${pad(Math.floor(minute / 60), 2)}:${pad(minute % 60, 2)}`;
}

// ---------------------------------------------------------------------------
// Construction, parsing, formatting
// ---------------------------------------------------------------------------

/**
 * Validated constructor: `minute` is `0…1440` (1440 = `T24:00`, for ends).
 * Returns a fresh value that does not alias `date`.
 * @throws RangeError for an invalid date or minute.
 */
export function localDateTime(date: GregorianDate, minute: number): LocalDateTime {
  assertValidGregorian(date);
  if (!isInteger(minute) || minute < 0 || minute > DAY) {
    fail(`Minute must be an integer 0..1440 (1440 = 24:00), got ${show(minute)}`);
  }
  return { date: copyDate(date), minute };
}

const LOCAL_TEXT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/**
 * Parses `YYYY-MM-DDTHH:MM` (years 0001…9999, 24-hour clock, no seconds, no
 * zone designator, no whitespace). `T24:00` is accepted (an end value);
 * `T24:01`, `T25:00`, minutes above 59 and impossible dates are not.
 * @throws RangeError for malformed or impossible text.
 */
export function parseLocalDateTime(text: string): LocalDateTime {
  if (typeof text !== 'string') fail(`Local date-time must be a string, got ${show(text)}`);
  const match = LOCAL_TEXT.exec(text);
  if (!match) fail(`Invalid local date-time ${show(text)}: expected YYYY-MM-DDTHH:MM`);
  const date = tryParseISODate(match[1]!);
  if (date === null) fail(`Invalid local date-time ${show(text)}: ${match[1]} is not a date in years 0001..9999`);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) {
    fail(`Invalid local date-time ${show(text)}: the time must be 00:00..23:59, or 24:00 for an end`);
  }
  return { date, minute: hour * 60 + minute };
}

/** Like {@link parseLocalDateTime} but returns `null` instead of throwing. */
export function tryParseLocalDateTime(text: string): LocalDateTime | null {
  try {
    return parseLocalDateTime(text);
  } catch {
    return null;
  }
}

/** Formats as `YYYY-MM-DDTHH:MM` (`2026-10-19T09:30`; minute 1440 as `T24:00`). */
export function formatLocalDateTime(value: LocalDateTime): string {
  assertValidLocalDateTime(value, 'local date-time');
  return `${toISODate(value.date)}T${clockText(value.minute)}`;
}

// ---------------------------------------------------------------------------
// Comparison and wall-clock arithmetic
// ---------------------------------------------------------------------------

/**
 * Chronological comparator on the wall clock: `-1`, `0` or `1`.
 * `D T24:00` and `D+1 T00:00` compare equal.
 */
export function compareLocalDateTime(a: LocalDateTime, b: LocalDateTime): -1 | 0 | 1 {
  assertValidLocalDateTime(a, 'local date-time');
  assertValidLocalDateTime(b, 'local date-time');
  const delta = toAbsoluteMinutes(a) - toAbsoluteMinutes(b);
  return delta < 0 ? -1 : delta > 0 ? 1 : 0;
}

/**
 * Adds (or subtracts) minutes on the wall clock, ignoring time zones: 23:30
 * plus 60 minutes is 00:30 of the next day. The result is never written as
 * 24:00 (`2026-10-19T24:00` plus 0 is `2026-10-20T00:00`).
 * @throws RangeError for a non-integer `minutes`, or a result outside
 * 0001-01-01T00:00 … 9999-12-31T23:59.
 */
export function addMinutesLocal(value: LocalDateTime, minutes: number): LocalDateTime {
  assertValidLocalDateTime(value, 'local date-time');
  if (!isInteger(minutes)) fail(`Minutes to add must be an integer, got ${show(minutes)}`);
  const result = fromAbsoluteMinutes(toAbsoluteMinutes(value) + minutes);
  if (result === null) {
    fail(`${formatLocalDateTime(value)} plus ${minutes} minutes is outside 0001-01-01T00:00..9999-12-31T23:59`);
  }
  return result;
}

/** Wall-clock difference `a - b` in minutes (`D T24:00` counts as `D+1 T00:00`). */
export function diffMinutesLocal(a: LocalDateTime, b: LocalDateTime): number {
  assertValidLocalDateTime(a, 'local date-time');
  assertValidLocalDateTime(b, 'local date-time');
  return toAbsoluteMinutes(a) - toAbsoluteMinutes(b);
}

// ---------------------------------------------------------------------------
// End-of-day form
// ---------------------------------------------------------------------------

/**
 * Writes an end in end-of-day form (§3.1.1): an end at `D+1 T00:00` that is
 * later than the start becomes `D T24:00`; an end equal to the start (a
 * zero-length event) is written like the start; any other end is returned as
 * is. Always a fresh value.
 * @throws RangeError when `end` is before `start`, or when `start` is 24:00
 * (24:00 is only allowed in an end).
 */
export function normalizeEventEnd(start: LocalDateTime, end: LocalDateTime): LocalDateTime {
  assertValidLocalDateTime(start, 'event start', false);
  assertValidLocalDateTime(end, 'event end');
  const startAbsolute = toAbsoluteMinutes(start);
  const endAbsolute = toAbsoluteMinutes(end);
  if (endAbsolute < startAbsolute) {
    fail(`The end ${formatLocalDateTime(end)} is before the start ${formatLocalDateTime(start)}`);
  }
  if (endAbsolute === startAbsolute) return copyLocal(start);
  return fromAbsoluteEnd(endAbsolute, startAbsolute)!;
}

/**
 * The end as a date picker shows it (§2.12): `D T24:00` becomes `D+1 T00:00`,
 * because no platform time picker can hold 24:00. Other values are returned as
 * a fresh copy. Pickers show all-day ends as their last day instead.
 * @throws RangeError for `9999-12-31T24:00`, whose next day is outside the
 * supported range.
 */
export function displayEnd(end: LocalDateTime): LocalDateTime {
  assertValidLocalDateTime(end, 'event end');
  if (end.minute !== DAY) return copyLocal(end);
  const result = fromAbsoluteMinutes(toAbsoluteMinutes(end));
  if (result === null) fail(`${formatLocalDateTime(end)} has no next day to display (it is the last supported end)`);
  return result;
}

/**
 * Every date an occurrence covers, `start.date` through the date of its
 * end-of-day form, inclusive (§3.1.1). A zero-length event covers its start
 * date; one ending at midnight (`D T24:00` or `D+1 T00:00`) does not cover
 * `D+1`.
 * @throws RangeError as {@link normalizeEventEnd}.
 */
export function occurrenceDays(start: LocalDateTime, end: LocalDateTime): GregorianDate[] {
  const last = normalizeEventEnd(start, end);
  const first = toJulianDayNumber(start.date);
  const days: GregorianDate[] = [];
  for (let jdn = first; jdn <= toJulianDayNumber(last.date); jdn++) days.push(fromJulianDayNumber(jdn));
  return days;
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

/**
 * Validates a zone id and resolver: a non-empty id the resolver knows.
 * @throws RangeError otherwise.
 * @internal
 */
export function assertKnownZone(zone: unknown, zones: unknown): asserts zones is ZoneResolver {
  if (typeof zone !== 'string' || zone === '') fail(`Time zone id must be a non-empty string, got ${show(zone)}`);
  if (!isRecord(zones) || typeof zones.isKnown !== 'function' || typeof zones.offsetMinutesAt !== 'function') {
    fail('zones must be a ZoneResolver with isKnown and offsetMinutesAt');
  }
  if (!(zones as unknown as ZoneResolver).isKnown(zone)) fail(`Unknown time zone ${show(zone)}`);
}

/**
 * The resolver's offset at an absolute UTC minute. The probe instant is kept
 * inside 0001-01-01T00:00 … 9999-12-31T23:59 (the offsets just outside are the
 * same local mean time or far-future rule anyway).
 */
function offsetAt(zones: ZoneResolver, zone: string, absolute: number): number {
  const probe = fromAbsoluteMinutes(Math.min(Math.max(absolute, MIN_ABSOLUTE), MAX_ABSOLUTE))!;
  const offset = zones.offsetMinutesAt(zone, probe);
  if (!isInteger(offset) || offset <= -DAY || offset >= DAY) {
    fail(
      `ZoneResolver.offsetMinutesAt(${show(zone)}, ${formatLocalDateTime(probe)}) must return an integer ` +
        `number of minutes between -1439 and 1439, got ${show(offset)}`,
    );
  }
  return offset === 0 ? 0 : offset; // never -0
}

/** How many instants an {@link OffsetMemo} keeps. */
const MEMO_SIZE = 4;

/**
 * The last few offsets the resolver gave for one zone, by UTC instant, so a
 * caller that converts many nearby times asks once per instant: the probes of
 * a daily series at the same minute meet (one day's `+1 day` probe is the
 * `-1 day` probe two days later), and so do those of a weekly series on
 * Monday, Wednesday and Friday. A resolver answers by the instant alone, so
 * the results are the same as without it.
 * @internal
 */
export interface OffsetMemo {
  readonly zone: string;
  readonly instants: number[];
  readonly offsets: number[];
  slot: number;
}

/** An empty {@link OffsetMemo} for `zone`. @internal */
export function offsetMemo(zone: string): OffsetMemo {
  return { zone, instants: Array.from({ length: MEMO_SIZE }, () => Number.NaN), offsets: Array.from({ length: MEMO_SIZE }, () => 0), slot: 0 };
}

/** {@link offsetAt} through `memo` when it holds `zone`. */
function memoOffsetAt(zones: ZoneResolver, zone: string, absolute: number, memo: OffsetMemo | undefined): number {
  if (memo === undefined || memo.zone !== zone) return offsetAt(zones, zone, absolute);
  const instants = memo.instants;
  for (let i = 0; i < MEMO_SIZE; i++) if (instants[i] === absolute) return memo.offsets[i]!;
  const offset = offsetAt(zones, zone, absolute);
  instants[memo.slot] = absolute;
  memo.offsets[memo.slot] = offset;
  memo.slot = (memo.slot + 1) % MEMO_SIZE;
  return offset;
}

/**
 * Converts a wall-clock value in `zone` to UTC with the rule of §3.3, the same
 * on every platform: a time inside a DST gap moves forward by the gap's length
 * (New York 2026-03-08T02:30 is 07:30Z, which is 03:30 local), and an
 * ambiguous time takes the earlier instant (RFC 5545 §3.3.5).
 *
 * Algorithm (§5.2): with `b` the offset at the UTC instant `local − 1 day` and
 * `a` the offset at `local + 1 day`, the candidates are `local − b` and
 * `local − a`; a candidate `U` is valid when `U + offset(U) = local`. Two
 * valid, different candidates: the earlier. One: it. None (a gap):
 * `local − b`. This assumes at most one transition within two days, which
 * holds for every zone in tzdata.
 *
 * `local` may be an end at 24:00 (`9999-12-31T24:00` in Tallinn is
 * `9999-12-31T22:00` UTC). The result is a plain value (minute `0…1439`).
 * @returns the UTC wall clock, or `null` when it falls outside years 1 to 9999.
 * @throws RangeError for an invalid value, an empty or unknown zone, or a
 * resolver that returns an invalid offset.
 */
export function zonedToUtc(local: LocalDateTime, zone: string, zones: ZoneResolver): LocalDateTime | null {
  assertValidLocalDateTime(local, 'local date-time');
  assertKnownZone(zone, zones);
  return fromAbsoluteMinutes(zonedToUtcAbsolute(toAbsoluteMinutes(local), zone, zones));
}

/**
 * {@link zonedToUtc} on absolute minutes ({@link toAbsoluteMinutes}), without
 * validating the zone (the caller has checked it with {@link assertKnownZone})
 * and without the range check: the result may lie outside years 1 to 9999.
 * @internal
 */
export function zonedToUtcAbsolute(target: number, zone: string, zones: ZoneResolver): number {
  return zonedToUtcSteady(target, zone, zones).utc;
}

/**
 * {@link zonedToUtcAbsolute}, also telling whether the zone's offset is the
 * same at the two probes, the UTC instants `target − 1 day` and `target + 1
 * day`. Then (at most one transition within two days) no transition lies
 * between them, the result is `target − offset`, and `steady` is that offset,
 * in force over the whole span; otherwise `steady` is null. Callers use it to
 * skip resolver calls whose answer is already known, and may pass a `memo`
 * for the same reason.
 * @internal
 */
export function zonedToUtcSteady(
  target: number,
  zone: string,
  zones: ZoneResolver,
  memo?: OffsetMemo,
): { utc: number; steady: number | null } {
  const before = memoOffsetAt(zones, zone, target - DAY, memo);
  const after = memoOffsetAt(zones, zone, target + DAY, memo);
  const early = target - before; // also the gap rule: local − b
  // With equal probes the late candidate is the early one, so the rule below always gives `early`.
  if (before === after) return { utc: early, steady: before };
  const late = target - after;
  const valid = (candidate: number) => candidate + memoOffsetAt(zones, zone, candidate, memo) === target;
  const earlyValid = valid(early);
  const lateValid = valid(late);
  if (earlyValid && lateValid) return { utc: Math.min(early, late), steady: null };
  return { utc: lateValid ? late : early, steady: null };
}

/**
 * {@link utcToZoned} on absolute minutes, without validating the zone and
 * without the range check (`memo` as in {@link zonedToUtcSteady}).
 * @internal
 */
export function utcToZonedAbsolute(instant: number, zone: string, zones: ZoneResolver, memo?: OffsetMemo): number {
  return instant + memoOffsetAt(zones, zone, instant, memo);
}

/**
 * Converts a UTC wall clock to the wall clock of `zone` (UTC plus the offset in
 * force at that instant). `utc` may be an end at 24:00.
 * @returns the zone's wall clock (minute `0…1439`), or `null` when it falls
 * outside years 1 to 9999: `9999-12-31T23:00` UTC is 01:00 on January 1,
 * 10000 in Tallinn (UTC+2), so 18:00 on 9999-12-31 in New York (UTC-5) seen
 * in Tallinn is out of range, while 09:00 there (16:00 in Tallinn) is not.
 * @throws RangeError as {@link zonedToUtc}.
 */
export function utcToZoned(utc: LocalDateTime, zone: string, zones: ZoneResolver): LocalDateTime | null {
  assertValidLocalDateTime(utc, 'UTC date-time');
  assertKnownZone(zone, zones);
  return fromAbsoluteMinutes(utcToZonedAbsolute(toAbsoluteMinutes(utc), zone, zones));
}
