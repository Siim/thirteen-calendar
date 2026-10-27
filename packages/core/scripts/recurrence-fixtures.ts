/**
 * Section builders of task C4 for `fixtures/events.json` (docs/EVENTS.md
 * §5.5): `expansions`, `endBefore`, `splits`, `retimes`, `recognitions`,
 * `presets`, `descriptions`, `nextOccurrences`, `repeatNotes` and
 * `adaptations` ({@link C4_SECTIONS}, in the §6.0 publication order), and the
 * zone sections `series` and `alarmInstants` ({@link C4_ZONE_SECTIONS}),
 * which are published last and run through a zone resolver: Node's `Intl` by
 * default, the recording wrapper of task C6 when it writes the file.
 *
 * Every builder is pure and deterministic (given the resolver). Cases come
 * from tables so the counts are exact; expected values come from the engine
 * and are pinned by hand-written assertions in `test/events/`. JSON forms as
 * in `events-fixtures.ts`, plus the C4 forms below.
 */

import { type CalendarSystemId, parseISODate, toISODate } from '../src/index.ts';
import {
  type Alarm,
  type LocalDateTime,
  type ZoneResolver,
  alarmFireTime,
  formatLocalDateTime,
  parseLocalDateTime,
  parseRRule,
  zonedToUtc,
} from '../src/events/index.ts';
import {
  type DeviceWindow,
  type ExpandedOccurrence,
  type OverrideInput,
  type SeriesInput,
  expandSeries,
} from '../src/events/occurrences.ts';
import {
  type EventRecurrence,
  type ExceptionMap,
  type ExtraDate,
  type OriginalDate,
  type Recognition,
  type RecognitionInput,
  type RepeatEnd,
  type RepeatPreset,
  type RepeatRule,
  type SplitResult,
  type UntilRewrite,
  adaptRecurrenceToStart,
  describeNextOccurrences,
  describeRecurrence,
  describeRepeatNotes,
  endRecurrenceBefore,
  expandRecurrence,
  laterOccurrenceCount,
  nextOccurrences,
  recognizeRecurrence,
  repeatPresets,
  retimeExceptions,
  splitRecurrence,
} from '../src/events/recurrence.ts';
import { formatRRule } from '../src/events/rrule.ts';
import {
  type ThirteenRule,
  type ThirteenRuleKind,
  encodeThirteenRule,
  formatThirteenRuleText,
  formatThirteenRuleUri,
  thirteenRuleFor,
  thirteenRuleRdates,
} from '../src/events/thirteen-rules.ts';
import {
  type AlarmJson,
  type DateJson,
  type ExtraDateJson,
  type LocalJson,
  type OriginalDateJson,
  type RecurrenceJson,
  type ThirteenRuleJson,
  FIXTURE_SERIES_ID,
  alarmJson,
  buildThirteenRules,
  dateJson,
  extraDateJson,
  originalDateJson,
  recurrenceFromJson,
  recurrenceJson,
  repeatEndFromJson,
} from './events-fixtures.ts';
import { intlZoneResolver } from './zone-resolvers.ts';

// ---------------------------------------------------------------------------
// JSON forms (§5.5)
// ---------------------------------------------------------------------------

/** `ExceptionMap`: an original date and where it went (`null`: dropped). */
export interface ExceptionMapJson {
  readonly from: OriginalDateJson;
  readonly to: OriginalDateJson | null;
}
export interface SplitResultJson {
  readonly head: RecurrenceJson | null;
  readonly tail: RecurrenceJson | null;
  readonly overrides: readonly ExceptionMapJson[];
  readonly droppedCount: number;
  readonly dropped: boolean;
}
/** `UntilRewrite` as `{"rule","index","endDate"}`. */
export interface UntilRewriteJson {
  readonly rule: 'rrule' | 'exrule';
  readonly index: number;
  readonly endDate: DateJson;
}
/** One stored rule of a `RecognitionInput`: its canonical text (with `COUNT` or `UNTIL`) and the `UNTIL` in the event's zone. */
export interface RecognitionRuleJson {
  readonly rrule: string;
  readonly until: LocalJson | null;
}
export interface RecognitionInputJson {
  readonly start: LocalJson;
  readonly rrules: readonly RecognitionRuleJson[];
  readonly exrules: readonly RecognitionRuleJson[];
  readonly rdates: readonly ExtraDateJson[];
  readonly exdates: readonly OriginalDateJson[];
  readonly marker: string | null;
}
export interface RecognitionJson {
  readonly recurrence: RecurrenceJson;
  readonly source: Recognition['source'];
  readonly editable: boolean;
  readonly alternatives: readonly ThirteenRuleJson[];
  readonly openEnded: boolean;
  readonly series: string | null;
  readonly part: number | null;
}
/** `RepeatPreset` in the §5.5 field order. */
export interface RepeatPresetJson {
  readonly id: string;
  readonly section: RepeatPreset['section'];
  readonly label: string;
  readonly exchangeSafe: boolean;
  readonly recurrence: RecurrenceJson | null;
}
export interface OverrideInputJson {
  readonly id: string;
  readonly originalDate: DateJson;
  readonly originalMinute: number | null;
  readonly canceled: boolean;
  readonly allDay: boolean;
  readonly start: LocalJson;
  readonly end: LocalJson;
  readonly zone: string | null;
}
export interface SeriesInputJson {
  readonly id: string;
  readonly recurrence: RecurrenceJson | null;
  readonly allDay: boolean;
  readonly start: LocalJson;
  readonly end: LocalJson;
  readonly zone: string | null;
  readonly overrides: readonly OverrideInputJson[];
  /** `SeriesInput.duration`, `null` when absent. */
  readonly duration: { readonly days: number; readonly minutes: number } | null;
}
export interface ExpandedOccurrenceJson {
  readonly originalDate: DateJson;
  readonly originalMinute: number | null;
  readonly overrideId: string | null;
  readonly allDay: boolean;
  readonly start: LocalJson;
  readonly end: LocalJson;
  readonly startUtc: LocalJson | null;
}
export interface DeviceWindowJson {
  readonly from: LocalJson;
  readonly to: LocalJson;
}

const localJson = (value: LocalDateTime): LocalJson => formatLocalDateTime(value);

export const exceptionMapJson = (map: ExceptionMap): ExceptionMapJson => ({
  from: originalDateJson(map.from),
  to: map.to === null ? null : originalDateJson(map.to),
});

export const splitResultJson = (split: SplitResult): SplitResultJson => ({
  head: split.head === null ? null : recurrenceJson(split.head),
  tail: split.tail === null ? null : recurrenceJson(split.tail),
  overrides: split.overrides.map(exceptionMapJson),
  droppedCount: split.droppedCount,
  dropped: split.dropped,
});

export const untilRewriteJson = (until: UntilRewrite): UntilRewriteJson => ({ rule: until.rule, index: until.index, endDate: dateJson(until.endDate) });

const recognitionRuleJson = (entry: RecognitionInput['rrules'][number]): RecognitionRuleJson => ({
  rrule: formatRRule(entry.rrule),
  until: entry.until === null ? null : localJson(entry.until),
});

export const recognitionInputJson = (input: RecognitionInput): RecognitionInputJson => ({
  start: localJson(input.start),
  rrules: input.rrules.map(recognitionRuleJson),
  exrules: input.exrules.map(recognitionRuleJson),
  rdates: input.rdates.map(extraDateJson),
  exdates: input.exdates.map(originalDateJson),
  marker: input.marker,
});

const recognitionRuleFromJson = (json: RecognitionRuleJson) => ({
  rrule: parseRRule(json.rrule),
  until: json.until === null ? null : parseLocalDateTime(json.until),
});

export const recognitionInputFromJson = (json: RecognitionInputJson): RecognitionInput => ({
  start: parseLocalDateTime(json.start),
  rrules: json.rrules.map(recognitionRuleFromJson),
  exrules: json.exrules.map(recognitionRuleFromJson),
  rdates: json.rdates.map((x) =>
    typeof x === 'string'
      ? { date: parseISODate(x), minute: null, durationMinutes: null }
      : { date: parseISODate(x.date), minute: x.minute, durationMinutes: x.durationMinutes },
  ),
  exdates: json.exdates.map((x) => (typeof x === 'string' ? { date: parseISODate(x), minute: null } : { date: parseISODate(x.date), minute: x.minute })),
  marker: json.marker,
});

export const recognitionJson = (recognition: Recognition): RecognitionJson => ({
  recurrence: recurrenceJson(recognition.recurrence),
  source: recognition.source,
  editable: recognition.editable,
  alternatives: recognition.alternatives.map((rule) => ({ ...rule })),
  openEnded: recognition.openEnded,
  series: recognition.series,
  part: recognition.part,
});

export const presetJson = (preset: RepeatPreset): RepeatPresetJson => ({
  id: preset.id,
  section: preset.section,
  label: preset.label,
  exchangeSafe: preset.exchangeSafe,
  recurrence: preset.recurrence === null ? null : recurrenceJson(preset.recurrence),
});

export const overrideInputJson = (o: OverrideInput): OverrideInputJson => ({
  id: o.id,
  originalDate: dateJson(o.originalDate),
  originalMinute: o.originalMinute,
  canceled: o.canceled,
  allDay: o.allDay,
  start: localJson(o.start),
  end: localJson(o.end),
  zone: o.zone,
});

export const overrideInputFromJson = (json: OverrideInputJson): OverrideInput => ({
  id: json.id,
  originalDate: parseISODate(json.originalDate),
  originalMinute: json.originalMinute,
  canceled: json.canceled,
  allDay: json.allDay,
  start: parseLocalDateTime(json.start),
  end: parseLocalDateTime(json.end),
  zone: json.zone,
});

export const seriesInputJson = (series: SeriesInput): SeriesInputJson => ({
  id: series.id,
  recurrence: series.recurrence === null ? null : recurrenceJson(series.recurrence),
  allDay: series.allDay,
  start: localJson(series.start),
  end: localJson(series.end),
  zone: series.zone,
  overrides: series.overrides.map(overrideInputJson),
  duration: series.duration === undefined || series.duration === null ? null : { days: series.duration.days, minutes: series.duration.minutes },
});

export const seriesInputFromJson = (json: SeriesInputJson): SeriesInput => ({
  id: json.id,
  recurrence: json.recurrence === null ? null : recurrenceFromJson(json.recurrence),
  allDay: json.allDay,
  start: parseLocalDateTime(json.start),
  end: parseLocalDateTime(json.end),
  zone: json.zone,
  overrides: json.overrides.map(overrideInputFromJson),
  duration: json.duration === null ? null : { days: json.duration.days, minutes: json.duration.minutes },
});

export const expandedOccurrenceJson = (o: ExpandedOccurrence): ExpandedOccurrenceJson => ({
  originalDate: dateJson(o.originalDate),
  originalMinute: o.originalMinute,
  overrideId: o.overrideId,
  allDay: o.allDay,
  start: localJson(o.start),
  end: localJson(o.end),
  startUtc: o.startUtc === null ? null : localJson(o.startUtc),
});

// ---------------------------------------------------------------------------
// Table helpers
// ---------------------------------------------------------------------------

