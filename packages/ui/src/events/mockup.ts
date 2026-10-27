/**
 * The mockup data set (docs/EVENTS.md §6.7, `fixtures/mockup/mockup-events.json`):
 * read from the generated file, never copied into code. Every fake store and
 * screenshot uses it, with today fixed to Monday, October 19, 2026 09:41 in
 * Europe/Tallinn (IFC Thursday, October 12).
 *
 * Kept apart from `MemoryEventStore` so a build that only uses the memory store
 * (memory mode, §2.16) does not bundle the file.
 */

import {
  type Alarm,
  type CalendarEvent,
  type CalendarInfo,
  type EventOccurrence,
  type EventRecurrence,
  type ExtraDate,
  type GregorianDate,
  type LocalDateTime,
  type OriginalDate,
  type RepeatEnd,
  type RepeatRule,
  type ThirteenRule,
  parseISODate,
  parseLocalDateTime,
  parseRRule,
  zonedToUtc,
} from '@thirteen/core';
import file from '../../../../fixtures/mockup/mockup-events.json';
import { intlZoneResolver } from './intlZones.ts';
import { MemoryEventStore, type MemoryEventStoreOptions } from './MemoryEventStore.ts';
import type { StoreCalendar } from './store.ts';

type RepeatEndJson = { readonly kind: 'never' } | { readonly kind: 'count'; readonly count: number } | { readonly kind: 'until'; readonly date: string };
type RuleJson =
  | { readonly kind: 'rrule'; readonly rrule: string }
  | { readonly kind: 'thirteen'; readonly rule: ThirteenRule }
  | { readonly kind: 'dates' }
  | {
      readonly kind: 'foreign';
      readonly rules: readonly { readonly rrule: string; readonly end: RepeatEndJson }[];
      readonly exrules: readonly { readonly rrule: string; readonly end: RepeatEndJson }[];
    };
type ExtraDateJson = string | { readonly date: string; readonly minute: number | null; readonly durationMinutes: number | null };
type OriginalDateJson = string | { readonly date: string; readonly minute: number | null };
interface RecurrenceJson {
  readonly rule: RuleJson;
  readonly end: RepeatEndJson;
  readonly extraDates: readonly ExtraDateJson[];
  readonly exceptDates: readonly OriginalDateJson[];
}
type AlarmJson = { readonly kind: 'relative'; readonly offsetMinutes: number } | { readonly kind: 'absolute'; readonly at: string };
interface EventJson extends Omit<CalendarEvent, 'start' | 'end' | 'recurrence' | 'alarms'> {
  readonly start: string;
  readonly end: string;
  readonly recurrence: RecurrenceJson | null;
  readonly alarms: readonly AlarmJson[];
  readonly rrule: string | null;
  readonly marker: string | null;
}
interface OccurrenceJson extends Omit<EventOccurrence, 'start' | 'end'> {
  readonly start: string;
  readonly end: string;
}
interface MockupFileJson {
  readonly version: number;
  readonly now: string;
  readonly deviceZone: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly calendars: readonly CalendarInfo[];
  readonly events: readonly EventJson[];
  readonly occurrences: readonly OccurrenceJson[];
}

const endFromJson = (json: RepeatEndJson): RepeatEnd =>
  json.kind === 'until' ? { kind: 'until', date: parseISODate(json.date) } : json.kind === 'count' ? { kind: 'count', count: json.count } : { kind: 'never' };

function ruleFromJson(json: RuleJson): RepeatRule {
  switch (json.kind) {
    case 'rrule':
      return { kind: 'rrule', rrule: parseRRule(json.rrule) };
    case 'thirteen':
      return { kind: 'thirteen', rule: { ...json.rule } };
    case 'dates':
      return { kind: 'dates' };
    case 'foreign':
      return {
        kind: 'foreign',
        rules: json.rules.map((rule) => ({ rrule: parseRRule(rule.rrule), end: endFromJson(rule.end) })),
        exrules: json.exrules.map((rule) => ({ rrule: parseRRule(rule.rrule), end: endFromJson(rule.end) })),
      };
  }
}

const extraFromJson = (json: ExtraDateJson): ExtraDate =>
  typeof json === 'string'
    ? { date: parseISODate(json), minute: null, durationMinutes: null }
    : { date: parseISODate(json.date), minute: json.minute, durationMinutes: json.durationMinutes };

const originalFromJson = (json: OriginalDateJson): OriginalDate =>
  typeof json === 'string' ? { date: parseISODate(json), minute: null } : { date: parseISODate(json.date), minute: json.minute };

const recurrenceFromJson = (json: RecurrenceJson): EventRecurrence => ({
  rule: ruleFromJson(json.rule),
  end: endFromJson(json.end),
  extraDates: json.extraDates.map(extraFromJson),
  exceptDates: json.exceptDates.map(originalFromJson),
});

