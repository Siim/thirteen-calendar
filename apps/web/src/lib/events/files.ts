/**
 * Import, restore and export on the web (docs/EVENTS.md §2.17, §3.6, §6.5
 * `files.ts`), without a library.
 *
 * - **Zip**: the uncompressed zip of Thirteen's export (`Thirteen calendars
 *   {yyyy-MM-dd}.zip`): one local header and the stored bytes per entry
 *   (method 0, UTF-8 names, the export's local time), then the central
 *   directory and its end record; and the reader for it (an import of
 *   Thirteen's own zip).
 * - **Merges**: {@link importCalendar} (UID groups compared by version, import
 *   baselines, override-only groups, colliding `VTIMEZONE` names renamed) and
 *   {@link restoreCalendar} (version against version, ids kept). They follow
 *   the reference procedures of `packages/core/scripts/ics-procedures.ts`
 *   (which generate `fixtures/ics/imports` and `restore`), moved here per §6.5,
 *   with the groups replaced in one pass ({@link GroupMerge}) so a large file
 *   merges in linear time.
 * - **Reading files** ({@link readImportFiles}): several files, `.ics` or
 *   Thirteen's `.zip`, counted off the main thread (the engine's worker);
 *   when every file is a Thirteen export, the plan is a restore.
 * - **Writing to the store**: {@link importIntoStore} and
 *   {@link restoreIntoStore}, one read-modify-write inside the
 *   `thirteen-events` lock (`LocalEventStore.transact`).
 * - **Export** ({@link exportFiles}, {@link exportDownload}): one `.ics` per
 *   calendar (its own `VCALENDAR` with `X-WR-CALNAME`, its colour and
 *   `X-THIRTEEN-CALENDAR-ID`; a subscription as its last fetched copy plus
 *   `X-THIRTEEN-SUBSCRIPTION-URL` and `-INTERVAL`); several calendars as one
 *   zip, never one merged file.
 */

import { type LocalDateTime, type ZoneResolver, compareLocalDateTime, formatLocalDateTime, toISODate } from '@thirteen/core';
import {
  type IcsCalendar,
  type IcsDateValue,
  type IcsEvent,
  type IcsGroup,
  type IcsProperty,
  eventVersion,
  groupVersion,
  mergeTimeZones,
  newICalendar,
  parseICalendar,
  renameCollidingTimeZones,
  serializeICalendar,
  withImportBaseline,
} from '@thirteen/core/ics';
import { CALENDAR_PALETTE, EventStoreError, copy } from '@thirteen/ui/headless';
import type { CalendarRecord, SubscriptionInterval } from './db.ts';
import type { TextSummary } from './engineCore.ts';
import { type LocalEventStore, utcWallClock } from './store.ts';

// ---------------------------------------------------------------------------
// Zip (PKWARE APPNOTE 6.3, stored entries only)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ISO 3309, as zip uses it). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** The DOS date and time of a wall clock (`YYYY-MM-DDTHH:MM`), seconds 0. */
function dosDateTime(text: string): { date: number; time: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (m === null) throw new RangeError(`Expected YYYY-MM-DDTHH:MM, got ${text}`);
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  // Zip times hold 1980 to 2107; a clock outside that is clamped rather than refused.
  const y = Math.min(2107, Math.max(1980, year));
  return { date: ((y - 1980) << 9) | (month << 5) | day, time: (hour << 11) | (minute << 5) };
}

/** An uncompressed zip of `entries`, each dated `modified` (`YYYY-MM-DDTHH:MM`, the export's local time). */
export function writeZip(entries: readonly ZipEntry[], modified: string): Uint8Array {
  const { date, time } = dosDateTime(modified);
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.bytes.length, true);
    local.setUint32(22, entry.bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, entry.bytes);
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(10, 0, true);
    header.setUint16(12, time, true);
    header.setUint16(14, date, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, entry.bytes.length, true);
    header.setUint32(24, entry.bytes.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);
    central.push(new Uint8Array(header.buffer), name);
    offset += 30 + name.length + entry.bytes.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The bytes start like a zip (a local header, or the end record of an empty zip). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));
}

