import { describe, expect, it, vi } from 'vitest';
import type { ToastApi, ToastCloseReason, ToastHandle, ToastOptions } from '../primitives/Toast.tsx';
import { MemoryEventStore } from './MemoryEventStore.ts';
import { mockupCalendars, mockupData } from './mockup.ts';
import {
  type DeleteRequest,
  EventStoreError,
  type HeldRequest,
  type PendingChange,
  type StoreCommitFailure,
  type StoreFailedCommit,
  type WriteResult,
} from './store.ts';
import { EventUndo, UNDO_LIMIT, commitCauseOf, commitFailedText, failedCommitText } from './undo.ts';

/** A store whose held changes can fail to be written, with the failure hooks of §2.11. */
class FlakyStore extends MemoryEventStore {
  failWith: EventStoreError | null = null;
  records: StoreFailedCommit[] = [];
  private readonly failureListeners = new Set<(failure: StoreCommitFailure) => void>();

  override hold(request: HeldRequest): PendingChange {
    const inner = super.hold(request);
    const store = this;
    const change: PendingChange = {
      id: inner.id,
      request,
      get held() {
        return inner.held;
      },
      commit() {
        const error = store.failWith;
        if (error === null) return inner.commit();
        inner.discard();
        return Promise.reject(error);
      },
      discard() {
        inner.discard();
      },
    };
    return change;
  }

  /** Direct writes ("Try again" writes at once) fail the same way while `failWithDirect` is set. */
  failWithDirect: EventStoreError | null = null;

  override delete(request: Omit<DeleteRequest, 'kind'>): Promise<WriteResult> {
    return this.failWithDirect === null ? super.delete(request) : Promise.reject(this.failWithDirect);
  }

  /** The store wrote nothing and says so later (another tab, the tab hidden): an unseen failure. */
  failInBackground(change: PendingChange, error: EventStoreError, unseen: boolean): void {
    change.discard();
    for (const listener of this.failureListeners) listener({ change, error, cause: commitCauseOf(error), unseen });
  }

