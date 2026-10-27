import { describe, expect, it } from 'vitest';
import {
  type ThirteenDate,
  NOTABLE_DATES,
  createIntercalaryDate,
  createMonthDate,
  formatGregorian,
  formatNumericYear,
  formatThirteen,
  fromThirteen,
  intercalaryDaysInYear,
  notableDatesInYear,
  ordinal,
  parseISODate,
  parseThirteen,
  toThirteen,
  tryParseISODate,
  tryParseThirteen,
} from '../src/index.ts';
import { SYSTEMS, everyDay, g } from './helpers.ts';

describe('formatThirteen', () => {
  const oct12 = toThirteen(g('2026-10-19'));
  const desc12 = toThirteen(g('2026-10-19'), 'positivist');

  it('long (default)', () => {
    expect(formatThirteen(oct12)).toBe('October 12, 2026');
    expect(formatThirteen(oct12, { includeWeekday: true })).toBe('Thursday, October 12, 2026');
    expect(formatThirteen(oct12, { includeYear: false })).toBe('October 12');
    expect(formatThirteen(desc12)).toBe('Descartes 12, 238');
    expect(formatThirteen(desc12, { includeWeekday: true })).toBe('Friday, Descartes 12, 238');
    expect(formatThirteen(createMonthDate(2026, 7, 1))).toBe('Sol 1, 2026');
    expect(formatThirteen(createMonthDate(2026, 6, 1, 'positivist'))).toBe('Saint Paul 1, 238');
    expect(formatThirteen(createMonthDate(1, 1, 1, 'positivist'))).toBe('Moses 1, -1787');
  });

  it('medium and short', () => {
    expect(formatThirteen(oct12, { style: 'medium' })).toBe('Oct 12, 2026');
    expect(formatThirteen(oct12, { style: 'medium', includeWeekday: true })).toBe('Thu, Oct 12, 2026');
    expect(formatThirteen(oct12, { style: 'short' })).toBe('Oct 12');
    expect(formatThirteen(oct12, { style: 'short', includeYear: true })).toBe('Oct 12, 2026');
    expect(formatThirteen(oct12, { style: 'short', includeWeekday: true })).toBe('Thu, Oct 12');
    expect(formatThirteen(desc12, { style: 'short' })).toBe('Des 12');
    expect(formatThirteen(createMonthDate(2026, 7, 9), { style: 'short' })).toBe('Sol 9');
  });

  it('numeric (ISO-style with an M designator, never an ISO calendar date)', () => {
    expect(formatThirteen(oct12, { style: 'numeric' })).toBe('2026-M11-12');
    expect(formatThirteen(oct12, { style: 'numeric', includeYear: false })).toBe('M11-12');
    expect(formatThirteen(oct12, { style: 'numeric', includeWeekday: true })).toBe('2026-M11-12');
    expect(formatThirteen(desc12, { style: 'numeric' })).toBe('0238-M11-12');
    expect(formatThirteen(createMonthDate(1, 13, 28, 'positivist'), { style: 'numeric' })).toBe('-1787-M13-28');
    expect(formatThirteen(createMonthDate(1788, 1, 1, 'positivist'), { style: 'numeric' })).toBe('0000-M01-01');
    expect(formatThirteen(createMonthDate(1, 1, 1), { style: 'numeric' })).toBe('0001-M01-01');
  });

  it('numeric output can never be read as a Gregorian ISO date (edges:F4, consumers:F3)', () => {
    // Before the fix IFC February 15, 2026 (= Gregorian 2026-02-12) printed "2026-02-15",
    // which parseISODate silently accepted as 15 February.
    expect(formatThirteen(toThirteen(g('2026-02-12')), { style: 'numeric' })).toBe('2026-M02-15');
    for (const system of SYSTEMS) {
      for (const date of everyDay(2024)) {
        const text = formatThirteen(toThirteen(date, system), { style: 'numeric' });
        expect(tryParseISODate(text)).toBeNull();
        expect(text).not.toBe(formatGregorian(date, { style: 'numeric' }));
      }
    }
    expect(() => parseISODate('0238-M11-12')).toThrow(RangeError);
  });

  it('intercalary days', () => {
    const yd = createIntercalaryDate(2026, 'year-day');
    const ld = createIntercalaryDate(2024, 'leap-day');
    expect(formatThirteen(yd)).toBe('Year Day 2026');
    expect(formatThirteen(yd, { includeWeekday: true })).toBe('Year Day 2026');
    expect(formatThirteen(yd, { includeYear: false })).toBe('Year Day');
    expect(formatThirteen(yd, { style: 'medium' })).toBe('Year Day 2026');
    expect(formatThirteen(yd, { style: 'short' })).toBe('Year Day');
    expect(formatThirteen(yd, { style: 'numeric' })).toBe('2026-YD');
    expect(formatThirteen(yd, { style: 'numeric', includeYear: false })).toBe('YD');
    expect(formatThirteen(ld, { style: 'numeric' })).toBe('2024-LD');
    expect(formatThirteen(ld, { style: 'numeric', includeYear: false })).toBe('LD');
    expect(formatThirteen(ld)).toBe('Leap Day 2024');
    const dead = createIntercalaryDate(2026, 'year-day', 'positivist');
    const women = createIntercalaryDate(2024, 'leap-day', 'positivist');
    expect(formatThirteen(dead)).toBe('Festival of All the Dead 238');
    expect(formatThirteen(dead, { style: 'medium' })).toBe('All the Dead 238');
    expect(formatThirteen(women)).toBe('Festival of Holy Women 236');
    expect(formatThirteen(women, { style: 'short' })).toBe('Holy Women');
    expect(formatThirteen(women, { style: 'numeric' })).toBe('0236-LD');
  });

  it('validates', () => {
    expect(() => formatThirteen({ kind: 'month', system: 'ifc', year: 2026, month: 13, day: 29 })).toThrow(RangeError);
    expect(() => formatThirteen(createMonthDate(2026, 1, 1), { style: 'full' as never })).toThrow(/Invalid format style/);
  });
});

