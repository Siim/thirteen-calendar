import { type GregorianDate, type LocalDateTime, gregorianEquals } from '@thirteen/core';
import { useMemo } from 'react';
import type { StoreCalendar, StoreOccurrence } from '../events/store.ts';
import { type UpNextResult, upNext } from '../events/upNext.ts';
import { useCalendarSystem } from './CalendarSystemProvider.tsx';
import { useNow } from './useClock.tsx';
import { useCalendars } from './useEvents.ts';
import { useOccurrencesInYears } from './useOccurrencesInYears.ts';
import { useToday } from './useToday.tsx';

export interface UpNextState {
  /** `loading` until today's year and the next are expanded. */
  readonly status: 'loading' | 'ready';
  /** The rows of the visible calendars (`null` while loading). */
  readonly result: UpNextResult | null;
  /** The visible calendars' occurrences by key, for the rows. */
  readonly occurrences: ReadonlyMap<string, StoreOccurrence>;
  readonly calendars: ReadonlyMap<string, StoreCalendar>;
  readonly today: GregorianDate;
  /** The wall clock the rows are cut at (the Now plate, ended events). */
  readonly now: LocalDateTime;
  /** Every calendar is hidden (§2.4 States: "All calendars are hidden." instead of the empty lines). */
  readonly allHidden: boolean;
  /**
   * A local calendar holds an event in this year or the next, hidden ones
   * included (§2.8 Windows and web: the card appears once there is something
   * to show).
   */
  readonly hasLocalEvents: boolean;
  /** A subscription exists (§2.8 Windows and web). */
  readonly hasSubscription: boolean;
}

/**
 * Today's Up next (docs/EVENTS.md §2.8, §6.5 `useUpNext()`): the next 7 days
 * of the visible calendars from now, at most 6 rows (`upNext`), with what the
 * card needs to decide whether to show itself. "Today" is the app's today
 * (`useToday`), and the rows are cut at the wall clock (`useNow`); when the
 * two disagree (a pinned demo day), nothing of that day has ended yet.
 */
export function useUpNext(): UpNextState {
  const today = useToday();
  const clock = useNow();
  const { systemId } = useCalendarSystem();
  const calendars = useCalendars();
  const all = useOccurrencesInYears([today.year, today.year + 1], { includeHidden: true });
  const now = useMemo<LocalDateTime>(
    () => (gregorianEquals(clock.date, today) ? clock : { date: today, minute: 0 }),
    [clock, today],
  );
  return useMemo<UpNextState>(() => {
    const byId = new Map(calendars.map((calendar) => [calendar.id, calendar] as const));
    const allHidden = calendars.length > 0 && calendars.every((calendar) => !calendar.visible);
    const hasSubscription = calendars.some((calendar) => calendar.kind === 'subscription');
    if (all === null) {
      return {
        status: 'loading',
        result: null,
        occurrences: new Map(),
        calendars: byId,
        today,
        now,
        allHidden,
        hasLocalEvents: false,
        hasSubscription,
      };
    }
    const hasLocalEvents = all.some((occurrence) => byId.get(occurrence.calendarId)?.kind === 'local');
    const visible = all.filter((occurrence) => byId.get(occurrence.calendarId)?.visible === true);
    return {
      status: 'ready',
      result: upNext(visible, now, systemId),
      occurrences: new Map(visible.map((occurrence) => [occurrence.key, occurrence] as const)),
      calendars: byId,
      today,
      now,
      allHidden,
      hasLocalEvents,
      hasSubscription,
    };
  }, [all, calendars, now, systemId, today]);
}
