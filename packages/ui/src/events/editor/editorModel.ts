/**
 * The event editor's rules apart from React (docs/EVENTS.md §2.11, §4.7):
 * which field each `validateDraft` issue belongs to and its text, the notices
 * under Repeat and Starts, the span questions with their losses lines (said
 * before the choice), Duplicate's draft, alert trimming on a calendar change,
 * and the small text helpers (URL scheme, zone city).
 */

import {
  type Alarm,
  type CalendarInfo,
  type CalendarSystemId,
  type DraftIssue,
  type EventDraft,
  type EventRecurrence,
  type GregorianDate,
  type OriginalDate,
  changedFields,
  displayEnd,
  formatThirteen,
  gregorianEquals,
  laterOccurrenceCount,
  normalizeEventEnd,
  retimeExceptions,
  splitRecurrence,
  toThirteen,
  validateDraft,
} from '@thirteen/core';
import { copy, plural } from '../copy.ts';
import type { EditSpan, ResolvedOccurrence, StoreCalendar } from '../store.ts';

/** The editor rows an issue is shown under (§2.11 Validation). */
export type EditorField = 'start' | 'end' | 'repeat' | 'endRepeat' | 'calendar' | 'url';

export interface FieldIssue {
  readonly issue: DraftIssue;
  readonly field: EditorField;
  readonly text: string;
}

/** The largest "After {n} times" (§2.11 End repeat). */
export const MAX_REPEAT_COUNT = 999;

const READ_ONLY_PLACEHOLDER: CalendarInfo = {
  id: '',
  title: '',
  color: '#000000',
  accountId: '',
  accountTitle: '',
  accountKind: 'other',
  writable: false,
  thirteenRepeats: 'all',
  maxAlarms: null,
  supportsAvailability: false,
  supportsUrl: false,
  isPlatformDefault: false,
};

/** The issue's field and text; null for issues the editor fixes itself or shows as a dialog. */
export function fieldIssue(issue: DraftIssue, draft: EventDraft): FieldIssue | null {
  switch (issue) {
    case 'end-before-start':
      return { issue, field: 'end', text: copy('editor.error.endBeforeStart') };
    case 'out-of-range':
      return { issue, field: draft.start.date.year < 1583 ? 'start' : 'end', text: copy('editor.error.outOfRange') };
    case 'until-before-start':
      return { issue, field: 'endRepeat', text: copy('editor.error.untilBeforeStart') };
    case 'count-out-of-range':
      return { issue, field: 'endRepeat', text: copy('editor.error.countRange', { max: MAX_REPEAT_COUNT }) };
    case 'invalid-url':
      return { issue, field: 'url', text: copy('editor.error.url') };
    case 'calendar-read-only':
      return { issue, field: 'calendar', text: copy('editor.error.readOnlyCalendar') };
    // Fixed by the editor (alerts trimmed on a calendar change, the repeat re-derived from the start)
    // or asked at Save (the conflict dialog).
    case 'too-many-alarms':
    case 'repeat-not-on-start':
    case 'thirteen-repeat-not-allowed':
      return null;
  }
}

/** Every `validateDraft` issue of a draft against its calendar (a missing calendar is a read-only one). */
export function draftIssues(draft: EventDraft, calendar: CalendarInfo | null): DraftIssue[] {
  try {
    return validateDraft(draft, calendar ?? { ...READ_ONLY_PLACEHOLDER, id: draft.calendarId });
  } catch {
    return [];
  }
}

/** The issues shown under fields, in the order of the editor's rows. */
export function visibleIssues(draft: EventDraft, calendar: CalendarInfo | null): FieldIssue[] {
  const order: readonly EditorField[] = ['start', 'end', 'repeat', 'endRepeat', 'calendar', 'url'];
  return draftIssues(draft, calendar)
    .map((issue) => fieldIssue(issue, draft))
    .filter((issue): issue is FieldIssue => issue !== null)
    .sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
}

