/**
 * Calendar grid layouts for rendering: perfect 4 × 7 13-month grids and
 * ragged Gregorian month grids annotated with their 13-month equivalents.
 *
 * Field naming (SPEC §4): `month` is always the 1-based month **number** and
 * `monthInfo` the static info object; weekday fields are always qualified
 * (`thirteenWeekday` = fixed 13-month weekday, `gregorianWeekday` = real weekday).
 * @module
 */

import {
  type GregorianDate,
  type GregorianMonthInfo,
  GREGORIAN_MONTHS,
  assertValidYear,
  daysInGregorianMonth,
  daysInYear,
  gregorianDayOfYear,
  gregorianFromDayOfYear,
  gregorianWeekday,
  isLeapYear,
} from './gregorian.ts';
import { fail, readOptions, show } from './internal.ts';
import {
  type CalendarSystemId,
  type ThirteenMonthInfo,
  DEFAULT_SYSTEM_ID,
  getCalendarSystem,
  thirteenMonthInfo,
} from './systems/index.ts';
import {
  type IntercalaryOccurrence,
  type ThirteenDate,
  type ThirteenMonthDate,
  DAYS_PER_WEEK,
  WEEKS_PER_MONTH,
  fixedWeekday,
  intercalaryDaysInYear,
  monthDays,
  thirteenFromDayOfYear,
  thirteenWeekday,
  toDisplayYear,
} from './thirteen.ts';
import { type Weekday, isWeekday, orderedWeekdays, toWeekday } from './weekday.ts';

/** One day in a 13-month grid. */
export interface DayCell {
  readonly thirteen: ThirteenMonthDate;
  readonly gregorian: GregorianDate;
  /** Shared day-of-year, `1…366`. */
  readonly dayOfYear: number;
  /** Fixed 13-month weekday (equals the cell's column weekday). */
  readonly thirteenWeekday: Weekday;
  /** Real-world weekday of `gregorian`. */
  readonly gregorianWeekday: Weekday;
  /** `true` when `gregorian.day === 1` (a Gregorian month begins here). */
  readonly isGregorianMonthStart: boolean;
}

/** A 13-month month as a perfect grid. */
export interface ThirteenMonthLayout {
  /** Gregorian year. */
  readonly year: number;
  readonly system: CalendarSystemId;
  /** Month number, `1…13`. */
  readonly month: number;
  readonly monthInfo: ThirteenMonthInfo;
  /** Column weekdays, starting with the system's `weekStartsOn`. */
  readonly weekdays: readonly Weekday[];
  /** Exactly 4 weeks × 7 days; `weeks[w][d]` is day `w * 7 + d + 1`. */
  readonly weeks: readonly (readonly DayCell[])[];
}

/** A complete 13-month year for rendering. */
export interface ThirteenYearLayout {
  /** Gregorian year. */
  readonly year: number;
  /** The system's year number (see `toDisplayYear`). */
  readonly displayYear: number;
  readonly system: CalendarSystemId;
  readonly isLeapYear: boolean;
  readonly daysInYear: number;
  /** Column weekdays, starting with the system's `weekStartsOn`. */
  readonly weekdays: readonly Weekday[];
  /** The 13 month grids in order. */
  readonly months: readonly ThirteenMonthLayout[];
  /**
   * Intercalary days in chronological order; render each after month
   * `afterMonth` (IFC Leap Day after June = 6, year-end days after 13).
   */
  readonly intercalary: readonly IntercalaryOccurrence[];
}

/** One day in a Gregorian month grid. */
export interface GregorianDayCell {
  readonly gregorian: GregorianDate;
  /** The 13-month date falling on this day (may be intercalary). */
  readonly thirteen: ThirteenDate;
  readonly dayOfYear: number;
  /** Real-world weekday (equals the cell's column weekday). */
  readonly gregorianWeekday: Weekday;
  /** Fixed 13-month weekday, `null` on intercalary days. */
  readonly thirteenWeekday: Weekday | null;
  /** `true` when a 13-month month begins here (`thirteen.day === 1`). */
  readonly isThirteenMonthStart: boolean;
}

/** A Gregorian month as a ragged grid. */
export interface GregorianMonthLayout {
  /** Gregorian year. */
  readonly year: number;
  /** Month number, `1…12`. */
  readonly month: number;
  readonly monthInfo: GregorianMonthInfo;
  readonly system: CalendarSystemId;
  readonly weekStartsOn: Weekday;
  /** Column weekdays, starting with `weekStartsOn`. */
  readonly weekdays: readonly Weekday[];
  /** Number of `null` cells before day 1 (`0…6`). */
  readonly leadingBlanks: number;
  /** 4–6 rows of exactly 7 entries; `null` pads before day 1 and after the last day. */
  readonly weeks: readonly (readonly (GregorianDayCell | null)[])[];
}

