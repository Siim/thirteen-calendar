/**
 * Section builders for the layout part of `fixtures/events.json`
 * (docs/EVENTS.md §5.3, §5.5): `chipTimes`, `monthColumns`, `monthLayouts`,
 * `weekLayouts`, `dayLayouts`, `agendas` and `yearMarks`
 * ({@link C5_SECTIONS}, task C5). Task C6 assembles the file from these and the
 * other tasks' builders.
 *
 * Every builder is pure and deterministic. Inputs are listed in tables, so the
 * counts are exact; expected values come from `src/events/layout.ts` and are
 * pinned by hand-written assertions in `test/events/layout.test.ts`. JSON forms
 * (§5.5): dates `"YYYY-MM-DD"`, wall-clock times `"YYYY-MM-DDTHH:MM"` (`T24:00`
 * in ends), occurrences `{key, calendarId, title, allDay, start, end}`, objects
 * with the fields of their TypeScript type in declaration order, weekdays and
 * 13-month dates as the engine's plain data.
 *
 * The mockup cases use {@link MOCKUP_IFC_OCTOBER_2026}, the occurrences of the
 * mockup data set (§6.7) in IFC October 2026 (Gregorian October 8 to November
 * 4) written out from the §6.7 table. When `pnpm fixtures` writes the file,
 * task C6 passes the occurrences of `fixtures/mockup/mockup-events.json`
 * (`mockup-events.ts`) to the builders instead (see {@link C5_SECTIONS});
 * `test/events/fixtures.test.ts` checks that both agree in that window.
 */

import { type CalendarSystemId, type ThirteenDate, type Weekday, compareGregorian } from '../src/index.ts';
import { type EventOccurrence, normalizeEventEnd, parseLocalDateTime } from '../src/events/index.ts';
import {
  type AgendaDay,
  type AgendaItem,
  type IntercalaryBand,
  type MonthItem,
  type ThirteenMonthEventLayout,
  type TimedItem,
  type TimedOverflow,
  type WeekEventLayout,
  type YearMark,
  agenda,
  formatChipTime,
  layoutDayEvents,
  layoutThirteenMonthEvents,
  layoutThirteenWeekEvents,
  monthColumnGregorianWeekdays,
  yearEventMarks,
} from '../src/events/layout.ts';
import { type DateJson, type LocalJson, dateFromJson, dateJson, localFromJson, localJson } from './events-fixtures.ts';

// ---------------------------------------------------------------------------
// JSON forms (§5.5; dates and wall-clock times as in events-fixtures.ts)
// ---------------------------------------------------------------------------

export interface OccurrenceJson {
  readonly key: string;
  readonly calendarId: string;
  readonly title: string;
  readonly allDay: boolean;
  readonly start: LocalJson;
  readonly end: LocalJson;
}

export interface IntercalaryBandJson {
  readonly id: IntercalaryBand['id'];
  readonly gregorian: DateJson;
  readonly items: readonly MonthItem[];
  readonly visibleLanes: number;
  readonly hidden: number;
}

export interface MonthWeekRowJson {
  readonly week: 1 | 2 | 3 | 4;
  readonly items: readonly MonthItem[];
  readonly visibleLanes: readonly number[];
  readonly hidden: readonly number[];
}

export interface MonthLayoutJson {
  readonly year: number;
  readonly month: number;
  readonly system: CalendarSystemId;
  readonly columnGregorianWeekdays: readonly Weekday[];
  readonly weeks: readonly MonthWeekRowJson[];
  readonly intercalary: readonly IntercalaryBandJson[];
}

export interface WeekColumnJson {
  readonly kind: 'day' | 'intercalary';
  readonly gregorian: DateJson;
  readonly thirteen: ThirteenDate;
}

export interface WeekLayoutJson {
  readonly columns: readonly WeekColumnJson[];
  readonly allDay: readonly MonthItem[];
  readonly timed: readonly TimedItem[];
  readonly overflow: readonly TimedOverflow[];
}

export interface DayLayoutJson {
  readonly allDay: readonly string[];
  readonly timed: readonly TimedItem[];
  readonly overflow: readonly TimedOverflow[];
}

export interface AgendaDayJson {
  readonly gregorian: DateJson;
  readonly thirteen: ThirteenDate;
  readonly items: readonly AgendaItem[];
}

export interface YearMarkJson {
  readonly dayOfYear: number;
  readonly gregorian: DateJson;
  readonly count: number;
  readonly calendarIds: readonly string[];
}

/** A fresh copy of plain data that holds no `GregorianDate` (the dates are converted by the callers). */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function occurrenceJson(occurrence: EventOccurrence): OccurrenceJson {
  return {
    key: occurrence.key,
    calendarId: occurrence.calendarId,
    title: occurrence.title,
    allDay: occurrence.allDay,
    start: localJson(occurrence.start),
    end: localJson(occurrence.end),
  };
}

export function occurrenceFromJson(json: OccurrenceJson): EventOccurrence {
  return {
    key: json.key,
    calendarId: json.calendarId,
    title: json.title,
    allDay: json.allDay,
    start: localFromJson(json.start),
    end: localFromJson(json.end),
  };
}

