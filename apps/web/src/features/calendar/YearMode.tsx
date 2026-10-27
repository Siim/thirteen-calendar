import {
  type GregorianDate,
  addGregorianDays,
  formatThirteen,
  gregorianWeekday,
  toISODate,
  toThirteen,
  weekdayName,
  yearEventMarks,
} from '@thirteen/core';
import {
  type DayMarks,
  Switch,
  ThirteenYearGrid,
  cx,
  useCalendars,
  useCalendarSystem,
  useOccurrences,
  useToday,
  useYearLayout,
  useYearStats,
} from '@thirteen/ui';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { formatRoute, navigate } from '../../app/router.ts';
import { usePersistentFlag } from '../../lib/usePersistentFlag.ts';
import { useYearDots } from '../../lib/preferences.ts';
import { parseDayParam } from '../../lib/years.ts';
import { DayDetailPanel } from '../year/DayDetailPanel.tsx';
import { TwelveMonthView } from '../year/TwelveMonthView.tsx';
import { type YearColumn, findDayElement, revealElement, useRevealSelection } from '../year/useRevealSelection.ts';
import { YearLegend } from '../year/YearLegend.tsx';
import styles from '../year/YearPage.module.css';

export interface YearModeProps {
  /** Gregorian year. */
  readonly year: number;
  /** `?day=` of the route: the day whose sheet is open. */
  readonly day: string | null;
}

/** Escape in a field that edits text belongs to the field, not to the page. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(target.type);
}

/** True when `element` got focus from the keyboard (not a click, which must not scroll the page mid-click). */
function isKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** Up to three calendar colours and the count per day of year (§2.3), from `yearEventMarks`. */
function useYearMarks(year: number): ReadonlyMap<number, DayMarks> | undefined {
  const [show] = useYearDots();
  const occurrences = useOccurrences(year);
  const calendars = useCalendars();
  return useMemo(() => {
    if (!show || occurrences === null) return undefined;
    const colors = new Map(calendars.map((calendar) => [calendar.id, calendar.color]));
    const map = new Map<number, DayMarks>();
    for (const mark of yearEventMarks(year, occurrences)) {
      map.set(mark.dayOfYear, { count: mark.count, colors: mark.calendarIds.map((id) => colors.get(id) ?? '#57534e') });
    }
    return map;
  }, [show, occurrences, calendars, year]);
}

/**
 * Year mode (docs/EVENTS.md §2.3): the existing Year screen (13 months with the
 * intercalary days in place, the Gregorian overlay, the 12-month view and the
 * day sheet), plus up to three event dots per day and month titles that open
 * Month mode. The Calendar toolbar above pages the years.
 */
