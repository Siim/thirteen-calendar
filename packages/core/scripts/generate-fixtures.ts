/**
 * Regenerates the golden fixture files. Run with `pnpm fixtures`
 * (Node ≥ 22.18 executes this TypeScript file natively via type stripping):
 *
 * - `fixtures/conversions.json` (the calendar engine, docs/SPEC.md §4.2);
 * - `fixtures/events.json` (docs/EVENTS.md §5.5);
 * - `fixtures/mockup/mockup-events.json` (docs/EVENTS.md §6.7);
 * - `fixtures/ics/` (docs/EVENTS.md §5.6), through the zone fixture hook of
 *   `events-file.ts`; the generator owns that folder and removes files it no
 *   longer writes.
 *
 * A file is written only when its content changed. `events.json` is also
 * kept when only its `tzVersion` would change (a newer Node whose tzdata
 * agrees on every zone case), so the output does not depend on the Node
 * version that runs it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS_FILE_URL, buildEventFixtures, sameContent, serializeEventsFile, serializeMockupFile } from './events-file.ts';
import { FIXTURE_FILE_URL, buildFixtures, serializeFixtures } from './fixtures.ts';
import { ICS_DIR_URL } from './ics-fixtures.ts';
import { MOCKUP_FILE_URL } from './mockup-events.ts';

/** Writes `text` to `url` unless the file already holds it (or `keep` says its content is the same). */
function write(url: URL, text: string, summary: string, keep: (existing: string) => boolean = (existing) => existing === text): void {
  const path = fileURLToPath(url);
  const size = `${(Buffer.byteLength(text) / 1024).toFixed(1)} KiB`;
  if (existsSync(path) && keep(readFileSync(path, 'utf8'))) {
    console.log(`Unchanged ${path} (${summary}, ${size})`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  console.log(`Wrote ${path} (${summary}, ${size})`);
}

/** Writes `bytes` to `url` unless the file already holds them; returns `true` when it wrote. */
function writeBytes(url: URL, bytes: Uint8Array): boolean {
  const path = fileURLToPath(url);
  if (existsSync(path) && Buffer.from(readFileSync(path)).equals(Buffer.from(bytes))) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return true;
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]));
}

const conversions = buildFixtures();
write(FIXTURE_FILE_URL, serializeFixtures(conversions), `${conversions.cases.length} cases`);

const { events, mockup, extra } = buildEventFixtures();
const eventsText = serializeEventsFile(events);
const caseCount = Object.values(events.counts).reduce((sum, n) => sum + n, 0);
write(EVENTS_FILE_URL, eventsText, `${caseCount} cases in ${Object.keys(events.counts).length} sections, tzdata ${events.tzVersion}`, (existing) =>
  sameContent(existing, eventsText),
);
write(MOCKUP_FILE_URL, serializeMockupFile(mockup), `${mockup.events.length} events, ${mockup.occurrences.length} occurrences`);
// The zone fixture hooks: fixtures/ics, which the generator owns entirely (files it no longer writes are removed).
const icsDir = fileURLToPath(ICS_DIR_URL);
let written = 0;
for (const file of extra) {
  const bytes = 'text' in file ? new TextEncoder().encode(file.text) : file.bytes;
  if (writeBytes(file.url, bytes)) written++;
}
const wanted = new Set(extra.map((file) => fileURLToPath(file.url)));
const stale = filesUnder(icsDir).filter((path) => !wanted.has(path));
for (const path of stale) rmSync(path);
console.log(`${written === 0 && stale.length === 0 ? 'Unchanged' : 'Wrote'} ${icsDir} (${extra.length} files, ${written} written, ${stale.length} removed)`);
