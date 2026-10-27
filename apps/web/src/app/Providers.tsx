import type { GregorianDate, LocalDateTime } from '@thirteen/core';
import {
  CalendarSystemProvider,
  ClockProvider,
  type EventStore,
  EventStoreProvider,
  MemoryEventStore,
  ThemeProvider,
  TodayProvider,
  ToastProvider,
} from '@thirteen/ui';
import { type ReactNode, useState } from 'react';

export interface ProvidersProps {
  /** Pin "today" (e.g. from `?today=2024-06-17` for demos); `null` follows the clock. */
  readonly today?: GregorianDate | null;
  /** Pin the wall clock (`?now=2026-10-19T09:41`, or the mockup data set's); `null` follows the clock. */
  readonly now?: LocalDateTime | null;
  /** The event store (app: ./eventStore.ts); default an empty in-memory store (tests). */
  readonly store?: EventStore;
  readonly children?: ReactNode;
}

/**
 * Theme (system/light/dark), calendar system (IFC ⇄ Positivist), a shared
 * midnight-aware "today", the event store, the wall clock in the store's
 * device zone, and the toast region (§2.11).
 */
export function Providers({ today = null, now = null, store, children }: ProvidersProps) {
  const [fallback] = useState(() => new MemoryEventStore());
  const events = store ?? fallback;
  return (
    <ThemeProvider>
      <CalendarSystemProvider>
        <TodayProvider date={today}>
          <EventStoreProvider store={events}>
            <ClockProvider now={now} zone={events.getState().deviceZone}>
              <ToastProvider>{children}</ToastProvider>
            </ClockProvider>
          </EventStoreProvider>
        </TodayProvider>
      </CalendarSystemProvider>
    </ThemeProvider>
  );
}
