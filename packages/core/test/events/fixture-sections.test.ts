/**
 * The C1 sections of fixtures/events.json (docs/EVENTS.md §5.5), built by
 * scripts/events-fixtures.ts for task C6 to write. Checks that the builders are
 * deterministic, have the documented shapes and exact counts, carry the values
 * the spec states, and that a port decoding only the JSON reproduces every
 * expected value (the parity test each port runs).
 */
import { describe, expect, it } from 'vitest';
import {
  C1_SECTIONS,
  NEW_DRAFT_CALENDAR_ID,
  type ZoneMathCase,
  alarmJson,
  dateFromJson,
  draftFromJson,
  draftJson,
  localFromJson,
  localJson,
  recurrenceFromJson,
  recurrenceJson,
} from '../../scripts/events-fixtures.ts';
import { syntheticZoneResolver } from '../../scripts/zone-resolvers.ts';
import {
  type LocalDateTime,
  addMinutesLocal,
  alarmPresets,
  applyToSeries,
  displayEnd,
  formatLocalDateTime,
  mergeDraft,
  newEventDraft,
  normalizeEventEnd,
  occurrenceDays,
  parseRRule,
  tryParseLocalDateTime,
  utcToZoned,
  validateDraft,
  zonedToUtc,
} from '../../src/events/index.ts';
import { expandRecurrence } from '../../src/events/recurrence.ts';
import { toISODate } from '../../src/index.ts';

const sections = Object.fromEntries(Object.entries(C1_SECTIONS).map(([name, build]) => [name, build()])) as {
  [K in keyof typeof C1_SECTIONS]: ReturnType<(typeof C1_SECTIONS)[K]>;
};
/** Each section as a port reads it: through JSON text. */
const json = JSON.parse(JSON.stringify(sections)) as typeof sections;

function attempt<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
const text = (value: LocalDateTime | null) => (value === null ? null : formatLocalDateTime(value));