/**
 * The entries of an uncompressed zip, read through its central directory (a
 * trailing comment is allowed).
 * @throws RangeError for a zip that is not one Thirteen writes (a compressed
 * entry, a bad CRC, no end record).
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endAt = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      endAt = at;
      break;
    }
  }
  if (endAt < 0) throw new RangeError('No end of central directory record');
  const count = view.getUint16(endAt + 10, true);
  let at = view.getUint32(endAt + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new RangeError('Bad central directory header');
    if (view.getUint16(at + 10, true) !== 0) throw new RangeError('Only stored entries are read');
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (localAt + 30 > bytes.length || view.getUint32(localAt, true) !== 0x04034b50) throw new RangeError(`Bad local header of ${name}`);
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    if (dataAt + size > bytes.length) throw new RangeError(`Truncated entry ${name}`);
    const data = bytes.slice(dataAt, dataAt + size);
    if (crc32(data) !== crc) throw new RangeError(`Bad CRC of ${name}`);
    entries.push({ name, bytes: data });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Merges (§2.17 step 3 and "Restore"; the reference procedures of core)
// ---------------------------------------------------------------------------

/** UID groups counted by an import (§2.17 step 4); `skipped`: further masters of one UID in the file (`import.duplicates`). */
export interface ImportResult {
  readonly added: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly skipped: number;
}

/** UID groups of the backup counted by a restore; `keptNewer`: groups the calendar holds in a later version. */
export interface RestoreResult {
  readonly added: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly keptNewer: number;
}

/** The text key of a date value (kind, zone and wall clock), as core's `dateValueKey`. */
function dateValueKey(value: IcsDateValue): string {
  switch (value.kind) {
    case 'date':
      return `D ${toISODate(value.date)}`;
    case 'floating':
      return `F ${formatLocalDateTime(value.value)}`;
    case 'utc':
      return `U ${formatLocalDateTime(value.value)}`;
    case 'zoned':
      return `Z ${value.tzid} ${formatLocalDateTime(value.value)}`;
  }
}

/** The key of an event inside its UID group: the master, or its `RECURRENCE-ID`. */
export function memberKey(event: Pick<IcsEvent, 'recurrenceId'>): string {
  return event.recurrenceId === null ? 'master' : dateValueKey(event.recurrenceId);
}

const later = (a: LocalDateTime | null, b: LocalDateTime | null): boolean => a !== null && (b === null || compareLocalDateTime(a, b) > 0);

const valueAsUtc = (value: IcsDateValue | null): LocalDateTime | null =>
  value === null ? null : value.kind === 'date' ? { date: value.date, minute: 0 } : value.value;

/** The import baseline of a stored group: its master's, or for a group without a master the latest of its overrides'. */
function storedBaseline(group: IcsGroup): LocalDateTime | null {
  if (group.master !== null) return valueAsUtc(group.master.importedLastModified);
  return group.overrides.reduce<LocalDateTime | null>((best, o) => {
    const b = valueAsUtc(o.importedLastModified);
    return later(b, best) ? b : best;
  }, null);
}

/** A group with neither `LAST-MODIFIED` nor `DTSTAMP` is older than any other (§2.17); its baseline is the oldest moment. */
const OLDEST: LocalDateTime = { date: { year: 1, month: 1, day: 1 }, minute: 0 };

const membersOf = (group: IcsGroup): IcsEvent[] => [...(group.master === null ? [] : [group.master]), ...group.overrides];

/**
 * The UID groups of a calendar during one merge: the lookups and the
 * `replaceGroup` steps of the reference procedures, each in constant time,
 * and the calendar built once at the end. Calling core's `replaceGroup` once
 * per incoming group copies the whole list every time, so an import grows with
 * the square of its size (20,000 events took about 10 s on the main thread;
 * §3.6 allows 50,000). The result is the same document: {@link replace} does
 * what `replaceGroup` does (members take the `line` of the member they
 * replace, `raw` kept with `keepRaw`, the group in place of the first group of
 * its UID with any others dropped, a new UID at the end, an empty group
 * removing the UID), checked against the reference in `files.test.ts`.
 */
