/**
 * `ical.js` 2.2 as an oracle for `eventsFromCalendar` (docs/EVENTS.md §5.5,
 * §6.1 C7 and C8: "`ical.js` agrees on every `fixtures/ics` case's
 * occurrences").
 *
 * Every calendar below is expanded by both engines for 2026 and 2027, and
 * every `fixtures/ics/cases/*.ics` in every window of its `expected/` file,
 * and compared occurrence by occurrence (UID, start and end instant).
 * `ical.js` reads only the text's own `VTIMEZONE`s (its registry is cleared):
 * for a fixture case it reads the case's round trip, which is the input plus a
 * generated `VTIMEZONE` for every known zone the input uses without defining
 * it, as Thirteen exports it. Our side reads the input on the device zone UTC,
 * where the wall clock is the instant.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eventsFromCalendar, parseICalendar, serializeICalendar } from '../../src/ics/index.ts';
import { uuid } from '../../scripts/ics-texts.ts';
import { FLE_VTIMEZONE, L, TALLINN_VTIMEZONE, W, calendar, icalOccurrences, utcMs, vevent, zones } from './helpers.ts';

const FROM = Date.UTC(2026, 0, 1);
const TO = Date.UTC(2028, 0, 1);

/** Our occurrences as the oracle reports them, in a window of the UTC wall clock (default 2026 and 2027). */
function ours(text: string, window = { from: '2026-01-01T00:00', to: '2027-12-31T24:00' }, calendarId?: string): { uid: string; start: number; end: number }[] {
  const cal = parseICalendar(text, calendarId === undefined ? undefined : { calendarId });
  const from = utcMs(L(window.from));
  const to = utcMs(L(window.to));
  return eventsFromCalendar(cal, 'UTC', zones, W(window.from, window.to))
    .map((e) => ({ uid: e.component.uidDerived ? 'missing' : e.uid, start: utcMs(e.start), end: utcMs(e.end) }))
    .filter((o) => o.start >= from && o.start < to)
    .sort((a, b) => a.start - b.start || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0) || a.end - b.end);
}

/** A text with generated VTIMEZONEs for every zone it uses (as Thirteen exports it), so `ical.js` knows the zones. */
const exported = (text: string) => serializeICalendar(parseICalendar(text), zones, { now: '2026-10-19T00:00' });

