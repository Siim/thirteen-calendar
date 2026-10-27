/**
 * The procedures of `fixtures/ics` (docs/EVENTS.md §5.6, task C8): the edits,
 * imports and restores, their extra input files, and the restore set (two
 * local calendars and a subscription as Thirteen exports them, one file each
 * and the same as one zip).
 * @module
 */

import type { ZoneResolver } from '../src/events/index.ts';
import { type IcsCalendar, type IcsDateValue, parseICalendar, serializeICalendar } from '../src/ics/index.ts';
import { parseLocalDateTime } from '../src/events/time.ts';
import { parseISODate } from '../src/index.ts';
import {
  CHOIR_UID,
  ICS_NOW,
  OUTLOOK_BUDGET_UID,
  OUTLOOK_CHOIR_UID,
  OWN_TIME_UID,
  type ThirteenEventSpec,
  type WindowSpec,
  displayAlarm,
  googleSecret,
  overrideOnly,
  repeat,
  thirteenDocument,
  thirteenEvent,
} from './ics-cases.ts';
import { icsDateValueJson, icsEventJson } from './ics-json.ts';
import { type ChangeJson, type ProcedureSpec, editMaster, editOverride, retimeChanges } from './ics-procedures.ts';
import { GOOGLE_TALLINN, crlf, customizedTimeZone, googleId, outlookUid, uuid, vcalendar, vevent } from './ics-texts.ts';
import { writeZip } from './zip.ts';

const TALLINN = 'Europe/Tallinn';
const FLE = 'FLE Standard Time';
const zoned = (text: string, tzid: string): IcsDateValue => ({ kind: 'zoned', value: parseLocalDateTime(text), tzid });
const date = (text: string): IcsDateValue => ({ kind: 'date', date: parseISODate(text) });
const both = (window: WindowSpec) => ['Europe/Tallinn', 'America/New_York'].map((deviceZone) => ({ deviceZone, window }));
const year = (y: number): WindowSpec => ({ from: `${y}-01-01T00:00`, to: `${y}-12-31T24:00` });
const AUTUMN_2026: WindowSpec = { from: '2026-10-01T00:00', to: '2027-01-01T00:00' };

