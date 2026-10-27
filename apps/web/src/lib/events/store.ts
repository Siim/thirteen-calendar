/**
 * The web's event store (docs/EVENTS.md §3.6, §6.5 `store.ts`): the
 * `EventStore` of `@thirteen/ui` on one iCalendar document per calendar in
 * IndexedDB.
 *
 * - **Reads** are synchronous snapshots: an in-memory index of the records
 *   and documents, and a per-year expansion cache per calendar (expanded in
 *   the worker, `icsEngine.ts`). Views merge years by key (§3.2).
 * - **Writes** are a read-modify-write of one UID group inside the Web Lock
 *   `thirteen-events`: the calendar's current document is read from
 *   IndexedDB (never a tab's in-memory copy), the change is applied to its one
 *   UID group with a three-way merge (`icsModel.ts`), the document is
 *   serialized (every other group, kept component and `VTIMEZONE` byte for
 *   byte) and written, and `BroadcastChannel('thirteen-events')` posts
 *   `{type: 'changed', calendarId}`; other tabs reload that calendar. An
 *   aborted transaction is retried once.
 * - **Pending moves and deletes** (§2.11) are an overlay on the stored
 *   documents until they commit: on the toast's close (`commit()`), the next
 *   write to the same document, a change of that document in another tab,
 *   `visibilitychange` to hidden and `pagehide`, or `commitHeld()` (the alert
 *   planner, a minute before an alert). Each is journaled in `localStorage`
 *   (`thirteen-pending`) with the tab's id while the tab holds the lock
 *   `thirteen-tab-{id}`; entries of closed tabs are replayed on load and when
 *   the tab becomes visible.
 * - **Memory mode**: when IndexedDB cannot be opened the same store runs on
 *   the in-memory backend (`status: 'memory'`, §2.16).
 */

import {
  type Alarm,
  type CalendarEvent,
  type CalendarSystemId,
  DEFAULT_SYSTEM_ID,
  type EventDraft,
  type LocalDateTime,
  type OriginalDate,
  type ZoneResolver,
  alarmFireTime,
  formatLocalDateTime,
  toISODate,
} from '@thirteen/core';
import { type IcsCalendar, type IcsGroup, newICalendar, parseICalendar, removeGroup, replaceGroup, serializeICalendar } from '@thirteen/core/ics';
import {
  CALENDAR_PALETTE,
  type CalendarPatch,
  type DeleteRequest,
  type EventSnapshot,
  type EventStore,
  EventStoreError,
  type EventStoreState,
  type HeldRequest,
  type NewCalendar,
  type PendingChange,
  type ResolvedOccurrence,
  type SaveRequest,
  type StoreCalendar,
  type StoreOccurrence,
  type StoreSubscription,
  type WriteResult,
  type YearSnapshot,
  compareOccurrences,
  parseOccurrenceKey,
} from '@thirteen/ui/headless';
import {
  type BackendSnapshot,
  type BackendWrite,
  type CalendarRecord,
  type DocumentRecord,
  type EventsBackend,
  MemoryBackend,
  StorageFullError,
  TransientStorageError,
  openEventsBackend,
} from './db.ts';
import { type IcsEngine, createIcsEngine } from './icsEngine.ts';
import {
  type CalendarMeta,
  type ChangeResult,
  type ModelContext,
  type WriteContext,
  type Workspace,
  calendarIdOf,
  calendarOccurrences,
  createIn,
  deepEqual,
  deleteIn,
  draftOf,
  eventOf,
  overrideDatesIn,
  recognitionOf,
  resolveInCalendar,
  saveIn,
  setAlarmsIn,
  yearWindow,
} from './icsModel.ts';
import { type Locks, isLockHeld, platformLocks } from './locks.ts';
import { type CommitCause, type FailedCommit, Journal, type JournalEntry, type PendingTarget, TAB_LOCK_PREFIX, platformStorage } from './pending.ts';
import { currentDeviceZone, watchDeviceZone, webZones } from './zones.ts';

export const EVENTS_LOCK = 'thirteen-events';
export const EVENTS_CHANNEL = 'thirteen-events';

/** What the tabs tell each other (§3.6). */
export interface ChannelMessage {
  readonly type: 'changed';
  readonly calendarId: string;
}

/** The part of `BroadcastChannel` the store uses. */
export interface ChannelLike {
  postMessage(message: ChannelMessage): void;
  onmessage: ((event: { data: ChannelMessage }) => void) | null;
  close(): void;
}

/** A stored UID group as it was (`groupSnapshot`, `restoreGroup`). */
export interface GroupSnapshot {
  readonly calendarId: string;
  readonly uid: string;
  readonly group: IcsGroup;
  /** The group after it in the document, so a deleted group goes back in its place. */
  readonly nextUid: string | null;
}

/** A calendar with a snapshot's group back: in place of its UID, or (deleted) before the group that followed it. */
function restoredCalendar(calendar: IcsCalendar, snapshot: GroupSnapshot): IcsCalendar {
  if (calendar.groups.some((g) => g.uid === snapshot.uid)) return replaceGroup(calendar, snapshot.group, { keepRaw: true });
  const nextIndex = snapshot.nextUid === null ? -1 : calendar.groups.findIndex((g) => g.uid === snapshot.nextUid);
  const next = nextIndex < 0 ? null : calendar.groups[nextIndex]!;
  const nextLines = next === null ? [] : [next.master, ...next.overrides].flatMap((m) => (m === null || m.line === null ? [] : [m.line]));
  if (next === null || nextLines.length === 0) return replaceGroup(calendar, snapshot.group, { keepRaw: true });
  // The writer orders components by line: just before the next group's first line keeps the old order.
  const base = Math.min(...nextLines);
  const members = [snapshot.group.master, ...snapshot.group.overrides].filter((m) => m !== null).length;
  let i = 0;
  const place = <T extends { line: number | null }>(m: T): T => ({ ...m, line: base - 1 + (i++ + 1) / (members + 1) });
  const group: IcsGroup = { uid: snapshot.group.uid, master: snapshot.group.master === null ? null : place(snapshot.group.master), overrides: snapshot.group.overrides.map(place) };
  const groups = [...calendar.groups];
  groups.splice(nextIndex, 0, group);
  return { ...calendar, groups };
}

/** {@link LocalEventStore.snapshotEvent}: the contract's snapshot plus the stored group. */
export interface LocalSnapshot extends EventSnapshot {
  readonly calendarId: string;
  readonly uid: string;
  readonly group: GroupSnapshot | null;
}

/** The stored UID group of an event in a parsed document (see {@link LocalEventStore.groupSnapshot}). */
function groupSnapshotIn(calendar: IcsCalendar | null, eventId: string): GroupSnapshot | null {
  if (calendar === null) return null;
  const calendarId = calendarIdOf(eventId);
  const uid = eventId.slice(calendarId.length + 1);
  const index = calendar.groups.findIndex((g) => g.uid === uid);
  if (index < 0) return null;
  const next = calendar.groups.slice(index + 1).find((g) => g.uid !== uid);
  return { calendarId, uid, group: calendar.groups[index]!, nextUid: next?.uid ?? null };
}

/** A group snapshot in the contract's form, with its fingerprint. */
function localSnapshotOf(eventId: string, snapshot: GroupSnapshot | null): LocalSnapshot {
  const calendarId = calendarIdOf(eventId);
  if (snapshot === null) return { eventId, fingerprint: null, group: null, calendarId, uid: eventId.slice(calendarId.length + 1) };
  // Line numbers move when other groups change; the group itself is its text and fields.
  const fingerprint = JSON.stringify(snapshot.group, (key, value: unknown) => (key === 'line' ? undefined : value));
  return { eventId, fingerprint, group: snapshot, calendarId, uid: snapshot.uid };
}

