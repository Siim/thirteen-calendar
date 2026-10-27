/**
 * events/time.ts: LocalDateTime, end-of-day form, wall-clock arithmetic and the
 * zone conversion rule (docs/EVENTS.md §3.1.1, §3.3, §5.2). Real zones are
 * checked against Node's Intl (ICU tzdata) through scripts/zone-resolvers.ts.
 */
import { describe, expect, it } from 'vitest';
import { intlZoneResolver, syntheticZoneResolver } from '../../scripts/zone-resolvers.ts';
import {
  type LocalDateTime,
  type ZoneResolver,
  addMinutesLocal,
  compareLocalDateTime,
  diffMinutesLocal,
  displayEnd,
  formatLocalDateTime,
  localDateTime,
  normalizeEventEnd,
  occurrenceDays,
  parseLocalDateTime,
  tryParseLocalDateTime,
  utcToZoned,
  zonedToUtc,
} from '../../src/events/index.ts';
import { toISODate } from '../../src/index.ts';
import { g } from '../helpers.ts';

const L = parseLocalDateTime;
const text = (value: LocalDateTime | null) => (value === null ? null : formatLocalDateTime(value));

describe('localDateTime', () => {
  it('builds a fresh value for minutes 0..1440', () => {
    const date = g('2026-10-19');
    const value = localDateTime(date, 570);
    expect(value).toEqual({ date: { year: 2026, month: 10, day: 19 }, minute: 570 });
    expect(value.date).not.toBe(date);
    expect(localDateTime(date, 0).minute).toBe(0);
    expect(localDateTime(date, 1440).minute).toBe(1440);
  });

  it.each([-1, 1441, 1.5, Number.NaN, '60' as unknown as number])('rejects minute %s', (minute) => {
    expect(() => localDateTime(g('2026-10-19'), minute)).toThrow(RangeError);
  });

  it('rejects invalid dates', () => {
    expect(() => localDateTime({ year: 2026, month: 2, day: 29 }, 0)).toThrow(RangeError);
    expect(() => localDateTime({ year: 10000, month: 1, day: 1 }, 0)).toThrow(RangeError);
  });
});

describe('parseLocalDateTime / formatLocalDateTime', () => {
  it.each([
    ['2026-10-19T09:30', 2026, 10, 19, 570],
    ['2026-10-19T00:00', 2026, 10, 19, 0],
    ['2026-10-19T23:59', 2026, 10, 19, 1439],
    ['2026-10-19T24:00', 2026, 10, 19, 1440],
    ['0001-01-01T00:00', 1, 1, 1, 0],
    ['9999-12-31T24:00', 9999, 12, 31, 1440],
    ['2024-02-29T10:00', 2024, 2, 29, 600],
  ])('parses %s and formats it back', (input, year, month, day, minute) => {
    const value = L(input);
    expect(value).toEqual({ date: { year, month, day }, minute });
    expect(formatLocalDateTime(value)).toBe(input);
  });

  it.each([
    '2026-10-19T24:01',
    '2026-10-19T25:00',
    '2026-10-19T09:60',
    '2026-02-29T10:00',
    '10000-01-01T00:00',
    '0000-12-31T00:00',
    '2026-10-19T9:30',
    '2026-10-19T09:30:00',
    '2026-10-19T09:30Z',
    '2026-10-19 09:30',
    '2026-10-19t09:30',
    '2026-10-19',
    ' 2026-10-19T09:30',
    '+2026-10-19T09:30',
    '',
  ])('rejects %j', (input) => {
    expect(() => L(input)).toThrow(RangeError);
    expect(tryParseLocalDateTime(input)).toBeNull();
  });

  it('rejects non-strings and invalid values', () => {
    expect(() => L(42 as unknown as string)).toThrow(RangeError);
    expect(() => formatLocalDateTime({ date: g('2026-10-19'), minute: 1441 })).toThrow(RangeError);
    expect(() => formatLocalDateTime({ date: { year: 2026, month: 13, day: 1 }, minute: 0 })).toThrow(RangeError);
  });
});

