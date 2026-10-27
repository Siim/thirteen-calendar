import { type Comparison, type GregorianDate, formatGregorian, getCalendarSystem, intercalaryDaysInYear } from '@thirteen/core';
import {
  SectionHeading,
  Stat,
  YearProgress,
  formatPercent,
  useDaysUntilYearDay,
} from '@thirteen/ui';
import styles from './TodayPage.module.css';

export interface YearSoFarProps {
  readonly today: GregorianDate;
  readonly comparison: Comparison;
}

/** Progress across 13 equal months and the countdown to the year-day. */
export function YearSoFar({ today, comparison: c }: YearSoFarProps) {
  const systemId = c.thirteen.system;
  const system = getCalendarSystem(systemId);
  const untilYearDay = useDaysUntilYearDay(today, systemId);
  const yearDay = system.intercalaryDays.find((d) => d.id === 'year-day')!;
  const total = c.daysIntoYear + 1 + c.daysRemainingInYear;
  const countdownYear = intercalaryDaysInYear(untilYearDay > c.daysRemainingInYear ? today.year + 1 : today.year, systemId);
  const yearDayOccurrence = countdownYear.find((d) => d.id === 'year-day')!;
  // A Positivist leap year ends with Holy Women, the day after All the Dead.
  const closingDay = countdownYear.find((d) => d.dayOfYear > yearDayOccurrence.dayOfYear) ?? null;
  const yearDayText = formatGregorian(yearDayOccurrence.gregorian, { includeWeekday: true });

  return (
    <section className={styles.band} aria-labelledby="year-so-far">
      <SectionHeading
        numeral="§ 1"
        id="year-so-far"
        title={
          <>
            The year so far, <em>in thirteen equal parts</em>
          </>
        }
      />
      <YearProgress year={today.year} systemId={systemId} dayOfYear={c.dayOfYear} revealDelay={300} />
      <div className={styles.stats}>
        <Stat label="Day of the year" value={`${c.dayOfYear}`} note={`of ${total}${c.isLeapYear ? ' (leap year)' : ''}`} />
        <Stat label="Year done" value={formatPercent(c.yearProgress)} note={`${c.daysIntoYear} days behind us`} />
        <Stat
          label={c.thirteen.kind === 'month' ? 'Month' : 'Outside the months'}
          value={c.thirteen.kind === 'month' ? `${c.thirteen.month} / 13` : 'None'}
          note={
            c.thirteen.kind === 'month'
              ? `day ${c.thirteen.day} of 28 · week ${Math.ceil(c.thirteen.day / 7)} of 4`
              : 'an intercalary day'
          }
        />
        <Stat
          label="Week"
          value={c.thirteen.kind === 'month' ? `${(c.thirteen.month - 1) * 4 + Math.ceil(c.thirteen.day / 7)} / 52` : 'None'}
          note="every 13-month year has exactly 52 weeks"
        />
      </div>
      <div className={styles.countdown}>
        <span className={styles.countdownNumber}>{untilYearDay}</span>
        <div className={styles.countdownText}>
          <p className={styles.countdownTitle}>
            {untilYearDay === 0 ? `Today is ${yearDay.name}` : `${untilYearDay === 1 ? 'day' : 'days'} until ${yearDay.name}`}
          </p>
          <p className={styles.countdownBody}>
            {closingDay
              ? `${yearDay.name} belongs to no week and no month; it falls on Gregorian ${yearDayText}, and the ${closingDay.name} closes the leap year the next day.`
              : `${yearDay.name} belongs to no week and no month; it closes the year on Gregorian ${yearDayText}.`}
          </p>
        </div>
      </div>
    </section>
  );
}