const D = parseISODate;
const L = parseLocalDateTime;
const never: RepeatEnd = { kind: 'never' };
const count = (n: number): RepeatEnd => ({ kind: 'count', count: n });
const until = (iso: string): RepeatEnd => ({ kind: 'until', date: D(iso) });
const extra = (iso: string, minute: number | null = null, durationMinutes: number | null = null): ExtraDate => ({ date: D(iso), minute, durationMinutes });
const original = (iso: string, minute: number | null = null): OriginalDate => ({ date: D(iso), minute });

interface Parts {
  readonly end?: RepeatEnd;
  readonly extraDates?: readonly ExtraDate[];
  readonly exceptDates?: readonly OriginalDate[];
}
const make = (rule: RepeatRule, parts: Parts = {}): EventRecurrence => ({
  rule,
  end: parts.end ?? never,
  extraDates: parts.extraDates ?? [],
  exceptDates: parts.exceptDates ?? [],
});
/** A Gregorian rule from its text (without `COUNT` and `UNTIL`, which live in `end`). */
const gregorian = (text: string, parts: Parts = {}): EventRecurrence => make({ kind: 'rrule', rrule: parseRRule(text) }, parts);
const thirteen = (rule: ThirteenRule, parts: Parts = {}): EventRecurrence => make({ kind: 'thirteen', rule }, parts);
const dates = (parts: Parts = {}): EventRecurrence => make({ kind: 'dates' }, parts);
const foreign = (
  rules: readonly (readonly [string, RepeatEnd])[],
  exrules: readonly (readonly [string, RepeatEnd])[] = [],
  parts: Parts = {},
): EventRecurrence =>
  make(
    {
      kind: 'foreign',
      rules: rules.map(([text, end]) => ({ rrule: parseRRule(text), end })),
      exrules: exrules.map(([text, end]) => ({ rrule: parseRRule(text), end })),
    },
    parts,
  );

const monthly = (day: number, system: CalendarSystemId = 'ifc'): ThirteenRule => ({ kind: 'monthly', system, day });
const weekly = (weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6, interval: 1 | 2 = 1, system: CalendarSystemId = 'ifc'): ThirteenRule => ({
  kind: 'weekly',
  system,
  weekday,
  interval,
});
const yearly = (month: number, day: number, system: CalendarSystemId = 'ifc'): ThirteenRule => ({ kind: 'yearly', system, month, day });
const intercalary = (id: 'year-day' | 'leap-day', system: CalendarSystemId = 'ifc'): ThirteenRule => ({ kind: 'intercalary', system, id });

const SYSTEMS: readonly CalendarSystemId[] = ['ifc', 'positivist'];

/** The 13-month rule of `kind` made from `start` (as the repeat picker makes it). */
function ruleFrom(kind: ThirteenRuleKind, start: string, system: CalendarSystemId = 'ifc'): ThirteenRule {
  const rule = thirteenRuleFor(kind, D(start), system);
  if (rule === null) throw new RangeError(`No ${kind} rule from ${start} in ${system}`);
  return rule;
}

// ---------------------------------------------------------------------------
// expansions
// ---------------------------------------------------------------------------

/** `expansions` (§5.5): `expandRecurrence(recurrence, start, window, { limit })`. */
export interface ExpansionCase {
  readonly recurrence: RecurrenceJson;
  readonly start: DateJson;
  readonly window: { readonly from: DateJson; readonly to: DateJson };
  readonly limit: number | null;
  readonly occurrences: readonly ExtraDateJson[];
  readonly truncated: boolean;
  readonly unsupported: boolean;
}

/** One `expansions` row, named so tests can find it (the name is not written to the file). */
export interface ExpansionRow {
  readonly name: string;
  readonly recurrence: EventRecurrence;
  readonly start: string;
  readonly window: readonly [from: string, to: string];
  readonly limit?: number;
}

/** The three windows the `thirteenRules` cases are expanded over (§5.5). */
export const THIRTEEN_WINDOWS: readonly (readonly [string, string])[] = [
  ['2024-01-01', '2026-12-31'],
  ['2099-01-01', '2101-12-31'],
  ['9998-01-01', '9999-12-31'],
];

/**
 * The window a `thirteenRules` case is expanded over: the first of
 * {@link THIRTEEN_WINDOWS} that holds one of its occurrences, or, for a
 * series that ends outside all three (a count or until in 2028, 2020, year 1
 * or 9990), the years from its start through its last occurrence.
 */
export function thirteenExpansionWindow(recurrence: EventRecurrence, start: string): readonly [string, string] {
  const holds = (window: readonly [string, string]) =>
    expandRecurrence(recurrence, D(start), { from: D(window[0]), to: D(window[1]) }).occurrences.length > 0;
  const window = THIRTEEN_WINDOWS.find(holds);
  if (window !== undefined) return window;
  const all = expandRecurrence(recurrence, D(start), { from: D(start), to: D('9999-12-31') }).occurrences;
  const last = all[all.length - 1]!.date.year;
  return [`${start.slice(0, 4)}-01-01`, `${String(last).padStart(4, '0')}-12-31`];
}

/**
 * Every `thirteenRules` case with its `RDATE` end (never, a count or an
 * until) over {@link thirteenExpansionWindow}, so every case shows
 * occurrences. Every fourth case also excludes its first date after the
 * start (a count still counts it).
 */
function thirteenExpansionRows(): ExpansionRow[] {
  return buildThirteenRules().map((c, i) => {
    const start = D(c.start);
    let recurrence = thirteen(c.rule, { end: repeatEndFromJson(c.rdates.end) });
    if (i % 4 === 0) {
      const [first] = nextOccurrences(recurrence, start, 1);
      if (first !== undefined) recurrence = { ...recurrence, exceptDates: [{ date: first, minute: null }] };
    }
    return { name: `thirteen ${c.marker} from ${c.start}`, recurrence, start: c.start, window: thirteenExpansionWindow(recurrence, c.start) };
  });
}

/**
 * Weekly and yearly 13-month rules over the later windows (the 2100 window,
 * which has no Leap Day, and the last two years), and leap-only repeats whose
 * end or window reaches past their cap (§4.3 c: they stop there, as their
 * stored `FREQ=YEARLY;INTERVAL=4;UNTIL={cap}` does).
 */
function lateThirteenExpansionRows(): ExpansionRow[] {
  const [, century, last] = THIRTEEN_WINDOWS as readonly (readonly [string, string])[];
  return [
    { name: 'late IFC weekly Thursday', recurrence: thirteen(ruleFrom('weekly', '2026-10-19')), start: '2026-10-19', window: century! },
    { name: 'late Positivist every 2 weeks', recurrence: thirteen(ruleFrom('biweekly', '2026-10-21', 'positivist')), start: '2026-10-21', window: century! },
    { name: 'late IFC yearly March 4', recurrence: thirteen(ruleFrom('yearly', '2026-03-01')), start: '2026-03-01', window: century! },
    { name: 'last Positivist weekly Friday', recurrence: thirteen(ruleFrom('weekly', '2026-10-19', 'positivist')), start: '2026-10-19', window: last! },
    { name: 'last Positivist yearly Bichat 28', recurrence: thirteen(ruleFrom('yearly', '2026-12-30', 'positivist')), start: '2026-12-30', window: last! },
    { name: 'Leap Day past the cap', recurrence: thirteen(intercalary('leap-day')), start: '2024-06-17', window: ['2090-01-01', '2110-12-31'] },
    {
      name: 'Holy Women count past the cap',
      recurrence: thirteen(intercalary('leap-day', 'positivist'), { end: count(30) }),
      start: '2088-12-31',
      window: ['2088-01-01', '2110-12-31'],
    },
  ];
}

