/**
 * The event store contract of the web (docs/EVENTS.md §6.5): what the Calendar
 * views, Today's Up next, details, the editor and the Calendars panel read and
 * write. Two implementations: `MemoryEventStore` (tests, screenshots, the
 * mockup data set of §6.7) and the IndexedDB store of apps/web/src/lib/events
 * (task B2, §3.6), which keeps one iCalendar document per calendar.
 *
 * Reads are synchronous snapshots, so React reads them with
 * `useSyncExternalStore` (`subscribe` + the getters): a getter returns the same
 * object until something changes. Writes are asynchronous and reject with an
 * {@link EventStoreError}. Moves and deletes can be held (§2.11 "Moves and
 * deletes are pending first"): the views show them at once, and they are
 * written only when their handle commits.
 *
 * Every value uses the core types of `@thirteen/core` (§3.1): wall clocks are
 * `LocalDateTime`, ids and keys the Windows and web forms of §3.2
 * (`{calendarId}/{uid}` and `{calendarId}/{uid}|{original start, or date}`).
 */

import type {
  Alarm,
  CalendarEvent,
  CalendarInfo,
  DraftField,
  DraftIssue,
  EventDraft,
  EventOccurrence,
  EventStatus,
  GregorianDate,
  LocalDateTime,
  OriginalDate,
  ReadOnlyReason,
} from '@thirteen/core';

/** `loading` until the stored calendars are read; `memory` when storage is unavailable and nothing is kept (§2.16). */
export type EventStoreStatus = 'loading' | 'ready' | 'memory' | 'failed';

/** The §3.6 subscription fields the Calendars panel shows (§2.15, §2.16). */
export interface StoreSubscription {
  readonly url: string;
  readonly interval: 'PT1H' | 'PT6H' | 'P1D' | 'P7D' | 'manual';
  /** UTC wall clocks: when the last refresh started, and when the stored body's fetch started. */
  readonly lastAttemptAt: LocalDateTime | null;
  readonly lastSuccessAt: LocalDateTime | null;
  /** A `subscribe.error.*` id, `feed-empty` or `feed-partial`. */
  readonly lastError: string | null;
  /** A refresh is running in this tab ("Updating", §2.16). Set by the IndexedDB store only. */
  readonly updating?: boolean;
  /**
   * UTC wall clock of when it was added here (the record's `createdAt`): a feed that has never updated
   * here (restored from a backup) is stale twice its interval after this, as on Windows (§2.16).
   */
  readonly addedAt?: LocalDateTime | null;
}

/** A calendar as the web shows it: core's `CalendarInfo` plus the §3.6 index record fields. */
export interface StoreCalendar extends CalendarInfo {
  readonly kind: 'local' | 'subscription';
  /** Shown in the views (the Calendars list's check box). */
  readonly visible: boolean;
  /** Position in the Calendars list. */
  readonly order: number;
  readonly subscription: StoreSubscription | null;
  /** Its stored document could not be read (§2.16 "Unreadable data": `store.unreadable.web`, "Download it", "Delete calendar"). */
  readonly unreadable?: boolean;
}

/**
 * One occurrence as the views need it: the layout input of core (`key`,
 * `calendarId`, `title`, `allDay`, `start`, `end` in the device's wall clock)
 * plus what chips, rows, labels (§2.20 flags) and alert planning read.
 */
export interface StoreOccurrence extends EventOccurrence {
  /** `{calendarId}/{uid}`: the series (or single event) it belongs to. */
  readonly eventId: string;
  /** Its original date and minute in the event's zone: with `eventId`, its identity (§3.2). */
  readonly originalDate: GregorianDate;
  readonly originalMinute: number | null;
  /** Set when this occurrence was changed on its own ("this event only"). */
  readonly overrideId: string | null;
  /** The start instant as UTC, for `alarmFireTime`; `null` for all-day occurrences. */
  readonly startUtc: LocalDateTime | null;
  readonly location: string;
  readonly status: EventStatus;
  /** Part of a repeating series. */
  readonly recurring: boolean;
  readonly readOnly: ReadOnlyReason | null;
  /** Invitees, from imported `ATTENDEE` lines (§3.5): the editor says changes stay in Thirteen. */
  readonly attendeeCount: number;
  readonly alarms: readonly Alarm[];
}