describe('format options are validated strictly (edges:F1, consumers:F6)', () => {
  const d = createMonthDate(2026, 11, 12);
  const gd = g('2026-10-19');
  const bad: [label: string, options: unknown, message: RegExp][] = [
    ['null', null, /format options must be a plain object or undefined, got null/],
    ['a string', 'numeric', /format options must be a plain object or undefined, got "numeric"/],
    ['a number', 3, /got 3/],
    ['true', true, /got true/],
    ['an array', [], /got \[\]/],
    ['a Date', new Date(0), /must be a plain object/],
    ['a misspelled key', { stlye: 'numeric' }, /Unknown format option "stlye" \(expected 'style', 'includeYear', 'includeWeekday'\)/],
    ['style null', { style: null }, /Invalid format style null/],
    ['includeWeekday "no"', { includeWeekday: 'no' }, /format option 'includeWeekday' must be a boolean, got "no"/],
    ['includeYear "false"', { includeYear: 'false' }, /format option 'includeYear' must be a boolean, got "false"/],
    ['includeYear 1', { includeYear: 1 }, /must be a boolean, got 1/],
    ['includeYear null', { includeYear: null }, /must be a boolean, got null/],
  ];

  it.each(bad)('rejects %s with RangeError (both formatters)', (_label, options, message) => {
    expect(() => formatThirteen(d, options as never)).toThrow(RangeError);
    expect(() => formatThirteen(d, options as never)).toThrow(message);
    expect(() => formatGregorian(gd, options as never)).toThrow(RangeError);
    expect(() => formatGregorian(gd, options as never)).toThrow(message);
  });

  it('accepts undefined, {}, explicit undefined values and Object.create(null) bags', () => {
    expect(formatThirteen(d, undefined)).toBe('October 12, 2026');
    expect(formatThirteen(d, {})).toBe('October 12, 2026');
    expect(formatThirteen(d, { style: undefined, includeYear: undefined, includeWeekday: undefined })).toBe('October 12, 2026');
    const bare = Object.assign(Object.create(null), { style: 'short' });
    expect(formatThirteen(d, bare)).toBe('Oct 12');
    expect(formatGregorian(gd, { includeWeekday: false, includeYear: false })).toBe('October 19');
  });
});

