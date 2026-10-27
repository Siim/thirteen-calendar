import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { cx } from '../../lib/cx.ts';
import { reveal } from '../../lib/reveal.ts';
import styles from './DateCell.module.css';

export type CellSize = 'sm' | 'md' | 'lg';

export interface DateCellProps {
  /** The big numeral: the cell's visible label. */
  readonly numeral: ReactNode;
  /**
   * Small reading in the other calendar (bottom right). Drawn as CSS
   * generated text so the visible label stays the numeral alone (WCAG 2.5.3
   * label in name); `label` must carry the same information.
   */
  readonly secondary?: string;
  readonly secondaryTone?: 'foil' | 'accent';
  /** Month-start tab (top left), e.g. "Nov". Decorative like `secondary`. */
  readonly marker?: string;
  readonly markerTone?: 'foil' | 'accent';
  /** Accessible name; should read both calendars. */
  readonly label: string;
  readonly today?: boolean;
  /** `undefined` when the grid is not selectable. */
  readonly selected?: boolean;
  /** Red-letter day (Sunday) numeral. */
  readonly rest?: boolean;
  /** Diagonal hatching (e.g. a Gregorian day that is an intercalary day). */
  readonly hatched?: boolean;
  readonly size?: CellSize;
  readonly tabIndex?: number;
  readonly onActivate?: () => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLTableCellElement>) => void;
  readonly onFocus?: () => void;
  readonly cellRef?: Ref<HTMLTableCellElement>;
  /** Load-animation delay in ms; omit to skip the animation. */
  readonly revealDelay?: number;
  /** Stable hook for tests and styling, e.g. an ISO date. */
  readonly dataDate?: string;
  /**
   * Event dots under the numeral (Year mode, docs/EVENTS.md §2.3): up to three
   * calendar colours (`#rrggbb`), decorative; `label` carries the count.
   */
  readonly marks?: readonly string[];
}

/**
 * One day in a calendar grid (`role="gridcell"`): a display numeral, an
 * optional reading in the other calendar and an optional month-start tab.
 * Enter / Space activate it; navigation keys are left to the grid.
 */
export function DateCell({
  numeral,
  secondary,
  secondaryTone = 'foil',
  marker,
  markerTone = 'foil',
  label,
  today = false,
  selected,
  rest = false,
  hatched = false,
  size = 'md',
  tabIndex,
  onActivate,
  onKeyDown,
  onFocus,
  cellRef,
  revealDelay,
  dataDate,
  marks,
}: DateCellProps) {
  const interactive = onActivate !== undefined;
  const handleKeyDown = (event: KeyboardEvent<HTMLTableCellElement>) => {
    if (interactive && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onActivate();
      return;
    }
    onKeyDown?.(event);
  };
  return (
    <td
      ref={cellRef}
      role="gridcell"
      tabIndex={tabIndex}
      aria-label={label}
      aria-selected={selected}
      aria-current={today ? 'date' : undefined}
      data-date={dataDate}
      className={cx(
        styles.cell,
        styles[size],
        marker !== undefined && styles.hasMarker,
        secondary !== undefined && styles.hasSecondary,
        marks !== undefined && marks.length > 0 && styles.hasMarks,
        interactive && styles.interactive,
        today && styles.today,
        selected && styles.selected,
        rest && styles.rest,
        hatched && styles.hatched,
      )}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      onFocus={onFocus}
      {...reveal('cell', revealDelay)}
    >
      <span className={styles.inner} aria-hidden="true">
        {marker !== undefined ? (
          <span className={cx(styles.marker, markerTone === 'accent' && styles.markerAccent)} data-text={marker} />
        ) : null}
        <span className={styles.num}>{numeral}</span>
        {secondary !== undefined ? (
          <span className={cx(styles.sec, secondaryTone === 'accent' && styles.secAccent)} data-text={secondary} />
        ) : null}
        {marks !== undefined && marks.length > 0 ? (
          <span className={styles.marks}>
            {marks.slice(0, 3).map((color, index) => (
              <span key={index} className={styles.mark} style={{ ['--cal' as string]: color }} />
            ))}
          </span>
        ) : null}
      </span>
    </td>
  );
}

/** An empty padding cell of a ragged month (before day 1 / after the last day). */
export function BlankCell({ size = 'md' }: { readonly size?: CellSize }) {
  return <td role="gridcell" aria-hidden="true" className={cx(styles.cell, styles.blank, styles[size])} />;
}
