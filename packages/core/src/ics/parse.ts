/**
 * The `.ics` reader (docs/EVENTS.md §5.4): calendar text to {@link IcsCalendar}.
 *
 * Tolerant: every line end, a byte order mark, folds, lowercase names, quoted
 * parameters and several `VCALENDAR`s in one text (merged) are accepted, and a
 * component or property that cannot be read produces a warning while parsing
 * continues. Nothing is lost: every `VEVENT` and `VTIMEZONE` keeps the exact
 * text it was read from (`raw`), a property the reader does not model or
 * cannot read stays in `extra`, and a component it skips (`VTODO`, a `VEVENT`
 * without `DTSTART`, an exact duplicate) is kept in `others`, so writing the
 * calendar back gives the text that was read (with CRLF line ends).
 * @module
 */

import { compareGregorian, diffGregorianDays } from '../gregorian.ts';
import { fail, readOptions, show } from '../internal.ts';
import { type RRule, parseRRule } from '../events/rrule.ts';
import type { LocalDateTime, ZoneResolver } from '../events/time.ts';
import { cssColorHex, normalizeHexColor } from './colors.ts';
import { type SourceProperty, paramValue, parseContentLine, physicalLines, unescapeText, unfold } from './lexer.ts';
import { sha256Hex } from './sha256.ts';
import type {
  IcsAlarm,
  IcsCalendar,
  IcsDateValue,
  IcsEvent,
  IcsGroup,
  IcsObservance,
  IcsOtherComponent,
  IcsProperty,
  IcsRdate,
  IcsTimeZone,
  IcsTrigger,
  IcsWarning,
} from './types.ts';
import { dateValueKey, durationMinutes, parseDuration, parseUtcOffset, readDateValue } from './values.ts';
import { resolveTzid } from './zones.ts';

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** A component as tokenized: its own properties, its children and the physical lines it spans. */
export interface RawComponent {
  readonly name: string;
  readonly first: number;
  last: number;
  closed: boolean;
  readonly props: SourceProperty[];
  readonly children: RawComponent[];
}

/** Components that live directly in a `VCALENDAR` and never inside another one. */
const TOP_LEVEL = new Set(['VEVENT', 'VTODO', 'VJOURNAL', 'VFREEBUSY', 'VTIMEZONE', 'VAVAILABILITY']);

interface Tokenized {
  readonly lines: readonly string[];
  readonly calendars: number;
  readonly calendarProps: SourceProperty[];
  readonly components: RawComponent[];
}

/** Collects warnings in reading order. */
class Warnings {
  readonly list: IcsWarning[] = [];
  add(line: number, code: IcsWarning['code'], detail: string): void {
    this.list.push({ line, code, detail });
  }
}

function sourceProperty(lines: readonly string[], first: number, last: number, parsed: IcsProperty): SourceProperty {
  return { name: parsed.name, params: parsed.params, value: parsed.value, source: lines.slice(first, last + 1).join('\r\n'), line: first + 1 };
}

/**
 * Splits a text into `VCALENDAR` properties and top-level components. A
 * component that is still open when another top-level component, an
 * `END:VCALENDAR` or the end of the text arrives is closed as unclosed.
 */
