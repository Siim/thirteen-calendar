/**
 * The series pipeline every self-expanding platform uses (docs/EVENTS.md §4.6,
 * §5.2): {@link expandSeries} turns one stored series (its master, recurrence
 * and overrides) into the occurrences a device shows in a window of its own
 * wall clock. Android uses it for the series the provider cannot expand
 * (§6.3), Windows and the web for everything (through `eventsFromCalendar`,
 * §5.4); no platform re-implements a step of it.
 * @module
 */

import { type GregorianDate, MAX_JULIAN_DAY_NUMBER, MIN_JULIAN_DAY_NUMBER, assertValidGregorian, toJulianDayNumber } from '../gregorian.ts';
import { fail, isInteger, isRecord, readOptions, show } from '../internal.ts';
import { type EventRecurrence, type ExtraDate, type OriginalDate, assertExpandable, expandDays } from './recurrence.ts';
import { civilOf } from './rrule-expansion.ts';
import {
  type LocalDateTime,
  type OffsetMemo,
  type ZoneResolver,
  EARLIEST_ABSOLUTE,
  LATEST_END_ABSOLUTE,
  assertKnownZone,
  assertValidLocalDateTime,
  fromAbsoluteMinutes,
  offsetMemo,
  toAbsoluteMinutes,
  utcToZonedAbsolute,
  zonedToUtcAbsolute,
  zonedToUtcSteady,
} from './time.ts';

/** One stored override (changed or canceled occurrence) of a series, whatever its date. */
export interface OverrideInput {
  /** The platform's handle: override `UID|RECURRENCE-ID`, exception row `_ID`. */
  readonly id: string;
  /** `RECURRENCE-ID` / `ORIGINAL_INSTANCE_TIME` date in the series' zone. */
  readonly originalDate: GregorianDate;
  /** `null`: at the master's start time; else an extra date's own time. */
  readonly originalMinute: number | null;
  readonly canceled: boolean;
  readonly allDay: boolean;
  /** In `zone`, end-of-day form. */
  readonly start: LocalDateTime;
  readonly end: LocalDateTime;
  /** `null`: floating. */
  readonly zone: string | null;
}

/** A stored series: its master, recurrence and every override. */
export interface SeriesInput {
  readonly id: string;
  /** `null`: a single event (still converted and windowed). */
  readonly recurrence: EventRecurrence | null;
  readonly allDay: boolean;
  /** The master, in `zone`. */
  readonly start: LocalDateTime;
  readonly end: LocalDateTime;
  readonly zone: string | null;
  /** All of them, whatever their dates. */
  readonly overrides: readonly OverrideInput[];
  /**
   * The master's length when RFC 5545 text gives it as `DURATION` (§5.4): every
   * timed occurrence ends `days` days after its start on the wall clock of the
   * series' zone (a week is 7 days), then `minutes` later exactly, so `P1D`
   * ends at the same wall-clock time on the next day also across a daylight
   * saving change (RFC 5545 §3.3.6, §3.8.5.3). `end` is still the master's
   * end (its first occurrence's). Absent or null: every occurrence lasts the
   * master's exact length, `end` minus `start` as instants (§3.3), as for
   * `DTEND` and for Android's `DURATION`, which its provider reads exactly.
   * Ignored for all-day series and for extra dates with their own length.
   */
  readonly duration?: { readonly days: number; readonly minutes: number } | null;
}

/** One occurrence in the device's wall clock. */
export interface ExpandedOccurrence {
  /** Part of the occurrence key (§3.2). */
  readonly originalDate: GregorianDate;
  /** As in {@link OverrideInput}; part of the key when not null. */
  readonly originalMinute: number | null;
  readonly overrideId: string | null;
  readonly allDay: boolean;
  /** DEVICE wall clock, end-of-day form. */
  readonly start: LocalDateTime;
  readonly end: LocalDateTime;
  /**
   * The start instant as a UTC wall clock, for a timed occurrence; `null` for
   * an all-day one. Alert planners pass it to `alarmFireTime` (§2.14): the
   * device wall clock `start` cannot be turned back into it in the repeated
   * hour of a fall-back night.
   */
  readonly startUtc: LocalDateTime | null;
}

