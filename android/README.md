# Thirteen for Android

The Android port of *Thirteen*, the 13-month calendar (International Fixed Calendar by default,
plus Comte's Positivist calendar, compared with the Gregorian calendar). The rules live in
[`docs/SPEC.md`](../docs/SPEC.md); the TypeScript engine in [`packages/core`](../packages/core) is
the source of truth, and [`apple/ThirteenKit`](../apple/ThirteenKit) is the Swift port this one is
modelled on.

## Requirements

| Tool | Version |
|---|---|
| JDK | 17 or newer to run Gradle (tested with 21) |
| Android SDK | platform `android-37.0`, build-tools 37.0.0, platform-tools, emulator |
| System image (emulator) | `system-images;android-37.0;google_apis;arm64-v8a` |
| Gradle | 9.8.1 through the committed wrapper (`./gradlew`) |

Versions used by the build ([`gradle/libs.versions.toml`](gradle/libs.versions.toml)): AGP 9.4.1
(built-in Kotlin, new DSL), Kotlin 2.4.21, Compose BOM 2026.09.00, compileSdk and targetSdk 37,
minSdk 26.

Point the build at the SDK with `ANDROID_HOME` or a git-ignored `local.properties`
(`sdk.dir=/path/to/Android/sdk`). With Homebrew on macOS:

```sh
brew install openjdk@21                     # or: brew install --cask temurin@21
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
sdkmanager "platforms;android-37.0" "build-tools;37.0.0" "platform-tools" "emulator" \
  "system-images;android-37.0;google_apis;arm64-v8a"
```

## Commands

Run from this directory (`android/`):

```sh
./gradlew :core:test                 # engine tests: fixture parity, every day 0001..9999, edge days
./gradlew :app:testDebugUnitTest     # Compose UI tests on the JVM (Robolectric)
./gradlew :app:assembleDebug         # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease       # minified; signed only when the THIRTEEN_* variables are set
./gradlew :app:lintDebug :app:lintRelease   # Android lint (no errors fail the build; warnings are reported)
./gradlew :core:jacocoTestReport     # coverage: core/build/reports/jacoco/test/html
```

`:core:test` reads `../fixtures/conversions.json` and `../fixtures/events.json` in place (declared
as task inputs, so it reruns when the fixtures change). If a file is missing the build fails; the
parity tests are never skipped. Under load, run the engine suite with `THIRTEEN_PERF_SCALE=3` (its
timing tests scale their budgets).

The instrumented provider tests (`app/src/androidTest`, docs/EVENTS.md §6.3) need a running
emulator. Install both APKs and run the runner against one emulator by serial (plain
`connectedAndroidTest` would use every attached device):

```sh
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
ADB="$HOME/Library/Android/sdk/platform-tools/adb -s emulator-5584"
$ADB install -r -t app/build/outputs/apk/debug/app-debug.apk
$ADB install -r -t app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
$ADB shell am instrument -w -r -e package com.haugas.thirteen.data.calendar \
  com.haugas.thirteen.test/androidx.test.runner.AndroidJUnitRunner
$ADB logcat -d -s ThirteenProviderTest:I | grep PROBE    # what the provider did, per case
```

Gate V12 runs the same command on `Thirteen_API26`, `Thirteen_API30` and `Thirteen_API37` (Emulators
below), one emulator at a time. The tests grant the calendar permissions themselves (`UiAutomation`,
`pm grant` below API 28), work only in LOCAL calendars
they create (accounts `ThirteenProviderTest` and `ThirteenProviderTest2`) and delete them, with
their events, after every test. The device calendar test deletes the "Thirteen" calendar only if it
created it.

The whole instrumented suite (41 tests: `ProviderRecurrenceTest`, `ProviderRepositoryTest`,
`ProviderTimeZoneTest`, `ReviewFindingsDataProviderTest` and `CalendarAccessibilityTest`; the first
four are the 36 of the `-e package` run above) is the same command without `-e package`:

```sh
$ADB shell settings put system time_12_24 24
$ADB shell am instrument -w -r com.haugas.thirteen.test/androidx.test.runner.AndroidJUnitRunner
$ADB logcat -d -s ThirteenProviderTest:I | grep "PROBE zones"   # how the provider placed each local time
```

`CalendarAccessibilityTest` drives the app's UI, so the emulator's screen must be on and unlocked
(the test wakes it and dismisses the keyguard); it sets the font scale and the 24-hour setting and
puts them back after each test. `ProviderTimeZoneTest` runs the `zones` section of
`fixtures/events.json` on the device's own time zone data and through the provider (the `androidTest`
assets are `../../fixtures`); it asserts the device check only where the device's tzdata is at least
the fixture's (older devices log what differs).

### Emulators

For gate V12 (the provider tests per API level), three Pixel 5 AVDs on Google APIs arm64 images:

```sh
sdkmanager "system-images;android-26;google_apis;arm64-v8a" "system-images;android-30;google_apis;arm64-v8a"
for api in 26 30 37; do
  img="system-images;android-$api;google_apis;arm64-v8a"; [ $api = 37 ] && img="system-images;android-37.0;google_apis;arm64-v8a"
  echo no | avdmanager create avd -n Thirteen_API$api -k "$img" -d pixel_5
done
"$HOME/Library/Android/sdk/emulator/emulator" -avd Thirteen_API30 -port 5592 -no-window -no-audio -no-boot-anim -no-snapshot &
```

Two AVDs on the API 37 Google APIs arm64 image: `Thirteen_Phone` (Pixel 10 profile) and
`Thirteen_Tablet` (Pixel Tablet profile). To recreate them:

```sh
IMG="system-images;android-37.0;google_apis;arm64-v8a"
echo no | avdmanager create avd -n Thirteen_Phone  -k "$IMG" -d pixel_10
echo no | avdmanager create avd -n Thirteen_Tablet -k "$IMG" -d pixel_tablet
```

Run the app headless and take a screenshot (`adb` and `emulator` live in the SDK, not on `PATH`):

```sh
SDK="$HOME/Library/Android/sdk"
"$SDK/emulator/emulator" -avd Thirteen_Phone -no-window -no-audio -no-boot-anim -port 5584 &
"$SDK/platform-tools/adb" -s emulator-5584 wait-for-device
"$SDK/platform-tools/adb" -s emulator-5584 install -r app/build/outputs/apk/debug/app-debug.apk
"$SDK/platform-tools/adb" -s emulator-5584 shell am start -W -n com.haugas.thirteen/.MainActivity
"$SDK/platform-tools/adb" -s emulator-5584 exec-out screencap -p > /tmp/thirteen.png
"$SDK/platform-tools/adb" -s emulator-5584 emu kill
```

Deep links: `adb shell am start -a android.intent.action.VIEW -d 'thirteen://year/2026'` (quote
the URI so the device shell keeps `?` and `&`). Android matches intent schemes case-sensitively, so
`THIRTEEN://...` never reaches the app; the parser itself ignores case.

| Link | Opens |
|---|---|
| `thirteen://today` | Today |
| `thirteen://calendar` | the Calendar in its last mode |
| `thirteen://year/2026` | Calendar, Year mode on 2026 (a Gregorian year, 1 to 9999) |
| `thirteen://year/2024?day=2024-06-17` | Year mode on 2024, scrolled to that day's month, with its comparison open (`year?day=...` takes the day's year) |
| `thirteen://month/2026/11` or `thirteen://month?year=2026&month=11` | Month mode: Gregorian year 2026, 13-month month 11 (1 to 13) of the selected or given system; today if it is in that month, else the month's first day |
| `thirteen://week/2026-10-19` | Week mode for that day's 13-month week (Day mode on compact and medium widths) |
| `thirteen://day/2026-10-19` or `thirteen://day?date=2026-10-19` | Day mode on that day |
| `thirteen://new-event?date=2026-10-21` | the editor for a new event that day (the access flow first when Thirteen cannot write) |
| `thirteen://convert?date=2026-10-19` or `thirteen://convert/2026-10-19` | Converter on that Gregorian date, Gregorian side as input |
| `thirteen://convert?thirteen=2024-LD` | Converter on a 13-month date (numeric form, display year of the system: `0238-M11-12&system=positivist`), 13-month side as input |
| `thirteen://compare/2024` or `thirteen://compare?year=2024` | Compare for 2024 |
| `thirteen://history` | History |

Every link takes `?system=ifc|positivist`, which switches and persists the calendar system. A bad
value (`year/0`, `date=2026-02-30`, `thirteen=2025-LD`, `system=julian`) keeps the destination and
ignores the value; an unknown destination (`thirteen://settings`), anything over 2,048 characters or
anything that does not parse is ignored and the app stays where it was. The same table is in
`navigation/DeepLink.kt` and `apple/Shared/App/DeepLink.swift`. A missing month, week or day value
means today. A link closes comparisons, Settings, details, the editor and the Calendars list; the
Calendar keeps its mode unless the link names one.

