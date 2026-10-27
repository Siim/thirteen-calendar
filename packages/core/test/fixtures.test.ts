/**
 * Guards fixtures/conversions.json (format version 2, consumed by the Swift
 * parity tests): the committed file must equal freshly generated output, so it
 * cannot go stale, and spot values are checked against hand-written
 * expectations so it cannot be silently wrong. Regenerate with `pnpm fixtures`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURE_FILE_URL, FIXTURE_SECTIONS, buildFixtures, serializeFixtures } from '../scripts/fixtures.ts';
import { CALENDAR_SYSTEMS, GREGORIAN_CALENDAR, compare, parseISODate, toISODate } from '../src/index.ts';

describe('fixtures/conversions.json', () => {
  const generated = serializeFixtures(buildFixtures());
  const file = JSON.parse(generated);

  it('is up to date (run `pnpm fixtures` if this fails)', () => {
    const committed = readFileSync(FIXTURE_FILE_URL, 'utf8');
    expect(committed === generated).toBe(true);
  });

  it('is deterministic, valid JSON with the documented sections, and small', () => {
    expect(serializeFixtures(buildFixtures())).toBe(generated);
    expect(Object.keys(file)).toEqual(FIXTURE_SECTIONS);
    expect(file).toMatchObject({ version: 2, generatedBy: '@thirteen/core', spec: 'docs/SPEC.md' });
    expect(Buffer.byteLength(generated)).toBeLessThan(600 * 1000);
    expect(generated.endsWith('}\n')).toBe(true);
  });

  it('cases: every day of 2024 and 2026 plus boundary days, both systems', () => {
    const cases = file.cases as Array<Record<string, any>>;
    const isos = new Set(cases.map((c) => c.gregorian as string));
    for (const year of [2024, 2026]) {
      expect([...isos].filter((iso) => iso.startsWith(`${year}-`))).toHaveLength(year === 2024 ? 366 : 365);
    }
    for (const iso of ['0001-01-01', '1600-02-29', '1900-02-28', '2000-06-17', '2023-12-31', '2100-03-01', '9999-12-31']) {
      expect(isos.has(iso)).toBe(true);
    }
    expect(isos.has('1900-02-29')).toBe(false);
    expect(cases).toHaveLength(isos.size * 2);
    for (const c of cases) {
      expect(toISODate(parseISODate(c.gregorian))).toBe(c.gregorian);
      expect(Object.keys(c)).toEqual([
        'gregorian',
        'thirteen',
        'displayYear',
        'dayOfYear',
        'isLeapYear',
        'gregorianWeekday',
        'thirteenWeekday',
        'weekdayShift',
        'labelDrift',
        'formattedLong',
      ]);
      expect(Object.keys(c.thirteen)).toEqual(
        c.thirteen.kind === 'month' ? ['kind', 'system', 'year', 'month', 'day'] : ['kind', 'system', 'year', 'id'],
      );
    }
    expect(cases.find((c) => c.gregorian === '2026-10-19' && c.thirteen.system === 'ifc')).toEqual({
      gregorian: '2026-10-19',
      thirteen: { kind: 'month', system: 'ifc', year: 2026, month: 11, day: 12 },
      displayYear: 2026,
      dayOfYear: 292,
      isLeapYear: false,
      gregorianWeekday: 1,
      thirteenWeekday: 4,
      weekdayShift: 3,
      labelDrift: 7,
      formattedLong: 'October 12, 2026',
    });
    expect(cases.find((c) => c.gregorian === '2024-12-31' && c.thirteen.system === 'positivist')).toMatchObject({
      thirteen: { kind: 'intercalary', system: 'positivist', year: 2024, id: 'leap-day' },
      displayYear: 236,
      thirteenWeekday: null,
      weekdayShift: null,
      labelDrift: null,
      formattedLong: 'Festival of Holy Women 236',
    });
  });

  it('comparisons are exact Comparison JSON plus displayYear and daysUntilYearDay', () => {
    const comparisons = file.comparisons as Array<Record<string, any>>;
    expect(comparisons.length).toBeGreaterThanOrEqual(60);
    for (const c of comparisons) {
      const { displayYear, daysUntilYearDay, ...rest } = c;
      expect(rest).toEqual(compare(rest.gregorian, rest.thirteen.system));
      expect(Object.keys(rest)).toEqual(Object.keys(compare(rest.gregorian, rest.thirteen.system)));
      expect(typeof displayYear).toBe('number');
      expect(typeof daysUntilYearDay).toBe('number');
    }
    const oct19 = comparisons.find((c) => c.gregorian.year === 2026 && c.gregorian.month === 10 && c.gregorian.day === 19 && c.thirteen.system === 'ifc')!;
    expect(oct19).toMatchObject({ gregorianMonthDays: 31, thirteenMonthDays: 28, daysIntoYear: 291, daysRemainingInYear: 73, displayYear: 2026, daysUntilYearDay: 73 });
    const holyWomen = comparisons.find((c) => c.gregorian.year === 2024 && c.gregorian.month === 12 && c.gregorian.day === 31 && c.thirteen.system === 'positivist')!;
    expect(holyWomen).toMatchObject({ thirteenMonthDays: null, daysRemainingInYear: 0, yearProgress: 365 / 366, displayYear: 236, daysUntilYearDay: 365 });
  });

  it('pins system data, formats, parsing and the other parity sections', () => {
    expect(file.systems).toEqual(
      CALENDAR_SYSTEMS.map((s) => ({ ...JSON.parse(JSON.stringify(s)), displayYearRange: expect.any(Object) })),
    );
    expect(file.systems.map((s: any) => s.displayYearRange)).toEqual([{ min: 1, max: 9999 }, { min: -1787, max: 8211 }]);
    expect(file.gregorianCalendar).toEqual(JSON.parse(JSON.stringify(GREGORIAN_CALENDAR)));

    const { options, thirteen, gregorian } = file.formats;
    expect(options).toHaveLength(21);
    const at = (o: object) => {
      const i = options.findIndex((x: object) => JSON.stringify(x) === JSON.stringify(o));
      expect(i, JSON.stringify(o)).toBeGreaterThanOrEqual(0);
      return i;
    };
    const desc = thirteen.find((t: any) => t.date.system === 'positivist' && t.date.month === 11 && t.date.year === 2026);
    expect(desc.outputs[at({})]).toBe('Descartes 11, 238');
    expect(desc.outputs[at({ style: 'numeric' })]).toBe('0238-M11-11');
    expect(desc.outputs[at({ style: 'medium', includeYear: true, includeWeekday: true })]).toBe('Thu, Des 11, 238');
    const dead = thirteen.find((t: any) => t.date.system === 'positivist' && t.date.year === 1 && t.date.kind === 'intercalary');
    expect(dead.outputs[at({ style: 'numeric' })]).toBe('-1787-YD');
    expect(dead.outputs[at({ style: 'short' })]).toBe('All the Dead');
    for (const entry of thirteen) expect(entry.outputs).toHaveLength(21);
    expect(gregorian.find((g: any) => g.date.year === 2024).outputs[at({ style: 'short', includeYear: false, includeWeekday: true })]).toBe('Thu, Feb 29');

    const parse = (system: string, text: string) => file.numericParsing.find((p: any) => p.system === system && p.text === text).expected;
    expect(parse('ifc', '2026-M11-12')).toEqual({ kind: 'month', system: 'ifc', year: 2026, month: 11, day: 12 });
    expect(parse('ifc', '2026-11-12')).toBeNull();
    expect(parse('positivist', '-1787-M01-01')).toEqual({ kind: 'month', system: 'positivist', year: 1, month: 1, day: 1 });

    expect(file.yearStats).toHaveLength(14);
    expect(file.monthAlignments).toHaveLength(4);
    expect(file.thirteenYearLayouts).toHaveLength(4);
    expect(file.gregorianMonthLayouts).toHaveLength(96);
    expect(file.slots[0].slots.map((s: any) => s.month ?? s.id)).toEqual([1, 2, 3, 4, 5, 6, 'leap-day', 7, 8, 9, 10, 11, 12, 13, 'year-day']);
    expect(file.gregorianMonthLayouts.find((l: any) => l.year === 2026 && l.month === 10 && l.system === 'ifc' && l.weekStartsOn === 0)).toEqual({
      year: 2026, month: 10, system: 'ifc', weekStartsOn: 0, leadingBlanks: 4, rows: 5, thirteenMonthStarts: [8], intercalaryDays: [],
    });
    expect(file.labelLookups.thirteen[0].thirteen).toEqual({ kind: 'month', system: 'ifc', year: 2026, month: 1, day: 1 });
    expect(file.notableDates).toHaveLength(4);
    expect(file.arithmetic.addDays[1]).toEqual({
      from: { kind: 'intercalary', system: 'ifc', year: 2024, id: 'leap-day' },
      days: 1,
      expected: { kind: 'month', system: 'ifc', year: 2024, month: 7, day: 1 },
    });
  });
});
