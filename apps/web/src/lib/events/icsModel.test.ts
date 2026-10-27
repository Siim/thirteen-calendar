import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type CalendarEvent,
  compareLocalDateTime,
  formatLocalDateTime,
  parseLocalDateTime,
} from '@thirteen/core';
import { type IcsCalendar, parseICalendar, serializeICalendar } from '@thirteen/core/ics';
import { type StoreCalendar, intlZoneResolver, mockupCalendars, mockupData } from '@thirteen/ui';
import { describe, expect, it } from 'vitest';
import {
  type CalendarMeta,
  type WriteContext,
  type Workspace,
  calendarOccurrences,
  createIn,
  deleteIn,
  draftOf,
  resolveInCalendar,
  saveIn,
  setAlarmsIn,
  yearWindow,
} from './icsModel.ts';

const ROOT = resolve(__dirname, '../../../../..');
const fixture = (path: string) => readFileSync(resolve(ROOT, 'fixtures/ics', path), 'utf8');
const zones = intlZoneResolver();
const NOW = '2026-10-19T06:41';

function info(id: string, kind: 'local' | 'subscription' = 'local'): StoreCalendar {
  return {
    id,
    title: id,
    color: '#ea580c',
    accountId: 'local',
    accountTitle: 'In this browser',
    accountKind: 'device',
    writable: kind === 'local',
    thirteenRepeats: 'all',
    maxAlarms: null,
    supportsAvailability: true,
    supportsUrl: true,
    isPlatformDefault: false,
    kind,
    visible: true,
    order: 0,
    subscription: null,
  };
}

/** A workspace over parsed documents, like one read-modify-write of the store. */
function workspace(docs: Record<string, IcsCalendar>, kinds: Record<string, 'local' | 'subscription'> = {}) {
  const calendars = new Map(Object.entries(docs));
  const ws: Workspace = {
    calendar: (id) => calendars.get(id) ?? null,
    meta: (id) => {
      if (!calendars.has(id)) return null;
      const i = info(id, kinds[id] ?? 'local');
      return { id, kind: i.kind, writable: i.writable, title: id, info: i };
    },
    set: (id, calendar) => void calendars.set(id, calendar),
  };
  return { ws, calendars };
}

function context(deviceZone = 'Europe/Tallinn', uids: string[] = []): WriteContext {
  let n = 0;
  return { zones, deviceZone, now: parseLocalDateTime(NOW), newUid: () => uids.shift() ?? `uid-${++n}` };
}

const meta = (id: string, kind: 'local' | 'subscription' = 'local'): CalendarMeta => ({ id, kind, writable: kind === 'local', title: id });
const write = (calendar: IcsCalendar) => serializeICalendar(calendar, zones, { now: NOW });
const reread = (calendar: IcsCalendar, id: string) => parseICalendar(write(calendar), { calendarId: id, zones });

