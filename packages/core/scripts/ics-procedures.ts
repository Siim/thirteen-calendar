/**
 * Procedures of the `.ics` conformance set (`fixtures/ics/edits`, `imports`
 * and `restore`, docs/EVENTS.md §5.6, task C8): a document, steps applied to
 * it in order (an edit, an import, a restore), and the exact document after
 * each step.
 *
 * Every procedure file (`edits/*.json`, `imports/*.json`, `restore/*.json`)
 * holds scenarios. A scenario starts from a file of the set or a new empty
 * Thirteen calendar, and each step starts from the previous step's expected
 * document, read with `parseICalendar(text, { calendarId, zones })` and
 * written with `serializeICalendar(calendar, zones, { now })`, `zones` being
 * the `RecordedZoneResolver` of `fixtures/events.json`.
 *
 * - **edit**: `changes` applied in order (`set` replaces fields of one member
 *   of a UID group, `untils` rewrites the `UNTIL`s of its master with
 *   `withRetimedUntils`, `add` adds a new group, `remove` removes one); every
 *   touched group goes through `replaceGroup`, so it is re-serialized. The
 *   field values are what the platform computes (with `retimeExceptions`,
 *   `allDayEnd`, `untilFor`); the generator derives them with the engine.
 * - **import**: {@link importCalendar}, the reference of §2.17 step 3 and §3.6.
 * - **restore**: {@link restoreCalendar}, the reference of §2.17 "Restore".
 * @module
 */

import { type LocalDateTime, type ZoneResolver, compareLocalDateTime, parseLocalDateTime } from '../src/events/index.ts';
import { type EventRecurrence, type ExtraDate, type OriginalDate, recognizeRecurrence, retimeExceptions } from '../src/events/recurrence.ts';
import {
  type IcsCalendar,
  type IcsDateValue,
  type IcsEvent,
  type IcsGroup,
  type IcsRdate,
  eventVersion,
  expandCalendar,
  groupVersion,
  icsRecognitionInput,
  mergeTimeZones,
  newICalendar,
  parseICalendar,
  removeGroup,
  renameCollidingTimeZones,
  replaceGroup,
  serializeICalendar,
  withImportBaseline,
  withRetimedUntils,
} from '../src/ics/index.ts';
import { memberKey } from '../src/ics/parse.ts';
import { durationMinutes, formatDurationMinutes, parseDuration, sameDateValue } from '../src/ics/values.ts';
import { type UntilRewriteJson, untilRewriteJson } from './recurrence-fixtures.ts';
import { dateFromJson } from './events-fixtures.ts';
import {
  type IcsDateValueJson,
  type IcsEventFieldsJson,
  type IcsEventJson,
  type IcsWarningJson,
  icsDateValueFromJson,
  icsDateValueJson,
  icsEventFieldsFromJson,
  icsEventFromJson,
  icsWarningJson,
} from './ics-json.ts';
import { type OccurrenceJson, occurrenceJson } from './layout-fixtures.ts';
import type { WindowSpec } from './ics-cases.ts';

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** A change of an edit step. */
export type ChangeJson =
  /** Replaces fields of one member (the master when `recurrenceId` is null) of the group of `uid`. */
  | { readonly op: 'set'; readonly uid: string; readonly recurrenceId: IcsDateValueJson | null; readonly fields: Partial<IcsEventFieldsJson> }
  /** Rewrites the `UNTIL` of the listed rules of the master with `withRetimedUntils` (after the `set` changes before it). */
  | { readonly op: 'untils'; readonly uid: string; readonly untils: readonly UntilRewriteJson[] }
  /** Adds a new group whose master is `event` (a new event: no text it was read from). */
  | { readonly op: 'add'; readonly event: IcsEventJson }
  /** Removes the group of `uid`. */
  | { readonly op: 'remove'; readonly uid: string };

/** UID groups counted by an import (§2.17 step 4); `skipped`: further masters of one UID in the file. */
export interface ImportResult {
  readonly added: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly skipped: number;
}

