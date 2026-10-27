import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { type Server, createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { type Browser, type BrowserContext, type Download, type Page, expect, test } from '@playwright/test';
import { readZip } from '../src/lib/events/files.ts';

/**
 * The Calendars list, import, export, restore and subscribe in a real browser
 * on the IndexedDB store (docs/EVENTS.md §2.15 to §2.17, §6.5 e2e): import of
 * fixtures/ics/cases/google-secret.ics, export then import equals the
 * original, export all (two local calendars and a subscription) then restore
 * into a fresh browser context, subscribe to a feed server that sends CORS
 * headers, one that does not, and one whose OPTIONS answers 405 (subscribe and
 * three refreshes must succeed without a preflight), the CORS state's Import
 * button, the offline banner, `#/subscribe?url=`, the no-dashes scan and axe.
 */

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const GOOGLE = resolve(ROOT, 'fixtures/ics/cases/google-secret.ics');
const OPTIONS = { locale: 'en-GB', timezoneId: 'Europe/Tallinn', reducedMotion: 'reduce', ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } } as const;

test.use(OPTIONS);

// ---- a local HTTPS feed server (the web refuses http:// links, §2.17) ----------------------

let server: Server;
let origin = '';
let certDir = '';
let preflights = 0;
let gets = 0;
const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Feed//EN',
  'X-WR-CALNAME:Holidays in Estonia',
  'REFRESH-INTERVAL;VALUE=DURATION:P1D',
  ...[
    ['20261024', 'Feed day one'],
    ['20261031', 'Feed day two'],
    ['20261102', 'Feed day three'],
  ].flatMap(([day, title], i) => ['BEGIN:VEVENT', `UID:feed-${i}@example.test`, 'DTSTAMP:20261019T064100Z', `DTSTART;VALUE=DATE:${day}`, `SUMMARY:${title}`, 'END:VEVENT']),
  'END:VCALENDAR',
  '',
].join('\r\n');

test.beforeAll(async () => {
  certDir = mkdtempSync(join(tmpdir(), 'thirteen-b6-e2e-'));
  // A throwaway self-signed certificate for 127.0.0.1, valid for one day.
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem'),
  ], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) }, (req, res) => {
    if (req.method === 'OPTIONS') {
      preflights++;
      res.writeHead(405).end();
      return;
    }
    gets++;
    if (req.url?.startsWith('/cors')) res.writeHead(200, { 'content-type': 'text/calendar', 'access-control-allow-origin': '*' }).end(FEED);
    else res.writeHead(200, { 'content-type': 'text/calendar' }).end(FEED);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(certDir, { recursive: true, force: true });
});

// ---- helpers -------------------------------------------------------------------------------

/** No request ever leaves for a real calendar host. */
async function guard(context: BrowserContext): Promise<void> {
  await context.route(/^https:\/\/(calendar\.google\.com|[^/]*icloud\.com|outlook\.(office365|live)\.com)\//, (route) => route.abort('failed'));
}

async function openCalendar(page: Page): Promise<void> {
  await guard(page.context());
  await page.goto('/#/month/2026/10');
  await expect(pane(page).getByRole('button', { name: 'Import .ics file' })).toBeVisible();
}

const pane = (page: Page) => page.locator('[data-calendars-pane]').first();
const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name });

