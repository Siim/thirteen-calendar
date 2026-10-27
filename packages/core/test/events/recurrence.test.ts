/**
 * events/recurrence.ts (docs/EVENTS.md §4.5 to §4.7, §5.2): expansion, ends,
 * splitting, retiming, the RRULE a repeat is written as, presets, the text
 * grammars and recognition. Expected values are worked out by hand from the
 * spec (and RFC 5545); the fixture sections pin many more.
 */
import { describe, expect, it } from 'vitest';
import { parseLocalDateTime } from '../../src/events/index.ts';
import {
  type EventRecurrence,
  type Expansion,
  type ExtraDate,
  type OriginalDate,
  type RecognitionInput,
  type RepeatEnd,
  type RepeatRule,
  describeNextOccurrences,
  describeRecurrence,
  describeRepeatNotes,
  endRecurrenceBefore,
  expandRecurrence,
  laterOccurrenceCount,
  matchRepeatPreset,
  nextOccurrences,
  recognizeRecurrence,
  recurrenceToRRule,
  repeatPresets,
  retimeExceptions,
  splitRecurrence,
} from '../../src/events/recurrence.ts';
import { formatRRule, parseRRule } from '../../src/events/rrule.ts';
import { type ThirteenRule, encodeThirteenRule, formatThirteenRuleUri, thirteenRuleRdates } from '../../src/events/thirteen-rules.ts';
import { toISODate } from '../../src/index.ts';
import { g } from '../helpers.ts';

const never: RepeatEnd = { kind: 'never' };
const count = (n: number): RepeatEnd => ({ kind: 'count', count: n });
const until = (iso: string): RepeatEnd => ({ kind: 'until', date: g(iso) });
const x = (iso: string, minute: number | null = null, durationMinutes: number | null = null): ExtraDate => ({ date: g(iso), minute, durationMinutes });
const o = (iso: string, minute: number | null = null): OriginalDate => ({ date: g(iso), minute });

interface Parts {
  end?: RepeatEnd;
  extraDates?: ExtraDate[];
  exceptDates?: OriginalDate[];
}
const make = (rule: RepeatRule, parts: Parts = {}): EventRecurrence => ({
  rule,
  end: parts.end ?? never,
  extraDates: parts.extraDates ?? [],
  exceptDates: parts.exceptDates ?? [],
});
const rr = (text: string, parts: Parts = {}) => make({ kind: 'rrule', rrule: parseRRule(text) }, parts);
const th = (rule: ThirteenRule, parts: Parts = {}) => make({ kind: 'thirteen', rule }, parts);
const foreign = (rules: [string, RepeatEnd][], exrules: [string, RepeatEnd][] = [], parts: Parts = {}) =>
  make(
    {
      kind: 'foreign',
      rules: rules.map(([t, end]) => ({ rrule: parseRRule(t), end })),
      exrules: exrules.map(([t, end]) => ({ rrule: parseRRule(t), end })),
    },
    parts,
  );
const IFC_12: ThirteenRule = { kind: 'monthly', system: 'ifc', day: 12 };
const IFC_THURSDAY: ThirteenRule = { kind: 'weekly', system: 'ifc', weekday: 4, interval: 1 };
const LEAP_DAY: ThirteenRule = { kind: 'intercalary', system: 'ifc', id: 'leap-day' };

const window = (from: string, to: string) => ({ from: g(from), to: g(to) });
/** Occurrences as `date` or `date@minute` (`/length` when it has one). */
const show = (e: Expansion) =>
  e.occurrences.map((d) => `${toISODate(d.date)}${d.minute === null ? '' : `@${d.minute}`}${d.durationMinutes === null ? '' : `/${d.durationMinutes}`}`);
const expand = (r: EventRecurrence, start: string, from: string, to: string, limit?: number) =>
  expandRecurrence(r, g(start), window(from, to), limit === undefined ? undefined : { limit });

