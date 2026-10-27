/**
 * Undo for event changes on the web (docs/EVENTS.md §2.11 "Undo"): one stack
 * per window of the last 20 changes, the toasts with "Undo", and what happens
 * when a held change cannot be written.
 *
 * - Moves and deletes are held first (`EventStore.hold`): the views show them
 *   at once and they are written when their toast closes (timeout, Close, the
 *   next action), or earlier by the store itself (another tab, an alert, the
 *   tab hidden). Undo while held discards them: nothing was written.
 * - Editor saves are written at once.
 * - A written change is undone exactly (the previous version of its group,
 *   same UID) when the store keeps snapshots and the event did not change
 *   since; when it did, only the field groups the change touched are reverted
 *   through `mergeDraft`, or, when another app changed those too, nothing is
 *   changed and `calendar.undoUnavailable` says so. "Future events" and "all
 *   events" changes of a series are never undoable.
 * - A held change that cannot be written is never left on screen: the views
 *   return to the stored state and the toast says so (`calendar.commitFailed.*`);
 *   failures nobody saw are shown at the next launch or foreground.
 */

import { type CalendarSystemId, type DraftField, type EventDraft, changedFields, formatThirteen, parseISODate, toThirteen } from '@thirteen/core';
import type { ToastApi, ToastHandle } from '../primitives/Toast.tsx';
import { copy, plural } from './copy.ts';
import { formatTime } from './format.ts';
import { occurrenceKey, parseOccurrenceKey } from './order.ts';
import {
  type EventSnapshot,
  type EventStore,
  EventStoreError,
  type HeldRequest,
  type PendingChange,
  type StoreCommitCause,
  type StoreFailedCommit,
  type WriteResult,
} from './store.ts';

/** The most changes kept per window (§2.11). */
export const UNDO_LIMIT = 20;

export type UndoChangeKind = 'move' | 'delete' | 'save';

export interface EventUndoOptions {
  readonly toast: ToastApi;
  /** On a Mac the announced shortcut is "Command Z", elsewhere "Control Z" (`calendar.announce.undo`). */
  readonly mac?: boolean;
  /** Moves focus to an event (a chip, block or row with `data-key`) after Undo and Redo (§2.20). */
  readonly focusEvent?: (key: string) => void;
  /** "Show event": opens an event's details at its stored time (§2.11). */
  readonly showEvent?: (key: string) => void;
  /** "Show": opens the list "Changes that couldn't be saved". */
  readonly showFailures?: (failures: readonly StoreFailedCommit[]) => void;
  readonly systemId?: CalendarSystemId;
  readonly use24Hour?: boolean;
}

export interface HoldOptions {
  /** The toast's sentence ("Event deleted.", "Event moved to 14:00."). */
  readonly message: string;
  /** Undo still works once written (a change of one event, not of a series' future or all events). */
  readonly undoableWhenWritten: boolean;
  /** The occurrence to focus after Undo (the restored event). Default the request's key. */
  readonly restoreKey?: string | null;
}

export interface WriteOptions {
  readonly kind: UndoChangeKind;
  readonly message: string;
  /** The events (`{calendarId}/{uid}`) the write changes; the event a write creates is added from its result. */
  readonly eventIds: readonly string[];
  /** Registered for undo: single events and "this event only" (§2.11 table); false for future and all events. */
  readonly undoable: boolean;
  /** The occurrence to focus after Undo. */
  readonly restoreKey?: string | null;
  /** The drafts before and after, for an undo through `mergeDraft` when the event changed since. */
  readonly drafts?: { readonly key: string; readonly before: EventDraft; readonly after: EventDraft };
}

type EntryState = 'pending' | 'committing' | 'written' | 'undone' | 'failed';

interface Entry {
  readonly id: number;
  readonly kind: UndoChangeKind;
  readonly message: string;
  readonly request: HeldRequest | null;
  readonly undoableWritten: boolean;
  state: EntryState;
  /** It was held (redo holds it again). */
  readonly held: boolean;
  pending: PendingChange | null;
  eventIds: string[];
  before: EventSnapshot[] | null;
  after: EventSnapshot[] | null;
  restoreKey: string | null;
  redoKey: string | null;
  toast: ToastHandle | null;
  drafts: NonNullable<WriteOptions['drafts']> | null;
}