class GroupMerge {
  private readonly groups: (IcsGroup | null)[];
  /** The indices in {@link groups} of each UID's groups, in order. */
  private readonly at = new Map<string, number[]>();

  constructor(private readonly calendar: IcsCalendar) {
    this.groups = [...calendar.groups];
    this.groups.forEach((group, index) => {
      const list = this.at.get(group!.uid);
      if (list === undefined) this.at.set(group!.uid, [index]);
      else list.push(index);
    });
  }

  /** The first group of `uid`, as `calendar.groups.find`. */
  find(uid: string): IcsGroup | undefined {
    const list = this.at.get(uid);
    return list === undefined ? undefined : this.groups[list[0]!]!;
  }

  /** As `replaceGroup(calendar, group, { keepRaw })`. */
  replace(group: IcsGroup, keepRaw: boolean): void {
    const list = this.at.get(group.uid) ?? [];
    if (group.master === null && group.overrides.length === 0) {
      for (const index of list) this.groups[index] = null;
      this.at.delete(group.uid);
      return;
    }
    const oldLines = new Map<string, number | null>();
    for (const index of list) {
      for (const member of membersOf(this.groups[index]!)) if (!oldLines.has(memberKey(member))) oldLines.set(memberKey(member), member.line);
    }
    const place = (event: IcsEvent): IcsEvent => ({ ...event, raw: keepRaw ? event.raw : null, line: oldLines.get(memberKey(event)) ?? null });
    const placed: IcsGroup = { uid: group.uid, master: group.master === null ? null : place(group.master), overrides: group.overrides.map(place) };
    if (list.length === 0) {
      this.at.set(group.uid, [this.groups.length]);
      this.groups.push(placed);
      return;
    }
    this.groups[list[0]!] = placed;
    for (const index of list.slice(1)) this.groups[index] = null;
    this.at.set(group.uid, [list[0]!]);
  }

  result(): IcsCalendar {
    return { ...this.calendar, groups: this.groups.filter((g): g is IcsGroup => g !== null) };
  }
}

/**
 * Imports a calendar text into `target` (§2.17 step 3, §3.6), as the
 * reference `importCalendar` of `packages/core/scripts/ics-procedures.ts`:
 * the text is read with the target's id (derived UIDs); its file-defined
 * zones that the target defines differently are renamed; of several masters
 * of one UID the newest is used (the others are `skipped`); a new UID is
 * added with its raw text and an import baseline; a stored group is replaced
 * when the incoming version is later than its baseline, or, without one, than
 * its own version; a group without a master merges override by override; the
 * target takes the `VTIMEZONE`s it lacks.
 */
export function importCalendar(target: IcsCalendar, text: string, calendarId: string, zones: ZoneResolver): { calendar: IcsCalendar; result: ImportResult } {
  const incoming = renameCollidingTimeZones(target, parseICalendar(text, { calendarId, zones }), zones);
  const byUid = new Map<string, IcsGroup[]>();
  for (const group of incoming.groups) {
    const list = byUid.get(group.uid);
    if (list === undefined) byUid.set(group.uid, [group]);
    else list.push(group);
  }
  const next = new GroupMerge(target);
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  const withBaseline = (group: IcsGroup) => withImportBaseline(group, groupVersion(group) ?? OLDEST);
  for (const [uid, groups] of byUid) {
    const chosen = groups.reduce((best, g) => (later(groupVersion(g), groupVersion(best)) ? g : best));
    skipped += groups.length - 1;
    const stored = next.find(uid);
    if (stored === undefined) {
      next.replace(withBaseline(chosen), true);
      added++;
      continue;
    }
    if (chosen.master === null) {
      const overrides = [...stored.overrides];
      let changed = false;
      for (const override of chosen.overrides) {
        const version = eventVersion(override);
        const withLine = withImportBaseline({ uid, master: null, overrides: [override] }, version ?? OLDEST).overrides[0]!;
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
        next.replace({ uid, master: stored.master, overrides }, true);
        updated++;
      } else {
        unchanged++;
      }
      continue;
    }
    const version = groupVersion(chosen);
    const baseline = storedBaseline(stored);
    if (baseline !== null ? later(version, baseline) : later(version, groupVersion(stored))) {
      next.replace(withBaseline(chosen), true);
      updated++;
    } else {
      unchanged++;
    }
  }
  return { calendar: mergeTimeZones(next.result(), incoming), result: { added, updated, unchanged, skipped } };
}

