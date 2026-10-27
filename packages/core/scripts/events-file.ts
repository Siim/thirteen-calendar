/**
 * `fixtures/events.json` (docs/EVENTS.md §5.5), the golden file the Swift,
 * Kotlin and C# ports test against, and `fixtures/mockup/mockup-events.json`
 * (§6.7): assembly and serialization (task C6).
 *
 * The sections come from the builders of `events-fixtures.ts` (C1 to C3),
 * `recurrence-fixtures.ts` (C4) and `layout-fixtures.ts` (C5), plus the two
 * zone sections built here:
 *
 * - `zones`: real IANA zones through Node's `Intl` and core's `zonedToUtc` /
 *   `utcToZoned`. The only section a port runs through its own resolver
 *   (`FoundationZoneResolver`, `JavaTimeZoneResolver`, `WindowsZoneResolver`,
 *   the web's `Intl` resolver); a port that cannot answer a case as tzdata
 *   does lists it by its `zone` and `local` or `utc` value, with the reason.
 * - `zoneOffsets`: every zone and UTC year that the `untils`, `series` and
 *   `alarmInstants` sections, the mockup file and the zone fixture hooks
 *   (`fixtures/ics`, task C8) asked about while they were computed, recorded
 *   from `Intl` (see `zone-resolvers.ts`). Every port replays those sections
 *   through a `RecordedZoneResolver` built from this table only.
 *
 * File format: version 1 (`"complete": true` once every section of §5.5 is
 * present, removed at 1.0), the envelope `version`, `complete`, `generatedBy`,
 * `spec`, `tzVersion` (Node's `process.versions.tz` when the content was
 * generated) and `counts` (cases per section, asserted by every port), then
 * the sections in the order of §5.5. Layout as `conversions.json`: a pretty
 * envelope, one compact JSON value per line in arrays, a trailing newline.
 *
 * Everything here is deterministic for a given tzdata: the zone cases use
 * dates whose rules are settled history, so a newer Node changes at most
 * `tzVersion` (see {@link sameContent}).
 */

import {
  type LocalDateTime,
  type ZoneResolver,
  formatLocalDateTime,
  parseLocalDateTime,
  utcToZoned,
  zonedToUtc,
} from '../src/events/index.ts';
import { C1_SECTIONS, C2_SECTIONS, C3_SECTIONS } from './events-fixtures.ts';
import { C5_SECTIONS } from './layout-fixtures.ts';
import { icsFixtureHook } from './ics-fixtures.ts';
import { MOCKUP_KEYS, type MockupFile, buildMockupEvents, mockupOccurrences } from './mockup-events.ts';
import { C4_SECTIONS, C4_ZONE_SECTIONS } from './recurrence-fixtures.ts';
import { type ZoneOffsetsEntry, intlZoneResolver, recordingZoneResolver } from './zone-resolvers.ts';

/** Repository-relative location of `fixtures/events.json`. */
export const EVENTS_FILE_URL: URL = new URL('../../../fixtures/events.json', import.meta.url);

// ---------------------------------------------------------------------------
// zones (§5.5)
// ---------------------------------------------------------------------------

/** A `zones` case: wall clock in `zone` to UTC, or UTC to wall clock; `null` outside years 1 to 9999. */
export type ZoneCase =
  | { readonly zone: string; readonly local: string; readonly expectedUtc: string | null }
  | { readonly zone: string; readonly utc: string; readonly expectedLocal: string | null };

