/**
 * Day mode (docs/EVENTS.md §2.6; boards J1, C4): the 13-month week as a strip
 * of day buttons (on an intercalary day, the week before it plus that day), the
 * all-day row and the one-column timeline of Week with `maxSlots` = floor(column
 * width / 64 px). At regular width the selected event's details, or the day's
 * comparison, sit on the right. On
 * compact width a tap on empty time draws the one-hour "New event"
 * placeholder, and a tap on it opens the editor (§2.6, Android and web
 * compact); blocks move with a long press and drag.
 */
import { type GregorianDate, addGregorianDays, gregorianEquals, intercalaryDaysInYear, occurrenceDays, toISODate } from '@thirteen/core';
import {
  Button,
  ComparisonTable,
  DatePlate,
  EventDetails,
  IntercalaryDayToken,
  Timeline,
  WeekStrip,
  copy,
  stripDays,
  useCalendars,
  useCalendarSystem,
  useComparison,
  useEventStore,
  useEventStoreState,
  useNow,
  useOccurrences,
  useToday,
  useUse24Hour,
} from '@thirteen/ui';
import { useId, useMemo } from 'react';
import { viewTitle } from './calendarState.ts';
import { useEventActions } from './EventActions.tsx';
import type { ModeProps } from './modeProps.ts';
import styles from './TimelineMode.module.css';
import { useCalendarDrag } from './useCalendarDrag.ts';

/** The day's comparison (§2.6 "the day's comparison when nothing is selected"), as in Year's day sheet. */
function DayComparison({ date }: { readonly date: GregorianDate }) {
  const { systemId } = useCalendarSystem();
  const comparison = useComparison(date, systemId);
  const thirteen = comparison.thirteen;
  const intercalary =
    thirteen.kind === 'intercalary'
      ? (intercalaryDaysInYear(date.year, systemId).find((day) => day.id === thirteen.id) ?? null)
      : null;
  return (
    <aside className={styles.panel} aria-label={copy('calendar.menu.dayDetails')}>
      {intercalary !== null ? (
        <IntercalaryDayToken occurrence={intercalary} variant="plate" />
      ) : (
        <DatePlate date={thirteen} size="md" kicker={null} />
      )}
      <ComparisonTable comparison={comparison} variant="compact" />
    </aside>
  );
}

/**
 * The panel on the right at regular width (§2.6): the selected event's details (§2.10), or the day's
 * comparison when nothing on this day is selected.
 */
function DayPanel({ date, selectedKey }: { readonly date: GregorianDate; readonly selectedKey: string | null }) {
  const store = useEventStore();
  const { deviceZone, revision } = useEventStoreState();
  const calendars = useCalendars();
  const { systemId } = useCalendarSystem();
  const use24Hour = useUse24Hour();
  const actions = useEventActions();
  const headingId = useId();
  const resolved = useMemo(
    () => (selectedKey === null ? null : store.resolveOccurrence(selectedKey)),
    // The store's revision: the details follow a change made elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, selectedKey, revision],
  );
  const onThisDay =
    resolved !== null && occurrenceDays(resolved.occurrence.start, resolved.occurrence.end).some((day) => gregorianEquals(day, date));
  if (resolved === null || !onThisDay) return <DayComparison date={date} />;
  const key = resolved.occurrence.key;
  return (
    <aside className={styles.panel} aria-labelledby={headingId}>
      <EventDetails
        resolved={resolved}
        calendar={calendars.find((c) => c.id === resolved.occurrence.calendarId) ?? null}
        systemId={systemId}
        use24Hour={use24Hour}
        deviceZone={deviceZone}
        headingId={headingId}
        onEdit={() => actions.edit(key)}
        onDelete={(anchor) => actions.requestDelete(key, anchor)}
        onDuplicate={(anchor) => actions.duplicate(key, anchor)}
      />
    </aside>
  );
}

export function DayMode({ view, compact, largeText, selectedKey, onSelectKey, onSelectDate, allHidden, onShowCalendars }: ModeProps) {
  const { systemId } = useCalendarSystem();
  const use24Hour = useUse24Hour();
  const now = useNow();
  const today = useToday();
  const calendars = useCalendars();
  const actions = useEventActions();
  const drag = useCalendarDrag({ onMoved: onSelectKey });
  const occurrences = useOccurrences(view.date.year);
  const byId = useMemo(() => new Map(calendars.map((calendar) => [calendar.id, calendar])), [calendars]);
  const iso = toISODate(view.date);
  const days = useMemo(() => ({ kind: 'day' as const, date: view.date }), [iso]); // eslint-disable-line react-hooks/exhaustive-deps
  const strip = useMemo(() => stripDays(view.date, systemId), [iso, systemId]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = viewTitle(view, systemId).title;

  const main = (
    <div className={styles.dayMain}>
      <WeekStrip days={strip} selected={view.date} today={today} systemId={systemId} onSelect={onSelectDate} />
      {allHidden ? (
        <div className={styles.notice}>
          <p>{copy('calendar.allHidden')}</p>
          <Button size="sm" onClick={onShowCalendars}>
            {copy('calendar.allHidden.button')}
          </Button>
        </div>
      ) : null}
      <Timeline
        days={days}
        systemId={systemId}
        occurrences={occurrences}
        calendars={byId}
        today={today}
        now={now}
        use24Hour={use24Hour}
        label={title}
        showHeader={false}
        minBlockRem={4}
        largeText={largeText}
        placeholder={compact}
        selectedKey={selectedKey}
        onSelectItem={onSelectKey}
        onOpenItem={(key, anchor) => {
          onSelectKey(key);
          actions.openDetails(key, anchor);
        }}
        onCreate={(request) =>
          actions.newEvent(
            request.allDay
              ? { date: request.date, allDay: true, anchor: request.anchor }
              : { date: request.date, anchor: request.anchor, start: request.start, end: request.end },
          )
        }
        onResize={compact ? undefined : drag.resize}
        itemProps={drag.itemProps}
        rowProps={drag.rowProps}
        preview={drag.preview}
        onSwipe={compact ? (direction) => onSelectDate(addGregorianDays(view.date, direction)) : undefined}
        scrollKey={`day ${iso}`}
      />
    </div>
  );

  return (
    <div className={styles.mode}>
      {compact ? (
        main
      ) : (
        <div className={styles.dayRegular}>
          {main}
          <DayPanel date={view.date} selectedKey={selectedKey} />
        </div>
      )}
      {drag.overlay}
    </div>
  );
}