const CASES: Readonly<Record<string, string>> = {
  'Google weekly with UNTIL, EXDATE, a moved and a canceled override': calendar(
    ...TALLINN_VTIMEZONE,
    ...vevent(
      'UID:choir@google.com',
      'DTSTART;TZID=Europe/Tallinn:20261019T190000',
      'DTEND;TZID=Europe/Tallinn:20261019T200000',
      'RRULE:FREQ=WEEKLY;UNTIL=20270315T165959Z;BYDAY=MO',
      'EXDATE;TZID=Europe/Tallinn:20261026T190000',
    ),
    ...vevent('UID:choir@google.com', 'RECURRENCE-ID;TZID=Europe/Tallinn:20261102T190000', 'DTSTART;TZID=Europe/Tallinn:20261103T200000', 'DTEND;TZID=Europe/Tallinn:20261103T213000'),
    ...vevent('UID:choir@google.com', 'RECURRENCE-ID:20261109T170000Z', 'DTSTART;TZID=Europe/Tallinn:20261109T190000', 'STATUS:CANCELLED'),
  ),
  'Outlook with Windows zone ids': calendar(
    ...FLE_VTIMEZONE,
    ...vevent('UID:o1', 'DTSTART;TZID=FLE Standard Time:20260302T083000', 'DTEND;TZID=FLE Standard Time:20260302T093000', 'RRULE:FREQ=WEEKLY;COUNT=40;INTERVAL=1;BYDAY=MO,WE;WKST=MO'),
    ...vevent('UID:o2', 'DTSTART;TZID=FLE Standard Time:20261025T050000', 'DTEND;TZID=FLE Standard Time:20261025T060000'),
  ),
  'New York monthly on the second Tuesday across DST changes': exported(
    calendar(...vevent('UID:ny', 'DTSTART;TZID=America/New_York:20260113T183000', 'DTEND;TZID=America/New_York:20260113T200000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU')),
  ),
  'All-day yearly with an RDATE and an EXDATE': calendar(
    ...vevent('UID:bday', 'DTSTART;VALUE=DATE:20200229', 'DTEND;VALUE=DATE:20200301', 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1', 'RDATE;VALUE=DATE:20260704', 'EXDATE;VALUE=DATE:20270228'),
  ),
  'Floating every other day': calendar(...vevent('UID:float', 'DTSTART:20260601T070000', 'DTEND:20260601T073000', 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5')),
  'UTC monthly on the last day': calendar(...vevent('UID:utc', 'DTSTART:20260131T120000Z', 'DURATION:PT45M', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=14')),
  'Weekly with WKST (RFC 5545 example)': calendar(...vevent('UID:wkst', 'DTSTART:20260804T090000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU')),
  'A Kiritimati event across January 1': exported(calendar(...vevent('UID:kiri', 'DTSTART;TZID=Pacific/Kiritimati:20270101T010000', 'DTEND;TZID=Pacific/Kiritimati:20270101T020000'))),
  'A 13-month BYYEARDAY series with its marker': calendar(
    ...vevent('UID:t13', 'DTSTART;VALUE=DATE:20261116', 'RRULE:FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18', 'X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=monthly;DAY=12'),
  ),
  'An all-day event over several days and a single timed event': exported(
    calendar(
      ...vevent('UID:trip', 'DTSTART;VALUE=DATE:20261228', 'DTEND;VALUE=DATE:20270104'),
      ...vevent('UID:once', 'DTSTART;TZID=Asia/Kathmandu:20270315T094500', 'DTEND;TZID=Asia/Kathmandu:20270315T101500'),
    ),
  ),
};

describe('ical.js agrees with eventsFromCalendar', () => {
  it.each(Object.entries(CASES))('%s', (_, text) => {
    const theirs = icalOccurrences(text, FROM, TO);
    expect(theirs.length).toBeGreaterThan(0);
    expect(ours(text)).toEqual(theirs);
  });

  it('the helpers agree on what a window holds', () => {
    expect(utcMs(L('2026-01-01T00:00'))).toBe(FROM);
  });
});

/**
 * Where `ical.js` 2.2.1 does not follow §3.3 (RFC 5545 §3.3.5): inside a DST
 * gap it uses the offset after the gap (New York 02:30 on March 8, 2026
 * becomes 06:30Z, which is 01:30 local), and for an ambiguous time it takes
 * the later instant. Every other occurrence agrees; ours are pinned here.
 */
describe('where ical.js does not follow the gap and overlap rule of §3.3', () => {
  const at = (iso: string) => Date.parse(iso);

  it('a daily New York series at 02:30 across the spring-forward night: 07:30Z on March 8', () => {
    const text = exported(calendar(...vevent('UID:gap', 'DTSTART;TZID=America/New_York:20260305T023000', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;COUNT=6')));
    const mine = ours(text);
    const theirs = icalOccurrences(text, FROM, TO);
    const gapDay = (o: { start: number }) => o.start >= at('2026-03-08T00:00:00Z') && o.start < at('2026-03-09T00:00:00Z');
    expect(mine.filter((o) => !gapDay(o))).toEqual(theirs.filter((o) => !gapDay(o)));
    expect(mine.filter(gapDay)).toEqual([{ uid: 'gap', start: at('2026-03-08T07:30:00Z'), end: at('2026-03-08T08:30:00Z') }]);
    expect(theirs.filter(gapDay)).toEqual([{ uid: 'gap', start: at('2026-03-08T06:30:00Z'), end: at('2026-03-08T07:30:00Z') }]);
  });

  it('an Outlook event at 03:00 on the fall-back night in FLE Standard Time: the earlier instant', () => {
    const text = calendar(...FLE_VTIMEZONE, ...vevent('UID:overlap', 'DTSTART;TZID=FLE Standard Time:20261025T030000', 'DTEND;TZID=FLE Standard Time:20261025T050000'));
    expect(ours(text)).toEqual([{ uid: 'overlap', start: at('2026-10-25T00:00:00Z'), end: at('2026-10-25T03:00:00Z') }]);
    expect(icalOccurrences(text, FROM, TO)).toEqual([{ uid: 'overlap', start: at('2026-10-25T01:00:00Z'), end: at('2026-10-25T03:00:00Z') }]);
  });
});

/**
 * Where `ical.js` 2.2.1 does not implement RFC 5545 or §4.6 and §5.4 on a
 * `fixtures/ics` case: per file, the UIDs left out of the comparison (`*`: the
 * whole file) with the reason. The engine's own expectations for them are
 * pinned in `fixtures/ics/expected`. A listed UID must still differ, so the
 * list cannot go stale.
 */
const WALL_CLOCK_DURATION = 'ical.js 2.2.1 adds the hours and minutes of DURATION on the wall clock; RFC 5545 §3.3.6 and §5.4 add them exactly, so across a DST change the end differs by the change';
const FIXTURE_DEVIATIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'broken.ics': { '*': 'ical.js 2.2.1 refuses the whole text at its first line without a colon; the reader of §5.4 skips that line with a bad-line warning and reads on' },
  'duplicate-uid.ics': {
    'dup@example.com': 'ical.js 2.2.1 keeps one override per RECURRENCE-ID (the last in the file, here the exact copy of the first); §3.2 and §5.4 collapse the exact copy and show the second, different override of that RECURRENCE-ID on its own with a #2 key',
  },
  'duration.ics': {
    [uuid('duration pt24h')]: WALL_CLOCK_DURATION,
    [uuid('duration fall back')]: WALL_CLOCK_DURATION,
    [uuid('duration daily')]: WALL_CLOCK_DURATION,
  },
  'far-future.ics': {
    [uuid('far future dtend')]: 'ical.js 2.2.1 reads DTEND;VALUE=DATE:10000101 as January 1, 1000; §3.1.1 and §5.4 read it as the end of 9999-12-31',
  },
  'fastmail.ics': { [uuid('fastmail flight')]: WALL_CLOCK_DURATION },
  'rscale.ics': {
    [uuid('rscale hebrew')]: 'ical.js 2.2.1 ignores RSCALE=HEBREW and expands the rule as a Gregorian one; §4.6 step 6 shows only the start of a rule in another calendar',
    [uuid('rscale skip')]: 'ical.js 2.2.1 ignores RSCALE and SKIP=FORWARD; §4.6 step 6 shows only the start of a rule with SKIP',
  },
};

const ICS_DIR = new URL('../../../../fixtures/ics/', import.meta.url);
const fixtureCases = existsSync(new URL('cases/', ICS_DIR)) ? readdirSync(new URL('cases/', ICS_DIR)).filter((f) => f.endsWith('.ics')).sort() : [];

/** The windows of a case's expected occurrences (device wall clock, read here as UTC). */
function caseWindows(file: string): { from: string; to: string }[] {
  const expected = JSON.parse(readFileSync(new URL(`expected/${file.replace(/\.ics$/, '.json')}`, ICS_DIR), 'utf8')) as { expansions: { window: { from: string; to: string } }[] };
  return [...new Map(expected.expansions.map((e) => [`${e.window.from} ${e.window.to}`, e.window] as const)).values()];
}

describe.skipIf(fixtureCases.length === 0)('ical.js agrees on every fixtures/ics case', () => {
  it.each(fixtureCases)('%s', (file) => {
    const input = readFileSync(new URL(`cases/${file}`, ICS_DIR), 'utf8');
    const exported = readFileSync(new URL(`roundtrip/${file}`, ICS_DIR), 'utf8');
    const deviations = FIXTURE_DEVIATIONS[file] ?? {};
    if ('*' in deviations) {
      expect(() => icalOccurrences(exported, FROM, TO)).toThrow();
      return;
    }
    const calendarId = file.replace(/\.ics$/, '');
    const differs = new Set<string>();
    for (const window of caseWindows(file)) {
      const mine = ours(input, window, calendarId);
      const theirs = icalOccurrences(exported, utcMs(L(window.from)), utcMs(L(window.to)));
      const compared = (o: { uid: string }) => !(o.uid in deviations);
      expect(mine.filter(compared), `${file} from ${window.from}`).toEqual(theirs.filter(compared));
      for (const uid of Object.keys(deviations)) {
        const pick = (list: { uid: string }[]) => JSON.stringify(list.filter((o) => o.uid === uid));
        if (pick(mine) !== pick(theirs)) differs.add(uid);
      }
    }
    expect(Object.keys(deviations).filter((uid) => !differs.has(uid)), `${file}: listed UIDs that agree`).toEqual([]);
  });
});
