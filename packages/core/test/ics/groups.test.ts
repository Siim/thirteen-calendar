/**
 * Group and calendar operations of the `.ics` module (docs/EVENTS.md §2.17,
 * §3.6, §5.4): replacing groups, versions, import baselines and colliding
 * `VTIMEZONE` names.
 */
import { describe, expect, it } from 'vitest';
import {
  type IcsCalendar,
  type IcsGroup,
  eventVersion,
  groupVersion,
  mergeTimeZones,
  newICalendar,
  parseICalendar,
  removeGroup,
  renameCollidingTimeZones,
  replaceGroup,
  serializeICalendar,
  withImportBaseline,
} from '../../src/ics/index.ts';
import { FLE_VTIMEZONE, L, TALLINN_VTIMEZONE, calendar, crlf, vevent, zones } from './helpers.ts';

const THREE = calendar(
  ...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=DAILY', 'SUMMARY:A'),
  ...vevent('UID:b', 'DTSTART;VALUE=DATE:20261020', 'SUMMARY:B'),
  ...vevent('UID:a', 'RECURRENCE-ID;VALUE=DATE:20261021', 'DTSTART;VALUE=DATE:20261022', 'SUMMARY:A moved'),
  ...vevent('UID:c', 'DTSTART;VALUE=DATE:20261023', 'SUMMARY:C'),
);

const summaries = (text: string) => [...text.matchAll(/^SUMMARY:(.*)$/gm)].map((m) => m[1]!.trim());

describe('replaceGroup and removeGroup', () => {
  it('keeps the members in place and writes new members after their group', () => {
    const cal = parseICalendar(THREE);
    const a = cal.groups[0]!;
    const added = { ...a.overrides[0]!, recurrenceId: { kind: 'date' as const, date: { year: 2026, month: 10, day: 25 } }, summary: 'A new override', line: null, raw: null, original: null };
    const edited: IcsGroup = { uid: 'a', master: { ...a.master!, summary: 'A edited' }, overrides: [a.overrides[0]!, added] };
    const next = replaceGroup(cal, edited);
    expect(next.groups.map((g) => g.uid)).toEqual(['a', 'b', 'c']);
    expect(next.groups[0]!.master!.raw).toBeNull();
    expect(next.groups[0]!.master!.line).toBe(4);
    expect(next.groups[0]!.overrides.map((o) => o.line)).toEqual([15, null]);
    expect(summaries(serializeICalendar(next, zones))).toEqual(['A edited', 'B', 'A moved', 'A new override', 'C']);
    // Untouched groups are copied byte for byte.
    const text = serializeICalendar(next, zones);
    expect(text).toContain(cal.groups[1]!.master!.raw!);
    expect(text).toContain(cal.groups[2]!.master!.raw!);
  });

  it('appends a new group at the end and forgets the lines of another text', () => {
    const cal = parseICalendar(THREE);
    const incoming = parseICalendar(calendar(...vevent('UID:d', 'DTSTART;VALUE=DATE:20261024', 'SUMMARY:D'))).groups[0]!;
    const next = replaceGroup(cal, incoming, { keepRaw: true });
    expect(next.groups.map((g) => g.uid)).toEqual(['a', 'b', 'c', 'd']);
    expect(next.groups[3]!.master!.line).toBeNull();
    expect(next.groups[3]!.master!.raw).toBe(incoming.master!.raw);
    expect(summaries(serializeICalendar(next, zones))).toEqual(['A', 'B', 'A moved', 'C', 'D']);
  });

  it('replaces every group of a UID (duplicate masters) and removes a UID with an empty group', () => {
    const cal = parseICalendar(calendar(...vevent('UID:x', 'DTSTART;VALUE=DATE:20261019', 'SUMMARY:1'), ...vevent('UID:y', 'DTSTART;VALUE=DATE:20261019'), ...vevent('UID:x', 'DTSTART;VALUE=DATE:20261020', 'SUMMARY:2')));
    expect(cal.groups.map((g) => g.uid)).toEqual(['x', 'y', 'x']);
    const one = replaceGroup(cal, cal.groups[2]!, { keepRaw: true });
    expect(one.groups.map((g) => [g.uid, g.master!.summary])).toEqual([
      ['x', '2'],
      ['y', ''],
    ]);
    expect(replaceGroup(cal, { uid: 'x', master: null, overrides: [] }).groups.map((g) => g.uid)).toEqual(['y']);
    expect(removeGroup(cal, 'y').groups.map((g) => g.uid)).toEqual(['x', 'x']);
    expect(removeGroup(cal, 'nope')).toEqual(cal);
  });

  it('rejects malformed groups', () => {
    const cal = parseICalendar(THREE);
    const a = cal.groups[0]!;
    expect(() => replaceGroup(cal, { ...a, uid: 'other' })).toThrow(RangeError);
    expect(() => replaceGroup(cal, { uid: 'a', master: a.overrides[0]!, overrides: [] })).toThrow(RangeError);
    expect(() => replaceGroup(cal, { uid: 'a', master: null, overrides: [a.master!] })).toThrow(RangeError);
    expect(() => replaceGroup(cal, { uid: '', master: null, overrides: [] })).toThrow(RangeError);
    expect(() => replaceGroup(cal, a, { keepRaw: 'yes' } as never)).toThrow(RangeError);
  });
});

