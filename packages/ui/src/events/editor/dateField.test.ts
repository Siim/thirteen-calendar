import { type ThirteenDate, createIntercalaryDate, createMonthDate, fromThirteen, thirteenSlots, toISODate } from '@thirteen/core';
import { describe, expect, it } from 'vitest';
import { intlZoneResolver } from '../intlZones.ts';
import {
  EDITOR_YEAR_RANGE,
  FULL_YEAR_RANGE,
  dateButtonLabel,
  dateButtonText,
  gregorianCaption,
  parseTypedDate,
  pickerCellLabel,
  pickerKeyMove,
  skippedDays,
  slotLabel,
  stepToYear,
  thirteenCaption,
  yearValueText,
} from './dateField.ts';

const g = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
};
const iso = (date: ThirteenDate | null | undefined) => (date == null ? null : toISODate(fromThirteen(date)));

describe('the closed date field (§2.12)', () => {
  it('names the system and reads both calendars', () => {
    expect(dateButtonText(g('2026-10-19'), 'ifc')).toBe('IFC Thu, Oct 12, 2026');
    expect(dateButtonText(g('2026-12-31'), 'ifc')).toBe('Year Day 2026');
    expect(dateButtonLabel('Starts', g('2026-10-19'), 'ifc')).toBe('Starts, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026');
    expect(gregorianCaption(g('2026-10-19'))).toBe('Gregorian Monday, October 19, 2026');
    expect(thirteenCaption(g('2026-10-19'), 'ifc')).toBe('IFC Thursday, October 12, 2026');
  });

  it('names the year, slots and cells as §2.12 says', () => {
    expect(yearValueText(2026, 'ifc')).toBe('2026');
    expect(yearValueText(2026, 'positivist')).toBe('238, Gregorian 2026');
    const slots = thirteenSlots(2028, 'ifc');
    expect(slotLabel(slots.find((s) => s.kind === 'month' && s.month === 11)!, 'ifc')).toBe('October, month 11 of 13');
    expect(slotLabel(slots.find((s) => s.kind === 'month' && s.month === 7)!, 'ifc')).toBe('Sol, month 7 of 13');
    expect(slotLabel(slots.find((s) => s.kind === 'intercalary' && s.id === 'leap-day')!, 'ifc')).toBe('Leap Day, leap years only');
    expect(slotLabel(slots.find((s) => s.kind === 'intercalary' && s.id === 'year-day')!, 'ifc')).toBe('Year Day, belongs to no month');
    expect(pickerCellLabel(createMonthDate(2026, 11, 12, 'ifc'), g('2026-10-19'))).toBe('Thursday, October 12. Gregorian Monday, October 19');
  });
});

describe('year stepping', () => {
  const leapDay = createIntercalaryDate(2028, 'leap-day', 'ifc');

  it('falls back to the day before a leap-only day, and says so', () => {
    const step = stepToYear(leapDay, 2027, { range: EDITOR_YEAR_RANGE });
    expect(iso(step?.date)).toBe('2027-06-17');
    expect(step?.caption).toBe('2027 has no Leap Day, so the date moved to June 28.');
    const holyWomen = createIntercalaryDate(2028, 'leap-day', 'positivist');
    expect(stepToYear(holyWomen, 2029, { range: EDITOR_YEAR_RANGE })?.caption).toBe(
      '241 has no Festival of Holy Women, so the date moved to the Festival of All the Dead.',
    );
  });

  it('keeps the slot when the new year has it', () => {
    const step = stepToYear(createMonthDate(2026, 11, 12, 'ifc'), 2027, { range: EDITOR_YEAR_RANGE });
    expect(step?.caption).toBeNull();
    expect(step?.date).toEqual(createMonthDate(2027, 11, 12, 'ifc'));
  });

  it('keeps a leap-only repeat on leap years (picker.leapRepeat)', () => {
    const next = stepToYear(leapDay, 2029, { range: EDITOR_YEAR_RANGE, leapRepeat: true });
    expect(iso(next?.date)).toBe('2032-06-17');
    expect(next?.caption).toBe('Every Leap Day happens only in leap years, so the year moved to 2032.');
    expect(iso(stepToYear(leapDay, 2027, { range: EDITOR_YEAR_RANGE, leapRepeat: true })?.date)).toBe('2024-06-17');
    // 2100 is not a leap year: from 2096 the next Leap Day is in 2104.
    expect(iso(stepToYear(createIntercalaryDate(2096, 'leap-day', 'ifc'), 2097, { range: EDITOR_YEAR_RANGE, leapRepeat: true })?.date)).toBe('2104-06-17');
  });

  it('stops at 1583 and 9999 in the editor, and keeps every year in the Converter', () => {
    expect(stepToYear(createMonthDate(1583, 1, 1, 'ifc'), 1582, { range: EDITOR_YEAR_RANGE })).toBeNull();
    expect(stepToYear(createMonthDate(9999, 1, 1, 'ifc'), 10000, { range: EDITOR_YEAR_RANGE })).toBeNull();
    expect(stepToYear(createMonthDate(1583, 1, 1, 'ifc'), 1582, { range: FULL_YEAR_RANGE })).not.toBeNull();
  });
});

