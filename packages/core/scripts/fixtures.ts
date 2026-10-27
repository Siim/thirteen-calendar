/**
 * Golden parity vectors shared with the Swift port (apple/ThirteenKit) —
 * `fixtures/conversions.json`, format version 2 (documented in docs/SPEC.md §4.2).
 *
 * Pure and deterministic: `serializeFixtures(buildFixtures())` is byte-for-byte
 * what the committed file must contain (enforced by test/fixtures.test.ts).
 * Sections either hold the exact JSON of a core result type (decode straight
 * into the Swift type and compare with `==`) or a documented compact shape
 * where the full type would be too large.
 */

import {
  type CalendarSystem,
  type CalendarSystemId,
  type Comparison,
  type FormatOptions,
  type GregorianCalendarInfo,
  type GregorianDate,
  type GregorianLabelLookup,
  type IntercalaryDayId,
  type MonthAlignment,
  type ThirteenDate,
  type ThirteenLabelLookup,
  type Weekday,
  type YearStats,
  CALENDAR_SYSTEMS,
  CALENDAR_SYSTEM_IDS,
  GREGORIAN_CALENDAR,
  addThirteenDays,
  addThirteenMonths,
  buildGregorianMonth,
  buildThirteenYear,
  compare,
  compareGregorian,
  createIntercalaryDate,
  createMonthDate,
  daysInYear,
  daysUntilYearDay,
  displayYearRange,
  formatGregorian,
  formatThirteen,
  gregorianFromDayOfYear,
  isValidGregorian,
  lookupGregorianLabel,
  lookupThirteenLabel,
  monthAlignment,
  notableDatesInYear,
  parseISODate,
  sameSlotInYear,
  thirteenDisplayYear,
  thirteenSlots,
  toISODate,
  tryParseThirteen,
  yearStats,
} from '../src/index.ts';

/** Repository-relative location of the fixture file. */
export const FIXTURE_FILE_URL: URL = new URL('../../../fixtures/conversions.json', import.meta.url);

/** Years whose every day is included in `cases`. */
export const FULL_YEARS: readonly number[] = [2024, 2026];

/** Years for which only boundary days are included in `cases`. */
export const BOUNDARY_YEARS: readonly number[] = [1, 1600, 1900, 2000, 2023, 2100, 9999];

/** Boundary month/day labels (29 February is skipped in common years). */
export const BOUNDARY_DAYS: readonly (readonly [month: number, day: number])[] = [
  [1, 1],
  [1, 2],
  [2, 28],
  [2, 29],
  [3, 1],
  [6, 16],
  [6, 17],
  [6, 18],
  [6, 19],
  [12, 29],
  [12, 30],
  [12, 31],
];

/** Dates whose full `Comparison` is pinned in `comparisons` (SPEC §2 anchors + extremes), ascending. */
export const COMPARISON_DATES: readonly string[] = [
  '0001-01-01',
  '0001-12-31',
  '1788-06-17',
  '1788-12-31',
  '1789-01-01',
  '1900-02-28',
  '1900-03-01',
  '1900-12-31',
  '2000-02-29',
  '2000-06-17',
  '2000-12-30',
  '2000-12-31',
  '2023-01-01',
  '2023-06-18',
  '2024-01-01',
  '2024-02-29',
  '2024-06-16',
  '2024-06-17',
  '2024-06-18',
  '2024-07-15',
  '2024-12-30',
  '2024-12-31',
  '2026-01-01',
  '2026-01-29',
  '2026-02-28',
  '2026-03-01',
  '2026-06-17',
  '2026-06-18',
  '2026-10-19',
  '2026-11-01',
  '2026-12-30',
  '2026-12-31',
  '9999-12-30',
  '9999-12-31',
];

/** Years pinned in `yearStats`. */
export const STATS_YEARS: readonly number[] = [1, 1900, 2000, 2023, 2024, 2026, 9999];

