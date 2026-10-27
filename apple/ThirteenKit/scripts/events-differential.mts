// Differential cases for the ThirteenKit events port (docs/EVENTS.md §5.7), a development tool.
//
// Builds random inputs, runs them through the TypeScript engine (packages/core) and writes the
// results in the JSON shapes of fixtures/events.json, so EventsFixtureParityTests replays them
// unchanged, plus `x*` sections for API the fixture file does not replay (EventsDifferentialTests).
// The zone sections run through the recording resolver of the fixture generator, so the file
// carries its own `zoneOffsets`. Only the envelope and `counts` checks fail on such a file, by
// design (it has other sections and sizes). Inputs on which the engine throws something other than
// a RangeError are left out and listed in `<out>.crashes.json`.
//
//   node apple/ThirteenKit/scripts/events-differential.mts <seed> <out.json> [scale]
//   THIRTEEN_EVENTS_FIXTURE=<out.json> swift test --package-path apple/ThirteenKit \
//     --filter 'EventsFixtureParityTests|EventsDifferentialTests'
//
// Needs Node 22.18 or later (type stripping). Reads packages/core/scripts helpers, so a change
// there can need a change here; nothing in CI runs this file.
const ROOT = new URL('../../../packages/core/', import.meta.url).href;
const core = await import(`${ROOT}src/index.ts`);
const ev = await import(`${ROOT}src/events/index.ts`);
const tr = await import(`${ROOT}src/events/thirteen-rules.ts`);
const rec = await import(`${ROOT}src/events/recurrence.ts`);
const occ = await import(`${ROOT}src/events/occurrences.ts`);
const lay = await import(`${ROOT}src/events/layout.ts`);
const EF = await import(`${ROOT}scripts/events-fixtures.ts`);
const RF = await import(`${ROOT}scripts/recurrence-fixtures.ts`);
const LF = await import(`${ROOT}scripts/layout-fixtures.ts`);
const ZR = await import(`${ROOT}scripts/zone-resolvers.ts`);
import { writeFileSync } from 'node:fs';

const seedArg = Number(process.argv[2] ?? 1);
const out = process.argv[3] ?? 'events-differential.json';
const SCALE = Number(process.argv[4] ?? 1);

let s = seedArg >>> 0 || 1;
function rnd(): number {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(arr: readonly T[]): T => arr[int(0, arr.length - 1)]!;
const chance = (p: number) => rnd() < p;
const shuffle = <T,>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = int(0, i);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
};
const attempt = <T,>(fn: () => T): T | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};
/** Engine errors other than RangeError: the input is left out and listed. */
const CRASHES: any[] = [];
let lastInput: any = null;
/** `true` for a RangeError (the engine rejected the input); anything else is recorded as a crash. */
const isRange = (e: unknown) => {
  if (e instanceof RangeError) return true;
  CRASHES.push({ error: String(e), stack: String((e as any)?.stack ?? '').split('\n').slice(0, 4).join(' | '), input: lastInput });
  return true;
};

const D = core.parseISODate;
const L = ev.parseLocalDateTime;
const dj = core.toISODate;
const lj = ev.formatLocalDateTime;
const SYSTEMS = ['ifc', 'positivist'] as const;

