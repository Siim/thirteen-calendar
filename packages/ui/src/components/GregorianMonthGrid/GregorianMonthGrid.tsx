import {
  type GregorianDate,
  type GregorianDayCell,
  type GregorianMonthLayout,
  formatThirteen,
  getCalendarSystem,
  toISODate,
  weekdayName,
} from '@thirteen/core';
import { type KeyboardEvent, useEffect } from 'react';
import { cx } from '../../lib/cx.ts';
import { sameGregorian } from '../../lib/dates.ts';
import { gregorianDayAriaLabel } from '../../lib/labels.ts';
import { navigateGregorianMonth } from '../../lib/navigation.ts';
import { useRovingFocus } from '../../hooks/useRovingFocus.ts';
import { BlankCell, type CellSize, DateCell } from '../DateCell/DateCell.tsx';
import styles from '../ThirteenMonthGrid/MonthGrid.module.css';

export interface GregorianMonthGridProps {
  readonly layout: GregorianMonthLayout;
  readonly today?: GregorianDate | null;
  readonly selected?: GregorianDate | null;
  readonly onSelect?: (cell: GregorianDayCell) => void;
  /** Show each day's 13-month date (small). Default `true`. */
  readonly showThirteen?: boolean;
  /** Tab the cells where a 13-month month begins. Default `true`. */
  readonly showThirteenMonthStarts?: boolean;
  readonly size?: CellSize;
  readonly caption?: 'full' | 'compact' | 'hidden';
  readonly revealDelay?: number;
  readonly className?: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * A ragged Gregorian month (4 to 6 rows, leading blanks) annotated with the
 * 13-month date of every day: the foil to the perfect 4 × 7 grid.
 */
export function GregorianMonthGrid({
  layout,
  today = null,
  selected = null,
  onSelect,
  showThirteen = true,
  showThirteenMonthStarts = true,
  size = 'md',
  caption = 'full',
  revealDelay,
  className,
}: GregorianMonthGridProps) {
  const system = getCalendarSystem(layout.system);
  const days = layout.weeks.flat().filter((cell): cell is GregorianDayCell => cell !== null);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const inMonth = (date: GregorianDate | null): date is GregorianDate =>
    date !== null && date.year === layout.year && date.month === layout.month;

  const initial = inMonth(selected) ? selected.day : inMonth(today) ? today.day : 1;
  const roving = useRovingFocus<number>(initial, `${layout.system}:${layout.year}:${layout.month}`);
  const { setActiveKey, focusKey } = roving;
  const selectedDay = inMonth(selected) ? selected.day : null;
  useEffect(() => {
    if (selectedDay !== null) setActiveKey(selectedDay);
  }, [selectedDay, setActiveKey]);

  const onKeyDown = (cell: GregorianDayCell) => (event: KeyboardEvent<HTMLTableCellElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = navigateGregorianMonth(cell.gregorian, event.key, layout.weekStartsOn);
    if (next === null) return;
    event.preventDefault();
    focusKey(next.day);
  };

  const range = `${formatThirteen(first.thirteen, { style: 'short' })} to ${formatThirteen(last.thirteen, { style: 'short' })}`;
  let index = 0;

  return (
    <table
      role="grid"
      aria-label={`${layout.monthInfo.name} ${layout.year} (Gregorian)`}
      className={cx(styles.grid, styles.foil, size === 'lg' && styles.sizeLg, size === 'sm' && styles.sizeSm, className)}
      data-gregorian-month={layout.month}
    >
      <caption className={caption === 'hidden' ? 't-sr-only' : styles.caption}>
        <span className={styles.captionRow}>
          {caption !== 'hidden' ? (
            <span className={styles.captionIndex} aria-hidden="true">
              {pad2(layout.month)}
            </span>
          ) : null}
          <span className={styles.captionName}>{layout.monthInfo.name}</span>
          {caption === 'full' ? (
            <span className={styles.captionRange}>
              <span className="t-sr-only">{system.shortName} </span>
              {days.length}d · {range}
            </span>
          ) : null}
        </span>
      </caption>
      <thead>
        <tr>
          {layout.weekdays.map((weekday) => (
            <th
              key={weekday}
              scope="col"
              abbr={weekdayName(weekday)}
              className={cx(styles.head, weekday === 0 && styles.headRest)}
            >
              {weekdayName(weekday, 'short').slice(0, size === 'sm' ? 1 : 3)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {layout.weeks.map((week, w) => (
          <tr key={w}>
            {week.map((cell, d) => {
              if (cell === null) return <BlankCell key={`blank-${w}-${d}`} size={size} />;
              const isToday = sameGregorian(cell.gregorian, today);
              const thirteen = cell.thirteen;
              const intercalary = thirteen.kind === 'intercalary';
              // "{gregorianDate}. IFC {date}." + " IFC {Month} begins." (as Windows and Apple); today is
              // aria-current="date" (DateCell), not a word in the name.
              const extras =
                cell.isThirteenMonthStart && thirteen.kind === 'month'
                  ? `${system.shortName} ${system.months[thirteen.month - 1]!.name} begins.`
                  : undefined;
              const i = index++;
              return (
                <DateCell
                  key={cell.dayOfYear}
                  cellRef={roving.register(cell.gregorian.day)}
                  numeral={cell.gregorian.day}
                  secondary={
                    showThirteen
                      ? intercalary
                        ? formatThirteen(thirteen, { style: 'numeric', includeYear: false })
                        : String(thirteen.day)
                      : undefined
                  }
                  secondaryTone={intercalary ? 'accent' : 'foil'}
                  marker={
                    showThirteenMonthStarts && cell.isThirteenMonthStart && thirteen.kind === 'month'
                      ? system.months[thirteen.month - 1]!.shortName
                      : undefined
                  }
                  markerTone="accent"
                  label={gregorianDayAriaLabel(cell.gregorian, thirteen, extras)}
                  today={isToday}
                  selected={onSelect ? sameGregorian(cell.gregorian, selected) : undefined}
                  rest={cell.gregorianWeekday === 0}
                  hatched={intercalary}
                  size={size}
                  tabIndex={roving.tabIndexFor(cell.gregorian.day)}
                  onActivate={onSelect ? () => onSelect(cell) : undefined}
                  onFocus={() => setActiveKey(cell.gregorian.day)}
                  onKeyDown={onKeyDown(cell)}
                  revealDelay={revealDelay === undefined ? undefined : revealDelay + i * 11}
                  dataDate={toISODate(cell.gregorian)}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
