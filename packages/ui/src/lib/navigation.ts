/**
 * Pure keyboard-navigation rules for calendar grids (WAI-ARIA grid pattern):
 * arrows move by day/week, Home/End to the start/end of the week row,
 * PageUp/PageDown by month. Functions return `null` when the key is not a
 * navigation key or the move would leave the allowed range.
 */
import {
  type GregorianDate,
  type ThirteenDate,
  DAYS_PER_MONTH,
  DAYS_PER_WEEK,
  MONTHS_PER_YEAR,
  addGregorianDays,
  addThirteenDays,
  daysInGregorianMonth,
  gregorianWeekday,
  toWeekday,
  type Weekday,
} from '@thirteen/core';

export type NavigationKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown';

const NAV_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function isNavigationKey(key: string): key is NavigationKey {
  return NAV_KEYS.has(key);
}

/** Options for {@link navigateThirteen}. */
export interface ThirteenNavigationOptions {
  /** Keep focus inside the current month (single-month grids). Default `false`. */
  readonly withinMonth?: boolean;
}

function monthDate(date: ThirteenDate, month: number, day: number): ThirteenDate {
  return { kind: 'month', system: date.system, year: date.year, month, day };
}

/** `addThirteenDays`, or `null` when the step would leave the supported range (before 0001-01-01, after 9999-12-31). */
function stepDays(date: ThirteenDate, days: number): ThirteenDate | null {
  try {
    return addThirteenDays(date, days);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/**
 * Next 13-month date for a navigation key, staying inside `date.year`
 * (intercalary days are reachable with Left/Right/Up/Down in a year grid).
 */
export function navigateThirteen(
  date: ThirteenDate,
  key: string,
  options: ThirteenNavigationOptions = {},
): ThirteenDate | null {
  if (!isNavigationKey(key)) return null;
  const withinMonth = options.withinMonth ?? false;
  let next: ThirteenDate | null = null;

  if (date.kind === 'intercalary') {
    if (withinMonth) return null;
    if (key === 'ArrowLeft' || key === 'ArrowUp') next = stepDays(date, -1);
    else if (key === 'ArrowRight' || key === 'ArrowDown') next = stepDays(date, 1);
    else return null;
  } else {
    const { month, day } = date;
    const col = (day - 1) % DAYS_PER_WEEK;
    switch (key) {
      case 'ArrowLeft':
        next = withinMonth ? (day > 1 ? monthDate(date, month, day - 1) : null) : stepDays(date, -1);
        break;
      case 'ArrowRight':
        next = withinMonth
          ? day < DAYS_PER_MONTH
            ? monthDate(date, month, day + 1)
            : null
          : stepDays(date, 1);
        break;
      case 'ArrowUp':
        if (day > DAYS_PER_WEEK) next = monthDate(date, month, day - DAYS_PER_WEEK);
        else if (!withinMonth && month > 1) next = monthDate(date, month - 1, day + DAYS_PER_MONTH - DAYS_PER_WEEK);
        break;
      case 'ArrowDown':
        if (day <= DAYS_PER_MONTH - DAYS_PER_WEEK) next = monthDate(date, month, day + DAYS_PER_WEEK);
        else if (!withinMonth && month < MONTHS_PER_YEAR)
          next = monthDate(date, month + 1, day - DAYS_PER_MONTH + DAYS_PER_WEEK);
        break;
      case 'Home':
        next = monthDate(date, month, day - col);
        break;
      case 'End':
        next = monthDate(date, month, day - col + DAYS_PER_WEEK - 1);
        break;
      case 'PageUp':
        if (!withinMonth && month > 1) next = monthDate(date, month - 1, day);
        break;
      case 'PageDown':
        if (!withinMonth && month < MONTHS_PER_YEAR) next = monthDate(date, month + 1, day);
        break;
    }
  }
  if (next === null || next.year !== date.year) return null;
  if (withinMonth && (next.kind !== 'month' || date.kind !== 'month' || next.month !== date.month)) return null;
  return next;
}

/**
 * Next Gregorian date for a navigation key inside the same Gregorian month
 * (ragged month grids). `weekStartsOn` decides where Home/End land.
 */
export function navigateGregorianMonth(date: GregorianDate, key: string, weekStartsOn: Weekday = 0): GregorianDate | null {
  if (!isNavigationKey(key)) return null;
  const length = daysInGregorianMonth(date.year, date.month);
  const col = toWeekday(gregorianWeekday(date) - weekStartsOn);
  let delta: number;
  switch (key) {
    case 'ArrowLeft':
      delta = -1;
      break;
    case 'ArrowRight':
      delta = 1;
      break;
    case 'ArrowUp':
      delta = -DAYS_PER_WEEK;
      break;
    case 'ArrowDown':
      delta = DAYS_PER_WEEK;
      break;
    case 'Home':
      delta = -Math.min(col, date.day - 1);
      break;
    case 'End':
      delta = Math.min(DAYS_PER_WEEK - 1 - col, length - date.day);
      break;
    default:
      return null;
  }
  const day = date.day + delta;
  if (day < 1 || day > length) return null;
  return addGregorianDays(date, delta);
}
