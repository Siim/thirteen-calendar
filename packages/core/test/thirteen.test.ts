import { describe, expect, it } from 'vitest';
import {
  type ThirteenDate,
  CALENDAR_SYSTEMS,
  CALENDAR_SYSTEM_IDS,
  DAYS_PER_MONTH,
  DEFAULT_SYSTEM_ID,
  IFC,
  INTERCALARY_DAY_IDS,
  MONTHS_PER_YEAR,
  MONTH_DAYS_PER_YEAR,
  POSITIVIST,
  assertValidThirteenDate,
  compareThirteen,
  convertThirteen,
  createIntercalaryDate,
  createMonthDate,
  gregorianDayOfYear,
  daysInYear,
  thirteenDisplayYear,
  fixedWeekday,
  fromDisplayYear,
  fromThirteen,
  getCalendarSystem,
  intercalaryDayInfo,
  intercalaryDayOfYear,
  intercalaryDaysInYear,
  isCalendarSystemId,
  isIntercalaryDate,
  isIntercalaryDayId,
  isLeapYear,
  isMonthDate,
  isValidThirteenDate,
  monthDays,
  thirteenDayOfYear,
  thirteenEquals,
  thirteenFromDayOfYear,
  thirteenMonthInfo,
  thirteenWeekday,
  toDisplayYear,
  toISODate,
  toThirteen,
} from '../src/index.ts';
import {
  GREGORIAN_CALENDAR,
  GREGORIAN_MONTHS,
  addGregorianDays,
  addThirteenDays,
  addThirteenMonths,
  displayYearRange,
  sameSlotInYear,
  thirteenSlots,
} from '../src/index.ts';
import { ROUND_TRIP_YEARS, SYSTEMS, brief, everyDay, g, specMapping } from './helpers.ts';

describe('system registry', () => {
  it('lists both systems with IFC as default', () => {
    expect(DEFAULT_SYSTEM_ID).toBe('ifc');
    expect(CALENDAR_SYSTEM_IDS).toEqual(['ifc', 'positivist']);
    expect(CALENDAR_SYSTEMS.map((s) => s.id)).toEqual(['ifc', 'positivist']);
    expect(getCalendarSystem()).toBe(IFC);
    expect(getCalendarSystem('positivist')).toBe(POSITIVIST);
    expect(isCalendarSystemId('ifc')).toBe(true);
    expect(isCalendarSystemId('gregorian')).toBe(false);
    expect(isCalendarSystemId('toString')).toBe(false);
    expect(() => getCalendarSystem('julian' as never)).toThrow(`Unknown calendar system "julian" (expected one of 'ifc', 'positivist')`);
    expect(INTERCALARY_DAY_IDS).toEqual(['year-day', 'leap-day']);
    expect(isIntercalaryDayId('leap-day')).toBe(true);
    expect(isIntercalaryDayId('leap')).toBe(false);
  });

  it('describes IFC per SPEC §1.1', () => {
    expect(IFC).toMatchObject({ name: 'International Fixed Calendar', shortName: 'IFC', inventor: 'Moses B. Cotsworth', proposedYear: 1902, weekStartsOn: 0, yearOffset: 0 });
    expect(IFC.months.map((m) => m.name)).toEqual(['January', 'February', 'March', 'April', 'May', 'June', 'Sol', 'July', 'August', 'September', 'October', 'November', 'December']);
    expect(IFC.months.map((m) => m.gregorianNameEquivalent)).toEqual([1, 2, 3, 4, 5, 6, null, 7, 8, 9, 10, 11, 12]);
    expect(IFC.summary).toMatch(/1928 to 1989/);
    expect(intercalaryDayInfo('year-day', 'ifc')).toMatchObject({ name: 'Year Day', code: 'YD', leapOnly: false, afterMonth: 13 });
    expect(intercalaryDayInfo('leap-day', 'ifc')).toMatchObject({ name: 'Leap Day', code: 'LD', leapOnly: true, afterMonth: 6 });
  });

  it('describes Positivist per SPEC §1.2', () => {
    expect(POSITIVIST).toMatchObject({ name: 'Positivist Calendar', inventor: 'Auguste Comte', proposedYear: 1849, weekStartsOn: 1, yearOffset: -1788 });
    expect(POSITIVIST.months.map((m) => m.name)).toEqual(['Moses', 'Homer', 'Aristotle', 'Archimedes', 'Caesar', 'Saint Paul', 'Charlemagne', 'Dante', 'Gutenberg', 'Shakespeare', 'Descartes', 'Frederick', 'Bichat']);
    expect(POSITIVIST.months.every((m) => m.gregorianNameEquivalent === null)).toBe(true);
    expect(intercalaryDayInfo('year-day', 'positivist')).toMatchObject({ name: 'Festival of All the Dead', leapOnly: false, afterMonth: 13 });
    expect(intercalaryDayInfo('leap-day', 'positivist')).toMatchObject({ name: 'Festival of Holy Women', leapOnly: true, afterMonth: 13 });
  });

  it.each(CALENDAR_SYSTEMS)('$id: data is well-formed and immutable', (system) => {
    expect(system.months).toHaveLength(MONTHS_PER_YEAR);
    system.months.forEach((m, i) => {
      expect(m.index).toBe(i + 1);
      expect(m.shortName.length).toBeGreaterThan(0);
      expect(thirteenMonthInfo(m.index, system.id)).toBe(m);
    });
    expect(new Set(system.months.map((m) => m.shortName)).size).toBe(13);
    expect(system.intercalaryDays.map((d) => d.id).sort()).toEqual(['leap-day', 'year-day']);
    for (const info of system.intercalaryDays) {
      expect(info.leapOnly).toBe(info.dayOfYear.common === null);
      // dayOfYear data is consistent with afterMonth placement.
      expect(info.dayOfYear.leap).toBeGreaterThan(info.afterMonth * 28);
    }
    expect(Object.isFrozen(system)).toBe(true);
    expect(Object.isFrozen(system.months)).toBe(true);
    expect(Object.isFrozen(system.months[0])).toBe(true);
    expect(Object.isFrozen(system.intercalaryDays[0]!.dayOfYear)).toBe(true);
    expect(() => thirteenMonthInfo(0, system.id)).toThrow(RangeError);
    expect(() => thirteenMonthInfo(14, system.id)).toThrow(/1\.\.13/);
  });
});