/** The `zones` rows: zone, direction and value. */
const ZONE_ROWS: readonly (readonly [zone: string, direction: 'local' | 'utc', value: string])[] = [
  // Gaps and overlaps (§3.3): a gap moves forward by its length, an overlap takes the earlier instant.
  ['America/New_York', 'local', '2026-03-08T02:30'],
  ['America/New_York', 'local', '2026-11-01T01:30'],
  ['America/New_York', 'local', '2026-01-15T09:00'],
  ['America/New_York', 'local', '2026-07-01T12:00'],
  ['Europe/Tallinn', 'local', '2026-03-29T03:30'],
  ['Europe/Tallinn', 'local', '2026-10-25T03:30'],
  ['Europe/Tallinn', 'local', '2026-10-19T09:41'],
  // A 30-minute gap, a skipped day (the offset before the gap), a skipped midnight.
  ['Australia/Lord_Howe', 'local', '2026-10-04T02:15'],
  ['Pacific/Apia', 'local', '2011-12-30T09:00'],
  ['America/Sao_Paulo', 'local', '2018-11-04T00:00'],
  // Odd offsets, the far east and west, UTC.
  ['Asia/Kathmandu', 'local', '2026-10-19T12:00'],
  ['Pacific/Kiritimati', 'local', '2027-01-01T01:00'],
  ['Pacific/Honolulu', 'local', '2027-01-01T01:00'],
  ['UTC', 'local', '2026-10-19T09:41'],
  // The range edges: years 10000 and 0 are null; an end at 24:00 converts.
  ['America/New_York', 'local', '9999-12-31T23:00'],
  ['Asia/Tokyo', 'local', '0001-01-01T01:00'],
  ['Europe/Tallinn', 'local', '9999-12-31T24:00'],
  // The reverse conversions: UNTIL=20261231T215959Z is the last minute of 2026 in Tallinn.
  ['Europe/Tallinn', 'utc', '2026-12-31T21:59'],
  ['Europe/Tallinn', 'utc', '2026-03-29T01:00'],
  ['America/New_York', 'utc', '2026-03-08T06:59'],
  ['America/New_York', 'utc', '2026-03-08T07:00'],
  ['America/New_York', 'utc', '2026-11-01T05:30'],
  ['America/New_York', 'utc', '2026-11-01T06:30'],
  ['Australia/Lord_Howe', 'utc', '2026-10-03T15:30'],
  ['Pacific/Apia', 'utc', '2011-12-30T10:00'],
  ['Asia/Kathmandu', 'utc', '2026-10-19T06:15'],
  ['UTC', 'utc', '2026-10-19T09:41'],
  ['Pacific/Kiritimati', 'utc', '9999-12-31T10:00'],
  ['America/New_York', 'utc', '0001-01-01T00:00'],
];

const text = (value: LocalDateTime | null) => (value === null ? null : formatLocalDateTime(value));

/**
 * `zones` (§5.5): gaps, overlaps, a 30-minute gap, a skipped day, a skipped
 * midnight, a +05:45 zone, UTC, the reverse conversions and the range edges,
 * through `zones` (Node's `Intl`).
 */
