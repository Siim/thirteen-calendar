/**
 * events/thirteen-rules.ts (docs/EVENTS.md §4.2 to §4.5, §5.2): 13-month rules,
 * their dates, their RRULE encodings (forms a to c), the Android date lists and
 * parts (form d), and the marker text, rule URI and detached URI.
 *
 * Oracles: the engine's own 13-month conversion day by day (`toThirteen`), the
 * §4.2 and §4.3 formulas written out literally, and `ical.js` 2.2, which expands
 * every encoding of every rule for 2024 to 2104 (the C3 done criterion).
 */
import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import type { RepeatEnd } from '../../src/events/recurrence.ts';
import {
  type ThirteenEncodingForm,
  type ThirteenRule,
  type ThirteenRuleKind,
  encodeThirteenRule,
  formatDetachedUri,
  formatThirteenRuleText,
  formatThirteenRuleUri,
  parseDetachedUri,
  parseThirteenRuleText,
  parseThirteenRuleUri,
  thirteenEncodingForm,
  thirteenRuleDatesInYear,
  thirteenRuleFor,
  thirteenRuleIncludes,
  thirteenRuleRdateParts,
  thirteenRuleRdates,
} from '../../src/events/thirteen-rules.ts';
import { formatRRule } from '../../src/events/rrule.ts';
import {
  type CalendarSystemId,
  type GregorianDate,
  type ThirteenDate,
  type Weekday,
  addGregorianDays,
  compareGregorian,
  createIntercalaryDate,
  createMonthDate,
  fromThirteen,
  isLeapYear,
  thirteenWeekday,
  toISODate,
  toThirteen,
} from '../../src/index.ts';
import { SYSTEMS, everyDay, g } from '../helpers.ts';

type Rule<K extends ThirteenRule['kind']> = Extract<ThirteenRule, { kind: K }>;

const iso = (dates: readonly GregorianDate[]) => dates.map(toISODate);
const monthly = (day: number, system: CalendarSystemId = 'ifc'): ThirteenRule => ({ kind: 'monthly', system, day });
const weekly = (weekday: Weekday, interval: 1 | 2 = 1, system: CalendarSystemId = 'ifc'): ThirteenRule => ({
  kind: 'weekly',
  system,
  weekday,
  interval,
});
const yearly = (month: number, day: number, system: CalendarSystemId = 'ifc'): ThirteenRule => ({ kind: 'yearly', system, month, day });
const intercalary = (id: 'year-day' | 'leap-day', system: CalendarSystemId = 'ifc'): ThirteenRule => ({ kind: 'intercalary', system, id });
const never: RepeatEnd = { kind: 'never' };
const count = (n: number): RepeatEnd => ({ kind: 'count', count: n });
const until = (date: string): RepeatEnd => ({ kind: 'until', date: g(date) });
const NO_LIMIT = { maxValues: 2_147_483_647 };

/** Every distinct rule: 56 monthly, 28 weekly, 728 yearly and 4 intercalary rules. */
function allRules(): ThirteenRule[] {
  const rules: ThirteenRule[] = [];
  for (const system of SYSTEMS) {
    for (let day = 1; day <= 28; day++) rules.push(monthly(day, system));
    for (const interval of [1, 2] as const) for (let w = 0; w < 7; w++) rules.push(weekly(w as Weekday, interval, system));
    for (let month = 1; month <= 13; month++) for (let day = 1; day <= 28; day++) rules.push(yearly(month, day, system));
    rules.push(intercalary('year-day', system), intercalary('leap-day', system));
  }
  return rules;
}

/** The 13-month date of every day of a year, per system (computed once). */
const yearCache = new Map<string, { date: GregorianDate; thirteen: ThirteenDate }[]>();
function daysOf(year: number, system: CalendarSystemId) {
  const key = `${system}:${year}`;
  let days = yearCache.get(key);
  if (days === undefined) {
    days = everyDay(year).map((date) => ({ date, thirteen: toThirteen(date, system) }));
    yearCache.set(key, days);
  }
  return days;
}

/** §4.2 written out: the rule's dates in `year`, scanning every day; the phase from `startDay` as `{p, p + 14}`. */
function oracleDates(rule: ThirteenRule, year: number, startDay: number | null): string[] {
  const p = startDay === null ? null : ((startDay - 1) % 14) + 1;
  return daysOf(year, rule.system)
    .filter(({ thirteen: t }) => {
      switch (rule.kind) {
        case 'monthly':
          return t.kind === 'month' && t.day === rule.day;
        case 'weekly':
          if (t.kind !== 'month' || thirteenWeekday(t) !== rule.weekday) return false;
          return rule.interval === 1 || t.day === p || t.day === p! + 14;
        case 'yearly':
          return t.kind === 'month' && t.month === rule.month && t.day === rule.day;
        case 'intercalary':
          return t.kind === 'intercalary' && t.id === rule.id;
      }
    })
    .map(({ date }) => toISODate(date));
}

/** The 13-month weekday's first month day `k` (§4.2). */
const firstDay = (rule: Rule<'weekly'>) => ((rule.weekday - (rule.system === 'ifc' ? 0 : 1) + 7) % 7) + 1;

/** A start on the rule in `year` (week `week` of a month for weekly rules). */
function startIn(rule: ThirteenRule, year: number, week = 0): GregorianDate {
  switch (rule.kind) {
    case 'monthly':
      return fromThirteen(createMonthDate(year, 5, rule.day, rule.system));
    case 'weekly':
      return fromThirteen(createMonthDate(year, 5, firstDay(rule) + 7 * week, rule.system));
    case 'yearly':
      return fromThirteen(createMonthDate(year, rule.month, rule.day, rule.system));
    case 'intercalary':
      return fromThirteen(createIntercalaryDate(year, rule.id, rule.system));
  }
}

