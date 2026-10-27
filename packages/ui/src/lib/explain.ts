/**
 * Plain-language explanations of the `compare()` metrics (SPEC §3), shared by
 * the comparison components and the app pages.
 */
import {
  type Comparison,
  type ThirteenDate,
  daysInGregorianMonth,
  formatGregorian,
  formatThirteen,
  getCalendarSystem,
  gregorianMonthName,
  sameLabelInGregorian,
  weekdayName,
} from '@thirteen/core';
import { pluralDays } from './dates.ts';

/** A short headline plus one or two sentences of detail. */
export interface Explanation {
  readonly headline: string;
  readonly detail: string;
}

function intercalaryName(date: ThirteenDate): string {
  if (date.kind !== 'intercalary') return '';
  return getCalendarSystem(date.system).intercalaryDays.find((d) => d.id === date.id)!.name;
}

/** "The fixed weekday runs 3 days ahead of the real one": `weekdayShift` in words. */
export function explainWeekdayShift(c: Comparison): Explanation {
  const real = weekdayName(c.gregorianWeekday);
  const system = getCalendarSystem(c.thirteen.system);
  if (c.thirteenWeekday === null || c.weekdayShift === null) {
    return {
      headline: 'No fixed weekday',
      detail: `${intercalaryName(c.thirteen)} sits outside the week, so the ${system.shortName} gives it no weekday. The real calendar calls it ${real}.`,
    };
  }
  const fixed = weekdayName(c.thirteenWeekday);
  if (c.weekdayShift === 0) {
    return {
      headline: `${fixed} in both`,
      detail: `The fixed ${system.shortName} weekday and the real weekday agree: both say ${fixed}.`,
    };
  }
  const n = c.weekdayShift;
  return {
    headline: `${fixed}, really ${real}`,
    detail: `The ${system.shortName} calls this day ${fixed}; the real week says ${real}. The fixed week runs ${pluralDays(n)} ahead of the real one (${pluralDays(7 - n)} behind). Every intercalary day pauses the fixed week while the real one keeps going, so the gap moves by a day after each one.`,
  };
}

/** Why `labelDrift` is null for a 13-month date, in words. */
export function explainMissingLabel(date: ThirteenDate): string {
  const system = getCalendarSystem(date.system);
  if (date.kind === 'intercalary') {
    return `${intercalaryName(date)} has no month and no day number, so there is no Gregorian label to match.`;
  }
  const info = system.months[date.month - 1]!;
  if (info.gregorianNameEquivalent === null) {
    return system.id === 'positivist'
      ? `Positivist months are named after people (this one after ${info.name}), not after Gregorian months, so no Gregorian date carries the same label.`
      : `${info.name} has no Gregorian namesake, so no Gregorian date carries the label “${info.name} ${date.day}”.`;
  }
  const length = daysInGregorianMonth(date.year, info.gregorianNameEquivalent);
  const name = gregorianMonthName(info.gregorianNameEquivalent);
  return `Gregorian ${name} has only ${length} days, so there is no Gregorian ${name} ${date.day}.`;
}

/** "The 13-month label runs 7 days behind the Gregorian one": `labelDrift` in words. */
export function explainLabelDrift(c: Comparison): Explanation {
  const drift = c.labelDrift;
  if (drift === null) return { headline: 'No shared label', detail: explainMissingLabel(c.thirteen) };
  const thirteenText = formatThirteen(c.thirteen, { style: 'short' });
  const gregorianText = formatGregorian(c.gregorian, { style: 'short' });
  const same = sameLabelInGregorian(c.thirteen);
  const sameText = same ? formatGregorian(same, { style: 'short' }) : thirteenText;
  if (drift === 0) {
    return {
      headline: 'Labels agree',
      detail: `${thirteenText} is ${gregorianText} in both calendars: same month name, same day number.`,
    };
  }
  if (drift > 0) {
    return {
      headline: `${pluralDays(drift)} behind`,
      detail: `The 13-month label runs ${pluralDays(drift)} behind the Gregorian one: ${thirteenText} falls on Gregorian ${gregorianText}, while Gregorian ${sameText} came ${pluralDays(drift)} earlier.`,
    };
  }
  return {
    headline: `${pluralDays(-drift)} ahead`,
    detail: `The 13-month label runs ${pluralDays(-drift)} ahead of the Gregorian one: ${thirteenText} falls on Gregorian ${gregorianText}, and Gregorian ${sameText} is still ${pluralDays(-drift)} away.`,
  };
}

/** One sentence for a Year Day countdown. */
export function explainYearDayCountdown(days: number, systemId: Comparison['thirteen']['system']): string {
  const name = getCalendarSystem(systemId).intercalaryDays.find((d) => d.id === 'year-day')!.name;
  if (days === 0) return `Today is ${name}: a day outside the week and outside every month.`;
  // Not "closes the year": in a Positivist leap year Holy Women follows All the Dead.
  return `${pluralDays(days)} until ${name}, the day outside the week at the end of the year.`;
}
