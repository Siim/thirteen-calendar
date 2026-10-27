/**
 * The C2 sections of fixtures/events.json (docs/EVENTS.md §5.5): `rrules`,
 * `rruleEquality`, `untils` and `dateLists`, built by
 * scripts/events-fixtures.ts for task C6 to write. Checks determinism, shapes,
 * exact counts, the values the spec states, that every fixture round-trips, and
 * that a port decoding only the JSON reproduces every expected value.
 * `untils` runs through Node's `Intl` here; test/events/fixtures.test.ts
 * replays the committed file through its recorded `zoneOffsets`.
 */
import { describe, expect, it } from 'vitest';
import {
  C2_SECTIONS,
  dateListValueFromJson,
  dateListValueJson,
  rruleFromJson,
  rruleJson,
  rruleUntilFromJson,
} from '../../scripts/events-fixtures.ts';
import { intlZoneResolver } from '../../scripts/zone-resolvers.ts';
import {
  type LocalDateTime,
  formatDateList,
  formatLocalDateTime,
  formatRRule,
  formatUntil,
  parseDateList,
  parseRRule,
  rruleEquals,
  tryParseRRule,
  untilEndDate,
  untilInZone,
} from '../../src/events/index.ts';
import { parseISODate, toISODate } from '../../src/index.ts';

const zones = intlZoneResolver();
const sections = Object.fromEntries(Object.entries(C2_SECTIONS).map(([name, build]) => [name, build(zones)])) as {
  [K in keyof typeof C2_SECTIONS]: ReturnType<(typeof C2_SECTIONS)[K]>;
};
/** Each section as a port reads it: through JSON text. */
const json = JSON.parse(JSON.stringify(sections)) as typeof sections;

function attempt<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
const text = (value: LocalDateTime | null) => (value === null ? null : formatLocalDateTime(value));
const RRULE_KEYS = [
  'freq',
  'interval',
  'count',
  'until',
  'bySecond',
  'byMinute',
  'byHour',
  'byDay',
  'byMonthDay',
  'byYearDay',
  'byWeekNo',
  'byMonth',
  'bySetPos',
  'wkst',
  'rscale',
  'skip',
  'extensions',
];

