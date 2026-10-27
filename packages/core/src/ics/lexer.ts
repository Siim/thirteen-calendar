/**
 * iCalendar content lines (RFC 5545 §3.1): physical lines, unfolding,
 * properties with parameters, `TEXT` escaping and 75-octet folding.
 *
 * The reader is tolerant: CRLF, LF and CR line ends, a UTF-8 byte order mark,
 * folds that begin with a space or a tab, lowercase names and quoted parameter
 * values are accepted. The writer is strict: CRLF, uppercase names, lines
 * folded at 75 octets without splitting a UTF-8 sequence.
 * @internal
 * @module
 */

import type { IcsProperty } from './types.ts';

/** One logical (unfolded) content line and where it came from. */
export interface ContentLine {
  /** The unfolded text. */
  readonly text: string;
  /** Index of its first physical line. */
  readonly first: number;
  /** Index of its last physical line (folds included). */
  readonly last: number;
}

/** A parsed content line, with the physical text it was read from. */
export interface SourceProperty extends IcsProperty {
  /** The physical lines as read, joined with CRLF, without a final line end. */
  readonly source: string;
  /** 1-based line number of its first physical line. */
  readonly line: number;
}

const BOM = '﻿';

/** The physical lines of a text (BOM dropped, any line end), without the empty line after a final line end. */
export function physicalLines(text: string): string[] {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  const lines = body.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Unfolds physical lines `from`..`to` (inclusive) into logical lines; empty physical lines are skipped. */
export function unfold(lines: readonly string[], from = 0, to = lines.length - 1): ContentLine[] {
  const out: ContentLine[] = [];
  let text: string | null = null;
  let first = 0;
  let last = 0;
  for (let i = from; i <= to; i++) {
    const line = lines[i]!;
    const continues = line.length > 0 && (line[0] === ' ' || line[0] === '\t');
    if (continues && text !== null) {
      text += line.slice(1);
      last = i;
      continue;
    }
    if (text !== null) out.push({ text, first, last });
    text = null;
    if (line === '') continue;
    text = line;
    first = i;
    last = i;
  }
  if (text !== null) out.push({ text, first, last });
  return out;
}

const NAME = /^[A-Za-z0-9-]+/;

/**
 * Splits an unfolded line into name, parameters and value: `NAME;P=V;Q="x:y":value`.
 * A parameter value ends at an unquoted `;` or `:` (commas separate the
 * values of one parameter and stay in its text). `null` when the line is not
 * a content line.
 */
export function parseContentLine(text: string): IcsProperty | null {
  const nameMatch = NAME.exec(text);
  if (nameMatch === null) return null;
  const name = nameMatch[0].toUpperCase();
  let i = nameMatch[0].length;
  const params: [string, string][] = [];
  while (i < text.length && text[i] === ';') {
    const paramMatch = NAME.exec(text.slice(i + 1));
    if (paramMatch === null) return null;
    const paramName = paramMatch[0].toUpperCase();
    i += 1 + paramMatch[0].length;
    if (text[i] !== '=') return null;
    i++;
    const start = i;
    for (;;) {
      if (text[i] === '"') {
        const close = text.indexOf('"', i + 1);
        if (close < 0) return null;
        i = close + 1;
      } else {
        while (i < text.length && text[i] !== ';' && text[i] !== ':' && text[i] !== ',' && text[i] !== '"') i++;
      }
      if (text[i] === ',') {
        i++;
        continue;
      }
      break;
    }
    if (i >= text.length || (text[i] !== ';' && text[i] !== ':')) return null;
    params.push([paramName, text.slice(start, i)]);
  }
  if (text[i] !== ':') return null;
  return { name, params, value: text.slice(i + 1) };
}

/** The first value of a parameter, without quotes, or null when the property has no such parameter. */
export function paramValue(params: readonly (readonly [string, string])[], name: string): string | null {
  const entry = params.find(([key]) => key === name);
  if (entry === undefined) return null;
  return unquote(firstParamValue(entry[1]));
}

/** The first comma-separated value of a parameter's text (quotes kept). */
function firstParamValue(text: string): string {
  if (text.startsWith('"')) {
    const close = text.indexOf('"', 1);
    return close < 0 ? text : text.slice(0, close + 1);
  }
  const comma = text.indexOf(',');
  return comma < 0 ? text : text.slice(0, comma);
}

/** A parameter value without its surrounding quotes. */
export function unquote(text: string): string {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
}

/** A parameter value as it must be written: quoted when it holds `:`, `;` or `,` (double quotes are dropped). */
export function quoteParam(value: string): string {
  const clean = value.replaceAll('"', '');
  return /[:;,]/.test(clean) ? `"${clean}"` : clean;
}

/** Decodes a `TEXT` value: `\n` and `\N` are line breaks, `\,` `\;` `\\` the character; any other `\x` is `x`. */
export function unescapeText(value: string): string {
  if (!value.includes('\\')) return value;
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c !== '\\' || i === value.length - 1) {
      out += c;
      continue;
    }
    const next = value[++i]!;
    out += next === 'n' || next === 'N' ? '\n' : next;
  }
  return out;
}

/** Encodes a `TEXT` value: backslash, `;`, `,` escaped, every line break (CRLF, CR, LF) as `\n`. */
export function escapeText(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** The unfolded text of a property: `NAME;PARAM=value:value`. */
export function contentLineText(property: IcsProperty): string {
  const params = property.params.map(([name, value]) => `;${name}=${value}`).join('');
  return `${property.name}${params}:${property.value}`;
}

/** UTF-8 length of one code point. */
function utf8Length(codePoint: number): number {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

/**
 * Folds an unfolded line (RFC 5545 §3.1): the first physical line holds at
 * most 75 octets of UTF-8, every continuation a space and at most 74 more;
 * a code point is never split. Returns the physical lines joined with CRLF,
 * without a final line end.
 */
export function foldLine(text: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  let limit = 75;
  for (const char of text) {
    const size = utf8Length(char.codePointAt(0)!);
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
      limit = 74;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** UTF-8 bytes of a string (lone surrogates as U+FFFD). */
export function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    let cp = char.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return bytes;
}