async function chooseFiles(page: Page, files: string | readonly { name: string; mimeType: string; buffer: Buffer }[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await pane(page).getByRole('button', { name: 'Import .ics file' }).click();
  await (await chooser).setFiles(typeof files === 'string' ? files : [...files]);
}

async function downloaded(download: Download): Promise<{ name: string; bytes: Buffer }> {
  const path = await download.path();
  // WebKit on Linux turns the spaces of a suggested file name into underscores; the names used here have none.
  const linuxWebKit = process.platform === 'linux' && download.page().context().browser()?.browserType().name() === 'webkit';
  const name = download.suggestedFilename();
  return { name: linuxWebKit ? name.replaceAll('_', ' ') : name, bytes: readFileSync(path) };
}

async function exportCalendars(page: Page, uncheck: readonly string[] = []): Promise<{ name: string; bytes: Buffer }> {
  await pane(page).getByRole('button', { name: 'Export', exact: true }).click();
  const box = dialog(page, 'Export');
  for (const name of uncheck) await box.getByRole('checkbox', { name }).uncheck();
  const download = page.waitForEvent('download');
  await box.getByRole('button', { name: 'Export' }).click();
  const file = await downloaded(await download);
  await expect(box).toBeHidden();
  return file;
}

async function subscribe(page: Page, url: string): Promise<void> {
  await pane(page).getByRole('button', { name: 'Subscribe to calendar' }).click();
  const box = dialog(page, 'Subscribe to a calendar');
  await box.getByRole('textbox', { name: 'Calendar link' }).fill(url);
  await box.getByRole('button', { name: 'Subscribe' }).click();
  const found = dialog(page, 'Holidays in Estonia: 3 events');
  await expect(found).toBeVisible();
  await expect(found.getByRole('combobox', { name: 'Update' })).toHaveValue('P1D');
  await found.getByRole('button', { name: 'Subscribe' }).click();
  await expect(found).toBeHidden();
  await expect(pane(page).getByRole('checkbox', { name: 'Holidays in Estonia' })).toBeVisible();
}

async function freshPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ...OPTIONS, baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await openCalendar(page);
  return { context, page };
}

/** Visible text without the user's and other apps' text (§2.19 checks). */
async function visibleTextWithoutUserText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const element of clone.querySelectorAll('[data-user-text]')) element.remove();
    for (const element of clone.querySelectorAll('script, style, noscript')) element.remove();
    return clone.innerText ?? clone.textContent ?? '';
  });
}

const calendarColor = (page: Page, name: string) =>
  pane(page)
    .locator('[data-calendar-row]')
    .filter({ has: page.getByRole('checkbox', { name, exact: true }) })
    .evaluate((row) => (row as HTMLElement).style.getPropertyValue('--cal'));

// ---- tests ---------------------------------------------------------------------------------

test('imports google-secret.ics into a new calendar, and again into it without duplicates', async ({ page }) => {
  await openCalendar(page);
  await chooseFiles(page, GOOGLE);
  const box = dialog(page, 'Import events');
  await expect(box.getByText('3 events in google-secret.ics')).toBeVisible();
  await expect(box.getByRole('combobox', { name: 'Add to' })).toHaveValue(/new/);
  await box.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Added 3, updated 0, unchanged 0.').first()).toBeVisible();
  await expect(pane(page).getByRole('checkbox', { name: 'Liis Kask' })).toBeVisible();
  // The imported events are in the Calendar.
  await page.goto('/#/list/2026-10-19');
  await expect(page.getByText('Choir rehearsal').first()).toBeVisible();
  await chooseFiles(page, GOOGLE);
  const again = dialog(page, 'Import events');
  await again.getByRole('combobox', { name: 'Add to' }).selectOption({ label: 'Liis Kask' });
  await again.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Added 0, updated 0, unchanged 3.').first()).toBeVisible();
});

test('export then import into a fresh browser equals the original', async ({ page, browser }) => {
  await openCalendar(page);
  await chooseFiles(page, GOOGLE);
  await dialog(page, 'Import events').getByRole('button', { name: 'Import' }).click();
  await expect(pane(page).getByRole('checkbox', { name: 'Liis Kask' })).toBeVisible();
  // The calendar's own Export (its settings).
  await pane(page).locator('[data-calendar-row]').filter({ hasText: 'Liis Kask' }).getByRole('button', { name: 'Calendar settings' }).click();
  const settings = dialog(page, 'Liis Kask');
  const download = page.waitForEvent('download');
  await settings.getByRole('button', { name: 'Export' }).click();
  const original = await downloaded(await download);
  expect(original.name).toBe('Liis Kask.ics');
  const text = original.bytes.toString('utf8');
  expect(text).toContain('X-WR-CALNAME:Liis Kask\r\n');
  expect(text).toMatch(/X-THIRTEEN-CALENDAR-ID:[0-9a-f-]{36}\r\n/);

  const fresh = await freshPage(browser);
  await chooseFiles(fresh.page, [{ name: original.name, mimeType: 'text/calendar', buffer: original.bytes }]);
  // A Thirteen export: Restore, keeping the calendar's id, name and colour.
  const restore = dialog(fresh.page, 'Restore calendars');
  await expect(restore.getByText('1 calendar in Liis Kask.ics')).toBeVisible();
  await restore.getByRole('button', { name: 'Restore' }).click();
  await expect(fresh.page.getByText('Restored 1 calendar.').first()).toBeVisible();
  expect(await calendarColor(fresh.page, 'Liis Kask')).toBe(await calendarColor(page, 'Liis Kask'));
  // The fresh browser's own empty "Personal" gave way to the restored calendar (B8).
  await expect(pane(fresh.page).locator('[data-calendar-row]')).toHaveText([/Liis Kask/]);
  const again = await exportCalendars(fresh.page);
  expect(again.name).toBe('Liis Kask.ics');
  expect(again.bytes.toString('utf8')).toBe(text);
  await fresh.context.close();
});

