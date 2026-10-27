import process from 'node:process';
import { type Page, expect, test } from '@playwright/test';

/**
 * Flows of the §6.5 e2e list that the other specs leave out (task B8): a keyboard-only create on the
 * real IndexedDB store that survives a reload, "future events" from the editor, and the discard
 * question on browser Back (docs/EVENTS.md §2.11, §2.21).
 */

test.use({ locale: 'en-GB', timezoneId: 'Europe/Tallinn', reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });

const MOCKUP = '/?store=mockup';
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function ready(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('grid', { name })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test('keyboard only: C opens a new event, typing and Ctrl+Enter save it, and it is still there after a reload', async ({ page }) => {
  // The IndexedDB store of a fresh browser, with today pinned to Monday, October 19, 2026.
  await page.goto('/?today=2026-10-19#/month/2026/11?day=2026-10-21');
  await ready(page, 'October 2026');
  await page.keyboard.press('c');
  const editor = page.getByRole('dialog', { name: 'New event' });
  await expect(editor).toBeVisible();
  const title = editor.getByRole('textbox', { name: 'Title' });
  await expect(title).toBeFocused();
  await page.keyboard.type('Budget review');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(editor).toBeHidden();
  const created = page.locator('[data-key]').filter({ hasText: 'Budget review' }).first();
  await expect(created).toBeVisible();
  await expect(created).toBeFocused();
  // Enter opens it; Escape closes it again and focus comes back.
  await page.keyboard.press('Enter');
  const details = page.getByRole('dialog', { name: 'Budget review' });
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();

  await page.reload();
  await ready(page, 'October 2026');
  await expect(page.locator('[data-key]').filter({ hasText: 'Budget review' }).first()).toBeVisible();
});

test('the editor: "Save for future events" changes this and later events and keeps earlier ones', async ({ page }) => {
  // IFC November 12 (Gregorian November 16) is the book club's next meeting after today's.
  await page.goto(`${MOCKUP}#/month/2026/12?day=2026-11-16`);
  await ready(page, 'November 2026');
  await page.locator('[data-key^="home/book-club|"]').first().dblclick();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await editor.locator('input[type="time"]').first().fill('19:30');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const asked = page.getByRole('alertdialog', { name: 'This is a repeating event.' });
  await asked.getByRole('button', { name: 'Save for future events' }).click();
  await expect(editor).toBeHidden();
  // The later part is a series of its own (a new UID, §4.7), so the chips are found by name.
  const at = (time: string) => page.getByRole('button', { name: new RegExp(`^Book club: Cotsworth, ${time} to `) });
  await expect(at('19:30')).toHaveCount(1);
  await expect(at('19:00')).toHaveCount(0);

  // Later meetings moved too; today's stays at 19:00. (The mockup store lives in the page, so the
  // months are paged with J and K rather than loaded again.)
  await page.keyboard.press('j');
  await ready(page, 'December 2026');
  await expect(at('19:30')).toHaveCount(1);
  await page.keyboard.press('k');
  await page.keyboard.press('k');
  await ready(page, 'October 2026');
  await expect(at('19:00')).toHaveCount(1);
  await expect(at('19:30')).toHaveCount(0);
});

test('browser Back in a changed editor asks to discard: Keep editing keeps the draft, Discard closes it', async ({ page }) => {
  await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
  await ready(page, 'October 2026');
  await page.getByRole('button', { name: 'New event' }).first().click();
  const editor = page.getByRole('dialog', { name: 'New event' });
  await editor.getByRole('textbox', { name: 'Title' }).fill('Kodak archive visit');

  await page.goBack();
  const discard = page.getByRole('alertdialog', { name: 'Discard this event?' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Keep editing' }).click();
  await expect(discard).toBeHidden();
  await expect(editor.getByRole('textbox', { name: 'Title' })).toHaveValue('Kodak archive visit');

  await page.goBack();
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Discard event' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('grid', { name: 'October 2026' })).toBeVisible();
  await expect(page.locator('[data-key]').filter({ hasText: 'Kodak archive visit' })).toHaveCount(0);
});
