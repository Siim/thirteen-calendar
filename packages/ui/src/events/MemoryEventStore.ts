import {
  type Alarm,
  type CalendarEvent,
  type EventDraft,
  type EventRecurrence,
  type ExceptionMap,
  type GregorianDate,
  type LocalDateTime,
  type OriginalDate,
  type SeriesInput,
  type ZoneResolver,
  addMinutesLocal,
  addGregorianDays,
  applyToSeries,
  changedFields,
  diffMinutesLocal,
  endRecurrenceBefore,
  expandSeries,
  gregorianEquals,
  mergeDraft,
  normalizeEventEnd,
  retimeExceptions,
  splitRecurrence,
  toISODate,
  validateDraft,
} from '@thirteen/core';
import { deviceTimeZone, intlZoneResolver } from './intlZones.ts';
import { compareOccurrences, occurrenceKey, parseOccurrenceKey } from './order.ts';
import {
  type CalendarPatch,
  type DeleteRequest,
  type EventSnapshot,
  type EventStore,
  EventStoreError,
  type EventStoreState,
  type HeldRequest,
  type NewCalendar,
  type PendingChange,
  type ResolvedOccurrence,
  type SaveRequest,
  type StoreCalendar,
  type StoreOccurrence,
  type WriteResult,
  type YearSnapshot,
} from './store.ts';

/** The colours for new calendars, in order (§3.6): the first one not in use is taken. */
export const CALENDAR_PALETTE: readonly string[] = [
  '#ea580c',
  '#dc2626',
  '#d97706',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#4f46e5',
  '#9333ea',
  '#db2777',
  '#92400e',
  '#57534e',
];

export interface MemoryEventStoreOptions {
  readonly calendars?: readonly StoreCalendar[];
  /** Masters and single events (with their recurrence); occurrences changed on their own are added by saves. */
  readonly events?: readonly CalendarEvent[];
  /** The device's IANA zone. Default: the browser's. */
  readonly deviceZone?: string;
  /** Default: `Intl`. */
  readonly zones?: ZoneResolver;
  /** `memory` shows the "not saved" state of §2.16; the default `ready`. */
  readonly status?: 'ready' | 'memory';
  /** New calendar ids and event UIDs. Default `crypto.randomUUID()`. */
  readonly newId?: () => string;
  /** The `expandSeries` limit per series and year. */
  readonly limit?: number;
}

interface Override {
  readonly id: string;
  readonly originalDate: GregorianDate;
  readonly originalMinute: number | null;
  readonly canceled: boolean;
  /** This occurrence's own fields; `start` and `end` in `event.timeZone`. */
  readonly event: CalendarEvent;
}

interface Series {
  readonly master: CalendarEvent;
  readonly overrides: readonly Override[];
}

interface Data {
  readonly calendars: readonly StoreCalendar[];
  readonly series: ReadonlyMap<string, Series>;
}

/** A {@link MemoryEventStore} snapshot: the stored series itself. */
interface MemorySnapshot extends EventSnapshot {
  readonly series: Series | null;
}

interface Held {
  readonly id: number;
  readonly request: HeldRequest;
}

const DAY = 1440;

function randomId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function draftOf(event: CalendarEvent): EventDraft {
  return {
    title: event.title,
    location: event.location,
    notes: event.notes,
    url: event.url,
    allDay: event.allDay,
    start: event.start,
    end: event.end,
    timeZone: event.timeZone,
    calendarId: event.calendarId,
    recurrence: event.recurrence,
    alarms: event.alarms,
    availability: event.availability,
  };
}

function withDraft(event: CalendarEvent, draft: EventDraft): CalendarEvent {
  return { ...event, ...draft };
}

const sameOriginal = (a: { originalDate: GregorianDate; originalMinute: number | null }, date: GregorianDate, minute: number | null) =>
  gregorianEquals(a.originalDate, date) && a.originalMinute === minute;

/** The occurrence on `date` (at `minute`, or the master's start minute) with the master's length. */
function shiftedDraft(master: CalendarEvent, date: GregorianDate, minute: number | null): EventDraft {
  const start: LocalDateTime = { date, minute: minute ?? master.start.minute };
  const length = diffMinutesLocal(master.end, master.start);
  return { ...draftOf(master), start, end: normalizeEventEnd(start, addMinutesLocal(start, length)) };
}

