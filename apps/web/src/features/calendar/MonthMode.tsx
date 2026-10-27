import { type AgendaDay, type GregorianDate, agenda, describeRecurrence, toISODate } from '@thirteen/core';
import {
  AgendaRows,
  Button,
  DayHeading,
  type MenuEntry,
  MenuList,
  type MonthDensity,
  MonthDayList,
  MonthEventGrid,
  type MonthTarget,
  Popover,
  type StoreOccurrence,
  copy,
  thirteenDayHeading,
  useCalendars,
  useCalendarSystem,
  useEventStore,
  useNow,
  useOccurrences,
  useToday,
  useUse24Hour,
} from '@thirteen/ui';
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { monthOf, viewTitle } from './calendarState.ts';
import { DayDetailsDialog } from './DayDetailsDialog.tsx';
import { useEventActions } from './EventActions.tsx';
import type { ModeProps } from './modeProps.ts';
import styles from './MonthMode.module.css';
import { useCalendarDrag } from './useCalendarDrag.ts';

/** The width a compact cell needs for the titles density (§2.4: 60 pt / dp / CSS px). */
const TITLES_MIN_CELL = 60;

/** Measures an element's width (0 until laid out, and in jsdom). */
function useWidth(): [number, (element: HTMLElement | null) => void] {
  const [width, setWidth] = useState(0);
  const [element, setElement] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [width, setElement];
}

function rootFontSize(): number {
  return Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
}

/** The repeat in 13-month words for the day list's second line (board A1: "Every IFC month on the 12th"). */
function useRepeatText(): (occurrence: StoreOccurrence) => string | null {
  const store = useEventStore();
  const { systemId } = useCalendarSystem();
  return useCallback(
    (occurrence: StoreOccurrence) => {
      if (!occurrence.recurring) return null;
      const event = store.getEvent(occurrence.eventId);
      if (event?.recurrence == null) return null;
      try {
        return describeRecurrence(event.recurrence, event.start.date, systemId);
      } catch {
        return null;
      }
    },
    [store, systemId],
  );
}

/** One day as an agenda day (all-day items first, then timed in start order). */
function dayAgenda(
  occurrences: readonly StoreOccurrence[],
  date: GregorianDate,
  systemId: Parameters<typeof agenda>[3],
): AgendaDay {
  return agenda(occurrences, date, date, systemId, { includeEmptyDays: true })[0]!;
}

/**
 * Month mode (docs/EVENTS.md §2.4): the 13-month month as a 4 x 7 grid. On
 * compact width, in the titles or dots density, with the selected day's list
 * under it; on regular width with lanes, "+N more" popovers and a context
 * menu; at accessibility text sizes as a list of the month's days.
 */
