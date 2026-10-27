import { type CalendarSystemId, getCalendarSystem } from '@thirteen/core';
import { Kicker } from '@thirteen/ui';
import styles from './HistoryPage.module.css';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The selected system's thirteen month names with their meaning (Comte's themes, Sol's etymology). */
export function MonthNames({ systemId }: { readonly systemId: CalendarSystemId }) {
  const system = getCalendarSystem(systemId);
  return (
    <aside className={styles.names} aria-labelledby="month-names">
      <Kicker as="h2" mark={system.shortName} tone="accent">
        <span id="month-names">The thirteen names</span>
      </Kicker>
      <ol className={styles.nameList}>
        {system.months.map((month) => (
          <li key={month.index} className={styles.nameItem}>
            <span className={styles.nameIndex} aria-hidden="true">
              {pad2(month.index)}
            </span>
            <span className={styles.nameText}>
              <span className={styles.nameMonth}>{month.name}</span>
              {month.meaning ? (
                <span className={styles.nameMeaning}>{month.meaning}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <ul className={styles.nameExtras}>
        {system.intercalaryDays.map((day) => (
          <li key={day.id}>
            <strong>{day.name}.</strong> {day.description}
          </li>
        ))}
      </ul>
    </aside>
  );
}
