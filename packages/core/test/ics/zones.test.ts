/**
 * Time zones of the `.ics` module (docs/EVENTS.md §5.4): `TZID` resolution,
 * `VTIMEZONE` offsets, `toUtc`, and generated `VTIMEZONE`s checked against
 * Node's `Intl` and against `ical.js` reading only the generated definition.
 */
import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { fromAbsoluteMinutes, toAbsoluteMinutes } from '../../src/events/time.ts';
import {
  type IcsTimeZone,
  buildVTimeZone,
  parseICalendar,
  resolveTzid,
  sameTimeZoneDefinition,
  serializeICalendar,
  toUtc,
  windowsZoneToIana,
} from '../../src/ics/index.ts';
import { serializeTimeZone } from '../../src/ics/serialize.ts';
import { vtimezoneResolver } from '../../src/ics/zones.ts';
import { FLE_VTIMEZONE, L, TALLINN_VTIMEZONE, calendar, crlf, vevent, zones } from './helpers.ts';

const DAY = 1440;

describe('windowsZoneToIana', () => {
  it('maps Windows ids through the CLDR table', () => {
    expect(windowsZoneToIana('FLE Standard Time')).toBe('Europe/Kiev');
    expect(windowsZoneToIana('Eastern Standard Time')).toBe('America/New_York');
    expect(windowsZoneToIana('W. Europe Standard Time')).toBe('Europe/Berlin');
    expect(windowsZoneToIana('fle standard time')).toBe('Europe/Kiev');
    expect(windowsZoneToIana('UTC')).toBe('Etc/UTC');
    expect(windowsZoneToIana('Europe/Tallinn')).toBeNull();
    expect(windowsZoneToIana('Customized Time Zone')).toBeNull();
  });
});

describe('resolveTzid', () => {
  const cal = parseICalendar(
    calendar(...FLE_VTIMEZONE, ...TALLINN_VTIMEZONE, 'BEGIN:VTIMEZONE', 'TZID:Customized Time Zone', 'BEGIN:STANDARD', 'DTSTART:16010101T000000', 'TZOFFSETFROM:+0530', 'TZOFFSETTO:+0530', 'END:STANDARD', 'END:VTIMEZONE', 'BEGIN:VTIMEZONE', 'TZID:Empty', 'END:VTIMEZONE'),
  );

  it('prefers a known IANA id, then a Windows id, then the file, else floating', () => {
    expect(resolveTzid('Europe/Tallinn', cal, zones)).toMatchObject({ kind: 'iana', tzid: 'Europe/Tallinn', zone: 'Europe/Tallinn', timeZone: null });
    expect(resolveTzid('FLE Standard Time', cal, zones)).toMatchObject({ kind: 'windows', zone: 'Europe/Kiev', timeZone: null });
    const own = resolveTzid('Customized Time Zone', cal, zones);
    expect(own).toMatchObject({ kind: 'vtimezone', zone: null });
    expect(own.timeZone!.tzid).toBe('Customized Time Zone');
    expect(resolveTzid('Empty', cal, zones)).toMatchObject({ kind: 'floating', resolver: null });
    expect(resolveTzid('Nowhere', cal, zones)).toMatchObject({ kind: 'floating', resolver: null });
    expect(resolveTzid('', cal, zones).kind).toBe('floating');
    expect(() => resolveTzid('x', cal, {} as never)).toThrow(RangeError);
  });

  it('converts values to UTC through the handle', () => {
    const local = { date: { year: 2026, month: 7, day: 1 }, minute: 540 };
    expect(toUtc({ kind: 'zoned', tzid: 'Europe/Tallinn', value: local }, resolveTzid('Europe/Tallinn', cal, zones))).toEqual(L('2026-07-01T06:00'));
    expect(toUtc({ kind: 'zoned', tzid: 'Customized Time Zone', value: local }, resolveTzid('Customized Time Zone', cal, zones))).toEqual(L('2026-07-01T03:30'));
    expect(toUtc({ kind: 'date', date: local.date }, resolveTzid('FLE Standard Time', cal, zones))).toEqual(L('2026-06-30T21:00'));
    expect(toUtc({ kind: 'utc', value: local }, resolveTzid('Nowhere', cal, zones))).toEqual(L('2026-07-01T09:00'));
    expect(toUtc({ kind: 'floating', value: local }, resolveTzid('Nowhere', cal, zones))).toBeNull();
    // DST gap: the §3.3 rule (New York 02:30 on the spring-forward night is 07:30Z).
    expect(toUtc({ kind: 'zoned', tzid: 'America/New_York', value: L('2026-03-08T02:30') }, resolveTzid('America/New_York', cal, zones))).toEqual(L('2026-03-08T07:30'));
    expect(toUtc({ kind: 'zoned', tzid: 'America/New_York', value: L('9999-12-31T23:00') }, resolveTzid('America/New_York', cal, zones))).toBeNull();
  });
});