describe('parseThirteen / tryParseThirteen (inverse of the numeric style)', () => {
  it('parses month dates and intercalary codes with the display year', () => {
    expect(parseThirteen('2026-M11-12')).toEqual(createMonthDate(2026, 11, 12));
    expect(parseThirteen('2026-YD')).toEqual(createIntercalaryDate(2026, 'year-day'));
    expect(parseThirteen('2024-LD', 'ifc')).toEqual(createIntercalaryDate(2024, 'leap-day'));
    expect(parseThirteen('0238-M11-12', 'positivist')).toEqual(createMonthDate(2026, 11, 12, 'positivist'));
    expect(parseThirteen('0000-LD', 'positivist')).toEqual(createIntercalaryDate(1788, 'leap-day', 'positivist'));
    expect(parseThirteen('-1787-M13-28', 'positivist')).toEqual(createMonthDate(1, 13, 28, 'positivist'));
    expect(parseThirteen('8211-YD', 'positivist')).toEqual(createIntercalaryDate(9999, 'year-day', 'positivist'));
    // The same text means a different day in another system (display years differ).
    expect(fromThirteen(parseThirteen('2026-M11-12', 'positivist'))).toEqual(g('3814-10-19'));
  });

  it('round-trips formatThirteen numeric for every date of several years', () => {
    for (const system of SYSTEMS) {
      for (const year of [1, 1788, 1789, 2024, 2026, 9999]) {
        const all: ThirteenDate[] = everyDay(year).map((date) => toThirteen(date, system));
        expect(all.length).toBeGreaterThan(364);
        for (const td of all) expect(parseThirteen(formatThirteen(td, { style: 'numeric' }), system)).toEqual(td);
      }
      for (const occ of intercalaryDaysInYear(2024, system)) {
        expect(parseThirteen(formatThirteen(occ.thirteen, { style: 'numeric' }), system)).toEqual(occ.thirteen);
      }
    }
  });

  const invalid: [text: string, system: 'ifc' | 'positivist', message: RegExp][] = [
    ['2026-11-12', 'ifc', /expected YYYY-Mmm-dd, YYYY-YD or YYYY-LD/],
    ['2026-M14-01', 'ifc', /month must be an integer 1\.\.13, got 14/],
    ['2026-M00-01', 'ifc', /month must be/],
    ['2026-M01-29', 'ifc', /day must be an integer 1\.\.28, got 29/],
    ['2026-LD', 'ifc', /leap-day does not exist in 2026/],
    ['0237-LD', 'positivist', /leap-day does not exist in 2025/],
    ['0000-M01-01', 'ifc', /IFC year 0 is out of range/],
    ['8212-M01-01', 'positivist', /Positivist year 8212 is out of range/],
    ['-1788-M01-01', 'positivist', /out of range/],
    ['-0000-YD', 'positivist', /expected YYYY-Mmm-dd/],
    ['2026-M1-1', 'ifc', /expected/],
    ['26-M01-01', 'ifc', /expected/],
    ['10000-M01-01', 'ifc', /expected/],
    ['+2026-M01-01', 'ifc', /expected/],
    [' 2026-M01-01', 'ifc', /expected/],
    ['2026-m01-01', 'ifc', /expected/],
    ['2026-yd', 'ifc', /expected/],
    ['M11-12', 'ifc', /expected/],
    ['', 'ifc', /expected/],
  ];

  it.each(invalid)('rejects %j (%s)', (text, system, message) => {
    expect(() => parseThirteen(text, system)).toThrow(RangeError);
    expect(() => parseThirteen(text, system)).toThrow(message);
    expect(tryParseThirteen(text, system)).toBeNull();
  });

  it('rejects non-strings and unknown systems', () => {
    expect(() => parseThirteen(20261112 as never)).toThrow(/must be a string/);
    expect(tryParseThirteen(null as never)).toBeNull();
    expect(() => parseThirteen('2026-M11-12', 'julian' as never)).toThrow(/Unknown calendar system/);
    expect(() => tryParseThirteen('2026-M11-12', 'julian' as never)).toThrow(/Unknown calendar system/);
  });
});

