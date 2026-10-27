/**
 * The web journal of pending moves and deletes, and the failures nobody saw
 * (docs/EVENTS.md §2.11 "The web journal", "Failures nobody saw").
 *
 * Each pending change is recorded synchronously in `localStorage`
 * (`thirteen-pending`) when it is made, tagged with its tab's id, and removed
 * once it is written or undone: an IndexedDB transaction started while a tab
 * closes may never complete. Another tab replays an entry only when that tab's
 * lock (`thirteen-tab-{id}`) is free. A failure nobody saw is kept in
 * `thirteen-failed-commits` until its toast closes or its list is opened.
 */

import type { HeldRequest } from '@thirteen/ui/headless';

export const PENDING_KEY = 'thirteen-pending';
export const FAILED_KEY = 'thirteen-failed-commits';
export const TAB_LOCK_PREFIX = 'thirteen-tab-';

/** Where a change was going, for the toasts of §2.11 (`{date}` and `{time}`, the target's). */
export interface PendingTarget {
  /** `YYYY-MM-DD`, the event's zone: the new start of a move, the deleted occurrence's date. */
  readonly date: string;
  /** Minutes after midnight of a timed target; null for all-day. */
  readonly minute: number | null;
}

export interface JournalEntry {
  readonly id: string;
  /** The tab that made the change. */
  readonly tab: string;
  readonly request: HeldRequest;
  /** The event's title when the change was made (user text, shown in quotes). */
  readonly title: string;
  readonly target: PendingTarget;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
}

/** Why a commit failed (§2.11): transient (Try again), the event changed elsewhere, or a final reason line. */
export type CommitCause = 'transient' | 'changed' | 'readOnly' | 'storage' | 'access' | 'account';

export interface FailedCommit {
  readonly id: string;
  readonly kind: 'move' | 'delete';
  readonly key: string;
  readonly title: string;
  readonly target: PendingTarget;
  readonly cause: CommitCause;
  /** For "Try again" (written at once, §2.11). */
  readonly request: HeldRequest;
  /** ISO 8601 UTC. */
  readonly at: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function readList<T>(storage: StorageLike | null, key: string): T[] {
  if (storage === null) return [];
  try {
    const value = JSON.parse(storage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(storage: StorageLike | null, key: string, list: readonly T[]): void {
  if (storage === null) return;
  try {
    if (list.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(list));
  } catch {
    // A full localStorage loses the journal entry; the change is still held in this tab.
  }
}

export class Journal {
  constructor(private readonly storage: StorageLike | null) {}

  entries(): JournalEntry[] {
    return readList<JournalEntry>(this.storage, PENDING_KEY);
  }

  add(entry: JournalEntry): void {
    writeList(this.storage, PENDING_KEY, [...this.entries().filter((e) => e.id !== entry.id), entry]);
  }

  remove(id: string): void {
    const entries = this.entries();
    const next = entries.filter((e) => e.id !== id);
    if (next.length !== entries.length) writeList(this.storage, PENDING_KEY, next);
  }

  failures(): FailedCommit[] {
    return readList<FailedCommit>(this.storage, FAILED_KEY);
  }

  addFailure(failure: FailedCommit): void {
    writeList(this.storage, FAILED_KEY, [...this.failures().filter((f) => f.id !== failure.id), failure]);
  }

  clearFailures(ids?: readonly string[]): void {
    if (ids === undefined) writeList(this.storage, FAILED_KEY, []);
    else writeList(this.storage, FAILED_KEY, this.failures().filter((f) => !ids.includes(f.id)));
  }
}

/** `localStorage`, or null where it is missing or refused. */
export function platformStorage(): StorageLike | null {
  try {
    const storage = globalThis.localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}
