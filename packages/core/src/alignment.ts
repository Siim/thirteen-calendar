/**
 * Month alignment (SPEC §3): where every 13-month month starts/ends in the
 * Gregorian calendar and vice versa — data for "ribbon" visualisations.
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
  isLeapYear,
} from './gregorian.ts';
import { type CalendarSystemId, type ThirteenMonthInfo, DEFAULT_SYSTEM_ID, getCalendarSystem } from './systems/index.ts';
import {
  type IntercalaryOccurrence,
  type ThirteenDate,
  DAYS_PER_MONTH,
  createMonthDate,
  intercalaryDaysInYear,
  thirteenDayOfYear,
  thirteenFromDayOfYear,
  toDisplayYear,
} from './thirteen.ts';

/** A 13-month month positioned on the Gregorian year. */
export interface ThirteenMonthSpan {
  /** Month number, `1…13`. */
  readonly month: number;
  readonly monthInfo: ThirteenMonthInfo;
  /** Gregorian date of day 1. */
  readonly start: GregorianDate;
  /** Gregorian date of day 28. */
  readonly end: GregorianDate;
  readonly startDayOfYear: number;
  readonly endDayOfYear: number;
  /** Always 28. */
  readonly length: number;
}

/** A Gregorian month positioned on the 13-month year. */
export interface GregorianMonthSpan {
  /** Month number, `1…12`. */
  readonly month: number;
  readonly monthInfo: GregorianMonthInfo;
  /** 13-month date of the 1st. */
  readonly start: ThirteenDate;
  /** 13-month date of the last day (Gregorian 31 December is an intercalary day). */
  readonly end: ThirteenDate;
  readonly startDayOfYear: number;
  readonly endDayOfYear: number;
  /** 28–31. */
  readonly length: number;
}

/** Both month sequences of one year on a shared day-of-year axis. */
export interface MonthAlignment {
  /** Gregorian year. */
  readonly year: number;
  readonly displayYear: number;
  readonly system: CalendarSystemId;
  readonly isLeapYear: boolean;
  readonly daysInYear: number;
  /** 13 spans; together with `intercalary` they tile days `1…daysInYear` exactly. */
  readonly thirteenMonths: readonly ThirteenMonthSpan[];
  /** 12 spans tiling days `1…daysInYear` exactly. */
  readonly gregorianMonths: readonly GregorianMonthSpan[];
  /** The intercalary day(s), chronologically. */
  readonly intercalary: readonly IntercalaryOccurrence[];
}

/** Month boundaries of Gregorian year `gregorianYear` in both calendars. */
export function monthAlignment(
  gregorianYear: number,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): MonthAlignment {
  const year = gregorianYear;
  assertValidYear(year);
  const system = getCalendarSystem(systemId);

  const thirteenMonths = system.months.map((monthInfo): ThirteenMonthSpan => {
    const startDayOfYear = thirteenDayOfYear(createMonthDate(year, monthInfo.index, 1, system.id));
    const endDayOfYear = startDayOfYear + DAYS_PER_MONTH - 1;
    return {
      month: monthInfo.index,
      monthInfo,
      start: gregorianFromDayOfYear(year, startDayOfYear),
      end: gregorianFromDayOfYear(year, endDayOfYear),
      startDayOfYear,
      endDayOfYear,
      length: DAYS_PER_MONTH,
    };
  });

  const gregorianMonths = GREGORIAN_MONTHS.map((monthInfo): GregorianMonthSpan => {
    const length = daysInGregorianMonth(year, monthInfo.index);
    const startDayOfYear = gregorianDayOfYear({ year, month: monthInfo.index, day: 1 });
    const endDayOfYear = startDayOfYear + length - 1;
    return {
      month: monthInfo.index,
      monthInfo,
      start: thirteenFromDayOfYear(year, startDayOfYear, system.id),
      end: thirteenFromDayOfYear(year, endDayOfYear, system.id),
      startDayOfYear,
      endDayOfYear,
      length,
    };
  });

  return {
    year,
    displayYear: toDisplayYear(year, system.id),
    system: system.id,
    isLeapYear: isLeapYear(year),
    daysInYear: daysInYear(year),
    thirteenMonths,
    gregorianMonths,
    intercalary: intercalaryDaysInYear(year, system.id),
  };
}
