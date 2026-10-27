import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page, expect, test } from '@playwright/test';

/**
 * The web QA pass of task B8 (docs/EVENTS.md §6.5 B8, §2.19, §2.20, §8.3 item 3): every view and every
 * dialog at phone and desktop width in Almanac light, Almanac dark and the always-dark Obsidian theme,
 * each with the no-dashes text scan and an axe scan of the whole page with no serious or critical
 * violation, and the event views again in forced colors where the browser can emulate them.
 * On the mockup data set (§6.7), today Monday, October 19, 2026 09:41 in Tallinn (IFC Thursday,
 * October 12). `SHOTS_DIR=/some/dir` saves every screen there (Chromium only, so one set per run).
 */

const MOCKUP = '/?store=mockup';
const SHOTS_DIR = process.env.SHOTS_DIR ?? '';

const SIZES = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 900 },
} as const;
type Size = keyof typeof SIZES;

const THEMES = [
  { id: 'almanac-light', palette: 'almanac', mode: 'light' },
  { id: 'almanac-dark', palette: 'almanac', mode: 'dark' },
  { id: 'obsidian', palette: 'obsidian', mode: 'dark' },
] as const;
type Theme = (typeof THEMES)[number];

test.use({ locale: 'en-GB', timezoneId: 'Europe/Tallinn', reducedMotion: 'reduce' });

const chip = (page: Page, eventId: string): Locator => page.locator(`[data-key^="${eventId}|"]`).first();

interface View {
  readonly id: string;
  readonly hash: string;
  /** Something that is there once the view has drawn its data. */
  readonly ready: (page: Page, size: Size) => Locator;
}

const VIEWS: readonly View[] = [
  { id: 'today', hash: '#/today', ready: (page) => page.getByRole('region', { name: 'Up next' }) },
  { id: 'calendar-year', hash: '#/year/2026', ready: (page) => page.getByRole('grid', { name: 'October 2026 (IFC)' }) },
  { id: 'calendar-month', hash: '#/month/2026/11?day=2026-10-19', ready: (page) => page.getByRole('grid', { name: 'October 2026' }) },
  // On phones Week opens as Day (§2.1).
  { id: 'calendar-week', hash: '#/week/2026-10-19', ready: (page) => chip(page, 'work/sprint-planning') },
  { id: 'calendar-day', hash: '#/day/2026-10-19', ready: (page) => chip(page, 'home/dentist') },
  { id: 'calendar-list', hash: '#/list/2026-10-19', ready: (page) => page.getByRole('heading', { name: 'October 2026', level: 2 }) },
  { id: 'year-day-sheet', hash: '#/year/2026?day=2026-10-19', ready: (page) => page.getByRole('link', { name: 'Open in Calendar' }) },
  { id: 'settings', hash: '#/settings', ready: (page) => page.getByRole('heading', { name: 'Settings', level: 1 }) },
  { id: 'convert', hash: '#/convert?date=2026-10-19', ready: (page) => page.getByRole('heading', { level: 1 }) },
  { id: 'compare', hash: '#/compare/2026', ready: (page) => page.getByRole('heading', { level: 1 }) },
  { id: 'history', hash: '#/history', ready: (page) => page.getByRole('heading', { level: 1 }) },
];

async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript(
    ([palette, mode]) => {
      window.localStorage.setItem('thirteen:palette', palette);
      window.localStorage.setItem('thirteen:theme', mode);
    },
    [theme.palette, theme.mode] as const,
  );
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

/** Visible text without the user's and other apps' text (§2.19): no en dash or em dash. */
async function visibleTextWithoutUserText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const element of clone.querySelectorAll('[data-user-text], script, style, noscript')) element.remove();
    return clone.innerText ?? clone.textContent ?? '';
  });
}

/**
 * Serious and critical axe violations of the whole page (or of `include`). `label-content-name-mismatch`
 * (experimental) stays off as in the other specs: the §2.20 labels put the full date or the time first
 * by design. In forced colors the browser draws the system colours, so contrast is the browser's.
 */
