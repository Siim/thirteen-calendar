# Thirteen, the 13-month calendar: domain and architecture spec

This is the single source of truth for the calendar engine and every
implementation of it in this repo: the TypeScript engine (`@thirteen/core`)
with the React web app, the Swift port (`ThirteenKit`) with the iPhone, iPad
and Mac apps, the Kotlin port with the Android app, and the C# port with the
Windows app. If code and this document disagree, fix the code or update this
document deliberately. Events (calendars, repeats, `.ics`) have their own
specification, [docs/EVENTS.md](EVENTS.md) (§7).

## 1. Calendar systems

Both supported systems are **perennial 13 × 28 solar calendars**: 13 months of
exactly 28 days (4 weeks) = 364 days, plus one or two **intercalary days** that
belong to no month and no week. Leap years follow the **Gregorian rule**
(divisible by 4, except centuries not divisible by 400). Both start on
Gregorian 1 January, so the day-of-year (1…365/366) is shared with the
Gregorian calendar. Conversion is always "via day-of-year".

### 1.1 International Fixed Calendar (IFC), id `ifc` (default)

- Designed by **Moses B. Cotsworth**, presented 1902. Promoted by the
  International Fixed Calendar League (founded 1923) with George Eastman's
  backing; considered by the League of Nations calendar-reform inquiries
  (1920s and 1930s). **Eastman Kodak used it internally from 1928 to 1989.**
- Months, in order (index 1…13): January, February, March, April, May, June,
  **Sol**, July, August, September, October, November, December.
  "Sol" (Latin for sun) sits mid-year near the northern summer solstice.
- Every month starts on **Sunday** and ends on Saturday; the 13th of every
  month is a Friday.
- **Year Day** follows December 28 (always Gregorian 31 Dec). It has no weekday.
- **Leap Day** follows June 28 in Gregorian leap years (always Gregorian
  17 June in leap years). It has no weekday.
- Year number = Gregorian year.
- Day-of-year mapping (`d` = Gregorian day-of-year, `L` = leap year):
  - non-leap: `d ≤ 364` → month `⌊(d−1)/28⌋+1`, day `(d−1) mod 28 + 1`; `d = 365` → Year Day.
  - leap: `d ≤ 168` → as above; `d = 169` → Leap Day; `170 ≤ d ≤ 365` → use `d−1`; `d = 366` → Year Day.
- `gregorianNameEquivalent`: Jan→1 … Jun→6, Sol→none, Jul→7 … Dec→12
  (used for the "label drift" metric, §3).

### 1.2 Positivist calendar, id `positivist`

- Proposed by **Auguste Comte** in **1849**. Months are named after figures
  Comte considered great contributors to humanity.
- Months (index 1…13): Moses, Homer, Aristotle, Archimedes, Caesar,
  Saint Paul, Charlemagne, Dante, Gutenberg, Shakespeare, Descartes,
  Frederick, Bichat.
- Every month starts on **Monday**.
- Day 365 = **Festival of All the Dead** (the complementary day).
  Day 366 in leap years = **Festival of Holy Women**. Both come after Bichat 28,
  i.e. the leap day is at the *end* of the year (not mid-year like IFC).
- Year number = Gregorian year − 1788 (year 1 = 1789). Years ≤ 0 are shown as
  plain integers; no special era handling.
- `gregorianNameEquivalent`: none for every month.

### 1.3 Weekdays

`Weekday` is 0…6 with **0 = Sunday** (JS `Date#getDay` convention) in TS and
in every port. A system's fixed weekday for month day `n` is
`(weekStartsOn + n − 1) mod 7`. Intercalary days have weekday `null`/`nil`.

### 1.4 Supported range

Proleptic Gregorian years **1…9999**. Core functions throw (`RangeError` in TS,
a thrown error / precondition-safe failable API in Swift) on out-of-range or
invalid input; they never silently clamp. "Invalid input" includes malformed
option bags (§4.1). Every year *parameter* of the API is a **Gregorian** year,
also for Positivist; a system's own year number (its *display year*,
Positivist 238 = Gregorian 2026) only appears in formatted text, in
`displayYear` result fields and in `toDisplayYear` / `fromDisplayYear` /
`displayYearRange` (IFC 1…9999, Positivist −1787…8211).

