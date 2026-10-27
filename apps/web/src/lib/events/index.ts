/**
 * The web's events services (docs/EVENTS.md §6.5): the IndexedDB store (or
 * memory mode), its worker, subscription refreshes and the storage notices,
 * started together for the app.
 */

import { CALENDAR_PALETTE } from '@thirteen/ui/headless';
import { type IcsEngine, createIcsEngine } from './icsEngine.ts';
import { type StorageNotice, ExportReminder, StorageStatus } from './storage.ts';
import { type LocalEventStore, openLocalEventStore } from './store.ts';
import { SubscriptionManager } from './subscriptions.ts';
import { webZones } from './zones.ts';

export interface WebEvents {
  readonly store: LocalEventStore;
  readonly engine: IcsEngine;
  readonly subscriptions: SubscriptionManager;
  readonly storage: StorageStatus;
  readonly exportReminder: ExportReminder;
  /** Stops timers and listeners and closes the store. */
  stop(): void;
}

/**
 * Opens the store (IndexedDB `thirteen-events`, or memory mode when it cannot
 * be opened, §2.16), creates "Personal" on first use in `personalColor` (the
 * theme accent), and starts subscription refreshes and the storage checks.
 */
let started: WebEvents | null = null;

/** The services `startWebEvents` started (the Calendars panel, Settings, alerts), or null before. */
export function webEvents(): WebEvents | null {
  return started;
}

export async function startWebEvents(options: { readonly personalColor?: string } = {}): Promise<WebEvents> {
  const zones = webZones();
  const engine = createIcsEngine(zones);
  const store = await openLocalEventStore({ engine, zones, personal: { title: 'Personal', color: options.personalColor ?? CALENDAR_PALETTE[0]! } });
  const subscriptions = new SubscriptionManager(store, { engine });
  const storage = new StorageStatus();
  const exportReminder = new ExportReminder(store);
  const stops = [storage.watch(store), exportReminder.watch()];
  subscriptions.start();
  started = {
    store,
    engine,
    subscriptions,
    storage,
    exportReminder,
    stop() {
      for (const stop of stops) stop();
      subscriptions.stop();
      store.close();
      if (started?.store === store) started = null;
    },
  };
  return started;
}

export type { StorageNotice };
export { type CommitFailure, LocalEventStore, openLocalEventStore } from './store.ts';
export { type FeedCheck, type SubscribeError, addSubscription, checkFeed, isStale, normalizeFeedUrl, setSubscriptionInterval } from './subscriptions.ts';
export { exportReminderDue, isSafariInTab, SAFARI_HELP_URL } from './storage.ts';
export type { CalendarRecord, DocumentRecord, SubscriptionInterval, SubscriptionRecord } from './db.ts';
export type { FailedCommit, CommitCause, PendingTarget } from './pending.ts';
