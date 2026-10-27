/**
 * The TypeScript conformance test of `fixtures/ics` (docs/EVENTS.md §5.6,
 * task C8).
 *
 * - The committed files equal freshly generated output (`pnpm fixtures`),
 *   byte for byte, with no file left over, and the generator gives the same
 *   bytes when it runs on the recorded zone offsets of `fixtures/events.json`
 *   alone (every offset the set needs is recorded there, §5.5).
 * - Every case and procedure is replayed the way the C# port (W2) replays it:
 *   from the files on disk and `index.json`, through a `RecordedZoneResolver`
 *   built from `zoneOffsets`, with the `.ics` module.
 * - What §5.6 says each case shows is checked on the committed files.
 *
 * `ical.js` agreement on every case's occurrences is in `oracle.test.ts`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVENTS_FILE_URL, type EventsFile } from '../../scripts/events-file.ts';
import { DEFAULT_WINDOW, DEVICE_ZONES, ICS_CASES, ICS_NOW, type RoundTrip, type WindowSpec } from '../../scripts/ics-cases.ts';
import { ICS_DIR_URL, buildIcsFiles, normalizeLineEnds, roundTripHolds, withoutGeneratedZones } from '../../scripts/ics-fixtures.ts';
import {
  type IcsCalendarJson,
  type IcsGroupJson,
  type IcsWarningJson,
  icsCalendarJson,
  icsEventFromJson,
  icsEventJson,
  icsGroupJson,
  icsWarningJson,
  renderFixtureJson,
} from '../../scripts/ics-json.ts';
import { type ExpansionJson, type ProcedureFile, type StepJson, expansionJson, runStep, startText } from '../../scripts/ics-procedures.ts';
import type { RestoreCalendarJson } from '../../scripts/ics-scenarios.ts';
import { intlZoneResolver, recordedZoneResolver, recordingZoneResolver } from '../../scripts/zone-resolvers.ts';
import { readZip } from '../../scripts/zip.ts';
import { parseICalendar, serializeICalendar } from '../../src/ics/index.ts';
import { icalOccurrences } from './helpers.ts';

// ---------------------------------------------------------------------------
// The set on disk
// ---------------------------------------------------------------------------

interface IndexJson {
  readonly version: 1;
  readonly complete: true;
  readonly generatedBy: string;
  readonly spec: string;
  readonly zoneOffsets: string;
  readonly now: string;
  readonly system: string;
  readonly deviceZones: readonly string[];
  readonly defaultWindow: WindowSpec;
  readonly counts: { readonly cases: number; readonly edits: number; readonly imports: number; readonly restore: number; readonly inputs: number };
  readonly cases: readonly { readonly file: string; readonly expected: string; readonly roundtrip: string; readonly roundTrip: RoundTrip }[];
  readonly edits: readonly string[];
  readonly imports: readonly string[];
  readonly restore: readonly string[];
  readonly inputs: readonly string[];
}

interface ExpectedCase {
  readonly version: 1;
  readonly case: string;
  readonly calendarId: string;
  readonly system: 'ifc';
  readonly roundTrip: RoundTrip;
  readonly calendar: IcsCalendarJson;
  readonly warnings: readonly IcsWarningJson[];
  readonly groups: readonly IcsGroupJson[];
  readonly expansions: readonly ExpansionJson[];
}

type RestoreFile = ProcedureFile & { readonly calendars: readonly RestoreCalendarJson[]; readonly zip: { readonly file: string; readonly entries: readonly string[] } };

/** Every file under `fixtures/ics`, by path relative to it (dot files included). */
function filesUnder(dir: URL, prefix = ''): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const [path, bytes] of filesUnder(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)) out.set(path, bytes);
    } else {
      out.set(`${prefix}${entry.name}`, new Uint8Array(readFileSync(new URL(entry.name, dir))));
    }
  }
  return out;
}

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const committed = filesUnder(ICS_DIR_URL);
/** A committed file as text (UTF-8, a byte order mark kept). */
function text(path: string): string {
  const bytes = committed.get(path);
  if (bytes === undefined) throw new Error(`fixtures/ics has no ${path}`);
  return decoder.decode(bytes);
}
const json = <T>(path: string): T => JSON.parse(text(path)) as T;

const index = json<IndexJson>('index.json');
const eventsFile = JSON.parse(readFileSync(EVENTS_FILE_URL, 'utf8')) as EventsFile;
/** The port's resolver: the `zoneOffsets` of `fixtures/events.json` and nothing else. */
const zones = recordedZoneResolver(eventsFile.zoneOffsets);
/** Every `.ics` of the set by path, as a port loads them for a procedure. */
const icsFiles = new Map([...committed.keys()].filter((p) => p.endsWith('.ics')).map((p) => [p, text(p)] as const));
/** The expected JSON of a case (`cases/{name}.ics`), through `index.json`. */
function expectedOf(caseFile: string): ExpectedCase {
  const entry = index.cases.find((c) => c.file === caseFile);
  if (entry === undefined) throw new Error(`index.json lists no ${caseFile}`);
  return json<ExpectedCase>(entry.expected);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const bytesOf = (content: string | Uint8Array) => (typeof content === 'string' ? encoder.encode(content) : content);
/** Paths whose content differs between two file sets (missing on either side included). */
function differing(a: ReadonlyMap<string, string | Uint8Array>, b: ReadonlyMap<string, string | Uint8Array>): string[] {
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths.filter((p) => {
    const x = a.get(p);
    const y = b.get(p);
    return x === undefined || y === undefined || !sameBytes(bytesOf(x), bytesOf(y));
  });
}

// ---------------------------------------------------------------------------
// Document helpers
// ---------------------------------------------------------------------------

/** The top-level components named `name` of a CRLF document, as their text (BEGIN to END). */
const blocks = (doc: string, name: 'VEVENT' | 'VTIMEZONE'): string[] => doc.match(new RegExp(`BEGIN:${name}\\r\\n[\\s\\S]*?END:${name}\\r\\n`, 'g')) ?? [];
/** A property value of a component's text (folding undone), or null. */
function property(block: string, name: string): string | null {
  const line = block
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));
  return line === undefined ? null : line.slice(line.indexOf(':') + 1);
}
const uidOf = (block: string) => property(block, 'UID');
const summaryOf = (block: string) => property(block, 'SUMMARY');
/** A component's text without its import baseline line (§3.6). */
const withoutBaseline = (block: string) => block.replace(/X-THIRTEEN-IMPORTED-LAST-MODIFIED:[^\r]*\r\n/, '');

