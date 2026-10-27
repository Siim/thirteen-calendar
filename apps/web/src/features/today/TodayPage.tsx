import {
  formatThirteen,
  intercalaryDaysInYear,
  ordinal,
  toISODate,
} from '@thirteen/core';
import {
  DatePlate,
  GregorianMonthGrid,
  Icon,
  IntercalaryDayToken,
  Kicker,
  SectionHeading,
  ThirteenMonthGrid,
  useCalendarSystem,
  useComparison,
  useGregorianMonthLayout,
  useMonthLayout,
  useToday,
} from '@thirteen/ui';
import { Link } from '../../app/Link.tsx';
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts';
import { DriftNotes } from './DriftNotes.tsx';
import { UpNext } from './UpNext.tsx';
import { YearSoFar } from './YearSoFar.tsx';
import styles from './TodayPage.module.css';

/** §5.1 Today: the date in the 13-month system, its Gregorian twin, drift, progress and this month. */
export function TodayPage() {
  const today = useToday();
  const { systemId, system } = useCalendarSystem();
  const comparison = useComparison(today, systemId);
  const thirteen = comparison.thirteen;
  const intercalary =
    thirteen.kind === 'intercalary'
      ? intercalaryDaysInYear(today.year, systemId).find((d) => d.id === thirteen.id)!
      : null;
  // On an intercalary day, show the month it follows.
  const monthNumber = thirteen.kind === 'month' ? thirteen.month : intercalary!.afterMonth;
  const month = useMonthLayout(today.year, monthNumber, systemId);
  const gregorianMonth = useGregorianMonthLayout(today.year, today.month, systemId);

  useDocumentTitle(formatThirteen(thirteen, { includeWeekday: true }));

  const headline =
    comparison.labelDrift !== null && comparison.labelDrift > 0 ? (
      <>
        The 13-month label runs <strong>{comparison.labelDrift} days behind</strong> the Gregorian one.
      </>
    ) : comparison.labelDrift !== null && comparison.labelDrift < 0 ? (
      <>
        The 13-month label runs <strong>{-comparison.labelDrift} days ahead</strong> of the Gregorian one.
      </>
    ) : comparison.labelDrift === 0 ? (
      <>
        Today the labels agree: <strong>same month, same day</strong> in both calendars.
      </>
    ) : thirteen.kind === 'intercalary' ? (
      <>
        Today belongs to <strong>no week and no month</strong>.
      </>
    ) : (
      <>
        <strong>{system.months[monthNumber - 1]!.name}</strong> has no Gregorian namesake, so the labels cannot be
        compared, only the days.
      </>
    );

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="today-title">
        <div className={styles.heroMain}>
          <Kicker mark={`Day ${comparison.dayOfYear}`} as="h1">
            <span id="today-title">Today in the {system.name}</span>
          </Kicker>
          {intercalary ? (
            <IntercalaryDayToken occurrence={intercalary} variant="plate" today revealDelay={80} />
          ) : (
            <DatePlate date={thirteen} size="hero" kicker={null} revealDelay={80} />
          )}
          <p className={styles.code} data-reveal="rise" style={{ ['--reveal-delay' as string]: '260ms' }}>
            <span>
              Numeric <b>{formatThirteen(thirteen, { style: 'numeric' })}</b>
            </span>
            <span>
              ISO <b>{toISODate(today)}</b>
            </span>
            <span>
              Day <b>{ordinal(comparison.dayOfYear)}</b>
            </span>
          </p>
          <p className={styles.headline} data-reveal="rise" style={{ ['--reveal-delay' as string]: '340ms' }}>
            {headline}
          </p>
        </div>
        <aside className={styles.heroAside} aria-label="The Gregorian reckoning">
          <DatePlate date={today} size="md" kicker="The Gregorian reckoning" revealDelay={220} />
          <DriftNotes comparison={comparison} />
        </aside>
      </section>

      <UpNext />

      <YearSoFar today={today} comparison={comparison} />

      <section className={styles.month} aria-labelledby="this-month">
        <SectionHeading
          numeral="§ 2"
          id="this-month"
          title={
            <>
              This month, <em>four perfect weeks</em>
            </>
          }
          lede={`${system.months[monthNumber - 1]!.name} has 28 days, starts on a ${system.id === 'ifc' ? 'Sunday' : 'Monday'} and ends on a ${system.id === 'ifc' ? 'Saturday' : 'Sunday'}, exactly like every other month of the year. The Gregorian month beside it is the ragged original.`}
        />
        <div className={styles.monthGrids}>
          <div className={styles.monthColumn}>
            <p className={styles.monthLabel}>
              <strong>Thirteen · 4 × 7</strong>
              <span>Gregorian dates in small type</span>
            </p>
            <ThirteenMonthGrid layout={month} today={today} size="lg" showGregorian revealDelay={420} />
            {intercalary ? <IntercalaryDayToken occurrence={intercalary} today /> : null}
          </div>
          <div className={styles.monthColumn}>
            <p className={`${styles.monthLabel} ${styles.monthLabelFoil}`}>
              <strong>Gregorian · {gregorianMonth.weeks.length} rows</strong>
              <span>{system.shortName} dates in small type</span>
            </p>
            <GregorianMonthGrid layout={gregorianMonth} today={today} size="md" revealDelay={620} />
            <p className={styles.monthNote}>
              {gregorianMonth.monthInfo.name} has {comparison.gregorianMonthDays} days and{' '}
              {gregorianMonth.leadingBlanks === 0 ? 'no empty cells before' : `${gregorianMonth.leadingBlanks} empty cells before`} its
              first day; next month will have a different shape again.
            </p>
          </div>
        </div>
        <div className={styles.links}>
          <Link className={styles.more} to={{ name: 'year', year: today.year, day: toISODate(today) }}>
            The whole year <Icon name="arrow-right" size={16} />
          </Link>
          <Link className={styles.more} to={{ name: 'convert', date: toISODate(today), thirteen: null, system: null }}>
            Convert another date <Icon name="arrow-right" size={16} />
          </Link>
          <Link className={styles.more} to={{ name: 'compare', year: today.year }}>
            Twelve against thirteen <Icon name="arrow-right" size={16} />
          </Link>
        </div>
      </section>
    </div>
  );
}
