/**
 * Drag and drop in the Calendar (docs/EVENTS.md §2.4, §2.5, §2.6, §2.11 "Drag
 * edits"), with pointer events so mouse, pen and touch share one model:
 *
 * - Sources: Month chips (regular width), the rows of the compact day list and
 *   of the "+N more" and "+{n}" lists (phones move from the list, §2.4), and the
 *   Week and Day blocks and all-day bars. A mouse or pen drag starts after a few
 *   pixels; touch starts after a long press (a drag before that scrolls).
 *   Read-only events cannot be picked up, except for an Alt-drag copy (§2.2,
 *   §2.4).
 * - Targets: a Month day cell or intercalary band (the event keeps its time),
 *   a timeline column (15-minute snap; the grabbed point stays under the
 *   pointer), and the all-day row (a timed block turns all-day). Targets are
 *   found under the pointer by their `data-date`, `data-timeline-day` and
 *   `data-timeline-allday` attributes, so the views need no drop handlers.
 * - The drop goes to ./useEventMover.tsx (span question, validation, the held
 *   change and its Undo toast). Escape cancels a drag; Alt (Option) at the drop
 *   copies instead (Duplicate at the drop).
 *
 * MonthEventGrid spreads `cellProps` and `itemProps`, AgendaRows `rowProps`;
 * Week and Day pass `itemProps`, `rowProps`, `preview` and `resize` to the
 * Timeline. Render `overlay` once (the span question and the drag image).
 */
