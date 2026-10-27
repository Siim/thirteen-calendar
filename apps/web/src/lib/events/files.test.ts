import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatLocalDateTime } from '@thirteen/core';
import { newICalendar, parseICalendar, serializeICalendar } from '@thirteen/core/ics';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ImportResult,
  type PickedFile,
  type RestoreResult,
  crc32,
  exportDownload,
  exportFiles,
  exportText,
  fileNameOf,
  importCalendar,
  importIntoStore,
  readImportFiles,
  readZip,
  restoreCalendar,
  restoreIntoStore,
  writeZip,
} from './files.ts';
import { localIcsEngine } from './icsEngine.ts';
import type { LocalEventStore } from './store.ts';
import { type TestBrowser, openTab, testBrowser, timedDraft, zones } from './testSupport.ts';

const ROOT = resolve(__dirname, '../../../../..');
const fixturePath = (path: string) => resolve(ROOT, 'fixtures/ics', path);
const fixture = (path: string) => readFileSync(fixturePath(path), 'utf8');
const fixtureBytes = (path: string) => new Uint8Array(readFileSync(fixturePath(path)));
const engine = localIcsEngine(zones);
const summarize = (text: string, id: string) => engine.summarize(text, id);
const picked = (name: string, text: string): PickedFile => ({ name, bytes: new TextEncoder().encode(text) });

const open: LocalEventStore[] = [];
async function tab(browser: TestBrowser, options: Parameters<typeof openTab>[1] = {}) {
  const store = await openTab(browser, options);
  open.push(store);
  return store;
}
afterEach(() => {
  for (const store of open.splice(0)) store.close();
});

describe('zip (files.ts)', () => {
  it('writes the restore set exactly as fixtures/ics/restore holds it, and reads it back', () => {
    const encoder = new TextEncoder();
    const names = ['Personal.ics', 'Work.ics', 'Holidays in Estonia.ics'];
    const zip = writeZip(
      names.map((name) => ({ name, bytes: encoder.encode(fixture(`restore/${name}`)) })),
      '2026-10-19T09:41',
    );
    const expected = fixtureBytes('restore/Thirteen calendars 2026-10-19.zip');
    expect(zip.length).toBe(expected.length);
    expect(Buffer.from(zip).equals(Buffer.from(expected))).toBe(true);
    const entries = readZip(expected);
    expect(entries.map((e) => e.name)).toEqual(names);
    expect(new TextDecoder().decode(entries[2]!.bytes)).toBe(fixture('restore/Holidays in Estonia.ics'));
  });

  it('CRC-32 of the check string, UTF-8 names, and refuses damaged zips', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const zip = writeZip([{ name: 'Pühad 2027.ics', bytes: new Uint8Array([1, 2, 3]) }], '2026-10-19T09:41');
    expect(readZip(zip)[0]!.name).toBe('Pühad 2027.ics');
    const broken = zip.slice();
    broken[30 + new TextEncoder().encode('Pühad 2027.ics').length] = 9;
    expect(() => readZip(broken)).toThrow(/CRC/);
    expect(() => readZip(new Uint8Array(10))).toThrow(RangeError);
  });
});

interface Step {
  readonly kind: 'import' | 'restore' | 'edit';
  readonly file?: string;
  readonly result?: ImportResult | RestoreResult;
  readonly expected: string;
}
interface Scenario {
  readonly name: string;
  readonly calendarId: string;
  readonly start: { readonly file: string } | { readonly new: { calendarId: string; name: string; color: string } };
  readonly steps: readonly Step[];
}
interface Procedure {
  readonly now: string;
  readonly scenarios: readonly Scenario[];
}

