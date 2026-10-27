import type { CSSProperties, HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';
import { cx } from '../lib/cx.ts';
import { copy } from './copy.ts';
import styles from './EventChip.module.css';
import type { StoreOccurrence } from './store.ts';

export interface EventChipProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'color'> {
  readonly occurrence: StoreOccurrence;
  /** The calendar's colour (`#rrggbb`), never themed (§2.2). */
  readonly color: string;
  /**
   * `bar`: an all-day or 24-hour-or-more event, a tinted fill (16% light, 24%
   * dark) with an edge in the calendar colour; `timed`: a dot, the start time
   * and the title (§2.2).
   */
  readonly variant: 'bar' | 'timed';
  /** Timed chips: the start time to show (`09:30`, `9:30a`); `null` hides it (compact titles density). */
  readonly time?: string | null;
  /** Bars: draw the title (the first drawn segment of a row); other segments only continue the fill. */
  readonly showTitle?: boolean;
  /** Bars: how many cells the title may run across (its own segment included). */
  readonly titleSpan?: number;
  /** Bars: the event goes on before this segment (squared, notched start) / after it (notched end). */
  readonly notchStart?: boolean;
  readonly notchEnd?: boolean;
  /** Bars: this segment joins the previous / next segment of the same bar (no rounded end there). */
  readonly joinsStart?: boolean;
  readonly joinsEnd?: boolean;
  /** Accessible name (`calendar.item.a11y` or `calendar.bar.a11y` with flags); `null`: decorative (compact cells). */
  readonly label: string | null;
  readonly selected?: boolean;
  readonly tabIndex?: number;
  readonly onClick?: (event: MouseEvent<HTMLElement>) => void;
  readonly onDoubleClick?: (event: MouseEvent<HTMLElement>) => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  readonly chipRef?: Ref<HTMLElement>;
  readonly style?: CSSProperties;
  readonly className?: string;
  /** Extra content after the title (a plate, a tag). */
  readonly trailing?: ReactNode;
}

/**
 * One event in a Month cell or the all-day row (docs/EVENTS.md §2.2): colour
 * marks the event and never carries text; text is `ink` (canceled: struck
 * through in `ink-2`); tentative events are hatched and tagged. A button with
 * the §2.20 label, or a decorative mark when `label` is null.
 */
export function EventChip({
  occurrence,
  color,
  variant,
  time = null,
  showTitle = true,
  titleSpan = 1,
  notchStart = false,
  notchEnd = false,
  joinsStart = false,
  joinsEnd = false,
  label,
  selected = false,
  tabIndex,
  onClick,
  onDoubleClick,
  onKeyDown,
  chipRef,
  style,
  className,
  trailing,
  ...rest
}: EventChipProps) {
  const tentative = occurrence.status === 'tentative';
  const canceled = occurrence.status === 'canceled';
  const classes = cx(
    styles.chip,
    variant === 'bar' ? styles.bar : styles.timed,
    tentative && styles.tentative,
    canceled && styles.canceled,
    notchStart && styles.notchStart,
    notchEnd && styles.notchEnd,
    joinsStart && styles.joinsStart,
    joinsEnd && styles.joinsEnd,
    selected && styles.selected,
    label === null && styles.decorative,
    className,
  );
  const content =
    variant === 'bar' ? (
      showTitle ? (
        <span className={styles.barTitle} style={{ ['--span' as string]: String(titleSpan) }} data-user-text>
          {occurrence.title}
        </span>
      ) : null
    ) : (
      <>
        <span className={styles.dot} />
        {time !== null ? <span className={styles.time}>{time}</span> : null}
        <span className={styles.title} data-user-text>
          {occurrence.title}
        </span>
      </>
    );
  const chipStyle = { ...style, ['--cal' as string]: color } as CSSProperties;
  const tag = tentative ? copy('event.tentative') : canceled ? copy('event.canceled') : null;

  if (label === null) {
    return (
      <span className={classes} style={chipStyle} aria-hidden="true" data-key={occurrence.key}>
        {content}
      </span>
    );
  }
  return (
    <button
      {...rest}
      ref={chipRef as Ref<HTMLButtonElement>}
      type="button"
      className={classes}
      style={chipStyle}
      aria-label={label}
      aria-pressed={selected}
      tabIndex={tabIndex}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      data-key={occurrence.key}
    >
      <span className={styles.content} aria-hidden="true">
        {content}
        {tag !== null && showTitle ? <span className={styles.tag}>{tag}</span> : null}
        {trailing}
      </span>
    </button>
  );
}
