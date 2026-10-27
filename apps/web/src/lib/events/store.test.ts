import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatLocalDateTime, parseLocalDateTime, parseRRule } from '@thirteen/core';
import { EventStoreError, type StoreOccurrence } from '@thirteen/ui/headless';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, type EventsBackend, MemoryBackend, StorageFullError, TransientStorageError, openEventsBackend, storageError } from './db.ts';
import { localIcsEngine } from './icsEngine.ts';
import { PENDING_KEY } from './pending.ts';
import { type LocalEventStore, openLocalEventStore } from './store.ts';
import { type TestBrowser, openTab, settle, testBrowser, timedDraft, zones } from './testSupport.ts';

const ROOT = resolve(__dirname, '../../../../..');
const fixture = (path: string) => readFileSync(resolve(ROOT, 'fixtures/ics', path), 'utf8');

const open: LocalEventStore[] = [];
async function tab(browser: TestBrowser, options: Parameters<typeof openTab>[1] = {}) {
  const store = await openTab(browser, options);
  open.push(store);
  return store;
}
afterEach(() => {
  for (const store of open.splice(0)) store.close();
});

async function year(store: LocalEventStore, y = 2026): Promise<readonly StoreOccurrence[]> {
  await store.loadYear(y);
  const snapshot = store.occurrencesInYear(y);
  if (snapshot.status !== 'ready') throw new Error('not ready');
  return snapshot.occurrences;
}
const titles = async (store: LocalEventStore) => (await year(store)).map((o) => `${formatLocalDateTime(o.start)} ${o.title}`);
const personal = (store: LocalEventStore) => store.getState().calendars.find((c) => c.title === 'Personal')!.id;
const journal = (browser: TestBrowser) => JSON.parse(browser.storage.getItem(PENDING_KEY) ?? '[]') as { tab: string; title: string }[];