export function monthLayoutJson(layout: ThirteenMonthEventLayout): MonthLayoutJson {
  return {
    year: layout.year,
    month: layout.month,
    system: layout.system,
    columnGregorianWeekdays: [...layout.columnGregorianWeekdays],
    weeks: layout.weeks.map((row) => ({
      week: row.week,
      items: plain(row.items),
      visibleLanes: [...row.visibleLanes],
      hidden: [...row.hidden],
    })),
    intercalary: layout.intercalary.map((band) => ({
      id: band.id,
      gregorian: dateJson(band.gregorian),
      items: plain(band.items),
      visibleLanes: band.visibleLanes,
      hidden: band.hidden,
    })),
  };
}

export function weekLayoutJson(layout: WeekEventLayout): WeekLayoutJson {
  return {
    columns: layout.columns.map((column) => ({
      kind: column.kind,
      gregorian: dateJson(column.gregorian),
      thirteen: plain(column.thirteen),
    })),
    allDay: plain(layout.allDay),
    timed: plain(layout.timed),
    overflow: plain(layout.overflow),
  };
}

export function agendaJson(days: readonly AgendaDay[]): AgendaDayJson[] {
  return days.map((day) => ({ gregorian: dateJson(day.gregorian), thirteen: plain(day.thirteen), items: plain(day.items) }));
}

export function yearMarksJson(marks: readonly YearMark[]): YearMarkJson[] {
  return marks.map((mark) => ({
    dayOfYear: mark.dayOfYear,
    gregorian: dateJson(mark.gregorian),
    count: mark.count,
    calendarIds: [...mark.calendarIds],
  }));
}

// ---------------------------------------------------------------------------
// Section entry shapes (§5.5)
// ---------------------------------------------------------------------------

/** `chipTimes`: `formatChipTime(minute, use24Hour)`. */
export interface ChipTimeCase {
  readonly minute: number;
  readonly use24Hour: boolean;
  readonly text: string;
}

/** `monthColumns`: `monthColumnGregorianWeekdays(year, month, system)`. */
export interface MonthColumnsCase {
  readonly year: number;
  readonly month: number;
  readonly system: CalendarSystemId;
  readonly weekdays: readonly Weekday[];
}

/** `monthLayouts`: `layoutThirteenMonthEvents(year, month, occurrences, system, { maxLanes })`; `null` = unlimited. */
export interface MonthLayoutCase {
  readonly year: number;
  readonly month: number;
  readonly system: CalendarSystemId;
  readonly maxLanes: number | null;
  readonly occurrences: readonly OccurrenceJson[];
  readonly expected: MonthLayoutJson;
}

/** `weekLayouts`: `layoutThirteenWeekEvents(year, month, week, occurrences, system, { maxSlots })` (default minimum duration). */
export interface WeekLayoutCase {
  readonly year: number;
  readonly month: number;
  readonly week: 1 | 2 | 3 | 4;
  readonly system: CalendarSystemId;
  readonly maxSlots: number | null;
  readonly occurrences: readonly OccurrenceJson[];
  readonly expected: WeekLayoutJson;
}

/** `dayLayouts`: `layoutDayEvents(date, occurrences, { minDurationMinutes, maxSlots })`; `null` = unlimited. */
export interface DayLayoutCase {
  readonly date: DateJson;
  readonly occurrences: readonly OccurrenceJson[];
  readonly minDurationMinutes: number;
  readonly maxSlots: number | null;
  readonly expected: DayLayoutJson;
}

/** `agendas`: `agenda(occurrences, from, to, system, { includeEmptyDays })`. */
export interface AgendaCase {
  readonly from: DateJson;
  readonly to: DateJson;
  readonly system: CalendarSystemId;
  readonly includeEmptyDays: boolean;
  readonly occurrences: readonly OccurrenceJson[];
  readonly expected: readonly AgendaDayJson[];
}

/** `yearMarks`: `yearEventMarks(year, occurrences, { maxCalendars })`. */
export interface YearMarksCase {
  readonly year: number;
  readonly maxCalendars: number;
  readonly occurrences: readonly OccurrenceJson[];
  readonly expected: readonly YearMarkJson[];
}

// ---------------------------------------------------------------------------
// Occurrence inputs
// ---------------------------------------------------------------------------

/**
 * A timed occurrence (`start` and `end` as `YYYY-MM-DDTHH:MM`; the end may be
 * `T24:00`, or before the start on a fall-back night).
 */
function timed(key: string, start: string, end: string, title = key, calendarId = 'home'): EventOccurrence {
  return { key, calendarId, title, allDay: false, start: parseLocalDateTime(start), end: parseLocalDateTime(end) };
}

/** An all-day occurrence from `first` to `last` (inclusive dates). */
function allDay(key: string, first: string, last: string = first, title = key, calendarId = 'home'): EventOccurrence {
  return {
    key,
    calendarId,
    title,
    allDay: true,
    start: parseLocalDateTime(`${first}T00:00`),
    end: parseLocalDateTime(`${last}T24:00`),
  };
}

/** A mockup occurrence keyed as on Windows and web (§3.2): `{calendarId}/{uid}|{original start}`. */
function mockTimed(calendarId: string, uid: string, title: string, date: string, from: string, to: string): EventOccurrence {
  return timed(`${calendarId}/${uid}|${date}T${from}`, `${date}T${from}`, `${date}T${to}`, title, calendarId);
}

function mockAllDay(calendarId: string, uid: string, title: string, first: string, last: string = first): EventOccurrence {
  return allDay(`${calendarId}/${uid}|${first}`, first, last, title, calendarId);
}

/**
 * The occurrences that touch a day from `first` to `last` (inclusive), in
 * their order: the window a platform fetches for one view. Keeps the mockup
 * cases small when C6 passes a longer generated expansion.
 */