/** The Gregorian, date-list and foreign rows of §5.5, in its order. */
function gregorianExpansionRows(): ExpansionRow[] {
  const october = ['2026-10-01', '2026-12-31'] as const;
  return [
    { name: 'daily interval 3 until', recurrence: gregorian('FREQ=DAILY;INTERVAL=3', { end: until('2026-11-30') }), start: '2026-10-19', window: october },
    { name: 'weekly MO,WE,FR', recurrence: gregorian('FREQ=WEEKLY;BYDAY=MO,WE,FR'), start: '2026-10-19', window: ['2026-10-01', '2026-11-15'] },
    {
      name: 'RFC WKST=MO',
      recurrence: gregorian('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;WKST=MO', { end: count(4) }),
      start: '1997-08-05',
      window: ['1997-08-01', '1997-12-31'],
    },
    {
      name: 'RFC WKST=SU',
      recurrence: gregorian('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;WKST=SU', { end: count(4) }),
      start: '1997-08-05',
      window: ['1997-08-01', '1997-12-31'],
    },
    { name: 'monthly on the 31st', recurrence: gregorian('FREQ=MONTHLY;BYMONTHDAY=31'), start: '2026-01-31', window: ['2026-01-01', '2026-12-31'] },
    { name: 'monthly on the last day', recurrence: gregorian('FREQ=MONTHLY;BYMONTHDAY=-1'), start: '2026-01-31', window: ['2026-01-01', '2026-06-30'] },
    { name: 'monthly second Tuesday', recurrence: gregorian('FREQ=MONTHLY;BYDAY=2TU'), start: '2026-10-13', window: ['2026-10-01', '2027-03-31'] },
    { name: 'monthly last Friday', recurrence: gregorian('FREQ=MONTHLY;BYDAY=-1FR'), start: '2026-10-30', window: ['2026-10-01', '2027-03-31'] },
    {
      name: 'monthly last weekday',
      recurrence: gregorian('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'),
      start: '2026-10-30',
      window: ['2026-10-01', '2027-03-31'],
    },
    { name: 'yearly on February 29', recurrence: gregorian('FREQ=YEARLY'), start: '2024-02-29', window: ['2024-01-01', '2104-12-31'] },
    { name: 'yearly last Sunday of March', recurrence: gregorian('FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU'), start: '2026-03-29', window: ['2026-01-01', '2030-12-31'] },
    { name: 'yearly ISO week 1 Monday', recurrence: gregorian('FREQ=YEARLY;BYWEEKNO=1;BYDAY=MO'), start: '2025-12-29', window: ['2025-12-01', '2030-12-31'] },
    { name: 'yearly day 366', recurrence: gregorian('FREQ=YEARLY;BYYEARDAY=366'), start: '2024-12-31', window: ['2024-01-01', '2040-12-31'] },
    { name: 'yearly day -1', recurrence: gregorian('FREQ=YEARLY;BYYEARDAY=-1'), start: '2026-12-31', window: ['2026-01-01', '2030-12-31'] },
    {
      name: 'start not on the rule',
      recurrence: gregorian('FREQ=WEEKLY;BYDAY=TU', { end: count(3) }),
      start: '2026-10-19',
      window: october,
    },
    {
      name: 'count with an excluded date',
      recurrence: gregorian('FREQ=WEEKLY', { end: count(4), exceptDates: [original('2026-10-26')] }),
      start: '2026-10-19',
      window: october,
    },
    {
      name: 'dates rule',
      recurrence: dates({ extraDates: [extra('2026-12-25'), extra('2026-11-01'), extra('2027-01-01')] }),
      start: '2026-10-19',
      window: october,
    },
    {
      name: 'rule plus extra dates',
      recurrence: gregorian('FREQ=WEEKLY', {
        extraDates: [extra('2026-10-21'), extra('2026-10-26'), extra('2026-10-28', 900), extra('2026-10-30', 540, 120)],
      }),
      start: '2026-10-19',
      window: ['2026-10-01', '2026-10-31'],
    },
    {
      name: 'weekly count 3 plus one RDATE',
      recurrence: gregorian('FREQ=WEEKLY', { end: count(3), extraDates: [extra('2026-12-01')] }),
      start: '2026-10-19',
      window: october,
    },
    {
      name: 'RDATE after the UNTIL',
      recurrence: gregorian('FREQ=WEEKLY', { end: until('2026-11-02'), extraDates: [extra('2026-12-01')] }),
      start: '2026-10-19',
      window: october,
    },
    {
      name: 'RDATE on an EXDATE',
      recurrence: gregorian('FREQ=WEEKLY', { end: count(3), extraDates: [extra('2026-12-01')], exceptDates: [original('2026-12-01')] }),
      start: '2026-10-19',
      window: october,
    },
    {
      name: 'RDATE at 15:00 on a rule day',
      recurrence: gregorian('FREQ=WEEKLY', { end: count(3), extraDates: [extra('2026-10-26', 900)] }),
      start: '2026-10-19',
      window: october,
    },
    {
      name: 'EXDATE at the RDATE time',
      recurrence: gregorian('FREQ=WEEKLY', { end: count(3), extraDates: [extra('2026-10-26', 900)], exceptDates: [original('2026-10-26', 900)] }),
      start: '2026-10-19',
      window: october,
    },
    {
      name: 'EXDATE at the series time',
      recurrence: gregorian('FREQ=WEEKLY', { end: count(3), extraDates: [extra('2026-10-26', 900)], exceptDates: [original('2026-10-26')] }),
      start: '2026-10-19',
      window: october,
    },
    {
      name: 'foreign two RRULEs',
      recurrence: foreign([
        ['FREQ=WEEKLY', count(3)],
        ['FREQ=MONTHLY;BYMONTHDAY=1', count(3)],
      ]),
      start: '2026-10-19',
      window: ['2026-10-01', '2027-03-31'],
    },
    {
      name: 'foreign EXRULE',
      recurrence: foreign([['FREQ=DAILY', count(10)]], [['FREQ=WEEKLY;BYDAY=WE', never]]),
      start: '2026-10-19',
      window: october,
    },
    {
      name: 'daily February 29',
      recurrence: gregorian('FREQ=DAILY;BYMONTH=2;BYMONTHDAY=29'),
      start: '2024-02-29',
      window: ['2024-01-01', '2112-12-31'],
    },
    { name: 'daily day 366', recurrence: gregorian('FREQ=DAILY;BYYEARDAY=366'), start: '2024-12-31', window: ['2024-01-01', '2112-12-31'] },
    { name: 'HOURLY unsupported', recurrence: gregorian('FREQ=HOURLY;INTERVAL=6'), start: '2026-10-19', window: october },
    { name: 'RSCALE unsupported', recurrence: gregorian('FREQ=YEARLY;RSCALE=HEBREW'), start: '2026-10-19', window: october },
    { name: 'impossible rule', recurrence: gregorian('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30'), start: '2026-10-19', window: ['2026-01-01', '2030-12-31'] },
    { name: 'limit truncation', recurrence: gregorian('FREQ=DAILY'), start: '2026-10-19', window: october, limit: 10 },
    { name: 'year 1 IFC monthly', recurrence: thirteen(monthly(1)), start: '0001-01-01', window: ['0001-01-01', '0001-12-31'] },
    { name: 'year 1 Positivist yearly', recurrence: thirteen(yearly(1, 1, 'positivist')), start: '0001-01-01', window: ['0001-01-01', '0004-12-31'] },
    { name: 'year 1 Gregorian yearly', recurrence: gregorian('FREQ=YEARLY'), start: '0001-01-01', window: ['0001-01-01', '0005-12-31'] },
    { name: 'range end daily', recurrence: gregorian('FREQ=DAILY'), start: '9999-12-25', window: ['9999-12-20', '9999-12-31'] },
    { name: 'range end yearly', recurrence: gregorian('FREQ=YEARLY'), start: '9990-12-31', window: ['9990-01-01', '9999-12-31'] },
  ];
}

/** Every `expansions` row: the `thirteenRules` cases and the later 13-month rows, then the Gregorian, date-list and foreign rows. */
export function expansionRows(): ExpansionRow[] {
  return [...thirteenExpansionRows(), ...lateThirteenExpansionRows(), ...gregorianExpansionRows()];
}

export function expansionCase(row: ExpansionRow): ExpansionCase {
  const window = { from: D(row.window[0]), to: D(row.window[1]) };
  const result = expandRecurrence(row.recurrence, D(row.start), window, row.limit === undefined ? undefined : { limit: row.limit });
  return {
    recurrence: recurrenceJson(row.recurrence),
    start: row.start,
    window: { from: row.window[0], to: row.window[1] },
    limit: row.limit ?? null,
    occurrences: result.occurrences.map(extraDateJson),
    truncated: result.truncated,
    unsupported: result.unsupported,
  };
}

/**
 * `expansions` (§5.5): every `thirteenRules` case over its window, with every
 * end and some excluded dates; Gregorian rules from the RFC and the repeat
 * picker; extra and excluded dates at the series' time and at their own;
 * `foreign` rules; the 400-year guard, unsupported and impossible rules; a
 * limit; and the range edges.
 */
export function buildExpansions(): ExpansionCase[] {
  return expansionRows().map(expansionCase);
}

// ---------------------------------------------------------------------------
// endBefore
// ---------------------------------------------------------------------------

/** `endBefore` (§5.5): `endRecurrenceBefore(recurrence, start, date)` and `laterOccurrenceCount(recurrence, start, date)`. */
export interface EndBeforeCase {
  readonly recurrence: RecurrenceJson;
  readonly start: DateJson;
  readonly date: DateJson;
  readonly expected: RecurrenceJson | null;
  readonly later: number | null;
}

const WEEKLY_10 = gregorian('FREQ=WEEKLY', { end: count(10) });
const WEEKLY_UNTIL = gregorian('FREQ=WEEKLY', { end: until('2026-12-21') });

const END_BEFORE: readonly (readonly [EventRecurrence, string, string])[] = [
  // A count series (10 Mondays from October 19): first, middle (5th) and last occurrence.
  [WEEKLY_10, '2026-10-19', '2026-10-19'],
  [WEEKLY_10, '2026-10-19', '2026-11-16'],
  [WEEKLY_10, '2026-10-19', '2026-12-21'],
  // An until series with the same dates.
  [WEEKLY_UNTIL, '2026-10-19', '2026-10-19'],
  [WEEKLY_UNTIL, '2026-10-19', '2026-11-16'],
  [WEEKLY_UNTIL, '2026-10-19', '2026-12-21'],
  // Never ends: no later count.
  [gregorian('FREQ=WEEKLY'), '2026-10-19', '2026-11-16'],
  // A date between occurrences, and the excluded dates on both sides (counted in the head's count, not in later).
  [gregorian('FREQ=WEEKLY', { end: count(10), exceptDates: [original('2026-10-26'), original('2026-11-30')] }), '2026-10-19', '2026-11-18'],
  // 13-month rules: a count of 6 IFC months on the 12th, an until on Year Day, an endless Leap Day.
  [thirteen(monthly(12), { end: count(6) }), '2026-10-19', '2026-10-19'],
  [thirteen(monthly(12), { end: count(6) }), '2026-10-19', '2027-01-12'],
  [thirteen(monthly(12), { end: count(6) }), '2026-10-19', '2027-03-09'],
  [thirteen(intercalary('year-day'), { end: until('2036-12-31') }), '2026-12-31', '2030-12-31'],
  [thirteen(intercalary('leap-day'), { end: count(5) }), '2024-06-17', '2032-06-17'],
  [thirteen(intercalary('leap-day')), '2024-06-17', '2032-06-17'],
  // Extra dates on both sides (the later ones count in `later`).
  [gregorian('FREQ=WEEKLY', { end: count(4), extraDates: [extra('2026-10-21'), extra('2026-11-20', 900)] }), '2026-10-19', '2026-11-02'],
  // A date list.
  [dates({ extraDates: [extra('2026-10-21'), extra('2026-11-04'), extra('2026-12-02')] }), '2026-10-19', '2026-11-04'],
  // Foreign: a COUNT RRULE, an UNTIL RRULE whose own end comes first, and an EXRULE.
  [
    foreign(
      [
        ['FREQ=WEEKLY', count(10)],
        ['FREQ=MONTHLY;BYMONTHDAY=1', until('2026-11-01')],
      ],
      [['FREQ=MONTHLY;BYMONTHDAY=2', until('2027-06-30')]],
    ),
    '2026-10-19',
    '2026-11-23',
  ],
  // Foreign with an endless RRULE: no later count.
  [foreign([['FREQ=WEEKLY', never]], [['FREQ=MONTHLY;BYDAY=1MO', count(3)]]), '2026-10-19', '2026-11-23'],
  // An until that ends before the date: the rule keeps its own end.
  [gregorian('FREQ=DAILY', { end: until('2026-10-25') }), '2026-10-19', '2026-11-01'],
  // A date before the start.
  [WEEKLY_10, '2026-10-19', '2026-10-01'],
];

/** `endBefore` (§5.5): count and until series cut at their first, a middle and the last occurrence, 13-month, date-list and foreign rules. */
export function buildEndBefore(): EndBeforeCase[] {
  return END_BEFORE.map(([recurrence, start, date]) => {
    const head = endRecurrenceBefore(recurrence, D(start), D(date));
    return {
      recurrence: recurrenceJson(recurrence),
      start,
      date,
      expected: head === null ? null : recurrenceJson(head),
      later: laterOccurrenceCount(recurrence, D(start), D(date)),
    };
  });
}

// ---------------------------------------------------------------------------
// splits
// ---------------------------------------------------------------------------

/** `splits` (§5.5): `splitRecurrence(recurrence, start, at, overrideDates, change)`; `expected` null when it throws. */
export interface SplitCase {
  readonly recurrence: RecurrenceJson;
  readonly start: DateJson;
  readonly at: DateJson;
  readonly overrideDates: readonly OriginalDateJson[];
  readonly change: { readonly recurrence: RecurrenceJson | null; readonly start: DateJson; readonly ruleChanged: boolean } | null;
  readonly expected: SplitResultJson | null;
}

interface SplitRow {
  readonly recurrence: EventRecurrence;
  readonly start: string;
  readonly at: string;
  readonly overrides?: readonly OriginalDate[];
  readonly change?: { readonly recurrence: EventRecurrence | null; readonly start: string; readonly ruleChanged: boolean } | null;
}

/** `kept`: the repeat kept from `start` (the user changed something else). */
const kept = (recurrence: EventRecurrence, start: string) => ({ recurrence, start, ruleChanged: false });
const changed = (recurrence: EventRecurrence | null, start: string) => ({ recurrence, start, ruleChanged: true });

