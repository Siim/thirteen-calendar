import { render, screen, within } from '@testing-library/react';
import { agenda } from '@thirteen/core';
import { describe, expect, it } from 'vitest';
import { AgendaList } from './AgendaList.tsx';
import { formatTime, formatTimeRange } from './format.ts';
import { createMockupEventStore } from './mockup.ts';

function data() {
  const store = createMockupEventStore();
  const snapshot = store.occurrencesInYear(2026);
  if (snapshot.status !== 'ready') throw new Error('not ready');
  return {
    occurrences: snapshot.occurrences,
    byKey: new Map(snapshot.occurrences.map((o) => [o.key, o])),
    calendars: new Map(store.getState().calendars.map((c) => [c.id, c])),
  };
}

describe('times (§2.19)', () => {
  it('reads the 24 and 12-hour forms without dashes', () => {
    expect(formatTime(570, true)).toBe('09:30');
    expect(formatTime(570, false)).toBe('9:30 AM');
    expect(formatTime(0, false)).toBe('12:00 AM');
    expect(formatTime(720, false)).toBe('12:00 PM');
    expect(formatTime(1440, true)).toBe('00:00');
    expect(formatTimeRange(570, 630, false)).toBe('9:30 AM to 10:30 AM');
  });
});

describe('AgendaList (List mode, §2.7)', () => {
  it('groups days under 13-month month headers with rows named by calendar.row.a11y', () => {
    const { occurrences, byKey, calendars } = data();
    const days = agenda(occurrences, { year: 2026, month: 10, day: 19 }, { year: 2026, month: 11, day: 10 }, 'ifc');
    render(
      <AgendaList
        days={days}
        systemId="ifc"
        occurrences={byKey}
        calendars={calendars}
        use24Hour
        now={{ date: { year: 2026, month: 10, day: 19 }, minute: 9 * 60 + 41 }}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'October 2026' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'November 2026' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 3 })[0]!.textContent).toBe('Thursday, October 12Gregorian Mon, Oct 19');
    const dentist = screen.getByRole('button', { name: '15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18' });
    expect(dentist.textContent).toContain('Tartu mnt 18');
    const breaks = screen.getAllByRole('button', { name: /^All day, Autumn school break, Family, day \d of 7$/ });
    expect(breaks).toHaveLength(7); // every day it covers
    expect(breaks[1]!.textContent).toContain('Day 2 of 7');
    const sprint = screen.getAllByRole('button', { name: '09:30, Sprint planning, Work, repeats' })[0]!;
    expect(within(sprint).getByText('Now')).toBeTruthy();
    expect(sprint.textContent).toContain('until 10:30');
    expect(screen.getByRole('button', { name: '14:00, Design review, Work, Room Sol, invitation' })).toBeTruthy();
  });
});
