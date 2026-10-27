/**
 * Events engine (docs/EVENTS.md §5): wall-clock times and zones, the event
 * model, `RRULE`s and the Android date lists, 13-month repeats, recurrence,
 * series expansion and the layouts of the Calendar views. Pure, zero
 * dependencies; time zone data comes from the platform through
 * {@link ZoneResolver}.
 *
 * This is the public surface of the events engine, exactly the normative API
 * of §5.2 (plus `DateListForm`). `@thirteen/core` re-exports every name here;
 * the helpers the modules share (validation, copying, absolute minutes, the
 * RRULE candidate generator) stay internal.
 * @module
 */

export {
  type LocalDateTime,
  type ZoneResolver,
  addMinutesLocal,
  compareLocalDateTime,
  diffMinutesLocal,
  displayEnd,
  formatLocalDateTime,
  localDateTime,
  normalizeEventEnd,
  occurrenceDays,
  parseLocalDateTime,
  tryParseLocalDateTime,
  utcToZoned,
  zonedToUtc,
} from './time.ts';

export {
  type Alarm,
  type AlarmPreset,
  type Availability,
  type CalendarAccountKind,
  type CalendarEvent,
  type CalendarInfo,
  type DraftField,
  type DraftIssue,
  type EventDraft,
  type EventOccurrence,
  type EventStatus,
  type ReadOnlyReason,
  type RepeatChange,
  alarmFireTime,
  alarmPresets,
  applyToSeries,
  changedFields,
  describeAlarm,
  mergeDraft,
  moveDraftStart,
  newEventDraft,
  setDraftAllDay,
  validateDraft,
} from './model.ts';

export {
  type Frequency,
  type RRule,
  type RRuleUntil,
  type WeekdayNum,
  formatRRule,
  formatUntil,
  parseRRule,
  rruleEquals,
  tryParseRRule,
  untilEndDate,
  untilInZone,
} from './rrule.ts';

export { type DateListForm, type DateListValue, formatDateList, parseDateList } from './date-lists.ts';

export {
  type RdatePart,
  type RuleUriExtras,
  type ThirteenEncoding,
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
  thirteenRuleDatesInYear,
  thirteenRuleFor,
  thirteenRuleIncludes,
  thirteenRuleRdateParts,
  thirteenRuleRdates,
} from './thirteen-rules.ts';

export {
  type EndedRule,
  type EventRecurrence,
  type ExceptionMap,
  type ExpandedDate,
  type Expansion,
  type ExpansionWindow,
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
  matchRepeatPreset,
  nextOccurrences,
  recognizeRecurrence,
  recurrenceToRRule,
  repeatPresets,
  retimeExceptions,
  splitRecurrence,
} from './recurrence.ts';

export {
  type DeviceWindow,
  type ExpandedOccurrence,
  type OverrideInput,
  type SeriesInput,
  expandSeries,
} from './occurrences.ts';

export {
  type AgendaDay,
  type AgendaItem,
  type IntercalaryBand,
  type MonthItem,
  type MonthWeekRow,
  type ThirteenMonthEventLayout,
  type TimedItem,
  type TimedOverflow,
  type WeekColumn,
  type WeekEventLayout,
  type YearMark,
  agenda,
  formatChipTime,
  layoutDayEvents,
  layoutThirteenMonthEvents,
  layoutThirteenWeekEvents,
  monthColumnGregorianWeekdays,
  yearEventMarks,
} from './layout.ts';
