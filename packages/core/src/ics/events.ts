/**
 * Occurrences of a calendar text (docs/EVENTS.md §4.6, §5.4): every UID group
 * through `expandSeries`, with keys per §3.2. Windows and the web cache the
 * result per Gregorian year and merge years by key.
 * @module
 */

import { type GregorianDate, toISODate } from '../gregorian.ts';
import { fail, isInteger, readOptions, show } from '../internal.ts';
import type { EventOccurrence, EventStatus } from '../events/model.ts';
import { type DeviceWindow, type OverrideInput, type SeriesInput, expandSeries } from '../events/occurrences.ts';
import { type ExtraDate, type OriginalDate, type RecognitionInput, recognizeRecurrence } from '../events/recurrence.ts';
import { type RRule, untilInZone } from '../events/rrule.ts';
import {
  type LocalDateTime,
  type ZoneResolver,
  LATEST_END_ABSOLUTE,
  assertKnownZone,
  formatLocalDateTime,
  fromAbsoluteEnd,
  toAbsoluteMinutes,
  utcToZoned,
  utcToZonedAbsolute,
  zonedToUtc,
  zonedToUtcAbsolute,
} from '../events/time.ts';
import { type CalendarSystemId, DEFAULT_SYSTEM_ID, isCalendarSystemId } from '../systems/index.ts';
import { memberKey } from './parse.ts';
import type { IcsCalendar, IcsDateValue, IcsEvent, IcsGroup, IcsWarning } from './types.ts';
import { type Duration, durationMinutes, parseDuration, readDateValue } from './values.ts';
import { CalendarZones } from './zones.ts';

/** One occurrence of a calendar, in the device's wall clock, with what the platform needs to open and edit it. */
export interface IcsExpandedEvent extends EventOccurrence {
  readonly uid: string;
  /** Index of its group in `calendar.groups`. */
  readonly group: number;
  /** The `VEVENT` this occurrence shows: the override that replaced it, or the master. */
  readonly component: IcsEvent;
  /** The original occurrence (`RECURRENCE-ID`) in the series' zone; `originalMinute` null = the master's start time. */
  readonly originalDate: GregorianDate;
  readonly originalMinute: number | null;
  /** The group's master repeats (`RRULE` or `RDATE`). */
  readonly recurring: boolean;
  /** An override shown on its own: its group has no master, or the master does not produce its original date. */
  readonly orphan: boolean;
  readonly status: EventStatus;
  /** The zone of the component's start: an IANA id, the `TZID` of a file-defined zone, or `UTC`; null for floating and all-day events. */
  readonly zone: string | null;
  /** The start instant as a UTC wall clock (timed occurrences; null for all-day ones), for `alarmFireTime` (§2.14). */
  readonly startUtc: LocalDateTime | null;
}

/** Minutes in a day. */
const DAY = 1440;
/** Largest nominal day count passed on: the whole range of years 1 to 9999 (the `SeriesInput.duration` bound). */
const MAX_DURATION_DAYS = 3_652_059;

/** Converts values of one calendar between zones (internal zone names of {@link CalendarZones}). */
class Converter {
  readonly zones: CalendarZones;
  readonly dropped: number[] = [];

  constructor(zones: CalendarZones) {
    this.zones = zones;
  }

  get resolver(): ZoneResolver {
    return this.zones.resolver;
  }

  /**
   * A value as a wall clock in `zone`: a date at 00:00; a value already in
   * that zone, a floating value or any value of a floating series (`zone`
   * null) by its wall clock; otherwise through UTC. null when the conversion
   * leaves years 1 to 9999.
   */
  inZone(value: IcsDateValue, zone: string | null): LocalDateTime | null {
    if (value.kind === 'date') return { date: { ...value.date }, minute: 0 };
    const own = this.zones.zoneOf(value);
    if (own === null || zone === null || own === zone) return { date: { ...value.value.date }, minute: value.value.minute };
    const utc = zonedToUtc(value.value, own, this.resolver);
    return utc === null ? null : utcToZoned(utc, zone, this.resolver);
  }

