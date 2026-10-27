import {
  type DayCell,
  type GregorianDate,
  type ThirteenDate,
  type ThirteenMonthLayout,
  formatGregorian,
  getCalendarSystem,
  gregorianMonthName,
  thirteenDayOfYear,
  toDisplayYear,
  toISODate,
  weekdayName,
} from '@thirteen/core';
import { type KeyboardEvent, useEffect } from 'react';
import { cx } from '../../lib/cx.ts';
import { sameGregorian } from '../../lib/dates.ts';
import { dayAriaExtras, dayAriaLabel } from '../../lib/labels.ts';
import { navigateThirteen } from '../../lib/navigation.ts';
import { type RovingFocus, useRovingFocus } from '../../hooks/useRovingFocus.ts';
import { type CellSize, DateCell } from '../DateCell/DateCell.tsx';
import styles from './MonthGrid.module.css';

/** A day's event marks (Year mode, docs/EVENTS.md §2.3): up to three calendar colours and the event count. */
export interface DayMarks {
  readonly colors: readonly string[];
  readonly count: number;
}

/** Roving focus owned by a parent (the year grid) so arrows can cross months. */
export interface SharedRoving extends RovingFocus<number> {
  /** Handle a navigation key from `from`; return `true` when focus moved. */
  readonly navigate: (from: ThirteenDate, key: string) => boolean;
}

