import {
  type AgendaDay,
  type AgendaItem,
  type CalendarSystemId,
  type GregorianDate,
  type LocalDateTime,
  compareLocalDateTime,
  getCalendarSystem,
  toDisplayYear,
  toISODate,
} from '@thirteen/core';
import type { CSSProperties, HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cx } from '../lib/cx.ts';
import styles from './AgendaList.module.css';
import { copy } from './copy.ts';
import { formatTime, gregorianDayCaption, rowLabel, thirteenDayHeading } from './format.ts';
import type { StoreCalendar, StoreOccurrence } from './store.ts';

/** What the time column of a row shows (§2.7, §2.8): a time, "All day" or "Day 2 of 3". */
export function agendaRowTime(occurrence: StoreOccurrence, item: AgendaItem, use24Hour: boolean): string {
  if (occurrence.allDay) return copy('event.allDay');
  if (item.part === 'middle' || item.part === 'last') {
    return copy('calendar.dayOfDays', { n: item.dayIndex, total: item.dayCount });
  }
  return formatTime(item.startMinute ?? occurrence.start.minute, use24Hour);
}

/** The second line: "Day 1 of 7" (all-day, several days), the location, or "until 11:30". */
export function agendaRowDetail(occurrence: StoreOccurrence, item: AgendaItem, use24Hour: boolean): string {
  if (occurrence.allDay) return item.dayCount > 1 ? copy('calendar.dayOfDays', { n: item.dayIndex, total: item.dayCount }) : '';
  if (occurrence.location !== '') return occurrence.location;
  if ((item.part === 'single' || item.part === 'last') && item.endMinute !== null) {
    return copy('calendar.until', { time: formatTime(item.endMinute, use24Hour) });
  }
  return '';
}

/** Timed and running now (`start <= now < end`): the row wears the Now plate (§2.8, board J2). */
export function isInProgress(occurrence: StoreOccurrence, now: LocalDateTime | null): boolean {
  if (now === null || occurrence.allDay) return false;
  return compareLocalDateTime(occurrence.start, now) <= 0 && compareLocalDateTime(now, occurrence.end) < 0;
}

export interface AgendaRowProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'children' | 'onSelect'> {
  readonly occurrence: StoreOccurrence;
  /** The occurrence's part on this day (from core's `agenda`). */
  readonly item: AgendaItem;
  readonly calendar: StoreCalendar | undefined;
  readonly use24Hour: boolean;
  /** The device's wall clock, for the Now plate; omit to never show it. */
  readonly now?: LocalDateTime | null;
  /** More text for the second line (the Month day list adds the repeat, board A1). */
  readonly extra?: string | null;
  readonly selected?: boolean;
  /** The row was activated (click, Enter, Space): open its details. */
  readonly onOpen?: (key: string, anchor: HTMLElement) => void;
}

/**
 * One event row of List mode, the Month day list, the "+N more" popover and
 * Up next (docs/EVENTS.md §2.4, §2.7, §2.8): time column in Geist Mono,
 * calendar dot, title, and a second line; named by `calendar.row.a11y`.
 */
