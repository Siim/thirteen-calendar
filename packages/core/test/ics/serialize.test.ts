/**
 * The `.ics` writer (docs/EVENTS.md §3.6, §4.9, §5.4 writer rules): round
 * trips, edits that keep untouched text, new events, `UNTIL` retimes and
 * `VTIMEZONE` selection.
 */
import { describe, expect, it } from 'vitest';
import { recognizeRecurrence, retimeExceptions } from '../../src/events/recurrence.ts';
import { parseRRule } from '../../src/events/rrule.ts';
import {
  type IcsCalendar,
  type IcsEvent,
  allDayEnd,
  icsRecognitionInput,
  newICalendar,
  parseICalendar,
  replaceGroup,
  serializeICalendar,
  withRetimedUntils,
} from '../../src/ics/index.ts';
import { patchRuleEnd } from '../../src/ics/serialize.ts';
import { FLE_VTIMEZONE, TALLINN_VTIMEZONE, calendar, crlf, vevent, zones } from './helpers.ts';

const roundTrip = (text: string, options?: { calendarId?: string }) => serializeICalendar(parseICalendar(text, options), zones);
const normalize = (text: string) => text.replace(/\r\n|\r|\n/g, '\r\n').replace(/^﻿/, '');

/** A copy of `calendar` with the group of `uid` edited by `edit` (the master) and re-serialized. */
function editMaster(cal: IcsCalendar, uid: string, edit: (event: IcsEvent) => IcsEvent): IcsCalendar {
  const group = cal.groups.find((g) => g.uid === uid)!;
  return replaceGroup(cal, { ...group, master: edit(group.master!) });
}

const GOOGLE = calendar(
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:Liis Kask',
  'X-WR-TIMEZONE:Europe/Tallinn',
  ...TALLINN_VTIMEZONE,
  ...vevent(
    'DTSTART;TZID=Europe/Tallinn:20261019T190030',
    'DTEND;TZID=Europe/Tallinn:20261019T200000',
    'RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20261116T165959Z;BYDAY=MO',
    'EXDATE;TZID=Europe/Tallinn:20261026T190030',
    'DTSTAMP:20261019T100000Z',
    'UID:choir@google.com',
    'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN="Kask, Liis";X-NUM-GUESTS=0:mailto:liis@example.com',
    'CREATED:20261001T100000Z',
    'LAST-MODIFIED:20261002T100000Z',
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    'SUMMARY;LANGUAGE=et:Koor',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:This is an event reminder',
    'TRIGGER:-P0DT0H30M0S',
    'END:VALARM',
  ),
  ...vevent('DTSTART;TZID=Europe/Tallinn:20261103T200000', 'DTEND;TZID=Europe/Tallinn:20261103T210000', 'DTSTAMP:20261019T100000Z', 'UID:choir@google.com', 'RECURRENCE-ID;TZID=Europe/Tallinn:20261102T190030', 'SUMMARY:Koor (moved)'),
  ...vevent('DTSTART;VALUE=DATE:20261224', 'DTEND;VALUE=DATE:20261227', 'DTSTAMP:20261019T100000Z', 'UID:xmas@google.com', 'SUMMARY:Christmas', 'TRANSP:TRANSPARENT'),
);