### 1.5 Platform date interop (local time)

- `fromJSDate(date)` (Swift: from `Date` + `Calendar`/`TimeZone`) reads the
  **local** wall-clock calendar date.
- `toJSDate(gregorianDate)` returns the **first local instant** of that day:
  local midnight, or, when a DST transition skips midnight
  (America/Sao_Paulo 2018-11-04, America/Havana 2024-03-10), the first
  existing time that day (01:00).
- If the local time zone skipped the **whole calendar day** (Pacific/Apia
  2011-12-30, Pacific/Kiritimati 1994-12-31, Pacific/Kwajalein 1993-08-21)
  the date does not exist locally: TS throws `RangeError`, Swift returns `nil`.
  It is never moved to a neighbouring day.

## 2. Anchor test vectors (must hold in TS and Swift)

They hold in TypeScript and in every port (Swift, Kotlin, C#), and each
port's tests assert them. "none" marks an intercalary day, which has no
weekday.

| Gregorian  | IFC                    | IFC weekday | Greg. weekday | Positivist             |
|------------|------------------------|-------------|---------------|------------------------|
| 2026-10-19 | October 12, 2026 (m11) | Thursday    | Monday        | Descartes 12, 238 (Fri)|
| 2026-01-01 | January 1, 2026        | Sunday      | Thursday      | Moses 1, 238 (Mon)     |
| 2026-01-29 | February 1, 2026       | Sunday      | Thursday      | Homer 1, 238           |
| 2026-02-28 | March 3, 2026          | Tuesday     | Saturday      | Aristotle 3, 238       |
| 2026-06-18 | Sol 1, 2026            | Sunday      | Thursday      | Charlemagne 1, 238     |
| 2026-12-30 | December 28, 2026      | Saturday    | Wednesday     | Bichat 28, 238         |
| 2026-12-31 | Year Day 2026          | none        | Thursday      | Festival of All the Dead 238 |
| 2024-06-17 | Leap Day 2024          | none        | Monday        | Charlemagne 1, 236 (Mon) |
| 2024-06-18 | Sol 1, 2024            | Sunday      | Tuesday       | Charlemagne 2, 236     |
| 2024-02-29 | March 4, 2024          | Wednesday   | Thursday      | Aristotle 4, 236       |
| 2024-12-30 | December 28, 2024      | Saturday    | Monday        | Festival of All the Dead 236 |
| 2024-12-31 | Year Day 2024          | none        | Tuesday       | Festival of Holy Women 236 |
| 2023-01-01 | January 1, 2023        | Sunday      | Sunday        | Moses 1, 235           |
| 1900-03-01 | March 4, 1900 (1900 not leap) | Wednesday | Thursday | Aristotle 4, 112     |
| 2000-06-17 | Leap Day 2000          | none        | Saturday      | Charlemagne 1, 212     |

Invariants: IFC Sol 1 = 18 June every year; IFC December 1 = 3 December every
year; Year Day = 31 December every year; in 2023 every IFC fixed weekday equals
the real Gregorian weekday (Jan 1 2023 was a Sunday).

## 3. Comparison ("diff") semantics

`compare(gregorianDate, system)` returns:

- `gregorian`, `thirteen`, `dayOfYear`, `isLeapYear`
- `gregorianWeekday` (real-world) and `thirteenWeekday` (fixed, or null)
- `weekdayShift`: `(thirteenWeekday − gregorianWeekday) mod 7` in 0…6, or null
  for intercalary days. (Constant within a year segment; 0 all year in 2023 for IFC.)
- `labelDrift`: days from the Gregorian date that carries the same
  *month-name + day label* as the 13-month date, to the input date.
  Example: 2026-10-19 is IFC October 12; Gregorian October 12 is 7 days
  earlier ⇒ `labelDrift = 7` ("the 13-month label runs 7 days behind").
  null when the month has no Gregorian namesake (Sol, all Positivist months,
  intercalary days) or the label does not exist in Gregorian.
- `gregorianMonthDays` (length of the Gregorian month the date is in) and
  `thirteenMonthDays` (28, or null on intercalary days)
- `daysIntoYear` = `dayOfYear − 1` and `daysRemainingInYear` =
  `daysInYear − dayOfYear` (so `daysIntoYear + 1 + daysRemainingInYear = daysInYear`)
- `yearProgress` = `daysIntoYear / daysInYear`, measured at the **start** of
  the day, in `[0, 1)` (0 on 1 January)

Field order of the result is exactly the order above (`gregorian`, `thirteen`,
`dayOfYear`, `isLeapYear`, `gregorianWeekday`, `thirteenWeekday`,
`weekdayShift`, `labelDrift`, `gregorianMonthDays`, `thirteenMonthDays`,
`daysIntoYear`, `daysRemainingInYear`, `yearProgress`). `daysUntilYearDay(date,
system)` is the Today-screen countdown: days until the next year-day (IFC Year
Day / Positivist Festival of All the Dead) on or after the date, 0 on the day
itself; in a Positivist leap year 31 December (Holy Women) counts to next
year's All the Dead (365).

Other comparison helpers:

- **Month alignment**: for a year, every 13-month month's Gregorian start/end
  date, and every Gregorian month's 13-month start/end date (for "ribbon"
  visualisations of where the month boundaries fall).
