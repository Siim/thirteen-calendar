import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { PALETTE_STORAGE_KEY, THEME_STORAGE_KEY, ThemeProvider, useTheme } from '../../hooks/useTheme.tsx';
import { ThemeToggle } from '../ThemeToggle/ThemeToggle.tsx';
import { PALETTE_GROUPS, PALETTE_IDS, getPalette } from '../../lib/palettes.ts';
import { ThemePicker } from './ThemePicker.tsx';

function Current() {
  const { palette, resolved, preference } = useTheme();
  return <p data-testid="current">{`${palette}/${resolved}/${preference}`}</p>;
}

function themeColorMetas() {
  const light = document.createElement('meta');
  light.setAttribute('name', 'theme-color');
  light.setAttribute('media', '(prefers-color-scheme: light)');
  const dark = document.createElement('meta');
  dark.setAttribute('name', 'theme-color');
  dark.setAttribute('media', '(prefers-color-scheme: dark)');
  const scheme = document.createElement('meta');
  scheme.setAttribute('name', 'color-scheme');
  scheme.setAttribute('content', 'light dark');
  document.head.append(light, dark, scheme);
  return { light, dark, scheme };
}

afterEach(() => {
  const root = document.documentElement;
  delete root.dataset.theme;
  delete root.dataset.themePreference;
  delete root.dataset.palette;
  delete root.dataset.monochrome;
  document.head.querySelectorAll('meta[name="theme-color"], meta[name="color-scheme"]').forEach((meta) => meta.remove());
});