/**
 * The offset of `resolver` for `zone` against Intl's over `from`..`to` (UTC):
 * every `stepMinutes`, and on both sides of every minute where Intl's offset
 * changes (found by bisection between two samples).
 */
function mismatches(resolver: { offsetMinutesAt(zone: string, utc: ReturnType<typeof L>): number }, name: string, iana: string, from: number, to: number, stepMinutes = 360): string[] {
  const out: string[] = [];
  const intl = (t: number) => zones.offsetMinutesAt(iana, fromAbsoluteMinutes(t)!);
  const check = (t: number) => {
    const at = fromAbsoluteMinutes(t)!;
    const ours = resolver.offsetMinutesAt(name, at);
    const theirs = intl(t);
    if (ours !== theirs) out.push(`${at.date.year}-${at.date.month}-${at.date.day} ${at.minute}: ${ours} vs ${theirs}`);
  };
  const end = toAbsoluteMinutes(L(`${to + 1}-01-01T00:00`));
  for (let t = toAbsoluteMinutes(L(`${from}-01-01T00:00`)); t < end; t += stepMinutes) {
    check(t);
    const next = Math.min(t + stepMinutes, end - 1);
    if (next > t && intl(next) !== intl(t)) {
      let [lo, hi] = [t, next];
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (intl(mid) === intl(t)) lo = mid;
        else hi = mid;
      }
      check(lo);
      check(hi);
    }
  }
  return out;
}

describe('VTIMEZONE offsets', () => {
  it('evaluate Google, Outlook and generated definitions like Intl', () => {
    const cal = parseICalendar(calendar(...TALLINN_VTIMEZONE, ...FLE_VTIMEZONE));
    expect(mismatches(vtimezoneResolver(cal.timeZones[0]!), 'Europe/Tallinn', 'Europe/Tallinn', 2024, 2027)).toEqual([]);
    expect(mismatches(vtimezoneResolver(cal.timeZones[1]!), 'FLE Standard Time', 'Europe/Helsinki', 2024, 2027)).toEqual([]);
  });

  it('the comparison with Intl finds a transition an hour or a minute off', () => {
    const shifted = (start: string) => parseICalendar(calendar(...TALLINN_VTIMEZONE.map((line) => (line === 'DTSTART:19700329T030000' ? `DTSTART:${start}` : line)))).timeZones[0]!;
    expect(mismatches(vtimezoneResolver(shifted('19700329T020000')), 'Europe/Tallinn', 'Europe/Tallinn', 2026, 2026)).toEqual(['2026-3-29 0: 180 vs 120', '2026-3-29 59: 180 vs 120']);
    expect(mismatches(vtimezoneResolver(shifted('19700329T030100')), 'Europe/Tallinn', 'Europe/Tallinn', 2026, 2026)).toEqual(['2026-3-29 60: 120 vs 180']);
  });

  it('use the earliest TZOFFSETFROM before every onset, and RDATE onsets', () => {
    const zone = parseICalendar(
      calendar('BEGIN:VTIMEZONE', 'TZID:X', 'BEGIN:STANDARD', 'DTSTART:20200301T020000', 'RDATE:20210301T020000,20220301T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'END:STANDARD', 'BEGIN:DAYLIGHT', 'DTSTART:20201001T020000', 'RDATE:20211001T020000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'END:DAYLIGHT', 'END:VTIMEZONE'),
    ).timeZones[0]!;
    const r = vtimezoneResolver(zone);
    const at = (text: string) => r.offsetMinutesAt('X', L(text));
    expect([at('2019-06-01T00:00'), at('2020-03-01T00:59'), at('2020-03-01T01:00'), at('2020-10-01T00:00'), at('2021-06-01T00:00'), at('2021-12-01T00:00'), at('2022-06-01T00:00'), at('2030-06-01T00:00')]).toEqual([
      60, 60, 120, 60, 120, 60, 120, 120,
    ]);
    expect(() => r.offsetMinutesAt('Y', L('2020-01-01T00:00'))).toThrow(RangeError);
  });

  it('honor UNTIL and COUNT of observance rules', () => {
    const zone = parseICalendar(
      calendar(
        'BEGIN:VTIMEZONE',
        'TZID:Y',
        'BEGIN:DAYLIGHT',
        'DTSTART:20200329T030000',
        'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU;COUNT=2',
        'TZOFFSETFROM:+0200',
        'TZOFFSETTO:+0300',
        'END:DAYLIGHT',
        'BEGIN:STANDARD',
        'DTSTART:20201025T040000',
        'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU;UNTIL=20211031T010000Z',
        'TZOFFSETFROM:+0300',
        'TZOFFSETTO:+0200',
        'END:STANDARD',
        'END:VTIMEZONE',
      ),
    ).timeZones[0]!;
    const r = vtimezoneResolver(zone);
    const at = (text: string) => r.offsetMinutesAt('Y', L(text));
    expect([at('2021-07-01T00:00'), at('2021-11-01T00:00'), at('2022-07-01T00:00'), at('2030-07-01T00:00')]).toEqual([180, 120, 120, 120]);
  });
});

