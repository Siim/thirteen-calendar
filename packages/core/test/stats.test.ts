import { describe, expect, it } from 'vitest';
import { formatThirteen, thirteenWeekday, toISODate, gregorianWeekday, yearStats } from '../src/index.ts';

describe('yearStats', () => {
  it('IFC 2026', () => {
    const s = yearStats(2026, 'ifc');
    expect(s).toMatchObject({
      year: 2026,
      displayYear: 2026,
      system: 'ifc',
      isLeapYear: false,
      daysInYear: 365,
      gregorianMonthLengths: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
      thirteenMonthLengths: Array(13).fill(28),
      gregorianMonthShapeCount: 11,
      thirteenMonthShapeCount: 1,
      gregorianQuarterLengths: [90, 91, 92, 92],
      thirteenQuarterLengths: [91, 91, 91, 91],
      gregorianYearStartWeekday: 4,
      thirteenYearStartWeekday: 0,
      intercalaryDayCount: 1,
    });
    expect(s.gregorianFriday13ths.map((p) => toISODate(p.gregorian))).toEqual(['2026-02-13', '2026-03-13', '2026-11-13']);
    expect(s.gregorianFriday13ths.map((p) => formatThirteen(p.thirteen, { style: 'short' }))).toEqual(['Feb 16', 'Mar 16', 'Nov 9']);
    expect(s.thirteenFriday13ths).toHaveLength(13);
    for (const [i, p] of s.thirteenFriday13ths.entries()) {
      expect(p.thirteen).toEqual({ kind: 'month', system: 'ifc', year: 2026, month: i + 1, day: 13 });
      expect(thirteenWeekday(p.thirteen)).toBe(5);
    }
    // Gregorian Friday-the-13ths really are Fridays on the 13th.
    for (const p of s.gregorianFriday13ths) expect([p.gregorian.day, gregorianWeekday(p.gregorian)]).toEqual([13, 5]);
    expect(toISODate(s.thirteenFriday13ths[0]!.gregorian)).toBe('2026-01-13');
  });

  it('Positivist 2024 has no Friday-the-13ths and two intercalary days', () => {
    const s = yearStats(2024, 'positivist');
    expect(s.thirteenFriday13ths).toEqual([]);
    expect(s.intercalaryDayCount).toBe(2);
    expect(s.displayYear).toBe(236);
    expect(s.thirteenYearStartWeekday).toBe(1);
    expect(s.gregorianYearStartWeekday).toBe(1);
    expect(s.gregorianQuarterLengths).toEqual([91, 91, 92, 92]);
    expect(s.gregorianFriday13ths.map((p) => toISODate(p.gregorian))).toEqual(['2024-09-13', '2024-12-13']);
  });

  it('matches hand-computed values (consumers:F11)', () => {
    // IFC month m day 13 = day-of-year (m − 1) × 28 + 13, worked out by hand for 2026.
    expect(yearStats(2026, 'ifc').thirteenFriday13ths.map((p) => toISODate(p.gregorian))).toEqual([
      '2026-01-13', '2026-02-10', '2026-03-10', '2026-04-07', '2026-05-05', '2026-06-02', '2026-06-30',
      '2026-07-28', '2026-08-25', '2026-09-22', '2026-10-20', '2026-11-17', '2026-12-15',
    ]);
    expect(yearStats(2023).gregorianFriday13ths.map((p) => toISODate(p.gregorian))).toEqual(['2023-01-13', '2023-10-13']);
    expect(yearStats(2023)).toMatchObject({ gregorianYearStartWeekday: 0, thirteenYearStartWeekday: 0 }); // 2023 starts on Sunday
    expect(yearStats(1)).toMatchObject({ gregorianYearStartWeekday: 1, displayYear: 1, gregorianQuarterLengths: [90, 91, 92, 92] });
    expect(yearStats(1, 'positivist')).toMatchObject({ displayYear: -1787, thirteenYearStartWeekday: 1 });
    expect(yearStats(9999)).toMatchObject({ gregorianYearStartWeekday: 5, isLeapYear: false, intercalaryDayCount: 1 }); // Gauss: Friday
    expect(yearStats(2000)).toMatchObject({ isLeapYear: true, gregorianQuarterLengths: [91, 91, 92, 92], gregorianMonthLengths: [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] });
    expect(yearStats(1900)).toMatchObject({ isLeapYear: false, daysInYear: 365, intercalaryDayCount: 1 });
  });

  it('holds structural facts for every year', () => {
    for (let year = 1; year <= 9999; year += 7) {
      const s = yearStats(year);
      expect(s.gregorianFriday13ths.length).toBeGreaterThanOrEqual(1);
      expect(s.gregorianFriday13ths.length).toBeLessThanOrEqual(3);
      expect(s.gregorianMonthShapeCount).toBe(11);
      expect(s.gregorianQuarterLengths.reduce((a, b) => a + b)).toBe(s.daysInYear);
      expect(s.thirteenQuarterLengths.reduce((a, b) => a + b) + s.intercalaryDayCount).toBe(s.daysInYear);
      expect(s.thirteenFriday13ths).toHaveLength(13);
    }
    expect(() => yearStats(10000)).toThrow(RangeError);
  });
});