  /** Minutes between two values as instants (own zones; floating values in `zone`), or null. */
  exactMinutes(from: IcsDateValue, to: IcsDateValue, zone: string | null): number | null {
    const instant = (v: IcsDateValue): number | null => {
      if (v.kind === 'date') return toAbsoluteMinutes({ date: v.date, minute: 0 });
      const own = this.zones.zoneOf(v) ?? zone;
      return own === null ? toAbsoluteMinutes(v.value) : zonedToUtcAbsolute(toAbsoluteMinutes(v.value), own, this.resolver);
    };
    const a = instant(from);
    const b = instant(to);
    return a === null || b === null ? null : b - a;
  }

  /**
   * Minutes from a value to the end of a `DURATION` after it, as instants:
   * the duration's days on the value's wall clock (its own zone; floating
   * values in `zone`, else on the plain wall clock), then its exact part
   * (RFC 5545 §3.3.6). `P1D` from 12:00 on a spring-forward Saturday is 23
   * hours. A date value counts whole days.
   */
  nominalMinutes(from: IcsDateValue, duration: Duration, zone: string | null): number {
    const days = Math.min(duration.days, MAX_DURATION_DAYS);
    const exact = Math.min(Math.trunc(duration.seconds / 60), MAX_DURATION_DAYS * DAY);
    if (from.kind === 'date') return days * DAY + exact;
    const own = this.zones.zoneOf(from) ?? zone;
    if (own === null || days === 0) return days * DAY + exact;
    const local = toAbsoluteMinutes(from.value);
    return zonedToUtcAbsolute(local + days * DAY, own, this.resolver) + exact - zonedToUtcAbsolute(local, own, this.resolver);
  }

  /**
   * An event's times in `zone` (its start's own zone): start, and end in
   * end-of-day form, never before the start. All-day: `DTEND` (exclusive) or
   * `DURATION` in whole days, at least one; timed: `DTEND` converted to the
   * zone, or `DURATION` (days on the wall clock, the rest exactly), or zero.
   * `duration` is a timed `DURATION` with days, which every occurrence of a
   * series applies on its own wall clock (RFC 5545 §3.8.5.3); otherwise null.
   */
  times(
    event: IcsEvent,
    zone: string | null,
  ): { allDay: boolean; start: LocalDateTime; end: LocalDateTime; duration: { days: number; minutes: number } | null } {
    const allDay = event.start.kind === 'date';
    const start = this.inZone(event.start, zone)!;
    const startAbsolute = toAbsoluteMinutes(start);
    const duration = event.end === null && event.duration !== null ? parseDuration(event.duration) : null;
    let endAbsolute = startAbsolute;
    if (allDay) {
      let days = 1;
      if (event.end !== null) {
        const endDate = event.end.kind === 'date' ? event.end.date : event.end.value.date;
        days = Math.max(1, Math.round((toAbsoluteMinutes({ date: endDate, minute: 0 }) - startAbsolute) / DAY));
      } else if (duration !== null && !duration.negative) {
        days = Math.max(1, duration.days + Math.ceil(duration.seconds / 86400));
      }
      endAbsolute = startAbsolute + days * DAY;
    } else if (event.end !== null) {
      const end = this.inZone(event.end, zone);
      endAbsolute = end === null ? LATEST_END_ABSOLUTE : toAbsoluteMinutes(end);
    } else if (duration !== null && !duration.negative) {
      const wall = startAbsolute + duration.days * DAY;
      const exact = Math.trunc(duration.seconds / 60);
      endAbsolute = zone === null ? wall + exact : utcToZonedAbsolute(zonedToUtcAbsolute(wall, zone, this.resolver) + exact, zone, this.resolver);
    }
    endAbsolute = Math.min(Math.max(endAbsolute, startAbsolute), LATEST_END_ABSOLUTE);
    const nominal =
      !allDay && event.end === null && duration !== null && !duration.negative && duration.days > 0
        ? { days: Math.min(duration.days, MAX_DURATION_DAYS), minutes: Math.min(Math.trunc(duration.seconds / 60), MAX_DURATION_DAYS * DAY) }
        : null;
    return { allDay, start, end: fromAbsoluteEnd(endAbsolute, startAbsolute) ?? start, duration: nominal };
  }
}

/**
 * The recognition input of a master in its zone (§4.5); values that leave
 * years 1 to 9999 are left out (counted in `dropped`). A `PERIOD` extra date
 * lasts from its start to its end as instants, or its `DURATION` with the
 * days on its own wall clock; floating values are measured in `floatingZone`
 * (the device's, when expanding) or on the plain wall clock.
 */