describe('C1 fixture sections', () => {
  it('are listed in publication order (§6.0)', () => {
    expect(Object.keys(C1_SECTIONS)).toEqual([
      'localDateTimes',
      'endForms',
      'wallClock',
      'zoneMath',
      'drafts',
      'newDrafts',
      'merges',
      'seriesEdits',
      'alarms',
    ]);
  });

  it('are deterministic and plain JSON', () => {
    for (const [name, build] of Object.entries(C1_SECTIONS)) {
      expect(JSON.stringify(build()), name).toBe(JSON.stringify(sections[name as keyof typeof sections]));
    }
    expect(json).toEqual(sections);
  });

  it('have exact case counts (C6 writes them to `counts`)', () => {
    expect(Object.fromEntries(Object.entries(sections).map(([name, cases]) => [name, cases.length]))).toEqual({
      localDateTimes: 29,
      endForms: 19,
      wallClock: 21,
      zoneMath: 36,
      drafts: 79,
      newDrafts: 19,
      merges: 15,
      seriesEdits: 12,
      alarms: 8,
    });
  });

  it('use the documented field names in order', () => {
    const keys = (value: object) => Object.keys(value);
    for (const c of sections.localDateTimes) expect(keys(c)).toEqual(['text', 'valid', 'formatted']);
    for (const c of sections.endForms) expect(keys(c)).toEqual(['start', 'end', 'normalized', 'days', 'display']);
    for (const c of sections.wallClock) expect(keys(c)).toEqual(['from', 'minutes', 'expected']);
    for (const c of sections.zoneMath) {
      expect([['zone', 'local', 'expected'], ['zone', 'utc', 'expected']]).toContainEqual(keys(c));
      expect(keys(c.zone)).toEqual(['name', 'offset', 'transitions']);
    }
    const draftKeys = ['title', 'location', 'notes', 'url', 'allDay', 'start', 'end', 'timeZone', 'calendarId', 'recurrence', 'alarms', 'availability'];
    for (const c of sections.drafts) {
      expect(keys(c)).toEqual(['draft', 'calendar', 'issues']);
      expect(keys(c.draft)).toEqual(draftKeys);
      expect(keys(c.calendar)).toEqual([
        'id',
        'title',
        'color',
        'accountId',
        'accountTitle',
        'accountKind',
        'writable',
        'thirteenRepeats',
        'maxAlarms',
        'supportsAvailability',
        'supportsUrl',
        'isPlatformDefault',
      ]);
      if (c.draft.recurrence !== null) expect(keys(c.draft.recurrence)).toEqual(['rule', 'end', 'extraDates', 'exceptDates']);
    }
    for (const c of sections.newDrafts) {
      expect(keys(c)).toEqual(['day', 'now', 'allDay', 'expected']);
      expect(keys(c.expected)).toEqual(draftKeys);
    }
    for (const c of sections.merges) {
      expect(keys(c)).toEqual(['original', 'edited', 'current', 'expected']);
      expect(keys(c.expected)).toEqual(['merged', 'written', 'conflicts']);
    }
    for (const c of sections.seriesEdits) {
      expect(keys(c)).toEqual(['master', 'opened', 'edited', 'override', 'expected']);
      expect(keys(c.expected)).toEqual(['master', 'override', 'written', 'retime']);
      for (const d of [c.master, c.opened, c.edited, c.override, c.expected.master, c.expected.override]) if (d !== null) expect(keys(d)).toEqual(draftKeys);
      if (c.expected.retime !== null) expect(keys(c.expected.retime)).toEqual(['minuteDelta', 'allDay']);
    }
    for (const c of sections.alarms) {
      expect(keys(c)).toEqual(['allDay', 'allowAfterStart', 'use24Hour', 'presets']);
      for (const p of c.presets) expect(keys(p)).toEqual(['id', 'label', 'alarm']);
    }
  });

  it('cover every case the spec lists (§5.5)', () => {
    const issues = new Set(sections.drafts.flatMap((c) => c.issues));
    expect([...issues].sort()).toEqual(
      [
        'end-before-start',
        'out-of-range',
        'until-before-start',
        'calendar-read-only',
        'thirteen-repeat-not-allowed',
        'too-many-alarms',
        'repeat-not-on-start',
        'invalid-url',
        'count-out-of-range',
      ].sort(),
    );
    expect(sections.drafts.some((c) => c.issues.length === 0)).toBe(true);
    // The drag check of §2.11: IFC March 3 yearly moved to March 4 on a gregorian-only calendar.
    expect(
      sections.drafts.filter(
        (c) =>
          c.calendar.thirteenRepeats === 'gregorian-only' &&
          c.draft.start === '2026-03-01T19:00' &&
          c.draft.alarms.length === 1 &&
          JSON.stringify(c.draft.recurrence?.rule) === JSON.stringify({ kind: 'thirteen', rule: { kind: 'yearly', system: 'ifc', month: 3, day: 4 } }),
      ).map((c) => c.issues),
    ).toEqual([['thirteen-repeat-not-allowed']]);
    expect(sections.drafts.filter((c) => c.issues.length >= 8)).toHaveLength(2);
    expect(new Set(sections.zoneMath.map((c) => c.zone.name)).size).toBe(6);
    expect(sections.zoneMath.filter((c) => c.expected === null).length).toBeGreaterThanOrEqual(4);
    expect(new Set(sections.merges.flatMap((c) => c.expected.conflicts))).toEqual(
      new Set(['title', 'recurrence', 'alarms', 'availability', 'time']),
    );
  });

  it('carry the values the spec states', () => {
    const local = (t: string) => sections.localDateTimes.find((c) => c.text === t);
    expect(local('2026-10-19T24:00')).toEqual({ text: '2026-10-19T24:00', valid: true, formatted: '2026-10-19T24:00' });
    for (const t of ['2026-10-19T24:01', '2026-10-19T25:00', '2026-02-29T10:00', '10000-01-01T00:00', '0000-12-31T00:00']) {
      expect(local(t)).toEqual({ text: t, valid: false, formatted: null });
    }
    const end = (start: string, endText: string) => sections.endForms.find((c) => c.start === start && c.end === endText);
    expect(end('2026-10-19T23:00', '2026-10-20T00:00')).toEqual({
      start: '2026-10-19T23:00',
      end: '2026-10-20T00:00',
      normalized: '2026-10-19T24:00',
      days: ['2026-10-19'],
      display: '2026-10-20T00:00',
    });
    expect(end('9999-12-31T00:00', '9999-12-31T24:00')).toMatchObject({ normalized: '9999-12-31T24:00', days: ['9999-12-31'], display: null });
    expect(end('2026-10-19T22:00', '2026-10-20T01:30')?.days).toEqual(['2026-10-19', '2026-10-20']);
    expect(end('2026-10-19T10:00', '2026-10-19T09:00')).toMatchObject({ normalized: null, days: null, display: '2026-10-19T09:00' });
    expect(end('2026-10-19T24:00', '2026-10-20T01:00')).toMatchObject({ normalized: null, days: null });
    const wall = (from: string, minutes: number) => sections.wallClock.find((c) => c.from === from && c.minutes === minutes)?.expected;
    expect(wall('2026-12-31T12:00', 1440)).toBe('2027-01-01T12:00');
    expect(wall('2024-06-16T12:00', 1440)).toBe('2024-06-17T12:00');
    expect(wall('2026-10-19T23:30', 30)).toBe('2026-10-20T00:00');
    expect(wall('9999-12-31T23:00', 60)).toBeNull();
    const zone = (name: string, local: string) =>
      sections.zoneMath.find((c) => c.zone.name === name && 'local' in c && c.local === local)?.expected;
    expect(zone('Test/Europe', '2026-03-29T03:30')).toBe('2026-03-29T01:30');
    expect(zone('Test/Europe', '2026-10-25T03:30')).toBe('2026-10-25T00:30');
    expect(zone('Test/HalfHour', '2026-10-04T02:15')).toBe('2026-10-03T15:45');
    expect(zone('Test/SkippedDay', '2011-12-30T09:00')).toBe('2011-12-30T19:00');
    expect(zone('Test/Midnight', '2018-11-04T00:00')).toBe('2018-11-04T03:00');
    expect(zone('Test/East', '0001-01-01T13:59')).toBeNull();
    expect(zone('Test/West', '9999-12-31T12:00')).toBeNull();
    const fresh = (day: string, now: string, allDay: boolean) =>
      sections.newDrafts.find((c) => c.day === day && c.now === now && c.allDay === allDay)?.expected;
    expect(fresh('2026-10-19', '2026-10-19T10:20', false)).toMatchObject({ start: '2026-10-19T11:00', end: '2026-10-19T12:00', availability: 'busy' });
    expect(fresh('2026-10-19', '2026-10-19T23:30', false)).toMatchObject({ start: '2026-10-19T23:00', end: '2026-10-19T24:00' });
    expect(fresh('2026-10-20', '2026-10-19T10:20', false)).toMatchObject({ start: '2026-10-20T09:00', end: '2026-10-20T10:00' });
    expect(fresh('2026-10-19', '2026-10-19T10:20', true)).toMatchObject({
      start: '2026-10-19T00:00',
      end: '2026-10-19T24:00',
      timeZone: null,
      availability: 'free',
    });
    for (const c of sections.newDrafts) expect(c.expected.calendarId).toBe(NEW_DRAFT_CALENDAR_ID);
    const timed24 = sections.alarms.find((c) => !c.allDay && c.use24Hour && c.allowAfterStart)!;
    expect(timed24.presets.map((p) => p.label)).toContain('At time of event');
    const allDay12 = sections.alarms.find((c) => c.allDay && !c.use24Hour && c.allowAfterStart)!;
    expect(allDay12.presets.map((p) => p.label)).toEqual([
      'None',
      'On the day at 9:00 AM',
      '1 day before at 9:00 AM',
      '2 days before at 9:00 AM',
      '1 week before at 9:00 AM',
    ]);
  });

  it('seriesEdits: "Save for all events" keeps the first date of the master (§4.7)', () => {
    const edits = sections.seriesEdits;
    for (const c of edits) {
      expect(c.expected.master.start.slice(0, 10), JSON.stringify(c.edited)).toBe(c.master.start.slice(0, 10));
      expect(c.expected.master.recurrence).toEqual(c.master.recurrence);
    }
    // 19:00 to 19:30 on the 5th occurrence (Monday, May 13, 2030) of the week 20 series.
    expect(edits[0]!.opened.start).toBe('2030-05-13T19:00');
    expect(edits[0]!.master.recurrence?.rule).toEqual({
      kind: 'foreign',
      rules: [{ rrule: 'FREQ=YEARLY;BYDAY=MO;BYWEEKNO=20', end: { kind: 'never' } }],
      exrules: [],
    });
    const window = { from: dateFromJson('2026-01-01'), to: dateFromJson('2030-12-31') };
    const fifth = expandRecurrence(recurrenceFromJson(edits[0]!.master.recurrence!), dateFromJson('2026-05-11'), window).occurrences[4]!;
    expect(toISODate(fifth.date)).toBe('2030-05-13');
    expect(edits[0]!.expected).toMatchObject({
      master: { start: '2026-05-11T19:30', end: '2026-05-11T20:30' },
      override: null,
      written: ['time'],
      retime: { minuteDelta: 30, allDay: null },
    });
    // The same edit on an override at 20:00: 19:30 absolute, not 20:00 minus 30 minutes.
    expect(edits[1]!.override).toMatchObject({ start: '2030-05-13T20:00', recurrence: null });
    expect(edits[1]!.expected).toMatchObject({
      master: { start: '2026-05-11T19:30', end: '2026-05-11T20:30' },
      override: { start: '2030-05-13T19:30', end: '2030-05-13T20:30', recurrence: null },
      retime: { minuteDelta: 30, allDay: null },
    });
    // All-day toggles both ways.
    expect(edits[2]!.expected).toMatchObject({
      master: { allDay: true, start: '2026-05-11T00:00', end: '2026-05-11T24:00', timeZone: null },
      retime: { minuteDelta: -1140, allDay: 'to-all-day' },
    });
    expect(edits[3]!.expected).toMatchObject({
      master: { allDay: false, start: '2026-05-11T10:00', end: '2026-05-11T11:00', timeZone: 'Europe/Tallinn' },
      retime: { minuteDelta: 600, allDay: 'to-timed' },
    });
    // Lengths, the zone and a time across midnight.
    expect(edits[4]!.expected).toMatchObject({ master: { end: '2026-05-11T21:15' }, written: ['time'], retime: { minuteDelta: 0, allDay: null } });
    expect(edits[5]!.expected.master).toMatchObject({ start: '2026-05-11T00:00', end: '2026-05-12T24:00' });
    expect(edits[6]!.expected).toMatchObject({ master: { start: '2026-05-11T19:00', timeZone: 'Europe/Helsinki' }, retime: { minuteDelta: 0 } });
    expect(edits[7]!.expected).toMatchObject({ master: { start: '2026-05-11T23:30', end: '2026-05-12T00:30' }, retime: { minuteDelta: 270 } });
    // A title change on the override occurrence: both get it, each keeps its own time; no retime.
    expect(edits[8]!.expected).toMatchObject({
      master: { title: 'Annual board meeting', start: '2026-05-11T19:00' },
      override: { title: 'Annual board meeting', start: '2030-05-13T20:00' },
      written: ['title'],
      retime: null,
    });
    expect(edits[9]!.expected).toMatchObject({ master: { title: 'Annual board meeting', start: '2026-05-11T19:00' }, retime: null });
    // A change made elsewhere to the master's notes is kept; only the location is written.
    expect(edits[10]!.expected).toMatchObject({
      master: { notes: 'Agenda in the shared folder.', location: 'Room Luna' },
      written: ['location'],
      retime: null,
    });
    expect(edits[11]!.expected).toMatchObject({ master: { calendarId: 'home', alarms: [{ kind: 'relative', offsetMinutes: -60 }] }, written: ['calendar', 'alarms'] });
  });

  it('replay from the JSON alone, as every port does', () => {
    for (const c of json.localDateTimes) {
      const parsed = tryParseLocalDateTime(c.text);
      expect({ valid: parsed !== null, formatted: text(parsed) }).toEqual({ valid: c.valid, formatted: c.formatted });
    }
    for (const c of json.endForms) {
      const start = localFromJson(c.start);
      const end = localFromJson(c.end);
      expect(text(attempt(() => normalizeEventEnd(start, end)))).toBe(c.normalized);
      expect(attempt(() => occurrenceDays(start, end).map(toISODate))).toEqual(c.days);
      expect(text(attempt(() => displayEnd(end)))).toBe(c.display);
    }
    for (const c of json.wallClock) {
      expect(text(attempt(() => addMinutesLocal(localFromJson(c.from), c.minutes)))).toBe(c.expected);
    }
    for (const c of json.zoneMath as ZoneMathCase[]) {
      const zones = syntheticZoneResolver(c.zone);
      const result =
        'local' in c ? zonedToUtc(localFromJson(c.local), c.zone.name, zones) : utcToZoned(localFromJson(c.utc), c.zone.name, zones);
      expect(text(result)).toBe(c.expected);
    }
    for (const c of json.drafts) expect(validateDraft(draftFromJson(c.draft), c.calendar)).toEqual(c.issues);
    for (const c of json.newDrafts) {
      const draft = newEventDraft(dateFromJson(c.day), localFromJson(c.now), NEW_DRAFT_CALENDAR_ID, { allDay: c.allDay });
      expect(draftJson(draft)).toEqual(c.expected);
    }
    for (const c of json.merges) {
      const { merged, written, conflicts } = mergeDraft(draftFromJson(c.original), draftFromJson(c.edited), draftFromJson(c.current));
      expect({ merged: draftJson(merged), written, conflicts }).toEqual(c.expected);
    }
    for (const c of json.seriesEdits) {
      const result = applyToSeries(
        draftFromJson(c.master),
        draftFromJson(c.opened),
        draftFromJson(c.edited),
        c.override === null ? null : draftFromJson(c.override),
      );
      expect({
        master: draftJson(result.master),
        override: result.override === null ? null : draftJson(result.override),
        written: result.written,
        retime: result.retime,
      }).toEqual(c.expected);
    }
    for (const c of json.alarms) {
      const presets = alarmPresets(c.allDay, { allowAfterStart: c.allowAfterStart, use24Hour: c.use24Hour });
      expect(presets.map((p) => ({ id: p.id, label: p.label, alarm: p.alarm === null ? null : alarmJson(p.alarm) }))).toEqual(c.presets);
    }
  });

  it('contain no em or en dash and stay small', () => {
    const all = JSON.stringify(sections);
    expect(all).not.toMatch(/[\u2013\u2014]/);
    expect(Buffer.byteLength(all)).toBeLessThan(140 * 1000);
  });
});

