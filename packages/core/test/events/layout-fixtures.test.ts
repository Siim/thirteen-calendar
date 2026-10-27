/**
 * The C5 sections of fixtures/events.json (docs/EVENTS.md §5.5), built by
 * scripts/layout-fixtures.ts for task C6 to write: deterministic, exact counts,
 * documented field names, the cases §5.5 lists, and a replay that decodes only
 * the JSON (as every port's parity test does) and reproduces each expected
 * value. Also checks the hand-expanded mockup month against the §6.7 rules.
 */
import { describe, expect, it } from 'vitest';
import {
  C5_SECTIONS,
  MOCKUP_IFC_OCTOBER_2026,
  agendaJson,
  monthLayoutJson,
  occurrenceFromJson,
  weekLayoutJson,
  yearMarksJson,
} from '../../scripts/layout-fixtures.ts';
import { diffMinutesLocal } from '../../src/events/index.ts';
import {
  agenda,
  formatChipTime,
  layoutDayEvents,
  layoutThirteenMonthEvents,
  layoutThirteenWeekEvents,
  monthColumnGregorianWeekdays,
  yearEventMarks,
} from '../../src/events/layout.ts';
import {
  addGregorianDays,
  diffGregorianDays,
  gregorianWeekday,
  parseISODate,
  toISODate,
  toThirteen,
} from '../../src/index.ts';

const sections = Object.fromEntries(Object.entries(C5_SECTIONS).map(([name, build]) => [name, build()])) as {
  [K in keyof typeof C5_SECTIONS]: ReturnType<(typeof C5_SECTIONS)[K]>;
};
/** Each section as a port reads it: through JSON text. */
const json = JSON.parse(JSON.stringify(sections)) as typeof sections;
const keys = (value: object) => Object.keys(value);