describe('expandRecurrence (§4.6)', () => {
  it('starts with the start, even off the rule, and counts it', () => {
    expect(show(expand(rr('FREQ=WEEKLY;BYDAY=TU', { end: count(3) }), '2026-10-19', '2026-01-01', '2026-12-31'))).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-27',
    ]);
  });

  it('clips to the window and jumps ahead exactly when nothing is counted', () => {
    const weekly = rr('FREQ=WEEKLY');
    expect(show(expand(weekly, '2026-10-19', '2026-11-01', '2026-11-20'))).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    expect(show(expand(weekly, '2026-10-19', '2026-01-01', '2026-10-18'))).toEqual([]);
    expect(show(expand(rr('FREQ=DAILY'), '0001-01-01', '9999-12-30', '9999-12-31'))).toEqual(['9999-12-30', '9999-12-31']);
    expect(show(expand(rr('FREQ=WEEKLY', { end: count(3) }), '0001-01-01', '2026-01-01', '2026-12-31'))).toEqual([]);
    expect(show(expand(rr('FREQ=MONTHLY;BYMONTHDAY=31'), '2026-01-31', '2400-01-01', '2400-03-31'))).toEqual(['2400-01-31', '2400-03-31']);
  });

  it('counts excluded dates and ends at an until on its date', () => {
    expect(show(expand(rr('FREQ=WEEKLY', { end: count(3), exceptDates: [o('2026-10-26')] }), '2026-10-19', '2026-01-01', '2026-12-31'))).toEqual([
      '2026-10-19',
      '2026-11-02',
    ]);
    expect(show(expand(rr('FREQ=WEEKLY', { end: until('2026-11-02') }), '2026-10-19', '2026-01-01', '2026-12-31'))).toEqual([
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
    ]);
  });

  it('adds extra dates after the end, dedupes them by date and minute, and excludes by date and minute', () => {
    const r = rr('FREQ=WEEKLY', {
      end: count(2),
      extraDates: [x('2026-12-01'), x('2026-10-26'), x('2026-10-01'), x('2026-10-21', 600, 30), x('2026-10-21', 600, 90), x('2026-10-19', 900)],
      exceptDates: [o('2026-10-19', 900)],
    });
    expect(show(expand(r, '2026-10-19', '2026-01-01', '2026-12-31'))).toEqual(['2026-10-01', '2026-10-19', '2026-10-21@600/30', '2026-10-26', '2026-12-01']);
    // An exclusion at the series' time leaves an extra date at its own time on the same day.
    const both = rr('FREQ=WEEKLY', { end: count(2), extraDates: [x('2026-10-26', 900)], exceptDates: [o('2026-10-26')] });
    expect(show(expand(both, '2026-10-19', '2026-01-01', '2026-12-31'))).toEqual(['2026-10-19', '2026-10-26@900']);
  });

  it('expands BY parts as RFC 5545 does, skipping invalid dates', () => {
    const run = (text: string, start: string, from: string, to: string) => show(expand(rr(text), start, from, to));
    expect(run('FREQ=YEARLY', '2024-02-29', '2024-01-01', '2033-12-31')).toEqual(['2024-02-29', '2028-02-29', '2032-02-29']);
    expect(run('FREQ=MONTHLY;BYDAY=-1FR', '2026-10-30', '2026-10-01', '2027-01-31')).toEqual(['2026-10-30', '2026-11-27', '2026-12-25', '2027-01-29']);
    expect(run('FREQ=MONTHLY;BYDAY=SA,SU;BYSETPOS=1', '2026-10-03', '2026-10-01', '2026-12-31')).toEqual(['2026-10-03', '2026-11-01', '2026-12-05']);
    expect(run('FREQ=YEARLY;BYMONTH=1,2;BYDAY=1MO', '2026-01-05', '2026-01-01', '2027-02-28')).toEqual(['2026-01-05', '2026-02-02', '2027-01-04', '2027-02-01']);
    expect(run('FREQ=YEARLY;BYDAY=20MO', '2026-05-18', '2026-01-01', '2028-12-31')).toEqual(['2026-05-18', '2027-05-17', '2028-05-15']);
    expect(run('FREQ=YEARLY;BYWEEKNO=53;BYDAY=TH', '2026-12-31', '2026-01-01', '2033-12-31')).toEqual(['2026-12-31', '2032-12-30']);
    expect(run('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;WKST=SU', '1997-08-05', '1997-08-01', '1997-08-31')).toEqual(['1997-08-05', '1997-08-17', '1997-08-19', '1997-08-31']);
    expect(run('FREQ=DAILY;BYMONTH=2;BYMONTHDAY=-1', '2026-02-28', '2026-01-01', '2028-12-31')).toEqual(['2026-02-28', '2027-02-28', '2028-02-29']);
    expect(run('FREQ=MONTHLY;BYMONTHDAY=1,-1;BYSETPOS=-1', '2026-10-31', '2026-10-01', '2026-12-31')).toEqual(['2026-10-31', '2026-11-30', '2026-12-31']);
  });

  it('expands 13-month rules from their start', () => {
    expect(show(expand(th(IFC_12, { end: count(3) }), '2026-10-19', '2026-01-01', '2027-12-31'))).toEqual(['2026-10-19', '2026-11-16', '2026-12-14']);
    // Leap Day from 2104 has every leap year to its cap, 2196, and 2200 has none.
    expect(show(expand(th(LEAP_DAY), '2104-06-17', '2104-01-01', '2204-12-31')).filter((d) => d >= '2192')).toEqual(['2192-06-17', '2196-06-17']);
  });

  it('stops a leap-only repeat at its cap whatever its end, as its stored rule does (§4.3 c)', () => {
    // FREQ=YEARLY;INTERVAL=4;UNTIL=20960617: 2096 is the last, and 2104 (after 2100, which has no Leap Day) never comes.
    expect(show(expand(th(LEAP_DAY), '2024-06-17', '2024-01-01', '2108-12-31')).filter((d) => d >= '2092')).toEqual(['2092-06-17', '2096-06-17']);
    expect(show(expand(th(LEAP_DAY), '2024-06-17', '2097-01-01', '2200-12-31'))).toEqual([]);
    // A longer count or a later until gives the dates up to the cap, as recurrenceToRRule writes it.
    const five = th(LEAP_DAY, { end: count(5) });
    expect(show(expand(five, '2088-06-17', '2088-01-01', '2120-12-31'))).toEqual(['2088-06-17', '2092-06-17', '2096-06-17']);
    expect(formatRRule(recurrenceToRRule(five, g('2088-06-17'))!)).toBe('FREQ=YEARLY;INTERVAL=4;UNTIL=20960617');
    expect(show(expand(th(LEAP_DAY, { end: until('2110-01-01') }), '2088-06-17', '2088-01-01', '2120-12-31'))).toEqual(['2088-06-17', '2092-06-17', '2096-06-17']);
    // So the series ends: later occurrences are counted, and the Next line runs out at the cap.
    expect(laterOccurrenceCount(th(LEAP_DAY), g('2088-06-17'), g('2088-06-17'))).toBe(2);
    expect(laterOccurrenceCount(five, g('2088-06-17'), g('2088-06-17'))).toBe(2);
    expect(nextOccurrences(th(LEAP_DAY), g('2088-06-17'), 5)).toEqual([g('2092-06-17'), g('2096-06-17')]);
    expect(describeNextOccurrences(th(LEAP_DAY), g('2088-06-17'))).toBe('Next: Gregorian Tue, Jun 17, 2092; Sun, Jun 17, 2096');
    // Positivist Holy Women (December 31 of leap years) the same way; an extra date after the cap is still shown.
    const holyWomen = th({ kind: 'intercalary', system: 'positivist', id: 'leap-day' }, { extraDates: [x('2104-12-31')] });
    expect(show(expand(holyWomen, '2092-12-31', '2092-01-01', '2110-12-31'))).toEqual(['2092-12-31', '2096-12-31', '2104-12-31']);
    // The end of the range: from 9904 the cap is 9996.
    expect(show(expand(th(LEAP_DAY), '9904-06-17', '9990-01-01', '9999-12-31'))).toEqual(['9992-06-17', '9996-06-17']);
  });

  it('merges foreign rules: each RRULE has its own end, an EXRULE removes its dates (the start too when it produces it)', () => {
    const r = foreign(
      [
        ['FREQ=WEEKLY', count(2)],
        ['FREQ=MONTHLY;BYMONTHDAY=1', until('2026-12-01')],
      ],
      [['FREQ=WEEKLY;BYDAY=TU', never]],
    );
    // December 1 is a Tuesday: the EXRULE removes it.
    expect(show(expand(r, '2026-10-19', '2026-01-01', '2027-12-31'))).toEqual(['2026-10-19', '2026-10-26', '2026-11-01']);
    const onStart = foreign([['FREQ=DAILY', count(3)]], [['FREQ=WEEKLY;BYDAY=MO', never]]);
    expect(show(expand(onStart, '2026-10-19', '2026-01-01', '2026-12-31'))).toEqual(['2026-10-20', '2026-10-21']);
    expect(show(expand(foreign([]), '2026-10-19', '2026-01-01', '2026-12-31'))).toEqual(['2026-10-19']);
  });

  it('stops at the guard, at the limit, and before iterating an impossible rule', () => {
    const impossibleDaily = rr('FREQ=DAILY;BYMONTH=1;BYYEARDAY=200');
    expect(expand(impossibleDaily, '0001-01-01', '2026-01-01', '2026-12-31')).toEqual({ occurrences: [], truncated: true, unsupported: false });
    expect(expand(impossibleDaily, '0001-01-01', '0001-01-01', '0001-12-31')).toMatchObject({ truncated: false });
    expect(expand(rr('FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31'), '2026-10-19', '2026-01-01', '2026-12-31')).toMatchObject({ truncated: true });
    expect(show(expand(rr('FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31'), '2026-10-19', '2026-01-01', '2026-12-31'))).toEqual(['2026-10-19']);
    // The default limit is 10,000 dates (pinned here; a fixture case would hold all of them).
    const defaultLimit = expand(rr('FREQ=DAILY'), '2000-01-01', '2000-01-01', '2040-12-31');
    expect([defaultLimit.occurrences.length, defaultLimit.truncated, toISODate(defaultLimit.occurrences.at(-1)!.date)]).toEqual([10_000, true, '2027-05-18']);
    const limited = expand(rr('FREQ=DAILY'), '2026-10-19', '2026-01-01', '2026-12-31', 5);
    expect([show(limited).length, limited.truncated]).toEqual([5, true]);
    expect(expand(rr('FREQ=DAILY'), '2026-10-19', '2026-10-19', '2026-10-23', 5).truncated).toBe(false);
    // Monday, February 29 comes back after 28 years (2044), well inside the guard.
    expect(show(expand(rr('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;BYDAY=MO'), '2016-02-29', '2017-01-01', '2050-12-31'))).toEqual(['2044-02-29']);
  });

  it('gives only the start for unsupported rules, flagged', () => {
    for (const text of ['FREQ=HOURLY', 'FREQ=MINUTELY', 'FREQ=YEARLY;RSCALE=HEBREW', 'FREQ=MONTHLY;RSCALE=GREGORIAN;SKIP=FORWARD', 'FREQ=DAILY;BYHOUR=9,17', 'FREQ=MONTHLY;BYYEARDAY=1']) {
      expect(expand(rr(text), '2026-10-19', '2026-01-01', '2026-12-31'), text).toEqual({
        occurrences: [{ date: g('2026-10-19'), minute: null, durationMinutes: null }],
        truncated: false,
        unsupported: true,
      });
    }
    expect(expand(rr('FREQ=HOURLY'), '2026-10-19', '2026-11-01', '2026-11-30')).toEqual({ occurrences: [], truncated: false, unsupported: true });
    // §4.6 step 6 lists SKIP without exception, so even the default SKIP=OMIT is unsupported; RSCALE=GREGORIAN is not.
    expect(expand(rr('FREQ=YEARLY;RSCALE=GREGORIAN;SKIP=OMIT'), '2026-10-19', '2026-01-01', '2027-12-31').unsupported).toBe(true);
    expect(expand(rr('FREQ=YEARLY;RSCALE=GREGORIAN'), '2026-10-19', '2026-01-01', '2027-12-31')).toMatchObject({ unsupported: false, occurrences: [{}, {}] });
  });

  it('rejects invalid input', () => {
    const ok = rr('FREQ=WEEKLY');
    const bad: (() => unknown)[] = [
      () => expand(rr('FREQ=WEEKLY;COUNT=3'), '2026-10-19', '2026-01-01', '2026-12-31'),
      () => expand(rr('FREQ=WEEKLY', { end: count(0) }), '2026-10-19', '2026-01-01', '2026-12-31'),
      () => expand(rr('FREQ=WEEKLY', { end: count(2.5) }), '2026-10-19', '2026-01-01', '2026-12-31'),
      () => expand(make({ kind: 'dates' }, { end: count(2) }), '2026-10-19', '2026-01-01', '2026-12-31'),
      () => expand(foreign([['FREQ=DAILY', never]], [], { end: until('2026-12-31') }), '2026-10-19', '2026-01-01', '2026-12-31'),
      () => expand(ok, '2026-10-19', '2026-12-01', '2026-01-31'),
      () => expand(ok, '2026-10-19', '2026-01-01', '2026-12-31', 0),
      () => expandRecurrence(ok, g('2026-10-19'), window('2026-01-01', '2026-12-31'), { max: 3 } as never),
      () => expandRecurrence(ok, { year: 2026, month: 2, day: 30 }, window('2026-01-01', '2026-12-31')),
      () => expandRecurrence({ ...ok, exceptDates: ['2026-10-26'] } as never, g('2026-10-19'), window('2026-01-01', '2026-12-31')),
      () => expandRecurrence({ ...ok, extraDates: [{ date: g('2026-10-26'), minute: 1440, durationMinutes: null }] }, g('2026-10-19'), window('2026-01-01', '2026-12-31')),
    ];
    for (const run of bad) expect(run).toThrow(RangeError);
  });
});

