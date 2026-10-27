import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTE,
  PALETTES,
  PALETTE_GROUPS,
  PALETTE_IDS,
  getPalette,
  isPaletteId,
  markHoleRole,
  paletteForcedMode,
  palettePaper,
} from './palettes.ts';
import { themeBootScript } from './themeBoot.ts';

const HEX = /^#[0-9a-f]{6}$/;

describe('palettes (from design/tokens.json)', () => {
  it('lists the themes in picker order, adaptive then always dark, with Almanac as the default', () => {
    expect(PALETTE_IDS).toEqual(['almanac', 'graphite', 'slate', 'forest', 'mono', 'obsidian', 'midnight', 'phosphor']);
    expect(DEFAULT_PALETTE).toBe('almanac');
    expect(PALETTES.map((p) => p.name)).toEqual(['Almanac', 'Graphite', 'Slate', 'Forest', 'Mono', 'Obsidian', 'Midnight', 'Phosphor']);
    expect(PALETTES.map((p) => p.scheme)).toEqual([...Array(5).fill('adaptive'), ...Array(3).fill('dark')]);
  });

  it('gives an always-dark theme its dark colours in either mode', () => {
    for (const palette of PALETTES.filter((p) => p.scheme === 'dark')) {
      expect(palette.light).toEqual(palette.dark);
      expect(palettePaper(palette.id, 'light')).toBe(palettePaper(palette.id, 'dark'));
    }
    expect(palettePaper('obsidian', 'light')).toBe('#0a0a0b');
  });

  it('groups the themes for the picker: adaptive first, then the always-dark ones, with the tokens.json headings', () => {
    expect(PALETTE_GROUPS.map((group) => group.scheme)).toEqual(['adaptive', 'dark']);
    expect(PALETTE_GROUPS.map((group) => group.name)).toEqual(['Light and dark', 'Dark']);
    expect(PALETTE_GROUPS[1]!.description).toBe('Always dark, whatever the system or the Appearance setting.');
    expect(PALETTE_GROUPS.flatMap((group) => group.palettes.map((palette) => palette.id))).toEqual(PALETTE_IDS);
    expect(PALETTE_GROUPS[1]!.palettes.map((palette) => palette.id)).toEqual(['obsidian', 'midnight', 'phosphor']);
    for (const group of PALETTE_GROUPS) {
      expect(`${group.name} ${group.description}`).not.toMatch(/[–—]/);
    }
  });

  it('forces dark only for the always-dark themes', () => {
    expect(PALETTE_IDS.filter((id) => paletteForcedMode(id) === 'dark')).toEqual(['obsidian', 'midnight', 'phosphor']);
    expect(paletteForcedMode('almanac')).toBeNull();
    expect(paletteForcedMode('sepia')).toBeNull();
  });

  it('flags only Mono as monochrome (its accent is its ink), for the weight and hatch cues', () => {
    expect(PALETTES.filter((p) => p.monochrome).map((p) => p.id)).toEqual(['mono']);
  });

  it('resolves every swatch colour to opaque hex, following {role} references', () => {
    for (const palette of PALETTES) {
      for (const mode of ['light', 'dark'] as const) {
        for (const value of Object.values(palette[mode])) expect(value).toMatch(HEX);
      }
    }
    const mono = getPalette('mono');
    expect(mono.light.accent).toBe(mono.light.ink);
    expect(mono.dark.onAccent).toBe(mono.dark.paper);
  });

  it('keeps the shipped Almanac colours', () => {
    expect(palettePaper('almanac', 'light')).toBe('#f4efe4');
    expect(palettePaper('almanac', 'dark')).toBe('#0e1014');
    expect(getPalette('almanac').light.accent).toBe('#ea580c');
  });

  it('punches the Page 13 ring holes in paper only where the band is ink (Mono)', () => {
    for (const palette of PALETTES) {
      for (const mode of ['light', 'dark'] as const) {
        expect(markHoleRole(palette[mode])).toBe(palette.id === 'mono' ? 'paper' : 'ink');
      }
    }
  });

  it('falls back to the default theme for unknown ids', () => {
    expect(isPaletteId('graphite')).toBe(true);
    expect(isPaletteId('sepia')).toBe(false);
    expect(isPaletteId(null)).toBe(false);
    expect(getPalette('sepia').id).toBe('almanac');
  });
});

