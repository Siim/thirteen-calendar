import type { GregorianDate } from '@thirteen/core';
import { GregorianMonthGrid, useCalendarSystem, useGregorianYearLayouts } from '@thirteen/ui';
import styles from './YearPage.module.css';

export interface TwelveMonthViewProps {
  readonly year: number;
  readonly today: GregorianDate;
  readonly selected: GregorianDate | null;
  readonly onSelect: (date: GregorianDate) => void;
}

/** The same year as 12 ragged Gregorian months, each day annotated with its 13-month date. */
export function TwelveMonthView({ year, today, selected, onSelect }: TwelveMonthViewProps) {
  const { systemId } = useCalendarSystem();
  const months = useGregorianYearLayouts(year, systemId);
  return (
    <div className={styles.twelve}>
      <div className={styles.twelveGrid}>
        {months.map((layout) => (
          <GregorianMonthGrid
            key={layout.month}
            layout={layout}
            today={today}
            selected={selected}
            onSelect={(cell) => onSelect(cell.gregorian)}
            size="sm"
          />
        ))}
      </div>
    </div>
  );
}
