import {
  GREGORIAN_MONTHS,
  MAX_YEAR,
  MIN_YEAR,
  addGregorianDays,
  compare,
  gregorianWeekday,
  intercalaryDaysInYear,
  isLeapYear,
  weekdayName,
} from '@thirteen/core';
import {
  MonthBoundaryRibbon,
  MonthLengthBars,
  SectionHeading,
  WeekdayDriftStrip,
  type WeekdayDriftRow,
  YearStepper,
  pluralDays,
  useCalendarSystem,
  useMonthAlignment,
  useToday,
  useYearStats,
} from '@thirteen/ui';
import { useMemo } from 'react';
import { PageHeader } from '../../app/PageHeader.tsx';
import { navigate } from '../../app/router.ts';
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts';
import { StatsBoard } from './StatsBoard.tsx';
import { SystemsSideBySide } from './SystemsSideBySide.tsx';
import styles from './ComparePage.module.css';

export interface ComparePageProps {
  /** Gregorian year from the URL; `null` = this year. */
  readonly year: number | null;
}

/**
 * A `weekdayShift` (0 to 6, fixed minus real) as words before "the real one":
 * "in step with", "3 days ahead of", "2 days behind". Shifts of 4 to 6 read as
 * 3 to 1 days behind on the 7-day cycle unless `direction` says otherwise.
 */
function weekRelation(shift: number, direction: 'ahead' | 'behind' = shift <= 3 ? 'ahead' : 'behind'): string {
  if (shift === 0) return 'in step with';
  return direction === 'ahead' ? `${pluralDays(shift)} ahead of` : `${pluralDays(7 - shift)} behind`;
}