describe('the mockup data set through iCalendar documents', () => {
  it('writes every mockup event as a new group and reads back the same occurrences in 2026 and 2027', () => {
    const data = mockupData();
    const docs: Record<string, IcsCalendar> = {};
    for (const c of mockupCalendars('web')) {
      docs[c.id] = parseICalendar(
        write({ ...parseICalendar(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n`), name: c.title, color: c.color }),
        { calendarId: c.id },
      );
    }
    const { ws, calendars } = workspace(docs);
    for (const event of data.events) {
      const [calendarId, uid] = event.id.split('/') as [string, string];
      const draft = draftOf(event as CalendarEvent);
      createIn(ws, draft, context('Europe/Tallinn', [uid]));
      expect(calendars.get(calendarId)!.groups.some((g) => g.uid === uid)).toBe(true);
    }
    for (const year of [2026, 2027]) {
      const from = parseLocalDateTime(`${year}-01-01T00:00`);
      const to = parseLocalDateTime(`${year + 1}-01-01T00:00`);
      const expected = data.occurrences
        .filter((o) => compareLocalDateTime(o.end, from) > 0 && compareLocalDateTime(o.start, to) < 0)
        .map((o) => `${o.key} ${formatLocalDateTime(o.start)} ${formatLocalDateTime(o.end)} ${o.title}`)
        .sort();
      const actual = [...calendars.entries()]
        .flatMap(([id, calendar]) => calendarOccurrences(reread(calendar, id), meta(id), yearWindow(year), { zones, deviceZone: 'Europe/Tallinn' }))
        .map((o) => `${o.key} ${formatLocalDateTime(o.start)} ${formatLocalDateTime(o.end)} ${o.title}`)
        .sort();
      expect(actual).toEqual(expected);
    }
    // 13-month repeats are stored in their RRULE encoding with the X-THIRTEEN-RULE marker (§4.4).
    const home = write(calendars.get('home')!).replace(/\r\n[ \t]/g, '');
    expect(home).toContain('RRULE:FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18\r\n');
    expect(home).toContain('X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=monthly;DAY=12\r\n');
    expect(home).toContain('TRIGGER:-PT1H\r\n');
  });

  it('reads a group back as the CalendarEvent it was written from', () => {
    const data = mockupData();
    const book = data.events.find((e) => e.id === 'home/book-club')!;
    const { ws, calendars } = workspace({ home: parseICalendar('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', { calendarId: 'home' }) });
    createIn(ws, draftOf(book as CalendarEvent), context('Europe/Tallinn', ['book-club']));
    const resolved = resolveInCalendar(reread(calendars.get('home')!, 'home'), meta('home'), 'home/book-club|2026-01-12T19:00', { zones, deviceZone: 'Europe/Tallinn' })!;
    expect(resolved.isFirst).toBe(true);
    expect(draftOf(resolved.event)).toEqual({ ...draftOf(book as CalendarEvent) });
    const later = resolveInCalendar(reread(calendars.get('home')!, 'home'), meta('home'), 'home/book-club|2026-10-19T19:00', { zones, deviceZone: 'Europe/Tallinn' })!;
    expect(later.isFirst).toBe(false);
    expect(formatLocalDateTime(later.draft.start)).toBe('2026-10-19T19:00');
    expect(later.occurrence).toMatchObject({ title: 'Book club: Cotsworth', location: 'Raamatukoi', recurring: true, readOnly: null, alarms: [{ kind: 'relative', offsetMinutes: -60 }] });
  });
});

describe('edits keep every other byte (fixtures/ics/edits)', () => {
  const calendarId = 'outlook-publish';
  const choir = '040000008200E00074C5B7101A82E00800000000AB5684E6FDA32FAC8D8F077F189AA479541479E31D34E218DD772EF9';
  const budget = '040000008200E00074C5B7101A82E00800000000F5FEF2D3411C6F9EE58779471EC2C3AD38A95A4F6C94689D82BAB67E';

  it('outlook-edit-one: a new title re-serializes only that group', () => {
    const start = parseICalendar(fixture('cases/outlook-publish.ics'), { calendarId, zones });
    const { ws, calendars } = workspace({ [calendarId]: start });
    const key = `${calendarId}/${budget}|2026-11-18T14:00`;
    const resolved = resolveInCalendar(start, meta(calendarId), key, { zones, deviceZone: 'Europe/Tallinn' })!;
    expect(resolved).not.toBeNull();
    saveIn(ws, { key, original: resolved.draft, draft: { ...resolved.draft, title: 'Budget review with Marta' }, span: 'all' }, context());
    expect(write(calendars.get(calendarId)!)).toBe(fixture('edits/outlook-edit-one.ics'));
  });

  it('retime-until: 19:30, then all-day, then timed again, retimes EXDATE and UNTIL only', () => {
    let doc = parseICalendar(fixture('cases/outlook-publish.ics'), { calendarId, zones });
    const ctx = { zones, deviceZone: 'Europe/Tallinn' };
    // 19:00 to 20:30 becomes 19:30 to 21:00.
    let key = `${calendarId}/${choir}|2026-10-19T19:00`;
    let resolved = resolveInCalendar(doc, meta(calendarId), key, ctx)!;
    expect(resolved.isFirst).toBe(true);
    let { ws, calendars } = workspace({ [calendarId]: doc });
    saveIn(
      ws,
      { key, original: resolved.draft, draft: { ...resolved.draft, start: parseLocalDateTime('2026-10-19T19:30'), end: parseLocalDateTime('2026-10-19T21:00') }, span: 'all' },
      context(),
    );
    expect(write(calendars.get(calendarId)!)).toBe(fixture('edits/retime-until.ics'));
    // All-day.
    doc = parseICalendar(fixture('edits/retime-until.ics'), { calendarId, zones });
    key = `${calendarId}/${choir}|2026-10-19T19:30`;
    resolved = resolveInCalendar(doc, meta(calendarId), key, ctx)!;
    ({ ws, calendars } = workspace({ [calendarId]: doc }));
    saveIn(
      ws,
      {
        key,
        original: resolved.draft,
        draft: { ...resolved.draft, allDay: true, timeZone: null, start: parseLocalDateTime('2026-10-19T00:00'), end: parseLocalDateTime('2026-10-19T24:00') },
        span: 'all',
      },
      context(),
    );
    expect(write(calendars.get(calendarId)!)).toBe(fixture('edits/retime-until-all-day.ics'));
    // Timed again, in the zone it had.
    doc = parseICalendar(fixture('edits/retime-until-all-day.ics'), { calendarId, zones });
    key = `${calendarId}/${choir}|2026-10-19`;
    resolved = resolveInCalendar(doc, meta(calendarId), key, ctx)!;
    ({ ws, calendars } = workspace({ [calendarId]: doc }));
    saveIn(
      ws,
      {
        key,
        original: resolved.draft,
        draft: {
          ...resolved.draft,
          allDay: false,
          timeZone: 'Europe/Kiev',
          start: parseLocalDateTime('2026-10-19T19:30'),
          end: parseLocalDateTime('2026-10-19T21:00'),
          availability: 'busy',
        },
        span: 'all',
      },
      context(),
    );
    expect(write(calendars.get(calendarId)!)).toBe(fixture('edits/retime-until-timed.ics'));
  });

  it('own-time-rdate: deleting the 15:00 extra date adds an EXDATE at 15:00, then a retime to 10:00 moves every value', () => {
    const id = 'rrule-rdate';
    const uid = 'b9c4888c-28ce-4a1f-b750-8d764e943466';
    const doc = parseICalendar(fixture('cases/rrule-rdate.ics'), { calendarId: id, zones });
    const ctx = { zones, deviceZone: 'Europe/Tallinn' };
    const { ws, calendars } = workspace({ [id]: doc });
    const extra = calendarOccurrences(doc, meta(id), yearWindow(2026), ctx).find((o) => o.eventId === `${id}/${uid}` && formatLocalDateTime(o.start) === '2026-11-02T15:00')!;
    deleteIn(ws, { key: extra.key, span: 'this' }, context());
    expect(write(calendars.get(id)!)).toBe(fixture('edits/own-time-rdate.ics'));
    const step2 = parseICalendar(fixture('edits/own-time-rdate.ics'), { calendarId: id, zones });
    const key = `${id}/${uid}|2026-10-19T09:00`;
    const resolved = resolveInCalendar(step2, meta(id), key, ctx)!;
    const next = workspace({ [id]: step2 });
    saveIn(
      next.ws,
      { key, original: resolved.draft, draft: { ...resolved.draft, start: parseLocalDateTime('2026-10-19T10:00'), end: parseLocalDateTime('2026-10-19T11:00') }, span: 'all' },
      context(),
    );
    expect(write(next.calendars.get(id)!)).toBe(fixture('edits/own-time-rdate-retimed.ics'));
  });
});

describe('span changes on a stored series', () => {
  const ctx = { zones, deviceZone: 'Europe/Tallinn' };
  function weekly() {
    const { ws, calendars } = workspace({ c: parseICalendar('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', { calendarId: 'c' }) });
    createIn(
      ws,
      {
        title: 'Choir',
        location: '',
        notes: '',
        url: '',
        allDay: false,
        start: parseLocalDateTime('2026-10-05T19:00'),
        end: parseLocalDateTime('2026-10-05T20:00'),
        timeZone: 'Europe/Tallinn',
        calendarId: 'c',
        recurrence: { rule: { kind: 'rrule', rrule: { ...parseRule('FREQ=WEEKLY') } }, end: { kind: 'count', count: 10 }, extraDates: [], exceptDates: [] },
        alarms: [],
        availability: 'busy',
      },
      context('Europe/Tallinn', ['s']),
    );
    return { ws, calendars };
  }
  const keys = (calendars: Map<string, IcsCalendar>) =>
    calendarOccurrences(reread(calendars.get('c')!, 'c'), meta('c'), yearWindow(2026), ctx).map((o) => `${o.key} ${formatLocalDateTime(o.start)} ${o.title}`);

  it('this event only: an override with RECURRENCE-ID in the DTSTART form and SEQUENCE + 1', () => {
    const { ws, calendars } = weekly();
    const key = 'c/s|2026-10-19T19:00';
    const resolved = resolveInCalendar(calendars.get('c')!, meta('c'), key, ctx)!;
    saveIn(ws, { key, original: resolved.draft, draft: { ...resolved.draft, title: 'Concert', start: parseLocalDateTime('2026-10-19T18:00'), end: parseLocalDateTime('2026-10-19T21:00') }, span: 'this' }, context());
    const text = write(calendars.get('c')!);
    expect(text).toContain('RECURRENCE-ID;TZID=Europe/Tallinn:20261019T190000\r\n');
    expect(text).toMatch(/RECURRENCE-ID[^\r]*\r\n(?:[^\r]*\r\n)*?SEQUENCE:1\r\n/);
    expect(keys(calendars)).toContain('c/s|2026-10-19T19:00 2026-10-19T18:00 Concert');
    expect(keys(calendars)).toHaveLength(10);
  });

  it('future events: the head keeps COUNT 2, the tail a new UID with the other 8', () => {
    const { ws, calendars } = weekly();
    const key = 'c/s|2026-10-19T19:00';
    const resolved = resolveInCalendar(calendars.get('c')!, meta('c'), key, ctx)!;
    const result = saveIn(ws, { key, original: resolved.draft, draft: { ...resolved.draft, title: 'Choir (new hall)' }, span: 'future' }, context('Europe/Tallinn', ['t']));
    expect(result.eventId).toBe('c/t');
    const text = write(calendars.get('c')!);
    expect(text).toContain('RRULE:FREQ=WEEKLY;COUNT=2\r\n');
    expect(text).toContain('RRULE:FREQ=WEEKLY;COUNT=8\r\n');
    const list = keys(calendars);
    expect(list.filter((k) => k.endsWith(' Choir'))).toHaveLength(2);
    expect(list.filter((k) => k.endsWith(' Choir (new hall)'))).toHaveLength(8);
  });

  it('delete this event, then all future events', () => {
    const { ws, calendars } = weekly();
    deleteIn(ws, { key: 'c/s|2026-10-19T19:00', span: 'this' }, context());
    expect(write(calendars.get('c')!)).toContain('EXDATE;TZID=Europe/Tallinn:20261019T190000\r\n');
    expect(keys(calendars)).toHaveLength(9);
    deleteIn(ws, { key: 'c/s|2026-11-02T19:00', span: 'future' }, context());
    expect(keys(calendars).map((k) => k.split(' ')[1])).toEqual(['2026-10-05T19:00', '2026-10-12T19:00', '2026-10-26T19:00']);
    deleteIn(ws, { key: 'c/s|2026-10-05T19:00', span: 'future' }, context());
    expect(calendars.get('c')!.groups).toHaveLength(0);
  });

  it('alerts only, and read-only subscriptions', () => {
    const { ws, calendars } = weekly();
    setAlarmsIn(ws, 'c/s|2026-10-19T19:00', [{ kind: 'relative', offsetMinutes: -15 }], context());
    expect(write(calendars.get('c')!)).toContain('TRIGGER:-PT15M\r\n');
    const sub = workspace({ f: parseICalendar(fixture('cases/google-holidays.ics'), { calendarId: 'f', zones }) }, { f: 'subscription' });
    const occurrence = calendarOccurrences(sub.calendars.get('f')!, meta('f', 'subscription'), yearWindow(2026), ctx)[0]!;
    expect(occurrence.readOnly).toBe('subscribed');
    expect(() => deleteIn(sub.ws, { key: occurrence.key, span: 'all' }, context())).toThrow(/can't be changed/);
  });
});

function parseRule(text: string) {
  // Local import to keep the test's imports short.
  return parseRRuleCore(text);
}
import { parseRRule as parseRRuleCore } from '@thirteen/core';
