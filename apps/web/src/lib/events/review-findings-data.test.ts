/**
 * Review findings (data integrity and engine use) for the web's event store,
 * its iCalendar model (icsModel.ts), undo, import and subscriptions. Every test
 * here states what the spec (docs/EVENTS.md) requires; each failed on the code
 * the review read and passes with its fix.
 */

import {
  type EventDraft,
  type EventRecurrence,
  encodeThirteenRule,
  formatLocalDateTime,
  formatRRule,
  moveDraftStart,
  parseISODate,
  parseLocalDateTime,
  parseRRule,
  setDraftAllDay,
  thirteenRuleFor,
} from '@thirteen/core';
import { EventUndo, type ToastApi, type ToastCloseReason, type ToastHandle, type ToastOptions } from '@thirteen/ui';
import type { StoreOccurrence } from '@thirteen/ui/headless';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { movedDraft } from '../../features/calendar/moves.ts';
import { PENDING_KEY } from './pending.ts';
import type { LocalEventStore } from './store.ts';
import { type TestBrowser, openTab, settle, testBrowser, timedDraft, zones } from './testSupport.ts';

const ROOT = resolve(__dirname, '../../../../..');
const fixture = (path: string) => readFileSync(resolve(ROOT, 'fixtures/ics', path), 'utf8');

const open: LocalEventStore[] = [];
async function tab(browser: TestBrowser = testBrowser(), options: Parameters<typeof openTab>[1] = {}) {
  const store = await openTab(browser, options);
  open.push(store);
  return store;
}
afterEach(() => {
  for (const store of open.splice(0)) store.close();
});

async function year(store: LocalEventStore, y = 2026): Promise<readonly StoreOccurrence[]> {
  await store.loadYear(y);
  const snapshot = store.occurrencesInYear(y);
  if (snapshot.status !== 'ready') throw new Error('not ready');
  return snapshot.occurrences;
}
const starts = async (store: LocalEventStore, title?: string, y = 2026) =>
  (await year(store, y)).filter((o) => title === undefined || o.title === title).map((o) => formatLocalDateTime(o.start));
const personal = (store: LocalEventStore) => store.getState().calendars.find((c) => c.title === 'Personal')!.id;

/** Puts a raw VCALENDAR body into a local calendar, as an import of a file from another app leaves it. */
async function putRaw(store: LocalEventStore, calendarId: string, vevents: string): Promise<void> {
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Other app//EN', vevents.trim().split('\n').join('\r\n'), 'END:VCALENDAR', ''].join('\r\n');
  await store.transact([calendarId], (tx) => tx.setText(calendarId, text));
}

/** The lines of the VEVENT with this UID in a stored document (unfolded). */
function veventLines(store: LocalEventStore, calendarId: string, uid: string): string[][] {
  const text = store.documentText(calendarId)!.replace(/\r\n[ \t]/g, '');
  const blocks = text.split('BEGIN:VEVENT').slice(1).map((b) => `BEGIN:VEVENT${b.split('END:VEVENT')[0]}END:VEVENT`.split('\r\n'));
  return blocks.filter((lines) => lines.includes(`UID:${uid}`));
}

/** A toast region that keeps every toast and closes the current one before the next (§2.11). */
function fakeToast() {
  const shown: { handle: ToastHandle; options: ToastOptions; open: boolean }[] = [];
  let id = 0;
  const close = (toast: (typeof shown)[number] | undefined, reason: ToastCloseReason) => {
    if (toast === undefined || !toast.open) return;
    toast.open = false;
    toast.options.onClose?.(reason);
  };
  const api: ToastApi = {
    show(options) {
      close(shown.find((s) => s.open), 'replaced');
      const handle = { id: ++id };
      shown.push({ handle, options, open: true });
      return handle;
    },
    close(handle, reason = 'dismissed') {
      close(handle === undefined ? shown.find((s) => s.open) : shown.find((s) => s.handle.id === handle.id), reason);
    },
    nextAction() {
      close(shown.find((s) => s.open), 'next-action');
    },
  };
  return { api, shown };
}

const weekly = (end: EventRecurrence['end']): EventRecurrence => ({ rule: { kind: 'rrule', rrule: parseRRule('FREQ=WEEKLY') }, end, extraDates: [], exceptDates: [] });

