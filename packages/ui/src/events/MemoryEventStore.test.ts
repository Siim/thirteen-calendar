import { compareLocalDateTime, formatLocalDateTime, parseLocalDateTime } from '@thirteen/core';
import { describe, expect, it, vi } from 'vitest';
import { createMockupEventStore, mockupCalendars, mockupData } from './mockup.ts';
import type { MemoryEventStore } from './MemoryEventStore.ts';
import { EventStoreError, type StoreOccurrence } from './store.ts';

const text = (o: { start: Parameters<typeof formatLocalDateTime>[0]; end: Parameters<typeof formatLocalDateTime>[0] }) =>
  `${formatLocalDateTime(o.start)} ${formatLocalDateTime(o.end)}`;

function store(): MemoryEventStore {
  let n = 0;
  return createMockupEventStore({ newId: () => `id-${++n}` });
}

function year(s: MemoryEventStore, y: number): readonly StoreOccurrence[] {
  const snapshot = s.occurrencesInYear(y);
  if (snapshot.status !== 'ready') throw new Error('not ready');
  return snapshot.occurrences;
}

const byKey = (list: readonly StoreOccurrence[], key: string) => list.find((o) => o.key === key);
const ofEvent = (list: readonly StoreOccurrence[], id: string) => list.filter((o) => o.eventId === id);

describe('mockup data set', () => {
  it('reads fixtures/mockup/mockup-events.json: 6 calendars, 24 events, today 2026-10-19 09:41 in Tallinn', () => {
    const data = mockupData();
    expect(data.calendars.map((c) => c.title)).toEqual(['Home', 'Family', 'Work', 'Running club', 'Holidays in Estonia', 'Birthdays']);
    expect(data.events).toHaveLength(24);
    expect(formatLocalDateTime(data.now)).toBe('2026-10-19T09:41');
    expect(data.deviceZone).toBe('Europe/Tallinn');
    expect(data.stored.get('home/book-club')).toEqual({
      rrule: 'FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18',
      marker: 'SYSTEM=ifc;KIND=monthly;DAY=12',
    });
  });

  it('groups the calendars as the web does, or keeps the file accounts', () => {
    const web = mockupCalendars('web');
    expect(web.filter((c) => c.kind === 'local').map((c) => c.accountTitle)).toEqual(Array(4).fill('In this browser'));
    expect(web.filter((c) => c.kind === 'subscription').map((c) => c.title)).toEqual(['Holidays in Estonia', 'Birthdays']);
    expect(web.every((c) => c.visible)).toBe(true);
    expect(web.find((c) => c.id === 'holidays')?.subscription?.lastSuccessAt).toEqual(parseLocalDateTime('2026-10-19T06:41'));
    expect(mockupCalendars('mockup').map((c) => c.accountTitle)).toEqual(['iCloud', 'iCloud', 'liis.kask@example.com', 'liis.kask@example.com', 'Subscribed', 'Other']);
  });
});

