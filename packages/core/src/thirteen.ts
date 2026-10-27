/**
 * 13-month dates and Gregorian ⇄ 13-month conversion (SPEC §1).
 *
 * Conversion always goes via the shared Gregorian day-of-year: both systems
 * start on 1 January, so day-of-year `d` of Gregorian year `Y` is day-of-year
 * `d` of 13-month year `Y`. `ThirteenDate.year` therefore always stores the
 * **Gregorian** year, and every `gregorianYear` parameter takes the Gregorian
 * year too — never the system's display year. Convert a display year first
 * with {@link fromDisplayYear} (Positivist 238 → 2026); derive it with
 * {@link thirteenDisplayYear} / {@link toDisplayYear}.
 * @module
 */

import {
  type GregorianDate,
  addGregorianDays,
  assertValidGregorian,
  assertValidYear,
  daysInYear,
  gregorianDayOfYear,
  gregorianFromDayOfYear,
  gregorianWeekday,
  isLeapYear,
  isValidYear,
  toJulianDayNumber,
} from './gregorian.ts';
import { fail, isInteger, isRecord, show } from './internal.ts';
import {
  type CalendarSystem,
  type CalendarSystemId,
  type IntercalaryDayId,
  type IntercalaryDayInfo,
  type ThirteenMonthInfo,
  CALENDAR_SYSTEM_IDS,
  DEFAULT_SYSTEM_ID,
  getCalendarSystem,
  isCalendarSystemId,
  isIntercalaryDayId,
} from './systems/index.ts';
import { type Weekday, toWeekday } from './weekday.ts';

/** Days in every 13-month month. */
export const DAYS_PER_MONTH = 28;
/** Months per 13-month year. */
export const MONTHS_PER_YEAR = 13;
/** Days per week. */
export const DAYS_PER_WEEK = 7;
/** Weeks in every 13-month month. */
export const WEEKS_PER_MONTH = 4;
/** Days that belong to a month (13 × 28); the rest of the year is intercalary. */
export const MONTH_DAYS_PER_YEAR = 364;

/** A regular day inside one of the 13 months. */
export interface ThirteenMonthDate {
  readonly kind: 'month';
  readonly system: CalendarSystemId;
  /** **Gregorian** year, `1…9999` (see {@link thirteenDisplayYear}). */
  readonly year: number;
  /** Month, `1…13` (IFC: 7 = Sol). */
  readonly month: number;
  /** Day of month, `1…28`. */
  readonly day: number;
}

/** An intercalary day: outside every month and week, it has no weekday. */
export interface ThirteenIntercalaryDate {
  readonly kind: 'intercalary';
  readonly system: CalendarSystemId;
  /** **Gregorian** year, `1…9999`. */
  readonly year: number;
  readonly id: IntercalaryDayId;
}

/** A date in a 13 × 28 calendar system (discriminated on `kind`). */
export type ThirteenDate = ThirteenMonthDate | ThirteenIntercalaryDate;

/**
 * An intercalary day as it occurs in a specific year: the static
 * {@link IntercalaryDayInfo} fields (except the `dayOfYear` rule) plus where it
 * falls that year.
 */
export interface IntercalaryOccurrence {
  readonly id: IntercalaryDayId;
  /** `'YD'` or `'LD'` (numeric formatting code). */
  readonly code: 'YD' | 'LD';
  /** e.g. `"Year Day"`, `"Festival of Holy Women"`. */
  readonly name: string;
  /** e.g. `"Year Day"`, `"Holy Women"`. */
  readonly shortName: string;
  /** One-sentence description of where the day falls. */
  readonly description: string;
  /** `true` when the day only exists in leap years. */
  readonly leapOnly: boolean;
  /** Comes after day 28 of this month (IFC Leap Day: 6; year-end days: 13). */
  readonly afterMonth: number;
  readonly thirteen: ThirteenIntercalaryDate;
  readonly gregorian: GregorianDate;
  /** Day-of-year on which it falls this year. */
  readonly dayOfYear: number;
  /** Real-world weekday of the Gregorian date (the 13-month weekday is `null`). */
  readonly gregorianWeekday: Weekday;
}

/**
 * One selectable position of a 13-month year, in display order (see
 * {@link thirteenSlots}): a month (pick a day 1–28 in it) or an intercalary day.
 */
