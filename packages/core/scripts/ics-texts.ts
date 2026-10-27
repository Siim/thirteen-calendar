/**
 * Text helpers of the `.ics` conformance set (`fixtures/ics`, task C8):
 * content lines, folding as other writers do it, deterministic ids, and the
 * `VTIMEZONE` blocks of the apps the inputs come from (anonymized copies of
 * what Google, Apple, Microsoft, Fastmail and Thunderbird write).
 * @module
 */

import { sha256Hex } from '../src/ics/sha256.ts';

export const CRLF = '\r\n';

/** Lines joined with CRLF, with a final CRLF. */
export const crlf = (lines: readonly string[]): string => `${lines.join(CRLF)}${CRLF}`;

/** A `VCALENDAR` around calendar properties and components (each a list of lines). */
export const vcalendar = (props: readonly string[], ...components: readonly (readonly string[])[]): string[] => [
  'BEGIN:VCALENDAR',
  ...props,
  ...components.flat(),
  'END:VCALENDAR',
];

/** A `VEVENT` around the given lines. */
export const vevent = (...lines: string[]): string[] => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];

/** UTF-8 length of one code point. */
const octets = (char: string): number => {
  const cp = char.codePointAt(0)!;
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
};

/**
 * Folds one content line the way a writer does (RFC 5545 §3.1): physical lines
 * of at most `width` octets (the continuation marker counts), never splitting
 * a UTF-8 sequence, continued with `marker` (a space or a tab).
 */
export function fold(text: string, width = 75, marker: ' ' | '\t' = ' '): string[] {
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const char of text) {
    const n = octets(char);
    if (size + n > width) {
      out.push(current);
      current = marker;
      size = 1;
    }
    current += char;
    size += n;
  }
  out.push(current);
  return out;
}

/** A lowercase UUID v4 derived from `seed` (stable across runs). */
export function uuid(seed: string): string {
  const hex = sha256Hex(seed).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '89ab'[Number.parseInt(hex[16]!, 16) % 4]!;
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** `n` characters of base32hex (`0-9a-v`) derived from `seed`, as Google's event ids look. */
export function googleId(seed: string, n = 26): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  const hex = sha256Hex(seed);
  return Array.from({ length: n }, (_, i) => alphabet[Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16) % 32]).join('');
}

/** An Outlook `UID`: the Exchange global object id prefix and 56 hex digits derived from `seed`. */
export function outlookUid(seed: string): string {
  return `040000008200E00074C5B7101A82E00800000000${sha256Hex(seed).slice(0, 56).toUpperCase()}`;
}

/** An uppercase UUID as Apple writes them. */
export const appleUid = (seed: string): string => uuid(seed).toUpperCase();

// ---------------------------------------------------------------------------
// VTIMEZONEs as other apps write them
// ---------------------------------------------------------------------------

/** `Europe/Tallinn` as Google exports it: 1970 onsets, open-ended rules, `X-LIC-LOCATION`. */
export const GOOGLE_TALLINN = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Tallinn',
  'X-LIC-LOCATION:Europe/Tallinn',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0300',
  'TZNAME:EEST',
  'DTSTART:19700329T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0300',
  'TZOFFSETTO:+0200',
  'TZNAME:EET',
  'DTSTART:19701025T040000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** `Europe/Tallinn` as Apple Calendar exports it: 2002 onsets, its own property order. */
export const APPLE_TALLINN = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Tallinn',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0200',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'DTSTART:20020331T030000',
  'TZNAME:EEST',
  'TZOFFSETTO:+0300',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0300',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'DTSTART:20021027T040000',
  'TZNAME:EET',
  'TZOFFSETTO:+0200',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** Outlook's `FLE Standard Time` (Helsinki, Kyiv, Riga, Sofia, Tallinn, Vilnius): 1601 onsets. */
export const OUTLOOK_FLE = [
  'BEGIN:VTIMEZONE',
  'TZID:FLE Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T040000',
  'TZOFFSETFROM:+0300',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0300',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

/** `Australia/Melbourne` as Fastmail (Cyrus) writes it. */
export const FASTMAIL_MELBOURNE = [
  'BEGIN:VTIMEZONE',
  'TZID:Australia/Melbourne',
  'LAST-MODIFIED:20250418T074118Z',
  'X-LIC-LOCATION:Australia/Melbourne',
  'BEGIN:STANDARD',
  'TZNAME:AEST',
  'TZOFFSETFROM:+1100',
  'TZOFFSETTO:+1000',
  'DTSTART:20080406T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'TZNAME:AEDT',
  'TZOFFSETFROM:+1000',
  'TZOFFSETTO:+1100',
  'DTSTART:20081005T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

/** `America/New_York` as Thunderbird writes it (`X-TZINFO`, 1970 onsets). */
export const THUNDERBIRD_NEW_YORK = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'X-TZINFO:America/New_York[2025b]',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/**
 * Outlook's "Customized Time Zone": a name only the file's own `VTIMEZONE`
 * defines. Outlook writes it for zones it cannot name, with rules that differ
 * from file to file. `standard` and `daylight` are the `TZOFFSETTO` values
 * (`daylight` null: no DST).
 */
export function customizedTimeZone(standard: string, daylight: string | null, tzid = 'Customized Time Zone'): string[] {
  if (daylight === null) {
    return ['BEGIN:VTIMEZONE', `TZID:${tzid}`, 'BEGIN:STANDARD', 'DTSTART:16010101T000000', `TZOFFSETFROM:${standard}`, `TZOFFSETTO:${standard}`, 'END:STANDARD', 'END:VTIMEZONE'];
  }
  return [
    'BEGIN:VTIMEZONE',
    `TZID:${tzid}`,
    'BEGIN:STANDARD',
    'DTSTART:16010101T020000',
    `TZOFFSETFROM:${daylight}`,
    `TZOFFSETTO:${standard}`,
    'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:16010101T020000',
    `TZOFFSETFROM:${standard}`,
    `TZOFFSETTO:${daylight}`,
    'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
  ];
}
