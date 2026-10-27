/**
 * Drag edits as plain functions (docs/EVENTS.md §2.4, §2.5, §2.6, §2.11 "Drag
 * edits"): the moved draft (a change of the time group only, applied to the
 * freshly fetched event), the span question a repeating occurrence asks before
 * anything is held (with the repeat change, the later events it deletes and the
 * changed single events it removes, all said before the choice), the
 * validation that refuses a drop, and the toast text. No React, so every rule
 * is tested without a browser (moves.test.ts).
 */

import {
  type CalendarInfo,
  type CalendarSystemId,
  type DraftIssue,
  type EventDraft,
  type EventRecurrence,
  type GregorianDate,
  type LocalDateTime,
  type OriginalDate,
  type RepeatChange,
  type ZoneResolver,
  addGregorianDays,
  addMinutesLocal,
  changedFields,
  compareLocalDateTime,
  describeRecurrence,
  diffMinutesLocal,
  displayEnd,
  formatThirteen,
  gregorianEquals,
  laterOccurrenceCount,
  moveDraftStart,
  normalizeEventEnd,
  retimeExceptions,
  setDraftAllDay,
  splitRecurrence,
  toJulianDayNumber,
  toThirteen,
  utcToZoned,
  validateDraft,
  zonedToUtc,
} from '@thirteen/core';
import { type EditSpan, type ResolvedOccurrence, copy, formatTime, plural } from '@thirteen/ui';

/** Where a dragged event was dropped, in the device's wall clock (what the views show). */
export type MoveTarget =
  /** Month: another day, same time; `from` is the day it was picked up on (a multi-day bar keeps its offset). */
  | { readonly kind: 'day'; readonly date: GregorianDate; readonly from: GregorianDate }
  /** The all-day row of Week or Day: an all-day bar moves by days (from the picked-up day); a timed block becomes all-day on `date`. */
  | { readonly kind: 'all-day'; readonly date: GregorianDate; readonly from: GregorianDate }
  /** The timeline: the new start (snapped to 15 minutes); an all-day event becomes one hour long there. */
  | { readonly kind: 'timed'; readonly start: LocalDateTime }
  /** A block's bottom edge: the new end (snapped to 15 minutes). */
  | { readonly kind: 'end'; readonly end: LocalDateTime };

export interface MoveContext {
  /** The IANA zone the views are drawn in (the store's `deviceZone`). */
  readonly deviceZone: string;
  readonly zones: ZoneResolver;
  readonly systemId: CalendarSystemId;
}

export interface MovedDraft {
  /** The draft with the moved time group and, where the start's date changed, the adapted repeat (`moveDraftStart`). */
  readonly draft: EventDraft;
  readonly repeatChange: RepeatChange;
  /** The occurrence's new start and all-day setting in the device's wall clock, for the toast and Duplicate. */
  readonly start: LocalDateTime;
  readonly allDay: boolean;
}

const MINUTES_PER_DAY = 1440;

/** A device wall clock in the event's zone (floating events and events in the device's zone keep it). */
export function inEventZone(value: LocalDateTime, zone: string | null, context: MoveContext): LocalDateTime | null {
  if (zone === null || zone === context.deviceZone) return value;
  const utc = zonedToUtc(displayEnd(value), context.deviceZone, context.zones);
  return utc === null ? null : utcToZoned(utc, zone, context.zones);
}

/** An event zone wall clock in the device's zone. */
export function inDeviceZone(value: LocalDateTime, zone: string | null, context: MoveContext): LocalDateTime | null {
  if (zone === null || zone === context.deviceZone) return value;
  const utc = zonedToUtc(displayEnd(value), zone, context.zones);
  return utc === null ? null : utcToZoned(utc, context.deviceZone, context.zones);
}

/** Whether the platform's zone data knows a zone (a file-defined `TZID` such as Outlook's "Customized Time Zone" it does not). */
function knownZone(zone: string, context: MoveContext): boolean {
  try {
    return context.zones.isKnown(zone) === true;
  } catch {
    return false;
  }
}

/**
 * A dropped device wall clock in the event's zone. For a zone only the event's
 * own file defines (§3.3: the store keeps the file's `TZID`), the drop moves
 * the event by the same number of minutes it moved on screen, from where the
 * occurrence was (`anchor`: the same moment in both wall clocks).
 */
