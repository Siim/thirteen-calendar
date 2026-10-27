/**
 * events/model.ts: validation, new-event defaults, the editor's start and
 * all-day rules, the three-way merge and alerts (docs/EVENTS.md §2.11, §2.14,
 * §3.1.1, §3.5, §4.7, §4.9, §5.2). Expectations are written out by hand from the spec.
 */
import { describe, expect, it } from 'vitest';
import { intlZoneResolver, syntheticZoneResolver } from '../../scripts/zone-resolvers.ts';
import {
  type Alarm,
  type CalendarInfo,
  type EventDraft,
  type EventRecurrence,
  type LocalDateTime,
  type ThirteenRule,
  alarmFireTime,
  alarmPresets,
  applyToSeries,
  changedFields,
  describeAlarm,
  formatLocalDateTime,
  mergeDraft,
  moveDraftStart,
  newEventDraft,
  parseLocalDateTime,
  setDraftAllDay,
  validateDraft,
} from '../../src/events/index.ts';
import { g } from '../helpers.ts';

const L = parseLocalDateTime;
const text = (value: LocalDateTime | null) => (value === null ? null : formatLocalDateTime(value));

const HOME: CalendarInfo = {
  id: 'home',
  title: 'Home',
  color: '#ea580c',
  accountId: 'icloud',
  accountTitle: 'iCloud',
  accountKind: 'icloud',
  writable: true,
  thirteenRepeats: 'all',
  maxAlarms: null,
  supportsAvailability: true,
  supportsUrl: true,
  isPlatformDefault: true,
};
const EXCHANGE: CalendarInfo = {
  ...HOME,
  id: 'work',
  title: 'Work',
  accountId: 'exchange',
  accountTitle: 'Exchange',
  accountKind: 'exchange',
  thirteenRepeats: 'gregorian-only',
  maxAlarms: 1,
  isPlatformDefault: false,
};

const thirteen = (rule: ThirteenRule, end: EventRecurrence['end'] = { kind: 'never' }): EventRecurrence => ({
  rule: { kind: 'thirteen', rule },
  end,
  extraDates: [],
  exceptDates: [],
});

/** Book club: Cotsworth (§6.7), Monday 2026-10-19 = IFC Thursday October 12, 19:00 to 21:00. */
const BOOK_CLUB: EventDraft = {
  title: 'Book club: Cotsworth',
  location: 'Raamatukoi',
  notes: '',
  url: '',
  allDay: false,
  start: L('2026-10-19T19:00'),
  end: L('2026-10-19T21:00'),
  timeZone: 'Europe/Tallinn',
  calendarId: 'home',
  recurrence: thirteen({ kind: 'monthly', system: 'ifc', day: 12 }),
  alarms: [{ kind: 'relative', offsetMinutes: -60 }],
  availability: 'busy',
};
const SINGLE: EventDraft = { ...BOOK_CLUB, recurrence: null };
const ALL_DAY: EventDraft = {
  ...SINGLE,
  title: 'Autumn school break',
  allDay: true,
  start: L('2026-10-19T00:00'),
  end: L('2026-10-25T24:00'),
  timeZone: null,
  alarms: [],
  availability: 'free',
};

const timed = (start: string, end: string, extra: Partial<EventDraft> = {}): EventDraft => ({
  ...SINGLE,
  start: L(start),
  end: L(end),
  ...extra,
});