const timeChanged = (a: EventDraft, b: EventDraft) => changedFields(a, b).includes('time');

/**
 * An in-memory {@link EventStore}: the same contract as the IndexedDB store, no
 * persistence. Tests and screenshots fill it with the mockup data set
 * (`createMockupEventStore`); the app can also run on it when storage is
 * unavailable. Occurrences come from core's `expandSeries` per Gregorian year,
 * in the device zone; saves and deletes follow §4.7 for Windows and web with
 * core's `mergeDraft`, `applyToSeries`, `splitRecurrence`, `endRecurrenceBefore`
 * and `retimeExceptions`. Held changes are an overlay on the stored data until
 * they commit.
 */
export class MemoryEventStore implements EventStore {
  private committed: Data;
  private visible: Data;
  private held: Held[] = [];
  private nextHeld = 1;
  private readonly listeners = new Set<() => void>();
  private readonly years = new Map<number, YearSnapshot>();
  private state: EventStoreState;
  private readonly zones: ZoneResolver;
  private readonly newId: () => string;
  private readonly limit: number | undefined;

  constructor(options: MemoryEventStoreOptions = {}) {
    this.zones = options.zones ?? intlZoneResolver();
    this.newId = options.newId ?? randomId;
    this.limit = options.limit;
    const calendars = [...(options.calendars ?? [])].sort((a, b) => a.order - b.order);
    const series = new Map<string, Series>();
    for (const event of options.events ?? []) series.set(event.id, { master: event, overrides: [] });
    this.committed = { calendars, series };
    this.visible = this.committed;
    this.state = {
      status: options.status ?? 'ready',
      calendars,
      deviceZone: options.deviceZone ?? deviceTimeZone(),
      revision: 0,
    };
  }

