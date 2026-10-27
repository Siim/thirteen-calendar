/**
 * The web's local store on disk (docs/EVENTS.md §3.6): IndexedDB database
 * `thirteen-events`, version 1, without a library.
 *
 * - `calendars` (keyPath `id`): the index records the user edits (name, colour,
 *   order, visibility, the subscription fields).
 * - `documents` (keyPath `calendarId`): one iCalendar text per calendar,
 *   `{calendarId, ics, savedAt, previousIcs}` (`previousIcs`: subscriptions
 *   only, the copy before the last accepted refresh).
 * - `meta` (out-of-line keys): `lastExportAt`, `exportReminderSnoozedUntil`, ...
 *
 * When IndexedDB cannot be opened (a privacy setting, some private windows, a
 * zero quota) {@link openEventsBackend} returns the in-memory backend instead:
 * the same contract, nothing kept after the tab closes (§2.16 "Storage
 * unavailable").
 */

export const DB_NAME = 'thirteen-events';
export const DB_VERSION = 1;
const CALENDARS = 'calendars';
const DOCUMENTS = 'documents';
const META = 'meta';

/** `PT1H`, `PT6H`, `P1D`, `P7D` or `manual` (§3.6). */
export type SubscriptionInterval = 'PT1H' | 'PT6H' | 'P1D' | 'P7D' | 'manual';

/** The parse outcome of a feed body held back as suspicious (§2.16). */
export interface FeedOutcome {
  readonly kind: 'empty' | 'partial';
  readonly events: number;
  readonly skipped: number;
}

/** The subscription fields of an index record (§3.6); times are ISO 8601 UTC strings. */
export interface SubscriptionRecord {
  readonly url: string;
  readonly interval: SubscriptionInterval;
  /** Filled on Windows only: the web never sends conditional headers (§6.5). */
  readonly etag: null;
  readonly lastModified: null;
  /** `sha256:<hex>` of the stored body. */
  readonly contentHash: string | null;
  readonly suspect: FeedOutcome | null;
  readonly lastAttemptAt: string | null;
  /** When the stored body's fetch started. */
  readonly lastSuccessAt: string | null;
  /** A `subscribe.error.*` id, `feed-empty` or `feed-partial`. */
  readonly lastError: string | null;
}

/** An index record (§3.6, JSON names as on Windows). */
export interface CalendarRecord {
  readonly id: string;
  readonly kind: 'local' | 'subscription';
  readonly name: string;
  /** `#rrggbb`. */
  readonly color: string;
  readonly order: number;
  readonly visible: boolean;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
  readonly subscription: SubscriptionRecord | null;
}

/** A calendar's document. */
export interface DocumentRecord {
  readonly calendarId: string;
  readonly ics: string;
  /** ISO 8601 UTC. */
  readonly savedAt: string;
  /** Subscriptions: the copy before the last accepted refresh. */
  readonly previousIcs: string | null;
}

/** One atomic write: everything in it is stored, or nothing. */
export interface BackendWrite {
  readonly calendars?: readonly CalendarRecord[];
  readonly documents?: readonly DocumentRecord[];
  /** Calendar ids whose record and document are removed. */
  readonly remove?: readonly string[];
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface BackendSnapshot {
  readonly calendars: ReadonlyMap<string, CalendarRecord>;
  readonly documents: ReadonlyMap<string, DocumentRecord>;
}

/** The storage the event store reads and writes; IndexedDB, or memory when it is unavailable. */
export interface EventsBackend {
  readonly kind: 'indexeddb' | 'memory';
  /** Every record and document. */
  readAll(): Promise<BackendSnapshot>;
  /** The records and documents of some calendars, read fresh (never a cached copy). */
  read(ids: readonly string[]): Promise<BackendSnapshot>;
  write(change: BackendWrite): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  close(): void;
}

/** Storage is full (`QuotaExceededError`): final, `editor.saveFailed.storage`. */
export class StorageFullError extends Error {
  constructor(message = 'QuotaExceededError') {
    super(message);
    this.name = 'StorageFullError';
  }
}

/** A transaction was aborted for another reason: transient, retried once (§2.11). */
export class TransientStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientStorageError';
  }
}

function isQuota(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/** Maps a DOMException of a failed request or transaction to the store's two error kinds. */
export function storageError(error: unknown): Error {
  if (error instanceof StorageFullError || error instanceof TransientStorageError) return error;
  if (isQuota(error)) return new StorageFullError();
  const name = (error as { name?: unknown } | null)?.name;
  return new TransientStorageError(typeof name === 'string' ? name : 'UnknownError');
}

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(storageError(req.error));
  });