describe('keyboard moves (§2.12 Keyboard)', () => {
  it('moves by day through Leap Day', () => {
    const leap = pickerKeyMove(createMonthDate(2028, 6, 28, 'ifc'), 'ArrowRight');
    expect(leap).toEqual(createIntercalaryDate(2028, 'leap-day', 'ifc'));
    expect(pickerKeyMove(leap!, 'ArrowRight')).toEqual(createMonthDate(2028, 7, 1, 'ifc'));
    expect(pickerKeyMove(createMonthDate(2028, 7, 1, 'ifc'), 'ArrowLeft')).toEqual(leap);
  });

  it('moves by row into the next month, and from Year Day to the days around it', () => {
    expect(pickerKeyMove(createMonthDate(2026, 12, 25, 'ifc'), 'ArrowDown')).toEqual(createMonthDate(2026, 13, 4, 'ifc'));
    expect(pickerKeyMove(createMonthDate(2026, 11, 3, 'ifc'), 'ArrowUp')).toEqual(createMonthDate(2026, 10, 24, 'ifc'));
    const yearDay = createIntercalaryDate(2026, 'year-day', 'ifc');
    expect(pickerKeyMove(yearDay, 'ArrowUp')).toEqual(createMonthDate(2026, 13, 28, 'ifc'));
    expect(pickerKeyMove(yearDay, 'ArrowDown')).toEqual(createMonthDate(2027, 1, 1, 'ifc'));
  });

  it('pages by month and jumps to the month ends', () => {
    expect(pickerKeyMove(createMonthDate(2026, 11, 12, 'ifc'), 'PageDown')).toEqual(createMonthDate(2026, 12, 12, 'ifc'));
    expect(pickerKeyMove(createMonthDate(2026, 1, 12, 'ifc'), 'PageUp')).toEqual(createMonthDate(2025, 13, 12, 'ifc'));
    expect(pickerKeyMove(createMonthDate(2026, 11, 12, 'ifc'), 'Home')).toEqual(createMonthDate(2026, 11, 1, 'ifc'));
    expect(pickerKeyMove(createMonthDate(2026, 11, 12, 'ifc'), 'End')).toEqual(createMonthDate(2026, 11, 28, 'ifc'));
    expect(pickerKeyMove(createMonthDate(2026, 11, 12, 'ifc'), 'x')).toBeNull();
  });
});

describe('typed dates', () => {
  it('reads the numeric 13-month form and ISO dates', () => {
    expect(parseTypedDate('2026-M11-12', 'ifc')).toEqual(g('2026-10-19'));
    expect(parseTypedDate('2026-m11-12', 'ifc')).toEqual(g('2026-10-19'));
    expect(parseTypedDate('2026-YD', 'ifc')).toEqual(g('2026-12-31'));
    expect(parseTypedDate('2028-LD', 'ifc')).toEqual(g('2028-06-17'));
    expect(parseTypedDate(' 2026-10-19 ', 'ifc')).toEqual(g('2026-10-19'));
    expect(parseTypedDate('19.10.2026', 'ifc')).toBeNull();
    expect(parseTypedDate('', 'ifc')).toBeNull();
  });
});

describe('days a time zone skips (§2.12, SPEC §1.5)', () => {
  it('finds the whole days a zone skipped, and nothing on a daylight saving day', () => {
    const zones = intlZoneResolver();
    const apia = skippedDays('Pacific/Apia', zones);
    expect(apia(g('2011-12-30'))).toBe(true);
    expect(apia(g('2011-12-29'))).toBe(false);
    expect(apia(g('2011-12-31'))).toBe(false);
    expect(skippedDays('Pacific/Kiritimati', zones)(g('1994-12-31'))).toBe(true);
    const tallinn = skippedDays('Europe/Tallinn', zones);
    expect(tallinn(g('2026-03-29'))).toBe(false);
    expect(tallinn(g('2026-10-25'))).toBe(false);
    // A zone the platform does not know skips nothing.
    expect(skippedDays('ics:VTIMEZONE:Customized Time Zone', zones)(g('2011-12-30'))).toBe(false);
  });
});
