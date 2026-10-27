import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';
import { DEFAULT_PALETTE, type ThemeMode, palettePaper } from '../../packages/ui/src/lib/palettes.ts';
import { themeBootScript } from '../../packages/ui/src/lib/themeBoot.ts';

/**
 * Fills the two placeholders in index.html from design/tokens.json (through
 * @thirteen/ui), so no colour is written by hand: the theme-color metas (the
 * default theme's paper per mode) and the inline script that applies the
 * stored theme and mode before first paint.
 */
function thirteenHead(): Plugin {
  return {
    name: 'thirteen-head',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const modes: ThemeMode[] = ['light', 'dark'];
        const metas = modes
          .map(
            (mode) =>
              `<meta name="theme-color" media="(prefers-color-scheme: ${mode})" content="${palettePaper(DEFAULT_PALETTE, mode)}" />`,
          )
          .join('\n    ');
        return html
          .replace('<!-- thirteen:theme-color -->', metas)
          .replace('<!-- thirteen:theme-boot -->', `<script>${themeBootScript()}</script>`);
      },
    },
  };
}

/** The Latin subsets of Geist and Geist Mono (roman), the faces of the first screen. */
const PRELOAD_FONTS = [/(^|\/)geist-latin-wght-normal-[\w-]+\.woff2$/, /(^|\/)geist-mono-latin-wght-normal-[\w-]+\.woff2$/];

/**
 * Production builds preload the two fonts the first screen is set in. Without it
 * the browser only finds them after the stylesheet has loaded, so the big
 * numerals paint in a fallback face first and then jump.
 */
function thirteenFontPreload(): Plugin {
  let base = '/';
  return {
    name: 'thirteen-font-preload',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((file) => PRELOAD_FONTS.some((pattern) => pattern.test(file)));
        return files.map((file) => ({
          tag: 'link',
          attrs: { rel: 'preload', href: `${base}${file}`, as: 'font', type: 'font/woff2', crossorigin: '' },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}

// No `base` here: the site is served from the root of https://thirteen.haugas.dev/, and the GitHub
// Pages workflow builds with `--base /` (design/DECISIONS.md, "Web origin and feeds"). Every URL in
// index.html, the manifest and the app is relative to it (import.meta.env.BASE_URL).
export default defineConfig({
  plugins: [react(), thirteenHead(), thirteenFontPreload()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