describe('JSON forms', () => {
  it('round-trip drafts', () => {
    for (const c of sections.drafts) expect(draftJson(draftFromJson(c.draft))).toEqual(c.draft);
  });

  it('write times as text and extra dates compactly', () => {
    expect(localJson(localFromJson('2026-10-19T24:00'))).toBe('2026-10-19T24:00');
    expect(alarmJson({ kind: 'absolute', at: localFromJson('2026-10-19T08:00') })).toEqual({ kind: 'absolute', at: '2026-10-19T08:00' });
    const recurrence = recurrenceJson({
      rule: { kind: 'dates' },
      end: { kind: 'until', date: dateFromJson('2027-06-30') },
      extraDates: [
        { date: dateFromJson('2026-11-02'), minute: null, durationMinutes: null },
        { date: dateFromJson('2026-11-03'), minute: 600, durationMinutes: 90 },
      ],
      exceptDates: [{ date: dateFromJson('2026-11-16'), minute: null }, { date: dateFromJson('2026-11-17'), minute: 900 }],
    });
    expect(recurrence).toEqual({
      rule: { kind: 'dates' },
      end: { kind: 'until', date: '2027-06-30' },
      extraDates: ['2026-11-02', { date: '2026-11-03', minute: 600, durationMinutes: 90 }],
      exceptDates: ['2026-11-16', { date: '2026-11-17', minute: 900 }],
    });
  });

  it('write RRule rules as their canonical text and read them back', () => {
    const json = {
      rule: { kind: 'rrule', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO' },
      end: { kind: 'count', count: 10 },
      extraDates: [],
      exceptDates: [],
    } as const;
    const recurrence = recurrenceFromJson(json);
    expect(recurrence.rule).toEqual({ kind: 'rrule', rrule: parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO') });
    expect(recurrenceJson(recurrence)).toEqual(json);
    expect(recurrenceJson(recurrenceFromJson({ ...json, rule: { kind: 'rrule', rrule: 'byday=mo;freq=weekly;interval=2' } }))).toEqual(json);
    const foreign = {
      rule: {
        kind: 'foreign',
        rules: [
          { rrule: 'FREQ=WEEKLY;BYDAY=MO', end: { kind: 'count', count: 3 } },
          { rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', end: { kind: 'until', date: '2027-06-30' } },
        ],
        exrules: [{ rrule: 'FREQ=YEARLY;BYMONTH=12', end: { kind: 'never' } }],
      },
      end: { kind: 'never' },
      extraDates: ['2026-11-02'],
      exceptDates: [],
    } as const;
    expect(recurrenceJson(recurrenceFromJson(foreign))).toEqual(foreign);
  });
});