describe('MemoryEventStore reads', () => {
  it.each([2026, 2027])('expands %i exactly like the file (expandSeries in Europe/Tallinn)', (y) => {
    const from = parseLocalDateTime(`${y}-01-01T00:00`);
    const to = parseLocalDateTime(`${y + 1}-01-01T00:00`);
    const expected = mockupData()
      .occurrences.filter((o) => compareLocalDateTime(o.end, from) > 0 && compareLocalDateTime(o.start, to) < 0)
      .map((o) => `${o.key} ${text(o)}`)
      .sort();
    const actual = year(store(), y)
      .map((o) => `${o.key} ${text(o)}`)
      .sort();
    expect(actual).toEqual(expected);
  });

  it('gives each occurrence what chips, labels and alerts need', () => {
    const occurrences = year(store(), 2026);
    const book = byKey(occurrences, 'home/book-club|2026-10-19T19:00')!;
    expect(book).toMatchObject({ eventId: 'home/book-club', title: 'Book club: Cotsworth', location: 'Raamatukoi', recurring: true, readOnly: null, overrideId: null });
    expect(book.alarms).toEqual([{ kind: 'relative', offsetMinutes: -60 }]);
    expect(formatLocalDateTime(book.startUtc!)).toBe('2026-10-19T16:00');
    expect(byKey(occurrences, 'holidays/halloween|2026-10-31')).toMatchObject({ readOnly: 'subscribed', allDay: true, startUtc: null });
    expect(byKey(occurrences, 'work/design-review|2026-10-21T14:00')).toMatchObject({ readOnly: 'invitation', attendeeCount: 6 });
    // The order key of §5.3: by start, all-day bars first on a day.
    const oct19 = occurrences.filter((o) => formatLocalDateTime(o.start).startsWith('2026-10-19'));
    expect(oct19.map((o) => o.title)).toEqual([
      'Autumn school break',
      'Sprint planning',
      '1:1 with Marta',
      'Dentist, Dr. Tamm',
      'Book club: Cotsworth',
    ]);
  });

  it('returns the same snapshot until something changes', () => {
    const s = store();
    expect(s.occurrencesInYear(2026)).toBe(s.occurrencesInYear(2026));
    const state = s.getState();
    expect(s.getState()).toBe(state);
  });

  it('resolves an occurrence by key with its event and the draft the editor opens', () => {
    const resolved = store().resolveOccurrence('work/sprint-planning|2026-10-19T09:30')!;
    expect(resolved.event.id).toBe('work/sprint-planning');
    expect(resolved.isFirst).toBe(false);
    expect(text(resolved.draft)).toBe('2026-10-19T09:30 2026-10-19T10:30');
    expect(resolved.draft.recurrence).toEqual(resolved.event.recurrence);
    expect(store().resolveOccurrence('work/sprint-planning|2026-01-12T09:30')!.isFirst).toBe(true);
    // Not an occurrence: a Tuesday, a missing event, not a key.
    expect(store().resolveOccurrence('work/sprint-planning|2026-10-20T09:30')).toBeNull();
    expect(store().resolveOccurrence('work/nothing|2026-10-19T09:30')).toBeNull();
    expect(store().resolveOccurrence('nonsense')).toBeNull();
  });
});