function touching(occurrences: readonly EventOccurrence[], first: string, last: string): EventOccurrence[] {
  const from = dateFromJson(first);
  const to = dateFromJson(last);
  return occurrences.filter((occurrence) => {
    const end = normalizeEventEnd(occurrence.start, occurrence.end);
    return compareGregorian(occurrence.start.date, to) <= 0 && compareGregorian(end.date, from) >= 0;
  });
}

/**
 * The mockup data set (§6.7) in IFC October 2026, Gregorian 2026-10-08 to
 * 2026-11-04, in date order. Repeats expanded by hand: Rent on IFC October 1;
 * Sprint planning every 2 weeks from January 12; 1:1 every Monday; Book club
 * on IFC October 12; Yoga every IFC Friday (IFC October 6, 13, 20, 27);
 * Payday on the 25th; Recycling every 2 IFC weeks from IFC January 6 (IFC
 * October 6 and 20). Every timed event is in Europe/Tallinn, the device zone.
 */
export const MOCKUP_IFC_OCTOBER_2026: readonly EventOccurrence[] = [
  mockAllDay('home', 'rent', 'Rent', '2026-10-08'),
  mockTimed('running-club', 'half-marathon', 'Half marathon', '2026-10-10', '09:00', '12:00'),
  mockAllDay('work', 'team-offsite', 'Team offsite, Pärnu', '2026-10-12', '2026-10-14'),
  mockTimed('work', 'one-on-one', '1:1 with Marta', '2026-10-12', '11:00', '11:30'),
  mockAllDay('home', 'recycling', 'Recycling pickup', '2026-10-13'),
  mockTimed('running-club', 'yoga', 'Yoga', '2026-10-13', '07:15', '08:15'),
  mockTimed('work', 'kodak-call', 'Kodak archive call', '2026-10-15', '16:00', '16:45'),
  mockTimed('home', 'lunch-jaan', 'Lunch with Jaan', '2026-10-16', '12:00', '13:00'),
  mockTimed('running-club', 'long-run', 'Long run', '2026-10-17', '08:00', '10:00'),
  mockTimed('family', 'family-brunch', 'Family brunch', '2026-10-18', '11:00', '13:00'),
  mockAllDay('family', 'school-break', 'Autumn school break', '2026-10-19', '2026-10-25'),
  mockTimed('work', 'sprint-planning', 'Sprint planning', '2026-10-19', '09:30', '10:30'),
  mockTimed('work', 'one-on-one', '1:1 with Marta', '2026-10-19', '11:00', '11:30'),
  mockTimed('home', 'dentist', 'Dentist, Dr. Tamm', '2026-10-19', '15:40', '16:20'),
  mockTimed('home', 'book-club', 'Book club: Cotsworth', '2026-10-19', '19:00', '21:00'),
  mockTimed('running-club', 'yoga', 'Yoga', '2026-10-20', '07:15', '08:15'),
  mockTimed('work', 'design-review-prep', 'Design review prep', '2026-10-21', '13:00', '14:15'),
  mockTimed('work', 'design-review', 'Design review', '2026-10-21', '14:00', '15:30'),
  mockTimed('family', 'flight-ams', 'Flight TLL to AMS', '2026-10-24', '06:10', '08:20'),
  mockAllDay('family', 'amsterdam-trip', 'Amsterdam trip', '2026-10-24', '2026-10-26'),
  mockAllDay('home', 'payday', 'Payday', '2026-10-25'),
  mockTimed('work', 'one-on-one', '1:1 with Marta', '2026-10-26', '11:00', '11:30'),
  mockAllDay('home', 'recycling', 'Recycling pickup', '2026-10-27'),
  mockTimed('running-club', 'yoga', 'Yoga', '2026-10-27', '07:15', '08:15'),
  mockAllDay('holidays', 'halloween', 'Halloween', '2026-10-31'),
  mockAllDay('holidays', 'all-souls', "All Souls' Day", '2026-11-02'),
  mockTimed('work', 'sprint-planning', 'Sprint planning', '2026-11-02', '09:30', '10:30'),
  mockTimed('work', 'one-on-one', '1:1 with Marta', '2026-11-02', '11:00', '11:30'),
  mockTimed('running-club', 'yoga', 'Yoga', '2026-11-03', '07:15', '08:15'),
  mockAllDay('birthdays', 'ilona', "Ilona's birthday", '2026-11-04'),
];

/**
 * The year-end edge of the mockup set (§6.7, board F2), IFC December 2026 to
 * IFC January 2027, plus a bar from IFC December 27 through Year Day to
 * January 2, 2027 and an event across midnight on Year Day.
 */
export const YEAR_END_2026: readonly EventOccurrence[] = [
  mockTimed('work', 'sprint-planning', 'Sprint planning', '2026-12-28', '09:30', '10:30'),
  mockTimed('work', 'one-on-one', '1:1 with Marta', '2026-12-28', '11:00', '11:30'),
  mockAllDay('family', 'winter-break', 'Winter break', '2026-12-28', '2027-01-03'),
  allDay('ski-trip', '2026-12-29', '2027-01-02', 'Ski trip', 'running-club'),
  mockTimed('running-club', 'yoga', 'Yoga', '2026-12-29', '07:15', '08:15'),
  mockTimed('family', 'nye-dinner', "New Year's Eve dinner", '2026-12-31', '19:00', '23:30'),
  timed('countdown', '2026-12-31T23:00', '2027-01-01T00:30', 'Countdown', 'family'),
  mockAllDay('holidays', 'new-year', "New Year's Day", '2027-01-01'),
  mockAllDay('home', 'rent', 'Rent', '2027-01-01'),
  mockTimed('work', 'one-on-one', '1:1 with Marta', '2027-01-04', '11:00', '11:30'),
];

