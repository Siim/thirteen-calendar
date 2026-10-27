/**
 * The rules of the 13-month date field (docs/EVENTS.md §2.12), apart from
 * React: the closed button's text and name, the picker's slot and cell names,
 * year stepping (leap-only days fall back to the day before them, or keep a
 * leap-only repeat on leap years), keyboard moves through intercalary days,
 * the editor's 1583 to 9999 range and typed dates.
 */

import {
  type CalendarSystemId,
  type GregorianDate,
  type ThirteenDate,
  type ThirteenIntercalaryDate,
  type ThirteenMonthDate,
  type ThirteenSlot,
  type ZoneResolver,
  DAYS_PER_MONTH,
  DAYS_PER_WEEK,
  addGregorianDays,
  addThirteenDays,
  addThirteenMonths,
  compareLocalDateTime,
  createIntercalaryDate,
  createMonthDate,
  fixedWeekday,
  formatGregorian,
  formatThirteen,
  fromThirteen,
  getCalendarSystem,
  intercalaryDayInfo,
  sameSlotInYear,
  toDisplayYear,
  toThirteen,
  tryParseISODate,
  tryParseThirteen,
  weekdayName,
  zonedToUtc,
} from '@thirteen/core';
import { copy } from '../copy.ts';

/** Gregorian years a date field accepts. */
export interface YearRange {
  readonly min: number;
  readonly max: number;
}

/** The editor's range (Starts, Ends, End repeat; §2.12 "Range", §3.1.1): 1583 to 9999. */
export const EDITOR_YEAR_RANGE: YearRange = { min: 1583, max: 9999 };
/** The Converter keeps every year. */
export const FULL_YEAR_RANGE: YearRange = { min: 1, max: 9999 };

export function inYearRange(date: GregorianDate, range: YearRange): boolean {
  return date.year >= range.min && date.year <= range.max;
}

/** A day the field refuses (shown disabled, never selected): see {@link skippedDays}. */
export type DayFilter = (date: GregorianDate) => boolean;

/**
 * The days a time zone skips as a whole (§2.12, SPEC §1.5: Pacific/Apia
 * 2011-12-30, Pacific/Kiritimati 1994-12-31): the day's midnight and the next
 * day's midnight name the same instant. The editor disables them in Starts and
 * Ends for a timed event with a zone (an all-day or floating event has no zone
 * that skips a day), as the Windows editor does. Results are cached per day;
 * an unknown zone skips nothing.
 */
export function skippedDays(zone: string, zones: ZoneResolver): DayFilter {
  const cache = new Map<string, boolean>();
  return (date) => {
    const key = `${date.year}-${date.month}-${date.day}`;
    let skipped = cache.get(key);
    if (skipped === undefined) {
      try {
        const start = zonedToUtc({ date, minute: 0 }, zone, zones);
        const next = zonedToUtc({ date: addGregorianDays(date, 1), minute: 0 }, zone, zones);
        skipped = start !== null && next !== null && compareLocalDateTime(start, next) === 0;
      } catch {
        skipped = false;
      }
      cache.set(key, skipped);
    }
    return skipped;
  };
}

const longThirteen = (date: ThirteenDate) => formatThirteen(date, { style: 'long', includeWeekday: true });
const longGregorian = (date: GregorianDate) => formatGregorian(date, { style: 'long', includeWeekday: true });

/** The closed button: `IFC Thu, Oct 12, 2026` (`editor.dateButton`), or `Year Day 2026`. */
export function dateButtonText(date: GregorianDate, systemId: CalendarSystemId): string {
  const thirteen = toThirteen(date, systemId);
  if (thirteen.kind === 'intercalary') return formatThirteen(thirteen, { style: 'long' });
  const system = getCalendarSystem(systemId);
  return copy('editor.dateButton', {
    IFC: system.shortName,
    Wkd: weekdayName(fixedWeekday(thirteen.day, systemId), 'short'),
    Mon: system.months[thirteen.month - 1]!.shortName,
    d: thirteen.day,
    displayYear: toDisplayYear(thirteen.year, systemId),
  });
}

/** `editor.dateButton.a11y`: "Starts, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026". */
export function dateButtonLabel(field: string, date: GregorianDate, systemId: CalendarSystemId): string {
  return copy('editor.dateButton.a11y', {
    field,
    IFC: getCalendarSystem(systemId).shortName,
    date: longThirteen(toThirteen(date, systemId)),
    gregorianDate: longGregorian(date),
  });
}

