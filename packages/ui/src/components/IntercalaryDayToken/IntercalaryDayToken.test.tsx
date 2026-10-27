import { intercalaryDaysInYear } from '@thirteen/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IntercalaryDayToken, followsWhat } from './IntercalaryDayToken.tsx';

const occurrence = (year: number, system: 'ifc' | 'positivist', id: 'year-day' | 'leap-day') =>
  intercalaryDaysInYear(year, system).find((d) => d.id === id)!;

describe('IntercalaryDayToken', () => {
  it('says what each day directly follows', () => {
    expect(followsWhat(occurrence(2024, 'ifc', 'leap-day'))).toBe('June 28');
    expect(followsWhat(occurrence(2024, 'ifc', 'year-day'))).toBe('December 28');
    expect(followsWhat(occurrence(2024, 'positivist', 'year-day'))).toBe('Bichat 28');
    // Holy Women comes after All the Dead, not straight after Bichat 28.
    expect(followsWhat(occurrence(2024, 'positivist', 'leap-day'))).toBe('the Festival of All the Dead');
  });

  it('opens the slip’s accessible name with its only real text, the visible name (label in name)', () => {
    render(<IntercalaryDayToken occurrence={occurrence(2024, 'ifc', 'leap-day')} onSelect={() => {}} />);
    const slip = screen.getByRole('button', { name: /^Leap Day 2024/ });
    expect(slip.getAttribute('aria-label')).toContain('Gregorian Monday, June 17, 2024');
    // Code, note and Gregorian date are generated text; the name is the only text node.
    expect(slip.textContent).toBe('Leap Day');
    expect(slip.querySelector('[data-text="LD"]')).not.toBeNull();
    expect(slip.getAttribute('data-date')).toBe('2024-06-17');
  });

  it('names the slip in the calendar.band.a11y form, then its description and events, as the other platforms (§2.20)', () => {
    const yearDay = occurrence(2026, 'ifc', 'year-day');
    const { rerender } = render(<IntercalaryDayToken occurrence={yearDay} onSelect={() => {}} />);
    const description = 'Follows December 28 (always Gregorian 31 December). It belongs to no month and has no weekday.';
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe(
      `Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026. ${description}`,
    );
    rerender(<IntercalaryDayToken occurrence={yearDay} today marks={{ colors: ['#3b6fd8'], count: 1 }} onSelect={() => {}} />);
    const slip = screen.getByRole('button');
    expect(slip.getAttribute('aria-label')).toBe(
      `Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026. ${description} 1 event.`,
    );
    // Today is aria-current="date", not a word in the name.
    expect(slip.getAttribute('aria-current')).toBe('date');
    rerender(<IntercalaryDayToken occurrence={yearDay} today marks={{ colors: ['#3b6fd8'], count: 2 }} />);
    const note = screen.getByRole('note');
    expect(note.getAttribute('aria-label')).toMatch(/\. 2 events\.$/);
    expect(note.getAttribute('aria-current')).toBe('date');
    // The date part has no colon, semicolon or parenthesised system, and no "today".
    expect(note.getAttribute('aria-label')!.replace(description, '')).not.toMatch(/[:;()]|today/i);
  });

  it('plates name the day before Holy Women', () => {
    render(<IntercalaryDayToken occurrence={occurrence(2024, 'positivist', 'leap-day')} variant="plate" />);
    expect(screen.getByText(/after the Festival of All the Dead/)).toBeTruthy();
  });
});
