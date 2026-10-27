/**
 * iCalendar value types the `.ics` module reads and writes (RFC 5545 §3.3):
 * DATE and DATE-TIME values with their `VALUE` and `TZID` parameters,
 * durations and UTC offsets. Minute precision, as everywhere in the events
 * engine (seconds are dropped when reading, §3.3).
 * @internal
 * @module
 */

import { type GregorianDate, toISODate } from '../gregorian.ts';
import { fail, pad, show } from '../internal.ts';
import { formatICalDate, formatICalDateTime, parseICalValue } from '../events/rrule.ts';
import { type LocalDateTime, formatLocalDateTime, isValidLocalDateTime } from '../events/time.ts';
import { paramValue, quoteParam } from './lexer.ts';
import type { IcsDateValue } from './types.ts';

/** Reads a DATE or DATE-TIME value with its `VALUE` and `TZID` parameters; null when it does not parse or contradicts `VALUE`. */
export function readDateValue(text: string, params: readonly (readonly [string, string])[]): IcsDateValue | null {
  const parsed = parseICalValue(text.trim());
  if (parsed === null) return null;
  const valueType = paramValue(params, 'VALUE')?.toUpperCase() ?? null;
  if (valueType === 'DATE' && parsed.kind !== 'date') return null;
  if ((valueType === 'DATE-TIME' || valueType === 'PERIOD') && parsed.kind === 'date') return null;
  if (parsed.kind === 'date') return { kind: 'date', date: parsed.date };
  if (parsed.kind === 'utc') return { kind: 'utc', value: parsed.value };
  const tzid = paramValue(params, 'TZID');
  if (tzid !== null && tzid !== '') return { kind: 'zoned', value: parsed.value, tzid };
  return { kind: 'floating', value: parsed.value };
}

/** The text of a value: `yyyyMMdd`, `yyyyMMddTHHmmss` or `yyyyMMddTHHmmssZ` (seconds `00`). */
export function dateValueText(value: IcsDateValue): string {
  return value.kind === 'date' ? formatICalDate(value.date) : formatICalDateTime(value.value, 0, value.kind === 'utc');
}

/** The parameters a value is written with: `VALUE=DATE` for a date, `TZID` for a zoned date-time. */
export function dateValueParams(value: IcsDateValue): [string, string][] {
  if (value.kind === 'date') return [['VALUE', 'DATE']];
  if (value.kind === 'zoned') return [['TZID', quoteParam(value.tzid)]];
  return [];
}

/** A text key that is equal for equal values (kind, zone and wall clock). */
export function dateValueKey(value: IcsDateValue): string {
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

/** `true` when two values (or nulls) are the same value. */
export function sameDateValue(a: IcsDateValue | null, b: IcsDateValue | null): boolean {
  if (a === null || b === null) return a === b;
  return dateValueKey(a) === dateValueKey(b);
}

/** The date of a value. */
export function dateOfValue(value: IcsDateValue): GregorianDate {
  return value.kind === 'date' ? value.date : value.value.date;
}

/** Validates the shape of a value (used on input from platforms). */
export function assertDateValue(value: unknown, context: string): asserts value is IcsDateValue {
  const v = value as { kind?: unknown; date?: unknown; value?: unknown; tzid?: unknown } | null;
  if (typeof v !== 'object' || v === null) fail(`${context} must be an IcsDateValue, got ${show(value)}`);
  switch (v.kind) {
    case 'date':
      if (!isValidLocalDateTime({ date: v.date, minute: 0 })) fail(`${context} date is invalid: ${show(value)}`);
      return;
    case 'floating':
    case 'utc':
    case 'zoned':
      if (!isValidLocalDateTime(v.value) || (v.value as LocalDateTime).minute > 1439) fail(`${context} value is invalid: ${show(value)}`);
      if (v.kind === 'zoned' && (typeof v.tzid !== 'string' || v.tzid === '')) fail(`${context} tzid must be a non-empty string`);
      return;
    default:
      fail(`${context} kind must be 'date', 'floating', 'utc' or 'zoned', got ${show(v.kind)}`);
  }
}

// ---------------------------------------------------------------------------
// Durations (RFC 5545 §3.3.6)
// ---------------------------------------------------------------------------

/** A duration: nominal days (weeks count 7) and exact seconds, with one sign. */
export interface Duration {
  readonly negative: boolean;
  readonly days: number;
  readonly seconds: number;
}

const DURATION = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i;

/** Reads `P1D`, `PT1H30M`, `-P1W`, `P1DT2H`; null for anything else (a `T` must be followed by a part). */
export function parseDuration(text: string): Duration | null {
  const trimmed = text.trim();
  const match = DURATION.exec(trimmed);
  if (match === null) return null;
  const [, sign, w, d, h, m, s] = match;
  if (w === undefined && d === undefined && h === undefined && m === undefined && s === undefined) return null;
  if (/T$/i.test(trimmed)) return null;
  const n = (x: string | undefined) => (x === undefined ? 0 : Number(x));
  const days = n(w) * 7 + n(d);
  const seconds = n(h) * 3600 + n(m) * 60 + n(s);
  if (!Number.isSafeInteger(days) || !Number.isSafeInteger(seconds)) return null;
  return { negative: sign === '-', days, seconds };
}

/** A duration's length in minutes (days as 1440 minutes, seconds truncated toward zero), signed. */
export function durationMinutes(duration: Duration): number {
  const minutes = duration.days * 1440 + Math.trunc(duration.seconds / 60);
  return duration.negative ? -minutes : minutes;
}

/**
 * Writes a signed number of minutes as a duration: weeks or days when whole
 * (`-P1W`, `-P2D`), else days and a time part (`-P1DT1H`, `-PT15M`); 0 is `PT0S`.
 */
export function formatDurationMinutes(minutes: number): string {
  if (minutes === 0) return 'PT0S';
  const sign = minutes < 0 ? '-' : '';
  let rest = Math.abs(minutes);
  if (rest % 10080 === 0) return `${sign}P${rest / 10080}W`;
  const days = Math.floor(rest / 1440);
  rest -= days * 1440;
  const hours = Math.floor(rest / 60);
  const mins = rest - hours * 60;
  const time = rest === 0 ? '' : `T${hours > 0 ? `${hours}H` : ''}${mins > 0 ? `${mins}M` : ''}`;
  return `${sign}P${days > 0 ? `${days}D` : ''}${time}`;
}

// ---------------------------------------------------------------------------
// UTC offsets (RFC 5545 §3.3.14)
// ---------------------------------------------------------------------------

const OFFSET = /^([+-])(\d{2})(\d{2})(\d{2})?$/;

/** Reads `+0300`, `-0500`, `+053000` as minutes east of UTC (seconds dropped); null for anything else. */
export function parseUtcOffset(text: string): number | null {
  const match = OFFSET.exec(text.trim());
  if (match === null) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59 || (match[4] !== undefined && Number(match[4]) > 59)) return null;
  const total = hours * 60 + minutes;
  return match[1] === '-' && total !== 0 ? -total : total;
}

/** Writes minutes east of UTC as `+HHMM` / `-HHMM`. */
export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60), 2)}${pad(abs % 60, 2)}`;
}
