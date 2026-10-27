import { type CSSProperties, useId } from 'react';
import { useTheme } from '../../hooks/useTheme.tsx';
import { cx } from '../../lib/cx.ts';
import { PALETTES, PALETTE_GROUPS, type Palette, markHoleRole } from '../../lib/palettes.ts';
import { Icon } from '../../primitives/Icon.tsx';
import styles from './ThemePicker.module.css';

export interface ThemePickerProps {
  /** Group name, read by assistive technology and shown unless `hideLegend`. Default "Theme". */
  readonly legend?: string;
  readonly hideLegend?: boolean;
  readonly className?: string;
}

/** The widest group sets the phone grid, so every group's swatches line up in the same columns. */
const COLUMNS = Math.max(1, ...PALETTE_GROUPS.map((group) => group.palettes.length));

/**
 * The colour themes as labelled swatches, each a small "Page 13" sheet in that
 * theme's paper, ink and accent, under one heading per group from
 * design/tokens.json: the adaptive themes ("Light and dark"), then the
 * always-dark ones ("Dark"). An adaptive swatch shows the mode the light / dark
 * choice gives it, an always-dark one its only mode. All swatches are one set
 * of native radio inputs (one `name`): Tab enters it, arrow keys move through
 * both groups. Requires a {@link ThemeProvider}.
 */
export function ThemePicker({ legend = 'Theme', hideLegend = false, className }: ThemePickerProps) {
  const { palette, setPalette, preferred } = useTheme();
  const name = useId();
  const descriptionId = (kind: 'theme' | 'group', id: string) => `${name}-${kind}-${id}`;

  const swatch = (option: Palette) => {
    const colors = option[preferred];
    const style = {
      '--sw-paper': colors.paper,
      '--sw-ink': colors.ink,
      '--sw-accent': colors.accent,
      '--sw-hole': markHoleRole(colors) === 'paper' ? colors.paper : colors.ink,
      '--sw-foil': colors.foil,
      '--sw-rule': colors.rule,
    } as CSSProperties;
    const checked = option.id === palette;
    return (
      <label key={option.id} className={cx(styles.option, checked && styles.checked)} title={option.description}>
        <input
          className={styles.input}
          type="radio"
          name={name}
          value={option.id}
          checked={checked}
          onChange={() => setPalette(option.id)}
          aria-describedby={descriptionId('theme', option.id)}
        />
        <span className={styles.sheet} style={style} aria-hidden="true">
          <span className={styles.band}>
            <span className={styles.hole} />
            <span className={styles.hole} />
          </span>
          <span className={styles.numeral}>13</span>
          <span className={styles.foilRule} />
        </span>
        <span className={styles.name}>
          {checked ? <Icon name="check-bold" size={12} className={styles.check} /> : null}
          {option.name}
        </span>
      </label>
    );
  };

  return (
    <fieldset className={cx(styles.picker, className)} style={{ '--picker-cols': COLUMNS } as CSSProperties}>
      <legend className={hideLegend ? 't-sr-only' : styles.legend}>{legend}</legend>
      <div className={styles.groups}>
        {PALETTE_GROUPS.map((group) => (
          <fieldset
            key={group.scheme}
            className={styles.group}
            data-scheme={group.scheme}
            aria-describedby={descriptionId('group', group.scheme)}
          >
            <legend className={styles.groupLegend}>{group.name}</legend>
            <div className={styles.options} style={{ '--group-cols': group.palettes.length } as CSSProperties}>
              {group.palettes.map(swatch)}
            </div>
          </fieldset>
        ))}
      </div>
      {/*
        Outside the labels, so they describe the radios and groups without becoming
        part of their names, and hidden, so a screen reader in browse mode does not
        read them all again as one run of text (aria-describedby still reaches them).
      */}
      <div hidden>
        {PALETTE_GROUPS.map((group) => (
          <span key={group.scheme} id={descriptionId('group', group.scheme)}>
            {group.description}
          </span>
        ))}
        {PALETTES.map((option) => (
          <span key={option.id} id={descriptionId('theme', option.id)}>
            {option.description}
          </span>
        ))}
      </div>
    </fieldset>
  );
}