/** Options for {@link buildGregorianMonth}. Unknown keys are rejected. */
export interface GregorianMonthOptions {
  /** First column weekday. Default: the system's `weekStartsOn` (IFC Sunday, Positivist Monday). */
  readonly weekStartsOn?: Weekday;
}

/** Grid for 13-month month `month` (`1…13`) of Gregorian year `gregorianYear`. */
export function buildThirteenMonth(
  gregorianYear: number,
  month: number,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): ThirteenMonthLayout {
  const year = gregorianYear;
  const system = getCalendarSystem(systemId);
  const monthInfo = thirteenMonthInfo(month, system.id);
  const days = monthDays(year, month, system.id);
  const firstDayOfYear = gregorianDayOfYear(days[0]!);
  const weeks: DayCell[][] = [];
  for (let w = 0; w < WEEKS_PER_MONTH; w++) {
    const row: DayCell[] = [];
    for (let d = 0; d < DAYS_PER_WEEK; d++) {
      const day = w * DAYS_PER_WEEK + d + 1;
      const gregorian = days[day - 1]!;
      row.push({
        thirteen: { kind: 'month', system: system.id, year, month, day },
        gregorian,
        dayOfYear: firstDayOfYear + day - 1,
        thirteenWeekday: fixedWeekday(day, system.id),
        gregorianWeekday: gregorianWeekday(gregorian),
        isGregorianMonthStart: gregorian.day === 1,
      });
    }
    weeks.push(row);
  }
  return { year, system: system.id, month, monthInfo, weekdays: orderedWeekdays(system.weekStartsOn), weeks };
}

/** All 13 month grids plus the intercalary day(s) of Gregorian year `gregorianYear`. */
export function buildThirteenYear(
  gregorianYear: number,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): ThirteenYearLayout {
  const year = gregorianYear;
  assertValidYear(year);
  const system = getCalendarSystem(systemId);
  return {
    year,
    displayYear: toDisplayYear(year, system.id),
    system: system.id,
    isLeapYear: isLeapYear(year),
    daysInYear: daysInYear(year),
    weekdays: orderedWeekdays(system.weekStartsOn),
    months: system.months.map((m) => buildThirteenMonth(year, m.index, system.id)),
    intercalary: intercalaryDaysInYear(year, system.id),
  };
}

/**
 * Grid for Gregorian month `month` (`1…12`) of `gregorianYear`, each cell
 * annotated with its 13-month equivalent in `systemId`. Columns start on
 * `options.weekStartsOn`, defaulting to the system's own week start so a
 * Gregorian grid lines up with the 13-month grids next to it.
 * @throws RangeError for an invalid year, month, system, options bag or weekday.
 */
export function buildGregorianMonth(
  gregorianYear: number,
  month: number,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
  options?: GregorianMonthOptions,
): GregorianMonthLayout {
  const year = gregorianYear;
  const length = daysInGregorianMonth(year, month);
  const system = getCalendarSystem(systemId);
  const bag = readOptions(options, ['weekStartsOn'], 'buildGregorianMonth');
  const weekStartsOn = bag.weekStartsOn === undefined ? system.weekStartsOn : bag.weekStartsOn;
  if (!isWeekday(weekStartsOn)) fail(`Invalid weekStartsOn: ${show(weekStartsOn)} (expected an integer 0..6)`);
  const first: GregorianDate = { year, month, day: 1 };
  const firstDayOfYear = gregorianDayOfYear(first);
  const leadingBlanks = toWeekday(gregorianWeekday(first) - weekStartsOn);
  const cells: (GregorianDayCell | null)[] = Array.from({ length: leadingBlanks }, () => null);
  for (let day = 1; day <= length; day++) {
    const doy = firstDayOfYear + day - 1;
    const gregorian = gregorianFromDayOfYear(year, doy);
    const thirteen = thirteenFromDayOfYear(year, doy, system.id);
    cells.push({
      gregorian,
      thirteen,
      dayOfYear: doy,
      gregorianWeekday: gregorianWeekday(gregorian),
      thirteenWeekday: thirteenWeekday(thirteen),
      isThirteenMonthStart: thirteen.kind === 'month' && thirteen.day === 1,
    });
  }
  while (cells.length % DAYS_PER_WEEK !== 0) cells.push(null);
  const weeks: (GregorianDayCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += DAYS_PER_WEEK) weeks.push(cells.slice(i, i + DAYS_PER_WEEK));
  return {
    year,
    month,
    monthInfo: GREGORIAN_MONTHS[month - 1]!,
    system: system.id,
    weekStartsOn,
    weekdays: orderedWeekdays(weekStartsOn),
    leadingBlanks,
    weeks,
  };
}