describe('the IndexedDB database (db.ts)', () => {
  it('creates thirteen-events version 1 with calendars, documents and meta, and "Personal" on first use only', async () => {
    const browser = testBrowser();
    const store = await tab(browser);
    expect(store.getState().status).toBe('ready');
    expect(store.storageKind).toBe('indexeddb');
    expect(store.getState().calendars.map((c) => [c.title, c.kind, c.isPlatformDefault, c.accountTitle])).toEqual([['Personal', 'local', true, 'In this browser']]);
    const db = await new Promise<IDBDatabase>((done) => {
      const req = browser.indexedDB.open(DB_NAME);
      req.onsuccess = () => done(req.result);
    });
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames].sort()).toEqual(['calendars', 'documents', 'meta']);
    const tx = db.transaction(['calendars', 'documents']);
    expect(tx.objectStore('calendars').keyPath).toBe('id');
    expect(tx.objectStore('documents').keyPath).toBe('calendarId');
    db.close();
    // The document is the calendar's own VCALENDAR (§3.6).
    const text = store.documentText(personal(store))!;
    expect(text).toContain('PRODID:-//Haugas Development OU//Thirteen 1.0//EN\r\n');
    expect(text).toContain('X-WR-CALNAME:Personal\r\n');
    expect(text).toContain(`X-THIRTEEN-CALENDAR-ID:${personal(store)}\r\n`);
    store.close();
    open.pop();
    // Deleting every calendar does not bring "Personal" back on the next load; the next "+" does.
    const again = await tab(browser);
    await again.deleteCalendar(personal(again));
    const third = await tab(browser);
    expect(third.getState().calendars).toEqual([]);
    expect((await third.ensureLocalCalendar()).title).toBe('Personal');
  });

  it('runs in memory when IndexedDB cannot be opened (§2.16)', async () => {
    const refusing = { open: () => { throw new DOMException('The operation is insecure.', 'SecurityError'); } } as unknown as IDBFactory;
    expect((await openEventsBackend({ indexedDB: refusing })).kind).toBe('memory');
    const failing = {
      open() {
        const req = {} as IDBOpenDBRequest & { onerror: (() => void) | null };
        setTimeout(() => req.onerror?.(), 0);
        return req;
      },
    } as unknown as IDBFactory;
    expect((await openEventsBackend({ indexedDB: failing })).kind).toBe('memory');
    expect((await openEventsBackend({ indexedDB: null })).kind).toBe('memory');
    const store = await tab(testBrowser(), { indexedDB: refusing, channel: null });
    expect(store.getState().status).toBe('memory');
    await store.createEvent(timedDraft(personal(store), 'Kept in this tab', '2026-10-20T10:00', '2026-10-20T11:00'));
    expect(await titles(store)).toEqual(['2026-10-20T10:00 Kept in this tab']);
  });

  it('runs in memory when IndexedDB opens but refuses the first write (a zero quota, §2.16), instead of not starting', async () => {
    const empty = async () => ({ calendars: new Map(), documents: new Map() });
    const zeroQuota: EventsBackend = {
      kind: 'indexeddb',
      readAll: empty,
      read: empty,
      write: async () => {
        throw new StorageFullError();
      },
      getMeta: async () => undefined,
      close: () => undefined,
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = await tab(testBrowser(), { backend: zeroQuota });
    expect(store.getState().status).toBe('memory');
    expect(store.storageKind).toBe('memory');
    expect(store.getState().calendars.map((c) => c.title)).toEqual(['Personal']);
    await store.createEvent(timedDraft(personal(store), 'Kept in this tab', '2026-10-20T10:00', '2026-10-20T11:00'));
    expect(await titles(store)).toEqual(['2026-10-20T10:00 Kept in this tab']);
    expect(warn).toHaveBeenCalledWith('[thirteen] store: indexeddb-unusable storage');
    warn.mockRestore();
  });

  it('maps QuotaExceededError to storage and other aborts to transient', () => {
    expect(storageError(new DOMException('full', 'QuotaExceededError'))).toBeInstanceOf(StorageFullError);
    expect(storageError({ name: 'AbortError' })).toBeInstanceOf(TransientStorageError);
  });

  it('opens the database again when the browser closed the connection (WebKit after the page slept)', async () => {
    const browser = testBrowser();
    const store = await tab(browser);
    const id = personal(store);
    // What WebKit leaves behind: a connection whose every new transaction throws InvalidStateError.
    const backend = (store as unknown as { backend: { db: IDBDatabase | null } }).backend;
    const lost = backend.db!;
    lost.close();
    expect(() => lost.transaction(['calendars'], 'readonly')).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    await store.createEvent(timedDraft(id, 'After sleep', '2026-10-20T10:00', '2026-10-20T11:00'));
    expect(backend.db).not.toBe(lost);
    expect(await titles(store)).toEqual(['2026-10-20T10:00 After sleep']);
    // Stored in IndexedDB, not only in this tab.
    const other = await tab(browser);
    expect(await titles(other)).toEqual(['2026-10-20T10:00 After sleep']);
    // Meta reads reopen it too.
    backend.db!.close();
    expect(await store.getMeta('personalCreated')).toBe(true);
    // WebKit's other symptom: "Connection to Indexed Database server lost" (UnknownError).
    const broken = backend.db!;
    broken.transaction = () => {
      throw new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError');
    };
    await store.setMeta('probe', 1);
    expect(backend.db).not.toBe(broken);
    expect(await store.getMeta('probe')).toBe(1);
  });
});

