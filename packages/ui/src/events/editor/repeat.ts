/**
 * The repeat picker's rows (docs/EVENTS.md §2.13) and the Custom repeat form,
 * apart from React. Labels, descriptions, the "Next:" line and the notes all
 * come from core (`repeatPresets`, `describeRecurrence`,
 * `describeNextOccurrences`, `describeRepeatNotes`), so they read the same on
 * every platform.
 */

import {
  type CalendarSystemId,
  type EventRecurrence,
  type GregorianDate,
  type RRule,
  type RepeatEnd,
  type Weekday,
  describeRecurrence,
  getCalendarSystem,
  gregorianWeekday,
  matchRepeatPreset,
  parseRRule,
  repeatPresets,
} from '@thirteen/core';
import { copy } from '../copy.ts';

/** A row of the repeat picker. */
export interface RepeatRow {
  /** A preset id of core (`never`, `weekly`, `thirteen-monthly`, ...), `custom` or `keep`. */
  readonly id: string;
  readonly section: 'keep' | 'never' | 'gregorian' | 'thirteen' | 'custom';
  readonly label: string;
  /** What choosing it sets (with the draft's End repeat); `null` for Never; for `custom` the current custom repeat or null. */
  readonly recurrence: EventRecurrence | null;
  /** A 13-month row the calendar cannot keep (§2.13, `gregorian-only` calendars). */
  readonly disabled: boolean;
}

const NEVER_END: RepeatEnd = { kind: 'never' };

/** The recurrence with another end, everything else kept. */
export function withRepeatEnd(recurrence: EventRecurrence, end: RepeatEnd): EventRecurrence {
  return { ...recurrence, end };
}

const ALL_DAYS = 0b1111111;
const WEEKDAYS = 0b0111110;
const WEEKEND = 0b1000001;

function plainMask(rule: RRule): number | null {
  let mask = 0;
  for (const day of rule.byDay) {
    if (day.ordinal !== null) return null;
    mask |= 1 << day.weekday;
  }
  return mask;
}

const ORDINALS = new Set([1, 2, 3, 4, 5, -1]);

function onTheOf(rule: RRule): OnThe | null {
  if (rule.byMonthDay.length > 0) return null;
  if (rule.bySetPos.length === 0) {
    if (rule.byDay.length !== 1) return null;
    const { weekday, ordinal } = rule.byDay[0]!;
    return ordinal !== null && ORDINALS.has(ordinal) ? { ordinal: ordinal as Ordinal, kind: weekday } : null;
  }
  if (rule.bySetPos.length !== 1 || !ORDINALS.has(rule.bySetPos[0]!)) return null;
  const mask = plainMask(rule);
  const ordinal = rule.bySetPos[0]! as Ordinal;
  if (mask === ALL_DAYS) return { ordinal, kind: 'day' };
  if (mask === WEEKDAYS) return { ordinal, kind: 'weekday' };
  if (mask === WEEKEND) return { ordinal, kind: 'weekend' };
  if (mask !== null && Number.isInteger(Math.log2(mask))) return { ordinal, kind: Math.log2(mask) as Weekday };
  return null;
}

/**
 * Whether the Custom editor can show a Gregorian rule (§2.13, the same test as
 * core's recognition step 4): daily, weekly on plain weekdays, monthly on days
 * or "On the", yearly on months with an optional "On the"; interval 1 to 99.
 */
export function customExpressible(rule: RRule): boolean {
  if (rule.interval > 99) return false;
  if (rule.bySecond.length + rule.byMinute.length + rule.byHour.length + rule.byYearDay.length + rule.byWeekNo.length > 0) return false;
  if ((rule.rscale !== null && rule.rscale !== 'GREGORIAN') || rule.skip !== null) return false;
  switch (rule.freq) {
    case 'daily':
      return rule.byMonth.length + rule.byMonthDay.length + rule.byDay.length + rule.bySetPos.length === 0;
    case 'weekly':
      return rule.byMonth.length + rule.byMonthDay.length + rule.bySetPos.length === 0 && plainMask(rule) !== null;
    case 'monthly':
    case 'yearly': {
      if (rule.freq === 'monthly' && rule.byMonth.length > 0) return false;
      if (rule.freq === 'yearly' && rule.byMonth.length === 0) return rule.byMonthDay.length + rule.byDay.length + rule.bySetPos.length === 0;
      if (rule.byDay.length === 0 && rule.bySetPos.length === 0) return rule.byMonthDay.every((d) => d > 0 || d === -1);
      return onTheOf(rule) !== null;
    }
    default:
      return false;
  }
}

