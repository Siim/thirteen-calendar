# ThirteenKit

Swift port of [`@thirteen/core`](../../packages/core) — the engine behind *Thirteen*, a 13-month
(13 × 28 days) calendar: the **International Fixed Calendar** (`.ifc`, default) and **Comte's
Positivist calendar** (`.positivist`), with conversion to and comparison with the Gregorian
calendar. The rules live in [`docs/SPEC.md`](../../docs/SPEC.md); the TypeScript engine is the
source of truth and this package mirrors it.

- Swift 6 language mode (strict concurrency), iOS 17+ / macOS 14+, no dependencies.
- Pure value types: everything is `Sendable`, `Hashable` and `Codable`; dates are `Comparable`.
- Use it from the apps as a local package: `.package(path: "ThirteenKit")`.

## API overview

```swift
import ThirteenKit

let today = GregorianDate.today()                  // local wall-clock date, e.g. 2026-10-19
let ifc = today.thirteen(in: .ifc)                 // ThirteenDate.month(…) — IFC October 12, 2026
ifc.formatted()                                    // "October 12, 2026"
ifc.formatted(.init(includeWeekday: true))         // "Thursday, October 12, 2026"
ifc.formatted(.numeric)                            // "2026-M11-12"
today.thirteen(in: .positivist).formatted()        // "Descartes 12, 238"

let c = Comparison(today, system: .ifc)            // SPEC §3 diff
c.weekdayShift; c.labelDrift; c.yearProgress       // 3, 7, 0.797…
today.daysUntilYearDay()                           // 73

switch ifc {                                       // month date or intercalary day
case .month(let date): date.monthInfo.name         // "October"
case .intercalary(let day): day.info.name          // "Year Day"
}

let year = try ThirteenYearLayout(year: 2026, system: .ifc)   // 13 perfect 4 × 7 grids + Year Day
let grid = try GregorianMonthLayout(year: 2026, month: 10)    // ragged month with 13-month cells
let slots = try ThirteenSlot.all(inYear: 2024)                // picker order, incl. Leap Day
let stats = try YearStats(year: 2026)                         // Friday-13ths, quarters, shapes
let ribbon = try MonthAlignment(year: 2026, system: .positivist)
let date = try ThirteenDate(numeric: "0238-M11-12", system: .positivist)
let instant = today.date(in: .current)                        // first local instant, or nil
```

Conventions (SPEC §4.1, translated to Swift):

| TypeScript | Swift |
|---|---|
| plain objects `{year, month, day}` / `{kind, system, …}` | `GregorianDate`, `ThirteenDate` (`.month(ThirteenMonthDate)` / `.intercalary(ThirteenIntercalaryDate)`), **valid by construction** |
| every `year` parameter is Gregorian | same; display years only in text, `displayYear` and `CalendarSystemID.displayYear(forGregorianYear:)` / `gregorianYear(forDisplayYear:)` / `displayYearRange` |
| `systemId` last, default `'ifc'` | `system: CalendarSystemID = .ifc` last; `weekStartsOn:` may follow it |
| throws `RangeError` | `throws(ThirteenError)` — a typed, exhaustive enum with TS-like messages |
| returns `null` | returns `nil` |
| `tryParseISODate` / `tryParseThirteen` | `try? GregorianDate(isoString:)` / `try? ThirteenDate(numeric:system:)` |
| `buildThirteenYear`, `compare`, `yearStats`, … | initializers: `ThirteenYearLayout(year:system:)`, `Comparison(_:system:)`, `YearStats(year:system:)`, … |
| `gregorian…(date)` / `thirteen…(date)` functions | properties and methods on the date: `date.weekday`, `date.dayOfYear`, `date.adding(days:)`, `date.sameLabel(in:)`, … |
| result JSON | `Codable` produces the same JSON (keys, explicit `null`s); decoding validates |
| `fromJSDate` / `toJSDate` | `GregorianDate(date:calendar:)` / `date(in:) -> Date?` (SPEC §1.5) |

