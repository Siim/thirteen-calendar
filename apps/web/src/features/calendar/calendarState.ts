/**
 * The Calendar section's state as plain functions (docs/EVENTS.md §2.1,
 * §2.22): which mode and day a route shows, how each mode pages, when "Today"
 * is on screen, and the toolbar titles. Everything takes Gregorian dates and a
 * system id, so it is easy to test without a browser.
 */

import {
  type CalendarSystemId,
  type GregorianDate,
  type ThirteenDate,
  type ThirteenMonthDate,
  addGregorianDays,
  daysInGregorianMonth,
  fromThirteen,
  formatGregorian,
  formatThirteen,
  getCalendarSystem,
  intercalaryDaysInYear,
  monthDays,
  toDisplayYear,
  toISODate,
  toThirteen,
  tryParseISODate,
} from '@thirteen/core';
import { copy, readStorage, writeStorage } from '@thirteen/ui';
import type { Route } from '../../app/router.ts';

/** The five Calendar modes (§2.1), in the order of the segmented control. */
export const CALENDAR_MODES = ['day', 'week', 'month', 'year', 'list'] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

export function isCalendarMode(value: unknown): value is CalendarMode {
  return typeof value === 'string' && (CALENDAR_MODES as readonly string[]).includes(value);
}

/** What the Calendar shows: a mode and the day it is about (the selected day, the week's or month's day, List's first day). */
export interface CalendarView {
  readonly mode: CalendarMode;
  readonly date: GregorianDate;
}

/** The 13-month month a day belongs to on screen: its own, or the month an intercalary day follows (§2.2). */
export function monthOf(date: GregorianDate, systemId: CalendarSystemId): { readonly year: number; readonly month: number } {
  const t = toThirteen(date, systemId);
  if (t.kind === 'month') return { year: t.year, month: t.month };
  return { year: t.year, month: afterMonth(t) };
}

function afterMonth(t: ThirteenDate & { readonly kind: 'intercalary' }): number {
  return getCalendarSystem(t.system).intercalaryDays.find((info) => info.id === t.id)!.afterMonth;
}

/** The 13-month week a day is in (an intercalary day is a column of week 4 of the month it follows, §2.5). */
export function weekOf(
  date: GregorianDate,
  systemId: CalendarSystemId,
): { readonly year: number; readonly month: number; readonly week: 1 | 2 | 3 | 4 } {
  const t = toThirteen(date, systemId);
  if (t.kind === 'month') return { year: t.year, month: t.month, week: (Math.floor((t.day - 1) / 7) + 1) as 1 | 2 | 3 | 4 };
  return { year: t.year, month: afterMonth(t), week: 4 };
}

/** A 13-month month day as (month, day) for paging; an intercalary day pages from the last day of the month it follows. */
function monthPosition(date: GregorianDate, systemId: CalendarSystemId): { year: number; month: number; day: number } {
  const t = toThirteen(date, systemId);
  if (t.kind === 'month') return { year: t.year, month: t.month, day: t.day };
  return { year: t.year, month: afterMonth(t), day: 28 };
}

function monthDate(year: number, month: number, day: number, systemId: CalendarSystemId): GregorianDate | null {
  let y = year;
  let m = month;
  while (m > 13) {
    m -= 13;
    y += 1;
  }
  while (m < 1) {
    m += 13;
    y -= 1;
  }
  if (y < 1 || y > 9999) return null;
  const t: ThirteenMonthDate = { kind: 'month', system: systemId, year: y, month: m, day };
  return fromThirteen(t);
}

/**
 * The day the next (`delta` 1) or previous (-1) period of a mode is about
 * (§2.1): Day by a day, Week by a 13-month week (week 4 of December goes to
 * week 1 of January), Month by a 13-month month keeping the day of the month,
 * Year by a year, List by a month (to its first day). `null` past 0001 or 9999.
 */