export function MonthMode({
  view,
  compact,
  largeText,
  selectedKey,
  onSelectKey,
  onSelectDate,
  onOpenView,
  allHidden,
  onShowCalendars,
}: ModeProps) {
  const today = useToday();
  const now = useNow();
  const { systemId } = useCalendarSystem();
  const use24Hour = useUse24Hour();
  const calendars = useCalendars();
  const actions = useEventActions();
  const drag = useCalendarDrag();
  const repeatText = useRepeatText();
  const { year, month } = monthOf(view.date, systemId);
  const occurrences = useOccurrences(year);
  const byId = useMemo(() => new Map(calendars.map((calendar) => [calendar.id, calendar])), [calendars]);
  const byKey = useMemo(() => new Map((occurrences ?? []).map((o) => [o.key, o])), [occurrences]);
  const title = viewTitle(view, systemId).title;
  const [width, measure] = useWidth();
  const [more, setMore] = useState<{ date: GregorianDate; anchor: HTMLElement } | null>(null);
  const [menu, setMenu] = useState<{ target: MonthTarget; point: { x: number; y: number } } | null>(null);
  const [details, setDetails] = useState<GregorianDate | null>(null);
  const menuReturn = useRef<HTMLElement | null>(null);

  const density: MonthDensity = !compact ? 'full' : width / 7 >= TITLES_MIN_CELL && rootFontSize() <= 16 ? 'titles' : 'dots';

  const openDay = (date: GregorianDate) => onOpenView({ mode: 'day', date });

  const emptyDay = (date: GregorianDate): ReactNode =>
    allHidden ? (
      <div className={styles.empty}>
        <p>{copy('calendar.allHidden')}</p>
        <Button size="sm" onClick={onShowCalendars}>
          {copy('calendar.allHidden.button')}
        </Button>
      </div>
    ) : (
      <div className={styles.empty}>
        <p>{copy('calendar.day.empty')}</p>
        <Button
          size="sm"
          variant="ghost"
          className={styles.textButton}
          onClick={(event) => actions.newEvent({ date, anchor: event.currentTarget })}
        >
          {copy('calendar.newEvent')}
        </Button>
      </div>
    );

  if (largeText) {
    return (
      <div className={styles.mode}>
        {allHidden ? emptyDay(view.date) : null}
        <MonthDayList
          year={year}
          month={month}
          systemId={systemId}
          occurrences={occurrences}
          calendars={byId}
          today={today}
          selected={view.date}
          use24Hour={use24Hour}
          label={title}
          onOpenDay={openDay}
          onOpenItem={(key, anchor) => actions.openDetails(key, anchor)}
        />
      </div>
    );
  }

  const selectedDay = occurrences === null ? null : dayAgenda(occurrences, view.date, systemId);

  const menuItems = (target: MonthTarget): MenuEntry[] => {
    const entries: MenuEntry[] = [
      {
        id: 'new',
        label: copy('calendar.newEvent'),
        onSelect: () => actions.newEvent({ date: target.date, anchor: menuReturn.current }),
      },
      { id: 'open', label: copy('calendar.menu.openDay'), onSelect: () => openDay(target.date) },
      { id: 'details', label: copy('calendar.menu.dayDetails'), onSelect: () => setDetails(target.date) },
    ];
    if (target.key !== null) {
      const key = target.key;
      const occurrence = byKey.get(key);
      entries.push({ kind: 'separator', id: 'sep' });
      entries.push({
        id: 'duplicate',
        label: copy('calendar.menu.duplicate'),
        onSelect: () => actions.duplicate(key, menuReturn.current),
      });
      if (occurrence !== undefined && (occurrence.readOnly === null || occurrence.readOnly === 'historical')) {
        entries.push({
          id: 'delete',
          label: copy('calendar.menu.delete'),
          destructive: true,
          onSelect: () => actions.requestDelete(key, menuReturn.current),
        });
      }
    }
    return entries;
  };

  const moreDay = more !== null && occurrences !== null ? dayAgenda(occurrences, more.date, systemId) : null;

  return (
    <div className={styles.mode} ref={measure}>
      {!compact && allHidden ? emptyDay(view.date) : null}
      <MonthEventGrid
        year={year}
        month={month}
        systemId={systemId}
        occurrences={occurrences}
        calendars={byId}
        today={today}
        selected={view.date}
        selectedKey={selectedKey}
        density={density}
        use24Hour={use24Hour}
        label={title}
        onSelectDay={onSelectDate}
        onActivateSelectedDay={compact ? openDay : undefined}
        onCreate={compact ? undefined : (date, anchor) => actions.newEvent({ date, anchor })}
        onSelectItem={onSelectKey}
        onOpenItem={(key, anchor) => actions.openDetails(key, anchor)}
        onShowMore={(date, anchor) => setMore({ date, anchor })}
        onContextMenu={
          compact
            ? undefined
            : (target, point, anchor) => {
                menuReturn.current = anchor;
                if (target.key !== null) onSelectKey(target.key);
                setMenu({ target, point });
              }
        }
        cellProps={drag.cellProps}
        itemProps={drag.itemProps}
      />

      {compact ? (
        <section
          className={styles.dayList}
          aria-label={selectedDay === null ? undefined : thirteenDayHeading(selectedDay.thirteen)}
        >
          {selectedDay !== null ? (
            <DayHeading
              day={selectedDay}
              as="h2"
              actions={
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon="plus"
                    className={styles.iconButton}
                    onClick={(event) => actions.newEvent({ date: view.date, anchor: event.currentTarget })}
                  >
                    {copy('calendar.newEvent')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon="chevron-right"
                    className={styles.iconButton}
                    onClick={() => openDay(view.date)}
                  >
                    {copy('calendar.menu.openDay')}
                  </Button>
                </>
              }
            />
          ) : null}
          {selectedDay === null ? null : selectedDay.items.length === 0 ? (
            emptyDay(view.date)
          ) : (
            <AgendaRows
              day={selectedDay}
              occurrences={byKey}
              calendars={byId}
              use24Hour={use24Hour}
              now={now}
              selectedKey={selectedKey}
              extraFor={repeatText}
              rowProps={drag.rowProps}
              onOpen={(key, anchor) => {
                onSelectKey(key);
                actions.openDetails(key, anchor);
              }}
            />
          )}
        </section>
      ) : null}

      <Popover
        open={more !== null && moreDay !== null}
        onClose={() => setMore(null)}
        anchor={more?.anchor ?? null}
        placement="right-start"
        arrow
        aria-label={moreDay === null ? undefined : thirteenDayHeading(moreDay.thirteen)}
        className={styles.morePopover}
        width={340}
      >
        {moreDay !== null ? (
          <div className={styles.moreBody} data-date={toISODate(moreDay.gregorian)} data-event-list="">
            <DayHeading day={moreDay} as="h2" />
            <AgendaRows
              day={moreDay}
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
          </div>
        ) : null}
      </Popover>

      <MenuList
        open={menu !== null}
        onClose={() => setMenu(null)}
        anchor={menu?.point ?? null}
        items={menu === null ? [] : menuItems(menu.target)}
        label={menu === null ? undefined : thirteenDayHeading(dayAgenda([], menu.target.date, systemId).thirteen)}
        returnFocus={menuReturn}
      />

      <DayDetailsDialog date={details} onClose={() => setDetails(null)} />
      {drag.overlay}
    </div>
  );
}
