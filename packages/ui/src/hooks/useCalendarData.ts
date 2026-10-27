/**
 * Memoised core calls. Every hook keys its memo on primitives (years,
 * month numbers, system ids, ISO strings) so re-renders with equal inputs
 * reuse the same result objects.
 */
import {
  type CalendarSystemId,
  type Comparison,
  type GregorianDate,
  type GregorianMonthLayout,
  type MonthAlignment,
  type NotableDateInYear,
  type ThirteenMonthLayout,
  type ThirteenSlot,
  type ThirteenYearLayout,
  type YearStats,
  buildGregorianMonth,
  buildThirteenMonth,
  buildThirteenYear,
  compare,
  daysUntilYearDay,
  monthAlignment,
  notableDatesInYear,
  parseISODate,
  thirteenSlots,
  toISODate,
  yearStats,
} from '@thirteen/core';
import { useMemo } from 'react';

/** `buildThirteenYear(year, systemId)`. */
export function useYearLayout(year: number, systemId: CalendarSystemId): ThirteenYearLayout {
  return useMemo(() => buildThirteenYear(year, systemId), [year, systemId]);
}

/** `buildThirteenMonth(year, month, systemId)`. */
export function useMonthLayout(year: number, month: number, systemId: CalendarSystemId): ThirteenMonthLayout {
  return useMemo(() => buildThirteenMonth(year, month, systemId), [year, month, systemId]);
}

/** `buildGregorianMonth(year, month, systemId)` (columns follow the system's week start). */
export function useGregorianMonthLayout(year: number, month: number, systemId: CalendarSystemId): GregorianMonthLayout {
  return useMemo(() => buildGregorianMonth(year, month, systemId), [year, month, systemId]);
}

/** The 12 Gregorian month layouts of a year, annotated for `systemId`. */
export function useGregorianYearLayouts(year: number, systemId: CalendarSystemId): GregorianMonthLayout[] {
  return useMemo(
    () => Array.from({ length: 12 }, (_, i) => buildGregorianMonth(year, i + 1, systemId)),
    [year, systemId],
  );
}

/** `monthAlignment(year, systemId)`. */
export function useMonthAlignment(year: number, systemId: CalendarSystemId): MonthAlignment {
  return useMemo(() => monthAlignment(year, systemId), [year, systemId]);
}

/** `yearStats(year, systemId)`. */
export function useYearStats(year: number, systemId: CalendarSystemId): YearStats {
  return useMemo(() => yearStats(year, systemId), [year, systemId]);
}

/** `thirteenSlots(year, systemId)` (picker order). */
export function useThirteenSlots(year: number, systemId: CalendarSystemId): ThirteenSlot[] {
  return useMemo(() => thirteenSlots(year, systemId), [year, systemId]);
}

/** `notableDatesInYear(year, systemId)`. */
export function useNotableDates(year: number, systemId: CalendarSystemId): NotableDateInYear[] {
  return useMemo(() => notableDatesInYear(year, systemId), [year, systemId]);
}

/** `compare(date, systemId)`, memoised on the ISO date. */
export function useComparison(date: GregorianDate, systemId: CalendarSystemId): Comparison {
  const iso = toISODate(date);
  return useMemo(() => compare(parseISODate(iso), systemId), [iso, systemId]);
}

/** `daysUntilYearDay(date, systemId)`, memoised on the ISO date. */
export function useDaysUntilYearDay(date: GregorianDate, systemId: CalendarSystemId): number {
  const iso = toISODate(date);
  return useMemo(() => daysUntilYearDay(parseISODate(iso), systemId), [iso, systemId]);
}
