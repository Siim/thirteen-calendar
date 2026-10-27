/**
 * The event store the app runs on (docs/EVENTS.md §6.5).
 *
 * - `?store=mockup` (in the real query string, before the hash, like
 *   `?today=`): a `MemoryEventStore` with the mockup data set of §6.7, for
 *   screenshots, demos and the e2e suite. The data set is loaded as its own
 *   chunk, so the app never bundles it otherwise.
 * - Otherwise: the store of task B2 (`apps/web/src/lib/events/store.ts`, the
 *   IndexedDB store of §3.6, memory mode when IndexedDB is unavailable), with
 *   "Personal" created on first use. Its subscription manager, storage notice
 *   and export reminder are at `webEvents()` of `../lib/events/index.ts`.
 *
 * Every view codes against the `EventStore` interface of @thirteen/ui.
 */
import type { EventStore } from '@thirteen/ui';

export interface AppStoreOptions {
  /** Load the mockup data set (§6.7) instead of the browser's calendars. */
  readonly mockup?: boolean;
}

/**
 * The IndexedDB store of §3.6 with its worker, subscription refreshes and
 * storage checks (`startWebEvents`), in its own chunk (the mockup path never
 * loads it); memory mode when IndexedDB is unavailable.
 */
async function createPersistentStore(): Promise<EventStore> {
  const { startWebEvents } = await import('../lib/events/index.ts');
  return (await startWebEvents({ personalColor: '#ea580c' })).store;
}

export async function createAppEventStore({ mockup = false }: AppStoreOptions = {}): Promise<EventStore> {
  if (mockup) {
    const { createMockupEventStore } = await import('@thirteen/ui/mockup');
    return createMockupEventStore();
  }
  return createPersistentStore();
}
