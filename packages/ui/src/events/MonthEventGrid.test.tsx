import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockupEventStore } from './mockup.ts';
import { MonthDayList, monthDayLines } from './MonthDayList.tsx';
import { type MonthDensity, MonthEventGrid } from './MonthEventGrid.tsx';
import type { StoreOccurrence } from './store.ts';

const TODAY = { year: 2026, month: 10, day: 19 }; // IFC Thursday, October 12, 2026

function data(year = 2026) {
  const store = createMockupEventStore();
  const snapshot = store.occurrencesInYear(year);
  if (snapshot.status !== 'ready') throw new Error('not ready');
  return { occurrences: snapshot.occurrences, calendars: new Map(store.getState().calendars.map((c) => [c.id, c])) };
}

function renderMonth(
  options: { month?: number; density?: MonthDensity; maxLanes?: number; occurrences?: readonly StoreOccurrence[] | null } = {},
) {
  const { occurrences, calendars } = data();
  const handlers = { onSelectDay: vi.fn(), onOpenItem: vi.fn(), onShowMore: vi.fn(), onSelectItem: vi.fn() };
  render(
    <MonthEventGrid
      year={2026}
      month={options.month ?? 11}
      systemId="ifc"
      occurrences={options.occurrences === undefined ? occurrences : options.occurrences}
      calendars={calendars}
      today={TODAY}
      selected={TODAY}
      density={options.density ?? 'full'}
      maxLanes={options.maxLanes ?? 6}
      use24Hour
      label="October 2026"
      {...handlers}
    />,
  );
  return handlers;
}

