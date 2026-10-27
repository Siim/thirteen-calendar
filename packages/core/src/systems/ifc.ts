/**
 * International Fixed Calendar (SPEC §1.1) — id `'ifc'`, the default system.
 * @module
 */

import { deepFreeze } from '../internal.ts';
import type { CalendarSystem } from './types.ts';

/** Moses B. Cotsworth's International Fixed Calendar. */
export const IFC: CalendarSystem = deepFreeze({
  id: 'ifc',
  name: 'International Fixed Calendar',
  shortName: 'IFC',
  inventor: 'Moses B. Cotsworth',
  proposedYear: 1902,
  summary:
    'Moses B. Cotsworth’s perennial calendar, first presented in 1902: thirteen 28-day months that all start on a Sunday, with Sol inserted between June and July. Promoted by the International Fixed Calendar League (founded 1923) with George Eastman’s backing and considered by the League of Nations’ calendar-reform inquiries of the 1920s and 1930s, it was used internally at Eastman Kodak from 1928 to 1989.',
  history: [
    { year: 1902, text: 'Moses B. Cotsworth first presents his 13-month International Fixed Calendar.' },
    {
      year: 1923,
      text: 'The International Fixed Calendar League is founded with George Eastman’s backing, after a League of Nations calendar-reform inquiry rates the plan the best of some 130 proposals.',
    },
    { year: 1928, text: 'Eastman Kodak adopts the calendar for its internal business use.' },
    { year: 1937, text: 'The plan fails to win final approval from the League of Nations, and the IFC League winds down.' },
    { year: 1989, text: 'Eastman Kodak stops using the calendar, after 61 years.' },
  ],
  weekStartsOn: 0,
  yearOffset: 0,
  months: [
    { index: 1, name: 'January', shortName: 'Jan', gregorianNameEquivalent: 1 },
    { index: 2, name: 'February', shortName: 'Feb', gregorianNameEquivalent: 2 },
    { index: 3, name: 'March', shortName: 'Mar', gregorianNameEquivalent: 3 },
    { index: 4, name: 'April', shortName: 'Apr', gregorianNameEquivalent: 4 },
    { index: 5, name: 'May', shortName: 'May', gregorianNameEquivalent: 5 },
    { index: 6, name: 'June', shortName: 'Jun', gregorianNameEquivalent: 6 },
    {
      index: 7,
      name: 'Sol',
      shortName: 'Sol',
      gregorianNameEquivalent: null,
      meaning: 'Latin for “sun”: the inserted month sits mid-year, near the northern summer solstice.',
    },
    { index: 8, name: 'July', shortName: 'Jul', gregorianNameEquivalent: 7 },
    { index: 9, name: 'August', shortName: 'Aug', gregorianNameEquivalent: 8 },
    { index: 10, name: 'September', shortName: 'Sep', gregorianNameEquivalent: 9 },
    { index: 11, name: 'October', shortName: 'Oct', gregorianNameEquivalent: 10 },
    { index: 12, name: 'November', shortName: 'Nov', gregorianNameEquivalent: 11 },
    { index: 13, name: 'December', shortName: 'Dec', gregorianNameEquivalent: 12 },
  ],
  intercalaryDays: [
    {
      id: 'leap-day',
      code: 'LD',
      name: 'Leap Day',
      shortName: 'Leap Day',
      description:
        'Follows June 28 in leap years (always Gregorian 17 June). It belongs to no month and has no weekday.',
      leapOnly: true,
      afterMonth: 6,
      dayOfYear: { common: null, leap: 169 },
    },
    {
      id: 'year-day',
      code: 'YD',
      name: 'Year Day',
      shortName: 'Year Day',
      description: 'Follows December 28 (always Gregorian 31 December). It belongs to no month and has no weekday.',
      leapOnly: false,
      afterMonth: 13,
      dayOfYear: { common: 365, leap: 366 },
    },
  ],
});