/** §5.4 Compare: 12 ragged months against 13 equal ones. */
export function ComparePage({ year: yearParam }: ComparePageProps) {
  const today = useToday();
  const { systemId, system } = useCalendarSystem();
  const year = yearParam ?? today.year;
  const stats = useYearStats(year, systemId);
  const alignment = useMonthAlignment(year, systemId);

  useDocumentTitle(`12 vs 13 in ${year}`);

  const monthStarts: WeekdayDriftRow[] = GREGORIAN_MONTHS.map((month) => {
    const weekday = gregorianWeekday({ year, month: month.index, day: 1 });
    return {
      key: `g${month.index}`,
      label: month.shortName,
      weekday,
      description: `${month.name} ${year} begins on a ${weekdayName(weekday)}`,
    };
  });
  const thirteenStarts: WeekdayDriftRow[] = system.months.map((month) => ({
    key: `t${month.index}`,
    label: month.shortName,
    weekday: system.weekStartsOn,
    description: `${month.name} begins on a ${weekdayName(system.weekStartsOn)}`,
  }));

  const yearRows = useMemo<WeekdayDriftRow[]>(() => {
    const first = Math.max(MIN_YEAR, Math.min(year - 5, MAX_YEAR - 11));
    return Array.from({ length: 12 }, (_, i) => first + i).map((y) => {
      const real = gregorianWeekday({ year: y, month: 1, day: 1 });
      return {
        key: String(y),
        label: `${y}${isLeapYear(y) ? ' ·L' : ''}`,
        weekday: real,
        highlight: y === year,
        description: `${y}: the ${system.shortName}’s ${weekdayName(system.weekStartsOn)} New Year’s Day is really a ${weekdayName(real)}${isLeapYear(y) ? ' (leap year)' : ''}`,
      };
    });
  }, [year, system]);

  // The fixed week against the real one on 1 January, and again after a mid-year intercalary day (IFC Leap
  // Day), which pauses the fixed week for a day. Positivist festivals close the year, so nothing follows them.
  const shift = compare({ year, month: 1, day: 1 }, systemId).weekdayShift!;
  const midYear = intercalaryDaysInYear(year, systemId).find((d) => d.afterMonth < 13) ?? null;
  const shiftAfter = midYear ? compare(addGregorianDays(midYear.gregorian, 1), systemId).weekdayShift! : null;
  // Keep both halves in one direction, so the day lost at Leap Day always reads as "a day further behind".
  const directionAfter = shift >= 1 && shift <= 3 ? 'ahead' : 'behind';

  return (
    <div className={styles.page}>
      <PageHeader
        mark="§ IV"
        kicker={`Compare · ${year}`}
        title={
          <>
            Twelve against <em>thirteen</em>
          </>
        }
        lede="The same 365 or 366 days, cut two ways: twelve months of 28 to 31 days that start on any weekday, or thirteen identical four-week months and a day or two left outside the week."
      >
        <YearStepper year={year} onChange={(next) => navigate({ name: 'compare', year: next })} systemId="ifc" />
      </PageHeader>

      <SystemsSideBySide system={system} stats={stats} />

      <section className={styles.section} aria-labelledby="ribbon">
        <SectionHeading
          numeral="§ 1"
          id="ribbon"
          title={
            <>
              Where the months <em>begin</em>
            </>
          }
          lede={`${year} on one axis: the Gregorian months above, the ${system.shortName} months below. Same days, different cuts.`}
        />
        <MonthBoundaryRibbon alignment={alignment} today={today} revealDelay={200} />
      </section>

      <section className={styles.section} aria-labelledby="lengths">
        <SectionHeading
          numeral="§ 2"
          id="lengths"
          title={
            <>
              How long a <em>month</em> is
            </>
          }
        />
        <MonthLengthBars
          stats={stats}
          caption="The dashed line is 28 days. The hatched end of a bar is what each Gregorian month carries beyond four weeks."
        />
      </section>

      <section className={styles.section} aria-labelledby="numbers">
        <SectionHeading
          numeral="§ 3"
          id="numbers"
          title={
            <>
              The year <em>in numbers</em>
            </>
          }
        />
        <StatsBoard stats={stats} system={system} />
      </section>

      <section className={styles.section} aria-labelledby="drift">
        <SectionHeading
          numeral="§ 4"
          id="drift"
          title={
            <>
              Weekday <em>drift</em>
            </>
          }
          lede="A fixed calendar trades one kind of drift for another."
        />
        <div className={styles.strips}>
          <WeekdayDriftStrip
            title={`Gregorian months begin… (${year})`}
            rows={monthStarts}
            weekStartsOn={system.weekStartsOn}
            tone="foil"
            caption="The 1st wanders across the week: each month starts up to three weekdays after the one before, depending on how long that month was."
          />
          <WeekdayDriftStrip
            title={`${system.shortName} months begin…`}
            rows={thirteenStarts}
            weekStartsOn={system.weekStartsOn}
            tone="accent"
            caption={`Every month starts on ${weekdayName(system.weekStartsOn)}: 28 days is exactly four weeks.`}
          />
          <WeekdayDriftStrip
            title={`The ${system.shortName} New Year is really a…`}
            rows={yearRows}
            weekStartsOn={system.weekStartsOn}
            tone="accent"
            caption="The price: intercalary days sit outside the week, so the fixed week slips against the real one by a day a year, two after a leap year (·L)."
          />
        </div>
        <div className={styles.prose}>
          <p>
            In {year} the {system.shortName} week runs <strong>{weekRelation(shift)}</strong>{' '}
            the real one from 1 January
            {midYear && shiftAfter !== null ? (
              <>
                {' '}
                until {midYear.name}, then <strong>{weekRelation(shiftAfter, directionAfter)}</strong> it
              </>
            ) : null}
            . A {weekdayName(system.weekStartsOn)} in the {system.shortName} is a real{' '}
            {weekdayName(stats.gregorianYearStartWeekday)} at the start of the year.
          </p>
          <p>
            Reformers knew this was the sticking point: a “blank day” breaks the unbroken seven-day cycle that many
            religious calendars depend on, and that objection is one of the main reasons neither plan was adopted.
          </p>
        </div>
      </section>
    </div>
  );
}
