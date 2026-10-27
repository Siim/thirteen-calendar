/**
 * Descriptor of the Gregorian calendar itself — the "12" side of the
 * 12 vs 13 Compare view (name, history, months). Pure data, like the systems.
 * @module
 */

import { type GregorianMonthInfo, GREGORIAN_MONTHS } from '../gregorian.ts';
import { deepFreeze } from '../internal.ts';
import type { CalendarDescriptor } from './types.ts';

/** The Gregorian calendar as a {@link CalendarDescriptor}, plus its 12 months. */
export interface GregorianCalendarInfo extends CalendarDescriptor {
  /** The 12 months in order (`months[0].index === 1`); same objects as `GREGORIAN_MONTHS`. */
  readonly months: readonly GregorianMonthInfo[];
}

/** The Gregorian calendar (proleptic for years before 1582 in this engine). */
export const GREGORIAN_CALENDAR: GregorianCalendarInfo = deepFreeze({
  name: 'Gregorian calendar',
  shortName: 'Gregorian',
  inventor: 'Pope Gregory XIII',
  proposedYear: 1582,
  summary:
    'The reform of the Julian calendar promulgated by Pope Gregory XIII in 1582: twelve months of 28 to 31 days and a leap day every fourth year, except in centuries not divisible by 400. It is today’s international civil calendar.',
  history: [
    {
      year: 1582,
      text: 'Pope Gregory XIII’s bull Inter gravissimas reforms the Julian calendar; Thursday 4 October is followed by Friday 15 October.',
    },
    { year: 1752, text: 'Great Britain and its colonies adopt the Gregorian calendar, skipping 3 to 13 September.' },
    { year: 1923, text: 'Greece becomes the last European country to adopt it for civil use.' },
  ],
  months: GREGORIAN_MONTHS,
});
