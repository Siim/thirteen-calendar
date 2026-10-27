import { buildGregorianMonth, gregorianDate } from '@thirteen/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GregorianMonthGrid } from './GregorianMonthGrid.tsx';

describe('GregorianMonthGrid', () => {
  it('renders the ragged month with blanks and 13-month readings', () => {
    const { container } = render(
      <GregorianMonthGrid layout={buildGregorianMonth(2026, 10, 'ifc')} today={gregorianDate(2026, 10, 19)} />,
    );
    const cells = container.querySelectorAll('td[data-date]');
    expect(cells).toHaveLength(31);
    // October 2026 starts on a Thursday: 4 blanks in a Sunday-first grid.
    expect(container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td[aria-hidden="true"]')).toHaveLength(4);
    const today = screen.getByRole('gridcell', { name: /^Monday, October 19, 2026/ });
    // Gregorian first, in the form of Windows and Apple; today is aria-current="date", not a word in the name.
    expect(today.getAttribute('aria-label')).toBe('Monday, October 19, 2026. IFC Thursday, October 12, 2026.');
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(screen.getByRole('gridcell', { name: /^Thursday, October 8, 2026/ }).getAttribute('aria-label')).toBe(
      'Thursday, October 8, 2026. IFC Sunday, October 1, 2026. IFC October begins.',
    );
  });

  it('marks Gregorian days that are intercalary in the 13-month calendar', () => {
    const { container } = render(<GregorianMonthGrid layout={buildGregorianMonth(2026, 12, 'ifc')} />);
    const last = container.querySelector('[data-date="2026-12-31"]')!;
    expect(last.getAttribute('aria-label')).toBe('Thursday, December 31, 2026. IFC Year Day 2026, no weekday.');
    expect(last.querySelector('[data-text="YD"]')).not.toBeNull();
  });

  it('keeps arrow-key navigation inside the month', async () => {
    const user = userEvent.setup();
    render(<GregorianMonthGrid layout={buildGregorianMonth(2026, 10, 'ifc')} />);
    await user.tab();
    expect(document.activeElement!.getAttribute('data-date')).toBe('2026-10-01');
    await user.keyboard('{ArrowLeft}{ArrowDown}{End}');
    expect(document.activeElement!.getAttribute('data-date')).toBe('2026-10-10');
  });
});
