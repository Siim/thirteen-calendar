import {
  type CalendarEvent,
  type EventDraft,
  formatLocalDateTime,
  parseRRule,
  setDraftAllDay,
} from '@thirteen/core';
import { MemoryEventStore, type StoreCalendar, intlZoneResolver } from '@thirteen/ui';
import { createMockupEventStore, mockupCalendars, mockupData } from '@thirteen/ui/mockup';
import { describe, expect, it } from 'vitest';
import {
  type MoveContext,
  type MoveTarget,
  columnTime,
  inEventZone,
  isEditableRecurrence,
  movedDraft,
  movedMessage,
  planMove,
  snapLocal,
} from './moves.ts';

const ZONE = 'Europe/Tallinn';
const context: MoveContext = { deviceZone: ZONE, zones: intlZoneResolver(), systemId: 'ifc' };
const d = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
};
const at = (iso: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return { date: d(iso), minute: h! * 60 + m! };
};

function setup(store = createMockupEventStore()) {
  const calendar = (id: string) => store.getState().calendars.find((c) => c.id === id)!;
  const plan = (key: string, target: MoveTarget, calendarOverride?: Partial<StoreCalendar>) => {
    const resolved = store.resolveOccurrence(key);
    if (resolved === null) throw new Error(`no occurrence ${key}`);
    const moved = movedDraft(resolved.draft, resolved.occurrence, target, context);
    if (moved === null) return { resolved, moved, plan: null };
    const info = { ...calendar(resolved.event.calendarId), ...calendarOverride };
    return {
      resolved,
      moved,
      plan: planMove({ resolved, moved, calendar: info, overrideDates: store.overrideDates(resolved.event.id), systemId: 'ifc' }),
    };
  };
  return { store, plan };
}

const DENTIST = 'home/dentist|2026-10-19T15:40';
const BOOK_CLUB = 'home/book-club|2026-10-19T19:00';
const SPRINT = 'work/sprint-planning|2026-10-19T09:30';
const SCHOOL_BREAK = 'family/school-break|2026-10-19';

