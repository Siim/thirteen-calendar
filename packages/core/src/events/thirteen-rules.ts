/**
 * 13-month repeat rules (docs/EVENTS.md §4.2 to §4.5, §5.2): the
 * {@link ThirteenRule} value, the rule made from a start
 * ({@link thirteenRuleFor}), its dates ({@link thirteenRuleDatesInYear},
 * {@link thirteenRuleIncludes}), its one `RRULE` encoding
 * ({@link encodeThirteenRule}, forms (a) to (c) of §4.3), the Android date
 * lists of form (d) ({@link thirteenRuleRdates}, {@link thirteenRuleRdateParts}),
 * and the three markers: the `X-THIRTEEN-RULE` value
 * ({@link formatThirteenRuleText}), the Android rule URI
 * ({@link formatThirteenRuleUri}) and the Android detached URI
 * ({@link formatDetachedUri}).
 *
 * **Dates.** A rule's dates in a Gregorian year come from the system's own
 * month and intercalary tables, the same tables `thirteenDayOfYear` and
 * `fromThirteen` use, so they are exact for years 1 to 9999. The dates are the
 * rule's pattern: they do not depend on where a series starts, except that an
 * every-2-weeks rule takes its fortnight phase from the start.
 *
 * **The start.** A rule made by {@link thirteenRuleFor} always has its start
 * as a date (§4.2). Foreign data can pair a rule with a start the rule does
 * not produce; RFC 5545 then still counts the start as the first occurrence.
 * The date functions accept such starts (the start fixes only the fortnight
 * phase); {@link encodeThirteenRule} does not, because form (a) and (c) rules
 * derive their dates from `DTSTART`.
 *
 * **Fortnight phase.** The 13-month weekday `w` falls on month days `k`,
 * `k + 7`, `k + 14` and `k + 21` of every month. An every-2-weeks rule keeps
 * the two of them in the same week parity as the start's month day: weeks 1
 * and 3 when the start is in week 1 or 3, else weeks 2 and 4. For a start on
 * the rule's weekday this is §4.2's `{p, p + 14}` with
 * `p = ((startDay - 1) mod 14) + 1`. A start on an intercalary day, which
 * belongs to no week, counts as week 1 (the first day of a month follows it).
 * @module
 */

import {
  type GregorianDate,
  MAX_YEAR,
  assertValidGregorian,
  assertValidYear,
  fromJulianDayNumber,
  gregorianFromDayOfYear,
  isLeapYear,
  toISODate,
  toJulianDayNumber,
  tryParseISODate,
} from '../gregorian.ts';
import { fail, isInteger, isRecord, readOptions, show } from '../internal.ts';
import {
  type CalendarSystem,
  type CalendarSystemId,
  type IntercalaryDayId,
  DEFAULT_SYSTEM_ID,
  getCalendarSystem,
  isCalendarSystemId,
  isIntercalaryDayId,
} from '../systems/index.ts';
import { DAYS_PER_MONTH, DAYS_PER_WEEK, MONTHS_PER_YEAR, isMonthDate, thirteenWeekday, toThirteen } from '../thirteen.ts';
import { type Weekday, isWeekday } from '../weekday.ts';
import type { RepeatEnd } from './recurrence.ts';
import { type RRule, weekdayCode } from './rrule.ts';

/**
 * A repeat that follows the 13-month calendar of `system` (§4.2). A rule
 * belongs to the system it was made in; its dates are the same whichever
 * system the user has selected.
 */
export type ThirteenRule =
  /** Every 13-month month on `day` (`1…28`). */
  | { readonly kind: 'monthly'; readonly system: CalendarSystemId; readonly day: number }
  /** Every (or every second) 13-month week on the 13-month `weekday`; the fortnight phase comes from the start. */
  | { readonly kind: 'weekly'; readonly system: CalendarSystemId; readonly weekday: Weekday; readonly interval: 1 | 2 }
  /** Every year on 13-month `month` (`1…13`) and `day` (`1…28`). */
  | { readonly kind: 'yearly'; readonly system: CalendarSystemId; readonly month: number; readonly day: number }
  /** Every Year Day or Leap Day (Positivist: Festival of All the Dead or of Holy Women). */
  | { readonly kind: 'intercalary'; readonly system: CalendarSystemId; readonly id: IntercalaryDayId };

/** The 13-month rows of the repeat picker (§2.13); `biweekly` is the weekly rule with interval 2. */
export type ThirteenRuleKind = 'monthly' | 'weekly' | 'biweekly' | 'yearly' | 'intercalary';

/** The three `RRULE` encodings of §4.3: (a) plain yearly, (b) day-of-year list, (c) leap interval. */
export type ThirteenEncodingForm = 'gregorian-yearly' | 'byyearday' | 'leap-interval';

/** A rule's one `RRULE` encoding (§4.3), as Apple, Windows, the web and `.ics` export store it. */
export interface ThirteenEncoding {
  readonly form: ThirteenEncodingForm;
  /** Without `COUNT` or `UNTIL`, except the leap-interval cap (a DATE until). */
  readonly rrule: RRule;
  /** `form !== 'byyearday'`: Exchange and Outlook keep the rule. */
  readonly exchangeSafe: boolean;
  /** The leap-interval cap (§4.3 c); `null` for the other forms. */
  readonly cap: GregorianDate | null;
}

/** One part of an Android `RDATE` series (§4.4): the part's first occurrence and its later dates. */
export interface RdatePart {
  /** `1…`, in date order. */
  readonly part: number;
  /** The part's `DTSTART`. */
  readonly start: GregorianDate;
  /** The part's `RDATE` values: every later occurrence of the part, ascending (the start excluded). */
  readonly dates: GregorianDate[];
}

