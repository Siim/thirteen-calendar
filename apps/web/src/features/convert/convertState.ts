/**
 * Converter state lives in the URL: `?date=YYYY-MM-DD` (Gregorian input) or
 * `?thirteen=YYYY-Mmm-dd&system=…` (13-month input, display year). This
 * module turns those raw strings into a resolved state and back.
 */
import {
  type CalendarSystemId,
  type GregorianDate,
  type ThirteenDate,
  createIntercalaryDate,
  createMonthDate,
  formatThirteen,
  fromThirteen,
  getCalendarSystem,
  sameSlotInYear,
  toISODate,
  toThirteen,
  tryParseISODate,
  tryParseThirteen,
} from '@thirteen/core';
import type { Route } from '../../app/router.ts';

export type ConvertSource = 'gregorian' | 'thirteen';

export interface ConvertState {
  /** Which side is the input. */
  readonly source: ConvertSource;
  /** The day being converted. */
  readonly gregorian: GregorianDate;
  /** The same day in the display system. */
  readonly thirteen: ThirteenDate;
  /** Set when the URL value could not be read (the state then falls back to `today`). */
  readonly error: string | null;
}

export interface ConvertParams {
  readonly date: string | null;
  readonly thirteen: string | null;
  readonly system: CalendarSystemId | null;
}

/** Resolves URL parameters against the display system and today. */
export function resolveConvertState(params: ConvertParams, systemId: CalendarSystemId, today: GregorianDate): ConvertState {
  if (params.thirteen !== null) {
    const parsed = tryParseThirteen(params.thirteen, params.system ?? systemId);
    if (parsed) {
      const gregorian = fromThirteen(parsed);
      return { source: 'thirteen', gregorian, thirteen: toThirteen(gregorian, systemId), error: null };
    }
    return {
      source: 'thirteen',
      gregorian: today,
      thirteen: toThirteen(today, systemId),
      error: `“${params.thirteen}” is not a ${getCalendarSystem(params.system ?? systemId).shortName} date. Use the numeric form YYYY-Mmm-dd, YYYY-YD or YYYY-LD (for example ${formatThirteen(toThirteen(today, params.system ?? systemId), { style: 'numeric' })}).`,
    };
  }
  if (params.date !== null) {
    const parsed = tryParseISODate(params.date);
    if (parsed) return { source: 'gregorian', gregorian: parsed, thirteen: toThirteen(parsed, systemId), error: null };
    return {
      source: 'gregorian',
      gregorian: today,
      thirteen: toThirteen(today, systemId),
      error: `“${params.date}” is not a Gregorian date between 0001-01-01 and 9999-12-31 (use YYYY-MM-DD).`,
    };
  }
  return { source: 'gregorian', gregorian: today, thirteen: toThirteen(today, systemId), error: null };
}

/** Route for a Gregorian input. */
export function gregorianRoute(date: GregorianDate): Route {
  return { name: 'convert', date: toISODate(date), thirteen: null, system: null };
}

/** Route for a 13-month input (the system is always written so links stay unambiguous). */
export function thirteenRoute(date: ThirteenDate): Route {
  return { name: 'convert', date: null, thirteen: formatThirteen(date, { style: 'numeric' }), system: date.system };
}

/**
 * The same 13-month slot in another year. When it does not exist there (a
 * leap-year day moved to a common year), falls back to the day before it in
 * the year's order: IFC Leap Day → June 28, Holy Women → All the Dead.
 */
export function moveToYear(date: ThirteenDate, gregorianYear: number): { date: ThirteenDate; fellBack: boolean } {
  const moved = sameSlotInYear(date, gregorianYear);
  if (moved) return { date: moved, fellBack: false };
  const system = getCalendarSystem(date.system);
  const info = date.kind === 'intercalary' ? system.intercalaryDays.find((d) => d.id === date.id)! : null;
  if (info && info.afterMonth === 13 && info.id === 'leap-day') {
    return { date: createIntercalaryDate(gregorianYear, 'year-day', system.id), fellBack: true };
  }
  return { date: createMonthDate(gregorianYear, info ? info.afterMonth : 1, 28, system.id), fellBack: true };
}
