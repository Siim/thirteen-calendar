import { type ReactNode, useId } from 'react';
import { cx } from '../lib/cx.ts';
import { Icon, type IconName } from './Icon.tsx';
import styles from './SegmentedControl.module.css';

export interface SegmentedOption<V extends string> {
  readonly value: V;
  readonly label: ReactNode;
  /** Tooltip / extra description. */
  readonly title?: string;
  readonly icon?: IconName;
  /** Show only the icon; the label stays available to assistive technology. */
  readonly iconOnly?: boolean;
}

export interface SegmentedControlProps<V extends string> {
  /** Group name read by assistive technology (and shown unless `hideLegend`). */
  readonly legend: string;
  readonly hideLegend?: boolean;
  readonly value: V;
  readonly options: readonly SegmentedOption<V>[];
  readonly onChange: (value: V) => void;
  readonly size?: 'sm' | 'md';
  readonly name?: string;
  /**
   * Out of play for now: every option is disabled (native `<fieldset disabled>`),
   * the chosen value stays visible and comes back into play when re-enabled.
   */
  readonly disabled?: boolean;
  /** A short line under the control (for example why it is disabled), linked with `aria-describedby`. */
  readonly note?: ReactNode;
  readonly className?: string;
}

/**
 * A segmented radio group built on native radio inputs, so arrow keys,
 * Tab and screen readers behave exactly like a standard radio group.
 */
export function SegmentedControl<V extends string>({
  legend,
  hideLegend = false,
  value,
  options,
  onChange,
  size = 'md',
  name,
  disabled = false,
  note,
  className,
}: SegmentedControlProps<V>) {
  const autoName = useId();
  const groupName = name ?? autoName;
  const noteId = `${autoName}-note`;
  const hasNote = note !== undefined && note !== null && note !== false;
  return (
    <fieldset
      className={cx(styles.group, size === 'sm' && styles.sm, className)}
      disabled={disabled}
      aria-describedby={hasNote ? noteId : undefined}
    >
      <legend className={hideLegend ? 't-sr-only' : styles.legend}>{legend}</legend>
      <div className={styles.track}>
        {options.map((option) => (
          <label
            key={option.value}
            className={cx(styles.option, option.iconOnly && styles.iconOnly)}
            title={option.title}
          >
            <input
              className={styles.input}
              type="radio"
              name={groupName}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            {option.icon ? <Icon name={option.icon} size={size === 'sm' ? 15 : 17} /> : null}
            <span className={option.iconOnly ? 't-sr-only' : undefined}>{option.label}</span>
          </label>
        ))}
      </div>
      {hasNote ? (
        <p id={noteId} className={styles.note}>
          {note}
        </p>
      ) : null}
    </fieldset>
  );
}
