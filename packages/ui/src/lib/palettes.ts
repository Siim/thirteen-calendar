/**
 * The colour themes ("palettes"), read from design/tokens.json, the single
 * source of truth for every colour (design/DECISIONS.md). The stylesheet side is
 * the generated styles/themes.css; this module only exposes what script needs:
 * the ids, names and groups for the picker, a few colours per theme for its
 * swatches, and the page colour for `<meta name="theme-color">`.
 *
 * Adaptive themes have a light and a dark map. Always-dark themes
 * (`"scheme": "dark"`) have only a dark map; they show it in either mode, so
 * their `light` and `dark` colours here are the same.
 */
// Named imports let the bundler drop the parts of the file the web app never reads (role notes, shadows).
import { defaultTheme, schemes, themes } from '../../../../design/tokens.json';

export type ThemeMode = 'light' | 'dark';

/** `adaptive`: follows light and dark. `dark`: always dark, whatever the mode (the stylesheet forces `color-scheme: dark`). */
export type PaletteScheme = 'adaptive' | 'dark';

/** Colours shown in a theme swatch (opaque `#rrggbb`, web values). */
export interface PaletteColors {
  readonly paper: string;
  readonly paperRaised: string;
  readonly ink: string;
  readonly ink2: string;
  readonly accent: string;
  readonly onAccent: string;
  readonly foil: string;
  readonly rule: string;
}

export interface Palette {
  /** Stable id, stored in localStorage and set as `data-palette` on <html>. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** `dark` for an always-dark theme, listed after the adaptive ones. */
  readonly scheme: PaletteScheme;
  /**
   * The accent is the ink itself (Mono), so colour cannot set Sundays, the
   * current month or the Gregorian side apart. The UI then marks them by weight
   * and hatching instead (`data-monochrome` on <html>, see styles/tokens.css).
   */
  readonly monochrome: boolean;
  readonly light: PaletteColors;
  readonly dark: PaletteColors;
}

/** A heading in the theme picker: the adaptive themes, then the always-dark ones. */
export interface PaletteGroup {
  readonly scheme: PaletteScheme;
  /** "Light and dark", "Dark". */
  readonly name: string;
  /** One line on what the group's themes do with light and dark. */
  readonly description: string;
  readonly palettes: readonly Palette[];
}

type RoleValues = Readonly<Record<string, string>>;

interface TokenTheme {
  readonly name: string;
  readonly description: string;
  readonly scheme?: PaletteScheme;
  /** Absent for an always-dark theme. */
  readonly light?: RoleValues;
  readonly dark: RoleValues;
  readonly platforms?: Readonly<Record<string, Partial<Record<ThemeMode, RoleValues>>>>;
}

interface TokenScheme {
  readonly name: string;
  readonly description: string;
}

interface TokenFile {
  readonly defaultTheme: string;
  readonly schemes: Readonly<Record<PaletteScheme, TokenScheme>>;
  readonly themes: Readonly<Record<string, TokenTheme>>;
}

const file = { defaultTheme, schemes, themes } as unknown as TokenFile;

const SCHEMES: readonly PaletteScheme[] = ['adaptive', 'dark'];

/** Resolves `{role}` references and drops a `/ alpha` suffix (swatches are opaque). */
function resolve(values: RoleValues, role: string, seen: readonly string[] = []): string {
  const raw = values[role];
  if (raw === undefined) throw new Error(`design/tokens.json: missing role "${role}"`);
  const reference = /^\{([a-z0-9-]+)\}$/.exec(raw);
  if (reference) {
    const target = reference[1]!;
    if (seen.includes(target)) throw new Error(`design/tokens.json: circular reference at "${role}"`);
    return resolve(values, target, [...seen, role]);
  }
  return raw.split('/')[0]!.trim();
}

function colors(theme: TokenTheme, mode: ThemeMode): PaletteColors {
  // An always-dark theme answers both modes with its dark map.
  const source: ThemeMode = theme.scheme === 'dark' ? 'dark' : mode;
  const values: RoleValues = { ...theme[source], ...(theme.platforms?.['web']?.[source] ?? {}) };
  return {
    paper: resolve(values, 'paper'),
    paperRaised: resolve(values, 'paper-raised'),
    ink: resolve(values, 'ink'),
    ink2: resolve(values, 'ink-2'),
    accent: resolve(values, 'accent'),
    onAccent: resolve(values, 'on-accent'),
    foil: resolve(values, 'foil'),
    rule: resolve(values, 'rule'),
  };
}

function inkAccent(colors: PaletteColors): boolean {
  return colors.accent.toLowerCase() === colors.ink.toLowerCase();
}

/** Every theme, in the order the picker shows them. */
export const PALETTES: readonly Palette[] = Object.freeze(
  Object.entries(file.themes).map(([id, theme]) => {
    const light = Object.freeze(colors(theme, 'light'));
    const dark = Object.freeze(colors(theme, 'dark'));
    return Object.freeze({
      id,
      name: theme.name,
      description: theme.description,
      scheme: theme.scheme ?? 'adaptive',
      monochrome: inkAccent(light) || inkAccent(dark),
      light,
      dark,
    });
  }),
);

/**
 * The picker's groups, in order (adaptive, then always dark), each with its
 * heading and line from tokens.json `schemes`. Groups without themes are left out.
 */
export const PALETTE_GROUPS: readonly PaletteGroup[] = Object.freeze(
  SCHEMES.flatMap((scheme) => {
    const palettes = PALETTES.filter((palette) => palette.scheme === scheme);
    if (palettes.length === 0) return [];
    const heading = file.schemes[scheme];
    if (heading === undefined) throw new Error(`design/tokens.json: missing schemes.${scheme}`);
    return [Object.freeze({ scheme, name: heading.name, description: heading.description, palettes: Object.freeze(palettes) })];
  }),
);

export const PALETTE_IDS: readonly string[] = Object.freeze(PALETTES.map((palette) => palette.id));

/** The theme new visitors get (Almanac). */
export const DEFAULT_PALETTE: string = file.defaultTheme;

export function isPaletteId(value: unknown): value is string {
  return typeof value === 'string' && PALETTE_IDS.includes(value);
}

/** A theme by id, falling back to the default theme for unknown ids. */
export function getPalette(id: string): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES.find((palette) => palette.id === DEFAULT_PALETTE)!;
}

/**
 * The mode a theme forces whatever the light / dark preference says: `dark` for
 * an always-dark theme, `null` for an adaptive one.
 */
export function paletteForcedMode(id: string): ThemeMode | null {
  return getPalette(id).scheme === 'dark' ? 'dark' : null;
}

/**
 * The "Page 13" mark punches ink ring holes into its accent band. Where the
 * band is ink as well (Mono), ink holes would vanish, so they show the paper.
 */
export function markHoleRole(colors: PaletteColors): 'ink' | 'paper' {
  return colors.accent.toLowerCase() === colors.ink.toLowerCase() ? 'paper' : 'ink';
}

/** Page colour of a theme and mode, for `<meta name="theme-color">`. */
export function palettePaper(id: string, mode: ThemeMode): string {
  return getPalette(id)[mode].paper;
}
