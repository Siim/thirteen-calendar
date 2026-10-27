/**
 * events/occurrences.ts, `expandSeries` (docs/EVENTS.md §4.6, §5.2): the
 * widened range, times and exact lengths in the event's zone, overrides and
 * orphans, the device wall clock, the range edges and the window. Zones are
 * synthetic tables (scripts/zone-resolvers.ts), so every value is worked out
 * by hand.
 */
import { describe, expect, it } from 'vitest';
import { syntheticZoneResolver } from '../../scripts/zone-resolvers.ts';
import { formatLocalDateTime, parseLocalDateTime } from '../../src/events/index.ts';
import { type ExpandedOccurrence, type OverrideInput, type SeriesInput, expandSeries } from '../../src/events/occurrences.ts';
import type { EventRecurrence, ExtraDate, OriginalDate, RepeatEnd } from '../../src/events/recurrence.ts';
import { parseRRule } from '../../src/events/rrule.ts';
import { toISODate } from '../../src/index.ts';
import { g } from '../helpers.ts';

/** Tallinn by the EU rule in 2026 (UTC+2, UTC+3 from 01:00 UTC on March 29 to 01:00 UTC on October 25). */
const TALLINN = 'Test/Tallinn';
/** New York in 2026 (UTC-5, UTC-4 from 07:00 UTC on March 8 to 06:00 UTC on November 1). */
const NEW_YORK = 'Test/NewYork';
const zones = syntheticZoneResolver(
  {
    name: TALLINN,
    offset: 120,
    transitions: [
      { at: '2026-03-29T01:00', offset: 180 },
      { at: '2026-10-25T01:00', offset: 120 },
    ],
  },
  {
    name: NEW_YORK,
    offset: -300,
    transitions: [
      { at: '2026-03-08T07:00', offset: -240 },
      { at: '2026-11-01T06:00', offset: -300 },
    ],
  },
  { name: 'UTC', offset: 0, transitions: [] },
  { name: 'Test/Tokyo', offset: 540, transitions: [] },
);

const L = parseLocalDateTime;
const never: RepeatEnd = { kind: 'never' };
const count = (n: number): RepeatEnd => ({ kind: 'count', count: n });
const x = (iso: string, minute: number | null = null, durationMinutes: number | null = null): ExtraDate => ({ date: g(iso), minute, durationMinutes });
const o = (iso: string, minute: number | null = null): OriginalDate => ({ date: g(iso), minute });
const rr = (text: string, parts: Partial<EventRecurrence> = {}): EventRecurrence => ({
  rule: { kind: 'rrule', rrule: parseRRule(text) },
  end: never,
  extraDates: [],
  exceptDates: [],
  ...parts,
});

const series = (start: string, end: string, parts: Partial<SeriesInput> = {}): SeriesInput => ({
  id: 'series',
  recurrence: null,
  allDay: false,
  start: L(start),
  end: L(end),
  zone: TALLINN,
  overrides: [],
  ...parts,
});
const override = (id: string, originalDate: string, start: string, end: string, parts: Partial<OverrideInput> = {}): OverrideInput => ({
  id,
  originalDate: g(originalDate),
  originalMinute: null,
  canceled: false,
  allDay: false,
  start: L(start),
  end: L(end),
  zone: TALLINN,
  ...parts,
});
const range = (from: string, to: string) => ({ from: L(from), to: L(to) });
/** A weekly half-hour series in Tallinn from `start`. */
const weeklyAt = (start: string): SeriesInput =>
  series(start, formatLocalDateTime({ date: L(start).date, minute: L(start).minute + 30 }), { recurrence: rr('FREQ=WEEKLY') });
/** `original[@minute][#override] start..end` for compact comparisons. */
const show = (occurrences: readonly ExpandedOccurrence[]) =>
  occurrences.map(
    (e) =>
      `${toISODate(e.originalDate)}${e.originalMinute === null ? '' : `@${e.originalMinute}`}${e.overrideId === null ? '' : `#${e.overrideId}`}${e.allDay ? ' all-day' : ''} ` +
      `${formatLocalDateTime(e.start)}..${formatLocalDateTime(e.end)}`,
  );
