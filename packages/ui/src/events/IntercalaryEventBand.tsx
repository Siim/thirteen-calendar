import { type IntercalaryOccurrence, formatGregorian, toISODate } from '@thirteen/core';
import type { FocusEvent, HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';
import { cx } from '../lib/cx.ts';
import { bandLabel } from './format.ts';
import styles from './MonthEventGrid.module.css';

export interface IntercalaryEventBandProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  readonly occurrence: IntercalaryOccurrence;
  /** Occurrences covering the day, for the accessible name. */
  readonly eventCount: number;
  readonly today?: boolean;
  readonly selected?: boolean;
  readonly tabIndex?: number;
  readonly cellRef?: Ref<HTMLDivElement>;
  readonly onFocus?: (event: FocusEvent<HTMLDivElement>) => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  readonly onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
  readonly onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  /** The day's events, inline. */
  readonly children?: ReactNode;
}

/**
 * An intercalary day in Month mode (docs/EVENTS.md §2.2, §2.4): a full-width
 * band under week 4 of the month it follows, drawn like the intercalary badge
 * (code plate, hatch), with that day's events inline. One grid cell of seven
 * columns, named by `calendar.band.a11y`.
 */
export function IntercalaryEventBand({
  occurrence,
  eventCount,
  today = false,
  selected = false,
  tabIndex,
  cellRef,
  className,
  children,
  ...rest
}: IntercalaryEventBandProps) {
  return (
    <div
      {...rest}
      ref={cellRef}
      role="gridcell"
      aria-colspan={7}
      tabIndex={tabIndex}
      aria-label={bandLabel(occurrence.thirteen, occurrence.gregorian, eventCount)}
      aria-selected={selected}
      aria-current={today ? 'date' : undefined}
      data-date={toISODate(occurrence.gregorian)}
      data-intercalary={occurrence.id}
      className={cx(styles.band, today && styles.today, selected && styles.selected, className)}
    >
      <span className={styles.bandHead} aria-hidden="true">
        <span className={styles.bandCode}>{occurrence.code}</span>
        <span className={styles.bandName}>{occurrence.shortName}</span>
        <span className={styles.bandGreg}>{formatGregorian(occurrence.gregorian, { style: 'short', includeWeekday: true })}</span>
      </span>
      <span className={styles.bandItems}>{children}</span>
    </div>
  );
}