describe('ThemePicker', () => {
  it('offers every theme as one radio group, Almanac first and checked by default', () => {
    render(
      <ThemeProvider>
        <ThemePicker />
      </ThemeProvider>,
    );
    const group = screen.getByRole('group', { name: 'Theme' });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((radio) => radio.value)).toEqual(PALETTE_IDS);
    // One name across both groups: arrow keys and screen readers treat them as one set.
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    expect((screen.getByRole('radio', { name: 'Almanac' }) as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.dataset.palette).toBe('almanac');
  });

  it('groups the adaptive themes and the always-dark ones under their tokens.json headings', () => {
    render(
      <ThemeProvider>
        <ThemePicker />
      </ThemeProvider>,
    );
    expect(PALETTE_GROUPS.map((group) => group.name)).toEqual(['Light and dark', 'Dark']);
    for (const group of PALETTE_GROUPS) {
      const element = screen.getByRole('group', { name: group.name });
      const values = within(element)
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).value);
      expect(values).toEqual(group.palettes.map((palette) => palette.id));
      // The grid takes its column count from the group, not a fixed five.
      const grid = element.querySelector<HTMLElement>('[style*="--group-cols"]');
      expect(grid?.style.getPropertyValue('--group-cols')).toBe(String(group.palettes.length));
      const description = document.getElementById(element.getAttribute('aria-describedby') ?? '');
      expect(description?.textContent).toBe(group.description);
    }
    expect(
      within(screen.getByRole('group', { name: 'Dark' }))
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).value),
    ).toEqual(['obsidian', 'midnight', 'phosphor']);
  });

  it('sets data-palette, persists the choice and leaves light/dark alone', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemePicker />
        <ThemeToggle />
        <Current />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    await user.click(screen.getByRole('radio', { name: 'Forest' }));
    expect(screen.getByTestId('current').textContent).toBe('forest/dark/dark');
    expect(document.documentElement.dataset.palette).toBe('forest');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('forest');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('moves between themes with the arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemePicker />
      </ThemeProvider>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Almanac' }));
    await user.keyboard('{ArrowRight}');
    expect(document.documentElement.dataset.palette).toBe('graphite');
  });

  it('moves across the two groups with the arrow keys, as one radio group', async () => {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, 'mono');
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemePicker />
      </ThemeProvider>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Mono' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Obsidian' }));
    expect(document.documentElement.dataset.palette).toBe('obsidian');
    await user.keyboard('{ArrowLeft}');
    expect(document.documentElement.dataset.palette).toBe('mono');
  });

  it('forces dark for an always-dark theme, disables light / dark with a note, and restores the choice after', async () => {
    const { light, dark, scheme } = themeColorMetas();
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemePicker />
        <ThemeToggle />
        <Current />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(screen.getByTestId('current').textContent).toBe('almanac/light/light');

    await user.click(screen.getByRole('radio', { name: 'Obsidian' }));
    expect(screen.getByTestId('current').textContent).toBe('obsidian/dark/light');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themePreference).toBe('light');
    expect(light.content).toBe('#0a0a0b');
    expect(dark.content).toBe('#0a0a0b');
    expect(scheme.content).toBe('dark');
    // The stored mode is untouched; only the theme changed.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('obsidian');

    const appearance = screen.getByRole('group', { name: 'Appearance' }) as HTMLFieldSetElement;
    expect(appearance.disabled).toBe(true);
    for (const name of ['System', 'Light', 'Dark']) {
      // Disabled through the fieldset, so `:disabled` rather than the input's own attribute.
      expect(within(appearance).getByRole('radio', { name }).matches(':disabled')).toBe(true);
    }
    // It shows what is on screen (Dark), and the note says why it is out of play; the saved
    // Light is untouched and shows again with the next adaptive theme (design/DECISIONS.md).
    expect((within(appearance).getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true);
    expect((within(appearance).getByRole('radio', { name: 'Light' }) as HTMLInputElement).checked).toBe(false);
    const note = document.getElementById(appearance.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe('Obsidian is always dark. Pick a light and dark theme to use Appearance again.');
    expect(note?.textContent).not.toMatch(/[–—]/);

    await user.click(screen.getByRole('radio', { name: 'Slate' }));
    expect(screen.getByTestId('current').textContent).toBe('slate/light/light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(appearance.disabled).toBe(false);
    expect(within(appearance).getByRole('radio', { name: 'Dark' }).matches(':disabled')).toBe(false);
    expect(appearance.hasAttribute('aria-describedby')).toBe(false);
    expect((within(appearance).getByRole('radio', { name: 'Light' }) as HTMLInputElement).checked).toBe(true);
    expect(light.content).toBe('#eef1f5');
    expect(dark.content).toBe('#eef1f5');
    expect(scheme.content).toBe('light');
  });

  it('shows the adaptive swatches in the mode they would get, not the forced dark', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemePicker />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('radio', { name: 'Midnight' }));
    const sheet = (id: string) =>
      screen.getByRole('radio', { name: getPalette(id).name }).parentElement!.querySelector<HTMLElement>('[style]')!;
    expect(sheet('almanac').style.getPropertyValue('--sw-paper')).toBe(getPalette('almanac').light.paper);
    expect(sheet('midnight').style.getPropertyValue('--sw-paper')).toBe(getPalette('midnight').dark.paper);
  });

  it('marks a theme whose accent is its ink with data-monochrome, for the weight and hatch cues', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemePicker />
      </ThemeProvider>,
    );
    expect(document.documentElement.hasAttribute('data-monochrome')).toBe(false);
    await user.click(screen.getByRole('radio', { name: 'Mono' }));
    expect(document.documentElement.hasAttribute('data-monochrome')).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Phosphor' }));
    expect(document.documentElement.hasAttribute('data-monochrome')).toBe(false);
  });

  it('restores a stored theme and ignores unknown ids', () => {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, 'slate');
    const { unmount } = render(
      <ThemeProvider>
        <Current />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('current').textContent).toBe('slate/light/system');
    unmount();
    window.localStorage.setItem(PALETTE_STORAGE_KEY, 'sepia');
    render(
      <ThemeProvider>
        <Current />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('current').textContent).toBe('almanac/light/system');
  });

  it('restores a stored always-dark theme as dark without touching the stored mode', () => {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, 'phosphor');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(
      <ThemeProvider>
        <ThemeToggle />
        <Current />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('current').textContent).toBe('phosphor/dark/light');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect((screen.getByRole('group', { name: 'Appearance' }) as HTMLFieldSetElement).disabled).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('keeps theme-color metas on the theme paper', async () => {
    const light = document.createElement('meta');
    light.setAttribute('name', 'theme-color');
    light.setAttribute('media', '(prefers-color-scheme: light)');
    const dark = document.createElement('meta');
    dark.setAttribute('name', 'theme-color');
    dark.setAttribute('media', '(prefers-color-scheme: dark)');
    document.head.append(light, dark);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemePicker />
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(light.content).toBe('#f4efe4');
    expect(dark.content).toBe('#0e1014');
    await user.click(screen.getByRole('radio', { name: 'Graphite' }));
    expect(light.content).toBe('#f3f3f1');
    expect(dark.content).toBe('#0f1012');
    // Pinned dark: both metas show the dark paper.
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(light.content).toBe('#0f1012');
  });

  it('describes each theme without repeating the descriptions as page text', () => {
    render(
      <ThemeProvider>
        <ThemePicker />
      </ThemeProvider>,
    );
    const radio = screen.getByRole('radio', { name: 'Graphite' });
    const description = document.getElementById(radio.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Neutral greys with an electric blue accent.');
    // Hidden from browse mode; aria-describedby still reads it.
    expect(description?.closest('[hidden]')).not.toBeNull();
  });
});
