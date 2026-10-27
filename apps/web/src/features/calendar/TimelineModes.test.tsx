import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryEventStore } from '@thirteen/ui';
import { createMockupEventStore, mockupCalendars, mockupData } from '@thirteen/ui/mockup';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App.tsx';
import { Providers } from '../../app/Providers.tsx';

const TODAY = { year: 2026, month: 10, day: 19 }; // IFC Thursday, October 12, 2026
const NOW = { date: TODAY, minute: 9 * 60 + 41 };

const originalMatchMedia = window.matchMedia;
const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalFromPoint = document.elementFromPoint;

function regularWidth() {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('min-width: 48rem'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

/**
 * jsdom has no layout: every timeline column is 100 px wide and 1440 px tall (a pixel a minute), the
 * columns side by side from x = 0, and `elementFromPoint` finds the column under x.
 */
function stubLayout() {
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
    if (this.hasAttribute('data-timeline-day')) {
      const columns = [...document.querySelectorAll('[data-timeline-day]')];
      const left = columns.indexOf(this) * 100;
      return { x: left, y: 0, left, top: 0, right: left + 100, bottom: 1440, width: 100, height: 1440, toJSON: () => ({}) } as DOMRect;
    }
    return originalRect.call(this);
  };
  document.elementFromPoint = (x: number) => {
    const columns = [...document.querySelectorAll<HTMLElement>('[data-timeline-day]')];
    return columns[Math.floor(x / 100)] ?? null;
  };
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  document.elementFromPoint = originalFromPoint;
  window.sessionStorage.clear();
});

function renderAt(hash: string, store: MemoryEventStore = createMockupEventStore()) {
  window.history.replaceState(null, '', `/${hash}`);
  const view = render(
    <Providers today={TODAY} now={NOW} store={store}>
      <App />
    </Providers>,
  );
  return { ...view, store };
}