/** A window of the device's wall clock, `[from, to)`; `to` may be `9999-12-31T24:00`. */
export interface DeviceWindow {
  readonly from: LocalDateTime;
  readonly to: LocalDateTime;
}

/** Largest `limit`: every port holds it in a 32-bit signed integer. */
const MAX_INT = 2_147_483_647;
const DAY = 1440;
/** Largest `duration.days` (and `duration.minutes` in days): the whole range of years 1 to 9999. */
const MAX_DURATION_DAYS = 3_652_059;

const isMinute = (value: unknown): boolean => isInteger(value) && value >= 0 && value < DAY;
const jdn = (date: GregorianDate): number => toJulianDayNumber(date);
const key = (day: number, minute: number | null): number => day * 1441 + (minute ?? -1) + 1;

function assertZone(zone: unknown, zones: ZoneResolver, context: string): asserts zone is string | null {
  if (zone === null) return;
  try {
    assertKnownZone(zone, zones);
  } catch (error) {
    fail(`${context}: ${(error as Error).message}`);
  }
}

function assertTimes(value: Record<string, unknown>, context: string): void {
  assertValidLocalDateTime(value.start, `${context} start`, false);
  assertValidLocalDateTime(value.end, `${context} end`);
  if (toAbsoluteMinutes(value.end) < toAbsoluteMinutes(value.start)) {
    fail(`Invalid ${context}: the end is before the start`);
  }
  if (typeof value.allDay !== 'boolean') fail(`${context} allDay must be a boolean, got ${show(value.allDay)}`);
}

function assertSeries(value: unknown, zones: ZoneResolver): asserts value is SeriesInput {
  if (!isRecord(value)) fail(`Series must be an object, got ${show(value)}`);
  if (typeof value.id !== 'string') fail(`Series id must be a string, got ${show(value.id)}`);
  if (value.recurrence !== null) assertExpandable(value.recurrence);
  assertTimes(value, 'series');
  assertZone(value.zone, zones, 'series zone');
  if (!Array.isArray(value.overrides)) fail(`Series overrides must be an array, got ${show(value.overrides)}`);
  for (const o of value.overrides as unknown[]) {
    if (!isRecord(o)) fail(`Overrides must be objects, got ${show(o)}`);
    if (typeof o.id !== 'string') fail(`Override id must be a string, got ${show(o.id)}`);
    assertValidGregorian(o.originalDate);
    if (o.originalMinute !== null && !isMinute(o.originalMinute)) fail(`Override originalMinute must be 0..1439 or null, got ${show(o.originalMinute)}`);
    if (typeof o.canceled !== 'boolean') fail(`Override canceled must be a boolean, got ${show(o.canceled)}`);
    assertTimes(o, `override ${show(o.id)}`);
    assertZone(o.zone, zones, `override ${show(o.id)} zone`);
  }
  const duration = value.duration;
  if (duration !== undefined && duration !== null) {
    const part = (n: unknown, max: number) => isInteger(n) && n >= 0 && n <= max;
    if (!isRecord(duration) || !part(duration.days, MAX_DURATION_DAYS) || !part(duration.minutes, MAX_DURATION_DAYS * DAY)) {
      fail(`Series duration must be { days: 0..${MAX_DURATION_DAYS}, minutes: 0..${MAX_DURATION_DAYS * DAY} } or null, got ${show(duration)}`);
    }
  }
}

/**
 * Reads every own minute of a series as the occurrence it names (§4.6 steps 3
 * and 4): `null` (the master's) when it is the master's start minute, or when
 * it names the same instant as the master's start time on that date; the
 * extra date's own minute when it names that extra date's instant; else the
 * minute itself. Two wall-clock times name one instant only around a daylight
 * saving gap: the master at 02:30 on a spring-forward night starts at 03:30,
 * and a `RECURRENCE-ID` or `EXDATE` naming that instant (in UTC, or as 03:30
 * local) reads back as 03:30. An all-day series has no own minutes.
 */
