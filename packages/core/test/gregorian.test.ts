import { describe, expect, it } from 'vitest';
import {
  GREGORIAN_MONTHS,
  MAX_JULIAN_DAY_NUMBER,
  MIN_JULIAN_DAY_NUMBER,
  WEEKDAY_NAMES,
  addGregorianDays,
  assertValidGregorian,
  assertValidYear,
  compareGregorian,
  gregorianDayOfYear,
  daysInGregorianMonth,
  daysInYear,
  diffGregorianDays,
  gregorianFromDayOfYear,
  fromJSDate,
  fromJulianDayNumber,
  gregorianDate,
  gregorianEquals,
  gregorianMonthName,
  isLeapYear,
  isValidGregorian,
  isValidYear,
  isWeekday,
  orderedWeekdays,
  parseISODate,
  toISODate,
  toJSDate,
  toJulianDayNumber,
  toWeekday,
  tryParseISODate,
  gregorianWeekday,
  weekdayName,
} from '../src/index.ts';
import { everyDay, g } from './helpers.ts';

describe('years', () => {
  it('applies the Gregorian leap rule', () => {
    for (const y of [4, 400, 1600, 1996, 2000, 2024, 2400, 9996]) expect(isLeapYear(y)).toBe(true);
    for (const y of [1, 2, 3, 100, 1700, 1800, 1900, 2023, 2025, 2026, 2100, 9999]) expect(isLeapYear(y)).toBe(false);
    expect(daysInYear(2024)).toBe(366);
    expect(daysInYear(2026)).toBe(365);
  });

  it('validates the 1..9999 range', () => {
    expect(isValidYear(1)).toBe(true);
    expect(isValidYear(9999)).toBe(true);
    for (const bad of [0, -1, 10000, 2026.5, Number.NaN, Infinity, '2026', null]) {
      expect(isValidYear(bad)).toBe(false);
      expect(() => assertValidYear(bad)).toThrow(RangeError);
    }
    expect(() => isLeapYear(0)).toThrow(/out of range/);
    expect(() => isLeapYear(10000)).toThrow(/1\.\.9999/);
    expect(() => daysInYear(1.5)).toThrow(/integer/);
  });
});

describe('months', () => {
  it('knows month lengths', () => {
    expect([...Array(12)].map((_, i) => daysInGregorianMonth(2026, i + 1))).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    expect(daysInGregorianMonth(2024, 2)).toBe(29);
    expect(daysInGregorianMonth(1900, 2)).toBe(28);
    expect(daysInGregorianMonth(2000, 2)).toBe(29);
    expect(() => daysInGregorianMonth(2026, 0)).toThrow(RangeError);
    expect(() => daysInGregorianMonth(2026, 13)).toThrow(/1\.\.12/);
  });

  it('names months (1-based everywhere)', () => {
    expect(gregorianMonthName(1)).toBe('January');
    expect(gregorianMonthName(9, 'short')).toBe('Sep');
    expect(gregorianMonthName(12, 'narrow')).toBe('D');
    expect(GREGORIAN_MONTHS).toHaveLength(12);
    expect(GREGORIAN_MONTHS[6]).toEqual({ index: 7, name: 'July', shortName: 'Jul', narrowName: 'J' });
    GREGORIAN_MONTHS.forEach((m, i) => {
      expect(m.index).toBe(i + 1);
      expect([m.name, m.shortName, m.narrowName]).toEqual([
        gregorianMonthName(m.index),
        gregorianMonthName(m.index, 'short'),
        gregorianMonthName(m.index, 'narrow'),
      ]);
    });
    expect(() => gregorianMonthName(13)).toThrow(RangeError);
    expect(() => gregorianMonthName(1, 'full' as never)).toThrow(/Invalid name style/);
  });
});

