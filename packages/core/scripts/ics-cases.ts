/**
 * The inputs of the `.ics` conformance set (`fixtures/ics/cases`, docs/EVENTS.md
 * §5.6, task C8): one entry per case, with what it tests and where it came
 * from (the README is generated from these entries), the device zones and
 * windows its expected occurrences are given for, and its text.
 *
 * Most inputs are anonymized copies of what other apps write (Google, Apple,
 * Microsoft, Fastmail, Thunderbird), kept here as content lines so their bytes
 * (line ends, folds, a byte order mark) are exact and no editor or checkout
 * can change them unnoticed. Inputs "as Thirteen exports them" are built with
 * the engine itself ({@link thirteenDocument}) and so depend on zone data:
 * they are generated through the same recording resolver as every other
 * expectation (§5.5 "Recorded zone offsets").
 * @module
 */

import { type GregorianDate, addGregorianDays, gregorianWeekday, parseISODate, toISODate } from '../src/index.ts';
import { type EventRecurrence, type RepeatEnd, type ZoneResolver, parseLocalDateTime } from '../src/events/index.ts';
import { recurrenceToRRule } from '../src/events/recurrence.ts';
import { type RRule, parseRRule } from '../src/events/rrule.ts';
import { type ThirteenRuleKind, formatThirteenRuleText, thirteenRuleFor } from '../src/events/thirteen-rules.ts';
import {
  type IcsAlarm,
  type IcsCalendar,
  type IcsDateValue,
  type IcsEvent,
  allDayEnd,
  newICalendar,
  replaceGroup,
  serializeICalendar,
  untilFor,
} from '../src/ics/index.ts';
import type { CalendarSystemId } from '../src/systems/index.ts';
import {
  APPLE_TALLINN,
  FASTMAIL_MELBOURNE,
  GOOGLE_TALLINN,
  OUTLOOK_FLE,
  THUNDERBIRD_NEW_YORK,
  appleUid,
  crlf,
  customizedTimeZone,
  fold,
  googleId,
  outlookUid,
  uuid,
  vcalendar,
  vevent,
} from './ics-texts.ts';

/** "Now" of every serialization in the set, in UTC: Monday, October 19, 2026, 09:41 in Tallinn (§6.7). */
export const ICS_NOW = '2026-10-19T06:41';

/** The device zones every case is expanded in (§5.6). */
export const DEVICE_ZONES = ['Europe/Tallinn', 'America/New_York'] as const;

/** A device window `[from, to)` as wall-clock text. */
export interface WindowSpec {
  readonly from: string;
  readonly to: string;
}

/** The default window of expected occurrences: 2026-01-01 to 2027-12-31 (§5.6). */
export const DEFAULT_WINDOW: WindowSpec = { from: '2026-01-01T00:00', to: '2027-12-31T24:00' };

/** How the round trip (`serializeICalendar(parseICalendar(input))`) relates to the input. */
export type RoundTrip =
  /** Equal to the input with CRLF line ends and without a byte order mark. */
  | 'as-read'
  /** As read, plus a generated `VTIMEZONE` for each zone the input uses without defining it. */
  | 'zones-added';

export interface IcsCase {
  /** File name in `cases/`. */
  readonly file: string;
  /** README: what the case tests. */
  readonly tests: string;
  /** README: where the input came from. */
  readonly source: string;
  /** Device zones and windows of the expected occurrences; default: both device zones over {@link DEFAULT_WINDOW}. */
  readonly expansions?: readonly { readonly deviceZone: string; readonly window: WindowSpec }[];
  /** Further windows in both device zones, after the default one. */
  readonly extraWindows?: readonly WindowSpec[];
  readonly roundTrip: RoundTrip;
  readonly text: (zones: ZoneResolver) => string;
}

// ---------------------------------------------------------------------------
// Thirteen's own documents (§3.6)
// ---------------------------------------------------------------------------

const utc = (text: string): IcsDateValue => ({ kind: 'utc', value: parseLocalDateTime(text) });
const date = (text: string): IcsDateValue => ({ kind: 'date', date: parseISODate(text) });
const zoned = (text: string, tzid: string): IcsDateValue => ({ kind: 'zoned', value: parseLocalDateTime(text), tzid });

/** An event as Thirteen creates it (§3.6): what the editor fills in. */
export interface ThirteenEventSpec {
  readonly uid: string;
  readonly summary: string;
  readonly location?: string;
  readonly description?: string;
  /** `YYYY-MM-DD` (all-day) or `YYYY-MM-DDTHH:MM` in `zone`. */
  readonly start: string;
  /** The last day of an all-day event (default: the start), or the timed end in `zone`. */
  readonly end?: string;
  readonly zone?: string;
  readonly recurrence?: EventRecurrence;
  /** Excluded occurrences: dates for all-day events, wall clocks in `zone` for timed ones. */
  readonly exdates?: readonly string[];
  readonly alarms?: readonly IcsAlarm[];
  /** `CREATED` and `LAST-MODIFIED` (UTC), default {@link ICS_NOW}. */
  readonly modified?: string;
  readonly sequence?: number;
}

/** A `VALARM` as Thirteen writes it: a display alert relative to the start. */
export const displayAlarm = (minutes: number, description: string): IcsAlarm => ({
  action: 'DISPLAY',
  trigger: { kind: 'relative', minutes, related: 'start' },
  extra: [{ name: 'DESCRIPTION', params: [], value: description.replaceAll('\\', '\\\\').replaceAll(',', '\\,').replaceAll(';', '\\;') }],
});

/**
 * An event as Thirteen writes it (§3.6, §4.3, §4.4): its repeat as one
 * `RRULE` (`recurrenceToRRule`: a Gregorian rule, or a 13-month rule's
 * encoding with its `X-THIRTEEN-RULE` marker), a timed series' end date as the
 * UTC end of that day in its zone (`untilFor`), all-day ends per §3.1.1.
 */
export function thirteenEvent(spec: ThirteenEventSpec, calendar: IcsCalendar, zones: ZoneResolver): IcsEvent {
  const allDay = spec.zone === undefined;
  const start = allDay ? date(spec.start) : zoned(spec.start, spec.zone!);
  const startDate = parseISODate(spec.start.slice(0, 10));
  let end: IcsDateValue | null;
  let duration: string | null = null;
  if (allDay) {
    ({ end, duration } = allDayEnd(startDate, parseISODate(spec.end ?? spec.start)));
  } else {
    end = zoned(spec.end ?? spec.start, spec.zone!);
  }
  const modified = utc(spec.modified ?? ICS_NOW);
  const base: IcsEvent = {
    uid: spec.uid,
    uidDerived: false,
    recurrenceId: null,
    sequence: spec.sequence ?? 0,
    summary: spec.summary,
    location: spec.location ?? '',
    description: spec.description ?? '',
    url: '',
    start,
    end,
    duration,
    rrules: [],
    exrules: [],
    rdates: [],
    exdates: (spec.exdates ?? []).map((x) => (allDay ? date(x) : zoned(x, spec.zone!))),
    status: 'CONFIRMED',
    transp: allDay ? 'TRANSPARENT' : 'OPAQUE',
    thirteenRule: null,
    alarms: [...(spec.alarms ?? [])],
    created: modified,
    lastModified: modified,
    dtstamp: modified,
    importedLastModified: null,
    extra: [],
    raw: null,
    original: null,
    line: null,
  };
  if (spec.recurrence === undefined) return base;
  let rule = recurrenceToRRule(spec.recurrence, startDate)!;
  if (!allDay && rule.until !== null && rule.until.kind === 'date') rule = { ...rule, until: untilFor(rule.until.date, base, calendar, zones) };
  const marker = spec.recurrence.rule.kind === 'thirteen' ? formatThirteenRuleText(spec.recurrence.rule.rule) : null;
  return { ...base, rrules: [rule], thirteenRule: marker };
}

/** A Thirteen calendar document (§3.6) holding `events`, as Thirteen exports it at {@link ICS_NOW}. */
export function thirteenDocument(
  calendar: { readonly calendarId: string; readonly name: string; readonly color: string },
  events: readonly ThirteenEventSpec[],
  zones: ZoneResolver,
): string {
  let doc = newICalendar(calendar);
  for (const spec of events) doc = replaceGroup(doc, { uid: spec.uid, master: thirteenEvent(spec, doc, zones), overrides: [] });
  return serializeICalendar(doc, zones, { now: ICS_NOW });
}

/** A repeat with `rule` (a Gregorian `RRULE` text or a 13-month rule) and an end. */
export function repeat(rule: string | { kind: ThirteenRuleKind; system: CalendarSystemId; start: string }, end: RepeatEnd = { kind: 'never' }): EventRecurrence {
  if (typeof rule === 'string') {
    return { rule: { kind: 'rrule', rrule: parseRRuleText(rule) }, end, extraDates: [], exceptDates: [] };
  }
  const thirteen = thirteenRuleFor(rule.kind, parseISODate(rule.start), rule.system);
  if (thirteen === null) throw new RangeError(`No ${rule.kind} rule starts on ${rule.start}`);
  return { rule: { kind: 'thirteen', rule: thirteen }, end, extraDates: [], exceptDates: [] };
}

const parseRRuleText = (text: string): RRule => parseRRule(text);

const count = (n: number): RepeatEnd => ({ kind: 'count', count: n });
const until = (day: string): RepeatEnd => ({ kind: 'until', date: parseISODate(day) });

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

const GOOGLE_PRODID = 'PRODID:-//Google Inc//Google Calendar 70.9054//EN';

