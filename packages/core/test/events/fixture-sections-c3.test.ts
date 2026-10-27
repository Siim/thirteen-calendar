/**
 * The C3 sections of fixtures/events.json (docs/EVENTS.md §5.5): `thirteenRules`
 * and `ruleFromStart`, built by scripts/events-fixtures.ts for task C6 to
 * write. Checks determinism, shapes, exact counts, the cases and values the
 * spec lists, that a port decoding only the JSON reproduces every expected
 * value, and that `ical.js` expands every case's encoding and end to the
 * case's dates.
 */
import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import {
  C3_SECTIONS,
  FIXTURE_SERIES_ID,
  type ThirteenRuleCase,
  dateFromJson,
  repeatEndFromJson,
  repeatEndJson,
} from '../../scripts/events-fixtures.ts';
import { formatRRule, parseRRule } from '../../src/events/rrule.ts';
import {
  encodeThirteenRule,
  formatDetachedUri,
  formatThirteenRuleText,
  formatThirteenRuleUri,
  parseDetachedUri,
  parseThirteenRuleText,
  parseThirteenRuleUri,
  thirteenRuleDatesInYear,
  thirteenRuleFor,
  thirteenRuleIncludes,
  thirteenRuleRdateParts,
  thirteenRuleRdates,
} from '../../src/events/thirteen-rules.ts';
import { compareGregorian, isLeapYear, toISODate } from '../../src/index.ts';

const sections = Object.fromEntries(Object.entries(C3_SECTIONS).map(([name, build]) => [name, build()])) as {
  [K in keyof typeof C3_SECTIONS]: ReturnType<(typeof C3_SECTIONS)[K]>;
};
/** Each section as a port reads it: through JSON text. */
const json = JSON.parse(JSON.stringify(sections)) as typeof sections;
const rules = sections.thirteenRules;
const D = dateFromJson;
const iso = (dates: readonly { year: number; month: number; day: number }[]) => dates.map(toISODate);
const ruleText = (c: ThirteenRuleCase) => c.marker;
const find = (marker: string, start: string) => rules.filter((c) => c.marker === marker && c.start === start);