describe('validateDraft', () => {
  it('accepts valid timed, zero-length, midnight-ending and all-day drafts', () => {
    expect(validateDraft(BOOK_CLUB, HOME)).toEqual([]);
    expect(validateDraft(ALL_DAY, HOME)).toEqual([]);
    expect(validateDraft(timed('2026-10-19T19:00', '2026-10-19T19:00'), HOME)).toEqual([]);
    expect(validateDraft(timed('2026-10-19T23:00', '2026-10-19T24:00'), HOME)).toEqual([]);
    expect(validateDraft(timed('2026-10-19T23:00', '2026-10-20T00:00'), HOME)).toEqual([]);
  });

  it('end-before-start: timed end before the start; all-day end that leaves no day', () => {
    expect(validateDraft(timed('2026-10-19T19:00', '2026-10-19T18:59'), HOME)).toEqual(['end-before-start']);
    const allDay = (end: string) => ({ ...ALL_DAY, end: L(end) });
    expect(validateDraft(allDay('2026-10-18T24:00'), HOME)).toEqual(['end-before-start']);
    expect(validateDraft(allDay('2026-10-19T00:00'), HOME)).toEqual(['end-before-start']);
    expect(validateDraft(allDay('2026-10-19T24:00'), HOME)).toEqual([]);
    expect(validateDraft(allDay('2026-10-20T00:00'), HOME)).toEqual([]);
  });

  it('out-of-range: starts before 1583, timed ends after 9999-12-29T24:00 (§3.1.1)', () => {
    expect(validateDraft(timed('1582-12-31T23:59', '1583-01-01T01:00'), HOME)).toEqual(['out-of-range']);
    expect(validateDraft(timed('1583-01-01T00:00', '1583-01-01T01:00'), HOME)).toEqual([]);
    expect(validateDraft(timed('9999-12-29T23:00', '9999-12-29T24:00'), HOME)).toEqual([]);
    expect(validateDraft(timed('9999-12-29T23:00', '9999-12-30T00:01'), HOME)).toEqual(['out-of-range']);
    expect(validateDraft(timed('9999-12-30T09:00', '9999-12-30T10:00'), HOME)).toEqual(['out-of-range']);
    expect(validateDraft({ ...ALL_DAY, start: L('9999-12-31T00:00'), end: L('9999-12-31T24:00') }, HOME)).toEqual([]);
    expect(validateDraft({ ...ALL_DAY, start: L('1582-10-15T00:00'), end: L('1582-10-15T24:00') }, HOME)).toEqual([
      'out-of-range',
    ]);
  });

  it('until-before-start and count-out-of-range (1 to 999)', () => {
    const monthly12 = { kind: 'monthly', system: 'ifc', day: 12 } as const;
    const withEnd = (end: EventRecurrence['end']) => ({ ...BOOK_CLUB, recurrence: thirteen(monthly12, end) });
    expect(validateDraft(withEnd({ kind: 'until', date: g('2026-10-18') }), HOME)).toEqual(['until-before-start']);
    expect(validateDraft(withEnd({ kind: 'until', date: g('2026-10-19') }), HOME)).toEqual([]);
    for (const count of [1, 2, 999]) expect(validateDraft(withEnd({ kind: 'count', count }), HOME)).toEqual([]);
    for (const count of [0, -1, 1000, 2.5]) {
      expect(validateDraft(withEnd({ kind: 'count', count }), HOME)).toEqual(['count-out-of-range']);
    }
  });

  it('calendar-read-only and too-many-alarms', () => {
    expect(validateDraft(SINGLE, { ...HOME, writable: false })).toEqual(['calendar-read-only']);
    const twoAlarms: EventDraft = { ...SINGLE, alarms: [...SINGLE.alarms, { kind: 'relative', offsetMinutes: -15 }] };
    expect(validateDraft(twoAlarms, EXCHANGE)).toEqual(['too-many-alarms']);
    expect(validateDraft(SINGLE, EXCHANGE)).toEqual([]);
    expect(validateDraft(SINGLE, { ...HOME, maxAlarms: 0 })).toEqual(['too-many-alarms']);
    expect(validateDraft({ ...SINGLE, alarms: [] }, { ...HOME, maxAlarms: 0 })).toEqual([]);
  });

  describe('thirteen-repeat-not-allowed on gregorian-only calendars (§3.5, §4.3)', () => {
    const on = (rule: ThirteenRule, start: string) => validateDraft(
      { ...timed(`${start}T19:00`, `${start}T21:00`), recurrence: thirteen(rule) },
      EXCHANGE,
    );
    it.each([
      // Form (b), BYYEARDAY: never Exchange-safe.
      [{ kind: 'monthly', system: 'ifc', day: 12 }, '2026-10-19', false],
      [{ kind: 'weekly', system: 'ifc', weekday: 4, interval: 1 }, '2026-10-19', false],
      [{ kind: 'weekly', system: 'positivist', weekday: 5, interval: 2 }, '2026-10-19', false],
      [{ kind: 'yearly', system: 'ifc', month: 4, day: 12 }, '2026-04-06', false],
      [{ kind: 'yearly', system: 'ifc', month: 3, day: 4 }, '2026-03-01', false],
      [{ kind: 'yearly', system: 'ifc', month: 6, day: 28 }, '2026-06-17', false],
      [{ kind: 'yearly', system: 'positivist', month: 3, day: 4 }, '2026-03-01', false],
      [{ kind: 'yearly', system: 'positivist', month: 13, day: 28 }, '2026-12-30', false],
      [{ kind: 'intercalary', system: 'positivist', id: 'year-day' }, '2026-12-31', false],
      // Form (a), plain yearly, and form (c), leap interval: Exchange-safe.
      [{ kind: 'yearly', system: 'ifc', month: 1, day: 1 }, '2026-01-01', true],
      [{ kind: 'yearly', system: 'ifc', month: 3, day: 3 }, '2026-02-28', true],
      [{ kind: 'yearly', system: 'ifc', month: 7, day: 1 }, '2026-06-18', true],
      [{ kind: 'yearly', system: 'ifc', month: 11, day: 12 }, '2026-10-19', true],
      [{ kind: 'yearly', system: 'ifc', month: 13, day: 28 }, '2026-12-30', true],
      [{ kind: 'yearly', system: 'positivist', month: 3, day: 3 }, '2026-02-28', true],
      [{ kind: 'intercalary', system: 'ifc', id: 'year-day' }, '2026-12-31', true],
      [{ kind: 'intercalary', system: 'ifc', id: 'leap-day' }, '2024-06-17', true],
      [{ kind: 'intercalary', system: 'positivist', id: 'leap-day' }, '2024-12-31', true],
    ] as [ThirteenRule, string, boolean][])('%j from %s: safe %s', (rule, start, safe) => {
      expect(on(rule, start)).toEqual(safe ? [] : ['thirteen-repeat-not-allowed']);
    });

    it('is allowed in calendars that keep every repeat, and Gregorian rules never trigger it', () => {
      expect(validateDraft(BOOK_CLUB, HOME)).toEqual([]);
      const dates: EventDraft = { ...SINGLE, recurrence: { rule: { kind: 'dates' }, end: { kind: 'never' }, extraDates: [], exceptDates: [] } };
      expect(validateDraft(dates, EXCHANGE)).toEqual([]);
    });
  });

  it('repeat-not-on-start: the 13-month rule must produce the start date (§4.2)', () => {
    const at = (rule: ThirteenRule, start: string) =>
      validateDraft({ ...timed(`${start}T19:00`, `${start}T21:00`), recurrence: thirteen(rule) }, HOME);
    expect(at({ kind: 'monthly', system: 'ifc', day: 12 }, '2026-10-19')).toEqual([]);
    expect(at({ kind: 'monthly', system: 'ifc', day: 12 }, '2026-10-20')).toEqual(['repeat-not-on-start']);
    expect(at({ kind: 'monthly', system: 'ifc', day: 28 }, '2026-12-31')).toEqual(['repeat-not-on-start']);
    expect(at({ kind: 'weekly', system: 'ifc', weekday: 4, interval: 2 }, '2026-10-26')).toEqual([]);
    expect(at({ kind: 'weekly', system: 'ifc', weekday: 4, interval: 1 }, '2026-10-20')).toEqual(['repeat-not-on-start']);
    expect(at({ kind: 'yearly', system: 'ifc', month: 11, day: 12 }, '2026-10-20')).toEqual(['repeat-not-on-start']);
    expect(at({ kind: 'intercalary', system: 'ifc', id: 'year-day' }, '2026-12-31')).toEqual([]);
    expect(at({ kind: 'intercalary', system: 'ifc', id: 'year-day' }, '2026-12-30')).toEqual(['repeat-not-on-start']);
    expect(at({ kind: 'intercalary', system: 'ifc', id: 'leap-day' }, '2024-06-18')).toEqual(['repeat-not-on-start']);
    // The rule's own system decides: 2024-10-19 is IFC October 12 but Positivist Descartes 13.
    expect(at({ kind: 'monthly', system: 'ifc', day: 12 }, '2024-10-19')).toEqual([]);
    expect(at({ kind: 'monthly', system: 'positivist', day: 12 }, '2024-10-19')).toEqual(['repeat-not-on-start']);
    // Positivist All the Dead is December 30 in a leap year.
    expect(at({ kind: 'intercalary', system: 'positivist', id: 'year-day' }, '2024-12-30')).toEqual([]);
  });

  it.each([
    ['https://example.com', true],
    ['example.com', true],
    ['example.com/path?x=1#top', true],
    ['www.example.co.uk', true],
    ['localhost:3000', true],
    ['http://intranet/page', true],
    ['https://user:secret@example.com:8443/a', true],
    ['https://[::1]:8080/', true],
    ['https://tähtpäev.ee', true],
    ['192.168.1.10:8080', true],
    ['example', false],
    ['http://', false],
    ['https://', false],
    ['not a url', false],
    [' https://example.com', false],
    ['https://example.com\n', false],
    ['https://example..com', false],
    ['https://.com', false],
    ['https://example.com:99999', false],
    ['https://example.com:http', false],
    ['javascript:alert(1)', false],
    ['//example.com', false],
  ])('invalid-url: %j valid %s', (url, valid) => {
    expect(validateDraft({ ...SINGLE, url }, HOME)).toEqual(valid ? [] : ['invalid-url']);
  });

  it('reports every issue in the documented order', () => {
    const draft: EventDraft = {
      ...BOOK_CLUB,
      start: L('1582-10-20T19:00'),
      end: L('1582-10-20T18:00'),
      recurrence: thirteen({ kind: 'monthly', system: 'ifc', day: 12 }, { kind: 'until', date: g('1582-10-19') }),
      alarms: [
        { kind: 'relative', offsetMinutes: -60 },
        { kind: 'relative', offsetMinutes: -15 },
      ],
      url: 'example',
    };
    expect(validateDraft(draft, { ...EXCHANGE, writable: false })).toEqual([
      'end-before-start',
      'out-of-range',
      'until-before-start',
      'calendar-read-only',
      'thirteen-repeat-not-allowed',
      'too-many-alarms',
      'repeat-not-on-start',
      'invalid-url',
    ]);
    const counted: EventDraft = { ...draft, recurrence: thirteen({ kind: 'monthly', system: 'ifc', day: 12 }, { kind: 'count', count: 0 }) };
    expect(validateDraft(counted, { ...EXCHANGE, writable: false }).at(-1)).toBe('count-out-of-range');
  });

  it('throws for malformed drafts and calendars, never for issues', () => {
    const bad = (patch: Record<string, unknown>) => () => validateDraft({ ...SINGLE, ...patch } as EventDraft, HOME);
    expect(bad({ title: 3 })).toThrow(RangeError);
    expect(bad({ start: L('2026-10-19T24:00') })).toThrow(RangeError);
    expect(bad({ end: { date: g('2026-10-19'), minute: 1441 } })).toThrow(RangeError);
    expect(bad({ timeZone: '' })).toThrow(RangeError);
    expect(bad({ availability: 'maybe' })).toThrow(RangeError);
    expect(bad({ alarms: [{ kind: 'relative', offsetMinutes: 1.5 }] })).toThrow(RangeError);
    expect(bad({ alarms: [{ kind: 'absolute', at: L('2026-10-19T24:00') }] })).toThrow(RangeError);
    expect(bad({ recurrence: { rule: { kind: 'thirteen', rule: { kind: 'monthly', system: 'ifc', day: 29 } }, end: { kind: 'never' }, extraDates: [], exceptDates: [] } })).toThrow(RangeError);
    expect(bad({ recurrence: { rule: { kind: 'weekly' }, end: { kind: 'never' }, extraDates: [], exceptDates: [] } })).toThrow(RangeError);
    expect(bad({ recurrence: thirteen({ kind: 'monthly', system: 'ifc', day: 12 }, { kind: 'until', date: { year: 2026, month: 2, day: 30 } }) })).toThrow(RangeError);
    // All-day drafts: T00:00 start, T24:00 (or T00:00) end, no zone.
    expect(() => validateDraft({ ...ALL_DAY, timeZone: 'Europe/Tallinn' }, HOME)).toThrow(RangeError);
    expect(() => validateDraft({ ...ALL_DAY, start: L('2026-10-19T09:00') }, HOME)).toThrow(RangeError);
    expect(() => validateDraft({ ...ALL_DAY, end: L('2026-10-25T12:00') }, HOME)).toThrow(RangeError);
    expect(() => validateDraft(SINGLE, { ...HOME, color: 'orange' })).toThrow(RangeError);
    expect(() => validateDraft(SINGLE, { ...HOME, thirteenRepeats: 'some' as 'all' })).toThrow(RangeError);
    expect(() => validateDraft(SINGLE, { ...HOME, maxAlarms: -1 })).toThrow(RangeError);
    // A CalendarEvent (extra fields) is a valid draft.
    expect(validateDraft({ ...SINGLE, id: 'x', status: 'confirmed' } as EventDraft, HOME)).toEqual([]);
  });
});