describe('nextOccurrences', () => {
  it('lists later dates once each, with extra dates, fewer when the repeat ends', () => {
    const r = rr('FREQ=WEEKLY', { end: count(3), extraDates: [x('2026-10-26', 600), x('2026-10-20')] });
    expect(nextOccurrences(r, g('2026-10-19'), 10).map(toISODate)).toEqual(['2026-10-20', '2026-10-26', '2026-11-02']);
    expect(nextOccurrences(r, g('2026-10-19'), 0)).toEqual([]);
    expect(nextOccurrences(rr('FREQ=HOURLY'), g('2026-10-19'), 3)).toEqual([]);
    expect(nextOccurrences(rr('FREQ=DAILY'), g('9999-12-31'), 3)).toEqual([]);
    expect(() => nextOccurrences(r, g('2026-10-19'), 1001)).toThrow(RangeError);
    expect(() => nextOccurrences(r, g('2026-10-19'), -1)).toThrow(RangeError);
  });
});

describe('endRecurrenceBefore and laterOccurrenceCount (§4.7)', () => {
  const weekly10 = rr('FREQ=WEEKLY', { end: count(10), extraDates: [x('2026-10-21'), x('2026-12-02')], exceptDates: [o('2026-10-26'), o('2026-12-07')] });

  it('ends a count by the dates before the cut (excluded ones counted) and keeps earlier extras and exclusions', () => {
    expect(endRecurrenceBefore(weekly10, g('2026-10-19'), g('2026-11-16'))).toEqual({
      rule: weekly10.rule,
      end: count(4),
      extraDates: [x('2026-10-21')],
      exceptDates: [o('2026-10-26')],
    });
    expect(endRecurrenceBefore(weekly10, g('2026-10-19'), g('2026-10-19'))).toBeNull();
    expect(endRecurrenceBefore(weekly10, g('2026-10-19'), g('2026-01-01'))).toBeNull();
    // Cutting after the end keeps the end.
    expect(endRecurrenceBefore(weekly10, g('2026-10-19'), g('2027-06-01'))!.end).toEqual(count(10));
  });

  it('ends an until or endless rule on the day before, unless its own end is earlier; foreign rules per rule', () => {
    expect(endRecurrenceBefore(rr('FREQ=DAILY'), g('2026-10-19'), g('2026-11-01'))!.end).toEqual(until('2026-10-31'));
    expect(endRecurrenceBefore(rr('FREQ=DAILY', { end: until('2026-10-25') }), g('2026-10-19'), g('2026-11-01'))!.end).toEqual(until('2026-10-25'));
    expect(endRecurrenceBefore(th(LEAP_DAY), g('2024-06-17'), g('2032-06-17'))!.end).toEqual(until('2032-06-16'));
    const f = foreign(
      [
        ['FREQ=WEEKLY', count(5)],
        ['FREQ=MONTHLY;BYMONTHDAY=1', until('2026-11-01')],
      ],
      [['FREQ=WEEKLY;BYDAY=TU', count(3)]],
    );
    const head = endRecurrenceBefore(f, g('2026-10-19'), g('2026-11-09'))!;
    expect(head.rule.kind === 'foreign' && head.rule.rules.map((r) => r.end)).toEqual([count(3), until('2026-11-01')]);
    // The EXRULE does not get the start forced into its count: Tuesdays 10-20, 10-27, 11-03.
    expect(head.rule.kind === 'foreign' && head.rule.exrules.map((r) => r.end)).toEqual([count(3)]);
  });

  it('counts the later occurrences a cut deletes (excluded dates not counted, extra dates counted)', () => {
    // After 11-16: 11-23, 11-30, 12-02 (extra), 12-14, 12-21; 12-07 is excluded.
    expect(laterOccurrenceCount(weekly10, g('2026-10-19'), g('2026-11-16'))).toBe(5);
    expect(laterOccurrenceCount(weekly10, g('2026-10-19'), g('2026-12-21'))).toBe(0);
    expect(laterOccurrenceCount(rr('FREQ=WEEKLY'), g('2026-10-19'), g('2026-11-16'))).toBeNull();
    expect(laterOccurrenceCount(foreign([['FREQ=WEEKLY', never]]), g('2026-10-19'), g('2026-11-16'))).toBeNull();
    expect(laterOccurrenceCount(make({ kind: 'dates' }, { extraDates: [x('2026-10-26'), x('2026-11-02')] }), g('2026-10-19'), g('2026-10-19'))).toBe(2);
    expect(laterOccurrenceCount(rr('FREQ=HOURLY', { end: count(5) }), g('2026-10-19'), g('2026-10-19'))).toBe(0);
  });
});