- **Year stats**: Gregorian month lengths (28 to 31) vs constant 28; count & list
  of Friday-the-13ths in the Gregorian year vs the 13-month system (IFC: 13,
  Positivist: 0 since its 13ths are Saturdays); number of distinct month
  "shapes" (Gregorian months that start on different weekdays / have different
  lengths) vs 1; quarter lengths (Gregorian 90/91/92/92 vs 13-month 91 = 3¼
  months).
- **Reverse lookup ("read this label in the other calendar")**: given a
  13-month date, the Gregorian date; given a Gregorian label (month, day), the
  13-month date that falls on it and the 13-month date that carries the same
  label. Like every result, lookups contain fresh, normalised copies of their
  input (only the documented fields), never the caller's object.

### 3.1 Formatting and parsing (English)

| style     | 13-month month date | intercalary            | Gregorian           |
|-----------|---------------------|------------------------|---------------------|
| `long`    | `October 12, 2026`  | `Year Day 2026`        | `October 19, 2026`  |
| `medium`  | `Oct 12, 2026`      | `Year Day 2026` (short name: `All the Dead 238`) | `Oct 19, 2026` |
| `short`   | `Oct 12`            | `Year Day`             | `Oct 19`            |
| `numeric` | `2026-M11-12`       | `2026-YD` / `2024-LD`  | `2026-10-19` (ISO)  |

- Options: `style` (default `long`), `includeYear` (default `true`, except
  `false` for `short`), `includeWeekday` (default `false`; prefixes the full
  weekday name for `long`, the 3-letter one for `medium`/`short`; ignored for
  `numeric` and intercalary days). The weekday is the fixed 13-month weekday.
- Years in 13-month text are **display years** (Positivist `Descartes 12, 238`,
  `Moses 1, -1787`). Numeric years are 4-digit zero-padded with a leading `-`
  for negatives: `0001`, `0238`, `0000`, `-1787`.
- The 13-month numeric form is `YYYY-Mmm-dd` (month `01…13`, day `01…28`),
  `YYYY-YD` or `YYYY-LD`; without the year: `Mmm-dd`, `YD`, `LD`. The `M`
  designator (like ISO week dates `2026-W43-1`) makes it impossible to confuse
  with, or parse as, a Gregorian ISO date: `parseISODate("2026-M11-12")` fails.
- `parseThirteen(text, system)` is the exact inverse of the full numeric form
  (display year, so the system is required): strict regex
  `^-?\d{4}-(M\d{2}-\d{2}|YD|LD)$`, no whitespace, lowercase or `-0000`;
  impossible dates (month 14, day 29, `LD` in a common year) and years outside
  the display-year range fail. `tryParseThirteen` returns null instead.

