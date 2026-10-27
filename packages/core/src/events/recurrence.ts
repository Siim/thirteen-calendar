/**
 * Event recurrence (docs/EVENTS.md §4, §5.2): the {@link EventRecurrence}
 * value, its expansion into original dates ({@link expandRecurrence},
 * {@link nextOccurrences}), ends ({@link endRecurrenceBefore},
 * {@link laterOccurrenceCount}), the "future events" split
 * ({@link splitRecurrence}) and the retime of a series' exceptions
 * ({@link retimeExceptions}), the `RRULE` a repeat is written as
 * ({@link recurrenceToRRule}), the repeat picker's presets, descriptions,
 * "Next:" line and notes, the re-derivation of a repeat for a new start
 * ({@link adaptRecurrenceToStart}), and recognition of stored data
 * ({@link recognizeRecurrence}).
 *
 * **Dates and minutes.** A recurrence works on original dates in the event's
 * zone. The start is a date; its time of day is the master's, which is why an
 * {@link ExtraDate} or {@link OriginalDate} has a `minute` only when it differs
 * from the master's start minute (`null` stands for the master's minute, and a
 * `DATE` value of an all-day series is always `null`). Two values are the
 * same occurrence when their dates and minutes are equal.
 *
 * **Expansion** (§4.6) builds, in this order: the rule stream (the start
 * first, then the rule's dates after it), the ends applied to that stream only
 * (`COUNT` counts the start and dates that are later excluded), the extra dates
 * added whatever their date (a value already produced at the same date and
 * minute is not repeated), and the exclusions (`exceptDates` by date and
 * minute; a `foreign` rule's `EXRULE`s remove dates at the master's minute).
 * The rule streams of `RRULE`s follow RFC 5545 §3.3.10 (see
 * `rrule-expansion.ts` for the exact period and candidate rules, including the
 * 400-year calendar-time guard). An `EXRULE` produces its own dates from the
 * start; unlike an `RRULE` it does not add the start as its first date, and
 * its `COUNT` counts only its own dates.
 * @module
 */

import { formatGregorian, formatThirteen, ordinal } from '../format.ts';
import {
  type GregorianDate,
  GREGORIAN_MONTHS,
  MAX_JULIAN_DAY_NUMBER,
  MAX_YEAR,
  MIN_JULIAN_DAY_NUMBER,
  assertValidGregorian,
  fromJulianDayNumber,
  gregorianWeekday,
  isLeapYear,
  isValidGregorian,
} from '../gregorian.ts';
import { clonePlain, fail, isInteger, isRecord, plainEquals, readBooleanOption, readOptions, show } from '../internal.ts';
import {
  type CalendarSystemId,
  DEFAULT_SYSTEM_ID,
  getCalendarSystem,
  isCalendarSystemId,
} from '../systems/index.ts';
import { isMonthDate, thirteenWeekday, toDisplayYear, toThirteen } from '../thirteen.ts';
import { type Weekday, WEEKDAY_NAMES } from '../weekday.ts';
import type { RepeatChange } from './model.ts';
import { RRuleCandidates, isLeap, jdnOf, rruleSupport, yearOf } from './rrule-expansion.ts';
import { type RRule, type WeekdayNum, assertValidRRule, copyRRule, rruleEquals, untilEndDate } from './rrule.ts';
import {
  type ThirteenRule,
  assertValidThirteenRule,
  copyThirteenRule,
  encodeThirteenRule,
  parseThirteenRuleText,
  parseThirteenRuleUri,
  thirteenEncodingForm,
  thirteenRuleCap,
  thirteenRuleDatesInYear,
  thirteenRuleFor,
  thirteenRuleIncludes,
  thirteenRuleRdates,
  thirteenRuleYearDayList,
  thirteenRuleYearDays,
} from './thirteen-rules.ts';
import { type LocalDateTime, assertValidLocalDateTime, copyDate } from './time.ts';

// ---------------------------------------------------------------------------
// Types (§5.2)
// ---------------------------------------------------------------------------

/** How a repeat ends: never, after `count` occurrences (counting the start), or on the last occurrence on or before `date`. */
export type RepeatEnd =
  | { readonly kind: 'never' }
  | { readonly kind: 'count'; readonly count: number }
  | { readonly kind: 'until'; readonly date: GregorianDate };

/** One `RRULE` or `EXRULE` with its own end (inside a `foreign` rule); `rrule` has no `COUNT` or `UNTIL`. */
export interface EndedRule {
  readonly rrule: RRule;
  readonly end: RepeatEnd;
}

/** The rule part of a recurrence. */
export type RepeatRule =
  /** One Gregorian `RRULE`, without `COUNT` / `UNTIL` (they live in {@link RepeatEnd}). */
  | { readonly kind: 'rrule'; readonly rrule: RRule }
  /** A 13-month rule (§4.2). */
  | { readonly kind: 'thirteen'; readonly rule: ThirteenRule }
  /** No rule: the start plus `extraDates`. */
  | { readonly kind: 'dates' }
  /** Several `RRULE`s and/or `EXRULE`s, each with its own end; the recurrence's end is `never`. */
  | { readonly kind: 'foreign'; readonly rules: readonly EndedRule[]; readonly exrules: readonly EndedRule[] };

/** An `RDATE`. `minute` and `durationMinutes` null = the master's start time and length (`RDATE;VALUE=PERIOD` sets both). */
export interface ExtraDate {
  readonly date: GregorianDate;
  /** `0…1439`, or `null` for the master's start minute. */
  readonly minute: number | null;
  /** `>= 0`, or `null` for the master's length. */
  readonly durationMinutes: number | null;
}

/**
 * An original occurrence: an `EXDATE` value, a `RECURRENCE-ID` or an
 * `ORIGINAL_INSTANCE_TIME`. `minute` null = the master's start time (or a
 * `DATE` value); a minute = an extra date's own time. Matched, deduped and
 * retimed by date and minute (§4.6).
 */
export interface OriginalDate {
  readonly date: GregorianDate;
  readonly minute: number | null;
}

/** A repeat: its rule, end, extra dates (`RDATE`) and removed dates (`EXDATE`). */
export interface EventRecurrence {
  readonly rule: RepeatRule;
  readonly end: RepeatEnd;
  /** RDATEs not explained by the rule; kept, expanded and written back. */
  readonly extraDates: readonly ExtraDate[];
  /** Original occurrences removed (EXDATE). */
  readonly exceptDates: readonly OriginalDate[];
}

/** A window of original dates, both ends inclusive. */
export interface ExpansionWindow {
  readonly from: GregorianDate;
  readonly to: GregorianDate;
}

/** An original date, with its own time and length if it has them. */
export type ExpandedDate = ExtraDate;

/** The result of {@link expandRecurrence}. */
export interface Expansion {
  /** Ascending by date, then by minute (the master's time first), without duplicates. */
  readonly occurrences: ExpandedDate[];
  /** The `limit` was reached, the calendar-time guard stopped a rule, or the rule can never match (§4.6 step 5). */
  readonly truncated: boolean;
  /** The rule cannot be expanded (§4.6 step 6): `occurrences` holds only the start when the window holds it. */
  readonly unsupported: boolean;
}

/** Where an exception (an `EXDATE` or an override's original) goes: `to` null means it is dropped. */
export interface ExceptionMap {
  readonly from: OriginalDate;
  readonly to: OriginalDate | null;
}

/** The result of {@link splitRecurrence} (§4.7). */
export interface SplitResult {
  /** The series before `at`; `null` when `at` is the first occurrence. */
  readonly head: EventRecurrence | null;
  /** The series from `at`; `null` for "Delete all future events" (and when the repeat becomes Never). */
  readonly tail: EventRecurrence | null;
  /** Every override original on or after `at` (except the edited occurrence's own), mapped into the tail. */
  readonly overrides: readonly ExceptionMap[];
  /** Exceptions and extra dates on or after `at` that the tail does not keep (`span.future.exceptionsDropped`, §2.11). */
  readonly droppedCount: number;
  /** `droppedCount > 0`. */
  readonly dropped: boolean;
}

/**
 * One stored `RRULE` or `EXRULE` whose `UNTIL` a retime rewrites: its index in
 * stored order and its until end date (the date recognition holds, computed
 * with the OLD start minute). Platforms write `formatUntil(endDate, allDay,
 * zone)` into that rule's `UNTIL=` part only (§4.7).
 */
export interface UntilRewrite {
  readonly rule: 'rrule' | 'exrule';
  readonly index: number;
  readonly endDate: GregorianDate;
}

/** A row of the repeat picker (§2.13). */
export interface RepeatPreset {
  /**
   * `'never'`, `'daily'`, `'weekly'`, `'biweekly'`, `'monthly'`, `'yearly'`,
   * `'thirteen-monthly'`, `'thirteen-weekly'`, `'thirteen-biweekly'`,
   * `'thirteen-yearly'` or `'thirteen-intercalary'`.
   */
  readonly id: string;
  readonly section: 'never' | 'gregorian' | 'thirteen';
  readonly label: string;
  /** End never; `null` for Never. */
  readonly recurrence: EventRecurrence | null;
  readonly exchangeSafe: boolean;
}

/** What {@link recognizeRecurrence} reads, every value already in the event's zone (§4.5). */
export interface RecognitionInput {
  /** Minute 0 for all-day events. */
  readonly start: LocalDateTime;
  /** Each `RRULE` with its `UNTIL` in the event's zone (`untilInZone`), or `null` when it has none. */
  readonly rrules: readonly { readonly rrule: RRule; readonly until: LocalDateTime | null }[];
  readonly exrules: readonly { readonly rrule: RRule; readonly until: LocalDateTime | null }[];
  readonly rdates: readonly ExtraDate[];
  /** Minute null when it equals the start's minute or the value is a DATE. */
  readonly exdates: readonly OriginalDate[];
  /** The `X-THIRTEEN-RULE` value or the Android marker URI. */
  readonly marker: string | null;
}

/** The result of {@link recognizeRecurrence}. */
export interface Recognition {
  readonly recurrence: EventRecurrence;
  readonly source: 'marker' | 'byyearday' | 'leap-interval' | 'gregorian' | 'rdates' | 'dates' | 'foreign';
  /** `false`: show "Keep: ..." and preserve the stored text. */
  readonly editable: boolean;
  /** Other 13-month rules the same stored data means (§4.5 steps 2, 4 and 5). */
  readonly alternatives: readonly ThirteenRule[];
  /** Android: the marker URI says `end=never` (top-up allowed). */
  readonly openEnded: boolean;
  /** Android parts: the marker's series id and part number. */
  readonly series: string | null;
  readonly part: number | null;
}

// ---------------------------------------------------------------------------
// Validation and copies
// ---------------------------------------------------------------------------

/** Largest count: every port holds it in a 32-bit signed integer. */
const MAX_INT = 2_147_483_647;
/** Default `limit` of {@link expandRecurrence} (§4.6 step 5). */
const DEFAULT_LIMIT = 10_000;

const isNullOr = (value: unknown, test: (v: unknown) => boolean): boolean => value === null || test(value);
const isMinute = (value: unknown): boolean => isInteger(value) && value >= 0 && value < 1440;

function rruleProblem(value: unknown, context: string): string | null {
  try {
    assertValidRRule(value, context);
  } catch (error) {
    return (error as Error).message;
  }
  const rule = value as RRule;
  if (rule.count !== null || rule.until !== null) return `${context} must not have COUNT or UNTIL (the end lives in the recurrence)`;
  return null;
}

function repeatEndProblem(value: unknown): string | null {
  if (!isRecord(value)) return `end must be an object, got ${show(value)}`;
  switch (value.kind) {
    case 'never':
      return null;
    case 'count':
      return Number.isFinite(value.count) ? null : `end count must be a number, got ${show(value.count)}`;
    case 'until':
      return isValidGregorian(value.date) ? null : `end until must be a valid Gregorian date, got ${show(value.date)}`;
    default:
      return `end kind must be 'never', 'count' or 'until', got ${show(value.kind)}`;
  }
}

function endedRulesProblem(value: unknown, name: string): string | null {
  if (!Array.isArray(value)) return `${name} must be an array, got ${show(value)}`;
  for (const entry of value) {
    if (!isRecord(entry)) return `${name} entries must be objects, got ${show(entry)}`;
    const problem = rruleProblem(entry.rrule, `${name} rrule`) ?? repeatEndProblem(entry.end);
    if (problem !== null) return `${name}: ${problem}`;
  }
  return null;
}

function originalDateProblem(value: unknown, name: string): string | null {
  if (!isRecord(value) || !isValidGregorian(value.date) || !isNullOr(value.minute, isMinute)) {
    return `${name} entries must be { date, minute: 0..1439 | null }, got ${show(value)}`;
  }
  return null;
}

function extraDateProblem(value: unknown): string | null {
  const isDuration = (v: unknown) => isInteger(v) && v >= 0;
  if (!isRecord(value) || !isValidGregorian(value.date) || !isNullOr(value.minute, isMinute) || !isNullOr(value.durationMinutes, isDuration)) {
    return `extraDates entries must be { date, minute: 0..1439 | null, durationMinutes: >= 0 | null }, got ${show(value)}`;
  }
  return null;
}