describe('splitRecurrence (§4.7)', () => {
  const weekly10 = rr('FREQ=WEEKLY', { end: count(10), exceptDates: [o('2026-10-26'), o('2026-11-23')] });

  it('keeps the remaining count for a kept repeat and carries later exceptions', () => {
    const split = splitRecurrence(weekly10, g('2026-10-19'), g('2026-11-09'), [o('2026-11-09'), o('2026-11-16'), o('2026-10-26')], {
      recurrence: weekly10,
      start: g('2026-11-09'),
      ruleChanged: false,
    });
    expect(split.head).toEqual({ ...weekly10, end: count(3), exceptDates: [o('2026-10-26')] });
    expect(split.tail).toEqual({ rule: weekly10.rule, end: count(7), extraDates: [], exceptDates: [o('2026-11-23')] });
    // The edited occurrence's own override is not listed; one before the cut is not either.
    expect(split.overrides).toEqual([{ from: o('2026-11-16'), to: o('2026-11-16') }]);
    expect([split.droppedCount, split.dropped]).toEqual([0, false]);
  });

  it('shifts exceptions with a moved start where the tail produces them, and drops and counts the rest', () => {
    const moved = splitRecurrence(weekly10, g('2026-10-19'), g('2026-11-09'), [o('2026-11-30'), o('2026-11-20', 900)], {
      recurrence: rr('FREQ=WEEKLY;BYDAY=WE,TH', { end: count(10) }),
      start: g('2026-11-11'),
      ruleChanged: true,
    });
    expect(moved.tail!.exceptDates).toEqual([o('2026-11-25')]);
    expect(moved.tail!.end).toEqual(count(10));
    expect(moved.overrides).toEqual([
      { from: o('2026-11-30'), to: o('2026-12-02') },
      { from: o('2026-11-20', 900), to: null },
    ]);
    expect(moved.droppedCount).toBe(1);
  });

  it('has no tail for "Delete all future events" and when the repeat becomes Never', () => {
    for (const change of [undefined, null, { recurrence: null, start: g('2026-11-09'), ruleChanged: true }]) {
      const split = splitRecurrence(weekly10, g('2026-10-19'), g('2026-11-09'), [o('2026-11-16')], change);
      expect(split.tail).toBeNull();
      expect(split.overrides).toEqual([{ from: o('2026-11-16'), to: null }]);
      expect(split.droppedCount).toBe(2);
    }
  });

  it('refuses to keep a rule anchored on its own start, and a used-up count', () => {
    const keep = (r: EventRecurrence) => () => splitRecurrence(r, g('2026-10-19'), g('2026-11-09'), [], { recurrence: r, start: g('2026-11-09'), ruleChanged: false });
    expect(keep(foreign([['FREQ=WEEKLY', never]]))).toThrow(RangeError);
    expect(keep(make({ kind: 'dates' }, { extraDates: [x('2026-11-09')] }))).toThrow(RangeError);
    expect(keep(rr('FREQ=WEEKLY', { extraDates: [x('2026-10-21')] }))).toThrow(RangeError);
    expect(keep(rr('FREQ=WEEKLY', { end: count(3) }))).toThrow(RangeError);
    expect(keep(rr('FREQ=WEEKLY', { end: count(4) }))().tail!.end).toEqual(count(1));
    expect(() => splitRecurrence(weekly10, g('2026-10-19'), g('2026-11-09'), [], { recurrence: weekly10, start: g('2026-11-09') } as never)).toThrow(RangeError);
    expect(() => splitRecurrence(weekly10, g('2026-10-19'), g('2026-11-09'), ['2026-11-16'] as never)).toThrow(RangeError);
  });
});