const run = (s: SeriesInput, from: string, to: string, device = TALLINN, limit?: number) =>
  expandSeries(s, range(from, to), device, zones, limit === undefined ? undefined : { limit });

describe('expandSeries: times and zones', () => {
  it('converts a single event to the device wall clock; a floating one keeps its wall clock', () => {
    const call = series('2026-11-04T20:00', '2026-11-04T21:00', { zone: NEW_YORK });
    expect(show(run(call, '2026-11-01T00:00', '2026-11-08T00:00').occurrences)).toEqual(['2026-11-04 2026-11-05T03:00..2026-11-05T04:00']);
    expect(show(run(call, '2026-11-01T00:00', '2026-11-08T00:00', NEW_YORK).occurrences)).toEqual(['2026-11-04 2026-11-04T20:00..2026-11-04T21:00']);
    const floating = series('2026-11-04T20:00', '2026-11-04T21:00', { zone: null });
    for (const device of [TALLINN, NEW_YORK]) {
      expect(show(run(floating, '2026-11-01T00:00', '2026-11-08T00:00', device).occurrences)).toEqual(['2026-11-04 2026-11-04T20:00..2026-11-04T21:00']);
    }
  });

  it('keeps the exact length of a master across a DST change, and places gaps and overlaps by the zonedToUtc rule', () => {
    const night = series('2026-03-28T22:00', '2026-03-29T08:00', { recurrence: rr('FREQ=WEEKLY', { end: count(2) }) });
    expect(show(run(night, '2026-03-28T00:00', '2026-04-06T00:00').occurrences)).toEqual([
      '2026-03-28 2026-03-28T22:00..2026-03-29T08:00',
      '2026-04-04 2026-04-04T22:00..2026-04-05T07:00',
    ]);
    const early = series('2026-03-28T03:30', '2026-03-28T04:00', { recurrence: rr('FREQ=DAILY', { end: count(2) }) });
    expect(show(run(early, '2026-03-27T00:00', '2026-04-01T00:00').occurrences)).toEqual([
      '2026-03-28 2026-03-28T03:30..2026-03-28T04:00',
      '2026-03-29 2026-03-29T04:30..2026-03-29T05:00',
    ]);
    // 03:30 on October 25 happens twice: the earlier instant (00:30 UTC). 04:00 comes once (02:00 UTC), so the
    // master lasts 90 minutes, as New York shows.
    const overlap = series('2026-10-25T03:30', '2026-10-25T04:00');
    expect(show(run(overlap, '2026-10-24T00:00', '2026-10-26T00:00', NEW_YORK).occurrences)).toEqual(['2026-10-25 2026-10-24T20:30..2026-10-24T22:00']);
    expect(show(run(overlap, '2026-10-24T00:00', '2026-10-26T00:00').occurrences)).toEqual(['2026-10-25 2026-10-25T03:30..2026-10-25T04:00']);
    // A 30-minute daily repeat at 03:30 ends at 03:00 on the repeated hour in Tallinn: the end stops at the start.
    const daily = series('2026-10-24T03:30', '2026-10-24T04:00', { recurrence: rr('FREQ=DAILY', { end: count(2) }) });
    expect(show(run(daily, '2026-10-24T00:00', '2026-10-26T00:00').occurrences)).toEqual([
      '2026-10-24 2026-10-24T03:30..2026-10-24T04:00',
      '2026-10-25 2026-10-25T03:30..2026-10-25T03:30',
    ]);
    expect(show(run(daily, '2026-10-23T00:00', '2026-10-26T00:00', NEW_YORK).occurrences)).toEqual([
      '2026-10-24 2026-10-23T20:30..2026-10-23T21:00',
      '2026-10-25 2026-10-24T20:30..2026-10-24T21:00',
    ]);
  });

  it('measures a floating master through the device zone, as it places its start (§3.3)', () => {
    // 01:00 EST to 03:00 EDT on the spring-forward night is one hour; 00:30 EDT to 02:30 EST on the fall-back night three.
    const spring = series('2026-03-08T01:00', '2026-03-08T03:00', { zone: null });
    expect(show(run(spring, '2026-03-01T00:00', '2026-03-20T00:00', NEW_YORK).occurrences)).toEqual(['2026-03-08 2026-03-08T01:00..2026-03-08T03:00']);
    const fall = series('2026-11-01T00:30', '2026-11-01T02:30', { zone: null });
    expect(show(run(fall, '2026-10-25T00:00', '2026-11-05T00:00', NEW_YORK).occurrences)).toEqual(['2026-11-01 2026-11-01T00:30..2026-11-01T02:30']);
    // As a zoned series does: the master's exact length is every occurrence's.
    for (const zone of [null, NEW_YORK]) {
      const daily = series('2026-03-07T01:00', '2026-03-07T03:00', { zone, recurrence: rr('FREQ=DAILY', { end: count(3) }) });
      expect(show(run(daily, '2026-03-01T00:00', '2026-03-20T00:00', NEW_YORK).occurrences)).toEqual([
        '2026-03-07 2026-03-07T01:00..2026-03-07T03:00',
        '2026-03-08 2026-03-08T01:00..2026-03-08T04:00',
        '2026-03-09 2026-03-09T01:00..2026-03-09T03:00',
      ]);
      const crossing = series('2026-03-08T01:00', '2026-03-08T03:00', { zone, recurrence: rr('FREQ=DAILY', { end: count(2) }) });
      expect(show(run(crossing, '2026-03-01T00:00', '2026-03-20T00:00', NEW_YORK).occurrences)).toEqual([
        '2026-03-08 2026-03-08T01:00..2026-03-08T03:00',
        '2026-03-09 2026-03-09T01:00..2026-03-09T02:00',
      ]);
    }
    // In Tallinn nothing changes that night: two hours.
    expect(show(run(spring, '2026-03-01T00:00', '2026-03-20T00:00').occurrences)).toEqual(['2026-03-08 2026-03-08T01:00..2026-03-08T03:00']);
  });

  it('applies a DURATION with days on each occurrence\'s wall clock (RFC 5545 §3.8.5.3)', () => {
    const day = series('2026-03-07T12:00', '2026-03-08T12:00', {
      zone: NEW_YORK,
      recurrence: rr('FREQ=DAILY', { end: count(3) }),
      duration: { days: 1, minutes: 0 },
    });
    expect(show(run(day, '2026-03-01T00:00', '2026-03-20T00:00', NEW_YORK).occurrences)).toEqual([
      '2026-03-07 2026-03-07T12:00..2026-03-08T12:00',
      '2026-03-08 2026-03-08T12:00..2026-03-09T12:00',
      '2026-03-09 2026-03-09T12:00..2026-03-10T12:00',
    ]);
    // Without it, the master's exact 23 hours would be every occurrence's.
    expect(show(run({ ...day, duration: null }, '2026-03-01T00:00', '2026-03-20T00:00', NEW_YORK).occurrences)[1]).toBe(
      '2026-03-08 2026-03-08T12:00..2026-03-09T11:00',
    );
    // Days on the wall clock, then the exact part; an extra date with its own length keeps it. Seen from Tallinn.
    const longer = { ...day, recurrence: rr('FREQ=DAILY', { end: count(2), extraDates: [x('2026-03-12', 600, 60)] }), duration: { days: 1, minutes: 90 } };
    expect(show(run(longer, '2026-03-01T00:00', '2026-03-20T00:00').occurrences)).toEqual([
      '2026-03-07 2026-03-07T19:00..2026-03-08T19:30',
      '2026-03-08 2026-03-08T18:00..2026-03-09T19:30',
      '2026-03-12@600 2026-03-12T16:00..2026-03-12T17:00',
    ]);
    // A floating series counts its days in the device's zone; an all-day one ignores it.
    const floating = { ...day, zone: null };
    expect(show(run(floating, '2026-03-01T00:00', '2026-03-20T00:00', NEW_YORK).occurrences)[0]).toBe('2026-03-07 2026-03-07T12:00..2026-03-08T12:00');
    const allDay = series('2026-03-07T00:00', '2026-03-07T24:00', { allDay: true, zone: null, recurrence: rr('FREQ=DAILY', { end: count(1) }), duration: { days: 5, minutes: 0 } });
    expect(show(run(allDay, '2026-03-01T00:00', '2026-03-20T00:00', NEW_YORK).occurrences)).toEqual(['2026-03-07 all-day 2026-03-07T00:00..2026-03-07T24:00']);
  });

  it('gives each timed occurrence its start instant, also in a repeated hour of the device', () => {
    // 08:30 in Tallinn (UTC+2) on November 1 is 06:30 UTC: 01:30 EST, the second 01:30 of New York's night.
    const meeting = series('2026-11-01T08:30', '2026-11-01T09:00');
    const [occurrence] = run(meeting, '2026-10-31T00:00', '2026-11-02T00:00', NEW_YORK).occurrences;
    expect(formatLocalDateTime(occurrence!.start)).toBe('2026-11-01T01:30');
    expect(occurrence!.startUtc).toEqual(L('2026-11-01T06:30'));
    const moved = { ...weeklyAt('2026-11-03T10:00'), overrides: [override('moved', '2026-11-03', '2026-11-04T15:00', '2026-11-04T15:30', { zone: NEW_YORK })] };
    expect(run(moved, '2026-11-01T00:00', '2026-11-08T00:00').occurrences[0]!.startUtc).toEqual(L('2026-11-04T20:00'));
    const allDay = series('2026-11-01T00:00', '2026-11-01T24:00', { allDay: true, zone: null });
    expect(run(allDay, '2026-10-31T00:00', '2026-11-02T00:00').occurrences[0]!.startUtc).toBeNull();
  });

  it('keeps all-day dates and day counts in every zone, also for extra dates with their own length', () => {
    const allDay = series('2026-12-28T00:00', '2026-12-30T24:00', {
      allDay: true,
      zone: null,
      recurrence: rr('FREQ=YEARLY', { extraDates: [x('2027-02-01', null, 2 * 1440), x('2027-03-01', 600)] }),
    });
    // The own minute of an extra date goes (its length is the master's 3 days); an own length counts in whole days.
    for (const device of [TALLINN, NEW_YORK]) {
      expect(show(run(allDay, '2026-12-30T00:00', '2027-04-01T00:00', device).occurrences)).toEqual([
        '2026-12-28 all-day 2026-12-28T00:00..2026-12-30T24:00',
        '2027-02-01 all-day 2027-02-01T00:00..2027-02-02T24:00',
        '2027-03-01 all-day 2027-03-01T00:00..2027-03-03T24:00',
      ]);
    }
    expect(run(allDay, '2026-12-31T00:00', '2027-01-31T00:00').occurrences).toEqual([]);
  });

  it('finds occurrences that began before the window through the widened range', () => {
    const conference = series('2026-12-02T10:00', '2026-12-02T11:00', {
      recurrence: rr('FREQ=WEEKLY', { end: count(2), extraDates: [x('2026-12-20', 540, 14 * 1440)] }),
    });
    expect(show(run(conference, '2027-01-01T00:00', '2027-01-08T00:00').occurrences)).toEqual(['2026-12-20@540 2026-12-20T09:00..2027-01-03T09:00']);
  });
});