export function tokenize(text: string, warnings: Warnings): Tokenized {
  const lines = physicalLines(text);
  const calendarProps: SourceProperty[] = [];
  const components: RawComponent[] = [];
  const stack: RawComponent[] = [];
  let inCalendar = false;
  let calendars = 0;

  const closeUnclosed = (last: number) => {
    for (const component of stack) {
      component.last = Math.max(component.first, last);
      warnings.add(component.first + 1, 'unclosed-component', `BEGIN:${component.name} has no END:${component.name}`);
    }
    stack.length = 0;
  };

  for (const content of unfold(lines)) {
    const line = content.first + 1;
    const parsed = parseContentLine(content.text);
    if (parsed === null) {
      warnings.add(line, 'bad-line', `Not a content line: ${show(content.text.slice(0, 60))}`);
      continue;
    }
    if (parsed.name === 'BEGIN' || parsed.name === 'END') {
      const name = parsed.value.trim().toUpperCase();
      if (parsed.name === 'BEGIN') {
        if (name === 'VCALENDAR') {
          closeUnclosed(content.first - 1);
          inCalendar = true;
          calendars++;
          continue;
        }
        if (!inCalendar) {
          warnings.add(line, 'bad-line', `BEGIN:${name} outside a VCALENDAR`);
          continue;
        }
        if (stack.length > 0 && TOP_LEVEL.has(name)) closeUnclosed(content.first - 1);
        const component: RawComponent = { name, first: content.first, last: content.last, closed: false, props: [], children: [] };
        if (stack.length > 0) stack[stack.length - 1]!.children.push(component);
        else components.push(component);
        stack.push(component);
        continue;
      }
      if (name === 'VCALENDAR') {
        closeUnclosed(content.first - 1);
        inCalendar = false;
        continue;
      }
      let index = stack.length - 1;
      while (index >= 0 && stack[index]!.name !== name) index--;
      if (index < 0) {
        warnings.add(line, 'bad-line', `END:${name} without BEGIN:${name}`);
        continue;
      }
      while (stack.length > index + 1) {
        const inner = stack.pop()!;
        inner.last = content.first - 1;
        warnings.add(inner.first + 1, 'unclosed-component', `BEGIN:${inner.name} has no END:${inner.name}`);
      }
      const component = stack.pop()!;
      component.last = content.last;
      component.closed = true;
      continue;
    }
    if (!inCalendar) {
      warnings.add(line, 'bad-line', `${parsed.name} outside a VCALENDAR`);
      continue;
    }
    const property = sourceProperty(lines, content.first, content.last, parsed);
    if (stack.length > 0) stack[stack.length - 1]!.props.push(property);
    else if (calendars === 1) calendarProps.push(property);
  }
  closeUnclosed(lines.length - 1);
  return { lines, calendars, calendarProps, components };
}

/** The physical text of a component, CRLF line ends, with a final CRLF. */
function componentText(lines: readonly string[], component: RawComponent): string {
  return `${lines.slice(component.first, component.last + 1).join('\r\n')}\r\n`;
}

/** The unfolded content of a component, for finding exact duplicates. */
function componentContent(lines: readonly string[], component: RawComponent): string {
  return unfold(lines, component.first, component.last)
    .map((c) => c.text)
    .join('\n');
}

/** The unfolded text of a source property. */
export function unfoldedSource(property: SourceProperty): string {
  return property.source
    .split('\r\n')
    .map((line, i) => (i === 0 ? line : line.slice(1)))
    .join('');
}

const plainProperty = (p: IcsProperty): IcsProperty => ({ name: p.name, params: p.params.map(([k, v]) => [k, v] as const), value: p.value });

// ---------------------------------------------------------------------------
// VEVENT
// ---------------------------------------------------------------------------

/** The fields of a `VEVENT` and the source properties behind them (the writer reuses them for untouched fields). */
export interface ReadEvent {
  readonly fields: Omit<IcsEvent, 'raw' | 'original' | 'line'>;
  /** The source property of each single-valued field that was read. */
  readonly single: ReadonlyMap<string, SourceProperty>;
  /** `DTEND;VALUE=DATE:10000101` read as an end of 9999-12-31 (§3.1.1). */
  readonly yearTenThousandEnd: SourceProperty | null;
  readonly rrules: readonly SourceProperty[];
  readonly exrules: readonly SourceProperty[];
  readonly rdates: readonly { readonly prop: SourceProperty; readonly values: readonly IcsRdate[] }[];
  readonly exdates: readonly { readonly prop: SourceProperty; readonly values: readonly IcsDateValue[] }[];
  /** Parallel to `fields.extra`. */
  readonly extra: readonly SourceProperty[];
  /** Parallel to `fields.alarms`: each alarm's text as read. */
  readonly alarmSources: readonly string[];
}