/** Every import and restore step of a procedure file, each from the previous step's expected document (fixtures/ics/README.md). */
function procedureSteps(path: string) {
  const procedure = JSON.parse(fixture(path)) as Procedure;
  return procedure.scenarios.flatMap((scenario) => {
    let previous = 'file' in scenario.start ? fixture(scenario.start.file) : serializeICalendar(newICalendar(scenario.start.new), zones, { now: procedure.now });
    return scenario.steps.flatMap((step, index) => {
      const before = previous;
      previous = fixture(step.expected);
      if (step.kind === 'edit') return [];
      return [{ label: `${scenario.name}, step ${index + 1} (${step.kind} ${step.file})`, scenario, step, before, now: procedure.now }];
    });
  });
}

describe('import merges (fixtures/ics/imports)', () => {
  const steps = ['imports/baseline.json', 'imports/customized-tz.json', 'imports/known-tz.json', 'imports/missing-uid.json', 'imports/override-only.json'].flatMap(procedureSteps);
  it('covers every import step of the set', () => {
    expect(steps.length).toBe(18);
  });
  it.each(steps.map((s) => [s.label, s] as const))('%s', (_label, { scenario, step, before, now }) => {
    const target = parseICalendar(before, { calendarId: scenario.calendarId, zones });
    const { calendar, result } = importCalendar(target, fixture(step.file!), scenario.calendarId, zones);
    expect(result).toEqual(step.result);
    expect(serializeICalendar(calendar, zones, { now })).toBe(fixture(step.expected));
  });
});

describe('restore merges (fixtures/ics/restore)', () => {
  const steps = procedureSteps('restore/restore.json');
  it.each(steps.map((s) => [s.label, s] as const))('%s', (_label, { scenario, step, before, now }) => {
    const target = parseICalendar(before, { calendarId: scenario.calendarId, zones });
    const { calendar, result } = restoreCalendar(target, fixture(step.file!), scenario.calendarId, zones);
    expect(result).toEqual(step.result);
    expect(serializeICalendar(calendar, zones, { now })).toBe(fixture(step.expected));
  });
});