describe('reads and writes', () => {
  it('creates, edits with every span, deletes, and keeps it all after a reload', async () => {
    const browser = testBrowser();
    const store = await tab(browser);
    const id = personal(store);
    const weekly = { rule: { kind: 'rrule' as const, rrule: parseRRule('FREQ=WEEKLY') }, end: { kind: 'count' as const, count: 6 }, extraDates: [], exceptDates: [] };
    const { key } = await store.createEvent(timedDraft(id, 'Choir', '2026-10-05T19:00', '2026-10-05T20:00', { recurrence: weekly }));
    expect(key).toMatch(new RegExp(`^${id}/[0-9a-z-]+\\|2026-10-05T19:00$`));
    expect(await titles(store)).toHaveLength(6);
    const eventId = key!.split('|')[0]!;
    // This event only.
    const third = store.resolveOccurrence(`${eventId}|2026-10-19T19:00`)!;
    await store.save({ key: `${eventId}|2026-10-19T19:00`, original: third.draft, draft: { ...third.draft, title: 'Concert' }, span: 'this' });
    // All events, from the first occurrence: a new location.
    const first = store.resolveOccurrence(key!)!;
    expect(first.isFirst).toBe(true);
    await store.save({ key: key!, original: first.draft, draft: { ...first.draft, location: 'Kaarli kirik' }, span: 'all' });
    // Future events from the fifth: a new title, a new UID for the tail.
    const fifth = store.resolveOccurrence(`${eventId}|2026-11-02T19:00`)!;
    const split = await store.save({ key: `${eventId}|2026-11-02T19:00`, original: fifth.draft, draft: { ...fifth.draft, title: 'Choir (new hall)' }, span: 'future' });
    expect(split.eventId).not.toBe(eventId);
    // Delete this event only.
    await store.delete({ key: `${eventId}|2026-10-12T19:00`, span: 'this' });
    const expected = ['2026-10-05T19:00 Choir', '2026-10-19T19:00 Concert', '2026-10-26T19:00 Choir', '2026-11-02T19:00 Choir (new hall)', '2026-11-09T19:00 Choir (new hall)'];
    expect(await titles(store)).toEqual(expected);
    expect((await year(store)).find((o) => o.title === 'Choir')!.location).toBe('Kaarli kirik');
    // A reload reads the same from IndexedDB.
    const reloaded = await tab(browser);
    expect(await titles(reloaded)).toEqual(expected);
  });

  it('refuses invalid drafts, read-only calendars and occurrences that no longer resolve', async () => {
    const store = await tab(testBrowser());
    const id = personal(store);
    await expect(store.createEvent(timedDraft(id, 'Backwards', '2026-10-20T10:00', '2026-10-20T09:00'))).rejects.toMatchObject({ code: 'invalid', issues: ['end-before-start'] });
    await expect(store.delete({ key: `${id}/nothing|2026-10-20T10:00`, span: 'all' })).rejects.toMatchObject({ code: 'occurrence-gone' });
    const subscription = store.createId();
    await store.transact([subscription], (tx) => {
      tx.putRecord({ id: subscription, kind: 'subscription', name: 'Holidays', color: '#57534e', order: 5, visible: true, createdAt: '2026-10-19T06:41:00.000Z', subscription: null });
      tx.setText(subscription, fixture('cases/google-holidays.ics'));
    });
    const holiday = (await year(store)).find((o) => o.calendarId === subscription)!;
    expect(holiday.readOnly).toBe('subscribed');
    await expect(store.delete({ key: holiday.key, span: 'all' })).rejects.toMatchObject({ code: 'read-only' });
    await expect(store.createEvent(timedDraft(subscription, 'No', '2026-10-20T10:00', '2026-10-20T11:00'))).rejects.toBeInstanceOf(EventStoreError);
  });

  it('keeps an untouched imported group byte for byte (outlook-edit-one)', async () => {
    const store = await tab(testBrowser(), { now: () => new Date('2026-10-19T06:41:00Z') });
    const id = 'outlook-publish';
    await store.transact([id], (tx) => {
      tx.putRecord({ id, kind: 'local', name: 'Outlook', color: '#2563eb', order: 1, visible: true, createdAt: '2026-10-19T06:41:00.000Z', subscription: null });
      tx.setText(id, fixture('cases/outlook-publish.ics'));
    });
    const key = `${id}/040000008200E00074C5B7101A82E00800000000F5FEF2D3411C6F9EE58779471EC2C3AD38A95A4F6C94689D82BAB67E|2026-11-18T14:00`;
    const resolved = store.resolveOccurrence(key)!;
    await store.save({ key, original: resolved.draft, draft: { ...resolved.draft, title: 'Budget review with Marta' }, span: 'all' });
    expect(store.documentText(id)).toBe(fixture('edits/outlook-edit-one.ics'));
  });

  it('maps a full disk to the storage error and retries an aborted transaction once', async () => {
    const backend = new MemoryBackend();
    const store = await openLocalEventStore({ backend, channel: null, storage: null, zones, deviceZone: 'Europe/Tallinn', document: null, watchZone: false, engine: localIcsEngine(zones) });
    open.push(store);
    const id = personal(store);
    backend.failNext = [new StorageFullError()];
    await expect(store.createEvent(timedDraft(id, 'Too much', '2026-10-20T10:00', '2026-10-20T11:00'))).rejects.toMatchObject({ code: 'storage' });
    backend.failNext = [new TransientStorageError('AbortError')];
    await store.createEvent(timedDraft(id, 'Second try', '2026-10-20T10:00', '2026-10-20T11:00'));
    backend.failNext = [new TransientStorageError('AbortError'), new TransientStorageError('AbortError')];
    await expect(store.createEvent(timedDraft(id, 'Twice', '2026-10-20T12:00', '2026-10-20T13:00'))).rejects.toMatchObject({ code: 'generic' });
    expect(await titles(store)).toEqual(['2026-10-20T10:00 Second try']);
  });

  it('historical events: delete and alerts only (§3.5)', async () => {
    const store = await tab(testBrowser());
    const id = 'old';
    const text = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN',
      'BEGIN:VEVENT', 'UID:armada', 'DTSTAMP:20261019T064100Z', 'DTSTART;VALUE=DATE:15000101', 'RRULE:FREQ=YEARLY', 'SUMMARY:Old anniversary', 'END:VEVENT',
      'END:VCALENDAR', '',
    ].join('\r\n');
    await store.transact([id], (tx) => {
      tx.putRecord({ id, kind: 'local', name: 'Old', color: '#92400e', order: 1, visible: true, createdAt: '2026-10-19T06:41:00.000Z', subscription: null });
      tx.setText(id, text);
    });
    const occurrence = (await year(store)).find((o) => o.calendarId === id)!;
    expect(occurrence.readOnly).toBe('historical');
    const resolved = store.resolveOccurrence(occurrence.key)!;
    await expect(store.save({ key: occurrence.key, original: resolved.draft, draft: { ...resolved.draft, title: 'New' }, span: 'all' })).rejects.toMatchObject({ code: 'read-only' });
    await store.setAlarms(occurrence.key, [{ kind: 'relative', offsetMinutes: 540 }]);
    expect(store.documentText(id)).toContain('TRIGGER:PT9H\r\n');
    await store.delete({ key: occurrence.key, span: 'this' });
    expect(occurrence.key).toBe('old/armada|2026-01-01');
    expect(store.documentText(id)).toContain('EXDATE;VALUE=DATE:20260101\r\n');
  });
});