/** Properties with one value per event; a repeated one is kept in `extra`. */
const SINGLE = new Set([
  'UID',
  'RECURRENCE-ID',
  'SEQUENCE',
  'SUMMARY',
  'LOCATION',
  'DESCRIPTION',
  'URL',
  'DTSTART',
  'DTEND',
  'DURATION',
  'STATUS',
  'TRANSP',
  'X-THIRTEEN-RULE',
  'CREATED',
  'LAST-MODIFIED',
  'DTSTAMP',
  'X-THIRTEEN-IMPORTED-LAST-MODIFIED',
]);

const DATE_FIELDS = ['RECURRENCE-ID', 'CREATED', 'LAST-MODIFIED', 'DTSTAMP', 'X-THIRTEEN-IMPORTED-LAST-MODIFIED'] as const;

/** The text `10000101` read as a date. */
const YEAR_1000 = { year: 1000, month: 1, day: 1 } as const;

/** Reads the values of an `RDATE` (dates, date-times or `VALUE=PERIOD`); null when one does not parse. */
function readRdates(prop: IcsProperty): IcsRdate[] | null {
  const isPeriod = paramValue(prop.params, 'VALUE')?.toUpperCase() === 'PERIOD';
  const out: IcsRdate[] = [];
  for (const part of prop.value.split(',')) {
    if (isPeriod) {
      const slash = part.indexOf('/');
      if (slash < 0) return null;
      const value = readDateValue(part.slice(0, slash), prop.params);
      const period = part.slice(slash + 1).trim();
      if (value === null || value.kind === 'date' || period === '') return null;
      if (readDateValue(period, prop.params) === null && parseDuration(period) === null) return null;
      out.push({ value, period });
    } else {
      const value = readDateValue(part, prop.params);
      if (value === null) return null;
      out.push({ value, period: null });
    }
  }
  return out;
}

function readExdates(prop: IcsProperty): IcsDateValue[] | null {
  const out: IcsDateValue[] = [];
  for (const part of prop.value.split(',')) {
    const value = readDateValue(part, prop.params);
    if (value === null) return null;
    out.push(value);
  }
  return out;
}

function readTrigger(prop: IcsProperty): IcsTrigger | null {
  if (paramValue(prop.params, 'VALUE')?.toUpperCase() === 'DATE-TIME') {
    const value = readDateValue(prop.value, prop.params);
    return value === null || value.kind === 'date' ? null : { kind: 'absolute', value };
  }
  const duration = parseDuration(prop.value);
  if (duration === null) return null;
  const related = paramValue(prop.params, 'RELATED')?.toUpperCase() === 'END' ? 'end' : 'start';
  return { kind: 'relative', minutes: durationMinutes(duration), related };
}

function readAlarm(component: RawComponent, lines: readonly string[], warnings: Warnings): { alarm: IcsAlarm; source: string } | null {
  let action: string | null = null;
  let trigger: IcsTrigger | null = null;
  const extra: IcsProperty[] = [];
  for (const prop of component.props) {
    if (prop.name === 'ACTION' && action === null) {
      action = prop.value.trim().toUpperCase();
    } else if (prop.name === 'TRIGGER' && trigger === null) {
      trigger = readTrigger(prop);
      if (trigger === null) warnings.add(prop.line, 'bad-line', `Unreadable TRIGGER ${show(prop.value)}`);
    } else {
      extra.push(plainProperty(prop));
    }
  }
  if (trigger === null) {
    warnings.add(component.first + 1, 'skipped-component', 'VALARM without a readable TRIGGER');
    return null;
  }
  return { alarm: { action: action ?? '', trigger, extra }, source: componentText(lines, component) };
}

/**
 * Reads one `VEVENT`. Returns null (with a warning) when it has no readable
 * `DTSTART`; such a component is kept in `others` by the caller.
 */
