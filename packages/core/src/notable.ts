/**
 * Well-known fixed-date Gregorian days, used to show "your days in the
 * 13-month calendar". Only month/day labels — no year-specific claims.
 * @module
 */

import { type GregorianDate, assertValidYear } from './gregorian.ts';
import { deepFreeze } from './internal.ts';
import { type CalendarSystemId, DEFAULT_SYSTEM_ID } from './systems/index.ts';
import { type ThirteenDate, type ThirteenMonthDate, toThirteen } from './thirteen.ts';
import { sameLabelInThirteen } from './compare.ts';

/** A day celebrated on the same Gregorian month/day every year. */
export interface NotableDate {
  /** Stable kebab-case id, e.g. `"pi-day"`. */
  readonly id: string;
  readonly name: string;
  /** Gregorian month, `1…12`. */
  readonly month: number;
  /** Gregorian day (never 29 February, so it exists every year). */
  readonly day: number;
}

/** Notable fixed Gregorian dates in chronological order. */
export const NOTABLE_DATES: readonly NotableDate[] = deepFreeze([
  { id: 'new-years-day', name: 'New Year’s Day', month: 1, day: 1 },
  { id: 'valentines-day', name: 'Valentine’s Day', month: 2, day: 14 },
  { id: 'international-womens-day', name: 'International Women’s Day', month: 3, day: 8 },
  { id: 'pi-day', name: 'Pi Day', month: 3, day: 14 },
  { id: 'earth-day', name: 'Earth Day', month: 4, day: 22 },
  { id: 'halloween', name: 'Halloween', month: 10, day: 31 },
  { id: 'christmas-day', name: 'Christmas Day', month: 12, day: 25 },
  { id: 'new-years-eve', name: 'New Year’s Eve', month: 12, day: 31 },
]);

/** A notable date resolved for a specific year and system. */
export interface NotableDateInYear {
  readonly notable: NotableDate;
  readonly gregorian: GregorianDate;
  /** The 13-month date the day falls on. */
  readonly thirteen: ThirteenDate;
  /** The 13-month date carrying the same label (IFC only; `null` for Positivist or day > 28). */
  readonly sameLabel: ThirteenMonthDate | null;
}

/** {@link NOTABLE_DATES} resolved for Gregorian year `gregorianYear` in a system. `notable` is the shared frozen entry. */
export function notableDatesInYear(
  gregorianYear: number,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): NotableDateInYear[] {
  const year = gregorianYear;
  assertValidYear(year);
  return NOTABLE_DATES.map((notable) => {
    const gregorian: GregorianDate = { year, month: notable.month, day: notable.day };
    return {
      notable,
      gregorian,
      thirteen: toThirteen(gregorian, systemId),
      sameLabel: sameLabelInThirteen(gregorian, systemId),
    };
  });
}