describe('two tabs (§3.6)', () => {
  it('sync through BroadcastChannel', async () => {
    const browser = testBrowser();
    const a = await tab(browser);
    const b = await tab(browser);
    expect(b.getState().calendars.map((c) => c.title)).toEqual(['Personal']);
    await a.createEvent(timedDraft(personal(a), 'From tab A', '2026-10-20T10:00', '2026-10-20T11:00'));
    await settle();
    expect(await titles(b)).toEqual(['2026-10-20T10:00 From tab A']);
    const created = await b.createCalendar({ title: 'Work' });
    await settle();
    expect(a.getState().calendars.map((c) => c.title)).toEqual(['Personal', 'Work']);
    expect(created.color).toBe('#dc2626');
  });

  it('write one after the other in the lock: concurrent creates and edits of different events all survive', async () => {
    const browser = testBrowser();
    const a = await tab(browser);
    const b = await tab(browser);
    const id = personal(a);
    // Lock contention: both start at once.
    await Promise.all([
      a.createEvent(timedDraft(id, 'A1', '2026-10-20T10:00', '2026-10-20T11:00')),
      b.createEvent(timedDraft(id, 'B1', '2026-10-20T12:00', '2026-10-20T13:00')),
      a.createEvent(timedDraft(id, 'A2', '2026-10-21T10:00', '2026-10-21T11:00')),
      b.createEvent(timedDraft(id, 'B2', '2026-10-21T12:00', '2026-10-21T13:00')),
    ]);
    await settle();
    const all = ['2026-10-20T10:00 A1', '2026-10-20T12:00 B1', '2026-10-21T10:00 A2', '2026-10-21T12:00 B2'];
    expect(await titles(a)).toEqual(all);
    expect(await titles(b)).toEqual(all);
    // Each tab edits a different event from its own (stale) copy; both edits survive.
    const [a1, b1] = (await year(a)).filter((o) => o.title === 'A1' || o.title === 'B1');
    const ra = a.resolveOccurrence(a1!.key)!;
    const rb = b.resolveOccurrence(b1!.key)!;
    await Promise.all([
      a.save({ key: a1!.key, original: ra.draft, draft: { ...ra.draft, title: 'A1 edited' }, span: 'all' }),
      b.save({ key: b1!.key, original: rb.draft, draft: { ...rb.draft, title: 'B1 edited' }, span: 'all' }),
    ]);
    await settle();
    expect(await titles(a)).toEqual(['2026-10-20T10:00 A1 edited', '2026-10-20T12:00 B1 edited', '2026-10-21T10:00 A2', '2026-10-21T12:00 B2']);
  });

  it('merge field groups: a field changed elsewhere is kept, a conflict only for the same field', async () => {
    const browser = testBrowser();
    const a = await tab(browser);
    const b = await tab(browser);
    const { key } = await a.createEvent(timedDraft(personal(a), 'Lunch', '2026-10-20T12:00', '2026-10-20T13:00'));
    await settle();
    // Both editors open the same event.
    const openedA = a.resolveOccurrence(key!)!.draft;
    const openedB = b.resolveOccurrence(key!)!.draft;
    await a.save({ key: key!, original: openedA, draft: { ...openedA, location: 'Rataskaevu 3' }, span: 'all' });
    const result = await b.save({ key: key!, original: openedB, draft: { ...openedB, title: 'Lunch with Jaan' }, span: 'all' });
    expect(result.conflicts).toBeUndefined();
    await settle();
    const event = a.resolveOccurrence(key!)!.event;
    expect([event.title, event.location]).toEqual(['Lunch with Jaan', 'Rataskaevu 3']);
    // The same field on both sides: the later save wins and reports the conflict.
    const openedC = a.resolveOccurrence(key!)!.draft;
    const openedD = b.resolveOccurrence(key!)!.draft;
    await a.save({ key: key!, original: openedC, draft: { ...openedC, title: 'Lunch at noon' }, span: 'all' });
    const conflict = await b.save({ key: key!, original: openedD, draft: { ...openedD, title: 'Lunch, moved' }, span: 'all' });
    expect(conflict.conflicts).toEqual(['title']);
    expect(b.resolveOccurrence(key!)!.event.title).toBe('Lunch, moved');
  });
});

