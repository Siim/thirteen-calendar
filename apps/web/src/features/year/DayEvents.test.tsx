import { render, screen, within } from '@testing-library/react';
import { type EventStore, MemoryEventStore } from '@thirteen/ui';
import { createMockupEventStore } from '@thirteen/ui/mockup';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App.tsx';
import { Providers } from '../../app/Providers.tsx';

const TODAY = { year: 2026, month: 10, day: 19 };
const NOW = { date: TODAY, minute: 9 * 60 + 41 };

function renderAt(hash: string, store: EventStore) {
  window.history.replaceState(null, '', `/${hash}`);
  return render(
    <Providers today={TODAY} now={NOW} store={store}>
      <App />
    </Providers>,
  );
}

describe('Year day sheet: Events (docs/EVENTS.md §2.9)', () => {
  it('starts with the day’s items as in Up next, "New event" and "Open in Calendar" (Day mode)', async () => {
    renderAt('#/year/2026?day=2026-10-19', createMockupEventStore());
    const panel = await screen.findByRole('complementary', { name: 'Selected day' });
    const events = panel.querySelector('[data-day-events="2026-10-19"]') as HTMLElement;
    expect(events).toBeTruthy();
    const rows = within(events).getAllByRole('button', { pressed: false });
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'All day, Autumn school break, Family, day 1 of 7',
      '9:30 AM, Sprint planning, Work, repeats',
      '11:00 AM, 1:1 with Marta, Work, repeats',
      '3:40 PM, Dentist, Dr. Tamm, Home, Tartu mnt 18',
      '7:00 PM, Book club: Cotsworth, Home, Raamatukoi, repeats',
    ]);
    expect(within(rows[1]!).getByText('Now')).toBeTruthy();
    expect(within(events).getByRole('button', { name: 'New event' })).toBeTruthy();
    expect(within(events).getByRole('link', { name: /Open in Calendar/ }).getAttribute('href')).toBe('#/day/2026-10-19');
    // The rest of the sheet is unchanged, after the events.
    const table = within(panel).getAllByRole('table')[0]!;
    expect(events.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a day without events: "No events." and "New event", no link', async () => {
    const mockup = createMockupEventStore();
    const store = new MemoryEventStore({ calendars: mockup.getState().calendars, events: [], deviceZone: 'Europe/Tallinn' });
    renderAt('#/year/2026?day=2026-10-22', store);
    const panel = await screen.findByRole('complementary', { name: 'Selected day' });
    const events = panel.querySelector('[data-day-events="2026-10-22"]') as HTMLElement;
    expect(within(events).getByText('No events.')).toBeTruthy();
    expect(within(events).getByRole('button', { name: 'New event' })).toBeTruthy();
    expect(within(events).queryByRole('link', { name: /Open in Calendar/ })).toBeNull();
  });
});
