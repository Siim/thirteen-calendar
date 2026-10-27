import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatLocalDateTime } from '@thirteen/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '../../../../../packages/ui/src/events/copy.ts';
import { MemoryBackend, StorageFullError } from './db.ts';
import { localIcsEngine } from './icsEngine.ts';
import { localLocks } from './locks.ts';
import type { LocalEventStore } from './store.ts';
import {
  type FeedFetch,
  SubscriptionManager,
  addSubscription,
  checkFeed,
  decideRefresh,
  defaultInterval,
  fetchFeed,
  isStale,
  normalizeFeedUrl,
} from './subscriptions.ts';
import { type TestBrowser, openTab, settle, testBrowser, zones } from './testSupport.ts';

const ROOT = resolve(__dirname, '../../../../..');
const fixture = (path: string) => readFileSync(resolve(ROOT, 'fixtures/ics', path), 'utf8');
const engine = localIcsEngine(zones);

const open: LocalEventStore[] = [];
afterEach(() => {
  for (const store of open.splice(0)) store.close();
  vi.useRealTimers();
});
async function tab(browser: TestBrowser) {
  const store = await openTab(browser, { personal: null });
  open.push(store);
  return store;
}

/** A feed with `n` events, a new DTSTAMP each time, and `broken` VEVENTs without DTSTART. */
function feed(n: number, stamp: string, broken = 0, name = 'Holidays in Estonia'): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Feed//EN', `X-WR-CALNAME:${name}`, 'X-PUBLISHED-TTL:P1D'];
  for (let i = 0; i < n; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    lines.push('BEGIN:VEVENT', `UID:h${i}@feed`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:202611${day}`, `SUMMARY:Holiday ${i}`, 'END:VEVENT');
  }
  for (let i = 0; i < broken; i++) lines.push('BEGIN:VEVENT', `UID:b${i}@feed`, `DTSTAMP:${stamp}`, 'SUMMARY:No start', 'END:VEVENT');
  lines.push('END:VCALENDAR', '');
  return lines.join('\r\n');
}

type Handler = (url: string, init: RequestInit) => Promise<Response> | Response;
function mockFetch(handler: Handler) {
  return vi.fn((url: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(url), init ?? {})));
}

let clock = Date.parse('2026-10-19T06:41:00Z');
const now = () => new Date((clock += 1000));

async function subscribed(store: LocalEventStore, body: string, url = 'https://feeds.example/holidays.ics') {
  const check = await checkFeed(url, engine, { fetch: mockFetch(() => new Response(body)), now });
  if (!check.ok) throw new Error(check.error);
  const id = await addSubscription(store, check, { name: check.name, color: '#57534e', interval: check.interval });
  return { id, check };
}

describe('links and errors (§2.17)', () => {
  it('normalizes webcal links and refuses http on the web', () => {
    expect(normalizeFeedUrl(' webcal://p01-calendars.icloud.com/published/2/abc ')).toEqual({ ok: true, url: 'https://p01-calendars.icloud.com/published/2/abc' });
    expect(normalizeFeedUrl('webcals://example.com/a.ics')).toEqual({ ok: true, url: 'https://example.com/a.ics' });
    expect(normalizeFeedUrl('https://example.com/a.ics')).toEqual({ ok: true, url: 'https://example.com/a.ics' });
    expect(normalizeFeedUrl('http://example.com/a.ics')).toEqual({ ok: false, error: 'subscribe.error.httpOnWeb' });
    expect(normalizeFeedUrl('example.com/a.ics')).toEqual({ ok: false, error: 'subscribe.error.invalid' });
    expect(normalizeFeedUrl('ftp://example.com/a.ics')).toEqual({ ok: false, error: 'subscribe.error.invalid' });
  });

  it('fetches with exactly the §6.5 options and no headers', async () => {
    const fetch = mockFetch(() => new Response(feed(2, '20261019T064100Z')));
    const result = await fetchFeed('https://feeds.example/a.ics', { fetch, now });
    expect(result.ok).toBe(true);
    const [, init] = fetch.mock.calls[0]!;
    expect(Object.keys(init!).sort()).toEqual(['cache', 'credentials', 'mode', 'redirect', 'referrerPolicy', 'signal']);
    expect(init).toMatchObject({ mode: 'cors', credentials: 'omit', cache: 'no-cache', referrerPolicy: 'no-referrer', redirect: 'follow' });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect('headers' in init!).toBe(false);
  });

  it('maps a CORS refusal (TypeError) to cors on known hosts, webGeneric elsewhere, and offline to no row error', async () => {
    const refuse = mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    for (const url of ['https://calendar.google.com/calendar/ical/x/basic.ics', 'https://p01-calendars.icloud.com/x', 'https://outlook.office365.com/owa/x.ics', 'https://outlook.live.com/x.ics']) {
      expect(await fetchFeed(url, { fetch: refuse, now })).toMatchObject({ ok: false, error: 'subscribe.error.cors', offline: false });
    }
    expect(await fetchFeed('https://feeds.example/a.ics', { fetch: refuse, now })).toMatchObject({ ok: false, error: 'subscribe.error.webGeneric' });
    expect(await fetchFeed('https://feeds.example/a.ics', { fetch: refuse, now, online: () => false })).toMatchObject({ ok: false, offline: true });
    // Every id is a §2.19 string of the copy catalogue.
    expect(COPY['subscribe.error.cors']).toBe('This calendar’s server doesn’t let web pages read it. Download the .ics file and import it, or subscribe in Thirteen for Windows.');
  });

  it('maps statuses, non-calendars and oversize streams', async () => {
    const status = (code: number) => mockFetch(() => new Response('', { status: code }));
    expect(await fetchFeed('https://f.example/a', { fetch: status(401), now })).toMatchObject({ error: 'subscribe.error.denied' });
    expect(await fetchFeed('https://f.example/a', { fetch: status(403), now })).toMatchObject({ error: 'subscribe.error.denied' });
    expect(await fetchFeed('https://f.example/a', { fetch: status(404), now })).toMatchObject({ error: 'subscribe.error.notFound' });
    expect(await fetchFeed('https://f.example/a', { fetch: status(410), now })).toMatchObject({ error: 'subscribe.error.notFound' });
    expect(await fetchFeed('https://f.example/a', { fetch: status(500), now })).toMatchObject({ error: 'subscribe.error.webGeneric' });
    expect(await fetchFeed('https://f.example/a', { fetch: mockFetch(() => new Response('<html>Sign in</html>')), now })).toMatchObject({ error: 'subscribe.error.notCalendar' });
    // A stream that never ends is cut at the cap (no Content-Length).
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\n'.padEnd(1024, 'X')));
      },
    });
    expect(await fetchFeed('https://f.example/a', { fetch: mockFetch(() => new Response(endless)), now, maxBytes: 64 * 1024 })).toMatchObject({ error: 'subscribe.error.tooLarge' });
    expect(pulled).toBeLessThan(80);
    const declared = new Response('BEGIN:VCALENDAR', { headers: { 'content-length': String(26 * 1024 * 1024) } });
    expect(await fetchFeed('https://f.example/a', { fetch: mockFetch(() => declared), now })).toMatchObject({ error: 'subscribe.error.tooLarge' });
  });

  it('follows redirects (the browser does) and reads the final body', async () => {
    const fetch = mockFetch((url, init) => {
      expect(init.redirect).toBe('follow');
      const response = new Response(feed(3, '20261019T064100Z'));
      Object.defineProperty(response, 'redirected', { value: true });
      Object.defineProperty(response, 'url', { value: `${url}?moved` });
      return response;
    });
    const check = await checkFeed('webcal://feeds.example/old.ics', engine, { fetch, now });
    expect(check).toMatchObject({ ok: true, url: 'https://feeds.example/old.ics', name: 'Holidays in Estonia', interval: 'P1D', events: 3 });
  });

  it('defaults Update from REFRESH-INTERVAL or X-PUBLISHED-TTL, rounded to the nearest option', () => {
    expect(defaultInterval(null)).toBe('PT6H');
    expect(defaultInterval('PT1H')).toBe('PT1H');
    expect(defaultInterval('PT2H')).toBe('PT1H');
    expect(defaultInterval('PT12H')).toBe('PT6H');
    expect(defaultInterval('P1D')).toBe('P1D');
    expect(defaultInterval('P1W')).toBe('P7D');
    expect(defaultInterval('nonsense')).toBe('PT6H');
  });
});

describe('refreshing (§3.6, §2.16)', () => {
  it('stores a changed body, moving the old copy to previousIcs; an unchanged body (same hash) is not stored', async () => {
    const store = await tab(testBrowser());
    const first = feed(12, '20261019T064100Z');
    const { id } = await subscribed(store, first);
    expect(store.documentText(id)).toBe(first);
    const second = feed(13, '20261019T074100Z');
    let body = second;
    const fetch = mockFetch(() => new Response(body));
    const manager = new SubscriptionManager(store, { engine, fetch, now, locks: localLocks(), document: null, window: null });
    expect(await manager.refresh(id)).toBe('stored');
    expect(store.documentText(id)).toBe(second);
    expect(store.record(id)!.subscription!.lastError).toBeNull();
    const db = await store.transact([id], (tx) => tx.previousText(id));
    expect(db).toBe(first);
    const before = store.record(id)!.subscription!;
    expect(await manager.refresh(id)).toBe('unchanged');
    expect(store.documentText(id)).toBe(second);
    expect(store.record(id)!.subscription!.contentHash).toBe(before.contentHash);
    expect(Date.parse(store.record(id)!.subscription!.lastSuccessAt!)).toBeGreaterThan(Date.parse(before.lastSuccessAt!));
    body = second;
  });

  it('does not parse an unchanged body again (§3.6 contentHash); a changed one is parsed once', async () => {
    const store = await tab(testBrowser());
    const first = feed(12, '20261019T064100Z');
    const { id } = await subscribed(store, first);
    let body = first;
    const summarize = vi.fn((text: string, calendarId: string) => engine.summarize(text, calendarId));
    const counting = { ...engine, summarize };
    const fetch = mockFetch(() => new Response(body));
    const manager = new SubscriptionManager(store, { engine: counting, fetch, now, locks: localLocks(), document: null, window: null });
    expect(await manager.refresh(id)).toBe('unchanged');
    expect(summarize).not.toHaveBeenCalled();
    expect(store.record(id)!.subscription).toMatchObject({ lastError: null, suspect: null });
    body = feed(13, '20261019T074100Z');
    expect(await manager.refresh(id)).toBe('stored');
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(store.documentText(id)).toBe(body);
  });

  it('keeps the stored copy when the write fails, and never rejects (storage full)', async () => {
    const backend = new MemoryBackend();
    const store = await openTab(testBrowser(), { backend, personal: null, channel: null });
    open.push(store);
    const first = feed(12, '20261019T064100Z');
    const { id } = await subscribed(store, first);
    const fetch = mockFetch(() => new Response(feed(13, '20261019T074100Z')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const manager = new SubscriptionManager(store, { engine, fetch, now, locks: localLocks(), document: null, window: null });
    await store.transact([id], (tx) => {
      const r = tx.record(id)!;
      tx.putRecord({ ...r, subscription: { ...r.subscription!, lastAttemptAt: null } });
    });
    backend.failNext.push(new StorageFullError());
    await expect(manager.refreshDue()).resolves.toEqual(['failed']);
    expect(store.documentText(id)).toBe(first);
    expect(store.getState().calendars.find((c) => c.id === id)!.subscription!.updating).toBe(false);
    // Codes only, never the link or event text (§7.6).
    expect(warn).toHaveBeenCalledWith('[thirteen] subscriptions: refresh-write-failed storage');
    warn.mockRestore();
    // The next refresh writes.
    expect(await manager.refresh(id)).toBe('stored');
  });

  it('two tabs refreshing the same feed fetch it once', async () => {
    const browser = testBrowser();
    const a = await tab(browser);
    const { id } = await subscribed(a, feed(12, '20261019T064100Z'));
    const b = await tab(browser);
    await settle();
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    const fetch = mockFetch(async () => {
      await gate;
      return new Response(feed(12, '20261019T084100Z'));
    });
    const ma = new SubscriptionManager(a, { engine, fetch, now, locks: browser.locks, document: null, window: null });
    const mb = new SubscriptionManager(b, { engine, fetch, now, locks: browser.locks, document: null, window: null });
    const both = Promise.all([ma.refresh(id), mb.refresh(id)]);
    await settle();
    release();
    expect((await both).sort()).toEqual(['skipped', 'stored']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never stores an older response that finishes last', async () => {
    const browser = testBrowser();
    const store = await tab(browser);
    const { id } = await subscribed(store, feed(12, '20261019T064100Z'));
    const releases: (() => void)[] = [];
    const bodies = [feed(12, '20261019T090000Z', 0, 'Slow'), feed(12, '20261019T090100Z', 0, 'Fast')];
    let call = 0;
    const fetch = mockFetch(async () => {
      const body = bodies[call++]!;
      await new Promise<void>((done) => releases.push(done));
      return new Response(body);
    });
    // Without a shared lock (a browser without Web Locks), both refreshes run.
    const slow = new SubscriptionManager(store, { engine, fetch, now, locks: localLocks(), document: null, window: null });
    const fast = new SubscriptionManager(store, { engine, fetch, now, locks: localLocks(), document: null, window: null });
    const a = slow.refresh(id);
    await settle();
    const b = fast.refresh(id);
    await settle();
    releases[1]!();
    expect(await b).toBe('stored');
    releases[0]!();
    expect(await a).toBe('older');
    expect(store.documentText(id)).toContain('X-WR-CALNAME:Fast');
  });

  it('holds back zero events once, then accepts the same outcome', async () => {
    const store = await tab(testBrowser());
    const { id } = await subscribed(store, feed(12, '20261019T064100Z'));
    let stamp = 0;
    const fetch = mockFetch(() => new Response(feed(0, `2026101${++stamp}T064100Z`)));
    const manager = new SubscriptionManager(store, { engine, fetch, now, locks: localLocks(), document: null, window: null });
    expect(await manager.refresh(id)).toBe('held-back');
    expect(store.record(id)!.subscription).toMatchObject({ lastError: 'feed-empty', suspect: { kind: 'empty', events: 0, skipped: 0 } });
    expect(store.documentText(id)).toContain('UID:h11@feed');
    expect(store.getState().calendars.find((c) => c.id === id)!.subscription!.lastError).toBe('feed-empty');
    expect(await manager.refresh(id)).toBe('stored');
    expect(store.record(id)!.subscription).toMatchObject({ lastError: null, suspect: null });
    expect(store.documentText(id)).not.toContain('UID:h11@feed');
  });

  it('holds back a partly unreadable feed whose every response has a new DTSTAMP once, and accepts it on the next refresh with the same outcome', async () => {
    const store = await tab(testBrowser());
    const { id } = await subscribed(store, feed(20, '20261019T064100Z'));
    let stamp = 0;
    const fetch = mockFetch(() => new Response(feed(18, `2026102${++stamp}T064100Z`, 4)));
    const manager = new SubscriptionManager(store, { engine, fetch, now, locks: localLocks(), document: null, window: null });
    expect(await manager.refresh(id)).toBe('held-back');
    expect(store.record(id)!.subscription).toMatchObject({ lastError: 'feed-partial', suspect: { kind: 'partial', events: 18, skipped: 4 } });
    expect(await manager.refresh(id)).toBe('stored');
    expect(store.documentText(id)).toContain('DTSTAMP:20261022T064100Z');
  });

  it('records errors on the row, but none while offline; refreshes resume 5 seconds after the connection returns', async () => {
    const store = await tab(testBrowser());
    const { id } = await subscribed(store, feed(12, '20261019T064100Z'));
    let online = true;
    const fetch = mockFetch(() => new Response('', { status: 404 }));
    const listeners = new Map<string, () => void>();
    const win = { addEventListener: (type: string, fn: () => void) => void listeners.set(type, fn), removeEventListener: () => undefined };
    const manager = new SubscriptionManager(store, { engine, fetch, now, online: () => online, locks: localLocks(), document: null, window: win as never, tickMs: 3_600_000, resumeDelayMs: 20 });
    expect(await manager.refresh(id)).toBe('failed');
    expect(store.record(id)!.subscription!.lastError).toBe('subscribe.error.notFound');
    online = false;
    manager.start();
    listeners.get('offline')!();
    expect(manager.offline).toBe(true);
    expect(await manager.refresh(id)).toBe('offline');
    expect(fetch).toHaveBeenCalledTimes(1);
    online = true;
    await store.transact([id], (tx) => {
      const r = tx.record(id)!;
      tx.putRecord({ ...r, subscription: { ...r.subscription!, lastAttemptAt: null } });
    });
    listeners.get('online')!();
    expect(manager.offline).toBe(false);
    await new Promise((done) => setTimeout(done, 60));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    manager.stop();
  });

  it('is stale after twice its interval; manual feeds never warn', () => {
    const at = new Date('2026-10-19T12:00:00Z');
    expect(isStale({ interval: 'PT6H', lastSuccessAt: '2026-10-19T00:30:00Z' }, at)).toBe(false);
    expect(isStale({ interval: 'PT6H', lastSuccessAt: '2026-10-18T23:30:00Z' }, at)).toBe(true);
    expect(isStale({ interval: 'manual', lastSuccessAt: '2020-01-01T00:00:00Z' }, at)).toBe(false);
    expect(isStale({ interval: 'P1D', lastSuccessAt: { date: { year: 2026, month: 10, day: 18 }, minute: 0 } }, at)).toBe(false);
    // Never updated here (restored from a backup): counted from when it was added, as the rows and the toolbar count.
    expect(isStale({ interval: 'P1D', lastSuccessAt: null }, at, '2026-10-16T12:00:00Z')).toBe(true);
    expect(isStale({ interval: 'P1D', lastSuccessAt: null }, at, '2026-10-19T11:00:00Z')).toBe(false);
    expect(isStale({ interval: 'P1D', lastSuccessAt: null, addedAt: { date: { year: 2026, month: 10, day: 16 }, minute: 0 } }, at)).toBe(true);
    expect(isStale({ interval: 'P1D', lastSuccessAt: null }, at)).toBe(false);
  });

  it('does not fetch hidden subscriptions when they are due; "Update now" still does (§2.15)', async () => {
    const store = await tab(testBrowser());
    const { id } = await subscribed(store, feed(12, '20261019T064100Z'));
    await store.transact([id], (tx) => {
      const r = tx.record(id)!;
      tx.putRecord({ ...r, subscription: { ...r.subscription!, lastAttemptAt: null } });
    });
    await store.updateCalendar(id, { visible: false });
    const fetch = mockFetch(() => new Response(feed(13, '20261019T074100Z')));
    const manager = new SubscriptionManager(store, { engine, fetch, now, locks: localLocks(), document: null, window: null });
    await expect(manager.refreshDue()).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(await manager.refresh(id)).toBe('stored');
    await store.updateCalendar(id, { visible: true });
    await store.transact([id], (tx) => {
      const r = tx.record(id)!;
      tx.putRecord({ ...r, subscription: { ...r.subscription!, lastAttemptAt: null } });
    });
    await expect(manager.refreshDue()).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('decides newer-only on the record read inside the lock', () => {
    const record = {
      url: 'https://f.example/a',
      interval: 'PT6H' as const,
      etag: null,
      lastModified: null,
      contentHash: 'sha256:aa',
      suspect: null,
      lastAttemptAt: '2026-10-19T08:00:00.000Z',
      lastSuccessAt: '2026-10-19T08:00:00.000Z',
      lastError: null,
    };
    const fetched: FeedFetch = { ok: true, body: 'x', hash: 'sha256:bb', startedAt: '2026-10-19T07:59:00.000Z' };
    expect(decideRefresh(record, fetched, { ok: true, name: null, color: null, refreshInterval: null, events: 1, groups: 1, skipped: 0, thirteenCalendarId: null }, 1)).toMatchObject({ store: false, outcome: 'older' });
    // Not parsed because it matched the hash read when the refresh began: unchanged against the same hash...
    const later = { ...fetched, startedAt: '2026-10-19T09:00:00.000Z' };
    expect(decideRefresh(record, { ...later, hash: 'sha256:aa' }, null, 0)).toMatchObject({ store: false, outcome: 'unchanged', record: { lastSuccessAt: later.startedAt } });
    // ...and nothing decided when the stored copy changed meanwhile (no error on the row).
    const skipped = decideRefresh(record, later, null, 0);
    expect(skipped).toMatchObject({ store: false, outcome: 'skipped' });
    expect(skipped.record).toBe(record);
  });

  it('subscribes to a real-world feed and shows it read-only, without alerts', async () => {
    const store = await tab(testBrowser());
    const { id, check } = await subscribed(store, fixture('cases/google-secret.ics'), 'webcal://calendar.example/secret.ics');
    expect(check.name).toBeTruthy();
    await store.loadYear(2026);
    const snapshot = store.occurrencesInYear(2026);
    if (snapshot.status !== 'ready') throw new Error('not ready');
    const mine = snapshot.occurrences.filter((o) => o.calendarId === id);
    expect(mine.length).toBeGreaterThan(3);
    expect(mine.every((o) => o.readOnly === 'subscribed' && o.alarms.length === 0)).toBe(true);
    const calendar = store.getState().calendars.find((c) => c.id === id)!;
    expect(calendar).toMatchObject({ kind: 'subscription', writable: false, accountTitle: 'Subscriptions' });
    expect(formatLocalDateTime(calendar.subscription!.lastSuccessAt!)).toMatch(/^2026-10-19T06:4/);
  });
});