/** Years pinned in the alignment, layout, slot and notable-date sections. */
export const LAYOUT_YEARS: readonly number[] = [2024, 2026];

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One day in one system (compact: Gregorian date as ISO text). */
export interface FixtureCase {
  /** ISO 8601 Gregorian date. */
  readonly gregorian: string;
  /** Exact `ThirteenDate` JSON (includes `system`). */
  readonly thirteen: ThirteenDate;
  readonly displayYear: number;
  readonly dayOfYear: number;
  readonly isLeapYear: boolean;
  readonly gregorianWeekday: number;
  readonly thirteenWeekday: number | null;
  readonly weekdayShift: number | null;
  readonly labelDrift: number | null;
  /** `formatThirteen(thirteen)` (long style, with year). */
  readonly formattedLong: string;
}

/** Exact `Comparison` JSON plus two derived values. */
export type FixtureComparison = Comparison & { readonly displayYear: number; readonly daysUntilYearDay: number };

export interface FixtureSystem extends CalendarSystem {
  /** `displayYearRange(id)`. */
  readonly displayYearRange: { readonly min: number; readonly max: number };
}

export interface FixtureFormats {
  /** Option bags; `outputs[i]` below was produced with `options[i]` (`{}` = defaults). */
  readonly options: readonly FormatOptions[];
  readonly thirteen: readonly { readonly date: ThirteenDate; readonly outputs: readonly string[] }[];
  readonly gregorian: readonly { readonly date: GregorianDate; readonly outputs: readonly string[] }[];
}

export interface FixtureParse {
  readonly system: CalendarSystemId;
  readonly text: string;
  /** `parseThirteen(text, system)`, or `null` when it throws. */
  readonly expected: ThirteenDate | null;
}

/** Compact `buildThirteenYear` result. */
export interface FixtureThirteenYearLayout {
  readonly year: number;
  readonly system: CalendarSystemId;
  readonly displayYear: number;
  readonly isLeapYear: boolean;
  readonly daysInYear: number;
  readonly weekdays: readonly Weekday[];
  /** Per month: first/last Gregorian day (ISO) and the cells where a Gregorian month starts. */
  readonly months: readonly {
    readonly month: number;
    readonly first: string;
    readonly last: string;
    /** `[13-month day, Gregorian month]` for every cell with `isGregorianMonthStart`. */
    readonly gregorianMonthStarts: readonly (readonly [number, number])[];
  }[];
  readonly intercalary: readonly {
    readonly id: IntercalaryDayId;
    readonly afterMonth: number;
    readonly gregorian: string;
    readonly dayOfYear: number;
    readonly gregorianWeekday: Weekday;
  }[];
}

/** Compact `buildGregorianMonth` result. */
export interface FixtureGregorianMonthLayout {
  readonly year: number;
  readonly month: number;
  readonly system: CalendarSystemId;
  readonly weekStartsOn: Weekday;
  readonly leadingBlanks: number;
  /** `weeks.length`. */
  readonly rows: number;
  /** Gregorian days whose cell has `isThirteenMonthStart`. */
  readonly thirteenMonthStarts: readonly number[];
  /** Gregorian days whose cell holds an intercalary 13-month date. */
  readonly intercalaryDays: readonly number[];
}

/** Compact `thirteenSlots` result. */
export interface FixtureSlots {
  readonly year: number;
  readonly system: CalendarSystemId;
  readonly slots: readonly (
    | { readonly kind: 'month'; readonly month: number }
    | { readonly kind: 'intercalary'; readonly id: IntercalaryDayId }
  )[];
}

export interface FixtureNotable {
  readonly year: number;
  readonly system: CalendarSystemId;
  readonly dates: readonly {
    readonly id: string;
    readonly gregorian: GregorianDate;
    readonly thirteen: ThirteenDate;
    readonly sameLabel: ThirteenDate | null;
  }[];
}

export interface FixtureArithmetic {
  /** `addThirteenDays(from, days)`, or `null` when it throws (result outside 1…9999). */
  readonly addDays: readonly { readonly from: ThirteenDate; readonly days: number; readonly expected: ThirteenDate | null }[];
  /** `addThirteenMonths(from, months)`, or `null` when it throws (intercalary input or out of range). */
  readonly addMonths: readonly {
    readonly from: ThirteenDate;
    readonly months: number;
    readonly expected: ThirteenDate | null;
  }[];
  /** `sameSlotInYear(from, year)`. */
  readonly sameSlotInYear: readonly {
    readonly from: ThirteenDate;
    readonly year: number;
    readonly expected: ThirteenDate | null;
  }[];
}

