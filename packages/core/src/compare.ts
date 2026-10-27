/**
 * Gregorian vs 13-month comparison ("diff") semantics (SPEC §3) and the
 * "read this label in the other calendar" reverse lookups.
 * @module
 */

import {
  type GregorianDate,
  assertValidGregorian,
  daysInGregorianMonth,
  daysInYear,
  diffGregorianDays,
  gregorianDayOfYear,
  gregorianFromDayOfYear,
  gregorianWeekday,
  isLeapYear,
} from './gregorian.ts';
import { type CalendarSystemId, DEFAULT_SYSTEM_ID, getCalendarSystem } from './systems/index.ts';
import {
  type ThirteenDate,
  type ThirteenMonthDate,
  DAYS_PER_MONTH,
  assertValidThirteenDate,
  copyThirteen,
  createMonthDate,
  fromThirteen,
  intercalaryDayOfYear,
  thirteenWeekday,
  toThirteen,
} from './thirteen.ts';
import { type Weekday, toWeekday } from './weekday.ts';

/** Everything that differs between a Gregorian date and its 13-month equivalent (SPEC §3). */
export interface Comparison {
  /** The input date (a fresh copy). */
  readonly gregorian: GregorianDate;
  /** The same day in the 13-month system. */
  readonly thirteen: ThirteenDate;
  /** Shared day-of-year, `1…366`. */
  readonly dayOfYear: number;
  readonly isLeapYear: boolean;
  /** Real-world weekday. */
  readonly gregorianWeekday: Weekday;
  /** Fixed 13-month weekday, `null` on intercalary days. */
  readonly thirteenWeekday: Weekday | null;
  /** `(thirteenWeekday − gregorianWeekday) mod 7` in `0…6`; `null` on intercalary days. */
  readonly weekdayShift: number | null;
  /**
   * Days from the Gregorian date carrying the same month-name + day label as
   * the 13-month date, to the input (`input − labelDate`). Positive: the
   * 13-month label runs behind (2026-10-19 = IFC October 12 ⇒ 7). `null` when
   * the month has no Gregorian namesake (Sol, Positivist, intercalary) or the
   * label does not exist in the Gregorian year.
   */
  readonly labelDrift: number | null;
  /** Length of the Gregorian month containing the date (28–31). */
  readonly gregorianMonthDays: number;
  /** Length of the 13-month month (always 28), or `null` on intercalary days. */
  readonly thirteenMonthDays: number | null;
  /** Whole days of the year elapsed before this date (`dayOfYear − 1`). */
  readonly daysIntoYear: number;
  /** Whole days of the year remaining after this date (`daysInYear − dayOfYear`). */
  readonly daysRemainingInYear: number;
  /** Fraction of the year elapsed at the start of this date: `daysIntoYear / daysInYear`, in `[0, 1)`. */
  readonly yearProgress: number;
}

/**
 * The Gregorian date carrying the same month-name + day label as a 13-month
 * date (IFC October 12, 2026 → 2026-10-12), or `null` if there is none
 * (Sol, every Positivist month, intercalary days, or a non-existent label).
 */
export function sameLabelInGregorian(date: ThirteenDate): GregorianDate | null {
  assertValidThirteenDate(date);
  if (date.kind !== 'month') return null;
  const month = getCalendarSystem(date.system).months[date.month - 1]!.gregorianNameEquivalent;
  if (month === null || date.day > daysInGregorianMonth(date.year, month)) return null;
  return { year: date.year, month, day: date.day };
}

/**
 * The 13-month date carrying the same month-name + day label as a Gregorian
 * date (2026-10-12 → IFC October 12, 2026), or `null` if the system has no
 * month of that name (Positivist) or the day is 29–31.
 */
export function sameLabelInThirteen(
  date: GregorianDate,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): ThirteenMonthDate | null {
  assertValidGregorian(date);
  const system = getCalendarSystem(systemId);
  const month = system.months.find((m) => m.gregorianNameEquivalent === date.month);
  if (!month || date.day > DAYS_PER_MONTH) return null;
  return createMonthDate(date.year, month.index, date.day, system.id);
}