function splitRows(): SplitRow[] {
  const withExceptions = gregorian('FREQ=WEEKLY', { end: count(10), exceptDates: [original('2026-10-26'), original('2026-11-23')] });
  const ifc12 = thirteen(monthly(12), { end: count(8), exceptDates: [original('2027-02-09')] });
  const extras = gregorian('FREQ=WEEKLY', { end: count(6), extraDates: [extra('2026-10-21'), extra('2026-11-18'), extra('2026-11-20', 900)] });
  const foreignRule = foreign(
    [
      ['FREQ=WEEKLY', count(10)],
      ['FREQ=MONTHLY;BYMONTHDAY=1', until('2027-06-30')],
    ],
    [['FREQ=MONTHLY;BYDAY=1MO', never]],
  );
  return [
    // COUNT=10 split at its 4th occurrence: repeat kept (7 left) and a new repeat.
    { recurrence: WEEKLY_10, start: '2026-10-19', at: '2026-11-09', change: kept(WEEKLY_10, '2026-11-09') },
    { recurrence: WEEKLY_10, start: '2026-10-19', at: '2026-11-09', change: changed(gregorian('FREQ=DAILY', { end: count(3) }), '2026-11-09') },
    // An UNTIL series, repeat kept.
    { recurrence: WEEKLY_UNTIL, start: '2026-10-19', at: '2026-11-09', change: kept(WEEKLY_UNTIL, '2026-11-09') },
    // EXDATEs before (stays in the head) and after (carried); an override after with only the time changed (carried).
    {
      recurrence: withExceptions,
      start: '2026-10-19',
      at: '2026-11-09',
      overrides: [original('2026-11-09'), original('2026-11-30')],
      change: kept(withExceptions, '2026-11-09'),
    },
    // The start moved 2 days: the tail produces the shifted dates (carried).
    {
      recurrence: withExceptions,
      start: '2026-10-19',
      at: '2026-11-09',
      overrides: [original('2026-11-30')],
      change: kept(gregorian('FREQ=WEEKLY', { end: count(10) }), '2026-11-11'),
    },
    // The start moved 2 days with a new monthly repeat: the shifted date is not produced (dropped, counted once).
    {
      recurrence: WEEKLY_10,
      start: '2026-10-19',
      at: '2026-11-09',
      overrides: [original('2026-11-30')],
      change: changed(gregorian('FREQ=MONTHLY'), '2026-11-11'),
    },
    // At the second and at the last occurrence.
    { recurrence: WEEKLY_10, start: '2026-10-19', at: '2026-10-26', change: kept(WEEKLY_10, '2026-10-26') },
    { recurrence: WEEKLY_10, start: '2026-10-19', at: '2026-12-21', change: kept(WEEKLY_10, '2026-12-21') },
    // At the first occurrence (no head).
    { recurrence: WEEKLY_10, start: '2026-10-19', at: '2026-10-19', change: kept(WEEKLY_10, '2026-10-19') },
    // Delete all future events (no tail), and the repeat set to Never (no tail).
    { recurrence: withExceptions, start: '2026-10-19', at: '2026-11-09', overrides: [original('2026-11-16')], change: null },
    { recurrence: withExceptions, start: '2026-10-19', at: '2026-11-09', overrides: [original('2026-11-16')], change: changed(null, '2026-11-09') },
    // A 13-month rule, repeat kept and the date moved one IFC month day (to the 13th: dates shift by one day).
    { recurrence: ifc12, start: '2026-10-19', at: '2026-12-14', overrides: [original('2027-01-12')], change: kept(ifc12, '2026-12-14') },
    { recurrence: ifc12, start: '2026-10-19', at: '2026-12-14', overrides: [original('2027-01-12')], change: kept(thirteen(monthly(13), { end: count(8) }), '2026-12-15') },
    // An RDATE series: a new repeat works, keeping it throws.
    {
      recurrence: dates({ extraDates: [extra('2026-10-26'), extra('2026-11-09'), extra('2026-11-23')] }),
      start: '2026-10-19',
      at: '2026-11-09',
      change: changed(gregorian('FREQ=WEEKLY'), '2026-11-09'),
    },
    {
      recurrence: dates({ extraDates: [extra('2026-10-26'), extra('2026-11-09'), extra('2026-11-23')] }),
      start: '2026-10-19',
      at: '2026-11-09',
      change: kept(dates(), '2026-11-09'),
    },
    // Extra dates on both sides with a new repeat; keeping such a rule throws.
    { recurrence: extras, start: '2026-10-19', at: '2026-11-09', change: changed(gregorian('FREQ=WEEKLY'), '2026-11-09') },
    { recurrence: extras, start: '2026-10-19', at: '2026-11-09', change: kept(extras, '2026-11-09') },
    // Foreign: a new repeat (each rule gets its own head end) and the repeat kept (throws).
    { recurrence: foreignRule, start: '2026-10-19', at: '2026-11-16', overrides: [original('2026-12-01')], change: changed(gregorian('FREQ=WEEKLY'), '2026-11-16') },
    { recurrence: foreignRule, start: '2026-10-19', at: '2026-11-16', change: kept(foreignRule, '2026-11-16') },
    // A kept count that the split has used up (throws).
    { recurrence: gregorian('FREQ=WEEKLY', { end: count(3) }), start: '2026-10-19', at: '2026-11-09', change: kept(gregorian('FREQ=WEEKLY', { end: count(3) }), '2026-11-09') },
  ];
}

/** `splits` (§5.5): every case of the §5.5 list, including the ones that throw. */
export function buildSplits(): SplitCase[] {
  return splitRows().map((row) => {
    const overrides = row.overrides ?? [];
    const change = row.change ?? null;
    let expected: SplitResultJson | null;
    try {
      expected = splitResultJson(
        splitRecurrence(
          row.recurrence,
          D(row.start),
          D(row.at),
          overrides,
          change === null ? null : { recurrence: change.recurrence, start: D(change.start), ruleChanged: change.ruleChanged },
        ),
      );
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      expected = null;
    }
    return {
      recurrence: recurrenceJson(row.recurrence),
      start: row.start,
      at: row.at,
      overrideDates: overrides.map(originalDateJson),
      change:
        change === null
          ? null
          : { recurrence: change.recurrence === null ? null : recurrenceJson(change.recurrence), start: change.start, ruleChanged: change.ruleChanged },
      expected,
    };
  });
}

// ---------------------------------------------------------------------------
// retimes
// ---------------------------------------------------------------------------

/** `retimes` (§5.5): `retimeExceptions(recurrence, overrideDates, oldStart, newStart, newRecurrence, { minuteDelta, allDay })`. */
export interface RetimeCase {
  readonly recurrence: RecurrenceJson;
  readonly overrideDates: readonly OriginalDateJson[];
  readonly oldStart: DateJson;
  readonly newStart: DateJson;
  readonly newRecurrence: RecurrenceJson;
  readonly minuteDelta: number | null;
  readonly allDay: 'to-all-day' | 'to-timed' | null;
  readonly expected: {
    readonly recurrence: RecurrenceJson;
    readonly overrides: readonly ExceptionMapJson[];
    readonly untils: readonly UntilRewriteJson[];
    readonly droppedCount: number;
    readonly dropped: boolean;
  };
}

interface RetimeRow {
  readonly recurrence: EventRecurrence;
  readonly overrides: readonly OriginalDate[];
  readonly oldStart: string;
  readonly newStart?: string;
  /** Defaults to `recurrence` without its extra and excluded dates. */
  readonly newRecurrence?: EventRecurrence;
  readonly minuteDelta?: number;
  readonly allDay?: 'to-all-day' | 'to-timed';
}

const bare = (recurrence: EventRecurrence): EventRecurrence => ({ ...recurrence, extraDates: [], exceptDates: [] });

function retimeRows(): RetimeRow[] {
  const weeklyExceptions = gregorian('FREQ=WEEKLY', { end: until('2026-12-21'), exceptDates: [original('2026-10-26'), original('2026-11-23')] });
  const mwf = gregorian('FREQ=WEEKLY;BYDAY=MO,WE,FR', { exceptDates: [original('2026-10-21'), original('2026-10-26')] });
  const ifc12 = thirteen(monthly(12), { exceptDates: [original('2026-12-14'), original('2027-02-09')] });
  const ifcThursday = thirteen(weekly(4), { exceptDates: [original('2026-10-26')] });
  const ownTime = gregorian('FREQ=WEEKLY', {
    extraDates: [extra('2026-10-21', 1410, 30), extra('2026-10-28', 900)],
    exceptDates: [original('2026-10-21', 1410), original('2026-11-02')],
  });
  const mixed = gregorian('FREQ=WEEKLY', {
    end: until('2026-12-21'),
    extraDates: [extra('2026-10-26', 900), extra('2026-10-28', 900), extra('2026-10-30')],
    exceptDates: [original('2026-11-02'), original('2026-10-28', 900)],
  });
  const allDayDates = gregorian('FREQ=WEEKLY', {
    end: until('2026-12-21'),
    extraDates: [extra('2026-10-28'), extra('2026-10-30', null, 2880)],
    exceptDates: [original('2026-11-02'), original('2026-10-28')],
  });
  const foreignUntils = foreign(
    [
      ['FREQ=WEEKLY', count(10)],
      ['FREQ=MONTHLY;BYMONTHDAY=1', until('2027-06-30')],
    ],
    [['FREQ=MONTHLY;BYDAY=1MO', until('2027-03-31')]],
    { exceptDates: [original('2026-11-02')] },
  );
  return [
    // Time only (dates kept), Gregorian and 13-month.
    { recurrence: weeklyExceptions, overrides: [original('2026-11-02'), original('2026-11-09')], oldStart: '2026-10-19', minuteDelta: 30 },
    { recurrence: ifc12, overrides: [original('2027-01-12')], oldStart: '2026-10-19', minuteDelta: -60 },
    // Date moved within the rule (shifted).
    {
      recurrence: weeklyExceptions,
      overrides: [original('2026-11-02')],
      oldStart: '2026-10-19',
      newStart: '2026-10-20',
      newRecurrence: gregorian('FREQ=WEEKLY', { end: until('2026-12-22') }),
    },
    { recurrence: ifc12, overrides: [original('2027-01-12')], oldStart: '2026-10-19', newStart: '2026-10-20', newRecurrence: thirteen(monthly(13)) },
    { recurrence: ifcThursday, overrides: [original('2026-11-02')], oldStart: '2026-10-19', newStart: '2026-10-21', newRecurrence: thirteen(weekly(6)) },
    // Date moved off the rule (dropped and counted).
    { recurrence: mwf, overrides: [original('2026-10-23')], oldStart: '2026-10-19', newStart: '2026-10-20', newRecurrence: bare(mwf) },
    { recurrence: ifc12, overrides: [original('2027-01-12')], oldStart: '2026-10-19', newStart: '2026-10-20', newRecurrence: thirteen(ruleFrom('yearly', '2026-10-20')) },
    // An orphan override (on no occurrence) is dropped.
    { recurrence: weeklyExceptions, overrides: [original('2026-11-03')], oldStart: '2026-10-19', minuteDelta: 15 },
    // Own-time extra dates shifted with the start (one across midnight), with an EXDATE and an override on them.
    { recurrence: ownTime, overrides: [original('2026-10-28', 900), original('2026-11-09')], oldStart: '2026-10-19', minuteDelta: 30 },
    { recurrence: ownTime, overrides: [original('2026-10-21', 1410)], oldStart: '2026-10-19', minuteDelta: -90 },
    // Timed to all-day: values become dates; an extra date on a rule date is dropped with its exceptions.
    {
      recurrence: mixed,
      overrides: [original('2026-10-26', 900), original('2026-11-09'), original('2026-10-30')],
      oldStart: '2026-10-19',
      allDay: 'to-all-day',
    },
    // All-day to timed: every value at the new start time.
    { recurrence: allDayDates, overrides: [original('2026-10-30'), original('2026-11-16')], oldStart: '2026-10-19', allDay: 'to-timed' },
    // untils: an all-day toggle of an UNTIL series in both directions.
    { recurrence: bare(weeklyExceptions), overrides: [], oldStart: '2026-10-19', allDay: 'to-all-day' },
    { recurrence: bare(weeklyExceptions), overrides: [], oldStart: '2026-10-19', allDay: 'to-timed' },
    // Outlook's UNTIL=20261116T170000Z on a 19:00 Tallinn weekly series (end date November 16) moved to 19:30.
    { recurrence: gregorian('FREQ=WEEKLY', { end: until('2026-11-16') }), overrides: [original('2026-11-16')], oldStart: '2026-10-19', minuteDelta: 30 },
    // A foreign rule whose RRULE and EXRULE both have an UNTIL (one entry each, in stored order).
    { recurrence: foreignUntils, overrides: [original('2026-11-09')], oldStart: '2026-10-19', minuteDelta: 60 },
    // A COUNT rule (no entry) and a never rule (no entry).
    { recurrence: WEEKLY_10, overrides: [original('2026-11-09')], oldStart: '2026-10-19', minuteDelta: 30 },
    { recurrence: thirteen(monthly(12)), overrides: [], oldStart: '2026-10-19', minuteDelta: 30 },
    // A 13-month leap-interval rule: its encoding's UNTIL is the cap.
    { recurrence: thirteen(intercalary('leap-day'), { exceptDates: [original('2028-06-17')] }), overrides: [], oldStart: '2024-06-17', allDay: 'to-timed' },
    // A 13-month rule with an until end, moved to a new date within the rule.
    {
      recurrence: thirteen(monthly(12), { end: until('2027-06-30'), exceptDates: [original('2026-11-16')] }),
      overrides: [original('2027-01-12')],
      oldStart: '2026-10-19',
      newStart: '2026-11-16',
      newRecurrence: thirteen(monthly(12), { end: until('2027-06-30') }),
    },
  ];
}