export function AgendaRow({
  occurrence,
  item,
  calendar,
  use24Hour,
  now = null,
  extra = null,
  selected = false,
  onOpen,
  className,
  ...rest
}: AgendaRowProps) {
  const time = agendaRowTime(occurrence, item, use24Hour);
  const detail = [agendaRowDetail(occurrence, item, use24Hour), extra ?? ''].filter((part) => part !== '').join(' · ');
  const dayOf = item.dayCount > 1 ? { n: item.dayIndex, total: item.dayCount } : null;
  const label = rowLabel(occurrence, calendar?.title ?? '', time, dayOf);
  const tentative = occurrence.status === 'tentative';
  const canceled = occurrence.status === 'canceled';
  return (
    <button
      {...rest}
      type="button"
      className={cx(styles.row, selected && styles.selected, tentative && styles.tentative, className)}
      style={{ ['--cal' as string]: calendar?.color ?? '#57534e' } as CSSProperties}
      aria-label={label}
      aria-pressed={selected}
      data-key={occurrence.key}
      onClick={(event: MouseEvent<HTMLButtonElement>) => onOpen?.(occurrence.key, event.currentTarget)}
    >
      <span className={styles.time} aria-hidden="true">
        {time}
      </span>
      <span className={styles.body} aria-hidden="true">
        <span className={styles.titleLine}>
          <span className={styles.dot} />
          <span className={cx(styles.title, canceled && styles.canceled)} data-user-text>
            {occurrence.title}
          </span>
          {isInProgress(occurrence, now) ? <span className={styles.nowPlate}>{copy('today.now')}</span> : null}
          {tentative ? <span className={styles.tag}>{copy('event.tentative')}</span> : null}
          {canceled ? <span className={styles.tag}>{copy('event.canceled')}</span> : null}
        </span>
        {detail !== '' ? (
          <span className={styles.detail} data-user-text>
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** "Thursday, October 12" + "Gregorian Mon, Oct 19" (or "Year Day" + "Gregorian Thu, Dec 31"). */
export function DayHeading({
  day,
  as: Tag = 'h3',
  className,
  actions,
}: {
  readonly day: Pick<AgendaDay, 'gregorian' | 'thirteen'>;
  readonly as?: 'h2' | 'h3' | 'h4' | 'div';
  readonly className?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <div className={cx(styles.dayHead, className)}>
      <Tag className={styles.dayTitle}>
        <span className={styles.dayName}>{thirteenDayHeading(day.thirteen)}</span>
        <span className={styles.dayGreg}>{gregorianDayCaption(day.gregorian)}</span>
      </Tag>
      {actions !== undefined ? <span className={styles.dayActions}>{actions}</span> : null}
    </div>
  );
}

export interface AgendaRowsProps {
  readonly day: AgendaDay;
  readonly occurrences: ReadonlyMap<string, StoreOccurrence>;
  readonly calendars: ReadonlyMap<string, StoreCalendar>;
  readonly use24Hour: boolean;
  readonly now?: LocalDateTime | null;
  readonly selectedKey?: string | null;
  readonly onOpen?: (key: string, anchor: HTMLElement) => void;
  /** Second-line extras by event id (the repeat description in the Month day list). */
  readonly extraFor?: (occurrence: StoreOccurrence) => string | null;
  /** Extra attributes for each row (drag sources, §6.5 B4). */
  readonly rowProps?: (key: string) => HTMLAttributes<HTMLButtonElement>;
  readonly className?: string;
}

/** A day's rows: all-day items first, then timed items in start order (the agenda's order). */
export function AgendaRows({
  day,
  occurrences,
  calendars,
  use24Hour,
  now = null,
  selectedKey = null,
  onOpen,
  extraFor,
  rowProps,
  className,
}: AgendaRowsProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-key]')];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };
  return (
    <ul className={cx(styles.rows, className)} onKeyDown={onKeyDown}>
      {day.items.map((item) => {
        const occurrence = occurrences.get(item.key);
        if (occurrence === undefined) return null;
        return (
          <li key={item.key}>
            <AgendaRow
              {...rowProps?.(item.key)}
              occurrence={occurrence}
              item={item}
              calendar={calendars.get(occurrence.calendarId)}
              use24Hour={use24Hour}
              now={now}
              extra={extraFor?.(occurrence) ?? null}
              selected={selectedKey === item.key}
              onOpen={onOpen}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** The 13-month month a day is listed under: its own, or the month an intercalary day follows. */
export function agendaMonthOf(day: Pick<AgendaDay, 'thirteen'>): number {
  const t = day.thirteen;
  if (t.kind === 'month') return t.month;
  return getCalendarSystem(t.system).intercalaryDays.find((info) => info.id === t.id)!.afterMonth;
}

/** "October 2026" / "Descartes 238": a List month header. */
export function agendaMonthTitle(year: number, month: number, systemId: CalendarSystemId): string {
  return `${getCalendarSystem(systemId).months[month - 1]!.name} ${toDisplayYear(year, systemId)}`;
}

export interface AgendaListProps extends Omit<AgendaRowsProps, 'day' | 'className'> {
  readonly days: readonly AgendaDay[];
  readonly systemId: CalendarSystemId;
  /** The day the list was opened on (scrolled into view and marked). */
  readonly anchorDay?: GregorianDate | null;
  readonly className?: string;
}

/**
 * List mode (docs/EVENTS.md §2.7): days with events, grouped by 13-month month
 * under a sticky header (`October 2026`) and by day (`Thursday, October 12` +
 * `Gregorian Mon, Oct 19`); intercalary days head as `Year Day` +
 * `Gregorian Thu, Dec 31`. Multi-day events appear on every day they cover.
 */
export function AgendaList({ days, systemId, anchorDay = null, className, ...rows }: AgendaListProps) {
  const groups: { key: string; year: number; month: number; days: AgendaDay[] }[] = [];
  for (const day of days) {
    const month = agendaMonthOf(day);
    const key = `${day.gregorian.year}-${month}`;
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.days.push(day);
    else groups.push({ key, year: day.gregorian.year, month, days: [day] });
  }
  const anchor = anchorDay === null ? null : toISODate(anchorDay);
  return (
    <div className={cx(styles.list, className)}>
      {groups.map((group) => (
        <section key={group.key} className={styles.month} aria-labelledby={`agenda-${group.key}`} data-month-group={group.key}>
          <h2 id={`agenda-${group.key}`} className={styles.monthHead}>
            {agendaMonthTitle(group.year, group.month, systemId)}
          </h2>
          {group.days.map((day) => {
            const iso = toISODate(day.gregorian);
            return (
              <div key={iso} className={cx(styles.day, anchor === iso && styles.anchor)} data-date={iso}>
                <DayHeading day={day} />
                <AgendaRows {...rows} day={day} />
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