describe('newEventDraft (§2.11)', () => {
  const today = g('2026-10-19');
  const times = (draft: EventDraft) => [text(draft.start), text(draft.end)];

  it.each([
    ['2026-10-19T10:20', '2026-10-19T11:00', '2026-10-19T12:00'],
    ['2026-10-19T10:00', '2026-10-19T11:00', '2026-10-19T12:00'],
    ['2026-10-19T00:00', '2026-10-19T01:00', '2026-10-19T02:00'],
    ['2026-10-19T21:59', '2026-10-19T22:00', '2026-10-19T23:00'],
    ['2026-10-19T22:00', '2026-10-19T23:00', '2026-10-19T24:00'],
    ['2026-10-19T23:00', '2026-10-19T23:00', '2026-10-19T24:00'],
    ['2026-10-19T23:30', '2026-10-19T23:00', '2026-10-19T24:00'],
    ['2026-10-19T23:59', '2026-10-19T23:00', '2026-10-19T24:00'],
  ])('today at %s: %s to %s', (now, start, end) => {
    expect(times(newEventDraft(today, L(now), 'home'))).toEqual([start, end]);
  });

  it('starts at 09:00 on any other day', () => {
    expect(times(newEventDraft(g('2026-10-20'), L('2026-10-19T10:20'), 'home'))).toEqual(['2026-10-20T09:00', '2026-10-20T10:00']);
    expect(times(newEventDraft(g('2026-10-18'), L('2026-10-19T23:30'), 'home'))).toEqual(['2026-10-18T09:00', '2026-10-18T10:00']);
  });

  it('has the §2.11 defaults', () => {
    expect(newEventDraft(today, L('2026-10-19T10:20'), 'home', { timeZone: 'Europe/Tallinn' })).toEqual({
      title: '',
      location: '',
      notes: '',
      url: '',
      allDay: false,
      start: L('2026-10-19T11:00'),
      end: L('2026-10-19T12:00'),
      timeZone: 'Europe/Tallinn',
      calendarId: 'home',
      recurrence: null,
      alarms: [],
      availability: 'busy',
    });
    expect(newEventDraft(today, L('2026-10-19T10:20'), 'home').timeZone).toBeNull();
  });

  it('all-day: the whole day, no zone, Show as Free', () => {
    const draft = newEventDraft(g('2026-12-31'), L('2026-10-19T10:20'), 'home', { allDay: true, timeZone: 'Europe/Tallinn' });
    expect(times(draft)).toEqual(['2026-12-31T00:00', '2026-12-31T24:00']);
    expect(draft.timeZone).toBeNull();
    expect(draft.availability).toBe('free');
    expect(validateDraft(draft, HOME)).toEqual([]);
  });

  it('works at the end of the range without leaving it', () => {
    expect(times(newEventDraft(g('9999-12-31'), L('9999-12-31T23:30'), 'home'))).toEqual(['9999-12-31T23:00', '9999-12-31T24:00']);
    expect(times(newEventDraft(g('9999-12-31'), L('9999-12-31T23:30'), 'home', { allDay: true }))).toEqual([
      '9999-12-31T00:00',
      '9999-12-31T24:00',
    ]);
  });

  it('rejects invalid arguments', () => {
    expect(() => newEventDraft(g('2026-10-19'), L('2026-10-19T24:00'), 'home')).toThrow(RangeError);
    expect(() => newEventDraft({ year: 2026, month: 2, day: 30 }, L('2026-10-19T10:00'), 'home')).toThrow(RangeError);
    expect(() => newEventDraft(today, L('2026-10-19T10:00'), 3 as unknown as string)).toThrow(RangeError);
    expect(() => newEventDraft(today, L('2026-10-19T10:00'), 'home', { allDay: 'yes' as unknown as boolean })).toThrow(RangeError);
    expect(() => newEventDraft(today, L('2026-10-19T10:00'), 'home', { zone: 'UTC' } as never)).toThrow(RangeError);
    expect(() => newEventDraft(today, L('2026-10-19T10:00'), 'home', { timeZone: '' })).toThrow(RangeError);
  });
});