/** `retimes` (§5.5): time-only, date and all-day changes of Gregorian, 13-month and foreign series, and every `untils` case. */
export function buildRetimes(): RetimeCase[] {
  return retimeRows().map((row) => {
    const newStart = row.newStart ?? row.oldStart;
    const newRecurrence = row.newRecurrence ?? bare(row.recurrence);
    const options = { ...(row.minuteDelta === undefined ? {} : { minuteDelta: row.minuteDelta }), ...(row.allDay === undefined ? {} : { allDay: row.allDay }) };
    const result = retimeExceptions(row.recurrence, row.overrides, D(row.oldStart), D(newStart), newRecurrence, options);
    return {
      recurrence: recurrenceJson(row.recurrence),
      overrideDates: row.overrides.map(originalDateJson),
      oldStart: row.oldStart,
      newStart,
      newRecurrence: recurrenceJson(newRecurrence),
      minuteDelta: row.minuteDelta ?? null,
      allDay: row.allDay ?? null,
      expected: {
        recurrence: recurrenceJson(result.recurrence),
        overrides: result.overrides.map(exceptionMapJson),
        untils: result.untils.map(untilRewriteJson),
        droppedCount: result.droppedCount,
        dropped: result.dropped,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// recognitions
// ---------------------------------------------------------------------------

/** `recognitions` (§5.5): `recognizeRecurrence(input, system)`. */
export interface RecognitionCase {
  readonly input: RecognitionInputJson;
  readonly system: CalendarSystemId;
  readonly expected: RecognitionJson;
}

interface RecognitionRow {
  readonly start: string;
  readonly rrules?: readonly (string | readonly [string, string])[];
  readonly exrules?: readonly string[];
  readonly rdates?: readonly ExtraDate[];
  readonly exdates?: readonly OriginalDate[];
  readonly marker?: string | null;
  readonly system?: CalendarSystemId;
}

/** A stored rule; `[text, until]` gives the `UNTIL` already in the event's zone. */
const storedRule = (entry: string | readonly [string, string]) =>
  typeof entry === 'string' ? { rrule: parseRRule(entry), until: null } : { rrule: parseRRule(entry[0]), until: L(entry[1]) };

/** A form (b) list read back in another order with one value repeated, as Apple may write it. */
function shuffledYearDays(rule: ThirteenRule, start: string): string {
  const text = formatRRule(encodeThirteenRule(rule, D(start)).rrule);
  if (!text.includes('BYYEARDAY=')) throw new RangeError(`${text} is not a day-of-year list`);
  const values = text.split('BYYEARDAY=')[1]!.split(';')[0]!.split(',');
  const half = Math.floor(values.length / 2);
  return `FREQ=YEARLY;BYYEARDAY=${[...values.slice(half), values[0]!, ...values.slice(0, half).reverse()].join(',')}`;
}

const rdateList = (rule: ThirteenRule, start: string, end: RepeatEnd, horizon: string, maxValues = 400): ExtraDate[] =>
  thirteenRuleRdates(rule, D(start), end, D(horizon), { maxValues }).dates.map((date) => ({ date, minute: null, durationMinutes: null }));

function recognitionRows(): RecognitionRow[] {
  const rows: RecognitionRow[] = [];
  // Apple-style BYYEARDAY lists (form b), shuffled and with a duplicate. IFC yearly dates after Leap Day are
  // form (a) (a plain yearly rule), so only the IFC ones from March to June 28 are lists; so is IFC Year Day.
  const lists: readonly (readonly [ThirteenRuleKind, string, CalendarSystemId])[] = [
    ['monthly', '2026-01-01', 'ifc'],
    ['monthly', '2026-10-19', 'ifc'],
    ['monthly', '2026-01-28', 'ifc'],
    ['monthly', '2026-01-01', 'positivist'],
    ['monthly', '2026-10-19', 'positivist'],
    ['monthly', '2026-01-28', 'positivist'],
    ['weekly', '2026-10-19', 'ifc'],
    ['weekly', '2026-10-22', 'ifc'],
    ['weekly', '2026-10-19', 'positivist'],
    ['weekly', '2026-10-24', 'positivist'],
    ['biweekly', '2026-10-19', 'ifc'],
    ['biweekly', '2026-10-28', 'positivist'],
    ['yearly', '2026-03-04', 'ifc'],
    ['yearly', '2026-06-17', 'ifc'],
    ['yearly', '2026-03-04', 'positivist'],
    ['yearly', '2026-10-19', 'positivist'],
    ['yearly', '2026-12-30', 'positivist'],
    ['intercalary', '2026-12-31', 'positivist'],
  ];
  for (const [kind, start, system] of lists) {
    rows.push({ start: `${start}T19:00`, rrules: [shuffledYearDays(ruleFrom(kind, start, system), start)], system });
  }
  rows.push(
    // Single positive values up to 168, in both systems (preferred first, the other listed).
    { start: '2026-01-12T00:00', rrules: ['FREQ=YEARLY;BYYEARDAY=12'] },
    { start: '2026-01-12T00:00', rrules: ['FREQ=YEARLY;BYYEARDAY=12'], system: 'positivist' },
    { start: '2026-06-17T09:00', rrules: ['FREQ=YEARLY;BYYEARDAY=168;COUNT=5'] },
    // Negative singles.
    { start: '2026-12-31T00:00', rrules: ['FREQ=YEARLY;BYYEARDAY=-1'] },
    { start: '2026-12-31T00:00', rrules: ['FREQ=YEARLY;BYYEARDAY=-1'], system: 'positivist' },
    // INTERVAL=4 Leap Day: never (until on the cap), an end before the cap, and one past it.
    { start: '2024-06-17T00:00', rrules: ['FREQ=YEARLY;INTERVAL=4;UNTIL=20960617'] },
    { start: '2024-06-17T00:00', rrules: ['FREQ=YEARLY;INTERVAL=4;COUNT=3'] },
    { start: '2024-12-31T00:00', rrules: ['FREQ=YEARLY;INTERVAL=4;UNTIL=20501231'], system: 'positivist' },
    { start: '2024-06-17T00:00', rrules: ['FREQ=YEARLY;INTERVAL=4;UNTIL=21000617'] },
    // A Leap Day marker with an UNTIL past the cap (another app extended it): not trusted, the stored rule has 2100-06-17.
    { start: '2088-06-17T00:00', rrules: ['FREQ=YEARLY;INTERVAL=4;UNTIL=21080617'], marker: formatThirteenRuleText(intercalary('leap-day')) },
    // A list of Leap Days past the cap is a list of dates.
    { start: '2088-06-17T00:00', rdates: [extra('2092-06-17'), extra('2096-06-17'), extra('2104-06-17')] },
    // Plain yearly on invariant dates (a 13-month alternative) and on a date whose 13-month rule differs.
    { start: '2026-01-01T09:00', rrules: ['FREQ=YEARLY'] },
    { start: '2026-12-31T00:00', rrules: ['FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=31'] },
    { start: '2026-02-14T09:00', rrules: ['FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=14'], system: 'positivist' },
    { start: '2026-10-19T09:00', rrules: ['FREQ=YEARLY'] },
    // Presets in minimal and explicit forms.
    { start: '2026-10-19T19:00', rrules: ['FREQ=WEEKLY'] },
    { start: '2026-10-19T19:00', rrules: ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;WKST=SU'] },
    { start: '2026-10-19T19:00', rrules: ['FREQ=MONTHLY;BYMONTHDAY=19'] },
    { start: '2026-10-19T19:00', rrules: ['FREQ=DAILY;COUNT=10'] },
  );
  // Android RDATE lists (form d) of every IFC Thursday from October 19, 2026.
  const thursday = weekly(4);
  const uri = (end: RepeatEnd, part: number | null = null) => formatThirteenRuleUri(thursday, end, { series: part === null ? null : FIXTURE_SERIES_ID, part });
  const complete = rdateList(thursday, '2026-10-19', never, '2027-01-31');
  rows.push(
    { start: '2026-10-19T19:00', rdates: complete },
    { start: '2026-10-19T19:00', rdates: complete.filter((x) => toISODate(x.date) !== '2026-11-30'), exdates: [original('2026-11-30')] },
    { start: '2026-10-19T19:00', rdates: complete.filter((x) => toISODate(x.date) !== '2026-11-30') },
    { start: '2026-10-19T19:00', rdates: complete, marker: uri(never) },
    // Written under an older horizon, then read with the marker.
    { start: '2026-10-19T19:00', rdates: rdateList(thursday, '2026-10-19', never, '2026-12-31'), marker: uri(never) },
    // An endless monthly list truncated at 400 values.
    { start: '2026-10-19T19:00', rdates: rdateList(monthly(12), '2026-10-19', never, '9999-12-31'), marker: formatThirteenRuleUri(monthly(12), never) },
    // The second part of a series: it starts at its own first date.
    { start: '2027-07-01T19:00', rdates: rdateList(thursday, '2027-07-01', never, '2027-12-31'), marker: uri(never, 2) },
    // A count series with its X-THIRTEEN-RULE marker (end until the last date).
    { start: '2026-10-19T19:00', rdates: rdateList(thursday, '2026-10-19', count(5), '9999-12-31'), marker: formatThirteenRuleText(thursday) },
  );
  rows.push(
    // UNTIL one second before an occurrence: the end date is the day before it.
    { start: '2026-10-19T19:00', rrules: [['FREQ=WEEKLY;UNTIL=20261116T165959Z', '2026-11-16T18:59']] },
    // An EXDATE at the start's minute (minute null) and one at an own-time RDATE's minute (kept).
    {
      start: '2026-10-19T19:00',
      rrules: ['FREQ=WEEKLY'],
      rdates: [extra('2026-10-28', 900)],
      exdates: [original('2026-10-26', 1140), original('2026-10-28', 900)],
    },
    // A marker that agrees with the rule, and one that disagrees (ignored).
    { start: '2026-10-19T19:00', rrules: [formatRRule(encodeThirteenRule(monthly(12), D('2026-10-19')).rrule)], marker: formatThirteenRuleText(monthly(12)) },
    { start: '2026-10-19T19:00', rrules: ['FREQ=WEEKLY'], marker: formatThirteenRuleText(monthly(12)) },
    // A rule with extra RDATEs: extra dates, not editable.
    { start: '2026-10-19T19:00', rrules: ['FREQ=WEEKLY;COUNT=4'], rdates: [extra('2026-10-21'), extra('2026-10-30', 600, 90)] },
    // Foreign rules: BYWEEKNO, two RRULEs, an EXRULE, HOURLY.
    { start: '2026-05-11T19:00', rrules: ['FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO'] },
    { start: '2026-10-19T19:00', rrules: ['FREQ=WEEKLY;COUNT=3', 'FREQ=MONTHLY;BYMONTHDAY=1'] },
    { start: '2026-10-19T19:00', rrules: ['FREQ=DAILY'], exrules: ['FREQ=WEEKLY;BYDAY=SA,SU'] },
    { start: '2026-10-19T19:00', rrules: ['FREQ=HOURLY;INTERVAL=8'] },
    // No rule at all: a date list.
    { start: '2026-10-19T19:00', rdates: [extra('2026-11-02'), extra('2027-03-14', 600)] },
  );
  return rows;
}

/** `recognitions` (§5.5): every recognition step and source, in both systems. */
export function buildRecognitions(): RecognitionCase[] {
  return recognitionRows().map((row) => {
    const input: RecognitionInput = {
      start: L(row.start),
      rrules: (row.rrules ?? []).map(storedRule),
      exrules: (row.exrules ?? []).map(storedRule),
      rdates: row.rdates ?? [],
      exdates: row.exdates ?? [],
      marker: row.marker ?? null,
    };
    const system = row.system ?? 'ifc';
    return { input: recognitionInputJson(input), system, expected: recognitionJson(recognizeRecurrence(input, system)) };
  });
}

// ---------------------------------------------------------------------------
// presets, descriptions, nextOccurrences, repeatNotes
// ---------------------------------------------------------------------------

/** `presets` (§5.5): `repeatPresets(start, system)`. */
export interface PresetsCase {
  readonly start: DateJson;
  readonly system: CalendarSystemId;
  readonly presets: readonly RepeatPresetJson[];
}

/** The starts of the `presets` and `nextOccurrences` cases (§5.5). */
export const PRESET_STARTS: readonly string[] = [
  '2026-10-19',
  '2026-01-31',
  '2024-02-29',
  '2024-06-17',
  '2026-12-31',
  '2024-12-30',
  '2024-12-31',
  '2026-06-18',
];

/** `presets` (§5.5): every start in both systems (month days, February 29, Year Day, Leap Day, the Positivist festivals, Sol 1). */
export function buildPresets(): PresetsCase[] {
  return PRESET_STARTS.flatMap((start) =>
    SYSTEMS.map((system) => ({ start, system, presets: repeatPresets(D(start), system).map(presetJson) })),
  );
}

/** `descriptions` (§5.5): `describeRecurrence(recurrence, start, system)`. */
export interface DescriptionCase {
  readonly recurrence: RecurrenceJson;
  readonly start: DateJson;
  readonly system: CalendarSystemId;
  readonly text: string;
}

function descriptionRows(): (readonly [EventRecurrence, string, CalendarSystemId?])[] {
  const ends: readonly Parts[] = [{}, { end: count(1) }, { end: count(10) }, { end: until('2036-12-12') }];
  const rows: (readonly [EventRecurrence, string, CalendarSystemId?])[] = [];
  // Gregorian rows of the grammar, without an end and with one of each kind.
  const gregorianRows: readonly (readonly [string, string])[] = [
    ['FREQ=DAILY', '2026-10-19'],
    ['FREQ=DAILY;INTERVAL=3', '2026-10-19'],
    ['FREQ=WEEKLY', '2026-10-19'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', '2026-10-20'],
    ['FREQ=WEEKLY;BYDAY=MO,WE,FR', '2026-10-19'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-10-19'],
    ['FREQ=WEEKLY;BYDAY=SA,SU', '2026-10-24'],
    ['FREQ=MONTHLY', '2026-10-19'],
    ['FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1,15', '2026-10-01'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', '2026-10-31'],
    ['FREQ=MONTHLY;BYDAY=2TU', '2026-10-13'],
    ['FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '2026-10-30'],
    ['FREQ=MONTHLY;BYDAY=SA,SU;BYSETPOS=1', '2026-10-03'],
    ['FREQ=YEARLY', '2026-10-19'],
    ['FREQ=YEARLY;INTERVAL=2', '2026-10-19'],
    ['FREQ=YEARLY;BYMONTH=3,9;BYMONTHDAY=1', '2026-03-01'],
    ['FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', '2026-03-29'],
  ];
  gregorianRows.forEach(([text, start], i) => rows.push([gregorian(text, ends[i % ends.length]), start]));
  // 13-month rows, both systems, with and without ends.
  const thirteenRows: readonly (readonly [ThirteenRuleKind, string, CalendarSystemId])[] = [
    ['monthly', '2026-10-19', 'ifc'],
    ['monthly', '2026-10-08', 'positivist'],
    ['weekly', '2026-10-19', 'ifc'],
    ['biweekly', '2026-10-19', 'ifc'],
    ['weekly', '2026-10-23', 'positivist'],
    ['biweekly', '2026-10-23', 'positivist'],
    ['yearly', '2026-10-19', 'ifc'],
    ['yearly', '2026-03-08', 'positivist'],
    ['intercalary', '2026-12-31', 'ifc'],
    ['intercalary', '2024-06-17', 'ifc'],
    ['intercalary', '2026-12-31', 'positivist'],
    ['intercalary', '2024-12-31', 'positivist'],
  ];
  for (const [kind, start, system] of thirteenRows) {
    const rule = ruleFrom(kind, start, system);
    rows.push([thirteen(rule), start, system]);
    rows.push([thirteen(rule, { end: until('2036-12-12') }), start, system]);
  }
  rows.push(
    [thirteen(monthly(12), { end: count(1) }), '2026-10-19'],
    [thirteen(ruleFrom('biweekly', '2026-10-19', 'positivist'), { end: count(6) }), '2026-10-19', 'positivist'],
    // The system argument changes only the day names of 13-month until dates, not Gregorian ones.
    [gregorian('FREQ=WEEKLY', { end: until('2026-12-21') }), '2026-10-19', 'positivist'],
    // Custom schedules: dates, foreign and unsupported rules, a rule the grammar has no row for.
    [dates({ extraDates: [extra('2026-11-02')] }), '2026-10-19'],
    [foreign([['FREQ=WEEKLY', never]], [['FREQ=MONTHLY;BYDAY=1MO', never]]), '2026-10-19'],
    [gregorian('FREQ=HOURLY'), '2026-10-19'],
    [gregorian('FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO'), '2026-05-11'],
    // Extra dates: one and several, after the end.
    [gregorian('FREQ=WEEKLY', { extraDates: [extra('2026-10-21')] }), '2026-10-19'],
    [gregorian('FREQ=WEEKLY', { end: count(5), extraDates: [extra('2026-10-21'), extra('2026-10-30', 600)] }), '2026-10-19'],
    [thirteen(monthly(12), { end: until('2027-06-30'), extraDates: [extra('2026-12-24')] }), '2026-10-19'],
    // Year 1: a Positivist until date in display year -1787.
    [thirteen(yearly(1, 1, 'positivist'), { end: until('0001-01-01') }), '0001-01-01', 'positivist'],
    [thirteen(yearly(1, 1, 'positivist'), { end: until('0001-12-31') }), '0001-01-01', 'positivist'],
    [thirteen(monthly(1), { end: until('0001-03-26') }), '0001-01-01'],
    [gregorian('FREQ=YEARLY', { end: until('0005-01-01') }), '0001-01-01'],
  );
  return rows;
}

/** `descriptions` (§5.5): every grammar row of §5.2 with and without ends, both systems, custom schedules, extra dates and year 1. */
export function buildDescriptions(): DescriptionCase[] {
  return descriptionRows().map(([recurrence, start, system = 'ifc']) => ({
    recurrence: recurrenceJson(recurrence),
    start,
    system,
    text: describeRecurrence(recurrence, D(start), system),
  }));
}

/** `nextOccurrences` (§5.5): `describeNextOccurrences(recurrence, start, system, { count })`. */
export interface NextOccurrencesCase {
  readonly recurrence: RecurrenceJson;
  readonly start: DateJson;
  readonly system: CalendarSystemId;
  readonly count: number;
  readonly text: string;
}

function nextOccurrencesRows(): (readonly [EventRecurrence, string, CalendarSystemId, number])[] {
  const rows: (readonly [EventRecurrence, string, CalendarSystemId, number])[] = [];
  // Every preset of the first start: IFC with 3 dates, the Positivist 13-month presets too, and counts of 1.
  for (const system of SYSTEMS) {
    for (const preset of repeatPresets(D('2026-10-19'), system)) {
      if (preset.recurrence === null || (system === 'positivist' && preset.section !== 'thirteen')) continue;
      rows.push([preset.recurrence, '2026-10-19', system, 3]);
    }
  }
  rows.push(
    [gregorian('FREQ=WEEKLY'), '2026-10-19', 'ifc', 1],
    [thirteen(monthly(12)), '2026-10-19', 'ifc', 1],
    // Ends after 2 dates (fewer than asked) and after the start only (empty).
    [gregorian('FREQ=WEEKLY', { end: count(3) }), '2026-10-19', 'ifc', 3],
    [gregorian('FREQ=WEEKLY', { end: count(1) }), '2026-10-19', 'ifc', 3],
    // Crosses a year; intercalary rules; the leap-day presets of the other starts.
    [gregorian('FREQ=MONTHLY'), '2026-12-15', 'ifc', 3],
    [thirteen(intercalary('year-day')), '2026-12-31', 'ifc', 3],
    [thirteen(intercalary('leap-day')), '2024-06-17', 'ifc', 3],
    [thirteen(intercalary('leap-day', 'positivist')), '2024-12-31', 'positivist', 2],
    [gregorian('FREQ=YEARLY'), '2024-02-29', 'ifc', 3],
    [gregorian('FREQ=MONTHLY'), '2026-01-31', 'ifc', 3],
  );
  return rows;
}

/** `nextOccurrences` (§5.5): the presets of a start in both systems, counts 1 and 3, an early end, a year crossing and intercalary rules. */
export function buildNextOccurrences(): NextOccurrencesCase[] {
  return nextOccurrencesRows().map(([recurrence, start, system, n]) => ({
    recurrence: recurrenceJson(recurrence),
    start,
    system,
    count: n,
    text: describeNextOccurrences(recurrence, D(start), system, { count: n }),
  }));
}

/**
 * `repeatNotes` (§5.5): `describeRepeatNotes(recurrence, start, system, {
 * gregorianOnlyCalendar })`. `gregorianOnlyCalendar` is not in the §5.5 field
 * list; it carries the "with and without `gregorianOnlyCalendar`" cases the
 * §5.5 case list asks for.
 */
export interface RepeatNotesCase {
  readonly recurrence: RecurrenceJson;
  readonly start: DateJson;
  readonly system: CalendarSystemId;
  readonly gregorianOnlyCalendar: boolean;
  readonly notes: readonly string[];
}

function repeatNotesRows(): (readonly [EventRecurrence, string, CalendarSystemId, boolean])[] {
  const rows: (readonly [EventRecurrence, string, CalendarSystemId, boolean])[] = [];
  for (const outlook of [false, true]) {
    rows.push(
      [gregorian('FREQ=MONTHLY'), '2026-10-31', 'ifc', outlook],
      [gregorian('FREQ=MONTHLY;BYMONTHDAY=29,30'), '2027-01-29', 'ifc', outlook],
      [gregorian('FREQ=YEARLY'), '2024-02-29', 'ifc', outlook],
    );
  }
  for (const start of ['2026-10-19', '2027-10-19']) {
    // Gregorian weekly on one weekday, every week and every 2 weeks, in both systems.
    rows.push([gregorian('FREQ=WEEKLY'), start, 'ifc', false], [gregorian('FREQ=WEEKLY;INTERVAL=2'), start, 'positivist', false]);
    // 13-month weekly in both systems.
    rows.push([thirteen(weekly(4)), start, 'ifc', false], [thirteen(weekly(5, 2, 'positivist')), start, 'positivist', false]);
  }
  rows.push(
    // Leap-only intercalary rules name their cap in 13-month form.
    [thirteen(intercalary('leap-day')), '2024-06-17', 'ifc', false],
    [thirteen(intercalary('leap-day', 'positivist')), '2024-12-31', 'positivist', false],
    // Near the range end the second sentence goes (the year after the cap is past 9999).
    [thirteen(intercalary('leap-day')), '9904-06-17', 'ifc', false],
    // The weekly note and the month-day note never meet; with a 13-month weekly rule on a gregorian-only calendar.
    [thirteen(weekly(4)), '2026-10-19', 'ifc', true],
    // No notes.
    [gregorian('FREQ=DAILY'), '2026-10-19', 'ifc', false],
    [gregorian('FREQ=MONTHLY'), '2026-10-15', 'ifc', true],
    [gregorian('FREQ=WEEKLY;BYDAY=MO,WE'), '2026-10-19', 'ifc', false],
    [thirteen(monthly(12)), '2026-10-19', 'ifc', false],
    [thirteen(intercalary('year-day')), '2026-12-31', 'ifc', false],
  );
  return rows;
}

/** `repeatNotes` (§5.5): every row of the `describeRepeatNotes` table, starts in 2026 and 2027, both systems, and repeats without notes. */
export function buildRepeatNotes(): RepeatNotesCase[] {
  return repeatNotesRows().map(([recurrence, start, system, outlook]) => ({
    recurrence: recurrenceJson(recurrence),
    start,
    system,
    gregorianOnlyCalendar: outlook,
    notes: describeRepeatNotes(recurrence, D(start), system, { gregorianOnlyCalendar: outlook }),
  }));
}

// ---------------------------------------------------------------------------
// adaptations
// ---------------------------------------------------------------------------

/**
 * `adaptations` (§5.5): `adaptRecurrenceToStart(recurrence, oldStart,
 * newStart)`; for `dropped` rows `laterCount` is `laterOccurrenceCount(recurrence,
 * oldStart, oldStart)` (the later events the move deletes), else null.
 */
export interface AdaptationCase {
  readonly recurrence: RecurrenceJson;
  readonly oldStart: DateJson;
  readonly newStart: DateJson;
  readonly expected: { readonly recurrence: RecurrenceJson | null; readonly change: string; readonly laterCount: number | null };
}

const ADAPTATIONS: readonly (readonly [EventRecurrence, string, string])[] = [
  // Within a month, across months, onto Year Day (monthly and weekly dropped), onto Leap Day.
  [thirteen(monthly(12)), '2026-10-19', '2026-10-21'],
  [thirteen(monthly(12)), '2026-10-19', '2026-11-16'],
  [thirteen(weekly(4)), '2026-10-19', '2026-10-21'],
  [thirteen(weekly(4, 2)), '2026-10-19', '2026-11-03'],
  [thirteen(monthly(12), { end: count(10) }), '2026-10-19', '2026-12-31'],
  [thirteen(weekly(4), { end: until('2027-06-30') }), '2026-10-19', '2026-12-31'],
  [thirteen(monthly(12)), '2026-10-19', '2026-12-31'],
  [thirteen(ruleFrom('monthly', '2024-10-18', 'positivist'), { end: count(4) }), '2024-10-18', '2024-06-17'],
  [thirteen(ruleFrom('weekly', '2024-10-17')), '2024-10-17', '2024-06-17'],
  [thirteen(ruleFrom('monthly', '2024-10-18', 'positivist')), '2024-10-18', '2024-12-30'],
  // The §2.11 table: yearly onto Year Day, Every Leap Day onto IFC June 28, Every Year Day onto Leap Day,
  // Holy Women to another leap year, yearly onto a new month day.
  [thirteen(yearly(11, 12)), '2026-10-19', '2026-12-31'],
  [thirteen(yearly(11, 12)), '2026-10-19', '2026-11-16'],
  [thirteen(intercalary('leap-day')), '2024-06-17', '2024-06-16'],
  [thirteen(intercalary('year-day')), '2026-12-31', '2028-06-17'],
  [thirteen(intercalary('leap-day', 'positivist')), '2024-12-31', '2028-12-31'],
  [thirteen(intercalary('year-day', 'positivist')), '2026-12-31', '2028-12-31'],
  // Gregorian presets: minimal forms unchanged, explicit forms follow the new start.
  [gregorian('FREQ=WEEKLY'), '2026-10-19', '2026-10-21'],
  [gregorian('FREQ=WEEKLY;BYDAY=MO'), '2026-10-19', '2026-10-21'],
  [gregorian('FREQ=MONTHLY;BYMONTHDAY=19'), '2026-10-19', '2026-11-05'],
  [gregorian('FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=19'), '2026-10-19', '2026-12-31'],
  [gregorian('FREQ=WEEKLY;BYDAY=MO,WE,FR'), '2026-10-19', '2026-10-20'],
  // Dates and foreign rules stay.
  [dates({ extraDates: [extra('2026-11-02')] }), '2026-10-19', '2026-10-21'],
  [foreign([['FREQ=WEEKLY', never]]), '2026-10-19', '2026-10-21'],
];

/** `adaptations` (§5.5): every row of the §2.11 adaptation table and the `dropped` later counts. */
export function buildAdaptations(): AdaptationCase[] {
  return ADAPTATIONS.map(([recurrence, oldStart, newStart]) => {
    const result = adaptRecurrenceToStart(recurrence, D(oldStart), D(newStart));
    return {
      recurrence: recurrenceJson(recurrence),
      oldStart,
      newStart,
      expected: {
        recurrence: result.recurrence === null ? null : recurrenceJson(result.recurrence),
        change: result.change,
        laterCount: result.change === 'dropped' ? laterOccurrenceCount(recurrence, D(oldStart), D(oldStart)) : null,
      },
    };
  });
}

/** The C4 sections without zones, in publication order (§6.0, after `ruleFromStart`). Task C6 writes them. */
export const C4_SECTIONS = {
  expansions: buildExpansions,
  endBefore: buildEndBefore,
  splits: buildSplits,
  retimes: buildRetimes,
  recognitions: buildRecognitions,
  presets: buildPresets,
  descriptions: buildDescriptions,
  nextOccurrences: buildNextOccurrences,
  repeatNotes: buildRepeatNotes,
  adaptations: buildAdaptations,
} as const;

// ---------------------------------------------------------------------------
// series, alarmInstants (zones)
// ---------------------------------------------------------------------------

/** `series` (§5.5): `expandSeries(series, window, deviceZone, zones)`. */
export interface SeriesCase {
  readonly series: SeriesInputJson;
  readonly window: DeviceWindowJson;
  readonly deviceZone: string;
  readonly expected: { readonly occurrences: readonly ExpandedOccurrenceJson[]; readonly orphans: readonly string[]; readonly outOfRange: number };
}

interface SeriesRow {
  readonly series: SeriesInput;
  readonly window: readonly [string, string];
  readonly deviceZones: readonly string[];
}

const TALLINN = 'Europe/Tallinn';
const NEW_YORK = 'America/New_York';
const BOTH = [TALLINN, NEW_YORK];
const JANUARY: readonly [string, string] = ['2027-01-01T00:00', '2027-01-08T00:00'];

interface SeriesParts {
  readonly recurrence?: EventRecurrence | null;
  readonly allDay?: boolean;
  readonly zone?: string | null;
  readonly overrides?: readonly OverrideInput[];
  readonly duration?: { readonly days: number; readonly minutes: number };
}
const series = (id: string, start: string, end: string, parts: SeriesParts = {}): SeriesInput => ({
  id,
  recurrence: parts.recurrence ?? null,
  allDay: parts.allDay ?? false,
  start: L(start),
  end: L(end),
  zone: parts.zone === undefined ? TALLINN : parts.zone,
  overrides: parts.overrides ?? [],
  duration: parts.duration ?? null,
});
const override = (
  id: string,
  originalDate: string,
  start: string,
  end: string,
  parts: { readonly canceled?: boolean; readonly minute?: number | null; readonly zone?: string | null; readonly allDay?: boolean } = {},
): OverrideInput => ({
  id,
  originalDate: D(originalDate),
  originalMinute: parts.minute ?? null,
  canceled: parts.canceled ?? false,
  allDay: parts.allDay ?? false,
  start: L(start),
  end: L(end),
  zone: parts.zone === undefined ? TALLINN : parts.zone,
});

function seriesRows(): SeriesRow[] {
  const tuesdays = gregorian('FREQ=WEEKLY');
  return [
    // The all-day Winter break from December 28 to January 3.
    { series: series('winter-break', '2026-12-28T00:00', '2027-01-03T24:00', { allDay: true, zone: null }), window: JANUARY, deviceZones: BOTH },
    // A timed event across midnight on December 31 (shown in Tallinn, before the window in New York).
    { series: series('new-year-party', '2026-12-31T22:00', '2027-01-01T02:00'), window: JANUARY, deviceZones: BOTH },
    // 01:00 on January 1 in Pacific/Kiritimati is 01:00 on December 31 in Honolulu (the window starts a day earlier to show it).
    {
      series: series('kiritimati', '2027-01-01T01:00', '2027-01-01T02:00', { zone: 'Pacific/Kiritimati' }),
      window: ['2026-12-31T00:00', '2027-01-08T00:00'],
      deviceZones: ['Pacific/Honolulu', TALLINN],
    },
    // Overrides moved from December 15 into January (shown) and from January 5 into December (hidden).
    {
      series: series('standup', '2026-11-03T10:00', '2026-11-03T10:30', {
        recurrence: tuesdays,
        overrides: [
          override('standup|20261215', '2026-12-15', '2027-01-07T10:00', '2027-01-07T10:30'),
          override('standup|20270105', '2027-01-05', '2026-12-30T10:00', '2026-12-30T10:30'),
        ],
      }),
      window: JANUARY,
      deviceZones: BOTH,
    },
    // A canceled override and an orphan override (its date is not a Tuesday).
    {
      series: series('review', '2026-11-03T15:00', '2026-11-03T16:00', {
        recurrence: tuesdays,
        overrides: [
          override('review|20270105', '2027-01-05', '2027-01-05T15:00', '2027-01-05T16:00', { canceled: true }),
          override('review|20270106', '2027-01-06', '2027-01-06T09:00', '2027-01-06T09:30'),
        ],
      }),
      window: JANUARY,
      deviceZones: BOTH,
    },
    // A floating daily event: the same wall clock in every zone.
    { series: series('floating', '2027-01-02T09:00', '2027-01-02T10:00', { recurrence: gregorian('FREQ=DAILY', { end: count(3) }), zone: null }), window: JANUARY, deviceZones: BOTH },
    // Floating masters across a DST change are measured in the device's zone, as their starts are placed: 01:00 to
    // 03:00 on New York's spring-forward night is one hour there (two in Tallinn), and a daily 00:30 to 02:30 from its
    // fall-back night lasts three hours there every day.
    { series: series('floating-spring', '2026-03-08T01:00', '2026-03-08T03:00', { zone: null }), window: ['2026-03-08T00:00', '2026-03-09T00:00'], deviceZones: BOTH },
    {
      series: series('floating-autumn', '2026-11-01T00:30', '2026-11-01T02:30', { recurrence: gregorian('FREQ=DAILY', { end: count(2) }), zone: null }),
      window: ['2026-11-01T00:00', '2026-11-03T00:00'],
      deviceZones: BOTH,
    },
    // DURATION:P1D from RFC 5545 text: the same wall-clock end every day across New York's spring-forward night.
    {
      series: series('day-long', '2026-03-07T12:00', '2026-03-08T12:00', { zone: NEW_YORK, recurrence: gregorian('FREQ=DAILY', { end: count(3) }), duration: { days: 1, minutes: 0 } }),
      window: ['2026-03-07T00:00', '2026-03-11T00:00'],
      deviceZones: BOTH,
    },
    // 02:30 on New York's spring-forward night starts at 03:30 (07:30 UTC): an override and an exclusion naming that
    // instant (here as 03:30 local) are that occurrence's.
    {
      series: series('gap', '2026-03-06T02:30', '2026-03-06T03:00', {
        zone: NEW_YORK,
        recurrence: gregorian('FREQ=DAILY', { end: count(4) }),
        overrides: [override('gap|20260308T073000Z', '2026-03-08', '2026-03-08T10:00', '2026-03-08T10:30', { minute: 210, zone: NEW_YORK })],
      }),
      window: ['2026-03-07T00:00', '2026-03-10T00:00'],
      deviceZones: BOTH,
    },
    {
      series: series('gap-excluded', '2026-03-06T02:30', '2026-03-06T03:00', {
        zone: NEW_YORK,
        recurrence: gregorian('FREQ=DAILY', { end: count(4), exceptDates: [original('2026-03-08', 210)] }),
      }),
      window: ['2026-03-07T00:00', '2026-03-10T00:00'],
      deviceZones: BOTH,
    },
    // A weekly repeat whose master crosses the spring-forward night (9 hours, not 10).
    {
      series: series('night-shift', '2026-03-28T22:00', '2026-03-29T08:00', { recurrence: gregorian('FREQ=WEEKLY', { end: count(3) }) }),
      window: ['2026-03-28T00:00', '2026-04-12T00:00'],
      deviceZones: BOTH,
    },
    // Daily at 03:30 across the spring-forward day (in the gap) and across the fall-back day (the earlier 03:30).
    {
      series: series('early-spring', '2026-03-27T03:30', '2026-03-27T04:00', { recurrence: gregorian('FREQ=DAILY', { end: count(4) }) }),
      window: ['2026-03-26T00:00', '2026-04-01T00:00'],
      deviceZones: BOTH,
    },
    {
      series: series('early-autumn', '2026-10-24T03:30', '2026-10-24T04:00', { recurrence: gregorian('FREQ=DAILY', { end: count(3) }) }),
      window: ['2026-10-23T00:00', '2026-10-28T00:00'],
      deviceZones: BOTH,
    },
    // A PERIOD extra date longer than the master that starts before the window.
    {
      series: series('conference', '2026-12-02T10:00', '2026-12-02T11:00', {
        recurrence: gregorian('FREQ=WEEKLY', { end: count(3), extraDates: [extra('2026-12-29', 540, 5 * 1440)] }),
      }),
      window: JANUARY,
      deviceZones: BOTH,
    },
    // An all-day yearly repeat with an all-day override moved by a day.
    {
      series: series('birthday', '2020-01-04T00:00', '2020-01-04T24:00', {
        recurrence: gregorian('FREQ=YEARLY'),
        allDay: true,
        zone: null,
        overrides: [override('birthday|20270104', '2027-01-04', '2027-01-05T00:00', '2027-01-05T24:00', { allDay: true, zone: null })],
      }),
      window: JANUARY,
      deviceZones: BOTH,
    },
    // A single event in New York and its zone's view from Tallinn (crosses into the next day).
    { series: series('call', '2027-01-04T20:00', '2027-01-04T21:00', { zone: NEW_YORK }), window: JANUARY, deviceZones: BOTH },
    // The range edges: 9999-12-31T23:00 in New York and 0001-01-01T01:00 in Tokyo, whose instants leave years 1 to 9999:
    // dropped on every device, their own zone's included (§4.6 steps 3 and 5, far-future.ics).
    {
      series: series('last', '9999-12-31T23:00', '9999-12-31T23:30', { zone: NEW_YORK }),
      window: ['9999-12-31T00:00', '9999-12-31T24:00'],
      deviceZones: [TALLINN, NEW_YORK],
    },
    {
      series: series('first', '0001-01-01T01:00', '0001-01-01T02:00', { zone: 'Asia/Tokyo' }),
      window: ['0001-01-01T00:00', '0001-01-02T00:00'],
      deviceZones: ['UTC', 'Asia/Tokyo'],
    },
  ];
}

/** `series` (§5.5): the year edge, overrides moved across it, canceled and orphan overrides, floating events, DST days and the range edges. */
export function buildSeries(zones: ZoneResolver = intlZoneResolver()): SeriesCase[] {
  return seriesRows().flatMap((row) =>
    row.deviceZones.map((deviceZone) => {
      const window: DeviceWindow = { from: L(row.window[0]), to: L(row.window[1]) };
      const result = expandSeries(row.series, window, deviceZone, zones);
      return {
        series: seriesInputJson(row.series),
        window: { from: row.window[0], to: row.window[1] },
        deviceZone,
        expected: { occurrences: result.occurrences.map(expandedOccurrenceJson), orphans: result.orphans, outOfRange: result.outOfRange },
      };
    }),
  );
}

/** `alarmInstants` (§5.5): `alarmFireTime(alarm, occurrence, deviceZone, zones)`; `expected` null before year 1. */
export interface AlarmInstantCase {
  readonly alarm: AlarmJson;
  readonly occurrence: { readonly allDay: boolean; readonly start: LocalJson; readonly startUtc: LocalJson | null };
  readonly deviceZone: string;
  readonly expected: LocalJson | null;
}

function alarmRows(): (readonly [Alarm, boolean, string, string])[] {
  const rows: (readonly [Alarm, boolean, string, string])[] = [];
  const relative = (offsetMinutes: number): Alarm => ({ kind: 'relative', offsetMinutes });
  // Timed occurrences on the spring-forward and fall-back days: 3 hours before, exactly.
  rows.push(
    [relative(-180), false, '2026-03-29T05:00', TALLINN],
    [relative(-180), false, '2026-10-25T05:00', TALLINN],
    [relative(-180), false, '2026-03-08T04:00', NEW_YORK],
    [relative(-180), false, '2026-11-01T03:00', NEW_YORK],
  );
  // All-day occurrences on those days: on the day at 09:00 and 1 day before at 09:00 (wall clock).
  for (const [date, zone] of [
    ['2026-03-29', TALLINN],
    ['2026-10-25', TALLINN],
    ['2026-03-08', NEW_YORK],
    ['2026-11-01', NEW_YORK],
  ] as const) {
    rows.push([relative(540), true, `${date}T00:00`, zone], [relative(-900), true, `${date}T00:00`, zone]);
  }
  rows.push(
    // An absolute alert, and an absolute one in the gap (moves forward).
    [{ kind: 'absolute', at: L('2026-10-19T08:30') }, false, '2026-10-19T10:00', TALLINN],
    [{ kind: 'absolute', at: L('2026-03-29T03:30') }, true, '2026-03-29T00:00', TALLINN],
    // Before year 1.
    [relative(-900), true, '0001-01-01T00:00', TALLINN],
  );
  return rows;
}

/** `alarmInstants` (§5.5): relative alerts on DST days (timed exact, all-day on the wall clock), absolute alerts and one before year 1. */
export function buildAlarmInstants(zones: ZoneResolver = intlZoneResolver()): AlarmInstantCase[] {
  return alarmRows().map(([alarm, allDay, start, deviceZone]) => {
    const startUtc = allDay ? null : zonedToUtc(L(start), deviceZone, zones);
    const fire = alarmFireTime(alarm, { allDay, start: L(start), startUtc }, deviceZone, zones);
    return {
      alarm: alarmJson(alarm),
      occurrence: { allDay, start, startUtc: startUtc === null ? null : localJson(startUtc) },
      deviceZone,
      expected: fire === null ? null : localJson(fire),
    };
  });
}

/**
 * The C4 sections that need zone data, published after `zones` (§6.0). Each
 * builder takes the resolver to run through: Node's `Intl` by default, the
 * recording wrapper when task C6 writes the file (so `zoneOffsets` holds every
 * offset they asked for).
 */
export const C4_ZONE_SECTIONS = {
  series: buildSeries,
  alarmInstants: buildAlarmInstants,
} as const;
