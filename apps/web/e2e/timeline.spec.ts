import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page, expect, test } from '@playwright/test';

/**
 * Week and Day timelines and drag and drop in a real browser (docs/EVENTS.md §2.2, §2.4 to §2.6,
 * §2.11 "Drag edits", §2.20, §2.21), on the mockup data set (§6.7) with today fixed to Monday,
 * October 19, 2026 09:41 (IFC Thursday, October 12). `SHOTS_DIR=/some/dir` saves the screens there.
 */

const MOCKUP = '/?store=mockup';
const SHOTS_DIR = process.env.SHOTS_DIR ?? '';
const DESKTOP = { width: 1280, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

test.use({ locale: 'en-GB', timezoneId: 'Europe/Tallinn', reducedMotion: 'reduce' });

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  if (SHOTS_DIR === '') return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), fullPage });
}

async function visibleTextWithoutUserText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const element of clone.querySelectorAll('[data-user-text]')) element.remove();
    for (const element of clone.querySelectorAll('script, style, noscript')) element.remove();
    return clone.innerText ?? clone.textContent ?? '';
  });
}

async function seriousAxe(page: Page): Promise<string[]> {
  const axe = await new AxeBuilder({ page }).include('main').disableRules(['label-content-name-mismatch']).analyze();
  return axe.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** The open question (it sits in the top layer, outside main): axe and the no-dashes scan (task B8). */
async function checkQuestion(question: Locator): Promise<void> {
  expect(await question.innerText(), 'no en or em dash').not.toMatch(/[–—]/);
  const axe = await new AxeBuilder({ page: question.page() }).include('dialog[open]').disableRules(['label-content-name-mismatch']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

/** The point of `minute` in a timeline column (the column is the full 24 hours). */
async function pointAt(column: Locator, minute: number, dx = 30): Promise<{ x: number; y: number }> {
  const box = (await column.boundingBox())!;
  return { x: box.x + dx, y: box.y + (minute / 1440) * box.height };
}

/** A mouse drag from near the top of `source` to `to`, past the drag threshold. */
async function drag(page: Page, source: Locator, to: { x: number; y: number }, grab = 6): Promise<void> {
  const box = (await source.boundingBox())!;
  const from = { x: box.x + Math.min(24, box.width / 2), y: box.y + grab };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 });
  await page.mouse.move(to.x, to.y + grab, { steps: 10 });
  await page.mouse.up();
}

const THURSDAY = 'Thursday, October 12. Gregorian Monday, October 19';
const WEDNESDAY = 'Wednesday, October 11. Gregorian Sunday, October 18';

test.describe('Week (§2.5)', () => {
  test('columns in both calendars, blocks, the all-day row and the now line; no dashes, no serious axe violations', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const today = page.getByRole('group', { name: THURSDAY });
    await expect(today).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'October 2026, week 2' })).toBeVisible();
    await expect(page.getByText('Gregorian Oct 15 to 21')).toBeVisible();
    await expect(page.getByRole('button', { name: THURSDAY })).toHaveAttribute('aria-current', 'date');
    await expect(today.getByRole('button', { name: 'Sprint planning, 09:30 to 10:30, Work, repeats' })).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Saturday, October 14. Gregorian Wednesday, October 21' }).getByRole('button', {
        name: 'Design review prep, 13:00 to 14:15, Work',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family, continues to Gregorian Sunday, October 25',
      }),
    ).toBeVisible();
    // The now line's time sits on the axis.
    await expect(page.locator('[data-timeline] [aria-hidden="true"]').getByText('09:41', { exact: true })).toBeVisible();
    await settle(page);
    expect(await visibleTextWithoutUserText(page)).not.toMatch(/[–—]/);
    expect(await seriousAxe(page)).toEqual([]);
    await shot(page, 'week-desktop');
  });

  test('Almanac dark (board F1)', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('thirteen:theme', 'dark');
    });
    await page.setViewportSize(DESKTOP);
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    await expect(page.getByRole('group', { name: THURSDAY })).toBeVisible();
    await settle(page);
    expect(await seriousAxe(page)).toEqual([]);
    await shot(page, 'week-desktop-dark');
  });

  test('a crowded hour shows "+{n}", which lists the hidden events (board K2)', async ({ page }) => {
    // Columns of about 90 px fit one 48 px block: the two overlapping design reviews become "+2".
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const more = page.getByRole('button', { name: '2 more events at 13:00' });
    await expect(more).toBeVisible();
    await more.click();
    const list = page.getByRole('dialog', { name: '2 more events at 13:00' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('button', { name: /^13:00, Design review prep, Work/ })).toBeVisible();
    await expect(list.getByRole('button', { name: /^14:00, Design review, Work, Room Sol/ })).toBeVisible();
    await settle(page);
    await shot(page, 'week-overflow');
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(more).toBeFocused();
  });

  test('Year Day is its own column after Saturday (board F2)', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${MOCKUP}#/week/2026-12-29`);
    await expect(page.getByRole('heading', { level: 1, name: 'December 2026, week 4' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Year Day 2026, no weekday. Gregorian Thursday, December 31' })).toBeVisible();
    await settle(page);
    await shot(page, 'week-year-day');
  });

  test('keyboard: arrows move between days, Enter goes into a day’s events, Escape comes back', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const today = page.getByRole('group', { name: THURSDAY });
    await today.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('group', { name: WEDNESDAY })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(today).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /^Autumn school break, all day/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(today.getByRole('button', { name: 'Sprint planning, 09:30 to 10:30, Work, repeats' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(today.getByRole('button', { name: '1:1 with Marta, 11:00 to 11:30, Work, repeats' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(today).toBeFocused();
  });
});

test.describe('Drag and drop (§2.11 "Drag edits")', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test('a block moves to another day and time; Undo puts it back', async ({ page }) => {
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const lunch = page.getByRole('button', { name: 'Lunch with Jaan, 12:00 to 13:00, Home' });
    await expect(lunch).toBeVisible();
    await drag(page, lunch, await pointAt(page.getByRole('group', { name: WEDNESDAY }), 14 * 60));
    await expect(page.getByText('Event moved to Wednesday, October 11, 2026 at 14:00.', { exact: true })).toBeVisible();
    const moved = page.getByRole('group', { name: WEDNESDAY }).getByRole('button', { name: 'Lunch with Jaan, 14:00 to 15:00, Home' });
    await expect(moved).toBeVisible();
    await expect(moved).toBeFocused();
    await shot(page, 'week-moved');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: 'Lunch with Jaan, 12:00 to 13:00, Home' })).toBeVisible();
  });

  test('Ctrl+Z (Cmd+Z on a Mac) discards a pending move', async ({ page }) => {
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const lunch = page.getByRole('button', { name: 'Lunch with Jaan, 12:00 to 13:00, Home' });
    await drag(page, lunch, await pointAt(page.getByRole('group', { name: WEDNESDAY }), 14 * 60));
    await expect(page.getByRole('button', { name: 'Lunch with Jaan, 14:00 to 15:00, Home' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByRole('button', { name: 'Lunch with Jaan, 12:00 to 13:00, Home' })).toBeVisible();
    await expect(page.getByText('Event moved to Wednesday, October 11, 2026 at 14:00.', { exact: true })).toBeHidden();
  });

  test('a repeating occurrence asks for the span first', async ({ page }) => {
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const today = page.getByRole('group', { name: THURSDAY });
    const sprint = today.getByRole('button', { name: 'Sprint planning, 09:30 to 10:30, Work, repeats' });
    await drag(page, sprint, await pointAt(today, 14 * 60));
    const question = page.getByRole('alertdialog', { name: 'This is a repeating event.' });
    await expect(question).toBeVisible();
    await expect(question).toContainText('Move this event only, or this and all future events?');
    await expect(question.getByRole('button', { name: 'Move future events' })).toBeVisible();
    await settle(page);
    await checkQuestion(question);
    await shot(page, 'week-span-question');
    await question.getByRole('button', { name: 'Move this event only' }).click();
    await expect(page.getByText('Event moved to 14:00.', { exact: true })).toBeVisible();
    await expect(today.getByRole('button', { name: 'Sprint planning, 14:00 to 15:00, Work, repeats' })).toBeVisible();
  });

  test('moving future events to Year Day says the repeat ends before anything moves (board G4)', async ({ page }) => {
    await page.goto(`${MOCKUP}#/week/2026-12-29`);
    const friday = page.getByRole('group', { name: 'Friday, December 27. Gregorian Tuesday, December 29' });
    const yoga = friday.getByRole('button', { name: 'Yoga, 07:15 to 08:15, Running club, repeats' });
    await expect(yoga).toBeVisible();
    const yearDay = page.getByRole('group', { name: 'Year Day 2026, no weekday. Gregorian Thursday, December 31' });
    await drag(page, yoga, await pointAt(yearDay, 7 * 60 + 15, 15));
    const question = page.getByRole('alertdialog', { name: 'This is a repeating event.' });
    await expect(question).toContainText(
      'Moving future events to Year Day 2026 ends the repeat. Every later event in this series will be deleted.',
    );
    await expect(question.getByRole('button', { name: 'Move and delete later events' })).toBeVisible();
    await settle(page);
    await checkQuestion(question);
    await shot(page, 'week-year-day-question');
    await question.getByRole('button', { name: 'Cancel' }).click();
    await expect(question).toBeHidden();
    await expect(yoga).toBeVisible();
  });

  test('a block dropped on the all-day row turns all-day', async ({ page }) => {
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const dentist = page.getByRole('button', { name: 'Dentist, Dr. Tamm, 15:40 to 16:20, Home' });
    const cell = page.locator('[data-timeline-allday][data-date="2026-10-20"]');
    const box = (await cell.boundingBox())!;
    await drag(page, dentist, { x: box.x + box.width / 2, y: box.y + 4 }, 4);
    await expect(page.getByText('Event moved to Friday, October 13, 2026.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dentist, Dr. Tamm, all day, Home' })).toBeVisible();
  });

  test('a block’s bottom edge changes its end', async ({ page }) => {
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const dentist = page.getByRole('button', { name: 'Dentist, Dr. Tamm, 15:40 to 16:20, Home' });
    const box = (await dentist.boundingBox())!;
    const to = await pointAt(page.getByRole('group', { name: THURSDAY }), 17 * 60);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 10, { steps: 3 });
    await page.mouse.move(box.x + box.width / 2, to.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText('Event saved.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dentist, Dr. Tamm, 15:40 to 17:00, Home' })).toBeVisible();
  });

  test('dragging on empty time draws a draft from the range, snapped to 15 minutes', async ({ page }) => {
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const friday = page.getByRole('group', { name: 'Friday, October 13. Gregorian Tuesday, October 20' });
    const from = await pointAt(friday, 10 * 60 + 5);
    const to = await pointAt(friday, 11 * 60 + 28);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    const draft = friday.locator('[data-draft]');
    await expect(draft).toContainText('New event');
    await expect(draft).toContainText('10:00 to 11:30');
    await page.mouse.up();
    await expect(draft).toHaveCount(0);
    // The editor opens on the unsaved draft (task B5's dialog): nothing is stored before Add.
    const editor = page.getByRole('dialog', { name: 'New event' });
    await expect(editor).toBeVisible();
    await expect(editor.locator('input[type="time"]').first()).toHaveValue('10:00');
    await expect(editor.locator('input[type="time"]').nth(1)).toHaveValue('11:30');
  });

  test('Alt-drag copies: Duplicate opens at the drop and the event stays (§2.4)', async ({ page }) => {
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const lunch = page.getByRole('button', { name: 'Lunch with Jaan, 12:00 to 13:00, Home' });
    await expect(lunch).toBeVisible();
    await page.keyboard.down('Alt');
    await drag(page, lunch, await pointAt(page.getByRole('group', { name: WEDNESDAY }), 14 * 60));
    await page.keyboard.up('Alt');
    const editor = page.getByRole('dialog', { name: 'New event' });
    await expect(editor).toBeVisible();
    await expect(editor.locator('input[type="time"]').first()).toHaveValue('14:00');
    await expect(lunch).toBeVisible();
    await expect(page.getByText(/^Event moved/)).toHaveCount(0);
  });

  test('read-only events cannot be picked up', async ({ page }) => {
    await page.goto(`${MOCKUP}#/month/2026/11`);
    const halloween = page.getByRole('button', { name: /^Halloween, all day/ });
    await expect(halloween).toBeVisible();
    const target = page.getByRole('gridcell', { name: /Gregorian Monday, November 2, 2026/ });
    const box = (await target.boundingBox())!;
    await drag(page, halloween, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await expect(page.getByText(/Event moved/)).toHaveCount(0);
  });

  test('Month: a chip moves to another day with its time', async ({ page }) => {
    await page.goto(`${MOCKUP}#/month/2026/11`);
    const dentist = page.getByRole('button', { name: 'Dentist, Dr. Tamm, 15:40 to 16:20, Home' });
    await expect(dentist).toBeVisible();
    const cell = page.getByRole('gridcell', { name: /^Friday, October 13, 2026/ });
    const box = (await cell.boundingBox())!;
    const from = (await dentist.boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + 6);
    await page.mouse.down();
    await page.mouse.move(from.x + 28, from.y + 14, { steps: 3 });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
    // The day under the pointer is marked and a drag image follows the pointer.
    await expect(cell).toHaveAttribute('data-drop-target', '');
    await shot(page, 'month-dragging');
    await page.mouse.up();
    await expect(cell).not.toHaveAttribute('data-drop-target', /.*/);
    await expect(page.getByText('Event moved to Friday, October 13, 2026.', { exact: true })).toBeVisible();
    await expect(cell.getByRole('button', { name: 'Dentist, Dr. Tamm, 15:40 to 16:20, Home' })).toBeVisible();
  });

  test('compact Month: a row of the day list moves onto a cell', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(`${MOCKUP}#/month/2026/11`);
    const row = page.getByRole('button', { name: /^15:40, Dentist, Dr\. Tamm, Home/ });
    await expect(row).toBeVisible();
    const cell = page.getByRole('gridcell', { name: /^Friday, October 13, 2026/ });
    // The week row with the target day at the top of the window, the day list under it.
    await cell.evaluate((element) => window.scrollBy(0, element.getBoundingClientRect().top - 16));
    const box = (await cell.boundingBox())!;
    await drag(page, row, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await expect(page.getByText('Event moved to Friday, October 13, 2026.', { exact: true })).toBeVisible();
  });
});

test.describe('Day (§2.6)', () => {
  test('desktop: the week strip, the all-day row, the timeline and the day’s comparison', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${MOCKUP}#/day/2026-10-19`);
    const column = page.getByRole('group', { name: THURSDAY });
    await expect(column.getByRole('button', { name: 'Dentist, Dr. Tamm, 15:40 to 16:20, Home' })).toBeVisible();
    await expect(page.getByRole('button', { name: THURSDAY, pressed: true })).toBeVisible();
    await expect(page.getByText('Day 1 of 7')).toBeVisible();
    await settle(page);
    expect(await visibleTextWithoutUserText(page)).not.toMatch(/[–—]/);
    expect(await seriousAxe(page)).toEqual([]);
    await shot(page, 'day-desktop');
    // The strip changes the day.
    await page.getByRole('button', { name: 'Friday, October 13. Gregorian Tuesday, October 20' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Friday, October 13, 2026' })).toBeVisible();
  });

  test('phone: a tap on empty time draws the "New event" placeholder; a tap elsewhere removes it', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(`${MOCKUP}#/day/2026-10-19`);
    const column = page.getByRole('group', { name: THURSDAY });
    await expect(column.getByRole('button', { name: /^Sprint planning/ })).toBeVisible();
    // The page scrolls the timeline to the top of the window; the timeline scrolls the hours.
    await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-timeline]')!.getBoundingClientRect().top + window.scrollY));
    const point = await pointAt(column, 13 * 60 + 10, 40);
    await page.mouse.click(point.x, point.y);
    const placeholder = page.getByRole('button', { name: 'New event, 13:00 to 14:00' });
    await expect(placeholder).toBeVisible();
    await settle(page);
    expect(await seriousAxe(page)).toEqual([]);
    await shot(page, 'day-phone');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(placeholder).toHaveCount(0);
  });
});

test.describe('Day on a touch screen (§2.6)', () => {
  test.use({ hasTouch: true });

  test('a tap draws the placeholder, a second tap on it opens the editor; a tap on an event removes it', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(`${MOCKUP}#/day/2026-10-19`);
    const column = page.getByRole('group', { name: THURSDAY });
    await expect(column.getByRole('button', { name: /^Sprint planning/ })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-timeline]')!.getBoundingClientRect().top + window.scrollY));
    // After a touch, Chromium and WebKit hit-test the tap's click after `pointerup`: the first tap
    // must leave the placeholder on screen, not open the editor through it.
    const first = await pointAt(column, 13 * 60 + 10, 40);
    await page.touchscreen.tap(first.x, first.y);
    const placeholder = page.getByRole('button', { name: 'New event, 13:00 to 14:00' });
    await expect(placeholder).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // A tap on an event removes it.
    const marta = column.getByRole('button', { name: /^1:1 with Marta/ });
    const box = (await marta.boundingBox())!;
    await page.touchscreen.tap(box.x + 40, box.y + box.height / 2);
    await expect(placeholder).toHaveCount(0);
    // A tap on empty time again, then a tap on the placeholder: the editor, one hour at that half hour.
    const again = await pointAt(column, 14 * 60 + 40, 40);
    await page.touchscreen.tap(again.x, again.y);
    const second = page.getByRole('button', { name: 'New event, 14:30 to 15:30' });
    await expect(second).toBeVisible();
    const at = (await second.boundingBox())!;
    await page.touchscreen.tap(at.x + 20, at.y + 10);
    const editor = page.getByRole('dialog', { name: 'New event' });
    await expect(editor).toBeVisible();
    await expect(editor.locator('input[type="time"]').first()).toHaveValue('14:30');
    await expect(editor.locator('input[type="time"]').nth(1)).toHaveValue('15:30');
  });
});

