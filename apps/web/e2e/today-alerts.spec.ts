import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Today's Up next, the Year day sheet's events, the Settings rows and web
 * alerts in a real browser (docs/EVENTS.md §2.8, §2.9, §2.14, §2.18), on the
 * mockup data set (§6.7): Monday, October 19, 2026 09:41 in Tallinn.
 * The alert test runs where Playwright can grant the notification permission:
 * Firefox, and Chromium in its new headless mode (the `chromium-new-headless`
 * project of playwright.config.ts). Chromium's headless shell always reports
 * "denied", which the blocked test uses; WebKit reports "default". A click on
 * a system notification is gate V17.
 */

const MOCKUP = '/?store=mockup';

test.use({ locale: 'en-GB', timezoneId: 'Europe/Tallinn', reducedMotion: 'reduce' });

async function noDashes(page: Page): Promise<void> {
  const text = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const element of clone.querySelectorAll('[data-user-text], script, style, noscript')) element.remove();
    return clone.innerText ?? clone.textContent ?? '';
  });
  expect(text).not.toMatch(/[–—]/);
}

async function serious(page: Page, include: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(include).disableRules(['label-content-name-mismatch']).analyze();
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`);
}

test('Today: Up next draws board B1 and opens List from today', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${MOCKUP}#/today`);
  const card = page.getByRole('region', { name: 'Up next' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { level: 3 })).toHaveText(['Today', 'Tomorrow']);
  await expect(card.getByRole('button', { name: '15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18' })).toBeVisible();
  await expect(card.getByRole('button', { name: '09:30, Sprint planning, Work, repeats' })).toContainText('Now');
  await expect(card.getByText('5 more in the next 7 days')).toBeVisible();
  await noDashes(page);
  expect(await serious(page, '[data-up-next]')).toEqual([]);
  await card.getByRole('link', { name: 'Show all in Calendar' }).click();
  await expect(page).toHaveURL(/#\/list\/2026-10-19$/);
});

test('Year day sheet: the day’s events, "New event" and "Open in Calendar"', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${MOCKUP}#/year/2026?day=2026-10-19`);
  const panel = page.getByRole('complementary', { name: 'Selected day' });
  await expect(panel.getByRole('button', { name: '19:00, Book club: Cotsworth, Home, Raamatukoi, repeats' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'New event' })).toBeVisible();
  await noDashes(page);
  await panel.getByRole('link', { name: 'Open in Calendar' }).click();
  await expect(page).toHaveURL(/#\/day\/2026-10-19$/);
});

test('Settings: the Alerts and Your data rows', async ({ page, browserName }) => {
  await page.goto(`${MOCKUP}#/settings`);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  // Desktop Chromium, Firefox and Safari show alerts from web pages: the switch, off until turned on.
  await expect(page.getByRole('switch', { name: 'Show alerts' })).not.toBeChecked();
  await expect(page.locator('p').filter({ hasText: /^Alerts appear only while Thirteen is open in a browser tab\.$/ })).toBeVisible();
  const data = page.getByRole('group', { name: 'Your data' });
  await expect(data.getByRole('button', { name: 'Export all' })).toBeEnabled();
  await expect(data.getByRole('button', { name: 'Delete all events' })).toBeEnabled();
  await noDashes(page);
  expect(await serious(page, 'main')).toEqual([]);
  // No service worker until alerts are turned on (§7.5).
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  void browserName;
});

