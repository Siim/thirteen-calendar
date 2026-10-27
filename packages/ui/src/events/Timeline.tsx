import {
  type AgendaDay,
  type CalendarSystemId,
  type GregorianDate,
  type LocalDateTime,
  type MonthItem,
  type ThirteenDate,
  type TimedItem,
  type TimedOverflow,
  addMinutesLocal,
  agenda,
  compareLocalDateTime,
  formatGregorian,
  formatThirteen,
  getCalendarSystem,
  intercalaryDaysInYear,
  layoutDayEvents,
  layoutThirteenWeekEvents,
  normalizeEventEnd,
  occurrenceDays,
  thirteenWeekday,
  toISODate,
  toJulianDayNumber,
  toThirteen,
  weekdayName,
} from '@thirteen/core';
import {
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cx } from '../lib/cx.ts';
import { Dialog } from '../primitives/Dialog.tsx';
import { Popover } from '../primitives/Popover.tsx';
import { AgendaRows } from './AgendaList.tsx';
import { copy, plural } from './copy.ts';
import { EventChip } from './EventChip.tsx';
import { barLabel, formatTime, formatTimeRange, itemLabel } from './format.ts';
import type { StoreCalendar, StoreOccurrence } from './store.ts';
import styles from './Timeline.module.css';

const DAY = 1440;
/** The 15-minute grid of drags and drafts (§2.5). */
const SNAP = 15;
/** Minimum drawn length (§2.5: "Minimum visual height 15 minutes"). */
const MIN_MINUTES = 15;
/** Blocks shorter than this show title and start time on one line (board F1 `short`). */
const SHORT_MINUTES = 45;
/** Blocks at least this long also show the location. */
const LOCATION_MINUTES = 75;
/** All-day lanes shown before the row collapses into "+N" (§2.5). */
const ALL_DAY_LANES = 3;
/** Scroll on open: 07:00, or the first event of the week if earlier (§2.5). */
const OPEN_MINUTE = 7 * 60;
const LONG_PRESS_MS = 500;
/** Minutes around now in which an hour label would touch the now label on the axis. */
const NOW_LABEL_CLEARANCE = 16;
const MOUSE_SLOP = 4;
const TOUCH_SLOP = 8;

/** What the timeline shows: one 13-month week (Week mode) or one day (Day mode). */
export type TimelineDays =
  | { readonly kind: 'week'; readonly year: number; readonly month: number; readonly week: 1 | 2 | 3 | 4 }
  | { readonly kind: 'day'; readonly date: GregorianDate };

/** A column: a day of the 13-month week, or an intercalary day after week 4 (60% wide, hatched). */
export interface TimelineColumn {
  readonly gregorian: GregorianDate;
  readonly thirteen: ThirteenDate;
  readonly intercalary: boolean;
}

/** Where a dragged event would land, drawn as a ghost (B4's drag: `useCalendarDrag`). Device wall clock. */
export type TimelinePreview =
  | { readonly kind: 'timed'; readonly key: string; readonly start: LocalDateTime; readonly end: LocalDateTime; readonly copy: boolean }
  | { readonly kind: 'all-day'; readonly key: string; readonly first: GregorianDate; readonly last: GregorianDate; readonly copy: boolean };

/** A new event asked for on the timeline: a dragged-out range, a double-click, the placeholder, a column's "New event". */
export interface TimelineCreate {
  readonly date: GregorianDate;
  readonly allDay: boolean;
  /** Device wall clock; for all-day requests the day's `T00:00` to `T24:00`. */
  readonly start: LocalDateTime;
  readonly end: LocalDateTime;
  readonly anchor: HTMLElement | null;
}

export interface TimelineProps {
  readonly days: TimelineDays;
  readonly systemId: CalendarSystemId;
  /** Visible calendars' occurrences of the year (device wall clock); `null` while loading. */
  readonly occurrences: readonly StoreOccurrence[] | null;
  readonly calendars: ReadonlyMap<string, StoreCalendar>;
  readonly today: GregorianDate | null;
  /** The device's wall clock: the now line (§2.2) in the columns of `now.date`'s week. */
  readonly now: LocalDateTime | null;
  readonly use24Hour: boolean;
  /** The region's accessible name (the toolbar title). */
  readonly label: string;
  /** Column headers (Week). Day mode draws its own week strip instead. */
  readonly showHeader?: boolean;
  /** Minimum block width in rem (§2.5: 48 pt in Week; §2.6: 64 pt in Day); gives `maxSlots`. */
  readonly minBlockRem?: number;
  /** Accessibility text sizes: the "+{n}" list opens as a sheet (§2.20 Text size). */
  readonly largeText?: boolean;
  readonly selectedKey?: string | null;
  readonly onSelectItem?: (key: string | null) => void;
  /** Double-click or Enter on a block or bar: its details. */
  readonly onOpenItem?: (key: string, anchor: HTMLElement) => void;
  /** A column header was activated (Week: open that day). */
  readonly onOpenDay?: (date: GregorianDate) => void;
  /** A new event from the timeline (§2.5, §2.6). Without it, empty time does nothing. */
  readonly onCreate?: (request: TimelineCreate) => void;
  /** A tap on empty time draws a one-hour "New event" placeholder first (Android and web compact Day, §2.6). */
  readonly placeholder?: boolean;
  /** A block's bottom edge was dragged (pointer platforms, §2.5): the new end, device wall clock. */
  readonly onResize?: (key: string, end: LocalDateTime, anchor: HTMLElement | null) => void;
  /** Drag sources: spread on every block and all-day bar (`date` is the column it is drawn in). */
  readonly itemProps?: (key: string, date: GregorianDate) => HTMLAttributes<HTMLElement>;
  /** Drag sources for the rows of the "+{n}" list. */
  readonly rowProps?: (key: string) => HTMLAttributes<HTMLButtonElement>;
  /** A dragged event's ghost. */
  readonly preview?: TimelinePreview | null;
  /** Read-only events cannot be resized or picked up (§2.2); this says which can. */
  readonly canMove?: (occurrence: StoreOccurrence) => boolean;
  /** A horizontal swipe on the timeline (touch): the next (1) or previous (-1) period (§2.1, §2.6 phones). */
  readonly onSwipe?: (direction: 1 | -1) => void;
  /** Changes when the period changes: the timeline scrolls back to 07:00 or the first event. */
  readonly scrollKey?: string;
  readonly className?: string;
}