  // ---- reads ----------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): EventStoreState {
    return this.state;
  }

  occurrencesInYear(year: number): YearSnapshot {
    if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError(`Year must be 1 to 9999, got ${year}`);
    let snapshot = this.years.get(year);
    if (snapshot === undefined) {
      snapshot = this.expandYear(year);
      this.years.set(year, snapshot);
    }
    return snapshot;
  }

  loadYear(year: number): Promise<void> {
    this.occurrencesInYear(year);
    return Promise.resolve();
  }

  getEvent(id: string): CalendarEvent | null {
    return this.visible.series.get(id)?.master ?? null;
  }

  resolveOccurrence(key: string): ResolvedOccurrence | null {
    return this.resolveIn(this.visible, key);
  }

  overrideDates(eventId: string): readonly OriginalDate[] {
    const series = this.visible.series.get(eventId);
    if (series === undefined || series.master.recurrence === null) return [];
    return series.overrides.map((o) => ({ date: o.originalDate, minute: o.originalMinute }));
  }

  // ---- writes ---------------------------------------------------------

  createEvent(draft: EventDraft): Promise<WriteResult> {
    return this.write(() => this.applyCreate(this.committed, draft));
  }

  save(request: Omit<SaveRequest, 'kind'>): Promise<WriteResult> {
    return this.write(() => this.applySave(this.committed, request));
  }

  delete(request: Omit<DeleteRequest, 'kind'>): Promise<WriteResult> {
    return this.write(() => this.applyDelete(this.committed, request));
  }

  hold(request: HeldRequest): PendingChange {
    // Refused at once when it could not be written now (§2.11: validateDraft before holding).
    this.applyRequest(this.visible, request);
    const entry: Held = { id: this.nextHeld++, request };
    this.held.push(entry);
    this.refresh();
    const store = this;
    let open = true;
    return {
      id: entry.id,
      request,
      get held() {
        return open && store.held.includes(entry);
      },
      commit() {
        if (!open || !store.held.includes(entry)) return Promise.reject(new EventStoreError('not-found', 'This change is no longer held.'));
        open = false;
        store.held = store.held.filter((h) => h !== entry);
        try {
          const { data, result } = store.applyRequest(store.committed, request);
          store.committed = data;
          store.refresh();
          return Promise.resolve(result);
        } catch (error) {
          // The views return to the stored state (§2.11).
          store.refresh();
          return Promise.reject(error);
        }
      },
      discard() {
        if (!open) return;
        open = false;
        store.held = store.held.filter((h) => h !== entry);
        store.refresh();
      },
    };
  }

  setAlarms(key: string, alarms: readonly Alarm[]): Promise<WriteResult> {
    return this.write(() => {
      const data = this.committed;
      const resolved = this.resolveIn(data, key);
      if (resolved === null) throw new EventStoreError('occurrence-gone', 'This event is no longer in the calendar.');
      if (!resolved.event.alarmsEditable) throw new EventStoreError('read-only', 'The alerts of this event cannot be changed.');
      const series = data.series.get(resolved.event.id)!;
      const next: Series = {
        master: { ...series.master, alarms: [...alarms] },
        overrides: series.overrides.map((o) => ({ ...o, event: { ...o.event, alarms: [...alarms] } })),
      };
      return { data: withSeries(data, next.master.id, next), result: { eventId: next.master.id, key } };
    });
  }

  /** The stored series (master and overrides) of an event, for an exact Undo (§2.11). */
  snapshotEvent(eventId: string): MemorySnapshot {
    const series = this.committed.series.get(eventId) ?? null;
    return { eventId, fingerprint: series === null ? null : JSON.stringify(series), series };
  }

  /** Puts a snapshot's series back as it was, or removes the event when it did not exist. */
  restoreEvent(snapshot: EventSnapshot): Promise<void> {
    const series = snapshot.fingerprint === null ? null : (snapshot as Partial<MemorySnapshot>).series;
    if (series === undefined) return Promise.reject(new EventStoreError('generic', 'Not a snapshot of this store.'));
    const calendarId = series?.master.calendarId;
    if (calendarId !== undefined && !this.committed.calendars.some((c) => c.id === calendarId)) {
      return Promise.reject(new EventStoreError('not-found', 'This calendar no longer exists.'));
    }
    const next = new Map(this.committed.series);
    if (series === null) next.delete(snapshot.eventId);
    else next.set(snapshot.eventId, series);
    this.committed = { ...this.committed, series: next };
    this.refresh();
    return Promise.resolve();
  }

  createCalendar(calendar: NewCalendar): Promise<StoreCalendar> {
    const title = calendar.title.trim();
    if (title === '') return Promise.reject(new EventStoreError('invalid', 'A calendar needs a name.'));
    const used = new Set(this.committed.calendars.map((c) => c.color.toLowerCase()));
    const color = calendar.color ?? CALENDAR_PALETTE.find((c) => !used.has(c)) ?? CALENDAR_PALETTE[0]!;
    if (!/^#[0-9a-f]{6}$/i.test(color)) return Promise.reject(new EventStoreError('invalid', `Not a colour: ${color}`));
    const created: StoreCalendar = {
      id: this.newId(),
      title,
      color: color.toLowerCase(),
      accountId: 'local',
      accountTitle: 'In this browser',
      accountKind: 'device',
      writable: true,
      thirteenRepeats: 'all',
      maxAlarms: null,
      supportsAvailability: true,
      supportsUrl: true,
      isPlatformDefault: !this.committed.calendars.some((c) => c.writable),
      kind: 'local',
      visible: true,
      order: Math.max(-1, ...this.committed.calendars.map((c) => c.order)) + 1,
      subscription: null,
    };
    this.committed = { ...this.committed, calendars: [...this.committed.calendars, created] };
    this.refresh();
    return Promise.resolve(created);
  }

  updateCalendar(id: string, patch: CalendarPatch): Promise<void> {
    const calendar = this.committed.calendars.find((c) => c.id === id);
    if (calendar === undefined) return Promise.reject(new EventStoreError('not-found', `No calendar ${id}.`));
    if (patch.color !== undefined && !/^#[0-9a-f]{6}$/i.test(patch.color)) {
      return Promise.reject(new EventStoreError('invalid', `Not a colour: ${patch.color}`));
    }
    if (patch.title !== undefined && patch.title.trim() === '') return Promise.reject(new EventStoreError('invalid', 'A calendar needs a name.'));
    const next: StoreCalendar = {
      ...calendar,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.color !== undefined ? { color: patch.color.toLowerCase() } : {}),
      ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
      ...(patch.order !== undefined ? { order: patch.order } : {}),
    };
    const calendars = this.committed.calendars.map((c) => (c.id === id ? next : c)).sort((a, b) => a.order - b.order);
    this.committed = { ...this.committed, calendars };
    this.refresh();
    return Promise.resolve();
  }

  deleteCalendar(id: string): Promise<void> {
    if (!this.committed.calendars.some((c) => c.id === id)) return Promise.reject(new EventStoreError('not-found', `No calendar ${id}.`));
    const series = new Map([...this.committed.series].filter(([, s]) => s.master.calendarId !== id));
    this.committed = { calendars: this.committed.calendars.filter((c) => c.id !== id), series };
    this.held = this.held.filter((h) => parseOccurrenceKey(h.request.key)?.eventId.startsWith(`${id}/`) !== true);
    this.refresh();
    return Promise.resolve();
  }

  // ---- internals ------------------------------------------------------

  private write(apply: () => { data: Data; result: WriteResult }): Promise<WriteResult> {
    try {
      const { data, result } = apply();
      this.committed = data;
      this.refresh();
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error instanceof EventStoreError ? error : new EventStoreError('generic', String(error)));
    }
  }

  /** Recomputes the visible data (stored data plus held changes), drops the caches and tells the listeners. */
  private refresh(): void {
    let visible = this.committed;
    for (const entry of this.held) {
      try {
        visible = this.applyRequest(visible, entry.request).data;
      } catch {
        // No longer applicable (its event changed): it stays held and fails when it commits.
      }
    }
    this.visible = visible;
    this.years.clear();
    this.state = { ...this.state, calendars: visible.calendars, revision: this.state.revision + 1 };
    for (const listener of [...this.listeners]) listener();
  }

  private calendar(data: Data, id: string): StoreCalendar {
    const calendar = data.calendars.find((c) => c.id === id);
    if (calendar === undefined) throw new EventStoreError('not-found', `No calendar ${id}.`);
    return calendar;
  }

  private applyRequest(data: Data, request: HeldRequest): { data: Data; result: WriteResult } {
    return request.kind === 'save' ? this.applySave(data, request) : this.applyDelete(data, request);
  }

  private applyCreate(data: Data, draft: EventDraft): { data: Data; result: WriteResult } {
    const calendar = this.calendar(data, draft.calendarId);
    if (!calendar.writable) throw new EventStoreError('read-only', `${calendar.title} can't be changed.`);
    const issues = validateDraft(draft, calendar);
    if (issues.length > 0) throw new EventStoreError('invalid', `The event can't be saved: ${issues.join(', ')}.`, issues);
    const master: CalendarEvent = {
      ...draft,
      id: `${draft.calendarId}/${this.newId()}`,
      status: 'confirmed',
      readOnly: null,
      organizer: null,
      attendeeCount: 0,
      alarmsEditable: true,
      selfStatus: null,
    };
    return {
      data: withSeries(data, master.id, { master, overrides: [] }),
      result: { eventId: master.id, key: occurrenceKey(master, master.start.date, null) },
    };
  }

  private applySave(data: Data, request: Omit<SaveRequest, 'kind'>): { data: Data; result: WriteResult } {
    const resolved = this.resolveIn(data, request.key);
    if (resolved === null) throw new EventStoreError('occurrence-gone', 'This event is no longer in the calendar.');
    const { event: master, occurrence } = resolved;
    const series = data.series.get(master.id)!;
    const source = this.calendar(data, master.calendarId);
    if (!source.writable || master.readOnly !== null) throw new EventStoreError('read-only', `${source.title} can't be changed.`);
    const target = this.calendar(data, request.draft.calendarId);
    if (!target.writable) throw new EventStoreError('read-only', `${target.title} can't be changed.`);
    const issues = validateDraft(request.draft, target);
    if (issues.length > 0) throw new EventStoreError('invalid', `The event can't be saved: ${issues.join(', ')}.`, issues);

    const { originalDate, originalMinute } = occurrence;
    const recurring = master.recurrence !== null;
    const span = recurring ? request.span : 'all';

    // This occurrence only: add or replace its override.
    if (span === 'this') {
      const existing = series.overrides.find((o) => sameOriginal(o, originalDate, originalMinute));
      const { merged } = mergeDraft(request.original, request.draft, resolved.draft);
      const id = existing?.id ?? request.key;
      const own: CalendarEvent = { ...withDraft(master, { ...merged, calendarId: master.calendarId, recurrence: null }), id };
      const overrides = [
        ...series.overrides.filter((o) => o !== existing),
        { id, originalDate, originalMinute, canceled: false, event: own },
      ];
      return { data: withSeries(data, master.id, { master, overrides }), result: { eventId: master.id, key: request.key } };
    }

    // Future events from a later occurrence: split (§4.7).
    if (span === 'future' && !resolved.isFirst) {
      const recurrence = master.recurrence!;
      const ruleChanged = changedFields(request.original, request.draft).includes('recurrence');
      const split = splitRecurrence(
        recurrence,
        master.start.date,
        originalDate,
        series.overrides.map((o) => ({ date: o.originalDate, minute: o.originalMinute })),
        { recurrence: request.draft.recurrence, start: request.draft.start.date, ruleChanged },
      );
      const { merged } = mergeDraft(request.original, request.draft, resolved.draft);
      const tailId = `${merged.calendarId}/${this.newId()}`;
      const tail: CalendarEvent = { ...withDraft(master, { ...merged, recurrence: split.tail }), id: tailId };
      const kept = series.overrides.filter((o) => compareOriginal(o, originalDate) < 0);
      const moved = mapOverrides(series.overrides, split.overrides, tailId).filter((o) => !sameOriginal(o, originalDate, originalMinute));
      let next = withSeries(data, master.id, { master: { ...master, recurrence: split.head }, overrides: kept });
      next = withSeries(next, tailId, { master: tail, overrides: split.tail === null ? [] : moved });
      return { data: next, result: { eventId: tailId, key: occurrenceKey(tail, tail.start.date, null) } };
    }

    // The whole series from its first occurrence, or a single event.
    if (resolved.isFirst || !recurring) {
      const current = draftOf(master);
      const { merged } = mergeDraft(request.original, request.draft, current);
      const retimed = this.retime(series, current, merged, null);
      const updated: CalendarEvent = withDraft(master, { ...merged, recurrence: retimed.recurrence });
      return {
        data: withSeries(data, master.id, { master: updated, overrides: retimed.overrides }),
        result: { eventId: master.id, key: occurrenceKey(updated, updated.start.date, null) },
      };
    }

    // All events from a later occurrence (repeats set in another app, §2.11): applyToSeries.
    const existing = series.overrides.find((o) => sameOriginal(o, originalDate, originalMinute)) ?? null;
    const applied = applyToSeries(draftOf(master), request.original, request.draft, existing === null ? null : draftOf(existing.event));
    const retimed = this.retime(series, draftOf(master), applied.master, applied.retime);
    const overrides = retimed.overrides.map((o) =>
      existing !== null && applied.override !== null && o.id === existing.id ? { ...o, event: withDraft(o.event, { ...applied.override, recurrence: null }) } : o,
    );
    const updated = withDraft(master, { ...applied.master, recurrence: retimed.recurrence });
    return { data: withSeries(data, master.id, { master: updated, overrides }), result: { eventId: master.id, key: request.key } };
  }

  /** Moves the overrides and excluded dates with a new start or repeat of the whole series (§4.7). */
  private retime(
    series: Series,
    before: EventDraft,
    after: EventDraft,
    options: { readonly minuteDelta: number; readonly allDay: 'to-all-day' | 'to-timed' | null } | null,
  ): { recurrence: EventRecurrence | null; overrides: readonly Override[] } {
    const recurrence = before.recurrence;
    if (recurrence === null || after.recurrence === null) return { recurrence: after.recurrence, overrides: [] };
    const repeatChanged = changedFields(before, after).includes('recurrence');
    if (!timeChanged(before, after) && !repeatChanged) return { recurrence: after.recurrence, overrides: series.overrides };
    const allDay = before.allDay === after.allDay ? null : after.allDay ? 'to-all-day' : 'to-timed';
    const result = retimeExceptions(
      recurrence,
      series.overrides.map((o) => ({ date: o.originalDate, minute: o.originalMinute })),
      before.start.date,
      after.start.date,
      after.recurrence,
      options ?? { minuteDelta: after.allDay || before.allDay ? 0 : after.start.minute - before.start.minute, allDay },
    );
    return { recurrence: result.recurrence, overrides: mapOverrides(series.overrides, result.overrides, null) };
  }

  private applyDelete(data: Data, request: Omit<DeleteRequest, 'kind'>): { data: Data; result: WriteResult } {
    const resolved = this.resolveIn(data, request.key);
    if (resolved === null) throw new EventStoreError('occurrence-gone', 'This event is no longer in the calendar.');
    const { event: master, occurrence } = resolved;
    const calendar = this.calendar(data, master.calendarId);
    // Historical events stay deletable on the web (§3.5).
    if (!calendar.writable || (master.readOnly !== null && master.readOnly !== 'historical')) {
      throw new EventStoreError('read-only', `${calendar.title} can't be changed.`);
    }
    const series = data.series.get(master.id)!;
    const { originalDate, originalMinute } = occurrence;
    const whole = master.recurrence === null || request.span === 'all' || (request.span === 'future' && resolved.isFirst);
    if (whole) {
      const series2 = new Map(data.series);
      series2.delete(master.id);
      return { data: { ...data, series: series2 }, result: { eventId: null, key: null } };
    }
    const recurrence = master.recurrence!;
    if (request.span === 'this') {
      const exceptDates: OriginalDate[] = [...recurrence.exceptDates, { date: originalDate, minute: originalMinute }];
      const overrides = series.overrides.filter((o) => !sameOriginal(o, originalDate, originalMinute));
      return {
        data: withSeries(data, master.id, { master: { ...master, recurrence: { ...recurrence, exceptDates } }, overrides }),
        result: { eventId: master.id, key: null },
      };
    }
    const head = endRecurrenceBefore(recurrence, master.start.date, originalDate);
    const overrides = series.overrides.filter((o) => compareOriginal(o, originalDate) < 0);
    if (head === null) {
      const series2 = new Map(data.series);
      series2.delete(master.id);
      return { data: { ...data, series: series2 }, result: { eventId: null, key: null } };
    }
    return { data: withSeries(data, master.id, { master: { ...master, recurrence: head }, overrides }), result: { eventId: master.id, key: null } };
  }

  private seriesInput(series: Series): SeriesInput {
    const { master } = series;
    return {
      id: master.id,
      recurrence: master.recurrence,
      allDay: master.allDay,
      start: master.start,
      end: master.end,
      zone: master.timeZone,
      overrides: series.overrides.map((o) => ({
        id: o.id,
        originalDate: o.originalDate,
        originalMinute: o.originalMinute,
        canceled: o.canceled,
        allDay: o.event.allDay,
        start: o.event.start,
        end: o.event.end,
        zone: o.event.timeZone,
      })),
    };
  }

  private occurrencesOf(data: Data, series: Series, from: LocalDateTime, to: LocalDateTime): { list: StoreOccurrence[]; truncated: boolean } {
    const { master } = series;
    const calendar = data.calendars.find((c) => c.id === master.calendarId);
    if (calendar === undefined) return { list: [], truncated: false };
    const result = expandSeries(this.seriesInput(series), { from, to }, this.state.deviceZone, this.zones, this.limit === undefined ? undefined : { limit: this.limit });
    const readOnly = master.readOnly ?? (calendar.writable ? null : calendar.kind === 'subscription' ? 'subscribed' : 'calendar');
    const list = result.occurrences.map((o): StoreOccurrence => {
      const own = o.overrideId === null ? master : (series.overrides.find((x) => x.id === o.overrideId)?.event ?? master);
      return {
        key: occurrenceKey(master, o.originalDate, o.originalMinute),
        calendarId: master.calendarId,
        title: own.title,
        allDay: o.allDay,
        start: o.start,
        end: o.end,
        eventId: master.id,
        originalDate: o.originalDate,
        originalMinute: o.originalMinute,
        overrideId: o.overrideId,
        startUtc: o.startUtc,
        location: own.location,
        status: own.status,
        recurring: master.recurrence !== null,
        readOnly,
        attendeeCount: master.attendeeCount,
        alarms: own.alarms,
      };
    });
    return { list, truncated: result.truncated };
  }

  private expandYear(year: number): YearSnapshot {
    const from: LocalDateTime = { date: { year, month: 1, day: 1 }, minute: 0 };
    const to: LocalDateTime = { date: { year, month: 12, day: 31 }, minute: DAY };
    const occurrences: StoreOccurrence[] = [];
    let truncated = false;
    for (const series of this.visible.series.values()) {
      const expanded = this.occurrencesOf(this.visible, series, from, to);
      occurrences.push(...expanded.list);
      truncated ||= expanded.truncated;
    }
    occurrences.sort(compareOccurrences);
    return { status: 'ready', year, occurrences, truncated };
  }

  private resolveIn(data: Data, key: string): ResolvedOccurrence | null {
    const parsed = parseOccurrenceKey(key);
    if (parsed === null) return null;
    const series = data.series.get(parsed.eventId);
    if (series === undefined) return null;
    const { master } = series;
    const original = parseOriginal(parsed.original);
    if (original === null) return null;
    // Around the original date, and around where an override moved it.
    const days = [original.date];
    const moved = series.overrides.find((o) => occurrenceKey(master, o.originalDate, o.originalMinute) === key);
    if (moved) days.push(moved.event.start.date, moved.event.end.date);
    const clampDay = (date: GregorianDate, delta: number): GregorianDate => {
      try {
        return addGregorianDays(date, delta);
      } catch {
        return date;
      }
    };
    for (const day of days) {
      const from: LocalDateTime = { date: clampDay(day, -2), minute: 0 };
      const to: LocalDateTime = { date: clampDay(day, 2), minute: DAY };
      const found = this.occurrencesOf(data, series, from, to).list.find((o) => o.key === key);
      if (found === undefined) continue;
      const override = found.overrideId === null ? null : (series.overrides.find((o) => o.id === found.overrideId) ?? null);
      const draft =
        override !== null
          ? { ...draftOf(override.event), calendarId: master.calendarId, recurrence: master.recurrence }
          : shiftedDraft(master, found.originalDate, found.originalMinute);
      const isFirst =
        master.recurrence === null || (gregorianEquals(found.originalDate, master.start.date) && found.originalMinute === null);
      return { occurrence: found, event: master, draft, isFirst };
    }
    return null;
  }
}