/** UID groups of the backup counted by a restore (§2.17 "Restore"); `keptNewer`: groups the calendar holds in a later version. */
export interface RestoreResult {
  readonly added: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly keptNewer: number;
}

/** Occurrences of a document in a device zone and window. */
export interface ExpansionJson {
  readonly deviceZone: string;
  readonly window: WindowSpec;
  readonly warnings: readonly IcsWarningJson[];
  readonly occurrences: readonly OccurrenceJson[];
}

export type StepJson =
  | { readonly kind: 'edit'; readonly changes: readonly ChangeJson[]; readonly expected: string; readonly expansions?: readonly ExpansionJson[] }
  | { readonly kind: 'import'; readonly file: string; readonly result: ImportResult; readonly expected: string; readonly expansions?: readonly ExpansionJson[] }
  | { readonly kind: 'restore'; readonly file: string; readonly result: RestoreResult; readonly expected: string; readonly expansions?: readonly ExpansionJson[] };

/** Where a scenario starts: a file of the set, or a new empty Thirteen calendar (`newICalendar`). */
export type StartJson = { readonly file: string } | { readonly new: { readonly calendarId: string; readonly name: string; readonly color: string } };

export interface ScenarioJson {
  readonly name: string;
  /** The id every read uses (derived UIDs, §2.17) and the calendar's `X-THIRTEEN-CALENDAR-ID` for Thirteen documents. */
  readonly calendarId: string;
  readonly start: StartJson;
  readonly steps: readonly StepJson[];
}

export interface ProcedureFile {
  readonly version: 1;
  readonly description: string;
  /** UTC "now" of every write (`serializeICalendar` option, `LAST-MODIFIED` of edits). */
  readonly now: string;
  readonly scenarios: readonly ScenarioJson[];
}

/** Keys of {@link ProcedureFile} in file order. */
export const PROCEDURE_KEYS = ['version', 'description', 'now', 'scenarios'] as const;

// ---------------------------------------------------------------------------
// Applying steps (the port side)
// ---------------------------------------------------------------------------

const membersOf = (group: IcsGroup): IcsEvent[] => [...(group.master === null ? [] : [group.master]), ...group.overrides];

function groupOf(calendar: IcsCalendar, uid: string): IcsGroup {
  const group = calendar.groups.find((g) => g.uid === uid);
  if (group === undefined) throw new RangeError(`The calendar has no group ${uid}`);
  return group;
}

/** The calendar with `changes` applied in order (see the module documentation). */
export function applyChanges(calendar: IcsCalendar, changes: readonly ChangeJson[], zones: ZoneResolver): IcsCalendar {
  let next = calendar;
  for (const change of changes) {
    switch (change.op) {
      case 'set': {
        const group = groupOf(next, change.uid);
        const recurrenceId = change.recurrenceId === null ? null : icsDateValueFromJson(change.recurrenceId);
        const matches = (e: IcsEvent) => (recurrenceId === null ? e.recurrenceId === null : e.recurrenceId !== null && sameDateValue(e.recurrenceId, recurrenceId));
        if (!membersOf(group).some(matches)) throw new RangeError(`Group ${change.uid} has no such member`);
        const update = (e: IcsEvent): IcsEvent => (matches(e) ? { ...e, ...icsEventFieldsFromJson(change.fields) } : e);
        next = replaceGroup(next, { uid: group.uid, master: group.master === null ? null : update(group.master), overrides: group.overrides.map(update) });
        break;
      }
      case 'untils': {
        const group = groupOf(next, change.uid);
        if (group.master === null) throw new RangeError(`Group ${change.uid} has no master`);
        const untils = change.untils.map((u) => ({ rule: u.rule, index: u.index, endDate: dateFromJson(u.endDate) }));
        next = replaceGroup(next, { ...group, master: withRetimedUntils(group.master, untils, next, zones) });
        break;
      }
      case 'add': {
        const event = icsEventFromJson(change.event);
        next = replaceGroup(next, { uid: event.uid, master: event, overrides: [] });
        break;
      }
      case 'remove':
        groupOf(next, change.uid);
        next = removeGroup(next, change.uid);
        break;
    }
  }
  return next;
}

