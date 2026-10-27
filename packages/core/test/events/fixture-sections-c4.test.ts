/**
 * The C4 sections of fixtures/events.json (docs/EVENTS.md §5.5), built by
 * scripts/recurrence-fixtures.ts for task C6 to write: determinism, shapes,
 * exact counts, the cases and values the spec lists, a replay of every case
 * from its JSON (as a port reads it), `ical.js` on every Gregorian
 * `expansions` case and the engine's own 13-month dates on every 13-month one.
 */
import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import {
  type RecurrenceJson,
  alarmFromJson,
  dateFromJson,
  extraDateFromJson,
  extraDateJson,
  localFromJson,
  originalDateFromJson,
  recurrenceFromJson,
  recurrenceJson,
} from '../../scripts/events-fixtures.ts';
import {
  C4_SECTIONS,
  C4_ZONE_SECTIONS,
  type ExpansionCase,
  PRESET_STARTS,
  THIRTEEN_WINDOWS,
  exceptionMapJson,
  expandedOccurrenceJson,
  expansionRows,
  presetJson,
  recognitionInputFromJson,
  recognitionJson,
  seriesInputFromJson,
  splitResultJson,
  untilRewriteJson,
} from '../../scripts/recurrence-fixtures.ts';
import { intlZoneResolver } from '../../scripts/zone-resolvers.ts';
import { alarmFireTime, formatLocalDateTime } from '../../src/events/index.ts';
import { expandSeries } from '../../src/events/occurrences.ts';
import {
  type EventRecurrence,
  type RepeatEnd,
  adaptRecurrenceToStart,
  describeNextOccurrences,
  describeRecurrence,
  describeRepeatNotes,
  endRecurrenceBefore,
  expandRecurrence,
  laterOccurrenceCount,
  recognizeRecurrence,
  repeatPresets,
  retimeExceptions,
  splitRecurrence,
} from '../../src/events/recurrence.ts';
import { formatRRule } from '../../src/events/rrule.ts';
import { thirteenRuleDatesInYear } from '../../src/events/thirteen-rules.ts';
import { type GregorianDate, compareGregorian, toISODate, toJulianDayNumber } from '../../src/index.ts';

const zones = intlZoneResolver();
const sections = Object.fromEntries(Object.entries(C4_SECTIONS).map(([name, build]) => [name, build()])) as {
  [K in keyof typeof C4_SECTIONS]: ReturnType<(typeof C4_SECTIONS)[K]>;
};
const zoneSections = {
  series: C4_ZONE_SECTIONS.series(zones),
  alarmInstants: C4_ZONE_SECTIONS.alarmInstants(zones),
};
/** Each section as a port reads it: through JSON text. */
const json = JSON.parse(JSON.stringify(sections)) as typeof sections;
const zoneJson = JSON.parse(JSON.stringify(zoneSections)) as typeof zoneSections;
const D = dateFromJson;
const rows = expansionRows();
const expansion = (name: string): ExpansionCase => {
  const index = rows.findIndex((row) => row.name === name);
  if (index < 0) throw new Error(`No expansions row ${name}`);
  return sections.expansions[index]!;
};
/** An expansion's occurrences as `date` or `date@minute` keys. */
const keys = (c: ExpansionCase): string[] =>
  c.occurrences.map((o) => (typeof o === 'string' ? o : o.minute === null ? o.date : `${o.date}@${o.minute}`));
const ruleText = (r: RecurrenceJson) => (r.rule.kind === 'rrule' ? r.rule.rrule : r.rule.kind);