test('export all (two local calendars and a subscription) then restore into a fresh browser keeps names, colours, kinds, events and the link', async ({ page, browser }) => {
  await openCalendar(page);
  // An event made in Thirteen with a 13-month repeat, in the first-use "Personal" (task B8, 2026-10-26),
  // so the round trip also carries X-THIRTEEN-RULE and the app's own writer, not only an imported file.
  await page.keyboard.press('c');
  const editor = dialog(page, 'New event');
  await expect(editor.getByRole('textbox', { name: 'Title' })).toBeFocused();
  await page.keyboard.type('Rent');
  await editor.getByRole('button', { name: /^Repeat/ }).first().click();
  await page.getByRole('radiogroup', { name: 'Repeat' }).getByRole('radio', { name: /^Every IFC month on the / }).click();
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(editor).toBeHidden();
  await chooseFiles(page, GOOGLE);
  await dialog(page, 'Import events').getByRole('button', { name: 'Import' }).click();
  await expect(pane(page).getByRole('checkbox', { name: 'Liis Kask' })).toBeVisible();
  await subscribe(page, `${origin}/cors/holidays.ics`);
  // The Export dialog names the secret links when a subscription is checked.
  await pane(page).getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog(page, 'Export').getByText('Exported subscriptions include their links. Treat secret links like passwords.')).toBeVisible();
  await dialog(page, 'Export').getByRole('button', { name: 'Cancel' }).click();
  const zip = await exportCalendars(page);
  expect(zip.name).toMatch(/^Thirteen calendars \d{4}-\d{2}-\d{2}\.zip$/);
  const entries = readZip(new Uint8Array(zip.bytes));
  expect(entries.map((e) => e.name)).toEqual(['Personal.ics', 'Liis Kask.ics', 'Holidays in Estonia.ics']);
  const personal = new TextDecoder().decode(entries[0]!.bytes);
  expect(personal).toContain('SUMMARY:Rent\r\n');
  expect(personal).toMatch(/X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=monthly;DAY=\d+\r\n/);
  const holidays = new TextDecoder().decode(entries[2]!.bytes);
  expect(holidays).toContain(`X-THIRTEEN-SUBSCRIPTION-URL:${origin}/cors/holidays.ics\r\n`);
  expect(holidays).toContain('X-THIRTEEN-SUBSCRIPTION-INTERVAL:P1D\r\n');
  const colors = { liis: await calendarColor(page, 'Liis Kask'), holidays: await calendarColor(page, 'Holidays in Estonia') };

  const fresh = await freshPage(browser);
  await chooseFiles(fresh.page, [{ name: zip.name, mimeType: 'application/zip', buffer: zip.bytes }]);
  const restore = dialog(fresh.page, 'Restore calendars');
  await expect(restore.getByText(`3 calendars in ${zip.name}`)).toBeVisible();
  await expect(restore.getByText('subscription', { exact: true })).toBeVisible();
  await restore.getByRole('button', { name: 'Restore' }).click();
  await expect(fresh.page.getByText('Restored 3 calendars.').first()).toBeVisible();
  // Names, kinds and colours.
  await expect(pane(fresh.page).getByRole('checkbox', { name: 'Liis Kask' })).toBeVisible();
  const feedRow = pane(fresh.page).locator('[data-calendar-row]').filter({ hasText: 'Holidays in Estonia' });
  await expect(feedRow.getByText('Read only')).toBeVisible();
  await expect(pane(fresh.page).locator('[data-calendar-group="subscriptions"]')).toContainText('Holidays in Estonia');
  expect(await calendarColor(fresh.page, 'Liis Kask')).toBe(colors.liis);
  expect(await calendarColor(fresh.page, 'Holidays in Estonia')).toBe(colors.holidays);
  // The link.
  await feedRow.getByRole('button', { name: 'Calendar settings' }).click();
  await expect(dialog(fresh.page, 'Holidays in Estonia').getByRole('textbox', { name: 'Calendar link' })).toHaveValue(`${origin}/cors/holidays.ics`);
  await dialog(fresh.page, 'Holidays in Estonia').getByRole('button', { name: 'Close' }).click();
  // The events: the restored browser exports the same files, byte for byte. Its own empty "Personal"
  // (created on first use) gave way to the restored calendars, so it has exactly the backed-up ones (B8).
  const again = readZip(new Uint8Array((await exportCalendars(fresh.page)).bytes));
  expect(again.map((e) => e.name)).toEqual(['Personal.ics', 'Liis Kask.ics', 'Holidays in Estonia.ics']);
  const text = (name: string, list: typeof entries) => new TextDecoder().decode(list.find((e) => e.name === name)!.bytes);
  expect(text('Personal.ics', again)).toBe(text('Personal.ics', entries));
  expect(text('Liis Kask.ics', again)).toBe(text('Liis Kask.ics', entries));
  expect(text('Holidays in Estonia.ics', again)).toBe(text('Holidays in Estonia.ics', entries));
  await fresh.context.close();
});

