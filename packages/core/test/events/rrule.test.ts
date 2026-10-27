/**
 * events/rrule.ts: RRULE parsing, canonical formatting, equality and the
 * reading of UNTIL (docs/EVENTS.md §4.4, §4.5, §5.2). `ical.js` 2.2 is the
 * oracle for what a rule means: the canonical text must expand exactly like the
 * text it came from, `untilEndDate` must end a series where `ical.js` ends it,
 * and an `UNTIL` written by `formatUntil` must end it on its end date.
 */
import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { buildRRules } from '../../scripts/events-fixtures.ts';
import { intlZoneResolver, syntheticZoneResolver } from '../../scripts/zone-resolvers.ts';
import {
  type LocalDateTime,
  type RRule,
  type RRuleUntil,
  formatLocalDateTime,
  formatRRule,
  formatUntil,
  parseLocalDateTime,
  parseRRule,
  rruleEquals,
  tryParseRRule,
  untilEndDate,
  untilInZone,
} from '../../src/events/index.ts';
import { assertValidRRule, copyRRule, parseICalValue, parseWeekdayCode, weekdayCode } from '../../src/events/rrule.ts';
import { addGregorianDays, toISODate } from '../../src/index.ts';
import { g } from '../helpers.ts';

const L = parseLocalDateTime;
const text = (value: LocalDateTime | null) => (value === null ? null : formatLocalDateTime(value));
/** Every `rrules` fixture text, valid and invalid. */
const RRULE_TEXTS_FOR_TESTS: readonly string[] = buildRRules().map((c) => c.text);

