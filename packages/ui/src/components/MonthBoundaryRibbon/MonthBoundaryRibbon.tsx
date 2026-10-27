import {
  type GregorianDate,
  type MonthAlignment,
  formatGregorian,
  formatThirteen,
  getCalendarSystem,
  gregorianDayOfYear,
} from '@thirteen/core';
import { type ReactNode, useId } from 'react';
import { cx } from '../../lib/cx.ts';
import { cssVars, reveal } from '../../lib/reveal.ts';
import styles from './MonthBoundaryRibbon.module.css';

export interface MonthBoundaryRibbonProps {
  readonly alignment: MonthAlignment;
  /** Draws a "today" needle when it falls in the alignment's year. */
  readonly today?: GregorianDate | null;
  /**
   * How boundaries are connected: `namesake` links each Gregorian month to
   * the 13-month month carrying its name (IFC), `ordinal` links the n-th
   * months. `auto` picks `namesake` when the system has namesakes.
   */
  readonly connectors?: 'auto' | 'namesake' | 'ordinal';
  readonly caption?: ReactNode;
  readonly revealDelay?: number;
  readonly className?: string;
}

interface Link {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly drift: number;
}

const TICKS = [1, 50, 100, 150, 200, 250, 300, 350];
/** Intercalary flags this close to the year's end are anchored to the right edge (no clipping). */
const END_ZONE_DAYS = 20;

/**
 * One year on a shared day-of-year axis: the 12 ragged Gregorian months on
 * top, the 13 equal months plus intercalary slivers below, and connectors
 * showing how far each pair of month boundaries has drifted apart.
 */
