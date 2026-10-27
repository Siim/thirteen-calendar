/**
 * Occurrences of calendar texts (docs/EVENTS.md §3.2 keys, §4.6, §5.4
 * `eventsFromCalendar`, the §5.6 scenarios).
 */
import { describe, expect, it } from 'vitest';
import { recognizeRecurrence } from '../../src/events/recurrence.ts';
import { formatLocalDateTime } from '../../src/events/time.ts';
import { type IcsExpandedEvent, eventsFromCalendar, expandCalendar, icsRecognitionInput, parseICalendar } from '../../src/ics/index.ts';
import { FLE_VTIMEZONE, TALLINN_VTIMEZONE, W, calendar, vevent, zones } from './helpers.ts';

const brief = (events: readonly IcsExpandedEvent[]) => events.map((e) => `${e.key} ${formatLocalDateTime(e.start)}..${formatLocalDateTime(e.end)}`);
const expand = (text: string, deviceZone: string, from: string, to: string, calendarId = 'c') =>
  eventsFromCalendar(parseICalendar(text, { calendarId }), deviceZone, zones, W(from, to), 'ifc', { calendarId });

describe('eventsFromCalendar: window edges (window-edges.ics)', () => {
  const text = calendar(
    ...vevent('UID:winter', 'DTSTART;VALUE=DATE:20261228', 'DTEND;VALUE=DATE:20270104', 'SUMMARY:Winter break'),
    ...vevent('UID:nye', 'DTSTART;TZID=Europe/Tallinn:20261231T220000', 'DTEND;TZID=Europe/Tallinn:20270101T013000', 'SUMMARY:Party'),
    ...vevent('UID:kiri', 'DTSTART;TZID=Pacific/Kiritimati:20270101T010000', 'DTEND;TZID=Pacific/Kiritimati:20270101T020000', 'SUMMARY:Line Islands'),
    ...vevent('UID:monthly', 'DTSTART;TZID=Europe/Tallinn:20261215T090000', 'DTEND;TZID=Europe/Tallinn:20261215T100000', 'RRULE:FREQ=MONTHLY;COUNT=3', 'SUMMARY:Monthly'),
    ...vevent('UID:monthly', 'RECURRENCE-ID;TZID=Europe/Tallinn:20261215T090000', 'DTSTART;TZID=Europe/Tallinn:20270105T090000', 'DTEND;TZID=Europe/Tallinn:20270105T100000', 'SUMMARY:Moved into January'),
    ...vevent('UID:monthly', 'RECURRENCE-ID;TZID=Europe/Tallinn:20270115T090000', 'DTSTART;TZID=Europe/Tallinn:20261220T090000', 'DTEND;TZID=Europe/Tallinn:20261220T100000', 'SUMMARY:Moved into December'),
  );

  it('2027 in Tallinn: the break that began in 2026, the party crossing midnight, overrides by their own time', () => {
    expect(brief(expand(text, 'Europe/Tallinn', '2027-01-01T00:00', '2028-01-01T00:00'))).toEqual([
      'c/winter|2026-12-28 2026-12-28T00:00..2027-01-03T24:00',
      'c/nye|2026-12-31T22:00 2026-12-31T22:00..2027-01-01T01:30',
      'c/monthly|2026-12-15T09:00 2027-01-05T09:00..2027-01-05T10:00',
      'c/monthly|2027-02-15T09:00 2027-02-15T09:00..2027-02-15T10:00',
    ]);
  });

  it('2026 in Tallinn: the override moved into December appears, the Kiritimati event is on January 1 at 13:00', () => {
    expect(brief(expand(text, 'Europe/Tallinn', '2026-01-01T00:00', '2027-01-01T00:00'))).toEqual([
      'c/monthly|2027-01-15T09:00 2026-12-20T09:00..2026-12-20T10:00',
      'c/winter|2026-12-28 2026-12-28T00:00..2027-01-03T24:00',
      'c/kiri|2027-01-01T01:00 2026-12-31T13:00..2026-12-31T14:00',
      'c/nye|2026-12-31T22:00 2026-12-31T22:00..2027-01-01T01:30',
    ]);
  });

  it('Pacific/Honolulu sees 01:00 on January 1 in Kiritimati on December 31', () => {
    const events = expand(text, 'Pacific/Honolulu', '2026-12-31T00:00', '2027-01-01T00:00').filter((e) => e.uid === 'kiri');
    expect(brief(events)).toEqual(['c/kiri|2027-01-01T01:00 2026-12-31T01:00..2026-12-31T02:00']);
    expect(events[0]).toMatchObject({ zone: 'Pacific/Kiritimati', recurring: false, orphan: false, status: 'confirmed', group: 2, title: 'Line Islands', calendarId: 'c', allDay: false });
  });
});