describe('formatGregorian', () => {
  const d = g('2026-10-19');
  it('formats all styles', () => {
    expect(formatGregorian(d)).toBe('October 19, 2026');
    expect(formatGregorian(d, { includeWeekday: true })).toBe('Monday, October 19, 2026');
    expect(formatGregorian(d, { style: 'medium' })).toBe('Oct 19, 2026');
    expect(formatGregorian(d, { style: 'medium', includeWeekday: true })).toBe('Mon, Oct 19, 2026');
    expect(formatGregorian(d, { style: 'short' })).toBe('Oct 19');
    expect(formatGregorian(d, { style: 'numeric' })).toBe('2026-10-19');
    expect(formatGregorian(d, { style: 'numeric', includeYear: false })).toBe('10-19');
    expect(formatGregorian(g('0005-03-07'), { style: 'numeric' })).toBe('0005-03-07');
    expect(formatGregorian(g('0005-03-07'))).toBe('March 7, 5');
    expect(() => formatGregorian({ year: 2026, month: 2, day: 29 })).toThrow(RangeError);
  });
});

describe('helpers', () => {
  it('formatNumericYear', () => {
    expect(formatNumericYear(2026)).toBe('2026');
    expect(formatNumericYear(238)).toBe('0238');
    expect(formatNumericYear(0)).toBe('0000');
    expect(formatNumericYear(-5)).toBe('-0005');
    expect(formatNumericYear(-1787)).toBe('-1787');
    expect(() => formatNumericYear(1.5)).toThrow(RangeError);
  });

  it('ordinal', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112, 365, 0, -1].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th', '365th', '0th', '-1st',
    ]);
    expect(() => ordinal(1.5)).toThrow(RangeError);
  });
});

describe('notable dates', () => {
  it('are valid, unique, chronological fixed dates', () => {
    expect(NOTABLE_DATES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(NOTABLE_DATES.map((n) => n.id)).size).toBe(NOTABLE_DATES.length);
    const keys = NOTABLE_DATES.map((n) => n.month * 100 + n.day);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
    expect(NOTABLE_DATES.some((n) => n.month === 2 && n.day === 29)).toBe(false);
    expect(Object.isFrozen(NOTABLE_DATES[0])).toBe(true);
  });

  it('resolve in a year', () => {
    const ifc = notableDatesInYear(2026);
    const byId = Object.fromEntries(ifc.map((n) => [n.notable.id, n]));
    expect(formatThirteen(byId['christmas-day']!.thirteen)).toBe('December 23, 2026');
    expect(formatThirteen(byId['christmas-day']!.sameLabel!)).toBe('December 25, 2026');
    expect(formatThirteen(byId['new-years-eve']!.thirteen)).toBe('Year Day 2026');
    expect(byId['new-years-eve']!.sameLabel).toBeNull();
    expect(byId['halloween']!.sameLabel).toBeNull(); // no October 31 in IFC
    expect(formatThirteen(byId['pi-day']!.thirteen)).toBe('March 17, 2026');
    const pos = notableDatesInYear(2026, 'positivist');
    expect(pos.every((n) => n.sameLabel === null)).toBe(true);
    expect(formatThirteen(pos.find((n) => n.notable.id === 'new-years-day')!.thirteen)).toBe('Moses 1, 238');
    expect(() => notableDatesInYear(0)).toThrow(RangeError);
  });
});
