import { type Page, expect, test } from '@playwright/test';

/**
 * Two follow-ups of the redesign review, checked in a real browser (task B1):
 *
 * - Year progress on Today: in every dark variant the months still to come are outlined clearly enough
 *   to count the 13 parts, at least 3:1 against the empty well and the card around it (WCAG 1.4.11).
 *   The colours are read from the page as drawn, so `light-dark()` and the theme switch are included.
 * - The always-dark themes (design/DECISIONS.md, "Always-dark theme behaviour, unified"): the
 *   Appearance control is disabled, shows Dark, carries the note, and the saved choice is untouched
 *   and comes back with the next adaptive theme.
 */

test.use({ locale: 'en-GB', timezoneId: 'Europe/Tallinn', reducedMotion: 'reduce' });

const DARK_VARIANTS = [
  { palette: 'almanac', mode: 'dark' },
  { palette: 'graphite', mode: 'dark' },
  { palette: 'slate', mode: 'dark' },
  { palette: 'forest', mode: 'dark' },
  { palette: 'mono', mode: 'dark' },
  // Always dark: the saved mode is Light, the theme shows dark anyway.
  { palette: 'obsidian', mode: 'light' },
  { palette: 'midnight', mode: 'light' },
  { palette: 'phosphor', mode: 'light' },
] as const;

const ALWAYS_DARK = [
  { palette: 'obsidian', name: 'Obsidian' },
  { palette: 'midnight', name: 'Midnight' },
  { palette: 'phosphor', name: 'Phosphor' },
] as const;

async function useStoredTheme(page: Page, palette: string, mode: string): Promise<void> {
  await page.addInitScript(
    ([p, m]) => {
      window.localStorage.setItem('thirteen:palette', p);
      window.localStorage.setItem('thirteen:theme', m);
    },
    [palette, mode] as const,
  );
}

interface SegmentColours {
  readonly scheme: string;
  readonly edge: string;
  readonly edgeWidth: number;
  readonly well: string;
  readonly card: string;
  readonly empty: number;
}

/** The outline, well and surrounding background of the last month of the year progress bar (still empty). */
async function lastMonthColours(page: Page): Promise<SegmentColours> {
  return page.evaluate(() => {
    const months = [...document.querySelectorAll<HTMLElement>('[data-segment="month"]')];
    const empty = months.filter((m) => {
      const fill = m.firstElementChild as HTMLElement | null;
      return fill !== null && fill.getBoundingClientRect().width === 0;
    });
    const segment = empty.at(-1);
    if (segment === undefined) throw new Error('no empty month in the year progress bar');
    const style = getComputedStyle(segment);
    // "rgb(r, g, b) 0px 0px 0px 1px inset": the last shadow is the hairline outline.
    const shadows = style.boxShadow.split(/,(?![^(]*\))/);
    const outline = shadows.at(-1)!.trim();
    const colour = /^(rgba?\([^)]*\))/.exec(outline)?.[1] ?? '';
    const lengths = outline.replace(colour, '').trim().split(/\s+/);
    let card = 'rgba(0, 0, 0, 0)';
    for (let node = segment.parentElement; node !== null; node = node.parentElement) {
      const background = getComputedStyle(node).backgroundColor;
      if (!/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(background)) {
        card = background;
        break;
      }
    }
    return {
      scheme: getComputedStyle(document.documentElement).colorScheme,
      edge: colour,
      edgeWidth: Number.parseFloat(lengths[3] ?? '0'),
      well: style.backgroundColor,
      card,
      empty: empty.length,
    };
  });
}

function channels(colour: string): [number, number, number] {
  const match = /rgba?\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)(?:, ([\d.]+))?\)/.exec(colour);
  if (match === null) throw new Error(`not an rgb colour: ${colour}`);
  if (match[4] !== undefined && Number(match[4]) !== 1) throw new Error(`translucent colour: ${colour}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function contrast(a: string, b: string): number {
  const luminance = (colour: string) => {
    const [r, g, bl] = channels(colour).map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

for (const variant of DARK_VARIANTS) {
  test(`year progress: empty months are outlined at 3:1 or more in ${variant.palette} dark`, async ({ page }) => {
    await useStoredTheme(page, variant.palette, variant.mode);
    await page.goto('/#/today');
    await expect(page.getByRole('progressbar').first()).toBeVisible();
    // On a cold dev server the first page can be read before its stylesheets apply: wait for them.
    await page.waitForFunction(() => {
      const segment = document.querySelector('[data-segment="month"]');
      if (segment === null) return false;
      const style = getComputedStyle(segment);
      return style.boxShadow !== 'none' && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(style.backgroundColor);
    });
    await page.evaluate(() => document.fonts.ready);
    const colours = await lastMonthColours(page);
    expect(colours.scheme).toBe('dark');
    expect(colours.empty).toBeGreaterThan(0);
    expect(colours.edgeWidth).toBeGreaterThanOrEqual(1);
    expect(contrast(colours.edge, colours.well), `outline ${colours.edge} on the well ${colours.well}`).toBeGreaterThanOrEqual(3);
    expect(contrast(colours.edge, colours.card), `outline ${colours.edge} on the card ${colours.card}`).toBeGreaterThanOrEqual(3);
  });
}

for (const theme of ALWAYS_DARK) {
  test(`appearance: ${theme.name} disables the control on Dark with the note, the saved Light comes back`, async ({ page }) => {
    await useStoredTheme(page, theme.palette, 'light');
    await page.goto('/#/today');
    await page.getByRole('button', { name: 'Theme' }).click();
    const drawer = page.getByRole('region', { name: 'Theme and appearance' });
    const appearance = drawer.getByRole('group', { name: 'Appearance' });
    await expect(appearance).toBeVisible();

    // A native <fieldset disabled>: every radio in it is disabled.
    await expect(appearance).toHaveAttribute('disabled', '');
    for (const choice of ['System', 'Light', 'Dark']) await expect(appearance.getByRole('radio', { name: choice })).toBeDisabled();
    await expect(appearance.getByRole('radio', { name: 'Dark' })).toBeChecked();
    await expect(appearance.getByRole('radio', { name: 'Light' })).not.toBeChecked();
    await expect(appearance.getByRole('radio', { name: 'System' })).not.toBeChecked();
    const note = `${theme.name} is always dark. Pick a light and dark theme to use Appearance again.`;
    await expect(appearance.getByText(note, { exact: true })).toBeVisible();
    await expect(appearance).toHaveAccessibleDescription(note);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
    expect(await page.evaluate(() => window.localStorage.getItem('thirteen:theme'))).toBe('light');

    // A click on a disabled choice changes nothing.
    await appearance.getByText('System', { exact: true }).click({ force: true });
    await expect(appearance.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(await page.evaluate(() => window.localStorage.getItem('thirteen:theme'))).toBe('light');

    // An adaptive theme gives the control and the saved Light back.
    await drawer.getByRole('radio', { name: 'Almanac' }).check();
    await expect(appearance).not.toHaveAttribute('disabled');
    for (const choice of ['System', 'Light', 'Dark']) await expect(appearance.getByRole('radio', { name: choice })).toBeEnabled();
    await expect(appearance.getByRole('radio', { name: 'Light' })).toBeChecked();
    await expect(appearance.getByText(note, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
    expect(await page.evaluate(() => window.localStorage.getItem('thirteen:theme'))).toBe('light');
  });
}
