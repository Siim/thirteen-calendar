/**
 * events/date-lists.ts: the Android provider's RDATE / EXDATE text forms
 * (docs/EVENTS.md §4.4, §5.2): dates, `TZID;` date-times and UTC date-times,
 * multi-line and mixed lists as other writers store them.
 */
import { describe, expect, it } from 'vitest';
import { type DateListValue, formatDateList, parseDateList, parseLocalDateTime } from '../../src/events/index.ts';
import { g } from '../helpers.ts';

const L = parseLocalDateTime;
const date = (iso: string): DateListValue => ({ kind: 'date', date: g(iso) });
const utc = (local: string): DateListValue => ({ kind: 'utc', value: L(local) });
const zoned = (local: string, tzid = 'Europe/Tallinn'): DateListValue => ({ kind: 'zoned', value: L(local), tzid });
const floating = (local: string): DateListValue => ({ kind: 'floating', value: L(local) });

/** A small deterministic PRNG (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('parseDateList', () => {
  it('reads the three forms of §4.4', () => {
    expect(parseDateList('20261019,20261116')).toEqual([date('2026-10-19'), date('2026-11-16')]);
    expect(parseDateList('Europe/Tallinn;20261116T190000,20261214T190000')).toEqual([
      zoned('2026-11-16T19:00'),
      zoned('2026-12-14T19:00'),
    ]);
    expect(parseDateList('20261116T170000Z,20261214T170000Z')).toEqual([utc('2026-11-16T17:00'), utc('2026-12-14T17:00')]);
  });

  it('reads mixed and multi-line lists as AOSP does', () => {
    expect(parseDateList('Europe/Tallinn;20261116T190000,20261214T170000Z,20270111')).toEqual([
      zoned('2026-11-16T19:00'),
      utc('2026-12-14T17:00'),
      date('2027-01-11'),
    ]);
    expect(parseDateList('20261116T170000Z\nAmerica/New_York;20261214T130000\r\n20270111T090000')).toEqual([
      utc('2026-11-16T17:00'),
      zoned('2026-12-14T13:00', 'America/New_York'),
      floating('2027-01-11T09:00'),
    ]);
  });

  it('ignores blanks, empty lines and empty values; drops seconds; accepts lowercase t and z', () => {
    expect(parseDateList('  20261019 ,\t20261116 , ,\r\n\r\n  ')).toEqual([date('2026-10-19'), date('2026-11-16')]);
    expect(parseDateList(' Europe/Tallinn ;20261116T190059')).toEqual([zoned('2026-11-16T19:00')]);
    expect(parseDateList('20261116t170000z')).toEqual([utc('2026-11-16T17:00')]);
    expect(parseDateList('20261231T235960Z')).toEqual([utc('2026-12-31T23:59')]);
    expect(parseDateList('Europe/Tallinn;')).toEqual([]);
  });

  it('keeps order and duplicates', () => {
    expect(parseDateList('20261116,20261019,20261116')).toEqual([date('2026-11-16'), date('2026-10-19'), date('2026-11-16')]);
  });

  it('reads an empty text as an empty list', () => {
    expect(parseDateList('')).toEqual([]);
    expect(parseDateList('\n \n')).toEqual([]);
  });

  it('reads the range edges', () => {
    expect(parseDateList('00010101,99991231T235959Z')).toEqual([date('0001-01-01'), utc('9999-12-31T23:59')]);
  });

  it.each([
    '2026-10-19',
    '20260230',
    '00001231',
    '100000101',
    '2026101',
    '20261116T1900',
    '20261116T250000',
    '20261116T196000',
    '20261116T190061',
    '20261116T190000+0200',
    '20261116 T190000',
    ';20261116T190000',
    ' ;20261116',
    'a,b;20261116',
    'Europe/Tallinn;20261116T190000;20261117T190000',
    '20261019,x',
  ])('rejects %j', (text) => {
    expect(() => parseDateList(text)).toThrow(RangeError);
  });

  it('rejects non-strings', () => {
    expect(() => parseDateList(undefined as unknown as string)).toThrow(RangeError);
  });
});

describe('formatDateList', () => {
  it('writes each form', () => {
    expect(formatDateList([date('2026-10-19'), date('2026-11-16')], 'date')).toBe('20261019,20261116');
    expect(formatDateList([zoned('2026-11-16T19:00'), zoned('2026-12-14T19:00')], 'zoned')).toBe(
      'Europe/Tallinn;20261116T190000,20261214T190000',
    );
    expect(formatDateList([utc('2026-11-16T17:00'), utc('2026-12-14T17:00')], 'utc')).toBe('20261116T170000Z,20261214T170000Z');
    expect(formatDateList([date('0001-01-01'), date('9999-12-31')], 'date')).toBe('00010101,99991231');
  });

  it('writes an empty list as empty text in every form', () => {
    for (const form of ['date', 'zoned', 'utc'] as const) expect(formatDateList([], form)).toBe('');
  });

  it.each([
    ['a date in a zoned list', [date('2026-10-19')], 'zoned'],
    ['a UTC value in a zoned list', [zoned('2026-11-16T19:00'), utc('2026-12-14T17:00')], 'zoned'],
    ['a zoned value in a UTC list', [zoned('2026-11-16T19:00')], 'utc'],
    ['a floating value', [floating('2026-11-16T19:00')], 'utc'],
    ['a date-time in a date list', [utc('2026-11-16T19:00')], 'date'],
    ['two zones', [zoned('2026-11-16T19:00'), zoned('2026-12-14T13:00', 'America/New_York')], 'zoned'],
    ['an empty zone id', [zoned('2026-11-16T19:00', '')], 'zoned'],
    ['a zone id with a comma', [zoned('2026-11-16T19:00', 'Europe/Tallinn,x')], 'zoned'],
    ['a zone id with a semicolon', [zoned('2026-11-16T19:00', 'Europe;Tallinn')], 'zoned'],
    ['a zone id with a line break', [zoned('2026-11-16T19:00', 'Europe/Tallinn\n')], 'zoned'],
    ['a zone id with a leading blank', [zoned('2026-11-16T19:00', ' Europe/Tallinn')], 'zoned'],
    ['24:00', [{ kind: 'utc', value: L('2026-11-16T24:00') }], 'utc'],
    ['an invalid date', [{ kind: 'date', date: { year: 2026, month: 2, day: 30 } }], 'date'],
    ['an unknown form', [date('2026-10-19')], 'dates'],
  ] as const)('rejects %s', (_, values, form) => {
    expect(() => formatDateList(values as readonly DateListValue[], form as 'date')).toThrow(RangeError);
  });

  it('rejects non-arrays', () => {
    expect(() => formatDateList('20261019' as never, 'date')).toThrow(RangeError);
  });

  it('round-trips random lists in every form: parse(format(values)) equals values', () => {
    const next = random(2026);
    const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
    const day = () => ({ year: int(1, 9999), month: int(1, 12), day: int(1, 28) });
    const local = () => ({ date: day(), minute: int(0, 1439) });
    for (let i = 0; i < 500; i++) {
      const length = int(0, 6);
      const tzid = ['Europe/Tallinn', 'America/New_York', 'UTC', 'Etc/GMT+5'][int(0, 3)]!;
      const lists: [DateListValue[], 'date' | 'zoned' | 'utc'][] = [
        [Array.from({ length }, () => ({ kind: 'date', date: day() })), 'date'],
        [Array.from({ length }, () => ({ kind: 'zoned', value: local(), tzid })), 'zoned'],
        [Array.from({ length }, () => ({ kind: 'utc', value: local() })), 'utc'],
      ];
      for (const [values, form] of lists) {
        const text = formatDateList(values, form);
        expect(parseDateList(text), text).toEqual(values);
        expect(formatDateList(parseDateList(text), form)).toBe(text);
      }
    }
  });
});
