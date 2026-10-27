import { type EventRecurrence, parseISODate, parseRRule } from '@thirteen/core';
import { describe, expect, it } from 'vitest';
import { alertOptions, alertValue, sameAlarm } from './alerts.ts';
import {
  copyVariants,
  customExpressible,
  customFrom,
  customRRule,
  customRecurrence,
  customUnit,
  isRepeatEditable,
  repeatDescription,
  repeatRows,
  selectedRepeatRow,
} from './repeat.ts';

const start = parseISODate('2026-10-19');
const rrule = (text: string, end: EventRecurrence['end'] = { kind: 'never' }): EventRecurrence => ({
  rule: { kind: 'rrule', rrule: parseRRule(text) },
  end,
  extraDates: [],
  exceptDates: [],
});

describe('the repeat picker rows (§2.13)', () => {
  it('lists Never, the Gregorian and 13-month presets, then Custom', () => {
    const rows = repeatRows(start, 'ifc', null, { editable: true });
    expect(rows.map((row) => [row.section, row.label])).toEqual([
      ['never', 'Never'],
      ['gregorian', 'Every day'],
      ['gregorian', 'Every week on Monday'],
      ['gregorian', 'Every 2 weeks on Monday'],
      ['gregorian', 'Every month on the 19th'],
      ['gregorian', 'Every year on October 19'],
      ['thirteen', 'Every IFC month on the 12th'],
      ['thirteen', 'Every IFC week on Thursday'],
      ['thirteen', 'Every 2 IFC weeks on Thursday'],
      ['thirteen', 'Every year on IFC October 12'],
      ['custom', 'Custom'],
    ]);
  });

  it('offers the intercalary repeat on Leap Day', () => {
    const rows = repeatRows(parseISODate('2028-06-17'), 'ifc', null, { editable: true });
    expect(rows.filter((row) => row.section === 'thirteen').map((row) => row.label)).toEqual(['Every Leap Day']);
  });

  it('keeps the End repeat on every preset', () => {
    const end = { kind: 'count', count: 5 } as const;
    const rows = repeatRows(start, 'ifc', rrule('FREQ=WEEKLY', end), { editable: true });
    for (const row of rows) if (row.recurrence !== null && row.id !== 'custom') expect(row.recurrence.end).toEqual(end);
  });

  it('disables the 13-month rows a Gregorian-only calendar cannot keep', () => {
    const rows = repeatRows(start, 'ifc', null, { editable: true, gregorianOnly: true });
    expect(rows.filter((row) => row.disabled).map((row) => row.id)).toEqual(['thirteen-monthly', 'thirteen-weekly', 'thirteen-biweekly']);
  });

  it('shows Keep first for a repeat set in another app (editable: false)', () => {
    const foreign = rrule('FREQ=DAILY;BYHOUR=9,17');
    expect(isRepeatEditable(foreign)).toBe(false);
    const rows = repeatRows(start, 'ifc', foreign, { editable: false });
    expect(rows[0]!.id).toBe('keep');
    expect(rows[0]!.label.startsWith('Keep: ')).toBe(true);
    expect(selectedRepeatRow(foreign, start, 'ifc', false)).toBe('keep');
  });

  it('checks the matching preset, else Custom, else Never', () => {
    expect(selectedRepeatRow(null, start, 'ifc', true)).toBe('never');
    expect(selectedRepeatRow(rrule('FREQ=WEEKLY'), start, 'ifc', true)).toBe('weekly');
    expect(selectedRepeatRow(rrule('FREQ=WEEKLY;BYDAY=MO,WE'), start, 'ifc', true)).toBe('custom');
  });

  it('knows which stored repeats Thirteen can edit', () => {
    expect(isRepeatEditable(null)).toBe(true);
    expect(isRepeatEditable(rrule('FREQ=MONTHLY;BYDAY=2TU'))).toBe(true);
    expect(isRepeatEditable({ ...rrule('FREQ=WEEKLY'), extraDates: [{ date: start, minute: null, durationMinutes: null }] })).toBe(false);
    expect(isRepeatEditable({ rule: { kind: 'dates' }, end: { kind: 'never' }, extraDates: [], exceptDates: [] })).toBe(false);
    expect(customExpressible(parseRRule('FREQ=WEEKLY;INTERVAL=100'))).toBe(false);
    expect(customExpressible(parseRRule('FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU'))).toBe(true);
  });

  it('describes a repeat core has no words for as Custom', () => {
    expect(repeatDescription(null, start, 'ifc')).toBe('Never');
    expect(repeatDescription(rrule('FREQ=WEEKLY'), start, 'ifc')).toBe('Every week on Monday');
  });
});

