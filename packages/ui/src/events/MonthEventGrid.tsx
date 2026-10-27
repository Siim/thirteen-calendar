import {
  type CalendarSystemId,
  type DayCell,
  type GregorianDate,
  type IntercalaryOccurrence,
  type MonthItem,
  type MonthWeekRow,
  type ThirteenMonthEventLayout,
  buildThirteenMonth,
  formatChipTime,
  formatThirteen,
  gregorianMonthName,
  intercalaryDaysInYear,
  layoutThirteenMonthEvents,
  toISODate,
  toThirteen,
  weekdayName,
  yearEventMarks,
} from '@thirteen/core';
import {
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cx } from '../lib/cx.ts';
import { copy, plural } from './copy.ts';
import { EventChip } from './EventChip.tsx';
import { barLabel, itemLabel, monthCellLabel } from './format.ts';
import { IntercalaryEventBand } from './IntercalaryEventBand.tsx';
import styles from './MonthEventGrid.module.css';
import type { StoreCalendar, StoreOccurrence } from './store.ts';

/**
 * How a Month cell shows its events (docs/EVENTS.md §2.4), chosen once per
 * screen: `full` (regular width: lanes from the cell height, chips with their
 * times, "+N more"), `titles` (compact, cells of 60 px or more at the default
 * text size: 2 lanes of titles, then "+N"), `dots` (compact otherwise: up to
 * three calendar dots and the count when there are more than three).
 */
export type MonthDensity = 'full' | 'titles' | 'dots';

/** What a pointer or the keyboard acted on, for context menus. */
export interface MonthTarget {
  readonly date: GregorianDate;
  /** The event, or `null` for the cell's empty space. */
  readonly key: string | null;
}

export interface MonthEventGridProps {
  /** Gregorian year. */
  readonly year: number;
  /** 13-month month, 1 to 13. */
  readonly month: number;
  readonly systemId: CalendarSystemId;
  /** The visible calendars' occurrences touching the year (any order); `null` while loading (the grid draws without items). */
  readonly occurrences: readonly StoreOccurrence[] | null;
  /** Every calendar by id (colours and names for chips and labels). */
  readonly calendars: ReadonlyMap<string, StoreCalendar>;
  readonly today?: GregorianDate | null;
  /** The selected day (a cell, or an intercalary band). */
  readonly selected?: GregorianDate | null;
  /** The selected event. */
  readonly selectedKey?: string | null;
  readonly density: MonthDensity;
  /** `full`: the lanes to start with until the cells are measured. Default 4. */
  readonly maxLanes?: number;
  readonly use24Hour: boolean;
  /** Accessible name of the grid ("October 2026"). */
  readonly label: string;
  /** A day was selected (click, Space, arrows). */
  readonly onSelectDay: (date: GregorianDate) => void;
  /** The selected day was activated again (compact: a second tap opens Day). */
  readonly onActivateSelectedDay?: (date: GregorianDate) => void;
  /** Double-click on a cell's empty space (regular width): a new draft on that day. */
  readonly onCreate?: (date: GregorianDate, anchor: HTMLElement) => void;
  /** An event was selected (click, or focus moved onto it). */
  readonly onSelectItem?: (key: string) => void;
  /** Double-click or Enter on an event: its details. */
  readonly onOpenItem?: (key: string, anchor: HTMLElement) => void;
  /** "+N more": the day's events in a popover. */
  readonly onShowMore?: (date: GregorianDate, anchor: HTMLElement) => void;
  /** Right-click (or the context menu key) on a cell or an event. */
  readonly onContextMenu?: (target: MonthTarget, point: { readonly x: number; readonly y: number }, anchor: HTMLElement) => void;
  /** Extra attributes for a day cell (drag and drop targets, §6.5 B4). */
  readonly cellProps?: (date: GregorianDate) => HTMLAttributes<HTMLElement>;
  /** Extra attributes for an event chip (drag sources). */
  readonly itemProps?: (key: string, date: GregorianDate) => HTMLAttributes<HTMLElement>;
  readonly className?: string;
}