describe('moveDraftStart (§2.11)', () => {
  it('keeps the wall-clock duration and every other field', () => {
    const { draft, repeatChange } = moveDraftStart(SINGLE, L('2026-10-21T14:30'));
    expect([text(draft.start), text(draft.end)]).toEqual(['2026-10-21T14:30', '2026-10-21T16:30']);
    expect(repeatChange).toBe('none');
    expect({ ...draft, start: SINGLE.start, end: SINGLE.end }).toEqual(SINGLE);
  });

  it('writes a midnight end in end-of-day form and moves overnight events', () => {
    expect(text(moveDraftStart(SINGLE, L('2026-10-19T22:00')).draft.end)).toBe('2026-10-19T24:00');
    const overnight = timed('2026-10-19T22:00', '2026-10-20T01:30');
    expect(text(moveDraftStart(overnight, L('2026-12-31T23:00')).draft.end)).toBe('2027-01-01T02:30');
  });

  it('keeps the number of days of an all-day event', () => {
    const { draft } = moveDraftStart(ALL_DAY, L('2026-12-28T00:00'));
    expect([text(draft.start), text(draft.end)]).toEqual(['2026-12-28T00:00', '2027-01-03T24:00']);
    expect(() => moveDraftStart(ALL_DAY, L('2026-12-28T09:00'))).toThrow(RangeError);
  });

  it('stops an end that would pass 9999-12-31T24:00', () => {
    expect(text(moveDraftStart(ALL_DAY, L('9999-12-29T00:00')).draft.end)).toBe('9999-12-31T24:00');
    const moved = moveDraftStart(SINGLE, L('9999-12-31T23:00')).draft;
    expect(text(moved.end)).toBe('9999-12-31T24:00');
    expect(validateDraft(moved, HOME)).toEqual(['out-of-range']);
  });

  it('adapts the repeat and reports the change', () => {
    const moved = (start: string) => moveDraftStart(BOOK_CLUB, L(`${start}T19:00`));
    expect(moved('2026-11-16').repeatChange).toBe('none'); // IFC November 12
    const adapted = moved('2026-10-20'); // IFC October 13
    expect(adapted.repeatChange).toBe('adapted');
    expect(adapted.draft.recurrence?.rule).toEqual({ kind: 'thirteen', rule: { kind: 'monthly', system: 'ifc', day: 13 } });
    const dropped = moved('2026-12-31'); // Year Day
    expect(dropped.repeatChange).toBe('dropped');
    expect(dropped.draft.recurrence).toBeNull();
    expect(validateDraft(adapted.draft, HOME)).toEqual([]);
  });

  it('a drag from IFC March 3 to March 4 needs a repeat Exchange cannot keep (§2.11 drag check)', () => {
    const march3 = { ...timed('2026-02-28T19:00', '2026-02-28T21:00'), recurrence: thirteen({ kind: 'yearly', system: 'ifc', month: 3, day: 3 }) };
    expect(validateDraft(march3, EXCHANGE)).toEqual([]);
    const { draft, repeatChange } = moveDraftStart(march3, L('2026-03-01T19:00'));
    expect(repeatChange).toBe('adapted');
    expect(draft.recurrence?.rule).toEqual({ kind: 'thirteen', rule: { kind: 'yearly', system: 'ifc', month: 3, day: 4 } });
    expect(validateDraft(draft, EXCHANGE)).toEqual(['thirteen-repeat-not-allowed']);
  });

  it('validates its arguments', () => {
    expect(() => moveDraftStart(SINGLE, L('2026-10-19T24:00'))).toThrow(RangeError);
    expect(() => moveDraftStart(SINGLE, L('2026-10-19T10:00'), 'julian' as 'ifc')).toThrow(RangeError);
  });
});