/** A small deterministic PRNG (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EMPTY: RRule = {
  freq: 'daily',
  interval: 1,
  count: null,
  until: null,
  bySecond: [],
  byMinute: [],
  byHour: [],
  byDay: [],
  byMonthDay: [],
  byYearDay: [],
  byWeekNo: [],
  byMonth: [],
  bySetPos: [],
  wkst: null,
  rscale: null,
  skip: null,
  extensions: [],
};
const rule = (fields: Partial<RRule>): RRule => ({ ...EMPTY, ...fields });

describe('parseRRule', () => {
  it('reads every part into the declared fields, in declaration order', () => {
    const parsed = parseRRule(
      'FREQ=YEARLY;INTERVAL=2;UNTIL=20261116T165959Z;BYSECOND=0,30;BYMINUTE=15;BYHOUR=9,17;BYDAY=MO,-1FR,+2TU;' +
        'BYMONTHDAY=1,-1;BYYEARDAY=12,-18;BYWEEKNO=1,-53;BYMONTH=3,9;BYSETPOS=1,-366;WKST=SU;RSCALE=GREGORIAN;SKIP=OMIT;X-A=1',
    );
    expect(Object.keys(parsed)).toEqual(Object.keys(EMPTY));
    expect(parsed).toEqual({
      freq: 'yearly',
      interval: 2,
      count: null,
      until: { kind: 'utc', value: L('2026-11-16T16:59') },
      bySecond: [0, 30],
      byMinute: [15],
      byHour: [9, 17],
      byDay: [
        { weekday: 1, ordinal: null },
        { weekday: 5, ordinal: -1 },
        { weekday: 2, ordinal: 2 },
      ],
      byMonthDay: [1, -1],
      byYearDay: [12, -18],
      byWeekNo: [1, -53],
      byMonth: [3, 9],
      bySetPos: [1, -366],
      wkst: 0,
      rscale: 'GREGORIAN',
      skip: 'OMIT',
      extensions: [['X-A', '1']],
    });
  });

  it.each([
    ['FREQ=DAILY;UNTIL=20261231', { kind: 'date', date: g('2026-12-31') }],
    ['FREQ=DAILY;UNTIL=20261116T190000', { kind: 'floating', value: L('2026-11-16T19:00') }],
    ['FREQ=DAILY;UNTIL=20261116T165959Z', { kind: 'utc', value: L('2026-11-16T16:59') }],
    ['FREQ=DAILY;UNTIL=20261116t165959z', { kind: 'utc', value: L('2026-11-16T16:59') }],
    ['FREQ=DAILY;UNTIL=20241231T235960Z', { kind: 'utc', value: L('2024-12-31T23:59') }],
    ['FREQ=DAILY;UNTIL=00010101T000000', { kind: 'floating', value: L('0001-01-01T00:00') }],
    ['FREQ=DAILY;UNTIL=99991231', { kind: 'date', date: g('9999-12-31') }],
  ] as const)('reads %s, dropping seconds', (input, until) => {
    expect(parseRRule(input).until).toEqual(until);
  });

  it('accepts the RRULE: prefix, any case, any order and one trailing semicolon', () => {
    const expected = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;WKST=SU');
    for (const input of [
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;WKST=SU',
      'rrule:freq=weekly;interval=2;byday=mo;wkst=su',
      'Rrule:Freq=Weekly;Interval=2;ByDay=Mo;WkSt=Su;',
      'WKST=SU;BYDAY=MO;INTERVAL=2;FREQ=WEEKLY',
      'FREQ=WEEKLY;INTERVAL=02;BYDAY=MO;WKST=SU',
    ]) {
      expect(parseRRule(input), input).toEqual(expected);
    }
  });

  it('keeps list order and duplicates, normalizes signs and leading zeros', () => {
    expect(parseRRule('FREQ=MONTHLY;BYMONTHDAY=15,01,15,+3').byMonthDay).toEqual([15, 1, 15, 3]);
    expect(parseRRule('FREQ=MONTHLY;BYDAY=+3WE,-01FR,1mo').byDay).toEqual([
      { weekday: 3, ordinal: 3 },
      { weekday: 5, ordinal: -1 },
      { weekday: 1, ordinal: 1 },
    ]);
  });

  it('stores RSCALE, SKIP and X- names uppercase and X- values verbatim, in order', () => {
    const parsed = parseRRule('FREQ=DAILY;x-b=Two;RSCALE=hebrew;SKIP=forward;X-A=one,1');
    expect(parsed.rscale).toBe('HEBREW');
    expect(parsed.skip).toBe('FORWARD');
    expect(parsed.extensions).toEqual([
      ['X-B', 'Two'],
      ['X-A', 'one,1'],
    ]);
  });

  it('accepts well-formed parts the RFC discourages, for expansion to judge', () => {
    expect(parseRRule('FREQ=WEEKLY;BYDAY=1MO').byDay).toEqual([{ weekday: 1, ordinal: 1 }]);
    expect(parseRRule('FREQ=MONTHLY;BYWEEKNO=1').byWeekNo).toEqual([1]);
    expect(parseRRule('FREQ=MONTHLY;BYMONTHDAY=31;SKIP=FORWARD').skip).toBe('FORWARD');
    expect(parseRRule('FREQ=DAILY;BYYEARDAY=366').byYearDay).toEqual([366]);
  });

  it.each([
    ['', 'FREQ is required'],
    [';', 'FREQ is required'],
    ['RRULE:', 'FREQ is required'],
    ['BYDAY=MO', 'FREQ is required'],
    ['FREQ=FORTNIGHTLY', 'unknown FREQ'],
    ['FREQ=WEEKLY1', 'unknown FREQ'],
    ['FREQ=DAILY;COUNT=3;UNTIL=20261231', 'COUNT and UNTIL'],
    ['FREQ=DAILY;INTERVAL=0', 'INTERVAL'],
    ['FREQ=DAILY;INTERVAL=-1', 'INTERVAL'],
    ['FREQ=DAILY;INTERVAL=+1', 'INTERVAL'],
    ['FREQ=DAILY;COUNT=0', 'COUNT'],
    ['FREQ=DAILY;COUNT=2147483648', 'COUNT'],
    ['FREQ=DAILY;COUNT=12345678901', 'COUNT'],
    ['FREQ=DAILY;COUNT=1.5', 'COUNT'],
    ['FREQ=DAILY;FREQ=WEEKLY', 'more than once'],
    ['FREQ=WEEKLY;BYDAY=MO;byday=TU', 'more than once'],
    ['FREQ=DAILY;X-A=1;x-a=2', 'more than once'],
    ['FREQ=DAILY;FOO=1', 'unknown part FOO'],
    ['FREQ=DAILY;X-=1', 'unknown part'],
    ['EXRULE:FREQ=DAILY', 'NAME=VALUE'],
    ['FREQ=DAILY; COUNT=2', 'NAME=VALUE'],
    ['FREQ=DAILY;COUNT=2 ', 'COUNT'],
    [' FREQ=DAILY', 'NAME=VALUE'],
    ['FREQ=DAILY;;COUNT=2', 'NAME=VALUE'],
    ['FREQ=DAILY;;', 'NAME=VALUE'],
    ['FREQ=DAILY;COUNT', 'NAME=VALUE'],
    ['FREQ=DAILY;=2', 'NAME=VALUE'],
    ['FREQ=DAILY;COUNT=', 'no value'],
    ['FREQ=MONTHLY;BYMONTHDAY=1,,15', 'empty list item'],
    ['FREQ=MONTHLY;BYMONTHDAY=1,', 'empty list item'],
    ['FREQ=MONTHLY;BYMONTHDAY=32', 'BYMONTHDAY'],
    ['FREQ=MONTHLY;BYMONTHDAY=-32', 'BYMONTHDAY'],
    ['FREQ=MONTHLY;BYMONTHDAY=0', 'BYMONTHDAY'],
    ['FREQ=MONTHLY;BYMONTHDAY=001', 'BYMONTHDAY'],
    ['FREQ=YEARLY;BYYEARDAY=367', 'BYYEARDAY'],
    ['FREQ=YEARLY;BYYEARDAY=-367', 'BYYEARDAY'],
    ['FREQ=YEARLY;BYWEEKNO=54', 'BYWEEKNO'],
    ['FREQ=YEARLY;BYWEEKNO=0', 'BYWEEKNO'],
    ['FREQ=YEARLY;BYMONTH=13', 'BYMONTH'],
    ['FREQ=YEARLY;BYMONTH=0', 'BYMONTH'],
    ['FREQ=YEARLY;BYMONTH=+3', 'BYMONTH'],
    ['FREQ=YEARLY;BYMONTH=-3', 'BYMONTH'],
    ['FREQ=MONTHLY;BYSETPOS=0', 'BYSETPOS'],
    ['FREQ=MONTHLY;BYSETPOS=367', 'BYSETPOS'],
    ['FREQ=DAILY;BYHOUR=24', 'BYHOUR'],
    ['FREQ=DAILY;BYMINUTE=60', 'BYMINUTE'],
    ['FREQ=DAILY;BYSECOND=61', 'BYSECOND'],
    ['FREQ=WEEKLY;BYDAY=XX', 'BYDAY'],
    ['FREQ=WEEKLY;BYDAY=MON', 'BYDAY'],
    ['FREQ=MONTHLY;BYDAY=0MO', 'BYDAY'],
    ['FREQ=MONTHLY;BYDAY=54MO', 'BYDAY'],
    ['FREQ=MONTHLY;BYDAY=-54MO', 'BYDAY'],
    ['FREQ=MONTHLY;BYDAY=+MO', 'BYDAY'],
    ['FREQ=MONTHLY;BYDAY=1 MO', 'BYDAY'],
    ['FREQ=WEEKLY;WKST=MON', 'WKST'],
    ['FREQ=WEEKLY;WKST=1', 'WKST'],
    ['FREQ=DAILY;UNTIL=20260230', 'UNTIL'],
    ['FREQ=DAILY;UNTIL=00001231', 'UNTIL'],
    ['FREQ=DAILY;UNTIL=100000101', 'UNTIL'],
    ['FREQ=DAILY;UNTIL=20261116T240000Z', 'UNTIL'],
    ['FREQ=DAILY;UNTIL=20261116T236000Z', 'UNTIL'],
    ['FREQ=DAILY;UNTIL=20261116T235961Z', 'UNTIL'],
    ['FREQ=DAILY;UNTIL=2026-11-16', 'UNTIL'],
    ['FREQ=DAILY;UNTIL=20261116T1659Z', 'UNTIL'],
    ['FREQ=DAILY;UNTIL=20261116T165959+0200', 'UNTIL'],
    ['RSCALE=HEBREW;FREQ=YEARLY;BYMONTH=5L;BYMONTHDAY=8;SKIP=FORWARD', 'BYMONTH'],
    ['FREQ=DAILY;RSCALE=GREGORIAN CALENDAR', 'RSCALE'],
    ['FREQ=DAILY;RSCALE=HEBR_EW', 'RSCALE'],
    ['FREQ=DAILY;SKIP=SOMETIMES', 'SKIP'],
    ['FREQ=DAILY;X-NAME=a b', 'X-NAME'],
    ['FREQ=DAILY;X-NAME=a\tb', 'X-NAME'],
  ])('rejects %j (%s)', (input, message) => {
    expect(() => parseRRule(input)).toThrow(RangeError);
    expect(() => parseRRule(input)).toThrow(message);
    expect(tryParseRRule(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(() => parseRRule(42 as unknown as string)).toThrow(RangeError);
    expect(tryParseRRule(null as unknown as string)).toBeNull();
  });

  it('returns fresh values', () => {
    const a = parseRRule('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231');
    const b = parseRRule('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231');
    expect(a).toEqual(b);
    expect(a.byDay).not.toBe(b.byDay);
  });
});

describe('formatRRule', () => {
  it('writes the canonical order of §5.2 without a prefix', () => {
    const parsed = parseRRule(
      'X-A=1;SKIP=OMIT;RSCALE=GREGORIAN;WKST=SU;BYSETPOS=-1;BYMONTH=3;BYWEEKNO=1;BYYEARDAY=60;BYMONTHDAY=1;BYDAY=MO;' +
        'BYHOUR=9;BYMINUTE=0;BYSECOND=0;COUNT=3;INTERVAL=2;FREQ=YEARLY',
    );
    expect(formatRRule(parsed)).toBe(
      'FREQ=YEARLY;INTERVAL=2;COUNT=3;BYSECOND=0;BYMINUTE=0;BYHOUR=9;BYDAY=MO;BYMONTHDAY=1;BYYEARDAY=60;BYWEEKNO=1;' +
        'BYMONTH=3;BYSETPOS=-1;WKST=SU;RSCALE=GREGORIAN;SKIP=OMIT;X-A=1',
    );
  });

  it.each([
    ['FREQ=DAILY;INTERVAL=1', 'FREQ=DAILY'],
    ['byday=+2tu;freq=monthly;interval=1', 'FREQ=MONTHLY;BYDAY=2TU'],
    ['FREQ=MONTHLY;BYDAY=-01FR;BYMONTHDAY=+05', 'FREQ=MONTHLY;BYDAY=-1FR;BYMONTHDAY=5'],
    ['FREQ=DAILY;UNTIL=20261231', 'FREQ=DAILY;UNTIL=20261231'],
    ['FREQ=DAILY;UNTIL=20261116T170000Z', 'FREQ=DAILY;UNTIL=20261116T170059Z'],
    ['FREQ=DAILY;UNTIL=20261231T215959Z', 'FREQ=DAILY;UNTIL=20261231T215959Z'],
    ['FREQ=DAILY;UNTIL=20261231T235959', 'FREQ=DAILY;UNTIL=20261231T235959'],
    ['FREQ=DAILY;UNTIL=00010101T000000Z', 'FREQ=DAILY;UNTIL=00010101T000059Z'],
    ['FREQ=WEEKLY;BYDAY=MO,MO', 'FREQ=WEEKLY;BYDAY=MO,MO'],
    ['RRULE:FREQ=DAILY;', 'FREQ=DAILY'],
  ])('formats %s as %s', (input, output) => {
    expect(formatRRule(parseRRule(input))).toBe(output);
  });

  it.each([
    ['freq', { freq: 'fortnightly' }],
    ['interval 0', { interval: 0 }],
    ['interval 1.5', { interval: 1.5 }],
    ['count 0', { count: 0 }],
    ['count above int32', { count: 2_147_483_648 }],
    ['count and until', { count: 3, until: { kind: 'date', date: g('2026-12-31') } }],
    ['until 24:00', { until: { kind: 'utc', value: L('2026-12-31T24:00') } }],
    ['until kind', { until: { kind: 'zoned', value: L('2026-12-31T10:00') } }],
    ['until date', { until: { kind: 'date', date: { year: 2026, month: 2, day: 30 } } }],
    ['byMonthDay 0', { byMonthDay: [0] }],
    ['byYearDay 367', { byYearDay: [367] }],
    ['byMonth 13', { byMonth: [13] }],
    ['bySecond 61', { bySecond: [61] }],
    ['byHour not an array', { byHour: 9 }],
    ['byDay ordinal 0', { byDay: [{ weekday: 1, ordinal: 0 }] }],
    ['byDay weekday 7', { byDay: [{ weekday: 7, ordinal: null }] }],
    ['wkst 7', { wkst: 7 }],
    ['lowercase rscale', { rscale: 'hebrew' }],
    ['empty rscale', { rscale: '' }],
    ['skip', { skip: 'omit' }],
    ['extension name', { extensions: [['X-a', '1']] }],
    ['extension without X-', { extensions: [['FOO', '1']] }],
    ['extension value with ;', { extensions: [['X-A', '1;2']] }],
    ['empty extension value', { extensions: [['X-A', '']] }],
  ] as const)('rejects an invalid rule (%s)', (_, fields) => {
    const invalid = rule(fields as unknown as Partial<RRule>);
    expect(() => formatRRule(invalid)).toThrow(RangeError);
    expect(() => assertValidRRule(invalid)).toThrow(RangeError);
  });

  it('rejects non-objects and missing fields', () => {
    expect(() => formatRRule(null as unknown as RRule)).toThrow(RangeError);
    const { extensions: _, ...missing } = EMPTY;
    expect(() => formatRRule(missing as unknown as RRule)).toThrow(RangeError);
  });

  it('round-trips random valid rules: parse(format(rule)) equals rule', () => {
    const next = random(20261019);
    const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
    const pick = <T>(values: readonly T[]): T => values[int(0, values.length - 1)]!;
    const signed = (max: number) => (next() < 0.5 ? -1 : 1) * int(1, max);
    const list = (make: () => number) => Array.from({ length: next() < 0.5 ? 0 : int(1, 4) }, make);
    const local = (): LocalDateTime => ({ date: { year: int(1, 9999), month: int(1, 12), day: int(1, 28) }, minute: int(0, 1439) });
    for (let i = 0; i < 2000; i++) {
      const end = next();
      const until: RRuleUntil | null =
        end < 0.2
          ? { kind: 'date', date: local().date }
          : end < 0.4
            ? { kind: 'utc', value: local() }
            : end < 0.5
              ? { kind: 'floating', value: local() }
              : null;
      const value: RRule = {
        freq: pick(['secondly', 'minutely', 'hourly', 'daily', 'weekly', 'monthly', 'yearly'] as const),
        interval: next() < 0.5 ? 1 : int(1, 2_147_483_647),
        count: until === null && next() < 0.5 ? int(1, 2_147_483_647) : null,
        until,
        bySecond: list(() => int(0, 60)),
        byMinute: list(() => int(0, 59)),
        byHour: list(() => int(0, 23)),
        byDay: list(() => int(0, 6)).map((weekday) => ({
          weekday: weekday as RRule['byDay'][number]['weekday'],
          ordinal: next() < 0.5 ? null : signed(53),
        })),
        byMonthDay: list(() => signed(31)),
        byYearDay: list(() => signed(366)),
        byWeekNo: list(() => signed(53)),
        byMonth: list(() => int(1, 12)),
        bySetPos: list(() => signed(366)),
        wkst: next() < 0.5 ? null : (int(0, 6) as RRule['wkst']),
        rscale: next() < 0.8 ? null : pick(['GREGORIAN', 'HEBREW', 'CHINESE', 'X-CUSTOM-1']),
        skip: next() < 0.8 ? null : pick(['OMIT', 'BACKWARD', 'FORWARD']),
        extensions: next() < 0.8 ? [] : [['X-THIRTEEN', pick(['1', 'a,b', 'Väärtus', '=='])]],
      };
      const formatted = formatRRule(value);
      expect(parseRRule(formatted), formatted).toEqual(value);
      expect(formatRRule(parseRRule(`RRULE:${formatted.toLowerCase()}`)).toUpperCase(), formatted).toBe(formatted.toUpperCase());
    }
  });

  it('is a fixed point on its own output', () => {
    for (const input of RRULE_TEXTS_FOR_TESTS) {
      const parsed = tryParseRRule(input);
      if (parsed === null) continue;
      const formatted = formatRRule(parsed);
      expect(formatRRule(parseRRule(formatted)), input).toBe(formatted);
      expect(rruleEquals(parseRRule(formatted), parsed), input).toBe(true);
    }
  });
});

describe('ical.js agrees on what the canonical text means', () => {
  /** The first 40 occurrences `ical.js` expands for `rule` from a floating start. */
  function icalOccurrences(ruleText: string, start = '20260101T093000'): string[] | null {
    let recur: ReturnType<typeof ICAL.Recur.fromString>;
    try {
      recur = ICAL.Recur.fromString(ruleText);
    } catch {
      return null;
    }
    const iterator = recur.iterator(ICAL.Time.fromDateTimeString(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T09:30:00`));
    const out: string[] = [];
    for (let next = iterator.next(); next && out.length < 40; next = iterator.next()) out.push(next.toString());
    return out;
  }

  it('expands every valid rule text and its canonical form identically', () => {
    let compared = 0;
    for (const input of RRULE_TEXTS_FOR_TESTS) {
      const parsed = tryParseRRule(input);
      if (parsed === null || parsed.rscale !== null || parsed.skip !== null) continue;
      const original = icalOccurrences(input.replace(/^RRULE:/i, ''));
      if (original === null) continue; // ical.js rejects lowercase values
      expect(icalOccurrences(formatRRule(parsed)), input).toEqual(original);
      compared++;
    }
    expect(compared).toBeGreaterThan(40);
  });

  it('reads the same parts as ical.js', () => {
    for (const input of ['FREQ=MONTHLY;INTERVAL=2;BYDAY=MO,-1FR,+2TU;BYSETPOS=1,-1;WKST=SU', 'FREQ=YEARLY;BYYEARDAY=12,-18;BYWEEKNO=1;COUNT=4']) {
      const ours = parseRRule(input);
      const theirs = ICAL.Recur.fromString(input);
      expect(ours.freq.toUpperCase()).toBe(theirs.freq);
      expect(ours.interval).toBe(theirs.interval);
      expect(ours.count).toBe(theirs.count ?? null);
      const parts = theirs.parts as Record<string, (string | number)[] | undefined>;
      expect(ours.byDay.map((d) => `${d.ordinal ?? ''}${weekdayCode(d.weekday)}`)).toEqual((parts.BYDAY ?? []).map((d) => String(d).replace('+', '')));
      expect(ours.bySetPos).toEqual(parts.BYSETPOS ?? []);
      expect(ours.byYearDay).toEqual(parts.BYYEARDAY ?? []);
      expect(ours.byWeekNo).toEqual(parts.BYWEEKNO ?? []);
    }
  });
});

describe('rruleEquals', () => {
  const eq = (a: string, b: string, options?: { ignoreEnd?: boolean; ignoreWkst?: boolean }) =>
    rruleEquals(parseRRule(a), parseRRule(b), options);

  it('compares lists as sets and applies the RFC defaults', () => {
    expect(eq('FREQ=WEEKLY;BYDAY=MO,WE', 'FREQ=WEEKLY;BYDAY=WE,MO,MO')).toBe(true);
    expect(eq('FREQ=DAILY', 'FREQ=DAILY;INTERVAL=1;WKST=MO;RSCALE=GREGORIAN')).toBe(true);
    expect(eq('RSCALE=GREGORIAN;FREQ=MONTHLY', 'RSCALE=GREGORIAN;FREQ=MONTHLY;SKIP=OMIT')).toBe(true);
    expect(eq('FREQ=DAILY', 'FREQ=DAILY;WKST=SU')).toBe(false);
    expect(eq('FREQ=MONTHLY;BYDAY=1MO', 'FREQ=MONTHLY;BYDAY=MO')).toBe(false);
    expect(eq('FREQ=MONTHLY;BYDAY=1MO', 'FREQ=MONTHLY;BYDAY=-1MO')).toBe(false);
    expect(eq('FREQ=YEARLY;BYMONTH=1', 'FREQ=YEARLY;BYMONTHDAY=1')).toBe(false);
    expect(eq('FREQ=DAILY;X-A=1', 'FREQ=DAILY;X-A=1;X-A2=1')).toBe(false);
  });

  it('compares ends unless ignoreEnd, WKST unless ignoreWkst', () => {
    expect(eq('FREQ=DAILY;COUNT=3', 'FREQ=DAILY')).toBe(false);
    expect(eq('FREQ=DAILY;COUNT=3', 'FREQ=DAILY', { ignoreEnd: true })).toBe(true);
    expect(eq('FREQ=DAILY;UNTIL=20261231', 'FREQ=DAILY;UNTIL=20261231T000000')).toBe(false);
    expect(eq('FREQ=DAILY;UNTIL=20261231T120000Z', 'FREQ=DAILY;UNTIL=20261231T120000')).toBe(false);
    expect(eq('FREQ=DAILY;UNTIL=20261231T120000Z', 'FREQ=DAILY;UNTIL=20261231T120030Z')).toBe(true);
    expect(eq('FREQ=DAILY;WKST=SU;COUNT=2', 'FREQ=DAILY', { ignoreWkst: true })).toBe(false);
    expect(eq('FREQ=DAILY;WKST=SU;COUNT=2', 'FREQ=DAILY', { ignoreWkst: true, ignoreEnd: true })).toBe(true);
    expect(eq('FREQ=DAILY;INTERVAL=2', 'FREQ=DAILY', { ignoreWkst: true, ignoreEnd: true })).toBe(false);
  });

  it('is reflexive, symmetric and insensitive to list order on every fixture text', () => {
    const rules = RRULE_TEXTS_FOR_TESTS.map(tryParseRRule).filter((r): r is RRule => r !== null);
    for (const a of rules) {
      const shuffled: RRule = {
        ...copyRRule(a),
        byDay: [...a.byDay].reverse(),
        byYearDay: [...a.byYearDay].reverse(),
        byMonthDay: [...a.byMonthDay, ...a.byMonthDay],
      };
      expect(rruleEquals(a, a)).toBe(true);
      expect(rruleEquals(a, shuffled)).toBe(true);
      for (const b of rules) expect(rruleEquals(a, b)).toBe(rruleEquals(b, a));
    }
  });

  it('validates its arguments', () => {
    const daily = parseRRule('FREQ=DAILY');
    expect(() => rruleEquals(daily, { ...daily, interval: 0 })).toThrow(RangeError);
    expect(() => rruleEquals(daily, daily, { ignoreEnd: 'yes' as unknown as boolean })).toThrow(RangeError);
    expect(() => rruleEquals(daily, daily, { ignoreCount: true } as never)).toThrow(RangeError);
    expect(() => rruleEquals(daily, daily, [] as never)).toThrow(RangeError);
  });
});

describe('untilInZone', () => {
  const zones = intlZoneResolver();
  const until = (value: string): RRuleUntil => parseRRule(`FREQ=DAILY;UNTIL=${value}`).until!;

  it.each([
    ['20261116T165959Z', 'Europe/Tallinn', '2026-11-16T18:59'],
    ['20261116T000000Z', 'Europe/Tallinn', '2026-11-16T02:00'],
    ['20261231T215959Z', 'Europe/Tallinn', '2026-12-31T23:59'],
    ['20260708T120000Z', 'Europe/Tallinn', '2026-07-08T15:00'],
    ['20261116T235959Z', 'America/New_York', '2026-11-16T18:59'],
    ['20260308T065959Z', 'America/New_York', '2026-03-08T01:59'],
    ['20260308T070000Z', 'America/New_York', '2026-03-08T03:00'],
    ['20261101T053000Z', 'America/New_York', '2026-11-01T01:30'],
    ['20261101T063000Z', 'America/New_York', '2026-11-01T01:30'],
    ['20261116T000000Z', 'Asia/Kathmandu', '2026-11-16T05:45'],
    ['20261116T000000Z', 'UTC', '2026-11-16T00:00'],
    ['20261231', 'Europe/Tallinn', '2026-12-31T24:00'],
    ['20261116T185900', 'America/New_York', '2026-11-16T18:59'],
    ['99991231T090000Z', 'Asia/Tokyo', '9999-12-31T18:00'],
  ])('reads UNTIL=%s in %s as %s (real tzdata)', (value, zone, expected) => {
    expect(text(untilInZone(until(value), zone, zones))).toBe(expected);
  });

  it('keeps floating and UTC wall clocks for floating or all-day events (zone null)', () => {
    expect(text(untilInZone(until('20261116T190000'), null, zones))).toBe('2026-11-16T19:00');
    expect(text(untilInZone(until('20261116T170000Z'), null, zones))).toBe('2026-11-16T17:00');
    expect(text(untilInZone(until('20261231'), null, zones))).toBe('2026-12-31T24:00');
  });

  it('returns null when a UTC until leaves years 1 to 9999', () => {
    expect(untilInZone(until('99991231T235959Z'), 'Asia/Tokyo', zones)).toBeNull();
    expect(untilInZone(until('00010101T000000Z'), 'America/New_York', zones)).toBeNull();
    expect(text(untilInZone(until('99991231'), 'Pacific/Kiritimati', zones))).toBe('9999-12-31T24:00');
  });

  it('validates the until and the zone', () => {
    expect(() => untilInZone({ kind: 'utc', value: L('2026-11-16T24:00') }, 'UTC', zones)).toThrow(RangeError);
    expect(() => untilInZone({ kind: 'local' } as unknown as RRuleUntil, 'UTC', zones)).toThrow(RangeError);
    expect(() => untilInZone(until('20261231'), 'Mars/Olympus_Mons', zones)).toThrow(RangeError);
    expect(() => untilInZone(until('20261231'), '', zones)).toThrow(RangeError);
    expect(() => untilInZone(until('20261116T170000Z'), 'UTC', {} as never)).toThrow(RangeError);
  });

  it('returns fresh values', () => {
    const value = until('20261116T190000');
    const result = untilInZone(value, null, zones)!;
    expect(result).toEqual(value.kind === 'floating' ? value.value : null);
    expect(result).not.toBe(value.kind === 'floating' ? value.value : null);
  });

  it('agrees with the synthetic copy of 2026 Tallinn used by the fixtures', () => {
    const synthetic = syntheticZoneResolver({
      name: 'Europe/Tallinn',
      offset: 120,
      transitions: [
        { at: '2026-03-29T01:00', offset: 180 },
        { at: '2026-10-25T01:00', offset: 120 },
      ],
    });
    for (let day = 0; day < 365; day += 3) {
      for (const minute of [0, 59, 60, 61, 181, 1439]) {
        const value: RRuleUntil = { kind: 'utc', value: { date: addGregorianDays(g('2026-01-01'), day), minute } };
        expect(untilInZone(value, 'Europe/Tallinn', synthetic)).toEqual(untilInZone(value, 'Europe/Tallinn', zones));
      }
    }
  });
});

describe('untilEndDate', () => {
  it.each([
    ['2026-11-16T18:59', 1140, '2026-11-15'],
    ['2026-11-16T19:00', 1140, '2026-11-16'],
    ['2026-11-16T02:00', 1140, '2026-11-15'],
    ['2026-11-16T00:00', 0, '2026-11-16'],
    ['2026-11-16T00:00', 1, '2026-11-15'],
    ['2026-12-31T24:00', 1439, '2026-12-31'],
    ['2026-12-31T24:00', 0, '2026-12-31'],
    ['2027-01-01T00:00', 30, '2026-12-31'],
    ['2024-03-01T08:00', 600, '2024-02-29'],
    ['9999-12-31T24:00', 1439, '9999-12-31'],
    ['0001-01-01T01:00', 60, '0001-01-01'],
  ])('ends an until of %s at start minute %i on %s', (value, startMinute, expected) => {
    expect(toISODate(untilEndDate(L(value), startMinute))).toBe(expected);
  });

  it('throws before 0001-01-01 and for invalid input', () => {
    expect(() => untilEndDate(L('0001-01-01T00:30'), 60)).toThrow(RangeError);
    expect(() => untilEndDate(L('2026-11-16T18:59'), 1440)).toThrow(RangeError);
    expect(() => untilEndDate(L('2026-11-16T18:59'), -1)).toThrow(RangeError);
    expect(() => untilEndDate(L('2026-11-16T18:59'), 1.5)).toThrow(RangeError);
    expect(() => untilEndDate({ date: g('2026-11-16'), minute: 1441 }, 0)).toThrow(RangeError);
  });

  it('ends a daily series exactly where ical.js ends it (floating start and until)', () => {
    const next = random(45);
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    for (let i = 0; i < 300; i++) {
      const startMinute = Math.floor(next() * 1440);
      const untilMinute = Math.floor(next() * 1440);
      const day = 5 + Math.floor(next() * 20);
      const hhmm = (m: number) => `${pad(Math.floor(m / 60))}${pad(m % 60)}`;
      const seconds = next() < 0.5 ? '00' : '59';
      const start = ICAL.Time.fromDateTimeString(`2026-03-01T${pad(Math.floor(startMinute / 60))}:${pad(startMinute % 60)}:00`);
      const iterator = ICAL.Recur.fromString(`FREQ=DAILY;UNTIL=202603${pad(day)}T${hhmm(untilMinute)}${seconds}`).iterator(start);
      let last = '';
      for (let n = iterator.next(); n; n = iterator.next()) last = n.toString().slice(0, 10);
      const ours = untilEndDate(untilInZone(until(`202603${pad(day)}T${hhmm(untilMinute)}${seconds}`), null, intlZoneResolver())!, startMinute);
      expect(toISODate(ours), `${startMinute} ${day} ${untilMinute}`).toBe(last);
    }
    function until(value: string): RRuleUntil {
      return parseRRule(`FREQ=DAILY;UNTIL=${value}`).until!;
    }
  });

  it('ends an all-day series on a DATE until, as ical.js does', () => {
    const iterator = ICAL.Recur.fromString('FREQ=DAILY;UNTIL=20261116').iterator(ICAL.Time.fromDateString('2026-11-10'));
    let last = '';
    for (let n = iterator.next(); n; n = iterator.next()) last = n.toString();
    const ours = untilEndDate(untilInZone({ kind: 'date', date: g('2026-11-16') }, null, intlZoneResolver())!, 0);
    expect(toISODate(ours)).toBe(last);
  });
});

describe('formatUntil (§4.4 Ends, §4.7 retiming)', () => {
  const zones = intlZoneResolver();

  it('writes a date for all-day series, a floating end of day, and a zoned end of day in UTC', () => {
    expect(formatUntil(g('2026-11-16'), true, null, zones)).toBe('20261116');
    expect(formatUntil(g('2026-11-16'), true, 'Europe/Tallinn', zones)).toBe('20261116');
    expect(formatUntil(g('2026-11-16'), false, null, zones)).toBe('20261116T235959');
    // §4.7: an Outlook-style series moved to 19:30 keeps November 16.
    expect(formatUntil(g('2026-11-16'), false, 'Europe/Tallinn', zones)).toBe('20261116T215959Z');
    expect(formatUntil(g('2026-11-09'), false, 'Europe/Tallinn', zones)).toBe('20261109T215959Z');
    expect(formatUntil(g('2026-07-15'), false, 'Europe/Tallinn', zones)).toBe('20260715T205959Z');
    expect(formatUntil(g('2026-01-15'), false, 'America/New_York', zones)).toBe('20260116T045959Z');
    expect(formatUntil(g('2026-07-15'), false, 'America/New_York', zones)).toBe('20260716T035959Z');
    expect(formatUntil(g('2026-10-19'), false, 'Asia/Kathmandu', zones)).toBe('20261019T181459Z');
    expect(formatUntil(g('2026-10-19'), false, 'UTC', zones)).toBe('20261019T235959Z');
  });

  it('uses the zone rule on DST days and stops at the last UTC minute of 9999', () => {
    // The end of the day is after the change on both DST days.
    expect(formatUntil(g('2026-03-29'), false, 'Europe/Tallinn', zones)).toBe('20260329T205959Z');
    expect(formatUntil(g('2026-10-25'), false, 'Europe/Tallinn', zones)).toBe('20261025T215959Z');
    // A zone whose midnight is skipped: 23:59 the evening before still exists.
    expect(formatUntil(g('2018-11-03'), false, 'America/Sao_Paulo', zones)).toBe('20181104T025959Z');
    // Apia skipped December 30, 2011: 23:59 on that date falls in the gap and moves forward a day.
    expect(formatUntil(g('2011-12-30'), false, 'Pacific/Apia', zones)).toBe('20111231T095959Z');
    expect(formatUntil(g('9999-12-31'), false, 'Pacific/Kiritimati', zones)).toBe('99991231T095959Z');
    expect(formatUntil(g('9999-12-31'), false, 'America/New_York', zones)).toBe('99991231T235959Z');
    expect(formatUntil(g('9999-12-31'), false, null, zones)).toBe('99991231T235959');
    // Local mean time +09:18:59 counts as +09:18.
    expect(formatUntil(g('0001-01-01'), false, 'Asia/Tokyo', zones)).toBe('00010101T144159Z');
    expect(formatUntil(g('0001-01-01'), true, null, zones)).toBe('00010101');
  });

  it('reads back as its own end date for every start minute and zone', () => {
    const next = random(46);
    const zoneIds = ['Europe/Tallinn', 'America/New_York', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'Pacific/Kiritimati', null];
    for (let i = 0; i < 400; i++) {
      const endDate = addGregorianDays(g('2026-01-01'), Math.floor(next() * 730));
      const zone = zoneIds[Math.floor(next() * zoneIds.length)]!;
      const allDay = zone === null && next() < 0.5;
      const startMinute = allDay ? 0 : Math.floor(next() * 1440);
      const written = parseRRule(`FREQ=DAILY;UNTIL=${formatUntil(endDate, allDay, zone, zones)}`).until!;
      const back = untilEndDate(untilInZone(written, zone, zones)!, startMinute);
      expect(toISODate(back), `${toISODate(endDate)} ${zone} ${startMinute}`).toBe(toISODate(endDate));
    }
  });

  it('ends a zoned series on its end date in ical.js', () => {
    const start = ICAL.Time.fromDateTimeString('2026-11-02T17:30:00Z');
    const iterator = ICAL.Recur.fromString(`FREQ=WEEKLY;UNTIL=${formatUntil(g('2026-11-16'), false, 'Europe/Tallinn', zones)}`).iterator(start);
    let last = '';
    for (let n = iterator.next(); n; n = iterator.next()) last = n.toString();
    // 19:30 in Tallinn on November 16 is 17:30Z, before 21:59:59Z: kept.
    expect(last).toBe('2026-11-16T17:30:00Z');
  });

  it('throws for invalid input', () => {
    expect(() => formatUntil({ year: 2026, month: 2, day: 29 }, false, null, zones)).toThrow(RangeError);
    expect(() => formatUntil(g('2026-11-16'), 'yes' as unknown as boolean, null, zones)).toThrow(RangeError);
    expect(() => formatUntil(g('2026-11-16'), false, 'Mars/Olympus', zones)).toThrow(RangeError);
    expect(() => formatUntil(g('2026-11-16'), false, '', zones)).toThrow(RangeError);
    const synthetic = syntheticZoneResolver({ name: 'Test/Plus3', offset: 180, transitions: [] });
    expect(formatUntil(g('2026-11-16'), false, 'Test/Plus3', synthetic)).toBe('20261116T205959Z');
  });
});

describe('internal iCalendar value helpers', () => {
  it('parse dates and date-times strictly', () => {
    expect(parseICalValue('20261019')).toEqual({ kind: 'date', date: g('2026-10-19') });
    expect(parseICalValue('20261019T093059')).toEqual({ kind: 'local', value: L('2026-10-19T09:30') });
    expect(parseICalValue('20261019T093059Z')).toEqual({ kind: 'utc', value: L('2026-10-19T09:30') });
    for (const bad of ['2026101', '202610190', '20261019T0930', '20261019T093060Z0', '20261319', 'abcdefgh', '20261019 T093000', '+0261019']) {
      expect(parseICalValue(bad), bad).toBeNull();
    }
  });

  it('map weekday codes both ways', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => weekdayCode(d as 0))).toEqual(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']);
    expect(parseWeekdayCode('th')).toBe(4);
    expect(parseWeekdayCode('THU')).toBeNull();
    expect(parseWeekdayCode('XX')).toBeNull();
  });
});
