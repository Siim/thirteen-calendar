/**
 * Content lines, values, SHA-256 and colors of the `.ics` module
 * (docs/EVENTS.md §5.4 reader and writer rules).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cssColorHex, nearestCssColorName, normalizeHexColor } from '../../src/ics/colors.ts';
import {
  contentLineText,
  escapeText,
  foldLine,
  paramValue,
  parseContentLine,
  physicalLines,
  quoteParam,
  unescapeText,
  unfold,
  utf8Bytes,
} from '../../src/ics/lexer.ts';
import { sha256Hex } from '../../src/ics/sha256.ts';
import {
  dateValueKey,
  dateValueParams,
  dateValueText,
  durationMinutes,
  formatDurationMinutes,
  formatUtcOffset,
  parseDuration,
  parseUtcOffset,
  readDateValue,
} from '../../src/ics/values.ts';

describe('physical lines and unfolding', () => {
  it('accepts CRLF, LF and CR line ends and a byte order mark', () => {
    expect(physicalLines('A\r\nB\nC\rD\r\n')).toEqual(['A', 'B', 'C', 'D']);
    expect(physicalLines('﻿BEGIN:VCALENDAR\n')).toEqual(['BEGIN:VCALENDAR']);
    expect(physicalLines('A')).toEqual(['A']);
    expect(physicalLines('')).toEqual([]);
  });

  it('unfolds lines that begin with a space or a tab and skips empty lines', () => {
    const lines = ['SUMMARY:Long', ' er', '\ttext', '', 'X:1'];
    expect(unfold(lines)).toEqual([
      { text: 'SUMMARY:Longertext', first: 0, last: 2 },
      { text: 'X:1', first: 4, last: 4 },
    ]);
  });

  it('unfolds a multi-byte character split across the fold', () => {
    expect(unfold(['SUMMARY:Ü', ' ber']).map((c) => c.text)).toEqual(['SUMMARY:Über']);
  });
});

describe('content lines', () => {
  it('splits name, parameters and value', () => {
    expect(parseContentLine('dtstart;tzid=Europe/Tallinn:20261019T090000')).toEqual({
      name: 'DTSTART',
      params: [['TZID', 'Europe/Tallinn']],
      value: '20261019T090000',
    });
  });

  it('keeps quoted parameter values with colons, semicolons and commas, and several values', () => {
    const p = parseContentLine('ATTENDEE;CN="Kask, Liis";MEMBER="mailto:a@x.ee","mailto:b@x.ee":mailto:liis@x.ee')!;
    expect(p.params).toEqual([
      ['CN', '"Kask, Liis"'],
      ['MEMBER', '"mailto:a@x.ee","mailto:b@x.ee"'],
    ]);
    expect(p.value).toBe('mailto:liis@x.ee');
    expect(paramValue(p.params, 'CN')).toBe('Kask, Liis');
    expect(paramValue(p.params, 'MEMBER')).toBe('mailto:a@x.ee');
    expect(paramValue(p.params, 'ROLE')).toBeNull();
    expect(contentLineText(p)).toBe('ATTENDEE;CN="Kask, Liis";MEMBER="mailto:a@x.ee","mailto:b@x.ee":mailto:liis@x.ee');
  });

  it('keeps colons in the value', () => {
    expect(parseContentLine('URL:https://example.com/a:b')!.value).toBe('https://example.com/a:b');
    expect(parseContentLine('DESCRIPTION:')!.value).toBe('');
  });

  it.each(['no colon here', ':value', 'NAME;:x', 'NAME;P:x', 'NAME;P="open:x', 'NAME;P=a"b:x', 'NAME WITH SPACE:x'])('rejects %j', (text) => {
    expect(parseContentLine(text)).toBeNull();
  });

  it('quotes parameter values only when needed', () => {
    expect(quoteParam('Europe/Tallinn')).toBe('Europe/Tallinn');
    expect(quoteParam('(UTC+02:00) Helsinki, Kyiv')).toBe('"(UTC+02:00) Helsinki, Kyiv"');
    expect(quoteParam('a"b;c')).toBe('"ab;c"');
  });
});

describe('TEXT escaping', () => {
  it('decodes escapes', () => {
    expect(unescapeText('a\\, b\\; c\\\\ d\\n e\\N f\\x')).toBe('a, b; c\\ d\n e\n fx');
    expect(unescapeText('trailing\\')).toBe('trailing\\');
  });

  it('round-trips through escaping', () => {
    for (const text of ['plain', 'a, b; c\\ d', 'two\nlines', 'Windows\r\nbreak', '', 'emoji 🎉, too']) {
      const escaped = escapeText(text);
      expect(escaped).not.toMatch(/[\r\n]/);
      expect(unescapeText(escaped)).toBe(text.replace(/\r\n|\r/g, '\n'));
    }
  });
});

describe('folding', () => {
  const octets = (line: string) => utf8Bytes(line).length;

  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
    expect(foldLine('X'.repeat(75))).toBe('X'.repeat(75));
  });

  it('folds at 75 octets, continuations a space and 74 more', () => {
    const folded = foldLine('X'.repeat(200));
    const lines = folded.split('\r\n');
    expect(lines.map(octets)).toEqual([75, 75, 52]);
    expect(lines.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(unfold(lines).map((c) => c.text)).toEqual(['X'.repeat(200)]);
  });

  it('never splits a UTF-8 sequence', () => {
    const text = `SUMMARY:${'ä'.repeat(40)}${'🎉'.repeat(30)}`;
    const lines = foldLine(text).split('\r\n');
    expect(lines.every((l) => octets(l) <= 75)).toBe(true);
    expect(lines.join('').replaceAll('\r\n', '')).not.toContain('�');
    expect(unfold(lines).map((c) => c.text)).toEqual([text]);
    for (const line of lines) expect([...line].join('')).toBe(line);
  });
});

describe('SHA-256', () => {
  it.each(['', 'abc', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'Õhtu 🎉 Tallinn'.repeat(20)])(
    'matches node:crypto for %j',
    (text) => {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    },
  );

  it('matches the FIPS 180-4 examples', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('date values', () => {
  const p = (...params: [string, string][]) => params;

  it('reads every kind', () => {
    expect(readDateValue('20261019', p(['VALUE', 'DATE']))).toEqual({ kind: 'date', date: { year: 2026, month: 10, day: 19 } });
    expect(readDateValue('20261019', p())).toEqual({ kind: 'date', date: { year: 2026, month: 10, day: 19 } });
    expect(readDateValue('20261019T093059', p())).toEqual({ kind: 'floating', value: { date: { year: 2026, month: 10, day: 19 }, minute: 570 } });
    expect(readDateValue('20261019T093000z', p())).toEqual({ kind: 'utc', value: { date: { year: 2026, month: 10, day: 19 }, minute: 570 } });
    expect(readDateValue('20261019T093000', p(['TZID', '"Europe/Tallinn"']))).toEqual({
      kind: 'zoned',
      value: { date: { year: 2026, month: 10, day: 19 }, minute: 570 },
      tzid: 'Europe/Tallinn',
    });
    expect(readDateValue('20261019T093000Z', p(['TZID', 'Europe/Tallinn']))!.kind).toBe('utc');
    // Eight digits are a date: 10000101 is January 1 of year 1000 (the reader decides when it means year 10000).
    expect(readDateValue('10000101', p())).toEqual({ kind: 'date', date: { year: 1000, month: 1, day: 1 } });
  });

  it.each([
    ['20261019T090000', [['VALUE', 'DATE']]],
    ['20261019', [['VALUE', 'DATE-TIME']]],
    ['20260229', []],
    ['2026-10-19', []],
    ['20261019T250000', []],
    ['00001231', []],
  ] as [string, [string, string][]][])('rejects %j with %j', (text, params) => {
    expect(readDateValue(text, params)).toBeNull();
  });

  it('writes values with their parameters', () => {
    const zoned = { kind: 'zoned', value: { date: { year: 2026, month: 10, day: 19 }, minute: 570 }, tzid: 'FLE Standard Time' } as const;
    expect([dateValueText(zoned), dateValueParams(zoned)]).toEqual(['20261019T093000', [['TZID', 'FLE Standard Time']]]);
    const date = { kind: 'date', date: { year: 9, month: 1, day: 2 } } as const;
    expect([dateValueText(date), dateValueParams(date)]).toEqual(['00090102', [['VALUE', 'DATE']]]);
    const utc = { kind: 'utc', value: { date: { year: 2026, month: 10, day: 19 }, minute: 0 } } as const;
    expect([dateValueText(utc), dateValueParams(utc)]).toEqual(['20261019T000000Z', []]);
    expect(dateValueKey(zoned)).toBe('Z FLE Standard Time 2026-10-19T09:30');
  });
});

describe('durations and offsets', () => {
  it('reads durations', () => {
    expect(parseDuration('P1D')).toEqual({ negative: false, days: 1, seconds: 0 });
    expect(parseDuration('PT1H30M')).toEqual({ negative: false, days: 0, seconds: 5400 });
    expect(parseDuration('-P1W')).toEqual({ negative: true, days: 7, seconds: 0 });
    expect(parseDuration('+P1DT2H3M4S')).toEqual({ negative: false, days: 1, seconds: 7384 });
    expect(parseDuration('-P0DT0H30M0S')).toEqual({ negative: true, days: 0, seconds: 1800 });
    for (const bad of ['P', 'PT', 'P1DT', '1D', 'P1H', 'PT1D', '']) expect(parseDuration(bad), bad).toBeNull();
  });

  it('converts durations to minutes and back', () => {
    expect(durationMinutes(parseDuration('-PT15M')!)).toBe(-15);
    expect(durationMinutes(parseDuration('PT90S')!)).toBe(1);
    expect(durationMinutes(parseDuration('-PT90S')!)).toBe(-1);
    expect(durationMinutes(parseDuration('P2D')!)).toBe(2880);
    for (const [minutes, text] of [
      [0, 'PT0S'],
      [-15, '-PT15M'],
      [-60, '-PT1H'],
      [-90, '-PT1H30M'],
      [-1440, '-P1D'],
      [-1500, '-P1DT1H'],
      [-10080, '-P1W'],
      [-20160, '-P2W'],
      [30, 'PT30M'],
    ] as const) {
      expect(formatDurationMinutes(minutes)).toBe(text);
      expect(durationMinutes(parseDuration(text)!)).toBe(minutes);
    }
  });

  it('reads and writes UTC offsets', () => {
    expect(parseUtcOffset('+0300')).toBe(180);
    expect(parseUtcOffset('-0500')).toBe(-300);
    expect(parseUtcOffset('+0545')).toBe(345);
    expect(parseUtcOffset('-003000')).toBe(-30);
    expect(parseUtcOffset('+002456')).toBe(24);
    expect(parseUtcOffset('-0000')).toBe(0);
    for (const bad of ['0300', '+3', '+2400', '+0060', 'Z']) expect(parseUtcOffset(bad), bad).toBeNull();
    expect(formatUtcOffset(180)).toBe('+0300');
    expect(formatUtcOffset(-300)).toBe('-0500');
    expect(formatUtcOffset(0)).toBe('+0000');
    expect(formatUtcOffset(-30)).toBe('-0030');
  });
});

describe('colors', () => {
  it('normalizes Apple colors', () => {
    expect(normalizeHexColor('#EA580C')).toBe('#ea580c');
    expect(normalizeHexColor('#EA580CFF')).toBe('#ea580c');
    expect(normalizeHexColor('EA580C')).toBeNull();
    expect(normalizeHexColor('#EA58')).toBeNull();
  });

  it('maps CSS3 names both ways', () => {
    expect(cssColorHex('OrangeRed')).toBe('#ff4500');
    expect(cssColorHex('rebeccapurple')).toBeNull();
    expect(nearestCssColorName('#ff4500')).toBe('orangered');
    expect(nearestCssColorName('#00ffff')).toBe('aqua');
    expect(nearestCssColorName('#808080')).toBe('gray');
    // The palette of §3.6.
    expect(['#ea580c', '#dc2626', '#d97706', '#16a34a', '#0d9488', '#2563eb', '#4f46e5', '#9333ea', '#db2777', '#92400e', '#57534e'].map(nearestCssColorName)).toEqual([
      'orangered',
      'crimson',
      'chocolate',
      'seagreen',
      'darkcyan',
      'royalblue',
      'royalblue',
      'blueviolet',
      'mediumvioletred',
      'saddlebrown',
      'dimgray',
    ]);
  });
});