describe('setDraftAllDay (§2.11)', () => {
  it('turning on keeps the covered dates, drops times and the zone, and sets Free', () => {
    const on = setDraftAllDay(timed('2026-10-19T22:00', '2026-10-20T01:30'), true);
    expect([text(on.start), text(on.end), on.timeZone, on.availability, on.allDay]).toEqual([
      '2026-10-19T00:00',
      '2026-10-20T24:00',
      null,
      'free',
      true,
    ]);
    expect(text(setDraftAllDay(timed('2026-10-19T23:00', '2026-10-19T24:00'), true).end)).toBe('2026-10-19T24:00');
    expect(text(setDraftAllDay(timed('2026-10-19T00:00', '2026-10-19T00:00'), true).end)).toBe('2026-10-19T24:00');
    expect(text(setDraftAllDay(timed('2026-10-19T10:00', '2026-10-22T00:00'), true).end)).toBe('2026-10-21T24:00');
    expect(validateDraft(on, HOME)).toEqual([]);
  });

  it('keeps a Show as the user chose in this editor', () => {
    expect(setDraftAllDay(SINGLE, true, { availabilityTouched: true }).availability).toBe('busy');
    expect(setDraftAllDay(ALL_DAY, false, { availabilityTouched: true }).availability).toBe('free');
  });

  it('turning off restores the last times or 09:00 to 10:00, Busy, floating unless a zone is given', () => {
    const off = setDraftAllDay(ALL_DAY, false);
    expect([text(off.start), text(off.end), off.timeZone, off.availability]).toEqual([
      '2026-10-19T09:00',
      '2026-10-25T10:00',
      null,
      'busy',
    ]);
    const single = { ...ALL_DAY, end: L('2026-10-19T24:00') };
    const restored = setDraftAllDay(single, false, { previousTimes: { start: 19 * 60, end: 21 * 60 } });
    expect([text(restored.start), text(restored.end)]).toEqual(['2026-10-19T19:00', '2026-10-19T21:00']);
    const overnight = setDraftAllDay(single, false, { previousTimes: { start: 22 * 60, end: 90 } });
    expect([text(overnight.start), text(overnight.end)]).toEqual(['2026-10-19T22:00', '2026-10-20T01:30']);
    const midnight = setDraftAllDay(single, false, { previousTimes: { start: 23 * 60, end: 1440 } });
    expect([text(midnight.start), text(midnight.end)]).toEqual(['2026-10-19T23:00', '2026-10-19T24:00']);
    // A new event made all-day takes the device zone when it becomes timed (§3.1, §3.3).
    const created = newEventDraft(g('2026-10-19'), L('2026-10-19T10:20'), 'home', { allDay: true, timeZone: 'Europe/Tallinn' });
    expect(created.timeZone).toBeNull();
    expect(setDraftAllDay(created, false, { timeZone: 'Europe/Tallinn' }).timeZone).toBe('Europe/Tallinn');
    expect(setDraftAllDay(created, false, { timeZone: null }).timeZone).toBeNull();
    // Turning all-day on drops the zone whatever the option says.
    expect(setDraftAllDay(timed('2026-10-19T10:00', '2026-10-19T11:00'), true, { timeZone: 'Europe/Tallinn' }).timeZone).toBeNull();
  });

  it('round-trips a timed event through all-day, its zone included', () => {
    const original = timed('2026-10-19T22:00', '2026-10-20T01:30');
    expect(original.timeZone).not.toBeNull();
    const back = setDraftAllDay(setDraftAllDay(original, true), false, { previousTimes: { start: 22 * 60, end: 90 }, timeZone: original.timeZone });
    expect(back).toEqual(original);
    expect(changedFields(original, back)).toEqual([]);
    // A new event toggled on and off keeps the device zone it was made with.
    const fresh = newEventDraft(g('2026-10-19'), L('2026-10-19T10:20'), 'home', { timeZone: 'Europe/Tallinn' });
    const toggled = setDraftAllDay(setDraftAllDay(fresh, true), false, { previousTimes: { start: 660, end: 720 }, timeZone: fresh.timeZone });
    expect(changedFields(fresh, toggled)).toEqual([]);
    expect(toggled.timeZone).toBe('Europe/Tallinn');
  });

  it('keeps repeat and alerts; the same value returns a copy', () => {
    expect(setDraftAllDay(BOOK_CLUB, true).recurrence).toEqual(BOOK_CLUB.recurrence);
    expect(setDraftAllDay(BOOK_CLUB, true).alarms).toEqual(BOOK_CLUB.alarms);
    const same = setDraftAllDay(BOOK_CLUB, false);
    expect(same).toEqual(BOOK_CLUB);
    expect(same).not.toBe(BOOK_CLUB);
    expect(same.recurrence).not.toBe(BOOK_CLUB.recurrence);
  });

  it('rejects invalid options', () => {
    expect(() => setDraftAllDay(ALL_DAY, false, { previousTimes: { start: 1440, end: 1440 } })).toThrow(RangeError);
    expect(() => setDraftAllDay(ALL_DAY, false, { previousTimes: { start: 0, end: 1441 } })).toThrow(RangeError);
    expect(() => setDraftAllDay(ALL_DAY, false, { touched: true } as never)).toThrow(RangeError);
    expect(() => setDraftAllDay(ALL_DAY, 'no' as unknown as boolean)).toThrow(RangeError);
    expect(() => setDraftAllDay(ALL_DAY, false, { timeZone: '' })).toThrow(RangeError);
    expect(() => setDraftAllDay(ALL_DAY, false, { timeZone: 3 as never })).toThrow(RangeError);
  });
});

