import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CalendarEvent } from '@thirteen/core';
import { describe, expect, it, vi } from 'vitest';
import { MemoryEventStore } from '../MemoryEventStore.ts';
import { mockupCalendars, mockupData } from '../mockup.ts';
import type { ResolvedOccurrence } from '../store.ts';
import { EventDetails, type EventDetailsActions, detailsOffers, mapsUrl } from './EventDetails.tsx';

const data = mockupData();
const calendars = mockupCalendars('web');
const historical: CalendarEvent = {
  ...data.events.find((e) => e.id === 'home/dentist')!,
  id: 'home/old-visit',
  title: 'Old visit',
  readOnly: 'historical',
};
const abroad: CalendarEvent = {
  ...data.events.find((e) => e.id === 'work/kodak-call')!,
  id: 'work/rochester',
  title: 'Rochester call',
  timeZone: 'America/New_York',
  url: 'https://kodak.example/archive',
  notes: 'Agenda at https://kodak.example/agenda.',
  availability: 'free',
  alarms: [{ kind: 'relative', offsetMinutes: -10 }],
};
const store = new MemoryEventStore({ calendars, events: [...data.events, historical, abroad], deviceZone: data.deviceZone });

function resolve(key: string): ResolvedOccurrence {
  const resolved = store.resolveOccurrence(key);
  if (resolved === null) throw new Error(`no occurrence ${key}`);
  return resolved;
}

function renderDetails(key: string, actions: EventDetailsActions = {}) {
  const resolved = resolve(key);
  const calendar = calendars.find((c) => c.id === resolved.draft.calendarId) ?? null;
  const all: Required<EventDetailsActions> = {
    onEdit: vi.fn(),
    onEditAlerts: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    ...actions,
  };
  render(<EventDetails resolved={resolved} calendar={calendar} systemId="ifc" use24Hour deviceZone="Europe/Tallinn" {...all} />);
  return all;
}

const buttons = () => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent);
const rows = () =>
  Object.fromEntries([...document.querySelectorAll('dt')].map((dt) => [dt.textContent, (dt.nextElementSibling as HTMLElement).textContent]));

describe('EventDetails (§2.10, board A2)', () => {
  it('shows a writable event in both calendars with Edit, More and Delete event', () => {
    const actions = renderDetails('home/dentist|2026-10-19T15:40');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Dentist, Dr. Tamm');
    expect(screen.getByText('Thursday, October 12, 2026')).toBeTruthy();
    expect(screen.getByText('Gregorian Monday, October 19, 2026')).toBeTruthy();
    expect(rows()).toMatchObject({ Time: '15:40 to 16:20', Calendar: 'Home, In this browser', Location: 'Tartu mnt 18' });
    expect(screen.getByRole('link', { name: 'Tartu mnt 18' }).getAttribute('href')).toBe(mapsUrl('Tartu mnt 18'));
    expect(buttons()).toEqual(['Edit', 'More', 'Delete event']);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(actions.onEdit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));
    expect(actions.onDelete).toHaveBeenCalled();
  });

  it('duplicates from the More menu', () => {
    const actions = renderDetails('home/dentist|2026-10-19T15:40');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(actions.onDuplicate).toHaveBeenCalled();
  });

  it('shows the repeat in 13-month words', () => {
    renderDetails('home/book-club|2026-10-19T19:00');
    expect(rows().Repeat).toBe('Every IFC month on the 12th');
  });

  it('names the event’s own zone, links URL and notes, and says Free', () => {
    renderDetails('work/rochester|2026-10-15T16:00');
    const time = rows().Time;
    expect(time).toContain('In New York: 16:00 to 16:45');
    expect(rows()['Show as']).toBe('Free');
    expect(rows().Alerts).toBe('10 minutes before');
    expect(screen.getByRole('link', { name: 'https://kodak.example/archive' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'https://kodak.example/agenda' }).getAttribute('href')).toBe('https://kodak.example/agenda');
  });

  it('shows Starts and Ends for an event over several days', () => {
    renderDetails('work/team-offsite|2026-10-12');
    expect(screen.getByText('Starts')).toBeTruthy();
    expect(screen.getByText('Ends')).toBeTruthy();
    expect(screen.getByText('Gregorian Wednesday, October 14, 2026')).toBeTruthy();
    expect(rows().Time).toBe('All day');
  });

  it('offers only Duplicate on a subscribed event, with its reason', () => {
    renderDetails('holidays/halloween|2026-10-31');
    expect(screen.getByText('This event is in a subscribed calendar, so it can’t be changed here.')).toBeTruthy();
    expect(buttons()).toEqual(['More']);
  });

  it('offers Edit alerts and Delete event on an event before 1583 (historical)', () => {
    const actions = renderDetails('home/old-visit|2026-10-19T15:40');
    expect(screen.getByText('Thirteen can’t change events that start before 1583, except to delete them or change their alerts.')).toBeTruthy();
    expect(buttons()).toEqual(['Edit alerts', 'More', 'Delete event']);
    fireEvent.click(screen.getByRole('button', { name: 'Edit alerts' }));
    expect(actions.onEditAlerts).toHaveBeenCalled();
    expect(detailsOffers(resolve('home/old-visit|2026-10-19T15:40'))).toEqual({ edit: false, editAlerts: true, delete: true, duplicate: true });
  });

  it('offers Edit alerts on an invitation whose alerts can change', () => {
    renderDetails('work/design-review|2026-10-21T14:00');
    expect(screen.getByText('You’re invited to this event. Reply to it or change it in your calendar app.')).toBeTruthy();
    expect(buttons()).toEqual(['Edit alerts', 'More']);
    expect(within(document.body).queryByRole('button', { name: 'Delete event' })).toBeNull();
  });
});