/**
 * Restores a Thirteen export into the local calendar `target` (§2.17
 * "Restore"), as the reference `restoreCalendar`: version against version,
 * baselines ignored and none added; a group only in the backup is added, a
 * group in both replaced when the backup's version is later (counted as kept
 * newer when the calendar's is later), a group only in the calendar stays.
 */
export function restoreCalendar(target: IcsCalendar, text: string, calendarId: string, zones: ZoneResolver): { calendar: IcsCalendar; result: RestoreResult } {
  const incoming = parseICalendar(text, { calendarId, zones });
  const next = new GroupMerge(target);
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let keptNewer = 0;
  for (const group of incoming.groups) {
    const stored = next.find(group.uid);
    if (stored === undefined) {
      next.replace(group, true);
      added++;
    } else if (later(groupVersion(group), groupVersion(stored))) {
      next.replace(group, true);
      updated++;
    } else if (later(groupVersion(stored), groupVersion(group))) {
      keptNewer++;
    } else {
      unchanged++;
    }
  }
  return { calendar: mergeTimeZones(next.result(), incoming), result: { added, updated, unchanged, keptNewer } };
}

// ---------------------------------------------------------------------------
// Reading the chosen files (§2.17 steps 1 and 2)
// ---------------------------------------------------------------------------

/** 25 MB and 50,000 VEVENTs (§3.6 limits). */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
export const MAX_IMPORT_EVENTS = 50_000;

/** The `accept` of the file picker (§2.17 step 1). */
export const IMPORT_ACCEPT = '.ics,.ical,.ifb,.zip,text/calendar,application/zip';

/** A file the user chose or dropped, read into memory. */
export interface PickedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Why a chosen file cannot be imported (the §2.19 ids). */
export type ImportFileError = 'import.notIcs' | 'import.empty' | 'subscribe.error.tooLarge';

const SUBSCRIPTION_INTERVALS: readonly SubscriptionInterval[] = ['PT1H', 'PT6H', 'P1D', 'P7D', 'manual'];

/** What a Thirteen export says about its calendar (§2.17 Restore). */
export interface ThirteenExport {
  readonly calendarId: string;
  readonly kind: 'local' | 'subscription';
  readonly name: string;
  /** `#rrggbb`, or null when the file has none. */
  readonly color: string | null;
  readonly subscription: { readonly url: string; readonly interval: SubscriptionInterval } | null;
}

/** One calendar document of a chosen file (a `.ics`, or one `.ics` entry of a zip). */
export interface ImportSource {
  /** Stable within a plan: `{file index}` or `{file index}/{entry index}`. */
  readonly id: string;
  /** The name to show: the file's, or the zip entry's. */
  readonly name: string;
  readonly text: string;
  readonly summary: TextSummary & { readonly ok: true };
  /** UID groups plus unreadable components: the `{n}` of `import.summary`. */
  readonly events: number;
  /** The default name of a new calendar: `X-WR-CALNAME`, else the file name without its extension. */
  readonly calendarName: string;
  readonly thirteen: ThirteenExport | null;
}

/** A chosen file: its documents, or why it cannot be read. */
export interface ImportFile {
  readonly name: string;
  readonly sources: readonly ImportSource[];
  readonly error: ImportFileError | null;
}

export interface ImportPlan {
  readonly files: readonly ImportFile[];
  /** Every readable file is a Thirteen export: the dialog is "Restore calendars" (§2.17 step 2). */
  readonly restore: boolean;
  /** Every readable document, in file order. */
  readonly sources: readonly ImportSource[];
}

