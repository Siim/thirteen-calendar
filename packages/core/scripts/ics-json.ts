/**
 * JSON forms of the `.ics` conformance set (`fixtures/ics`, docs/EVENTS.md
 * §5.6, task C8): how the expected files write the values of the `.ics`
 * module (§5.4), and how a test reads them back. The forms follow the
 * `fixtures/events.json` conventions (§5.5): dates are `"YYYY-MM-DD"`, wall
 * clocks `"YYYY-MM-DDTHH:MM"`, rules their canonical `formatRRule` text.
 *
 * - `IcsDateValue`: `{"kind":"date","date"}`, `{"kind":"floating"|"utc","value"}`,
 *   `{"kind":"zoned","value","tzid"}`.
 * - `IcsEvent`: every field of §5.4 except the texts it was read from (`raw`,
 *   `original`), in declaration order; `rrules` and `exrules` as text.
 * - `IcsWarning`: `{"line","code","detail"}`; `detail` is informative English
 *   (ports compare `line` and `code`).
 * - Occurrences: `EventOccurrence` JSON, `{"key","calendarId","title","allDay","start","end"}`.
 * @module
 */

import { formatRRule, parseRRule } from '../src/events/rrule.ts';
import type { IcsAlarm, IcsCalendar, IcsDateValue, IcsEvent, IcsGroup, IcsProperty, IcsRdate, IcsTrigger, IcsWarning } from '../src/ics/index.ts';
import { type DateJson, type LocalJson, dateFromJson, dateJson, localFromJson, localJson } from './events-fixtures.ts';

/** An `IcsDateValue` with its date or wall clock as text. */
export type IcsDateValueJson =
  | { readonly kind: 'date'; readonly date: DateJson }
  | { readonly kind: 'floating' | 'utc'; readonly value: LocalJson }
  | { readonly kind: 'zoned'; readonly value: LocalJson; readonly tzid: string };

export interface IcsPropertyJson {
  readonly name: string;
  readonly params: readonly (readonly [string, string])[];
  readonly value: string;
}

export type IcsTriggerJson =
  | { readonly kind: 'relative'; readonly minutes: number; readonly related: 'start' | 'end' }
  | { readonly kind: 'absolute'; readonly value: IcsDateValueJson };

export interface IcsAlarmJson {
  readonly action: string;
  readonly trigger: IcsTriggerJson;
  readonly extra: readonly IcsPropertyJson[];
}

export interface IcsRdateJson {
  readonly value: IcsDateValueJson;
  readonly period: string | null;
}

/** The fields an edit may set (every field of {@link IcsEventJson} but `uid`, `uidDerived` and `line`). */
export interface IcsEventFieldsJson {
  readonly recurrenceId: IcsDateValueJson | null;
  readonly sequence: number;
  readonly summary: string;
  readonly location: string;
  readonly description: string;
  readonly url: string;
  readonly start: IcsDateValueJson;
  readonly end: IcsDateValueJson | null;
  readonly duration: string | null;
  readonly rrules: readonly string[];
  readonly exrules: readonly string[];
  readonly rdates: readonly IcsRdateJson[];
  readonly exdates: readonly IcsDateValueJson[];
  readonly status: string | null;
  readonly transp: string | null;
  readonly thirteenRule: string | null;
  readonly alarms: readonly IcsAlarmJson[];
  readonly created: IcsDateValueJson | null;
  readonly lastModified: IcsDateValueJson | null;
  readonly dtstamp: IcsDateValueJson | null;
  readonly importedLastModified: IcsDateValueJson | null;
  readonly extra: readonly IcsPropertyJson[];
}

/** An `IcsEvent` without its texts (`raw`, `original`); `line` is the 1-based line it begins on, null for new events. */
export type IcsEventJson = { readonly uid: string; readonly uidDerived: boolean } & IcsEventFieldsJson & { readonly line: number | null };

export interface IcsGroupJson {
  readonly uid: string;
  readonly master: IcsEventJson | null;
  readonly overrides: readonly IcsEventJson[];
}