describe('C2 fixture sections', () => {
  it('are listed in publication order (§6.0)', () => {
    expect(Object.keys(C2_SECTIONS)).toEqual(['rrules', 'rruleEquality', 'untils', 'dateLists']);
  });

  it('are deterministic and plain JSON', () => {
    for (const [name, build] of Object.entries(C2_SECTIONS)) {
      expect(JSON.stringify(build(zones)), name).toBe(JSON.stringify(sections[name as keyof typeof sections]));
    }
    expect(json).toEqual(sections);
  });

  it('have exact case counts (C6 writes them to `counts`)', () => {
    expect(Object.fromEntries(Object.entries(sections).map(([name, cases]) => [name, cases.length]))).toEqual({
      rrules: 101,
      rruleEquality: 33,
      untils: 26,
      dateLists: 26,
    });
  });

  it('use the documented field names in order', () => {
    const keys = (value: object) => Object.keys(value);
    for (const c of sections.rrules) {
      expect(keys(c)).toEqual(['text', 'parsed', 'formatted']);
      if (c.parsed === null) continue;
      expect(keys(c.parsed)).toEqual(RRULE_KEYS);
      for (const d of c.parsed.byDay) expect(keys(d)).toEqual(['weekday', 'ordinal']);
      if (c.parsed.until !== null) expect(keys(c.parsed.until)).toEqual(['kind', c.parsed.until.kind === 'date' ? 'date' : 'value']);
    }
    for (const c of sections.rruleEquality) expect(keys(c)).toEqual(['a', 'b', 'ignoreEnd', 'ignoreWkst', 'equal']);
    for (const c of sections.untils) {
      expect(keys(c)).toEqual(['until', 'zone', 'startMinute', 'inZone', 'endDate', 'allDay', 'text']);
      if (c.allDay) expect([c.zone, c.startMinute]).toEqual([null, 0]);
    }
    for (const c of sections.dateLists) {
      expect(keys(c)).toEqual(['text', 'parsed', 'form', 'formatted']);
      for (const v of c.parsed ?? []) {
        expect(keys(v)).toEqual(v.kind === 'date' ? ['kind', 'date'] : v.kind === 'zoned' ? ['kind', 'value', 'tzid'] : ['kind', 'value']);
      }
    }
  });

  it('cover every case the spec lists (§5.5)', () => {
    const rrule = (t: string) => sections.rrules.find((c) => c.text === t);
    // Errors the spec names.
    for (const t of [
      'FREQ=DAILY;COUNT=3;UNTIL=20261231',
      'FREQ=DAILY;INTERVAL=0',
      'FREQ=MONTHLY;BYMONTHDAY=32',
      'FREQ=YEARLY;BYYEARDAY=367',
      'FREQ=YEARLY;BYWEEKNO=54',
      'FREQ=YEARLY;BYMONTH=13',
      'FREQ=DAILY;FREQ=WEEKLY',
    ]) {
      expect(rrule(t), t).toEqual({ text: t, parsed: null, formatted: null });
    }
    // Every part, frequency and UNTIL form.
    const parsed = sections.rrules.flatMap((c) => (c.parsed === null ? [] : [c.parsed]));
    for (const key of RRULE_KEYS.filter((k) => k.startsWith('by'))) {
      expect(parsed.some((p) => (p[key as keyof typeof p] as unknown[]).length > 0), key).toBe(true);
    }
    expect(new Set(parsed.map((p) => p.freq))).toEqual(new Set(['secondly', 'minutely', 'hourly', 'daily', 'weekly', 'monthly', 'yearly']));
    expect(new Set(parsed.map((p) => p.until?.kind ?? null))).toEqual(new Set([null, 'date', 'floating', 'utc']));
    expect(parsed.some((p) => p.interval > 1)).toBe(true);
    expect(parsed.some((p) => p.count !== null)).toBe(true);
    expect(parsed.some((p) => p.wkst !== null)).toBe(true);
    expect(parsed.some((p) => p.rscale !== null)).toBe(true);
    expect(parsed.some((p) => p.skip !== null)).toBe(true);
    expect(parsed.some((p) => p.extensions.length > 0)).toBe(true);
    expect(rrule('RRULE:FREQ=WEEKLY;BYDAY=MO')?.formatted).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(rrule('rrule:freq=weekly;byday=mo')?.formatted).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(rrule('FREQ=DAILY;')?.formatted).toBe('FREQ=DAILY');
    expect(rrule('FREQ=MONTHLY;BYDAY=-1FR')?.parsed?.byDay).toEqual([{ weekday: 5, ordinal: -1 }]);
    expect(rrule('FREQ=MONTHLY;BYDAY=2TU')?.parsed?.byDay).toEqual([{ weekday: 2, ordinal: 2 }]);
    expect(rrule('FREQ=MONTHLY;BYDAY=+3WE')?.parsed?.byDay).toEqual([{ weekday: 3, ordinal: 3 }]);
    expect(rrule('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1')?.parsed?.bySetPos).toEqual([-1]);
    expect(rrule('RSCALE=HEBREW;FREQ=YEARLY;BYMONTHDAY=1')?.parsed?.rscale).toBe('HEBREW');
    expect(rrule('FREQ=DAILY;X-NAME=1')?.parsed?.extensions).toEqual([['X-NAME', '1']]);
    expect(rrule('FREQ=WEEKLY;UNTIL=20261116T165959Z')?.parsed?.until).toEqual({ kind: 'utc', value: '2026-11-16T16:59' });
    // §4.3: the 13-value monthly list and Apple's 52-value weekly list.
    const monthly = rrule('FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18');
    expect(monthly?.formatted).toBe(monthly?.text);
    const weekly = sections.rrules.find((c) => c.parsed?.byYearDay.length === 52)!;
    expect(weekly.text.startsWith('FREQ=YEARLY;BYYEARDAY=5,12,19,26,')).toBe(true);
    expect(weekly.parsed!.byYearDay.slice(20, 26)).toEqual([145, 152, 159, 166, -193, -186]);
    expect(weekly.parsed!.byYearDay.at(-1)).toBe(-4);
    expect(weekly.formatted).toBe(weekly.text);

    const flags = (c: (typeof sections.rruleEquality)[number]) => `${c.ignoreEnd}/${c.ignoreWkst}/${c.equal}`;
    expect(new Set(sections.rruleEquality.map(flags))).toEqual(
      new Set(['false/false/true', 'false/false/false', 'true/false/true', 'true/false/false', 'false/true/true', 'true/true/true']),
    );

    expect(new Set(sections.dateLists.map((c) => c.form))).toEqual(new Set(['date', 'zoned', 'utc']));
    expect(sections.dateLists.filter((c) => c.parsed === null).length).toBeGreaterThanOrEqual(5);
    expect(sections.dateLists.some((c) => c.parsed !== null && new Set(c.parsed.map((v) => v.kind)).size > 1)).toBe(true);
    expect(sections.dateLists.some((c) => /^\s|\s$/.test(c.text) && c.formatted !== null)).toBe(true);
    expect(sections.dateLists.some((c) => c.text === '' && c.formatted === '')).toBe(true);
  });

  it('carry the values the spec states', () => {
    const until = (value: string, zone: string | null, startMinute: number, allDay = false) =>
      sections.untils.find(
        (c) =>
          (c.until.kind === 'date' ? c.until.date : c.until.value) === value &&
          c.zone === zone &&
          c.startMinute === startMinute &&
          c.allDay === allDay,
      );
    // §4.5: UNTIL=20261116T165959Z on a 19:00 Tallinn weekly event is 18:59 local; the series ends before November 16.
    expect(until('2026-11-16T16:59', 'Europe/Tallinn', 1140)).toMatchObject({
      inZone: '2026-11-16T18:59',
      endDate: '2026-11-15',
      text: '20261115T215959Z',
    });
    // UNTIL=20261116T000000Z on a 19:00 event in UTC+2: November 15.
    expect(until('2026-11-16T00:00', 'Europe/Tallinn', 1140)).toMatchObject({ inZone: '2026-11-16T02:00', endDate: '2026-11-15' });
    // An until exactly at an occurrence's start includes it.
    expect(until('2026-11-16T17:00', 'Europe/Tallinn', 1140)).toMatchObject({
      inZone: '2026-11-16T19:00',
      endDate: '2026-11-16',
      text: '20261116T215959Z',
    });
    // The end-of-day value Thirteen writes reads back as its own day.
    expect(until('2026-12-31T21:59', 'Europe/Tallinn', 1140)).toMatchObject({ endDate: '2026-12-31', text: '20261231T215959Z' });
    // A DATE until includes its whole day; a floating one is kept; all-day ends are dates.
    expect(until('2026-12-31', 'Europe/Tallinn', 1439)).toMatchObject({ inZone: '2026-12-31T24:00', endDate: '2026-12-31', text: '20261231T215959Z' });
    expect(until('2026-12-31', null, 0, true)).toMatchObject({ inZone: '2026-12-31T24:00', endDate: '2026-12-31', text: '20261231' });
    expect(until('2026-11-16T00:00', null, 0, true)).toMatchObject({ inZone: '2026-11-16T00:00', endDate: '2026-11-16', text: '20261116' });
    expect(until('2026-11-16T18:59', 'Europe/Tallinn', 1140)).toMatchObject({ inZone: '2026-11-16T18:59', endDate: '2026-11-15' });
    expect(until('2026-11-16T19:00', null, 1140)).toMatchObject({ endDate: '2026-11-16', text: '20261116T235959' });
    // The event's zone decides, and New York's written end moves by an hour between winter and summer.
    expect(until('2026-11-16T23:59', 'America/New_York', 1140)).toMatchObject({ endDate: '2026-11-15', text: '20261116T045959Z' });
    expect(until('2026-11-16T23:59', 'Europe/Tallinn', 1140)).toMatchObject({ endDate: '2026-11-16' });
    expect(until('2026-07-15T22:59', 'America/New_York', 1140)).toMatchObject({ endDate: '2026-07-14', text: '20260715T035959Z' });
    expect(until('2026-07-16T03:59', 'America/New_York', 600)).toMatchObject({ endDate: '2026-07-15', text: '20260716T035959Z' });
    // The range edges: outside years 1 to 9999 in the event's zone, and the end of 9999-12-31 west of UTC.
    expect(until('9999-12-31T23:59', 'Pacific/Kiritimati', 0)).toMatchObject({ inZone: null, endDate: null, text: null });
    expect(until('0001-01-01T00:00', 'America/New_York', 0)).toMatchObject({ inZone: null, endDate: null, text: null });
    expect(until('9999-12-31', 'Pacific/Kiritimati', 1439)).toMatchObject({ endDate: '9999-12-31', text: '99991231T095959Z' });
    expect(until('9999-12-31', 'America/New_York', 1439)).toMatchObject({ endDate: '9999-12-31', text: '99991231T235959Z' });
    expect(until('0001-01-01T00:30', null, 60)).toMatchObject({ inZone: '0001-01-01T00:30', endDate: null, text: null });

    const list = (t: string) => sections.dateLists.find((c) => c.text === t)!;
    expect(list('20261116,20261214').formatted).toBe('20261116,20261214');
    expect(list('Europe/Tallinn;20261116T190000,20261214T190000').parsed).toEqual([
      { kind: 'zoned', value: '2026-11-16T19:00', tzid: 'Europe/Tallinn' },
      { kind: 'zoned', value: '2026-12-14T19:00', tzid: 'Europe/Tallinn' },
    ]);
    expect(list('20261116T170000Z,20261214T170000Z').parsed?.map((v) => v.kind)).toEqual(['utc', 'utc']);
    expect(list('Europe/Tallinn;20261116T190000,20261214T170000Z')).toMatchObject({ formatted: null });
    expect(list('20260230')).toMatchObject({ parsed: null, formatted: null });
  });

  it('write end dates that read back as themselves', () => {
    for (const c of sections.untils) {
      if (c.text === null || c.endDate === null) continue;
      // The end of 9999-12-31 in New York is in year 10000; the written value stops at the last UTC minute.
      if (c.text === '99991231T235959Z' && c.zone === 'America/New_York') continue;
      const written = parseRRule(`FREQ=DAILY;UNTIL=${c.text}`).until!;
      const inZone = untilInZone(written, c.zone, zones)!;
      expect(toISODate(untilEndDate(inZone, c.startMinute)), `${c.text} ${c.zone}`).toBe(c.endDate);
      expect(written.kind, c.text).toBe(c.allDay ? 'date' : c.zone === null ? 'floating' : 'utc');
    }
  });

  it('round-trip: every parsed value formats and parses back to itself', () => {
    for (const c of sections.rrules) {
      if (c.formatted === null) continue;
      expect(rruleJson(parseRRule(c.formatted)), c.text).toEqual(c.parsed);
      expect(formatRRule(parseRRule(c.formatted))).toBe(c.formatted);
      expect(rruleJson(rruleFromJson(c.parsed!))).toEqual(c.parsed);
    }
    for (const c of sections.dateLists) {
      if (c.formatted === null) continue;
      expect(parseDateList(c.formatted).map(dateListValueJson), c.text).toEqual(c.parsed);
      expect(c.parsed!.map(dateListValueFromJson).map(dateListValueJson)).toEqual(c.parsed);
    }
  });

  it('replay from the JSON alone, as every port does', () => {
    for (const c of json.rrules) {
      const parsed = tryParseRRule(c.text);
      expect(parsed === null ? null : rruleJson(parsed), c.text).toEqual(c.parsed);
      expect(c.parsed === null ? null : formatRRule(rruleFromJson(c.parsed))).toBe(c.formatted);
    }
    for (const c of json.rruleEquality) {
      expect(rruleEquals(parseRRule(c.a), parseRRule(c.b), { ignoreEnd: c.ignoreEnd, ignoreWkst: c.ignoreWkst })).toBe(c.equal);
    }
    for (const c of json.untils) {
      const inZone = untilInZone(rruleUntilFromJson(c.until), c.zone, zones);
      expect(text(inZone)).toBe(c.inZone);
      const endDate = inZone === null ? null : attempt(() => untilEndDate(inZone, c.startMinute));
      expect(endDate === null ? null : toISODate(endDate)).toBe(c.endDate);
      expect(c.endDate === null ? null : formatUntil(parseISODate(c.endDate), c.allDay, c.zone, zones)).toBe(c.text);
    }
    for (const c of json.dateLists) {
      const parsed = attempt(() => parseDateList(c.text));
      expect(parsed === null ? null : parsed.map(dateListValueJson), JSON.stringify(c.text)).toEqual(c.parsed);
      const values = c.parsed === null ? null : c.parsed.map(dateListValueFromJson);
      expect(values === null ? null : attempt(() => formatDateList(values, c.form))).toBe(c.formatted);
    }
  });

  it('contain no em or en dash and stay small', () => {
    const all = JSON.stringify(sections);
    expect(all).not.toMatch(/[–—]/);
    expect(Buffer.byteLength(all)).toBeLessThan(60 * 1000);
  });
});