/**
 * IFC Leap Day 2024 (Gregorian June 17) and its neighbours: a bar from IFC
 * June 27 (June 15) through Leap Day to Sol 2 (June 19), a dot on Leap Day, a
 * 23-hour event from Leap Day into Sol 1 and a dot on June 28.
 */
export const LEAP_DAY_2024: readonly EventOccurrence[] = [
  allDay('midsummer', '2024-06-15', '2024-06-19', 'Midsummer trip', 'family'),
  timed('leap-party', '2024-06-17T10:00', '2024-06-17T11:00', 'Leap Day party'),
  timed('night-hike', '2024-06-17T20:00', '2024-06-18T19:00', 'Night hike', 'running-club'),
  timed('june-28', '2024-06-16T09:00', '2024-06-16T09:30', 'Standup', 'work'),
  allDay('sol-1', '2024-06-18', '2024-06-18', 'Sol begins', 'holidays'),
];

/**
 * Positivist 2024 (leap): Bichat 27 and 28 are December 28 and 29, the
 * Festival of All the Dead December 30, the Festival of Holy Women December 31.
 */
export const POSITIVIST_YEAR_END_2024: readonly EventOccurrence[] = [
  allDay('festivals', '2024-12-28', '2024-12-31', 'Festival week', 'family'),
  timed('all-the-dead', '2024-12-30T18:00', '2024-12-30T19:00', 'Remembrance'),
  timed('holy-women', '2024-12-31T12:00', '2024-12-31T14:00', 'Lunch', 'work'),
  allDay('new-year', '2024-12-31', '2025-01-01', 'New Year', 'holidays'),
  timed('bichat-1', '2024-12-02T09:00', '2024-12-02T10:00', 'Bichat 1', 'work'),
];

/**
 * The 10-way overlap of §5.5 (board K2 uses it): ten meetings starting at
 * 14:00 on Wednesday, October 21, 2026, lasting 30 to 120 minutes.
 */
export const TEN_WAY_OVERLAP: readonly EventOccurrence[] = Array.from({ length: 10 }, (_, i) => {
  const end = 14 * 60 + 30 + i * 10;
  const clock = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  return timed(`overlap-${String(i + 1).padStart(2, '0')}`, '2026-10-21T14:00', `2026-10-21T${clock}`, `Meeting ${i + 1}`, i % 2 === 0 ? 'work' : 'home');
});

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const CHIP_MINUTES: readonly number[] = [0, 5, 30, 540, 570, 720, 725, 780, 840, 1439];

/** `chipTimes` (§5.5): 00:00, 00:05, 00:30, 09:00, 09:30, 12:00, 12:05, 13:00, 14:00 and 23:59, in both forms. */
export function buildChipTimes(): ChipTimeCase[] {
  return CHIP_MINUTES.flatMap((minute) =>
    [true, false].map((use24Hour) => ({ minute, use24Hour, text: formatChipTime(minute, use24Hour) })),
  );
}

const MONTH_COLUMN_YEARS: readonly (readonly [CalendarSystemId, number])[] = [
  ['ifc', 2026],
  ['ifc', 2027],
  ['ifc', 2028],
  ['positivist', 2026],
  ['positivist', 2028],
];

/** `monthColumns` (§5.5): every month of IFC 2026, 2027 and 2028 and Positivist 2026 and 2028. */
export function buildMonthColumns(): MonthColumnsCase[] {
  return MONTH_COLUMN_YEARS.flatMap(([system, year]) =>
    Array.from({ length: 13 }, (_, i) => ({
      year,
      month: i + 1,
      system,
      weekdays: monthColumnGregorianWeekdays(year, i + 1, system),
    })),
  );
}

type MonthInput = readonly [
  year: number,
  month: number,
  system: CalendarSystemId,
  maxLanes: number | null,
  occurrences: readonly EventOccurrence[],
];

