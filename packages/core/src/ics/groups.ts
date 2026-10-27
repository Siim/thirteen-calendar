/**
 * Operations on UID groups and calendars of the `.ics` module
 * (docs/EVENTS.md §2.17, §3.6, §4.7, §5.4): replacing and removing a group,
 * versions and import baselines, merging and renaming `VTIMEZONE`s, a new
 * Thirteen calendar, and the retimed `UNTIL`s of a series.
 * @module
 */

import { type GregorianDate, addGregorianDays, assertValidGregorian, diffGregorianDays, toISODate } from '../gregorian.ts';
import { fail, isRecord, readOptions, show } from '../internal.ts';
import type { UntilRewrite } from '../events/recurrence.ts';
import { type RRule, type RRuleUntil, formatICalDateTime } from '../events/rrule.ts';
import { type LocalDateTime, type ZoneResolver, compareLocalDateTime, copyLocal, zonedToUtc } from '../events/time.ts';
import { nearestCssColorName, normalizeHexColor } from './colors.ts';
import { escapeText, foldLine, parseContentLine, physicalLines, unfold } from './lexer.ts';
import { memberKey } from './parse.ts';
import { THIRTEEN_PRODID } from './serialize.ts';
import type { IcsAlarm, IcsCalendar, IcsDateValue, IcsEvent, IcsGroup, IcsTimeZone } from './types.ts';
import { assertDateValue } from './values.ts';
import { resolveTzid, sameTimeZoneDefinition, windowsZoneToIana } from './zones.ts';

const CRLF = '\r\n';

const membersOf = (group: IcsGroup): IcsEvent[] => [...(group.master === null ? [] : [group.master]), ...group.overrides];

