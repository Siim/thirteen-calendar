/**
 * The public surface of `@thirteen/core` and `@thirteen/core/ics` (task C9,
 * docs/EVENTS.md §5.1, §5.2, §5.4):
 *
 * - the events engine is exported from `@thirteen/core` with exactly the
 *   types and functions §3.1 and §5.2 declare, and its shared helpers stay
 *   internal;
 * - the `.ics` module is a separate entry point, `@thirteen/core/ics`, with
 *   every type and function §5.4 declares;
 * - packages/core/API.md documents every export of both, in its Calendar,
 *   Events and ICS sections;
 * - the exported events functions follow SPEC §4.1 as §5.2 requires: their
 *   results never alias an input, and repeated calls share no mutable data.
 *
 * The normative lists are read from docs/EVENTS.md itself, so a function the
 * spec adds or renames fails here until the code follows (or the spec is
 * changed back on purpose, EVENTS.md status line).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.ts';
import * as events from '../src/events/index.ts';
import * as ics from '../src/ics/index.ts';

const SRC = new URL('../src/', import.meta.url);
const read = (url: URL): string => readFileSync(url, 'utf8');

// ---------------------------------------------------------------------------
// Export lists from source text (types are erased at run time)
// ---------------------------------------------------------------------------

interface Names {
  readonly types: Set<string>;
  readonly values: Set<string>;
}

/** The names a module re-exports through `export { ... } from` and `export type { ... } from` blocks. */
function reExports(source: string): Names {
  const types = new Set<string>();
  const values = new Set<string>();
  for (const block of source.matchAll(/^export\s+(type\s+)?\{([^}]*)\}\s*from\s*'[^']+';/gm)) {
    const allTypes = block[1] !== undefined;
    const body = block[2]!.replace(/\/\/[^\n]*/g, '');
    for (const raw of body.split(',')) {
      const item = raw.trim();
      if (item === '') continue;
      const typeOnly = /^type\s+/.test(item);
      const name = item.replace(/^type\s+/, '');
      expect(name, `export list item ${JSON.stringify(item)}`).toMatch(/^[A-Za-z_$][\w$]*$/);
      (allTypes || typeOnly ? types : values).add(name);
    }
  }
  return { types, values };
}

/** The names declared with `export function | interface | type` in the code blocks of a part of a Markdown text. */
function declaredIn(markdown: string): Names {
  const types = new Set<string>();
  const values = new Set<string>();
  for (const block of markdown.matchAll(/```ts\n([\s\S]*?)```/g)) {
    for (const m of block[1]!.matchAll(/^export\s+(function|interface|type)\s+([A-Za-z_$][\w$]*)/gm)) {
      (m[1] === 'function' ? values : types).add(m[2]!);
    }
  }
  return { types, values };
}

/** The text of `markdown` from the line that starts with `from` up to the line that starts with `to` (exclusive). */
function between(markdown: string, from: string, to: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith(from));
  const end = lines.findIndex((line, i) => i > start && line.startsWith(to));
  expect(start, `heading ${from}`).toBeGreaterThanOrEqual(0);
  expect(end, `heading ${to}`).toBeGreaterThan(start);
  return lines.slice(start, end).join('\n');
}

const sorted = (names: Iterable<string>): string[] => [...names].sort();

const SPEC = read(new URL('../../../docs/EVENTS.md', import.meta.url));
/** §3.1 (the core types) and §5.2 (the normative API). */
const SPEC_EVENTS = (() => {
  const a = declaredIn(between(SPEC, '### 3.1 Core types', '#### 3.1.1'));
  const b = declaredIn(between(SPEC, '### 5.2 API', '### 5.3'));
  return { types: new Set([...a.types, ...b.types]), values: new Set([...a.values, ...b.values]) };
})();
/** §5.4 (the `.ics` module). */
const SPEC_ICS = declaredIn(between(SPEC, '### 5.4 ', '### 5.5 '));

/** Types the events module exports beyond §3.1 and §5.2: the name of `formatDateList`'s form union. */
const EXTRA_EVENT_TYPES = ['DateListForm'];