const eventIdOf = (key: string) => parseOccurrenceKey(key)?.eventId ?? key.split('|')[0]!;

/** The key of a held move's occurrence once written: an occurrence of a series keeps its key, a single event's follows its start. */
function keyAfter(request: HeldRequest & { readonly kind: 'save' }): string {
  if (request.original.recurrence !== null && request.span === 'this') return request.key;
  const id = `${request.draft.calendarId}/${eventIdOf(request.key).slice(eventIdOf(request.key).indexOf('/') + 1)}`;
  return occurrenceKey({ id, allDay: request.draft.allDay, start: request.draft.start }, request.draft.start.date, null);
}

/** The §2.11 cause of a write error. */
export function commitCauseOf(error: unknown): StoreCommitCause {
  if (!(error instanceof EventStoreError)) return 'transient';
  switch (error.code) {
    case 'occurrence-gone':
    case 'not-found':
    case 'invalid':
      return 'changed';
    case 'read-only':
      return 'readOnly';
    case 'storage':
      return 'storage';
    default:
      return 'transient';
  }
}

/** The reason line of a final cause (`editor.saveFailed.*`, never `generic`). */
export function causeReason(cause: StoreCommitCause): string | null {
  switch (cause) {
    case 'readOnly':
      return copy('editor.saveFailed.readOnly');
    case 'storage':
      return copy('editor.saveFailed.storage');
    case 'access':
      return copy('editor.saveFailed.access');
    case 'account':
      return copy('editor.saveFailed.account');
    default:
      return null;
  }
}

/** The toast of a held change that could not be written (§2.11). */
export function commitFailedText(kind: 'move' | 'delete', cause: StoreCommitCause): string {
  if (cause === 'changed') return copy(kind === 'move' ? 'calendar.commitFailed.changed.move' : 'calendar.commitFailed.changed.delete');
  const reason = causeReason(cause);
  if (reason === null) return copy(kind === 'move' ? 'calendar.commitFailed.move' : 'calendar.commitFailed.delete');
  return copy(kind === 'move' ? 'calendar.commitFailed.move.final' : 'calendar.commitFailed.delete.final', { reason });
}

/** A failure nobody saw, as its toast or list row says it (§2.11 "Failures nobody saw"). */
export function failedCommitText(record: StoreFailedCommit, systemId: CalendarSystemId, use24Hour: boolean): string {
  let date = record.target.date;
  try {
    date = formatThirteen(toThirteen(parseISODate(record.target.date), systemId), { style: 'long', includeWeekday: true });
  } catch {
    // Keep the stored text.
  }
  const base =
    record.kind === 'delete'
      ? copy('calendar.commitFailed.later.delete', { title: record.title, date })
      : record.target.minute === null
        ? copy('calendar.commitFailed.later.move.day', { title: record.title, date })
        : copy('calendar.commitFailed.later.move', { title: record.title, date, time: formatTime(record.target.minute, use24Hour) });
  const extra = record.cause === 'changed' ? copy('calendar.commitFailed.later.changed') : causeReason(record.cause);
  return extra === null ? base : `${base} ${extra}`;
}

/**
 * The undo stack of one window. Create one per window (the app's
 * EventActionsProvider) and call {@link dispose} when it goes.
 */
export class EventUndo {
  private readonly undoStack: Entry[] = [];
  private readonly redoStack: Entry[] = [];
  private readonly entries = new Set<Entry>();
  private nextId = 1;
  private readonly shownFailures = new Set<string>();
  private readonly listeners = new Set<() => void>();
  /** The entry whose toast was shown last (a written-early toast is replaced only while it is still showing). */
  private lastToast: Entry | null = null;

  constructor(
    private readonly store: EventStore,
    private options: EventUndoOptions,
  ) {}

  /** Updates the callbacks (the provider re-renders with new ones). */
  setOptions(options: EventUndoOptions): void {
    this.options = options;
  }

  /** Starts listening to the store (writes made early, failures); returns the stop function. */
  attach(): () => void {
    const unsubscribe = this.store.subscribe(() => this.checkEarlyWrites());
    const unsubscribeFailures = this.store.onCommitFailure?.((failure) => this.onStoreFailure(failure.change, failure.error, failure.unseen)) ?? null;
    return () => {
      unsubscribe();
      unsubscribeFailures?.();
    };
  }