function assertGroup(group: unknown): asserts group is IcsGroup {
  if (!isRecord(group) || typeof group.uid !== 'string' || group.uid === '') fail(`Expected an IcsGroup with a uid, got ${show(group)}`);
  if (group.master !== null && !isRecord(group.master)) fail(`Group master must be an IcsEvent or null, got ${show(group.master)}`);
  if (!Array.isArray(group.overrides)) fail(`Group overrides must be an array, got ${show(group.overrides)}`);
  for (const member of membersOf(group as unknown as IcsGroup)) {
    if (member.uid !== group.uid) fail(`Every member of group ${show(group.uid)} must have that uid, got ${show(member.uid)}`);
    assertDateValue(member.start, 'event start');
  }
  if (group.master !== null && (group.master as unknown as IcsEvent).recurrenceId !== null) fail('A group master has no RECURRENCE-ID');
  for (const override of group.overrides as IcsEvent[]) {
    if (override.recurrenceId === null) fail(`Overrides of group ${show(group.uid)} need a RECURRENCE-ID`);
  }
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/**
 * The calendar with `group` in place of the group(s) of its UID (§3.6), or
 * added at the end when the UID is new. Each member takes the `line` (the
 * position in the text) of the member it replaces (same `RECURRENCE-ID`, or
 * the master), so the writer keeps the order; a new member is written after
 * its group. By default every member's `raw` is cleared, so the group is
 * re-serialized (an edit; untouched fields are still written as read from
 * `original`). With `keepRaw` (import and restore, §2.17) the members' `raw`
 * text is kept and copied as read. A group with no master and no overrides
 * removes the UID.
 * @throws RangeError for a malformed group (members with another UID, a
 * master with a `RECURRENCE-ID`, an override without one).
 */
export function replaceGroup(calendar: IcsCalendar, group: IcsGroup, options?: { keepRaw?: boolean }): IcsCalendar {
  assertGroup(group);
  const opts = readOptions(options, ['keepRaw'], 'replaceGroup');
  if (opts.keepRaw !== undefined && typeof opts.keepRaw !== 'boolean') fail(`replaceGroup option 'keepRaw' must be a boolean, got ${show(opts.keepRaw)}`);
  const keepRaw = opts.keepRaw === true;
  const index = calendar.groups.findIndex((g) => g.uid === group.uid);
  const rest = calendar.groups.filter((g) => g.uid !== group.uid);
  if (group.master === null && group.overrides.length === 0) return { ...calendar, groups: rest };
  const oldLines = new Map<string, number | null>();
  for (const old of calendar.groups) {
    if (old.uid !== group.uid) continue;
    for (const member of membersOf(old)) if (!oldLines.has(memberKey(member))) oldLines.set(memberKey(member), member.line);
  }
  const place = (event: IcsEvent): IcsEvent => ({ ...event, raw: keepRaw ? event.raw : null, line: oldLines.get(memberKey(event)) ?? null });
  const placed: IcsGroup = { uid: group.uid, master: group.master === null ? null : place(group.master), overrides: group.overrides.map(place) };
  const groups = [...rest];
  groups.splice(index < 0 ? groups.length : calendar.groups.slice(0, index).filter((g) => g.uid !== group.uid).length, 0, placed);
  return { ...calendar, groups };
}

/** The calendar without the group(s) of `uid` ("Delete" of a whole series or single event). */
export function removeGroup(calendar: IcsCalendar, uid: string): IcsCalendar {
  if (typeof uid !== 'string') fail(`UID must be a string, got ${show(uid)}`);
  return { ...calendar, groups: calendar.groups.filter((g) => g.uid !== uid) };
}

/** A value read as UTC: UTC values as they are; floating and zoned ones (invalid for these properties) by their wall clock; dates at 00:00. */
function versionValue(value: IcsDateValue | null): LocalDateTime | null {
  if (value === null) return null;
  return value.kind === 'date' ? { date: { ...value.date }, minute: 0 } : copyLocal(value.value);
}

const later = (a: LocalDateTime | null, b: LocalDateTime | null): LocalDateTime | null =>
  a === null ? b : b === null ? a : compareLocalDateTime(a, b) >= 0 ? a : b;

/** An event's version (§2.17): its `LAST-MODIFIED`, else its `DTSTAMP`, in UTC; null when it has neither. */
export function eventVersion(event: IcsEvent): LocalDateTime | null {
  return versionValue(event.lastModified) ?? versionValue(event.dtstamp);
}

/**
 * The newest `LAST-MODIFIED` of the group, else its newest `DTSTAMP`, in UTC;
 * null when it has neither (§2.17 step 3: such a group is older than any
 * other). Floating values are read as UTC.
 */
export function groupVersion(group: IcsGroup): LocalDateTime | null {
  assertGroup(group);
  const members = membersOf(group);
  const newest = (pick: (e: IcsEvent) => IcsDateValue | null) => members.reduce<LocalDateTime | null>((best, e) => later(best, versionValue(pick(e))), null);
  return newest((e) => e.lastModified) ?? newest((e) => e.dtstamp);
}

/** `raw` text with every `X-THIRTEEN-IMPORTED-LAST-MODIFIED` of the `VEVENT` itself replaced by one line before its `END`. */
function setBaselineLine(text: string, value: string): string {
  const lines = physicalLines(text);
  const drop = new Set<number>();
  let depth = 0;
  let endIndex = -1;
  for (const content of unfold(lines)) {
    const parsed = parseContentLine(content.text);
    if (parsed === null) continue;
    if (parsed.name === 'BEGIN') depth++;
    else if (parsed.name === 'END') {
      if (depth === 1) endIndex = content.first;
      depth--;
    } else if (depth === 1 && parsed.name === 'X-THIRTEEN-IMPORTED-LAST-MODIFIED') {
      for (let i = content.first; i <= content.last; i++) drop.add(i);
    }
  }
  if (endIndex < 0) endIndex = lines.length;
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (i === endIndex) out.push(`X-THIRTEEN-IMPORTED-LAST-MODIFIED:${value}`);
    if (!drop.has(i)) out.push(line);
  });
  if (endIndex >= lines.length) out.push(`X-THIRTEEN-IMPORTED-LAST-MODIFIED:${value}`);
  return `${out.join(CRLF)}${CRLF}`;
}

function withBaseline(event: IcsEvent, baseline: LocalDateTime): IcsEvent {
  const value = formatICalDateTime(baseline, 0, true);
  return {
    ...event,
    importedLastModified: { kind: 'utc', value: copyLocal(baseline) },
    raw: event.raw === null ? null : setBaselineLine(event.raw, value),
    original: event.original === null ? null : setBaselineLine(event.original, value),
  };
}

