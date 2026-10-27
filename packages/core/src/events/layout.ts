/**
 * Layouts of event occurrences for the Calendar section (docs/EVENTS.md §2.3
 * to §2.8, §5.2, §5.3): Month lanes and intercalary bands, the Week and Day
 * timelines with their overflow blocks, the List agenda, Year dots, the Month
 * header's Gregorian weekdays and the compact chip time.
 *
 * Every function takes {@link EventOccurrence}s in the **device's** wall clock,
 * already filtered to visible calendars, with ends in end-of-day form
 * (§3.1.1; `D+1 T00:00` is accepted as the same end as `D T24:00`). Days are
 * Gregorian days: an occurrence touches every date from its start date to the
 * date of its end-of-day form, inclusive (a zero-length occurrence touches its
 * start date). Keys must be unique within one call.
 *
 * **Bars and dots.** An occurrence that is all-day or lasts 24 hours or more
 * (wall clock) is a bar; a shorter timed occurrence is a dot in Month and a
 * block on the Week and Day timelines.
 *
 * **Order key** (§5.3), used everywhere, ties broken left to right:
 * 1. start, earlier first;
 * 2. all-day bars, then timed bars, then dots (this satisfies both "bars
 *    before dots" and "all-day before timed");
 * 3. longer duration first;
 * 4. title by Unicode code points;
 * 5. key by Unicode code points.
 *
 * **Interpretations** where §5.3 leaves a detail open (the fixtures pin them
 * for the ports):
 * - Month and all-day lanes sort by the clipped start column, then bars
 *   before dots, then the full order key, so the timed items of one day keep
 *   their time order (boards A2 and K1).
 * - With unlimited `maxLanes`, every column's `visibleLanes` is the number of
 *   lanes the row (or band) uses.
 * - Overflowed timeline items keep the `slot` and `slotCount` of their full
 *   cluster; only `hidden` changes. A `TimedOverflow` ends at the hidden
 *   items' latest effective end, which can pass 1440 by less than
 *   `minDurationMinutes` near midnight.
 * - A timed occurrence whose wall-clock end is before its start (a fall-back
 *   night, §5.3 step 6) is laid out as zero-length, so the timelines draw it
 *   with the minimum duration. An all-day occurrence must not end before it
 *   starts.
 * @module
 */

import {
  type GregorianDate,
  assertValidGregorian,
  assertValidYear,
  fromJulianDayNumber,
  gregorianWeekday,
  toJulianDayNumber,
} from '../gregorian.ts';
import { fail, isInteger, isRecord, pad, readBooleanOption, readOptions, show } from '../internal.ts';
import { type CalendarSystemId, type IntercalaryDayId, DEFAULT_SYSTEM_ID, getCalendarSystem } from '../systems/index.ts';
import {
  type ThirteenDate,
  type ThirteenIntercalaryDate,
  type ThirteenMonthDate,
  DAYS_PER_WEEK,
  WEEKS_PER_MONTH,
  intercalaryDaysInYear,
  monthDays,
  toThirteen,
} from '../thirteen.ts';
import type { Weekday } from '../weekday.ts';
import type { EventOccurrence } from './model.ts';
import { assertValidLocalDateTime, isValidLocalDateTime, toAbsoluteMinutes } from './time.ts';

// ---------------------------------------------------------------------------
// Types (§5.2)
// ---------------------------------------------------------------------------

/** One bar or dot in a Month week row, an intercalary band or the Week all-day row. */
export interface MonthItem {
  readonly key: string;
  /** `bar`: all-day or 24 hours or more; `dot`: a shorter timed occurrence (one item per day it touches). */
  readonly style: 'bar' | 'dot';
  /** `0…6` within a week row (`0` in an intercalary band; up to `8` in the Week all-day row). */
  readonly startColumn: number;
  /** Inclusive. */
  readonly endColumn: number;
  readonly lane: number;
  /** The occurrence starts before `startColumn`'s day (a previous row, month, band or week). */
  readonly continuesBefore: boolean;
  /** The occurrence ends after `endColumn`'s day. */
  readonly continuesAfter: boolean;
}

/** One week row of a Month layout. */
export interface MonthWeekRow {
  readonly week: 1 | 2 | 3 | 4;
  /** In lane-assignment order: clipped start column, bars before dots, then the order key. */
  readonly items: MonthItem[];
  /** Per column (7 entries): lanes that show items; with an overflow the next lane holds "+{hidden} more". */
  readonly visibleLanes: number[];
  /** Per column (7 entries): items not drawn in that column (0 when everything fits). */
  readonly hidden: number[];
}

/** An intercalary day drawn as a full-width band under week 4 of the month it follows. */
export interface IntercalaryBand {
  readonly id: IntercalaryDayId;
  readonly gregorian: GregorianDate;
  readonly items: MonthItem[];
  readonly visibleLanes: number;
  readonly hidden: number;
}

