import { type CalendarSystemId, type YearStats, GREGORIAN_MONTHS, getCalendarSystem, intercalaryDaysInYear } from '@thirteen/core';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { cssVars, reveal } from '../../lib/reveal.ts';
import styles from './MonthLengthBars.module.css';

export interface MonthLengthBarsProps {
  readonly stats: YearStats;
  readonly systemId?: CalendarSystemId;
  readonly caption?: ReactNode;
  readonly revealDelay?: number;
  readonly className?: string;
}

const SCALE = 31;
const pct = (days: number) => `${(days / SCALE) * 100}%`;

/**
 * Month lengths side by side: 12 Gregorian months of 28 to 31 days (the excess
 * over 28 hatched in the accent) against 13 identical months of 28.
 */
export function MonthLengthBars({ stats, systemId = stats.system, caption, revealDelay, className }: MonthLengthBarsProps) {
  const system = getCalendarSystem(systemId);
  const intercalary = intercalaryDaysInYear(stats.year, systemId);
  const gregorianSum = stats.gregorianMonthLengths.join(' + ');
  return (
    <figure className={cx(styles.figure, className)} {...reveal('rise', revealDelay)}>
      <div className={styles.panels}>
        <section className={cx(styles.panel, styles.foil)} aria-label="Gregorian month lengths">
          <h3 className={styles.panelTitle}>
            <span>Twelve months</span>
            <span className={styles.panelSum}>{stats.daysInYear} days, 28 to 31 each</span>
          </h3>
          <ol className={styles.rows}>
            {stats.gregorianMonthLengths.map((length, i) => (
              <li
                key={i}
                className={styles.row}
                aria-label={`${GREGORIAN_MONTHS[i]!.name}: ${length} days${length > 28 ? `, ${length - 28} more than 28` : ''}`}
                style={cssVars({ '--row': i })}
              >
                <span className={styles.name} aria-hidden="true">
                  {GREGORIAN_MONTHS[i]!.shortName}
                </span>
                <span
                  className={styles.track}
                  aria-hidden="true"
                  style={cssVars({ '--guide': pct(28), '--base': pct(Math.min(28, length)), '--excess': pct(Math.max(0, length - 28)) })}
                >
                  <span className={styles.base} />
                  {length > 28 ? <span className={styles.excess} /> : null}
                </span>
                <span className={styles.value} aria-hidden="true">
                  {length}
                  {length > 28 ? <sup className={styles.extra}>+{length - 28}</sup> : null}
                </span>
              </li>
            ))}
          </ol>
          <p className={styles.panelSum} style={{ textAlign: 'left' }}>
            {gregorianSum} = {stats.daysInYear}
          </p>
        </section>
        <section className={cx(styles.panel, styles.thirteen)} aria-label={`${system.shortName} month lengths`}>
          <h3 className={styles.panelTitle}>
            <span>Thirteen months</span>
            <span className={styles.panelSum}>
              13 × 28 + {intercalary.length} = {stats.daysInYear}
            </span>
          </h3>
          <ol className={styles.rows}>
            {system.months.map((month, i) => (
              <li
                key={month.index}
                className={styles.row}
                aria-label={`${month.name}: 28 days`}
                style={cssVars({ '--row': i })}
              >
                <span className={styles.name} aria-hidden="true">
                  {month.shortName}
                </span>
                <span className={styles.track} aria-hidden="true" style={cssVars({ '--guide': pct(28), '--base': pct(28) })}>
                  <span className={styles.base} />
                </span>
                <span className={styles.value} aria-hidden="true">
                  28
                </span>
              </li>
            ))}
            {intercalary.map((day, i) => (
              <li
                key={day.id}
                className={cx(styles.row, styles.intercalaryRow)}
                aria-label={`${day.name}: 1 day outside every month`}
                style={cssVars({ '--row': 13 + i })}
              >
                <span className={styles.name} aria-hidden="true" title={day.name}>
                  {day.shortName}
                </span>
                <span className={styles.track} aria-hidden="true" style={cssVars({ '--guide': pct(28), '--base': pct(1) })}>
                  <span className={styles.base} />
                </span>
                <span className={styles.value} aria-hidden="true">
                  1
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      {caption !== undefined ? <figcaption className={styles.caption}>{caption}</figcaption> : null}
    </figure>
  );
}