export function YearMode({ year, day }: YearModeProps) {
  const today = useToday();
  const { systemId } = useCalendarSystem();
  const parsedDay = parseDayParam(day);
  const selected = parsedDay && parsedDay.year === year ? parsedDay : null;
  const layout = useYearLayout(year, systemId);
  const stats = useYearStats(year, systemId);
  const marks = useYearMarks(year);
  const [overlay, setOverlay] = usePersistentFlag('year.gregorianOverlay', false);
  const [twelve, setTwelve] = usePersistentFlag('year.twelveMonthView', false);
  const [announcement, setAnnouncement] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // The grid the selection was made in: with the 12-month view on, the same day is in both columns, and
  // scrolling and focus should follow the cell the user actually used. Deep links start in the 13 months.
  const selectedFrom = useRef<YearColumn>('thirteen');
  useRevealSelection(selected ? toISODate(selected) : null, selectedFrom, panelRef, toolbarRef);

  /** Selects a day; `from` is the grid it was picked in (panel steps keep the previous one). */
  const select = (date: GregorianDate | null, from: YearColumn = selectedFrom.current) => {
    selectedFrom.current = from;
    navigate({ name: 'year', year, day: date ? toISODate(date) : null }, { replace: true });
    if (date) setAnnouncement(`Selected ${formatThirteen(toThirteen(date, systemId), { includeWeekday: true })}`);
  };

  /** Closes the panel; if focus was inside it, hands focus back to the day in the grid. */
  const closePanel = () => {
    const iso = selected ? toISODate(selected) : null;
    const focusWasInPanel = panelRef.current?.contains(document.activeElement) ?? false;
    navigate({ name: 'year', year, day: null }, { replace: true });
    if (iso && focusWasInPanel) {
      window.requestAnimationFrame(() => findDayElement(iso, selectedFrom.current)?.focus());
    }
  };

  // Escape closes the detail panel, unless something else (a field, a popover) already handled it.
  const onEscape = useEffectEvent(closePanel);
  const panelOpen = selected !== null;
  useEffect(() => {
    if (!panelOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !isTextEntry(event.target)) onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  const jan1 = weekdayName(gregorianWeekday({ year, month: 1, day: 1 }));

  return (
    <>
      <div ref={toolbarRef} className={styles.toolbar} role="toolbar" aria-label="Year view options">
        <div className={styles.toggles}>
          <Switch
            checked={overlay}
            onChange={setOverlay}
            label="Gregorian overlay"
            description="Show each day's Gregorian date in small type"
          />
          <Switch
            checked={twelve}
            onChange={setTwelve}
            label="12-month view alongside"
            description="Show the Gregorian months with their 13-month dates"
          />
        </div>
        <p className={styles.facts}>
          {layout.daysInYear} days · 1 Jan is a {jan1} · {stats.thirteenFriday13ths.length} Friday-13ths (
          {stats.gregorianFriday13ths.length} Gregorian)
        </p>
      </div>

      {/* With the 12-month view alongside, the panel docks at the bottom at every width (see the CSS). */}
      <div className={cx(styles.layout, selected && styles.layoutWithPanel, selected && twelve && styles.layoutDocked)}>
        <div
          className={styles.columnsHost}
          data-year-grid
          onFocus={(event) => {
            // Arrow keys move focus with element.focus(), which only scrolls the day into the viewport. Also
            // keep it clear of the sticky toolbar and the bottom sheet.
            if (isKeyboardFocus(event.target)) revealElement(event.target, panelRef.current, toolbarRef.current, 'auto');
          }}
        >
          <div className={cx(styles.columns, twelve && styles.columnsTwo)}>
            <section className={styles.column} data-year-column="thirteen" aria-labelledby="thirteen-months">
              {twelve ? (
                <header className={styles.columnHead}>
                  <h2 id="thirteen-months" className={styles.columnTitle}>
                    Thirteen months
                  </h2>
                  <span className={styles.columnMeta}>13 × 28 + {layout.intercalary.length}</span>
                </header>
              ) : (
                <h2 id="thirteen-months" className="t-sr-only">
                  Thirteen months of {layout.displayYear}
                </h2>
              )}
              <ThirteenYearGrid
                layout={layout}
                today={today}
                selected={selected}
                onSelect={(gregorian) => select(gregorian, 'thirteen')}
                showGregorian={overlay}
                reveal
                marks={marks}
                monthHref={(month) => formatRoute({ name: 'month', year, month, day: null })}
                legend={twelve ? undefined : <YearLegend layout={layout} stats={stats} />}
              />
            </section>
            {twelve ? (
              <section className={styles.column} data-year-column="gregorian" aria-labelledby="twelve-months">
                <header className={styles.columnHead}>
                  <h2 id="twelve-months" className={cx(styles.columnTitle, styles.columnTitleFoil)}>
                    Twelve months
                  </h2>
                  <span className={styles.columnMeta}>28 to 31 days · {stats.gregorianMonthShapeCount} shapes</span>
                </header>
                <TwelveMonthView
                  year={year}
                  today={today}
                  selected={selected}
                  onSelect={(gregorian) => select(gregorian, 'gregorian')}
                />
              </section>
            ) : null}
          </div>
        </div>
        {selected ? (
          <DayDetailPanel
            panelRef={panelRef}
            date={selected}
            onClose={closePanel}
            onStep={(delta) => {
              let next: GregorianDate;
              try {
                next = addGregorianDays(selected, delta);
              } catch {
                return; // beyond 9999-12-31 or before 0001-01-01
              }
              if (next.year === year) select(next);
              else navigate({ name: 'year', year: next.year, day: toISODate(next) });
            }}
          />
        ) : null}
      </div>
      <p className="t-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