/** A 13-month month with its occurrences in lanes (§2.4, §5.3). */
export interface ThirteenMonthEventLayout {
  /** Gregorian year. */
  readonly year: number;
  readonly month: number;
  readonly system: CalendarSystemId;
  /** The Gregorian weekday of each column this month (7 entries, §2.4 header line 2). */
  readonly columnGregorianWeekdays: Weekday[];
  /** Exactly 4 rows. */
  readonly weeks: MonthWeekRow[];
  /** The intercalary days with `afterMonth === month`, in chronological order (0, 1 or 2). */
  readonly intercalary: IntercalaryBand[];
}

/** A shorter timed occurrence on one Week or Day column. */
export interface TimedItem {
  readonly key: string;
  readonly column: number;
  /** Clipped to the column's day, `0…1440`. */
  readonly startMinute: number;
  /** Clipped to the column's day, `0…1440`. */
  readonly endMinute: number;
  /** The occurrence starts on an earlier day. */
  readonly clippedStart: boolean;
  /** The occurrence ends on a later day. */
  readonly clippedEnd: boolean;
  /** Horizontal position inside its overlap cluster: x = `slot` x column width / `slotCount`. */
  readonly slot: number;
  readonly slotCount: number;
  /** `true`: drawn only through its {@link TimedOverflow}. */
  readonly hidden: boolean;
}

/** The "+{n}" block of §2.5: the items a cluster could not show. */
export interface TimedOverflow {
  readonly column: number;
  /** `maxSlots - 1`. */
  readonly slot: number;
  /** `maxSlots`. */
  readonly slotCount: number;
  /** The hidden items' earliest start. */
  readonly startMinute: number;
  /** The hidden items' latest effective end (`max(end, start + minDurationMinutes)`). */
  readonly endMinute: number;
  /** Hidden items in order-key order. */
  readonly keys: string[];
}

/** A column of the Week timeline: a day of the 13-month week, or an intercalary day after week 4. */
export type WeekColumn =
  | { readonly kind: 'day'; readonly gregorian: GregorianDate; readonly thirteen: ThirteenMonthDate }
  | { readonly kind: 'intercalary'; readonly gregorian: GregorianDate; readonly thirteen: ThirteenIntercalaryDate };

/** A 13-month week with its all-day row and timeline (§2.5, §5.3). */
export interface WeekEventLayout {
  /** The week's 7 days, plus the intercalary days that follow week 4 of the month. */
  readonly columns: WeekColumn[];
  /** Bars over the columns, in lanes (one row for the whole week). */
  readonly allDay: MonthItem[];
  /** By column, then in the column's sort order. */
  readonly timed: TimedItem[];
  /** By column, then in time order. */
  readonly overflow: TimedOverflow[];
}

/** One occurrence on one day of the agenda. */
export interface AgendaItem {
  readonly key: string;
  readonly part: 'single' | 'first' | 'middle' | 'last';
  /** 1-based day of the occurrence ("Day 2 of 3"). */
  readonly dayIndex: number;
  /** Days the whole occurrence touches. */
  readonly dayCount: number;
  /** The part's start on this day; `null` for all-day occurrences and middle parts. */
  readonly startMinute: number | null;
  /** The part's end on this day (`1440` when it runs to midnight); `null` for all-day occurrences and middle parts. */
  readonly endMinute: number | null;
}

/** One day of the agenda (List mode, Up next, Month at accessibility sizes). */
export interface AgendaDay {
  readonly gregorian: GregorianDate;
  readonly thirteen: ThirteenDate;
  /** All-day items and middle parts (order key), then by start minute, then the order key. */
  readonly items: AgendaItem[];
}

/** A day of the Gregorian year with events, for Year mode dots and the compact Month dots. */
export interface YearMark {
  readonly dayOfYear: number;
  readonly gregorian: GregorianDate;
  /** Occurrences covering the day. */
  readonly count: number;
  /** Distinct calendar ids of those occurrences in order-key order, at most `maxCalendars`. */
  readonly calendarIds: string[];
}

// ---------------------------------------------------------------------------
// Prepared occurrences and the order key
// ---------------------------------------------------------------------------

/** Minutes in a day. */
const DAY = 1440;

/** Criterion 2 of the order key. */
const RANK_ALL_DAY = 0;
const RANK_TIMED_BAR = 1;
const RANK_DOT = 2;

/** An occurrence validated and reduced to the numbers the layouts use. */
interface Prepared {
  readonly key: string;
  readonly calendarId: string;
  readonly title: string;
  readonly allDay: boolean;
  /** Absolute wall-clock minutes (see `toAbsoluteMinutes`). */
  readonly start: number;
  /** Absolute wall-clock minutes, never before `start`. */
  readonly end: number;
  readonly duration: number;
  /** Julian Day Number of the first day touched. */
  readonly firstDay: number;
  /** Julian Day Number of the last day touched. */
  readonly lastDay: number;
  readonly rank: number;
  readonly bar: boolean;
  /** Position in order-key order among the occurrences of the call. */
  order: number;
}

