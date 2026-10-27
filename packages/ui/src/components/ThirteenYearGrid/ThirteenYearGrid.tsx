import {
  type GregorianDate,
  type ThirteenDate,
  type ThirteenYearLayout,
  gregorianDayOfYear,
  thirteenDayOfYear,
} from '@thirteen/core';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo } from 'react';
import { cx } from '../../lib/cx.ts';
import { sameGregorian } from '../../lib/dates.ts';
import { navigateThirteen } from '../../lib/navigation.ts';
import { useRovingFocus } from '../../hooks/useRovingFocus.ts';
import type { CellSize } from '../DateCell/DateCell.tsx';
import { IntercalaryDayToken } from '../IntercalaryDayToken/IntercalaryDayToken.tsx';
import { type DayMarks, type SharedRoving, ThirteenMonthGrid } from '../ThirteenMonthGrid/ThirteenMonthGrid.tsx';
import styles from './ThirteenYearGrid.module.css';

export interface ThirteenYearGridProps {
  readonly layout: ThirteenYearLayout;
  readonly today?: GregorianDate | null;
  readonly selected?: GregorianDate | null;
  /** Makes days (and intercalary slips) selectable. */
  readonly onSelect?: (gregorian: GregorianDate, thirteen: ThirteenDate) => void;
  readonly showGregorian?: boolean;
  readonly showGregorianMonthStarts?: boolean;
  readonly size?: CellSize;
  /** Content for the space after the last month (a key, notes…). */
  readonly legend?: ReactNode;
  /** Play the staggered load animation. */
  readonly reveal?: boolean;
  /** Event dots by Gregorian day of year (docs/EVENTS.md §2.3), on days and intercalary slips. */
  readonly marks?: ReadonlyMap<number, DayMarks>;
  /** The link for a month's title (Year mode opens Month mode). */
  readonly monthHref?: (month: number) => string;
  readonly className?: string;
}

/**
 * All 13 perfect months of a year with the intercalary day(s) in their true
 * positions (each slip follows the month it comes after: IFC Leap Day after
 * June, year-end days after the 13th month). One roving tab stop spans the
 * whole year: arrows cross month boundaries and step onto intercalary days,
 * PageUp/PageDown jump a month.
 */
export function ThirteenYearGrid({
  layout,
  today = null,
  selected = null,
  onSelect,
  showGregorian = false,
  showGregorianMonthStarts = true,
  size = 'sm',
  legend,
  reveal = false,
  marks,
  monthHref,
  className,
}: ThirteenYearGridProps) {
  const selectedDoy = selected && selected.year === layout.year ? gregorianDayOfYear(selected) : null;
  const todayDoy = today && today.year === layout.year ? gregorianDayOfYear(today) : null;
  const roving = useRovingFocus<number>(selectedDoy ?? todayDoy ?? 1, `${layout.system}:${layout.year}`);
  const { setActiveKey } = roving;

  useEffect(() => {
    if (selectedDoy !== null) setActiveKey(selectedDoy);
  }, [selectedDoy, setActiveKey]);

  const shared: SharedRoving = useMemo(
    () => ({
      ...roving,
      navigate: (from: ThirteenDate, key: string) => {
        const next = navigateThirteen(from, key);
        if (next === null) return false;
        roving.focusKey(thirteenDayOfYear(next));
        return true;
      },
    }),
    [roving],
  );

  return (
    <div className={cx(styles.year, className)} data-year={layout.year} data-system={layout.system}>
      <div className={styles.months}>
        {layout.months.map((month, index) => (
          <div key={month.month} className={styles.month}>
            <ThirteenMonthGrid
              layout={month}
              today={today}
              selected={selected}
              onSelect={onSelect ? (cell) => onSelect(cell.gregorian, cell.thirteen) : undefined}
              showGregorian={showGregorian}
              showGregorianMonthStarts={showGregorianMonthStarts}
              size={size}
              roving={shared}
              revealDelay={reveal ? 160 + index * 70 : undefined}
              marks={marks}
              captionHref={monthHref?.(month.month)}
            />
            {layout.intercalary
              .filter((occurrence) => occurrence.afterMonth === month.month)
              .map((occurrence) => (
                <IntercalaryDayToken
                  key={occurrence.id}
                  occurrence={occurrence}
                  today={sameGregorian(occurrence.gregorian, today)}
                  selected={onSelect ? sameGregorian(occurrence.gregorian, selected) : undefined}
                  onSelect={onSelect ? () => onSelect(occurrence.gregorian, occurrence.thirteen) : undefined}
                  tokenRef={roving.register(occurrence.dayOfYear)}
                  tabIndex={onSelect ? roving.tabIndexFor(occurrence.dayOfYear) : undefined}
                  onFocus={() => setActiveKey(occurrence.dayOfYear)}
                  onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                    if (event.altKey || event.ctrlKey || event.metaKey) return;
                    if (shared.navigate(occurrence.thirteen, event.key)) event.preventDefault();
                  }}
                  revealDelay={reveal ? 160 + index * 70 + 330 : undefined}
                  marks={marks?.get(occurrence.dayOfYear)}
                />
              ))}
          </div>
        ))}
        {legend !== undefined ? <div className={styles.legend}>{legend}</div> : null}
      </div>
    </div>
  );
}