const expansion = (expansions: readonly ExpansionJson[] | undefined, deviceZone: string, window: WindowSpec = DEFAULT_WINDOW): ExpansionJson => {
  const found = expansions?.find((e) => e.deviceZone === deviceZone && e.window.from === window.from && e.window.to === window.to);
  if (found === undefined) throw new Error(`No expansion for ${deviceZone} ${window.from} to ${window.to}`);
  return found;
};
/** The UID part of an occurrence key (`{calendarId}/{uid}|{original}`). */
const keyUid = (key: string) => key.slice(key.indexOf('/') + 1, key.lastIndexOf('|'));
const ofUid = (e: ExpansionJson, uid: string) => e.occurrences.filter((o) => keyUid(o.key) === uid);
const ofTitle = (e: ExpansionJson, title: string) => e.occurrences.filter((o) => o.title === title);
const year = (y: number): WindowSpec => ({ from: `${y}-01-01T00:00`, to: `${y}-12-31T24:00` });
const steps = (file: string): StepJson[] => json<ProcedureFile>(file).scenarios.flatMap((s) => s.steps);

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

describe('fixtures/ics: generated (pnpm fixtures)', () => {
  const recorder = recordingZoneResolver(intlZoneResolver());
  const generated = buildIcsFiles(recorder);

  it('every committed file equals freshly generated output, and no other file is there', () => {
    expect(differing(generated, committed)).toEqual([]);
    expect(committed.size).toBe(generated.size);
  });

  it('replays through the recorded zone offsets of fixtures/events.json alone', () => {
    expect(differing(buildIcsFiles(zones), committed)).toEqual([]);
  });

  it('records every zone offset it uses in fixtures/events.json (§5.5 zoneOffsets)', () => {
    const recorded = recorder.offsets();
    expect(recorded.length).toBeGreaterThan(0);
    const table = new Map(eventsFile.zoneOffsets.map((e) => [`${e.zone} ${e.year}`, e] as const));
    const missing = recorded.filter((e) => JSON.stringify(table.get(`${e.zone} ${e.year}`)) !== JSON.stringify(e)).map((e) => `${e.zone} ${e.year}`);
    expect(missing).toEqual([]);
    // The set needs years far from today: 2005, 2029 to 2031 and 9999.
    for (const [zone, y] of [['America/New_York', 2004], ['America/New_York', 2031], ['Asia/Jerusalem', 2029], ['Pacific/Kiritimati', 9999], ['Europe/Tallinn', 9999]] as const) {
      expect(table.has(`${zone} ${y}`), `${zone} ${y}`).toBe(true);
    }
  });

  it('fixtures/events.json and index.json are marked complete (§6.0)', () => {
    expect(eventsFile.version).toBe(1);
    expect(eventsFile.complete).toBe(true);
    expect(index).toMatchObject({ version: 1, complete: true, generatedBy: '@thirteen/core', spec: 'docs/EVENTS.md', zoneOffsets: 'fixtures/events.json' });
  });
});

// ---------------------------------------------------------------------------
// index.json, README and layout
// ---------------------------------------------------------------------------