test('alerts: turning them on registers alerts-sw.js, and an alert is shown at its time with its tag and route', async ({
  page,
  context,
  browserName,
}) => {
  await context.grantPermissions(['notifications']);
  // Every showNotification call, as the page made it (Chromium's new headless mode sometimes lists a
  // shown notification in getNotifications() only briefly, so the calls are the reliable record there).
  await page.addInitScript(() => {
    const shown: unknown[] = [];
    (window as unknown as { __shown: unknown[] }).__shown = shown;
    const original = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function (this: ServiceWorkerRegistration, title: string, options?: NotificationOptions) {
      shown.push({ title, body: options?.body, tag: options?.tag, data: options?.data as unknown });
      return original.call(this, title, options);
    };
  });
  // 17:58 in Tallinn: the book club's alert (1 hour before 19:00) is two minutes away.
  await page.clock.install({ time: new Date('2026-10-19T14:58:00Z') });
  await page.goto(`${MOCKUP}#/settings`);
  const permission = await page.evaluate(() => ('Notification' in window ? Notification.permission : 'none'));
  test.skip(permission !== 'granted', `${browserName} reports the granted notification permission as "${permission}"`);
  const toggle = page.getByRole('switch', { name: 'Show alerts' });
  // The switch's input is drawn by its track: click its label.
  const label = page.getByText('Show alerts', { exact: true });
  await expect(toggle).toBeVisible();
  // The permission is already granted and no choice was made, so alerts follow the permission (§2.14)
  // and the switch may already read on: start from off, so the next click is the user turning them on.
  if (await toggle.isChecked()) {
    await label.click();
    await expect(toggle).not.toBeChecked();
  }
  await label.click();
  await expect(toggle).toBeChecked();
  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return { scope: registration.scope, script: registration.active?.scriptURL ?? '' };
  });
  expect(scope.scope).toBe(new URL('/', page.url()).href);
  expect(scope.script.endsWith('/alerts-sw.js')).toBe(true);

  await page.clock.fastForward('03:00');
  const expected = [
    {
      title: 'Book club: Cotsworth',
      body: '19:00 to 21:00, Raamatukoi',
      tag: expect.stringMatching(/^home\/.+\|0$/) as unknown as string,
      data: { route: '#/day/2026-10-19' },
    },
  ];
  // Shown exactly once, through the worker's registration (never `new Notification()`).
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __shown: unknown[] }).__shown)).toEqual(expected);
  if (browserName === 'firefox') {
    // Firefox keeps it in the registration's list, as a system notification would be.
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.ready;
          return (await registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data as unknown }));
        }),
      )
      .toEqual(expected);
  }

  // Turning alerts off removes the worker again.
  await page.getByText('Show alerts', { exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(async () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test('alerts: where the browser blocks notifications, the switch stays off and says so', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', "Chromium's headless shell reports the permission as denied");
  await page.goto(`${MOCKUP}#/settings`);
  const permission = await page.evaluate(() => Notification.permission);
  test.skip(permission !== 'denied', `this Chromium reports the permission as "${permission}" (new headless mode)`);
  await page.getByText('Show alerts', { exact: true }).click();
  await expect(page.locator('p').filter({ hasText: 'Your browser blocks notifications from Thirteen, so this alert won’t appear.' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Show alerts' })).not.toBeChecked();
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test('alerts: the day that alerts-sw.js sends after a click opens in the tab, and nothing else does', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright runs code inside a service worker only in Chromium');
  await page.goto(`${MOCKUP}#/settings`);
  // Registered as AlertsController does once alerts are on (scope: the base path). The tab loaded
  // before the worker existed, so the worker does not control it: the usual case for an open tab.
  const started = context.waitForEvent('serviceworker');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/alerts-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  });
  const worker = context.serviceWorkers().find((candidate) => candidate.url().endsWith('/alerts-sw.js')) ?? (await started);
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();

  // A click cannot be made on a system notification here (gate V17), and a script cannot dispatch a
  // trusted notificationclick. So the worker's own listener is loaded from the served alerts-sw.js
  // and called with the worker's real `clients` and `registration`: `clients.matchAll`, the tab
  // test, `focus()` (refused outside a real click, which the worker allows for) and `postMessage`.
  const click = (route: unknown) =>
    worker.evaluate(async (value) => {
      const scope = globalThis as unknown as { registration: unknown; clients: unknown };
      const source = await (await fetch('/alerts-sw.js')).text();
      let listener: ((event: unknown) => void) | null = null;
      const shim = {
        registration: scope.registration,
        clients: scope.clients,
        addEventListener(type: string, callback: (event: unknown) => void) {
          if (type === 'notificationclick') listener = callback;
        },
      };
      new Function('self', source)(shim);
      let done: Promise<unknown> = Promise.resolve();
      (listener as ((event: unknown) => void) | null)?.({
        notification: { data: { route: value }, close() {} },
        waitUntil(promise: Promise<unknown>) {
          done = promise;
        },
      });
      await done;
    }, route);

  await click('#/day/2026-10-21');
  await expect(page).toHaveURL(/\?store=mockup#\/day\/2026-10-21$/);

  // The page takes only day routes, whoever posts them.
  const post = (route: string) =>
    worker.evaluate(async (value) => {
      const clients = (globalThis as unknown as { clients: { matchAll(o: object): Promise<{ postMessage(m: unknown): void }[]> } }).clients;
      for (const client of await clients.matchAll({ type: 'window', includeUncontrolled: true })) client.postMessage({ type: 'thirteen-route', route: value });
    }, route);
  await post('#/settings');
  await post('javascript:alert(1)');
  await click('#/settings');
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/#\/day\/2026-10-21$/);
});