function monthInputs(mockup: readonly EventOccurrence[]): MonthInput[] {
  return [
    // The mockup month (boards A1, A2, K1): the phone's titles density, a short window, a tall one.
    [2026, 11, 'ifc', 2, touching(mockup, '2026-10-08', '2026-11-04')],
    [2026, 11, 'ifc', 4, touching(mockup, '2026-10-08', '2026-11-04')],
    [2026, 11, 'ifc', null, touching(mockup, '2026-10-08', '2026-11-04')],
    // IFC June 2024: a bar from June 27 through Leap Day to Sol 2, into the band and the next month.
    [2024, 6, 'ifc', null, LEAP_DAY_2024],
    // IFC Sol 2024: the same bar and the 23-hour event continue from the band.
    [2024, 7, 'ifc', 3, LEAP_DAY_2024],
    // IFC June 2025: a common year has no band.
    [2025, 6, 'ifc', null, [allDay('june-end', '2025-06-16', '2025-06-18', 'June end')]],
    // IFC December 2026: bars through Year Day to January 2, 2027 (board F2), three lanes.
    [2026, 13, 'ifc', 3, YEAR_END_2026],
    // IFC January 2027: the same bars continue from Year Day.
    [2027, 1, 'ifc', null, YEAR_END_2026],
    // Positivist Bichat 2024: two bands.
    [2024, 13, 'positivist', null, POSITIVIST_YEAR_END_2024],
    // Positivist Bichat 2026: one band (no Festival of Holy Women in a common year).
    [
      2026,
      13,
      'positivist',
      2,
      [allDay('dead', '2026-12-30', '2026-12-31', 'Festival', 'family'), timed('late', '2026-12-31T22:00', '2027-01-01T01:00', 'Late')],
    ],
    // IFC March 2026 (February 26 to March 25): a bar longer than the month, occurrences outside it.
    [
      2026,
      3,
      'ifc',
      2,
      [
        allDay('quarter', '2026-02-01', '2026-04-30', 'Quarter', 'work'),
        allDay('outside-before', '2026-02-20', '2026-02-25', 'Before', 'family'),
        timed('outside-after', '2026-03-26T09:00', '2026-03-26T10:00', 'After'),
        allDay('first-day', '2026-02-26', '2026-02-26', 'First day'),
        allDay('last-day', '2026-03-25', '2026-03-25', 'Last day', 'family'),
        timed('dot-1', '2026-03-04T09:00', '2026-03-04T10:00', 'Dot one'),
        timed('dot-2', '2026-03-04T11:00', '2026-03-04T12:00', 'Dot two', 'family'),
      ],
    ],
    // IFC April 2026 (March 26 to April 22): 23 hours across midnight (two dots), 24 hours (a bar), zero-length,
    // ends at midnight (one dot each), an all-day bar across a row break.
    [
      2026,
      4,
      'ifc',
      null,
      [
        timed('twenty-three', '2026-03-28T20:00', '2026-03-29T19:00', '23 hours'),
        timed('twenty-four', '2026-04-01T10:00', '2026-04-02T10:00', '24 hours', 'work'),
        timed('zero', '2026-04-08T12:00', '2026-04-08T12:00', 'Reminder', 'family'),
        timed('to-midnight', '2026-04-09T22:00', '2026-04-09T24:00', 'Until midnight'),
        timed('to-next-midnight', '2026-04-10T22:00', '2026-04-11T00:00', 'Next midnight'),
        allDay('row-break', '2026-03-31', '2026-04-03', 'Row break', 'family'),
      ],
    ],
    // IFC December 9999: an all-day event on 9999-12-31 (Year Day), the last supported day.
    [
      9999,
      13,
      'ifc',
      null,
      [
        allDay('last-day', '9999-12-31', '9999-12-31', 'Last day'),
        allDay('last-two', '9999-12-30', '9999-12-31', 'Last two days', 'work'),
        timed('last-hour', '9999-12-31T23:00', '9999-12-31T24:00', 'Last hour', 'family'),
      ],
    ],
    // Ties: equal starts, kinds and lengths are broken by title, then key, by code points
    // (U+00C4 after ASCII, U+FF21 before U+1F600, which UTF-16 order would reverse).
    [
      2026,
      5,
      'ifc',
      null,
      [
        allDay('t-b', '2026-04-24', '2026-04-24', 'beta'),
        allDay('t-a2', '2026-04-24', '2026-04-24', 'Alpha'),
        allDay('t-a1', '2026-04-24', '2026-04-24', 'Alpha'),
        allDay('t-umlaut', '2026-04-24', '2026-04-24', 'Älpha'),
        allDay('t-emoji', '2026-04-24', '2026-04-24', '\u{1F600}'),
        allDay('t-fullwidth', '2026-04-24', '2026-04-24', 'Ａ'),
        timed('d-2', '2026-04-24T09:00', '2026-04-24T10:00', 'Same'),
        timed('d-1', '2026-04-24T09:00', '2026-04-24T10:00', 'Same'),
        timed('d-long', '2026-04-24T09:00', '2026-04-24T11:00', 'Same'),
      ],
    ],
    // maxLanes 1: a cell with more than one item shows only "+{n} more".
    [
      2026,
      5,
      'ifc',
      1,
      [
        allDay('wide', '2026-04-27', '2026-04-30', 'Wide'),
        timed('alone', '2026-04-28T09:00', '2026-04-28T10:00', 'Alone'),
        timed('single', '2026-05-05T09:00', '2026-05-05T10:00', 'Single'),
      ],
    ],
  ];
}

/** `monthLayouts` (§5.5). `mockup`: the mockup occurrences of IFC October 2026 (default {@link MOCKUP_IFC_OCTOBER_2026}). */
export function buildMonthLayouts(mockup: readonly EventOccurrence[] = MOCKUP_IFC_OCTOBER_2026): MonthLayoutCase[] {
  return monthInputs(mockup).map(([year, month, system, maxLanes, occurrences]) => ({
    year,
    month,
    system,
    maxLanes,
    occurrences: occurrences.map(occurrenceJson),
    expected: monthLayoutJson(
      layoutThirteenMonthEvents(year, month, occurrences, system, maxLanes === null ? undefined : { maxLanes }),
    ),
  }));
}

type WeekInput = readonly [
  year: number,
  month: number,
  week: 1 | 2 | 3 | 4,
  system: CalendarSystemId,
  maxSlots: number | null,
  occurrences: readonly EventOccurrence[],
];

