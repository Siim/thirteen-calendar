import { type CalendarSystem, type YearStats, GREGORIAN_CALENDAR, weekdayName } from '@thirteen/core';
import { Kicker, Stat, cx } from '@thirteen/ui';
import styles from './ComparePage.module.css';

export interface SystemsSideBySideProps {
  readonly system: CalendarSystem;
  readonly stats: YearStats;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** GREGORIAN_CALENDAR against the selected 13-month system: who, when, and the month tables. */
export function SystemsSideBySide({ system, stats }: SystemsSideBySideProps) {
  const always = system.intercalaryDays.filter((d) => !d.leapOnly).map((d) => d.shortName);
  const leapOnly = system.intercalaryDays.filter((d) => d.leapOnly).map((d) => d.shortName);
  const intercalary = `${always.join(' + ')}${leapOnly.length ? ` (+ ${leapOnly.join(' + ')} in leap years)` : ''}`;
  return (
    <div className={styles.systems}>
      <article className={cx(styles.system, styles.foil)} aria-labelledby="system-gregorian">
        <Kicker mark={String(GREGORIAN_CALENDAR.proposedYear)}>The twelve</Kicker>
        <h2 id="system-gregorian" className={styles.systemName}>
          {GREGORIAN_CALENDAR.name}
        </h2>
        <p className={styles.inventor}>Promulgated by {GREGORIAN_CALENDAR.inventor}</p>
        <p className={styles.summary}>{GREGORIAN_CALENDAR.summary}</p>
        <ol className={styles.months} aria-label="Gregorian months and their lengths">
          {GREGORIAN_CALENDAR.months.map((month, i) => {
            const days = stats.gregorianMonthLengths[i]!;
            return (
              <li key={month.index} className={cx(styles.monthItem, days > 28 && styles.monthLong)}>
                <span className={styles.monthIndex} aria-hidden="true">
                  {pad2(month.index)}
                </span>
                <span className={styles.monthName}>{month.name}</span>
                <span className={styles.monthDays}>{days}</span>
              </li>
            );
          })}
        </ol>
        <div className={styles.figures}>
          <Stat label="Months" value="12" note="of 28 to 31 days" />
          <Stat label="Month shapes" value={String(stats.gregorianMonthShapeCount)} note="in this year" />
          <Stat label="1 January" value={weekdayName(stats.gregorianYearStartWeekday, 'short')} note="changes every year" />
        </div>
      </article>
      <div className={styles.versus} aria-hidden="true">
        vs
      </div>
      <article className={styles.system} aria-labelledby="system-thirteen">
        <Kicker mark={String(system.proposedYear)} tone="accent">
          The thirteen
        </Kicker>
        <h2 id="system-thirteen" className={styles.systemName}>
          {system.name}
        </h2>
        <p className={styles.inventor}>Proposed by {system.inventor}</p>
        <p className={styles.summary}>{system.summary}</p>
        <ol className={styles.months} aria-label={`${system.shortName} months, 28 days each`}>
          {system.months.map((month) => (
            <li
              key={month.index}
              className={cx(styles.monthItem, month.gregorianNameEquivalent === null && system.id === 'ifc' && styles.monthSol)}
              title={month.meaning}
            >
              <span className={styles.monthIndex} aria-hidden="true">
                {pad2(month.index)}
              </span>
              <span className={styles.monthName}>{month.name}</span>
              <span className={styles.monthDays}>28</span>
            </li>
          ))}
        </ol>
        <div className={styles.figures}>
          <Stat label="Months" value="13" note={`of 28 days, + ${intercalary}`} tone="accent" />
          <Stat label="Month shapes" value="1" note="every month alike" tone="accent" />
          <Stat
            label="Day 1"
            value={weekdayName(system.weekStartsOn, 'short')}
            note="every month, every year"
            tone="accent"
          />
        </div>
      </article>
    </div>
  );
}
