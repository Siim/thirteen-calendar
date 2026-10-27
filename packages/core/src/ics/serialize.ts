/**
 * The `.ics` writer (docs/EVENTS.md §3.6, §5.4): {@link IcsCalendar} to text.
 *
 * - Components with `raw` text (every `VEVENT` and `VTIMEZONE` as read, and
 *   `others`) are written exactly as read, in the order they were read.
 * - An edited event (no `raw`) is serialized: CRLF, lines folded at 75 octets,
 *   the property order of §3.6, and every property of a field the edit did not
 *   change written as read (from its `original` text: seconds, `TZID`
 *   strings, `PERIOD` values, parameters, folding). A rule whose only change
 *   is its end keeps its text and gets a new `COUNT=` or `UNTIL=` part in
 *   place (§4.9 rule 4); `EXDATE`s and `RDATE`s added to those read are written
 *   as new lines after the lines as read.
 * - `VTIMEZONE`s: one per `TZID` the events use. A definition no event uses is
 *   dropped; a missing one is generated with `buildVTimeZone` when the platform
 *   knows the zone (an IANA id or a Windows id); a generated one
 *   (`X-THIRTEEN-GENERATED`) is rebuilt when the years used reach outside its
 *   years. Definitions from other files are never rebuilt.
 * @module
 */

import { MAX_YEAR } from '../gregorian.ts';
import { fail, plainEquals, readOptions, show } from '../internal.ts';
import { expandRecurrence } from '../events/recurrence.ts';
import { type RRule, type RRuleUntil, copyRRule, formatICalDate, formatICalDateTime, formatRRule, weekdayCode } from '../events/rrule.ts';
import { type LocalDateTime, type ZoneResolver, parseLocalDateTime } from '../events/time.ts';
import { nearestCssColorName, normalizeHexColor } from './colors.ts';
import { type SourceProperty, contentLineText, escapeText, foldLine, paramValue, parseContentLine, physicalLines, unfold } from './lexer.ts';
import { type ReadEvent, calendarFields, readEventText, usedTzids } from './parse.ts';
import type { IcsAlarm, IcsCalendar, IcsDateValue, IcsEvent, IcsObservance, IcsProperty, IcsRdate, IcsTimeZone } from './types.ts';
import { dateOfValue, dateValueKey, dateValueParams, dateValueText, formatDurationMinutes, formatUtcOffset, parseDuration, sameDateValue } from './values.ts';
import { buildVTimeZone, windowsZoneToIana } from './zones.ts';

const CRLF = '\r\n';

/** Thirteen's `PRODID` (§3.6). */
export const THIRTEEN_PRODID = '-//Haugas Development OU//Thirteen 1.0//EN';

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const prop = (name: string, value: string, params: readonly (readonly [string, string])[] = []): IcsProperty => ({ name, params, value });
const dateProp = (name: string, value: IcsDateValue): IcsProperty => prop(name, dateValueText(value), dateValueParams(value));

const sameParams = (a: IcsProperty, b: IcsProperty): boolean =>
  a.params.length === b.params.length && a.params.every(([k, v], i) => b.params[i]![0] === k && b.params[i]![1] === v);
const sameProperty = (a: IcsProperty, b: IcsProperty): boolean => a.name === b.name && a.value === b.value && sameParams(a, b);

/** Collects output, reusing source properties as read where they are unchanged. */
class Writer {
  readonly chunks: string[] = [];
  private readonly used = new Set<SourceProperty>();

  line(text: string): void {
    this.chunks.push(`${text}${CRLF}`);
  }

  property(property: IcsProperty): void {
    this.chunks.push(`${foldLine(contentLineText(property))}${CRLF}`);
  }

  /** Writes a source property as read; false when it was already written. */
  source(source: SourceProperty | undefined | null): boolean {
    if (source === undefined || source === null || this.used.has(source)) return false;
    this.used.add(source);
    this.chunks.push(`${source.source}${CRLF}`);
    return true;
  }

  /** Writes `property` as read when an unused source property is the same, else serialized. */
  reuseOrWrite(property: IcsProperty, sources: readonly SourceProperty[]): void {
    const source = sources.find((s) => !this.used.has(s) && sameProperty(s, property));
    if (!this.source(source)) this.property(property);
  }