const later = (a: LocalDateTime | null, b: LocalDateTime | null): boolean => a !== null && (b === null || compareLocalDateTime(a, b) > 0);

const valueAsUtc = (value: IcsDateValue | null): LocalDateTime | null =>
  value === null ? null : value.kind === 'date' ? { date: value.date, minute: 0 } : value.value;

/** The import baseline of a stored group (§2.17): its master's, or for a group without a master the latest of its overrides'. */
function storedBaseline(group: IcsGroup): LocalDateTime | null {
  if (group.master !== null) return valueAsUtc(group.master.importedLastModified);
  return group.overrides.reduce<LocalDateTime | null>((best, o) => {
    const b = valueAsUtc(o.importedLastModified);
    return later(b, best) ? b : best;
  }, null);
}

function versionOrFail(version: LocalDateTime | null, uid: string): LocalDateTime {
  if (version === null) throw new RangeError(`Group ${uid} has neither LAST-MODIFIED nor DTSTAMP; the set's inputs always carry one`);
  return version;
}

/**
 * Imports a calendar text into `target` (docs/EVENTS.md §2.17 step 3, §3.6),
 * the reference the Windows `ImportExport` and the web `files.ts` follow:
 *
 * 1. The text is read with the target's id (derived UIDs) and its file-defined
 *    zones that the target defines differently are renamed
 *    (`renameCollidingTimeZones`).
 * 2. Several masters of one UID: the newest (`groupVersion`; the first of
 *    equals) is used, the others count as skipped.
 * 3. A group whose UID is new to the target is added, with its raw text and an
 *    import baseline (`withImportBaseline` with its `groupVersion`).
 * 4. A group whose UID the target holds replaces it when its version is later
 *    than the stored group's baseline, or, for a stored group without one, than
 *    the stored group's own version; otherwise it counts as unchanged.
 * 5. A group without a master merges override by override into a stored group
 *    of its UID: an override with a new `RECURRENCE-ID` is added, a stored one
 *    is replaced under the rule of step 4 applied to that override (its own
 *    baseline, else its own version); each added or replaced override carries
 *    its own baseline; the stored master is never touched. The group counts as
 *    updated when anything changed, else unchanged.
 * 6. The target keeps its `VTIMEZONE` of a `TZID` and takes the incoming one
 *    of a `TZID` it lacks (`mergeTimeZones`); the writer drops unused ones and
 *    rebuilds generated ones whose years grew.
 *
 * Added and replaced groups keep their raw text (`replaceGroup` with
 * `keepRaw`), so they are stored byte for byte plus the baseline line.
 */
export function importCalendar(target: IcsCalendar, text: string, calendarId: string, zones: ZoneResolver): { calendar: IcsCalendar; result: ImportResult } {
  const incoming = renameCollidingTimeZones(target, parseICalendar(text, { calendarId, zones }), zones);
  const byUid = new Map<string, IcsGroup[]>();
  for (const group of incoming.groups) byUid.set(group.uid, [...(byUid.get(group.uid) ?? []), group]);
  let next = target;
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  const withBaseline = (group: IcsGroup) => withImportBaseline(group, versionOrFail(groupVersion(group), group.uid));
  for (const [uid, groups] of byUid) {
    const chosen = groups.reduce((best, g) => (later(groupVersion(g), groupVersion(best)) ? g : best));
    skipped += groups.length - 1;
    const stored = next.groups.find((g) => g.uid === uid);
    if (stored === undefined) {
      next = replaceGroup(next, withBaseline(chosen), { keepRaw: true });
      added++;
      continue;
    }
    if (chosen.master === null) {
      const overrides = [...stored.overrides];
      let changed = false;
      for (const override of chosen.overrides) {
        const version = versionOrFail(eventVersion(override), uid);
        const withLine = withImportBaseline({ uid, master: null, overrides: [override] }, version).overrides[0]!;
        const index = overrides.findIndex((o) => memberKey(o) === memberKey(override));
        if (index < 0) {
          overrides.push(withLine);
          changed = true;
          continue;
        }
        const existing = overrides[index]!;
        const baseline = valueAsUtc(existing.importedLastModified);
        if (baseline !== null ? later(version, baseline) : later(version, eventVersion(existing))) {
          overrides[index] = withLine;
          changed = true;
        }
      }
      if (changed) {
        next = replaceGroup(next, { uid, master: stored.master, overrides }, { keepRaw: true });
        updated++;
      } else {
        unchanged++;
      }
      continue;
    }
    const version = groupVersion(chosen);
    const baseline = storedBaseline(stored);
    if (baseline !== null ? later(version, baseline) : later(version, groupVersion(stored))) {
      next = replaceGroup(next, withBaseline(chosen), { keepRaw: true });
      updated++;
    } else {
      unchanged++;
    }
  }
  return { calendar: mergeTimeZones(next, incoming), result: { added, updated, unchanged, skipped } };
}

