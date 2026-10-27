import {
  type CalendarSystemId,
  type GregorianDate,
  type ThirteenDate,
  formatGregorian,
  formatThirteen,
  getCalendarSystem,
  gregorianMonthName,
} from '@thirteen/core';
import { copy, plural } from '../events/copy.ts';

/** Full 13-month reading with the fixed weekday: "Thursday, October 12, 2026" / "Year Day 2026". */
export function thirteenLabel(date: ThirteenDate): string {
  return formatThirteen(date, { includeWeekday: true });
}

/** Full Gregorian reading with the real weekday: "Monday, October 19, 2026". */
export function gregorianLabel(date: GregorianDate): string {
  return formatGregorian(date, { includeWeekday: true });
}

/** Short name of a system for labels ("IFC", "Positivist"). */
export function systemShortName(systemId: CalendarSystemId): string {
  return getCalendarSystem(systemId).shortName;
}

/**
 * Accessible name for a day that reads both calendars, 13-month first, in the form of the Month cell
 * and band (docs/EVENTS.md §2.19 `calendar.cell.a11y` and `calendar.band.a11y`, §2.20), as on Apple,
 * Android and Windows: "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026."; an
 * intercalary day "Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026.". `extra` is
 * appended after a space, as whole sentences ("Gregorian November begins. 3 events."). Today is not
 * part of the name: the cell carries `aria-current="date"`.
 */
export function dayAriaLabel(thirteen: ThirteenDate, gregorian: GregorianDate, extra?: string): string {
  const gregorianDate = gregorianLabel(gregorian);
  const label =
    thirteen.kind === 'intercalary'
      ? copy('calendar.band.a11y', { name: formatThirteen(thirteen, { style: 'long' }), gregorianDate })
      : copy('calendar.cell.a11y', { date: thirteenLabel(thirteen), gregorianDate });
  return extra ? `${label} ${extra}` : label;
}

/**
 * The sentences a Year cell adds to `dayAriaLabel` (docs/EVENTS.md §2.3, §2.20), in the order the
 * other platforms read them (name, then value): `calendar.gregorianMonthBegins.a11y` where a
 * Gregorian month starts, then `calendar.cell.events.a11y` when the day has events.
 * "Gregorian November begins. 3 events.", or `undefined` when there is nothing to add.
 */
export function dayAriaExtras(gregorianMonthStart: GregorianDate | null, eventCount = 0): string | undefined {
  const parts: string[] = [];
  if (gregorianMonthStart !== null) {
    parts.push(copy('calendar.gregorianMonthBegins.a11y', { Month: gregorianMonthName(gregorianMonthStart.month) }));
  }
  if (eventCount > 0) parts.push(plural('calendar.cell.events.a11y', eventCount));
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Accessible name for a Gregorian grid cell, Gregorian first, in the same form (as Windows and
 * Apple): "Monday, October 19, 2026. IFC Thursday, October 12, 2026."; an intercalary day
 * "Thursday, December 31, 2026. IFC Year Day 2026, no weekday.". `extra` is appended after a space
 * ("IFC November begins."); today is `aria-current="date"`, not part of the name.
 */
export function gregorianDayAriaLabel(gregorian: GregorianDate, thirteen: ThirteenDate, extra?: string): string {
  const name = systemShortName(thirteen.system);
  const thirteenPart =
    thirteen.kind === 'intercalary' ? `${formatThirteen(thirteen, { style: 'long' })}, no weekday` : thirteenLabel(thirteen);
  const label = `${gregorianLabel(gregorian)}. ${name} ${thirteenPart}.`;
  return extra ? `${label} ${extra}` : label;
}

const NUMERIC_DASH = /(\d)\s*[–—]\s*(\d)/g;
const SPACED_DASH = /\s+[–—]\s+/g;
const ANY_DASH = /[–—]/g;

/**
 * Text a platform formatter produced, made to follow the copy rule (design/DECISIONS.md,
 * docs/EVENTS.md §2.19 "Formatting rules"): no en dash or em dash. A numeric range reads "to"
 * ("3–13" becomes "3 to 13"), a spaced dash becomes a comma, any other dash a hyphen. The
 * same filter as Apple's and Android's `Phrasing.withoutDashes`. Never use it on text the user or
 * another app supplied (titles, locations, notes, calendar names).
 */
export function withoutDashes(text: string): string {
  if (!/[–—]/.test(text)) return text;
  return text.replace(NUMERIC_DASH, '$1 to $2').replace(SPACED_DASH, ', ').replace(ANY_DASH, '-');
}