  text(): string {
    return this.chunks.join('');
  }
}

/** `UNTIL` text with the seconds `formatRRule` writes (`59`, the end of the minute). */
function untilText(until: RRuleUntil): string {
  return until.kind === 'date' ? formatICalDate(until.date) : formatICalDateTime(until.value, 59, until.kind === 'utc');
}

/** A rule without its end, for comparing the rest. */
const withoutEnd = (rule: RRule): RRule => ({ ...copyRRule(rule), count: null, until: null });

/**
 * The text of a stored rule with only its end changed (§4.9 rule 4): the
 * `COUNT=` or `UNTIL=` part replaced in place, removed, or (when the rule had
 * none) inserted after `FREQ=`. Every other part keeps its text and order.
 */
export function patchRuleEnd(text: string, rule: RRule): string {
  const parts = text.split(';');
  const end = rule.until !== null ? `UNTIL=${untilText(rule.until)}` : rule.count !== null ? `COUNT=${rule.count}` : null;
  const name = (part: string) => part.split('=')[0]!.replace(/^RRULE:/i, '').toUpperCase();
  const index = parts.findIndex((p) => name(p) === 'COUNT' || name(p) === 'UNTIL');
  if (index >= 0) {
    if (end === null) parts.splice(index, 1);
    else parts[index] = end;
  } else if (end !== null) {
    const freq = parts.findIndex((p) => name(p) === 'FREQ');
    parts.splice(freq + 1, 0, end);
  }
  return parts.join(';');
}

// ---------------------------------------------------------------------------
// VEVENT
// ---------------------------------------------------------------------------

const rdateKey = (r: IcsRdate) => `${dateValueKey(r.value)}/${r.period ?? ''}`;

/** New `RDATE` or `EXDATE` properties: consecutive values with the same parameters share one line. */
function dateListProps(name: 'RDATE' | 'EXDATE', values: readonly IcsRdate[]): IcsProperty[] {
  const out: IcsProperty[] = [];
  let params: [string, string][] | null = null;
  let texts: string[] = [];
  const flush = () => {
    if (params !== null) out.push(prop(name, texts.join(','), params));
    params = null;
    texts = [];
  };
  for (const r of values) {
    const valueParams = dateValueParams(r.value).filter(([k]) => k !== 'VALUE');
    const next: [string, string][] = r.period !== null ? [['VALUE', 'PERIOD'], ...valueParams] : dateValueParams(r.value);
    const text = r.period !== null ? `${dateValueText(r.value)}/${r.period}` : dateValueText(r.value);
    if (params === null || JSON.stringify(params) !== JSON.stringify(next)) {
      flush();
      params = next;
    }
    texts.push(text);
  }
  flush();
  return out;
}

/** Writes a list property group: as read when unchanged, or the lines as read plus new lines for values added after them. */
function writeDateLists(
  writer: Writer,
  name: 'RDATE' | 'EXDATE',
  values: readonly IcsRdate[],
  read: readonly { readonly prop: SourceProperty; readonly values: readonly IcsRdate[] }[] | null,
): void {
  const readValues = read === null ? [] : read.flatMap((r) => r.values);
  const keepRead = read !== null && readValues.length <= values.length && readValues.every((r, i) => rdateKey(r) === rdateKey(values[i]!));
  if (keepRead) {
    for (const r of read!) writer.source(r.prop);
    for (const p of dateListProps(name, values.slice(readValues.length))) writer.property(p);
    return;
  }
  for (const p of dateListProps(name, values)) writer.property(p);
}

/** Writes the `RRULE`s or `EXRULE`s: as read when unchanged; with only the end patched when only the end changed; else canonical. */
function writeRules(writer: Writer, name: 'RRULE' | 'EXRULE', rules: readonly RRule[], readRules: readonly RRule[], sources: readonly SourceProperty[]): void {
  rules.forEach((rule, i) => {
    const source = sources[i];
    const before = readRules[i];
    if (source !== undefined && before !== undefined && plainEquals(withoutEnd(before), withoutEnd(rule))) {
      if (plainEquals(before, rule)) writer.source(source);
      else writer.property(prop(name, patchRuleEnd(source.value, rule), source.params));
      return;
    }
    writer.property(prop(name, formatRRule(rule)));
  });
}

