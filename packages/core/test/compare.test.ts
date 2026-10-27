import { describe, expect, it } from 'vitest';
import {
  type Comparison,
  addGregorianDays,
  compare,
  createIntercalaryDate,
  createMonthDate,
  daysInYear,
  daysUntilYearDay,
  diffGregorianDays,
  lookupGregorianLabel,
  lookupThirteenLabel,
  sameLabelInGregorian,
  sameLabelInThirteen,
  toISODate,
  toThirteen,
} from '../src/index.ts';
import { SYSTEMS, everyDay, g } from './helpers.ts';

describe('compare() — SPEC §3', () => {
  it('2026-10-19 in IFC', () => {
    const c = compare(g('2026-10-19'));
    expect(c).toEqual<Comparison>({
      gregorian: { year: 2026, month: 10, day: 19 },
      thirteen: { kind: 'month', system: 'ifc', year: 2026, month: 11, day: 12 },
      dayOfYear: 292,
      isLeapYear: false,
      gregorianWeekday: 1,
      thirteenWeekday: 4,
      weekdayShift: 3,
      labelDrift: 7,
      gregorianMonthDays: 31,
      thirteenMonthDays: 28,
      daysIntoYear: 291,
      daysRemainingInYear: 73,
      yearProgress: 291 / 365,
    });
  });

  it('2026-10-19 in Positivist', () => {
    const c = compare(g('2026-10-19'), 'positivist');
    expect(c.thirteen).toEqual({ kind: 'month', system: 'positivist', year: 2026, month: 11, day: 12 });
    expect(c.thirteenWeekday).toBe(5);
    expect(c.weekdayShift).toBe(4);
    expect(c.labelDrift).toBeNull();
    expect(c.thirteenMonthDays).toBe(28);
  });

  it('intercalary days have null weekday fields', () => {
    for (const [iso, system] of [
      ['2026-12-31', 'ifc'],
      ['2024-06-17', 'ifc'],
      ['2024-12-30', 'positivist'],
      ['2024-12-31', 'positivist'],
    ] as const) {
      const c = compare(g(iso), system);
      expect(c.thirteen.kind).toBe('intercalary');
      expect(c.thirteenWeekday).toBeNull();
      expect(c.weekdayShift).toBeNull();
      expect(c.labelDrift).toBeNull();
      expect(c.thirteenMonthDays).toBeNull();
    }
  });

  it('labelDrift is null for Sol and for every Positivist date', () => {
    expect(compare(g('2026-06-18')).labelDrift).toBeNull(); // Sol 1
    expect(compare(g('2026-07-15')).labelDrift).toBeNull(); // Sol 28
    for (const date of everyDay(2026)) expect(compare(date, 'positivist').labelDrift).toBeNull();
  });

  it('labelDrift follows the definition (input − same-label Gregorian date)', () => {
    expect(compare(g('2026-01-01')).labelDrift).toBe(0);
    expect(compare(g('2026-01-29')).labelDrift).toBe(-3); // IFC February 1 vs Gregorian Feb 1
    expect(compare(g('2026-02-28')).labelDrift).toBe(-3); // IFC March 3 vs Gregorian Mar 3
    expect(compare(g('2026-12-30')).labelDrift).toBe(2); // IFC December 28 vs Gregorian Dec 28
    expect(compare(g('2024-02-29')).labelDrift).toBe(-4); // IFC March 4 vs Gregorian Mar 4 2024
    for (const date of everyDay(2024)) {
      const c = compare(date);
      if (c.thirteen.kind !== 'month' || c.thirteen.month === 7) continue;
      const label = sameLabelInGregorian(c.thirteen)!;
      expect(c.labelDrift).toBe(diffGregorianDays(date, label));
    }
  });

  it('weekdayShift is (thirteen − gregorian) mod 7, constant within each year segment', () => {
    for (const system of SYSTEMS) {
      for (const year of [2023, 2024, 2025, 2026]) {
        const shifts = new Map<string, Set<number>>();
        for (const date of everyDay(year)) {
          const c = compare(date, system);
          if (c.weekdayShift === null) continue;
          expect(c.weekdayShift).toBe((((c.thirteenWeekday! - c.gregorianWeekday) % 7) + 7) % 7);
          expect(c.weekdayShift).toBeGreaterThanOrEqual(0);
          expect(c.weekdayShift).toBeLessThanOrEqual(6);
          // Segment = position relative to the intercalary days that have passed.
          const segment = c.thirteen.kind === 'month' && system === 'ifc' && c.isLeapYear && c.thirteen.month > 6 ? 'after-leap' : 'main';
          (shifts.get(segment) ?? shifts.set(segment, new Set()).get(segment)!).add(c.weekdayShift);
        }
        for (const set of shifts.values()) expect(set.size).toBe(1);
      }
    }
    expect(compare(g('2026-10-19')).weekdayShift).toBe(3);
  });

  it('year progress fields are consistent for every day', () => {
    for (const year of [2024, 2026]) {
      const total = daysInYear(year);
      for (const date of everyDay(year)) {
        const c = compare(date);
        expect(c.daysIntoYear).toBe(c.dayOfYear - 1);
        expect(c.daysIntoYear + 1 + c.daysRemainingInYear).toBe(total);
        expect(c.yearProgress).toBe(c.daysIntoYear / total);
        expect(c.yearProgress).toBeGreaterThanOrEqual(0);
        expect(c.yearProgress).toBeLessThan(1);
      }
    }
    expect(compare(g('2026-01-01')).yearProgress).toBe(0);
    expect(compare(g('2026-12-31')).daysRemainingInYear).toBe(0);
    expect(compare(g('2024-02-10')).gregorianMonthDays).toBe(29);
  });

  it('does not alias the input and validates it', () => {
    const input = { year: 2026, month: 10, day: 19 };
    expect(compare(input).gregorian).not.toBe(input);
    expect(() => compare({ year: 2026, month: 2, day: 29 })).toThrow(RangeError);
    expect(() => compare(g('2026-01-01'), 'nope' as never)).toThrow(RangeError);
  });
});