export function readEvent(component: RawComponent, lines: readonly string[], calendarId: string, warnings: Warnings): ReadEvent | null {
  const single = new Map<string, SourceProperty>();
  const extra: SourceProperty[] = [];
  const rrules: SourceProperty[] = [];
  const exrules: SourceProperty[] = [];
  const rdates: { prop: SourceProperty; values: IcsRdate[] }[] = [];
  const exdates: { prop: SourceProperty; values: IcsDateValue[] }[] = [];
  const parsedRules: RRule[] = [];
  const parsedExrules: RRule[] = [];
  const dates = new Map<string, IcsDateValue>();
  let start: IcsDateValue | null = null;
  let startBad = false;
  let end: IcsDateValue | null = null;
  let yearTenThousandEnd: SourceProperty | null = null;
  let duration: string | null = null;
  let sequence = 0;

  const toExtra = (prop: SourceProperty) => extra.push(prop);
  for (const prop of component.props) {
    const name = prop.name;
    if (SINGLE.has(name)) {
      if (single.has(name) || (name === 'DTEND' && yearTenThousandEnd !== null)) {
        toExtra(prop);
        continue;
      }
      switch (name) {
        case 'DTSTART':
          start = readDateValue(prop.value, prop.params);
          if (start === null) {
            startBad = true;
            warnings.add(prop.line, 'bad-date', `Unreadable DTSTART ${show(prop.value)}`);
            toExtra(prop);
            continue;
          }
          break;
        case 'DTEND':
          if (prop.value.trim() === '10000101' && (paramValue(prop.params, 'VALUE')?.toUpperCase() ?? 'DATE') === 'DATE') {
            yearTenThousandEnd = prop;
            continue;
          }
          end = readDateValue(prop.value, prop.params);
          if (end === null) {
            warnings.add(prop.line, 'bad-date', `Unreadable DTEND ${show(prop.value)}`);
            toExtra(prop);
            continue;
          }
          break;
        case 'DURATION':
          if (parseDuration(prop.value) === null) {
            warnings.add(prop.line, 'bad-line', `Unreadable DURATION ${show(prop.value)}`);
            toExtra(prop);
            continue;
          }
          duration = prop.value.trim();
          break;
        case 'SEQUENCE':
          if (!/^\s*\d{1,9}\s*$/.test(prop.value)) {
            warnings.add(prop.line, 'bad-line', `Unreadable SEQUENCE ${show(prop.value)}`);
            toExtra(prop);
            continue;
          }
          sequence = Number(prop.value.trim());
          break;
        case 'X-THIRTEEN-RULE': {
          const version = paramValue(prop.params, 'VERSION');
          if (version !== null && version !== '1') {
            toExtra(prop);
            continue;
          }
          break;
        }
        default:
          if ((DATE_FIELDS as readonly string[]).includes(name)) {
            const value = readDateValue(prop.value, prop.params);
            if (value === null) {
              warnings.add(prop.line, 'bad-date', `Unreadable ${name} ${show(prop.value)}`);
              toExtra(prop);
              continue;
            }
            dates.set(name, value);
          }
      }
      single.set(name, prop);
      continue;
    }
    if (name === 'RRULE' || name === 'EXRULE') {
      try {
        const rule = parseRRule(prop.value.trim());
        (name === 'RRULE' ? parsedRules : parsedExrules).push(rule);
        (name === 'RRULE' ? rrules : exrules).push(prop);
      } catch (error) {
        warnings.add(prop.line, 'bad-rrule', (error as Error).message);
        toExtra(prop);
      }
      continue;
    }
    if (name === 'RDATE') {
      const values = readRdates(prop);
      if (values === null) {
        warnings.add(prop.line, 'bad-date', `Unreadable RDATE ${show(prop.value)}`);
        toExtra(prop);
      } else {
        rdates.push({ prop, values });
      }
      continue;
    }
    if (name === 'EXDATE') {
      const values = readExdates(prop);
      if (values === null) {
        warnings.add(prop.line, 'bad-date', `Unreadable EXDATE ${show(prop.value)}`);
        toExtra(prop);
      } else {
        exdates.push({ prop, values });
      }
      continue;
    }
    toExtra(prop);
  }

  if (start === null) {
    if (!startBad) warnings.add(component.first + 1, 'missing-dtstart', 'VEVENT without DTSTART');
    return null;
  }
  if (yearTenThousandEnd !== null) {
    if (start.kind === 'date' && compareGregorian(start.date, YEAR_1000) > 0) {
      // DTEND;VALUE=DATE:10000101 after a start in year 1000 or later ends the event with 9999-12-31
      // (§3.1.1): the same event as DURATION:P{n}D. As January 1 of year 1000 it would end before it began.
      if (duration !== null) {
        const durationProp = single.get('DURATION')!;
        warnings.add(durationProp.line, 'bad-line', 'DURATION next to DTEND is ignored');
        single.delete('DURATION');
        extra.push(durationProp);
      }
      duration = `P${diffGregorianDays({ year: 9999, month: 12, day: 31 }, start.date) + 1}D`;
    } else {
      end = { kind: 'date', date: { ...YEAR_1000 } };
      single.set('DTEND', yearTenThousandEnd);
      yearTenThousandEnd = null;
    }
  }
  if (end !== null && duration !== null && yearTenThousandEnd === null) {
    const durationProp = single.get('DURATION')!;
    warnings.add(durationProp.line, 'bad-line', 'DURATION next to DTEND is ignored');
    single.delete('DURATION');
    extra.push(durationProp);
    duration = null;
  }

  const text = (name: string) => (single.has(name) ? unescapeText(single.get(name)!.value) : '');
  const upper = (name: string) => (single.has(name) ? single.get(name)!.value.trim().toUpperCase() : null);
  let uid = single.has('UID') ? unescapeText(single.get('UID')!.value) : null;
  let uidDerived = false;
  if (uid === null || uid === '') {
    const dtstart = single.get('DTSTART')!;
    uid = `missing-${sha256Hex(`${calendarId}\n${unfoldedSource(dtstart)}\n${text('SUMMARY')}`).slice(0, 32)}`;
    uidDerived = true;
    warnings.add(component.first + 1, 'missing-uid', `VEVENT without UID; derived ${uid}`);
  }

  const alarms: IcsAlarm[] = [];
  const alarmSources: string[] = [];
  for (const child of component.children) {
    if (child.name !== 'VALARM') {
      warnings.add(child.first + 1, 'skipped-component', `${child.name} inside a VEVENT is not read`);
      continue;
    }
    const read = readAlarm(child, lines, warnings);
    if (read !== null) {
      alarms.push(read.alarm);
      alarmSources.push(read.source);
    }
  }

  return {
    fields: {
      uid,
      uidDerived,
      recurrenceId: dates.get('RECURRENCE-ID') ?? null,
      sequence,
      summary: text('SUMMARY'),
      location: text('LOCATION'),
      description: text('DESCRIPTION'),
      url: single.has('URL') ? single.get('URL')!.value.trim() : '',
      start,
      end,
      duration,
      rrules: parsedRules,
      exrules: parsedExrules,
      rdates: rdates.flatMap((r) => r.values),
      exdates: exdates.flatMap((r) => r.values),
      status: upper('STATUS'),
      transp: upper('TRANSP'),
      thirteenRule: single.has('X-THIRTEEN-RULE') ? single.get('X-THIRTEEN-RULE')!.value.trim() : null,
      alarms,
      created: dates.get('CREATED') ?? null,
      lastModified: dates.get('LAST-MODIFIED') ?? null,
      dtstamp: dates.get('DTSTAMP') ?? null,
      importedLastModified: dates.get('X-THIRTEEN-IMPORTED-LAST-MODIFIED') ?? null,
      extra: extra.map(plainProperty),
    },
    single,
    yearTenThousandEnd,
    rrules,
    exrules,
    rdates,
    exdates,
    extra,
    alarmSources,
  };
}