describe('movedDraft (§2.11: a change of the time group only)', () => {
  it('moves a timed event to another day with its own time, keeping its length', () => {
    const { plan } = setup();
    const { moved } = plan(DENTIST, { kind: 'day', date: d('2026-10-21'), from: d('2026-10-19') });
    expect(formatLocalDateTime(moved!.draft.start)).toBe('2026-10-21T15:40');
    expect(formatLocalDateTime(moved!.draft.end)).toBe('2026-10-21T16:20');
    expect(moved!.draft.title).toBe('Dentist, Dr. Tamm');
    expect(moved!.draft.availability).toBe('busy');
  });

  it('moves a timed event to a new time on the timeline', () => {
    const { plan } = setup();
    const { moved } = plan(DENTIST, { kind: 'timed', start: at('2026-10-19', '14:00') });
    expect(formatLocalDateTime(moved!.draft.start)).toBe('2026-10-19T14:00');
    expect(formatLocalDateTime(moved!.draft.end)).toBe('2026-10-19T14:40');
  });

  it('turns a timed event all-day on the all-day row and keeps Show as', () => {
    const { plan } = setup();
    const { moved } = plan(DENTIST, { kind: 'all-day', date: d('2026-10-20'), from: d('2026-10-19') });
    expect(moved!.draft.allDay).toBe(true);
    expect(formatLocalDateTime(moved!.draft.start)).toBe('2026-10-20T00:00');
    expect(formatLocalDateTime(moved!.draft.end)).toBe('2026-10-20T24:00');
    expect(moved!.draft.availability).toBe('busy');
    expect(moved!.draft.timeZone).toBeNull();
  });

  it('moves a multi-day all-day bar by the days between the picked-up and dropped columns', () => {
    const { plan } = setup();
    // Picked up on its third day (Oct 21), dropped on Oct 23: two days later.
    const { moved } = plan(SCHOOL_BREAK, { kind: 'all-day', date: d('2026-10-23'), from: d('2026-10-21') });
    expect(formatLocalDateTime(moved!.draft.start)).toBe('2026-10-21T00:00');
    expect(formatLocalDateTime(moved!.draft.end)).toBe('2026-10-27T24:00');
  });

  it('makes an all-day event dropped on the timeline one hour long at that time', () => {
    const { plan } = setup();
    const { moved } = plan('holidays/halloween|2026-10-31', { kind: 'timed', start: at('2026-10-31', '18:00') });
    expect(moved!.draft.allDay).toBe(false);
    expect(formatLocalDateTime(moved!.draft.start)).toBe('2026-10-31T18:00');
    expect(formatLocalDateTime(moved!.draft.end)).toBe('2026-10-31T19:00');
    expect(moved!.draft.timeZone).toBe(ZONE);
  });

  it('changes only the end for a resize, never before 15 minutes after the start', () => {
    const { plan } = setup();
    expect(formatLocalDateTime(plan(DENTIST, { kind: 'end', end: at('2026-10-19', '17:00') }).moved!.draft.end)).toBe(
      '2026-10-19T17:00',
    );
    expect(formatLocalDateTime(plan(DENTIST, { kind: 'end', end: at('2026-10-19', '15:00') }).moved!.draft.end)).toBe(
      '2026-10-19T15:55',
    );
    expect(formatLocalDateTime(plan(DENTIST, { kind: 'end', end: at('2026-10-19', '24:00') }).moved!.draft.end)).toBe(
      '2026-10-19T24:00',
    );
  });

  it('gives null when nothing changes', () => {
    const { plan } = setup();
    expect(plan(DENTIST, { kind: 'day', date: d('2026-10-19'), from: d('2026-10-19') }).moved).toBeNull();
    expect(plan(DENTIST, { kind: 'timed', start: at('2026-10-19', '15:40') }).moved).toBeNull();
  });

  it('converts a dropped device wall clock into the event zone', () => {
    const tokyo = inEventZone(at('2026-10-19', '09:00'), 'Asia/Tokyo', context);
    expect(formatLocalDateTime(tokyo!)).toBe('2026-10-19T15:00');
    expect(inEventZone(at('2026-10-19', '09:00'), null, context)).toEqual(at('2026-10-19', '09:00'));
  });

  it('snaps to 15 minutes and lets a column minute run into the next day', () => {
    expect(snapLocal(at('2026-10-19', '09:52'))).toEqual(at('2026-10-19', '09:45'));
    expect(snapLocal(at('2026-10-19', '09:53'))).toEqual(at('2026-10-19', '10:00'));
    expect(snapLocal(at('2026-10-19', '23:59'))).toEqual(at('2026-10-20', '00:00'));
    expect(columnTime(d('2026-10-19'), 1500)).toEqual(at('2026-10-20', '01:00'));
    expect(columnTime(d('2026-10-19'), -30)).toEqual(at('2026-10-18', '23:30'));
  });

  it('moves and resizes an event in a zone only its file defines by the minutes it moved on screen (§3.3)', () => {
    // Outlook's "Customized Time Zone" at +05:30: 15:30 there is 12:00 in Tallinn on November 4.
    const draft: EventDraft = {
      ...mockupData().events.find((e) => e.id === 'home/dentist')!,
      start: at('2026-11-04', '15:30'),
      end: at('2026-11-04', '16:30'),
      timeZone: 'Customized Time Zone',
      recurrence: null,
    };
    const occurrence = { allDay: false, start: at('2026-11-04', '12:00'), end: at('2026-11-04', '13:00') };
    const later = movedDraft(draft, occurrence, { kind: 'timed', start: at('2026-11-04', '13:00') }, context);
    expect(formatLocalDateTime(later!.draft.start)).toBe('2026-11-04T16:30');
    expect(formatLocalDateTime(later!.draft.end)).toBe('2026-11-04T17:30');
    expect(later!.draft.timeZone).toBe('Customized Time Zone');
    const longer = movedDraft(draft, occurrence, { kind: 'end', end: at('2026-11-04', '13:30') }, context);
    expect(formatLocalDateTime(longer!.draft.end)).toBe('2026-11-04T17:00');
  });
});

