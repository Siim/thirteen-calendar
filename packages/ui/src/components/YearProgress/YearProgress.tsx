import { type CalendarSystemId, daysInYear, getCalendarSystem, monthAlignment, ordinal } from '@thirteen/core';
import { useMemo } from 'react';
import { cx } from '../../lib/cx.ts';
import { formatPercent } from '../../lib/dates.ts';
import { cssVars, reveal } from '../../lib/reveal.ts';
import styles from './YearProgress.module.css';

export interface YearProgressProps {
  /** Gregorian year. */
  readonly year: number;
  readonly systemId: CalendarSystemId;
  /** Today's day-of-year (1…366). */
  readonly dayOfYear: number;
  readonly showLabels?: boolean;
  readonly revealDelay?: number;
  readonly className?: string;
}

interface Segment {
  readonly key: string;
  readonly kind: 'month' | 'intercalary';
  /** Month number (0 for intercalary days). */
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly short: string;
  readonly narrow: string;
  readonly name: string;
}

/**
 * The year as 13 equal bars (plus intercalary slivers), filled up to the
 * start of `dayOfYear`, with a needle on the day itself.
 */
export function YearProgress({ year, systemId, dayOfYear, showLabels = true, revealDelay, className }: YearProgressProps) {
  const segments = useMemo<Segment[]>(() => {
    const alignment = monthAlignment(year, systemId);
    const list: Segment[] = [
      ...alignment.thirteenMonths.map((m) => ({
        key: `m${m.month}`,
        kind: 'month' as const,
        index: m.month,
        start: m.startDayOfYear,
        end: m.endDayOfYear,
        short: m.monthInfo.shortName,
        narrow: m.monthInfo.name.charAt(0),
        name: m.monthInfo.name,
      })),
      ...alignment.intercalary.map((d) => ({
        key: d.id,
        kind: 'intercalary' as const,
        index: 0,
        start: d.dayOfYear,
        end: d.dayOfYear,
        short: d.code,
        narrow: '·',
        name: d.name,
      })),
    ];
    return list.sort((a, b) => a.start - b.start);
  }, [year, systemId]);

  const total = daysInYear(year);
  const current = segments.find((s) => dayOfYear >= s.start && dayOfYear <= s.end)!;
  const system = getCalendarSystem(systemId);
  const position =
    current.kind === 'month'
      ? `${current.name}, the ${ordinal(current.index)} of 13 months, day ${dayOfYear - current.start + 1} of 28`
      : `${current.name}, outside every month`;
  const valueText = `Day ${dayOfYear} of ${total}: ${formatPercent((dayOfYear - 1) / total)} of the ${system.shortName} year done; ${position}.`;

  return (
    <div className={cx(styles.progress, className)} {...reveal('rise', revealDelay)}>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={`${system.shortName} year progress`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={dayOfYear - 1}
        aria-valuetext={valueText}
      >
        {segments.map((segment) => {
          const length = segment.end - segment.start + 1;
          const done = Math.min(1, Math.max(0, (dayOfYear - segment.start) / length));
          const isCurrent = segment === current;
          if (segment.kind === 'intercalary') {
            return (
              <span
                key={segment.key}
                className={cx(styles.segment, styles.sliver, done >= 1 && styles.sliverDone)}
                title={segment.name}
                data-segment="intercalary"
              >
                {isCurrent ? <span className={styles.needle} style={cssVars({ '--at': '0%' })} /> : null}
              </span>
            );
          }
          return (
            <span
              key={segment.key}
              className={cx(styles.segment, isCurrent && styles.current)}
              title={segment.name}
              data-segment="month"
            >
              <span className={styles.fill} style={cssVars({ '--fill': `${done * 100}%` })} />
              {isCurrent ? (
                <span className={styles.needle} style={cssVars({ '--at': `${((dayOfYear - segment.start) / length) * 100}%` })} />
              ) : null}
            </span>
          );
        })}
      </div>
      {showLabels ? (
        <div className={styles.labels} aria-hidden="true">
          {segments.map((segment) => (
            <span
              key={segment.key}
              className={cx(
                styles.label,
                segment.kind === 'intercalary' && styles.labelSliver,
                segment === current && styles.labelCurrent,
              )}
            >
              {segment.kind === 'intercalary' ? (
                ''
              ) : (
                <>
                  <span className={styles.short}>{segment.short}</span>
                  <span className={styles.narrow}>{segment.narrow}</span>
                </>
              )}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