describe('thirteenRuleFor', () => {
  const kinds: ThirteenRuleKind[] = ['monthly', 'weekly', 'biweekly', 'yearly', 'intercalary'];
  const forAll = (start: string, system: CalendarSystemId) => kinds.map((kind) => thirteenRuleFor(kind, g(start), system));

  it('makes every kind from a month day (§4.2, §2.13)', () => {
    expect(forAll('2026-10-19', 'ifc')).toEqual([
      monthly(12),
      weekly(4),
      weekly(4, 2),
      yearly(11, 12),
      null,
    ]);
    // Positivist Friday, Descartes 12, 238.
    expect(forAll('2026-10-19', 'positivist')).toEqual([
      monthly(12, 'positivist'),
      weekly(5, 1, 'positivist'),
      weekly(5, 2, 'positivist'),
      yearly(11, 12, 'positivist'),
      null,
    ]);
    expect(thirteenRuleFor('monthly', g('2026-10-19'))).toEqual(monthly(12)); // default system IFC
  });

  it('makes only the intercalary rule from an intercalary day', () => {
    expect(forAll('2026-12-31', 'ifc')).toEqual([null, null, null, null, intercalary('year-day')]);
    expect(forAll('2024-06-17', 'ifc')).toEqual([null, null, null, null, intercalary('leap-day')]);
    expect(forAll('2024-12-30', 'positivist')).toEqual([null, null, null, null, intercalary('year-day', 'positivist')]);
    expect(forAll('2024-12-31', 'positivist')).toEqual([null, null, null, null, intercalary('leap-day', 'positivist')]);
    expect(forAll('2024-12-31', 'ifc')).toEqual([null, null, null, null, intercalary('year-day')]);
    // The same Gregorian day is a month day in the other system.
    expect(thirteenRuleFor('monthly', g('2024-06-17'), 'positivist')).toEqual(monthly(1, 'positivist'));
  });

  it('gives a rule that produces its start, for every day of a leap and a common year', () => {
    for (const year of [2024, 2026]) {
      for (const system of SYSTEMS) {
        for (const { date } of daysOf(year, system)) {
          for (const kind of kinds) {
            const rule = thirteenRuleFor(kind, date, system);
            if (rule !== null) expect(thirteenRuleIncludes(rule, date, date), `${kind} ${toISODate(date)}`).toBe(true);
          }
        }
      }
    }
  });

  it('rejects unknown kinds, systems and invalid dates', () => {
    expect(() => thirteenRuleFor('daily' as ThirteenRuleKind, g('2026-10-19'))).toThrow(RangeError);
    expect(() => thirteenRuleFor('monthly', g('2026-10-19'), 'julian' as CalendarSystemId)).toThrow(RangeError);
    expect(() => thirteenRuleFor('monthly', { year: 2026, month: 2, day: 29 })).toThrow(RangeError);
  });
});

describe('thirteenRuleDatesInYear', () => {
  const YEARS = [1, 4, 1900, 2000, 2024, 2026, 2100, 9996, 9999];

  it('equals a day-by-day scan of the engine for every rule (§4.2)', () => {
    for (const rule of allRules()) {
      // Weekly starts in week 1 (phase 1, 15) and week 2 (phase 8, 22) of month 5 of 2024.
      for (const week of rule.kind === 'weekly' && rule.interval === 2 ? [0, 1] : [0]) {
        const start = startIn(rule, 2024, week);
        const startDay = rule.kind === 'weekly' ? (toThirteen(start, rule.system) as { day: number }).day : null;
        for (const year of YEARS) {
          expect(iso(thirteenRuleDatesInYear(rule, year, start)), `${JSON.stringify(rule)} ${year}`).toEqual(
            oracleDates(rule, year, startDay),
          );
        }
      }
    }
  });

  it('has 13, 52, 26 or one date a year, and leap-only days only in leap years', () => {
    expect(thirteenRuleDatesInYear(monthly(12), 2026, g('2026-01-12'))).toHaveLength(13);
    expect(thirteenRuleDatesInYear(weekly(4), 2026, g('2026-10-19'))).toHaveLength(52);
    expect(thirteenRuleDatesInYear(weekly(4, 2), 2026, g('2026-10-19'))).toHaveLength(26);
    expect(iso(thirteenRuleDatesInYear(intercalary('leap-day'), 2100, g('2024-06-17')))).toEqual([]);
    expect(iso(thirteenRuleDatesInYear(intercalary('leap-day'), 2104, g('2024-06-17')))).toEqual(['2104-06-17']);
    expect(iso(thirteenRuleDatesInYear(intercalary('leap-day', 'positivist'), 2000, g('2024-12-31')))).toEqual(['2000-12-31']);
    expect(iso(thirteenRuleDatesInYear(intercalary('year-day', 'positivist'), 2024, g('2026-12-31')))).toEqual(['2024-12-30']);
  });

  it('lists the rule own dates, not limited by the start, in the documented examples', () => {
    // Every IFC month on the 12th: Gregorian dates shift by one day after Leap Day in leap years.
    expect(iso(thirteenRuleDatesInYear(monthly(12), 2026, g('2026-10-19'))).slice(5, 8)).toEqual(['2026-06-01', '2026-06-29', '2026-07-27']);
    expect(iso(thirteenRuleDatesInYear(monthly(12), 2028, g('2026-10-19'))).slice(5, 8)).toEqual(['2028-05-31', '2028-06-29', '2028-07-27']);
    // Every IFC week on Thursday: month days 5, 12, 19, 26.
    expect(iso(thirteenRuleDatesInYear(weekly(4), 2026, g('2026-10-19'))).slice(0, 5)).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
      '2026-02-02',
    ]);
  });

  it('takes the fortnight phase from the start: days 3 and 17 give the same phase', () => {
    const tuesday = weekly(2, 2); // IFC Tuesday: month days 3, 10, 17, 24
    const from3 = thirteenRuleDatesInYear(tuesday, 2026, fromThirteen(createMonthDate(2026, 11, 3)));
    const from17 = thirteenRuleDatesInYear(tuesday, 2026, fromThirteen(createMonthDate(2026, 11, 17)));
    const from10 = thirteenRuleDatesInYear(tuesday, 2026, fromThirteen(createMonthDate(2026, 11, 10)));
    expect(from3).toEqual(from17);
    expect(iso(from3).slice(0, 2)).toEqual(['2026-01-03', '2026-01-17']);
    expect(iso(from10).slice(0, 2)).toEqual(['2026-01-10', '2026-01-24']);
    // 364 = 26 x 14: the phase never drifts across years or intercalary days.
    expect(iso(thirteenRuleDatesInYear(tuesday, 2028, fromThirteen(createMonthDate(2026, 11, 3)))).slice(0, 2)).toEqual([
      '2028-01-03',
      '2028-01-17',
    ]);
  });

  it('takes the phase of a start off the weekday from its week, and of an intercalary start as week 1', () => {
    const tuesday = weekly(2, 2);
    // Month day 11 is in week 2: the rule keeps weeks 2 and 4 (days 10 and 24).
    expect(iso(thirteenRuleDatesInYear(tuesday, 2026, fromThirteen(createMonthDate(2026, 1, 11)))).slice(0, 2)).toEqual([
      '2026-01-10',
      '2026-01-24',
    ]);
    expect(iso(thirteenRuleDatesInYear(tuesday, 2026, g('2026-12-31'))).slice(0, 2)).toEqual(['2026-01-03', '2026-01-17']);
    expect(thirteenRuleIncludes(tuesday, g('2027-01-03'), g('2026-12-31'))).toBe(true);
  });

  it('returns fresh dates and rejects invalid input', () => {
    const start = g('2026-10-19');
    const dates = thirteenRuleDatesInYear(monthly(12), 2026, start);
    expect(dates).not.toContain(start);
    (dates[0] as { day: number }).day = 99;
    expect(thirteenRuleDatesInYear(monthly(12), 2026, start)[0]!.day).toBe(12);
    expect(() => thirteenRuleDatesInYear(monthly(29), 2026, start)).toThrow(RangeError);
    expect(() => thirteenRuleDatesInYear(weekly(7 as Weekday), 2026, start)).toThrow(RangeError);
    expect(() => thirteenRuleDatesInYear({ kind: 'weekly', system: 'ifc', weekday: 1, interval: 3 } as never, 2026, start)).toThrow(RangeError);
    expect(() => thirteenRuleDatesInYear(yearly(14, 1), 2026, start)).toThrow(RangeError);
    expect(() => thirteenRuleDatesInYear({ kind: 'intercalary', system: 'ifc', id: 'festival' } as never, 2026, start)).toThrow(RangeError);
    expect(() => thirteenRuleDatesInYear({ kind: 'daily', system: 'ifc' } as never, 2026, start)).toThrow(RangeError);
    for (const year of [0, 10000, 2026.5]) expect(() => thirteenRuleDatesInYear(monthly(1), year, start)).toThrow(RangeError);
    expect(() => thirteenRuleDatesInYear(monthly(1), 2026, { year: 2026, month: 13, day: 1 })).toThrow(RangeError);
  });
});

