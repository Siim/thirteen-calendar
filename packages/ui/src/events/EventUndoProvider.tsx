import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { useOptionalCalendarSystem } from '../hooks/CalendarSystemProvider.tsx';
import { useUse24Hour } from '../hooks/useClock.tsx';
import { useEventStore } from '../hooks/useEvents.ts';
import { useToast } from '../primitives/Toast.tsx';
import type { StoreFailedCommit } from './store.ts';
import { EventUndo } from './undo.ts';

const EventUndoContext = createContext<EventUndo | null>(null);

export interface EventUndoProviderProps {
  /** The shortcut announced with Undo: Command Z on a Mac (§2.11 Announcement). */
  readonly mac?: boolean;
  /** Focus after Undo and Redo: the restored event (§2.20). */
  readonly focusEvent?: (key: string) => void;
  /** "Show event" on a failure nobody saw. */
  readonly showEvent?: (key: string) => void;
  /** "Show" on several failures nobody saw: the list "Changes that couldn't be saved". */
  readonly showFailures?: (failures: readonly StoreFailedCommit[]) => void;
  readonly children?: ReactNode;
}

/**
 * The window's undo stack for event changes (`EventUndo`, §2.11), around the
 * screens that make changes. Needs the event store and the toast region.
 */
export function EventUndoProvider({ mac = false, focusEvent, showEvent, showFailures, children }: EventUndoProviderProps) {
  const store = useEventStore();
  const toast = useToast();
  const systemId = useOptionalCalendarSystem()?.systemId ?? 'ifc';
  const use24Hour = useUse24Hour();
  const options = { toast, mac, focusEvent, showEvent, showFailures, systemId, use24Hour };
  const [undo] = useState(() => new EventUndo(store, options));
  undo.setOptions(options);
  useEffect(() => undo.attach(), [undo]);
  return <EventUndoContext.Provider value={undo}>{children}</EventUndoContext.Provider>;
}

/** The window's undo stack (`null` outside an {@link EventUndoProvider}). */
export function useEventUndo(): EventUndo | null {
  return useContext(EventUndoContext);
}
