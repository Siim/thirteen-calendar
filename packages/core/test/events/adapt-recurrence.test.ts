/**
 * adaptRecurrenceToStart: every row of the §2.11 adaptation table
 * (docs/EVENTS.md §2.11, §4.2, §5.2), which moveDraftStart applies.
 */
import { describe, expect, it } from 'vitest';
import {
  type EventRecurrence,
  type RRule,
  type ThirteenRule,
  adaptRecurrenceToStart,
} from '../../src/events/index.ts';
import { g } from '../helpers.ts';

const recurrence = (rule: EventRecurrence['rule'], extra: Partial<EventRecurrence> = {}): EventRecurrence => ({
  rule,
  end: { kind: 'never' },
  extraDates: [],
  exceptDates: [],
  ...extra,
});
const thirteen = (rule: ThirteenRule, extra: Partial<EventRecurrence> = {}) => recurrence({ kind: 'thirteen', rule }, extra);

/** An RRULE with every list empty, as parseRRule (task C2) would produce it. */
function rrule(parts: Partial<RRule> & Pick<RRule, 'freq'>): RRule {
  return {
    interval: 1,
    count: null,
    until: null,
    bySecond: [],
    byMinute: [],
    byHour: [],
    byDay: [],
    byMonthDay: [],
    byYearDay: [],
    byWeekNo: [],
    byMonth: [],
    bySetPos: [],
    wkst: null,
    rscale: null,
    skip: null,
    extensions: [],
    ...parts,
  };
}
const gregorian = (parts: Partial<RRule> & Pick<RRule, 'freq'>) => recurrence({ kind: 'rrule', rrule: rrule(parts) });

/** The rule after moving from `oldStart` to `newStart`, and the change. */
function adapt(from: EventRecurrence, oldStart: string, newStart: string) {
  const { recurrence: result, change } = adaptRecurrenceToStart(from, g(oldStart), g(newStart));
  return { rule: result === null ? null : result.rule, change, result };
}

describe('13-month monthly, weekly and every 2 weeks', () => {
  const monthly12 = thirteen({ kind: 'monthly', system: 'ifc', day: 12 });

  it('follow a new month day', () => {
    // 2026-10-19 = IFC October 12; 2026-10-20 = October 13; 2026-11-16 = November 12.
    expect(adapt(monthly12, '2026-10-19', '2026-10-20')).toMatchObject({
      rule: { kind: 'thirteen', rule: { kind: 'monthly', system: 'ifc', day: 13 } },
      change: 'adapted',
    });
    expect(adapt(monthly12, '2026-10-19', '2026-11-16')).toMatchObject({ rule: monthly12.rule, change: 'none' });
  });

  it('follow a new weekday and keep the interval', () => {
    const weekly = thirteen({ kind: 'weekly', system: 'ifc', weekday: 4, interval: 2 });
    expect(adapt(weekly, '2026-10-19', '2026-10-20')).toMatchObject({
      rule: { kind: 'thirteen', rule: { kind: 'weekly', system: 'ifc', weekday: 5, interval: 2 } },
      change: 'adapted',
    });
    // One week later: same weekday, so the rule is unchanged (the fortnight phase comes from the start).
    expect(adapt(weekly, '2026-10-19', '2026-10-26')).toMatchObject({ rule: weekly.rule, change: 'none' });
  });

  it.each([
    ['2026-12-31', 'Year Day'],
    ['2024-06-17', 'Leap Day'],
  ])('are dropped on an intercalary day (%s, %s)', (newStart) => {
    expect(adapt(monthly12, '2026-10-19', newStart)).toEqual({ rule: null, change: 'dropped', result: null });
    const weekly = thirteen({ kind: 'weekly', system: 'ifc', weekday: 4, interval: 1 });
    expect(adapt(weekly, '2026-10-19', newStart).change).toBe('dropped');
  });

  it('use their own system: IFC Leap Day is Positivist Charlemagne 1', () => {
    // 2024-06-17 is IFC Leap Day but Positivist month 7 day 1 (Positivist's extra days are at the end of the year).
    const positivist = thirteen({ kind: 'monthly', system: 'positivist', day: 12 });
    expect(adapt(positivist, '2024-10-19', '2024-06-17')).toMatchObject({
      rule: { kind: 'thirteen', rule: { kind: 'monthly', system: 'positivist', day: 1 } },
      change: 'adapted',
    });
    expect(adapt(positivist, '2024-10-19', '2024-12-30').change).toBe('dropped'); // All the Dead
  });
});