  get canUndo(): boolean {
    return this.undoStack.some((entry) => entry.state === 'pending' || entry.state === 'written');
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Called when the stacks change (tests, menus). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private snapshot(ids: readonly string[]): EventSnapshot[] | null {
    const take = this.store.snapshotEvent?.bind(this.store);
    if (take === undefined) return null;
    return ids.map((id) => take(id));
  }

  private announcement(message: string): string {
    return copy('calendar.announce.undo', { message, shortcut: this.options.mac === true ? 'Command Z' : 'Control Z' });
  }

  private push(entry: Entry): void {
    this.undoStack.push(entry);
    this.entries.add(entry);
    while (this.undoStack.length > UNDO_LIMIT) {
      const dropped = this.undoStack.shift()!;
      this.entries.delete(dropped);
    }
    this.redoStack.length = 0;
    this.changed();
  }

  private remove(entry: Entry): void {
    const index = this.undoStack.indexOf(entry);
    if (index >= 0) this.undoStack.splice(index, 1);
    this.changed();
  }

  // ---- held moves and deletes ----------------------------------------------

  /**
   * Holds a move or delete (§2.11 "Moves and deletes are pending first") with
   * its toast and Undo. Closes the current toast first (the next action).
   * Throws what `EventStore.hold` throws when the change is refused.
   */
  hold(request: HeldRequest, options: HoldOptions): PendingChange {
    this.options.toast.nextAction();
    const ids = [eventIdOf(request.key)];
    // A fallback only: the store reports what the write itself replaced (`PendingChange.replaced`), which
    // also holds an earlier change of this event still being written when this one was held.
    const before = this.snapshot(ids);
    const pending = this.store.hold(request);
    const entry: Entry = {
      id: this.nextId++,
      kind: request.kind === 'delete' ? 'delete' : 'move',
      message: options.message,
      request,
      undoableWritten: options.undoableWhenWritten && before !== null,
      state: 'pending',
      held: true,
      pending,
      eventIds: ids,
      before,
      after: null,
      restoreKey: options.restoreKey ?? request.key,
      redoKey: null,
      toast: null,
      // A written move is undone through mergeDraft when the event changed since (only its time group).
      drafts: request.kind === 'save' ? { key: keyAfter(request), before: request.original, after: request.draft } : null,
    };
    this.push(entry);
    this.showChangeToast(entry, true);
    return pending;
  }

  private showChangeToast(entry: Entry, undoable: boolean): void {
    this.lastToast = entry;
    entry.toast = this.options.toast.show({
      message: entry.message,
      ...(undoable
        ? {
            action: { label: copy('calendar.undo'), onAction: () => void this.undoEntry(entry) },
            announcement: this.announcement(entry.message),
          }
        : {}),
      onClose: (reason) => {
        if (reason !== 'action' && entry.state === 'pending') void this.commit(entry);
      },
    });
  }

  /** Writes a held change now (its toast closed). */
  async commit(entry: Entry): Promise<void> {
    if (entry.state !== 'pending' || entry.pending === null || !entry.pending.held) return;
    entry.state = 'committing';
    try {
      const result = await entry.pending.commit();
      if (entry.drafts !== null && result.key !== null) entry.drafts = { ...entry.drafts, key: result.key };
      this.written(entry);
    } catch (error) {
      this.failed(entry, error, false);
    }
  }

  private written(entry: Entry): void {
    entry.state = 'written';
    const replaced = entry.pending?.replaced;
    if (replaced !== undefined && entry.before !== null) entry.before = [...replaced];
    entry.after = this.snapshot(entry.eventIds);
    if (!entry.undoableWritten || entry.after === null) {
      this.remove(entry);
      return;
    }
    this.changed();
  }

  /** The store wrote a held change by itself (written early): the toast stays; its Undo goes when the write cannot be undone. */
  private checkEarlyWrites(): void {
    for (const entry of this.undoStack) {
      if (entry.state !== 'pending' || entry.pending === null || entry.pending.held) continue;
      const watched = entry;
      setTimeout(() => {
        if (watched.state !== 'pending') return;
        this.written(watched);
        if (!watched.undoableWritten && this.lastToast === watched) this.showChangeToast(watched, false);
      }, 0);
    }
  }

  private onStoreFailure(change: PendingChange, error: EventStoreError, unseen: boolean): void {
    const entry = this.undoStack.find((e) => e.pending?.id === change.id);
    if (entry === undefined || (entry.state !== 'pending' && entry.state !== 'committing')) return;
    this.failed(entry, error, unseen);
  }

  private failed(entry: Entry, error: unknown, unseen: boolean): void {
    entry.state = 'failed';
    this.remove(entry);
    // A failure nobody saw is recorded by the store and shown at the next foreground.
    if (unseen || entry.request === null) return;
    this.showFailure(entry.request, commitCauseOf(error), true);
  }

  /** The failure toast of a held change; "Try again" writes it at once (no new hold, no Undo window). */
  private showFailure(request: HeldRequest, cause: StoreCommitCause, canRetry: boolean): void {
    const kind = request.kind === 'delete' ? 'delete' : 'move';
    const message = commitFailedText(kind, cause);
    const retry = cause === 'transient' && canRetry;
    this.options.toast.show({
      message,
      ...(retry
        ? {
            action: {
              label: copy('calendar.tryAgain'),
              onAction: () => void this.retry(request),
            },
          }
        : {}),
    });
  }

  private async retry(request: HeldRequest): Promise<void> {
    try {
      if (request.kind === 'save') await this.store.save(request);
      else await this.store.delete(request);
    } catch (error) {
      this.showFailure(request, commitCauseOf(error), false);
    }
  }

  // ---- editor saves ------------------------------------------------------

  /**
   * An editor save, written at once (§2.11 "Editor saves are written at
   * once"), with the toast "Event saved." and, when it can be undone, Undo.
   * Resolves with the write's result; rejects with the store's error.
   */
  async write(run: () => Promise<WriteResult>, options: WriteOptions): Promise<WriteResult> {
    this.options.toast.nextAction();
    const before = options.undoable ? this.snapshot(options.eventIds) : null;
    const result = await run();
    const ids = [...options.eventIds];
    const snapshots = before === null ? null : [...before];
    if (snapshots !== null && result.eventId !== null && !ids.includes(result.eventId)) {
      ids.push(result.eventId);
      // A new event (Add, or a move to another calendar) did not exist before.
      snapshots.push({ eventId: result.eventId, fingerprint: null });
    }
    const undoable = options.undoable && snapshots !== null;
    const entry: Entry = {
      id: this.nextId++,
      kind: options.kind,
      message: options.message,
      request: null,
      undoableWritten: undoable,
      state: 'written',
      held: false,
      pending: null,
      eventIds: ids,
      before: snapshots,
      after: undoable ? this.snapshot(ids) : null,
      restoreKey: options.restoreKey ?? null,
      redoKey: result.key,
      toast: null,
      drafts: options.drafts === undefined ? null : { ...options.drafts, key: result.key ?? options.drafts.key },
    };
    if (undoable) this.push(entry);
    this.showChangeToast(entry, undoable);
    return result;
  }

  // ---- undo and redo -------------------------------------------------------

  /** Ctrl+Z / Cmd+Z: undoes the newest change still on the stack. */
  async undo(): Promise<boolean> {
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      const entry = this.undoStack[i]!;
      if (entry.state === 'pending' || entry.state === 'written') return this.undoEntry(entry);
    }
    return false;
  }