describe('fixtures/ics: index.json, README and layout', () => {
  it('lists every case, procedure and input, with counts', () => {
    expect(index.now).toBe(ICS_NOW);
    expect(index.system).toBe('ifc');
    expect(index.deviceZones).toEqual(['Europe/Tallinn', 'America/New_York']);
    expect(index.defaultWindow).toEqual({ from: '2026-01-01T00:00', to: '2027-12-31T24:00' });
    expect(index.counts).toEqual({ cases: index.cases.length, edits: index.edits.length, imports: index.imports.length, restore: index.restore.length, inputs: index.inputs.length });
    const under = (dir: string, ext: string) => [...committed.keys()].filter((p) => p.startsWith(dir) && p.endsWith(ext)).sort();
    expect(index.cases.map((c) => c.file).sort()).toEqual(under('cases/', '.ics'));
    expect(index.cases.map((c) => c.expected).sort()).toEqual(under('expected/', '.json'));
    expect(index.cases.map((c) => c.roundtrip).sort()).toEqual(under('roundtrip/', '.ics'));
    for (const c of index.cases) expect([c.expected, c.roundtrip]).toEqual([`expected/${c.file.slice(6, -4)}.json`, `roundtrip/${c.file.slice(6)}`]);
    expect([...index.edits, ...index.imports, ...index.restore].sort()).toEqual([...under('edits/', '.json'), ...under('imports/', '.json'), ...under('restore/', '.json')].sort());
    // Every other .ics is an input of a procedure or the document of a step.
    const outputs = [...index.edits, ...index.imports, ...index.restore].flatMap((f) => steps(f).map((s) => s.expected));
    expect(new Set(outputs).size).toBe(outputs.length);
    const procedureFiles = [...committed.keys()].filter((p) => /^(edits|imports|restore)\//.test(p) && !p.endsWith('.json') && !p.endsWith('.zip'));
    expect([...index.inputs, ...outputs].sort()).toEqual(procedureFiles.sort());
  });

  it('holds the §5.6 minimum set of cases and procedures', () => {
    const cases = new Set(index.cases.map((c) => c.file.slice(6)));
    for (const name of [
      'google-holidays', 'google-secret', 'icloud-export', 'outlook-publish', 'fastmail', 'thunderbird', 'thirteen-roundtrip', 'folding', 'escapes',
      'line-endings', 'bom', 'duration', 'period-rdate', 'floating', 'unknown-tzid', 'broken', 'components', 'marker-mismatch', 'rscale', 'far-future',
      'until-instant', 'rrule-rdate', 'exrule', 'two-rrules', 'duplicate-uid', 'override-only', 'missing-uid', 'window-edges', 'ny-2005-2026',
      'jerusalem', 'ny-open-ended',
    ]) {
      expect(cases.has(`${name}.ics`), name).toBe(true);
    }
    expect(index.edits).toEqual(expect.arrayContaining(['edits/outlook-edit-one.json', 'edits/generated-tz-grow.json', 'edits/year-9999.json', 'edits/retime-until.json', 'edits/own-time-rdate.json']));
    expect(index.imports).toEqual(expect.arrayContaining(['imports/customized-tz.json', 'imports/known-tz.json', 'imports/baseline.json']));
    expect(index.restore).toEqual(['restore/restore.json']);
    // The generator's list and the committed one agree.
    expect(index.cases.map((c) => [c.file, c.roundTrip])).toEqual(ICS_CASES.map((c) => [`cases/${c.file}`, c.roundTrip]));
  });

  it('the README describes every case and procedure file', () => {
    const readme = text('README.md');
    for (const c of index.cases) expect(readme, c.file).toContain(`\`${c.file.slice(6)}\``);
    for (const f of [...index.edits, ...index.imports, ...index.restore]) expect(readme, f).toContain(`\`${f}\``);
  });

  it('keeps every byte exact on checkout and in editors', () => {
    expect(text('.gitattributes')).toContain('* -text');
    expect(text('.editorconfig')).toMatch(/end_of_line = unset[\s\S]*trim_trailing_whitespace = false/);
    // The line end and byte order mark cases are on disk as written.
    expect(committed.get('cases/bom.ics')!.subarray(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    const endings = text('cases/line-endings.ics');
    expect(endings).toMatch(/[^\r]\n/);
    expect(endings).toMatch(/\r[^\n]/);
  });

  it('no file holds an em or en dash', () => {
    /** U+2013 and U+2014, written as escapes so this file holds neither. */
    const DASHES = new RegExp('[\\u2013\\u2014]');
    const dashed = [...committed].filter(([path, bytes]) => !path.endsWith('.zip') && DASHES.test(decoder.decode(bytes))).map(([path]) => path);
    expect(dashed).toEqual([]);
  });

  it('every JSON file is laid out like events.json', () => {
    const pretty = new Set(['expansions', 'scenarios', 'steps']);
    for (const path of [...committed.keys()].filter((p) => p.endsWith('.json'))) {
      expect(text(path), path).toBe(renderFixtureJson(JSON.parse(text(path)), path === 'index.json' ? new Set() : pretty));
    }
  });
});

// ---------------------------------------------------------------------------
// Cases, as a port reads them
// ---------------------------------------------------------------------------

describe('fixtures/ics: cases, replayed as a port reads them', () => {
  it.each(index.cases.map((c) => [c.file, c] as const))('%s', (_, c) => {
    const input = text(c.file);
    const expected = expectedOf(c.file);
    expect(expected).toMatchObject({ version: 1, case: c.file, system: 'ifc', roundTrip: c.roundTrip });
    const calendar = parseICalendar(input, { calendarId: expected.calendarId, zones });
    expect(icsCalendarJson(calendar)).toEqual(expected.calendar);
    expect(calendar.warnings.map(icsWarningJson)).toEqual(expected.warnings);
    expect(calendar.groups.map(icsGroupJson)).toEqual(expected.groups);
    for (const e of expected.expansions) expect(expansionJson(input, expected.calendarId, e.deviceZone, e.window, zones)).toEqual(e);
    // Both device zones in the default window, unless the case is only about another year.
    for (const zone of DEVICE_ZONES) {
      expect(expected.expansions.some((e) => e.deviceZone === zone && (c.file === 'cases/far-future.ics' || (e.window.from === DEFAULT_WINDOW.from && e.window.to === DEFAULT_WINDOW.to)))).toBe(true);
    }
    // The round trip, its relation to the input, and that it reads back to itself.
    const roundtrip = text(c.roundtrip);
    expect(serializeICalendar(calendar, zones, { now: index.now })).toBe(roundtrip);
    expect(roundTripHolds(c.roundTrip, input, roundtrip)).toBe(true);
    expect(serializeICalendar(parseICalendar(roundtrip, { calendarId: expected.calendarId, zones }), zones, { now: index.now })).toBe(roundtrip);
    // The JSON form of every event reads back to itself.
    for (const group of expected.groups) {
      for (const event of [...(group.master === null ? [] : [group.master]), ...group.overrides]) expect(icsEventJson(icsEventFromJson(event))).toEqual(event);
    }
  });

  it('round trips are the input with CRLF line ends, plus generated VTIMEZONEs where the input names a known zone it does not define', () => {
    for (const c of index.cases) {
      const input = normalizeLineEnds(text(c.file));
      const roundtrip = text(c.roundtrip);
      if (c.roundTrip === 'as-read') expect(roundtrip, c.file).toBe(input);
      else {
        expect(withoutGeneratedZones(roundtrip), c.file).toBe(input);
        expect(roundtrip, c.file).toContain('X-THIRTEEN-GENERATED:');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Procedures, as a port replays them
// ---------------------------------------------------------------------------

describe('fixtures/ics: edits, imports and restore, replayed as a port replays them', () => {
  const procedures = [...index.edits, ...index.imports, ...index.restore];
  it.each(procedures.map((f) => [f] as const))('%s', (file) => {
    const procedure = json<ProcedureFile>(file);
    expect(procedure.version).toBe(1);
    expect(procedure.now).toBe(index.now);
    expect(procedure.scenarios.length).toBeGreaterThan(0);
    for (const scenario of procedure.scenarios) {
      let doc = startText(scenario.start, icsFiles, zones, procedure.now);
      for (const step of scenario.steps) {
        const next = runStep(step, doc, scenario.calendarId, icsFiles, zones, procedure.now);
        expect(next, `${scenario.name}: ${step.expected}`).toBe(text(step.expected));
        for (const e of step.expansions ?? []) expect(expansionJson(next, scenario.calendarId, e.deviceZone, e.window, zones)).toEqual(e);
        // A stored document reads back to itself.
        expect(serializeICalendar(parseICalendar(next, { calendarId: scenario.calendarId, zones }), zones, { now: procedure.now })).toBe(next);
        doc = next;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// What §5.6 says the cases show
// ---------------------------------------------------------------------------

describe('fixtures/ics: the cases show what §5.6 says', () => {
  it('far-future.ics: 9999 is kept, year 10000 is dropped with out-of-range, DTEND 10000101 ends at 9999-12-31T24:00', () => {
    const expected = expectedOf('cases/far-future.ics');
    const last = year(9999);
    const ny = expected.groups.find((g) => g.master?.summary.startsWith('23:00 in New York'))!.uid;
    const tallinn = expected.groups.find((g) => g.master?.summary === '15:00 in Tallinn')!.uid;
    const outOfRange = (e: ExpansionJson) => e.warnings.filter((w) => w.code === 'out-of-range').map((w) => w.detail);
    for (const zone of ['Europe/Tallinn', 'America/New_York', 'Pacific/Kiritimati']) {
      const e = expansion(expected.expansions, zone, last);
      expect(ofUid(e, ny), zone).toEqual([]);
      expect(outOfRange(e).some((d) => d.includes(ny)), zone).toBe(true);
      expect(ofTitle(e, 'The last day').map((o) => [o.start, o.end])).toEqual([['9999-12-31T00:00', '9999-12-31T24:00']]);
      expect(ofTitle(e, 'The last three days').map((o) => [o.start, o.end])).toEqual([['9999-12-29T00:00', '9999-12-31T24:00']]);
      expect(ofTitle(e, 'Two days ending with DTEND 10000101').map((o) => [o.start, o.end])).toEqual([['9999-12-30T00:00', '9999-12-31T24:00']]);
      // The daily repeat stops on 9999-12-31.
      expect(ofTitle(e, 'Daily into the end').map((o) => o.key.slice(-16, -6))).toEqual(['9999-12-29', '9999-12-30', '9999-12-31']);
    }
    expect(ofUid(expansion(expected.expansions, 'Europe/Tallinn', last), tallinn).map((o) => o.start)).toEqual(['9999-12-31T15:00']);
    expect(ofUid(expansion(expected.expansions, 'America/New_York', last), tallinn).map((o) => o.start)).toEqual(['9999-12-31T08:00']);
    const kiritimati = expansion(expected.expansions, 'Pacific/Kiritimati', last);
    expect(ofUid(kiritimati, tallinn)).toEqual([]);
    expect(outOfRange(kiritimati).some((d) => d.includes(tallinn))).toBe(true);
  });

  it('until-instant.ics: an instant UNTIL at the end of a day, and its continuation, give November 16 once', () => {
    const expected = expectedOf('cases/until-instant.ics');
    const uid = (title: string) => expected.groups.find((g) => g.master?.summary === title)!.uid;
    for (const zone of DEVICE_ZONES) {
      const e = expansion(expected.expansions, zone);
      const choir = [...ofUid(e, uid('Choir (ended one second before November 16)')), ...ofUid(e, uid('Choir (from November 16)'))];
      const nov16 = choir.filter((o) => o.key.endsWith('|2026-11-16T19:00'));
      expect(nov16, zone).toHaveLength(1);
      expect(keyUid(nov16[0]!.key)).toBe(uid('Choir (from November 16)'));
      expect(ofUid(e, uid('Choir (ended one second before November 16)')).map((o) => o.key.slice(-16))).toEqual(['2026-10-19T19:00', '2026-10-26T19:00', '2026-11-02T19:00', '2026-11-09T19:00']);
      expect(ofUid(e, uid('Choir (UNTIL at 00:00 UTC on November 16)')).at(-1)!.key.slice(-16)).toBe('2026-11-09T19:00');
    }
  });

  it('rrule-rdate.ics: COUNT=3 plus one RDATE is 4, an own-time RDATE and a longer PERIOD are read, an RDATE after UNTIL is shown', () => {
    const e = expansion(expectedOf('cases/rrule-rdate.ics').expansions, 'Europe/Tallinn');
    expect(ofTitle(e, 'Three weeks and one extra')).toHaveLength(4);
    const consultation = ofTitle(e, 'Consultation');
    expect(consultation.filter((o) => o.start.startsWith('2026-11-02')).map((o) => [o.start, o.end])).toEqual([
      ['2026-11-02T09:00', '2026-11-02T10:00'],
      ['2026-11-02T15:00', '2026-11-02T16:00'],
    ]);
    expect(consultation.find((o) => o.start.startsWith('2026-11-12'))).toMatchObject({ start: '2026-11-12T14:00', end: '2026-11-12T17:00' });
    expect(consultation.some((o) => o.start.startsWith('2026-11-09'))).toBe(false);
    expect(ofTitle(e, 'An extra date after the end').map((o) => o.start.slice(0, 10))).toEqual(['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-15']);
    expect(ofTitle(e, 'An extra date that is also excluded').map((o) => o.start.slice(0, 10))).toEqual(['2026-12-01', '2026-12-08']);
  });

  it('duplicate-uid.ics and missing-uid.ics: #2 keys, duplicate-uid and missing-uid warnings, derived UIDs', () => {
    const duplicate = expectedOf('cases/duplicate-uid.ics');
    expect(duplicate.warnings.filter((w) => w.code === 'duplicate-uid')).toHaveLength(3);
    expect(expansion(duplicate.expansions, 'Europe/Tallinn').occurrences.some((o) => o.key.endsWith('#2'))).toBe(true);
    const missing = expectedOf('cases/missing-uid.ics');
    expect(missing.warnings.map((w) => w.code)).toEqual(['missing-uid', 'missing-uid']);
    expect(missing.groups.every((g) => g.master?.uidDerived === true && g.uid.startsWith('missing-'))).toBe(true);
  });

  it('window-edges.ics: 01:00 on January 1 in Kiritimati is December 31 in Honolulu; overrides moved across January 1 are in the year they moved to', () => {
    const expected = expectedOf('cases/window-edges.ics');
    const sunrise = (zone: string) => ofTitle(expansion(expected.expansions, zone), 'First sunrise on the Line Islands').map((o) => o.start);
    expect(sunrise('Pacific/Honolulu')).toEqual(['2026-12-31T01:00']);
    expect(sunrise('Europe/Tallinn')).toEqual(['2026-12-31T13:00']);
    for (const zone of DEVICE_ZONES) {
      const in2026 = expansion(expected.expansions, zone, year(2026)).occurrences.map((o) => o.key.slice(o.key.lastIndexOf('|') + 1));
      const in2027 = expansion(expected.expansions, zone, year(2027)).occurrences.map((o) => o.key.slice(o.key.lastIndexOf('|') + 1));
      // The December 15 occurrence moved to January 5, 2027; the January 15 one moved to December 20, 2026.
      expect(in2027, zone).toContain('2026-12-15T09:00');
      expect(in2026, zone).not.toContain('2026-12-15T09:00');
      expect(in2026, zone).toContain('2027-01-15T09:00');
      expect(in2027, zone).not.toContain('2027-01-15T09:00');
    }
  });

  it('ny-2005-2026.ics: both rule periods, the first with 2004 onsets, the current one open-ended; ical.js puts January 10, 2005 at UTC-5', () => {
    const input = text('cases/ny-2005-2026.ics');
    const [vtimezone] = blocks(input, 'VTIMEZONE');
    expect(property(vtimezone!, 'X-THIRTEEN-GENERATED')).toBe('2005-2026');
    expect(vtimezone).toContain('DTSTART:20040404T020000\r\n');
    expect(vtimezone).toContain('DTSTART:20041031T020000\r\n');
    expect(vtimezone!.match(/^RRULE:.*$/gm)!.map((r) => r.includes('UNTIL='))).toEqual([true, true, false, false]);
    const kickoff = icalOccurrences(input, Date.UTC(2005, 0, 1), Date.UTC(2006, 0, 1)).find((o) => o.start < Date.UTC(2005, 0, 11));
    expect(kickoff?.start).toBe(Date.UTC(2005, 0, 10, 14, 0));
    const expected = expectedOf('cases/ny-2005-2026.ics');
    expect(ofTitle(expansion(expected.expansions, 'America/New_York', year(2005)), 'Kickoff').map((o) => o.start)).toEqual(['2005-01-10T09:00']);
    expect(ofTitle(expansion(expected.expansions, 'Europe/Tallinn', year(2005)), 'Kickoff').map((o) => o.start)).toEqual(['2005-01-10T16:00']);
  });

  it('ny-open-ended.ics: with only its own VTIMEZONE, ical.js puts January 5, 2026 at UTC-5, July 2030 at UTC-4 and January 2031 at UTC-5', () => {
    const input = text('cases/ny-open-ended.ics');
    const at = (from: number, to: number) => icalOccurrences(input, from, to)[0]!.start;
    expect(at(Date.UTC(2026, 0, 5), Date.UTC(2026, 0, 6))).toBe(Date.UTC(2026, 0, 5, 14, 0));
    expect(at(Date.UTC(2030, 6, 1), Date.UTC(2030, 7, 1))).toBe(Date.UTC(2030, 6, 1, 13, 0));
    expect(at(Date.UTC(2031, 0, 1), Date.UTC(2031, 1, 1))).toBe(Date.UTC(2031, 0, 6, 14, 0));
    const vtimezone = blocks(input, 'VTIMEZONE')[0]!;
    expect(vtimezone).not.toContain('UNTIL=');
    // Our engine on the recorded offsets agrees.
    const e = expansion(expectedOf('cases/ny-open-ended.ics').expansions, 'Europe/Tallinn', { from: '2030-06-01T00:00', to: '2031-02-01T00:00' });
    expect(e.occurrences.find((o) => o.key.endsWith('|2030-07-01T09:00'))?.start).toBe('2030-07-01T16:00');
    expect(e.occurrences.find((o) => o.key.endsWith('|2031-01-06T09:00'))?.start).toBe('2031-01-06T16:00');
  });

  it('jerusalem.ics: expanded in 2026 and 2029', () => {
    const expected = expectedOf('cases/jerusalem.ics');
    for (const zone of DEVICE_ZONES) {
      expect(expansion(expected.expansions, zone).occurrences.length).toBeGreaterThan(0);
      expect(expansion(expected.expansions, zone, year(2029)).occurrences.length).toBeGreaterThan(0);
    }
  });
});

describe('fixtures/ics: the procedures show what §5.6 says', () => {
  it('edits/outlook-edit-one: one title changed, every other group and the Windows VTIMEZONE byte for byte', () => {
    const input = text('cases/outlook-publish.ics');
    const output = text('edits/outlook-edit-one.ics');
    expect(blocks(output, 'VTIMEZONE')).toEqual(blocks(input, 'VTIMEZONE'));
    const changed = blocks(output, 'VEVENT').filter((b) => !blocks(input, 'VEVENT').includes(b));
    expect(changed.map(summaryOf)).toEqual(['Budget review with Marta']);
    const before = blocks(input, 'VEVENT').filter((b) => !blocks(output, 'VEVENT').includes(b));
    expect(before.map(uidOf)).toEqual(changed.map(uidOf));
    expect(property(changed[0]!, 'DTSTART;TZID=FLE Standard Time')).not.toBeNull();
    expect(output.replace(changed[0]!, '')).toBe(input.replace(before[0]!, ''));
  });

  it('edits/generated-tz-grow: X-THIRTEEN-GENERATED 2026-2031 (still open-ended), then 2005-2031 with 2004 onsets; other groups byte for byte', () => {
    const input = text('cases/ny-open-ended.ics');
    const grown = text('edits/generated-tz-grow.ics');
    const back = text('edits/generated-tz-grow-2005.ics');
    const zone = (doc: string) => blocks(doc, 'VTIMEZONE')[0]!;
    expect(property(zone(input), 'X-THIRTEEN-GENERATED')).toBe('2026-2027');
    expect(property(zone(grown), 'X-THIRTEEN-GENERATED')).toBe('2026-2031');
    expect(zone(grown)).not.toContain('UNTIL=');
    expect(property(zone(back), 'X-THIRTEEN-GENERATED')).toBe('2005-2031');
    expect(zone(back)).toContain('DTSTART:20040404T020000\r\n');
    for (const b of blocks(input, 'VEVENT')) expect(grown).toContain(b);
    for (const b of blocks(grown, 'VEVENT')) expect(back).toContain(b);
    const [first, second] = steps('edits/generated-tz-grow.json');
    expect(ofTitle(expansion(first!.expansions, 'America/New_York', year(2031)), 'Conference')).toHaveLength(1);
    expect(ofTitle(expansion(second!.expansions, 'America/New_York', year(2005)), 'Old kickoff')).toHaveLength(1);
  });

  it('edits/year-9999: one day without DTEND, three days as DURATION:P3D, both read back as ending 9999-12-31T24:00', () => {
    const output = text('edits/year-9999.ics');
    const [one, three] = blocks(output, 'VEVENT');
    expect(property(one!, 'DTSTART;VALUE=DATE')).toBe('99991231');
    expect([property(one!, 'DTEND;VALUE=DATE'), property(one!, 'DURATION')]).toEqual([null, null]);
    expect(property(three!, 'DTSTART;VALUE=DATE')).toBe('99991229');
    expect(property(three!, 'DURATION')).toBe('P3D');
    for (const zone of DEVICE_ZONES) {
      const e = expansion(steps('edits/year-9999.json')[0]!.expansions, zone, year(9999));
      expect(e.occurrences.map((o) => [o.start, o.end])).toEqual([
        ['9999-12-29T00:00', '9999-12-31T24:00'],
        ['9999-12-31T00:00', '9999-12-31T24:00'],
      ]);
    }
  });

  it('edits/retime-until: UNTIL 20261116T215959Z keeps November 16, then UNTIL=20261116 with EXDATE;VALUE=DATE, then timed again', () => {
    const input = text('cases/outlook-publish.ics');
    const choir = (doc: string) => blocks(doc, 'VEVENT').find((b) => summaryOf(b) === 'Choir rehearsal')!;
    expect(property(choir(input), 'RRULE')).toBe('FREQ=WEEKLY;UNTIL=20261116T170000Z;INTERVAL=1;BYDAY=MO;WKST=MO');
    const docs = ['edits/retime-until.ics', 'edits/retime-until-all-day.ics', 'edits/retime-until-timed.ics'].map(text);
    expect(docs.map((d) => property(choir(d), 'RRULE'))).toEqual([
      'FREQ=WEEKLY;UNTIL=20261116T215959Z;INTERVAL=1;BYDAY=MO;WKST=MO',
      'FREQ=WEEKLY;UNTIL=20261116;INTERVAL=1;BYDAY=MO;WKST=MO',
      'FREQ=WEEKLY;UNTIL=20261116T215959Z;INTERVAL=1;BYDAY=MO;WKST=MO',
    ]);
    expect(property(choir(docs[0]!), 'EXDATE;TZID=FLE Standard Time')).toBe('20261102T193000');
    expect(property(choir(docs[1]!), 'EXDATE;VALUE=DATE')).toBe('20261102');
    expect(property(choir(docs[2]!), 'EXDATE;TZID=FLE Standard Time')).toBe('20261102T193000');
    for (const doc of docs) {
      expect(blocks(doc, 'VTIMEZONE')).toEqual(blocks(input, 'VTIMEZONE'));
      for (const b of blocks(input, 'VEVENT').filter((b) => b !== choir(input))) expect(doc).toContain(b);
    }
    const nov16 = steps('edits/retime-until.json').map((s) => ofTitle(expansion(s.expansions, 'Europe/Tallinn', { from: '2026-10-01T00:00', to: '2027-01-01T00:00' }), 'Choir rehearsal').filter((o) => o.start.startsWith('2026-11-16')));
    expect(nov16.map((list) => list.map((o) => [o.start, o.end]))).toEqual([
      [['2026-11-16T19:30', '2026-11-16T21:00']],
      [['2026-11-16T00:00', '2026-11-16T24:00']],
      [['2026-11-16T19:30', '2026-11-16T21:00']],
    ]);
  });

  it('edits/own-time-rdate: "Delete this event only" on the 15:00 extra date writes its EXDATE; a retime to 10:00 moves it and the RDATE to 16:00', () => {
    const consultation = (doc: string) => blocks(doc, 'VEVENT').find((b) => summaryOf(b) === 'Consultation')!.replace(/\r\n[ \t]/g, '');
    const deleted = consultation(text('edits/own-time-rdate.ics'));
    expect(deleted).toContain('EXDATE;TZID=Europe/Tallinn:20261102T150000\r\n');
    expect(deleted).toContain('RDATE;TZID=Europe/Tallinn:20261102T150000\r\n');
    const retimed = consultation(text('edits/own-time-rdate-retimed.ics'));
    expect(retimed).toContain('RDATE;TZID=Europe/Tallinn:20261102T160000\r\n');
    expect(retimed).toMatch(/EXDATE;TZID=Europe\/Tallinn:[^\r]*20261102T160000/);
    expect(retimed).not.toContain('20261102T150000');
    const window = { from: '2026-10-01T00:00', to: '2027-01-01T00:00' };
    const [first, second] = steps('edits/own-time-rdate.json').map((s) => ofTitle(expansion(s.expansions, 'Europe/Tallinn', window), 'Consultation'));
    expect(first!.filter((o) => o.start.startsWith('2026-11-02')).map((o) => o.start)).toEqual(['2026-11-02T09:00']);
    expect(second!.filter((o) => o.start.startsWith('2026-11-02')).map((o) => o.start)).toEqual(['2026-11-02T10:00']);
  });

  it('imports/customized-tz: the second "Customized Time Zone" is renamed "(2)" and keeps its times; the third shares the first', () => {
    const doc = text('imports/customized-tz-3.ics');
    expect(blocks(doc, 'VTIMEZONE').map((b) => property(b, 'TZID'))).toEqual(['Customized Time Zone', 'Customized Time Zone (2)']);
    const [, , third] = steps('imports/customized-tz.json');
    const calendarId = json<ProcedureFile>('imports/customized-tz.json').scenarios[0]!.calendarId;
    for (const zone of DEVICE_ZONES) {
      const stored = expansion(third!.expansions, zone, { from: '2026-11-01T00:00', to: '2026-12-01T00:00' });
      const alone = ['a', 'b', 'c'].flatMap((x) => expansionJson(text(`imports/customized-tz-${x}.ics`), calendarId, zone, stored.window, zones).occurrences);
      expect(stored.occurrences.map((o) => [o.key, o.start, o.end]).sort()).toEqual(alone.map((o) => [o.key, o.start, o.end]).sort());
    }
    // The first and third files' events are stored as read (plus their baseline); the second's is re-serialized with the new TZID.
    const stored = blocks(doc, 'VEVENT').map(withoutBaseline);
    for (const x of ['a', 'c']) expect(stored).toContain(blocks(text(`imports/customized-tz-${x}.ics`), 'VEVENT')[0]);
    const second = blocks(doc, 'VEVENT').find((b) => b.includes('TZID=Customized Time Zone (2):'));
    expect(uidOf(second!)).toBe(uidOf(blocks(text('imports/customized-tz-b.ics'), 'VEVENT')[0]!));
  });

  it('imports/known-tz: nothing renamed, imported groups byte for byte plus their baseline, one Europe/Tallinn VTIMEZONE', () => {
    const imported = [...blocks(text('cases/google-secret.ics'), 'VEVENT'), ...blocks(text('cases/icloud-export.ics'), 'VEVENT')];
    for (const path of ['imports/known-tz-2.ics', 'imports/known-tz-empty-2.ics']) {
      const doc = text(path);
      const stored = blocks(doc, 'VEVENT').map(withoutBaseline);
      for (const b of imported) expect(stored, `${path} ${uidOf(b)}`).toContain(b);
      expect(blocks(doc, 'VTIMEZONE').filter((b) => property(b, 'TZID') === 'Europe/Tallinn')).toHaveLength(1);
      expect(doc).not.toMatch(/TZID[:=]Europe\/Tallinn \(2\)/);
    }
    const tallinn = (path: string) => blocks(text(path), 'VTIMEZONE').find((b) => property(b, 'TZID') === 'Europe/Tallinn')!;
    expect(property(tallinn('imports/known-tz-1.ics'), 'X-THIRTEEN-GENERATED')).toBe('2026-2027');
    expect(property(tallinn('imports/known-tz-2.ics'), 'X-THIRTEEN-GENERATED')).toBe('2025-2027');
    const google = blocks(text('cases/google-secret.ics'), 'VTIMEZONE').find((b) => property(b, 'TZID') === 'Europe/Tallinn')!;
    expect(tallinn('imports/known-tz-empty-1.ics')).toBe(google);
    expect(tallinn('imports/known-tz-empty-2.ics')).toBe(google);
  });

  it('imports/baseline: imported groups carry their baseline; a newer export replaces an edited group, an older one changes nothing', () => {
    const imported = text('imports/baseline-1-import.ics');
    const masters = blocks(imported, 'VEVENT').filter((b) => property(b, 'RECURRENCE-ID;TZID=Europe/Tallinn') === null);
    expect(masters.every((b) => property(b, 'X-THIRTEEN-IMPORTED-LAST-MODIFIED') !== null)).toBe(true);
    const [, edit, newer, older] = steps('imports/baseline.json');
    expect(edit!.kind).toBe('edit');
    expect(newer).toMatchObject({ kind: 'import', result: { added: 0, updated: 1, unchanged: 2, skipped: 0 } });
    expect(older).toMatchObject({ kind: 'import', result: { added: 0, updated: 0, unchanged: 3, skipped: 0 } });
    expect(text('imports/baseline-4-older.ics')).toBe(text('imports/baseline-3-newer.ics'));
    // The group edited in Thirteen is replaced by the newer export's text (plus the new baseline).
    const editedUids = new Set(blocks(text('imports/baseline-2-edit.ics'), 'VEVENT').filter((b) => !blocks(imported, 'VEVENT').includes(b)).map(uidOf));
    expect(editedUids.size).toBe(1);
    const replaced = blocks(text('imports/baseline-3-newer.ics'), 'VEVENT').map(withoutBaseline);
    const newerOfEdited = blocks(text('imports/baseline-google-newer.ics'), 'VEVENT').filter((b) => editedUids.has(uidOf(b)));
    expect(newerOfEdited.length).toBeGreaterThan(0);
    for (const b of newerOfEdited) expect(replaced).toContain(b);
    expect(steps('imports/baseline.json').at(-1)).toMatchObject({ kind: 'import', result: { added: 0, updated: 1, unchanged: 1, skipped: 0 } });
  });

  it('imports/override-only: merged into its master (the master byte for byte), an older copy changes nothing, a newer one replaces the override', () => {
    const uid = blocks(text('cases/override-only.ics'), 'VEVENT').map(uidOf)[0]!;
    const master = (path: string) => blocks(text(path), 'VEVENT').find((b) => uidOf(b) === uid && !b.includes('\r\nRECURRENCE-ID'))!;
    // An import that merges or replaces an override leaves the stored master as it was, byte for byte.
    expect(master('imports/override-only-2-merged.ics')).toBe(master('imports/override-only-1-series.ics'));
    expect(master('imports/override-only-5-newer.ics')).toBe(master('imports/override-only-4-older.ics'));
    expect(text('imports/override-only-4-older.ics')).toBe(text('imports/override-only-3-edited.ics'));
    const invited = blocks(text('imports/override-only-newer.ics'), 'VEVENT')[0]!;
    expect(blocks(text('imports/override-only-5-newer.ics'), 'VEVENT').map(withoutBaseline)).toContain(invited);
    const empty = steps('imports/override-only.json').at(-1)!;
    expect(empty).toMatchObject({ kind: 'import', result: { added: 1, updated: 0, unchanged: 0, skipped: 0 } });
    expect(blocks(text('imports/override-only-empty.ics'), 'VEVENT').map(withoutBaseline)).toEqual(blocks(text('cases/override-only.ics'), 'VEVENT'));
    for (const zone of DEVICE_ZONES) expect(expansion(empty.expansions, zone).occurrences).toHaveLength(1);
  });

  it('imports/missing-uid: the second import adds nothing', () => {
    expect(steps('imports/missing-uid.json').map((s) => s.kind === 'import' && s.result)).toEqual([
      { added: 2, updated: 0, unchanged: 0, skipped: 0 },
      { added: 0, updated: 0, unchanged: 2, skipped: 0 },
    ]);
    expect(text('imports/missing-uid-2.ics')).toBe(text('imports/missing-uid-1.ics'));
    expect(blocks(text('imports/missing-uid-2.ics'), 'VEVENT')).toHaveLength(2);
  });

  it('restore: the zip holds the three exports; older.ics keeps the edit, brings back the deleted event; the same file twice changes nothing', () => {
    const restore = json<RestoreFile>('restore/restore.json');
    const zip = readZip(committed.get(restore.zip.file)!);
    expect(zip.map((e) => e.name)).toEqual(restore.zip.entries);
    for (const entry of zip) expect(sameBytes(entry.bytes, committed.get(`restore/${entry.name}`)!), entry.name).toBe(true);
    expect(restore.calendars.map((c) => c.file)).toEqual(restore.zip.entries.map((e) => `restore/${e}`));
    for (const c of restore.calendars) {
      const calendar = parseICalendar(text(c.file), { zones });
      expect(calendar.name, c.file).toBe(c.name);
      expect(text(c.file)).toContain(`X-THIRTEEN-CALENDAR-ID:${c.calendarId}\r\n`);
      expect(calendar.groups).toHaveLength(c.groups);
    }
    expect(restore.calendars.map((c) => c.kind)).toEqual(['local', 'local', 'subscription']);
    expect(text('restore/personal-restored.ics')).toBe(text('restore/Personal.ics'));
    expect(text('restore/personal-restored-twice.ics')).toBe(text('restore/Personal.ics'));
    const personal = blocks(text('restore/Personal.ics'), 'VEVENT');
    const restored = blocks(text('restore/older-restored.ics'), 'VEVENT');
    const piano = blocks(text('restore/older.ics'), 'VEVENT').find((b) => summaryOf(b) === 'Piano lesson')!;
    expect(personal.map(summaryOf)).not.toContain('Piano lesson');
    expect(restored).toEqual([...personal, piano]);
    expect(steps('restore/restore.json').at(-1)).toMatchObject({ kind: 'restore', result: { added: 1, updated: 0, unchanged: 2, keptNewer: 1 } });
    expect(text('restore/older-restored.ics')).not.toContain('X-THIRTEEN-IMPORTED-LAST-MODIFIED');
  });
});