describe('13-month yearly', () => {
  const october12 = thirteen({ kind: 'yearly', system: 'ifc', month: 11, day: 12 });

  it('moves to the new date', () => {
    expect(adapt(october12, '2026-10-19', '2026-11-16')).toMatchObject({
      rule: { kind: 'thirteen', rule: { kind: 'yearly', system: 'ifc', month: 12, day: 12 } },
      change: 'adapted',
    });
    expect(adapt(october12, '2026-10-19', '2027-10-19')).toMatchObject({ rule: october12.rule, change: 'none' });
  });

  it("is converted to that day's intercalary repeat on an intercalary day", () => {
    expect(adapt(october12, '2026-10-19', '2026-12-31')).toMatchObject({
      rule: { kind: 'thirteen', rule: { kind: 'intercalary', system: 'ifc', id: 'year-day' } },
      change: 'converted',
    });
    expect(adapt(october12, '2026-10-19', '2028-06-17')).toMatchObject({
      rule: { kind: 'thirteen', rule: { kind: 'intercalary', system: 'ifc', id: 'leap-day' } },
      change: 'converted',
    });
    const positivist = thirteen({ kind: 'yearly', system: 'positivist', month: 11, day: 12 });
    expect(adapt(positivist, '2026-10-19', '2026-12-31')).toMatchObject({
      rule: { kind: 'thirteen', rule: { kind: 'intercalary', system: 'positivist', id: 'year-day' } },
      change: 'converted',
    });
  });
});

describe('intercalary', () => {
  const leapDay = thirteen({ kind: 'intercalary', system: 'ifc', id: 'leap-day' });
  const yearDay = thirteen({ kind: 'intercalary', system: 'ifc', id: 'year-day' });
  const holyWomen = thirteen({ kind: 'intercalary', system: 'positivist', id: 'leap-day' });

  it('is unchanged on the same day in another year', () => {
    expect(adapt(leapDay, '2024-06-17', '2028-06-17')).toMatchObject({ rule: leapDay.rule, change: 'none' });
    expect(adapt(yearDay, '2026-12-31', '2027-12-31')).toMatchObject({ rule: yearDay.rule, change: 'none' });
    expect(adapt(holyWomen, '2024-12-31', '2028-12-31')).toMatchObject({ rule: holyWomen.rule, change: 'none' });
  });

  it("is converted to another intercalary day's repeat", () => {
    expect(adapt(yearDay, '2026-12-31', '2028-06-17')).toMatchObject({
      rule: { kind: 'thirteen', rule: { kind: 'intercalary', system: 'ifc', id: 'leap-day' } },
      change: 'converted',
    });
    expect(adapt(holyWomen, '2024-12-31', '2026-12-31')).toMatchObject({
      rule: { kind: 'thirteen', rule: { kind: 'intercalary', system: 'positivist', id: 'year-day' } },
      change: 'converted',
    });
  });

  it('is converted to 13-month yearly on a month day (Every Leap Day onto IFC June 28)', () => {
    // 2025-06-17 is IFC June 28 (2025 has no Leap Day).
    expect(adapt(leapDay, '2024-06-17', '2025-06-17')).toMatchObject({
      rule: { kind: 'thirteen', rule: { kind: 'yearly', system: 'ifc', month: 6, day: 28 } },
      change: 'converted',
    });
  });
});

