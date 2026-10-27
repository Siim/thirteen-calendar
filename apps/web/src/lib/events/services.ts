/**
 * What the Calendars panel and its dialogs need beyond the `EventStore`
 * interface (docs/EVENTS.md §2.15 to §2.17, task B6): import, restore and
 * export of documents, subscriptions, the offline state and the storage
 * cards. Loaded with a dynamic import, like the store it wraps, so the first
 * chunk does not carry it.
 *
 * - {@link webServices}: the app's own store (`startWebEvents`, IndexedDB or
 *   memory mode).
 * - {@link fallbackServices}: any other `EventStore` (the mockup data set of
 *   `?store=mockup`, tests): links can be checked and files read, but nothing
 *   is written (the dialogs show "Please try again.").
 */

import type { ZoneResolver } from '@thirteen/core';
import { type EventStore, EventStoreError, intlZoneResolver } from '@thirteen/ui/headless';
import type { SubscriptionInterval } from './db.ts';
import {
  type ExportDownload,
  type ImportChoice,
  type ImportOutcome,
  type ImportPlan,
  type ImportSource,
  type PickedFile,
  type RestoreOutcome,
  downloadBytes,
  exportDownload,
  exportFiles,
  fileNameOf,
  importIntoStore,
  readImportFiles,
  restoreIntoStore,
} from './files.ts';
import { type IcsEngine, localIcsEngine } from './icsEngine.ts';
import { type WebEvents, webEvents } from './index.ts';
import type { StorageNotice } from './storage.ts';
import { type FeedCheck, addSubscription, checkFeed, setSubscriptionInterval } from './subscriptions.ts';
import { webZones } from './zones.ts';

export type { FeedCheck, ImportPlan, ImportSource, PickedFile, StorageNotice };

export interface ServicesSnapshot {
  /** "You're offline. Subscriptions update when you're back online." */
  readonly offline: boolean;
  /** The persistence card (§2.16). */
  readonly storage: StorageNotice;
  /** "You haven't exported your calendars in 30 days." */
  readonly reminder: boolean;
}

export interface CalendarServices {
  /** Import, restore, export and subscribing write documents (false: the mockup store). */
  readonly documents: boolean;
  subscribe(listener: () => void): () => void;
  /** The same object until something changes. */
  snapshot(): ServicesSnapshot;
  readFiles(files: readonly PickedFile[]): Promise<ImportPlan>;
  importFiles(choices: readonly ImportChoice[]): Promise<ImportOutcome>;
  restore(sources: readonly ImportSource[]): Promise<RestoreOutcome>;
  /** One `.ics`, or the zip for several; records the export (§2.16 reminder). False when there was nothing to export. */
  exportCalendars(ids: readonly string[], zipName: (date: string) => string): Promise<boolean>;
  checkFeed(url: string): Promise<FeedCheck>;
  addSubscription(check: FeedCheck & { ok: true }, choice: { readonly name: string; readonly color: string; readonly interval: SubscriptionInterval }): Promise<string>;
  /** "Update now", "Try again". */
  refresh(id: string): Promise<void>;
  setInterval(id: string, interval: SubscriptionInterval): Promise<void>;
  /** "Download it" of an unreadable calendar: its stored text. */
  downloadRaw(id: string, name: string): boolean;
  /** UID groups of a calendar (`calendars.delete.message`). */
  eventCount(id: string): number;
  keepMyData(): Promise<void>;
  snoozeReminder(): Promise<void>;
}

const unavailable = () => new EventStoreError('generic', 'This store keeps no documents.');