function recognitionInput(master: IcsEvent, converter: Converter, floatingZone: string | null = null): RecognitionInput {
  const zone = converter.zones.zoneOf(master.start);
  const measureZone = zone ?? floatingZone;
  const allDay = master.start.kind === 'date';
  const start = converter.inZone(master.start, zone)!;
  const ruleZone = allDay ? null : zone;
  const withUntil = (rrule: RRule) => ({ rrule, until: rrule.until === null ? null : untilInZone(rrule.until, ruleZone, converter.resolver) });
  const rdates: ExtraDate[] = [];
  for (const r of master.rdates) {
    const local = converter.inZone(r.value, zone);
    if (local === null) {
      converter.dropped.push(master.line ?? 0);
      continue;
    }
    let durationMinutesValue: number | null = null;
    if (r.period !== null) {
      const endValue = readDateValue(r.period, r.value.kind === 'zoned' ? [['TZID', r.value.tzid]] : []);
      const duration = endValue === null ? parseDuration(r.period) : null;
      durationMinutesValue =
        endValue !== null
          ? converter.exactMinutes(r.value, endValue, measureZone)
          : duration === null
            ? null
            : duration.negative
              ? durationMinutes(duration)
              : converter.nominalMinutes(r.value, duration, measureZone);
      if (durationMinutesValue !== null && durationMinutesValue < 0) durationMinutesValue = 0;
    }
    const minute = allDay || r.value.kind === 'date' ? null : local.minute;
    rdates.push({ date: local.date, minute, durationMinutes: durationMinutesValue });
  }
  const exdates: OriginalDate[] = [];
  for (const x of master.exdates) {
    const local = converter.inZone(x, zone);
    if (local === null) continue;
    exdates.push({ date: local.date, minute: allDay || x.kind === 'date' ? null : local.minute });
  }
  return {
    start: allDay ? { date: start.date, minute: 0 } : start,
    rrules: master.rrules.map(withUntil),
    exrules: master.exrules.map(withUntil),
    rdates,
    exdates,
    marker: master.thirteenRule,
  };
}

/**
 * The recognition input (§4.5) of a stored master: its start, rules (with
 * `UNTIL` in its zone), `RDATE`s and `EXDATE`s converted to the master's own
 * zone (`TZID` resolved as §5.4 says), and its `X-THIRTEEN-RULE`. Pass it to
 * `recognizeRecurrence` to get the repeat the editor shows.
 */
export function icsRecognitionInput(master: IcsEvent, calendar: IcsCalendar, zones: ZoneResolver): RecognitionInput {
  return recognitionInput(master, new Converter(new CalendarZones(calendar, zones)));
}

const statusOf = (event: IcsEvent): EventStatus =>
  event.status === 'CANCELLED' || event.status === 'CANCELED' ? 'canceled' : event.status === 'TENTATIVE' ? 'tentative' : 'confirmed';

const isCanceled = (event: IcsEvent): boolean => statusOf(event) === 'canceled';

function readSystem(systemId: unknown): CalendarSystemId {
  if (!isCalendarSystemId(systemId)) fail(`Unknown calendar system ${show(systemId)}`);
  return systemId;
}

/**
 * Expands a calendar for a window of the device's wall clock (§4.6): one
 * `expandSeries` per UID group, with
 *
 * - each `TZID` resolved as §5.4 says (IANA, Windows id, the file's
 *   `VTIMEZONE`, else floating); a UTC `DTSTART` is a series in UTC;
 * - the master's recurrence from `recognizeRecurrence` of its stored data
 *   (in its own zone), its length from `DTEND` or `DURATION`;
 * - every override (`RECURRENCE-ID` converted to the master's zone) placed at
 *   its own times; a group without a master shows each override on its own
 *   (the orphan path), as does a second override of one `RECURRENCE-ID`;
 * - keys `{calendarId}/{UID}|{original start}` (§3.2): the original date
 *   (`YYYY-MM-DD`) for all-day series, else its date and time in the series'
 *   zone (`YYYY-MM-DDTHH:MM`). A second master of a UID (a second group) and a
 *   second override of one `RECURRENCE-ID` add `#2`, `#3` (document order) to
 *   every key they give, so keys stay unique and stable across windows.
 *
 * Occurrences are sorted by start, then key. `warnings` reports occurrences
 * and values dropped because they leave years 1 to 9999 (`out-of-range`, line
 * of the component).
 * @throws RangeError for an invalid window, device zone, resolver, system or option.
 */