class OwnMinutes {
  private readonly own = new Map<number, number[]>();
  private readonly instant: (local: number) => number;
  private readonly allDay: boolean;
  private readonly startMinute: number;

  constructor(allDay: boolean, startMinute: number, instant: (local: number) => number) {
    this.allDay = allDay;
    this.startMinute = startMinute;
    this.instant = instant;
  }

  /** The minute an extra date's own minute stands for; a new own minute is remembered for later values. */
  extra(day: number, minute: number | null): number | null {
    const read = this.read(day, minute);
    if (read !== null) {
      const list = this.own.get(day);
      if (list === undefined) this.own.set(day, [read]);
      else if (!list.includes(read)) list.push(read);
    }
    return read;
  }

  /** The minute an excluded date's or override's own minute stands for. */
  read(day: number, minute: number | null): number | null {
    if (this.allDay || minute === null || minute === this.startMinute) return null;
    const at = this.instant(day * DAY + minute);
    if (at === this.instant(day * DAY + this.startMinute)) return null;
    for (const own of this.own.get(day) ?? []) {
      if (own === minute || at === this.instant(day * DAY + own)) return own;
    }
    return minute;
  }
}

/** The recurrence with every own minute read by `minutes` ({@link OwnMinutes}; extra dates first). */
function normalized(recurrence: EventRecurrence, minutes: OwnMinutes): EventRecurrence {
  return {
    ...recurrence,
    extraDates: recurrence.extraDates.map(
      (x): ExtraDate => ({ date: x.date, minute: minutes.extra(jdn(x.date), x.minute), durationMinutes: x.durationMinutes }),
    ),
    exceptDates: recurrence.exceptDates.map((x): OriginalDate => ({ date: x.date, minute: minutes.read(jdn(x.date), x.minute) })),
  };
}

/** A placed occurrence, in absolute device minutes (`utc`: its start instant; null for all-day). */
interface Placed {
  readonly day: number;
  readonly minute: number | null;
  readonly overrideId: string | null;
  readonly allDay: boolean;
  readonly start: number;
  readonly end: number;
  readonly utc: number | null;
}

/**
 * Expands one series into the occurrences that overlap a window of the
 * device's wall clock (§4.6), in six steps:
 *
 * 1. **Widen**: the event-zone dates from the window's first date minus (the longest
 *    length in days + 2) to its last date plus 2, within years 1 to 9999, the
 *    longest length being the larger of the master's and the longest extra
 *    date's own length. This catches occurrences that began before the window
 *    and those whose event-zone and device dates fall in different years.
 * 2. **Expand** with `expandRecurrence` (a single event is its start).
 * 3. **Times**: each original date at the master's start minute (or the extra
 *    date's own) becomes an instant through `zonedToUtc` in the event's zone
 *    (floating events: the device's zone) and ends after the master's exact
 *    length (`end` minus `start` as instants, both through that zone; the
 *    extra date's own length when it has one), or, with `series.duration`,
 *    its nominal days on the wall clock plus its exact minutes. All-day
 *    occurrences keep their dates and day count.
 * 4. **Overrides** match generated occurrences by original date and minute
 *    (a minute equal to the master's start minute counts as null, and so does
 *    one that names the same instant as the master's start time on that date,
 *    which happens only around a daylight saving gap; excluded dates are read
 *    the same way). A canceled
 *    override removes its occurrence; any other replaces it at its own start
 *    and end, converted from its own zone. An override whose occurrence lies
 *    outside the widened range is checked against the rule for its date alone,
 *    so one moved into the window from far away appears. An override whose
 *    occurrence the recurrence does not produce (an orphan) is shown as a
 *    single event at its own time (unless canceled) and its id is reported in
 *    `orphans`; so is a second override of an occurrence already taken, which
 *    is not shown.
 * 5. **Device wall clock**: every occurrence is converted to `deviceZone`; one
 *    whose start leaves years 1 to 9999 is dropped and counted in
 *    `outOfRange`, and an end after `9999-12-31T24:00` stops there. So is a
 *    timed occurrence whose instant (UTC) leaves years 1 to 9999, also when
 *    the device is in the event's zone (`zonedToUtc` has no answer for it):
 *    23:00 on 9999-12-31 in New York is dropped on every device.
 * 6. **Window**: the occurrences that overlap the window `[from, to)` (a
 *    zero-length occurrence: whose start lies in it), sorted by start, then
 *    original date and minute. Each timed occurrence also carries its start
 *    instant (`startUtc`) for alert planning.
 *
 * Extra dates, excluded dates and overrides whose own minute equals the
 * master's start minute are read as the master's (minute null); an all-day
 * series has no own minutes (an extra date's own length counts in whole days).
 * A timed occurrence whose device end falls before its start (a short event
 * across a fall-back hour) ends at its start. `truncated` and `unsupported` come from the
 * expansion; an unsupported recurrence (§4.6 step 6) shows only its master's
 * first occurrence, with its overrides ignored.
 * @throws RangeError for an invalid series, window, zone, resolver or limit.
 */