/** `editor.gregorianCaption`: "Gregorian Monday, October 19, 2026". */
export function gregorianCaption(date: GregorianDate): string {
  return copy('editor.gregorianCaption', { gregorianDate: longGregorian(date) });
}

/** `editor.thirteenCaption`: "IFC Thursday, October 12, 2026" (the Gregorian tab's footer). */
export function thirteenCaption(date: GregorianDate, systemId: CalendarSystemId): string {
  return copy('editor.thirteenCaption', { IFC: getCalendarSystem(systemId).shortName, date: longThirteen(toThirteen(date, systemId)) });
}

/** The year control's value text: "2026", Positivist "238, Gregorian 2026" (`picker.year.positivist`). */
export function yearValueText(year: number, systemId: CalendarSystemId): string {
  const display = toDisplayYear(year, systemId);
  return systemId === 'ifc' ? String(display) : copy('picker.year.positivist', { displayYear: display, year });
}

/** The full name of an intercalary day: "Leap Day", "Year Day", "Festival of Holy Women". */
export function intercalaryName(date: ThirteenIntercalaryDate): string {
  return intercalaryDayInfo(date.id, date.system).name;
}

/** The slot strip's visible text: "Oct", "Sol", and the codes "LD", "YD" for intercalary days (board C2). */
export function slotShortText(slot: ThirteenSlot): string {
  return slot.kind === 'month' ? slot.monthInfo.shortName : slot.occurrence.code;
}

/** A slot's accessible name (§2.12): "October, month 11 of 13", "Leap Day, leap years only", "Year Day, belongs to no month". */
export function slotLabel(slot: ThirteenSlot, systemId: CalendarSystemId): string {
  if (slot.kind === 'month') return copy('picker.slot.month', { Month: slot.monthInfo.name, n: slot.month });
  if (systemId === 'ifc') return slot.id === 'leap-day' ? copy('picker.slot.leapDay') : copy('picker.slot.yearDay');
  const name = slot.occurrence.name;
  const base = copy('picker.slot.festival', { 'festival name': name });
  return slot.occurrence.leapOnly ? `${base}, leap years only` : base;
}

/** `picker.cell`: "Thursday, October 12. Gregorian Monday, October 19". */
export function pickerCellLabel(thirteen: ThirteenDate, gregorian: GregorianDate): string {
  return copy('picker.cell', {
    shortDate: formatThirteen(thirteen, { style: 'long', includeWeekday: true, includeYear: false }),
    gregorianShortDate: formatGregorian(gregorian, { style: 'long', includeWeekday: true, includeYear: false }),
  });
}

/** The selected slot's id in a strip: `m{month}` or the intercalary id. */
export function slotId(date: ThirteenDate): string {
  return date.kind === 'month' ? `m${date.month}` : date.id;
}

/** The 28 days of a 13-month month, with their Gregorian dates, in rows of 7. */
export function monthCells(year: number, month: number, systemId: CalendarSystemId): { thirteen: ThirteenMonthDate; gregorian: GregorianDate }[][] {
  const rows: { thirteen: ThirteenMonthDate; gregorian: GregorianDate }[][] = [];
  for (let week = 0; week < DAYS_PER_MONTH / DAYS_PER_WEEK; week++) {
    const row: { thirteen: ThirteenMonthDate; gregorian: GregorianDate }[] = [];
    for (let column = 0; column < DAYS_PER_WEEK; column++) {
      const thirteen = createMonthDate(year, month, week * DAYS_PER_WEEK + column + 1, systemId);
      row.push({ thirteen, gregorian: fromThirteen(thirteen) });
    }
    rows.push(row);
  }
  return rows;
}

/** A date field change with the caption it announces (§2.12). */
export interface YearStep {
  readonly date: ThirteenDate;
  /** `picker.fellBack` or `picker.leapRepeat`; null when the slot exists in the new year. */
  readonly caption: string | null;
}

/** The day a leap-only day falls back to in a common year: IFC June 28, Positivist the Festival of All the Dead. */
function fallBack(date: ThirteenIntercalaryDate, year: number): ThirteenDate {
  const info = intercalaryDayInfo(date.id, date.system);
  if (info.afterMonth === 13) return createIntercalaryDate(year, 'year-day', date.system);
  return createMonthDate(year, info.afterMonth, DAYS_PER_MONTH, date.system);
}

/**
 * The same slot in `year`: when it does not exist there (a leap-only day in a
 * common year) the day before it, with `picker.fellBack`. With `leapRepeat`
 * (the editor's Starts while the draft repeats on that leap-only day) the year
 * moves on in `direction` to the next year that has the day instead, with
 * `picker.leapRepeat`. Null outside `range` (the stepper stops there).
 */
