import { type AgendaDay, type GregorianDate, agenda, toISODate } from '@thirteen/core';
import {
  AgendaList,
  Button,
  copy,
  useCalendars,
  useCalendarSystem,
  useNow,
  useOccurrencesInYears,
  useUse24Hour,
} from '@thirteen/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEventActions } from './EventActions.tsx';
import styles from './ListMode.module.css';
import type { ModeProps } from './modeProps.ts';
import { useCalendarDrag } from './useCalendarDrag.ts';

const MAX_YEAR = 9999;

/**
 * How far List loads on its own past its last listed day: once this many Gregorian years after it (or
 * after the selected day's year, when nothing is listed) hold no event, the list ends there and an empty
 * list says "No upcoming events.". Without it, an empty future kept the end of the list in view and
 * loaded every year up to 9999, one expansion per calendar each.
 */
export const LIST_EMPTY_YEARS_AHEAD = 10;

/** Gregorian years from `from` to `to`, inclusive. */
function yearsBetween(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/**
 * List mode (docs/EVENTS.md §2.7): every event from the selected day onward,
 * grouped by 13-month month and day. It loads one Gregorian year at a time
 * (13 months) as the reader nears the end, and the days before the selected
 * one when the reader scrolls up at its top. Years are merged and deduplicated
 * by key (§3.2), so an event that crosses January 1 is listed once per day.
 * While a year loads, the days already listed stay on screen. Loading on its
 * own stops {@link LIST_EMPTY_YEARS_AHEAD} empty years after the last listed
 * day, and at once while every calendar is hidden.
 */
export function ListMode({ view, selectedKey, onSelectKey, allHidden, onShowCalendars }: ModeProps) {
  const { systemId } = useCalendarSystem();
  const use24Hour = useUse24Hour();
  const now = useNow();
  const calendars = useCalendars();
  const actions = useEventActions();
  const drag = useCalendarDrag();
  const anchorIso = toISODate(view.date);

  // The loaded range: from `first` (the selected day, or earlier once the reader scrolls up) to the end of `lastYear`.
  const [range, setRange] = useState(() => ({ anchor: anchorIso, first: view.date, lastYear: view.date.year }));
  const current = range.anchor === anchorIso ? range : { anchor: anchorIso, first: view.date, lastYear: view.date.year };
  if (current !== range) setRange(current);

  const years = useMemo(() => yearsBetween(current.first.year, current.lastYear), [current.first.year, current.lastYear]);
  const occurrences = useOccurrencesInYears(years);
  const byId = useMemo(() => new Map(calendars.map((calendar) => [calendar.id, calendar])), [calendars]);
  const byKey = useMemo(() => new Map((occurrences ?? []).map((o) => [o.key, o])), [occurrences]);
  const days = useMemo(
    () =>
      occurrences === null ? null : agenda(occurrences, current.first, { year: current.lastYear, month: 12, day: 31 }, systemId),
    [occurrences, current.first, current.lastYear, systemId],
  );

  // While a year loads (`days` is null until every year is ready; the IndexedDB store expands it in its
  // worker), keep the days already listed, so the list neither disappears nor loses its scroll position.
  const shown = useRef<{ readonly anchor: string; readonly days: readonly AgendaDay[] } | null>(null);
  if (days !== null) shown.current = { anchor: anchorIso, days };
  const listed = days ?? (shown.current?.anchor === anchorIso ? shown.current.days : null);

  // Load later years only while they may still hold events: not with every calendar hidden, and not
  // more than LIST_EMPTY_YEARS_AHEAD empty years past the last listed day.
  const lastListedYear =
    days === null ? null : Math.max(view.date.year - 1, days.length > 0 ? days[days.length - 1]!.gregorian.year : 0);
  const loadsLater =
    lastListedYear !== null &&
    !allHidden &&
    current.lastYear < MAX_YEAR &&
    current.lastYear - lastListedYear < LIST_EMPTY_YEARS_AHEAD;
  const canObserve = typeof IntersectionObserver !== 'undefined';

  // ---- later: the next year when the end of the list comes into view ----
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = end.current;
    if (element === null || !canObserve || occurrences === null || !loadsLater) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRange((previous) =>
            previous.anchor === anchorIso && previous.lastYear < MAX_YEAR
              ? { ...previous, lastYear: previous.lastYear + 1 }
              : previous,
          );
        }
      },
      { rootMargin: '0px 0px 600px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [occurrences, anchorIso, loadsLater, canObserve]);

  // ---- earlier: when the reader scrolls up while the top of the list is in view ----
  const top = useRef<HTMLDivElement>(null);
  const keep = useRef<{ iso: string; top: number } | null>(null);
  useEffect(() => {
    const atTop = () => (top.current?.getBoundingClientRect().top ?? -1) >= 0;
    const earlier = () => {
      if (!atTop()) return;
      setRange((previous) => {
        if (previous.anchor !== anchorIso) return previous;
        const first = previous.first;
        const next: GregorianDate =
          first.month === 1 && first.day === 1
            ? { year: first.year - 1, month: 1, day: 1 }
            : { year: first.year, month: 1, day: 1 };
        if (next.year < 1) return previous;
        // Keep the first day on screen where it is while earlier days are added above it.
        const element = document.querySelector<HTMLElement>(`[data-list-mode] [data-date="${toISODate(first)}"]`);
        keep.current = element ? { iso: toISODate(first), top: element.getBoundingClientRect().top } : null;
        return { ...previous, first: next };
      });
    };
    let touchY: number | null = null;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) earlier();
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'PageUp' || event.key === 'ArrowUp' || event.key === 'Home') && window.scrollY <= 0) earlier();
    };
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? null;
      if (touchY !== null && y !== null && y - touchY > 24) {
        touchY = null;
        earlier();
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [anchorIso]);
  useLayoutEffect(() => {
    const kept = keep.current;
    if (kept === null || days === null) return;
    const element = document.querySelector<HTMLElement>(`[data-list-mode] [data-date="${kept.iso}"]`);
    if (element === null) return;
    keep.current = null;
    const delta = element.getBoundingClientRect().top - kept.top;
    if (delta !== 0) window.scrollBy({ top: delta, behavior: 'auto' });
  }, [days]);

  // "No upcoming events." once the years it loads on its own are all empty (at once with every calendar hidden).
  const empty = days !== null && days.length === 0 && (allHidden || !loadsLater || !canObserve);
  const busy = days === null || (days.length === 0 && !empty);
  return (
    <div className={styles.mode} data-list-mode aria-busy={busy ? true : undefined}>
      <div ref={top} />
      {empty ? (
        <div className={styles.empty}>
          {allHidden ? (
            <>
              <p>{copy('calendar.allHidden')}</p>
              <Button size="sm" onClick={onShowCalendars}>
                {copy('calendar.allHidden.button')}
              </Button>
            </>
          ) : (
            <>
              <p>{copy('calendar.list.empty')}</p>
              <Button size="sm" onClick={(event) => actions.newEvent({ date: view.date, anchor: event.currentTarget })}>
                {copy('calendar.newEvent')}
              </Button>
            </>
          )}
        </div>
      ) : null}
      {listed !== null && listed.length > 0 ? (
        <AgendaList
          days={listed}
          systemId={systemId}
          anchorDay={view.date}
          occurrences={byKey}
          calendars={byId}
          use24Hour={use24Hour}
          now={now}
          selectedKey={selectedKey}
          rowProps={drag.rowProps}
          onOpen={(key, anchor) => {
            onSelectKey(key);
            actions.openDetails(key, anchor);
          }}
        />
      ) : null}
      <div ref={end} className={styles.end} />
    </div>
  );
}
