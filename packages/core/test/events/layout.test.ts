/**
 * events/layout.ts: Month lanes and intercalary bands, the Week and Day
 * timelines with overflow, the agenda, Year marks, Month header weekdays and
 * chip times (docs/EVENTS.md §2.3 to §2.8, §5.2, §5.3). The mockup cases are
 * checked against the boards of design/events/mockups.html (A2, K1, F2).
 */
import { describe, expect, it } from 'vitest';
import {
  LEAP_DAY_2024,
  MOCKUP_IFC_OCTOBER_2026,
  POSITIVIST_YEAR_END_2024,
  TEN_WAY_OVERLAP,
  YEAR_END_2026,
} from '../../scripts/layout-fixtures.ts';
import { type EventOccurrence, parseLocalDateTime } from '../../src/events/index.ts';
import {
  type MonthItem,
  type ThirteenMonthEventLayout,
  type TimedItem,
  agenda,
  compareCodePoints,
  formatChipTime,
  layoutDayEvents,
  layoutThirteenMonthEvents,
  layoutThirteenWeekEvents,
  monthColumnGregorianWeekdays,
  yearEventMarks,
} from '../../src/events/layout.ts';
import { gregorianWeekday, monthDays, toISODate } from '../../src/index.ts';
import { g } from '../helpers.ts';

function timed(key: string, start: string, end: string, title = key, calendarId = 'home'): EventOccurrence {
  return { key, calendarId, title, allDay: false, start: parseLocalDateTime(start), end: parseLocalDateTime(end) };
}

function allDay(key: string, first: string, last = first, title = key, calendarId = 'home'): EventOccurrence {
  return {
    key,
    calendarId,
    title,
    allDay: true,
    start: parseLocalDateTime(`${first}T00:00`),
    end: parseLocalDateTime(`${last}T24:00`),
  };
}

const D = '2026-10-21';
const at = (key: string, from: string, to: string) => timed(key, `${D}T${from}`, `${D}T${to}`);

/** `[startColumn, endColumn, lane, style, title]` per item, as the board scripts write them. */
function boardRow(layout: ThirteenMonthEventLayout, week: number, occurrences: readonly EventOccurrence[]) {
  const titles = new Map(occurrences.map((o) => [o.key, o.title]));
  return layout.weeks[week - 1]!.items.map((item) => [item.startColumn, item.endColumn, item.lane, item.style, titles.get(item.key)]);
}

/** Timed items as `key slot/slotCount` (with `hidden` marked). */
const slots = (items: readonly TimedItem[]) =>
  items.map((item) => `${item.key} ${item.slot}/${item.slotCount}${item.hidden ? ' hidden' : ''}`);

describe('formatChipTime', () => {
  it.each([
    [0, '00:00', '12a'],
    [5, '00:05', '12:05a'],
    [30, '00:30', '12:30a'],
    [540, '09:00', '9a'],
    [570, '09:30', '9:30a'],
    [720, '12:00', '12p'],
    [725, '12:05', '12:05p'],
    [780, '13:00', '1p'],
    [840, '14:00', '2p'],
    [1439, '23:59', '11:59p'],
  ])('minute %i is %s and %s', (minute, h24, h12) => {
    expect(formatChipTime(minute, true)).toBe(h24);
    expect(formatChipTime(minute, false)).toBe(h12);
  });

  it.each([-1, 1440, 1.5, Number.NaN, '60' as unknown as number])('rejects minute %s', (minute) => {
    expect(() => formatChipTime(minute, true)).toThrow(RangeError);
  });

  it('rejects a non-boolean use24Hour', () => {
    expect(() => formatChipTime(60, 'yes' as unknown as boolean)).toThrow(RangeError);
  });
});

describe('monthColumnGregorianWeekdays', () => {
  it('gives the §2.4 header line 2 for IFC October 2026 (Thu Fri Sat Sun Mon Tue Wed)', () => {
    expect(monthColumnGregorianWeekdays(2026, 11)).toEqual([4, 5, 6, 0, 1, 2, 3]);
    expect(monthColumnGregorianWeekdays(2026, 11, 'positivist')).toEqual([4, 5, 6, 0, 1, 2, 3]);
  });

  it('holds for every week of every month (no intercalary day inside a month)', () => {
    for (const system of ['ifc', 'positivist'] as const) {
      for (const year of [1, 2024, 2026, 2027, 2028, 2100, 9999]) {
        for (let month = 1; month <= 13; month++) {
          const columns = monthColumnGregorianWeekdays(year, month, system);
          const days = monthDays(year, month, system);
          days.forEach((day, i) => expect(gregorianWeekday(day)).toBe(columns[i % 7]));
        }
      }
    }
  });

  it('shifts by one after IFC Leap Day and not within a Positivist year', () => {
    const june = monthColumnGregorianWeekdays(2028, 6);
    expect(monthColumnGregorianWeekdays(2028, 7)).toEqual(june.map((w) => (w + 1) % 7));
    expect(monthColumnGregorianWeekdays(2028, 7, 'positivist')).toEqual(monthColumnGregorianWeekdays(2028, 6, 'positivist'));
  });

  it('rejects invalid input', () => {
    expect(() => monthColumnGregorianWeekdays(2026, 14)).toThrow(RangeError);
    expect(() => monthColumnGregorianWeekdays(0, 1)).toThrow(RangeError);
    expect(() => monthColumnGregorianWeekdays(2026, 1, 'gregorian' as never)).toThrow(RangeError);
  });
});