describe('pending moves and deletes (§2.11)', () => {
  async function withEvent(browser = testBrowser()) {
    const store = await tab(browser);
    const { key } = await store.createEvent(timedDraft(personal(store), 'Dentist', '2026-10-20T15:40', '2026-10-20T16:20'));
    return { browser, store, key: key! };
  }

  it('shows a held delete at once, journals it with the tab id, and forgets it on Undo', async () => {
    const { browser, store, key } = await withEvent();
    const pending = store.hold({ kind: 'delete', key, span: 'all' });
    expect(await titles(store)).toEqual([]);
    expect(journal(browser)).toMatchObject([{ tab: store.tabId, title: 'Dentist' }]);
    pending.discard();
    expect(pending.held).toBe(false);
    expect(await titles(store)).toEqual(['2026-10-20T15:40 Dentist']);
    expect(journal(browser)).toEqual([]);
  });

  it('writes a held move on commit and removes its journal entry', async () => {
    const { browser, store, key } = await withEvent();
    const opened = store.resolveOccurrence(key)!.draft;
    const moved = { ...opened, start: parseLocalDateTime('2026-10-21T09:00'), end: parseLocalDateTime('2026-10-21T09:40') };
    const pending = store.hold({ kind: 'save', key, original: opened, draft: moved, span: 'all' });
    expect(await titles(store)).toEqual(['2026-10-21T09:00 Dentist']);
    const result = await pending.commit();
    expect(result.key).toMatch(/\|2026-10-21T09:00$/);
    expect(journal(browser)).toEqual([]);
    const other = await tab(browser);
    expect(await titles(other)).toEqual(['2026-10-21T09:00 Dentist']);
  });

  it('reverts and reports a commit that fails: the event changed in another tab', async () => {
    const { browser, store, key } = await withEvent();
    const other = await tab(browser);
    const opened = store.resolveOccurrence(key)!.draft;
    const pending = store.hold({ kind: 'save', key, original: opened, draft: { ...opened, start: parseLocalDateTime('2026-10-21T09:00'), end: parseLocalDateTime('2026-10-21T09:40') }, span: 'all' });
    const failures: string[] = [];
    store.onCommitFailure((f) => failures.push(f.cause));
    // The other tab deletes it; this tab hears of it and writes the held change at once (written early), which fails.
    await other.delete({ key, span: 'all' });
    await settle(10);
    expect(pending.held).toBe(false);
    expect(failures).toEqual(['changed']);
    expect(await titles(store)).toEqual([]);
    expect(journal(browser)).toEqual([]);
    await expect(pending.commit()).rejects.toMatchObject({ code: 'not-found' });
  });

  it('a held change is written first when another write to the same document starts', async () => {
    const { store, key } = await withEvent();
    const pending = store.hold({ kind: 'delete', key, span: 'all' });
    await store.createEvent(timedDraft(personal(store), 'Optician', '2026-10-22T10:00', '2026-10-22T10:30'));
    expect(pending.held).toBe(false);
    expect(store.documentText(personal(store))).not.toContain('SUMMARY:Dentist');
  });

  it('replays the journal entry of a closed tab on the next load; an entry already written is removed without a failure', async () => {
    const { browser, store, key } = await withEvent();
    store.hold({ kind: 'delete', key, span: 'all' });
    store.close();
    open.splice(open.indexOf(store), 1);
    expect(journal(browser)).toHaveLength(1);
    const next = await tab(browser);
    expect(await titles(next)).toEqual([]);
    expect(journal(browser)).toEqual([]);
    expect(next.failedCommits()).toEqual([]);
    // A delete whose write had completed before the tab closed: removed silently.
    const again = await withEvent(browser);
    const entry = again.store.hold({ kind: 'delete', key: again.key, span: 'all' });
    await entry.commit();
    browser.storage.setItem(PENDING_KEY, JSON.stringify([{ id: 'x', tab: 'gone-tab', request: { kind: 'delete', key: again.key, span: 'all' }, title: 'Dentist', target: { date: '2026-10-20', minute: 940 }, createdAt: '2026-10-19T06:41:00.000Z' }]));
    const third = await tab(browser);
    expect(journal(browser)).toEqual([]);
    expect(third.failedCommits()).toEqual([]);
  });

  it('reports a replayed move by name when the event changed meanwhile; two failures are both recorded', async () => {
    const browser = testBrowser();
    const a = await tab(browser);
    const one = (await a.createEvent(timedDraft(personal(a), 'Dentist', '2026-10-20T15:40', '2026-10-20T16:20'))).key!;
    const two = (await a.createEvent(timedDraft(personal(a), 'Haircut', '2026-10-20T17:00', '2026-10-20T18:00'))).key!;
    const b = await tab(browser);
    const dentist = a.resolveOccurrence(one)!.draft;
    const haircut = a.resolveOccurrence(two)!.draft;
    a.hold({ kind: 'save', key: one, original: dentist, draft: { ...dentist, start: parseLocalDateTime('2026-10-21T09:00'), end: parseLocalDateTime('2026-10-21T09:40') }, span: 'all' });
    a.hold({ kind: 'save', key: two, original: haircut, draft: { ...haircut, start: parseLocalDateTime('2026-10-21T17:00'), end: parseLocalDateTime('2026-10-21T18:00') }, span: 'all' });
    // Tab A closes without writing (its transaction never ran); meanwhile tab B changed both events itself.
    a.close();
    open.splice(open.indexOf(a), 1);
    const bd = b.resolveOccurrence(one)!.draft;
    await b.save({ key: one, original: bd, draft: { ...bd, start: parseLocalDateTime('2026-10-20T14:00'), end: parseLocalDateTime('2026-10-20T14:40') }, span: 'all' });
    await b.delete({ key: two, span: 'all' });
    await b.replayJournal();
    const failures = b.failedCommits();
    expect(failures.map((f) => [f.kind, f.title, f.cause, f.target])).toEqual([
      ['move', 'Dentist', 'changed', { date: '2026-10-21', minute: 540 }],
      ['move', 'Haircut', 'changed', { date: '2026-10-21', minute: 1020 }],
    ]);
    b.clearFailedCommits([failures[0]!.id]);
    expect(b.failedCommits()).toHaveLength(1);
  });

  it('two tabs: a second tab leaves the first tab’s entry alone; Undo still works; the entry is replayed only after the first tab closes', async () => {
    const { browser, store: first, key } = await withEvent();
    const pending = first.hold({ kind: 'delete', key, span: 'all' });
    const second = await tab(browser);
    expect(journal(browser)).toHaveLength(1);
    expect(await titles(second)).toEqual(['2026-10-20T15:40 Dentist']);
    pending.discard();
    expect(journal(browser)).toEqual([]);
    // Held again, then the first tab closes: the second tab replays it when it becomes visible.
    first.hold({ kind: 'delete', key, span: 'all' });
    await second.replayJournal();
    expect(journal(browser)).toHaveLength(1);
    first.close();
    open.splice(open.indexOf(first), 1);
    await settle(); // the tab lock is released asynchronously, as in a browser
    await second.replayJournal();
    expect(journal(browser)).toEqual([]);
    expect(await titles(second)).toEqual([]);
  });
});