### 3.2 Slots and arithmetic

- `thirteenSlots(year, system)`: the selectable positions of a 13-month year in
  display (= chronological) order: the 13 months with each intercalary day
  inserted after its `afterMonth`. IFC leap year: January…June, Leap Day,
  Sol…December, Year Day; Positivist leap year: Moses…Bichat, All the Dead,
  Holy Women. Each slot is `{kind: 'month', month, monthInfo}` or
  `{kind: 'intercalary', id, occurrence}`.
- `sameSlotInYear(date, year)`: the same month/day or intercalary id in
  another year, or null when it does not exist there (a leap-day moved to a
  common year); the UI chooses the fallback.
- `addThirteenDays(date, n)`: day arithmetic via the Gregorian day; intercalary
  days count like any other day (Leap Day 2024 + 1 = Sol 1, 2024).
- `addThirteenMonths(date, n)`: month dates only (intercalary input throws);
  keeps the day (always valid, since every month has 28 days) and rolls over
  years (December 5, 2026 + 1 = January 5, 2027).
- Intercalary occurrences (`intercalaryDaysInYear`, layouts, alignment, slots)
  carry `id, code, name, shortName, description, leapOnly, afterMonth` plus
  `thirteen, gregorian, dayOfYear, gregorianWeekday`.
- Every calendar descriptor (both systems and the `GREGORIAN_CALENDAR`
  descriptor for the Compare view) has `name, shortName, inventor,
  proposedYear, summary` and a chronological `history: {year, text}[]`.

## 4. Repository layout

```
/
├─ README.md                    # overview, setup and commands
├─ LICENSE                      # MIT (Haugas Development OU)
├─ THIRD_PARTY_NOTICES.md       # fonts, libraries and data the apps ship, with their licenses
├─ assets/icon.svg              # repo icon: the "Page 13" app icon (§6)
├─ design/
│  ├─ DECISIONS.md              # the owner's decisions: type, themes, icon, copy, release, events
│  ├─ tokens.json               # every colour of every theme; platform theme files are generated from it
│  ├─ icon/                     # the app icon's sources and per-platform exports
│  └─ events/mockups.html       # the events boards (docs/EVENTS.md)
├─ docs/
│  ├─ SPEC.md                   # this file
│  ├─ EVENTS.md                 # events: UX, data model, recurrence, engine API, platform plans (§7)
│  ├─ RELEASING.md              # version numbers and the release steps of every platform
│  ├─ events-verification/      # records of the EVENTS.md §8.2 verification gates, one file per team
│  ├─ store/                    # App Store texts
│  └─ screenshots/              # web-*, ios-* (iPhone, ios-ipad-* iPad), macos-*, android-*, windows-*
├─ fixtures/                    # golden files generated by @thirteen/core, read in place by every port
│  ├─ conversions.json          # the calendar engine (§4.2)
│  ├─ events.json               # the events engine (EVENTS.md §5.5)
│  ├─ ics/                      # the .ics conformance set (EVENTS.md §5.6)
│  └─ mockup/                   # mockup-events.json: the data set of every fake store and screenshot
├─ packages/
│  ├─ core/   (@thirteen/core)  # pure TS engine, zero runtime deps, exhaustive vitest suite, API.md
│  └─ ui/     (@thirteen/ui)    # React components + hooks + design tokens, depends on core
├─ apps/
│  └─ web/    (@thirteen/web)   # Vite + React app composing @thirteen/ui
├─ apple/
│  ├─ ThirteenKit/              # Swift package: engine port + parity tests vs fixtures
│  ├─ Shared/ iOS/ macOS/       # SwiftUI app sources
│  └─ project.yml               # XcodeGen spec (iOS + macOS app targets)
├─ android/                     # Gradle: :core (Kotlin engine port + parity tests), :app (Compose)
├─ windows/                     # .NET: Thirteen.Core (C# port), Thirteen.Desktop (Avalonia), tests, installer
├─ scripts/
│  ├─ design/                   # theme file generator and contrast check (pnpm tokens, pnpm tokens:check)
│  └─ release/                  # release scripts (docs/RELEASING.md)
└─ .github/workflows/           # ci.yml (every port, the fixtures, the timing targets), pages.yml (web)
```