describe('retimeExceptions (§4.7)', () => {
  it('keeps values at the series time and shifts own-time values by minuteDelta', () => {
    const r = rr('FREQ=WEEKLY', { extraDates: [x('2026-10-21', 1410, 30)], exceptDates: [o('2026-10-26'), o('2026-10-21', 1410)] });
    const result = retimeExceptions(r, [o('2026-11-02'), o('2026-10-21', 1410)], g('2026-10-19'), g('2026-10-19'), { ...r, extraDates: [], exceptDates: [] }, { minuteDelta: 45 });
    expect(result.recurrence.extraDates).toEqual([x('2026-10-22', 15, 30)]);
    expect(result.recurrence.exceptDates).toEqual([o('2026-10-26'), o('2026-10-22', 15)]);
    expect(result.overrides).toEqual([
      { from: o('2026-11-02'), to: o('2026-11-02') },
      { from: o('2026-10-21', 1410), to: o('2026-10-22', 15) },
    ]);
    expect([result.droppedCount, result.dropped, result.untils]).toEqual([0, false, []]);
  });

  it('shifts dates with the start where the new rule produces them, and drops orphans and the rest', () => {
    const r = rr('FREQ=WEEKLY;BYDAY=MO,WE', { exceptDates: [o('2026-10-21'), o('2026-10-26')] });
    const result = retimeExceptions(r, [o('2026-10-28'), o('2026-10-27')], g('2026-10-19'), g('2026-10-20'), rr('FREQ=WEEKLY;BYDAY=TU,TH'));
    expect(result.recurrence.exceptDates).toEqual([o('2026-10-22'), o('2026-10-27')]);
    expect(result.overrides).toEqual([
      { from: o('2026-10-28'), to: o('2026-10-29') },
      { from: o('2026-10-27'), to: null },
    ]);
    expect(result.droppedCount).toBe(1);
  });

  it('turns values into dates for an all-day series, dropping extra dates that land on rule dates or on each other', () => {
    const r = rr('FREQ=WEEKLY', {
      extraDates: [x('2026-10-26', 600), x('2026-10-28', 600), x('2026-10-28', 900)],
      exceptDates: [o('2026-10-28', 900)],
    });
    const result = retimeExceptions(r, [o('2026-10-26', 600)], g('2026-10-19'), g('2026-10-19'), rr('FREQ=WEEKLY'), { allDay: 'to-all-day' });
    expect(result.recurrence.extraDates).toEqual([x('2026-10-28')]);
    // The 15:00 extra date and its exclusion go with it (the 10:00 one keeps the date).
    expect(result.recurrence.exceptDates).toEqual([]);
    expect(result.overrides).toEqual([{ from: o('2026-10-26', 600), to: null }]);
    expect(result.droppedCount).toBe(4);
  });

  it('lists the UNTILs to rewrite, with their end dates, in stored order', () => {
    const f = foreign(
      [
        ['FREQ=WEEKLY', until('2026-12-21')],
        ['FREQ=DAILY', count(3)],
      ],
      [['FREQ=MONTHLY;BYDAY=1MO', until('2027-03-31')]],
    );
    expect(retimeExceptions(f, [], g('2026-10-19'), g('2026-10-19'), f, { minuteDelta: 30 }).untils).toEqual([
      { rule: 'rrule', index: 0, endDate: g('2026-12-21') },
      { rule: 'exrule', index: 0, endDate: g('2027-03-31') },
    ]);
    expect(retimeExceptions(th(LEAP_DAY), [], g('2024-06-17'), g('2024-06-17'), th(LEAP_DAY), { allDay: 'to-timed' }).untils).toEqual([
      { rule: 'rrule', index: 0, endDate: g('2096-06-17') },
    ]);
    expect(retimeExceptions(th(IFC_12, { end: until('2027-06-30') }), [], g('2026-10-19'), g('2026-10-19'), th(IFC_12, { end: until('2027-06-30') })).untils).toEqual([
      { rule: 'rrule', index: 0, endDate: g('2027-06-30') },
    ]);
  });

  it('rejects invalid options', () => {
    const r = rr('FREQ=WEEKLY');
    expect(() => retimeExceptions(r, [], g('2026-10-19'), g('2026-10-19'), r, { minuteDelta: 1.5 })).toThrow(RangeError);
    expect(() => retimeExceptions(r, [], g('2026-10-19'), g('2026-10-19'), r, { allDay: 'sometimes' as never })).toThrow(RangeError);
    expect(() => retimeExceptions(r, [], g('2026-10-19'), g('2026-10-19'), r, { delta: 3 } as never)).toThrow(RangeError);
  });
});

