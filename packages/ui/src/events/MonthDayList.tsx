import {
  type AgendaDay,
  type CalendarSystemId,
  type GregorianDate,
  agenda,
  formatThirteen,
  intercalaryDaysInYear,
  monthDays,
  toISODate,
} from '@thirteen/core';
import { type CSSProperties, useMemo } from 'react';
import { cx } from '../lib/cx.ts';
import { agendaRowTime } from './AgendaList.tsx';
import { copy } from './copy.ts';
import { gregorianDayCaption, monthCellLabel, rowLabel, thirteenDayHeading } from './format.ts';
import styles from './MonthDayList.module.css';
import type { StoreCalendar, StoreOccurrence } from './store.ts';

/** One line of the accessibility-size Month (§2.4): a day with events, an empty day, or a run of empty days. */
export type MonthDayLine =
  | { readonly kind: 'day'; readonly day: AgendaDay }
  | { readonly kind: 'empty'; readonly day: AgendaDay }
  | { readonly kind: 'run'; readonly first: AgendaDay; readonly last: AgendaDay };

/**
 * The month's days in order (intercalary days after the month they follow),
 * from `agenda(..., {includeEmptyDays: true})`, with every run of two or more
 * days without events folded into one line (§2.4, `calendar.emptyRun`).
 */
export function monthDayLines(
  year: number,
  month: number,
  occurrences: readonly StoreOccurrence[],
  systemId: CalendarSystemId,
): MonthDayLine[] {
  const days = monthDays(year, month, systemId);
  const after = intercalaryDaysInYear(year, systemId).filter((day) => day.afterMonth === month);
  const last = after.length > 0 ? after[after.length - 1]!.gregorian : days[days.length - 1]!;
  const all = agenda(occurrences, days[0]!, last, systemId, { includeEmptyDays: true });
  const lines: MonthDayLine[] = [];
  let run: AgendaDay[] = [];
  const flush = () => {
    if (run.length === 1) lines.push({ kind: 'empty', day: run[0]! });
    else if (run.length > 1) lines.push({ kind: 'run', first: run[0]!, last: run[run.length - 1]! });
    run = [];
  };
  for (const day of all) {
    if (day.items.length === 0) {
      run.push(day);
      continue;
    }
    flush();
    lines.push({ kind: 'day', day });
  }
  flush();
  return lines;
}

/** "October 21" or "Year Day": a 13-month date without weekday or year, for `calendar.emptyRun`. */
function runDate(day: AgendaDay): string {
  return formatThirteen(day.thirteen, { style: 'long', includeYear: false });
}

export interface MonthDayListProps {
  readonly year: number;
  readonly month: number;
  readonly systemId: CalendarSystemId;
  readonly occurrences: readonly StoreOccurrence[] | null;
  readonly calendars: ReadonlyMap<string, StoreCalendar>;
  readonly today?: GregorianDate | null;
  readonly selected?: GregorianDate | null;
  readonly use24Hour: boolean;
  /** Accessible name of the list ("October 2026"). */
  readonly label: string;
  /** A day line, an empty run (its first day) or "+{n} more": open Day mode. */
  readonly onOpenDay: (date: GregorianDate) => void;
  /** An event line: its details. */
  readonly onOpenItem?: (key: string, anchor: HTMLElement) => void;
  readonly className?: string;
}

/** Event lines shown per day before "+{n} more". */
const LINES_PER_DAY = 3;

/**
 * Month mode at accessibility text sizes (docs/EVENTS.md §2.4, board J3): the
 * grid becomes a vertical list of the month's days. A day reads
 * `Thursday, October 12` + `Gregorian Mon, Oct 19`, then up to three event
 * lines (time and title, wrapping) and "+{n} more", which opens Day; a run of
 * days without events is one line ("No events, October 21 to October 23").
 */
export function MonthDayList({
  year,
  month,
  systemId,
  occurrences,
  calendars,
  today = null,
  selected = null,
  use24Hour,
  label,
  onOpenDay,
  onOpenItem,
  className,
}: MonthDayListProps) {
  const lines = useMemo(() => monthDayLines(year, month, occurrences ?? [], systemId), [year, month, occurrences, systemId]);
  const byKey = useMemo(() => new Map((occurrences ?? []).map((o) => [o.key, o])), [occurrences]);
  const todayIso = today === null ? null : toISODate(today);
  const selectedIso = selected === null ? null : toISODate(selected);

  return (
    <ul className={cx(styles.list, className)} aria-label={label} aria-busy={occurrences === null ? true : undefined}>
      {lines.map((line) => {
        if (line.kind === 'run') {
          const iso = toISODate(line.first.gregorian);
          return (
            <li key={iso} className={styles.line}>
              <button
                type="button"
                className={cx(styles.dayButton, styles.run)}
                onClick={() => onOpenDay(line.first.gregorian)}
                data-date={iso}
              >
                {copy('calendar.emptyRun', { start: runDate(line.first), end: runDate(line.last) })}
              </button>
            </li>
          );
        }
        const { day } = line;
        const iso = toISODate(day.gregorian);
        const shown = day.items.slice(0, LINES_PER_DAY);
        const hidden = day.items.length - shown.length;
        return (
          <li
            key={iso}
            className={cx(styles.line, iso === todayIso && styles.today, iso === selectedIso && styles.selected)}
            aria-current={iso === todayIso ? 'date' : undefined}
          >
            <button
              type="button"
              className={styles.dayButton}
              aria-label={monthCellLabel(day.thirteen, day.gregorian, day.items.length, null)}
              onClick={() => onOpenDay(day.gregorian)}
              data-date={iso}
            >
              <span className={styles.dayName}>{thirteenDayHeading(day.thirteen)}</span>
              <span className={styles.dayGreg}>{gregorianDayCaption(day.gregorian)}</span>
            </button>
            {shown.length > 0 ? (
              <ul className={styles.events}>
                {shown.map((item) => {
                  const occurrence = byKey.get(item.key);
                  if (occurrence === undefined) return null;
                  const calendar = calendars.get(occurrence.calendarId);
                  const time = agendaRowTime(occurrence, item, use24Hour);
                  const dayOf = item.dayCount > 1 ? { n: item.dayIndex, total: item.dayCount } : null;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        className={styles.event}
                        style={{ ['--cal' as string]: calendar?.color ?? '#57534e' } as CSSProperties}
                        aria-label={rowLabel(occurrence, calendar?.title ?? '', time, dayOf)}
                        data-key={item.key}
                        onClick={(event) => onOpenItem?.(item.key, event.currentTarget)}
                      >
                        <span className={styles.dot} aria-hidden="true" />
                        <span className={styles.eventText} aria-hidden="true">
                          <span className={styles.time}>{time}</span> <span data-user-text>{occurrence.title}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {hidden > 0 ? (
              <button type="button" className={styles.more} onClick={() => onOpenDay(day.gregorian)}>
                {copy('calendar.more', { n: hidden })}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