describe('C4 fixture sections', () => {
  it('are listed in publication order (§6.0)', () => {
    expect(Object.keys(C4_SECTIONS)).toEqual([
      'expansions',
      'endBefore',
      'splits',
      'retimes',
      'recognitions',
      'presets',
      'descriptions',
      'nextOccurrences',
      'repeatNotes',
      'adaptations',
    ]);
    expect(Object.keys(C4_ZONE_SECTIONS)).toEqual(['series', 'alarmInstants']);
  });

  it('are deterministic and plain JSON', () => {
    for (const [name, build] of Object.entries(C4_SECTIONS)) {
      expect(JSON.stringify(build()), name).toBe(JSON.stringify(sections[name as keyof typeof sections]));
    }
    expect(JSON.stringify(C4_ZONE_SECTIONS.series(zones))).toBe(JSON.stringify(zoneSections.series));
    expect(JSON.stringify(C4_ZONE_SECTIONS.alarmInstants())).toBe(JSON.stringify(zoneSections.alarmInstants));
    expect(json).toEqual(sections);
    expect(zoneJson).toEqual(zoneSections);
  });

  it('have exact case counts (C6 writes them to `counts`) and a bounded size', () => {
    const counts = Object.fromEntries(Object.entries({ ...sections, ...zoneSections }).map(([name, cases]) => [name, cases.length]));
    expect(counts).toEqual({
      expansions: 135,
      endBefore: 20,
      splits: 20,
      retimes: 20,
      recognitions: 55,
      presets: 16,
      descriptions: 55,
      nextOccurrences: 23,
      repeatNotes: 23,
      adaptations: 23,
      series: 38,
      alarmInstants: 15,
    });
    // One compact case per line (§5.5); see the size note in the C4 report.
    const size = Object.values({ ...sections, ...zoneSections }).reduce((n, cases) => n + cases.reduce((m, c) => m + JSON.stringify(c).length + 6, 0), 0);
    expect(size).toBeLessThan(240_000);
  });

  it('use the documented field names in order', () => {
    const keysOf = (value: object) => Object.keys(value);
    const recurrenceKeys = ['rule', 'end', 'extraDates', 'exceptDates'];
    for (const c of sections.expansions) {
      expect(keysOf(c)).toEqual(['recurrence', 'start', 'window', 'limit', 'occurrences', 'truncated', 'unsupported']);
      expect(keysOf(c.recurrence)).toEqual(recurrenceKeys);
      expect(keysOf(c.window)).toEqual(['from', 'to']);
      for (const o of c.occurrences) if (typeof o !== 'string') expect(keysOf(o)).toEqual(['date', 'minute', 'durationMinutes']);
    }
    for (const c of sections.endBefore) expect(keysOf(c)).toEqual(['recurrence', 'start', 'date', 'expected', 'later']);
    for (const c of sections.splits) {
      expect(keysOf(c)).toEqual(['recurrence', 'start', 'at', 'overrideDates', 'change', 'expected']);
      if (c.change !== null) expect(keysOf(c.change)).toEqual(['recurrence', 'start', 'ruleChanged']);
      if (c.expected !== null) {
        expect(keysOf(c.expected)).toEqual(['head', 'tail', 'overrides', 'droppedCount', 'dropped']);
        for (const m of c.expected.overrides) expect(keysOf(m)).toEqual(['from', 'to']);
      }
    }
    for (const c of sections.retimes) {
      expect(keysOf(c)).toEqual(['recurrence', 'overrideDates', 'oldStart', 'newStart', 'newRecurrence', 'minuteDelta', 'allDay', 'expected']);
      expect(keysOf(c.expected)).toEqual(['recurrence', 'overrides', 'untils', 'droppedCount', 'dropped']);
      for (const u of c.expected.untils) expect(keysOf(u)).toEqual(['rule', 'index', 'endDate']);
    }
    for (const c of sections.recognitions) {
      expect(keysOf(c)).toEqual(['input', 'system', 'expected']);
      expect(keysOf(c.input)).toEqual(['start', 'rrules', 'exrules', 'rdates', 'exdates', 'marker']);
      for (const r of [...c.input.rrules, ...c.input.exrules]) expect(keysOf(r)).toEqual(['rrule', 'until']);
      expect(keysOf(c.expected)).toEqual(['recurrence', 'source', 'editable', 'alternatives', 'openEnded', 'series', 'part']);
    }
    for (const c of sections.presets) {
      expect(keysOf(c)).toEqual(['start', 'system', 'presets']);
      for (const p of c.presets) expect(keysOf(p)).toEqual(['id', 'section', 'label', 'exchangeSafe', 'recurrence']);
    }
    for (const c of sections.descriptions) expect(keysOf(c)).toEqual(['recurrence', 'start', 'system', 'text']);
    for (const c of sections.nextOccurrences) expect(keysOf(c)).toEqual(['recurrence', 'start', 'system', 'count', 'text']);
    for (const c of sections.repeatNotes) expect(keysOf(c)).toEqual(['recurrence', 'start', 'system', 'gregorianOnlyCalendar', 'notes']);
    for (const c of sections.adaptations) {
      expect(keysOf(c)).toEqual(['recurrence', 'oldStart', 'newStart', 'expected']);
      expect(keysOf(c.expected)).toEqual(['recurrence', 'change', 'laterCount']);
    }
    for (const c of zoneSections.series) {
      expect(keysOf(c)).toEqual(['series', 'window', 'deviceZone', 'expected']);
      expect(keysOf(c.series)).toEqual(['id', 'recurrence', 'allDay', 'start', 'end', 'zone', 'overrides', 'duration']);
      for (const o of c.series.overrides) expect(keysOf(o)).toEqual(['id', 'originalDate', 'originalMinute', 'canceled', 'allDay', 'start', 'end', 'zone']);
      expect(keysOf(c.expected)).toEqual(['occurrences', 'orphans', 'outOfRange']);
      for (const o of c.expected.occurrences) expect(keysOf(o)).toEqual(['originalDate', 'originalMinute', 'overrideId', 'allDay', 'start', 'end', 'startUtc']);
    }
    for (const c of zoneSections.alarmInstants) {
      expect(keysOf(c)).toEqual(['alarm', 'occurrence', 'deviceZone', 'expected']);
      expect(keysOf(c.occurrence)).toEqual(['allDay', 'start', 'startUtc']);
    }
  });

  it('write user-visible text without em or en dashes', () => {
    const texts = [
      ...sections.descriptions.map((c) => c.text),
      ...sections.nextOccurrences.map((c) => c.text),
      ...sections.repeatNotes.flatMap((c) => c.notes),
      ...sections.presets.flatMap((c) => c.presets.map((p) => p.label)),
    ];
    expect(texts.length).toBeGreaterThan(200);
    for (const text of texts) expect(text, text).not.toMatch(/[–—]/);
  });
});

