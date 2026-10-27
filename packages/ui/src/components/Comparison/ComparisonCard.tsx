import {
  type Comparison,
  formatGregorian,
  formatThirteen,
  getCalendarSystem,
  weekdayName,
} from '@thirteen/core';
import { cx } from '../../lib/cx.ts';
import { formatPercent } from '../../lib/dates.ts';
import { reveal } from '../../lib/reveal.ts';
import { Stat } from '../../primitives/Typeset.tsx';
import styles from './Comparison.module.css';

export interface ComparisonCardProps {
  readonly comparison: Comparison;
  readonly revealDelay?: number;
  readonly className?: string;
}

/** "13-month date = Gregorian date" with weekday shift, label drift and progress. */
export function ComparisonCard({ comparison: c, revealDelay, className }: ComparisonCardProps) {
  const system = getCalendarSystem(c.thirteen.system);
  return (
    <section
      className={cx(styles.card, className)}
      aria-label={`${formatThirteen(c.thirteen)} compared with ${formatGregorian(c.gregorian)}`}
      {...reveal('rise', revealDelay)}
    >
      <div className={styles.equation}>
        <div className={styles.side}>
          <span className={styles.sideLabel}>{system.shortName}</span>
          <span className={styles.sideWeekday}>
            {c.thirteenWeekday === null ? 'no weekday' : weekdayName(c.thirteenWeekday)}
          </span>
          <span className={styles.sideDate}>{formatThirteen(c.thirteen)}</span>
        </div>
        <span className={styles.equals} aria-hidden="true">
          =
        </span>
        <div className={cx(styles.side, styles.sideGregorian)}>
          <span className={styles.sideLabel}>Gregorian</span>
          <span className={styles.sideWeekday}>{weekdayName(c.gregorianWeekday)}</span>
          <span className={styles.sideDate}>{formatGregorian(c.gregorian)}</span>
        </div>
      </div>
      <div className={styles.metrics}>
        <Stat label="Weekday shift" value={c.weekdayShift === null ? 'None' : `+${c.weekdayShift}`} />
        <Stat
          label="Label drift"
          value={c.labelDrift === null ? 'None' : c.labelDrift > 0 ? `+${c.labelDrift}` : String(c.labelDrift)}
        />
        <Stat label="Year done" value={formatPercent(c.yearProgress)} tone="accent" />
      </div>
    </section>
  );
}
