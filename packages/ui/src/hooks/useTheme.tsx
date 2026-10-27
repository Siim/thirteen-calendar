import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { DEFAULT_PALETTE, type Palette, getPalette, isPaletteId, paletteForcedMode, palettePaper } from '../lib/palettes.ts';
import { readStorage, writeStorage } from '../lib/storage.ts';
import {
  DARK_QUERY,
  PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  applyColorSchemeMeta,
  applyThemeColor,
} from '../lib/themeBoot.ts';

export { PALETTE_STORAGE_KEY, THEME_STORAGE_KEY, themeBootScript } from '../lib/themeBoot.ts';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
/** Page colours of the default theme (Almanac) per mode. */
export const THEME_PAPER: Readonly<Record<ResolvedTheme, string>> = Object.freeze({
  light: palettePaper(DEFAULT_PALETTE, 'light'),
  dark: palettePaper(DEFAULT_PALETTE, 'dark'),
});

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(DARK_QUERY).matches
    : false;
}

export interface ThemeContextValue {
  /**
   * What the user chose for light and dark. An always-dark theme does not
   * change it, so it applies again as soon as an adaptive theme is chosen.
   */
  readonly preference: ThemePreference;
  /** What is shown: the theme's forced mode, or else the preference with the system resolved. */
  readonly resolved: ResolvedTheme;
  /** The preference with the system resolved, ignoring a forced mode: what the adaptive themes show. */
  readonly preferred: ResolvedTheme;
  /** `dark` while an always-dark theme is chosen (the light / dark choice is then out of play), else `null`. */
  readonly forced: ResolvedTheme | null;
  readonly setPreference: (preference: ThemePreference) => void;
  /** The colour theme id (`almanac`, `graphite`, ..., `obsidian`, `midnight`, `phosphor`). */
  readonly palette: string;
  /** The colour theme's name, description and swatch colours. */
  readonly paletteInfo: Palette;
  readonly setPalette: (palette: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  readonly defaultPreference?: ThemePreference;
  readonly defaultPalette?: string;
  /** Persistence key of the light / dark preference; `null` disables persistence. */
  readonly storageKey?: string | null;
  /** Persistence key of the colour theme; `null` disables persistence. */
  readonly paletteStorageKey?: string | null;
  readonly children?: ReactNode;
}

/**
 * Two independent choices, both persisted in localStorage: light / dark / system,
 * and the colour theme. An always-dark theme (Obsidian, Midnight, Phosphor)
 * shows dark whatever the first choice says, without changing it. Writes
 * `data-theme` (resolved), `data-theme-preference`, `data-palette` and, for a
 * theme whose accent is its ink, `data-monochrome` on <html>, which the token
 * stylesheets read, and keeps the theme-color and color-scheme metas in sync.
 * Pair with {@link themeBootScript} in the page head so the first paint already
 * has the right colours.
 */
export function ThemeProvider({
  defaultPreference = 'system',
  defaultPalette = DEFAULT_PALETTE,
  storageKey = THEME_STORAGE_KEY,
  paletteStorageKey = PALETTE_STORAGE_KEY,
  children,
}: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    const stored = storageKey === null ? null : readStorage(storageKey);
    return isThemePreference(stored) ? stored : defaultPreference;
  });
  const [palette, setPaletteState] = useState<string>(() => {
    const stored = paletteStorageKey === null ? null : readStorage(paletteStorageKey);
    if (isPaletteId(stored)) return stored;
    return isPaletteId(defaultPalette) ? defaultPalette : DEFAULT_PALETTE;
  });
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystemDark(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Another tab changed a setting: follow it.
  useEffect(() => {
    if (storageKey === null && paletteStorageKey === null) return undefined;
    const onStorage = (event: StorageEvent) => {
      if (storageKey !== null && event.key === storageKey && isThemePreference(event.newValue)) {
        setPreferenceState(event.newValue);
      }
      if (paletteStorageKey !== null && event.key === paletteStorageKey && isPaletteId(event.newValue)) {
        setPaletteState(event.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey, paletteStorageKey]);

  const paletteInfo = getPalette(palette);
  const forced: ResolvedTheme | null = paletteForcedMode(palette);
  const preferred: ResolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  const resolved: ResolvedTheme = forced ?? preferred;
  const monochrome = paletteInfo.monochrome;

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    root.dataset.palette = palette;
    if (monochrome) root.dataset.monochrome = '';
    else delete root.dataset.monochrome;
    const fixed = forced ?? (preference === 'system' ? null : preference);
    applyThemeColor(palette, fixed !== null, resolved);
    applyColorSchemeMeta(fixed);
  }, [resolved, preference, palette, forced, monochrome]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      if (!isThemePreference(next)) return;
      setPreferenceState(next);
      if (storageKey !== null) writeStorage(storageKey, next);
    },
    [storageKey],
  );

  const setPalette = useCallback(
    (next: string) => {
      if (!isPaletteId(next)) return;
      setPaletteState(next);
      if (paletteStorageKey !== null) writeStorage(paletteStorageKey, next);
    },
    [paletteStorageKey],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      preferred,
      forced,
      setPreference,
      palette,
      paletteInfo,
      setPalette,
    }),
    [preference, resolved, preferred, forced, setPreference, palette, paletteInfo, setPalette],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The theme choices; throws outside a {@link ThemeProvider}. */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useTheme() must be used inside <ThemeProvider>.');
  return value;
}