describe('merges of large files (the reference procedures, in linear time)', () => {
  const NOW = '2026-10-19T06:41';
  /** A calendar text of `count` groups from `first`: every third repeats with two overrides; `stamp(i)` gives each group's `LAST-MODIFIED`. */
  function calendarText(first: number, count: number, stamp: (i: number) => string, extra: readonly string[] = []): string {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bench//EN', 'X-WR-CALNAME:Bench'];
    for (let i = first; i < first + count; i++) {
      const day = String(1 + (i % 28)).padStart(2, '0');
      const month = String(1 + (Math.floor(i / 28) % 12)).padStart(2, '0');
      const common = [`UID:bench-${i}@example.test`, 'DTSTAMP:20261001T000000Z', `LAST-MODIFIED:${stamp(i)}`];
      if (i % 3 === 0) {
        lines.push('BEGIN:VEVENT', ...common, `DTSTART;TZID=Europe/Tallinn:2026${month}${day}T090000`, 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;COUNT=10', `SUMMARY:Series ${i}`, 'END:VEVENT');
        for (const week of [1, 2]) {
          const moved = new Date(Date.UTC(2026, Number(month) - 1, Number(day) + 7 * week));
          const stampDate = `${moved.getUTCFullYear()}${String(moved.getUTCMonth() + 1).padStart(2, '0')}${String(moved.getUTCDate()).padStart(2, '0')}`;
          lines.push('BEGIN:VEVENT', ...common, `RECURRENCE-ID;TZID=Europe/Tallinn:${stampDate}T090000`, `DTSTART;TZID=Europe/Tallinn:${stampDate}T110000`, 'DURATION:PT1H', `SUMMARY:Series ${i} moved`, 'END:VEVENT');
        }
      } else {
        lines.push('BEGIN:VEVENT', ...common, `DTSTART:2026${month}${day}T090000Z`, `DTEND:2026${month}${day}T100000Z`, `SUMMARY:Event ${i}`, 'END:VEVENT');
      }
    }
    lines.push(...extra, 'END:VCALENDAR', '');
    return lines.join('\r\n');
  }
  // Several masters of one UID, an override-only group for a stored series and one for a new UID, and an event without a UID.
  const extras = [
    ...['20261010T000000Z', '20261012T000000Z'].flatMap((stamp, k) => ['BEGIN:VEVENT', 'UID:bench-twice@example.test', 'DTSTAMP:20261001T000000Z', `LAST-MODIFIED:${stamp}`, 'DTSTART:20261105T090000Z', `SUMMARY:Twice ${k}`, 'END:VEVENT']),
    'BEGIN:VEVENT', 'UID:bench-0@example.test', 'DTSTAMP:20261001T000000Z', 'LAST-MODIFIED:20261018T000000Z', 'RECURRENCE-ID;TZID=Europe/Tallinn:20260108T090000', 'DTSTART;TZID=Europe/Tallinn:20260108T150000', 'DURATION:PT1H', 'SUMMARY:Only this one', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:orphan@example.test', 'DTSTAMP:20261001T000000Z', 'RECURRENCE-ID:20261201T090000Z', 'DTSTART:20261201T100000Z', 'SUMMARY:Orphan', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTAMP:20261001T000000Z', 'DTSTART:20261203T090000Z', 'SUMMARY:No UID', 'END:VEVENT',
  ];

  it('imports and restores exactly as the reference of packages/core/scripts/ics-procedures.ts', async () => {
    const reference = await import('../../../../../packages/core/scripts/ics-procedures.ts');
    // Stored: 300 groups, half imported earlier (baselines), half made here; the file: 150 of them newer or older, 150 new.
    const stored = parseICalendar(calendarText(0, 300, () => '20261005T000000Z'), { calendarId: 'c1', zones });
    const imported = reference.importCalendar(stored, calendarText(0, 150, () => '20261001T000000Z'), 'c1', zones).calendar;
    const file = calendarText(75, 300, (i) => (i % 2 === 0 ? '20261015T000000Z' : '20260901T000000Z'), extras);
    for (const target of [stored, imported]) {
      const ours = importCalendar(target, file, 'c1', zones);
      const theirs = reference.importCalendar(target, file, 'c1', zones);
      expect(ours.result).toEqual(theirs.result);
      expect(ours.result.skipped).toBe(1);
      expect(serializeICalendar(ours.calendar, zones, { now: NOW })).toBe(serializeICalendar(theirs.calendar, zones, { now: NOW }));
      const restored = restoreCalendar(target, file, 'c1', zones);
      const restoredRef = reference.restoreCalendar(target, file, 'c1', zones);
      expect(restored.result).toEqual(restoredRef.result);
      expect(serializeICalendar(restored.calendar, zones, { now: NOW })).toBe(serializeICalendar(restoredRef.calendar, zones, { now: NOW }));
    }
  });

  it('imports 20,000 events in linear time (the reference procedure took about 10 s)', () => {
    const scale = Number(process.env.THIRTEEN_PERF_SCALE ?? 1) || 1;
    const file = calendarText(0, 20_000, () => '20261015T000000Z');
    const target = newICalendar({ calendarId: 'c1', name: 'Bench', color: '#ea580c' });
    const started = performance.now();
    const first = importCalendar(target, file, 'c1', zones);
    const again = importCalendar(first.calendar, file, 'c1', zones);
    const elapsed = performance.now() - started;
    expect(first.result).toEqual({ added: 20_000, updated: 0, unchanged: 0, skipped: 0 });
    expect(again.result).toEqual({ added: 0, updated: 0, unchanged: 20_000, skipped: 0 });
    expect(elapsed).toBeLessThan(4000 * scale);
  }, 120_000);
});

describe('reading the chosen files', () => {
  it('counts each file, opens Thirteen zips, and makes a plan a restore only when every file is an export', async () => {
    const plan = await readImportFiles(
      [{ name: 'Thirteen calendars 2026-10-19.zip', bytes: fixtureBytes('restore/Thirteen calendars 2026-10-19.zip') }],
      summarize,
    );
    expect(plan.restore).toBe(true);
    expect(plan.sources.map((s) => [s.name, s.thirteen?.kind, s.thirteen?.calendarId, s.thirteen?.color, s.events])).toEqual([
      ['Personal.ics', 'local', '0ab6ab60-378b-4c89-8a97-2770524d4fae', '#ea580c', 4],
      ['Work.ics', 'local', '4074b90e-c55e-46db-882c-8096d5beef46', '#2563eb', 2],
      ['Holidays in Estonia.ics', 'subscription', 'ac8b5389-489e-422e-b633-807e74445762', '#57534e', 16],
    ]);
    expect(plan.sources[2]!.thirteen!.subscription).toEqual({ url: 'https://calendar.example.com/holidays/ee.ics', interval: 'P1D' });

    const mixed = await readImportFiles([picked('google.ics', fixture('cases/google-secret.ics')), picked('Work.ics', fixture('restore/Work.ics'))], summarize);
    expect(mixed.restore).toBe(false);
    expect(mixed.sources.map((s) => [s.name, s.events])).toEqual([
      ['google.ics', 3],
      ['Work.ics', 2],
    ]);
    expect(mixed.sources[1]!.calendarName).toBe('Work');
  });

  it('reports files that are not calendars, have no events, or are too large', async () => {
    const empty = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:x\r\nEND:VCALENDAR\r\n';
    const plan = await readImportFiles(
      [picked('notes.txt', 'Hello'), picked('empty.ics', empty), { name: 'big.ics', bytes: new Uint8Array(25 * 1024 * 1024 + 1) }, picked('broken.ics', fixture('cases/broken.ics'))],
      summarize,
    );
    expect(plan.files.map((f) => [f.name, f.error])).toEqual([
      ['notes.txt', 'import.notIcs'],
      ['empty.ics', 'import.empty'],
      ['big.ics', 'subscribe.error.tooLarge'],
      ['broken.ics', null],
    ]);
    // Unreadable components are counted with the events of the file (§2.17 "{n} events in {file}").
    const broken = plan.sources[0]!;
    expect(broken.summary.skipped).toBeGreaterThan(0);
    expect(broken.events).toBe(broken.summary.groups + broken.summary.skipped);
  });
});

const bodies = (text: string) =>
  text
    .split('BEGIN:VEVENT')
    .slice(1)
    .map((v) => v.slice(0, v.indexOf('END:VEVENT')))
    .sort();

async function yearOf(store: LocalEventStore, year = 2026) {
  await store.loadYear(year);
  const snapshot = store.occurrencesInYear(year);
  if (snapshot.status !== 'ready') throw new Error('not ready');
  return snapshot.occurrences;
}

describe('import, export and restore through the store', () => {
  it('imports google-secret.ics into a new calendar; importing it again changes nothing', async () => {
    const store = await tab(testBrowser());
    const plan = await readImportFiles([picked('google-secret.ics', fixture('cases/google-secret.ics'))], summarize);
    const source = plan.sources[0]!;
    const first = await importIntoStore(store, [{ source, target: { kind: 'new', name: source.calendarName } }], zones);
    expect(first).toMatchObject({ added: 3, updated: 0, unchanged: 0, skipped: 0, partial: 0 });
    const calendar = store.getState().calendars.find((c) => c.title === source.calendarName)!;
    expect(calendar).toMatchObject({ kind: 'local', writable: true, visible: true });
    // A new calendar takes the first palette colour not in use ("Personal" has Orange).
    expect(calendar.color).toBe('#dc2626');
    const again = await importIntoStore(store, [{ source, target: { kind: 'calendar', id: calendar.id } }], zones);
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: 3 });
    // Each imported group is stored as read plus its baseline line (§3.6).
    const text = store.documentText(calendar.id)!;
    expect(text.match(/X-THIRTEEN-IMPORTED-LAST-MODIFIED:/g)!.length).toBeGreaterThanOrEqual(3);
    expect((await yearOf(store)).some((o) => o.calendarId === calendar.id)).toBe(true);
  });

  it('refuses an import into a subscription', async () => {
    const store = await tab(testBrowser());
    const plan = await readImportFiles([picked('a.ics', fixture('cases/google-secret.ics'))], summarize);
    const feed = await readImportFiles([picked('Holidays in Estonia.ics', fixture('restore/Holidays in Estonia.ics'))], summarize);
    await restoreIntoStore(store, feed.sources, zones);
    const holidays = store.getState().calendars.find((c) => c.kind === 'subscription')!;
    await expect(importIntoStore(store, [{ source: plan.sources[0]!, target: { kind: 'calendar', id: holidays.id } }], zones)).rejects.toMatchObject({ code: 'read-only' });
  });

  it('export then import into a fresh browser gives the same events', async () => {
    const store = await tab(testBrowser());
    const personal = store.getState().calendars[0]!;
    await store.createEvent(timedDraft(personal.id, 'Dentist', '2026-10-21T10:00', '2026-10-21T10:45'));
    await store.createEvent(timedDraft(personal.id, 'Sauna', '2026-10-24T18:00', '2026-10-24T20:00', { location: 'Kalma, Tallinn' }));
    const [file] = exportFiles(store, [personal.id], zones, new Date('2026-10-19T06:41:00Z'));
    expect(file!.name).toBe('Personal.ics');
    expect(file!.text).toContain(`X-THIRTEEN-CALENDAR-ID:${personal.id}\r\n`);
    expect(file!.text).toContain('X-WR-CALNAME:Personal\r\n');
    expect(file!.text).toContain('X-APPLE-CALENDAR-COLOR:#EA580C\r\n');
    // The export is the stored document (§3.6: storage and export cannot drift).
    expect(file!.text).toBe(store.documentText(personal.id));

    const other = await tab(testBrowser());
    const plan = await readImportFiles([picked(file!.name, file!.text)], summarize);
    // A Thirteen export on its own is a restore; imported as an ordinary file it is merged with baselines.
    expect(plan.restore).toBe(true);
    const target = other.getState().calendars[0]!;
    const result = await importIntoStore(other, [{ source: plan.sources[0]!, target: { kind: 'calendar', id: target.id } }], zones);
    expect(result).toMatchObject({ added: 2, updated: 0, unchanged: 0 });
    const imported = other.documentText(target.id)!;
    expect(bodies(imported).map((b) => b.replace(/X-THIRTEEN-IMPORTED-LAST-MODIFIED:[^\r]*\r\n/, ''))).toEqual(bodies(file!.text));
    const rows = async (s: LocalEventStore) => (await yearOf(s)).map((o) => [o.title, formatLocalDateTime(o.start), formatLocalDateTime(o.end), o.location]);
    expect(await rows(other)).toEqual(await rows(store));
  });

  it('export all (two local calendars and a subscription) then restore into a fresh browser keeps names, colours, kinds, events and links', async () => {
    const store = await tab(testBrowser());
    const personal = store.getState().calendars[0]!;
    const work = await store.createCalendar({ title: 'Work', color: '#2563eb' });
    await store.createEvent(timedDraft(personal.id, 'Dentist', '2026-10-21T10:00', '2026-10-21T10:45'));
    await store.createEvent(timedDraft(work.id, 'Sprint planning', '2026-10-19T09:30', '2026-10-19T10:30'));
    // The subscription comes from Thirteen's own export of one (the fixture set's feed).
    const feed = await readImportFiles([picked('Holidays in Estonia.ics', fixture('restore/Holidays in Estonia.ics'))], summarize);
    await restoreIntoStore(store, feed.sources, zones);
    const calendars = store.getState().calendars;
    expect(calendars.map((c) => [c.title, c.kind])).toEqual([
      ['Personal', 'local'],
      ['Work', 'local'],
      ['Holidays in Estonia', 'subscription'],
    ]);

    const now = new Date(2026, 9, 19, 9, 41);
    const files = exportFiles(store, calendars.map((c) => c.id), zones, now);
    const download = exportDownload(files, now, (date) => `Thirteen calendars ${date}.zip`)!;
    expect(download.name).toBe('Thirteen calendars 2026-10-19.zip');
    expect(download.type).toBe('application/zip');
    expect(readZip(download.bytes).map((e) => e.name)).toEqual(['Personal.ics', 'Work.ics', 'Holidays in Estonia.ics']);
    expect(files[2]!.text).toContain('X-THIRTEEN-SUBSCRIPTION-URL:https://calendar.example.com/holidays/ee.ics\r\n');
    expect(files[2]!.text).toContain('X-THIRTEEN-SUBSCRIPTION-INTERVAL:P1D\r\n');
    // Exporting a restored subscription again gives the same text.
    expect(exportText(store, calendars[2]!.id, zones, now)).toBe(files[2]!.text);

    const fresh = await tab(testBrowser());
    const plan = await readImportFiles([{ name: download.name, bytes: download.bytes }], summarize);
    expect(plan.restore).toBe(true);
    const restored = await restoreIntoStore(fresh, plan.sources, zones);
    expect(restored).toMatchObject({ calendars: 3, keptNewer: 0 });
    expect(restored.subscriptionIds).toEqual([calendars[2]!.id]);
    const after = fresh.getState().calendars.filter((c) => calendars.some((o) => o.id === c.id));
    const shape = (c: (typeof calendars)[number]) => [c.id, c.title, c.color, c.kind, c.subscription?.url ?? null, c.subscription?.interval ?? null];
    expect(after.map(shape)).toEqual(calendars.map(shape));
    for (const calendar of calendars) expect(bodies(fresh.documentText(calendar.id)!)).toEqual(bodies(store.documentText(calendar.id)!));
    const rows = async (s: LocalEventStore) => (await yearOf(s)).map((o) => [o.calendarId, o.title, formatLocalDateTime(o.start)]);
    expect(await rows(fresh)).toEqual(await rows(store));

    // The fresh browser's own empty "Personal" gave way: it has exactly the backed-up calendars (B8).
    expect(fresh.getState().calendars.map(shape)).toEqual(calendars.map(shape));

    // The same backup again leaves one calendar each, unchanged.
    const twice = await restoreIntoStore(fresh, plan.sources, zones);
    expect(twice).toMatchObject({ calendars: 3, keptNewer: 0 });
    expect(fresh.getState().calendars.filter((c) => c.title === 'Work')).toHaveLength(1);
  });

  it('a fresh browser keeps its own "Personal" when it holds an event or when only subscriptions are restored (B8)', async () => {
    const feed = await readImportFiles([picked('Holidays in Estonia.ics', fixture('restore/Holidays in Estonia.ics'))], summarize);
    const onlyFeed = await tab(testBrowser());
    const own = onlyFeed.getState().calendars[0]!;
    await restoreIntoStore(onlyFeed, feed.sources, zones);
    expect(onlyFeed.getState().calendars.map((c) => c.id)).toContain(own.id);

    const used = await tab(testBrowser());
    const personal = used.getState().calendars[0]!;
    const plan = await readImportFiles([picked('Personal.ics', fixture('restore/Personal.ics'))], summarize);
    const tickets = (await readImportFiles([picked('tickets.ics', fixture('cases/google-secret.ics'))], summarize)).sources[0]!;
    await importIntoStore(used, [{ source: tickets, target: { kind: 'calendar', id: personal.id } }], zones);
    await restoreIntoStore(used, plan.sources, zones);
    expect(used.getState().calendars.map((c) => c.id)).toContain(personal.id);
    expect(used.getState().calendars).toHaveLength(2);
  });

  it('an older backup keeps an event edited since and counts it', async () => {
    const store = await tab(testBrowser());
    const plan = await readImportFiles([picked('Personal.ics', fixture('restore/Personal.ics'))], summarize);
    await restoreIntoStore(store, plan.sources, zones);
    const older = await readImportFiles([picked('older.ics', fixture('restore/older.ics'))], summarize);
    const result = await restoreIntoStore(store, older.sources, zones);
    expect(result).toMatchObject({ calendars: 1, keptNewer: 1 });
    expect(store.documentText('0ab6ab60-378b-4c89-8a97-2770524d4fae')).toBe(fixture('restore/older-restored.ics'));
  });

  it('restores an id that belongs to a calendar of the other kind into a new calendar', async () => {
    const store = await tab(testBrowser());
    const feed = await readImportFiles([picked('Holidays in Estonia.ics', fixture('restore/Holidays in Estonia.ics'))], summarize);
    const local = fixture('restore/Personal.ics').replace('X-THIRTEEN-CALENDAR-ID:0ab6ab60-378b-4c89-8a97-2770524d4fae', 'X-THIRTEEN-CALENDAR-ID:ac8b5389-489e-422e-b633-807e74445762');
    await restoreIntoStore(store, feed.sources, zones);
    const plan = await readImportFiles([picked('Personal.ics', local)], summarize);
    const result = await restoreIntoStore(store, plan.sources, zones);
    expect(result.calendarIds[0]).not.toBe('ac8b5389-489e-422e-b633-807e74445762');
    expect(store.getState().calendars.find((c) => c.id === result.calendarIds[0])).toMatchObject({ kind: 'local', title: 'Personal' });
  });

  it('imports several files at once, each into its own target, in one write', async () => {
    const store = await tab(testBrowser());
    const personal = store.getState().calendars[0]!;
    const plan = await readImportFiles(
      [picked('google-secret.ics', fixture('cases/google-secret.ics')), picked('outlook.ics', fixture('cases/outlook-publish.ics')), picked('tickets.ics', fixture('cases/missing-uid.ics'))],
      summarize,
    );
    expect(plan.restore).toBe(false);
    const [google, outlook, tickets] = plan.sources;
    const writes: (readonly string[])[] = [];
    store.onWrite((ids) => writes.push(ids));
    const result = await importIntoStore(
      store,
      [
        { source: google!, target: { kind: 'new', name: google!.calendarName } },
        { source: outlook!, target: { kind: 'new', name: outlook!.calendarName } },
        { source: tickets!, target: { kind: 'calendar', id: personal.id } },
      ],
      zones,
    );
    expect(writes).toHaveLength(1);
    expect(result.added).toBe(google!.summary.groups + outlook!.summary.groups + tickets!.summary.groups);
    const titles = store.getState().calendars.map((c) => [c.title, c.color]);
    expect(titles).toHaveLength(3);
    // New calendars take distinct palette colours.
    expect(new Set(titles.map(([, color]) => color)).size).toBe(3);
    // Derived UIDs come from the target calendar's id (§2.17): the same file again changes nothing.
    const again = await importIntoStore(store, [{ source: tickets!, target: { kind: 'calendar', id: personal.id } }], zones);
    expect(again).toMatchObject({ added: 0, unchanged: tickets!.summary.groups });
  });

  it('an empty Thirteen export is still a calendar to restore', async () => {
    const source = await tab(testBrowser());
    const work = await source.createCalendar({ title: 'Work', color: '#2563eb' });
    const [file] = exportFiles(source, [work.id], zones, new Date());
    const plan = await readImportFiles([picked(file!.name, file!.text)], summarize);
    expect(plan.files[0]!.error).toBeNull();
    expect(plan.restore).toBe(true);
    const fresh = await tab(testBrowser());
    await restoreIntoStore(fresh, plan.sources, zones);
    expect(fresh.getState().calendars.find((c) => c.id === work.id)).toMatchObject({ title: 'Work', color: '#2563eb', kind: 'local' });
  });

  it('makes file names unique and safe', async () => {
    const store = await tab(testBrowser());
    const a = await store.createCalendar({ title: 'Work' });
    const b = await store.createCalendar({ title: 'work' });
    const c = await store.createCalendar({ title: 'Home/Office: 2026?' });
    expect(exportFiles(store, [a.id, b.id, c.id], zones, new Date()).map((f) => f.name)).toEqual(['Work.ics', 'work (2).ics', 'Home_Office_ 2026_.ics']);
    expect(fileNameOf('  ..  ')).toBe('Calendar');
  });
});