const CORE_SOURCE = reExports(read(new URL('index.ts', SRC)));
const EVENTS_SOURCE = reExports(read(new URL('events/index.ts', SRC)));
const ICS_SOURCE = reExports(read(new URL('ics/index.ts', SRC)));

/** Every `.ts` file of a folder of `src` except its index, as `[name, path]`. */
function moduleFiles(folder: string): [string, string][] {
  const dir = new URL(`${folder}/`, SRC);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .sort()
    .map((name) => [name, fileURLToPath(new URL(name, dir))]);
}

// ---------------------------------------------------------------------------
// @thirteen/core: events
// ---------------------------------------------------------------------------

describe('@thirteen/core exports the events engine (§5.2)', () => {
  it('reads a plausible API from docs/EVENTS.md', () => {
    // Guards the parsing above: a few names from each part of §3.1 and §5.2.
    for (const name of ['EventDraft', 'CalendarEvent', 'ZoneResolver', 'RRule', 'ThirteenRule', 'EventRecurrence', 'SeriesInput', 'MonthItem', 'YearMark']) {
      expect(SPEC_EVENTS.types.has(name), name).toBe(true);
    }
    for (const name of ['zonedToUtc', 'applyToSeries', 'formatUntil', 'parseDateList', 'thirteenRuleRdateParts', 'recognizeRecurrence', 'expandSeries', 'yearEventMarks']) {
      expect(SPEC_EVENTS.values.has(name), name).toBe(true);
    }
    // v3.2 declares 65 functions and 56 types; a parse that misses a code block falls far below.
    expect(SPEC_EVENTS.values.size).toBeGreaterThanOrEqual(60);
    expect(SPEC_EVENTS.types.size).toBeGreaterThanOrEqual(50);
  });

  it('has every function of §5.2', () => {
    const missing = sorted(SPEC_EVENTS.values).filter((name) => typeof (core as Record<string, unknown>)[name] !== 'function');
    expect(missing).toEqual([]);
  });

  it('has every type of §3.1 and §5.2', () => {
    expect(sorted(SPEC_EVENTS.types).filter((name) => !CORE_SOURCE.types.has(name))).toEqual([]);
  });

  it('exports exactly the §5.2 surface from src/events (plus DateListForm)', () => {
    expect(sorted(EVENTS_SOURCE.values)).toEqual(sorted(SPEC_EVENTS.values));
    expect(sorted(Object.keys(events))).toEqual(sorted(SPEC_EVENTS.values));
    expect(sorted(EVENTS_SOURCE.types)).toEqual(sorted([...SPEC_EVENTS.types, ...EXTRA_EVENT_TYPES]));
  });

  it('re-exports src/events unchanged, with the same functions and types', () => {
    for (const [name, value] of Object.entries(events)) {
      expect((core as Record<string, unknown>)[name], name).toBe(value);
    }
    expect(sorted(EVENTS_SOURCE.types).filter((name) => !CORE_SOURCE.types.has(name))).toEqual([]);
  });

  it.each(moduleFiles('events'))('keeps the shared helpers of events/%s internal', async (_name, path) => {
    const module = (await import(path)) as Record<string, unknown>;
    const internal = Object.keys(module).filter((key) => !(key in events));
    for (const key of internal) {
      expect(core, key).not.toHaveProperty(key);
      expect(ics, key).not.toHaveProperty(key);
    }
  });

  it('does not export the .ics module from the main entry point', () => {
    for (const key of Object.keys(ics)) expect(core, key).not.toHaveProperty(key);
    expect(read(new URL('index.ts', SRC))).not.toMatch(/from '\.\/ics\//);
  });
});

// ---------------------------------------------------------------------------
// @thirteen/core/ics
// ---------------------------------------------------------------------------

describe('@thirteen/core/ics (§5.4)', () => {
  it("is the package's ./ics entry point", async () => {
    const pkg = JSON.parse(read(new URL('../package.json', import.meta.url)));
    expect(pkg.exports['./ics']).toBe('./src/ics/index.ts');
    const byName = await import('@thirteen/core/ics');
    expect(sorted(Object.keys(byName))).toEqual(sorted(Object.keys(ics)));
    expect(byName.parseICalendar).toBe(ics.parseICalendar);
  });

  it('reads a plausible API from docs/EVENTS.md', () => {
    for (const name of ['IcsDateValue', 'IcsEvent', 'IcsGroup', 'IcsCalendar', 'IcsWarning', 'IcsTimeZone']) {
      expect(SPEC_ICS.types.has(name), name).toBe(true);
    }
    expect(SPEC_ICS.values.size).toBeGreaterThanOrEqual(10);
  });

  it('has every function and type of §5.4', () => {
    const missing = sorted(SPEC_ICS.values).filter((name) => typeof (ics as Record<string, unknown>)[name] !== 'function');
    expect(missing).toEqual([]);
    expect(sorted(SPEC_ICS.types).filter((name) => !ICS_SOURCE.types.has(name))).toEqual([]);
    // Named in §5.4 signatures without a declaration there.
    for (const name of ['ZoneHandle', 'IcsObservance', 'IcsExpandedEvent']) expect(ICS_SOURCE.types.has(name), name).toBe(true);
  });

  it('lists in its index exactly what it exports at run time', () => {
    expect(sorted(Object.keys(ics))).toEqual(sorted(ICS_SOURCE.values));
  });

  it('exposes only functions and constants', () => {
    for (const [name, value] of Object.entries(ics)) {
      if (typeof value === 'object' && value !== null) expect(Object.isFrozen(value), name).toBe(true);
      else expect(['function', 'string'], name).toContain(typeof value);
    }
  });

  it.each(moduleFiles('ics'))('keeps the helpers of ics/%s internal', async (_name, path) => {
    const module = (await import(path)) as Record<string, unknown>;
    for (const key of Object.keys(module).filter((key) => !(key in ics))) {
      expect(ICS_SOURCE.values.has(key), key).toBe(false);
      expect(core, key).not.toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// API.md
// ---------------------------------------------------------------------------

describe('packages/core/API.md', () => {
  const api = read(new URL('../API.md', import.meta.url));
  /** The text inside the backticks of a section: where API.md names things. */
  const codeOf = (section: string): string => [...section.matchAll(/`([^`]*)`/g)].map((m) => m[1]).join('\n');
  const documents = (code: string, name: string): boolean => new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(code);

  const calendarDoc = between(api, '## Calendar', '## Events');
  const eventsDoc = between(api, '## Events', '## ICS');
  const icsDoc = api.slice(api.indexOf('\n## ICS'));

  it('has the Calendar, Events and ICS sections, in that order, and names both entry points', () => {
    const headings = api.split('\n').filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## Calendar', '## Events', '## ICS']);
    expect(api).toContain('`@thirteen/core/ics`');
  });

  it('documents every export of the calendar engine under Calendar', () => {
    const code = codeOf(calendarDoc);
    const names = [...CORE_SOURCE.values, ...CORE_SOURCE.types].filter((name) => !EVENTS_SOURCE.values.has(name) && !EVENTS_SOURCE.types.has(name));
    expect(names.length).toBeGreaterThan(100);
    expect(sorted(names).filter((name) => !documents(code, name))).toEqual([]);
  });

  it('documents every export of the events engine under Events', () => {
    const code = codeOf(eventsDoc);
    expect(sorted([...EVENTS_SOURCE.values, ...EVENTS_SOURCE.types]).filter((name) => !documents(code, name))).toEqual([]);
  });

  it('documents every export of @thirteen/core/ics under ICS', () => {
    const code = codeOf(icsDoc);
    expect(sorted([...ICS_SOURCE.values, ...ICS_SOURCE.types]).filter((name) => !documents(code, name))).toEqual([]);
  });

  it('writes the events sections without em or en dashes', () => {
    expect(eventsDoc + icsDoc).not.toMatch(/[–—]/);
  });
});

// ---------------------------------------------------------------------------
// Fresh results (SPEC §4.1, EVENTS.md §5.2)
// ---------------------------------------------------------------------------

/** Every object reachable from `value` (including itself). */
function objectsIn(value: unknown, seen = new Set<object>()): Set<object> {
  if (typeof value === 'object' && value !== null && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) objectsIn(child, seen);
  }
  return seen;
}

describe('events results are fresh data', () => {
  const zones: core.ZoneResolver = {
    isKnown: (zone) => zone === 'UTC' || zone === 'Etc/Plus2',
    offsetMinutesAt: (zone) => (zone === 'Etc/Plus2' ? 120 : 0),
  };
  const date = (year: number, month: number, day: number) => ({ year, month, day });
  const at = (year: number, month: number, day: number, minute: number) => ({ date: date(year, month, day), minute });
  const weekly = (): core.EventRecurrence => ({
    rule: { kind: 'rrule', rrule: core.parseRRule('FREQ=WEEKLY') },
    end: { kind: 'count', count: 10 },
    extraDates: [{ date: date(2026, 12, 1), minute: 900, durationMinutes: 30 }],
    exceptDates: [{ date: date(2026, 11, 2), minute: null }],
  });
  const ifcMonthly = (): core.EventRecurrence => ({
    rule: { kind: 'thirteen', rule: { kind: 'monthly', system: 'ifc', day: 12 } },
    end: { kind: 'never' },
    extraDates: [],
    exceptDates: [],
  });
  const draft = (): core.EventDraft => ({
    title: 'Book club',
    location: '',
    notes: '',
    url: '',
    allDay: false,
    start: at(2026, 10, 19, 1140),
    end: at(2026, 10, 19, 1260),
    timeZone: 'Etc/Plus2',
    calendarId: 'home',
    recurrence: weekly(),
    alarms: [{ kind: 'relative', offsetMinutes: -60 }],
    availability: 'busy',
  });
  const calendarInfo = (): core.CalendarInfo => ({
    id: 'home',
    title: 'Home',
    color: '#ea580c',
    accountId: 'icloud',
    accountTitle: 'iCloud',
    accountKind: 'icloud',
    writable: true,
    thirteenRepeats: 'all',
    maxAlarms: null,
    supportsAvailability: true,
    supportsUrl: true,
    isPlatformDefault: true,
  });
  const occurrences = (): core.EventOccurrence[] => [
    { key: 'a', calendarId: 'home', title: 'A', allDay: false, start: at(2026, 10, 19, 600), end: at(2026, 10, 19, 660) },
    { key: 'b', calendarId: 'work', title: 'B', allDay: true, start: at(2026, 10, 19, 0), end: at(2026, 10, 21, 1440) },
    { key: 'c', calendarId: 'home', title: 'C', allDay: false, start: at(2026, 10, 19, 630), end: at(2026, 10, 20, 90) },
  ];
  const rule = (): core.ThirteenRule => ({ kind: 'monthly', system: 'ifc', day: 12 });
  const overrideDates = (): core.OriginalDate[] => [
    { date: date(2026, 11, 16), minute: null },
    { date: date(2026, 12, 1), minute: 900 },
  ];
  const series = (): core.SeriesInput => ({
    id: 'series',
    recurrence: weekly(),
    allDay: false,
    start: at(2026, 10, 19, 600),
    end: at(2026, 10, 19, 660),
    zone: 'Etc/Plus2',
    overrides: [
      {
        id: 'moved',
        originalDate: date(2026, 10, 26),
        originalMinute: null,
        canceled: false,
        allDay: false,
        start: at(2026, 10, 27, 700),
        end: at(2026, 10, 27, 760),
        zone: 'Etc/Plus2',
      },
    ],
  });

  /** Functions with object inputs: the result shares no object with them. */
  const withObjectInputs: [string, (...args: never[]) => unknown, () => unknown[]][] = [
    ['localDateTime', core.localDateTime as never, () => [date(2026, 10, 19), 600]],
    ['addMinutesLocal', core.addMinutesLocal as never, () => [at(2026, 10, 19, 600), 0]],
    ['normalizeEventEnd', core.normalizeEventEnd as never, () => [at(2026, 10, 19, 600), at(2026, 10, 19, 660)]],
    ['displayEnd', core.displayEnd as never, () => [at(2026, 10, 19, 660)]],
    ['occurrenceDays', core.occurrenceDays as never, () => [at(2026, 10, 19, 600), at(2026, 10, 19, 660)]],
    ['zonedToUtc', core.zonedToUtc as never, () => [at(2026, 10, 19, 600), 'UTC', zones]],
    ['utcToZoned', core.utcToZoned as never, () => [at(2026, 10, 19, 600), 'UTC', zones]],
    ['validateDraft', core.validateDraft as never, () => [draft(), calendarInfo()]],
    ['newEventDraft', core.newEventDraft as never, () => [date(2026, 10, 20), at(2026, 10, 19, 600), 'home']],
    ['moveDraftStart', core.moveDraftStart as never, () => [draft(), at(2026, 10, 19, 1140)]],
    ['setDraftAllDay', core.setDraftAllDay as never, () => [draft(), false]],
    ['changedFields', core.changedFields as never, () => [draft(), draft()]],
    ['mergeDraft', core.mergeDraft as never, () => [draft(), draft(), draft()]],
    ['applyToSeries', core.applyToSeries as never, () => [draft(), draft(), draft(), draft()]],
    [
      'alarmFireTime',
      core.alarmFireTime as never,
      () => [{ kind: 'absolute', at: at(2026, 10, 19, 600) }, { allDay: false, start: at(2026, 10, 19, 600), startUtc: at(2026, 10, 19, 480) }, 'Etc/Plus2', zones],
    ],
    ['untilInZone', core.untilInZone as never, () => [{ kind: 'floating', value: at(2026, 11, 16, 1139) }, null, zones]],
    ['untilEndDate', core.untilEndDate as never, () => [at(2026, 11, 16, 1139), 1140]],
    ['thirteenRuleFor', core.thirteenRuleFor as never, () => ['monthly', date(2026, 10, 19)]],
    ['thirteenRuleDatesInYear', core.thirteenRuleDatesInYear as never, () => [rule(), 2026, date(2026, 1, 12)]],
    ['encodeThirteenRule', core.encodeThirteenRule as never, () => [rule(), date(2026, 1, 12)]],
    ['thirteenRuleRdates', core.thirteenRuleRdates as never, () => [rule(), date(2026, 1, 12), { kind: 'never' }, date(2027, 1, 1)]],
    ['thirteenRuleRdateParts', core.thirteenRuleRdateParts as never, () => [rule(), date(2026, 1, 12), { kind: 'never' }, date(2027, 1, 1)]],
    ['expandRecurrence', core.expandRecurrence as never, () => [weekly(), date(2026, 10, 19), { from: date(2026, 10, 19), to: date(2026, 12, 31) }]],
    ['nextOccurrences', core.nextOccurrences as never, () => [weekly(), date(2026, 10, 19), 3]],
    ['endRecurrenceBefore', core.endRecurrenceBefore as never, () => [weekly(), date(2026, 10, 19), date(2026, 11, 30)]],
    ['splitRecurrence', core.splitRecurrence as never, () => [weekly(), date(2026, 10, 19), date(2026, 11, 9), overrideDates()]],
    ['retimeExceptions', core.retimeExceptions as never, () => [weekly(), overrideDates(), date(2026, 10, 19), date(2026, 10, 19), weekly(), { minuteDelta: 30 }]],
    ['recurrenceToRRule', core.recurrenceToRRule as never, () => [weekly(), date(2026, 10, 19)]],
    ['repeatPresets', core.repeatPresets as never, () => [date(2026, 10, 19)]],
    ['describeRepeatNotes', core.describeRepeatNotes as never, () => [weekly(), date(2026, 10, 19)]],
    ['adaptRecurrenceToStart', core.adaptRecurrenceToStart as never, () => [ifcMonthly(), date(2026, 10, 19), date(2026, 10, 20)]],
    [
      'recognizeRecurrence',
      core.recognizeRecurrence as never,
      () => [
        {
          start: at(2026, 10, 19, 600),
          rrules: [{ rrule: core.parseRRule('FREQ=WEEKLY'), until: null }],
          exrules: [],
          rdates: [{ date: date(2026, 12, 1), minute: null, durationMinutes: null }],
          exdates: [{ date: date(2026, 11, 2), minute: null }],
          marker: null,
        },
      ],
    ],
    ['expandSeries', core.expandSeries as never, () => [series(), { from: at(2026, 10, 1, 0), to: at(2026, 12, 31, 1440) }, 'Etc/Plus2', zones]],
    ['layoutThirteenMonthEvents', core.layoutThirteenMonthEvents as never, () => [2026, 11, occurrences()]],
    ['layoutThirteenWeekEvents', core.layoutThirteenWeekEvents as never, () => [2026, 11, 2, occurrences()]],
    ['layoutDayEvents', core.layoutDayEvents as never, () => [date(2026, 10, 19), occurrences()]],
    ['agenda', core.agenda as never, () => [occurrences(), date(2026, 10, 19), date(2026, 10, 25)]],
    ['yearEventMarks', core.yearEventMarks as never, () => [2026, occurrences()]],
  ];

  /** Functions with only primitive inputs: two calls share no mutable object. */
  const withPrimitiveInputs: [string, () => unknown][] = [
    ['parseLocalDateTime', () => core.parseLocalDateTime('2026-10-19T09:30')],
    ['tryParseLocalDateTime', () => core.tryParseLocalDateTime('2026-10-19T24:00')],
    ['parseRRule', () => core.parseRRule('FREQ=MONTHLY;BYDAY=2TU;UNTIL=20261231T120000Z;X-NAME=1')],
    ['tryParseRRule', () => core.tryParseRRule('FREQ=YEARLY;BYYEARDAY=12,40')],
    ['parseDateList', () => core.parseDateList('Europe/Tallinn;20261116T190000,20261214T170000Z')],
    ['parseThirteenRuleText', () => core.parseThirteenRuleText('SYSTEM=ifc;KIND=weekly;WEEKDAY=TH;INTERVAL=2')],
    ['parseThirteenRuleUri', () => core.parseThirteenRuleUri('thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=until:2027-06-30')],
    ['parseDetachedUri', () => core.parseDetachedUri('thirteen://detached?v=1&series=abc&original=2026-10-19')],
    ['alarmPresets', () => core.alarmPresets(true)],
    ['monthColumnGregorianWeekdays', () => core.monthColumnGregorianWeekdays(2026, 11)],
  ];

  /** Functions whose results are strings, numbers, booleans or null: nothing to alias. */
  const primitiveResults = [
    'compareLocalDateTime',
    'describeAlarm',
    'describeNextOccurrences',
    'describeRecurrence',
    'diffMinutesLocal',
    'formatChipTime',
    'formatDateList',
    'formatDetachedUri',
    'formatLocalDateTime',
    'formatRRule',
    'formatThirteenRuleText',
    'formatThirteenRuleUri',
    'formatUntil',
    'laterOccurrenceCount',
    'matchRepeatPreset',
    'rruleEquals',
    'thirteenRuleIncludes',
  ];

  it.each(withObjectInputs)('%s never aliases an input', (_name, fn, makeArgs) => {
    const args = makeArgs();
    const inputs = objectsIn(args);
    inputs.delete(args);
    const result = fn(...(args as never[]));
    expect(result).toBeTypeOf('object');
    expect([...objectsIn(result)].filter((o) => inputs.has(o))).toEqual([]);
  });

  it.each(withPrimitiveInputs)('%s returns fresh data on every call', (_name, call) => {
    const first = objectsIn(call());
    expect(first.size).toBeGreaterThan(0);
    expect([...objectsIn(call())].filter((o) => first.has(o) && !Object.isFrozen(o))).toEqual([]);
  });

  it('covers every exported events function in one of the tables above', () => {
    // If a new function is exported from src/events, add it to one of them.
    const covered = [...withObjectInputs.map(([name]) => name), ...withPrimitiveInputs.map(([name]) => name), ...primitiveResults];
    expect(new Set(covered).size).toBe(covered.length);
    expect(sorted(covered)).toEqual(sorted(Object.keys(events)));
  });
});