Calendar apps open an event that Thirteen created with
`android.provider.calendar.action.HANDLE_CUSTOM_EVENT` (data `content://com.android.calendar/events/{id}`,
extra `customAppUri`): Thirteen opens that event's day in Day mode (`navigation/CustomEventLink.kt`;
the day from the provider's `DTSTART`, all-day events by their UTC date, else the detached marker's
original date, else the Calendar). Try it on an emulator with an event id of your own:

```sh
$ADB shell am start -a android.provider.calendar.action.HANDLE_CUSTOM_EVENT \
  -d content://com.android.calendar/events/42 -t vnd.android.cursor.item/event com.haugas.thirteen
```

### QA runs

Debug builds read two extras of the launching intent (`QaOptions.kt`, docs/EVENTS.md §6.3
"Screenshots"); release builds ignore them:

| Extra | Effect |
|---|---|
| `--es thirteen.qa.today 2026-10-19` | today is that Gregorian day, not the device's |
| `--ez thirteen.qa.fakeEvents true` | the Calendar reads the mockup data set (`FakeCalendarRepository` on `fixtures/mockup/mockup-events.json` from the debug assets) instead of the Calendar Provider, with the wall clock fixed at the file's `now` (2026-10-19 09:41, so "Now" is on Sprint planning); today is that day unless `thirteen.qa.today` says otherwise. No permission is asked for; "Show my calendars" switches the fake to full access |

The options are read when the activity is created, so force-stop first and send links after the
launch has finished (`-W`); a link that cold-starts the app has no extras and gets the real
provider. Screenshots in the mockups' state:

```sh
$ADB shell settings put system time_12_24 24        # the spec's examples are 24-hour
$ADB shell am force-stop com.haugas.thirteen
$ADB shell am start -W -n com.haugas.thirteen/.MainActivity \
  --es thirteen.qa.today 2026-10-19 --ez thirteen.qa.fakeEvents true
$ADB shell am start -a android.intent.action.VIEW -d 'thirteen://calendar' com.haugas.thirteen
$ADB exec-out screencap -p > /tmp/thirteen-month.png
$ADB shell settings put system font_scale 1.5      # Month as a list of days (§2.4); wait for the relaunch
```

For the screenshots in `docs/screenshots/` (retaken at release), turn on the System UI demo mode
first, so the status bar shows 09:41 like the app's fixed "now" and the boards, with full Wi-Fi and
a full battery and no notification icons; turn it off again afterwards. These are the commands the
1.0.0 screenshots were taken with (API 37 phone and tablet images):

```sh
$ADB shell settings put global sysui_demo_allowed 1
$ADB shell am broadcast -a com.android.systemui.demo -e command exit    # start from a clean state
$ADB shell am broadcast -a com.android.systemui.demo -e command enter
$ADB shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
$ADB shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
$ADB shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e fully true
$ADB shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
$ADB shell cmd notification list                     # find the Safety Center notification's key
$ADB shell cmd notification snooze --for 7200000 "'<key>'"   # hides its shield for 2 hours
# ... screenshots ...
$ADB shell am broadcast -a com.android.systemui.demo -e command exit
$ADB shell settings put global sysui_demo_allowed 0
```

- No mobile network line: on API 37 the demo `network -e mobile show` always shows "3G" with
  white icons, whatever `datatype` says (`none`, `hide`, `lte`, `4g`, `1x`, `dis`), and
  `mobile hide` does not remove them, so the screenshots show Wi-Fi only. `fully true` keeps the
  "!" off the Wi-Fi icon.
- `notifications -e visible false` leaves the Safety Center's "no screen lock" notification icon (a
  shield next to the clock), so snooze that notification (its key has `|` in it, hence the two
  quotes). It comes back by itself after the two hours; `cmd notification unsnooze` is refused to
  the shell user ("Permission Denial: getIntentSender()").
- If System UI stops responding right after boot (seen on the tablet under heavy host load), wait
  until it recovers, then send the demo commands again.

Notes from the D9 runs:

- `$ADB` with its `-s` argument splits into words in sh and bash, not in zsh (the macOS default);
  there, use a two-line wrapper script (`exec "$SDK/platform-tools/adb" -s "$SERIAL" "$@"`) instead.
- Quote a link twice when it has `&` or `?`, once for the host shell and once for the device's:
  `$ADB shell am start -a android.intent.action.VIEW -d "'thirteen://month?year=2026&month=11'"`.
- Right after `adb install -r` of a running app, Android 17 relaunches the previous activity
  without its extras, which drops the QA options: wait a few seconds after the install, then
  force-stop and launch again.
- Month numbers in links are 13-month months: IFC October is `thirteen://month/2026/11`.
- `uiautomator dump` and `uiautomator events` cannot run at the same time (the second one crashes).

Dates and time zones on an emulator (Google APIs images allow `adb root`; restore with
`settings put global auto_time 1` and `cmd time_zone_detector set_auto_detection_enabled true`):

```sh
ADB="$SDK/platform-tools/adb -s emulator-5584"
$ADB root
$ADB shell settings put global auto_time 0
$ADB shell date 123023592026.30                 # 2026-12-30 23:59:30: Today turns to Year Day at midnight
$ADB shell cmd time_zone_detector set_auto_detection_enabled false
$ADB shell cmd time_zone_detector suggest_manual_time_zone --zone_id America/Los_Angeles
```

Release smoke test: sign the unsigned release APK with the debug key into a temporary file (never
into the repository), install it and launch it:

```sh
BT="$SDK/build-tools/37.0.0"
export PATH="$JAVA_HOME/bin:$PATH"     # apksigner needs a Java runtime on PATH ("Unable to locate a Java Runtime")
"$BT/apksigner" sign --ks ~/.android/debug.keystore --ks-pass pass:android \
  --out /tmp/Thirteen-release-debugsigned.apk app/build/outputs/apk/release/app-release-unsigned.apk
"$BT/aapt2" dump badging /tmp/Thirteen-release-debugsigned.apk | grep -E "^package|uses-permission"
"$SDK/platform-tools/adb" -s emulator-5584 install -r /tmp/Thirteen-release-debugsigned.apk
```

## Module map

```
android/
├─ settings.gradle.kts, build.gradle.kts   # plugins declared once (apply false)
├─ gradle/libs.versions.toml               # every version in one place
├─ core/                                   # :core, pure Kotlin/JVM, no runtime dependencies
│  ├─ src/main/kotlin/com/haugas/thirteen/core/
│  │  ├─ Gregorian.kt     GregorianDate (+ java.time edges), GregorianMonthInfo
│  │  ├─ Systems.kt       CalendarSystemId, IntercalaryDayId, CalendarSystem, descriptors
│  │  ├─ SystemData.kt    IFC, Positivist and Gregorian data (checked against the fixtures)
│  │  ├─ Thirteen.kt      ThirteenDate / ThirteenMonthDate / ThirteenIntercalaryDate, slots
│  │  ├─ Compare.kt       Comparison, label lookups, daysUntilYearDay
│  │  ├─ Layout.kt        13-month and Gregorian month grids
│  │  ├─ Alignment.kt     MonthAlignment (ribbon data)
│  │  ├─ Stats.kt         YearStats
│  │  ├─ Format.kt        formatting and numeric parsing (SPEC §3.1)
│  │  ├─ Notable.kt       NotableDate, NotableDateInYear
│  │  ├─ Navigation.kt    UI helpers: clampYear, plusDaysOrNull, slot picker, nextDayStart
│  │  ├─ Weekday.kt, Errors.kt, Internal.kt
│  │  └─ events/          the events engine (docs/EVENTS.md §3 to §5), see "Events" below
│  │     ├─ Time.kt              LocalDateTime, ZoneResolver, ZoneMath, end forms
│  │     ├─ JavaTimeZoneResolver.kt  ZoneResolver on java.time ZoneRules (the app's resolver)
│  │     ├─ RRule.kt, RRuleExpansion.kt  RFC 5545 rules: parse, format, equality, UNTIL, candidates
│  │     ├─ DateList.kt          RDATE / EXDATE text (TZID; and UTC forms) for the Calendar Provider
│  │     ├─ ThirteenRules.kt     13-month rules: dates, encodings, RDATE parts, markers, detached URIs
│  │     ├─ Recurrence.kt        EventRecurrence: expansion, ends, splits, retimes, toRRule
│  │     ├─ RecurrenceText.kt    descriptions, next occurrences, notes, presets, adaptation
│  │     ├─ Recognition.kt       stored RRULE / RDATE / marker data back to a repeat (§4.5)
│  │     ├─ Occurrences.kt       expandSeries: series + overrides to device wall-clock occurrences
│  │     ├─ Model.kt             drafts, validation, merge, applyToSeries, alerts
│  │     └─ EventLayout.kt       Month lanes, Week and Day timelines, agenda, Year marks, chip time
│  └─ src/test/kotlin/...  FixtureParityTest, ExhaustiveRangeTest, EdgeDaysTest, support/,
│                          events/ (EventsFixtureParityTest, EventsExhaustiveTest, EventsModelTest,
│                          RecordedZoneResolver, the events JSON forms)
└─ app/                                    # :app, Compose + Material 3, depends on :core
   └─ src/main/
      ├─ java/com/haugas/thirteen/ui/theme/ThemeTokens.kt   generated (scripts/design/gen-tokens.mjs)
      ├─ kotlin/com/haugas/thirteen/
      │  ├─ MainActivity.kt    single Activity: edge-to-edge, splash until settings load, links
      │  ├─ AppViewModel.kt    settings StateFlow + the deep-link channel, HANDLE_CUSTOM_EVENT lookup
      │  ├─ QaOptions.kt       debug-only QA extras: fixed today, the mockup events
      │  ├─ data/              UserSettings, SettingsRepository (DataStore), CalendarVisibility,
      │  │                     CalendarEventsModel (the window's events: calendars, years, merges),
      │  │                     DefaultCalendar.kt (the default calendar, the Calendars list's groups)
      │  ├─ data/calendar/     the events data layer (docs/EVENTS.md §6.3), see "Calendar data" below
      │  │  ├─ CalendarRepository.kt    the interface the views use, keys, spans, results
      │  │  ├─ ProviderCalendarRepository.kt  on the Calendar Provider: reads, re-resolution, batches
      │  │  ├─ ProviderMapping.kt       cursor rows, the §3.4 and §3.5 tables, column builders
      │  │  ├─ RecurrenceStorage.kt     forms (a) to (d), parts, top-up, gate constants
      │  │  ├─ ProviderWrites.kt        write plans: span edits, splits, retimes, moves, deletes, top-up
      │  │  ├─ CalendarObserver.kt      provider changes as a debounced Flow
      │  │  ├─ CalendarPermissions.kt   the §2.16 access states and their DataStore flags
      │  │  ├─ ExternalCalendarIntents.kt  "Add in your calendar app", "Open in calendar app", geo:
      │  │  └─ FakeCalendarRepository.kt, MockupEvents.kt  the mockup data set (debug assets)
      │  ├─ navigation/        DeepLink, Routes (+ EditorTarget), ThirteenAppState, ListDetailScene,
      │  │                     SupportingPaneScene (Calendars pane and sheet), CustomEventLink,
      │  │                     KeyboardShortcuts
      │  ├─ ui/                ThirteenApp (NavigationSuiteScaffold + NavDisplay), Phrasing
      │  ├─ ui/components/     date plate, day grids (with Year dots), year progress, cards, icons
      │  ├─ ui/theme/          Theme.kt (palette -> ColorScheme), Type.kt (Geist, tabular figures)
      │  └─ feature/           today, calendar, events, year (grid layout), detail, convert, compare,
      │                        history, settings; see "Calendar" below
      ├─ res/font/             Geist and Geist Mono 1.8.1 (OFL, assets/licenses/Geist-OFL.txt)
      ├─ res/values/strings.xml  every sentence (Phrasing.swift as string and plurals resources)
      └─ res/values/strings_calendar.xml  the Calendar's copy (docs/EVENTS.md §2.19, catalogue ids)
```

