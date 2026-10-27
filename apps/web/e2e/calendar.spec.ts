import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * The Calendar section in a real browser (docs/EVENTS.md §2.1, §2.3, §2.4, §2.7, §2.20, §2.21), on the
 * mockup data set (§6.7) with today fixed to Monday, October 19, 2026 09:41 (IFC Thursday, October 12).
 * `SHOTS_DIR=/some/dir` also saves Year, Month and List at phone and desktop widths there.
 */

const MOCKUP = '/?store=mockup';
const SHOTS_DIR = process.env.SHOTS_DIR ?? '';

const SIZES = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 900 },
} as const;

/** Visible text without the user's and other apps' text (§2.19 checks): no en dash or em dash. */
async function visibleTextWithoutUserText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const element of clone.querySelectorAll('[data-user-text]')) element.remove();
    for (const element of clone.querySelectorAll('script, style, noscript')) element.remove();
    return clone.innerText ?? clone.textContent ?? '';
  });
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS_DIR === '') return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), fullPage: true });
}

test.use({ locale: 'en-GB', timezoneId: 'Europe/Tallinn', reducedMotion: 'reduce' });

const VIEWS = [
  { mode: 'year', hash: '#/year/2026', ready: (page: Page) => page.getByRole('grid', { name: 'October 2026 (IFC)' }) },
  { mode: 'month', hash: '#/month/2026/11', ready: (page: Page) => page.getByRole('grid', { name: 'October 2026' }) },
  {
    mode: 'list',
    hash: '#/list/2026-10-19',
    ready: (page: Page) => page.getByRole('heading', { name: 'October 2026', level: 2 }),
  },
] as const;

for (const [size, viewport] of Object.entries(SIZES)) {
  for (const view of VIEWS) {
    test(`${view.mode} at ${size} width: no dashes, no serious axe violations, screenshot`, async ({ page }) => {
      // Year is thirteen month tables: axe takes over 30 s on it in Firefox on a busy machine.
      test.slow(view.mode === 'year');
      await page.setViewportSize(viewport);
      await page.goto(`${MOCKUP}${view.hash}`);
      await expect(view.ready(page)).toBeVisible();
      await expect(page.getByRole('link', { name: /Calendar/ })).toHaveAttribute('aria-current', 'page');
      // Settle fonts and the load animation before reading and capturing.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      expect(await visibleTextWithoutUserText(page)).not.toMatch(/[–—]/);
      // `label-content-name-mismatch` (an experimental axe rule) is off: the §2.20 label templates put the
      // full date or the time first ("Thursday, October 12, 2026. Gregorian ...", "09:30, Sprint planning, ..."),
      // so a gridcell's or row's name is not in the order of its visible text by design.
      const axe = await new AxeBuilder({ page }).include('main').disableRules(['label-content-name-mismatch']).analyze();
      const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      await shot(page, `${view.mode}-${size}`);
    });
  }
}

test('Month at desktop width: the toolbar of §2.1 and both dates in every cell', async ({ page }) => {
  await page.setViewportSize(SIZES.desktop);
  await page.goto(`${MOCKUP}#/month/2026/11`);
  await expect(page.getByRole('heading', { level: 1, name: 'October 2026' })).toBeVisible();
  await expect(page.getByText('Gregorian Oct 8 to Nov 4')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Today' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Sunday. Gregorian Thursday' })).toBeVisible();
  const today = page.getByRole('gridcell', { name: 'Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.' });
  await expect(today).toHaveAttribute('aria-current', 'date');
  await expect(today.getByRole('button', { name: 'Sprint planning, 09:30 to 10:30, Work, repeats' })).toBeVisible();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page).toHaveURL(/#\/month\/2026\/12\?day=2026-11-16$/);
  await expect(page.getByRole('heading', { level: 1, name: 'November 2026' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'November 2026. Gregorian Nov 5 to Dec 2.' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page).toHaveURL(/#\/month\/2026\/11\?day=2026-10-19$/);
});

test('Year: day cells read in the calendar.cell.a11y form of §2.20, today as aria-current', async ({ page }) => {
  test.slow();
  await page.setViewportSize(SIZES.desktop);
  await page.goto(`${MOCKUP}#/year/2026`);
  const today = page.getByRole('gridcell', { name: 'Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.' });
  await expect(today).toHaveAttribute('aria-current', 'date');
  await expect(
    page.getByRole('gridcell', {
      name: /^Wednesday, October 25, 2026\. Gregorian Sunday, November 1, 2026\. Gregorian November begins\.( \d+ events?\.)?$/,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: /^Year Day 2026, no weekday\. Gregorian Thursday, December 31, 2026\. Follows December 28/ }),
  ).toHaveCount(1);
  const names = await page.getByRole('gridcell').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('aria-label') ?? ''));
  expect(names).toHaveLength(364);
  // "Gregorian", a space, the date: no colon, no semicolon, no "(IFC)", and no "today" word.
  expect(names.filter((name) => /[:;()]|today/i.test(name))).toEqual([]);
});