/** Resolves when the transaction commits; rejects with the mapped abort reason. */
const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(storageError(tx.error ?? { name: 'AbortError' }));
    tx.onerror = (event) => {
      // Keep the error for onabort, which always follows an unhandled request error.
      event.preventDefault?.();
      tx.abort();
    };
  });

/**
 * A failure that means the connection itself is gone: `InvalidStateError`
 * (the connection is closing or closed) and WebKit's `UnknownError`
 * ("Connection to Indexed Database server lost", after the page slept).
 */
function connectionLost(error: unknown): boolean {
  const name = (error as { name?: unknown; message?: unknown } | null)?.name;
  const message = (error as { message?: unknown } | null)?.message;
  return name === 'InvalidStateError' || name === 'UnknownError' || message === 'InvalidStateError' || message === 'UnknownError';
}

class IdbBackend implements EventsBackend {
  readonly kind = 'indexeddb' as const;
  private db: IDBDatabase | null = null;
  private reopening: Promise<IDBDatabase> | null = null;
  private closed = false;

  constructor(
    db: IDBDatabase,
    /** Opens the database again after the browser closed this tab's connection. */
    private readonly reopen: () => Promise<IDBDatabase>,
  ) {
    this.attach(db);
  }

  private attach(db: IDBDatabase): void {
    this.db = db;
    // Closed by the browser (WebKit after the page slept, site data cleared): reopened on next use.
    db.onclose = () => this.drop(db);
    // Another tab upgrading later must not wait on this one.
    db.onversionchange = () => {
      db.close();
      this.drop(db);
    };
  }

  /** Forgets a connection that is gone, so the next request (the store's one retry) opens a new one. */
  private drop(db: IDBDatabase): void {
    if (this.db !== db) return;
    this.db = null;
    try {
      db.close();
    } catch {
      // already closed
    }
  }

  private connection(): Promise<IDBDatabase> {
    if (this.db !== null) return Promise.resolve(this.db);
    if (this.closed) return Promise.reject(new TransientStorageError('InvalidStateError'));
    this.reopening ??= this.reopen().then(
      (db) => {
        this.reopening = null;
        if (this.closed) {
          db.close();
          throw new TransientStorageError('InvalidStateError');
        }
        this.attach(db);
        return db;
      },
      (error: unknown) => {
        this.reopening = null;
        throw new TransientStorageError((error as { name?: string } | null)?.name ?? 'UnknownError');
      },
    );
    return this.reopening;
  }

  /**
   * A transaction on the current connection. A connection found closed is
   * opened again at once (nothing was done on it yet); one lost during a
   * transaction is dropped, and the store's one retry runs on a new one.
   */
  private async transaction(stores: string[], mode: IDBTransactionMode): Promise<{ readonly db: IDBDatabase; readonly tx: IDBTransaction }> {
    for (let attempt = 0; ; attempt++) {
      const db = await this.connection();
      try {
        return { db, tx: db.transaction(stores, mode) };
      } catch (error) {
        if (!connectionLost(error) || attempt > 0) throw storageError(error);
        this.drop(db);
      }
    }
  }

  /** Runs a request on a connection; a lost connection is dropped before the error goes up. */
  private async run<T>(db: IDBDatabase, work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (connectionLost(error)) this.drop(db);
      throw error;
    }
  }

  async readAll(): Promise<BackendSnapshot> {
    const { db, tx } = await this.transaction([CALENDARS, DOCUMENTS], 'readonly');
    return this.run(db, this.readAllIn(tx));
  }

  private async readAllIn(tx: IDBTransaction): Promise<BackendSnapshot> {
    const [calendars, documents] = await Promise.all([
      request(tx.objectStore(CALENDARS).getAll() as IDBRequest<CalendarRecord[]>),
      request(tx.objectStore(DOCUMENTS).getAll() as IDBRequest<DocumentRecord[]>),
    ]);
    return { calendars: new Map(calendars.map((c) => [c.id, c])), documents: new Map(documents.map((d) => [d.calendarId, d])) };
  }

  async read(ids: readonly string[]): Promise<BackendSnapshot> {
    const { db, tx } = await this.transaction([CALENDARS, DOCUMENTS], 'readonly');
    return this.run(db, this.readIn(tx, ids));
  }

  private async readIn(tx: IDBTransaction, ids: readonly string[]): Promise<BackendSnapshot> {
    const calendars = new Map<string, CalendarRecord>();
    const documents = new Map<string, DocumentRecord>();
    await Promise.all(
      ids.flatMap((id) => [
        request(tx.objectStore(CALENDARS).get(id) as IDBRequest<CalendarRecord | undefined>).then((c) => void (c && calendars.set(id, c))),
        request(tx.objectStore(DOCUMENTS).get(id) as IDBRequest<DocumentRecord | undefined>).then((d) => void (d && documents.set(id, d))),
      ]),
    );
    return { calendars, documents };
  }

  async write(change: BackendWrite): Promise<void> {
    const { db, tx } = await this.transaction([CALENDARS, DOCUMENTS, META], 'readwrite');
    return this.run(db, this.writeIn(tx, change));
  }

  private async writeIn(tx: IDBTransaction, change: BackendWrite): Promise<void> {
    const finished = done(tx);
    try {
      const calendars = tx.objectStore(CALENDARS);
      const documents = tx.objectStore(DOCUMENTS);
      const meta = tx.objectStore(META);
      for (const id of change.remove ?? []) {
        calendars.delete(id);
        documents.delete(id);
      }
      for (const record of change.calendars ?? []) calendars.put(record);
      for (const document of change.documents ?? []) documents.put(document);
      for (const [key, value] of Object.entries(change.meta ?? {})) {
        if (value === undefined) meta.delete(key);
        else meta.put(value, key);
      }
    } catch (error) {
      // A put can throw synchronously (DataCloneError, a closed database).
      try {
        tx.abort();
      } catch {
        // already finished
      }
      await finished.catch(() => undefined);
      throw storageError(error);
    }
    await finished;
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const { db, tx } = await this.transaction([META], 'readonly');
    return this.run(db, request(tx.objectStore(META).get(key) as IDBRequest<T | undefined>));
  }

  close(): void {
    this.closed = true;
    const db = this.db;
    this.db = null;
    db?.close();
  }
}

