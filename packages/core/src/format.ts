/**
 * English formatting of Gregorian and 13-month dates, and parsing of the
 * 13-month numeric form (SPEC §3.1).
 *
 * | style     | 13-month month date            | intercalary          | Gregorian              |
 * |-----------|--------------------------------|----------------------|------------------------|
 * | `long`    | `October 12, 2026`             | `Year Day 2026`      | `October 19, 2026`     |
 * | `medium`  | `Oct 12, 2026`                 | `Year Day 2026`      | `Oct 19, 2026`         |
 * | `short`   | `Oct 12`                       | `Year Day`           | `Oct 19`               |
 * | `numeric` | `2026-M11-12` (month 1…13)     | `2026-YD`/`2024-LD`  | `2026-10-19` (ISO)     |
 *
 * `includeYear` defaults to `true` except for `short`. `includeWeekday`
 * (default `false`) prefixes `"Thursday, "` (long) or `"Thu, "` (medium/short);
 * it is ignored for `numeric` and for intercalary days, which have no weekday.
 * The year shown for 13-month dates is the system's display year
 * (Positivist: `Descartes 12, 238`).
 *
 * The 13-month numeric form uses an ISO-8601-style **`M` designator**
 * (like ISO week dates `2026-W43-1`) so it can never be mistaken for, or
 * parsed as, a Gregorian ISO date: `parseISODate('2026-M11-12')` throws, and
 * {@link parseThirteen} is its exact inverse.
 *
 * Options are validated strictly: `options` must be `undefined` or a plain
 * object with only the keys `style`, `includeYear` and `includeWeekday`, and
 * the flags must be booleans — anything else throws `RangeError`.
 * @module
 */

import { type GregorianDate, assertValidGregorian, gregorianMonthName, gregorianWeekday } from './gregorian.ts';
import { fail, isInteger, pad, readBooleanOption, readOptions, show } from './internal.ts';
import { type CalendarSystemId, DEFAULT_SYSTEM_ID, getCalendarSystem } from './systems/index.ts';
import {
  type ThirteenDate,
  assertValidThirteenDate,
  createIntercalaryDate,
  createMonthDate,
  fixedWeekday,
  fromDisplayYear,
  thirteenDisplayYear,
} from './thirteen.ts';
import { weekdayName } from './weekday.ts';

/** Output style for {@link formatThirteen} and {@link formatGregorian}. */
export type DateStyle = 'long' | 'medium' | 'short' | 'numeric';

/** Options for {@link formatThirteen} and {@link formatGregorian}. Unknown keys are rejected. */
export interface FormatOptions {
  /** Default `'long'`. */
  readonly style?: DateStyle;
  /** Default `true`, except `false` for `'short'`. */
  readonly includeYear?: boolean;
  /** Default `false`. Ignored for `'numeric'` and intercalary days. */
  readonly includeWeekday?: boolean;
}

interface Resolved {
  readonly style: DateStyle;
  readonly includeYear: boolean;
  readonly includeWeekday: boolean;
}

/** All date styles, in documentation order. */
const STYLES: readonly DateStyle[] = ['long', 'medium', 'short', 'numeric'];
const OPTION_KEYS: readonly string[] = ['style', 'includeYear', 'includeWeekday'];

function resolve(options: unknown): Resolved {
  const bag = readOptions(options, OPTION_KEYS, 'format');
  const style = bag.style === undefined ? 'long' : bag.style;
  if (!STYLES.includes(style as DateStyle)) {
    fail(`Invalid format style ${show(style)} (expected ${STYLES.map((s) => `'${s}'`).join(', ')})`);
  }
  return {
    style: style as DateStyle,
    includeYear: readBooleanOption(bag, 'includeYear', 'format') ?? style !== 'short',
    includeWeekday: readBooleanOption(bag, 'includeWeekday', 'format') ?? false,
  };
}

/**
 * Formats a year for numeric output: 4-digit zero padding with a leading `-`
 * for negative numbers (Positivist years before 1789), e.g. `0238`, `0000`, `-1787`.
 */
export function formatNumericYear(year: number): string {
  if (!isInteger(year)) fail(`Year must be an integer, got ${show(year)}`);
  return year < 0 ? `-${pad(-year, 4)}` : pad(year, 4);
}

