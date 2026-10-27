import {
  type GregorianDate,
  type ThirteenDate,
  formatGregorian,
  formatThirteen,
  getCalendarSystem,
  gregorianMonthName,
  gregorianWeekday,
  thirteenDisplayYear,
  thirteenWeekday,
  weekdayName,
} from '@thirteen/core';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { reveal } from '../../lib/reveal.ts';
import { Kicker } from '../../primitives/Typeset.tsx';
import styles from './DatePlate.module.css';

export interface DatePlateProps {
  /** A 13-month date or a Gregorian date (`{year, month, day}`). */
  readonly date: ThirteenDate | GregorianDate;
  readonly size?: 'hero' | 'lg' | 'md';
  /** Eyebrow line; defaults to the calendar's name. Pass `null` to hide it. */
  readonly kicker?: ReactNode;
  readonly revealDelay?: number;
  readonly className?: string;
}

function isThirteen(date: ThirteenDate | GregorianDate): date is ThirteenDate {
  return 'kind' in date;
}

/**
 * A date set large, almanac style: the day numeral in display type beside
 * the weekday, month and year. Gregorian dates use the foil treatment.
 */
export function DatePlate({ date, size = 'lg', kicker, revealDelay, className }: DatePlateProps) {
  if (isThirteen(date)) {
    const system = getCalendarSystem(date.system);
    const full = formatThirteen(date, { includeWeekday: true });
    const year = thirteenDisplayYear(date);
    const yearText = system.id === 'ifc' ? String(year) : `Year ${year}`;
    const top = kicker === undefined ? system.name : kicker;
    if (date.kind === 'intercalary') {
      const info = system.intercalaryDays.find((d) => d.id === date.id)!;
      return (
        <div className={cx(styles.plate, styles[size], className)} {...reveal('rise', revealDelay)}>
          {top !== null ? <Kicker tone="accent">{top}</Kicker> : null}
          <p className="t-sr-only">{full}</p>
          <div className={styles.stack} aria-hidden="true">
            <span className={styles.weekday}>No weekday · outside every month</span>
            <span className={styles.name}>{info.name}</span>
            <span className={styles.year}>{yearText}</span>
          </div>
        </div>
      );
    }
    const weekday = thirteenWeekday(date)!;
    return (
      <div className={cx(styles.plate, styles[size], className)} {...reveal('rise', revealDelay)}>
        {top !== null ? <Kicker tone="accent">{top}</Kicker> : null}
        <p className="t-sr-only">{full}</p>
        <div className={styles.body} aria-hidden="true">
          <span className={styles.day}>{date.day}</span>
          <span className={styles.stack}>
            <span className={styles.weekday}>{weekdayName(weekday)}</span>
            <span className={styles.month}>{system.months[date.month - 1]!.name}</span>
            <span className={styles.year}>{yearText}</span>
          </span>
        </div>
      </div>
    );
  }

  const top = kicker === undefined ? 'Gregorian calendar' : kicker;
  return (
    <div className={cx(styles.plate, styles.foil, styles[size], className)} {...reveal('rise', revealDelay)}>
      {top !== null ? <Kicker>{top}</Kicker> : null}
      <p className="t-sr-only">{formatGregorian(date, { includeWeekday: true })}</p>
      <div className={styles.body} aria-hidden="true">
        <span className={styles.day}>{date.day}</span>
        <span className={styles.stack}>
          <span className={styles.weekday}>{weekdayName(gregorianWeekday(date))}</span>
          <span className={styles.month}>{gregorianMonthName(date.month)}</span>
          <span className={styles.year}>{date.year}</span>
        </span>
      </div>
    </div>
  );
}