test('several files chosen at once, then a Thirteen zip dropped on the window and restored without one of its calendars', async ({ page }) => {
  await openCalendar(page);
  // The restored subscription refreshes at once: its host (example.com) is never contacted.
  await page.context().route(/^https:\/\/calendar\.example\.com\//, (route) => route.abort('failed'));
  await chooseFiles(page, [
    { name: 'google-secret.ics', mimeType: 'text/calendar', buffer: readFileSync(GOOGLE) },
    { name: 'outlook-publish.ics', mimeType: 'text/calendar', buffer: readFileSync(resolve(ROOT, 'fixtures/ics/cases/outlook-publish.ics')) },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Hello') },
  ]);
  const box = dialog(page, 'Import events');
  await expect(box.getByText('3 events in google-secret.ics')).toBeVisible();
  await expect(box.getByText(/^\d+ events in outlook-publish\.ics$/)).toBeVisible();
  await expect(box.getByText('This file isn’t a calendar (.ics) file.')).toBeVisible();
  await expect(box.getByRole('combobox', { name: 'Add to' })).toHaveCount(2);
  const serious = async () =>
    (await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(await serious()).toEqual([]);
  expect(await visibleTextWithoutUserText(page)).not.toMatch(/[–—]/);
  await box.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText(/^Added \d+, updated 0, unchanged 0\.$/).first()).toBeVisible();
  await expect(pane(page).getByRole('checkbox', { name: 'Liis Kask' })).toBeVisible();

  // Thirteen's zip of three calendars, dropped anywhere on the window (§2.17 step 1).
  const zip = [...readFileSync(resolve(ROOT, 'fixtures/ics/restore/Thirteen calendars 2026-10-19.zip'))];
  const dataTransfer = await page.evaluateHandle((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'Thirteen calendars 2026-10-19.zip', { type: 'application/zip' }));
    return transfer;
  }, zip);
  await page.dispatchEvent('main', 'dragover', { dataTransfer });
  await page.dispatchEvent('main', 'drop', { dataTransfer });
  const restore = dialog(page, 'Restore calendars');
  await expect(restore.getByText('3 calendars in Thirteen calendars 2026-10-19.zip')).toBeVisible();
  expect(await serious()).toEqual([]);
  expect(await visibleTextWithoutUserText(page)).not.toMatch(/[–—]/);
  await restore.getByRole('checkbox', { name: 'Work' }).uncheck();
  await restore.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Restored 2 calendars.').first()).toBeVisible();
  await expect(pane(page).locator('[data-calendar-group="subscriptions"]')).toContainText('Holidays in Estonia');
  await expect(pane(page).getByRole('checkbox', { name: 'Work', exact: true })).toHaveCount(0);
  // The restored Personal keeps its id next to this browser's own: two calendars of that name.
  await expect(pane(page).getByRole('checkbox', { name: 'Personal', exact: true })).toHaveCount(2);
});

