/**
 * Test helpers for the web's local store (not bundled: only tests import it):
 * a "browser" with its own IndexedDB (fake-indexeddb), Web Locks, a
 * BroadcastChannel bus and localStorage, so two stores opened in one browser
 * act like two tabs.
 */

import type { EventDraft } from '@thirteen/core';
import { parseLocalDateTime } from '@thirteen/core';
import { intlZoneResolver } from '@thirteen/ui/headless';
import { IDBFactory } from 'fake-indexeddb';
import { localIcsEngine } from './icsEngine.ts';
import { type Locks, localLocks } from './locks.ts';
import { type ChannelLike, type ChannelMessage, type LocalEventStoreOptions, openLocalEventStore } from './store.ts';

export const zones = intlZoneResolver();

/** An in-memory `localStorage`. */
export function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
  };
}

/** A BroadcastChannel stand-in: messages reach every other member, asynchronously. */
export function channelBus() {
  const members = new Set<ChannelLike>();
  return (): ChannelLike => {
    const channel: ChannelLike = {
      onmessage: null,
      postMessage(message: ChannelMessage) {
        for (const other of members) {
          if (other !== channel) setTimeout(() => other.onmessage?.({ data: message }), 0);
        }
      },
      close() {
        members.delete(channel);
      },
    };
    members.add(channel);
    return channel;
  };
}

export interface TestBrowser {
  readonly indexedDB: IDBFactory;
  readonly locks: Locks;
  readonly channel: () => ChannelLike;
  readonly storage: ReturnType<typeof memoryStorage>;
}

export function testBrowser(): TestBrowser {
  return { indexedDB: new IDBFactory(), locks: localLocks(), channel: channelBus(), storage: memoryStorage() };
}

let ids = 0;

/** Opens a store ("a tab") in a test browser: Tallinn, today 2026-10-19 06:41 UTC, the page engine. */
export function openTab(browser: TestBrowser, options: Partial<LocalEventStoreOptions> & { readonly indexedDB?: IDBFactory | null } = {}) {
  return openLocalEventStore({
    indexedDB: browser.indexedDB,
    locks: browser.locks,
    channel: browser.channel(),
    storage: browser.storage,
    zones,
    deviceZone: 'Europe/Tallinn',
    watchZone: false,
    document: null,
    engine: localIcsEngine(zones),
    now: () => new Date('2026-10-19T06:41:00Z'),
    newId: () => `id-${++ids}`,
    personal: { title: 'Personal', color: '#ea580c' },
    ...options,
  });
}

/** Lets queued messages and microtasks run. */
export async function settle(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A one-hour timed draft in Tallinn. */
export function timedDraft(calendarId: string, title: string, start: string, end: string, extra: Partial<EventDraft> = {}): EventDraft {
  return {
    title,
    location: '',
    notes: '',
    url: '',
    allDay: false,
    start: parseLocalDateTime(start),
    end: parseLocalDateTime(end),
    timeZone: 'Europe/Tallinn',
    calendarId,
    recurrence: null,
    alarms: [],
    availability: 'busy',
    ...extra,
  };
}
