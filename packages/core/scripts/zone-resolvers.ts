/**
 * `ZoneResolver` implementations for fixture generation and tests (never part
 * of `src`, which holds no zone data):
 *
 * - {@link syntheticZoneResolver}: the synthetic zone tables of the `zoneMath`
 *   fixture section (docs/EVENTS.md §5.5). Every port implements the same
 *   lookup in its parity test: the offset in force at a UTC instant is the
 *   `offset` of the last transition whose `at` (UTC) is at or before it, or the
 *   zone's initial `offset` before the first transition.
 * - {@link intlZoneResolver}: Node's `Intl` (ICU tzdata), the oracle for real
 *   IANA zones (`zones`, `series` and `alarmInstants` sections, task C4/C6).
 * - {@link recordingZoneResolver}: wraps another resolver (`Intl` when the
 *   fixtures are generated) and records every zone and UTC year it is asked
 *   about; {@link ZoneRecorder.offsets} turns that into the `zoneOffsets`
 *   section (§5.5).
 * - {@link recordedZoneResolver}: answers from a `zoneOffsets` table only, as
 *   every port's `RecordedZoneResolver` does for the `series`,
 *   `alarmInstants` and `untils` sections and the `fixtures/ics` cases, so no
 *   expectation depends on the tzdata of the platform that checks it.
 *
 * **`zoneOffsets` entries** (`{zone, year, startOffset, transitions}`): the
 * offsets of one zone during one UTC year. `startOffset` is the offset in
 * force at `year-01-01T00:00` UTC; each transition `{utc, offset}` gives the
 * offset from the UTC minute `utc` (`YYYY-MM-DDTHH:MM`, the first whole minute
 * at which it is in force) on, in ascending order, all inside that year. The
 * offset at a UTC instant is the `offset` of the last transition at or before
 * it, else `startOffset`. A resolver built from the table knows exactly the
 * zones it lists (`isKnown`) and throws for a known zone in a year it does not
 * hold. Offsets are whole minutes (local mean time seconds truncated toward
 * zero, as {@link intlZoneResolver} gives them).
 */

import { type LocalDateTime, type ZoneResolver, compareLocalDateTime, formatLocalDateTime, parseLocalDateTime } from '../src/events/index.ts';
import { fromAbsoluteMinutes, toAbsoluteMinutes } from '../src/events/time.ts';

/** A zone change: from the UTC instant `at` (`YYYY-MM-DDTHH:MM`) on, the offset is `offset` minutes. */
export interface SyntheticTransition {
  readonly at: string;
  readonly offset: number;
}

/** A synthetic zone table: an initial offset and transitions in ascending order. */
export interface SyntheticZone {
  readonly name: string;
  readonly offset: number;
  readonly transitions: readonly SyntheticTransition[];
}

/** A resolver that knows exactly the given synthetic zones. */
export function syntheticZoneResolver(...tables: readonly SyntheticZone[]): ZoneResolver {
  const zones = new Map(
    tables.map((table) => {
      const transitions = table.transitions.map((t) => ({ at: parseLocalDateTime(t.at), offset: t.offset }));
      transitions.forEach((t, i) => {
        if (i > 0 && compareLocalDateTime(transitions[i - 1]!.at, t.at) >= 0) {
          throw new RangeError(`Synthetic zone ${table.name}: transitions must be in ascending order`);
        }
      });
      return [table.name, { offset: table.offset, transitions }] as const;
    }),
  );
  return {
    isKnown: (tzid) => zones.has(tzid),
    offsetMinutesAt(tzid, utc) {
      const zone = zones.get(tzid);
      if (zone === undefined) throw new RangeError(`Unknown synthetic zone ${tzid}`);
      let offset = zone.offset;
      for (const transition of zone.transitions) {
        if (compareLocalDateTime(transition.at, utc) > 0) break;
        offset = transition.offset;
      }
      return offset;
    },
  };
}

/** Milliseconds since 1970 of a UTC wall clock (years 1 to 99 included, unlike `Date.UTC`). */
function utcMillis(value: LocalDateTime): number {
  const date = new Date(0);
  date.setUTCFullYear(value.date.year, value.date.month - 1, value.date.day);
  date.setUTCHours(0, value.minute, 0, 0);
  return date.getTime();
}

