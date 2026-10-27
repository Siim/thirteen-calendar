import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { YearProgress } from './YearProgress.tsx';

describe('YearProgress', () => {
  it('shows 13 equal month segments plus intercalary slivers and reports progress', () => {
    const { container } = render(<YearProgress year={2026} systemId="ifc" dayOfYear={292} />);
    expect(container.querySelectorAll('[data-segment="month"]')).toHaveLength(13);
    expect(container.querySelectorAll('[data-segment="intercalary"]')).toHaveLength(1);
    const bar = screen.getByRole('progressbar', { name: 'IFC year progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('291');
    expect(bar.getAttribute('aria-valuemax')).toBe('365');
    expect(bar.getAttribute('aria-valuetext')).toBe(
      'Day 292 of 365: 79.7% of the IFC year done; October, the 11th of 13 months, day 12 of 28.',
    );
  });

  it('orders the IFC Leap Day sliver mid-year in leap years', () => {
    const { container } = render(<YearProgress year={2024} systemId="ifc" dayOfYear={169} />);
    const kinds = [...container.querySelectorAll('[data-segment]')].map((el) => el.getAttribute('data-segment'));
    expect(kinds.indexOf('intercalary')).toBe(6);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toContain('Leap Day, outside every month');
  });
});