describe('themeBootScript', () => {
  function boot(storage: Record<string, string>, prefersDark = false) {
    const root = document.documentElement;
    delete root.dataset.theme;
    delete root.dataset.palette;
    delete root.dataset.monochrome;
    window.localStorage.clear();
    for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: prefersDark })) as typeof window.matchMedia;
    try {
      new Function(themeBootScript())();
    } finally {
      window.matchMedia = original;
    }
    return { theme: root.dataset.theme, palette: root.dataset.palette };
  }

  function metas() {
    document.head.querySelectorAll('meta[name="theme-color"], meta[name="color-scheme"]').forEach((meta) => meta.remove());
    const make = (name: string, attrs: Record<string, string>) => {
      const meta = document.createElement('meta');
      meta.setAttribute('name', name);
      for (const [key, value] of Object.entries(attrs)) meta.setAttribute(key, value);
      document.head.append(meta);
      return meta;
    };
    return {
      light: make('theme-color', { media: '(prefers-color-scheme: light)' }),
      dark: make('theme-color', { media: '(prefers-color-scheme: dark)' }),
      scheme: make('color-scheme', { content: 'light dark' }),
    };
  }

  it('applies the stored theme and mode before React runs', () => {
    expect(boot({ 'thirteen:theme': 'dark', 'thirteen:palette': 'slate' })).toEqual({ theme: 'dark', palette: 'slate' });
  });

  it('follows the system and the default theme when nothing is stored', () => {
    expect(boot({}, true)).toEqual({ theme: 'dark', palette: 'almanac' });
    expect(boot({ 'thirteen:palette': 'nope' })).toEqual({ theme: 'light', palette: 'almanac' });
  });

  it('forces dark for an always-dark theme before first paint, whatever the stored mode or the system', () => {
    const { light, dark, scheme } = metas();
    expect(boot({ 'thirteen:theme': 'light', 'thirteen:palette': 'obsidian' })).toEqual({ theme: 'dark', palette: 'obsidian' });
    expect([light.content, dark.content, scheme.content]).toEqual(['#0a0a0b', '#0a0a0b', 'dark']);
    expect(boot({ 'thirteen:palette': 'midnight' }, false)).toEqual({ theme: 'dark', palette: 'midnight' });
    // The stored mode is left alone, for the next adaptive theme.
    expect(window.localStorage.getItem('thirteen:theme')).toBeNull();
    document.head.querySelectorAll('meta').forEach((meta) => meta.remove());
  });

  it('keeps the color-scheme meta open when following the system, and on the pinned mode otherwise', () => {
    const { light, dark, scheme } = metas();
    boot({ 'thirteen:palette': 'graphite' });
    expect([light.content, dark.content, scheme.content]).toEqual(['#f3f3f1', '#0f1012', 'light dark']);
    boot({ 'thirteen:palette': 'graphite', 'thirteen:theme': 'dark' });
    expect([light.content, dark.content, scheme.content]).toEqual(['#0f1012', '#0f1012', 'dark']);
    document.head.querySelectorAll('meta').forEach((meta) => meta.remove());
  });

  it('sets data-monochrome for Mono only', () => {
    boot({ 'thirteen:palette': 'mono' });
    expect(document.documentElement.hasAttribute('data-monochrome')).toBe(true);
    boot({ 'thirteen:palette': 'slate' });
    expect(document.documentElement.hasAttribute('data-monochrome')).toBe(false);
  });
});