function recurrenceProblem(value: unknown): string | null {
  if (!isRecord(value)) return `expected an object { rule, end, extraDates, exceptDates }, got ${show(value)}`;
  const rule = value.rule;
  if (!isRecord(rule)) return `rule must be an object, got ${show(rule)}`;
  switch (rule.kind) {
    case 'rrule': {
      const problem = rruleProblem(rule.rrule, 'rrule');
      if (problem !== null) return problem;
      break;
    }
    case 'thirteen':
      try {
        assertValidThirteenRule(rule.rule);
      } catch (error) {
        return (error as Error).message;
      }
      break;
    case 'dates':
      break;
    case 'foreign': {
      const problem = endedRulesProblem(rule.rules, 'rules') ?? endedRulesProblem(rule.exrules, 'exrules');
      if (problem !== null) return problem;
      break;
    }
    default:
      return `rule kind must be 'rrule', 'thirteen', 'dates' or 'foreign', got ${show(rule.kind)}`;
  }
  const endProblem = repeatEndProblem(value.end);
  if (endProblem !== null) return endProblem;
  const extra = value.extraDates;
  if (!Array.isArray(extra)) return `extraDates must be an array, got ${show(extra)}`;
  for (const entry of extra) {
    const problem = extraDateProblem(entry);
    if (problem !== null) return problem;
  }
  const except = value.exceptDates;
  if (!Array.isArray(except)) return `exceptDates must be an array, got ${show(except)}`;
  for (const entry of except) {
    const problem = originalDateProblem(entry, 'exceptDates');
    if (problem !== null) return problem;
  }
  return null;
}

/**
 * Validates the shape of an {@link EventRecurrence} (rule kinds, a 13-month
 * rule's fields, `RRule`s without `COUNT` or `UNTIL`, the end, extra and
 * removed dates). A `count` end may be any number here: whether it is in
 * `1…999` is a draft issue (`count-out-of-range`), not a malformed value.
 * Expansion needs more ({@link assertExpandable}).
 * @throws RangeError with a descriptive message.
 * @internal
 */
export function assertValidRecurrence(value: unknown): asserts value is EventRecurrence {
  const problem = recurrenceProblem(value);
  if (problem !== null) fail(`Invalid recurrence: ${problem}`);
}

function assertCountEnd(end: RepeatEnd, context: string): void {
  if (end.kind === 'count' && !(isInteger(end.count) && end.count >= 1 && end.count <= MAX_INT)) {
    fail(`Invalid recurrence: ${context} count must be an integer 1..${MAX_INT}, got ${show(end.count)}`);
  }
}

/**
 * Validates a recurrence for expansion: its shape ({@link assertValidRecurrence}),
 * every `count` an integer `1…2147483647`, and the end of a `dates` or
 * `foreign` rule `never`.
 * @throws RangeError with a descriptive message.
 * @internal
 */
export function assertExpandable(value: unknown): asserts value is EventRecurrence {
  assertValidRecurrence(value);
  assertCountEnd(value.end, 'end');
  if ((value.rule.kind === 'dates' || value.rule.kind === 'foreign') && value.end.kind !== 'never') {
    fail(`Invalid recurrence: a '${value.rule.kind}' rule ends through its own rules, so its end must be 'never', got ${show(value.end.kind)}`);
  }
  if (value.rule.kind === 'foreign') {
    for (const entry of [...value.rule.rules, ...value.rule.exrules]) assertCountEnd(entry.end, 'foreign rule');
  }
}

function assertOriginalDates(value: unknown, name: string): asserts value is readonly OriginalDate[] {
  if (!Array.isArray(value)) fail(`${name} must be an array, got ${show(value)}`);
  for (const entry of value) {
    const problem = originalDateProblem(entry, name);
    if (problem !== null) fail(problem);
  }
}

/** A fresh deep copy of a valid recurrence. @internal */
export function copyRecurrence(recurrence: EventRecurrence): EventRecurrence {
  return clonePlain(recurrence);
}

const copyOriginal = (value: OriginalDate): OriginalDate => ({ date: copyDate(value.date), minute: value.minute });
const copyExtra = (value: ExtraDate): ExtraDate => ({ date: copyDate(value.date), minute: value.minute, durationMinutes: value.durationMinutes });
const copyEnd = (end: RepeatEnd): RepeatEnd =>
  end.kind === 'until' ? { kind: 'until', date: copyDate(end.date) } : end.kind === 'count' ? { kind: 'count', count: end.count } : { kind: 'never' };

/** The same occurrence: equal dates and equal minutes (null for the master's minute). */
const jdn = (date: GregorianDate): number => jdnOf(date.year, date.month, date.day);
/** A numeric key for a date and minute (null sorts first). */
const occurrenceKey = (day: number, minute: number | null): number => day * 1441 + (minute ?? -1) + 1;
const dateOf = (day: number): GregorianDate => fromJulianDayNumber(day);

// ---------------------------------------------------------------------------
// Rule streams
// ---------------------------------------------------------------------------

/** Ascending candidate dates (Julian Day Numbers); -1 at the end. */
interface Candidates {
  next(): number;
  readonly truncated: boolean;
}

const NO_CANDIDATES: Candidates = { next: () => -1, truncated: false };

/** A 13-month rule's dates on or after the start, year by year (§4.2). */
class ThirteenCandidates implements Candidates {
  readonly truncated = false;
  private readonly common: readonly number[];
  private readonly leap: readonly number[];
  private readonly startJdn: number;
  private readonly stop: number;
  private year: number;
  private days: readonly number[] = [];
  private base = 0;
  private index = 0;

  constructor(rule: ThirteenRule, start: GregorianDate, stop: number, jumpTo: number | null) {
    const days = thirteenRuleYearDays(rule, start);
    this.common = days.common;
    this.leap = days.leap;
    this.startJdn = jdn(start);
    this.stop = Math.min(stop, MAX_JULIAN_DAY_NUMBER);
    this.year = jumpTo === null ? start.year : Math.max(start.year, yearOf(Math.max(jumpTo, MIN_JULIAN_DAY_NUMBER)));
    this.load();
  }

  private load(): void {
    if (this.year > MAX_YEAR || jdnOf(this.year, 1, 1) > this.stop) {
      this.year = MAX_YEAR + 1;
      return;
    }
    this.base = jdnOf(this.year, 1, 1) - 1;
    this.days = isLeap(this.year) ? this.leap : this.common;
    this.index = 0;
  }

  next(): number {
    while (this.year <= MAX_YEAR) {
      if (this.index < this.days.length) {
        const day = this.base + this.days[this.index++]!;
        if (day < this.startJdn) continue;
        if (day > this.stop) {
          this.year = MAX_YEAR + 1;
          return -1;
        }
        return day;
      }
      this.year++;
      this.load();
    }
    return -1;
  }
}

/** An `RRULE` engine as {@link Candidates}. */
class RRuleSource implements Candidates {
  private readonly engine: RRuleCandidates;
  constructor(rrule: RRule, start: GregorianDate, stop: number, jumpTo: number | null) {
    this.engine = new RRuleCandidates(rrule, start, stop, jumpTo);
  }
  next(): number {
    return this.engine.next();
  }
  get truncated(): boolean {
    return this.engine.truncated;
  }
}

/**
 * A rule stream with its end (§4.6 steps 1 and 2): the start first (when
 * `forceStart`, as for every `RRULE`), then the candidates after it, stopping
 * after `count` dates or after `last` (the until date), and at `stop`.
 */
class EndedStream {
  private readonly candidates: Candidates;
  private readonly startJdn: number;
  private readonly forceStart: boolean;
  private readonly count: number;
  private readonly last: number;
  private readonly stop: number;
  private readonly impossible: boolean;
  private emitted = 0;
  private started: boolean;

  constructor(candidates: Candidates, startJdn: number, forceStart: boolean, count: number, last: number, stop: number, impossible: boolean) {
    this.candidates = candidates;
    this.startJdn = startJdn;
    this.forceStart = forceStart;
    this.count = count;
    this.last = last;
    this.stop = stop;
    this.impossible = impossible;
    this.started = !forceStart;
  }

  get truncated(): boolean {
    return this.impossible || this.candidates.truncated;
  }

  next(): number {
    if (this.emitted >= this.count) return -1;
    if (!this.started) {
      this.started = true;
      if (this.startJdn > this.stop) {
        this.emitted = this.count;
        return -1;
      }
      this.emitted++;
      return this.startJdn;
    }
    for (;;) {
      const day = this.candidates.next();
      if (day < 0 || day > this.last || day > this.stop) {
        this.emitted = this.count;
        return -1;
      }
      if (this.forceStart && day <= this.startJdn) continue;
      this.emitted++;
      return day;
    }
  }
}

/** The union of several ascending streams, without duplicates. */
class UnionStream {
  private readonly streams: readonly EndedStream[];
  private readonly heads: number[];
  constructor(streams: readonly EndedStream[]) {
    this.streams = streams;
    this.heads = streams.map((s) => s.next());
  }
  get truncated(): boolean {
    return this.streams.some((s) => s.truncated);
  }
  next(): number {
    let best = -1;
    for (const head of this.heads) if (head >= 0 && (best < 0 || head < best)) best = head;
    if (best < 0) return -1;
    this.heads.forEach((head, i) => {
      if (head === best) this.heads[i] = this.streams[i]!.next();
    });
    return best;
  }
}

interface DateStream {
  next(): number;
  readonly truncated: boolean;
}

/** The end of a rule as a count and a last date. */
function endBounds(end: RepeatEnd): { count: number; last: number } {
  return {
    count: end.kind === 'count' ? end.count : Number.POSITIVE_INFINITY,
    last: end.kind === 'until' ? jdn(end.date) : MAX_JULIAN_DAY_NUMBER,
  };
}

/**
 * One `RRULE` (or `EXRULE` when `forceStart` is false) with its end, as a
 * stream up to `stop`. Callers check support first.
 */
function rruleStream(rrule: RRule, end: RepeatEnd, start: GregorianDate, stop: number, jumpTo: number | null, forceStart: boolean): EndedStream {
  const { count, last } = endBounds(end);
  const startJdn = jdn(start);
  const bound = Math.min(last, stop);
  if (rruleSupport(rrule, null) === 'impossible') {
    return new EndedStream(NO_CANDIDATES, startJdn, forceStart, count, last, stop, true);
  }
  const jump = end.kind === 'count' ? null : jumpTo;
  return new EndedStream(new RRuleSource(rrule, start, bound, jump), startJdn, forceStart, count, last, stop, false);
}

/** The rule stream of a recurrence (§4.6 steps 1 and 2) up to `stop`; `jumpTo` lets uncounted streams skip earlier dates. */
function ruleStream(recurrence: EventRecurrence, start: GregorianDate, stop: number, jumpTo: number | null): DateStream {
  const rule = recurrence.rule;
  const startJdn = jdn(start);
  switch (rule.kind) {
    case 'thirteen': {
      const bounds = endBounds(recurrence.end);
      const count = bounds.count;
      // A leap-only repeat stops at its cap whatever its end, as its stored rule does (§4.3 c).
      const cap = thirteenRuleCap(rule.rule, start);
      const last = cap === null ? bounds.last : Math.min(bounds.last, jdn(cap));
      const jump = recurrence.end.kind === 'count' ? null : jumpTo;
      return new EndedStream(new ThirteenCandidates(rule.rule, start, Math.min(last, stop), jump), startJdn, true, count, last, stop, false);
    }
    case 'rrule':
      return rruleStream(rule.rrule, recurrence.end, start, stop, jumpTo, true);
    case 'dates':
      return new EndedStream(NO_CANDIDATES, startJdn, true, 1, MAX_JULIAN_DAY_NUMBER, stop, false);
    case 'foreign': {
      const streams = rule.rules.map((r) => rruleStream(r.rrule, r.end, start, stop, jumpTo, true));
      // The start is always the first occurrence, also of a foreign rule without RRULEs.
      streams.push(new EndedStream(NO_CANDIDATES, startJdn, true, 1, MAX_JULIAN_DAY_NUMBER, stop, false));
      return new UnionStream(streams);
    }
  }
}

/** The rules of a recurrence (not its exrules). */
function rulesOf(recurrence: EventRecurrence): readonly RRule[] {
  const rule = recurrence.rule;
  if (rule.kind === 'rrule') return [rule.rrule];
  return rule.kind === 'foreign' ? rule.rules.map((r) => r.rrule) : [];
}

/** `true` when the engine cannot expand some `RRULE` or `EXRULE` of the recurrence (§4.6 step 6). */
function isUnsupported(recurrence: EventRecurrence, startMinute: number | null): boolean {
  const all = [...rulesOf(recurrence), ...(recurrence.rule.kind === 'foreign' ? recurrence.rule.exrules.map((r) => r.rrule) : [])];
  return all.some((rrule) => rruleSupport(rrule, startMinute) === 'unsupported');
}

// ---------------------------------------------------------------------------
// Expansion (§4.6)
// ---------------------------------------------------------------------------

/** An occurrence's original date as a Julian Day Number, with its own minute and length (null: the master's). @internal */
export interface DayOccurrence {
  readonly day: number;
  readonly minute: number | null;
  readonly durationMinutes: number | null;
}
type Occurrence = DayOccurrence;