function writeAlarm(writer: Writer, alarm: IcsAlarm): void {
  writer.line('BEGIN:VALARM');
  writer.property(prop('ACTION', alarm.action));
  const trigger = alarm.trigger;
  if (trigger.kind === 'relative') {
    writer.property(prop('TRIGGER', formatDurationMinutes(trigger.minutes), trigger.related === 'end' ? [['RELATED', 'END']] : []));
  } else {
    writer.property(prop('TRIGGER', dateValueText(trigger.value), [['VALUE', 'DATE-TIME'], ...dateValueParams(trigger.value)]));
  }
  for (const p of alarm.extra) writer.property(p);
  writer.line('END:VALARM');
}

/**
 * Serializes one event (§3.6 property order): `UID`, `RECURRENCE-ID`,
 * `DTSTAMP`, `CREATED`, `LAST-MODIFIED`, `SEQUENCE`, `SUMMARY`, `LOCATION`,
 * `DESCRIPTION`, `URL`, `DTSTART`, `DTEND` or `DURATION`, `RRULE`s, `RDATE`s,
 * `EXDATE`s, `EXRULE`s, `X-THIRTEEN-RULE`, `TRANSP`, `STATUS`, the other
 * properties in their order, `VALARM`s, `X-THIRTEEN-IMPORTED-LAST-MODIFIED`.
 * Properties of fields equal to the `original` text's are written as read.
 */
export function serializeEvent(event: IcsEvent, now: LocalDateTime | null): string {
  const read: ReadEvent | null = event.original === null ? null : readEventText(event.original);
  const before = read?.fields ?? null;
  const writer = new Writer();
  const single = (name: string) => read?.single.get(name) ?? null;
  const keep = (name: string, same: boolean | undefined, property: () => IcsProperty) => {
    if (!(same === true && writer.source(single(name)))) writer.property(property());
  };
  const keepDate = (name: string, value: IcsDateValue | null, old: IcsDateValue | null | undefined) => {
    if (value !== null) keep(name, old !== undefined && sameDateValue(value, old), () => dateProp(name, value));
  };
  /** A text field: written when not empty, and an empty property that was read stays as read (§4.9 rule 1). */
  const keepText = (name: string, value: string, old: string | undefined) => {
    if (value !== '' || (old === '' && single(name) !== null)) keep(name, old === value, () => prop(name, escapeText(value)));
  };

  writer.line('BEGIN:VEVENT');
  keep('UID', before?.uid === event.uid && before.uidDerived === false, () => prop('UID', escapeText(event.uid)));
  keepDate('RECURRENCE-ID', event.recurrenceId, before?.recurrenceId);
  keepDate('DTSTAMP', event.dtstamp ?? (now === null ? null : { kind: 'utc', value: now }), before?.dtstamp);
  keepDate('CREATED', event.created, before?.created);
  keepDate('LAST-MODIFIED', event.lastModified, before?.lastModified);
  keep('SEQUENCE', before !== null && before.sequence === event.sequence && single('SEQUENCE') !== null, () => prop('SEQUENCE', String(event.sequence)));
  keepText('SUMMARY', event.summary, before?.summary);
  keepText('LOCATION', event.location, before?.location);
  keepText('DESCRIPTION', event.description, before?.description);
  if (event.url !== '') keep('URL', before?.url === event.url, () => prop('URL', event.url));
  keepDate('DTSTART', event.start, before?.start);
  if (event.end !== null) {
    keepDate('DTEND', event.end, before?.end);
  } else if (event.duration !== null) {
    if (parseDuration(event.duration) === null) fail(`Invalid DURATION ${show(event.duration)}`);
    const same = before !== null && before.end === null && before.duration === event.duration;
    if (!(same && read!.yearTenThousandEnd !== null && writer.source(read!.yearTenThousandEnd))) {
      keep('DURATION', same, () => prop('DURATION', event.duration!));
    }
  }
  writeRules(writer, 'RRULE', event.rrules, before?.rrules ?? [], read?.rrules ?? []);
  writeDateLists(writer, 'RDATE', event.rdates, read?.rdates ?? null);
  writeDateLists(
    writer,
    'EXDATE',
    event.exdates.map((value) => ({ value, period: null })),
    read === null ? null : read.exdates.map((x) => ({ prop: x.prop, values: x.values.map((value) => ({ value, period: null })) })),
  );
  writeRules(writer, 'EXRULE', event.exrules, before?.exrules ?? [], read?.exrules ?? []);
  if (event.thirteenRule !== null) {
    keep('X-THIRTEEN-RULE', before?.thirteenRule === event.thirteenRule, () => prop('X-THIRTEEN-RULE', event.thirteenRule!, [['VERSION', '1']]));
  }
  if (event.transp !== null) keep('TRANSP', before?.transp === event.transp, () => prop('TRANSP', event.transp!));
  if (event.status !== null) keep('STATUS', before?.status === event.status, () => prop('STATUS', event.status!));
  for (const p of event.extra) writer.reuseOrWrite(p, read?.extra ?? []);
  const unusedAlarms = new Set(before?.alarms.map((_, i) => i) ?? []);
  for (const alarm of event.alarms) {
    const index = [...unusedAlarms].find((i) => plainEquals(before!.alarms[i], alarm));
    if (index === undefined) {
      writeAlarm(writer, alarm);
    } else {
      unusedAlarms.delete(index);
      writer.chunks.push(read!.alarmSources[index]!);
    }
  }
  keepDate('X-THIRTEEN-IMPORTED-LAST-MODIFIED', event.importedLastModified, before?.importedLastModified);
  writer.line('END:VEVENT');
  return writer.text();
}

