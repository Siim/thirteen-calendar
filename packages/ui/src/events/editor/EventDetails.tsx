import {
  type CalendarSystemId,
  type GregorianDate,
  type ReadOnlyReason,
  formatGregorian,
  formatThirteen,
  gregorianEquals,
  toThirteen,
} from '@thirteen/core';
import { Fragment, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { Icon } from '../../primitives/Icon.tsx';
import { Menu } from '../../primitives/Menu.tsx';
import { copy } from '../copy.ts';
import { formatTime, formatTimeRange, lastDay } from '../format.ts';
import type { ResolvedOccurrence, StoreCalendar } from '../store.ts';
import { alertText } from './alerts.ts';
import { zoneCity } from './editorModel.ts';
import styles from './EventDetails.module.css';
import { repeatDescription } from './repeat.ts';

/** The details' actions (§2.10); a missing one is not offered. */
export interface EventDetailsActions {
  readonly onEdit?: () => void;
  readonly onEditAlerts?: () => void;
  readonly onDelete?: (anchor: HTMLElement | null) => void;
  readonly onDuplicate?: (anchor: HTMLElement | null) => void;
}

export interface EventDetailsProps extends EventDetailsActions {
  readonly resolved: ResolvedOccurrence;
  readonly calendar: StoreCalendar | null;
  readonly systemId: CalendarSystemId;
  readonly use24Hour: boolean;
  /** The device's zone: a second time line names the event's own zone when it differs (§2.10 item 3). */
  readonly deviceZone: string;
  /** The heading's id, for the popover's or sheet's name. */
  readonly headingId?: string;
  /** The title is drawn by the surrounding sheet (it is its heading). */
  readonly hideTitle?: boolean;
  readonly className?: string;
}

/** The reason line of a read-only event on the web (§2.19 `event.readOnly.*`; historical: `.local`). */
export function readOnlyReasonText(reason: ReadOnlyReason): string {
  switch (reason) {
    case 'subscribed':
      return copy('event.readOnly.subscribed');
    case 'birthday':
      return copy('event.readOnly.birthday');
    case 'invitation':
      return copy('event.readOnly.invitation.android');
    case 'calendar':
      return copy('event.readOnly.calendar');
    case 'no-write-permission':
      return copy('event.readOnly.noWrite');
    case 'historical':
      return copy('event.readOnly.historical.local');
  }
}

/** Which actions an event offers on the web (§2.10 item 9, §3.5). */
export function detailsOffers(resolved: ResolvedOccurrence): { edit: boolean; editAlerts: boolean; delete: boolean; duplicate: boolean } {
  const reason = resolved.occurrence.readOnly ?? resolved.event.readOnly;
  if (reason === null) return { edit: true, editAlerts: false, delete: true, duplicate: true };
  if (reason === 'historical') return { edit: false, editAlerts: true, delete: true, duplicate: true };
  return { edit: false, editAlerts: reason === 'invitation' && resolved.event.alarmsEditable, delete: false, duplicate: true };
}

const URL_PATTERN = /\b(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/g;

/** Notes with web links made clickable (§2.10 item 7: "links detected"); the text itself is never changed. */
function linkedText(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(
      <a key={index} href={match[0]} target="_blank" rel="noopener noreferrer">
        {match[0]}
      </a>,
    );
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** A web map search for a location (§2.10: "Google Maps web search"). */
export function mapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

const longThirteen = (date: GregorianDate, systemId: CalendarSystemId) => formatThirteen(toThirteen(date, systemId), { style: 'long', includeWeekday: true });
const longGregorian = (date: GregorianDate) => formatGregorian(date, { style: 'long', includeWeekday: true });

/**
 * An event's details (docs/EVENTS.md §2.10, board A2): title with the
 * calendar's colour bar and its Tentative or Canceled tag, the date plate in
 * both calendars, time (and the event's own zone when it is not the
 * device's), repeat in 13-month words, calendar, alerts, Show as, location,
 * URL and notes, the read-only reason, and the actions: Edit, Duplicate (in
 * the ••• menu) and Delete event; Edit alerts and Delete event for historical
 * events; Duplicate for every other read-only event.
 */
export function EventDetails({
  resolved,
  calendar,
  systemId,
  use24Hour,
  deviceZone,
  headingId,
  hideTitle = false,
  className,
  onEdit,
  onEditAlerts,
  onDelete,
  onDuplicate,
}: EventDetailsProps) {
  const { occurrence, event, draft } = resolved;
  const offers = detailsOffers(resolved);
  const reason = occurrence.readOnly ?? event.readOnly;
  const first = occurrence.start.date;
  const last = lastDay(occurrence);
  const multiDay = !gregorianEquals(first, last);
  const zone = draft.timeZone;
  const zoneLine =
    !occurrence.allDay && zone !== null && zone !== deviceZone
      ? copy('event.zoneLine', {
          city: zoneCity(zone),
          start: formatTime(draft.start.minute, use24Hour),
          end: formatTime(draft.end.minute, use24Hour),
        })
      : null;
  const time = occurrence.allDay ? copy('event.allDay') : formatTimeRange(occurrence.start.minute, occurrence.end.minute, use24Hour);
  const rows: { readonly label: string; readonly value: ReactNode; readonly user?: boolean }[] = [];
  rows.push({
    label: 'Time',
    value: (
      <>
        <span>{time}</span>
        {zoneLine !== null ? <span className={styles.second}>{zoneLine}</span> : null}
      </>
    ),
  });
  if (event.recurrence !== null) rows.push({ label: copy('event.repeat'), value: repeatDescription(event.recurrence, event.start.date, systemId) });
  if (calendar !== null) {
    rows.push({
      label: copy('event.calendar'),
      value: (
        <span className={styles.calendar} data-user-text>
          <span className={styles.swatch} style={{ background: calendar.color }} aria-hidden="true" />
          {`${calendar.title}, ${calendar.accountTitle}`}
        </span>
      ),
    });
  }
  if (occurrence.alarms.length > 0) {
    rows.push({
      label: copy('event.alerts'),
      value: occurrence.alarms.map((alarm, index) => (
        <span key={index} className={styles.line}>
          {alertText(alarm, occurrence.allDay, systemId, use24Hour)}
        </span>
      )),
    });
  }
  if (draft.availability === 'free') rows.push({ label: copy('event.showAs'), value: copy('editor.free') });
  if (draft.location !== '') {
    rows.push({
      label: copy('event.location'),
      value: (
        <a href={mapsUrl(draft.location)} target="_blank" rel="noopener noreferrer" className={styles.link} data-user-text>
          {draft.location}
        </a>
      ),
    });
  }
  if (draft.url !== '') {
    rows.push({
      label: copy('event.url'),
      value: (
        <a href={draft.url} target="_blank" rel="noopener noreferrer" className={styles.link} data-user-text>
          {draft.url}
        </a>
      ),
    });
  }
  if (draft.notes !== '') {
    rows.push({ label: copy('event.notes'), value: <span className={styles.notes} data-user-text>{linkedText(draft.notes)}</span> });
  }

  const tag = occurrence.status === 'tentative' ? copy('event.tentative') : occurrence.status === 'canceled' ? copy('event.canceled') : null;
  const moreItems = offers.duplicate && onDuplicate !== undefined ? [{ id: 'duplicate', label: copy('calendar.menu.duplicate'), onSelect: () => onDuplicate(null) }] : [];

  return (
    <div className={cx(styles.details, className)} style={{ ['--event-color' as string]: calendar?.color ?? 'var(--t-ink-3)' }}>
      <h2 id={headingId} className={cx(styles.title, hideTitle && 't-sr-only')}>
        <span className={styles.bar} aria-hidden="true" />
        <span data-user-text>{occurrence.title}</span>
        {tag !== null ? <span className={styles.tag}>{tag}</span> : null}
      </h2>
      <div className={styles.plate}>
        {multiDay ? (
          <>
            <span className={styles.plateLabel}>{copy('event.starts')}</span>
            <b>{longThirteen(first, systemId)}</b>
            <span className={styles.gregorian}>Gregorian {longGregorian(first)}</span>
            <span className={styles.plateLabel}>{copy('event.ends')}</span>
            <b>{longThirteen(last, systemId)}</b>
            <span className={styles.gregorian}>Gregorian {longGregorian(last)}</span>
          </>
        ) : (
          <>
            <b>{longThirteen(first, systemId)}</b>
            <span className={styles.gregorian}>Gregorian {longGregorian(first)}</span>
          </>
        )}
      </div>
      <dl className={styles.rows}>
        {rows.map((row) => (
          <Fragment key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </Fragment>
        ))}
      </dl>
      {reason !== null ? (
        <p className={styles.readOnly}>
          <Icon name="lock" size={16} />
          <span>{readOnlyReasonText(reason)}</span>
        </p>
      ) : null}
      <div className={styles.actions}>
        {offers.edit && onEdit !== undefined ? (
          <button type="button" className={cx(styles.button, styles.accent)} onClick={onEdit}>
            {copy('event.edit')}
          </button>
        ) : null}
        {offers.editAlerts && onEditAlerts !== undefined ? (
          <button type="button" className={cx(styles.button, styles.accent)} onClick={onEditAlerts}>
            {copy('event.editAlerts')}
          </button>
        ) : null}
        {moreItems.length > 0 ? <Menu label="More" icon="more" iconOnly items={moreItems} placement="bottom-start" buttonClassName={styles.more} /> : null}
        <span className={styles.spacer} />
        {offers.delete && onDelete !== undefined ? (
          <button type="button" className={cx(styles.button, styles.danger)} onClick={(clicked) => onDelete(clicked.currentTarget)}>
            {copy('event.delete')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