/**
 * Reads a single `VEVENT` text (as kept in `raw` or `original`) back into
 * fields and source properties; null when it is not a readable `VEVENT`.
 * @internal
 */
export function readEventText(text: string, calendarId = ''): ReadEvent | null {
  const warnings = new Warnings();
  const lines = physicalLines(text);
  const contents = unfold(lines);
  const stack: RawComponent[] = [];
  let root: RawComponent | null = null;
  for (const content of contents) {
    const parsed = parseContentLine(content.text);
    if (parsed === null) continue;
    if (parsed.name === 'BEGIN') {
      const component: RawComponent = { name: parsed.value.trim().toUpperCase(), first: content.first, last: content.last, closed: false, props: [], children: [] };
      if (stack.length > 0) stack[stack.length - 1]!.children.push(component);
      else root ??= component;
      stack.push(component);
    } else if (parsed.name === 'END') {
      const component = stack.pop();
      if (component !== undefined) {
        component.last = content.last;
        component.closed = true;
      }
    } else if (stack.length > 0) {
      stack[stack.length - 1]!.props.push(sourceProperty(lines, content.first, content.last, parsed));
    }
  }
  if (root === null || root.name !== 'VEVENT') return null;
  return readEvent(root, lines, calendarId, warnings);
}

// ---------------------------------------------------------------------------
// VTIMEZONE
// ---------------------------------------------------------------------------

