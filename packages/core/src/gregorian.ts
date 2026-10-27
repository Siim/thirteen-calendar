/**
 * Proleptic Gregorian calendar arithmetic for years `1…9999` (SPEC §1.4).
 *
 * Dates are plain immutable-by-convention `{ year, month, day }` records with
 * 1-based months and days. Every function validates its input and throws a
 * `RangeError` for invalid dates or out-of-range years; nothing clamps.
 * Results are always fresh objects (never the caller's input).
 * The only `Date` interop lives in {@link fromJSDate} / {@link toJSDate}.
 *
 * Naming (SPEC §4): functions that take a `GregorianDate` are prefixed
 * `gregorian…` / `…Gregorian…` (`gregorianWeekday`, `addGregorianDays`), mirroring
 * the `thirteen…` functions. Year-level helpers shared by every system
 * (`isLeapYear`, `daysInYear`) are unprefixed.
 * @module
 */

import { fail, isInteger, isRecord, namesForStyle, pad, show } from './internal.ts';
import { type NameStyle, type Weekday, toWeekday } from './weekday.ts';

/** First supported (proleptic Gregorian) year. */
export const MIN_YEAR = 1;
/** Last supported year. */
export const MAX_YEAR = 9999;

/** A calendar date in the proleptic Gregorian calendar. */
export interface GregorianDate {
  /** Year, `1…9999`. */
  readonly year: number;
  /** Month, `1…12` (1 = January). */
  readonly month: number;
  /** Day of month, `1…daysInGregorianMonth(year, month)`. */
  readonly day: number;
}

/** Static information about one Gregorian month. */
export interface GregorianMonthInfo {
  /** Month number, `1…12`. */
  readonly index: number;
  /** English name, e.g. `"January"`. */
  readonly name: string;
  /** Three-letter abbreviation, e.g. `"Jan"`. */
  readonly shortName: string;
  /** One-letter abbreviation, e.g. `"J"` (not unique). */
  readonly narrowName: string;
}

/** English Gregorian month names (0-based arrays, internal). Public API: {@link gregorianMonthName}, {@link GREGORIAN_MONTHS}. */
const GREGORIAN_MONTH_NAMES: {
  readonly long: readonly string[];
  readonly short: readonly string[];
  readonly narrow: readonly string[];
} = Object.freeze({
  long: Object.freeze([
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]),
  short: Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']),
  narrow: Object.freeze(['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']),
});

/** The 12 Gregorian months in order (`GREGORIAN_MONTHS[0].index === 1`). */
export const GREGORIAN_MONTHS: readonly GregorianMonthInfo[] = Object.freeze(
  GREGORIAN_MONTH_NAMES.long.map((name, i) =>
    Object.freeze({
      index: i + 1,
      name,
      shortName: GREGORIAN_MONTH_NAMES.short[i]!,
      narrowName: GREGORIAN_MONTH_NAMES.narrow[i]!,
    }),
  ),
);

/** Days before the first of each month in a common year (index 0 = January). */
const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334] as const;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

// ---------------------------------------------------------------------------
// Years
// ---------------------------------------------------------------------------

/** `true` when `year` is an integer in `1…9999`. */
export function isValidYear(year: unknown): year is number {
  return isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR;
}

/** @throws RangeError unless `year` is an integer in `1…9999`. */
export function assertValidYear(year: unknown): asserts year is number {
  if (!isInteger(year)) fail(`Year must be an integer, got ${show(year)}`);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    fail(`Year ${year} is out of range (supported years are ${MIN_YEAR}..${MAX_YEAR})`);
  }
}

/**
 * Gregorian leap-year rule: divisible by 4, except centuries not divisible by 400.
 * Both 13-month systems use the same rule, so this answers for every calendar.
 */
export function isLeapYear(year: number): boolean {
  assertValidYear(year);
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Number of days in `year`: 365, or 366 in leap years (the same in every supported calendar). */
export function daysInYear(year: number): 365 | 366 {
  return isLeapYear(year) ? 366 : 365;
}

/** Validates `month` (1…12). */
function assertValidMonth(month: unknown): asserts month is number {
  if (!isInteger(month) || month < 1 || month > 12) {
    fail(`Gregorian month must be an integer 1..12, got ${show(month)}`);
  }
}

/** Number of days in a Gregorian month (28–31). */
export function daysInGregorianMonth(year: number, month: number): number {
  assertValidYear(year);
  assertValidMonth(month);
  return month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1]!;
}

/**
 * English name of a Gregorian month (1-based).
 * @throws RangeError if `month` is not `1…12`.
 */
