import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/** The primitives in a real browser: top layer, showModal(), the Popover API, Escape, focus. */

const log = (page: Page) => page.getByTestId('log');

async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active ? `${active.tagName.toLowerCase()}:${active.getAttribute('aria-label') ?? active.textContent?.trim() ?? ''}` : '';
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/primitives.html');
  await expect(page.getByRole('heading', { name: 'Primitives' })).toBeVisible();
});

/**
 * Opens with the keyboard: Safari (WebKit) does not focus a button on click, so focus can
 * only come back to an opener that had it, which is the case focus return is for.
 */
async function press(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).focus();
  await page.keyboard.press('Enter');
}

test('Dialog: modal in the top layer, Escape asks the discard question, focus comes back', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'New event' });
  await press(page, 'New event');
  const editor = page.getByRole('dialog', { name: 'New event' });
  await expect(editor).toBeVisible();
  expect(await editor.evaluate((node) => node.matches(':modal'))).toBe(true);
  await expect(page.getByLabel('Title')).toBeFocused();
  // The page under it is covered by the backdrop: a press there lands on the <dialog>.
  expect(await page.evaluate(() => document.elementFromPoint(5, 5)?.tagName)).toBe('DIALOG');

  // Unchanged: Escape closes at once.
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(opener).toBeFocused();

  // Changed: Escape asks first, and the editor stays.
  await press(page, 'New event');
  await page.getByLabel('Title').fill('Dentist');
  await page.keyboard.press('Escape');
  const question = page.getByRole('alertdialog', { name: 'Discard this event?' });
  await expect(question).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Dentist');
  // A second Escape right away: Chrome may refuse to let it be canceled; the editor must survive it.
  await page.keyboard.press('Escape');
  await expect(question).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'New event' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'New event' })).toBeVisible();
  await page.getByRole('dialog', { name: 'New event' }).getByRole('button', { name: 'Close' }).click();
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('Popover inside the dialog: placed under its anchor, takes Escape before the dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'New event' }).click();
  const anchor = page.getByRole('button', { name: 'IFC Thu, Oct 12, 2026' });
  await anchor.click();
  const picker = page.getByRole('dialog', { name: 'Choose a date' });
  await expect(picker).toBeVisible();
  expect(await picker.evaluate((node) => node.matches(':popover-open'))).toBe(true);
  const a = (await anchor.boundingBox())!;
  const p = (await picker.boundingBox())!;
  expect(p.y).toBeGreaterThanOrEqual(a.y + a.height);
  expect(Math.abs(p.x - a.x)).toBeLessThanOrEqual(2);
  await expect(page.getByRole('button', { name: 'Thursday, October 12, 2026' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'New event' })).toBeVisible();
  await expect(anchor).toBeFocused();
  await expect(log(page)).toContainText('picker closed: escape');
  await expect(log(page)).not.toContainText('editor close requested');
});

test('Popover opened while its dialog is still animating in is placed again when the animation ends', async ({ page }) => {
  // B8 (2026-10-26): a Firefox run under load opened the date picker during the dialog's opening
  // animation (translateY and scale), and the picker stayed 2 to 5 px off its anchor for good.
  // A 1.5 s animation makes that moment certain.
  await page.addStyleTag({ content: 'dialog, dialog * { animation-duration: 1.5s !important; }' });
  await page.getByRole('button', { name: 'New event' }).click({ noWaitAfter: true });
  const anchor = page.getByRole('button', { name: 'IFC Thu, Oct 12, 2026' });
  await anchor.evaluate((element) => (element as HTMLElement).click());
  const picker = page.getByRole('dialog', { name: 'Choose a date' });
  await expect(picker).toBeVisible();
  await page.waitForTimeout(2000);
  const a = (await anchor.boundingBox())!;
  const p = (await picker.boundingBox())!;
  expect(Math.abs(p.x - a.x)).toBeLessThanOrEqual(1);
  expect(p.y).toBeGreaterThanOrEqual(a.y + a.height);
  expect(p.y - (a.y + a.height)).toBeLessThanOrEqual(10);
});

test('Popover: light dismiss, arrow side, focus back to the anchor on Escape', async ({ page }) => {
  const chip = page.getByRole('button', { name: 'Sprint planning' });
  await chip.click();
  const details = page.getByRole('dialog', { name: 'Sprint planning' });
  await expect(details).toBeVisible();
  expect(await details.getAttribute('data-side')).toBe('right');
  await expect(details).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
  await expect(chip).toBeFocused();

  await chip.click();
  await page.getByRole('heading', { name: 'Primitives' }).click();
  await expect(details).toBeHidden();
  await expect(log(page)).toContainText('details closed: outside');
});

test('Menu: menu button keys, choosing gives focus back', async ({ page }) => {
  const button = page.getByRole('button', { name: 'More' });
  await button.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
  await expect(log(page)).toContainText('menu: delete');

  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
});

test('Toast: polite status text, action then Close, 32 px targets', async ({ page }) => {
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('status')).toHaveText('Event deleted. Undo available: Control Z.');
  const undo = page.getByRole('button', { name: 'Undo' });
  const close = page.getByRole('button', { name: 'Close' });
  for (const target of [undo, close]) {
    const box = (await target.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(box.height).toBeGreaterThanOrEqual(32);
  }
  // Close follows the action in the focus order (Safari's Tab skips buttons by default, so read the DOM order).
  expect(
    await undo.evaluate((node, other) => Boolean(node.compareDocumentPosition(other as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await close.elementHandle()),
  ).toBe(true);
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(undo).toBeHidden();
  await expect(log(page)).toContainText('toast closed: close-button');
});

for (const [palette, theme] of [
  ['almanac', 'light'],
  ['almanac', 'dark'],
  ['obsidian', 'dark'],
] as const) {
  test(`no serious axe violations with every primitive open (${palette} ${theme})`, async ({ page }) => {
    await page.goto(`/dev/primitives.html?palette=${palette}&theme=${theme}`);
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Sprint planning' }).click();
    await expect(page.getByRole('dialog', { name: 'Sprint planning' })).toBeVisible();
    const popover = await new AxeBuilder({ page }).analyze();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'New event' }).click();
    await page.getByRole('button', { name: 'IFC Thu, Oct 12, 2026' }).click();
    const dialog = await new AxeBuilder({ page }).analyze();
    const serious = [...popover.violations, ...dialog.violations].filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}
