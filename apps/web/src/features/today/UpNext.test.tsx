import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type EventStore, MemoryEventStore } from '@thirteen/ui';
import { createMockupEventStore } from '@thirteen/ui/mockup';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App.tsx';
import { Providers } from '../../app/Providers.tsx';

const TODAY = { year: 2026, month: 10, day: 19 }; // IFC Thursday, October 12, 2026
const NOW = { date: TODAY, minute: 9 * 60 + 41 };

function renderAt(hash: string, store: EventStore) {
  window.history.replaceState(null, '', `/${hash}`);
  return render(
    <Providers today={TODAY} now={NOW} store={store}>
      <App />
    </Providers>,
  );
}

function localOnly(): MemoryEventStore {
  const mockup = createMockupEventStore();
  const local = mockup.getState().calendars.filter((calendar) => calendar.kind === 'local');
  return new MemoryEventStore({ calendars: local, events: [], deviceZone: 'Europe/Tallinn' });
}

describe('Today: Up next (docs/EVENTS.md §2.8)', () => {
  it('sits under the hero with the mockup rows, "+" and "Show all in Calendar" (List from today)', async () => {
    renderAt('#/today', createMockupEventStore());
    const card = await screen.findByRole('region', { name: 'Up next' });
    // Under the hero, before the year so far.
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!;
    expect(hero.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // jsdom's locale (en-US) reads 12-hour times.
    expect(within(card).getByRole('button', { name: '3:40 PM, Dentist, Dr. Tamm, Home, Tartu mnt 18' })).toBeTruthy();
    expect(within(card).getByText('5 more in the next 7 days')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'New event' })).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Show all in Calendar' }).getAttribute('href')).toBe('#/list/2026-10-19');
  });

  it('is not shown before a local calendar holds an event or a subscription exists (Windows and web rule)', async () => {
    const store = localOnly();
    renderAt('#/today', store);
    await screen.findByRole('heading', { level: 1 });
    await act(async () => {
      await store.loadYear(2026);
      await store.loadYear(2027);
    });
    expect(screen.queryByRole('region', { name: 'Up next' })).toBeNull();

    // The first event appears: so does the card.
    const calendarId = store.getState().calendars[0]!.id;
    await act(async () => {
      await store.createEvent({
        title: 'Dentist',
        location: '',
        notes: '',
        url: '',
        allDay: false,
        start: { date: { year: 2026, month: 10, day: 21 }, minute: 10 * 60 },
        end: { date: { year: 2026, month: 10, day: 21 }, minute: 11 * 60 },
        timeZone: 'Europe/Tallinn',
        calendarId,
        recurrence: null,
        alarms: [],
        availability: 'busy',
      });
    });
    const card = await screen.findByRole('region', { name: 'Up next' });
    expect(within(card).getByText('Nothing else today.')).toBeTruthy();
    expect(within(card).getByRole('button', { name: /^10:00 AM, Dentist, / })).toBeTruthy();
  });

  it('Delete or Backspace on a focused row asks to delete that event (§2.21; web review issue 16)', async () => {
    const user = userEvent.setup();
    renderAt('#/today', createMockupEventStore());
    const card = await screen.findByRole('region', { name: 'Up next' });
    const row = within(card).getByRole('button', { name: '3:40 PM, Dentist, Dr. Tamm, Home, Tartu mnt 18' });
    for (const key of ['{Delete}', '{Backspace}']) {
      act(() => row.focus());
      await user.keyboard(key);
      const asked = await screen.findByRole('alertdialog', { name: 'Delete this event?' });
      await user.click(within(asked).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Delete this event?' })).toBeNull());
    }
    // Other keys on a row ask nothing.
    act(() => row.focus());
    await user.keyboard('x');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('"Show calendars" opens the Calendars sheet with focus on the first hidden calendar', async () => {
    const user = userEvent.setup();
    const store = createMockupEventStore();
    for (const calendar of store.getState().calendars) await store.updateCalendar(calendar.id, { visible: false });
    renderAt('#/today', store);
    const card = await screen.findByRole('region', { name: 'Up next' });
    expect(within(card).getByText('All calendars are hidden.')).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Show calendars' }));
    const sheet = await screen.findByRole('dialog', { name: 'Calendars' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-calendar-visibility')).toBe(store.getState().calendars[0]!.id));
    expect(sheet.contains(document.activeElement)).toBe(true);
  });
});