describe('planMove (§2.11 "Drag edits")', () => {
  it('holds a single event at once', () => {
    const { plan } = setup();
    const { plan: result } = plan(DENTIST, { kind: 'timed', start: at('2026-10-19', '14:00') });
    expect(result!.kind).toBe('hold');
  });

  it('asks a repeating occurrence for the span first: this event only or future events', () => {
    const { plan } = setup();
    const { plan: result } = plan(SPRINT, { kind: 'timed', start: at('2026-10-19', '14:00') });
    expect(result).toMatchObject({
      kind: 'ask',
      title: 'This is a repeating event.',
      message: 'Move this event only, or this and all future events?',
      lines: [],
    });
    if (result!.kind !== 'ask') throw new Error('expected a question');
    expect(result!.choices.map((c) => [c.label, c.span, c.destructive])).toEqual([
      ['Move this event only', 'this', false],
      ['Move future events', 'future', false],
    ]);
    // This event only carries no repeat; future events keep the series' repeat.
    expect(result!.choices[0]!.draft.recurrence).toBeNull();
    expect(result!.choices[1]!.draft.recurrence).not.toBeNull();
  });

  it('says that moving future events to Year Day ends an endless repeat (board G4)', () => {
    const { plan } = setup();
    const { plan: result } = plan(BOOK_CLUB, { kind: 'day', date: d('2026-12-31'), from: d('2026-10-19') });
    expect(result).toMatchObject({
      kind: 'ask',
      message: 'Moving future events to Year Day 2026 ends the repeat. Every later event in this series will be deleted.',
    });
    if (result!.kind !== 'ask') throw new Error('expected a question');
    expect(result!.choices.map((c) => [c.label, c.destructive])).toEqual([
      ['Move this event only', false],
      ['Move and delete later events', true],
    ]);
    expect(result!.choices[1]!.draft.recurrence).toBeNull();
  });

  it('counts the later events of a series with an end (laterOccurrenceCount)', () => {
    const data = mockupData();
    const bookClub = data.events.find((e) => e.id === 'home/book-club')!;
    const ended: CalendarEvent = { ...bookClub, recurrence: { ...bookClub.recurrence!, end: { kind: 'count', count: 13 } } };
    const store = new MemoryEventStore({
      calendars: mockupCalendars(),
      events: [ended],
      deviceZone: data.deviceZone,
    });
    const { plan } = setup(store);
    const { plan: result } = plan(BOOK_CLUB, { kind: 'day', date: d('2026-12-31'), from: d('2026-10-19') });
    // Occurrences 1 to 13 run from IFC January 12 to December 12: two come after October 12.
    expect(result).toMatchObject({
      kind: 'ask',
      message: 'Moving future events to Year Day 2026 ends the repeat. The 2 later events in this series will be deleted.',
    });
  });

  it('says the first event becomes one event when its repeat ends', () => {
    const { plan } = setup();
    const { plan: result } = plan('home/rent|2026-01-01', { kind: 'day', date: d('2026-12-31'), from: d('2026-01-01') });
    expect(result).toMatchObject({
      kind: 'ask',
      message: 'Moving the first event to Year Day 2026 ends the repeat. The series becomes one event on Year Day 2026.',
    });
  });

  it('says how the repeat changes when a 13-month yearly repeat moves to Year Day', () => {
    const data = mockupData();
    const yearly: CalendarEvent = {
      ...data.events.find((e) => e.id === 'home/book-club')!,
      id: 'home/anniversary',
      title: 'Anniversary',
      start: at('2026-12-30', '19:00'),
      end: at('2026-12-30', '20:00'),
      recurrence: {
        rule: { kind: 'thirteen', rule: { kind: 'yearly', system: 'ifc', month: 13, day: 28 } },
        end: { kind: 'never' },
        extraDates: [],
        exceptDates: [],
      },
    };
    const store = new MemoryEventStore({ calendars: mockupCalendars(), events: [yearly], deviceZone: data.deviceZone });
    const { plan } = setup(store);
    const { plan: result } = plan('home/anniversary|2026-12-30T19:00', { kind: 'day', date: d('2026-12-31'), from: d('2026-12-30') });
    expect(result).toMatchObject({
      kind: 'ask',
      message: 'Moving future events to Year Day 2026 changes the repeat to Every Year Day.',
    });
    if (result!.kind !== 'ask') throw new Error('expected a question');
    expect(result!.choices.map((c) => c.label)).toEqual(['Move this event only', 'Move future events and change repeat']);
  });

  it('says before the choice which changed single events future events would remove', async () => {
    const { store, plan } = setup();
    // Change the November occurrence on its own first.
    const november = store.resolveOccurrence('home/book-club|2026-11-16T19:00')!;
    await store.save({
      key: november.occurrence.key,
      original: november.draft,
      draft: { ...november.draft, location: 'Raamatukoi, upstairs' },
      span: 'this',
    });
    expect(store.overrideDates('home/book-club')).toHaveLength(1);
    const { plan: result } = plan(BOOK_CLUB, { kind: 'day', date: d('2026-12-31'), from: d('2026-10-19') });
    expect(result).toMatchObject({
      kind: 'ask',
      lines: ['Changes you made to 1 single event after this one will be removed.'],
    });
  });

  it('offers only this event when the calendar cannot keep the repeat the move needs', () => {
    const { plan } = setup();
    const { plan: result } = plan(
      BOOK_CLUB,
      { kind: 'day', date: d('2026-10-20'), from: d('2026-10-19') },
      { thirteenRepeats: 'gregorian-only', title: 'Work (Exchange)' },
    );
    expect(result).toMatchObject({
      kind: 'ask',
      message: 'Work (Exchange) can’t keep the repeat this move needs, so only this event can be moved.',
    });
    if (result!.kind !== 'ask') throw new Error('expected a question');
    expect(result!.choices.map((c) => c.id)).toEqual(['this']);
  });

  it('moves only one occurrence of a repeat set in another app', () => {
    const data = mockupData();
    const foreign: CalendarEvent = {
      ...data.events.find((e) => e.id === 'work/one-on-one')!,
      recurrence: {
        rule: { kind: 'rrule', rrule: parseRRule('FREQ=WEEKLY') },
        end: { kind: 'never' },
        extraDates: [{ date: d('2026-10-24'), minute: null, durationMinutes: null }],
        exceptDates: [],
      },
    };
    expect(isEditableRecurrence(foreign.recurrence!)).toBe(false);
    const store = new MemoryEventStore({ calendars: mockupCalendars(), events: [foreign], deviceZone: data.deviceZone });
    const { plan } = setup(store);
    const { plan: result } = plan('work/one-on-one|2026-10-19T11:00', { kind: 'timed', start: at('2026-10-19', '14:00') });
    expect(result).toMatchObject({
      kind: 'ask',
      message: 'Its repeat was set in another app, so only this event can be moved.',
    });
    if (result!.kind !== 'ask') throw new Error('expected a question');
    expect(result!.choices.map((c) => c.label)).toEqual(['Move this event only']);
  });

  it('refuses a drop whose draft is invalid and says why', () => {
    const { store } = setup();
    const resolved = store.resolveOccurrence(DENTIST)!;
    const early: EventDraft = { ...resolved.draft, start: at('1500-01-05', '10:00'), end: at('1500-01-05', '11:00') };
    const calendar = store.getState().calendars.find((c) => c.id === 'home')!;
    const result = planMove({
      resolved,
      moved: { draft: early, repeatChange: 'none', start: early.start, allDay: false },
      calendar,
      overrideDates: [],
      systemId: 'ifc',
    });
    expect(result).toEqual({ kind: 'refuse', message: 'Choose a date from 1583 to 9999.' });
  });

  it('holds the move: the views show it at once, Undo discards it, commit writes it', async () => {
    const { store, plan } = setup();
    const { resolved, plan: result } = plan(DENTIST, { kind: 'timed', start: at('2026-10-19', '14:00') });
    if (result!.kind !== 'hold') throw new Error('expected a hold');
    const change = store.hold({ kind: 'save', key: DENTIST, original: resolved.draft, draft: result!.draft, span: result!.span });
    await store.loadYear(2026);
    const moved = () => {
      const snapshot = store.occurrencesInYear(2026);
      if (snapshot.status !== 'ready') throw new Error('loading');
      return snapshot.occurrences.find((o) => o.eventId === 'home/dentist')!;
    };
    expect(formatLocalDateTime(moved().start)).toBe('2026-10-19T14:00');
    change.discard();
    expect(formatLocalDateTime(moved().start)).toBe('2026-10-19T15:40');
    const again = store.hold({ kind: 'save', key: DENTIST, original: resolved.draft, draft: result!.draft, span: result!.span });
    await again.commit();
    expect(formatLocalDateTime(moved().start)).toBe('2026-10-19T14:00');
  });
});