describe('compareCodePoints', () => {
  it('orders by Unicode code points, not UTF-16 code units', () => {
    expect(compareCodePoints('Ａ', '\u{1F600}')).toBe(-1);
    expect('Ａ' < '\u{1F600}').toBe(false); // UTF-16 order would put the emoji first
    expect(compareCodePoints('\u{1F600}', 'Ａ')).toBe(1);
    expect(compareCodePoints('\u{1F600}', '\u{1F601}')).toBe(-1);
    expect(compareCodePoints('', '\u{10000}')).toBe(-1);
  });

  it('orders prefixes first and uppercase before lowercase', () => {
    expect(compareCodePoints('Alpha', 'Alpha')).toBe(0);
    expect(compareCodePoints('Al', 'Alpha')).toBe(-1);
    expect(compareCodePoints('Alpha', 'Al')).toBe(1);
    expect(compareCodePoints('Zeta', 'alpha')).toBe(-1);
    expect(compareCodePoints('alpha', 'Älpha')).toBe(-1);
    expect(compareCodePoints('', 'a')).toBe(-1);
  });
});

describe('layoutThirteenMonthEvents: the mockup month (IFC October 2026)', () => {
  const mockup = MOCKUP_IFC_OCTOBER_2026;
  const unlimited = layoutThirteenMonthEvents(2026, 11, mockup);

  it('has the header weekdays, 4 rows and no band', () => {
    expect(unlimited.year).toBe(2026);
    expect(unlimited.month).toBe(11);
    expect(unlimited.system).toBe('ifc');
    expect(unlimited.columnGregorianWeekdays).toEqual([4, 5, 6, 0, 1, 2, 3]);
    expect(unlimited.weeks.map((w) => w.week)).toEqual([1, 2, 3, 4]);
    expect(unlimited.intercalary).toEqual([]);
  });

  it('reproduces board A2 lane by lane', () => {
    expect(boardRow(unlimited, 1, mockup)).toEqual([
      [0, 0, 0, 'bar', 'Rent'],
      [2, 2, 0, 'dot', 'Half marathon'],
      [4, 6, 0, 'bar', 'Team offsite, Pärnu'],
      [4, 4, 1, 'dot', '1:1 with Marta'],
      [5, 5, 1, 'bar', 'Recycling pickup'],
      [5, 5, 2, 'dot', 'Yoga'],
    ]);
    expect(boardRow(unlimited, 2, mockup)).toEqual([
      [0, 0, 0, 'dot', 'Kodak archive call'],
      [1, 1, 0, 'dot', 'Lunch with Jaan'],
      [2, 2, 0, 'dot', 'Long run'],
      [3, 3, 0, 'dot', 'Family brunch'],
      [4, 6, 0, 'bar', 'Autumn school break'],
      [4, 4, 1, 'dot', 'Sprint planning'],
      [4, 4, 2, 'dot', '1:1 with Marta'],
      [4, 4, 3, 'dot', 'Dentist, Dr. Tamm'],
      [4, 4, 4, 'dot', 'Book club: Cotsworth'],
      [5, 5, 1, 'dot', 'Yoga'],
      [6, 6, 1, 'dot', 'Design review prep'],
      [6, 6, 2, 'dot', 'Design review'],
    ]);
    expect(boardRow(unlimited, 3, mockup)).toEqual([
      [0, 3, 0, 'bar', 'Autumn school break'],
      [2, 4, 1, 'bar', 'Amsterdam trip'],
      [2, 2, 2, 'dot', 'Flight TLL to AMS'],
      [3, 3, 2, 'bar', 'Payday'],
      [4, 4, 0, 'dot', '1:1 with Marta'],
      [5, 5, 0, 'bar', 'Recycling pickup'],
      [5, 5, 1, 'dot', 'Yoga'],
    ]);
    expect(boardRow(unlimited, 4, mockup)).toEqual([
      [2, 2, 0, 'bar', 'Halloween'],
      [4, 4, 0, 'bar', "All Souls' Day"],
      [4, 4, 1, 'dot', 'Sprint planning'],
      [4, 4, 2, 'dot', '1:1 with Marta'],
      [5, 5, 0, 'dot', 'Yoga'],
      [6, 6, 0, 'bar', "Ilona's birthday"],
    ]);
  });

  it('marks the school break continuing between rows 2 and 3', () => {
    const find = (week: number) => unlimited.weeks[week - 1]!.items.find((i) => i.key === 'family/school-break|2026-10-19')!;
    expect(find(2)).toMatchObject({ continuesBefore: false, continuesAfter: true });
    expect(find(3)).toMatchObject({ continuesBefore: true, continuesAfter: false });
  });

  it('shows every lane of the row when unlimited', () => {
    expect(unlimited.weeks.map((w) => w.visibleLanes)).toEqual([
      [3, 3, 3, 3, 3, 3, 3],
      [5, 5, 5, 5, 5, 5, 5],
      [3, 3, 3, 3, 3, 3, 3],
      [3, 3, 3, 3, 3, 3, 3],
    ]);
    expect(unlimited.weeks.every((w) => w.hidden.every((n) => n === 0))).toBe(true);
  });

  it('gives "+3 more" on Thursday 12 with 3 lanes (board K1) and nothing hidden with 5 (board A2)', () => {
    const k1 = layoutThirteenMonthEvents(2026, 11, mockup, 'ifc', { maxLanes: 3 }).weeks[1]!;
    expect(k1.visibleLanes).toEqual([3, 3, 3, 3, 2, 3, 3]);
    expect(k1.hidden).toEqual([0, 0, 0, 0, 3, 0, 0]);
    const a2 = layoutThirteenMonthEvents(2026, 11, mockup, 'ifc', { maxLanes: 5 }).weeks[1]!;
    expect(a2.visibleLanes).toEqual([5, 5, 5, 5, 5, 5, 5]);
    expect(a2.hidden).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('counts every item at or past the last lane in the phone titles density (maxLanes 2)', () => {
    const layout = layoutThirteenMonthEvents(2026, 11, mockup, 'ifc', { maxLanes: 2 });
    expect(layout.weeks.map((w) => w.hidden)).toEqual([
      [0, 0, 0, 0, 0, 2, 0],
      [0, 0, 0, 0, 4, 0, 2],
      [0, 0, 2, 2, 0, 0, 0],
      [0, 0, 0, 0, 2, 0, 0],
    ]);
    expect(layout.weeks[1]!.visibleLanes).toEqual([2, 2, 2, 2, 1, 2, 1]);
    // Lanes do not change with maxLanes.
    expect(layout.weeks.map((w) => w.items)).toEqual(unlimited.weeks.map((w) => w.items));
  });

  it('does not depend on the input order', () => {
    const reversed = layoutThirteenMonthEvents(2026, 11, [...mockup].reverse());
    expect(reversed).toEqual(unlimited);
  });
});

describe('layoutThirteenMonthEvents: items', () => {
  it('turns a 23-hour event across midnight into two dots and a 24-hour one into a bar', () => {
    const layout = layoutThirteenMonthEvents(2026, 4, [
      timed('twenty-three', '2026-03-28T20:00', '2026-03-29T19:00'),
      timed('twenty-four', '2026-04-01T10:00', '2026-04-02T10:00'),
    ]);
    const [row1, row2] = layout.weeks;
    expect(row1!.items).toEqual<MonthItem[]>([
      { key: 'twenty-three', style: 'dot', startColumn: 2, endColumn: 2, lane: 0, continuesBefore: false, continuesAfter: true },
      { key: 'twenty-three', style: 'dot', startColumn: 3, endColumn: 3, lane: 0, continuesBefore: true, continuesAfter: false },
      { key: 'twenty-four', style: 'bar', startColumn: 6, endColumn: 6, lane: 0, continuesBefore: false, continuesAfter: true },
    ]);
    expect(row2!.items).toEqual<MonthItem[]>([
      { key: 'twenty-four', style: 'bar', startColumn: 0, endColumn: 0, lane: 0, continuesBefore: true, continuesAfter: false },
    ]);
  });

  it('puts zero-length events and events ending at midnight on one day', () => {
    const layout = layoutThirteenMonthEvents(2026, 4, [
      timed('zero', '2026-04-08T12:00', '2026-04-08T12:00'),
      timed('midnight', '2026-04-09T22:00', '2026-04-09T24:00'),
      timed('next-midnight', '2026-04-10T22:00', '2026-04-11T00:00'),
      timed('zero-at-midnight', '2026-04-12T00:00', '2026-04-12T00:00'),
    ]);
    expect(layout.weeks[1]!.items.map((i) => [i.key, i.startColumn, i.style])).toEqual([['zero', 6, 'dot']]);
    expect(layout.weeks[2]!.items.map((i) => [i.key, i.startColumn, i.continuesAfter])).toEqual([
      ['midnight', 0, false],
      ['next-midnight', 1, false],
      ['zero-at-midnight', 3, false],
    ]);
  });

  it('clips a bar longer than the month to every row and ignores occurrences outside', () => {
    const layout = layoutThirteenMonthEvents(2026, 3, [
      allDay('quarter', '2026-02-01', '2026-04-30'),
      allDay('before', '2026-02-20', '2026-02-25'),
      timed('after', '2026-03-26T09:00', '2026-03-26T10:00'),
    ]);
    for (const row of layout.weeks) {
      expect(row.items).toEqual([
        { key: 'quarter', style: 'bar', startColumn: 0, endColumn: 6, lane: 0, continuesBefore: true, continuesAfter: true },
      ]);
    }
  });

  it('puts bars before dots in a column and dots in time order, whatever their length', () => {
    const layout = layoutThirteenMonthEvents(2026, 11, [
      timed('late-long', '2026-10-19T19:00', '2026-10-19T22:00'),
      timed('early-short', '2026-10-19T08:00', '2026-10-19T08:15'),
      timed('timed-bar', '2026-10-19T10:00', '2026-10-20T12:00'),
      allDay('all-day', '2026-10-19'),
    ]);
    expect(layout.weeks[1]!.items.map((i) => [i.key, i.lane])).toEqual([
      ['all-day', 0],
      ['timed-bar', 1],
      ['early-short', 2],
      ['late-long', 3],
    ]);
  });

  it('breaks ties by title, then key, by code points', () => {
    const layout = layoutThirteenMonthEvents(2026, 5, [
      allDay('t-b', '2026-04-24', '2026-04-24', 'beta'),
      allDay('t-a2', '2026-04-24', '2026-04-24', 'Alpha'),
      allDay('t-a1', '2026-04-24', '2026-04-24', 'Alpha'),
      allDay('t-umlaut', '2026-04-24', '2026-04-24', 'Älpha'),
      allDay('t-emoji', '2026-04-24', '2026-04-24', '\u{1F600}'),
      allDay('t-fullwidth', '2026-04-24', '2026-04-24', 'Ａ'),
      allDay('t-longer', '2026-04-24', '2026-04-25', 'zzz'),
    ]);
    expect(layout.weeks[0]!.items.map((i) => i.key)).toEqual(['t-longer', 't-a1', 't-a2', 't-b', 't-umlaut', 't-fullwidth', 't-emoji']);
  });

  it('takes the lowest lane free in all columns of a bar', () => {
    const layout = layoutThirteenMonthEvents(2026, 11, [
      allDay('a', '2026-10-15', '2026-10-16'),
      allDay('b', '2026-10-17', '2026-10-18'),
      allDay('c', '2026-10-16', '2026-10-17'),
      allDay('d', '2026-10-18', '2026-10-18'),
    ]);
    expect(layout.weeks[1]!.items.map((i) => [i.key, i.lane])).toEqual([
      ['a', 0],
      ['c', 1],
      ['b', 0],
      ['d', 1],
    ]);
  });

  it('hides everything but "+n more" with maxLanes 1 when a column has two items', () => {
    const layout = layoutThirteenMonthEvents(
      2026,
      5,
      [allDay('wide', '2026-04-27', '2026-04-30'), timed('alone', '2026-04-28T09:00', '2026-04-28T10:00')],
      'ifc',
      { maxLanes: 1 },
    );
    expect(layout.weeks[0]!.visibleLanes).toEqual([1, 1, 1, 1, 1, 0, 1]);
    expect(layout.weeks[0]!.hidden).toEqual([0, 0, 0, 0, 0, 2, 0]);
  });
});

describe('layoutThirteenMonthEvents: intercalary bands', () => {
  it('draws IFC Leap Day under June 2024, with the bar continuing into the band and Sol', () => {
    const june = layoutThirteenMonthEvents(2024, 6, LEAP_DAY_2024);
    expect(june.intercalary).toHaveLength(1);
    const band = june.intercalary[0]!;
    expect(band.id).toBe('leap-day');
    expect(toISODate(band.gregorian)).toBe('2024-06-17');
    expect(band.items.map((i) => [i.key, i.style, i.lane, i.startColumn, i.endColumn, i.continuesBefore, i.continuesAfter])).toEqual([
      ['midsummer', 'bar', 0, 0, 0, true, true],
      ['leap-party', 'dot', 1, 0, 0, false, false],
      ['night-hike', 'dot', 2, 0, 0, false, true],
    ]);
    expect([band.visibleLanes, band.hidden]).toEqual([3, 0]);
    const row4 = june.weeks[3]!.items.find((i) => i.key === 'midsummer')!;
    expect(row4).toMatchObject({ startColumn: 5, endColumn: 6, continuesBefore: false, continuesAfter: true });

    const sol = layoutThirteenMonthEvents(2024, 7, LEAP_DAY_2024);
    expect(sol.intercalary).toEqual([]);
    expect(sol.weeks[0]!.items.map((i) => [i.key, i.startColumn, i.endColumn, i.continuesBefore])).toEqual([
      ['midsummer', 0, 1, true],
      ['sol-1', 0, 0, false],
      ['night-hike', 0, 0, true],
    ]);
  });

  it('has no band in a common year', () => {
    expect(layoutThirteenMonthEvents(2025, 6, []).intercalary).toEqual([]);
    expect(layoutThirteenMonthEvents(2026, 13, []).intercalary.map((b) => b.id)).toEqual(['year-day']);
  });

  it('draws Year Day under IFC December 2026 with "+2 more" at 3 lanes (board F2)', () => {
    const december = layoutThirteenMonthEvents(2026, 13, YEAR_END_2026, 'ifc', { maxLanes: 3 });
    const band = december.intercalary[0]!;
    expect(band.id).toBe('year-day');
    expect(toISODate(band.gregorian)).toBe('2026-12-31');
    expect(band.items.map((i) => [i.key, i.lane, i.continuesBefore, i.continuesAfter])).toEqual([
      ['family/winter-break|2026-12-28', 0, true, true],
      ['ski-trip', 1, true, true],
      ['family/nye-dinner|2026-12-31T19:00', 2, false, false],
      ['countdown', 3, false, true],
    ]);
    expect([band.visibleLanes, band.hidden]).toEqual([2, 2]);
    const january = layoutThirteenMonthEvents(2027, 1, YEAR_END_2026);
    expect(january.weeks[0]!.items.slice(0, 2).map((i) => [i.key, i.startColumn, i.endColumn, i.continuesBefore])).toEqual([
      ['family/winter-break|2026-12-28', 0, 2, true],
      ['ski-trip', 0, 1, true],
    ]);
  });

  it('draws both Positivist festivals after Bichat 2024, in order', () => {
    const bichat = layoutThirteenMonthEvents(2024, 13, POSITIVIST_YEAR_END_2024, 'positivist');
    expect(bichat.columnGregorianWeekdays).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(bichat.intercalary.map((b) => [b.id, toISODate(b.gregorian), b.items.map((i) => i.key)])).toEqual([
      ['year-day', '2024-12-30', ['festivals', 'all-the-dead']],
      ['leap-day', '2024-12-31', ['festivals', 'new-year', 'holy-women']],
    ]);
    expect(bichat.intercalary[0]!.items[0]).toMatchObject({ continuesBefore: true, continuesAfter: true });
    expect(bichat.intercalary[1]!.items[0]).toMatchObject({ continuesBefore: true, continuesAfter: false });
    expect(bichat.intercalary[1]!.items[1]).toMatchObject({ continuesBefore: false, continuesAfter: true });
  });

  it('reaches 9999-12-31', () => {
    const layout = layoutThirteenMonthEvents(9999, 13, [allDay('last', '9999-12-31'), timed('hour', '9999-12-31T23:00', '9999-12-31T24:00')]);
    expect(layout.intercalary[0]!.items.map((i) => [i.key, i.style])).toEqual([
      ['last', 'bar'],
      ['hour', 'dot'],
    ]);
  });
});

describe('layoutThirteenMonthEvents: input', () => {
  const one = [allDay('a', '2026-10-19')];

  it('rejects invalid year, month, system and options', () => {
    expect(() => layoutThirteenMonthEvents(2026, 0, one)).toThrow(RangeError);
    expect(() => layoutThirteenMonthEvents(2026, 14, one)).toThrow(RangeError);
    expect(() => layoutThirteenMonthEvents(10000, 1, one)).toThrow(RangeError);
    expect(() => layoutThirteenMonthEvents(2026, 1, one, 'julian' as never)).toThrow(RangeError);
    for (const maxLanes of [0, -1, 1.5, Number.POSITIVE_INFINITY, null]) {
      expect(() => layoutThirteenMonthEvents(2026, 11, one, 'ifc', { maxLanes: maxLanes as number })).toThrow(RangeError);
    }
    expect(() => layoutThirteenMonthEvents(2026, 11, one, 'ifc', { lanes: 2 } as never)).toThrow(RangeError);
    expect(layoutThirteenMonthEvents(2026, 11, one, 'ifc', { maxLanes: undefined }).weeks[1]!.visibleLanes[4]).toBe(1);
  });

  it('rejects invalid occurrences and repeated keys', () => {
    const bad: unknown[] = [
      null,
      { ...one[0], key: 3 },
      { ...one[0], title: undefined },
      { ...one[0], calendarId: null },
      { ...one[0], allDay: 'yes' },
      { ...one[0], start: { date: { year: 2026, month: 2, day: 30 }, minute: 0 } },
      { ...one[0], start: parseLocalDateTime('2026-10-19T24:00') },
      { ...one[0], start: parseLocalDateTime('2026-10-19T09:00') }, // all-day at a time
      { ...one[0], end: parseLocalDateTime('2026-10-19T12:00') }, // all-day ending mid-day
      { ...one[0], start: parseLocalDateTime('2026-10-20T00:00'), end: parseLocalDateTime('2026-10-19T00:00') }, // all-day backwards
    ];
    for (const occurrence of bad) {
      expect(() => layoutThirteenMonthEvents(2026, 11, [occurrence as EventOccurrence])).toThrow(RangeError);
    }
    expect(() => layoutThirteenMonthEvents(2026, 11, 'none' as never)).toThrow(RangeError);
    expect(() => layoutThirteenMonthEvents(2026, 11, [...one, allDay('a', '2026-10-20')])).toThrow(/used twice/);
  });

  it('accepts a timed end before its start (a fall-back night) as zero-length', () => {
    const layout = layoutThirteenMonthEvents(2026, 11, [timed('back', '2026-10-25T03:50', '2026-10-25T03:10')]);
    expect(layout.weeks[2]!.items).toEqual([
      { key: 'back', style: 'dot', startColumn: 3, endColumn: 3, lane: 0, continuesBefore: false, continuesAfter: false },
    ]);
  });

  it('returns fresh data that does not alias the input', () => {
    const input = [allDay('a', '2026-12-31')];
    const first = layoutThirteenMonthEvents(2026, 13, input);
    (first.intercalary[0]!.gregorian as { day: number }).day = 1;
    first.weeks[0]!.visibleLanes[0] = 99;
    expect(layoutThirteenMonthEvents(2026, 13, input)).not.toEqual(first);
    expect(input[0]!.start.date.day).toBe(31);
  });
});

describe('layoutThirteenWeekEvents', () => {
  it('lays out the mockup week (IFC October 8 to 14)', () => {
    const week = layoutThirteenWeekEvents(2026, 11, 2, MOCKUP_IFC_OCTOBER_2026);
    expect(week.columns.map((c) => [c.kind, toISODate(c.gregorian), c.thirteen.kind === 'month' ? c.thirteen.day : c.thirteen.id])).toEqual([
      ['day', '2026-10-15', 8],
      ['day', '2026-10-16', 9],
      ['day', '2026-10-17', 10],
      ['day', '2026-10-18', 11],
      ['day', '2026-10-19', 12],
      ['day', '2026-10-20', 13],
      ['day', '2026-10-21', 14],
    ]);
    expect(week.allDay).toEqual([
      { key: 'family/school-break|2026-10-19', style: 'bar', startColumn: 4, endColumn: 6, lane: 0, continuesBefore: false, continuesAfter: true },
    ]);
    expect(week.timed.filter((t) => t.column === 6).map((t) => [t.key, t.startMinute, t.endMinute, t.slot, t.slotCount])).toEqual([
      ['work/design-review-prep|2026-10-21T13:00', 780, 855, 0, 2],
      ['work/design-review|2026-10-21T14:00', 840, 930, 1, 2],
    ]);
    expect(week.overflow).toEqual([]);
    expect(week.timed).toHaveLength(11);
  });

  it('adds the Year Day column to IFC December week 4 and carries bars across it', () => {
    const week = layoutThirteenWeekEvents(2026, 13, 4, YEAR_END_2026);
    expect(week.columns).toHaveLength(8);
    expect(week.columns[7]).toEqual({
      kind: 'intercalary',
      gregorian: { year: 2026, month: 12, day: 31 },
      thirteen: { kind: 'intercalary', system: 'ifc', year: 2026, id: 'year-day' },
    });
    expect(week.allDay.map((i) => [i.key, i.startColumn, i.endColumn, i.lane, i.continuesAfter])).toEqual([
      ['family/winter-break|2026-12-28', 4, 7, 0, true],
      ['ski-trip', 5, 7, 1, true],
    ]);
    const countdown = week.timed.find((t) => t.key === 'countdown')!;
    expect(countdown).toEqual({
      key: 'countdown',
      column: 7,
      startMinute: 1380,
      endMinute: 1440,
      clippedStart: false,
      clippedEnd: true,
      slot: 1,
      slotCount: 2,
      hidden: false,
    });
  });

  it('adds the Leap Day column to IFC June 2024 week 4 and both festivals to Positivist Bichat', () => {
    expect(layoutThirteenWeekEvents(2024, 6, 4, []).columns.map((c) => c.kind)).toEqual([
      ...Array<'day'>(7).fill('day'),
      'intercalary',
    ]);
    const bichat = layoutThirteenWeekEvents(2024, 13, 4, POSITIVIST_YEAR_END_2024, 'positivist');
    expect(bichat.columns.map((c) => toISODate(c.gregorian))).toEqual([
      '2024-12-23',
      '2024-12-24',
      '2024-12-25',
      '2024-12-26',
      '2024-12-27',
      '2024-12-28',
      '2024-12-29',
      '2024-12-30',
      '2024-12-31',
    ]);
    expect(bichat.allDay.map((i) => [i.key, i.startColumn, i.endColumn])).toEqual([
      ['festivals', 5, 8],
      ['new-year', 8, 8],
    ]);
    expect(bichat.timed.map((t) => [t.key, t.column])).toEqual([
      ['all-the-dead', 7],
      ['holy-women', 8],
    ]);
  });

  it('never adds intercalary columns to weeks 1 to 3', () => {
    for (const week of [1, 2, 3] as const) expect(layoutThirteenWeekEvents(2024, 6, week, []).columns).toHaveLength(7);
    expect(layoutThirteenWeekEvents(2026, 6, 4, []).columns).toHaveLength(7);
  });

  it('clips overnight events to each day', () => {
    const week = layoutThirteenWeekEvents(2026, 11, 3, [timed('overnight', '2026-10-22T22:00', '2026-10-23T01:30')]);
    expect(week.timed.map((t) => [t.column, t.startMinute, t.endMinute, t.clippedStart, t.clippedEnd])).toEqual([
      [0, 1320, 1440, false, true],
      [1, 0, 90, true, false],
    ]);
  });

  it('shows 2 slots and one overflow of 8 for the 10-way overlap with maxSlots 3', () => {
    const week = layoutThirteenWeekEvents(2026, 11, 2, TEN_WAY_OVERLAP, 'ifc', { maxSlots: 3 });
    const visible = week.timed.filter((t) => !t.hidden);
    expect(visible.map((t) => [t.key, t.slot, t.slotCount])).toEqual([
      ['overlap-10', 0, 3],
      ['overlap-09', 1, 3],
    ]);
    expect(week.overflow).toEqual([
      {
        column: 6,
        slot: 2,
        slotCount: 3,
        startMinute: 840,
        endMinute: 940,
        keys: ['overlap-08', 'overlap-07', 'overlap-06', 'overlap-05', 'overlap-04', 'overlap-03', 'overlap-02', 'overlap-01'],
      },
    ]);
    const unlimited = layoutThirteenWeekEvents(2026, 11, 2, TEN_WAY_OVERLAP);
    expect(unlimited.overflow).toEqual([]);
    expect(unlimited.timed.map((t) => t.slotCount)).toEqual(Array(10).fill(10));
  });

  it('rejects an invalid week or options', () => {
    expect(() => layoutThirteenWeekEvents(2026, 11, 5 as never, [])).toThrow(RangeError);
    expect(() => layoutThirteenWeekEvents(2026, 11, 0 as never, [])).toThrow(RangeError);
    expect(() => layoutThirteenWeekEvents(2026, 11, 1, [], 'ifc', { maxSlots: 0 })).toThrow(RangeError);
    expect(() => layoutThirteenWeekEvents(2026, 11, 1, [], 'ifc', { minDurationMinutes: -5 })).toThrow(RangeError);
    expect(() => layoutThirteenWeekEvents(2026, 11, 1, [], 'ifc', { minDurationMinutes: 1441 })).toThrow(RangeError);
    expect(() => layoutThirteenWeekEvents(2026, 11, 1, [], 'ifc', { slots: 3 } as never)).toThrow(RangeError);
  });
});

describe('layoutDayEvents', () => {
  const day = g(D);

  it('keeps separate events in one slot each', () => {
    const { timed: items } = layoutDayEvents(day, [at('a', '09:00', '10:00'), at('b', '11:00', '12:00')]);
    expect(slots(items)).toEqual(['a 0/1', 'b 0/1']);
  });

  it('places a chain in 2 slots (A overlaps B, B overlaps C, A not C)', () => {
    const { timed: items } = layoutDayEvents(day, [at('a', '09:00', '11:00'), at('b', '10:00', '12:00'), at('c', '11:30', '13:00')]);
    expect(slots(items)).toEqual(['a 0/2', 'b 1/2', 'c 0/2']);
  });

  it('places nested events and reuses a freed slot', () => {
    const { timed: items } = layoutDayEvents(day, [
      at('outer', '09:00', '13:00'),
      at('middle', '10:00', '11:00'),
      at('inner', '10:15', '10:45'),
      at('later', '11:00', '12:00'),
    ]);
    expect(slots(items)).toEqual(['outer 0/3', 'middle 1/3', 'inner 2/3', 'later 1/3']);
  });

  it('puts the longer of equal starts first', () => {
    const { timed: items } = layoutDayEvents(day, [at('short', '10:00', '10:30'), at('long', '10:00', '11:30'), at('medium', '10:00', '11:00')]);
    expect(slots(items)).toEqual(['long 0/3', 'medium 1/3', 'short 2/3']);
  });

  it('does not overlap events that touch end to start', () => {
    const { timed: items } = layoutDayEvents(day, [at('first', '09:00', '10:00'), at('second', '10:00', '11:00')]);
    expect(slots(items)).toEqual(['first 0/1', 'second 0/1']);
  });

  it('applies the minimum duration to clusters', () => {
    const occurrences = [at('zero', '10:00', '10:00'), at('after', '10:10', '10:30'), at('zero-2', '12:00', '12:00'), at('zero-3', '12:15', '12:15')];
    expect(slots(layoutDayEvents(day, occurrences).timed)).toEqual(['zero 0/2', 'after 1/2', 'zero-2 0/1', 'zero-3 0/1']);
    expect(slots(layoutDayEvents(day, occurrences, { minDurationMinutes: 0 }).timed)).toEqual(['zero 0/1', 'after 0/1', 'zero-2 0/1', 'zero-3 0/1']);
    expect(slots(layoutDayEvents(day, occurrences, { minDurationMinutes: 30 }).timed)).toEqual(['zero 0/2', 'after 1/2', 'zero-2 0/2', 'zero-3 1/2']);
    expect(layoutDayEvents(day, occurrences).timed[0]).toMatchObject({ startMinute: 600, endMinute: 600 });
  });

  it('clips at midnight', () => {
    const { timed: items } = layoutDayEvents(day, [
      timed('from-yesterday', '2026-10-20T22:00', '2026-10-21T01:30'),
      timed('into-tomorrow', '2026-10-21T23:00', '2026-10-22T02:00'),
      timed('to-midnight', '2026-10-21T22:30', '2026-10-21T24:00'),
    ]);
    expect(items.map((t) => [t.key, t.startMinute, t.endMinute, t.clippedStart, t.clippedEnd])).toEqual([
      ['from-yesterday', 0, 90, true, false],
      ['to-midnight', 1350, 1440, false, false],
      ['into-tomorrow', 1380, 1440, false, true],
    ]);
  });

  it('draws DST days on a 24-hour wall-clock axis', () => {
    const spring = layoutDayEvents(g('2026-03-29'), [timed('across', '2026-03-29T01:30', '2026-03-29T03:30')]);
    expect(spring.timed[0]).toMatchObject({ startMinute: 90, endMinute: 210 });
    const fall = layoutDayEvents(g('2026-10-25'), [
      timed('backwards', '2026-10-25T03:50', '2026-10-25T03:10'),
      timed('repeated', '2026-10-25T03:00', '2026-10-25T03:55'),
    ]);
    expect(fall.timed.map((t) => [t.key, t.startMinute, t.endMinute, t.slot, t.slotCount])).toEqual([
      ['repeated', 180, 235, 0, 2],
      ['backwards', 230, 230, 1, 2],
    ]);
  });

  it('overflows the 10-way overlap with maxSlots 1, 4 and unlimited', () => {
    const one = layoutDayEvents(day, TEN_WAY_OVERLAP, { maxSlots: 1 });
    expect(one.timed.every((t) => t.hidden && t.slotCount === 10)).toBe(true);
    expect(one.overflow).toEqual([
      { column: 0, slot: 0, slotCount: 1, startMinute: 840, endMinute: 960, keys: TEN_WAY_OVERLAP.map((o) => o.key).reverse() },
    ]);
    const four = layoutDayEvents(day, TEN_WAY_OVERLAP, { maxSlots: 4 });
    expect(slots(four.timed).slice(0, 4)).toEqual(['overlap-10 0/4', 'overlap-09 1/4', 'overlap-08 2/4', 'overlap-07 3/10 hidden']);
    expect(four.overflow).toHaveLength(1);
    expect(four.overflow[0]).toMatchObject({ slot: 3, slotCount: 4, startMinute: 840, endMinute: 930 });
    expect(four.overflow[0]!.keys).toHaveLength(7);
    expect(layoutDayEvents(day, TEN_WAY_OVERLAP).overflow).toEqual([]);
  });

  it('overflows only the cluster that does not fit, and leaves fitting clusters unchanged at maxSlots 1', () => {
    const occurrences = [
      at('a1', '09:00', '10:00'),
      at('a2', '09:15', '10:15'),
      at('a3', '09:30', '09:45'),
      at('a4', '09:50', '11:00'),
      at('b1', '14:00', '15:00'),
      at('b2', '14:30', '15:30'),
      at('c', '17:00', '18:00'),
    ];
    const layout = layoutDayEvents(day, occurrences, { maxSlots: 2 });
    expect(slots(layout.timed)).toEqual(['a1 0/2', 'a2 1/3 hidden', 'a3 2/3 hidden', 'a4 2/3 hidden', 'b1 0/2', 'b2 1/2', 'c 0/1']);
    expect(layout.overflow).toEqual([{ column: 0, slot: 1, slotCount: 2, startMinute: 555, endMinute: 660, keys: ['a2', 'a3', 'a4'] }]);
    expect(slots(layoutDayEvents(day, [at('c', '17:00', '18:00')], { maxSlots: 1 }).timed)).toEqual(['c 0/1']);
  });

  it('ends an overflow at the latest effective end, even past midnight', () => {
    const layout = layoutDayEvents(day, [at('x', '23:50', '23:50'), at('y', '23:50', '23:55')], { maxSlots: 1 });
    expect(layout.overflow[0]).toMatchObject({ startMinute: 1430, endMinute: 1445, keys: ['y', 'x'] });
  });

  it('lists bars in the all-day row in order-key order', () => {
    const layout = layoutDayEvents(day, [
      allDay('holiday', D),
      allDay('trip', '2026-10-19', '2026-10-23'),
      timed('day-long', '2026-10-21T00:00', '2026-10-22T00:00'),
      timed('relay', '2026-10-20T08:00', '2026-10-21T10:00'),
      at('lunch', '12:00', '13:00'),
      allDay('tomorrow', '2026-10-22'),
    ]);
    expect(layout.allDay).toEqual(['trip', 'relay', 'holiday', 'day-long']);
    expect(layout.timed.map((t) => t.key)).toEqual(['lunch']);
  });

  it('rejects invalid input', () => {
    expect(() => layoutDayEvents({ year: 2026, month: 2, day: 29 }, [])).toThrow(RangeError);
    expect(() => layoutDayEvents(day, [], { maxSlots: 2.5 })).toThrow(RangeError);
    expect(() => layoutDayEvents(day, [], [] as never)).toThrow(RangeError);
    expect(() => layoutDayEvents(day, [at('a', '09:00', '10:00'), at('a', '11:00', '12:00')])).toThrow(RangeError);
  });
});

describe('agenda', () => {
  it('splits multi-day occurrences into parts with day numbers and times', () => {
    const days = agenda(
      [timed('retreat', '2026-10-19T22:00', '2026-10-21T08:00'), allDay('visit', '2026-10-19', '2026-10-21')],
      g('2026-10-19'),
      g('2026-10-21'),
    );
    expect(days.map((d) => [toISODate(d.gregorian), d.items.map((i) => [i.key, i.part, i.dayIndex, i.dayCount, i.startMinute, i.endMinute])])).toEqual([
      [
        '2026-10-19',
        [
          ['visit', 'first', 1, 3, null, null],
          ['retreat', 'first', 1, 3, 1320, 1440],
        ],
      ],
      [
        '2026-10-20',
        [
          ['visit', 'middle', 2, 3, null, null],
          ['retreat', 'middle', 2, 3, null, null],
        ],
      ],
      [
        '2026-10-21',
        [
          ['visit', 'last', 3, 3, null, null],
          ['retreat', 'last', 3, 3, 0, 480],
        ],
      ],
    ]);
    expect(days[0]!.thirteen).toEqual({ kind: 'month', system: 'ifc', year: 2026, month: 11, day: 12 });
  });

  it('orders all-day items and middle parts first, then by start minute', () => {
    const [only] = agenda(
      [
        at('nine-short', '09:00', '09:30'),
        at('nine-long', '09:00', '10:30'),
        timed('ends-today', '2026-10-20T20:00', '2026-10-21T02:00'),
        timed('middle', '2026-10-20T12:00', '2026-10-22T12:00'),
        allDay('all-day-b', D, D, 'Bravo'),
        allDay('all-day-a', D, D, 'Alpha'),
        allDay('started-earlier', '2026-10-20', D),
        at('zero', '08:00', '08:00'),
      ],
      g(D),
      g(D),
    );
    expect(only!.items.map((i) => i.key)).toEqual([
      'started-earlier',
      'middle',
      'all-day-a',
      'all-day-b',
      'ends-today',
      'zero',
      'nine-long',
      'nine-short',
    ]);
  });

  it('names Year Day and skips or includes empty days', () => {
    const occurrences = [allDay('holiday', '2026-12-30', '2027-01-01')];
    const days = agenda(occurrences, g('2026-12-29'), g('2027-01-02'));
    expect(days.map((d) => toISODate(d.gregorian))).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(days[1]!.thirteen).toEqual({ kind: 'intercalary', system: 'ifc', year: 2026, id: 'year-day' });
    const withEmpty = agenda(occurrences, g('2026-12-29'), g('2027-01-02'), 'positivist', { includeEmptyDays: true });
    expect(withEmpty.map((d) => [toISODate(d.gregorian), d.items.length])).toEqual([
      ['2026-12-29', 0],
      ['2026-12-30', 1],
      ['2026-12-31', 1],
      ['2027-01-01', 1],
      ['2027-01-02', 0],
    ]);
    expect(withEmpty[2]!.thirteen).toEqual({ kind: 'intercalary', system: 'positivist', year: 2026, id: 'year-day' });
  });

  it('keeps the occurrence day numbers when the window clips it', () => {
    const days = agenda([allDay('long', '2026-10-15', '2026-10-30')], g('2026-10-20'), g('2026-10-20'));
    expect(days[0]!.items).toEqual([{ key: 'long', part: 'middle', dayIndex: 6, dayCount: 16, startMinute: null, endMinute: null }]);
    expect(agenda([allDay('long', '2026-10-15', '2026-10-30')], g('2026-11-01'), g('2026-11-05'))).toEqual([]);
  });

  it('rejects invalid input', () => {
    expect(() => agenda([], g('2026-10-21'), g('2026-10-20'))).toThrow(RangeError);
    expect(() => agenda([], g('2026-10-21'), { year: 2026, month: 13, day: 1 })).toThrow(RangeError);
    expect(() => agenda([], g('2026-10-21'), g('2026-10-21'), 'ifc', { includeEmptyDays: 1 as never })).toThrow(RangeError);
    expect(() => agenda([], g('2026-10-21'), g('2026-10-21'), 'other' as never)).toThrow(RangeError);
  });
});

describe('yearEventMarks', () => {
  it('counts occurrences per day and lists their calendars in order-key order', () => {
    const marks = yearEventMarks(2026, [
      ...MOCKUP_IFC_OCTOBER_2026,
      allDay('relay', '2026-10-19', '2026-10-19', 'Club relay', 'running-club'),
    ]);
    const october19 = marks.find((m) => toISODate(m.gregorian) === '2026-10-19')!;
    expect(october19).toEqual({
      dayOfYear: 292,
      gregorian: { year: 2026, month: 10, day: 19 },
      count: 6,
      calendarIds: ['family', 'running-club', 'work'],
    });
    const five = yearEventMarks(2026, [...MOCKUP_IFC_OCTOBER_2026, allDay('relay', '2026-10-19', '2026-10-19', 'Club relay', 'running-club')], {
      maxCalendars: 5,
    });
    expect(five.find((m) => m.dayOfYear === 292)!.calendarIds).toEqual(['family', 'running-club', 'work', 'home']);
    expect(marks.map((m) => m.dayOfYear)).toEqual([...marks.map((m) => m.dayOfYear)].sort((a, b) => a - b));
  });

  it('covers only the given year, including day 366 of a leap year', () => {
    const marks = yearEventMarks(2024, [
      allDay('trip', '2023-12-30', '2024-01-02', 'Trip', 'family'),
      allDay('last', '2024-12-31', '2024-12-31', 'Last', 'holidays'),
      timed('party', '2024-12-31T22:00', '2025-01-01T02:00', 'Party', 'family'),
    ]);
    expect(marks.map((m) => [m.dayOfYear, toISODate(m.gregorian), m.count, m.calendarIds])).toEqual([
      [1, '2024-01-01', 1, ['family']],
      [2, '2024-01-02', 1, ['family']],
      [366, '2024-12-31', 2, ['holidays', 'family']],
    ]);
  });

  it('gives counts only with maxCalendars 0', () => {
    expect(yearEventMarks(2026, [allDay('a', '2026-01-01')], { maxCalendars: 0 })).toEqual([
      { dayOfYear: 1, gregorian: { year: 2026, month: 1, day: 1 }, count: 1, calendarIds: [] },
    ]);
  });

  it('rejects invalid input', () => {
    expect(() => yearEventMarks(0, [])).toThrow(RangeError);
    expect(() => yearEventMarks(2026, [], { maxCalendars: -1 })).toThrow(RangeError);
    expect(() => yearEventMarks(2026, [], { maxCalendars: 1.5 })).toThrow(RangeError);
  });
});
