/**
 * Theme constants and the pre-paint boot script. Plain TypeScript with no React
 * or CSS imports, so build tooling (apps/web/vite.config.ts) can inline the
 * script into index.html.
 */
import { DEFAULT_PALETTE, PALETTES, type ThemeMode } from './palettes.ts';

/** localStorage key of the light / dark / system preference. */
export const THEME_STORAGE_KEY = 'thirteen:theme';
/** localStorage key of the colour theme id (`almanac`, `graphite`, ...). */
export const PALETTE_STORAGE_KEY = 'thirteen:palette';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeBootOptions {
  readonly themeKey?: string;
  readonly paletteKey?: string;
}

/**
 * Points every `<meta name="theme-color">` at the page colour. A meta with a
 * `media` query keeps answering for its own mode unless the mode is fixed (the
 * user pinned light or dark, or the theme is always dark), in which case all of
 * them show that mode.
 */
export function applyThemeColor(paletteId: string, pinned: boolean, resolved: ThemeMode, doc: Document = document): void {
  const palette = PALETTES.find((p) => p.id === paletteId) ?? PALETTES.find((p) => p.id === DEFAULT_PALETTE)!;
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') ?? '';
    const mode: ThemeMode = pinned || media === '' ? resolved : media.includes('dark') ? 'dark' : 'light';
    meta.content = palette[mode].paper;
  }
}

/**
 * Keeps `<meta name="color-scheme">` on the mode in force: the fixed mode when
 * there is one (pinned, or an always-dark theme), otherwise `light dark`. It
 * only matters before the stylesheet applies, so the page never flashes the
 * other scheme's canvas.
 */
export function applyColorSchemeMeta(fixed: ThemeMode | null, doc: Document = document): void {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) meta.content = fixed ?? 'light dark';
}

/**
 * Inline `<head>` script (as a string) that applies the stored mode and colour
 * theme before first paint: `data-theme`, `data-palette`, `data-monochrome`
 * and the theme-color and color-scheme metas. An always-dark theme sets dark
 * whatever the stored mode says (the stored mode is kept for the other
 * themes). Mirrors ThemeProvider, so the first React render changes nothing.
 */
export function themeBootScript({ themeKey = THEME_STORAGE_KEY, paletteKey = PALETTE_STORAGE_KEY }: ThemeBootOptions = {}): string {
  const papers: Record<string, [string, string]> = {};
  for (const palette of PALETTES) papers[palette.id] = [palette.light.paper, palette.dark.paper];
  const alwaysDark = PALETTES.filter((palette) => palette.scheme === 'dark').map((palette) => palette.id);
  const monochrome = PALETTES.filter((palette) => palette.monochrome).map((palette) => palette.id);
  return [
    '(function(){try{',
    `var P=${JSON.stringify(papers)},D=${JSON.stringify(alwaysDark)},M=${JSON.stringify(monochrome)},d=document.documentElement;`,
    `var p=localStorage.getItem(${JSON.stringify(paletteKey)});if(!P.hasOwnProperty(p)){p=${JSON.stringify(DEFAULT_PALETTE)};}`,
    `var t=localStorage.getItem(${JSON.stringify(themeKey)}),pin=t==='light'||t==='dark';`,
    `if(!pin){t=window.matchMedia&&window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches?'dark':'light';}`,
    "if(D.indexOf(p)>-1){t='dark';pin=true;}",
    "d.dataset.theme=t;d.dataset.palette=p;if(M.indexOf(p)>-1){d.dataset.monochrome='';}",
    "var m=document.querySelectorAll('meta[name=\"theme-color\"]');",
    "for(var i=0;i<m.length;i++){var q=m[i].getAttribute('media')||'';",
    "var k=pin||!q?t:(q.indexOf('dark')>-1?'dark':'light');m[i].setAttribute('content',P[p][k==='dark'?1:0]);}",
    "var c=document.querySelector('meta[name=\"color-scheme\"]');if(c){c.setAttribute('content',pin?t:'light dark');}",
    '}catch(e){}})();',
  ].join('');
}