describe('movedMessage (§2.11 Toast)', () => {
  const before = { allDay: false, start: at('2026-10-19', '15:40') };
  it('names the new time, the new day, or both', () => {
    expect(movedMessage(before, { start: at('2026-10-19', '14:00'), allDay: false }, 'timed', true, 'ifc')).toBe(
      'Event moved to 14:00.',
    );
    expect(movedMessage(before, { start: at('2026-10-20', '15:40'), allDay: false }, 'day', true, 'ifc')).toBe(
      'Event moved to Friday, October 13, 2026.',
    );
    expect(movedMessage(before, { start: at('2026-10-20', '14:00'), allDay: false }, 'timed', true, 'ifc')).toBe(
      'Event moved to Friday, October 13, 2026 at 14:00.',
    );
    expect(movedMessage(before, { start: at('2026-12-31', '00:00'), allDay: true }, 'all-day', true, 'ifc')).toBe(
      'Event moved to Year Day 2026.',
    );
    expect(movedMessage(before, { start: at('2026-10-19', '14:00'), allDay: false }, 'timed', false, 'ifc')).toBe(
      'Event moved to 2:00 PM.',
    );
    expect(movedMessage(before, { start: before.start, allDay: false }, 'end', true, 'ifc')).toBe('Event saved.');
  });

  it('keeps setDraftAllDay usable on store drafts', () => {
    const { store } = setup();
    const draft = store.resolveOccurrence(DENTIST)!.draft;
    expect(setDraftAllDay(draft, true).allDay).toBe(true);
  });
});