/** An occurrence with the stored event behind it, for details and the editor. */
export interface ResolvedOccurrence {
  readonly occurrence: StoreOccurrence;
  /** The master (or single event). */
  readonly event: CalendarEvent;
  /**
   * The occurrence as the editor opens it: the event's fields, with this
   * occurrence's own values where it was changed on its own, and its own start
   * and end in the event's zone.
   */
  readonly draft: EventDraft;
  /** It is the series' first occurrence (span choices of §2.11 collapse to the whole series). */
  readonly isFirst: boolean;
  /** `false`: the stored repeat was set in another app and cannot be edited (§4.5 `editable`); default: derived from the rule (B5). */
  readonly repeatEditable?: boolean;
  /** An occurrence shown without its series (an imported override alone, `editor.repeat.instanceOnly`; B5). */
  readonly instanceOnly?: boolean;
}

/** The occurrences of one Gregorian year: every occurrence touching it, in the order key of §5.3. */
export type YearSnapshot =
  | { readonly status: 'loading'; readonly year: number }
  | {
      readonly status: 'ready';
      readonly year: number;
      readonly occurrences: readonly StoreOccurrence[];
      /** Some series hit the expansion limit (§4.6). */
      readonly truncated: boolean;
    };

/** Which occurrences a change applies to (§2.11 span dialog, §4.7). */
export type EditSpan = 'this' | 'future' | 'all';

/** An editor save or a move. */
export interface SaveRequest {
  readonly kind: 'save';
  /** The occurrence that was opened (or dragged). */
  readonly key: string;
  /** The draft as it was opened: the base of the three-way merge (§2.11, §4.9). */
  readonly original: EventDraft;
  readonly draft: EventDraft;
  readonly span: EditSpan;
}

export interface DeleteRequest {
  readonly kind: 'delete';
  readonly key: string;
  readonly span: EditSpan;
}

/** Changes that can be held until their Undo window closes (§2.11). */
export type HeldRequest = SaveRequest | DeleteRequest;

/** What a write produced, for focus after actions (§2.20) and the toast. */
export interface WriteResult {
  /** The event that now holds the change (a "future events" save makes a new one). */
  readonly eventId: string | null;
  /** The key of the changed occurrence after the write, when it still exists. */
  readonly key: string | null;
  /** Field groups changed both here and elsewhere since the editor opened (`editor.changedElsewhere`); the edit won. */
  readonly conflicts?: readonly DraftField[];
}

/** A held change: shown at once, written on `commit()`, forgotten on `discard()` (Undo). */
export interface PendingChange {
  readonly id: number;
  readonly request: HeldRequest;
  /** Writes it now. Rejects (and the views return to the stored state) when it cannot be written. */
  commit(): Promise<WriteResult>;
  /** Forgets it: nothing was written. */
  discard(): void;
  /** Still held (neither committed nor discarded). */
  readonly held: boolean;
  /**
   * Once written (by `commit()` or early by the store): the request's event as the write found it, taken
   * inside the write, so an earlier change of the same event that was still being written is in it
   * (§2.11: one Undo reverts one change). Undefined until then, or when the store keeps no snapshots.
   */
  readonly replaced?: readonly EventSnapshot[];
}

export interface NewCalendar {
  readonly title: string;
  /** `#rrggbb`; default the first colour of the §3.6 palette not in use. */
  readonly color?: string;
}

export interface CalendarPatch {
  readonly title?: string;
  readonly color?: string;
  readonly visible?: boolean;
  readonly order?: number;
}

/** The store-wide snapshot: the same object until something changes. */
export interface EventStoreState {
  readonly status: EventStoreStatus;
  /** In the Calendars list's order. */
  readonly calendars: readonly StoreCalendar[];
  /** The device's IANA zone the occurrences are expanded into. */
  readonly deviceZone: string;
  /** Grows with every change, held changes included. */
  readonly revision: number;
}

export type EventStoreErrorCode =
  /** The occurrence no longer resolves (§3.2, `editor.occurrenceGone`). */
  | 'occurrence-gone'
  /** The calendar or event cannot be changed (`editor.saveFailed.readOnly`). */
  | 'read-only'
  /** `validateDraft` issues; see `issues`. */
  | 'invalid'
  /** Storage is full (`editor.saveFailed.storage`). */
  | 'storage'
  | 'not-found'
  /** Anything else (`editor.saveFailed.generic`). */
  | 'generic';

export class EventStoreError extends Error {
  readonly code: EventStoreErrorCode;
  readonly issues: readonly DraftIssue[];

  constructor(code: EventStoreErrorCode, message: string, issues: readonly DraftIssue[] = []) {
    super(message);
    this.name = 'EventStoreError';
    this.code = code;
    this.issues = issues;
  }
}