export type ThirteenSlot =
  | { readonly kind: 'month'; readonly month: number; readonly monthInfo: ThirteenMonthInfo }
  | { readonly kind: 'intercalary'; readonly id: IntercalaryDayId; readonly occurrence: IntercalaryOccurrence };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface Placed {
  readonly info: IntercalaryDayInfo;
  readonly dayOfYear: number;
}

/** Intercalary days present in a year, in chronological order. Year must be valid. */
function placedIntercalary(system: CalendarSystem, year: number): Placed[] {
  const leap = isLeapYear(year);
  const placed: Placed[] = [];
  for (const info of system.intercalaryDays) {
    const doy = leap ? info.dayOfYear.leap : info.dayOfYear.common;
    if (doy !== null) placed.push({ info, dayOfYear: doy });
  }
  return placed.sort((a, b) => a.dayOfYear - b.dayOfYear);
}

function thirteenProblem(value: unknown): string | null {
  if (!isRecord(value)) return `expected a ThirteenDate object, got ${show(value)}`;
  const { kind, system, year } = value;
  if (!isCalendarSystemId(system)) {
    return `system must be one of ${CALENDAR_SYSTEM_IDS.map((s) => `'${s}'`).join(', ')}, got ${show(system)}`;
  }
  if (!isInteger(year)) return `year must be an integer, got ${show(year)}`;
  if (!isValidYear(year)) return `year ${year} is out of range (supported Gregorian years are 1..9999)`;
  if (kind === 'month') {
    const { month, day } = value;
    if (!isInteger(month) || month < 1 || month > MONTHS_PER_YEAR) {
      return `month must be an integer 1..13, got ${show(month)}`;
    }
    if (!isInteger(day) || day < 1 || day > DAYS_PER_MONTH) return `day must be an integer 1..28, got ${show(day)}`;
    return null;
  }
  if (kind === 'intercalary') {
    const { id } = value;
    if (!isIntercalaryDayId(id)) return `id must be 'year-day' or 'leap-day', got ${show(id)}`;
    if (!placedIntercalary(getCalendarSystem(system), year).some((p) => p.info.id === id)) {
      return `${id} does not exist in ${year} (not a leap year)`;
    }
    return null;
  }
  return `kind must be 'month' or 'intercalary', got ${show(kind)}`;
}

// ---------------------------------------------------------------------------
// Validation & construction
// ---------------------------------------------------------------------------

/** `true` when `value` is a valid {@link ThirteenDate} (incl. leap-day only in leap years). */
export function isValidThirteenDate(value: unknown): value is ThirteenDate {
  return thirteenProblem(value) === null;
}

/** @throws RangeError with a descriptive message unless `value` is a valid {@link ThirteenDate}. */
export function assertValidThirteenDate(value: unknown): asserts value is ThirteenDate {
  const problem = thirteenProblem(value);
  if (problem !== null) fail(`Invalid 13-month date: ${problem}`);
}

/** Type guard on the discriminant (does not validate ranges). */
export function isMonthDate(date: ThirteenDate): date is ThirteenMonthDate {
  return date.kind === 'month';
}

/** Type guard on the discriminant (does not validate ranges). */
export function isIntercalaryDate(date: ThirteenDate): date is ThirteenIntercalaryDate {
  return date.kind === 'intercalary';
}

/**
 * Validated constructor for a regular 13-month date.
 * @param gregorianYear **Gregorian** year (`1…9999`), not the display year:
 *   Positivist Descartes 12, 238 is `createMonthDate(2026, 11, 12, 'positivist')`.
 * @throws RangeError for invalid input.
 */
export function createMonthDate(
  gregorianYear: number,
  month: number,
  day: number,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): ThirteenMonthDate {
  const date: ThirteenMonthDate = { kind: 'month', system: systemId, year: gregorianYear, month, day };
  assertValidThirteenDate(date);
  return date;
}

/**
 * Validated constructor for an intercalary date.
 * @param gregorianYear **Gregorian** year (`1…9999`); `'leap-day'` requires a leap year.
 * @throws RangeError for invalid input.
 */