/** A pending change that could not be written (§2.11), for the undo layer's toasts. */
export interface CommitFailure {
  readonly change: PendingChange;
  readonly error: EventStoreError;
  readonly cause: CommitCause;
  /** Written while no window was in the foreground: also recorded for the next launch (`failedCommits()`). */
  readonly unseen: boolean;
}

export interface LocalEventStoreOptions {
  readonly backend: EventsBackend;
  /** Default `navigator.locks` (or the in-page stand-in). */
  readonly locks?: Locks;
  /** Default `new BroadcastChannel('thirteen-events')`; null: no other tabs (memory mode, tests). */
  readonly channel?: ChannelLike | null;
  /** Default `localStorage`. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  readonly zones?: ZoneResolver;
  readonly deviceZone?: string;
  /** Watch the device zone (every minute and on visibility). Default true in a browser. */
  readonly watchZone?: boolean;
  /** Reads the device zone. Default the browser's (`Intl`). */
  readonly readDeviceZone?: () => string;
  readonly systemId?: CalendarSystemId;
  /** Default `new Date()`. */
  readonly now?: () => Date;
  /** New calendar ids and UIDs (lowercase UUID v4). */
  readonly newId?: () => string;
  /** This tab's id. Default a new UUID. */
  readonly tabId?: string;
  /** Default the worker engine. */
  readonly engine?: IcsEngine;
  /** The calendar created on first use (§2.16); null for none. Default "Personal" in the first palette colour. */
  readonly personal?: { readonly title: string; readonly color: string } | null;
  /** For `visibilitychange` and `pagehide`; null for none. Default `document`. */
  readonly document?: Document | null;
  /** The `expandSeries` limit per series and year. */
  readonly limit?: number;
}

interface Doc {
  readonly record: CalendarRecord;
  /** The stored text; null when the record has no document. */
  readonly text: string | null;
  readonly savedAt: string | null;
  readonly previousIcs: string | null;
  /** Grows with every change of `text` (the worker's parse cache key). */
  readonly version: number;
  /** undefined: not parsed yet; null: unreadable. */
  parsed: IcsCalendar | null | undefined;
  unreadable: boolean;
  /** Expanded years (device zone of the store). */
  readonly years: Map<number, StoreOccurrence[]>;
}

interface HeldEntry {
  readonly id: number;
  readonly journalId: string;
  readonly request: HeldRequest;
  readonly calendarIds: readonly string[];
  open: boolean;
  handle: PendingChange | null;
  /** The request's event as its write found it (`PendingChange.replaced`). */
  replaced?: readonly LocalSnapshot[];
}

const DAY = 1440;

function randomId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID().toLowerCase();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** A JS date as a UTC wall clock (minute precision). */
export function utcWallClock(date: Date): LocalDateTime {
  return {
    date: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() },
    minute: date.getUTCHours() * 60 + date.getUTCMinutes(),
  };
}

/** An ISO 8601 UTC string as a UTC wall clock; null for null or an unreadable string. */
export function isoToWallClock(iso: string | null): LocalDateTime | null {
  if (iso === null) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : utcWallClock(date);
}

function toStoreSubscription(record: CalendarRecord, updating: boolean): StoreSubscription | null {
  const s = record.subscription;
  if (s === null) return null;
  return {
    url: s.url,
    interval: s.interval,
    lastAttemptAt: isoToWallClock(s.lastAttemptAt),
    lastSuccessAt: isoToWallClock(s.lastSuccessAt),
    lastError: s.lastError,
    updating,
    addedAt: isoToWallClock(record.createdAt),
  };
}

/** A record as the calendar the views show (§3.4, web column). */
export function toStoreCalendar(record: CalendarRecord, options: { readonly isDefault: boolean; readonly unreadable: boolean; readonly updating: boolean }): StoreCalendar {
  const local = record.kind === 'local';
  return {
    id: record.id,
    title: record.name,
    color: record.color,
    accountId: local ? 'local' : 'subscriptions',
    accountTitle: local ? 'In this browser' : 'Subscriptions',
    accountKind: local ? 'device' : 'subscribed',
    writable: local && !options.unreadable,
    thirteenRepeats: 'all',
    maxAlarms: null,
    supportsAvailability: true,
    supportsUrl: true,
    isPlatformDefault: options.isDefault,
    kind: record.kind,
    visible: record.visible,
    order: record.order,
    subscription: toStoreSubscription(record, options.updating),
    ...(options.unreadable ? { unreadable: true } : {}),
  };
}

function errorOf(error: unknown): EventStoreError {
  if (error instanceof EventStoreError) return error;
  if (error instanceof StorageFullError) return new EventStoreError('storage', 'QuotaExceededError');
  if (error instanceof RangeError) return new EventStoreError('invalid', error.message);
  return new EventStoreError('generic', error instanceof Error ? error.name : 'Error');
}

