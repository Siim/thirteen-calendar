import {
  type Alarm,
  type EventDraft,
  type EventRecurrence,
  type OriginalDate,
  parseISODate,
  parseLocalDateTime,
  parseRRule,
} from '@thirteen/core';
import { describe, expect, it } from 'vitest';
import { createMockupEventStore, mockupCalendars } from '../mockup.ts';
import type { ResolvedOccurrence } from '../store.ts';
import {
  type SeriesContext,
  deleteQuestion,
  duplicateDraft,
  exceptionsRemovedNotice,
  isDirty,
  laterDeletedNotice,
  normalizeUrl,
  normalizedEnd,
  pickerEnd,
  saveSpanQuestion,
  seriesContext,
  trimAlarms,
  visibleIssues,
  zoneCity,
} from './editorModel.ts';

const at = (text: string) => parseLocalDateTime(text);
const store = createMockupEventStore();
const calendars = mockupCalendars('web');
const home = calendars.find((c) => c.id === 'home')!;

function resolve(key: string): ResolvedOccurrence {
  const resolved = store.resolveOccurrence(key);
  if (resolved === null) throw new Error(`no occurrence ${key}`);
  return resolved;
}

const dentist = () => resolve('home/dentist|2026-10-19T15:40');
const oneOnOne = () => resolve('work/one-on-one|2026-10-19T11:00');
const oneOnOneFirst = () => resolve('work/one-on-one|2026-01-05T11:00');

const weekly = (end: EventRecurrence['end'] = { kind: 'never' }): EventRecurrence => ({
  rule: { kind: 'rrule', rrule: parseRRule('FREQ=WEEKLY') },
  end,
  extraDates: [],
  exceptDates: [],
});

function series(resolved: ResolvedOccurrence, overrides: readonly OriginalDate[] = [], editable = true): SeriesContext {
  const context = seriesContext(resolved, overrides, editable);
  if (context === null) throw new Error('not a series');
  return context;
}

describe('validation under the fields (§2.11 Validation)', () => {
  it('puts each issue under its row, in the order of the rows', () => {
    const draft: EventDraft = { ...dentist().draft, end: at('2026-10-19T15:00'), url: 'not a url' };
    expect(visibleIssues(draft, home).map((issue) => [issue.field, issue.text])).toEqual([
      ['end', 'The end must be after the start.'],
      ['url', 'Enter a web address, like example.com.'],
    ]);
  });

  it('shows the 1583 to 9999 range under Starts or Ends', () => {
    const before: EventDraft = { ...dentist().draft, start: at('1582-10-20T10:00'), end: at('1582-10-20T11:00') };
    expect(visibleIssues(before, home)).toEqual([{ issue: 'out-of-range', field: 'start', text: 'Choose a date from 1583 to 9999.' }]);
    const after: EventDraft = { ...dentist().draft, start: at('9999-12-31T23:00'), end: at('9999-12-31T24:00') };
    expect(visibleIssues(after, home)).toEqual([{ issue: 'out-of-range', field: 'end', text: 'Choose a date from 1583 to 9999.' }]);
  });

  it('checks End repeat, and a calendar that cannot be changed', () => {
    const draft: EventDraft = { ...oneOnOne().draft, recurrence: weekly({ kind: 'count', count: 1000 }) };
    expect(visibleIssues(draft, calendars.find((c) => c.id === 'work')!)).toEqual([
      { issue: 'count-out-of-range', field: 'endRepeat', text: 'Choose from 1 to 999 times.' },
    ]);
    const subscribed = calendars.find((c) => c.id === 'holidays')!;
    expect(visibleIssues({ ...dentist().draft, calendarId: subscribed.id }, subscribed).map((issue) => issue.text)).toEqual([
      'This calendar can’t be changed. Choose another calendar.',
    ]);
    // A calendar that is gone is one that cannot be changed.
    expect(visibleIssues({ ...dentist().draft, calendarId: 'gone' }, null).map((issue) => issue.field)).toEqual(['calendar']);
  });
});

