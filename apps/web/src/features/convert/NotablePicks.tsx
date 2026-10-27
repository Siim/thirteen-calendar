import { type GregorianDate, formatGregorian, formatThirteen, fromThirteen, gregorianEquals } from '@thirteen/core';
import { useNotableDates } from '@thirteen/ui';
import type { CalendarSystemId } from '@thirteen/core';
import styles from './ConvertPage.module.css';

export interface NotablePicksProps {
  readonly year: number;
  readonly systemId: CalendarSystemId;
  readonly current: GregorianDate;
  readonly onPick: (date: GregorianDate) => void;
}

/** Fixed-date days of the year as one-click examples (notableDatesInYear). */
export function NotablePicks({ year, systemId, current, onPick }: NotablePicksProps) {
  const notables = useNotableDates(year, systemId);
  return (
    <ul className={styles.picks}>
      {notables.map((entry) => (
        <li key={entry.notable.id}>
          <button
            type="button"
            className={styles.pick}
            aria-pressed={gregorianEquals(entry.gregorian, current)}
            onClick={() => onPick(entry.gregorian)}
          >
            <span className={styles.pickName}>{entry.notable.name}</span>
            <span className={styles.pickLine}>
              {formatGregorian(entry.gregorian, { style: 'short' })} <span aria-hidden="true">→</span>
              <span className="t-sr-only">is</span> <b>{formatThirteen(entry.thirteen, { style: 'medium', includeYear: false })}</b>
            </span>
            {entry.sameLabel ? (
              <span className={styles.pickSub}>
                The 13-month {formatThirteen(entry.sameLabel, { style: 'short' })} is Gregorian{' '}
                {formatGregorian(fromThirteen(entry.sameLabel), { style: 'short' })}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