/** A mouse drag of `source` to minute `minute` of column `column` (0 = the week's first day). */
function dragTo(source: HTMLElement, column: number, minute: number) {
  const columns = [...document.querySelectorAll<HTMLElement>('[data-timeline-day]')];
  const from = source.closest<HTMLElement>('[data-timeline-day]')!;
  const x0 = columns.indexOf(from) * 100 + 10;
  const top = Number.parseFloat(source.style.top.match(/calc\((\d+)/)?.[1] ?? '0');
  fireEvent.pointerDown(source, { pointerId: 7, button: 0, isPrimary: true, pointerType: 'mouse', clientX: x0, clientY: top + 2 });
  fireEvent.pointerMove(window, { pointerId: 7, pointerType: 'mouse', clientX: x0 + 10, clientY: top + 20 });
  fireEvent.pointerMove(window, { pointerId: 7, pointerType: 'mouse', clientX: column * 100 + 10, clientY: minute + 2 });
  fireEvent.pointerUp(window, { pointerId: 7, pointerType: 'mouse', clientX: column * 100 + 10, clientY: minute + 2 });
}

describe('Week and Day modes (docs/EVENTS.md §2.5, §2.6, §2.11)', () => {
  it('Week shows one column per day of the 13-month week with its blocks', async () => {
    regularWidth();
    renderAt('#/week/2026-10-19');
    const thursday = await screen.findByRole('group', { name: 'Thursday, October 12. Gregorian Monday, October 19' });
    expect(within(thursday).getByRole('button', { name: 'Sprint planning, 9:30 AM to 10:30 AM, Work, repeats' })).toBeTruthy();
    expect(screen.getAllByRole('group').filter((g) => g.hasAttribute('data-timeline-day'))).toHaveLength(7);
  });

  it('a dragged block is held at its new place with an Undo toast; Undo puts it back', async () => {
    regularWidth();
    stubLayout();
    renderAt('#/week/2026-10-19');
    const lunch = await screen.findByRole('button', { name: 'Lunch with Jaan, 12:00 PM to 1:00 PM, Home' });
    act(() => dragTo(lunch, 3, 14 * 60));
    await screen.findByRole('button', { name: 'Lunch with Jaan, 2:00 PM to 3:00 PM, Home' });
    expect(screen.getByText('Event moved to Wednesday, October 11, 2026 at 2:00 PM.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByRole('button', { name: 'Lunch with Jaan, 12:00 PM to 1:00 PM, Home' });
  });

  it('a dragged repeating occurrence asks for the span before anything moves', async () => {
    regularWidth();
    stubLayout();
    renderAt('#/week/2026-10-19');
    const sprint = await screen.findByRole('button', { name: 'Sprint planning, 9:30 AM to 10:30 AM, Work, repeats' });
    act(() => dragTo(sprint, 4, 14 * 60));
    const question = await screen.findByRole('alertdialog', { name: 'This is a repeating event.' });
    expect(question.textContent).toContain('Move this event only, or this and all future events?');
    expect(screen.getByRole('button', { name: 'Sprint planning, 9:30 AM to 10:30 AM, Work, repeats' })).toBeTruthy();
    fireEvent.click(within(question).getByRole('button', { name: 'Move this event only' }));
    await screen.findByRole('button', { name: 'Sprint planning, 2:00 PM to 3:00 PM, Work, repeats' });
    expect(screen.getByText('Event moved to 2:00 PM.')).toBeTruthy();
  });

  it('after "Move future events" focus goes to the moved block, which belongs to the new series (§2.20)', async () => {
    regularWidth();
    stubLayout();
    renderAt('#/week/2026-10-19');
    const sprint = await screen.findByRole('button', { name: 'Sprint planning, 9:30 AM to 10:30 AM, Work, repeats' });
    act(() => dragTo(sprint, 5, 14 * 60));
    const question = await screen.findByRole('alertdialog', { name: 'This is a repeating event.' });
    fireEvent.click(within(question).getByRole('button', { name: 'Move future events' }));
    const friday = screen.getByRole('group', { name: 'Friday, October 13. Gregorian Tuesday, October 20' });
    const moved = await within(friday).findByRole('button', { name: 'Sprint planning, 2:00 PM to 3:00 PM, Work, repeats' });
    // The later events are a new series (a split, §4.7): its key is not the dragged one's.
    expect(moved.dataset.key).not.toMatch(/^work\/sprint-planning\|/);
    await waitFor(() => expect(document.activeElement).toBe(moved));
  });

  it('validates before holding: a calendar that cannot keep the moved repeat offers this event only (§2.11)', async () => {
    regularWidth();
    stubLayout();
    const data = mockupData();
    // A hypothetical calendar that keeps only Gregorian repeats (an Exchange account elsewhere, §3.4).
    const calendars = mockupCalendars().map((c) => (c.id === 'home' ? { ...c, thirteenRepeats: 'gregorian-only' as const } : c));
    renderAt('#/week/2026-10-19', new MemoryEventStore({ calendars, events: data.events, deviceZone: data.deviceZone }));
    const bookClub = await screen.findByRole('button', { name: 'Book club: Cotsworth, 7:00 PM to 9:00 PM, Home, repeats' });
    act(() => dragTo(bookClub, 5, 19 * 60));
    const question = await screen.findByRole('alertdialog', { name: 'This is a repeating event.' });
    expect(question.textContent).toContain('Home can’t keep the repeat this move needs, so only this event can be moved.');
    expect(within(question).getAllByRole('button').map((b) => b.textContent)).toEqual(['Move this event only', 'Cancel']);
    // Nothing moved before the choice.
    expect(screen.getByRole('group', { name: 'Thursday, October 12. Gregorian Monday, October 19' }).textContent).toContain('Book club');
    fireEvent.click(within(question).getByRole('button', { name: 'Move this event only' }));
    await screen.findByText('Event moved to Friday, October 13, 2026.');
    const friday = screen.getByRole('group', { name: 'Friday, October 13. Gregorian Tuesday, October 20' });
    expect(within(friday).getByRole('button', { name: 'Book club: Cotsworth, 7:00 PM to 9:00 PM, Home, repeats' })).toBeTruthy();
  });

  it('refuses a drop the draft check rejects: the event stays and the reason shows as a toast (§2.11)', async () => {
    regularWidth();
    stubLayout();
    const data = mockupData();
    const dentist = data.events.find((e) => e.id === 'home/dentist')!;
    const early = {
      ...dentist,
      id: 'home/early-swim',
      title: 'Early swim',
      location: '',
      start: { date: { year: 1583, month: 1, day: 1 }, minute: 15 },
      end: { date: { year: 1583, month: 1, day: 1 }, minute: 75 },
    };
    renderAt('#/day/1583-01-01', new MemoryEventStore({ calendars: mockupCalendars(), events: [early], deviceZone: data.deviceZone }));
    const swim = await screen.findByRole('button', { name: 'Early swim, 12:15 AM to 1:15 AM, Home' });
    // Up past midnight: 1582, before the first year the editor allows (§2.12, §3.1.1).
    act(() => dragTo(swim, 0, -45));
    expect((await screen.findAllByText('Choose a date from 1583 to 9999.')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Early swim, 12:15 AM to 1:15 AM, Home' })).toBeTruthy();
    expect(screen.queryByText(/^Event moved/)).toBeNull();
  });

  it('an all-day bar moves by the days the pointer moves from where it was grabbed', async () => {
    regularWidth();
    stubLayout();
    // The all-day row's cells sit above the hours (y < 0), 100 px each, like the columns under them.
    const columnRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
      if (this.hasAttribute('data-timeline-allday')) {
        const cells = [...document.querySelectorAll('[data-timeline-allday]')];
        const left = cells.indexOf(this) * 100;
        return { x: left, y: -40, left, top: -40, right: left + 100, bottom: -20, width: 100, height: 20, toJSON: () => ({}) } as DOMRect;
      }
      return columnRect.call(this);
    };
    const fromColumn = document.elementFromPoint;
    document.elementFromPoint = (x: number, y: number) =>
      y < 0 ? ([...document.querySelectorAll<HTMLElement>('[data-timeline-allday]')][Math.floor(x / 100)] ?? null) : fromColumn(x, y);
    renderAt('#/week/2026-10-19');
    // Autumn school break covers Thursday to Saturday of this week (columns 4 to 6). Grab it over
    // Saturday and drop it on Friday: one day earlier, whatever column the bar starts in.
    const bar = await screen.findByRole('button', { name: /^Autumn school break, all day, from Gregorian Monday, October 19/ });
    act(() => {
      fireEvent.pointerDown(bar, { pointerId: 8, button: 0, isPrimary: true, pointerType: 'mouse', clientX: 650, clientY: -30 });
      fireEvent.pointerMove(window, { pointerId: 8, pointerType: 'mouse', clientX: 640, clientY: -30 });
      fireEvent.pointerMove(window, { pointerId: 8, pointerType: 'mouse', clientX: 550, clientY: -30 });
      fireEvent.pointerUp(window, { pointerId: 8, pointerType: 'mouse', clientX: 550, clientY: -30 });
    });
    await screen.findByText('Event moved to Wednesday, October 11, 2026.');
    expect(screen.getByRole('button', { name: /^Autumn school break, all day, from Gregorian Sunday, October 18 to Saturday, October 24/ })).toBeTruthy();
  });

  it('Day on a phone: the week strip and the timeline', async () => {
    renderAt('#/day/2026-10-19');
    const strip = await screen.findByRole('button', { name: 'Thursday, October 12. Gregorian Monday, October 19', pressed: true });
    expect(strip).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Thursday, October 12. Gregorian Monday, October 19' })).toBeTruthy();
  });

  it('Week on a phone opens as Day (§2.1)', async () => {
    renderAt('#/week/2026-10-19');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Thursday, October 12, 2026'));
  });
});
