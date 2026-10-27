import { fireEvent, render, screen, within } from '@testing-library/react';
import { type LocalDateTime, toThirteen } from '@thirteen/core';
import { describe, expect, it, vi } from 'vitest';
import { CalendarSystemProvider } from '../hooks/CalendarSystemProvider.tsx';
import { ClockProvider } from '../hooks/useClock.tsx';
import { EventStoreProvider } from '../hooks/useEvents.ts';
import { TodayProvider } from '../hooks/useToday.tsx';
import { useUpNext } from '../hooks/useUpNext.ts';
import { MemoryEventStore } from './MemoryEventStore.ts';
import { createMockupEventStore } from './mockup.ts';
import type { EventStore } from './store.ts';
import { UpNextCard } from './UpNextCard.tsx';

const TODAY = { year: 2026, month: 10, day: 19 };
const NOW: LocalDateTime = { date: TODAY, minute: 9 * 60 + 41 };

function Card({ onOpen, onNewEvent, onShowCalendars }: { onOpen?: () => void; onNewEvent?: () => void; onShowCalendars?: () => void }) {
  const state = useUpNext();
  return (
    <UpNextCard
      result={state.result}
      occurrences={state.occurrences}
      calendars={state.calendars}
      use24Hour
      now={state.now}
      today={state.today}
      todayThirteen={toThirteen(state.today, 'ifc')}
      allHidden={state.allHidden}
      onShowCalendars={onShowCalendars}
      onOpen={onOpen}
      onNewEvent={onNewEvent}
      showAll={<a href="#/list/2026-10-19">Show all in Calendar</a>}
    />
  );
}

function renderCard(store: EventStore, now: LocalDateTime = NOW, handlers: Parameters<typeof Card>[0] = {}) {
  return render(
    <CalendarSystemProvider storageKey={null}>
      <TodayProvider date={now.date}>
        <EventStoreProvider store={store}>
          <ClockProvider now={now} zone="Europe/Tallinn" use24Hour>
            <Card {...handlers} />
          </ClockProvider>
        </EventStoreProvider>
      </TodayProvider>
    </CalendarSystemProvider>,
  );
}

describe('UpNextCard (docs/EVENTS.md §2.8, board B1)', () => {
  it('draws board B1: Today, Tomorrow, the Now plate, the §2.20 row names and "5 more in the next 7 days"', async () => {
    const onOpen = vi.fn();
    const onNewEvent = vi.fn();
    renderCard(createMockupEventStore(), NOW, { onOpen, onNewEvent });
    const card = await screen.findByRole('region', { name: 'Up next' });
    expect(within(card).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Today', 'Tomorrow']);
    const rows = within(card).getAllByRole('button', { pressed: false });
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'All day, Autumn school break, Family, day 1 of 7',
      '09:30, Sprint planning, Work, repeats',
      '11:00, 1:1 with Marta, Work, repeats',
      '15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18',
      '19:00, Book club: Cotsworth, Home, Raamatukoi, repeats',
      '07:15, Yoga, Running club, repeats',
    ]);
    // The running event wears the Now plate; the others do not.
    expect(within(rows[1]!).getByText('Now')).toBeTruthy();
    expect(within(card).getAllByText('Now')).toHaveLength(1);
    expect(within(rows[0]!).getByText('Day 1 of 7')).toBeTruthy();
    expect(within(rows[2]!).getByText('until 11:30')).toBeTruthy();
    expect(within(card).getByText('5 more in the next 7 days')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Show all in Calendar' }).getAttribute('href')).toBe('#/list/2026-10-19');

    fireEvent.click(rows[3]!);
    expect(onOpen).toHaveBeenCalledWith(rows[3]!.getAttribute('data-key'), rows[3]);
    fireEvent.click(within(card).getByRole('button', { name: 'New event' }));
    expect(onNewEvent).toHaveBeenCalledTimes(1);
  });

  it('heads days after tomorrow in both calendars, and drops what ended', async () => {
    // Tuesday, October 20, 2026 at 23:00: Yoga is over; Wednesday holds the design review, Saturday the trip.
    renderCard(createMockupEventStore(), { date: { year: 2026, month: 10, day: 20 }, minute: 23 * 60 });
    const card = await screen.findByRole('region', { name: 'Up next' });
    const headings = within(card).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Today');
    expect(headings[1]).toBe('Tomorrow');
    expect(headings[2]).toBe('Tuesday, October 17Gregorian Sat, Oct 24');
    expect(within(card).queryByRole('button', { name: /Yoga/ })).toBeNull();
    // Only the all-day school break is left today.
    expect(within(card).getAllByRole('button', { name: /Autumn school break/ })).toHaveLength(1);
  });

  it('says "Nothing else today." and "No events in the next 7 days."', async () => {
    const store = createMockupEventStore();
    // Saturday, December 26, 2026 at 23:30: nothing left today; the winter break starts on the 28th.
    const view = renderCard(store, { date: { year: 2026, month: 12, day: 26 }, minute: 23 * 60 + 30 });
    const card = await screen.findByRole('region', { name: 'Up next' });
    expect(within(card).getByText('Nothing else today.')).toBeTruthy();
    expect(within(card).getAllByRole('heading', { level: 3 })[0]!.textContent).toBe('Today');
    view.unmount();

    const empty = new MemoryEventStore({ calendars: store.getState().calendars, events: [], deviceZone: 'Europe/Tallinn' });
    renderCard(empty);
    const emptyCard = await screen.findByRole('region', { name: 'Up next' });
    expect(within(emptyCard).getByText('No events in the next 7 days.')).toBeTruthy();
    expect(within(emptyCard).queryByText('Nothing else today.')).toBeNull();
  });

  it('with every calendar hidden: "All calendars are hidden." and "Show calendars"', async () => {
    const store = createMockupEventStore();
    for (const calendar of store.getState().calendars) await store.updateCalendar(calendar.id, { visible: false });
    const onShowCalendars = vi.fn();
    renderCard(store, NOW, { onShowCalendars });
    const card = await screen.findByRole('region', { name: 'Up next' });
    expect(within(card).getByText('All calendars are hidden.')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Show calendars' }));
    expect(onShowCalendars).toHaveBeenCalledTimes(1);
  });
});