describe('recurrenceToRRule (§4.3, §4.4)', () => {
  const text = (r: EventRecurrence, start: string) => {
    const rule = recurrenceToRRule(r, g(start));
    return rule === null ? null : formatRRule(rule);
  };

  it('writes Gregorian and 13-month rules with their end, the leap cap winning', () => {
    expect(text(rr('FREQ=WEEKLY', { end: until('2026-12-21') }), '2026-10-19')).toBe('FREQ=WEEKLY;UNTIL=20261221');
    expect(text(rr('FREQ=WEEKLY;INTERVAL=2', { end: count(5) }), '2026-10-19')).toBe('FREQ=WEEKLY;INTERVAL=2;COUNT=5');
    expect(text(th(IFC_12, { end: count(5) }), '2026-10-19')).toBe('FREQ=YEARLY;COUNT=5;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18');
    expect(text(th(LEAP_DAY), '2024-06-17')).toBe('FREQ=YEARLY;INTERVAL=4;UNTIL=20960617');
    expect(text(th(LEAP_DAY, { end: count(3) }), '2024-06-17')).toBe('FREQ=YEARLY;INTERVAL=4;COUNT=3');
    expect(text(th(LEAP_DAY, { end: count(30) }), '2024-06-17')).toBe('FREQ=YEARLY;INTERVAL=4;UNTIL=20960617');
    expect(text(th(LEAP_DAY, { end: until('2200-01-01') }), '2024-06-17')).toBe('FREQ=YEARLY;INTERVAL=4;UNTIL=20960617');
    expect(text(th(LEAP_DAY, { end: until('2040-01-01') }), '2024-06-17')).toBe('FREQ=YEARLY;INTERVAL=4;UNTIL=20400101');
    expect(text(make({ kind: 'dates' }), '2026-10-19')).toBeNull();
    expect(text(foreign([['FREQ=DAILY', never]]), '2026-10-19')).toBeNull();
    expect(() => text(th(IFC_12), '2026-10-20')).toThrow(RangeError);
  });
});

describe('repeatPresets and matchRepeatPreset', () => {
  it('offer the Gregorian and 13-month presets of the start', () => {
    const ids = (start: string, system: 'ifc' | 'positivist' = 'ifc') => repeatPresets(g(start), system).map((p) => p.id);
    expect(ids('2026-10-19')).toEqual(['never', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'thirteen-monthly', 'thirteen-weekly', 'thirteen-biweekly', 'thirteen-yearly']);
    expect(ids('2026-12-31')).toEqual(['never', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'thirteen-intercalary']);
    expect(ids('2024-06-17')).toContain('thirteen-intercalary');
    expect(ids('2024-06-17', 'positivist')).toContain('thirteen-monthly');
    const presets = repeatPresets(g('2026-10-19'));
    expect(presets[0]).toEqual({ id: 'never', section: 'never', label: 'Never', recurrence: null, exchangeSafe: true });
    expect(presets.every((p) => p.recurrence === null || p.recurrence.end.kind === 'never')).toBe(true);
    expect(presets.find((p) => p.id === 'thirteen-monthly')).toMatchObject({ section: 'thirteen', exchangeSafe: false, label: 'Every IFC month on the 12th' });
    expect(repeatPresets(g('2026-10-19'), 'positivist').find((p) => p.id === 'thirteen-yearly')!.label).toBe('Every year on Positivist Descartes 12');
  });

  it('match minimal and explicit forms, ignoring WKST, and 13-month presets only in their system', () => {
    expect(matchRepeatPreset(null, g('2026-10-19'))).toBe('never');
    expect(matchRepeatPreset(rr('FREQ=WEEKLY'), g('2026-10-19'))).toBe('weekly');
    expect(matchRepeatPreset(rr('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;WKST=SU'), g('2026-10-19'))).toBe('weekly');
    expect(matchRepeatPreset(rr('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'), g('2026-10-19'))).toBe('biweekly');
    expect(matchRepeatPreset(rr('FREQ=MONTHLY;BYMONTHDAY=19'), g('2026-10-19'))).toBe('monthly');
    expect(matchRepeatPreset(rr('FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=19'), g('2026-10-19'))).toBe('yearly');
    expect(matchRepeatPreset(rr('FREQ=WEEKLY;BYDAY=TU'), g('2026-10-19'))).toBeNull();
    expect(matchRepeatPreset(rr('FREQ=WEEKLY', { end: count(3) }), g('2026-10-19'))).toBe('weekly');
    expect(matchRepeatPreset(th(IFC_12), g('2026-10-19'))).toBe('thirteen-monthly');
    expect(matchRepeatPreset(th(IFC_12), g('2026-10-19'), 'positivist')).toBeNull();
    expect(matchRepeatPreset(rr('FREQ=WEEKLY', { extraDates: [x('2026-10-21')] }), g('2026-10-19'))).toBeNull();
  });
});

