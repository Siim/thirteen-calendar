import { type ReactNode, useId } from 'react';
import { cx } from '../lib/cx.ts';
import styles from './Switch.module.css';

export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: ReactNode;
  readonly description?: string;
  readonly className?: string;
}

/** An on/off switch (native checkbox with `role="switch"`). */
export function Switch({ checked, onChange, label, description, className }: SwitchProps) {
  const descriptionId = useId();
  return (
    <>
      <label className={cx(styles.switch, className)} title={description}>
        <input
          className={styles.input}
          type="checkbox"
          role="switch"
          checked={checked}
          aria-describedby={description !== undefined ? descriptionId : undefined}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
        <span className={styles.label}>{label}</span>
      </label>
      {/* Outside the label so it describes the switch without becoming part of its name. */}
      {description !== undefined ? (
        <span id={descriptionId} className="t-sr-only">
          {description}
        </span>
      ) : null}
    </>
  );
}