export interface IcsWarningJson {
  readonly line: number;
  readonly code: IcsWarning['code'];
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export function icsDateValueJson(value: IcsDateValue): IcsDateValueJson {
  switch (value.kind) {
    case 'date':
      return { kind: 'date', date: dateJson(value.date) };
    case 'zoned':
      return { kind: 'zoned', value: localJson(value.value), tzid: value.tzid };
    default:
      return { kind: value.kind, value: localJson(value.value) };
  }
}

export function icsDateValueFromJson(json: IcsDateValueJson): IcsDateValue {
  switch (json.kind) {
    case 'date':
      return { kind: 'date', date: dateFromJson(json.date) };
    case 'zoned':
      return { kind: 'zoned', value: localFromJson(json.value), tzid: json.tzid };
    default:
      return { kind: json.kind, value: localFromJson(json.value) };
  }
}

const nullable = <T, U>(value: T | null, f: (v: T) => U): U | null => (value === null ? null : f(value));

const propertyJson = (p: IcsProperty): IcsPropertyJson => ({ name: p.name, params: p.params.map(([k, v]) => [k, v] as const), value: p.value });
const propertyFromJson = (p: IcsPropertyJson): IcsProperty => ({ name: p.name, params: p.params.map(([k, v]) => [k, v] as const), value: p.value });

function triggerJson(trigger: IcsTrigger): IcsTriggerJson {
  return trigger.kind === 'relative'
    ? { kind: 'relative', minutes: trigger.minutes, related: trigger.related }
    : { kind: 'absolute', value: icsDateValueJson(trigger.value) };
}

function triggerFromJson(json: IcsTriggerJson): IcsTrigger {
  return json.kind === 'relative'
    ? { kind: 'relative', minutes: json.minutes, related: json.related }
    : { kind: 'absolute', value: icsDateValueFromJson(json.value) };
}

const alarmJson = (a: IcsAlarm): IcsAlarmJson => ({ action: a.action, trigger: triggerJson(a.trigger), extra: a.extra.map(propertyJson) });
const alarmFromJson = (a: IcsAlarmJson): IcsAlarm => ({ action: a.action, trigger: triggerFromJson(a.trigger), extra: a.extra.map(propertyFromJson) });
const rdateJson = (r: IcsRdate): IcsRdateJson => ({ value: icsDateValueJson(r.value), period: r.period });
const rdateFromJson = (r: IcsRdateJson): IcsRdate => ({ value: icsDateValueFromJson(r.value), period: r.period });

// ---------------------------------------------------------------------------
// Events and groups
// ---------------------------------------------------------------------------

/** The settable fields of an event, in declaration order. */
export function icsEventFieldsJson(event: IcsEvent): IcsEventFieldsJson {
  return {
    recurrenceId: nullable(event.recurrenceId, icsDateValueJson),
    sequence: event.sequence,
    summary: event.summary,
    location: event.location,
    description: event.description,
    url: event.url,
    start: icsDateValueJson(event.start),
    end: nullable(event.end, icsDateValueJson),
    duration: event.duration,
    rrules: event.rrules.map(formatRRule),
    exrules: event.exrules.map(formatRRule),
    rdates: event.rdates.map(rdateJson),
    exdates: event.exdates.map(icsDateValueJson),
    status: event.status,
    transp: event.transp,
    thirteenRule: event.thirteenRule,
    alarms: event.alarms.map(alarmJson),
    created: nullable(event.created, icsDateValueJson),
    lastModified: nullable(event.lastModified, icsDateValueJson),
    dtstamp: nullable(event.dtstamp, icsDateValueJson),
    importedLastModified: nullable(event.importedLastModified, icsDateValueJson),
    extra: event.extra.map(propertyJson),
  };
}

export function icsEventJson(event: IcsEvent): IcsEventJson {
  return { uid: event.uid, uidDerived: event.uidDerived, ...icsEventFieldsJson(event), line: event.line };
}

/** Field values of `json` (any subset of {@link IcsEventFieldsJson}) as `IcsEvent` fields. */
export function icsEventFieldsFromJson(json: Partial<IcsEventFieldsJson>): Partial<IcsEvent> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(json)) {
    switch (key as keyof IcsEventFieldsJson) {
      case 'recurrenceId':
      case 'end':
      case 'created':
      case 'lastModified':
      case 'dtstamp':
      case 'importedLastModified':
        out[key] = nullable(value as IcsDateValueJson | null, icsDateValueFromJson);
        break;
      case 'start':
        out[key] = icsDateValueFromJson(value as IcsDateValueJson);
        break;
      case 'rrules':
      case 'exrules':
        out[key] = (value as string[]).map((text) => parseRRule(text));
        break;
      case 'rdates':
        out[key] = (value as IcsRdateJson[]).map(rdateFromJson);
        break;
      case 'exdates':
        out[key] = (value as IcsDateValueJson[]).map(icsDateValueFromJson);
        break;
      case 'alarms':
        out[key] = (value as IcsAlarmJson[]).map(alarmFromJson);
        break;
      case 'extra':
        out[key] = (value as IcsPropertyJson[]).map(propertyFromJson);
        break;
      case 'sequence':
      case 'summary':
      case 'location':
      case 'description':
      case 'url':
      case 'duration':
      case 'status':
      case 'transp':
      case 'thirteenRule':
        out[key] = value;
        break;
      default:
        throw new RangeError(`Unknown IcsEvent field ${key}`);
    }
  }
  return out as Partial<IcsEvent>;
}