function weekInputs(mockup: readonly EventOccurrence[]): WeekInput[] {
  return [
    // The mockup week, IFC October 8 to 14 (Gregorian October 15 to 21), wide and at one slot.
    [2026, 11, 2, 'ifc', null, touching(mockup, '2026-10-15', '2026-10-21')],
    [2026, 11, 2, 'ifc', 1, touching(mockup, '2026-10-15', '2026-10-21')],
    // IFC December 2026 week 4: 8 columns with Year Day; bars across the intercalary column, an overnight event.
    [2026, 13, 4, 'ifc', null, YEAR_END_2026],
    // IFC June 2024 week 4: the Leap Day column.
    [2024, 6, 4, 'ifc', null, LEAP_DAY_2024],
    // Positivist Bichat 2024 week 4: 9 columns.
    [2024, 13, 4, 'positivist', null, POSITIVIST_YEAR_END_2024],
    // IFC January 2027 week 1: no intercalary column; bars continuing from Year Day.
    [2027, 1, 1, 'ifc', null, YEAR_END_2026],
    // IFC October 2026 week 3: overnight events, bars from the previous week and into the next, a 30-hour timed bar.
    [
      2026,
      11,
      3,
      'ifc',
      null,
      [
        timed('overnight', '2026-10-22T22:00', '2026-10-23T01:30', 'Overnight'),
        timed('red-eye', '2026-10-27T23:30', '2026-10-28T06:00', 'Red eye', 'family'),
        timed('long-timed', '2026-10-24T10:00', '2026-10-25T16:00', 'Conference', 'work'),
        allDay('into-next', '2026-10-27', '2026-10-30', 'Into next week', 'family'),
        allDay('from-before', '2026-10-19', '2026-10-23', 'From last week'),
        timed('early', '2026-10-23T00:30', '2026-10-23T02:00', 'Early', 'work'),
      ],
    ],
    // The 10-way overlap at 14:00: maxSlots 3 (2 visible slots and one overflow of 8), and unlimited.
    [2026, 11, 2, 'ifc', 3, TEN_WAY_OVERLAP],
    [2026, 11, 2, 'ifc', null, TEN_WAY_OVERLAP],
    // Positivist Descartes 2026 week 2 (the same Gregorian days as IFC October week 2) at two slots.
    [2026, 11, 2, 'positivist', 2, touching(mockup, '2026-10-15', '2026-10-21')],
  ];
}

/** `weekLayouts` (§5.5). `mockup` as in {@link buildMonthLayouts}. */
export function buildWeekLayouts(mockup: readonly EventOccurrence[] = MOCKUP_IFC_OCTOBER_2026): WeekLayoutCase[] {
  return weekInputs(mockup).map(([year, month, week, system, maxSlots, occurrences]) => ({
    year,
    month,
    week,
    system,
    maxSlots,
    occurrences: occurrences.map(occurrenceJson),
    expected: weekLayoutJson(
      layoutThirteenWeekEvents(year, month, week, occurrences, system, maxSlots === null ? undefined : { maxSlots }),
    ),
  }));
}

type DayInput = readonly [
  date: string,
  minDurationMinutes: number,
  maxSlots: number | null,
  occurrences: readonly EventOccurrence[],
];

const D21 = '2026-10-21';

/** A timed occurrence on Wednesday, October 21, 2026. */
function on21(key: string, from: string, to: string, title = key): EventOccurrence {
  return timed(key, `${D21}T${from}`, `${D21}T${to}`, title);
}

const MINIMUM_CASE: readonly EventOccurrence[] = [
  on21('zero', '10:00', '10:00'),
  on21('after', '10:10', '10:30'),
  on21('zero-2', '12:00', '12:00'),
  on21('zero-3', '12:15', '12:15'),
  on21('five', '15:00', '15:05'),
  on21('next', '15:10', '15:40'),
];

