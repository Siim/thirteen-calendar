import { type LocalDateTime, formatLocalDateTime } from '@thirteen/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockupEventStore } from './mockup.ts';
import type { StoreOccurrence } from './store.ts';
import { type TimelineCreate, type TimelineProps, Timeline, WeekStrip, stripDays } from './Timeline.tsx';

const TODAY = { year: 2026, month: 10, day: 19 };
const NOW: LocalDateTime = { date: TODAY, minute: 9 * 60 + 41 };

let occurrences: readonly StoreOccurrence[] = [];
const store = createMockupEventStore();
const calendars = new Map(store.getState().calendars.map((c) => [c.id, c]));

beforeAll(async () => {
  await store.loadYear(2026);
  const snapshot = store.occurrencesInYear(2026);
  if (snapshot.status !== 'ready') throw new Error('not loaded');
  occurrences = snapshot.occurrences;
});

const restores: (() => void)[] = [];
afterEach(() => {
  while (restores.length > 0) restores.pop()!();
});

/** Lays the columns out: each day column `width` px wide and 1440 px tall (one pixel a minute) from y = 0. */
function stubGeometry(width: number) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
    if (this.hasAttribute('data-timeline-day')) return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 1440, width, height: 1440, toJSON: () => ({}) } as DOMRect;
    if (this.dataset.timeline !== undefined || this.parentElement?.dataset.timeline !== undefined) {
      return { x: 0, y: 0, left: 0, top: 0, right: width * 7, bottom: 1440, width: width * 7, height: 1440, toJSON: () => ({}) } as DOMRect;
    }
    return original.call(this);
  };
  const OriginalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  restores.push(() => {
    HTMLElement.prototype.getBoundingClientRect = original;
    globalThis.ResizeObserver = OriginalObserver;
  });
}

function week(props: Partial<TimelineProps> = {}) {
  return render(
    <Timeline
      days={{ kind: 'week', year: 2026, month: 11, week: 2 }}
      systemId="ifc"
      occurrences={occurrences}
      calendars={calendars}
      today={TODAY}
      now={NOW}
      use24Hour
      label="October 2026, week 2"
      {...props}
    />,
  );
}