describe('thirteenRuleIncludes', () => {
  it('agrees with thirteenRuleDatesInYear on every day of a leap and a common year', () => {
    const rules = allRules().filter((r) => r.kind !== 'yearly' || r.day % 9 === 1);
    for (const year of [2024, 2026]) {
      for (const rule of rules) {
        const start = startIn(rule, 2024, 1);
        const dates = new Set(iso(thirteenRuleDatesInYear(rule, year, start)));
        for (const { date } of daysOf(year, rule.system)) {
          expect(thirteenRuleIncludes(rule, date, start), `${JSON.stringify(rule)} ${toISODate(date)}`).toBe(dates.has(toISODate(date)));
        }
      }
    }
  });

  it('does not compare the date with the start', () => {
    expect(thirteenRuleIncludes(monthly(12), g('2020-01-12'), g('2026-10-19'))).toBe(true);
    expect(thirteenRuleIncludes(monthly(12), g('2026-10-20'), g('2026-10-19'))).toBe(false);
    expect(() => thirteenRuleIncludes(monthly(12), { year: 2026, month: 2, day: 30 }, g('2026-10-19'))).toThrow(RangeError);
  });
});

/** §4.3 written out: the form of a rule, from the spec text. */
function specForm(rule: ThirteenRule): ThirteenEncodingForm {
  switch (rule.kind) {
    case 'monthly':
    case 'weekly':
      return 'byyearday';
    case 'yearly': {
      const p = 28 * (rule.month - 1) + rule.day;
      if (rule.system === 'ifc') return p <= 59 || rule.month >= 7 ? 'gregorian-yearly' : 'byyearday';
      return p <= 59 ? 'gregorian-yearly' : 'byyearday';
    }
    case 'intercalary':
      if (rule.id === 'leap-day') return 'leap-interval';
      return rule.system === 'ifc' ? 'gregorian-yearly' : 'byyearday';
  }
}

/** §4.3 (b) written out: `p` for IFC months 1 to 6 and every Positivist month, `p - 366` for IFC months 7 to 13, 365 for All the Dead. */
function specYearDays(rule: ThirteenRule, startDay: number): number[] {
  const value = (month: number, day: number) => {
    const p = 28 * (month - 1) + day;
    return rule.system === 'ifc' && month >= 7 ? p - 366 : p;
  };
  const days =
    rule.kind === 'monthly'
      ? [rule.day]
      : rule.kind === 'weekly'
        ? rule.interval === 1
          ? [0, 7, 14, 21].map((d) => firstDay(rule) + d)
          : [((startDay - 1) % 14) + 1, ((startDay - 1) % 14) + 15]
        : [];
  if (rule.kind === 'yearly') return [value(rule.month, rule.day)];
  if (rule.kind === 'intercalary') return [365];
  const values: number[] = [];
  for (let month = 1; month <= 13; month++) for (const day of days) values.push(value(month, day));
  return [...values.filter((v) => v > 0), ...values.filter((v) => v < 0)];
}