  private closeToastOf(entry: Entry): void {
    if (entry.toast !== null) this.options.toast.close(entry.toast, 'dismissed');
  }

  private async undoEntry(entry: Entry): Promise<boolean> {
    if (entry.state === 'pending' && entry.pending?.held === true) {
      entry.state = 'undone';
      entry.pending.discard();
      this.closeToastOf(entry);
      this.remove(entry);
      this.redoStack.push(entry);
      this.focus(entry.restoreKey);
      this.changed();
      return true;
    }
    if (entry.state !== 'written' || !entry.undoableWritten || entry.before === null || entry.after === null) return false;
    this.closeToastOf(entry);
    const restored = await this.restore(entry.before, entry.after);
    if (restored) {
      entry.state = 'undone';
      this.remove(entry);
      this.redoStack.push(entry);
      this.focus(entry.restoreKey);
      this.changed();
      return true;
    }
    // The event changed since: revert only the groups this change touched, if nobody else touched them.
    if (entry.drafts !== null && (await this.undoThroughMerge(entry.drafts))) {
      entry.state = 'undone';
      this.remove(entry);
      this.focus(entry.restoreKey);
      return true;
    }
    entry.state = 'failed';
    this.remove(entry);
    this.options.toast.show({ message: copy('calendar.undoUnavailable') });
    return false;
  }