/**
 * Records an import baseline (§3.6): `X-THIRTEEN-IMPORTED-LAST-MODIFIED` set
 * to `baseline` (UTC) in the master's raw text, just before its `END:VEVENT`,
 * replacing an earlier such line; every other byte stays as read. In a group
 * without a master each override carries its own line with its own version
 * (`eventVersion`, or `baseline` when it has none); a platform merging one
 * override into a stored group calls this with a group of that override.
 */
export function withImportBaseline(group: IcsGroup, baseline: LocalDateTime): IcsGroup {
  assertGroup(group);
  if (compareLocalDateTime(baseline, baseline) !== 0 || baseline.minute === 1440) fail('The baseline must be a UTC wall clock before 24:00');
  if (group.master !== null) return { uid: group.uid, master: withBaseline(group.master, baseline), overrides: [...group.overrides] };
  return { uid: group.uid, master: null, overrides: group.overrides.map((o) => withBaseline(o, eventVersion(o) ?? baseline)) };
}

// ---------------------------------------------------------------------------
// VTIMEZONEs on import (§3.6)
// ---------------------------------------------------------------------------

function knownZone(tzid: string, zones: ZoneResolver): boolean {
  const knows = (id: string) => {
    try {
      return zones.isKnown(id) === true;
    } catch {
      return false;
    }
  };
  if (knows(tzid)) return true;
  const windows = windowsZoneToIana(tzid);
  return windows !== null && knows(windows);
}

/**
 * Adds to `target` every `VTIMEZONE` of `source` whose `TZID` the target has
 * no definition for, as read (§3.6: the document keeps its existing definition
 * of a `TZID`, or takes the incoming one when it had none). The writer drops
 * definitions no event uses.
 */
export function mergeTimeZones(target: IcsCalendar, source: IcsCalendar): IcsCalendar {
  const have = new Set(target.timeZones.map((t) => t.tzid));
  const added: IcsTimeZone[] = [];
  for (const zone of source.timeZones) {
    if (have.has(zone.tzid)) continue;
    have.add(zone.tzid);
    added.push({ ...zone, line: null });
  }
  return added.length === 0 ? target : { ...target, timeZones: [...target.timeZones, ...added] };
}

/** `raw` text of a `VTIMEZONE` with its own `TZID` line replaced. */
function renameTimeZoneText(text: string, tzid: string): string {
  const lines = physicalLines(text);
  const out: string[] = [];
  let depth = 0;
  let replaced = false;
  const skip = new Set<number>();
  for (const content of unfold(lines)) {
    const parsed = parseContentLine(content.text);
    if (parsed === null) continue;
    if (parsed.name === 'BEGIN') depth++;
    else if (parsed.name === 'END') depth--;
    else if (depth === 1 && parsed.name === 'TZID' && !replaced) {
      replaced = true;
      for (let i = content.first + 1; i <= content.last; i++) skip.add(i);
      lines[content.first] = foldLine(`TZID:${escapeText(tzid)}`);
    }
  }
  lines.forEach((line, i) => {
    if (!skip.has(i)) out.push(line);
  });
  return `${out.join(CRLF)}${CRLF}`;
}

function renameValue(value: IcsDateValue, renames: ReadonlyMap<string, string>): IcsDateValue {
  return value.kind === 'zoned' && renames.has(value.tzid) ? { ...value, tzid: renames.get(value.tzid)! } : value;
}

function renameEvent(event: IcsEvent, renames: ReadonlyMap<string, string>): IcsEvent {
  const values = [event.start, event.end, event.recurrenceId, ...event.rdates.map((r) => r.value), ...event.exdates];
  const uses = values.some((v) => v !== null && v.kind === 'zoned' && renames.has(v.tzid));
  if (!uses) return event;
  const rename = (v: IcsDateValue | null) => (v === null ? null : renameValue(v, renames));
  const alarm = (a: IcsAlarm): IcsAlarm => (a.trigger.kind === 'absolute' ? { ...a, trigger: { kind: 'absolute', value: renameValue(a.trigger.value, renames) } } : a);
  return {
    ...event,
    start: renameValue(event.start, renames),
    end: rename(event.end),
    recurrenceId: rename(event.recurrenceId),
    rdates: event.rdates.map((r) => ({ value: renameValue(r.value, renames), period: r.period })),
    exdates: event.exdates.map((x) => renameValue(x, renames)),
    alarms: event.alarms.map(alarm),
    raw: null,
  };
}