describe('snapshots and unreadable documents', () => {
  it('keeps showing the previous snapshot while a changed calendar is expanded again (no flash of loading)', async () => {
    const store = await tab(testBrowser());
    await year(store);
    const statuses: string[] = [];
    store.subscribe(() => statuses.push(store.occurrencesInYear(2026).status));
    await store.createEvent(timedDraft(personal(store), 'New', '2026-10-20T10:00', '2026-10-20T11:00'));
    expect(store.occurrencesInYear(2026).status).toBe('ready');
    await settle();
    expect(statuses).not.toContain('loading');
    expect(await titles(store)).toEqual(['2026-10-20T10:00 New']);
  });

  it('shows a document that is not iCalendar as unreadable: read-only, its text downloadable, deletable', async () => {
    const store = await tab(testBrowser());
    const id = 'broken';
    await store.transact([id], (tx) => {
      tx.putRecord({ id, kind: 'local', name: 'Broken', color: '#57534e', order: 3, visible: true, createdAt: '2026-10-19T06:41:00.000Z', subscription: null });
      tx.setText(id, 'This is not a calendar');
    });
    expect(await titles(store)).toEqual([]);
    const calendar = store.getState().calendars.find((c) => c.id === id)!;
    expect(calendar).toMatchObject({ unreadable: true, writable: false, isPlatformDefault: false });
    expect(store.documentText(id)).toBe('This is not a calendar');
    await expect(store.createEvent(timedDraft(id, 'No', '2026-10-20T10:00', '2026-10-20T11:00'))).rejects.toMatchObject({ code: 'read-only' });
    await store.deleteCalendar(id);
    expect(store.getState().calendars.map((c) => c.title)).toEqual(['Personal']);
  });

  it('expands in the page when the worker fails on a document', async () => {
    const page = localIcsEngine(zones);
    const failing = { ...page, kind: 'worker' as const, expandYear: () => Promise.reject(new Error('WorkerError')) };
    const store = await tab(testBrowser(), { engine: failing });
    await store.createEvent(timedDraft(personal(store), 'Still shown', '2026-10-20T10:00', '2026-10-20T11:00'));
    expect(await titles(store)).toEqual(['2026-10-20T10:00 Still shown']);
  });

  it('memory mode keeps its pending changes out of the shared journal', async () => {
    const browser = testBrowser();
    const refusing = { open: () => { throw new DOMException('no', 'SecurityError'); } } as unknown as IDBFactory;
    const store = await tab(browser, { indexedDB: refusing, channel: null });
    const { key } = await store.createEvent(timedDraft(personal(store), 'Memo', '2026-10-20T10:00', '2026-10-20T11:00'));
    store.hold({ kind: 'delete', key: key!, span: 'all' });
    expect(journal(browser)).toEqual([]);
    expect(await titles(store)).toEqual([]);
  });
});