/** Extra dates sorted by date and minute (the master's time first), without repeated date and minute pairs (the first wins). */
function sortedExtras(extras: readonly ExtraDate[]): Occurrence[] {
  const seen = new Set<number>();
  const out: Occurrence[] = [];
  for (const extra of extras) {
    const day = jdn(extra.date);
    const key = occurrenceKey(day, extra.minute);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ day, minute: extra.minute, durationMinutes: extra.durationMinutes });
  }
  return out.sort((a, b) => occurrenceKey(a.day, a.minute) - occurrenceKey(b.day, b.minute));
}

/** The occurrences of a recurrence from `from` through `to` (Julian Day Numbers), ascending, lazily. */
class Expander {
  private readonly rule: DateStream;
  private readonly exrules: EndedStream[];
  private readonly exruleHeads: number[];
  private readonly extras: Occurrence[];
  private readonly except: ReadonlySet<number>;
  private extraIndex = 0;
  private ruleHead: number;

  constructor(recurrence: EventRecurrence, start: GregorianDate, from: number, to: number) {
    this.rule = ruleStream(recurrence, start, to, from);
    this.exrules =
      recurrence.rule.kind === 'foreign' ? recurrence.rule.exrules.map((r) => rruleStream(r.rrule, r.end, start, to, from, false)) : [];
    this.exruleHeads = this.exrules.map((s) => s.next());
    this.extras = sortedExtras(recurrence.extraDates).filter((x) => x.day >= from && x.day <= to);
    this.except = new Set(recurrence.exceptDates.map((x) => occurrenceKey(jdn(x.date), x.minute)));
    let head = this.rule.next();
    while (head >= 0 && head < from) head = this.rule.next();
    this.ruleHead = head;
  }

  get truncated(): boolean {
    return this.rule.truncated;
  }

  /** `true` when an `EXRULE` produces `day` (queries come in ascending order). */
  private exruled(day: number): boolean {
    let hit = false;
    this.exrules.forEach((stream, i) => {
      let head = this.exruleHeads[i]!;
      while (head >= 0 && head < day) head = stream.next();
      this.exruleHeads[i] = head;
      if (head === day) hit = true;
    });
    return hit;
  }

  private excluded(day: number, minute: number | null): boolean {
    return this.except.has(occurrenceKey(day, minute)) || (minute === null && this.exrules.length > 0 && this.exruled(day));
  }

  /** The next occurrence, or `null` at the end. */
  next(): Occurrence | null {
    for (;;) {
      const extra = this.extras[this.extraIndex];
      const ruleKey = this.ruleHead >= 0 ? occurrenceKey(this.ruleHead, null) : Number.POSITIVE_INFINITY;
      const extraKey = extra === undefined ? Number.POSITIVE_INFINITY : occurrenceKey(extra.day, extra.minute);
      if (ruleKey === Number.POSITIVE_INFINITY && extraKey === Number.POSITIVE_INFINITY) return null;
      let next: Occurrence;
      if (ruleKey <= extraKey) {
        next = { day: this.ruleHead, minute: null, durationMinutes: null };
        this.ruleHead = this.rule.next();
        if (extraKey === ruleKey) this.extraIndex++; // the same occurrence: produced once
      } else {
        next = extra!;
        this.extraIndex++;
      }
      if (!this.excluded(next.day, next.minute)) return next;
    }
  }
}

const expandedDate = (occurrence: Occurrence): ExpandedDate => ({
  date: dateOf(occurrence.day),
  minute: occurrence.minute,
  durationMinutes: occurrence.durationMinutes,
});

function readLimit(options: unknown, context: string): number {
  const opts = readOptions(options, ['limit'], context);
  const limit = opts.limit;
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!isInteger(limit) || limit < 1 || limit > MAX_INT) fail(`${context} option 'limit' must be an integer 1..${MAX_INT}, got ${show(limit)}`);
  return limit;
}

function assertWindow(range: unknown): asserts range is ExpansionWindow {
  if (!isRecord(range)) fail(`Expansion window must be { from, to }, got ${show(range)}`);
  assertValidGregorian(range.from);
  assertValidGregorian(range.to);
  if (jdn(range.from) > jdn(range.to)) fail(`Expansion window ends before it starts: ${show(range)}`);
}

/**
 * {@link expandRecurrence} for valid input, on Julian Day Numbers (`from` and
 * `to` inclusive). `startMinute`, when known, lets the support check compare
 * single `BYHOUR` and `BYMINUTE` values with the start's time (`expandSeries`
 * passes it).
 * @internal
 */
export function expandDays(
  recurrence: EventRecurrence,
  start: GregorianDate,
  from: number,
  to: number,
  limit: number,
  startMinute: number | null,
): { occurrences: DayOccurrence[]; truncated: boolean; unsupported: boolean } {
  const startJdn = jdn(start);
  if (isUnsupported(recurrence, startMinute)) {
    const inWindow = startJdn >= from && startJdn <= to;
    return { occurrences: inWindow ? [{ day: startJdn, minute: null, durationMinutes: null }] : [], truncated: false, unsupported: true };
  }
  const expander = new Expander(recurrence, start, from, to);
  const occurrences: DayOccurrence[] = [];
  let truncated = false;
  for (let next = expander.next(); next !== null; next = expander.next()) {
    if (occurrences.length === limit) {
      truncated = true;
      break;
    }
    occurrences.push(next);
  }
  return { occurrences, truncated: truncated || expander.truncated, unsupported: false };
}

function expandValid(recurrence: EventRecurrence, start: GregorianDate, from: number, to: number, limit: number): Expansion {
  const result = expandDays(recurrence, start, from, to, limit, null);
  return { ...result, occurrences: result.occurrences.map(expandedDate) };
}

/**
 * The original dates of a recurrence's occurrences inside the window `range` (both
 * ends inclusive), in the event's zone (§4.6): ascending by date, then by minute
 * with the master's time first, without duplicates. An occurrence from an
 * extra date with its own time or length carries them; every other has
 * `minute` and `durationMinutes` null.
 *
 * - The rule stream: `start` is always the first occurrence, then the rule's
 *   dates after it: a 13-month rule's dates (§4.2), an `RRULE`'s RFC 5545
 *   dates, nothing more for `dates`, and the union of every `RRULE` of a
 *   `foreign` rule, each with its own end.
 * - Ends apply to the rule stream only: `count` counts the start and dates
 *   that are later excluded; `until` keeps the dates on or before its date. A
 *   leap-only 13-month repeat (IFC Leap Day, Positivist Holy Women) also stops
 *   at its leap-interval cap whatever its end (§4.3 c), as its stored rule
 *   `FREQ=YEARLY;INTERVAL=4;UNTIL={cap}` does: "Every Leap Day" from 2024 ends
 *   on June 17, 2096, and a longer count gives only the dates up to the cap.
 * - Extra dates are added whatever their date (also before the start or after
 *   the end); one already produced at the same date and minute is not
 *   repeated.
 * - Exclusions remove the `exceptDates` occurrence with the same date and
 *   minute, and every date at the master's minute that an `EXRULE` produces.
 * - Guards: at most `limit` (default 10,000) occurrences are returned, with
 *   `truncated`; a rule that never matches again stops after 400 × `INTERVAL`
 *   years with `truncated`, and one whose months and month days never meet
 *   (`BYMONTH=2;BYMONTHDAY=30`) gives only the start with `truncated`.
 * - Unsupported rules (`HOURLY`, `MINUTELY`, `SECONDLY`, an `RSCALE` other than
 *   `GREGORIAN`, any `SKIP`, more than one `BYHOUR`, `BYMINUTE`
 *   or `BYSECOND` value, or a `BY` part RFC 5545 does not allow with the
 *   frequency) give only the start, if it is in the window, with
 *   `unsupported`.
 * @throws RangeError for an invalid recurrence, start, window or limit.
 */
export function expandRecurrence(
  recurrence: EventRecurrence,
  start: GregorianDate,
  range: ExpansionWindow,
  options?: { limit?: number },
): Expansion {
  assertExpandable(recurrence);
  assertValidGregorian(start);
  assertWindow(range);
  const limit = readLimit(options, 'expandRecurrence');
  return expandValid(recurrence, start, jdn(range.from), jdn(range.to), limit);
}

/**
 * The dates of the next `count` occurrences after `start` (strictly later
 * dates), ascending and without repeated dates; fewer when the repeat ends
 * sooner. Exclusions apply; extra dates count. An unsupported rule has none.
 * @throws RangeError for an invalid recurrence or start, or a `count` that is
 * not an integer `0…1000`.
 */
export function nextOccurrences(recurrence: EventRecurrence, start: GregorianDate, count: number): GregorianDate[] {
  assertExpandable(recurrence);
  assertValidGregorian(start);
  if (!isInteger(count) || count < 0 || count > 1000) fail(`count must be an integer 0..1000, got ${show(count)}`);
  return nextValid(recurrence, start, count);
}

function nextValid(recurrence: EventRecurrence, start: GregorianDate, count: number): GregorianDate[] {
  const from = jdn(start) + 1;
  if (count === 0 || from > MAX_JULIAN_DAY_NUMBER || isUnsupported(recurrence, null)) return [];
  const expander = new Expander(recurrence, start, from, MAX_JULIAN_DAY_NUMBER);
  const days: number[] = [];
  for (let next = expander.next(); next !== null && days.length < count; next = expander.next()) {
    if (days[days.length - 1] !== next.day) days.push(next.day);
  }
  return days.map(dateOf);
}

// ---------------------------------------------------------------------------
// Ends (§4.7)
// ---------------------------------------------------------------------------

/** The number of dates of a rule stream (start included, exclusions not applied) before `at`. */
function streamCountBefore(make: (stop: number) => { next(): number }, at: number): number {
  const stream = make(at - 1);
  let n = 0;
  while (stream.next() >= 0) n++;
  return n;
}

/** The head end of one rule stream ended before `at` (§4.7): a count of the dates before it, or the day before it. */
function headEnd(end: RepeatEnd, countBefore: () => number, at: number): RepeatEnd {
  if (end.kind === 'count') {
    const before = countBefore();
    return before >= end.count ? copyEnd(end) : { kind: 'count', count: before };
  }
  const dayBefore = at - 1;
  if (end.kind === 'until' && jdn(end.date) <= dayBefore) return copyEnd(end);
  return { kind: 'until', date: dateOf(dayBefore) };
}

/** {@link endRecurrenceBefore} for valid input. */
function headOf(recurrence: EventRecurrence, start: GregorianDate, at: number): EventRecurrence | null {
  if (at <= jdn(start)) return null;
  const rule = recurrence.rule;
  const keepBefore = <T extends { readonly date: GregorianDate }>(list: readonly T[]) => list.filter((x) => jdn(x.date) < at);
  let headRule: RepeatRule;
  let end: RepeatEnd = { kind: 'never' };
  switch (rule.kind) {
    case 'thirteen':
    case 'rrule':
      headRule = clonePlain(rule);
      end = headEnd(recurrence.end, () => streamCountBefore((stop) => ruleStream(recurrence, start, stop, null), at), at);
      break;
    case 'dates':
      headRule = { kind: 'dates' };
      break;
    case 'foreign': {
      const ended = (r: EndedRule, forceStart: boolean): EndedRule => ({
        rrule: copyRRule(r.rrule),
        end: headEnd(r.end, () => streamCountBefore((stop) => rruleStream(r.rrule, r.end, start, stop, null, forceStart), at), at),
      });
      headRule = { kind: 'foreign', rules: rule.rules.map((r) => ended(r, true)), exrules: rule.exrules.map((r) => ended(r, false)) };
      break;
    }
  }
  return {
    rule: headRule,
    end,
    extraDates: keepBefore(recurrence.extraDates).map(copyExtra),
    exceptDates: keepBefore(recurrence.exceptDates).map(copyOriginal),
  };
}

/**
 * The series ended before `date` (§4.7, "Delete all future events" and the
 * head of a split): a rule with a `count` keeps the number of its dates before
 * `date` (counting excluded dates, as RFC 5545 counts them); otherwise it ends
 * on the day before `date`, unless its own end comes earlier. A `foreign`
 * rule does this for each of its `RRULE`s and `EXRULE`s on that rule's own
 * stream. Extra dates and excluded dates before `date` stay; later ones leave.
 * @returns the head, or `null` when `date` is on or before the start (nothing
 * of the series remains).
 * @throws RangeError for an invalid recurrence or date.
 */
export function endRecurrenceBefore(recurrence: EventRecurrence, start: GregorianDate, date: GregorianDate): EventRecurrence | null {
  assertExpandable(recurrence);
  assertValidGregorian(start);
  assertValidGregorian(date);
  return headOf(recurrence, start, jdn(date));
}

/** `true` when some rule stream of the recurrence never ends (a leap-only repeat always ends at its cap). */
function endless(recurrence: EventRecurrence, start: GregorianDate): boolean {
  const rule = recurrence.rule;
  if (rule.kind === 'dates') return false;
  if (rule.kind === 'foreign') return rule.rules.some((r) => r.end.kind === 'never');
  if (rule.kind === 'thirteen' && thirteenRuleCap(rule.rule, start) !== null) return false;
  return recurrence.end.kind === 'never';
}

/** {@link laterOccurrenceCount} for valid input. */
function laterValid(recurrence: EventRecurrence, start: GregorianDate, at: number): number | null {
  if (endless(recurrence, start)) return null;
  const from = at + 1;
  if (from > MAX_JULIAN_DAY_NUMBER || isUnsupported(recurrence, null)) return 0;
  const expander = new Expander(recurrence, start, from, MAX_JULIAN_DAY_NUMBER);
  let n = 0;
  while (expander.next() !== null) n++;
  return n;
}

