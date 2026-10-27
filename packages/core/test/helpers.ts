import {
  type CalendarSystemId,
  type GregorianDate,
  type ThirteenDate,
  daysInYear,
  gregorianFromDayOfYear,
  isLeapYear,
  parseISODate,
} from '../src/index.ts';

/** Shorthand for `parseISODate`. */
export const g = (iso: string): GregorianDate => parseISODate(iso);

/** Every Gregorian date of `year`, in order. */
export function everyDay(year: number): GregorianDate[] {
  return Array.from({ length: daysInYear(year) }, (_, i) => gregorianFromDayOfYear(year, i + 1));
}

export const SYSTEMS: readonly CalendarSystemId[] = ['ifc', 'positivist'];

/** Years whose every day is round-tripped (task brief). */
export const ROUND_TRIP_YEARS: readonly number[] = [1, 1600, 1900, 2000, 2023, 2024, 2025, 2026, 2100, 9999];

/**
 * Independent oracle: the SPEC §1.1 / §1.2 day-of-year mapping, written out
 * literally (no shared code with the implementation).
 */
export function specMapping(
  year: number,
  d: number,
  system: CalendarSystemId,
): { month: number; day: number } | 'year-day' | 'leap-day' {
  const L = isLeapYear(year);
  const md = (n: number) => ({ month: Math.floor((n - 1) / 28) + 1, day: ((n - 1) % 28) + 1 });
  if (system === 'ifc') {
    if (!L) return d <= 364 ? md(d) : 'year-day';
    if (d <= 168) return md(d);
    if (d === 169) return 'leap-day';
    if (d <= 365) return md(d - 1);
    return 'year-day';
  }
  if (d <= 364) return md(d);
  return d === 365 ? 'year-day' : 'leap-day';
}

/** Compact representation of a ThirteenDate for assertions. */
export function brief(td: ThirteenDate): string {
  return td.kind === 'month' ? `${td.system}:${td.year}/${td.month}/${td.day}` : `${td.system}:${td.year}/${td.id}`;
}