export function expandSeries(
  series: SeriesInput,
  range: DeviceWindow,
  deviceZone: string,
  zones: ZoneResolver,
  options?: { limit?: number },
): { occurrences: ExpandedOccurrence[]; orphans: string[]; outOfRange: number; truncated: boolean; unsupported: boolean } {
  assertKnownZone(deviceZone, zones);
  assertSeries(series, zones);
  if (!isRecord(range)) fail(`Device window must be { from, to }, got ${show(range)}`);
  assertValidLocalDateTime(range.from, 'window from');
  assertValidLocalDateTime(range.to, 'window to');
  const windowFrom = toAbsoluteMinutes(range.from);
  const windowTo = toAbsoluteMinutes(range.to);
  if (windowTo < windowFrom) fail('Device window ends before it starts');
  const opts = readOptions(options, ['limit'], 'expandSeries');
  const limit = opts.limit ?? 10_000;
  if (!isInteger(limit) || limit < 1 || limit > MAX_INT) fail(`expandSeries option 'limit' must be an integer 1..${MAX_INT}, got ${show(limit)}`);

  const allDay = series.allDay;
  const startMinute = allDay ? 0 : series.start.minute;
  const masterStart = toAbsoluteMinutes(series.start);
  const masterEnd = toAbsoluteMinutes(series.end);
  const eventZone = series.zone ?? deviceZone;
  const startDay = jdn(series.start.date);
  // All-day: whole days, at least one. Timed: the exact length between the two instants (§3.3), floating
  // ones through the device's zone like their starts.
  const masterDays = Math.max(1, Math.ceil((masterEnd - masterStart) / DAY));
  const masterLength = allDay
    ? masterDays * DAY
    : Math.max(0, zonedToUtcAbsolute(masterEnd, eventZone, zones) - zonedToUtcAbsolute(masterStart, eventZone, zones));
  const nominal = allDay || series.duration === undefined || series.duration === null ? null : series.duration;

  // The generated occurrences convert many nearby times in one zone (and, when it differs, the device's).
  const eventMemo = offsetMemo(eventZone);
  const deviceMemo = eventZone === deviceZone ? eventMemo : offsetMemo(deviceZone);
  const ownMinutes = new OwnMinutes(allDay, startMinute, (local) => zonedToUtcSteady(local, eventZone, zones, eventMemo).utc);
  const recurrence = series.recurrence === null ? null : normalized(series.recurrence, ownMinutes);
  const overrides = series.overrides.map((o): OverrideInput => {
    const minute = ownMinutes.read(jdn(o.originalDate), o.originalMinute);
    return minute === o.originalMinute ? o : { ...o, originalMinute: minute };
  });
  const checkMinute = allDay ? null : startMinute;
  const orphans: string[] = [];
  let outOfRange = 0;
  const placed: Placed[] = [];

  /**
   * Keeps an occurrence given in device minutes when it overlaps the window
   * (step 6), or counts it as out of range (step 5); the end stops at
   * 9999-12-31T24:00.
   */
  const keep = (day: number, minute: number | null, overrideId: string | null, utc: number | null, start: number, rawEnd: number): void => {
    if (start < EARLIEST_ABSOLUTE || start >= LATEST_END_ABSOLUTE) {
      outOfRange++;
      return;
    }
    const end = Math.min(Math.max(rawEnd, start), LATEST_END_ABSOLUTE);
    const inWindow = start === end ? start >= windowFrom && start < windowTo : start < windowTo && end > windowFrom;
    if (inWindow) placed.push({ day, minute, overrideId, allDay: utc === null, start, end, utc });
  };

  /** `true` (counted in `outOfRange`) when a timed occurrence's instant leaves years 1 to 9999: `zonedToUtc` has no answer for it (§4.6 steps 3 and 5). */
  const instantOutOfRange = (utcStart: number): boolean => {
    if (utcStart >= EARLIEST_ABSOLUTE && utcStart < LATEST_END_ABSOLUTE) return false;
    outOfRange++;
    return true;
  };

  /**
   * Keeps an occurrence that starts at a UTC instant and lasts `length`
   * minutes, in the device's wall clock. The device conversion runs before the
   * instant's range check, so the device zone is asked as for any other
   * occurrence (the recorded resolver of the fixtures knows exactly the zones
   * that were asked, §5.5).
   */
  const keepInstant = (day: number, minute: number | null, overrideId: string | null, utcStart: number, length: number, memo?: OffsetMemo): void => {
    const start = utcToZonedAbsolute(utcStart, deviceZone, zones, memo);
    if (instantOutOfRange(utcStart)) return;
    keep(day, minute, overrideId, utcStart, start, utcToZonedAbsolute(utcStart + length, deviceZone, zones, memo));
  };

  /** A generated occurrence at the master's times (or the extra date's own). */
  const placeGenerated = (day: number, minute: number | null, durationMinutes: number | null): void => {
    if (allDay) {
      const days = durationMinutes === null ? masterDays : Math.max(1, Math.ceil(durationMinutes / DAY));
      keep(day, minute, null, null, day * DAY, (day + days) * DAY);
      return;
    }
    const local = day * DAY + (minute ?? startMinute);
    const { utc, steady } = zonedToUtcSteady(local, eventZone, zones, eventMemo);
    let length = durationMinutes ?? masterLength;
    if (durationMinutes === null && nominal !== null) {
      // DURATION: its days on this occurrence's wall clock, then its exact minutes (RFC 5545 §3.3.6).
      length = Math.max(0, zonedToUtcSteady(local + nominal.days * DAY, eventZone, zones, eventMemo).utc + nominal.minutes - utc);
    }
    if (steady !== null && eventZone === deviceZone) {
      if (instantOutOfRange(utc)) return;
      // The offset is `steady` from `local` minus a day to `local` plus a day (UTC): no resolver call can change it.
      const end = utc + length;
      keep(day, minute, null, utc, local, end <= local + DAY ? end + steady : utcToZonedAbsolute(end, deviceZone, zones, deviceMemo));
      return;
    }
    keepInstant(day, minute, null, utc, length, deviceMemo);
  };

  /** An override at its own times, converted from its own zone (floating: the device's). */
  const placeOverride = (o: OverrideInput, day: number, minute: number | null): void => {
    const start = toAbsoluteMinutes(o.start);
    const end = toAbsoluteMinutes(o.end);
    if (o.allDay) {
      keep(day, minute, o.id, null, start, Math.max(end, start + DAY));
      return;
    }
    const zone = o.zone ?? deviceZone;
    const utcStart = zonedToUtcAbsolute(start, zone, zones);
    keepInstant(day, minute, o.id, utcStart, Math.max(0, zonedToUtcAbsolute(end, zone, zones) - utcStart));
  };

  let truncated = false;
  let unsupported = false;
  if (recurrence === null) {
    const produced = (day: number, minute: number | null) => day === startDay && minute === null;
    const taken = applyOverrides(overrides, produced, new Set([key(startDay, null)]), orphans, allDay, startMinute, placeOverride);
    if (!taken.has(key(startDay, null))) placeGenerated(startDay, null, null);
  } else {
    const longest = Math.max(masterLength, ...recurrence.extraDates.map((x) => x.durationMinutes ?? 0));
    const widen = Math.ceil(longest / DAY) + 2;
    const from = Math.max(jdn(range.from.date) - widen, MIN_JULIAN_DAY_NUMBER);
    const to = Math.min(jdn(range.to.date) + 2, MAX_JULIAN_DAY_NUMBER);
    const expansion = expandDays(recurrence, series.start.date, from, to, limit, checkMinute);
    truncated = expansion.truncated;
    unsupported = expansion.unsupported;
    if (unsupported) {
      for (const o of expansion.occurrences) placeGenerated(o.day, null, null);
    } else if (overrides.length === 0) {
      for (const o of expansion.occurrences) placeGenerated(o.day, o.minute, o.durationMinutes);
    } else {
      const generated = new Map(expansion.occurrences.map((o) => [key(o.day, o.minute), o] as const));
      const produced = (day: number, minute: number | null): boolean => {
        if (generated.has(key(day, minute))) return true;
        return expandDays(recurrence, series.start.date, day, day, limit, checkMinute).occurrences.some((o) => o.minute === minute);
      };
      const taken = applyOverrides(overrides, produced, new Set(generated.keys()), orphans, allDay, startMinute, placeOverride);
      for (const [k, o] of generated) if (!taken.has(k)) placeGenerated(o.day, o.minute, o.durationMinutes);
    }
  }

  placed.sort((a, b) => a.start - b.start || a.day - b.day || (a.minute ?? -1) - (b.minute ?? -1));
  const occurrences = placed.map((o): ExpandedOccurrence => {
    const startDate = Math.floor(o.start / DAY);
    const endsAtMidnight = o.end > o.start && o.end % DAY === 0;
    const endDate = endsAtMidnight ? o.end / DAY - 1 : Math.floor(o.end / DAY);
    return {
      originalDate: civilOf(o.day),
      originalMinute: o.minute,
      overrideId: o.overrideId,
      allDay: o.allDay,
      start: { date: civilOf(startDate), minute: o.start - startDate * DAY },
      end: { date: civilOf(endDate), minute: endsAtMidnight ? DAY : o.end - endDate * DAY },
      startUtc: o.utc === null ? null : fromAbsoluteMinutes(o.utc),
    };
  });
  return { occurrences, orphans, outOfRange, truncated, unsupported };
}

/**
 * Matches every override to its occurrence (step 4 of {@link expandSeries}):
 * places the replacements and orphans, records orphan ids, and returns the
 * keys of the generated occurrences the overrides took.
 */
function applyOverrides(
  overrides: readonly OverrideInput[],
  produced: (day: number, minute: number | null) => boolean,
  generated: ReadonlySet<number>,
  orphans: string[],
  allDay: boolean,
  startMinute: number,
  place: (o: OverrideInput, day: number, minute: number | null) => void,
): Set<number> {
  const taken = new Set<number>();
  const claimed = new Set<number>();
  for (const o of overrides) {
    const minute = allDay || o.originalMinute === startMinute ? null : o.originalMinute;
    const day = jdn(o.originalDate);
    const k = key(day, minute);
    if (claimed.has(k)) {
      orphans.push(o.id);
      continue;
    }
    if (!produced(day, minute)) {
      orphans.push(o.id);
      if (!o.canceled) place(o, day, minute);
      continue;
    }
    claimed.add(k);
    if (generated.has(k)) taken.add(k);
    if (!o.canceled) place(o, day, minute);
  }
  return taken;
}