  /** Writes `target` back when every event still equals `expected`; false when one changed since. */
  private async restore(target: readonly EventSnapshot[], expected: readonly EventSnapshot[]): Promise<boolean> {
    const restoreEvent = this.store.restoreEvent?.bind(this.store);
    const now = this.snapshot(expected.map((s) => s.eventId));
    if (restoreEvent === undefined || now === null) return false;
    if (now.some((snapshot, i) => snapshot.fingerprint !== expected[i]!.fingerprint)) return false;
    try {
      for (const snapshot of [...target].reverse()) await restoreEvent(snapshot);
      return true;
    } catch {
      return false;
    }
  }

  private async undoThroughMerge(drafts: NonNullable<WriteOptions['drafts']>): Promise<boolean> {
    const current = this.store.resolveOccurrence(drafts.key);
    if (current === null) return false;
    // An occurrence of a series is reverted on its own ("this event only"), a single event as a whole.
    const span = current.event.recurrence !== null ? 'this' : 'all';
    let touched: DraftField[];
    let elsewhere: DraftField[];
    try {
      touched = changedFields(drafts.after, drafts.before);
      elsewhere = changedFields(drafts.after, current.draft);
    } catch {
      return false;
    }
    if (touched.some((field) => elsewhere.includes(field))) return false;
    try {
      await this.store.save({ key: drafts.key, original: drafts.after, draft: drafts.before, span });
      return true;
    } catch {
      return false;
    }
  }

  /** Ctrl+Shift+Z / Cmd+Shift+Z: does the last undone change again. */
  async redo(): Promise<boolean> {
    const entry = this.redoStack.pop();
    if (entry === undefined) return false;
    this.changed();
    if (entry.held && entry.request !== null && entry.after === null) {
      try {
        this.hold(entry.request, { message: entry.message, undoableWhenWritten: entry.undoableWritten, restoreKey: entry.restoreKey });
        return true;
      } catch {
        return false;
      }
    }
    if (entry.before === null || entry.after === null) return false;
    this.options.toast.nextAction();
    if (!(await this.restore(entry.after, entry.before))) {
      this.options.toast.show({ message: copy('calendar.undoUnavailable') });
      return false;
    }
    entry.state = 'written';
    this.undoStack.push(entry);
    this.changed();
    this.showChangeToast(entry, true);
    this.focus(entry.redoKey);
    return true;
  }

  private focus(key: string | null): void {
    if (key !== null) this.options.focusEvent?.(key);
  }

  // ---- failures nobody saw ------------------------------------------------

  /**
   * Shows the failures the store recorded while no window was in the
   * foreground (§2.11): one toast naming the event, or "{n} changes couldn't
   * be saved." with Show. Call at launch and when the tab becomes visible.
   */
  showFailedCommits(): void {
    const records = (this.store.failedCommits?.() ?? []).filter((record) => !this.shownFailures.has(record.id));
    if (records.length === 0) return;
    for (const record of records) this.shownFailures.add(record.id);
    const ids = records.map((record) => record.id);
    const clear = () => this.store.clearFailedCommits?.(ids);
    const systemId = this.options.systemId ?? 'ifc';
    const use24Hour = this.options.use24Hour ?? true;
    if (records.length === 1) {
      const record = records[0]!;
      const transient = record.cause === 'transient';
      this.options.toast.show({
        message: failedCommitText(record, systemId, use24Hour),
        action: transient
          ? { label: copy('calendar.tryAgain'), onAction: () => void this.retry(record.request) }
          : { label: copy('calendar.showEvent'), onAction: () => this.options.showEvent?.(record.key) },
        onClose: clear,
      });
      return;
    }
    this.options.toast.show({
      message: plural('calendar.commitFailed.later.many', records.length),
      action: {
        label: copy('calendar.commitFailed.show'),
        onAction: () => this.options.showFailures?.(records),
      },
      onClose: clear,
    });
  }

  /** "Try again" on a row of the failures list. */
  retryFailed(record: StoreFailedCommit): Promise<void> {
    return this.retry(record.request);
  }
}
