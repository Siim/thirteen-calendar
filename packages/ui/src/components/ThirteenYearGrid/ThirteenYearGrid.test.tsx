import { buildThirteenYear, gregorianDate } from '@thirteen/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThirteenYearGrid } from './ThirteenYearGrid.tsx';

describe('ThirteenYearGrid', () => {
  it('renders 13 month grids of 28 days plus Year Day', () => {
    render(<ThirteenYearGrid layout={buildThirteenYear(2026, 'ifc')} onSelect={() => {}} />);
    expect(screen.getAllByRole('grid')).toHaveLength(13);
    expect(screen.getAllByRole('gridcell')).toHaveLength(364);
    expect(screen.getAllByRole('button', { name: /Year Day 2026/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Leap Day/ })).toBeNull();
  });

  it('puts the IFC Leap Day right after June and Year Day after December', () => {
    const { container } = render(<ThirteenYearGrid layout={buildThirteenYear(2024, 'ifc')} onSelect={() => {}} />);
    const order = Array.from(container.querySelectorAll('[data-month], [data-intercalary]')).map(
      (el) => el.getAttribute('data-month') ?? el.getAttribute('data-intercalary'),
    );
    expect(order).toEqual(['1', '2', '3', '4', '5', '6', 'leap-day', '7', '8', '9', '10', '11', '12', '13', 'year-day']);
    expect(screen.getByRole('button', { name: /Leap Day 2024/ }).getAttribute('aria-label')).toContain(
      'Gregorian Monday, June 17, 2024',
    );
  });

  it('puts both Positivist festivals at the end of a leap year', () => {
    const { container } = render(<ThirteenYearGrid layout={buildThirteenYear(2024, 'positivist')} />);
    const order = Array.from(container.querySelectorAll('[data-month], [data-intercalary]')).map(
      (el) => el.getAttribute('data-month') ?? el.getAttribute('data-intercalary'),
    );
    expect(order.slice(-3)).toEqual(['13', 'year-day', 'leap-day']);
  });

  it('navigates across months and onto intercalary days with one tab stop', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ThirteenYearGrid layout={buildThirteenYear(2024, 'ifc')} selected={gregorianDate(2024, 6, 16)} onSelect={onSelect} />,
    );
    const focusable = [...document.querySelectorAll<HTMLElement>('[tabindex="0"]')];
    expect(focusable).toHaveLength(1);
    expect(focusable[0]!.getAttribute('aria-label')).toMatch(/^Saturday, June 28, 2024/);

    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement!.getAttribute('aria-label')).toMatch(/^Leap Day 2024/);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement!.getAttribute('aria-label')).toMatch(/^Sunday, Sol 1, 2024/);
    await user.keyboard('{ArrowLeft}{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith({ year: 2024, month: 6, day: 17 }, expect.objectContaining({ id: 'leap-day' }));
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect(document.activeElement!.getAttribute('aria-label')).toMatch(/^Saturday, June 21, 2024/);
    await user.keyboard('{PageDown}');
    expect(document.activeElement!.getAttribute('aria-label')).toMatch(/^Saturday, Sol 21, 2024/);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement!.getAttribute('aria-label')).toMatch(/^Saturday, July 7, 2024/);
  });
});