describe('§4.9 rule 3: a moved start re-encodes the 13-month rule for the new start', () => {
  it('moving the first occurrence of an IFC "every 2 weeks" series by one week writes the BYYEARDAY list of the new fortnight', async () => {
    const store = await tab();
    const id = personal(store);
    const start = parseISODate('2026-10-19'); // IFC Thursday, October 12
    const rule = thirteenRuleFor('biweekly', start, 'ifc')!;
    const recurrence: EventRecurrence = { rule: { kind: 'thirteen', rule }, end: { kind: 'never' }, extraDates: [], exceptDates: [] };
    const { key } = await store.createEvent(timedDraft(id, 'Fortnightly', '2026-10-19T10:00', '2026-10-19T11:00', { recurrence }));
    const first = store.resolveOccurrence(key!)!;
    // The editor's date field moves the start one week later; the repeat stays "Every 2 IFC weeks on Thursday".
    const moved = moveDraftStart(first.draft, parseLocalDateTime('2026-10-26T10:00'), 'ifc');
    expect(moved.repeatChange).toBe('none');
    await store.save({ key: key!, original: first.draft, draft: moved.draft, span: 'future' });
    const uid = key!.split('|')[0]!.slice(id.length + 1);
    const rrule = veventLines(store, id, uid)[0]!.find((l) => l.startsWith('RRULE:'));
    // §4.9 rule 3: "a start moved to another day: ... written in the new rule's own RRULE encoding".
    expect.soft(rrule).toBe(`RRULE:${formatRRule(encodeThirteenRule(rule, parseISODate('2026-10-26')).rrule)}`);
    // Every other Thursday from the new start: October 26, November 9, November 23 (Gregorian).
    expect.soft((await starts(store, 'Fortnightly')).filter((s) => s < '2026-11-30')).toEqual(['2026-10-26T10:00', '2026-11-09T10:00', '2026-11-23T10:00']);
  });
});

describe('§4.9 rule 3, splits: the tail of a 13-month "every 2 weeks" series moved by a week', () => {
  it('"Save for future events" one week later gives every other Thursday from the new date', async () => {
    const store = await tab();
    const id = personal(store);
    const start = parseISODate('2026-10-05'); // IFC Thursday, September 26
    const rule = thirteenRuleFor('biweekly', start, 'ifc')!;
    const recurrence: EventRecurrence = { rule: { kind: 'thirteen', rule }, end: { kind: 'never' }, extraDates: [], exceptDates: [] };
    const { key } = await store.createEvent(timedDraft(id, 'Fortnightly', '2026-10-05T10:00', '2026-10-05T11:00', { recurrence }));
    const eventId = key!.split('|')[0]!;
    const opened = store.resolveOccurrence(`${eventId}|2026-10-19T10:00`)!;
    // Dragged (or re-dated in the editor) one week later, future events; the repeat stays "Every 2 IFC weeks on Thursday".
    const moved = moveDraftStart(opened.draft, parseLocalDateTime('2026-10-26T10:00'), 'ifc');
    expect(moved.repeatChange).toBe('none');
    await store.save({ key: `${eventId}|2026-10-19T10:00`, original: opened.draft, draft: moved.draft, span: 'future' });
    expect((await starts(store, 'Fortnightly')).filter((s) => s < '2026-11-30')).toEqual(['2026-10-05T10:00', '2026-10-26T10:00', '2026-11-09T10:00', '2026-11-23T10:00']);
  });
});