function dayInputs(mockup: readonly EventOccurrence[]): DayInput[] {
  return [
    // No overlap.
    [D21, 15, null, [on21('a', '09:00', '10:00'), on21('b', '11:00', '12:00')]],
    // Two overlapping.
    [D21, 15, null, [on21('a', '09:00', '10:30'), on21('b', '10:00', '11:00')]],
    // Three in a chain: A overlaps B, B overlaps C, A not C: 2 slots.
    [D21, 15, null, [on21('a', '09:00', '11:00'), on21('b', '10:00', '12:00'), on21('c', '11:30', '13:00')]],
    // Nested.
    [
      D21,
      15,
      null,
      [on21('outer', '09:00', '13:00'), on21('middle', '10:00', '11:00'), on21('inner', '10:15', '10:45'), on21('later', '11:00', '12:00')],
    ],
    // Equal starts: longer first.
    [D21, 15, null, [on21('short', '10:00', '10:30'), on21('long', '10:00', '11:30'), on21('medium', '10:00', '11:00')]],
    // Touching end to start: no overlap.
    [D21, 15, null, [on21('first', '09:00', '10:00'), on21('second', '10:00', '11:00'), on21('third', '11:00', '11:30')]],
    // Zero-length events and the 15-minute minimum; the same with no minimum and with 30 minutes.
    [D21, 15, null, MINIMUM_CASE],
    [D21, 0, null, MINIMUM_CASE],
    [D21, 30, null, MINIMUM_CASE],
    // Clipping at midnight: from the day before, into the day after, up to 24:00, a zero-length event at 23:55.
    [
      D21,
      15,
      null,
      [
        timed('from-yesterday', '2026-10-20T22:00', '2026-10-21T01:30', 'Overnight'),
        timed('into-tomorrow', '2026-10-21T23:00', '2026-10-22T02:00', 'Late'),
        timed('to-midnight', '2026-10-21T22:30', '2026-10-21T24:00', 'Until midnight'),
        timed('last-call', '2026-10-21T23:55', '2026-10-21T23:55', 'Last call'),
        timed('early', '2026-10-21T00:30', '2026-10-21T01:00', 'Early'),
      ],
    ],
    // Spring forward (Tallinn 2026-03-29, 03:00 to 04:00 skipped): a 24-hour wall-clock axis.
    [
      '2026-03-29',
      15,
      null,
      [
        timed('across-gap', '2026-03-29T01:30', '2026-03-29T04:30', 'Across the gap'),
        timed('after-gap', '2026-03-29T04:00', '2026-03-29T05:00', 'After'),
      ],
    ],
    // Fall back (Tallinn 2026-10-25, 04:00 back to 03:00): 03:50 to 03:10 ends before it starts on the wall
    // clock, so it is drawn with the minimum duration.
    [
      '2026-10-25',
      15,
      null,
      [
        timed('backwards', '2026-10-25T03:50', '2026-10-25T03:10', 'Twenty minutes'),
        timed('repeated-hour', '2026-10-25T03:00', '2026-10-25T03:55', 'Repeated hour'),
        timed('morning', '2026-10-25T09:00', '2026-10-25T10:00', 'Morning'),
      ],
    ],
    // The 10-way overlap with maxSlots 1, 4 and unlimited.
    [D21, 15, 1, TEN_WAY_OVERLAP],
    [D21, 15, 4, TEN_WAY_OVERLAP],
    [D21, 15, null, TEN_WAY_OVERLAP],
    // Two separate clusters where only one overflows.
    [
      D21,
      15,
      2,
      [
        on21('a1', '09:00', '10:00'),
        on21('a2', '09:15', '10:15'),
        on21('a3', '09:30', '09:45'),
        on21('a4', '09:50', '11:00'),
        on21('b1', '14:00', '15:00'),
        on21('b2', '14:30', '15:30'),
      ],
    ],
    // The all-day row: all-day, multi-day, a 24-hour and a 26-hour timed bar; a timed item beside them.
    [
      D21,
      15,
      null,
      [
        allDay('holiday', D21, D21, 'Holiday', 'holidays'),
        allDay('trip', '2026-10-19', '2026-10-23', 'Trip', 'family'),
        timed('day-long', '2026-10-21T00:00', '2026-10-22T00:00', 'Day long', 'work'),
        timed('relay', '2026-10-20T08:00', '2026-10-21T10:00', 'Relay', 'running-club'),
        on21('lunch', '12:00', '13:00', 'Lunch'),
      ],
    ],
    // The mockup's Monday, October 19, 2026, at two slots.
    ['2026-10-19', 15, 2, touching(mockup, '2026-10-19', '2026-10-19')],
  ];
}

/** `dayLayouts` (§5.5). `mockup` as in {@link buildMonthLayouts}. */
export function buildDayLayouts(mockup: readonly EventOccurrence[] = MOCKUP_IFC_OCTOBER_2026): DayLayoutCase[] {
  return dayInputs(mockup).map(([date, minDurationMinutes, maxSlots, occurrences]) => {
    const layout = layoutDayEvents(
      dateFromJson(date),
      occurrences,
      maxSlots === null ? { minDurationMinutes } : { minDurationMinutes, maxSlots },
    );
    return {
      date,
      occurrences: occurrences.map(occurrenceJson),
      minDurationMinutes,
      maxSlots,
      expected: { allDay: [...layout.allDay], timed: plain(layout.timed), overflow: plain(layout.overflow) },
    };
  });
}

type AgendaInput = readonly [
  from: string,
  to: string,
  system: CalendarSystemId,
  includeEmptyDays: boolean,
  occurrences: readonly EventOccurrence[],
];

function agendaInputs(mockup: readonly EventOccurrence[]): AgendaInput[] {
  return [
    // Multi-day parts: a timed event over three days, an all-day event over three days.
    [
      '2026-10-19',
      '2026-10-21',
      'ifc',
      false,
      [
        timed('retreat', '2026-10-19T22:00', '2026-10-21T08:00', 'Retreat', 'work'),
        allDay('visit', '2026-10-19', '2026-10-21', 'Visit', 'family'),
        timed('call', '2026-10-20T09:00', '2026-10-20T09:30', 'Call'),
      ],
    ],
    // A 3-day all-day event crossing Year Day (IFC December 28, Year Day, January 1).
    [
      '2026-12-29',
      '2027-01-02',
      'ifc',
      false,
      [allDay('holiday', '2026-12-30', '2027-01-01', 'Holiday', 'family'), timed('dinner', '2026-12-31T19:00', '2026-12-31T23:30', 'Dinner')],
    ],
    // Ordering: all-day items and middle parts first (order key), then by start minute, then the order key.
    [
      D21,
      D21,
      'ifc',
      false,
      [
        on21('nine-short', '09:00', '09:30', 'Same start'),
        on21('nine-long', '09:00', '10:30', 'Same start'),
        timed('ends-today', '2026-10-20T20:00', '2026-10-21T02:00', 'Night shift', 'work'),
        timed('middle', '2026-10-20T12:00', '2026-10-22T12:00', 'Middle part', 'work'),
        allDay('all-day-b', D21, D21, 'Bravo', 'family'),
        allDay('all-day-a', D21, D21, 'Alpha', 'family'),
        allDay('started-earlier', '2026-10-20', D21, 'Two days', 'holidays'),
        on21('zero', '08:00', '08:00', 'Reminder'),
        timed('starts-tonight', '2026-10-21T23:00', '2026-10-22T01:00', 'Late'),
      ],
    ],
    // Empty days.
    [
      '2026-10-19',
      '2026-10-23',
      'ifc',
      true,
      [timed('mon', '2026-10-19T09:00', '2026-10-19T10:00', 'Monday'), allDay('thu', '2026-10-22', '2026-10-22', 'Thursday')],
    ],
    // Positivist festivals (December 30 and 31, 2024) and an occurrence across the window's start.
    [
      '2024-12-29',
      '2025-01-01',
      'positivist',
      true,
      [allDay('week', '2024-12-26', '2024-12-30', 'Festival week', 'family'), timed('lunch', '2024-12-31T12:00', '2024-12-31T14:00', 'Lunch', 'work')],
    ],
    // The mockup week, IFC October 12 to 18 (Gregorian October 19 to 25).
    ['2026-10-19', '2026-10-25', 'ifc', false, touching(mockup, '2026-10-19', '2026-10-25')],
    // Window clipping: occurrences across the whole window keep their own day numbers.
    [
      '2026-10-20',
      '2026-10-21',
      'ifc',
      false,
      [allDay('long', '2026-10-15', '2026-10-30', 'Long'), timed('long-timed', '2026-10-18T10:00', '2026-10-25T10:00', 'Long timed', 'work')],
    ],
    // IFC Leap Day 2024 with empty days around it.
    ['2024-06-14', '2024-06-19', 'ifc', true, LEAP_DAY_2024],
  ];
}

