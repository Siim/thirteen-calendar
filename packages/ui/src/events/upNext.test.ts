import { type EventOccurrence, type LocalDateTime, parseLocalDateTime } from '@thirteen/core';
import { describe, expect, it } from 'vitest';
import { createMockupEventStore } from './mockup.ts';
import { upNext } from './upNext.ts';

const at = (text: string): LocalDateTime => parseLocalDateTime(text);

function occurrence(key: string, start: string, end: string, allDay = false): EventOccurrence {
  return { key, calendarId: 'c', title: key, allDay, start: at(start), end: at(end) };
}

const keysOf = (result: ReturnType<typeof upNext>) => result.groups.map((group) => [group.kind, group.items.map((item) => item.key)]);

describe('upNext (docs/EVENTS.md §2.8, board B1)', () => {
  it('draws board B1 from the mockup data set: 5 rows today, Yoga tomorrow, 5 more in the next 7 days', async () => {
    const store = createMockupEventStore();
    await store.loadYear(2026);
    const snapshot = store.occurrencesInYear(2026);
    if (snapshot.status !== 'ready') throw new Error('not loaded');
    const titles = new Map(snapshot.occurrences.map((o) => [o.key, o.title]));
    const result = upNext(snapshot.occurrences, at('2026-10-19T09:41'), 'ifc');
    expect(result.groups.map((group) => [group.kind, group.items.map((item) => titles.get(item.key))])).toEqual([
      ['today', ['Autumn school break', 'Sprint planning', '1:1 with Marta', 'Dentist, Dr. Tamm', 'Book club: Cotsworth']],
      ['tomorrow', ['Yoga']],
    ]);
    expect(result.more).toBe(5);
    expect(result.todayLeft).toBe(true);
    expect(result.empty).toBe(false);
    expect(result.to).toEqual({ year: 2026, month: 10, day: 25 });
    // Autumn school break starts today: "Day 1 of 7".
    const breakItem = result.groups[0]!.items[0]!;
    expect([breakItem.dayIndex, breakItem.dayCount]).toEqual([1, 7]);
  });

  it('leaves out what ended earlier today and keeps what is running now', () => {
    const result = upNext(
      [
        occurrence('ended', '2026-10-19T08:00', '2026-10-19T09:00'),
        occurrence('running', '2026-10-19T09:30', '2026-10-19T10:30'),
        occurrence('later', '2026-10-19T15:00', '2026-10-19T16:00'),
        occurrence('zero-now', '2026-10-19T09:41', '2026-10-19T09:41'),
      ],
      at('2026-10-19T09:41'),
      'ifc',
    );
    expect(keysOf(result)).toEqual([['today', ['running', 'zero-now', 'later']]]);
  });

  it('lists a multi-day event once, on today, with its day number', () => {
    const result = upNext(
      [occurrence('trip', '2026-10-18T00:00', '2026-10-20T24:00', true), occurrence('next', '2026-10-21T10:00', '2026-10-21T11:00')],
      at('2026-10-19T12:00'),
      'ifc',
    );
    expect(keysOf(result)).toEqual([
      ['today', ['trip']],
      ['later', ['next']],
    ]);
    const trip = result.groups[0]!.items[0]!;
    expect([trip.dayIndex, trip.dayCount]).toEqual([2, 3]);
    expect(result.groups[1]!.thirteen).toEqual({ kind: 'month', system: 'ifc', year: 2026, month: 11, day: 14 });
  });

  it('says when today has nothing left, and when the whole week is empty', () => {
    const tomorrowOnly = upNext([occurrence('tomorrow', '2026-10-20T07:15', '2026-10-20T08:15')], at('2026-10-19T21:00'), 'ifc');
    expect(tomorrowOnly.todayLeft).toBe(false);
    expect(tomorrowOnly.empty).toBe(false);
    expect(keysOf(tomorrowOnly)).toEqual([['tomorrow', ['tomorrow']]]);

    const outside = upNext([occurrence('day 8', '2026-10-26T10:00', '2026-10-26T11:00')], at('2026-10-19T09:00'), 'ifc');
    expect(outside.empty).toBe(true);
    expect(outside.groups).toEqual([]);
    expect(outside.more).toBe(0);
  });

  it('caps the rows at 6 and counts every other event once', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      occurrence(`e${i}`, `2026-10-2${i < 5 ? 0 : 1}T${String(8 + i).padStart(2, '0')}:00`, `2026-10-2${i < 5 ? 0 : 1}T${String(8 + i).padStart(2, '0')}:30`),
    );
    const spanning = occurrence('span', '2026-10-20T00:00', '2026-10-23T24:00', true);
    const result = upNext([...many, spanning], at('2026-10-19T09:00'), 'ifc');
    expect(result.groups.flatMap((group) => group.items).length).toBe(6);
    // 10 events in range (the spanning one counted once), 6 shown.
    expect(result.more).toBe(4);
    expect(result.todayLeft).toBe(false);
  });
});