describe('exact undo of written changes', () => {
  it('writes a snapshot of the group back byte for byte, and removes a created group', async () => {
    const store = await tab(testBrowser());
    const id = 'outlook-publish';
    await store.transact([id], (tx) => {
      tx.putRecord({ id, kind: 'local', name: 'Outlook', color: '#2563eb', order: 1, visible: true, createdAt: '2026-10-19T06:41:00.000Z', subscription: null });
      tx.setText(id, fixture('cases/outlook-publish.ics'));
    });
    const original = store.documentText(id);
    const eventId = `${id}/040000008200E00074C5B7101A82E00800000000F5FEF2D3411C6F9EE58779471EC2C3AD38A95A4F6C94689D82BAB67E`;
    const before = store.groupSnapshot(eventId)!;
    await store.delete({ key: `${eventId}|2026-11-18T14:00`, span: 'all' });
    expect(store.documentText(id)).not.toContain('Budget review');
    await store.restoreGroup(before);
    expect(store.documentText(id)).toBe(original);
    const { eventId: created } = await store.createEvent(timedDraft(personal(store), 'Oops', '2026-10-20T10:00', '2026-10-20T11:00'));
    const [calendarId, uid] = created!.split('/') as [string, string];
    await store.restoreGroup({ calendarId, uid, group: null });
    expect(await titles(store)).not.toContain('2026-10-20T10:00 Oops');
  });
});