/** `agendas` (§5.5). `mockup` as in {@link buildMonthLayouts}. */
export function buildAgendas(mockup: readonly EventOccurrence[] = MOCKUP_IFC_OCTOBER_2026): AgendaCase[] {
  return agendaInputs(mockup).map(([from, to, system, includeEmptyDays, occurrences]) => ({
    from,
    to,
    system,
    includeEmptyDays,
    occurrences: occurrences.map(occurrenceJson),
    expected: agendaJson(agenda(occurrences, dateFromJson(from), dateFromJson(to), system, { includeEmptyDays })),
  }));
}

/** Leap year 2024: February 29, IFC Leap Day (June 17) with five calendars, day 366, events across both year ends. */
export const LEAP_YEAR_2024: readonly EventOccurrence[] = [
  allDay('new-year-trip', '2023-12-30', '2024-01-02', 'New Year trip', 'family'),
  allDay('feb-29', '2024-02-29', '2024-02-29', 'Leap day', 'holidays'),
  timed('feb-29-call', '2024-02-29T09:00', '2024-02-29T10:00', 'Call', 'work'),
  allDay('ifc-leap-day', '2024-06-17', '2024-06-17', 'IFC Leap Day', 'birthdays'),
  timed('busy-1', '2024-06-17T09:00', '2024-06-17T10:00', 'Standup', 'work'),
  timed('busy-2', '2024-06-17T12:00', '2024-06-17T13:00', 'Lunch', 'home'),
  timed('busy-3', '2024-06-17T18:00', '2024-06-17T19:00', 'Run', 'running-club'),
  timed('busy-4', '2024-06-17T20:00', '2024-06-17T21:00', 'Dinner', 'family'),
  timed('busy-5', '2024-06-17T21:00', '2024-06-17T22:00', 'Call home', 'home'),
  timed('night', '2024-12-31T22:00', '2025-01-01T02:00', 'Party', 'family'),
  allDay('day-366', '2024-12-31', '2024-12-31', 'Year Day', 'holidays'),
];

type YearMarksInput = readonly [year: number, maxCalendars: number, occurrences: readonly EventOccurrence[]];

function yearMarksInputs(mockup: readonly EventOccurrence[]): YearMarksInput[] {
  return [
    // 2026: the mockup month with a fourth calendar on October 19, and the Winter break across the year end.
    [
      2026,
      3,
      [
        ...touching(mockup, '2026-10-08', '2026-11-04'),
        allDay('relay', '2026-10-19', '2026-10-19', 'Club relay', 'running-club'),
        ...YEAR_END_2026,
      ],
    ],
    // 2024 (leap) with three, one and five calendars per day.
    [2024, 3, LEAP_YEAR_2024],
    [2024, 1, LEAP_YEAR_2024],
    [2024, 5, LEAP_YEAR_2024],
  ];
}

/** `yearMarks` (§5.5). `mockup` as in {@link buildMonthLayouts}. */
export function buildYearMarks(mockup: readonly EventOccurrence[] = MOCKUP_IFC_OCTOBER_2026): YearMarksCase[] {
  return yearMarksInputs(mockup).map(([year, maxCalendars, occurrences]) => ({
    year,
    maxCalendars,
    occurrences: occurrences.map(occurrenceJson),
    expected: yearMarksJson(yearEventMarks(year, occurrences, { maxCalendars })),
  }));
}

/**
 * The C5 sections in publication order (§6.0), each with its builder. Task C6
 * calls these to write `fixtures/events.json`. The builders that use the
 * mockup data set take its IFC October 2026 occurrences as an optional
 * argument (default {@link MOCKUP_IFC_OCTOBER_2026}).
 */
export const C5_SECTIONS = {
  chipTimes: buildChipTimes,
  monthColumns: buildMonthColumns,
  monthLayouts: buildMonthLayouts,
  weekLayouts: buildWeekLayouts,
  dayLayouts: buildDayLayouts,
  agendas: buildAgendas,
  yearMarks: buildYearMarks,
} as const;