/** A new event (no text it was read from) from its JSON. */
export function icsEventFromJson(json: IcsEventJson): IcsEvent {
  const { uid, uidDerived, line, ...fields } = json;
  return { uid, uidDerived, ...(icsEventFieldsFromJson(fields) as Omit<IcsEvent, 'uid' | 'uidDerived' | 'raw' | 'original' | 'line'>), raw: null, original: null, line };
}

export const icsGroupJson = (group: IcsGroup): IcsGroupJson => ({
  uid: group.uid,
  master: nullable(group.master, icsEventJson),
  overrides: group.overrides.map(icsEventJson),
});

export const icsWarningJson = (w: IcsWarning): IcsWarningJson => ({ line: w.line, code: w.code, detail: w.detail });

/** The calendar fields of §5.4 and what the reader kept besides the groups. */
export interface IcsCalendarJson {
  readonly name: string | null;
  readonly color: string | null;
  readonly refreshInterval: string | null;
  readonly extra: readonly IcsPropertyJson[];
  readonly timeZones: readonly { readonly tzid: string; readonly observances: number; readonly generated: { readonly first: number; readonly last: number } | null; readonly line: number | null }[];
  readonly others: readonly { readonly name: string; readonly line: number | null }[];
}

export function icsCalendarJson(calendar: IcsCalendar): IcsCalendarJson {
  return {
    name: calendar.name,
    color: calendar.color,
    refreshInterval: calendar.refreshInterval,
    extra: calendar.extra.map(propertyJson),
    timeZones: calendar.timeZones.map((t) => ({ tzid: t.tzid, observances: t.observances.length, generated: t.generated, line: t.line })),
    others: calendar.others.map((o) => ({ name: o.name, line: o.line })),
  };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Text of a fixture JSON file, laid out like `events.json`: the top-level
 * object and the objects directly inside it pretty-printed, every array
 * element on its own line as compact JSON, a trailing newline. The elements of
 * arrays under a key in `prettyKeys` are pretty-printed objects themselves
 * (their own arrays again one element per line).
 */
export function renderFixtureJson(value: unknown, prettyKeys: ReadonlySet<string> = new Set()): string {
  const object = (v: Record<string, unknown>, indent: string, depth: number): string => {
    const inner = `${indent}  `;
    const entries = Object.entries(v);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([key, child]) => `${inner}${JSON.stringify(key)}: ${render(child, inner, depth + 1, key)}`).join(',\n')}\n${indent}}`;
  };
  const render = (v: unknown, indent: string, depth: number, key: string | null): string => {
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      const inner = `${indent}  `;
      const pretty = key !== null && prettyKeys.has(key);
      return `[\n${v.map((item) => `${inner}${pretty && isObject(item) ? object(item, inner, depth + 1) : JSON.stringify(item)}`).join(',\n')}\n${indent}]`;
    }
    return isObject(v) && depth < 2 ? object(v, indent, depth) : JSON.stringify(v);
  };
  return `${render(value, '', 0, null)}\n`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
