import { createIntercalaryDate, createMonthDate, gregorianDate } from '@thirteen/core';
import { describe, expect, it } from 'vitest';
import { navigateGregorianMonth, navigateThirteen } from './navigation.ts';

const ifc = (month: number, day: number, year = 2026) => createMonthDate(year, month, day, 'ifc');

describe('navigateThirteen', () => {
  it('moves by day and week inside a month', () => {
    expect(navigateThirteen(ifc(11, 12), 'ArrowRight')).toEqual(ifc(11, 13));
    expect(navigateThirteen(ifc(11, 12), 'ArrowLeft')).toEqual(ifc(11, 11));
    expect(navigateThirteen(ifc(11, 12), 'ArrowDown')).toEqual(ifc(11, 19));
    expect(navigateThirteen(ifc(11, 12), 'ArrowUp')).toEqual(ifc(11, 5));
    expect(navigateThirteen(ifc(11, 12), 'Home')).toEqual(ifc(11, 8));
    expect(navigateThirteen(ifc(11, 12), 'End')).toEqual(ifc(11, 14));
  });

  it('crosses months in a year grid, keeping the weekday column', () => {
    expect(navigateThirteen(ifc(11, 3), 'ArrowUp')).toEqual(ifc(10, 24));
    expect(navigateThirteen(ifc(11, 26), 'ArrowDown')).toEqual(ifc(12, 5));
    expect(navigateThirteen(ifc(11, 28), 'ArrowRight')).toEqual(ifc(12, 1));
    expect(navigateThirteen(ifc(11, 12), 'PageUp')).toEqual(ifc(10, 12));
    expect(navigateThirteen(ifc(11, 12), 'PageDown')).toEqual(ifc(12, 12));
  });

  it('steps onto and off intercalary days', () => {
    expect(navigateThirteen(ifc(6, 28, 2024), 'ArrowRight')).toEqual(createIntercalaryDate(2024, 'leap-day', 'ifc'));
    expect(navigateThirteen(createIntercalaryDate(2024, 'leap-day', 'ifc'), 'ArrowRight')).toEqual(ifc(7, 1, 2024));
    expect(navigateThirteen(ifc(13, 28), 'ArrowRight')).toEqual(createIntercalaryDate(2026, 'year-day', 'ifc'));
  });

  it('never leaves the year, and stays inside the month when asked', () => {
    expect(navigateThirteen(createIntercalaryDate(2026, 'year-day', 'ifc'), 'ArrowRight')).toBeNull();
    expect(navigateThirteen(ifc(1, 1), 'ArrowLeft')).toBeNull();
    expect(navigateThirteen(ifc(1, 3), 'ArrowUp')).toBeNull();
    expect(navigateThirteen(ifc(11, 28), 'ArrowRight', { withinMonth: true })).toBeNull();
    expect(navigateThirteen(ifc(11, 3), 'ArrowUp', { withinMonth: true })).toBeNull();
    expect(navigateThirteen(ifc(11, 3), 'PageDown', { withinMonth: true })).toBeNull();
    expect(navigateThirteen(ifc(11, 3), 'Tab')).toBeNull();
  });

  it('returns null instead of throwing at the edges of the supported range', () => {
    const first = (system: 'ifc' | 'positivist') => createMonthDate(1, 1, 1, system);
    for (const system of ['ifc', 'positivist'] as const) {
      expect(navigateThirteen(first(system), 'ArrowLeft')).toBeNull();
      expect(navigateThirteen(first(system), 'ArrowUp')).toBeNull();
      expect(navigateThirteen(first(system), 'ArrowRight')).toEqual(createMonthDate(1, 1, 2, system));
      const lastDay = createIntercalaryDate(9999, 'year-day', system); // 9999 is a common year
      expect(navigateThirteen(lastDay, 'ArrowRight')).toBeNull();
      expect(navigateThirteen(lastDay, 'ArrowDown')).toBeNull();
      expect(navigateThirteen(lastDay, 'ArrowLeft')).toEqual(createMonthDate(9999, 13, 28, system));
      expect(navigateThirteen(createMonthDate(9999, 13, 28, system), 'ArrowRight')).toEqual(lastDay);
    }
  });
});

describe('navigateGregorianMonth', () => {
  it('moves inside a ragged month and stops at its edges', () => {
    const oct19 = gregorianDate(2026, 10, 19); // Monday
    expect(navigateGregorianMonth(oct19, 'ArrowDown')).toEqual(gregorianDate(2026, 10, 26));
    expect(navigateGregorianMonth(oct19, 'Home', 0)).toEqual(gregorianDate(2026, 10, 18));
    expect(navigateGregorianMonth(oct19, 'End', 0)).toEqual(gregorianDate(2026, 10, 24));
    expect(navigateGregorianMonth(gregorianDate(2026, 10, 1), 'Home', 0)).toEqual(gregorianDate(2026, 10, 1));
    expect(navigateGregorianMonth(gregorianDate(2026, 10, 30), 'End', 0)).toEqual(gregorianDate(2026, 10, 31));
    expect(navigateGregorianMonth(gregorianDate(2026, 10, 29), 'ArrowDown')).toBeNull();
    expect(navigateGregorianMonth(gregorianDate(2026, 10, 1), 'ArrowLeft')).toBeNull();
  });
});