describe('serializeICalendar: round trips', () => {
  it.each([
    ['Google', GOOGLE],
    ['Outlook', calendar('METHOD:PUBLISH', ...FLE_VTIMEZONE, ...vevent('UID:o1', 'DTSTART;TZID=FLE Standard Time:20261019T190000', 'DTEND;TZID=FLE Standard Time:20261019T200000', 'X-MICROSOFT-CDO-BUSYSTATUS:BUSY'))],
    ['LF line ends', calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019')).replaceAll('\r\n', '\n')],
    ['CR line ends', calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019')).replaceAll('\r\n', '\r')],
    ['folding', calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'SUMMARY:Ä very long title that wraps', '\tacross a tab-folded line', ' and a space'))],
    ['others and duplicates', calendar('BEGIN:VTODO', 'UID:t', 'END:VTODO', ...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019'), ...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019'))],
    ['broken', calendar(...vevent('UID:a', 'SUMMARY:no start'), ...vevent('UID:b', 'DTSTART:bad'), 'BEGIN:VEVENT', 'UID:c', 'DTSTART;VALUE=DATE:20261019')],
    ['interleaved groups', calendar(...vevent('UID:a', 'RECURRENCE-ID;VALUE=DATE:20261020', 'DTSTART;VALUE=DATE:20261021'), ...vevent('UID:b', 'DTSTART;VALUE=DATE:20261019'), ...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=DAILY'))],
    ['year 10000 end', calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:99991231', 'DTEND;VALUE=DATE:10000101'))],
    ['unknown zone', calendar(...vevent('UID:a', 'DTSTART;TZID=Nowhere/Special:20261019T090000'))],
  ])('%s: equal to the input with CRLF line ends', (_, text) => {
    expect(roundTrip(text)).toBe(normalize(text));
  });

  it('drops a byte order mark and writes BEGIN and END in uppercase', () => {
    const text = `﻿${calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019'))}`;
    expect(roundTrip(text)).toBe(normalize(text));
    expect(roundTrip('begin:vcalendar\r\nversion:2.0\r\nprodid:x\r\nend:vcalendar\r\n')).toBe('BEGIN:VCALENDAR\r\nversion:2.0\r\nprodid:x\r\nEND:VCALENDAR\r\n');
  });

  it('keeps a missing-UID event as read (its derived UID is not written)', () => {
    const text = calendar(...vevent('DTSTART;VALUE=DATE:20261019', 'SUMMARY:No UID'));
    expect(roundTrip(text, { calendarId: 'c' })).toBe(text);
  });
});

describe('serializeICalendar: edits', () => {
  it('re-serializes only the edited group and keeps untouched properties as read', () => {
    const cal = parseICalendar(GOOGLE);
    const edited = editMaster(cal, 'choir@google.com', (e) => ({ ...e, summary: 'Koor, proov', sequence: 1 }));
    const text = serializeICalendar(edited, zones);
    const master = crlf(
      'BEGIN:VEVENT',
      'UID:choir@google.com',
      'DTSTAMP:20261019T100000Z',
      'CREATED:20261001T100000Z',
      'LAST-MODIFIED:20261002T100000Z',
      'SEQUENCE:1',
      'SUMMARY:Koor\\, proov',
      'DTSTART;TZID=Europe/Tallinn:20261019T190030',
      'DTEND;TZID=Europe/Tallinn:20261019T200000',
      'RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20261116T165959Z;BYDAY=MO',
      'EXDATE;TZID=Europe/Tallinn:20261026T190030',
      'TRANSP:OPAQUE',
      'STATUS:CONFIRMED',
      'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN="Kask, Liis";X-NUM-GUESTS=0:mailto:liis@example.com',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:This is an event reminder',
      'TRIGGER:-P0DT0H30M0S',
      'END:VALARM',
      'END:VEVENT',
    );
    const original = cal.groups[0]!.master!.raw!;
    const override = cal.groups[0]!.overrides[0]!.raw!;
    // The override of the same group is re-serialized too; with nothing changed its lines come back as read, in §3.6 order.
    const overrideOut = crlf(
      'BEGIN:VEVENT',
      'UID:choir@google.com',
      'RECURRENCE-ID;TZID=Europe/Tallinn:20261102T190030',
      'DTSTAMP:20261019T100000Z',
      'SEQUENCE:0',
      'SUMMARY:Koor (moved)',
      'DTSTART;TZID=Europe/Tallinn:20261103T200000',
      'DTEND;TZID=Europe/Tallinn:20261103T210000',
      'END:VEVENT',
    );
    expect(text).toBe(normalize(GOOGLE).replace(original, master).replace(override, overrideOut));
    // Read back: the same fields.
    const back = parseICalendar(text).groups[0]!.master!;
    expect(back.summary).toBe('Koor, proov');
    expect(back.extra).toEqual(cal.groups[0]!.master!.extra);
    expect(back.rrules).toEqual(cal.groups[0]!.master!.rrules);
  });

  it('a group kept with keepRaw is copied as read', () => {
    const cal = parseICalendar(GOOGLE);
    const same = replaceGroup(cal, cal.groups[0]!, { keepRaw: true });
    expect(serializeICalendar(same, zones)).toBe(normalize(GOOGLE));
  });

  it('keeps an empty text property of an untouched field as read, and drops it when the field is edited away (§4.9 rule 1)', () => {
    const text = calendar(...vevent('UID:a', 'DTSTAMP:20261019T100000Z', 'SEQUENCE:0', 'SUMMARY:Lunch', 'DESCRIPTION:', 'LOCATION;LANGUAGE=et:', 'DTSTART;VALUE=DATE:20261019'));
    const cal = parseICalendar(text);
    const renamed = serializeICalendar(editMaster(cal, 'a', (e) => ({ ...e, summary: 'Long lunch', sequence: 1 })), zones);
    expect(renamed).toContain('\r\nSUMMARY:Long lunch\r\nLOCATION;LANGUAGE=et:\r\nDESCRIPTION:\r\nDTSTART;VALUE=DATE:20261019\r\n');
    const described = serializeICalendar(editMaster(cal, 'a', (e) => ({ ...e, description: 'Bring salad', location: 'Kitchen' })), zones);
    expect(described).toContain('\r\nSUMMARY:Lunch\r\nLOCATION:Kitchen\r\nDESCRIPTION:Bring salad\r\n');
    const edited = parseICalendar(described);
    const cleared = serializeICalendar(editMaster(edited, 'a', (e) => ({ ...e, description: '', location: '' })), zones);
    expect(cleared).not.toMatch(/DESCRIPTION|LOCATION/);
    // A new event never writes empty text properties.
    expect(serializeICalendar(editMaster(cal, 'a', (e) => ({ ...e, original: null })), zones)).not.toMatch(/DESCRIPTION|LOCATION/);
  });

  it('adds EXDATE values after the lines as read (a removed occurrence)', () => {
    const cal = parseICalendar(GOOGLE);
    const extra = { kind: 'zoned', tzid: 'Europe/Tallinn', value: { date: { year: 2026, month: 11, day: 9 }, minute: 1140 } } as const;
    const text = serializeICalendar(editMaster(cal, 'choir@google.com', (e) => ({ ...e, exdates: [...e.exdates, extra] })), zones);
    expect(text).toContain('EXDATE;TZID=Europe/Tallinn:20261026T190030\r\nEXDATE;TZID=Europe/Tallinn:20261109T190000\r\n');
  });

  it('rewrites only the end of a rule whose end changed (§4.9 rule 4)', () => {
    expect(patchRuleEnd('FREQ=WEEKLY;UNTIL=20261116T170000Z;INTERVAL=1;BYDAY=MO;WKST=MO', parseRRule('FREQ=WEEKLY;UNTIL=20261116T215959Z;BYDAY=MO'))).toBe(
      'FREQ=WEEKLY;UNTIL=20261116T215959Z;INTERVAL=1;BYDAY=MO;WKST=MO',
    );
    expect(patchRuleEnd('FREQ=WEEKLY;BYDAY=MO;COUNT=10', parseRRule('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231'))).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231');
    expect(patchRuleEnd('FREQ=WEEKLY;BYDAY=MO;COUNT=10', parseRRule('FREQ=WEEKLY;BYDAY=MO'))).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(patchRuleEnd('FREQ=WEEKLY;BYDAY=MO', parseRRule('FREQ=WEEKLY;BYDAY=MO;COUNT=3'))).toBe('FREQ=WEEKLY;COUNT=3;BYDAY=MO');
    expect(patchRuleEnd('BYDAY=MO;FREQ=WEEKLY', parseRRule('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T235959'))).toBe('BYDAY=MO;FREQ=WEEKLY;UNTIL=20261231T235959');
  });

  it('retimes an Outlook-style UNTIL with only the UNTIL= part changed (edits/retime-until.ics)', () => {
    const text = calendar(
      'METHOD:PUBLISH',
      ...FLE_VTIMEZONE,
      ...vevent(
        'UID:weekly@outlook',
        'DTSTART;TZID=FLE Standard Time:20261019T190000',
        'DTEND;TZID=FLE Standard Time:20261019T200000',
        'RRULE:FREQ=WEEKLY;UNTIL=20261116T170000Z;INTERVAL=1;BYDAY=MO;WKST=MO',
        'SUMMARY:Choir',
        'DTSTAMP:20261001T000000Z',
      ),
      ...vevent('UID:other@outlook', 'DTSTART;TZID=FLE Standard Time:20261020T090000', 'SUMMARY:Untouched'),
    );
    const cal = parseICalendar(text);
    const master = cal.groups[0]!.master!;
    const recognized = recognizeRecurrence(icsRecognitionInput(master, cal, zones));
    expect(recognized.recurrence.end).toEqual({ kind: 'until', date: { year: 2026, month: 11, day: 16 } });
    const start = { year: 2026, month: 10, day: 19 };
    const retime = retimeExceptions(recognized.recurrence, [], start, start, recognized.recurrence, { minuteDelta: 30 });
    expect(retime.untils).toEqual([{ rule: 'rrule', index: 0, endDate: { year: 2026, month: 11, day: 16 } }]);
    const at = (minute: number) => ({ kind: 'zoned' as const, tzid: 'FLE Standard Time', value: { date: start, minute } });
    const moved = withRetimedUntils({ ...master, start: at(1170), end: at(1230) }, retime.untils, cal, zones);
    const out = serializeICalendar(replaceGroup(cal, { uid: master.uid, master: moved, overrides: [] }), zones);
    expect(out).toBe(
      normalize(text).replace(
        master.raw!,
        crlf(
          'BEGIN:VEVENT',
          'UID:weekly@outlook',
          'DTSTAMP:20261001T000000Z',
          'SEQUENCE:0',
          'SUMMARY:Choir',
          'DTSTART;TZID=FLE Standard Time:20261019T193000',
          'DTEND;TZID=FLE Standard Time:20261019T203000',
          'RRULE:FREQ=WEEKLY;UNTIL=20261116T215959Z;INTERVAL=1;BYDAY=MO;WKST=MO',
          'END:VEVENT',
        ),
      ),
    );
    // November 16 stays: the series read back ends on November 16 at 19:30.
    const back = parseICalendar(out);
    expect(recognizeRecurrence(icsRecognitionInput(back.groups[0]!.master!, back, zones)).recurrence.end).toEqual({ kind: 'until', date: { year: 2026, month: 11, day: 16 } });

    // To all-day: a date UNTIL; back to timed: a UTC end of day again.
    const allDay = withRetimedUntils({ ...moved, start: { kind: 'date', date: start }, end: { kind: 'date', date: { year: 2026, month: 10, day: 20 } } }, retime.untils, cal, zones);
    expect(allDay.rrules[0]!.until).toEqual({ kind: 'date', date: { year: 2026, month: 11, day: 16 } });
    expect(serializeICalendar(replaceGroup(cal, { uid: master.uid, master: allDay, overrides: [] }), zones)).toContain(
      'RRULE:FREQ=WEEKLY;UNTIL=20261116;INTERVAL=1;BYDAY=MO;WKST=MO\r\n',
    );
    const timed = withRetimedUntils(moved, retime.untils, cal, zones);
    expect(timed.rrules[0]!.until).toEqual({ kind: 'utc', value: { date: { year: 2026, month: 11, day: 16 }, minute: 21 * 60 + 59 } });
  });

  it('writes floating and UTC UNTILs for floating and UTC series', () => {
    const cal = parseICalendar(calendar(...vevent('UID:f', 'DTSTART:20261019T090000', 'RRULE:FREQ=DAILY;UNTIL=20261020T090000'), ...vevent('UID:u', 'DTSTART:20261019T090000Z', 'RRULE:FREQ=DAILY;UNTIL=20261020T090000Z')));
    const until = [{ rule: 'rrule' as const, index: 0, endDate: { year: 2026, month: 10, day: 25 } }];
    expect(withRetimedUntils(cal.groups[0]!.master!, until, cal, zones).rrules[0]!.until).toEqual({ kind: 'floating', value: { date: { year: 2026, month: 10, day: 25 }, minute: 1439 } });
    expect(withRetimedUntils(cal.groups[1]!.master!, until, cal, zones).rrules[0]!.until).toEqual({ kind: 'utc', value: { date: { year: 2026, month: 10, day: 25 }, minute: 1439 } });
    expect(() => withRetimedUntils(cal.groups[0]!.master!, [{ rule: 'exrule', index: 0, endDate: until[0]!.endDate }], cal, zones)).toThrow(RangeError);
  });

  it('retimes RDATE and EXDATE values by rewriting their lines', () => {
    const cal = parseICalendar(
      calendar(...vevent('UID:a', 'DTSTART:20261019T090000Z', 'RRULE:FREQ=WEEKLY', 'RDATE:20261102T150000Z', 'EXDATE:20261102T150000Z,20261109T090000Z')),
    );
    const at = (day: number, minute: number) => ({ kind: 'utc' as const, value: { date: { year: 2026, month: 11, day }, minute } });
    const out = serializeICalendar(
      editMaster(cal, 'a', (e) => ({ ...e, start: { kind: 'utc', value: { date: { year: 2026, month: 10, day: 19 }, minute: 600 } }, rdates: [{ value: at(2, 960), period: null }], exdates: [at(2, 960), at(9, 600)] })),
      zones,
    );
    expect(out).toContain('DTSTART:20261019T100000Z\r\nRRULE:FREQ=WEEKLY\r\nRDATE:20261102T160000Z\r\nEXDATE:20261102T160000Z,20261109T100000Z\r\n');
  });
});

describe('serializeICalendar: new events and calendars', () => {
  it('writes a new event in the §3.6 order', () => {
    const base = newICalendar({ calendarId: '6f1c2d1e-8a7b-4c2e-9a51-3f0f5d9b2c11', name: 'Personal', color: '#ea580c' });
    const event: IcsEvent = {
      uid: '0b3e1f6a-1c1d-4e7b-9f00-5a1b2c3d4e5f',
      uidDerived: false,
      recurrenceId: null,
      sequence: 0,
      summary: 'Dentist, upstairs; bring card',
      location: 'Tartu mnt 1',
      description: 'Line one\nLine two',
      url: 'https://example.com',
      start: { kind: 'zoned', tzid: 'Europe/Tallinn', value: { date: { year: 2026, month: 10, day: 19 }, minute: 570 } },
      end: { kind: 'zoned', tzid: 'Europe/Tallinn', value: { date: { year: 2026, month: 10, day: 19 }, minute: 630 } },
      duration: null,
      rrules: [parseRRule('FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18')],
      exrules: [],
      rdates: [],
      exdates: [{ kind: 'zoned', tzid: 'Europe/Tallinn', value: { date: { year: 2026, month: 12, day: 14 }, minute: 570 } }],
      status: 'CONFIRMED',
      transp: 'OPAQUE',
      thirteenRule: 'SYSTEM=ifc;KIND=monthly;DAY=12',
      alarms: [{ action: 'DISPLAY', trigger: { kind: 'relative', minutes: -15, related: 'start' }, extra: [{ name: 'DESCRIPTION', params: [], value: 'Dentist\\, upstairs\\; bring card' }] }],
      created: { kind: 'utc', value: { date: { year: 2026, month: 10, day: 19 }, minute: 581 } },
      lastModified: { kind: 'utc', value: { date: { year: 2026, month: 10, day: 19 }, minute: 581 } },
      dtstamp: null,
      importedLastModified: null,
      extra: [],
      raw: null,
      original: null,
      line: null,
    };
    const cal = replaceGroup(base, { uid: event.uid, master: event, overrides: [] });
    const text = serializeICalendar(cal, zones, { now: '2026-10-19T09:41' });
    const head = crlf(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Haugas Development OU//Thirteen 1.0//EN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:Personal',
      'NAME:Personal',
      'X-APPLE-CALENDAR-COLOR:#EA580C',
      'COLOR:orangered',
      'X-THIRTEEN-CALENDAR-ID:6f1c2d1e-8a7b-4c2e-9a51-3f0f5d9b2c11',
      'BEGIN:VTIMEZONE',
      'TZID:Europe/Tallinn',
      'X-THIRTEEN-GENERATED:2026-2027',
      'BEGIN:DAYLIGHT',
      'DTSTART:20250330T030000',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0300',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:20251026T040000',
      'TZOFFSETFROM:+0300',
      'TZOFFSETTO:+0200',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
      'END:STANDARD',
      'END:VTIMEZONE',
    );
    const body = crlf(
      'BEGIN:VEVENT',
      'UID:0b3e1f6a-1c1d-4e7b-9f00-5a1b2c3d4e5f',
      'DTSTAMP:20261019T094100Z',
      'CREATED:20261019T094100Z',
      'LAST-MODIFIED:20261019T094100Z',
      'SEQUENCE:0',
      'SUMMARY:Dentist\\, upstairs\\; bring card',
      'LOCATION:Tartu mnt 1',
      'DESCRIPTION:Line one\\nLine two',
      'URL:https://example.com',
      'DTSTART;TZID=Europe/Tallinn:20261019T093000',
      'DTEND;TZID=Europe/Tallinn:20261019T103000',
      'RRULE:FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46',
      ' ,-18',
      'EXDATE;TZID=Europe/Tallinn:20261214T093000',
      'X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=monthly;DAY=12',
      'TRANSP:OPAQUE',
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'DESCRIPTION:Dentist\\, upstairs\\; bring card',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    );
    expect(text).toBe(head + body);
    // Read back: the same event.
    const back = parseICalendar(text).groups[0]!.master!;
    expect({ ...back, raw: null, original: null, line: null, dtstamp: null }).toEqual(event);
  });

  it('writes all-day ends with the year-9999 rule (edits/year-9999.ics)', () => {
    expect(allDayEnd({ year: 2026, month: 10, day: 19 }, { year: 2026, month: 10, day: 21 })).toEqual({ end: { kind: 'date', date: { year: 2026, month: 10, day: 22 } }, duration: null });
    expect(allDayEnd({ year: 9999, month: 12, day: 31 }, { year: 9999, month: 12, day: 31 })).toEqual({ end: null, duration: null });
    expect(allDayEnd({ year: 9999, month: 12, day: 29 }, { year: 9999, month: 12, day: 31 })).toEqual({ end: null, duration: 'P3D' });
    expect(() => allDayEnd({ year: 2026, month: 10, day: 19 }, { year: 2026, month: 10, day: 18 })).toThrow(RangeError);
    const event = (uid: string, first: number, fields: { end: IcsEvent['end']; duration: string | null }): IcsEvent => ({
      ...parseICalendar(calendar(...vevent(`UID:${uid}`, `DTSTART;VALUE=DATE:999912${first}`))).groups[0]!.master!,
      ...fields,
      raw: null,
      original: null,
      line: null,
    });
    let cal = newICalendar({ calendarId: 'c', name: 'End', color: '#000000' });
    cal = replaceGroup(cal, { uid: 'one', master: event('one', 31, allDayEnd({ year: 9999, month: 12, day: 31 }, { year: 9999, month: 12, day: 31 })), overrides: [] });
    cal = replaceGroup(cal, { uid: 'three', master: event('three', 29, allDayEnd({ year: 9999, month: 12, day: 29 }, { year: 9999, month: 12, day: 31 })), overrides: [] });
    const text = serializeICalendar(cal, zones);
    expect(text).toContain('UID:one\r\nSEQUENCE:0\r\nDTSTART;VALUE=DATE:99991231\r\nEND:VEVENT');
    expect(text).toContain('UID:three\r\nSEQUENCE:0\r\nDTSTART;VALUE=DATE:99991229\r\nDURATION:P3D\r\nEND:VEVENT');
  });

  it('updates the calendar properties behind name, color and refresh interval', () => {
    const cal = parseICalendar(calendar('X-WR-CALNAME:Old', 'X-APPLE-CALENDAR-COLOR:#000000', 'X-OTHER:keep'));
    const text = serializeICalendar({ ...cal, name: 'New, name', color: '#2563EB', refreshInterval: 'PT6H' }, zones);
    expect(text).toBe(
      crlf(
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//Thirteen tests//EN',
        'X-WR-CALNAME:New\\, name',
        'X-APPLE-CALENDAR-COLOR:#2563EB',
        'X-OTHER:keep',
        'NAME:New\\, name',
        'COLOR:royalblue',
        'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
        'X-PUBLISHED-TTL:PT6H',
        'END:VCALENDAR',
      ),
    );
    const cleared = serializeICalendar({ ...cal, name: null, color: null }, zones);
    expect(cleared).toBe(crlf('BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//Thirteen tests//EN', 'X-OTHER:keep', 'END:VCALENDAR'));
    expect(() => serializeICalendar({ ...cal, color: 'blue' }, zones)).toThrow(RangeError);
    expect(() => serializeICalendar({ ...cal, refreshInterval: 'six hours' }, zones)).toThrow(RangeError);
    expect(() => serializeICalendar(cal, zones, { now: 'today' })).toThrow(RangeError);
    expect(() => serializeICalendar({} as IcsCalendar, zones)).toThrow(RangeError);
  });

  it('adds VERSION and PRODID when a calendar has none', () => {
    const cal = { ...parseICalendar(calendar()), extra: [], raw: null };
    expect(serializeICalendar(cal, zones)).toBe(crlf('BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Haugas Development OU//Thirteen 1.0//EN', 'END:VCALENDAR'));
  });

  it('newICalendar validates its input', () => {
    expect(() => newICalendar({ calendarId: '', name: 'x', color: '#000000' })).toThrow(RangeError);
    expect(() => newICalendar({ calendarId: 'c', name: '', color: '#000000' })).toThrow(RangeError);
    expect(() => newICalendar({ calendarId: 'c', name: 'x', color: 'black' })).toThrow(RangeError);
  });
});

describe('serializeICalendar: VTIMEZONEs', () => {
  const event = (uid: string, tzid: string, date: string, ...more: string[]) => vevent(`UID:${uid}`, `DTSTART;TZID=${tzid}:${date}T090000`, ...more);

  it('drops definitions no event uses and keeps the rest as read', () => {
    const text = calendar(...TALLINN_VTIMEZONE, ...FLE_VTIMEZONE, ...event('a', 'FLE Standard Time', '20261019'));
    expect(serializeICalendar(parseICalendar(text), zones)).toBe(calendar(...FLE_VTIMEZONE, ...event('a', 'FLE Standard Time', '20261019')));
  });

  it('keeps a definition that only a component kept as read uses (a VTODO)', () => {
    const todo = ['BEGIN:VTODO', 'UID:t1', 'DTSTAMP:20261019T080000Z', 'DUE;TZID=Europe/Tallinn:20261020T170000', 'END:VTODO'];
    const text = calendar(...TALLINN_VTIMEZONE, ...todo, ...vevent('UID:a', 'DTSTART:20261019T090000Z'));
    expect(serializeICalendar(parseICalendar(text), zones)).toBe(text);
  });

  it('generates a missing definition for an IANA id or a Windows id, before the first component', () => {
    const text = calendar(...event('a', 'America/New_York', '20260105', 'RRULE:FREQ=WEEKLY'), ...event('b', 'Tokyo Standard Time', '20261019'), ...event('c', 'Nowhere/Special', '20261019'));
    const out = serializeICalendar(parseICalendar(text), zones, { now: '2026-10-19T00:00' });
    const back = parseICalendar(out);
    expect(back.timeZones.map((t) => [t.tzid, t.generated])).toEqual([
      ['America/New_York', { first: 2026, last: 2027 }],
      ['Tokyo Standard Time', { first: 2026, last: 2026 }],
    ]);
    expect(out.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(out.indexOf('BEGIN:VEVENT'));
    expect(out).toContain(crlf('BEGIN:VTIMEZONE', 'TZID:Tokyo Standard Time', 'X-THIRTEEN-GENERATED:2026-2026', 'BEGIN:STANDARD', 'DTSTART:20250101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'END:STANDARD', 'END:VTIMEZONE'));
  });

  it('rebuilds a generated definition when the years used grow (edits/generated-tz-grow.ics), never one from another file', () => {
    const first = serializeICalendar(parseICalendar(calendar(...event('a', 'America/New_York', '20260105'), ...event('b', 'America/New_York', '20270105'))), zones);
    const doc = parseICalendar(first);
    expect(doc.timeZones[0]!.generated).toEqual({ first: 2026, last: 2027 });
    // Unchanged years: copied as read.
    expect(serializeICalendar(doc, zones)).toBe(first);
    const added = parseICalendar(calendar(...event('c', 'America/New_York', '20310105'))).groups[0]!;
    const grown = serializeICalendar(replaceGroup(doc, added), zones);
    const rebuilt = parseICalendar(grown);
    expect(rebuilt.timeZones[0]!.generated).toEqual({ first: 2026, last: 2031 });
    expect(rebuilt.groups.map((g) => g.master!.raw)).toEqual([doc.groups[0]!.master!.raw, doc.groups[1]!.master!.raw, expect.any(String)]);
    // A 2005 event adds the pre-2007 period: four observances, the first two ending in 2006.
    const old = parseICalendar(calendar(...event('d', 'America/New_York', '20050110'))).groups[0]!;
    const withOld = parseICalendar(serializeICalendar(replaceGroup(rebuilt, old), zones));
    expect(withOld.timeZones[0]!.generated).toEqual({ first: 2005, last: 2031 });
    expect(withOld.timeZones[0]!.observances.map((o) => [o.kind, o.start.date.year, o.rrules[0]?.until ?? null])).toEqual([
      ['daylight', 2004, { kind: 'utc', value: { date: { year: 2006, month: 4, day: 2 }, minute: 420 } }],
      ['standard', 2004, { kind: 'utc', value: { date: { year: 2006, month: 10, day: 29 }, minute: 360 } }],
      ['daylight', 2007, null],
      ['standard', 2007, null],
    ]);
    // Google's own Tallinn definition is never rebuilt.
    const google = parseICalendar(calendar(...TALLINN_VTIMEZONE, ...event('e', 'Europe/Tallinn', '20400105')));
    expect(serializeICalendar(google, zones)).toBe(calendar(...TALLINN_VTIMEZONE, ...event('e', 'Europe/Tallinn', '20400105')));
  });

  it('counts an open-ended series through the current year plus one', () => {
    const text = calendar(...event('a', 'Europe/Tallinn', '20200105', 'RRULE:FREQ=YEARLY'), ...event('b', 'Asia/Tokyo', '20200105', 'RRULE:FREQ=DAILY;COUNT=800'), ...event('c', 'Asia/Seoul', '20200105', 'RRULE:FREQ=DAILY;UNTIL=20231231T000000Z'));
    const out = parseICalendar(serializeICalendar(parseICalendar(text), zones, { now: '2030-06-01T00:00' }));
    expect(out.timeZones.map((t) => [t.tzid, t.generated])).toEqual([
      ['Europe/Tallinn', { first: 2020, last: 2031 }],
      ['Asia/Tokyo', { first: 2020, last: 2022 }],
      ['Asia/Seoul', { first: 2020, last: 2023 }],
    ]);
    const noNow = parseICalendar(serializeICalendar(parseICalendar(text), zones));
    expect(noNow.timeZones[0]!.generated).toEqual({ first: 2020, last: 2021 });
  });
});
