import { type Page, expect, test } from '@playwright/test';

/**
 * Behaviour the web review found missing or broken, in a real browser (docs/EVENTS.md §2.4, §2.11, §2.19,
 * §2.20, §2.21), on the mockup data set (§6.7) with today fixed to Monday, October 19, 2026 09:41 (IFC
 * Thursday, October 12): bar titles across the cells they cover, Delete on focused rows, keyboard help,
 * the section switch as a next action, and time fields wide enough for the 12-hour form.
 */

const MOCKUP = '/?store=mockup';

test.use({ locale: 'en-GB', timezoneId: 'Europe/Tallinn', reducedMotion: 'reduce' });

const chip = (page: Page, eventId: string) => page.locator(`[data-key^="${eventId}|"]`).first();

test('Month: a bar title runs across the cells its bar covers in the row (§2.4, boards A1, A2)', async ({ page }) => {
  for (const width of [600, 1100]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
    await expect(page.getByRole('grid', { name: 'October 2026' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const titles = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[class*="barTitle"]')].map((title) => ({
        text: title.textContent ?? '',
        span: Number(title.style.getPropertyValue('--span') || '1'),
        width: title.getBoundingClientRect().width,
        cell: (title.closest('[role="gridcell"]') ?? title.parentElement!).getBoundingClientRect().width,
      })),
    );
    const spanning = titles.filter((title) => title.span > 1);
    expect(spanning.length, `bars over several cells at ${width} px`).toBeGreaterThan(0);
    for (const title of spanning) expect(title.width, `${title.text} at ${width} px`).toBeGreaterThan(title.cell * 1.5);
  }
});

test('Delete or Backspace on a focused row: List, and the rows of "+N more" (§2.4, §2.21)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${MOCKUP}#/list/2026-10-19`);
  const row = page.getByRole('button', { name: /^15:40, Dentist, Dr\. Tamm/ }).first();
  await row.focus();
  await page.keyboard.press('Delete');
  const asked = page.getByRole('alertdialog', { name: 'Delete this event?' });
  await expect(asked).toBeVisible();
  await asked.getByRole('button', { name: 'Cancel' }).click();
  await expect(asked).toBeHidden();

  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto(`${MOCKUP}#/month/2026/11`);
  const today = page.getByRole('gridcell', { name: /^Thursday, October 12, 2026\./ });
  await today.getByRole('button', { name: /more events? on Thursday, October 12, 2026$/ }).click();
  const popover = page.getByRole('dialog', { name: 'Thursday, October 12' });
  const inPopover = popover.getByRole('button', { name: '15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18' });
  await inPopover.focus();
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('alertdialog', { name: 'Delete this event?' })).toBeVisible();
});

test('"?" opens the keyboard help, which lists the web keys of §2.21; Settings opens it too', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
  await expect(page.getByRole('grid', { name: 'October 2026' })).toBeVisible();
  await page.keyboard.press('Shift+Slash');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help.getByRole('rowheader', { name: 'Delete selected event' })).toBeVisible();
  await expect(help.getByRole('cell', { name: 'Delete or Backspace' })).toBeVisible();
  expect(await help.innerText()).not.toMatch(/[–—]/);
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  await page.goto(`${MOCKUP}#/settings`);
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('another section is a next action: the Undo toast closes and the delete is written (§2.11)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
  await chip(page, 'home/dentist').dblclick();
  await page.getByRole('dialog', { name: 'Dentist, Dr. Tamm' }).getByRole('button', { name: 'Delete event' }).click();
  await page.getByRole('alertdialog', { name: 'Delete this event?' }).getByRole('button', { name: 'Delete event' }).click();
  await expect(page.getByText('Event deleted.').first()).toBeVisible();
  await page.getByRole('link', { name: /Today/ }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
});

test('the editor time fields hold the 12-hour form with the picker icon (§2.19, en-US)', async ({ browser, browserName }) => {
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Europe/Tallinn', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
  await chip(page, 'home/dentist').dblclick();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const inputs = page.getByRole('dialog', { name: 'Edit event' }).locator('input[type="time"]');
  await inputs.first().fill('12:30');
  // "12:30 PM" and the picker icon need about 9 em in Firefox; 7.5 em cut "PM" to "F" there (review, Firefox 157).
  const sizes = await inputs.evaluateAll((list) =>
    list.map((input) => ({ width: input.getBoundingClientRect().width, em: Number.parseFloat(getComputedStyle(input).fontSize) })),
  );
  for (const size of sizes) expect(size.width / size.em, browserName).toBeGreaterThanOrEqual(9);
  await context.close();
});
