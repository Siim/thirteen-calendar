/**
 * Time zones of the `.ics` module (docs/EVENTS.md §5.4): how a `TZID`
 * resolves ({@link resolveTzid}), the offsets a file's own `VTIMEZONE`
 * defines, conversion of a value to UTC ({@link toUtc}), and the generated
 * `VTIMEZONE` Thirteen writes for a zone the platform knows
 * ({@link buildVTimeZone}). The engine holds no zone data: IANA offsets come
 * from the platform's {@link ZoneResolver}, Windows ids are mapped through the
 * embedded CLDR table (`windows-zones.ts`).
 * @module
 */

import { MAX_JULIAN_DAY_NUMBER, MIN_JULIAN_DAY_NUMBER, assertValidYear } from '../gregorian.ts';
import { fail, isInteger, show } from '../internal.ts';
import { type EventRecurrence, expandRecurrence } from '../events/recurrence.ts';
import { civilOf, jdnOf, monthLength } from '../events/rrule-expansion.ts';
import { type RRule, copyRRule, rruleEquals } from '../events/rrule.ts';
import {
  type LocalDateTime,
  type ZoneResolver,
  fromAbsoluteMinutes,
  formatLocalDateTime,
  toAbsoluteMinutes,
  zonedToUtc,
} from '../events/time.ts';
import type { Weekday } from '../weekday.ts';
import type { IcsCalendar, IcsDateValue, IcsObservance, IcsTimeZone, ZoneHandle } from './types.ts';
import { WINDOWS_ZONES } from './windows-zones.ts';

const DAY = 1440;
const MIN_ABSOLUTE = MIN_JULIAN_DAY_NUMBER * DAY;
const MAX_ABSOLUTE = MAX_JULIAN_DAY_NUMBER * DAY + DAY - 1;

// ---------------------------------------------------------------------------
// Windows ids
// ---------------------------------------------------------------------------

const WINDOWS = new Map(WINDOWS_ZONES.map(([windows, iana]) => [windows, iana] as const));
const WINDOWS_LOWER = new Map(WINDOWS_ZONES.map(([windows, iana]) => [windows.toLowerCase(), iana] as const));

/** The IANA id of a Windows time zone id (`FLE Standard Time` is `Europe/Kiev`), from the CLDR table; null when it is not one. */
export function windowsZoneToIana(windowsId: string): string | null {
  return WINDOWS.get(windowsId) ?? WINDOWS_LOWER.get(windowsId.toLowerCase()) ?? null;
}

function knows(zones: ZoneResolver, tzid: string): boolean {
  try {
    return zones.isKnown(tzid) === true;
  } catch {
    return false;
  }
}

function assertResolver(zones: unknown): asserts zones is ZoneResolver {
  const z = zones as { isKnown?: unknown; offsetMinutesAt?: unknown } | null;
  if (typeof z !== 'object' || z === null || typeof z.isKnown !== 'function' || typeof z.offsetMinutesAt !== 'function') {
    fail('zones must be a ZoneResolver with isKnown and offsetMinutesAt');
  }
}

// ---------------------------------------------------------------------------
// VTIMEZONE offsets
// ---------------------------------------------------------------------------

/** One `RRULE` of an observance: its onsets (UTC absolute minutes) by local year, or all of them for a rule that ends. */
class ObservanceRule {
  private readonly rule: RRule;
  private readonly observance: IcsObservance;
  private readonly recurrence: EventRecurrence;
  private readonly years = new Map<number, number[]>();
  private all: number[] | null = null;
  private readonly finite: boolean;

  constructor(rule: RRule, observance: IcsObservance) {
    this.rule = rule;
    this.observance = observance;
    const plain = { ...copyRRule(rule), count: null, until: null };
    this.recurrence = {
      rule: { kind: 'rrule', rrule: plain },
      end: rule.count === null ? { kind: 'never' } : { kind: 'count', count: rule.count },
      extraDates: [],
      exceptDates: [],
    };
    this.finite = rule.count !== null || rule.until !== null;
  }

