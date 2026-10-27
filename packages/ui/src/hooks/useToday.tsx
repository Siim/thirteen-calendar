import { type GregorianDate, gregorianEquals } from '@thirteen/core';
import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import { gregorianToday, msUntilNextLocalMidnight } from '../lib/dates.ts';

const TodayContext = createContext<GregorianDate | null>(null);

const systemNow = (): Date => new Date();

/**
 * The local calendar date, re-rendering at local midnight. Also re-checks
 * when the tab becomes visible or the window regains focus (timers are
 * throttled or frozen while a laptop sleeps). The returned object is stable
 * until the date actually changes.
 * @param enabled when `false` the clock is not scheduled (used when a fixed date is provided).
 * @param now clock source, for tests.
 */
export function useClockToday(enabled = true, now: () => Date = systemNow): GregorianDate {
  const nowRef = useRef(now);
  nowRef.current = now;
  const [today, setToday] = useState<GregorianDate>(() => gregorianToday(now()));

  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      const current = gregorianToday(nowRef.current());
      setToday((previous) => (gregorianEquals(previous, current) ? previous : current));
    };
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        sync();
        schedule();
      }, msUntilNextLocalMidnight(nowRef.current()));
    };
    const resync = () => {
      if (document.visibilityState === 'hidden') return;
      sync();
      schedule();
    };
    sync();
    schedule();
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
    };
  }, [enabled]);

  return today;
}

export interface TodayProviderProps {
  /** Pin "today" to a fixed date (demos, tests, screenshots). Omit to follow the clock. */
  readonly date?: GregorianDate | null;
  /** Clock source when `date` is omitted. */
  readonly now?: () => Date;
  readonly children?: ReactNode;
}

/** Provides one shared "today" to the tree (a single midnight timer for the whole app). */
export function TodayProvider({ date = null, now, children }: TodayProviderProps) {
  const clock = useClockToday(date === null, now);
  return <TodayContext.Provider value={date ?? clock}>{children}</TodayContext.Provider>;
}

/**
 * Today's local Gregorian date. Inside a {@link TodayProvider} it reads the
 * shared value; otherwise it runs its own midnight-aware clock.
 */
export function useToday(): GregorianDate {
  const provided = useContext(TodayContext);
  const clock = useClockToday(provided === null);
  return provided ?? clock;
}
