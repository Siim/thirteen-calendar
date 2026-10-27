import { type Weekday, orderedWeekdays, weekdayName } from '@thirteen/core';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { reveal } from '../../lib/reveal.ts';
import styles from './WeekdayDriftStrip.module.css';

export interface WeekdayDriftRow {
  readonly key: string;
  /** Row header, e.g. "Jan" or "2026". */
  readonly label: string;
  /** The weekday to mark, or `null` (no weekday). */
  readonly weekday: Weekday | null;
  /** Accessible description of the row; defaults to "label: weekday". */
  readonly description?: string;
  readonly highlight?: boolean;
}

export interface WeekdayDriftStripProps {
  readonly title?: ReactNode;
  readonly rows: readonly WeekdayDriftRow[];
  /** First column. Default Sunday. */
  readonly weekStartsOn?: Weekday;
  readonly tone?: 'foil' | 'accent';
  readonly caption?: ReactNode;
  readonly revealDelay?: number;
  readonly className?: string;
}

/**
 * Rows against the seven weekdays with one mark per row: a ragged diagonal
 * shows weekdays drifting (Gregorian month starts, year starts), a straight
 * column shows a fixed calendar.
 */
export function WeekdayDriftStrip({
  title,
  rows,
  weekStartsOn = 0,
  tone = 'foil',
  caption,
  revealDelay,
  className,
}: WeekdayDriftStripProps) {
  const columns = orderedWeekdays(weekStartsOn);
  return (
    <figure className={cx(styles.figure, styles[tone], className)} {...reveal('rise', revealDelay)}>
      {title !== undefined ? <figcaption className={styles.title}>{title}</figcaption> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <td className={styles.corner} />
            {columns.map((weekday) => (
              <th key={weekday} scope="col" abbr={weekdayName(weekday)} className={styles.head}>
                {weekdayName(weekday, 'short')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={cx(styles.row, row.highlight && styles.highlight)}
              aria-label={row.description ?? `${row.label}: ${row.weekday === null ? 'no weekday' : weekdayName(row.weekday)}`}
            >
              <th scope="row" className={styles.rowHead}>
                {row.label}
              </th>
              {columns.map((weekday) => (
                <td key={weekday} className={styles.cell}>
                  {row.weekday === weekday ? (
                    <span className={styles.dot} role="img" aria-label={weekdayName(weekday)} />
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {caption !== undefined ? <p className={styles.caption}>{caption}</p> : null}
    </figure>
  );
}
