/**
 * SPEC §2 anchor vectors and invariants — these must hold in TS and Swift.
 */
import { describe, expect, it } from 'vitest';
import {
  type ThirteenDate,
  type Weekday,
  compare,
  createMonthDate,
  thirteenDisplayYear,
  formatThirteen,
  fromThirteen,
  thirteenWeekday,
  toISODate,
  toThirteen,
  gregorianWeekday,
  weekdayName,
} from '../src/index.ts';
import { everyDay, g } from './helpers.ts';

interface Anchor {
  gregorian: string;
  ifc: string;
  ifcMonth?: number;
  ifcWeekday: string | null;
  gregorianWeekday: string;
  positivist: string;
  positivistWeekday?: string | null;
}

/** Verbatim from the SPEC §2 table. */
const ANCHORS: Anchor[] = [
  { gregorian: '2026-10-19', ifc: 'October 12, 2026', ifcMonth: 11, ifcWeekday: 'Thursday', gregorianWeekday: 'Monday', positivist: 'Descartes 12, 238', positivistWeekday: 'Friday' },
  { gregorian: '2026-01-01', ifc: 'January 1, 2026', ifcWeekday: 'Sunday', gregorianWeekday: 'Thursday', positivist: 'Moses 1, 238', positivistWeekday: 'Monday' },
  { gregorian: '2026-01-29', ifc: 'February 1, 2026', ifcWeekday: 'Sunday', gregorianWeekday: 'Thursday', positivist: 'Homer 1, 238' },
  { gregorian: '2026-02-28', ifc: 'March 3, 2026', ifcWeekday: 'Tuesday', gregorianWeekday: 'Saturday', positivist: 'Aristotle 3, 238' },
  { gregorian: '2026-06-18', ifc: 'Sol 1, 2026', ifcWeekday: 'Sunday', gregorianWeekday: 'Thursday', positivist: 'Charlemagne 1, 238' },
  { gregorian: '2026-12-30', ifc: 'December 28, 2026', ifcWeekday: 'Saturday', gregorianWeekday: 'Wednesday', positivist: 'Bichat 28, 238' },
  { gregorian: '2026-12-31', ifc: 'Year Day 2026', ifcWeekday: null, gregorianWeekday: 'Thursday', positivist: 'Festival of All the Dead 238', positivistWeekday: null },
  { gregorian: '2024-06-17', ifc: 'Leap Day 2024', ifcWeekday: null, gregorianWeekday: 'Monday', positivist: 'Charlemagne 1, 236', positivistWeekday: 'Monday' },
  { gregorian: '2024-06-18', ifc: 'Sol 1, 2024', ifcWeekday: 'Sunday', gregorianWeekday: 'Tuesday', positivist: 'Charlemagne 2, 236' },
  { gregorian: '2024-02-29', ifc: 'March 4, 2024', ifcWeekday: 'Wednesday', gregorianWeekday: 'Thursday', positivist: 'Aristotle 4, 236' },
  { gregorian: '2024-12-30', ifc: 'December 28, 2024', ifcWeekday: 'Saturday', gregorianWeekday: 'Monday', positivist: 'Festival of All the Dead 236', positivistWeekday: null },
  { gregorian: '2024-12-31', ifc: 'Year Day 2024', ifcWeekday: null, gregorianWeekday: 'Tuesday', positivist: 'Festival of Holy Women 236', positivistWeekday: null },
  { gregorian: '2023-01-01', ifc: 'January 1, 2023', ifcWeekday: 'Sunday', gregorianWeekday: 'Sunday', positivist: 'Moses 1, 235' },
  { gregorian: '1900-03-01', ifc: 'March 4, 1900', ifcWeekday: 'Wednesday', gregorianWeekday: 'Thursday', positivist: 'Aristotle 4, 112' },
  { gregorian: '2000-06-17', ifc: 'Leap Day 2000', ifcWeekday: null, gregorianWeekday: 'Saturday', positivist: 'Charlemagne 1, 212' },
];

const nameOf = (w: Weekday | null) => (w === null ? null : weekdayName(w));

