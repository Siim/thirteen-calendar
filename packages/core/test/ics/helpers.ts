/**
 * Shared helpers of the `.ics` tests: calendar text builders, the Node `Intl`
 * resolver, and `ical.js` 2.2 as an oracle for occurrences (docs/EVENTS.md
 * §5.5, §6.1 C7).
 */

import ICAL from 'ical.js';
import { type LocalDateTime, type ZoneResolver, parseLocalDateTime } from '../../src/events/index.ts';
import { intlZoneResolver } from '../../scripts/zone-resolvers.ts';

/** Node's `Intl` resolver (ICU tzdata), shared by every test. */
export const zones: ZoneResolver = intlZoneResolver();

/** Lines joined with CRLF and a final CRLF. */
export const crlf = (...lines: string[]): string => `${lines.join('\r\n')}\r\n`;

/** A calendar text: a `VCALENDAR` around the given lines. */
export const calendar = (...lines: string[]): string =>
  crlf('BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//Thirteen tests//EN', ...lines, 'END:VCALENDAR');

/** A `VEVENT` around the given lines. */
export const vevent = (...lines: string[]): string[] => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];

/** `YYYY-MM-DDTHH:MM` to a value. */
export const L = (text: string): LocalDateTime => parseLocalDateTime(text);

/** A device window `[from, to)`. */
export const W = (from: string, to: string) => ({ from: L(from), to: L(to) });

/** Milliseconds since 1970 of a UTC wall clock. */
export function utcMs(value: LocalDateTime): number {
  return Date.UTC(value.date.year, value.date.month - 1, value.date.day, 0, value.minute);
}

/** `Europe/Tallinn` as Google exports it (1970 onsets, open-ended rules). */
export const TALLINN_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Tallinn',
  'X-LIC-LOCATION:Europe/Tallinn',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0300',
  'TZNAME:EEST',
  'DTSTART:19700329T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0300',
  'TZOFFSETTO:+0200',
  'TZNAME:EET',
  'DTSTART:19701025T040000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** Outlook's `FLE Standard Time` definition. */
export const FLE_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:FLE Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T040000',
  'TZOFFSETFROM:+0300',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0300',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

/** One occurrence as the oracle reports it: UID (`missing` for a VEVENT without one), start and end in milliseconds to the minute (UTC; floating values read as UTC). */
export interface OracleOccurrence {
  readonly uid: string;
  readonly start: number;
  readonly end: number;
}

/** An instant in milliseconds, to the minute (the events engine's precision, §3.3: seconds are dropped). */
function timeMs(time: ICAL.Time): number {
  const floating = time.isDate || time.zone === undefined || time.zone === null || time.zone.tzid === 'floating';
  const ms = floating ? Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute) : time.toJSDate().getTime();
  return Math.floor(ms / 60_000) * 60_000;
}

const DAY_MS = 86_400_000;

