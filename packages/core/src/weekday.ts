/**
 * Weekdays (SPEC §1.3): `0 = Sunday … 6 = Saturday`, the JavaScript
 * `Date#getDay` convention, shared by the TypeScript and Swift engines.
 * @module
 */

import { fail, isInteger, namesForStyle, show } from './internal.ts';

/** Day of the week, `0 = Sunday … 6 = Saturday`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Name length for weekday and month names. */
export type NameStyle = 'long' | 'short' | 'narrow';

/** All weekdays in numeric order, Sunday first. */
export const WEEKDAYS: readonly Weekday[] = Object.freeze([0, 1, 2, 3, 4, 5, 6] as const);

/** English weekday names indexed by {@link Weekday} (`WEEKDAY_NAMES.long[0] === 'Sunday'`). */
export const WEEKDAY_NAMES: {
  readonly long: readonly string[];
  readonly short: readonly string[];
  readonly narrow: readonly string[];
} = Object.freeze({
  long: Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']),
  short: Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']),
  narrow: Object.freeze(['S', 'M', 'T', 'W', 'T', 'F', 'S']),
});

/** `true` when `value` is an integer in `0…6`. */
export function isWeekday(value: unknown): value is Weekday {
  return isInteger(value) && value >= 0 && value <= 6;
}

/**
 * Normalises any integer to a {@link Weekday} with a true (non-negative) modulo,
 * e.g. `toWeekday(-1) === 6`, `toWeekday(9) === 2`.
 * @throws RangeError if `value` is not an integer.
 */
export function toWeekday(value: number): Weekday {
  if (!isInteger(value)) fail(`Weekday arithmetic needs an integer, got ${show(value)}`);
  return (((value % 7) + 7) % 7) as Weekday;
}

/**
 * English name of a weekday.
 * @throws RangeError if `weekday` is not `0…6`.
 */
export function weekdayName(weekday: Weekday, style: NameStyle = 'long'): string {
  if (!isWeekday(weekday)) fail(`Invalid weekday: ${show(weekday)} (expected an integer 0..6, 0 = Sunday)`);
  return namesForStyle(WEEKDAY_NAMES, style)[weekday]!;
}

/**
 * The seven weekdays in display order for a week starting on `weekStartsOn`,
 * e.g. `orderedWeekdays(1)` → `[1, 2, 3, 4, 5, 6, 0]` (Monday first).
 * @throws RangeError if `weekStartsOn` is not `0…6`.
 */
export function orderedWeekdays(weekStartsOn: Weekday = 0): Weekday[] {
  if (!isWeekday(weekStartsOn)) fail(`Invalid weekStartsOn: ${show(weekStartsOn)} (expected an integer 0..6)`);
  return WEEKDAYS.map((offset) => toWeekday(weekStartsOn + offset));
}
