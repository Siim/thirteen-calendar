import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tokens from '../../../../../design/tokens.json';

const css = readFileSync(`${import.meta.dirname}/YearProgress.module.css`, 'utf8');

type Colors = Readonly<Record<string, string>>;
const themes = tokens.themes as unknown as Readonly<Record<string, { readonly light?: Colors; readonly dark?: Colors }>>;

function resolve(colors: Colors, role: string): string {
  let value = colors[role];
  while (value !== undefined && value.startsWith('{')) value = colors[value.slice(1, -1)];
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`No plain colour for ${role}: ${String(value)}`);
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('YearProgress empty months in dark modes', () => {
  it('outline the segments with light-dark(rule, ink-3)', () => {
    expect(css).toContain('--segment-edge: light-dark(var(--t-rule), var(--t-ink-3));');
    expect(css).toMatch(/\.segment \{[^}]*box-shadow: inset 0 0 0 var\(--t-hairline\) var\(--segment-edge\);/);
  });

  it.each(Object.entries(themes).filter(([, theme]) => theme.dark !== undefined))(
    '%s dark: the ink-3 outline reaches 3:1 against the paper and the empty well',
    (_id, theme) => {
      const dark = theme.dark!;
      const edge = resolve(dark, 'ink-3');
      expect(contrast(edge, resolve(dark, 'paper'))).toBeGreaterThanOrEqual(3);
      expect(contrast(edge, resolve(dark, 'paper-sunk'))).toBeGreaterThanOrEqual(3);
      // The filled months (ink) stay distinct from the empty ones.
      expect(contrast(resolve(dark, 'ink'), resolve(dark, 'paper-sunk'))).toBeGreaterThanOrEqual(3);
    },
  );
});
