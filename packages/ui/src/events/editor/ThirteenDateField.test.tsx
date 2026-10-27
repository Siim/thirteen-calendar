import { fireEvent, render, screen, within } from '@testing-library/react';
import { type GregorianDate, parseISODate, toISODate } from '@thirteen/core';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { intlZoneResolver } from '../intlZones.ts';
import { skippedDays } from './dateField.ts';
import { DATE_PICKER_TAB_KEY, ThirteenDateField, type ThirteenDateFieldProps } from './ThirteenDateField.tsx';

function Field({ initial, onChange, ...props }: Partial<ThirteenDateFieldProps> & { readonly initial: string }) {
  const [value, setValue] = useState<GregorianDate>(parseISODate(initial));
  return (
    <>
      <ThirteenDateField
        label="Starts"
        systemId="ifc"
        today={parseISODate('2026-10-19')}
        {...props}
        value={value}
        onChange={(date) => {
          setValue(date);
          onChange?.(date);
        }}
      />
      <output data-testid="value">{toISODate(value)}</output>
    </>
  );
}

const value = () => screen.getByTestId('value').textContent;
const field = () => screen.getByRole('button', { name: /^Starts, / });
const open = () => {
  fireEvent.click(field());
  return screen.getByRole('tabpanel');
};
const year = () => screen.getByRole('spinbutton', { name: 'Year' });