async function seriousAxe(page: Page, include?: string, extraDisabled: readonly string[] = []): Promise<string[]> {
  let builder = new AxeBuilder({ page }).disableRules(['label-content-name-mismatch', ...extraDisabled]);
  if (include !== undefined) builder = builder.include(include);
  const axe = await builder.analyze();
  return axe.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

async function shot(page: Page, browserName: string, name: string): Promise<void> {
  if (SHOTS_DIR === '' || browserName !== 'chromium') return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
}

async function check(page: Page, browserName: string, name: string, include?: string): Promise<void> {
  await settle(page);
  expect(await visibleTextWithoutUserText(page), 'no en or em dash in the text Thirteen shows').not.toMatch(/[–—]/);
  expect(await seriousAxe(page, include)).toEqual([]);
  await shot(page, browserName, name);
}

for (const theme of THEMES) {
  for (const size of Object.keys(SIZES) as Size[]) {
    test.describe(`${theme.id} at ${size} width`, () => {
      test.beforeEach(async ({ page, browserName }) => {
        // CI keeps its time down: Firefox and WebKit check Almanac light there; locally every browser
        // runs every theme.
        test.skip(Boolean(process.env.CI) && browserName !== 'chromium' && theme.id !== 'almanac-light', 'Chromium checks the other themes on CI');
        await useTheme(page, theme);
        await page.setViewportSize(SIZES[size]);
      });

      for (const view of VIEWS) {
        test(`${view.id}: no dashes, no serious axe violations`, async ({ page, browserName }) => {
          // Year is thirteen month tables: axe takes long on it in Firefox on a busy machine.
          test.slow(view.id.startsWith('calendar-year') || view.id === 'year-day-sheet' || view.id === 'compare');
          await page.goto(`${MOCKUP}${view.hash}`);
          await expect(view.ready(page, size)).toBeVisible();
          // The theme really is in force (an always-dark theme is dark whatever the stored mode).
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme.mode);
          await check(page, browserName, `${view.id}-${size}-${theme.id}`);
        });
      }

      test('event details, the editor and its pickers', async ({ page, browserName }) => {
        test.slow();
        if (size === 'desktop') {
          await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
          await chip(page, 'home/dentist').dblclick();
        } else {
          await page.goto(`${MOCKUP}#/list/2026-10-19`);
          await chip(page, 'home/dentist').click();
        }
        const details = page.getByRole('dialog', { name: 'Dentist, Dr. Tamm' });
        await expect(details).toBeVisible();
        await check(page, browserName, `details-${size}-${theme.id}`);

        await details.getByRole('button', { name: 'Edit', exact: true }).click();
        const editor = page.getByRole('dialog', { name: 'Edit event' });
        await expect(editor).toBeVisible();
        await check(page, browserName, `editor-${size}-${theme.id}`);

        await editor.getByRole('button', { name: /^Starts, / }).click();
        await expect(page.getByRole('tabpanel')).toBeVisible();
        await check(page, browserName, `date-picker-${size}-${theme.id}`);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('tabpanel')).toBeHidden();

        await editor.getByRole('button', { name: /^Repeat/ }).first().click();
        await expect(page.getByRole('radiogroup', { name: 'Repeat' })).toBeVisible();
        await check(page, browserName, `repeat-picker-${size}-${theme.id}`);
      });

      test('new event, subscribe and the calendars list', async ({ page, browserName }) => {
        await page.goto(`${MOCKUP}#/new-event?date=2026-10-21`);
        await expect(page.getByRole('dialog', { name: 'New event' })).toBeVisible();
        await check(page, browserName, `new-event-${size}-${theme.id}`);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { name: 'New event' })).toBeHidden();

        await page.goto(`${MOCKUP}#/subscribe`);
        const subscribe = page.getByRole('dialog', { name: 'Subscribe to a calendar' });
        await expect(subscribe).toBeVisible();
        await check(page, browserName, `subscribe-${size}-${theme.id}`);
        // A hash change keeps an open dialog: close it before moving on.
        await subscribe.getByRole('button', { name: 'Cancel' }).click();
        await expect(subscribe).toBeHidden();

        await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
        await expect(page.getByRole('grid', { name: 'October 2026' })).toBeVisible();
        if (size === 'phone') {
          // The title menu holds the system choice and "Calendars" (§2.1, web compact).
          await page.locator('[aria-haspopup="menu"]').filter({ hasText: 'October' }).first().click();
          await page.getByRole('menuitem', { name: 'Calendars' }).click();
          await expect(page.getByRole('dialog', { name: 'Calendars' })).toBeVisible();
          await check(page, browserName, `calendars-sheet-${size}-${theme.id}`);
        } else {
          const pane = page.locator('[data-calendars-pane]');
          await expect(pane).toBeVisible();
          await pane.getByRole('button', { name: 'Export', exact: true }).click();
          await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
          await check(page, browserName, `export-${size}-${theme.id}`);
          await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Cancel' }).click();
          await pane.getByRole('button', { name: 'New calendar' }).click();
          await expect(page.getByRole('dialog', { name: 'New calendar' })).toBeVisible();
          await check(page, browserName, `new-calendar-${size}-${theme.id}`);
        }
      });

      test('Settings: the Delete all events question', async ({ page, browserName }) => {
        await page.goto(`${MOCKUP}#/settings`);
        await page.getByRole('button', { name: 'Delete all events' }).click();
        const question = page.getByRole('alertdialog');
        await expect(question).toBeVisible();
        await check(page, browserName, `delete-all-${size}-${theme.id}`);
        await question.getByRole('button', { name: 'Cancel' }).click();
        await expect(question).toBeHidden();
      });

      test('the Positivist calendar in Month and Week', async ({ page, browserName }) => {
        await page.addInitScript(() => window.localStorage.setItem('thirteen:system', 'positivist'));
        await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
        await expect(page.getByRole('grid', { name: 'Descartes 238' })).toBeVisible();
        await check(page, browserName, `positivist-month-${size}-${theme.id}`);
        await page.goto(`${MOCKUP}#/week/2026-10-19`);
        await expect(chip(page, 'work/sprint-planning')).toBeVisible();
        await check(page, browserName, `positivist-week-${size}-${theme.id}`);
      });

      test('keyboard help, calendar settings, the repeating-event question and the Undo toast', async ({ page, browserName }) => {
        test.slow();
        await page.goto(`${MOCKUP}#/month/2026/11?day=2026-10-19`);
        await expect(page.getByRole('grid', { name: 'October 2026' })).toBeVisible();
        await page.keyboard.press('Shift+Slash');
        const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
        await expect(help).toBeVisible();
        await check(page, browserName, `keyboard-help-${size}-${theme.id}`);
        await page.keyboard.press('Escape');
        await expect(help).toBeHidden();

        if (size === 'desktop') {
          const pane = page.locator('[data-calendars-pane]');
          for (const [calendar, name] of [['Home', 'calendar-settings'], ['Holidays in Estonia', 'subscription-settings']] as const) {
            await pane.locator('[data-calendar-row]').filter({ hasText: calendar }).getByRole('button', { name: 'Calendar settings' }).click();
            const settings = page.getByRole('dialog', { name: calendar });
            await expect(settings).toBeVisible();
            await check(page, browserName, `${name}-${size}-${theme.id}`);
            await page.keyboard.press('Escape');
            await expect(settings).toBeHidden();
          }
        }

        // Details open from Month on a desktop and from List on a phone, as in the editor test above.
        const open = async (eventId: string) => {
          if (size === 'phone') await page.goto(`${MOCKUP}#/list/2026-10-19`);
          if (size === 'phone') await chip(page, eventId).click();
          else await chip(page, eventId).dblclick();
        };
        await open('work/one-on-one');
        const marta = page.getByRole('dialog', { name: '1:1 with Marta' });
        await marta.getByRole('button', { name: 'Delete event' }).click();
        const question = page.getByRole('alertdialog', { name: 'This is a repeating event.' });
        await expect(question.getByRole('button', { name: 'Delete all future events' })).toBeVisible();
        await check(page, browserName, `delete-repeating-${size}-${theme.id}`);
        await question.getByRole('button', { name: 'Cancel' }).click();
        await expect(question).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(marta).toBeHidden();

        await open('home/dentist');
        await page.getByRole('dialog', { name: 'Dentist, Dr. Tamm' }).getByRole('button', { name: 'Delete event' }).click();
        await page.getByRole('alertdialog', { name: 'Delete this event?' }).getByRole('button', { name: 'Delete event' }).click();
        await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
        await check(page, browserName, `undo-toast-${size}-${theme.id}`);
      });
    });
  }
}