describe('date validation', () => {
  it('accepts valid dates and rejects invalid ones', () => {
    expect(isValidGregorian({ year: 2024, month: 2, day: 29 })).toBe(true);
    expect(isValidGregorian({ year: 1, month: 1, day: 1 })).toBe(true);
    expect(isValidGregorian({ year: 9999, month: 12, day: 31 })).toBe(true);
    const bad: unknown[] = [
      { year: 2023, month: 2, day: 29 },
      { year: 1900, month: 2, day: 29 },
      { year: 2026, month: 4, day: 31 },
      { year: 2026, month: 0, day: 1 },
      { year: 2026, month: 13, day: 1 },
      { year: 2026, month: 1, day: 0 },
      { year: 2026, month: 1, day: 1.5 },
      { year: 0, month: 1, day: 1 },
      { year: 10000, month: 1, day: 1 },
      { year: '2026', month: 1, day: 1 },
      { year: 2026, month: 1 },
      null,
      '2026-01-01',
      [2026, 1, 1],
    ];
    for (const value of bad) {
      expect(isValidGregorian(value)).toBe(false);
      expect(() => assertValidGregorian(value)).toThrow(RangeError);
    }
  });

  it('gives descriptive messages', () => {
    expect(() => gregorianDate(2023, 2, 29)).toThrow('Invalid Gregorian date: day must be an integer 1..28 for February 2023, got 29');
    expect(() => gregorianDate(0, 1, 1)).toThrow('Invalid Gregorian date: year 0 is out of range (supported years are 1..9999)');
    expect(() => gregorianDayOfYear({ year: 2026, month: 14, day: 1 })).toThrow(/month must be an integer 1\.\.12, got 14/);
  });

  it('gregorianDate() returns a plain record', () => {
    expect(gregorianDate(2026, 10, 19)).toEqual({ year: 2026, month: 10, day: 19 });
  });
});

describe('day of year', () => {
  it('maps known dates', () => {
    expect(gregorianDayOfYear(g('2026-01-01'))).toBe(1);
    expect(gregorianDayOfYear(g('2026-10-19'))).toBe(292);
    expect(gregorianDayOfYear(g('2026-12-31'))).toBe(365);
    expect(gregorianDayOfYear(g('2024-06-17'))).toBe(169);
    expect(gregorianDayOfYear(g('2024-12-31'))).toBe(366);
    expect(gregorianDayOfYear(g('1900-03-01'))).toBe(60);
    expect(gregorianDayOfYear(g('2000-03-01'))).toBe(61);
  });

  it('round-trips every day', () => {
    for (const year of [1, 1900, 2000, 2023, 2024, 9999]) {
      everyDay(year).forEach((date, i) => {
        expect(gregorianDayOfYear(date)).toBe(i + 1);
        expect(gregorianFromDayOfYear(year, i + 1)).toEqual(date);
      });
    }
  });

  it('rejects out-of-range days of year', () => {
    expect(() => gregorianFromDayOfYear(2026, 0)).toThrow(RangeError);
    expect(() => gregorianFromDayOfYear(2026, 366)).toThrow('Day of year must be an integer 1..365 for 2026, got 366');
    expect(gregorianFromDayOfYear(2024, 366)).toEqual({ year: 2024, month: 12, day: 31 });
    expect(() => gregorianFromDayOfYear(2024, 1.5)).toThrow(RangeError);
  });
});