describe('versions', () => {
  const group = (...members: string[][]) => parseICalendar(calendar(...members.flat())).groups[0]!;

  it('prefers the newest LAST-MODIFIED of the group, else the newest DTSTAMP', () => {
    const g = group(
      vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'LAST-MODIFIED:20261001T100000Z', 'DTSTAMP:20261010T100000Z'),
      vevent('UID:a', 'RECURRENCE-ID;VALUE=DATE:20261020', 'DTSTART;VALUE=DATE:20261020', 'LAST-MODIFIED:20261005T100000Z'),
    );
    expect(groupVersion(g)).toEqual(L('2026-10-05T10:00'));
    expect(eventVersion(g.master!)).toEqual(L('2026-10-01T10:00'));
    const stamps = group(vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'DTSTAMP:20261010T100000Z'), vevent('UID:a', 'RECURRENCE-ID;VALUE=DATE:20261020', 'DTSTART;VALUE=DATE:20261020', 'DTSTAMP:20261012T100000'));
    expect(groupVersion(stamps)).toEqual(L('2026-10-12T10:00'));
    expect(groupVersion(group(vevent('UID:a', 'DTSTART;VALUE=DATE:20261019')))).toBeNull();
    expect(eventVersion(group(vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'DTSTAMP;VALUE=DATE:20261019')).master!)).toEqual(L('2026-10-19T00:00'));
  });
});

