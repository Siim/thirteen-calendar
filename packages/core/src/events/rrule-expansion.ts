/**
 * The RFC 5545 §3.3.10 engine behind recurrence expansion (docs/EVENTS.md §4.6
 * step 1, "`rrule` rule"): the candidate dates one `RRULE` (or `EXRULE`)
 * produces, period by period, with the calendar-time guard. Internal: the
 * public API is `expandRecurrence` and the functions built on it in
 * `recurrence.ts`, which add the start, the ends, extra dates and exclusions.
 *
 * Dates are Julian Day Numbers. The civil arithmetic here is unchecked, so a
 * week period may begin in year 0 and a `BYWEEKNO` week may end in year
 * 10000; no date outside 0001-01-01 … 9999-12-31 is ever produced.
 *
 * **Periods.** `DAILY` steps days from the start, `WEEKLY` steps weeks that
 * begin on `WKST` (default Monday) from the week holding the start, `MONTHLY`
 * steps months from the start's month and `YEARLY` steps calendar years from
 * the start's year, each by `INTERVAL`.
 *
 * **Candidates of a period**, before `BYSETPOS`:
 *
 * - `DAILY`: the day, when it passes every limit: `BYMONTH`, `BYYEARDAY`
 *   (tolerated, §4.6), `BYMONTHDAY` and `BYDAY` (ordinals ignored).
 * - `WEEKLY`: the week's days on a `BYDAY` weekday (ordinals ignored), or on
 *   the start's weekday without `BYDAY`, limited by `BYMONTH`.
 * - `MONTHLY`: nothing in a month outside `BYMONTH`. Without `BYMONTHDAY` and
 *   `BYDAY`, the start's day of the month (skipped in months without it).
 *   Otherwise the month's days that match `BYMONTHDAY` (when given) and `BYDAY`
 *   (when given; an ordinal counts the weekday within the month, from its
 *   start or, when negative, from its end).
 * - `YEARLY`: without `BYWEEKNO`, `BYYEARDAY`, `BYMONTHDAY` and `BYDAY`, the
 *   start's day in each `BYMONTH` month, or the start's month and day. Otherwise
 *   the year's days that match every part given: `BYMONTH`, `BYWEEKNO`,
 *   `BYYEARDAY`, `BYMONTHDAY` and `BYDAY`. A `BYDAY` ordinal counts the weekday
 *   within its month when `BYMONTH` is given, else within the year, and is
 *   ignored with `BYWEEKNO`; `BYWEEKNO` without `BYDAY` keeps the start's
 *   weekday. A day is in week `n` when it lies in week `n` of the
 *   week-numbering year it belongs to (weeks begin on `WKST`; week 1 is the
 *   first with at least four days in its year; `-1` is the last week), so week
 *   1 may begin in late December.
 *
 * `BYSETPOS` then picks positions in the period's sorted candidates (negative
 * from the end). Invalid dates (February 30, the 31st of a 30-day month, day
 * 366 of a common year) are skipped, never moved.
 *
 * **Guard.** The engine stops, and reports `truncated`, at the first period
 * whose first day lies in a year more than `400 × INTERVAL` years after the
 * year of the last candidate on or after the start (or of the start). Every
 * rule repeats within that span (the Gregorian calendar repeats every 400
 * years), so the guard only stops rules that never produce a date after the
 * start; `FREQ=DAILY;BYMONTH=2;BYMONTHDAY=29` keeps going.
 *
 * **Jumping ahead.** When the caller does not count occurrences, the engine
 * may skip from the period after its first candidate (on either side of the
 * start) straight to the first period that can reach the wanted dates. This
 * gives exactly the dates and the `truncated` flag of a step-by-step run: the
 * candidates of a period do not depend on the periods before it, and once the
 * rule has produced one candidate the guard can no longer fire.
 * @internal
 * @module
 */

import { type GregorianDate, MAX_JULIAN_DAY_NUMBER, MIN_JULIAN_DAY_NUMBER } from '../gregorian.ts';
import type { Weekday } from '../weekday.ts';
import type { RRule, WeekdayNum } from './rrule.ts';

/** Years after the last candidate (times `INTERVAL`) after which a rule is given up (§4.6 step 5). */
const GUARD_YEARS = 400;

// ---------------------------------------------------------------------------
// Unchecked civil arithmetic
// ---------------------------------------------------------------------------