describe('eventsFromCalendar: the year 9999 (far-future.ics)', () => {
  const text = calendar(
    ...vevent('UID:last-day', 'DTSTART;VALUE=DATE:99991231', 'SUMMARY:Last day'),
    ...vevent('UID:ny', 'DTSTART;TZID=America/New_York:99991231T230000', 'SUMMARY:New York'),
    ...vevent('UID:tallinn', 'DTSTART;TZID=Europe/Tallinn:99991231T150000', 'SUMMARY:Tallinn'),
    ...vevent('UID:daily', 'DTSTART;TZID=Europe/Tallinn:99991229T090000', 'RRULE:FREQ=DAILY', 'SUMMARY:Daily'),
    ...vevent('UID:dtend', 'DTSTART;VALUE=DATE:99991230', 'DTEND;VALUE=DATE:10000101', 'SUMMARY:Two days'),
  );
  const window = ['9999-01-01T00:00', '9999-12-31T24:00'] as const;

  it.each([
    [
      'Europe/Tallinn',
      [
        'c/daily|9999-12-29T09:00 9999-12-29T09:00..9999-12-29T09:00',
        'c/dtend|9999-12-30 9999-12-30T00:00..9999-12-31T24:00',
        'c/daily|9999-12-30T09:00 9999-12-30T09:00..9999-12-30T09:00',
        'c/last-day|9999-12-31 9999-12-31T00:00..9999-12-31T24:00',
        'c/daily|9999-12-31T09:00 9999-12-31T09:00..9999-12-31T09:00',
        'c/tallinn|9999-12-31T15:00 9999-12-31T15:00..9999-12-31T15:00',
      ],
    ],
    [
      'Pacific/Kiritimati',
      [
        'c/daily|9999-12-29T09:00 9999-12-29T21:00..9999-12-29T21:00',
        'c/dtend|9999-12-30 9999-12-30T00:00..9999-12-31T24:00',
        'c/daily|9999-12-30T09:00 9999-12-30T21:00..9999-12-30T21:00',
        'c/last-day|9999-12-31 9999-12-31T00:00..9999-12-31T24:00',
        'c/daily|9999-12-31T09:00 9999-12-31T21:00..9999-12-31T21:00',
      ],
    ],
  ])('in %s', (deviceZone, expected) => {
    const result = expandCalendar(parseICalendar(text), deviceZone, zones, W(...window), 'ifc', { calendarId: 'c' });
    expect(brief(result.events)).toEqual(expected);
    const dropped = result.warnings.map((w) => [w.code, w.line, w.detail.includes('UID ny') || w.detail.includes('UID tallinn')]);
    expect(dropped).toEqual(deviceZone === 'Europe/Tallinn' ? [['out-of-range', 9, true]] : [['out-of-range', 9, true], ['out-of-range', 14, true]]);
  });
});

describe('eventsFromCalendar: UNTIL instants (until-instant.ics)', () => {
  it('a series ended one second before an occurrence and its continuation show November 16 once', () => {
    const text = calendar(
      ...TALLINN_VTIMEZONE,
      ...vevent('UID:head', 'DTSTART;TZID=Europe/Tallinn:20261019T190000', 'DTEND;TZID=Europe/Tallinn:20261019T200000', 'RRULE:FREQ=WEEKLY;UNTIL=20261116T165959Z'),
      ...vevent('UID:tail', 'DTSTART;TZID=Europe/Tallinn:20261116T190000', 'DTEND;TZID=Europe/Tallinn:20261116T200000', 'RRULE:FREQ=WEEKLY;COUNT=2'),
      ...vevent('UID:midnight', 'DTSTART;TZID=Europe/Tallinn:20261019T190000', 'RRULE:FREQ=WEEKLY;UNTIL=20261116T000000Z'),
    );
    const events = expand(text, 'Europe/Tallinn', '2026-10-01T00:00', '2027-01-01T00:00');
    const days = (uid: string) => events.filter((e) => e.uid === uid).map((e) => `${e.start.date.month}-${e.start.date.day}`);
    expect(days('head')).toEqual(['10-19', '10-26', '11-2', '11-9']);
    expect(days('tail')).toEqual(['11-16', '11-23']);
    expect(days('midnight')).toEqual(['10-19', '10-26', '11-2', '11-9']);
  });
});