describe('held changes and alerts', () => {
  it('writes held changes a minute before an alert of the event', async () => {
    let clock = Date.parse('2026-10-20T12:30:00Z');
    const store = await tab(testBrowser(), { now: () => new Date(clock) });
    // 15:40 Tallinn is 12:40 UTC; an alert 5 minutes before fires 12:35 UTC, so the change is written at 12:34.
    const { key } = await store.createEvent(timedDraft(personal(store), 'Dentist', '2026-10-20T15:40', '2026-10-20T16:20', { alarms: [{ kind: 'relative', offsetMinutes: -5 }] }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = store.hold({ kind: 'delete', key: key!, span: 'all' });
      vi.advanceTimersByTime(3 * 60_000);
      expect(pending.held).toBe(true);
      clock += 4 * 60_000;
      vi.advanceTimersByTime(60_000 + 1);
      expect(pending.held).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    await settle();
    expect(store.documentText(personal(store))).not.toContain('SUMMARY:Dentist');
  });
});

describe('a first occurrence that was changed on its own, edited for the whole series (§4.7)', () => {
  const weekly = (count: number) => ({ rule: { kind: 'rrule' as const, rrule: parseRRule('FREQ=WEEKLY') }, end: { kind: 'count' as const, count }, extraDates: [], exceptDates: [] });
  async function choir() {
    const store = await tab(testBrowser());
    const id = personal(store);
    const { key } = await store.createEvent(timedDraft(id, 'Choir', '2026-10-05T19:00', '2026-10-05T20:00', { recurrence: weekly(3) }));
    const first = store.resolveOccurrence(key!)!;
    await store.save({ key: key!, original: first.draft, draft: { ...first.draft, start: parseLocalDateTime('2026-10-05T19:30'), end: parseLocalDateTime('2026-10-05T20:30') }, span: 'this' });
    return { store, key: key! };
  }

  it('a new date moves the series with it; the time shown becomes the series time (applyToSeries)', async () => {
    const { store, key } = await choir();
    const again = store.resolveOccurrence(key)!;
    const result = await store.save({
      key,
      original: again.draft,
      draft: { ...again.draft, start: parseLocalDateTime('2026-10-06T19:30'), end: parseLocalDateTime('2026-10-06T20:30') },
      span: 'future',
    });
    expect((await titles(store)).filter((t) => t.includes('Choir'))).toEqual(['2026-10-06T19:30 Choir', '2026-10-13T19:30 Choir', '2026-10-20T19:30 Choir']);
    expect(store.resolveOccurrence(result.key!)?.occurrence.start).toEqual(parseLocalDateTime('2026-10-06T19:30'));
  });

  it('Repeat Never keeps the opened occurrence as the single event', async () => {
    const { store, key } = await choir();
    const again = store.resolveOccurrence(key)!;
    await store.save({ key, original: again.draft, draft: { ...again.draft, recurrence: null }, span: 'future' });
    expect((await titles(store)).filter((t) => t.includes('Choir'))).toEqual(['2026-10-05T19:30 Choir']);
    expect(store.documentText(personal(store))).not.toContain('RECURRENCE-ID');
  });
});

describe('"Save for future events" that leaves the head with no occurrence (§4.7; web review issue 10)', () => {
  it('after the first occurrence was deleted alone, a "future events" change from the second keeps only the tail', async () => {
    const store = await tab(testBrowser());
    const id = personal(store);
    const recurrence = { rule: { kind: 'rrule' as const, rrule: parseRRule('FREQ=WEEKLY') }, end: { kind: 'count' as const, count: 3 }, extraDates: [], exceptDates: [] };
    const { key } = await store.createEvent(timedDraft(id, 'Yoga', '2026-10-05T08:00', '2026-10-05T09:00', { recurrence }));
    await store.delete({ key: key!, span: 'this' });
    const secondKey = `${key!.split('|')[0]}|2026-10-12T08:00`;
    const second = store.resolveOccurrence(secondKey)!;
    expect(second.isFirst).toBe(false);
    await store.save({ key: secondKey, original: second.draft, draft: { ...second.draft, title: 'Yoga flow' }, span: 'future' });
    expect((await titles(store)).filter((t) => t.includes('Yoga'))).toEqual(['2026-10-12T08:00 Yoga flow', '2026-10-19T08:00 Yoga flow']);
    // The head's only date was excluded: its VEVENT goes, not a series that shows nothing.
    const text = store.documentText(id)!;
    expect(text.split('BEGIN:VEVENT').length - 1).toBe(1);
    expect(text).not.toContain('SUMMARY:Yoga\r\n');
    expect(text).not.toContain('EXDATE');
  });
});