describe('the Custom form (Gregorian only)', () => {
  it('starts from the event’s day', () => {
    expect(customFrom(null, start)).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [1],
      monthlyMode: 'each',
      monthDays: [19],
      months: [10],
      yearlyOnThe: false,
      onThe: { ordinal: 3, kind: 1 },
    });
  });

  it('writes the rule it shows, and reads it back', () => {
    const base = customFrom(null, start);
    const cases = [
      [{ ...base, frequency: 'weekly', interval: 2, weekdays: [3, 1] }, 'Every 2 weeks on Monday and Wednesday, 5 times'],
      [{ ...base, frequency: 'monthly', monthlyMode: 'onThe', onThe: { ordinal: 2, kind: 'weekday' } }, 'Every month on the second weekday, 5 times'],
    ] as const;
    for (const [form, description] of cases) {
      const recurrence = customRecurrence(form, start, { kind: 'count', count: 5 });
      expect(repeatDescription(recurrence, start, 'ifc')).toBe(description);
      const back = customFrom(recurrence, start);
      expect(customRRule(back, start)).toEqual(customRRule(form, start));
    }
    expect(customRRule({ ...base, frequency: 'monthly', monthlyMode: 'onThe', onThe: { ordinal: -1, kind: 5 } }, start)).toEqual(parseRRule('FREQ=MONTHLY;BYDAY=-1FR'));
    expect(customRRule({ ...base, frequency: 'yearly', months: [], yearlyOnThe: false }, start)).toEqual(parseRRule('FREQ=YEARLY;BYMONTH=10'));
    expect(customRRule({ ...base, frequency: 'daily', interval: 250 }, start)).toEqual(parseRRule('FREQ=DAILY;INTERVAL=99'));
  });

  it('reads its words from the catalogue', () => {
    expect(customUnit('weekly', 1)).toBe('1 week');
    expect(customUnit('weekly', 3)).toBe('3 weeks');
    expect(copyVariants('repeat.custom.ordinals')).toEqual(['first', 'second', 'third', 'fourth', 'fifth', 'last']);
    expect(copyVariants('repeat.custom.dayKinds')).toEqual(['day', 'weekday', 'weekend day']);
  });
});

describe('alert pickers (§2.14)', () => {
  it('lists the presets, and keeps an alert another app set as a row of its own', () => {
    const rows = alertOptions(false, { kind: 'relative', offsetMinutes: -45 }, { use24Hour: true, systemId: 'ifc' });
    expect(rows[0]).toEqual({ value: 'none', label: 'None', alarm: null });
    expect(rows.at(-1)).toEqual({ value: 'current', label: '45 minutes before', alarm: { kind: 'relative', offsetMinutes: -45 } });
    expect(alertValue(rows, { kind: 'relative', offsetMinutes: -45 })).toBe('current');
    expect(alertValue(rows, { kind: 'relative', offsetMinutes: -10 })).toBe('before-10m');
    expect(alertValue(rows, null)).toBe('none');
  });

  it('uses the all-day presets for all-day events', () => {
    const rows = alertOptions(true, null, { use24Hour: true, systemId: 'ifc' });
    expect(rows.map((row) => row.label)).toEqual(['None', 'On the day at 09:00', '1 day before at 09:00', '2 days before at 09:00', '1 week before at 09:00']);
    expect(sameAlarm(null, null)).toBe(true);
    expect(sameAlarm(rows[1]!.alarm, { kind: 'relative', offsetMinutes: 540 })).toBe(true);
  });
});