describe('encodeThirteenRule', () => {
  const text = (rule: ThirteenRule, start: string) => formatRRule(encodeThirteenRule(rule, g(start)).rrule);

  it('gives the §4.3 table exactly', () => {
    expect(text(monthly(12), '2026-10-19')).toBe('FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18');
    expect(text(monthly(1), '2026-01-01')).toBe('FREQ=YEARLY;BYYEARDAY=1,29,57,85,113,141,-197,-169,-141,-113,-85,-57,-29');
    expect(text(monthly(28), '2026-01-28')).toBe('FREQ=YEARLY;BYYEARDAY=28,56,84,112,140,168,-170,-142,-114,-86,-58,-30,-2');
    expect(text(monthly(12, 'positivist'), '2026-01-12')).toBe('FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,180,208,236,264,292,320,348');
    const thursday = encodeThirteenRule(weekly(4), g('2026-10-19')).rrule.byYearDay;
    expect(thursday).toHaveLength(52);
    expect(thursday.slice(0, 4)).toEqual([5, 12, 19, 26]);
    expect(thursday.slice(22, 26)).toEqual([159, 166, -193, -186]);
    expect(thursday.at(-1)).toBe(-4);
    expect(text(yearly(4, 12), '2026-04-06')).toBe('FREQ=YEARLY;BYYEARDAY=96');
    expect(text(intercalary('year-day', 'positivist'), '2026-12-31')).toBe('FREQ=YEARLY;BYYEARDAY=365');
  });

  it('chooses the form of §4.3 and matches its day-of-year formula for every rule', () => {
    for (const rule of allRules()) {
      for (const week of rule.kind === 'weekly' && rule.interval === 2 ? [0, 1] : [0]) {
        const start = startIn(rule, 2024, week);
        const encoding = encodeThirteenRule(rule, start);
        const label = JSON.stringify(rule);
        expect(encoding.form, label).toBe(specForm(rule));
        expect(thirteenEncodingForm(rule), label).toBe(encoding.form);
        expect(encoding.exchangeSafe, label).toBe(encoding.form !== 'byyearday');
        if (encoding.form === 'byyearday') {
          const startDay = rule.kind === 'weekly' ? (toThirteen(start, rule.system) as { day: number }).day : 0;
          expect(encoding.rrule.byYearDay, label).toEqual(specYearDays(rule, startDay));
          expect(formatRRule(encoding.rrule), label).toBe(`FREQ=YEARLY;BYYEARDAY=${specYearDays(rule, startDay).join(',')}`);
          expect(encoding.cap).toBeNull();
        } else if (encoding.form === 'gregorian-yearly') {
          expect(formatRRule(encoding.rrule), label).toBe('FREQ=YEARLY');
          expect(encoding.cap).toBeNull();
        } else {
          expect(formatRRule(encoding.rrule), label).toMatch(/^FREQ=YEARLY;INTERVAL=4;UNTIL=\d{8}$/);
        }
      }
    }
  });

  it('covers the documented form (a) dates: IFC up to day 59 and from Sol 1, Positivist up to day 59', () => {
    expect(encodeThirteenRule(yearly(3, 3), g('2026-02-28')).form).toBe('gregorian-yearly'); // day 59
    expect(encodeThirteenRule(yearly(3, 4), g('2026-03-01')).form).toBe('byyearday'); // day 60
    expect(text(yearly(3, 4), '2028-02-29')).toBe('FREQ=YEARLY;BYYEARDAY=60');
    expect(text(yearly(6, 28), '2026-06-17')).toBe('FREQ=YEARLY;BYYEARDAY=168');
    expect(encodeThirteenRule(yearly(7, 1), g('2026-06-18')).form).toBe('gregorian-yearly'); // Sol 1
    expect(encodeThirteenRule(yearly(13, 28), g('2026-12-30')).form).toBe('gregorian-yearly');
    expect(encodeThirteenRule(intercalary('year-day'), g('2026-12-31')).form).toBe('gregorian-yearly');
    expect(encodeThirteenRule(yearly(3, 3, 'positivist'), g('2026-02-28')).form).toBe('gregorian-yearly');
    expect(text(yearly(3, 4, 'positivist'), '2026-03-01')).toBe('FREQ=YEARLY;BYYEARDAY=60');
    expect(text(yearly(13, 28, 'positivist'), '2026-12-30')).toBe('FREQ=YEARLY;BYYEARDAY=364');
  });

  it('caps the leap interval before the next century year that is not a leap year (§4.3 c)', () => {
    const cap = (rule: ThirteenRule, start: string) => {
      const encoding = encodeThirteenRule(rule, g(start));
      expect(encoding.form).toBe('leap-interval');
      expect(formatRRule(encoding.rrule)).toBe(`FREQ=YEARLY;INTERVAL=4;UNTIL=${toISODate(encoding.cap!).replaceAll('-', '')}`);
      return toISODate(encoding.cap!);
    };
    for (const year of [2000, 2024, 2028, 2092, 2096]) expect(cap(intercalary('leap-day'), `${year}-06-17`)).toBe('2096-06-17');
    expect(cap(intercalary('leap-day'), '2104-06-17')).toBe('2196-06-17');
    expect(cap(intercalary('leap-day'), '1896-06-17')).toBe('1896-06-17');
    expect(cap(intercalary('leap-day'), '1904-06-17')).toBe('2096-06-17');
    expect(cap(intercalary('leap-day'), '2396-06-17')).toBe('2496-06-17');
    expect(cap(intercalary('leap-day'), '0004-06-17')).toBe('0096-06-17');
    // 10000 is a leap year, but out of range: the cap is the last leap year in range.
    expect(cap(intercalary('leap-day'), '9904-06-17')).toBe('9996-06-17');
    expect(cap(intercalary('leap-day'), '9996-06-17')).toBe('9996-06-17');
    expect(cap(intercalary('leap-day', 'positivist'), '2024-12-31')).toBe('2096-12-31');
  });

  it('returns fresh values', () => {
    const start = g('2024-06-17');
    const encoding = encodeThirteenRule(intercalary('leap-day'), start);
    expect(encoding.cap).toEqual({ year: 2096, month: 6, day: 17 });
    expect(encoding.cap).not.toBe((encoding.rrule.until as { date: GregorianDate }).date);
    expect(encodeThirteenRule(monthly(12), g('2026-10-19')).rrule.byYearDay).not.toBe(encodeThirteenRule(monthly(12), g('2026-10-19')).rrule.byYearDay);
  });

  it('needs a start the rule produces, and a valid rule', () => {
    expect(() => encodeThirteenRule(monthly(12), g('2026-10-20'))).toThrow(/does not produce its start/);
    expect(() => encodeThirteenRule(yearly(1, 1), g('2026-01-05'))).toThrow(RangeError);
    expect(() => encodeThirteenRule(weekly(4), g('2026-10-20'))).toThrow(RangeError);
    expect(() => encodeThirteenRule(intercalary('leap-day'), g('2026-06-17'))).toThrow(RangeError);
    expect(() => encodeThirteenRule(monthly(0), g('2026-10-19'))).toThrow(RangeError);
    expect(() => thirteenEncodingForm({ kind: 'yearly', system: 'ifc', month: 1 } as never)).toThrow(RangeError);
  });
});