const nthWeekday = (year: number, month: number, weekday: number, n: number): GregorianDate => {
  if (n > 0) {
    const first = gregorianWeekday({ year, month, day: 1 });
    return { year, month, day: 1 + ((weekday - first + 7) % 7) + 7 * (n - 1) };
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = gregorianWeekday({ year, month, day: lastDay });
  return { year, month, day: lastDay - ((last - weekday + 7) % 7) };
};

/** United States holidays of a year as Google's public feed lists them (federal holidays, observed days, two observances). */
function usHolidays(year: number): { date: GregorianDate; name: string; observance: boolean }[] {
  const out: { date: GregorianDate; name: string; observance: boolean }[] = [];
  const fixed = (month: number, day: number, name: string) => {
    const d = { year, month, day };
    out.push({ date: d, name, observance: false });
    const weekday = gregorianWeekday(d);
    if (weekday === 6) out.push({ date: addGregorianDays(d, -1), name: `${name} (observed)`, observance: false });
    if (weekday === 0) out.push({ date: addGregorianDays(d, 1), name: `${name} (observed)`, observance: false });
  };
  fixed(1, 1, "New Year's Day");
  out.push({ date: nthWeekday(year, 1, 1, 3), name: 'Martin Luther King Jr. Day', observance: false });
  out.push({ date: nthWeekday(year, 5, 1, -1), name: 'Memorial Day', observance: false });
  fixed(6, 19, 'Juneteenth');
  fixed(7, 4, 'Independence Day');
  out.push({ date: nthWeekday(year, 9, 1, 1), name: 'Labor Day', observance: false });
  out.push({ date: { year, month: 10, day: 31 }, name: 'Halloween', observance: true });
  out.push({ date: nthWeekday(year, 11, 4, 4), name: 'Thanksgiving Day', observance: false });
  out.push({ date: { year, month: 12, day: 24 }, name: 'Christmas Eve', observance: true });
  fixed(12, 25, 'Christmas Day');
  return out;
}

const compact = (d: GregorianDate) => toISODate(d).replaceAll('-', '');

function googleHolidays(): string {
  const events: string[][] = [];
  const all = [2021, 2022, 2023, 2024, 2025, 2026, 2027].flatMap(usHolidays);
  // Google lists each holiday's years together, the holidays in the order they were added to the feed.
  const names = [...new Set(all.map((h) => h.name.replace(' (observed)', '')))];
  for (const name of names) {
    for (const h of all.filter((x) => x.name.replace(' (observed)', '') === name)) {
      const day = compact(h.date);
      events.push(
        vevent(
          `DTSTART;VALUE=DATE:${day}`,
          `DTEND;VALUE=DATE:${compact(addGregorianDays(h.date, 1))}`,
          'DTSTAMP:20261015T061811Z',
          `UID:${day}_${googleId(`${h.name} ${day}`)}@google.com`,
          'CLASS:PUBLIC',
          'CREATED:20250923T190415Z',
          h.observance ? 'DESCRIPTION:Observance\\nTo hide observances\\, go to Google Calendar Settings > Holidays in United States' : 'DESCRIPTION:Public holiday',
          'LAST-MODIFIED:20250923T190415Z',
          'SEQUENCE:0',
          'STATUS:CONFIRMED',
          `SUMMARY:${h.name}`,
          'TRANSP:TRANSPARENT',
        ),
      );
    }
  }
  return crlf(
    vcalendar(
      [GOOGLE_PRODID, 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Holidays in United States', 'X-WR-TIMEZONE:UTC', 'X-WR-CALDESC:Holidays and Observances in United States'],
      ...events,
    ),
  );
}

/** The UID of the weekly choir series in Liis's Google calendar (google-secret.ics, override-only.ics). */
export const CHOIR_UID = `${googleId('choir')}@google.com`;

const LIIS = 'ORGANIZER;CN=Liis Kask:mailto:liis.kask@example.com';
const LIIS_ATTENDEE = fold('ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Liis Kask;X-NUM-GUESTS=0:mailto:liis.kask@example.com');
const CHOIR_LOCATION = 'LOCATION:Kaarli kirik\\, Toompuiestee 4\\, Tallinn';
const CHOIR_DESCRIPTION = 'DESCRIPTION:Bring the Arvo Pärt scores.\\nParking behind the church.';

/** Liis's Google calendar export at a given version (`google-secret.ics` is version 1; the baseline imports use 0 and 2). */
export function googleSecret(version: 0 | 1 | 2 = 1): string {
  const stamp = ['20261005T064100Z', '20261019T064100Z', '20261024T080000Z'][version]!;
  const modified = ['20261004T090000Z', '20261012T090000Z', '20261023T171500Z'][version]!;
  const title = ['Choir practice', 'Choir rehearsal', 'Choir rehearsal: Christmas program'][version]!;
  return crlf(
    vcalendar(
      [GOOGLE_PRODID, 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Liis Kask', 'X-WR-TIMEZONE:Europe/Tallinn'],
      GOOGLE_TALLINN,
      vevent(
        'DTSTART;TZID=Europe/Tallinn:20261019T190000',
        'DTEND;TZID=Europe/Tallinn:20261019T203000',
        'RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20270315T215959Z;BYDAY=MO',
        'EXDATE;TZID=Europe/Tallinn:20261228T190000',
        `DTSTAMP:${stamp}`,
        LIIS,
        `UID:${CHOIR_UID}`,
        ...LIIS_ATTENDEE,
        'CREATED:20261001T080000Z',
        CHOIR_DESCRIPTION,
        `LAST-MODIFIED:${modified}`,
        CHOIR_LOCATION,
        `SEQUENCE:${version + 1}`,
        'STATUS:CONFIRMED',
        `SUMMARY:${title}`,
        'TRANSP:OPAQUE',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:This is an event reminder',
        'TRIGGER:-P0DT0H30M0S',
        'END:VALARM',
      ),
      ...(version === 0
        ? []
        : [
            vevent(
              'DTSTART;TZID=Europe/Tallinn:20261103T200000',
              'DTEND;TZID=Europe/Tallinn:20261103T213000',
              `DTSTAMP:${stamp}`,
              LIIS,
              `UID:${CHOIR_UID}`,
              'RECURRENCE-ID;TZID=Europe/Tallinn:20261102T190000',
              'CREATED:20261001T080000Z',
              CHOIR_DESCRIPTION,
              'LAST-MODIFIED:20261012T090500Z',
              CHOIR_LOCATION,
              'SEQUENCE:2',
              'STATUS:CONFIRMED',
              `SUMMARY:${title} (moved to Tuesday)`,
              'TRANSP:OPAQUE',
            ),
            vevent(
              'DTSTART;TZID=Europe/Tallinn:20261116T190000',
              'DTEND;TZID=Europe/Tallinn:20261116T203000',
              `DTSTAMP:${stamp}`,
              `UID:${CHOIR_UID}`,
              'RECURRENCE-ID;TZID=Europe/Tallinn:20261116T190000',
              'CREATED:20261001T080000Z',
              'LAST-MODIFIED:20261012T091000Z',
              'SEQUENCE:2',
              'STATUS:CANCELLED',
              `SUMMARY:${title}`,
              'TRANSP:OPAQUE',
            ),
          ]),
      vevent(
        'DTSTART:20261021T070000Z',
        'DTEND:20261021T080000Z',
        `DTSTAMP:${stamp}`,
        `UID:${googleId('dentist')}@google.com`,
        'CREATED:20261005T120000Z',
        'DESCRIPTION:',
        'LAST-MODIFIED:20261005T120000Z',
        'LOCATION:Hambakliinik\\, Tartu mnt 1\\, Tallinn',
        'SEQUENCE:0',
        'STATUS:CONFIRMED',
        'SUMMARY:Dentist',
        'TRANSP:OPAQUE',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:This is an event reminder',
        'TRIGGER:-P1DT0H0M0S',
        'END:VALARM',
      ),
      vevent(
        'DTSTART;VALUE=DATE:20261030',
        'DTEND;VALUE=DATE:20261102',
        `DTSTAMP:${stamp}`,
        `UID:${googleId('tartu')}@google.com`,
        'CREATED:20261008T183000Z',
        'DESCRIPTION:',
        'LAST-MODIFIED:20261008T183000Z',
        'LOCATION:Tartu',
        'SEQUENCE:0',
        'STATUS:CONFIRMED',
        'SUMMARY:Weekend in Tartu',
        'TRANSP:TRANSPARENT',
      ),
    ),
  );
}

/** One instance of the choir series, as someone else's Google calendar exports it (an invited instance without its master). */
export function overrideOnly(version: 0 | 1 | 2 = 1): string {
  const stamp = ['20261006T064500Z', '20261019T064500Z', '20261021T064500Z'][version]!;
  const modified = ['20261005T100000Z', '20261014T100000Z', '20261020T120000Z'][version]!;
  const start = ['183000', '183000', '180000'][version]!;
  return crlf(
    vcalendar(
      [GOOGLE_PRODID, 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Mart Tamm', 'X-WR-TIMEZONE:Europe/Tallinn'],
      GOOGLE_TALLINN,
      vevent(
        `DTSTART;TZID=Europe/Tallinn:20261109T${start}`,
        'DTEND;TZID=Europe/Tallinn:20261109T203000',
        `DTSTAMP:${stamp}`,
        LIIS,
        `UID:${CHOIR_UID}`,
        'RECURRENCE-ID;TZID=Europe/Tallinn:20261109T190000',
        ...fold('ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Mart Tamm;X-NUM-GUESTS=0:mailto:mart.tamm@example.com'),
        'CREATED:20261001T080000Z',
        `LAST-MODIFIED:${modified}`,
        CHOIR_LOCATION,
        `SEQUENCE:${version + 2}`,
        'STATUS:CONFIRMED',
        `SUMMARY:${['Choir rehearsal: concert run', 'Choir rehearsal: concert run-through', 'Choir rehearsal: dress rehearsal'][version]}`,
        'TRANSP:OPAQUE',
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Apple
// ---------------------------------------------------------------------------

function icloudExport(): string {
  const book = appleUid('icloud book club');
  const swim = appleUid('icloud swimming');
  const midsummer = appleUid('icloud midsummer');
  const alarm = (seed: string, trigger: string) => [
    'BEGIN:VALARM',
    `X-WR-ALARMUID:${appleUid(seed)}`,
    `UID:${appleUid(seed)}`,
    trigger,
    'ATTACH;VALUE=URI:Chord',
    'ACTION:AUDIO',
    'X-APPLE-DEFAULT-ALARM:FALSE',
    'END:VALARM',
  ];
  return crlf(
    vcalendar(
      ['METHOD:PUBLISH', 'VERSION:2.0', 'X-WR-CALNAME:Home', 'PRODID:-//Apple Inc.//macOS 15.6//EN', 'X-APPLE-CALENDAR-COLOR:#FF9500', 'X-WR-TIMEZONE:Europe/Tallinn', 'CALSCALE:GREGORIAN'],
      APPLE_TALLINN,
      vevent(
        'TRANSP:OPAQUE',
        'DTEND;TZID=Europe/Tallinn:20250911T193000',
        `UID:${book}`,
        'DTSTAMP:20261018T153012Z',
        'LOCATION:Raamatukoi\\nHarju 1\\, 10146 Tallinn\\, Estonia',
        'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
        'URL;VALUE=URI:https://example.com/bookclub',
        'SEQUENCE:0',
        ...fold('X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="Harju 1, 10146 Tallinn, Estonia";X-APPLE-MAPKIT-HANDLE=;X-APPLE-RADIUS=70.58;X-TITLE=Raamatukoi:geo:59.436962,24.745311'),
        'SUMMARY:Book club',
        'LAST-MODIFIED:20250901T090000Z',
        'CREATED:20250901T085512Z',
        'DTSTART;TZID=Europe/Tallinn:20250911T180000',
        'RRULE:FREQ=MONTHLY;BYDAY=2TH',
        ...alarm('icloud book club alarm', 'TRIGGER:-PT1H'),
      ),
      vevent(
        'TRANSP:OPAQUE',
        'DTEND;TZID=Europe/Tallinn:20260901T080000',
        `UID:${swim}`,
        'DTSTAMP:20261018T153012Z',
        'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
        'SEQUENCE:0',
        'SUMMARY:Swimming',
        'LAST-MODIFIED:20261002T061500Z',
        'CREATED:20260828T171200Z',
        'DTSTART;TZID=Europe/Tallinn:20260901T070000',
        'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU,TH',
        'EXDATE;TZID=Europe/Tallinn:20261229T070000,20261231T070000',
        ...alarm('icloud swimming alarm', 'TRIGGER:-PT30M'),
      ),
      vevent(
        'TRANSP:OPAQUE',
        'DTEND;TZID=Europe/Tallinn:20261022T090000',
        `UID:${swim}`,
        'DTSTAMP:20261018T153012Z',
        'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
        'SEQUENCE:0',
        'RECURRENCE-ID;TZID=Europe/Tallinn:20261022T070000',
        'SUMMARY:Swimming (late lane)',
        'LAST-MODIFIED:20261018T153000Z',
        'CREATED:20260828T171200Z',
        'DTSTART;TZID=Europe/Tallinn:20261022T080000',
      ),
      vevent(
        'TRANSP:TRANSPARENT',
        'DTEND;VALUE=DATE:20260626',
        `UID:${midsummer}`,
        'DTSTAMP:20261018T153012Z',
        'SEQUENCE:0',
        'X-APPLE-EWS-BUSYSTATUS:FREE',
        'SUMMARY:Midsummer at the cottage',
        'LAST-MODIFIED:20260512T190000Z',
        'CREATED:20260512T190000Z',
        'DTSTART;VALUE=DATE:20260623',
        'BEGIN:VALARM',
        `X-WR-ALARMUID:${appleUid('icloud midsummer alarm')}`,
        `UID:${appleUid('icloud midsummer alarm')}`,
        'TRIGGER;VALUE=DATE-TIME:19760401T005545Z',
        'ACTION:NONE',
        'END:VALARM',
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Microsoft
// ---------------------------------------------------------------------------

/** The UIDs of outlook-publish.ics (edits/outlook-edit-one.json, edits/retime-until.json). */
export const OUTLOOK_CHOIR_UID = outlookUid('outlook choir');
export const OUTLOOK_BUDGET_UID = outlookUid('outlook budget review');

const outlookTail = (busy: string, allDay: boolean, instType: number) => [
  'X-MICROSOFT-CDO-APPT-SEQUENCE:0',
  `X-MICROSOFT-CDO-BUSYSTATUS:${busy}`,
  `X-MICROSOFT-CDO-INTENDEDSTATUS:${busy}`,
  `X-MICROSOFT-CDO-ALLDAYEVENT:${allDay ? 'TRUE' : 'FALSE'}`,
  'X-MICROSOFT-CDO-IMPORTANCE:1',
  `X-MICROSOFT-CDO-INSTTYPE:${instType}`,
  'X-MICROSOFT-DONOTFORWARDMEETING:FALSE',
  'X-MICROSOFT-DISALLOW-COUNTER:FALSE',
  'X-MICROSOFT-REQUESTEDATTENDANCEMODE:DEFAULT',
  'X-MICROSOFT-ISRESPONSEREQUESTED:FALSE',
];

function outlookPublish(): string {
  const sync = outlookUid('outlook team sync');
  return crlf(
    vcalendar(
      ['METHOD:PUBLISH', 'PRODID:Microsoft Exchange Server 2010', 'VERSION:2.0', 'X-WR-CALNAME:Calendar'],
      OUTLOOK_FLE,
      vevent(
        'DESCRIPTION:\\n',
        'RRULE:FREQ=WEEKLY;UNTIL=20261116T170000Z;INTERVAL=1;BYDAY=MO;WKST=MO',
        'EXDATE;TZID=FLE Standard Time:20261102T190000',
        `UID:${OUTLOOK_CHOIR_UID}`,
        'SUMMARY;LANGUAGE=en-US:Choir rehearsal',
        'DTSTART;TZID=FLE Standard Time:20261019T190000',
        'DTEND;TZID=FLE Standard Time:20261019T203000',
        'CLASS:PUBLIC',
        'PRIORITY:5',
        'DTSTAMP:20261018T120000Z',
        'TRANSP:OPAQUE',
        'STATUS:CONFIRMED',
        'SEQUENCE:0',
        'LOCATION;LANGUAGE=en-US:Kaarli kirik',
        ...outlookTail('BUSY', false, 1),
      ),
      vevent(
        'DESCRIPTION:\\n',
        'RRULE:FREQ=WEEKLY;COUNT=40;INTERVAL=1;BYDAY=MO,WE;WKST=MO',
        `UID:${sync}`,
        'SUMMARY;LANGUAGE=en-US:Team sync',
        'DTSTART;TZID=FLE Standard Time:20260302T083000',
        'DTEND;TZID=FLE Standard Time:20260302T090000',
        'CLASS:PUBLIC',
        'PRIORITY:5',
        'DTSTAMP:20261018T120000Z',
        'TRANSP:OPAQUE',
        'STATUS:CONFIRMED',
        'SEQUENCE:0',
        'LOCATION;LANGUAGE=en-US:Microsoft Teams Meeting',
        ...outlookTail('BUSY', false, 1),
      ),
      vevent(
        'DESCRIPTION:\\n',
        `UID:${sync}`,
        'RECURRENCE-ID;TZID=FLE Standard Time:20260415T083000',
        'SUMMARY;LANGUAGE=en-US:Team sync',
        'DTSTART;TZID=FLE Standard Time:20260415T100000',
        'DTEND;TZID=FLE Standard Time:20260415T103000',
        'CLASS:PUBLIC',
        'PRIORITY:5',
        'DTSTAMP:20261018T120000Z',
        'TRANSP:OPAQUE',
        'STATUS:CONFIRMED',
        'SEQUENCE:1',
        'LOCATION;LANGUAGE=en-US:Microsoft Teams Meeting',
        ...outlookTail('BUSY', false, 3),
      ),
      vevent(
        'DESCRIPTION:Numbers for Q4.\\n',
        `UID:${OUTLOOK_BUDGET_UID}`,
        'SUMMARY;LANGUAGE=en-US:Budget review',
        'DTSTART;TZID=FLE Standard Time:20261118T140000',
        'DTEND;TZID=FLE Standard Time:20261118T150000',
        'CLASS:PUBLIC',
        'PRIORITY:5',
        'DTSTAMP:20261018T120000Z',
        'TRANSP:OPAQUE',
        'STATUS:CONFIRMED',
        'SEQUENCE:0',
        'LOCATION;LANGUAGE=en-US:Room 4.12',
        ...outlookTail('TENTATIVE', false, 0),
      ),
      vevent(
        'DESCRIPTION:\\n',
        `UID:${outlookUid('outlook christmas eve')}`,
        'SUMMARY;LANGUAGE=en-US:Christmas Eve',
        'DTSTART;VALUE=DATE:20261224',
        'DTEND;VALUE=DATE:20261225',
        'CLASS:PUBLIC',
        'PRIORITY:5',
        'DTSTAMP:20261018T120000Z',
        'TRANSP:TRANSPARENT',
        'STATUS:CONFIRMED',
        'SEQUENCE:0',
        ...outlookTail('FREE', true, 0),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Fastmail, Thunderbird
// ---------------------------------------------------------------------------

function fastmail(): string {
  return crlf(
    vcalendar(
      ['VERSION:2.0', 'PRODID:-//CyrusIMAP.org/Cyrus 3.13.0-alpha0-1052-g9a1d4c7e2-fm-20261001.001-g5e8a3f1b//EN', 'X-WR-CALNAME:Family', 'X-APPLE-CALENDAR-COLOR:#3a87ad'],
      FASTMAIL_MELBOURNE,
      vevent(
        `UID:${uuid('fastmail grandma')}`,
        'SEQUENCE:1',
        'DTSTAMP:20261012T094512Z',
        'CREATED:20260901T081200Z',
        'LAST-MODIFIED:20261012T094512Z',
        'DTSTART;TZID=Australia/Melbourne:20260927T090000',
        'DURATION:PT1H30M',
        'SUMMARY:Call with Grandma',
        'RRULE:FREQ=WEEKLY;BYDAY=SU',
        'X-JMAP-USEDEFAULTALERTS:FALSE',
        'BEGIN:VALARM',
        `UID:${uuid('fastmail grandma alarm')}`,
        'ACTION:DISPLAY',
        'DESCRIPTION:Call with Grandma',
        'TRIGGER;RELATED=START:-PT10M',
        'END:VALARM',
      ),
      vevent(
        `UID:${uuid('fastmail flight')}`,
        'SEQUENCE:0',
        'DTSTAMP:20261012T094512Z',
        'CREATED:20261011T200000Z',
        'LAST-MODIFIED:20261011T200000Z',
        'DTSTART;TZID=Australia/Melbourne:20270403T220000',
        'DURATION:PT10H',
        'SUMMARY:Overnight flight to Perth',
        'LOCATION:Melbourne Airport',
      ),
      vevent(
        `UID:${uuid('fastmail school holidays')}`,
        'SEQUENCE:0',
        'DTSTAMP:20261012T094512Z',
        'CREATED:20260720T080000Z',
        'LAST-MODIFIED:20260720T080000Z',
        'DTSTART;VALUE=DATE:20260919',
        'DTEND;VALUE=DATE:20261005',
        'SUMMARY:School holidays',
        'TRANSP:TRANSPARENT',
      ),
    ),
  );
}

function thunderbird(): string {
  return crlf(
    vcalendar(
      ['PRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN', 'VERSION:2.0'],
      THUNDERBIRD_NEW_YORK,
      vevent(
        'CREATED:20260110T150000Z',
        'LAST-MODIFIED:20261002T150512Z',
        'DTSTAMP:20261002T150512Z',
        `UID:${uuid('thunderbird book club')}`,
        'SUMMARY:Book club',
        'RRULE:FREQ=MONTHLY;BYDAY=-1FR',
        'EXDATE:20261127T230000Z',
        'DTSTART;TZID=America/New_York:20260130T180000',
        'DTEND;TZID=America/New_York:20260130T193000',
        'CATEGORIES:Personal',
        'LOCATION:Main Street Library',
        'SEQUENCE:2',
        'X-MOZ-GENERATION:3',
        'X-MOZ-LASTACK:20261001T120000Z',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER;VALUE=DURATION:-PT15M',
        'DESCRIPTION:Default Mozilla Description',
        'END:VALARM',
      ),
      vevent(
        'CREATED:20260110T151000Z',
        'LAST-MODIFIED:20260110T151000Z',
        'DTSTAMP:20260110T151000Z',
        `UID:${uuid('thunderbird fourth')}`,
        'SUMMARY:Fourth of July cookout',
        'RRULE:FREQ=YEARLY',
        'DTSTART;VALUE=DATE:20260704',
        'DTEND;VALUE=DATE:20260705',
        'TRANSP:TRANSPARENT',
        'X-MOZ-GENERATION:1',
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Thirteen's exports
// ---------------------------------------------------------------------------

const TALLINN = 'Europe/Tallinn';

/** Every 13-month rule form (§4.2, §4.3) with its marker, as Thirteen exports them. */
function thirteenRoundtrip(zones: ZoneResolver): string {
  const id = (name: string) => uuid(`thirteen-roundtrip ${name}`);
  const t = (kind: ThirteenRuleKind, system: CalendarSystemId, start: string, end?: RepeatEnd) =>
    repeat({ kind, system, start: start.slice(0, 10) }, end);
  return thirteenDocument(
    { calendarId: id('calendar'), name: 'Thirteen', color: '#ea580c' },
    [
      { uid: id('book club'), summary: 'Book club: Cotsworth', location: 'Raamatukoi', start: '2026-01-12T19:00', end: '2026-01-12T21:00', zone: TALLINN, recurrence: t('monthly', 'ifc', '2026-01-12', count(20)), exdates: ['2026-11-16T19:00'], alarms: [displayAlarm(-60, 'Book club: Cotsworth')] },
      { uid: id('rent'), summary: 'Rent', start: '2026-01-01', recurrence: t('monthly', 'ifc', '2026-01-01') },
      { uid: id('yoga'), summary: 'Yoga', start: '2026-01-06T07:15', end: '2026-01-06T08:15', zone: TALLINN, recurrence: t('weekly', 'ifc', '2026-01-06', until('2027-06-30')) },
      { uid: id('recycling'), summary: 'Recycling pickup', start: '2026-01-06', recurrence: t('biweekly', 'ifc', '2026-01-06') },
      { uid: id('march 3'), summary: 'IFC March 3', start: '2026-02-28', recurrence: t('yearly', 'ifc', '2026-02-28') },
      { uid: id('march 4'), summary: 'Spring cleaning (IFC March 4)', start: '2026-03-01', recurrence: t('yearly', 'ifc', '2026-03-01') },
      { uid: id('sol 1'), summary: 'Sol party', start: '2026-06-18T18:00', end: '2026-06-18T23:00', zone: TALLINN, recurrence: t('yearly', 'ifc', '2026-06-18', count(5)) },
      { uid: id('year day'), summary: 'Year Day', start: '2026-12-31', recurrence: t('intercalary', 'ifc', '2026-12-31') },
      { uid: id('leap day'), summary: 'Leap Day picnic', start: '2024-06-17', recurrence: t('intercalary', 'ifc', '2024-06-17') },
      { uid: id('positivist monthly'), summary: 'Positivist month end', start: '2026-01-28T18:00', end: '2026-01-28T19:00', zone: TALLINN, recurrence: t('monthly', 'positivist', '2026-01-28', until('2027-12-31')) },
      { uid: id('positivist weekly'), summary: 'Positivist weekly lunch', start: '2026-01-05T12:00', end: '2026-01-05T13:00', zone: TALLINN, recurrence: t('weekly', 'positivist', '2026-01-05') },
      { uid: id('aristotle 4'), summary: 'Aristotle 4', start: '2026-03-01', recurrence: t('yearly', 'positivist', '2026-03-01') },
      { uid: id('bichat 28'), summary: 'Bichat 28', start: '2026-12-30', recurrence: t('yearly', 'positivist', '2026-12-30') },
      { uid: id('all the dead'), summary: 'Festival of All the Dead', start: '2026-12-31', recurrence: t('intercalary', 'positivist', '2026-12-31') },
      { uid: id('holy women'), summary: 'Festival of Holy Women', start: '2024-12-31', recurrence: t('intercalary', 'positivist', '2024-12-31') },
    ],
    zones,
  );
}

/** America/New_York events in 2005 (old DST rules) and 2026 (§5.4, §5.6). */
function newYork20052026(zones: ZoneResolver): string {
  const id = (name: string) => uuid(`ny-2005-2026 ${name}`);
  const NY = 'America/New_York';
  return thirteenDocument(
    { calendarId: id('calendar'), name: 'New York', color: '#2563eb' },
    [
      { uid: id('kickoff 2005'), summary: 'Kickoff', start: '2005-01-10T09:00', end: '2005-01-10T10:00', zone: NY },
      { uid: id('spring course'), summary: 'Spring course', start: '2005-03-14T18:00', end: '2005-03-14T20:00', zone: NY, recurrence: repeat('FREQ=WEEKLY', count(6)) },
      { uid: id('picnic'), summary: 'Picnic', start: '2005-07-04T12:00', end: '2005-07-04T15:00', zone: NY },
      { uid: id('kickoff 2026'), summary: 'Kickoff', start: '2026-01-05T09:00', end: '2026-01-05T10:00', zone: NY },
      { uid: id('standup'), summary: 'Standup', start: '2026-03-02T09:00', end: '2026-03-02T09:15', zone: NY, recurrence: repeat('FREQ=WEEKLY', count(6)) },
      { uid: id('fall back'), summary: 'Night shift', start: '2026-10-31T23:00', end: '2026-11-01T07:00', zone: NY },
    ],
    zones,
  );
}

function jerusalem(zones: ZoneResolver): string {
  const id = (name: string) => uuid(`jerusalem ${name}`);
  const J = 'Asia/Jerusalem';
  return thirteenDocument(
    { calendarId: id('calendar'), name: 'Jerusalem', color: '#0d9488' },
    [
      { uid: id('lessons'), summary: 'Hebrew lesson', start: '2026-03-13T12:00', end: '2026-03-13T13:00', zone: J, recurrence: repeat('FREQ=WEEKLY', count(6)) },
      { uid: id('dst 2026'), summary: 'Breakfast', start: '2026-03-27T08:00', end: '2026-03-27T09:00', zone: J },
      { uid: id('end 2026'), summary: 'Market', start: '2026-10-25T10:00', end: '2026-10-25T11:00', zone: J },
      { uid: id('dst 2029'), summary: 'Breakfast', start: '2029-03-23T08:00', end: '2029-03-23T09:00', zone: J },
      { uid: id('end 2029'), summary: 'Market', start: '2029-10-28T10:00', end: '2029-10-28T11:00', zone: J },
    ],
    zones,
  );
}

/** The UID of the series in ny-open-ended.ics. */
export const NY_OPEN_ENDED_UID = uuid('ny-open-ended planning');

function newYorkOpenEnded(zones: ZoneResolver): string {
  return thirteenDocument(
    { calendarId: uuid('ny-open-ended calendar'), name: 'Planning', color: '#2563eb' },
    [{ uid: NY_OPEN_ENDED_UID, summary: 'Weekly planning', start: '2026-01-05T09:00', end: '2026-01-05T09:30', zone: 'America/New_York', recurrence: repeat('FREQ=WEEKLY;BYDAY=MO') }],
    zones,
  );
}

// ---------------------------------------------------------------------------
// Reader cases
// ---------------------------------------------------------------------------

const PLAIN = ['VERSION:2.0', 'PRODID:-//Example Corp//Calendar Export 4.2//EN'];

function folding(): string {
  const summary = 'SUMMARY:Jõulukontsert: Händel, Pärt ja Tormis 🎄 Kaarli kirikus, Tallinn (Eesti Filharmoonia Kammerkoor)';
  const description =
    'DESCRIPTION:Программа: Арво Пярт, «Магнификат». 日本語の説明もあります。Tickets at the door 🎟️\\nÕhtu lõpeb kell 21.00.';
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Kontserdid'],
      vevent(
        `UID:${uuid('folding concert')}`,
        'DTSTAMP:20261015T080000Z',
        'DTSTART:20261220T170000Z',
        'DTEND:20261220T190000Z',
        // Folded at 75 octets, never inside a UTF-8 sequence (short lines where a character did not fit).
        ...fold(summary),
        ...fold(description),
        // Folded with tabs at 60 octets.
        ...fold('LOCATION:Kaarli kirik, Toompuiestee 4, 10142 Tallinn, Harju maakond, Eesti Vabariik', 60, '\t'),
        // A fold inside a quoted parameter value.
        ...fold('ATTENDEE;CN="Ülle Õunapuu-Šmidt, Eesti Filharmoonia Kammerkoor";ROLE=REQ-PARTICIPANT:mailto:ulle@example.com', 50),
        // A fold where the content itself has a space: the continuation begins with two spaces.
        'COMMENT:The space after this colon and before the next',
        '  word is content.',
      ),
    ),
  );
}

function escapes(): string {
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Escapes\\, commas\\; semicolons'],
      vevent(
        `UID:${uuid('escapes lunch')}`,
        'DTSTAMP:20261015T080000Z',
        'DTSTART:20261023T100000Z',
        'DTEND:20261023T113000Z',
        'SUMMARY:Lunch\\, then a walk\\; bring \\\\umbrella\\\\',
        'DESCRIPTION:Line one\\nLine two\\NLine three\\, with a comma\\nA backslash: \\\\ and a colon: here',
        'LOCATION:Kohvik "Must Puudel"\\; 2nd floor',
        'URL:https://example.com/menu?day=fri&lang=en',
        'ATTENDEE;CN="Kask, Liis";ROLE=REQ-PARTICIPANT:mailto:liis.kask@example.com',
        'ATTACH;FMTTYPE=application/pdf;X-FILENAME="agenda: v2.pdf":https://example.com/agenda.pdf',
        'X-ALT-DESC;FMTTYPE=text/html:<p>Line one</p><p>Line two</p>',
      ),
    ),
  );
}

function lineEndings(): string {
  const lf = vcalendar(
    [...PLAIN, 'X-WR-CALNAME:Line ends'],
    vevent(`UID:${uuid('line endings lf')}`, 'DTSTAMP:20261015T080000Z', 'DTSTART;VALUE=DATE:20261019', 'SUMMARY:Written with LF line ends'),
  );
  const cr = vevent(`UID:${uuid('line endings cr')}`, 'DTSTAMP:20261015T080000Z', 'DTSTART:20261020T090000Z', 'DURATION:PT1H', 'SUMMARY:Written with CR line ends', 'DESCRIPTION:Old Mac', ' style.');
  // LF everywhere, except one VEVENT with CR line ends.
  return `${lf.slice(0, -1).join('\n')}\n${cr.join('\r')}\r${lf.at(-1)}\n`;
}

function bom(): string {
  return `﻿${crlf(vcalendar([...PLAIN, 'X-WR-CALNAME:Byte order mark'], vevent(`UID:${uuid('bom')}`, 'DTSTAMP:20261015T080000Z', 'DTSTART;VALUE=DATE:20261024', 'SUMMARY:Saved by Notepad')))}`;
}

function durations(): string {
  const e = (name: string, ...lines: string[]) => vevent(`UID:${uuid(`duration ${name}`)}`, 'DTSTAMP:20261015T080000Z', ...lines);
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Durations'],
      GOOGLE_TALLINN,
      e('p1d', 'SUMMARY:P1D across spring forward (wall clock: 23 hours)', 'DTSTART;TZID=Europe/Tallinn:20260328T120000', 'DURATION:P1D'),
      e('pt24h', 'SUMMARY:PT24H across spring forward (exact)', 'DTSTART;TZID=Europe/Tallinn:20260328T120000', 'DURATION:PT24H'),
      e('p1dt2h', 'SUMMARY:P1DT2H (a day on the wall clock\\, then 2 hours)', 'DTSTART;TZID=Europe/Tallinn:20260328T120000', 'DURATION:P1DT2H'),
      e('fall back', 'SUMMARY:PT3H across fall back', 'DTSTART;TZID=Europe/Tallinn:20261025T020000', 'DURATION:PT3H'),
      e('p1w', 'SUMMARY:P1W across spring forward', 'DTSTART;TZID=Europe/Tallinn:20260325T090000', 'DURATION:P1W'),
      e('utc', 'SUMMARY:PT1H30M in UTC', 'DTSTART:20261105T100000Z', 'DURATION:PT1H30M'),
      e('seconds', 'SUMMARY:PT45M30S (seconds dropped)', 'DTSTART:20261105T130000Z', 'DURATION:PT45M30S'),
      e('zero', 'SUMMARY:PT0S', 'DTSTART:20261105T150000Z', 'DURATION:PT0S'),
      e('all day', 'SUMMARY:All-day P3D', 'DTSTART;VALUE=DATE:20261224', 'DURATION:P3D'),
      e('daily', 'SUMMARY:Daily PT25H across fall back', 'DTSTART;TZID=Europe/Tallinn:20261023T120000', 'DURATION:PT25H', 'RRULE:FREQ=DAILY;COUNT=3'),
      e(
        'daily p1d',
        'SUMMARY:Daily P1D across spring forward (each ends at 12:00)',
        'DTSTART;TZID=Europe/Tallinn:20260327T120000',
        'DURATION:P1D',
        'RRULE:FREQ=DAILY;COUNT=3',
      ),
    ),
  );
}

function periodRdate(): string {
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Periods'],
      GOOGLE_TALLINN,
      vevent(
        `UID:${uuid('period weekly')}`,
        'DTSTAMP:20261015T080000Z',
        'SUMMARY:Office hours',
        'DTSTART;TZID=Europe/Tallinn:20261102T100000',
        'DTEND;TZID=Europe/Tallinn:20261102T110000',
        'RRULE:FREQ=WEEKLY;COUNT=4',
        'RDATE;VALUE=PERIOD;TZID=Europe/Tallinn:20261105T150000/PT2H,20261112T150000/20261112T180000',
        'RDATE;VALUE=PERIOD:20261120T080000Z/PT4H',
      ),
      vevent(
        `UID:${uuid('period single')}`,
        'DTSTAMP:20261015T080000Z',
        'SUMMARY:Exam sittings',
        'DTSTART:20261201T080000Z',
        'DTEND:20261201T090000Z',
        'RDATE;VALUE=PERIOD:20261203T080000Z/PT3H30M,20261208T120000Z/PT30M',
      ),
      vevent(
        `UID:${uuid('period day')}`,
        'DTSTAMP:20261015T080000Z',
        'SUMMARY:Weekend pass',
        'DTSTART;TZID=Europe/Tallinn:20260321T120000',
        'DTEND;TZID=Europe/Tallinn:20260321T130000',
        'RDATE;VALUE=PERIOD;TZID=Europe/Tallinn:20260328T120000/P1D',
      ),
    ),
  );
}

function floating(): string {
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Floating'],
      vevent(`UID:${uuid('floating run')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Morning run (wherever I am)', 'DTSTART:20260601T070000', 'DTEND:20260601T073000', 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5', 'EXDATE:20260605T070000'),
      vevent(`UID:${uuid('floating pill')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Take a vitamin', 'DTSTART:20261019T080000', 'RRULE:FREQ=WEEKLY;UNTIL=20261109T235900'),
      vevent(`UID:${uuid('floating nap')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Nap', 'DTSTART:20261231T230000', 'DTEND:20270101T013000'),
    ),
  );
}

function unknownTzid(): string {
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Zones'],
      customizedTimeZone('+0530', null),
      vevent(`UID:${uuid('unknown nowhere')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Unknown zone (floating)', 'DTSTART;TZID=Nowhere/Special:20261019T090000', 'DTEND;TZID=Nowhere/Special:20261019T100000'),
      vevent(`UID:${uuid('unknown mozilla')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Old Mozilla zone id (floating)', 'DTSTART;TZID=/mozilla.org/20050126_1/Europe/Tallinn:20261020T090000', 'DTEND;TZID=/mozilla.org/20050126_1/Europe/Tallinn:20261020T100000'),
      vevent(`UID:${uuid('unknown custom')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Customized Time Zone (from the file)', 'DTSTART;TZID=Customized Time Zone:20261021T090000', 'DTEND;TZID=Customized Time Zone:20261021T100000'),
      vevent(`UID:${uuid('unknown windows')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Windows id without a VTIMEZONE', 'DTSTART;TZID=Tokyo Standard Time:20261022T090000', 'DTEND;TZID=Tokyo Standard Time:20261022T100000'),
      vevent(`UID:${uuid('unknown quoted')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Quoted IANA id', 'DTSTART;TZID="Europe/Tallinn":20261023T090000', 'DTEND;TZID="Europe/Tallinn":20261023T100000'),
    ),
  );
}

function broken(): string {
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Broken'],
      vevent(`UID:${uuid('broken good')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:A good event', 'DTSTART:20261019T090000Z', 'DTEND:20261019T100000Z'),
      vevent(`UID:${uuid('broken dtstart')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Unreadable start (skipped)', 'DTSTART:2026-10-20 09:00'),
      vevent(`UID:${uuid('broken no start')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:No start at all (skipped)'),
      vevent(
        `UID:${uuid('broken parts')}`,
        'DTSTAMP:20261015T080000Z',
        'SUMMARY:Readable start\\, broken parts',
        'DTSTART:20261021T090000Z',
        'DTEND:sometime',
        'RRULE:FREQ=FORTNIGHTLY',
        'EXDATE:yesterday',
        'This line has no colon',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:No trigger',
        'END:VALARM',
      ),
      vevent('DTSTAMP:20261015T080000Z', 'SUMMARY:No UID', 'DTSTART:20261022T090000Z', 'DTEND:20261022T093000Z'),
      // Unclosed: it ends where the next top-level component begins.
      ['BEGIN:VEVENT', `UID:${uuid('broken unclosed')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Never closed', 'DTSTART:20261023T090000Z'],
      vevent(`UID:${uuid('broken after')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:After the unclosed one', 'DTSTART;VALUE=DATE:20261024'),
    ),
  );
}

function components(): string {
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Components'],
      ['BEGIN:VTODO', `UID:${uuid('components todo')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Buy stamps', 'DUE;VALUE=DATE:20261020', 'STATUS:NEEDS-ACTION', 'END:VTODO'],
      ['BEGIN:VJOURNAL', `UID:${uuid('components journal')}`, 'DTSTAMP:20261015T080000Z', 'DTSTART;VALUE=DATE:20261019', 'SUMMARY:Notes', 'DESCRIPTION:Nothing to see here.', 'END:VJOURNAL'],
      ['BEGIN:VFREEBUSY', `UID:${uuid('components freebusy')}`, 'DTSTAMP:20261015T080000Z', 'DTSTART:20261019T000000Z', 'DTEND:20261026T000000Z', 'FREEBUSY:20261020T090000Z/PT1H', 'END:VFREEBUSY'],
      vevent(
        `UID:${uuid('components event')}`,
        'DTSTAMP:20261015T080000Z',
        'SUMMARY:The only event',
        'DTSTART:20261021T090000Z',
        'DTEND:20261021T100000Z',
        'BEGIN:X-EXAMPLE-NOTE',
        'X-TEXT:A subcomponent the reader does not know',
        'END:X-EXAMPLE-NOTE',
      ),
    ),
  );
}

function markerMismatch(): string {
  const e = (name: string, ...lines: string[]) => vevent(`UID:${uuid(`marker ${name}`)}`, 'DTSTAMP:20261015T080000Z', ...lines);
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Markers'],
      e('agrees', 'SUMMARY:Marker agrees (IFC day 12)', 'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18', 'X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=monthly;DAY=12'),
      e('day', 'SUMMARY:Marker says day 13\\, the rule says day 12', 'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18', 'X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=monthly;DAY=13'),
      e('weekly', 'SUMMARY:Marker says 13-month weekly\\, the rule is Gregorian weekly', 'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6', 'X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=weekly;WEEKDAY=TH'),
      e('version', 'SUMMARY:A marker of another version (kept as read)', 'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=MONTHLY;COUNT=4', 'X-THIRTEEN-RULE;VERSION=2:SYSTEM=ifc;KIND=monthly;DAY=12'),
    ),
  );
}

function rscale(): string {
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Other calendars'],
      vevent(`UID:${uuid('rscale hebrew')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Yearly on 1 Tishri (Hebrew calendar)', 'DTSTART;VALUE=DATE:20250923', 'RRULE:RSCALE=HEBREW;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1'),
      vevent(`UID:${uuid('rscale skip')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Born on February 29 (March 1 in common years)', 'DTSTART;VALUE=DATE:20240229', 'RRULE:RSCALE=GREGORIAN;FREQ=YEARLY;SKIP=FORWARD'),
    ),
  );
}

function farFuture(): string {
  const e = (name: string, ...lines: string[]) => vevent(`UID:${uuid(`far future ${name}`)}`, 'DTSTAMP:20261015T080000Z', ...lines);
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:The last year'],
      e('last day', 'SUMMARY:The last day', 'DTSTART;VALUE=DATE:99991231'),
      e('last days', 'SUMMARY:The last three days', 'DTSTART;VALUE=DATE:99991229', 'DURATION:P3D'),
      e('new york', 'SUMMARY:23:00 in New York (year 10000 in UTC)', 'DTSTART;TZID=America/New_York:99991231T230000', 'DTEND;TZID=America/New_York:99991231T233000'),
      e('tallinn', 'SUMMARY:15:00 in Tallinn', 'DTSTART;TZID=Europe/Tallinn:99991231T150000', 'DTEND;TZID=Europe/Tallinn:99991231T160000'),
      e('daily', 'SUMMARY:Daily into the end', 'DTSTART;TZID=Europe/Tallinn:99991229T090000', 'DTEND;TZID=Europe/Tallinn:99991229T091500', 'RRULE:FREQ=DAILY'),
      e('dtend', 'SUMMARY:Two days ending with DTEND 10000101', 'DTSTART;VALUE=DATE:99991230', 'DTEND;VALUE=DATE:10000101'),
    ),
  );
}

function untilInstant(): string {
  const e = (name: string, ...lines: string[]) => vevent(`UID:${uuid(`until ${name}`)}`, 'DTSTAMP:20261015T080000Z', ...lines);
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Untils'],
      GOOGLE_TALLINN,
      e('head', 'SUMMARY:Choir (ended one second before November 16)', 'DTSTART;TZID=Europe/Tallinn:20261019T190000', 'DTEND;TZID=Europe/Tallinn:20261019T203000', 'RRULE:FREQ=WEEKLY;UNTIL=20261116T165959Z'),
      e('tail', 'SUMMARY:Choir (from November 16)', 'DTSTART;TZID=Europe/Tallinn:20261116T190000', 'DTEND;TZID=Europe/Tallinn:20261116T203000', 'RRULE:FREQ=WEEKLY;COUNT=4'),
      e('midnight', 'SUMMARY:Choir (UNTIL at 00:00 UTC on November 16)', 'DTSTART;TZID=Europe/Tallinn:20261019T190000', 'DTEND;TZID=Europe/Tallinn:20261019T203000', 'RRULE:FREQ=WEEKLY;UNTIL=20261116T000000Z'),
    ),
  );
}

/** The UID of the own-time RDATE series in rrule-rdate.ics (edits/own-time-rdate.json). */
export const OWN_TIME_UID = uuid('rdate own time');

function rruleRdate(): string {
  const e = (uid: string, ...lines: string[]) => vevent(`UID:${uid}`, 'DTSTAMP:20261015T080000Z', ...lines);
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Extra dates'],
      GOOGLE_TALLINN,
      e(
        OWN_TIME_UID,
        'SUMMARY:Consultation',
        'DTSTART;TZID=Europe/Tallinn:20261019T090000',
        'DTEND;TZID=Europe/Tallinn:20261019T100000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6',
        'RDATE;TZID=Europe/Tallinn:20261102T150000',
        'RDATE;VALUE=PERIOD;TZID=Europe/Tallinn:20261112T140000/PT3H',
        'EXDATE;TZID=Europe/Tallinn:20261109T090000',
      ),
      e(uuid('rdate count'), 'SUMMARY:Three weeks and one extra', 'DTSTART:20261020T120000Z', 'DTEND:20261020T130000Z', 'RRULE:FREQ=WEEKLY;COUNT=3', 'RDATE:20261111T120000Z'),
      e(uuid('rdate after until'), 'SUMMARY:An extra date after the end', 'DTSTART;VALUE=DATE:20261201', 'RRULE:FREQ=DAILY;UNTIL=20261203', 'RDATE;VALUE=DATE:20261215'),
      e(uuid('rdate excluded'), 'SUMMARY:An extra date that is also excluded', 'DTSTART;VALUE=DATE:20261201', 'RRULE:FREQ=WEEKLY;COUNT=2', 'RDATE;VALUE=DATE:20261204', 'EXDATE;VALUE=DATE:20261204'),
    ),
  );
}

function exrule(): string {
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:EXRULE'],
      vevent(`UID:${uuid('exrule weekdays')}`, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Daily except weekends', 'DTSTART:20261001T060000Z', 'DTEND:20261001T061500Z', 'RRULE:FREQ=DAILY;COUNT=20', 'EXRULE:FREQ=WEEKLY;BYDAY=SA,SU'),
      vevent(
        `UID:${uuid('exrule ends')}`,
        'DTSTAMP:20261015T080000Z',
        'SUMMARY:Weekly with an ending exception rule',
        'DTSTART;VALUE=DATE:20261102',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261231',
        'EXRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261126',
      ),
    ),
  );
}

function twoRrules(): string {
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Two rules'],
      vevent(
        `UID:${uuid('two rrules')}`,
        'DTSTAMP:20261015T080000Z',
        'SUMMARY:Thursdays until October and the 20th of four months',
        'DTSTART:20260820T090000Z',
        'DTEND:20260820T100000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261031T235959Z',
        'RRULE:FREQ=MONTHLY;BYMONTHDAY=20;COUNT=4',
      ),
    ),
  );
}

function duplicateUid(): string {
  const uid = 'UID:dup@example.com';
  const repeatOverride = vevent(uid, 'DTSTAMP:20261015T080000Z', 'RECURRENCE-ID:20261021T090000Z', 'DTSTART:20261021T110000Z', 'DTEND:20261021T120000Z', 'SUMMARY:Moved (first copy)');
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Duplicates'],
      vevent(uid, 'DTSTAMP:20261015T080000Z', 'SUMMARY:First master', 'DTSTART:20261019T090000Z', 'DTEND:20261019T100000Z', 'RRULE:FREQ=DAILY;COUNT=5'),
      repeatOverride,
      vevent(uid, 'DTSTAMP:20261016T080000Z', 'RECURRENCE-ID:20261021T090000Z', 'DTSTART:20261021T130000Z', 'DTEND:20261021T140000Z', 'SUMMARY:Moved (second copy\\, same RECURRENCE-ID)'),
      vevent(uid, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Second master', 'DTSTART:20261026T090000Z', 'DTEND:20261026T100000Z'),
      // An exact copy of the first override: collapsed.
      repeatOverride,
      vevent('UID:single@example.com', 'DTSTAMP:20261015T080000Z', 'SUMMARY:Not a duplicate', 'DTSTART;VALUE=DATE:20261027'),
    ),
  );
}

function missingUid(): string {
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Bookings'],
      vevent('DTSTAMP:20261015T120000Z', 'DTSTART:20261024T160000Z', 'DTEND:20261024T180000Z', 'SUMMARY:Concert: Estonian National Symphony Orchestra', 'LOCATION:Estonia Concert Hall'),
      vevent('DTSTAMP:20261015T120000Z', 'DTSTART;VALUE=DATE:20261107', 'SUMMARY:Museum day pass'),
    ),
  );
}

function windowEdges(): string {
  const e = (name: string, ...lines: string[]) => vevent(`UID:${uuid(`window ${name}`)}`, 'DTSTAMP:20261015T080000Z', ...lines);
  const monthly = `UID:${uuid('window monthly')}`;
  return crlf(
    vcalendar(
      [...PLAIN, 'X-WR-CALNAME:Year ends'],
      e('trip', 'SUMMARY:Holiday trip (across January 1\\, 2026)', 'DTSTART;VALUE=DATE:20251230', 'DTEND;VALUE=DATE:20260103'),
      e('winter', 'SUMMARY:Winter break', 'DTSTART;VALUE=DATE:20261228', 'DTEND;VALUE=DATE:20270104'),
      e('party', 'SUMMARY:New Year party', 'DTSTART;TZID=Europe/Tallinn:20261231T220000', 'DTEND;TZID=Europe/Tallinn:20270101T013000'),
      e('kiritimati', 'SUMMARY:First sunrise on the Line Islands', 'DTSTART;TZID=Pacific/Kiritimati:20270101T010000', 'DTEND;TZID=Pacific/Kiritimati:20270101T020000'),
      e('silvester', 'SUMMARY:Silvester (across the end of 2027)', 'DTSTART;TZID=Europe/Tallinn:20271231T230000', 'DTEND;TZID=Europe/Tallinn:20280101T010000'),
      vevent(monthly, 'DTSTAMP:20261015T080000Z', 'SUMMARY:Monthly review', 'DTSTART;TZID=Europe/Tallinn:20261215T090000', 'DTEND;TZID=Europe/Tallinn:20261215T100000', 'RRULE:FREQ=MONTHLY;COUNT=3'),
      vevent(monthly, 'DTSTAMP:20261015T080000Z', 'RECURRENCE-ID;TZID=Europe/Tallinn:20261215T090000', 'SUMMARY:Monthly review (moved into January)', 'DTSTART;TZID=Europe/Tallinn:20270105T090000', 'DTEND;TZID=Europe/Tallinn:20270105T100000'),
      vevent(monthly, 'DTSTAMP:20261015T080000Z', 'RECURRENCE-ID;TZID=Europe/Tallinn:20270115T090000', 'SUMMARY:Monthly review (moved into December)', 'DTSTART;TZID=Europe/Tallinn:20261220T090000', 'DTEND;TZID=Europe/Tallinn:20261220T100000'),
    ),
  );
}

// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------

const year = (y: number): WindowSpec => ({ from: `${y}-01-01T00:00`, to: `${y}-12-31T24:00` });

/** Every case of `fixtures/ics/cases`, in file name order. */
export const ICS_CASES: readonly IcsCase[] = [
  {
    file: 'broken.ics',
    tests: 'Damaged input: an unreadable DTSTART and a VEVENT without one (skipped and kept as read), an unreadable DTEND, RRULE and EXDATE (kept as extra properties), a line without a colon, a VALARM without TRIGGER, a VEVENT without UID (derived UID), and a VEVENT that is never closed. Parsing never stops; the round trip gives the text back.',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: broken,
  },
  {
    file: 'bom.ics',
    tests: 'A UTF-8 byte order mark before BEGIN:VCALENDAR (dropped by the writer).',
    source: 'Written for the set, as Windows Notepad saves UTF-8.',
    roundTrip: 'as-read',
    text: bom,
  },
  {
    file: 'components.ics',
    tests: 'VTODO, VJOURNAL and VFREEBUSY (skipped-component, kept as read) and an unknown subcomponent inside a VEVENT.',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: components,
  },
  {
    file: 'duplicate-uid.ics',
    tests: 'Two masters with one UID (the second gets #2 keys), two overrides with one RECURRENCE-ID (the second shown on its own with #2), an exact duplicate component (collapsed); duplicate-uid warnings.',
    source: 'Written for the set; feeds repeat UIDs (§3.2).',
    roundTrip: 'as-read',
    text: duplicateUid,
  },
  {
    file: 'duration.ics',
    tests: 'DURATION: days and weeks on the wall clock, hours and minutes exactly (RFC 5545 §3.3.6), across the 2026 spring-forward and fall-back nights in Europe/Tallinn; seconds dropped; PT0S; an all-day P3D; a daily series with PT25H; a daily series with P1D whose second occurrence crosses spring forward (every occurrence ends at 12:00 the next day, RFC 5545 §3.8.5.3).',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: durations,
  },
  {
    file: 'escapes.ics',
    tests: 'TEXT escapes (\\n, \\N, \\,, \\;, \\\\), quoted parameter values holding commas and colons, a URL with & and ?, an HTML X-ALT-DESC.',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: escapes,
  },
  {
    file: 'exrule.ics',
    tests: 'EXRULE (RFC 2445, a foreign rule): a daily series without weekends, and a weekly series whose EXRULE ends before its RRULE.',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: exrule,
  },
  {
    file: 'far-future.ics',
    tests: 'The year 9999: all-day events on 9999-12-31 (kept), 23:00 on 9999-12-31 in New York (year 10000 in UTC: dropped with out-of-range on every device), 15:00 in Tallinn (kept in Tallinn and New York, dropped on Pacific/Kiritimati where it is 03:00 on January 1, 10000), a daily series that runs into 9999-12-31 and stops there, DURATION:P3D to the last day, and DTEND;VALUE=DATE:10000101 (read as ending 9999-12-31T24:00).',
    source: 'Written for the set.',
    expansions: [
      { deviceZone: 'Europe/Tallinn', window: year(9999) },
      { deviceZone: 'America/New_York', window: year(9999) },
      { deviceZone: 'Pacific/Kiritimati', window: year(9999) },
    ],
    roundTrip: 'zones-added',
    text: farFuture,
  },
  {
    file: 'fastmail.ics',
    tests: 'Fastmail (Cyrus): DURATION instead of DTEND, a southern-hemisphere zone (Australia/Melbourne, DST from October to April), VALARM with RELATED=START, X-JMAP properties.',
    source: 'Anonymized Fastmail export.',
    roundTrip: 'as-read',
    text: fastmail,
  },
  {
    file: 'floating.ics',
    tests: 'Floating date-times (no TZID, no Z): the same wall clock on every device, a floating EXDATE and UNTIL, a floating event across midnight.',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: floating,
  },
  {
    file: 'folding.ics',
    tests: 'Folded lines: multi-byte characters (Estonian, Cyrillic, Japanese, emoji) at the 75-octet limit without a split UTF-8 sequence, tab continuations, a fold inside a quoted parameter, and a continuation whose content begins with a space.',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: folding,
  },
  {
    file: 'google-holidays.ics',
    tests: 'A trimmed copy of the public US holidays feed: all-day single events from 2021 onward, observed days, observances with an escaped line break, TRANSP:TRANSPARENT.',
    source: "Google Calendar's public feed \"Holidays in United States\" (en.usa), trimmed to ten holidays a year and their observed days, rebuilt from the holiday rules; UIDs anonymized.",
    roundTrip: 'as-read',
    text: googleHolidays,
  },
  {
    file: 'google-secret.ics',
    tests: "A personal Google calendar through its secret iCal address: Google's Europe/Tallinn VTIMEZONE, a weekly series with UNTIL in UTC, an EXDATE, an override moved to another day, a canceled override, a single event in UTC, an all-day event over a weekend, ORGANIZER and ATTENDEE, Google's VALARM.",
    source: 'Anonymized Google Calendar export (secret address in iCal format).',
    roundTrip: 'as-read',
    text: () => googleSecret(1),
  },
  {
    file: 'icloud-export.ics',
    tests: "An Apple Calendar export: Apple's VTIMEZONE (2002 onsets), X-APPLE-* properties, X-APPLE-STRUCTURED-LOCATION folded, VALARM with X-WR-ALARMUID and ACTION:AUDIO, Apple's ACTION:NONE alarm, X-APPLE-TRAVEL-ADVISORY-BEHAVIOR, a series from 2025, an override and an EXDATE list.",
    source: 'Anonymized export of an iCloud calendar from Calendar on macOS 15.',
    roundTrip: 'as-read',
    text: icloudExport,
  },
  {
    file: 'jerusalem.ics',
    tests: "Asia/Jerusalem events in 2026 and 2029 as Thirteen exports them: the generated VTIMEZONE follows Israel's \"Friday before the last Sunday of March\", whose day rule differs between years (the last Friday in 2026 and 2027, the fourth Friday in 2028 and 2029).",
    source: 'Generated by Thirteen (packages/core/scripts/ics-cases.ts).',
    extraWindows: [year(2029)],
    roundTrip: 'as-read',
    text: jerusalem,
  },
  {
    file: 'line-endings.ics',
    tests: 'LF line ends, and one VEVENT with CR line ends (old Mac style), including a fold.',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: lineEndings,
  },
  {
    file: 'marker-mismatch.ics',
    tests: 'X-THIRTEEN-RULE markers: one that agrees with its BYYEARDAY rule, one naming another day, one naming a 13-month weekly rule on a Gregorian weekly RRULE (both ignored: the rule decides), and one of another version (kept as an extra property).',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: markerMismatch,
  },
  {
    file: 'missing-uid.ics',
    tests: 'Two VEVENTs without UID: derived UIDs (missing- and 32 hex digits of SHA-256 of the calendar id, the DTSTART line and the SUMMARY), the same on every read (imports/missing-uid.json imports the file twice).',
    source: 'Anonymized export of a ticket booking site.',
    roundTrip: 'as-read',
    text: missingUid,
  },
  {
    file: 'ny-2005-2026.ics',
    tests: 'America/New_York events in 2005 (one on January 10, 2005, a weekly series across the April 3, 2005 change of the old rules) and 2026, exported with a generated VTIMEZONE that holds both rule periods: 2004 to 2006 with onsets in 2004 (before the first event) and an UNTIL, and 2007 onward without UNTIL.',
    source: 'Generated by Thirteen (packages/core/scripts/ics-cases.ts).',
    extraWindows: [year(2005)],
    roundTrip: 'as-read',
    text: newYork20052026,
  },
  {
    file: 'ny-open-ended.ics',
    tests: 'A weekly America/New_York series from Monday, January 5, 2026 without an end, as Thirteen exports it: the generated VTIMEZONE (2026 to 2027) ends with an open-ended period, so a reader that uses only this VTIMEZONE puts July 2030 at UTC-4 and January 2031 at UTC-5.',
    source: 'Generated by Thirteen (packages/core/scripts/ics-cases.ts).',
    extraWindows: [{ from: '2030-06-01T00:00', to: '2031-02-01T00:00' }],
    roundTrip: 'as-read',
    text: newYorkOpenEnded,
  },
  {
    file: 'outlook-publish.ics',
    tests: "A published Outlook calendar: the Windows zone id FLE Standard Time (mapped to IANA through the CLDR table) with Outlook's 1601 VTIMEZONE, X-MICROSOFT-CDO-* properties, an escaped line break as the whole DESCRIPTION, an Outlook-style UNTIL at the last occurrence's start, an override, a tentative event, an all-day event.",
    source: 'Anonymized Outlook on the web "Publish calendar" ICS link (Exchange Online).',
    roundTrip: 'as-read',
    text: outlookPublish,
  },
  {
    file: 'override-only.ics',
    tests: 'An invited single instance of someone else\'s series: a VEVENT with RECURRENCE-ID and no master. Shown as a single event (the orphan path, §4.6); imports/override-only.json merges it into the master of google-secret.ics.',
    source: 'Anonymized Google Calendar export of a calendar invited to one instance.',
    roundTrip: 'as-read',
    text: () => overrideOnly(1),
  },
  {
    file: 'period-rdate.ics',
    tests: 'RDATE;VALUE=PERIOD with an end and with a duration, in a TZID and in UTC: each extra date keeps its own length; a P1D period across spring forward lasts a day on the wall clock (23 hours).',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: periodRdate,
  },
  {
    file: 'rrule-rdate.ics',
    tests: 'RRULE with extra dates: an RDATE at 15:00 on a Monday the 09:00 rule also produces (both shown), an RDATE PERIOD longer than the master, an EXDATE; FREQ=WEEKLY;COUNT=3 plus one RDATE (4 occurrences); an RDATE after the UNTIL (shown); an RDATE on an EXDATE (removed).',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: rruleRdate,
  },
  {
    file: 'rscale.ics',
    tests: 'RSCALE (RFC 7529): a Hebrew yearly rule and a Gregorian rule with SKIP=FORWARD. Both are foreign and unsupported (§4.5): only the start is shown.',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: rscale,
  },
  {
    file: 'thirteen-roundtrip.ics',
    tests: 'Every 13-month rule form with its X-THIRTEEN-RULE marker, as Thirteen exports them: IFC and Positivist monthly, weekly, every 2 weeks, yearly in forms (a) and (b), Year Day, Leap Day (form (c), capped), All the Dead and Holy Women; ends by count, until (a UTC end of day for timed series) and never; an EXDATE; a VALARM.',
    source: 'Generated by Thirteen (packages/core/scripts/ics-cases.ts).',
    roundTrip: 'as-read',
    text: thirteenRoundtrip,
  },
  {
    file: 'thunderbird.ics',
    tests: 'Thunderbird: X-TZINFO in its VTIMEZONE, a monthly last-Friday rule with an EXDATE in UTC (matched to the 18:00 New York occurrence), TRIGGER;VALUE=DURATION, X-MOZ-* properties, a yearly all-day event.',
    source: 'Anonymized export from Thunderbird 140.',
    roundTrip: 'as-read',
    text: thunderbird,
  },
  {
    file: 'two-rrules.ics',
    tests: 'Two RRULEs in one VEVENT (a foreign rule) from Thursday, August 20, 2026, a start both rules produce: the union of both without duplicates, each bounded by its own end (UNTIL and COUNT).',
    source: 'Written for the set.',
    roundTrip: 'as-read',
    text: twoRrules,
  },
  {
    file: 'unknown-tzid.ics',
    tests: 'TZID resolution (§5.4): an unknown id and an old Mozilla id (floating, unknown-tzid warning), "Customized Time Zone" defined only by the file\'s VTIMEZONE, a Windows id without a VTIMEZONE (CLDR table), a quoted IANA id.',
    source: 'Written for the set.',
    roundTrip: 'zones-added',
    text: unknownTzid,
  },
  {
    file: 'until-instant.ics',
    tests: 'UNTIL as an instant: a weekly 19:00 Europe/Tallinn series with UNTIL=20261116T165959Z (ends November 9) and its continuation from November 16 (no duplicate on November 16), and UNTIL=20261116T000000Z on the same series (also ends November 9).',
    source: 'Written for the set; the head and tail are what a "this and future events" split in Google writes.',
    roundTrip: 'as-read',
    text: untilInstant,
  },
  {
    file: 'window-edges.ics',
    tests: 'Year edges: an all-day trip across January 1, 2026 (the window start), the Winter break across January 1, 2027, a party across midnight, 01:00 on January 1 in Pacific/Kiritimati (December 31 in Pacific/Honolulu), overrides moved from December into January and from January into December, an event across the end of 2027 (the window end). The per-year windows are the ones Windows and the web cache.',
    source: 'Written for the set.',
    expansions: [
      ...DEVICE_ZONES.map((deviceZone) => ({ deviceZone, window: DEFAULT_WINDOW })),
      ...DEVICE_ZONES.flatMap((deviceZone) => [year(2026), year(2027)].map((window) => ({ deviceZone, window }))),
      { deviceZone: 'Pacific/Honolulu', window: DEFAULT_WINDOW },
    ],
    roundTrip: 'zones-added',
    text: windowEdges,
  },
];

/** The expansions of a case: its own list, or both device zones over the default and extra windows. */
export function caseExpansions(c: IcsCase): { deviceZone: string; window: WindowSpec }[] {
  if (c.expansions !== undefined) return [...c.expansions];
  const windows = [DEFAULT_WINDOW, ...(c.extraWindows ?? [])];
  return DEVICE_ZONES.flatMap((deviceZone) => windows.map((window) => ({ deviceZone, window })));
}

/** The calendar id a case is read with (it seeds derived UIDs and is the first part of every key): its file name without `.ics`. */
export const caseCalendarId = (file: string): string => file.replace(/\.ics$/, '');