/** A file name without its extension. */
export function baseName(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const file = name.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

function thirteenExportOf(summary: TextSummary & { ok: true }, calendarName: string): ThirteenExport | null {
  const id = summary.thirteenCalendarId?.trim() ?? '';
  if (id === '') return null;
  const url = summary.subscriptionUrl?.trim() ?? '';
  const interval = (SUBSCRIPTION_INTERVALS as readonly string[]).includes(summary.subscriptionInterval ?? '') ? (summary.subscriptionInterval as SubscriptionInterval) : 'PT6H';
  const color = summary.color !== null && /^#[0-9a-f]{6}$/i.test(summary.color) ? summary.color.toLowerCase() : null;
  return {
    calendarId: id,
    kind: url === '' ? 'local' : 'subscription',
    name: calendarName,
    color,
    subscription: url === '' ? null : { url, interval },
  };
}

const decoder = () => new TextDecoder('utf-8');

/**
 * Reads the chosen files (§2.17 steps 1 and 2): a zip is opened and each of its
 * `.ics` entries read; every document is counted by `summarize` (the engine's
 * worker). A file that is not iCalendar, has no events or is over the limits
 * gets its error instead.
 */
export async function readImportFiles(files: readonly PickedFile[], summarize: (text: string, calendarId: string) => Promise<TextSummary>): Promise<ImportPlan> {
  const out: ImportFile[] = [];
  for (const [index, file] of files.entries()) {
    if (file.bytes.length > MAX_IMPORT_BYTES) {
      out.push({ name: file.name, sources: [], error: 'subscribe.error.tooLarge' });
      continue;
    }
    let documents: { name: string; id: string; bytes: Uint8Array }[];
    if (isZip(file.bytes)) {
      try {
        documents = readZip(file.bytes)
          .filter((e) => /\.(ics|ical|ifb)$/i.test(e.name) && !e.name.endsWith('/'))
          .map((e, i) => ({ name: e.name.slice(e.name.lastIndexOf('/') + 1), id: `${index}/${i}`, bytes: e.bytes }));
      } catch {
        out.push({ name: file.name, sources: [], error: 'import.notIcs' });
        continue;
      }
      if (documents.length === 0) {
        out.push({ name: file.name, sources: [], error: 'import.notIcs' });
        continue;
      }
    } else {
      documents = [{ name: file.name, id: String(index), bytes: file.bytes }];
    }
    const sources: ImportSource[] = [];
    let error: ImportFileError | null = null;
    for (const document of documents) {
      const text = decoder().decode(document.bytes);
      const summary = await summarize(text, `import-${document.id}`);
      if (!summary.ok) {
        error ??= 'import.notIcs';
        continue;
      }
      if (summary.events > MAX_IMPORT_EVENTS) {
        error ??= 'subscribe.error.tooLarge';
        continue;
      }
      const events = summary.groups + summary.skipped;
      const calendarName = summary.name !== null && summary.name.trim() !== '' ? summary.name.trim() : baseName(document.name);
      const thirteen = thirteenExportOf(summary, calendarName);
      // An empty Thirteen export is still a calendar to restore; any other empty file has nothing to import.
      if (events === 0 && thirteen === null) {
        error ??= 'import.empty';
        continue;
      }
      sources.push({ id: document.id, name: document.name, text, summary, events, calendarName, thirteen });
    }
    out.push({ name: file.name, sources, error: sources.length > 0 ? null : (error ?? 'import.notIcs') });
  }
  const sources = out.flatMap((f) => f.sources);
  return { files: out, sources, restore: sources.length > 0 && sources.every((s) => s.thirteen !== null) };
}

// ---------------------------------------------------------------------------
// Writing an import or a restore
// ---------------------------------------------------------------------------

/** Where a document goes: an existing local calendar, or a new one with this name. */
export type ImportTarget = { readonly kind: 'calendar'; readonly id: string } | { readonly kind: 'new'; readonly name: string };

export interface ImportChoice {
  readonly source: ImportSource;
  readonly target: ImportTarget;
}

export interface ImportOutcome extends ImportResult {
  /** Unreadable components of the files, skipped (`import.partial`). */
  readonly partial: number;
  /** The calendars written, new ones included. */
  readonly calendarIds: readonly string[];
}

/** The next colours of the §3.6 palette not in use, for calendars created together. */
function colorPicker(records: readonly Pick<CalendarRecord, 'color'>[]): () => string {
  const used = new Set(records.map((r) => r.color.toLowerCase()));
  return () => {
    const color = CALENDAR_PALETTE.find((c) => !used.has(c)) ?? CALENDAR_PALETTE[used.size % CALENDAR_PALETTE.length]!;
    used.add(color);
    return color;
  };
}

function nextOrder(store: LocalEventStore): () => number {
  let order = Math.max(-1, ...store.getState().calendars.map((c) => c.order));
  return () => ++order;
}

/**
 * Imports the chosen documents (§2.17 step 3): every new calendar is created
 * and every document merged in one read-modify-write inside the lock.
 * @throws EventStoreError (`read-only` for a target that is not a writable local calendar; `storage` when full)
 */
export async function importIntoStore(store: LocalEventStore, choices: readonly ImportChoice[], zones: ZoneResolver): Promise<ImportOutcome> {
  const newIds = new Map<ImportChoice, string>();
  for (const choice of choices) if (choice.target.kind === 'new') newIds.set(choice, store.createId());
  const ids = [...new Set(choices.map((c) => (c.target.kind === 'calendar' ? c.target.id : newIds.get(c)!)))];
  const order = nextOrder(store);
  const createdAt = new Date().toISOString();
  return store.transact(ids, (tx) => {
    const color = colorPicker(store.getState().calendars);
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    let partial = 0;
    for (const choice of choices) {
      let id: string;
      if (choice.target.kind === 'new') {
        id = newIds.get(choice)!;
        const name = choice.target.name.trim() === '' ? choice.source.calendarName : choice.target.name.trim();
        const record: CalendarRecord = { id, kind: 'local', name, color: color(), order: order(), visible: true, createdAt, subscription: null };
        tx.putRecord(record);
        tx.set(id, newICalendar({ calendarId: id, name: record.name, color: record.color }));
      } else {
        id = choice.target.id;
        const record = tx.record(id);
        if (record === null) throw new EventStoreError('not-found', 'This calendar no longer exists.');
        if (record.kind !== 'local') throw new EventStoreError('read-only', 'Events can be imported only into local calendars.');
      }
      const target = tx.calendar(id);
      if (target === null) throw new EventStoreError('read-only', 'This calendar could not be read.');
      const { calendar, result } = importCalendar(target, choice.source.text, id, zones);
      tx.set(id, calendar);
      added += result.added;
      updated += result.updated;
      unchanged += result.unchanged;
      skipped += result.skipped;
      partial += choice.source.summary.skipped;
    }
    return { added, updated, unchanged, skipped, partial, calendarIds: ids };
  });
}

export interface RestoreOutcome {
  /** Calendars restored (`import.restore.result`). */
  readonly calendars: number;
  /** UID groups the calendars hold in a later version (`import.restore.keptNewer`). */
  readonly keptNewer: number;
  readonly calendarIds: readonly string[];
  /** Subscriptions created again from a backup: refresh them on their schedule. */
  readonly subscriptionIds: readonly string[];
}

/** An export's own properties, written by {@link exportText} and read back by a restore. */
const EXPORT_PROPS = ['X-THIRTEEN-CALENDAR-ID', 'X-THIRTEEN-SUBSCRIPTION-URL', 'X-THIRTEEN-SUBSCRIPTION-INTERVAL'] as const;

/**
 * Restores Thirteen exports (§2.17 "Restore"), all in one read-modify-write:
 * each goes back into the calendar with its `X-THIRTEEN-CALENDAR-ID` if that
 * is a calendar of the same kind, else into a new calendar that keeps the id
 * (a new id only when the id belongs to a calendar of the other kind, or to a
 * local calendar whose document cannot be read), with the file's name and
 * colour. Local calendars merge version against version; a subscription that
 * still exists is left as it is, a missing one comes back with the file as
 * its first copy (refreshed on its schedule: it is due at once).
 */
export async function restoreIntoStore(store: LocalEventStore, sources: readonly ImportSource[], zones: ZoneResolver): Promise<RestoreOutcome> {
  const exports = sources.filter((s): s is ImportSource & { thirteen: ThirteenExport } => s.thirteen !== null);
  // The id each export goes to, decided on the tab's state and checked again inside the lock.
  const planned = new Map<ImportSource, string>();
  for (const source of exports) {
    const existing = store.record(source.thirteen.calendarId);
    const unreadable = existing !== null && existing.kind === 'local' && store.getState().calendars.find((c) => c.id === existing.id)?.unreadable === true;
    planned.set(source, existing === null || (existing.kind === source.thirteen.kind && !unreadable) ? source.thirteen.calendarId : store.createId());
  }
  const ids = [...new Set(planned.values())];
  // A fresh browser's own "Personal" (created on first use, §2.16), while it is the only calendar and
  // still holds nothing, gives way to restored local calendars: restoring a backup into a fresh
  // browser then gives exactly the backed-up calendars (§8.3 item 8; B8). Checked again in the lock.
  const present = store.getState().calendars;
  const firstUse =
    exports.some((source) => source.thirteen.kind === 'local') &&
    present.length === 1 &&
    present[0]!.kind === 'local' &&
    present[0]!.title === copy('calendars.personal') &&
    !ids.includes(present[0]!.id)
      ? present[0]!.id
      : null;
  const order = nextOrder(store);
  const createdAt = new Date().toISOString();
  return store.transact(firstUse === null ? ids : [...ids, firstUse], (tx) => {
    const color = colorPicker(store.getState().calendars);
    let keptNewer = 0;
    const restored = new Set<string>();
    const subscriptionIds: string[] = [];
    for (const source of exports) {
      const file = source.thirteen;
      const id = planned.get(source)!;
      const record = tx.record(id);
      if (record !== null && record.kind !== file.kind) throw new EventStoreError('generic', 'The calendar changed while restoring.');
      if (file.kind === 'subscription') {
        restored.add(id);
        if (record !== null) continue; // Feeds are never rewritten (§4.9).
        const subscription = file.subscription!;
        tx.putRecord({
          id,
          kind: 'subscription',
          name: file.name,
          color: file.color ?? color(),
          order: order(),
          visible: true,
          createdAt,
          subscription: {
            url: subscription.url,
            interval: subscription.interval,
            etag: null,
            lastModified: null,
            contentHash: null,
            suspect: null,
            lastAttemptAt: null,
            lastSuccessAt: null,
            lastError: null,
          },
        });
        tx.setText(id, source.text, { previous: null });
        subscriptionIds.push(id);
        continue;
      }
      let target: IcsCalendar | null;
      if (record === null) {
        const name = file.name;
        const created: CalendarRecord = { id, kind: 'local', name, color: file.color ?? color(), order: order(), visible: true, createdAt, subscription: null };
        tx.putRecord(created);
        target = newICalendar({ calendarId: id, name: created.name, color: created.color });
      } else {
        target = tx.calendar(id);
        if (target === null) throw new EventStoreError('read-only', 'This calendar could not be read.');
      }
      const { calendar, result } = restoreCalendar(target, source.text, id, zones);
      tx.set(id, calendar);
      keptNewer += result.keptNewer;
      restored.add(id);
    }
    if (firstUse !== null) {
      const record = tx.record(firstUse);
      const document = record?.kind === 'local' ? tx.calendar(firstUse) : null;
      if (document !== null && document.groups.length === 0 && document.others.length === 0) tx.remove(firstUse);
    }
    return { calendars: restored.size, keptNewer, calendarIds: [...restored], subscriptionIds };
  });
}

// ---------------------------------------------------------------------------
// Export (§2.17 "Export")
// ---------------------------------------------------------------------------

/** Sets a calendar property in place (later ones of the name removed), or appends it. */
function setProp(extra: readonly IcsProperty[], name: string, value: string): IcsProperty[] {
  const index = extra.findIndex((p) => p.name === name);
  const property: IcsProperty = { name, params: [], value };
  if (index < 0) return [...extra, property];
  return extra.flatMap((p, i) => (i === index ? [property] : p.name === name ? [] : [p]));
}

/** iCalendar TEXT escaping of a property value (`\\`, `;`, `,`, line breaks). */
function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * The export of one calendar: its own `VCALENDAR` with its name, colour and
 * `X-THIRTEEN-CALENDAR-ID`; a subscription is its last fetched copy plus
 * `X-THIRTEEN-SUBSCRIPTION-URL` and `-INTERVAL`. Groups and `VTIMEZONE`s are
 * copied as stored. An unreadable document is returned as stored; null when
 * the calendar is gone.
 */
export function exportText(store: LocalEventStore, id: string, zones: ZoneResolver, now: Date): string | null {
  const record = store.record(id);
  if (record === null) return null;
  const stored = store.documentText(id);
  const parsed = stored === null ? newICalendar({ calendarId: id, name: record.name, color: record.color }) : store.parse(id, stored);
  if (parsed === null) return stored;
  let extra = setProp(parsed.extra, 'X-THIRTEEN-CALENDAR-ID', escapeText(id));
  if (record.kind === 'subscription' && record.subscription !== null) {
    extra = setProp(extra, 'X-THIRTEEN-SUBSCRIPTION-URL', record.subscription.url);
    extra = setProp(extra, 'X-THIRTEEN-SUBSCRIPTION-INTERVAL', record.subscription.interval);
  } else {
    extra = extra.filter((p) => p.name !== EXPORT_PROPS[1] && p.name !== EXPORT_PROPS[2]);
  }
  const calendar: IcsCalendar = { ...parsed, name: record.name, color: record.color, extra };
  return serializeICalendar(calendar, zones, { now: formatLocalDateTime(utcWallClock(now)) });
}

/** Characters no file system takes in a name, and control characters, as `_`. */
export function fileNameOf(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  return cleaned === '' ? 'Calendar' : cleaned;
}

export interface ExportFile {
  /** `{Calendar name}.ics`, made unique with " (2)". */
  readonly name: string;
  readonly text: string;
}

/** One file per calendar, in the given order, with unique names (§2.17). */
export function exportFiles(store: LocalEventStore, ids: readonly string[], zones: ZoneResolver, now: Date): ExportFile[] {
  const taken = new Set<string>();
  const files: ExportFile[] = [];
  for (const id of ids) {
    const text = exportText(store, id, zones, now);
    const record = store.record(id);
    if (text === null || record === null) continue;
    const base = fileNameOf(record.name);
    let name = `${base}.ics`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n}).ics`;
    taken.add(name.toLowerCase());
    files.push({ name, text });
  }
  return files;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The local date of `now` as `yyyy-MM-dd` and its local wall clock as `YYYY-MM-DDTHH:MM` (the zip's entry times). */
export function localStamp(now: Date): { readonly date: string; readonly clock: string } {
  const date = `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return { date, clock: `${date}T${pad(now.getHours())}:${pad(now.getMinutes())}` };
}