describe('expandSeries: overrides', () => {
  const weekly = series('2026-11-03T10:00', '2026-11-03T10:30', { recurrence: rr('FREQ=WEEKLY') });

  it('replaces, cancels and reports orphans and second overrides', () => {
    const s: SeriesInput = {
      ...weekly,
      overrides: [
        override('moved', '2026-11-10', '2026-11-11T15:00', '2026-11-11T16:00', { zone: NEW_YORK }),
        override('canceled', '2026-11-17', '2026-11-17T10:00', '2026-11-17T10:30', { canceled: true }),
        override('orphan', '2026-11-12', '2026-11-12T09:00', '2026-11-12T09:30'),
        override('canceled-orphan', '2026-11-13', '2026-11-13T09:00', '2026-11-13T09:30', { canceled: true }),
        override('second', '2026-11-10', '2026-11-10T12:00', '2026-11-10T12:30'),
        override('same-minute', '2026-11-24', '2026-11-24T11:00', '2026-11-24T11:30', { originalMinute: 600 }),
      ],
    };
    const result = run(s, '2026-11-09T00:00', '2026-11-30T00:00');
    expect(show(result.occurrences)).toEqual([
      // 15:00 in New York (UTC-5 after November 1) is 22:00 in Tallinn (UTC+2).
      '2026-11-10#moved 2026-11-11T22:00..2026-11-11T23:00',
      '2026-11-12#orphan 2026-11-12T09:00..2026-11-12T09:30',
      '2026-11-24#same-minute 2026-11-24T11:00..2026-11-24T11:30',
    ]);
    expect(result.orphans).toEqual(['orphan', 'canceled-orphan', 'second']);
  });

  it('shows an override moved into the window from far away, and hides one moved out of it', () => {
    const s: SeriesInput = {
      ...weekly,
      overrides: [
        override('in', '2026-12-15', '2027-01-07T10:00', '2027-01-07T10:30'),
        override('out', '2027-01-05', '2026-12-30T10:00', '2026-12-30T10:30'),
      ],
    };
    const result = run(s, '2027-01-01T00:00', '2027-01-08T00:00');
    expect(show(result.occurrences)).toEqual(['2026-12-15#in 2027-01-07T10:00..2027-01-07T10:30']);
    expect(result.orphans).toEqual([]);
  });

  it('matches overrides of extra dates at their own time, and treats the start minute as the master time', () => {
    const s: SeriesInput = {
      ...weekly,
      recurrence: rr('FREQ=WEEKLY', { extraDates: [x('2026-11-03', 900), x('2026-11-05', 600)], exceptDates: [o('2026-11-10', 600)] }),
      overrides: [override('extra', '2026-11-03', '2026-11-03T16:00', '2026-11-03T16:30', { originalMinute: 900 })],
    };
    const result = run(s, '2026-11-02T00:00', '2026-11-12T00:00');
    // The 10:00 extra date on November 5 is the master's time (minute null); the exclusion at 10:00 removes November 10.
    expect(show(result.occurrences)).toEqual([
      '2026-11-03 2026-11-03T10:00..2026-11-03T10:30',
      '2026-11-03@900#extra 2026-11-03T16:00..2026-11-03T16:30',
      '2026-11-05 2026-11-05T10:00..2026-11-05T10:30',
    ]);
  });

  it('matches a RECURRENCE-ID or EXDATE that names a gap occurrence by its instant (§4.6 step 4)', () => {
    // 02:30 on the spring-forward night does not exist in New York: the occurrence starts at 03:30 (07:30 UTC), and
    // a RECURRENCE-ID of 07:30 UTC (or 03:30 local) reads back as 03:30.
    const early = series('2026-03-06T02:30', '2026-03-06T03:00', { zone: NEW_YORK, recurrence: rr('FREQ=DAILY', { end: count(4) }) });
    const moved = { ...early, overrides: [override('moved', '2026-03-08', '2026-03-08T10:00', '2026-03-08T10:30', { originalMinute: 210, zone: NEW_YORK })] };
    const result = run(moved, '2026-03-01T00:00', '2026-03-20T00:00', NEW_YORK);
    expect(show(result.occurrences)).toEqual([
      '2026-03-06 2026-03-06T02:30..2026-03-06T03:00',
      '2026-03-07 2026-03-07T02:30..2026-03-07T03:00',
      '2026-03-08#moved 2026-03-08T10:00..2026-03-08T10:30',
      '2026-03-09 2026-03-09T02:30..2026-03-09T03:00',
    ]);
    expect(result.orphans).toEqual([]);
    const excluded = { ...early, recurrence: rr('FREQ=DAILY', { end: count(4), exceptDates: [o('2026-03-08', 210)] }) };
    expect(show(run(excluded, '2026-03-01T00:00', '2026-03-20T00:00', NEW_YORK).occurrences).map((line) => line.slice(0, 10))).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-09',
    ]);
    // The same for an extra date with its own time in the gap; 03:30 itself is no gap time on other nights.
    const extra = {
      ...series('2026-03-06T09:00', '2026-03-06T09:30', { zone: NEW_YORK }),
      recurrence: rr('FREQ=DAILY', { end: count(4), extraDates: [x('2026-03-08', 135), x('2026-03-09', 135)], exceptDates: [o('2026-03-08', 195), o('2026-03-09', 195)] }),
    };
    expect(show(run(extra, '2026-03-01T00:00', '2026-03-20T00:00', NEW_YORK).occurrences).filter((line) => line.includes('@'))).toEqual([
      '2026-03-09@135 2026-03-09T02:15..2026-03-09T02:45',
    ]);
    // An extra date at 03:30 on that night is the series' own occurrence, so it is not shown twice.
    const twice = { ...early, recurrence: rr('FREQ=DAILY', { end: count(4), extraDates: [x('2026-03-08', 210)] }) };
    expect(run(twice, '2026-03-01T00:00', '2026-03-20T00:00', NEW_YORK).occurrences).toHaveLength(4);
  });

  it('ignores overrides of an unsupported rule and shows only its first occurrence', () => {
    const s: SeriesInput = {
      ...weekly,
      recurrence: rr('FREQ=HOURLY'),
      overrides: [override('moved', '2026-11-03', '2026-11-04T10:00', '2026-11-04T10:30')],
    };
    expect(run(s, '2026-11-01T00:00', '2026-11-30T00:00')).toEqual({
      occurrences: [
        {
          originalDate: g('2026-11-03'),
          originalMinute: null,
          overrideId: null,
          allDay: false,
          start: L('2026-11-03T10:00'),
          end: L('2026-11-03T10:30'),
          startUtc: L('2026-11-03T08:00'),
        },
      ],
      orphans: [],
      outOfRange: 0,
      truncated: false,
      unsupported: true,
    });
  });
});

