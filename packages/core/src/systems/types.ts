/**
 * Data model of a perennial 13 × 28 calendar system (SPEC §1).
 * Systems are pure data so that they can be mirrored 1:1 in Swift.
 * @module
 */

import type { Weekday } from '../weekday.ts';

/** Identifier of a supported calendar system. `'ifc'` is the default. */
export type CalendarSystemId = 'ifc' | 'positivist';

/**
 * Identifier of an intercalary (month-less, week-less) day.
 * - `'year-day'`: the annual day — IFC "Year Day", Positivist "Festival of All the Dead".
 * - `'leap-day'`: the leap-year day — IFC "Leap Day", Positivist "Festival of Holy Women".
 */
export type IntercalaryDayId = 'year-day' | 'leap-day';

/** Static information about one of the 13 months of a system. */
export interface ThirteenMonthInfo {
  /** Month number, `1…13`. */
  readonly index: number;
  /** Display name, e.g. `"Sol"`, `"Descartes"`. */
  readonly name: string;
  /** Three/four-letter abbreviation, e.g. `"Sol"`, `"Des"`. */
  readonly shortName: string;
  /**
   * The Gregorian month (`1…12`) whose name this month carries, or `null` when
   * there is no namesake (IFC Sol, every Positivist month). Drives `labelDrift`.
   */
  readonly gregorianNameEquivalent: number | null;
  /** Optional note on the name (etymology or Comte's theme for the month). */
  readonly meaning?: string;
}

/** Static information about an intercalary day of a system. */
export interface IntercalaryDayInfo {
  readonly id: IntercalaryDayId;
  /** Compact code used by numeric formatting: `'YD'` (year-day) or `'LD'` (leap-day). */
  readonly code: 'YD' | 'LD';
  /** Display name, e.g. `"Year Day"`, `"Festival of All the Dead"`. */
  readonly name: string;
  /** Compact display name, e.g. `"Year Day"`, `"All the Dead"`. */
  readonly shortName: string;
  /** One-sentence description of where the day falls. */
  readonly description: string;
  /** `true` when the day only exists in Gregorian leap years. */
  readonly leapOnly: boolean;
  /** The day comes after day 28 of this month (`1…13`); e.g. 6 for the IFC Leap Day. */
  readonly afterMonth: number;
  /**
   * Gregorian day-of-year on which the day falls: `common` in non-leap years
   * (`null` when it does not exist), `leap` in leap years.
   */
  readonly dayOfYear: { readonly common: number | null; readonly leap: number };
}

/** One dated event in a calendar's history (for the Compare view timeline). */
export interface HistoryEvent {
  /** Gregorian year of the event. */
  readonly year: number;
  /** One sentence describing the event. */
  readonly text: string;
}

/** Descriptive (non-arithmetic) information shared by every calendar, including the Gregorian one. */
export interface CalendarDescriptor {
  /** Full name, e.g. `"International Fixed Calendar"`. */
  readonly name: string;
  /** Compact name for switchers, e.g. `"IFC"`. */
  readonly shortName: string;
  /** Person who proposed (or, for the Gregorian calendar, promulgated) the calendar. */
  readonly inventor: string;
  /** Year the calendar was proposed / first presented / promulgated. */
  readonly proposedYear: number;
  /** One- or two-sentence history. */
  readonly summary: string;
  /** Key dated events, chronologically (ascending `year`). */
  readonly history: readonly HistoryEvent[];
}

/** A complete 13 × 28 perennial calendar definition. */
export interface CalendarSystem extends CalendarDescriptor {
  readonly id: CalendarSystemId;
  /** The 13 months in order (`months[0].index === 1`). */
  readonly months: readonly ThirteenMonthInfo[];
  /** Weekday of day 1 of every month; day `n` falls on `(weekStartsOn + n − 1) mod 7`. */
  readonly weekStartsOn: Weekday;
  /** `displayYear = gregorianYear + yearOffset` (IFC 0, Positivist −1788). */
  readonly yearOffset: number;
  /** Intercalary days in chronological order within a leap year. */
  readonly intercalaryDays: readonly IntercalaryDayInfo[];
}