describe('small helpers', () => {
  it('adds https:// to a web address without a scheme', () => {
    expect(normalizeUrl(' example.com/a ')).toBe('https://example.com/a');
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeUrl('mailto:me@example.com')).toBe('mailto:me@example.com');
    expect(normalizeUrl('   ')).toBe('');
  });

  it('names the zone by its city', () => {
    expect(zoneCity('America/New_York')).toBe('New York');
    expect(zoneCity('Europe/Tallinn')).toBe('Tallinn');
  });

  it('shows a midnight end as the next day at 00:00 and stores it as 24:00 (§2.12 Midnight ends)', () => {
    const draft: EventDraft = { ...dentist().draft, start: at('2026-10-19T22:00'), end: at('2026-10-19T24:00') };
    expect(pickerEnd(draft)).toEqual({ date: parseISODate('2026-10-20'), minute: 0 });
    expect(normalizedEnd(draft.start, at('2026-10-20T00:00'))).toEqual(at('2026-10-19T24:00'));
    // An end before the start is kept as picked: the error shows under Ends.
    expect(normalizedEnd(draft.start, at('2026-10-19T21:00'))).toEqual(at('2026-10-19T21:00'));
  });
});

describe('the later-events line under Repeat (§2.11)', () => {
  it('says how many later events go when an occurrence stops repeating', () => {
    const resolved = oneOnOne();
    const never = { ...resolved.draft, recurrence: null };
    expect(laterDeletedNotice(series(resolved), never, 'ifc')).toBe('Saving for future events deletes every later event in this series.');
    const counted: SeriesContext = { ...series(resolved), recurrence: weekly({ kind: 'count', count: 10 }), originalDate: parseISODate('2026-01-19') };
    expect(laterDeletedNotice(counted, never, 'ifc')).toBe('Saving for future events deletes the 7 later events in this series.');
    const lastButOne: SeriesContext = { ...counted, originalDate: parseISODate('2026-03-02') };
    expect(laterDeletedNotice(lastButOne, never, 'ifc')).toBe('Saving for future events deletes 1 later event in this series.');
  });

  it('says the first occurrence becomes one event, and says nothing while it repeats', () => {
    const first = oneOnOneFirst();
    expect(laterDeletedNotice(series(first), { ...first.draft, recurrence: null }, 'ifc')).toBe(
      'The series becomes one event on Thursday, January 5, 2026.',
    );
    expect(laterDeletedNotice(series(first), first.draft, 'ifc')).toBeNull();
    expect(laterDeletedNotice(null, dentist().draft, 'ifc')).toBeNull();
  });
});

describe('the retime notice under Starts (§2.11, §4.7)', () => {
  const overrides: OriginalDate[] = [
    { date: parseISODate('2026-01-12'), minute: 660 },
    { date: parseISODate('2026-10-26'), minute: 660 },
  ];

  it('counts the changed occurrences a new start on the first event removes', () => {
    const first = oneOnOneFirst();
    const later = { ...first.draft, start: at('2026-01-05T12:00'), end: at('2026-01-05T12:30') };
    expect(exceptionsRemovedNotice(series(first, overrides), first.draft, later)).toBe(
      'Changes to 2 single events in this series will be removed when you save.',
    );
  });

  it('says nothing without changed occurrences, off the first event, or when the start is put back', () => {
    const first = oneOnOneFirst();
    const later = { ...first.draft, start: at('2026-01-05T12:00'), end: at('2026-01-05T12:30') };
    expect(exceptionsRemovedNotice(series(first), first.draft, later)).toBeNull();
    expect(exceptionsRemovedNotice(series(first, overrides), first.draft, first.draft)).toBeNull();
    const other = oneOnOne();
    expect(exceptionsRemovedNotice(series(other, overrides), other.draft, { ...other.draft, start: at('2026-10-19T12:00'), end: at('2026-10-19T12:30') })).toBeNull();
  });
});