/** A URL as saved: `https://` added when the text names no scheme (§2.11 URL). */
export function normalizeUrl(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** The city of an IANA zone for `editor.zoneNote` and `event.zoneLine`: "America/New_York" is "New York". */
export function zoneCity(zone: string): string {
  const last = zone.split('/').pop() ?? zone;
  return last.replaceAll('_', ' ');
}

/** The end as the pickers show it: `D T24:00` as D+1 00:00 (§2.12 "Midnight ends"); all-day ends show their last day. */
export function pickerEnd(draft: EventDraft): { readonly date: GregorianDate; readonly minute: number } {
  if (draft.allDay) return { date: draft.end.date, minute: 0 };
  const shown = displayEnd(draft.end);
  return { date: shown.date, minute: shown.minute };
}

/** An end the pickers produced, back in end-of-day form; an end before the start is kept as picked (the error shows). */
export function normalizedEnd(start: EventDraft['start'], end: EventDraft['end']): EventDraft['end'] {
  try {
    return normalizeEventEnd(start, end);
  } catch {
    return end;
  }
}

/** The series an occurrence belongs to, for the notices and span questions. */
export interface SeriesContext {
  /** The master's repeat, in the event's zone. */
  readonly recurrence: EventRecurrence;
  /** The master's first date. */
  readonly start: GregorianDate;
  /** The opened occurrence's original date. */
  readonly originalDate: GregorianDate;
  readonly isFirst: boolean;
  /** The series' changed occurrences (`EventStore.overrideDates`). */
  readonly overrideDates: readonly OriginalDate[];
  /** `false` for a repeat set in another app (§4.5). */
  readonly editable: boolean;
}

/** The series of a resolved occurrence; null for a single event. */
export function seriesContext(resolved: ResolvedOccurrence, overrideDates: readonly OriginalDate[], editable: boolean): SeriesContext | null {
  const recurrence = resolved.event.recurrence;
  if (recurrence === null) return null;
  return {
    recurrence,
    start: resolved.event.start.date,
    originalDate: resolved.occurrence.originalDate,
    isFirst: resolved.isFirst,
    overrideDates,
    editable,
  };
}

const longThirteen = (date: GregorianDate, systemId: CalendarSystemId) =>
  formatThirteen(toThirteen(date, systemId), { style: 'long', includeWeekday: true });

/**
 * The later-events line under Repeat (§2.11 "Later events deleted"): when the
 * opened occurrence's repeat became Never, saving for future events deletes the
 * later occurrences. Null otherwise.
 */
export function laterDeletedNotice(series: SeriesContext | null, draft: EventDraft, systemId: CalendarSystemId): string | null {
  if (series === null || draft.recurrence !== null) return null;
  if (series.isFirst) return copy('editor.notice.becomesSingle', { date: longThirteen(draft.start.date, systemId) });
  const n = laterCount(series);
  return n === null ? copy('editor.notice.laterDeleted.endless') : plural('editor.notice.laterDeleted', n);
}

function laterCount(series: SeriesContext): number | null {
  try {
    return laterOccurrenceCount(series.recurrence, series.start, series.originalDate);
  } catch {
    return null;
  }
}

function retimeOptions(original: EventDraft, draft: EventDraft): { minuteDelta: number; allDay: 'to-all-day' | 'to-timed' | null } {
  const allDay = original.allDay === draft.allDay ? null : draft.allDay ? 'to-all-day' : 'to-timed';
  return { minuteDelta: original.allDay || draft.allDay ? 0 : draft.start.minute - original.start.minute, allDay };
}

const startChanged = (original: EventDraft, draft: EventDraft) =>
  original.allDay !== draft.allDay || !gregorianEquals(original.start.date, draft.start.date) || original.start.minute !== draft.start.minute;

/** How many changed or removed occurrences a retime of the whole series would drop (§4.7). */
function retimeDropped(series: SeriesContext, original: EventDraft, draft: EventDraft): number {
  if (draft.recurrence === null) return 0;
  try {
    return retimeExceptions(series.recurrence, series.overrideDates, original.start.date, draft.start.date, draft.recurrence, retimeOptions(original, draft))
      .droppedCount;
  } catch {
    return 0;
  }
}

/**
 * `editor.notice.exceptionsRemoved` under Starts (§2.11): Starts or All-day
 * changed on the first occurrence of a series with changed or removed
 * occurrences, and the retime would drop some. Null otherwise (also when the
 * change is undone in the editor).
 */
export function exceptionsRemovedNotice(series: SeriesContext | null, original: EventDraft, draft: EventDraft): string | null {
  if (series === null || !series.isFirst || !startChanged(original, draft)) return null;
  if (series.overrideDates.length + series.recurrence.exceptDates.length === 0) return null;
  const n = retimeDropped(series, original, draft);
  return n > 0 ? plural('editor.notice.exceptionsRemoved', n) : null;
}

export interface SpanChoice {
  readonly span: EditSpan;
  readonly label: string;
  /** "Save for future events" when later events would be deleted, and every delete button. */
  readonly destructive: boolean;
}

/** A question with its choices; Cancel is always added by the dialog. */
export interface SpanQuestion {
  readonly title: string;
  readonly message: string;
  /** The losses lines, said before the choice (§2.11 "Losses are said before the choice"). */
  readonly lines: readonly string[];
  readonly choices: readonly SpanChoice[];
}

/** What "Save for future events" would remove, as lines (§2.11): the later events, or changed occurrences. */
function futureLosses(series: SeriesContext, original: EventDraft, draft: EventDraft, ruleChanged: boolean): { lines: string[]; deletes: boolean } {
  if (draft.recurrence === null) {
    const n = laterCount(series);
    return { lines: [n === null ? copy('span.deletesLater.endless') : plural('span.deletesLater', n)], deletes: true };
  }
  let dropped = 0;
  if (series.isFirst) {
    dropped = startChanged(original, draft) || ruleChanged ? retimeDropped(series, original, draft) : 0;
  } else {
    try {
      dropped = splitRecurrence(series.recurrence, series.start, series.originalDate, series.overrideDates, {
        recurrence: draft.recurrence,
        start: draft.start.date,
        ruleChanged,
      }).droppedCount;
    } catch {
      dropped = 0;
    }
  }
  return { lines: dropped > 0 ? [plural('span.future.exceptionsDropped', dropped)] : [], deletes: false };
}

/**
 * The question Save asks on an occurrence of a repeating event (§2.11, §4.7):
 * this event only or future events; only future events when the repeat
 * itself changed; this event only or all events for a repeat set in another
 * app (only this event when the date moved). Losses come first.
 */
export function saveSpanQuestion(series: SeriesContext, original: EventDraft, draft: EventDraft): SpanQuestion {
  const ruleChanged = changedFields(original, draft).includes('recurrence');
  const title = copy('span.title');
  if (!series.editable && !ruleChanged) {
    if (!gregorianEquals(original.start.date, draft.start.date)) {
      return { title, message: copy('span.keep.dateMessage'), lines: [], choices: [{ span: 'this', label: copy('span.save.this'), destructive: false }] };
    }
    return {
      title,
      message: copy('span.keep.message'),
      lines: [],
      choices: [
        { span: 'this', label: copy('span.save.this'), destructive: false },
        { span: 'all', label: copy('span.save.all'), destructive: false },
      ],
    };
  }
  const losses = futureLosses(series, original, draft, ruleChanged);
  const future: SpanChoice = { span: 'future', label: copy('span.save.future'), destructive: losses.deletes };
  if (ruleChanged) return { title, message: copy('span.ruleChanged.message'), lines: losses.lines, choices: [future] };
  return {
    title,
    message: copy('span.save.message'),
    lines: losses.lines,
    choices: [{ span: 'this', label: copy('span.save.this'), destructive: false }, future],
  };
}

/** The delete question (§2.11): "Delete this event?", or this event only / all future events for an occurrence. */
export function deleteQuestion(repeating: boolean): SpanQuestion {
  if (!repeating) {
    return { title: copy('delete.single.title'), message: '', lines: [], choices: [{ span: 'all', label: copy('delete.single.button'), destructive: true }] };
  }
  return {
    title: copy('span.title'),
    message: copy('delete.repeating.message'),
    lines: [],
    choices: [
      { span: 'this', label: copy('delete.repeating.this'), destructive: true },
      { span: 'future', label: copy('delete.repeating.future'), destructive: true },
    ],
  };
}

/**
 * Alerts after the calendar changed (§2.11): a calendar that keeps fewer
 * alerts drops the extra ones at once, with `editor.notice.alertsTrimmed` or
 * `editor.notice.alertsRemoved`.
 */
export function trimAlarms(alarms: readonly Alarm[], calendar: CalendarInfo | null): { readonly alarms: readonly Alarm[]; readonly notice: string | null } {
  const max = calendar?.maxAlarms ?? null;
  if (max === null || alarms.length <= max) return { alarms, notice: null };
  const name = calendar!.title;
  if (max === 0) return { alarms: [], notice: copy('editor.notice.alertsRemoved', { 'calendar name': name }) };
  return { alarms: alarms.slice(0, max), notice: copy('editor.notice.alertsTrimmed', { 'calendar name': name }) };
}

/**
 * Duplicate (§2.10): an unsaved draft with the event's fields, without its
 * repeat, invitees or identifiers, in the same calendar when it is writable,
 * else the default calendar.
 */
export function duplicateDraft(resolved: ResolvedOccurrence, calendars: readonly StoreCalendar[], defaultCalendarId: string | null): EventDraft {
  const own = calendars.find((c) => c.id === resolved.draft.calendarId);
  const calendarId = own?.writable === true ? own.id : (defaultCalendarId ?? calendars.find((c) => c.writable)?.id ?? resolved.draft.calendarId);
  const target = calendars.find((c) => c.id === calendarId) ?? null;
  return {
    ...resolved.draft,
    calendarId,
    recurrence: null,
    alarms: trimAlarms(resolved.draft.alarms, target).alarms,
  };
}

/** "Changed" means different from the draft the editor opened with (§2.11). */
export function isDirty(opened: EventDraft, draft: EventDraft): boolean {
  try {
    return changedFields(opened, draft).length > 0;
  } catch {
    return true;
  }
}
