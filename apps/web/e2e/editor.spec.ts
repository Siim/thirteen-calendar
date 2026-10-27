import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Event details, the editor, the 13-month date field, the repeat picker, span and delete questions,
 * and undo in a real browser (docs/EVENTS.md §2.10 to §2.14, §2.20), on the mockup data set (§6.7)
 * with today fixed to Monday, October 19, 2026 09:41 (IFC Thursday, October 12).
 * `SHOTS_DIR=/some/dir` saves the screens there.
 */

const MONTH = '/?store=mockup#/month/2026/11?day=2026-10-19';
const SHOTS_DIR = process.env.SHOTS_DIR ?? '';

test.use({ locale: 'en-GB', timezoneId: 'Europe/Tallinn', reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS_DIR === '') return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
}

async function seriousAxe(page: Page, selector: string): Promise<string[]> {
  const axe = await new AxeBuilder({ page }).include(selector).disableRules(['label-content-name-mismatch']).analyze();
  return axe.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

async function openMonth(page: Page): Promise<void> {
  await page.goto(MONTH);
  await page.locator('[data-key^="home/dentist"]').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}

const chip = (page: Page, eventId: string) => page.locator(`[data-key^="${eventId}|"]`).first();
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test('details: both calendars, the rows and the actions (board A2)', async ({ page }) => {
  await openMonth(page);
  await chip(page, 'home/dentist').dblclick();
  const details = page.getByRole('dialog', { name: 'Dentist, Dr. Tamm' });
  await expect(details).toBeVisible();
  await expect(details.getByText('Thursday, October 12, 2026')).toBeVisible();
  await expect(details.getByText('Gregorian Monday, October 19, 2026')).toBeVisible();
  await expect(details.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Delete event' })).toBeVisible();
  expect(await seriousAxe(page, '[role="dialog"]')).toEqual([]);
  await shot(page, 'e2e-details');
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
});

test('editor: the 13-month date picker by keyboard, Save, and focus back on the event', async ({ page }) => {
  await openMonth(page);
  await chip(page, 'home/dentist').dblclick();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await expect(editor).toBeVisible();
  expect(await seriousAxe(page, 'dialog[open]')).toEqual([]);

  await editor.getByRole('button', { name: /^Starts, / }).click();
  // The picker's own grid (the Month grid behind the editor has selected cells too).
  const picker = page.getByRole('tabpanel');
  const selected = picker.getByRole('gridcell', { selected: true });
  await expect(selected).toHaveAccessibleName('Thursday, October 12. Gregorian Monday, October 19');
  await selected.focus();
  await page.keyboard.press('ArrowRight');
  await expect(picker.getByRole('gridcell', { selected: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(editor.getByRole('button', { name: /^Starts, / })).toHaveAccessibleName(
    'Starts, IFC Friday, October 13, 2026. Gregorian Tuesday, October 20, 2026',
  );
  await shot(page, 'e2e-editor-moved');

  await page.keyboard.press(`${mod}+Enter`);
  await expect(editor).toBeHidden();
  await expect(page.getByText('Event saved.').first()).toBeVisible();
  await expect(page.locator('[data-key^="home/dentist|"]').first()).toBeFocused();
});

test('editor: errors under their fields, and Discard asks first', async ({ page }) => {
  await openMonth(page);
  await chip(page, 'home/dentist').dblclick();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  const end = editor.locator('input[type="time"]').nth(1);
  await end.fill('15:00');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor.getByText('The end must be after the start.').first()).toBeVisible();
  await expect(end).toBeFocused();
  await expect(end).toHaveAttribute('aria-invalid', 'true');

  await page.keyboard.press('Escape');
  const discard = page.getByRole('alertdialog', { name: 'Discard changes?' });
  await expect(discard).toBeVisible();
  await expect(discard.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await discard.getByRole('button', { name: 'Discard changes' }).click();
  await expect(editor).toBeHidden();
});

test('repeating events: the span question, then this event only', async ({ page }) => {
  await openMonth(page);
  await chip(page, 'home/book-club').dblclick();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await editor.getByRole('button', { name: /^Repeat/ }).click();
  const list = page.getByRole('radiogroup', { name: 'Repeat' });
  await expect(list.getByRole('radio', { name: 'Every IFC month on the 12th' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await editor.locator('input[type="time"]').first().fill('19:30');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const asked = page.getByRole('alertdialog', { name: 'This is a repeating event.' });
  await expect(asked.getByRole('button')).toHaveText(['Save for this event only', 'Save for future events', 'Cancel']);
  await shot(page, 'e2e-span-question');
  await asked.getByRole('button', { name: 'Save for this event only' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText('Event saved.').first()).toBeVisible();
});

test('delete: the question, the toast, and Undo by keyboard', async ({ page }) => {
  await openMonth(page);
  await chip(page, 'home/dentist').dblclick();
  await page.getByRole('dialog', { name: 'Dentist, Dr. Tamm' }).getByRole('button', { name: 'Delete event' }).click();
  const asked = page.getByRole('alertdialog', { name: 'Delete this event?' });
  await expect(asked.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await asked.getByRole('button', { name: 'Delete event' }).click();
  await expect(page.locator('[data-key^="home/dentist|"]')).toHaveCount(0);
  await expect(page.getByText('Event deleted.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator('[data-key^="home/dentist|"]').first()).toBeVisible();
  await expect(page.locator('[data-key^="home/dentist|"]').first()).toBeFocused();
});

test('a deep link while a changed editor is open asks first; Keep editing keeps the view, Discard follows the link (§2.11)', async ({ page }) => {
  await openMonth(page);
  await chip(page, 'home/dentist').dblclick();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await editor.getByLabel('Title').fill('Dentist, moved');
  const opened = await page.evaluate(() => location.hash);
  // What a notification click or a pasted link does: a new address in this tab.
  await page.evaluate(() => {
    location.hash = '#/day/2026-10-25';
  });
  const asked = page.getByRole('alertdialog', { name: 'Discard changes?' });
  await expect(asked).toBeVisible();
  // The calendar under the editor stays where it was while the question is open.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(opened);
  await asked.getByRole('button', { name: 'Keep editing' }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Title')).toHaveValue('Dentist, moved');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(opened);
  await expect(page.locator('[data-key^="home/dentist|"]').first()).toBeAttached();

  await page.evaluate(() => {
    location.hash = '#/day/2026-10-25';
  });
  await asked.getByRole('button', { name: 'Discard changes' }).click();
  await expect(editor).toBeHidden();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/day/2026-10-25');
  // Nothing was saved.
  await expect(page.getByText('Dentist, moved')).toHaveCount(0);
});

test('the date picker at 24 px text opens its day list on the selected day (§2.12, board J4)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium can set the default font size from a test');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 24, fixed: 24 } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(MONTH);
  const row = page.locator('[data-key^="work/sprint-planning|2026-10-19"]:visible').first();
  await row.waitFor();
  await page.evaluate(() => document.fonts.ready);
  await row.click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await editor.getByRole('button', { name: /^Starts, / }).click();
  const list = page.getByRole('listbox', { name: 'October 2026' });
  const selected = list.getByRole('option', { selected: true });
  await expect(selected).toHaveAccessibleName('Thursday, October 12. Gregorian Monday, October 19. Today');
  await expect(selected).toBeInViewport({ ratio: 1 });
  await expect(list.getByRole('option', { name: /^Sunday, October 1\./ })).not.toBeInViewport();
  await shot(page, 'e2e-date-picker-24px');
});