/** The §2.11 cause of a failed commit. */
export function commitCause(error: EventStoreError): CommitCause {
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

const sameTimeGroup = (a: EventDraft, b: EventDraft) =>
  a.allDay === b.allDay && a.timeZone === b.timeZone && deepEqual(a.start, b.start) && deepEqual(a.end, b.end);

/** The workspace of one read-modify-write: fresh records and documents, the changes made. */
class WriteWorkspace implements Workspace {
  readonly records = new Map<string, CalendarRecord>();
  readonly texts = new Map<string, string | null>();
  readonly parsed = new Map<string, IcsCalendar | null>();
  readonly changedCalendars = new Map<string, IcsCalendar>();
  readonly changedRecords = new Map<string, CalendarRecord>();
  readonly changedTexts = new Map<string, string>();
  readonly removed = new Set<string>();
  /** `previousIcs` as stored, read with the documents. */
  readonly previousTexts = new Map<string, string | null>();
  /** `previousIcs` this write sets explicitly (a new or restored subscription), instead of the moved copy. */
  readonly previousSet = new Map<string, string | null>();

  constructor(
    snapshot: BackendSnapshot,
    private readonly store: LocalEventStore,
  ) {
    for (const [id, record] of snapshot.calendars) this.records.set(id, record);
    for (const [id, doc] of snapshot.documents) {
      this.texts.set(id, doc.ics);
      this.previousTexts.set(id, doc.previousIcs);
    }
  }

  record(id: string): CalendarRecord | null {
    if (this.removed.has(id)) return null;
    return this.changedRecords.get(id) ?? this.records.get(id) ?? null;
  }

  calendar(id: string): IcsCalendar | null {
    if (this.removed.has(id)) return null;
    const changed = this.changedCalendars.get(id);
    if (changed !== undefined) return changed;
    if (this.parsed.has(id)) return this.parsed.get(id)!;
    const record = this.record(id);
    if (record === null) return null;
    const text = this.changedTexts.get(id) ?? this.texts.get(id) ?? null;
    let calendar: IcsCalendar | null;
    if (text === null) calendar = record.kind === 'local' ? newICalendar({ calendarId: id, name: record.name, color: record.color }) : null;
    else calendar = this.store.parse(id, text);
    this.parsed.set(id, calendar);
    return calendar;
  }

  meta(id: string): (CalendarMeta & { readonly info: StoreCalendar }) | null {
    const record = this.record(id);
    if (record === null) return null;
    const unreadable = this.calendar(id) === null;
    const info = toStoreCalendar(record, { isDefault: false, unreadable, updating: false });
    return { id, kind: record.kind, writable: info.writable, title: record.name, info };
  }

  set(id: string, calendar: IcsCalendar): void {
    this.changedCalendars.set(id, calendar);
    this.changedTexts.delete(id);
  }

  /** Stores a text as it is (subscription bodies, imported raw text). */
  setText(id: string, text: string): void {
    this.changedTexts.set(id, text);
    this.changedCalendars.delete(id);
    this.parsed.delete(id);
  }

  putRecord(record: CalendarRecord): void {
    this.removed.delete(record.id);
    this.changedRecords.set(record.id, record);
  }

  remove(id: string): void {
    this.removed.add(id);
    this.changedRecords.delete(id);
    this.changedCalendars.delete(id);
    this.changedTexts.delete(id);
  }

  allRecords(): CalendarRecord[] {
    const ids = new Set([...this.records.keys(), ...this.changedRecords.keys()]);
    return [...ids].flatMap((id) => {
      const record = this.record(id);
      return record === null ? [] : [record];
    });
  }
}

/** The documents API B6 (import, restore, export) and subscriptions build on: one read-modify-write inside the lock. */
export interface DocumentTransaction {
  /** A calendar's index record, fresh. */
  record(id: string): CalendarRecord | null;
  /** Every record read for this transaction (the ids passed, plus the ones created). */
  allRecords(): CalendarRecord[];
  /** A calendar's document, parsed; null when unreadable or missing. */
  calendar(id: string): IcsCalendar | null;
  /** The stored text of a calendar's document (subscriptions: the feed as fetched). */
  text(id: string): string | null;
  /** The previous copy of a subscription (§3.6). */
  previousText(id: string): string | null;
  /** Replaces a document with a calendar (serialized on write). */
  set(id: string, calendar: IcsCalendar): void;
  /** Replaces a document with a text, stored exactly as given; `previousIcs` is kept from `previous` when given. */
  setText(id: string, text: string, options?: { readonly previous?: string | null }): void;
  putRecord(record: CalendarRecord): void;
  remove(id: string): void;
}

/** The web's `EventStore`: documents in IndexedDB, or in memory when IndexedDB is unavailable. */
export class LocalEventStore implements EventStore {
  readonly tabId: string;
  private readonly backend: EventsBackend;
  private readonly locks: Locks;
  private readonly channel: ChannelLike | null;
  private readonly journal: Journal;
  private readonly zones: ZoneResolver;
  private readonly systemId: CalendarSystemId;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly engine: IcsEngine;
  private readonly limit: number | undefined;
  private readonly doc: Document | null;
  private readonly listeners = new Set<() => void>();
  private readonly failureListeners = new Set<(failure: CommitFailure) => void>();
  private readonly writeListeners = new Set<(calendarIds: readonly string[]) => void>();
  private docs = new Map<string, Doc>();
  private held: HeldEntry[] = [];
  private nextHeld = 1;
  private overlay = new Map<string, IcsCalendar>();
  private years = new Map<number, YearSnapshot>();
  /** The snapshots before the last change, shown until the changed calendars are expanded again (no flash of "loading"). */
  private stale = new Map<number, YearSnapshot>();
  private readonly loadingYears = new Map<number, YearSnapshot>();
  private readonly updating = new Set<string>();
  private generation = 0;
  private state: EventStoreState;
  private releaseTab: (() => void) | null = null;
  private alertTimer: ReturnType<typeof setTimeout> | null = null;
  private stopZoneWatch: (() => void) | null = null;
  private closed = false;
  private readonly onVisibility = () => {
    if (this.doc?.visibilityState === 'hidden') void this.commitHeld({ unseen: true });
    else if (this.doc?.visibilityState === 'visible') void this.replayJournal();
  };
  private readonly onPageHide = () => {
    void this.commitHeld({ unseen: true });
  };

  constructor(options: LocalEventStoreOptions) {
    this.backend = options.backend;
    this.locks = options.locks ?? platformLocks();
    this.zones = options.zones ?? webZones();
    this.systemId = options.systemId ?? DEFAULT_SYSTEM_ID;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomId;
    this.tabId = options.tabId ?? randomId();
    this.engine = options.engine ?? createIcsEngine(this.zones);
    this.limit = options.limit;
    // Memory mode keeps nothing for other tabs to replay: its journal stays in this tab.
    this.journal = new Journal(this.backend.kind === 'memory' ? null : options.storage === undefined ? platformStorage() : options.storage);
    this.doc = options.document === undefined ? (globalThis.document ?? null) : options.document;
    let channel: ChannelLike | null = null;
    if (options.channel !== undefined) channel = options.channel;
    else if (this.backend.kind === 'indexeddb' && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(EVENTS_CHANNEL) as unknown as ChannelLike;
    this.channel = channel;
    if (this.channel !== null) this.channel.onmessage = (event) => void this.onChannel(event.data);
    this.state = {
      status: 'loading',
      calendars: [],
      deviceZone: options.deviceZone ?? currentDeviceZone(),
      revision: 0,
    };
    if (options.watchZone ?? this.doc !== null) {
      this.stopZoneWatch = watchDeviceZone(this.state.deviceZone, (zone) => this.setDeviceZone(zone), {
        document: this.doc,
        ...(options.readDeviceZone === undefined ? {} : { read: options.readDeviceZone }),
      });
    }
    this.doc?.addEventListener('visibilitychange', this.onVisibility);
    globalThis.addEventListener?.('pagehide', this.onPageHide);
  }

  // ---- lifecycle --------------------------------------------------------

  /** Takes the tab lock, reads every calendar, creates "Personal" on first use and replays journal entries of closed tabs. */
  async open(personal: { readonly title: string; readonly color: string } | null): Promise<void> {
    // Held for as long as the tab is open: other tabs replay this tab's journal entries only after it closes.
    // (Granted after close(): released at once.)
    void this.locks.request(TAB_LOCK_PREFIX + this.tabId, () => (this.closed ? undefined : new Promise<void>((resolve) => (this.releaseTab = resolve))));
    await this.reloadAll();
    if (personal !== null && this.docs.size === 0 && (await this.backend.getMeta<boolean>('personalCreated')) !== true) {
      await this.createCalendarRecord({ title: personal.title, color: personal.color }, { personalCreated: true });
    }
    this.state = { ...this.state, status: this.backend.kind === 'memory' ? 'memory' : 'ready' };
    this.refresh();
    await this.replayJournal();
  }

  /**
   * Releases the tab lock and stops listening (the tab closes; tests). Held
   * changes stay journaled. `keepEngine`: the engine was passed in and lives on
   * (the memory-mode fallback of {@link openLocalEventStore}).
   */
  close(options: { readonly keepEngine?: boolean } = {}): void {
    this.closed = true;
    if (this.alertTimer !== null) clearTimeout(this.alertTimer);
    this.releaseTab?.();
    this.releaseTab = null;
    this.channel?.close();
    this.stopZoneWatch?.();
    this.doc?.removeEventListener('visibilitychange', this.onVisibility);
    globalThis.removeEventListener?.('pagehide', this.onPageHide);
    if (options.keepEngine !== true) this.engine.dispose();
    this.backend.close();
  }

  get storageKind(): EventsBackend['kind'] {
    return this.backend.kind;
  }

  // ---- reads ------------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): EventStoreState {
    return this.state;
  }

  occurrencesInYear(year: number): YearSnapshot {
    if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError(`Year must be 1 to 9999, got ${year}`);
    const cached = this.years.get(year);
    if (cached !== undefined) return cached;
    const assembled = this.assemble(year);
    if (assembled !== null) {
      this.years.set(year, assembled);
      return assembled;
    }
    const stale = this.stale.get(year);
    if (stale !== undefined) return stale;
    let loading = this.loadingYears.get(year);
    if (loading === undefined) {
      loading = { status: 'loading', year };
      this.loadingYears.set(year, loading);
    }
    return loading;
  }

  async loadYear(year: number): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (this.years.has(year) || this.assembleInto(year)) return;
      const generation = this.generation;
      const jobs = [...this.docs.values()].filter((doc) => !this.overlay.has(doc.record.id) && !doc.years.has(year) && doc.text !== null && !doc.unreadable);
      await Promise.all(
        jobs.map(async (doc) => {
          let list: StoreOccurrence[] | null;
          try {
            list = await this.engine.expandYear({
              calendarId: doc.record.id,
              version: doc.version,
              text: doc.text!,
              meta: this.metaOf(doc),
              year,
              deviceZone: this.state.deviceZone,
              systemId: this.systemId,
              ...(this.limit === undefined ? {} : { limit: this.limit }),
            });
          } catch {
            // The worker failed on this document: expand it here; a document that fails here too is unreadable (§2.16).
            const calendar = this.parsedOf(doc);
            try {
              list = calendar === null ? null : calendarOccurrences(calendar, this.metaOf(doc), yearWindow(year), this.context(), this.limit === undefined ? {} : { limit: this.limit });
            } catch {
              list = null;
            }
          }
          const current = this.docs.get(doc.record.id);
          if (current !== doc) return;
          if (list === null) {
            doc.unreadable = true;
            doc.parsed = null;
            this.refresh();
          } else doc.years.set(year, list);
        }),
      );
      if (generation === this.generation && this.assembleInto(year)) {
        this.emit();
        return;
      }
    }
    if (this.assembleInto(year)) this.emit();
  }

  getEvent(id: string): CalendarEvent | null {
    const calendarId = calendarIdOf(id);
    const calendar = this.visibleCalendar(calendarId);
    const doc = this.docs.get(calendarId);
    if (calendar === null || doc === undefined) return null;
    const uid = id.slice(calendarId.length + 1);
    const group = calendar.groups.find((g) => g.uid === uid);
    if (group === undefined) return null;
    const ctx = this.context();
    const member = group.master ?? group.overrides[0];
    if (member === undefined) return null;
    const recognition = group.master === null ? null : recognitionOf(calendar, group.master, ctx);
    return eventOf(calendar, this.metaOf(doc), member, recognition?.recurrence ?? null, ctx);
  }

  resolveOccurrence(key: string): ResolvedOccurrence | null {
    const calendarId = calendarIdOf(key);
    const calendar = this.visibleCalendar(calendarId);
    const doc = this.docs.get(calendarId);
    if (calendar === null || doc === undefined) return null;
    const resolved = resolveInCalendar(calendar, this.metaOf(doc), key, this.context());
    if (resolved === null) return null;
    return {
      occurrence: resolved.occurrence,
      event: resolved.event,
      draft: resolved.draft,
      isFirst: resolved.isFirst,
      repeatEditable: resolved.recognition?.editable ?? true,
      instanceOnly: resolved.orphan,
    };
  }

  overrideDates(eventId: string): readonly OriginalDate[] {
    const calendarId = calendarIdOf(eventId);
    const calendar = this.visibleCalendar(calendarId);
    if (calendar === null) return [];
    return overrideDatesIn(calendar, eventId.slice(calendarId.length + 1), this.context());
  }

  /** The stored record of a calendar (subscriptions, the Calendars panel). */
  record(id: string): CalendarRecord | null {
    return this.docs.get(id)?.record ?? null;
  }

  /** The stored text of a calendar's document ("Download it" for an unreadable calendar, export). */
  documentText(id: string): string | null {
    return this.docs.get(id)?.text ?? null;
  }

  /** Parses a document text (main thread: edits and resolving); null when it is not iCalendar. */
  parse(calendarId: string, text: string): IcsCalendar | null {
    try {
      return parseICalendar(text, { calendarId, zones: this.zones });
    } catch {
      return null;
    }
  }

  // ---- event writes -----------------------------------------------------

  createEvent(draft: EventDraft): Promise<WriteResult> {
    return this.write([draft.calendarId], (ws, ctx) => createIn(ws, draft, ctx));
  }

  save(request: Omit<SaveRequest, 'kind'>): Promise<WriteResult> {
    return this.write(unique([calendarIdOf(request.key), request.draft.calendarId]), (ws, ctx) => saveIn(ws, request, ctx));
  }

  delete(request: Omit<DeleteRequest, 'kind'>): Promise<WriteResult> {
    return this.write([calendarIdOf(request.key)], (ws, ctx) => deleteIn(ws, request, ctx));
  }

  setAlarms(key: string, alarms: readonly Alarm[]): Promise<WriteResult> {
    return this.write([calendarIdOf(key)], (ws, ctx) => setAlarmsIn(ws, key, alarms, ctx));
  }

  hold(request: HeldRequest): PendingChange {
    // Refused at once when it could not be written now (§2.11: validateDraft before holding).
    const ids = idsOf(request);
    const ws = this.visibleWorkspace(ids);
    const resolved = this.resolveOccurrence(request.key);
    applyRequest(ws, request, this.writeContext());
    const journalId = randomId();
    const entry: HeldEntry = { id: this.nextHeld++, journalId, request, calendarIds: ids, open: true, handle: null };
    this.journal.add({
      id: journalId,
      tab: this.tabId,
      request,
      title: resolved?.event.title ?? '',
      target: targetOf(request, resolved),
      createdAt: this.now().toISOString(),
    });
    this.held.push(entry);
    this.refresh();
    const store = this;
    const handle: PendingChange = {
      id: entry.id,
      request,
      get held() {
        return entry.open;
      },
      get replaced() {
        return entry.replaced;
      },
      commit: () => store.commitEntry(entry, false),
      discard() {
        if (!entry.open) return;
        entry.open = false;
        store.dropHeld(entry);
      },
    };
    entry.handle = handle;
    return handle;
  }

  /**
   * Writes every held change now (`visibilitychange` to hidden, `pagehide`, an
   * alert less than a minute away), or only those of some calendars. Failures
   * go to {@link onCommitFailure}; `unseen` ones are also recorded for the next
   * launch (§2.11 "Failures nobody saw").
   */
  async commitHeld(options: { readonly calendarIds?: readonly string[]; readonly unseen?: boolean; readonly except?: HeldEntry } = {}): Promise<void> {
    const entries = this.held.filter(
      (h) => h.open && h !== options.except && (options.calendarIds === undefined || h.calendarIds.some((id) => options.calendarIds!.includes(id))),
    );
    for (const entry of entries) {
      try {
        await this.commitEntry(entry, options.unseen ?? false, true);
      } catch {
        // Reported through onCommitFailure.
      }
    }
  }

  /** Listens for pending changes that could not be written (§2.11). */
  onCommitFailure(listener: (failure: CommitFailure) => void): () => void {
    this.failureListeners.add(listener);
    return () => {
      this.failureListeners.delete(listener);
    };
  }

  /** Listens for completed writes (storage.ts checks `persisted()` after the first save, §2.16). */
  onWrite(listener: (calendarIds: readonly string[]) => void): () => void {
    this.writeListeners.add(listener);
    return () => {
      this.writeListeners.delete(listener);
    };
  }

  /** Failures nobody saw, recorded for this launch's toast (§2.11). */
  failedCommits(): FailedCommit[] {
    return this.journal.failures();
  }

  /** Clears failure records (their toast closed, or their list was opened). */
  clearFailedCommits(ids?: readonly string[]): void {
    this.journal.clearFailures(ids);
  }

  /** Writes a failed change at once ("Try again", §2.11): no hold, no new Undo window. */
  retry(request: HeldRequest): Promise<WriteResult> {
    return request.kind === 'save' ? this.save(request) : this.delete(request);
  }

  /**
   * The stored UID group of an event, for an exact Undo of a written change
   * (§2.11: the previous version, with the same UID, is written back); null
   * when the event is not stored.
   */
  groupSnapshot(eventId: string): GroupSnapshot | null {
    const doc = this.docs.get(calendarIdOf(eventId));
    return groupSnapshotIn(doc === undefined ? null : this.parsedOf(doc), eventId);
  }

  /**
   * Writes a snapshot back as it was (its components' text kept byte for
   * byte), or removes the group when `snapshot.group` is null: the reversal of
   * a written move, edit or delete. Rejects with `not-found` when the calendar
   * is gone.
   */
  async restoreGroup(snapshot: GroupSnapshot | { readonly calendarId: string; readonly uid: string; readonly group: null; readonly nextUid?: null }): Promise<void> {
    await this.write([snapshot.calendarId], (ws) => {
      const calendar = ws.calendar(snapshot.calendarId);
      if (calendar === null) throw new EventStoreError('not-found', 'This calendar no longer exists.');
      ws.set(snapshot.calendarId, snapshot.group === null ? removeGroup(calendar, snapshot.uid) : restoredCalendar(calendar, snapshot));
      return null;
    });
  }

  /** The contract's form of {@link groupSnapshot} (B5's undo layer, §2.11): the group with a fingerprint. */
  snapshotEvent(eventId: string): LocalSnapshot {
    return localSnapshotOf(eventId, this.groupSnapshot(eventId));
  }

  /** The contract's form of {@link restoreGroup}: the snapshot's group back in its place, or removed. */
  restoreEvent(snapshot: EventSnapshot): Promise<void> {
    const local = snapshot as Partial<LocalSnapshot>;
    if (snapshot.fingerprint === null || local.group === null) {
      // The event did not exist: remove it.
      const calendarId = calendarIdOf(snapshot.eventId);
      return this.restoreGroup({ calendarId, uid: snapshot.eventId.slice(calendarId.length + 1), group: null });
    }
    if (local.group === undefined) return Promise.reject(new EventStoreError('generic', 'Not a snapshot of this store.'));
    return this.restoreGroup(local.group);
  }

  // ---- calendars --------------------------------------------------------

  createCalendar(calendar: NewCalendar): Promise<StoreCalendar> {
    return this.createCalendarRecord(calendar, {});
  }

  /** The calendar new events go to: the first writable local one, or "Personal" again (§2.16). */
  async ensureLocalCalendar(personal: { readonly title: string; readonly color?: string } = { title: 'Personal' }): Promise<StoreCalendar> {
    const existing = this.state.calendars.find((c) => c.kind === 'local' && c.writable);
    if (existing !== undefined) return existing;
    return this.createCalendarRecord({ title: personal.title, ...(personal.color === undefined ? {} : { color: personal.color }) }, {});
  }

  async updateCalendar(id: string, patch: CalendarPatch): Promise<void> {
    if (patch.color !== undefined && !/^#[0-9a-f]{6}$/i.test(patch.color)) throw new EventStoreError('invalid', `Not a colour: ${patch.color}`);
    if (patch.title !== undefined && patch.title.trim() === '') throw new EventStoreError('invalid', 'A calendar needs a name.');
    await this.write([id], (ws) => {
      const record = ws.record(id);
      if (record === null) throw new EventStoreError('not-found', `No calendar ${id}.`);
      const next: CalendarRecord = {
        ...record,
        ...(patch.title !== undefined ? { name: patch.title.trim() } : {}),
        ...(patch.color !== undefined ? { color: patch.color.toLowerCase() } : {}),
        ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
        ...(patch.order !== undefined ? { order: patch.order } : {}),
      };
      ws.putRecord(next);
      // A local calendar's document carries its name and colour (§3.6); feeds are never rewritten.
      if (record.kind === 'local' && (next.name !== record.name || next.color !== record.color)) {
        const calendar = ws.calendar(id);
        if (calendar !== null) ws.set(id, { ...calendar, name: next.name, color: next.color });
      }
      return null;
    }, { commitHeld: false });
  }

  async deleteCalendar(id: string): Promise<void> {
    await this.write([id], (ws) => {
      if (ws.record(id) === null) throw new EventStoreError('not-found', `No calendar ${id}.`);
      ws.remove(id);
      return null;
    }, { commitHeld: false });
    for (const entry of this.held.filter((h) => h.calendarIds.includes(id))) {
      entry.open = false;
      this.dropHeld(entry);
    }
    this.engine.forget(id);
  }

  // ---- documents (import, restore, export, subscriptions) ------------------

  /**
   * One read-modify-write of whole documents inside the `thirteen-events`
   * lock, with fresh records and documents of `ids` (import, restore,
   * subscription refreshes). Held changes on those calendars are written first.
   */
  transact<T>(ids: readonly string[], change: (tx: DocumentTransaction) => T): Promise<T> {
    return this.write(ids, (ws) => change(this.transaction(ws)));
  }

  /** A new calendar id (lowercase UUID v4). */
  createId(): string {
    return this.newId();
  }

  /** The first colour of the §3.6 palette not in use. */
  nextColor(): string {
    const used = new Set([...this.docs.values()].map((d) => d.record.color.toLowerCase()));
    return CALENDAR_PALETTE.find((c) => !used.has(c)) ?? CALENDAR_PALETTE[0]!;
  }

  /** Marks a subscription as refreshing in this tab ("Updating", §2.16). */
  setUpdating(id: string, updating: boolean): void {
    if (updating === this.updating.has(id)) return;
    if (updating) this.updating.add(id);
    else this.updating.delete(id);
    this.refresh({ caches: false });
  }

  /** A key-value of the `meta` store (`lastExportAt`, `exportReminderSnoozedUntil`, ...). */
  getMeta<T>(key: string): Promise<T | undefined> {
    return this.backend.getMeta<T>(key);
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    try {
      await this.backend.write({ meta: { [key]: value } });
    } catch (error) {
      throw errorOf(error);
    }
  }

  /** Re-reads every calendar (another tab created or deleted calendars; tests). */
  async reloadAll(): Promise<void> {
    const snapshot = await this.backend.readAll();
    const ids = new Set([...snapshot.calendars.keys(), ...this.docs.keys()]);
    for (const id of ids) this.applyStored(id, snapshot.calendars.get(id) ?? null, snapshot.documents.get(id) ?? null);
    this.refresh();
  }

  // ---- internals: state -------------------------------------------------

  private context(): ModelContext {
    return { zones: this.zones, deviceZone: this.state.deviceZone, systemId: this.systemId };
  }

  private writeContext(): WriteContext {
    return { ...this.context(), now: utcWallClock(this.now()), newUid: this.newId };
  }

  private metaOf(doc: Doc): CalendarMeta {
    return { id: doc.record.id, kind: doc.record.kind, writable: doc.record.kind === 'local' && !doc.unreadable, title: doc.record.name };
  }

  /** The committed parsed document of a calendar (parsed on first use). */
  private parsedOf(doc: Doc): IcsCalendar | null {
    if (doc.parsed === undefined) {
      if (doc.text === null) {
        doc.parsed = doc.record.kind === 'local' ? newICalendar({ calendarId: doc.record.id, name: doc.record.name, color: doc.record.color }) : null;
      } else {
        doc.parsed = this.parse(doc.record.id, doc.text);
        if (doc.parsed === null) doc.unreadable = true;
      }
    }
    return doc.parsed;
  }

  /** The calendar as the views show it: the stored document with held changes applied. */
  private visibleCalendar(id: string): IcsCalendar | null {
    const overlay = this.overlay.get(id);
    if (overlay !== undefined) return overlay;
    const doc = this.docs.get(id);
    return doc === undefined ? null : this.parsedOf(doc);
  }

  private visibleWorkspace(ids: readonly string[]): Workspace & { changed: Map<string, IcsCalendar> } {
    const changed = new Map<string, IcsCalendar>();
    const store = this;
    void ids;
    return {
      changed,
      calendar: (id) => changed.get(id) ?? store.visibleCalendar(id),
      meta(id) {
        const doc = store.docs.get(id);
        if (doc === undefined) return null;
        const meta = store.metaOf(doc);
        return { ...meta, info: toStoreCalendar(doc.record, { isDefault: false, unreadable: doc.unreadable, updating: false }) };
      },
      set: (id, calendar) => void changed.set(id, calendar),
    };
  }

  private applyStored(id: string, record: CalendarRecord | null, document: DocumentRecord | null): boolean {
    const current = this.docs.get(id);
    if (record === null) {
      if (current === undefined) return false;
      this.docs.delete(id);
      this.engine.forget(id);
      return true;
    }
    const text = document?.ics ?? null;
    if (current !== undefined && current.text === text && deepEqual(current.record, record) && current.previousIcs === (document?.previousIcs ?? null)) return false;
    const sameText = current !== undefined && current.text === text;
    this.docs.set(id, {
      record,
      text,
      savedAt: document?.savedAt ?? null,
      previousIcs: document?.previousIcs ?? null,
      version: sameText ? current.version : (current?.version ?? 0) + 1,
      parsed: sameText ? current.parsed : undefined,
      unreadable: sameText ? current.unreadable : false,
      // Expansions depend on the text and on the record's kind and name (read-only flags).
      years: sameText && current.record.kind === record.kind ? current.years : new Map(),
    });
    return true;
  }

  /** Recomputes the held overlay, the calendars and the revision; tells the listeners. */
  private refresh(options: { readonly caches?: boolean } = {}): void {
    if (options.caches !== false) {
      this.generation++;
      const overlay = new Map<string, IcsCalendar>();
      const movedKeys = new Map<HeldEntry, string | null>();
      const ctx = this.writeContext();
      // Held changes, those being written included, stay on screen until they are written or fail.
      for (const entry of this.held) {
        const ws: Workspace = {
          calendar: (id) => overlay.get(id) ?? (this.docs.has(id) ? this.parsedOf(this.docs.get(id)!) : null),
          meta: (id) => {
            const doc = this.docs.get(id);
            if (doc === undefined) return null;
            return { ...this.metaOf(doc), info: toStoreCalendar(doc.record, { isDefault: false, unreadable: doc.unreadable, updating: false }) };
          },
          set: (id, calendar) => void overlay.set(id, calendar),
        };
        try {
          const result = applyRequest(ws, entry.request, ctx);
          movedKeys.set(entry, result.key);
        } catch {
          // No longer applicable (its event changed): it stays held and fails when it commits.
        }
      }
      this.overlay = overlay;
      this.planAlertCommit(movedKeys);
      // Years on screen are expanded again at once; until then they show their previous snapshot.
      const previous = this.years;
      this.years = new Map();
      for (const [y, snapshot] of previous) this.stale.set(y, snapshot);
      for (const y of previous.keys()) queueMicrotask(() => void this.loadYear(y));
    }
    const docs = [...this.docs.values()].sort((a, b) => a.record.order - b.record.order || a.record.createdAt.localeCompare(b.record.createdAt));
    const firstLocal = docs.find((d) => d.record.kind === 'local' && !d.unreadable)?.record.id ?? null;
    const calendars = docs.map((d) =>
      toStoreCalendar(d.record, { isDefault: d.record.id === firstLocal, unreadable: d.unreadable, updating: this.updating.has(d.record.id) }),
    );
    this.state = { ...this.state, calendars, revision: this.state.revision + 1 };
    this.emit();
  }

  /**
   * One timer for the earliest alert of every held change, at its stored time
   * or its new one: a minute before it, the held changes are written (§2.11),
   * so alerts are never planned from a change that is about to fail.
   */
  private planAlertCommit(movedKeys: ReadonlyMap<HeldEntry, string | null>): void {
    if (this.alertTimer !== null) clearTimeout(this.alertTimer);
    this.alertTimer = null;
    const open = this.held.filter((h) => h.open);
    if (open.length === 0) return;
    const ctx = this.context();
    const occurrences: StoreOccurrence[] = [];
    for (const entry of open) {
      const calendarId = calendarIdOf(entry.request.key);
      const doc = this.docs.get(calendarId);
      const stored = doc === undefined ? null : this.parsedOf(doc);
      if (doc !== undefined && stored !== null) {
        const before = resolveInCalendar(stored, this.metaOf(doc), entry.request.key, ctx);
        if (before !== null) occurrences.push(before.occurrence);
      }
      const key = movedKeys.get(entry) ?? null;
      const target = key === null ? null : this.docs.get(calendarIdOf(key));
      const visible = key === null ? null : this.visibleCalendar(calendarIdOf(key));
      if (key !== null && target !== undefined && target !== null && visible !== null) {
        const after = resolveInCalendar(visible, this.metaOf(target), key, ctx);
        if (after !== null) occurrences.push(after.occurrence);
      }
    }
    let earliest = Number.POSITIVE_INFINITY;
    for (const occurrence of occurrences) {
      for (const alarm of occurrence.alarms) {
        let fire: LocalDateTime | null = null;
        try {
          fire = alarmFireTime(alarm, occurrence, this.state.deviceZone, this.zones);
        } catch {
          // An alert core cannot place is left to the alerts module; it plans nothing here.
        }
        if (fire !== null) earliest = Math.min(earliest, Date.UTC(fire.date.year, fire.date.month - 1, fire.date.day, 0, fire.minute));
      }
    }
    if (!Number.isFinite(earliest)) return;
    const wait = earliest - 60_000 - this.now().getTime();
    // Timers longer than a day are planned again on the next change (held changes last seconds).
    if (wait > 86_400_000) return;
    this.alertTimer = setTimeout(() => {
      this.alertTimer = null;
      void this.commitHeld();
    }, Math.max(0, wait));
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** The year's snapshot when every calendar's expansion is at hand (overlays expanded here), else null. */
  private assemble(year: number): YearSnapshot | null {
    const ctx = this.context();
    const occurrences: StoreOccurrence[] = [];
    for (const doc of this.docs.values()) {
      const id = doc.record.id;
      const overlay = this.overlay.get(id);
      if (overlay !== undefined) {
        occurrences.push(...calendarOccurrences(overlay, this.metaOf(doc), yearWindow(year), ctx, this.limit === undefined ? {} : { limit: this.limit }));
        continue;
      }
      if (doc.unreadable || doc.text === null) continue;
      const cached = doc.years.get(year);
      if (cached === undefined) return null;
      occurrences.push(...cached);
    }
    occurrences.sort(compareOccurrences);
    return { status: 'ready', year, occurrences, truncated: false };
  }

  private assembleInto(year: number): boolean {
    if (this.years.has(year)) return true;
    const snapshot = this.assemble(year);
    if (snapshot === null) return false;
    this.years.set(year, snapshot);
    this.loadingYears.delete(year);
    this.stale.delete(year);
    return true;
  }

  private setDeviceZone(zone: string): void {
    if (zone === this.state.deviceZone) return;
    for (const doc of this.docs.values()) doc.years.clear();
    this.state = { ...this.state, deviceZone: zone };
    this.refresh();
  }

  // ---- internals: writes --------------------------------------------------

  private transaction(ws: WriteWorkspace): DocumentTransaction {
    return {
      record: (id) => ws.record(id),
      allRecords: () => ws.allRecords(),
      calendar: (id) => ws.calendar(id),
      text: (id) => (ws.removed.has(id) ? null : (ws.changedTexts.get(id) ?? ws.texts.get(id) ?? null)),
      // Read with the documents inside the lock, like the text (§3.6: never a tab's in-memory copy).
      previousText: (id) => (ws.removed.has(id) ? null : ws.previousSet.has(id) ? ws.previousSet.get(id)! : (ws.previousTexts.get(id) ?? null)),
      set: (id, calendar) => ws.set(id, calendar),
      setText: (id, text, options) => {
        ws.setText(id, text);
        if (options?.previous !== undefined) ws.previousSet.set(id, options.previous);
      },
      putRecord: (record) => ws.putRecord(record),
      remove: (id) => ws.remove(id),
    };
  }

  private async createCalendarRecord(calendar: NewCalendar, meta: Readonly<Record<string, unknown>>): Promise<StoreCalendar> {
    const title = calendar.title.trim();
    if (title === '') throw new EventStoreError('invalid', 'A calendar needs a name.');
    const color = (calendar.color ?? this.nextColor()).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) throw new EventStoreError('invalid', `Not a colour: ${color}`);
    const id = this.newId();
    const order = Math.max(-1, ...[...this.docs.values()].map((d) => d.record.order)) + 1;
    await this.write(
      [id],
      (ws) => {
        ws.putRecord({ id, kind: 'local', name: title, color, order, visible: true, createdAt: this.now().toISOString(), subscription: null });
        ws.set(id, newICalendar({ calendarId: id, name: title, color }));
        return null;
      },
      { commitHeld: false, meta },
    );
    return this.state.calendars.find((c) => c.id === id)!;
  }

  /** A read-modify-write inside the lock (§3.6); held changes on these calendars are written first. */
  private async write<T>(
    ids: readonly string[],
    change: (ws: WriteWorkspace, ctx: WriteContext) => T,
    options: { readonly commitHeld?: boolean; readonly except?: HeldEntry; readonly meta?: Readonly<Record<string, unknown>> } = {},
  ): Promise<T> {
    if (this.closed) throw new EventStoreError('generic', 'The store is closed.');
    if (options.commitHeld !== false) await this.commitHeld({ calendarIds: ids, ...(options.except ? { except: options.except } : {}) });
    return this.locks.request(EVENTS_LOCK, () => this.writeInLock(ids, change, options.meta ?? {}, 0));
  }

  private async writeInLock<T>(
    ids: readonly string[],
    change: (ws: WriteWorkspace, ctx: WriteContext) => T,
    meta: Readonly<Record<string, unknown>>,
    attempt: number,
  ): Promise<T> {
    let snapshot: BackendSnapshot;
    try {
      snapshot = await this.backend.read(ids);
    } catch (error) {
      if (error instanceof TransientStorageError && attempt === 0) return this.writeInLock(ids, change, meta, 1);
      throw errorOf(error);
    }
    const ws = new WriteWorkspace(snapshot, this);
    const ctx = this.writeContext();
    let result: T;
    try {
      result = change(ws, ctx);
    } catch (error) {
      throw errorOf(error);
    }
    const savedAt = this.now().toISOString();
    const nowText = formatLocalDateTime(ctx.now);
    const documents: DocumentRecord[] = [];
    const touched = new Set<string>([...ws.changedCalendars.keys(), ...ws.changedTexts.keys()]);
    for (const id of touched) {
      const record = ws.record(id);
      if (record === null) continue;
      const calendar = ws.changedCalendars.get(id);
      let ics: string;
      try {
        ics = calendar !== undefined ? serializeICalendar(calendar, this.zones, { now: nowText }) : ws.changedTexts.get(id)!;
      } catch (error) {
        throw errorOf(error);
      }
      // A subscription's stored copy moves to previousIcs when a new body is stored (§3.6).
      const old = snapshot.documents.get(id);
      let previous: string | null = null;
      if (ws.previousSet.has(id)) previous = ws.previousSet.get(id)!;
      else if (record.kind === 'subscription') previous = old === undefined ? null : old.ics !== ics ? old.ics : old.previousIcs;
      documents.push({ calendarId: id, ics, savedAt, previousIcs: previous });
    }
    const change2: BackendWrite = {
      calendars: [...ws.changedRecords.values()],
      documents,
      remove: [...ws.removed],
      meta,
    };
    try {
      await this.backend.write(change2);
    } catch (error) {
      if (error instanceof TransientStorageError && attempt === 0) return this.writeInLock(ids, change, meta, 1);
      throw errorOf(error);
    }
    // The tab's own copy follows what was written.
    const changedIds = unique([...touched, ...ws.changedRecords.keys(), ...ws.removed]);
    for (const id of changedIds) {
      if (ws.removed.has(id)) {
        this.applyStored(id, null, null);
        continue;
      }
      const record = ws.record(id) ?? this.docs.get(id)?.record ?? null;
      const document = documents.find((d) => d.calendarId === id) ?? snapshot.documents.get(id) ?? (this.docs.get(id) ? toDocumentRecord(this.docs.get(id)!) : null);
      this.applyStored(id, record, document);
    }
    for (const id of changedIds) this.channel?.postMessage({ type: 'changed', calendarId: id });
    this.refresh();
    for (const listener of [...this.writeListeners]) listener(changedIds);
    return stripConflicts(result);
  }

  private async commitEntry(entry: HeldEntry, unseen: boolean, early = false): Promise<WriteResult> {
    if (!entry.open) throw new EventStoreError('not-found', 'This change is no longer held.');
    entry.open = false;
    const request = entry.request;
    try {
      const result = await this.write(
        entry.calendarIds,
        (ws, ctx) => {
          if (request.kind === 'save') {
            // A moved event whose time group changed elsewhere is not moved (§2.11).
            const calendarId = calendarIdOf(request.key);
            const meta = ws.meta(calendarId);
            const calendar = ws.calendar(calendarId);
            const now = meta === null || calendar === null ? null : resolveInCalendar(calendar, meta, request.key, ctx);
            if (now !== null && !sameTimeGroup(now.draft, request.original) && !sameTimeGroup(now.draft, request.draft)) {
              throw new EventStoreError('occurrence-gone', 'The time of this event changed in another app.');
            }
          }
          // What this write replaces, read inside the lock: Undo writes exactly this back (§2.11).
          const eventId = parseOccurrenceKey(request.key)?.eventId ?? null;
          if (eventId !== null) entry.replaced = [localSnapshotOf(eventId, groupSnapshotIn(ws.calendar(calendarIdOf(eventId)), eventId))];
          return applyRequest(ws, request, ctx);
        },
        { except: entry },
      );
      this.journal.remove(entry.journalId);
      this.held = this.held.filter((h) => h !== entry);
      this.refresh();
      return result;
    } catch (error) {
      const failure = errorOf(error);
      this.journal.remove(entry.journalId);
      this.held = this.held.filter((h) => h !== entry);
      this.refresh();
      const cause = commitCause(failure);
      if (unseen) this.recordFailure(request, cause, entry);
      if (early || unseen) {
        for (const listener of [...this.failureListeners]) listener({ change: entry.handle!, error: failure, cause, unseen });
      }
      throw failure;
    }
  }

  private recordFailure(request: HeldRequest, cause: CommitCause, entry: HeldEntry | null, journal?: JournalEntry): void {
    const resolved = this.resolveOccurrence(request.key);
    const source = journal ?? this.journal.entries().find((e) => e.id === entry?.journalId);
    this.journal.addFailure({
      id: randomId(),
      kind: request.kind === 'save' ? 'move' : 'delete',
      key: request.key,
      title: source?.title ?? resolved?.event.title ?? '',
      target: source?.target ?? targetOf(request, resolved),
      cause,
      request,
      at: this.now().toISOString(),
    });
  }

  private dropHeld(entry: HeldEntry): void {
    this.journal.remove(entry.journalId);
    this.held = this.held.filter((h) => h !== entry);
    this.refresh();
  }

  /**
   * Replays journal entries of closed tabs (§2.11): inside `thirteen-events`,
   * only entries whose tab lock is free. A delete of a missing event or a move
   * already in place counts as written; a replay that cannot be written is a
   * failure nobody saw.
   */
  async replayJournal(): Promise<void> {
    if (this.closed) return;
    const candidates = this.journal.entries().filter((e) => e.tab !== this.tabId);
    if (candidates.length === 0) return;
    const orphans: JournalEntry[] = [];
    for (const entry of candidates) if (!(await isLockHeld(this.locks, TAB_LOCK_PREFIX + entry.tab))) orphans.push(entry);
    if (orphans.length === 0) return;
    for (const entry of orphans) {
      await this.locks.request(EVENTS_LOCK, async () => {
        // Still there? Another tab may have replayed it while this one waited for the lock.
        if (!this.journal.entries().some((e) => e.id === entry.id)) return;
        try {
          await this.writeInLock(idsOf(entry.request), (ws, ctx) => replayRequest(ws, entry.request, ctx), {}, 0);
        } catch (error) {
          this.recordFailure(entry.request, commitCause(errorOf(error)), null, entry);
        }
        this.journal.remove(entry.id);
      });
    }
  }

  private async onChannel(message: ChannelMessage): Promise<void> {
    if (this.closed || message?.type !== 'changed') return;
    // The document changed elsewhere: held changes on it are written now (§2.11), then it is read again.
    await this.commitHeld({ calendarIds: [message.calendarId] });
    const snapshot = await this.backend.read([message.calendarId]);
    const changed = this.applyStored(message.calendarId, snapshot.calendars.get(message.calendarId) ?? null, snapshot.documents.get(message.calendarId) ?? null);
    if (changed) this.refresh();
  }
}