/**
 * The number of occurrences after `at` (on later dates; excluded dates not
 * counted, extra dates counted) that ending the repeat at `at` would delete
 * (`span.move.dropsRepeat`, `editor.notice.laterDeleted`, §2.11); 0 at the
 * last occurrence.
 * @returns the count, or `null` when the series never ends (a rule without an
 * end; a `foreign` rule with such an `RRULE`). A leap-only 13-month repeat
 * always ends, at its leap-interval cap (§4.3 c), so it has a count.
 * @throws RangeError for an invalid recurrence or date.
 */
export function laterOccurrenceCount(recurrence: EventRecurrence, start: GregorianDate, at: GregorianDate): number | null {
  assertExpandable(recurrence);
  assertValidGregorian(start);
  assertValidGregorian(at);
  return laterValid(recurrence, start, jdn(at));
}

/** The dates (Julian Day Numbers) the rule stream of a recurrence produces from `from` through `to`. */
function ruleDatesIn(recurrence: EventRecurrence, start: GregorianDate, from: number, to: number): Set<number> {
  const out = new Set<number>();
  if (from > to) return out;
  const stream = ruleStream(recurrence, start, to, from);
  for (let day = stream.next(); day >= 0; day = stream.next()) if (day >= from) out.add(day);
  return out;
}

// ---------------------------------------------------------------------------
// Splitting (§4.7)
// ---------------------------------------------------------------------------

/** `true` when the recurrence is one a kept repeat cannot carry to a new start (§4.7). */
const cannotKeep = (recurrence: EventRecurrence): boolean =>
  recurrence.rule.kind === 'foreign' || recurrence.rule.kind === 'dates' || recurrence.extraDates.length > 0;

/**
 * Splits a series at the occurrence on `at` for a "future events" change or
 * "Delete all future events" (§4.7).
 *
 * - `head`: {@link endRecurrenceBefore}.
 * - `tail` (`null` without `change`, or when `change.recurrence` is null, the
 *   repeat having become Never): starts at `change.start`. When the user kept
 *   the repeat (`ruleChanged` false) it takes `change.recurrence`'s rule with
 *   the original end carried on: a `count` end keeps the original count minus
 *   the head's (a 10-time series split at its 4th occurrence keeps 7), an
 *   `until` end keeps its date. When the user chose a new repeat or a new end
 *   (`ruleChanged` true), `change.recurrence` as it is.
 * - Exceptions on or after `at` (excluded dates, and the overrides in
 *   `overrideDates` except the edited occurrence's own, `at` at the master's
 *   time) move to the tail when its rule produces their date shifted by the
 *   days the start moved (`change.start` minus `at`; 0 when only the time
 *   changed); otherwise they are dropped. Exceptions at an extra date's own
 *   time are dropped with their extra dates.
 * - Extra dates before `at` stay in the head; later ones are dropped.
 *
 * `droppedCount` counts the excluded dates, overrides and extra dates on or
 * after `at` that the tail does not keep, so the span dialog can say so before
 * the user chooses.
 * @throws RangeError for invalid input, a kept repeat of a `foreign` or
 * `dates` rule or of a rule with extra dates (their rules are anchored on
 * their own start), or a kept `count` that `at` has already used up.
 */
export function splitRecurrence(
  recurrence: EventRecurrence,
  start: GregorianDate,
  at: GregorianDate,
  overrideDates: readonly OriginalDate[],
  change?: { readonly recurrence: EventRecurrence | null; readonly start: GregorianDate; readonly ruleChanged: boolean } | null,
): SplitResult {
  assertExpandable(recurrence);
  assertValidGregorian(start);
  assertValidGregorian(at);
  assertOriginalDates(overrideDates, 'overrideDates');
  if (change !== undefined && change !== null) {
    if (!isRecord(change) || typeof change.ruleChanged !== 'boolean') fail(`change must be { recurrence, start, ruleChanged }, got ${show(change)}`);
    assertValidGregorian(change.start);
    if (change.recurrence !== null) assertExpandable(change.recurrence);
  }
  const atJdn = jdn(at);
  const head = headOf(recurrence, start, atJdn);
  const later = <T extends { readonly date: GregorianDate }>(list: readonly T[]) => list.filter((x) => jdn(x.date) >= atJdn);
  const laterExcept = later(recurrence.exceptDates);
  const laterOverrides = later(overrideDates).filter((o) => !(jdn(o.date) === atJdn && o.minute === null));
  const laterExtras = later(recurrence.extraDates);

  let tail: EventRecurrence | null = null;
  if (change !== undefined && change !== null && change.recurrence !== null) {
    const chosen = change.recurrence;
    if (!change.ruleChanged) {
      if (cannotKeep(recurrence)) {
        fail(`A ${recurrence.extraDates.length > 0 ? 'rule with extra dates' : `'${recurrence.rule.kind}' rule`} cannot be kept by a split: it is anchored on its own start`);
      }
      let end = copyEnd(recurrence.end);
      if (recurrence.end.kind === 'count') {
        const before = streamCountBefore((stop) => ruleStream(recurrence, start, stop, null), atJdn);
        const left = recurrence.end.count - before;
        if (left < 1) fail(`Cannot split at ${show(at)}: the series' ${recurrence.end.count} occurrences end before it`);
        end = { kind: 'count', count: left };
      }
      tail = { rule: clonePlain(chosen.rule), end, extraDates: [], exceptDates: [] };
    } else {
      tail = { ...copyRecurrence(chosen), exceptDates: [] };
    }
  }

  let droppedCount = laterExtras.length;
  const overrides: ExceptionMap[] = [];
  const carried: OriginalDate[] = [];
  if (tail === null) {
    droppedCount += laterExcept.length + laterOverrides.length;
    for (const o of laterOverrides) overrides.push({ from: copyOriginal(o), to: null });
  } else {
    const tailStart = change!.start;
    const shift = jdn(tailStart) - atJdn;
    const targets = [...laterExcept, ...laterOverrides]
      .filter((o) => o.minute === null)
      .map((o) => jdn(o.date) + shift)
      .filter((d) => d >= MIN_JULIAN_DAY_NUMBER && d <= MAX_JULIAN_DAY_NUMBER);
    const produced =
      targets.length === 0 ? new Set<number>() : ruleDatesIn(tail, tailStart, Math.min(...targets), Math.max(...targets));
    const map = (o: OriginalDate): OriginalDate | null => {
      if (o.minute !== null) return null;
      const target = jdn(o.date) + shift;
      return produced.has(target) ? { date: dateOf(target), minute: null } : null;
    };
    const seen = new Set<number>();
    for (const e of laterExcept) {
      const to = map(e);
      if (to === null) droppedCount++;
      else if (!seen.has(jdn(to.date))) {
        seen.add(jdn(to.date));
        carried.push(to);
      }
    }
    const taken = new Set<number>();
    for (const o of laterOverrides) {
      let to = map(o);
      if (to !== null && taken.has(jdn(to.date))) to = null;
      if (to === null) droppedCount++;
      else taken.add(jdn(to.date));
      overrides.push({ from: copyOriginal(o), to });
    }
    tail = { ...tail, exceptDates: carried };
  }
  return { head, tail, overrides, droppedCount, dropped: droppedCount > 0 };
}

// ---------------------------------------------------------------------------
// Retiming (§4.7)
// ---------------------------------------------------------------------------

/** Shifts a date and minute by `delta` minutes; null outside years 1 to 9999. */
function shiftMinutes(day: number, minute: number, delta: number): { day: number; minute: number } | null {
  const absolute = day * 1440 + minute + delta;
  const shifted = Math.floor(absolute / 1440);
  if (shifted < MIN_JULIAN_DAY_NUMBER || shifted > MAX_JULIAN_DAY_NUMBER) return null;
  return { day: shifted, minute: absolute - shifted * 1440 };
}

/**
 * The `UNTIL` rewrites of a recurrence (§4.7): one per stored rule with an
 * until end, in stored order (`RRULE`s, then `EXRULE`s), with the date its
 * `UNTIL` ends on; for a 13-month rule, the `UNTIL` of its `RRULE` encoding,
 * the leap-interval cap included.
 */
function untilsOf(recurrence: EventRecurrence, start: GregorianDate): UntilRewrite[] {
  const rule = recurrence.rule;
  switch (rule.kind) {
    case 'dates':
      return [];
    case 'foreign': {
      const out: UntilRewrite[] = [];
      rule.rules.forEach((r, index) => {
        if (r.end.kind === 'until') out.push({ rule: 'rrule', index, endDate: copyDate(r.end.date) });
      });
      rule.exrules.forEach((r, index) => {
        if (r.end.kind === 'until') out.push({ rule: 'exrule', index, endDate: copyDate(r.end.date) });
      });
      return out;
    }
    case 'rrule':
      return recurrence.end.kind === 'until' ? [{ rule: 'rrule', index: 0, endDate: copyDate(recurrence.end.date) }] : [];
    case 'thirteen': {
      if (!thirteenRuleIncludes(rule.rule, start, start)) {
        return recurrence.end.kind === 'until' ? [{ rule: 'rrule', index: 0, endDate: copyDate(recurrence.end.date) }] : [];
      }
      const until = toRRuleValid(recurrence, start)!.until;
      return until !== null && until.kind === 'date' ? [{ rule: 'rrule', index: 0, endDate: copyDate(until.date) }] : [];
    }
  }
}

/**
 * Rewrites a series' exceptions when its first occurrence (the whole series)
 * gets a new start time, zone, all-day setting or date (§4.7, §4.9 rule 4).
 * The result keeps `newRecurrence`'s rule and end and replaces its extra and
 * excluded dates with those of `recurrence`, rewritten:
 *
 * - Values at the series' time (minute null) keep their original date; they
 *   are written at the new time by the platform. When the start date moves
 *   (`newStart` is not `oldStart`), an excluded date or override of a rule
 *   occurrence shifts by the same number of days where the new rule produces
 *   the shifted date, and is dropped otherwise.
 * - Values with their own time (an extra date's `minute`, and the excluded
 *   dates and override originals at that minute) shift by `minuteDelta` (the
 *   new start minute minus the old), crossing midnight when they must, so they
 *   keep matching their extra date. Extra dates keep their own dates.
 * - `allDay: 'to-all-day'`: every value becomes its date (minute and length
 *   null); an extra date that then falls on a date the new rule produces, or
 *   on another extra date, is dropped with its exceptions. `'to-timed'`: every
 *   value is written at the new start time (minutes stay null).
 * - An exception that matches no occurrence of the old series (an orphan) is
 *   dropped: Thirteen never stores one its rule does not produce.
 *
 * `overrides` maps every entry of `overrideDates`, in order (a second override
 * for the same new occurrence is dropped). `untils` lists the stored rules
 * whose `UNTIL` the platform rewrites with `formatUntil` (§4.7). `droppedCount`
 * counts dropped extra dates, excluded dates and overrides
 * (`editor.notice.exceptionsRemoved`, §2.11).
 * @throws RangeError for invalid input or options.
 */