describe('compareLocalDateTime and wall-clock arithmetic', () => {
  it('treats D T24:00 and D+1 T00:00 as the same moment', () => {
    expect(compareLocalDateTime(L('2026-10-19T24:00'), L('2026-10-20T00:00'))).toBe(0);
    expect(compareLocalDateTime(L('2026-10-19T23:59'), L('2026-10-19T24:00'))).toBe(-1);
    expect(compareLocalDateTime(L('2026-10-20T00:01'), L('2026-10-19T24:00'))).toBe(1);
    expect(compareLocalDateTime(L('0001-01-01T00:00'), L('9999-12-31T24:00'))).toBe(-1);
  });

  it('sorts with Array#sort', () => {
    const values = ['2026-10-20T00:00', '2026-10-19T09:00', '2026-10-19T24:00', '2025-12-31T23:59'].map(L);
    expect(values.sort(compareLocalDateTime).map(formatLocalDateTime)).toEqual([
      '2025-12-31T23:59',
      '2026-10-19T09:00',
      '2026-10-20T00:00',
      '2026-10-19T24:00',
    ]);
  });

  it.each([
    ['2026-10-19T09:30', 30, '2026-10-19T10:00'],
    ['2026-10-19T23:30', 30, '2026-10-20T00:00'],
    ['2026-10-19T24:00', 0, '2026-10-20T00:00'],
    ['2026-12-31T12:00', 1440, '2027-01-01T12:00'],
    ['2024-06-16T12:00', 1440, '2024-06-17T12:00'],
    ['2024-02-28T23:00', 120, '2024-02-29T01:00'],
    ['2026-01-01T00:30', -60, '2025-12-31T23:30'],
    ['0001-01-01T00:30', -30, '0001-01-01T00:00'],
    ['9999-12-31T23:00', 59, '9999-12-31T23:59'],
  ])('addMinutesLocal(%s, %i) = %s, never 24:00', (from, minutes, expected) => {
    expect(formatLocalDateTime(addMinutesLocal(L(from), minutes))).toBe(expected);
  });

  it('addMinutesLocal throws past the range and for non-integers', () => {
    expect(() => addMinutesLocal(L('9999-12-31T23:00'), 60)).toThrow(RangeError);
    expect(() => addMinutesLocal(L('9999-12-31T24:00'), 0)).toThrow(RangeError);
    expect(() => addMinutesLocal(L('0001-01-01T00:30'), -31)).toThrow(RangeError);
    expect(() => addMinutesLocal(L('2026-10-19T09:30'), 1.5)).toThrow(RangeError);
  });

  it('diffMinutesLocal is a - b on the wall clock', () => {
    expect(diffMinutesLocal(L('2026-10-19T21:00'), L('2026-10-19T19:00'))).toBe(120);
    expect(diffMinutesLocal(L('2026-10-19T24:00'), L('2026-10-20T00:00'))).toBe(0);
    expect(diffMinutesLocal(L('2026-10-19T09:00'), L('2026-10-20T09:00'))).toBe(-1440);
    expect(diffMinutesLocal(L('2025-01-01T00:00'), L('2024-01-01T00:00'))).toBe(366 * 1440);
  });

  it('round-trips addMinutesLocal and diffMinutesLocal over a leap year', () => {
    const start = L('2024-01-01T00:00');
    for (let minutes = 0; minutes <= 366 * 1440; minutes += 997) {
      expect(diffMinutesLocal(addMinutesLocal(start, minutes), start)).toBe(minutes);
    }
  });
});

