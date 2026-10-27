import { type ThirteenYearLayout, type YearStats, weekdayName } from '@thirteen/core';
import { Stat, useTheme } from '@thirteen/ui';
import styles from './YearPage.module.css';

export interface YearLegendProps {
  readonly layout: ThirteenYearLayout;
  readonly stats: YearStats;
}

/** Key to the marks, set in the space the 13th month leaves free. */
export function YearLegend({ layout, stats }: YearLegendProps) {
  const restDay = layout.system === 'ifc' ? 'first' : 'last';
  // Mono's accent is its ink, so there Sundays are set in bold instead.
  const restMark = useTheme().paletteInfo.monochrome ? 'in bold' : 'in the accent colour';
  return (
    <div className={styles.legend}>
      <h3 className={styles.legendTitle}>How to read the sheet</h3>
      <ul className={styles.legendList}>
        <li className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchToday}`} aria-hidden="true">
            12
          </span>
          <span>Today, printed as a solid block.</span>
        </li>
        <li className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchRest}`} aria-hidden="true">
            {layout.system === 'ifc' ? 1 : 7}
          </span>
          <span>
            Sundays {restMark}: always the {restDay} column, in every month.
          </span>
        </li>
        <li className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchTab}`} aria-hidden="true">
            25
          </span>
          <span>A tab marks the day a Gregorian month begins.</span>
        </li>
        <li className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchSlip}`} aria-hidden="true">
            YD
          </span>
          <span>A perforated slip is a day outside every week and month.</span>
        </li>
      </ul>
      <div className={styles.legendFacts}>
        <Stat label="Month shapes" value={`1 vs ${stats.gregorianMonthShapeCount}`} note="13-month vs Gregorian" />
        <Stat label="Year begins" value={weekdayName(stats.thirteenYearStartWeekday)} note={`really a ${weekdayName(stats.gregorianYearStartWeekday)}`} />
        <Stat label="Quarters" value="91 × 4" note={`Gregorian ${stats.gregorianQuarterLengths.join(' / ')}`} />
      </div>
    </div>
  );
}