export interface ThirteenMonthGridProps {
  readonly layout: ThirteenMonthLayout;
  readonly today?: GregorianDate | null;
  readonly selected?: GregorianDate | null;
  /** Makes cells selectable (click, Enter, Space). */
  readonly onSelect?: (cell: DayCell) => void;
  /** Overlay each cell's Gregorian date (small, bottom right). */
  readonly showGregorian?: boolean;
  /** Tab the cells where a Gregorian month begins. Default `true`. */
  readonly showGregorianMonthStarts?: boolean;
  readonly size?: CellSize;
  /** `full`: name, number and Gregorian span; `compact`: name and number; `hidden`: screen readers only. */
  readonly caption?: 'full' | 'compact' | 'hidden';
  /** Parent-owned roving focus (cross-month navigation). Omit for a self-contained grid. */
  readonly roving?: SharedRoving;
  /** Base delay (ms) for the staggered load animation; omit to skip it. */
  readonly revealDelay?: number;
  /** Event dots by Gregorian day of year (§2.3); the cell's name ends with "{n} events." (§2.20). */
  readonly marks?: ReadonlyMap<number, DayMarks>;
  /** Makes the month name a link (Year mode: selecting a month title opens Month mode). */
  readonly captionHref?: string;
  readonly className?: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * A perfect 4 × 7 13-month month as an ARIA grid: every cell's accessible
 * name reads both calendars, arrow keys move the roving tab stop, Enter or
 * Space selects.
 */
export function ThirteenMonthGrid({
  layout,
  today = null,
  selected = null,
  onSelect,
  showGregorian = false,
  showGregorianMonthStarts = true,
  size = 'md',
  caption = 'full',
  roving: shared,
  revealDelay,
  marks,
  captionHref,
  className,
}: ThirteenMonthGridProps) {
  const system = getCalendarSystem(layout.system);
  const cells = layout.weeks.flat();
  const first = cells[0]!;
  const last = cells[cells.length - 1]!;

  const inMonth = (date: GregorianDate | null) => date !== null && cells.some((cell) => sameGregorian(cell.gregorian, date));
  const initialDoy =
    (inMonth(selected) && cells.find((c) => sameGregorian(c.gregorian, selected))?.dayOfYear) ||
    (inMonth(today) && cells.find((c) => sameGregorian(c.gregorian, today))?.dayOfYear) ||
    first.dayOfYear;

  const own = useRovingFocus<number>(initialDoy, `${layout.system}:${layout.year}:${layout.month}`);
  const selectedDoy = inMonth(selected) ? cells.find((c) => sameGregorian(c.gregorian, selected))!.dayOfYear : null;
  const { setActiveKey } = own;
  useEffect(() => {
    if (!shared && selectedDoy !== null) setActiveKey(selectedDoy);
  }, [shared, selectedDoy, setActiveKey]);

  const roving: SharedRoving = shared ?? {
    ...own,
    navigate: (from, key) => {
      const next = navigateThirteen(from, key, { withinMonth: true });
      if (next === null) return false;
      own.focusKey(thirteenDayOfYear(next));
      return true;
    },
  };

  const onKeyDown = (cell: DayCell) => (event: KeyboardEvent<HTMLTableCellElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (roving.navigate(cell.thirteen, event.key)) event.preventDefault();
  };

  const range = `${formatGregorian(first.gregorian, { style: 'short' })} to ${formatGregorian(last.gregorian, { style: 'short' })}`;

  const captionInner = (
    <>
      <span className={styles.captionRow}>
        {caption !== 'hidden' ? (
          <span className={styles.captionIndex} aria-hidden="true">
            M{pad2(layout.month)}
          </span>
        ) : null}
        {captionHref !== undefined ? (
          <a className={cx(styles.captionName, styles.captionLink)} href={captionHref}>
            {layout.monthInfo.name}
          </a>
        ) : (
          <span className={styles.captionName}>{layout.monthInfo.name}</span>
        )}
        {caption === 'full' ? (
          <span className={styles.captionRange}>
            <span className="t-sr-only">Gregorian </span>
            {range}
          </span>
        ) : null}
      </span>
      {caption === 'full' && system.id === 'positivist' && layout.monthInfo.meaning ? (
        <span className={styles.captionMeaning}>{layout.monthInfo.meaning}</span>
      ) : null}
    </>
  );
  // A month title that is a link sits above the table: a link inside a grid's caption is a child a
  // grid may not have (ARIA required children), so the table is named by its aria-label alone.
  const outsideCaption = captionHref !== undefined && caption !== 'hidden';

  return (
    <>
      {outsideCaption ? (
        <div
          className={cx(styles.caption, styles.captionOutside, size === 'lg' && styles.sizeLg, size === 'sm' && styles.sizeSm)}
        >
          {captionInner}
        </div>
      ) : null}
      <table
        role="grid"
        aria-label={`${layout.monthInfo.name} ${toDisplayYear(layout.year, layout.system)} (${system.shortName})`}
        className={cx(styles.grid, size === 'lg' && styles.sizeLg, size === 'sm' && styles.sizeSm, className)}
        data-month={layout.month}
      >
        {outsideCaption ? null : (
          <caption className={caption === 'hidden' ? 't-sr-only' : styles.caption}>{captionInner}</caption>
        )}
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
                const isToday = sameGregorian(cell.gregorian, today);
                const isSelected = onSelect ? sameGregorian(cell.gregorian, selected) : undefined;
                const monthStart = cell.isGregorianMonthStart;
                const dayMarks = marks?.get(cell.dayOfYear);
                // §2.20: "{date}. Gregorian {gregorianDate}." + " Gregorian {Month} begins." + " {n} events.";
                // today is aria-current="date" (DateCell), not a word in the name.
                const extras = dayAriaExtras(monthStart ? cell.gregorian : null, dayMarks?.count ?? 0);
                let secondary: string | undefined;
                if (showGregorian) {
                  secondary =
                    cell.thirteen.day === 1 && !monthStart
                      ? formatGregorian(cell.gregorian, { style: 'short' })
                      : String(cell.gregorian.day);
                }
                return (
                  <DateCell
                    key={cell.dayOfYear}
                    cellRef={roving.register(cell.dayOfYear)}
                    numeral={cell.thirteen.day}
                    secondary={secondary}
                    marker={
                      showGregorianMonthStarts && monthStart ? gregorianMonthName(cell.gregorian.month, 'short') : undefined
                    }
                    label={dayAriaLabel(cell.thirteen, cell.gregorian, extras)}
                    today={isToday}
                    selected={isSelected}
                    rest={cell.thirteenWeekday === 0}
                    size={size}
                    tabIndex={roving.tabIndexFor(cell.dayOfYear)}
                    onActivate={onSelect ? () => onSelect(cell) : undefined}
                    onFocus={() => roving.setActiveKey(cell.dayOfYear)}
                    onKeyDown={onKeyDown(cell)}
                    revealDelay={revealDelay === undefined ? undefined : revealDelay + (w * 7 + d) * 11}
                    dataDate={toISODate(cell.gregorian)}
                    marks={dayMarks?.colors}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