  /** `true` when an onset (local wall clock `local`, UTC `utc`) is on or before the rule's `UNTIL`. */
  private beforeUntil(local: number, utc: number): boolean {
    const until = this.rule.until;
    if (until === null) return true;
    if (until.kind === 'date') return Math.floor(local / DAY) <= toAbsoluteMinutes({ date: until.date, minute: 0 }) / DAY;
    const limit = toAbsoluteMinutes(until.value);
    return until.kind === 'utc' ? utc <= limit : local <= limit;
  }

  private onsets(fromYear: number, toYear: number, limit: number): number[] {
    const start = this.observance.start;
    const from = Math.max(fromYear, start.date.year);
    if (from > toYear) return [];
    const window = { from: { year: from, month: 1, day: 1 }, to: { year: toYear, month: 12, day: 31 } };
    const expansion = expandRecurrence(this.recurrence, start.date, window, { limit });
    const out: number[] = [];
    for (const occurrence of expansion.occurrences) {
      const local = toAbsoluteMinutes({ date: occurrence.date, minute: start.minute });
      const utc = local - this.observance.offsetFrom;
      if (this.beforeUntil(local, utc)) out.push(utc);
    }
    return out;
  }

  /** The latest onset at or before the UTC minute `utc`, or null. */
  latest(utc: number, yearOfUtc: number): number | null {
    if (this.finite) {
      const until = this.rule.until;
      const untilYear = until === null ? 9999 : Math.min((until.kind === 'date' ? until.date : until.value.date).year + 1, 9999);
      this.all ??= this.onsets(1, untilYear, 100_000);
      let best: number | null = null;
      for (const onset of this.all) {
        if (onset > utc) break;
        best = onset;
      }
      return best;
    }
    for (let year = Math.min(yearOfUtc + 1, 9999); year >= this.observance.start.date.year; year--) {
      let list = this.years.get(year);
      if (list === undefined) {
        list = this.onsets(year, year, 10_000);
        this.years.set(year, list);
      }
      let best: number | null = null;
      for (const onset of list) if (onset <= utc && (best === null || onset > best)) best = onset;
      if (best !== null) return best;
    }
    return null;
  }
}

/** An observance with its onsets in UTC absolute minutes. */
interface ObservanceOnsets {
  readonly observance: IcsObservance;
  readonly start: number;
  readonly rdates: readonly number[];
  readonly rules: readonly ObservanceRule[];
}

/** The offsets a `VTIMEZONE` defines: at each instant, the `TZOFFSETTO` of the latest onset at or before it. */
class VTimeZoneRules {
  private readonly observances: readonly ObservanceOnsets[];
  /** Before every onset (which RFC 5545 leaves undefined): the earliest observance's `TZOFFSETFROM`. */
  private readonly before: number;

  constructor(timeZone: IcsTimeZone) {
    this.observances = timeZone.observances.map((observance) => ({
      observance,
      start: toAbsoluteMinutes(observance.start) - observance.offsetFrom,
      rdates: observance.rdates.map((r) => toAbsoluteMinutes(r) - observance.offsetFrom).sort((a, b) => a - b),
      rules: observance.rrules.map((rule) => new ObservanceRule(rule, observance)),
    }));
    let earliest: ObservanceOnsets | null = null;
    for (const o of this.observances) if (earliest === null || o.start < earliest.start) earliest = o;
    this.before = earliest === null ? 0 : earliest.observance.offsetFrom;
  }

  offsetAt(utc: number): number {
    const year = civilOf(Math.floor(utc / DAY)).year;
    let bestTime: number | null = null;
    let bestOffset = this.before;
    for (const o of this.observances) {
      if (o.start > utc) continue;
      let latest = o.start;
      for (const r of o.rdates) if (r <= utc && r > latest) latest = r;
      for (const rule of o.rules) {
        const onset = rule.latest(utc, year);
        if (onset !== null && onset > latest) latest = onset;
      }
      if (bestTime === null || latest >= bestTime) {
        bestTime = latest;
        bestOffset = o.observance.offsetTo;
      }
    }
    return bestOffset;
  }
}