/** The in-memory backend of memory mode (and of tests that need no database). */
export class MemoryBackend implements EventsBackend {
  readonly kind = 'memory' as const;
  private readonly calendars = new Map<string, CalendarRecord>();
  private readonly documents = new Map<string, DocumentRecord>();
  private readonly meta = new Map<string, unknown>();
  /** Tests: make the next writes fail. */
  failNext: Error[] = [];

  async readAll(): Promise<BackendSnapshot> {
    return { calendars: new Map(this.calendars), documents: new Map(this.documents) };
  }

  async read(ids: readonly string[]): Promise<BackendSnapshot> {
    const calendars = new Map<string, CalendarRecord>();
    const documents = new Map<string, DocumentRecord>();
    for (const id of ids) {
      const c = this.calendars.get(id);
      const d = this.documents.get(id);
      if (c) calendars.set(id, c);
      if (d) documents.set(id, d);
    }
    return { calendars, documents };
  }

  async write(change: BackendWrite): Promise<void> {
    const failure = this.failNext.shift();
    if (failure !== undefined) throw failure;
    for (const id of change.remove ?? []) {
      this.calendars.delete(id);
      this.documents.delete(id);
    }
    for (const record of change.calendars ?? []) this.calendars.set(record.id, structuredClone(record));
    for (const document of change.documents ?? []) this.documents.set(document.calendarId, { ...document });
    for (const [key, value] of Object.entries(change.meta ?? {})) {
      if (value === undefined) this.meta.delete(key);
      else this.meta.set(key, structuredClone(value));
    }
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.meta.get(key) as T | undefined;
  }

  close(): void {}
}

/** Creates the three object stores of version 1. */
function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(CALENDARS)) db.createObjectStore(CALENDARS, { keyPath: 'id' });
  if (!db.objectStoreNames.contains(DOCUMENTS)) db.createObjectStore(DOCUMENTS, { keyPath: 'calendarId' });
  if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
}

export interface OpenOptions {
  /** Default `globalThis.indexedDB`. */
  readonly indexedDB?: IDBFactory | null;
  /** Give up and use memory after this long (a blocked or hanging open). Default 10 s. */
  readonly timeoutMs?: number;
}

/**
 * Opens `thirteen-events` (creating it at version 1). Resolves with the
 * in-memory backend when IndexedDB is missing, refuses to open, or does not
 * answer in time: the store then runs in memory mode (§2.16).
 */
export async function openEventsBackend(options: OpenOptions = {}): Promise<EventsBackend> {
  const factory = options.indexedDB === undefined ? (globalThis as { indexedDB?: IDBFactory }).indexedDB : options.indexedDB;
  if (factory === undefined || factory === null) return new MemoryBackend();
  const timeoutMs = options.timeoutMs ?? 10_000;
  try {
    const db = await openDatabase(factory, timeoutMs);
    return new IdbBackend(db, () => openDatabase(factory, timeoutMs));
  } catch {
    return new MemoryBackend();
  }
}

/** Opens `thirteen-events` at version 1; rejects when it is refused, fails or does not answer in time. */
function openDatabase(factory: IDBFactory, timeoutMs: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error('IndexedDB open timed out'));
    }, timeoutMs);
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      fn();
    };
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        db.close();
        return;
      }
      finish(() => resolve(db));
    };
    req.onerror = () => finish(() => reject(req.error));
  });
}
