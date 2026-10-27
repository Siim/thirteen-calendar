/**
 * Performance targets of task C5 (docs/EVENTS.md §6.1), on Node on an M-class
 * laptop:
 *
 * 1. 2,000 occurrences laid out for a month in under 5 ms;
 * 2. a year of 500 recurring events expanded with `expandSeries` in under
 *    50 ms;
 * 3. the worst-case guard (an impossible daily rule from year 1) in under
 *    100 ms.
 *
 * Each target is checked against the median of several timed calls made
 * after warm-up calls, when the JIT has compiled the code as it has in an app
 * that is already showing a calendar; the first (cold) call is logged next to
 * it. Load from other processes comes in bursts, so the timed calls are made
 * in rounds: the check passes at the first round whose median is under the
 * target, and fails when every round misses it (`measure`). The zone resolver
 * here answers from the EU rule table in a few arithmetic steps, like the
 * platforms' native ones, so the numbers measure core and not `Intl`.
 *
 * The targets below are the spec's numbers. `THIRTEEN_PERF_SCALE` multiplies
 * all of them: `pnpm test:timing` uses 1 unless it is set, `pnpm test` uses 3
 * unless it is set (it runs on busy machines), and CI sets its runner's scale
 * explicitly. vitest.config.ts explains why; this file runs on its own, after
 * the other tests (the `timing` project).
 */
import { describe, expect, it } from 'vitest';
import {
  type EventOccurrence,
  type EventRecurrence,
  type RRule,
  type SeriesInput,
  type ThirteenRule,
  type ZoneResolver,
  addMinutesLocal,
  expandSeries,
  localDateTime,
} from '../../src/events/index.ts';
import {
  agenda,
  layoutDayEvents,
  layoutThirteenMonthEvents,
  layoutThirteenWeekEvents,
  yearEventMarks,
} from '../../src/events/layout.ts';
import { type Weekday, addGregorianDays, gregorianWeekday, parseISODate, toJulianDayNumber } from '../../src/index.ts';

const SCALE = Number(process.env.THIRTEEN_PERF_SCALE ?? '1');
if (!Number.isFinite(SCALE) || SCALE <= 0) {
  throw new Error(`THIRTEEN_PERF_SCALE must be a positive number, got ${JSON.stringify(process.env.THIRTEEN_PERF_SCALE)}`);
}

/** A spec target in milliseconds, scaled by `THIRTEEN_PERF_SCALE`. */
const target = (milliseconds: number) => milliseconds * SCALE;

interface Timing {
  /** The first call, before any warm-up (logged, not checked). */
  readonly cold: number;
  /** The best round's median: the value checked against the target. */
  readonly median: number;
  /** Every round's median, in the order taken. */
  readonly rounds: readonly number[];
}

/**
 * Wall times in milliseconds. One cold call, `warmups` unmeasured calls, then
 * rounds of `runs` timed calls; a round's value is the median of its calls.
 * Rounds stop at the first median under `limit`, or after `maxRounds`, and the
 * best round's median is returned. A burst of load from another process (a
 * build starting next to the tests, a shared CI runner) spoils a round, not
 * the check, while code slower than `limit` misses in every round.
 */
function measure(fn: () => unknown, options: { runs: number; warmups: number; limit: number; maxRounds?: number }): Timing {
  const { runs, warmups, limit, maxRounds = 5 } = options;
  const start = performance.now();
  fn();
  const cold = performance.now() - start;
  for (let i = 0; i < warmups; i++) fn();
  const rounds: number[] = [];
  while (rounds.length < maxRounds) {
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const begin = performance.now();
      fn();
      times.push(performance.now() - begin);
    }
    times.sort((a, b) => a - b);
    rounds.push(times[Math.floor(runs / 2)]!);
    if (rounds.at(-1)! < limit) break;
  }
  return { cold, median: Math.min(...rounds), rounds };
}

const ms = (time: Timing) =>
  `${time.median.toFixed(2)} ms (first call ${time.cold.toFixed(2)} ms` +
  `${time.rounds.length > 1 ? `, round medians ${time.rounds.map((m) => m.toFixed(1)).join(', ')} ms` : ''})`;

/** The limit as the log shows it: "5 ms" at scale 1, "15 ms (5 ms x 3)" otherwise. */
const limitText = (milliseconds: number) => (SCALE === 1 ? `${milliseconds} ms` : `${target(milliseconds)} ms (${milliseconds} ms x ${SCALE})`);

