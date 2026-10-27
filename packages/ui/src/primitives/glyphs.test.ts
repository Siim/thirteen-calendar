import { describe, expect, it } from 'vitest';
import { ICONS, type PhosphorComponent, phosphorPaths } from '../../scripts/icons.ts';
import { GLYPHS } from './glyphs.ts';

describe('glyphs.ts', () => {
  it('lists exactly the icons of scripts/icons.ts, in order', () => {
    expect(Object.keys(GLYPHS)).toEqual(ICONS.map(([name]) => name));
  });

  it.each(ICONS)('%s matches @phosphor-icons/react %s (%s)', async (name, phosphor, weight) => {
    const module = (await import(`@phosphor-icons/react/dist/csr/${phosphor}`)) as Record<string, PhosphorComponent | undefined>;
    const glyph = GLYPHS[name as keyof typeof GLYPHS];
    expect(glyph.phosphor).toBe(phosphor);
    expect(glyph.weight).toBe(weight);
    expect(glyph.paths).toEqual(phosphorPaths(module[phosphor]!, weight).paths);
  });
});
