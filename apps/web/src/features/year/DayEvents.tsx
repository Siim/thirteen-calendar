/**
 * The Events section at the top of the Year day sheet (docs/EVENTS.md §2.9):
 * the day's items as Up next draws them (`AgendaRow`, the Now plate),
 * "New event" and "Open in Calendar" (Day mode). On a day without events:
 * "No events." and "New event"; with every calendar hidden, "All calendars
 * are hidden." and "Show calendars" (§2.4 States). The rest of the sheet is
 * unchanged.
 */
import { type GregorianDate, agenda, toISODate } from '@thirteen/core';
import {
  AgendaRows,
  Button,
  Icon,
  copy,
  useCalendars,
  useCalendarSystem,
  useNow,
  useOccurrences,
  useUse24Hour,
} from '@thirteen/ui';
import { useMemo } from 'react';
import { Link } from '../../app/Link.tsx';
import { useEventActions } from '../calendar/EventActions.tsx';
import { useShowCalendars } from '../today/ShowCalendars.tsx';
import styles from './DayEvents.module.css';

export interface DayEventsProps {
  readonly date: GregorianDate;
}

export function DayEvents({ date }: DayEventsProps) {
  const { systemId } = useCalendarSystem();
  const occurrences = useOccurrences(date.year);
  const calendars = useCalendars();
  const use24Hour = useUse24Hour();
  const now = useNow();
  const actions = useEventActions();
  const showCalendars = useShowCalendars();
  const iso = toISODate(date);

  const day = useMemo(() => {
    if (occurrences === null) return null;
    return agenda(occurrences, date, date, systemId)[0] ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrences, iso, systemId]);
  const byKey = useMemo(() => new Map((occurrences ?? []).map((o) => [o.key, o] as const)), [occurrences]);
  const byId = useMemo(() => new Map(calendars.map((c) => [c.id, c] as const)), [calendars]);

  if (occurrences === null) return null;
  const allHidden = calendars.length > 0 && calendars.every((calendar) => !calendar.visible);

  return (
    <div className={styles.events} data-day-events={iso}>
      {day !== null ? (
        <AgendaRows
          day={day}
          occurrences={byKey}
          calendars={byId}
          use24Hour={use24Hour}
          now={now}
          onOpen={(key, anchor) => actions.openDetails(key, anchor)}
          className={styles.rows}
        />
      ) : allHidden ? (
        <div className={styles.empty}>
          <p>{copy('calendar.allHidden')}</p>
          <button type="button" className={styles.textButton} onClick={showCalendars.open}>
            {copy('calendar.allHidden.button')}
          </button>
        </div>
      ) : (
        <p className={styles.empty}>{copy('calendar.day.empty')}</p>
      )}
      <div className={styles.actions}>
        <Button size="sm" icon="plus" onClick={(event) => actions.newEvent({ date, anchor: event.currentTarget })}>
          {copy('calendar.newEvent')}
        </Button>
        {day !== null ? (
          <Link className={styles.open} to={{ name: 'day', date: iso }}>
            {copy('event.openInCalendar')} <Icon name="arrow-right" size={15} />
          </Link>
        ) : null}
      </div>
      {showCalendars.sheet}
    </div>
  );
}