describe('C3 fixture sections', () => {
  it('are listed in publication order (§6.0)', () => {
    expect(Object.keys(C3_SECTIONS)).toEqual(['thirteenRules', 'ruleFromStart']);
  });

  it('are deterministic and plain JSON', () => {
    for (const [name, build] of Object.entries(C3_SECTIONS)) {
      expect(JSON.stringify(build()), name).toBe(JSON.stringify(sections[name as keyof typeof sections]));
    }
    expect(json).toEqual(sections);
  });

  it('have exact case counts (C6 writes them to `counts`) and stay small', () => {
    expect(Object.fromEntries(Object.entries(sections).map(([name, cases]) => [name, cases.length]))).toEqual({
      thirteenRules: 91,
      ruleFromStart: 45,
    });
    expect(JSON.stringify(sections).length).toBeLessThan(150_000);
  });

  it('use the documented field names in order', () => {
    const keys = (value: object) => Object.keys(value);
    const ruleKeys = {
      monthly: ['kind', 'system', 'day'],
      weekly: ['kind', 'system', 'weekday', 'interval'],
      yearly: ['kind', 'system', 'month', 'day'],
      intercalary: ['kind', 'system', 'id'],
    };
    for (const c of rules) {
      expect(keys(c)).toEqual(['rule', 'start', 'datesIn', 'encoding', 'marker', 'uri', 'rdates', 'parts', 'detached']);
      expect(keys(c.rule)).toEqual(ruleKeys[c.rule.kind]);
      for (const d of c.datesIn) expect(keys(d)).toEqual(['year', 'dates']);
      expect(keys(c.encoding)).toEqual(['form', 'rrule', 'exchangeSafe', 'cap']);
      expect(keys(c.uri)).toEqual(['end', 'series', 'part', 'text']);
      expect(keys(c.rdates)).toEqual(['end', 'horizon', 'dates', 'truncated']);
      if (c.parts !== null) {
        expect(keys(c.parts)).toEqual(['end', 'horizon', 'maxValues', 'parts']);
        for (const p of c.parts.parts) expect(keys(p)).toEqual(['part', 'start', 'dates']);
      }
      if (c.detached !== null) expect(keys(c.detached)).toEqual(['series', 'original', 'text']);
    }
    for (const c of sections.ruleFromStart) {
      expect(keys(c)).toEqual(['kind', 'start', 'system', 'rule']);
      if (c.rule !== null) expect(keys(c.rule)).toEqual(ruleKeys[c.rule.kind]);
    }
  });

  it('cover the monthly, weekly, yearly and intercalary cases of §5.5', () => {
    // Monthly: IFC and Positivist days 1, 12, 28 from 2026, 2028, 2099, 2100 and 9998.
    for (const system of ['ifc', 'positivist']) {
      for (const day of [1, 12, 28]) {
        const years = rules
          .filter((c) => c.rule.kind === 'monthly' && c.rule.system === system && c.rule.day === day && c.parts === null)
          .map((c) => Number(c.start.slice(0, 4)));
        expect(years, `${system} ${day}`).toEqual(expect.arrayContaining([2026, 2028, 2099, 2100, 9998]));
      }
    }
    // Weekly: every weekday, interval 1 and 2, both systems; both fortnight phases.
    for (const system of ['ifc', 'positivist']) {
      for (const interval of [1, 2]) {
        const weekdays = new Set(
          rules.flatMap((c) => (c.rule.kind === 'weekly' && c.rule.system === system && c.rule.interval === interval ? [c.rule.weekday] : [])),
        );
        expect(weekdays.size, `${system} ${interval}`).toBe(7);
      }
    }
    const tuesdays = rules.filter((c) => c.marker === 'SYSTEM=ifc;KIND=weekly;WEEKDAY=TU;INTERVAL=2');
    expect(tuesdays.map((c) => c.start).sort()).toEqual(['2026-10-10', '2026-10-24']); // IFC October 3 and 17
    expect(tuesdays[0]!.encoding.rrule).toBe(tuesdays[1]!.encoding.rrule);
    const phases = new Set(rules.filter((c) => c.rule.kind === 'weekly' && c.rule.interval === 2).map((c) => c.encoding.rrule.split('=')[2]!.split(',')[0]));
    expect(phases.size).toBeGreaterThan(7);
    // Yearly and intercalary.
    for (const [marker, form] of [
      ['SYSTEM=ifc;KIND=yearly;MONTH=1;DAY=1', 'gregorian-yearly'],
      ['SYSTEM=ifc;KIND=yearly;MONTH=3;DAY=3', 'gregorian-yearly'],
      ['SYSTEM=ifc;KIND=yearly;MONTH=3;DAY=4', 'byyearday'],
      ['SYSTEM=ifc;KIND=yearly;MONTH=6;DAY=28', 'byyearday'],
      ['SYSTEM=ifc;KIND=yearly;MONTH=7;DAY=1', 'gregorian-yearly'],
      ['SYSTEM=ifc;KIND=yearly;MONTH=13;DAY=28', 'gregorian-yearly'],
      ['SYSTEM=positivist;KIND=yearly;MONTH=3;DAY=3', 'gregorian-yearly'],
      ['SYSTEM=positivist;KIND=yearly;MONTH=3;DAY=4', 'byyearday'],
      ['SYSTEM=positivist;KIND=yearly;MONTH=13;DAY=28', 'byyearday'],
      ['SYSTEM=ifc;KIND=intercalary;DAY=YD', 'gregorian-yearly'],
      ['SYSTEM=ifc;KIND=intercalary;DAY=LD', 'leap-interval'],
      ['SYSTEM=positivist;KIND=intercalary;DAY=YD', 'byyearday'],
      ['SYSTEM=positivist;KIND=intercalary;DAY=LD', 'leap-interval'],
    ] as const) {
      const cases = rules.filter((c) => c.marker === marker);
      expect(cases.length, marker).toBeGreaterThan(0);
      for (const c of cases) expect(c.encoding.form, marker).toBe(form);
    }
    const caps = Object.fromEntries(
      rules.filter((c) => c.marker === 'SYSTEM=ifc;KIND=intercalary;DAY=LD').map((c) => [c.start, c.encoding.cap]),
    );
    expect(caps).toEqual({ '2024-06-17': '2096-06-17', '2096-06-17': '2096-06-17', '2104-06-17': '2196-06-17', '9904-06-17': '9996-06-17' });
  });

  it('pin the §4.3 table and the repeat picker examples', () => {
    const encoding = (marker: string, start: string) => find(marker, start)[0]!.encoding.rrule;
    expect(encoding('SYSTEM=ifc;KIND=monthly;DAY=12', '2026-01-12')).toBe(
      'FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18',
    );
    expect(encoding('SYSTEM=ifc;KIND=monthly;DAY=1', '2026-01-01')).toBe(
      'FREQ=YEARLY;BYYEARDAY=1,29,57,85,113,141,-197,-169,-141,-113,-85,-57,-29',
    );
    expect(encoding('SYSTEM=ifc;KIND=monthly;DAY=28', '2026-01-28')).toBe(
      'FREQ=YEARLY;BYYEARDAY=28,56,84,112,140,168,-170,-142,-114,-86,-58,-30,-2',
    );
    expect(encoding('SYSTEM=positivist;KIND=monthly;DAY=12', '2026-01-12')).toBe(
      'FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,180,208,236,264,292,320,348',
    );
    expect(encoding('SYSTEM=ifc;KIND=yearly;MONTH=4;DAY=12', '2026-04-06')).toBe('FREQ=YEARLY;BYYEARDAY=96');
    expect(encoding('SYSTEM=positivist;KIND=intercalary;DAY=YD', '2026-12-31')).toBe('FREQ=YEARLY;BYYEARDAY=365');
    expect(encoding('SYSTEM=ifc;KIND=yearly;MONTH=11;DAY=12', '2026-10-19')).toBe('FREQ=YEARLY');
    expect(encoding('SYSTEM=ifc;KIND=intercalary;DAY=LD', '2024-06-17')).toBe('FREQ=YEARLY;INTERVAL=4;UNTIL=20960617');
    expect(encoding('SYSTEM=ifc;KIND=weekly;WEEKDAY=TH', '2026-10-19').split(',')).toHaveLength(52);
    // Every IFC month on the 12th from 2026 (the mockup Book club): Android writes it through 2036 (§2.13).
    const bookClub = find('SYSTEM=ifc;KIND=monthly;DAY=12', '2026-01-12')[0]!;
    expect(bookClub.rdates.horizon).toBe('2036-12-31');
    expect(bookClub.rdates.dates.at(-1)).toBe('2036-12-14');
    // The repeat picker's Next line (§2.13): Gregorian Mon, Nov 16; Mon, Dec 14; Tue, Jan 12, 2027.
    expect(bookClub.rdates.dates.filter((d) => d > '2026-10-19').slice(0, 3)).toEqual(['2026-11-16', '2026-12-14', '2027-01-12']);
    // Every IFC week and every 2 IFC weeks on Thursday from October 19, 2026: through 2029 and 2031 (§4.4).
    expect(find('SYSTEM=ifc;KIND=weekly;WEEKDAY=TH', '2026-10-19').map((c) => c.rdates.horizon)).toEqual(['2029-12-31', '9999-12-31']);
    expect(find('SYSTEM=ifc;KIND=weekly;WEEKDAY=TH;INTERVAL=2', '2026-10-19')[0]!.rdates.horizon).toBe('2031-12-31');
    expect(rules.find((c) => c.uri.text === 'thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never')).toBeDefined();
  });

  it('cover every end, the horizons, the 400-value truncation and the range end', () => {
    const ends = new Set(rules.map((c) => c.rdates.end.kind));
    expect(ends).toEqual(new Set(['never', 'count', 'until']));
    const truncated = rules.filter((c) => c.rdates.truncated);
    expect(truncated).toHaveLength(1);
    expect(truncated[0]!.rdates.dates).toHaveLength(400);
    for (const c of rules) {
      expect(c.rdates.dates.length).toBeLessThanOrEqual(400);
      expect(c.rdates.dates.every((d) => d > c.start && d <= c.rdates.horizon)).toBe(true);
    }
    // Lists that reach 9999-12-31 stop there.
    expect(rules.some((c) => c.rdates.dates.at(-1) === '9999-12-31')).toBe(true);
    expect(rules.some((c) => c.start === '9999-12-31' && c.rdates.dates.length === 0)).toBe(true);
    expect(rules.some((c) => c.start === '0001-01-01')).toBe(true);
  });

  it('cover Android parts: two parts, a grown last part, a third part, a count of 999 and 9999-12-31', () => {
    const parts = rules.filter((c) => c.parts !== null).map((c) => c.parts!);
    const shape = (p: (typeof parts)[number]) => p.parts.map((x) => [x.part, x.start, x.dates.length]);
    const weekly2020 = rules.filter((c) => c.parts !== null && c.start === '2020-01-04');
    expect(weekly2020.map((c) => [c.parts!.horizon, repeatEndFromJson(c.parts!.end).kind])).toEqual([
      ['2029-12-31', 'never'],
      ['2035-12-31', 'never'],
      ['9999-12-31', 'count'],
    ]);
    const [p2029, p2035, p999] = weekly2020.map((c) => c.parts!);
    expect(shape(p2029!)).toEqual([
      [1, '2020-01-04', 400],
      [2, '2027-09-20', 118],
    ]);
    // A later horizon grows the last part to full and appends a third; the first part is untouched.
    expect(shape(p2035!)).toEqual([
      [1, '2020-01-04', 400],
      [2, '2027-09-20', 400],
      [3, '2035-06-07', 29],
    ]);
    expect(p2035!.parts[0]).toEqual(p2029!.parts[0]);
    expect(p2035!.parts[1]!.dates.slice(0, 118)).toEqual(p2029!.parts[1]!.dates);
    expect(shape(p999!)).toEqual([
      [1, '2020-01-04', 400],
      [2, '2027-09-20', 400],
      [3, '2035-06-07', 196],
    ]);
    expect(p999!.parts.slice(0, 2)).toEqual(p2035!.parts.slice(0, 2));
    expect(p999!.parts[2]!.dates.slice(0, 29)).toEqual(p2035!.parts[2]!.dates);
    const range = parts.find((p) => p.horizon === '9999-12-31' && p.end.kind === 'never')!;
    expect(range.maxValues).toBe(100);
    expect(range.parts.at(-1)!.dates.at(-1)).toBe('9999-12-30');
  });

  it('cover marker URIs with and without series and part, and detached URIs', () => {
    expect(rules.some((c) => c.uri.series === null && c.uri.part === null)).toBe(true);
    const withParts = rules.filter((c) => c.uri.series !== null);
    expect(withParts.length).toBeGreaterThan(3);
    for (const c of withParts) {
      expect(c.uri.series).toBe(FIXTURE_SERIES_ID);
      expect(c.uri.text.endsWith(`&series=${FIXTURE_SERIES_ID}&part=${c.uri.part}`)).toBe(true);
    }
    const detached = rules.filter((c) => c.detached !== null).map((c) => c.detached!);
    expect(detached.map((d) => d.text)).toEqual([
      'thirteen://detached?v=1&series=4521&original=2027-09-20',
      'thirteen://detached?v=1&series=6h3k2j1g0f9e8d7c6b5a4z3y2x_R20200104T080000&original=2031-06-28',
      'thirteen://detached?v=1&series=AAMkAGI2TG93%2Fx%2BYw%3D%3D&original=2039-03-15',
      'thirteen://detached?v=1&series=Kalender%207%20%26%20%C3%9Cberweisung&original=9999-12-30',
    ]);
    // Each detached copy is a real occurrence of its series.
    for (const c of rules.filter((x) => x.detached !== null)) {
      const occurrences = c.parts!.parts.flatMap((p) => [p.start, ...p.dates]);
      expect(occurrences, c.detached!.original).toContain(c.detached!.original);
    }
  });

  it('cover ruleFromStart: every kind from month days, Year Day, Leap Day, All the Dead and Holy Women', () => {
    const at = (start: string, system: string) =>
      sections.ruleFromStart.filter((c) => c.start === start && c.system === system).map((c) => (c.rule === null ? null : c.kind));
    expect(at('2026-10-19', 'ifc')).toEqual(['monthly', 'weekly', 'biweekly', 'yearly', null]);
    expect(at('2026-10-19', 'positivist')).toEqual(['monthly', 'weekly', 'biweekly', 'yearly', null]);
    for (const [start, system] of [
      ['2026-12-31', 'ifc'],
      ['2026-12-31', 'positivist'],
      ['2024-06-17', 'ifc'],
      ['2024-12-30', 'positivist'],
      ['2024-12-31', 'positivist'],
      ['9999-12-31', 'positivist'],
    ]) {
      expect(at(start!, system!), `${start} ${system}`).toEqual([null, null, null, null, 'intercalary']);
    }
    expect(sections.ruleFromStart.find((c) => c.start === '2024-12-31')!.rule).toBeNull();
    expect(sections.ruleFromStart.filter((c) => c.kind === 'intercalary' && c.rule !== null).map((c) => c.rule)).toEqual([
      { kind: 'intercalary', system: 'ifc', id: 'year-day' },
      { kind: 'intercalary', system: 'positivist', id: 'year-day' },
      { kind: 'intercalary', system: 'ifc', id: 'leap-day' },
      { kind: 'intercalary', system: 'positivist', id: 'year-day' },
      { kind: 'intercalary', system: 'positivist', id: 'leap-day' },
      { kind: 'intercalary', system: 'positivist', id: 'year-day' },
    ]);
  });
});