test('Month keyboard model: arrows between days, Enter or F2 into the events, Escape back (§2.20)', async ({ page }) => {
  await page.setViewportSize(SIZES.desktop);
  await page.goto(`${MOCKUP}#/month/2026/11`);
  const today = page.getByRole('gridcell', { name: /^Thursday, October 12, 2026\./ });
  await today.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('gridcell', { name: /^Friday, October 13, 2026\./ })).toBeFocused();
  await expect(page).toHaveURL(/day=2026-10-20$/);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('F2');
  await expect(today.getByRole('button', { name: /^Autumn school break, all day/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(today.getByRole('button', { name: 'Sprint planning, 09:30 to 10:30, Work, repeats' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(today).toBeFocused();
  // Paging keeps the grid position focused.
  await page.keyboard.press('j');
  await expect(page.getByRole('gridcell', { name: /^Thursday, November 12, 2026\./ })).toBeFocused();
});

test('Month in a short window: "+N more" opens the day in a popover; right-click opens the context menu', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto(`${MOCKUP}#/month/2026/11`);
  const today = page.getByRole('gridcell', { name: /^Thursday, October 12, 2026\./ });
  const more = today.getByRole('button', { name: /more events? on Thursday, October 12, 2026$/ });
  await expect(more).toBeVisible();
  await more.click();
  const popover = page.getByRole('dialog', { name: 'Thursday, October 12' });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('button', { name: '15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();

  await page.getByRole('gridcell', { name: /^Monday, October 9, 2026\./ }).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['New event', 'Open day', 'Day details']);
  await menu.getByRole('menuitem', { name: 'Open day' }).click();
  await expect(page).toHaveURL(/#\/day\/2026-10-16$/);
});

test('phone: Month in the dots density with the selected day list; the List toggle', async ({ page }) => {
  await page.setViewportSize(SIZES.phone);
  await page.goto(`${MOCKUP}#/month/2026/11`);
  const grid = page.getByRole('grid', { name: 'October 2026' });
  await expect(grid).toHaveAttribute('data-density', 'dots');
  await expect(page.getByRole('region', { name: 'Thursday, October 12' }).getByRole('button')).toHaveCount(7);
  await page.getByRole('button', { name: 'List' }).click();
  await expect(page).toHaveURL(/#\/list\/2026-10-19$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Upcoming');
});

test('accessibility text size: Month becomes a list of days with empty runs (§2.4)', async ({ page }) => {
  await page.setViewportSize(SIZES.phone);
  await page.goto(`${MOCKUP}#/month/2026/11`);
  await page.addStyleTag({ content: 'html { font-size: 24px !important; }' });
  await page.setViewportSize({ width: 391, height: 844 }); // a resize re-reads the text size
  await expect(page.getByRole('button', { name: 'No events, October 21 to October 23' })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'October 2026' })).toHaveCount(0);
});

test('#/subscribe?url= never keeps the link in the address or the history', async ({ page }) => {
  await page.goto(`${MOCKUP}#/subscribe?url=${encodeURIComponent('https://calendar.example/private-abc/basic.ics')}`);
  await expect(page).toHaveURL(/#\/month\/2026\/11\?day=2026-10-19$/);
  expect(await page.evaluate(() => window.location.href)).not.toContain('private-abc');
});
