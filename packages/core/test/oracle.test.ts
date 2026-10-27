/**
 * Property-style oracle: an independent, day-walking reference implementation
 * of SPEC §1–§3, checked against @thirteen/core for **every day** of a spread
 * of years (1…9999 step 97, plus century, leap and current years) in both
 * systems.
 *
 * The reference shares no code or formulas with the engine: it walks the
 * Gregorian calendar one day at a time from 1 January using its own month-length
 * table and leap rule, gets the weekday of 1 January from Gauss's formula,
 * walks the 13-month calendar as a state machine (day 28 → next month or an
 * intercalary day), advances the fixed weekday only on month days, and spells
 * names and numbers from the SPEC tables written out below.
 */
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.ts';

type SystemId = 'ifc' | 'positivist';
type RefThirteen =
  | { kind: 'month'; system: SystemId; year: number; month: number; day: number }
  | { kind: 'intercalary'; system: SystemId; year: number; id: 'year-day' | 'leap-day' };

interface RefDay {
  readonly gregorian: { year: number; month: number; day: number };
  readonly dayOfYear: number;
  readonly gregorianWeekday: number;
  readonly thirteen: RefThirteen;
  readonly thirteenWeekday: number | null;
}

// ---- SPEC tables, written out independently --------------------------------

const GREGORIAN_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const SPEC = {
  ifc: {
    weekStartsOn: 0,
    yearOffset: 0,
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'Sol', 'July', 'August', 'September', 'October', 'November', 'December'],
    // Gregorian month carrying the same name (SPEC §1.1 gregorianNameEquivalent).
    namesake: [1, 2, 3, 4, 5, 6, null, 7, 8, 9, 10, 11, 12] as (number | null)[],
    names: { 'year-day': 'Year Day', 'leap-day': 'Leap Day' },
    codes: { 'year-day': 'YD', 'leap-day': 'LD' },
  },
  positivist: {
    weekStartsOn: 1,
    yearOffset: -1788,
    months: ['Moses', 'Homer', 'Aristotle', 'Archimedes', 'Caesar', 'Saint Paul', 'Charlemagne', 'Dante', 'Gutenberg', 'Shakespeare', 'Descartes', 'Frederick', 'Bichat'],
    namesake: Array<number | null>(13).fill(null),
    names: { 'year-day': 'Festival of All the Dead', 'leap-day': 'Festival of Holy Women' },
    codes: { 'year-day': 'YD', 'leap-day': 'LD' },
  },
} as const;

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Gauss's algorithm: weekday of 1 January, 0 = Sunday. */
const jan1Weekday = (y: number) => (1 + 5 * ((y - 1) % 4) + 4 * ((y - 1) % 100) + 6 * ((y - 1) % 400)) % 7;
const monthLength = (y: number, m: number) => (m === 2 && leap(y) ? 29 : GREGORIAN_LENGTHS[m - 1]!);
const ordinalOf = (y: number, m: number, d: number) => {
  let n = d;
  for (let i = 1; i < m; i++) n += monthLength(y, i);
  return n;
};
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const numericYear = (n: number) => (n < 0 ? `-${pad(-n, 4)}` : pad(n, 4));

// ---- The walker --------------------------------------------------------------

/** Every day of Gregorian year `year` in `system`, produced by walking day by day. */
function walkYear(year: number, system: SystemId): RefDay[] {
  const spec = SPEC[system];
  const days: RefDay[] = [];
  let gm = 1;
  let gd = 1;
  let weekday = jan1Weekday(year);
  let fixed = spec.weekStartsOn;
  let state: { m: number; d: number } | 'year-day' | 'leap-day' | 'done' = { m: 1, d: 1 };
  for (let doy = 1; state !== 'done'; doy++) {
    days.push({
      gregorian: { year, month: gm, day: gd },
      dayOfYear: doy,
      gregorianWeekday: weekday,
      thirteen:
        typeof state === 'object'
          ? { kind: 'month', system, year, month: state.m, day: state.d }
          : { kind: 'intercalary', system, year, id: state },
      thirteenWeekday: typeof state === 'object' ? fixed : null,
    });
    // Advance the Gregorian side.
    weekday = (weekday + 1) % 7;
    if (gd < monthLength(year, gm)) gd++;
    else {
      gm++;
      gd = 1;
    }
    // Advance the 13-month side: only month days move the fixed weekday.
    if (typeof state === 'object') {
      fixed = (fixed + 1) % 7;
      if (state.d < 28) state = { m: state.m, d: state.d + 1 };
      else if (system === 'ifc' && state.m === 6 && leap(year)) state = 'leap-day';
      else if (state.m === 13) state = 'year-day';
      else state = { m: state.m + 1, d: 1 };
    } else if (state === 'leap-day') {
      state = system === 'ifc' ? { m: 7, d: 1 } : 'done';
    } else {
      state = system === 'positivist' && leap(year) ? 'leap-day' : 'done';
    }
  }
  return days;
}

// ---- Years -----------------------------------------------------------------

const YEARS = [
  ...new Set([
    ...Array.from({ length: Math.floor((9999 - 1) / 97) + 1 }, (_, i) => 1 + 97 * i),
    1600, 1700, 1800, 1900, 2000, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2100, 2400, 9999,
  ]),
].sort((a, b) => a - b);

