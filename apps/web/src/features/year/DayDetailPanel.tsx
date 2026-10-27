import { type GregorianDate, intercalaryDaysInYear, toISODate } from '@thirteen/core';
import {
  Button,
  ComparisonTable,
  DatePlate,
  Icon,
  IntercalaryDayToken,
  Kicker,
  useCalendarSystem,
  useComparison,
} from '@thirteen/ui';
import type { Ref } from 'react';
import { Link } from '../../app/Link.tsx';
import { DayEvents } from './DayEvents.tsx';
import styles from './YearPage.module.css';

export interface DayDetailPanelProps {
  readonly date: GregorianDate;
  /** The panel element (a bottom sheet on small screens). */
  readonly panelRef?: Ref<HTMLElement>;
  readonly onClose: () => void;
  readonly onStep: (delta: number) => void;
}

/**
 * The selected day's full `compare()` breakdown: a side panel on desktop, a
 * bottom sheet on small screens, and docked at the bottom on desktop while
 * the 12-month view is alongside.
 */
export function DayDetailPanel({ date, panelRef, onClose, onStep }: DayDetailPanelProps) {
  const { systemId } = useCalendarSystem();
  const comparison = useComparison(date, systemId);
  const thirteen = comparison.thirteen;
  const occurrence =
    thirteen.kind === 'intercalary'
      ? intercalaryDaysInYear(date.year, systemId).find((d) => d.id === thirteen.id) ?? null
      : null;

  return (
    <aside ref={panelRef} className={styles.panel} aria-labelledby="day-detail-title">
      <div className={styles.panelHead}>
        <Kicker as="h2" tone="accent">
          <span id="day-detail-title">Selected day</span>
        </Kicker>
        <div className={styles.panelNav}>
          <Button size="sm" iconOnly icon="chevron-left" onClick={() => onStep(-1)}>
            Previous day
          </Button>
          <Button size="sm" iconOnly icon="chevron-right" onClick={() => onStep(1)}>
            Next day
          </Button>
          <Button size="sm" iconOnly icon="close" onClick={onClose}>
            Close the day detail
          </Button>
        </div>
      </div>
      <DayEvents date={date} />
      {occurrence ? (
        <IntercalaryDayToken occurrence={occurrence} variant="plate" />
      ) : (
        <DatePlate date={thirteen} size="md" kicker={null} />
      )}
      <ComparisonTable comparison={comparison} variant="compact" className={styles.panelTable} />
      <div className={styles.panelLinks}>
        <Link className={styles.panelLink} to={{ name: 'convert', date: toISODate(date), thirteen: null, system: null }}>
          Open in the converter <Icon name="arrow-right" size={15} />
        </Link>
        <Link className={styles.panelLink} to={{ name: 'compare', year: date.year }}>
          Compare the year <Icon name="arrow-right" size={15} />
        </Link>
      </div>
    </aside>
  );
}
