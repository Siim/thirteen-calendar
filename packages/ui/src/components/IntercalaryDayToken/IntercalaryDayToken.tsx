import { type IntercalaryOccurrence, formatGregorian, getCalendarSystem, toISODate } from '@thirteen/core';
import type { KeyboardEvent, Ref } from 'react';
import { cx } from '../../lib/cx.ts';
import { dayAriaExtras, dayAriaLabel, withoutDashes } from '../../lib/labels.ts';
import { reveal } from '../../lib/reveal.ts';
import type { DayMarks } from '../ThirteenMonthGrid/ThirteenMonthGrid.tsx';
import styles from './IntercalaryDayToken.module.css';

export interface IntercalaryDayTokenProps {
  readonly occurrence: IntercalaryOccurrence;
  /** `slip`: compact, sits after its month in a year grid; `plate`: large, with the description. */
  readonly variant?: 'slip' | 'plate';
  readonly today?: boolean;
  /** `undefined` when not selectable. */
  readonly selected?: boolean;
  /** Makes the token a button. */
  readonly onSelect?: () => void;
  readonly tabIndex?: number;
  readonly tokenRef?: Ref<HTMLButtonElement>;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly onFocus?: () => void;
  readonly revealDelay?: number;
  /** Event dots (Year mode, docs/EVENTS.md §2.3); the name ends with "{n} events." (§2.20). */
  readonly marks?: DayMarks;
  readonly className?: string;
}

/**
 * What the day directly follows: the last day of its `afterMonth` ("June 28"),
 * or, when another intercalary day sits after the same month and comes first
 * (Positivist Holy Women after All the Dead), that day.
 */
export function followsWhat(occurrence: IntercalaryOccurrence): string {
  const system = getCalendarSystem(occurrence.thirteen.system);
  const before = system.intercalaryDays
    .filter((d) => d.afterMonth === occurrence.afterMonth && d.dayOfYear.leap < occurrence.dayOfYear)
    .sort((a, b) => b.dayOfYear.leap - a.dayOfYear.leap)[0];
  return before ? `the ${before.name}` : `${system.months[occurrence.afterMonth - 1]!.name} 28`;
}

/**
 * An intercalary day (IFC Year Day / Leap Day, Positivist festivals): a day
 * with no weekday that belongs to no month, drawn as a perforated slip.
 */
export function IntercalaryDayToken({
  occurrence,
  variant = 'slip',
  today = false,
  selected,
  onSelect,
  tabIndex,
  tokenRef,
  onKeyDown,
  onFocus,
  revealDelay,
  marks,
  className,
}: IntercalaryDayTokenProps) {
  const after = followsWhat(occurrence);
  const gregorianText = formatGregorian(occurrence.gregorian, { style: 'medium', includeWeekday: true });
  // As on Apple, Android and Windows: "Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026."
  // then the day's description and "{n} events."; today is aria-current="date", not a word in the name.
  const events = dayAriaExtras(null, marks?.count ?? 0);
  const label = dayAriaLabel(
    occurrence.thirteen,
    occurrence.gregorian,
    events === undefined ? withoutDashes(occurrence.description) : `${withoutDashes(occurrence.description)} ${events}`,
  );

  if (variant === 'plate') {
    return (
      <div className={cx(styles.plate, className)} {...reveal('rise', revealDelay)}>
        <span className={styles.code} aria-hidden="true">
          {occurrence.code}
        </span>
        <p className={styles.name}>{occurrence.name}</p>
        <p className={styles.note}>No weekday · outside every month · after {after}</p>
        <p className={styles.plateDescription}>{occurrence.description}</p>
        <p className={styles.gregorian}>
          Gregorian {gregorianText}
        </p>
      </div>
    );
  }

  // Only the name is real text, so the slip's visible label ("Year Day") opens
  // its accessible name (WCAG 2.5.3); the code, note and Gregorian date are
  // drawn as generated text and spelled out in full by `label`.
  const body = (
    <>
      <span className={cx(styles.code, styles.generated)} aria-hidden="true" data-text={occurrence.code} />
      <span className={styles.name} aria-hidden="true">
        {occurrence.shortName}
      </span>
      <span className={cx(styles.note, styles.generated)} aria-hidden="true" data-text="no weekday · no month" />
      <span
        className={cx(styles.gregorian, styles.generated)}
        aria-hidden="true"
        data-text={formatGregorian(occurrence.gregorian, { style: 'short', includeWeekday: true })}
      />
      {marks !== undefined && marks.colors.length > 0 ? (
        <span className={styles.marks} aria-hidden="true">
          {marks.colors.slice(0, 3).map((color, index) => (
            <span key={index} className={styles.mark} style={{ ['--cal' as string]: color }} />
          ))}
        </span>
      ) : null}
    </>
  );

  const classes = cx(styles.slip, today && styles.today, selected && styles.selected, className);
  if (onSelect) {
    return (
      <button
        ref={tokenRef}
        type="button"
        className={classes}
        aria-label={label}
        aria-pressed={selected ?? false}
        aria-current={today ? 'date' : undefined}
        tabIndex={tabIndex}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        data-intercalary={occurrence.id}
        data-date={toISODate(occurrence.gregorian)}
        {...reveal('cell', revealDelay)}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      role="note"
      className={classes}
      aria-label={label}
      aria-current={today ? 'date' : undefined}
      data-intercalary={occurrence.id}
      data-date={toISODate(occurrence.gregorian)}
      {...reveal('cell', revealDelay)}
    >
      {body}
    </div>
  );
}