/**
 * Compares two strings by Unicode code points (UTF-16 code unit order differs
 * only where a surrogate meets a unit in U+E000…U+FFFF). Returns -1, 0 or 1.
 * @internal
 */
export function compareCodePoints(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return codePointRank(x) < codePointRank(y) ? -1 : 1;
  }
  return a.length < b.length ? -1 : 1;
}

/** Maps a UTF-16 code unit so that unit order equals code point order. */
function codePointRank(unit: number): number {
  if (unit < 0xd800) return unit;
  return unit >= 0xe000 ? unit - 0x800 : unit + 0x2000;
}

function compareOrderKey(a: Prepared, b: Prepared): number {
  return (
    a.start - b.start ||
    a.rank - b.rank ||
    b.duration - a.duration ||
    compareCodePoints(a.title, b.title) ||
    compareCodePoints(a.key, b.key)
  );
}

function prepareOne(value: unknown, index: number, context: string): Prepared {
  // Messages are built only on failure: this runs for every occurrence of every layout.
  const where = () => `${context}: occurrence ${index}${isRecord(value) ? ` (key ${show(value.key)})` : ''}`;
  if (!isRecord(value)) fail(`${where()} must be an EventOccurrence object, got ${show(value)}`);
  const { key, calendarId, title, allDay, start, end } = value;
  if (typeof key !== 'string') fail(`${where()}: key must be a string`);
  if (typeof calendarId !== 'string') fail(`${where()}: calendarId must be a string, got ${show(calendarId)}`);
  if (typeof title !== 'string') fail(`${where()}: title must be a string, got ${show(title)}`);
  if (typeof allDay !== 'boolean') fail(`${where()}: allDay must be a boolean, got ${show(allDay)}`);
  if (!isValidLocalDateTime(start) || start.minute === DAY) assertValidLocalDateTime(start, `start of ${where()}`, false);
  if (!isValidLocalDateTime(end)) assertValidLocalDateTime(end, `end of ${where()}`);
  const startAbsolute = toAbsoluteMinutes(start);
  let endAbsolute = toAbsoluteMinutes(end);
  if (allDay) {
    if (start.minute !== 0 || (end.minute !== 0 && end.minute !== DAY)) {
      fail(`${where()}: an all-day occurrence runs from T00:00 to T24:00 (or T00:00) of whole days`);
    }
    if (endAbsolute < startAbsolute) fail(`${where()}: the end is before the start`);
  } else if (endAbsolute < startAbsolute) {
    endAbsolute = startAbsolute; // a fall-back night: laid out as zero-length (§5.3 step 6)
  }
  const duration = endAbsolute - startAbsolute;
  const firstDay = Math.floor(startAbsolute / DAY);
  const bar = allDay || duration >= DAY;
  return {
    key,
    calendarId,
    title,
    allDay,
    start: startAbsolute,
    end: endAbsolute,
    duration,
    firstDay,
    lastDay: duration > 0 ? Math.floor((endAbsolute - 1) / DAY) : firstDay,
    rank: allDay ? RANK_ALL_DAY : bar ? RANK_TIMED_BAR : RANK_DOT,
    bar,
    order: 0,
  };
}

/**
 * Validates `occurrences` and returns them prepared, in order-key order.
 * @throws RangeError for a non-array, an invalid occurrence or a repeated key.
 */