const iso = toISODate;
const ITEM_SELECTOR = '[data-cell-item]';

interface Segment {
  readonly item: MonthItem;
  readonly column: number;
  readonly showTitle: boolean;
  readonly titleSpan: number;
  readonly joinsStart: boolean;
  readonly joinsEnd: boolean;
}

/** The segments a week row draws in column `c`: items whose lane is visible there. */
function segmentsIn(row: MonthWeekRow, c: number): Segment[] {
  const drawn = (item: MonthItem, column: number) =>
    column >= item.startColumn && column <= item.endColumn && item.lane < row.visibleLanes[column]!;
  const segments: Segment[] = [];
  for (const item of row.items) {
    if (!drawn(item, c)) continue;
    const joinsStart = c > item.startColumn && drawn(item, c - 1);
    let span = 1;
    while (drawn(item, c + span)) span++;
    segments.push({
      item,
      column: c,
      showTitle: !joinsStart,
      titleSpan: span,
      joinsStart,
      joinsEnd: c < item.endColumn && drawn(item, c + 1),
    });
  }
  return segments;
}

/**
 * Whether a bar segment's start (or end) is drawn notched (§2.2 continuation): at the bar's own first (last)
 * column when it continues from the previous (into the next) row, and wherever the column before (after)
 * it is one where the bar is folded into "+N" (the last lane of a column with an overflow), because the
 * bar goes on there. `column` is undefined for the intercalary band.
 */
function notched(column: number | undefined, edgeColumn: number, joins: boolean | undefined, continues: boolean): boolean {
  if (column === undefined || column === edgeColumn) return continues;
  return joins !== true;
}

/** Root font size in px (the browser text size). */
function rootFontSize(): number {
  if (typeof window === 'undefined') return 16;
  return Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
}

/**
 * Lanes that fit in a `full` density cell (§2.4: floor((cell height - day
 * header) / lane height), lane height 20 px at the default text size and
 * scaled with it), measured on the first cell's lane area.
 */
function useMeasuredLanes(enabled: boolean, initial: number): [number, (element: HTMLElement | null) => void] {
  const [lanes, setLanes] = useState(initial);
  const [element, setElement] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!enabled || element === null || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      if (height <= 0) return;
      const lane = rootFontSize() * 1.25;
      setLanes(Math.max(1, Math.floor((height + 0.5) / lane)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, element]);
  return [enabled ? lanes : initial, setElement];
}

/**
 * Month mode's grid (docs/EVENTS.md §2.4, §2.20): a 4 x 7 13-month month as an
 * ARIA grid with a two-line weekday header (the 13-month weekday, then the
 * Gregorian weekday that column falls on this month), every Gregorian date in
 * its cell, events in the chosen density and the intercalary days as a band
 * under week 4. Arrows move a roving tab stop between days; Enter or F2 moves
 * into the focused day's events, arrows or Tab move among them, Escape
 * returns to the day, Enter on an event opens it.
 */