export function createIntercalaryDate(
  gregorianYear: number,
  id: IntercalaryDayId,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): ThirteenIntercalaryDate {
  const date: ThirteenIntercalaryDate = { kind: 'intercalary', system: systemId, year: gregorianYear, id };
  assertValidThirteenDate(date);
  return date;
}

/**
 * A fresh, normalised copy of a valid 13-month date (only the documented
 * fields, in canonical key order). Internal: used so results never alias inputs.
 * @internal
 */
export function copyThirteen<T extends ThirteenDate>(date: T): T {
  return (
    date.kind === 'month'
      ? { kind: 'month', system: date.system, year: date.year, month: date.month, day: date.day }
      : { kind: 'intercalary', system: date.system, year: date.year, id: date.id }
  ) as T;
}

// ---------------------------------------------------------------------------
// Intercalary days
// ---------------------------------------------------------------------------

/**
 * Gregorian day-of-year of an intercalary day in `gregorianYear`, or `null` if
 * it does not occur that year (leap-day in a common year).
 */
export function intercalaryDayOfYear(
  gregorianYear: number,
  id: IntercalaryDayId,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): number | null {
  assertValidYear(gregorianYear);
  if (!isIntercalaryDayId(id)) fail(`Unknown intercalary day ${show(id)} (expected 'year-day' or 'leap-day')`);
  const placed = placedIntercalary(getCalendarSystem(systemId), gregorianYear).find((p) => p.info.id === id);
  return placed ? placed.dayOfYear : null;
}

function occurrence(system: CalendarSystem, year: number, { info, dayOfYear }: Placed): IntercalaryOccurrence {
  const gregorian = gregorianFromDayOfYear(year, dayOfYear);
  return {
    id: info.id,
    code: info.code,
    name: info.name,
    shortName: info.shortName,
    description: info.description,
    leapOnly: info.leapOnly,
    afterMonth: info.afterMonth,
    thirteen: { kind: 'intercalary', system: system.id, year, id: info.id },
    gregorian,
    dayOfYear,
    gregorianWeekday: gregorianWeekday(gregorian),
  };
}

/** The intercalary days occurring in `gregorianYear`, in chronological order (1 or 2 entries). */
export function intercalaryDaysInYear(
  gregorianYear: number,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): IntercalaryOccurrence[] {
  assertValidYear(gregorianYear);
  const system = getCalendarSystem(systemId);
  return placedIntercalary(system, gregorianYear).map((placed) => occurrence(system, gregorianYear, placed));
}

/**
 * Every selectable position of the 13-month year in display (= chronological)
 * order, for pickers: the 13 months with each intercalary day inserted after
 * its `afterMonth`. IFC leap year: January … June, Leap Day, Sol … December,
 * Year Day. Positivist leap year: Moses … Bichat, All the Dead, Holy Women.
 * Leap-only days appear only in leap years.
 */
export function thirteenSlots(
  gregorianYear: number,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): ThirteenSlot[] {
  assertValidYear(gregorianYear);
  const system = getCalendarSystem(systemId);
  const placed = placedIntercalary(system, gregorianYear);
  const slots: ThirteenSlot[] = [];
  for (const monthInfo of system.months) {
    slots.push({ kind: 'month', month: monthInfo.index, monthInfo });
    for (const p of placed) {
      if (p.info.afterMonth === monthInfo.index) {
        slots.push({ kind: 'intercalary', id: p.info.id, occurrence: occurrence(system, gregorianYear, p) });
      }
    }
  }
  return slots;
}

/**
 * The same slot (month + day, or intercalary id) in another Gregorian year of
 * the same system, or `null` when that slot does not exist there (a leap-day
 * moved to a common year) — the caller decides the fallback; nothing clamps.
 * @throws RangeError for an invalid date or year.
 */
