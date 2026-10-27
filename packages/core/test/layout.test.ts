import { describe, expect, it } from 'vitest';
import {
  type GregorianDayCell,
  buildGregorianMonth,
  buildThirteenMonth,
  buildThirteenYear,
  daysInGregorianMonth,
  monthAlignment,
  toISODate,
  toThirteen,
  gregorianWeekday,
} from '../src/index.ts';
import { SYSTEMS, g } from './helpers.ts';

describe('buildThirteenYear', () => {
  it.each(SYSTEMS)('%s: 13 months × 4 weeks × 7 days covering every month day once', (system) => {
    for (const year of [2023, 2024, 2026]) {
      const layout = buildThirteenYear(year, system);
      expect(layout.system).toBe(system);
      expect(layout.months).toHaveLength(13);
      const seen = new Set<number>();
      layout.months.forEach((m, mi) => {
        expect(m.month).toBe(mi + 1);
        expect(m.monthInfo.index).toBe(mi + 1);
        expect(m.weeks).toHaveLength(4);
        m.weeks.forEach((week, wi) => {
          expect(week).toHaveLength(7);
          week.forEach((cell, di) => {
            expect(cell.thirteen).toEqual({ kind: 'month', system, year, month: mi + 1, day: wi * 7 + di + 1 });
            expect(cell.thirteenWeekday).toBe(layout.weekdays[di]);
            expect(cell.gregorianWeekday).toBe(gregorianWeekday(cell.gregorian));
            expect(toThirteen(cell.gregorian, system)).toEqual(cell.thirteen);
            expect(cell.isGregorianMonthStart).toBe(cell.gregorian.day === 1);
            seen.add(cell.dayOfYear);
          });
        });
      });
      expect(seen.size).toBe(364);
      expect(seen.size + layout.intercalary.length).toBe(layout.daysInYear);
    }
  });

  it('places IFC intercalary days (Leap Day after June, Year Day after December)', () => {
    const y2024 = buildThirteenYear(2024, 'ifc');
    expect(y2024).toMatchObject({ year: 2024, displayYear: 2024, isLeapYear: true, daysInYear: 366, weekdays: [0, 1, 2, 3, 4, 5, 6] });
    expect(y2024.intercalary.map((i) => [i.id, i.name, toISODate(i.gregorian), i.dayOfYear, i.afterMonth])).toEqual([
      ['leap-day', 'Leap Day', '2024-06-17', 169, 6],
      ['year-day', 'Year Day', '2024-12-31', 366, 13],
    ]);
    const y2026 = buildThirteenYear(2026, 'ifc');
    expect(y2026.intercalary.map((i) => [i.id, toISODate(i.gregorian), i.afterMonth])).toEqual([['year-day', '2026-12-31', 13]]);
    expect(y2026.months[6]!.monthInfo.name).toBe('Sol');
    expect(toISODate(y2026.months[6]!.weeks[0]![0]!.gregorian)).toBe('2026-06-18');
  });

  it('places Positivist intercalary days at the end of the year', () => {
    const y = buildThirteenYear(2024, 'positivist');
    expect(y).toMatchObject({ displayYear: 236, weekdays: [1, 2, 3, 4, 5, 6, 0] });
    expect(y.intercalary.map((i) => [i.id, i.name, toISODate(i.gregorian), i.afterMonth])).toEqual([
      ['year-day', 'Festival of All the Dead', '2024-12-30', 13],
      ['leap-day', 'Festival of Holy Women', '2024-12-31', 13],
    ]);
  });

  it('marks Gregorian month starts (12 per year, none on intercalary days)', () => {
    for (const system of SYSTEMS) {
      const starts = buildThirteenYear(2026, system).months.flatMap((m) => m.weeks.flat().filter((c) => c.isGregorianMonthStart));
      expect(starts.map((c) => c.gregorian.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }
    const oct = buildThirteenMonth(2026, 11, 'ifc'); // IFC October = 2026-10-08 … 2026-11-04
    expect(toISODate(oct.weeks[0]![0]!.gregorian)).toBe('2026-10-08');
    expect(toISODate(oct.weeks[3]![6]!.gregorian)).toBe('2026-11-04');
    const start = oct.weeks.flat().find((c) => c.isGregorianMonthStart)!;
    expect(start.thirteen.day).toBe(25);
    expect(toISODate(start.gregorian)).toBe('2026-11-01');
  });

  it('validates input', () => {
    expect(() => buildThirteenYear(0)).toThrow(RangeError);
    expect(() => buildThirteenYear(2026, 'nope' as never)).toThrow(RangeError);
    expect(() => buildThirteenMonth(2026, 14)).toThrow(RangeError);
  });
});

describe('buildGregorianMonth', () => {
  it('builds a Sunday-first October 2026 with 13-month equivalents', () => {
    const oct = buildGregorianMonth(2026, 10);
    expect(oct.month).toBe(10);
    expect(oct.monthInfo).toEqual({ index: 10, name: 'October', shortName: 'Oct', narrowName: 'O' });
    expect(oct.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(oct.leadingBlanks).toBe(4);
    expect(oct.weeks).toHaveLength(5);
    expect(oct.weeks[0]!.slice(0, 4)).toEqual([null, null, null, null]); // 1 Oct 2026 is a Thursday
    const first = oct.weeks[0]![4]!;
    expect(toISODate(first.gregorian)).toBe('2026-10-01');
    expect(first.thirteen).toEqual({ kind: 'month', system: 'ifc', year: 2026, month: 10, day: 22 }); // IFC September 22
    const nineteenth = oct.weeks.flat().find((c) => c?.gregorian.day === 19)!;
    expect(nineteenth).toMatchObject({ gregorianWeekday: 1, thirteenWeekday: 4, dayOfYear: 292 });
    // IFC October 1 = 8 October 2026
    expect(oct.weeks.flat().filter((c) => c?.isThirteenMonthStart).map((c) => c!.gregorian.day)).toEqual([8]);
  });

  it('supports Monday-first weeks and the Positivist system', () => {
    const feb = buildGregorianMonth(2026, 2, 'positivist', { weekStartsOn: 1 });
    expect(feb.weekdays).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(feb.leadingBlanks).toBe(6);
    expect(feb.system).toBe('positivist');
    expect(feb.weeks[0]!.slice(0, 6)).toEqual([null, null, null, null, null, null]); // 1 Feb 2026 is a Sunday
    expect(feb.weeks[0]![6]!.thirteen).toMatchObject({ system: 'positivist', month: 2, day: 4 });
  });

  it('every grid is rectangular, ordered and complete', () => {
    for (const system of SYSTEMS) {
      for (const year of [2024, 2026]) {
        for (let month = 1; month <= 12; month++) {
          for (const start of [0, 1, 6] as const) {
            const grid = buildGregorianMonth(year, month, system, { weekStartsOn: start });
            expect(grid.leadingBlanks).toBe(grid.weeks[0]!.filter((c) => c === null).length);
            expect(grid.weeks.length).toBeGreaterThanOrEqual(4);
            expect(grid.weeks.length).toBeLessThanOrEqual(6);
            const cells = grid.weeks.flat();
            expect(cells.length % 7).toBe(0);
            grid.weeks.forEach((week) => {
              expect(week).toHaveLength(7);
              week.forEach((cell, i) => cell && expect(cell.gregorianWeekday).toBe(grid.weekdays[i]));
            });
            const days = cells.filter((c): c is GregorianDayCell => c !== null);
            expect(days.map((c) => c.gregorian.day)).toEqual(Array.from({ length: daysInGregorianMonth(year, month) }, (_, i) => i + 1));
            expect(grid.weeks[0]!.some((c) => c !== null)).toBe(true);
            expect(grid.weeks.at(-1)!.some((c) => c !== null)).toBe(true);
          }
        }
      }
    }
  });

  it("defaults weekStartsOn to the system's week start (consumers:F7)", () => {
    expect(buildGregorianMonth(2026, 2).weekStartsOn).toBe(0);
    expect(buildGregorianMonth(2026, 2, 'ifc').weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const pos = buildGregorianMonth(2026, 2, 'positivist');
    expect(pos.weekStartsOn).toBe(1);
    expect(pos.weekdays).toEqual(buildThirteenYear(2026, 'positivist').weekdays);
    expect(buildGregorianMonth(2026, 2, 'positivist', {}).weekStartsOn).toBe(1);
    expect(buildGregorianMonth(2026, 2, 'positivist', { weekStartsOn: undefined }).weekStartsOn).toBe(1);
    expect(buildGregorianMonth(2026, 2, 'positivist', { weekStartsOn: 0 }).weekdays[0]).toBe(0);
  });

  it('flags intercalary days with a null 13-month weekday', () => {
    const dec = buildGregorianMonth(2024, 12, 'positivist');
    const last = dec.weeks.flat().filter((c): c is GregorianDayCell => c !== null).slice(-2);
    expect(last.map((c) => [c.gregorian.day, c.thirteen.kind, c.thirteenWeekday])).toEqual([
      [30, 'intercalary', null],
      [31, 'intercalary', null],
    ]);
    const jun = buildGregorianMonth(2024, 6);
    const leap = jun.weeks.flat().find((c) => c?.gregorian.day === 17)!;
    expect(leap.thirteen).toEqual({ kind: 'intercalary', system: 'ifc', year: 2024, id: 'leap-day' });
    expect(leap.isThirteenMonthStart).toBe(false);
  });

  it('validates input', () => {
    expect(() => buildGregorianMonth(2026, 13)).toThrow(RangeError);
    expect(() => buildGregorianMonth(2026, 1, 'ifc', { weekStartsOn: 7 as never })).toThrow(/weekStartsOn/);
    expect(() => buildGregorianMonth(2026, 1, 'ifc', { weekStartsOn: '1' as never })).toThrow(RangeError);
    expect(() => buildGregorianMonth(2026, 1, 'ifc', null as never)).toThrow(RangeError);
    expect(() => buildGregorianMonth(2026, 1, 'ifc', { weekStart: 1 } as never)).toThrow(/Unknown buildGregorianMonth option "weekStart"/);
    expect(() => buildGregorianMonth(2026, 1, 1 as never)).toThrow(/Unknown calendar system/);
    expect(() => buildGregorianMonth(10000, 1)).toThrow(RangeError);
  });
});

describe('monthAlignment', () => {
  it.each(SYSTEMS)('%s: ranges tile the year with no gaps or overlaps', (system) => {
    for (const year of [1, 1900, 2000, 2023, 2024, 2026, 9999]) {
      const a = monthAlignment(year, system);
      expect(a.thirteenMonths).toHaveLength(13);
      expect(a.gregorianMonths).toHaveLength(12);

      // Gregorian months tile 1…daysInYear.
      let next = 1;
      for (const span of a.gregorianMonths) {
        expect(span.startDayOfYear).toBe(next);
        expect(span.endDayOfYear - span.startDayOfYear + 1).toBe(span.length);
        expect(span.monthInfo.index).toBe(span.month);
        expect(toThirteen({ year, month: span.month, day: 1 }, system)).toEqual(span.start);
        expect(toThirteen({ year, month: span.month, day: span.length }, system)).toEqual(span.end);
        next = span.endDayOfYear + 1;
      }
      expect(next).toBe(a.daysInYear + 1);

      // 13-month months + intercalary days tile 1…daysInYear.
      const pieces = [
        ...a.thirteenMonths.map((s) => [s.startDayOfYear, s.endDayOfYear] as const),
        ...a.intercalary.map((i) => [i.dayOfYear, i.dayOfYear] as const),
      ].sort((x, y) => x[0] - y[0]);
      next = 1;
      for (const [start, end] of pieces) {
        expect(start).toBe(next);
        next = end + 1;
      }
      expect(next).toBe(a.daysInYear + 1);

      a.thirteenMonths.forEach((s, i) => {
        expect(s.month).toBe(i + 1);
        expect(s.monthInfo.index).toBe(i + 1);
        expect(s.length).toBe(28);
        expect(s.endDayOfYear - s.startDayOfYear + 1).toBe(28);
        expect(toThirteen(s.start, system)).toMatchObject({ kind: 'month', month: i + 1, day: 1 });
        expect(toThirteen(s.end, system)).toMatchObject({ kind: 'month', month: i + 1, day: 28 });
      });
    }
  });

  it('IFC 2024 boundaries', () => {
    const a = monthAlignment(2024, 'ifc');
    expect(a).toMatchObject({ year: 2024, displayYear: 2024, isLeapYear: true, daysInYear: 366, system: 'ifc' });
    expect(toISODate(a.thirteenMonths[6]!.start)).toBe('2024-06-18');
    expect(a.thirteenMonths[6]!.startDayOfYear).toBe(170);
    expect(toISODate(a.thirteenMonths[12]!.end)).toBe('2024-12-30');
    expect(a.gregorianMonths[11]!.end).toEqual({ kind: 'intercalary', system: 'ifc', year: 2024, id: 'year-day' });
    expect(a.gregorianMonths[1]!.end).toEqual({ kind: 'month', system: 'ifc', year: 2024, month: 3, day: 4 });
    expect(a.intercalary.map((i) => i.id)).toEqual(['leap-day', 'year-day']);
    expect(toISODate(g('2024-06-17'))).toBe(toISODate(a.intercalary[0]!.gregorian));
  });

  it('matches hand-computed boundaries (consumers:F11)', () => {
    const ifc = monthAlignment(2026, 'ifc');
    // Gregorian February 2026 = days 32…59 = IFC February 4 … March 3.
    expect(ifc.gregorianMonths[1]).toMatchObject({
      month: 2,
      start: { kind: 'month', month: 2, day: 4 },
      end: { kind: 'month', month: 3, day: 3 },
      startDayOfYear: 32,
      endDayOfYear: 59,
      length: 28,
    });
    // SPEC §2 invariants: Sol 1 = 18 June, December 1 = 3 December, December 28 = 30 December.
    expect(ifc.thirteenMonths[6]).toMatchObject({ month: 7, start: g('2026-06-18'), startDayOfYear: 169 });
    expect(ifc.thirteenMonths[12]).toMatchObject({ month: 13, start: g('2026-12-03'), end: g('2026-12-30'), endDayOfYear: 364 });
    const pos = monthAlignment(2024, 'positivist');
    // Gregorian December 2024 = days 336…366 = Frederick 28 … Festival of Holy Women.
    expect(pos.gregorianMonths[11]).toMatchObject({
      start: { kind: 'month', system: 'positivist', month: 12, day: 28 },
      end: { kind: 'intercalary', system: 'positivist', id: 'leap-day' },
      startDayOfYear: 336,
      endDayOfYear: 366,
      length: 31,
    });
    expect(pos.thirteenMonths[6]).toMatchObject({ start: g('2024-06-17'), end: g('2024-07-14') }); // Charlemagne
  });

  it('Positivist 2026 boundaries', () => {
    const a = monthAlignment(2026, 'positivist');
    expect(a.displayYear).toBe(238);
    expect(a.thirteenMonths[10]!.monthInfo.name).toBe('Descartes');
    expect(toISODate(a.thirteenMonths[10]!.start)).toBe('2026-10-08');
    expect(a.intercalary.map((i) => [i.name, i.dayOfYear])).toEqual([['Festival of All the Dead', 365]]);
    expect(() => monthAlignment(0)).toThrow(RangeError);
  });
});