describe('C3 fixtures replayed from JSON, as a port reads them', () => {
  it('thirteenRules: dates, encoding, marker, URI, RDATE list, parts and detached URI', () => {
    for (const c of json.thirteenRules) {
      const label = `${ruleText(c)} from ${c.start}`;
      const start = D(c.start);
      for (const { year, dates } of c.datesIn) expect(iso(thirteenRuleDatesInYear(c.rule, year, start)), label).toEqual(dates);
      const encoding = encodeThirteenRule(c.rule, start);
      expect(encoding.rrule, label).toEqual(parseRRule(c.encoding.rrule));
      expect(formatRRule(encoding.rrule), label).toBe(c.encoding.rrule);
      expect([encoding.form, encoding.exchangeSafe, encoding.cap === null ? null : toISODate(encoding.cap)], label).toEqual([
        c.encoding.form,
        c.encoding.exchangeSafe,
        c.encoding.cap,
      ]);
      expect(formatThirteenRuleText(c.rule)).toBe(c.marker);
      expect(parseThirteenRuleText(c.marker)).toEqual(c.rule);
      const end = repeatEndFromJson(c.uri.end);
      expect(formatThirteenRuleUri(c.rule, end, { series: c.uri.series, part: c.uri.part })).toBe(c.uri.text);
      expect(parseThirteenRuleUri(c.uri.text)).toEqual({ rule: c.rule, end, series: c.uri.series, part: c.uri.part });
      const rdates = thirteenRuleRdates(c.rule, start, repeatEndFromJson(c.rdates.end), D(c.rdates.horizon));
      expect({ dates: iso(rdates.dates), truncated: rdates.truncated }, label).toEqual({ dates: c.rdates.dates, truncated: c.rdates.truncated });
      if (c.parts !== null) {
        const parts = thirteenRuleRdateParts(c.rule, start, repeatEndFromJson(c.parts.end), D(c.parts.horizon), {
          maxValues: c.parts.maxValues,
        });
        expect(parts.map((p) => ({ part: p.part, start: toISODate(p.start), dates: iso(p.dates) })), label).toEqual(c.parts.parts);
      }
      if (c.detached !== null) {
        expect(formatDetachedUri(c.detached.series, D(c.detached.original))).toBe(c.detached.text);
        expect(parseDetachedUri(c.detached.text)).toEqual({ series: c.detached.series, original: D(c.detached.original) });
      }
      // The rule produces its start, and the RDATE values are rule dates.
      expect(thirteenRuleIncludes(c.rule, start, start), label).toBe(true);
      for (const d of c.rdates.dates) expect(thirteenRuleIncludes(c.rule, D(d), start), `${label} ${d}`).toBe(true);
      expect(repeatEndJson(repeatEndFromJson(c.rdates.end))).toEqual(c.rdates.end);
    }
  });

  it('ruleFromStart', () => {
    for (const c of json.ruleFromStart) expect(thirteenRuleFor(c.kind, D(c.start), c.system), `${c.kind} ${c.start}`).toEqual(c.rule);
  });
});