describe('changedFields and mergeDraft (§2.11, §4.9)', () => {
  it('lists changed groups in field order; time compares moments', () => {
    expect(changedFields(BOOK_CLUB, BOOK_CLUB)).toEqual([]);
    expect(changedFields(BOOK_CLUB, { ...BOOK_CLUB, availability: 'free', title: 'X', end: L('2026-10-19T22:00') })).toEqual([
      'title',
      'time',
      'availability',
    ]);
    const midnight = timed('2026-10-19T23:00', '2026-10-19T24:00');
    expect(changedFields(midnight, { ...midnight, end: L('2026-10-20T00:00') })).toEqual([]);
    expect(changedFields(BOOK_CLUB, { ...BOOK_CLUB, timeZone: 'UTC' })).toEqual(['time']);
    expect(changedFields(BOOK_CLUB, { ...BOOK_CLUB, calendarId: 'work' })).toEqual(['calendar']);
    expect(changedFields(BOOK_CLUB, { ...BOOK_CLUB, recurrence: null })).toEqual(['recurrence']);
    expect(
      changedFields(BOOK_CLUB, { ...BOOK_CLUB, recurrence: { ...BOOK_CLUB.recurrence!, exceptDates: [{ date: g('2026-11-16'), minute: null }] } }),
    ).toEqual(['recurrence']);
    const two: Alarm[] = [
      { kind: 'relative', offsetMinutes: -60 },
      { kind: 'relative', offsetMinutes: -15 },
    ];
    expect(changedFields({ ...BOOK_CLUB, alarms: two }, { ...BOOK_CLUB, alarms: [...two].reverse() })).toEqual(['alarms']);
  });

  it('takes written groups from edited and the rest from current', () => {
    const edited = { ...BOOK_CLUB, title: 'Book club (moved)', start: L('2026-10-19T20:00'), end: L('2026-10-19T22:00') };
    const current = { ...BOOK_CLUB, notes: 'Bring the pamphlet.', title: 'Book club: Cotsworth and Comte' };
    const { merged, written, conflicts } = mergeDraft(BOOK_CLUB, edited, current);
    expect(written).toEqual(['title', 'time']);
    expect(conflicts).toEqual(['title']);
    expect(merged).toEqual({ ...edited, notes: 'Bring the pamphlet.' });
  });

  it('the same change on both sides is written but is no conflict', () => {
    const change = { ...BOOK_CLUB, location: 'Rahva Raamat' };
    expect(mergeDraft(BOOK_CLUB, change, change)).toEqual({ merged: change, written: ['location'], conflicts: [] });
  });

  it('a change elsewhere to an untouched group is kept and not written', () => {
    const current = { ...BOOK_CLUB, recurrence: null, alarms: [] };
    expect(mergeDraft(BOOK_CLUB, BOOK_CLUB, current)).toEqual({ merged: current, written: [], conflicts: [] });
  });

  it('returns fresh values with only the draft fields', () => {
    const current = { ...BOOK_CLUB, id: 'event-1' } as EventDraft;
    const { merged } = mergeDraft(BOOK_CLUB, BOOK_CLUB, current);
    expect(Object.keys(merged)).toEqual(Object.keys(BOOK_CLUB));
    expect(merged.start).not.toBe(current.start);
    expect(merged.recurrence).not.toBe(current.recurrence);
    expect(merged.alarms).not.toBe(current.alarms);
  });
});

describe('applyToSeries (§4.7 "Save for all events")', () => {
  /** A series from Monday, January 5, 2026, 19:00 to 20:00, opened on its occurrence of October 19. */
  const master = timed('2026-01-05T19:00', '2026-01-05T20:00', { recurrence: BOOK_CLUB.recurrence });
  const opened = timed('2026-10-19T19:00', '2026-10-19T20:00', { recurrence: BOOK_CLUB.recurrence });

  it('keeps the master date and takes the start minute, length, all-day setting and zone', () => {
    const result = applyToSeries(master, opened, { ...opened, start: L('2026-10-19T08:15'), end: L('2026-10-19T10:00'), timeZone: 'UTC' }, null);
    expect(result).toEqual({
      master: { ...master, start: L('2026-01-05T08:15'), end: L('2026-01-05T10:00'), timeZone: 'UTC' },
      override: null,
      written: ['time'],
      retime: { minuteDelta: -645, allDay: null },
    });
  });

  it('takes the start minute as an absolute time, not a delta from an override with its own time', () => {
    const own = timed('2026-10-19T20:00', '2026-10-19T21:00');
    const edited = { ...own, start: L('2026-10-19T19:30'), end: L('2026-10-19T20:30') };
    const result = applyToSeries(master, own, edited, own);
    expect(result.master.start).toEqual(L('2026-01-05T19:30'));
    expect(result.override).toEqual(edited);
    expect(result.retime).toEqual({ minuteDelta: 30, allDay: null });
  });

  it('turns all-day on and off with the length in days', () => {
    const allDay = applyToSeries(master, opened, { ...opened, allDay: true, start: L('2026-10-19T00:00'), end: L('2026-10-20T24:00'), timeZone: null }, null);
    expect(allDay.master).toMatchObject({ allDay: true, start: L('2026-01-05T00:00'), end: L('2026-01-06T24:00'), timeZone: null });
    expect(allDay.retime).toEqual({ minuteDelta: -1140, allDay: 'to-all-day' });
    const dayMaster = { ...ALL_DAY, start: L('2026-01-05T00:00'), end: L('2026-01-05T24:00'), recurrence: BOOK_CLUB.recurrence };
    const dayOpened = { ...dayMaster, start: L('2026-10-19T00:00'), end: L('2026-10-19T24:00') };
    const timedEdit = { ...dayOpened, allDay: false, start: L('2026-10-19T23:00'), end: L('2026-10-20T01:00'), timeZone: 'Europe/Tallinn' };
    const back = applyToSeries(dayMaster, dayOpened, timedEdit, null);
    expect(back.master).toMatchObject({ allDay: false, start: L('2026-01-05T23:00'), end: L('2026-01-06T01:00'), timeZone: 'Europe/Tallinn' });
    expect(back.retime).toEqual({ minuteDelta: 1380, allDay: 'to-timed' });
    // A zero-length all-day edit still covers one day.
    const zero = applyToSeries(dayMaster, dayOpened, { ...dayOpened, end: L('2026-10-19T00:00') }, null);
    expect(zero.master.end).toEqual(L('2026-01-05T24:00'));
  });

  it('leaves the time group alone when the user did not change it', () => {
    const elsewhere = { ...master, notes: 'Changed in another app.', start: L('2026-01-05T18:00'), end: L('2026-01-05T19:00') };
    const result = applyToSeries(elsewhere, opened, { ...opened, title: 'Renamed', alarms: [] }, null);
    expect(result).toEqual({
      master: { ...elsewhere, title: 'Renamed', alarms: [] },
      override: null,
      written: ['title', 'alarms'],
      retime: null,
    });
  });

  it('applies the written groups to the override, but never a repeat', () => {
    const own = timed('2026-10-19T20:00', '2026-10-19T21:00', { notes: 'Own notes' });
    const edited = { ...own, title: 'Renamed', calendarId: 'work', recurrence: null };
    const changedRepeat = { ...opened, recurrence: null, location: 'Elsewhere' };
    expect(applyToSeries(master, own, edited, own)).toEqual({
      master: { ...master, title: 'Renamed', calendarId: 'work' },
      override: { ...own, title: 'Renamed', calendarId: 'work' },
      written: ['title', 'calendar'],
      retime: null,
    });
    const result = applyToSeries(master, opened, changedRepeat, own);
    expect(result.written).toEqual(['location', 'recurrence']);
    expect(result.master.recurrence).toBeNull();
    expect(result.override).toEqual({ ...own, location: 'Elsewhere' });
  });

  it('stops an end at 9999-12-31T24:00 and returns fresh values', () => {
    // An occurrence opened before the master's date (an override moved earlier) with a 2-hour length.
    const late = timed('9999-12-31T22:00', '9999-12-31T23:00', { recurrence: BOOK_CLUB.recurrence });
    const earlier = timed('9999-12-30T22:00', '9999-12-30T23:00');
    const result = applyToSeries(late, earlier, { ...earlier, start: L('9999-12-30T23:00'), end: L('9999-12-31T01:00') }, null);
    expect(result.master).toMatchObject({ start: L('9999-12-31T23:00'), end: L('9999-12-31T24:00') });
    expect(result.retime).toEqual({ minuteDelta: 60, allDay: null });
    const same = applyToSeries(master, opened, opened, null);
    expect(same).toEqual({ master, override: null, written: [], retime: null });
    expect(same.master.start).not.toBe(master.start);
    expect(Object.keys(applyToSeries({ ...master, id: 'x' } as EventDraft, opened, opened, null).master)).toEqual(Object.keys(BOOK_CLUB));
  });

  it('throws for malformed drafts', () => {
    expect(() => applyToSeries({ ...master, title: 1 } as unknown as EventDraft, opened, opened, null)).toThrow(RangeError);
    expect(() => applyToSeries(master, null as unknown as EventDraft, opened, null)).toThrow(RangeError);
    expect(() => applyToSeries(master, opened, { ...opened, availability: 'maybe' } as unknown as EventDraft, null)).toThrow(RangeError);
    expect(() => applyToSeries(master, opened, opened, { ...opened, alarms: 'none' } as unknown as EventDraft)).toThrow(RangeError);
  });
});