  onCommitFailure(listener: (failure: StoreCommitFailure) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  failedCommits(): readonly StoreFailedCommit[] {
    return this.records;
  }

  clearFailedCommits(ids?: readonly string[]): void {
    this.records = ids === undefined ? [] : this.records.filter((record) => !ids.includes(record.id));
  }
}

function createStore(): FlakyStore {
  const data = mockupData();
  let next = 0;
  return new FlakyStore({ calendars: mockupCalendars('web'), events: data.events, deviceZone: data.deviceZone, newId: () => `new-${++next}` });
}

interface Shown {
  readonly handle: ToastHandle;
  readonly options: ToastOptions;
  open: boolean;
  reason: ToastCloseReason | null;
}

/** A toast region that keeps every toast, closing the current one before the next (§2.11). */
function fakeToast() {
  const shown: Shown[] = [];
  let id = 0;
  const closeShown = (toast: Shown | undefined, reason: ToastCloseReason) => {
    if (toast === undefined || !toast.open) return;
    toast.open = false;
    toast.reason = reason;
    toast.options.onClose?.(reason);
  };
  const api: ToastApi = {
    show(options) {
      closeShown(
        shown.find((s) => s.open),
        'replaced',
      );
      const handle = { id: ++id };
      shown.push({ handle, options, open: true, reason: null });
      return handle;
    },
    close(handle, reason = 'dismissed') {
      closeShown(
        handle === undefined ? shown.find((s) => s.open) : shown.find((s) => s.handle.id === handle.id),
        reason,
      );
    },
    nextAction() {
      closeShown(
        shown.find((s) => s.open),
        'next-action',
      );
    },
  };
  return {
    api,
    shown,
    current: () => shown.find((s) => s.open) ?? null,
    /** Clicks the current toast's action. */
    act() {
      const toast = shown.find((s) => s.open)!;
      toast.open = false;
      toast.reason = 'action';
      toast.options.action!.onAction();
      toast.options.onClose?.('action');
    },
  };
}

const DENTIST = 'home/dentist|2026-10-19T15:40';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setUp(options: { mac?: boolean } = {}) {
  const store = createStore();
  const toast = fakeToast();
  const focusEvent = vi.fn();
  const showEvent = vi.fn();
  const showFailures = vi.fn();
  const undo = new EventUndo(store, { toast: toast.api, mac: options.mac ?? false, focusEvent, showEvent, showFailures, systemId: 'ifc', use24Hour: true });
  const detach = undo.attach();
  return { store, toast, undo, focusEvent, showEvent, showFailures, detach };
}

const deleteDentist: HeldRequest = { kind: 'delete', key: DENTIST, span: 'all' };

describe('held moves and deletes (§2.11)', () => {
  it('holds a delete with Undo, and discards it on Undo: nothing was written', async () => {
    const { store, toast, undo, focusEvent } = setUp();
    undo.hold(deleteDentist, { message: 'Event deleted.', undoableWhenWritten: true });
    expect(store.resolveOccurrence(DENTIST)).toBeNull();
    const shown = toast.current()!;
    expect(shown.options.message).toBe('Event deleted.');
    expect(shown.options.action?.label).toBe('Undo');
    expect(shown.options.announcement).toBe('Event deleted. Undo available: Control Z.');
    expect(await undo.undo()).toBe(true);
    expect(store.resolveOccurrence(DENTIST)).not.toBeNull();
    expect(focusEvent).toHaveBeenCalledWith(DENTIST);
    expect(toast.current()).toBeNull();
    expect(undo.canRedo).toBe(true);
  });

  it('says Command Z on a Mac', () => {
    const { toast, undo } = setUp({ mac: true });
    undo.hold(deleteDentist, { message: 'Event deleted.', undoableWhenWritten: true });
    expect(toast.current()!.options.announcement).toBe('Event deleted. Undo available: Command Z.');
  });

  it('writes when the toast closes, and still undoes exactly afterwards', async () => {
    const { store, toast, undo } = setUp();
    undo.hold(deleteDentist, { message: 'Event deleted.', undoableWhenWritten: true });
    toast.api.close(undefined, 'timeout');
    await flush();
    expect(store.getEvent('home/dentist')).toBeNull();
    expect(await undo.undo()).toBe(true);
    expect(store.getEvent('home/dentist')).not.toBeNull();
    expect(store.resolveOccurrence(DENTIST)).not.toBeNull();
  });

  it('commits the held change at the next action', async () => {
    const { store, toast, undo } = setUp();
    undo.hold(deleteDentist, { message: 'Event deleted.', undoableWhenWritten: true });
    toast.api.nextAction();
    await flush();
    expect(store.getEvent('home/dentist')).toBeNull();
  });

  it('redoes an undone held change by holding it again', async () => {
    const { store, undo } = setUp();
    undo.hold(deleteDentist, { message: 'Event deleted.', undoableWhenWritten: true });
    await undo.undo();
    expect(await undo.redo()).toBe(true);
    expect(store.resolveOccurrence(DENTIST)).toBeNull();
  });

  it('keeps the toast but drops Undo when the store wrote early and the change cannot be undone', async () => {
    const { store, toast, undo } = setUp();
    const pending = undo.hold({ kind: 'delete', key: 'work/one-on-one|2026-10-19T11:00', span: 'future' }, { message: 'Event deleted.', undoableWhenWritten: false });
    await pending.commit();
    await flush();
    expect(store.resolveOccurrence('work/one-on-one|2026-10-26T11:00')).toBeNull();
    const shown = toast.current()!;
    expect(shown.options.message).toBe('Event deleted.');
    expect(shown.options.action).toBeUndefined();
    expect(undo.canUndo).toBe(false);
  });

  it('keeps 20 changes', () => {
    expect(UNDO_LIMIT).toBe(20);
  });
});

describe('editor saves (§2.11 "Editor saves are written at once")', () => {
  it('writes at once, says "Event saved." and undoes exactly', async () => {
    const { store, toast, undo, focusEvent } = setUp();
    const resolved = store.resolveOccurrence(DENTIST)!;
    const draft = { ...resolved.draft, title: 'Dentist' };
    await undo.write(() => store.save({ key: DENTIST, original: resolved.draft, draft, span: 'all' }), {
      kind: 'save',
      message: 'Event saved.',
      eventIds: ['home/dentist'],
      undoable: true,
      restoreKey: DENTIST,
      drafts: { key: DENTIST, before: resolved.draft, after: draft },
    });
    expect(store.getEvent('home/dentist')!.title).toBe('Dentist');
    expect(toast.current()!.options.message).toBe('Event saved.');
    expect(toast.current()!.options.action?.label).toBe('Undo');
    toast.act();
    await flush();
    expect(store.getEvent('home/dentist')!.title).toBe('Dentist, Dr. Tamm');
    expect(focusEvent).toHaveBeenCalledWith(DENTIST);
  });

  it('removes an added event on Undo', async () => {
    const { store, undo } = setUp();
    const resolved = store.resolveOccurrence(DENTIST)!;
    const result = await undo.write(() => store.createEvent({ ...resolved.draft, title: 'Added' }), {
      kind: 'save',
      message: 'Event saved.',
      eventIds: [],
      undoable: true,
    });
    expect(store.getEvent(result.eventId!)).not.toBeNull();
    await undo.undo();
    expect(store.getEvent(result.eventId!)).toBeNull();
  });

  it('shows no Undo for future or all events of a series', async () => {
    const { store, toast, undo } = setUp();
    const key = 'work/one-on-one|2026-10-19T11:00';
    const resolved = store.resolveOccurrence(key)!;
    await undo.write(() => store.save({ key, original: resolved.draft, draft: { ...resolved.draft, title: '1:1' }, span: 'future' }), {
      kind: 'save',
      message: 'Event saved.',
      eventIds: ['work/one-on-one'],
      undoable: false,
    });
    expect(toast.current()!.options.action).toBeUndefined();
    expect(undo.canUndo).toBe(false);
  });

  it('reverts only its own fields when another app changed others since', async () => {
    const { store, undo } = setUp();
    const resolved = store.resolveOccurrence(DENTIST)!;
    const draft = { ...resolved.draft, title: 'Dentist' };
    await undo.write(() => store.save({ key: DENTIST, original: resolved.draft, draft, span: 'all' }), {
      kind: 'save',
      message: 'Event saved.',
      eventIds: ['home/dentist'],
      undoable: true,
      drafts: { key: DENTIST, before: resolved.draft, after: draft },
    });
    // Another app adds notes.
    const now = store.resolveOccurrence(DENTIST)!;
    await store.save({ key: DENTIST, original: now.draft, draft: { ...now.draft, notes: 'Bring the form' }, span: 'all' });
    expect(await undo.undo()).toBe(true);
    const event = store.getEvent('home/dentist')!;
    expect(event.title).toBe('Dentist, Dr. Tamm');
    expect(event.notes).toBe('Bring the form');
  });

  it('reverts a "this event only" change of a repeating event through mergeDraft when another field changed since', async () => {
    const { store, undo } = setUp();
    const BOOK_CLUB = 'home/book-club|2026-10-19T19:00';
    const resolved = store.resolveOccurrence(BOOK_CLUB)!;
    const draft = { ...resolved.draft, title: 'Book club: Ulysses' };
    await undo.write(() => store.save({ key: BOOK_CLUB, original: resolved.draft, draft, span: 'this' }), {
      kind: 'save',
      message: 'Event saved.',
      eventIds: ['home/book-club'],
      undoable: true,
      drafts: { key: BOOK_CLUB, before: resolved.draft, after: draft },
    });
    const now = store.resolveOccurrence(BOOK_CLUB)!;
    await store.save({ key: BOOK_CLUB, original: now.draft, draft: { ...now.draft, location: 'Library' }, span: 'this' });
    expect(await undo.undo()).toBe(true);
    const after = store.resolveOccurrence(BOOK_CLUB)!;
    expect(after.occurrence.title).toBe('Book club: Cotsworth');
    expect(after.draft.location).toBe('Library');
  });

  it('undoes a written move through mergeDraft when another field changed since (§2.11)', async () => {
    const { store, toast, undo } = setUp();
    const resolved = store.resolveOccurrence(DENTIST)!;
    const draft = { ...resolved.draft, start: { ...resolved.draft.start, minute: 17 * 60 }, end: { ...resolved.draft.end, minute: 17 * 60 + 40 } };
    undo.hold({ kind: 'save', key: DENTIST, original: resolved.draft, draft, span: 'all' }, { message: 'Event moved.', undoableWhenWritten: true });
    toast.api.close(undefined, 'timeout');
    await flush();
    const moved = store.resolveOccurrence('home/dentist|2026-10-19T17:00')!;
    await store.save({ key: moved.occurrence.key, original: moved.draft, draft: { ...moved.draft, notes: 'Bring the form' }, span: 'all' });
    expect(await undo.undo()).toBe(true);
    const event = store.getEvent('home/dentist')!;
    expect(event.start.minute).toBe(15 * 60 + 40);
    expect(event.notes).toBe('Bring the form');
  });

  it('says it cannot undo when another app changed the same fields', async () => {
    const { store, toast, undo } = setUp();
    const resolved = store.resolveOccurrence(DENTIST)!;
    const draft = { ...resolved.draft, title: 'Dentist' };
    await undo.write(() => store.save({ key: DENTIST, original: resolved.draft, draft, span: 'all' }), {
      kind: 'save',
      message: 'Event saved.',
      eventIds: ['home/dentist'],
      undoable: true,
      drafts: { key: DENTIST, before: resolved.draft, after: draft },
    });
    const now = store.resolveOccurrence(DENTIST)!;
    await store.save({ key: DENTIST, original: now.draft, draft: { ...now.draft, title: 'Dentist at 15:40' }, span: 'all' });
    expect(await undo.undo()).toBe(false);
    expect(toast.current()!.options.message).toBe('This event changed in another app, so it can’t be undone.');
    expect(store.getEvent('home/dentist')!.title).toBe('Dentist at 15:40');
  });
});

describe('commit failures (§2.11)', () => {
  it('returns the views to the stored state and offers Try again for a passing failure', async () => {
    const { store, toast, undo } = setUp();
    store.failWith = new EventStoreError('generic', 'Network down');
    undo.hold(deleteDentist, { message: 'Event deleted.', undoableWhenWritten: true });
    toast.api.close(undefined, 'timeout');
    await flush();
    expect(store.resolveOccurrence(DENTIST)).not.toBeNull();
    const shown = toast.current()!;
    expect(shown.options.message).toBe('Couldn’t delete the event.');
    expect(shown.options.action?.label).toBe('Try again');
    expect(undo.canUndo).toBe(false);
    store.failWith = null;
    toast.act();
    await flush();
    expect(store.getEvent('home/dentist')).toBeNull();
  });

  it('writes at once on Try again, and a second failure gets no Try again and no new Undo (§2.11)', async () => {
    const { store, toast, undo } = setUp();
    store.failWith = new EventStoreError('generic', 'Network down');
    undo.hold(deleteDentist, { message: 'Event deleted.', undoableWhenWritten: true });
    toast.api.close(undefined, 'timeout');
    await flush();
    expect(toast.current()!.options.action?.label).toBe('Try again');
    const shownBefore = toast.shown.length;
    store.failWithDirect = new EventStoreError('generic', 'Network still down');
    toast.act();
    await flush();
    // No second hold: the views never showed the event as deleted again, and nothing was registered for Undo.
    expect(store.resolveOccurrence(DENTIST)).not.toBeNull();
    expect(undo.canUndo).toBe(false);
    expect(toast.shown.length).toBe(shownBefore + 1);
    expect(toast.current()!.options.message).toBe('Couldn’t delete the event.');
    expect(toast.current()!.options.action).toBeUndefined();
  });

  it('names a final cause and offers no Try again', async () => {
    const { store, toast, undo } = setUp();
    store.failWith = new EventStoreError('storage', 'Quota');
    undo.hold(deleteDentist, { message: 'Event deleted.', undoableWhenWritten: true });
    toast.api.nextAction();
    await flush();
    expect(toast.current()!.options.message).toBe(
      'Couldn’t delete the event. There’s no room left to save events in this browser. Export and delete old calendars to make room.',
    );
    expect(toast.current()!.options.action).toBeUndefined();
  });

  it('says when the event changed in another app', async () => {
    const { store, toast, undo } = setUp();
    const pending = undo.hold(deleteDentist, { message: 'Event deleted.', undoableWhenWritten: true });
    store.failInBackground(pending, new EventStoreError('occurrence-gone', 'Gone'), false);
    expect(toast.current()!.options.message).toBe('This event changed in another app, so it wasn’t deleted.');
  });

  it('leaves failures nobody saw to the next launch or foreground', async () => {
    const { store, toast, undo, showEvent } = setUp();
    const pending = undo.hold(deleteDentist, { message: 'Event deleted.', undoableWhenWritten: true });
    const before = toast.shown.length;
    store.failInBackground(pending, new EventStoreError('read-only', 'No'), true);
    expect(toast.shown.length).toBe(before);
    store.records = [
      {
        id: 'f1',
        kind: 'delete',
        key: DENTIST,
        title: 'Dentist, Dr. Tamm',
        target: { date: '2026-10-19', minute: 940 },
        cause: 'readOnly',
        request: deleteDentist,
        at: '2026-10-19T09:41Z',
      },
    ];
    undo.showFailedCommits();
    const shown = toast.current()!;
    expect(shown.options.message).toBe(
      'Couldn’t delete “Dentist, Dr. Tamm” on Thursday, October 12, 2026. This calendar can’t be changed. Choose another calendar.',
    );
    expect(shown.options.action?.label).toBe('Show event');
    toast.act();
    expect(showEvent).toHaveBeenCalledWith(DENTIST);
    expect(store.records).toEqual([]);
    // Shown once.
    undo.showFailedCommits();
    expect(toast.current()).toBeNull();
  });

  it('gathers several failures in one toast with Show', () => {
    const { store, toast, undo, showFailures } = setUp();
    const record = (id: string, minute: number | null): StoreFailedCommit => ({
      id,
      kind: 'move',
      key: DENTIST,
      title: 'Dentist, Dr. Tamm',
      target: { date: '2026-10-20', minute },
      cause: 'transient',
      request: deleteDentist,
      at: '2026-10-19T09:41Z',
    });
    const records = [record('a', 600), record('b', null)];
    store.records = records;
    undo.showFailedCommits();
    expect(toast.current()!.options.message).toBe('2 changes couldn’t be saved.');
    expect(toast.current()!.options.action?.label).toBe('Show');
    toast.act();
    expect(showFailures).toHaveBeenCalledWith(records);
    expect(store.records).toEqual([]);
    expect(failedCommitText(record('a', 600), 'ifc', true)).toBe('Couldn’t move “Dentist, Dr. Tamm” to Friday, October 13, 2026 at 10:00.');
    expect(failedCommitText(record('b', null), 'ifc', true)).toBe('Couldn’t move “Dentist, Dr. Tamm” to Friday, October 13, 2026.');
  });

  it('maps store errors to causes and texts', () => {
    expect(commitCauseOf(new Error('x'))).toBe('transient');
    expect(commitCauseOf(new EventStoreError('not-found', 'x'))).toBe('changed');
    expect(commitCauseOf(new EventStoreError('read-only', 'x'))).toBe('readOnly');
    expect(commitFailedText('move', 'transient')).toBe('Couldn’t move the event.');
    expect(commitFailedText('move', 'changed')).toBe('This event changed in another app, so it wasn’t moved.');
    expect(commitFailedText('move', 'account')).toBe('Couldn’t move the event. The calendar’s account didn’t accept this change. Try another calendar.');
  });
});

describe('the stack', () => {
  it('stops listening when detached', async () => {
    const { store, undo, detach } = setUp();
    detach();
    const pending = undo.hold(deleteDentist, { message: 'Event deleted.', undoableWhenWritten: true });
    store.failInBackground(pending, new EventStoreError('generic', 'x'), false);
    // Not heard: the entry is still pending, though the store discarded it.
    expect(undo.canUndo).toBe(true);
  });
});
