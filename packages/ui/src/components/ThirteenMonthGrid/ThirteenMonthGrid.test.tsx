import { buildThirteenMonth, gregorianDate } from '@thirteen/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThirteenMonthGrid } from './ThirteenMonthGrid.tsx';

const october = buildThirteenMonth(2026, 11, 'ifc');
const today = gregorianDate(2026, 10, 19);

describe('ThirteenMonthGrid', () => {
  it('renders a perfect 4 × 7 grid: 28 cells, 4 rows, 7 weekday columns', () => {
    render(<ThirteenMonthGrid layout={october} today={today} />);
    const grid = screen.getByRole('grid', { name: /October/ });
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(28);
    expect(within(grid).getAllByRole('columnheader')).toHaveLength(7);
    // 1 header row + 4 weeks
    expect(within(grid).getAllByRole('row')).toHaveLength(5);
    expect(within(grid).getAllByRole('columnheader')[0]!.getAttribute('abbr')).toBe('Sunday');
  });

  it('labels every cell with both dates, 13-month first, in the calendar.cell.a11y form of §2.20', () => {
    render(<ThirteenMonthGrid layout={october} today={today} />);
    // Today is aria-current="date", not a word in the name (as the Month cells and the other platforms).
    const cell = screen.getByRole('gridcell', { name: 'Thursday, October 12, 2026. Gregorian Monday, October 19, 2026.' });
    expect(cell.getAttribute('aria-current')).toBe('date');
    const first = screen.getByRole('gridcell', { name: /^Sunday, October 1, 2026\./ });
    expect(first.getAttribute('aria-label')).toBe('Sunday, October 1, 2026. Gregorian Thursday, October 8, 2026.');
    expect(first.getAttribute('aria-current')).toBeNull();
    // Gregorian November begins inside IFC October (IFC October 25 = 1 November)
    expect(
      screen.getByRole('gridcell', {
        name: 'Wednesday, October 25, 2026. Gregorian Sunday, November 1, 2026. Gregorian November begins.',
      }),
    ).toBeTruthy();
    // No colon, semicolon or parenthesised system anywhere (§2.20: "Gregorian", a space, the date).
    for (const gridcell of screen.getAllByRole('gridcell')) expect(gridcell.getAttribute('aria-label')).not.toMatch(/[:;()]/);
  });

  it('adds the day\'s events after the Gregorian month start (Year mode, §2.3, §2.20)', () => {
    const marks = new Map([
      [292, { colors: ['#3b6fd8'], count: 5 }],
      [298, { colors: ['#3b6fd8', '#c2410c'], count: 1 }],
      [300, { colors: [], count: 0 }],
    ]);
    render(<ThirteenMonthGrid layout={october} today={today} marks={marks} />);
    // dayOfYear 292 = IFC October 12 = Gregorian October 19 (today).
    const todayCell = screen.getByRole('gridcell', {
      name: 'Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.',
    });
    expect(todayCell.getAttribute('aria-current')).toBe('date');
    // dayOfYear 298 = IFC October 18 = Gregorian October 25; 305 = IFC October 25 = Gregorian November 1.
    expect(
      screen.getByRole('gridcell', { name: 'Wednesday, October 18, 2026. Gregorian Sunday, October 25, 2026. 1 event.' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('gridcell', { name: 'Friday, October 20, 2026. Gregorian Tuesday, October 27, 2026.' }),
    ).toBeTruthy();
  });

  it('reads the Gregorian month start before the events', () => {
    render(<ThirteenMonthGrid layout={october} marks={new Map([[305, { colors: ['#3b6fd8'], count: 3 }]])} />);
    expect(
      screen.getByRole('gridcell', {
        name: 'Wednesday, October 25, 2026. Gregorian Sunday, November 1, 2026. Gregorian November begins. 3 events.',
      }),
    ).toBeTruthy();
  });

  it('keeps the numeral as the only visible text, so it is part of the accessible name (WCAG 2.5.3)', () => {
    render(<ThirteenMonthGrid layout={october} today={today} showGregorian />);
    // IFC October 25 carries the "Nov" tab and the Gregorian "1" overlay, both generated text.
    const cell = screen.getByRole('gridcell', { name: /^Wednesday, October 25, 2026\./ });
    expect(cell.textContent).toBe('25');
    expect(cell.querySelector('[data-text="Nov"]')).not.toBeNull();
    expect(cell.querySelector('[data-text="1"]')).not.toBeNull();
    const first = screen.getByRole('gridcell', { name: /^Sunday, October 1, 2026\./ });
    expect(first.textContent).toBe('1');
    expect(first.querySelector('[data-text="Oct 8"]')).not.toBeNull();
  });

  it('uses a roving tab stop that starts on today and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<ThirteenMonthGrid layout={october} today={today} />);
    const cells = screen.getAllByRole('gridcell');
    expect(cells.filter((c) => c.tabIndex === 0)).toHaveLength(1);
    expect(cells[11]!.tabIndex).toBe(0); // October 12

    await user.tab();
    expect(document.activeElement).toBe(cells[11]);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cells[12]);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cells[19]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(cells[14]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(cells[20]);
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(cells[6]);
    // Single-month grids stop at their edges.
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(cells[6]);
    await user.keyboard('{Home}{ArrowLeft}');
    expect(document.activeElement).toBe(cells[0]);
    expect(cells.filter((c) => c.tabIndex === 0)).toEqual([cells[0]]);
  });

  it('selects with click, Enter and Space', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ThirteenMonthGrid layout={october} today={today} onSelect={onSelect} />);
    await user.click(screen.getByRole('gridcell', { name: /^Tuesday, October 3, 2026\./ }));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ gregorian: { year: 2026, month: 10, day: 10 } }));
    await user.keyboard('{ArrowRight}{Enter}');
    expect(onSelect.mock.lastCall![0].thirteen.day).toBe(4);
    await user.keyboard('{ArrowRight} ');
    expect(onSelect.mock.lastCall![0].thirteen.day).toBe(5);
  });

  it('marks the selected day with aria-selected', () => {
    render(<ThirteenMonthGrid layout={october} selected={gregorianDate(2026, 10, 20)} onSelect={() => {}} />);
    const selected = screen.getAllByRole('gridcell').filter((c) => c.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.getAttribute('aria-label')).toContain('Friday, October 13, 2026');
  });

  it('shows the Gregorian overlay only when asked', () => {
    const { container, rerender } = render(<ThirteenMonthGrid layout={october} />);
    const cell = () => container.querySelector('[data-date="2026-10-19"]')!;
    expect(cell().querySelector('[data-text]')).toBeNull();
    rerender(<ThirteenMonthGrid layout={october} showGregorian />);
    // The overlay is generated text (data-text), so the numeral stays the visible label.
    expect(cell().textContent).toBe('12');
    expect(cell().querySelector('[data-text="19"]')).not.toBeNull();
  });

  it('starts Positivist months on Monday', () => {
    render(<ThirteenMonthGrid layout={buildThirteenMonth(2026, 11, 'positivist')} />);
    expect(screen.getAllByRole('columnheader')[0]!.getAttribute('abbr')).toBe('Monday');
    expect(screen.getAllByRole('gridcell')[0]!.getAttribute('aria-label')).toBe(
      'Monday, Descartes 1, 238. Gregorian Thursday, October 8, 2026.',
    );
  });
});