export function gregorianMonthName(month: number, style: NameStyle = 'long'): string {
  assertValidMonth(month);
  return namesForStyle(GREGORIAN_MONTH_NAMES, style)[month - 1]!;
}

// ---------------------------------------------------------------------------
// Validation & construction
// ---------------------------------------------------------------------------

function gregorianProblem(value: unknown): string | null {
  if (!isRecord(value)) return `expected an object { year, month, day }, got ${show(value)}`;
  const { year, month, day } = value;
  if (!isInteger(year)) return `year must be an integer, got ${show(year)}`;
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return `year ${year} is out of range (supported years are ${MIN_YEAR}..${MAX_YEAR})`;
  }
  if (!isInteger(month) || month < 1 || month > 12) return `month must be an integer 1..12, got ${show(month)}`;
  const length = daysInGregorianMonth(year, month);
  if (!isInteger(day) || day < 1 || day > length) {
    return `day must be an integer 1..${length} for ${GREGORIAN_MONTH_NAMES.long[month - 1]} ${year}, got ${show(day)}`;
  }
  return null;
}

/** `true` when `value` is a valid {@link GregorianDate} within years `1…9999`. */
export function isValidGregorian(value: unknown): value is GregorianDate {
  return gregorianProblem(value) === null;
}

/** @throws RangeError with a descriptive message unless `value` is a valid {@link GregorianDate}. */
export function assertValidGregorian(value: unknown): asserts value is GregorianDate {
  const problem = gregorianProblem(value);
  if (problem !== null) fail(`Invalid Gregorian date: ${problem}`);
}

/**
 * Validated constructor. Returns a fresh record `{ year, month, day }`.
 * @throws RangeError for invalid dates.
 */
export function gregorianDate(year: number, month: number, day: number): GregorianDate {
  const date = { year, month, day };
  assertValidGregorian(date);
  return date;
}

// ---------------------------------------------------------------------------
// Day of year
// ---------------------------------------------------------------------------

/** 1-based day of the year (`1…365/366`), shared by every supported calendar. */
export function gregorianDayOfYear(date: GregorianDate): number {
  assertValidGregorian(date);
  const leapShift = date.month > 2 && isLeapYear(date.year) ? 1 : 0;
  return DAYS_BEFORE_MONTH[date.month - 1]! + date.day + leapShift;
}

/**
 * Inverse of {@link gregorianDayOfYear}.
 * @throws RangeError if `dayOfYear` is not in `1…daysInYear(year)`.
 */
export function gregorianFromDayOfYear(year: number, dayOfYear: number): GregorianDate {
  const total = daysInYear(year);
  if (!isInteger(dayOfYear) || dayOfYear < 1 || dayOfYear > total) {
    fail(`Day of year must be an integer 1..${total} for ${year}, got ${show(dayOfYear)}`);
  }
  let remaining = dayOfYear;
  for (let month = 1; month <= 12; month++) {
    const length = daysInGregorianMonth(year, month);
    if (remaining <= length) return { year, month, day: remaining };
    remaining -= length;
  }
  /* c8 ignore next */
  return fail(`Unreachable: day of year ${dayOfYear} in ${year}`);
}

// ---------------------------------------------------------------------------
// Julian Day Number arithmetic
// ---------------------------------------------------------------------------

function jdnUnchecked(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045
  );
}

/** Julian Day Number of 0001-01-01 (the earliest supported date). */
export const MIN_JULIAN_DAY_NUMBER: number = jdnUnchecked(MIN_YEAR, 1, 1); // 1721426
/** Julian Day Number of 9999-12-31 (the latest supported date). */
export const MAX_JULIAN_DAY_NUMBER: number = jdnUnchecked(MAX_YEAR, 12, 31); // 5373484

/**
 * Chronological Julian Day Number (integer day count; 2000-01-01 → 2451545).
 * Useful as a sortable, subtractable day key.
 */
export function toJulianDayNumber(date: GregorianDate): number {
  assertValidGregorian(date);
  return jdnUnchecked(date.year, date.month, date.day);
}

/**
 * Inverse of {@link toJulianDayNumber}.
 * @throws RangeError if `jdn` is not an integer or falls outside 0001-01-01…9999-12-31.
 */
