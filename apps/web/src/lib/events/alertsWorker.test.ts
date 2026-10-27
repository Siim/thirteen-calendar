import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `public/alerts-sw.js` (docs/EVENTS.md §2.14, §6.5) run against a stand-in
 * worker global: its only listener is `notificationclick`, which focuses an
 * open Thirteen tab and posts it the route, or opens Thirteen on the route.
 */
const SOURCE = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/alerts-sw.js'), 'utf8');

interface FakeClient {
  readonly url: string;
  readonly posted: unknown[];
  focused: boolean;
  focus(): Promise<FakeClient>;
  postMessage(message: unknown): void;
}

function client(url: string): FakeClient {
  const value: FakeClient = {
    url,
    posted: [],
    focused: false,
    focus() {
      value.focused = true;
      return Promise.resolve(value);
    },
    postMessage(message) {
      value.posted.push(message);
    },
  };
  return value;
}

function worker(windows: FakeClient[], scope = 'https://thirteen.haugas.dev/') {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const opened: string[] = [];
  const matchAllOptions: unknown[] = [];
  const self = {
    registration: { scope },
    clients: {
      matchAll(options: unknown) {
        matchAllOptions.push(options);
        return Promise.resolve(windows);
      },
      openWindow(url: string) {
        opened.push(url);
        return Promise.resolve(null);
      },
    },
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  new Function('self', SOURCE)(self);
  async function click(data: unknown) {
    let closed = false;
    let waited: Promise<unknown> = Promise.resolve();
    for (const listener of listeners.get('notificationclick') ?? []) {
      listener({
        notification: { data, close: () => void (closed = true) },
        waitUntil: (promise: Promise<unknown>) => void (waited = promise),
      });
    }
    await waited;
    return closed;
  }
  return { listeners, opened, matchAllOptions, click };
}

describe('alerts-sw.js', () => {
  it('has one listener, notificationclick, and no fetch, install or push code', () => {
    const { listeners } = worker([]);
    expect([...listeners.keys()]).toEqual(['notificationclick']);
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/addEventListener\(\s*['"](fetch|install|activate|push|sync)['"]/);
    expect(code).not.toMatch(/\bcaches\b|\bfetch\(|importScripts|skipWaiting|clients\.claim/);
  });

  it('focuses an open Thirteen tab and posts it the day route', async () => {
    const support = client('https://thirteen.haugas.dev/support.html');
    const app = client('https://thirteen.haugas.dev/#/today');
    const { click, opened, matchAllOptions } = worker([support, app]);
    expect(await click({ route: '#/day/2026-10-19' })).toBe(true);
    expect(matchAllOptions).toEqual([{ type: 'window', includeUncontrolled: true }]);
    expect(app.focused).toBe(true);
    expect(app.posted).toEqual([{ type: 'thirteen-route', route: '#/day/2026-10-19' }]);
    expect(support.focused).toBe(false);
    expect(opened).toEqual([]);
  });

  it('opens Thirteen on the route when no tab is open, and never opens another route', async () => {
    const { click, opened } = worker([client('https://thirteen.haugas.dev/privacy.html')]);
    await click({ route: '#/day/2026-10-21' });
    expect(opened).toEqual(['https://thirteen.haugas.dev/#/day/2026-10-21']);
    await click({ route: 'https://elsewhere.example/' });
    await click(null);
    expect(opened.slice(1)).toEqual(['https://thirteen.haugas.dev/#/calendar', 'https://thirteen.haugas.dev/#/calendar']);
  });

  it('works under a base path', async () => {
    const app = client('https://example.github.io/thirteen-calendar/index.html#/year/2026');
    const { click } = worker([client('https://example.github.io/other/'), app], 'https://example.github.io/thirteen-calendar/');
    await click({ route: '#/day/2026-10-19' });
    expect(app.posted).toEqual([{ type: 'thirteen-route', route: '#/day/2026-10-19' }]);
  });
});