describe('Gregorian rules', () => {
  it('minimal presets are unchanged (they derive their day from the start)', () => {
    for (const freq of ['daily', 'weekly', 'monthly', 'yearly'] as const) {
      const from = gregorian({ freq });
      expect(adapt(from, '2026-10-19', '2026-10-21')).toEqual({ rule: from.rule, change: 'none', result: from });
    }
    expect(adapt(gregorian({ freq: 'weekly', interval: 2 }), '2026-10-19', '2026-10-21').change).toBe('none');
  });

  it('explicit preset forms that match the old start follow the new one', () => {
    const weekly = gregorian({ freq: 'weekly', byDay: [{ weekday: 1, ordinal: null }] });
    expect(adapt(weekly, '2026-10-19', '2026-10-21')).toMatchObject({
      rule: { kind: 'rrule', rrule: rrule({ freq: 'weekly', byDay: [{ weekday: 3, ordinal: null }] }) },
      change: 'adapted',
    });
    const biweekly = gregorian({ freq: 'weekly', interval: 2, byDay: [{ weekday: 1, ordinal: null }], wkst: 1 });
    expect(adapt(biweekly, '2026-10-19', '2026-10-20')).toMatchObject({
      rule: { kind: 'rrule', rrule: rrule({ freq: 'weekly', interval: 2, byDay: [{ weekday: 2, ordinal: null }], wkst: 1 }) },
      change: 'adapted',
    });
    const monthly = gregorian({ freq: 'monthly', byMonthDay: [19] });
    expect(adapt(monthly, '2026-10-19', '2026-10-31')).toMatchObject({
      rule: { kind: 'rrule', rrule: rrule({ freq: 'monthly', byMonthDay: [31] }) },
      change: 'adapted',
    });
    const yearly = gregorian({ freq: 'yearly', byMonth: [10], byMonthDay: [19] });
    expect(adapt(yearly, '2026-10-19', '2027-02-28')).toMatchObject({
      rule: { kind: 'rrule', rrule: rrule({ freq: 'yearly', byMonth: [2], byMonthDay: [28] }) },
      change: 'adapted',
    });
    expect(adapt(yearly, '2026-10-19', '2027-10-19').change).toBe('none');
  });

  it.each([
    ['explicit days that are not the start', { freq: 'weekly', byDay: [{ weekday: 1, ordinal: null }] }, '2026-10-20', '2026-10-21'],
    ['several weekdays', { freq: 'weekly', byDay: [{ weekday: 1, ordinal: null }, { weekday: 3, ordinal: null }] }, '2026-10-19', '2026-10-21'],
    ['an ordinal weekday', { freq: 'monthly', byDay: [{ weekday: 1, ordinal: 3 }] }, '2026-10-19', '2026-10-21'],
    ['every 2 months', { freq: 'monthly', interval: 2, byMonthDay: [19] }, '2026-10-19', '2026-10-21'],
    ['two month days', { freq: 'monthly', byMonthDay: [19, 20] }, '2026-10-19', '2026-10-21'],
    ['BYSETPOS', { freq: 'monthly', byDay: [{ weekday: 1, ordinal: null }], bySetPos: [-1] }, '2026-10-19', '2026-10-21'],
    ['an X- part', { freq: 'weekly', byDay: [{ weekday: 1, ordinal: null }], extensions: [['X-NAME', '1']] }, '2026-10-19', '2026-10-21'],
    ['RSCALE=HEBREW', { freq: 'yearly', byMonth: [10], byMonthDay: [19], rscale: 'HEBREW' }, '2026-10-19', '2026-10-21'],
  ] as [string, Partial<RRule> & Pick<RRule, 'freq'>, string, string][])('custom rules stay as they are: %s', (_name, parts, oldStart, newStart) => {
    const from = gregorian(parts);
    expect(adapt(from, oldStart, newStart)).toEqual({ rule: from.rule, change: 'none', result: from });
  });

  it('dates and foreign rules stay as they are', () => {
    const dates = recurrence({ kind: 'dates' }, { extraDates: [{ date: g('2026-11-02'), minute: null, durationMinutes: null }] });
    expect(adapt(dates, '2026-10-19', '2026-10-21')).toEqual({ rule: dates.rule, change: 'none', result: dates });
    const foreign = recurrence({
      kind: 'foreign',
      rules: [{ rrule: rrule({ freq: 'weekly' }), end: { kind: 'count', count: 3 } }],
      exrules: [{ rrule: rrule({ freq: 'monthly' }), end: { kind: 'never' } }],
    });
    expect(adapt(foreign, '2026-10-19', '2026-10-21')).toEqual({ rule: foreign.rule, change: 'none', result: foreign });
  });
});

describe('everything else', () => {
  it('keeps the end, extra dates and removed dates, and returns fresh values', () => {
    const from = thirteen(
      { kind: 'monthly', system: 'ifc', day: 12 },
      {
        end: { kind: 'until', date: g('2027-06-30') },
        extraDates: [{ date: g('2026-12-31'), minute: 600, durationMinutes: 30 }],
        exceptDates: [{ date: g('2026-11-16'), minute: null }],
      },
    );
    const { result } = adapt(from, '2026-10-19', '2026-10-20');
    expect(result).toEqual({ ...from, rule: { kind: 'thirteen', rule: { kind: 'monthly', system: 'ifc', day: 13 } } });
    expect(result!.end).not.toBe(from.end);
    expect(result!.exceptDates[0]).not.toBe(from.exceptDates[0]);
    const unchanged = adapt(from, '2026-10-19', '2026-11-16').result!;
    expect(unchanged).toEqual(from);
    expect(unchanged).not.toBe(from);
    expect(unchanged.extraDates).not.toBe(from.extraDates);
  });

  it('rejects malformed input', () => {
    const ok = thirteen({ kind: 'monthly', system: 'ifc', day: 12 });
    expect(() => adaptRecurrenceToStart(ok, { year: 2026, month: 2, day: 30 }, g('2026-10-19'))).toThrow(RangeError);
    expect(() => adaptRecurrenceToStart(thirteen({ kind: 'monthly', system: 'ifc', day: 0 }), g('2026-10-19'), g('2026-10-20'))).toThrow(
      RangeError,
    );
    expect(() =>
      adaptRecurrenceToStart(thirteen({ kind: 'weekly', system: 'ifc', weekday: 4, interval: 3 } as never), g('2026-10-19'), g('2026-10-20')),
    ).toThrow(RangeError);
    expect(() => adaptRecurrenceToStart({ ...ok, end: { kind: 'sometimes' } } as never, g('2026-10-19'), g('2026-10-20'))).toThrow(RangeError);
    expect(() => adaptRecurrenceToStart({ ...ok, exceptDates: ['2026-11-16'] } as never, g('2026-10-19'), g('2026-10-20'))).toThrow(RangeError);
    expect(() => adaptRecurrenceToStart(gregorian({ freq: 'fortnightly' as 'weekly' }), g('2026-10-19'), g('2026-10-20'))).toThrow(RangeError);
    expect(() =>
      adaptRecurrenceToStart(
        { ...ok, extraDates: [{ date: g('2026-11-02'), minute: 1440, durationMinutes: null }] },
        g('2026-10-19'),
        g('2026-10-20'),
      ),
    ).toThrow(RangeError);
  });
});
