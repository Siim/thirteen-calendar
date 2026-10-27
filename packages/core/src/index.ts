/**
 * `@thirteen/core` — pure TypeScript engine for perennial 13 × 28 calendars
 * (International Fixed Calendar = `'ifc'`, Positivist = `'positivist'`).
 *
 * Conventions (see docs/SPEC.md §4):
 * - Dates are plain data. `GregorianDate` is `{ year, month 1…12, day }`;
 *   `ThirteenDate` stores the **Gregorian** year and is either a month date
 *   `{ kind: 'month', system, year, month 1…13, day 1…28 }` or an intercalary
 *   date `{ kind: 'intercalary', system, year, id: 'year-day' | 'leap-day' }`.
 * - Every `gregorianYear` / `year` parameter is a **Gregorian** year `1…9999`,
 *   never a system display year (convert with `fromDisplayYear`).
 * - Weekdays are `0 = Sunday … 6 = Saturday`.
 * - Invalid input (including malformed option bags) throws `RangeError`;
 *   nothing clamps. Results are fresh objects that never alias an input
 *   (static system data such as month info objects is shared and frozen).
 * - Functions that need a system take `systemId` as their last positional
 *   parameter, defaulting to `DEFAULT_SYSTEM_ID` (`'ifc'`); only an optional
 *   options object may follow it.
 * - Names: Gregorian-date functions are `gregorian…` / `…Gregorian…`,
 *   13-month-date functions `thirteen…` / `…Thirteen…`; result fields that hold
 *   a month number are called `month`, the static info object `monthInfo`.
 *
 * Events (docs/EVENTS.md §5.2) are exported from here too: wall-clock times
 * (`LocalDateTime`) and zone math through a platform `ZoneResolver`, the event
 * model, `RRULE`s, 13-month repeats, recurrence, `expandSeries` and the event
 * layouts. The `.ics` module (§5.4), which only Windows and the web use, is a
 * separate entry point: `@thirteen/core/ics`.
 * @packageDocumentation
 */

export {
  type NameStyle,
  type Weekday,
  WEEKDAYS,
  WEEKDAY_NAMES,
  isWeekday,
  orderedWeekdays,
  toWeekday,
  weekdayName,
} from './weekday.ts';

export {
  type GregorianDate,
  type GregorianMonthInfo,
  GREGORIAN_MONTHS,
  MAX_JULIAN_DAY_NUMBER,
  MAX_YEAR,
  MIN_JULIAN_DAY_NUMBER,
  MIN_YEAR,
  addGregorianDays,
  assertValidGregorian,
  assertValidYear,
  compareGregorian,
  daysInGregorianMonth,
  daysInYear,
  diffGregorianDays,
  fromJSDate,
  fromJulianDayNumber,
  gregorianDate,
  gregorianDayOfYear,
  gregorianEquals,
  gregorianFromDayOfYear,
  gregorianMonthName,
  gregorianWeekday,
  isLeapYear,
  isValidGregorian,
  isValidYear,
  parseISODate,
  toISODate,
  toJSDate,
  toJulianDayNumber,
  tryParseISODate,
} from './gregorian.ts';

export {
  type CalendarDescriptor,
  type CalendarSystem,
  type CalendarSystemId,
  type GregorianCalendarInfo,
  type HistoryEvent,
  type IntercalaryDayId,
  type IntercalaryDayInfo,
  type ThirteenMonthInfo,
  CALENDAR_SYSTEMS,
  CALENDAR_SYSTEM_IDS,
  DEFAULT_SYSTEM_ID,
  GREGORIAN_CALENDAR,
  IFC,
  INTERCALARY_DAY_IDS,
  POSITIVIST,
  getCalendarSystem,
  intercalaryDayInfo,
  isCalendarSystemId,
  isIntercalaryDayId,
  thirteenMonthInfo,
} from './systems/index.ts';

export {
  type IntercalaryOccurrence,
  type ThirteenDate,
  type ThirteenIntercalaryDate,
  type ThirteenMonthDate,
  type ThirteenSlot,
  DAYS_PER_MONTH,
  DAYS_PER_WEEK,
  MONTHS_PER_YEAR,
  MONTH_DAYS_PER_YEAR,
  WEEKS_PER_MONTH,
  addThirteenDays,
  addThirteenMonths,
  assertValidThirteenDate,
  compareThirteen,
  convertThirteen,
  createIntercalaryDate,
  createMonthDate,
  displayYearRange,
  fixedWeekday,
  fromDisplayYear,
  fromThirteen,
  intercalaryDayOfYear,
  intercalaryDaysInYear,
  isIntercalaryDate,
  isMonthDate,
  isValidThirteenDate,
  monthDays,
  sameSlotInYear,
  thirteenDayOfYear,
  thirteenDisplayYear,
  thirteenEquals,
  thirteenFromDayOfYear,
  thirteenSlots,
  thirteenWeekday,
  toDisplayYear,
  toThirteen,
} from './thirteen.ts';

export {
  type Comparison,
  type GregorianLabelLookup,
  type ThirteenLabelLookup,
  compare,
  daysUntilYearDay,
  lookupGregorianLabel,
  lookupThirteenLabel,
  sameLabelInGregorian,
  sameLabelInThirteen,
} from './compare.ts';

export {
  type DayCell,
  type GregorianDayCell,
  type GregorianMonthLayout,
  type GregorianMonthOptions,
  type ThirteenMonthLayout,
  type ThirteenYearLayout,
  buildGregorianMonth,
  buildThirteenMonth,
  buildThirteenYear,
} from './layout.ts';

export {
  type GregorianMonthSpan,
  type MonthAlignment,
  type ThirteenMonthSpan,
  monthAlignment,
} from './alignment.ts';

export { type DatePair, type YearStats, yearStats } from './stats.ts';

export {
  type DateStyle,
  type FormatOptions,
  formatGregorian,
  formatNumericYear,
  formatThirteen,
  ordinal,
  parseThirteen,
  tryParseThirteen,
} from './format.ts';

export { type NotableDate, type NotableDateInYear, NOTABLE_DATES, notableDatesInYear } from './notable.ts';

// Events (docs/EVENTS.md §5.2): the same names as src/events/index.ts, which
// test/events/public-api.test.ts keeps in step with this list.
export {
  // time.ts
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
  // model.ts
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
  // rrule.ts
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
  // date-lists.ts
  type DateListForm,
  type DateListValue,
  formatDateList,
  parseDateList,
  // thirteen-rules.ts
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
  // recurrence.ts
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
  // occurrences.ts
  type DeviceWindow,
  type ExpandedOccurrence,
  type OverrideInput,
  type SeriesInput,
  expandSeries,
  // layout.ts
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
} from './events/index.ts';
