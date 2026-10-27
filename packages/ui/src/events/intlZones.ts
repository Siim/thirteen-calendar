import type { LocalDateTime, ZoneResolver } from '@thirteen/core';

/** Milliseconds since 1970 of a UTC wall clock (years 1 to 99 included, unlike `Date.UTC`). */
function utcMillis(value: LocalDateTime): number {
  const date = new Date(0);
  date.setUTCFullYear(value.date.year, value.date.month - 1, value.date.day);
  date.setUTCHours(0, value.minute, 0, 0);
  return date.getTime();
}

/**
 * A `ZoneResolver` (§5.2) on the browser's `Intl.DateTimeFormat`: the offset is
 * read with `formatToParts` and never through a platform conversion that applies
 * its own gap and overlap rule (core's `zonedToUtc` does that, §3.3). Offsets
 * with seconds (local mean time before 1900) are truncated toward zero, as the
 * other ports do.
 */
export function intlZoneResolver(): ZoneResolver {
  const formatters = new Map<string, Intl.DateTimeFormat | null>();
  const formatter = (tzid: string): Intl.DateTimeFormat | null => {
    let format = formatters.get(tzid);
    if (format === undefined) {
      try {
        format = new Intl.DateTimeFormat('en-US', {
          timeZone: tzid,
          hourCycle: 'h23',
          era: 'short',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
        });
      } catch {
        format = null;
      }
      formatters.set(tzid, format);
    }
    return format;
  };
  return {
    isKnown: (tzid) => formatter(tzid) !== null,
    offsetMinutesAt(tzid, utc) {
      const format = formatter(tzid);
      if (format === null) throw new RangeError(`Unknown time zone ${tzid}`);
      const instant = utcMillis(utc);
      const parts: Record<string, string> = {};
      for (const part of format.formatToParts(new Date(instant))) parts[part.type] = part.value;
      const era = parts.era ?? 'AD';
      const year = era.startsWith('B') ? 1 - Number(parts.year) : Number(parts.year);
      const local = new Date(0);
      local.setUTCFullYear(year, Number(parts.month) - 1, Number(parts.day));
      local.setUTCHours(Number(parts.hour), Number(parts.minute), Number(parts.second), 0);
      return Math.trunc((local.getTime() - instant) / 60_000) || 0;
    },
  };
}

/** The device's IANA zone, as the browser reports it. */
export function deviceTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}