describe('ical.js expands every encoding to the rule dates (2024 to 2104)', () => {
  /** All-day occurrences of `rule` from `start` that `ical.js` expands up to 2104-12-31. */
  function icalDates(ruleText: string, start: GregorianDate): string[] {
    const iterator = ICAL.Recur.fromString(ruleText).iterator(ICAL.Time.fromDateString(toISODate(start)));
    const out: string[] = [];
    for (let next = iterator.next(); next && next.year <= 2104; next = iterator.next()) out.push(next.toString());
    return out;
  }

  /** Every rule date from `start` to 2104-12-31 by thirteenRuleDatesInYear. */
  function ourDates(rule: ThirteenRule, start: GregorianDate): string[] {
    const out: string[] = [];
    for (let year = start.year; year <= 2104; year++) {
      for (const date of thirteenRuleDatesInYear(rule, year, start)) if (compareGregorian(date, start) >= 0) out.push(toISODate(date));
    }
    return out;
  }

  it('agrees for every rule, both fortnight phases, starts in 2024', () => {
    let compared = 0;
    for (const rule of allRules()) {
      // The first date of the rule on or after 2024-01-01, in each phase for every 2 weeks.
      const firstStarts =
        rule.kind === 'weekly' && rule.interval === 2
          ? [0, 1].map((week) => fromThirteen(createMonthDate(2024, 1, firstDay(rule) + 7 * week, rule.system)))
          : [thirteenRuleDatesInYear(rule, 2024, g('2024-01-01'))[0]!];
      for (const start of firstStarts) {
        const encoding = encodeThirteenRule(rule, start);
        const theirs = icalDates(formatRRule(encoding.rrule), start);
        const ours = ourDates(rule, start);
        const label = `${formatThirteenRuleText(rule)} from ${toISODate(start)}`;
        if (encoding.form === 'leap-interval') {
          // The cap stops the rule before 2100, the first leap year INTERVAL=4 would get wrong.
          const cap = toISODate(encoding.cap!);
          expect(theirs, label).toEqual(ours.filter((d) => d <= cap));
          expect(theirs.at(-1)).toBe(cap);
          expect(ours).not.toContain(`2100${cap.slice(4)}`);
        } else {
          expect(theirs, label).toEqual(ours);
          // Form (d) lists the same dates.
          expect(iso(thirteenRuleRdates(rule, start, never, g('2104-12-31'), NO_LIMIT).dates), label).toEqual(ours.slice(1));
        }
        compared += theirs.length;
      }
    }
    expect(compared).toBeGreaterThan(200_000);
  });

  it('agrees for leap-interval rules across 1896, 2000 and 2400 (leap century years)', () => {
    for (const [start, cap] of [
      ['1896-06-17', '1896-06-17'],
      ['1904-06-17', '2096-06-17'],
      ['2304-06-17', '2496-06-17'],
    ] as const) {
      const encoding = encodeThirteenRule(intercalary('leap-day'), g(start));
      const iterator = ICAL.Recur.fromString(formatRRule(encoding.rrule)).iterator(ICAL.Time.fromDateString(start));
      const theirs: string[] = [];
      for (let next = iterator.next(); next; next = iterator.next()) theirs.push(next.toString());
      const ours: string[] = [];
      for (let year = Number(start.slice(0, 4)); year <= Number(cap.slice(0, 4)); year += 4) {
        ours.push(...iso(thirteenRuleDatesInYear(intercalary('leap-day'), year, g(start))));
      }
      expect(theirs).toEqual(ours);
      expect(theirs.at(-1)).toBe(cap);
    }
  });
});

describe('thirteenRuleRdates', () => {
  const bookClub = monthly(12);
  const bookClubStart = g('2026-01-12');

  it('lists the dates after the start through the horizon (§4.4)', () => {
    const { dates, truncated } = thirteenRuleRdates(bookClub, bookClubStart, never, g('2036-12-31'));
    expect(truncated).toBe(false);
    expect(dates).toHaveLength(13 * 11 - 1);
    expect(iso(dates).slice(0, 2)).toEqual(['2026-02-09', '2026-03-09']);
    expect(toISODate(dates.at(-1)!)).toBe('2036-12-14'); // IFC December 12 in a leap year
    // §2.13 Next line: Gregorian Mon, Nov 16; Mon, Dec 14; Tue, Jan 12, 2027.
    expect(iso(thirteenRuleRdates(bookClub, g('2026-10-19'), count(4), g('9999-12-31')).dates)).toEqual([
      '2026-11-16',
      '2026-12-14',
      '2027-01-12',
    ]);
  });

  it('counts the start in a count end, includes the until date and stops at the horizon', () => {
    expect(thirteenRuleRdates(bookClub, bookClubStart, count(1), g('9999-12-31')).dates).toEqual([]);
    expect(thirteenRuleRdates(bookClub, bookClubStart, count(13), g('9999-12-31')).dates).toHaveLength(12);
    expect(iso(thirteenRuleRdates(bookClub, bookClubStart, until('2026-03-09'), g('9999-12-31')).dates)).toEqual(['2026-02-09', '2026-03-09']);
    expect(iso(thirteenRuleRdates(bookClub, bookClubStart, until('2026-03-08'), g('9999-12-31')).dates)).toEqual(['2026-02-09']);
    expect(iso(thirteenRuleRdates(bookClub, bookClubStart, count(999), g('2026-03-09')).dates)).toEqual(['2026-02-09', '2026-03-09']);
    // An end or horizon before the start leaves only the start.
    expect(thirteenRuleRdates(bookClub, bookClubStart, until('2025-12-31'), g('9999-12-31')).dates).toEqual([]);
    expect(thirteenRuleRdates(bookClub, bookClubStart, never, g('2026-01-12'))).toEqual({ dates: [], truncated: false });
  });

  it('stops at 9999-12-31', () => {
    const { dates } = thirteenRuleRdates(intercalary('year-day'), g('9990-12-31'), never, g('9999-12-31'));
    expect(toISODate(dates.at(-1)!)).toBe('9999-12-31');
    expect(dates).toHaveLength(9);
    expect(thirteenRuleRdates(intercalary('year-day'), g('9999-12-31'), never, g('9999-12-31')).dates).toEqual([]);
    expect(thirteenRuleRdates(weekly(4), g('2026-10-19'), count(2_147_483_647), g('9999-12-31'), NO_LIMIT).dates).toHaveLength(
      52 * (9999 - 2026) + 10,
    );
  });

  it('returns at most maxValues dates (default 400) and says when it cut the list', () => {
    const thursday = weekly(4);
    const start = g('2026-10-19');
    const capped = thirteenRuleRdates(thursday, start, never, g('9999-12-31'));
    expect(capped.dates).toHaveLength(400);
    expect(capped.truncated).toBe(true);
    // Exactly 400 dates left before the end: not truncated.
    expect(thirteenRuleRdates(thursday, start, count(401), g('9999-12-31'))).toMatchObject({ truncated: false });
    expect(thirteenRuleRdates(thursday, start, count(402), g('9999-12-31'))).toMatchObject({ truncated: true });
    const lastOf400 = capped.dates.at(-1)!;
    expect(thirteenRuleRdates(thursday, start, never, lastOf400).truncated).toBe(false);
    expect(thirteenRuleRdates(thursday, start, never, addGregorianDays(lastOf400, 7)).truncated).toBe(true);
    expect(thirteenRuleRdates(thursday, start, never, g('2026-12-31'), { maxValues: 3 })).toEqual({
      dates: [g('2026-10-26'), g('2026-11-02'), g('2026-11-09')],
      truncated: true,
    });
  });

  it('keeps an off-pattern start as the first occurrence (RFC 5545)', () => {
    expect(iso(thirteenRuleRdates(bookClub, g('2026-10-20'), count(3), g('9999-12-31')).dates)).toEqual(['2026-11-16', '2026-12-14']);
  });

  it('rejects invalid ends, horizons and options', () => {
    const call = (end: unknown, horizon: unknown = g('2030-01-01'), options?: unknown) =>
      thirteenRuleRdates(bookClub, bookClubStart, end as RepeatEnd, horizon as GregorianDate, options as never);
    for (const end of [{ kind: 'count', count: 0 }, { kind: 'count', count: 1.5 }, { kind: 'count', count: 2_147_483_648 }, { kind: 'until' }, { kind: 'later' }, null]) {
      expect(() => call(end), JSON.stringify(end)).toThrow(RangeError);
    }
    expect(() => call(never, { year: 2030, month: 2, day: 30 })).toThrow(RangeError);
    for (const options of [{ maxValues: 0 }, { maxValues: 1.5 }, { maxValues: '400' }, { limit: 3 }, [], 'x']) {
      expect(() => call(never, g('2030-01-01'), options), JSON.stringify(options)).toThrow(RangeError);
    }
    expect(() => thirteenRuleRdates(monthly(30), bookClubStart, never, g('2030-01-01'))).toThrow(RangeError);
  });
});