/**
 * Restores a Thirteen export into the local calendar `target` (docs/EVENTS.md
 * §2.17 "Restore"), the reference of the Windows and web restore: version
 * against version, baselines ignored and none added. A group only in the
 * backup is added; a group in both is replaced when the backup's
 * `groupVersion` is later, counted as kept newer when the calendar's is later,
 * else unchanged; a group only in the calendar stays. Groups keep their raw
 * text; the target takes the `VTIMEZONE`s it lacks.
 */
export function restoreCalendar(target: IcsCalendar, text: string, calendarId: string, zones: ZoneResolver): { calendar: IcsCalendar; result: RestoreResult } {
  const incoming = parseICalendar(text, { calendarId, zones });
  let next = target;
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let keptNewer = 0;
  for (const group of incoming.groups) {
    const stored = next.groups.find((g) => g.uid === group.uid);
    if (stored === undefined) {
      next = replaceGroup(next, group, { keepRaw: true });
      added++;
    } else if (later(groupVersion(group), groupVersion(stored))) {
      next = replaceGroup(next, group, { keepRaw: true });
      updated++;
    } else if (later(groupVersion(stored), groupVersion(group))) {
      keptNewer++;
    } else {
      unchanged++;
    }
  }
  return { calendar: mergeTimeZones(next, incoming), result: { added, updated, unchanged, keptNewer } };
}

/** The occurrences of a document (`expandCalendar` with the scenario's id, IFC). */
export function expansionJson(text: string, calendarId: string, deviceZone: string, window: WindowSpec, zones: ZoneResolver): ExpansionJson {
  const calendar = parseICalendar(text, { calendarId, zones });
  const result = expandCalendar(calendar, deviceZone, zones, { from: parseLocalDateTime(window.from), to: parseLocalDateTime(window.to) }, 'ifc', { calendarId });
  return { deviceZone, window, warnings: result.warnings.map(icsWarningJson), occurrences: result.events.map(occurrenceJson) };
}

/** The document a scenario starts from. */
export function startText(start: StartJson, files: ReadonlyMap<string, string>, zones: ZoneResolver, now: string): string {
  if ('file' in start) {
    const text = files.get(start.file);
    if (text === undefined) throw new RangeError(`Unknown file ${start.file}`);
    return text;
  }
  return serializeICalendar(newICalendar(start.new), zones, { now });
}

/**
 * Runs one step on `text` (the previous document) and returns the next
 * document, as a port replays a procedure file. Throws when an import or
 * restore result differs from the one the step states.
 */
export function runStep(step: StepJson, text: string, calendarId: string, files: ReadonlyMap<string, string>, zones: ZoneResolver, now: string): string {
  const calendar = parseICalendar(text, { calendarId, zones });
  const input = (file: string) => {
    const t = files.get(file);
    if (t === undefined) throw new RangeError(`Unknown file ${file}`);
    return t;
  };
  let next: IcsCalendar;
  switch (step.kind) {
    case 'edit':
      next = applyChanges(calendar, step.changes, zones);
      break;
    case 'import': {
      const imported = importCalendar(calendar, input(step.file), calendarId, zones);
      if (JSON.stringify(imported.result) !== JSON.stringify(step.result)) throw new RangeError(`Import of ${step.file} gave ${JSON.stringify(imported.result)}, the step says ${JSON.stringify(step.result)}`);
      next = imported.calendar;
      break;
    }
    case 'restore': {
      const restored = restoreCalendar(calendar, input(step.file), calendarId, zones);
      if (JSON.stringify(restored.result) !== JSON.stringify(step.result)) throw new RangeError(`Restore of ${step.file} gave ${JSON.stringify(restored.result)}, the step says ${JSON.stringify(step.result)}`);
      next = restored.calendar;
      break;
    }
  }
  return serializeICalendar(next, zones, { now });
}