class Emitter {
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** The services of the app's own store. */
export function webServices(events: WebEvents, zones: ZoneResolver = webZones()): CalendarServices {
  const { store, subscriptions, storage, exportReminder, engine } = events;
  const emitter = new Emitter();
  let reminder = false;
  let current: ServicesSnapshot = { offline: subscriptions.offline, storage: storage.notice, reminder };
  const update = () => {
    const next: ServicesSnapshot = { offline: subscriptions.offline, storage: store.storageKind === 'memory' ? 'none' : storage.notice, reminder };
    if (next.offline === current.offline && next.storage === current.storage && next.reminder === current.reminder) return;
    current = next;
    emitter.emit();
  };
  const checkReminder = async () => {
    try {
      reminder = store.storageKind === 'indexeddb' && (await exportReminder.due());
    } catch {
      reminder = false;
    }
    update();
  };
  subscriptions.subscribe(update);
  storage.subscribe(update);
  store.onWrite(() => void checkReminder());
  void checkReminder();
  // "After the first save" (§2.16): a browser that already holds events is checked at once, not only after its next write.
  if (store.storageKind === 'indexeddb' && exportReminder.hasLocalEvents()) void storage.check();

  return {
    documents: true,
    subscribe: (listener) => emitter.subscribe(listener),
    snapshot: () => current,
    readFiles: (files) => readImportFiles(files, (text, id) => engine.summarize(text, id)),
    importFiles: (choices) => importIntoStore(store, choices, zones),
    async restore(sources) {
      const outcome = await restoreIntoStore(store, sources, zones);
      // A subscription comes back with the backup as its first copy and refreshes on its schedule: it is due now.
      for (const id of outcome.subscriptionIds) void subscriptions.refresh(id).catch(() => undefined);
      return outcome;
    },
    async exportCalendars(ids, zipName) {
      const now = new Date();
      const download = exportDownload(exportFiles(store, ids, zones, now), now, zipName);
      if (download === null) return false;
      downloadBytes(download);
      try {
        await exportReminder.recordExport();
      } catch {
        // The export happened; only the reminder clock could not be saved.
      }
      await checkReminder();
      return true;
    },
    checkFeed: (url) => checkFeed(url, engine),
    addSubscription: (check, choice) => addSubscription(store, check, choice),
    async refresh(id) {
      await subscriptions.refresh(id);
    },
    setInterval: (id, interval) => setSubscriptionInterval(store, id, interval),
    downloadRaw(id, name) {
      const text = store.documentText(id);
      if (text === null) return false;
      const download: ExportDownload = { name: `${fileNameOf(name)}.ics`, type: 'text/calendar;charset=utf-8', bytes: new TextEncoder().encode(text) };
      downloadBytes(download);
      return true;
    },
    eventCount(id) {
      const text = store.documentText(id);
      if (text === null) return 0;
      const parsed = store.parse(id, text);
      return parsed === null ? (text.match(/^BEGIN:VEVENT\r?$/gm) ?? []).length : parsed.groups.length;
    },
    async keepMyData() {
      await storage.keepMyData();
    },
    async snoozeReminder() {
      await exportReminder.snooze();
      await checkReminder();
    },
  };
}

/** Services for a store that keeps no documents (the mockup data set): checks and reading only. */
export function fallbackServices(store: EventStore, engine: IcsEngine = localIcsEngine(intlZoneResolver())): CalendarServices {
  const emitter = new Emitter();
  const online = () => globalThis.navigator?.onLine !== false;
  let current: ServicesSnapshot = { offline: !online(), storage: 'none', reminder: false };
  const onChange = () => {
    if (current.offline === !online()) return;
    current = { ...current, offline: !online() };
    emitter.emit();
  };
  globalThis.addEventListener?.('online', onChange);
  globalThis.addEventListener?.('offline', onChange);
  return {
    documents: false,
    subscribe: (listener) => emitter.subscribe(listener),
    snapshot: () => current,
    readFiles: (files) => readImportFiles(files, (text, id) => engine.summarize(text, id)),
    importFiles: () => Promise.reject(unavailable()),
    restore: () => Promise.reject(unavailable()),
    exportCalendars: () => Promise.reject(unavailable()),
    checkFeed: (url) => checkFeed(url, engine),
    addSubscription: () => Promise.reject(unavailable()),
    refresh: async () => undefined,
    setInterval: async () => undefined,
    downloadRaw: () => false,
    eventCount(id) {
      // The events of the years this store has expanded (the mockup's are all in 2026 and 2027).
      const ids = new Set<string>();
      for (const year of [2025, 2026, 2027, 2028]) {
        const snapshot = store.occurrencesInYear(year);
        if (snapshot.status === 'ready') for (const o of snapshot.occurrences) if (o.calendarId === id) ids.add(o.eventId);
      }
      return ids.size;
    },
    keepMyData: async () => undefined,
    snoozeReminder: async () => undefined,
  };
}

const cache = new WeakMap<EventStore, CalendarServices>();

/** The services for the store the app runs on: the web store's own, or the fallback. */
export function servicesFor(store: EventStore): CalendarServices {
  const cached = cache.get(store);
  if (cached !== undefined) return cached;
  const events = webEvents();
  const services = events !== null && events.store === store ? webServices(events) : fallbackServices(store);
  cache.set(store, services);
  return services;
}

