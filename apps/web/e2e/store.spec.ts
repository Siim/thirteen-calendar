import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Page, expect, test } from '@playwright/test';

/** The IndexedDB store in a real browser (docs/EVENTS.md §3.6, §2.11, §2.17): IndexedDB, Web Locks, BroadcastChannel, the worker, fetch rules. */

const call = <T>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([n, a]) => {
      const harness = (window as unknown as { harness: Record<string, (...x: unknown[]) => unknown> }).harness;
      return harness[n as string]!(...(a as unknown[]));
    },
    [name, args] as const,
  ) as Promise<T>;

async function ready(page: Page) {
  await page.goto('/dev/events-store.html');
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  return call<{ status: string; kind: string; calendars: string[] }>(page, 'open');
}

test('stores events in IndexedDB, syncs tabs through BroadcastChannel and parses in the worker', async ({ context }) => {
  const a = await context.newPage();
  const opened = await ready(a);
  expect(opened).toMatchObject({ status: 'ready', kind: 'indexeddb', calendars: ['Personal'] });
  const b = await context.newPage();
  await ready(b);
  // Concurrent writes from two tabs, serialized by the thirteen-events lock: all four survive.
  await Promise.all([
    call(a, 'create', 'A1', '2026-10-20T10:00', '2026-10-20T11:00'),
    call(b, 'create', 'B1', '2026-10-20T12:00', '2026-10-20T13:00'),
    call(a, 'create', 'A2', '2026-10-21T10:00', '2026-10-21T11:00'),
    call(b, 'create', 'B2', '2026-10-21T12:00', '2026-10-21T13:00'),
  ]);
  const all = ['2026-10-20T10:00 A1', '2026-10-20T12:00 B1', '2026-10-21T10:00 A2', '2026-10-21T12:00 B2'];
  await expect.poll(() => call(b, 'titles')).toEqual(all);
  await expect.poll(() => call(a, 'titles')).toEqual(all);
  // Parsed and expanded in the module worker, which loaded without errors.
  expect(await call(a, 'engineKind')).toBe('worker');
  // A reload reads them back.
  await a.reload();
  await expect(a.locator('body[data-ready="true"]')).toBeAttached();
  await call(a, 'open');
  expect(await call(a, 'titles')).toEqual(all);
});

test('opens IndexedDB again after the browser closed the connection (WebKit after the page slept)', async ({ page }) => {
  await ready(page);
  await call(page, 'create', 'Before', '2026-10-20T09:00', '2026-10-20T10:00');
  expect(await call(page, 'loseConnection')).toBe(true);
  await call(page, 'create', 'After', '2026-10-20T11:00', '2026-10-20T12:00');
  await page.reload();
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  await call(page, 'open');
  expect(await call(page, 'titles')).toEqual(['2026-10-20T09:00 Before', '2026-10-20T11:00 After']);
});

test('a zero quota (IndexedDB opens, the first write is refused) runs in memory mode with the banner, not a blank page', async ({ page, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'the quota override is a Chromium DevTools command');
  const cdp = await page.context().newCDPSession(page);
  // One byte: Chromium opens the database, then refuses every write with QuotaExceededError (0 reads as no override).
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(baseURL!).origin, quotaSize: 1 });
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  expect(await ready(page)).toMatchObject({ status: 'memory', kind: 'memory', calendars: ['Personal'] });
  await call(page, 'create', 'Kept in this tab', '2026-10-20T10:00', '2026-10-20T11:00');
  expect(await call(page, 'titles')).toEqual(['2026-10-20T10:00 Kept in this tab']);
  expect(warnings).toContain('[thirteen] store: indexeddb-unusable storage');
  // The app itself starts, on the store's memory mode, and says so (§2.16 "Storage unavailable").
  await page.goto('/#/month/2026/10');
  await expect(page.getByText('This browser doesn’t let Thirteen save events here', { exact: false })).toBeVisible();
});

test('replays a pending delete of a closed tab, never one of an open tab', async ({ context }) => {
  const a = await context.newPage();
  await ready(a);
  const key = await call<string>(a, 'create', 'Dentist', '2026-10-20T15:40', '2026-10-20T16:20');
  expect(await call(a, 'holdDelete', key)).toBe(1);
  const b = await context.newPage();
  await ready(b);
  expect(await call(b, 'replay')).toBe(1); // tab A is open: its entry is left alone
  expect(await call(b, 'titles')).toEqual(['2026-10-20T15:40 Dentist']);
  await a.close({ runBeforeUnload: false });
  await expect.poll(() => call(b, 'replay')).toBe(0);
  await expect.poll(() => call(b, 'titles')).toEqual([]);
});

test.describe('subscriptions against a local feed server', () => {
  let server: Server;
  let origin = '';
  let preflights = 0;
  let gets = 0;
  const body = (n: number) =>
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Feed//EN', 'X-WR-CALNAME:Feed', ...Array.from({ length: n }, (_, i) => [`BEGIN:VEVENT`, `UID:e${i}`, 'DTSTAMP:20261019T064100Z', `DTSTART;VALUE=DATE:2026110${(i % 9) + 1}`, `SUMMARY:E${i}`, 'END:VEVENT']).flat(), 'END:VCALENDAR', ''].join('\r\n');

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        preflights++;
        res.writeHead(405).end();
        return;
      }
      gets++;
      if (req.url?.startsWith('/cors')) res.writeHead(200, { 'content-type': 'text/calendar', 'access-control-allow-origin': '*' }).end(body(12));
      else res.writeHead(200, { 'content-type': 'text/calendar' }).end(body(3));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

  test('subscribes and refreshes three times without a preflight (OPTIONS answers 405); a server without CORS headers is refused', async ({ page }) => {
    await ready(page);
    const before = preflights;
    const subscribed = await call<{ id: string; name: string; events: number }>(page, 'subscribeRaw', `${origin}/cors/feed.ics`);
    expect(subscribed).toMatchObject({ name: 'Feed', events: 12 });
    for (let i = 0; i < 3; i++) expect(await call(page, 'refresh', subscribed.id)).toBe('unchanged');
    expect(await call<string>(page, 'document', subscribed.id)).toBe(body(12));
    expect(preflights).toBe(before);
    expect(gets).toBeGreaterThanOrEqual(4);
    // No Access-Control-Allow-Origin: the page cannot read it (a TypeError, mapped to webGeneric on an unknown host).
    expect(await call(page, 'fetchFeed', `${origin}/plain/feed.ics`)).toEqual({ ok: false, error: 'subscribe.error.webGeneric' });
    expect(preflights).toBe(before);
  });
});
