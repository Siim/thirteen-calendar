import { type LocalDateTime, type ZoneResolver, fromJSDate, utcToZoned } from '@thirteen/core';
import { type ReactNode, createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import { prefers24HourClock } from '../events/format.ts';
import { deviceTimeZone, intlZoneResolver } from '../events/intlZones.ts';

interface ClockContextValue {
  /** Pinned wall clock (screenshots, tests, `?now=`); `null` follows the real clock. */
  readonly pinned: LocalDateTime | null;
  /** The IANA zone the wall clock is read in (the event store's device zone). */
  readonly zone: string | null;
  /** `null`: from the browser's locale. */
  readonly use24Hour: boolean | null;
  readonly zones: ZoneResolver | null;
}

const ClockContext = createContext<ClockContextValue>({ pinned: null, zone: null, use24Hour: null, zones: null });

export interface ClockProviderProps {
  /** Pin "now" (the mockup data set's 2026-10-19T09:41); `null` follows the clock. */
  readonly now?: LocalDateTime | null;
  /** The zone "now" is read in; default the browser's. Pass the event store's `deviceZone`. */
  readonly zone?: string | null;
  /** Force the 12 or 24-hour form; default the browser locale's (§2.19). */
  readonly use24Hour?: boolean | null;
  readonly zones?: ZoneResolver | null;
  readonly children?: ReactNode;
}

/** The wall clock and time form the event views share (Up next's "Now", the editor's next whole hour). */
export function ClockProvider({ now = null, zone = null, use24Hour = null, zones = null, children }: ClockProviderProps) {
  const value = useMemo(() => ({ pinned: now, zone, use24Hour, zones }), [now, zone, use24Hour, zones]);
  return createElement(ClockContext.Provider, { value }, children);
}

/** The current time as a UTC wall clock. */
function utcNow(): LocalDateTime {
  const date = new Date();
  return {
    date: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() },
    minute: date.getUTCHours() * 60 + date.getUTCMinutes(),
  };
}

function readNow(zone: string | null, zones: ZoneResolver | null): LocalDateTime {
  try {
    return utcToZoned(utcNow(), zone ?? deviceTimeZone(), zones ?? intlZoneResolver()) ?? fallbackNow();
  } catch {
    return fallbackNow();
  }
}

function fallbackNow(): LocalDateTime {
  const date = new Date();
  return { date: fromJSDate(date), minute: date.getHours() * 60 + date.getMinutes() };
}

/**
 * The device's wall clock, to the minute: pinned by {@link ClockProvider}, or
 * the real clock read in the provider's zone and updated every 30 seconds.
 */
export function useNow(): LocalDateTime {
  const { pinned, zone, zones } = useContext(ClockContext);
  const [now, setNow] = useState<LocalDateTime>(() => pinned ?? readNow(zone, zones));
  useEffect(() => {
    if (pinned !== null) {
      setNow(pinned);
      return undefined;
    }
    setNow(readNow(zone, zones));
    const timer = window.setInterval(
      () =>
        setNow((previous) => {
          const next = readNow(zone, zones);
          return next.minute === previous.minute && next.date.day === previous.date.day ? previous : next;
        }),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, [pinned, zone, zones]);
  return pinned ?? now;
}

/** True when times read in the 24-hour form (`09:30`), false for 12-hour (`9:30 AM`). */
export function useUse24Hour(): boolean {
  const { use24Hour } = useContext(ClockContext);
  return useMemo(() => use24Hour ?? prefers24HourClock(), [use24Hour]);
}