/** What a download holds: one `.ics`, or `Thirteen calendars {yyyy-MM-dd}.zip` for several. */
export interface ExportDownload {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

/** One file as itself, several as one uncompressed zip named with `zipName(date)` (`export.fileZip`). */
export function exportDownload(files: readonly ExportFile[], now: Date, zipName: (date: string) => string): ExportDownload | null {
  if (files.length === 0) return null;
  const encoder = new TextEncoder();
  if (files.length === 1) return { name: files[0]!.name, type: 'text/calendar;charset=utf-8', bytes: encoder.encode(files[0]!.text) };
  const stamp = localStamp(now);
  const zip = writeZip(
    files.map((f) => ({ name: f.name, bytes: encoder.encode(f.text) })),
    stamp.clock,
  );
  return { name: zipName(stamp.date), type: 'application/zip', bytes: zip };
}

/** Saves bytes as a download through an `<a download>` and an object URL. */
export function downloadBytes(download: ExportDownload, doc: Document = document): void {
  const blob = new Blob([download.bytes as BlobPart], { type: download.type });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = download.name;
  a.rel = 'noopener';
  a.style.display = 'none';
  doc.body.append(a);
  a.click();
  a.remove();
  // Revoked later: some browsers start the download after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Reads `File`s from a picker or a drop. */
export async function pickedFiles(files: Iterable<File>): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (const file of files) out.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  return out;
}