/** Forced colors (Windows High Contrast; §2.20): every event item keeps a visible system-colour border. */
test.describe('forced colors', () => {
  const FORCED: readonly { readonly id: string; readonly hash: string; readonly size: Size; readonly item: string }[] = [
    { id: 'calendar-month', hash: '#/month/2026/11?day=2026-10-19', size: 'desktop', item: 'home/dentist' },
    { id: 'calendar-week', hash: '#/week/2026-10-19', size: 'desktop', item: 'work/sprint-planning' },
    { id: 'calendar-day', hash: '#/day/2026-10-19', size: 'phone', item: 'home/dentist' },
    { id: 'calendar-list', hash: '#/list/2026-10-19', size: 'desktop', item: 'home/dentist' },
    { id: 'calendar-year', hash: '#/year/2026?day=2026-10-19', size: 'desktop', item: '' },
    { id: 'today', hash: '#/today', size: 'phone', item: '' },
  ];
  for (const view of FORCED) {
    test(`${view.id} at ${view.size} width`, async ({ page, browserName }) => {
      test.slow(view.id === 'calendar-year');
      await page.emulateMedia({ forcedColors: 'active' });
      await page.setViewportSize(SIZES[view.size]);
      await page.goto(`${MOCKUP}${view.hash}`);
      const forced = await page.evaluate(() => window.matchMedia('(forced-colors: active)').matches);
      test.skip(!forced, `${browserName} cannot emulate forced colors`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (view.item !== '') {
        const item = chip(page, view.item);
        await expect(item).toBeVisible();
        if (view.id !== 'calendar-list') {
          const border = await item.evaluate((element) => {
            const style = getComputedStyle(element);
            return { style: style.borderTopStyle, width: Number.parseFloat(style.borderTopWidth) };
          });
          expect(border.style).toBe('solid');
          expect(border.width).toBeGreaterThan(0);
        }
      }
      await settle(page);
      expect(await seriousAxe(page, undefined, ['color-contrast'])).toEqual([]);
      if (SHOTS_DIR !== '' && browserName === 'chromium') {
        mkdirSync(SHOTS_DIR, { recursive: true });
        await page.screenshot({ path: join(SHOTS_DIR, `forced-colors-${view.id}-${view.size}.png`) });
      }
    });
  }
});

/** The public pages (§7.1, task B9), in both colour schemes and at both widths. */
for (const scheme of ['light', 'dark'] as const) {
  for (const size of Object.keys(SIZES) as Size[]) {
    test(`privacy.html and support.html (${scheme}, ${size}): no dashes, no serious axe violations`, async ({ page, browserName }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(SIZES[size]);
      await page.goto('/privacy.html');
      await expect(page.getByRole('heading', { name: 'Privacy policy', level: 1 })).toBeVisible();
      await check(page, browserName, `privacy-${size}-${scheme}`);
      await page.goto('/support.html#install');
      const install = page.getByRole('heading', { name: 'Add Thirteen to your Dock or Home Screen', level: 2 });
      await expect(install).toBeInViewport();
      await check(page, browserName, `support-install-${size}-${scheme}`);
    });
  }
}

/**
 * The browser's own text size at 24 px (§2.4, §2.20; WCAG 1.4.4, 1.4.10) on a phone-width window: no header
 * control and no section name sits on another. Chromium only: its DevTools protocol sets the default font
 * size, which (unlike a style on html) also moves the rem breakpoints, as the browser setting does.
 */
test('24 px browser text on a phone: the header and the section names never overlap', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium can set the default font size from a test');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 24, fixed: 24 } });
  await page.setViewportSize(SIZES.phone);
  for (const hash of ['#/month/2026/11?day=2026-10-19', '#/today', '#/settings']) {
    await page.goto(`${MOCKUP}${hash}`);
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    await settle(page);
    const problems = await page.evaluate(() => {
      const visible = (element: Element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      };
      const header = document.querySelector('header')!;
      const controls = [...header.querySelectorAll('button, a, label, [role="radio"]')].filter(visible);
      const name = (element: Element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 24);
      const out: string[] = [];
      for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i]!;
          const b = controls[j]!;
          if (a.contains(b) || b.contains(a)) continue;
          const r = a.getBoundingClientRect();
          const s = b.getBoundingClientRect();
          const x = Math.min(r.right, s.right) - Math.max(r.left, s.left);
          const y = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
          if (x > 1 && y > 1) out.push(`${name(a)} overlaps ${name(b)}`);
        }
      }
      for (const link of document.querySelectorAll<HTMLElement>('nav[aria-label="Sections"] a')) {
        if (link.scrollWidth > link.clientWidth + 1) out.push(`${name(link)} runs out of its tab`);
      }
      return out;
    });
    expect(problems, hash).toEqual([]);
  }
});