// ---------------------------------------------------------------------------
// VTIMEZONE
// ---------------------------------------------------------------------------

/** A generated observance rule: `FREQ=YEARLY;BYMONTH=m;BYDAY=nWD[;UNTIL=...]`; any other rule canonically. */
function observanceRuleText(rule: RRule): string {
  const simple =
    rule.freq === 'yearly' &&
    rule.interval === 1 &&
    rule.count === null &&
    rule.byMonth.length === 1 &&
    rule.byDay.length === 1 &&
    rule.byDay[0]!.ordinal !== null &&
    [rule.bySecond, rule.byMinute, rule.byHour, rule.byMonthDay, rule.byYearDay, rule.byWeekNo, rule.bySetPos, rule.extensions].every((l) => l.length === 0) &&
    rule.wkst === null &&
    rule.rscale === null &&
    rule.skip === null;
  if (!simple) return formatRRule(rule);
  const day = rule.byDay[0]!;
  const until = rule.until === null ? '' : `;UNTIL=${rule.until.kind === 'date' ? formatICalDate(rule.until.date) : formatICalDateTime(rule.until.value, 0, rule.until.kind === 'utc')}`;
  return `FREQ=YEARLY;BYMONTH=${rule.byMonth[0]};BYDAY=${day.ordinal}${weekdayCode(day.weekday)}${until}`;
}

function writeObservance(writer: Writer, observance: IcsObservance): void {
  const name = observance.kind === 'daylight' ? 'DAYLIGHT' : 'STANDARD';
  writer.line(`BEGIN:${name}`);
  writer.property(prop('DTSTART', formatICalDateTime(observance.start, 0, false)));
  writer.property(prop('TZOFFSETFROM', formatUtcOffset(observance.offsetFrom)));
  writer.property(prop('TZOFFSETTO', formatUtcOffset(observance.offsetTo)));
  for (const rule of observance.rrules) writer.property(prop('RRULE', observanceRuleText(rule)));
  if (observance.rdates.length > 0) writer.property(prop('RDATE', observance.rdates.map((r) => formatICalDateTime(r, 0, false)).join(',')));
  for (const n of observance.names) writer.property(prop('TZNAME', escapeText(n)));
  writer.line(`END:${name}`);
}