describe('ical.js expands every fixture encoding to the fixture dates', () => {
  /** All-day dates `ical.js` expands for `rule` from `start`, through `last` (compared as numbers: ical.js goes past 9999). */
  function expand(rule: string, start: string, last: string): string[] {
    const iterator = ICAL.Recur.fromString(rule).iterator(ICAL.Time.fromDateString(start));
    const lastKey = Number(last.replaceAll('-', ''));
    const out: string[] = [];
    for (let next = iterator.next(); next && next.year * 10000 + next.month * 100 + next.day <= lastKey; next = iterator.next()) {
      out.push(`${String(next.year).padStart(4, '0')}-${String(next.month).padStart(2, '0')}-${String(next.day).padStart(2, '0')}`);
    }
    return out;
  }

  it('over 20 years from each start (2024 to 2104 for every rule is in thirteen-rules.test.ts)', () => {
    for (const c of rules) {
      const year = Number(c.start.slice(0, 4));
      const last = `${String(Math.min(year + 20, 9999)).padStart(4, '0')}-12-31`;
      const ours: string[] = [];
      for (let y = year; y <= Math.min(year + 20, 9999); y++) {
        for (const d of thirteenRuleDatesInYear(c.rule, y, D(c.start))) if (compareGregorian(d, D(c.start)) >= 0) ours.push(toISODate(d));
      }
      const capped = c.encoding.cap === null ? ours : ours.filter((d) => d <= c.encoding.cap!);
      expect(expand(c.encoding.rrule, c.start, last), `${c.marker} from ${c.start}`).toEqual(capped);
    }
  });

  it('with the case end as COUNT or UNTIL, to the start and the RDATE list', () => {
    let compared = 0;
    for (const c of rules) {
      if (c.encoding.form === 'leap-interval' || c.rdates.truncated) continue;
      const end = c.rdates.end;
      const suffix = end.kind === 'count' ? `;COUNT=${end.count}` : end.kind === 'until' ? `;UNTIL=${end.date.replaceAll('-', '')}` : '';
      const theirs = expand(`${c.encoding.rrule}${suffix}`, c.start, c.rdates.horizon);
      expect(theirs, `${c.marker} from ${c.start}`).toEqual([c.start, ...c.rdates.dates]);
      compared++;
    }
    expect(compared).toBeGreaterThan(80);
  });

  it('the leap years the caps assume', () => {
    expect([2096, 2196, 9996].every(isLeapYear)).toBe(true);
    expect([2100, 2200].some(isLeapYear)).toBe(false);
  });
});