/**
 * Whether Thirteen can edit a stored repeat (§4.5 `editable`): not when it was
 * set in another app as several rules, an `EXRULE`, a list of dates, a rule
 * with extra dates, or a rule the Custom editor cannot express. Those show
 * "Keep: ..." and are never rewritten (§2.13).
 */
export function isRepeatEditable(recurrence: EventRecurrence | null): boolean {
  if (recurrence === null) return true;
  if (recurrence.extraDates.length > 0) return false;
  switch (recurrence.rule.kind) {
    case 'thirteen':
      return true;
    case 'rrule':
      return customExpressible(recurrence.rule.rrule);
    default:
      return false;
  }
}

/** The description of a repeat, or `repeat.customUnknown` when core has no words for it. */
export function repeatDescription(recurrence: EventRecurrence | null, start: GregorianDate, systemId: CalendarSystemId): string {
  if (recurrence === null) return copy('repeat.never');
  try {
    return describeRecurrence(recurrence, start, systemId);
  } catch {
    return copy('repeat.customUnknown');
  }
}

/** The checked row: a preset id, `custom` or `keep`. */
export function selectedRepeatRow(
  recurrence: EventRecurrence | null,
  start: GregorianDate,
  systemId: CalendarSystemId,
  editable: boolean,
): string {
  if (recurrence === null) return 'never';
  if (!editable) return 'keep';
  try {
    return matchRepeatPreset(recurrence, start, systemId) ?? 'custom';
  } catch {
    return 'custom';
  }
}

/**
 * The picker's rows for a start (§2.13): Keep (a repeat set in another app),
 * Never, the Gregorian presets, the 13-month presets of `systemId`, Custom.
 * Preset rows carry the draft's End repeat.
 */
export function repeatRows(
  start: GregorianDate,
  systemId: CalendarSystemId,
  current: EventRecurrence | null,
  options: { readonly editable: boolean; readonly gregorianOnly?: boolean },
): RepeatRow[] {
  const end = current?.end ?? NEVER_END;
  const rows: RepeatRow[] = [];
  if (!options.editable && current !== null) {
    rows.push({ id: 'keep', section: 'keep', label: copy('repeat.keep', { description: repeatDescription(current, start, systemId) }), recurrence: current, disabled: false });
  }
  for (const preset of repeatPresets(start, systemId)) {
    rows.push({
      id: preset.id,
      section: preset.section,
      label: preset.label,
      recurrence: preset.recurrence === null ? null : withRepeatEnd(preset.recurrence, end),
      disabled: options.gregorianOnly === true && preset.section === 'thirteen' && !preset.exchangeSafe,
    });
  }
  const custom = current !== null && options.editable && current.rule.kind === 'rrule' ? current : null;
  rows.push({ id: 'custom', section: 'custom', label: copy('repeat.custom'), recurrence: custom, disabled: false });
  return rows;
}

/** The 13-month section's heading: the selected system's name (`repeat.section.thirteen`). */
export function thirteenSectionTitle(systemId: CalendarSystemId): string {
  return copy('repeat.section.thirteen', { 'system name': getCalendarSystem(systemId).name });
}

// ---- Custom (Gregorian only, §2.13) -----------------------------------------

export type CustomFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Ordinal = 1 | 2 | 3 | 4 | 5 | -1;
/** A weekday, or "day", "weekday", "weekend day" (`repeat.custom.dayKinds`). */
export type OnTheKind = Weekday | 'day' | 'weekday' | 'weekend';

export interface OnThe {
  readonly ordinal: Ordinal;
  readonly kind: OnTheKind;
}

export interface CustomRepeat {
  readonly frequency: CustomFrequency;
  /** 1 to 99. */
  readonly interval: number;
  /** Weekly: the weekdays, Sunday 0 to Saturday 6. */
  readonly weekdays: readonly Weekday[];
  /** Monthly: "Each" (days of the month) or "On the". */
  readonly monthlyMode: 'each' | 'onThe';
  /** Monthly "Each": days 1 to 31. */
  readonly monthDays: readonly number[];
  /** Yearly: months 1 to 12. */
  readonly months: readonly number[];
  /** Yearly: the optional "On the". */
  readonly yearlyOnThe: boolean;
  readonly onThe: OnThe;
}

export const CUSTOM_ORDINALS: readonly Ordinal[] = [1, 2, 3, 4, 5, -1];

