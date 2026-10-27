import {
  type GregorianDate,
  type ThirteenDate,
  fromJSDate,
  gregorianEquals,
  isLeapYear,
  ordinal,
  thirteenDayOfYear,
  toISODate,
} from '@thirteen/core';

/** The local calendar date of `now` (the user's wall clock, not UTC). */
export function gregorianToday(now: Date = new Date()): GregorianDate {
  return fromJSDate(now);
}

/**
 * Milliseconds from `now` until the next local midnight (plus a small
 * buffer so the timer never fires a hair before the date flips).
 */
export function msUntilNextLocalMidnight(now: Date = new Date(), bufferMs = 250): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime() + bufferMs);
}

/** `true` when both dates exist and are the same day (null-safe). */
export function sameGregorian(a: GregorianDate | null | undefined, b: GregorianDate | null | undefined): boolean {
  return a != null && b != null && gregorianEquals(a, b);
}

/** Stable string key for a Gregorian date (ISO). */
export function gregorianKey(date: GregorianDate): string {
  return toISODate(date);
}

/** Day-of-year of a 13-month date (shared with the Gregorian calendar). */
export function thirteenKey(date: ThirteenDate): number {
  return thirteenDayOfYear(date);
}

/** `1st` → `{ value: '1', suffix: 'st' }` for typesetting raised ordinals. */
export function ordinalParts(value: number): { value: string; suffix: string } {
  const text = ordinal(value);
  const match = /^(-?\d+)(\D+)$/.exec(text);
  return match ? { value: match[1]!, suffix: match[2]! } : { value: text, suffix: '' };
}

/** Percentage with one decimal, e.g. `0.7973` → `"79.7%"`. */
export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Days in a Gregorian year as text, e.g. `"365 days"` / `"366 days (leap year)"`. */
export function describeYearLength(year: number): string {
  return isLeapYear(year) ? '366 days (leap year)' : '365 days';
}

/** `n day`/`n days`. */
export function pluralDays(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
}
