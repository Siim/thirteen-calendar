/**
 * The `.ics` reader (docs/EVENTS.md §5.4 reader rules, §2.17, §3.2, §3.6).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseRRule } from '../../src/events/index.ts';
import { type IcsCalendar, type IcsEvent, parseICalendar } from '../../src/ics/index.ts';
import { FLE_VTIMEZONE, TALLINN_VTIMEZONE, calendar, crlf, vevent, zones } from './helpers.ts';

const only = (cal: IcsCalendar): IcsEvent => {
  expect(cal.groups).toHaveLength(1);
  return cal.groups[0]!.master!;
};
const codes = (cal: IcsCalendar) => cal.warnings.map((w) => w.code);

describe('parseICalendar: calendars', () => {
  it('throws only when there is no VCALENDAR at all', () => {
    expect(() => parseICalendar('BEGIN:VEVENT\r\nEND:VEVENT\r\n')).toThrow(RangeError);
    expect(() => parseICalendar('')).toThrow(RangeError);
    expect(() => parseICalendar('garbage')).toThrow(RangeError);
    expect(parseICalendar('BEGIN:VCALENDAR\r\nEND:VCALENDAR').groups).toEqual([]);
    expect(() => parseICalendar(42 as unknown as string)).toThrow(RangeError);
    expect(() => parseICalendar('BEGIN:VCALENDAR\r\nEND:VCALENDAR', { bogus: 1 } as never)).toThrow(RangeError);
  });

  it('fills the calendar fields and keeps every calendar property in order', () => {
    const cal = parseICalendar(
      calendar('X-WR-CALNAME:Kodu\\, pere', 'NAME:Other', 'X-APPLE-CALENDAR-COLOR:#EA580CFF', 'COLOR:red', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT1H'),
    );
    expect(cal.name).toBe('Kodu, pere');
    expect(cal.color).toBe('#ea580c');
    expect(cal.refreshInterval).toBe('PT6H');
    expect(cal.extra.map((p) => p.name)).toEqual(['VERSION', 'PRODID', 'X-WR-CALNAME', 'NAME', 'X-APPLE-CALENDAR-COLOR', 'COLOR', 'REFRESH-INTERVAL', 'X-PUBLISHED-TTL']);
  });

  it('falls back to NAME, COLOR and X-PUBLISHED-TTL', () => {
    const cal = parseICalendar(calendar('NAME:Work', 'COLOR:teal', 'X-PUBLISHED-TTL:P1D'));
    expect([cal.name, cal.color, cal.refreshInterval]).toEqual(['Work', '#008080', 'P1D']);
    expect([parseICalendar(calendar()).name, parseICalendar(calendar('COLOR:notacolor')).color]).toEqual([null, null]);
  });

  it('accepts LF and CR line ends, a byte order mark, lowercase names and folded lines', () => {
    const lines = ['begin:vcalendar', 'version:2.0', 'begin:vevent', 'uid:a', 'dtstart;value=date:20261019', 'summary:Folded', '  text', 'end:vevent', 'end:vcalendar'];
    for (const text of [`﻿${lines.join('\n')}\n`, lines.join('\r'), lines.join('\r\n')]) {
      const event = only(parseICalendar(text));
      expect(event.summary).toBe('Folded text');
      expect(event.start).toEqual({ kind: 'date', date: { year: 2026, month: 10, day: 19 } });
      expect(event.raw).toBe(crlf('begin:vevent', 'uid:a', 'dtstart;value=date:20261019', 'summary:Folded', '  text', 'end:vevent'));
    }
  });

  it('merges several VCALENDARs (properties of the first)', () => {
    const text =
      calendar('X-WR-CALNAME:First', ...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019')) + calendar('X-WR-CALNAME:Second', ...vevent('UID:b', 'DTSTART;VALUE=DATE:20261020'));
    const cal = parseICalendar(text);
    expect(cal.name).toBe('First');
    expect(cal.groups.map((g) => g.uid)).toEqual(['a', 'b']);
  });

  it('keeps the calendar property lines as read in raw', () => {
    const cal = parseICalendar(crlf('BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALDESC:A long', '  description', 'END:VCALENDAR'));
    expect(cal.raw).toBe(crlf('VERSION:2.0', 'X-WR-CALDESC:A long', '  description'));
  });
});

describe('parseICalendar: events', () => {
  it('reads every modeled field and keeps the rest verbatim, in order', () => {
    const cal = parseICalendar(
      calendar(
        ...vevent(
          'UID:abc@google.com',
          'DTSTART;TZID=Europe/Tallinn:20261019T190000',
          'DTEND;TZID=Europe/Tallinn:20261019T200000',
          'RRULE:FREQ=WEEKLY;UNTIL=20261116T165959Z;BYDAY=MO',
          'EXDATE;TZID=Europe/Tallinn:20261026T190000,20261102T190000',
          'RDATE;VALUE=PERIOD:20261020T120000Z/PT3H,20261021T120000Z/20261021T130000Z',
          'RDATE;VALUE=DATE:20261224',
          'EXRULE:FREQ=MONTHLY;BYMONTHDAY=1',
          'ATTENDEE;CN="Kask, Liis":mailto:liis@example.com',
          'X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=monthly;DAY=12',
          'SUMMARY;LANGUAGE=et:Koor\\, proov',
          'LOCATION:Tallinn',
          'DESCRIPTION:Line one\\nLine two',
          'URL:https://example.com/x',
          'STATUS:confirmed',
          'TRANSP:TRANSPARENT',
          'SEQUENCE:3',
          'CREATED:20261001T100000Z',
          'LAST-MODIFIED:20261002T100000Z',
          'DTSTAMP:20261003T100000Z',
          'X-THIRTEEN-IMPORTED-LAST-MODIFIED:20261002T100000Z',
          'CATEGORIES:Music',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'DESCRIPTION:Reminder',
          'TRIGGER:-PT30M',
          'X-WR-ALARMUID:1',
          'END:VALARM',
          'BEGIN:VALARM',
          'ACTION:AUDIO',
          'TRIGGER;RELATED=END:PT5M',
          'END:VALARM',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER;VALUE=DATE-TIME:20261019T080000Z',
          'END:VALARM',
        ),
      ),
    );
    const event = only(cal);
    expect(cal.warnings).toEqual([]);
    expect(event).toMatchObject({
      uid: 'abc@google.com',
      uidDerived: false,
      recurrenceId: null,
      sequence: 3,
      summary: 'Koor, proov',
      location: 'Tallinn',
      description: 'Line one\nLine two',
      url: 'https://example.com/x',
      start: { kind: 'zoned', tzid: 'Europe/Tallinn', value: { date: { year: 2026, month: 10, day: 19 }, minute: 1140 } },
      end: { kind: 'zoned', tzid: 'Europe/Tallinn', value: { date: { year: 2026, month: 10, day: 19 }, minute: 1200 } },
      duration: null,
      status: 'CONFIRMED',
      transp: 'TRANSPARENT',
      thirteenRule: 'SYSTEM=ifc;KIND=monthly;DAY=12',
      created: { kind: 'utc' },
      lastModified: { kind: 'utc' },
      dtstamp: { kind: 'utc', value: { date: { year: 2026, month: 10, day: 3 }, minute: 600 } },
      importedLastModified: { kind: 'utc' },
      line: 4,
    });
    expect(event.rrules).toEqual([parseRRule('FREQ=WEEKLY;UNTIL=20261116T165959Z;BYDAY=MO')]);
    expect(event.exrules).toEqual([parseRRule('FREQ=MONTHLY;BYMONTHDAY=1')]);
    expect(event.exdates.map((x) => x.kind)).toEqual(['zoned', 'zoned']);
    expect(event.rdates).toEqual([
      { value: { kind: 'utc', value: { date: { year: 2026, month: 10, day: 20 }, minute: 720 } }, period: 'PT3H' },
      { value: { kind: 'utc', value: { date: { year: 2026, month: 10, day: 21 }, minute: 720 } }, period: '20261021T130000Z' },
      { value: { kind: 'date', date: { year: 2026, month: 12, day: 24 } }, period: null },
    ]);
    expect(event.extra).toEqual([
      { name: 'ATTENDEE', params: [['CN', '"Kask, Liis"']], value: 'mailto:liis@example.com' },
      { name: 'CATEGORIES', params: [], value: 'Music' },
    ]);
    expect(event.alarms).toEqual([
      { action: 'DISPLAY', trigger: { kind: 'relative', minutes: -30, related: 'start' }, extra: [{ name: 'DESCRIPTION', params: [], value: 'Reminder' }, { name: 'X-WR-ALARMUID', params: [], value: '1' }] },
      { action: 'AUDIO', trigger: { kind: 'relative', minutes: 5, related: 'end' }, extra: [] },
      { action: 'DISPLAY', trigger: { kind: 'absolute', value: { kind: 'utc', value: { date: { year: 2026, month: 10, day: 19 }, minute: 480 } } }, extra: [] },
    ]);
    expect(event.raw).toBe(event.original);
    expect(event.raw!.startsWith('BEGIN:VEVENT\r\nUID:abc@google.com\r\n')).toBe(true);
    expect(event.raw!.endsWith('END:VALARM\r\nEND:VEVENT\r\n')).toBe(true);
  });

  it('defaults: empty texts, sequence 0, no end', () => {
    const event = only(parseICalendar(calendar(...vevent('UID:a', 'DTSTART:20261019T090000'))));
    expect(event).toMatchObject({ summary: '', location: '', description: '', url: '', sequence: 0, end: null, duration: null, status: null, transp: null, thirteenRule: null });
    expect(event.start.kind).toBe('floating');
  });

  it('reads DURATION and keeps DTEND when both are given', () => {
    expect(only(parseICalendar(calendar(...vevent('UID:a', 'DTSTART:20261019T090000Z', 'DURATION:PT1H30M')))).duration).toBe('PT1H30M');
    const both = parseICalendar(calendar(...vevent('UID:a', 'DTSTART:20261019T090000Z', 'DURATION:PT1H', 'DTEND:20261019T100000Z')));
    expect(only(both).duration).toBeNull();
    expect(only(both).end!.kind).toBe('utc');
    expect(only(both).extra.map((p) => p.name)).toEqual(['DURATION']);
    expect(codes(both)).toEqual(['bad-line']);
  });

  it('reads DTEND;VALUE=DATE:10000101 after an all-day start as the end of 9999-12-31 (§3.1.1)', () => {
    const one = only(parseICalendar(calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:99991231', 'DTEND;VALUE=DATE:10000101'))));
    expect([one.end, one.duration]).toEqual([null, 'P1D']);
    const three = only(parseICalendar(calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:99991229', 'DTEND:10000101'))));
    expect([three.end, three.duration]).toEqual([null, 'P3D']);
    // A start before year 1000: the text is January 1, 1000.
    const old = only(parseICalendar(calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:09991231', 'DTEND;VALUE=DATE:10000101'))));
    expect([old.end, old.duration]).toEqual([{ kind: 'date', date: { year: 1000, month: 1, day: 1 } }, null]);
    // No other 5-digit year.
    const bad = parseICalendar(calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:99991231', 'DTEND;VALUE=DATE:100000102')));
    expect(codes(bad)).toEqual(['bad-date']);
    expect(only(bad).end).toBeNull();
  });

  it('keeps an X-THIRTEEN-RULE of another version as an extra property', () => {
    const event = only(parseICalendar(calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'X-THIRTEEN-RULE;VERSION=2:SYSTEM=ifc'))));
    expect(event.thirteenRule).toBeNull();
    expect(event.extra.map((p) => p.name)).toEqual(['X-THIRTEEN-RULE']);
  });

  it('keeps a repeated single-valued property as an extra property', () => {
    const event = only(parseICalendar(calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'SUMMARY:One', 'SUMMARY:Two'))));
    expect(event.summary).toBe('One');
    expect(event.extra).toEqual([{ name: 'SUMMARY', params: [], value: 'Two' }]);
  });
});

describe('parseICalendar: warnings', () => {
  it('bad-line: lines that are not content lines, stray END, outside a calendar', () => {
    const cal = parseICalendar(crlf('junk before', 'BEGIN:VCALENDAR', 'not a line', 'END:VTODO', ...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'SEQUENCE:x'), 'END:VCALENDAR', 'X-AFTER:1'));
    expect(cal.warnings.map((w) => [w.line, w.code])).toEqual([
      [1, 'bad-line'],
      [3, 'bad-line'],
      [4, 'bad-line'],
      [8, 'bad-line'],
      [11, 'bad-line'],
    ]);
    expect(only(cal).extra).toEqual([{ name: 'SEQUENCE', params: [], value: 'x' }]);
  });

  it('bad-date: an unreadable DTSTART skips the event (kept in others); other dates stay as extra properties', () => {
    const cal = parseICalendar(
      calendar(
        ...vevent('UID:a', 'DTSTART:2026-10-19'),
        ...vevent('UID:b', 'DTSTART;VALUE=DATE:20261019', 'DTEND:20261332', 'EXDATE:20261020,bad', 'RDATE:20261021T25', 'LAST-MODIFIED:x'),
      ),
    );
    expect(codes(cal)).toEqual(['bad-date', 'bad-date', 'bad-date', 'bad-date', 'bad-date']);
    expect(cal.groups.map((g) => g.uid)).toEqual(['b']);
    expect(cal.others.map((o) => [o.name, o.line])).toEqual([['VEVENT', 4]]);
    expect(only(cal).extra.map((p) => p.name)).toEqual(['DTEND', 'EXDATE', 'RDATE', 'LAST-MODIFIED']);
    expect([only(cal).end, only(cal).exdates, only(cal).rdates, only(cal).lastModified]).toEqual([null, [], [], null]);
  });

  it('bad-rrule: the rule stays as an extra property', () => {
    const cal = parseICalendar(calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=WEEKLY;COUNT=2;UNTIL=20261231', 'RRULE:FREQ=DAILY;COUNT=2')));
    expect(codes(cal)).toEqual(['bad-rrule']);
    expect(only(cal).rrules).toEqual([parseRRule('FREQ=DAILY;COUNT=2')]);
    expect(only(cal).extra.map((p) => p.value)).toEqual(['FREQ=WEEKLY;COUNT=2;UNTIL=20261231']);
  });

  it('missing-dtstart: the event is skipped and kept in others', () => {
    const cal = parseICalendar(calendar(...vevent('UID:a', 'SUMMARY:No start')));
    expect(codes(cal)).toEqual(['missing-dtstart']);
    expect(cal.groups).toEqual([]);
    expect(cal.others).toHaveLength(1);
  });

  it('missing-uid: the derived UID of §2.17 from the calendar id, DTSTART line and SUMMARY', () => {
    const text = calendar(...vevent('dtstart;tzid=Europe/Tallinn:20261019T090000', 'SUMMARY:Dentist\\, Tuesday'));
    const cal = parseICalendar(text, { calendarId: '6f1c2d1e-8a7b-4c2e-9a51-3f0f5d9b2c11' });
    const expected = createHash('sha256').update('6f1c2d1e-8a7b-4c2e-9a51-3f0f5d9b2c11\ndtstart;tzid=Europe/Tallinn:20261019T090000\nDentist, Tuesday', 'utf8').digest('hex').slice(0, 32);
    expect(only(cal).uid).toBe(`missing-${expected}`);
    expect(only(cal).uidDerived).toBe(true);
    expect(codes(cal)).toEqual(['missing-uid']);
    // Stable across reads; another calendar gives another UID.
    expect(only(parseICalendar(text, { calendarId: '6f1c2d1e-8a7b-4c2e-9a51-3f0f5d9b2c11' })).uid).toBe(only(cal).uid);
    expect(only(parseICalendar(text, { calendarId: 'other' })).uid).not.toBe(only(cal).uid);
    expect(only(parseICalendar(text)).uid).toMatch(/^missing-[0-9a-f]{32}$/);
  });

  it('unclosed-component: an open VEVENT ends at the next top-level component or the calendar end', () => {
    const cal = parseICalendar(
      calendar('BEGIN:VEVENT', 'UID:a', 'DTSTART;VALUE=DATE:20261019', ...vevent('UID:b', 'DTSTART;VALUE=DATE:20261020'), 'BEGIN:VEVENT', 'UID:c', 'DTSTART;VALUE=DATE:20261021'),
    );
    expect(cal.warnings.map((w) => [w.line, w.code])).toEqual([
      [4, 'unclosed-component'],
      [11, 'unclosed-component'],
    ]);
    expect(cal.groups.map((g) => g.uid)).toEqual(['b']);
    expect(cal.others.map((o) => o.raw)).toEqual([crlf('BEGIN:VEVENT', 'UID:a', 'DTSTART;VALUE=DATE:20261019'), crlf('BEGIN:VEVENT', 'UID:c', 'DTSTART;VALUE=DATE:20261021')]);
  });

  it('unclosed-component: a VALARM without END inside a closed VEVENT is still read', () => {
    const cal = parseICalendar(calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT5M')));
    expect(codes(cal)).toEqual(['unclosed-component']);
    expect(only(cal).alarms).toHaveLength(1);
  });

  it('skipped-component: VTODO, VJOURNAL and unknown subcomponents are kept as read', () => {
    const cal = parseICalendar(
      calendar('BEGIN:VTODO', 'UID:t', 'END:VTODO', 'BEGIN:VJOURNAL', 'UID:j', 'END:VJOURNAL', ...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'BEGIN:X-THING', 'X:1', 'END:X-THING', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'END:VALARM')),
    );
    expect(codes(cal)).toEqual(['skipped-component', 'skipped-component', 'skipped-component', 'skipped-component']);
    expect(cal.others.map((o) => o.name)).toEqual(['VTODO', 'VJOURNAL']);
    expect(only(cal).alarms).toEqual([]);
  });

  it('duplicate-uid: exact copies collapse; a second master starts a group; a repeated RECURRENCE-ID stays', () => {
    const master = vevent('UID:dup', 'DTSTART:20261019T090000Z', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:Daily');
    const override = vevent('UID:dup', 'RECURRENCE-ID:20261020T090000Z', 'DTSTART:20261020T100000Z', 'SUMMARY:Moved');
    const cal = parseICalendar(
      calendar(
        ...master,
        ...master,
        ...override,
        ...vevent('UID:dup', 'RECURRENCE-ID:20261020T090000Z', 'DTSTART:20261020T110000Z', 'SUMMARY:Moved again'),
        ...vevent('UID:dup', 'DTSTART:20261019T090000Z', 'SUMMARY:Second master'),
      ),
    );
    expect(codes(cal)).toEqual(['duplicate-uid', 'duplicate-uid', 'duplicate-uid']);
    expect(cal.groups.map((g) => [g.uid, g.master!.summary, g.overrides.map((o) => o.summary)])).toEqual([
      ['dup', 'Daily', ['Moved', 'Moved again']],
      ['dup', 'Second master', []],
    ]);
    expect(cal.others).toHaveLength(1);
  });

  it('unknown-tzid: only with a resolver, for a TZID that is neither known, Windows nor defined here', () => {
    const text = calendar(
      ...FLE_VTIMEZONE,
      ...vevent('UID:a', 'DTSTART;TZID=Europe/Tallinn:20261019T090000'),
      ...vevent('UID:b', 'DTSTART;TZID=FLE Standard Time:20261019T090000'),
      ...vevent('UID:c', 'DTSTART;TZID=Nowhere/Special:20261019T090000'),
      'BEGIN:VTIMEZONE',
      'TZID:Customized Time Zone',
      'BEGIN:STANDARD',
      'DTSTART:16010101T000000',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0100',
      'END:STANDARD',
      'END:VTIMEZONE',
      ...vevent('UID:d', 'DTSTART;TZID=Customized Time Zone:20261019T090000'),
    );
    expect(codes(parseICalendar(text))).toEqual([]);
    const cal = parseICalendar(text, { zones });
    expect(cal.warnings.map((w) => [w.code, w.line])).toEqual([['unknown-tzid', 27]]);
    expect(cal.timeZones.map((t) => [t.tzid, t.observances.length])).toEqual([
      ['FLE Standard Time', 2],
      ['Customized Time Zone', 1],
    ]);
  });
});

describe('parseICalendar: groups and order', () => {
  it('groups overrides with their master in document order, also when the override comes first', () => {
    const cal = parseICalendar(
      calendar(
        ...vevent('UID:a', 'RECURRENCE-ID;VALUE=DATE:20261020', 'DTSTART;VALUE=DATE:20261021'),
        ...vevent('UID:b', 'DTSTART;VALUE=DATE:20261019'),
        ...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=DAILY'),
        ...vevent('UID:c', 'RECURRENCE-ID;VALUE=DATE:20261020', 'DTSTART;VALUE=DATE:20261020'),
      ),
    );
    expect(cal.groups.map((g) => [g.uid, g.master?.line ?? null, g.overrides.map((o) => o.line)])).toEqual([
      ['a', 13, [4]],
      ['b', 9, []],
      ['c', null, [18]],
    ]);
  });

  it('reads VTIMEZONEs with their observances', () => {
    const cal = parseICalendar(calendar(...TALLINN_VTIMEZONE, 'BEGIN:VTIMEZONE', 'TZID:Gen', 'X-THIRTEEN-GENERATED:2026-2027', 'BEGIN:STANDARD', 'DTSTART:20250101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'END:STANDARD', 'END:VTIMEZONE'));
    expect(cal.timeZones[0]).toMatchObject({ tzid: 'Europe/Tallinn', generated: null, line: 4 });
    expect(cal.timeZones[0]!.observances).toEqual([
      { kind: 'daylight', start: { date: { year: 1970, month: 3, day: 29 }, minute: 180 }, offsetFrom: 120, offsetTo: 180, rrules: [parseRRule('FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU')], rdates: [], names: ['EEST'] },
      { kind: 'standard', start: { date: { year: 1970, month: 10, day: 25 }, minute: 240 }, offsetFrom: 180, offsetTo: 120, rrules: [parseRRule('FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU')], rdates: [], names: ['EET'] },
    ]);
    expect(cal.timeZones[1]!.generated).toEqual({ first: 2026, last: 2027 });
    expect(cal.timeZones[0]!.raw).toBe(crlf(...TALLINN_VTIMEZONE));
  });

  it('keeps a VTIMEZONE without TZID in others', () => {
    const cal = parseICalendar(calendar('BEGIN:VTIMEZONE', 'BEGIN:STANDARD', 'END:STANDARD', 'END:VTIMEZONE'));
    expect(cal.timeZones).toEqual([]);
    expect(codes(cal)).toEqual(['skipped-component']);
    expect(cal.others).toHaveLength(1);
  });

  it('results are fresh plain data', () => {
    const cal = parseICalendar(calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'X-A;P=1:v')));
    expect(JSON.parse(JSON.stringify(cal))).toEqual(cal);
    expect(Object.keys(only(cal).extra[0]!)).toEqual(['name', 'params', 'value']);
  });
});