function readObservance(component: RawComponent, warnings: Warnings): IcsObservance | null {
  let start: LocalDateTime | null = null;
  let offsetFrom: number | null = null;
  let offsetTo: number | null = null;
  const rrules: RRule[] = [];
  const rdates: LocalDateTime[] = [];
  const names: string[] = [];
  for (const prop of component.props) {
    switch (prop.name) {
      case 'DTSTART': {
        const value = readDateValue(prop.value, prop.params);
        if (value !== null) start = value.kind === 'date' ? { date: value.date, minute: 0 } : value.value;
        break;
      }
      case 'TZOFFSETFROM':
        offsetFrom = parseUtcOffset(prop.value);
        break;
      case 'TZOFFSETTO':
        offsetTo = parseUtcOffset(prop.value);
        break;
      case 'RRULE':
        try {
          rrules.push(parseRRule(prop.value.trim()));
        } catch (error) {
          warnings.add(prop.line, 'bad-rrule', (error as Error).message);
        }
        break;
      case 'RDATE':
        for (const part of prop.value.split(',')) {
          const value = readDateValue(part.split('/')[0]!, prop.params);
          if (value !== null) rdates.push(value.kind === 'date' ? { date: value.date, minute: 0 } : value.value);
        }
        break;
      case 'TZNAME':
        names.push(unescapeText(prop.value));
        break;
    }
  }
  if (start === null || offsetFrom === null || offsetTo === null) {
    warnings.add(component.first + 1, 'skipped-component', `${component.name} without a readable DTSTART, TZOFFSETFROM and TZOFFSETTO`);
    return null;
  }
  return { kind: component.name === 'DAYLIGHT' ? 'daylight' : 'standard', start, offsetFrom, offsetTo, rrules, rdates, names };
}

