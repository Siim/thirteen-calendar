import {
  type CalendarSystemId,
  MAX_YEAR,
  MIN_YEAR,
  displayYearRange,
  fromDisplayYear,
  getCalendarSystem,
  isLeapYear,
  toDisplayYear,
} from '@thirteen/core';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';
import { cx } from '../lib/cx.ts';
import { Button } from './Button.tsx';
import styles from './YearStepper.module.css';

export interface YearStepperProps {
  /** Gregorian year. */
  readonly year: number;
  readonly onChange: (gregorianYear: number) => void;
  /** The input shows this system's display year (Positivist 238 for 2026). */
  readonly systemId: CalendarSystemId;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/**
 * Previous / next year buttons around an editable year. The field holds the
 * system's display year; `onChange` always receives a Gregorian year.
 */
export function YearStepper({ year, onChange, systemId, size = 'md', className }: YearStepperProps) {
  const system = getCalendarSystem(systemId);
  const displayYear = toDisplayYear(year, systemId);
  const range = displayYearRange(systemId);
  const [draft, setDraft] = useState(String(displayYear));
  const inputId = useId();
  const captionId = useId();

  useEffect(() => setDraft(String(displayYear)), [displayYear]);

  const commit = () => {
    // Only whole numbers count: Number('') and Number('-') would read as 0 (Positivist 0 = Gregorian 1788).
    const text = draft.trim();
    const parsed = /^-?\d+$/.test(text) ? Number(text) : Number.NaN;
    if (Number.isInteger(parsed) && parsed >= range.min && parsed <= range.max) {
      const next = fromDisplayYear(parsed, systemId);
      if (next !== year) onChange(next);
      else setDraft(String(displayYear));
    } else {
      setDraft(String(displayYear));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') {
      // Handled here: keeps page-level Escape handlers (the Year page's day panel) from also acting on it.
      event.preventDefault();
      setDraft(String(displayYear));
    }
  };

  const caption =
    systemId === 'ifc'
      ? isLeapYear(year)
        ? 'Leap year · 366 days'
        : 'Common year · 365 days'
      : `Gregorian ${year}${isLeapYear(year) ? ' · leap' : ''}`;

  return (
    <div className={cx(styles.stepper, className)} role="group" aria-label="Year">
      <Button
        size={size}
        iconOnly
        icon="chevron-left"
        disabled={year <= MIN_YEAR}
        onClick={() => onChange(year - 1)}
      >
        {`Previous year (${toDisplayYear(Math.max(MIN_YEAR, year - 1), systemId)})`}
      </Button>
      <div className={styles.field}>
        <label htmlFor={inputId} className="t-sr-only">
          {systemId === 'ifc' ? 'Year' : `${system.shortName} year`}
        </label>
        <input
          id={inputId}
          className={styles.input}
          type="number"
          name="year"
          autoComplete="off"
          inputMode="numeric"
          min={range.min}
          max={range.max}
          step={1}
          value={draft}
          aria-describedby={captionId}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        <span id={captionId} className={styles.caption}>
          {caption}
        </span>
      </div>
      <Button
        size={size}
        iconOnly
        icon="chevron-right"
        disabled={year >= MAX_YEAR}
        onClick={() => onChange(year + 1)}
      >
        {`Next year (${toDisplayYear(Math.min(MAX_YEAR, year + 1), systemId)})`}
      </Button>
    </div>
  );
}