describe('C4 sections cover the §5.5 case lists', () => {
  it('expansions: every thirteenRules case over a window with occurrences, the later windows, and the Gregorian rows', () => {
    const thirteen = sections.expansions.filter((_, i) => rows[i]!.name.startsWith('thirteen '));
    expect(thirteen).toHaveLength(91);
    for (const c of thirteen) {
      // The first of the three windows with an occurrence, else the years of the series itself.
      const window = THIRTEEN_WINDOWS.find(([from, to]) =>
        expandRecurrence(recurrenceFromJson(c.recurrence), D(c.start), { from: D(from), to: D(to) }).occurrences.length > 0,
      );
      if (window !== undefined) expect([c.window.from, c.window.to]).toEqual(window);
      else expect(c.window.from).toBe(`${c.start.slice(0, 4)}-01-01`);
      expect(c.occurrences.length, c.start).toBeGreaterThan(0);
    }
    for (const [from] of THIRTEEN_WINDOWS) expect(thirteen.some((c) => c.window.from === from), from).toBe(true);
    // Every fourth case excludes its first date after the start, also where a count still counts it.
    expect(thirteen.filter((c) => c.recurrence.exceptDates.length > 0).every((c) => !keys(c).includes(c.recurrence.exceptDates[0] as string))).toBe(true);
    // Weekly and yearly rules through the 2100 window and the last two years; leap-only repeats stop at the cap.
    expect(keys(expansion('late IFC weekly Thursday'))).toHaveLength(3 * 52);
    expect(keys(expansion('last Positivist weekly Friday')).at(-1)).toBe('9999-12-28');
    expect(keys(expansion('late IFC yearly March 4'))).toEqual(['2099-03-01', '2100-03-01', '2101-03-01']);
    expect(keys(expansion('Leap Day past the cap'))).toEqual(['2092-06-17', '2096-06-17']);
    expect(keys(expansion('Holy Women count past the cap'))).toEqual(['2088-12-31', '2092-12-31', '2096-12-31']);
    expect(thirteen.some((c) => c.recurrence.end.kind === 'count' && c.recurrence.exceptDates.length > 0)).toBe(true);
    expect(thirteen.some((c) => c.recurrence.end.kind === 'until')).toBe(true);
    // The RFC 5545 WKST example.
    expect(keys(expansion('RFC WKST=MO'))).toEqual(['1997-08-05', '1997-08-10', '1997-08-19', '1997-08-24']);
    expect(keys(expansion('RFC WKST=SU'))).toEqual(['1997-08-05', '1997-08-17', '1997-08-19', '1997-08-31']);
    // Months without a 31st are skipped; the last day; the second Tuesday; the last weekday.
    expect(keys(expansion('monthly on the 31st'))).toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31', '2026-10-31', '2026-12-31']);
    expect(keys(expansion('monthly on the last day'))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
    expect(keys(expansion('monthly second Tuesday')).slice(0, 3)).toEqual(['2026-10-13', '2026-11-10', '2026-12-08']);
    expect(keys(expansion('monthly last weekday')).slice(0, 3)).toEqual(['2026-10-30', '2026-11-30', '2026-12-31']);
    // February 29 in leap years only (2100 skipped); the 1,000-period guard is gone.
    for (const name of ['yearly on February 29', 'daily February 29']) {
      const years = keys(expansion(name)).map((d) => Number(d.slice(0, 4)));
      expect(years, name).not.toContain(2100);
      expect(years.every((y) => y % 4 === 0)).toBe(true);
    }
    expect(keys(expansion('daily February 29'))).toHaveLength(22);
    expect(keys(expansion('daily day 366'))).toEqual(keys(expansion('daily February 29')).map((d) => `${d.slice(0, 4)}-12-31`));
    expect(keys(expansion('yearly ISO week 1 Monday'))).toEqual(['2025-12-29', '2027-01-04', '2028-01-03', '2029-01-01', '2029-12-31', '2030-12-30']);
    expect(keys(expansion('yearly day 366'))).toEqual(['2024-12-31', '2028-12-31', '2032-12-31', '2036-12-31', '2040-12-31']);
    expect(keys(expansion('yearly day -1'))).toEqual(['2026-12-31', '2027-12-31', '2028-12-31', '2029-12-31', '2030-12-31']);
    // The start is the first occurrence and counts.
    expect(keys(expansion('start not on the rule'))).toEqual(['2026-10-19', '2026-10-20', '2026-10-27']);
    expect(keys(expansion('count with an excluded date'))).toEqual(['2026-10-19', '2026-11-02', '2026-11-09']);
    // Extra dates: union, a duplicate once, own times and lengths; after the count and the until; removed by EXDATE.
    expect(expansion('rule plus extra dates').occurrences).toEqual([
      '2026-10-19',
      '2026-10-21',
      '2026-10-26',
      { date: '2026-10-28', minute: 900, durationMinutes: null },
      { date: '2026-10-30', minute: 540, durationMinutes: 120 },
    ]);
    expect(keys(expansion('weekly count 3 plus one RDATE'))).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-12-01']);
    expect(keys(expansion('RDATE after the UNTIL'))).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-12-01']);
    expect(keys(expansion('RDATE on an EXDATE'))).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    expect(keys(expansion('RDATE at 15:00 on a rule day'))).toEqual(['2026-10-19', '2026-10-26', '2026-10-26@900', '2026-11-02']);
    expect(keys(expansion('EXDATE at the RDATE time'))).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    expect(keys(expansion('EXDATE at the series time'))).toEqual(['2026-10-19', '2026-10-26@900', '2026-11-02']);
    expect(keys(expansion('dates rule'))).toEqual(['2026-10-19', '2026-11-01', '2026-12-25']);
    // Foreign rules: each RRULE counts from the start; an EXRULE removes its dates.
    expect(keys(expansion('foreign two RRULEs'))).toEqual(['2026-10-19', '2026-10-26', '2026-11-01', '2026-11-02', '2026-12-01']);
    expect(keys(expansion('foreign EXRULE'))).toEqual(['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    // Unsupported, impossible and limited rules.
    for (const name of ['HOURLY unsupported', 'RSCALE unsupported']) {
      expect(expansion(name), name).toMatchObject({ occurrences: ['2026-10-19'], truncated: false, unsupported: true });
    }
    expect(expansion('impossible rule')).toMatchObject({ occurrences: ['2026-10-19'], truncated: true, unsupported: false });
    expect(expansion('limit truncation')).toMatchObject({ limit: 10, truncated: true });
    expect(expansion('limit truncation').occurrences).toHaveLength(10);
    // Year 1 and the range end.
    expect(keys(expansion('year 1 IFC monthly'))).toHaveLength(13);
    expect(keys(expansion('year 1 Positivist yearly'))).toEqual(['0001-01-01', '0002-01-01', '0003-01-01', '0004-01-01']);
    expect(keys(expansion('year 1 Gregorian yearly'))).toEqual(['0001-01-01', '0002-01-01', '0003-01-01', '0004-01-01', '0005-01-01']);
    expect(keys(expansion('range end daily')).at(-1)).toBe('9999-12-31');
    expect(keys(expansion('range end yearly'))).toHaveLength(10);
  });

  it('endBefore: first, middle and last occurrences of count and until series', () => {
    const at = (rule: string, end: RepeatEnd['kind'], date: string) =>
      sections.endBefore.find((c) => ruleText(c.recurrence) === rule && c.recurrence.end.kind === end && c.date === date)!;
    expect(at('FREQ=WEEKLY', 'count', '2026-10-19')).toMatchObject({ expected: null, later: 9 });
    expect(at('FREQ=WEEKLY', 'count', '2026-11-16')).toMatchObject({ expected: { end: { kind: 'count', count: 4 } }, later: 5 });
    expect(at('FREQ=WEEKLY', 'count', '2026-12-21')).toMatchObject({ expected: { end: { kind: 'count', count: 9 } }, later: 0 });
    expect(at('FREQ=WEEKLY', 'until', '2026-11-16')).toMatchObject({ expected: { end: { kind: 'until', date: '2026-11-15' } }, later: 5 });
    expect(at('FREQ=WEEKLY', 'until', '2026-12-21')).toMatchObject({ later: 0 });
    expect(at('FREQ=WEEKLY', 'never', '2026-11-16')).toMatchObject({ expected: { end: { kind: 'until', date: '2026-11-15' } }, later: null });
    // Excluded dates count in the head's count, and not in `later`.
    expect(at('FREQ=WEEKLY', 'count', '2026-11-18')).toMatchObject({
      expected: { end: { kind: 'count', count: 5 }, exceptDates: ['2026-10-26'] },
      later: 4,
    });
    // The until that ends first is kept.
    expect(at('FREQ=DAILY', 'until', '2026-11-01')).toMatchObject({ expected: { end: { kind: 'until', date: '2026-10-25' } }, later: 0 });
  });

  it('splits: kept counts, carried and dropped exceptions, no head, no tail, and the cases that throw', () => {
    const [kept, newRepeat, untilKept, carried, shifted, notProduced] = sections.splits;
    expect(kept!.expected).toMatchObject({ head: { end: { kind: 'count', count: 3 } }, tail: { end: { kind: 'count', count: 7 } }, droppedCount: 0 });
    expect(newRepeat!.expected!.tail).toMatchObject({ rule: { rrule: 'FREQ=DAILY' }, end: { kind: 'count', count: 3 } });
    expect(untilKept!.expected).toMatchObject({ head: { end: { kind: 'until', date: '2026-11-08' } }, tail: { end: { kind: 'until', date: '2026-12-21' } } });
    expect(carried!.expected).toMatchObject({
      head: { exceptDates: ['2026-10-26'] },
      tail: { exceptDates: ['2026-11-23'] },
      overrides: [{ from: '2026-11-30', to: '2026-11-30' }],
    });
    expect(shifted!.expected).toMatchObject({ tail: { exceptDates: ['2026-11-25'] }, overrides: [{ from: '2026-11-30', to: '2026-12-02' }] });
    expect(notProduced!.expected).toMatchObject({ overrides: [{ from: '2026-11-30', to: null }], droppedCount: 1, dropped: true });
    expect(sections.splits.find((c) => c.at === c.start)!.expected!.head).toBeNull();
    expect(sections.splits.filter((c) => c.change === null || c.change.recurrence === null).every((c) => c.expected!.tail === null)).toBe(true);
    // Keeping a dates rule, a rule with extra dates, a foreign rule or a used-up count throws.
    expect(sections.splits.filter((c) => c.expected === null)).toHaveLength(4);
    const extras = sections.splits.find((c) => c.recurrence.extraDates.length === 3 && c.change!.ruleChanged && c.recurrence.rule.kind === 'rrule')!;
    expect(extras.expected).toMatchObject({ head: { extraDates: ['2026-10-21'] }, droppedCount: 2 });
    const foreignHead = sections.splits.find((c) => c.recurrence.rule.kind === 'foreign' && c.expected !== null)!.expected!.head!;
    expect(foreignHead.rule).toEqual({
      kind: 'foreign',
      rules: [
        { rrule: 'FREQ=WEEKLY', end: { kind: 'count', count: 4 } },
        { rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', end: { kind: 'until', date: '2026-11-15' } },
      ],
      exrules: [{ rrule: 'FREQ=MONTHLY;BYDAY=1MO', end: { kind: 'until', date: '2026-11-15' } }],
    });
  });

  it('retimes: own-time values shift, all-day toggles, dropped values and every untils case', () => {
    const r = sections.retimes;
    // Time only: dates kept.
    expect(r[0]!.expected).toMatchObject({ overrides: [{ from: '2026-11-02', to: '2026-11-02' }, { from: '2026-11-09', to: '2026-11-09' }], droppedCount: 0 });
    // Date moved within the rule: shifted; off it: dropped.
    expect(r[2]!.expected).toMatchObject({ recurrence: { exceptDates: ['2026-10-27', '2026-11-24'] }, overrides: [{ from: '2026-11-02', to: '2026-11-03' }] });
    expect(r[5]!.expected).toMatchObject({ recurrence: { exceptDates: [] }, droppedCount: 3 });
    // Own-time extra dates move with the start, across midnight, with their exceptions and overrides.
    expect(r[8]!.expected.recurrence.extraDates).toEqual([
      { date: '2026-10-22', minute: 0, durationMinutes: 30 },
      { date: '2026-10-28', minute: 930, durationMinutes: null },
    ]);
    expect(r[8]!.expected.recurrence.exceptDates).toEqual([{ date: '2026-10-22', minute: 0 }, '2026-11-02']);
    expect(r[8]!.expected.overrides[0]).toEqual({ from: { date: '2026-10-28', minute: 900 }, to: { date: '2026-10-28', minute: 930 } });
    // To all-day: the extra date on a rule date is dropped with its override.
    expect(r[10]!.expected).toMatchObject({ recurrence: { extraDates: ['2026-10-28', '2026-10-30'], exceptDates: ['2026-11-02', '2026-10-28'] }, droppedCount: 2 });
    // untils: one per stored rule with an UNTIL, in stored order; none for COUNT or never.
    const foreignCase = r.find((c) => c.recurrence.rule.kind === 'foreign')!;
    expect(foreignCase.expected.untils).toEqual([
      { rule: 'rrule', index: 1, endDate: '2027-06-30' },
      { rule: 'exrule', index: 0, endDate: '2027-03-31' },
    ]);
    const outlook = r.find((c) => c.recurrence.end.kind === 'until' && (c.recurrence.end as { date: string }).date === '2026-11-16')!;
    expect(outlook.expected.untils).toEqual([{ rule: 'rrule', index: 0, endDate: '2026-11-16' }]);
    expect(r.filter((c) => c.recurrence.end.kind === 'count' || (c.recurrence.end.kind === 'never' && c.recurrence.rule.kind === 'thirteen' && c.recurrence.rule.rule.kind === 'monthly')).every((c) => c.expected.untils.length === 0)).toBe(true);
    expect(r.find((c) => c.allDay === 'to-timed' && c.recurrence.rule.kind === 'thirteen')!.expected.untils).toEqual([{ rule: 'rrule', index: 0, endDate: '2096-06-17' }]);
    expect(r.filter((c) => c.allDay !== null)).toHaveLength(5);
  });

  it('recognitions: every source, alternatives, Android extras and normalized minutes', () => {
    const sources = new Set(sections.recognitions.map((c) => c.expected.source));
    expect(sources).toEqual(new Set(['marker', 'byyearday', 'leap-interval', 'gregorian', 'rdates', 'dates', 'foreign']));
    const byInput = (start: string, rrule: string | null, system = 'ifc') =>
      sections.recognitions.filter((c) => c.input.start === start && (c.input.rrules[0]?.rrule ?? null) === rrule && c.system === system);
    // Single values in both systems: the preferred system first, the other listed.
    expect(byInput('2026-01-12T00:00', 'FREQ=YEARLY;BYYEARDAY=12')[0]!.expected).toMatchObject({
      source: 'byyearday',
      recurrence: { rule: { kind: 'thirteen', rule: { system: 'ifc', month: 1, day: 12 } } },
      alternatives: [{ system: 'positivist', month: 1, day: 12 }],
    });
    expect(byInput('2026-01-12T00:00', 'FREQ=YEARLY;BYYEARDAY=12', 'positivist')[0]!.expected.alternatives).toEqual([
      { kind: 'yearly', system: 'ifc', month: 1, day: 12 },
    ]);
    // Leap interval: the cap reads as never; past the cap it is a plain Gregorian rule.
    expect(byInput('2024-06-17T00:00', 'FREQ=YEARLY;INTERVAL=4;UNTIL=20960617')[0]!.expected).toMatchObject({ source: 'leap-interval', recurrence: { end: { kind: 'never' } } });
    expect(byInput('2024-06-17T00:00', 'FREQ=YEARLY;INTERVAL=4;UNTIL=21000617')[0]!.expected.source).toBe('gregorian');
    // A Leap Day marker is not trusted past the cap either, and a Leap Day list past it is a date list.
    expect(byInput('2088-06-17T00:00', 'FREQ=YEARLY;INTERVAL=4;UNTIL=21080617')[0]!.expected).toMatchObject({
      source: 'gregorian',
      recurrence: { rule: { kind: 'rrule', rrule: 'FREQ=YEARLY;INTERVAL=4' }, end: { kind: 'until', date: '2108-06-17' } },
    });
    expect(byInput('2088-06-17T00:00', null)[0]!.expected).toMatchObject({ source: 'dates', editable: false });
    // UNTIL one second before an occurrence: the end date is the day before it.
    expect(byInput('2026-10-19T19:00', 'FREQ=WEEKLY;UNTIL=20261116T165959Z')[0]!.expected.recurrence.end).toEqual({ kind: 'until', date: '2026-11-15' });
    // Android lists: complete, with an EXDATE, with a date missing, with the marker, a later part.
    const lists = sections.recognitions.filter((c) => c.input.rrules.length === 0 && c.input.rdates.length > 2);
    const android = lists.filter((c) => c.input.start !== '2088-06-17T00:00');
    expect(android.map((c) => c.expected.source)).toEqual(['rdates', 'rdates', 'dates', 'marker', 'marker', 'marker', 'marker', 'marker']);
    expect(android[3]!.expected).toMatchObject({ openEnded: true, recurrence: { end: { kind: 'never' } } });
    expect(android[5]!.input.rdates).toHaveLength(400);
    expect(android[6]!.expected).toMatchObject({ series: '7f1c2a9e-3b4d-4c5e-8f60-718293a4b5c6', part: 2 });
    // The EXDATE at the start's minute is the master's; the one at the RDATE's own minute keeps it.
    const minutes = sections.recognitions.find((c) => c.input.exdates.length === 2)!;
    expect(minutes.expected.recurrence.exceptDates).toEqual(['2026-10-26', { date: '2026-10-28', minute: 900 }]);
    expect(minutes.expected.editable).toBe(false);
    // A disagreeing marker is ignored.
    expect(byInput('2026-10-19T19:00', 'FREQ=WEEKLY').find((c) => c.input.marker !== null)!.expected.source).toBe('gregorian');
  });

  it('presets, descriptions, next occurrences and notes follow the §5.2 grammars', () => {
    expect(sections.presets.map((c) => c.start)).toEqual(PRESET_STARTS.flatMap((s) => [s, s]));
    const first = sections.presets[0]!.presets.map((p) => `${p.id}: ${p.label}`);
    expect(first).toEqual([
      'never: Never',
      'daily: Every day',
      'weekly: Every week on Monday',
      'biweekly: Every 2 weeks on Monday',
      'monthly: Every month on the 19th',
      'yearly: Every year on October 19',
      'thirteen-monthly: Every IFC month on the 12th',
      'thirteen-weekly: Every IFC week on Thursday',
      'thirteen-biweekly: Every 2 IFC weeks on Thursday',
      'thirteen-yearly: Every year on IFC October 12',
    ]);
    const texts = sections.descriptions.map((c) => c.text);
    for (const text of [
      'Every weekday',
      'Every weekend',
      'Every month on the last day',
      'Every month on the second Tuesday',
      'Every month on the last weekday',
      'Every month on the first weekend day',
      'Every year on the last Sunday of March',
      'Every Leap Day',
      'Repeats on a custom schedule',
    ]) {
      expect(texts.some((t) => t.startsWith(text)), text).toBe(true);
    }
    expect(texts.some((t) => t.endsWith(', once'))).toBe(true);
    expect(texts.some((t) => t.endsWith(', and 1 more date'))).toBe(true);
    expect(texts.some((t) => t.includes(', until Moses 1, -1787'))).toBe(true);
    const next = sections.nextOccurrences.map((c) => c.text);
    expect(next).toContain('Next: Mon, Oct 26; Mon, Nov 2; Mon, Nov 9');
    expect(next).toContain('Next: Gregorian Mon, Nov 16; Mon, Dec 14; Tue, Jan 12, 2027');
    expect(next).toContain('');
    const notes = sections.repeatNotes.flatMap((c) => c.notes);
    expect(notes).toContain('In 2027 Mondays are IFC Wednesdays.');
    expect(notes.some((n) => n.endsWith('In 2027 it falls on Tuesdays.'))).toBe(true);
    expect(notes.some((n) => n.endsWith('In 2028 it falls on Wednesdays until Leap Day and on Thursdays after it.'))).toBe(true);
    expect(notes.some((n) => n.includes('until Leap Day 2096'))).toBe(true);
    expect(notes.some((n) => n.includes('until Festival of Holy Women 308'))).toBe(true);
    expect(notes).toContain('Outlook and Exchange move this to the last day of shorter months.');
    expect(notes).toContain('Outlook and Exchange move this to February 28 in other years.');
    expect(sections.repeatNotes.filter((c) => c.notes.length === 0).length).toBeGreaterThanOrEqual(5);
  });

  it('adaptations: every change kind and the later counts of dropped rows', () => {
    const changes = sections.adaptations.map((c) => c.expected.change);
    expect(new Set(changes)).toEqual(new Set(['none', 'adapted', 'converted', 'dropped']));
    const dropped = sections.adaptations.filter((c) => c.expected.change === 'dropped');
    expect(dropped.map((c) => c.expected.laterCount)).toContain(null);
    expect(dropped.some((c) => typeof c.expected.laterCount === 'number' && c.expected.laterCount > 0)).toBe(true);
    expect(sections.adaptations.filter((c) => c.expected.change !== 'dropped').every((c) => c.expected.laterCount === null)).toBe(true);
  });

  it('series and alarmInstants: the year edge, DST days and the range edges', () => {
    const find = (id: string, deviceZone: string) => zoneSections.series.find((c) => c.series.id === id && c.deviceZone === deviceZone)!.expected;
    expect(find('new-year-party', 'Europe/Tallinn').occurrences).toHaveLength(1);
    expect(find('new-year-party', 'America/New_York').occurrences).toEqual([]);
    expect(find('kiritimati', 'Pacific/Honolulu').occurrences[0]).toMatchObject({ originalDate: '2027-01-01', start: '2026-12-31T01:00' });
    expect(find('standup', 'Europe/Tallinn').occurrences).toEqual([
      {
        originalDate: '2026-12-15',
        originalMinute: null,
        overrideId: 'standup|20261215',
        allDay: false,
        start: '2027-01-07T10:00',
        end: '2027-01-07T10:30',
        startUtc: '2027-01-07T08:00',
      },
    ]);
    expect(find('review', 'Europe/Tallinn')).toMatchObject({ orphans: ['review|20270106'] });
    expect(find('night-shift', 'Europe/Tallinn').occurrences.map((o) => o.end)).toEqual(['2026-03-29T08:00', '2026-04-05T07:00', '2026-04-12T07:00']);
    expect(find('early-spring', 'Europe/Tallinn').occurrences[2]!.start).toBe('2026-03-29T04:30');
    expect(find('conference', 'Europe/Tallinn').occurrences).toEqual([
      { originalDate: '2026-12-29', originalMinute: 540, overrideId: null, allDay: false, start: '2026-12-29T09:00', end: '2027-01-03T09:00', startUtc: '2026-12-29T07:00' },
    ]);
    // Floating masters across a DST change: measured in the device's zone.
    const span = (o: { start: string; end: string }) => `${o.start}..${o.end}`;
    expect(find('floating-spring', 'America/New_York').occurrences.map(span)).toEqual(['2026-03-08T01:00..2026-03-08T03:00']);
    expect(find('floating-spring', 'Europe/Tallinn').occurrences.map(span)).toEqual(['2026-03-08T01:00..2026-03-08T03:00']);
    expect(find('floating-autumn', 'America/New_York').occurrences.map(span)).toEqual(['2026-11-01T00:30..2026-11-01T02:30', '2026-11-02T00:30..2026-11-02T03:30']);
    expect(find('floating-autumn', 'Europe/Tallinn').occurrences.map(span)).toEqual(['2026-11-01T00:30..2026-11-01T02:30', '2026-11-02T00:30..2026-11-02T02:30']);
    // DURATION:P1D: the same wall-clock end every day.
    expect(find('day-long', 'America/New_York').occurrences.map(span)).toEqual([
      '2026-03-07T12:00..2026-03-08T12:00',
      '2026-03-08T12:00..2026-03-09T12:00',
      '2026-03-09T12:00..2026-03-10T12:00',
    ]);
    // An override and an exclusion that name the instant of a DST-gap occurrence are that occurrence's.
    expect(find('gap', 'America/New_York')).toMatchObject({ orphans: [] });
    expect(find('gap', 'America/New_York').occurrences.map((o) => [o.originalDate, o.overrideId])).toEqual([
      ['2026-03-07', null],
      ['2026-03-08', 'gap|20260308T073000Z'],
      ['2026-03-09', null],
    ]);
    expect(find('gap-excluded', 'Europe/Tallinn').occurrences.map((o) => o.originalDate)).toEqual(['2026-03-07', '2026-03-09']);
    expect(find('last', 'Europe/Tallinn')).toEqual({ occurrences: [], orphans: [], outOfRange: 1 });
    expect(find('last', 'America/New_York')).toEqual({ occurrences: [], orphans: [], outOfRange: 1 });
    expect(find('first', 'UTC')).toEqual({ occurrences: [], orphans: [], outOfRange: 1 });
    expect(find('first', 'Asia/Tokyo')).toEqual({ occurrences: [], orphans: [], outOfRange: 1 });
    const alarms = zoneSections.alarmInstants;
    expect(alarms[0]).toMatchObject({ occurrence: { startUtc: '2026-03-29T02:00' }, expected: '2026-03-28T23:00' });
    expect(alarms[4]).toMatchObject({ deviceZone: 'Europe/Tallinn', expected: '2026-03-29T06:00' });
    expect(alarms.at(-1)!.expected).toBeNull();
  });
});

describe('C4 fixtures replayed from JSON, as a port reads them', () => {
  const recurrence = (r: RecurrenceJson) => recurrenceFromJson(r);

  it('expansions', () => {
    for (const c of json.expansions) {
      const result = expandRecurrence(recurrence(c.recurrence), D(c.start), { from: D(c.window.from), to: D(c.window.to) }, c.limit === null ? undefined : { limit: c.limit });
      expect(result.occurrences).toEqual(c.occurrences.map(extraDateFromJson));
      expect(result.occurrences.map(extraDateJson)).toEqual(c.occurrences);
      expect([result.truncated, result.unsupported]).toEqual([c.truncated, c.unsupported]);
    }
  });

  it('endBefore', () => {
    for (const c of json.endBefore) {
      const head = endRecurrenceBefore(recurrence(c.recurrence), D(c.start), D(c.date));
      expect(head === null ? null : recurrenceJson(head)).toEqual(c.expected);
      expect(laterOccurrenceCount(recurrence(c.recurrence), D(c.start), D(c.date))).toBe(c.later);
    }
  });

  it('splits', () => {
    for (const c of json.splits) {
      const run = () =>
        splitRecurrence(
          recurrence(c.recurrence),
          D(c.start),
          D(c.at),
          c.overrideDates.map(originalDateFromJson),
          c.change === null ? null : { recurrence: c.change.recurrence === null ? null : recurrence(c.change.recurrence), start: D(c.change.start), ruleChanged: c.change.ruleChanged },
        );
      if (c.expected === null) expect(run).toThrow(RangeError);
      else expect(splitResultJson(run())).toEqual(c.expected);
    }
  });

  it('retimes', () => {
    for (const c of json.retimes) {
      const options = { ...(c.minuteDelta === null ? {} : { minuteDelta: c.minuteDelta }), ...(c.allDay === null ? {} : { allDay: c.allDay }) };
      const result = retimeExceptions(recurrence(c.recurrence), c.overrideDates.map(originalDateFromJson), D(c.oldStart), D(c.newStart), recurrence(c.newRecurrence), options);
      expect({
        recurrence: recurrenceJson(result.recurrence),
        overrides: result.overrides.map(exceptionMapJson),
        untils: result.untils.map(untilRewriteJson),
        droppedCount: result.droppedCount,
        dropped: result.dropped,
      }).toEqual(c.expected);
    }
  });

  it('recognitions', () => {
    for (const c of json.recognitions) {
      expect(recognitionJson(recognizeRecurrence(recognitionInputFromJson(c.input), c.system))).toEqual(c.expected);
    }
  });

  it('presets, descriptions, nextOccurrences, repeatNotes', () => {
    for (const c of json.presets) expect(repeatPresets(D(c.start), c.system).map(presetJson)).toEqual(c.presets);
    for (const c of json.descriptions) expect(describeRecurrence(recurrence(c.recurrence), D(c.start), c.system)).toBe(c.text);
    for (const c of json.nextOccurrences) {
      expect(describeNextOccurrences(recurrence(c.recurrence), D(c.start), c.system, { count: c.count })).toBe(c.text);
    }
    for (const c of json.repeatNotes) {
      expect(describeRepeatNotes(recurrence(c.recurrence), D(c.start), c.system, { gregorianOnlyCalendar: c.gregorianOnlyCalendar })).toEqual(c.notes);
    }
  });

  it('adaptations', () => {
    for (const c of json.adaptations) {
      const result = adaptRecurrenceToStart(recurrence(c.recurrence), D(c.oldStart), D(c.newStart));
      expect(result.recurrence === null ? null : recurrenceJson(result.recurrence)).toEqual(c.expected.recurrence);
      expect(result.change).toBe(c.expected.change);
      if (c.expected.laterCount !== null) expect(laterOccurrenceCount(recurrence(c.recurrence), D(c.oldStart), D(c.oldStart))).toBe(c.expected.laterCount);
    }
  });

  it('series and alarmInstants', () => {
    for (const c of zoneJson.series) {
      const result = expandSeries(seriesInputFromJson(c.series), { from: localFromJson(c.window.from), to: localFromJson(c.window.to) }, c.deviceZone, zones);
      expect({ occurrences: result.occurrences.map(expandedOccurrenceJson), orphans: result.orphans, outOfRange: result.outOfRange }).toEqual(c.expected);
    }
    for (const c of zoneJson.alarmInstants) {
      const occurrence = {
        allDay: c.occurrence.allDay,
        start: localFromJson(c.occurrence.start),
        startUtc: c.occurrence.startUtc === null ? null : localFromJson(c.occurrence.startUtc),
      };
      const fire = alarmFireTime(alarmFromJson(c.alarm), occurrence, c.deviceZone, zones);
      expect(fire === null ? null : formatLocalDateTime(fire)).toBe(c.expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Oracles
// ---------------------------------------------------------------------------

/** The series' own time in the `ical.js` events below; no case uses it as an own time. */
const MASTER_MINUTE = 540;
const compact = (d: GregorianDate) => toISODate(d).replaceAll('-', '');
const clock = (minute: number) => `T${String(Math.floor(minute / 60)).padStart(2, '0')}${String(minute % 60).padStart(2, '0')}00`;

/** A `VEVENT`'s recurrence lines for a Gregorian, date-list or foreign case (timed at 09:00 when a value has its own time). */
function icalLines(r: EventRecurrence, start: GregorianDate): string[] {
  const timed = r.extraDates.some((x) => x.minute !== null || x.durationMinutes !== null) || r.exceptDates.some((x) => x.minute !== null);
  const value = (date: GregorianDate, minute: number | null) => (timed ? `${compact(date)}${clock(minute ?? MASTER_MINUTE)}` : compact(date));
  const param = timed ? '' : ';VALUE=DATE';
  const end = (e: RepeatEnd) => (e.kind === 'count' ? `;COUNT=${e.count}` : e.kind === 'until' ? `;UNTIL=${timed ? `${compact(e.date)}T235959` : compact(e.date)}` : '');
  const lines = [`DTSTART${param}:${value(start, null)}`];
  const rule = r.rule;
  if (rule.kind === 'rrule') lines.push(`RRULE:${formatRRule(rule.rrule)}${end(r.end)}`);
  if (rule.kind === 'foreign') {
    for (const x of rule.rules) lines.push(`RRULE:${formatRRule(x.rrule)}${end(x.end)}`);
    for (const x of rule.exrules) lines.push(`EXRULE:${formatRRule(x.rrule)}${end(x.end)}`);
  }
  for (const x of r.extraDates) {
    lines.push(x.durationMinutes === null ? `RDATE${param}:${value(x.date, x.minute)}` : `RDATE;VALUE=PERIOD:${value(x.date, x.minute)}/PT${x.durationMinutes}M`);
  }
  for (const x of r.exceptDates) lines.push(`EXDATE${param}:${value(x.date, x.minute)}`);
  return lines;
}

/** `ical.js`'s occurrences of the event in the window, as `date` / `date@minute` keys (at most `limit`). */
function icalKeys(lines: readonly string[], from: string, to: string, limit: number | null): string[] {
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//thirteen//test//EN', 'BEGIN:VEVENT', 'UID:case', 'DTSTAMP:20260101T000000Z', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const event = new ICAL.Event(new ICAL.Component(ICAL.parse(text)).getFirstSubcomponent('vevent')!);
  const iterator = event.iterator();
  const first = Number(from.replaceAll('-', ''));
  const last = Number(to.replaceAll('-', ''));
  const out: string[] = [];
  for (let next = iterator.next(); next; next = iterator.next()) {
    const time = (next as unknown as { start?: ICAL.Time }).start ?? next;
    const key = time.year * 10000 + time.month * 100 + time.day;
    if (key > last) break;
    if (key < first) continue;
    const date = `${String(time.year).padStart(4, '0')}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
    const minute = time.isDate ? null : time.hour * 60 + time.minute;
    out.push(minute === null || minute === MASTER_MINUTE ? date : `${date}@${minute}`);
    if (limit !== null && out.length >= limit) break;
  }
  return out;
}

/**
 * Gregorian cases where `ical.js` 2.2.1 differs from RFC 5545 or from the
 * rules of §4.6, each with the reason; the engine's expected dates for each
 * are pinned in the "cover the §5.5 case lists" tests above.
 */
const ICAL_DEVIATIONS: Readonly<Record<string, string>> = {
  'yearly on February 29': 'ical.js moves February 29 to March 1 in common years; RFC 5545 skips invalid dates',
  'yearly ISO week 1 Monday': 'ical.js expands BYWEEKNO=1;BYDAY=MO to every Monday of the year',
  'start not on the rule': 'ical.js drops a DTSTART the rule does not produce; RFC 5545 (and §4.6) count it as the first occurrence',
  'dates rule': 'ical.js drops DTSTART when the event has RDATEs and no RRULE',
  'rule plus extra dates': 'ical.js shows an RDATE on a rule date twice; §4.6 dedupes by date and minute',
  'foreign two RRULEs': 'ical.js stops a second COUNT RRULE early; each RRULE counts from DTSTART on its own',
  'foreign EXRULE': 'ical.js ignores EXRULE',
  'daily day 366': 'ical.js rejects BYYEARDAY in a DAILY rule; §4.6 expands it (a limit part)',
  'HOURLY unsupported': 'ical.js fails on an all-day HOURLY event; the engine shows only the start (§4.6 step 6)',
  'impossible rule': 'ical.js moves February 30 to March 2; the engine stops before iterating (§4.6 step 5)',
};

describe('ical.js agrees on every Gregorian expansions case (§6.1 C4)', () => {
  const gregorian = rows
    .map((row, i) => ({ row, c: sections.expansions[i]! }))
    .filter(({ row }) => row.recurrence.rule.kind !== 'thirteen');

  it('outside the documented deviations', () => {
    let compared = 0;
    for (const { row, c } of gregorian) {
      if (row.name in ICAL_DEVIATIONS) continue;
      const theirs = icalKeys(icalLines(row.recurrence, D(row.start)), c.window.from, c.window.to, c.limit);
      expect(keys(c), row.name).toEqual(theirs);
      compared++;
    }
    expect(compared).toBe(gregorian.length - Object.keys(ICAL_DEVIATIONS).length);
    expect(compared).toBeGreaterThanOrEqual(25);
  });

  it('and differs on each documented deviation (so the list stays minimal)', () => {
    for (const name of Object.keys(ICAL_DEVIATIONS)) {
      const entry = gregorian.find(({ row }) => row.name === name);
      expect(entry, name).toBeDefined();
      let theirs: string[] | null;
      try {
        theirs = icalKeys(icalLines(entry!.row.recurrence, D(entry!.row.start)), entry!.c.window.from, entry!.c.window.to, entry!.c.limit);
      } catch {
        theirs = null;
      }
      expect(theirs, name).not.toEqual(keys(entry!.c));
    }
  });
});

describe('the engine’s own 13-month dates agree on every 13-month expansions case', () => {
  it('rule dates from the start, through the end, minus excluded dates, in the window', () => {
    for (const [i, row] of rows.entries()) {
      const rule = row.recurrence.rule;
      if (rule.kind !== 'thirteen') continue;
      const c = sections.expansions[i]!;
      const start = D(row.start);
      const to = D(c.window.to);
      const all: GregorianDate[] = [];
      for (let year = start.year; year <= to.year; year++) {
        for (const d of thirteenRuleDatesInYear(rule.rule, year, start)) if (compareGregorian(d, start) >= 0) all.push(d);
      }
      // A leap-only repeat stops at its cap: the day in the last leap year before the next century without one (§4.3 c).
      let century = (Math.floor(start.year / 100) + 1) * 100;
      while (century % 400 === 0) century += 100;
      const leapOnly = rule.rule.kind === 'intercalary' && rule.rule.id === 'leap-day';
      const capped = leapOnly ? all.filter((d) => d.year <= Math.min(century - 4, 9996)) : all;
      const end = row.recurrence.end;
      const ended = end.kind === 'count' ? capped.slice(0, end.count) : end.kind === 'until' ? capped.filter((d) => compareGregorian(d, end.date) <= 0) : capped;
      const excluded = new Set(row.recurrence.exceptDates.map((x) => toJulianDayNumber(x.date)));
      const expected = ended
        .filter((d) => !excluded.has(toJulianDayNumber(d)))
        .filter((d) => compareGregorian(d, D(c.window.from)) >= 0 && compareGregorian(d, to) <= 0)
        .map(toISODate);
      expect(keys(c), row.name).toEqual(expected);
      expect(c.truncated, row.name).toBe(false);
    }
  });
});