export function fromJulianDayNumber(jdn: number): GregorianDate {
  if (!isInteger(jdn)) fail(`Julian Day Number must be an integer, got ${show(jdn)}`);
  if (jdn < MIN_JULIAN_DAY_NUMBER || jdn > MAX_JULIAN_DAY_NUMBER) {
    fail(
      `Julian Day Number ${jdn} is outside the supported range ` +
        `${MIN_JULIAN_DAY_NUMBER}..${MAX_JULIAN_DAY_NUMBER} (0001-01-01..9999-12-31)`,
    );
  }
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

/** Real-world day of the week (`0 = Sunday`). */
export function gregorianWeekday(date: GregorianDate): Weekday {
  return toWeekday(toJulianDayNumber(date) + 1);
}

/**
 * Adds (or, if negative, subtracts) whole days.
 * @throws RangeError if `days` is not an integer or the result leaves years `1…9999`.
 */
export function addGregorianDays(date: GregorianDate, days: number): GregorianDate {
  if (!isInteger(days)) fail(`Days to add must be an integer, got ${show(days)}`);
  return fromJulianDayNumber(toJulianDayNumber(date) + days);
}

/** Signed difference in days, `a − b` (e.g. `diffGregorianDays(Jan 2, Jan 1) === 1`). */
export function diffGregorianDays(a: GregorianDate, b: GregorianDate): number {
  return toJulianDayNumber(a) - toJulianDayNumber(b);
}

/** Chronological comparator: `-1` if `a < b`, `0` if equal, `1` if `a > b`. Suitable for `Array#sort`. */
export function compareGregorian(a: GregorianDate, b: GregorianDate): -1 | 0 | 1 {
  const delta = diffGregorianDays(a, b);
  return delta < 0 ? -1 : delta > 0 ? 1 : 0;
}

/** Value equality of two valid Gregorian dates. */
export function gregorianEquals(a: GregorianDate, b: GregorianDate): boolean {
  return compareGregorian(a, b) === 0;
}

// ---------------------------------------------------------------------------
// ISO 8601 calendar dates
// ---------------------------------------------------------------------------

/** Formats as ISO 8601 `"YYYY-MM-DD"` (4-digit zero-padded year, e.g. `"0001-01-01"`). */
export function toISODate(date: GregorianDate): string {
  assertValidGregorian(date);
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a strict ISO 8601 calendar date `"YYYY-MM-DD"` (years `0001…9999`,
 * no time, no surrounding whitespace, no expanded years).
 * @throws RangeError for malformed text or impossible dates (e.g. `"2023-02-29"`).
 */
export function parseISODate(text: string): GregorianDate {
  if (typeof text !== 'string') fail(`ISO date must be a string, got ${show(text)}`);
  const match = ISO_DATE.exec(text);
  if (!match) fail(`Invalid ISO date ${show(text)}: expected the form YYYY-MM-DD`);
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const problem = gregorianProblem(date);
  if (problem !== null) fail(`Invalid ISO date ${show(text)}: ${problem}`);
  return date;
}

/** Like {@link parseISODate} but returns `null` instead of throwing. */
export function tryParseISODate(text: string): GregorianDate | null {
  try {
    return parseISODate(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// JavaScript Date interop (local time)
// ---------------------------------------------------------------------------

/**
 * The local-time calendar date of a JS `Date` (uses `getFullYear/getMonth/getDate`,
 * so "today" is the user's wall-clock date, not the UTC date).
 * @throws RangeError for an invalid `Date` or a year outside `1…9999`.
 */
export function fromJSDate(date: Date): GregorianDate {
  if (!(date instanceof Date) && Object.prototype.toString.call(date) !== '[object Date]') {
    fail(`Expected a Date, got ${show(date)}`);
  }
  if (Number.isNaN(date.getTime())) fail('Cannot convert an invalid Date (NaN time value)');
  const result = { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  assertValidYear(result.year);
  return result;
}

/**
 * A JS `Date` at the **first local instant** of the given date: local midnight,
 * or — when a DST transition skips midnight (e.g. America/Sao_Paulo 2018-11-04) —
 * the first existing local time that day (01:00). Years `1…99` are handled
 * correctly (no 19xx remapping).
 * @throws RangeError for invalid dates, and when the date does not exist at
 * all in the local time zone because the zone skipped the whole calendar day
 * (Pacific/Apia 2011-12-30, Pacific/Kiritimati 1994-12-31, Pacific/Kwajalein
 * 1993-08-21). Nothing is silently moved to another day.
 */
export function toJSDate(date: GregorianDate): Date {
  assertValidGregorian(date);
  const result = new Date(2000, 0, 1, 0, 0, 0, 0);
  result.setFullYear(date.year, date.month - 1, date.day);
  if (result.getFullYear() !== date.year || result.getMonth() !== date.month - 1 || result.getDate() !== date.day) {
    fail(`${toISODate(date)} does not exist in the local time zone (the zone skipped that calendar day)`);
  }
  return result;
}