/**
 * Renames the `VTIMEZONE`s of an incoming calendar that would collide with the
 * target's (§3.6). Only a `TZID` that resolves through the file's own
 * definition is considered: one the resolver knows as an IANA id, or that the
 * CLDR Windows table maps, is never renamed (its groups keep their raw text,
 * and the target keeps one definition of it). When the target defines the
 * same `TZID` differently (`sameTimeZoneDefinition`), the incoming one becomes
 * `{TZID} (2)`, or `(3)` and so on: the first name the target does not use
 * (and the incoming calendar does not use for another definition), or that the
 * target defines the same way (then shared). Every incoming event that uses a
 * renamed `TZID` gets the new name and loses its `raw` text, so it is
 * re-serialized; the renamed `VTIMEZONE` keeps its text with a new `TZID` line.
 */
export function renameCollidingTimeZones(target: IcsCalendar, incoming: IcsCalendar, zones: ZoneResolver): IcsCalendar {
  const renames = new Map<string, string>();
  const taken = new Set(incoming.timeZones.map((t) => t.tzid));
  const timeZones = incoming.timeZones.map((zone) => {
    if (renames.has(zone.tzid) || knownZone(zone.tzid, zones)) return zone;
    const existing = target.timeZones.find((t) => t.tzid === zone.tzid);
    if (existing === undefined || sameTimeZoneDefinition(existing, zone)) return zone;
    for (let n = 2; ; n++) {
      const name = `${zone.tzid} (${n})`;
      const there = target.timeZones.find((t) => t.tzid === name);
      if ((there === undefined && !taken.has(name)) || (there !== undefined && sameTimeZoneDefinition(there, zone))) {
        renames.set(zone.tzid, name);
        taken.add(name);
        return { ...zone, tzid: name, raw: zone.raw === null ? null : renameTimeZoneText(zone.raw, name) };
      }
    }
  });
  if (renames.size === 0) return incoming;
  const groups = incoming.groups.map((group) => ({
    uid: group.uid,
    master: group.master === null ? null : renameEvent(group.master, renames),
    overrides: group.overrides.map((o) => renameEvent(o, renames)),
  }));
  return { ...incoming, timeZones, groups };
}

// ---------------------------------------------------------------------------
// A new calendar (§3.6)
// ---------------------------------------------------------------------------

/**
 * An empty Thirteen calendar (§3.6): `VERSION:2.0`, Thirteen's `PRODID`,
 * `CALSCALE:GREGORIAN`, `X-WR-CALNAME` and `NAME`, `X-APPLE-CALENDAR-COLOR`
 * (`#RRGGBB`) and `COLOR` (the nearest CSS3 color name), and
 * `X-THIRTEEN-CALENDAR-ID`.
 * @throws RangeError for an empty id or name, or a color that is not `#rrggbb`.
 */
export function newICalendar(calendar: { readonly calendarId: string; readonly name: string; readonly color: string }): IcsCalendar {
  if (!isRecord(calendar)) fail(`Expected { calendarId, name, color }, got ${show(calendar)}`);
  const { calendarId, name } = calendar;
  if (typeof calendarId !== 'string' || calendarId === '') fail(`calendarId must be a non-empty string, got ${show(calendarId)}`);
  if (typeof name !== 'string' || name === '') fail(`name must be a non-empty string, got ${show(name)}`);
  const color = typeof calendar.color === 'string' ? normalizeHexColor(calendar.color) : null;
  if (color === null) fail(`color must be '#rrggbb', got ${show(calendar.color)}`);
  const text = escapeText(name);
  return {
    name,
    color,
    refreshInterval: null,
    groups: [],
    timeZones: [],
    extra: [
      { name: 'VERSION', params: [], value: '2.0' },
      { name: 'PRODID', params: [], value: THIRTEEN_PRODID },
      { name: 'CALSCALE', params: [], value: 'GREGORIAN' },
      { name: 'X-WR-CALNAME', params: [], value: text },
      { name: 'NAME', params: [], value: text },
      { name: 'X-APPLE-CALENDAR-COLOR', params: [], value: color.toUpperCase() },
      { name: 'COLOR', params: [], value: nearestCssColorName(color) },
      { name: 'X-THIRTEEN-CALENDAR-ID', params: [], value: escapeText(calendarId) },
    ],
    warnings: [],
    others: [],
    raw: null,
  };
}