export function sameSlotInYear(date: ThirteenDate, gregorianYear: number): ThirteenDate | null {
  assertValidThirteenDate(date);
  assertValidYear(gregorianYear);
  const moved = { ...copyThirteen(date), year: gregorianYear };
  return isValidThirteenDate(moved) ? moved : null;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * The 13-month date on day-of-year `dayOfYear` of Gregorian year `gregorianYear`
 * (SPEC §1.1/§1.2 mapping).
 * @throws RangeError if `dayOfYear` is not in `1…daysInYear(gregorianYear)`.
 */
export function thirteenFromDayOfYear(
  gregorianYear: number,
  dayOfYear: number,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): ThirteenDate {
  const year = gregorianYear;
  const total = daysInYear(year);
  const system = getCalendarSystem(systemId);
  if (!isInteger(dayOfYear) || dayOfYear < 1 || dayOfYear > total) {
    fail(`Day of year must be an integer 1..${total} for ${year}, got ${show(dayOfYear)}`);
  }
  let skipped = 0;
  for (const placed of placedIntercalary(system, year)) {
    if (placed.dayOfYear === dayOfYear) return { kind: 'intercalary', system: system.id, year, id: placed.info.id };
    if (placed.dayOfYear < dayOfYear) skipped++;
  }
  const ordinal = dayOfYear - skipped - 1; // 0…363
  return {
    kind: 'month',
    system: system.id,
    year,
    month: Math.floor(ordinal / DAYS_PER_MONTH) + 1,
    day: (ordinal % DAYS_PER_MONTH) + 1,
  };
}

/**
 * Converts a Gregorian date to the given 13-month system.
 * @example toThirteen({ year: 2026, month: 10, day: 19 }) // { kind: 'month', system: 'ifc', year: 2026, month: 11, day: 12 } = October 12
 * @throws RangeError for invalid dates or system ids.
 */
export function toThirteen(date: GregorianDate, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): ThirteenDate {
  assertValidGregorian(date);
  return thirteenFromDayOfYear(date.year, gregorianDayOfYear(date), systemId);
}

/** Gregorian day-of-year (`1…366`) of a 13-month date. */
export function thirteenDayOfYear(date: ThirteenDate): number {
  assertValidThirteenDate(date);
  const placed = placedIntercalary(getCalendarSystem(date.system), date.year);
  if (date.kind === 'intercalary') return placed.find((p) => p.info.id === date.id)!.dayOfYear;
  const ordinal = (date.month - 1) * DAYS_PER_MONTH + date.day;
  return ordinal + placed.filter((p) => p.info.afterMonth < date.month).length;
}

/**
 * Converts a 13-month date back to the Gregorian calendar.
 * @throws RangeError for invalid dates (e.g. a leap-day in a common year).
 */
export function fromThirteen(date: ThirteenDate): GregorianDate {
  const doy = thirteenDayOfYear(date); // validates first
  return gregorianFromDayOfYear(date.year, doy);
}

/** Re-expresses a 13-month date in another system (same Gregorian day). */
export function convertThirteen(date: ThirteenDate, systemId: CalendarSystemId): ThirteenDate {
  return toThirteen(fromThirteen(date), systemId);
}

/** The 28 Gregorian dates of 13-month month `month` (`1…13`) of Gregorian year `gregorianYear`, in order. */
export function monthDays(
  gregorianYear: number,
  month: number,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): GregorianDate[] {
  const first = thirteenDayOfYear(createMonthDate(gregorianYear, month, 1, systemId));
  return Array.from({ length: DAYS_PER_MONTH }, (_, i) => gregorianFromDayOfYear(gregorianYear, first + i));
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/**
 * Adds (or, if negative, subtracts) whole days, counting intercalary days like
 * any other day (via the Gregorian day): Leap Day 2024 + 1 = Sol 1, 2024.
 * @throws RangeError for an invalid date, a non-integer `days`, or a result outside years `1…9999`.
 */
export function addThirteenDays(date: ThirteenDate, days: number): ThirteenDate {
  assertValidThirteenDate(date);
  if (!isInteger(days)) fail(`Days to add must be an integer, got ${show(days)}`);
  return toThirteen(addGregorianDays(fromThirteen(date), days), date.system);
}

/**
 * Moves a month date by whole months, keeping the day (always valid: every
 * month has 28 days) and rolling over years: December 5, 2026 + 1 = January 5, 2027.
 * Intercalary days are skipped over (they belong to no month).
 * @throws RangeError for an intercalary date (it has no month to move from), a
 * non-integer `months`, or a result outside years `1…9999`.
 */
export function addThirteenMonths(date: ThirteenDate, months: number): ThirteenMonthDate {
  assertValidThirteenDate(date);
  if (date.kind !== 'month') fail(`Cannot add months to intercalary day ${date.id} ${date.year}: it belongs to no month`);
  if (!isInteger(months)) fail(`Months to add must be an integer, got ${show(months)}`);
  const index = date.year * MONTHS_PER_YEAR + (date.month - 1) + months;
  const year = Math.floor(index / MONTHS_PER_YEAR);
  return createMonthDate(year, index - year * MONTHS_PER_YEAR + 1, date.day, date.system);
}

// ---------------------------------------------------------------------------
// Weekdays & years
// ---------------------------------------------------------------------------

/**
 * Fixed weekday of month day `day` (`1…28`): `(weekStartsOn + day − 1) mod 7`.
 * IFC: day 1 = Sunday, day 13 = Friday. Positivist: day 1 = Monday.
 */
export function fixedWeekday(day: number, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): Weekday {
  const system = getCalendarSystem(systemId);
  if (!isInteger(day) || day < 1 || day > DAYS_PER_MONTH) fail(`Month day must be an integer 1..28, got ${show(day)}`);
  return toWeekday(system.weekStartsOn + day - 1);
}

/** Fixed 13-month weekday of a date, or `null` for intercalary days. */
export function thirteenWeekday(date: ThirteenDate): Weekday | null {
  assertValidThirteenDate(date);
  return date.kind === 'month' ? fixedWeekday(date.day, date.system) : null;
}

/** The system's year number for Gregorian year `gregorianYear` (`gregorianYear + yearOffset`; Positivist 2026 → 238). */
export function toDisplayYear(gregorianYear: number, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): number {
  assertValidYear(gregorianYear);
  return gregorianYear + getCalendarSystem(systemId).yearOffset;
}

/**
 * The supported display years of a system (Gregorian 1…9999 shifted by its
 * `yearOffset`): IFC `{ min: 1, max: 9999 }`, Positivist `{ min: -1787, max: 8211 }`.
 * Use for year inputs that accept display years.
 */
export function displayYearRange(systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): {
  readonly min: number;
  readonly max: number;
} {
  const { yearOffset } = getCalendarSystem(systemId);
  return { min: 1 + yearOffset, max: 9999 + yearOffset };
}

/**
 * Inverse of {@link toDisplayYear}: the Gregorian year for a system year number
 * (Positivist 238 → 2026).
 * @throws RangeError if the resulting Gregorian year is outside `1…9999`.
 */
export function fromDisplayYear(displayYear: number, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): number {
  const system = getCalendarSystem(systemId);
  if (!isInteger(displayYear)) fail(`Display year must be an integer, got ${show(displayYear)}`);
  const year = displayYear - system.yearOffset;
  if (!isValidYear(year)) {
    fail(
      `${system.shortName} year ${displayYear} is out of range ` +
        `(supported: ${1 + system.yearOffset}..${9999 + system.yearOffset}, i.e. Gregorian 1..9999)`,
    );
  }
  return year;
}

/** The year number shown for a 13-month date (IFC: Gregorian year; Positivist: year − 1788). */
export function thirteenDisplayYear(date: ThirteenDate): number {
  assertValidThirteenDate(date);
  return toDisplayYear(date.year, date.system);
}

// ---------------------------------------------------------------------------
// Equality & ordering
// ---------------------------------------------------------------------------

/** Structural equality (same system, year and month/day or intercalary id). */
export function thirteenEquals(a: ThirteenDate, b: ThirteenDate): boolean {
  assertValidThirteenDate(a);
  assertValidThirteenDate(b);
  if (a.system !== b.system || a.year !== b.year || a.kind !== b.kind) return false;
  if (a.kind === 'month' && b.kind === 'month') return a.month === b.month && a.day === b.day;
  return a.kind === 'intercalary' && b.kind === 'intercalary' && a.id === b.id;
}

/**
 * Chronological comparator (works across systems, via the Gregorian day):
 * `-1` if `a` is earlier, `0` if the same day, `1` if later.
 */
export function compareThirteen(a: ThirteenDate, b: ThirteenDate): -1 | 0 | 1 {
  const delta = toJulianDayNumber(fromThirteen(a)) - toJulianDayNumber(fromThirteen(b));
  return delta < 0 ? -1 : delta > 0 ? 1 : 0;
}