describe('eventsFromCalendar: extra dates and exclusions (rrule-rdate.ics)', () => {
  it('COUNT bounds the rule only; RDATEs with their own time and PERIOD length; EXDATE at an own time', () => {
    const text = calendar(
      ...vevent(
        'UID:r',
        'DTSTART:20261019T090000Z',
        'DTEND:20261019T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'RDATE:20261102T150000Z',
        'RDATE;VALUE=PERIOD:20261124T080000Z/PT3H',
        'RDATE:20261201T090000Z',
        'EXDATE:20261026T090000Z',
      ),
    );
    expect(brief(expand(text, 'UTC', '2026-10-01T00:00', '2027-01-01T00:00'))).toEqual([
      'c/r|2026-10-19T09:00 2026-10-19T09:00..2026-10-19T10:00',
      'c/r|2026-11-02T09:00 2026-11-02T09:00..2026-11-02T10:00',
      'c/r|2026-11-02T15:00 2026-11-02T15:00..2026-11-02T16:00',
      'c/r|2026-11-24T08:00 2026-11-24T08:00..2026-11-24T11:00',
      'c/r|2026-12-01T09:00 2026-12-01T09:00..2026-12-01T10:00',
    ]);
  });

  it('a recognized 13-month series expands like its BYYEARDAY rule', () => {
    const text = calendar(
      ...vevent('UID:t', 'DTSTART;VALUE=DATE:20261116', 'RRULE:FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18', 'X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=monthly;DAY=12'),
    );
    const cal = parseICalendar(text);
    expect(recognizeRecurrence(icsRecognitionInput(cal.groups[0]!.master!, cal, zones)).recurrence.rule).toEqual({ kind: 'thirteen', rule: { kind: 'monthly', system: 'ifc', day: 12 } });
    const events = eventsFromCalendar(cal, 'Europe/Tallinn', zones, W('2026-11-01T00:00', '2027-03-01T00:00'));
    expect(events.map((e) => e.key)).toEqual(['/t|2026-11-16', '/t|2026-12-14', '/t|2027-01-12', '/t|2027-02-09']);
    expect(events.every((e) => e.recurring && e.allDay && e.zone === null)).toBe(true);
  });
});