describe('alarmPresets and describeAlarm (§2.14, copy catalogue alert.*)', () => {
  it('timed presets', () => {
    expect(alarmPresets(false).map((p) => [p.id, p.label, p.alarm?.kind === 'relative' ? p.alarm.offsetMinutes : null])).toEqual([
      ['none', 'None', null],
      ['at-time', 'At time of event', 0],
      ['before-5m', '5 minutes before', -5],
      ['before-10m', '10 minutes before', -10],
      ['before-15m', '15 minutes before', -15],
      ['before-30m', '30 minutes before', -30],
      ['before-1h', '1 hour before', -60],
      ['before-2h', '2 hours before', -120],
      ['before-1d', '1 day before', -1440],
      ['before-2d', '2 days before', -2880],
      ['before-1w', '1 week before', -10080],
    ]);
    expect(alarmPresets(false, { allowAfterStart: false, use24Hour: false })).toEqual(alarmPresets(false));
  });

  it('all-day presets at 09:00, in 24 and 12-hour form, with and without the after-start preset', () => {
    const rows = (options: { allowAfterStart?: boolean; use24Hour?: boolean }) =>
      alarmPresets(true, options).map((p) => [p.id, p.label, p.alarm?.kind === 'relative' ? p.alarm.offsetMinutes : null]);
    expect(rows({})).toEqual([
      ['none', 'None', null],
      ['day-at-0900', 'On the day at 09:00', 540],
      ['before-1d-at-0900', '1 day before at 09:00', -900],
      ['before-2d-at-0900', '2 days before at 09:00', -2340],
      ['before-1w-at-0900', '1 week before at 09:00', -9540],
    ]);
    expect(rows({ use24Hour: false, allowAfterStart: false })).toEqual([
      ['none', 'None', null],
      ['before-1d-at-0900', '1 day before at 9:00 AM', -900],
      ['before-2d-at-0900', '2 days before at 9:00 AM', -2340],
      ['before-1w-at-0900', '1 week before at 9:00 AM', -9540],
    ]);
  });

  it('describes alerts that match no preset', () => {
    const rel = (offsetMinutes: number): Alarm => ({ kind: 'relative', offsetMinutes });
    expect(describeAlarm(rel(-45), false)).toBe('45 minutes before');
    expect(describeAlarm(rel(-1), false)).toBe('1 minute before');
    expect(describeAlarm(rel(-90), false)).toBe('90 minutes before');
    expect(describeAlarm(rel(-180), false)).toBe('3 hours before');
    expect(describeAlarm(rel(-20160), false)).toBe('14 days before');
    expect(describeAlarm(rel(10), false)).toBe('10 minutes after');
    expect(describeAlarm(rel(1), false)).toBe('1 minute after');
    expect(describeAlarm(rel(-15), true)).toBe('1 day before at 23:45');
    expect(describeAlarm(rel(-1440 * 3 + 1110), true)).toBe('3 days before at 18:30');
    expect(describeAlarm(rel(0), true)).toBe('On the day at 00:00');
    expect(describeAlarm(rel(0), true, 'ifc', { use24Hour: false })).toBe('On the day at 12:00 AM');
    expect(describeAlarm(rel(720), true, 'ifc', { use24Hour: false })).toBe('On the day at 12:00 PM');
    expect(describeAlarm(rel(1500), true)).toBe('1500 minutes after');
  });

  it('names the 13-month date of an absolute alert (§2.14 example)', () => {
    const at = (value: string): Alarm => ({ kind: 'absolute', at: L(value) });
    expect(describeAlarm(at('2026-10-19T08:00'), false)).toBe('At 08:00 on Thursday, October 12, 2026');
    expect(describeAlarm(at('2026-10-19T08:00'), true, 'positivist')).toBe('At 08:00 on Friday, Descartes 12, 238');
    expect(describeAlarm(at('2026-12-31T20:15'), false, 'ifc', { use24Hour: false })).toBe('At 8:15 PM on Year Day 2026');
  });

  it('takes the options third, as the §5.2 listing writes it, or after the system id', () => {
    const rel = (offsetMinutes: number): Alarm => ({ kind: 'relative', offsetMinutes });
    expect(describeAlarm(rel(-1440), true, { use24Hour: true })).toBe('1 day before at 00:00');
    expect(describeAlarm(rel(540), true, { use24Hour: false })).toBe('On the day at 9:00 AM');
    expect(describeAlarm({ kind: 'absolute', at: L('2026-10-19T08:00') }, false, { use24Hour: false })).toBe('At 8:00 AM on Thursday, October 12, 2026');
    expect(describeAlarm(rel(540), true, 'positivist', { use24Hour: false })).toBe('On the day at 9:00 AM');
    expect(describeAlarm(rel(540), true, undefined, { use24Hour: false })).toBe('On the day at 9:00 AM');
    expect(() => describeAlarm(rel(540), true, { use24Hour: false } as never, { use24Hour: true })).toThrow(RangeError);
    expect(() => describeAlarm(rel(540), true, { hour12: true } as never)).toThrow(RangeError);
  });

  it('no label contains an em or en dash', () => {
    const labels = [true, false].flatMap((allDay) =>
      [true, false].flatMap((use24Hour) => alarmPresets(allDay, { use24Hour }).map((p) => p.label)),
    );
    for (let offset = -20000; offset <= 2000; offset += 37) {
      labels.push(describeAlarm({ kind: 'relative', offsetMinutes: offset }, false));
      labels.push(describeAlarm({ kind: 'relative', offsetMinutes: offset }, true, 'ifc', { use24Hour: false }));
    }
    for (const label of labels) expect(label).not.toMatch(/[\u2013\u2014]/);
  });

  it('rejects invalid input', () => {
    expect(() => alarmPresets('yes' as unknown as boolean)).toThrow(RangeError);
    expect(() => alarmPresets(true, { use24Hour: 1 as unknown as boolean })).toThrow(RangeError);
    expect(() => describeAlarm({ kind: 'relative', offsetMinutes: 0.5 }, false)).toThrow(RangeError);
    expect(() => describeAlarm({ kind: 'later' } as unknown as Alarm, false)).toThrow(RangeError);
    expect(() => describeAlarm({ kind: 'relative', offsetMinutes: 0 }, false, 'maya' as 'ifc')).toThrow(RangeError);
  });
});