## The engine (`:core`)

A port of `@thirteen/core` with the same rules, results and English text. The arithmetic is
integer-based (day-of-year and Julian Day Numbers); `java.time` appears only at the edges
(`GregorianDate.today(clock)`, `GregorianDate.of(instant, zone)`, `startOfDay(zone)`,
`toLocalDate()`, `GregorianDate.from(localDate)`). Supported range: 0001-01-01 to 9999-12-31.

Conventions, translated from SPEC §4.1:

| TypeScript | Swift (ThirteenKit) | Kotlin (`:core`) |
|---|---|---|
| `{year, month, day}` | `GregorianDate(year:month:day:)` | `GregorianDate(year, month, day)`, a data class valid by construction |
| `ThirteenDate` (`kind`) | `enum ThirteenDate { .month, .intercalary }` | `sealed interface ThirteenDate`: `ThirteenMonthDate`, `ThirteenIntercalaryDate` |
| every `year` parameter is Gregorian | same | same; display years via `system.displayYearOf(year)` / `gregorianYearOf(displayYear)` |
| `systemId` last, default `'ifc'` | `system: .ifc` | `system: CalendarSystemId = IFC` last |
| throws `RangeError` | `throws(ThirteenError)` | throws a `ThirteenException` subclass (an `IllegalArgumentException`) |
| `tryParseISODate`, `tryParseThirteen` | `try?` | `GregorianDate.parseOrNull`, `ThirteenDate.parseNumericOrNull` |
| `toThirteen(g, id)`, `fromThirteen(t)` | `g.thirteen(in:)`, `t.gregorian` | `g.toThirteen(id)` / `ThirteenDate.of(g, id)`, `t.gregorian` |
| `addGregorianDays`, `addThirteenDays`, `addThirteenMonths` | `adding(days:)`, `adding(months:)` | `plusDays`, `plusMonths` (+ `...OrNull` in Navigation.kt) |
| `diffGregorianDays(a, b)` | `a.daysSince(b)` | `a.daysSince(b)` |
| `compare(g, id)` | `Comparison(g, system:)` | `Comparison(g, id)` or `g.comparison(id)` |
| `buildThirteenYear`, `buildThirteenMonth`, `buildGregorianMonth` | `ThirteenYearLayout(...)` ... | `ThirteenYearLayout(year, id)`, `ThirteenMonthLayout(...)`, `GregorianMonthLayout(year, month, id, weekStartsOn)` |
| `monthAlignment`, `yearStats` | initializers | `MonthAlignment(year, id)`, `YearStats(year, id)` |
| `lookupGregorianLabel`, `lookupThirteenLabel` | initializers | `GregorianLabelLookup(g, id)`, `ThirteenLabelLookup(t)` |
| `thirteenSlots`, `intercalaryDaysInYear`, `notableDatesInYear` | `.all(inYear:)` | `ThirteenSlot.allInYear`, `IntercalaryOccurrence.allInYear`, `NotableDateInYear.allInYear` |
| `sameSlotInYear`, `sameLabelInGregorian`, `sameLabelInThirteen` | methods | `t.sameSlotInYear(year)`, `t.sameLabelInGregorian`, `g.sameLabel(id)` |
| `formatThirteen`, `formatGregorian`, `parseThirteen` | `formatted(_:)`, `init(numeric:)` | `formatted(FormatOptions)`, `ThirteenDate.parseNumeric(text, id)` |
| `IFC`, `POSITIVIST`, `CALENDAR_SYSTEMS`, `GREGORIAN_CALENDAR` | `CalendarSystem.ifc` ... | `CalendarSystem.IFC`, `.POSITIVIST`, `.ALL`, `GregorianCalendarInfo.GREGORIAN` |
| `Weekday` 0 = Sunday | `Weekday.sunday` | `Weekday.SUNDAY` (`value` 0..6; `toDayOfWeek()` for java.time) |

Results are immutable data classes whose properties follow the TS field order; factory functions
named like the type (`Comparison(...)`, `YearStats(...)`) build them, their constructors are
internal.

### How parity is guaranteed

- **FixtureParityTest** reads `fixtures/conversions.json` (version 2) and asserts every section:
  the 1620 conversion cases in both directions, 68 comparisons, 21 x 63 formatted strings,
  numeric parsing, systems metadata, year stats, month alignments, layouts, slots, label lookups,
  notable dates and arithmetic. Results that the fixture holds as exact core JSON are encoded in
  the TS shape and compared structurally (same keys in the same order, explicit `null`s, numbers
  by value). Section sizes are asserted, and the run prints how many entries and checks each
  section made.
- **ExhaustiveRangeTest** walks every day from 0001-01-01 to 9999-12-31 (3,652,059 days) with
  `java.time.LocalDate` as the oracle and converts each day to IFC and Positivist and back,
  checking the 13-month fields against an independent implementation of the SPEC §1.1 / §1.2
  mapping and round-tripping the numeric text form.
- **EdgeDaysTest** covers the SPEC §2 anchor table and invariants, Leap Day, Year Day, the
  Positivist festivals, year boundaries, range edges, error cases and messages, strict parsing,
  java.time edges (DST gaps at midnight, whole days skipped by a zone) and the navigation helpers.

When the TypeScript engine changes: `pnpm fixtures` at the repository root, then
`./gradlew :core:test`.

### Events (`com.haugas.thirteen.core.events`)

A port of `packages/core/src/events` (docs/EVENTS.md §3 to §5; the `.ics` codec is not ported).
Wall-clock values are `LocalDateTime` (a `GregorianDate` and a minute, `T24:00` only in ends);
time zones go through a `ZoneResolver`, so every zone rule (gaps move forward, overlaps take the
earlier instant) lives in `ZoneMath` and the platform only answers offsets. Value types are valid
by construction (their `init` checks what the TS `assert...` functions check). Digits are matched
as ASCII only (never `Char.isDigit` or `toInt` on raw text: the fixtures' `FREQ=DAILY;COUNT=١٠` and
`２０２６１０１９` are rejected, as in TS), and case mapping is ASCII or `Locale.ROOT` (`lowercase()`),
never the device locale.
Names follow EVENTS.md §5.7:

| TypeScript | Kotlin (`:core`, package `events`) |
|---|---|
| `LocalDateTime`, `parseLocalDateTime`, `tryParseLocalDateTime`, `formatLocalDateTime` | `data class LocalDateTime`, `LocalDateTime.parse` / `parseOrNull`, `.isoString` |
| `addMinutesLocal`, `diffMinutesLocal`, `compareLocalDateTime` | `.plusMinutes(Long)`, `.minutesSince(other)`, `compareTo` |
| `normalizeEventEnd`, `displayEnd`, `occurrenceDays` | same names, top-level functions |
| `ZoneResolver`, `zonedToUtc`, `utcToZoned` | `interface ZoneResolver`, `ZoneMath.toUtc(...)`, `ZoneMath.toZoned(...)`; `JavaTimeZoneResolver` for the app |
| `RRule`, `parseRRule`, `tryParseRRule`, `formatRRule`, `rruleEquals` | `data class RRule`, `RRule.parse` / `parseOrNull`, `.format()`, `rruleEquals(a, b, ignoreEnd, ignoreWkst)` |
| `untilInZone`, `untilEndDate`, `formatUntil` | same names, top-level functions |
| `parseDateList`, `formatDateList` | `DateList.parse` / `parseOrNull`, `DateList.format(values, form)` |
| `ThirteenRule`, `thirteenRuleFor`, `thirteenRuleDatesInYear`, `thirteenRuleIncludes` | `sealed interface ThirteenRule`, `ThirteenRule.of(kind, start, system)`, `rule.datesInYear(year, start)`, `rule.includes(date, start)` |
| `encodeThirteenRule`, `thirteenRuleRdates`, `thirteenRuleRdateParts` | `rule.encode(start)`, `rule.rdates(...)`, `rule.rdateParts(...)` |
| `formatThirteenRuleText` / `parse...`, `formatThirteenRuleUri` / `parse...`, `formatDetachedUri` / `parse...` | `rule.formatText()` / `ThirteenRule.parseText`, `rule.formatUri(...)` / `ThirteenRule.parseUri`, `DetachedUri.format` / `parse` |
| `EventRecurrence`, `expandRecurrence`, `nextOccurrences`, `recurrenceToRRule` | `data class EventRecurrence`, `.expand(start, window, limit)`, `.nextOccurrences(start, count)`, `.toRRule(start)` |
| `endRecurrenceBefore`, `laterOccurrenceCount`, `splitRecurrence`, `retimeExceptions` | `.endBefore(start, date)`, `.laterCount(start, at)`, `.split(...)`, `.retime(...)` |
| `recognizeRecurrence` | `Recognition.of(input, system)` |
| `describeRecurrence`, `describeNextOccurrences`, `describeRepeatNotes` | `.describe(start, system)`, `.describeNext(start, system, count)`, `.repeatNotes(start, system, gregorianOnlyCalendar)` |
| `repeatPresets`, `matchRepeatPreset`, `adaptRecurrenceToStart` | `RepeatPreset.all(start, system)`, `RepeatPreset.match(recurrence, start, system)`, `.adaptToStart(oldStart, newStart)` |
| `expandSeries` | `expandSeries(series, window, deviceZone, zones, limit)` |
| `validateDraft`, `newEventDraft`, `moveDraftStart`, `setDraftAllDay` | same names; option bags become named parameters |
| `changedFields`, `mergeDraft`, `applyToSeries` | same names |
| `alarmFireTime`, `alarmPresets`, `describeAlarm` | same names (`alarmFireTime` also takes an `ExpandedOccurrence`) |
| `layoutThirteenMonthEvents`, `layoutThirteenWeekEvents`, `layoutDayEvents` | `ThirteenMonthEventLayout(...)`, `WeekEventLayout(...)`, `DayEventLayout(...)` |
| `monthColumnGregorianWeekdays`, `formatChipTime`, `agenda`, `yearEventMarks` | `monthColumnGregorianWeekdays(...)`, `ChipTime.text(...)`, `AgendaDay.days(...)`, `YearMark.marks(...)` |
| `RangeError` | `ThirteenException.InvalidEvent`, `ThirteenException.InvalidRule` |
| string unions (`'to-all-day'`, `'byyearday'`, ...) | enums with the TS string as `id` (`AllDayToggle.TO_ALL_DAY.id == "to-all-day"`) |

Parity:

- **EventsFixtureParityTest** replays every section of `fixtures/events.json` (version 1,
  `complete: true`, 36 sections, 1236 cases). The envelope test fails on a section it does not
  know and asserts every `counts` entry against its section; each section test asserts it
  replayed exactly `counts` cases. Results are encoded in the TS JSON shape and compared key by
  key. `zones` runs through `JavaTimeZoneResolver` (a failure prints the fixture's and the JVM's
  tzdata versions); `untils`, `series` and `alarmInstants` run through `RecordedZoneResolver`
  built from `zoneOffsets` alone; `zoneMath` through the synthetic tables of its cases. Two
  fixture values have no Kotlin form (`wallClock` minutes `1.5`, a draft count of `2.5`); the test
  checks that the fixture expects a rejection for them and counts them as rejected by type.
- **EventsExhaustiveTest** checks every 13-month rule (830: monthly, weekly, every 2 weeks in both
  phases, yearly, intercalary, both systems) for every year 1 to 9999 against the SPEC §1.1 /
  §1.2 day-of-year formulas with `java.time` as the Gregorian oracle (29,141,934 dates), every day
  of the range against `rule.includes`, and every rule's `RRULE` encoding expanded as a Gregorian
  rule at both ends of the range and around century years.
- **EventsModelTest** covers the editor rules the fixtures do not replay: `moveDraftStart`,
  `setDraftAllDay`, `changedFields`, `describeAlarm`, `RepeatPreset.match` and alert range edges.

## The app (`:app`)

