/**
 * `toJSDate` / `fromJSDate` under specific IANA time zones (oracle:F1, edges:F3).
 * Node re-reads `process.env.TZ` on assignment, so each case pins the zone for
 * its own duration and restores the host zone afterwards.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fromJSDate, toJSDate } from '../src/index.ts';
import { everyDay, g } from './helpers.ts';

const HOST_TZ = process.env.TZ;

function inZone<T>(zone: string, fn: () => T): T {
  process.env.TZ = zone;
  return fn();
}

afterEach(() => {
  if (HOST_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = HOST_TZ;
});

describe('toJSDate in time zones that skipped a whole calendar day', () => {
  const skipped = [
    ['Pacific/Apia', '2011-12-30', '2011-12-29', '2011-12-31'],
    ['Pacific/Kiritimati', '1994-12-31', '1994-12-30', '1995-01-01'],
    ['Pacific/Kwajalein', '1993-08-21', '1993-08-20', '1993-08-22'],
  ] as const;

  it.each(skipped)('%s: %s does not exist locally and throws RangeError', (zone, missing, before, after) => {
    inZone(zone, () => {
      // Guard: the zone really is active (the day before and after exist and are 2 days apart).
      expect(toJSDate(g(after)).getTime() - toJSDate(g(before)).getTime()).toBe(86_400_000);
      expect(() => toJSDate(g(missing))).toThrow(RangeError);
      expect(() => toJSDate(g(missing))).toThrow(`${missing} does not exist in the local time zone`);
      expect(fromJSDate(toJSDate(g(before)))).toEqual(g(before));
      expect(fromJSDate(toJSDate(g(after)))).toEqual(g(after));
    });
  });

  it('round-trips every other day of the transition year in each zone', () => {
    for (const [zone, missing] of skipped) {
      inZone(zone, () => {
        for (const date of everyDay(Number(missing.slice(0, 4)))) {
          const iso = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
          if (iso === missing) continue;
          expect(fromJSDate(toJSDate(date))).toEqual(date);
          expect(toJSDate(date).getDay()).toBe(new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay());
        }
      });
    }
  });
});

describe('toJSDate when only local midnight is skipped (DST at 00:00)', () => {
  it.each([
    ['America/Sao_Paulo', '2018-11-04'],
    ['America/Havana', '2024-03-10'],
  ] as const)('%s %s: returns the first existing instant (01:00) of the same day', (zone, iso) => {
    inZone(zone, () => {
      const d = toJSDate(g(iso));
      expect(fromJSDate(d)).toEqual(g(iso));
      expect([d.getHours(), d.getMinutes()]).toEqual([1, 0]);
    });
  });

  it('UTC: midnight, every day of a leap year round-trips', () => {
    inZone('UTC', () => {
      for (const date of everyDay(2024)) {
        const d = toJSDate(date);
        expect(d.getHours()).toBe(0);
        expect(fromJSDate(d)).toEqual(date);
      }
    });
  });
});