/** The `series` and `part` keys of an Android rule URI (§4.3 e); both `null` or both set. */
export interface RuleUriExtras {
  /** Lowercase UUID shared by every part of a series. */
  readonly series: string | null;
  /** The part number, `1…`. */
  readonly part: number | null;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const KINDS: readonly ThirteenRuleKind[] = ['monthly', 'weekly', 'biweekly', 'yearly', 'intercalary'];
const RULE_KINDS: readonly ThirteenRule['kind'][] = ['monthly', 'weekly', 'yearly', 'intercalary'];
const WEEKDAY_CODES: readonly string[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const INTERCALARY_CODES: Readonly<Record<IntercalaryDayId, 'YD' | 'LD'>> = { 'year-day': 'YD', 'leap-day': 'LD' };
/** RDATE values per Android part (§4.4; gate V10 may lower it). */
const DEFAULT_MAX_VALUES = 400;
/** Largest count, part number and `maxValues`: every port holds them in a 32-bit signed integer. */
const MAX_INT = 2_147_483_647;
/** The last leap year in range (9996): the latest possible leap-interval cap. */
const LAST_LEAP_YEAR = (() => {
  let year = MAX_YEAR;
  while (!isLeapYear(year)) year--;
  return year;
})();
/** A common and a leap year, to compare a rule's Gregorian month and day across both kinds of year. */
const COMMON_YEAR = 2001;
const LEAP_YEAR = 2004;

const RULE_URI_PREFIX = 'thirteen://rule?';
const DETACHED_URI_PREFIX = 'thirteen://detached?';
const POSITIVE = /^[1-9]\d*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A percent-encoded URI component: RFC 3986 unreserved characters and `%XX` escapes only. */
const ENCODED_COMPONENT = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/;

// ---------------------------------------------------------------------------
// Validation and copies
// ---------------------------------------------------------------------------

function thirteenRuleProblem(value: unknown): string | null {
  if (!isRecord(value)) return `expected an object, got ${show(value)}`;
  if (!isCalendarSystemId(value.system)) return `system must be 'ifc' or 'positivist', got ${show(value.system)}`;
  const isMonthDay = (v: unknown) => isInteger(v) && v >= 1 && v <= DAYS_PER_MONTH;
  switch (value.kind) {
    case 'monthly':
      return isMonthDay(value.day) ? null : `day must be an integer 1..28, got ${show(value.day)}`;
    case 'weekly':
      if (!isWeekday(value.weekday)) return `weekday must be an integer 0..6, got ${show(value.weekday)}`;
      return value.interval === 1 || value.interval === 2 ? null : `interval must be 1 or 2, got ${show(value.interval)}`;
    case 'yearly':
      if (!isInteger(value.month) || value.month < 1 || value.month > MONTHS_PER_YEAR) {
        return `month must be an integer 1..13, got ${show(value.month)}`;
      }
      return isMonthDay(value.day) ? null : `day must be an integer 1..28, got ${show(value.day)}`;
    case 'intercalary':
      return isIntercalaryDayId(value.id) ? null : `id must be 'year-day' or 'leap-day', got ${show(value.id)}`;
    default:
      return `kind must be 'monthly', 'weekly', 'yearly' or 'intercalary', got ${show(value.kind)}`;
  }
}

/**
 * Validates the shape of a {@link ThirteenRule}.
 * @throws RangeError with a descriptive message.
 * @internal
 */
export function assertValidThirteenRule(value: unknown): asserts value is ThirteenRule {
  const problem = thirteenRuleProblem(value);
  if (problem !== null) fail(`Invalid 13-month rule: ${problem}`);
}

/** A fresh copy of a valid rule, with only its documented fields in declaration order. @internal */
export function copyThirteenRule(rule: ThirteenRule): ThirteenRule {
  switch (rule.kind) {
    case 'monthly':
      return { kind: 'monthly', system: rule.system, day: rule.day };
    case 'weekly':
      return { kind: 'weekly', system: rule.system, weekday: rule.weekday, interval: rule.interval };
    case 'yearly':
      return { kind: 'yearly', system: rule.system, month: rule.month, day: rule.day };
    case 'intercalary':
      return { kind: 'intercalary', system: rule.system, id: rule.id };
  }
}

const isCount = (value: unknown): value is number => isInteger(value) && value >= 1 && value <= MAX_INT;

/** Validates a {@link RepeatEnd}: a count must be an integer `1…2147483647`. */
function assertValidEnd(value: unknown, context: string): asserts value is RepeatEnd {
  if (!isRecord(value)) fail(`${context}: end must be an object, got ${show(value)}`);
  switch (value.kind) {
    case 'never':
      return;
    case 'count':
      if (!isCount(value.count)) fail(`${context}: end count must be an integer 1..${MAX_INT}, got ${show(value.count)}`);
      return;
    case 'until':
      assertValidGregorian(value.date);
      return;
    default:
      fail(`${context}: end kind must be 'never', 'count' or 'until', got ${show(value.kind)}`);
  }
}

function readMaxValues(options: unknown, context: string): number {
  const opts = readOptions(options, ['maxValues'], context);
  const value = opts.maxValues;
  if (value === undefined) return DEFAULT_MAX_VALUES;
  if (!isCount(value)) fail(`${context} option 'maxValues' must be an integer 1..${MAX_INT}, got ${show(value)}`);
  return value;
}

// ---------------------------------------------------------------------------
// Rule dates (§4.2)
// ---------------------------------------------------------------------------

/** Week parity of an every-2-weeks rule: 0 = weeks 1 and 3, 1 = weeks 2 and 4. */
type Phase = 0 | 1;

/** A rule's dates as days of the year, ascending, in common and in leap years. */
interface YearDays {
  readonly common: readonly number[];
  readonly leap: readonly number[];
}

/** Day of the year of 13-month month day `month`/`day`: its position plus the intercalary days before its month. */
function monthDayOfYear(system: CalendarSystem, leap: boolean, month: number, day: number): number {
  let before = 0;
  for (const info of system.intercalaryDays) {
    const present = leap ? info.dayOfYear.leap : info.dayOfYear.common;
    if (present !== null && info.afterMonth < month) before++;
  }
  return DAYS_PER_MONTH * (month - 1) + day + before;
}

/**
 * The month days of a weekly rule (§4.2): `k, k + 7, k + 14, k + 21` with
 * `k = ((weekday - weekStartsOn + 7) mod 7) + 1`, or the two of them in week
 * parity `phase` for every 2 weeks.
 */
function weeklyDays(rule: Extract<ThirteenRule, { kind: 'weekly' }>, phase: Phase): number[] {
  const first = ((rule.weekday - getCalendarSystem(rule.system).weekStartsOn + DAYS_PER_WEEK) % DAYS_PER_WEEK) + 1;
  const weeks = rule.interval === 1 ? [0, 1, 2, 3] : [phase, phase + 2];
  return weeks.map((week) => first + DAYS_PER_WEEK * week);
}

/** The month days (`[month, day]`, chronological) a month-day rule produces in every year. */
function ruleMonthDays(rule: Exclude<ThirteenRule, { kind: 'intercalary' }>, phase: Phase): [number, number][] {
  if (rule.kind === 'yearly') return [[rule.month, rule.day]];
  const days = rule.kind === 'monthly' ? [rule.day] : weeklyDays(rule, phase);
  const pairs: [number, number][] = [];
  for (let month = 1; month <= MONTHS_PER_YEAR; month++) for (const day of days) pairs.push([month, day]);
  return pairs;
}

function yearDaysOf(rule: ThirteenRule, phase: Phase): YearDays {
  const system = getCalendarSystem(rule.system);
  if (rule.kind === 'intercalary') {
    const info = system.intercalaryDays.find((d) => d.id === rule.id)!;
    return { common: info.dayOfYear.common === null ? [] : [info.dayOfYear.common], leap: [info.dayOfYear.leap] };
  }
  const pairs = ruleMonthDays(rule, phase);
  return {
    common: pairs.map(([month, day]) => monthDayOfYear(system, false, month, day)),
    leap: pairs.map(([month, day]) => monthDayOfYear(system, true, month, day)),
  };
}

/** The fortnight phase of a rule for a start (§4.2; see the module documentation). Valid input. */
function phaseOf(rule: ThirteenRule, start: GregorianDate): Phase {
  if (rule.kind !== 'weekly' || rule.interval === 1) return 0;
  const date = toThirteen(start, rule.system);
  return isMonthDate(date) ? ((Math.floor((date.day - 1) / DAYS_PER_WEEK) % 2) as Phase) : 0;
}

/**
 * The rule's dates as days of the year (1-based, ascending) in common and in
 * leap years, in the fortnight phase of `start` (§4.2). Recurrence expansion
 * reads a year's dates from these without building them one by one.
 * @throws RangeError for an invalid rule or start.
 * @internal
 */
export function thirteenRuleYearDays(rule: ThirteenRule, start: GregorianDate): { common: readonly number[]; leap: readonly number[] } {
  assertValidThirteenRule(rule);
  assertValidGregorian(start);
  const days = yearDaysOf(rule, phaseOf(rule, start));
  return { common: [...days.common], leap: [...days.leap] };
}

/**
 * The rule's day-of-year list as form (b) of §4.3 writes it (positive values
 * first, then negative values from -365 up), whatever form
 * {@link encodeThirteenRule} chooses for it; `null` for the leap-only rules
 * (IFC Leap Day, Positivist Holy Women), which have no such list. Recognition
 * compares a stored `BYYEARDAY` set with it (§4.5 step 2), so a single value
 * such as `BYYEARDAY=12` matches the yearly rules of both systems.
 * @throws RangeError for an invalid rule or start.
 * @internal
 */
export function thirteenRuleYearDayList(rule: ThirteenRule, start: GregorianDate): number[] | null {
  const days = thirteenRuleYearDays(rule, start);
  if (days.common.length === 0) return null;
  return [...new Set(days.common.map((common, i) => yearDayValue(common, days.leap[i]!)))].sort(compareYearDays);
}

/** Julian Day Number of January 1 of a valid year. */
const yearBase = (year: number): number => toJulianDayNumber({ year, month: 1, day: 1 });

/** The rule's dates in a valid year, ascending (valid input). */
function datesInYear(days: YearDays, year: number): GregorianDate[] {
  const base = yearBase(year);
  return (isLeapYear(year) ? days.leap : days.common).map((doy) => fromJulianDayNumber(base + doy - 1));
}

/**
 * The 13-month rule of `kind` made from `start` in system `systemId` (§4.2,
 * §2.13): monthly on the start's month day, weekly (`'weekly'`) or every 2
 * weeks (`'biweekly'`) on its 13-month weekday, yearly on its 13-month month
 * and day, or the intercalary rule of its intercalary day. `null` when the
 * start cannot carry that kind: monthly, weekly, every 2 weeks and yearly
 * rules cannot start on an intercalary day, and an intercalary rule starts
 * only on its own day.
 *
 * `thirteenRuleFor('monthly', { year: 2026, month: 10, day: 19 })` is
 * `{ kind: 'monthly', system: 'ifc', day: 12 }` (IFC October 12).
 * @throws RangeError for an unknown kind or system or an invalid date.
 */
export function thirteenRuleFor(
  kind: ThirteenRuleKind,
  start: GregorianDate,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): ThirteenRule | null {
  if (!KINDS.includes(kind)) fail(`Unknown 13-month rule kind ${show(kind)} (expected ${KINDS.map((k) => `'${k}'`).join(', ')})`);
  getCalendarSystem(systemId);
  const date = toThirteen(start, systemId);
  if (kind === 'intercalary') return isMonthDate(date) ? null : { kind: 'intercalary', system: systemId, id: date.id };
  if (!isMonthDate(date)) return null;
  switch (kind) {
    case 'monthly':
      return { kind: 'monthly', system: systemId, day: date.day };
    case 'yearly':
      return { kind: 'yearly', system: systemId, month: date.month, day: date.day };
    default:
      return { kind: 'weekly', system: systemId, weekday: thirteenWeekday(date)!, interval: kind === 'weekly' ? 1 : 2 };
  }
}

/**
 * The rule's dates in Gregorian year `year`, ascending (§4.2): 13 for a
 * monthly rule, 52 for a weekly rule, 26 for an every-2-weeks rule (in the
 * fortnight phase of `start`), one for a yearly rule, and one or none for an
 * intercalary rule (leap-only days only in leap years). Intercalary days are
 * never monthly or weekly dates.
 *
 * These are the rule's own dates: the series' start, its end and the years
 * before the start do not limit them (expansion does that, §4.6). `start`
 * fixes only the fortnight phase.
 * @throws RangeError for an invalid rule, year or start.
 */
export function thirteenRuleDatesInYear(rule: ThirteenRule, year: number, start: GregorianDate): GregorianDate[] {
  assertValidThirteenRule(rule);
  assertValidYear(year);
  assertValidGregorian(start);
  return datesInYear(yearDaysOf(rule, phaseOf(rule, start)), year);
}

/**
 * `true` when `date` is one of the rule's dates (§4.2), in the fortnight phase
 * of `start` for an every-2-weeks rule. Like {@link thirteenRuleDatesInYear},
 * it does not compare `date` with the start: `thirteenRuleIncludes(rule, start,
 * start)` tells whether a start is on the rule.
 * @throws RangeError for an invalid rule or date.
 */
export function thirteenRuleIncludes(rule: ThirteenRule, date: GregorianDate, start: GregorianDate): boolean {
  assertValidThirteenRule(rule);
  assertValidGregorian(date);
  assertValidGregorian(start);
  const thirteen = toThirteen(date, rule.system);
  if (rule.kind === 'intercalary') return !isMonthDate(thirteen) && thirteen.id === rule.id;
  if (!isMonthDate(thirteen)) return false;
  switch (rule.kind) {
    case 'monthly':
      return thirteen.day === rule.day;
    case 'yearly':
      return thirteen.month === rule.month && thirteen.day === rule.day;
    case 'weekly':
      return weeklyDays(rule, phaseOf(rule, start)).includes(thirteen.day);
  }
}

// ---------------------------------------------------------------------------
// Encodings (§4.3 a to c)
// ---------------------------------------------------------------------------

function yearlyRRule(fields: Partial<RRule>): RRule {
  return {
    freq: 'yearly',
    interval: 1,
    count: null,
    until: null,
    bySecond: [],
    byMinute: [],
    byHour: [],
    byDay: [],
    byMonthDay: [],
    byYearDay: [],
    byWeekNo: [],
    byMonth: [],
    bySetPos: [],
    wkst: null,
    rscale: null,
    skip: null,
    extensions: [],
    ...fields,
  };
}

/** `true` when day `common` of a common year and day `leap` of a leap year have the same Gregorian month and day. */
function sameGregorianDay(common: number, leap: number): boolean {
  const a = gregorianFromDayOfYear(COMMON_YEAR, common);
  const b = gregorianFromDayOfYear(LEAP_YEAR, leap);
  return a.month === b.month && a.day === b.day;
}

/**
 * The `RRULE` form a valid rule is encoded in (§4.3): leap-only intercalary
 * days use the leap interval (c); a yearly or intercalary rule whose Gregorian
 * month and day are the same in common and leap years is the plain yearly rule
 * (a); every other rule, and every monthly and weekly rule, is a day-of-year
 * list (b). The form does not depend on the start.
 * @throws RangeError for an invalid rule.
 * @internal
 */
export function thirteenEncodingForm(rule: ThirteenRule): ThirteenEncodingForm {
  assertValidThirteenRule(rule);
  if (rule.kind === 'monthly' || rule.kind === 'weekly') return 'byyearday';
  const days = yearDaysOf(rule, 0);
  if (days.common.length === 0) return 'leap-interval';
  return sameGregorianDay(days.common[0]!, days.leap[0]!) ? 'gregorian-yearly' : 'byyearday';
}

/**
 * The `BYYEARDAY` value of a date at day `common` of common years and `leap`
 * of leap years: counted from the start of the year when that count is the same
 * in both, else from the end (§4.3 b: IFC months 7 to 13 are `p - 366`).
 */
function yearDayValue(common: number, leap: number): number {
  if (common === leap) return common;
  /* c8 ignore next: every 13-month date keeps its distance from one end of the year */
  if (common - 366 !== leap - 367) fail(`Unreachable: day ${common} of common years is day ${leap} of leap years`);
  return common - 366;
}

/** `BYYEARDAY` order of §4.3 (b): positive values ascending, then negative values from -366 up. */
function compareYearDays(a: number, b: number): number {
  if (a > 0 !== b > 0) return a > 0 ? -1 : 1;
  return a - b;
}

/** The leap-interval cap (§4.3 c) of a leap-only rule starting on its day in `startYear`. */
function leapCap(days: YearDays, startYear: number): GregorianDate {
  let century = (Math.floor(startYear / 100) + 1) * 100;
  while (century % 400 === 0) century += 100;
  const year = Math.min(century - 4, LAST_LEAP_YEAR);
  return fromJulianDayNumber(yearBase(year) + days.leap[0]! - 1);
}

/**
 * The last date a leap-only repeat (IFC Leap Day, Positivist Holy Women) may
 * produce from `start`: its leap-interval cap (§4.3 c), the day in the last
 * leap year before the first century year after the start's year that is not
 * a leap year (2096 for every start from 2000 to 2096; 9996 at the end of the
 * range). Every stored form of the repeat stops there
 * (`FREQ=YEARLY;INTERVAL=4;UNTIL={cap}`), so recurrence expansion, ends and
 * recognition stop there too (§0.6). `null` for every other rule. Unlike
 * {@link encodeThirteenRule}, the start need not be one of the rule's dates
 * (the cap then follows from its year all the same).
 * @throws RangeError for an invalid rule or start.
 * @internal
 */
export function thirteenRuleCap(rule: ThirteenRule, start: GregorianDate): GregorianDate | null {
  assertValidGregorian(start);
  if (thirteenEncodingForm(rule) !== 'leap-interval') return null;
  return leapCap(yearDaysOf(rule, 0), start.year);
}

/**
 * The rule's one `RRULE` encoding (§4.3), chosen in this order:
 *
 * - (a) `'gregorian-yearly'`: a yearly or intercalary rule whose Gregorian
 *   month and day never change (IFC day-of-year up to 59 or from Sol 1 on, IFC
 *   Year Day, Positivist day-of-year up to 59) is `FREQ=YEARLY`, its date
 *   coming from `DTSTART`.
 * - (b) `'byyearday'`: every monthly and weekly rule, every other yearly
 *   rule and Positivist All the Dead is `FREQ=YEARLY;BYYEARDAY=list`, the
 *   list sorted with positive values first (IFC months 1 to 6 and every
 *   Positivist month count from January 1; IFC months 7 to 13 count back
 *   from December 31).
 * - (c) `'leap-interval'`: IFC Leap Day and Positivist Holy Women are
 *   `FREQ=YEARLY;INTERVAL=4;UNTIL={cap}`, the cap being the day in the last
 *   leap year before the first century year after the start that is not a
 *   leap year (2096 for every start from 2000 to 2096; 9996 at the end of the
 *   range). The cap is a DATE until: writers of timed events turn it into the
 *   end of that day like any other until (§4.4), and a user-chosen end earlier
 *   than the cap wins.
 *
 * Only (b) is not Exchange-safe. Forms (a) and (c) take their dates from
 * `DTSTART`, so `start` must be one of the rule's dates.
 *
 * `encodeThirteenRule({ kind: 'monthly', system: 'ifc', day: 12 }, start)` is
 * `FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18`.
 * @throws RangeError for an invalid rule or date, or a start the rule does not produce.
 */
export function encodeThirteenRule(rule: ThirteenRule, start: GregorianDate): ThirteenEncoding {
  if (!thirteenRuleIncludes(rule, start, start)) {
    fail(`Cannot encode a 13-month rule from ${toISODate(start)}: the rule does not produce its start (${formatThirteenRuleText(rule)})`);
  }
  const form = thirteenEncodingForm(rule);
  const days = yearDaysOf(rule, phaseOf(rule, start));
  switch (form) {
    case 'gregorian-yearly':
      return { form, rrule: yearlyRRule({}), exchangeSafe: true, cap: null };
    case 'byyearday': {
      const values = [...new Set(days.common.map((common, i) => yearDayValue(common, days.leap[i]!)))].sort(compareYearDays);
      return { form, rrule: yearlyRRule({ byYearDay: values }), exchangeSafe: false, cap: null };
    }
    case 'leap-interval': {
      const cap = leapCap(days, start.year);
      return {
        form,
        rrule: yearlyRRule({ interval: 4, until: { kind: 'date', date: { ...cap } } }),
        exchangeSafe: true,
        cap,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Android date lists (§4.3 d, §4.4)
// ---------------------------------------------------------------------------

/**
 * The rule's dates after `start`, ascending, up to the end and `horizon`, at
 * most `limit` of them; `more` tells whether another date was left out by the
 * limit. A `count` end counts the start.
 */
function datesAfter(
  rule: ThirteenRule,
  start: GregorianDate,
  end: RepeatEnd,
  horizon: GregorianDate,
  limit: number,
): { dates: GregorianDate[]; more: boolean } {
  const days = yearDaysOf(rule, phaseOf(rule, start));
  const first = toJulianDayNumber(start);
  let last = toJulianDayNumber(horizon);
  if (end.kind === 'until') last = Math.min(last, toJulianDayNumber(end.date));
  let remaining = end.kind === 'count' ? end.count - 1 : Number.POSITIVE_INFINITY;
  const dates: GregorianDate[] = [];
  for (let year = start.year; year <= MAX_YEAR && remaining > 0; year++) {
    const base = yearBase(year);
    if (base > last) break;
    for (const doy of isLeapYear(year) ? days.leap : days.common) {
      const day = base + doy - 1;
      if (day <= first) continue;
      if (day > last) return { dates, more: false };
      if (dates.length === limit) return { dates, more: true };
      dates.push(fromJulianDayNumber(day));
      if (--remaining === 0) break;
    }
  }
  return { dates, more: false };
}

/**
 * The `RDATE` values of form (d) (§4.3 d, §4.4): the rule's dates after
 * `start` (the start is the `DTSTART`, not a value), ascending, up to the end
 * and through `horizon` (the Android horizon of §4.4, capped at 9999-12-31; a
 * caller writing a repeat with an end passes the latest date it may write). A
 * `count` end counts the start, so `count: 1` gives no dates; an `until` end
 * includes its date.
 *
 * At most `maxValues` dates are returned (default 400, the size of one
 * Android part; any integer `1…2147483647`, the largest meaning no limit);
 * `truncated` is `true` when more dates exist before the end and the horizon.
 * The start fixes the fortnight phase of an every-2-weeks rule; it does not
 * have to be one of the rule's dates (RFC 5545 counts it as the first
 * occurrence anyway).
 * @throws RangeError for an invalid rule, date, end or option.
 */
export function thirteenRuleRdates(
  rule: ThirteenRule,
  start: GregorianDate,
  end: RepeatEnd,
  horizon: GregorianDate,
  options?: { maxValues?: number },
): { dates: GregorianDate[]; truncated: boolean } {
  assertValidThirteenRule(rule);
  assertValidGregorian(start);
  assertValidEnd(end, 'thirteenRuleRdates');
  assertValidGregorian(horizon);
  const maxValues = readMaxValues(options, 'thirteenRuleRdates');
  const { dates, more } = datesAfter(rule, start, end, horizon, maxValues);
  return { dates, truncated: more };
}

/**
 * The Android parts of a form (d) series (§4.4): every occurrence from `start`
 * (the first) to the end or `horizon`, cut by position into parts of
 * `1 + maxValues` occurrences (default `maxValues` 400): positions 1 to 401
 * are part 1, 402 to 802 part 2, and so on. Each part's first occurrence is
 * its `start` (its `DTSTART`) and the others are its `dates` (its `RDATE`s).
 * Positions count every rule date, including dates a series later excludes.
 *
 * The cut is deterministic: a later horizon only grows the last part and
 * appends parts, and never changes a full part. There is always at least
 * part 1, holding the start.
 * @throws RangeError for an invalid rule, date, end or option.
 */
export function thirteenRuleRdateParts(
  rule: ThirteenRule,
  start: GregorianDate,
  end: RepeatEnd,
  horizon: GregorianDate,
  options?: { maxValues?: number },
): RdatePart[] {
  assertValidThirteenRule(rule);
  assertValidGregorian(start);
  assertValidEnd(end, 'thirteenRuleRdateParts');
  assertValidGregorian(horizon);
  const maxValues = readMaxValues(options, 'thirteenRuleRdateParts');
  const occurrences = [{ year: start.year, month: start.month, day: start.day }, ...datesAfter(rule, start, end, horizon, MAX_INT).dates];
  const size = maxValues + 1;
  const parts: RdatePart[] = [];
  for (let index = 0; index < occurrences.length; index += size) {
    parts.push({ part: parts.length + 1, start: occurrences[index]!, dates: occurrences.slice(index + 1, index + size) });
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Markers (§4.3 e)
// ---------------------------------------------------------------------------

/** The rule's keys and values in marker order; `upper` gives the `X-THIRTEEN-RULE` key names. */
function ruleFields(rule: ThirteenRule, upper: boolean): string[] {
  const key = (name: string) => (upper ? name.toUpperCase() : name);
  const fields = [`${key('system')}=${rule.system}`, `${key('kind')}=${rule.kind}`];
  switch (rule.kind) {
    case 'monthly':
      fields.push(`${key('day')}=${rule.day}`);
      break;
    case 'weekly':
      fields.push(`${key('weekday')}=${weekdayCode(rule.weekday)}`);
      if (rule.interval === 2) fields.push(`${key('interval')}=2`);
      break;
    case 'yearly':
      fields.push(`${key('month')}=${rule.month}`, `${key('day')}=${rule.day}`);
      break;
    case 'intercalary':
      fields.push(`${key('day')}=${INTERCALARY_CODES[rule.id]}`);
      break;
  }
  return fields;
}

/** Reads `KEY=VALUE` pairs in a fixed order; every mismatch throws `RangeError` with `context`. */
class FieldReader {
  private readonly pairs: readonly (readonly [string, string])[];
  private readonly upper: boolean;
  private readonly context: string;
  private index = 0;

  constructor(pairs: readonly (readonly [string, string])[], upper: boolean, context: string) {
    this.pairs = pairs;
    this.upper = upper;
    this.context = context;
  }

  private name(key: string): string {
    return this.upper ? key.toUpperCase() : key;
  }

  /** `true` when the next pair has key `key`. */
  next(key: string): boolean {
    return this.index < this.pairs.length && this.pairs[this.index]![0] === this.name(key);
  }

  /** The value of the next pair, which must have key `key`. */
  take(key: string): string {
    if (!this.next(key)) {
      const found = this.index < this.pairs.length ? `'${this.pairs[this.index]![0]}'` : 'the end';
      fail(`${this.context}: expected '${this.name(key)}' at position ${this.index + 1}, found ${found}`);
    }
    return this.pairs[this.index++]![1];
  }

  /** The value of the next pair as an integer `min…max` written without sign or leading zeros. */
  number(key: string, min: number, max: number): number {
    const text = this.take(key);
    const value = POSITIVE.test(text) ? Number(text) : Number.NaN;
    if (!(value >= min && value <= max)) fail(`${this.context}: ${this.name(key)} must be an integer ${min}..${max}, got ${show(text)}`);
    return value;
  }

  /** The value of the next pair, which must be one of `values`. */
  oneOf<T extends string>(key: string, values: readonly T[]): T {
    const text = this.take(key);
    if (!(values as readonly string[]).includes(text)) {
      fail(`${this.context}: ${this.name(key)} must be ${values.map((v) => `'${v}'`).join(', ')}, got ${show(text)}`);
    }
    return text as T;
  }

  /** Throws unless every pair was read. */
  done(): void {
    if (this.index < this.pairs.length) fail(`${this.context}: unexpected '${this.pairs[this.index]![0]}' at position ${this.index + 1}`);
  }

  /** The rule's fields (§4.3 e), in order. */
  rule(): ThirteenRule {
    const system = this.oneOf('system', ['ifc', 'positivist'] as const);
    const kind = this.oneOf('kind', RULE_KINDS);
    switch (kind) {
      case 'monthly':
        return { kind, system, day: this.number('day', 1, DAYS_PER_MONTH) };
      case 'weekly': {
        const weekday = WEEKDAY_CODES.indexOf(this.oneOf('weekday', WEEKDAY_CODES)) as Weekday;
        const interval = this.next('interval') ? (this.number('interval', 1, 2) as 1 | 2) : 1;
        return { kind, system, weekday, interval };
      }
      case 'yearly':
        return { kind, system, month: this.number('month', 1, MONTHS_PER_YEAR), day: this.number('day', 1, DAYS_PER_MONTH) };
      case 'intercalary':
        return { kind, system, id: this.oneOf('day', ['YD', 'LD'] as const) === 'YD' ? 'year-day' : 'leap-day' };
    }
  }
}

/** Splits `text` into `KEY=VALUE` pairs at `separator` (each pair split at its first `=`); throws for an empty or `=`-less pair. */
function splitPairs(text: string, separator: string, context: string): [string, string][] {
  return text.split(separator).map((pair) => {
    const at = pair.indexOf('=');
    if (at <= 0) fail(`${context}: expected KEY=VALUE, got ${show(pair)}`);
    return [pair.slice(0, at), pair.slice(at + 1)];
  });
}

function requireString(text: unknown, context: string): asserts text is string {
  if (typeof text !== 'string') fail(`${context} must be a string, got ${show(text)}`);
}

/**
 * The rule's canonical marker value (§4.3 e), without the property name and
 * parameter `X-THIRTEEN-RULE;VERSION=1:`. Keys in the order `SYSTEM`, `KIND`,
 * then the rule's own: `DAY` (monthly), `WEEKDAY` and, for every 2 weeks,
 * `INTERVAL=2` (weekly), `MONTH` and `DAY` (yearly), `DAY=YD` or `DAY=LD`
 * (intercalary; Positivist All the Dead and Holy Women). Uppercase keys,
 * lowercase values except the weekday and day codes, no spaces.
 *
 * `formatThirteenRuleText({ kind: 'weekly', system: 'ifc', weekday: 4, interval: 2 })`
 * is `'SYSTEM=ifc;KIND=weekly;WEEKDAY=TH;INTERVAL=2'`.
 * @throws RangeError for an invalid rule.
 */
export function formatThirteenRuleText(rule: ThirteenRule): string {
  assertValidThirteenRule(rule);
  return ruleFields(rule, true).join(';');
}

/**
 * Parses a marker value (§4.3 e) with the strict grammar
 * `SYSTEM=(ifc|positivist);KIND=(monthly|weekly|yearly|intercalary)` followed
 * by `DAY=1..28`, `WEEKDAY=SU..SA[;INTERVAL=1|2]`, `MONTH=1..13;DAY=1..28` or
 * `DAY=YD|LD`: keys in that order and case, values in their documented case,
 * numbers without sign or leading zeros, no spaces, no property name and no
 * trailing `;`. {@link formatThirteenRuleText} leaves out `INTERVAL=1`.
 * @throws RangeError for text that does not match the grammar.
 */
export function parseThirteenRuleText(text: string): ThirteenRule {
  requireString(text, '13-month rule text');
  const context = `Invalid 13-month rule text ${show(text)}`;
  const reader = new FieldReader(splitPairs(text, ';', context), true, context);
  const rule = reader.rule();
  reader.done();
  return rule;
}

function formatEnd(end: RepeatEnd): string {
  if (end.kind === 'count') return `count:${end.count}`;
  return end.kind === 'until' ? `until:${toISODate(end.date)}` : 'never';
}

function parseEnd(text: string, context: string): RepeatEnd {
  if (text === 'never') return { kind: 'never' };
  if (text.startsWith('count:')) {
    const digits = text.slice('count:'.length);
    const count = POSITIVE.test(digits) ? Number(digits) : Number.NaN;
    if (isCount(count)) return { kind: 'count', count };
  } else if (text.startsWith('until:')) {
    const date = tryParseISODate(text.slice('until:'.length));
    if (date !== null) return { kind: 'until', date };
  }
  return fail(`${context}: end must be 'never', 'count:N' (N 1..${MAX_INT}) or 'until:YYYY-MM-DD', got ${show(text)}`);
}

function readExtras(extras: unknown): RuleUriExtras {
  const opts = readOptions(extras, ['series', 'part'], 'formatThirteenRuleUri extras');
  const series = opts.series ?? null;
  const part = opts.part ?? null;
  if (series !== null && (typeof series !== 'string' || !UUID.test(series))) {
    fail(`formatThirteenRuleUri: series must be a lowercase UUID or null, got ${show(series)}`);
  }
  if (part !== null && !isCount(part)) fail(`formatThirteenRuleUri: part must be an integer 1..${MAX_INT} or null, got ${show(part)}`);
  if ((series === null) !== (part === null)) fail('formatThirteenRuleUri: series and part must be both set or both null');
  return { series, part } as RuleUriExtras;
}

/**
 * The Android marker URI (§4.3 e) of a rule and its end, stored in
 * `CUSTOM_APP_URI`:
 * `thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never`. Keys in the
 * order `v`, `system`, `kind`, the rule's keys (the marker's, in lowercase:
 * `day`, `weekday`, `interval`, `month`; values as in the marker, so weekday
 * and day codes stay uppercase), `end` (`never`, `count:10` or
 * `until:2027-06-30`), then `series` and `part` for a series stored in parts.
 * Nothing needs percent-encoding.
 * @throws RangeError for an invalid rule or end, a series that is not a
 * lowercase UUID, a part outside `1…2147483647`, or only one of the two.
 */
export function formatThirteenRuleUri(rule: ThirteenRule, end: RepeatEnd, extras?: RuleUriExtras): string {
  assertValidThirteenRule(rule);
  assertValidEnd(end, 'formatThirteenRuleUri');
  const { series, part } = readExtras(extras);
  const fields = ['v=1', ...ruleFields(rule, false), `end=${formatEnd(end)}`];
  if (series !== null) fields.push(`series=${series}`, `part=${part}`);
  return RULE_URI_PREFIX + fields.join('&');
}

/**
 * Parses an Android marker URI (§4.3 e) with the strict grammar written by
 * {@link formatThirteenRuleUri}: the exact prefix `thirteen://rule?`, `v=1`,
 * the keys in order, `series` (a lowercase UUID) and `part` together or not at
 * all. `parseThirteenRuleUri('thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never')`
 * is `{ rule: { kind: 'monthly', system: 'ifc', day: 12 }, end: { kind: 'never' }, series: null, part: null }`.
 * @throws RangeError for anything else, including another version.
 */
export function parseThirteenRuleUri(text: string): { rule: ThirteenRule; end: RepeatEnd } & RuleUriExtras {
  requireString(text, '13-month rule URI');
  const context = `Invalid 13-month rule URI ${show(text)}`;
  if (!text.startsWith(RULE_URI_PREFIX)) fail(`${context}: expected the prefix '${RULE_URI_PREFIX}'`);
  const reader = new FieldReader(splitPairs(text.slice(RULE_URI_PREFIX.length), '&', context), false, context);
  reader.oneOf('v', ['1'] as const);
  const rule = reader.rule();
  const end = parseEnd(reader.take('end'), context);
  let series: string | null = null;
  let part: number | null = null;
  if (reader.next('series')) {
    series = reader.take('series');
    if (!UUID.test(series)) fail(`${context}: series must be a lowercase UUID, got ${show(series)}`);
    part = reader.number('part', 1, MAX_INT);
  }
  reader.done();
  return { rule, end, series, part };
}

/** Percent-encodes every UTF-8 byte outside the RFC 3986 unreserved characters, with uppercase hex. */
function encodeComponent(text: string, context: string): string {
  let encoded: string;
  try {
    encoded = encodeURIComponent(text);
  } catch {
    return fail(`${context} must be well-formed Unicode, got ${show(text)}`);
  }
  return encoded.replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function decodeComponent(text: string): string | null {
  if (!ENCODED_COMPONENT.test(text)) return null;
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * The Android marker of an occurrence copy stored as a separate event (§4.3
 * e): `thirteen://detached?v=1&series={series}&original={yyyy-MM-dd}`, where
 * `series` is the `_SYNC_ID` (or `_ID`) of the series' first part and
 * `original` the occurrence's original date. `series` is percent-encoded:
 * every UTF-8 byte outside `A-Z a-z 0-9 - . _ ~` becomes `%XX` with uppercase
 * hex, so ids with `+`, `/`, `=` or `&` stay one value.
 * @throws RangeError for an empty or malformed series or an invalid date.
 */
export function formatDetachedUri(series: string, original: GregorianDate): string {
  requireString(series, 'formatDetachedUri: series');
  if (series === '') fail('formatDetachedUri: series must not be empty');
  const encoded = encodeComponent(series, 'formatDetachedUri: series');
  return `${DETACHED_URI_PREFIX}v=1&series=${encoded}&original=${toISODate(original)}`;
}

/**
 * Parses a detached marker written by {@link formatDetachedUri}: the exact
 * prefix `thirteen://detached?`, then exactly `v=1`, `series` (percent-encoded,
 * not empty; `%xx` escapes in either case) and `original` (`YYYY-MM-DD`), in
 * that order. `null` for anything else, including a rule URI.
 * @throws RangeError when `text` is not a string.
 */
export function parseDetachedUri(text: string): { series: string; original: GregorianDate } | null {
  requireString(text, 'Detached URI');
  if (!text.startsWith(DETACHED_URI_PREFIX)) return null;
  const pairs = text.slice(DETACHED_URI_PREFIX.length).split('&');
  if (pairs.length !== 3 || pairs[0] !== 'v=1' || !pairs[1]!.startsWith('series=') || !pairs[2]!.startsWith('original=')) {
    return null;
  }
  const series = decodeComponent(pairs[1]!.slice('series='.length));
  const original = tryParseISODate(pairs[2]!.slice('original='.length));
  return series === null || original === null ? null : { series, original };
}