describe('MemoryEventStore writes', () => {
  it('creates an event and tells its listeners', async () => {
    const s = store();
    const listener = vi.fn();
    s.subscribe(listener);
    const result = await s.createEvent({
      ...mockupData().events.find((e) => e.id === 'home/dentist')!,
      title: 'Optician',
      start: parseLocalDateTime('2026-10-22T10:00'),
      end: parseLocalDateTime('2026-10-22T10:30'),
      recurrence: null,
    });
    expect(result).toEqual({ eventId: 'home/id-1', key: 'home/id-1|2026-10-22T10:00' });
    expect(byKey(year(s, 2026), result.key!)?.title).toBe('Optician');
    expect(listener).toHaveBeenCalledOnce();
    expect(s.getState().revision).toBe(1);
  });

  it('refuses invalid drafts and read-only calendars', async () => {
    const s = store();
    const dentist = mockupData().events.find((e) => e.id === 'home/dentist')!;
    await expect(s.createEvent({ ...dentist, end: parseLocalDateTime('2026-10-19T15:00') })).rejects.toMatchObject({
      code: 'invalid',
      issues: ['end-before-start'],
    });
    await expect(s.createEvent({ ...dentist, calendarId: 'holidays' })).rejects.toBeInstanceOf(EventStoreError);
    const halloween = s.resolveOccurrence('holidays/halloween|2026-10-31')!;
    await expect(
      s.save({ key: 'holidays/halloween|2026-10-31', original: halloween.draft, draft: { ...halloween.draft, title: 'Party' }, span: 'all' }),
    ).rejects.toMatchObject({ code: 'read-only' });
  });

  it('saves a single event, merging only the changed fields', async () => {
    const s = store();
    const key = 'home/dentist|2026-10-19T15:40';
    const opened = s.resolveOccurrence(key)!.draft;
    const result = await s.save({ key, original: opened, draft: { ...opened, title: 'Dentist, Dr. Tamm (check-up)' }, span: 'this' });
    expect(result).toEqual({ eventId: 'home/dentist', key });
    expect(s.getEvent('home/dentist')!.title).toBe('Dentist, Dr. Tamm (check-up)');
    expect(s.getEvent('home/dentist')!.location).toBe('Tartu mnt 18');
  });

  it('saves this occurrence only of a repeating event', async () => {
    const s = store();
    const key = 'work/sprint-planning|2026-10-19T09:30';
    const opened = s.resolveOccurrence(key)!.draft;
    await s.save({
      key,
      original: opened,
      draft: { ...opened, title: 'Sprint planning (long)', end: parseLocalDateTime('2026-10-19T11:30') },
      span: 'this',
    });
    const occurrences = year(s, 2026);
    expect(byKey(occurrences, key)).toMatchObject({ title: 'Sprint planning (long)', overrideId: key });
    expect(text(byKey(occurrences, key)!)).toBe('2026-10-19T09:30 2026-10-19T11:30');
    expect(byKey(occurrences, 'work/sprint-planning|2026-11-02T09:30')?.title).toBe('Sprint planning');
    // Opened again, it shows its own values.
    expect(s.resolveOccurrence(key)!.draft.title).toBe('Sprint planning (long)');
  });

  it('splits for future events: earlier ones keep the old time, later ones are a new series', async () => {
    const s = store();
    const before = ofEvent(year(s, 2026), 'work/sprint-planning').length;
    const key = 'work/sprint-planning|2026-10-19T09:30';
    const opened = s.resolveOccurrence(key)!.draft;
    const result = await s.save({
      key,
      original: opened,
      draft: { ...opened, start: parseLocalDateTime('2026-10-19T10:00'), end: parseLocalDateTime('2026-10-19T11:00') },
      span: 'future',
    });
    expect(result).toEqual({ eventId: 'work/id-1', key: 'work/id-1|2026-10-19T10:00' });
    const occurrences = year(s, 2026);
    const head = ofEvent(occurrences, 'work/sprint-planning');
    const tail = ofEvent(occurrences, 'work/id-1');
    expect(head.every((o) => formatLocalDateTime(o.start) < '2026-10-19' && o.start.minute === 570)).toBe(true);
    expect(tail.every((o) => formatLocalDateTime(o.start) >= '2026-10-19' && o.start.minute === 600)).toBe(true);
    expect(head.length + tail.length).toBe(before);
    expect(tail[0]!.key).toBe('work/id-1|2026-10-19T10:00');
  });

  it('changes every event from the first occurrence', async () => {
    const s = store();
    const key = 'work/sprint-planning|2026-01-12T09:30';
    const opened = s.resolveOccurrence(key)!.draft;
    await s.save({ key, original: opened, draft: { ...opened, title: 'Planning' }, span: 'future' });
    expect(ofEvent(year(s, 2026), 'work/sprint-planning').every((o) => o.title === 'Planning')).toBe(true);
    expect(ofEvent(year(s, 2027), 'work/sprint-planning').every((o) => o.title === 'Planning')).toBe(true);
  });

  it('deletes this, future and all events', async () => {
    const s = store();
    const all = ofEvent(year(s, 2026), 'work/one-on-one');
    await s.delete({ key: 'work/one-on-one|2026-10-19T11:00', span: 'this' });
    let now = ofEvent(year(s, 2026), 'work/one-on-one');
    expect(now).toHaveLength(all.length - 1);
    expect(byKey(now, 'work/one-on-one|2026-10-19T11:00')).toBeUndefined();
    expect(byKey(now, 'work/one-on-one|2026-10-26T11:00')).toBeDefined();

    await s.delete({ key: 'work/one-on-one|2026-11-02T11:00', span: 'future' });
    now = ofEvent(year(s, 2026), 'work/one-on-one');
    expect(now.every((o) => formatLocalDateTime(o.start) < '2026-11-02')).toBe(true);
    expect(byKey(now, 'work/one-on-one|2026-10-26T11:00')).toBeDefined();
    expect(ofEvent(year(s, 2027), 'work/one-on-one')).toHaveLength(0);

    await s.delete({ key: 'work/one-on-one|2026-10-26T11:00', span: 'all' });
    expect(ofEvent(year(s, 2026), 'work/one-on-one')).toHaveLength(0);
    expect(s.getEvent('work/one-on-one')).toBeNull();
    await expect(s.delete({ key: 'work/one-on-one|2026-10-26T11:00', span: 'all' })).rejects.toMatchObject({ code: 'occurrence-gone' });
  });

  it('changes only the alerts', async () => {
    const s = store();
    await s.setAlarms('home/dentist|2026-10-19T15:40', [{ kind: 'relative', offsetMinutes: -30 }]);
    expect(byKey(year(s, 2026), 'home/dentist|2026-10-19T15:40')?.alarms).toEqual([{ kind: 'relative', offsetMinutes: -30 }]);
  });
});