/** Reads a `VTIMEZONE`; null (with a warning) when it has no `TZID`. */
function readTimeZone(component: RawComponent, lines: readonly string[], warnings: Warnings): IcsTimeZone | null {
  const tzidProp = component.props.find((p) => p.name === 'TZID');
  if (tzidProp === undefined || unescapeText(tzidProp.value).trim() === '') {
    warnings.add(component.first + 1, 'skipped-component', 'VTIMEZONE without TZID');
    return null;
  }
  const generatedProp = component.props.find((p) => p.name === 'X-THIRTEEN-GENERATED');
  const range = generatedProp === undefined ? null : /^\s*(\d{1,4})-(\d{1,4})\s*$/.exec(generatedProp.value);
  const observances: IcsObservance[] = [];
  for (const child of component.children) {
    if (child.name !== 'STANDARD' && child.name !== 'DAYLIGHT') continue;
    const observance = readObservance(child, warnings);
    if (observance !== null) observances.push(observance);
  }
  return {
    tzid: unescapeText(tzidProp.value).trim(),
    observances,
    raw: componentText(lines, component),
    generated: range === null ? null : { first: Number(range[1]), last: Number(range[2]) },
    line: component.first + 1,
  };
}

// ---------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------

/** The key of an event inside its UID group: the master, or its `RECURRENCE-ID`. */
export function memberKey(event: Pick<IcsEvent, 'recurrenceId'>): string {
  return event.recurrenceId === null ? 'master' : dateValueKey(event.recurrenceId);
}

/** Calendar fields from its properties (§5.4): name, color and refresh interval. */
export function calendarFields(props: readonly IcsProperty[]): { name: string | null; color: string | null; refreshInterval: string | null } {
  const first = (name: string) => props.find((p) => p.name === name) ?? null;
  const nameProp = first('X-WR-CALNAME') ?? first('NAME');
  const appleColor = first('X-APPLE-CALENDAR-COLOR');
  const cssColor = first('COLOR');
  const refresh = first('REFRESH-INTERVAL') ?? first('X-PUBLISHED-TTL');
  const color = (appleColor === null ? null : normalizeHexColor(appleColor.value)) ?? (cssColor === null ? null : cssColorHex(cssColor.value));
  return {
    name: nameProp === null ? null : unescapeText(nameProp.value),
    color,
    refreshInterval: refresh === null ? null : refresh.value.trim(),
  };
}

/** Every `TZID` the events use, with the line of its first use. */
export function usedTzids(groups: readonly IcsGroup[]): Map<string, number> {
  const used = new Map<string, number>();
  const note = (value: IcsDateValue | null, line: number | null) => {
    if (value !== null && value.kind === 'zoned' && !used.has(value.tzid)) used.set(value.tzid, line ?? 0);
  };
  for (const group of groups) {
    for (const event of [...(group.master === null ? [] : [group.master]), ...group.overrides]) {
      note(event.start, event.line);
      note(event.end, event.line);
      note(event.recurrenceId, event.line);
      for (const r of event.rdates) note(r.value, event.line);
      for (const x of event.exdates) note(x, event.line);
    }
  }
  return used;
}

/**
 * Reads an iCalendar text (§5.4). `calendarId` seeds the derived UIDs of
 * components without one (`missing-` and the first 32 hex digits of the
 * SHA-256 of `{calendarId}\n{DTSTART line as read, unfolded}\n{SUMMARY text}`,
 * §2.17). With `zones`, a `TZID` that resolves to nothing (§5.4 order) gets an
 * `unknown-tzid` warning.
 *
 * UID groups: the first master of a UID and every override of it form one
 * group; a second master starts another group with the same UID, and a second
 * override of one `RECURRENCE-ID` stays in the group (both with a
 * `duplicate-uid` warning; `eventsFromCalendar` gives their keys `#2`, `#3`).
 * A component that repeats an earlier one of its UID exactly is kept in
 * `others`, not in a group.
 * @throws RangeError only when the text has no `VCALENDAR` at all, or for bad options.
 */