/**
 * Compares a Gregorian date with its 13-month equivalent (SPEC §3).
 * @throws RangeError for invalid dates or system ids.
 */
export function compare(date: GregorianDate, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): Comparison {
  assertValidGregorian(date);
  const thirteen = toThirteen(date, systemId);
  const doy = gregorianDayOfYear(date);
  const total = daysInYear(date.year);
  const realWeekday = gregorianWeekday(date);
  const fixed = thirteenWeekday(thirteen);
  const label = sameLabelInGregorian(thirteen);
  return {
    gregorian: { year: date.year, month: date.month, day: date.day },
    thirteen,
    dayOfYear: doy,
    isLeapYear: isLeapYear(date.year),
    gregorianWeekday: realWeekday,
    thirteenWeekday: fixed,
    weekdayShift: fixed === null ? null : toWeekday(fixed - realWeekday),
    labelDrift: label === null ? null : diffGregorianDays(date, label),
    gregorianMonthDays: daysInGregorianMonth(date.year, date.month),
    thirteenMonthDays: thirteen.kind === 'month' ? DAYS_PER_MONTH : null,
    daysIntoYear: doy - 1,
    daysRemainingInYear: total - doy,
    yearProgress: (doy - 1) / total,
  };
}

/** Reverse lookup for a Gregorian label (SPEC §3 "read this label in the other calendar"). */
export interface GregorianLabelLookup {
  /** The Gregorian date looked up (a fresh copy). */
  readonly gregorian: GregorianDate;
  /** The 13-month date that falls on that day. */
  readonly fallsOn: ThirteenDate;
  /** The 13-month date carrying the same label, or `null` (see {@link sameLabelInThirteen}). */
  readonly sameLabel: ThirteenMonthDate | null;
  /** The Gregorian day on which `sameLabel` falls, or `null`. */
  readonly sameLabelFallsOn: GregorianDate | null;
}

/** Both readings of a Gregorian label in a 13-month system. */
export function lookupGregorianLabel(
  date: GregorianDate,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): GregorianLabelLookup {
  const sameLabel = sameLabelInThirteen(date, systemId);
  return {
    gregorian: { year: date.year, month: date.month, day: date.day },
    fallsOn: toThirteen(date, systemId),
    sameLabel,
    sameLabelFallsOn: sameLabel === null ? null : fromThirteen(sameLabel),
  };
}

/** Reverse lookup for a 13-month label. */
export interface ThirteenLabelLookup {
  /** The 13-month date looked up (a fresh, normalised copy: only the documented fields). */
  readonly thirteen: ThirteenDate;
  /** The Gregorian date it falls on. */
  readonly fallsOn: GregorianDate;
  /** The Gregorian date carrying the same label, or `null` (see {@link sameLabelInGregorian}). */
  readonly sameLabel: GregorianDate | null;
  /** The 13-month date falling on `sameLabel`, or `null`. */
  readonly sameLabelFallsOn: ThirteenDate | null;
}

/** Both readings of a 13-month label in the Gregorian calendar. */
export function lookupThirteenLabel(date: ThirteenDate): ThirteenLabelLookup {
  const sameLabel = sameLabelInGregorian(date); // validates first
  return {
    thirteen: copyThirteen(date),
    fallsOn: fromThirteen(date),
    sameLabel,
    sameLabelFallsOn: sameLabel === null ? null : toThirteen(sameLabel, date.system),
  };
}

/**
 * Days from `date` until the next year-day (IFC Year Day / Positivist Festival
 * of All the Dead) on or after it; `0` on the year-day itself.
 */
export function daysUntilYearDay(date: GregorianDate, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): number {
  assertValidGregorian(date);
  const doy = gregorianDayOfYear(date);
  const thisYear = intercalaryDayOfYear(date.year, 'year-day', systemId)!;
  if (doy <= thisYear) return thisYear - doy;
  const nextYear = date.year + 1;
  return diffGregorianDays(gregorianFromDayOfYear(nextYear, intercalaryDayOfYear(nextYear, 'year-day', systemId)!), date);
}