describe('eventsFromCalendar: duplicates, orphans and statuses (duplicate-uid.ics, override-only.ics)', () => {
  it('gives a second master and a second override of one RECURRENCE-ID their own #n keys', () => {
    const text = calendar(
      ...vevent('UID:d', 'DTSTART:20261019T090000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Daily'),
      ...vevent('UID:d', 'RECURRENCE-ID:20261020T090000Z', 'DTSTART:20261020T120000Z', 'SUMMARY:Moved'),
      ...vevent('UID:d', 'RECURRENCE-ID:20261020T090000Z', 'DTSTART:20261020T130000Z', 'SUMMARY:Moved again'),
      ...vevent('UID:d', 'DTSTART:20261019T090000Z', 'SUMMARY:Second master'),
      ...vevent('UID:d', 'DTSTART:20261019T090000Z', 'SUMMARY:Third master'),
    );
    const events = expand(text, 'UTC', '2026-10-01T00:00', '2026-11-01T00:00');
    expect(events.map((e) => [e.key, e.title, formatLocalDateTime(e.start)])).toEqual([
      ['c/d|2026-10-19T09:00', 'Daily', '2026-10-19T09:00'],
      ['c/d|2026-10-19T09:00#2', 'Second master', '2026-10-19T09:00'],
      ['c/d|2026-10-19T09:00#3', 'Third master', '2026-10-19T09:00'],
      ['c/d|2026-10-20T09:00', 'Moved', '2026-10-20T12:00'],
      ['c/d|2026-10-20T09:00#2', 'Moved again', '2026-10-20T13:00'],
      ['c/d|2026-10-21T09:00', 'Daily', '2026-10-21T09:00'],
    ]);
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
  });

  it('shows the overrides of a group without a master on their own, keyed by RECURRENCE-ID', () => {
    const text = calendar(
      ...vevent('UID:inv', 'RECURRENCE-ID;TZID=Europe/Tallinn:20261020T090000', 'DTSTART;TZID=Europe/Tallinn:20261020T100000', 'DTEND;TZID=Europe/Tallinn:20261020T110000', 'SUMMARY:One instance'),
      ...vevent('UID:inv', 'RECURRENCE-ID;TZID=Europe/Tallinn:20261027T090000', 'DTSTART;TZID=Europe/Tallinn:20261028T090000', 'DTEND;TZID=Europe/Tallinn:20261028T100000', 'SUMMARY:Another'),
      ...vevent('UID:inv', 'RECURRENCE-ID;TZID=Europe/Tallinn:20261103T090000', 'DTSTART;TZID=Europe/Tallinn:20261103T090000', 'STATUS:CANCELLED'),
    );
    const events = expand(text, 'Europe/Tallinn', '2026-10-01T00:00', '2026-12-01T00:00');
    expect(events.map((e) => [e.key, formatLocalDateTime(e.start), e.orphan, e.recurring])).toEqual([
      ['c/inv|2026-10-20T09:00', '2026-10-20T10:00', true, false],
      ['c/inv|2026-10-27T09:00', '2026-10-28T09:00', true, false],
    ]);
    expect(events[0]!.component.summary).toBe('One instance');
  });

  it('canceled overrides remove their occurrence; a canceled master is shown as canceled; tentative stays', () => {
    const text = calendar(
      ...vevent('UID:s', 'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=DAILY;COUNT=3', 'STATUS:TENTATIVE'),
      ...vevent('UID:s', 'RECURRENCE-ID;VALUE=DATE:20261020', 'DTSTART;VALUE=DATE:20261020', 'STATUS:CANCELLED'),
      ...vevent('UID:x', 'DTSTART;VALUE=DATE:20261019', 'STATUS:CANCELLED'),
    );
    expect(expand(text, 'UTC', '2026-10-01T00:00', '2026-11-01T00:00').map((e) => [e.key, e.status])).toEqual([
      ['c/s|2026-10-19', 'tentative'],
      ['c/x|2026-10-19', 'canceled'],
      ['c/s|2026-10-21', 'tentative'],
    ]);
  });

  it('keys events without UID by their derived UID, the same on every read (missing-uid.ics)', () => {
    const text = calendar(...vevent('DTSTART;VALUE=DATE:20261019', 'SUMMARY:No UID'));
    const [first] = expand(text, 'UTC', '2026-10-01T00:00', '2026-11-01T00:00', 'cal-1');
    const [again] = expand(text, 'UTC', '2026-10-01T00:00', '2026-11-01T00:00', 'cal-1');
    expect(first!.key).toMatch(/^cal-1\/missing-[0-9a-f]{32}\|2026-10-19$/);
    expect(again!.key).toBe(first!.key);
  });
});