import {
  type GregorianDate,
  type LocalDateTime,
  addMinutesLocal,
  diffMinutesLocal,
  occurrenceDays,
  toJulianDayNumber,
  tryParseISODate,
  addGregorianDays,
} from '@thirteen/core';
import { type StoreOccurrence, type TimelinePreview, useEventStore } from '@thirteen/ui';
import {
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { type MoveTarget, SNAP_MINUTES, columnTime, snapLocal } from './moves.ts';
import styles from './TimelineMode.module.css';
import { useEventMover } from './useEventMover.tsx';

export interface CalendarDrag {
  /** A Month day cell or intercalary band: a drop target for the day. */
  readonly cellProps?: (date: GregorianDate) => HTMLAttributes<HTMLElement>;
  /** A Month chip (regular width), a Week or Day block or bar: a drag source. `date` is the cell or column it is drawn in. */
  readonly itemProps?: (key: string, date: GregorianDate) => HTMLAttributes<HTMLElement>;
  /** A row of the compact day list or the "+N more" popover: a drag source (phones move from the list, §2.4). */
  readonly rowProps?: (key: string) => HTMLAttributes<HTMLButtonElement>;
  /** Where the dragged event would land on a timeline (Week, Day). */
  readonly preview?: TimelinePreview | null;
  /** A block's bottom edge was dragged (Week, Day): a change of the end. */
  readonly resize?: (key: string, end: LocalDateTime, anchor: HTMLElement | null) => void;
  /** The span question and the drag image; render once. */
  readonly overlay?: ReactNode;
}

const LONG_PRESS_MS = 500;
const MOUSE_SLOP = 4;
const TOUCH_SLOP = 8;
const EDGE = 40;
const DAY = 1440;

type SourceKind = 'chip' | 'row' | 'block' | 'bar';

interface Session {
  readonly key: string;
  readonly kind: SourceKind;
  /** The day it was picked up on (a chip's cell, a block's or bar's column; a row: the event's first day). */
  readonly from: GregorianDate;
  readonly occurrence: StoreOccurrence;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly element: HTMLElement;
  readonly x: number;
  readonly y: number;
  /** Minutes from the event's start to the grabbed point (blocks), so that point stays under the pointer. */
  offset: number;
  /** Read-only events can only be copied. */
  readonly copyOnly: boolean;
  started: boolean;
  timer: number | null;
  target: MoveTarget | null;
  targetElement: HTMLElement | null;
  copy: boolean;
}

function parseDate(element: Element | null): GregorianDate | null {
  const text = element instanceof HTMLElement ? element.dataset.date : undefined;
  return text === undefined ? null : tryParseISODate(text);
}

function minuteAt(column: HTMLElement, clientY: number): number {
  const rect = column.getBoundingClientRect();
  return rect.height <= 0 ? 0 : ((clientY - rect.top) / rect.height) * DAY;
}

function lengthOf(occurrence: StoreOccurrence): number {
  return occurrence.allDay ? 60 : Math.max(diffMinutesLocal(occurrence.end, occurrence.start), SNAP_MINUTES);
}

/** One click after a drag would open the event: swallow it. */
function swallowNextClick(): void {
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

export function useCalendarDrag(options: { readonly onMoved?: (key: string | null) => void } = {}): CalendarDrag {
  const store = useEventStore();
  const mover = useEventMover(options.onMoved);
  const [preview, setPreview] = useState<TimelinePreview | null>(null);
  const [image, setImage] = useState<{ x: number; y: number; title: string; color: string; copy: boolean } | null>(null);
  const storeRef = useRef(store);
  storeRef.current = store;
  const moverRef = useRef(mover);
  moverRef.current = mover;

  // One set of handlers for the hook's life: every changing value is read through a ref.
  const engine = useMemo(() => {
    let session: Session | null = null;

    const clearTarget = (s: Session) => {
      s.targetElement?.removeAttribute('data-drop-target');
      s.targetElement = null;
    };

    const finish = () => {
      const s = session;
      session = null;
      if (s !== null) {
        if (s.timer !== null) window.clearTimeout(s.timer);
        clearTarget(s);
        s.element.removeAttribute('data-drag-source');
      }
      delete document.documentElement.dataset.calendarDragging;
      setPreview(null);
      setImage(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('touchmove', onTouchMove);
    };

    /** The target under the pointer, and the preview to draw. */
    const locate = (s: Session, x: number, y: number, copy: boolean): void => {
      const hit = document.elementFromPoint(x, y);
      const day = hit?.closest<HTMLElement>('[data-timeline-day]') ?? null;
      const allDay = day === null ? allDayCellAt(hit, x) : null;
      const cell = day === null && allDay === null ? (hit?.closest<HTMLElement>('[role="gridcell"][data-date]') ?? null) : null;
      let target: MoveTarget | null = null;
      let element: HTMLElement | null = null;
      let next: TimelinePreview | null = null;
      const o = s.occurrence;
      if (day !== null) {
        const date = parseDate(day);
        if (date !== null) {
          const pointer = columnTime(date, minuteAt(day, y));
          const start = snapLocal(addMinutesLocal(pointer, -s.offset));
          target = { kind: 'timed', start };
          element = day;
          next = { kind: 'timed', key: s.key, start, end: addMinutesLocal(start, lengthOf(o)), copy };
        }
      } else if (allDay !== null) {
        const date = parseDate(allDay);
        if (date !== null) {
          target = { kind: 'all-day', date, from: s.from };
          element = allDay;
          const days = occurrenceDays(o.start, o.end);
          const delta = o.allDay ? toJulianDayNumber(date) - toJulianDayNumber(s.from) : 0;
          const first = o.allDay ? addGregorianDays(days[0]!, delta) : date;
          const last = o.allDay ? addGregorianDays(days[days.length - 1]!, delta) : date;
          next = { kind: 'all-day', key: s.key, first, last, copy };
        }
      } else if (cell !== null) {
        const date = parseDate(cell);
        if (date !== null) {
          target = { kind: 'day', date, from: s.from };
          element = cell;
        }
      }
      s.target = target;
      s.copy = copy;
      if (element !== s.targetElement) {
        clearTarget(s);
        s.targetElement = element;
      }
      if (element !== null && cell !== null) element.setAttribute('data-drop-target', copy ? 'copy' : '');
      setPreview((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    };

    /** Scrolls a timeline while the pointer is near its top or bottom edge. */
    const autoScroll = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      const scroller = hit?.closest<HTMLElement>('[data-timeline]')?.firstElementChild;
      if (!(scroller instanceof HTMLElement)) return;
      const rect = scroller.getBoundingClientRect();
      if (y > rect.bottom - EDGE) scroller.scrollTop += 12;
      else if (y < rect.top + EDGE && scroller.scrollTop > 0) {
        // Above the hours sits the sticky header: scroll only once the pointer is over the hours' top edge.
        const body = scroller.querySelector<HTMLElement>('[data-timeline-day]');
        if (body !== null && y >= body.getBoundingClientRect().top + scroller.scrollTop - EDGE) scroller.scrollTop -= 12;
      }
    };

    const begin = (s: Session) => {
      s.started = true;
      s.element.setAttribute('data-drag-source', '');
      document.documentElement.dataset.calendarDragging = '';
      window.getSelection?.()?.removeAllRanges();
      try {
        s.element.setPointerCapture(s.pointerId);
      } catch {
        // The pointer may already be gone.
      }
    };

    function onMove(event: PointerEvent) {
      const s = session;
      if (s === null || event.pointerId !== s.pointerId) return;
      if (!s.started) {
        const slop = s.pointerType === 'touch' ? TOUCH_SLOP : MOUSE_SLOP;
        if (Math.hypot(event.clientX - s.x, event.clientY - s.y) <= slop) return;
        if (s.pointerType === 'touch') {
          // Moved before the long press: it is a scroll.
          finish();
          return;
        }
        begin(s);
      }
      event.preventDefault();
      const copy = s.copyOnly || event.altKey;
      locate(s, event.clientX, event.clientY, copy);
      autoScroll(event.clientX, event.clientY);
      const onTimeline = s.target?.kind === 'timed' || s.target?.kind === 'all-day';
      setImage(onTimeline ? null : { x: event.clientX, y: event.clientY, title: s.occurrence.title, color: colorOf(s.element), copy });
    }

    function onUp(event: PointerEvent) {
      const s = session;
      if (s === null || event.pointerId !== s.pointerId) return;
      if (!s.started) {
        finish();
        return;
      }
      locate(s, event.clientX, event.clientY, s.copyOnly || event.altKey);
      const target = s.target;
      const anchor = s.targetElement;
      const copy = s.copy;
      finish();
      swallowNextClick();
      if (target === null || (s.copyOnly && !copy)) return;
      moverRef.current.move({ key: s.key, target, copy, anchor });
    }

    function onCancel(event: PointerEvent) {
      if (session !== null && event.pointerId === session.pointerId) finish();
    }

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || session === null) return;
      event.preventDefault();
      event.stopPropagation();
      const started = session.started;
      finish();
      if (started) swallowNextClick();
    }

    function onTouchMove(event: TouchEvent) {
      // After the long press the finger drags the event, not the page.
      if (session?.started) event.preventDefault();
    }

    const start = (key: string, kind: SourceKind, from: GregorianDate | null, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || event.isPrimary === false || session !== null) return;
      if (event.target instanceof Element && event.target.closest('[data-resize-handle]')) return;
      const resolved = storeRef.current.resolveOccurrence(key);
      if (resolved === null) return;
      const occurrence = resolved.occurrence;
      const readOnly = occurrence.readOnly !== null;
      if (readOnly && !event.altKey) return;
      const element = event.currentTarget;
      let day = from ?? occurrence.start.date;
      if (kind === 'bar') {
        // A timeline bar is one element over several columns: the day picked up is the column under
        // the pointer, so a bar grabbed near its end moves by the days the pointer moves.
        const grabbed = parseDate(allDayCellAt(element, event.clientX));
        if (grabbed !== null) day = grabbed;
      }
      let offset = 0;
      if (kind === 'block') {
        const column = element.closest<HTMLElement>('[data-timeline-day]');
        if (column !== null) offset = diffMinutesLocal(columnTime(day, minuteAt(column, event.clientY)), occurrence.start);
      }
      const s: Session = {
        key,
        kind,
        from: day,
        occurrence,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        element,
        x: event.clientX,
        y: event.clientY,
        offset,
        copyOnly: readOnly,
        started: false,
        timer: null,
        target: null,
        targetElement: null,
        copy: false,
      };
      session = s;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey, true);
      if (event.pointerType === 'touch') {
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        s.timer = window.setTimeout(() => {
          s.timer = null;
          if (session !== s) return;
          begin(s);
          locate(s, s.x, s.y, s.copyOnly);
          navigator.vibrate?.(10);
        }, LONG_PRESS_MS);
      }
    };

    return { start, finish };
  }, []);

  useEffect(() => engine.finish, [engine]);

  const itemProps = useCallback(
    (key: string, date: GregorianDate): HTMLAttributes<HTMLElement> => ({
      onPointerDown: (event) => {
        const kind: SourceKind = event.currentTarget.closest('[data-timeline-day]')
          ? 'block'
          : event.currentTarget.hasAttribute('data-allday-item')
            ? 'bar'
            : 'chip';
        engine.start(key, kind, date, event);
      },
    }),
    [engine],
  );

  const rowProps = useCallback(
    (key: string): HTMLAttributes<HTMLButtonElement> => ({
      onPointerDown: (event) => engine.start(key, 'row', null, event),
    }),
    [engine],
  );

  const resize = useCallback((key: string, end: LocalDateTime, anchor: HTMLElement | null) => {
    moverRef.current.move({ key, target: { kind: 'end', end }, copy: false, anchor });
  }, []);

  const overlay = createElement(
    Fragment,
    null,
    mover.element,
    image !== null && typeof document !== 'undefined'
      ? createPortal(
          createElement(
            'div',
            {
              className: styles.dragImage,
              'data-copy': image.copy ? '' : undefined,
              style: { left: image.x + 12, top: image.y + 10, ['--cal' as string]: image.color },
              'aria-hidden': true,
            },
            createElement('span', { className: styles.dragDot }),
            createElement('span', { 'data-user-text': '' }, image.title),
          ),
          document.body,
        )
      : null,
  );

  return { itemProps, rowProps, preview, resize, overlay };
}

/** The all-day row's day under the pointer: its cells lie under the bars, so they are found by `x`. */
function allDayCellAt(hit: Element | null, x: number): HTMLElement | null {
  const direct = hit?.closest<HTMLElement>('[data-timeline-allday]') ?? null;
  if (direct !== null) return direct;
  const row = hit?.closest<HTMLElement>('[data-allday-row]') ?? null;
  if (row === null) return null;
  for (const cell of row.querySelectorAll<HTMLElement>('[data-timeline-allday]')) {
    const rect = cell.getBoundingClientRect();
    if (x >= rect.left && x < rect.right) return cell;
  }
  return null;
}

/** The calendar colour a chip, row or block carries in `--cal`. */
function colorOf(element: HTMLElement): string {
  return element.style.getPropertyValue('--cal') || 'var(--t-accent)';
}