describe('Timeline (docs/EVENTS.md §2.5, §2.6, §2.20)', () => {
  it('names each column for its day in both calendars and keeps its blocks inside it, in start order', () => {
    week({ onCreate: () => {} });
    const thursday = screen.getByRole('group', { name: 'Thursday, October 12. Gregorian Monday, October 19' });
    const blocks = within(thursday)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
      .filter((name) => name !== null && name !== 'New event');
    expect(blocks).toEqual([
      'Sprint planning, 09:30 to 10:30, Work, repeats',
      '1:1 with Marta, 11:00 to 11:30, Work, repeats',
      'Dentist, Dr. Tamm, 15:40 to 16:20, Home',
      'Book club: Cotsworth, 19:00 to 21:00, Home, repeats',
    ]);
    // The column's "New event" action (§2.20) is last.
    expect(within(thursday).getAllByRole('button').at(-1)!.textContent).toBe('New event');
    expect(screen.getByRole('region', { name: 'October 2026, week 2' })).toBeTruthy();
  });

  it('keeps the hour labels that do not touch the now label on the axis (board F1: "09:41" over "10:00")', () => {
    const axisText = (minute: number) => {
      const view = week({ now: { date: TODAY, minute } });
      const labels = [...view.container.querySelectorAll('[data-timeline] [aria-hidden="true"] > span')].map((s) => s.textContent);
      view.unmount();
      return labels;
    };
    expect(axisText(9 * 60 + 41)).toEqual(expect.arrayContaining(['09:00', '09:41', '10:00']));
    // Two minutes before the hour the labels would overlap: the hour gives way.
    const close = axisText(9 * 60 + 58);
    expect(close).toContain('09:58');
    expect(close).not.toContain('10:00');
  });

  it('draws column headers with the 13-month day over the Gregorian day; today is current', () => {
    week();
    const header = screen.getByRole('button', { name: 'Thursday, October 12. Gregorian Monday, October 19' });
    expect(header.getAttribute('aria-current')).toBe('date');
    expect(header.textContent).toBe('Thu12Mon, Oct 19');
  });

  it('puts all-day and multi-day events in the all-day row with the bar label of §2.20', () => {
    week();
    const row = screen.getByRole('group', { name: 'All day' });
    expect(within(row).getByRole('button').getAttribute('aria-label')).toBe(
      'Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family, continues to Gregorian Sunday, October 25',
    );
  });

  it('adds the intercalary days after week 4 as their own columns (§2.5, board F2)', () => {
    render(
      <Timeline
        days={{ kind: 'week', year: 2026, month: 13, week: 4 }}
        systemId="ifc"
        occurrences={occurrences}
        calendars={calendars}
        today={TODAY}
        now={NOW}
        use24Hour
        label="December 2026, week 4"
      />,
    );
    const groups = screen.getAllByRole('group').filter((g) => g.hasAttribute('data-timeline-day'));
    expect(groups).toHaveLength(8);
    expect(groups[7]!.getAttribute('aria-label')).toBe('Year Day 2026, no weekday. Gregorian Thursday, December 31');
    expect(within(groups[7]!).getByRole('button', { name: /^New Year.s Eve dinner, 19:00 to 23:30, Family/ })).toBeTruthy();
    // No now line in a week without today.
    expect(document.querySelector('[data-timeline] [aria-hidden="true"]')?.textContent).not.toContain('09:41');
  });

  it('shows "+{n}" for a cluster that does not fit and lists the hidden events (board K2)', () => {
    stubGeometry(60); // 60 px columns fit one 48 px block.
    week();
    const saturday = screen.getByRole('group', { name: 'Saturday, October 14. Gregorian Wednesday, October 21' });
    const more = within(saturday).getByRole('button', { name: '2 more events at 13:00' });
    expect(more.textContent).toBe('+2');
    expect(within(saturday).queryByRole('button', { name: /^Design review/ })).toBeNull();
    fireEvent.click(more);
    const list = screen.getByRole('dialog', { name: '2 more events at 13:00' });
    expect(within(list).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      '13:00, Design review prep, Work',
      '14:00, Design review, Work, Room Sol, invitation',
    ]);
  });

  it('moves between columns with the arrows, into a column with Enter, back with Escape (§2.21)', () => {
    week();
    const thursday = screen.getByRole('group', { name: 'Thursday, October 12. Gregorian Monday, October 19' });
    expect(thursday.tabIndex).toBe(0);
    act(() => thursday.focus());
    fireEvent.keyDown(thursday, { key: 'ArrowRight' });
    const friday = screen.getByRole('group', { name: 'Friday, October 13. Gregorian Tuesday, October 20' });
    expect(document.activeElement).toBe(friday);
    fireEvent.keyDown(friday, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(thursday);
    fireEvent.keyDown(thursday, { key: 'Enter' });
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Autumn school break, all day/);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Sprint planning, 09:30 to 10:30, Work, repeats');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(thursday);
  });

  it('opens an event with Enter or a double-click and selects it on focus', () => {
    const onOpenItem = vi.fn();
    const onSelectItem = vi.fn();
    week({ onOpenItem, onSelectItem });
    const sprint = screen.getByRole('button', { name: 'Sprint planning, 09:30 to 10:30, Work, repeats' });
    act(() => sprint.focus());
    expect(onSelectItem).toHaveBeenLastCalledWith('work/sprint-planning|2026-10-19T09:30');
    fireEvent.keyDown(sprint, { key: 'Enter' });
    expect(onOpenItem).toHaveBeenCalledWith('work/sprint-planning|2026-10-19T09:30', sprint);
    fireEvent.doubleClick(sprint);
    expect(onOpenItem).toHaveBeenCalledTimes(2);
  });

  it('makes a draft from a range dragged on empty time, snapped to 15 minutes (§2.5)', () => {
    stubGeometry(120);
    const onCreate = vi.fn<(request: TimelineCreate) => void>();
    week({ onCreate });
    const friday = screen.getByRole('group', { name: 'Friday, October 13. Gregorian Tuesday, October 20' });
    fireEvent.pointerDown(friday, { pointerId: 1, button: 0, pointerType: 'mouse', clientX: 10, clientY: 10 * 60 + 5 });
    fireEvent.pointerMove(friday, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 11 * 60 + 28 });
    expect(friday.querySelector('[data-draft]')?.textContent).toBe('New event10:00 to 11:30');
    fireEvent.pointerUp(friday, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 11 * 60 + 28 });
    expect(onCreate).toHaveBeenCalledTimes(1);
    const request = onCreate.mock.calls[0]![0];
    expect(request.allDay).toBe(false);
    expect(formatLocalDateTime(request.start)).toBe('2026-10-20T10:00');
    expect(formatLocalDateTime(request.end)).toBe('2026-10-20T11:30');
  });

  it('touch and hold makes a one-hour draft at that half hour and swallows the click after the release', () => {
    vi.useFakeTimers();
    restores.push(() => vi.useRealTimers());
    stubGeometry(120);
    const onCreate = vi.fn<(request: TimelineCreate) => void>();
    week({ onCreate });
    const friday = screen.getByRole('group', { name: 'Friday, October 13. Gregorian Tuesday, October 20' });
    fireEvent.pointerDown(friday, { pointerId: 30, button: 0, pointerType: 'touch', clientX: 10, clientY: 13 * 60 + 10 });
    act(() => vi.advanceTimersByTime(550));
    expect(friday.querySelector('[data-draft]')?.textContent).toBe('New event13:00 to 14:00');
    fireEvent.pointerUp(friday, { pointerId: 30, pointerType: 'touch', clientX: 10, clientY: 13 * 60 + 10 });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(formatLocalDateTime(onCreate.mock.calls[0]![0].start)).toBe('2026-10-20T13:00');
    expect(formatLocalDateTime(onCreate.mock.calls[0]![0].end)).toBe('2026-10-20T14:00');
    // The click the browser sends after the release would land on the editor that just opened.
    const seen = vi.fn();
    document.addEventListener('click', seen, true);
    restores.push(() => document.removeEventListener('click', seen, true));
    fireEvent.click(document.body);
    expect(seen).not.toHaveBeenCalled();
    fireEvent.click(document.body);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('a double-click on empty time makes a one-hour draft at that half hour', () => {
    stubGeometry(120);
    const onCreate = vi.fn<(request: TimelineCreate) => void>();
    week({ onCreate });
    const friday = screen.getByRole('group', { name: 'Friday, October 13. Gregorian Tuesday, October 20' });
    fireEvent.doubleClick(friday, { clientX: 10, clientY: 14 * 60 + 40 });
    expect(formatLocalDateTime(onCreate.mock.calls[0]![0].start)).toBe('2026-10-20T14:30');
    expect(formatLocalDateTime(onCreate.mock.calls[0]![0].end)).toBe('2026-10-20T15:30');
  });

  it('with the placeholder, a tap draws "New event" at that half hour and a tap on it opens the editor (§2.6)', () => {
    stubGeometry(300);
    const onCreate = vi.fn<(request: TimelineCreate) => void>();
    render(
      <Timeline
        days={{ kind: 'day', date: TODAY }}
        systemId="ifc"
        occurrences={occurrences}
        calendars={calendars}
        today={TODAY}
        now={NOW}
        use24Hour
        label="Thursday, October 12, 2026"
        showHeader={false}
        placeholder
        onCreate={onCreate}
      />,
    );
    const column = screen.getByRole('group', { name: 'Thursday, October 12. Gregorian Monday, October 19' });
    fireEvent.pointerDown(column, { pointerId: 2, button: 0, pointerType: 'touch', clientX: 10, clientY: 14 * 60 + 10 });
    fireEvent.pointerUp(column, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 14 * 60 + 10 });
    // Nothing is drawn before the tap's own click: after a touch, Chromium and WebKit hit-test that
    // click after `pointerup`, so a placeholder drawn there would take it and open the editor at once.
    expect(screen.queryByRole('button', { name: /^New event, / })).toBeNull();
    fireEvent.click(column, { clientX: 10, clientY: 14 * 60 + 10 });
    const placeholder = screen.getByRole('button', { name: 'New event, 14:00 to 15:00' });
    expect(onCreate).not.toHaveBeenCalled();
    // The second tap, on the placeholder, opens the editor.
    fireEvent.pointerDown(placeholder, { pointerId: 3, button: 0, pointerType: 'touch' });
    fireEvent.pointerUp(placeholder, { pointerId: 3, pointerType: 'touch' });
    fireEvent.click(placeholder);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(formatLocalDateTime(onCreate.mock.calls[0]![0].start)).toBe('2026-10-19T14:00');
    expect(formatLocalDateTime(onCreate.mock.calls[0]![0].end)).toBe('2026-10-19T15:00');
    expect(screen.queryByRole('button', { name: 'New event, 14:00 to 15:00' })).toBeNull();
    // Day mode's all-day bar says which day of the event this is (board J1).
    expect(screen.getByRole('group', { name: 'All day' }).textContent).toContain('Day 1 of 7');
  });

  it('removes the placeholder on a tap anywhere else: other empty time, an event, outside (§2.6)', () => {
    stubGeometry(300);
    const onCreate = vi.fn<(request: TimelineCreate) => void>();
    const onSelectItem = vi.fn();
    render(
      <Timeline
        days={{ kind: 'day', date: TODAY }}
        systemId="ifc"
        occurrences={occurrences}
        calendars={calendars}
        today={TODAY}
        now={NOW}
        use24Hour
        label="Thursday, October 12, 2026"
        showHeader={false}
        placeholder
        onCreate={onCreate}
        onSelectItem={onSelectItem}
      />,
    );
    const column = screen.getByRole('group', { name: 'Thursday, October 12. Gregorian Monday, October 19' });
    const tapAt = (minute: number, pointerId: number) => {
      fireEvent.pointerDown(column, { pointerId, button: 0, pointerType: 'touch', clientX: 10, clientY: minute });
      fireEvent.pointerUp(column, { pointerId, pointerType: 'touch', clientX: 10, clientY: minute });
      fireEvent.click(column, { clientX: 10, clientY: minute });
    };
    // Other empty time: removed, not moved there.
    tapAt(13 * 60 + 20, 10);
    expect(screen.getByRole('button', { name: 'New event, 13:00 to 14:00' })).toBeTruthy();
    tapAt(17 * 60 + 20, 11);
    expect(screen.queryByRole('button', { name: /^New event, / })).toBeNull();
    // An event in the same column.
    tapAt(13 * 60 + 20, 12);
    expect(screen.getByRole('button', { name: 'New event, 13:00 to 14:00' })).toBeTruthy();
    const dentist = within(column).getByRole('button', { name: 'Dentist, Dr. Tamm, 15:40 to 16:20, Home' });
    fireEvent.pointerDown(dentist, { pointerId: 13, button: 0, pointerType: 'touch' });
    expect(screen.queryByRole('button', { name: /^New event, / })).toBeNull();
    // Outside the timeline.
    tapAt(13 * 60 + 20, 14);
    expect(screen.getByRole('button', { name: 'New event, 13:00 to 14:00' })).toBeTruthy();
    fireEvent.pointerDown(document.body, { pointerId: 15, button: 0, pointerType: 'touch' });
    expect(screen.queryByRole('button', { name: /^New event, / })).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('Day on an intercalary day: the one column takes the whole width and still folds a crowded hour (§2.6)', () => {
    stubGeometry(60); // fits one 64 px block: maxSlots 1
    const yearDay = { year: 2026, month: 12, day: 31 };
    const dinner = occurrences.find((o) => o.title === 'New Year’s Eve dinner' || o.title === "New Year's Eve dinner")!;
    const extra = [1, 2].map((i) => ({ ...dinner, key: `extra/${i}|2026-12-31T19:00`, title: `Toast ${i}` }));
    render(
      <Timeline
        days={{ kind: 'day', date: yearDay }}
        systemId="ifc"
        occurrences={[...occurrences, ...extra]}
        calendars={calendars}
        today={TODAY}
        now={NOW}
        use24Hour
        label="Year Day 2026"
        showHeader={false}
        minBlockRem={4}
      />,
    );
    const column = screen.getByRole('group', { name: 'Year Day 2026, no weekday. Gregorian Thursday, December 31' });
    expect(column.hasAttribute('data-intercalary')).toBe(true);
    // Week draws intercalary columns 60% wide; Day's single column is the whole timeline.
    const grid = column.parentElement!;
    expect(grid.style.getPropertyValue('--columns')).toBe('1fr');
    expect(within(column).getByRole('button', { name: '3 more events at 19:00' }).textContent).toBe('+3');
  });

  it('closes the "+{n}" list once its block is gone, and lists what is hidden now', () => {
    stubGeometry(60);
    const view = week();
    const saturday = screen.getByRole('group', { name: 'Saturday, October 14. Gregorian Wednesday, October 21' });
    fireEvent.click(within(saturday).getByRole('button', { name: '2 more events at 13:00' }));
    expect(screen.getByRole('dialog', { name: '2 more events at 13:00' })).toBeTruthy();
    // "Design review prep" is moved away (a row dragged out of the list): the cluster fits again.
    const moved = occurrences.map((o) =>
      o.title === 'Design review prep'
        ? { ...o, key: 'work/prep|2026-10-20T08:00', start: { ...o.start, date: { year: 2026, month: 10, day: 20 }, minute: 480 }, end: { ...o.end, date: { year: 2026, month: 10, day: 20 }, minute: 555 } }
        : o,
    );
    view.rerender(
      <Timeline
        days={{ kind: 'week', year: 2026, month: 11, week: 2 }}
        systemId="ifc"
        occurrences={moved}
        calendars={calendars}
        today={TODAY}
        now={NOW}
        use24Hour
        label="October 2026, week 2"
      />,
    );
    expect(within(saturday).queryByRole('button', { name: /more events at/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: /more events at/ })).toBeNull();
  });

  it('a long press on a block then a quick sideways stroke moves the event; it does not page (§2.6)', () => {
    stubGeometry(300);
    const onSwipe = vi.fn();
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    restores.push(() => clock.mockRestore());
    render(
      <Timeline
        days={{ kind: 'day', date: TODAY }}
        systemId="ifc"
        occurrences={occurrences}
        calendars={calendars}
        today={TODAY}
        now={NOW}
        use24Hour
        label="Thursday, October 12, 2026"
        showHeader={false}
        placeholder
        onCreate={() => {}}
        onSwipe={onSwipe}
      />,
    );
    const dentist = screen.getByRole('button', { name: 'Dentist, Dr. Tamm, 15:40 to 16:20, Home' });
    fireEvent.pointerDown(dentist, { pointerId: 20, button: 0, pointerType: 'touch', clientX: 200, clientY: 950 });
    now += 600; // held past the long press: the drag has the event
    fireEvent.pointerUp(dentist, { pointerId: 20, pointerType: 'touch', clientX: 100, clientY: 955 });
    expect(onSwipe).not.toHaveBeenCalled();
    // A quick stroke that starts on a block still pages.
    fireEvent.pointerDown(dentist, { pointerId: 21, button: 0, pointerType: 'touch', clientX: 200, clientY: 950 });
    now += 200;
    fireEvent.pointerUp(dentist, { pointerId: 21, pointerType: 'touch', clientX: 100, clientY: 955 });
    expect(onSwipe).toHaveBeenCalledWith(1);
  });

  it('changes an end by the block’s bottom edge (§2.5)', () => {
    stubGeometry(120);
    const onResize = vi.fn();
    week({ onResize });
    const dentist = screen.getByRole('button', { name: 'Dentist, Dr. Tamm, 15:40 to 16:20, Home' });
    const handle = dentist.querySelector('[data-resize-handle]')!;
    const thursday = screen.getByRole('group', { name: 'Thursday, October 12. Gregorian Monday, October 19' });
    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, pointerType: 'mouse', clientX: 10, clientY: 16 * 60 + 20 });
    fireEvent.pointerMove(thursday, { pointerId: 3, pointerType: 'mouse', clientX: 10, clientY: 17 * 60 + 4 });
    fireEvent.pointerUp(thursday, { pointerId: 3, pointerType: 'mouse', clientX: 10, clientY: 17 * 60 + 4 });
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize.mock.calls[0]![0]).toBe('home/dentist|2026-10-19T15:40');
    expect(formatLocalDateTime(onResize.mock.calls[0]![1])).toBe('2026-10-19T17:00');
  });

  it('pages with a horizontal swipe on a phone; a vertical stroke does not', () => {
    stubGeometry(300);
    const onSwipe = vi.fn();
    render(
      <Timeline
        days={{ kind: 'day', date: TODAY }}
        systemId="ifc"
        occurrences={occurrences}
        calendars={calendars}
        today={TODAY}
        now={NOW}
        use24Hour
        label="Thursday, October 12, 2026"
        showHeader={false}
        placeholder
        onCreate={() => {}}
        onSwipe={onSwipe}
      />,
    );
    const column = screen.getByRole('group', { name: 'Thursday, October 12. Gregorian Monday, October 19' });
    fireEvent.pointerDown(column, { pointerId: 4, button: 0, pointerType: 'touch', clientX: 200, clientY: 700 });
    fireEvent.pointerMove(column, { pointerId: 4, pointerType: 'touch', clientX: 120, clientY: 705 });
    fireEvent.pointerUp(column, { pointerId: 4, pointerType: 'touch', clientX: 100, clientY: 706 });
    expect(onSwipe).toHaveBeenCalledWith(1);
    fireEvent.pointerDown(column, { pointerId: 5, button: 0, pointerType: 'touch', clientX: 100, clientY: 700 });
    fireEvent.pointerMove(column, { pointerId: 5, pointerType: 'touch', clientX: 105, clientY: 750 });
    fireEvent.pointerUp(column, { pointerId: 5, pointerType: 'touch', clientX: 110, clientY: 800 });
    expect(onSwipe).toHaveBeenCalledTimes(1);
    // Neither stroke drew the placeholder.
    expect(screen.queryByRole('button', { name: /^New event, / })).toBeNull();
  });

  it('collapses the all-day row after 3 lanes into "+N", which expands it', () => {
    const base = occurrences.find((o) => o.key === 'family/school-break|2026-10-19')!;
    const bars = [0, 1, 2, 3, 4].map((i) => ({ ...base, key: `extra/${i}|2026-10-19`, title: `Bar ${i}` }));
    week({ occurrences: [...occurrences, ...bars] });
    const row = screen.getByRole('group', { name: 'All day' });
    const thursdayMore = within(row).getByRole('button', { name: '4 more events on Thursday, October 12, 2026' });
    expect(thursdayMore.textContent).toBe('+4');
    const toggle = within(row).getByRole('button', { name: 'All day' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(thursdayMore);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(row).getByRole('button', { name: /^Bar 4, all day/ })).toBeTruthy();
  });

  it('read-only events get no resize handle', () => {
    render(
      <Timeline
        days={{ kind: 'day', date: { year: 2026, month: 10, day: 31 } }}
        systemId="ifc"
        occurrences={occurrences}
        calendars={calendars}
        today={TODAY}
        now={NOW}
        use24Hour
        label="Halloween"
        showHeader={false}
        onResize={() => {}}
      />,
    );
    const bar = screen.getByRole('button', { name: /^Halloween, all day/ });
    expect(bar.hasAttribute('data-movable')).toBe(false);
    expect(document.querySelector('[data-resize-handle]')).toBeNull();
  });

  it('draws a dragged event’s ghost where it would land', () => {
    week({
      preview: {
        kind: 'timed',
        key: 'home/lunch-jaan|2026-10-16T12:00',
        start: { date: { year: 2026, month: 10, day: 18 }, minute: 14 * 60 },
        end: { date: { year: 2026, month: 10, day: 18 }, minute: 15 * 60 },
        copy: false,
      },
    });
    const wednesday = screen.getByRole('group', { name: 'Wednesday, October 11. Gregorian Sunday, October 18' });
    expect(wednesday.textContent).toContain('Lunch with Jaan14:00 to 15:00');
  });
});

describe('WeekStrip (§2.6)', () => {
  it('shows the 13-month week of the day, and adds the intercalary day after Saturday on Year Day', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <WeekStrip days={stripDays(TODAY, 'ifc')} selected={TODAY} today={TODAY} systemId="ifc" onSelect={onSelect} />,
    );
    const selected = screen.getByRole('button', { pressed: true });
    expect(selected.getAttribute('aria-label')).toBe('Thursday, October 12. Gregorian Monday, October 19');
    expect(screen.getAllByRole('button')).toHaveLength(7);
    fireEvent.keyDown(selected, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith({ year: 2026, month: 10, day: 20 });
    unmount();
    const yearDay = { year: 2026, month: 12, day: 31 };
    render(<WeekStrip days={stripDays(yearDay, 'ifc')} selected={yearDay} today={TODAY} systemId="ifc" onSelect={onSelect} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(8);
    expect(buttons[7]!.getAttribute('aria-label')).toBe('Year Day 2026, no weekday. Gregorian Thursday, December 31');
    expect(buttons[7]!.getAttribute('aria-pressed')).toBe('true');
  });
});