const alarmFromJson = (json: AlarmJson): Alarm =>
  json.kind === 'relative' ? { kind: 'relative', offsetMinutes: json.offsetMinutes } : { kind: 'absolute', at: parseLocalDateTime(json.at) };

function eventFromJson(json: EventJson): CalendarEvent {
  return {
    title: json.title,
    location: json.location,
    notes: json.notes,
    url: json.url,
    allDay: json.allDay,
    start: parseLocalDateTime(json.start),
    end: parseLocalDateTime(json.end),
    timeZone: json.timeZone,
    calendarId: json.calendarId,
    recurrence: json.recurrence === null ? null : recurrenceFromJson(json.recurrence),
    alarms: json.alarms.map(alarmFromJson),
    availability: json.availability,
    id: json.id,
    status: json.status,
    readOnly: json.readOnly,
    organizer: json.organizer === null ? null : { ...json.organizer },
    attendeeCount: json.attendeeCount,
    alarmsEditable: json.alarmsEditable,
    selfStatus: json.selfStatus,
  };
}

/** The mockup data set as core values. */
export interface MockupData {
  /** The device's wall clock: 2026-10-19T09:41. */
  readonly now: LocalDateTime;
  /** Monday, October 19, 2026. */
  readonly today: GregorianDate;
  readonly deviceZone: string;
  readonly calendars: readonly CalendarInfo[];
  readonly events: readonly CalendarEvent[];
  /** Every occurrence from 2026-01-01 to 2027-12-31, as `expandSeries` gave them when the file was generated. */
  readonly occurrences: readonly EventOccurrence[];
  /** The one `RRULE` value and the `X-THIRTEEN-RULE` marker each event is stored with, by event id. */
  readonly stored: ReadonlyMap<string, { readonly rrule: string | null; readonly marker: string | null }>;
}

let cached: MockupData | null = null;

/** Reads `fixtures/mockup/mockup-events.json` (once). */
export function mockupData(): MockupData {
  if (cached !== null) return cached;
  const json = file as unknown as MockupFileJson;
  if (json.version !== 1) throw new Error(`fixtures/mockup/mockup-events.json: unknown version ${json.version}`);
  const now = parseLocalDateTime(json.now);
  cached = {
    now,
    today: now.date,
    deviceZone: json.deviceZone,
    calendars: json.calendars.map((calendar) => ({ ...calendar })),
    events: json.events.map(eventFromJson),
    occurrences: json.occurrences.map((o) => ({ ...o, start: parseLocalDateTime(o.start), end: parseLocalDateTime(o.end) })),
    stored: new Map(json.events.map((event) => [event.id, { rrule: event.rrule, marker: event.marker }])),
  };
  return cached;
}

/**
 * How the mockup's calendars are grouped. `mockup` keeps the file's accounts
 * (iCloud, Google, Subscribed, Other), as the Apple and Android boards show them.
 * `web` regroups them the way the web does (§3.4, §2.15): writable calendars
 * "In this browser", read-only ones as "Subscriptions".
 */
export type MockupAccounts = 'mockup' | 'web';

/** The mockup calendars as store calendars: all visible, in the file's order. */
export function mockupCalendars(accounts: MockupAccounts = 'web'): StoreCalendar[] {
  const data = mockupData();
  // The feeds were last fetched "now" (UTC, as §3.6 stores it).
  const fetched = zonedToUtc(data.now, data.deviceZone, intlZoneResolver());
  return data.calendars.map((calendar, order) => {
    const subscribed = !calendar.writable;
    const base: StoreCalendar = {
      ...calendar,
      kind: subscribed ? 'subscription' : 'local',
      visible: true,
      order,
      subscription: subscribed
        ? {
            url: `https://calendar.example/${calendar.id}.ics`,
            interval: 'P1D',
            lastAttemptAt: fetched,
            lastSuccessAt: fetched,
            lastError: null,
          }
        : null,
    };
    if (accounts === 'mockup') return base;
    return subscribed
      ? { ...base, accountId: 'subscriptions', accountTitle: 'Subscriptions', accountKind: 'subscribed', isPlatformDefault: false }
      : { ...base, accountId: 'local', accountTitle: 'In this browser', accountKind: 'device' };
  });
}

export interface MockupEventStoreOptions extends Omit<MemoryEventStoreOptions, 'calendars' | 'events' | 'deviceZone'> {
  readonly accounts?: MockupAccounts;
}

/** A `MemoryEventStore` holding the mockup data set, in Europe/Tallinn. */
export function createMockupEventStore(options: MockupEventStoreOptions = {}): MemoryEventStore {
  const data = mockupData();
  return new MemoryEventStore({
    ...options,
    calendars: mockupCalendars(options.accounts ?? 'web'),
    events: data.events,
    deviceZone: data.deviceZone,
  });
}