describe('sameTimeZoneDefinition', () => {
  it('compares observances in any order, ignoring names and X- properties', () => {
    const a = parseICalendar(calendar(...TALLINN_VTIMEZONE)).timeZones[0]!;
    const reordered = parseICalendar(calendar('BEGIN:VTIMEZONE', 'TZID:Other', 'X-LIC-LOCATION:x', ...TALLINN_VTIMEZONE.slice(10, 17), ...TALLINN_VTIMEZONE.slice(3, 10), 'END:VTIMEZONE')).timeZones[0]!;
    expect(sameTimeZoneDefinition(a, reordered)).toBe(true);
    const fle = parseICalendar(calendar(...FLE_VTIMEZONE)).timeZones[0]!;
    expect(sameTimeZoneDefinition(a, fle)).toBe(false);
    expect(sameTimeZoneDefinition(a, { ...a, observances: a.observances.slice(1) })).toBe(false);
    expect(sameTimeZoneDefinition(a, { ...a, observances: [a.observances[0]!, { ...a.observances[1]!, rdates: [L('2030-01-01T00:00')] }] })).toBe(false);
  });
});

/** The offsets a generated definition gives every hour of `from`..`to`, against Intl. */
function generatedMismatches(zone: IcsTimeZone, iana: string, from: number, to: number): string[] {
  return mismatches(vtimezoneResolver(zone, 'G'), 'G', iana, from, to);
}

