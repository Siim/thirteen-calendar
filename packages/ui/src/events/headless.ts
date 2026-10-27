/**
 * `@thirteen/ui/headless`: the event store contract and the pure helpers
 * around it, without React or CSS, for code that runs outside the page's
 * component tree (the web's parse and expand worker, the IndexedDB store).
 * Everything here is also exported from `@thirteen/ui`.
 */

export {
  type CalendarPatch,
  type DeleteRequest,
  type EditSpan,
  type EventStore,
  EventStoreError,
  type EventStoreErrorCode,
  type EventStoreState,
  type EventStoreStatus,
  type EventSnapshot,
  type HeldRequest,
  type NewCalendar,
  type PendingChange,
  type ResolvedOccurrence,
  type SaveRequest,
  type StoreCalendar,
  type StoreCommitCause,
  type StoreCommitFailure,
  type StoreFailedCommit,
  type StoreOccurrence,
  type StoreSubscription,
  type WriteResult,
  type YearSnapshot,
} from './store.ts';
export { CALENDAR_PALETTE } from './MemoryEventStore.ts';
export { deviceTimeZone, intlZoneResolver } from './intlZones.ts';
export { compareOccurrences, occurrenceKey, parseOccurrenceKey } from './order.ts';
// Copy and time text without React (the web's alert planner, B7).
export { copy, plural } from './copy.ts';
export { formatTime, formatTimeRange, prefers24HourClock } from './format.ts';
// The one stale rule of the subscription rows, the toolbar and the web's subscriptions (§2.16, B6).
export { isStaleSubscription } from './calendars/status.ts';