function randYear(): number {
  const r = rnd();
  if (r < 0.62) return int(2018, 2035);
  if (r < 0.72) return int(2036, 2150);
  if (r < 0.8) return int(1583, 2017);
  if (r < 0.85) return int(1, 8);
  if (r < 0.92) return int(9985, 9999);
  return int(100, 9999);
}
const LEAP_STARTS = [2024, 2028, 2088, 2092, 2096, 2104, 2108, 2192, 2196, 2204, 9900, 9904, 9992, 9996, 1584, 1600];
function randDate(year = randYear()): any {
  if (chance(0.06)) {
    const y = pick(LEAP_STARTS);
    return chance(0.5) ? { year: y, month: 6, day: 17 } : { year: y, month: 12, day: 31 };
  }
  if (chance(0.3)) {
    const specials: [number, number][] = [[2, 28], [2, 29], [6, 17], [6, 18], [12, 30], [12, 31], [1, 1], [3, 1], [6, 16], [12, 29]];
    const [m, d] = pick(specials);
    if (core.isValidGregorian({ year, month: m, day: d })) return { year, month: m, day: d };
  }
  const month = int(1, 12);
  return { year, month, day: int(1, core.daysInGregorianMonth(year, month)) };
}
function addDays(d: any, n: number): any {
  return attempt(() => core.addGregorianDays(d, n)) ?? d;
}
function near(d: any, span: number): any {
  return addDays(d, int(-span, span));
}
function randMinute(): number {
  return chance(0.6) ? int(0, 95) * 15 : int(0, 1439);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function randThirteenRule(start: any, system: string): any {
  for (const kind of shuffle(['monthly', 'weekly', 'biweekly', 'yearly', 'intercalary'])) {
    const r = tr.thirteenRuleFor(kind, start, system);
    if (r) return r;
  }
  throw new Error('no rule');
}
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function sub<T>(arr: readonly T[], min: number, max: number): T[] {
  return shuffle([...arr]).slice(0, int(min, Math.min(max, arr.length)));
}
function nonzero(a: number, b: number): number {
  const v = int(a, b);
  return v === 0 ? 1 : v;
}
function randRRuleText(start: any, allowEnd = false): string {
  const r = rnd();
  const freq = r < 0.15 ? 'DAILY' : r < 0.45 ? 'WEEKLY' : r < 0.7 ? 'MONTHLY' : r < 0.97 ? 'YEARLY' : pick(['HOURLY', 'MINUTELY', 'SECONDLY']);
  const parts: string[] = [`FREQ=${freq}`];
  if (chance(0.35)) parts.push(`INTERVAL=${int(1, 4)}`);
  if (allowEnd) {
    if (chance(0.3)) parts.push(`COUNT=${int(1, 20)}`);
    else if (chance(0.3)) {
      const u = addDays(start, int(-5, 900));
      const ymd = dj(u).replaceAll('-', '');
      parts.push(`UNTIL=${pick([ymd, `${ymd}T235959Z`, `${ymd}T120000`, `${ymd}T000000Z`])}`);
    }
  }
  const wd = DAYS[core.gregorianWeekday(start)]!;
  switch (freq) {
    case 'DAILY':
      if (chance(0.2)) parts.push(`BYDAY=${sub(DAYS, 1, 5).join(',')}`);
      if (chance(0.15)) parts.push(`BYMONTH=${sub([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 1, 4).join(',')}`);
      if (chance(0.1)) parts.push(`BYMONTHDAY=${sub([1, 2, 15, 28, 29, 30, 31, -1, -2], 1, 3).join(',')}`);
      if (chance(0.05)) parts.push(`BYYEARDAY=${sub([1, 60, 100, 365, 366, -1, -366], 1, 3).join(',')}`);
      break;
    case 'WEEKLY':
      if (chance(0.6)) parts.push(`BYDAY=${chance(0.5) ? wd : sub(DAYS, 1, 4).join(',')}`);
      if (chance(0.1)) parts.push(`BYMONTH=${sub([1, 2, 6, 10, 12], 1, 3).join(',')}`);
      if (chance(0.1)) parts.push(`BYSETPOS=${sub([1, 2, -1], 1, 2).join(',')}`);
      break;
    case 'MONTHLY': {
      const x = rnd();
      if (x < 0.35) parts.push(`BYMONTHDAY=${chance(0.6) ? start.day : sub([1, 5, 15, 28, 29, 30, 31, -1, -2, -7], 1, 3).join(',')}`);
      else if (x < 0.65) parts.push(`BYDAY=${sub([1, 2, 3, 4, 5, -1, -2], 1, 2).map((n) => `${n}${pick(DAYS)}`).join(',')}`);
      else if (x < 0.85) {
        parts.push(`BYDAY=${sub(DAYS, 1, 5).join(',')}`);
        if (chance(0.7)) parts.push(`BYSETPOS=${sub([1, 2, 3, -1, -2], 1, 2).join(',')}`);
      }
      if (chance(0.15)) parts.push(`BYMONTH=${sub([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 1, 5).join(',')}`);
      break;
    }
    case 'YEARLY': {
      const x = rnd();
      if (x < 0.25) parts.push(`BYMONTH=${chance(0.6) ? start.month : sub([1, 2, 3, 6, 9, 12], 1, 3).join(',')}`, `BYMONTHDAY=${chance(0.6) ? start.day : sub([1, 13, 28, 29, 30, 31, -1], 1, 2).join(',')}`);
      else if (x < 0.45) parts.push(`BYYEARDAY=${sub([1, 12, 40, 59, 60, 168, 169, 200, 365, 366, -1, -2, -18, -366], 1, 6).join(',')}`);
      else if (x < 0.55) parts.push(`BYWEEKNO=${sub([1, 2, 10, 20, 52, 53, -1], 1, 3).join(',')}`, ...(chance(0.6) ? [`BYDAY=${sub(DAYS, 1, 2).join(',')}`] : []));
      else if (x < 0.7) parts.push(`BYMONTH=${sub([1, 2, 5, 9, 11], 1, 2).join(',')}`, `BYDAY=${sub([1, 2, 4, -1], 1, 2).map((n) => `${n}${pick(DAYS)}`).join(',')}`);
      else if (x < 0.78) parts.push(`BYDAY=${sub([1, 20, 53, -1, -53], 1, 2).map((n) => `${n}${pick(DAYS)}`).join(',')}`);
      else if (x < 0.85) {
        parts.push(`BYMONTH=${sub([1, 3, 10], 1, 2).join(',')}`, `BYDAY=${sub(DAYS, 2, 5).join(',')}`, `BYSETPOS=${sub([1, -1, 2], 1, 2).join(',')}`);
      }
      break;
    }
  }
  if (chance(0.03)) parts.push(`BYHOUR=${int(0, 23)}`);
  if (chance(0.15)) parts.push(`WKST=${pick(DAYS)}`);
  if (chance(0.03)) parts.push(pick(['RSCALE=GREGORIAN', 'RSCALE=HEBREW', 'SKIP=FORWARD', 'RSCALE=GREGORIAN;SKIP=OMIT']));
  if (chance(0.05)) parts.push('X-FOO=bar');
  return parts.join(';');
}
function randRRule(start: any): any {
  for (let i = 0; i < 20; i++) {
    const r = ev.tryParseRRule(randRRuleText(start));
    if (r) return r;
  }
  return ev.parseRRule('FREQ=WEEKLY');
}
function randEnd(start: any): any {
  const r = rnd();
  if (r < 0.4) return { kind: 'never' };
  if (r < 0.72) return { kind: 'count', count: pick([1, 2, 3, 4, 5, 6, 7, 10, 12, 13, 20, 26, 52]) };
  return { kind: 'until', date: addDays(start, chance(0.05) ? int(-30, -1) : int(0, chance(0.7) ? 400 : 4000)) };
}
function randExtra(start: any): any {
  return { date: near(start, 200), minute: chance(0.3) ? randMinute() : null, durationMinutes: chance(0.15) ? int(0, 300) : null };
}
function bare(r: any): any {
  return { ...r, extraDates: [], exceptDates: [] };
}
function sampleDates(r: any, start: any, n: number): any[] {
  const exp = attempt(() => rec.expandRecurrence(bare(r), start, { from: start, to: addDays(start, 800) }, { limit: 60 }));
  if (!exp || exp.occurrences.length === 0) return [];
  return sub(exp.occurrences.map((o: any) => o.date), 0, n);
}
function randRecurrence(start: any, system: string, opts: { thirteenBias?: number } = {}): any {
  const r = rnd();
  const tb = opts.thirteenBias ?? 0.4;
  let rule: any;
  if (r < tb) rule = { kind: 'thirteen', rule: randThirteenRule(start, chance(0.8) ? system : pick(SYSTEMS)) };
  else if (r < tb + 0.4) rule = { kind: 'rrule', rrule: randRRule(start) };
  else if (r < tb + 0.5) rule = { kind: 'dates' };
  else {
    const rules = Array.from({ length: int(1, 2) }, () => ({ rrule: randRRule(start), end: randEnd(start) }));
    const exrules = chance(0.5) ? [{ rrule: randRRule(start), end: randEnd(start) }] : [];
    rule = { kind: 'foreign', rules, exrules };
  }
  const recurrence: any = {
    rule,
    end: rule.kind === 'foreign' || rule.kind === 'dates' ? { kind: 'never' } : randEnd(start),
    extraDates: rule.kind === 'dates' ? Array.from({ length: int(1, 4) }, () => randExtra(start)) : chance(0.25) ? Array.from({ length: int(1, 2) }, () => randExtra(start)) : [],
    exceptDates: [],
  };
  if (chance(0.35)) {
    const ds = sampleDates(recurrence, start, 3);
    recurrence.exceptDates = ds.map((d) => ({ date: d, minute: chance(0.2) ? randMinute() : null }));
    if (chance(0.2)) recurrence.exceptDates.push({ date: near(start, 30), minute: null });
  }
  return recurrence;
}
const rj = (r: any) => EF.recurrenceJson(r);
const odj = (o: any) => EF.originalDateJson(o);

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const S: Record<string, any[]> = {};
const add = (name: string, value: any) => (S[name] ??= []).push(value);
const N = (n: number) => Math.round(n * SCALE);
function randStart(): any {
  return randDate();
}

// expansions, endBefore, splits, retimes, descriptions, nextOccurrences, repeatNotes, adaptations
for (let i = 0; i < N(500); i++) {
  const system = pick(SYSTEMS);
  const start = randStart();
  let recurrence: any;
  try {
    recurrence = randRecurrence(start, system);
  } catch {
    continue;
  }
  // expansions
  {
    const from = chance(0.7) ? addDays(start, -int(0, 60)) : near(start, 2000);
    const to = addDays(from, pick([0, 7, 31, 120, 400, 1500, 4000, 40000]));
    let limit: number | null = chance(0.2) ? int(1, 40) : null;
    try {
      let result = rec.expandRecurrence(recurrence, start, { from, to }, limit === null ? undefined : { limit });
      if (result.occurrences.length > 500) {
        limit = 500;
        result = rec.expandRecurrence(recurrence, start, { from, to }, { limit });
      }
      add('expansions', {
        recurrence: rj(recurrence), start: dj(start), window: { from: dj(from), to: dj(to) }, limit,
        occurrences: result.occurrences.map(EF.extraDateJson), truncated: result.truncated, unsupported: result.unsupported,
      });
    } catch (e) {
      if (!isRange(e)) throw e;
      add('xThrows', { fn: 'expand', recurrence: rj(recurrence), start: dj(start), window: { from: dj(from), to: dj(to) }, limit });
    }
  }
  const samples = sampleDates(recurrence, start, 4);
  // endBefore
  {
    const date = samples.length && chance(0.7) ? pick(samples) : near(start, 400);
    try {
      const head = rec.endRecurrenceBefore(recurrence, start, date);
      const later = rec.laterOccurrenceCount(recurrence, start, date);
      add('endBefore', { recurrence: rj(recurrence), start: dj(start), date: dj(date), expected: head === null ? null : rj(head), later });
    } catch (e) {
      if (!isRange(e)) throw e;
    }
  }
  // splits
  {
    const at = samples.length && chance(0.8) ? pick(samples) : near(start, 300);
    const overrides = sub(samples, 0, 3).map((d: any) => ({ date: d, minute: chance(0.2) ? randMinute() : null }));
    let change: any = null;
    if (chance(0.6)) {
      const newStart = chance(0.5) ? at : near(at, 10);
      const x = rnd();
      const changed = x < 0.3 ? null : x < 0.6 ? attempt(() => rec.adaptRecurrenceToStart(recurrence, start, newStart).recurrence) : attempt(() => randRecurrence(newStart, system));
      change = { recurrence: changed, start: newStart, ruleChanged: chance(0.5) };
    }
    let expected: any;
    let crashed = false;
    try {
      expected = RF.splitResultJson(rec.splitRecurrence(recurrence, start, at, overrides, change));
    } catch (e) {
      if (!(e instanceof RangeError)) { lastInput = { fn: 'splitRecurrence', recurrence: rj(recurrence), start: dj(start), at: dj(at) }; isRange(e); crashed = true; }
      expected = null;
    }
    if (!crashed) add('splits', {
      recurrence: rj(recurrence), start: dj(start), at: dj(at), overrideDates: overrides.map(odj),
      change: change === null ? null : { recurrence: change.recurrence === null ? null : rj(change.recurrence), start: dj(change.start), ruleChanged: change.ruleChanged },
      expected,
    });
  }
  // retimes
  {
    const overrides = sub(samples, 0, 3).map((d: any) => ({ date: d, minute: chance(0.3) ? randMinute() : null }));
    const newStart = chance(0.4) ? start : near(start, 12);
    const adapted = attempt(() => rec.adaptRecurrenceToStart(bare(recurrence), start, newStart).recurrence);
    const newRecurrence = chance(0.6) && adapted ? adapted : bare(recurrence);
    const minuteDelta = chance(0.5) ? null : int(-900, 900);
    const allDay = pick([null, null, 'to-all-day', 'to-timed']);
    const options = { ...(minuteDelta === null ? {} : { minuteDelta }), ...(allDay === null ? {} : { allDay }) };
    try {
      lastInput = { fn: 'retimeExceptions', recurrence: rj(recurrence), overrides: overrides.map(odj), oldStart: dj(start), newStart: dj(newStart), newRecurrence: rj(newRecurrence), options };
      const result = rec.retimeExceptions(recurrence, overrides, start, newStart, newRecurrence, options);
      add('retimes', {
        recurrence: rj(recurrence), overrideDates: overrides.map(odj), oldStart: dj(start), newStart: dj(newStart), newRecurrence: rj(newRecurrence),
        minuteDelta, allDay,
        expected: {
          recurrence: rj(result.recurrence), overrides: result.overrides.map(RF.exceptionMapJson), untils: result.untils.map(RF.untilRewriteJson),
          droppedCount: result.droppedCount, dropped: result.dropped,
        },
      });
    } catch (e) {
      if (!isRange(e)) throw e;
    }
  }
  // descriptions, nextOccurrences, repeatNotes
  try {
    add('descriptions', { recurrence: rj(recurrence), start: dj(start), system, text: rec.describeRecurrence(recurrence, start, system) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  try {
    const count = int(1, 6);
    for (const bad of [0, 101]) {
      try { rec.describeNextOccurrences(recurrence, start, system, { count: bad }); add('xRejects', { kind: 'describeNext', ok: true, recurrence: rj(recurrence), start: dj(start), system, count: bad }); }
      catch (e) { if (e instanceof RangeError) add('xRejects', { kind: 'describeNext', ok: false, recurrence: rj(recurrence), start: dj(start), system, count: bad }); }
    }
    add('nextOccurrences', { recurrence: rj(recurrence), start: dj(start), system, count, text: rec.describeNextOccurrences(recurrence, start, system, { count }) });
    const n = int(0, 12);
    add('xNextDates', { recurrence: rj(recurrence), start: dj(start), count: n, expected: rec.nextOccurrences(recurrence, start, n).map(dj) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  try {
    const g = chance(0.5);
    add('repeatNotes', { recurrence: rj(recurrence), start: dj(start), system, gregorianOnlyCalendar: g, notes: rec.describeRepeatNotes(recurrence, start, system, { gregorianOnlyCalendar: g }) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  // adaptations
  try {
    const newStart = chance(0.3) ? randDate(pick([start.year, start.year + 1, 2024, 2028])) : near(start, 40);
    const result = rec.adaptRecurrenceToStart(recurrence, start, newStart);
    add('adaptations', {
      recurrence: rj(recurrence), oldStart: dj(start), newStart: dj(newStart),
      expected: {
        recurrence: result.recurrence === null ? null : rj(result.recurrence), change: result.change,
        laterCount: result.change === 'dropped' ? rec.laterOccurrenceCount(recurrence, start, start) : null,
      },
    });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  // x: laterCount at random dates, preset matching, recurrenceToRRule
  try {
    const at = samples.length && chance(0.7) ? pick(samples) : near(start, 500);
    add('xLaterCount', { recurrence: rj(recurrence), start: dj(start), at: dj(at), expected: rec.laterOccurrenceCount(recurrence, start, at) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  try {
    add('xMatchPreset', { recurrence: rj(recurrence), start: dj(start), system, expected: rec.matchRepeatPreset(recurrence, start, system) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  try {
    const rr = rec.recurrenceToRRule(recurrence, start);
    add('xToRRule', { recurrence: rj(recurrence), start: dj(start), expected: rr === null ? null : ev.formatRRule(rr) });
  } catch (e) {
    if (!isRange(e)) throw e;
    add('xToRRule', { recurrence: rj(recurrence), start: dj(start), throws: true });
  }
}

// Presets for preset recurrences (so matchRepeatPreset sees its own rows), presets, ruleFromStart, thirteenRules
for (let i = 0; i < N(150); i++) {
  const system = pick(SYSTEMS);
  const start = randStart();
  const presets = rec.repeatPresets(start, system);
  add('presets', { start: dj(start), system, presets: presets.map(RF.presetJson) });
  for (const p of presets) {
    if (p.recurrence && chance(0.3)) {
      const r = { ...p.recurrence, end: randEnd(start) };
      const sys2 = chance(0.8) ? system : pick(SYSTEMS);
      add('xMatchPreset', { recurrence: rj(r), start: dj(start), system: sys2, expected: rec.matchRepeatPreset(r, start, sys2) });
    }
  }
  for (const kind of ['monthly', 'weekly', 'biweekly', 'yearly', 'intercalary']) {
    const rule = tr.thirteenRuleFor(kind, start, system);
    add('ruleFromStart', { kind, start: dj(start), system, rule: rule === null ? null : { ...rule } });
  }
  const rule = randThirteenRule(start, system);
  try {
    const years = [...new Set([start.year, start.year + 1, start.year + int(2, 8), pick([2024, 2100, 2000, 9999, 1, 4])])].filter((y) => y >= 1 && y <= 9999);
    const end = randEnd(start);
    const horizon = addDays(start, pick([30, 400, 3000, 20000]));
    const encoding = tr.encodeThirteenRule(rule, start);
    const extras = chance(0.3) ? { series: pick(['7f1c2a9e-3b4d-4c5e-8f60-718293a4b5c6', '00000000-0000-4000-8000-000000000000', 'a1b2c3d4-e5f6-4789-8abc-def012345678']), part: int(1, 9) } : { series: null, part: null };
    const uriEnd = chance(0.7) ? end : randEnd(start);
    const rdates = tr.thirteenRuleRdates(rule, start, end, horizon, chance(0.2) ? { maxValues: int(1, 30) } : undefined);
    // maxValues is not in the case shape: only the default is replayed
    const rd = tr.thirteenRuleRdates(rule, start, end, horizon);
    void rdates;
    add('thirteenRules', {
      rule: { ...rule }, start: dj(start),
      datesIn: years.map((year) => ({ year, dates: tr.thirteenRuleDatesInYear(rule, year, start).map(dj) })),
      encoding: { form: encoding.form, rrule: ev.formatRRule(encoding.rrule), exchangeSafe: encoding.exchangeSafe, cap: encoding.cap === null ? null : dj(encoding.cap) },
      marker: tr.formatThirteenRuleText(rule),
      uri: { end: EF.repeatEndJson(uriEnd), ...extras, text: tr.formatThirteenRuleUri(rule, uriEnd, extras) },
      rdates: { end: EF.repeatEndJson(end), horizon: dj(horizon), dates: rd.dates.map(dj), truncated: rd.truncated },
      parts: null, detached: null,
    });
    for (const series of ['abc', 'x y&z', '7F1C2A9E-3B4D-4C5E-8F60-718293A4B5C6']) {
      const ok = attempt(() => tr.formatThirteenRuleUri(rule, uriEnd, { series, part: 1 })) !== null;
      add('xRejects', { kind: 'uri', ok, rule: { ...rule }, end: EF.repeatEndJson(uriEnd), series, part: 1 });
    }
    const other = randDate(chance(0.5) ? start.year : randYear());
    add('xIncludes', { rule: { ...rule }, start: dj(start), date: dj(other), expected: tr.thirteenRuleIncludes(rule, other, start) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
}

// recognitions
const zonesIntl = ZR.intlZoneResolver();
for (let i = 0; i < N(400); i++) {
  const system = pick(SYSTEMS);
  const startDate = randStart();
  const start = { date: startDate, minute: chance(0.3) ? 0 : randMinute() };
  const input: any = { start, rrules: [], exrules: [], rdates: [], exdates: [], marker: null };
  const x = rnd();
  const rule = randThirteenRule(startDate, chance(0.85) ? system : pick(SYSTEMS));
  const end = randEnd(startDate);
  const endParts = (rr: any) => {
    if (end.kind === 'count') return { rrule: { ...rr, count: end.count, until: null }, until: null };
    if (end.kind === 'until') {
      const kind = pick(['date', 'utc', 'floating']);
      const u = kind === 'date' ? { kind: 'date', date: end.date } : { kind, value: { date: end.date, minute: pick([0, 1439, 720, 1260]) } };
      return { rrule: { ...rr, count: null, until: u }, until: attempt(() => ev.untilInZone(u, kind === 'utc' ? pick(['Europe/Tallinn', 'UTC', 'America/New_York']) : null, zonesIntl)) };
    }
    return { rrule: rr, until: null };
  };
  try {
    if (x < 0.4) {
      const enc = tr.encodeThirteenRule(rule, startDate);
      let rr = enc.rrule;
      if (enc.form === 'byyearday' && chance(0.2)) rr = { ...rr, byYearDay: shuffle([...rr.byYearDay]) };
      if (enc.form === 'leap-interval') input.rrules.push({ rrule: rr, until: rr.until ? attempt(() => ev.untilInZone(rr.until, null, zonesIntl)) : null });
      else input.rrules.push(endParts(rr));
      if (chance(0.4)) input.marker = chance(0.7) ? tr.formatThirteenRuleText(chance(0.85) ? rule : randThirteenRule(near(startDate, 40), system)) : 'SYSTEM=ifc;KIND=bogus';
    } else if (x < 0.7) {
      input.rrules.push(endParts(randRRule(startDate)));
      if (chance(0.1)) input.marker = tr.formatThirteenRuleText(rule);
    } else if (x < 0.85) {
      const horizon = addDays(startDate, pick([60, 400, 3000]));
      const rd = tr.thirteenRuleRdates(rule, startDate, end, horizon);
      input.rdates = rd.dates.map((d: any) => ({ date: d, minute: null, durationMinutes: null }));
      if (chance(0.3) && input.rdates.length) input.rdates.splice(int(0, input.rdates.length - 1), 1);
      if (chance(0.7)) input.marker = chance(0.5) ? tr.formatThirteenRuleUri(rule, end, chance(0.3) ? { series: '7f1c2a9e-3b4d-4c5e-8f60-718293a4b5c6', part: int(1, 3) } : { series: null, part: null }) : tr.formatThirteenRuleText(rule);
    } else if (x < 0.93) {
      input.rdates = Array.from({ length: int(1, 4) }, () => randExtra(startDate));
    } else {
      input.rrules.push(endParts(randRRule(startDate)), endParts(randRRule(startDate)));
      if (chance(0.5)) input.exrules.push(endParts(randRRule(startDate)));
    }
    if (chance(0.3)) input.exdates = Array.from({ length: int(1, 3) }, () => ({ date: near(startDate, 200), minute: chance(0.3) ? randMinute() : null }));
    if (chance(0.15)) input.rdates.push(randExtra(startDate));
    const result = rec.recognizeRecurrence(input, system);
    add('recognitions', { input: RF.recognitionInputJson(input), system, expected: RF.recognitionJson(result) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
}

// rrules, rruleEquality
function mutate(text: string): string {
  const x = rnd();
  if (x < 0.15) return text.toLowerCase();
  if (x < 0.25) return `RRULE:${text};`;
  if (x < 0.35) return shuffle(text.split(';')).join(';');
  if (x < 0.45) return text.replace(/INTERVAL=\d+/, 'INTERVAL=0');
  if (x < 0.5) return `${text};FREQ=DAILY`;
  if (x < 0.55) return text.replace(/BYMONTHDAY=[^;]+/, 'BYMONTHDAY=32');
  if (x < 0.6) return `${text};COUNT=3;UNTIL=20270101`;
  if (x < 0.65) return text.replace('=', '= ');
  if (x < 0.7) return `${text};BYDAY=+1MO`;
  if (x < 0.75) return `${text};BYWEEKNO=54`;
  if (x < 0.8) return `${text};X-THIRTEEN=1;x-lower=a`;
  if (x < 0.85) return text.replace(/;/g, ';;');
  return text;
}
for (let i = 0; i < N(500); i++) {
  const start = randStart();
  const base = randRRuleText(start, true);
  const text = chance(0.6) ? mutate(base) : base;
  const parsed = ev.tryParseRRule(text);
  add('rrules', { text, parsed: parsed === null ? null : EF.rruleJson(parsed), formatted: parsed === null ? null : ev.formatRRule(parsed) });
  const a = ev.tryParseRRule(base);
  if (a) {
    let bText = base;
    const y = rnd();
    if (y < 0.3) bText = shuffle(base.split(';')).join(';');
    else if (y < 0.45) bText = base.replace(/(BY[A-Z]+)=([^;]+)/, (_m, n, v) => `${n}=${shuffle(v.split(',')).join(',')}`);
    else if (y < 0.55) bText = `${base};WKST=${pick(DAYS)}`.replace(/;WKST=[A-Z]{2}(?=.*WKST)/, '');
    else if (y < 0.65) bText = base.replace(/;COUNT=\d+|;UNTIL=[^;]+/, '');
    else if (y < 0.75) bText = randRRuleText(start, true);
    else if (y < 0.85) bText = base.replace(/INTERVAL=\d+/, 'INTERVAL=1');
    else bText = `${base};X-OTHER=1`;
    const b = ev.tryParseRRule(bText);
    if (b) {
      const ignoreEnd = chance(0.5);
      const ignoreWkst = chance(0.5);
      add('rruleEquality', { a: ev.formatRRule(a), b: ev.formatRRule(b), ignoreEnd, ignoreWkst, equal: ev.rruleEquals(a, b, { ignoreEnd, ignoreWkst }) });
    }
  }
}

// localDateTimes, endForms, wallClock
for (let i = 0; i < N(200); i++) {
  const d = randDate();
  const h = pick([0, 9, 23, 24, 25, int(0, 24)]);
  const m = pick([0, 30, 59, 60, 1, int(0, 59)]);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  let text = `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}T${pad(h)}:${pad(m)}`;
  if (chance(0.1)) text = text.replace('T', pick(['t', ' ', 'TT']));
  if (chance(0.05)) text = text + pick(['Z', ':00', ' ']);
  if (chance(0.05)) text = text.replace(/-(\d\d)-/, `-${pad(int(0, 13))}-`);
  const parsed = ev.tryParseLocalDateTime(text);
  add('localDateTimes', { text, valid: parsed !== null, formatted: parsed === null ? null : lj(parsed) });

  const start = { date: d, minute: randMinute() };
  const endD = addDays(d, pick([0, 0, 1, 2, -1, 30]));
  const end = { date: endD, minute: pick([0, 1440, randMinute(), 1440]) };
  add('endForms', {
    start: lj(start), end: lj(end),
    normalized: attempt(() => lj(ev.normalizeEventEnd(start, end))),
    days: attempt(() => ev.occurrenceDays(start, end).map(dj)),
    display: attempt(() => lj(ev.displayEnd(end))),
  });
  const minutes = pick([0, 1, -1, 60, -60, 1440, -1440, int(-100000, 100000), int(-1e8, 1e8)]);
  add('wallClock', { from: lj(start), minutes, expected: attempt(() => lj(ev.addMinutesLocal(start, minutes))) });
}

// zoneMath (synthetic zones)
for (let i = 0; i < N(150); i++) {
  const base = int(-720, 840);
  const n = int(0, 3);
  const year = pick([2026, 1, 9999, 2000]);
  let at = { date: { year, month: 1, day: 1 }, minute: 0 };
  const transitions: any[] = [];
  let lastOffset = base;
  for (let k = 0; k < n; k++) {
    const next = attempt(() => ev.addMinutesLocal(at, int(1440, 200000)));
    if (!next) break;
    at = next;
    lastOffset = chance(0.5) ? Math.max(-1439, Math.min(1439, lastOffset + pick([60, -60, 30, -30, 1440, -1440, 45]))) : int(-720, 840);
    transitions.push({ at: lj(at), offset: lastOffset });
  }
  const zone = { name: 'Fuzz/Zone', offset: base, transitions };
  const zones = ZR.syntheticZoneResolver(zone);
  const ref = transitions.length ? L(pick(transitions).at) : { date: { year, month: 6, day: 1 }, minute: 600 };
  const value = attempt(() => ev.addMinutesLocal(ref, int(-1500, 1500))) ?? ref;
  if (chance(0.5)) add('zoneMath', { zone, local: lj(value), expected: attempt(() => { const r = ev.zonedToUtc(value, zone.name, zones); return r === null ? null : lj(r); }) });
  else add('zoneMath', { zone, utc: lj(value), expected: attempt(() => { const r = ev.utcToZoned(value, zone.name, zones); return r === null ? null : lj(r); }) });
}

// Zone sections: untils, series, alarmInstants through a recording resolver
const recorder = ZR.recordingZoneResolver(ZR.intlZoneResolver());
const ZONES = ['Europe/Tallinn', 'America/New_York', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'Pacific/Apia', 'UTC', 'America/Sao_Paulo', 'Europe/London', 'Pacific/Chatham', 'America/St_Johns', 'Pacific/Kiritimati', 'Pacific/Honolulu'];
const DST_DAYS = ['2026-03-29', '2026-10-25', '2026-03-08', '2026-11-01', '2026-10-04', '2026-04-05', '2011-12-30', '2018-11-04', '2027-03-28', '2027-10-31'];
function seriesYear(): number {
  const r = rnd();
  if (r < 0.85) return int(2020, 2030);
  if (r < 0.92) return 1;
  return 9999;
}
for (let i = 0; i < N(150); i++) {
  const kind = pick(['date', 'floating', 'utc']);
  const d = chance(0.5) ? D(pick(DST_DAYS)) : randDate(seriesYear());
  const until = kind === 'date' ? { kind: 'date', date: d } : { kind, value: { date: d, minute: randMinute() } };
  const zone = chance(0.25) ? null : pick(ZONES);
  const startMinute = randMinute();
  const allDay = chance(0.3);
  try {
    const inZone = ev.untilInZone(until, zone, recorder);
    const endDate = inZone === null ? null : attempt(() => ev.untilEndDate(inZone, startMinute));
    add('untils', {
      until: EF.rruleUntilJson(until), zone, startMinute, inZone: inZone === null ? null : lj(inZone),
      endDate: endDate === null ? null : dj(endDate), allDay, text: endDate === null ? null : ev.formatUntil(endDate, allDay, zone, recorder),
    });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
}
let seriesId = 0;
for (let i = 0; i < N(300); i++) {
  const allDay = chance(0.3);
  const year = seriesYear();
  const date = chance(0.3) && year > 2000 ? D(pick(DST_DAYS)) : randDate(year);
  const system = pick(SYSTEMS);
  const zone = allDay ? null : chance(0.2) ? null : pick(ZONES);
  const deviceZone = pick(ZONES);
  let start: any, end: any;
  if (allDay) {
    start = { date, minute: 0 };
    end = { date: addDays(date, int(0, 3)), minute: 1440 };
    if (ev.compareLocalDateTime(end, start) < 0) end = { date, minute: 1440 };
  } else {
    start = { date, minute: chance(0.3) ? pick([0, 30, 60, 90, 120, 150, 180, 1410]) : randMinute() };
    const len = pick([0, 15, 60, 90, 120, 1440, 1500, 3000, int(1, 5000)]);
    end = attempt(() => ev.normalizeEventEnd(start, ev.addMinutesLocal(start, len))) ?? { date, minute: 1440 };
  }
  let recurrence: any = null;
  if (chance(0.85)) {
    try {
      recurrence = randRecurrence(date, system);
    } catch {
      recurrence = null;
    }
  }
  const overrides: any[] = [];
  const samples = recurrence ? sampleDates(recurrence, date, 4) : [];
  for (const od of samples) {
    if (!chance(0.5)) continue;
    const oAllDay = chance(0.2) ? !allDay : allDay;
    const oDate = chance(0.6) ? od : near(od, 3);
    let oStart: any, oEnd: any;
    if (oAllDay) {
      oStart = { date: oDate, minute: 0 };
      oEnd = { date: addDays(oDate, int(0, 1)), minute: 1440 };
    } else {
      oStart = { date: oDate, minute: randMinute() };
      oEnd = attempt(() => ev.normalizeEventEnd(oStart, ev.addMinutesLocal(oStart, int(0, 300)))) ?? { date: oDate, minute: 1440 };
    }
    overrides.push({
      id: `o${overrides.length + 1}`, originalDate: od, originalMinute: allDay ? null : chance(0.15) ? randMinute() : chance(0.5) ? start.minute : null,
      canceled: chance(0.2), allDay: oAllDay, start: oStart, end: oEnd, zone: oAllDay ? null : chance(0.3) ? pick(ZONES) : zone,
    });
  }
  if (chance(0.15)) {
    const od = near(date, 50);
    overrides.push({ id: 'orphan', originalDate: od, originalMinute: null, canceled: false, allDay, start: allDay ? { date: od, minute: 0 } : { date: od, minute: 600 }, end: allDay ? { date: od, minute: 1440 } : { date: od, minute: 660 }, zone });
  }
  const duration = !allDay && chance(0.15) ? { days: int(0, 3), minutes: int(0, 180) } : null;
  const series = { id: `s${++seriesId}`, recurrence, allDay, start, end, zone, overrides, duration };
  const wFrom = { date: addDays(date, -int(0, 10)), minute: chance(0.5) ? 0 : randMinute() };
  const wTo = attempt(() => ev.addMinutesLocal(wFrom, pick([1440, 7 * 1440, 31 * 1440, 365 * 1440, int(1, 400 * 1440)]))) ?? { date: { year: 9999, month: 12, day: 31 }, minute: 1440 };
  const window = { from: wFrom, to: wTo };
  try {
    const result = occ.expandSeries(series, window, deviceZone, recorder);
    add('series', {
      series: RF.seriesInputJson(series), window: { from: lj(window.from), to: lj(window.to) }, deviceZone,
      expected: { occurrences: result.occurrences.map(RF.expandedOccurrenceJson), orphans: result.orphans, outOfRange: result.outOfRange },
    });
    if (chance(0.3)) {
      const limit = int(1, 20);
      const limited = occ.expandSeries(series, window, deviceZone, recorder, { limit });
      add('xSeriesLimit', {
        series: RF.seriesInputJson(series), window: { from: lj(window.from), to: lj(window.to) }, deviceZone, limit,
        expected: { occurrences: limited.occurrences.map(RF.expandedOccurrenceJson), orphans: limited.orphans, outOfRange: limited.outOfRange, truncated: limited.truncated, unsupported: limited.unsupported },
      });
    }
    // alarmInstants from the expanded occurrences
    for (const o of result.occurrences.slice(0, 2)) {
      const alarm = chance(0.8)
        ? { kind: 'relative', offsetMinutes: o.allDay ? pick([540, 540 - 1440, -900, 0, 1439, -10080 + 540]) : pick([0, -5, -15, -60, -1440, -10080, 30, int(-20000, 2000)]) }
        : { kind: 'absolute', at: { date: o.start.date, minute: randMinute() } };
      try {
        const startUtc = o.allDay ? null : ev.zonedToUtc(o.start, deviceZone, recorder);
        if (!o.allDay && startUtc === null) continue;
        const fire = ev.alarmFireTime(alarm, { allDay: o.allDay, start: o.allDay ? { date: o.start.date, minute: 0 } : o.start, startUtc }, deviceZone, recorder);
        add('alarmInstants', {
          alarm: EF.alarmJson(alarm), occurrence: { allDay: o.allDay, start: lj(o.allDay ? { date: o.start.date, minute: 0 } : o.start), startUtc: startUtc === null ? null : lj(startUtc) },
          deviceZone, expected: fire === null ? null : lj(fire),
        });
      } catch (e) {
        if (!isRange(e)) throw e;
      }
    }
  } catch (e) {
    if (!isRange(e)) throw e;
  }
}
S.zoneOffsets = recorder.offsets();

// Drafts: drafts, newDrafts, merges, seriesEdits, x model functions
const CALS = Object.values(EF.FIXTURE_CALENDARS) as any[];
const URLS = ['', '', '', 'https://example.com', 'example.com', 'http://localhost:8080/x', 'not a url', 'mailto:x@y.z', 'ftp://a', 'https://exa mple.com', 'www.example.ee/path?q=1', 'javascript:alert(1)', 'https://', 'a.b', 'http://[::1]/', 'https://example.com:99999'];
const TITLES = ['Book club', '', 'Dentist, Dr. Tamm', 'x'.repeat(3), 'Ühine õhtusöök'];
function randAlarm(allDay: boolean): any {
  if (chance(0.15)) return { kind: 'absolute', at: { date: randDate(int(2020, 2030)), minute: randMinute() } };
  return { kind: 'relative', offsetMinutes: allDay ? pick([540, -900, 540 - 2880, 540 - 10080, -60, 1439, -1]) : pick([0, -5, -10, -15, -30, -60, -120, -1440, -2880, -10080, 15, -45, -180, -4320, -1441]) };
}
function randDraft(dateIn?: any, opts: { recurrence?: boolean } = {}): any {
  const allDay = chance(0.3);
  const date = dateIn ?? (chance(0.1) ? randDate(int(1400, 1600)) : chance(0.05) ? randDate(9999) : randDate(int(2020, 2030)));
  let start: any, end: any;
  if (allDay) {
    start = { date, minute: 0 };
    end = { date: addDays(date, chance(0.05) ? -1 : int(0, 3)), minute: 1440 };
  } else {
    start = { date, minute: randMinute() };
    const len = pick([0, 15, 60, 90, 1440, 3000, -30]);
    end = attempt(() => ev.normalizeEventEnd(start, ev.addMinutesLocal(start, len))) ?? attempt(() => ev.addMinutesLocal(start, len)) ?? start;
  }
  const system = pick(SYSTEMS);
  let recurrence: any = null;
  if (opts.recurrence ?? chance(0.5)) {
    recurrence = attempt(() => randRecurrence(chance(0.9) ? date : near(date, 5), system, { thirteenBias: 0.5 }));
    if (recurrence && chance(0.1)) recurrence = { ...recurrence, end: { kind: 'count', count: pick([0, 999, 1000, -1]) } };
  }
  return {
    title: pick(TITLES), location: chance(0.3) ? 'Raamatukoi' : '', notes: chance(0.2) ? 'n' : '', url: pick(URLS), allDay, start, end,
    timeZone: allDay ? null : pick([null, 'Europe/Tallinn', 'America/New_York']), calendarId: pick(CALS).id, recurrence,
    alarms: Array.from({ length: pick([0, 0, 1, 1, 2, 3]) }, () => randAlarm(allDay)), availability: pick(['busy', 'free', 'tentative', 'unavailable']),
  };
}
function tweak(draft: any): any {
  const d = { ...draft };
  const groups = sub(['title', 'location', 'notes', 'url', 'time', 'recurrence', 'calendar', 'alarms', 'availability'], 0, 4);
  for (const g of groups) {
    switch (g) {
      case 'title': d.title = d.title + ' 2'; break;
      case 'location': d.location = d.location === '' ? 'Tartu' : ''; break;
      case 'notes': d.notes = d.notes + 'x'; break;
      case 'url': d.url = d.url === '' ? 'https://thirteen.example' : ''; break;
      case 'time': {
        const x = rnd();
        if (x < 0.4) { d.start = attempt(() => ev.addMinutesLocal(d.start, 60)) ?? d.start; d.end = attempt(() => ev.normalizeEventEnd(d.start, ev.addMinutesLocal(d.end, 60))) ?? d.end; if (d.allDay) { d.start = draft.start; d.end = draft.end; d.allDay = false; d.timeZone = 'Europe/Tallinn'; } }
        else if (x < 0.6) { d.timeZone = d.allDay ? null : d.timeZone === null ? 'UTC' : null; if (d.allDay) d.end = { date: addDays(d.end.date, 1), minute: 1440 }; }
        else if (x < 0.8) { const moved = attempt(() => ev.setDraftAllDay(d, !d.allDay)); if (moved) Object.assign(d, moved); }
        else { const ns = { date: addDays(d.start.date, int(-3, 3)), minute: d.allDay ? 0 : randMinute() }; const m = attempt(() => ev.moveDraftStart(d, ns)); if (m) Object.assign(d, m.draft); }
        break;
      }
      case 'recurrence': d.recurrence = d.recurrence ? (chance(0.5) ? null : { ...d.recurrence, end: { kind: 'count', count: 5 } }) : attempt(() => randRecurrence(d.start.date, 'ifc')); break;
      case 'calendar': d.calendarId = pick(CALS).id; break;
      case 'alarms': d.alarms = chance(0.5) ? [] : [...d.alarms, randAlarm(d.allDay)]; break;
      case 'availability': d.availability = pick(['busy', 'free', 'tentative', 'unavailable']); break;
    }
  }
  return d;
}
const drj = (d: any) => EF.draftJson(d);
for (let i = 0; i < N(300); i++) {
  const draft = randDraft();
  if (chance(0.2) && draft.recurrence?.rule.kind === 'thirteen') {
    draft.recurrence = { ...draft.recurrence, end: { kind: 'until', date: addDays(draft.start.date, -int(1, 10)) } };
  }
  const calendar = pick(CALS);
  try {
    add('drafts', { draft: drj(draft), calendar: EF.calendarJson(calendar), issues: ev.validateDraft(draft, calendar) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  // newDrafts
  {
    const day = randDate(int(2020, 2030));
    const nowDate = chance(0.5) ? day : near(day, 2);
    const now = { date: nowDate, minute: pick([0, 59, 60, 600, 620, 1379, 1380, 1381, 1439, randMinute()]) };
    const allDay = chance(0.3);
    try {
      add('newDrafts', { day: dj(day), now: lj(now), allDay, expected: drj(ev.newEventDraft(day, now, 'home', { allDay })) });
    } catch (e) {
      if (!isRange(e)) throw e;
    }
  }
  // merges
  try {
    const original = randDraft();
    const edited = tweak(original);
    const current = chance(0.3) ? original : tweak(original);
    const r = ev.mergeDraft(original, edited, current);
    add('merges', { original: drj(original), edited: drj(edited), current: drj(current), expected: { merged: drj(r.merged), written: r.written, conflicts: r.conflicts } });
    add('xChangedFields', { a: drj(original), b: drj(edited), expected: ev.changedFields(original, edited) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  // seriesEdits
  try {
    const master = randDraft(undefined, { recurrence: true });
    if (master.recurrence) {
      const samples = sampleDates(master.recurrence, master.start.date, 3);
      const od = samples.length ? pick(samples) : master.start.date;
      const shift = (core.toJulianDayNumber(od) - core.toJulianDayNumber(master.start.date)) * 1440;
      const opened = { ...master, start: attempt(() => ev.addMinutesLocal(master.start, shift)) ?? master.start, end: attempt(() => ev.normalizeEventEnd(ev.addMinutesLocal(master.start, shift), ev.addMinutesLocal(master.end.minute === 1440 ? { date: addDays(master.end.date, 1), minute: 0 } : master.end, shift))) ?? master.end };
      const edited = tweak(opened);
      const override = chance(0.4) ? tweak(opened) : null;
      const r = ev.applyToSeries(master, opened, edited, override);
      add('seriesEdits', {
        master: drj(master), opened: drj(opened), edited: drj(edited), override: override === null ? null : drj(override),
        expected: { master: drj(r.master), override: r.override === null ? null : drj(r.override), written: r.written, retime: r.retime === null ? null : { minuteDelta: r.retime.minuteDelta, allDay: r.retime.allDay } },
      });
    }
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  // moveDraftStart, setDraftAllDay, describeAlarm
  try {
    const d = randDraft();
    const ns = { date: chance(0.3) ? randDate(pick([2024, 2026, 2028])) : near(d.start.date, 40), minute: d.allDay ? 0 : randMinute() };
    const system = pick(SYSTEMS);
    const r = ev.moveDraftStart(d, ns, system);
    add('xMoveDraftStart', { draft: drj(d), start: lj(ns), system, expected: { draft: drj(r.draft), repeatChange: r.repeatChange } });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  try {
    const d = randDraft();
    const allDay = chance(0.7) ? !d.allDay : d.allDay;
    const previousTimes = chance(0.5) ? { start: randMinute(), end: pick([0, 1440, randMinute()]) } : null;
    const availabilityTouched = chance(0.3);
    const timeZone = chance(0.5) ? null : pick(['Europe/Tallinn', 'UTC']);
    const r = ev.setDraftAllDay(d, allDay, { ...(previousTimes ? { previousTimes } : {}), availabilityTouched, timeZone });
    add('xSetDraftAllDay', { draft: drj(d), allDay, previousTimes, availabilityTouched, timeZone, expected: drj(r) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  try {
    const allDay = chance(0.5);
    const alarm = chance(0.7) ? { kind: 'relative', offsetMinutes: int(-30000, 3000) } : randAlarm(allDay);
    const system = pick(SYSTEMS);
    const use24Hour = chance(0.5);
    add('xDescribeAlarm', { alarm: EF.alarmJson(alarm), allDay, system, use24Hour, expected: ev.describeAlarm(alarm, allDay, system, { use24Hour }) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
}

// Layouts
const CAL_IDS = ['home', 'work', 'family', 'gym', 'holidays', 'school'];
let keyN = 0;
function randOccurrences(firstDay: any, spanDays: number, n: number): any[] {
  const list: any[] = [];
  for (let i = 0; i < n; i++) {
    const day = addDays(firstDay, int(-3, spanDays + 3));
    const allDay = chance(0.35);
    let start: any, end: any;
    if (allDay) {
      start = { date: day, minute: 0 };
      end = { date: addDays(day, pick([0, 0, 0, 1, 2, 6, 10, 30])), minute: 1440 };
    } else {
      start = { date: day, minute: randMinute() };
      const len = pick([0, 15, 30, 45, 60, 90, 120, 600, 1439, 1440, 1500, 2880, 4000, int(1, 3000)]);
      end = attempt(() => ev.normalizeEventEnd(start, ev.addMinutesLocal(start, len))) ?? { date: day, minute: 1440 };
      if (chance(0.03)) end = attempt(() => ev.addMinutesLocal(start, -30)) ?? end; // end before start: laid out zero-length
    }
    list.push({ key: `k${++keyN}`, calendarId: pick(CAL_IDS), title: pick(['A', 'B', 'Standup', 'Lunch']), allDay, start, end });
  }
  return list;
}
const oj = (o: any) => LF.occurrenceJson(o);
for (let i = 0; i < N(120); i++) {
  const system = pick(SYSTEMS);
  const year = chance(0.8) ? int(2023, 2029) : pick([1, 9999, 2100, 2000]);
  const month = int(1, 13);
  const first = core.fromThirteen ? attempt(() => core.fromThirteen(core.createMonthDate(year, month, 1, system))) : null;
  if (!first) continue;
  const occurrences = randOccurrences(first, 28 + 2, int(0, 40));
  const maxLanes = chance(0.5) ? null : int(1, 6);
  try {
    add('monthLayouts', { year, month, system, maxLanes, occurrences: occurrences.map(oj), expected: LF.monthLayoutJson(lay.layoutThirteenMonthEvents(year, month, occurrences, system, maxLanes === null ? undefined : { maxLanes })) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  const week = int(1, 4);
  const maxSlots = chance(0.5) ? null : int(1, 5);
  const weekFirst = addDays(first, (week - 1) * 7);
  const wOcc = randOccurrences(weekFirst, 9, int(0, 40));
  try {
    add('weekLayouts', { year, month, week, system, maxSlots, occurrences: wOcc.map(oj), expected: LF.weekLayoutJson(lay.layoutThirteenWeekEvents(year, month, week, wOcc, system, maxSlots === null ? undefined : { maxSlots })) });
    const minDurationMinutes = pick([0, 15, 30, 60, 1440]);
    add('xWeekLayouts', { year, month, week, system, maxSlots, minDurationMinutes, occurrences: wOcc.map(oj), expected: LF.weekLayoutJson(lay.layoutThirteenWeekEvents(year, month, week, wOcc, system, { minDurationMinutes, ...(maxSlots === null ? {} : { maxSlots }) })) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  const date = addDays(first, int(0, 30));
  const dOcc = randOccurrences(date, 0, int(0, 30));
  const minDurationMinutes = pick([0, 15, 30, 60]);
  const dSlots = chance(0.5) ? null : int(1, 5);
  try {
    const layout = lay.layoutDayEvents(date, dOcc, dSlots === null ? { minDurationMinutes } : { minDurationMinutes, maxSlots: dSlots });
    add('dayLayouts', { date: dj(date), occurrences: dOcc.map(oj), minDurationMinutes, maxSlots: dSlots, expected: { allDay: [...layout.allDay], timed: JSON.parse(JSON.stringify(layout.timed)), overflow: JSON.parse(JSON.stringify(layout.overflow)) } });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  const from = addDays(first, int(-5, 20));
  const to = addDays(from, int(0, 40));
  const aOcc = randOccurrences(from, 40, int(0, 30));
  const includeEmptyDays = chance(0.5);
  try {
    add('agendas', { from: dj(from), to: dj(to), system, includeEmptyDays, occurrences: aOcc.map(oj), expected: LF.agendaJson(lay.agenda(aOcc, from, to, system, { includeEmptyDays })) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
  const yOcc = randOccurrences({ year, month: 1, day: 1 }, 365, int(0, 60));
  const maxCalendars = int(1, 5);
  try {
    add('yearMarks', { year, maxCalendars, occurrences: yOcc.map(oj), expected: LF.yearMarksJson(lay.yearEventMarks(year, yOcc, { maxCalendars })) });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
}
for (let m = 0; m <= 1440; m += chance(0.5) ? 1 : 7) {
  for (const use24Hour of [true, false]) {
    const text = attempt(() => lay.formatChipTime(m, use24Hour));
    if (text !== null) add('chipTimes', { minute: m, use24Hour, text });
  }
}
for (let i = 0; i < N(300); i++) {
  const year = pick([int(1, 9999), int(2000, 2100)]);
  const month = int(1, 13);
  const system = pick(SYSTEMS);
  try {
    add('monthColumns', { year, month, system, weekdays: [...lay.monthColumnGregorianWeekdays(year, month, system)] });
  } catch (e) {
    if (!isRange(e)) throw e;
  }
}

const counts: Record<string, number> = {};
for (const [k, v] of Object.entries(S)) counts[k] = v.length;
writeFileSync(out, JSON.stringify({ version: 1, complete: true, generatedBy: '@thirteen/core', spec: 'docs/EVENTS.md', tzVersion: (process.versions as any).tz, counts, ...S }));
console.log(JSON.stringify(counts));
writeFileSync(out.replace('.json', '.crashes.json'), JSON.stringify(CRASHES, null, 1));
console.log('engine crashes:', CRASHES.length);