test('subscribes without a preflight: three refreshes succeed while OPTIONS answers 405; a server without CORS headers is refused', async ({ page }) => {
  await openCalendar(page);
  const beforePreflights = preflights;
  await subscribe(page, `${origin}/cors/feed.ics`);
  const row = pane(page).locator('[data-calendar-row]').filter({ hasText: 'Holidays in Estonia' });
  await row.getByRole('button', { name: 'Calendar settings' }).click();
  const settings = dialog(page, 'Holidays in Estonia');
  for (let i = 0; i < 3; i++) {
    const before = gets;
    await settings.getByRole('button', { name: 'Update now' }).click();
    await expect.poll(() => gets).toBeGreaterThan(before);
    await expect(settings.getByRole('button', { name: 'Update now' })).toBeEnabled();
  }
  await expect(settings.getByText(/Couldn’t update/)).toHaveCount(0);
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(row.getByText(/^Updated /)).toBeVisible();
  expect(preflights).toBe(beforePreflights);

  // No Access-Control-Allow-Origin: the page cannot read it.
  await pane(page).getByRole('button', { name: 'Subscribe to calendar' }).click();
  const box = dialog(page, 'Subscribe to a calendar');
  await box.getByRole('textbox', { name: 'Calendar link' }).fill(`${origin}/plain/feed.ics`);
  await box.getByRole('button', { name: 'Subscribe' }).click();
  await expect(box.getByText('Couldn’t read this link. The server may be offline, or it may not let web pages read it.')).toBeVisible();
  await expect(box.getByRole('textbox', { name: 'Calendar link' })).toHaveAttribute('aria-invalid', 'true');
  expect(preflights).toBe(beforePreflights);
});

test('a known host without CORS offers Import .ics file, which opens the import flow (board D2)', async ({ page }) => {
  await openCalendar(page);
  await pane(page).getByRole('button', { name: 'Subscribe to calendar' }).click();
  const box = dialog(page, 'Subscribe to a calendar');
  await box.getByRole('textbox', { name: 'Calendar link' }).fill('https://calendar.google.com/calendar/ical/liis.kask%40example.com/private-0000example/basic.ics');
  await box.getByRole('button', { name: 'Subscribe' }).click();
  await expect(box.getByText('This calendar’s server doesn’t let web pages read it. Download the .ics file and import it, or subscribe in Thirteen for Windows.')).toBeVisible();
  await expect(box.getByRole('button')).toHaveText(['Cancel', 'Import .ics file', 'Subscribe']);
  const results = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  expect(await visibleTextWithoutUserText(page)).not.toMatch(/[–—]/);
  const chooser = page.waitForEvent('filechooser');
  await box.getByRole('button', { name: 'Import .ics file' }).click();
  await (await chooser).setFiles(GOOGLE);
  await expect(dialog(page, 'Import events')).toBeVisible();
});

test('#/subscribe?url= prefills the dialog, strips the link from the address and fetches nothing until Subscribe', async ({ page }) => {
  await guard(page.context());
  const before = gets;
  await page.goto(`/#/subscribe?url=${encodeURIComponent(`${origin}/cors/secret.ics`)}`);
  const box = dialog(page, 'Subscribe to a calendar');
  await expect(box.getByRole('textbox', { name: 'Calendar link' })).toHaveValue(`${origin}/cors/secret.ics`);
  expect(page.url()).not.toContain('secret');
  expect(gets).toBe(before);
});

test('the offline banner, the storage line, and the pane without dashes or serious axe violations', async ({ page, context }) => {
  await openCalendar(page);
  await expect(pane(page).getByText('Your events are saved in this browser on this device. Export them to keep a copy or to move them.')).toBeVisible();
  await context.setOffline(true);
  await expect(pane(page).getByText('You’re offline. Subscriptions update when you’re back online.')).toBeVisible();
  const results = await new AxeBuilder({ page }).include('[data-calendars-pane]').analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  expect(await visibleTextWithoutUserText(page)).not.toMatch(/[–—]/);
  await context.setOffline(false);
  await expect(pane(page).getByText('You’re offline. Subscriptions update when you’re back online.')).toBeHidden();
  // Collapsing a group is remembered in this browser.
  await pane(page).getByRole('button', { name: 'In this browser' }).click();
  await expect(pane(page).getByText('1 calendar, 1 shown')).toBeVisible();
  await page.reload();
  await expect(pane(page).getByText('1 calendar, 1 shown')).toBeVisible();
});
