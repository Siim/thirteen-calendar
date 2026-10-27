/**
 * Week mode (docs/EVENTS.md §2.5, regular width only; boards F1, F2, K2): one
 * 13-month week as 7 columns, plus the intercalary days after week 4 as their
 * own 60% hatched columns, with an all-day row and a 24-hour timeline. Blocks
 * come from core's `layoutThirteenWeekEvents` with `maxSlots` = floor(column
 * width / 48 px); a crowded cluster shows "+{n}". Click and drag on empty time
 * makes a draft, blocks move by dragging (15-minute snap, across columns, into
 * the all-day row) and change their end by their bottom edge; Alt-drag copies.
 * At accessibility text sizes Week falls back to Day (§2.20 Text size).
 */
import type { GregorianDate } from '@thirteen/core';
import {
  Button,
  Timeline,
  copy,
  useCalendars,
  useCalendarSystem,
  useNow,
  useOccurrences,
  useToday,
  useUse24Hour,
} from '@thirteen/ui';
import { useMemo } from 'react';
import { viewTitle, weekOf } from './calendarState.ts';
import { DayMode } from './DayMode.tsx';
import { useEventActions } from './EventActions.tsx';
import type { ModeProps } from './modeProps.ts';
import styles from './TimelineMode.module.css';
import { useCalendarDrag } from './useCalendarDrag.ts';

export function WeekMode(props: ModeProps) {
  // §2.20: "Week falls back to Day at accessibility sizes".
  if (props.largeText) return <DayMode {...props} view={{ mode: 'day', date: props.view.date }} />;
  return <WeekTimeline {...props} />;
}

function WeekTimeline({ view, selectedKey, onSelectKey, onOpenView, allHidden, onShowCalendars }: ModeProps) {
  const { systemId } = useCalendarSystem();
  const use24Hour = useUse24Hour();
  const now = useNow();
  const today = useToday();
  const calendars = useCalendars();
  const actions = useEventActions();
  const drag = useCalendarDrag({ onMoved: onSelectKey });
  const { year, month, week } = weekOf(view.date, systemId);
  const occurrences = useOccurrences(year);
  const byId = useMemo(() => new Map(calendars.map((calendar) => [calendar.id, calendar])), [calendars]);
  const days = useMemo(() => ({ kind: 'week' as const, year, month, week }), [year, month, week]);
  const title = viewTitle(view, systemId).title;

  return (
    <div className={styles.mode}>
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
        minBlockRem={3}
        selectedKey={selectedKey}
        onSelectItem={onSelectKey}
        onOpenItem={(key, anchor) => {
          onSelectKey(key);
          actions.openDetails(key, anchor);
        }}
        onOpenDay={(date: GregorianDate) => onOpenView({ mode: 'day', date })}
        onCreate={(request) =>
          actions.newEvent(
            request.allDay
              ? { date: request.date, allDay: true, anchor: request.anchor }
              : { date: request.date, anchor: request.anchor, start: request.start, end: request.end },
          )
        }
        onResize={drag.resize}
        itemProps={drag.itemProps}
        rowProps={drag.rowProps}
        preview={drag.preview}
        scrollKey={`week ${year}-${month}-${week}`}
      />
      {drag.overlay}
    </div>
  );
}