export interface EventStore {
  /** Called after every change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  getState(): EventStoreState;
  /** The year's occurrences of every calendar (hidden ones too); `loading` until {@link loadYear} has run. */
  occurrencesInYear(year: number): YearSnapshot;
  /** Expands a year if it is not cached yet; resolves when `occurrencesInYear` is ready. */
  loadYear(year: number): Promise<void>;
  /** The stored master or single event. */
  getEvent(id: string): CalendarEvent | null;
  /** An occurrence by key, with its event and draft; `null` when it no longer resolves. */
  resolveOccurrence(key: string): ResolvedOccurrence | null;

  /** Adds a new event; rejects with `invalid` when `validateDraft` finds issues. */
  createEvent(draft: EventDraft): Promise<WriteResult>;
  /** Writes an editor save at once (§2.11 "Editor saves are written at once"). */
  save(request: Omit<SaveRequest, 'kind'>): Promise<WriteResult>;
  /** Deletes at once. */
  delete(request: Omit<DeleteRequest, 'kind'>): Promise<WriteResult>;
  /** Holds a move or delete: the views show it now, it is written on commit (§2.11). */
  hold(request: HeldRequest): PendingChange;
  /** Changes only the alerts (invitations and historical events, §3.5). */
  setAlarms(key: string, alarms: readonly Alarm[]): Promise<WriteResult>;

  createCalendar(calendar: NewCalendar): Promise<StoreCalendar>;
  updateCalendar(id: string, patch: CalendarPatch): Promise<void>;
  /** Removes the calendar and its events. */
  deleteCalendar(id: string): Promise<void>;

  // ---- Optional: exact undo of written changes and commit failures (§2.11, Windows and web; B5) ----

  /**
   * A copy of an event's stored data (its whole UID group), taken before and
   * after a write, so a written change can be undone exactly (§2.11: "the
   * previous version, with the same UID, is written back"). An event that is
   * not stored gives a snapshot with `fingerprint: null`.
   */
  snapshotEvent?(eventId: string): EventSnapshot;
  /** Writes a snapshot back as it was; a `fingerprint: null` snapshot removes the event. */
  restoreEvent?(snapshot: EventSnapshot): Promise<void>;
  /** Held changes the store wrote by itself (written early, §2.11) that could not be written. */
  onCommitFailure?(listener: (failure: StoreCommitFailure) => void): () => void;
  /** Failures nobody saw (§2.11 "Failures nobody saw"), kept until their toast closes or their list opens. */
  failedCommits?(): readonly StoreFailedCommit[];
  /** Clears failure records (all of them without `ids`). */
  clearFailedCommits?(ids?: readonly string[]): void;

  // ---- Optional: what a span choice would remove, said before the choice (§2.11; B4) ----

  /**
   * The original dates of a series' changed occurrences (its overrides, in
   * every year), as core's `splitRecurrence` and `retimeExceptions` take them,
   * so the drag span question can count what "future events" would remove
   * (`span.future.exceptionsDropped`). `[]` for a single event.
   */
  overrideDates?(eventId: string): readonly OriginalDate[];
}

/** An event's stored data at one moment (see {@link EventStore.snapshotEvent}); stores add their own fields. */
export interface EventSnapshot {
  readonly eventId: string;
  /** Equal fingerprints mean the stored event did not change in between; `null`: no such event. */
  readonly fingerprint: string | null;
}

/** Why a held change could not be written (§2.11): transient (Try again), changed elsewhere, or a final reason. */
export type StoreCommitCause = 'transient' | 'changed' | 'readOnly' | 'storage' | 'access' | 'account';

/** A held change the store could not write. */
export interface StoreCommitFailure {
  readonly change: PendingChange;
  readonly error: EventStoreError;
  readonly cause: StoreCommitCause;
  /** Written while no window was in the foreground; also kept in {@link EventStore.failedCommits}. */
  readonly unseen: boolean;
}

/** A failure nobody saw, as recorded for the next launch (§2.11). */
export interface StoreFailedCommit {
  readonly id: string;
  readonly kind: 'move' | 'delete';
  readonly key: string;
  /** The event's title when the change was made. */
  readonly title: string;
  /** Where it was going: the move's new start, or the deleted occurrence's date (`YYYY-MM-DD`, minute null for all-day). */
  readonly target: { readonly date: string; readonly minute: number | null };
  readonly cause: StoreCommitCause;
  readonly request: HeldRequest;
  /** ISO 8601 UTC. */
  readonly at: string;
}