/** Julian Day Number of any proleptic Gregorian date (no range check). */
export function jdnOf(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

/** Year, month and day of any Julian Day Number (no range check). */
export function civilOf(jdn: number): GregorianDate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

/** The year of any Julian Day Number. */
export const yearOf = (jdn: number): number => civilOf(jdn).year;

/** The Gregorian leap-year rule for any integer year. */
export const isLeap = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Days in a month of any year. */
export const monthLength = (year: number, month: number): number => (month === 2 && isLeap(year) ? 29 : MONTH_LENGTHS[month - 1]!);

/** Weekday (`0 = Sunday`) of any Julian Day Number. */
export const weekdayOf = (jdn: number): Weekday => ((((jdn + 1) % 7) + 7) % 7) as Weekday;

/** The longest each month can be (February 29). */
const MAX_MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

/**
 * Whether the engine can expand a rule (§4.6 step 6): `'unsupported'` for
 * `HOURLY`, `MINUTELY` and `SECONDLY`, an `RSCALE` other than `GREGORIAN`, any
 * `SKIP` (§4.6 lists it without exception, so also `OMIT`, the RFC 7529
 * default), `BYHOUR`, `BYMINUTE` or
 * `BYSECOND` with more than one value, and the parts RFC 5545 does not allow
 * with the frequency (`BYWEEKNO` outside `YEARLY`, `BYYEARDAY` in `WEEKLY` and
 * `MONTHLY`, `BYMONTHDAY` in `WEEKLY`). When `startMinute` is given, a single
 * `BYHOUR` or `BYMINUTE` value must also be the start's hour and minute, and a
 * single `BYSECOND` value 0 (seconds are dropped when reading, §3.3).
 *
 * `'impossible'` for a rule whose `BYMONTH` and `BYMONTHDAY` never meet
 * (`BYMONTH=2;BYMONTHDAY=30`), which is detected before iterating (§4.6
 * step 5). Everything else is `'supported'`.
 */
export function rruleSupport(rule: RRule, startMinute: number | null): 'supported' | 'unsupported' | 'impossible' {
  const { freq } = rule;
  if (freq === 'secondly' || freq === 'minutely' || freq === 'hourly') return 'unsupported';
  if (rule.rscale !== null && rule.rscale !== 'GREGORIAN') return 'unsupported';
  if (rule.skip !== null) return 'unsupported';
  if (rule.byHour.length > 1 || rule.byMinute.length > 1 || rule.bySecond.length > 1) return 'unsupported';
  if (startMinute !== null) {
    if (rule.byHour.length === 1 && rule.byHour[0] !== Math.floor(startMinute / 60)) return 'unsupported';
    if (rule.byMinute.length === 1 && rule.byMinute[0] !== startMinute % 60) return 'unsupported';
    if (rule.bySecond.length === 1 && rule.bySecond[0] !== 0) return 'unsupported';
  }
  if (rule.byWeekNo.length > 0 && freq !== 'yearly') return 'unsupported';
  if (rule.byYearDay.length > 0 && (freq === 'weekly' || freq === 'monthly')) return 'unsupported';
  if (rule.byMonthDay.length > 0 && freq === 'weekly') return 'unsupported';
  if (rule.byMonth.length > 0 && rule.byMonthDay.length > 0) {
    const meets = rule.byMonth.some((month) => rule.byMonthDay.some((day) => Math.abs(day) <= MAX_MONTH_LENGTHS[month - 1]!));
    if (!meets) return 'impossible';
  }
  return 'supported';
}

// ---------------------------------------------------------------------------
// Compiled rules
// ---------------------------------------------------------------------------

interface CompiledRule {
  readonly freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  readonly interval: number;
  /** Bit `m` set for each `BYMONTH` month; 0 without `BYMONTH`. */
  readonly months: number;
  readonly monthList: readonly number[];
  readonly weekNos: readonly number[];
  readonly yearDays: readonly number[];
  readonly monthDays: readonly number[];
  readonly hasByDay: boolean;
  /** Bit `w` set for each `BYDAY` weekday matched on every such day (entries without an ordinal, or all when ordinals are ignored). */
  readonly plainDays: number;
  /** `BYDAY` entries whose ordinal counts. */
  readonly ordinalDays: readonly WeekdayNum[];
  readonly setPos: readonly number[];
  readonly wkst: Weekday;
  readonly dayLevel: boolean;
}

function compile(rule: RRule): CompiledRule {
  const freq = rule.freq as CompiledRule['freq'];
  // Ordinals count only in MONTHLY rules and in YEARLY rules without BYWEEKNO.
  const ordinalsCount = freq === 'monthly' || (freq === 'yearly' && rule.byWeekNo.length === 0);
  let plainDays = 0;
  const ordinalDays: WeekdayNum[] = [];
  for (const entry of rule.byDay) {
    if (entry.ordinal !== null && ordinalsCount) ordinalDays.push({ weekday: entry.weekday, ordinal: entry.ordinal });
    else plainDays |= 1 << entry.weekday;
  }
  let months = 0;
  for (const month of rule.byMonth) months |= 1 << month;
  return {
    freq,
    interval: rule.interval,
    months,
    monthList: [...new Set(rule.byMonth)].sort((a, b) => a - b),
    weekNos: [...rule.byWeekNo],
    yearDays: [...rule.byYearDay],
    monthDays: [...rule.byMonthDay],
    hasByDay: rule.byDay.length > 0,
    plainDays,
    ordinalDays,
    setPos: [...rule.bySetPos],
    wkst: rule.wkst ?? 1,
    dayLevel: rule.byWeekNo.length > 0 || rule.byYearDay.length > 0 || rule.byMonthDay.length > 0 || rule.byDay.length > 0,
  };
}

/** `true` when position `value` (1-based, negative from the end) of a run of `length` is `position`. */
const matchesPosition = (value: number, position: number, length: number): boolean =>
  value > 0 ? value === position : length + value + 1 === position;

const inList = (list: readonly number[], position: number, length: number): boolean =>
  list.some((value) => matchesPosition(value, position, length));

/** The first day of week 1 of `year` for weeks that begin on `wkst`: the `wkst` day on or before January 4. */
function weekOneStart(year: number, wkst: Weekday): number {
  const fourth = jdnOf(year, 1, 4);
  return fourth - ((weekdayOf(fourth) - wkst + 7) % 7);
}

/** Week starts around one calendar year, for `BYWEEKNO`. */
interface WeekYears {
  /** `starts[i]` is the start of week 1 of `year - 1 + i`, for i = 0 … 3. */
  readonly starts: readonly number[];
  readonly year: number;
}

function weekYears(year: number, wkst: Weekday): WeekYears {
  return { year, starts: [0, 1, 2, 3].map((i) => weekOneStart(year - 1 + i, wkst)) };
}

/** `true` when day `jdn` (in calendar year `weeks.year`) lies in one of the `BYWEEKNO` weeks. */
function inWeeks(jdn: number, weeks: WeekYears, weekNos: readonly number[]): boolean {
  const { starts } = weeks;
  // The week-numbering year: the one before, the same or the one after.
  const index = jdn < starts[1]! ? 0 : jdn < starts[2]! ? 1 : 2;
  const first = starts[index]!;
  const count = (starts[index + 1]! - first) / 7;
  return inList(weekNos, Math.floor((jdn - first) / 7) + 1, count);
}

/** `true` when the weekday of `jdn` matches `BYDAY`; `nth` and `nthFromEnd` count the weekday in its month or year. */
function dayMatches(rule: CompiledRule, weekday: Weekday, nth: number, nthFromEnd: number): boolean {
  if ((rule.plainDays & (1 << weekday)) !== 0) return true;
  return rule.ordinalDays.some((entry) => entry.weekday === weekday && (entry.ordinal! > 0 ? entry.ordinal === nth : -entry.ordinal! === nthFromEnd));
}

function applySetPos(candidates: number[], setPos: readonly number[]): number[] {
  if (setPos.length === 0) return candidates;
  const picked = new Set<number>();
  for (const value of setPos) {
    const index = value > 0 ? value - 1 : candidates.length + value;
    if (index >= 0 && index < candidates.length) picked.add(candidates[index]!);
  }
  return [...picked].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Candidates per period
// ---------------------------------------------------------------------------

function dailyCandidates(rule: CompiledRule, jdn: number): number[] {
  const { year, month, day } = civilOf(jdn);
  if (rule.months !== 0 && (rule.months & (1 << month)) === 0) return [];
  if (rule.monthDays.length > 0 && !inList(rule.monthDays, day, monthLength(year, month))) return [];
  if (rule.yearDays.length > 0) {
    const dayOfYear = jdn - jdnOf(year, 1, 1) + 1;
    if (!inList(rule.yearDays, dayOfYear, isLeap(year) ? 366 : 365)) return [];
  }
  if (rule.hasByDay && (rule.plainDays & (1 << weekdayOf(jdn))) === 0) return [];
  return applySetPos([jdn], rule.setPos);
}

function weeklyCandidates(rule: CompiledRule, weekStart: number, startWeekday: Weekday): number[] {
  const wanted = rule.hasByDay ? rule.plainDays : 1 << startWeekday;
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    const jdn = weekStart + i;
    if ((wanted & (1 << weekdayOf(jdn))) === 0) continue;
    if (rule.months !== 0 && (rule.months & (1 << civilOf(jdn).month)) === 0) continue;
    out.push(jdn);
  }
  return applySetPos(out, rule.setPos);
}

function monthlyCandidates(rule: CompiledRule, year: number, month: number, start: GregorianDate): number[] {
  if (rule.months !== 0 && (rule.months & (1 << month)) === 0) return [];
  const length = monthLength(year, month);
  const base = jdnOf(year, month, 1);
  if (rule.monthDays.length === 0 && !rule.hasByDay) return start.day <= length ? [base + start.day - 1] : [];
  const out: number[] = [];
  for (let day = 1; day <= length; day++) {
    if (rule.monthDays.length > 0 && !inList(rule.monthDays, day, length)) continue;
    const jdn = base + day - 1;
    if (rule.hasByDay && !dayMatches(rule, weekdayOf(jdn), Math.floor((day - 1) / 7) + 1, Math.floor((length - day) / 7) + 1)) continue;
    out.push(jdn);
  }
  return applySetPos(out, rule.setPos);
}

function yearlyCandidates(rule: CompiledRule, year: number, start: GregorianDate, startWeekday: Weekday): number[] {
  if (!rule.dayLevel) {
    const months = rule.monthList.length > 0 ? rule.monthList : [start.month];
    const out = months.filter((month) => start.day <= monthLength(year, month)).map((month) => jdnOf(year, month, start.day));
    return applySetPos(out, rule.setPos);
  }
  const yearLength = isLeap(year) ? 366 : 365;
  const weeks = rule.weekNos.length > 0 ? weekYears(year, rule.wkst) : null;
  const out: number[] = [];
  let dayOfYear = 0;
  let jdn = jdnOf(year, 1, 1) - 1;
  for (let month = 1; month <= 12; month++) {
    const length = monthLength(year, month);
    if (rule.months !== 0 && (rule.months & (1 << month)) === 0) {
      dayOfYear += length;
      jdn += length;
      continue;
    }
    for (let day = 1; day <= length; day++) {
      dayOfYear++;
      jdn++;
      if (rule.yearDays.length > 0 && !inList(rule.yearDays, dayOfYear, yearLength)) continue;
      if (rule.monthDays.length > 0 && !inList(rule.monthDays, day, length)) continue;
      if (weeks !== null && !inWeeks(jdn, weeks, rule.weekNos)) continue;
      const weekday = weekdayOf(jdn);
      if (rule.hasByDay) {
        const inMonth = rule.months !== 0;
        const nth = inMonth ? Math.floor((day - 1) / 7) + 1 : Math.floor((dayOfYear - 1) / 7) + 1;
        const nthFromEnd = inMonth ? Math.floor((length - day) / 7) + 1 : Math.floor((yearLength - dayOfYear) / 7) + 1;
        if (!dayMatches(rule, weekday, nth, nthFromEnd)) continue;
      } else if (weeks !== null && weekday !== startWeekday) {
        continue;
      }
      out.push(jdn);
    }
  }
  return applySetPos(out, rule.setPos);
}

// ---------------------------------------------------------------------------
// The candidate stream
// ---------------------------------------------------------------------------

/**
 * The dates one supported rule produces from `start` (inclusive, only when the
 * rule produces it) through `stop` (inclusive), ascending. {@link next}
 * returns -1 at the end; {@link truncated} then tells whether the guard
 * stopped it. With `jumpTo` (a day; the caller does not count dates), dates
 * before it may be skipped.
 */
export class RRuleCandidates {
  private readonly rule: CompiledRule;
  private readonly start: GregorianDate;
  private readonly startJdn: number;
  private readonly startWeekday: Weekday;
  private readonly stop: number;
  private readonly jumpTo: number | null;
  /** The period index of the next period to generate. */
  private period = 0;
  private queue: number[] = [];
  private head = 0;
  private lastYear: number;
  private found = false;
  private jumped = false;
  private done = false;
  /**
   * Days between dates for a `DAILY` or `WEEKLY` rule with no `BY` parts (one
   * date in every period, the start's weekday): they need no period
   * arithmetic, and the guard cannot stop them. 0 for every other rule.
   */
  private readonly step: number;
  /** `true` once the guard has stopped the stream. */
  truncated = false;

  constructor(rule: RRule, start: GregorianDate, stop: number, jumpTo: number | null) {
    this.rule = compile(rule);
    this.start = start;
    this.startJdn = jdnOf(start.year, start.month, start.day);
    this.startWeekday = weekdayOf(this.startJdn);
    this.stop = Math.min(stop, MAX_JULIAN_DAY_NUMBER);
    this.jumpTo = jumpTo;
    this.lastYear = start.year;
    const plain = this.rule.months === 0 && !this.rule.dayLevel && this.rule.setPos.length === 0;
    this.step = !plain ? 0 : this.rule.freq === 'daily' ? this.rule.interval : this.rule.freq === 'weekly' ? 7 * this.rule.interval : 0;
  }

  /** The next date (a Julian Day Number), or -1 at the end. */
  next(): number {
    if (this.step !== 0) {
      if (this.done) return -1;
      if (this.found && !this.jumped && this.jumpTo !== null) this.jump();
      // Period k of a weekly rule holds the start's weekday of its week: the start plus k weeks.
      const jdn = this.startJdn + this.step * this.period++;
      if (jdn > this.stop) {
        this.done = true;
        return -1;
      }
      this.found = true;
      return jdn;
    }
    for (;;) {
      if (this.head < this.queue.length) {
        const jdn = this.queue[this.head++]!;
        if (jdn > this.stop) {
          this.done = true;
          this.queue = [];
          return -1;
        }
        return jdn;
      }
      if (this.done) return -1;
      this.fill();
    }
  }

  /** Generates the next period with candidates on or after the start, or ends the stream. */
  private fill(): void {
    const rule = this.rule;
    for (;;) {
      if (this.found && !this.jumped && this.jumpTo !== null) this.jump();
      const k = this.period++;
      let first: number;
      let year: number;
      let candidates: number[];
      switch (rule.freq) {
        case 'daily':
          first = this.startJdn + k * rule.interval;
          year = first > this.stop ? 0 : yearOf(first);
          candidates = first > this.stop ? [] : dailyCandidates(rule, first);
          break;
        case 'weekly': {
          const weekStart = this.weekStart() + 7 * rule.interval * k;
          first = weekStart;
          year = yearOf(first);
          candidates = first > this.stop ? [] : weeklyCandidates(rule, weekStart, this.startWeekday);
          break;
        }
        case 'monthly': {
          const index = this.start.year * 12 + this.start.month - 1 + rule.interval * k;
          year = Math.floor(index / 12);
          const month = (index % 12) + 1;
          first = jdnOf(year, month, 1);
          candidates = first > this.stop ? [] : monthlyCandidates(rule, year, month, this.start);
          break;
        }
        case 'yearly':
          year = this.start.year + rule.interval * k;
          first = jdnOf(year, 1, 1);
          candidates = first > this.stop ? [] : yearlyCandidates(rule, year, this.start, this.startWeekday);
          break;
      }
      if (first > this.stop) {
        this.done = true;
        return;
      }
      if (year > this.lastYear + GUARD_YEARS * rule.interval) {
        this.done = true;
        this.truncated = true;
        return;
      }
      if (candidates.length > 0) this.found = true;
      const kept = candidates.filter((jdn) => jdn >= this.startJdn && jdn >= MIN_JULIAN_DAY_NUMBER);
      if (kept.length > 0) {
        this.lastYear = yearOf(kept[kept.length - 1]!);
        this.queue = kept;
        this.head = 0;
        return;
      }
    }
  }

  /** The first day of the week holding the start. */
  private weekStart(): number {
    return this.startJdn - ((this.startWeekday - this.rule.wkst + 7) % 7);
  }

  /** Skips to the first period that can reach `jumpTo` (see the module documentation). */
  private jump(): void {
    this.jumped = true;
    const rule = this.rule;
    const target = this.jumpTo!;
    const step = rule.interval;
    let k: number;
    switch (rule.freq) {
      case 'daily':
        k = Math.ceil((target - this.startJdn) / step);
        break;
      case 'weekly':
        k = Math.ceil((target - 6 - this.weekStart()) / (7 * step));
        break;
      case 'monthly': {
        const { year, month } = civilOf(target);
        k = Math.ceil((year * 12 + month - 1 - (this.start.year * 12 + this.start.month - 1)) / step);
        break;
      }
      case 'yearly':
        k = Math.ceil((yearOf(target) - this.start.year) / step);
        break;
    }
    if (k <= this.period) return;
    this.period = k;
    // The rule has produced a candidate, so the next one is less than one cycle away from any period.
    const first =
      rule.freq === 'daily'
        ? this.startJdn + k * step
        : rule.freq === 'weekly'
          ? this.weekStart() + 7 * step * k
          : rule.freq === 'monthly'
            ? jdnOf(Math.floor((this.start.year * 12 + this.start.month - 1 + step * k) / 12), 1, 1)
            : jdnOf(this.start.year + step * k, 1, 1);
    this.lastYear = Math.max(this.lastYear, yearOf(first));
  }
}