/** Formats a 13-month date. See the module docs for every style. */
export function formatThirteen(date: ThirteenDate, options?: FormatOptions): string {
  assertValidThirteenDate(date);
  const { style, includeYear, includeWeekday } = resolve(options);
  const system = getCalendarSystem(date.system);
  const year = thirteenDisplayYear(date);

  if (date.kind === 'intercalary') {
    const info = system.intercalaryDays.find((d) => d.id === date.id)!;
    if (style === 'numeric') return includeYear ? `${formatNumericYear(year)}-${info.code}` : info.code;
    const name = style === 'long' ? info.name : info.shortName;
    return includeYear ? `${name} ${year}` : name;
  }

  if (style === 'numeric') {
    const monthDay = `M${pad(date.month, 2)}-${pad(date.day, 2)}`;
    return includeYear ? `${formatNumericYear(year)}-${monthDay}` : monthDay;
  }
  const month = system.months[date.month - 1]!;
  const body = `${style === 'long' ? month.name : month.shortName} ${date.day}${includeYear ? `, ${year}` : ''}`;
  if (!includeWeekday) return body;
  return `${weekdayName(fixedWeekday(date.day, date.system), style === 'long' ? 'long' : 'short')}, ${body}`;
}

/** Formats a Gregorian date. See the module docs for every style (`numeric` is ISO 8601). */
export function formatGregorian(date: GregorianDate, options?: FormatOptions): string {
  assertValidGregorian(date);
  const { style, includeYear, includeWeekday } = resolve(options);
  if (style === 'numeric') {
    const monthDay = `${pad(date.month, 2)}-${pad(date.day, 2)}`;
    return includeYear ? `${pad(date.year, 4)}-${monthDay}` : monthDay;
  }
  const body = `${gregorianMonthName(date.month, style === 'long' ? 'long' : 'short')} ${date.day}${
    includeYear ? `, ${date.year}` : ''
  }`;
  if (!includeWeekday) return body;
  return `${weekdayName(gregorianWeekday(date), style === 'long' ? 'long' : 'short')}, ${body}`;
}

const THIRTEEN_NUMERIC = /^(-?)(\d{4})-(?:M(\d{2})-(\d{2})|(YD|LD))$/;

/**
 * Parses the full 13-month numeric form produced by
 * `formatThirteen(date, { style: 'numeric' })` — `YYYY-Mmm-dd`, `YYYY-YD` or
 * `YYYY-LD`, where `YYYY` is the system's **display year** (4 digits, optional
 * leading `-`; Positivist `0238-M11-12`, `-1787-YD`). Exact inverse of the
 * formatter: no whitespace, no lowercase, no unpadded fields, no `-0000`.
 * @throws RangeError for malformed text, an impossible date (month 14, day 29,
 * `LD` in a common year) or a year outside the system's display-year range.
 */
export function parseThirteen(text: string, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): ThirteenDate {
  const system = getCalendarSystem(systemId);
  if (typeof text !== 'string') fail(`13-month numeric date must be a string, got ${show(text)}`);
  const match = THIRTEEN_NUMERIC.exec(text);
  if (!match || (match[1] === '-' && match[2] === '0000')) {
    fail(`Invalid 13-month numeric date ${show(text)}: expected YYYY-Mmm-dd, YYYY-YD or YYYY-LD (e.g. 2026-M11-12)`);
  }
  try {
    const year = fromDisplayYear(Number(`${match[1]}${match[2]}`), system.id);
    if (match[5] !== undefined) {
      const info = system.intercalaryDays.find((d) => d.code === match[5])!;
      return createIntercalaryDate(year, info.id, system.id);
    }
    return createMonthDate(year, Number(match[3]), Number(match[4]), system.id);
  } catch (error) {
    return fail(`Invalid 13-month numeric date ${show(text)}: ${(error as Error).message}`);
  }
}

/** Like {@link parseThirteen} but returns `null` instead of throwing for bad text (an unknown system still throws). */
export function tryParseThirteen(text: string, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): ThirteenDate | null {
  getCalendarSystem(systemId);
  try {
    return parseThirteen(text, systemId);
  } catch {
    return null;
  }
}

/** English ordinal: `1st`, `2nd`, `3rd`, `4th`, `11th`, `12th`, `13th`, `21st`, `112th`, `-1st`. */
export function ordinal(value: number): string {
  if (!isInteger(value)) fail(`Ordinal needs an integer, got ${show(value)}`);
  const abs = Math.abs(value);
  const lastTwo = abs % 100;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13 ? 'th' : abs % 10 === 1 ? 'st' : abs % 10 === 2 ? 'nd' : abs % 10 === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}