describe('SPEC §2 anchor vectors', () => {
  it.each(ANCHORS)('$gregorian', (a) => {
    const date = g(a.gregorian);
    expect(weekdayName(gregorianWeekday(date))).toBe(a.gregorianWeekday);

    const ifc = toThirteen(date, 'ifc');
    expect(formatThirteen(ifc)).toBe(a.ifc);
    expect(nameOf(thirteenWeekday(ifc))).toBe(a.ifcWeekday);
    if (a.ifcMonth !== undefined) expect(ifc).toMatchObject({ kind: 'month', month: a.ifcMonth });
    expect(toISODate(fromThirteen(ifc))).toBe(a.gregorian);

    const pos = toThirteen(date, 'positivist');
    expect(formatThirteen(pos)).toBe(a.positivist);
    if (a.positivistWeekday !== undefined) expect(nameOf(thirteenWeekday(pos))).toBe(a.positivistWeekday);
    expect(toISODate(fromThirteen(pos))).toBe(a.gregorian);

    // ThirteenDate.year always stores the Gregorian year.
    expect(ifc.year).toBe(date.year);
    expect(pos.year).toBe(date.year);
    expect(thirteenDisplayYear(pos)).toBe(date.year - 1788);
  });

  it('2026-10-19 in full', () => {
    expect(toThirteen(g('2026-10-19'))).toEqual({ kind: 'month', system: 'ifc', year: 2026, month: 11, day: 12 });
    expect(toThirteen(g('2026-10-19'), 'positivist')).toEqual({
      kind: 'month',
      system: 'positivist',
      year: 2026,
      month: 11,
      day: 12,
    });
    expect(toThirteen(g('2026-12-31'))).toEqual({ kind: 'intercalary', system: 'ifc', year: 2026, id: 'year-day' });
    expect(toThirteen(g('2024-06-17'))).toEqual({ kind: 'intercalary', system: 'ifc', year: 2024, id: 'leap-day' });
    expect(toThirteen(g('2024-12-31'), 'positivist')).toEqual({
      kind: 'intercalary',
      system: 'positivist',
      year: 2024,
      id: 'leap-day',
    });
  });
});

describe('SPEC §2 invariants', () => {
  const years = [1, 4, 100, 400, 1582, 1600, 1700, 1899, 1900, 1999, 2000, 2023, 2024, 2025, 2026, 2100, 2400, 9996, 9999];

  it.each(years)('IFC Sol 1 = 18 June, December 1 = 3 December, Year Day = 31 December (%i)', (year) => {
    expect(toISODate(fromThirteen(createMonthDate(year, 7, 1, 'ifc'))).slice(5)).toBe('06-18');
    expect(toISODate(fromThirteen(createMonthDate(year, 13, 1, 'ifc'))).slice(5)).toBe('12-03');
    const yd: ThirteenDate = { kind: 'intercalary', system: 'ifc', year, id: 'year-day' };
    expect(toISODate(fromThirteen(yd)).slice(5)).toBe('12-31');
    expect(toThirteen({ year, month: 12, day: 31 }, 'ifc')).toEqual(yd);
  });

  it.each(years)('Positivist: All the Dead after Bichat 28; Holy Women = 31 December in leap years (%i)', (year) => {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const dec31 = toThirteen({ year, month: 12, day: 31 }, 'positivist');
    expect(dec31).toEqual({ kind: 'intercalary', system: 'positivist', year, id: leap ? 'leap-day' : 'year-day' });
    expect(toThirteen({ year, month: 6, day: leap ? 17 : 18 }, 'positivist')).toMatchObject({ month: 7, day: 1 });
  });

  it('IFC Leap Day is 17 June in every leap year and absent otherwise', () => {
    for (const year of [4, 400, 1600, 2000, 2024, 9996]) {
      expect(toThirteen({ year, month: 6, day: 17 }, 'ifc')).toEqual({ kind: 'intercalary', system: 'ifc', year, id: 'leap-day' });
    }
    for (const year of [1, 100, 1900, 2023, 2100, 9999]) {
      expect(toThirteen({ year, month: 6, day: 17 }, 'ifc')).toMatchObject({ kind: 'month', month: 6, day: 28 });
    }
  });

  it('in 2023 every IFC fixed weekday equals the real weekday', () => {
    for (const date of everyDay(2023)) {
      const c = compare(date, 'ifc');
      if (c.thirteen.kind === 'intercalary') {
        expect(toISODate(date)).toBe('2023-12-31');
        continue;
      }
      expect(c.thirteenWeekday).toBe(c.gregorianWeekday);
      expect(c.weekdayShift).toBe(0);
    }
  });

  it('IFC: every month starts on Sunday and the 13th is a Friday; Positivist months start on Monday', () => {
    for (let month = 1; month <= 13; month++) {
      expect(thirteenWeekday(createMonthDate(2026, month, 1, 'ifc'))).toBe(0);
      expect(thirteenWeekday(createMonthDate(2026, month, 13, 'ifc'))).toBe(5);
      expect(thirteenWeekday(createMonthDate(2026, month, 28, 'ifc'))).toBe(6);
      expect(thirteenWeekday(createMonthDate(2026, month, 1, 'positivist'))).toBe(1);
      expect(thirteenWeekday(createMonthDate(2026, month, 13, 'positivist'))).toBe(6);
    }
  });
});