/**
 * A resolver backed by `Intl.DateTimeFormat` and the ICU tzdata of the running
 * Node (`process.versions.tz`). Offsets with seconds (local mean time) are
 * truncated toward zero, as the ports do.
 */
export function intlZoneResolver(): ZoneResolver {
  const formatters = new Map<string, Intl.DateTimeFormat | null>();
  const formatter = (tzid: string): Intl.DateTimeFormat | null => {
    if (!formatters.has(tzid)) {
      try {
        formatters.set(
          tzid,
          new Intl.DateTimeFormat('en-US', {
            timeZone: tzid,
            hourCycle: 'h23',
            era: 'short',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
          }),
        );
      } catch {
        formatters.set(tzid, null);
      }
    }
    return formatters.get(tzid)!;
  };
  return {
    isKnown: (tzid) => formatter(tzid) !== null,
    offsetMinutesAt(tzid, utc) {
      const format = formatter(tzid);
      if (format === null) throw new RangeError(`Unknown time zone ${tzid}`);
      const instant = utcMillis(utc);
      const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
      const era = parts.era ?? 'AD';
      const year = era.startsWith('B') ? 1 - Number(parts.year) : Number(parts.year);
      const local = new Date(0);
      local.setUTCFullYear(year, Number(parts.month) - 1, Number(parts.day));
      local.setUTCHours(Number(parts.hour), Number(parts.minute), Number(parts.second), 0);
      return Math.trunc((local.getTime() - instant) / 60_000) || 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Recorded zone offsets (§5.5 `zoneOffsets`)
// ---------------------------------------------------------------------------

/** One `zoneOffsets` entry: the offsets of `zone` during the UTC year `year` (see the module documentation). */
export interface ZoneOffsetsEntry {
  readonly zone: string;
  readonly year: number;
  readonly startOffset: number;
  readonly transitions: readonly { readonly utc: string; readonly offset: number }[];
}

const DAY = 1440;

/** Code point order, the order of zones in `zoneOffsets`. */
const byCodePoint = (a: string, b: string): number => {
  const x = [...a].map((c) => c.codePointAt(0)!);
  const y = [...b].map((c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
};

/**
 * A resolver that answers from `zoneOffsets` entries alone: it knows exactly
 * the zones they list and throws a `RangeError` for a known zone in a UTC year
 * the table does not hold, so a test never falls back to other zone data.
 * @throws RangeError for duplicate entries, or transitions that are not
 * ascending inside their year.
 */
export function recordedZoneResolver(entries: readonly ZoneOffsetsEntry[]): ZoneResolver {
  const table = new Map<string, Map<number, { start: number; transitions: { at: number; offset: number }[] }>>();
  for (const entry of entries) {
    const years = table.get(entry.zone) ?? new Map();
    table.set(entry.zone, years);
    if (years.has(entry.year)) throw new RangeError(`zoneOffsets holds ${entry.zone} ${entry.year} twice`);
    const transitions = entry.transitions.map((t) => ({ at: toAbsoluteMinutes(parseLocalDateTime(t.utc)), offset: t.offset }));
    transitions.forEach((t, i) => {
      const date = fromAbsoluteMinutes(t.at)!.date;
      if (date.year !== entry.year || (i > 0 && transitions[i - 1]!.at >= t.at)) {
        throw new RangeError(`zoneOffsets ${entry.zone} ${entry.year}: transitions must be ascending and inside the year`);
      }
    });
    years.set(entry.year, { start: entry.startOffset, transitions });
  }
  return {
    isKnown: (tzid) => table.has(tzid),
    offsetMinutesAt(tzid, utc) {
      const years = table.get(tzid);
      if (years === undefined) throw new RangeError(`Unknown time zone ${tzid} (not in zoneOffsets)`);
      const year = years.get(utc.date.year);
      if (year === undefined) {
        throw new RangeError(`zoneOffsets holds no offsets for ${tzid} in ${utc.date.year} (asked for ${formatLocalDateTime(utc)})`);
      }
      const at = toAbsoluteMinutes(utc);
      let offset = year.start;
      for (const t of year.transitions) {
        if (t.at > at) break;
        offset = t.offset;
      }
      return offset;
    },
  };
}

/** A resolver that records what it is asked; see {@link recordingZoneResolver}. */
export interface ZoneRecorder extends ZoneResolver {
  /**
   * The `zoneOffsets` entries for every zone and UTC year asked about so far,
   * read from the wrapped resolver, ordered by zone (code points) and year.
   * Every answer given so far is checked against the table.
   * @throws Error when the table would answer a recorded query differently,
   * or a zone was reported known but never asked for an offset.
   */
  offsets(): ZoneOffsetsEntry[];
}

/**
 * Wraps `base` and records every `offsetMinutesAt` query (zone, UTC instant
 * and answer) and every `isKnown` answer, so the fixture generator can write
 * exactly the offsets its zone sections used (§5.5 "Recorded zone offsets").
 *
 * {@link ZoneRecorder.offsets} scans each recorded zone and year in steps of
 * one day and finds each change to the minute by bisection (tzdata has no two
 * transitions within a day), then replays every recorded query through
 * {@link recordedZoneResolver} on the result.
 */
export function recordingZoneResolver(base: ZoneResolver): ZoneRecorder {
  const known = new Map<string, boolean>();
  const queries = new Map<string, Map<number, number>>();
  return {
    isKnown(tzid) {
      const answer = base.isKnown(tzid);
      known.set(tzid, answer);
      return answer;
    },
    offsetMinutesAt(tzid, utc) {
      const answer = base.offsetMinutesAt(tzid, utc);
      const zone = queries.get(tzid) ?? new Map<number, number>();
      queries.set(tzid, zone);
      zone.set(toAbsoluteMinutes(utc), answer);
      return answer;
    },
    offsets() {
      const silent = [...known].filter(([zone, answer]) => answer && !queries.has(zone)).map(([zone]) => zone);
      if (silent.length > 0) {
        throw new Error(`Zones reported known but never asked for an offset cannot be recorded: ${silent.join(', ')}`);
      }
      const offsetAt = (zone: string, absolute: number) => base.offsetMinutesAt(zone, fromAbsoluteMinutes(absolute)!);
      const entries: ZoneOffsetsEntry[] = [];
      for (const zone of [...queries.keys()].sort(byCodePoint)) {
        const years = [...new Set([...queries.get(zone)!.keys()].map((at) => fromAbsoluteMinutes(at)!.date.year))].sort((a, b) => a - b);
        for (const year of years) {
          const first = toAbsoluteMinutes({ date: { year, month: 1, day: 1 }, minute: 0 });
          const last = toAbsoluteMinutes({ date: { year, month: 12, day: 31 }, minute: DAY - 1 });
          const startOffset = offsetAt(zone, first);
          const transitions: { utc: string; offset: number }[] = [];
          let at = first;
          let offset = startOffset;
          while (at < last) {
            const next = Math.min(at + DAY, last);
            const nextOffset = offsetAt(zone, next);
            if (nextOffset !== offset) {
              // The first minute in (at, next] with the new offset.
              let low = at;
              let high = next;
              while (high - low > 1) {
                const middle = Math.floor((low + high) / 2);
                if (offsetAt(zone, middle) === offset) low = middle;
                else high = middle;
              }
              transitions.push({ utc: formatLocalDateTime(fromAbsoluteMinutes(high)!), offset: nextOffset });
              offset = nextOffset;
            }
            at = next;
          }
          entries.push({ zone, year, startOffset, transitions });
        }
      }
      const recorded = recordedZoneResolver(entries);
      for (const [zone, answers] of queries) {
        for (const [at, answer] of answers) {
          const replayed = recorded.offsetMinutesAt(zone, fromAbsoluteMinutes(at)!);
          if (replayed !== answer) {
            throw new Error(`zoneOffsets answers ${replayed} for ${zone} at ${formatLocalDateTime(fromAbsoluteMinutes(at)!)}, the resolver said ${answer}`);
          }
        }
      }
      return entries;
    },
  };
}