export function stepToYear(
  date: ThirteenDate,
  year: number,
  options: { readonly range: YearRange; readonly leapRepeat?: boolean },
): YearStep | null {
  const { range } = options;
  if (year < range.min || year > range.max) return null;
  const same = sameSlotInYear(date, year);
  if (same !== null) return { date: same, caption: null };
  if (date.kind !== 'intercalary') return null;
  const name = intercalaryName(date);
  if (options.leapRepeat === true) {
    const direction = year >= date.year ? 1 : -1;
    for (let candidate = year + direction; candidate >= range.min && candidate <= range.max; candidate += direction) {
      const moved = sameSlotInYear(date, candidate);
      if (moved !== null) {
        return {
          date: moved,
          caption: copy('picker.leapRepeat', { 'day name': name, year: toDisplayYear(candidate, date.system) }),
        };
      }
    }
    return null;
  }
  const fallen = fallBack(date, year);
  const dayAndMonth =
    fallen.kind === 'month' ? formatThirteen(fallen, { style: 'long', includeYear: false }) : `the ${intercalaryName(fallen)}`;
  return {
    date: fallen,
    caption: copy('picker.fellBack', { year: toDisplayYear(year, date.system), 'day name': name, dayAndMonth }),
  };
}

function safe<T>(make: () => T): T | null {
  try {
    return make();
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/**
 * The grid's keyboard moves (§2.12 Keyboard): Left and Right by one day in
 * reading order through intercalary days; Up and Down one row, continuing into
 * the previous or next month (from an intercalary day, the day before or
 * after it); Page Up and Page Down by month; Home and End to the month's first
 * and last day. Shift with Page Up or Page Down is a year step (use
 * {@link stepToYear}). Null for other keys and at the ends of time.
 */
export function pickerKeyMove(date: ThirteenDate, key: string): ThirteenDate | null {
  switch (key) {
    case 'ArrowLeft':
      return safe(() => addThirteenDays(date, -1));
    case 'ArrowRight':
      return safe(() => addThirteenDays(date, 1));
    case 'ArrowUp':
    case 'ArrowDown': {
      const down = key === 'ArrowDown';
      if (date.kind === 'intercalary') return safe(() => addThirteenDays(date, down ? 1 : -1));
      if (down && date.day + DAYS_PER_WEEK <= DAYS_PER_MONTH) return { ...date, day: date.day + DAYS_PER_WEEK };
      if (!down && date.day - DAYS_PER_WEEK >= 1) return { ...date, day: date.day - DAYS_PER_WEEK };
      return safe(() => {
        const next = addThirteenMonths(date, down ? 1 : -1);
        return createMonthDate(next.year, next.month, down ? date.day + DAYS_PER_WEEK - DAYS_PER_MONTH : date.day - DAYS_PER_WEEK + DAYS_PER_MONTH, date.system);
      });
    }
    case 'PageUp':
    case 'PageDown': {
      const down = key === 'PageDown';
      if (date.kind === 'month') return safe(() => addThirteenMonths(date, down ? 1 : -1));
      const info = intercalaryDayInfo(date.id, date.system);
      if (!down) return safe(() => createMonthDate(date.year, info.afterMonth, DAYS_PER_MONTH, date.system));
      return safe(() =>
        info.afterMonth === 13 ? createMonthDate(date.year + 1, 1, 1, date.system) : createMonthDate(date.year, info.afterMonth + 1, 1, date.system),
      );
    }
    case 'Home':
      return date.kind === 'month' ? { ...date, day: 1 } : null;
    case 'End':
      return date.kind === 'month' ? { ...date, day: DAYS_PER_MONTH } : null;
    default:
      return null;
  }
}

/**
 * A date typed into the field (desktop, §2.12): the numeric 13-month form of
 * the system (`2026-M10-12`, `2026-YD`, `2028-LD`) or an ISO date
 * (`2026-10-19`). Null when it is neither.
 */
export function parseTypedDate(text: string, systemId: CalendarSystemId): GregorianDate | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const thirteen = tryParseThirteen(trimmed, systemId) ?? tryParseThirteen(trimmed.toUpperCase(), systemId);
  if (thirteen !== null) return fromThirteen(thirteen);
  return tryParseISODate(trimmed);
}

/** The month that holds `date` for the grid (an intercalary day shows its badge instead). */
export function isLeapOnly(date: ThirteenDate): boolean {
  return date.kind === 'intercalary' && intercalaryDayInfo(date.id, date.system).leapOnly;
}
