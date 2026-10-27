import { type ThemePreference, useTheme } from '../../hooks/useTheme.tsx';
import { PALETTE_GROUPS } from '../../lib/palettes.ts';
import { SegmentedControl } from '../../primitives/SegmentedControl.tsx';

export interface ThemeToggleProps {
  readonly size?: 'sm' | 'md';
  /** Show the words next to the icons. Default `false`. */
  readonly showLabels?: boolean;
  /** Group name read by assistive technology. Default "Appearance". */
  readonly legend?: string;
  /** Show the legend above the control. Default `false`. */
  readonly showLegend?: boolean;
  readonly className?: string;
}

/** "light and dark": the adaptive group's heading from design/tokens.json, as it reads mid-sentence. */
const ADAPTIVE_NAME = (PALETTE_GROUPS.find((group) => group.scheme === 'adaptive')?.name ?? 'Light and dark').toLowerCase();

/**
 * System / Light / Dark, independent of the colour theme. While an always-dark
 * theme is chosen the control is disabled, shows Dark (what is on screen) and
 * carries a short note, the same sentence as the Apple apps
 * (design/DECISIONS.md, "Always-dark theme behaviour, unified"). The saved
 * choice is not touched and shows again with the next adaptive theme.
 * Requires a {@link ThemeProvider}.
 */
export function ThemeToggle({ size = 'sm', showLabels = false, legend = 'Appearance', showLegend = false, className }: ThemeToggleProps) {
  const { preference, setPreference, forced, paletteInfo } = useTheme();
  return (
    <SegmentedControl<ThemePreference>
      legend={legend}
      hideLegend={!showLegend}
      size={size}
      className={className}
      value={forced ?? preference}
      onChange={setPreference}
      disabled={forced !== null}
      note={
        forced === 'dark'
          ? `${paletteInfo.name} is always dark. Pick a ${ADAPTIVE_NAME} theme to use ${legend} again.`
          : undefined
      }
      options={[
        { value: 'system', label: 'System', icon: 'auto', iconOnly: !showLabels, title: 'Follow the system setting' },
        { value: 'light', label: 'Light', icon: 'sun', iconOnly: !showLabels, title: 'Always light' },
        { value: 'dark', label: 'Dark', icon: 'moon', iconOnly: !showLabels, title: 'Always dark' },
      ]}
    />
  );
}