export function expandCalendar(
  calendar: IcsCalendar,
  deviceZone: string,
  zones: ZoneResolver,
  window: DeviceWindow,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
  options?: { calendarId?: string; limit?: number },
): { events: IcsExpandedEvent[]; warnings: IcsWarning[] } {
  assertKnownZone(deviceZone, zones);
  const system = readSystem(systemId);
  const opts = readOptions(options, ['calendarId', 'limit'], 'eventsFromCalendar');
  const calendarId = opts.calendarId ?? '';
  if (typeof calendarId !== 'string') fail(`eventsFromCalendar option 'calendarId' must be a string, got ${show(calendarId)}`);
  const limit = opts.limit;
  if (limit !== undefined && !(isInteger(limit) && limit >= 1)) fail(`eventsFromCalendar option 'limit' must be a positive integer, got ${show(limit)}`);
  if (!Array.isArray(calendar?.groups)) fail(`Expected an IcsCalendar, got ${show(calendar)}`);

  const converter = new Converter(new CalendarZones(calendar, zones));
  const resolver = converter.resolver;
  const expandOptions = limit === undefined ? undefined : { limit: limit as number };
  const events: IcsExpandedEvent[] = [];
  const warnings: IcsWarning[] = [];
  const masterRank = new Map<string, number>();

  const outOfRange = (line: number | null, uid: string, count: number) => {
    if (count > 0) {
      warnings.push({
        line: line ?? 0,
        code: 'out-of-range',
        detail: `${count} ${count === 1 ? 'occurrence' : 'occurrences'} of UID ${uid} would fall outside years 1 to 9999 here and ${count === 1 ? 'is' : 'are'} not shown`,
      });
    }
  };

  const originalText = (date: GregorianDate, minute: number | null, allDay: boolean) =>
    allDay || minute === null ? toISODate(date) : formatLocalDateTime({ date, minute });

  calendar.groups.forEach((group: IcsGroup, groupIndex) => {
    const rank = (masterRank.get(group.uid) ?? 0) + 1;
    masterRank.set(group.uid, rank);
    const groupSuffix = rank > 1 ? `#${rank}` : '';
    const master = group.master;

    // Overrides: the first of each RECURRENCE-ID goes to the series; later ones are shown on their own.
    const firsts: IcsEvent[] = [];
    const repeats: { event: IcsEvent; n: number }[] = [];
    const seen = new Map<string, number>();
    for (const override of group.overrides) {
      const key = memberKey(override);
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n === 1) firsts.push(override);
      else repeats.push({ event: override, n });
    }

    // The series: the master, or (no master) a stand-in at the first override's original time.
    const anchor = master ?? firsts[0] ?? null;
    if (anchor === null) return;
    const zone = master !== null ? converter.zones.zoneOf(master.start) : converter.zones.zoneOf(anchor.recurrenceId!);
    const seriesTimes = master !== null ? converter.times(master, zone) : null;
    let start: LocalDateTime;
    let end: LocalDateTime;
    let allDay: boolean;
    let duration: { days: number; minutes: number } | null = null;
    if (seriesTimes !== null) {
      ({ start, end, allDay, duration } = seriesTimes);
    } else {
      const original = converter.inZone(anchor.recurrenceId!, zone);
      if (original === null) {
        outOfRange(anchor.line, group.uid, 1);
        return;
      }
      allDay = anchor.recurrenceId!.kind === 'date';
      start = original;
      end = original;
    }
    const recurring = master !== null && (master.rrules.length > 0 || master.rdates.length > 0);
    const recurrence = recurring ? recognizeRecurrence(recognitionInput(master, converter, deviceZone), system).recurrence : null;
    const startMinute = allDay ? 0 : start.minute;

    const overrides: OverrideInput[] = [];
    firsts.forEach((override, i) => {
      const original = converter.inZone(override.recurrenceId!, zone);
      if (original === null) {
        converter.dropped.push(override.line ?? 0);
        return;
      }
      const ownZone = converter.zones.zoneOf(override.start);
      const own = converter.times(override, ownZone);
      overrides.push({
        id: String(i),
        originalDate: original.date,
        originalMinute: allDay || override.recurrenceId!.kind === 'date' ? null : original.minute,
        canceled: isCanceled(override),
        allDay: own.allDay,
        start: own.start,
        end: own.end,
        zone: own.allDay ? null : ownZone,
      });
    });

    const series: SeriesInput = { id: group.uid, recurrence, allDay, start, end, zone: allDay ? null : zone, overrides, duration };
    const result = expandSeries(series, window, deviceZone, resolver, expandOptions);
    outOfRange(anchor.line, group.uid, result.outOfRange);
    const orphans = new Set(result.orphans);
    for (const occurrence of result.occurrences) {
      const override = occurrence.overrideId === null ? null : firsts[Number(occurrence.overrideId)]!;
      const component = override ?? master!;
      const original = originalText(occurrence.originalDate, occurrence.originalMinute ?? startMinute, allDay);
      const isOrphan = override !== null && (master === null || orphans.has(occurrence.overrideId!));
      events.push({
        key: `${calendarId}/${group.uid}|${original}${groupSuffix}`,
        calendarId,
        title: component.summary,
        allDay: occurrence.allDay,
        start: occurrence.start,
        end: occurrence.end,
        uid: group.uid,
        group: groupIndex,
        component,
        originalDate: occurrence.originalDate,
        originalMinute: occurrence.originalMinute,
        recurring,
        orphan: isOrphan,
        status: statusOf(component),
        zone: occurrence.allDay ? null : CalendarZones.displayName(override === null ? zone : converter.zones.zoneOf(override.start)),
        startUtc: occurrence.startUtc,
      });
    }

    // Repeated overrides of one RECURRENCE-ID: each on its own, keyed with #n.
    for (const { event, n } of repeats) {
      if (isCanceled(event)) continue;
      const original = converter.inZone(event.recurrenceId!, zone);
      if (original === null) {
        converter.dropped.push(event.line ?? 0);
        continue;
      }
      const ownZone = converter.zones.zoneOf(event.start);
      const own = converter.times(event, ownZone);
      const single: SeriesInput = { id: group.uid, recurrence: null, allDay: own.allDay, start: own.start, end: own.end, zone: own.allDay ? null : ownZone, overrides: [] };
      const placed = expandSeries(single, window, deviceZone, resolver, expandOptions);
      outOfRange(event.line, group.uid, placed.outOfRange);
      const originalMinute = allDay || event.recurrenceId!.kind === 'date' || original.minute === startMinute ? null : original.minute;
      for (const occurrence of placed.occurrences) {
        events.push({
          key: `${calendarId}/${group.uid}|${originalText(original.date, originalMinute ?? startMinute, allDay)}${groupSuffix}#${n}`,
          calendarId,
          title: event.summary,
          allDay: occurrence.allDay,
          start: occurrence.start,
          end: occurrence.end,
          uid: group.uid,
          group: groupIndex,
          component: event,
          originalDate: original.date,
          originalMinute,
          recurring,
          orphan: true,
          status: statusOf(event),
          zone: occurrence.allDay ? null : CalendarZones.displayName(ownZone),
          startUtc: occurrence.startUtc,
        });
      }
    }
  });

  const dropped = new Map<number, number>();
  for (const line of converter.dropped) dropped.set(line, (dropped.get(line) ?? 0) + 1);
  for (const [line, count] of dropped) {
    warnings.push({ line, code: 'out-of-range', detail: `${count} ${count === 1 ? 'date' : 'dates'} of this event would fall outside years 1 to 9999 and ${count === 1 ? 'is' : 'are'} left out` });
  }
  const compareKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  events.sort((a, b) => toAbsoluteMinutes(a.start) - toAbsoluteMinutes(b.start) || compareKey(a.key, b.key));
  warnings.sort((a, b) => a.line - b.line);
  return { events, warnings };
}

/**
 * The occurrences of a calendar in a window of the device's wall clock
 * (§5.4): {@link expandCalendar} without its warnings. `options.calendarId`
 * is the first part of every key (§3.2).
 */
export function eventsFromCalendar(
  calendar: IcsCalendar,
  deviceZone: string,
  zones: ZoneResolver,
  window: DeviceWindow,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
  options?: { calendarId?: string; limit?: number },
): IcsExpandedEvent[] {
  return expandCalendar(calendar, deviceZone, zones, window, systemId, options).events;
}