/** A deterministic pseudo-random sequence (32-bit LCG), so every run lays out the same data. */
function random(seed: number): (n: number) => number {
  let state = seed >>> 0;
  return (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

const CALENDARS = ['home', 'work', 'family', 'running-club', 'holidays', 'birthdays'];

/**
 * 2,000 occurrences starting in IFC October 2026 (Gregorian 2026-10-08 to
 * 11-04), about 71 a day: 10% all-day bars of 1 to 5 days, 5% timed bars of
 * 24 to 50 hours, the rest timed events of 0 to 3 hours, some across midnight
 * and some past the month's end.
 */
function denseMonth(): EventOccurrence[] {
  const next = random(2026);
  const first = parseISODate('2026-10-08');
  return Array.from({ length: 2000 }, (_, i) => {
    const day = addGregorianDays(first, next(28));
    const kind = next(20);
    const calendarId = CALENDARS[next(CALENDARS.length)]!;
    const key = `${calendarId}/event-${i}|${day.year}-${day.month}-${day.day}`;
    const title = `Event ${next(500)}`;
    if (kind < 2) {
      const start = localDateTime(day, 0);
      return { key, calendarId, title, allDay: true, start, end: localDateTime(addGregorianDays(day, next(5)), 1440) };
    }
    const start = localDateTime(day, next(96) * 15);
    const minutes = kind === 2 ? 1440 + next(26) * 60 : next(13) * 15;
    return { key, calendarId, title, allDay: false, start, end: addMinutesLocal(start, minutes) };
  });
}

describe('layout performance (§6.1 C5)', () => {
  const occurrences = denseMonth();

  it('lays out 2,000 occurrences for a month in under 5 ms', () => {
    let layout: ReturnType<typeof layoutThirteenMonthEvents> | null = null;
    const time = measure(() => (layout = layoutThirteenMonthEvents(2026, 11, occurrences, 'ifc', { maxLanes: 4 })), {
      runs: 25,
      warmups: 20,
      limit: target(5),
    });
    console.log(`layoutThirteenMonthEvents, 2,000 occurrences: ${ms(time)}; limit ${limitText(5)}`);
    expect(layout!.weeks.reduce((n, w) => n + w.items.length, 0)).toBeGreaterThanOrEqual(2000);
    expect(time.median).toBeLessThan(target(5));
  });

  it('lays out the same 2,000 occurrences for a week, a day, an agenda and year marks', () => {
    // No separate targets in §6.1; each is the same order of work as the month and must stay there.
    const options = { runs: 15, warmups: 20, limit: target(5) };
    const results = {
      week: measure(() => layoutThirteenWeekEvents(2026, 11, 2, occurrences, 'ifc', { maxSlots: 4 }), options),
      day: measure(() => layoutDayEvents(parseISODate('2026-10-19'), occurrences, { maxSlots: 4 }), options),
      agenda: measure(() => agenda(occurrences, parseISODate('2026-10-08'), parseISODate('2026-11-04')), options),
      yearMarks: measure(() => yearEventMarks(2026, occurrences), options),
    };
    console.log(
      `2,000 occurrences: week ${ms(results.week)}, day ${ms(results.day)}, agenda ${ms(results.agenda)}, ` +
        `year marks ${ms(results.yearMarks)}; limit ${limitText(5)} each`,
    );
    for (const time of Object.values(results)) expect(time.median).toBeLessThan(target(5));
  });
});

// ---------------------------------------------------------------------------
// expandSeries (task C4)
// ---------------------------------------------------------------------------

/** The last Sunday of `month` in `year`, as a Julian Day Number. */
function lastSunday(year: number, month: number): number {
  const last = addGregorianDays({ year, month: month + 1, day: 1 }, -1);
  return toJulianDayNumber(last) - gregorianWeekday(last);
}

/**
 * Europe/Tallinn by the EU rule (UTC+2, UTC+3 from 01:00 UTC on the last
 * Sunday of March to 01:00 UTC on the last Sunday of October), and UTC. Exact
 * for 2002 on; a stand-in for a native resolver.
 */
const euResolver: ZoneResolver = {
  isKnown: (tzid) => tzid === 'Europe/Tallinn' || tzid === 'UTC',
  offsetMinutesAt(tzid, utc) {
    if (tzid === 'UTC') return 0;
    const { year } = utc.date;
    const minute = toJulianDayNumber(utc.date) * 1440 + utc.minute;
    const summerFrom = lastSunday(year, 3) * 1440 + 60;
    const summerTo = lastSunday(year, 10) * 1440 + 60;
    return minute >= summerFrom && minute < summerTo ? 180 : 120;
  },
};

function rrule(freq: RRule['freq'], parts: Partial<RRule> = {}): RRule {
  return {
    freq,
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
    ...parts,
  };
}

const repeat = (rule: EventRecurrence['rule']): EventRecurrence => ({ rule, end: { kind: 'never' }, extraDates: [], exceptDates: [] });
const day = (weekday: Weekday) => ({ weekday, ordinal: null });

/**
 * 500 repeating events started between 2020 and 2026: weekly (some every 2
 * weeks, some on three weekdays), daily (some every 3 days), monthly, yearly
 * and the four 13-month kinds; a fifth all-day, the rest timed in
 * Europe/Tallinn (a tenth floating).
 */
function fiveHundredSeries(): SeriesInput[] {
  const next = random(500);
  return Array.from({ length: 500 }, (_, i) => {
    const startDay = addGregorianDays(parseISODate('2020-01-01'), next(7 * 365));
    const kind = i % 10;
    const thirteen = (rule: ThirteenRule) => repeat({ kind: 'thirteen', rule });
    const recurrence: EventRecurrence =
      kind <= 2
        ? repeat({ kind: 'rrule', rrule: rrule('weekly', { interval: 1 + (i % 2) }) })
        : kind === 3
          ? repeat({ kind: 'rrule', rrule: rrule('weekly', { byDay: [day(1), day(3), day(5)] }) })
          : kind === 4
            ? repeat({ kind: 'rrule', rrule: rrule('daily', { interval: i % 3 === 0 ? 3 : 1 }) })
            : kind === 5
              ? repeat({ kind: 'rrule', rrule: rrule('monthly') })
              : kind === 6
                ? repeat({ kind: 'rrule', rrule: rrule('yearly') })
                : kind === 7
                  ? thirteen({ kind: 'monthly', system: 'ifc', day: 1 + next(28) })
                  : kind === 8
                    ? thirteen({ kind: 'weekly', system: 'ifc', weekday: next(7) as Weekday, interval: (1 + (i % 2)) as 1 | 2 })
                    : thirteen({ kind: 'yearly', system: 'positivist', month: 1 + next(13), day: 1 + next(28) });
    const allDay = i % 5 === 0;
    const start = localDateTime(startDay, allDay ? 0 : 7 * 60 + next(48) * 15);
    const end = allDay ? localDateTime(startDay, 1440) : addMinutesLocal(start, 30 + next(8) * 15);
    return { id: `series-${i}`, recurrence, allDay, start, end, zone: allDay || i % 10 === 9 ? null : 'Europe/Tallinn', overrides: [] };
  });
}

describe('expandSeries performance (§6.1 C5)', () => {
  const year2026 = { from: localDateTime(parseISODate('2026-01-01'), 0), to: localDateTime(parseISODate('2027-01-01'), 0) };

  it('expands a year of 500 repeating events in under 50 ms', () => {
    const series = fiveHundredSeries();
    const expandAll = () => series.reduce((n, s) => n + expandSeries(s, year2026, 'Europe/Tallinn', euResolver).occurrences.length, 0);
    let total = 0;
    const time = measure(() => (total = expandAll()), { runs: 7, warmups: 3, limit: target(50) });
    console.log(`expandSeries, 500 series over 2026: ${total} occurrences in ${ms(time)}; limit ${limitText(50)}`);
    expect(total).toBeGreaterThan(500 * 12);
    expect(time.median).toBeLessThan(target(50));
  });

  it('stops an impossible daily rule from year 1 in under 100 ms', () => {
    // January never holds day 200 of the year; the month and day pairs exist, so only the
    // 400-year guard of §4.6 step 5 stops the iteration.
    const series: SeriesInput = {
      id: 'impossible',
      recurrence: repeat({ kind: 'rrule', rrule: rrule('daily', { byMonth: [1], byYearDay: [200] }) }),
      allDay: false,
      start: localDateTime(parseISODate('0001-01-01'), 9 * 60),
      end: localDateTime(parseISODate('0001-01-01'), 10 * 60),
      zone: 'UTC',
      overrides: [],
    };
    let result: ReturnType<typeof expandSeries> | null = null;
    const time = measure(() => (result = expandSeries(series, year2026, 'UTC', euResolver)), { runs: 5, warmups: 2, limit: target(100) });
    console.log(`expandSeries, impossible daily rule from year 1: ${ms(time)}; limit ${limitText(100)}`);
    expect(result!.occurrences).toEqual([]);
    expect(time.median).toBeLessThan(target(100));
  });
});
