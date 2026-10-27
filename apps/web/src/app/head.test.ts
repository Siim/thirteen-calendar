import { DEFAULT_PALETTE, palettePaper } from '@thirteen/ui';
import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';
import manifestText from '../../public/manifest.webmanifest?raw';

const SITE = 'https://thirteen.haugas.dev/';

describe('page head and web app manifest', () => {
  const manifest = JSON.parse(manifestText) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    background_color: string;
    theme_color: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };

  it('keeps the manifest colours on the default theme paper from design/tokens.json', () => {
    const paper = palettePaper(DEFAULT_PALETTE, 'light');
    expect(manifest.background_color).toBe(paper);
    expect(manifest.theme_color).toBe(paper);
  });

  it('uses relative manifest URLs, so the app installs under any base path', () => {
    expect(manifest.short_name).toBe('Thirteen');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    for (const icon of manifest.icons) expect(icon.src).not.toMatch(/^\/|^https?:/);
    expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
  });

  it('points canonical, Open Graph and Twitter at the published site with absolute URLs', () => {
    expect(indexHtml).toContain(`<link rel="canonical" href="${SITE}" />`);
    expect(indexHtml).toContain(`<meta property="og:url" content="${SITE}" />`);
    expect(indexHtml).toContain(`<meta property="og:image" content="${SITE}og-image.png" />`);
    expect(indexHtml).toContain(`<meta name="twitter:image" content="${SITE}og-image.png" />`);
    expect(indexHtml).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-title" content="Thirteen" />');
    // The build fills these from the tokens; nothing colour-related is written by hand.
    expect(indexHtml).toContain('<!-- thirteen:theme-color -->');
    expect(indexHtml).toContain('<!-- thirteen:theme-boot -->');
    expect(indexHtml).not.toMatch(/#[0-9a-f]{6}\b/i);
  });

  it('has no em or en dash in anything a visitor or a link preview can read', () => {
    expect(indexHtml).not.toMatch(/[–—]/);
    expect(manifestText).not.toMatch(/[–—]/);
  });
});