export function pageDate(view: CalendarView, delta: 1 | -1, systemId: CalendarSystemId): GregorianDate | null {
  const { date } = view;
  try {
    switch (view.mode) {
      case 'day':
        return addGregorianDays(date, delta);
      case 'week': {
        const p = monthPosition(date, systemId);
        const day = p.day + 7 * delta;
        if (day >= 1 && day <= 28) return monthDate(p.year, p.month, day, systemId);
        return monthDate(p.year, p.month + delta, day - 28 * delta, systemId);
      }
      case 'month': {
        const p = monthPosition(date, systemId);
        return monthDate(p.year, p.month + delta, p.day, systemId);
      }
      case 'list': {
        const p = monthPosition(date, systemId);
        return monthDate(p.year, p.month + delta, 1, systemId);
      }
      case 'year': {
        const year = date.year + delta;
        if (year < 1 || year > 9999) return null;
        return { year, month: date.month, day: Math.min(date.day, daysInGregorianMonth(year, date.month)) };
      }
    }
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** True when today is on screen, so "Today" is hidden (§2.1): Month or Week contains it, Day is it, List starts at it, Year is this year. */
export function showsToday(view: CalendarView, today: GregorianDate, systemId: CalendarSystemId): boolean {
  switch (view.mode) {
    case 'day':
    case 'list':
      return toISODate(view.date) === toISODate(today);
    case 'year':
      return view.date.year === today.year;
    case 'month': {
      const a = monthOf(view.date, systemId);
      const b = monthOf(today, systemId);
      return a.year === b.year && a.month === b.month;
    }
    case 'week': {
      const a = weekOf(view.date, systemId);
      const b = weekOf(today, systemId);
      return a.year === b.year && a.month === b.month && a.week === b.week;
    }
  }
}

/** The Gregorian days a month shows: its 28 days and the intercalary days that follow it. */
export function monthSpan(year: number, month: number, systemId: CalendarSystemId): readonly GregorianDate[] {
  const days = monthDays(year, month, systemId);
  const extra = intercalaryDaysInYear(year, systemId)
    .filter((day) => day.afterMonth === month)
    .map((day) => day.gregorian);
  return [...days, ...extra];
}

/** The Gregorian days of a 13-month week: 7 days, plus the intercalary days after week 4. */
export function weekSpan(year: number, month: number, week: number, systemId: CalendarSystemId): readonly GregorianDate[] {
  const days = monthDays(year, month, systemId).slice((week - 1) * 7, week * 7);
  if (week !== 4) return days;
  return [
    ...days,
    ...intercalaryDaysInYear(year, systemId)
      .filter((d) => d.afterMonth === month)
      .map((d) => d.gregorian),
  ];
}

/** "Gregorian Oct 8 to Nov 4"; `compactEnd` writes "Oct 15 to 21" within one month (Week); the year is added when the range crosses years. */
export function gregorianRange(first: GregorianDate, last: GregorianDate, compactEnd: boolean): string {
  const crosses = first.year !== last.year;
  const start = formatGregorian(first, { style: crosses ? 'medium' : 'short' });
  const end =
    compactEnd && !crosses && first.month === last.month
      ? String(last.day)
      : formatGregorian(last, { style: crosses ? 'medium' : 'short' });
  return copy('calendar.subtitle.range', { start, end });
}

export interface ViewTitle {
  readonly title: string;
  readonly subtitle: string | null;
  /** Day mode on an intercalary day: the "No weekday" plate (§2.1). */
  readonly noWeekday: boolean;
}

/** The toolbar title and subtitle of a view (§2.1 Titles). */
export function viewTitle(view: CalendarView, systemId: CalendarSystemId): ViewTitle {
  const system = getCalendarSystem(systemId);
  switch (view.mode) {
    case 'year': {
      const year = view.date.year;
      return {
        title: String(toDisplayYear(year, systemId)),
        subtitle: systemId === 'ifc' ? null : `Gregorian ${year}`,
        noWeekday: false,
      };
    }
    case 'month': {
      const { year, month } = monthOf(view.date, systemId);
      const span = monthSpan(year, month, systemId);
      return {
        title: `${system.months[month - 1]!.name} ${toDisplayYear(year, systemId)}`,
        subtitle: gregorianRange(span[0]!, span[span.length - 1]!, false),
        noWeekday: false,
      };
    }
    case 'week': {
      const { year, month, week } = weekOf(view.date, systemId);
      const span = weekSpan(year, month, week, systemId);
      return {
        title: copy('calendar.title.week', {
          Month: system.months[month - 1]!.name,
          displayYear: toDisplayYear(year, systemId),
          n: week,
        }),
        subtitle: gregorianRange(span[0]!, span[span.length - 1]!, true),
        noWeekday: false,
      };
    }
    case 'day': {
      const t = toThirteen(view.date, systemId);
      return {
        title: formatThirteen(t, { includeWeekday: true }),
        subtitle: copy('calendar.subtitle.day', { gregorianDate: formatGregorian(view.date, { includeWeekday: true }) }),
        noWeekday: t.kind === 'intercalary',
      };
    }
    case 'list':
      return { title: copy('calendar.list.title'), subtitle: null, noWeekday: false };
  }
}

/** `calendar.announce.page`: "November 2026. Gregorian Nov 5 to Dec 2." (a view without a subtitle: "2026."). */
export function pageAnnouncement(title: ViewTitle): string {
  return title.subtitle === null
    ? `${title.title}.`
    : copy('calendar.announce.page', { title: title.title, subtitle: title.subtitle });
}

/** The route that shows a view (`day` is Year mode's open day sheet, kept from the current route). */
export function viewRoute(view: CalendarView, systemId: CalendarSystemId, yearDay: string | null = null): Route {
  const iso = toISODate(view.date);
  switch (view.mode) {
    case 'year':
      return { name: 'year', year: view.date.year, day: yearDay };
    case 'month': {
      const { year, month } = monthOf(view.date, systemId);
      return { name: 'month', year, month, day: iso };
    }
    case 'week':
      return { name: 'week', date: iso };
    case 'day':
      return { name: 'day', date: iso };
    case 'list':
      return { name: 'list', date: iso };
  }
}

/** Where `#/calendar` goes: the last mode and day of this window (§2.1), kept in sessionStorage. */
const LAST_VIEW_KEY = 'thirteen:calendar.lastView';

export function readLastView(): CalendarView | null {
  let text: string | null = null;
  try {
    text = window.sessionStorage.getItem(LAST_VIEW_KEY);
  } catch {
    text = readStorage(LAST_VIEW_KEY);
  }
  if (text === null) return null;
  const [mode, iso] = text.split(' ');
  const date = tryParseISODate(iso ?? '');
  return isCalendarMode(mode) && date !== null ? { mode, date } : null;
}

export function writeLastView(view: CalendarView): void {
  const text = `${view.mode} ${toISODate(view.date)}`;
  try {
    window.sessionStorage.setItem(LAST_VIEW_KEY, text);
  } catch {
    writeStorage(LAST_VIEW_KEY, text);
  }
}

/** The day a Month route is about: `?day=` when it is in that month, else today when it is, else the month's first day. */
function monthRouteDate(
  year: number,
  month: number,
  day: GregorianDate | null,
  today: GregorianDate,
  systemId: CalendarSystemId,
): GregorianDate {
  const span = monthSpan(year, month, systemId).map(toISODate);
  if (day !== null && span.includes(toISODate(day))) return day;
  if (span.includes(toISODate(today))) return today;
  return fromThirteen({ kind: 'month', system: systemId, year, month, day: 1 });
}

/**
 * The view a Calendar route shows (§2.22). Invalid or missing values fall back
 * to defaults: today, this month, the last mode. `noWeek` turns Week into Day
 * (§2.1: no Week mode at compact width; §2.20: Week falls back to Day at
 * accessibility text sizes).
 */
export function routeView(route: Route, today: GregorianDate, systemId: CalendarSystemId, noWeek: boolean): CalendarView | null {
  const date = (text: string | null) => (text === null ? null : tryParseISODate(text));
  const fallback = (mode: CalendarMode): CalendarView => ({ mode, date: today });
  let view: CalendarView | null;
  switch (route.name) {
    case 'calendar':
    case 'new-event':
    case 'subscribe': {
      const last = readLastView();
      const day = route.name === 'new-event' ? date(route.date) : null;
      view = day !== null ? { mode: last?.mode ?? 'month', date: day } : (last ?? fallback('month'));
      break;
    }
    case 'year': {
      const year = route.year ?? today.year;
      const day = date(route.day);
      view = {
        mode: 'year',
        date: day !== null && day.year === year ? day : year === today.year ? today : { year, month: 1, day: 1 },
      };
      break;
    }
    case 'month': {
      const year = route.year ?? today.year;
      const month = route.month ?? (year === today.year ? monthOf(today, systemId).month : 1);
      view = { mode: 'month', date: monthRouteDate(year, month, date(route.day), today, systemId) };
      break;
    }
    case 'week':
    case 'day':
    case 'list':
      view = { mode: route.name, date: date(route.date) ?? today };
      break;
    default:
      view = null;
  }
  if (view !== null && noWeek && view.mode === 'week') return { mode: 'day', date: view.date };
  return view;
}