Thirteen for phones, foldables and tablets: the Apple app's screens (Today, the Calendar with
Year mode and the day comparison, Convert, Compare, History, Settings) in Compose and Material 3,
in English, with no network access. The manifest asks for `READ_CALENDAR` and `WRITE_CALENDAR` (events go through the
Calendar Provider; the accounts' own sync adapters do any networking) and declares `<queries>` for
the calendar app intents (insert, view an event, `geo:` locations). Besides those, the only
`uses-permission` in the merged manifest is `com.haugas.thirteen.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`,
the app's own signature permission that AndroidX Core adds for `ContextCompat.registerReceiver`.
There is still no `INTERNET` permission.

- **Theme.** `ui/theme/ThemeTokens.kt` is generated from `design/tokens` by
  `node scripts/design/gen-tokens.mjs --targets android` and stays at the generator's path
  (`src/main/java/...`, compiled with `src/main/kotlin`). `Theme.kt` maps each theme and mode onto
  a Material `ColorScheme` (no dynamic colour) and provides the full palette through
  `Thirteen.colors` (a CompositionLocal) for what Material has no role for (foil, accent wash,
  rules). The five light-and-dark themes (Almanac, Graphite, Slate, Forest, Mono) follow the
  Appearance setting; the three always-dark ones (Obsidian, Midnight, Phosphor) force
  `darkTheme = true` and dark system-bar icons, and Settings then shows Appearance disabled with
  Dark selected (what is on screen; the saved choice is untouched and comes back with a light and
  dark theme) and the same note as the Apple app and the web ("Midnight is always dark. Pick a
  light and dark theme to use Appearance again.", design/DECISIONS.md). The picker groups them as the tokens do (`ThemeGroup`). The day
  grids set Sundays in the accent text colour, like the Apple and web grids. In Mono, where the
  accent is the ink (`marksWithoutColor`), Sundays and the current month's name and number on the
  Year screen are bold instead, and the Compare charts (ribbon, month lengths, quarters, weekday
  drift) hatch their Gregorian bands.
  `FocusRing.kt` replaces the default indication with Material's ripple plus a keyboard focus ring
  in the theme's `focus` colour. `Type.kt` sets Geist and Geist Mono with tabular figures (`tnum`)
  everywhere. Settings stores the theme and light, dark or system.
- **Navigation.** `ThirteenApp` is a `NavigationSuiteScaffold`: a navigation bar on compact
  widths, a rail from medium up. Each section keeps its own back stack in `ThirteenAppState`
  (string route keys, saved across configuration changes and process death, no reflection), and
  one Navigation 3 `NavDisplay` shows Today's stack under the current section's, so back exits
  through Today. Back is predictive (`enableOnBackInvokedCallback`). On expanded widths the
  `ListDetailSceneStrategy` shows the Year grid and the day comparison side by side (a
  placeholder until a day is picked; the pane has Close instead of Back), and
  `SupportingPaneSceneStrategy` shows the Calendars list as a 360 dp pane beside the Calendar
  (a bottom sheet on compact and medium widths). The pane is on demand (docs/EVENTS.md §2.1,
  §2.15, owner decision of v3.3): `Route.Calendars` is on the stack only after "Calendars" in the
  overflow menu or "Show calendars", Close or Back pops it, and nothing opens it by itself, so
  the Calendar starts at full width. Convert and Today use two columns when the window
  is wide enough. The Calendar section (Ctrl+2, the second tab) replaced Year: see "Calendar" below.
- **Deep links.** The manifest registers `thirteen://` (`VIEW`, `DEFAULT`, `BROWSABLE`) on the
  single exported, `singleTop` `MainActivity`. Only the data string of a `VIEW` intent is read;
  `DeepLink.parse` treats it as untrusted (length limit, strict values, nothing forwarded) and
  routes exactly like `apple/Shared/App/DeepLink.swift`: `today`, `year/2026?day=2026-10-19`,
  `convert?date=2026-10-19` (or `convert/2026-10-19`), `convert?thirteen=2024-LD`,
  `compare/2024` (or `?year=`), `history`, `calendar`, `month/2026/11`, `week/2026-10-19`,
  `day/2026-10-19`, `new-event?date=2026-10-21`, each with an optional `?system=ifc|positivist` that
  switches and persists the system. A cold-start link is applied to the first frame; later links
  come through `onNewIntent` and a buffered channel. `HANDLE_CUSTOM_EVENT` (calendar apps, for
  events Thirteen created) is the other intent the activity reads: only its event id and
  `customAppUri`, both strictly (`CustomEventLink`).
- **Keyboard.** With a hardware keyboard (tablets, foldables, Chromebooks) the Apple app's Go
  menu works with Ctrl for Command (`navigation/KeyboardShortcuts.kt`), with the Calendar keys of
  docs/EVENTS.md §2.21 (its Windows column): Ctrl+T in the Calendar goes to today in its mode,
  elsewhere to Today with the Calendar, Compare and Convert screens back on today; Ctrl+Left and
  Ctrl+Right page the Calendar's mode (Year: a year) or step Compare's year (from another section
  they open the Calendar); Ctrl+1 to Ctrl+5 show Today, Calendar, Convert, Compare and History;
  Ctrl+Shift+1 to Ctrl+Shift+5 show Day, Week, Month, Year and List (Week opens Day below
  expanded width); Ctrl+N is "New event" while the Calendar shows events; Alt+Left and Alt+Right
  step the day comparison on screen (the Apple sheet's Option+arrows). `MainActivity` gives keys to the shortcuts before the view
  hierarchy, except while a text field has focus (the editor's Title, Location and Notes, the
  converter: Ctrl+arrows move by word there) and while the editor is on top of the section
  (`ThirteenAppState.shortcutsPaused`: nothing changes the calendar under it). A mode switch, a
  tab reselect or a `thirteen://` link that would close an editor with a changed draft waits for
  its "Discard changes?" or "Discard this event?" question (`ThirteenAppState.discardRequest`;
  "Keep editing" drops it, §2.11). Ctrl+Shift+5 and the List toggle exist only while "Show my
  events" is on (`listOffered`, §2.16). The shortcuts are listed for the system's keyboard
  shortcuts screen (Meta+/). Esc
  that nothing on screen takes closes what Back closes on top of a section (§2.21: the editor,
  asking before it discards changes, details, the Calendars list, a comparison, Settings;
  `ThirteenAppState.escapeCloses`), never a mode or a section (task D9: Esc did nothing on a
  tablet). Tab moves focus into the Month grid (a focus ring on the cell), arrows move it by day
  and week, Enter selects.
- **Gregorian date picker.** Material's `DatePicker` covers 0001 to 9999: its grid, selection and
  text input use java.time, which is proleptic Gregorian like the engine. Its month title,
  headline and TalkBack day labels go through `ProlepticDateFormatter` (engine formatting),
  because Material's own formatter uses ICU's calendar, which switches to Julian dates before
  15 October 1582 (it showed "February 1000" and "Feb 24, 1000" over the grid of March 1000).
- **Copy.** Every sentence is a string or plurals resource (`ui/Phrasing.kt` assembles them like
  `Phrasing.swift`). Engine text (history, summaries, intercalary descriptions) goes through
  `Phrasing.withoutDashes`, so no em or en dash reaches the screen; the tests check every screen.
- **Today's date.** `rememberToday()` (`feature/today/RememberToday.kt`) keeps the local date
  current like the Apple app's `AppState` clock: a timer for the start of the next local day, a
  re-read whenever the UI returns to the foreground and on the system's date, clock and
  time-zone change broadcasts.
- **Compose stability.** `app/compose-stability.conf` declares every `:core` type stable. `:core`
  is not compiled by the Compose compiler, which would otherwise treat `GregorianDate`,
  `DayCell`, layouts and `Comparison` parameters as unstable.
- **Release.** Version 1.0.0 (build 1), label "Thirteen", R8 with resource shrinking, English
  resources only. Backup and device transfer include only the settings file
  (`res/xml/backup_rules.xml`, `data_extraction_rules.xml`). `app/build.gradle.kts` reads
  `THIRTEEN_KEYSTORE_PATH`, `THIRTEEN_KEYSTORE_PASSWORD`, `THIRTEEN_KEY_ALIAS` and
  `THIRTEEN_KEY_PASSWORD` from the environment; without all four, `assembleRelease` produces
  `app-release-unsigned.apk`. Keystores are git-ignored and never belong in the repository.
- **Icon.** The adaptive, monochrome and legacy launcher icons are the exports in
  `design/icon/exports/android` (the `mipmap-anydpi-v26` folder becomes `mipmap-anydpi`, since
  minSdk is 26), plus `ic_launcher-playstore.png`. One change by hand: the background's row of
  perforation dots is split into paths of 8 dots, so no `pathData` is over lint's `VectorPath`
  limit of 800 characters (the shapes are the same). Regenerating it with `design/icon/build.py`
  brings the single 3308-character path, and the lint warning, back.
- **Tests.** `app/src/test` runs on the JVM: Robolectric Compose UI tests for every screen and the
  app shell (phone and expanded tablet), deep-link parsing (the Apple cases), navigation state,
  keyboard shortcuts, settings persistence on a real DataStore file, and the Phrasing sentences.
  The Calendar's tests (`feature/calendar`, `navigation/CustomEventLinkTest`) run on the mockup
  data set (`testing/CalendarTesting.kt`: the fake repository, 24-hour time) and assert the
  §2.20 labels word for word. Robolectric is pinned to SDK 36, the newest it runs; the app targets 37
  (at SDK 37 every Compose test fails in Espresso 3.7.0 with `NoSuchMethodException:
  android.hardware.input.InputManager.getInstance()`, tried in task D9). `AccessibilityPassTest`
  holds the D9 pass: the paging actions on Month cells, the Year Day band, Day and Week columns,
  their absence at 9999's last month, and Month, Day, List, Year, the editor and Week at font
  scale 2.0. `CalendarAccessibilityTest` (`app/src/androidTest`) checks the same on a device
  through `UiAutomation`, the way TalkBack and Switch Access read the tree, plus a hardware
  keyboard and a calendar app's `HANDLE_CUSTOM_EVENT`.

### Calendar (`feature/calendar`, `feature/events`)

The Calendar section of docs/EVENTS.md §2.1 to §2.7 (task D4). Its root is Year mode, the top of
the compact drill-down; Month, Week, Day and List are `Route.Calendar(mode)` entries above it, so
Back from Month goes to the year and Back from Day to the month. The day those modes show is
`ThirteenAppState.calendarDate`, shared by all of them, so paging changes state, not the back stack.
First launch: Month, today. At expanded width the segmented buttons replace the mode in place.

- **Top app bar** (`CalendarTopBar.kt`). Compact and medium: back arrow (none in Year), title and
  Gregorian subtitle, "Today" (hidden while today is on screen), the List / Month toggle (Month and
  List), the overflow menu with the system choice and "Calendars". Expanded: "‹", "›", "Today", the
  title, the segmented buttons Day, Week, Month, Year, List, the overflow. The title is a polite
  live region ("November 2026. Gregorian Nov 5 to Dec 2.") with the paging custom actions; swipes
  page too. "New event" is the FAB (extended at expanded width). Titles, paging and "is today on
  screen" are plain functions in `CalendarPeriods.kt`.
- **Year** (`YearMode.kt`): the former Year screen's grid, with up to three event dots per day
  (`yearEventMarks`, `year.cell.events` as the cell's value) when "Show events in Year view" is on;
  month titles open Month (today if it is in that month, else its first day). Back from a mode
  to Year (the compact drill-down) shows the year of the day that mode was on, scrolled to its
  month; closing a day's comparison or the Calendars list over Year keeps the year Year was paged to.
- **Month** (`MonthMode.kt`, `MonthEventGrid.kt`, `IntercalaryBand.kt`, `MonthDayList.kt`): the two-line
  weekday header (`monthColumnGregorianWeekdays`), every Gregorian date in its cell, intercalary
  days as a full-width band under week 4. Compact and medium widths choose one density per screen:
  titles (up to 2 lanes and "+N") from 60 dp cells at font scale 1.0 or less, else dots (up to three
  and the count), with the selected day's list under the grid; tap selects, a second tap opens Day,
  long press offers "New event", "Open day", "Day details". Expanded: as many lanes as the cell
  height holds, chips with their time open their details, "+N more" opens the day's list,
  double-click adds an event. Rows of repeating events in the selected day's list and the "+N more"
  list add " · " and the repeat in words to their second line ("until 10:30 · Every 2 weeks on
  Monday", board A1; `RepeatTexts.kt` reads each series once per change). Bars (`MonthBar`, also in
  Week and Day's all-day rows and the intercalary band) are the tint with a 2 dp edge in the calendar
  color on the leading side, none on a notched continuation. Font scale 1.5 and larger: a list of the month's days, runs of empty
  days as one line ("No events, October 21 to October 23"), opened on the selected day. Each cell
  is one TalkBack element (`calendar.cell.a11y` + count + "Gregorian {Month} begins.") with "Open
  {title}" custom actions; cells are keyed by position so focus survives paging.
- **Paging without gestures** (§2.1, task D9: `PagingActions.kt`). Besides the title, every grid
  element carries the paging custom actions after its own, so Switch Access and TalkBack's actions
  menu page from wherever focus is: Month cells, the intercalary band and the large-text list's day
  headers ("Previous month", "Next month"), Day's column ("New event", "Previous day", "Next day")
  and Week's columns ("Previous week", "Next week"). An action is left out where there is no page
  (no "Next month" in December 9999). For large text (checked at font scale 2.0) the top bar's
  subtitle shrinks to fit one line (to 60% at most), the Day week strip keeps its size
  (`CapFontScale`), and in Day's all-day row a multi-day bar's "Day 1 of 7" sits at the bar's end
  instead of over its title.
- **List** (`ListMode.kt`): from the selected day onward, sticky 13-month month headers, one
  Gregorian year per read, extended at the end and backward when pulled down at the top. Year
  merges dedupe by key (`CalendarEventsModel.merge`): the Winter break crosses January 1 and shows
  once per day.
- **Week and Day** (task D5: `WeekMode.kt`, `DayMode.kt`, `Timeline.kt`). Week (expanded width only;
  Day below it and at font scale 1.5 and more) has one column per day of the 13-month week plus the
  intercalary days after week 4 (60% wide, hatched), headed `Thu 12` over `Mon, Oct 19` (a header
  opens that Day), the all-day row (bars in lanes, notched where they continue, collapsed after 3
  lanes with "+N"), and the 24-hour timeline: hour rules, half-hour hairlines, hour labels drawn on
  an axis TalkBack skips, the now line under the blocks with its dot and time on the axis, opened at
  07:00 or the period's first event if earlier. Blocks come from core's `WeekEventLayout` /
  `DayEventLayout` with `maxSlots` = column width / 48 dp (Week) or / 64 dp (Day); a crowded cluster
  shows its first slots and a "+{n}" block ("3 more events at 14:00") that lists the rest. Each
  column is one TalkBack container (`calendar.column.a11y`, `isTraversalGroup`) with its blocks
  inside in start order and a "New event" action at the next half hour on screen. Day has the week
  strip (both dates per day, the selected one filled; an intercalary day shows the week before it)
  and, at expanded width, a 360 dp panel with the selected block's details or the day's comparison.
  A tap on empty time draws the "New event" placeholder at that half hour ("New event, 14:00 to
  15:00"); a tap on it opens the editor (`EditorTarget.New(date, minute)`), a tap elsewhere removes it.
  Copy for both bullets is in `res/values/strings_events_timeline.xml`; texts the editor shares (the
  moved toasts, `span.title`, the draft issues) stay in `strings_events_editor.xml`.
- **Drag and drop** (task D5: `DragAndDrop.kt`, `EventMoves.kt`, `MoveFlow.kt`). The platform drag
  (`dragAndDropSource` after a long press, at once with a mouse; the payload in the drag's local
  state, never global; the shadow is the item, centered on the finger as Compose places it). Every
  source is also clickable, and a clickable consumes the down, so the start detection is our own
  (`awaitFirstDown(requireUnconsumed = false)` then `awaitLongPressOrCancellation`, through the
  deprecated `dragAndDropSource(drawDragDecoration, block)` overload): the overload that takes only the
  transfer data never started a drag on a device. `MoveFlowTest` keeps that case. The shadow is a
  layer `eventDragSource` records on every draw: foundation's default shadow painter records the item
  once per size and draws that recording in its place, so a text or color that changed in place stayed
  stale on screen (`DragSourceRedrawTest`). The dragged block is dimmed in
  place. From the compact day list's rows, Month chips at expanded width, the large-text day list
  and the timeline blocks and bars; drops on Month cells and bands (same time, multi-day bars keep
  their offset), on the timeline (15-minute snap, a dashed preview of where it lands, edge
  scrolling, the start kept within the column's day; the target is a box around the scrolling day,
  because a target's bounds are its layout node's inner bounds, the whole day for the scrolling
  node) and on the all-day rows (timed becomes all-day; a bar on the timeline becomes one hour). Read-only
  events, invitations and calendars Thirteen cannot write are never picked up. A drop fetches the
  occurrence again, moves only its time group (`moveDraftStart`, `setDraftAllDay`), validates the
  result (`validateDraft`: a drop before 1583 is refused with its text), and for a repeating
  occurrence asks "this event only" or "future events" with the repeat change (`span.move.*`: a
  converted repeat, an ended one with the `laterOccurrenceCount` count, the first event becoming one
  event), the changed single events "future events" removes (`splitRecurrence` / `retimeExceptions`
  `droppedCount`), only "this event" for repeats set in another app or a calendar that cannot keep
  the adapted repeat; then "Move this event?" for an organizer's event with invitees. The result is
  held in `PendingChanges` with its toast and Undo (task D6's events layer); without that layer the
  move is written at once (`WriteAtOnceMoveHolder`). `LocalEventMoveHolder` is the seam.
- **Events and access.** `CalendarEventsModel` (a ViewModel, `LocalCalendarEvents`) holds the
  repository, the calendars, Thirteen's visibility (`CalendarVisibility`, references by id, then
  account and name) and up to 6 years of occurrences (declined invitations removed). The access
  card and the controller for the §2.16 states are in `feature/events/AccessCard.kt`; a failed read
  shows `calendar.loadFailed` with "Try again"; a read over 300 ms shows a small progress indicator.
- **Seams for the next tasks**: the comment at the top of `CalendarScreen.kt` lists, for D4 and
  for each task after it, the files it owns, its tests and the shared files it edits only in
  small steps. Those tasks are D5 Week and Day with drag and drop (above), D6 details and the editor,
  D7 Up next, the Calendars list, Settings rows, the device calendar and `ExternalCalendarIntents`
  (both below), and the data layer's top-up, parts and provider gates (D3, D8). Every screen is
  built. The top-up runs on `ON_START` of the process (Calendar data, below).

### Event details, the editor and held changes (task D6)

docs/EVENTS.md §2.10 to §2.15 and §2.11 "Undo" on Android (boards G1, H2, C2, J4). Copy is in
`res/values/strings_events_editor.xml` (catalogue ids, dots as underscores).

- **Details** (`EventDetailScreen.kt`, `Route.Event`): title with the calendar's colour bar, the date
  plate in the chosen system with the Gregorian line (Starts and Ends for multi-day events), time and
  zone, the repeat in its own system's words (plus the "Android stores this repeat as days of the year"
  note), calendar ("Home, iCloud"), alerts, Show as (only when not Busy), a tappable location, linkified
  selectable notes, organizer and the invitees (names up to 5, read from the provider's `Attendees`
  rows; more as "{n} invitees" that opens the list; the count alone where no names are known, as in
  the mockup data). "Edit" and "Delete event" only where the event can be
  written (`DetailActions`); invitations say why and offer "Edit alerts" and "Open in calendar app";
  subscribed and read-only calendars say why. The overflow has "Duplicate" (a draft in the default calendar).
  At expanded width the details are a pane beside the screen they were opened from
  (`ListDetailScene.besidePane`, with a Close button) and the editor a dialog of about 600 dp over it
  (Navigation3 `DialogSceneStrategy`; a tap outside does not close it, Back and Esc ask first).
- **Editor** (`EventEditorScreen.kt`, `EditorState.kt`, `EventDraftCodec.kt`): a full-screen dialog on
  phones (the navigation bar is hidden while it is on top) with Close, "Add" / "Save" and the overflow's
  "Delete event". `EditorState` holds the draft, runs core's `validateDraft` (issues under their fields;
  Save moves focus to the first, which takes focus in touch mode too and scrolls into view, and
  announces the issue on every press), `moveDraftStart` (the repeat notice and the later-events line),
  `setDraftAllDay` (all-day makes the event Free unless Show as was touched), the conflict check for
  calendars that cannot keep a 13-month repeat, `changedFields` and `mergeDraft` (the "changed elsewhere"
  banner), and decides the save step: an issue, the conflict, the span question (`SaveSpanDialog` with the
  losses lines and only "this event" where a span is not allowed) or the write. A new calendar in
  another account first asks `move.confirm` ("Move {title} to {calendar}?" / "It will be copied there
  and removed from {old calendar}.", `MoveConfirmDialog`; Cancel keeps the editor open), because the
  repository copies the event there and deletes the original (§4.7). A missing occurrence shows
  "This event was changed or deleted elsewhere."; Back and Close ask before discarding. The draft survives
  process death as JSON in `rememberSaveable`. Pages: the repeat picker (Keep, Never, Gregorian and
  13-month sections with the "Next:" line, the notes and the Android storage note; non-exchange-safe rows
  disabled for calendars that keep only Gregorian repeats, whose 13-month footer is the Exchange note
  in place of the 28-day sentence, as on Apple), custom repeat, alerts (no "after start" on
  Android), calendar (writable calendars by account; the same-account rule when editing).
- **13-month date field** (`ThirteenDateField.kt`): a pill naming the system with the Gregorian caption;
  the picker sheet has IFC / Gregorian tabs (the last tab is remembered), a year stepper (1583 floor, 9999
  ceiling, leap-only dates step to the next leap year with their line), the month strip and the 4 x 7 grid
  whose cells name both dates; at font scale 1.5 and more a list of the month's days. Ends at midnight are
  shown as the day before (core's `displayEnd`).
- **Held deletes and moves** (`data/calendar/PendingChanges.kt`, `FailedCommits.kt`,
  `feature/events/EventToasts.kt`, `EventsWindowLayer.kt`): a delete (and D5's moves) is held in the
  model's `PendingChanges`, the views hide it at once (`overlay`), and its toast offers Undo. The toast's
  close or timeout, the next action (another hold, a save, opening details or the editor, paging), a data
  change from elsewhere, leaving the app (`ON_STOP`) and an alert a minute away write it. A transient
  failure is retried once, then reverted with "Try again"; final causes name their reason. Failures while
  Thirteen was not in front are kept in a small DataStore and shown at the next start (one: the event's
  toast; several: "Show" opens the list). Toast timeouts follow `getRecommendedTimeoutMillis`, and a toast
  with an action stays until dismissed while TalkBack is on.
- **Tests**: `EditorStateTest` (21), `EventEditorScreenTest` (7), `EventDetailScreenTest` (6),
  `ThirteenDatePickerTest` (6), `EventToastHostTest` (2) and `PendingChangesTest` (10), on the mockup data set.

### Today, the day sheet, Settings and the Calendars list (task D7)

docs/EVENTS.md §2.8, §2.9, §2.15, §2.16 and §2.18 on Android, on the same `CalendarEventsModel`.

- **Up next** (`feature/today/UpNext.kt`, `UpNextCard.kt`): under Today's hero, before "Against the
  Gregorian calendar". `UpNext.of` reads §2.8 as the web and the Apple app do (today and the next 6
  days, at most 6 rows, an event once on the first day it touches, what ended earlier today left out,
  the agenda's order). Rows are the shared `EventRow` (`calendar.row.a11y` + flags; the running one
  has the "Now" plate, which TalkBack hears as the row's state). Groups "Today", "Tomorrow", then
  "Saturday, October 14" with "Gregorian Wed, Oct 21"; "{n} more in the next 7 days"; "Nothing else
  today." and "No events in the next 7 days."; "All calendars are hidden." with "Show calendars".
  "+" starts a new event today, "Show all in Calendar" opens List mode on today, a row its details.
  Today's year and, in the last days of December, the next one are read and merged by key.
- **Access on Today** (`UpNextContent.of`): without read access the card holds the §2.16 access
  card; "Not now" removes the whole card for 30 days; the not-asked and denied-once cards collapse
  to the one-line link "See your events here" (which expands them) once 3 launches have shown them
  without a decision (`accessCardLaunches` in the access DataStore, counted once per
  `CalendarEventsModel`, i.e. once per launch); blocked before any events action is the link too, and
  tapping it is the events action that brings "Calendar access is off" with "Open settings". Read
  only: the banner above the rows. "Show my events" off: no card at all.
- **Day sheet** (`feature/detail/DayEventsSection.kt`): the section "Events" between the stepping
  buttons and the comparison, as on the Apple sheet: every item of the day (the Now plate on today),
  "New event", "Open in Calendar" (Day mode on that day), "No events." once the year is read. Not
  shown while "Show my events" is off or without read access.
- **"+" without access** (`feature/events/NewEventPrompt.kt`): with no write access (or with access
  but no calendar that can be written), "+", "New event" and Ctrl+N show one dialog per window
  (`NewEventPromptHost` in `ThirteenApp`) with the card's text and action ("Show my calendars",
  "Allow access", "Open settings", "Allow changes", "Create a calendar on this device") and "Add in
  your calendar app", which starts `ACTION_INSERT` with the new event's title, times and all-day flag
  (the toast "No calendar app can add this event." when no app takes it). Without an app that can
  insert, "+" acts on the access state at once, as before.
- **Settings, group "Calendar"** (`feature/settings/CalendarSettings.kt`, after "Year grid"): "Show my
  events" first, with its footer; while it is on, "Calendar access" (Full access, Off, Read only,
  Not set up; a tap does the card's action and counts as an events action; with full access it opens
  Thirteen's page in the system settings), "Default calendar" (a dialog with the writable calendars
  by account; footer "New events go to {name}."; the choice falls back silently to the primary
  writable calendar when it is gone, `DefaultCalendar.resolve`) and "Show events in Year view".
  `UserSettings.defaultCalendar` is the seam for the editor's calendar of a new event.
- **Calendars list** (`feature/events/CalendarsSheet.kt`, in the pane and the sheet): accounts in the
  platform's order (iCloud, Google accounts, Exchange, CalDAV, "On this device" for every `LOCAL`
  account, Subscribed, Other; `CalendarGroups`), each collapsible by its header (a TalkBack
  expand or collapse action; collapsed it reads "{n} calendars, {m} shown"; `collapsedAccounts` in
  the settings file), "Show all" or "Hide all", a switch per calendar with "Read only", and the two
  footers. With write access and nothing writable, "Create a calendar on this device" asks first
  ("Create calendar", "Cancel"), then creates or reuses the `LOCAL` calendar "Thirteen" and adds it to
  a chosen set of visible calendars so it does not start hidden. The "nothing writable" access card
  asks the same way.
- **ExternalCalendarIntents** (`data/calendar`): `insert(draft)`, `viewEvent(id)` (for the details'
  "Open in calendar app"), `location(text)`; `canHandle` through the manifest's `<queries>`; `start`
  catches `ActivityNotFoundException`. Only plain values go out.
- **Tests:** `UpNextTest` (the web's cases and board B1 from the mockup data), `TodayUpNextTest`,
  `DayEventsSectionTest`, `CalendarSettingsTest`, `SettingsScreenTest` (Appearance under an
  always-dark theme), `CalendarsListTest`, `NewEventPromptTest`, `ExternalCalendarIntentsTest`
  (Robolectric's package manager with and without a calendar app), `EventsSettingsTest`. The shared
  harness is `testing/EventsShell.kt`.

### Calendar data (`data/calendar`)

The events data layer of docs/EVENTS.md §6.3 (tasks D2, D3 and D8). The views see `CalendarRepository`:
occurrences of a Gregorian year in the device's wall clock, one occurrence's details freshly read,
and writes that return `Saved`, `OccurrenceGone`, `DeletedElsewhere`, `Refused` or `Failed` (with
the `editor.saveFailed.*` reason). Keys are the provider's `{Events._ID}|{Instances.BEGIN}`
(self-expanded series: the holding row's `{_ID}|{original start}`, an exception row's own
`{_ID}|{DTSTART}`, the same keys `Instances` gives); callers treat them as opaque.

- **ProviderCalendarRepository.** Reads `Instances` through a hand-built URI (no `VISIBLE` filter)
  for local January 1 minus 14 hours to the next January 1 plus 14 hours, drops the losing copies
  of duplicate parts, and leaves to `SelfExpansion` (below) the series the provider cannot expand
  (their own `Instances` rows and their exception rows' rows are dropped and merged as overrides).
  On API 30 and lower a year outside 1902 to 2037 never reaches `Instances`. Every write
  re-reads the rows, re-resolves the occurrence (nothing is written when it is gone), merges with
  `mergeDraft`/`applyToSeries` and writes only the written groups' columns, in one `applyBatch`
  (a follow-up batch only re-points detached copies after a split or a move). Read-only events
  (§3.5) are refused; an invitation's alerts can still change.
- **Write plans.** `ProviderWritePlanner` turns an edit, delete, alert change, move or top-up into
  a list of `ProviderOp`s on plain `ColumnValues`, so the JVM tests check exactly what reaches the
  provider. `RecurrenceStorage` encodes repeats: Gregorian rules as `RRULE` (a DATE `UNTIL` of a
  timed series through `formatUntil`), 13-month rules as form (a) or (c) with the marker URI, form
  (b) kept for an Apple-made `BYYEARDAY` series unless the user picks a row in the repeat picker,
  every other 13-month rule as form (d): `RDATE` parts with the horizon, each part's marker
  carrying the series id and part number.
- **Gate constants** (`ProviderGates` in `RecurrenceStorage.kt`, one place each, docs/EVENTS.md §8.2
  owner v3.3): `TIMED_DATE_LIST_FORM = UTC` (V10 not run; the `TZID;` form waits for it),
  `PART_SIZE = 210` (V10's "smaller parts" fallback with the size phase 0 measured; core's default
  stays 400), `RDATE_EXCEPTION_ROWS = false` (V3 not run: "this event only" on an `RDATE` series
  uses the detached fallback), `BYYEARDAY_ALERTS_ONLY = true` (V2's Android leg not run:
  `OccurrenceDetails.byYearDayReadOnly`; the repository's form (b) write paths stay and are tested),
  `LEGACY_TIME_MAX_SDK = 30` (gate V12: the levels whose provider expands with 32-bit
  `android.text.format.Time`; the 2037 cap of `RDATE` lists and the `Events` reads below apply up
  to it, and raising it extends both to a newer level), `INVITEE_ALERTS_GOOGLE = false` (V20 not
  run: a Google invitation's alerts are not editable), `THIRTEEN_CALENDAR_ALERTS = true` (V18 not
  run: `ReminderReceiver` shows the alerts of the "Thirteen" device calendar). Switching the list
  form or the part size is that one line: every `RDATE` and `EXDATE` value is written through
  `RecurrenceStorage.listValue` and `formatList`, and every cut through `PART_SIZE`; the reader
  takes every form, and a list already stored keeps its own form when one value is added.
- **SelfExpansion** (task D8, docs/EVENTS.md §4.4 "Android 11 and older", §6.3). Plain JVM code over
  `EventRow`s: core's `expandSeries` with every exception row as an override (canceled ones remove
  their date, edited ones replace it, orphans show on their own; declined and canceled events are
  left out). What it expands:
  - on every level, `BYYEARDAY` series (the provider gives only the start's anniversary) and, for
    the years where the provider has given up, series more than 1,900 steps of their frequency
    past `DTSTART` (`beyondStepLimit`: calendarcommon2 stops after 2,000, so a daily series from
    2015 has no instances in 2026);
  - on API 30 and lower, rules whose `UNTIL` lies after 2037 (that provider gives only the first
    occurrence, IFC Leap Day to its 2096 cap included), in every year (`selfExpandsEveryYear`);
  - on every level, timed `RRULE` series whose wall-clock start time a clock change skips or
    repeats in the event's zone, from `DTSTART` to the end of the year read
    (`startsInAClockChange`, task D9): the provider drops the skipped day (API 30 and lower) or
    keeps the moved time for every later occurrence (API 37), and takes the later instant of a
    repeated time; core moves a skipped time forward by the gap for that day only and takes the
    first instant of a repeated one (docs/EVENTS.md §5.5);
  - on API 30 and lower, every event of a year outside 1902 to 2037 (`readsFromEvents`), read from
    `Events` (`deleted = 0`) with every exception row of the visible calendars. A recognized form (d)
    series in parts is expanded once per series id: part 1's rule and the marker's end, every part's
    `EXDATE` values and exception rows, so it goes on past the stored list (a two-part weekly series
    shows each 2040 date once); a part without part 1, and any other `RDATE` row, is expanded from
    its stored dates; losing copies of duplicate parts are dropped.
  Alarms and other calendar apps still see the provider's own expansion of these series.
- **What the provider taught us** (`ProviderRecurrenceTest` on the API 26, 30 and 37 images; logcat
  lines `PROBE`, recorded in docs/events-verification/android.md, gate V12):
  - An `RDATE`-only row's `DTSTART` is not an instance unless the list holds it, so each part's
    `RDATE` starts with the part's own start (`RecurrenceStorage.withStart`; a part of 210 later
    dates has 211 values) and readers drop a value naming the start.
  - `CONTENT_EXCEPTION_URI` refuses a series without an `RRULE` and takes no `DTEND`
    (`EXCEPTION_URI_COLUMNS`, `ColumnBuilders.forExceptionUri`); exception rows of an `RDATE` part
    (duplicate merges) go into `Events` with `ORIGINAL_ID`.
  - Exception rows hide the occurrence they replace only on a series with `_SYNC_ID`. A LOCAL
    calendar's series (Thirteen's own device calendar among them) take the detached fallback for
    "this event only" and `EXDATE` for deletes (`SeriesModel.synced`), and year reads drop an
    occurrence that an exception row without `ORIGINAL_SYNC_ID` replaces.
  - The provider updates `Instances` incrementally and loses occurrences on never-synced series.
    Every batch that writes a repeating row or an exception row ends with a throwaway repeating row
    inserted and deleted, after which the provider rebuilds `Instances` on the next query
    (`RESET_INSTANCES_AFTER_SERIES_WRITES`).
  - API 26 and 30 expand single events in every year, but no repeating rule outside 1902 to 2037,
    and after one `Instances` query outside that range they expand no `RRULE` row written later
    until the instance range is cleared. Inside the range they expand `RDATE` lists (values past
    2038-01-19 are dropped), `COUNT` rules running past 2038 and `EXDATE` values past 2038 correctly,
    but a rule whose `UNTIL` lies past 2038-01-19 gives only its first occurrence.
  - Every level stops a rule's expansion 2,000 steps of its frequency after `DTSTART`
    (`MAX_ALLOWED_ITERATIONS`): a daily series from 2015 or a weekly one from 1980 has no instances
    in October 2026, also on API 37.
  - Clock changes (`ProviderTimeZoneTest`, `PROBE zones` lines; task D9): a daily 02:30 New York
    series over 2026-03-08 has no instance that day on API 26 and 30 ("dropped") and on API 37 runs
    at 03:30 from that day on ("moved for good"); a 01:30 series over 2026-11-01 gets 01:30 EST, the
    later of the two, on every level ("later offset"). Other zone cases match the fixture, except
    where the image's tzdata is older (API 26 ships 2017b, which still has Brazil's daylight saving
    time starting in October 2018, not on November 4; API 30 ships 2020a, API 37 2025c; the fixture
    is 2025b).
- **CalendarObserver.** A `ContentObserver` on `CalendarContract.CONTENT_URI` (descendants),
  registered only while read access is granted, debounced 300 ms.
- **CalendarPermissions.** The access states of §2.16 (not asked, denied once, blocked with the
  link, blocked, read only, granted) from the two grants, the rationale and three flags in their
  own DataStore file `thirteen_calendar_access`, outside the backup rules, so a restored phone
  starts as "not asked". "Not now" hides the card for 30 days. `PermissionRequestTracker` tells a
  real dialog from the system's silent answer.
- **FakeCalendarRepository.** The mockup data set `fixtures/mockup/mockup-events.json`, added to
  the debug assets only (`sourceSets.debug.assets`), expanded with core's `expandSeries` in its
  device zone (Europe/Tallinn) with the file's own keys; span edits, deletes and a device calendar
  work in memory, and the permission state can be switched.
- **Tests.** JVM: `RecurrenceStorageTest`, `ProviderWritesTest` (the §6.3 byte-for-byte cases as
  plans), `ProviderMappingTest` (Robolectric, `MatrixCursor` inputs), `CalendarPermissionsTest`,
  `FakeCalendarRepositoryTest`, `SelfExpansionTest` (parts once per series id, 2040 past the 2037
  cap, every part's `EXDATE` and exception rows, duplicates, `BYYEARDAY`, `UNTIL` past 2037, the step
  limit, clock changes, orphans). Instrumented (`app/src/androidTest`, see Commands, run on API 26,
  30 and 37): `ProviderRecurrenceTest`, `ProviderRepositoryTest` (including a daily 03:30 Tallinn
  series over the 2026 spring-forward change, right on every level) and `ProviderTimeZoneTest`.
- **The V18 fallback** (`THIRTEEN_CALENDAR_ALERTS = true`, V18 not run): `ReminderReceiver` (the
  provider's `EVENT_REMINDER` broadcast; it reads due `CalendarAlerts` rows of the "Thirteen" device
  calendar and posts "Event alerts" notifications, never changing the rows), `POST_NOTIFICATIONS`
  asked when the first alert is set in that calendar (the editor then shows
  `alert.android.blocked` with "Open settings" while notifications are off), the Settings switch
  "Show alerts for the Thirteen calendar" and `calendars.createDevice.message.alerts`.
  `ReminderReceiverTest` covers the body, the day a tap opens and the permission checks; the
  provider's alert rows themselves are not driven by any test.

**Release notes for 1.0** (docs/EVENTS.md §7.4; the V18 fallback ships, so its sentence is in):
"Thirteen now asks for calendar access to show and edit your events. It still has no internet
permission. It asks to send notifications only to show alerts for its own Thirteen calendar."