describe('buildVTimeZone', () => {
  it('America/New_York 2005 and 2026: both rule periods, the first with onsets in 2004, the last open-ended (ny-2005-2026.ics)', () => {
    const zone = buildVTimeZone('America/New_York', [2005, 2026], zones);
    expect(serializeTimeZone(zone)).toBe(
      crlf(
        'BEGIN:VTIMEZONE',
        'TZID:America/New_York',
        'X-THIRTEEN-GENERATED:2005-2026',
        'BEGIN:DAYLIGHT',
        'DTSTART:20040404T020000',
        'TZOFFSETFROM:-0500',
        'TZOFFSETTO:-0400',
        'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU;UNTIL=20060402T070000Z',
        'END:DAYLIGHT',
        'BEGIN:STANDARD',
        'DTSTART:20041031T020000',
        'TZOFFSETFROM:-0400',
        'TZOFFSETTO:-0500',
        'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU;UNTIL=20061029T060000Z',
        'END:STANDARD',
        'BEGIN:DAYLIGHT',
        'DTSTART:20070311T020000',
        'TZOFFSETFROM:-0500',
        'TZOFFSETTO:-0400',
        'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
        'END:DAYLIGHT',
        'BEGIN:STANDARD',
        'DTSTART:20071104T020000',
        'TZOFFSETFROM:-0400',
        'TZOFFSETTO:-0500',
        'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
        'END:STANDARD',
        'END:VTIMEZONE',
      ),
    );
    expect(generatedMismatches(zone, 'America/New_York', 2004, 2032)).toEqual([]);
  });

  it('Asia/Jerusalem 2026 and 2029: a period for the years whose Friday is the 4th, not the last (jerusalem.ics)', () => {
    const zone = buildVTimeZone('Asia/Jerusalem', [2026, 2029], zones);
    expect(zone.observances.map((o) => [o.kind, o.start.date.year, o.rrules.map((r) => `${r.byMonth[0]} ${r.byDay[0]!.ordinal}:${r.byDay[0]!.weekday} ${r.until === null ? 'open' : r.until.kind}`)])).toEqual([
      ['daylight', 2025, ['3 -1:5 utc']],
      ['standard', 2025, ['10 -1:0 utc']],
      ['daylight', 2028, ['3 4:5 open']],
      ['standard', 2028, ['10 -1:0 open']],
    ]);
    expect(generatedMismatches(zone, 'Asia/Jerusalem', 2026, 2029)).toEqual([]);
  });

  it('zones without DST start with a STANDARD on January 1 of the year before', () => {
    const tokyo = buildVTimeZone('Asia/Tokyo', [2026], zones);
    expect(tokyo.observances).toEqual([{ kind: 'standard', start: L('2025-01-01T00:00'), offsetFrom: 540, offsetTo: 540, rrules: [], rdates: [], names: [] }]);
    const kathmandu = buildVTimeZone('Asia/Kathmandu', [2026, 2030], zones);
    expect(kathmandu.observances.map((o) => [o.offsetFrom, o.offsetTo])).toEqual([[345, 345]]);
  });

  it('a zone that drops DST ends with its last onset (Europe/Moscow 2010 to 2015)', () => {
    const zone = buildVTimeZone('Europe/Moscow', [2010, 2015], zones);
    expect(generatedMismatches(zone, 'Europe/Moscow', 2010, 2016)).toEqual([]);
    expect(zone.observances.every((o) => o.rrules.every((r) => r.until !== null))).toBe(true);
  });

  it('southern and half-hour zones, Windows ids and single years', () => {
    expect(generatedMismatches(buildVTimeZone('Australia/Sydney', [2026, 2027], zones), 'Australia/Sydney', 2026, 2035)).toEqual([]);
    expect(generatedMismatches(buildVTimeZone('Australia/Lord_Howe', [2026], zones), 'Australia/Lord_Howe', 2026, 2030)).toEqual([]);
    expect(generatedMismatches(buildVTimeZone('America/Sao_Paulo', [2017, 2019], zones), 'America/Sao_Paulo', 2017, 2019)).toEqual([]);
    const fle = buildVTimeZone('FLE Standard Time', [2026], zones);
    expect(fle.tzid).toBe('FLE Standard Time');
    expect(generatedMismatches(fle, 'Europe/Helsinki', 2026, 2030)).toEqual([]);
    expect(buildVTimeZone('Europe/Tallinn', [2027, 2026, 2026], zones).generated).toEqual({ first: 2026, last: 2027 });
  });

  it('rejects bad input', () => {
    expect(() => buildVTimeZone('Nowhere', [2026], zones)).toThrow(RangeError);
    expect(() => buildVTimeZone('Europe/Tallinn', [], zones)).toThrow(RangeError);
    expect(() => buildVTimeZone('Europe/Tallinn', [0], zones)).toThrow(RangeError);
    expect(() => buildVTimeZone('', [2026], zones)).toThrow(RangeError);
  });

  it('is read by ical.js alone: an open-ended New York series (ny-open-ended.ics)', () => {
    const text = calendar(...vevent('UID:weekly', 'DTSTAMP:20260101T000000Z', 'DTSTART;TZID=America/New_York:20260105T090000', 'DTEND;TZID=America/New_York:20260105T100000', 'RRULE:FREQ=WEEKLY'));
    const exported = serializeICalendar(parseICalendar(text), zones, { now: '2026-10-19T00:00' });
    ICAL.TimezoneService.reset();
    const root = new ICAL.Component(ICAL.parse(exported));
    expect(ICAL.TimezoneService.has('America/New_York')).toBe(false);
    for (const vtz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(new ICAL.Timezone(vtz));
    const event = new ICAL.Event(root.getFirstSubcomponent('vevent')!);
    const iterator = event.iterator();
    const hours: Record<string, number> = {};
    for (let next = iterator.next(); next && next.year <= 2031; next = iterator.next()) {
      const key = `${next.year}-${String(next.month).padStart(2, '0')}-${String(next.day).padStart(2, '0')}`;
      hours[key] = next.toJSDate().getUTCHours();
    }
    ICAL.TimezoneService.reset();
    expect(hours['2026-01-05']).toBe(14);
    expect(hours['2030-07-01']).toBe(13);
    expect(hours['2031-01-06']).toBe(14);
  });

  it('is read by ical.js alone: January 10, 2005 at UTC-5 (ny-2005-2026.ics)', () => {
    const text = calendar(...vevent('UID:old', 'DTSTAMP:20260101T000000Z', 'DTSTART;TZID=America/New_York:20050110T090000'), ...vevent('UID:new', 'DTSTAMP:20260101T000000Z', 'DTSTART;TZID=America/New_York:20260705T090000'));
    const exported = serializeICalendar(parseICalendar(text), zones);
    ICAL.TimezoneService.reset();
    const root = new ICAL.Component(ICAL.parse(exported));
    for (const vtz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(new ICAL.Timezone(vtz));
    const starts = root.getAllSubcomponents('vevent').map((c) => new ICAL.Event(c).startDate.toJSDate().toISOString());
    ICAL.TimezoneService.reset();
    expect(starts).toEqual(['2005-01-10T14:00:00.000Z', '2026-07-05T13:00:00.000Z']);
  });

  it('samples daily: a definition for years 1 to 3 starts in year 1', () => {
    const zone = buildVTimeZone('Europe/Tallinn', [1, 3], zones);
    expect(zone.observances[0]!.start.date.year).toBe(1);
    expect(DAY).toBe(1440);
  });
});