describe('thirteenRuleRdateParts', () => {
  const wednesday = weekly(3);
  const start = g('2020-01-04'); // IFC Wednesday, January 4, 2020

  /** Every occurrence of the parts, in order. */
  const flatten = (parts: ReturnType<typeof thirteenRuleRdateParts>) => parts.flatMap((p) => [p.start, ...p.dates]).map(toISODate);

  it('cuts a weekly series from 2020 into parts of 401 occurrences (§4.4)', () => {
    const parts2029 = thirteenRuleRdateParts(wednesday, start, never, g('2029-12-31'));
    expect(parts2029.map((p) => [p.part, toISODate(p.start), p.dates.length])).toEqual([
      [1, '2020-01-04', 400],
      [2, '2027-09-20', 118],
    ]);
    // A later horizon grows the last part; the full part is unchanged.
    const parts2033 = thirteenRuleRdateParts(wednesday, start, never, g('2033-12-31'));
    expect(parts2033[0]).toEqual(parts2029[0]);
    expect(parts2033.map((p) => [p.part, toISODate(p.start), p.dates.length])).toEqual([
      [1, '2020-01-04', 400],
      [2, '2027-09-20', 326],
    ]);
    // A third part needs more than 802 occurrences: from June 2035.
    const parts2035 = thirteenRuleRdateParts(wednesday, start, never, g('2035-12-31'));
    expect(parts2035.map((p) => [p.part, toISODate(p.start), p.dates.length])).toEqual([
      [1, '2020-01-04', 400],
      [2, '2027-09-20', 400],
      [3, '2035-06-07', 29],
    ]);
    // A weekly series from January 2026 gets its second part in 2033 (§4.4).
    const from2026 = thirteenRuleRdateParts(wednesday, g('2026-01-04'), never, g('2033-12-31'));
    // Occurrence 402 is the 38th of 2033: IFC September 11 = September 20.
    expect(from2026.map((p) => toISODate(p.start))).toEqual(['2026-01-04', '2033-09-20']);
  });

  it('is deterministic: a later horizon only grows the last part and appends parts', () => {
    const rules: [ThirteenRule, GregorianDate][] = [
      [wednesday, start],
      [weekly(1, 2, 'positivist'), fromThirteen(createMonthDate(2026, 3, 8, 'positivist'))],
      [monthly(28), g('2026-01-28')],
    ];
    for (const [rule, first] of rules) {
      for (const maxValues of [1, 7, 400]) {
        let previous = thirteenRuleRdateParts(rule, first, never, first, { maxValues });
        expect(previous).toEqual([{ part: 1, start: first, dates: [] }]);
        for (let years = 1; years <= 12; years += 1 + (years % 3)) {
          const next = thirteenRuleRdateParts(rule, first, never, { year: first.year + years, month: 12, day: 31 }, { maxValues });
          expect(next.length).toBeGreaterThanOrEqual(previous.length);
          previous.forEach((part, i) => {
            if (i < previous.length - 1) expect(next[i]).toEqual(part);
            else expect(iso(next[i]!.dates.slice(0, part.dates.length))).toEqual(iso(part.dates));
            expect(next[i]!.start).toEqual(part.start);
          });
          for (const part of next.slice(0, -1)) expect(part.dates).toHaveLength(maxValues);
          expect(next.map((p) => p.part)).toEqual(next.map((_, i) => i + 1));
          previous = next;
        }
      }
    }
  });

  it('holds every occurrence once: the start and the RDATE list', () => {
    for (const end of [never, count(999), until('2031-06-30')]) {
      const parts = thirteenRuleRdateParts(wednesday, start, end, g('9999-12-31'));
      const all = [toISODate(start), ...iso(thirteenRuleRdates(wednesday, start, end, g('9999-12-31'), NO_LIMIT).dates)];
      expect(flatten(parts)).toEqual(all);
    }
    const counted = thirteenRuleRdateParts(wednesday, start, count(999), g('9999-12-31'));
    expect(counted.map((p) => p.dates.length)).toEqual([400, 400, 196]);
    expect(flatten(counted)).toHaveLength(999);
  });

  it('accepts maxValues and returns fresh parts', () => {
    const parts = thirteenRuleRdateParts(monthly(28), g('9990-01-28'), never, g('9999-12-31'), { maxValues: 100 });
    expect(parts.map((p) => [p.part, toISODate(p.start), p.dates.length])).toEqual([
      [1, '9990-01-28', 100],
      [2, '9997-11-04', 28],
    ]);
    expect(toISODate(parts[1]!.dates.at(-1)!)).toBe('9999-12-30');
    const input = g('2026-01-28');
    expect(thirteenRuleRdateParts(monthly(28), input, count(1), g('2030-01-01'))[0]!.start).not.toBe(input);
    expect(() => thirteenRuleRdateParts(monthly(28), input, never, g('2030-01-01'), { maxValues: 0 })).toThrow(RangeError);
    expect(() => thirteenRuleRdateParts(monthly(28), input, { kind: 'count', count: -1 }, g('2030-01-01'))).toThrow(RangeError);
  });
});

