import { gregorianDate, monthAlignment } from '@thirteen/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MonthBoundaryRibbon } from './MonthBoundaryRibbon.tsx';

function segments(container: HTMLElement, kind: string) {
  return container.querySelectorAll(`[data-segment="${kind}"]`);
}

describe('MonthBoundaryRibbon', () => {
  it('draws 12 ragged Gregorian segments against 13 equal ones plus Year Day', () => {
    const { container } = render(<MonthBoundaryRibbon alignment={monthAlignment(2026, 'ifc')} />);
    expect(segments(container, 'gregorian')).toHaveLength(12);
    expect(segments(container, 'thirteen')).toHaveLength(13);
    expect(segments(container, 'intercalary')).toHaveLength(1);
    const gregorian = screen.getByRole('list', { name: '12 Gregorian months' });
    expect(within(gregorian).getAllByRole('listitem')).toHaveLength(12);
    const thirteen = screen.getByRole('list', { name: /13 months of 28 days and 1 intercalary day/ });
    expect(within(thirteen).getAllByRole('listitem')).toHaveLength(14);
  });

  it('adds the leap-year sliver in leap years (IFC Leap Day mid-year)', () => {
    const { container } = render(<MonthBoundaryRibbon alignment={monthAlignment(2024, 'ifc')} />);
    const slivers = segments(container, 'intercalary');
    expect(slivers).toHaveLength(2);
    expect(slivers[0]!.getAttribute('aria-label')).toMatch(/^Leap Day/);
    // chronological: Leap Day sits between June and Sol
    const items = [...container.querySelectorAll('[data-segment="thirteen"], [data-segment="intercalary"]')];
    expect(items[6]!.getAttribute('aria-label')).toMatch(/^Leap Day/);
  });

  it('positions segments on a shared day-of-year axis and links namesakes', () => {
    const { container } = render(
      <MonthBoundaryRibbon alignment={monthAlignment(2026, 'ifc')} today={gregorianDate(2026, 10, 19)} />,
    );
    const october = segments(container, 'thirteen')[10] as HTMLElement;
    expect(october.getAttribute('aria-label')).toBe('October: 28 days, Gregorian Oct 8 to Nov 4');
    expect(october.style.getPropertyValue('--x')).toBe(`${(280 / 365) * 100}%`);
    expect(container.querySelectorAll('line')).toHaveLength(12); // Sol has no namesake
    expect(screen.getByText('+7')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('anchors year-end flags inside the right edge and stacks two of them', () => {
    const ifc = render(<MonthBoundaryRibbon alignment={monthAlignment(2024, 'ifc')} />);
    const [leap, yearDay] = [...segments(ifc.container, 'intercalary')];
    expect(leap!.hasAttribute('data-flag-stack')).toBe(false); // mid-year: centred
    expect(yearDay!.getAttribute('data-flag-stack')).toBe('0');
    expect(ifc.container.textContent).not.toContain('350'); // tick would collide with the flag
    ifc.unmount();

    const positivist = render(<MonthBoundaryRibbon alignment={monthAlignment(2024, 'positivist')} />);
    const [allTheDead, holyWomen] = [...segments(positivist.container, 'intercalary')];
    expect(allTheDead!.getAttribute('data-flag-stack')).toBe('1');
    expect(holyWomen!.getAttribute('data-flag-stack')).toBe('0');
  });

  it('keeps the Today label inside the ribbon at the ends of the year', () => {
    const { container } = render(
      <MonthBoundaryRibbon alignment={monthAlignment(2026, 'ifc')} today={gregorianDate(2026, 12, 31)} />,
    );
    expect(container.querySelector('[data-edge]')?.getAttribute('data-edge')).toBe('end');
  });

  it('links the n-th months for Positivist (no namesakes)', () => {
    const { container } = render(<MonthBoundaryRibbon alignment={monthAlignment(2026, 'positivist')} />);
    expect(container.querySelectorAll('line')).toHaveLength(12);
    expect(screen.getByText(/n-th Gregorian month/)).toBeTruthy();
  });
});