- pnpm workspaces; TypeScript strict everywhere; internal packages export TS
  source directly (`"exports": { ".": "./src/index.ts" }`) so no package build
  step is needed for dev/test; `tsc --noEmit` per package for typechecking.
- Node **≥ 22.18** (`engines`, `.nvmrc` = 22.21): `pnpm fixtures` runs
  `node scripts/generate-fixtures.ts` with Node's built-in type stripping.
- Core sources use explicit `.ts` import extensions. Any package that
  type-checks them (apps/web, packages/ui) must **extend
  `tsconfig.base.json`**, or set `allowImportingTsExtensions: true` together
  with `noEmit: true`; a package that emits JS with `tsc` cannot do that and
  must consume core through a bundler (Vite) instead.
- `@thirteen/core` type-checks `src` on its own with `lib: ["ES2022"]` and
  `types: []` (`tsconfig.src.json`), so Node or DOM APIs cannot creep into the
  engine; tests and scripts use `tsconfig.json` with Node types.
- Root scripts: `pnpm dev`, `pnpm build`, `pnpm test` (every package; in
  `@thirteen/core` the timing tests run last, on their own, with targets
  scaled for a busy machine), `pnpm test:timing` (the EVENTS.md §6.1 timing
  targets as written, for an idle machine), `pnpm typecheck`, `pnpm fixtures`
  (regenerate every file in `fixtures/`), `pnpm tokens` and `pnpm tokens:check`
  (generate the platform theme files from `design/tokens.json`, check their
  contrast), `pnpm apple:test` (`swift test` in apple/ThirteenKit),
  `pnpm apple:gen` (xcodegen). The other ports: `./gradlew :core:test` in
  android/, `dotnet test` in windows/.

### 4.1 API conventions (TS names; Swift, Kotlin and C# mirror them)

- Dates are plain data: `GregorianDate {year, month, day}`; `ThirteenDate` is
  `{kind: 'month', system, year, month, day}` or
  `{kind: 'intercalary', system, year, id: 'year-day' | 'leap-day'}`, with the
  **Gregorian** year. Key order in JSON is exactly as written here.
- Results are fresh objects and never alias an input; static system data
  (month info, descriptors) is shared and frozen.
- `systemId` is the last positional parameter (default `'ifc'`); only an
  optional options object may follow it (`buildGregorianMonth(year, month,
  systemId, {weekStartsOn})`, whose `weekStartsOn` defaults to the system's own
  week start). Option bags must be `undefined` or a plain object with only the
  documented keys and correctly typed values; anything else throws.
- Naming: functions taking a `GregorianDate` are `gregorian…`/`…Gregorian…`
  (`gregorianWeekday`, `gregorianDayOfYear`, `gregorianFromDayOfYear`,
  `daysInGregorianMonth`, `addGregorianDays`, `diffGregorianDays`,
  `compareGregorian`, `gregorianEquals`), functions taking a `ThirteenDate` are
  `thirteen…`/`…Thirteen…` (`thirteenWeekday`, `thirteenDayOfYear`,
  `thirteenDisplayYear`, `addThirteenDays`, `addThirteenMonths`,
  `compareThirteen`, `thirteenEquals`, `parseThirteen`). Year-level helpers
  shared by all systems stay unprefixed (`isLeapYear`, `daysInYear`).
  `compare` keeps its §3 name.
- Result fields: `month` is always a 1-based month **number**; the static info
  object is `monthInfo`. Weekday fields are always qualified:
  `gregorianWeekday` (real) and `thirteenWeekday` (fixed). Year stats use
  `gregorianYearStartWeekday` / `thirteenYearStartWeekday`. Month name tables
  are only exposed 1-based (`GREGORIAN_MONTHS[i].index = i + 1`,
  `gregorianMonthName(month, style)`).

