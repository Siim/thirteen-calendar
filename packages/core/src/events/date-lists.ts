/**
 * `RDATE` and `EXDATE` value lists in the Android Calendar Provider's text
 * forms (docs/EVENTS.md §4.4, §5.2). Android parses and writes these columns
 * only through {@link parseDateList} and {@link formatDateList}.
 *
 * Three forms are written, one per list:
 *
 * - `'date'`, all-day series (`EVENT_TIMEZONE` = `UTC`): `20261019,20261116`;
 * - `'zoned'`, timed series, the event's zone and wall-clock times after one
 *   `TZID;` prefix: `Europe/Tallinn;20261116T190000,20261214T190000`;
 * - `'utc'`, the fallback of gate V10: `20261116T170000Z,20261214T170000Z`.
 *
 * The reader also accepts what other writers store, as AOSP's
 * `RecurrenceSet.parseMultiLineRecurrenceDates` does: several lines (the
 * provider joins `RDATE` lines with a line feed), each with its own optional
 * `TZID;` prefix, and comma lists that mix dates, UTC date-times and local
 * date-times, as Google's sync adapter writes them back. A UTC value keeps its
 * `Z` whatever the prefix says. A local date-time on a line without a prefix
 * is returned as `floating`; the provider itself reads such values as UTC.
 * @module
 */

import { type GregorianDate, isValidGregorian } from '../gregorian.ts';
import { fail, isRecord, show } from '../internal.ts';
import { formatICalDate, formatICalDateTime, parseICalValue } from './rrule.ts';
import { type LocalDateTime, isValidLocalDateTime } from './time.ts';

/** One `RDATE` or `EXDATE` value. Date-times have minute precision (seconds are dropped when reading). */
export type DateListValue =
  | { readonly kind: 'date'; readonly date: GregorianDate }
  | { readonly kind: 'utc'; readonly value: LocalDateTime }
  | { readonly kind: 'zoned'; readonly value: LocalDateTime; readonly tzid: string }
  | { readonly kind: 'floating'; readonly value: LocalDateTime };

/** The text form a list is written in: one form per list. */
export type DateListForm = 'date' | 'zoned' | 'utc';

const FORMS: readonly DateListForm[] = ['date', 'zoned', 'utc'];
/** Line breaks between `RDATE` lines: CR LF, LF or CR. */
const LINE_BREAK = /\r\n|\n|\r/;

/** Strips ASCII spaces and tabs from both ends. */
function trimBlanks(text: string): string {
  return text.replace(/^[ \t]+|[ \t]+$/g, '');
}

/**
 * Parses an `RDATE` or `EXDATE` column. Lines are separated by CR LF, LF or
 * CR; a line is `[TZID;]value,value,...`, where the zone id is the text
 * before the line's first `;`. Spaces and tabs around a line, a zone id or a
 * value are ignored, and so are empty lines and empty values (`a,,b`). Values
 * are `yyyyMMdd` (`date`), `yyyyMMddTHHmmssZ` (`utc`) or `yyyyMMddTHHmmss`
 * (`zoned` with the line's zone id, or `floating` on a line without one);
 * `T` and `Z` may be lowercase. Values keep their order; duplicates are kept.
 * An empty text is an empty list.
 *
 * `parseDateList('Europe/Tallinn;20261116T190000,20261214T170000Z')` gives a
 * zoned 19:00 on November 16 and 17:00 UTC on December 14.
 * @throws RangeError for a value that is not one of those forms (including
 * impossible dates, years outside 0001…9999, hours above 23), or a zone id
 * that is empty or contains `,`.
 */
export function parseDateList(text: string): DateListValue[] {
  if (typeof text !== 'string') fail(`Date list text must be a string, got ${show(text)}`);
  const values: DateListValue[] = [];
  for (const rawLine of text.split(LINE_BREAK)) {
    const line = trimBlanks(rawLine);
    if (line === '') continue;
    const separator = line.indexOf(';');
    const tzid = separator < 0 ? null : trimBlanks(line.slice(0, separator));
    if (tzid === '' || tzid?.includes(',')) {
      fail(`Invalid date list ${show(text)}: ${show(tzid)} before ';' is not a zone id`);
    }
    for (const rawValue of line.slice(separator + 1).split(',')) {
      const item = trimBlanks(rawValue);
      if (item === '') continue;
      const parsed = parseICalValue(item);
      if (parsed === null) {
        fail(`Invalid date list ${show(text)}: ${show(item)} is not yyyyMMdd, yyyyMMddTHHmmss or yyyyMMddTHHmmssZ`);
      }
      if (parsed.kind === 'date') values.push({ kind: 'date', date: parsed.date });
      else if (parsed.kind === 'utc') values.push({ kind: 'utc', value: parsed.value });
      else if (tzid !== null) values.push({ kind: 'zoned', value: parsed.value, tzid });
      else values.push({ kind: 'floating', value: parsed.value });
    }
  }
  return values;
}

function valueProblem(value: unknown, form: DateListForm): string | null {
  if (!isRecord(value)) return `expected an object, got ${show(value)}`;
  if (value.kind !== form) return `a '${form}' list holds only '${form}' values, got kind ${show(value.kind)}`;
  if (form === 'date') return isValidGregorian(value.date) ? null : `invalid date ${show(value.date)}`;
  if (!isValidLocalDateTime(value.value) || value.value.minute === 1440) {
    return `value must be a local date-time with minute 0..1439, got ${show(value.value)}`;
  }
  if (form === 'zoned') {
    const tzid = value.tzid;
    if (typeof tzid !== 'string' || tzid === '' || /[,;\r\n]/.test(tzid) || trimBlanks(tzid) !== tzid) {
      return `zone id must be a non-empty string without ',', ';', line breaks or blanks at either end, got ${show(tzid)}`;
    }
  }
  return null;
}

/**
 * Writes a list in one form: `'date'` (`20261019,20261116`), `'zoned'`
 * (`Europe/Tallinn;20261116T190000,20261214T190000`, every value in the same
 * zone) or `'utc'` (`20261116T170000Z,...`). Every value must already be of the
 * form's kind (a date, a zoned or a UTC value): converting between them needs
 * the event's time and zone, which the caller has. Values keep their order,
 * date-times are written with seconds `00`, and an empty list is `''`.
 * `parseDateList(formatDateList(values, form))` equals `values`.
 * @throws RangeError for an unknown form, a value of another kind or with an
 * invalid date or minute (24:00 is not a list value), zoned values with
 * different zone ids, or a zone id containing `,`, `;`, a line break, or blanks
 * at either end.
 */
export function formatDateList(values: readonly DateListValue[], form: 'date' | 'zoned' | 'utc'): string {
  if (!FORMS.includes(form)) fail(`Date list form must be 'date', 'zoned' or 'utc', got ${show(form)}`);
  if (!Array.isArray(values)) fail(`Date list values must be an array, got ${show(values)}`);
  values.forEach((value, index) => {
    const problem = valueProblem(value, form);
    if (problem !== null) fail(`Invalid date list value at index ${index}: ${problem}`);
  });
  const texts = values.map((v) => (v.kind === 'date' ? formatICalDate(v.date) : formatICalDateTime(v.value, 0, v.kind === 'utc')));
  if (form !== 'zoned' || values.length === 0) return texts.join(',');
  const tzids = [...new Set(values.map((v) => (v.kind === 'zoned' ? v.tzid : '')))];
  if (tzids.length > 1) fail(`A zoned date list has one zone id, got ${tzids.map((t) => show(t)).join(' and ')}`);
  return `${tzids[0]};${texts.join(',')}`;
}