describe('end-of-day form (§3.1.1)', () => {
  it.each([
    ['2026-10-19T09:00', '2026-10-19T10:00', '2026-10-19T10:00', ['2026-10-19']],
    ['2026-10-19T23:00', '2026-10-20T00:00', '2026-10-19T24:00', ['2026-10-19']],
    ['2026-10-19T09:00', '2026-10-19T24:00', '2026-10-19T24:00', ['2026-10-19']],
    ['2026-10-19T00:00', '2026-10-19T00:00', '2026-10-19T00:00', ['2026-10-19']],
    ['2026-10-19T00:00', '2026-10-18T24:00', '2026-10-19T00:00', ['2026-10-19']],
    ['2026-10-19T22:00', '2026-10-20T01:30', '2026-10-20T01:30', ['2026-10-19', '2026-10-20']],
    ['2026-10-19T00:00', '2026-10-22T00:00', '2026-10-21T24:00', ['2026-10-19', '2026-10-20', '2026-10-21']],
    ['2026-12-31T22:00', '2027-01-01T02:00', '2027-01-01T02:00', ['2026-12-31', '2027-01-01']],
    ['9999-12-31T00:00', '9999-12-31T24:00', '9999-12-31T24:00', ['9999-12-31']],
  ])('%s to %s: normalized %s, days %j', (start, end, normalized, days) => {
    expect(formatLocalDateTime(normalizeEventEnd(L(start), L(end)))).toBe(normalized);
    expect(occurrenceDays(L(start), L(end)).map(toISODate)).toEqual(days);
  });

  it('throws for an end before the start and for a start at 24:00', () => {
    expect(() => normalizeEventEnd(L('2026-10-19T10:00'), L('2026-10-19T09:00'))).toThrow(RangeError);
    expect(() => normalizeEventEnd(L('2026-10-19T00:00'), L('2026-10-18T23:59'))).toThrow(RangeError);
    expect(() => normalizeEventEnd(L('2026-10-19T24:00'), L('2026-10-20T01:00'))).toThrow(RangeError);
    expect(() => occurrenceDays(L('2026-10-19T10:00'), L('2026-10-19T09:00'))).toThrow(RangeError);
  });

  it('returns fresh values', () => {
    const start = L('2026-10-19T09:00');
    const end = L('2026-10-19T10:00');
    expect(normalizeEventEnd(start, end)).not.toBe(end);
    expect(normalizeEventEnd(start, end).date).not.toBe(end.date);
    expect(normalizeEventEnd(start, start).date).not.toBe(start.date);
  });

  it('displayEnd shows D T24:00 as D+1 at 00:00 (§2.12)', () => {
    expect(formatLocalDateTime(displayEnd(L('2026-10-19T24:00')))).toBe('2026-10-20T00:00');
    expect(formatLocalDateTime(displayEnd(L('2026-12-31T24:00')))).toBe('2027-01-01T00:00');
    expect(formatLocalDateTime(displayEnd(L('2026-10-19T21:00')))).toBe('2026-10-19T21:00');
    expect(() => displayEnd(L('9999-12-31T24:00'))).toThrow(RangeError);
  });
});

/** A resolver that counts calls, to check the algorithm's probes. */
function counting(inner: ZoneResolver): ZoneResolver & { probes: string[] } {
  const probes: string[] = [];
  return {
    probes,
    isKnown: (tzid) => inner.isKnown(tzid),
    offsetMinutesAt(tzid, utc) {
      probes.push(formatLocalDateTime(utc));
      return inner.offsetMinutesAt(tzid, utc);
    },
  };
}