function unique<T>(list: readonly T[]): T[] {
  return [...new Set(list)];
}

function idsOf(request: HeldRequest): string[] {
  return unique([calendarIdOf(request.key), ...(request.kind === 'save' ? [request.draft.calendarId] : [])]);
}

function applyRequest(ws: Workspace, request: HeldRequest, ctx: WriteContext): ChangeResult {
  return request.kind === 'save' ? saveIn(ws, request, ctx) : deleteIn(ws, request, ctx);
}

/** A journal replay: a delete of a missing occurrence and a move already in place count as written. */
function replayRequest(ws: WriteWorkspace, request: HeldRequest, ctx: WriteContext): ChangeResult {
  const calendarId = calendarIdOf(request.key);
  const meta = ws.meta(calendarId);
  const calendar = ws.calendar(calendarId);
  const resolved = meta === null || calendar === null ? null : resolveInCalendar(calendar, meta, request.key, ctx);
  if (request.kind === 'delete') {
    if (resolved === null) return { eventId: null, key: null, conflicts: [] };
    return deleteIn(ws, request, ctx);
  }
  if (resolved !== null && sameTimeGroup(resolved.draft, request.draft)) return { eventId: resolved.event.id, key: request.key, conflicts: [] };
  if (resolved === null && meta !== null && calendar !== null) {
    // A moved single event changes its key: find it by its id and compare its time.
    const uid = request.key.slice(calendarId.length + 1, request.key.lastIndexOf('|'));
    const group = calendar.groups.find((g) => g.uid === uid);
    if (group?.master != null) {
      const event = eventOf(calendar, meta, group.master, null, ctx);
      if (sameTimeGroup(draftOf(event), request.draft)) return { eventId: event.id, key: null, conflicts: [] };
    }
    // A "future events" move from a later occurrence: the head now ends before it, and the tail is a new
    // group (a new UID) starting at the moved time. Finding that tail means the move is already in place.
    if (request.span === 'future') {
      const targetMeta = ws.meta(request.draft.calendarId);
      const target = ws.calendar(request.draft.calendarId);
      const tail =
        targetMeta === null || target === null
          ? undefined
          : target.groups.find((g) => {
              if (g.master === null || g.uid === uid) return false;
              const event = eventOf(target, targetMeta, g.master, null, ctx);
              return event.title === request.draft.title && sameTimeGroup(draftOf(event), request.draft);
            });
      if (tail !== undefined) return { eventId: `${request.draft.calendarId}/${tail.uid}`, key: null, conflicts: [] };
    }
  }
  if (resolved !== null && !sameTimeGroup(resolved.draft, request.original)) {
    throw new EventStoreError('occurrence-gone', 'The time of this event changed in another app.');
  }
  return saveIn(ws, request, ctx);
}

