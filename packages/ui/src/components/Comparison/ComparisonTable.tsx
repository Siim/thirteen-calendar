import {
  type Comparison,
  formatGregorian,
  formatThirteen,
  getCalendarSystem,
  gregorianMonthName,
  ordinal,
  weekdayName,
} from '@thirteen/core';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { formatPercent, pluralDays } from '../../lib/dates.ts';
import { explainLabelDrift, explainWeekdayShift } from '../../lib/explain.ts';
import styles from './Comparison.module.css';

export interface ComparisonTableProps {
  readonly comparison: Comparison;
  readonly caption?: ReactNode;
  /** `compact` tightens spacing (side panels). */
  readonly variant?: 'full' | 'compact';
  readonly className?: string;
}

function Row({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <tr className={styles.row}>
      <th scope="row" className={styles.term}>
        {term}
      </th>
      <td className={styles.value}>{children}</td>
    </tr>
  );
}

/** Every field of `compare()` (SPEC §3) as a typeset table with plain-words notes. */
export function ComparisonTable({ comparison: c, caption, variant = 'full', className }: ComparisonTableProps) {
  const system = getCalendarSystem(c.thirteen.system);
  const shift = explainWeekdayShift(c);
  const drift = explainLabelDrift(c);
  const daysInYear = c.daysIntoYear + 1 + c.daysRemainingInYear;
  return (
    <table className={cx(styles.table, variant === 'compact' && styles.compact, className)}>
      {caption !== undefined ? <caption className={styles.caption}>{caption}</caption> : null}
      <tbody>
        <Row term={system.shortName}>
          <span className={cx(styles.main, styles.accent)}>{formatThirteen(c.thirteen, { includeWeekday: true })}</span>
          <span className={styles.code}>{formatThirteen(c.thirteen, { style: 'numeric' })}</span>
        </Row>
        <Row term="Gregorian">
          <span className={cx(styles.main, styles.foil)}>{formatGregorian(c.gregorian, { includeWeekday: true })}</span>
          <span className={styles.code}>{formatGregorian(c.gregorian, { style: 'numeric' })}</span>
        </Row>
        <Row term="Day of year">
          <span className={styles.main}>
            <span className={styles.figure}>{ordinal(c.dayOfYear)}</span> of {daysInYear}
            {c.isLeapYear ? ' · leap year' : ''}
          </span>
          <span className={styles.note}>Both calendars start on 1 January, so they share the day-of-year.</span>
        </Row>
        <Row term="Weekday">
          <span className={styles.main}>
            {c.thirteenWeekday === null ? 'none' : weekdayName(c.thirteenWeekday)} <span className={styles.foil}>(fixed)</span>
            {' · '}
            {weekdayName(c.gregorianWeekday)} <span className={styles.foil}>(real)</span>
            {c.weekdayShift !== null ? (
              <>
                {' · shift '}
                <span className={styles.figure}>{c.weekdayShift}</span>
              </>
            ) : null}
          </span>
          <span className={styles.note}>{shift.detail}</span>
        </Row>
        <Row term="Label drift">
          <span className={styles.main}>
            {c.labelDrift === null ? (
              'none'
            ) : (
              <>
                <span className={styles.figure}>{c.labelDrift > 0 ? `+${c.labelDrift}` : c.labelDrift}</span>{' '}
                {Math.abs(c.labelDrift) === 1 ? 'day' : 'days'}
              </>
            )}
          </span>
          <span className={styles.note}>{drift.detail}</span>
        </Row>
        <Row term="Month length">
          <span className={styles.main}>
            {c.thirteenMonthDays === null ? 'no month' : `${c.thirteenMonthDays} days`}{' '}
            <span className={styles.foil}>
              vs {c.gregorianMonthDays} in Gregorian {gregorianMonthName(c.gregorian.month)}
            </span>
          </span>
        </Row>
        <Row term="The year so far">
          <span className={styles.main}>
            {pluralDays(c.daysIntoYear)} gone · {pluralDays(c.daysRemainingInYear)} to go
          </span>
          <span className={styles.note}>
            {formatPercent(c.yearProgress)} of the year has passed at the start of this day.
          </span>
        </Row>
      </tbody>
    </table>
  );
}