function withSeries(data: Data, id: string, series: Series): Data {
  const next = new Map(data.series);
  next.set(id, series);
  return { ...data, series: next };
}

/** -1, 0 or 1: an override's original date against `date`. */
function compareOriginal(override: Override, date: GregorianDate): number {
  const a = toISODate(override.originalDate);
  const b = toISODate(date);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Moves overrides by core's exception map (`to: null` drops one); `tailId` renames them into a new series. */
function mapOverrides(overrides: readonly Override[], map: readonly ExceptionMap[], tailId: string | null): Override[] {
  const out: Override[] = [];
  for (const entry of map) {
    if (entry.to === null) continue;
    const override = overrides.find((o) => sameOriginal(o, entry.from.date, entry.from.minute));
    if (override === undefined) continue;
    out.push({
      ...override,
      id: tailId === null ? override.id : `${tailId}|${toISODate(entry.to.date)}${entry.to.minute === null ? '' : `T${entry.to.minute}`}`,
      originalDate: entry.to.date,
      originalMinute: entry.to.minute,
    });
  }
  return out;
}

/** The original start of a key: a date (`2026-10-19`) or a wall clock (`2026-10-19T09:30`); the minute is resolved later. */
function parseOriginal(text: string): { readonly date: GregorianDate } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2})?(?:#\d+)?$/.exec(text);
  if (match === null) return null;
  return { date: { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } };
}