interface Layout {
  readonly columns: readonly TimelineColumn[];
  readonly allDay: readonly MonthItem[];
  readonly timed: readonly TimedItem[];
  readonly overflow: readonly TimedOverflow[];
}

const iso = toISODate;

function sameDay(a: GregorianDate | null, b: GregorianDate | null): boolean {
  return a !== null && b !== null && a.year === b.year && a.month === b.month && a.day === b.day;
}

function jdn(date: GregorianDate): number {
  return toJulianDayNumber(date);
}

function absolute(value: LocalDateTime): number {
  return jdn(value.date) * DAY + value.minute;
}

/** `calendar.column.a11y` / `calendar.column.intercalary.a11y` (§2.20). */
export function columnLabel(column: TimelineColumn): string {
  const gregorianShortDate = formatGregorian(column.gregorian, { style: 'long', includeWeekday: true, includeYear: false });
  if (column.thirteen.kind === 'intercalary') {
    return copy('calendar.column.intercalary.a11y', { name: formatThirteen(column.thirteen, { style: 'long' }), gregorianShortDate });
  }
  return copy('calendar.column.a11y', {
    shortDate: formatThirteen(column.thirteen, { style: 'long', includeWeekday: true, includeYear: false }),
    gregorianShortDate,
  });
}

function computeLayout(
  days: TimelineDays,
  occurrences: readonly StoreOccurrence[],
  systemId: CalendarSystemId,
  maxSlots: number | undefined,
): Layout {
  const options = maxSlots === undefined ? undefined : { maxSlots };
  if (days.kind === 'week') {
    const week = layoutThirteenWeekEvents(days.year, days.month, days.week, occurrences, systemId, options);
    return {
      columns: week.columns.map((c) => ({ gregorian: c.gregorian, thirteen: c.thirteen, intercalary: c.kind === 'intercalary' })),
      allDay: week.allDay,
      timed: week.timed,
      overflow: week.overflow,
    };
  }
  const thirteen = toThirteen(days.date, systemId);
  const day = layoutDayEvents(days.date, occurrences, options);
  const byKey = new Map(occurrences.map((o) => [o.key, o]));
  const here = jdn(days.date);
  const allDay: MonthItem[] = day.allDay.map((key, lane) => {
    const o = byKey.get(key)!;
    const covered = occurrenceDays(o.start, o.end);
    return {
      key,
      style: 'bar',
      startColumn: 0,
      endColumn: 0,
      lane,
      continuesBefore: jdn(covered[0]!) < here,
      continuesAfter: jdn(covered[covered.length - 1]!) > here,
    };
  });
  return {
    columns: [{ gregorian: days.date, thirteen, intercalary: thirteen.kind === 'intercalary' }],
    allDay,
    timed: day.timed,
    overflow: day.overflow,
  };
}

/** The columns of a week or day without events (headers while loading). */
function emptyLayout(days: TimelineDays, systemId: CalendarSystemId): Layout {
  return computeLayout(days, [], systemId, undefined);
}

function rootFontSize(): number {
  if (typeof window === 'undefined') return 16;
  return Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
}

/** Minute of a pointer over a column element (unclamped, so drags can run past midnight). */
function minuteAt(column: HTMLElement, clientY: number): number {
  const rect = column.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  return ((clientY - rect.top) / rect.height) * DAY;
}

function floorTo(minute: number, step: number): number {
  return Math.floor(minute / step) * step;
}

function clampMinute(minute: number): number {
  return Math.min(Math.max(minute, 0), DAY);
}

/**
 * Swallows the click a touch release is followed by. After a touch, Chromium and WebKit hit-test that click
 * once `pointerup` has run, so it would land on whatever the release opened (the editor dialog of a
 * touch-and-hold draft) at the finger's spot.
 */
function swallowClickAfterTouch(): void {
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 600);
}

/** Absolute position of a span of minutes in a column. */
function spanStyle(start: number, end: number): CSSProperties {
  const length = Math.max(end - start, MIN_MINUTES);
  return { top: `calc(${start} * var(--minute))`, height: `calc(${length} * var(--minute) - 2px)` };
}

interface Gesture {
  readonly kind: 'create' | 'resize';
  readonly pointerId: number;
  readonly pointerType: string;
  readonly column: number;
  readonly element: HTMLElement;
  readonly x: number;
  readonly y: number;
  /** create: the first snapped minute; resize: the block's start minute in its column. */
  readonly origin: number;
  readonly key: string | null;
  started: boolean;
  timer: number | null;
}

/**
 * The Week and Day timelines (docs/EVENTS.md §2.5, §2.6, §5.3, §6.5
 * `Timeline`): column headers in both calendars, the all-day row (bars in
 * lanes, collapsible after 3 lanes with "+N"), and a 24-hour timeline whose
 * blocks come from core's `layoutThirteenWeekEvents` or `layoutDayEvents` with
 * `maxSlots` = floor(column width / minimum block width), so a crowded cluster
 * shows a "+{n}" block that lists the rest. The now line runs under the blocks,
 * with its dot and time on the axis (§2.2). Intercalary days are their own
 * 60% columns, hatched.
 *
 * Each column is a `role="group"` named for its day (§2.20), holding its
 * blocks in start order and a "New event" action. Arrows move between columns
 * (a roving tab stop); Enter or F2 moves into the column's events, arrows or Tab
 * among them, Escape back; Enter opens an event. Click and drag on empty time
 * makes a draft (15-minute snap); double-click makes a one-hour draft at that
 * half hour; with `placeholder` a tap draws the "New event" block first. A
 * block's bottom edge changes its end. Moving blocks is the caller's drag
 * (`itemProps`, `preview`).
 */