// ---------------------------------------------------------------------------
// All-day ends (§3.1.1)
// ---------------------------------------------------------------------------

/**
 * The `DTEND` or `DURATION` of an all-day event from `first` through `last`
 * (§3.1.1): `DTEND;VALUE=DATE` of the day after `last`, except for an event
 * that ends on 9999-12-31, whose exclusive end would be in year 10000: no
 * `DTEND` when it lasts one day, `DURATION:P{n}D` when it lasts n days.
 * @throws RangeError when `last` is before `first`.
 */
export function allDayEnd(first: GregorianDate, last: GregorianDate): { end: IcsDateValue | null; duration: string | null } {
  assertValidGregorian(first);
  assertValidGregorian(last);
  const days = diffGregorianDays(last, first) + 1;
  if (days < 1) fail(`The last day ${toISODate(last)} is before the first ${toISODate(first)}`);
  if (last.year === 9999 && last.month === 12 && last.day === 31) return { end: null, duration: days === 1 ? null : `P${days}D` };
  return { end: { kind: 'date', date: addGregorianDays(last, 1) }, duration: null };
}

// ---------------------------------------------------------------------------
// Retimed UNTILs (§4.7, §4.9 rule 4)
// ---------------------------------------------------------------------------

const LAST_UTC: LocalDateTime = { date: { year: 9999, month: 12, day: 31 }, minute: 1439 };
const FIRST_UTC: LocalDateTime = { date: { year: 1, month: 1, day: 1 }, minute: 0 };

/**
 * The `UNTIL` that ends a series after `endDate` (§4.4 Ends): the date for an
 * all-day series; 23:59 (written `235959`) of that date in the event's zone,
 * as UTC, for a zoned series (its `DTSTART` zone: IANA, Windows id or the
 * calendar's `VTIMEZONE`; a UTC `DTSTART` counts as UTC); a floating 23:59 for
 * a floating series or an unknown `TZID`.
 */
export function untilFor(endDate: { year: number; month: number; day: number }, event: IcsEvent, calendar: IcsCalendar, zones: ZoneResolver): RRuleUntil {
  const start = event.start;
  if (start.kind === 'date') return { kind: 'date', date: { ...endDate } };
  const local: LocalDateTime = { date: { ...endDate }, minute: 1439 };
  if (start.kind === 'floating') return { kind: 'floating', value: local };
  if (start.kind === 'utc') return { kind: 'utc', value: local };
  const handle = resolveTzid(start.tzid, calendar, zones);
  if (handle.resolver === null) return { kind: 'floating', value: local };
  const utc = zonedToUtc(local, handle.zone ?? handle.tzid, handle.resolver);
  return { kind: 'utc', value: utc ?? (endDate.year >= 9999 ? LAST_UTC : FIRST_UTC) };
}

/**
 * The event with the `UNTIL` of each rule that `retimeExceptions` lists in
 * `untils` rewritten for its end date ({@link untilFor}; §4.7). The rules keep
 * every other part, and the writer changes only their `UNTIL=` part (§4.9
 * rule 4). The event's `raw` text is cleared.
 * @throws RangeError when an entry names a rule the event does not have.
 */
export function withRetimedUntils(event: IcsEvent, untils: readonly UntilRewrite[], calendar: IcsCalendar, zones: ZoneResolver): IcsEvent {
  const rrules: RRule[] = [...event.rrules];
  const exrules: RRule[] = [...event.exrules];
  for (const entry of untils) {
    const list = entry.rule === 'rrule' ? rrules : entry.rule === 'exrule' ? exrules : fail(`Unknown rule kind ${show(entry.rule)}`);
    const rule = list[entry.index];
    if (rule === undefined) fail(`The event has no ${entry.rule} ${entry.index}`);
    list[entry.index] = { ...rule, count: null, until: untilFor(entry.endDate, event, calendar, zones) };
  }
  return { ...event, rrules, exrules, raw: null };
}