describe('expandSeries: window, order, range edges and limits', () => {
  it('keeps occurrences that overlap [from, to) and zero-length ones that start in it, sorted by start then original', () => {
    const s = series('2026-11-02T09:00', '2026-11-02T10:00', {
      recurrence: rr('FREQ=DAILY', { end: count(3), extraDates: [x('2026-11-03', 480, 120), x('2026-11-03', 540, 0)] }),
    });
    expect(show(run(s, '2026-11-02T10:00', '2026-11-04T09:00').occurrences)).toEqual([
      '2026-11-03@480 2026-11-03T08:00..2026-11-03T10:00',
      '2026-11-03 2026-11-03T09:00..2026-11-03T10:00',
    ]);
    const zero = series('2026-11-02T09:00', '2026-11-02T09:00');
    expect(run(zero, '2026-11-02T09:00', '2026-11-02T10:00').occurrences).toHaveLength(1);
    expect(run(zero, '2026-11-02T08:00', '2026-11-02T09:00').occurrences).toHaveLength(0);
    // The same start: the earlier original date first (an override moved onto another occurrence's time).
    const tie = series('2026-11-02T09:00', '2026-11-02T10:00', {
      recurrence: rr('FREQ=WEEKLY', { end: count(2) }),
      overrides: [override('onto', '2026-11-09', '2026-11-02T09:00', '2026-11-02T09:30')],
    });
    expect(show(run(tie, '2026-11-01T00:00', '2026-11-30T00:00').occurrences)).toEqual([
      '2026-11-02 2026-11-02T09:00..2026-11-02T10:00',
      '2026-11-09#onto 2026-11-02T09:00..2026-11-02T09:30',
    ]);
  });

  it('drops occurrences whose device start leaves years 1 to 9999 and stops ends at 9999-12-31T24:00', () => {
    const last = series('9999-12-31T22:00', '9999-12-31T23:00', { zone: NEW_YORK });
    expect(run(last, '9999-12-31T00:00', '9999-12-31T24:00')).toMatchObject({ occurrences: [], outOfRange: 1 });
    const late = series('9999-12-31T20:00', '9999-12-31T23:59', { zone: 'UTC' });
    expect(show(run(late, '9999-12-31T00:00', '9999-12-31T24:00').occurrences)).toEqual(['9999-12-31 9999-12-31T22:00..9999-12-31T24:00']);
    const first = series('0001-01-01T01:00', '0001-01-01T02:00', { zone: 'Test/Tokyo' });
    expect(run(first, '0001-01-01T00:00', '0001-01-02T00:00', 'UTC')).toMatchObject({ occurrences: [], outOfRange: 1 });
    const allDay = series('9999-12-31T00:00', '9999-12-31T24:00', { allDay: true, zone: null });
    expect(show(run(allDay, '9999-12-31T00:00', '9999-12-31T24:00', NEW_YORK).occurrences)).toEqual(['9999-12-31 all-day 9999-12-31T00:00..9999-12-31T24:00']);
  });

  it('drops a timed occurrence whose instant leaves years 1 to 9999 on every device, its own zone included (§4.6, far-future.ics)', () => {
    // 23:00 on 9999-12-31 in New York is 04:00 on January 1, 10000 in UTC: zonedToUtc has no answer.
    const last = series('9999-12-31T23:00', '9999-12-31T23:30', { zone: NEW_YORK });
    for (const device of [NEW_YORK, TALLINN, 'UTC']) {
      expect(run(last, '9999-12-31T00:00', '9999-12-31T24:00', device), device).toMatchObject({ occurrences: [], outOfRange: 1 });
    }
    // 18:59 is the last minute of year 9999 in UTC: kept in its own zone.
    const lastMinute = series('9999-12-31T18:59', '9999-12-31T19:30', { zone: NEW_YORK });
    expect(show(run(lastMinute, '9999-12-31T00:00', '9999-12-31T24:00', NEW_YORK).occurrences)).toEqual(['9999-12-31 9999-12-31T18:59..9999-12-31T19:30']);
    // 01:00 on 0001-01-01 in Tokyo is in year 0 in UTC, also seen from Tokyo.
    const first = series('0001-01-01T01:00', '0001-01-01T02:00', { zone: 'Test/Tokyo' });
    expect(run(first, '0001-01-01T00:00', '0001-01-02T00:00', 'Test/Tokyo')).toMatchObject({ occurrences: [], outOfRange: 1 });
    // A daily series: only the occurrence past the end goes; a floating one is placed in the device's zone.
    const daily = series('9999-12-30T23:00', '9999-12-30T23:30', { zone: NEW_YORK, recurrence: rr('FREQ=DAILY') });
    expect(run(daily, '9999-12-30T00:00', '9999-12-31T24:00', NEW_YORK)).toMatchObject({ outOfRange: 1 });
    expect(show(run(daily, '9999-12-30T00:00', '9999-12-31T24:00', NEW_YORK).occurrences)).toEqual(['9999-12-30 9999-12-30T23:00..9999-12-30T23:30']);
    const floating = series('9999-12-31T23:00', '9999-12-31T23:30', { zone: null });
    expect(run(floating, '9999-12-31T00:00', '9999-12-31T24:00', NEW_YORK)).toMatchObject({ occurrences: [], outOfRange: 1 });
    expect(show(run(floating, '9999-12-31T00:00', '9999-12-31T24:00', TALLINN).occurrences)).toEqual(['9999-12-31 9999-12-31T23:00..9999-12-31T23:30']);
    // An override moved to that instant goes too.
    const moved = series('9999-12-30T09:00', '9999-12-30T09:30', {
      zone: NEW_YORK,
      recurrence: rr('FREQ=DAILY', { end: count(2) }),
      overrides: [{ id: 'late', originalDate: g('9999-12-31'), originalMinute: null, canceled: false, allDay: false, start: L('9999-12-31T23:00'), end: L('9999-12-31T23:30'), zone: NEW_YORK }],
    });
    expect(run(moved, '9999-12-30T00:00', '9999-12-31T24:00', NEW_YORK)).toMatchObject({ outOfRange: 1 });
    expect(show(run(moved, '9999-12-30T00:00', '9999-12-31T24:00', NEW_YORK).occurrences)).toEqual(['9999-12-30 9999-12-30T09:00..9999-12-30T09:30']);
  });

  it('passes on truncation from the limit and the guard', () => {
    const daily = series('2026-11-02T09:00', '2026-11-02T10:00', { recurrence: rr('FREQ=DAILY') });
    expect(run(daily, '2026-11-01T00:00', '2026-12-01T00:00', TALLINN, 5)).toMatchObject({ truncated: true });
    expect(run(daily, '2026-11-01T00:00', '2026-12-01T00:00', TALLINN, 5).occurrences).toHaveLength(5);
    const impossible = series('0001-01-01T09:00', '0001-01-01T10:00', { zone: 'UTC', recurrence: rr('FREQ=DAILY;BYMONTH=1;BYYEARDAY=200') });
    expect(run(impossible, '2026-01-01T00:00', '2027-01-01T00:00', 'UTC')).toEqual({ occurrences: [], orphans: [], outOfRange: 0, truncated: true, unsupported: false });
  });

  it('rejects invalid series, windows, zones and options', () => {
    const ok = series('2026-11-02T09:00', '2026-11-02T10:00');
    const window = range('2026-11-01T00:00', '2026-12-01T00:00');
    const bad: (() => unknown)[] = [
      () => expandSeries(ok, window, 'Nowhere/City', zones),
      () => expandSeries({ ...ok, zone: 'Nowhere/City' }, window, TALLINN, zones),
      () => expandSeries({ ...ok, end: L('2026-11-02T08:00') }, window, TALLINN, zones),
      () => expandSeries({ ...ok, start: { date: g('2026-11-02'), minute: 1440 } }, window, TALLINN, zones),
      () => expandSeries({ ...ok, overrides: [override('bad', '2026-11-02', '2026-11-02T09:00', '2026-11-02T10:00', { originalMinute: 1440 })] }, window, TALLINN, zones),
      () => expandSeries({ ...ok, overrides: [override('bad', '2026-11-02', '2026-11-02T09:00', '2026-11-02T10:00', { zone: 'Nowhere/City' })] }, window, TALLINN, zones),
      () => expandSeries({ ...ok, recurrence: rr('FREQ=WEEKLY;COUNT=2') }, window, TALLINN, zones),
      () => expandSeries(ok, range('2026-12-01T00:00', '2026-11-01T00:00'), TALLINN, zones),
      () => expandSeries(ok, window, TALLINN, zones, { limit: 0 }),
      () => expandSeries(ok, window, TALLINN, zones, { max: 3 } as never),
      () => expandSeries(ok, window, TALLINN, {} as never),
      () => expandSeries({ ...ok, duration: { days: -1, minutes: 0 } }, window, TALLINN, zones),
      () => expandSeries({ ...ok, duration: { days: 1, minutes: 0.5 } }, window, TALLINN, zones),
      () => expandSeries({ ...ok, duration: 'P1D' as never }, window, TALLINN, zones),
    ];
    for (const fn of bad) expect(fn).toThrow(RangeError);
  });
});