export function Timeline({
  days,
  systemId,
  occurrences,
  calendars,
  today,
  now,
  use24Hour,
  label,
  showHeader = true,
  minBlockRem = 3,
  largeText = false,
  selectedKey = null,
  onSelectItem,
  onOpenItem,
  onOpenDay,
  onCreate,
  placeholder = false,
  onResize,
  itemProps,
  rowProps,
  preview = null,
  canMove = (occurrence) => occurrence.readOnly === null,
  onSwipe,
  scrollKey,
  className,
}: TimelineProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [slotWidth, setSlotWidth] = useState(0);
  const [height, setHeight] = useState<number | null>(null);
  const daysKey = days.kind === 'week' ? `${days.year}-${days.month}-${days.week}` : iso(days.date);

  // ---- maxSlots from the width of a day column (0 in jsdom: unlimited) ----
  // Measured again when the days change: a week with an intercalary column has narrower day columns
  // although the body keeps its width. Day mode on an intercalary day has only that column.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body === null || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const column =
        body.querySelector<HTMLElement>('[data-timeline-day]:not([data-intercalary])') ??
        body.querySelector<HTMLElement>('[data-timeline-day]');
      setSlotWidth(column?.getBoundingClientRect().width ?? 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [daysKey]);
  const maxSlots = slotWidth > 0 ? Math.max(1, Math.floor(slotWidth / (minBlockRem * rootFontSize()))) : undefined;

  const layout = useMemo(
    () => (occurrences === null ? emptyLayout(days, systemId) : computeLayout(days, occurrences, systemId, maxSlots)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [occurrences, systemId, maxSlots, days.kind, daysKey],
  );
  const { columns } = layout;
  const byKey = useMemo(() => new Map((occurrences ?? []).map((o) => [o.key, o])), [occurrences]);
  const calendarOf = (o: StoreOccurrence) => calendars.get(o.calendarId);
  const colorOf = (o: StoreOccurrence) => calendarOf(o)?.color ?? '#57534e';
  const titleOf = (o: StoreOccurrence) => calendarOf(o)?.title ?? '';

  // ---- the scroller fills the window below it, and opens at 07:00 or the first event ----
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return undefined;
    const measure = () => {
      // The hours fill the window under the toolbar; where that leaves too little room (phones), the
      // timeline takes most of the window and the page scrolls to it.
      const top = scroller.getBoundingClientRect().top + window.scrollY;
      const available = window.innerHeight - top - 16;
      const rem = rootFontSize();
      setHeight(Math.round(available >= 24 * rem ? available : Math.min(window.innerHeight - 2 * rem, 40 * rem)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const firstMinute = useMemo(() => {
    let first = OPEN_MINUTE;
    for (const item of layout.timed) if (!item.clippedStart && item.startMinute < first) first = item.startMinute;
    return first;
  }, [layout.timed]);
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const body = bodyRef.current;
    if (scroller === null || body === null) return;
    const key = scrollKey ?? 'timeline';
    if (scrolledFor.current === key && occurrences !== null) return;
    if (occurrences === null && scrolledFor.current === key) return;
    scrolledFor.current = occurrences === null ? null : key;
    const perMinute = body.getBoundingClientRect().height / DAY;
    scroller.scrollTop = Math.max(0, firstMinute * perMinute - 8);
  }, [scrollKey, firstMinute, occurrences]);

  // ---- now (§2.2) ----
  const nowColumn = now === null ? -1 : columns.findIndex((c) => sameDay(c.gregorian, now.date));
  const nowMinute = now?.minute ?? 0;

  // ---- the all-day row: lanes, collapsed after 3 ----
  const laneCount = layout.allDay.reduce((max, item) => Math.max(max, item.lane + 1), 0);
  const [expanded, setExpanded] = useState(false);
  const collapsible = laneCount > ALL_DAY_LANES;
  const shownLanes = collapsible && !expanded ? ALL_DAY_LANES - 1 : laneCount;
  const hiddenPerColumn = useMemo(() => {
    const counts = columns.map(() => 0);
    if (!collapsible || expanded) return counts;
    for (const item of layout.allDay) {
      if (item.lane < shownLanes) continue;
      for (let c = item.startColumn; c <= item.endColumn; c++) counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  }, [columns, collapsible, expanded, layout.allDay, shownLanes]);

  // ---- local gestures: drafts, the placeholder, resizing ----
  const [draft, setDraftState] = useState<{ column: number; from: number; to: number } | null>(null);
  const [placed, setPlaced] = useState<{ column: number; start: number } | null>(null);
  const [resizing, setResizingState] = useState<{ key: string; column: number; end: number } | null>(null);
  // The latest values, for the pointerup that ends a gesture.
  const draftRef = useRef(draft);
  const resizingRef = useRef(resizing);
  const setDraft = (value: { column: number; from: number; to: number } | null) => {
    draftRef.current = value;
    setDraftState(value);
  };
  const setResizing = (value: { key: string; column: number; end: number } | null) => {
    resizingRef.current = value;
    setResizingState(value);
  };
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  /**
   * A tap on empty time with the placeholder on, kept from `pointerup` to the `click` that follows it.
   * The placeholder is drawn on that click, not on `pointerup`: after a touch, Chromium and WebKit
   * hit-test the click once `pointerup` has re-rendered, so a placeholder drawn there would take the
   * same tap's click and open the editor at once (§2.6 asks for a second tap).
   */
  const tap = useRef<{ readonly column: number; readonly y: number } | null>(null);
  useEffect(() => setPlaced(null), [scrollKey]);

  const timeAt = (column: number, minute: number): LocalDateTime =>
    addMinutesLocal({ date: columns[column]!.gregorian, minute: 0 }, minute);

  const createAt = (column: number, from: number, to: number, anchor: HTMLElement | null) => {
    if (!onCreate) return;
    const start = timeAt(column, from);
    // An end at midnight is `D T24:00` (end-of-day form, §3.1.1).
    onCreate({ date: columns[column]!.gregorian, allDay: false, start, end: normalizeEventEnd(start, timeAt(column, to)), anchor });
  };

  const endGesture = () => {
    const g = gesture.current;
    if (g?.timer != null) window.clearTimeout(g.timer);
    gesture.current = null;
  };
  useEffect(() => endGesture, []);

  const onColumnPointerDown = (column: number) => (event: PointerEvent<HTMLDivElement>) => {
    tap.current = null;
    if (event.button !== 0 || !onCreate) return;
    if (event.target instanceof Element && event.target.closest('button, [data-key]') !== null) return;
    const element = event.currentTarget;
    const minute = clampMinute(floorTo(minuteAt(element, event.clientY), SNAP));
    const g: Gesture = {
      kind: 'create',
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      column,
      element,
      x: event.clientX,
      y: event.clientY,
      origin: Math.min(minute, DAY - SNAP),
      key: null,
      started: false,
      timer: null,
    };
    if (event.pointerType === 'touch') {
      if (placeholder) {
        gesture.current = g;
        return;
      }
      // Touch and hold makes a one-hour draft at that half hour, stretched by dragging before lifting (§2.4).
      g.timer = window.setTimeout(() => {
        const half = floorTo(minuteAt(element, g.y), 30);
        const start = Math.min(Math.max(half, 0), DAY - 60);
        gesture.current = { ...g, origin: start, started: true, timer: null };
        element.setPointerCapture?.(g.pointerId);
        setDraft({ column, from: start, to: start + 60 });
      }, LONG_PRESS_MS);
      gesture.current = g;
      return;
    }
    gesture.current = g;
    element.setPointerCapture?.(event.pointerId);
  };

  const onColumnPointerMove = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (g === null || g.pointerId !== event.pointerId) return;
    const slop = g.pointerType === 'touch' ? TOUCH_SLOP : MOUSE_SLOP;
    const moved = Math.hypot(event.clientX - g.x, event.clientY - g.y) > slop;
    if (!g.started) {
      if (!moved) return;
      if (g.pointerType === 'touch') {
        // A drag on empty time scrolls (§2.4): not a gesture.
        endGesture();
        return;
      }
      g.started = true;
    }
    const minute = minuteAt(g.element, event.clientY);
    if (g.kind === 'resize') {
      const end = clampMinute(Math.max(Math.round(minute / SNAP) * SNAP, g.origin + SNAP));
      setResizing({ key: g.key!, column: g.column, end });
      return;
    }
    const at = clampMinute(Math.round(minute / SNAP) * SNAP);
    const from = Math.min(g.origin, at);
    let to = Math.max(g.origin + SNAP, at);
    if (g.pointerType === 'touch') to = Math.max(to, g.origin + 60);
    setDraft({ column: g.column, from, to: Math.min(to, DAY) });
  };

  const onColumnPointerUp = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (g === null || g.pointerId !== event.pointerId) return;
    endGesture();
    if (g.kind === 'resize') {
      const current = resizingRef.current;
      setResizing(null);
      if (g.started && current !== null && onResize) {
        suppressClick.current = true;
        onResize(g.key!, timeAt(current.column, current.end), g.element.closest<HTMLElement>('[data-key]'));
      }
      return;
    }
    if (g.started) {
      const current = draftRef.current;
      if (current !== null) {
        const anchor = g.element.querySelector<HTMLElement>('[data-draft]');
        if (g.pointerType === 'touch') swallowClickAfterTouch();
        createAt(current.column, current.from, current.to, anchor);
      }
      setDraft(null);
      return;
    }
    // A tap or click on empty time. With the placeholder, the click that follows draws or removes it.
    if (placeholder) {
      tap.current = { column: g.column, y: event.clientY };
      return;
    }
    onSelectItem?.(null);
  };

  const onColumnClick = (column: number) => (event: MouseEvent<HTMLDivElement>) => {
    const pending = tap.current;
    tap.current = null;
    if (!placeholder || pending === null || pending.column !== column) return;
    if (event.target instanceof Element && event.target.closest('button, [data-key]') !== null) return;
    if (placed !== null) {
      // A tap anywhere else removes it (§2.6), also on other empty time.
      setPlaced(null);
      return;
    }
    const half = floorTo(minuteAt(event.currentTarget, pending.y), 30);
    setPlaced({ column, start: Math.min(Math.max(half, 0), DAY - 60) });
  };

  const onColumnPointerCancel = () => {
    endGesture();
    tap.current = null;
    setDraft(null);
    setResizing(null);
  };

  const onColumnDoubleClick = (column: number) => (event: MouseEvent<HTMLDivElement>) => {
    if (!onCreate || placeholder) return;
    if (event.target instanceof Element && event.target.closest('button, [data-key]') !== null) return;
    const half = floorTo(minuteAt(event.currentTarget, event.clientY), 30);
    const start = Math.min(Math.max(half, 0), DAY - 60);
    createAt(column, start, start + 60, event.currentTarget);
  };

  const onResizePointerDown = (key: string, column: number, startMinute: number) => (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0 || event.pointerType === 'touch' || !onResize) return;
    event.stopPropagation();
    event.preventDefault();
    const element = event.currentTarget.closest<HTMLElement>('[data-timeline-day]');
    if (element === null) return;
    gesture.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      column,
      element,
      x: event.clientX,
      y: event.clientY,
      origin: startMinute,
      key,
      started: false,
      timer: null,
    };
    element.setPointerCapture?.(event.pointerId);
  };

  // A resize ends with a click on the block: it is not a selection.
  const swallowClick = (event: MouseEvent) => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  // ---- swipes (touch): a quick horizontal stroke pages; vertical strokes scroll (`touch-action: pan-y`) ----
  const swipe = useRef<{ id: number; x: number; y: number; at: number; onItem: boolean } | null>(null);
  const onBodyPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const onItem = event.target instanceof Element && event.target.closest('[data-key]') !== null;
    swipe.current =
      event.pointerType === 'touch' && onSwipe ? { id: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now(), onItem } : null;
  };
  const onBodyPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (start === null || start.id !== event.pointerId || !onSwipe) return;
    // Touch and hold on a block picks it up (the caller's drag): that stroke moves the event, it does not page.
    if (start.onItem && Date.now() - start.at >= LONG_PRESS_MS) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= 60 && Math.abs(dy) < Math.abs(dx) / 2 && Date.now() - start.at < 800) {
      endGesture();
      setDraft(null);
      onSwipe(dx < 0 ? 1 : -1);
    }
  };

  // ---- keyboard (§2.20, §2.21) ----
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const fallbackColumn = (() => {
    const selected = selectedKey === null ? -1 : layout.timed.findIndex((t) => t.key === selectedKey);
    if (selected >= 0) return layout.timed[selected]!.column;
    const todayIndex = columns.findIndex((c) => sameDay(c.gregorian, today));
    return todayIndex >= 0 ? todayIndex : 0;
  })();
  const [activeColumn, setActiveColumn] = useState<number | null>(null);
  const active = activeColumn !== null && activeColumn < columns.length ? activeColumn : fallbackColumn;
  useEffect(() => setActiveColumn(null), [scrollKey]);

  const itemsOf = (column: number): HTMLElement[] => {
    const bars = [...(scrollerRef.current?.querySelectorAll<HTMLElement>(`[data-allday-item][data-columns~="${column}"]`) ?? [])];
    const inColumn = [...(columnRefs.current[column]?.querySelectorAll<HTMLElement>('[data-column-item]') ?? [])];
    return [...bars, ...inColumn];
  };

  const focusColumn = (column: number) => {
    setActiveColumn(column);
    columnRefs.current[column]?.focus();
  };

  const onColumnKeyDown = (column: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        if (column > 0) focusColumn(column - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (column < columns.length - 1) focusColumn(column + 1);
        break;
      case 'Home':
        event.preventDefault();
        focusColumn(0);
        break;
      case 'End':
        event.preventDefault();
        focusColumn(columns.length - 1);
        break;
      case 'Enter':
      case 'F2': {
        const first = itemsOf(column)[0];
        if (first !== undefined) {
          event.preventDefault();
          first.focus();
        }
        break;
      }
      default:
        break;
    }
  };

  const onItemKeyDown = (column: number, key: string | null) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const items = itemsOf(column);
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
        columnRefs.current[column]?.focus();
        break;
      case 'Enter':
        if (key !== null) {
          event.preventDefault();
          onOpenItem?.(key, event.currentTarget);
        }
        break;
      default:
        break;
    }
  };

  /** The column's "New event" action: one hour from the next half hour on screen (§2.6). */
  const addOnScreen = (column: number, anchor: HTMLElement) => {
    const scroller = scrollerRef.current;
    const body = bodyRef.current;
    let minute = OPEN_MINUTE;
    if (scroller !== null && body !== null) {
      const perMinute = body.getBoundingClientRect().height / DAY;
      if (perMinute > 0) minute = Math.ceil(scroller.scrollTop / perMinute / 30) * 30;
    }
    if (now !== null && sameDay(columns[column]!.gregorian, now.date)) minute = Math.max(minute, Math.ceil(now.minute / 30) * 30);
    const start = Math.min(Math.max(minute, 0), DAY - 60);
    createAt(column, start, start + 60, anchor);
  };

  // ---- the "+{n}" list ----
  const [more, setMoreState] = useState<{ overflow: TimedOverflow; anchor: HTMLElement } | null>(null);
  // Kept after the list closes, so Escape returns focus to the "+{n}" block (§2.20).
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const setMore = (value: { overflow: TimedOverflow; anchor: HTMLElement } | null) => {
    if (value !== null) setMoreAnchor(value.anchor);
    setMoreState(value);
  };
  // The list follows changes (a row dragged out of it, a change elsewhere): it lists the "+{n}" block
  // now at the same place, and closes once that block is gone, rather than listing stale keys
  // under a block that no longer exists.
  const liveMore: TimedOverflow | null = useMemo(() => {
    if (more === null) return null;
    const { column, startMinute } = more.overflow;
    return layout.overflow.find((o) => o.column === column && o.startMinute === startMinute) ?? null;
  }, [more, layout.overflow]);
  useEffect(() => {
    if (more !== null && liveMore === null && occurrences !== null) setMoreState(null);
  }, [more, liveMore, occurrences]);
  const moreDay: AgendaDay | null = useMemo(() => {
    if (liveMore === null || occurrences === null) return null;
    const keys = new Set(liveMore.keys);
    const date = columns[liveMore.column]?.gregorian;
    if (date === undefined) return null;
    const list = occurrences.filter((o) => keys.has(o.key));
    return agenda(list, date, date, systemId, { includeEmptyDays: true })[0] ?? null;
  }, [liveMore, occurrences, columns, systemId]);
  const moreTitle =
    liveMore === null ? '' : plural('calendar.moreAt.a11y', liveMore.keys.length, { time: formatTime(liveMore.startMinute, use24Hour) });

  // ---- drawing ----
  // Week draws intercalary columns 60% wide (§2.5); Day's one column takes the whole width.
  const template = days.kind === 'day' ? '1fr' : columns.map((c) => (c.intercalary ? '0.6fr' : '1fr')).join(' ');
  const gridStyle = { ['--columns' as string]: template } as CSSProperties;

  const block = (item: TimedItem): ReactNode => {
    const occurrence = byKey.get(item.key);
    if (occurrence === undefined || item.hidden) return null;
    const column = columns[item.column]!;
    const resized = resizing !== null && resizing.key === item.key && resizing.column === item.column ? resizing.end : null;
    const end = resized ?? item.endMinute;
    const length = Math.max(end - item.startMinute, MIN_MINUTES);
    const short = length < SHORT_MINUTES;
    const covered = occurrenceDays(occurrence.start, occurrence.end);
    const dayOf =
      covered.length > 1 ? { n: covered.findIndex((d) => sameDay(d, column.gregorian)) + 1, total: covered.length } : null;
    const movable = canMove(occurrence);
    const tentative = occurrence.status === 'tentative';
    const canceled = occurrence.status === 'canceled';
    const dragging = preview !== null && preview.key === item.key && !preview.copy;
    const range = formatTimeRange(occurrence.start.minute, occurrence.end.minute, use24Hour);
    const extra = itemProps?.(item.key, column.gregorian);
    return (
      <button
        key={`${item.key}:${item.column}`}
        {...extra}
        type="button"
        tabIndex={-1}
        data-key={item.key}
        data-column-item=""
        data-movable={movable ? '' : undefined}
        aria-label={itemLabel(occurrence, titleOf(occurrence), use24Hour, { dayOf })}
        aria-pressed={selectedKey === item.key}
        className={cx(
          styles.block,
          short && styles.short,
          tentative && styles.tentative,
          canceled && styles.canceled,
          selectedKey === item.key && styles.selected,
          dragging && styles.dragging,
          item.clippedStart && styles.clippedStart,
          item.clippedEnd && styles.clippedEnd,
        )}
        style={{
          ...spanStyle(item.startMinute, end),
          left: `calc(${item.slot} * 100% / ${item.slotCount} + 2px)`,
          width: `calc(100% / ${item.slotCount} - 4px)`,
          ['--cal' as string]: colorOf(occurrence),
        }}
        onClick={(event) => {
          if (swallowClick(event)) return;
          onSelectItem?.(item.key);
          event.currentTarget.focus();
        }}
        onDoubleClick={(event) => onOpenItem?.(item.key, event.currentTarget)}
        onFocus={() => onSelectItem?.(item.key)}
        onKeyDown={onItemKeyDown(item.column, item.key)}
      >
        <span className={styles.blockBody} aria-hidden="true">
          <span className={styles.blockTitle} data-user-text>
            {occurrence.title}
          </span>
          {short ? (
            <span className={styles.blockTime}>{formatTime(occurrence.start.minute, use24Hour)}</span>
          ) : (
            <span className={styles.blockTime}>{range}</span>
          )}
          {!short && length >= LOCATION_MINUTES && occurrence.location !== '' ? (
            <span className={styles.blockLocation} data-user-text>
              {occurrence.location}
            </span>
          ) : null}
          {tentative ? <span className={styles.tag}>{copy('event.tentative')}</span> : null}
          {canceled ? <span className={styles.tag}>{copy('event.canceled')}</span> : null}
        </span>
        {movable && onResize && !item.clippedEnd ? (
          <span
            className={styles.resize}
            aria-hidden="true"
            data-resize-handle=""
            onPointerDown={onResizePointerDown(item.key, item.column, item.startMinute)}
          />
        ) : null}
      </button>
    );
  };

  const overflowBlock = (overflow: TimedOverflow): ReactNode => {
    const n = overflow.keys.length;
    const name = plural('calendar.moreAt.a11y', n, { time: formatTime(overflow.startMinute, use24Hour) });
    return (
      <button
        key={`more:${overflow.column}:${overflow.startMinute}`}
        type="button"
        tabIndex={-1}
        data-column-item=""
        aria-label={name}
        className={styles.more}
        style={{
          ...spanStyle(overflow.startMinute, Math.min(overflow.endMinute, DAY)),
          left: `calc(${overflow.slot} * 100% / ${overflow.slotCount} + 2px)`,
          width: `calc(100% / ${overflow.slotCount} - 4px)`,
        }}
        onClick={(event) => setMore({ overflow, anchor: event.currentTarget })}
        onKeyDown={onItemKeyDown(overflow.column, null)}
      >
        <span aria-hidden="true">+{n}</span>
      </button>
    );
  };

  const ghosts = (column: number): ReactNode => {
    if (preview === null || preview.kind !== 'timed') return null;
    const occurrence = byKey.get(preview.key);
    const dayStart = jdn(columns[column]!.gregorian) * DAY;
    const start = absolute(preview.start) - dayStart;
    const end = absolute(preview.end) - dayStart;
    if (end <= 0 && !(start === 0 && end === 0)) return null;
    if (start >= DAY) return null;
    const from = Math.max(start, 0);
    const to = Math.min(Math.max(end, start + MIN_MINUTES), DAY);
    return (
      <div
        className={cx(styles.ghost, preview.copy && styles.ghostCopy)}
        style={{ ...spanStyle(from, to), ['--cal' as string]: occurrence ? colorOf(occurrence) : 'var(--t-accent)' }}
        aria-hidden="true"
      >
        <span className={styles.blockTitle}>{occurrence?.title ?? ''}</span>
        <span className={styles.blockTime}>
          {formatTimeRange(preview.start.minute, preview.end.minute, use24Hour)}
        </span>
      </div>
    );
  };

  const draftBlock = (column: number): ReactNode => {
    if (draft !== null && draft.column === column) {
      return (
        <div className={cx(styles.draft)} style={spanStyle(draft.from, draft.to)} data-draft="" aria-hidden="true">
          <span className={styles.blockTitle}>{copy('calendar.placeholder')}</span>
          <span className={styles.blockTime}>{formatTimeRange(draft.from, draft.to, use24Hour)}</span>
        </div>
      );
    }
    if (placed !== null && placed.column === column) {
      const range = formatTimeRange(placed.start, placed.start + 60, use24Hour);
      return (
        <button
          type="button"
          className={styles.draft}
          style={spanStyle(placed.start, placed.start + 60)}
          aria-label={copy('calendar.placeholder.a11y', { 'time range': range })}
          data-column-item=""
          data-placeholder=""
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            const at = placed;
            setPlaced(null);
            createAt(at.column, at.start, at.start + 60, event.currentTarget);
          }}
          onKeyDown={onItemKeyDown(column, null)}
        >
          <span className={styles.blockTitle} aria-hidden="true">
            {copy('calendar.placeholder')}
          </span>
          <span className={styles.blockTime} aria-hidden="true">
            {range}
          </span>
        </button>
      );
    }
    return null;
  };

  // The placeholder goes away on a tap anywhere else (§2.6): outside the timeline, on an event or
  // another button. A tap on other empty time is the column's own (`onColumnClick`), so that tap
  // does not draw a new placeholder.
  useEffect(() => {
    if (placed === null) return undefined;
    const away = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-placeholder]')) return;
      if (target?.closest('[data-timeline-day]') && !target.closest('button, [data-key]')) return;
      setPlaced(null);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [placed]);

  const hours = useMemo(() => Array.from({ length: 23 }, (_, i) => i + 1), []);
  const nowLabel = now === null ? '' : formatTime(nowMinute, use24Hour);

  const header = showHeader ? (
    <div className={styles.head} style={gridStyle}>
      <div className={styles.corner} aria-hidden="true" />
      {columns.map((column) => {
        const isToday = sameDay(column.gregorian, today);
        const name = columnLabel(column);
        const gregorian = formatGregorian(column.gregorian, { style: 'short', includeWeekday: true, includeYear: false });
        const intercalary = column.thirteen.kind === 'intercalary'
          ? intercalaryDaysInYear(column.gregorian.year, systemId).find((d) => sameDay(d.gregorian, column.gregorian)) ?? null
          : null;
        return (
          <button
            key={iso(column.gregorian)}
            type="button"
            className={cx(styles.headCell, column.intercalary && styles.headIntercalary, isToday && styles.headToday)}
            aria-label={name}
            aria-current={isToday ? 'date' : undefined}
            onClick={() => onOpenDay?.(column.gregorian)}
          >
            <span aria-hidden="true" className={cx(styles.headInner, intercalary !== null && styles.headStack)}>
              {intercalary !== null ? (
                <>
                  <span className={styles.plate}>{intercalary.code}</span>
                  <span className={styles.headName}>{intercalary.shortName}</span>
                </>
              ) : (
                <>
                  <span className={styles.headWeekday}>
                    {weekdayName(thirteenWeekday(column.thirteen) ?? 0, 'short')}
                  </span>
                  <span className={styles.headDay}>{column.thirteen.kind === 'month' ? column.thirteen.day : ''}</span>
                </>
              )}
              <span className={styles.headGregorian}>{gregorian}</span>
            </span>
          </button>
        );
      })}
    </div>
  ) : null;

  const allDayBars = layout.allDay
    .filter((item) => item.lane < shownLanes)
    .map((item) => {
      const occurrence = byKey.get(item.key);
      if (occurrence === undefined) return null;
      const first = columns[item.startColumn]!;
      const covered = occurrenceDays(occurrence.start, occurrence.end);
      const dayIndex = covered.findIndex((d) => sameDay(d, first.gregorian)) + 1;
      const dragging = preview !== null && preview.key === item.key && !preview.copy;
      const spanned = Array.from({ length: item.endColumn - item.startColumn + 1 }, (_, i) => item.startColumn + i).join(' ');
      const extra = itemProps?.(item.key, first.gregorian);
      return (
        <EventChip
          key={item.key}
          {...extra}
          occurrence={occurrence}
          color={colorOf(occurrence)}
          variant="bar"
          notchStart={item.continuesBefore}
          notchEnd={item.continuesAfter}
          label={barLabel(occurrence, titleOf(occurrence), first.gregorian.year, use24Hour, {
            before: item.continuesBefore,
            after: item.continuesAfter,
          })}
          selected={selectedKey === item.key}
          tabIndex={-1}
          data-allday-item=""
          data-columns={spanned}
          data-movable={canMove(occurrence) ? '' : undefined}
          className={cx(styles.bar, dragging && styles.dragging)}
          style={{ gridColumn: `${item.startColumn + 2} / ${item.endColumn + 3}`, gridRow: item.lane + 1 }}
          trailing={
            days.kind === 'day' && covered.length > 1 ? (
              <span className={styles.barDay}>{copy('calendar.dayOfDays', { n: dayIndex, total: covered.length })}</span>
            ) : null
          }
          onClick={(event) => {
            onSelectItem?.(item.key);
            event.currentTarget.focus();
          }}
          onDoubleClick={(event) => onOpenItem?.(item.key, event.currentTarget)}
          onFocus={() => onSelectItem?.(item.key)}
          onKeyDown={onItemKeyDown(item.startColumn, item.key)}
        />
      );
    });

  const allDayGhost = (() => {
    if (preview === null || preview.kind !== 'all-day') return null;
    const first = jdn(columns[0]!.gregorian);
    const last = first + columns.length - 1;
    const from = Math.max(jdn(preview.first), first);
    const to = Math.min(jdn(preview.last), last);
    if (from > to) return null;
    const occurrence = byKey.get(preview.key);
    return (
      <div
        className={cx(styles.barGhost, preview.copy && styles.ghostCopy)}
        style={{
          gridColumn: `${from - first + 2} / ${to - first + 3}`,
          gridRow: shownLanes + (collapsible && !expanded ? 2 : 1),
          ['--cal' as string]: occurrence ? colorOf(occurrence) : 'var(--t-accent)',
        }}
        aria-hidden="true"
      >
        {occurrence?.title ?? ''}
      </div>
    );
  })();

  const allDayRow = (
    <div className={styles.allDay} style={gridStyle} role="group" aria-label={copy('event.allDay')} data-allday-row="">
      <div className={styles.allDayLabel} style={{ gridRow: '1 / -1' }}>
        {collapsible ? (
          <button
            type="button"
            className={styles.allDayToggle}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {copy('event.allDay')}
          </button>
        ) : (
          <span aria-hidden="true">{copy('event.allDay')}</span>
        )}
      </div>
      {columns.map((column, index) => (
        <div
          key={iso(column.gregorian)}
          className={cx(styles.allDayCell, column.intercalary && styles.intercalary)}
          style={{ gridColumn: index + 2, gridRow: '1 / -1' }}
          data-timeline-allday=""
          data-date={iso(column.gregorian)}
          onDoubleClick={(event) => {
            if (!onCreate || (event.target instanceof Element && event.target.closest('button'))) return;
            onCreate({
              date: column.gregorian,
              allDay: true,
              start: { date: column.gregorian, minute: 0 },
              end: { date: column.gregorian, minute: DAY },
              anchor: event.currentTarget,
            });
          }}
        />
      ))}
      {allDayBars}
      {collapsible && !expanded
        ? hiddenPerColumn.map((count, index) =>
            count > 0 ? (
              <button
                key={`more-${index}`}
                type="button"
                tabIndex={-1}
                className={styles.allDayMore}
                data-allday-item=""
                data-columns={String(index)}
                style={{ gridColumn: index + 2, gridRow: ALL_DAY_LANES }}
                aria-label={plural('calendar.more.a11y', count, {
                  date: formatThirteen(columns[index]!.thirteen, { style: 'long', includeWeekday: true }),
                })}
                aria-expanded={false}
                onClick={() => setExpanded(true)}
                onKeyDown={onItemKeyDown(index, null)}
              >
                <span aria-hidden="true">+{count}</span>
              </button>
            ) : null,
          )
        : null}
      {allDayGhost}
      {/* Keeps the row one lane tall when it is empty. */}
      <div style={{ gridColumn: 2, gridRow: Math.max(1, shownLanes + (collapsible && !expanded ? 1 : 0)) }} aria-hidden="true" />
    </div>
  );

  const moreRows =
    moreDay !== null ? (
      <div className={styles.moreBody} data-date={iso(moreDay.gregorian)}>
        <AgendaRows
          day={moreDay}
          occurrences={byKey}
          calendars={calendars}
          use24Hour={use24Hour}
          now={now}
          selectedKey={selectedKey}
          rowProps={rowProps}
          onOpen={(key, anchor) => {
            onSelectItem?.(key);
            onOpenItem?.(key, anchor);
          }}
        />
      </div>
    ) : null;

  return (
    <div
      className={cx(styles.timeline, className)}
      role="region"
      aria-label={label}
      aria-busy={occurrences === null ? true : undefined}
      data-timeline={days.kind}
    >
      <div className={styles.scroller} ref={scrollerRef} style={height === null ? undefined : { height }}>
        <div className={styles.top}>
          {header}
          {allDayRow}
        </div>
        <div
          className={styles.body}
          ref={bodyRef}
          style={gridStyle}
          onPointerDownCapture={onBodyPointerDown}
          onPointerUpCapture={onBodyPointerUp}
        >
          <div className={styles.axis} aria-hidden="true">
            {hours.map((hour) =>
              // An hour label gives way to the now label only where they would touch (board F1 shows
              // "10:00" under "09:41"): both are 0.625rem tall on a 3rem hour, about 16 minutes apart.
              nowColumn >= 0 && Math.abs(hour * 60 - nowMinute) < NOW_LABEL_CLEARANCE ? null : (
                <span key={hour} className={styles.hour} style={{ top: `calc(${hour * 60} * var(--minute))` }}>
                  {formatTime(hour * 60, use24Hour).replace(':00 ', ' ')}
                </span>
              ),
            )}
            {nowColumn >= 0 ? (
              <>
                <span className={styles.nowLabel} style={{ top: `calc(${nowMinute} * var(--minute))` }}>
                  {nowLabel}
                </span>
                <span className={styles.nowDot} style={{ top: `calc(${nowMinute} * var(--minute))` }} />
              </>
            ) : null}
          </div>
          {columns.map((column, index) => {
            const isToday = sameDay(column.gregorian, today);
            return (
              <div
                key={iso(column.gregorian)}
                ref={(element) => {
                  columnRefs.current[index] = element;
                }}
                role="group"
                aria-label={columnLabel(column)}
                tabIndex={index === active ? 0 : -1}
                className={cx(styles.column, column.intercalary && styles.intercalary, isToday && styles.columnToday)}
                data-timeline-day=""
                data-intercalary={column.intercalary ? '' : undefined}
                data-date={iso(column.gregorian)}
                onFocus={(event) => {
                  if (event.target === event.currentTarget) setActiveColumn(index);
                }}
                onKeyDown={onColumnKeyDown(index)}
                onPointerDown={onColumnPointerDown(index)}
                onPointerMove={onColumnPointerMove}
                onPointerUp={onColumnPointerUp}
                onPointerCancel={onColumnPointerCancel}
                onClick={onColumnClick(index)}
                onDoubleClick={onColumnDoubleClick(index)}
              >
                {nowColumn >= 0 ? (
                  <div
                    className={cx(styles.nowLine, index !== nowColumn && styles.nowFaint)}
                    style={{ top: `calc(${nowMinute} * var(--minute))` }}
                    aria-hidden="true"
                  />
                ) : null}
                {layout.timed.filter((item) => item.column === index).map(block)}
                {layout.overflow.filter((o) => o.column === index).map(overflowBlock)}
                {ghosts(index)}
                {draftBlock(index)}
                {onCreate ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    className={styles.add}
                    data-column-item=""
                    onPointerDown={(event) => event.stopPropagation()}
                    onFocus={(event) => {
                      // Shown where the column is on screen (body coordinates start under the sticky header).
                      event.currentTarget.style.top = `${(scrollerRef.current?.scrollTop ?? 0) + 6}px`;
                    }}
                    onClick={(event) => addOnScreen(index, event.currentTarget)}
                    onKeyDown={onItemKeyDown(index, null)}
                  >
                    {copy('calendar.newEvent')}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {largeText ? (
        <Dialog open={more !== null && moreDay !== null} onRequestClose={() => setMore(null)} title={moreTitle} closeButton compact="sheet">
          {moreRows}
        </Dialog>
      ) : (
        <Popover
          open={more !== null && moreDay !== null}
          onClose={() => setMore(null)}
          anchor={moreAnchor}
          placement="right-start"
          arrow
          aria-label={moreTitle}
          className={styles.morePopover}
          width={320}
        >
          <p className={styles.moreTitle}>{moreTitle}</p>
          {moreRows}
        </Popover>
      )}
    </div>
  );
}

/** The 13-month week strip of Day mode (§2.6): the week's days (plus an intercalary day), the selected one filled. */
export interface WeekStripProps {
  readonly days: readonly TimelineColumn[];
  readonly selected: GregorianDate;
  readonly today: GregorianDate | null;
  readonly systemId: CalendarSystemId;
  readonly onSelect: (date: GregorianDate) => void;
  readonly className?: string;
}

export function WeekStrip({ days, selected, today, systemId, onSelect, className }: WeekStripProps) {
  const intercalary = useMemo(
    () => new Map(days.flatMap((d) => intercalaryDaysInYear(d.gregorian.year, systemId)).map((d) => [iso(d.gregorian), d])),
    [days, systemId],
  );
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (delta === 0) return;
    const next = days[index + delta];
    if (next === undefined) return;
    event.preventDefault();
    onSelect(next.gregorian);
    refs.current[index + delta]?.focus();
  };
  return (
    <div className={cx(styles.strip, className)} style={{ ['--days' as string]: String(days.length) }}>
      {days.map((day, index) => {
        const on = sameDay(day.gregorian, selected);
        const isToday = sameDay(day.gregorian, today);
        const special = intercalary.get(iso(day.gregorian));
        return (
          <button
            key={iso(day.gregorian)}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            className={cx(styles.stripDay, on && styles.stripOn, isToday && styles.stripToday)}
            aria-pressed={on}
            aria-current={isToday ? 'date' : undefined}
            aria-label={columnLabel(day)}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(day.gregorian)}
            onKeyDown={onKeyDown(index)}
          >
            <span aria-hidden="true" className={styles.stripWeekday}>
              {special !== undefined ? special.code : weekdayName(thirteenWeekday(day.thirteen) ?? 0, 'narrow')}
            </span>
            <span aria-hidden="true" className={styles.stripNumber}>
              {day.thirteen.kind === 'month' ? day.thirteen.day : special?.code ?? ''}
            </span>
            <span aria-hidden="true" className={styles.stripGregorian}>
              {day.gregorian.day}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The days Day mode's strip shows (§2.6): the 13-month week of `date`; on an
 * intercalary day, the week before it plus the intercalary days after week 4.
 */
export function stripDays(date: GregorianDate, systemId: CalendarSystemId): TimelineColumn[] {
  const t = toThirteen(date, systemId);
  let year = t.year;
  let month: number;
  let week: 1 | 2 | 3 | 4;
  if (t.kind === 'month') {
    month = t.month;
    week = (Math.floor((t.day - 1) / 7) + 1) as 1 | 2 | 3 | 4;
  } else {
    month = getCalendarSystem(systemId).intercalaryDays.find((info) => info.id === t.id)!.afterMonth;
    week = 4;
    year = t.year;
  }
  return emptyLayout({ kind: 'week', year, month, week }, systemId).columns.slice();
}

/** True when the day's events have finished loading and the timeline would draw nothing on it. */
export function dayIsEmpty(occurrences: readonly StoreOccurrence[], date: GregorianDate): boolean {
  const start = { date, minute: 0 };
  const end = { date, minute: DAY };
  return !occurrences.some((o) => compareLocalDateTime(o.start, end) < 0 && (compareLocalDateTime(o.end, start) > 0 || absolute(o.start) === absolute(start)));
}

