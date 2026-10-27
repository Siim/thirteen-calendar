import { type EventDraft, parseLocalDateTime } from '@thirteen/core';
import { MemoryEventStore, type YearSnapshot } from '@thirteen/ui';
import { createMockupEventStore, mockupCalendars } from '@thirteen/ui/mockup';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';
import { Providers } from '../../app/Providers.tsx';
import { LIST_EMPTY_YEARS_AHEAD } from './ListMode.tsx';

const TODAY = { year: 2026, month: 10, day: 19 }; // IFC Thursday, October 12, 2026
const NOW = { date: TODAY, minute: 9 * 60 + 41 };

/**
 * jsdom has no layout, so List's "end of the list is in view" observer is driven by hand: `scrollToEnd()`
 * tells every live observer that its target is in view, as the browser does when the reader reaches the end.
 */
const live = new Set<FakeObserver>();
class FakeObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  private targets: Element[] = [];
  observe(target: Element) {
    this.targets.push(target);
    live.add(this);
  }
  unobserve() {}
  disconnect() {
    live.delete(this);
  }
  takeRecords() {
    return [];
  }
  fire() {
    const entries = this.targets.map((target) => ({ isIntersecting: true, target }) as unknown as IntersectionObserverEntry);
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

async function scrollToEnd(): Promise<void> {
  await act(async () => {
    for (const observer of [...live]) observer.fire();
  });
}

/** Keeps the end of the list in view: fires until List stops observing (or 50 times). */
async function stayAtEnd(): Promise<number> {
  let fired = 0;
  while (live.size > 0 && fired < 50) {
    await scrollToEnd();
    fired++;
  }
  return fired;
}

beforeEach(() => {
  live.clear();
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

/** Every Gregorian year the page asked the store for. */
function recordYears(store: MemoryEventStore): Set<number> {
  const years = new Set<number>();
  const read = store.occurrencesInYear.bind(store);
  store.occurrencesInYear = (year: number) => {
    years.add(year);
    return read(year);
  };
  return years;
}

function renderList(store: MemoryEventStore, date: string) {
  window.history.replaceState(null, '', `/#/list/${date}`);
  return render(
    <Providers today={TODAY} now={NOW} store={store}>
      <App />
    </Providers>,
  );
}

function allDay(calendarId: string, title: string, first: string, last: string): EventDraft {
  return {
    title,
    location: '',
    notes: '',
    url: '',
    allDay: true,
    start: parseLocalDateTime(`${first}T00:00`),
    end: parseLocalDateTime(`${last}T24:00`),
    timeZone: null,
    calendarId,
    recurrence: null,
    alarms: [],
    availability: 'free',
  };
}

const rowsOf = (title: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-list-mode] [data-key]')].filter((row) => row.textContent?.includes(title));

describe('List mode (docs/EVENTS.md §2.7)', () => {
  it('merges years by key: an event across January 1 is listed once on each of its days', async () => {
    const store = new MemoryEventStore({ calendars: mockupCalendars('web'), deviceZone: 'Europe/Tallinn' });
    await store.createEvent(allDay('home', 'Lapland trip', '2026-12-30', '2027-01-02'));
    const years = recordYears(store);
    renderList(store, '2026-12-29');
    expect(rowsOf('Lapland trip')).toHaveLength(2); // December 30, Year Day (December 31)
    await scrollToEnd(); // the end of 2026 is in view: 2027 loads
    expect(years.has(2027)).toBe(true);
    const rows = rowsOf('Lapland trip');
    expect(rows.map((row) => row.textContent?.match(/Day \d of 4/)?.[0])).toEqual(['Day 1 of 4', 'Day 2 of 4', 'Day 3 of 4', 'Day 4 of 4']);
    expect(screen.getByRole('heading', { name: 'January 2027', level: 2 })).toBeTruthy();
  });

  it(`stops loading ${LIST_EMPTY_YEARS_AHEAD} empty years after its last day, then says "No upcoming events."`, async () => {
    const store = new MemoryEventStore({ calendars: mockupCalendars('web'), deviceZone: 'Europe/Tallinn' });
    const years = recordYears(store);
    renderList(store, '2026-10-19');
    expect(screen.queryByText('No upcoming events.')).toBeNull(); // still looking
    const fired = await stayAtEnd();
    expect(fired).toBeLessThan(50);
    expect(Math.max(...years)).toBe(2025 + LIST_EMPTY_YEARS_AHEAD);
    expect(screen.getByText('No upcoming events.')).toBeTruthy();
    expect(within(document.querySelector<HTMLElement>('[data-list-mode]')!).getByRole('button', { name: 'New event' })).toBeTruthy();
  });

  it('keeps loading past empty years while an event lies within reach, and lists it', async () => {
    const store = new MemoryEventStore({ calendars: mockupCalendars('web'), deviceZone: 'Europe/Tallinn' });
    await store.createEvent(allDay('home', 'Passport renewal', '2031-03-02', '2031-03-02'));
    const years = recordYears(store);
    renderList(store, '2026-10-19');
    await stayAtEnd();
    expect(rowsOf('Passport renewal')).toHaveLength(1);
    expect(Math.max(...years)).toBe(2031 + LIST_EMPTY_YEARS_AHEAD);
    expect(screen.queryByText('No upcoming events.')).toBeNull();
  });

  it('loads no later years while every calendar is hidden', async () => {
    const store = createMockupEventStore();
    for (const calendar of store.getState().calendars) await store.updateCalendar(calendar.id, { visible: false });
    const years = recordYears(store);
    renderList(store, '2026-10-19');
    expect(screen.getByText('All calendars are hidden.')).toBeTruthy();
    expect(live.size).toBe(0);
    expect([...years].every((year) => year === 2026)).toBe(true);
  });

  it('keeps the listed days on screen while the next year loads', async () => {
    const store = createMockupEventStore();
    const held = new Set([2027]);
    const loading: YearSnapshot = { status: 'loading', year: 2027 }; // one object, as the stores keep it
    const read = store.occurrencesInYear.bind(store);
    store.occurrencesInYear = (year: number): YearSnapshot => (held.has(year) ? loading : read(year));
    const listeners = new Set<() => void>();
    const subscribe = store.subscribe.bind(store);
    store.subscribe = (listener: () => void) => {
      listeners.add(listener);
      const off = subscribe(listener);
      return () => {
        listeners.delete(listener);
        off();
      };
    };
    renderList(store, '2026-10-19');
    const october = screen.getByRole('heading', { name: 'October 2026', level: 2 });
    await scrollToEnd();
    // 2027 is loading: the list is busy, and its days stay (the same elements, so the scroll position too).
    expect(document.querySelector('[data-list-mode]')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { name: 'October 2026', level: 2 })).toBe(october);
    await act(async () => {
      held.delete(2027);
      for (const listener of listeners) listener();
    });
    expect(document.querySelector('[data-list-mode]')?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByRole('heading', { name: 'January 2027', level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'October 2026', level: 2 })).toBe(october);
  });
});
