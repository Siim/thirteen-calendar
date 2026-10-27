/**
 * Positivist calendar (SPEC §1.2) — id `'positivist'`.
 * @module
 */

import { deepFreeze } from '../internal.ts';
import type { CalendarSystem } from './types.ts';

/** Auguste Comte's Positivist calendar. */
export const POSITIVIST: CalendarSystem = deepFreeze({
  id: 'positivist',
  name: 'Positivist Calendar',
  shortName: 'Positivist',
  inventor: 'Auguste Comte',
  proposedYear: 1849,
  summary:
    'Auguste Comte’s 1849 calendar of thirteen 28-day months, each named after a figure he considered a great contributor to humanity and each starting on a Monday. Years are counted from the French Revolution: 1789 is year 1.',
  history: [
    { year: 1789, text: 'The French Revolution begins; Comte later makes 1789 year 1 of the Positivist era.' },
    {
      year: 1849,
      text: 'Auguste Comte proposes the Positivist calendar: 13 months named after great contributors to humanity, plus festival days.',
    },
  ],
  weekStartsOn: 1,
  yearOffset: -1788,
  months: [
    { index: 1, name: 'Moses', shortName: 'Mos', gregorianNameEquivalent: null, meaning: 'Initial religiosity' },
    { index: 2, name: 'Homer', shortName: 'Hom', gregorianNameEquivalent: null, meaning: 'Ancient poets' },
    { index: 3, name: 'Aristotle', shortName: 'Ari', gregorianNameEquivalent: null, meaning: 'Ancient philosophers' },
    { index: 4, name: 'Archimedes', shortName: 'Arc', gregorianNameEquivalent: null, meaning: 'Ancient science' },
    { index: 5, name: 'Caesar', shortName: 'Cae', gregorianNameEquivalent: null, meaning: 'Military civilisation' },
    { index: 6, name: 'Saint Paul', shortName: 'Pau', gregorianNameEquivalent: null, meaning: 'Catholicism' },
    { index: 7, name: 'Charlemagne', shortName: 'Cha', gregorianNameEquivalent: null, meaning: 'Feudal civilisation' },
    { index: 8, name: 'Dante', shortName: 'Dan', gregorianNameEquivalent: null, meaning: 'Modern epics' },
    { index: 9, name: 'Gutenberg', shortName: 'Gut', gregorianNameEquivalent: null, meaning: 'Modern industry' },
    { index: 10, name: 'Shakespeare', shortName: 'Sha', gregorianNameEquivalent: null, meaning: 'Modern drama' },
    { index: 11, name: 'Descartes', shortName: 'Des', gregorianNameEquivalent: null, meaning: 'Modern philosophy' },
    { index: 12, name: 'Frederick', shortName: 'Fre', gregorianNameEquivalent: null, meaning: 'Modern politics' },
    { index: 13, name: 'Bichat', shortName: 'Bic', gregorianNameEquivalent: null, meaning: 'Modern science' },
  ],
  intercalaryDays: [
    {
      id: 'year-day',
      code: 'YD',
      name: 'Festival of All the Dead',
      shortName: 'All the Dead',
      description:
        'The complementary day after Bichat 28 (Gregorian 31 December, or 30 December in leap years). It belongs to no month and has no weekday.',
      leapOnly: false,
      afterMonth: 13,
      dayOfYear: { common: 365, leap: 365 },
    },
    {
      id: 'leap-day',
      code: 'LD',
      name: 'Festival of Holy Women',
      shortName: 'Holy Women',
      description:
        'Follows the Festival of All the Dead in leap years (always Gregorian 31 December). It belongs to no month and has no weekday.',
      leapOnly: true,
      afterMonth: 13,
      dayOfYear: { common: null, leap: 366 },
    },
  ],
});