export function parseICalendar(text: string, options?: { calendarId?: string; zones?: ZoneResolver }): IcsCalendar {
  if (typeof text !== 'string') fail(`Calendar text must be a string, got ${show(text)}`);
  const opts = readOptions(options, ['calendarId', 'zones'], 'parseICalendar');
  const calendarId = opts.calendarId ?? '';
  if (typeof calendarId !== 'string') fail(`parseICalendar option 'calendarId' must be a string, got ${show(calendarId)}`);
  const zones = opts.zones as ZoneResolver | undefined;

  const warnings = new Warnings();
  const tokens = tokenize(text, warnings);
  if (tokens.calendars === 0) fail('This text has no VCALENDAR');
  const { lines } = tokens;

  const timeZones: IcsTimeZone[] = [];
  const others: IcsOtherComponent[] = [];
  const builders: { uid: string; master: IcsEvent | null; overrides: IcsEvent[] }[] = [];
  const byUid = new Map<string, number[]>();
  const contents = new Map<string, Set<string>>();

  const other = (component: RawComponent) => others.push({ name: component.name, raw: componentText(lines, component), line: component.first + 1 });

  for (const component of tokens.components) {
    if (!component.closed) {
      other(component);
      continue;
    }
    if (component.name === 'VTIMEZONE') {
      const zone = readTimeZone(component, lines, warnings);
      if (zone === null) other(component);
      else timeZones.push(zone);
      continue;
    }
    if (component.name !== 'VEVENT') {
      warnings.add(component.first + 1, 'skipped-component', `${component.name} is not read`);
      other(component);
      continue;
    }
    const read = readEvent(component, lines, calendarId, warnings);
    if (read === null) {
      other(component);
      continue;
    }
    const raw = componentText(lines, component);
    const event: IcsEvent = { ...read.fields, raw, original: raw, line: component.first + 1 };
    const content = componentContent(lines, component);
    const seen = contents.get(event.uid) ?? new Set<string>();
    contents.set(event.uid, seen);
    if (seen.has(content)) {
      warnings.add(event.line!, 'duplicate-uid', `An exact copy of an earlier component of UID ${event.uid} is kept as read but not shown`);
      other(component);
      continue;
    }
    seen.add(content);
    const indexes = byUid.get(event.uid) ?? [];
    byUid.set(event.uid, indexes);
    if (event.recurrenceId === null) {
      const open = indexes.map((i) => builders[i]!).find((b) => b.master === null);
      if (open !== undefined) {
        open.master = event;
      } else {
        if (indexes.length > 0) warnings.add(event.line!, 'duplicate-uid', `A second master of UID ${event.uid}`);
        indexes.push(builders.length);
        builders.push({ uid: event.uid, master: event, overrides: [] });
      }
    } else {
      if (indexes.length === 0) {
        indexes.push(builders.length);
        builders.push({ uid: event.uid, master: null, overrides: [] });
      }
      const group = builders[indexes[0]!]!;
      const key = memberKey(event);
      if (group.overrides.some((o) => memberKey(o) === key)) {
        warnings.add(event.line!, 'duplicate-uid', `A second override of UID ${event.uid} for the same RECURRENCE-ID`);
      }
      group.overrides.push(event);
    }
  }

  const groups: IcsGroup[] = builders.map((b) => ({ uid: b.uid, master: b.master, overrides: b.overrides }));
  const calendarProps = tokens.calendarProps;
  const extra = calendarProps.map(plainProperty);
  const fields = calendarFields(extra);
  const calendar: IcsCalendar = {
    ...fields,
    groups,
    timeZones,
    extra,
    warnings: [],
    others,
    raw: calendarProps.map((p) => `${p.source}\r\n`).join(''),
  };

  if (zones !== undefined) {
    for (const [tzid, line] of usedTzids(groups)) {
      if (resolveTzid(tzid, calendar, zones).kind === 'floating') {
        warnings.add(line, 'unknown-tzid', `TZID ${show(tzid)} is not a known zone and has no usable VTIMEZONE; its times are read as floating`);
      }
    }
  }
  const sorted = warnings.list.map((w, i) => [w, i] as const).sort((a, b) => a[0].line - b[0].line || a[1] - b[1]);
  return { ...calendar, warnings: sorted.map(([w]) => w) };
}