Foundation interop uses only the calendar's **time zone** and always computes in the proleptic
Gregorian calendar, so a Japanese or Buddhist user calendar, or a date before 1582 (where
Foundation's `.gregorian` switches to Julian), still yields the right Gregorian date.
`date(in:)` returns local midnight, the first existing instant when DST skips midnight
(America/Sao_Paulo 2018-11-04 → 01:00), the earlier midnight when it repeats, and `nil` when
the zone skipped the whole day (Pacific/Apia 2011-12-30).

## Events

`Sources/ThirteenKit/Events` ports the events engine of `packages/core/src/events` (docs/EVENTS.md
§5.2, §5.7): wall clocks and zone math, `RRULE`, the 13-month repeat rules, recurrence, series
expansion, the editor model and the layouts. Same value-type rules as above (`Sendable`, `Hashable`,
`Codable` in the `fixtures/events.json` forms), and every check throws `ThirteenError.invalidEvent`
or `.invalidRule` with the TypeScript message.

```swift
let start = try LocalDateTime(iso: "2026-10-19T19:00")
let rule = ThirteenRule(.monthly, start: start.date, system: .ifc)!  // .monthly(system: .ifc, day: 12)
try rule.encoding(start: start.date).rrule.text  // "FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,...,-18"
let recurrence = EventRecurrence(rule: .thirteen(rule))
try recurrence.description(start: start.date)    // "Every IFC month on the 12th"
let window = ExpansionWindow(from: start.date, to: try GregorianDate(isoString: "2027-12-31"))
try recurrence.expand(start: start.date, in: window).occurrences.count     // 16
try ZoneMath.utc(from: start, zone: "Europe/Tallinn", using: FoundationZoneResolver())  // 2026-10-19T16:00
let occurrence = EventOccurrence(key: "book-club", calendarID: "home", title: "Book club", allDay: false,
                                 start: start, end: try LocalDateTime(iso: "2026-10-19T21:00"))
try ThirteenMonthEventLayout(year: 2026, month: 11, occurrences: [occurrence], maxLanes: 3)
    .weeks[1].items.first?.style                 // .dot, in week 2, column 4
```

| TypeScript | Swift |
|---|---|
| `LocalDateTime`, `parseLocalDateTime`, `formatLocalDateTime` | `struct LocalDateTime` (Comparable by moment, `D T24:00 == D+1 T00:00`), `LocalDateTime(iso:)`, `.isoString` |
| `addMinutesLocal`, `normalizeEventEnd`, `occurrenceDays`, `displayEnd` | `.adding(minutes:)`, `LocalDateTime.normalizedEnd(start:end:)`, `.occurrenceDays(from:to:)`, `.displayEnd()` |
| `ZoneResolver`, `zonedToUtc`, `utcToZoned` | `protocol ZoneResolver`, `ZoneMath.utc(from:zone:using:)`, `ZoneMath.local(from:zone:using:)`; `FoundationZoneResolver` (on `TimeZone.secondsFromGMT(for:)`, seconds truncated toward zero) |
| `RRule`, `parseRRule`, `formatRRule`, `rruleEquals` | `RRule`, `RRule(text:)`, `.text` / `.formatted()`, `.isEquivalent(to:ignoringEnd:ignoringWkst:)` |
| `untilInZone`, `untilEndDate`, `formatUntil` | `RRuleUntil.local(zone:using:)`, `LocalDateTime.untilEndDate(startMinute:)`, `RRuleUntil.text(endDate:allDay:zone:using:)` |
| `ThirteenRule`, `thirteenRuleFor`, `thirteenRuleDatesInYear`, `thirteenRuleIncludes` | `enum ThirteenRule`, `ThirteenRule(_:start:system:)`, `.dates(inYear:start:)`, `.includes(_:start:)` |
| `encodeThirteenRule`, `thirteenRuleRdates` | `.encoding(start:)`, `.rdates(start:end:horizon:maxValues:)` |
| `formatThirteenRuleText`, `parseThirteenRuleText`, `formatThirteenRuleUri`, `parseThirteenRuleUri` | `.markerText`, `ThirteenRule(markerText:)`, `.uri(end:series:part:)`, `ThirteenRuleURI(text:)` |
| `EventRecurrence`, `expandRecurrence` | `EventRecurrence`, `.expand(start:in:limit:)` |
| `endRecurrenceBefore`, `laterOccurrenceCount` | `.endedBefore(_:start:)`, `.laterCount(start:at:)` |
| `splitRecurrence`, `retimeExceptions` | `.split(start:at:overrideDates:change:)`, `.retimed(overrideDates:from:to:newRecurrence:minuteDelta:allDay:)` |
| `recognizeRecurrence` | `Recognition(_:system:)` |
| `describeRecurrence`, `describeNextOccurrences`, `describeRepeatNotes` | `.description(start:system:)`, `.nextOccurrencesText(start:system:count:)`, `.repeatNotes(start:system:gregorianOnlyCalendar:)` |
| `repeatPresets`, `matchRepeatPreset`, `adaptRecurrenceToStart` | `RepeatPreset.all(start:system:)`, `RepeatPreset.match(_:start:system:)`, `.adapted(from:to:)` |
| `expandSeries` | `SeriesExpansion.expand(_:window:deviceZone:zones:limit:)` |
| `validateDraft`, `newEventDraft`, `moveDraftStart`, `setDraftAllDay` | `draft.issues(for:)`, `EventDraft(newOn:now:calendarID:allDay:timeZone:)`, `.movingStart(to:system:)`, `.settingAllDay(_:previousTimes:availabilityTouched:timeZone:)` |
| `changedFields`, `mergeDraft`, `applyToSeries` | `.changedFields(to:)`, `EventDraft.merged(original:edited:current:)`, `edited.appliedToSeries(master:opened:override:)` |
| `alarmPresets`, `describeAlarm`, `alarmFireTime` | `AlarmPreset.all(allDay:allowAfterStart:use24Hour:)`, `alarm.description(allDay:system:use24Hour:)`, `alarm.fireTime(allDay:start:startUtc:deviceZone:zones:)` |
| `layoutThirteenMonthEvents`, `monthColumnGregorianWeekdays` | `ThirteenMonthEventLayout(year:month:occurrences:system:maxLanes:)`, `ThirteenMonthEventLayout.columnGregorianWeekdays(year:month:system:)` |
| `layoutThirteenWeekEvents`, `layoutDayEvents`, `formatChipTime` | `WeekEventLayout(year:month:week:occurrences:system:minDurationMinutes:maxSlots:)`, `DayEventLayout(date:occurrences:minDurationMinutes:maxSlots:)`, `ChipTime.text(minute:use24Hour:)` |
| `agenda`, `yearEventMarks` | `AgendaDay.days(occurrences:from:to:system:includeEmptyDays:)`, `YearMark.marks(year:occurrences:maxCalendars:)` |
| `calendarId`, `accountId`, `supportsUrl`, `overrideId` | `calendarID`, `accountID`, `supportsURL`, `overrideID` (the JSON keys stay as in TypeScript) |
| `thirteenRuleRdateParts`, `parseDateList`, `formatDateList`, `formatDetachedUri`, `parseDetachedUri`, the `.ics` module | not ported (Android only, and `.ics` is C# only) |

## How parity with TypeScript is guaranteed

1. **Golden fixtures.** `Tests/ThirteenKitTests` reads `fixtures/conversions.json` in place (the
   path is derived from `#filePath`; the file is never copied) and asserts every section:
   1620 conversion cases in both directions, 68 full comparisons, 21 × 63 formatted strings,
   numeric parsing, systems metadata, year stats, month alignments, layouts, slots, label
   lookups, notable dates and arithmetic. Sections that hold exact core JSON are compared twice:
   decoded fixture value `==` Swift result, **and** Swift's JSON encoding equals the fixture JSON
   structurally (same keys, `null` vs absent, numbers). Section sizes are asserted too, so a
   truncated fixture cannot pass.
2. **Shared static data.** The system descriptors (`Sources/ThirteenKit/Systems/IFC.swift`,
   `Positivist.swift`, `GregorianCalendar.swift`) were generated from the fixture and are checked
   against it verbatim, typographic quotes included.
3. **Native tests** of the SPEC §2 anchor table and invariants, every day of years 1…9999 in both
   systems, a Foundation oracle for 1600…2400, the SPEC §1.5 time-zone edge cases, validation and
   error cases, and Codable/ordering behaviour.
4. **Events fixtures.** `EventsFixtureParityTests` reads `fixtures/events.json` in place and replays
   every section from its JSON, as the TypeScript replay tests do, comparing each result's JSON
   encoding with the fixture structurally. It asserts the envelope and every entry of `counts`, and
   fails on a section it does not know. `zones` runs through `FoundationZoneResolver` (the
   platform's tzdata; exclusions would be listed by case id, there are none); `untils`, `series` and
   `alarmInstants` run through the test target's `RecordedZoneResolver`, built from `zoneOffsets`
   alone; `zoneMath` runs through each case's `SyntheticZoneResolver`. Not replayed: `dateLists` and
   the `parts` and `detached` fields of `thirteenRules` (Android only), and two cases whose input
   has a fractional number that Swift's `Int` fields cannot hold (`wallClock[15]`, `drafts[76]`;
   the test asserts that their JSON fails to decode).
5. **Foundation recurrence oracle.** `FoundationRecurrenceOracleTests` expands every `BYYEARDAY`
   encoding (every 13-month rule made from a date of 2024 in both systems, plus the fixture's form
   (b) cases) with `Calendar.RecurrenceRule` (macOS 15+) and checks it gives exactly
   `ThirteenRule.dates(inYear:start:)` for 2024 to 2104. `EventModelTests` covers the editor rules
   the fixture does not pin case by case (moving a start, all-day on and off, the URL rule, alert
   texts and fire times); `RecurrenceEdgeTests` pins `HOURLY` and finer rules in splits and
   retimes (only their start, as in expansion; the TypeScript engine throws a `TypeError` there,
   reported to Core).
6. **Differential runs (by hand, not in CI).** `scripts/events-differential.mts` makes random
   inputs, runs them through the TypeScript engine and writes the results in the
   `fixtures/events.json` format, plus `x*` sections for API the fixture does not replay
   (`movingStart`, `settingAllDay`, `changedFields`, alert texts, `nextOccurrences`, preset
   matching, `rrule(start:)`, `laterCount` at any date, `includes`, series limits, Week mode's
   minimum height, rejections). With `THIRTEEN_EVENTS_FIXTURE` set, `EventsFixtureParityTests`
   replays that file instead and `EventsDifferentialTests` runs; only the envelope and count checks
   fail, by design. About 300,000 cases from six seeds agreed on 2026-10-26.

```sh
node apple/ThirteenKit/scripts/events-differential.mts 1 /tmp/events-diff.json 3   # from the repo root
THIRTEEN_EVENTS_FIXTURE=/tmp/events-diff.json swift test --package-path apple/ThirteenKit \
  --filter 'EventsFixtureParityTests|EventsDifferentialTests'
```

When the TypeScript engine changes: `pnpm fixtures`, then `pnpm apple:test`.

```sh
cd apple/ThirteenKit && swift test                       # or: pnpm apple:test
xcodebuild -scheme ThirteenKit -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/thirteen-dd-kit build             # iOS compile check
```