describe('withImportBaseline', () => {
  it('inserts the line before END:VEVENT of the master, replacing an earlier one, every other byte as read', () => {
    const text = calendar(
      ...vevent('UID:a', 'DTSTART;VALUE=DATE:20261019', 'X-THIRTEEN-IMPORTED-LAST-MODIFIED:20200101T000000Z', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT5M', 'END:VALARM'),
      ...vevent('UID:a', 'RECURRENCE-ID;VALUE=DATE:20261020', 'DTSTART;VALUE=DATE:20261021'),
    );
    const g = withImportBaseline(parseICalendar(text).groups[0]!, L('2026-10-05T10:00'));
    expect(g.master!.raw).toBe(crlf('BEGIN:VEVENT', 'UID:a', 'DTSTART;VALUE=DATE:20261019', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT5M', 'END:VALARM', 'X-THIRTEEN-IMPORTED-LAST-MODIFIED:20261005T100000Z', 'END:VEVENT'));
    expect(g.master!.original).toBe(g.master!.raw);
    expect(g.master!.importedLastModified).toEqual({ kind: 'utc', value: L('2026-10-05T10:00') });
    expect(g.overrides[0]!.raw).toBe(parseICalendar(text).groups[0]!.overrides[0]!.raw);
    // Read back from the stored text.
    const stored = serializeICalendar(replaceGroup(newICalendar({ calendarId: 'c', name: 'C', color: '#000000' }), g, { keepRaw: true }), zones);
    expect(parseICalendar(stored).groups[0]!.master!.importedLastModified).toEqual({ kind: 'utc', value: L('2026-10-05T10:00') });
  });

  it('gives each override of a group without a master its own version', () => {
    const cal = parseICalendar(
      calendar(
        ...vevent('UID:inv', 'RECURRENCE-ID:20261020T090000Z', 'DTSTART:20261020T100000Z', 'LAST-MODIFIED:20261003T080000Z'),
        ...vevent('UID:inv', 'RECURRENCE-ID:20261027T090000Z', 'DTSTART:20261027T100000Z', 'DTSTAMP:20261004T080000Z'),
        ...vevent('UID:inv', 'RECURRENCE-ID:20261103T090000Z', 'DTSTART:20261103T100000Z'),
      ),
    );
    const g = withImportBaseline(cal.groups[0]!, L('2026-10-09T00:00'));
    expect(g.master).toBeNull();
    expect(g.overrides.map((o) => o.raw!.split('\r\n').at(-3))).toEqual([
      'X-THIRTEEN-IMPORTED-LAST-MODIFIED:20261003T080000Z',
      'X-THIRTEEN-IMPORTED-LAST-MODIFIED:20261004T080000Z',
      'X-THIRTEEN-IMPORTED-LAST-MODIFIED:20261009T000000Z',
    ]);
  });
});

/** Two Outlook "Customized Time Zone" definitions (imports/customized-tz.json). */
const custom = (offset: string) => ['BEGIN:VTIMEZONE', 'TZID:Customized Time Zone', 'BEGIN:STANDARD', 'DTSTART:16010101T000000', `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`, 'END:STANDARD', 'END:VTIMEZONE'];
const customFile = (offset: string, uid: string) => calendar(...custom(offset), ...vevent(`UID:${uid}`, 'DTSTART;TZID=Customized Time Zone:20261019T090000', 'SUMMARY:x'));

/** The platform's import of every group of `file` into `target` (new UIDs only), as §2.17 and §3.6 describe it. */
function importInto(target: IcsCalendar, file: string): IcsCalendar {
  const incoming = renameCollidingTimeZones(target, parseICalendar(file), zones);
  let next = target;
  for (const group of incoming.groups) next = replaceGroup(next, withImportBaseline(group, groupVersion(group) ?? L('2026-01-01T00:00')), { keepRaw: true });
  return mergeTimeZones(next, incoming);
}

describe('renameCollidingTimeZones and mergeTimeZones', () => {
  it('renames a file-defined zone the target defines differently; a third file with the first definition shares it', () => {
    const empty = newICalendar({ calendarId: 'c', name: 'Imported', color: '#2563eb' });
    const first = importInto(empty, customFile('+0530', 'one'));
    const second = importInto(first, customFile('-0300', 'two'));
    expect(second.timeZones.map((t) => t.tzid)).toEqual(['Customized Time Zone', 'Customized Time Zone (2)']);
    expect(second.groups[1]!.master!.start).toMatchObject({ tzid: 'Customized Time Zone (2)' });
    expect(second.groups[1]!.master!.raw).toBeNull();
    expect(second.timeZones[1]!.raw).toBe(crlf(...custom('-0300')).replace('TZID:Customized Time Zone', 'TZID:Customized Time Zone (2)'));
    const third = importInto(second, customFile('+0530', 'three'));
    expect(third.timeZones.map((t) => t.tzid)).toEqual(['Customized Time Zone', 'Customized Time Zone (2)']);
    expect(third.groups[2]!.master!.raw).not.toBeNull();
    const fourth = importInto(third, customFile('-0300', 'four'));
    expect(fourth.groups[3]!.master!.start).toMatchObject({ tzid: 'Customized Time Zone (2)' });
    const fifth = importInto(fourth, customFile('+0100', 'five'));
    expect(fifth.timeZones.map((t) => t.tzid)).toEqual(['Customized Time Zone', 'Customized Time Zone (2)', 'Customized Time Zone (3)']);
    // The events keep their times (expanded through each file's own definition).
    const text = serializeICalendar(fifth, zones);
    const back = parseICalendar(text);
    expect(back.timeZones.map((t) => t.tzid)).toEqual(['Customized Time Zone', 'Customized Time Zone (2)', 'Customized Time Zone (3)']);
    expect(back.groups.map((g) => (g.master!.start as { tzid: string }).tzid)).toEqual([
      'Customized Time Zone',
      'Customized Time Zone (2)',
      'Customized Time Zone',
      'Customized Time Zone (2)',
      'Customized Time Zone (3)',
    ]);
  });

  it('never renames a known IANA or Windows id; the document keeps one definition (imports/known-tz.json)', () => {
    const thirteen = serializeICalendar(
      replaceGroup(newICalendar({ calendarId: 'c', name: 'Mine', color: '#ea580c' }), parseICalendar(calendar(...vevent('UID:mine', 'DTSTART;TZID=Europe/Tallinn:20261019T090000'))).groups[0]!),
      zones,
    );
    const target = parseICalendar(thirteen);
    const googleFile = calendar(...TALLINN_VTIMEZONE, ...vevent('UID:google', 'DTSTART;TZID=Europe/Tallinn:20261020T090000', 'DTSTAMP:20261001T000000Z'));
    const appleTallinn = ['BEGIN:VTIMEZONE', 'TZID:Europe/Tallinn', 'BEGIN:STANDARD', 'DTSTART:20011028T040000', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0200', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD', 'BEGIN:DAYLIGHT', 'DTSTART:20020331T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0300', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT', 'END:VTIMEZONE'];
    const appleFile = calendar(...appleTallinn, ...vevent('UID:apple', 'DTSTART;TZID=Europe/Tallinn:20261021T090000', 'DTSTAMP:20261001T000000Z'));
    const google = parseICalendar(googleFile);
    expect(renameCollidingTimeZones(target, google, zones)).toBe(google);
    const merged = importInto(importInto(target, googleFile), appleFile);
    const out = parseICalendar(serializeICalendar(merged, zones));
    expect(out.timeZones.map((t) => [t.tzid, t.generated])).toEqual([['Europe/Tallinn', { first: 2026, last: 2026 }]]);
    expect(out.groups.slice(1).map((g) => g.master!.raw!.includes('X-THIRTEEN-IMPORTED-LAST-MODIFIED:20261001T000000Z'))).toEqual([true, true]);
    // Into an empty calendar: the Google file's own definition is kept.
    const fresh = importInto(newICalendar({ calendarId: 'd', name: 'Empty', color: '#ea580c' }), googleFile);
    expect(serializeICalendar(fresh, zones)).toContain(crlf(...TALLINN_VTIMEZONE));
    // A Windows id is never renamed either.
    const outlook = parseICalendar(calendar(...FLE_VTIMEZONE.map((l) => l.replace('+0200', '+0100')), ...vevent('UID:o', 'DTSTART;TZID=FLE Standard Time:20261019T090000')));
    const withFle = parseICalendar(calendar(...FLE_VTIMEZONE));
    expect(renameCollidingTimeZones(withFle, outlook, zones)).toBe(outlook);
  });

  it('mergeTimeZones adds only definitions the target lacks', () => {
    const target = parseICalendar(calendar(...TALLINN_VTIMEZONE));
    const source = parseICalendar(calendar(...TALLINN_VTIMEZONE, ...FLE_VTIMEZONE));
    const merged = mergeTimeZones(target, source);
    expect(merged.timeZones.map((t) => [t.tzid, t.line])).toEqual([
      ['Europe/Tallinn', 4],
      ['FLE Standard Time', null],
    ]);
    expect(mergeTimeZones(merged, source)).toBe(merged);
  });
});