describe('describeRecurrence (§5.2 grammar)', () => {
  const say = (r: EventRecurrence, start: string, system: 'ifc' | 'positivist' = 'ifc') => describeRecurrence(r, g(start), system);

  it('describes every rule kind with its end and extra dates', () => {
    expect(say(rr('FREQ=DAILY;INTERVAL=3', { end: count(1) }), '2026-10-19')).toBe('Every 3 days, once');
    expect(say(rr('FREQ=WEEKLY;BYDAY=MO,WE,FR', { end: count(10) }), '2026-10-19')).toBe('Every week on Monday, Wednesday and Friday, 10 times');
    expect(say(rr('FREQ=WEEKLY;BYDAY=SU,SA'), '2026-10-24')).toBe('Every weekend');
    expect(say(rr('FREQ=WEEKLY;BYDAY=FR,MO'), '2026-10-19')).toBe('Every week on Monday and Friday');
    expect(say(rr('FREQ=MONTHLY;BYMONTHDAY=1,15;INTERVAL=2'), '2026-10-01')).toBe('Every 2 months on the 1st and 15th');
    expect(say(rr('FREQ=YEARLY;BYMONTH=3,9;BYMONTHDAY=1'), '2026-03-01')).toBe('Every year in March and September on the 1st');
    expect(say(rr('FREQ=WEEKLY', { end: until('2026-12-21') }), '2026-10-19', 'positivist')).toBe('Every week on Monday, until December 21, 2026');
    expect(say(th(IFC_12, { end: until('2026-11-16') }), '2026-10-19')).toBe('Every IFC month on the 12th, until November 12, 2026');
    expect(say(th({ kind: 'weekly', system: 'positivist', weekday: 5, interval: 2 }), '2026-10-19')).toBe('Every 2 Positivist weeks on Friday');
    expect(say(th({ kind: 'intercalary', system: 'positivist', id: 'leap-day' }), '2024-12-31')).toBe('Every Festival of Holy Women');
    expect(say(rr('FREQ=WEEKLY', { extraDates: [x('2026-10-21'), x('2026-10-23', 600)] }), '2026-10-19')).toBe('Every week on Monday, and 2 more dates');
    expect(say(make({ kind: 'dates' }, { extraDates: [x('2026-10-21')] }), '2026-10-19')).toBe('Repeats on a custom schedule');
    expect(say(rr('FREQ=HOURLY', { end: count(4) }), '2026-10-19')).toBe('Repeats on a custom schedule');
  });
});

describe('describeNextOccurrences', () => {
  it('lists the next dates, Gregorian-labeled for 13-month rules, with years when they differ', () => {
    expect(describeNextOccurrences(rr('FREQ=WEEKLY'), g('2026-10-19'))).toBe('Next: Mon, Oct 26; Mon, Nov 2; Mon, Nov 9');
    expect(describeNextOccurrences(th(IFC_12), g('2026-10-19'))).toBe('Next: Gregorian Mon, Nov 16; Mon, Dec 14; Tue, Jan 12, 2027');
    expect(describeNextOccurrences(rr('FREQ=WEEKLY', { end: count(2) }), g('2026-10-19'), 'ifc', { count: 5 })).toBe('Next: Mon, Oct 26');
    expect(describeNextOccurrences(rr('FREQ=WEEKLY', { end: count(1) }), g('2026-10-19'))).toBe('');
    expect(() => describeNextOccurrences(rr('FREQ=WEEKLY'), g('2026-10-19'), 'ifc', { count: 0 })).toThrow(RangeError);
    expect(() => describeNextOccurrences(rr('FREQ=WEEKLY'), g('2026-10-19'), 'ifc', { count: 101 })).toThrow(RangeError);
  });
});

describe('describeRepeatNotes (§5.2 table)', () => {
  const notes = (r: EventRecurrence, start: string, system: 'ifc' | 'positivist' = 'ifc', outlook = false) =>
    describeRepeatNotes(r, g(start), system, { gregorianOnlyCalendar: outlook });

  it('gives each note where it applies, in table order', () => {
    expect(notes(rr('FREQ=MONTHLY;BYMONTHDAY=29,30'), '2027-01-29')).toEqual(['Months without a 30th are skipped.']);
    expect(notes(rr('FREQ=MONTHLY'), '2026-10-31', 'ifc', true)).toEqual(['Outlook and Exchange move this to the last day of shorter months.']);
    expect(notes(rr('FREQ=YEARLY'), '2024-02-29')).toEqual(['Happens only in leap years.']);
    expect(notes(th(LEAP_DAY), '2024-06-17')).toEqual([
      'Repeats every 4 years until Leap Day 2096. 2100 has no Leap Day, so the repeat stops before it.',
    ]);
    expect(notes(th(LEAP_DAY), '9904-06-17')).toEqual(['Repeats every 4 years until Leap Day 9996.']);
    expect(notes(th(IFC_THURSDAY), '2026-10-19')).toEqual([
      'Year Day and Leap Day belong to no week, so the repeat waits one extra day after each, and its Gregorian weekday moves. In 2027 it falls on Tuesdays.',
    ]);
    // January 1, 2027 is a Friday and Positivist Monday, so Gregorian Mondays are Positivist Thursdays.
    expect(notes(rr('FREQ=WEEKLY'), '2026-10-19', 'positivist')).toEqual(['In 2027 Mondays are Positivist Thursdays.']);
    expect(notes(rr('FREQ=WEEKLY;BYDAY=MO,TU'), '2026-10-19')).toEqual([]);
    expect(notes(rr('FREQ=WEEKLY;INTERVAL=3'), '2026-10-19')).toEqual([]);
    expect(notes(th(IFC_12), '2026-10-19')).toEqual([]);
  });
});

