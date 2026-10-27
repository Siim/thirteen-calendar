import { type ReactNode, createContext, createElement, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { EventStore, EventStoreState, StoreCalendar, StoreOccurrence, YearSnapshot } from '../events/store.ts';

const EventStoreContext = createContext<EventStore | null>(null);

export interface EventStoreProviderProps {
  /** The IndexedDB store in the app; a `MemoryEventStore` in tests and screenshots. */
  readonly store: EventStore;
  readonly children?: ReactNode;
}

/** Makes an {@link EventStore} available to the hooks below (docs/EVENTS.md §6.5). */
export function EventStoreProvider({ store, children }: EventStoreProviderProps) {
  return createElement(EventStoreContext.Provider, { value: store }, children);
}

/** The store; throws outside an {@link EventStoreProvider}. */
export function useEventStore(): EventStore {
  const store = useContext(EventStoreContext);
  if (store === null) throw new Error('useEventStore() must be used inside <EventStoreProvider>.');
  return store;
}

/** The store, or `null` outside a provider (screens that show events only when there is a store). */
export function useOptionalEventStore(): EventStore | null {
  return useContext(EventStoreContext);
}

/** Status, calendars, device zone and revision; re-renders on every change. */
export function useEventStoreState(): EventStoreState {
  const store = useEventStore();
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
    () => store.getState(),
  );
}

/** Every calendar, in the Calendars list's order (hidden ones too). */
export function useCalendars(): readonly StoreCalendar[] {
  return useEventStoreState().calendars;
}

export interface UseOccurrencesOptions {
  /** Include the occurrences of hidden calendars. Default false. */
  readonly includeHidden?: boolean;
}

/**
 * The occurrences touching a Gregorian year (device wall clock, order key of
 * §5.3), of the visible calendars; `null` while the year is loading. The array
 * is the same until the store or the visible set changes, so layouts can be
 * memoized on it. Views that span two years (List, Up next, Month or Week
 * across January 1) merge two years and dedupe by key (§3.2).
 */
export function useOccurrences(year: number, options: UseOccurrencesOptions = {}): readonly StoreOccurrence[] | null {
  const store = useEventStore();
  const snapshot: YearSnapshot = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.occurrencesInYear(year),
    () => store.occurrencesInYear(year),
  );
  const calendars = useCalendars();
  useEffect(() => {
    if (snapshot.status === 'loading') void store.loadYear(year);
  }, [store, year, snapshot.status]);
  const includeHidden = options.includeHidden ?? false;
  return useMemo(() => {
    if (snapshot.status !== 'ready') return null;
    if (includeHidden) return snapshot.occurrences;
    const visible = new Set(calendars.filter((calendar) => calendar.visible).map((calendar) => calendar.id));
    if (visible.size === calendars.length) return snapshot.occurrences;
    return snapshot.occurrences.filter((occurrence) => visible.has(occurrence.calendarId));
  }, [snapshot, calendars, includeHidden]);
}
