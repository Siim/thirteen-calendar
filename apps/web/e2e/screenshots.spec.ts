import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';

/**
 * The web screenshots of docs/screenshots (docs/EVENTS.md §6.5 "Screenshots", §8.3 item 6), on the
 * mockup data set (§6.7) with today Monday, October 19, 2026 09:41 in Tallinn. Runs only when asked:
 *
 *   DOCS_SHOTS=1 E2E_BROWSERS=chromium npx playwright test e2e/screenshots.spec.ts
 *
 * writes exactly the eight `docs/screenshots/web-*.png` the README and the store listing use (or into
 * `DOCS_SHOTS_DIR`): web-today-up-next, web-calendar-month, web-calendar-month-dark, web-calendar-week,
 * web-event-editor, web-year, web-mobile-calendar and web-subscribe. Almanac light unless the name says
 * dark. Desktop shots are 1440 x 900 and the phone one 390 x 844.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.DOCS_SHOTS_DIR ?? join(HERE, '../../../docs/screenshots');
const MOCKUP = '/?store=mockup';
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const FEED = readFileSync(join(HERE, '../../../fixtures/ics/cases/google-holidays.ics'), 'utf8');

test.skip(process.env.DOCS_SHOTS !== '1', 'set DOCS_SHOTS=1 to write docs/screenshots/web-*.png');
test.use({ locale: 'en-GB', timezoneId: 'Europe/Tallinn', reducedMotion: 'reduce' });

async function theme(page: Page, palette: string, mode: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    ([p, m]) => {
      window.localStorage.setItem('thirteen:palette', p);
      window.localStorage.setItem('thirteen:theme', m);
    },
    [palette, mode] as const,
  );
}

async function save(page: Page, name: string): Promise<void> {
  // The Calendars list shows its New calendar, Subscribe, Import and Export buttons once the lazily
  // loaded services are in; under a parallel run that can come after the grid.
  const pane = page.locator('[data-calendars-pane]');
  if (await pane.isVisible()) await expect(pane.locator('button', { hasText: 'New calendar' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'one set, from Chromium');
});

test('web-calendar-month and web-calendar-month-dark', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
  await expect(page.getByRole('grid', { name: 'October 2026' })).toBeVisible();
  await save(page, 'web-calendar-month');
  await theme(page, 'almanac', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('grid', { name: 'October 2026' })).toBeVisible();
  await save(page, 'web-calendar-month-dark');
});

test('web-calendar-week', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(`${MOCKUP}#/week/2026-10-19`);
  await expect(page.locator('[data-key^="work/sprint-planning|"]').first()).toBeVisible();
  await save(page, 'web-calendar-week');
});

test('web-event-editor', async ({ page }) => {
  // The Chromium headless shell always reads the permission as denied; the documented screen is a browser
  // that has not been asked yet (otherwise the Alert picker shows alert.web.blocked under it, §2.14).
  await page.addInitScript(() => {
    if ('Notification' in window) Object.defineProperty(Notification, 'permission', { get: () => 'default' });
  });
  await page.setViewportSize(DESKTOP);
  await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
  await page.locator('[data-key^="home/book-club|"]').first().dblclick();
  await page.getByRole('dialog', { name: 'Book club: Cotsworth' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
  await save(page, 'web-event-editor');
});

test('web-subscribe', async ({ page }) => {
  // A feed that allows cross-origin reads, answered here: nothing leaves the machine.
  await page.route('https://calendars.example.org/**', (route) =>
    route.fulfill({ status: 200, body: FEED, headers: { 'content-type': 'text/calendar', 'access-control-allow-origin': '*' } }),
  );
  await page.setViewportSize(DESKTOP);
  await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
  await page.locator('[data-calendars-pane]').getByRole('button', { name: 'Subscribe to calendar' }).click();
  const box = page.getByRole('dialog', { name: 'Subscribe to a calendar' });
  await box.getByRole('textbox', { name: 'Calendar link' }).fill('https://calendars.example.org/holidays.ics');
  await box.getByRole('button', { name: 'Subscribe' }).click();
  await expect(page.getByRole('dialog', { name: /: \d+ events$/ })).toBeVisible();
  await save(page, 'web-subscribe');
});

test('web-mobile-calendar', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
  await expect(page.getByRole('grid', { name: 'October 2026' })).toBeVisible();
  await save(page, 'web-mobile-calendar');
});

test('web-today-up-next', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(`${MOCKUP}#/today`);
  const card = page.getByRole('region', { name: 'Up next' });
  await expect(card).toBeVisible();
  // Measured with the fonts loaded: 101 px above the card the window starts between two lines of the
  // hero and ends between the year bar's month names and the year figures, so no line is cut in half.
  await page.evaluate(() => document.fonts.ready);
  await card.evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 101));
  await save(page, 'web-today-up-next');
});

test('web-year', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(`${MOCKUP}#/year/2026`);
  await expect(page.getByRole('grid', { name: 'October 2026 (IFC)' })).toBeVisible();
  await save(page, 'web-year');
});