/** A `VTIMEZONE` as text: its `raw` text, or written from its observances (with `X-THIRTEEN-GENERATED` when generated). */
export function serializeTimeZone(timeZone: IcsTimeZone): string {
  if (timeZone.raw !== null) return timeZone.raw.endsWith(CRLF) ? timeZone.raw : `${timeZone.raw}${CRLF}`;
  const writer = new Writer();
  writer.line('BEGIN:VTIMEZONE');
  writer.property(prop('TZID', escapeText(timeZone.tzid)));
  if (timeZone.generated !== null) writer.property(prop('X-THIRTEEN-GENERATED', `${timeZone.generated.first}-${timeZone.generated.last}`));
  for (const observance of timeZone.observances) writeObservance(writer, observance);
  writer.line('END:VTIMEZONE');
  return writer.text();
}

// ---------------------------------------------------------------------------
// Years used (§5.4)
// ---------------------------------------------------------------------------

/** The year of a series' last occurrence: its end, or (open-ended) the later of its start year and `currentYear`, plus one. */
function lastSeriesYear(event: IcsEvent, currentYear: number | null): number {
  const startYear = dateOfValue(event.start).year;
  let last = startYear;
  for (const rule of event.rrules) {
    if (rule.until !== null) {
      last = Math.max(last, rule.until.kind === 'date' ? rule.until.date.year : rule.until.value.date.year);
    } else if (rule.count !== null) {
      const recurrence = { rule: { kind: 'rrule' as const, rrule: withoutEnd(rule) }, end: { kind: 'count' as const, count: rule.count }, extraDates: [], exceptDates: [] };
      const expansion = expandRecurrence(recurrence, dateOfValue(event.start), { from: dateOfValue(event.start), to: { year: MAX_YEAR, month: 12, day: 31 } });
      const lastDate = expansion.occurrences[expansion.occurrences.length - 1];
      if (lastDate !== undefined) last = Math.max(last, lastDate.date.year);
    } else {
      last = Math.max(last, Math.max(startYear, currentYear ?? startYear) + 1);
    }
  }
  return Math.min(last, MAX_YEAR);
}

/** The range of years each `TZID` is used in (§5.4 "years used"). */
function yearsUsed(calendar: IcsCalendar, currentYear: number | null): Map<string, { min: number; max: number }> {
  const ranges = new Map<string, { min: number; max: number }>();
  const add = (tzid: string, year: number) => {
    const range = ranges.get(tzid);
    if (range === undefined) ranges.set(tzid, { min: year, max: year });
    else ranges.set(tzid, { min: Math.min(range.min, year), max: Math.max(range.max, year) });
  };
  const note = (value: IcsDateValue | null) => {
    if (value !== null && value.kind === 'zoned') add(value.tzid, value.value.date.year);
  };
  for (const group of calendar.groups) {
    for (const event of [...(group.master === null ? [] : [group.master]), ...group.overrides]) {
      note(event.start);
      note(event.end);
      note(event.recurrenceId);
      for (const r of event.rdates) note(r.value);
      for (const x of event.exdates) note(x);
      if (event.start.kind === 'zoned' && event.rrules.length > 0) add(event.start.tzid, lastSeriesYear(event, currentYear));
    }
  }
  return ranges;
}