describe('Julian Day Numbers, weekdays and arithmetic', () => {
  it('matches known JDNs', () => {
    expect(toJulianDayNumber(g('2000-01-01'))).toBe(2451545);
    expect(toJulianDayNumber(g('1970-01-01'))).toBe(2440588);
    expect(toJulianDayNumber(g('1582-10-15'))).toBe(2299161);
    expect(MIN_JULIAN_DAY_NUMBER).toBe(1721426);
    expect(MAX_JULIAN_DAY_NUMBER).toBe(5373484);
    expect(fromJulianDayNumber(2451545)).toEqual(g('2000-01-01'));
    expect(() => fromJulianDayNumber(MIN_JULIAN_DAY_NUMBER - 1)).toThrow(/outside the supported range/);
    expect(() => fromJulianDayNumber(MAX_JULIAN_DAY_NUMBER + 1)).toThrow(RangeError);
    expect(() => fromJulianDayNumber(2451545.5)).toThrow(RangeError);
  });

  it('JDNs are consistent across the whole supported range (every year and month boundary)', () => {
    const problems: string[] = [];
    for (let year = 1; year <= 9999; year++) {
      for (let month = 1; month <= 12; month++) {
        const first = { year, month, day: 1 };
        const last = { year, month, day: daysInGregorianMonth(year, month) };
        const a = toJulianDayNumber(first);
        const b = toJulianDayNumber(last);
        if (b - a !== last.day - 1) problems.push(`length ${toISODate(first)}`);
        if (toISODate(fromJulianDayNumber(a)) !== toISODate(first)) problems.push(`inverse ${toISODate(first)}`);
        if (toISODate(fromJulianDayNumber(b)) !== toISODate(last)) problems.push(`inverse ${toISODate(last)}`);
        if (month === 12 && year < 9999 && toJulianDayNumber({ year: year + 1, month: 1, day: 1 }) !== b + 1) {
          problems.push(`year gap after ${year}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('computes real weekdays', () => {
    expect(gregorianWeekday(g('2026-10-19'))).toBe(1); // Monday
    expect(gregorianWeekday(g('2000-01-01'))).toBe(6); // Saturday
    expect(gregorianWeekday(g('1970-01-01'))).toBe(4); // Thursday
    expect(gregorianWeekday(g('0001-01-01'))).toBe(1); // Monday (proleptic)
    expect(gregorianWeekday(g('9999-12-31'))).toBe(5); // Friday
    for (const date of everyDay(2026)) {
      const js = new Date(Date.UTC(2026, date.month - 1, date.day));
      expect(gregorianWeekday(date)).toBe(js.getUTCDay());
    }
  });

  it('adds and diffs days', () => {
    expect(addGregorianDays(g('2026-12-31'), 1)).toEqual(g('2027-01-01'));
    expect(addGregorianDays(g('2024-03-01'), -1)).toEqual(g('2024-02-29'));
    expect(addGregorianDays(g('2026-10-19'), 0)).toEqual(g('2026-10-19'));
    expect(addGregorianDays(g('2026-01-01'), 365)).toEqual(g('2027-01-01'));
    expect(diffGregorianDays(g('2026-10-19'), g('2026-10-12'))).toBe(7);
    expect(diffGregorianDays(g('2026-01-01'), g('2027-01-01'))).toBe(-365);
    expect(() => addGregorianDays(g('9999-12-31'), 1)).toThrow(RangeError);
    expect(() => addGregorianDays(g('0001-01-01'), -1)).toThrow(RangeError);
    expect(() => addGregorianDays(g('2026-01-01'), 0.5)).toThrow(/integer/);
  });

  it('compares and sorts dates', () => {
    const dates = [g('2026-10-19'), g('0001-01-01'), g('2026-01-01'), g('9999-12-31')];
    expect([...dates].sort(compareGregorian).map(toISODate)).toEqual(['0001-01-01', '2026-01-01', '2026-10-19', '9999-12-31']);
    expect(compareGregorian(g('2026-01-01'), g('2026-01-01'))).toBe(0);
    expect(gregorianEquals(g('2026-01-01'), { year: 2026, month: 1, day: 1 })).toBe(true);
    expect(gregorianEquals(g('2026-01-01'), g('2026-01-02'))).toBe(false);
  });
});

describe('ISO 8601', () => {
  it('formats with 4-digit years', () => {
    expect(toISODate({ year: 2026, month: 10, day: 19 })).toBe('2026-10-19');
    expect(toISODate({ year: 5, month: 3, day: 7 })).toBe('0005-03-07');
    expect(toISODate({ year: 1, month: 1, day: 1 })).toBe('0001-01-01');
    expect(() => toISODate({ year: 2023, month: 2, day: 29 })).toThrow(RangeError);
  });

  it('parses strict YYYY-MM-DD', () => {
    expect(parseISODate('2026-10-19')).toEqual({ year: 2026, month: 10, day: 19 });
    expect(parseISODate('0001-01-01')).toEqual({ year: 1, month: 1, day: 1 });
    expect(parseISODate('9999-12-31')).toEqual({ year: 9999, month: 12, day: 31 });
    expect(parseISODate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it.each([
    '0000-01-01',
    '2023-02-29',
    '1900-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-1-1',
    '26-01-01',
    ' 2026-01-01',
    '2026-01-01 ',
    '2026-01-01T00:00:00Z',
    '+002026-01-01',
    '10000-01-01',
    '2026/01/01',
    '',
  ])('rejects %j', (text) => {
    expect(() => parseISODate(text)).toThrow(RangeError);
    expect(tryParseISODate(text)).toBeNull();
  });

  it('explains parse failures', () => {
    expect(() => parseISODate('2026-1-1')).toThrow('Invalid ISO date "2026-1-1": expected the form YYYY-MM-DD');
    expect(() => parseISODate('2023-02-29')).toThrow(/Invalid ISO date "2023-02-29": day must be an integer 1\.\.28/);
    expect(() => parseISODate(20260101 as unknown as string)).toThrow(/must be a string/);
  });

  it('round-trips every day of several years', () => {
    for (const year of [1, 99, 100, 1900, 2024, 9999]) {
      for (const date of everyDay(year)) expect(parseISODate(toISODate(date))).toEqual(date);
    }
  });
});

describe('JS Date interop (local time)', () => {
  it('reads the local calendar date regardless of time of day', () => {
    expect(fromJSDate(new Date(2026, 9, 19, 0, 0, 0))).toEqual(g('2026-10-19'));
    expect(fromJSDate(new Date(2026, 9, 19, 23, 59, 59, 999))).toEqual(g('2026-10-19'));
    expect(fromJSDate(new Date(2024, 11, 31, 12))).toEqual(g('2024-12-31'));
  });

  it('produces local midnight, including years 1..99', () => {
    const d = toJSDate(g('2026-10-19'));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 19, 0, 0]);
    const early = toJSDate(g('0050-03-01'));
    expect([early.getFullYear(), early.getMonth(), early.getDate()]).toEqual([50, 2, 1]);
  });

  it('round-trips toJSDate → fromJSDate', () => {
    for (const year of [1, 50, 99, 100, 1582, 1970, 2024, 2026, 9999]) {
      for (const date of everyDay(year)) expect(fromJSDate(toJSDate(date))).toEqual(date);
    }
  });

  it('rejects invalid Dates and out-of-range years', () => {
    expect(() => fromJSDate(new Date(Number.NaN))).toThrow(/invalid Date/);
    const year0 = new Date(2000, 0, 1);
    year0.setFullYear(0);
    expect(() => fromJSDate(year0)).toThrow(/out of range/);
    const year10000 = new Date(2000, 0, 1);
    year10000.setFullYear(10000);
    expect(() => fromJSDate(year10000)).toThrow(RangeError);
    expect(() => fromJSDate('2026-01-01' as unknown as Date)).toThrow(/Expected a Date/);
    expect(() => toJSDate({ year: 2026, month: 2, day: 30 })).toThrow(RangeError);
  });
});

describe('weekday helpers', () => {
  it('names weekdays', () => {
    expect(WEEKDAY_NAMES.long[0]).toBe('Sunday');
    expect(weekdayName(4)).toBe('Thursday');
    expect(weekdayName(4, 'short')).toBe('Thu');
    expect(weekdayName(4, 'narrow')).toBe('T');
    expect(() => weekdayName(7 as never)).toThrow(RangeError);
    expect(() => weekdayName(1, 'toString' as never)).toThrow(/Invalid name style/);
  });

  it('orders and normalises weekdays', () => {
    expect(orderedWeekdays()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(orderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(orderedWeekdays(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(toWeekday(-1)).toBe(6);
    expect(toWeekday(-7)).toBe(0);
    expect(toWeekday(15)).toBe(1);
    expect(isWeekday(6)).toBe(true);
    expect(isWeekday(7)).toBe(false);
    expect(isWeekday(1.5)).toBe(false);
    expect(() => orderedWeekdays(9 as never)).toThrow(RangeError);
    expect(() => toWeekday(0.5)).toThrow(RangeError);
  });
});