test.describe('Timeline fixes (task B4 re-check)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test('an all-day bar moves by the days the pointer moves from the day it was grabbed', async ({ page }) => {
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const bar = page.getByRole('button', { name: /^Autumn school break, all day, from Gregorian Monday, October 19/ });
    await expect(bar).toBeVisible();
    // The bar covers Thursday to Saturday; grabbed over Saturday and dropped on Friday it moves one day earlier.
    const saturday = (await page.locator('[data-timeline-allday][data-date="2026-10-21"]').boundingBox())!;
    const friday = (await page.locator('[data-timeline-allday][data-date="2026-10-20"]').boundingBox())!;
    const y = (await bar.boundingBox())!.y + 8;
    await page.mouse.move(saturday.x + saturday.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(saturday.x + saturday.width / 2 - 8, y + 2, { steps: 3 });
    await page.mouse.move(friday.x + friday.width / 2, y, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByText('Event moved to Wednesday, October 11, 2026.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Autumn school break, all day, from Gregorian Sunday, October 18 to Saturday, October 24/ })).toBeVisible();
  });

  test('a row dragged out of the "+{n}" list moves; the list closes with its block and focus goes to the moved event', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const more = page.getByRole('button', { name: '2 more events at 13:00' });
    await more.click();
    const list = page.getByRole('dialog', { name: '2 more events at 13:00' });
    await expect(list).toBeVisible();
    const row = list.getByRole('button', { name: /^13:00, Design review prep/ });
    // A row has no time under the pointer: the event starts where it is dropped.
    await drag(page, row, await pointAt(page.getByRole('group', { name: 'Friday, October 13. Gregorian Tuesday, October 20' }), 10 * 60 - 6, 20));
    await expect(page.getByText('Event moved to Friday, October 13, 2026 at 10:00.', { exact: true })).toBeVisible();
    await expect(list).toBeHidden();
    await expect(more).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Design review prep, 10:00 to 11:15, Work' })).toBeFocused();
  });

  test('Day on Year Day: the one column takes the timeline’s whole width (§2.6)', async ({ page }) => {
    await page.goto(`${MOCKUP}#/day/2026-12-31`);
    const column = page.getByRole('group', { name: 'Year Day 2026, no weekday. Gregorian Thursday, December 31' });
    await expect(column).toBeVisible();
    const timeline = (await page.locator('[data-timeline="day"]').boundingBox())!;
    const width = (await column.boundingBox())!.width;
    // Everything but the hour labels (3.6rem) and the scrollbar gutter.
    expect(width).toBeGreaterThan(timeline.width - 90);
    await settle(page);
    await shot(page, 'day-year-day');
  });

  test('block titles start at the top of the block; headers put the weekday over the day (boards F1, F2)', async ({ page }) => {
    await page.goto(`${MOCKUP}#/week/2026-10-19`);
    const run = page.getByRole('button', { name: 'Long run, 08:00 to 10:00, Running club' });
    await expect(run).toBeVisible();
    const block = (await run.boundingBox())!;
    const title = (await run.getByText('Long run', { exact: true }).boundingBox())!;
    expect(title.y - block.y).toBeLessThan(8);
    const header = page.getByRole('button', { name: THURSDAY });
    const weekday = (await header.getByText('Thu', { exact: true }).boundingBox())!;
    const day = (await header.getByText('12', { exact: true }).boundingBox())!;
    expect(day.y).toBeGreaterThanOrEqual(weekday.y + weekday.height - 1);
  });
});