describe('span questions (§2.11, §4.7)', () => {
  it('asks this event or future events, with no losses', () => {
    const resolved = oneOnOne();
    const question = saveSpanQuestion(series(resolved), resolved.draft, { ...resolved.draft, title: '1:1' });
    expect(question.title).toBe('This is a repeating event.');
    expect(question.message).toBe('Save your changes for this event only, or for this and all future events?');
    expect(question.lines).toEqual([]);
    expect(question.choices.map((c) => [c.span, c.label, c.destructive])).toEqual([
      ['this', 'Save for this event only', false],
      ['future', 'Save for future events', false],
    ]);
  });

  it('says first which changed occurrences a future split drops', () => {
    const resolved = oneOnOne();
    const overrides: OriginalDate[] = [{ date: parseISODate('2026-10-26'), minute: 660 }];
    const question = saveSpanQuestion(series(resolved, overrides), resolved.draft, { ...resolved.draft, title: '1:1' });
    expect(question.lines).toEqual(['Changes you made to 1 single event after this one will be removed.']);
  });

  it('offers only future events when the repeat changed, and marks deleting later events', () => {
    const resolved = oneOnOne();
    const daily: EventDraft = { ...resolved.draft, recurrence: { ...weekly(), rule: { kind: 'rrule', rrule: parseRRule('FREQ=DAILY') } } };
    const changed = saveSpanQuestion(series(resolved), resolved.draft, daily);
    expect(changed.message).toBe('Changing the repeat applies to this and all future events.');
    expect(changed.choices.map((c) => c.span)).toEqual(['future']);

    const stopped = saveSpanQuestion(series(resolved), resolved.draft, { ...resolved.draft, recurrence: null });
    expect(stopped.lines).toEqual(['Every later event in this series will be deleted.']);
    expect(stopped.choices).toEqual([{ span: 'future', label: 'Save for future events', destructive: true }]);
  });

  it('asks this event or all events for a repeat set in another app (editable: false)', () => {
    const resolved = oneOnOne();
    const kept = saveSpanQuestion(series(resolved, [], false), resolved.draft, { ...resolved.draft, title: '1:1' });
    expect(kept.message).toBe('Its repeat was set in another app. Save your changes for this event only, or for all events?');
    expect(kept.choices.map((c) => [c.span, c.label])).toEqual([
      ['this', 'Save for this event only'],
      ['all', 'Save for all events'],
    ]);
    const moved = saveSpanQuestion(series(resolved, [], false), resolved.draft, {
      ...resolved.draft,
      start: at('2026-10-20T11:00'),
      end: at('2026-10-20T11:30'),
    });
    expect(moved.message).toBe('Its repeat was set in another app, so a new date can apply to this event only.');
    expect(moved.choices.map((c) => c.span)).toEqual(['this']);
  });

  it('asks before deleting', () => {
    expect(deleteQuestion(false)).toEqual({
      title: 'Delete this event?',
      message: '',
      lines: [],
      choices: [{ span: 'all', label: 'Delete event', destructive: true }],
    });
    const repeating = deleteQuestion(true);
    expect(repeating.message).toBe('Delete this event only, or this and all future events?');
    expect(repeating.choices.map((c) => c.label)).toEqual(['Delete this event only', 'Delete all future events']);
  });
});

describe('alerts on a calendar change, Duplicate and Changed', () => {
  const two: Alarm[] = [
    { kind: 'relative', offsetMinutes: -10 },
    { kind: 'relative', offsetMinutes: -60 },
  ];

  it('drops the alerts a calendar cannot keep, and says so', () => {
    expect(trimAlarms(two, home)).toEqual({ alarms: two, notice: null });
    expect(trimAlarms(two, { ...home, title: 'Work', maxAlarms: 1 })).toEqual({
      alarms: [two[0]],
      notice: 'Work keeps only 1 alert, so the second alert was removed.',
    });
    expect(trimAlarms(two, { ...home, title: 'Feeds', maxAlarms: 0 })).toEqual({
      alarms: [],
      notice: 'Feeds doesn’t keep alerts, so the alerts were removed.',
    });
  });

  it('duplicates into the same writable calendar without the repeat', () => {
    const bookClub = resolve('home/book-club|2026-10-19T19:00');
    const copy = duplicateDraft(bookClub, calendars, 'home');
    expect(copy.calendarId).toBe('home');
    expect(copy.recurrence).toBeNull();
    expect(copy.title).toBe(bookClub.draft.title);
    expect(copy.alarms).toEqual(bookClub.draft.alarms);
  });

  it('duplicates a read-only event into the default calendar', () => {
    const halloween = resolve('holidays/halloween|2026-10-31');
    expect(duplicateDraft(halloween, calendars, 'family').calendarId).toBe('family');
    expect(duplicateDraft(halloween, calendars, null).calendarId).toBe('home');
  });

  it('is dirty only when a field differs from the opened draft', () => {
    const draft = dentist().draft;
    expect(isDirty(draft, { ...draft })).toBe(false);
    expect(isDirty(draft, { ...draft, notes: 'x' })).toBe(true);
  });
});