function canGenerate(tzid: string, zones: ZoneResolver): boolean {
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

/** The `TZID` parameters used inside components kept as read in `others` (their definitions are kept, never generated). */
function tzidsOfOthers(calendar: IcsCalendar): Set<string> {
  const out = new Set<string>();
  for (const other of calendar.others) {
    for (const content of unfold(physicalLines(other.raw))) {
      const parsed = parseContentLine(content.text);
      const tzid = parsed === null ? null : paramValue(parsed.params, 'TZID');
      if (tzid !== null && tzid !== '') out.add(tzid);
    }
  }
  return out;
}

/** The `VTIMEZONE`s to write (§5.4): the ones in use, rebuilt or generated as needed. */
function timeZonesToWrite(calendar: IcsCalendar, zones: ZoneResolver, currentYear: number | null): IcsTimeZone[] {
  const used = usedTzids(calendar.groups);
  const usedByOthers = tzidsOfOthers(calendar);
  const years = yearsUsed(calendar, currentYear);
  const out: IcsTimeZone[] = [];
  const have = new Set<string>();
  const build = (tzid: string, line: number | null): IcsTimeZone | null => {
    const range = years.get(tzid);
    if (range === undefined || !canGenerate(tzid, zones)) return null;
    return { ...buildVTimeZone(tzid, [range.min, range.max], zones), line };
  };
  for (const zone of calendar.timeZones) {
    if ((!used.has(zone.tzid) && !usedByOthers.has(zone.tzid)) || have.has(zone.tzid)) continue;
    have.add(zone.tzid);
    const range = years.get(zone.tzid);
    const grown = zone.generated !== null && range !== undefined && (range.min < zone.generated.first || range.max > zone.generated.last);
    out.push((grown ? build(zone.tzid, zone.line) : null) ?? zone);
  }
  for (const tzid of used.keys()) {
    if (have.has(tzid)) continue;
    const zone = build(tzid, null);
    if (zone !== null) out.push(zone);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------

/** Sets a calendar property's value (the first of that name; later ones removed), appends it when missing, or removes it (null). */
function setCalendarProp(props: IcsProperty[], name: string, value: string | null, params: readonly (readonly [string, string])[] = []): void {
  const index = props.findIndex((p) => p.name === name);
  for (let i = props.length - 1; i > index; i--) if (props[i]!.name === name) props.splice(i, 1);
  if (value === null) {
    if (index >= 0) props.splice(index, 1);
    return;
  }
  if (index >= 0) props[index] = prop(name, value, params);
  else props.push(prop(name, value, params));
}

/** The calendar properties to write: `extra`, with `VERSION` and `PRODID` ensured and the field properties set where the fields changed. */
function calendarProps(calendar: IcsCalendar): IcsProperty[] {
  const props = calendar.extra.map((p) => prop(p.name, p.value, p.params));
  if (!props.some((p) => p.name === 'PRODID')) props.unshift(prop('PRODID', THIRTEEN_PRODID));
  if (!props.some((p) => p.name === 'VERSION')) props.unshift(prop('VERSION', '2.0'));
  const derived = calendarFields(props);
  if (calendar.name !== derived.name) {
    const value = calendar.name === null ? null : escapeText(calendar.name);
    setCalendarProp(props, 'X-WR-CALNAME', value);
    setCalendarProp(props, 'NAME', value);
  }
  const color = calendar.color === null ? null : normalizeHexColor(calendar.color);
  if (calendar.color !== null && color === null) fail(`Calendar color must be '#rrggbb', got ${show(calendar.color)}`);
  if (color !== derived.color) {
    setCalendarProp(props, 'X-APPLE-CALENDAR-COLOR', color === null ? null : color.toUpperCase());
    setCalendarProp(props, 'COLOR', color === null ? null : nearestCssColorName(color));
  }
  if (calendar.refreshInterval !== derived.refreshInterval) {
    if (calendar.refreshInterval !== null && parseDuration(calendar.refreshInterval) === null) {
      fail(`Calendar refreshInterval must be a duration such as 'PT6H', got ${show(calendar.refreshInterval)}`);
    }
    setCalendarProp(props, 'REFRESH-INTERVAL', calendar.refreshInterval, [['VALUE', 'DURATION']]);
    setCalendarProp(props, 'X-PUBLISHED-TTL', calendar.refreshInterval);
  }
  return props;
}

/** The source properties of a calendar's `raw` property lines. */
function rawCalendarProps(raw: string | null): SourceProperty[] {
  if (raw === null) return [];
  const lines = physicalLines(raw);
  const out: SourceProperty[] = [];
  for (const content of unfold(lines)) {
    const parsed = parseContentLine(content.text);
    if (parsed === null) continue;
    out.push({ ...parsed, source: lines.slice(content.first, content.last + 1).join(CRLF), line: content.first + 1 });
  }
  return out;
}

function assertCalendar(calendar: unknown): asserts calendar is IcsCalendar {
  const c = calendar as Partial<Record<keyof IcsCalendar, unknown>> | null;
  if (typeof c !== 'object' || c === null) fail(`Expected an IcsCalendar, got ${show(calendar)}`);
  for (const key of ['groups', 'timeZones', 'extra', 'others'] as const) {
    if (!Array.isArray(c[key])) fail(`IcsCalendar ${key} must be an array, got ${show(c[key])}`);
  }
}

interface Placed {
  /** The line it was read on, or the line it is placed after. */
  readonly line: number;
  /** `true` when placed after `line` (it has no line of its own). */
  readonly after: boolean;
  readonly rank: number;
  readonly text: string;
}

/**
 * Writes a calendar (§5.4): `BEGIN:VCALENDAR`, its properties (as read where
 * unchanged), then its components in the order they were read: `VTIMEZONE`s,
 * UID group members and `others` with a `line` by that line; a group member
 * without one right after the last member of its group that has one (new
 * groups at the end, in `groups` order); a new or generated `VTIMEZONE`
 * after the last `VTIMEZONE` as read (or before the first component).
 *
 * `now` (`YYYY-MM-DDTHH:MM`, UTC) is the `DTSTAMP` of serialized events that
 * have none, and its year is the "current year" of the years used by series
 * without an end (without `now`, their start year).
 * @throws RangeError for an invalid calendar or option.
 */
export function serializeICalendar(calendar: IcsCalendar, zones: ZoneResolver, options?: { now?: string }): string {
  assertCalendar(calendar);
  const opts = readOptions(options, ['now'], 'serializeICalendar');
  const now = opts.now === undefined ? null : parseLocalDateTime(opts.now as string);
  if (now !== null && now.minute === 1440) fail(`serializeICalendar option 'now' must not be 24:00`);

  const placed: Placed[] = [];
  let rank = 0;
  const zonesWritten = timeZonesToWrite(calendar, zones, now === null ? null : now.date.year);
  const positionedLines = [
    ...zonesWritten.flatMap((z) => (z.line === null ? [] : [z.line])),
    ...calendar.groups.flatMap((g) => [g.master, ...g.overrides].flatMap((e) => (e === null || e.line === null ? [] : [e.line]))),
    ...calendar.others.flatMap((o) => (o.line === null ? [] : [o.line])),
  ];
  const lastZoneLine = Math.max(...zonesWritten.flatMap((z) => (z.line === null ? [] : [z.line])), Number.NEGATIVE_INFINITY);
  const firstLine = Math.min(...positionedLines, Number.POSITIVE_INFINITY);
  const newZoneLine = lastZoneLine !== Number.NEGATIVE_INFINITY ? lastZoneLine : firstLine === Number.POSITIVE_INFINITY ? Number.NEGATIVE_INFINITY : firstLine - 0.5;

  const withEnd = (text: string) => (text.endsWith(CRLF) ? text : `${text}${CRLF}`);
  for (const zone of zonesWritten) {
    placed.push({ line: zone.line ?? newZoneLine, after: zone.line === null, rank: rank++, text: serializeTimeZone(zone) });
  }
  calendar.groups.forEach((group) => {
    const members = [...(group.master === null ? [] : [group.master]), ...group.overrides];
    const lines = members.flatMap((m) => (m.line === null ? [] : [m.line]));
    const groupLine = lines.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...lines);
    for (const member of members) {
      const text = member.raw !== null ? withEnd(member.raw) : serializeEvent(member, now);
      placed.push({ line: member.line ?? groupLine, after: member.line === null, rank: rank++, text });
    }
  });
  for (const other of calendar.others) {
    placed.push({ line: other.line ?? Number.POSITIVE_INFINITY, after: other.line === null, rank: rank++, text: withEnd(other.raw) });
  }
  placed.sort((a, b) => (a.line !== b.line ? (a.line < b.line ? -1 : 1) : a.after !== b.after ? (a.after ? 1 : -1) : a.rank - b.rank));

  const writer = new Writer();
  writer.line('BEGIN:VCALENDAR');
  const sources = rawCalendarProps(calendar.raw);
  for (const p of calendarProps(calendar)) writer.reuseOrWrite(p, sources);
  for (const item of placed) writer.chunks.push(item.text);
  writer.line('END:VCALENDAR');
  return writer.text();
}
