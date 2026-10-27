/**
 * Text for event views (docs/EVENTS.md §2.19 formatting rules, §2.20 labels):
 * times in the 12 or 24-hour form, day headings in both calendars, and the
 * accessible names of chips, bars and rows. Dates come preformatted from core
 * (`formatThirteen`, `formatGregorian`); a range is always "{start} to {end}"
 * with each end formatted on its own (never an interval formatter).
 */

import {
  type GregorianDate,
  type LocalDateTime,
  type ThirteenDate,
  formatGregorian,
  formatThirteen,
  occurrenceDays,
} from '@thirteen/core';
import { copy, plural } from './copy.ts';
import type { StoreOccurrence } from './store.ts';

/**
 * Whether this browser's locale uses a 24-hour clock (the web's stand-in for
 * the OS setting, §2.19): `Intl` resolves the locale's hour cycle.
 */
export function prefers24HourClock(locale?: string): boolean {
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h23' || cycle === 'h24';
  } catch {
    return true;
  }
}

/**
 * A wall-clock minute as the platform's short time: `09:30` (24-hour) or
 * `9:30 AM` (12-hour). Minute 1440 (an end at midnight) reads as midnight.
 * Written out by hand, so no formatter can bring in other spaces or dashes.
 */
export function formatTime(minute: number, use24Hour: boolean): string {
  const m = ((minute % 1440) + 1440) % 1440;
  const hours = Math.floor(m / 60);
  const minutes = String(m % 60).padStart(2, '0');
  if (use24Hour) return `${String(hours).padStart(2, '0')}:${minutes}`;
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${suffix}`;
}

/** `event.timeRange`: "{start} to {end}", each end on its own. */
export function formatTimeRange(startMinute: number, endMinute: number, use24Hour: boolean): string {
  return copy('event.timeRange', { start: formatTime(startMinute, use24Hour), end: formatTime(endMinute, use24Hour) });
}

/** "Thursday, October 12" or "Year Day": a 13-month day without its year (list and day headings). */
export function thirteenDayHeading(date: ThirteenDate): string {
  return formatThirteen(date, { style: 'long', includeWeekday: true, includeYear: false });
}

/** "Gregorian Mon, Oct 19": the Gregorian line under a day heading. */
export function gregorianDayCaption(date: GregorianDate): string {
  return `Gregorian ${formatGregorian(date, { style: 'short', includeWeekday: true })}`;
}

/** Inclusive last day an occurrence covers (an end at midnight does not cover the next day). */
export function lastDay(occurrence: { readonly start: LocalDateTime; readonly end: LocalDateTime }): GregorianDate {
  const days = occurrenceDays(occurrence.start, occurrence.end);
  return days[days.length - 1]!;
}

/** Number of days an occurrence covers. */
export function dayCount(occurrence: { readonly start: LocalDateTime; readonly end: LocalDateTime }): number {
  return occurrenceDays(occurrence.start, occurrence.end).length;
}

/** The bar date form of §2.20: long Gregorian with weekday, the year only when it is not `rowYear`. */
export function barDate(date: GregorianDate, rowYear: number): string {
  return formatGregorian(date, { style: 'long', includeWeekday: true, includeYear: date.year !== rowYear });
}

export interface FlagOptions {
  /** `calendar.flag.dayOf` (rows of a multi-day event). */
  readonly dayOf?: { readonly n: number; readonly total: number } | null;
  /** `calendar.flag.continuesFrom` / `continuesTo` (bars cut by their row), already in the bar date form. */
  readonly continuesFrom?: string | null;
  readonly continuesTo?: string | null;
}

/** The §2.20 flags, in their order: repeats, tentative or canceled, invitation or read only, day of, continuation. */
export function occurrenceFlags(occurrence: StoreOccurrence, options: FlagOptions = {}): string {
  let flags = '';
  if (occurrence.recurring) flags += copy('calendar.flag.repeats');
  if (occurrence.status === 'tentative') flags += copy('calendar.flag.tentative');
  else if (occurrence.status === 'canceled') flags += copy('calendar.flag.canceled');
  if (occurrence.readOnly === 'invitation') flags += copy('calendar.flag.invitation');
  else if (occurrence.readOnly !== null) flags += copy('calendar.flag.readOnly');
  if (options.dayOf) flags += copy('calendar.flag.dayOf', { n: options.dayOf.n, total: options.dayOf.total });
  if (options.continuesFrom) flags += copy('calendar.flag.continuesFrom', { date: options.continuesFrom });
  if (options.continuesTo) flags += copy('calendar.flag.continuesTo', { date: options.continuesTo });
  return flags;
}

/** The time range of a chip or row label: `event.timeRange`, or `event.allDay`. */
export function occurrenceTimeRange(occurrence: StoreOccurrence, use24Hour: boolean): string {
  if (occurrence.allDay) return copy('event.allDay');
  return formatTimeRange(occurrence.start.minute, occurrence.end.minute, use24Hour);
}

/** `calendar.item.a11y` + flags: a Month chip, a day list row, a Week or Day block. */
export function itemLabel(
  occurrence: StoreOccurrence,
  calendarTitle: string,
  use24Hour: boolean,
  options: FlagOptions = {},
): string {
  return (
    copy('calendar.item.a11y', {
      title: occurrence.title,
      'time range': occurrenceTimeRange(occurrence, use24Hour),
      calendar: calendarTitle,
    }) + occurrenceFlags(occurrence, options)
  );
}

/**
 * `calendar.bar.a11y` (one day: `calendar.bar.oneDay.a11y`) + flags, for an
 * all-day or multi-day bar drawn in a row of `rowYear`. A timed bar (24 hours
 * or more) is named like a chip, with its times.
 */
export function barLabel(
  occurrence: StoreOccurrence,
  calendarTitle: string,
  rowYear: number,
  use24Hour: boolean,
  cut: { readonly before: boolean; readonly after: boolean } = { before: false, after: false },
): string {
  const first = occurrence.start.date;
  const last = lastDay(occurrence);
  const options: FlagOptions = {
    continuesFrom: cut.before ? barDate(first, rowYear) : null,
    continuesTo: cut.after ? barDate(last, rowYear) : null,
  };
  if (!occurrence.allDay) return itemLabel(occurrence, calendarTitle, use24Hour, options);
  const oneDay = first.year === last.year && first.month === last.month && first.day === last.day;
  const base = oneDay
    ? copy('calendar.bar.oneDay.a11y', { title: occurrence.title, calendar: calendarTitle })
    : copy('calendar.bar.a11y', {
        title: occurrence.title,
        startDate: barDate(first, rowYear),
        endDate: barDate(last, rowYear),
        calendar: calendarTitle,
      });
  return base + occurrenceFlags(occurrence, options);
}

/**
 * `calendar.row.a11y` + flags: an Up next or List row. `time` is what the time
 * column shows (a time, `event.allDay` or `calendar.dayOfDays`); ", {location}"
 * is left out when there is none.
 */
export function rowLabel(
  occurrence: StoreOccurrence,
  calendarTitle: string,
  time: string,
  dayOf: { readonly n: number; readonly total: number } | null = null,
): string {
  const base = copy('calendar.row.a11y', {
    time,
    title: occurrence.title,
    calendar: calendarTitle,
    location: occurrence.location,
  });
  const text = occurrence.location === '' ? base.slice(0, base.length - ', '.length) : base;
  return text + occurrenceFlags(occurrence, { dayOf });
}

/** `calendar.cell.a11y` (+ events + Gregorian month start): a Month day cell. */
export function monthCellLabel(
  thirteen: ThirteenDate,
  gregorian: GregorianDate,
  eventCount: number,
  gregorianMonthStart: string | null,
): string {
  let label = copy('calendar.cell.a11y', {
    date: formatThirteen(thirteen, { style: 'long', includeWeekday: true }),
    gregorianDate: formatGregorian(gregorian, { style: 'long', includeWeekday: true }),
  });
  if (eventCount > 0) label += ` ${plural('calendar.cell.events.a11y', eventCount)}`;
  if (gregorianMonthStart !== null) label += ` ${copy('calendar.gregorianMonthBegins.a11y', { Month: gregorianMonthStart })}`;
  return label;
}

/** `calendar.band.a11y` (+ events): a Month intercalary band. */
export function bandLabel(thirteen: ThirteenDate, gregorian: GregorianDate, eventCount: number): string {
  let label = copy('calendar.band.a11y', {
    name: formatThirteen(thirteen, { style: 'long' }),
    gregorianDate: formatGregorian(gregorian, { style: 'long', includeWeekday: true }),
  });
  if (eventCount > 0) label += ` ${plural('calendar.cell.events.a11y', eventCount)}`;
  return label;
}
