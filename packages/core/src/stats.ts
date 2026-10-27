/**
 * Year statistics: 12 ragged months vs 13 identical ones (SPEC §3).
 * @module
 */

import {
  type GregorianDate,
  assertValidYear,
  daysInGregorianMonth,
  daysInYear,
  gregorianWeekday,
  isLeapYear,
} from './gregorian.ts';
import { type CalendarSystemId, DEFAULT_SYSTEM_ID, getCalendarSystem } from './systems/index.ts';
import {
  type ThirteenDate,
  DAYS_PER_MONTH,
  MONTH_DAYS_PER_YEAR,
  createMonthDate,
  fixedWeekday,
  fromThirteen,
  intercalaryDaysInYear,
  toDisplayYear,
  toThirteen,
} from './thirteen.ts';
import type { Weekday } from './weekday.ts';

/** The same day in both calendars. */
export interface DatePair {
  readonly gregorian: GregorianDate;
  readonly thirteen: ThirteenDate;
}

/** Comparative statistics for one year. */
export interface YearStats {
  /** Gregorian year. */
  readonly year: number;
  readonly displayYear: number;
  readonly system: CalendarSystemId;
  readonly isLeapYear: boolean;
  readonly daysInYear: number;
  /** 12 lengths, 28–31. */
  readonly gregorianMonthLengths: readonly number[];
  /** 13 × 28. */
  readonly thirteenMonthLengths: readonly number[];
  /** Gregorian Friday-the-13ths of the year (1–3), chronologically. */
  readonly gregorianFriday13ths: readonly DatePair[];
  /** 13-month Friday-the-13ths: all 13 months in IFC, none in Positivist (its 13ths are Saturdays). */
  readonly thirteenFriday13ths: readonly DatePair[];
  /** Distinct Gregorian month shapes: distinct (first weekday, length) pairs (11 in every year). */
  readonly gregorianMonthShapeCount: number;
  /** Distinct 13-month month shapes: always 1. */
  readonly thirteenMonthShapeCount: number;
  /** Gregorian quarter lengths: `[90 | 91, 91, 92, 92]`. */
  readonly gregorianQuarterLengths: readonly number[];
  /** 13-month quarter lengths (3¼ months each, intercalary days excluded): `[91, 91, 91, 91]`. */
  readonly thirteenQuarterLengths: readonly number[];
  /** Real weekday of the first day of the year (1 January). */
  readonly gregorianYearStartWeekday: Weekday;
  /**
   * Fixed weekday of the first day of the 13-month year (day 1 of month 1:
   * IFC January 1, Positivist Moses 1) = the system's `weekStartsOn`.
   */
  readonly thirteenYearStartWeekday: Weekday;
  /** Intercalary days in the year (1, or 2 in leap years). */
  readonly intercalaryDayCount: number;
}

/** Comparative statistics for Gregorian year `gregorianYear`. */
export function yearStats(gregorianYear: number, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): YearStats {
  const year = gregorianYear;
  assertValidYear(year);
  const system = getCalendarSystem(systemId);

  const gregorianMonthLengths = Array.from({ length: 12 }, (_, i) => daysInGregorianMonth(year, i + 1));
  const thirteenMonthLengths = system.months.map(() => DAYS_PER_MONTH);

  const gregorianFriday13ths: DatePair[] = [];
  const shapes = new Set<string>();
  for (let month = 1; month <= 12; month++) {
    const thirteenth: GregorianDate = { year, month, day: 13 };
    if (gregorianWeekday(thirteenth) === 5) {
      gregorianFriday13ths.push({ gregorian: thirteenth, thirteen: toThirteen(thirteenth, system.id) });
    }
    shapes.add(`${gregorianWeekday({ year, month, day: 1 })}:${gregorianMonthLengths[month - 1]}`);
  }

  const thirteenFriday13ths: DatePair[] =
    fixedWeekday(13, system.id) === 5
      ? system.months.map((m) => {
          const thirteen = createMonthDate(year, m.index, 13, system.id);
          return { gregorian: fromThirteen(thirteen), thirteen };
        })
      : [];

  const q = gregorianMonthLengths;
  const sum = (from: number) => q[from]! + q[from + 1]! + q[from + 2]!;
  const quarter = MONTH_DAYS_PER_YEAR / 4;

  return {
    year,
    displayYear: toDisplayYear(year, system.id),
    system: system.id,
    isLeapYear: isLeapYear(year),
    daysInYear: daysInYear(year),
    gregorianMonthLengths,
    thirteenMonthLengths,
    gregorianFriday13ths,
    thirteenFriday13ths,
    gregorianMonthShapeCount: shapes.size,
    thirteenMonthShapeCount: 1,
    gregorianQuarterLengths: [sum(0), sum(3), sum(6), sum(9)],
    thirteenQuarterLengths: [quarter, quarter, quarter, quarter],
    gregorianYearStartWeekday: gregorianWeekday({ year, month: 1, day: 1 }),
    thirteenYearStartWeekday: fixedWeekday(1, system.id),
    intercalaryDayCount: intercalaryDaysInYear(year, system.id).length,
  };
}
