import { type GregorianDate, MAX_YEAR, MIN_YEAR, tryParseISODate } from '@thirteen/core';

/** Clamps to the supported Gregorian range 1…9999. */
export function clampYear(year: number): number {
  return Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.trunc(year)));
}

/** Parses an ISO date query value; `null` for missing or invalid text. */
export function parseDayParam(value: string | null): GregorianDate | null {
  return value === null ? null : tryParseISODate(value);
}