/** The `ICAL.Time` of `like`'s kind (date, floating or zoned) at the instant `ms` (as {@link timeMs} reads it). */
function timeAt(ms: number, like: ICAL.Time): ICAL.Time {
  const d = new Date(ms);
  const fields = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: 0, isDate: like.isDate };
  const floating = like.isDate || like.zone === undefined || like.zone === null || like.zone.tzid === 'floating';
  return floating ? ICAL.Time.fromData(fields) : ICAL.Time.fromData(fields, ICAL.Timezone.utcTimezone).convertToZone(like.zone!);
}
const canceled = (event: ICAL.Event) => String(event.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';

/** The recurrence ids (UTC milliseconds) `ical.js` generates for a copy of `component` whose only rule is `rule` (no extra or excluded dates). */
function ruleInstants(component: ICAL.Component, rule: ICAL.Property, limit: number): number[] {
  const copy = ICAL.Component.fromString(component.toString());
  for (const name of ['rrule', 'exrule', 'rdate', 'exdate']) copy.removeAllProperties(name);
  const prop = new ICAL.Property('rrule');
  prop.setValue(rule.getFirstValue() as ICAL.Recur);
  copy.addProperty(prop);
  const out: number[] = [];
  const iterator = new ICAL.Event(copy).iterator();
  for (let next = iterator.next(); next; next = iterator.next()) {
    const ms = timeMs(next);
    if (ms > limit) break;
    out.push(ms);
  }
  return out;
}

/**
 * `ical.js`'s occurrences of every event of a calendar text whose start lies
 * in `[from, to)` (milliseconds), with only the text's own `VTIMEZONE`s
 * registered (its zone registry is cleared first). Overrides are related to
 * the first master of their UID; canceled ones are left out.
 *
 * Where `ical.js` 2.2.1 leaves RFC 5545 out, the harness fills in with
 * `ical.js`'s own expansion of the parts it reads:
 *
 * - `DTSTART` of a set made only of `RDATE`s (RFC 5545 §3.6.1: the first
 *   instance), which the iterator leaves out;
 * - an `RDATE;VALUE=PERIOD` value (the iterator yields an `ICAL.Period`, which
 *   `getOccurrenceDetails` cannot take) is placed at the period's start and
 *   end as `ical.js` parses them;
 * - every `RRULE` after the first is also expanded on its own and its dates
 *   are added (`ical.js` drops the other rules once the first completes);
 * - every `EXRULE` (RFC 2445, not expanded by `ical.js`) is expanded as an
 *   `RRULE` from the same `DTSTART` and its dates are removed;
 * - an override without a master is shown as a single event, as Apple
 *   Calendar shows it (`ical.js` has nothing to relate it to);
 * - a `VEVENT` without `UID` is reported as `missing`.
 */
export function icalOccurrences(text: string, from: number, to: number): OracleOccurrence[] {
  ICAL.TimezoneService.reset();
  const root = new ICAL.Component(ICAL.parse(text));
  for (const vtz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(new ICAL.Timezone(vtz));
  const masters: { uid: string; event: ICAL.Event }[] = [];
  const firstMaster = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Component[] = [];
  for (const component of root.getAllSubcomponents('vevent')) {
    const uidValue = component.getFirstPropertyValue('uid');
    if (component.hasProperty('recurrence-id')) {
      exceptions.push(component);
      continue;
    }
    const uid = uidValue === null ? 'missing' : String(uidValue);
    const event = new ICAL.Event(component);
    masters.push({ uid, event });
    if (uidValue !== null && !firstMaster.has(uid)) firstMaster.set(uid, event);
  }
  const out: OracleOccurrence[] = [];
  const push = (uid: string, start: number, end: number) => {
    if (start >= from && start < to) out.push({ uid, start, end });
  };
  for (const component of exceptions) {
    const uid = String(component.getFirstPropertyValue('uid'));
    const master = firstMaster.get(uid);
    const exception = new ICAL.Event(component);
    if (master !== undefined) master.relateException(exception);
    else if (!canceled(exception)) push(uid, timeMs(exception.startDate), timeMs(exception.endDate));
  }
  const limit = to + 40 * DAY_MS;
  for (const { uid, event } of masters) {
    if (!event.isRecurring()) {
      if (!canceled(event)) push(uid, timeMs(event.startDate), timeMs(event.endDate));
      continue;
    }
    const component = event.component;
    const excluded = new Set(component.getAllProperties('exrule').flatMap((rule) => ruleInstants(component, rule, limit)));
    const exdates = new Set(component.getAllProperties('exdate').flatMap((p) => p.getValues().map((v) => timeMs(v as ICAL.Time))));
    const seen = new Set<number>();
    const place = (next: ICAL.Time | ICAL.Period) => {
      if (next instanceof ICAL.Period) {
        const start = timeMs(next.start);
        if (seen.has(start) || excluded.has(start)) return;
        seen.add(start);
        push(uid, start, timeMs(next.getEnd()));
        return;
      }
      const id = timeMs(next);
      if (seen.has(id) || excluded.has(id)) return;
      seen.add(id);
      const details = event.getOccurrenceDetails(next);
      if (!canceled(details.item)) push(uid, timeMs(details.startDate), timeMs(details.endDate));
    };
    if (!component.hasProperty('rrule') && !exdates.has(timeMs(event.startDate))) place(event.startDate);
    const iterator = event.iterator();
    for (let next = iterator.next(); next; next = iterator.next()) {
      if (timeMs(next instanceof ICAL.Period ? next.start : next) > limit) break;
      place(next);
    }
    for (const rule of component.getAllProperties('rrule').slice(1)) {
      for (const ms of ruleInstants(component, rule, limit)) {
        if (seen.has(ms) || exdates.has(ms)) continue;
        place(timeAt(ms, event.startDate));
      }
    }
  }
  ICAL.TimezoneService.reset();
  return out.sort((a, b) => a.start - b.start || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0) || a.end - b.end);
}