describe('reverse lookups ("read this label in the other calendar")', () => {
  it('sameLabelInGregorian', () => {
    expect(sameLabelInGregorian(createMonthDate(2026, 11, 12))).toEqual(g('2026-10-12'));
    expect(sameLabelInGregorian(createMonthDate(2026, 6, 28))).toEqual(g('2026-06-28'));
    expect(sameLabelInGregorian(createMonthDate(2026, 8, 1))).toEqual(g('2026-07-01')); // IFC July
    expect(sameLabelInGregorian(createMonthDate(2026, 7, 1))).toBeNull(); // Sol
    expect(sameLabelInGregorian(createMonthDate(2026, 11, 12, 'positivist'))).toBeNull();
    expect(sameLabelInGregorian(createIntercalaryDate(2026, 'year-day'))).toBeNull();
    expect(() => sameLabelInGregorian({ kind: 'month', system: 'ifc', year: 2026, month: 1, day: 30 })).toThrow(RangeError);
  });

  it('sameLabelInThirteen', () => {
    expect(sameLabelInThirteen(g('2026-10-12'))).toEqual(createMonthDate(2026, 11, 12));
    expect(sameLabelInThirteen(g('2026-07-04'))).toEqual(createMonthDate(2026, 8, 4));
    expect(sameLabelInThirteen(g('2026-02-28'))).toEqual(createMonthDate(2026, 2, 28));
    expect(sameLabelInThirteen(g('2026-10-31'))).toBeNull(); // no October 31 in IFC
    expect(sameLabelInThirteen(g('2024-02-29'))).toBeNull();
    expect(sameLabelInThirteen(g('2026-10-12'), 'positivist')).toBeNull();
    expect(() => sameLabelInThirteen({ year: 2026, month: 2, day: 30 })).toThrow(RangeError);
  });

  it('labels round-trip for every IFC month date with a namesake', () => {
    for (let month = 1; month <= 13; month++) {
      if (month === 7) continue;
      for (let day = 1; day <= 28; day++) {
        const td = createMonthDate(2026, month, day);
        expect(sameLabelInThirteen(sameLabelInGregorian(td)!)).toEqual(td);
      }
    }
  });

  it('lookupGregorianLabel', () => {
    expect(lookupGregorianLabel(g('2026-10-12'))).toEqual({
      gregorian: g('2026-10-12'),
      fallsOn: createMonthDate(2026, 11, 5),
      sameLabel: createMonthDate(2026, 11, 12),
      sameLabelFallsOn: g('2026-10-19'),
    });
    expect(lookupGregorianLabel(g('2026-12-31'), 'positivist')).toEqual({
      gregorian: g('2026-12-31'),
      fallsOn: createIntercalaryDate(2026, 'year-day', 'positivist'),
      sameLabel: null,
      sameLabelFallsOn: null,
    });
  });

  it('lookupThirteenLabel', () => {
    expect(lookupThirteenLabel(createMonthDate(2026, 11, 12))).toEqual({
      thirteen: createMonthDate(2026, 11, 12),
      fallsOn: g('2026-10-19'),
      sameLabel: g('2026-10-12'),
      sameLabelFallsOn: createMonthDate(2026, 11, 5),
    });
    expect(lookupThirteenLabel(createIntercalaryDate(2024, 'leap-day'))).toEqual({
      thirteen: createIntercalaryDate(2024, 'leap-day'),
      fallsOn: g('2024-06-17'),
      sameLabel: null,
      sameLabelFallsOn: null,
    });
  });

  it('lookups return fresh, normalised copies of their input (oracle:F2, edges:F2, consumers:F5)', () => {
    const input = createMonthDate(2026, 11, 12);
    const result = lookupThirteenLabel(input);
    expect(result.thirteen).not.toBe(input);
    expect(result.thirteen).toEqual(input);
    (result.thirteen as { day: number }).day = 1;
    expect(input.day).toBe(12); // mutating the result does not touch the caller's date

    const withExtras = { ...createIntercalaryDate(2024, 'leap-day'), selected: true, label: 'ui state' };
    const lk = lookupThirteenLabel(withExtras);
    expect(lk.thirteen).toEqual({ kind: 'intercalary', system: 'ifc', year: 2024, id: 'leap-day' });
    expect(Object.keys(lk.thirteen)).toEqual(['kind', 'system', 'year', 'id']);
    expect(JSON.stringify(lk)).not.toContain('ui state');

    const greg = { year: 2026, month: 10, day: 12, extra: 1 };
    expect(lookupGregorianLabel(greg).gregorian).toEqual(g('2026-10-12'));
    expect(lookupGregorianLabel(greg).gregorian).not.toBe(greg);
    expect(() => lookupThirteenLabel({ kind: 'month', system: 'ifc', year: 2026, month: 1, day: 29 })).toThrow(RangeError);
  });
});

describe('daysUntilYearDay', () => {
  it('counts down to the year-day', () => {
    expect(daysUntilYearDay(g('2026-10-19'))).toBe(73);
    expect(daysUntilYearDay(g('2026-12-31'))).toBe(0);
    expect(daysUntilYearDay(g('2026-01-01'))).toBe(364);
    expect(daysUntilYearDay(g('2024-01-01'))).toBe(365);
    expect(daysUntilYearDay(g('2024-12-30'), 'positivist')).toBe(0);
    // Positivist leap year: 31 Dec (Holy Women) is after the year-day → next year's All the Dead.
    expect(daysUntilYearDay(g('2024-12-31'), 'positivist')).toBe(365);
  });

  it('agrees with toThirteen for every day', () => {
    for (const system of SYSTEMS) {
      for (const date of everyDay(2024)) {
        const n = daysUntilYearDay(date, system);
        const target = toThirteen(addGregorianDays(date, n), system);
        expect(target.kind === 'intercalary' && target.id === 'year-day').toBe(true);
      }
    }
    expect(toISODate(addGregorianDays(g('2026-03-01'), daysUntilYearDay(g('2026-03-01'))))).toBe('2026-12-31');
  });
});
