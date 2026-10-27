/**
 * The recorded zone offsets of fixtures/events.json (docs/EVENTS.md §5.5):
 * `recordingZoneResolver` writes the `zoneOffsets` table from what the
 * generator asked, and `recordedZoneResolver` (every port's
 * `RecordedZoneResolver`) answers from that table alone. Checked against
 * synthetic zones whose transitions are known exactly.
 */
import { describe, expect, it } from 'vitest';
import {
  type ZoneOffsetsEntry,
  intlZoneResolver,
  recordedZoneResolver,
  recordingZoneResolver,
  syntheticZoneResolver,
} from '../../scripts/zone-resolvers.ts';
import { type ZoneResolver, formatLocalDateTime, parseLocalDateTime, utcToZoned, zonedToUtc } from '../../src/events/index.ts';

const L = parseLocalDateTime;

/** Transitions at odd minutes, one at the very start of 2027, none in 2028. */
const ODD = {
  name: 'Test/Odd',
  offset: 127,
  transitions: [
    { at: '2026-03-29T01:07', offset: 187 },
    { at: '2026-10-25T00:59', offset: 127 },
    { at: '2027-01-01T00:00', offset: -61 },
  ],
};

describe('recordingZoneResolver', () => {
  it('records each zone and UTC year asked about, with exact transitions', () => {
    const recorder = recordingZoneResolver(syntheticZoneResolver(ODD));
    expect(recorder.isKnown('Test/Odd')).toBe(true);
    zonedToUtc(L('2026-07-01T12:00'), 'Test/Odd', recorder);
    utcToZoned(L('2027-06-01T00:00'), 'Test/Odd', recorder);
    utcToZoned(L('2028-06-01T00:00'), 'Test/Odd', recorder);
    expect(recorder.offsets()).toEqual([
      {
        zone: 'Test/Odd',
        year: 2026,
        startOffset: 127,
        transitions: [
          { utc: '2026-03-29T01:07', offset: 187 },
          { utc: '2026-10-25T00:59', offset: 127 },
        ],
      },
      // The change at 2027-01-01T00:00 is the year's start offset, not a transition.
      { zone: 'Test/Odd', year: 2027, startOffset: -61, transitions: [] },
      { zone: 'Test/Odd', year: 2028, startOffset: -61, transitions: [] },
    ]);
  });

  it('orders zones by code points and years numerically, and answers like its base', () => {
    const base = syntheticZoneResolver(ODD, { name: 'A/B', offset: 60, transitions: [] });
    const recorder = recordingZoneResolver(base);
    const answers: number[] = [];
    for (const [zone, at] of [
      ['Test/Odd', '2026-03-29T01:06'],
      ['Test/Odd', '2026-03-29T01:07'],
      ['A/B', '0001-01-01T00:00'],
      ['A/B', '9999-12-31T23:59'],
    ] as const) {
      answers.push(recorder.offsetMinutesAt(zone, L(at)));
    }
    expect(answers).toEqual([127, 187, 60, 60]);
    expect(recorder.offsets().map((e) => `${e.zone} ${e.year}`)).toEqual(['A/B 1', 'A/B 9999', 'Test/Odd 2026']);
  });

  it('refuses a zone that was only checked, and a table that would answer differently', () => {
    const checked = recordingZoneResolver(syntheticZoneResolver(ODD));
    checked.isKnown('Test/Odd');
    expect(() => checked.offsets()).toThrow(/never asked/);
    // Unknown zones need no entry: the recorded resolver does not know them either.
    const unknown = recordingZoneResolver(syntheticZoneResolver(ODD));
    expect(unknown.isKnown('Mars/Olympus')).toBe(false);
    expect(unknown.offsets()).toEqual([]);
    // Two changes within one day are missed by the daily scan; the replay catches it.
    const flicker = { name: 'Test/Flicker', offset: 0, transitions: [{ at: '2026-05-01T10:00', offset: 60 }, { at: '2026-05-01T14:00', offset: 0 }] };
    const recorder = recordingZoneResolver(syntheticZoneResolver(flicker));
    expect(recorder.offsetMinutesAt('Test/Flicker', L('2026-05-01T12:00'))).toBe(60);
    expect(() => recorder.offsets()).toThrow(/zoneOffsets answers 0 for Test\/Flicker/);
  });

  it('records Intl at the range edges', () => {
    const recorder = recordingZoneResolver(intlZoneResolver());
    expect(zonedToUtc(L('9999-12-31T23:00'), 'America/New_York', recorder)).toBeNull();
    expect(zonedToUtc(L('0001-01-01T01:00'), 'Asia/Tokyo', recorder)).toBeNull();
    const entries = recorder.offsets();
    expect(entries.map((e) => `${e.zone} ${e.year} ${e.startOffset} ${e.transitions.length}`)).toEqual([
      'America/New_York 9999 -300 2',
      'Asia/Tokyo 1 558 0',
    ]);
    const replayed = recordedZoneResolver(entries);
    expect(zonedToUtc(L('9999-12-31T23:00'), 'America/New_York', replayed)).toBeNull();
    expect(formatLocalDateTime(zonedToUtc(L('9999-07-01T12:00'), 'America/New_York', replayed)!)).toBe('9999-07-01T16:00');
  });
});

describe('recordedZoneResolver', () => {
  const entries: ZoneOffsetsEntry[] = [
    { zone: 'Test/Odd', year: 2026, startOffset: 127, transitions: [{ utc: '2026-03-29T01:07', offset: 187 }] },
    { zone: 'Test/Odd', year: 2027, startOffset: -61, transitions: [] },
  ];
  const zones: ZoneResolver = recordedZoneResolver(entries);

  it('answers from the table: start offset, then each transition from its minute on', () => {
    expect(zones.isKnown('Test/Odd')).toBe(true);
    expect(zones.isKnown('Test/Other')).toBe(false);
    expect(zones.offsetMinutesAt('Test/Odd', L('2026-01-01T00:00'))).toBe(127);
    expect(zones.offsetMinutesAt('Test/Odd', L('2026-03-29T01:06'))).toBe(127);
    expect(zones.offsetMinutesAt('Test/Odd', L('2026-03-29T01:07'))).toBe(187);
    expect(zones.offsetMinutesAt('Test/Odd', L('2026-12-31T23:59'))).toBe(187);
    expect(zones.offsetMinutesAt('Test/Odd', L('2027-01-01T00:00'))).toBe(-61);
  });

  it('throws for a year or zone it does not hold', () => {
    expect(() => zones.offsetMinutesAt('Test/Odd', L('2025-12-31T23:59'))).toThrow(/no offsets for Test\/Odd in 2025/);
    expect(() => zones.offsetMinutesAt('Test/Other', L('2026-01-01T00:00'))).toThrow(RangeError);
  });

  it('rejects malformed tables', () => {
    expect(() => recordedZoneResolver([...entries, entries[0]!])).toThrow(/twice/);
    expect(() =>
      recordedZoneResolver([{ zone: 'X', year: 2026, startOffset: 0, transitions: [{ utc: '2027-01-01T00:00', offset: 60 }] }]),
    ).toThrow(/inside the year/);
    expect(() =>
      recordedZoneResolver([
        {
          zone: 'X',
          year: 2026,
          startOffset: 0,
          transitions: [
            { utc: '2026-05-01T00:00', offset: 60 },
            { utc: '2026-04-01T00:00', offset: 0 },
          ],
        },
      ]),
    ).toThrow(/ascending/);
  });
});