describe('marker text (§4.3 e)', () => {
  it('formats the documented examples', () => {
    expect(formatThirteenRuleText(monthly(12))).toBe('SYSTEM=ifc;KIND=monthly;DAY=12');
    expect(formatThirteenRuleText(weekly(4, 2))).toBe('SYSTEM=ifc;KIND=weekly;WEEKDAY=TH;INTERVAL=2');
    expect(formatThirteenRuleText(weekly(4))).toBe('SYSTEM=ifc;KIND=weekly;WEEKDAY=TH');
    expect(formatThirteenRuleText(yearly(4, 4, 'positivist'))).toBe('SYSTEM=positivist;KIND=yearly;MONTH=4;DAY=4');
    expect(formatThirteenRuleText(intercalary('leap-day'))).toBe('SYSTEM=ifc;KIND=intercalary;DAY=LD');
    expect(formatThirteenRuleText(intercalary('year-day', 'positivist'))).toBe('SYSTEM=positivist;KIND=intercalary;DAY=YD');
  });

  it('round-trips every rule', () => {
    for (const rule of allRules()) expect(parseThirteenRuleText(formatThirteenRuleText(rule))).toEqual(rule);
    expect(parseThirteenRuleText('SYSTEM=ifc;KIND=weekly;WEEKDAY=SU;INTERVAL=1')).toEqual(weekly(0));
  });

  it('rejects everything outside the strict grammar', () => {
    for (const text of [
      '',
      'SYSTEM=ifc',
      'SYSTEM=ifc;KIND=monthly',
      'SYSTEM=ifc;KIND=monthly;DAY=12;',
      ';SYSTEM=ifc;KIND=monthly;DAY=12',
      'X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=monthly;DAY=12',
      ' SYSTEM=ifc;KIND=monthly;DAY=12',
      'SYSTEM=ifc; KIND=monthly;DAY=12',
      'system=ifc;kind=monthly;day=12',
      'SYSTEM=IFC;KIND=monthly;DAY=12',
      'SYSTEM=ifc;KIND=MONTHLY;DAY=12',
      'KIND=monthly;SYSTEM=ifc;DAY=12',
      'SYSTEM=gregorian;KIND=monthly;DAY=12',
      'SYSTEM=ifc;KIND=daily;DAY=12',
      'SYSTEM=ifc;KIND=biweekly;WEEKDAY=TH',
      'SYSTEM=ifc;KIND=monthly;DAY=0',
      'SYSTEM=ifc;KIND=monthly;DAY=29',
      'SYSTEM=ifc;KIND=monthly;DAY=012',
      'SYSTEM=ifc;KIND=monthly;DAY=+12',
      'SYSTEM=ifc;KIND=monthly;DAY=1２',
      'SYSTEM=ifc;KIND=monthly;DAY=12;DAY=13',
      'SYSTEM=ifc;KIND=monthly;DAY=12;MONTH=1',
      'SYSTEM=ifc;KIND=weekly;WEEKDAY=th',
      'SYSTEM=ifc;KIND=weekly;WEEKDAY=4',
      'SYSTEM=ifc;KIND=weekly;WEEKDAY=TH;INTERVAL=3',
      'SYSTEM=ifc;KIND=weekly;WEEKDAY=TH;INTERVAL=02',
      'SYSTEM=ifc;KIND=weekly;INTERVAL=2;WEEKDAY=TH',
      'SYSTEM=ifc;KIND=weekly',
      'SYSTEM=ifc;KIND=yearly;MONTH=14;DAY=1',
      'SYSTEM=ifc;KIND=yearly;MONTH=0;DAY=1',
      'SYSTEM=ifc;KIND=yearly;DAY=1;MONTH=4',
      'SYSTEM=ifc;KIND=yearly;MONTH=4',
      'SYSTEM=ifc;KIND=intercalary;DAY=ld',
      'SYSTEM=ifc;KIND=intercalary;DAY=1',
      'SYSTEM=ifc;KIND=intercalary;ID=LD',
      'SYSTEM==ifc;KIND=monthly;DAY=12',
      '=ifc;KIND=monthly;DAY=12',
    ]) {
      expect(() => parseThirteenRuleText(text), text).toThrow(RangeError);
    }
    expect(() => parseThirteenRuleText(12 as unknown as string)).toThrow(RangeError);
    expect(() => formatThirteenRuleText(monthly(29))).toThrow(RangeError);
  });
});