describe('C5 fixture sections', () => {
  it('are listed in publication order (§6.0)', () => {
    expect(keys(C5_SECTIONS)).toEqual(['chipTimes', 'monthColumns', 'monthLayouts', 'weekLayouts', 'dayLayouts', 'agendas', 'yearMarks']);
  });

  it('are deterministic and plain JSON', () => {
    for (const [name, build] of Object.entries(C5_SECTIONS)) {
      expect(JSON.stringify(build()), name).toBe(JSON.stringify(sections[name as keyof typeof sections]));
    }
    expect(json).toEqual(sections);
  });

  it('have exact case counts (C6 writes them to `counts`)', () => {
    expect(Object.fromEntries(Object.entries(sections).map(([name, cases]) => [name, cases.length]))).toEqual({
      chipTimes: 20,
      monthColumns: 65,
      monthLayouts: 15,
      weekLayouts: 10,
      dayLayouts: 18,
      agendas: 8,
      yearMarks: 4,
    });
  });

  it('stay small enough for the 600 kB budget of events.json (one compact line per case)', () => {
    const bytes = Object.values(sections).reduce(
      (sum, cases) => sum + cases.reduce((s: number, c: unknown) => s + Buffer.byteLength(JSON.stringify(c)) + 6, 0),
      0,
    );
    expect(bytes).toBeLessThan(160 * 1024);
  });

  it('use the documented field names in order', () => {
    const occurrenceKeys = ['key', 'calendarId', 'title', 'allDay', 'start', 'end'];
    const itemKeys = ['key', 'style', 'startColumn', 'endColumn', 'lane', 'continuesBefore', 'continuesAfter'];
    const timedKeys = ['key', 'column', 'startMinute', 'endMinute', 'clippedStart', 'clippedEnd', 'slot', 'slotCount', 'hidden'];
    const overflowKeys = ['column', 'slot', 'slotCount', 'startMinute', 'endMinute', 'keys'];
    const checkOccurrences = (list: readonly object[]) => list.forEach((o) => expect(keys(o)).toEqual(occurrenceKeys));
    const checkTimeline = (layout: { timed: readonly object[]; overflow: readonly object[] }) => {
      layout.timed.forEach((t) => expect(keys(t)).toEqual(timedKeys));
      layout.overflow.forEach((o) => expect(keys(o)).toEqual(overflowKeys));
    };

    for (const c of sections.chipTimes) expect(keys(c)).toEqual(['minute', 'use24Hour', 'text']);
    for (const c of sections.monthColumns) expect(keys(c)).toEqual(['year', 'month', 'system', 'weekdays']);
    for (const c of sections.monthLayouts) {
      expect(keys(c)).toEqual(['year', 'month', 'system', 'maxLanes', 'occurrences', 'expected']);
      checkOccurrences(c.occurrences);
      expect(keys(c.expected)).toEqual(['year', 'month', 'system', 'columnGregorianWeekdays', 'weeks', 'intercalary']);
      for (const row of c.expected.weeks) {
        expect(keys(row)).toEqual(['week', 'items', 'visibleLanes', 'hidden']);
        row.items.forEach((i) => expect(keys(i)).toEqual(itemKeys));
      }
      for (const band of c.expected.intercalary) {
        expect(keys(band)).toEqual(['id', 'gregorian', 'items', 'visibleLanes', 'hidden']);
        band.items.forEach((i) => expect(keys(i)).toEqual(itemKeys));
      }
    }
    for (const c of sections.weekLayouts) {
      expect(keys(c)).toEqual(['year', 'month', 'week', 'system', 'maxSlots', 'occurrences', 'expected']);
      checkOccurrences(c.occurrences);
      expect(keys(c.expected)).toEqual(['columns', 'allDay', 'timed', 'overflow']);
      c.expected.columns.forEach((column) => expect(keys(column)).toEqual(['kind', 'gregorian', 'thirteen']));
      c.expected.allDay.forEach((i) => expect(keys(i)).toEqual(itemKeys));
      checkTimeline(c.expected);
    }
    for (const c of sections.dayLayouts) {
      expect(keys(c)).toEqual(['date', 'occurrences', 'minDurationMinutes', 'maxSlots', 'expected']);
      checkOccurrences(c.occurrences);
      expect(keys(c.expected)).toEqual(['allDay', 'timed', 'overflow']);
      checkTimeline(c.expected);
    }
    for (const c of sections.agendas) {
      expect(keys(c)).toEqual(['from', 'to', 'system', 'includeEmptyDays', 'occurrences', 'expected']);
      checkOccurrences(c.occurrences);
      for (const day of c.expected) {
        expect(keys(day)).toEqual(['gregorian', 'thirteen', 'items']);
        day.items.forEach((i) => expect(keys(i)).toEqual(['key', 'part', 'dayIndex', 'dayCount', 'startMinute', 'endMinute']));
      }
    }
    for (const c of sections.yearMarks) {
      expect(keys(c)).toEqual(['year', 'maxCalendars', 'occurrences', 'expected']);
      checkOccurrences(c.occurrences);
      c.expected.forEach((m) => expect(keys(m)).toEqual(['dayOfYear', 'gregorian', 'count', 'calendarIds']));
    }
  });

  it('contain no em or en dash', () => {
    expect(JSON.stringify(sections)).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('C5 sections replayed from JSON (the port parity test)', () => {
  it('chipTimes', () => {
    for (const c of json.chipTimes) expect(formatChipTime(c.minute, c.use24Hour)).toBe(c.text);
  });

  it('monthColumns', () => {
    for (const c of json.monthColumns) expect(monthColumnGregorianWeekdays(c.year, c.month, c.system)).toEqual(c.weekdays);
  });

  it('monthLayouts', () => {
    for (const c of json.monthLayouts) {
      const options = c.maxLanes === null ? undefined : { maxLanes: c.maxLanes };
      const layout = layoutThirteenMonthEvents(c.year, c.month, c.occurrences.map(occurrenceFromJson), c.system, options);
      expect(monthLayoutJson(layout)).toEqual(c.expected);
    }
  });

  it('weekLayouts', () => {
    for (const c of json.weekLayouts) {
      const options = c.maxSlots === null ? undefined : { maxSlots: c.maxSlots };
      const layout = layoutThirteenWeekEvents(c.year, c.month, c.week, c.occurrences.map(occurrenceFromJson), c.system, options);
      expect(weekLayoutJson(layout)).toEqual(c.expected);
    }
  });

  it('dayLayouts', () => {
    for (const c of json.dayLayouts) {
      const options = c.maxSlots === null ? { minDurationMinutes: c.minDurationMinutes } : { minDurationMinutes: c.minDurationMinutes, maxSlots: c.maxSlots };
      expect(layoutDayEvents(parseISODate(c.date), c.occurrences.map(occurrenceFromJson), options)).toEqual(c.expected);
    }
  });

  it('agendas', () => {
    for (const c of json.agendas) {
      const days = agenda(c.occurrences.map(occurrenceFromJson), parseISODate(c.from), parseISODate(c.to), c.system, {
        includeEmptyDays: c.includeEmptyDays,
      });
      expect(agendaJson(days)).toEqual(c.expected);
    }
  });

  it('yearMarks', () => {
    for (const c of json.yearMarks) {
      expect(yearMarksJson(yearEventMarks(c.year, c.occurrences.map(occurrenceFromJson), { maxCalendars: c.maxCalendars }))).toEqual(c.expected);
    }
  });
});

describe('C5 sections cover the §5.5 case list', () => {
  it('chipTimes: 00:00, 00:30, 09:00, 09:30, 12:00, 12:05, 13:00, 23:59 in both forms', () => {
    const text = (minute: number, use24Hour: boolean) => json.chipTimes.find((c) => c.minute === minute && c.use24Hour === use24Hour)?.text;
    expect([0, 30, 540, 570, 720, 725, 780, 1439].map((m) => text(m, true))).toEqual([
      '00:00',
      '00:30',
      '09:00',
      '09:30',
      '12:00',
      '12:05',
      '13:00',
      '23:59',
    ]);
    expect([0, 30, 540, 570, 720, 725, 780, 840, 1439].map((m) => text(m, false))).toEqual([
      '12a',
      '12:30a',
      '9a',
      '9:30a',
      '12p',
      '12:05p',
      '1p',
      '2p',
      '11:59p',
    ]);
  });

  it('monthColumns: every month of IFC 2026 to 2028 and Positivist 2026 and 2028', () => {
    const years = new Set(json.monthColumns.map((c) => `${c.system} ${c.year}`));
    expect([...years]).toEqual(['ifc 2026', 'ifc 2027', 'ifc 2028', 'positivist 2026', 'positivist 2028']);
    const october = json.monthColumns.find((c) => c.system === 'ifc' && c.year === 2026 && c.month === 11)!;
    expect(october.weekdays).toEqual([4, 5, 6, 0, 1, 2, 3]);
    const ifc2028 = json.monthColumns.filter((c) => c.system === 'ifc' && c.year === 2028);
    expect(ifc2028[6]!.weekdays).not.toEqual(ifc2028[5]!.weekdays); // Sol after Leap Day
  });

  it('monthLayouts: the mockup month at 2, 4 and unlimited lanes, every band shape, the edges', () => {
    const shapes = json.monthLayouts.map((c) => `${c.system} ${c.year}/${c.month} ${c.maxLanes}`);
    expect(shapes.slice(0, 3)).toEqual(['ifc 2026/11 2', 'ifc 2026/11 4', 'ifc 2026/11 null']);
    expect(shapes).toContain('ifc 2024/6 null');
    expect(shapes).toContain('ifc 2026/13 3');
    expect(shapes).toContain('positivist 2024/13 null');
    expect(shapes).toContain('ifc 9999/13 null');
    const bands = json.monthLayouts.map((c) => c.expected.intercalary.length);
    expect(new Set(bands)).toEqual(new Set([0, 1, 2]));
    const items = json.monthLayouts.flatMap((c) => [...c.expected.weeks.flatMap((w) => w.items), ...c.expected.intercalary.flatMap((b) => b.items)]);
    expect(items.some((i) => i.style === 'dot' && i.continuesAfter)).toBe(true); // a 23-hour event across midnight
    expect(json.monthLayouts.some((c) => c.expected.weeks.some((w) => w.hidden.some((n) => n > 0)))).toBe(true);
    expect(json.monthLayouts.some((c) => c.expected.intercalary.some((b) => b.hidden > 0))).toBe(true);
  });

  it('weekLayouts: 7, 8 and 9 columns, the 10-way overlap at 3 slots (2 visible, an overflow of 8) and unlimited', () => {
    expect(new Set(json.weekLayouts.map((c) => c.expected.columns.length))).toEqual(new Set([7, 8, 9]));
    const tenWay = json.weekLayouts.filter((c) => c.occurrences.length === 10 && c.occurrences.every((o) => o.key.startsWith('overlap-')));
    expect(tenWay.map((c) => c.maxSlots)).toEqual([3, null]);
    expect(tenWay[0]!.expected.timed.filter((t) => !t.hidden)).toHaveLength(2);
    expect(tenWay[0]!.expected.overflow.map((o) => o.keys.length)).toEqual([8]);
    expect(tenWay[1]!.expected.overflow).toEqual([]);
    const timed = json.weekLayouts.flatMap((c) => c.expected.timed);
    expect(timed.some((t) => t.clippedStart) && timed.some((t) => t.clippedEnd)).toBe(true);
  });

  it('dayLayouts: the 10-way overlap at 1, 4 and unlimited slots, minimums 0, 15 and 30, a backwards fall-back event', () => {
    const tenWay = json.dayLayouts.filter((c) => c.occurrences.length === 10 && c.occurrences.every((o) => o.key.startsWith('overlap-')));
    expect(tenWay.map((c) => c.maxSlots)).toEqual([1, 4, null]);
    expect(new Set(json.dayLayouts.map((c) => c.minDurationMinutes))).toEqual(new Set([0, 15, 30]));
    const backwards = json.dayLayouts.flatMap((c) => c.occurrences).filter((o) => o.end < o.start);
    expect(backwards.map((o) => o.key)).toEqual(['backwards']);
  });

  it('agendas: multi-day parts, Year Day, empty days, both systems', () => {
    const items = json.agendas.flatMap((c) => c.expected.flatMap((d) => d.items));
    expect(new Set(items.map((i) => i.part))).toEqual(new Set(['single', 'first', 'middle', 'last']));
    const days = json.agendas.flatMap((c) => c.expected);
    expect(days.some((d) => d.thirteen.kind === 'intercalary' && d.thirteen.id === 'year-day')).toBe(true);
    expect(days.some((d) => d.items.length === 0)).toBe(true);
    expect(new Set(json.agendas.map((c) => c.system))).toEqual(new Set(['ifc', 'positivist']));
  });

  it('yearMarks: 2024 and 2026, with more than three calendars on a day', () => {
    expect(json.yearMarks.map((c) => [c.year, c.maxCalendars])).toEqual([
      [2026, 3],
      [2024, 3],
      [2024, 1],
      [2024, 5],
    ]);
    const full = json.yearMarks[3]!.expected.find((m) => m.gregorian === '2024-06-17')!;
    expect(full.calendarIds.length).toBeGreaterThan(3);
    expect(json.yearMarks[1]!.expected.find((m) => m.gregorian === '2024-06-17')!.calendarIds).toHaveLength(3);
  });
});

describe('the mockup month (§6.7) written out in MOCKUP_IFC_OCTOBER_2026', () => {
  const first = parseISODate('2026-10-08');
  const days = Array.from({ length: 28 }, (_, i) => addGregorianDays(first, i));
  const dates = (uid: string) =>
    MOCKUP_IFC_OCTOBER_2026.filter((o) => o.key.includes(`/${uid}|`)).map((o) => toISODate(o.start.date));
  const where = (predicate: (date: (typeof days)[number]) => boolean) => days.filter(predicate).map(toISODate);
  const ifcDay = (date: (typeof days)[number]) => {
    const t = toThirteen(date);
    return t.kind === 'month' ? t.day : 0;
  };

  it('is IFC October 2026, in date order, with unique keys', () => {
    expect(toThirteen(first)).toEqual({ kind: 'month', system: 'ifc', year: 2026, month: 11, day: 1 });
    const starts = MOCKUP_IFC_OCTOBER_2026.map((o) => toISODate(o.start.date));
    expect(starts).toEqual([...starts].sort());
    expect(new Set(MOCKUP_IFC_OCTOBER_2026.map((o) => o.key)).size).toBe(MOCKUP_IFC_OCTOBER_2026.length);
  });

  it('expands every repeat of the table completely', () => {
    expect(dates('rent')).toEqual(where((d) => ifcDay(d) === 1));
    expect(dates('book-club')).toEqual(where((d) => ifcDay(d) === 12));
    expect(dates('yoga')).toEqual(where((d) => [6, 13, 20, 27].includes(ifcDay(d))));
    expect(dates('recycling')).toEqual(where((d) => [6, 20].includes(ifcDay(d))));
    expect(dates('one-on-one')).toEqual(where((d) => gregorianWeekday(d) === 1));
    expect(dates('sprint-planning')).toEqual(
      where((d) => gregorianWeekday(d) === 1 && diffGregorianDays(d, parseISODate('2026-01-12')) % 14 === 0),
    );
    expect(dates('payday')).toEqual(where((d) => d.day === 25));
  });

  it('has the board occurrences of the table', () => {
    const row = (title: string) =>
      MOCKUP_IFC_OCTOBER_2026.filter((o) => o.title === title).map((o) => [
        toISODate(o.start.date),
        o.allDay ? 'all day' : `${o.start.minute}+${diffMinutesLocal(o.end, o.start)}`,
        o.calendarId,
      ]);
    expect(row('Half marathon')).toEqual([['2026-10-10', '540+180', 'running-club']]);
    expect(row('Team offsite, Pärnu')).toEqual([['2026-10-12', 'all day', 'work']]);
    expect(row('Autumn school break')).toEqual([['2026-10-19', 'all day', 'family']]);
    expect(row('Dentist, Dr. Tamm')).toEqual([['2026-10-19', '940+40', 'home']]);
    expect(row('Book club: Cotsworth')).toEqual([['2026-10-19', '1140+120', 'home']]);
    expect(row('Design review')).toEqual([['2026-10-21', '840+90', 'work']]);
    expect(row('Flight TLL to AMS')).toEqual([['2026-10-24', '370+130', 'family']]);
    expect(row("Ilona's birthday")).toEqual([['2026-11-04', 'all day', 'birthdays']]);
    const lastDay = (title: string) => toISODate(MOCKUP_IFC_OCTOBER_2026.find((o) => o.title === title)!.end.date);
    expect([lastDay('Team offsite, Pärnu'), lastDay('Autumn school break'), lastDay('Amsterdam trip')]).toEqual([
      '2026-10-14',
      '2026-10-25',
      '2026-10-26',
    ]);
  });
});
