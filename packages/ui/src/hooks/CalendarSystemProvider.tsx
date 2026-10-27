import {
  type CalendarSystem,
  type CalendarSystemId,
  DEFAULT_SYSTEM_ID,
  getCalendarSystem,
  isCalendarSystemId,
} from '@thirteen/core';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { readStorage, writeStorage } from '../lib/storage.ts';

/** localStorage key of the persisted system choice. */
export const SYSTEM_STORAGE_KEY = 'thirteen:system';

export interface CalendarSystemContextValue {
  readonly systemId: CalendarSystemId;
  /** The frozen core descriptor for `systemId`. */
  readonly system: CalendarSystem;
  readonly setSystemId: (id: CalendarSystemId) => void;
}

const CalendarSystemContext = createContext<CalendarSystemContextValue | null>(null);

export interface CalendarSystemProviderProps {
  /** Used when nothing valid is stored. Default `'ifc'`. */
  readonly defaultSystemId?: CalendarSystemId;
  /** Persistence key; pass `null` to disable persistence. */
  readonly storageKey?: string | null;
  readonly children?: ReactNode;
}

function initialSystem(storageKey: string | null, fallback: CalendarSystemId): CalendarSystemId {
  const stored = storageKey === null ? null : readStorage(storageKey);
  return stored !== null && isCalendarSystemId(stored) ? stored : fallback;
}

/** Holds the selected 13-month system (IFC ⇄ Positivist), persisted in localStorage and synced across tabs. */
export function CalendarSystemProvider({
  defaultSystemId = DEFAULT_SYSTEM_ID,
  storageKey = SYSTEM_STORAGE_KEY,
  children,
}: CalendarSystemProviderProps) {
  const [systemId, setSystemState] = useState<CalendarSystemId>(() => initialSystem(storageKey, defaultSystemId));

  const setSystemId = useCallback(
    (id: CalendarSystemId) => {
      if (!isCalendarSystemId(id)) return;
      setSystemState(id);
      if (storageKey !== null) writeStorage(storageKey, id);
    },
    [storageKey],
  );

  useEffect(() => {
    if (storageKey === null) return undefined;
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue !== null && isCalendarSystemId(event.newValue)) {
        setSystemState(event.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  const value = useMemo<CalendarSystemContextValue>(
    () => ({ systemId, system: getCalendarSystem(systemId), setSystemId }),
    [systemId, setSystemId],
  );
  return <CalendarSystemContext.Provider value={value}>{children}</CalendarSystemContext.Provider>;
}

/** The selected system; throws outside a {@link CalendarSystemProvider}. */
export function useCalendarSystem(): CalendarSystemContextValue {
  const value = useContext(CalendarSystemContext);
  if (value === null) throw new Error('useCalendarSystem() must be used inside <CalendarSystemProvider>.');
  return value;
}

/** The selected system, or `null` outside a provider (for components that also accept a prop). */
export function useOptionalCalendarSystem(): CalendarSystemContextValue | null {
  return useContext(CalendarSystemContext);
}