/**
 * A resolver that answers offsets for one `VTIMEZONE`, under the name `name`
 * (its `TZID` by default).
 * @internal
 */
export function vtimezoneResolver(timeZone: IcsTimeZone, name: string = timeZone.tzid): ZoneResolver {
  const rules = new VTimeZoneRules(timeZone);
  return {
    isKnown: (tzid) => tzid === name,
    offsetMinutesAt(tzid, utc) {
      if (tzid !== name) fail(`Unknown time zone ${show(tzid)}`);
      return rules.offsetAt(toAbsoluteMinutes(utc));
    },
  };
}

// ---------------------------------------------------------------------------
// TZID resolution
// ---------------------------------------------------------------------------

/**
 * How a `TZID` resolves (§5.4), in this order: an IANA id the platform knows
 * (`Europe/Tallinn`); a Windows id mapped to IANA through the CLDR table
 * (`FLE Standard Time`, as Outlook writes); the calendar's own `VTIMEZONE`
 * of that `TZID` (its observances expanded with the engine's RRULE expander);
 * otherwise floating.
 * @throws RangeError for a bad `tzid` or resolver.
 */
export function resolveTzid(tzid: string, calendar: IcsCalendar, zones: ZoneResolver): ZoneHandle {
  if (typeof tzid !== 'string') fail(`TZID must be a string, got ${show(tzid)}`);
  assertResolver(zones);
  if (tzid !== '' && knows(zones, tzid)) return { kind: 'iana', tzid, zone: tzid, timeZone: null, resolver: zones };
  const windows = windowsZoneToIana(tzid);
  if (windows !== null && knows(zones, windows)) return { kind: 'windows', tzid, zone: windows, timeZone: null, resolver: zones };
  const timeZone = calendar.timeZones.find((t) => t.tzid === tzid && t.observances.length > 0);
  if (timeZone !== undefined) return { kind: 'vtimezone', tzid, zone: null, timeZone, resolver: vtimezoneResolver(timeZone) };
  return { kind: 'floating', tzid, zone: null, timeZone: null, resolver: null };
}

/**
 * A value as a UTC wall clock: a UTC value as it is; a date-time (zoned or
 * floating) or a date (at 00:00) in the handle's zone through `zonedToUtc`
 * (§5.2, the gap and overlap rule) or the `VTIMEZONE`. null for a floating
 * handle (no instant) and when the result leaves years 1 to 9999.
 */
export function toUtc(value: IcsDateValue, handle: ZoneHandle): LocalDateTime | null {
  if (value.kind === 'utc') return { date: { ...value.value.date }, minute: value.value.minute };
  if (handle.resolver === null) return null;
  const local = value.kind === 'date' ? { date: value.date, minute: 0 } : value.value;
  return zonedToUtc(local, handle.zone ?? handle.tzid, handle.resolver);
}

// ---------------------------------------------------------------------------
// Comparing definitions (§3.6)
// ---------------------------------------------------------------------------

function sameObservance(a: IcsObservance, b: IcsObservance): boolean {
  if (a.kind !== b.kind || a.offsetFrom !== b.offsetFrom || a.offsetTo !== b.offsetTo) return false;
  if (toAbsoluteMinutes(a.start) !== toAbsoluteMinutes(b.start)) return false;
  if (a.rrules.length !== b.rrules.length || !a.rrules.every((r) => b.rrules.some((s) => rruleEquals(r, s)))) return false;
  const dates = (o: IcsObservance) => [...new Set(o.rdates.map(toAbsoluteMinutes))].sort((x, y) => x - y).join(',');
  return dates(a) === dates(b);
}