function droppedInEventZone(
  value: LocalDateTime,
  zone: string | null,
  context: MoveContext,
  anchor: { readonly device: LocalDateTime; readonly event: LocalDateTime },
): LocalDateTime | null {
  if (zone !== null && zone !== context.deviceZone && !knownZone(zone, context)) {
    return addMinutesLocal(anchor.event, diffMinutesLocal(value, anchor.device));
  }
  return inEventZone(value, zone, context);
}

function sameTimeGroup(a: EventDraft, b: EventDraft): boolean {
  return !changedFields(a, b).includes('time');
}

function dayDelta(to: GregorianDate, from: GregorianDate): number {
  return toJulianDayNumber(to) - toJulianDayNumber(from);
}

/**
 * The draft after a drop (§2.11: "The move is a change of the time group only,
 * applied to the freshly fetched event"). `draft` is the resolved draft (event
 * zone), `occurrence` its start and end in the device's wall clock. `null` when
 * the drop changes nothing or cannot be expressed (a time that leaves years 1 to
 * 9999 through a zone).
 */
export function movedDraft(
  draft: EventDraft,
  occurrence: { readonly allDay: boolean; readonly start: LocalDateTime; readonly end: LocalDateTime },
  target: MoveTarget,
  context: MoveContext,
): MovedDraft | null {
  let result: { draft: EventDraft; repeatChange: RepeatChange } | null = null;
  let start: LocalDateTime = occurrence.start;
  let allDay = occurrence.allDay;
  try {
    switch (target.kind) {
      case 'day': {
        const delta = dayDelta(target.date, target.from);
        if (delta === 0) return null;
        start = { date: addGregorianDays(occurrence.start.date, delta), minute: occurrence.start.minute };
        result = moveDraftStart(draft, { date: addGregorianDays(draft.start.date, delta), minute: draft.start.minute }, context.systemId);
        break;
      }
      case 'all-day': {
        allDay = true;
        if (draft.allDay) {
          const delta = dayDelta(target.date, target.from);
          if (delta === 0) return null;
          start = { date: addGregorianDays(occurrence.start.date, delta), minute: 0 };
          result = moveDraftStart(draft, { date: addGregorianDays(draft.start.date, delta), minute: 0 }, context.systemId);
        } else {
          // A timed block dropped on the all-day row turns all-day on that day (§2.5); Show as stays (time group only).
          const whole = setDraftAllDay(draft, true, { availabilityTouched: true });
          start = { date: target.date, minute: 0 };
          result = moveDraftStart(whole, { date: target.date, minute: 0 }, context.systemId);
        }
        break;
      }
      case 'timed': {
        allDay = false;
        start = target.start;
        if (draft.allDay) {
          // An all-day bar dropped on the timeline becomes one hour at the dropped time, in the device's zone.
          const timed = setDraftAllDay(draft, false, {
            previousTimes: { start: 0, end: 60 },
            availabilityTouched: true,
            timeZone: context.deviceZone,
          });
          const oneHour: EventDraft = { ...timed, end: normalizeEventEnd(timed.start, addMinutesLocal(timed.start, 60)) };
          result = moveDraftStart(oneHour, target.start, context.systemId);
        } else {
          const zoned = droppedInEventZone(target.start, draft.timeZone, context, { device: occurrence.start, event: draft.start });
          if (zoned === null) return null;
          result = moveDraftStart(draft, zoned, context.systemId);
        }
        break;
      }
      case 'end': {
        if (draft.allDay) return null;
        const zoned = droppedInEventZone(target.end, draft.timeZone, context, { device: occurrence.end, event: draft.end });
        if (zoned === null) return null;
        const minimum = addMinutesLocal(draft.start, 15);
        const end = compareLocalDateTime(zoned, minimum) < 0 ? minimum : zoned;
        result = { draft: { ...draft, end: normalizeEventEnd(draft.start, end) }, repeatChange: 'none' };
        break;
      }
    }
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
  if (result === null || sameTimeGroup(draft, result.draft)) return null;
  return { draft: result.draft, repeatChange: result.repeatChange, start, allDay };
}

/** The 15-minute grid of the timelines (§2.5). */
export const SNAP_MINUTES = 15;

/** Rounds a wall clock to the nearest 15 minutes. */
export function snapLocal(value: LocalDateTime): LocalDateTime {
  const minute = Math.round(value.minute / SNAP_MINUTES) * SNAP_MINUTES;
  if (minute >= MINUTES_PER_DAY) return { date: addGregorianDays(value.date, 1), minute: minute - MINUTES_PER_DAY };
  return { date: value.date, minute };
}

/** A minute on a timeline column (it may run before 00:00 or past 24:00) as a wall clock. */
export function columnTime(date: GregorianDate, minute: number): LocalDateTime {
  return addMinutesLocal({ date, minute: 0 }, Math.round(minute));
}

/** `{date}` of §2.19: the 13-month date with weekday and year ("Thursday, October 13, 2026", "Year Day 2026"). */
export function longThirteen(date: GregorianDate, systemId: CalendarSystemId): string {
  return formatThirteen(toThirteen(date, systemId), { style: 'long', includeWeekday: true });
}

/** Repeats set in another app (`editable: false`, §4.5) keep their rule, so a drag moves one occurrence only. */
export function isEditableRecurrence(recurrence: EventRecurrence): boolean {
  return (recurrence.rule.kind === 'rrule' || recurrence.rule.kind === 'thirteen') && recurrence.extraDates.length === 0;
}

/** The text an issue shows when it refuses a drop (§2.11 Validation: "the issue's text shows as a toast"). */
export function issueText(issue: DraftIssue): string {
  switch (issue) {
    case 'end-before-start':
      return copy('editor.error.endBeforeStart');
    case 'out-of-range':
      return copy('editor.error.outOfRange');
    case 'until-before-start':
      return copy('editor.error.untilBeforeStart');
    case 'count-out-of-range':
      return copy('editor.error.countRange', { max: 999 });
    case 'invalid-url':
      return copy('editor.error.url');
    case 'calendar-read-only':
      return copy('editor.error.readOnlyCalendar');
    default:
      return copy('calendar.commitFailed.move');
  }
}

/** One button of the span question. */
export interface MoveChoice {
  readonly id: 'this' | 'future';
  readonly label: string;
  /** "Move and delete later events" (§2.11: destructive style). */
  readonly destructive: boolean;
  readonly span: EditSpan;
  readonly draft: EventDraft;
}

export type MovePlan =
  /** Refused: the event goes back and `message` shows as a toast (§2.11 Validation). */
  | { readonly kind: 'refuse'; readonly message: string }
  /** A single event: held at once. */
  | { readonly kind: 'hold'; readonly span: EditSpan; readonly draft: EventDraft }
  /** A repeating occurrence: the span question first; nothing moves without a choice. */
  | {
      readonly kind: 'ask';
      readonly title: string;
      readonly message: string;
      /** The losses lines, said before the choice (`span.future.exceptionsDropped`). */
      readonly lines: readonly string[];
      /** In order; "Cancel" follows them. */
      readonly choices: readonly MoveChoice[];
    };

export interface PlanInput {
  readonly resolved: ResolvedOccurrence;
  readonly moved: MovedDraft;
  /** The calendar the event is in (writable, `thirteenRepeats`). */
  readonly calendar: CalendarInfo;
  /** The series' changed occurrences (`EventStore.overrideDates`), for the losses line. */
  readonly overrideDates: readonly OriginalDate[];
  readonly systemId: CalendarSystemId;
}

/**
 * What a drop asks before it is held (§2.11 "Drag edits"): nothing for a single
 * event; for a repeating occurrence "Move this event only" or "Move future
 * events", with the repeat change (`converted`: `span.move.changesRepeat`,
 * `dropped`: `span.move.dropsRepeat` with the count of `laterOccurrenceCount`),
 * the changed single events "future events" would remove, `span.move.notAllowed`
 * when the calendar cannot keep the adapted repeat, and only "this event" for
 * repeats set in another app. Any other `validateDraft` issue refuses the drop.
 */
export function planMove({ resolved, moved, calendar, overrideDates, systemId }: PlanInput): MovePlan {
  const { event, occurrence, isFirst } = resolved;
  const recurrence = event.recurrence;
  if (!occurrence.recurring || recurrence === null) {
    const issues = validateDraft(moved.draft, calendar);
    if (issues.length > 0) return { kind: 'refuse', message: issueText(issues[0]!) };
    return { kind: 'hold', span: 'all', draft: moved.draft };
  }

  // This occurrence only: an override never repeats, so its draft carries no repeat (the stores write none).
  const thisDraft: EventDraft = { ...moved.draft, recurrence: null };
  const thisIssues = validateDraft(thisDraft, calendar);
  if (thisIssues.length > 0) return { kind: 'refuse', message: issueText(thisIssues[0]!) };
  const thisChoice: MoveChoice = { id: 'this', label: copy('span.move.this'), destructive: false, span: 'this', draft: thisDraft };
  const title = copy('span.title');
  const only = (message: string): MovePlan => ({ kind: 'ask', title, message, lines: [], choices: [thisChoice] });

  if (!isEditableRecurrence(recurrence)) return only(copy('span.move.keep.message'));

  const futureIssues = validateDraft(moved.draft, calendar);
  if (futureIssues.includes('thirteen-repeat-not-allowed')) return only(copy('span.move.notAllowed', { calendar: calendar.title }));
  if (futureIssues.length > 0) return { kind: 'refuse', message: issueText(futureIssues[0]!) };

  const date = longThirteen(moved.start.date, systemId);
  const lines: string[] = [];
  const removed = droppedChanges(resolved, moved, overrideDates);
  if (removed > 0) lines.push(plural('span.future.exceptionsDropped', removed));

  const future = (label: string, destructive = false): MoveChoice => ({
    id: 'future',
    label,
    destructive,
    span: 'future',
    draft: moved.draft,
  });

  switch (moved.repeatChange) {
    case 'converted':
      return {
        kind: 'ask',
        title,
        message: copy('span.move.changesRepeat', {
          date,
          description: describeRecurrence(moved.draft.recurrence!, moved.draft.start.date, systemId),
        }),
        lines,
        choices: [thisChoice, future(copy('span.move.futureChange'))],
      };
    case 'dropped': {
      let message: string;
      if (isFirst) message = copy('span.move.dropsRepeat.first', { date });
      else {
        const later = laterOccurrenceCount(recurrence, event.start.date, occurrence.originalDate);
        message = later === null ? copy('span.move.dropsRepeat.endless', { date }) : plural('span.move.dropsRepeat', later, { date });
      }
      return { kind: 'ask', title, message, lines, choices: [thisChoice, future(copy('span.move.deleteLater'), true)] };
    }
    default:
      return { kind: 'ask', title, message: copy('span.move.message'), lines, choices: [thisChoice, future(copy('span.move.future'))] };
  }
}

/**
 * How many changed single events "Move future events" would remove (§4.7): the
 * split's `droppedCount` from a later occurrence, `retimeExceptions` from the
 * first one (every override when the series becomes one event).
 */
export function droppedChanges(resolved: ResolvedOccurrence, moved: MovedDraft, overrideDates: readonly OriginalDate[]): number {
  const { event, occurrence, draft: original, isFirst } = resolved;
  const recurrence = event.recurrence;
  if (recurrence === null || overrideDates.length === 0) return 0;
  const ruleChanged = changedFields(original, moved.draft).includes('recurrence');
  if (!isFirst) {
    const split = splitRecurrence(recurrence, event.start.date, occurrence.originalDate, overrideDates, {
      recurrence: moved.draft.recurrence,
      start: moved.draft.start.date,
      ruleChanged,
    });
    return split.droppedCount;
  }
  if (moved.draft.recurrence === null) return overrideDates.length;
  const before = event;
  const after = moved.draft;
  const allDay = before.allDay === after.allDay ? null : after.allDay ? 'to-all-day' : 'to-timed';
  const minuteDelta = after.allDay || before.allDay ? 0 : after.start.minute - before.start.minute;
  return retimeExceptions(recurrence, overrideDates, before.start.date, after.start.date, after.recurrence!, { minuteDelta, allDay })
    .droppedCount;
}

/**
 * The toast after a move (§2.11 Toast): "Event moved to {date}." (another day,
 * or an all-day event), "Event moved to {time}." (same day, new time) or
 * "Event moved to {date} at {time}."; a changed end is "Event saved.".
 */
export function movedMessage(
  before: { readonly allDay: boolean; readonly start: LocalDateTime },
  moved: Pick<MovedDraft, 'start' | 'allDay'>,
  kind: MoveTarget['kind'],
  use24Hour: boolean,
  systemId: CalendarSystemId,
): string {
  if (kind === 'end') return copy('calendar.saved');
  const date = longThirteen(moved.start.date, systemId);
  const time = formatTime(moved.start.minute, use24Hour);
  const dayChanged = !gregorianEquals(before.start.date, moved.start.date);
  if (moved.allDay) return copy('calendar.moved.day', { date });
  const timeChanged = before.allDay || before.start.minute !== moved.start.minute;
  if (dayChanged && timeChanged) return copy('calendar.moved.dayTime', { date, time });
  if (dayChanged) return copy('calendar.moved.day', { date });
  return copy('calendar.moved.time', { time });
}

/** Minutes between two wall clocks (for drag offsets). */
export function minutesBetween(a: LocalDateTime, b: LocalDateTime): number {
  return diffMinutesLocal(a, b);
}
