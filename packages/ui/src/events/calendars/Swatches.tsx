import { type CSSProperties, useId } from 'react';
import { copy } from '../copy.ts';
import { CALENDAR_PALETTE } from '../MemoryEventStore.ts';
import styles from './CalendarsDialogs.module.css';
import { paletteColorNames } from './status.ts';

/** The first colour of the §3.6 palette not in use. */
export function nextFreeColor(used: readonly string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()));
  return CALENDAR_PALETTE.find((c) => !taken.has(c)) ?? CALENDAR_PALETTE[0]!;
}

export interface SwatchesProps {
  readonly value: string;
  readonly onChange: (color: string) => void;
  readonly disabled?: boolean;
}

/**
 * The calendar colour picker of the Windows and web dialogs (board D2): the
 * §3.6 palette as radio buttons named by `calendars.colors`, under the label
 * "Color". A colour from another app that is not in the palette stays first.
 */
export function Swatches({ value, onChange, disabled = false }: SwatchesProps) {
  const ids = useId();
  const names = paletteColorNames();
  const current = value.toLowerCase();
  const colors: { color: string; name: string }[] = CALENDAR_PALETTE.map((color, i) => ({ color, name: names[i] ?? color }));
  if (!colors.some((c) => c.color === current)) colors.unshift({ color: current, name: current.toUpperCase() });
  return (
    <fieldset className={styles.field} aria-labelledby={`${ids}-legend`}>
      <legend id={`${ids}-legend`} className={styles.label}>
        {copy('calendars.color')}
      </legend>
      <div className={styles.swatches} role="radiogroup" aria-labelledby={`${ids}-legend`}>
        {colors.map(({ color, name }) => (
          <label key={color} className={styles.swatch} style={{ ['--c' as string]: color } as CSSProperties} title={name}>
            <input type="radio" name={`${ids}-color`} value={color} checked={color === current} disabled={disabled} aria-label={name} onChange={() => onChange(color)} />
            <span aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
