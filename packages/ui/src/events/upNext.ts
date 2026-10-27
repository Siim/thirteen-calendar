/**
 * Today's "Up next" (docs/EVENTS.md §2.8, board B1): the next 7 days' events
 * from now, at most 6 rows, grouped "Today", "Tomorrow" and then by day.
 *
 * Readings of §2.8 and board B1, pinned by `upNext.test.ts` with the mockup
 * data set (§6.7):
 * - "7 days ahead" is today and the 6 days after it (board B1 counts
 *   "5 more in the next 7 days" through Sunday, October 25).
 * - An event appears once, on the first day of the range it touches: a
 *   multi-day event that started before today is listed today ("Day 2 of 3"),
 *   and is not listed again on later days (board B1 lists Autumn school break
 *   under Today only).
 * - Events that ended earlier today are left out; one running now keeps its
 *   row, with the Now plate. Rows keep the agenda's order (all-day items and
 *   middle parts first, then by start), so a running event leads the timed
 *   rows, under the all-day ones, as board B1 draws it.
 * - The rows past the sixth are counted, each event once, in `more`.
 */

import {
  type AgendaItem,
  type CalendarSystemId,
  type EventOccurrence,
  type GregorianDate,
  type LocalDateTime,
  type ThirteenDate,
  addGregorianDays,
  agenda,
  compareLocalDateTime,
  gregorianEquals,
} from '@thirteen/core';

/** Today and the 6 days after it. */
export const UP_NEXT_DAYS = 7;
/** At most this many rows; the rest are counted (`today.moreNext7`). */
export const UP_NEXT_MAX_ROWS = 6;

export interface UpNextGroup {
  /** "Today", "Tomorrow", or a later day headed by both calendars. */
  readonly kind: 'today' | 'tomorrow' | 'later';
  readonly gregorian: GregorianDate;
  readonly thirteen: ThirteenDate;
  /** The rows of this day, in the agenda's order. */
  readonly items: readonly AgendaItem[];
}

export interface UpNextResult {
  /** Days with rows, in date order. */
  readonly groups: readonly UpNextGroup[];
  /** Events in the range past the row limit (`today.moreNext7`). */
  readonly more: number;
  /** Today still has something to show (else `today.emptyToday`, when later days do). */
  readonly todayLeft: boolean;
  /** Nothing at all in the 7 days (`today.emptyWeek`). */
  readonly empty: boolean;
  /** The last day of the range (inclusive). */
  readonly to: GregorianDate;
}

export interface UpNextOptions {
  readonly days?: number;
  readonly maxRows?: number;
}

/** Ended before `now`: its end is at or before now (a zero-length event at now has not ended). */
function ended(occurrence: EventOccurrence, now: LocalDateTime): boolean {
  return compareLocalDateTime(occurrence.end, now) <= 0 && compareLocalDateTime(occurrence.start, now) < 0;
}

/**
 * The Up next rows for `now` (the device's wall clock; its date is "today")
 * from the visible calendars' occurrences, which must cover `now.date` to 6
 * days later (keys unique, as `useOccurrencesInYears` merges them).
 */
export function upNext(
  occurrences: readonly EventOccurrence[],
  now: LocalDateTime,
  systemId: CalendarSystemId,
  options: UpNextOptions = {},
): UpNextResult {
  const days = options.days ?? UP_NEXT_DAYS;
  const maxRows = options.maxRows ?? UP_NEXT_MAX_ROWS;
  const from = now.date;
  const to = addGregorianDays(from, days - 1);
  const tomorrow = addGregorianDays(from, 1);
  const current = occurrences.filter((occurrence) => !ended(occurrence, now));
  const agendaDays = agenda(current, from, to, systemId);

  const seen = new Set<string>();
  const groups: UpNextGroup[] = [];
  let shown = 0;
  let total = 0;
  let todayLeft = false;
  for (const day of agendaDays) {
    const rows: AgendaItem[] = [];
    for (const item of day.items) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      total++;
      if (gregorianEquals(day.gregorian, from)) todayLeft = true;
      if (shown < maxRows) {
        rows.push(item);
        shown++;
      }
    }
    if (rows.length === 0) continue;
    const kind = gregorianEquals(day.gregorian, from) ? 'today' : gregorianEquals(day.gregorian, tomorrow) ? 'tomorrow' : 'later';
    groups.push({ kind, gregorian: day.gregorian, thirteen: day.thirteen, items: rows });
  }
  return { groups, more: total - shown, todayLeft, empty: total === 0, to };
}