describe('zonedToUtc / utcToZoned on synthetic zones', () => {
  const europe = syntheticZoneResolver({
    name: 'Test/Europe',
    offset: 120,
    transitions: [
      { at: '2026-03-29T01:00', offset: 180 },
      { at: '2026-10-25T01:00', offset: 120 },
    ],
  });
  const toUtc = (local: string) => text(zonedToUtc(L(local), 'Test/Europe', europe));
  const toLocal = (utc: string) => text(utcToZoned(L(utc), 'Test/Europe', europe));

  it('converts ordinary times', () => {
    expect(toUtc('2026-07-01T12:00')).toBe('2026-07-01T09:00');
    expect(toUtc('2026-01-15T12:00')).toBe('2026-01-15T10:00');
    expect(toLocal('2026-07-01T09:00')).toBe('2026-07-01T12:00');
  });

  it('moves a time in a gap forward by the gap length', () => {
    expect(toUtc('2026-03-29T02:59')).toBe('2026-03-29T00:59');
    expect(toUtc('2026-03-29T03:00')).toBe('2026-03-29T01:00');
    expect(toUtc('2026-03-29T03:30')).toBe('2026-03-29T01:30');
    expect(toLocal('2026-03-29T01:30')).toBe('2026-03-29T04:30');
    expect(toUtc('2026-03-29T04:00')).toBe('2026-03-29T01:00');
  });

  it('takes the earlier instant in an overlap', () => {
    expect(toUtc('2026-10-25T02:59')).toBe('2026-10-24T23:59');
    expect(toUtc('2026-10-25T03:00')).toBe('2026-10-25T00:00');
    expect(toUtc('2026-10-25T03:30')).toBe('2026-10-25T00:30');
    expect(toUtc('2026-10-25T04:00')).toBe('2026-10-25T02:00');
    expect(toLocal('2026-10-25T00:30')).toBe('2026-10-25T03:30');
    expect(toLocal('2026-10-25T01:30')).toBe('2026-10-25T03:30');
  });

  it('accepts ends at 24:00 and returns plain values', () => {
    expect(toUtc('2026-10-25T24:00')).toBe('2026-10-25T22:00');
    expect(toLocal('2026-07-01T24:00')).toBe('2026-07-02T03:00');
  });

  it('a skipped day and a skipped midnight use the offset before the gap', () => {
    const apia = syntheticZoneResolver({ name: 'Test/Apia', offset: -600, transitions: [{ at: '2011-12-30T10:00', offset: 840 }] });
    expect(text(zonedToUtc(L('2011-12-30T09:00'), 'Test/Apia', apia))).toBe('2011-12-30T19:00');
    expect(text(utcToZoned(L('2011-12-30T19:00'), 'Test/Apia', apia))).toBe('2011-12-31T09:00');
    const midnight = syntheticZoneResolver({ name: 'Test/Mid', offset: -180, transitions: [{ at: '2018-11-04T03:00', offset: -120 }] });
    expect(text(zonedToUtc(L('2018-11-04T00:00'), 'Test/Mid', midnight))).toBe('2018-11-04T03:00');
    expect(text(utcToZoned(L('2018-11-04T03:00'), 'Test/Mid', midnight))).toBe('2018-11-04T01:00');
  });

  it('returns null outside years 1 to 9999 and probes only inside them', () => {
    const east = counting(syntheticZoneResolver({ name: 'Test/East', offset: 840, transitions: [] }));
    expect(zonedToUtc(L('0001-01-01T13:59'), 'Test/East', east)).toBeNull();
    expect(text(zonedToUtc(L('0001-01-01T14:00'), 'Test/East', east))).toBe('0001-01-01T00:00');
    expect(utcToZoned(L('9999-12-31T10:00'), 'Test/East', east)).toBeNull();
    expect(text(utcToZoned(L('9999-12-31T09:59'), 'Test/East', east))).toBe('9999-12-31T23:59');
    const west = counting(syntheticZoneResolver({ name: 'Test/West', offset: -720, transitions: [] }));
    expect(zonedToUtc(L('9999-12-31T12:00'), 'Test/West', west)).toBeNull();
    expect(zonedToUtc(L('9999-12-31T24:00'), 'Test/West', west)).toBeNull();
    expect(text(zonedToUtc(L('9999-12-31T11:59'), 'Test/West', west))).toBe('9999-12-31T23:59');
    expect(utcToZoned(L('0001-01-01T11:59'), 'Test/West', west)).toBeNull();
    for (const probe of [...east.probes, ...west.probes]) {
      expect(probe >= '0001-01-01T00:00' && probe <= '9999-12-31T23:59').toBe(true);
    }
  });

  it('throws for unknown zones, bad resolvers and bad offsets', () => {
    expect(() => zonedToUtc(L('2026-07-01T12:00'), 'Europe/Nowhere', europe)).toThrow('Unknown time zone');
    expect(() => zonedToUtc(L('2026-07-01T12:00'), '', europe)).toThrow(RangeError);
    expect(() => zonedToUtc(L('2026-07-01T12:00'), 'Test/Europe', {} as ZoneResolver)).toThrow(RangeError);
    const bad = (offset: number): ZoneResolver => ({ isKnown: () => true, offsetMinutesAt: () => offset });
    expect(() => zonedToUtc(L('2026-07-01T12:00'), 'X', bad(1.5))).toThrow(RangeError);
    expect(() => utcToZoned(L('2026-07-01T12:00'), 'X', bad(1440))).toThrow(RangeError);
    expect(() => utcToZoned(L('2026-07-01T12:00'), 'X', bad(Number.NaN))).toThrow(RangeError);
    expect(text(utcToZoned(L('2026-07-01T12:00'), 'X', bad(-0)))).toBe('2026-07-01T12:00');
  });
});