export function retimeExceptions(
  recurrence: EventRecurrence,
  overrideDates: readonly OriginalDate[],
  oldStart: GregorianDate,
  newStart: GregorianDate,
  newRecurrence: EventRecurrence,
  options?: { readonly minuteDelta?: number; readonly allDay?: 'to-all-day' | 'to-timed' | null },
): { recurrence: EventRecurrence; overrides: readonly ExceptionMap[]; untils: readonly UntilRewrite[]; droppedCount: number; dropped: boolean } {
  assertExpandable(recurrence);
  assertOriginalDates(overrideDates, 'overrideDates');
  assertValidGregorian(oldStart);
  assertValidGregorian(newStart);
  assertExpandable(newRecurrence);
  const opts = readOptions(options, ['minuteDelta', 'allDay'], 'retimeExceptions');
  const minuteDelta = opts.minuteDelta ?? 0;
  if (!isInteger(minuteDelta)) fail(`retimeExceptions option 'minuteDelta' must be an integer, got ${show(minuteDelta)}`);
  const toggle = opts.allDay ?? null;
  if (toggle !== null && toggle !== 'to-all-day' && toggle !== 'to-timed') {
    fail(`retimeExceptions option 'allDay' must be 'to-all-day', 'to-timed' or null, got ${show(toggle)}`);
  }
  const dayDelta = jdn(newStart) - jdn(oldStart);

  // The dates both rule streams produce around every value involved.
  const values = [...recurrence.extraDates, ...recurrence.exceptDates, ...overrideDates].map((x) => jdn(x.date));
  const low = Math.min(...values, jdn(oldStart));
  const high = Math.max(...values, jdn(oldStart));
  const oldRule = ruleDatesIn(recurrence, oldStart, low, high);
  const newRule = ruleDatesIn(
    newRecurrence,
    newStart,
    Math.max(Math.min(low, low + dayDelta), MIN_JULIAN_DAY_NUMBER),
    Math.min(Math.max(high, high + dayDelta), MAX_JULIAN_DAY_NUMBER),
  );

  let droppedCount = 0;
  const extras: ExtraDate[] = [];
  /** Old extra date key → its new key, or null when it was dropped. */
  const extraMap = new Map<number, OriginalDate | null>();
  const kept = new Set<number>();
  for (const extra of recurrence.extraDates) {
    const day = jdn(extra.date);
    const oldKey = occurrenceKey(day, extra.minute);
    if (extraMap.has(oldKey)) continue; // a repeated value: expansion never produced it twice
    let next: ExtraDate | null;
    if (toggle === 'to-all-day') {
      next = newRule.has(day) || kept.has(occurrenceKey(day, null)) ? null : { date: copyDate(extra.date), minute: null, durationMinutes: null };
    } else if (toggle === null && extra.minute !== null) {
      const shifted = shiftMinutes(day, extra.minute, minuteDelta);
      next = shifted === null ? null : { date: dateOf(shifted.day), minute: shifted.minute, durationMinutes: extra.durationMinutes };
    } else {
      next = copyExtra(extra);
    }
    if (next === null) {
      droppedCount++;
      extraMap.set(oldKey, null);
      continue;
    }
    kept.add(occurrenceKey(jdn(next.date), next.minute));
    extras.push(next);
    extraMap.set(oldKey, { date: copyDate(next.date), minute: next.minute });
  }

  const nullExtraDays = new Set(recurrence.extraDates.filter((x) => x.minute === null).map((x) => jdn(x.date)));
  const map = (value: OriginalDate): OriginalDate | null => {
    const day = jdn(value.date);
    if (value.minute !== null) return extraMap.get(occurrenceKey(day, value.minute)) ?? null;
    if (!oldRule.has(day)) return nullExtraDays.has(day) ? (extraMap.get(occurrenceKey(day, null)) ?? null) : null;
    const shifted = day + dayDelta;
    return newRule.has(shifted) ? { date: dateOf(shifted), minute: null } : null;
  };

  const exceptDates: OriginalDate[] = [];
  const excepted = new Set<number>();
  for (const value of recurrence.exceptDates) {
    const to = map(value);
    if (to === null) {
      droppedCount++;
      continue;
    }
    const key = occurrenceKey(jdn(to.date), to.minute);
    if (excepted.has(key)) continue;
    excepted.add(key);
    exceptDates.push(to);
  }
  const overrides: ExceptionMap[] = [];
  const taken = new Set<number>();
  for (const value of overrideDates) {
    let to = map(value);
    if (to !== null) {
      const key = occurrenceKey(jdn(to.date), to.minute);
      if (taken.has(key)) to = null;
      else taken.add(key);
    }
    if (to === null) droppedCount++;
    overrides.push({ from: copyOriginal(value), to });
  }
  return {
    recurrence: { rule: clonePlain(newRecurrence.rule), end: copyEnd(newRecurrence.end), extraDates: extras, exceptDates },
    overrides,
    untils: untilsOf(newRecurrence, newStart),
    droppedCount,
    dropped: droppedCount > 0,
  };
}

// ---------------------------------------------------------------------------
// The RRULE a repeat is written as (§4.3, §4.4)
// ---------------------------------------------------------------------------

function toRRuleValid(recurrence: EventRecurrence, start: GregorianDate): RRule | null {
  const rule = recurrence.rule;
  const end = recurrence.end;
  const withEnd = (base: RRule, cap: GregorianDate | null): RRule => {
    if (end.kind === 'count') {
      if (cap !== null) {
        // The leap interval's cap wins over a longer count (§4.3 c).
        const fit = Math.floor((cap.year - start.year) / 4) + 1;
        if (end.count > fit) return { ...base, count: null };
      }
      return { ...base, count: end.count, until: null };
    }
    if (end.kind === 'until') {
      const date = cap !== null && jdn(cap) < jdn(end.date) ? cap : end.date;
      return { ...base, count: null, until: { kind: 'date', date: copyDate(date) } };
    }
    return base;
  };
  switch (rule.kind) {
    case 'rrule':
      return withEnd({ ...copyRRule(rule.rrule), count: null, until: null }, null);
    case 'thirteen': {
      const encoding = encodeThirteenRule(rule.rule, start);
      return withEnd(encoding.rrule, encoding.cap);
    }
    default:
      return null;
  }
}

/**
 * The one `RRULE` a repeat is written as (§4.3, §4.4): a Gregorian rule with
 * its end, or a 13-month rule's encoding (forms (a) to (c)) with its end. A
 * `count` end becomes `COUNT`, an `until` end a DATE `UNTIL` (writers of timed
 * events turn it into the end of that day with `formatUntil`, §4.4). The
 * leap-interval cap wins over a later until or a longer count. `null` for
 * `dates` and `foreign` rules, which have no single rule.
 * @throws RangeError for an invalid recurrence or start, or a 13-month rule
 * that does not produce its start.
 */
export function recurrenceToRRule(recurrence: EventRecurrence, start: GregorianDate): RRule | null {
  assertExpandable(recurrence);
  assertValidGregorian(start);
  return toRRuleValid(recurrence, start);
}

// ---------------------------------------------------------------------------
// Text (§5.2 grammars)
// ---------------------------------------------------------------------------

const CUSTOM = 'Repeats on a custom schedule';
const ORDINAL_WORDS: Readonly<Record<string, string>> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-1': 'last' };
const WEEKDAYS_MASK = 0b0111110;
const WEEKEND_MASK = 0b1000001;
const ALL_DAYS_MASK = 0b1111111;

const weekdayLong = (weekday: Weekday): string => WEEKDAY_NAMES.long[weekday]!;
const monthLong = (month: number): string => GREGORIAN_MONTHS[month - 1]!.name;

