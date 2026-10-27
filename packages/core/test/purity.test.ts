/**
 * Keeps @thirteen/core pure: zero runtime dependencies, no platform APIs,
 * and `Date` confined to the documented interop functions in gregorian.ts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.ts';

const SRC = new URL('../src/', import.meta.url);

function sourceFiles(dir: URL, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)
      : entry.name.endsWith('.ts')
        ? [`${prefix}${entry.name}`]
        : [],
  );
}

describe('package purity', () => {
  const files = sourceFiles(SRC);

  it('has no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies ?? {}).toEqual({});
    // The `.ics` module is its own entry point (docs/EVENTS.md §5.1); test/public-api.test.ts checks its surface.
    expect(pkg.exports).toEqual({ '.': './src/index.ts', './ics': './src/ics/index.ts' });
  });

  it.each(files)('%s only imports relative modules', (file) => {
    const text = readFileSync(new URL(file, SRC), 'utf8');
    const specifiers = [...text.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1]!);
    for (const s of specifiers) expect(s.startsWith('./') || s.startsWith('../')).toBe(true);
    expect(text).not.toMatch(/\b(?:process|window|document|globalThis|require)\b[.(]/);
    expect(text).not.toMatch(/Date\.now\(|Math\.random\(/);
    if (file !== 'gregorian.ts') expect(text).not.toMatch(/new Date\(/);
  });

  it('exposes only functions, frozen data and constants', () => {
    for (const [name, value] of Object.entries(core)) {
      if (typeof value === 'object' && value !== null) expect(Object.isFrozen(value), name).toBe(true);
    }
  });
});

/** Every object reachable from `value` (including itself). */
function objectsIn(value: unknown, seen = new Set<object>()): Set<object> {
  if (typeof value === 'object' && value !== null && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) objectsIn(child, seen);
  }
  return seen;
}

describe('results never alias inputs (consumers:F5, consumers:F11)', () => {
  const greg = () => ({ year: 2024, month: 6, day: 17 });
  const month = () => core.createMonthDate(2024, 6, 28);
  const leap = () => core.createIntercalaryDate(2024, 'leap-day');
  const pos = () => core.createMonthDate(2026, 11, 12, 'positivist');
  const cases: [string, (...args: never[]) => unknown, () => unknown[]][] = [
    ['gregorianDate', core.gregorianDate as never, () => [2024, 6, 17]],
    ['addGregorianDays', core.addGregorianDays as never, () => [greg(), 0]],
    ['gregorianFromDayOfYear', core.gregorianFromDayOfYear as never, () => [2024, 169]],
    ['parseISODate', core.parseISODate as never, () => ['2024-06-17']],
    ['toThirteen', core.toThirteen as never, () => [greg()]],
    ['fromThirteen', core.fromThirteen as never, () => [month()]],
    ['convertThirteen (same system)', core.convertThirteen as never, () => [leap(), 'ifc']],
    ['convertThirteen (other system)', core.convertThirteen as never, () => [pos(), 'ifc']],
    ['addThirteenDays', core.addThirteenDays as never, () => [leap(), 0]],
    ['addThirteenMonths', core.addThirteenMonths as never, () => [month(), 0]],
    ['sameSlotInYear', core.sameSlotInYear as never, () => [leap(), 2024]],
    ['compare', core.compare as never, () => [greg()]],
    ['lookupGregorianLabel', core.lookupGregorianLabel as never, () => [greg()]],
    ['lookupThirteenLabel (month)', core.lookupThirteenLabel as never, () => [month()]],
    ['lookupThirteenLabel (intercalary)', core.lookupThirteenLabel as never, () => [leap()]],
    ['sameLabelInGregorian', core.sameLabelInGregorian as never, () => [month()]],
    ['sameLabelInThirteen', core.sameLabelInThirteen as never, () => [{ year: 2026, month: 10, day: 12 }]],
    ['buildGregorianMonth (options)', core.buildGregorianMonth as never, () => [2024, 6, 'ifc', { weekStartsOn: 1 }]],
    ['intercalaryDaysInYear', core.intercalaryDaysInYear as never, () => [2024]],
    ['thirteenSlots', core.thirteenSlots as never, () => [2024]],
    ['notableDatesInYear', core.notableDatesInYear as never, () => [2024]],
  ];

  it.each(cases)('%s', (_name, fn, makeArgs) => {
    const args = makeArgs();
    const inputs = objectsIn(args);
    inputs.delete(args);
    const result = fn(...(args as never[]));
    expect(result).toBeTypeOf('object');
    const shared = [...objectsIn(result)].filter((o) => inputs.has(o));
    expect(shared).toEqual([]);
  });

  it('covers every exported function that returns dates built from an object input', () => {
    // If a new date-returning function is exported, add it to the table above
    // (events functions: the table in test/public-api.test.ts).
    const covered = new Set(cases.map(([name]) => name.split(' ')[0]));
    for (const name of ['toThirteen', 'fromThirteen', 'convertThirteen', 'addThirteenDays', 'addThirteenMonths', 'sameSlotInYear', 'compare', 'lookupGregorianLabel', 'lookupThirteenLabel', 'addGregorianDays']) {
      expect(covered.has(name), name).toBe(true);
    }
  });
});

describe('public constants (consumers:F11)', () => {
  it('have the documented values', () => {
    expect([core.MIN_YEAR, core.MAX_YEAR]).toEqual([1, 9999]);
    expect(core.WEEKDAYS).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([core.DAYS_PER_WEEK, core.WEEKS_PER_MONTH, core.DAYS_PER_MONTH, core.MONTHS_PER_YEAR]).toEqual([7, 4, 28, 13]);
    expect(core.MONTH_DAYS_PER_YEAR).toBe(core.DAYS_PER_MONTH * core.MONTHS_PER_YEAR);
    expect(core.WEEKS_PER_MONTH * core.DAYS_PER_WEEK).toBe(core.DAYS_PER_MONTH);
    expect([core.MIN_JULIAN_DAY_NUMBER, core.MAX_JULIAN_DAY_NUMBER]).toEqual([1721426, 5373484]);
    expect(core.DEFAULT_SYSTEM_ID).toBe('ifc');
    expect(core.INTERCALARY_DAY_IDS).toEqual(['year-day', 'leap-day']);
  });
});

describe('consumers', () => {
  it("resolves '@thirteen/core' by package name to the same module", async () => {
    const byName = await import('@thirteen/core');
    expect(Object.keys(byName).sort()).toEqual(Object.keys(core).sort());
    expect(byName.compare).toBe(core.compare);
  });

  it('src typechecks without Node or DOM types (tsconfig.src.json is part of `typecheck`)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts.typecheck).toContain('tsconfig.src.json');
    expect(pkg.engines.node).toBe('>=22.18.0');
    const src = JSON.parse(readFileSync(new URL('../tsconfig.src.json', import.meta.url), 'utf8'));
    expect(src.compilerOptions).toMatchObject({ lib: ['ES2022'], types: [] });
    expect(src.include).toEqual(['src']);
  });
});