/**
 * `true` when two `VTIMEZONE`s define the same zone (§3.6): their observances
 * (kind, `DTSTART`, `TZOFFSETFROM`, `TZOFFSETTO`, `RRULE`, `RDATE`) are equal,
 * in any order; `TZNAME`, `LAST-MODIFIED`, `TZURL` and `X-` properties are
 * ignored. The `TZID`s themselves are not compared.
 */
export function sameTimeZoneDefinition(a: IcsTimeZone, b: IcsTimeZone): boolean {
  if (a.observances.length !== b.observances.length) return false;
  const unused = [...b.observances];
  for (const observance of a.observances) {
    const index = unused.findIndex((o) => sameObservance(observance, o));
    if (index < 0) return false;
    unused.splice(index, 1);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Generated VTIMEZONEs (§5.4)
// ---------------------------------------------------------------------------

interface Transition {
  /** UTC absolute minute of the change. */
  readonly utc: number;
  readonly from: number;
  readonly to: number;
}

interface Pattern {
  readonly transition: Transition;
  readonly kind: 'standard' | 'daylight';
  readonly month: number;
  readonly weekday: Weekday;
  readonly ordinal: number;
  readonly key: string;
}

/** The IANA zone a `TZID` is generated from: the id itself, or the IANA id of a Windows id. */
function generatedZone(tzid: string, zones: ZoneResolver): string {
  if (knows(zones, tzid)) return tzid;
  const windows = windowsZoneToIana(tzid);
  if (windows !== null && knows(zones, windows)) return windows;
  return fail(`Cannot build a VTIMEZONE for ${show(tzid)}: it is neither a zone the resolver knows nor a Windows id that maps to one`);
}

function offsetAt(zones: ZoneResolver, zone: string, absolute: number): number {
  const probe = fromAbsoluteMinutes(Math.min(Math.max(absolute, MIN_ABSOLUTE), MAX_ABSOLUTE))!;
  const offset = zones.offsetMinutesAt(zone, probe);
  if (!isInteger(offset) || offset <= -DAY || offset >= DAY) {
    fail(`ZoneResolver.offsetMinutesAt(${show(zone)}, ${formatLocalDateTime(probe)}) returned ${show(offset)}`);
  }
  return offset === 0 ? 0 : offset;
}

/**
 * A `VTIMEZONE` for a zone the platform knows (an IANA id, or a Windows id that
 * maps to one; the `TZID` stays as given), covering the years used (§5.4):
 *
 * - `years` is the range of years the events use (its smallest and largest
 *   values count). Sampling starts on January 1 of the year before the first,
 *   so the first onset comes before the first event.
 * - Transitions are found by sampling `offsetMinutesAt` daily at 00:00 UTC and
 *   bisecting to the minute. A year's transitions form its pattern: for each,
 *   the kind (`DAYLIGHT` when the offset rises in a year in which it also
 *   falls, else `STANDARD`), the local month, the weekday rule (`-1WD` when
 *   the local day is in the month's last 7 days, else `nWD` with n the week of
 *   the month), the local time and both offsets.
 * - Consecutive years with the same pattern form a period: one observance per
 *   transition with `DTSTART` at the period's first transition and
 *   `RRULE:FREQ=YEARLY;BYMONTH=m;BYDAY=nWD;UNTIL=` its last (UTC). A period of
 *   one year has no `RRULE` (its `DTSTART` is the onset). The last period has
 *   no `UNTIL`, so it goes on as the zone does.
 * - A first sampled year without a transition starts with a `STANDARD` at
 *   January 1, 00:00, whose `TZOFFSETFROM` equals its `TZOFFSETTO`; a last
 *   period without transitions adds nothing (the last onset's offset holds).
 *
 * The result has `generated: { first, last }` and no `raw` text. Two
 * transitions within one day are not seen (daily sampling).
 * @throws RangeError for an empty or invalid `years`, or a zone the resolver
 * does not know.
 */
export function buildVTimeZone(tzid: string, years: readonly number[], zones: ZoneResolver): IcsTimeZone {
  if (typeof tzid !== 'string' || tzid === '') fail(`TZID must be a non-empty string, got ${show(tzid)}`);
  assertResolver(zones);
  if (!Array.isArray(years) || years.length === 0) fail('buildVTimeZone needs at least one year');
  for (const year of years) assertValidYear(year);
  const zone = generatedZone(tzid, zones);
  const first = Math.min(...years);
  const last = Math.max(...years);
  const sampleFirst = Math.max(1, first - 1);

  // Transitions, by daily samples at 00:00 UTC and bisection to the minute.
  const transitions: Transition[] = [];
  const startDay = jdnOf(sampleFirst, 1, 1);
  const endDay = Math.min(jdnOf(last + 1, 1, 1), MAX_JULIAN_DAY_NUMBER + 1);
  let previous = offsetAt(zones, zone, startDay * DAY);
  const initial = previous;
  for (let day = startDay + 1; day <= endDay; day++) {
    const instant = Math.min(day * DAY, MAX_ABSOLUTE);
    const offset = offsetAt(zones, zone, instant);
    if (offset === previous) continue;
    let low = (day - 1) * DAY; // offset here is `previous`
    let high = instant; // offset here differs
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (offsetAt(zones, zone, mid) === previous) low = mid;
      else high = mid;
    }
    transitions.push({ utc: high, from: previous, to: offsetAt(zones, zone, high) });
    previous = offset;
  }

  // Each transition's year (local) and pattern.
  const yearOfTransition = (t: Transition) => Math.min(Math.max(civilOf(Math.floor((t.utc + t.from) / DAY)).year, sampleFirst), last);
  const byYear = new Map<number, Transition[]>();
  for (const t of transitions) {
    const year = yearOfTransition(t);
    byYear.set(year, [...(byYear.get(year) ?? []), t]);
  }
  const patternCache = new Map<number, Pattern[]>();
  const patternsOf = (year: number): Pattern[] => {
    const cached = patternCache.get(year);
    if (cached !== undefined) return cached;
    const patterns = computePatterns(year);
    patternCache.set(year, patterns);
    return patterns;
  };
  const computePatterns = (year: number): Pattern[] => {
    const list = byYear.get(year) ?? [];
    const rises = list.some((t) => t.to > t.from);
    const falls = list.some((t) => t.to < t.from);
    return list.map((t) => {
      const local = t.utc + t.from;
      const day = Math.floor(local / DAY);
      const date = civilOf(day);
      const weekday = ((((day + 1) % 7) + 7) % 7) as Weekday;
      const ordinal = date.day > monthLength(date.year, date.month) - 7 ? -1 : Math.ceil(date.day / 7);
      const kind: Pattern['kind'] = t.to > t.from && rises && falls ? 'daylight' : 'standard';
      const key = `${kind}|${date.month}|${ordinal}|${weekday}|${local - day * DAY}|${t.from}|${t.to}`;
      return { transition: t, kind, month: date.month, weekday, ordinal, key };
    });
  };

  const observances: IcsObservance[] = [];
  if ((byYear.get(sampleFirst) ?? []).length === 0) {
    observances.push({
      kind: 'standard',
      start: { date: { year: sampleFirst, month: 1, day: 1 }, minute: 0 },
      offsetFrom: initial,
      offsetTo: initial,
      rrules: [],
      rdates: [],
      names: [],
    });
  }
  let year = sampleFirst;
  while (year <= last) {
    const patterns = patternsOf(year);
    const signature = patterns.map((p) => p.key).join(' ');
    let end = year;
    while (end + 1 <= last && patternsOf(end + 1).map((p) => p.key).join(' ') === signature) end++;
    if (patterns.length > 0) {
      const lastPatterns = patternsOf(end);
      patterns.forEach((pattern, i) => {
        const t = pattern.transition;
        const onset = fromAbsoluteMinutes(t.utc + t.from)!;
        const openEnded = end === last;
        const until = fromAbsoluteMinutes(lastPatterns[i]!.transition.utc)!;
        const rrules: RRule[] =
          !openEnded && end === year
            ? []
            : [
                {
                  freq: 'yearly',
                  interval: 1,
                  count: null,
                  until: openEnded ? null : { kind: 'utc', value: until },
                  bySecond: [],
                  byMinute: [],
                  byHour: [],
                  byDay: [{ weekday: pattern.weekday, ordinal: pattern.ordinal }],
                  byMonthDay: [],
                  byYearDay: [],
                  byWeekNo: [],
                  byMonth: [pattern.month],
                  bySetPos: [],
                  wkst: null,
                  rscale: null,
                  skip: null,
                  extensions: [],
                },
              ];
        observances.push({ kind: pattern.kind, start: onset, offsetFrom: t.from, offsetTo: t.to, rrules, rdates: [], names: [] });
      });
    }
    year = end + 1;
  }
  return { tzid, observances, raw: null, generated: { first, last }, line: null };
}

// ---------------------------------------------------------------------------
// Zones of one calendar, for expansion
// ---------------------------------------------------------------------------

/** Internal zone names: no IANA id contains a colon. */
const UTC_NAME = 'ics:UTC';
const VTIMEZONE_PREFIX = 'ics:VTIMEZONE:';

/**
 * The zones one calendar's events use, as one resolver: every zone the
 * platform knows (by its IANA id), UTC, and the calendar's own `VTIMEZONE`s
 * (under internal names). Resolutions are cached.
 * @internal
 */
export class CalendarZones {
  readonly resolver: ZoneResolver;
  private readonly calendar: IcsCalendar;
  private readonly zones: ZoneResolver;
  private readonly handles = new Map<string, ZoneHandle>();
  private readonly vtimezones = new Map<string, ZoneResolver>();

  constructor(calendar: IcsCalendar, zones: ZoneResolver) {
    this.calendar = calendar;
    this.zones = zones;
    const vtimezones = this.vtimezones;
    this.resolver = {
      isKnown: (name) => name === UTC_NAME || vtimezones.has(name) || knows(zones, name),
      offsetMinutesAt(name, utc) {
        if (name === UTC_NAME) return 0;
        const own = vtimezones.get(name);
        return own === undefined ? zones.offsetMinutesAt(name, utc) : own.offsetMinutesAt(name, utc);
      },
    };
  }

  /** The (cached) handle of a `TZID`. */
  handle(tzid: string): ZoneHandle {
    let handle = this.handles.get(tzid);
    if (handle === undefined) {
      handle = resolveTzid(tzid, this.calendar, this.zones);
      if (handle.kind === 'vtimezone') this.vtimezones.set(VTIMEZONE_PREFIX + tzid, vtimezoneResolver(handle.timeZone!, VTIMEZONE_PREFIX + tzid));
      this.handles.set(tzid, handle);
    }
    return handle;
  }

  /** The zone of a value in {@link resolver}: UTC, an IANA id or an internal `VTIMEZONE` name; null for dates, floating values and unknown `TZID`s. */
  zoneOf(value: IcsDateValue): string | null {
    if (value.kind === 'utc') return UTC_NAME;
    if (value.kind !== 'zoned') return null;
    const handle = this.handle(value.tzid);
    if (handle.kind === 'floating') return null;
    return handle.zone ?? VTIMEZONE_PREFIX + value.tzid;
  }

  /** The zone name callers show for a zone of {@link zoneOf}: the IANA id, the `TZID` of a file-defined zone, or `UTC`. */
  static displayName(zone: string | null): string | null {
    if (zone === null) return null;
    if (zone === UTC_NAME) return 'UTC';
    return zone.startsWith(VTIMEZONE_PREFIX) ? zone.slice(VTIMEZONE_PREFIX.length) : zone;
  }
}