describe('§4.7 splits: the tail of "Save for future events" keeps a valid UNTIL', () => {
  it('a tail turned all-day gets a DATE UNTIL, never a date-time beside DTSTART;VALUE=DATE', async () => {
    const store = await tab();
    const id = personal(store);
    const { key } = await store.createEvent(
      timedDraft(id, 'Standup', '2026-10-05T10:00', '2026-10-05T10:30', { recurrence: weekly({ kind: 'until', date: parseISODate('2026-12-28') }) }),
    );
    const eventId = key!.split('|')[0]!;
    const third = store.resolveOccurrence(`${eventId}|2026-10-19T10:00`)!;
    const allDay = setDraftAllDay(third.draft, true);
    const result = await store.save({ key: `${eventId}|2026-10-19T10:00`, original: third.draft, draft: allDay, span: 'future' });
    const tailUid = result.eventId!.slice(id.length + 1);
    const tail = veventLines(store, id, tailUid)[0]!;
    expect(tail).toContain('DTSTART;VALUE=DATE:20261019');
    // RFC 5545 §3.3.10 and §4.7: an all-day series has a DATE UNTIL.
    expect(tail.find((l) => l.startsWith('RRULE:'))).toBe('RRULE:FREQ=WEEKLY;UNTIL=20261228');
  });

  it('a tail at a later time keeps the last occurrence of an Outlook-style UNTIL (written at the last start)', async () => {
    const store = await tab();
    const id = personal(store);
    // Outlook writes UNTIL at the last occurrence's start: 19:00 Tallinn on November 16 is 17:00Z.
    await putRaw(
      store,
      id,
      `BEGIN:VEVENT
UID:choir@outlook
DTSTAMP:20261001T080000Z
LAST-MODIFIED:20261001T080000Z
SUMMARY:Choir
DTSTART;TZID=Europe/Tallinn:20261005T190000
DTEND;TZID=Europe/Tallinn:20261005T200000
RRULE:FREQ=WEEKLY;UNTIL=20261116T170000Z
END:VEVENT`,
    );
    expect(await starts(store, 'Choir')).toHaveLength(7);
    const key = `${id}/choir@outlook|2026-10-19T19:00`;
    const third = store.resolveOccurrence(key)!;
    const later = { ...third.draft, start: parseLocalDateTime('2026-10-19T19:30'), end: parseLocalDateTime('2026-10-19T20:30') };
    await store.save({ key, original: third.draft, draft: later, span: 'future' });
    // §4.7: the tail keeps the original until date (November 16), at its new time.
    expect(await starts(store, 'Choir')).toEqual([
      '2026-10-05T19:00',
      '2026-10-12T19:00',
      '2026-10-19T19:30',
      '2026-10-26T19:30',
      '2026-11-02T19:30',
      '2026-11-09T19:30',
      '2026-11-16T19:30',
    ]);
  });
});

describe('§2.11 undo: one Undo reverts one change', () => {
  it('moving an event twice in a row and pressing Undo once puts it back where the first move left it', async () => {
    const store = await tab();
    const id = personal(store);
    const toast = fakeToast();
    const undo = new EventUndo(store, { toast: toast.api, systemId: 'ifc', use24Hour: true });
    const detach = undo.attach();
    const { key } = await store.createEvent(timedDraft(id, 'Dentist', '2026-10-20T10:00', '2026-10-20T11:00'));
    const moveTo = (k: string, start: string, end: string) => {
      const resolved = store.resolveOccurrence(k)!;
      const draft: EventDraft = { ...resolved.draft, start: parseLocalDateTime(start), end: parseLocalDateTime(end) };
      undo.hold({ kind: 'save', key: k, original: resolved.draft, draft, span: 'all' }, { message: 'Event moved.', undoableWhenWritten: true });
      return `${k.split('|')[0]}|${start}`;
    };
    const second = moveTo(key!, '2026-10-20T12:00', '2026-10-20T13:00');
    // The second drag is the next action: the first toast closes and its move is written.
    moveTo(second, '2026-10-20T14:00', '2026-10-20T15:00');
    toast.api.close(undefined, 'timeout');
    await settle(20);
    expect(await starts(store, 'Dentist')).toEqual(['2026-10-20T14:00']);
    await undo.undo();
    await settle(20);
    // Undo reverts the last move only (§2.11: "Undo of a written change reverts only the field groups that change touched").
    expect(await starts(store, 'Dentist')).toEqual(['2026-10-20T12:00']);
    detach();
  });
});

describe('§3.6 moves between local calendars never lose another calendar\'s event', () => {
  it('moving an event into a calendar that holds the same UID (the same file imported into both) keeps both events', async () => {
    const store = await tab();
    const home = personal(store);
    const work = (await store.createCalendar({ title: 'Work' })).id;
    const vevent = `BEGIN:VEVENT
UID:team-dinner@example.com
DTSTAMP:20261001T080000Z
LAST-MODIFIED:20261001T080000Z
SUMMARY:Team dinner
DTSTART;TZID=Europe/Tallinn:20261023T190000
DTEND;TZID=Europe/Tallinn:20261023T220000
END:VEVENT`;
    await putRaw(store, home, vevent);
    await putRaw(store, work, vevent.replace('SUMMARY:Team dinner', 'SUMMARY:Team dinner (work copy)'));
    const key = `${home}/team-dinner@example.com|2026-10-23T19:00`;
    const resolved = store.resolveOccurrence(key)!;
    await store.save({ key, original: resolved.draft, draft: { ...resolved.draft, calendarId: work }, span: 'all' });
    const titles = (await year(store)).map((o) => `${o.calendarId === work ? 'Work' : 'Personal'}: ${o.title}`).sort();
    expect(titles).toEqual(['Work: Team dinner', 'Work: Team dinner (work copy)']);
  });
});