// ---------------------------------------------------------------------------
// Building procedure files (the generator side)
// ---------------------------------------------------------------------------

/** A step as the generator defines it: edits compute their changes from the document with the engine. */
export type StepSpec = { readonly name: string; readonly expansions?: readonly { readonly deviceZone: string; readonly window: WindowSpec }[] } & (
  | { readonly kind: 'edit'; readonly changes: (calendar: IcsCalendar, zones: ZoneResolver) => readonly ChangeJson[] }
  | { readonly kind: 'import' | 'restore'; readonly file: string }
);

export interface ScenarioSpec {
  readonly name: string;
  readonly calendarId: string;
  readonly start: StartJson;
  readonly steps: readonly StepSpec[];
}

export interface ProcedureSpec {
  /** Path in `fixtures/ics`, e.g. `edits/retime-until.json`; step outputs go next to it as `{step name}.ics`. */
  readonly file: string;
  readonly description: string;
  readonly scenarios: readonly ScenarioSpec[];
}

/** Builds a procedure file and the documents of its steps; `files` holds every input by path and receives the outputs. */
export function buildProcedure(spec: ProcedureSpec, files: Map<string, string>, zones: ZoneResolver, now: string): ProcedureFile {
  const dir = spec.file.slice(0, spec.file.lastIndexOf('/') + 1);
  const scenarios = spec.scenarios.map((scenario): ScenarioJson => {
    let text = startText(scenario.start, files, zones, now);
    const steps = scenario.steps.map((s): StepJson => {
      const expected = `${dir}${s.name}.ics`;
      if (files.has(expected)) throw new RangeError(`Two steps write ${expected}`);
      const calendar = parseICalendar(text, { calendarId: scenario.calendarId, zones });
      let step: StepJson;
      if (s.kind === 'edit') {
        step = { kind: 'edit', changes: s.changes(calendar, zones), expected };
      } else if (s.kind === 'import') {
        const result = importCalendar(calendar, files.get(s.file)!, scenario.calendarId, zones).result;
        step = { kind: 'import', file: s.file, result, expected };
      } else {
        const result = restoreCalendar(calendar, files.get(s.file)!, scenario.calendarId, zones).result;
        step = { kind: 'restore', file: s.file, result, expected };
      }
      text = runStep(step, text, scenario.calendarId, files, zones, now);
      files.set(expected, text);
      if (s.expansions === undefined) return step;
      return { ...step, expansions: s.expansions.map((e) => expansionJson(text, scenario.calendarId, e.deviceZone, e.window, zones)) };
    });
    return { name: scenario.name, calendarId: scenario.calendarId, start: scenario.start, steps };
  });
  return { version: 1, description: spec.description, now, scenarios };
}

// ---------------------------------------------------------------------------
// Edits the generator derives with the engine
// ---------------------------------------------------------------------------

const utcNow = (now: string): IcsDateValueJson => ({ kind: 'utc', value: now });

/** The fields a user change also sets (§3.6): `SEQUENCE` incremented, `LAST-MODIFIED` now. */
export const touched = (event: IcsEvent, now: string): Partial<IcsEventFieldsJson> => ({ sequence: event.sequence + 1, lastModified: utcNow(now) });

function masterOf(calendar: IcsCalendar, uid: string): IcsEvent {
  const master = groupOf(calendar, uid).master;
  if (master === null) throw new RangeError(`Group ${uid} has no master`);
  return master;
}