describe('MemoryEventStore held changes (§2.11)', () => {
  it('shows a held delete at once, brings it back on discard, writes it on commit', async () => {
    const s = store();
    const key = 'home/dentist|2026-10-19T15:40';
    const pending = s.hold({ kind: 'delete', key, span: 'all' });
    expect(pending.held).toBe(true);
    expect(byKey(year(s, 2026), key)).toBeUndefined();
    pending.discard();
    expect(pending.held).toBe(false);
    expect(byKey(year(s, 2026), key)).toBeDefined();

    const again = s.hold({ kind: 'delete', key, span: 'all' });
    await expect(again.commit()).resolves.toEqual({ eventId: null, key: null });
    expect(byKey(year(s, 2026), key)).toBeUndefined();
    await expect(again.commit()).rejects.toMatchObject({ code: 'not-found' });
  });

  it('shows a held move, and returns to the stored state when the commit fails', async () => {
    const s = store();
    const key = 'home/dentist|2026-10-19T15:40';
    const opened = s.resolveOccurrence(key)!.draft;
    const moved = { ...opened, start: parseLocalDateTime('2026-10-20T15:40'), end: parseLocalDateTime('2026-10-20T16:20') };
    const pending = s.hold({ kind: 'save', key, original: opened, draft: moved, span: 'all' });
    expect(text(byKey(year(s, 2026), 'home/dentist|2026-10-20T15:40')!)).toBe('2026-10-20T15:40 2026-10-20T16:20');
    // Deleted elsewhere while the move was held.
    await s.delete({ key, span: 'all' });
    await expect(pending.commit()).rejects.toMatchObject({ code: 'occurrence-gone' });
    expect(ofEvent(year(s, 2026), 'home/dentist')).toHaveLength(0);
  });

  it('refuses to hold what could not be written', () => {
    const s = store();
    expect(() => s.hold({ kind: 'delete', key: 'holidays/halloween|2026-10-31', span: 'all' })).toThrow(EventStoreError);
  });
});

describe('MemoryEventStore calendars', () => {
  it('creates with the first free palette colour, renames, hides and deletes with its events', async () => {
    const s = store();
    const created = await s.createCalendar({ title: 'Garden' });
    // Orange, green, blue, teal, graphite and purple are taken by the mockup calendars.
    expect(created).toMatchObject({ id: 'id-1', title: 'Garden', color: '#dc2626', kind: 'local', visible: true, order: 6 });
    await s.updateCalendar('id-1', { title: 'Allotment', visible: false });
    expect(s.getState().calendars.find((c) => c.id === 'id-1')).toMatchObject({ title: 'Allotment', visible: false });
    await expect(s.updateCalendar('id-1', { color: 'red' })).rejects.toMatchObject({ code: 'invalid' });
    await s.deleteCalendar('work');
    expect(s.getState().calendars.map((c) => c.id)).not.toContain('work');
    expect(year(s, 2026).some((o) => o.calendarId === 'work')).toBe(false);
  });
});