describe('MonthEventGrid (docs/EVENTS.md §2.4, §2.20)', () => {
  it('is a grid with a two-line weekday header named in both calendars', () => {
    renderMonth();
    const grid = screen.getByRole('grid', { name: 'October 2026' });
    expect(within(grid).getAllByRole('row')).toHaveLength(5); // header + 4 weeks, no band in October
    const headers = within(grid).getAllByRole('columnheader');
    expect(headers.map((h) => h.getAttribute('aria-label'))).toEqual([
      'Sunday. Gregorian Thursday',
      'Monday. Gregorian Friday',
      'Tuesday. Gregorian Saturday',
      'Wednesday. Gregorian Sunday',
      'Thursday. Gregorian Monday',
      'Friday. Gregorian Tuesday',
      'Saturday. Gregorian Wednesday',
    ]);
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(28);
  });

  it('names day cells with both dates, the event count and where a Gregorian month begins', () => {
    renderMonth();
    const today = screen.getByRole('gridcell', { current: 'date' });
    expect(today.getAttribute('aria-label')).toBe('Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.');
    expect(today.getAttribute('aria-selected')).toBe('true');
    expect(today.tabIndex).toBe(0);
    expect(
      screen.getByRole('gridcell', {
        name: 'Wednesday, October 25, 2026. Gregorian Sunday, November 1, 2026. Gregorian November begins.',
      }),
    ).toBeTruthy();
  });

  it('names chips and bars with the §2.20 labels and flags', () => {
    renderMonth();
    const today = screen.getByRole('gridcell', { current: 'date' });
    expect(within(today).getByRole('button', { name: 'Sprint planning, 09:30 to 10:30, Work, repeats' })).toBeTruthy();
    expect(
      within(today).getByRole('button', {
        name: 'Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family, continues to Gregorian Sunday, October 25',
      }),
    ).toBeTruthy();
    const wednesday = screen.getByRole('gridcell', { name: /^Saturday, October 14, 2026/ });
    expect(within(wednesday).getByRole('button', { name: 'Design review, 14:00 to 15:30, Work, invitation' })).toBeTruthy();
    const halloween = screen.getByRole('gridcell', { name: /^Tuesday, October 24, 2026/ });
    expect(within(halloween).getByRole('button', { name: 'Halloween, all day, Holidays in Estonia, read only' })).toBeTruthy();
  });

  it('moves a roving tab stop with the arrows; Enter goes into the events, Escape back, Enter opens', async () => {
    const user = userEvent.setup();
    const handlers = renderMonth();
    const today = screen.getByRole('gridcell', { current: 'date' });
    today.focus();
    await user.keyboard('{ArrowRight}');
    expect(handlers.onSelectDay).toHaveBeenLastCalledWith({ year: 2026, month: 10, day: 20 });
    expect(document.activeElement?.getAttribute('data-date')).toBe('2026-10-20');
    await user.keyboard('{ArrowLeft}{Enter}');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Autumn school break/);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Sprint planning, 09:30 to 10:30, Work, repeats');
    await user.keyboard('{Enter}');
    expect(handlers.onOpenItem).toHaveBeenCalledWith(expect.stringMatching(/Sprint|work\//), document.activeElement);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(today);
    // Tab leaves the grid: only one cell is in the tab order, and no chip.
    expect(screen.getAllByRole('gridcell').filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
    expect(
      within(today)
        .getAllByRole('button')
        .every((button) => button.tabIndex === -1),
    ).toBe(true);
  });

  it('reports hidden items as "+N more" in the last lane', async () => {
    const user = userEvent.setup();
    const handlers = renderMonth({ maxLanes: 3 });
    const today = screen.getByRole('gridcell', { current: 'date' });
    const more = within(today).getByRole('button', { name: '3 more events on Thursday, October 12, 2026' });
    expect(more.textContent).toBe('+3 more');
    await user.click(more);
    expect(handlers.onShowMore).toHaveBeenCalledWith({ year: 2026, month: 10, day: 19 }, more);
  });

  it('draws the compact densities without event targets (the day list holds them)', () => {
    renderMonth({ density: 'titles' });
    const today = screen.getByRole('gridcell', { current: 'date' });
    expect(within(today).queryAllByRole('button')).toHaveLength(0);
    expect(today.textContent).toContain('+4');
  });

  it('notches a bar on the side where it is folded into "+N" (§2.2 continuation)', () => {
    renderMonth({ density: 'titles' });
    // Amsterdam trip (October 17 to 19) is in the last of two lanes: the 17th and 18th hold more, so it is
    // in their "+2", and it is drawn on the 19th alone, notched at its start and rounded at its own end.
    const cell = (name: RegExp) => screen.getByRole('gridcell', { name });
    expect(cell(/^Tuesday, October 17, 2026\./).textContent).toContain('+2');
    expect(cell(/^Wednesday, October 18, 2026\./).textContent).toContain('+2');
    const trip = [...document.querySelectorAll('[data-key^="family/amsterdam-trip|"]')];
    expect(trip).toHaveLength(1);
    expect(cell(/^Thursday, October 19, 2026\./).contains(trip[0]!)).toBe(true);
    expect(trip[0]!.className).toContain('notchStart');
    expect(trip[0]!.className).not.toContain('notchEnd');
    // A bar drawn on all its days (Team offsite, October 5 to 7, in the first lane) keeps its rounded ends.
    const offsite = [...document.querySelectorAll('[data-key^="work/team-offsite|"]')];
    expect(offsite).toHaveLength(3);
    for (const segment of offsite) expect(segment.className).not.toMatch(/notch(Start|End)/);
  });

  it('draws up to three dots and the count in the dots density', () => {
    renderMonth({ density: 'dots' });
    const today = screen.getByRole('gridcell', { current: 'date' });
    expect(today.querySelectorAll('[style*="--cal"]').length).toBe(3);
    expect(today.textContent).toContain('5');
  });

  it('draws the grid while loading, without items', () => {
    renderMonth({ occurrences: null });
    const grid = screen.getByRole('grid', { name: 'October 2026' });
    expect(grid.getAttribute('aria-busy')).toBe('true');
    expect(within(grid).queryAllByRole('button')).toHaveLength(0);
  });

  it('puts the intercalary day in a band under week 4', () => {
    renderMonth({ month: 13 });
    const band = screen.getByRole('gridcell', {
      name: /^Year Day 2026, no weekday\. Gregorian Thursday, December 31, 2026\. 2 events\.$/,
    });
    expect(band.getAttribute('aria-colspan')).toBe('7');
    expect(
      within(band).getByRole('button', {
        name: /^New Year’s Eve dinner, 19:00 to 23:30, Family|^New Year's Eve dinner, 19:00 to 23:30, Family/,
      }),
    ).toBeTruthy();
  });
});

describe('MonthDayList (accessibility text sizes, §2.4)', () => {
  it('folds runs of empty days into one line and names days in both calendars', async () => {
    const user = userEvent.setup();
    const { occurrences, calendars } = data();
    const onOpenDay = vi.fn();
    render(
      <MonthDayList
        year={2026}
        month={11}
        systemId="ifc"
        occurrences={occurrences}
        calendars={calendars}
        today={TODAY}
        use24Hour
        label="October 2026"
        onOpenDay={onOpenDay}
      />,
    );
    const run = screen.getByRole('button', { name: 'No events, October 21 to October 23' });
    await user.click(run);
    expect(onOpenDay).toHaveBeenCalledWith({ year: 2026, month: 10, day: 28 });
    const today = screen.getByRole('listitem', { current: 'date' });
    expect(
      within(today).getByRole('button', { name: 'Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.' }),
    ).toBeTruthy();
    expect(within(today).getByRole('button', { name: '09:30, Sprint planning, Work, repeats' })).toBeTruthy();
    // At most three event lines, then "+{n} more".
    expect(within(today).queryByRole('button', { name: '15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18' })).toBeNull();
    expect(within(today).getByRole('button', { name: '+2 more' })).toBeTruthy();
  });

  it('names an intercalary day in a run by its name', () => {
    const lines = monthDayLines(2026, 13, [], 'ifc');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe('run');
  });
});