describe('alarmFireTime (§2.14)', () => {
  const zones = intlZoneResolver();
  const fire = (alarm: Alarm, allDay: boolean, start: string, startUtc: string | null, zone = 'Europe/Tallinn') =>
    text(alarmFireTime(alarm, { allDay, start: L(start), startUtc: startUtc === null ? null : L(startUtc) }, zone, zones));
  const rel = (offsetMinutes: number): Alarm => ({ kind: 'relative', offsetMinutes });

  it('relative alerts on timed occurrences are exact, also across DST changes', () => {
    // 03:30 on 2026-03-29 in Tallinn (after the spring-forward gap) is 00:30Z; 1 hour before is 23:30Z.
    expect(fire(rel(-60), false, '2026-03-29T03:30', '2026-03-29T00:30')).toBe('2026-03-28T23:30');
    // 1 day before a 09:00 event the day after the fall-back change: 24 real hours.
    expect(fire(rel(-1440), false, '2026-10-26T09:00', '2026-10-26T07:00')).toBe('2026-10-25T07:00');
    expect(fire(rel(0), false, '2026-10-19T19:00', '2026-10-19T16:00')).toBe('2026-10-19T16:00');
    expect(fire(rel(5), false, '2026-10-19T19:00', '2026-10-19T16:00')).toBe('2026-10-19T16:05');
  });

  it('all-day alerts fire at their wall-clock time in the device zone, even on DST days', () => {
    expect(fire(rel(540), true, '2026-03-29T00:00', null)).toBe('2026-03-29T06:00');
    expect(fire(rel(540), true, '2026-10-25T00:00', null)).toBe('2026-10-25T07:00');
    expect(fire(rel(-900), true, '2026-03-30T00:00', null)).toBe('2026-03-29T06:00');
    expect(fire(rel(-900), true, '2026-03-08T00:00', null, 'America/New_York')).toBe('2026-03-07T14:00');
    expect(fire(rel(-900), true, '2026-03-09T00:00', null, 'America/New_York')).toBe('2026-03-08T13:00');
  });

  it('absolute alerts use the device wall clock', () => {
    expect(fire({ kind: 'absolute', at: L('2026-10-19T08:00') }, false, '2026-10-19T19:00', '2026-10-19T16:00')).toBe(
      '2026-10-19T05:00',
    );
    expect(fire({ kind: 'absolute', at: L('2026-10-19T08:00') }, true, '2026-10-20T00:00', null)).toBe('2026-10-19T05:00');
  });

  it('returns null when the alert would fire outside years 1 to 9999', () => {
    expect(fire(rel(-60), false, '0001-01-01T02:30', '0001-01-01T00:30')).toBeNull();
    expect(fire(rel(-1440), true, '0001-01-01T00:00', null)).toBeNull();
    expect(fire(rel(540), true, '0001-01-01T00:00', null, 'Asia/Tokyo')).toBeNull();
    expect(fire(rel(60), false, '9999-12-31T23:30', '9999-12-31T23:30', 'UTC')).toBeNull();
  });

  it('uses the core zone rule (synthetic zone) and validates its input', () => {
    const synthetic = syntheticZoneResolver({ name: 'Test/Plus2', offset: 120, transitions: [] });
    expect(text(alarmFireTime(rel(540), { allDay: true, start: L('2026-10-19T00:00'), startUtc: null }, 'Test/Plus2', synthetic))).toBe(
      '2026-10-19T07:00',
    );
    expect(() => alarmFireTime(rel(0), { allDay: false, start: L('2026-10-19T19:00'), startUtc: null }, 'UTC', zones)).toThrow(RangeError);
    expect(() => alarmFireTime(rel(0), { allDay: true, start: L('2026-10-19T09:00'), startUtc: null }, 'UTC', zones)).toThrow(RangeError);
    expect(() => alarmFireTime(rel(0), { allDay: true, start: L('2026-10-19T00:00'), startUtc: null }, 'Mars/Olympus', zones)).toThrow(
      RangeError,
    );
    expect(() => alarmFireTime(rel(0), null as never, 'UTC', zones)).toThrow(RangeError);
  });
});