describe('conversion matches the literal SPEC formulas', () => {
  it.each(SYSTEMS)('%s: every day of the round-trip years', (system) => {
    const problems: string[] = [];
    for (const year of ROUND_TRIP_YEARS) {
      for (let d = 1; d <= daysInYear(year); d++) {
        const expected = specMapping(year, d, system);
        const actual = thirteenFromDayOfYear(year, d, system);
        const ok =
          typeof expected === 'string'
            ? actual.kind === 'intercalary' && actual.id === expected
            : actual.kind === 'month' && actual.month === expected.month && actual.day === expected.day;
        if (!ok) problems.push(`${year}/${d}: ${brief(actual)} vs ${JSON.stringify(expected)}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('round trips', () => {
  it.each(SYSTEMS)('%s: fromThirteen ∘ toThirteen = id for every day of the round-trip years', (system) => {
    const problems: string[] = [];
    for (const year of ROUND_TRIP_YEARS) {
      for (const date of everyDay(year)) {
        const td = toThirteen(date, system);
        if (td.year !== year || td.system !== system) problems.push(`year/system ${toISODate(date)}`);
        if (toISODate(fromThirteen(td)) !== toISODate(date)) problems.push(toISODate(date));
        if (thirteenDayOfYear(td) !== gregorianDayOfYear(date)) problems.push(`doy ${toISODate(date)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.each(SYSTEMS)('%s: toThirteen ∘ fromThirteen = id for every 13-month date', (system) => {
    const problems: string[] = [];
    for (const year of ROUND_TRIP_YEARS) {
      const all: ThirteenDate[] = [];
      for (let month = 1; month <= 13; month++) {
        for (let day = 1; day <= 28; day++) all.push(createMonthDate(year, month, day, system));
      }
      for (const occ of intercalaryDaysInYear(year, system)) all.push(occ.thirteen);
      expect(all).toHaveLength(daysInYear(year));
      const seen = new Set<string>();
      for (const td of all) {
        const greg = fromThirteen(td);
        seen.add(toISODate(greg));
        if (brief(toThirteen(greg, system)) !== brief(td)) problems.push(brief(td));
      }
      expect(seen.size).toBe(daysInYear(year)); // bijection onto the year
    }
    expect(problems).toEqual([]);
  });

  it('converts between systems via the Gregorian day', () => {
    const ifc = createMonthDate(2026, 11, 12, 'ifc');
    expect(convertThirteen(ifc, 'positivist')).toEqual({ kind: 'month', system: 'positivist', year: 2026, month: 11, day: 12 });
    expect(convertThirteen(createIntercalaryDate(2024, 'leap-day', 'ifc'), 'positivist')).toEqual(createMonthDate(2024, 7, 1, 'positivist'));
    expect(convertThirteen(createIntercalaryDate(2024, 'year-day', 'ifc'), 'positivist')).toEqual(createIntercalaryDate(2024, 'leap-day', 'positivist'));
  });
});

describe('intercalary days', () => {
  it('locates them per year', () => {
    expect(intercalaryDayOfYear(2026, 'year-day', 'ifc')).toBe(365);
    expect(intercalaryDayOfYear(2026, 'leap-day', 'ifc')).toBeNull();
    expect(intercalaryDayOfYear(2024, 'leap-day', 'ifc')).toBe(169);
    expect(intercalaryDayOfYear(2024, 'year-day', 'ifc')).toBe(366);
    expect(intercalaryDayOfYear(2024, 'year-day', 'positivist')).toBe(365);
    expect(intercalaryDayOfYear(2024, 'leap-day', 'positivist')).toBe(366);
    expect(() => intercalaryDayOfYear(2024, 'mid-day' as never)).toThrow(RangeError);
  });

  it('lists occurrences chronologically', () => {
    expect(intercalaryDaysInYear(2026, 'ifc').map((o) => [o.id, toISODate(o.gregorian), o.dayOfYear, o.afterMonth])).toEqual([['year-day', '2026-12-31', 365, 13]]);
    expect(intercalaryDaysInYear(2024, 'ifc').map((o) => [o.id, toISODate(o.gregorian), o.dayOfYear, o.afterMonth, o.gregorianWeekday])).toEqual([
      ['leap-day', '2024-06-17', 169, 6, 1],
      ['year-day', '2024-12-31', 366, 13, 2],
    ]);
    expect(intercalaryDaysInYear(2024, 'positivist').map((o) => [o.name, toISODate(o.gregorian)])).toEqual([
      ['Festival of All the Dead', '2024-12-30'],
      ['Festival of Holy Women', '2024-12-31'],
    ]);
    expect(intercalaryDaysInYear(2024, 'positivist')[0]!.thirteen).toEqual({ kind: 'intercalary', system: 'positivist', year: 2024, id: 'year-day' });
  });
});

describe('validation', () => {
  const invalid: [unknown, RegExp][] = [
    [{ kind: 'month', system: 'ifc', year: 2026, month: 14, day: 1 }, /month must be an integer 1\.\.13, got 14/],
    [{ kind: 'month', system: 'ifc', year: 2026, month: 0, day: 1 }, /month must be/],
    [{ kind: 'month', system: 'ifc', year: 2026, month: 1, day: 29 }, /day must be an integer 1\.\.28, got 29/],
    [{ kind: 'month', system: 'ifc', year: 2026, month: 1, day: 0 }, /day must be/],
    [{ kind: 'month', system: 'ifc', year: 2026, month: 1.5, day: 1 }, /month must be/],
    [{ kind: 'month', system: 'ifc', year: 0, month: 1, day: 1 }, /year 0 is out of range/],
    [{ kind: 'month', system: 'ifc', year: 10000, month: 1, day: 1 }, /out of range/],
    [{ kind: 'month', system: 'gregorian', year: 2026, month: 1, day: 1 }, /system must be one of 'ifc', 'positivist'/],
    [{ kind: 'week', system: 'ifc', year: 2026 }, /kind must be 'month' or 'intercalary'/],
    [{ kind: 'intercalary', system: 'ifc', year: 2023, id: 'leap-day' }, /leap-day does not exist in 2023 \(not a leap year\)/],
    [{ kind: 'intercalary', system: 'positivist', year: 1900, id: 'leap-day' }, /not a leap year/],
    [{ kind: 'intercalary', system: 'ifc', year: 2024, id: 'midsummer' }, /id must be 'year-day' or 'leap-day'/],
    [null, /expected a ThirteenDate object/],
    ['2026-11-12', /expected a ThirteenDate object/],
  ];

  it.each(invalid)('rejects %j', (value, message) => {
    expect(isValidThirteenDate(value)).toBe(false);
    expect(() => assertValidThirteenDate(value)).toThrow(RangeError);
    expect(() => assertValidThirteenDate(value)).toThrow(message);
    expect(() => fromThirteen(value as ThirteenDate)).toThrow(RangeError);
  });

  it('accepts valid dates including leap days in leap years', () => {
    expect(isValidThirteenDate({ kind: 'intercalary', system: 'ifc', year: 2024, id: 'leap-day' })).toBe(true);
    expect(isValidThirteenDate({ kind: 'month', system: 'positivist', year: 1, month: 13, day: 28 })).toBe(true);
  });

  it('constructors validate', () => {
    expect(createMonthDate(2026, 7, 1)).toEqual({ kind: 'month', system: 'ifc', year: 2026, month: 7, day: 1 });
    expect(createIntercalaryDate(2024, 'leap-day', 'positivist')).toEqual({ kind: 'intercalary', system: 'positivist', year: 2024, id: 'leap-day' });
    expect(() => createMonthDate(2026, 13, 29)).toThrow('Invalid 13-month date: day must be an integer 1..28, got 29');
    expect(() => createIntercalaryDate(2026, 'leap-day')).toThrow(RangeError);
    expect(() => createMonthDate(2026, 1, 1, 'julian' as never)).toThrow(RangeError);
  });

  it('conversion entry points validate input', () => {
    expect(() => toThirteen({ year: 2026, month: 2, day: 29 })).toThrow(RangeError);
    expect(() => toThirteen(g('2026-01-01'), 'nope' as never)).toThrow(/Unknown calendar system/);
    expect(() => thirteenFromDayOfYear(2026, 366)).toThrow('Day of year must be an integer 1..365 for 2026, got 366');
    expect(() => thirteenFromDayOfYear(0, 1)).toThrow(RangeError);
    expect(() => monthDays(2026, 14)).toThrow(RangeError);
  });

  it('type guards discriminate kinds', () => {
    const m = toThirteen(g('2026-10-19'));
    const i = toThirteen(g('2026-12-31'));
    expect(isMonthDate(m)).toBe(true);
    expect(isIntercalaryDate(m)).toBe(false);
    expect(isIntercalaryDate(i)).toBe(true);
  });
});

describe('weekdays, years, equality and ordering', () => {
  it('fixed weekdays follow (weekStartsOn + n − 1) mod 7', () => {
    for (let n = 1; n <= DAYS_PER_MONTH; n++) {
      expect(fixedWeekday(n, 'ifc')).toBe((n - 1) % 7);
      expect(fixedWeekday(n, 'positivist')).toBe(n % 7);
    }
    expect(() => fixedWeekday(29)).toThrow(RangeError);
    expect(thirteenWeekday(createIntercalaryDate(2026, 'year-day'))).toBeNull();
  });

  it('derives display years', () => {
    expect(toDisplayYear(2026)).toBe(2026);
    expect(toDisplayYear(2026, 'positivist')).toBe(238);
    expect(toDisplayYear(1789, 'positivist')).toBe(1);
    expect(toDisplayYear(1788, 'positivist')).toBe(0);
    expect(toDisplayYear(1, 'positivist')).toBe(-1787);
    expect(fromDisplayYear(238, 'positivist')).toBe(2026);
    expect(fromDisplayYear(-1787, 'positivist')).toBe(1);
    expect(fromDisplayYear(2026, 'ifc')).toBe(2026);
    expect(() => fromDisplayYear(8212, 'positivist')).toThrow('Positivist year 8212 is out of range (supported: -1787..8211, i.e. Gregorian 1..9999)');
    expect(() => fromDisplayYear(0, 'ifc')).toThrow(RangeError);
    expect(() => fromDisplayYear(1.5, 'ifc')).toThrow(/integer/);
    expect(thirteenDisplayYear(toThirteen(g('2026-10-19'), 'positivist'))).toBe(238);
    expect(() => toDisplayYear(0)).toThrow(RangeError);
  });

  it('compares 13-month dates', () => {
    const a = createMonthDate(2026, 11, 12, 'ifc');
    expect(thirteenEquals(a, { kind: 'month', system: 'ifc', year: 2026, month: 11, day: 12 })).toBe(true);
    expect(thirteenEquals(a, createMonthDate(2026, 11, 12, 'positivist'))).toBe(false);
    expect(thirteenEquals(createIntercalaryDate(2024, 'leap-day'), createIntercalaryDate(2024, 'leap-day'))).toBe(true);
    expect(thirteenEquals(createIntercalaryDate(2024, 'leap-day'), createIntercalaryDate(2024, 'year-day'))).toBe(false);
    expect(thirteenEquals(createIntercalaryDate(2024, 'year-day'), createMonthDate(2024, 13, 28))).toBe(false);
    // Chronological across systems: IFC Leap Day 2024 (17 Jun) is the same day as Positivist Charlemagne 1.
    expect(compareThirteen(createIntercalaryDate(2024, 'leap-day', 'ifc'), createMonthDate(2024, 7, 1, 'positivist'))).toBe(0);
    expect(compareThirteen(createMonthDate(2024, 6, 28), createIntercalaryDate(2024, 'leap-day'))).toBe(-1);
    expect(compareThirteen(createIntercalaryDate(2024, 'year-day'), createMonthDate(2024, 13, 28))).toBe(1);
  });

  it('monthDays lists the 28 Gregorian dates of a month', () => {
    const sol2024 = monthDays(2024, 7, 'ifc');
    expect(sol2024).toHaveLength(28);
    expect(toISODate(sol2024[0]!)).toBe('2024-06-18');
    expect(toISODate(sol2024[27]!)).toBe('2024-07-15');
    const bichat = monthDays(2026, 13, 'positivist');
    expect(toISODate(bichat[27]!)).toBe('2026-12-30');
    expect(MONTH_DAYS_PER_YEAR).toBe(13 * 28);
  });

  it('day 365/366 accounting matches the leap rule', () => {
    for (const year of ROUND_TRIP_YEARS) {
      for (const system of SYSTEMS) {
        expect(intercalaryDaysInYear(year, system)).toHaveLength(isLeapYear(year) ? 2 : 1);
      }
    }
  });
});

describe('history and descriptors (consumers:F9)', () => {
  it('every calendar has a chronological history', () => {
    for (const d of [...CALENDAR_SYSTEMS, GREGORIAN_CALENDAR]) {
      expect(d.history.length).toBeGreaterThanOrEqual(2);
      const years = d.history.map((h) => h.year);
      expect([...years].sort((a, b) => a - b)).toEqual(years);
      expect(d.history.every((h) => h.text.length > 20 && h.text.endsWith('.'))).toBe(true);
      expect(Object.isFrozen(d.history)).toBe(true);
    }
    expect(IFC.summary).toMatch(/League of Nations/);
    expect(IFC.history.map((h) => h.year)).toEqual([1902, 1923, 1928, 1937, 1989]);
    expect(POSITIVIST.history.map((h) => h.year)).toEqual([1789, 1849]);
  });

  it('describes the Gregorian calendar for the Compare view', () => {
    expect(GREGORIAN_CALENDAR).toMatchObject({ name: 'Gregorian calendar', shortName: 'Gregorian', inventor: 'Pope Gregory XIII', proposedYear: 1582 });
    expect(GREGORIAN_CALENDAR.months).toBe(GREGORIAN_MONTHS);
    expect(GREGORIAN_CALENDAR.history[0]).toMatchObject({ year: 1582 });
    expect(Object.isFrozen(GREGORIAN_CALENDAR)).toBe(true);
  });

  it('intercalary occurrences carry the full static metadata', () => {
    for (const system of SYSTEMS) {
      for (const occ of intercalaryDaysInYear(2024, system)) {
        const info = intercalaryDayInfo(occ.id, system);
        expect(occ).toMatchObject({
          id: info.id,
          code: info.code,
          name: info.name,
          shortName: info.shortName,
          description: info.description,
          leapOnly: info.leapOnly,
          afterMonth: info.afterMonth,
        });
      }
    }
    expect(intercalaryDaysInYear(2024, 'ifc').map((o) => [o.code, o.leapOnly])).toEqual([['LD', true], ['YD', false]]);
  });
});

describe('display years', () => {
  it('displayYearRange gives the supported display years', () => {
    expect(displayYearRange()).toEqual({ min: 1, max: 9999 });
    expect(displayYearRange('positivist')).toEqual({ min: -1787, max: 8211 });
    for (const system of SYSTEMS) {
      const { min, max } = displayYearRange(system);
      expect(fromDisplayYear(min, system)).toBe(1);
      expect(fromDisplayYear(max, system)).toBe(9999);
      expect(() => fromDisplayYear(min - 1, system)).toThrow(RangeError);
      expect(() => fromDisplayYear(max + 1, system)).toThrow(RangeError);
    }
    expect(() => displayYearRange('julian' as never)).toThrow(RangeError);
  });

  it('constructors take the Gregorian year (consumers:F4)', () => {
    // Descartes 12, 238 is built from Gregorian 2026, not from display year 238.
    const ok = createMonthDate(fromDisplayYear(238, 'positivist'), 11, 12, 'positivist');
    expect(toISODate(fromThirteen(ok))).toBe('2026-10-19');
    expect(thirteenDisplayYear(ok)).toBe(238);
  });
});

describe('thirteenSlots (consumers:F2)', () => {
  const codes = (year: number, system: 'ifc' | 'positivist') =>
    thirteenSlots(year, system).map((s) => (s.kind === 'month' ? s.monthInfo.shortName : s.occurrence.shortName));

  it('lists months and intercalary days in display order', () => {
    expect(codes(2024, 'ifc')).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Leap Day', 'Sol', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Year Day']);
    expect(codes(2026, 'ifc')).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Sol', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Year Day']);
    expect(codes(2024, 'positivist').slice(-3)).toEqual(['Bic', 'All the Dead', 'Holy Women']);
    expect(codes(1900, 'positivist').slice(-2)).toEqual(['Bic', 'All the Dead']);
  });

  it('is chronological and consistent with the rest of the engine', () => {
    for (const system of SYSTEMS) {
      for (const year of [1, 1900, 2000, 2024, 2026, 9999]) {
        const slots = thirteenSlots(year, system);
        expect(slots).toHaveLength(13 + intercalaryDaysInYear(year, system).length);
        const firstDays = slots.map((s) =>
          s.kind === 'month' ? thirteenDayOfYear(createMonthDate(year, s.month, 1, system)) : s.occurrence.dayOfYear,
        );
        expect([...firstDays].sort((a, b) => a - b)).toEqual(firstDays);
        for (const s of slots) {
          if (s.kind === 'month') expect(s.monthInfo).toBe(thirteenMonthInfo(s.month, system));
          else expect(s.occurrence.thirteen).toEqual(createIntercalaryDate(year, s.id, system));
        }
      }
    }
    expect(() => thirteenSlots(0)).toThrow(RangeError);
  });
});

describe('sameSlotInYear', () => {
  it('moves a slot to another year, or returns null when it does not exist there', () => {
    expect(sameSlotInYear(createMonthDate(2024, 7, 1), 2026)).toEqual(createMonthDate(2026, 7, 1));
    expect(sameSlotInYear(createIntercalaryDate(2024, 'leap-day'), 2025)).toBeNull();
    expect(sameSlotInYear(createIntercalaryDate(2024, 'leap-day'), 2028)).toEqual(createIntercalaryDate(2028, 'leap-day'));
    expect(sameSlotInYear(createIntercalaryDate(2024, 'leap-day', 'positivist'), 1900)).toBeNull();
    expect(sameSlotInYear(createIntercalaryDate(2023, 'year-day', 'positivist'), 2024)).toEqual(createIntercalaryDate(2024, 'year-day', 'positivist'));
    const input = { ...createMonthDate(2026, 3, 3), extra: true };
    const same = sameSlotInYear(input, 2026)!;
    expect(same).not.toBe(input);
    expect(Object.keys(same)).toEqual(['kind', 'system', 'year', 'month', 'day']);
    expect(() => sameSlotInYear(createMonthDate(2026, 1, 1), 10000)).toThrow(RangeError);
    expect(() => sameSlotInYear({ kind: 'month', system: 'ifc', year: 2026, month: 1, day: 30 }, 2026)).toThrow(RangeError);
  });
});

describe('13-month arithmetic (consumers:F3)', () => {
  it('addThirteenDays steps through intercalary days like any other day', () => {
    expect(addThirteenDays(createMonthDate(2024, 6, 28), 1)).toEqual(createIntercalaryDate(2024, 'leap-day'));
    expect(addThirteenDays(createIntercalaryDate(2024, 'leap-day'), 1)).toEqual(createMonthDate(2024, 7, 1));
    expect(addThirteenDays(createIntercalaryDate(2026, 'year-day'), 1)).toEqual(createMonthDate(2027, 1, 1));
    expect(addThirteenDays(createMonthDate(2026, 1, 1), -1)).toEqual(createIntercalaryDate(2025, 'year-day'));
    expect(addThirteenDays(createMonthDate(2024, 13, 28, 'positivist'), 2)).toEqual(createIntercalaryDate(2024, 'leap-day', 'positivist'));
    for (const system of SYSTEMS) {
      for (const date of everyDay(2024)) {
        const td = toThirteen(date, system);
        expect(addThirteenDays(td, 0)).toEqual(td);
        expect(addThirteenDays(td, 0)).not.toBe(td);
        expect(addThirteenDays(td, 40)).toEqual(toThirteen(addGregorianDays(date, 40), system));
      }
    }
    expect(() => addThirteenDays(createIntercalaryDate(9999, 'year-day'), 1)).toThrow(RangeError);
    expect(() => addThirteenDays(createMonthDate(1, 1, 1), -1)).toThrow(RangeError);
    expect(() => addThirteenDays(createMonthDate(2026, 1, 1), 0.5)).toThrow(/integer/);
  });

  it('addThirteenMonths keeps the day and rolls over years', () => {
    expect(addThirteenMonths(createMonthDate(2026, 13, 5), 1)).toEqual(createMonthDate(2027, 1, 5));
    expect(addThirteenMonths(createMonthDate(2027, 1, 5), -1)).toEqual(createMonthDate(2026, 13, 5));
    expect(addThirteenMonths(createMonthDate(2026, 7, 28), 13)).toEqual(createMonthDate(2027, 7, 28));
    expect(addThirteenMonths(createMonthDate(2026, 7, 28), -27)).toEqual(createMonthDate(2024, 6, 28));
    expect(addThirteenMonths(createMonthDate(2026, 11, 12, 'positivist'), 0)).toEqual(createMonthDate(2026, 11, 12, 'positivist'));
    for (let n = -40; n <= 40; n++) {
      const moved = addThirteenMonths(createMonthDate(2026, 4, 9), n);
      expect(moved.day).toBe(9);
      expect((moved.year - 2026) * 13 + moved.month - 4).toBe(n);
    }
    expect(() => addThirteenMonths(createIntercalaryDate(2024, 'leap-day'), 1)).toThrow(/belongs to no month/);
    expect(() => addThirteenMonths(createMonthDate(9999, 13, 1), 1)).toThrow(RangeError);
    expect(() => addThirteenMonths(createMonthDate(1, 1, 1), -1)).toThrow(RangeError);
    expect(() => addThirteenMonths(createMonthDate(2026, 1, 1), 1.5)).toThrow(/integer/);
  });
});
