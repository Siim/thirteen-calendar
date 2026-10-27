import { type CalendarSystem, type YearStats, formatGregorian, formatThirteen, weekdayName } from '@thirteen/core';
import { cx } from '@thirteen/ui';
import styles from './ComparePage.module.css';

export interface StatsBoardProps {
  readonly stats: YearStats;
  readonly system: CalendarSystem;
}

function Versus({ gregorian, thirteen, word = false }: { gregorian: string; thirteen: string; word?: boolean }) {
  return (
    <p className={styles.versusFigures}>
      <span className={cx(styles.figGregorian, word && styles.figWord)}>{gregorian}</span>
      <span className={styles.figVs}>vs</span>
      <span className={cx(styles.figThirteen, word && styles.figWord)}>{thirteen}</span>
    </p>
  );
}

/** yearStats(): Friday-13ths, quarter lengths, month shapes and year-start weekdays. */
export function StatsBoard({ stats, system }: StatsBoardProps) {
  const thirteenth = weekdayName(((system.weekStartsOn + 12) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6);
  return (
    <div className={styles.board}>
      <article className={styles.card} aria-labelledby="stat-f13">
        <h3 id="stat-f13" className={styles.cardTitle}>
          Friday the 13ths
        </h3>
        <Versus gregorian={String(stats.gregorianFriday13ths.length)} thirteen={String(stats.thirteenFriday13ths.length)} />
        <ul className={styles.chips} aria-label="Gregorian Friday the 13ths">
          {stats.gregorianFriday13ths.map((pair) => (
            <li key={pair.gregorian.month} className={cx(styles.chip, styles.chipFoil)}>
              {formatGregorian(pair.gregorian, { style: 'short' })} = {formatThirteen(pair.thirteen, { style: 'short' })}
            </li>
          ))}
        </ul>
        <p className={styles.cardBody}>
          {stats.thirteenFriday13ths.length > 0
            ? `In the ${system.shortName} every month has a Friday the 13th, all ${stats.thirteenFriday13ths.length} of them, every year.`
            : `None in the ${system.shortName}: its months start on ${weekdayName(system.weekStartsOn)}, so every 13th is a ${thirteenth}.`}
        </p>
        {stats.thirteenFriday13ths.length > 0 ? (
          <ul className={styles.chips} aria-label={`${system.shortName} Friday the 13ths`}>
            {stats.thirteenFriday13ths.map((pair) => (
              <li key={formatThirteen(pair.thirteen, { style: 'numeric' })} className={cx(styles.chip, styles.chipAccent)}>
                {formatThirteen(pair.thirteen, { style: 'short' })}
              </li>
            ))}
          </ul>
        ) : null}
      </article>

      <article className={styles.card} aria-labelledby="stat-quarters">
        <h3 id="stat-quarters" className={styles.cardTitle}>
          Quarter lengths
        </h3>
        <Versus gregorian={stats.gregorianQuarterLengths.join('·')} thirteen="91×4" word />
        <div className={styles.quarters}>
          <div className={styles.quarterRow}>
            <span className={styles.quarterLabel}>Gregorian</span>
            <span className={styles.quarterBars}>
              {stats.gregorianQuarterLengths.map((days, i) => (
                <span
                  key={i}
                  className={cx(styles.quarterBar, styles.quarterBarFoil)}
                  style={{ flex: `${days} 1 0` }}
                  aria-label={`Quarter ${i + 1}: ${days} days`}
                  role="img"
                >
                  {days}
                </span>
              ))}
            </span>
          </div>
          <div className={styles.quarterRow}>
            <span className={styles.quarterLabel}>{system.shortName}</span>
            <span className={styles.quarterBars}>
              {stats.thirteenQuarterLengths.map((days, i) => (
                <span
                  key={i}
                  className={cx(styles.quarterBar, styles.quarterBarAccent)}
                  style={{ flex: `${days} 1 0` }}
                  aria-label={`Quarter ${i + 1}: ${days} days`}
                  role="img"
                >
                  {days}
                </span>
              ))}
              <span
                className={cx(styles.quarterBar, styles.quarterBarGap)}
                style={{ flex: `${stats.intercalaryDayCount} 0 0`, minWidth: '6px' }}
                aria-label={`${stats.intercalaryDayCount} intercalary ${stats.intercalaryDayCount === 1 ? 'day' : 'days'} outside the quarters`}
                role="img"
              />
            </span>
          </div>
        </div>
        <p className={styles.cardBody}>Each 13-month quarter is exactly 3¼ months: 13 weeks, 91 days.</p>
      </article>

      <article className={styles.card} aria-labelledby="stat-shapes">
        <h3 id="stat-shapes" className={styles.cardTitle}>
          Month shapes
        </h3>
        <Versus gregorian={String(stats.gregorianMonthShapeCount)} thirteen={String(stats.thirteenMonthShapeCount)} />
        <p className={styles.cardBody}>
          A month’s shape is its length plus the weekday it starts on. The Gregorian year uses{' '}
          {stats.gregorianMonthShapeCount} different shapes; the {system.shortName} prints one sheet thirteen times.
        </p>
      </article>

      <article className={styles.card} aria-labelledby="stat-start">
        <h3 id="stat-start" className={styles.cardTitle}>
          The year begins on
        </h3>
        <Versus
          gregorian={weekdayName(stats.gregorianYearStartWeekday, 'short')}
          thirteen={weekdayName(stats.thirteenYearStartWeekday, 'short')}
          word
        />
        <p className={styles.cardBody}>
          1 January {stats.year} is a real {weekdayName(stats.gregorianYearStartWeekday)}; the {system.shortName} calls it{' '}
          {weekdayName(stats.thirteenYearStartWeekday)}, as it does every year.
        </p>
      </article>
    </div>
  );
}