describe('zonedToUtc / utcToZoned on real zones (Intl oracle)', () => {
  const zones = intlZoneResolver();

  // The `zones` cases of §5.5 (America/New_York gap and overlap, Tallinn, Lord Howe, Apia, Sao Paulo, Kathmandu, UTC).
  it.each([
    ['America/New_York', '2026-03-08T02:30', '2026-03-08T07:30'],
    ['America/New_York', '2026-11-01T01:30', '2026-11-01T05:30'],
    ['Europe/Tallinn', '2026-03-29T03:30', '2026-03-29T01:30'],
    ['Europe/Tallinn', '2026-10-25T03:30', '2026-10-25T00:30'],
    ['Australia/Lord_Howe', '2026-10-04T02:15', '2026-10-03T15:45'],
    ['Pacific/Apia', '2011-12-30T09:00', '2011-12-30T19:00'],
    ['America/Sao_Paulo', '2018-11-04T00:00', '2018-11-04T03:00'],
    ['Asia/Kathmandu', '2026-10-19T12:00', '2026-10-19T06:15'],
    ['UTC', '2026-10-19T12:00', '2026-10-19T12:00'],
    ['Europe/Tallinn', '9999-12-31T24:00', '9999-12-31T22:00'],
    ['America/New_York', '9999-12-31T23:00', null],
    ['Asia/Tokyo', '0001-01-01T01:00', null],
  ])('%s %s is %s UTC', (zone, local, utc) => {
    expect(text(zonedToUtc(L(local), zone, zones))).toBe(utc);
  });

  it('the UTC until 2026-12-31T21:59 is December 31 in Tallinn', () => {
    expect(text(utcToZoned(L('2026-12-31T21:59'), 'Europe/Tallinn', zones))).toBe('2026-12-31T23:59');
  });

  /**
   * Property over every 15 minutes of 2026 in zones with gaps and overlaps:
   * utcToZoned agrees with Intl, and zonedToUtc maps every local time back to
   * the earliest instant showing it (overlaps), or past the gap (gaps).
   */
  it.each(['Europe/Tallinn', 'America/New_York', 'Australia/Lord_Howe', 'America/Sao_Paulo'])(
    '%s: utcToZoned and zonedToUtc agree with the RFC 5545 rule all year',
    (zone) => {
      const year = zone === 'America/Sao_Paulo' ? 2018 : 2026;
      const start = L(`${year}-01-01T00:00`);
      const shown = new Map<string, number>(); // local text -> earliest UTC minute offset showing it
      const localOf: string[] = [];
      for (let m = 0; m < 365 * 1440; m += 15) {
        const utc = addMinutesLocal(start, m);
        const local = text(utcToZoned(utc, zone, zones))!;
        localOf.push(local);
        if (!shown.has(local)) shown.set(local, m);
      }
      for (const [local, m] of shown) {
        expect(text(zonedToUtc(L(local), zone, zones))).toBe(text(addMinutesLocal(start, m)));
      }
      // Local times never shown (in a gap) convert to the instant `gap` later on the wall clock.
      for (let i = 1; i < localOf.length; i++) {
        const before = L(localOf[i - 1]!);
        const after = L(localOf[i]!);
        const jump = diffMinutesLocal(after, before) - 15;
        if (jump > 0) {
          const inGap = addMinutesLocal(before, 15);
          const utc = zonedToUtc(inGap, zone, zones)!;
          expect(diffMinutesLocal(utcToZoned(utc, zone, zones)!, inGap)).toBe(jump);
        }
      }
    },
  );
});