export interface FixtureFile {
  readonly version: 2;
  readonly generatedBy: '@thirteen/core';
  readonly spec: 'docs/SPEC.md';
  readonly systems: readonly FixtureSystem[];
  readonly gregorianCalendar: GregorianCalendarInfo;
  readonly cases: readonly FixtureCase[];
  readonly comparisons: readonly FixtureComparison[];
  readonly formats: FixtureFormats;
  readonly numericParsing: readonly FixtureParse[];
  readonly yearStats: readonly YearStats[];
  readonly monthAlignments: readonly MonthAlignment[];
  readonly thirteenYearLayouts: readonly FixtureThirteenYearLayout[];
  readonly gregorianMonthLayouts: readonly FixtureGregorianMonthLayout[];
  readonly slots: readonly FixtureSlots[];
  readonly labelLookups: {
    readonly gregorian: readonly (GregorianLabelLookup & { readonly system: CalendarSystemId })[];
    readonly thirteen: readonly ThirteenLabelLookup[];
  };
  readonly notableDates: readonly FixtureNotable[];
  readonly arithmetic: FixtureArithmetic;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function attempt<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** All `cases` dates, ascending and de-duplicated. */
export function fixtureDates(): GregorianDate[] {
  const byIso = new Map<string, GregorianDate>();
  const add = (date: GregorianDate) => byIso.set(toISODate(date), date);
  for (const year of FULL_YEARS) {
    for (let doy = 1; doy <= daysInYear(year); doy++) add(gregorianFromDayOfYear(year, doy));
  }
  for (const year of BOUNDARY_YEARS) {
    for (const [month, day] of BOUNDARY_DAYS) {
      const date = { year, month, day };
      if (isValidGregorian(date)) add(date);
    }
  }
  return [...byIso.values()].sort(compareGregorian);
}

/** One `cases` entry for a date in a system. */
export function fixtureCase(date: GregorianDate, system: CalendarSystemId): FixtureCase {
  const c = compare(date, system);
  return {
    gregorian: toISODate(date),
    thirteen: c.thirteen,
    displayYear: thirteenDisplayYear(c.thirteen),
    dayOfYear: c.dayOfYear,
    isLeapYear: c.isLeapYear,
    gregorianWeekday: c.gregorianWeekday,
    thirteenWeekday: c.thirteenWeekday,
    weekdayShift: c.weekdayShift,
    labelDrift: c.labelDrift,
    formattedLong: formatThirteen(c.thirteen),
  };
}

function buildComparisons(): FixtureComparison[] {
  return COMPARISON_DATES.flatMap((iso) =>
    CALENDAR_SYSTEM_IDS.map((system) => {
      const date = parseISODate(iso);
      const c = compare(date, system);
      return { ...c, displayYear: thirteenDisplayYear(c.thirteen), daysUntilYearDay: daysUntilYearDay(date, system) };
    }),
  );
}

/** Format option bags: defaults, then per style: style only and every includeYear × includeWeekday. */
export function formatOptionSets(): FormatOptions[] {
  const sets: FormatOptions[] = [{}];
  for (const style of ['long', 'medium', 'short', 'numeric'] as const) {
    sets.push({ style });
    for (const includeYear of [false, true]) {
      for (const includeWeekday of [false, true]) sets.push({ style, includeYear, includeWeekday });
    }
  }
  return sets;
}

function buildFormats(): FixtureFormats {
  const options = formatOptionSets();
  const thirteenDates: ThirteenDate[] = [];
  for (const system of CALENDAR_SYSTEM_IDS) {
    for (let month = 1; month <= 13; month++) thirteenDates.push(createMonthDate(2026, month, month, system));
    thirteenDates.push(
      createMonthDate(1, 13, 28, system),
      createMonthDate(1788, 1, 1, system),
      createMonthDate(1789, 1, 1, system),
      createMonthDate(9999, 13, 28, system),
      createIntercalaryDate(1, 'year-day', system),
      createIntercalaryDate(1788, 'leap-day', system),
      createIntercalaryDate(2024, 'leap-day', system),
      createIntercalaryDate(2024, 'year-day', system),
      createIntercalaryDate(2026, 'year-day', system),
    );
  }
  const gregorianDates = [
    '0001-01-01',
    '0005-03-07',
    '1788-12-31',
    '2024-02-29',
    '2024-06-17',
    ...Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-${i + 11}`),
    '2026-10-19',
    '9999-12-31',
  ].map(parseISODate);
  return {
    options,
    thirteen: thirteenDates.map((date) => ({ date, outputs: options.map((o) => formatThirteen(date, o)) })),
    gregorian: gregorianDates.map((date) => ({ date, outputs: options.map((o) => formatGregorian(date, o)) })),
  };
}

const PARSE_TEXTS: Readonly<Record<CalendarSystemId, readonly string[]>> = {
  ifc: [
    '2026-M11-12',
    '2026-M07-01',
    '2026-YD',
    '2024-LD',
    '0001-M01-01',
    '9999-M13-28',
    '9999-YD',
    '2026-LD',
    '2026-11-12',
    '2026-M14-01',
    '2026-M00-01',
    '2026-M01-29',
    '2026-M01-00',
    '2026-M1-1',
    '26-M01-01',
    '0000-M01-01',
    '10000-M01-01',
    '+2026-M01-01',
    ' 2026-M01-01',
    '2026-M01-01 ',
    '2026-m01-01',
    '2026-yd',
    '2026-M11-12T00:00',
    '',
  ],
  positivist: [
    '0238-M11-12',
    '0238-YD',
    '0236-LD',
    '0237-LD',
    '0000-LD',
    '0000-M01-01',
    '-1787-M01-01',
    '-1787-YD',
    '8211-M13-28',
    '-0000-YD',
    '-1788-M13-28',
    '8212-M01-01',
    '2026-M11-12',
    '238-M11-12',
    '0238-11-12',
  ],
};

function buildParsing(): FixtureParse[] {
  return CALENDAR_SYSTEM_IDS.flatMap((system) =>
    PARSE_TEXTS[system].map((text) => ({ system, text, expected: tryParseThirteen(text, system) })),
  );
}

function buildThirteenYearLayouts(): FixtureThirteenYearLayout[] {
  return LAYOUT_YEARS.flatMap((year) =>
    CALENDAR_SYSTEM_IDS.map((system) => {
      const layout = buildThirteenYear(year, system);
      return {
        year,
        system,
        displayYear: layout.displayYear,
        isLeapYear: layout.isLeapYear,
        daysInYear: layout.daysInYear,
        weekdays: layout.weekdays,
        months: layout.months.map((m) => {
          const cells = m.weeks.flat();
          return {
            month: m.month,
            first: toISODate(cells[0]!.gregorian),
            last: toISODate(cells.at(-1)!.gregorian),
            gregorianMonthStarts: cells
              .filter((c) => c.isGregorianMonthStart)
              .map((c) => [c.thirteen.day, c.gregorian.month] as const),
          };
        }),
        intercalary: layout.intercalary.map((o) => ({
          id: o.id,
          afterMonth: o.afterMonth,
          gregorian: toISODate(o.gregorian),
          dayOfYear: o.dayOfYear,
          gregorianWeekday: o.gregorianWeekday,
        })),
      };
    }),
  );
}

function buildGregorianMonthLayouts(): FixtureGregorianMonthLayout[] {
  const out: FixtureGregorianMonthLayout[] = [];
  for (const year of LAYOUT_YEARS) {
    for (const system of CALENDAR_SYSTEM_IDS) {
      for (let month = 1; month <= 12; month++) {
        for (const weekStartsOn of [0, 1] as const) {
          const layout = buildGregorianMonth(year, month, system, { weekStartsOn });
          const cells = layout.weeks.flat().filter((c) => c !== null);
          out.push({
            year,
            month,
            system,
            weekStartsOn,
            leadingBlanks: layout.leadingBlanks,
            rows: layout.weeks.length,
            thirteenMonthStarts: cells.filter((c) => c.isThirteenMonthStart).map((c) => c.gregorian.day),
            intercalaryDays: cells.filter((c) => c.thirteen.kind === 'intercalary').map((c) => c.gregorian.day),
          });
        }
      }
    }
  }
  return out;
}

function buildSlots(): FixtureSlots[] {
  return LAYOUT_YEARS.flatMap((year) =>
    CALENDAR_SYSTEM_IDS.map((system) => ({
      year,
      system,
      slots: thirteenSlots(year, system).map((s) =>
        s.kind === 'month' ? { kind: 'month' as const, month: s.month } : { kind: 'intercalary' as const, id: s.id },
      ),
    })),
  );
}

const LOOKUP_GREGORIAN: readonly string[] = [
  '2024-02-29',
  '2024-06-17',
  '2024-12-31',
  '2026-01-01',
  '2026-02-28',
  '2026-06-28',
  '2026-07-04',
  '2026-10-12',
  '2026-10-19',
  '2026-10-31',
  '2026-12-25',
  '2026-12-31',
];

function buildLabelLookups(): FixtureFile['labelLookups'] {
  const thirteen: ThirteenDate[] = [
    createMonthDate(2026, 1, 1),
    createMonthDate(2026, 2, 28),
    createMonthDate(2026, 6, 28),
    createMonthDate(2026, 7, 1),
    createMonthDate(2026, 8, 4),
    createMonthDate(2026, 11, 12),
    createMonthDate(2026, 13, 28),
    createMonthDate(2024, 13, 28),
    createIntercalaryDate(2024, 'leap-day'),
    createIntercalaryDate(2026, 'year-day'),
    createMonthDate(2026, 11, 12, 'positivist'),
    createIntercalaryDate(2024, 'year-day', 'positivist'),
    createIntercalaryDate(2024, 'leap-day', 'positivist'),
  ];
  return {
    gregorian: LOOKUP_GREGORIAN.flatMap((iso) =>
      CALENDAR_SYSTEM_IDS.map((system) => ({ system, ...lookupGregorianLabel(parseISODate(iso), system) })),
    ),
    thirteen: thirteen.map((date) => lookupThirteenLabel(date)),
  };
}

function buildNotables(): FixtureNotable[] {
  return LAYOUT_YEARS.flatMap((year) =>
    CALENDAR_SYSTEM_IDS.map((system) => ({
      year,
      system,
      dates: notableDatesInYear(year, system).map((n) => ({
        id: n.notable.id,
        gregorian: n.gregorian,
        thirteen: n.thirteen,
        sameLabel: n.sameLabel,
      })),
    })),
  );
}

function buildArithmetic(): FixtureArithmetic {
  const ifc = (y: number, m: number, d: number) => createMonthDate(y, m, d, 'ifc');
  const pos = (y: number, m: number, d: number) => createMonthDate(y, m, d, 'positivist');
  const addDays: [ThirteenDate, number][] = [
    [ifc(2024, 6, 28), 1],
    [createIntercalaryDate(2024, 'leap-day'), 1],
    [createIntercalaryDate(2024, 'leap-day'), -1],
    [ifc(2026, 13, 28), 1],
    [createIntercalaryDate(2026, 'year-day'), 1],
    [ifc(2026, 1, 1), -1],
    [ifc(2026, 11, 12), 100],
    [ifc(2026, 11, 12), -365],
    [pos(2024, 13, 28), 1],
    [pos(2024, 13, 28), 2],
    [pos(2024, 13, 28), 3],
    [pos(2024, 6, 28), 1],
    [ifc(9999, 13, 28), 1],
    [createIntercalaryDate(9999, 'year-day'), 1],
    [ifc(1, 1, 1), -1],
    [ifc(1, 1, 1), 3652058],
  ];
  const addMonths: [ThirteenDate, number][] = [
    [ifc(2026, 13, 5), 1],
    [ifc(2027, 1, 5), -1],
    [ifc(2026, 7, 28), 13],
    [ifc(2026, 7, 28), -27],
    [pos(2026, 11, 12), 2],
    [ifc(2024, 6, 28), 1],
    [ifc(9999, 13, 1), 1],
    [ifc(1, 1, 1), -1],
    [createIntercalaryDate(2024, 'leap-day'), 1],
    [createIntercalaryDate(2026, 'year-day', 'positivist'), 0],
  ];
  const sameSlot: [ThirteenDate, number][] = [
    [createIntercalaryDate(2024, 'leap-day'), 2025],
    [createIntercalaryDate(2024, 'leap-day'), 2028],
    [createIntercalaryDate(2024, 'leap-day', 'positivist'), 2100],
    [createIntercalaryDate(2024, 'year-day', 'positivist'), 2026],
    [ifc(2024, 7, 1), 2026],
    [pos(2026, 11, 12), 1],
  ];
  return {
    addDays: addDays.map(([from, days]) => ({ from, days, expected: attempt(() => addThirteenDays(from, days)) })),
    addMonths: addMonths.map(([from, months]) => ({
      from,
      months,
      expected: attempt(() => addThirteenMonths(from, months)),
    })),
    sameSlotInYear: sameSlot.map(([from, year]) => ({ from, year, expected: sameSlotInYear(from, year) })),
  };
}

/** Builds the full fixture document. */
export function buildFixtures(): FixtureFile {
  const cases: FixtureCase[] = [];
  for (const date of fixtureDates()) {
    for (const system of CALENDAR_SYSTEM_IDS) cases.push(fixtureCase(date, system));
  }
  return {
    version: 2,
    generatedBy: '@thirteen/core',
    spec: 'docs/SPEC.md',
    systems: CALENDAR_SYSTEMS.map((s) => ({ ...s, displayYearRange: displayYearRange(s.id) })),
    gregorianCalendar: GREGORIAN_CALENDAR,
    cases,
    comparisons: buildComparisons(),
    formats: buildFormats(),
    numericParsing: buildParsing(),
    yearStats: STATS_YEARS.flatMap((year) => CALENDAR_SYSTEM_IDS.map((system) => yearStats(year, system))),
    monthAlignments: LAYOUT_YEARS.flatMap((year) => CALENDAR_SYSTEM_IDS.map((system) => monthAlignment(year, system))),
    thirteenYearLayouts: buildThirteenYearLayouts(),
    gregorianMonthLayouts: buildGregorianMonthLayouts(),
    slots: buildSlots(),
    labelLookups: buildLabelLookups(),
    notableDates: buildNotables(),
    arithmetic: buildArithmetic(),
  };
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/** Top-level keys in file order. */
export const FIXTURE_SECTIONS: readonly (keyof FixtureFile)[] = [
  'version',
  'generatedBy',
  'spec',
  'systems',
  'gregorianCalendar',
  'cases',
  'comparisons',
  'formats',
  'numericParsing',
  'yearStats',
  'monthAlignments',
  'thirteenYearLayouts',
  'gregorianMonthLayouts',
  'slots',
  'labelLookups',
  'notableDates',
  'arithmetic',
];

/**
 * Pretty-prints the envelope and the objects directly inside it; every array
 * element at those levels goes on its own line as compact JSON. Keeps the file
 * small, line-oriented for diffs, and byte-for-byte deterministic.
 */
function render(value: unknown, indent: string, depth: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = `${indent}  `;
    return `[\n${value.map((item) => `${inner}${JSON.stringify(item)}`).join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object' && value !== null && depth < 2) {
    const inner = `${indent}  `;
    const entries = Object.entries(value).map(
      ([key, child]) => `${inner}${JSON.stringify(key)}: ${render(child, inner, depth + 1)}`,
    );
    return `{\n${entries.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** Deterministic JSON text of the fixture file (ends with a newline). */
export function serializeFixtures(file: FixtureFile): string {
  const ordered = Object.fromEntries(FIXTURE_SECTIONS.map((key) => [key, file[key]]));
  return `${render(ordered, '', 0)}\n`;
}