describe('rule URI (§4.3 e)', () => {
  const uuid = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';

  it('formats the documented example and every end', () => {
    expect(formatThirteenRuleUri(monthly(12), never)).toBe('thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never');
    expect(formatThirteenRuleUri(monthly(12), count(10))).toBe('thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=count:10');
    expect(formatThirteenRuleUri(monthly(12), until('2027-06-30'))).toBe(
      'thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=until:2027-06-30',
    );
    expect(formatThirteenRuleUri(weekly(4, 2), never, { series: uuid, part: 3 })).toBe(
      `thirteen://rule?v=1&system=ifc&kind=weekly&weekday=TH&interval=2&end=never&series=${uuid}&part=3`,
    );
    expect(formatThirteenRuleUri(yearly(13, 28, 'positivist'), until('0001-01-01'))).toBe(
      'thirteen://rule?v=1&system=positivist&kind=yearly&month=13&day=28&end=until:0001-01-01',
    );
    expect(formatThirteenRuleUri(intercalary('year-day'), never, { series: null, part: null })).toBe(
      'thirteen://rule?v=1&system=ifc&kind=intercalary&day=YD&end=never',
    );
  });

  it('round-trips every rule with every end and with and without parts', () => {
    const ends = [never, count(1), count(999), count(2_147_483_647), until('9999-12-31')];
    allRules().forEach((rule, i) => {
      const end = ends[i % ends.length]!;
      const extras = i % 2 === 0 ? { series: uuid, part: 1 + (i % 4) } : { series: null, part: null };
      expect(parseThirteenRuleUri(formatThirteenRuleUri(rule, end, extras))).toEqual({ rule, end, ...extras });
    });
  });

  it('rejects everything outside the strict grammar', () => {
    const base = 'thirteen://rule?v=1&system=ifc&kind=monthly&day=12';
    for (const text of [
      '',
      `${base}`,
      `${base}&end=never&`,
      `${base}&end=Never`,
      `${base}&end=count:0`,
      `${base}&end=count:010`,
      `${base}&end=count:2147483648`,
      `${base}&end=count:`,
      `${base}&end=until:2026-02-30`,
      `${base}&end=until:20260630`,
      `${base}&end=never&series=${uuid}`,
      `${base}&end=never&part=1`,
      `${base}&end=never&part=1&series=${uuid}`,
      `${base}&end=never&series=${uuid.toUpperCase()}&part=1`,
      `${base}&end=never&series=${uuid}&part=0`,
      `${base}&end=never&series=${uuid}&part=01`,
      `${base}&end=never&series=${uuid}&part=1&x=1`,
      'thirteen://rule?v=2&system=ifc&kind=monthly&day=12&end=never',
      'thirteen://rule?system=ifc&kind=monthly&day=12&end=never',
      'thirteen://rule?v=1&kind=monthly&system=ifc&day=12&end=never',
      'thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never#x',
      'thirteen://rule/?v=1&system=ifc&kind=monthly&day=12&end=never',
      'THIRTEEN://rule?v=1&system=ifc&kind=monthly&day=12&end=never',
      'thirteen://rule?v=1&SYSTEM=ifc&kind=monthly&day=12&end=never',
      'thirteen://rule?v=1&system=ifc&kind=weekly&weekday=th&end=never',
      'thirteen://rule?v=1&system=ifc&kind=intercalary&day=ld&end=never',
      'thirteen://detached?v=1&series=4521&original=2026-11-16',
      'SYSTEM=ifc;KIND=monthly;DAY=12',
    ]) {
      expect(() => parseThirteenRuleUri(text), text).toThrow(RangeError);
    }
  });

  it('rejects invalid ends and extras when formatting', () => {
    expect(() => formatThirteenRuleUri(monthly(12), count(0))).toThrow(RangeError);
    expect(() => formatThirteenRuleUri(monthly(12), { kind: 'until', date: { year: 2026, month: 2, day: 29 } })).toThrow(RangeError);
    expect(() => formatThirteenRuleUri(monthly(12), never, { series: uuid, part: null })).toThrow(RangeError);
    expect(() => formatThirteenRuleUri(monthly(12), never, { series: null, part: 1 })).toThrow(RangeError);
    expect(() => formatThirteenRuleUri(monthly(12), never, { series: uuid.toUpperCase(), part: 1 })).toThrow(RangeError);
    expect(() => formatThirteenRuleUri(monthly(12), never, { series: uuid, part: 0 })).toThrow(RangeError);
    expect(() => formatThirteenRuleUri(monthly(12), never, { series: uuid, part: 1, extra: 1 } as never)).toThrow(RangeError);
  });
});

describe('detached URI (§4.3 e)', () => {
  it('formats and parses the documented form', () => {
    const text = formatDetachedUri('4521', g('2026-11-16'));
    expect(text).toBe('thirteen://detached?v=1&series=4521&original=2026-11-16');
    expect(parseDetachedUri(text)).toEqual({ series: '4521', original: g('2026-11-16') });
  });

  it('percent-encodes every byte outside the unreserved characters, so any id round-trips', () => {
    expect(formatDetachedUri('AAMkAGI2/x+Yw==', g('2026-11-16'))).toBe(
      'thirteen://detached?v=1&series=AAMkAGI2%2Fx%2BYw%3D%3D&original=2026-11-16',
    );
    expect(formatDetachedUri("a b&c=d!'()*~._-", g('0001-01-01'))).toBe(
      'thirteen://detached?v=1&series=a%20b%26c%3Dd%21%27%28%29%2A~._-&original=0001-01-01',
    );
    for (const series of ['_R20261116T170000', 'Kalender 7 & Überweisung', '\u{1F4C5}%41', '?#[]@:/;,$']) {
      const text = formatDetachedUri(series, g('9999-12-31'));
      expect(text).toMatch(/^thirteen:\/\/detached\?v=1&series=(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+&original=9999-12-31$/);
      expect(parseDetachedUri(text)).toEqual({ series, original: g('9999-12-31') });
    }
    expect(parseDetachedUri('thirteen://detached?v=1&series=a%2fb&original=2026-11-16')).toEqual({ series: 'a/b', original: g('2026-11-16') });
  });

  it('returns null for anything that is not a detached marker', () => {
    for (const text of [
      '',
      'thirteen://detached?v=1&series=4521',
      'thirteen://detached?v=2&series=4521&original=2026-11-16',
      'thirteen://detached?series=4521&v=1&original=2026-11-16',
      'thirteen://detached?v=1&series=&original=2026-11-16',
      'thirteen://detached?v=1&series=45 21&original=2026-11-16',
      'thirteen://detached?v=1&series=45+21&original=2026-11-16',
      'thirteen://detached?v=1&series=%E2%82&original=2026-11-16',
      'thirteen://detached?v=1&series=%ZZ&original=2026-11-16',
      'thirteen://detached?v=1&series=4521&original=2026-02-30',
      'thirteen://detached?v=1&series=4521&original=20261116',
      'thirteen://detached?v=1&series=4521&original=2026-11-16&part=1',
      'thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never',
      'Thirteen://detached?v=1&series=4521&original=2026-11-16',
    ]) {
      expect(parseDetachedUri(text), text).toBeNull();
    }
    expect(() => parseDetachedUri(null as unknown as string)).toThrow(RangeError);
  });

  it('rejects empty or malformed series ids and invalid dates', () => {
    expect(() => formatDetachedUri('', g('2026-11-16'))).toThrow(RangeError);
    expect(() => formatDetachedUri('\ud800', g('2026-11-16'))).toThrow(RangeError);
    expect(() => formatDetachedUri(4521 as unknown as string, g('2026-11-16'))).toThrow(RangeError);
    expect(() => formatDetachedUri('4521', { year: 2026, month: 2, day: 29 })).toThrow(RangeError);
  });
});

describe('leap years', () => {
  it('the helper years used above are what the tests assume', () => {
    expect([2024, 2028, 2000, 9996].every(isLeapYear)).toBe(true);
    expect([2026, 2100, 1900, 9999].some(isLeapYear)).toBe(false);
  });
});