### 4.2 Golden fixtures (`fixtures/conversions.json`, version 2)

Generated by `pnpm fixtures` from `packages/core/scripts/fixtures.ts`; a test
fails if the committed file differs from the generator output, and so does
CI. The Swift, Kotlin and C# parity tests read it in place. The events engine
has its own golden files (`events.json`, `ics/`, `mockup/`, EVENTS.md §5.5,
§5.6 and §6.7); `fixtures/README.md` describes every file. Pretty-printed
envelope, one compact JSON value per line inside each array, < 600 kB.
Top-level keys, in order:

- `version` (2), `generatedBy`, `spec`.
- `systems`: `CALENDAR_SYSTEMS` verbatim plus `displayYearRange {min, max}`;
  `gregorianCalendar`: `GREGORIAN_CALENDAR` verbatim.
- `cases`: every day of 2024 and 2026 plus 12 boundary days of years
  1, 1600, 1900, 2000, 2023, 2100, 9999, each in both systems (date-major, IFC
  first): `{gregorian: "YYYY-MM-DD", thirteen: ThirteenDate, displayYear,
  dayOfYear, isLeapYear, gregorianWeekday, thirteenWeekday, weekdayShift,
  labelDrift, formattedLong}`.
- `comparisons`: exact `Comparison` JSON (§3 order, `gregorian` as an object)
  plus `displayYear` and `daysUntilYearDay`, for the §2 anchors and extremes.
- `formats`: `options` (21 option bags) and, for 13-month and Gregorian dates,
  `{date, outputs}` where `outputs[i]` used `options[i]`.
- `numericParsing`: `{system, text, expected: ThirteenDate | null}`.
- `yearStats`, `monthAlignments`: exact `YearStats` / `MonthAlignment` JSON.
- `thirteenYearLayouts`, `gregorianMonthLayouts`, `slots`: compact forms of
  `buildThirteenYear`, `buildGregorianMonth` (weekStartsOn 0 and 1) and
  `thirteenSlots` for 2024 and 2026.
- `labelLookups` (`gregorian`: lookup + `system`; `thirteen`), `notableDates`,
  `arithmetic` (`addDays`, `addMonths`, `sameSlotInYear`; `expected: null`
  means the call throws, or for `sameSlotInYear` returns null).

## 5. Product surfaces (web, iPhone, iPad, Mac, Android, Windows)

Every platform has the same five sections, in this order.

1. **Today**: today's date in the selected 13-month system, Gregorian
   equivalent, fixed vs real weekday, label drift, year progress across 13
   equal months, countdown to Year Day, and the current month in both
   calendars (the 4×7 month with Gregorian dates, the Gregorian month with
   13-month dates). Where events are in use, an "Up next" card shows the
   coming events of the next 7 days (EVENTS.md §2.8).
2. **Calendar**: the 13-month calendar with the user's events (EVENTS.md §2.1
   to §2.10). It replaces the Year section in the same position, with the same
   icon and shortcut, and old `year` links keep working. It has five modes:
   - **Year**: all 13 perfect 4×7 month grids plus the intercalary day(s),
     with an optional Gregorian overlay in each cell, markers where Gregorian
     months begin and event dots. Selecting a day opens its comparison, which
     lists the day's events. The web page can also show the 12 Gregorian
     months alongside, each day carrying its 13-month date.
   - **Month** (the default): one 13-month month as a 4×7 grid whose header
     names each column's 13-month weekday and the Gregorian weekday it falls
     on, every cell with its Gregorian date, events as dots, chips and bars,
     and the month's intercalary day(s) as a full-width band under week 4.
   - **Week** (regular width only): one 13-month week as a timeline, with a
     column for each intercalary day after the seven weekdays.
   - **Day**: one day as a timeline under an all-day row.
   - **List**: every upcoming event, grouped by 13-month month and day.

   Events come from the device's calendars on iPhone, iPad and Mac (EventKit)
   and Android (CalendarContract), and from Thirteen's own local calendars,
   `.ics` import and export and read-only subscriptions on Windows and the
   web. They can be added, edited, moved and deleted, and repeat by the
   Gregorian rules of Apple Calendar or by four 13-month rules (EVENTS.md
   §2.13, §4). §7 points to the events specification.
