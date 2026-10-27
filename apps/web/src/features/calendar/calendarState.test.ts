import { describe, expect, it } from 'vitest';
import {
  type CalendarView,
  gregorianRange,
  pageAnnouncement,
  pageDate,
  readLastView,
  routeView,
  showsToday,
  viewRoute,
  viewTitle,
  writeLastView,
} from './calendarState.ts';

const TODAY = { year: 2026, month: 10, day: 19 }; // IFC Thursday, October 12, 2026
const d = (year: number, month: number, day: number) => ({ year, month, day });
const iso = (date: { year: number; month: number; day: number } | null) =>
  date === null ? null : `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

describe('viewTitle (§2.1 Titles)', () => {
  it('names each mode as the spec does', () => {
    expect(viewTitle({ mode: 'year', date: TODAY }, 'ifc')).toEqual({ title: '2026', subtitle: null, noWeekday: false });
    expect(viewTitle({ mode: 'year', date: TODAY }, 'positivist')).toEqual({
      title: '238',
      subtitle: 'Gregorian 2026',
      noWeekday: false,
    });
    expect(viewTitle({ mode: 'month', date: TODAY }, 'ifc')).toEqual({
      title: 'October 2026',
      subtitle: 'Gregorian Oct 8 to Nov 4',
      noWeekday: false,
    });
    expect(viewTitle({ mode: 'month', date: TODAY }, 'positivist').title).toBe('Descartes 238');
    expect(viewTitle({ mode: 'week', date: TODAY }, 'ifc')).toEqual({
      title: 'October 2026, week 2',
      subtitle: 'Gregorian Oct 15 to 21',
      noWeekday: false,
    });
    expect(viewTitle({ mode: 'day', date: TODAY }, 'ifc')).toEqual({
      title: 'Thursday, October 12, 2026',
      subtitle: 'Gregorian Monday, October 19, 2026',
      noWeekday: false,
    });
    expect(viewTitle({ mode: 'day', date: d(2026, 12, 31) }, 'ifc')).toEqual({
      title: 'Year Day 2026',
      subtitle: 'Gregorian Thursday, December 31, 2026',
      noWeekday: true,
    });
    expect(viewTitle({ mode: 'list', date: TODAY }, 'ifc')).toEqual({ title: 'Upcoming', subtitle: null, noWeekday: false });
  });

  it('counts the intercalary days in the month and week they follow', () => {
    // IFC December 2026 is followed by Year Day (board G: "Gregorian Dec 3 to Dec 31").
    expect(viewTitle({ mode: 'month', date: d(2026, 12, 31) }, 'ifc').subtitle).toBe('Gregorian Dec 3 to Dec 31');
    expect(viewTitle({ mode: 'week', date: d(2026, 12, 31) }, 'ifc')).toMatchObject({
      title: 'December 2026, week 4',
      subtitle: 'Gregorian Dec 24 to 31',
    });
    expect(gregorianRange(d(2026, 12, 30), d(2027, 1, 2), true)).toBe('Gregorian Dec 30, 2026 to Jan 2, 2027');
  });

  it('announces the new page politely (calendar.announce.page)', () => {
    expect(pageAnnouncement(viewTitle({ mode: 'month', date: d(2026, 11, 16) }, 'ifc'))).toBe(
      'November 2026. Gregorian Nov 5 to Dec 2.',
    );
    expect(pageAnnouncement(viewTitle({ mode: 'year', date: TODAY }, 'ifc'))).toBe('2026.');
  });
});

describe('pageDate (§2.1 paging)', () => {
  const page = (view: CalendarView, delta: 1 | -1) => iso(pageDate(view, delta, 'ifc'));

  it('moves Month by a 13-month month, keeping the day, across years', () => {
    expect(page({ mode: 'month', date: TODAY }, 1)).toBe('2026-11-16'); // IFC November 12
    expect(page({ mode: 'month', date: d(2026, 12, 20) }, 1)).toBe('2027-01-18'); // December 22 -> January 22, 2027
    expect(page({ mode: 'month', date: d(2026, 12, 31) }, 1)).toBe('2027-01-28'); // Year Day pages from December 28
    expect(page({ mode: 'month', date: d(2026, 1, 5) }, -1)).toBe('2025-12-07'); // January 5 -> December 5, 2025
  });

  it('moves Week by a 13-month week: week 4 of December goes to week 1 of January', () => {
    expect(page({ mode: 'week', date: TODAY }, 1)).toBe('2026-10-26');
    expect(page({ mode: 'week', date: d(2026, 12, 30) }, 1)).toBe('2027-01-07'); // December 28 -> January 7
    expect(page({ mode: 'week', date: d(2026, 12, 31) }, 1)).toBe('2027-01-07'); // Year Day, in week 4 -> January 7
    expect(page({ mode: 'week', date: d(2027, 1, 1) }, -1)).toBe('2026-12-24'); // January 1 -> December 22
  });

  it('moves Day by a day (intercalary days included), Year by a year, List by a month', () => {
    expect(page({ mode: 'day', date: d(2026, 12, 30) }, 1)).toBe('2026-12-31');
    expect(page({ mode: 'year', date: d(2024, 2, 29) }, 1)).toBe('2025-02-28');
    expect(page({ mode: 'list', date: TODAY }, 1)).toBe('2026-11-05'); // IFC November 1
    expect(pageDate({ mode: 'year', date: d(9999, 6, 1) }, 1, 'ifc')).toBeNull();
    expect(pageDate({ mode: 'day', date: d(1, 1, 1) }, -1, 'ifc')).toBeNull();
  });
});

describe('showsToday (§2.1: Today is hidden while today is on screen)', () => {
  it('follows each mode', () => {
    expect(showsToday({ mode: 'month', date: d(2026, 11, 4) }, TODAY, 'ifc')).toBe(true);
    expect(showsToday({ mode: 'month', date: d(2026, 11, 5) }, TODAY, 'ifc')).toBe(false);
    expect(showsToday({ mode: 'week', date: d(2026, 10, 15) }, TODAY, 'ifc')).toBe(true);
    expect(showsToday({ mode: 'week', date: d(2026, 10, 14) }, TODAY, 'ifc')).toBe(false);
    expect(showsToday({ mode: 'day', date: TODAY }, TODAY, 'ifc')).toBe(true);
    expect(showsToday({ mode: 'list', date: d(2026, 10, 20) }, TODAY, 'ifc')).toBe(false);
    expect(showsToday({ mode: 'year', date: d(2026, 1, 1) }, TODAY, 'ifc')).toBe(true);
    // Year Day belongs to December's month and week 4 on screen.
    expect(showsToday({ mode: 'month', date: d(2026, 12, 3) }, d(2026, 12, 31), 'ifc')).toBe(true);
  });
});

describe('routeView and viewRoute (§2.22)', () => {
  it('reads each route, with defaults for missing or invalid values', () => {
    expect(routeView({ name: 'month', year: 2026, month: 11, day: null }, TODAY, 'ifc', false)).toEqual({
      mode: 'month',
      date: TODAY,
    });
    expect(routeView({ name: 'month', year: 2026, month: 12, day: null }, TODAY, 'ifc', false)).toEqual({
      mode: 'month',
      date: d(2026, 11, 5),
    });
    expect(routeView({ name: 'month', year: 2026, month: 12, day: '2026-11-20' }, TODAY, 'ifc', false)?.date).toEqual(
      d(2026, 11, 20),
    );
    expect(routeView({ name: 'month', year: null, month: null, day: null }, TODAY, 'ifc', false)).toEqual({
      mode: 'month',
      date: TODAY,
    });
    expect(routeView({ name: 'day', date: 'garbage' }, TODAY, 'ifc', false)).toEqual({ mode: 'day', date: TODAY });
    expect(routeView({ name: 'year', year: 2030, day: null }, TODAY, 'ifc', false)).toEqual({
      mode: 'year',
      date: d(2030, 1, 1),
    });
  });

  it('shows Day for a Week link on compact width', () => {
    expect(routeView({ name: 'week', date: '2026-10-21' }, TODAY, 'ifc', true)).toEqual({ mode: 'day', date: d(2026, 10, 21) });
    expect(routeView({ name: 'week', date: '2026-10-21' }, TODAY, 'ifc', false)).toEqual({ mode: 'week', date: d(2026, 10, 21) });
  });

  it('opens #/calendar in the last mode of this window (first launch: Month, today)', () => {
    window.sessionStorage.clear();
    expect(readLastView()).toBeNull();
    expect(routeView({ name: 'calendar' }, TODAY, 'ifc', false)).toEqual({ mode: 'month', date: TODAY });
    writeLastView({ mode: 'list', date: d(2026, 11, 2) });
    expect(routeView({ name: 'calendar' }, TODAY, 'ifc', false)).toEqual({ mode: 'list', date: d(2026, 11, 2) });
    expect(routeView({ name: 'new-event', date: '2026-12-01' }, TODAY, 'ifc', false)).toEqual({
      mode: 'list',
      date: d(2026, 12, 1),
    });
    window.sessionStorage.clear();
  });

  it('round-trips every mode through its route', () => {
    const views: CalendarView[] = [
      { mode: 'month', date: d(2026, 11, 20) },
      { mode: 'week', date: d(2026, 11, 20) },
      { mode: 'day', date: d(2026, 12, 31) },
      { mode: 'list', date: TODAY },
    ];
    for (const view of views) expect(routeView(viewRoute(view, 'ifc'), TODAY, 'ifc', false)).toEqual(view);
    expect(viewRoute({ mode: 'year', date: TODAY }, 'ifc', '2026-10-19')).toEqual({
      name: 'year',
      year: 2026,
      day: '2026-10-19',
    });
  });
});