/** `a`, `a and b`, `a, b and c`. */
function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** `Every {unit}` or `Every {n} {units}`. */
const every = (interval: number, unit: string): string => (interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`);

/** `the 1st, 15th and last day` for month days (positive ascending, then -1); null for other negatives. */
function monthDaysText(days: readonly number[]): string | null {
  const unique = [...new Set(days)];
  if (unique.some((d) => d < -1)) return null;
  const positive = unique.filter((d) => d > 0).sort((a, b) => a - b).map(ordinal);
  if (unique.includes(-1)) positive.push('last day');
  return `the ${joinAnd(positive)}`;
}

/** The weekday set of `BYDAY` entries without ordinals as a bit mask; null when some entry has an ordinal. */
function plainMask(days: readonly WeekdayNum[]): number | null {
  let mask = 0;
  for (const d of days) {
    if (d.ordinal !== null) return null;
    mask |= 1 << d.weekday;
  }
  return mask;
}

/**
 * The "On the" phrase of a monthly or yearly rule (`second Tuesday`, `last
 * weekday`, `first weekend day`): one ordinal `BYDAY`, or a weekday, the five
 * weekdays, the weekend days or all seven days with one `BYSETPOS`; null for
 * anything else.
 */
function onTheText(rule: RRule): string | null {
  if (rule.byMonthDay.length > 0) return null;
  if (rule.bySetPos.length === 0) {
    if (rule.byDay.length !== 1) return null;
    const { weekday, ordinal: n } = rule.byDay[0]!;
    const word = n === null ? undefined : ORDINAL_WORDS[String(n)];
    return word === undefined ? null : `${word} ${weekdayLong(weekday)}`;
  }
  if (rule.bySetPos.length !== 1) return null;
  const word = ORDINAL_WORDS[String(rule.bySetPos[0])];
  const mask = plainMask(rule.byDay);
  if (word === undefined || mask === null) return null;
  const kind =
    mask === ALL_DAYS_MASK
      ? 'day'
      : mask === WEEKDAYS_MASK
        ? 'weekday'
        : mask === WEEKEND_MASK
          ? 'weekend day'
          : Number.isInteger(Math.log2(mask))
            ? weekdayLong(Math.log2(mask) as Weekday)
            : null;
  return kind === null ? null : `${word} ${kind}`;
}

/** The text of a Gregorian rule (without end), or null outside the §5.2 grammar. */
function describeRRule(rule: RRule, start: GregorianDate): string | null {
  if (rruleSupport(rule, null) !== 'supported' || rule.byWeekNo.length > 0 || rule.byYearDay.length > 0) return null;
  const { interval } = rule;
  switch (rule.freq) {
    case 'daily':
      if (rule.byMonth.length > 0 || rule.byMonthDay.length > 0 || rule.byDay.length > 0 || rule.bySetPos.length > 0) return null;
      return every(interval, 'day');
    case 'weekly': {
      if (rule.byMonth.length > 0 || rule.bySetPos.length > 0) return null;
      const mask = rule.byDay.length === 0 ? 1 << gregorianWeekday(start) : plainMask(rule.byDay);
      if (mask === null) return null;
      if (mask === WEEKDAYS_MASK) return interval === 1 ? 'Every weekday' : `Every ${interval} weeks on weekdays`;
      if (mask === WEEKEND_MASK) return interval === 1 ? 'Every weekend' : `Every ${interval} weeks on weekends`;
      const names = ([0, 1, 2, 3, 4, 5, 6] as const).filter((w) => (mask & (1 << w)) !== 0).map(weekdayLong);
      return `${every(interval, 'week')} on ${joinAnd(names)}`;
    }
    case 'monthly': {
      if (rule.byMonth.length > 0) return null;
      if (rule.byDay.length === 0 && rule.bySetPos.length === 0) {
        const days = monthDaysText(rule.byMonthDay.length > 0 ? rule.byMonthDay : [start.day]);
        return days === null ? null : `${every(interval, 'month')} on ${days}`;
      }
      const onThe = onTheText(rule);
      return onThe === null ? null : `${every(interval, 'month')} on the ${onThe}`;
    }
    case 'yearly': {
      const prefix = every(interval, 'year');
      if (rule.byMonth.length === 0) {
        if (rule.byMonthDay.length > 0 || rule.byDay.length > 0 || rule.bySetPos.length > 0) return null;
        return `${prefix} on ${monthLong(start.month)} ${start.day}`;
      }
      const months = [...new Set(rule.byMonth)].sort((a, b) => a - b).map(monthLong);
      if (rule.byDay.length === 0 && rule.bySetPos.length === 0) {
        const days = rule.byMonthDay.length > 0 ? [...new Set(rule.byMonthDay)] : [start.day];
        if (months.length === 1 && days.length === 1 && days[0]! > 0) return `${prefix} on ${months[0]} ${days[0]}`;
        const text = monthDaysText(days);
        return text === null ? null : `${prefix} in ${joinAnd(months)} on ${text}`;
      }
      const onThe = onTheText(rule);
      return onThe === null ? null : `${prefix} on the ${onThe} of ${joinAnd(months)}`;
    }
    default:
      return null;
  }
}

/** The text of a 13-month rule (§5.2). */
function describeThirteen(rule: ThirteenRule): string {
  const system = getCalendarSystem(rule.system);
  switch (rule.kind) {
    case 'monthly':
      return `Every ${system.shortName} month on the ${ordinal(rule.day)}`;
    case 'weekly':
      return rule.interval === 1
        ? `Every ${system.shortName} week on ${weekdayLong(rule.weekday)}`
        : `Every 2 ${system.shortName} weeks on ${weekdayLong(rule.weekday)}`;
    case 'yearly':
      return `Every year on ${system.shortName} ${system.months[rule.month - 1]!.name} ${rule.day}`;
    case 'intercalary':
      return `Every ${system.intercalaryDays.find((d) => d.id === rule.id)!.name}`;
  }
}

function describeValid(recurrence: EventRecurrence, start: GregorianDate): string {
  const rule = recurrence.rule;
  let text: string | null;
  if (rule.kind === 'thirteen') text = describeThirteen(rule.rule);
  else if (rule.kind === 'rrule') text = describeRRule(rule.rrule, start);
  else text = null;
  if (text === null) return CUSTOM;
  const end = recurrence.end;
  if (end.kind === 'count') text += end.count === 1 ? ', once' : `, ${end.count} times`;
  if (end.kind === 'until') {
    const date =
      rule.kind === 'thirteen' ? formatThirteen(toThirteen(end.date, rule.rule.system), { style: 'long' }) : formatGregorian(end.date, { style: 'long' });
    text += `, until ${date}`;
  }
  const extra = recurrence.extraDates.length;
  if (extra > 0) text += extra === 1 ? ', and 1 more date' : `, and ${extra} more dates`;
  return text;
}

function readSystem(systemId: unknown): CalendarSystemId {
  if (!isCalendarSystemId(systemId)) getCalendarSystem(systemId as CalendarSystemId);
  return systemId as CalendarSystemId;
}

/**
 * The repeat's description (§5.2 grammar, English, exact): `Every week on
 * Monday`, `Every IFC month on the 12th`, `Every year on Positivist Archimedes
 * 12`, `Every Leap Day`, followed by its end (`, 10 times`, `, once`, `, until
 * December 12, 2036`: 13-month long dates for 13-month rules, Gregorian long
 * dates for Gregorian rules) and its extra dates (`, and 2 more dates`).
 * `dates` and `foreign` rules and Gregorian rules outside the grammar (and
 * unsupported ones) are `Repeats on a custom schedule`. A 13-month rule names
 * its own system whichever `systemId` is selected.
 * @throws RangeError for an invalid recurrence, start or system.
 */
export function describeRecurrence(recurrence: EventRecurrence, start: GregorianDate, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): string {
  assertExpandable(recurrence);
  assertValidGregorian(start);
  readSystem(systemId);
  return describeValid(recurrence, start);
}

/** `{Wkd}, {Mon} {d}`, with `, {yyyy}` when the year is not `year`. */
function shortDate(date: GregorianDate, year: number): string {
  const text = `${WEEKDAY_NAMES.short[gregorianWeekday(date)]}, ${GREGORIAN_MONTHS[date.month - 1]!.shortName} ${date.day}`;
  return date.year === year ? text : `${text}, ${date.year}`;
}

/**
 * The repeat picker's "Next:" line (§2.13, §5.2): `Next: ` and the next
 * `count` (default 3) occurrence dates after the start as Gregorian `{Wkd},
 * {Mon} {d}` (`, {yyyy}` added when the year is not the start's), joined with
 * `; `; for 13-month rules the first date is preceded by `Gregorian `. Fewer
 * dates when the repeat ends sooner; `''` when there are none.
 *
 * Start 2026-10-19, every IFC month on the 12th:
 * `Next: Gregorian Mon, Nov 16; Mon, Dec 14; Tue, Jan 12, 2027`.
 * @throws RangeError for invalid input, or a `count` that is not an integer `1…100`.
 */
export function describeNextOccurrences(
  recurrence: EventRecurrence,
  start: GregorianDate,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
  options?: { count?: number },
): string {
  assertExpandable(recurrence);
  assertValidGregorian(start);
  readSystem(systemId);
  const opts = readOptions(options, ['count'], 'describeNextOccurrences');
  const count = opts.count ?? 3;
  if (!isInteger(count) || count < 1 || count > 100) fail(`describeNextOccurrences option 'count' must be an integer 1..100, got ${show(count)}`);
  const dates = nextValid(recurrence, start, count);
  if (dates.length === 0) return '';
  const parts = dates.map((date) => shortDate(date, start.year));
  if (recurrence.rule.kind === 'thirteen') parts[0] = `Gregorian ${parts[0]}`;
  return `Next: ${parts.join('; ')}`;
}

/** The largest month day from 29 to 31 of a Gregorian monthly rule by month days, or null. */
function longMonthDay(rule: RRule, start: GregorianDate): number | null {
  if (rule.freq !== 'monthly' || rule.byDay.length > 0 || rule.bySetPos.length > 0 || rule.byMonth.length > 0) return null;
  const days = rule.byMonthDay.length > 0 ? rule.byMonthDay : [start.day];
  const long = days.filter((d) => d >= 29);
  return long.length === 0 ? null : Math.max(...long);
}

/** `true` for a Gregorian yearly rule on February 29. */
function onLeapDay(rule: RRule, start: GregorianDate): boolean {
  if (rule.freq !== 'yearly' || rule.byDay.length > 0 || rule.bySetPos.length > 0 || rule.byWeekNo.length > 0 || rule.byYearDay.length > 0) return false;
  if (rule.byMonth.length === 0 && rule.byMonthDay.length === 0) return start.month === 2 && start.day === 29;
  return rule.byMonth.length === 1 && rule.byMonth[0] === 2 && rule.byMonthDay.length === 1 && rule.byMonthDay[0] === 29;
}

/** The weekday of a Gregorian weekly rule on one weekday every week or every 2 weeks, or null. */
function weeklyWeekday(rule: RRule, start: GregorianDate): Weekday | null {
  if (rule.freq !== 'weekly' || (rule.interval !== 1 && rule.interval !== 2)) return null;
  if (rule.byMonth.length > 0 || rule.bySetPos.length > 0 || rule.byMonthDay.length > 0 || rule.byYearDay.length > 0 || rule.byWeekNo.length > 0) {
    return null;
  }
  if (rule.byDay.length === 0) return gregorianWeekday(start);
  const mask = plainMask(rule.byDay);
  return mask !== null && Number.isInteger(Math.log2(mask)) ? (Math.log2(mask) as Weekday) : null;
}

/** The note of a leap-only intercalary rule (§5.2), or null when its start is not on it. */
function leapCapNote(rule: ThirteenRule, start: GregorianDate): string | null {
  if (rule.kind !== 'intercalary' || thirteenEncodingForm(rule) !== 'leap-interval' || !thirteenRuleIncludes(rule, start, start)) return null;
  const cap = encodeThirteenRule(rule, start).cap!;
  const system = getCalendarSystem(rule.system);
  const name = system.intercalaryDays.find((d) => d.id === rule.id)!.name;
  const text = `Repeats every 4 years until ${formatThirteen(toThirteen(cap, rule.system), { style: 'long' })}.`;
  // A cap set by the end of the range (9996) has no missing leap year after it.
  if (cap.year + 4 > MAX_YEAR) return text;
  return `${text} ${toDisplayYear(cap.year, rule.system) + 4} has no ${name}, so the repeat stops before it.`;
}

/** The Gregorian weekday(s) of a 13-month weekly rule in `year`: before and after IFC Leap Day. */
function thirteenWeeklyWeekdays(rule: ThirteenRule, year: number, start: GregorianDate): [Weekday, Weekday] {
  const dates = thirteenRuleDatesInYear(rule, year, start);
  const before = gregorianWeekday(dates[0]!);
  const after = dates.find((d) => {
    const t = toThirteen(d, rule.system);
    return isMonthDate(t) && t.month >= 7;
  })!;
  return [before, gregorianWeekday(after)];
}

/** The 13-month weekday of Gregorian weekday `weekday` in `year`, before and after IFC Leap Day, in `system`. */
function thirteenWeekdaysOf(weekday: Weekday, year: number, system: CalendarSystemId): [Weekday, Weekday] {
  const january = Array.from({ length: 7 }, (_, i) => ({ year, month: 1, day: i + 1 })).find((d) => gregorianWeekday(d) === weekday)!;
  const before = thirteenWeekday(toThirteen(january, system))!;
  // IFC Sol 1 is June 18 in leap years; any month day after Leap Day carries the later weekday.
  const summer = Array.from({ length: 7 }, (_, i) => ({ year, month: 6, day: 18 + i })).find((d) => gregorianWeekday(d) === weekday)!;
  return [before, thirteenWeekday(toThirteen(summer, system))!];
}

const plural = (weekday: Weekday): string => `${weekdayLong(weekday)}s`;

/**
 * The notes under the selected repeat (§2.13, §5.2 grammar, in this order,
 * each only when it applies; `{Y}` is the start's year + 1):
 *
 * 1. Gregorian monthly by a month day from 29 to 31: `Months without a {ord}
 *    are skipped.`, or with `gregorianOnlyCalendar` `Outlook and Exchange move
 *    this to the last day of shorter months.`
 * 2. Gregorian yearly on February 29: `Happens only in leap years.`, or with
 *    `gregorianOnlyCalendar` `Outlook and Exchange move this to February 28 in
 *    other years.`
 * 3. A leap-only intercalary rule: `Repeats every 4 years until {cap}. {year}
 *    has no {day name}, so the repeat stops before it.` with the cap as a
 *    13-month date (`Leap Day 2096`, `Festival of Holy Women 308`).
 * 4. A 13-month weekly rule (interval 1 or 2): the sentence about the days
 *    that belong to no week, then `In {Y} it falls on {Weekday}s.` (IFC with a
 *    leap `{Y}`: `... until Leap Day and on {Weekday}s after it.`).
 * 5. A Gregorian weekly rule on one weekday (interval 1 or 2): `In {Y}
 *    {Weekday}s are {IFC} {Weekday}s.` in the selected system (IFC with a leap
 *    `{Y}`: `... until Leap Day and {IFC} {Weekday}s after it.`).
 *
 * The year sentences are left out when `{Y}` is after 9999.
 * @throws RangeError for invalid input or options.
 */
export function describeRepeatNotes(
  recurrence: EventRecurrence,
  start: GregorianDate,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
  options?: { gregorianOnlyCalendar?: boolean },
): string[] {
  assertExpandable(recurrence);
  assertValidGregorian(start);
  readSystem(systemId);
  const opts = readOptions(options, ['gregorianOnlyCalendar'], 'describeRepeatNotes');
  const outlook = readBooleanOption(opts, 'gregorianOnlyCalendar', 'describeRepeatNotes') ?? false;
  const notes: string[] = [];
  const next = start.year + 1;
  const rule = recurrence.rule;
  if (rule.kind === 'rrule') {
    const day = longMonthDay(rule.rrule, start);
    if (day !== null) notes.push(outlook ? 'Outlook and Exchange move this to the last day of shorter months.' : `Months without a ${ordinal(day)} are skipped.`);
    if (onLeapDay(rule.rrule, start)) {
      notes.push(outlook ? 'Outlook and Exchange move this to February 28 in other years.' : 'Happens only in leap years.');
    }
    const weekday = weeklyWeekday(rule.rrule, start);
    if (weekday !== null && next <= MAX_YEAR) {
      const short = getCalendarSystem(systemId).shortName;
      const [before, after] = thirteenWeekdaysOf(weekday, next, systemId);
      notes.push(
        systemId === 'ifc' && isLeapYear(next)
          ? `In ${next} ${plural(weekday)} are ${short} ${plural(before)} until Leap Day and ${short} ${plural(after)} after it.`
          : `In ${next} ${plural(weekday)} are ${short} ${plural(before)}.`,
      );
    }
  }
  if (rule.kind === 'thirteen') {
    const cap = leapCapNote(rule.rule, start);
    if (cap !== null) notes.push(cap);
    if (rule.rule.kind === 'weekly') {
      const ifc = rule.rule.system === 'ifc';
      let text = ifc
        ? 'Year Day and Leap Day belong to no week, so the repeat waits one extra day after each, and its Gregorian weekday moves.'
        : 'The Festival of All the Dead and the Festival of Holy Women belong to no week, so the repeat waits one extra day after each, and its Gregorian weekday moves.';
      if (next <= MAX_YEAR) {
        const [before, after] = thirteenWeeklyWeekdays(rule.rule, next, start);
        text +=
          ifc && isLeapYear(next)
            ? ` In ${next} it falls on ${plural(before)} until Leap Day and on ${plural(after)} after it.`
            : ` In ${next} it falls on ${plural(before)}.`;
      }
      notes.push(text);
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Presets (§2.13)
// ---------------------------------------------------------------------------

function simpleRRule(freq: RRule['freq'], parts: Partial<RRule> = {}): RRule {
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

const NEVER: RepeatEnd = { kind: 'never' };
const repeatOf = (rule: RepeatRule): EventRecurrence => ({ rule, end: { kind: 'never' }, extraDates: [], exceptDates: [] });

/** The Gregorian presets' minimal forms (§4.1), in picker order. */
function gregorianPresets(): { id: string; rrule: RRule }[] {
  return [
    { id: 'daily', rrule: simpleRRule('daily') },
    { id: 'weekly', rrule: simpleRRule('weekly') },
    { id: 'biweekly', rrule: simpleRRule('weekly', { interval: 2 }) },
    { id: 'monthly', rrule: simpleRRule('monthly') },
    { id: 'yearly', rrule: simpleRRule('yearly') },
  ];
}

/** The explicit form of a Gregorian preset for `start` (§4.1): `BYDAY=MO`, `BYMONTHDAY=19`, `BYMONTH=10;BYMONTHDAY=19`. */
function explicitForm(id: string, start: GregorianDate): RRule | null {
  switch (id) {
    case 'weekly':
      return simpleRRule('weekly', { byDay: [{ weekday: gregorianWeekday(start), ordinal: null }] });
    case 'biweekly':
      return simpleRRule('weekly', { interval: 2, byDay: [{ weekday: gregorianWeekday(start), ordinal: null }] });
    case 'monthly':
      return simpleRRule('monthly', { byMonthDay: [start.day] });
    case 'yearly':
      return simpleRRule('yearly', { byMonth: [start.month], byMonthDay: [start.day] });
    default:
      return null;
  }
}

/** The 13-month preset kinds for `start` in `system`, in picker order. */
function thirteenPresets(start: GregorianDate, system: CalendarSystemId): { id: string; rule: ThirteenRule }[] {
  const kinds = [
    ['thirteen-monthly', 'monthly'],
    ['thirteen-weekly', 'weekly'],
    ['thirteen-biweekly', 'biweekly'],
    ['thirteen-yearly', 'yearly'],
    ['thirteen-intercalary', 'intercalary'],
  ] as const;
  return kinds.flatMap(([id, kind]) => {
    const rule = thirteenRuleFor(kind, start, system);
    return rule === null ? [] : [{ id, rule }];
  });
}

/**
 * The repeat picker's rows for a start (§2.13), in order: Never; the
 * Gregorian presets (every day, week, 2 weeks, month, year, in their minimal
 * forms, which derive the day from the start); and the 13-month presets of
 * `systemId` (every month, week, 2 weeks and year, or on an intercalary start
 * only that day's repeat). Labels are the descriptions without an end;
 * `exchangeSafe` is false for 13-month rules stored as day-of-year lists (§4.3 b).
 * @throws RangeError for an invalid start or system.
 */
export function repeatPresets(start: GregorianDate, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): RepeatPreset[] {
  assertValidGregorian(start);
  readSystem(systemId);
  const presets: RepeatPreset[] = [{ id: 'never', section: 'never', label: 'Never', recurrence: null, exchangeSafe: true }];
  for (const { id, rrule } of gregorianPresets()) {
    const recurrence = repeatOf({ kind: 'rrule', rrule });
    presets.push({ id, section: 'gregorian', label: describeValid(recurrence, start), recurrence, exchangeSafe: true });
  }
  for (const { id, rule } of thirteenPresets(start, systemId)) {
    const recurrence = repeatOf({ kind: 'thirteen', rule });
    presets.push({ id, section: 'thirteen', label: describeThirteen(rule), recurrence, exchangeSafe: thirteenEncodingForm(rule) !== 'byyearday' });
  }
  return presets;
}

/**
 * The id of the picker row a repeat shows as checked (§2.13): `'never'` for
 * no repeat; a Gregorian preset when the rule equals its minimal or explicit
 * form (§4.1; `X-` parts and `WKST` ignored); a 13-month preset when the rule
 * is the one that preset makes from `start` in `systemId`. The end and
 * excluded dates do not matter. `null` (Custom, or "Keep") for anything else,
 * including any repeat with extra dates and 13-month rules of the other system.
 * @throws RangeError for an invalid recurrence, start or system.
 */
export function matchRepeatPreset(
  recurrence: EventRecurrence | null,
  start: GregorianDate,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): string | null {
  if (recurrence !== null) assertExpandable(recurrence);
  assertValidGregorian(start);
  readSystem(systemId);
  if (recurrence === null) return 'never';
  if (recurrence.extraDates.length > 0) return null;
  const rule = recurrence.rule;
  if (rule.kind === 'rrule') {
    const plain = { ...rule.rrule, extensions: [] };
    for (const { id, rrule } of gregorianPresets()) {
      const forms = [rrule, explicitForm(id, start)].filter((f): f is RRule => f !== null);
      if (forms.some((form) => rruleEquals(plain, form, { ignoreEnd: true, ignoreWkst: true }))) return id;
    }
    return null;
  }
  if (rule.kind === 'thirteen') {
    if (rule.rule.system !== systemId) return null;
    const match = thirteenPresets(start, systemId).find((p) => plainEquals(p.rule, copyThirteenRule(rule.rule)));
    return match === undefined ? null : match.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Adaptation to a new start (§2.11)
// ---------------------------------------------------------------------------

/** `true` when an RRULE has only the parts a Gregorian preset can have (no COUNT or UNTIL, no X- parts). */
function isPresetShaped(rule: RRule): boolean {
  return (
    rule.count === null &&
    rule.until === null &&
    rule.bySecond.length === 0 &&
    rule.byMinute.length === 0 &&
    rule.byHour.length === 0 &&
    rule.byYearDay.length === 0 &&
    rule.byWeekNo.length === 0 &&
    rule.bySetPos.length === 0 &&
    (rule.rscale === null || rule.rscale.toUpperCase() === 'GREGORIAN') &&
    rule.skip === null &&
    rule.extensions.length === 0
  );
}

const sameList = (list: readonly number[], values: readonly number[]) =>
  list.length === values.length && list.every((v, i) => v === values[i]);

/**
 * A Gregorian preset written in its explicit form (§4.1: `BYDAY=MO`,
 * `BYMONTHDAY=19`, `BYMONTH=10;BYMONTHDAY=19`, matching the old start)
 * rewritten for the new start; `null` for any other rule, which stays as it is.
 */
function followExplicitPreset(rule: RRule, oldStart: GregorianDate, newStart: GregorianDate): RRule | null {
  if (!isPresetShaped(rule)) return null;
  const onlyDay = (days: readonly WeekdayNum[], weekday: number) =>
    days.length === 1 && days[0]!.ordinal === null && days[0]!.weekday === weekday;
  if (
    rule.freq === 'weekly' &&
    (rule.interval === 1 || rule.interval === 2) &&
    onlyDay(rule.byDay, gregorianWeekday(oldStart)) &&
    rule.byMonthDay.length === 0 &&
    rule.byMonth.length === 0
  ) {
    return { ...clonePlain(rule), byDay: [{ weekday: gregorianWeekday(newStart), ordinal: null }] };
  }
  if (
    rule.freq === 'monthly' &&
    rule.interval === 1 &&
    rule.byDay.length === 0 &&
    rule.byMonth.length === 0 &&
    sameList(rule.byMonthDay, [oldStart.day])
  ) {
    return { ...clonePlain(rule), byMonthDay: [newStart.day] };
  }
  if (
    rule.freq === 'yearly' &&
    rule.interval === 1 &&
    rule.byDay.length === 0 &&
    sameList(rule.byMonth, [oldStart.month]) &&
    sameList(rule.byMonthDay, [oldStart.day])
  ) {
    return { ...clonePlain(rule), byMonth: [newStart.month], byMonthDay: [newStart.day] };
  }
  return null;
}

/** The 13-month rule re-derived from the new start in the rule's own system, with the kind of change. */
function adaptThirteenRule(
  rule: ThirteenRule,
  newStart: GregorianDate,
): { rule: ThirteenRule | null; change: RepeatChange } {
  const date = toThirteen(newStart, rule.system);
  const follow = (next: ThirteenRule): { rule: ThirteenRule; change: RepeatChange } => ({
    rule: next,
    change: plainEquals(copyThirteenRule(rule), next) ? 'none' : 'adapted',
  });
  switch (rule.kind) {
    case 'monthly':
      if (!isMonthDate(date)) return { rule: null, change: 'dropped' };
      return follow({ kind: 'monthly', system: rule.system, day: date.day });
    case 'weekly':
      if (!isMonthDate(date)) return { rule: null, change: 'dropped' };
      return follow({ kind: 'weekly', system: rule.system, weekday: thirteenWeekday(date)!, interval: rule.interval });
    case 'yearly':
      if (!isMonthDate(date)) {
        return { rule: { kind: 'intercalary', system: rule.system, id: date.id }, change: 'converted' };
      }
      return follow({ kind: 'yearly', system: rule.system, month: date.month, day: date.day });
    case 'intercalary':
      if (isMonthDate(date)) {
        return { rule: { kind: 'yearly', system: rule.system, month: date.month, day: date.day }, change: 'converted' };
      }
      if (date.id === rule.id) return { rule: copyThirteenRule(rule), change: 'none' };
      return { rule: { kind: 'intercalary', system: rule.system, id: date.id }, change: 'converted' };
  }
}

/**
 * Re-derives a repeat when the start of its first occurrence moves from
 * `oldStart` to `newStart` (the §2.11 table), so that no change of repeat kind
 * is ever silent. 13-month rules are re-derived in their own system:
 *
 * - 13-month monthly, weekly and every 2 weeks: on a month day they follow
 *   the new day or weekday (`'adapted'`; the fortnight phase always comes from
 *   the start); on an intercalary day the repeat becomes Never (`null`,
 *   `'dropped'`).
 * - 13-month yearly: on a month day, yearly on the new date (`'adapted'`); on
 *   an intercalary day, that day's intercalary repeat (`'converted'`).
 * - Intercalary: the same day in another year keeps it (`'none'`); another
 *   intercalary day gives that day's repeat, and a month day 13-month yearly
 *   on the new date (both `'converted'`).
 * - Gregorian presets in their minimal form (`FREQ=WEEKLY`) derive their day
 *   from the start and stay as they are (`'none'`). In their explicit form
 *   matching `oldStart` (`FREQ=WEEKLY;BYDAY=MO`, every 2 weeks likewise,
 *   `FREQ=MONTHLY;BYMONTHDAY=19`, `FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=19`) they
 *   are rewritten for `newStart` (`'adapted'`).
 * - Any other Gregorian rule (custom days, `Keep:` rules), and `dates` and
 *   `foreign` rules, stay as they are (`'none'`; the start stays the first
 *   occurrence even on a day the rule skips, as in RFC 5545).
 *
 * `'none'` always means the returned recurrence equals the input. The end,
 * extra dates and removed dates are kept as they are (moving exceptions is
 * `retimeExceptions`, §4.7). The result is always a fresh value.
 * @throws RangeError for an invalid recurrence or date.
 */
export function adaptRecurrenceToStart(
  recurrence: EventRecurrence,
  oldStart: GregorianDate,
  newStart: GregorianDate,
): { recurrence: EventRecurrence | null; change: RepeatChange } {
  assertValidRecurrence(recurrence);
  assertValidGregorian(oldStart);
  assertValidGregorian(newStart);
  const copy = copyRecurrence(recurrence);
  const rule = recurrence.rule;
  if (rule.kind === 'thirteen') {
    const adapted = adaptThirteenRule(rule.rule, newStart);
    if (adapted.rule === null) return { recurrence: null, change: adapted.change };
    return { recurrence: { ...copy, rule: { kind: 'thirteen', rule: adapted.rule } }, change: adapted.change };
  }
  if (rule.kind === 'rrule') {
    const followed = followExplicitPreset(rule.rrule, oldStart, newStart);
    if (followed !== null && !plainEquals(followed, rule.rrule)) {
      return { recurrence: { ...copy, rule: { kind: 'rrule', rrule: followed } }, change: 'adapted' };
    }
  }
  return { recurrence: copy, change: 'none' };
}

// ---------------------------------------------------------------------------
// Recognition (§4.5)
// ---------------------------------------------------------------------------

const SYSTEMS_ORDER = (preferred: CalendarSystemId): CalendarSystemId[] => (preferred === 'ifc' ? ['ifc', 'positivist'] : ['positivist', 'ifc']);

/** The 13-month rules a start can carry, preferred system first (§4.5 step 2): monthly, weekly, every 2 weeks, yearly, intercalary. */
function candidatesFor(start: GregorianDate, preferred: CalendarSystemId): ThirteenRule[] {
  const kinds = ['monthly', 'weekly', 'biweekly', 'yearly', 'intercalary'] as const;
  return SYSTEMS_ORDER(preferred).flatMap((system) =>
    kinds.flatMap((kind) => {
      const rule = thirteenRuleFor(kind, start, system);
      return rule === null ? [] : [rule];
    }),
  );
}

const withoutEnd = (rrule: RRule): RRule => ({ ...copyRRule(rrule), count: null, until: null });

/**
 * The end of a stored rule (§4.5): `COUNT`, or the until end date of its
 * `UNTIL` in the event's zone (`untilEndDate` with the start's minute). An
 * `UNTIL` the platform could not convert (outside years 1 to 9999) is read as
 * written.
 */
function endOf(rrule: RRule, until: LocalDateTime | null, start: LocalDateTime): RepeatEnd {
  if (rrule.count !== null) return { kind: 'count', count: rrule.count };
  if (rrule.until === null) return { kind: 'never' };
  const value = until ?? (rrule.until.kind === 'date' ? { date: rrule.until.date, minute: 1440 } : rrule.until.value);
  try {
    return { kind: 'until', date: untilEndDate(value, start.minute) };
  } catch {
    return { kind: 'until', date: copyDate(start.date) };
  }
}

/**
 * A 13-month rule's end read back: an until on the leap-interval cap is the
 * encoding of "never" (§4.3 c). A leap-only repeat without an end stops at
 * its cap all the same (see {@link ruleStream}), so both expand alike, and the
 * editor shows the user's End repeat Never with the cap note.
 */
function thirteenEnd(rule: ThirteenRule, start: GregorianDate, end: RepeatEnd): RepeatEnd {
  if (end.kind !== 'until') return end;
  const cap = thirteenRuleCap(rule, start);
  return cap !== null && jdn(end.date) === jdn(cap) ? NEVER : end;
}

/**
 * `true` unless `rule` is leap-only and `end` reaches past its cap (§4.5 steps
 * 1 and 3): such a stored rule produces later dates that the 13-month repeat
 * does not have (2100-06-17 for `FREQ=YEARLY;INTERVAL=4` from a Leap Day), so
 * it stays a Gregorian rule. A count fits when its last date (every fourth
 * year from the start) is in the cap's year or earlier; no end never fits.
 */
function withinCap(rule: ThirteenRule, start: GregorianDate, end: RepeatEnd): boolean {
  const cap = thirteenRuleCap(rule, start);
  if (cap === null) return true;
  switch (end.kind) {
    case 'never':
      return false;
    case 'count':
      return start.year + 4 * (end.count - 1) <= cap.year;
    case 'until':
      return jdn(end.date) <= jdn(cap);
  }
}

/** `true` when an RRULE has nothing but the given parts (and `COUNT`, `UNTIL`, `WKST`). */
function onlyParts(rrule: RRule, allowed: readonly (keyof RRule)[]): boolean {
  const lists: (keyof RRule)[] = ['bySecond', 'byMinute', 'byHour', 'byDay', 'byMonthDay', 'byYearDay', 'byWeekNo', 'byMonth', 'bySetPos', 'extensions'];
  return (
    lists.every((key) => allowed.includes(key) || (rrule[key] as readonly unknown[]).length === 0) &&
    rrule.rscale === null &&
    rrule.skip === null
  );
}

/** `true` when the Custom editor can express a single RRULE (§4.5 step 4, §2.13). `X-` parts and `WKST` are kept as read. */
function expressible(rrule: RRule): boolean {
  if (rrule.interval > 99) return false;
  if (rrule.bySecond.length + rrule.byMinute.length + rrule.byHour.length + rrule.byYearDay.length + rrule.byWeekNo.length > 0) return false;
  if ((rrule.rscale !== null && rrule.rscale !== 'GREGORIAN') || rrule.skip !== null) return false;
  const monthDaysOk = () => rrule.byMonthDay.every((d) => d > 0 || d === -1);
  const onThe = () => onTheText(rrule) !== null;
  switch (rrule.freq) {
    case 'daily':
      return rrule.byMonth.length + rrule.byMonthDay.length + rrule.byDay.length + rrule.bySetPos.length === 0;
    case 'weekly':
      return rrule.byMonth.length + rrule.byMonthDay.length + rrule.bySetPos.length === 0 && plainMask(rrule.byDay) !== null;
    case 'monthly':
    case 'yearly': {
      if (rrule.freq === 'monthly' && rrule.byMonth.length > 0) return false;
      if (rrule.freq === 'yearly' && rrule.byMonth.length === 0) {
        return rrule.byMonthDay.length + rrule.byDay.length + rrule.bySetPos.length === 0;
      }
      if (rrule.byDay.length === 0 && rrule.bySetPos.length === 0) return monthDaysOk();
      return onThe();
    }
    default:
      return false;
  }
}

/** The 13-month yearly rules whose encoding is the plain yearly rule (form a) for `start`, preferred system first. */
function invariantYearly(start: GregorianDate, preferred: CalendarSystemId): ThirteenRule[] {
  return SYSTEMS_ORDER(preferred).flatMap((system) => {
    const rule = thirteenRuleFor('yearly', start, system) ?? thirteenRuleFor('intercalary', start, system);
    return rule !== null && thirteenEncodingForm(rule) === 'gregorian-yearly' ? [rule] : [];
  });
}

const sameSet = (a: readonly number[], b: readonly number[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((v) => right.has(v));
};

/**
 * `true` when `{start} ∪ dates` equals the rule's dates from `start` through
 * the latest of them (§4.5 steps 1 and 5). A leap-only rule's dates end at its
 * cap (§4.3 c), so a list that goes past the cap is not that rule.
 */
function isPrefix(rule: ThirteenRule, start: GregorianDate, dates: readonly GregorianDate[]): boolean {
  const days = [jdn(start), ...dates.map(jdn)];
  const latest = Math.max(...days);
  if (!withinCap(rule, start, { kind: 'until', date: dateOf(latest) })) return false;
  const expected = thirteenRuleRdates(rule, start, { kind: 'until', date: dateOf(latest) }, dateOf(latest), { maxValues: MAX_INT }).dates;
  return sameSet(days, [jdn(start), ...expected.map(jdn)]);
}

function assertRecognitionInput(value: unknown): asserts value is RecognitionInput {
  if (!isRecord(value)) fail(`Recognition input must be an object, got ${show(value)}`);
  assertValidLocalDateTime(value.start, 'recognition start', false);
  for (const name of ['rrules', 'exrules'] as const) {
    const list = value[name];
    if (!Array.isArray(list)) fail(`${name} must be an array, got ${show(list)}`);
    for (const entry of list) {
      if (!isRecord(entry)) fail(`${name} entries must be { rrule, until }, got ${show(entry)}`);
      assertValidRRule(entry.rrule, `${name} rrule`);
      if (entry.until !== null) assertValidLocalDateTime(entry.until, `${name} until`);
    }
  }
  if (!Array.isArray(value.rdates)) fail(`rdates must be an array, got ${show(value.rdates)}`);
  for (const entry of value.rdates) {
    const problem = extraDateProblem(entry);
    if (problem !== null) fail(problem.replace('extraDates', 'rdates'));
  }
  assertOriginalDates(value.exdates, 'exdates');
  if (value.marker !== null && typeof value.marker !== 'string') fail(`marker must be a string or null, got ${show(value.marker)}`);
}

/** The marker's rule, Android extras and end, or null when it does not parse. */
function readMarker(marker: string | null): { rule: ThirteenRule; end: RepeatEnd | null; series: string | null; part: number | null; uri: boolean } | null {
  if (marker === null) return null;
  try {
    if (marker.startsWith('thirteen://')) {
      const uri = parseThirteenRuleUri(marker);
      return { rule: uri.rule, end: uri.end, series: uri.series, part: uri.part, uri: true };
    }
    return { rule: parseThirteenRuleText(marker), end: null, series: null, part: null, uri: false };
  } catch {
    return null;
  }
}

/**
 * Turns stored recurrence data back into a repeat (§4.5). Values with the
 * start's own minute are read as the master's (`minute` null) first. Steps,
 * first match wins:
 *
 * 1. **Marker** (`source: 'marker'`): a marker that parses is trusted when its
 *    encoding from the start equals the single `RRULE` (ignoring `COUNT`,
 *    `UNTIL` and `WKST`; no `EXRULE`), with the end from `COUNT` / `UNTIL` and
 *    any `RDATE`s as extra dates (a leap-only marker only with an end on or
 *    before its cap, as in step 3); or, with no `RRULE` and no `EXRULE`, when
 *    `{start} ∪ RDATE ∪ EXDATE` (all at the start's time) is a prefix of the
 *    rule's dates, with the end from the Android marker (or until the latest
 *    date for an `X-THIRTEEN-RULE`). The Android marker also gives
 *    `openEnded`, `series` and `part`.
 * 2. **Day-of-year list** (`'byyearday'`): one `FREQ=YEARLY` rule with only
 *    `BYYEARDAY` (and `COUNT`, `UNTIL`, `WKST`), no `RDATE` or `EXRULE`, whose
 *    set equals the form (b) list of a rule made from the start (monthly,
 *    weekly, every 2 weeks, yearly, intercalary; preferred system first). Other
 *    matches go into `alternatives`.
 * 3. **Leap interval** (`'leap-interval'`): `FREQ=YEARLY;INTERVAL=4` with no
 *    `BY` parts and no `RDATE`, from IFC Leap Day or Positivist Holy Women,
 *    ending on or before the cap (an until on the cap reads as never, which
 *    expands the same: a leap-only repeat stops at its cap). A date list
 *    (steps 1 and 5) that goes past the cap is not a leap-only rule either.
 * 4. **Gregorian** (`'gregorian'`): one `RRULE` the Custom editor can express,
 *    with `RDATE`s as extra dates (then not editable). A plain yearly rule on a
 *    date whose 13-month yearly rule is form (a) lists that rule in
 *    `alternatives`.
 * 5. **Date list**: no `RRULE`, some `RDATE`s: a rule made from the start
 *    whose dates up to the latest equal `{start} ∪ RDATE ∪ EXDATE` (`'rdates'`,
 *    until the latest date); otherwise `'dates'` with the `RDATE`s as extra
 *    dates (not editable).
 * 6. **Anything else**: several `RRULE`s or any `EXRULE` is `'foreign'` (each
 *    rule with its own end); one `RRULE` the editor cannot express is a
 *    Gregorian `rrule` rule that is not editable.
 *
 * `EXDATE`s are always the excluded dates.
 * @throws RangeError for malformed input or system.
 */
export function recognizeRecurrence(input: RecognitionInput, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): Recognition {
  assertRecognitionInput(input);
  readSystem(systemId);
  const start = input.start;
  const startDate = start.date;
  const minuteOf = (minute: number | null) => (minute === start.minute ? null : minute);
  const rdates: ExtraDate[] = input.rdates.map((x) => ({ date: copyDate(x.date), minute: minuteOf(x.minute), durationMinutes: x.durationMinutes }));
  const exdates: OriginalDate[] = input.exdates.map((x) => ({ date: copyDate(x.date), minute: minuteOf(x.minute) }));
  const result = (
    rule: RepeatRule,
    end: RepeatEnd,
    source: Recognition['source'],
    editable: boolean,
    extras: { extraDates?: ExtraDate[]; alternatives?: ThirteenRule[]; openEnded?: boolean; series?: string | null; part?: number | null } = {},
  ): Recognition => ({
    recurrence: { rule, end, extraDates: extras.extraDates ?? [], exceptDates: exdates },
    source,
    editable: editable && (extras.extraDates ?? []).length === 0,
    alternatives: extras.alternatives ?? [],
    openEnded: extras.openEnded ?? false,
    series: extras.series ?? null,
    part: extras.part ?? null,
  });
  const single = input.rrules.length === 1 && input.exrules.length === 0 ? input.rrules[0]! : null;
  const plainDates = rdates.every((x) => x.minute === null && x.durationMinutes === null) && exdates.every((x) => x.minute === null);

  // 1. Marker.
  const marker = readMarker(input.marker);
  if (marker !== null) {
    const extras = { openEnded: marker.uri && marker.end!.kind === 'never', series: marker.series, part: marker.part };
    if (single !== null && thirteenRuleIncludes(marker.rule, startDate, startDate)) {
      const encoding = encodeThirteenRule(marker.rule, startDate).rrule;
      const end = endOf(single.rrule, single.until, start);
      // A leap-only marker is trusted only with an end on or before its cap, as step 3 requires.
      if (rruleEquals(encoding, single.rrule, { ignoreEnd: true, ignoreWkst: true }) && withinCap(marker.rule, startDate, end)) {
        return result({ kind: 'thirteen', rule: marker.rule }, thirteenEnd(marker.rule, startDate, end), 'marker', true, {
          ...extras,
          extraDates: rdates,
        });
      }
    }
    if (input.rrules.length === 0 && input.exrules.length === 0 && plainDates) {
      const listed = [...rdates.map((x) => x.date), ...exdates.map((x) => x.date)];
      if (isPrefix(marker.rule, startDate, listed)) {
        const latest = dateOf(Math.max(jdn(startDate), ...listed.map(jdn)));
        const end = marker.end ?? { kind: 'until', date: latest };
        return result({ kind: 'thirteen', rule: marker.rule }, copyEnd(end), 'marker', true, extras);
      }
    }
  }

  // 2. Day-of-year list.
  if (single !== null && rdates.length === 0) {
    const rrule = single.rrule;
    if (rrule.freq === 'yearly' && rrule.interval === 1 && rrule.byYearDay.length > 0 && onlyParts(rrule, ['byYearDay'])) {
      const matches = candidatesFor(startDate, systemId).filter((rule) => {
        const list = thirteenRuleYearDayList(rule, startDate);
        return list !== null && sameSet(list, rrule.byYearDay);
      });
      if (matches.length > 0) {
        const end = endOf(rrule, single.until, start);
        return result({ kind: 'thirteen', rule: matches[0]! }, end, 'byyearday', true, { alternatives: matches.slice(1) });
      }
    }
  }

  // 3. Leap interval.
  if (single !== null && rdates.length === 0) {
    const rrule = single.rrule;
    if (rrule.freq === 'yearly' && rrule.interval === 4 && onlyParts(rrule, [])) {
      const rule = SYSTEMS_ORDER(systemId)
        .map((system) => thirteenRuleFor('intercalary', startDate, system))
        .find((r): r is ThirteenRule => r !== null && thirteenEncodingForm(r) === 'leap-interval');
      if (rule !== undefined) {
        const end = endOf(rrule, single.until, start);
        if (withinCap(rule, startDate, end)) return result({ kind: 'thirteen', rule }, thirteenEnd(rule, startDate, end), 'leap-interval', true);
      }
    }
  }

  // 4. Gregorian.
  if (single !== null && expressible(single.rrule)) {
    const rrule = single.rrule;
    const plainYearly =
      rrule.freq === 'yearly' &&
      rrule.interval === 1 &&
      onlyParts(rrule, ['byMonth', 'byMonthDay', 'extensions']) &&
      ((rrule.byMonth.length === 0 && rrule.byMonthDay.length === 0) ||
        (sameList(rrule.byMonth, [startDate.month]) && sameList(rrule.byMonthDay, [startDate.day])));
    return result({ kind: 'rrule', rrule: withoutEnd(rrule) }, endOf(rrule, single.until, start), 'gregorian', true, {
      extraDates: rdates,
      alternatives: plainYearly ? invariantYearly(startDate, systemId) : [],
    });
  }

  // 5. Date list.
  if (input.rrules.length === 0 && input.exrules.length === 0 && rdates.length > 0) {
    if (plainDates) {
      const listed = [...rdates.map((x) => x.date), ...exdates.map((x) => x.date)];
      const matches = candidatesFor(startDate, systemId).filter((rule) => isPrefix(rule, startDate, listed));
      if (matches.length > 0) {
        const latest = dateOf(Math.max(jdn(startDate), ...listed.map(jdn)));
        return result({ kind: 'thirteen', rule: matches[0]! }, { kind: 'until', date: latest }, 'rdates', true, { alternatives: matches.slice(1) });
      }
    }
    return result({ kind: 'dates' }, NEVER, 'dates', false, { extraDates: rdates });
  }

  // 6. Anything else.
  if (single !== null) {
    return result({ kind: 'rrule', rrule: withoutEnd(single.rrule) }, endOf(single.rrule, single.until, start), 'gregorian', false, { extraDates: rdates });
  }
  if (input.rrules.length === 0 && input.exrules.length === 0) {
    return result({ kind: 'dates' }, NEVER, 'dates', false);
  }
  const ended = (entry: { readonly rrule: RRule; readonly until: LocalDateTime | null }): EndedRule => ({
    rrule: withoutEnd(entry.rrule),
    end: endOf(entry.rrule, entry.until, start),
  });
  return result({ kind: 'foreign', rules: input.rrules.map(ended), exrules: input.exrules.map(ended) }, NEVER, 'foreign', false, {
    extraDates: rdates,
  });
}