export function MonthBoundaryRibbon({
  alignment,
  today = null,
  connectors = 'auto',
  caption,
  revealDelay,
  className,
}: MonthBoundaryRibbonProps) {
  const id = useId();
  const system = getCalendarSystem(alignment.system);
  const days = alignment.daysInYear;
  const x = (dayOfYear: number) => ((dayOfYear - 1) / days) * 100;
  const w = (length: number) => (length / days) * 100;
  const mode =
    connectors === 'auto'
      ? system.months.some((m) => m.gregorianNameEquivalent !== null)
        ? 'namesake'
        : 'ordinal'
      : connectors;

  const links: Link[] = alignment.gregorianMonths.flatMap((g): Link[] => {
    const partner =
      mode === 'namesake'
        ? alignment.thirteenMonths.find((t) => t.monthInfo.gregorianNameEquivalent === g.month)
        : alignment.thirteenMonths[g.month - 1];
    if (!partner) return [];
    return [{ key: `${g.month}`, from: g.startDayOfYear, to: partner.startDayOfYear, drift: partner.startDayOfYear - g.startDayOfYear }];
  });

  const segments = [
    ...alignment.thirteenMonths.map((m) => ({ kind: 'month' as const, start: m.startDayOfYear, m })),
    ...alignment.intercalary.map((d) => ({ kind: 'intercalary' as const, start: d.dayOfYear, d })),
  ].sort((a, b) => a.start - b.start);

  const todayDoy = today && today.year === alignment.year ? gregorianDayOfYear(today) : null;
  const intercalaryCount = alignment.intercalary.length;
  // Flags of year-end days hang inside the right edge, the last one outermost;
  // the axis drops ticks they would collide with.
  const endFlags = alignment.intercalary.filter((d) => d.dayOfYear > days - END_ZONE_DAYS).map((d) => d.id);
  const ticks = TICKS.filter((t) => t <= days && (endFlags.length === 0 || t <= days - END_ZONE_DAYS));

  return (
    <figure className={cx(styles.figure, className)} aria-labelledby={`${id}-caption`} {...reveal('rise', revealDelay)}>
      <p className={styles.hint} aria-hidden="true">
        Scroll the ribbon sideways →
      </p>
      <div className={styles.scroller} tabIndex={0} role="region" aria-label={`Month boundaries ${alignment.year}, scrollable`}>
        <div className={styles.canvas}>
          <div className={cx(styles.side, styles.sideGregorian)} aria-hidden="true">
            <strong>12</strong>Gregorian
          </div>
          <ol className={cx(styles.track, styles.trackGregorian)} aria-label="12 Gregorian months">
            {alignment.gregorianMonths.map((month) => (
              <li
                key={month.month}
                className={styles.seg}
                data-segment="gregorian"
                style={cssVars({ '--x': `${x(month.startDayOfYear)}%`, '--w': `${w(month.length)}%` })}
                aria-label={`${month.monthInfo.name}: ${month.length} days, ${system.shortName} ${formatThirteen(month.start, { style: 'short' })} to ${formatThirteen(month.end, { style: 'short' })}`}
              >
                <span className={styles.segName} aria-hidden="true">
                  {month.monthInfo.shortName}
                </span>
                <span className={styles.segDays} aria-hidden="true">
                  {month.length}d
                </span>
              </li>
            ))}
          </ol>

          <svg
            className={styles.links}
            viewBox={`0 0 ${days} 100`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {links.map((link) => (
              <line
                key={link.key}
                className={cx(styles.link, link.drift === 0 && styles.linkZero)}
                x1={link.from - 1}
                y1={0}
                x2={link.to - 1}
                y2={100}
              />
            ))}
          </svg>
          <div className={styles.drifts} aria-hidden="true">
            {links
              .filter((link) => link.drift !== 0)
              .map((link) => (
                <span
                  key={link.key}
                  className={styles.drift}
                  style={cssVars({ '--x': `${(x(link.from) + x(link.to)) / 2}%` })}
                >
                  {link.drift > 0 ? `+${link.drift}` : `−${-link.drift}`}
                </span>
              ))}
          </div>

          <ol
            className={cx(styles.track, styles.trackThirteen)}
            aria-label={`13 months of 28 days and ${intercalaryCount} intercalary ${intercalaryCount === 1 ? 'day' : 'days'}`}
          >
            {segments.map((segment) =>
              segment.kind === 'month' ? (
                <li
                  key={`m${segment.m.month}`}
                  className={styles.seg}
                  data-segment="thirteen"
                  style={cssVars({ '--x': `${x(segment.m.startDayOfYear)}%`, '--w': `${w(28)}%` })}
                  aria-label={`${segment.m.monthInfo.name}: 28 days, Gregorian ${formatGregorian(segment.m.start, { style: 'short' })} to ${formatGregorian(segment.m.end, { style: 'short' })}`}
                >
                  <span className={styles.segName} aria-hidden="true">
                    {segment.m.monthInfo.shortName}
                  </span>
                  <span className={styles.segDays} aria-hidden="true">
                    28d
                  </span>
                </li>
              ) : (
                <li
                  key={segment.d.id}
                  className={cx(styles.seg, styles.sliver)}
                  data-segment="intercalary"
                  data-flag-stack={endFlags.includes(segment.d.id) ? endFlags.length - 1 - endFlags.indexOf(segment.d.id) : undefined}
                  style={cssVars({ '--x': `${x(segment.d.dayOfYear)}%`, '--w': `${w(1)}%` })}
                  aria-label={`${segment.d.name}: 1 day outside every month, Gregorian ${formatGregorian(segment.d.gregorian, { style: 'short' })}`}
                >
                  <span className={styles.flag} aria-hidden="true">
                    {segment.d.code}
                  </span>
                </li>
              ),
            )}
          </ol>
          <div className={cx(styles.side, styles.sideThirteen)} aria-hidden="true">
            <strong>13</strong>
            {system.shortName}
          </div>

          <div className={styles.axis} aria-hidden="true">
            {ticks.map((tick) => (
              <span key={tick} className={styles.tick} style={cssVars({ '--x': `${x(tick)}%` })}>
                {tick === 1 ? 'day 1' : tick}
              </span>
            ))}
          </div>

          {todayDoy !== null ? (
            <div className={styles.needleWrap} aria-hidden="true">
              <span
                className={styles.needle}
                data-edge={todayDoy <= 12 ? 'start' : todayDoy > days - 12 ? 'end' : undefined}
                style={cssVars({ '--x': `${x(todayDoy) + w(0.5)}%` })}
              >
                <span className={styles.needleLabel}>Today</span>
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <figcaption id={`${id}-caption`} className={styles.caption}>
        {caption ??
          (mode === 'namesake'
            ? `Each line joins a Gregorian month to the ${system.shortName} month with the same name; the number is how many days later (+) or earlier (−) the ${system.shortName} month begins. Sol has no namesake.`
            : `Each line joins the n-th Gregorian month to the n-th ${system.shortName} month; the number is how many days earlier (−) or later the ${system.shortName} month begins.`)}
      </figcaption>
    </figure>
  );
}