/** The Custom form for a repeat (its own rule when it is a Gregorian rule), else from the start. */
export function customFrom(recurrence: EventRecurrence | null, start: GregorianDate): CustomRepeat {
  const weekday = gregorianWeekday(start);
  const week = Math.ceil(start.day / 7);
  const base: CustomRepeat = {
    frequency: 'weekly',
    interval: 1,
    weekdays: [weekday],
    monthlyMode: 'each',
    monthDays: [start.day],
    months: [start.month],
    yearlyOnThe: false,
    onThe: { ordinal: (week > 4 ? -1 : week) as Ordinal, kind: weekday },
  };
  if (recurrence === null || recurrence.rule.kind !== 'rrule') return base;
  const rule = recurrence.rule.rrule;
  const frequency: CustomFrequency | null =
    rule.freq === 'daily' || rule.freq === 'weekly' || rule.freq === 'monthly' || rule.freq === 'yearly' ? rule.freq : null;
  if (frequency === null) return base;
  const onThe = onTheOf(rule);
  const mask = plainMask(rule);
  return {
    ...base,
    frequency,
    interval: Math.min(99, Math.max(1, rule.interval)),
    weekdays: frequency === 'weekly' && mask !== null && mask !== 0 ? ([0, 1, 2, 3, 4, 5, 6] as const).filter((d) => (mask & (1 << d)) !== 0) : base.weekdays,
    monthlyMode: frequency === 'monthly' && onThe !== null ? 'onThe' : 'each',
    monthDays: rule.byMonthDay.length > 0 ? rule.byMonthDay.filter((d) => d > 0) : base.monthDays,
    months: rule.byMonth.length > 0 ? [...rule.byMonth] : base.months,
    yearlyOnThe: frequency === 'yearly' && onThe !== null,
    onThe: onThe ?? base.onThe,
  };
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

function onThePart(onThe: OnThe): string {
  switch (onThe.kind) {
    case 'day':
      return `BYDAY=SU,MO,TU,WE,TH,FR,SA;BYSETPOS=${onThe.ordinal}`;
    case 'weekday':
      return `BYDAY=MO,TU,WE,TH,FR;BYSETPOS=${onThe.ordinal}`;
    case 'weekend':
      return `BYDAY=SU,SA;BYSETPOS=${onThe.ordinal}`;
    default:
      return `BYDAY=${onThe.ordinal}${DAY_CODES[onThe.kind]}`;
  }
}

const sorted = (values: readonly number[]) => [...new Set(values)].sort((a, b) => a - b);

/** The Gregorian rule the Custom form describes; empty selections fall back to the start's day. */
export function customRRule(custom: CustomRepeat, start: GregorianDate): RRule {
  const parts = [`FREQ=${custom.frequency.toUpperCase()}`];
  const interval = Math.min(99, Math.max(1, Math.trunc(custom.interval) || 1));
  if (interval !== 1) parts.push(`INTERVAL=${interval}`);
  switch (custom.frequency) {
    case 'weekly': {
      const days = custom.weekdays.length > 0 ? sorted(custom.weekdays) : [gregorianWeekday(start)];
      parts.push(`BYDAY=${days.map((d) => DAY_CODES[d]).join(',')}`);
      break;
    }
    case 'monthly':
      if (custom.monthlyMode === 'onThe') parts.push(onThePart(custom.onThe));
      else parts.push(`BYMONTHDAY=${(custom.monthDays.length > 0 ? sorted(custom.monthDays) : [start.day]).join(',')}`);
      break;
    case 'yearly':
      parts.push(`BYMONTH=${(custom.months.length > 0 ? sorted(custom.months) : [start.month]).join(',')}`);
      if (custom.yearlyOnThe) parts.push(onThePart(custom.onThe));
      break;
    default:
      break;
  }
  return parseRRule(parts.join(';'));
}

/** The repeat the Custom form gives, keeping the draft's End repeat. */
export function customRecurrence(custom: CustomRepeat, start: GregorianDate, end: RepeatEnd): EventRecurrence {
  return { rule: { kind: 'rrule', rrule: customRRule(custom, start) }, end, extraDates: [], exceptDates: [] };
}

/** "first | second | ..." and the like: a catalogue string of variants, split. */
export function copyVariants(id: 'repeat.custom.ordinals' | 'repeat.custom.dayKinds' | 'repeat.custom.unit'): string[] {
  return copy(id).split(id === 'repeat.custom.unit' ? ', ' : ' | ');
}

/** "{n} weeks" / "1 week" (`repeat.custom.unit`) for a frequency. */
export function customUnit(frequency: CustomFrequency, n: number): string {
  const index = ['daily', 'weekly', 'monthly', 'yearly'].indexOf(frequency);
  const [other, one] = copyVariants('repeat.custom.unit')[index]!.split(' | ');
  return n === 1 ? one! : other!.replace('{n}', String(n));
}