3. **Convert**: two-way converter: Gregorian → 13-month and 13-month
   (month incl. Sol / day 1 to 28 / Year Day / Leap Day) → Gregorian, with the
   full `compare` breakdown, same-label lookups in both directions and the
   year's notable dates as quick picks.
4. **Compare**: 12 vs 13: month-length bars, month-boundary ribbon,
   year stats (Friday-13ths, quarter lengths, month shapes), weekday drift,
   and the three calendars side by side.
5. **History**: one timeline merging the history of the Gregorian calendar,
   the IFC and the Positivist calendar, with each calendar's summary.
6. A **system switcher** (IFC ⇄ Positivist) that persists.

## 6. Design direction

`design/DECISIONS.md` holds the owner's decisions and wins over this section.

- Concept: a modern *rational almanac*: 1920s calendar-reform print heritage
  (Cotsworth pamphlets, Kodak office calendars) rendered with contemporary
  precision. The perfect 4×7 grid is the hero motif; Gregorian "ragged"
  months are the foil.
- Type: **Geist** for display and text and **Geist Mono** for figures, labels
  and code-like captions, on every platform (SIL Open Font License 1.1; the
  web uses the Fontsource variable packages, the native apps bundle the font
  files with their `OFL.txt`). Big numerals: tabular figures, weight 700,
  tight tracking (about -0.04em at display sizes).
- Colour: eight themes, chosen in Settings. Five have a light and a dark
  variant and follow the system or the pinned Appearance (System, Light,
  Dark): **Almanac**, the default (warm paper, ink, signal orange `#ea580c`),
  Graphite, Slate, Forest and Mono. Three are always dark: Obsidian, Midnight
  and Phosphor; while one is selected every platform forces the dark colour
  scheme and shows Appearance disabled with a note. `design/tokens.json` is
  the single source of every colour: the web CSS and the Swift, Kotlin and C#
  theme files are generated from it (`pnpm tokens`), and `pnpm tokens:check`
  holds every theme to WCAG 2.2 contrast, including the event chips of
  EVENTS.md §2.20.
- App icon: **"Page 13"**, a tear-off calendar page, full bleed: paper, an
  accent binding band across the top with two ink ring holes, and a large
  "13" in Geist, in the Almanac colours. One artwork on every platform; only
  the platform's mask or corner shape differs (`design/icon/`).
- Copy: no em dash or en dash in any user-visible string (a hyphen, a comma,
  a colon, "to", or two sentences instead).
- Web: served from `https://thirteen.haugas.dev/`, an origin of its own
  (EVENTS.md §3.6), with privacy and support pages at `/privacy.html` and
  `/support.html`; self-hosted fonts, CSS variables, purposeful motion;
  accessible (WCAG AA contrast, keyboard navigation, focus states).
- Apple: Apple HIG, native SwiftUI navigation (TabView on iPhone,
  NavigationSplitView on iPad and macOS), SF Symbols, Dynamic Type, the
  theme's colours, MenuBarExtra on macOS showing today's 13-month date.
- Android: Jetpack Compose and Material 3 with the theme's colours (no
  dynamic colour).
- Windows: Avalonia with the Fluent theme and the theme's colours.

## 7. Events

Events (reading and writing the device's calendars, Thirteen's own local
calendars, 13-month repeats, `.ics` import, export and subscriptions) are
specified in [docs/EVENTS.md](EVENTS.md): the UX of every platform (§2), the
data model (§3), recurrence (§4), the engine API and the golden files (§5),
the platform plans (§6), privacy (§7) and the verification gates (§8). It
builds on this file: its years are Gregorian (§1.4), its dates are the
§4.1 types, and its engine lives in `@thirteen/core` next to this one
(`packages/core/src/events` and `packages/core/src/ics`, exported as
`@thirteen/core` and `@thirteen/core/ics`, documented in
`packages/core/API.md`). Its verification gates are recorded in
`docs/events-verification/`.