/** An `add` change for a new event made in Thirteen. */
const addEvent = (spec: ThirteenEventSpec, calendar: IcsCalendar, zones: ZoneResolver): ChangeJson => ({ op: 'add', event: icsEventJson(thirteenEvent(spec, calendar, zones)) });

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export const EDIT_SPECS: readonly ProcedureSpec[] = [
  {
    file: 'edits/generated-tz-grow.json',
    description:
      'Events added to a document whose generated VTIMEZONE records the years 2026 to 2027 (cases/ny-open-ended.ics): a 2031 America/New_York event rebuilds it as X-THIRTEEN-GENERATED:2026-2031 (still open-ended), then a 2005 event adds the pre-2007 rule period (2005-2031, onsets from 2004). Every other group stays byte for byte.',
    scenarios: [
      {
        name: 'A 2031 event, then a 2005 event',
        calendarId: 'ny-open-ended',
        start: { file: 'cases/ny-open-ended.ics' },
        steps: [
          {
            kind: 'edit',
            name: 'generated-tz-grow',
            changes: (calendar, zones) => [
              addEvent({ uid: uuid('generated-tz-grow 2031'), summary: 'Conference', start: '2031-04-14T09:00', end: '2031-04-14T17:00', zone: 'America/New_York' }, calendar, zones),
            ],
            expansions: both(year(2031)),
          },
          {
            kind: 'edit',
            name: 'generated-tz-grow-2005',
            changes: (calendar, zones) => [
              addEvent({ uid: uuid('generated-tz-grow 2005'), summary: 'Old kickoff', start: '2005-01-10T09:00', end: '2005-01-10T10:00', zone: 'America/New_York' }, calendar, zones),
            ],
            expansions: both(year(2005)),
          },
        ],
      },
    ],
  },
  {
    file: 'edits/outlook-edit-one.json',
    description:
      'cases/outlook-publish.ics with one event\'s title changed in Thirteen (SEQUENCE incremented, LAST-MODIFIED set): only that UID group is re-serialized (the properties of untouched fields as read); every other group, the Windows zone ids and Outlook\'s VTIMEZONE stay byte for byte.',
    scenarios: [
      {
        name: 'Rename the budget review',
        calendarId: 'outlook-publish',
        start: { file: 'cases/outlook-publish.ics' },
        steps: [{ kind: 'edit', name: 'outlook-edit-one', changes: (calendar) => [editMaster(calendar, OUTLOOK_BUDGET_UID, { summary: 'Budget review with Marta' }, ICS_NOW)] }],
      },
    ],
  },
  {
    file: 'edits/own-time-rdate.json',
    description:
      'The Consultation series of cases/rrule-rdate.ics: weekly at 09:00 with an RDATE at 15:00 on Monday, November 2, a day the rule also produces (both are read). "Delete this event only" on the 15:00 occurrence adds EXDATE;TZID=Europe/Tallinn:20261102T150000 (the 09:00 occurrence stays); then a retime of the series to 10:00 (retimeExceptions, minuteDelta 60) rewrites that EXDATE and the RDATE to 16:00, the PERIOD RDATE to 15:00 and the EXDATE at the series time to 10:00.',
    scenarios: [
      {
        name: 'Delete the 15:00 occurrence, then move the series to 10:00',
        calendarId: 'rrule-rdate',
        start: { file: 'cases/rrule-rdate.ics' },
        steps: [
          {
            kind: 'edit',
            name: 'own-time-rdate',
            changes: (calendar) => {
              const master = calendar.groups.find((g) => g.uid === OWN_TIME_UID)!.master!;
              return [editMaster(calendar, OWN_TIME_UID, { exdates: [...master.exdates, zoned('2026-11-02T15:00', TALLINN)].map(icsDateValueJson) }, ICS_NOW)];
            },
            expansions: [{ deviceZone: TALLINN, window: AUTUMN_2026 }],
          },
          {
            kind: 'edit',
            name: 'own-time-rdate-retimed',
            changes: (calendar, zones) => retimeChanges(calendar, OWN_TIME_UID, zoned('2026-10-19T10:00', TALLINN), zoned('2026-10-19T11:00', TALLINN), { minuteDelta: 60 }, zones, ICS_NOW),
            expansions: [{ deviceZone: TALLINN, window: AUTUMN_2026 }],
          },
        ],
      },
    ],
  },
  {
    file: 'edits/retime-until.json',
    description:
      'The Outlook-style choir series of cases/outlook-publish.ics (FLE Standard Time, UNTIL=20261116T170000Z at the last occurrence\'s start, November 16 at 19:00 in Tallinn) moved to 19:30: retimeExceptions lists its UNTIL, which becomes 20261116T215959Z (the end of November 16 there, so November 16 stays); every other byte of the rule and of the other groups stays as read. Then toggled to all-day (UNTIL=20261116, EXDATE;VALUE=DATE) and back to timed (a UTC end of day again).',
    scenarios: [
      {
        name: 'Move to 19:30, toggle to all-day, back to timed',
        calendarId: 'outlook-publish',
        start: { file: 'cases/outlook-publish.ics' },
        steps: [
          {
            kind: 'edit',
            name: 'retime-until',
            changes: (calendar, zones) => retimeChanges(calendar, OUTLOOK_CHOIR_UID, zoned('2026-10-19T19:30', FLE), zoned('2026-10-19T21:00', FLE), { minuteDelta: 30 }, zones, ICS_NOW),
            expansions: [{ deviceZone: TALLINN, window: AUTUMN_2026 }],
          },
          {
            kind: 'edit',
            name: 'retime-until-all-day',
            changes: (calendar, zones) => retimeChanges(calendar, OUTLOOK_CHOIR_UID, date('2026-10-19'), date('2026-10-20'), { allDay: 'to-all-day' }, zones, ICS_NOW),
            expansions: [{ deviceZone: TALLINN, window: AUTUMN_2026 }],
          },
          {
            kind: 'edit',
            name: 'retime-until-timed',
            changes: (calendar, zones) => retimeChanges(calendar, OUTLOOK_CHOIR_UID, zoned('2026-10-19T19:30', FLE), zoned('2026-10-19T21:00', FLE), { allDay: 'to-timed' }, zones, ICS_NOW),
            expansions: [{ deviceZone: TALLINN, window: AUTUMN_2026 }],
          },
        ],
      },
    ],
  },
  {
    file: 'edits/year-9999.json',
    description:
      'New all-day events at the end of the range (§3.1.1): one on 9999-12-31 (one day: no DTEND) and one from 9999-12-29 to 9999-12-31 (DURATION:P3D), both read back as ending 9999-12-31T24:00.',
    scenarios: [
      {
        name: 'Two events that end on the last day',
        calendarId: uuid('year-9999 calendar'),
        start: { new: { calendarId: uuid('year-9999 calendar'), name: 'The end', color: '#57534e' } },
        steps: [
          {
            kind: 'edit',
            name: 'year-9999',
            changes: (calendar, zones) => [
              addEvent({ uid: uuid('year-9999 last day'), summary: 'The last day', start: '9999-12-31' }, calendar, zones),
              addEvent({ uid: uuid('year-9999 last days'), summary: 'The last three days', start: '9999-12-29', end: '9999-12-31' }, calendar, zones),
            ],
            expansions: both(year(9999)),
          },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

function customizedFile(name: string, standard: string, daylight: string | null, summary: string, start: string, end: string): string {
  return crlf(
    vcalendar(
      ['METHOD:PUBLISH', 'PRODID:Microsoft Exchange Server 2010', 'VERSION:2.0', `X-WR-CALNAME:${name}`],
      customizedTimeZone(standard, daylight),
      vevent(
        'DESCRIPTION:\\n',
        `UID:${outlookUid(`customized ${summary}`)}`,
        `SUMMARY;LANGUAGE=en-US:${summary}`,
        `DTSTART;TZID=Customized Time Zone:${start}`,
        `DTEND;TZID=Customized Time Zone:${end}`,
        'CLASS:PUBLIC',
        'PRIORITY:5',
        'DTSTAMP:20261018T120000Z',
        'TRANSP:OPAQUE',
        'STATUS:CONFIRMED',
        'SEQUENCE:0',
        'X-MICROSOFT-CDO-BUSYSTATUS:BUSY',
      ),
    ),
  );
}

/** A Google export of two events first made in Thirteen (their UIDs kept), edited in Google or not since. */
function googleRoundtrip(): string {
  return crlf(
    vcalendar(
      ['PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Liis Kask', 'X-WR-TIMEZONE:Europe/Tallinn'],
      GOOGLE_TALLINN,
      vevent(
        'DTSTART;TZID=Europe/Tallinn:20261024T180000',
        'DTEND;TZID=Europe/Tallinn:20261024T210000',
        'DTSTAMP:20261019T064100Z',
        `UID:${uuid('baseline sauna')}`,
        'CREATED:20261010T080000Z',
        'LAST-MODIFIED:20261016T120000Z',
        'LOCATION:Kalma saun\\, Vana-Kalamaja 9a\\, Tallinn',
        'SEQUENCE:1',
        'STATUS:CONFIRMED',
        'SUMMARY:Sauna evening at Kalma',
        'TRANSP:OPAQUE',
      ),
      vevent(
        'DTSTART:20261027T150000Z',
        'DTEND:20261027T154500Z',
        'DTSTAMP:20261019T064100Z',
        `UID:${uuid('baseline piano')}`,
        'CREATED:20261010T080000Z',
        'LAST-MODIFIED:20261012T120000Z',
        'SEQUENCE:0',
        'STATUS:CONFIRMED',
        'SUMMARY:Piano lesson',
        'TRANSP:OPAQUE',
      ),
    ),
  );
}

/** Input files of the import procedures (besides `cases/`). */
export function importInputs(zones: ZoneResolver): Map<string, string> {
  return new Map([
    ['imports/baseline-google-newer.ics', googleSecret(2)],
    ['imports/baseline-google-older.ics', googleSecret(0)],
    ['imports/baseline-google-roundtrip.ics', googleRoundtrip()],
    [
      'imports/baseline-thirteen.ics',
      thirteenDocument(
        { calendarId: uuid('baseline thirteen calendar'), name: 'Liis', color: '#ea580c' },
        [
          { uid: uuid('baseline sauna'), summary: 'Sauna evening', start: '2026-10-24T18:00', end: '2026-10-24T21:00', zone: TALLINN, modified: '2026-10-10T08:00' },
          { uid: uuid('baseline piano'), summary: 'Piano lesson (bring the Czerny book)', start: '2026-10-27T17:00', end: '2026-10-27T17:45', zone: TALLINN, modified: '2026-10-18T08:00' },
        ],
        zones,
      ),
    ],
    ['imports/customized-tz-a.ics', customizedFile('Calendar', '+0530', null, 'Call with the Bengaluru team', '20261104T153000', '20261104T163000')],
    ['imports/customized-tz-b.ics', customizedFile('Calendar', '-0300', '-0200', 'Call with Nuuk', '20261105T100000', '20261105T110000')],
    ['imports/customized-tz-c.ics', customizedFile('Calendar', '+0530', null, 'Follow-up with the Bengaluru team', '20261111T153000', '20261111T163000')],
    [
      'imports/known-tz-target.ics',
      thirteenDocument(
        { calendarId: uuid('known-tz calendar'), name: 'Mine', color: '#ea580c' },
        [{ uid: uuid('known-tz coffee'), summary: 'Coffee with Kadri', start: '2026-10-22T09:00', end: '2026-10-22T09:30', zone: TALLINN, modified: '2026-10-15T07:00' }],
        zones,
      ),
    ],
    ['imports/override-only-newer.ics', overrideOnly(2)],
    ['imports/override-only-older.ics', overrideOnly(0)],
  ]);
}

const newCalendar = (seed: string, name: string, color: string) => ({ calendarId: uuid(seed), name, color });

export const IMPORT_SPECS: readonly ProcedureSpec[] = [
  {
    file: 'imports/baseline.json',
    description:
      'Import baselines (§2.17 step 3, §3.6). A Google export imported into a new calendar (each group gets X-THIRTEEN-IMPORTED-LAST-MODIFIED in its raw text), edited in Thirteen, then a newer export (its version is later than the baseline: it replaces the edited group) and an older one (unchanged). And a Google export over two events created in Thirteen with the same UIDs and no baseline: the newer version wins either way.',
    scenarios: [
      {
        name: 'A Google export imported, edited in Thirteen, then a newer and an older export',
        calendarId: uuid('baseline calendar'),
        start: { new: newCalendar('baseline calendar', 'Liis (Google)', '#2563eb') },
        steps: [
          { kind: 'import', name: 'baseline-1-import', file: 'cases/google-secret.ics' },
          {
            kind: 'edit',
            name: 'baseline-2-edit',
            changes: (calendar) => [editMaster(calendar, CHOIR_UID, { summary: 'Choir rehearsal (bring water)' }, ICS_NOW)],
          },
          { kind: 'import', name: 'baseline-3-newer', file: 'imports/baseline-google-newer.ics' },
          { kind: 'import', name: 'baseline-4-older', file: 'imports/baseline-google-older.ics' },
        ],
      },
      {
        name: 'A Google export over events created in Thirteen',
        calendarId: uuid('baseline thirteen calendar'),
        start: { file: 'imports/baseline-thirteen.ics' },
        steps: [{ kind: 'import', name: 'baseline-thirteen-1', file: 'imports/baseline-google-roundtrip.ics' }],
      },
    ],
  },
  {
    file: 'imports/customized-tz.json',
    description:
      'Two Outlook files whose different VTIMEZONEs are both named "Customized Time Zone" (UTC+05:30, and UTC-03:00 with DST), imported one after the other into one calendar: the second is renamed "Customized Time Zone (2)", its group re-serialized with the new TZID, and its event keeps its time. A third file with the same definition as the first shares it (nothing renamed, raw text kept).',
    scenarios: [
      {
        name: 'Three Outlook files into one calendar',
        calendarId: uuid('customized-tz calendar'),
        start: { new: newCalendar('customized-tz calendar', 'Outlook', '#2563eb') },
        steps: [
          { kind: 'import', name: 'customized-tz-1', file: 'imports/customized-tz-a.ics' },
          { kind: 'import', name: 'customized-tz-2', file: 'imports/customized-tz-b.ics' },
          { kind: 'import', name: 'customized-tz-3', file: 'imports/customized-tz-c.ics', expansions: both({ from: '2026-11-01T00:00', to: '2026-12-01T00:00' }) },
        ],
      },
    ],
  },
  {
    file: 'imports/known-tz.json',
    description:
      'Known zone ids are never renamed (§3.6). A calendar holding an event made in Thirteen in Europe/Tallinn (with its generated VTIMEZONE for 2026), then a Google export and an Apple export that both use Europe/Tallinn with their own, different VTIMEZONEs: nothing is renamed, every imported group is stored byte for byte (plus its baseline line), and the document keeps one Europe/Tallinn VTIMEZONE, Thirteen\'s, rebuilt for the years the imported events reach (2026-2027, then 2025-2027). The same imports into an empty calendar keep the Google file\'s VTIMEZONE.',
    scenarios: [
      {
        name: 'Into a calendar with a Thirteen event',
        calendarId: uuid('known-tz calendar'),
        start: { file: 'imports/known-tz-target.ics' },
        steps: [
          { kind: 'import', name: 'known-tz-1', file: 'cases/google-secret.ics' },
          { kind: 'import', name: 'known-tz-2', file: 'cases/icloud-export.ics' },
        ],
      },
      {
        name: 'Into an empty calendar',
        calendarId: uuid('known-tz empty calendar'),
        start: { new: newCalendar('known-tz empty calendar', 'Imported', '#16a34a') },
        steps: [
          { kind: 'import', name: 'known-tz-empty-1', file: 'cases/google-secret.ics' },
          { kind: 'import', name: 'known-tz-empty-2', file: 'cases/icloud-export.ics' },
        ],
      },
    ],
  },
  {
    file: 'imports/missing-uid.json',
    description: 'cases/missing-uid.ics imported twice into the same calendar: the derived UIDs come from the target calendar\'s id, so the second import finds both groups unchanged and adds nothing.',
    scenarios: [
      {
        name: 'The same file twice',
        calendarId: uuid('missing-uid calendar'),
        start: { new: newCalendar('missing-uid calendar', 'Bookings', '#d97706') },
        steps: [
          { kind: 'import', name: 'missing-uid-1', file: 'cases/missing-uid.ics' },
          { kind: 'import', name: 'missing-uid-2', file: 'cases/missing-uid.ics' },
        ],
      },
    ],
  },
  {
    file: 'imports/override-only.json',
    description:
      'An invited single instance (cases/override-only.ics: an override without its master). Imported on top of cases/google-secret.ics it merges into the stored master (the group counts as updated; the master stays byte for byte; the override carries its own baseline). After that override is edited in Thirteen, an older copy of the file is unchanged (the edit stays) and a newer one replaces it (the stored master byte for byte). Into an empty calendar it is stored as read, counted as added and shown as a single event (the orphan path).',
    scenarios: [
      {
        name: 'Merged into its master, edited, then an older and a newer copy',
        calendarId: uuid('override-only calendar'),
        start: { new: newCalendar('override-only calendar', 'Liis (Google)', '#2563eb') },
        steps: [
          { kind: 'import', name: 'override-only-1-series', file: 'cases/google-secret.ics' },
          { kind: 'import', name: 'override-only-2-merged', file: 'cases/override-only.ics', expansions: [{ deviceZone: TALLINN, window: AUTUMN_2026 }] },
          {
            kind: 'edit',
            name: 'override-only-3-edited',
            changes: (calendar) => [editOverride(calendar, CHOIR_UID, zoned('2026-11-09T19:00', TALLINN), { location: 'Kaarli kirik, choir room' }, ICS_NOW)],
          },
          { kind: 'import', name: 'override-only-4-older', file: 'imports/override-only-older.ics' },
          { kind: 'import', name: 'override-only-5-newer', file: 'imports/override-only-newer.ics', expansions: [{ deviceZone: TALLINN, window: AUTUMN_2026 }] },
        ],
      },
      {
        name: 'Into an empty calendar',
        calendarId: uuid('override-only empty calendar'),
        start: { new: newCalendar('override-only empty calendar', 'Invitations', '#9333ea') },
        steps: [{ kind: 'import', name: 'override-only-empty', file: 'cases/override-only.ics', expansions: both({ from: '2026-01-01T00:00', to: '2027-12-31T24:00' }) }],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/** A calendar of the restore set as the restore dialog lists it (§2.17). */
export interface RestoreCalendarJson {
  readonly file: string;
  readonly calendarId: string;
  readonly kind: 'local' | 'subscription';
  readonly name: string;
  readonly color: string;
  readonly subscription: { readonly url: string; readonly interval: string } | null;
  readonly groups: number;
}

export const RESTORE_ZIP = 'restore/Thirteen calendars 2026-10-19.zip';
const PERSONAL = newCalendar('restore personal', 'Personal', '#ea580c');
const WORK = newCalendar('restore work', 'Work', '#2563eb');
const HOLIDAYS = { ...newCalendar('restore holidays', 'Holidays in Estonia', '#57534e'), url: 'https://calendar.example.com/holidays/ee.ics', interval: 'P1D' };

const personalEvents = (older: boolean): ThirteenEventSpec[] => [
  older
    ? { uid: uuid('restore dentist'), summary: 'Dentist', location: 'Tartu mnt 1', start: '2026-10-21T09:00', end: '2026-10-21T09:45', zone: TALLINN, modified: '2026-10-01T08:00' }
    : { uid: uuid('restore dentist'), summary: 'Dentist', location: 'Tartu mnt 1', start: '2026-10-21T10:00', end: '2026-10-21T10:45', zone: TALLINN, modified: '2026-10-18T09:00', sequence: 1 },
  {
    uid: uuid('restore book club'),
    summary: 'Book club: Cotsworth',
    location: 'Raamatukoi',
    start: '2026-01-12T19:00',
    end: '2026-01-12T21:00',
    zone: TALLINN,
    recurrence: repeat({ kind: 'monthly', system: 'ifc', start: '2026-01-12' }),
    alarms: [displayAlarm(-60, 'Book club: Cotsworth')],
    modified: '2026-01-05T10:00',
  },
  { uid: uuid('restore sauna'), summary: 'Sauna', start: '2026-09-05T18:00', end: '2026-09-05T20:00', zone: TALLINN, recurrence: repeat('FREQ=WEEKLY'), modified: '2026-09-01T16:00' },
  ...(older
    ? [{ uid: uuid('restore piano'), summary: 'Piano lesson', start: '2026-10-24T11:00', end: '2026-10-24T11:45', zone: TALLINN, modified: '2026-09-20T12:00' }]
    : [{ uid: uuid('restore passport'), summary: 'Passport renewal', start: '2026-11-30', modified: '2026-10-02T07:30' }]),
];

function holidaysInEstonia(zones: ZoneResolver): string {
  const days: [string, string][] = [
    ['2026-01-01', "New Year's Day"],
    ['2026-02-24', 'Independence Day'],
    ['2026-04-03', 'Good Friday'],
    ['2026-04-05', 'Easter Sunday'],
    ['2026-05-01', 'Spring Day'],
    ['2026-05-24', 'Pentecost'],
    ['2026-06-23', 'Victory Day'],
    ['2026-06-24', 'Midsummer Day'],
    ['2026-08-20', 'Day of Restoration of Independence'],
    ['2026-12-24', 'Christmas Eve'],
    ['2026-12-25', 'Christmas Day'],
    ['2026-12-26', 'Boxing Day'],
    ['2027-01-01', "New Year's Day"],
    ['2027-02-24', 'Independence Day'],
    ['2027-03-26', 'Good Friday'],
    ['2027-03-28', 'Easter Sunday'],
  ];
  const next = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString().slice(0, 10).replaceAll('-', '');
  };
  const feed = crlf(
    vcalendar(
      ['PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Holidays in Estonia', 'X-WR-TIMEZONE:UTC', 'X-WR-CALDESC:Holidays and Observances in Estonia'],
      ...days.map(([d, name]) =>
        vevent(
          `DTSTART;VALUE=DATE:${d.replaceAll('-', '')}`,
          `DTEND;VALUE=DATE:${next(d)}`,
          'DTSTAMP:20261019T041500Z',
          `UID:${d.replaceAll('-', '')}_${googleId(`ee ${name} ${d}`)}@google.com`,
          'CLASS:PUBLIC',
          'CREATED:20250923T190415Z',
          'DESCRIPTION:Public holiday',
          'LAST-MODIFIED:20250923T190415Z',
          'SEQUENCE:0',
          'STATUS:CONFIRMED',
          `SUMMARY:${name}`,
          'TRANSP:TRANSPARENT',
        ),
      ),
    ),
  );
  // Exported as its last fetched copy with the calendar's name, color and id and the subscription's link and interval (§2.17).
  const fetched = parseICalendar(feed);
  const exported: IcsCalendar = {
    ...fetched,
    name: HOLIDAYS.name,
    color: HOLIDAYS.color,
    extra: [
      ...fetched.extra,
      { name: 'X-THIRTEEN-CALENDAR-ID', params: [], value: HOLIDAYS.calendarId },
      { name: 'X-THIRTEEN-SUBSCRIPTION-URL', params: [], value: HOLIDAYS.url },
      { name: 'X-THIRTEEN-SUBSCRIPTION-INTERVAL', params: [], value: HOLIDAYS.interval },
    ],
  };
  return serializeICalendar(exported, zones, { now: ICS_NOW });
}

/** The restore set: the three exported calendars and an earlier export of the first. */
export function restoreInputs(zones: ZoneResolver): Map<string, string> {
  return new Map([
    ['restore/Personal.ics', thirteenDocument(PERSONAL, personalEvents(false), zones)],
    [
      'restore/Work.ics',
      thirteenDocument(
        WORK,
        [
          { uid: uuid('restore sprint'), summary: 'Sprint planning', start: '2026-01-12T09:30', end: '2026-01-12T10:30', zone: TALLINN, recurrence: repeat('FREQ=WEEKLY;INTERVAL=2'), modified: '2026-01-08T12:00' },
          { uid: uuid('restore release'), summary: 'Release day', start: '2026-11-25', modified: '2026-10-12T14:00' },
        ],
        zones,
      ),
    ],
    ['restore/Holidays in Estonia.ics', holidaysInEstonia(zones)],
    ['restore/older.ics', thirteenDocument(PERSONAL, personalEvents(true), zones)],
  ]);
}

/** The calendars of the restore set, as the restore dialog lists them. */
export function restoreCalendars(files: ReadonlyMap<string, string>): RestoreCalendarJson[] {
  return [
    { file: 'restore/Personal.ics', ...PERSONAL, kind: 'local' as const, subscription: null },
    { file: 'restore/Work.ics', ...WORK, kind: 'local' as const, subscription: null },
    { file: 'restore/Holidays in Estonia.ics', calendarId: HOLIDAYS.calendarId, name: HOLIDAYS.name, color: HOLIDAYS.color, kind: 'subscription' as const, subscription: { url: HOLIDAYS.url, interval: HOLIDAYS.interval } },
  ].map((c) => ({ ...c, groups: parseICalendar(files.get(c.file)!).groups.length }));
}

/** The zip of the restore set: the three calendars in the export's order, dated at the export (09:41 in Tallinn). */
export function restoreZip(files: ReadonlyMap<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const entries = ['restore/Personal.ics', 'restore/Work.ics', 'restore/Holidays in Estonia.ics'].map((file) => ({ name: file.slice('restore/'.length), bytes: encoder.encode(files.get(file)!) }));
  return writeZip(entries, '2026-10-19T09:41');
}

export const RESTORE_SPEC: ProcedureSpec = {
  file: 'restore/restore.json',
  description:
    'Restore of Thirteen\'s own exports (§2.17 "Restore"): version against version, baselines ignored and none added, nothing deleted. Personal.ics restored into a store without it becomes a new calendar that keeps the file\'s id, name and color, with the file\'s groups; restored again, it leaves that one calendar unchanged. older.ics, an earlier export of the same calendar, restored over the calendar edited since: the Dentist event edited since is kept (counted as kept newer), the Piano lesson deleted since comes back, the Passport renewal created since stays.',
  scenarios: [
    {
      name: 'Personal.ics into a store without it, twice',
      calendarId: PERSONAL.calendarId,
      start: { new: PERSONAL },
      steps: [
        { kind: 'restore', name: 'personal-restored', file: 'restore/Personal.ics' },
        { kind: 'restore', name: 'personal-restored-twice', file: 'restore/Personal.ics' },
      ],
    },
    {
      name: 'older.ics over the calendar edited since',
      calendarId: PERSONAL.calendarId,
      start: { file: 'restore/Personal.ics' },
      steps: [{ kind: 'restore', name: 'older-restored', file: 'restore/older.ics', expansions: [{ deviceZone: TALLINN, window: { from: '2026-10-19T00:00', to: '2026-11-02T00:00' } }] }],
    },
  ],
};

