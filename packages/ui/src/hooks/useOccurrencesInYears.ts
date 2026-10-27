import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { StoreOccurrence, YearSnapshot } from '../events/store.ts';
import { useCalendars, useEventStore } from './useEvents.ts';

/**
 * The visible calendars' occurrences of several Gregorian years, merged and
 * deduplicated by key (docs/EVENTS.md §3.2: an event that crosses January 1 is
 * in both years' caches), in the order the years are given (each year in the
 * store's order). `null` while any of the years is still loading. List mode,
 * Up next and Week or Month views that cross January 1 use it.
 */
export function useOccurrencesInYears(
  years: readonly number[],
  options: { readonly includeHidden?: boolean } = {},
): readonly StoreOccurrence[] | null {
  const store = useEventStore();
  const calendars = useCalendars();
  const key = years.join(',');
  const cache = useRef<{ key: string; parts: readonly YearSnapshot[] } | null>(null);
  const getSnapshot = () => {
    const parts = key === '' ? [] : key.split(',').map((year) => store.occurrencesInYear(Number(year)));
    const cached = cache.current;
    if (
      cached !== null &&
      cached.key === key &&
      cached.parts.length === parts.length &&
      cached.parts.every((part, i) => part === parts[i])
    ) {
      return cached.parts;
    }
    cache.current = { key, parts };
    return parts;
  };
  const parts = useSyncExternalStore((listener) => store.subscribe(listener), getSnapshot, getSnapshot);
  useEffect(() => {
    for (const part of parts) if (part.status === 'loading') void store.loadYear(part.year);
  }, [store, parts]);
  const includeHidden = options.includeHidden ?? false;
  return useMemo(() => {
    if (parts.some((part) => part.status !== 'ready')) return null;
    const visible = new Set(calendars.filter((calendar) => includeHidden || calendar.visible).map((calendar) => calendar.id));
    const seen = new Set<string>();
    const merged: StoreOccurrence[] = [];
    for (const part of parts) {
      if (part.status !== 'ready') continue;
      for (const occurrence of part.occurrences) {
        if (!visible.has(occurrence.calendarId) || seen.has(occurrence.key)) continue;
        seen.add(occurrence.key);
        merged.push(occurrence);
      }
    }
    return merged;
  }, [parts, calendars, includeHidden]);
}
