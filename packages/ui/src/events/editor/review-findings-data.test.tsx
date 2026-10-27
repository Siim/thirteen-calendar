/**
 * Review findings (data integrity): the editor's all-day toggle must give the
 * zone back exactly (§2.11: "turning all-day on and off again changes nothing").
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { type CalendarEvent, type LocalDateTime, parseLocalDateTime } from '@thirteen/core';
import { describe, expect, it, vi } from 'vitest';
import { CalendarSystemProvider } from '../../hooks/CalendarSystemProvider.tsx';
import { ClockProvider } from '../../hooks/useClock.tsx';
import { EventStoreProvider } from '../../hooks/useEvents.ts';
import { ToastProvider } from '../../primitives/Toast.tsx';
import { EventUndoProvider } from '../EventUndoProvider.tsx';
import { MemoryEventStore } from '../MemoryEventStore.ts';
import { mockupCalendars } from '../mockup.ts';
import { EventEditor } from './EventEditor.tsx';

const NOW: LocalDateTime = parseLocalDateTime('2026-10-19T09:41');

/** A floating event (no TZID, as many files from other apps hold): 07:00 wherever the device is. */
const floating: CalendarEvent = {
  id: 'home/wake-up',
  title: 'Wake up',
  location: '',
  notes: '',
  url: '',
  allDay: false,
  start: parseLocalDateTime('2026-10-21T07:00'),
  end: parseLocalDateTime('2026-10-21T07:30'),
  timeZone: null,
  calendarId: 'home',
  recurrence: null,
  alarms: [],
  availability: 'busy',
  status: 'confirmed',
  readOnly: null,
  organizer: null,
  attendeeCount: 0,
  alarmsEditable: true,
  selfStatus: null,
};

function roundTrip(event: CalendarEvent) {
  const store = new MemoryEventStore({ calendars: mockupCalendars('web'), events: [event], deviceZone: 'Europe/Tallinn' });
  const onClose = vi.fn();
  render(
    <CalendarSystemProvider storageKey={null}>
      <EventStoreProvider store={store}>
        <ClockProvider now={NOW} zone="Europe/Tallinn" use24Hour>
          <ToastProvider>
            <EventUndoProvider>
              <EventEditor request={{ kind: 'edit', key: 'home/wake-up|2026-10-21T07:00' }} onClose={onClose} alerts="supported" historyGuard={false} />
            </EventUndoProvider>
          </ToastProvider>
        </ClockProvider>
      </EventStoreProvider>
    </CalendarSystemProvider>,
  );
  const editor = screen.getByRole('dialog', { name: 'Edit event' });
  const allDay = within(editor).getByRole('checkbox', { name: 'All-day' });
  fireEvent.click(allDay);
  fireEvent.click(allDay);
  const revision = store.getState().revision;
  fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
  return { store, revision };
}

describe('EventEditor: All-day on and off (§2.11, §5.2 setDraftAllDay)', () => {
  it('a zoned event: changes nothing (control)', () => {
    const { store, revision } = roundTrip({ ...floating, timeZone: 'Europe/Tallinn' });
    expect(store.getState().revision).toBe(revision);
    expect(store.getEvent('home/wake-up')!.timeZone).toBe('Europe/Tallinn');
  });

  it('a floating event: changes nothing, it stays floating and Save writes nothing', () => {
    const { store, revision } = roundTrip(floating);
    // Unchanged: closes without a write, and the event is still floating.
    expect.soft(store.getEvent('home/wake-up')!.timeZone).toBeNull();
    expect.soft(store.getState().revision).toBe(revision);
  });
});
