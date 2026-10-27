/**
 * The uncompressed zip Thirteen's web export writes for several calendars
 * (docs/EVENTS.md §2.17: `Thirteen calendars {yyyy-MM-dd}.zip`, written by
 * `files.ts` without a library), and a reader for it. Used for
 * `fixtures/ics/restore` (task C8).
 *
 * Format (PKWARE APPNOTE 6.3): one local header and the stored bytes per
 * entry (compression method 0, general purpose flag bit 11 for UTF-8 names,
 * version 2.0, the export time as the DOS date and time of every entry), then
 * the central directory and its end record; no extra fields, no comments.
 * @module
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ISO 3309, as zip uses it) of `bytes`. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip entry: its name (UTF-8) and bytes. */
export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** The DOS date and time of a wall clock (`YYYY-MM-DDTHH:MM`), seconds 0. */
function dosDateTime(text: string): { date: number; time: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (m === null) throw new RangeError(`Expected YYYY-MM-DDTHH:MM, got ${text}`);
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (year < 1980 || year > 2107) throw new RangeError(`A zip time must be in 1980 to 2107, got ${text}`);
  return { date: ((year - 1980) << 9) | (month << 5) | day, time: (hour << 11) | (minute << 5) };
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

/**
 * The entries of an uncompressed zip, read through its central directory.
 * @throws RangeError for a zip this module did not write the way it writes
 * (a compressed entry, a bad CRC, a missing end record).
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endAt = bytes.length - 22;
  if (endAt < 0 || view.getUint32(endAt, true) !== 0x06054b50) throw new RangeError('No end of central directory record');
  const count = view.getUint16(endAt + 10, true);
  let at = view.getUint32(endAt + 16, true);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new RangeError('Bad central directory header');
    if (view.getUint16(at + 10, true) !== 0) throw new RangeError('Only stored entries are read');
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (view.getUint32(localAt, true) !== 0x04034b50) throw new RangeError(`Bad local header of ${name}`);
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const data = bytes.slice(dataAt, dataAt + size);
    if (crc32(data) !== crc) throw new RangeError(`Bad CRC of ${name}`);
    entries.push({ name, bytes: data });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