export function buildZones(zones: ZoneResolver = intlZoneResolver()): ZoneCase[] {
  return ZONE_ROWS.map(([zone, direction, value]) =>
    direction === 'local'
      ? { zone, local: value, expectedUtc: text(zonedToUtc(parseLocalDateTime(value), zone, zones)) }
      : { zone, utc: value, expectedLocal: text(utcToZoned(parseLocalDateTime(value), zone, zones)) },
  );
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** A file a zone fixture hook writes: its location and exact text, or its bytes. */
export type GeneratedFile = { readonly url: URL; readonly text: string } | { readonly url: URL; readonly bytes: Uint8Array };

/**
 * A builder of further fixture files whose expectations need zone data
 * (`fixtures/ics`, task C8). It runs through the same recording resolver as
 * the zone sections, before `zoneOffsets` is written, so the recorded table
 * covers it and every port can replay it through the `RecordedZoneResolver`.
 */
export type ZoneFixtureHook = (zones: ZoneResolver) => readonly GeneratedFile[];

/** The zone fixture hooks `pnpm fixtures` and the staleness test run: `fixtures/ics` (task C8). */
export const ZONE_FIXTURE_HOOKS: readonly ZoneFixtureHook[] = [icsFixtureHook];

/** Section names in file order (§5.5). */
export const EVENTS_SECTIONS = [
  'localDateTimes',
  'endForms',
  'wallClock',
  'zoneMath',
  'rrules',
  'rruleEquality',
  'untils',
  'dateLists',
  'thirteenRules',
  'ruleFromStart',
  'expansions',
  'endBefore',
  'splits',
  'retimes',
  'seriesEdits',
  'series',
  'recognitions',
  'presets',
  'descriptions',
  'nextOccurrences',
  'repeatNotes',
  'adaptations',
  'drafts',
  'newDrafts',
  'merges',
  'alarms',
  'alarmInstants',
  'chipTimes',
  'monthColumns',
  'monthLayouts',
  'weekLayouts',
  'dayLayouts',
  'agendas',
  'yearMarks',
  'zones',
  'zoneOffsets',
] as const;

export type EventsSection = (typeof EVENTS_SECTIONS)[number];

/** Section values by name. */
export type EventsSections = {
  readonly [K in Exclude<EventsSection, 'zones' | 'zoneOffsets' | 'untils' | 'series' | 'alarmInstants'>]: K extends keyof typeof C1_SECTIONS
    ? ReturnType<(typeof C1_SECTIONS)[K]>
    : K extends keyof typeof C2_SECTIONS
      ? ReturnType<(typeof C2_SECTIONS)[K]>
      : K extends keyof typeof C3_SECTIONS
        ? ReturnType<(typeof C3_SECTIONS)[K]>
        : K extends keyof typeof C4_SECTIONS
          ? ReturnType<(typeof C4_SECTIONS)[K]>
          : K extends keyof typeof C5_SECTIONS
            ? ReturnType<(typeof C5_SECTIONS)[K]>
            : never;
} & {
  readonly untils: ReturnType<(typeof C2_SECTIONS)['untils']>;
  readonly series: ReturnType<(typeof C4_ZONE_SECTIONS)['series']>;
  readonly alarmInstants: ReturnType<(typeof C4_ZONE_SECTIONS)['alarmInstants']>;
  readonly zones: ZoneCase[];
  readonly zoneOffsets: ZoneOffsetsEntry[];
};

/** The whole `fixtures/events.json`. */
export type EventsFile = {
  readonly version: 1;
  readonly complete: true;
  readonly generatedBy: '@thirteen/core';
  readonly spec: 'docs/EVENTS.md';
  readonly tzVersion: string;
  readonly counts: { readonly [K in EventsSection]: number };
} & EventsSections;

/** Top-level keys of `fixtures/events.json`, in file order. */
export const EVENTS_KEYS: readonly (keyof EventsFile)[] = ['version', 'complete', 'generatedBy', 'spec', 'tzVersion', 'counts', ...EVENTS_SECTIONS];

/** Everything `pnpm fixtures` writes for the events feature. */
export interface EventFixtures {
  readonly events: EventsFile;
  readonly mockup: MockupFile;
  /** The files of {@link ZONE_FIXTURE_HOOKS}. */
  readonly extra: readonly GeneratedFile[];
}

/**
 * Builds `events.json`, the mockup file and the hooks' files. Every builder
 * that needs zones except `zones` runs through one recording wrapper of
 * `base` (Node's `Intl` by default), and `zoneOffsets` is what it recorded.
 * The layout sections built on the mockup set take the mockup file's
 * occurrences.
 */
export function buildEventFixtures(options?: {
  readonly base?: ZoneResolver;
  readonly hooks?: readonly ZoneFixtureHook[];
  readonly tzVersion?: string;
}): EventFixtures {
  const base = options?.base ?? intlZoneResolver();
  const recorder = recordingZoneResolver(base);
  const mockup = buildMockupEvents(recorder);
  const occurrences = mockupOccurrences(mockup);
  const built = {
    ...Object.fromEntries(Object.entries(C1_SECTIONS).map(([name, build]) => [name, build()])),
    ...Object.fromEntries(Object.entries(C2_SECTIONS).map(([name, build]) => [name, name === 'untils' ? build(recorder) : build()])),
    ...Object.fromEntries(Object.entries(C3_SECTIONS).map(([name, build]) => [name, build()])),
    ...Object.fromEntries(Object.entries(C4_SECTIONS).map(([name, build]) => [name, build()])),
    series: C4_ZONE_SECTIONS.series(recorder),
    alarmInstants: C4_ZONE_SECTIONS.alarmInstants(recorder),
    ...Object.fromEntries(Object.entries(C5_SECTIONS).map(([name, build]) => [name, build(occurrences)])),
    zones: buildZones(base),
  } as Record<string, unknown[]>;
  const extra = (options?.hooks ?? ZONE_FIXTURE_HOOKS).flatMap((hook) => hook(recorder));
  built.zoneOffsets = recorder.offsets();
  const missing = EVENTS_SECTIONS.filter((name) => !Array.isArray(built[name]));
  const unknown = Object.keys(built).filter((name) => !(EVENTS_SECTIONS as readonly string[]).includes(name));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(`events.json sections do not match §5.5: missing ${missing.join(', ') || 'none'}, unknown ${unknown.join(', ') || 'none'}`);
  }
  const counts = Object.fromEntries(EVENTS_SECTIONS.map((name) => [name, built[name]!.length]));
  const events = {
    version: 1,
    complete: true,
    generatedBy: '@thirteen/core',
    spec: 'docs/EVENTS.md',
    tzVersion: options?.tzVersion ?? process.versions.tz ?? 'unknown',
    counts,
    ...Object.fromEntries(EVENTS_SECTIONS.map((name) => [name, built[name]])),
  } as unknown as EventsFile;
  return { events, mockup, extra };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * The layout of `conversions.json`: the envelope and the objects directly
 * inside it pretty-printed, every array element at those levels on its own
 * line as compact JSON.
 */
function render(value: unknown, indent: string, depth: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = `${indent}  `;
    return `[\n${value.map((item) => `${inner}${JSON.stringify(item)}`).join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object' && value !== null && depth < 2) {
    const inner = `${indent}  `;
    const entries = Object.entries(value).map(([key, child]) => `${inner}${JSON.stringify(key)}: ${render(child, inner, depth + 1)}`);
    return `{\n${entries.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function serialize(value: object, keys: readonly string[]): string {
  const ordered = Object.fromEntries(keys.map((key) => [key, (value as Record<string, unknown>)[key]]));
  return `${render(ordered, '', 0)}\n`;
}

/** Deterministic text of `fixtures/events.json` (ends with a newline). */
export function serializeEventsFile(file: EventsFile): string {
  return serialize(file, EVENTS_KEYS);
}

/** Deterministic text of `fixtures/mockup/mockup-events.json` (ends with a newline). */
export function serializeMockupFile(file: MockupFile): string {
  return serialize(file, MOCKUP_KEYS);
}

const TZ_VERSION_LINE = /^ {2}"tzVersion": ("[^"\n]*"),$/m;

/** The `tzVersion` of a serialized `events.json`, or null. */
export function tzVersionOf(text: string): string | null {
  const match = TZ_VERSION_LINE.exec(text);
  return match === null ? null : (JSON.parse(match[1]!) as string);
}

/**
 * `true` when two serialized `events.json` texts differ at most in
 * `tzVersion`: the content was generated from tzdata that agree on every
 * zone case, so `pnpm fixtures` keeps the committed file (and its
 * `tzVersion`) instead of rewriting it for a newer Node.
 */
export function sameContent(a: string, b: string): boolean {
  const strip = (t: string) => t.replace(TZ_VERSION_LINE, '  "tzVersion": "",');
  return strip(a) === strip(b);
}