describe('§4.7 the first occurrence of a series is the occurrence the user edited', () => {
  it('a title change "for future events" on a first occurrence that was changed on its own shows on that occurrence', async () => {
    const store = await tab();
    const id = personal(store);
    const { key } = await store.createEvent(timedDraft(id, 'Choir', '2026-10-05T19:00', '2026-10-05T20:00', { recurrence: weekly({ kind: 'count', count: 4 }) }));
    // The first occurrence alone moves to 19:30 ("this event only").
    const first = store.resolveOccurrence(key!)!;
    const later = { ...first.draft, start: parseLocalDateTime('2026-10-05T19:30'), end: parseLocalDateTime('2026-10-05T20:30') };
    await store.save({ key: key!, original: first.draft, draft: later, span: 'this' });
    // Then it is opened again and renamed "for future events" (the first occurrence: the whole series).
    const again = store.resolveOccurrence(key!)!;
    expect(again.isFirst).toBe(true);
    await store.save({ key: key!, original: again.draft, draft: { ...again.draft, title: 'Choir rehearsal' }, span: 'future' });
    const titles = (await year(store)).filter((o) => o.eventId === key!.split('|')[0]).map((o) => `${formatLocalDateTime(o.start)} ${o.title}`);
    expect(titles).toEqual([
      '2026-10-05T19:30 Choir rehearsal',
      '2026-10-12T19:00 Choir rehearsal',
      '2026-10-19T19:00 Choir rehearsal',
      '2026-10-26T19:00 Choir rehearsal',
    ]);
  });
});

describe('§4.7 the first occurrence changed on its own, edited again for the whole series', () => {
  it('a new time "for future events" on that first occurrence moves that occurrence too', async () => {
    const store = await tab();
    const id = personal(store);
    const { key } = await store.createEvent(timedDraft(id, 'Choir', '2026-10-05T19:00', '2026-10-05T20:00', { recurrence: weekly({ kind: 'count', count: 3 }) }));
    const first = store.resolveOccurrence(key!)!;
    await store.save({ key: key!, original: first.draft, draft: { ...first.draft, start: parseLocalDateTime('2026-10-05T19:30'), end: parseLocalDateTime('2026-10-05T20:30') }, span: 'this' });
    const again = store.resolveOccurrence(key!)!;
    // The user moves the opened (first) occurrence to 18:00 and saves for future events (the whole series).
    await store.save({
      key: key!,
      original: again.draft,
      draft: { ...again.draft, start: parseLocalDateTime('2026-10-05T18:00'), end: parseLocalDateTime('2026-10-05T19:00') },
      span: 'future',
    });
    // The opened occurrence shows the new time like the rest of the series.
    expect(await starts(store, 'Choir')).toEqual(['2026-10-05T18:00', '2026-10-12T18:00', '2026-10-19T18:00']);
  });
});

describe('§2.11 the web journal: a move already in place counts as written', () => {
  it('a journal entry of a "future events" move whose write completed before its tab closed is removed without a failure', async () => {
    const browser = testBrowser();
    const store = await tab(browser);
    const id = personal(store);
    const { key } = await store.createEvent(timedDraft(id, 'Choir', '2026-10-05T19:00', '2026-10-05T20:00', { recurrence: weekly({ kind: 'count', count: 6 }) }));
    const eventId = key!.split('|')[0]!;
    const third = store.resolveOccurrence(`${eventId}|2026-10-19T19:00`)!;
    const request = {
      kind: 'save' as const,
      key: `${eventId}|2026-10-19T19:00`,
      original: third.draft,
      draft: { ...third.draft, start: parseLocalDateTime('2026-10-19T20:00'), end: parseLocalDateTime('2026-10-19T21:00') },
      span: 'future' as const,
    };
    // The tab wrote the held move, then closed before it could remove its journal entry.
    await store.hold(request).commit();
    browser.storage.setItem(
      PENDING_KEY,
      JSON.stringify([{ id: 'x', tab: 'gone-tab', request, title: 'Choir', target: { date: '2026-10-19', minute: 1200 }, createdAt: '2026-10-19T06:41:00.000Z' }]),
    );
    const next = await tab(browser);
    expect(next.failedCommits()).toEqual([]);
    expect(await starts(next, 'Choir')).toEqual(['2026-10-05T19:00', '2026-10-12T19:00', '2026-10-19T20:00', '2026-10-26T20:00', '2026-11-02T20:00', '2026-11-09T20:00']);
  });
});