/** A value of an event's zone (its `DTSTART` kind and `TZID`) on `date` at `minute`; a date when `minute` is null. */
function sameKind(start: IcsDateValue, date: { year: number; month: number; day: number }, minute: number | null): IcsDateValue {
  if (minute === null || start.kind === 'date') return { kind: 'date', date: { ...date } };
  const value = { date: { ...date }, minute };
  return start.kind === 'zoned' ? { kind: 'zoned', value, tzid: start.tzid } : { kind: start.kind, value };
}

/**
 * The changes of a retime of a series master (§4.7, §4.9 rule 4): its new
 * start and end, the `EXDATE`s and `RDATE`s `retimeExceptions` rewrites (in the
 * master's zone, own times kept, `PERIOD` lengths kept), the rules whose
 * `UNTIL` is rewritten, and the touched fields.
 */
export function retimeChanges(
  calendar: IcsCalendar,
  uid: string,
  start: IcsDateValue,
  end: IcsDateValue | null,
  options: { readonly minuteDelta?: number; readonly allDay?: 'to-all-day' | 'to-timed' },
  zones: ZoneResolver,
  now: string,
): ChangeJson[] {
  const master = masterOf(calendar, uid);
  const recurrence: EventRecurrence = recognizeRecurrence(icsRecognitionInput(master, calendar, zones)).recurrence;
  const dateOf = (v: IcsDateValue) => (v.kind === 'date' ? v.date : v.value.date);
  const oldStart = dateOf(master.start);
  const newStart = dateOf(start);
  const retime = retimeExceptions(recurrence, [], oldStart, newStart, recurrence, { minuteDelta: options.minuteDelta ?? 0, allDay: options.allDay ?? null });
  const startMinute = start.kind === 'date' ? null : start.value.minute;
  const exdates = retime.recurrence.exceptDates.map((x: OriginalDate) => sameKind(start, x.date, x.minute ?? startMinute));
  const rdates: IcsRdate[] = retime.recurrence.extraDates.map((x: ExtraDate): IcsRdate => {
    const value = sameKind(start, x.date, x.minute ?? startMinute);
    if (x.durationMinutes === null || value.kind === 'date') return { value, period: null };
    // A PERIOD keeps its duration text as read when a stored PERIOD of that length was written as a duration.
    const same = master.rdates.find((r) => {
      const d = r.period === null ? null : parseDuration(r.period);
      return d !== null && durationMinutes(d) === x.durationMinutes;
    });
    return { value, period: same?.period ?? formatDurationMinutes(x.durationMinutes) };
  });
  const fields: Partial<IcsEventFieldsJson> = {
    start: icsDateValueJson(start),
    end: end === null ? null : icsDateValueJson(end),
    exdates: exdates.map(icsDateValueJson),
    rdates: rdates.map((r) => ({ value: icsDateValueJson(r.value), period: r.period })),
    ...touched(master, now),
  };
  const changes: ChangeJson[] = [{ op: 'set', uid, recurrenceId: null, fields }];
  if (retime.untils.length > 0) changes.push({ op: 'untils', uid, untils: retime.untils.map(untilRewriteJson) });
  return changes;
}

/** A `set` change of the master's fields, with the touched fields. */
export function editMaster(calendar: IcsCalendar, uid: string, fields: Partial<IcsEventFieldsJson>, now: string): ChangeJson {
  return { op: 'set', uid, recurrenceId: null, fields: { ...fields, ...touched(masterOf(calendar, uid), now) } };
}

/** A `set` change of one override's fields, with the touched fields. */
export function editOverride(calendar: IcsCalendar, uid: string, recurrenceId: IcsDateValue, fields: Partial<IcsEventFieldsJson>, now: string): ChangeJson {
  const override = groupOf(calendar, uid).overrides.find((o) => o.recurrenceId !== null && sameDateValue(o.recurrenceId, recurrenceId));
  if (override === undefined) throw new RangeError(`Group ${uid} has no override for ${JSON.stringify(recurrenceId)}`);
  return { op: 'set', uid, recurrenceId: icsDateValueJson(recurrenceId), fields: { ...fields, ...touched(override, now) } };
}
