# @thirteen/core — public API

> Generated from the engine implementation; see `src/` for TSDoc, `docs/SPEC.md` for the rules of the calendar engine and `docs/EVENTS.md` for events and `.ics`.

Entry points (package.json `exports`):
- `@thirteen/core` (`src/index.ts`): the calendar engine ([Calendar](#calendar)) and the events engine ([Events](#events)).
- `@thirteen/core/ics` (`src/ics/index.ts`): the `.ics` module ([ICS](#ics)), used only by Windows and the web.

Both are TypeScript source with zero runtime dependencies; `src/` typechecks with `lib: ES2022` and no DOM or Node types (`tsconfig.src.json`).

Conventions (SPEC §4.1):
- All year parameters are **Gregorian** years 1..9999, also for Positivist. Display years appear only in text, in `displayYear` fields and in toDisplayYear, fromDisplayYear and displayYearRange.
- Weekday: 0 = Sunday … 6 = Saturday.
- Invalid input, including malformed option bags, throws `RangeError`; nothing clamps.
- Results are fresh objects that never alias an input. Static system data is shared and frozen.
- `systemId` is the last positional parameter (default `'ifc'`); only an options object may follow it.
- In result fields, `month` is always a number and the info object is `monthInfo`.

## Calendar

The 13-month calendar engine (docs/SPEC.md). Exported from `@thirteen/core`.

### Weekdays (weekday.ts)
- `type Weekday = 0|1|2|3|4|5|6`; `type NameStyle = 'long'|'short'|'narrow'`
- `WEEKDAYS: readonly Weekday[]`: [0..6]
- `WEEKDAY_NAMES: {long, short, narrow: readonly string[]}`, indexed by Weekday
- `isWeekday(v: unknown): v is Weekday`
- `toWeekday(n: number): Weekday`: true modulo 7
- `weekdayName(w: Weekday, style: NameStyle = 'long'): string`
- `orderedWeekdays(weekStartsOn: Weekday = 0): Weekday[]`: the 7 weekdays in display order

### Gregorian (gregorian.ts)
- `interface GregorianDate {year, month 1..12, day}`
- `interface GregorianMonthInfo {index 1..12, name, shortName, narrowName}`
- `GREGORIAN_MONTHS: readonly GregorianMonthInfo[]`: index i holds month i+1
- `MIN_YEAR = 1`, `MAX_YEAR = 9999`
- `MIN_JULIAN_DAY_NUMBER = 1721426`, `MAX_JULIAN_DAY_NUMBER = 5373484`
- `isValidYear(v): v is number`; `assertValidYear(v)`
- `isLeapYear(year): boolean`: the Gregorian rule, shared by all systems
- `daysInYear(year): 365|366`
- `daysInGregorianMonth(year, month): number`
- `gregorianMonthName(month 1..12, style: NameStyle = 'long'): string`
- `isValidGregorian(v): v is GregorianDate`; `assertValidGregorian(v)`
- `gregorianDate(year, month, day): GregorianDate`: validated constructor
- `gregorianDayOfYear(date): number`: 1..366
- `gregorianFromDayOfYear(year, dayOfYear): GregorianDate`
- `toJulianDayNumber(date): number`; `fromJulianDayNumber(jdn): GregorianDate`
- `gregorianWeekday(date): Weekday`: the real weekday
- `addGregorianDays(date, days): GregorianDate`
- `diffGregorianDays(a, b): number`: a − b
- `compareGregorian(a, b): -1|0|1`; `gregorianEquals(a, b): boolean`
- `toISODate(date): 'YYYY-MM-DD'`
- `parseISODate(text): GregorianDate`: strict; throws on bad text
- `tryParseISODate(text): GregorianDate | null`
- `fromJSDate(d: Date): GregorianDate`: local calendar date
- `toJSDate(date): Date`: first local instant of the day (midnight, or 01:00 if DST skips midnight). Throws RangeError if the local zone skipped the whole day (e.g. Pacific/Apia 2011-12-30).

### Systems (systems/*)
- `type CalendarSystemId = 'ifc'|'positivist'`; `type IntercalaryDayId = 'year-day'|'leap-day'`
- `interface ThirteenMonthInfo {index 1..13, name, shortName, gregorianNameEquivalent: number|null, meaning?}`
- `interface IntercalaryDayInfo {id, code: 'YD'|'LD', name, shortName, description, leapOnly, afterMonth, dayOfYear: {common: number|null, leap: number}}`
- `interface HistoryEvent {year, text}`
- `interface CalendarDescriptor {name, shortName, inventor, proposedYear, summary, history: readonly HistoryEvent[]}`
- `interface CalendarSystem extends CalendarDescriptor {id, months (13), weekStartsOn: Weekday, yearOffset, intercalaryDays}`
- `interface GregorianCalendarInfo extends CalendarDescriptor {months: readonly GregorianMonthInfo[]}`
- `IFC`, `POSITIVIST`: frozen CalendarSystem objects
- `GREGORIAN_CALENDAR`: frozen descriptor for the Compare view
- `CALENDAR_SYSTEMS` (IFC first)
- `CALENDAR_SYSTEM_IDS`: ['ifc','positivist']
- `DEFAULT_SYSTEM_ID = 'ifc'`
- `INTERCALARY_DAY_IDS`: ['year-day','leap-day']
- `isCalendarSystemId(v)`; `isIntercalaryDayId(v)`
- `getCalendarSystem(id = 'ifc'): CalendarSystem`
- `thirteenMonthInfo(month 1..13, systemId = 'ifc'): ThirteenMonthInfo`
- `intercalaryDayInfo(id, systemId = 'ifc'): IntercalaryDayInfo`

### 13-month dates (thirteen.ts)
- `interface ThirteenMonthDate {kind:'month', system, year (Gregorian), month 1..13, day 1..28}`
- `interface ThirteenIntercalaryDate {kind:'intercalary', system, year, id}`
- `type ThirteenDate = ThirteenMonthDate | ThirteenIntercalaryDate`
- `interface IntercalaryOccurrence {id, code, name, shortName, description, leapOnly, afterMonth, thirteen, gregorian, dayOfYear, gregorianWeekday}`
- `type ThirteenSlot = {kind:'month', month, monthInfo} | {kind:'intercalary', id, occurrence}`
- Constants: `DAYS_PER_MONTH = 28`, `MONTHS_PER_YEAR = 13`, `DAYS_PER_WEEK = 7`, `WEEKS_PER_MONTH = 4`, `MONTH_DAYS_PER_YEAR = 364`
- `isValidThirteenDate(v)`; `assertValidThirteenDate(v)`
- `isMonthDate(d)`; `isIntercalaryDate(d)`: type guards on `kind`
- `createMonthDate(gregorianYear, month, day, systemId = 'ifc'): ThirteenMonthDate`
- `createIntercalaryDate(gregorianYear, id, systemId = 'ifc'): ThirteenIntercalaryDate`
- `intercalaryDayOfYear(gregorianYear, id, systemId): number | null`
- `intercalaryDaysInYear(gregorianYear, systemId): IntercalaryOccurrence[]`: chronological
- **NEW** `thirteenSlots(gregorianYear, systemId): ThirteenSlot[]`: picker order. IFC leap year: Jan…Jun, Leap Day, Sol…Dec, Year Day. Positivist leap year: Moses…Bichat, All the Dead, Holy Women.
- **NEW** `sameSlotInYear(date, gregorianYear): ThirteenDate | null`: null when the slot doesn't exist that year
- `thirteenFromDayOfYear(gregorianYear, dayOfYear, systemId): ThirteenDate`
- `toThirteen(g, systemId = 'ifc'): ThirteenDate`; `fromThirteen(t): GregorianDate`
- `thirteenDayOfYear(t): number`
- `convertThirteen(t, systemId): ThirteenDate`: same Gregorian day, other system
- `monthDays(gregorianYear, month 1..13, systemId): GregorianDate[28]`
- **NEW** `addThirteenDays(t, days): ThirteenDate`: via the Gregorian day; intercalary days count
- **NEW** `addThirteenMonths(t, months): ThirteenMonthDate`: keeps the day, rolls over years; throws for intercalary input
- `fixedWeekday(day 1..28, systemId): Weekday`
- `thirteenWeekday(t): Weekday | null`
- `toDisplayYear(gregorianYear, systemId): number`
- `fromDisplayYear(displayYear, systemId): number`: returns the Gregorian year
- **NEW** `displayYearRange(systemId): {min, max}`: IFC 1..9999, Positivist -1787..8211
- `thirteenDisplayYear(t): number` (renamed from displayYear)
- `thirteenEquals(a, b)`
- `compareThirteen(a, b): -1|0|1`: chronological across systems

### Comparison (compare.ts)
- `interface Comparison {gregorian, thirteen, dayOfYear, isLeapYear, gregorianWeekday, thirteenWeekday, weekdayShift, labelDrift, gregorianMonthDays, thirteenMonthDays, daysIntoYear, daysRemainingInYear, yearProgress}`
  - daysIntoYear = dayOfYear − 1
  - daysRemainingInYear = daysInYear − dayOfYear
  - yearProgress = daysIntoYear / daysInYear, in [0,1)
- `compare(g, systemId = 'ifc'): Comparison`
- `sameLabelInGregorian(t): GregorianDate | null`
- `sameLabelInThirteen(g, systemId): ThirteenMonthDate | null`
- `interface GregorianLabelLookup {gregorian, fallsOn, sameLabel, sameLabelFallsOn}`
- `lookupGregorianLabel(g, systemId): GregorianLabelLookup`
- `interface ThirteenLabelLookup {thirteen, fallsOn, sameLabel, sameLabelFallsOn}`
- `lookupThirteenLabel(t): ThirteenLabelLookup`: `thirteen` is now a fresh normalised copy
- `daysUntilYearDay(g, systemId): number`: 0 on the year-day itself; Positivist leap 31 Dec → 365

### Layout (layout.ts)
- `interface DayCell {thirteen, gregorian, dayOfYear, thirteenWeekday, gregorianWeekday, isGregorianMonthStart}`
- `interface ThirteenMonthLayout {year, system, month: number, monthInfo, weekdays, weeks: DayCell[4][7]}`
- `interface ThirteenYearLayout {year, displayYear, system, isLeapYear, daysInYear, weekdays, months[13], intercalary: IntercalaryOccurrence[]}`
- `interface GregorianDayCell {gregorian, thirteen, dayOfYear, gregorianWeekday, thirteenWeekday: Weekday|null, isThirteenMonthStart}`
- `interface GregorianMonthLayout {year, month: number, monthInfo, system, weekStartsOn, weekdays, leadingBlanks, weeks: (GregorianDayCell|null)[4..6][7]}`
- `interface GregorianMonthOptions {weekStartsOn?: Weekday}`
- `buildThirteenMonth(gregorianYear, month, systemId)`
- `buildThirteenYear(gregorianYear, systemId)`
- `buildGregorianMonth(gregorianYear, month, systemId = 'ifc', options?: GregorianMonthOptions)`: weekStartsOn defaults to the system's week start (IFC Sunday, Positivist Monday)

### Alignment (alignment.ts)
- `interface ThirteenMonthSpan {month: number, monthInfo, start: GregorianDate, end, startDayOfYear, endDayOfYear, length: 28}`
- `interface GregorianMonthSpan {month: number, monthInfo, start: ThirteenDate, end: ThirteenDate, startDayOfYear, endDayOfYear, length}`
- `interface MonthAlignment {year, displayYear, system, isLeapYear, daysInYear, thirteenMonths[13], gregorianMonths[12], intercalary}`
- `monthAlignment(gregorianYear, systemId): MonthAlignment`

### Stats (stats.ts)
- `interface DatePair {gregorian, thirteen}`
- `interface YearStats {year, displayYear, system, isLeapYear, daysInYear, gregorianMonthLengths[12], thirteenMonthLengths[13], gregorianFriday13ths: DatePair[], thirteenFriday13ths: DatePair[], gregorianMonthShapeCount, thirteenMonthShapeCount: 1, gregorianQuarterLengths[4], thirteenQuarterLengths [91,91,91,91], gregorianYearStartWeekday, thirteenYearStartWeekday, intercalaryDayCount}`
- `yearStats(gregorianYear, systemId): YearStats`

### Formatting and parsing (format.ts)
- `type DateStyle = 'long'|'medium'|'short'|'numeric'`
- `interface FormatOptions {style?, includeYear?: boolean, includeWeekday?: boolean}`: validated strictly; unknown keys and non-booleans throw
- `formatThirteen(t, options?): string`. Examples: 'October 12, 2026', 'Oct 12, 2026', 'Oct 12', numeric '2026-M11-12', 'Year Day 2026', '2026-YD', '0238-M11-12', '-1787-YD'
- `formatGregorian(g, options?): string`: numeric is ISO
- `formatNumericYear(n): string`: '0238', '0000', '-1787'
- **NEW** `parseThirteen(text, systemId = 'ifc'): ThirteenDate`: strict inverse of the full numeric form, using the display year
- **NEW** `tryParseThirteen(text, systemId): ThirteenDate | null`
- `ordinal(n): string`

### Notable dates (notable.ts)
- `interface NotableDate {id, name, month, day}`
- `NOTABLE_DATES`: frozen, 8 entries
- `interface NotableDateInYear {notable, gregorian, thirteen, sameLabel}`
- `notableDatesInYear(gregorianYear, systemId)`

## Events

The events engine (docs/EVENTS.md §5.2, normative; `src/events/`). Exported from `@thirteen/core`. Ported to Swift, Kotlin and C# under the names of EVENTS.md §5.7 and kept in parity by `fixtures/events.json` (§5.5).

Conventions (EVENTS.md §3.1, §5.2), on top of the ones above:
- Everything is **wall clock**. `LocalDateTime` carries no zone; a value means the wall clock of the event's zone, the device's zone or UTC, as each function says. Time zone data comes only from the platform, through a `ZoneResolver`; every conversion rule lives in core (`zonedToUtc`, `utcToZoned`).
- Ends are exclusive and in **end-of-day form** (§3.1.1): an end at `D+1 T00:00` later than its start is written `D T24:00`, so an all-day event on 9999-12-31 ends `9999-12-31T24:00`. Minute `1440` appears only in ends.
- Text forms: dates `YYYY-MM-DD`, wall clocks `YYYY-MM-DDTHH:MM` (also the JSON forms of the fixtures, whose field names equal these).
- A value that leaves years 1 to 9999 through a zone conversion gives `null` (an expanded occurrence whose start does so is dropped and counted), never a clamped date; only an occurrence's end past `9999-12-31T24:00` stops there.
- Copy (labels, descriptions, notes) is final English (US) and never contains an em or en dash.

### Times and zones (events/time.ts)
- `interface LocalDateTime {date: GregorianDate, minute 0..1440}`: 1440 (`T24:00`) only in an end
- `localDateTime(date, minute): LocalDateTime`: validated constructor
- `parseLocalDateTime(text): LocalDateTime`: strict `'2026-10-19T09:30'`, years 0001..9999; `'T24:00'` accepted, `'T24:01'` not
- `tryParseLocalDateTime(text): LocalDateTime | null`
- `formatLocalDateTime(value): string`: `'YYYY-MM-DDTHH:MM'`, minute 1440 as `T24:00`
- `compareLocalDateTime(a, b): -1|0|1`: `D T24:00` equals `D+1 T00:00`
- `addMinutesLocal(value, minutes): LocalDateTime`: wall clock, zones ignored; never returns `T24:00`; throws outside 0001-01-01T00:00..9999-12-31T23:59
- `diffMinutesLocal(a, b): number`: a - b in wall-clock minutes
- `normalizeEventEnd(start, end): LocalDateTime`: the end in end-of-day form; throws when `end` is before `start`
- `displayEnd(end): LocalDateTime`: `D T24:00` as `D+1 T00:00`, for pickers (§2.12); other values copied
- `occurrenceDays(start, end): GregorianDate[]`: the dates an occurrence covers, inclusive; a zero-length event covers its start date, one ending at midnight does not cover the next day
- `interface ZoneResolver {isKnown(tzid): boolean, offsetMinutesAt(tzid, utc: LocalDateTime): number}`: implemented per platform (Foundation, java.time, TimeZoneInfo, Intl); offsets in whole minutes east of UTC
- `zonedToUtc(local, zone, zones): LocalDateTime | null`: the gap and overlap rule of §5.2: a time in a gap moves later by the gap's length (New York 2026-03-08T02:30 is 07:30Z), an ambiguous time takes the earlier instant; null outside years 1..9999
- `utcToZoned(utc, zone, zones): LocalDateTime | null`: null outside years 1..9999

### Event model (events/model.ts)
- `type Availability = 'busy'|'free'|'tentative'|'unavailable'`; `type EventStatus = 'confirmed'|'tentative'|'canceled'`
- `type ReadOnlyReason = 'calendar'|'subscribed'|'birthday'|'invitation'|'no-write-permission'|'historical'` (§3.5)
- `type CalendarAccountKind = 'icloud'|'google'|'exchange'|'caldav'|'device'|'subscribed'|'birthdays'|'other'`
- `type Alarm = {kind:'relative', offsetMinutes} | {kind:'absolute', at: LocalDateTime}`: negative offsets are before the start; absolute alerts are device wall clock, kept but never offered
- `interface CalendarInfo {id, title, color '#rrggbb', accountId, accountTitle, accountKind, writable, thirteenRepeats: 'all'|'gregorian-only', maxAlarms: number|null, supportsAvailability, supportsUrl, isPlatformDefault}`
- `interface EventDraft {title, location, notes, url, allDay, start, end, timeZone: string|null, calendarId, recurrence: EventRecurrence|null, alarms, availability}`: what the editor edits; `''` means none; wall clock in `timeZone` (null: floating, always null for all-day); all-day runs from `T00:00` of the first day to `T24:00` of the last
- `interface CalendarEvent extends EventDraft {id, status, readOnly: ReadOnlyReason|null, organizer: {name, isCurrentUser}|null, attendeeCount, alarmsEditable, selfStatus: 'accepted'|'declined'|'tentative'|'needs-action'|null}`: a stored master or single event; ids per §3.2
- `interface EventOccurrence {key, calendarId, title, allDay, start, end}`: one occurrence in the **device's** wall clock, as the layouts take it; `key` unique per call (§3.2)
- `type DraftIssue = 'end-before-start'|'out-of-range'|'until-before-start'|'calendar-read-only'|'thirteen-repeat-not-allowed'|'too-many-alarms'|'repeat-not-on-start'|'invalid-url'|'count-out-of-range'`
- `validateDraft(draft, calendar): DraftIssue[]`: `[]` when the draft can be saved; issues in the order of the type. `out-of-range`: a start before 1583-01-01 or a timed end after 9999-12-29T24:00
- `newEventDraft(day, now, calendarId, options?: {allDay?, timeZone?}): EventDraft`: §2.11 defaults: today at the next whole hour (23:00 when that would be tomorrow), another day at 09:00, one hour, Busy; all-day: the whole day, Free
- `type RepeatChange = 'none'|'adapted'|'converted'|'dropped'`
- `moveDraftStart(draft, start, systemId?): {draft, repeatChange}`: keeps the duration and re-derives the repeat with `adaptRecurrenceToStart`
- `setDraftAllDay(draft, allDay, options?: {previousTimes?: {start, end}, availabilityTouched?, timeZone?: string|null}): EventDraft`: keeps the covered dates; all-day becomes Free and timed Busy unless `availabilityTouched`; turning all-day off takes `timeZone` (the device zone for a new event, the zone the draft had before it became all-day for an existing one; floating without it), so an on-and-off round trip changes nothing (`timeZone` is not in the §5.2 listing yet)
- `type DraftField = 'title'|'location'|'notes'|'url'|'time'|'recurrence'|'calendar'|'alarms'|'availability'`: `time` is all-day, start, end and zone
- `changedFields(a, b): DraftField[]`: the groups in which `b` differs from `a`, in `DraftField` order
- `mergeDraft(original, edited, current): {merged, written, conflicts}`: three-way merge (§2.11, §4.9): groups `edited` changed come from `edited`, the rest from `current`; platforms write only `written`
- `applyToSeries(master, opened, edited, override: EventDraft|null): {master, override, written, retime: {minuteDelta, allDay: 'to-all-day'|'to-timed'|null}|null}`: "Save for all events" (§4.7): the changes made on one occurrence applied to the series master without taking the occurrence's date; the master takes the edited start minute as an absolute time; `retime` (null when the time group is unchanged) holds the `retimeExceptions` options to apply next
- `alarmFireTime(alarm, occurrence: {allDay, start, startUtc}, deviceZone, zones): LocalDateTime | null`: when an alert fires, as UTC (§2.14): timed relative alerts exactly from `startUtc`; all-day relative and absolute alerts on the device wall clock
- `interface AlarmPreset {id, label, alarm: Alarm|null}`
- `alarmPresets(allDay, options?: {allowAfterStart?, use24Hour?}): AlarmPreset[]`: the Alert picker rows (§2.14); `use24Hour` defaults to true
- `describeAlarm(alarm, allDay, options?: {use24Hour?}): string` (the §5.2 listing) and `describeAlarm(alarm, allDay, systemId?, options?)`: `'15 minutes before'`, `'1 day before at 09:00'`, `'At 08:00 on Thursday, October 12, 2026'` (absolute alerts name the 13-month date: IFC in the first form, `systemId` in the second, which puts it before the options as SPEC §4.1 orders it)

### RRULE (events/rrule.ts)
- `type Frequency = 'secondly'|'minutely'|'hourly'|'daily'|'weekly'|'monthly'|'yearly'`
- `interface WeekdayNum {weekday: Weekday, ordinal: number|null}`: ordinal -53..-1 or 1..53
- `type RRuleUntil = {kind:'date', date} | {kind:'floating', value} | {kind:'utc', value}`
- `interface RRule {freq, interval, count, until, bySecond, byMinute, byHour, byDay, byMonthDay, byYearDay, byWeekNo, byMonth, bySetPos, wkst, rscale, skip, extensions}`: RFC 5545 §3.3.10 with RFC 7529 `RSCALE` and `SKIP`; `X-` parts kept in order as `[name, value]`
- `parseRRule(text): RRule`: optional `RRULE:` prefix and trailing `;`, names in any case and order; throws for `COUNT` with `UNTIL`, values outside their RFC range and repeated or unknown names
- `tryParseRRule(text): RRule | null`
- `formatRRule(rule): string`: canonical: `FREQ;INTERVAL (if not 1);COUNT|UNTIL;BYSECOND;BYMINUTE;BYHOUR;BYDAY;BYMONTHDAY;BYYEARDAY;BYWEEKNO;BYMONTH;BYSETPOS;WKST;RSCALE;SKIP;X-`; lists in stored order; no prefix
- `rruleEquals(a, b, options?: {ignoreEnd?, ignoreWkst?}): boolean`: lists compared as sets, RFC defaults applied (`WKST=MO`, `RSCALE=GREGORIAN`, `SKIP=OMIT`)
- `untilInZone(until, zone: string|null, zones): LocalDateTime | null`: an `UNTIL` in the event's zone, rounded down to the minute; a date until becomes `D T24:00`; floating kept
- `untilEndDate(until: LocalDateTime, startMinute): GregorianDate`: the last original date whose occurrence starts at or before `until` (§4.5)
- `formatUntil(endDate, allDay, zone: string|null, zones): string`: the `UNTIL` value that ends a rule after `endDate` (§4.4, §4.7): `yyyyMMdd` all-day, `yyyyMMddT235959` floating, 23:59:59 of `endDate` in `zone` as UTC `yyyyMMddTHHmmssZ` (Tallinn, 2026-11-09: `'20261109T215959Z'`)

### Android date lists (events/date-lists.ts)
- `type DateListValue = {kind:'date', date} | {kind:'utc', value} | {kind:'zoned', value, tzid} | {kind:'floating', value}`
- `type DateListForm = 'date'|'zoned'|'utc'`
- `parseDateList(text): DateListValue[]`: the provider's `RDATE` and `EXDATE` text (§4.4): `'20261019,20261116'`, `'Europe/Tallinn;20261116T190000,...'`, `'20261116T170000Z,...'`, several lines and mixed lists as other writers store them
- `formatDateList(values, form: DateListForm): string`: one form per list; values must already be of the form's kind

### 13-month repeats (events/thirteen-rules.ts)
- `type ThirteenRule = {kind:'monthly', system, day 1..28} | {kind:'weekly', system, weekday, interval: 1|2} | {kind:'yearly', system, month 1..13, day 1..28} | {kind:'intercalary', system, id}` (§4.2): a rule keeps the system it was made in
- `type ThirteenRuleKind = 'monthly'|'weekly'|'biweekly'|'yearly'|'intercalary'`: the picker rows; `biweekly` is weekly with interval 2
- `thirteenRuleFor(kind, start, systemId?): ThirteenRule | null`: the rule made from `start`; null when the start cannot carry the kind (monthly, weekly and yearly on an intercalary day; intercalary on any other day)
- `thirteenRuleDatesInYear(rule, year, start): GregorianDate[]`: the rule's own dates in a Gregorian year (13, 52, 26, 1, or 0 or 1); `start` fixes only the fortnight phase
- `thirteenRuleIncludes(rule, date, start): boolean`
- `type ThirteenEncodingForm = 'gregorian-yearly'|'byyearday'|'leap-interval'`: the encodings (a), (b) and (c) of §4.3
- `interface ThirteenEncoding {form, rrule, exchangeSafe, cap: GregorianDate|null}`: `rrule` without `COUNT` or `UNTIL` except the leap-interval cap; `exchangeSafe` is `form !== 'byyearday'`
- `encodeThirteenRule(rule, start): ThirteenEncoding`: the one `RRULE` of a rule (IFC monthly on the 12th: `FREQ=YEARLY;BYYEARDAY=12,40,...,-18`); throws for a start the rule does not produce
- `thirteenRuleRdates(rule, start, end: RepeatEnd, horizon, options?: {maxValues?}): {dates, truncated}`: form (d), the `RDATE` values after `start` up to the end and `horizon`; at most `maxValues` (default 400)
- `interface RdatePart {part, start, dates}`: `dates` exclude the part's start
- `thirteenRuleRdateParts(rule, start, end, horizon, options?: {maxValues?}): RdatePart[]`: the Android parts (§4.4) of `1 + maxValues` occurrences each; a later horizon only grows the last part and appends parts
- `formatThirteenRuleText(rule): string`: the `X-THIRTEEN-RULE` value without its name: `'SYSTEM=ifc;KIND=weekly;WEEKDAY=TH;INTERVAL=2'`
- `parseThirteenRuleText(text): ThirteenRule`: the strict grammar of §4.3 (e)
- `interface RuleUriExtras {series: string|null, part: number|null}`: both null or both set
- `formatThirteenRuleUri(rule, end, extras?): string`: the Android marker: `'thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never'`
- `parseThirteenRuleUri(text): {rule, end, series, part}`: strict; throws for anything else
- `formatDetachedUri(series, original): string`: `'thirteen://detached?v=1&series=...&original=2026-10-19'`, `series` percent-encoded
- `parseDetachedUri(text): {series, original} | null`: null for anything that is not a detached marker

### Recurrence (events/recurrence.ts)
- `type RepeatEnd = {kind:'never'} | {kind:'count', count} | {kind:'until', date}`
- `interface EndedRule {rrule, end}`: one `RRULE` or `EXRULE` of a `foreign` rule with its own end
- `type RepeatRule = {kind:'rrule', rrule} | {kind:'thirteen', rule} | {kind:'dates'} | {kind:'foreign', rules, exrules}`: `rrule` without `COUNT` or `UNTIL` (they live in the end); `dates`: the start plus the extra dates
- `interface ExtraDate {date, minute: number|null, durationMinutes: number|null}`: an `RDATE`; nulls mean the master's time and length
- `interface OriginalDate {date, minute: number|null}`: an `EXDATE`, `RECURRENCE-ID` or `ORIGINAL_INSTANCE_TIME`; null is the master's start minute; matched by date and minute
- `interface EventRecurrence {rule, end, extraDates, exceptDates}`
- `interface ExpansionWindow {from, to}`: dates, both inclusive
- `type ExpandedDate = ExtraDate`; `interface Expansion {occurrences: ExpandedDate[], truncated, unsupported}`
- `expandRecurrence(recurrence, start, window, options?: {limit?}): Expansion`: the original dates in the event's zone (§4.6); the start is always the first occurrence; ends apply to the rule only, extra dates are added whatever their date; a leap-only 13-month repeat (IFC Leap Day, Positivist Holy Women) stops at its leap-interval cap whatever its end, as its stored `FREQ=YEARLY;INTERVAL=4;UNTIL={cap}` does (§4.3 c); at most `limit` (default 10,000); unsupported rules (`HOURLY` and finer, `RSCALE` other than Gregorian, `SKIP`, ...) give only the start
- `nextOccurrences(recurrence, start, count): GregorianDate[]`: the next `count` dates after the start
- `endRecurrenceBefore(recurrence, start, date): EventRecurrence | null`: the series ended before `date` ("Delete all future events", the head of a split); null when nothing remains
- `laterOccurrenceCount(recurrence, start, at): number | null`: occurrences after `at` that ending the repeat there would delete; null for a series without an end (a leap-only repeat always ends, at its cap)
- `interface ExceptionMap {from: OriginalDate, to: OriginalDate|null}`: null: dropped
- `interface SplitResult {head, tail, overrides, droppedCount, dropped}`
- `splitRecurrence(recurrence, start, at, overrideDates, change?: {recurrence, start, ruleChanged}|null): SplitResult`: a "future events" change or delete (§4.7); a kept repeat carries the end on (a 10-time series split at its 4th occurrence keeps 7)
- `interface UntilRewrite {rule: 'rrule'|'exrule', index, endDate}`: a stored rule whose `UNTIL` the platform rewrites with `formatUntil`
- `retimeExceptions(recurrence, overrideDates, oldStart, newStart, newRecurrence, options?: {minuteDelta?, allDay?}): {recurrence, overrides, untils, droppedCount, dropped}`: moves the exceptions with a new start time, date, zone or all-day setting of the whole series (§4.7)
- `recurrenceToRRule(recurrence, start): RRule | null`: the one `RRULE` a repeat is written as (Gregorian, or a 13-month encoding (a) to (c)) with its end; null for `dates` and `foreign`
- `interface RepeatPreset {id, section: 'never'|'gregorian'|'thirteen', label, recurrence: EventRecurrence|null, exchangeSafe}`
- `repeatPresets(start, systemId?): RepeatPreset[]`: the repeat picker rows (§2.13); ids `'never'`, `'daily'`, `'weekly'`, `'biweekly'`, `'monthly'`, `'yearly'`, `'thirteen-monthly'`, `'thirteen-weekly'`, `'thirteen-biweekly'`, `'thirteen-yearly'`, `'thirteen-intercalary'`
- `matchRepeatPreset(recurrence|null, start, systemId?): string | null`: the checked row's id; null for Custom or Keep
- `describeRecurrence(recurrence, start, systemId?): string`: the grammar of §5.2: `'Every 2 weeks on Monday'`, `'Every IFC month on the 12th'`, `'Every Leap Day'`, `', and 2 more dates'`, `', 10 times'`, `', until December 12, 2036'`
- `describeNextOccurrences(recurrence, start, systemId?, options?: {count?}): string`: `'Next: Mon, Oct 26; Mon, Nov 2; Mon, Nov 9'`; `'Next: Gregorian Mon, Nov 16; ...'` for 13-month rules; count defaults to 3; `''` when none
- `describeRepeatNotes(recurrence, start, systemId?, options?: {gregorianOnlyCalendar?}): string[]`: the notes under the repeat picker (§5.2 table)
- `adaptRecurrenceToStart(recurrence, oldStart, newStart): {recurrence: EventRecurrence|null, change: RepeatChange}`: the §2.11 table, so no change of repeat kind is silent
- `interface RecognitionInput {start, rrules: {rrule, until}[], exrules: {rrule, until}[], rdates: ExtraDate[], exdates: OriginalDate[], marker: string|null}`: every value already in the event's zone (`until` from `untilInZone`)
- `interface Recognition {recurrence, source: 'marker'|'byyearday'|'leap-interval'|'gregorian'|'rdates'|'dates'|'foreign', editable, alternatives: ThirteenRule[], openEnded, series, part}`
- `recognizeRecurrence(input, systemId?): Recognition`: stored data back into a repeat (§4.5): marker, day-of-year list, leap interval, Gregorian, date list, anything else; `editable: false` shows "Keep: ..." and preserves the stored text. A leap-only rule is recognized (by its marker, as a leap interval or as a date list) only when its end is on or before its cap; an `UNTIL` on the cap reads as end Never, which expands the same

### Series expansion (events/occurrences.ts)
- `interface OverrideInput {id, originalDate, originalMinute: number|null, canceled, allDay, start, end, zone: string|null}`: an exception occurrence; `start` and `end` in its own `zone`
- `interface SeriesInput {id, recurrence: EventRecurrence|null, allDay, start, end, zone: string|null, overrides, duration?: {days, minutes}|null}`: a master (or single event) in its own zone, with every override; `duration` (set by `.ics` readers for a timed `DURATION` with days) makes each occurrence end its `days` later on its own wall clock, then `minutes` exactly (RFC 5545 §3.8.5.3); without it every occurrence lasts the master's exact length (not in the §5.2 listing yet)
- `interface ExpandedOccurrence {originalDate, originalMinute, overrideId: string|null, allDay, start, end, startUtc: LocalDateTime|null}`: device wall clock, end-of-day form; `originalDate` and `originalMinute` are part of the key (§3.2); `startUtc` is a timed occurrence's start instant (null for all-day), which alert planners pass to `alarmFireTime` (not in the §5.2 listing yet)
- `interface DeviceWindow {from, to}`: `[from, to)` in the device's wall clock; `to` may be `9999-12-31T24:00`
- `expandSeries(series, window, deviceZone, zones, options?: {limit?}): {occurrences, orphans, outOfRange, truncated, unsupported}`: the full pipeline of §4.6: a widened date range, `expandRecurrence`, times through the event's zone (floating series through the device's, lengths too), overrides (canceled ones remove, orphans shown on their own and listed; an original minute or excluded date that names the same instant as an occurrence, which happens around a DST gap, is that occurrence's), the device's wall clock (occurrences leaving years 1..9999 dropped and counted), then the window; sorted by start, then original date and minute

### Event layouts (events/layout.ts)
- `interface MonthItem {key, style: 'bar'|'dot', startColumn, endColumn, lane, continuesBefore, continuesAfter}`: bar: all-day or 24 hours or more; dot: a shorter timed occurrence, one per day touched
- `interface MonthWeekRow {week: 1|2|3|4, items, visibleLanes: number[7], hidden: number[7]}`
- `interface IntercalaryBand {id, gregorian, items, visibleLanes, hidden}`
- `interface ThirteenMonthEventLayout {year, month, system, columnGregorianWeekdays: Weekday[7], weeks: MonthWeekRow[4], intercalary: IntercalaryBand[]}`
- `layoutThirteenMonthEvents(year, month, occurrences, systemId?, options?: {maxLanes?}): ThirteenMonthEventLayout`: Month mode (§2.4, §5.3): lanes per week row and per intercalary band; with `maxLanes`, a full column shows `maxLanes - 1` lanes and reports the rest in `hidden` (default: unlimited)
- `monthColumnGregorianWeekdays(year, month, systemId?): Weekday[]`: the Gregorian weekday of each of the 7 columns (header line 2, also for the date picker)
- `interface TimedItem {key, column, startMinute, endMinute, clippedStart, clippedEnd, slot, slotCount, hidden}`: minutes clipped to the column's day, 0..1440
- `interface TimedOverflow {column, slot, slotCount, startMinute, endMinute, keys}`: the "+{n}" block of §2.5
- `type WeekColumn = {kind:'day', gregorian, thirteen: ThirteenMonthDate} | {kind:'intercalary', gregorian, thirteen: ThirteenIntercalaryDate}`
- `interface WeekEventLayout {columns, allDay: MonthItem[], timed, overflow}`
- `layoutThirteenWeekEvents(year, month, week, occurrences, systemId?, options?: {minDurationMinutes?, maxSlots?}): WeekEventLayout`: Week mode (§2.5): 7 columns plus the intercalary days after week 4; overlap clusters with a 15-minute minimum height by default; with `maxSlots`, one overflow per crowded cluster (default: unlimited)
- `layoutDayEvents(date, occurrences, options?: {minDurationMinutes?, maxSlots?}): {allDay: string[], timed, overflow}`: Day mode (§2.6); `allDay` holds keys
- `formatChipTime(minute, use24Hour): string`: `'09:30'`; 12-hour `'9:30a'`, `'2p'`, noon `'12p'`, midnight `'12a'`
- `interface AgendaItem {key, part: 'single'|'first'|'middle'|'last', dayIndex, dayCount, startMinute: number|null, endMinute: number|null}`
- `interface AgendaDay {gregorian, thirteen: ThirteenDate, items}`
- `agenda(occurrences, from, to, systemId?, options?: {includeEmptyDays?}): AgendaDay[]`: List mode and Up next (§2.7); every occurrence on every day it touches; empty days left out by default
- `interface YearMark {dayOfYear, gregorian, count, calendarIds}`
- `yearEventMarks(year, occurrences, options?: {maxCalendars?}): YearMark[]`: Year mode marks (§2.3): days with events only, ascending; at most `maxCalendars` (default 3) calendar ids per day

## ICS

The `.ics` module (docs/EVENTS.md §5.4; `src/ics/`), exported as **`@thirteen/core/ics`**: what Windows and the web use to store local calendars, import, export and subscribe. Ported to C# only (`windows/Thirteen.Core/Ics`) and kept in parity by `fixtures/ics/` (§5.6). It takes its zone data from a `ZoneResolver` like the events engine, and maps Windows zone ids to IANA through the embedded CLDR `windowsZones` table (Unicode License v3). Types such as `LocalDateTime`, `RRule`, `DeviceWindow` and `RecognitionInput` come from `@thirteen/core`.

Tolerant reader, strict writer (§3.6, §4.9): every component keeps the text it was read from. Groups and `VTIMEZONE`s with `raw` text are written back byte for byte; an edited group is re-serialized, and the properties of the fields the user did not touch are still written as read (from `original`).

### Types (ics/types.ts)
- `type IcsDateValue = {kind:'date', date} | {kind:'floating', value} | {kind:'utc', value} | {kind:'zoned', value, tzid}`: `tzid` as written (IANA, Windows id, or a name only the file defines)
- `interface IcsProperty {name, params: [name, value][], value}`: names in uppercase, values exactly as written
- `type IcsTrigger = {kind:'relative', minutes, related: 'start'|'end'} | {kind:'absolute', value: IcsDateValue}`
- `interface IcsAlarm {action, trigger: IcsTrigger, extra: IcsProperty[]}`
- `interface IcsRdate {value: IcsDateValue, period: string|null}`: `period` is the text after the `/` of a `VALUE=PERIOD` value
- `interface IcsEvent {uid, uidDerived, recurrenceId, sequence, summary, location, description, url, start, end, duration, rrules, exrules, rdates, exdates, status, transp, thirteenRule, alarms, created, lastModified, dtstamp, importedLastModified, extra, raw, original, line}`: one `VEVENT`; `uidDerived`: the `missing-{32 hex}` UID of §2.17; `raw` null once edited; `original` the text as read (kept after an edit); `line` its first line in the text
- `interface IcsGroup {uid, master: IcsEvent|null, overrides: IcsEvent[]}`: a UID group (a master and its `RECURRENCE-ID` overrides, or overrides alone)
- `interface IcsObservance {kind: 'standard'|'daylight', start, offsetFrom, offsetTo, rrules, rdates, names}`
- `interface IcsTimeZone {tzid, observances, raw, generated: {first, last}|null, line}`: `generated` is `X-THIRTEEN-GENERATED` (§5.4)
- `interface IcsOtherComponent {name, raw, line}`: a component kept as read but not modeled (`VTODO`, a broken or exactly repeated `VEVENT`)
- `interface IcsWarning {line, code, detail}`: codes `'bad-line'|'bad-date'|'bad-rrule'|'unknown-tzid'|'missing-uid'|'missing-dtstart'|'unclosed-component'|'skipped-component'|'duplicate-uid'|'out-of-range'`; line 0 for expansion warnings
- `interface IcsCalendar {name, color, refreshInterval, groups, timeZones, extra, warnings, others, raw}`: `name` from `X-WR-CALNAME` or `NAME`, `color` `#rrggbb` from `X-APPLE-CALENDAR-COLOR` or `COLOR`, `refreshInterval` from `REFRESH-INTERVAL` or `X-PUBLISHED-TTL`
- `interface ZoneHandle {kind: 'iana'|'windows'|'vtimezone'|'floating', tzid, zone: string|null, timeZone: IcsTimeZone|null, resolver: ZoneResolver|null}`: how a `TZID` resolves

### Reading and writing (ics/parse.ts, ics/serialize.ts)
- `parseICalendar(text, options?: {calendarId?, zones?}): IcsCalendar`: CRLF, LF or CR, a byte order mark, folding, escapes, several `VCALENDAR`s; never stops on a broken component (warnings instead); `calendarId` seeds derived UIDs; with `zones`, unresolvable `TZID`s get `unknown-tzid`; throws only when there is no `VCALENDAR` at all
- `serializeICalendar(calendar, zones, options?: {now?}): string`: CRLF, 75-octet folding without splitting a UTF-8 sequence, §3.6 property order; raw groups and `VTIMEZONE`s copied as read, unused `VTIMEZONE`s dropped, needed ones built with `buildVTimeZone` (and rebuilt when the years used grow); `now` (`YYYY-MM-DDTHH:MM`, UTC) is the `DTSTAMP` of serialized events
- `THIRTEEN_PRODID`: `'-//Haugas Development OU//Thirteen 1.0//EN'`

### Documents and groups (ics/groups.ts)
- `newICalendar({calendarId, name, color}): IcsCalendar`: an empty Thirteen calendar (§3.6)
- `replaceGroup(calendar, group, options?: {keepRaw?}): IcsCalendar`: the group in place of its UID's groups (or added); members' `raw` cleared unless `keepRaw` (import and restore); a group with no members removes the UID
- `removeGroup(calendar, uid): IcsCalendar`
- `eventVersion(event): LocalDateTime | null`: `LAST-MODIFIED`, else `DTSTAMP`, in UTC
- `groupVersion(group): LocalDateTime | null`: the newest of its members (§2.17 step 3)
- `withImportBaseline(group, baseline): IcsGroup`: inserts or replaces `X-THIRTEEN-IMPORTED-LAST-MODIFIED` in the raw text (per override in a group without a master)
- `mergeTimeZones(target, source): IcsCalendar`: adds the source's `VTIMEZONE`s for `TZID`s the target does not define
- `renameCollidingTimeZones(target, incoming, zones): IcsCalendar`: renames incoming file-defined zones that the target defines differently to `{TZID} (2)`, `(3)`, ...; known IANA and Windows ids are never renamed
- `allDayEnd(first, last): {end: IcsDateValue|null, duration: string|null}`: the `DTEND` of an all-day event, or no `DTEND` / `DURATION:P{n}D` for one ending on 9999-12-31 (§3.1.1)
- `untilFor(endDate, event, calendar, zones): RRuleUntil`: the `UNTIL` that ends a series after `endDate` in the event's own zone (as `formatUntil`)
- `withRetimedUntils(event, untils: UntilRewrite[], calendar, zones): IcsEvent`: rewrites only the `UNTIL=` part of the rules `retimeExceptions` lists (§4.7)

### Time zones (ics/zones.ts)
- `resolveTzid(tzid, calendar, zones): ZoneHandle`: in order: an IANA id the platform knows, a Windows id through the CLDR table, the file's own `VTIMEZONE`, else floating
- `toUtc(value, handle): LocalDateTime | null`: through `zonedToUtc` or the `VTIMEZONE`; null for floating and outside years 1..9999
- `buildVTimeZone(tzid, years, zones): IcsTimeZone`: a generated `VTIMEZONE` for the years used (§5.4): onsets from the year before the first, one observance pair per rule period, `RDATE`s for irregular years, an open-ended last period, `X-THIRTEEN-GENERATED`
- `sameTimeZoneDefinition(a, b): boolean`: equal observances, in any order (`TZNAME` and `X-` properties ignored)
- `windowsZoneToIana(windowsId): string | null`: `'FLE Standard Time'` is `'Europe/Kiev'`

### Occurrences (ics/events.ts)
- `interface IcsExpandedEvent extends EventOccurrence {uid, group, component, originalDate, originalMinute, recurring, orphan, status, zone, startUtc}`: an occurrence with what the platform needs to open and edit it, and its start instant for alerts
- `eventsFromCalendar(calendar, deviceZone, zones, window: DeviceWindow, systemId?, options?: {calendarId?, limit?}): IcsExpandedEvent[]`: one `expandSeries` per UID group (§4.6); keys `{calendarId}/{UID}|{original start}` (§3.2) with `#2`, `#3` for duplicates; sorted by start, then key. A timed master's `DURATION` with days, and a `PERIOD` extra date's, count those days on the occurrence's own wall clock (RFC 5545 §3.3.6, §3.8.5.3)
- `expandCalendar(calendar, deviceZone, zones, window, systemId?, options?): {events, warnings}`: `eventsFromCalendar` plus its `out-of-range` warnings
- `icsRecognitionInput(master, calendar, zones): RecognitionInput`: a stored master's recurrence data in its own zone, for `recognizeRecurrence`