function targetOf(request: HeldRequest, resolved: ResolvedOccurrence | null): PendingTarget {
  if (request.kind === 'save') {
    const start = request.draft.start;
    return { date: toISODate(start.date), minute: request.draft.allDay ? null : start.minute };
  }
  const start = resolved?.draft.start ?? null;
  return { date: start === null ? '' : toISODate(start.date), minute: resolved?.draft.allDay !== false || start === null ? null : start.minute };
}

function toDocumentRecord(doc: Doc): DocumentRecord | null {
  if (doc.text === null) return null;
  return { calendarId: doc.record.id, ics: doc.text, savedAt: doc.savedAt ?? '', previousIcs: doc.previousIcs };
}

function stripConflicts<T>(result: T): T {
  if (result !== null && typeof result === 'object' && 'conflicts' in result && 'eventId' in result) {
    const { eventId, key, conflicts } = result as unknown as ChangeResult;
    return (conflicts.length > 0 ? { eventId, key, conflicts } : { eventId, key }) as T;
  }
  return result;
}

/** Opens the store on `backend` (or on IndexedDB, falling back to memory, §2.16). */
export async function openLocalEventStore(options: Partial<LocalEventStoreOptions> & { readonly indexedDB?: IDBFactory | null } = {}): Promise<LocalEventStore> {
  const backend = options.backend ?? (await openEventsBackend(options.indexedDB === undefined ? {} : { indexedDB: options.indexedDB }));
  const store = new LocalEventStore({ ...options, backend });
  const personal = options.personal === undefined ? { title: 'Personal', color: CALENDAR_PALETTE[0]! } : options.personal;
  try {
    await store.open(personal);
    return store;
  } catch (error) {
    if (backend.kind !== 'indexeddb') throw error;
    // IndexedDB opened but can't be used (a zero quota refuses the first-use "Personal", a broken database
    // refuses reads): events work in memory for this tab, with the §2.16 banner, instead of no app at all.
    const code = error instanceof EventStoreError ? error.code : ((error as { name?: unknown } | null)?.name ?? 'unknown');
    console.warn(`[thirteen] store: indexeddb-unusable ${String(code)}`);
    store.close({ keepEngine: options.engine !== undefined });
    const memory = new LocalEventStore({ ...options, backend: new MemoryBackend(), channel: null });
    await memory.open(personal);
    return memory;
  }
}

/** Minutes of a day; exported for tests. */
export const MINUTES_PER_DAY = DAY;
