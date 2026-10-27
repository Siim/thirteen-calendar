import { type GregorianDate, addGregorianDays, toISODate, tryParseISODate } from '@thirteen/core';
import { Button } from '@thirteen/ui';
import { useId } from 'react';
import styles from './ConvertPage.module.css';

export interface GregorianInputProps {
  readonly value: GregorianDate;
  readonly today: GregorianDate;
  readonly onChange: (date: GregorianDate) => void;
}

function step(date: GregorianDate, days: number): GregorianDate | null {
  try {
    return addGregorianDays(date, days);
  } catch {
    return null;
  }
}

/** Gregorian date entry: a native date field plus day steppers. */
export function GregorianInput({ value, today, onChange }: GregorianInputProps) {
  const id = useId();
  const previous = step(value, -1);
  const next = step(value, 1);
  return (
    <div className={styles.fields}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={id}>
          Gregorian date
        </label>
        <input
          id={id}
          className={styles.input}
          type="date"
          name="gregorian-date"
          autoComplete="off"
          min="0001-01-01"
          max="9999-12-31"
          required
          value={toISODate(value)}
          onChange={(event) => {
            const parsed = tryParseISODate(event.currentTarget.value);
            if (parsed) onChange(parsed);
          }}
        />
      </div>
      <div className={styles.buttons}>
        <Button size="sm" icon="chevron-left" disabled={!previous} onClick={() => previous && onChange(previous)}>
          Day before
        </Button>
        <Button size="sm" icon="today" onClick={() => onChange(today)}>
          Today
        </Button>
        <Button size="sm" iconEnd="chevron-right" disabled={!next} onClick={() => next && onChange(next)}>
          Day after
        </Button>
      </div>
    </div>
  );
}
