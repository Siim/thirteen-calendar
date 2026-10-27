import { type CalendarEvent, type EventOccurrence, type GregorianDate, diffMinutesLocal, formatLocalDateTime, toISODate } from '@thirteen/core';

/** Unicode code point order (UTF-16 order differs only where a surrogate meets U+E000 to U+FFFF). */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const rank = (unit: number) => (unit < 0xd800 ? unit : unit >= 0xe000 ? unit - 0x800 : unit + 0x2000);
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return rank(x) < rank(y) ? -1 : 1;
  }
  return a.length < b.length ? -1 : 1;
}

const DAY = 1440;

/**
 * The order key of §5.3, as core's layouts use it: start, then all-day bars,
 * timed bars (24 hours or more), dots; longer first; then title and key by
 * code points.
 */
export function compareOccurrences(a: EventOccurrence, b: EventOccurrence): number {
  const byStart = Math.sign(diffMinutesLocal(a.start, b.start));
  if (byStart !== 0) return byStart;
  const length = (o: EventOccurrence) => diffMinutesLocal(o.end, o.start);
  const rank = (o: EventOccurrence) => (o.allDay ? 0 : length(o) >= DAY ? 1 : 2);
  return rank(a) - rank(b) || length(b) - length(a) || compareCodePoints(a.title, b.title) || compareCodePoints(a.key, b.key);
}

/**
 * The occurrence key of §3.2 on Windows and web: `{calendarId}/{uid}|{original
 * start}`, the original start being a date for all-day events and a wall clock
 * in the event's zone otherwise (`null` minute: the master's start minute).
 */
export function occurrenceKey(
  event: Pick<CalendarEvent, 'id' | 'allDay' | 'start'>,
  originalDate: GregorianDate,
  originalMinute: number | null,
): string {
  if (event.allDay) return `${event.id}|${toISODate(originalDate)}`;
  return `${event.id}|${formatLocalDateTime({ date: originalDate, minute: originalMinute ?? event.start.minute })}`;
}

/** Splits a key into its event id and original start text; `null` when it is not a key. */
export function parseOccurrenceKey(key: string): { readonly eventId: string; readonly original: string } | null {
  const bar = key.lastIndexOf('|');
  if (bar <= 0 || bar === key.length - 1) return null;
  return { eventId: key.slice(0, bar), original: key.slice(bar + 1) };
}