function prepareOccurrences(occurrences: unknown, context: string): Prepared[] {
  if (!Array.isArray(occurrences)) fail(`${context}: occurrences must be an array, got ${show(occurrences)}`);
  const keys = new Set<string>();
  const prepared: Prepared[] = [];
  for (let i = 0; i < occurrences.length; i++) {
    const item = prepareOne(occurrences[i], i, context);
    if (keys.has(item.key)) fail(`${context}: the occurrence key ${show(item.key)} is used twice (keys must be unique, §3.2)`);
    keys.add(item.key);
    prepared.push(item);
  }
  prepared.sort(compareOrderKey);
  for (let i = 0; i < prepared.length; i++) prepared[i]!.order = i;
  return prepared;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** An optional integer option `min…max`; `null` when absent. */
function readIntegerOption(
  bag: Record<string, unknown>,
  key: string,
  context: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number | null {
  const value = bag[key];
  if (value === undefined) return null;
  if (!isInteger(value) || value < min || value > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? `${min} or more` : `${min}..${max}`;
    fail(`${context} option '${key}' must be an integer ${range}, got ${show(value)}`);
  }
  return value;
}

interface TimelineOptions {
  readonly minDuration: number;
  readonly maxSlots: number | null;
}

function readTimelineOptions(options: unknown, context: string): TimelineOptions {
  const bag = readOptions(options, ['minDurationMinutes', 'maxSlots'], context);
  return {
    minDuration: readIntegerOption(bag, 'minDurationMinutes', context, 0, DAY) ?? 15,
    maxSlots: readIntegerOption(bag, 'maxSlots', context, 1),
  };
}

// ---------------------------------------------------------------------------
// Lanes (Month rows, intercalary bands, the Week all-day row)
// ---------------------------------------------------------------------------

/** An item being placed in lanes. */
interface LaneWork {
  readonly source: Prepared;
  readonly style: 'bar' | 'dot';
  readonly startColumn: number;
  readonly endColumn: number;
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
  lane: number;
}

/**
 * Adds the items of `p` for the contiguous days `first…last` (Julian Day
 * Numbers, column = day − first): one bar clipped to the range, or one dot per
 * day touched. `withDots: false` skips dots (the Week all-day row).
 */
function collectLaneItems(p: Prepared, first: number, last: number, withDots: boolean, out: LaneWork[]): void {
  if (p.lastDay < first || p.firstDay > last) return;
  const from = Math.max(p.firstDay, first);
  const to = Math.min(p.lastDay, last);
  if (p.bar) {
    out.push({
      source: p,
      style: 'bar',
      startColumn: from - first,
      endColumn: to - first,
      continuesBefore: p.firstDay < from,
      continuesAfter: p.lastDay > to,
      lane: -1,
    });
    return;
  }
  if (!withDots) return;
  for (let day = from; day <= to; day++) {
    out.push({
      source: p,
      style: 'dot',
      startColumn: day - first,
      endColumn: day - first,
      continuesBefore: p.firstDay < day,
      continuesAfter: p.lastDay > day,
      lane: -1,
    });
  }
}

function compareLaneWork(a: LaneWork, b: LaneWork): number {
  return (
    a.startColumn - b.startColumn ||
    (a.style === b.style ? 0 : a.style === 'bar' ? -1 : 1) ||
    a.source.order - b.source.order
  );
}

/**
 * Sorts `items` and gives each the lowest lane free in all of its columns
 * (§5.3 Month step 2). Returns the number of lanes used.
 */
function assignLanes(items: LaneWork[], columnCount: number): number {
  items.sort(compareLaneWork);
  const used: boolean[][] = Array.from({ length: columnCount }, () => []);
  const firstFree: number[] = new Array<number>(columnCount).fill(0);
  let laneCount = 0;
  for (const item of items) {
    // A lane free in every column is at least each column's lowest free lane.
    let lane = 0;
    for (let c = item.startColumn; c <= item.endColumn; c++) lane = Math.max(lane, firstFree[c]!);
    search: for (; ; lane++) {
      for (let c = item.startColumn; c <= item.endColumn; c++) if (used[c]![lane]) continue search;
      break;
    }
    item.lane = lane;
    for (let c = item.startColumn; c <= item.endColumn; c++) {
      const column = used[c]!;
      column[lane] = true;
      while (column[firstFree[c]!]) firstFree[c]!++;
    }
    laneCount = Math.max(laneCount, lane + 1);
  }
  return laneCount;
}

/** §5.3 Month step 3: visible lanes and hidden counts per column. */
function laneVisibility(
  items: readonly LaneWork[],
  columnCount: number,
  laneCount: number,
  maxLanes: number | null,
): { visibleLanes: number[]; hidden: number[] } {
  if (maxLanes === null) {
    return { visibleLanes: new Array<number>(columnCount).fill(laneCount), hidden: new Array<number>(columnCount).fill(0) };
  }
  const highest: number[] = new Array<number>(columnCount).fill(-1);
  const atOrBeyondLast: number[] = new Array<number>(columnCount).fill(0);
  for (const item of items) {
    for (let c = item.startColumn; c <= item.endColumn; c++) {
      if (item.lane > highest[c]!) highest[c] = item.lane;
      if (item.lane >= maxLanes - 1) atOrBeyondLast[c]!++;
    }
  }
  const visibleLanes: number[] = [];
  const hidden: number[] = [];
  for (let c = 0; c < columnCount; c++) {
    const fits = highest[c]! < maxLanes;
    visibleLanes.push(fits ? maxLanes : maxLanes - 1);
    hidden.push(fits ? 0 : atOrBeyondLast[c]!);
  }
  return { visibleLanes, hidden };
}

function toMonthItem(work: LaneWork): MonthItem {
  return {
    key: work.source.key,
    style: work.style,
    startColumn: work.startColumn,
    endColumn: work.endColumn,
    lane: work.lane,
    continuesBefore: work.continuesBefore,
    continuesAfter: work.continuesAfter,
  };
}

// ---------------------------------------------------------------------------
// Month
// ---------------------------------------------------------------------------

/**
 * The Gregorian weekday of each column of 13-month month `month` of Gregorian
 * year `year` (7 entries, column 0 first): the weekday of month day `c + 1`,
 * which month days `c + 8`, `c + 15` and `c + 22` share because no
 * intercalary day lies inside a month (§2.4 header line 2, §5.3 step 5). The
 * 13-month date picker uses it too. IFC October 2026: Thursday to Wednesday,
 * `[4, 5, 6, 0, 1, 2, 3]`.
 * @throws RangeError for an invalid year, month or system.
 */
export function monthColumnGregorianWeekdays(
  year: number,
  month: number,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): Weekday[] {
  const system = getCalendarSystem(systemId);
  return monthDays(year, month, system.id)
    .slice(0, DAYS_PER_WEEK)
    .map((date) => gregorianWeekday(date));
}

/**
 * Lays out `occurrences` on 13-month month `month` of Gregorian year `year`
 * (§2.4, §5.3 "Month lanes"):
 *
 * 1. Bars (all-day, or 24 hours or more) become one item per week row they
 *    touch, clipped to the row, plus one per intercalary band they touch;
 *    shorter timed occurrences become a dot on each day they touch.
 *    `continuesBefore` / `continuesAfter` mark items whose occurrence extends
 *    past their first or last column. Occurrences outside the month and its
 *    bands are ignored.
 * 2. Each row (and each band, with one column) sorts its items by clipped
 *    start column, bars before dots, then the order key, and gives each the
 *    lowest lane free in all of its columns.
 * 3. With `maxLanes`, a column whose highest lane is below `maxLanes` shows
 *    `maxLanes` lanes; otherwise it shows `maxLanes - 1` and reports in
 *    `hidden` how many of its items have a lane of `maxLanes - 1` or more
 *    (the platform draws "+{hidden} more" in the last lane, and draws a bar
 *    only in the columns where its lane is visible). Unlimited (the default):
 *    every column shows the lanes its row uses.
 * 4. The bands are the intercalary days with `afterMonth === month`.
 * @throws RangeError for an invalid year, month, system, occurrence, repeated
 * key or options bag (`maxLanes` must be an integer 1 or more).
 */
export function layoutThirteenMonthEvents(
  year: number,
  month: number,
  occurrences: readonly EventOccurrence[],
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
  options?: { maxLanes?: number },
): ThirteenMonthEventLayout {
  const context = 'layoutThirteenMonthEvents';
  const system = getCalendarSystem(systemId);
  const days = monthDays(year, month, system.id);
  const bag = readOptions(options, ['maxLanes'], context);
  const maxLanes = readIntegerOption(bag, 'maxLanes', context, 1);
  const prepared = prepareOccurrences(occurrences, context);
  const firstDay = toJulianDayNumber(days[0]!);

  const weeks: MonthWeekRow[] = [];
  for (let w = 0; w < WEEKS_PER_MONTH; w++) {
    const rowFirst = firstDay + w * DAYS_PER_WEEK;
    const work: LaneWork[] = [];
    for (const p of prepared) collectLaneItems(p, rowFirst, rowFirst + DAYS_PER_WEEK - 1, true, work);
    const laneCount = assignLanes(work, DAYS_PER_WEEK);
    const { visibleLanes, hidden } = laneVisibility(work, DAYS_PER_WEEK, laneCount, maxLanes);
    weeks.push({ week: (w + 1) as 1 | 2 | 3 | 4, items: work.map(toMonthItem), visibleLanes, hidden });
  }

  const intercalary: IntercalaryBand[] = [];
  for (const occurrence of intercalaryDaysInYear(year, system.id)) {
    if (occurrence.afterMonth !== month) continue;
    const day = toJulianDayNumber(occurrence.gregorian);
    const work: LaneWork[] = [];
    for (const p of prepared) collectLaneItems(p, day, day, true, work);
    const laneCount = assignLanes(work, 1);
    const { visibleLanes, hidden } = laneVisibility(work, 1, laneCount, maxLanes);
    intercalary.push({
      id: occurrence.id,
      gregorian: occurrence.gregorian,
      items: work.map(toMonthItem),
      visibleLanes: visibleLanes[0]!,
      hidden: hidden[0]!,
    });
  }

  return {
    year,
    month,
    system: system.id,
    columnGregorianWeekdays: days.slice(0, DAYS_PER_WEEK).map((date) => gregorianWeekday(date)),
    weeks,
    intercalary,
  };
}

// ---------------------------------------------------------------------------
// Week and Day timelines
// ---------------------------------------------------------------------------

/** A timed item being placed on a timeline column. */
interface TimedWork {
  readonly source: Prepared;
  readonly column: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly effectiveEnd: number;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
  slot: number;
  slotCount: number;
  hidden: boolean;
}

/** The part of a dot occurrence `p` on day `day` (Julian Day Number), if it touches it. */
function timedPart(p: Prepared, day: number, column: number, minDuration: number): TimedWork | null {
  if (p.bar || p.lastDay < day || p.firstDay > day) return null;
  const dayStart = day * DAY;
  const startMinute = Math.max(p.start, dayStart) - dayStart;
  const endMinute = Math.min(p.end, dayStart + DAY) - dayStart;
  return {
    source: p,
    column,
    startMinute,
    endMinute,
    effectiveEnd: Math.max(endMinute, startMinute + minDuration),
    clippedStart: p.start < dayStart,
    clippedEnd: p.end > dayStart + DAY,
    slot: 0,
    slotCount: 1,
    hidden: false,
  };
}

function compareTimedWork(a: TimedWork, b: TimedWork): number {
  return (
    a.startMinute - b.startMinute ||
    b.endMinute - b.startMinute - (a.endMinute - a.startMinute) ||
    a.source.order - b.source.order
  );
}

/**
 * §5.3 timeline steps 4 and 5 for one column: sorts `items`, groups them in
 * overlap clusters, gives each a slot, and hides what does not fit in
 * `maxSlots`. Appends to `timed` and `overflow`.
 */
function layoutColumn(items: TimedWork[], options: TimelineOptions, timed: TimedItem[], overflow: TimedOverflow[]): void {
  items.sort(compareTimedWork);
  let cluster: TimedWork[] = [];
  let slotEnds: number[] = [];
  let clusterEnd = 0;

  const flush = () => {
    if (cluster.length === 0) return;
    const slotCount = slotEnds.length;
    const { maxSlots } = options;
    const overflows = maxSlots !== null && slotCount > maxSlots;
    const hiddenItems: TimedWork[] = [];
    for (const item of cluster) {
      item.slotCount = slotCount;
      if (overflows && item.slot > maxSlots - 2) {
        item.hidden = true;
        hiddenItems.push(item);
      } else if (overflows) {
        item.slotCount = maxSlots;
      }
      timed.push({
        key: item.source.key,
        column: item.column,
        startMinute: item.startMinute,
        endMinute: item.endMinute,
        clippedStart: item.clippedStart,
        clippedEnd: item.clippedEnd,
        slot: item.slot,
        slotCount: item.slotCount,
        hidden: item.hidden,
      });
    }
    if (overflows) {
      overflow.push({
        column: cluster[0]!.column,
        slot: maxSlots - 1,
        slotCount: maxSlots,
        startMinute: Math.min(...hiddenItems.map((item) => item.startMinute)),
        endMinute: Math.max(...hiddenItems.map((item) => item.effectiveEnd)),
        keys: hiddenItems.sort((a, b) => a.source.order - b.source.order).map((item) => item.source.key),
      });
    }
    cluster = [];
    slotEnds = [];
  };

  for (const item of items) {
    if (cluster.length > 0 && item.startMinute >= clusterEnd) flush();
    let slot = slotEnds.findIndex((end) => end <= item.startMinute);
    if (slot < 0) slot = slotEnds.length;
    slotEnds[slot] = item.effectiveEnd;
    item.slot = slot;
    clusterEnd = cluster.length === 0 ? item.effectiveEnd : Math.max(clusterEnd, item.effectiveEnd);
    cluster.push(item);
  }
  flush();
}

/**
 * Lays out the 13-month week `week` (1 to 4) of month `month` of Gregorian
 * year `year` for Week mode (§2.5, §5.3 "Week and day timeline"):
 *
 * 1. Columns: the week's 7 days, plus for week 4 the intercalary days with
 *    `afterMonth === month` (IFC June of a leap year and December: 8 columns;
 *    Positivist Bichat of a leap year: 9).
 * 2. All-day row: bars (all-day, or 24 hours or more) over the columns, in
 *    lanes as in Month (no lane limit).
 * 3. Timeline: every shorter timed occurrence, clipped to each day it
 *    touches. Per column, items sort by start minute, then longer first, then
 *    the order key. With effective end = `max(endMinute, startMinute +
 *    minDurationMinutes)` (default 15), an item joins the current cluster
 *    while it starts before the cluster's latest effective end, and takes the
 *    first slot whose last item ends (effectively) at or before its start, else
 *    a new slot; `slotCount` is the cluster's number of slots.
 * 4. With `maxSlots` (default unlimited), a cluster with more slots keeps
 *    slots `0…maxSlots - 2` visible (with `slotCount = maxSlots`), hides every
 *    other item, and adds one {@link TimedOverflow} in slot `maxSlots - 1`.
 * Times are wall clock: a DST day is drawn on a 24-hour axis.
 * @throws RangeError for an invalid year, month, week, system, occurrence,
 * repeated key or options bag (`minDurationMinutes` 0 to 1440, `maxSlots` 1
 * or more).
 */
export function layoutThirteenWeekEvents(
  year: number,
  month: number,
  week: 1 | 2 | 3 | 4,
  occurrences: readonly EventOccurrence[],
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
  options?: { minDurationMinutes?: number; maxSlots?: number },
): WeekEventLayout {
  const context = 'layoutThirteenWeekEvents';
  const system = getCalendarSystem(systemId);
  const days = monthDays(year, month, system.id);
  if (!isInteger(week) || week < 1 || week > WEEKS_PER_MONTH) fail(`${context}: week must be 1, 2, 3 or 4, got ${show(week)}`);
  const timeline = readTimelineOptions(options, context);
  const prepared = prepareOccurrences(occurrences, context);

  const columns: WeekColumn[] = [];
  for (let d = 0; d < DAYS_PER_WEEK; d++) {
    const day = (week - 1) * DAYS_PER_WEEK + d + 1;
    columns.push({
      kind: 'day',
      gregorian: days[day - 1]!,
      thirteen: { kind: 'month', system: system.id, year, month, day },
    });
  }
  if (week === WEEKS_PER_MONTH) {
    for (const occurrence of intercalaryDaysInYear(year, system.id)) {
      if (occurrence.afterMonth !== month) continue;
      columns.push({ kind: 'intercalary', gregorian: occurrence.gregorian, thirteen: occurrence.thirteen });
    }
  }
  // The columns are consecutive days: day 28 of a month is followed by its intercalary days.
  const first = toJulianDayNumber(columns[0]!.gregorian);
  const last = first + columns.length - 1;

  const bars: LaneWork[] = [];
  for (const p of prepared) collectLaneItems(p, first, last, false, bars);
  assignLanes(bars, columns.length);

  const timed: TimedItem[] = [];
  const overflow: TimedOverflow[] = [];
  for (let c = 0; c < columns.length; c++) {
    const items: TimedWork[] = [];
    for (const p of prepared) {
      const part = timedPart(p, first + c, c, timeline.minDuration);
      if (part !== null) items.push(part);
    }
    layoutColumn(items, timeline, timed, overflow);
  }
  return { columns, allDay: bars.map(toMonthItem), timed, overflow };
}

/**
 * Lays out one day for Day mode (§2.6, §5.3): `allDay` lists the keys of the
 * bars (all-day, or 24 hours or more) that touch `date`, in order-key order;
 * `timed` and `overflow` are the timeline of {@link layoutThirteenWeekEvents}
 * with a single column (column 0).
 * @throws RangeError for an invalid date, occurrence, repeated key or options
 * bag (`minDurationMinutes` 0 to 1440, `maxSlots` 1 or more).
 */
export function layoutDayEvents(
  date: GregorianDate,
  occurrences: readonly EventOccurrence[],
  options?: { minDurationMinutes?: number; maxSlots?: number },
): { allDay: string[]; timed: TimedItem[]; overflow: TimedOverflow[] } {
  const context = 'layoutDayEvents';
  assertValidGregorian(date);
  const timeline = readTimelineOptions(options, context);
  const prepared = prepareOccurrences(occurrences, context);
  const day = toJulianDayNumber(date);
  const allDay: string[] = [];
  const items: TimedWork[] = [];
  for (const p of prepared) {
    if (p.lastDay < day || p.firstDay > day) continue;
    if (p.bar) allDay.push(p.key);
    else items.push(timedPart(p, day, 0, timeline.minDuration)!);
  }
  const timed: TimedItem[] = [];
  const overflow: TimedOverflow[] = [];
  layoutColumn(items, timeline, timed, overflow);
  return { allDay, timed, overflow };
}

/**
 * Month chip time (§2.19): 24-hour `HH:MM` (`09:30`); 12-hour the hour
 * without a leading zero, `:MM` only when the minutes are not 0, then `a` or
 * `p` (`9:30a`, `2p`; noon `12p`, midnight `12a`).
 * @param minute a start time, `0…1439`.
 * @throws RangeError for a minute outside `0…1439` or a non-boolean `use24Hour`.
 */
export function formatChipTime(minute: number, use24Hour: boolean): string {
  if (!isInteger(minute) || minute < 0 || minute >= DAY) fail(`Chip time minute must be an integer 0..1439, got ${show(minute)}`);
  if (typeof use24Hour !== 'boolean') fail(`use24Hour must be a boolean, got ${show(use24Hour)}`);
  const hour = Math.floor(minute / 60);
  const minutes = minute % 60;
  if (use24Hour) return `${pad(hour, 2)}:${pad(minutes, 2)}`;
  const clockHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${clockHour}${minutes === 0 ? '' : `:${pad(minutes, 2)}`}${hour < 12 ? 'a' : 'p'}`;
}

// ---------------------------------------------------------------------------
// Agenda and Year marks
// ---------------------------------------------------------------------------

interface AgendaWork {
  readonly item: AgendaItem;
  readonly order: number;
  /** 0: all-day items and middle parts; 1: parts with a start time. */
  readonly group: 0 | 1;
}

function compareAgendaWork(a: AgendaWork, b: AgendaWork): number {
  return (
    a.group - b.group ||
    (a.group === 1 ? a.item.startMinute! - b.item.startMinute! : 0) ||
    a.order - b.order
  );
}

function agendaPart(p: Prepared, day: number): AgendaWork {
  const dayCount = p.lastDay - p.firstDay + 1;
  const dayIndex = day - p.firstDay + 1;
  const part = dayCount === 1 ? 'single' : dayIndex === 1 ? 'first' : dayIndex === dayCount ? 'last' : 'middle';
  if (p.allDay || part === 'middle') {
    return { item: { key: p.key, part, dayIndex, dayCount, startMinute: null, endMinute: null }, order: p.order, group: 0 };
  }
  const dayStart = day * DAY;
  const startMinute = Math.max(p.start, dayStart) - dayStart;
  const endMinute = Math.min(p.end, dayStart + DAY) - dayStart;
  return { item: { key: p.key, part, dayIndex, dayCount, startMinute, endMinute }, order: p.order, group: 1 };
}

/**
 * The agenda from `from` to `to` (inclusive) for List mode, Up next and Month
 * at accessibility sizes (§2.4, §2.7, §2.8, §5.3 "Agenda"): one
 * {@link AgendaDay} per date that has items (every date with
 * `includeEmptyDays`, default `false`). Each occurrence appears on every day it
 * touches as a `single`, `first`, `middle` or `last` part with its `dayIndex`
 * of `dayCount` and its start and end minutes on that day (`null` for all-day
 * occurrences and middle parts). Items: all-day items and middle parts first
 * (order key), then by start minute, then the order key.
 * @throws RangeError for invalid dates, `to` before `from`, an invalid system,
 * occurrence, repeated key or options bag.
 */
export function agenda(
  occurrences: readonly EventOccurrence[],
  from: GregorianDate,
  to: GregorianDate,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
  options?: { includeEmptyDays?: boolean },
): AgendaDay[] {
  const context = 'agenda';
  assertValidGregorian(from);
  assertValidGregorian(to);
  const system = getCalendarSystem(systemId);
  const bag = readOptions(options, ['includeEmptyDays'], context);
  const includeEmptyDays = readBooleanOption(bag, 'includeEmptyDays', context) ?? false;
  const first = toJulianDayNumber(from);
  const last = toJulianDayNumber(to);
  if (last < first) fail(`${context}: to (${show(to)}) is before from (${show(from)})`);
  const prepared = prepareOccurrences(occurrences, context);

  const byDay = new Map<number, AgendaWork[]>();
  for (const p of prepared) {
    const end = Math.min(p.lastDay, last);
    for (let day = Math.max(p.firstDay, first); day <= end; day++) {
      const list = byDay.get(day);
      if (list === undefined) byDay.set(day, [agendaPart(p, day)]);
      else list.push(agendaPart(p, day));
    }
  }

  const dayNumbers = includeEmptyDays
    ? Array.from({ length: last - first + 1 }, (_, i) => first + i)
    : [...byDay.keys()].sort((a, b) => a - b);
  return dayNumbers.map((day) => {
    const gregorian = fromJulianDayNumber(day);
    const items = (byDay.get(day) ?? []).sort(compareAgendaWork).map((work) => work.item);
    return { gregorian, thirteen: toThirteen(gregorian, system.id), items };
  });
}

/**
 * Event marks for Gregorian year `year` (§2.3, §2.4 dots density, §5.3 "Year
 * marks"): for each day covered by at least one occurrence, ascending, the
 * number of occurrences covering it and the distinct calendar ids of those
 * occurrences in order-key order, at most `maxCalendars` (default 3; 0 gives
 * counts only).
 * @throws RangeError for an invalid year, occurrence, repeated key or options
 * bag (`maxCalendars` an integer 0 or more).
 */
export function yearEventMarks(
  year: number,
  occurrences: readonly EventOccurrence[],
  options?: { maxCalendars?: number },
): YearMark[] {
  const context = 'yearEventMarks';
  assertValidYear(year);
  const bag = readOptions(options, ['maxCalendars'], context);
  const maxCalendars = readIntegerOption(bag, 'maxCalendars', context, 0) ?? 3;
  const prepared = prepareOccurrences(occurrences, context);
  const first = toJulianDayNumber({ year, month: 1, day: 1 });
  const last = toJulianDayNumber({ year, month: 12, day: 31 });

  const counts: number[] = new Array<number>(last - first + 1).fill(0);
  const calendars: string[][] = Array.from({ length: last - first + 1 }, () => []);
  for (const p of prepared) {
    const end = Math.min(p.lastDay, last);
    for (let day = Math.max(p.firstDay, first); day <= end; day++) {
      const index = day - first;
      counts[index]!++;
      const ids = calendars[index]!;
      if (ids.length < maxCalendars && !ids.includes(p.calendarId)) ids.push(p.calendarId);
    }
  }

  const marks: YearMark[] = [];
  for (let index = 0; index < counts.length; index++) {
    if (counts[index] === 0) continue;
    marks.push({
      dayOfYear: index + 1,
      gregorian: fromJulianDayNumber(first + index),
      count: counts[index]!,
      calendarIds: calendars[index]!,
    });
  }
  return marks;
}
