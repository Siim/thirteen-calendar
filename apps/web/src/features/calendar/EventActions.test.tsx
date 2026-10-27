import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CalendarEvent } from '@thirteen/core';
import { MemoryEventStore } from '@thirteen/ui';
import { mockupCalendars, mockupData } from '@thirteen/ui/mockup';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../../app/Providers.tsx';
import { type AlertPlatform, AlertsController, setAlertsControllerForTests } from '../../lib/events/alerts.ts';
import { EventActionsProvider, useEventActions } from './EventActions.tsx';

const TODAY = { year: 2026, month: 10, day: 19 };
const NOW = { date: TODAY, minute: 9 * 60 + 41 };
const DENTIST = 'home/dentist|2026-10-19T15:40';
const OLD = 'home/old-visit|2026-10-19T15:40';
const HALLOWEEN = 'holidays/halloween|2026-10-31';

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  setAlertsControllerForTests(null);
});

/** A desktop browser that can show alerts (§2.14 Web): `Notification` and a service worker. */
function alertsSupported() {
  const data = new Map<string, string>();
  const platform: AlertPlatform = {
    env: { hasNotification: true, hasServiceWorker: true, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0', maxTouchPoints: 0, standalone: false, mobileHint: null },
    storage: { get: (key) => data.get(key) ?? null, set: (key, value) => void data.set(key, value) },
    base: '/',
    permission: () => 'default',
    requestPermission: () => Promise.resolve('default'),
    register: () => Promise.resolve(),
    unregister: () => Promise.resolve(),
    ready: () => new Promise(() => {}),
    watchPermission: () => () => {},
  };
  setAlertsControllerForTests(new AlertsController(platform));
}

/** Regular width (48rem and wider): details open as a popover on their item. */
function regularWidth() {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('min-width: 48rem'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

function createStore() {
  const data = mockupData();
  // An event the store keeps but Thirteen cannot change (§2.10): only Delete and Edit alerts.
  const past: CalendarEvent = { ...data.events.find((e) => e.id === 'home/dentist')!, id: 'home/old-visit', title: 'Old visit', readOnly: 'historical' };
  return new MemoryEventStore({ calendars: mockupCalendars('web'), events: [...data.events, past], deviceZone: data.deviceZone });
}

/** Stand-ins for the views: an item per key that opens its details, and the shortcuts. */
function Items({ keys }: { readonly keys: readonly string[] }) {
  const actions = useEventActions();
  return (
    <ul>
      {keys.map((key) => (
        <li key={key}>
          <button type="button" data-key={key} onClick={(event) => actions.openDetails(key, event.currentTarget)}>
            {key}
          </button>
          <button type="button" onClick={() => actions.edit(key)}>
            {`edit ${key}`}
          </button>
        </li>
      ))}
      <li>
        <button type="button" onClick={() => actions.undo()}>
          undo
        </button>
      </li>
    </ul>
  );
}

function renderLayer(keys: readonly string[] = [DENTIST, OLD, HALLOWEEN]) {
  const store = createStore();
  render(
    <Providers today={TODAY} now={NOW} store={store}>
      <EventActionsProvider defaultCalendarId="home">
        <Items keys={keys} />
      </EventActionsProvider>
    </Providers>,
  );
  return store;
}

const item = (key: string) => screen.getByRole('button', { name: key });

describe('EventActions: details, delete and undo (§2.10, §2.11)', () => {
  it('opens details as a popover at regular width', () => {
    regularWidth();
    renderLayer();
    fireEvent.click(item(DENTIST));
    const popover = screen.getByRole('dialog', { name: 'Dentist, Dr. Tamm' });
    expect(popover.hasAttribute('popover')).toBe(true);
    expect(within(popover).getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('opens details as a sheet on phones', () => {
    renderLayer();
    fireEvent.click(item(DENTIST));
    const sheet = screen.getByRole('dialog', { name: 'Dentist, Dr. Tamm' });
    expect(sheet.tagName).toBe('DIALOG');
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('offers only Delete event and Edit alerts on a historical event', () => {
    alertsSupported();
    renderLayer();
    fireEvent.click(item(OLD));
    const sheet = screen.getByRole('dialog', { name: 'Old visit' });
    expect(within(sheet).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Edit alerts' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Delete event' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit alerts' }));
    expect(within(screen.getByRole('dialog', { name: 'Edit alerts' })).getByRole('combobox', { name: 'Alert' })).toBeTruthy();
  });

  it('offers only Delete event on a historical event where the browser cannot show alerts (no empty Edit alerts, §2.14)', () => {
    // jsdom has no Notification: the alert pickers are hidden, so the editor reduced to them would be empty.
    renderLayer();
    fireEvent.click(item(OLD));
    const sheet = screen.getByRole('dialog', { name: 'Old visit' });
    expect(within(sheet).queryByRole('button', { name: 'Edit alerts' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Delete event' })).toBeTruthy();
  });

  it('announces why E does nothing on a read-only event', async () => {
    renderLayer();
    fireEvent.click(screen.getByRole('button', { name: `edit ${HALLOWEEN}` }));
    await waitFor(() =>
      expect(screen.getByText('This event is in a subscribed calendar, so it can’t be changed here.')).toBeTruthy(),
    );
    expect(screen.queryByRole('dialog', { name: 'Edit event' })).toBeNull();
  });

  it('asks before deleting, holds the delete with Undo, and Undo brings the event back', async () => {
    const store = renderLayer();
    fireEvent.click(item(DENTIST));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Dentist, Dr. Tamm' })).getByRole('button', { name: 'Delete event' }));
    const asked = screen.getByRole('alertdialog', { name: 'Delete this event?' });
    expect(document.activeElement).toBe(within(asked).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(asked).getByRole('button', { name: 'Delete event' }));
    expect(store.resolveOccurrence(DENTIST)).toBeNull();
    expect(await screen.findByText('Event deleted.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'undo' }));
    });
    expect(store.resolveOccurrence(DENTIST)).not.toBeNull();
    await waitFor(() => expect(screen.queryByText('Event deleted.')).toBeNull());
  });

  it('deletes a historical event too', () => {
    const store = renderLayer();
    fireEvent.click(item(OLD));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Old visit' })).getByRole('button', { name: 'Delete event' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete event' }));
    expect(store.resolveOccurrence(OLD)).toBeNull();
  });

  it('opens the editor on an event', () => {
    renderLayer();
    fireEvent.click(screen.getByRole('button', { name: `edit ${DENTIST}` }));
    expect(within(screen.getByRole('dialog', { name: 'Edit event' })).getByRole('textbox', { name: 'Title' })).toHaveProperty('value', 'Dentist, Dr. Tamm');
  });

  it('duplicates a subscribed event into the default calendar as a new, unsaved event', () => {
    renderLayer();
    fireEvent.click(item(HALLOWEEN));
    const sheet = screen.getByRole('dialog', { name: 'Halloween' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    const editor = screen.getByRole('dialog', { name: 'New event' });
    expect(within(editor).getByRole('textbox', { name: 'Title' })).toHaveProperty('value', 'Halloween');
    expect((within(editor).getByRole('combobox', { name: 'Calendar' }) as HTMLSelectElement).value).toBe('home');
  });
});
