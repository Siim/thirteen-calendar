/**
 * The web's Calendar settings (docs/EVENTS.md §2.18), kept in localStorage
 * per browser like the other view preferences, and shared by every component
 * that reads them (the Settings page, the Calendar, the editor): a change in
 * one is seen at once by the others, and by other tabs through `storage`.
 */
import type { StoreCalendar } from '@thirteen/ui';
import { readStorage, writeStorage } from '@thirteen/ui';
import { useCallback, useSyncExternalStore } from 'react';

export const PREFERENCE_KEYS = {
  /** "Show events in Year view", default on. */
  yearDots: 'thirteen:calendar.yearDots',
  /** "Single-key shortcuts", default on (WCAG 2.1.4). */
  singleKey: 'thirteen:calendar.singleKey',
  /** The default calendar's id (§3.2: the persisted reference on the web is the UUID). */
  defaultCalendar: 'thirteen:calendar.defaultCalendar',
} as const;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || Object.values(PREFERENCE_KEYS).includes(event.key as never)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function write(key: string, value: string): void {
  writeStorage(key, value);
  for (const listener of listeners) listener();
}

function useStored(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readStorage(key),
    () => null,
  );
}

/** A boolean setting: [value, set]. */
export function useFlagPreference(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const stored = useStored(key);
  const value = stored === null ? initial : stored === '1';
  const set = useCallback((next: boolean) => write(key, next ? '1' : '0'), [key]);
  return [value, set];
}

/** "Show events in Year view" (§2.18, §2.3). */
export function useYearDots(): [boolean, (value: boolean) => void] {
  return useFlagPreference(PREFERENCE_KEYS.yearDots, true);
}

/** "Single-key shortcuts" (§2.18, §2.21). */
export function useSingleKeyShortcuts(): [boolean, (value: boolean) => void] {
  return useFlagPreference(PREFERENCE_KEYS.singleKey, true);
}

/**
 * The calendar new events go to (§2.15 "Default calendar"): the one the user
 * chose while it exists and can be written, else the platform default (the
 * calendar marked `isPlatformDefault`, "Personal" on the web), else the first
 * writable local calendar in the list. `null` when none can be written ("+"
 * then creates "Personal", §2.16).
 */
export function resolveDefaultCalendar(calendars: readonly StoreCalendar[], chosenId: string | null): StoreCalendar | null {
  const writable = calendars.filter((calendar) => calendar.writable);
  return (
    writable.find((calendar) => calendar.id === chosenId) ??
    writable.find((calendar) => calendar.isPlatformDefault) ??
    writable.find((calendar) => calendar.kind === 'local') ??
    writable[0] ??
    null
  );
}

/** The default calendar of `calendars` and a setter for the user's choice. */
export function useDefaultCalendar(calendars: readonly StoreCalendar[]): [StoreCalendar | null, (id: string) => void] {
  const chosen = useStored(PREFERENCE_KEYS.defaultCalendar);
  const set = useCallback((id: string) => write(PREFERENCE_KEYS.defaultCalendar, id), []);
  return [resolveDefaultCalendar(calendars, chosen), set];
}
