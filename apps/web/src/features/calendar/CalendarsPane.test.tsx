import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../../app/Providers.tsx';
import { readZip } from '../../lib/events/files.ts';
import { type WebEvents, startWebEvents } from '../../lib/events/index.ts';
import { DataRows } from '../settings/DataRows.tsx';
import { CalendarsDialogsProvider, CalendarsPane } from './CalendarsPane.tsx';

const ROOT = resolve(__dirname, '../../../../..');
const fixture = (path: string) => readFileSync(resolve(ROOT, 'fixtures/ics', path));

let events: WebEvents | null = null;
const downloads: { name: string; bytes: Uint8Array }[] = [];

beforeEach(() => {
  downloads.length = 0;
  // jsdom has no object URLs: keep the blob of every download instead.
  const blobs = new Map<string, Blob>();
  let next = 0;
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      const url = `blob:test/${++next}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL: () => {},
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.href);
    if (blob !== undefined) void blob.arrayBuffer().then((buffer) => downloads.push({ name: this.download, bytes: new Uint8Array(buffer) }));
  });
});

afterEach(async () => {
  events?.stop();
  events = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await new Promise<void>((done) => {
    const request = indexedDB.deleteDatabase('thirteen-events');
    request.onsuccess = request.onerror = request.onblocked = () => done();
  });
});

async function renderPane() {
  events = await startWebEvents({ personalColor: '#ea580c' });
  render(
    <Providers store={events.store}>
      <CalendarsDialogsProvider>
        <CalendarsPane />
      </CalendarsDialogsProvider>
    </Providers>,
  );
  // The services load with a dynamic import.
  await screen.findByRole('button', { name: 'Import .ics file' });
  return events;
}

function choose(files: File[]) {
  const input = document.querySelector<HTMLInputElement>('[data-calendars-import-input]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  fireEvent.change(input);
}

const icsFile = (path: string, name = path.slice(path.lastIndexOf('/') + 1)) => new File([fixture(path)], name, { type: 'text/calendar' });

describe('the Calendars pane on the web store', () => {
  it('imports a Google export into a new calendar and reports the counts', async () => {
    const user = userEvent.setup();
    await renderPane();
    expect(screen.getByRole('switch', { name: 'Personal' })).toBeTruthy();
    expect(screen.getByText('Your events are saved in this browser on this device. Export them to keep a copy or to move them.')).toBeTruthy();
    choose([icsFile('cases/google-secret.ics')]);
    const dialog = await screen.findByRole('dialog', { name: 'Import events' });
    expect(within(dialog).getByText('3 events in', { exact: false }).textContent).toBe('3 events in google-secret.ics');
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.getAllByText('Added 3, updated 0, unchanged 0.').length).toBeGreaterThan(0));
    const imported = events!.store.getState().calendars.find((c) => c.title !== 'Personal')!;
    expect(screen.getByRole('switch', { name: imported.title })).toBeTruthy();
    // The same file again into that calendar changes nothing.
    choose([icsFile('cases/google-secret.ics')]);
    const again = await screen.findByRole('dialog', { name: 'Import events' });
    await user.selectOptions(within(again).getByRole('combobox', { name: 'Add to' }), imported.title);
    await user.click(within(again).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.getAllByText('Added 0, updated 0, unchanged 3.').length).toBeGreaterThan(0));
  });

  it('exports every calendar as one zip, then restores it into a fresh browser', async () => {
    const user = userEvent.setup();
    const first = await renderPane();
    await act(async () => {
      await first.store.createCalendar({ title: 'Work', color: '#2563eb' });
    });
    await user.click(screen.getByRole('button', { name: 'Export' }));
    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    await user.click(within(dialog).getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]!.name).toMatch(/^Thirteen calendars \d{4}-\d{2}-\d{2}\.zip$/);
    expect(readZip(downloads[0]!.bytes).map((e) => e.name)).toEqual(['Personal.ics', 'Work.ics']);
    const ids = first.store.getState().calendars.map((c) => c.id);
    const zip = new File([Buffer.from(downloads[0]!.bytes)], downloads[0]!.name, { type: 'application/zip' });

    // A fresh browser: a new database, the zip chosen in its Calendars list.
    first.stop();
    events = null;
    await new Promise<void>((done) => {
      const request = indexedDB.deleteDatabase('thirteen-events');
      request.onsuccess = request.onerror = request.onblocked = () => done();
    });
    cleanup();
    await renderPane();
    choose([zip]);
    const restore = await screen.findByRole('dialog', { name: 'Restore calendars' });
    expect(within(restore).getByText('2 calendars in', { exact: false })).toBeTruthy();
    await user.click(within(restore).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getAllByText('Restored 2 calendars.').length).toBeGreaterThan(0));
    const restored = events!.store.getState().calendars;
    expect(ids.every((id) => restored.some((c) => c.id === id))).toBe(true);
    expect(restored.find((c) => c.title === 'Work')?.color).toBe('#2563eb');
  });

  it('restores the fixture set: two local calendars and a subscription, one calendar each when restored twice', async () => {
    const user = userEvent.setup();
    const ev = await renderPane();
    const zip = new File([fixture('restore/Thirteen calendars 2026-10-19.zip')], 'Thirteen calendars 2026-10-19.zip', { type: 'application/zip' });
    // The restored subscription refreshes on its schedule: answer it with its own copy.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(fixture('restore/Holidays in Estonia.ics'))));
    for (const round of [1, 2]) {
      choose([zip]);
      const dialog = await screen.findByRole('dialog', { name: 'Restore calendars' });
      expect(within(dialog).getByText('local · 4 events')).toBeTruthy();
      expect(within(dialog).getByText('subscription')).toBeTruthy();
      await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
      await waitFor(() => expect(screen.getAllByText('Restored 3 calendars.').length).toBeGreaterThan(0));
      expect(ev.store.getState().calendars.filter((c) => c.title === 'Work')).toHaveLength(1);
      expect(round).toBeGreaterThan(0);
    }
    const holidays = ev.store.getState().calendars.find((c) => c.kind === 'subscription')!;
    expect(holidays).toMatchObject({ title: 'Holidays in Estonia', color: '#57534e', subscription: { url: 'https://calendar.example.com/holidays/ee.ics', interval: 'P1D' } });
  });

  it('subscribes to a feed; a server without CORS offers the import instead', async () => {
    const user = userEvent.setup();
    const feed = fixture('restore/Holidays in Estonia.ics');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('calendar.google.com')) throw new TypeError('Failed to fetch');
        return new Response(feed);
      }),
    );
    await renderPane();
    await user.click(screen.getByRole('button', { name: 'Subscribe to calendar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Subscribe to a calendar' });
    const link = within(dialog).getByRole('textbox', { name: 'Calendar link' });
    await user.type(link, 'https://calendar.google.com/calendar/ical/x/basic.ics');
    await user.click(within(dialog).getByRole('button', { name: 'Subscribe' }));
    await waitFor(() => expect(within(dialog).getByText(/doesn’t let web pages read it/)).toBeTruthy());
    expect(within(dialog).getByRole('button', { name: 'Import .ics file' })).toBeTruthy();
    await user.clear(link);
    await user.type(link, 'webcal://feeds.example/ee.ics');
    await user.click(within(dialog).getByRole('button', { name: 'Subscribe' }));
    const found = await screen.findByRole('dialog', { name: 'Holidays in Estonia: 16 events' });
    await user.click(within(found).getByRole('button', { name: 'Subscribe' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Holidays in Estonia' })).toBeTruthy());
    const subscription = events!.store.getState().calendars.at(-1)!;
    expect(subscription.subscription?.url).toBe('https://feeds.example/ee.ics');
    expect(document.querySelector(`[data-calendar-row="${subscription.id}"]`)!.textContent).toContain('Read only');
  });

  it('shows one offline banner, and opens a calendar’s settings from its info button', async () => {
    const user = userEvent.setup();
    await renderPane();
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(await screen.findByText('You’re offline. Subscriptions update when you’re back online.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Calendar settings' }));
    const settings = await screen.findByRole('dialog', { name: 'Personal' });
    const name = within(settings).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Home{Enter}');
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Home' })).toBeTruthy());
  });

  it('opens the import flow for files dropped on the window', async () => {
    await renderPane();
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    const file = icsFile('cases/google-secret.ics');
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
    act(() => {
      window.dispatchEvent(drop);
    });
    expect(drop.defaultPrevented).toBe(true);
    expect(await screen.findByRole('dialog', { name: 'Import events' })).toBeTruthy();
    // Drags that carry no files (an event moved in the grid) are left alone.
    const move = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(move, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
    window.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(false);
  });

  it('"Export all" (storage cards, the export reminder, Settings) opens the Export dialog with every calendar checked and names secret links (§2.17)', async () => {
    const user = userEvent.setup();
    events = await startWebEvents({ personalColor: '#ea580c' });
    render(
      <Providers store={events.store}>
        <CalendarsDialogsProvider>
          <CalendarsPane />
          <DataRows />
        </CalendarsDialogsProvider>
      </Providers>,
    );
    await screen.findByRole('button', { name: 'Import .ics file' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(fixture('restore/Holidays in Estonia.ics'))));
    choose([new File([fixture('restore/Holidays in Estonia.ics')], 'Holidays in Estonia.ics', { type: 'text/calendar' })]);
    await user.click(within(await screen.findByRole('dialog', { name: 'Restore calendars' })).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getAllByText('Restored 1 calendar.').length).toBeGreaterThan(0));

    await user.click(within(screen.getByRole('group', { name: 'Your data' })).getByRole('button', { name: 'Export all' }));
    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => [box.labels?.[0]?.textContent, box.checked])).toEqual([
      ['Personal', true],
      ['Holidays in Estonia', true],
    ]);
    expect(within(dialog).getByText('Exported subscriptions include their links. Treat secret links like passwords.')).toBeTruthy();
    // Without the subscription, no note.
    await user.click(within(dialog).getByRole('checkbox', { name: 'Holidays in Estonia' }));
    expect(within(dialog).queryByText('Exported subscriptions include their links. Treat secret links like passwords.')).toBeNull();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Holidays in Estonia' }));
    await user.click(within(dialog).getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(readZip(downloads[0]!.bytes).map((e) => e.name)).toEqual(['Personal.ics', 'Holidays in Estonia.ics']);
  });

  it('a file without its own calendar name goes to the default calendar chosen in Settings (§2.15)', async () => {
    const user = userEvent.setup();
    const { store } = await renderPane();
    let work!: { id: string };
    await act(async () => {
      work = await store.createCalendar({ title: 'Work', color: '#2563eb' });
    });
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tickets//EN', 'BEGIN:VEVENT', 'UID:t1@tickets.example', 'DTSTAMP:20261001T000000Z', 'DTSTART:20261105T170000Z', 'SUMMARY:Concert', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
    const unnamed = new File([text], 'tickets.ics', { type: 'text/calendar' });
    choose([unnamed]);
    let dialog = await screen.findByRole('dialog', { name: 'Import events' });
    // No choice yet: the platform default, "Personal".
    expect((within(dialog).getByRole('combobox', { name: 'Add to' }) as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Personal');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    window.localStorage.setItem('thirteen:calendar.defaultCalendar', work.id);
    window.dispatchEvent(new StorageEvent('storage', { key: 'thirteen:calendar.defaultCalendar' }));
    choose([unnamed]);
    dialog = await screen.findByRole('dialog', { name: 'Import events' });
    expect((within(dialog).getByRole('combobox', { name: 'Add to' }) as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Work');
    window.localStorage.removeItem('thirteen:calendar.defaultCalendar');
  });

  it('remembers collapsed groups in this browser, and expands them while every calendar is hidden', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.click(screen.getByRole('button', { name: 'In this browser' }));
    expect(screen.getByText('1 calendar, 1 shown')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('thirteen-calendars-collapsed')!)).toEqual(['local']);
    const personal = events!.store.getState().calendars[0]!;
    await act(async () => {
      await events!.store.updateCalendar(personal.id, { visible: false });
    });
    expect(screen.getByRole('switch', { name: 'Personal' })).toBeTruthy();
  });
});