describe('§3.3 an event in a zone only its file defines (Outlook "Customized Time Zone") can be dragged', () => {
  it('dropping the imported event one hour later on the timeline moves it', async () => {
    const store = await tab();
    const id = personal(store);
    await store.transact([id], (tx) => tx.setText(id, fixture('imports/customized-tz-a.ics')));
    const occurrence = (await year(store)).find((o) => o.title === 'Call with the Bengaluru team')!;
    // 15:30 at +05:30 is 12:00 in Tallinn (UTC+2 on November 4).
    expect(formatLocalDateTime(occurrence.start)).toBe('2026-11-04T12:00');
    const resolved = store.resolveOccurrence(occurrence.key)!;
    // The draft keeps the TZID the file defines, as core's ics model does (IcsExpandedEvent.zone: "IANA id,
    // file-defined TZID or 'UTC'"); Intl does not know it, so the drop moves the event by the minutes it moved.
    expect(resolved.draft.timeZone).toBe('Customized Time Zone');
    expect(zones.isKnown('Customized Time Zone')).toBe(false);
    const moved = movedDraft(resolved.draft, occurrence, { kind: 'timed', start: parseLocalDateTime('2026-11-04T13:00') }, { deviceZone: 'Europe/Tallinn', zones, systemId: 'ifc' });
    expect(moved).not.toBeNull();
    expect(formatLocalDateTime(moved!.draft.start)).toBe('2026-11-04T16:30');
  });
});


describe('§2.11 undo of a written move reverts only the time group', () => {
  it('a drag that was written, then a note added in another tab: Undo moves the event back and keeps the note', async () => {
    const browser = testBrowser();
    const store = await tab(browser);
    const other = await tab(browser);
    const id = personal(store);
    const toast = fakeToast();
    const undo = new EventUndo(store, { toast: toast.api, systemId: 'ifc', use24Hour: true });
    const detach = undo.attach();
    const { key } = await store.createEvent(timedDraft(id, 'Dentist', '2026-10-20T10:00', '2026-10-20T11:00'));
    const resolved = store.resolveOccurrence(key!)!;
    const draft: EventDraft = { ...resolved.draft, start: parseLocalDateTime('2026-10-20T12:00'), end: parseLocalDateTime('2026-10-20T13:00') };
    undo.hold({ kind: 'save', key: key!, original: resolved.draft, draft, span: 'all' }, { message: 'Event moved to 12:00.', undoableWhenWritten: true });
    // The toast times out: the move is written.
    toast.api.close(undefined, 'timeout');
    await settle(20);
    // Another tab adds a note (another field group).
    const movedKey = `${key!.split('|')[0]}|2026-10-20T12:00`;
    await other.loadYear(2026);
    const there = other.resolveOccurrence(movedKey)!;
    await other.save({ key: movedKey, original: there.draft, draft: { ...there.draft, notes: 'Bring the form' }, span: 'all' });
    await settle(20);
    expect(await undo.undo()).toBe(true);
    await settle(20);
    const now = (await year(store)).find((o) => o.title === 'Dentist')!;
    expect(formatLocalDateTime(now.start)).toBe('2026-10-20T10:00');
    expect(store.getEvent(now.eventId)!.notes).toBe('Bring the form');
    expect(toast.shown.map((s) => s.options.message)).not.toContain('This event changed in another app, so it can’t be undone.');
    detach();
  });
});

describe('§4.7 "Delete all future events" leaves no invisible series behind', () => {
  it('after the first occurrence was deleted alone, deleting the second and all later ones removes the whole group', async () => {
    const store = await tab();
    const id = personal(store);
    const { key } = await store.createEvent(timedDraft(id, 'Yoga', '2026-10-05T08:00', '2026-10-05T09:00', { recurrence: weekly({ kind: 'count', count: 3 }) }));
    await store.delete({ key: key!, span: 'this' });
    await store.delete({ key: `${key!.split('|')[0]}|2026-10-12T08:00`, span: 'future' });
    expect(await starts(store, 'Yoga')).toEqual([]);
    // Nothing of the series is left: no VEVENT whose only occurrence is excluded (it would be exported and counted, and can't be opened).
    expect(store.documentText(id)).not.toContain('BEGIN:VEVENT');
  });
});
