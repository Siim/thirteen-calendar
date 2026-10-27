import { markHoleRole, useTheme } from '@thirteen/ui';

/**
 * The "Page 13" mark (design/DECISIONS.md): a tear-off calendar page with a
 * binding band, two ring holes and a heavy "13". Same geometry as the small
 * app icon (public/favicon.svg), drawn in the active theme's colours. Where
 * the band is ink (Mono), the holes show the paper so they do not disappear.
 */
export function BrandMark({ size = 40 }: { readonly size?: number }) {
  const { paletteInfo, resolved } = useTheme();
  const hole = markHoleRole(paletteInfo[resolved]) === 'paper' ? 'var(--t-paper-raised)' : 'var(--t-ink)';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path fill="var(--t-paper-raised)" d="M7 0H25A7 7 0 0 1 32 7V25A7 7 0 0 1 25 32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z" />
      <path fill="var(--t-accent)" d="M0 10V7A7 7 0 0 1 7 0H25A7 7 0 0 1 32 7V10Z" />
      <path fill={hole} d="M8 4A2 2 0 1 0 12 4A2 2 0 1 0 8 4ZM20 4A2 2 0 1 0 24 4A2 2 0 1 0 20 4Z" />
      <path
        fill="var(--t-ink)"
        d="M8 30V20.35H4.44V17.29H5.84Q7.46 17.29 8.18 16.57Q8.9 15.85 8.9 14H12.42V30ZM22.58 30.36Q19.4 30.36 17.68 28.93Q15.95 27.5 15.84 24.93L20.33 24.79Q20.53 26.82 22.58 26.82Q23.55 26.82 24.12 26.34Q24.7 25.85 24.7 25.09Q24.7 24.23 24.09 23.77Q23.48 23.31 22.4 23.31H20.85V20.33H22.4Q23.17 20.33 23.7 19.97Q24.23 19.61 24.23 18.78Q24.23 18.08 23.82 17.63Q23.41 17.18 22.45 17.18Q21.48 17.18 20.99 17.61Q20.51 18.03 20.39 18.64L15.98 18.44Q16.23 16.23 17.92 14.94Q19.61 13.64 22.45 13.64Q25.55 13.64 27.14 14.87Q28.73 16.1 28.73 18.24Q28.73 19.43 28 20.31Q27.27 21.19 25.94 21.62Q29.23 22.5 29.23 25.49Q29.23 27.75 27.46 29.05Q25.69 30.36 22.58 30.36Z"
      />
      <path
        fill="none"
        stroke="var(--t-rule)"
        strokeWidth="1"
        d="M7 0.5H25A6.5 6.5 0 0 1 31.5 7V25A6.5 6.5 0 0 1 25 31.5H7A6.5 6.5 0 0 1 0.5 25V7A6.5 6.5 0 0 1 7 0.5Z"
      />
    </svg>
  );
}