export function MonthEventGrid({
  year,
  month,
  systemId,
  occurrences,
  calendars,
  today = null,
  selected = null,
  selectedKey = null,
  density,
  maxLanes = 4,
  use24Hour,
  label,
  onSelectDay,
  onActivateSelectedDay,
  onCreate,
  onSelectItem,
  onOpenItem,
  onShowMore,
  onContextMenu,
  cellProps,
  itemProps,
  className,
}: MonthEventGridProps) {
  const layout = useMemo(() => buildThirteenMonth(year, month, systemId), [year, month, systemId]);
  const bands = useMemo(
    () => intercalaryDaysInYear(year, systemId).filter((day) => day.afterMonth === month),
    [year, month, systemId],
  );
  const [measuredLanes, measureRef] = useMeasuredLanes(density === 'full', maxLanes);
  const lanes = density === 'full' ? measuredLanes : density === 'titles' ? 2 : undefined;

  const byKey = useMemo(() => new Map((occurrences ?? []).map((o) => [o.key, o])), [occurrences]);
  const events: ThirteenMonthEventLayout | null = useMemo(() => {
    if (occurrences === null || density === 'dots') return null;
    return layoutThirteenMonthEvents(year, month, occurrences, systemId, lanes === undefined ? undefined : { maxLanes: lanes });
  }, [occurrences, density, year, month, systemId, lanes]);
  const marks = useMemo(() => {
    const map = new Map<string, { readonly count: number; readonly calendarIds: readonly string[] }>();
    if (occurrences === null) return map;
    for (const mark of yearEventMarks(year, occurrences)) map.set(iso(mark.gregorian), mark);
    return map;
  }, [occurrences, year]);
  const columnGregorian = useMemo(() => layout.weeks[0]!.map((cell) => cell.gregorianWeekday), [layout]);

  // ---- roving focus over the days (cells keyed by position, so paging keeps the position focused) ----
  const cells = useMemo(() => layout.weeks.flat(), [layout]);
  const inMonth = useCallback(
    (date: GregorianDate | null) =>
      date !== null &&
      (cells.some((cell) => iso(cell.gregorian) === iso(date)) || bands.some((band) => iso(band.gregorian) === iso(date))),
    [cells, bands],
  );
  const fallback = inMonth(selected) ? iso(selected!) : inMonth(today) ? iso(today!) : iso(cells[0]!.gregorian);
  const [active, setActive] = useState(fallback);
  const activeKey = inMonth(parseIso(active)) ? active : fallback;
  useEffect(() => {
    if (selected !== null && inMonth(selected)) setActive(iso(selected));
  }, [selected, inMonth]);
  const refs = useRef(new Map<string, HTMLElement>());
  const register = (key: string) => (element: HTMLElement | null) => {
    if (element) refs.current.set(key, element);
    else refs.current.delete(key);
  };
  const lastColumn = useRef(0);

  const focusDay = (date: GregorianDate) => {
    const key = iso(date);
    setActive(key);
    onSelectDay(date);
    refs.current.get(key)?.focus();
  };

  /** The next day for a navigation key inside this month (the band is row 5). */
  const step = (
    from: { readonly week: number; readonly column: number } | 'band',
    bandIndex: number,
    key: string,
  ): GregorianDate | null => {
    if (from === 'band') {
      if (key === 'ArrowUp' || key === 'ArrowLeft') {
        if (bandIndex > 0 && key === 'ArrowLeft') return bands[bandIndex - 1]!.gregorian;
        if (key === 'ArrowUp' && bandIndex > 0) return bands[bandIndex - 1]!.gregorian;
        return layout.weeks[3]![key === 'ArrowLeft' ? 6 : lastColumn.current]!.gregorian;
      }
      if ((key === 'ArrowDown' || key === 'ArrowRight') && bandIndex < bands.length - 1) return bands[bandIndex + 1]!.gregorian;
      return null;
    }
    const { week, column } = from;
    const at = (w: number, c: number) => layout.weeks[w]?.[c]?.gregorian ?? null;
    switch (key) {
      case 'ArrowLeft':
        return column > 0 ? at(week, column - 1) : week > 0 ? at(week - 1, 6) : null;
      case 'ArrowRight':
        if (column < 6) return at(week, column + 1);
        if (week < 3) return at(week + 1, 0);
        return bands[0]?.gregorian ?? null;
      case 'ArrowUp':
        return week > 0 ? at(week - 1, column) : null;
      case 'ArrowDown':
        if (week < 3) return at(week + 1, column);
        lastColumn.current = column;
        return bands[0]?.gregorian ?? null;
      case 'Home':
        return at(week, 0);
      case 'End':
        return at(week, 6);
      default:
        return null;
    }
  };

  const interactiveItems = density === 'full';

  const enterItems = (cell: HTMLElement): boolean => {
    const first = cell.querySelector<HTMLElement>(ITEM_SELECTOR);
    if (first === null) return false;
    first.focus();
    return true;
  };

  const onCellKeyDown =
    (date: GregorianDate, position: { readonly week: number; readonly column: number } | 'band', bandIndex: number) =>
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Enter' || event.key === 'F2') {
        if (interactiveItems && enterItems(event.currentTarget)) {
          event.preventDefault();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          activate(date);
        }
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        activate(date);
        return;
      }
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        if (onContextMenu) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onContextMenu({ date, key: null }, { x: rect.left + 12, y: rect.top + 12 }, event.currentTarget);
        }
        return;
      }
      if (event.shiftKey) return;
      if (position !== 'band') lastColumn.current = position.column;
      const next = step(position, bandIndex, event.key);
      if (next !== null) {
        event.preventDefault();
        focusDay(next);
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
      }
    };

  const activate = (date: GregorianDate) => {
    const isSelected = selected !== null && iso(selected) === iso(date);
    if (isSelected && onActivateSelectedDay) onActivateSelectedDay(date);
    else onSelectDay(date);
  };

  const onItemKeyDown = (key: string | null, date: GregorianDate) => (event: KeyboardEvent<HTMLElement>) => {
    const cell = event.currentTarget.closest<HTMLElement>('[role="gridcell"]');
    if (cell === null) return;
    const items = [...cell.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
    const index = items.indexOf(event.currentTarget);
    const move = (delta: number) => {
      const next = items[index + delta];
      if (next === undefined) return false;
      next.focus();
      return true;
    };
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        move(-1);
        break;
      case 'Tab':
        if (move(event.shiftKey ? -1 : 1)) event.preventDefault();
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        cell.focus();
        break;
      case 'Enter':
        event.preventDefault();
        if (key === null) onShowMore?.(date, event.currentTarget);
        else onOpenItem?.(key, event.currentTarget);
        break;
      case 'ContextMenu':
        if (onContextMenu && key !== null) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onContextMenu({ date, key }, { x: rect.left + 8, y: rect.bottom }, event.currentTarget);
        }
        break;
      default:
        break;
    }
  };

  const fromItem = (target: EventTarget | null) => target instanceof Element && target.closest(ITEM_SELECTOR) !== null;

  const cellHandlers = (date: GregorianDate) => ({
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (fromItem(event.target)) return;
      setActive(iso(date));
      activate(date);
    },
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      if (fromItem(event.target) || !onCreate) return;
      onCreate(date, event.currentTarget);
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (!onContextMenu) return;
      event.preventDefault();
      const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-key]') : null;
      const key = item?.dataset.key ?? null;
      onContextMenu({ date, key }, { x: event.clientX, y: event.clientY }, item ?? event.currentTarget);
    },
  });

  const calendarOf = (occurrence: StoreOccurrence) => calendars.get(occurrence.calendarId);
  const colorOf = (occurrence: StoreOccurrence) => calendarOf(occurrence)?.color ?? '#57534e';
  const titleOf = (occurrence: StoreOccurrence) => calendarOf(occurrence)?.title ?? '';

  const chip = (
    segment: { readonly item: MonthItem } & Partial<Segment>,
    date: GregorianDate,
    lane: number,
    inline = false,
  ): ReactNode => {
    const { item } = segment;
    const occurrence = byKey.get(item.key);
    if (occurrence === undefined) return null;
    const bar = item.style === 'bar';
    const time = bar || density !== 'full' ? null : occurrence.allDay ? null : formatChipTime(occurrence.start.minute, use24Hour);
    const labelText = !interactiveItems
      ? null
      : bar
        ? barLabel(occurrence, titleOf(occurrence), year, use24Hour, {
            before: item.continuesBefore,
            after: item.continuesAfter,
          })
        : itemLabel(occurrence, titleOf(occurrence), use24Hour);
    const extra = interactiveItems ? itemProps?.(item.key, date) : undefined;
    return (
      <EventChip
        key={`${item.key}:${segment.column ?? 'band'}`}
        {...extra}
        occurrence={occurrence}
        color={colorOf(occurrence)}
        variant={bar ? 'bar' : 'timed'}
        time={time}
        showTitle={segment.showTitle ?? true}
        titleSpan={segment.titleSpan ?? 1}
        notchStart={notched(segment.column, item.startColumn, segment.joinsStart, item.continuesBefore)}
        notchEnd={notched(segment.column, item.endColumn, segment.joinsEnd, item.continuesAfter)}
        joinsStart={segment.joinsStart ?? false}
        joinsEnd={segment.joinsEnd ?? false}
        label={labelText}
        selected={selectedKey === item.key}
        tabIndex={-1}
        data-cell-item=""
        className={cx(styles.item, inline && styles.inlineItem)}
        style={inline ? undefined : { top: `calc(${lane} * var(--lane-h))` }}
        onClick={() => {
          onSelectItem?.(item.key);
          onSelectDay(date);
        }}
        onDoubleClick={(event) => onOpenItem?.(item.key, event.currentTarget)}
        onFocus={() => onSelectItem?.(item.key)}
        onKeyDown={onItemKeyDown(item.key, date)}
      />
    );
  };

  const more = (date: GregorianDate, hidden: number, lane: number, inline = false): ReactNode => {
    if (hidden <= 0) return null;
    const text = density === 'titles' ? `+${hidden}` : copy('calendar.more', { n: hidden });
    if (!interactiveItems) {
      return (
        <span
          key="more"
          className={cx(styles.more, styles.moreStatic)}
          style={{ top: `calc(${lane} * var(--lane-h))` }}
          aria-hidden="true"
        >
          {text}
        </span>
      );
    }
    return (
      <button
        key="more"
        type="button"
        className={cx(styles.more, inline && styles.inlineItem)}
        style={inline ? undefined : { top: `calc(${lane} * var(--lane-h))` }}
        tabIndex={-1}
        data-cell-item=""
        aria-label={plural('calendar.more.a11y', hidden, { date: longThirteen(date, systemId) })}
        onClick={(event) => onShowMore?.(date, event.currentTarget)}
        onKeyDown={onItemKeyDown(null, date)}
      >
        {text}
      </button>
    );
  };

  const dots = (date: GregorianDate): ReactNode => {
    const mark = marks.get(iso(date));
    if (mark === undefined) return null;
    return (
      <span className={styles.dotRow} aria-hidden="true">
        {mark.calendarIds.map((id) => (
          <span key={id} className={styles.dotMark} style={{ ['--cal' as string]: calendars.get(id)?.color ?? '#57534e' }} />
        ))}
        {mark.count > 3 ? <span className={styles.count}>{mark.count}</span> : null}
      </span>
    );
  };

  const renderCell = (cell: DayCell, week: number, column: number) => {
    const date = cell.gregorian;
    const key = iso(date);
    const isToday = today !== null && iso(today) === key;
    const isSelected = selected !== null && iso(selected) === key;
    const count = marks.get(key)?.count ?? 0;
    const monthStart = cell.isGregorianMonthStart ? gregorianMonthName(date.month) : null;
    const row = events?.weeks[week];
    const segments = row ? segmentsIn(row, column) : [];
    const hidden = row?.hidden[column] ?? 0;
    const visible = row?.visibleLanes[column] ?? 0;
    const extra = cellProps?.(date);
    return (
      <div
        key={`${week}-${column}`}
        {...extra}
        ref={register(key)}
        role="gridcell"
        tabIndex={activeKey === key ? 0 : -1}
        aria-label={monthCellLabel(cell.thirteen, date, count, monthStart)}
        aria-selected={isSelected}
        aria-current={isToday ? 'date' : undefined}
        data-date={key}
        className={cx(styles.cell, isToday && styles.today, isSelected && styles.selected)}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setActive(key);
        }}
        onKeyDown={onCellKeyDown(date, { week, column }, 0)}
        {...cellHandlers(date)}
      >
        <span className={styles.cellHead} aria-hidden="true">
          <span className={styles.num}>{cell.thirteen.kind === 'month' ? cell.thirteen.day : ''}</span>
          <span className={styles.greg}>
            {monthStart !== null ? <span className={styles.gmonth}>{gregorianMonthName(date.month, 'short')}</span> : null}
            <span className={styles.gday}>{date.day}</span>
          </span>
        </span>
        {density === 'dots' ? (
          dots(date)
        ) : (
          <span
            className={styles.lanes}
            ref={week === 0 && column === 0 ? measureRef : undefined}
            style={{ ['--lanes' as string]: String(visible + (hidden > 0 ? 1 : 0)) }}
          >
            {segments.map((segment) => chip(segment, date, segment.item.lane))}
            {more(date, hidden, visible)}
          </span>
        )}
      </div>
    );
  };

  const renderBand = (occurrence: IntercalaryOccurrence, index: number) => {
    const date = occurrence.gregorian;
    const key = iso(date);
    const band = events?.intercalary.find((b) => b.id === occurrence.id) ?? null;
    const items = band ? band.items.filter((item) => item.lane < band.visibleLanes).sort((a, b) => a.lane - b.lane) : [];
    const extra = cellProps?.(date);
    return (
      <div key={occurrence.id} role="row" className={styles.bandRow}>
        <IntercalaryEventBand
          {...extra}
          occurrence={occurrence}
          eventCount={marks.get(key)?.count ?? 0}
          today={today !== null && iso(today) === key}
          selected={selected !== null && iso(selected) === key}
          tabIndex={activeKey === key ? 0 : -1}
          cellRef={register(key)}
          onFocus={(event) => {
            if (event.target === event.currentTarget) setActive(key);
          }}
          onKeyDown={onCellKeyDown(date, 'band', index)}
          {...cellHandlers(date)}
        >
          {density === 'dots'
            ? dots(date)
            : [...items.map((item) => chip({ item }, date, item.lane, true)), more(date, band?.hidden ?? 0, 0, true)]}
        </IntercalaryEventBand>
      </div>
    );
  };

  return (
    <div
      role="grid"
      aria-label={label}
      aria-busy={occurrences === null ? true : undefined}
      aria-readonly="true"
      className={cx(styles.grid, styles[density], className)}
      data-density={density}
      data-month={month}
    >
      <div role="row" className={styles.head}>
        {layout.weekdays.map((weekday, column) => (
          <div
            key={weekday}
            role="columnheader"
            className={styles.headCell}
            aria-label={copy('calendar.weekday.a11y', {
              weekday: weekdayName(weekday),
              gregorianWeekday: weekdayName(columnGregorian[column]!),
            })}
          >
            <span className={styles.headLine1} aria-hidden="true">
              {weekdayName(weekday, density === 'full' ? 'short' : 'narrow')}
            </span>
            <span className={styles.headLine2} aria-hidden="true">
              {weekdayName(columnGregorian[column]!, density === 'full' ? 'short' : 'narrow')}
            </span>
          </div>
        ))}
      </div>
      {layout.weeks.map((week, w) => (
        <div key={w} role="row" className={styles.week}>
          {week.map((cell, c) => renderCell(cell, w, c))}
        </div>
      ))}
      {bands.map(renderBand)}
    </div>
  );
}

function parseIso(text: string): GregorianDate {
  const [y, m, d] = text.split('-').map(Number);
  return { year: y!, month: m!, day: d! };
}

/** "Thursday, October 12, 2026" / "Year Day 2026": the `{date}` of `calendar.more.a11y`. */
function longThirteen(date: GregorianDate, systemId: CalendarSystemId): string {
  return formatThirteen(toThirteen(date, systemId), { style: 'long', includeWeekday: true });
}