describe('recognizeRecurrence (§4.5)', () => {
  const input = (start: string, rrules: (string | [string, string])[], parts: Partial<RecognitionInput> = {}): RecognitionInput => ({
    start: parseLocalDateTime(start),
    rrules: rrules.map((r) => (typeof r === 'string' ? { rrule: parseRRule(r), until: null } : { rrule: parseRRule(r[0]), until: parseLocalDateTime(r[1]) })),
    exrules: [],
    rdates: [],
    exdates: [],
    marker: null,
    ...parts,
  });

  it('trusts a marker that agrees with the rule, and reads Android lists with their marker', () => {
    const encoded = formatRRule(encodeThirteenRule(IFC_12, g('2026-10-19')).rrule);
    expect(recognizeRecurrence(input('2026-10-19T19:00', [`${encoded};COUNT=4`], { marker: 'SYSTEM=ifc;KIND=monthly;DAY=12' }))).toEqual({
      recurrence: th(IFC_12, { end: count(4) }),
      source: 'marker',
      editable: true,
      alternatives: [],
      openEnded: false,
      series: null,
      part: null,
    });
    const dates = thirteenRuleRdates(IFC_THURSDAY, g('2026-10-19'), never, g('2026-12-31')).dates.map((date) => ({ date, minute: null, durationMinutes: null }));
    const series = '7f1c2a9e-3b4d-4c5e-8f60-718293a4b5c6';
    const marker = formatThirteenRuleUri(IFC_THURSDAY, count(20), { series, part: 1 });
    expect(recognizeRecurrence(input('2026-10-19T19:00', [], { rdates: dates, marker }))).toMatchObject({
      source: 'marker',
      recurrence: { end: count(20) },
      openEnded: false,
      series,
      part: 1,
    });
  });

  it('reads day-of-year lists in any order, the leap interval and plain yearly alternatives', () => {
    const list = encodeThirteenRule(IFC_12, g('2026-10-19')).rrule.byYearDay;
    const reversed = `FREQ=YEARLY;BYYEARDAY=${[...list].reverse().join(',')}`;
    expect(recognizeRecurrence(input('2026-10-19T19:00', [reversed])).recurrence.rule).toEqual({ kind: 'thirteen', rule: IFC_12 });
    expect(recognizeRecurrence(input('2024-06-17T00:00', ['FREQ=YEARLY;INTERVAL=4;UNTIL=20960617']))).toMatchObject({ source: 'leap-interval', recurrence: { end: never } });
    expect(recognizeRecurrence(input('2024-06-17T00:00', ['FREQ=YEARLY;INTERVAL=4;COUNT=19']))).toMatchObject({ source: 'leap-interval', recurrence: { end: count(19) } });
    expect(recognizeRecurrence(input('2024-06-17T00:00', ['FREQ=YEARLY;INTERVAL=4;COUNT=20']))).toMatchObject({ source: 'gregorian', recurrence: { end: count(20) } });
    expect(recognizeRecurrence(input('2026-01-01T00:00', ['FREQ=YEARLY'])).alternatives).toEqual([
      { kind: 'yearly', system: 'ifc', month: 1, day: 1 },
      { kind: 'yearly', system: 'positivist', month: 1, day: 1 },
    ]);
  });

  it('trusts a leap-only marker or date list only up to the cap (§4.5 steps 1, 3 and 5)', () => {
    const marker = 'SYSTEM=ifc;KIND=intercalary;DAY=LD';
    // Another app extended the end past the cap and kept the marker: the stored rule has 2100-06-17, so it stays Gregorian.
    const past = recognizeRecurrence(input('2088-06-17T00:00', ['FREQ=YEARLY;INTERVAL=4;UNTIL=21080617'], { marker }));
    expect(past).toMatchObject({ source: 'gregorian', recurrence: { rule: { kind: 'rrule' }, end: until('2108-06-17') } });
    expect(show(expandRecurrence(past.recurrence, g('2088-06-17'), window('2097-01-01', '2110-12-31')))).toEqual(['2100-06-17', '2104-06-17', '2108-06-17']);
    expect(recognizeRecurrence(input('2088-06-17T00:00', ['FREQ=YEARLY;INTERVAL=4;COUNT=5'], { marker })).source).toBe('gregorian');
    expect(recognizeRecurrence(input('2088-06-17T00:00', ['FREQ=YEARLY;INTERVAL=4'], { marker })).source).toBe('gregorian');
    // On or before the cap the marker is trusted.
    expect(recognizeRecurrence(input('2088-06-17T00:00', ['FREQ=YEARLY;INTERVAL=4;UNTIL=20960617'], { marker }))).toMatchObject({ source: 'marker', recurrence: { end: never } });
    expect(recognizeRecurrence(input('2088-06-17T00:00', ['FREQ=YEARLY;INTERVAL=4;COUNT=3'], { marker }))).toMatchObject({ source: 'marker', recurrence: { end: count(3) } });
    // A list of Leap Days past the cap is a list of dates, kept as stored.
    const leapDays = ['2092-06-17', '2096-06-17', '2104-06-17'].map((d) => x(d));
    expect(recognizeRecurrence(input('2088-06-17T00:00', [], { rdates: leapDays }))).toMatchObject({ source: 'dates', recurrence: { extraDates: leapDays } });
    expect(recognizeRecurrence(input('2088-06-17T00:00', [], { rdates: leapDays.slice(0, 2) }))).toMatchObject({
      source: 'rdates',
      recurrence: { rule: { kind: 'thirteen', rule: LEAP_DAY }, end: until('2096-06-17') },
    });
  });

  it('reads an instant UNTIL as the end date in the start minute, and normalizes minutes', () => {
    expect(recognizeRecurrence(input('2026-10-19T19:00', [['FREQ=WEEKLY;UNTIL=20261116T170000Z', '2026-11-16T19:00']])).recurrence.end).toEqual(until('2026-11-16'));
    expect(recognizeRecurrence(input('2026-10-19T19:00', [['FREQ=WEEKLY;UNTIL=20261116T165959Z', '2026-11-16T18:59']])).recurrence.end).toEqual(until('2026-11-15'));
    const r = recognizeRecurrence(input('2026-10-19T19:00', ['FREQ=WEEKLY'], { rdates: [x('2026-10-21', 1140), x('2026-10-22', 600)], exdates: [o('2026-10-26', 1140)] }));
    expect(r.recurrence.extraDates).toEqual([x('2026-10-21'), x('2026-10-22', 600)]);
    expect(r.recurrence.exceptDates).toEqual([o('2026-10-26')]);
    expect(r.editable).toBe(false);
  });

  it('falls back to date lists, foreign and non-editable rules', () => {
    expect(recognizeRecurrence(input('2026-10-19T19:00', [], { rdates: [x('2026-10-21')] }))).toMatchObject({ source: 'dates', editable: false });
    expect(recognizeRecurrence(input('2026-10-19T19:00', []))).toMatchObject({ source: 'dates', recurrence: { extraDates: [] } });
    expect(recognizeRecurrence(input('2026-10-19T19:00', ['FREQ=WEEKLY', 'FREQ=DAILY;COUNT=3']))).toMatchObject({
      source: 'foreign',
      recurrence: { rule: { kind: 'foreign', rules: [{ end: never }, { end: count(3) }] } },
    });
    expect(recognizeRecurrence(input('2026-10-19T19:00', ['FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO']))).toMatchObject({ source: 'gregorian', editable: false });
    expect(() => recognizeRecurrence({ ...input('2026-10-19T19:00', []), marker: 3 } as never)).toThrow(RangeError);
    expect(() => recognizeRecurrence(input('2026-10-19T19:00', []), 'julian' as never)).toThrow(RangeError);
  });
});