describe('oracle: independent day-walking reference vs @thirteen/core', () => {
  it('walker sanity: lengths, SPEC anchors', () => {
    expect(YEARS.length).toBeGreaterThan(110);
    for (const system of ['ifc', 'positivist'] as const) {
      expect(walkYear(2024, system)).toHaveLength(366);
      expect(walkYear(2026, system)).toHaveLength(365);
      expect(walkYear(1900, system)).toHaveLength(365);
    }
    const oct19 = walkYear(2026, 'ifc')[291]!;
    expect(oct19).toMatchObject({ gregorian: { month: 10, day: 19 }, gregorianWeekday: 1, thirteenWeekday: 4 });
    expect(oct19.thirteen).toMatchObject({ month: 11, day: 12 });
    expect(walkYear(2024, 'ifc')[168]!.thirteen).toMatchObject({ kind: 'intercalary', id: 'leap-day' });
  });

  it.each(['ifc', 'positivist'] as const)('%s: every day of the year spread agrees on conversion, weekdays, compare, formatting, parsing and arithmetic', (system) => {
    const spec = SPEC[system];
    const problems: string[] = [];
    const check = (label: string, actual: unknown, expected: unknown) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        problems.push(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
      }
    };
    let checkedDays = 0;

    for (const year of YEARS) {
      const days = walkYear(year, system);
      const total = days.length;
      const display = year + spec.yearOffset;
      const yearDayDoy = days.find((d) => d.thirteen.kind === 'intercalary' && d.thirteen.id === 'year-day')!.dayOfYear;
      const nextYearDayDoy = system === 'ifc' ? (leap(year + 1) ? 366 : 365) : 365;

      // Slot order = the order in which the walker meets months and intercalary days.
      const walkedSlots: (number | string)[] = [];
      for (const d of days) {
        const key = d.thirteen.kind === 'month' ? d.thirteen.month : d.thirteen.id;
        if (walkedSlots.at(-1) !== key) walkedSlots.push(key);
      }
      check(`${system} ${year} slots`, core.thirteenSlots(year, system).map((s) => (s.kind === 'month' ? s.month : s.id)), walkedSlots);

      for (const [i, ref] of days.entries()) {
        const at = `${system} ${year}/${ref.dayOfYear}`;
        const g = ref.gregorian;
        const t = ref.thirteen;

        // Gregorian side.
        check(`${at} gregorianFromDayOfYear`, core.gregorianFromDayOfYear(year, ref.dayOfYear), g);
        check(`${at} gregorianDayOfYear`, core.gregorianDayOfYear(g), ref.dayOfYear);
        check(`${at} gregorianWeekday`, core.gregorianWeekday(g), ref.gregorianWeekday);

        // Conversion both ways.
        check(`${at} toThirteen`, core.toThirteen(g, system), t);
        check(`${at} fromThirteen`, core.fromThirteen(t), g);
        check(`${at} thirteenDayOfYear`, core.thirteenDayOfYear(t), ref.dayOfYear);
        check(`${at} thirteenWeekday`, core.thirteenWeekday(t), ref.thirteenWeekday);
        check(`${at} thirteenDisplayYear`, core.thirteenDisplayYear(t), display);

        // compare() — SPEC §3.
        let labelDrift: number | null = null;
        if (t.kind === 'month') {
          const namesake = spec.namesake[t.month - 1]!;
          if (namesake !== null) labelDrift = ref.dayOfYear - ordinalOf(year, namesake, t.day);
        }
        const c = core.compare(g, system);
        check(`${at} compare`, [c.gregorian, c.thirteen, c.dayOfYear, c.isLeapYear, c.gregorianWeekday, c.thirteenWeekday], [g, t, ref.dayOfYear, leap(year), ref.gregorianWeekday, ref.thirteenWeekday]);
        check(
          `${at} compare derived`,
          [c.weekdayShift, c.labelDrift, c.gregorianMonthDays, c.thirteenMonthDays, c.daysIntoYear, c.daysRemainingInYear, c.yearProgress],
          [
            ref.thirteenWeekday === null ? null : (ref.thirteenWeekday - ref.gregorianWeekday + 7) % 7,
            labelDrift,
            monthLength(year, g.month),
            t.kind === 'month' ? 28 : null,
            ref.dayOfYear - 1,
            total - ref.dayOfYear,
            (ref.dayOfYear - 1) / total,
          ],
        );
        check(
          `${at} daysUntilYearDay`,
          core.daysUntilYearDay(g, system),
          ref.dayOfYear <= yearDayDoy ? yearDayDoy - ref.dayOfYear : total - ref.dayOfYear + nextYearDayDoy,
        );

        // Formatting and parsing.
        const long = t.kind === 'month' ? `${spec.months[t.month - 1]} ${t.day}, ${display}` : `${spec.names[t.id]} ${display}`;
        const numeric = t.kind === 'month' ? `${numericYear(display)}-M${pad(t.month, 2)}-${pad(t.day, 2)}` : `${numericYear(display)}-${spec.codes[t.id]}`;
        check(`${at} formatThirteen long`, core.formatThirteen(t), long);
        check(`${at} formatThirteen numeric`, core.formatThirteen(t, { style: 'numeric' }), numeric);
        check(`${at} parseThirteen`, core.parseThirteen(numeric, system), t);

        // Arithmetic: the next walked day (or 1 January of the next year).
        const next = days[i + 1]?.thirteen ?? (year < 9999 ? { kind: 'month', system, year: year + 1, month: 1, day: 1 } : null);
        if (next) check(`${at} addThirteenDays +1`, core.addThirteenDays(t, 1), next);
        else if (!(() => { try { core.addThirteenDays(t, 1); return false; } catch (e) { return e instanceof RangeError; } })()) {
          problems.push(`${at} addThirteenDays past 9999 should throw RangeError`);
        }
        checkedDays++;
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
    expect(checkedDays).toBeGreaterThan(40_000);
  });
});
