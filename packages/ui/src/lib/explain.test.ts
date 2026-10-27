import { compare, gregorianDate } from '@thirteen/core';
import { describe, expect, it } from 'vitest';
import { explainLabelDrift, explainWeekdayShift, explainYearDayCountdown } from './explain.ts';

describe('explain', () => {
  it('says the 13-month label runs 7 days behind on 2026-10-19 (IFC)', () => {
    const c = compare(gregorianDate(2026, 10, 19), 'ifc');
    const drift = explainLabelDrift(c);
    expect(drift.headline).toBe('7 days behind');
    expect(drift.detail).toContain('The 13-month label runs 7 days behind the Gregorian one');
    expect(drift.detail).toContain('Oct 12 falls on Gregorian Oct 19');
    const shift = explainWeekdayShift(c);
    expect(shift.headline).toBe('Thursday, really Monday');
    expect(shift.detail).toContain('3 days ahead');
  });

  it('explains labels that run ahead, and missing labels', () => {
    expect(explainLabelDrift(compare(gregorianDate(2026, 1, 31), 'ifc')).headline).toBe('3 days ahead');
    expect(explainLabelDrift(compare(gregorianDate(2026, 6, 20), 'ifc')).detail).toMatch(/Sol has no Gregorian namesake/);
    expect(explainLabelDrift(compare(gregorianDate(2026, 10, 19), 'positivist')).detail).toMatch(/named after people/);
    expect(explainLabelDrift(compare(gregorianDate(2026, 12, 31), 'ifc')).detail).toMatch(/Year Day has no month/);
  });

  it('explains matching weekdays and intercalary days', () => {
    expect(explainWeekdayShift(compare(gregorianDate(2023, 5, 5), 'ifc')).headline).toMatch(/in both/);
    expect(explainWeekdayShift(compare(gregorianDate(2026, 12, 31), 'ifc')).headline).toBe('No fixed weekday');
  });

  it('does not claim the year-day closes a Positivist leap year (Holy Women follows it)', () => {
    expect(explainYearDayCountdown(73, 'ifc')).toBe('73 days until Year Day, the day outside the week at the end of the year.');
    expect(explainYearDayCountdown(196, 'positivist')).not.toMatch(/closes the year/);
    expect(explainYearDayCountdown(0, 'positivist')).toMatch(/^Today is Festival of All the Dead/);
  });
});