describe('ThirteenDateField (§2.12, board C2)', () => {
  it('shows the IFC date on the button and both dates in its name', () => {
    render(<Field initial="2026-10-19" />);
    expect(field().textContent).toBe('IFC Thu, Oct 12, 2026');
    expect(field().getAttribute('aria-label')).toBe('Starts, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026');
    expect(field().getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('opens on the 13-month tab with the year, the slot strip and the month grid', () => {
    render(<Field initial="2026-10-19" />);
    const panel = open();
    expect(screen.getByRole('tab', { name: 'IFC' }).getAttribute('aria-selected')).toBe('true');
    expect(year().getAttribute('aria-valuetext')).toBe('2026');
    expect(within(panel).getByRole('radio', { name: 'October, month 11 of 13' }).getAttribute('aria-checked')).toBe('true');
    expect(within(panel).getAllByRole('radio')).toHaveLength(14);
    const grid = within(panel).getByRole('grid', { name: 'October 2026' });
    const selected = within(grid).getByRole('gridcell', { selected: true });
    expect(selected.getAttribute('aria-label')).toBe('Thursday, October 12. Gregorian Monday, October 19');
    expect(selected.getAttribute('aria-current')).toBe('date');
    expect(within(grid).getAllByRole('columnheader')[0]!.getAttribute('aria-label')).toBe('Sunday. Gregorian Thursday');
    expect(screen.getByText('Gregorian Monday, October 19, 2026')).toBeTruthy();
  });

  it('picks a day in the grid, and through Year Day with the keyboard', () => {
    const onChange = vi.fn();
    render(<Field initial="2026-10-19" onChange={onChange} />);
    const panel = open();
    fireEvent.click(within(panel).getByRole('gridcell', { name: 'Friday, October 13. Gregorian Tuesday, October 20' }));
    expect(value()).toBe('2026-10-20');
    fireEvent.click(within(panel).getByRole('radio', { name: 'December, month 13 of 13' }));
    const last = within(panel).getByRole('gridcell', { name: /^Saturday, December 28\./ });
    fireEvent.click(last);
    expect(value()).toBe('2026-12-30');
    fireEvent.keyDown(within(panel).getByRole('gridcell', { selected: true }), { key: 'ArrowRight' });
    expect(value()).toBe('2026-12-31');
    // Year Day replaces the grid with its badge, which keeps focus.
    const badge = within(panel).getByRole('group', { name: 'Year Day 2026. Gregorian Thursday, December 31, 2026' });
    expect(document.activeElement).toBe(badge);
    expect(within(panel).getByRole('radio', { name: 'Year Day, belongs to no month' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(badge, { key: 'ArrowRight' });
    expect(value()).toBe('2027-01-01');
  });

  it('steps the year, falling back from Leap Day and saying so', () => {
    render(<Field initial="2028-06-17" />);
    const panel = open();
    expect(within(panel).getByText(/Leap Day happens only in leap years\./)).toBeTruthy();
    fireEvent.keyDown(year(), { key: 'ArrowUp' });
    expect(value()).toBe('2029-06-17');
    expect(within(panel).getByRole('status').textContent).toBe('2029 has no Leap Day, so the date moved to June 28.');
  });

  it('keeps a leap-only repeat on leap years', () => {
    render(<Field initial="2028-06-17" leapRepeat />);
    const panel = open();
    fireEvent.keyDown(year(), { key: 'ArrowUp' });
    expect(value()).toBe('2032-06-17');
    expect(within(panel).getByRole('status').textContent).toBe('Every Leap Day happens only in leap years, so the year moved to 2032.');
  });

  it('stops at 1583', () => {
    render(<Field initial="1583-01-01" />);
    open();
    expect(year().getAttribute('aria-valuemin')).toBe('1583');
    fireEvent.keyDown(year(), { key: 'ArrowDown' });
    expect(value()).toBe('1583-01-01');
    expect(screen.getByRole('button', { name: 'Previous year' })).toHaveProperty('disabled', true);
  });

  it('remembers the Gregorian tab, and shows the IFC date in its footer', () => {
    const first = render(<Field initial="2026-10-19" />);
    open();
    fireEvent.click(screen.getByRole('tab', { name: 'Gregorian' }));
    expect(window.localStorage.getItem(DATE_PICKER_TAB_KEY)).toBe('gregorian');
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeTruthy();
    expect(screen.getByText('IFC Thursday, October 12, 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('gridcell', { name: 'Wednesday, October 21, 2026' }));
    expect(value()).toBe('2026-10-21');
    first.unmount();
    render(<Field initial="2026-10-19" />);
    open();
    expect(screen.getByRole('tab', { name: 'Gregorian' }).getAttribute('aria-selected')).toBe('true');
  });

  it('closes on Done and on Enter in the grid, giving focus back to the field', () => {
    render(<Field initial="2026-10-19" />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(field().getAttribute('aria-expanded')).toBe('false');
    const panel = open();
    const cell = within(panel).getByRole('gridcell', { selected: true });
    cell.focus();
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(field().getAttribute('aria-expanded')).toBe('false');
    // Focus goes back to the field (the editor's Ctrl+Enter then still saves).
    expect(document.activeElement).toBe(field());
  });

  it('disables the days the event’s zone skips, in both tabs, typed or picked (§2.12, Pacific/Apia 2011-12-30)', () => {
    const apia = skippedDays('Pacific/Apia', intlZoneResolver());
    // Gregorian 2011-12-29 is IFC December 27, 2011; December 28 (Gregorian 2011-12-30) never happened in Apia.
    render(<Field initial="2011-12-29" disabledDay={apia} />);
    const panel = open();
    const skipped = within(panel).getByRole('gridcell', { name: 'Saturday, December 28. Gregorian Friday, December 30' });
    expect(skipped.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(skipped);
    expect(value()).toBe('2011-12-29');
    // Right passes over it to Year Day (Gregorian December 31).
    const selected = within(panel).getByRole('gridcell', { selected: true });
    fireEvent.keyDown(selected, { key: 'ArrowRight' });
    expect(value()).toBe('2011-12-31');
    fireEvent.click(screen.getByRole('tab', { name: 'Gregorian' }));
    const gregorian = screen.getByRole('gridcell', { name: 'Friday, December 30, 2011' });
    expect(gregorian.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(gregorian);
    expect(value()).toBe('2011-12-31');
    fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Saturday, December 31, 2011' }), { key: 'ArrowLeft' });
    expect(value()).toBe('2011-12-29');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    // Typed: refused, the field keeps its date.
    fireEvent.keyDown(field(), { key: '2' });
    const input = screen.getByRole('textbox', { name: 'Starts' });
    fireEvent.change(input, { target: { value: '2011-12-30' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(value()).toBe('2011-12-29');
    window.localStorage.removeItem(DATE_PICKER_TAB_KEY);
  });

  it('keeps the Gregorian grid reachable after paging to the same month of another year, and Enter there picks that day', () => {
    render(<Field initial="2026-10-19" />);
    open();
    fireEvent.click(screen.getByRole('tab', { name: 'Gregorian' }));
    const next = screen.getByRole('button', { name: 'Next month' });
    for (let i = 0; i < 12; i++) fireEvent.click(next);
    const grid = screen.getByRole('grid', { name: 'October 2027' });
    const stops = within(grid)
      .getAllByRole('gridcell')
      .filter((cell) => cell.tabIndex === 0);
    expect(stops.map((cell) => cell.getAttribute('aria-label'))).toEqual(['Friday, October 1, 2027']);
    stops[0]!.focus();
    fireEvent.keyDown(stops[0]!, { key: 'Enter' });
    expect(value()).toBe('2027-10-01');
    expect(field().getAttribute('aria-expanded')).toBe('false');
    window.localStorage.removeItem(DATE_PICKER_TAB_KEY);
  });

  it('stops the Gregorian tab’s paging at 1583', () => {
    render(<Field initial="1583-02-10" />);
    open();
    fireEvent.click(screen.getByRole('tab', { name: 'Gregorian' }));
    const previous = screen.getByRole('button', { name: 'Previous month' });
    expect(previous).toHaveProperty('disabled', false);
    fireEvent.click(previous);
    expect(screen.getByRole('grid', { name: 'January 1583' })).toBeTruthy();
    expect(previous).toHaveProperty('disabled', true);
    window.localStorage.removeItem(DATE_PICKER_TAB_KEY);
  });

  it('lists the days in large text sizes', () => {
    render(<Field initial="2026-10-19" largeText />);
    fireEvent.click(field());
    const list = screen.getByRole('listbox', { name: 'October 2026' });
    expect(within(list).getAllByRole('option')).toHaveLength(28);
    expect(within(list).getByRole('option', { selected: true }).getAttribute('aria-label')).toBe('Thursday, October 12. Gregorian Monday, October 19. Today');
  });
});