describe('eventsFromCalendar: zones and lengths', () => {
  it('floating events follow the device; UTC, Windows and file-defined zones convert', () => {
    const text = calendar(
      ...FLE_VTIMEZONE,
      'BEGIN:VTIMEZONE',
      'TZID:Customized Time Zone',
      'BEGIN:STANDARD',
      'DTSTART:16010101T000000',
      'TZOFFSETFROM:+0530',
      'TZOFFSETTO:+0530',
      'END:STANDARD',
      'END:VTIMEZONE',
      ...vevent('UID:floating', 'DTSTART:20261019T090000', 'DTEND:20261019T100000'),
      ...vevent('UID:utc', 'DTSTART:20261019T090000Z', 'DTEND:20261019T100000Z'),
      ...vevent('UID:windows', 'DTSTART;TZID=FLE Standard Time:20261019T090000', 'DTEND;TZID=FLE Standard Time:20261019T100000'),
      ...vevent('UID:custom', 'DTSTART;TZID=Customized Time Zone:20261019T090000', 'DTEND;TZID=Customized Time Zone:20261019T100000'),
      ...vevent('UID:unknown', 'DTSTART;TZID=Nowhere/Special:20261019T090000'),
    );
    const events = expand(text, 'America/New_York', '2026-10-18T00:00', '2026-10-21T00:00');
    expect(events.map((e) => [e.uid, formatLocalDateTime(e.start), formatLocalDateTime(e.end), e.zone])).toEqual([
      ['custom', '2026-10-18T23:30', '2026-10-19T00:30', 'Customized Time Zone'],
      ['windows', '2026-10-19T02:00', '2026-10-19T03:00', 'Europe/Kiev'],
      ['utc', '2026-10-19T05:00', '2026-10-19T06:00', 'UTC'],
      ['floating', '2026-10-19T09:00', '2026-10-19T10:00', null],
      ['unknown', '2026-10-19T09:00', '2026-10-19T09:00', null],
    ]);
  });

  it('DURATION: hours exactly across a DST change, days on the wall clock; DTEND in another zone', () => {
    const text = calendar(
      ...vevent('UID:hours', 'DTSTART;TZID=Europe/Tallinn:20260328T230000', 'DURATION:PT5H'),
      ...vevent('UID:days', 'DTSTART;TZID=Europe/Tallinn:20260328T120000', 'DURATION:P1D'),
      ...vevent('UID:allday', 'DTSTART;VALUE=DATE:20260328', 'DURATION:P2D'),
      ...vevent('UID:other-zone', 'DTSTART;TZID=Europe/Tallinn:20260301T120000', 'DTEND;TZID=America/New_York:20260301T060000'),
      ...vevent('UID:backwards', 'DTSTART;TZID=Europe/Tallinn:20260301T120000', 'DTEND;TZID=Europe/Tallinn:20260301T110000'),
    );
    const events = expand(text, 'Europe/Tallinn', '2026-03-01T00:00', '2026-04-01T00:00');
    expect(events.map((e) => [e.uid, formatLocalDateTime(e.start), formatLocalDateTime(e.end)])).toEqual([
      ['backwards', '2026-03-01T12:00', '2026-03-01T12:00'],
      ['other-zone', '2026-03-01T12:00', '2026-03-01T13:00'],
      ['allday', '2026-03-28T00:00', '2026-03-29T24:00'],
      ['days', '2026-03-28T12:00', '2026-03-29T12:00'],
      ['hours', '2026-03-28T23:00', '2026-03-29T05:00'],
    ]);
  });

  it('DURATION with days on a repeat: every occurrence ends at the same wall-clock time (RFC 5545 §3.8.5.3)', () => {
    const text = calendar(
      ...vevent('UID:across', 'DTSTART;TZID=America/New_York:20260307T120000', 'DURATION:P1D', 'RRULE:FREQ=DAILY;COUNT=3'),
      ...vevent('UID:before', 'DTSTART;TZID=America/New_York:20260306T120000', 'DURATION:P1DT1H', 'RRULE:FREQ=DAILY;COUNT=3'),
      ...vevent('UID:period', 'DTSTART;TZID=America/New_York:20260301T120000', 'DTEND;TZID=America/New_York:20260301T130000',
        'RDATE;VALUE=PERIOD;TZID=America/New_York:20260307T120000/P1D'),
    );
    const events = expand(text, 'America/New_York', '2026-03-01T00:00', '2026-03-20T00:00');
    expect(events.map((e) => `${e.uid} ${formatLocalDateTime(e.start)}..${formatLocalDateTime(e.end)}`)).toEqual([
      'period 2026-03-01T12:00..2026-03-01T13:00',
      'before 2026-03-06T12:00..2026-03-07T13:00',
      'across 2026-03-07T12:00..2026-03-08T12:00',
      'before 2026-03-07T12:00..2026-03-08T13:00',
      'period 2026-03-07T12:00..2026-03-08T12:00',
      'across 2026-03-08T12:00..2026-03-09T12:00',
      'before 2026-03-08T12:00..2026-03-09T13:00',
      'across 2026-03-09T12:00..2026-03-10T12:00',
    ]);
  });

  it('gives each timed occurrence its start instant for alerts, and none to all-day ones', () => {
    const text = calendar(
      ...vevent('UID:tallinn', 'DTSTART;TZID=Europe/Tallinn:20261101T083000', 'DTEND;TZID=Europe/Tallinn:20261101T090000'),
      ...vevent('UID:day', 'DTSTART;VALUE=DATE:20261101'),
    );
    const events = expand(text, 'America/New_York', '2026-10-31T00:00', '2026-11-02T00:00');
    // 06:30 UTC is the second 01:30 of New York's fall-back night; its wall clock alone would name 05:30 UTC.
    expect(events.map((e) => [e.uid, formatLocalDateTime(e.start), e.startUtc === null ? null : formatLocalDateTime(e.startUtc)])).toEqual([
      ['day', '2026-11-01T00:00', null],
      ['tallinn', '2026-11-01T01:30', '2026-11-01T06:30'],
    ]);
  });

  it('matches a RECURRENCE-ID or EXDATE at the instant of an occurrence in a DST gap', () => {
    // 02:30 on March 8 does not exist in New York: that occurrence starts at 03:30 EDT, 07:30 UTC.
    const master = ['DTSTART;TZID=America/New_York:20260306T023000', 'DTEND;TZID=America/New_York:20260306T030000', 'RRULE:FREQ=DAILY;COUNT=4'];
    const text = calendar(
      ...vevent('UID:moved', ...master),
      ...vevent('UID:moved', 'RECURRENCE-ID:20260308T073000Z', 'DTSTART;TZID=America/New_York:20260308T100000', 'DTEND;TZID=America/New_York:20260308T103000'),
      ...vevent('UID:removed', ...master, 'EXDATE;TZID=America/New_York:20260308T033000'),
    );
    const events = expand(text, 'America/New_York', '2026-03-08T00:00', '2026-03-09T00:00');
    expect(brief(events)).toEqual(['c/moved|2026-03-08T02:30 2026-03-08T10:00..2026-03-08T10:30']);
    expect(events.every((e) => !e.orphan)).toBe(true);
  });

  it('stops a stored leap-interval repeat at its UNTIL, the cap (§4.3 c)', () => {
    const text = calendar(
      ...vevent('UID:leap', 'DTSTART;VALUE=DATE:20240617', 'RRULE:FREQ=YEARLY;INTERVAL=4;UNTIL=20960617', 'X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=intercalary;DAY=LD'),
    );
    expect(brief(expand(text, 'UTC', '2096-01-01T00:00', '2097-01-01T00:00'))).toEqual(['c/leap|2096-06-17 2096-06-17T00:00..2096-06-17T24:00']);
    expect(expand(text, 'UTC', '2097-01-01T00:00', '2200-01-01T00:00')).toEqual([]);
  });

  it('validates its input', () => {
    const cal = parseICalendar(calendar());
    expect(() => eventsFromCalendar(cal, 'Nowhere', zones, W('2026-01-01T00:00', '2027-01-01T00:00'))).toThrow(RangeError);
    expect(() => eventsFromCalendar(cal, 'UTC', zones, W('2026-01-01T00:00', '2027-01-01T00:00'), 'julian' as never)).toThrow(RangeError);
    expect(() => eventsFromCalendar(cal, 'UTC', zones, W('2026-01-01T00:00', '2027-01-01T00:00'), 'ifc', { limit: 0 })).toThrow(RangeError);
    expect(() => eventsFromCalendar(cal, 'UTC', zones, W('2026-01-01T00:00', '2027-01-01T00:00'), 'ifc', { calendarId: 1 } as never)).toThrow(RangeError);
    expect(() => eventsFromCalendar({} as never, 'UTC', zones, W('2026-01-01T00:00', '2027-01-01T00:00'))).toThrow(RangeError);
    const one = parseICalendar(calendar(...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019')));
    expect(() => eventsFromCalendar(one, 'UTC', zones, W('2027-01-01T00:00', '2026-01-01T00:00'))).toThrow(RangeError);
  });
});
