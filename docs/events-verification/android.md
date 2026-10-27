# Android verification gates

The Android team's record of the verification gates of [docs/EVENTS.md §8.2](../EVENTS.md#82-verification-gates)
(V2, V3, V4, V5, V9, V10, V12, V14, V18, V20 and V21; the index is [README.md](README.md)). Each run is
recorded under its gate as README.md "How to record a run" describes. Phase 0 proxies run from other
platforms are in [phase0.md](phase0.md).

## Status

The sync gates need a Google account and real devices and have not been run. V12's provider leg ran on
the API 26, 30 and 37 emulator images (D8, and again on the D9 build, below). The owner deferred V2's Android leg, V3 and V10 (v3.3), so their
fallbacks are in force in the Android code (`ProviderGates` in `android/app/.../data/calendar/RecurrenceStorage.kt`).
The other open gates need the owner's real devices or accounts; what each needs, and the fallback that ships if it
stays unrun (§8.3 item 2), is in "Gates that need the owner's devices or accounts" at the end.

| Gate | Status |
|---|---|
| V2 | not run (owner, v3.3), Android leg; fallback in force: Apple-made `BYYEARDAY` series are read-only except their alerts (`BYYEARDAY_ALERTS_ONLY`) |
| V3 | not run (owner, v3.3); fallback in force: "this event only" on `RDATE` series uses the detached fallback (`RDATE_EXCEPTION_ROWS = false`). The local provider refuses the exception path for `RDATE` series anyway (below) |
| V4 | not run (needs an Exchange or Microsoft 365 account on an Android device); if unrun: the gate stays as §8.2 says, and the §2.13 Outlook notes keep their current text |
| V5 | not run (needs two Google accounts on a device); if unrun: the fallbacks of §4.7 stay on. The provider leg passes on LOCAL test accounts (D8: a synced series with a canceled and an edited occurrence moved to another account keeps both as exception rows) |
| V9 | not run (needs two Android devices on one Google account); if unrun: the §4.4 behaviour without the marker, which the readers already have for rows whose marker is missing |
| V10 | not run (owner, v3.3), Android sync leg; fallback in force: timed date lists in the UTC form, parts of at most 210 values (`TIMED_DATE_LIST_FORM`, `PART_SIZE`). Phase 0's Google web results applied as v3.3 §4.4 and §8.2 read them ("Phase 0 and the `RDATE` constants" in the review fixes below) |
| V12 | pass on API 26, 30 and 37 images on 2026-10-20 (`ProviderRecurrenceTest`, D8 run below), with the API 30 rules in force on API 26 and 30 (`LEGACY_TIME_MAX_SDK = 30`) and extended to two failures §4.4 did not list: `UNTIL` past 2038 on API 26 and 30, and the provider's 2,000-step limit on every level (Thirteen self-expands both; alarms and other apps keep the provider's expansion). Run again on the D9 build on 2026-10-20 (all 38 instrumented tests green on API 26, 30 and 37), with a third case §4.4 did not list: wall times a clock change skips or repeats (Thirteen self-expands those series too). Run again on 2026-10-26 on `Thirteen_Phone` (API 37) only, on the code after the review pass: all 41 instrumented tests green (D2 and D3 for v3.3, below); API 26 and 30 not run again on that code. Run again on 2026-10-27 on `Thirteen_Phone` on the code after the review fixes: 41 tests, one failure that passed alone under host load, `ProviderRecurrenceTest` and `ProviderTimeZoneTest` green ("Suites and builds after the fixes" in the review fixes below). Run again later on 2026-10-27 on `Thirteen_Phone` after the cross-platform fixes: `OK (41 tests)` ("Cross-platform review fixes" below) |
| V14 | not run (needs a Google account); fallback in force: "On the day at 09:00" stays hidden on Android (`AlertPickerPage`) |
| V18 | not run (needs a Pixel with only Google Calendar and a Samsung with Samsung Calendar); fallback in force since the review pass of 2026-10-20 (`THIRTEEN_CALENDAR_ALERTS = true`: `ReminderReceiver`, `POST_NOTIFICATIONS`, the Settings switch and `calendars.createDevice.message.alerts`). `ReminderReceiverTest` (JVM, review fixes of 2026-10-27) covers its body text, the day a tap opens and its permission checks; no test drives the provider's `CalendarAlerts` rows |
| V20 | not run (needs a Google invitation); fallback in force since the review pass of 2026-10-20: `alarmsEditable = false` for Google invitations (`INVITEE_ALERTS_GOOGLE = false` in `ProviderMapping.alarmsEditable`; `ReviewFindingsDataTest.aGoogleInvitationsAlertsAreNotEditableWhileGateV20IsUnrun`) |
| V21 | not run (needs Google Calendar and Samsung Calendar on devices); fallback in force: "Open in calendar app" is shown only when an app resolves `ACTION_VIEW` of `Events/{id}` (`ExternalCalendarIntents.canHandle`) |

## Prerequisite: the `:core` events engine (task D1)

Not a gate: the Kotlin port of `packages/core/src/events` that every Android gate runs through, checked
against the shared fixtures before any provider work.

- **When:** 2026-10-20 00:24 EEST (Europe/Tallinn), by the D1 agent.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work; `android/core/src/main/kotlin/com/haugas/thirteen/core/events/`.
- **Toolchain:** OpenJDK 21.0.12.1 (Homebrew; tzdb 2026b), Gradle 9.8.1, Kotlin 2.4.21, JUnit 4.13.2.
- **Fixtures:** `fixtures/events.json` version 1, `complete: true`, tzVersion 2025b, 36 sections, 1236 cases.
- **Command:** `cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home THIRTEEN_PERF_SCALE=3 ./gradlew :core:test --rerun`
- **Result:** `BUILD SUCCESSFUL`, 80 tests, 0 failures, 0 skipped:
  - `EventsFixtureParityTest` (38 tests): every section replayed, every `counts` entry asserted
    (`Events fixture parity: 36 sections, 1236 cases, 5541 checks`). `zones` through java.time
    (`JavaTimeZoneResolver`, JVM tzdata 2026b agrees with the 2025b cases); `untils`, `series` and
    `alarmInstants` through `RecordedZoneResolver` over `zoneOffsets`. Two fixture values have no Kotlin
    form and are checked as rejected by type: `wallClock` minutes `1.5` and a draft count of `2.5`.
  - `EventsExhaustiveTest` (3 tests): `830 rules x 9999 years, 29141934 dates`; `7304118 days on their own
    rules`; `encodings of 830 rules over 5 spans, 113662 occurrences`.
  - `EventsModelTest` (7 tests): moveDraftStart, setDraftAllDay, changedFields, describeAlarm,
    RepeatPreset.match and alert range edges.
  - The existing engine suites (`FixtureParityTest`, `ExhaustiveRangeTest`, `EdgeDaysTest`) still pass.

Run again for spec v3.3:

- **When:** 2026-10-26, about 20:56 EET (Europe/Tallinn), by the D1 agent.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work. No engine change was needed: the port
  already does what v3.3 writes down about the finished engine (§9.10: leap-only repeats stopping at their
  cap on every path, `SeriesInput.duration`, `ExpandedOccurrence.startUtc`, `setDraftAllDay`'s `timeZone`,
  both `describeAlarm` forms, DST-gap overrides and exclusions, floating lengths through the device zone,
  the layout readings, `outOfRange`).
- **Toolchain, fixtures and command:** as above (OpenJDK 21.0.12.1 with tzdb 2026b, Gradle 9.8.1, Kotlin
  2.4.21; `fixtures/events.json` unchanged since 2026-10-19: version 1, 36 sections, 1236 cases).
- **Result:** `BUILD SUCCESSFUL`, 80 tests, 0 failures, 0 skipped, with the same counts as above
  (`Events fixture parity: 36 sections, 1236 cases, 5541 checks`).
- **Differential check against the TypeScript engine** (not part of `:core:test`, which must not need Node):
  a throwaway generator drew random inputs for every section of `fixtures/events.json` and computed the
  expected values with `packages/core`, written in the events.json shape with their own `zoneOffsets`,
  and the unchanged `EventsFixtureParityTest` replayed them. Inputs: Gregorian, 13-month, date-list and
  foreign repeats with every kind of end and with extra and excluded dates; series in 14 IANA zones with
  overrides (canceled, orphaned, taken twice), `DURATION` days, DST days and the range edges; leap-only
  repeats with ends around their caps; mutated RRULE, date-list, marker and URI text (Arabic-Indic and
  fullwidth digits, other cases, reordered or repeated keys); layouts with titles and keys that sort
  differently by code points and by UTF-16 units. A second, temporary test (removed after the runs)
  replayed what the case shapes do not reach: `moveDraftStart`, `setDraftAllDay` with every option,
  `changedFields`, both `describeAlarm` forms, `RepeatPreset.match`, `nextOccurrences`, `toRRule`, strict
  marker, rule URI and detached URI parsing, `expandSeries` with a `limit` (and its `truncated` and
  `unsupported`), Week layouts with `minDurationMinutes`, `compareTo`, `minutesSince` and `rule.includes`.
  687,908 cases in 51 files and 282,240 cases in 41 files gave no difference. The only failures were the
  `zoneOffsets` test's checks of the real file's table (a random table lacks `America/New_York 9999` or
  holds `Europe/Tallinn 2061`). An expectation corrupted on purpose in three sections failed as it should.
- **Found in the TypeScript engine, not a port difference:** `RRuleCandidates.fill`
  (`packages/core/src/events/rrule-expansion.ts`) has no case for `HOURLY`, `MINUTELY` and `SECONDLY`, so
  `endRecurrenceBefore` and `splitRecurrence` of such a rule with a count end, and `retimeExceptions` of
  one with any end, throw `TypeError: Cannot read properties of undefined (reading 'length')` instead of
  a `RangeError` (`expandRecurrence` is right: the start only, `unsupported`). The Kotlin port throws
  `ThirteenException.InvalidRule` ("Cannot expand a HOURLY rule (§4.6 step 6)") at the same calls, and
  every app call site catches `ThirteenException`. No fixture covers it; left for the core team.

## V12: provider expansion, API 37 image (tasks D2 and D3)

- **When:** 2026-10-20, about 01:50 EEST (Europe/Tallinn), by the D2/D3 agent.
- **Image:** emulator AVD `Thirteen_Phone`, `system-images;android-37.0;google_apis;arm64-v8a` revision 6,
  Android 17 (API 37), build `CE2A.260420.019`, security patch 2026-05-05, Calendar Provider version 17
  (versionCode 37). Started read-only (`-read-only -no-snapshot`) on port 5584, shut down after the run.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work; `android/app/src/androidTest/kotlin/com/haugas/thirteen/data/calendar/`.
- **Accounts:** LOCAL test calendars only (accounts `ThirteenProviderTest` and `ThirteenProviderTest2`),
  created by the tests and deleted after each test; no Google account.
- **Command:** `adb -s emulator-5584 shell am instrument -w -r -e package com.haugas.thirteen.data.calendar com.haugas.thirteen.test/androidx.test.runner.AndroidJUnitRunner`
  (android/README.md "Commands").
- **Result:** `OK (24 tests)`: `ProviderRecurrenceTest` (11) and `ProviderRepositoryTest` (13). For V12
  this is a **pass on API 37**: dates of 1890, 1900, 1901, 2038, 2040 and 2400, `Instances` windows for
  1890 to 1901, 2038 to 2040 and 2400, an `RDATE` list crossing 2038 and `FREQ=YEARLY;INTERVAL=4`
  through 2400 all expanded on the right instants. The API 26 and 30 legs (the API 30 rules of §4.4)
  are not run, so V12 stays partial.

What the provider did (logcat `PROBE` lines), and what the spec did not expect:

| Case | API 37 result |
|---|---|
| `RDATE` list without the start's own value | `DTSTART` is **not** an instance: `RecurrenceProcessor` adds the start only through an `RRULE`. §4.4 form (d) ("`DTSTART` plus `RDATE` with every later occurrence") would lose the first date of every part. Android now writes each part's start as its first `RDATE` value (a full part has 211 values: its start and 210 later dates); readers drop a value naming the start |
| `RDATE` with the start, UTC form | 2026-10-19 19:00, 2026-11-16 19:00, 2026-12-14 19:00 (Tallinn), right across the DST change |
| `RDATE` in the `TZID;` form (`Europe/Tallinn;20261019T190000,...`) | the same instants as the UTC form (local provider only; V10 is about Google's sync adapter) |
| all-day `RDATE` (`20261019,20261116,20261214`) | right days, one day each |
| `RRULE` + `RDATE` + `EXDATE` | the union minus the excluded date, an own-time `RDATE` at its own time |
| `FREQ=YEARLY;INTERVAL=4;UNTIL=...` (IFC Leap Day) | 2028, 2032, 2036; and 2392, 2396, 2400 |
| `FREQ=YEARLY;BYYEARDAY=12,40,...,-18` | only the start's anniversary (2026-01-12), as §4.4 says; core gives 13 dates in 2026. Thirteen self-expands it |
| exception through `CONTENT_EXCEPTION_URI` on an `RDATE` series | **refused** (the provider requires an `RRULE` on the series); the detached fallback is needed on this provider whatever V3 shows |
| exception through `CONTENT_EXCEPTION_URI` with `DTEND` or `ORIGINAL_ALL_DAY` | refused ("Exceptions can't overwrite dtend"); the provider takes `DURATION` and sets `DTEND` and `ORIGINAL_ALL_DAY` itself |
| exception row on a series without `_SYNC_ID` (any LOCAL calendar) | after the insert, `Instances` holds only the exception (the series' other instances vanish); after a rebuild the replaced occurrence shows **next to** the exception. The provider ties exceptions to series only through `_SYNC_ID`/`ORIGINAL_SYNC_ID` |
| exception row on a series with `_SYNC_ID` (as a sync adapter writes) | after a rebuild the exception replaces its occurrence |
| exception row on a `BYYEARDAY` series | inserted; its own instance is there (Thirteen merges it as an override) |

What changed in the Android code because of these results (docs/EVENTS.md §4.4 and §4.7 need the same
changes; the spec agent owns that file): each `RDATE`-only row lists its own start; exception inserts send
only the allowed columns; "this event only" and its delete use the detached fallback and `EXDATE` on series
without `_SYNC_ID`; year reads drop occurrences that an unsynced exception row replaces; and every batch
that writes a repeating row or an exception row ends by inserting and deleting a throwaway repeating row,
after which the provider rebuilds `Instances` on the next query.

`ProviderRepositoryTest` ran the §6.3 cases through `ProviderCalendarRepository` on the same image: insert
and read back (single, all-day across Year Day, form (d) with marker, horizon 2036), "this event only" on
a synced `RRULE` series (exception row, its delete cancels it) and on a LOCAL `RRULE` series (detached
fallback), the detached fallback on an `RDATE` series and "delete all future events" removing a later
detached copy, a retime of an `RDATE` series rewriting every `RDATE`, `EXDATE` and `ORIGINAL_INSTANCE_TIME`,
a "future events" split of a `COUNT=10` series at its 4th occurrence (`COUNT=3` head, `COUNT=7` tail, a
canceled and an edited occurrence carried), an Apple-made `BYYEARDAY` series (self-expanded with an edited
and a canceled occurrence each shown once; a title edit keeps `RRULE` and `EXDATE` byte for byte), a drag of
its first occurrence (new `BYYEARDAY` list, no `RDATE`) and an end date (`UNTIL` added), a move to another
account keeping its changed occurrences and a refused move of an event with an invitee, a weekly series
from 2020 written as parts of 210, 210 and 97 later dates and topped up in 2032 (part 3 filled, part 4
added, a duplicate copy of part 3 merged with its `EXDATE` and its edited occurrence, then deleted),
reminders, invitations (alerts only), re-resolution (`DeletedElsewhere`, `OccurrenceGone`) and the device
calendar (created once, reused, deleted by the test that created it).

Run again for spec v3.3 (D2 and D3):

- **When:** 2026-10-26, 20:58 to 22:20 EET (Europe/Tallinn), by the D2/D3 agent.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work. That includes a review pass of
  2026-10-20, 06:48 to 07:50, that no section here records: it changed about 40 `:app` files after D9's
  last runs (in the data layer `FakeCalendarRepository`, `ProviderMapping`, `RecurrenceStorage`,
  `ProviderWrites`, `ProviderCalendarRepository`, `PendingChanges` and the new `ReminderReceiver`; in the
  UI `EventText`, `EventChip`, `MonthMode`, `MonthDayList`, `ListMode`, `CalendarsSheet`, `DayMode`), added
  `ReviewFindingsDataTest` and `ReviewFindingsDataProviderTest`, and was not followed by a full run.
- **Checked against v3.3 and the engine** (no D2 or D3 production code needed a change): the manifest's
  `<queries>` and header comment; the §2.16 states and DataStore flags; the mockup data set from the
  debug assets (`fixtures/mockup` unchanged since 2026-10-19); the gate decisions as single constants in
  `ProviderGates`: `TIMED_DATE_LIST_FORM = UTC`, `PART_SIZE = 210` (v3.3 §4.4 after phase 0; v3.3 as first
  written kept 400, core's default and the fixtures stay 400), `RDATE_EXCEPTION_ROWS = false`,
  `BYYEARDAY_ALERTS_ONLY = true`, `LEGACY_TIME_MAX_SDK = 30`, `INVITEE_ALERTS_GOOGLE = false`,
  `THIRTEEN_CALENDAR_ALERTS = true`. Every `RDATE` and `EXDATE` value the app writes goes through
  `RecurrenceStorage.listValue` and `formatList` (no other `DateList.format` call or UTC or zoned value is
  built in `:app`), and both cuts into parts (`encode`, top-up) use `PART_SIZE`, so V10's result changes
  one line each.
- **Image:** `Thirteen_Phone`, Android 17 (API 37), `CE2A.260420.019`, security patch 2026-05-05, tzdata
  2025c, Calendar Provider versionCode 37, zone Europe/Tallinn, 24-hour time; started
  `-read-only -no-snapshot -no-window` on port 5614 (twice), shut down after each run. LOCAL test
  calendars only, created and deleted by the tests.
- **Commands and results** (from `android/`, `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`):
  - First, on the code as found: `THIRTEEN_PERF_SCALE=3 ./gradlew :core:test :app:testDebugUnitTest`:
    `392 tests completed, 9 failed` (below). `adb -s emulator-5614 shell am instrument -w -r -e package
    com.haugas.thirteen.data.calendar ...`: `OK (36 tests)` (`ProviderRecurrenceTest` 13,
    `ProviderRepositoryTest` 18, `ProviderTimeZoneTest` 2, `ReviewFindingsDataProviderTest` 3). The whole
    suite: the 36 green and `CalendarAccessibilityTest` 5 failed only because the system dialog "Pixel
    Launcher isn't responding" covered the screen (the machine's load average was over 600); after
    "Wait", `-e class com.haugas.thirteen.CalendarAccessibilityTest`: `OK (5 tests)`.
  - Final, on the code below: `THIRTEEN_PERF_SCALE=3 ./gradlew :core:test --rerun :app:testDebugUnitTest --continue`:
    `BUILD SUCCESSFUL`; `:core` 80 tests in 6 classes, 0 failures (`Events fixture parity: 36 sections,
    1236 cases, 5541 checks`); `:app` 392 tests in 59 classes, 0 failures, 0 skipped. `./gradlew
    :app:assembleDebug :app:assembleDebugAndroidTest`, both APKs installed, `adb -s emulator-5614 shell am
    instrument -w -r com.haugas.thirteen.test/androidx.test.runner.AndroidJUnitRunner`: `OK (41 tests)`
    in 37.5 s. `PROBE` lines as in the runs above (`rdate-exception-uri: refused`, `rdate-utc-with-start`
    and `rdate-tzid` on the same instants, `byyearday provider-matches-core=false`, `zones provider: 14
    cases, 0 differ`, `zones device: 29 cases, 0 differ`).
- **Found and fixed:** the 9 JVM failures came from the review pass. In 8 the code follows the spec and
  the tests were left behind; one was a bug.
  - An all-day row of several days is named by `calendar.row.a11y` with `{time}` "All day" and
    `calendar.flag.dayOf` ("All day, Autumn school break, Family, day 1 of 7", as `packages/ui`
    `AgendaList.tsx` and Apple's `UpNextAgenda.swift` name it); `TodayUpNextTest`, `DayEventsSectionTest` and
    two `ListModeTest` cases still expected "Day 1 of 7, Autumn school break, Family".
  - Month's day lists are named by `calendar.item.a11y` (§2.20 "Month chip ... and day list row"):
    "Dentist, Dr. Tamm, 15:40 to 16:20, Home". `MonthModeTest` (renamed `theSelectedDaysListUsesTheItemLabels`)
    and `MonthModeMoreTest` updated; `MonthModeMediumTest` now finds exactly one element with the item's
    name, the day list row (the cells' title chips have no semantics at compact and medium width).
  - The device calendar dialog says `calendars.createDevice.message.alerts` while the V18 fallback ships
    (`CalendarsListTest`).
  - **List mode's pull at the top** (`ListMode.kt`, a bug): the anchor kept in place while earlier days
    are added was the first visible entry, the sticky month header, under which the earlier days of the
    same month are added, so the day on screen jumped down by them (from November 16 the view went to
    November 3 after a 267 px pull). It is now the first visible day header or row (`isDayEntryKey`). The
    review pass's test could not see this: its `swipeDown()` started on the list's top edge, under the top
    app bar, which takes that drag, so nothing was added and "stays in place" held trivially (404 entries
    before and after). `aPullAtTheTopAddsEarlierDaysAboveAndKeepsTheRowInPlace` now pulls slowly from inside
    the list, asserts the day moved by no more than the drag (127 to 380 px for a 267 px drag) and finds
    2026-10-19's Dentist, before the list's first day until the pull.
- **Not covered by this run:** API 26 and 30 were not run again on the code after the review pass (their
  last runs are D9's, below); `ReminderReceiver` (V18 fallback) has no JVM or instrumented test.

## V12: provider expansion on API 26, 30 and 37 (task D8)

- **When:** 2026-10-20, 03:20 to 04:23 EEST (Europe/Tallinn), by the D8 agent. The last full runs of the
  final code: API 37 at 04:21, API 30 at 04:22, API 26 at 04:23.
- **Images** (AVDs created for V12, Pixel 5 profile, started headless with `-no-snapshot` on port 5592,
  one at a time, each shut down after its run; device zone Europe/Tallinn, the host's):

  | AVD | System image | Build | Security patch | Calendar Provider |
  |---|---|---|---|---|
  | `Thirteen_API26` | `system-images;android-26;google_apis;arm64-v8a` (download `arm64-v8a-26_r03`) | Android 8.0.0, `OSR1.180418.028.A3` | 2018-04-05 | versionCode 26 |
  | `Thirteen_API30` | `system-images;android-30;google_apis;arm64-v8a` revision 16 | Android 11, `RSR1.240422.006` | 2021-08-05 | versionCode 30 |
  | `Thirteen_API37` | `system-images;android-37.0;google_apis;arm64-v8a` revision 6 | Android 17, `CE2A.260420.019` | 2026-05-05 | versionCode 37 |

- **Code:** the working tree on HEAD `7753452` plus uncommitted work; `android/app/src/androidTest/kotlin/com/haugas/thirteen/data/calendar/`
  and `data/calendar/SelfExpansion.kt`. Emulator 37.2.12.
- **Accounts:** LOCAL test calendars only (accounts `ThirteenProviderTest` and `ThirteenProviderTest2`),
  created and deleted by the tests; no Google account.
- **Command** (each level): `adb -s emulator-5592 shell am instrument -w -r -e package com.haugas.thirteen.data.calendar com.haugas.thirteen.test/androidx.test.runner.AndroidJUnitRunner`
- **Result:** `OK (30 tests)` on API 26, on API 30 and on API 37: `ProviderRecurrenceTest` (13) and
  `ProviderRepositoryTest` (17). JVM: `./gradlew :app:testDebugUnitTest --tests 'com.haugas.thirteen.data.calendar.*'`,
  `BUILD SUCCESSFUL`, 83 tests in 8 classes, 0 failures (`SelfExpansionTest` 10).
- **Verdict:** pass. API 37 expands every case of the gate in every year. API 26 and 30 fail outside
  1902 to 2037, as §4.4 expects, so the API 30 rules apply to them; they also fail in two ways §4.4
  did not list (below), to which Thirteen now applies self-expansion. No newer level failed, so the
  rules are not extended past API 30.

What each level did (logcat `PROBE` lines; "=" means the same as the API 37 column):

| Case | API 37 | API 30 | API 26 |
|---|---|---|---|
| single events of 1890, 1900, 1901-12-13, 2038-01-19, 2040 and 2400-02-29 through `Instances` windows 1890 to 1901, 2038 to 2040 and 2400 | right instants | = | = |
| yearly `RRULE` from 1890 in the window 1890 to 1901; weekly `RRULE` from 2038 in 2038 to 2040 | 12 and 157 | 0 and 0 | 0 and 0 |
| a weekly `RRULE` inserted after those windows, queried in autumn 2026 | 11 of 11 | 0 of 11 ("poisoned") until the instance range is cleared, then 11 | = API 30 |
| `RDATE` list 2037-11-16, 2037-12-14, 2038-01-11, 2040-02-13: window November and December 2037 | the two 2037 dates | = | = |
| the same list, window 2037-11 to 2040-03 | all four | first three (the value past 2038-01-19 dropped) | = API 30 |
| `FREQ=YEARLY;INTERVAL=4;UNTIL=20360617` (IFC Leap Day, early end) | 2028, 2032, 2036 | = | = |
| `FREQ=YEARLY;INTERVAL=4;UNTIL=20960617` (form (c) as Thirteen writes it from 2028), window 2027 to 2036 | 2028, 2032, 2036 | 2028 only | 2028 only |
| the same, windows 2088 to 2100 and (from 2392) 2390 to 2400 | 2088, 2092, 2096; 2392, 2396, 2400 | nothing (outside the range) | = API 30 |
| monthly from 2036-01-07 with `UNTIL` 2037-12-31, 2038-01-18, 2038-01-20 and 9999-12-31: instances in 2036 | 12, 12, 12, 12 | 12, 12, 1, 1 | 12, 12, 1, 1 |
| `COUNT=999` weekly from 2036 (ends 2055): January 2036 and December 2037 | 4 and 4 | = | = |
| open-ended yearly all-day, `EXDATE` values in 2036 and 2040 | right | = | = |
| `LAST_DATE` of the `COUNT=999`, `UNTIL=9999` and Leap Day cap rows | 2055, 9999, 2096 | null | null |
| daily from 2015, daily from 2022, weekly from 1980, weekly from 2000, monthly from 1950: instances in October 2026 | 0, 31, 0, 4, 1 | 0, 31, 0, 4, 1 | 0, 31, 0, 4, 1 |
| `RDATE`-only row with and without its start's value; `TZID;` list; all-day list; `RRULE` + `RDATE` - `EXDATE` | as the API 37 run of D3 | = | = |
| `FREQ=YEARLY;BYYEARDAY=...` | only 2026-01-12 | = | = |
| `CONTENT_EXCEPTION_URI` on an `RDATE` series | refused | = | = |
| exception rows on never-synced and synced series, incremental and rebuilt | as the API 37 run of D3 | = | = |

What the findings mean and what changed in the Android code (docs/EVENTS.md §4.4, §6.3 and §8.2 need
the same; the spec agent owns that file):

1. **The API 30 rules hold for API 26 and 30** (`ProviderGates.LEGACY_TIME_MAX_SDK = 30`): `RDATE` lists
   stop at 2037-12-31 (`StorageEnv.legacyTime`), and a year outside 1902 to 2037 is read from `Events`
   and expanded by Thirteen (`SelfExpansion.readsFromEvents`), a form (d) series once per series id.
   Thirteen never sends such a year to `Instances` there: one query outside the range left both
   providers unable to expand any `RRULE` row written afterwards.
2. **`UNTIL` past 2038 (API 26 and 30, not in §4.4):** such a rule gives only its first occurrence
   inside the range too. This includes IFC Leap Day and the Festival of Holy Women in form (c), whose
   cap (2096 for a start in 2028) Thirteen itself writes. Thirteen now self-expands, in every year,
   any row whose `RRULE` or `EXRULE` has an `UNTIL` after 2037-12-31 on those levels
   (`SelfExpansion.selfExpandsEveryYear`), as it does `BYYEARDAY` series. Alarms and other calendar
   apps on those devices still get only the first occurrence; §4.4 has no write-side answer for this
   (an open question for the spec, see the report).
3. **The provider's step limit (every level, not in §4.4):** calendarcommon2's `RecurrenceProcessor`
   stops 2,000 steps of a rule's frequency after `DTSTART` (`MAX_ALLOWED_ITERATIONS`), so a daily
   series older than about 5.5 years, or a weekly one older than about 38 years, has no instances.
   Thirteen now self-expands a series for any year it reaches more than 1,900 steps after its start
   (`SelfExpansion.beyondStepLimit`). Alarms and other apps keep the provider's (empty) expansion.
   Thirteen's own 13-month repeats are not affected: form (d) lists are not iterated, and forms (a)
   and (c) step yearly.

`ProviderRepositoryTest` added these cases through `ProviderCalendarRepository`, passing on all three
levels: a two-part weekly series written as Thirteen on API 30 writes it in 2034 (parts of 211 and 49
values, the last one 2037-12-27) shows each IFC Wednesday of 2040 once with the API 30 rules, keeps 2037
from `Instances`, and a deleted 2040 occurrence (a 2040 `EXDATE` value in part 2) leaves the provider's
2037 expansion of that part intact; an event and a yearly series from 1890 read from `Events`; IFC Leap
Day saved by Thirteen (`FREQ=YEARLY;INTERVAL=4;UNTIL=20960617`) and a monthly rule to 2040 show every
occurrence on every level; a synced daily series from 2015 and a weekly one from 1980 show all of 2026,
with a "this event only" edit in place; a synced series with a canceled and an edited occurrence moved
to another account keeps both as exception rows under the copy.

## Calendar UI: navigation and modes (task D4)

Not a gate: the Calendar section's navigation, top app bar, Year, Month and List modes and the Calendars
pane, checked on the JVM against the mockup data set and on the two AVDs.

- **When:** 2026-10-20 03:12 EEST (Europe/Tallinn), by the D4 agent.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work; `android/app/src/main/kotlin/com/haugas/thirteen/feature/calendar/`,
  `navigation/`, `data/CalendarEventsModel.kt`.
- **Toolchain:** OpenJDK 21.0.12.1 (Homebrew), Gradle 9.8.1, AGP 9.4.1, Kotlin 2.4.21, Compose BOM 2026.09.00,
  Robolectric 4.17 (SDK 36).
- **Data:** `fixtures/mockup/mockup-events.json` (debug assets), `now` 2026-10-19 09:41, device zone Europe/Tallinn;
  24-hour time.
- **Commands** (from `android/`, `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`):
  - `./gradlew :app:testDebugUnitTest`: `BUILD SUCCESSFUL`, 211 tests in 34 classes, 0 failures, 0 skipped.
    The Calendar's share: `feature/calendar` (43 tests: `MonthModeTest` and its medium, expanded, short
    expanded and font scale 1.5 variants, `YearModeTest`, `ListModeTest`, `CalendarPeriodsTest`,
    `CalendarsPaneTest`, `CalendarsSheetTest`), `navigation/CustomEventLinkTest` (5), and the updated
    `ThirteenAppStateTest` (23), `KeyboardShortcutsTest` (10), `DeepLinkTest` (6), `ThirteenAppTest`.
  - `THIRTEEN_PERF_SCALE=3 ./gradlew :core:test --rerun`: `BUILD SUCCESSFUL`, 80 tests, 0 failures
    (`Events fixture parity: 36 sections, 1236 cases, 5541 checks`); `:core` is unchanged by D4.
  - `./gradlew :app:lintDebug :app:lintRelease`: 0 errors, 1 warning each (the known `VectorPath` on the
    launcher background).
- **§2.20 labels asserted word for word:** "Sunday. Gregorian Thursday"; "Thursday, October 12, 2026.
  Gregorian Monday, October 19, 2026. 5 events." (state Today, selected, five "Open {title}" custom actions);
  "Wednesday, October 25, 2026. Gregorian Sunday, November 1, 2026. Gregorian November begins.";
  "Sprint planning, 09:30 to 10:30, Work, repeats"; "Autumn school break, all day, from Gregorian Monday,
  October 19 to Sunday, October 25, Family"; "15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18";
  "3 more events on Thursday, October 12, 2026" (1280 x 520 dp); "No events, October 21 to October 23"
  (font scale 1.5); "3 events" (Year cell value). One example differs from the data set: the Year Day band
  reads "Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026. 2 events." because New Year's Eve
  dinner and the Winter break are both on that day; §2.20's example says "1 event.".
- **Emulators:** `Thirteen_Phone` (1080 x 2424, 420 dpi) and `Thirteen_Tablet` (2560 x 1600, 320 dpi), API 37,
  started headless on port 5584 one at a time and shut down after; the debug APK launched with
  `--es thirteen.qa.today 2026-10-19 --ez thirteen.qa.fakeEvents true`. Screenshots in
  `/tmp/thirteen-shots/android/`: `phone-month.png` (dots density, selected day's list, "Now" on Sprint
  planning), `phone-list.png`, `phone-year.png`, `phone-month-a11y-list.png` (font scale 1.5, opened on
  today), `tablet-month.png` (full lanes, the school break continuing across rows), `tablet-list.png`,
  `tablet-year.png` (the grid with the comparison placeholder), `tablet-month-calendars-pane.png` (the
  360 dp Calendars pane beside the grid). No real calendars, accounts or permissions were used.

Run again for spec v3.3 (D4):

- **When:** 2026-10-26, 22:22 to 23:13 EET (Europe/Tallinn), by the D4 agent.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work (including the D1 to D3 runs of the same
  evening and the review pass of 2026-10-20 recorded under D2 and D3 above).
- **Checked against v3.3 and the engine:** the one D4 change of §9.10, the owner's on-demand Calendars pane
  at expanded width (§2.1, §2.15, §6.3), was already built: `Route.Calendars` is on the stack only after
  the overflow menu's "Calendars" or "Show calendars", Close or Back pops it, and nothing reopens it. New
  test `CalendarsPaneTest.thePaneIsHiddenUntilOpenedAndDoesNotReopenByItself` (hidden at launch; after Close,
  mode changes, paging, Today and a section switch it stays closed). Every Android string resource was
  compared with the §2.19 catalogue by a throwaway script (ids with dots as underscores, placeholders
  normalized): every D4 string is verbatim. The other differences are plural `one` forms written `%1$d`,
  `access.openSettings` "Open settings" (the catalogue's Android form), and D6's `editor.dateButton`,
  which is assembled from two parts. No resource holds an en or em dash. The layout readings, leap caps,
  `startUtc` and `duration` are `:core`'s (D1).
- **Found and fixed:**
  - **Year jumped back to the Month's year** (`ThirteenAppState`, a bug): every pop on the Calendar stack set
    Year's year to the modes' day, so with Year paged to 2030, Back from a day's comparison (full screen on
    phones), its Close button or the Calendars list's Close showed 2026 again. Only a pop of a mode
    (`Route.Calendar`) now sets the year. Back from a mode to Year also scrolls Year to that day's month
    (§2.1, Apple Calendar's drill-down; before, the first Back from the default Month showed January).
    The segmented buttons still show Year from its top, as the Apple app does.
    `ThirteenAppStateTest.backToYearShowsTheMonthAndClosingAnOverlayKeepsThePagedYear` fails on the old code
    ("Back from a day's comparison expected:<2030> but was:<2026>").
  - **`HANDLE_CUSTOM_EVENT` from a hostile app** (`MainActivity`): through API 32, reading
    `EXTRA_CUSTOM_APP_URI` unparcels the whole extras bundle, and a value of a class Thirteen lacks throws
    `BadParcelableException`, which crashed the app. The read now catches it and opens the Calendar.
  - **Seams:** the comment at the top of `CalendarScreen.kt` still described interim bodies D5 to D7 had
    long replaced. It now lists, for D4 and the four tasks that follow (Week and Day with drag and drop;
    details and the editor; Up next, the day sheet, Settings rows and the Calendars list; the data
    layer's top-up, parts and provider gates), the files each owns, its tests and the shared files.
- **Open, for the data layer:** nothing calls `CalendarRepository.topUpHorizons()`; §6.3 runs it on `ON_START`
  of the process lifecycle when write access is granted. Listed in the seams comment; not changed by D4.
- **Commands and results** (from `android/`, `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`):
  - `THIRTEEN_PERF_SCALE=3 ./gradlew :core:test --rerun :app:testDebugUnitTest --rerun --continue`:
    `BUILD SUCCESSFUL`; `:core` 80 tests in 6 classes, 0 failures (`Events fixture parity: 36 sections,
    1236 cases, 5541 checks`); `:app` 394 tests in 59 classes, 0 failures, 0 skipped.
  - `./gradlew :app:lintDebug`: 0 errors, 5 warnings, all in `ReminderReceiver.kt` (2 `ObsoleteSdkInt`,
    3 `UseKtx`; the V18 fallback of the review pass), none in D4's files.
  - `./gradlew :app:assembleDebug :app:assembleDebugAndroidTest`, both APKs installed, then
    `adb shell am instrument -w -r com.haugas.thirteen.test/androidx.test.runner.AndroidJUnitRunner`:
    `OK (41 tests)` on `Thirteen_Phone` (145.6 s; on the build before the last revert, which only removed
    a Year scroll on the segmented buttons) and `OK (41 tests)` on `Thirteen_Tablet` (68.7 s, final build).
    `-e class com.haugas.thirteen.CalendarAccessibilityTest`: `OK (5 tests)` on the tablet on both builds.
- **Emulators:** `Thirteen_Phone` and `Thirteen_Tablet` (API 37, `CE2A.260420.019`, Europe/Tallinn, 24-hour
  time), one at a time, `-read-only -no-snapshot -no-window` on port 5630, each shut down after its run.
  The host's load average was 400 to 960: the tablet showed "Pixel Launcher", "System UI" and "Process
  system isn't responding" dialogs until `hide_error_dialogs` was set on that emulator (not persisted). Under
  that load Year's animated scroll to October took about 6 s. The debug APK was launched with
  `--es thirteen.qa.today 2026-10-19 --ez thirteen.qa.fakeEvents true`.
- **Screenshots** in `/tmp/thirteen-shots/android/`: `phone-month.png` (dots, the selected day's list, "Now" on
  Sprint planning), `phone-list.png`, `phone-year.png` (after Back from Month: October in view),
  `phone-month-a11y-list.png` and `phone-month-a11y-emptyrun.png` (font scale 1.5: three lines and "+2 more"
  on today; "No events, October 21 to October 23"), `tablet-month.png`, `tablet-year.png` (from its top, the
  comparison placeholder beside it), `tablet-list.png`, `tablet-month-calendars-pane.png` (opened from the
  overflow menu; Close gave the grid its full width back). The Month screenshots in `docs/screenshots/`
  still match the app and were not replaced. No real calendars, accounts or permissions were used.

## Today, the day sheet, Settings and the Calendars list (task D7)

Not a gate: Today's Up next card, the day sheet's Events section, the Calendar settings group, the
Calendars list (account groups, the device calendar), "+" without access and `ExternalCalendarIntents`,
checked on the JVM only (no emulator) against the mockup data set.

- **When:** 2026-10-20 04:16 EEST (Europe/Tallinn), by the D7 agent.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work; `android/app/src/main/kotlin/com/haugas/thirteen/feature/today/`,
  `feature/detail/DayEventsSection.kt`, `feature/settings/CalendarSettings.kt`, `feature/events/CalendarsSheet.kt`,
  `feature/events/NewEventPrompt.kt`, `data/DefaultCalendar.kt`, `data/calendar/ExternalCalendarIntents.kt`.
- **Toolchain:** OpenJDK 21.0.12.1 (Homebrew), Gradle 9.8.1, AGP 9.4.1, Kotlin 2.4.21, Compose BOM 2026.09.00,
  Robolectric 4.17 (SDK 36).
- **Data:** `fixtures/mockup/mockup-events.json` (debug assets), `now` 2026-10-19 09:41, device zone Europe/Tallinn;
  24-hour time. Calendar apps for "Add in your calendar app" are Robolectric package manager entries.
- **Commands** (from `android/`, `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`):
  - `./gradlew :app:testDebugUnitTest`: `BUILD SUCCESSFUL`, 358 tests in 53 classes, 0 failures, 0 skipped.
    D7's share (64 tests): `UpNextTest` (6), `TodayUpNextTest` (11), `DayEventsSectionTest` (5),
    `CalendarSettingsTest` (7), `CalendarsListTest` (6), `NewEventPromptTest` (7), `ExternalCalendarIntentsTest`
    (6), `EventsSettingsTest` (3), and the updated `SettingsScreenTest` (7: an always-dark theme shows Dark
    selected and keeps the saved choice).
  - `THIRTEEN_PERF_SCALE=3 ./gradlew :core:test --rerun`: `BUILD SUCCESSFUL`, 80 tests, 0 failures
    (`Events fixture parity: 36 sections, 1236 cases, 5541 checks`); `:core` is unchanged by D7.
  - `./gradlew :app:lintDebug :app:lintRelease`: `BUILD SUCCESSFUL`, 0 errors, 11 warnings each, none in D7's
    files. The `VectorPath` warning on the launcher background is gone (its perforation path is split into
    6 paths of 8 dots). The 11 are in the event editor's files (`Typos`, `PluralsCandidate`,
    `UnusedResources` in `strings_events_editor.xml`; `AutoboxingStateCreation` in `EditorPickers.kt` and
    `EventsWindowLayer.kt`; `UseKtx` in `ThirteenDateField.kt`).
- **Board B1 checked:** Up next on 2026-10-19 at 09:41 lists five rows under "Today" ("Day 1 of 7, Autumn
  school break, Family"; "09:30, Sprint planning, Work, repeats" with the state "Now"; "11:00, 1:1 with Marta,
  Work, repeats"; "15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18"; "19:00, Book club: Cotsworth, Home,
  Raamatukoi, repeats"), then "Tomorrow" with "07:15, Yoga, Running club, repeats", and "5 more in the next 7
  days", all asserted word for word. After 3 launches that showed the access card, the not-asked card is
  the "See your events here" link.
- **Renders:** Robolectric native graphics renders of Today, the day sheet, Settings (Obsidian, Appearance
  disabled with Dark selected) and the expanded Calendars pane were looked at in `/tmp/thirteen-shots/android-d7/`;
  they are not in `docs/screenshots/` (no emulator). No real calendars, accounts or permissions were used.

## Event details, the editor and held changes (task D6)

Not a gate: event details, the editor and its pickers, the 13-month date field, the span, delete, discard
and conflict dialogs, and held deletes with their toasts (`PendingChanges`), checked on the JVM against the
mockup data set and on the `Thirteen_Phone` AVD.

- **When:** 2026-10-20 04:33 EEST (Europe/Tallinn), by the D6 agent.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work; `android/app/src/main/kotlin/com/haugas/thirteen/feature/events/`
  (`EventDetailScreen.kt`, `EventEditorScreen.kt`, `EditorState.kt`, `EventDraftCodec.kt`, `ThirteenDateField.kt`,
  `EditorPickers.kt`, `EventDialogs.kt`, `EventSupport.kt`, `EventToasts.kt`, `EventsWindowLayer.kt`),
  `data/calendar/PendingChanges.kt`, `data/calendar/FailedCommits.kt`, `res/values/strings_events_editor.xml`.
- **Toolchain:** OpenJDK 21.0.12.1 (Homebrew), Gradle 9.8.1, AGP 9.4.1, Kotlin 2.4.21, Compose BOM 2026.09.00,
  Robolectric 4.17 (SDK 36).
- **Data:** `fixtures/mockup/mockup-events.json` (debug assets), `now` 2026-10-19 09:41, device zone Europe/Tallinn;
  24-hour time.
- **Commands** (from `android/`, `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`):
  - `./gradlew :app:testDebugUnitTest`: `BUILD SUCCESSFUL`, 361 tests in 54 classes, 0 failures, 0 skipped.
    D6's share (52 tests): `EditorStateTest` (21: new and duplicate drafts, an invitation's alerts-only draft,
    end before start and out of range under their fields, midnight ends, all-day Free with the times restored,
    the repeat notice when the start moves (Never, converted), Leap Day stepping, the later-events line, the span
    question and its losses, the retime notice, rules from other apps, alerts the calendar cannot keep, the
    Exchange conflict, the Android storage notes, saved state and the draft codec), `EventEditorScreenTest` (7), `EventDetailScreenTest`
    (6), `ThirteenDatePickerTest` (6: cell and slot names, Leap Day fallback, leap-only stepping in IFC and
    Positivist, the 1583 floor, the list of days at large sizes), `EventToastHostTest` (2: Undo brings the event
    back unwritten, Close writes it), `PendingChangesTest` (10: hold and Undo, the toast's close, the next change,
    a future delete's overlay, the transient retry and revert, final causes and their record, an occurrence that
    no longer resolves, the alert a minute away, a change elsewhere).
  - `THIRTEEN_PERF_SCALE=3 ./gradlew :core:test --rerun`: `BUILD SUCCESSFUL`; `:core` is unchanged by D6.
  - `./gradlew :app:lintDebug`: `BUILD SUCCESSFUL`, "No issues found." (the 7 warnings and 4 hints D7 recorded in
    the editor's files are fixed or marked: `Typos` and `PluralsCandidate` on verbatim catalogue strings, `event_url`
    kept for the URL row Android does not show).
- **Emulator:** `Thirteen_Phone` (API 37, build `CE2A.260420.019`, 1080 x 2424, 420 dpi) on port 5602, the debug APK
  launched with `--es thirteen.qa.today 2026-10-19 --ez thirteen.qa.fakeEvents true`; shut down after the run. Walked
  through: Today, Book club's details, Edit (the navigation bar hidden under the editor), the Starts picker, the
  repeat picker, a title change saved for "this event only" (the span question, then "Event saved." and the details
  showing the new title), and Dentist's delete (the confirmation, "Event deleted." with Undo, Undo bringing it back).
  Screenshots in `/tmp/thirteen-shots/android/`: `d6-details-book-club.png`, `d6-editor-book-club.png`,
  `d6-date-field-picker.png`, `d6-repeat-picker.png`, `d6-span-dialog.png`, `d6-saved-toast.png`,
  `d6-delete-confirmation.png`, `d6-undo-toast.png`. No real calendars, accounts or permissions were used.

## Week, Day and drag and drop (task D5)

Not a gate: the Week and Day timelines (overflow blocks, column containers, the "New event" placeholder) and
drag and drop (time-group moves, `validateDraft` before holding, the repeat-changing span question with its
counts and losses, the invitee question), checked on the JVM against the mockup data set and on the
`Thirteen_Tablet` AVD, also resized to a phone screen.

- **When:** 2026-10-20 04:58 EEST (Europe/Tallinn), by the D5 agent.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work; `android/app/src/main/kotlin/com/haugas/thirteen/feature/calendar/`
  (`WeekMode.kt`, `DayMode.kt`, `Timeline.kt`, `DragAndDrop.kt`, `EventMoves.kt`, `MoveFlow.kt`, and the drag sources
  in `EventChip.kt`, `MonthEventGrid.kt`, `IntercalaryBand.kt`, `MonthDayList.kt`), `res/values/strings_events_timeline.xml`,
  and `OccurrenceDetails.originalDate` / `overrideDates` in `data/calendar/` (the counts of the span question).
- **Toolchain:** OpenJDK 21.0.12.1 (Homebrew), Gradle 9.8.1, AGP 9.4.1, Kotlin 2.4.21, Compose BOM 2026.09.00,
  Robolectric 4.17 (SDK 36).
- **Data:** `fixtures/mockup/mockup-events.json` (debug assets), `now` 2026-10-19 09:41, device zone Europe/Tallinn;
  24-hour time.
- **Commands** (from `android/`, `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`):
  - `./gradlew :app:testDebugUnitTest`: `BUILD SUCCESSFUL`, 362 tests in 54 classes, 0 failures, 0 skipped.
    D5's share (38 tests): `EventMovesTest` (17: a single event held for "this event" with the toasts "Event moved to
    14:00." and the invitee line, a Month drop keeping the time and a bar's offset, timed to all-day keeping Busy,
    all-day to timed as one hour, the span question, Yoga to Year Day (endless: "Every later event in this series will
    be deleted."), the counted drop with its `laterOccurrenceCount`, the first occurrence, a yearly repeat converted
    to "Every Year Day", repeats from other apps (only "this event"), a `gregorian-only` calendar (only "this event"),
    the exceptions "future events" removes, the 1583 floor, read-only and `BYYEARDAY` refusals, the invitee count, the
    15-minute snap, the column under a touch and the drop minute kept within the day), `MoveFlowTest` (8: the
    Material dialogs, Cancel, "Move and delete later events", "Move this event?", a refused drop, which events
    are picked up, and a long press on a clickable block picking it up while a tap still clicks), `DayModeTest` (7),
    `DayModeExpandedTest` (1), `WeekModeTest` (5: column labels, the header opening Day, the Year Day column, the
    "3 more events at 14:00" block, the font scale 1.5 fallback to Day).
  - `THIRTEEN_PERF_SCALE=3 ./gradlew :core:test --rerun`: `BUILD SUCCESSFUL`, 80 tests, 0 failures
    (`Events fixture parity: 36 sections, 1236 cases, 5541 checks`); `:core` is unchanged by D5.
  - `./gradlew :app:lintDebug`: `BUILD SUCCESSFUL`, "No issues found."
- **Found on the emulator, fixed, and covered:** (1) a long press never started a drag: the start detection of
  `dragAndDropSource(transferData)` waits for an unconsumed down, and every source is also `clickable`, which
  consumes it. The sources now detect the long press themselves (`MoveFlowTest` fails with the old detection).
  (2) The timeline's drop target took drops over the all-day row and the headers, and a block dropped above
  00:00 landed at 23:00 the day before: a drop target's bounds are its layout node's inner bounds, which for the
  scrolling node were the whole day. The target is now a box of its own around the scrolling day, and the
  start stays within the column's day (`dropStartMinute`). (3) The dragged block did not dim: the drag source
  draws a cached picture of what it wraps, so the dimming now sits outside it.
- **Emulator:** `Thirteen_Tablet` (API 37, build `CE2A.260420.019`, 2560 x 1600, 320 dpi), started headless on port 5620
  with `-read-only -no-snapshot` and shut down after the run; for the phone screens `wm size 1080x2424` and
  `wm density 420` (portrait, compact: Week falls back to Day) and `wm size 2424x1080` (landscape, expanded:
  Week), then `wm size reset` and `wm density reset`. The debug APK launched with
  `--es thirteen.qa.today 2026-10-19 --ez thirteen.qa.fakeEvents true`. Drags were injected with
  `adb shell input motionevent` (DOWN, 0.9 s, MOVE steps, UP). Walked through: Dentist dragged to 14:00 in Day
  (dashed preview at 14:00, "Event moved to 14:00." with Undo offered), the dragged block dimmed in place,
  Book club (repeating) dragged to 17:00 (the span question, "Move this event only", "Event moved to 17:00."),
  Lunch with Jaan dragged across columns in Week
  ("Event moved to Wednesday, October 11, 2026 at 15:00."), Yoga dragged onto the Year Day column (the span
  question: "Moving future events to Year Day 2026 ends the repeat. Every later event in this series will be
  deleted.", Cancel), a Month chip dropped on another cell ("Event moved to Saturday, October 21, 2026."),
  Dentist dropped on Day's all-day row (all day), a drop outside every target (nothing moved), a tap on a block
  (its details in the 360 dp panel) and a tap on empty time (the "New event, 22:30 to 23:30" placeholder).
  Screenshots in `/tmp/thirteen-shots/android/`: `tablet-week.png`, `tablet-week-yearday.png`,
  `tablet-week-dragging.png`, `tablet-week-moved.png`, `tablet-week-yearday-span-dialog.png`, `tablet-day.png`,
  `tablet-day-details.png`, `tablet-day-placeholder.png`, `tablet-day-dragging.png`, `tablet-day-moved.png`,
  `tablet-day-span-dialog.png`, `tablet-day-to-allday.png`, `tablet-month-dragging.png`, `tablet-month-moved.png`,
  `phone-day.png` (portrait with Week chosen: Day), `phone-day-dragging.png`, `phone-day-moved.png`,
  `phone-landscape-week.png`. No real calendars, accounts or permissions were used.

## Android QA: suites, accessibility, release build and V12 again (task D9, D10's emulator part)

Not a gate, except V12, which it runs again on the final code: the JVM and instrumented suites, the
Android accessibility pass of §8.3 item 3, lint and the R8 release build, on emulator images only.
§8.3 item 9's suite ("instrumented suite green on API 26, 30 and 37") is green.

- **When:** 2026-10-20, 05:03 to 06:18 EEST (Europe/Tallinn), by the D9 agent. The last runs, all on the
  final code: release build 06:06 and its smoke test 06:07; instrumented suite on API 30 at 06:10, API 26
  at 06:12, `Thirteen_Phone` at 06:17 and `Thirteen_Tablet` at 06:18; JVM suites 06:12; lint 06:13.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work (D1 to D8 and the D9 changes below).
- **Toolchain:** OpenJDK 21.0.12.1 (Homebrew), Gradle 9.8.1, AGP 9.4.1, Kotlin 2.4.21, Compose BOM
  2026.09.00, Robolectric 4.17 (SDK 36), Android emulator 37.2.12.0, build-tools 37.0.0.
- **Images** (started headless with `-no-snapshot -read-only`, one at a time, each shut down after its run;
  device zone Europe/Tallinn; 24-hour time):

  | AVD | Android | Build | tzdata | Screen |
  |---|---|---|---|---|
  | `Thirteen_Phone` | 17 (API 37) | `CE2A.260420.019` | 2025c | 1080 x 2424, 420 dpi |
  | `Thirteen_Tablet` | 17 (API 37) | `CE2A.260420.019` | 2025c | 2560 x 1600, 320 dpi |
  | `Thirteen_API30` | 11 (API 30) | `RSR1.240422.006` | 2020a | Pixel 5 |
  | `Thirteen_API26` | 8.0.0 (API 26) | `OSR1.180418.028.A3` | 2017b | Pixel 5 |

- **Accounts and data:** LOCAL test calendars that the tests create and delete; the mockup data set
  through the debug QA extras for the UI; the release smoke test created the device calendar "Thirteen" on
  the `-read-only` phone emulator. No Google account, no real calendars, accounts or contacts.
- **Commands and results** (from `android/`, `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`):
  - `THIRTEEN_PERF_SCALE=3 ./gradlew :app:testDebugUnitTest :core:test --rerun --continue`: `BUILD SUCCESSFUL`;
    `:app` 375 tests in 58 classes, 0 failures, 0 skipped; `:core` 80 tests in 6 classes, 0 failures
    (`Events fixture parity: 36 sections, 1236 cases, 5541 checks`).
  - `./gradlew :app:lintDebug :app:lintRelease`: `BUILD SUCCESSFUL`, "No issues found." in both reports.
  - `./gradlew :app:assembleRelease` without the signing variables: `BUILD SUCCESSFUL` (`minifyReleaseWithR8`),
    `app-release-unsigned.apk` 2.8 MB.
  - `./gradlew :app:assembleDebug :app:assembleDebugAndroidTest`, both APKs installed, then
    `adb shell am instrument -w -r com.haugas.thirteen.test/androidx.test.runner.AndroidJUnitRunner`:
    `OK (38 tests)` on each of the four AVDs (`ProviderRecurrenceTest` 13, `ProviderRepositoryTest` 18,
    `ProviderTimeZoneTest` 2, `CalendarAccessibilityTest` 5).
- **V12 again:** pass. D8's `ProviderRecurrenceTest` and `ProviderRepositoryTest` are green on API 26, 30
  and 37 on the D9 build, with one new `ProviderRepositoryTest` case (below), so D8's verdict and findings
  hold. A third case §4.4 did not list came up in the new zone test:

### Clock changes in the provider (`ProviderTimeZoneTest`, new)

The `zones` section of `fixtures/events.json` on each image: every case through the app's
`JavaTimeZoneResolver` on the device's tzdata, and every local-to-UTC case inside 1902 to 2037 as a daily
series of five at the case's wall time, from two days before, whose `Instances` are compared with core's
instants (logcat `PROBE zones`):

| Case (`zones`) | API 37 | API 30 | API 26 |
|---|---|---|---|
| [0] New York 2026-03-08 02:30, a time spring forward skips | moved for good: 03:30 that day and every later day | dropped: no instance that day | = API 30 |
| [4] Tallinn 2026-03-29 03:30, skipped | moved for good | dropped | dropped |
| [7] Lord Howe 2026-10-04 02:15, skipped (30 minutes) | moved for good | dropped | dropped |
| [8] Apia 2011-12-30 09:00, the day Samoa skipped | moved for good | the skipped day's occurrence missing | = API 30 |
| [9] São Paulo 2018-11-04 00:00, skipped | moved for good | dropped | the device's tzdata (2017b) still starts that change on 2018-10-21 |
| [1] New York 2026-11-01 01:30 and [5] Tallinn 2026-10-25 03:30, times fall back repeats | later offset: the standard-time instant | = | = |
| the 7 other cases | same as core | same | same |

The device check matches all 29 cases on API 30 and 37; on API 26 only case [9] differs (tzdata 2017b),
so the test asserts it only where the device's tzdata is at least the fixture's 2025b and logs the rest.

Core, the fixture and the other platforms (§5.5) move a skipped wall time forward by the gap for that day
only and take the first instant of a repeated one, so Thirteen on Android showed a series at such a time
an hour off, or not at all, on those days. Fixed: `SelfExpansion.startsInAClockChange` hands every timed
`RRULE` series whose wall-clock start time a clock change skips or repeats, between its `DTSTART` and the
end of the year read, to core's `expandSeries`, as it does `BYYEARDAY` series; `readYear` reads every timed
`RRULE` row from `Events` to decide. Covered by `SelfExpansionTest.seriesWhoseStartTimeAClockChangeSkipsOrRepeatsAreSelfExpanded`
and `ProviderRepositoryTest.aRepeatWhoseTimeASpringForwardSkipsKeepsThatDayOnEveryLevel` (daily 03:30
Tallinn from 2026-03-27, `COUNT=5`: 03:30, 03:30, 04:30 on the 29th, 03:30, 03:30, on API 26, 30 and 37).
Alarms and other calendar apps keep the provider's times; §4.4 and §6.3 need the case (the spec agent owns
docs/EVENTS.md). Single events are stored as instants and are not affected.

### Accessibility pass (§8.3 item 3, Android)

- **TalkBack labels (§2.20).** On the JVM the table is asserted word for word by D4 to D7's tests and by the
  new `AccessibilityPassTest` (11 tests). On every image `CalendarAccessibilityTest` reads the framework's
  accessibility tree through `UiAutomation`, as an accessibility service does, and finds "Sunday. Gregorian
  Thursday"; "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events." with "Open Sprint
  planning", "Open Dentist, Dr. Tamm", "Previous month" and "Next month" among its actions; "09:30, Sprint
  planning, Work, repeats" (the phone's day list) or "Sprint planning, 09:30 to 10:30, Work, repeats" (the
  tablet's chip); the title "October 2026. Gregorian Oct 8 to Nov 4." with its paging actions; Day's column
  "Thursday, October 12. Gregorian Monday, October 19" with "New event", "Previous day" and "Next day", and
  its block "Dentist, Dr. Tamm, 15:40 to 16:20, Home". TalkBack (on the API 37 image) was turned on once on
  the phone: its focus outline went to the day cell, the week strip and a block (`d9-phone-talkback-*.png`),
  then it was turned off. There is no spoken walkthrough: injected taps activate items instead of exploring.
- **Switch Access paging (§2.1).** Found: only the title had the paging actions, so a switch user on a
  grid cell had to leave the grid to page. Fixed: `PagingActions.kt` adds them after each grid element's
  own actions (Month cells, the intercalary band, the large-text day headers, Day's and Week's columns),
  leaving out an action that has no page. Checked on the JVM (`GridPagingActionsTest`, `WeekPagingActionsTest`)
  and on every image through `AccessibilityNodeInfo.performAction` with the custom action ids, which is what
  Switch Access and TalkBack's actions menu call: "Next month" from today's cell shows "November 2026.
  Gregorian Nov 5 to Dec 2.", "Previous month" from the title brings October back, "Next day" from Day's
  column shows "Friday, October 13. Gregorian Tuesday, October 20". The Switch Access service itself was
  not set up or driven (it needs a switch device or its setup flow).
- **Font scale 200%.** JVM: `FontScale200Test` (5) and `FontScale200ExpandedTest` (1). Devices:
  `atFontScale200MonthIsAListOfDays` (`font_scale 2.0`): Month is the list of days with no weekday header,
  today's header keeps its name and paging actions, and "Next month" pages. Found and fixed: the Day week
  strip cut two-digit days (now `CapFontScale`), Day's "Day 1 of 7" lay over the bar's title (now at the
  bar's end), and the top bar's subtitle wrapped (now one line, shrinking to 60%). Still open: the compact
  top bar's title is cut at 2.0 ("Thursday, October 12, 20..." in Day on the phone; TalkBack reads the
  whole title), a 30-minute block's text is clipped to its height, and the tablet editor is the full-width
  pane D6 chose.
- **Keyboard on tablets** (`Thirteen_Tablet`, `adb shell input keycombination`, and the device test on
  every image): Tab moves focus into the Month grid with a visible focus ring, arrows move it by a day and
  a week, Enter selects; Ctrl+Right pages, Ctrl+T goes back to today, Ctrl+Shift+1 to Ctrl+Shift+5 switch
  modes, Ctrl+N opens the editor. Found and fixed: Esc did nothing. Esc that nothing on screen takes now
  closes what Back closes when the top of the section is an overlay (`ThirteenAppState.escapeCloses`): the
  editor (or, with changes, its discard question first), details, the Calendars list, a comparison,
  Settings; on a mode or a section root it does nothing (`ThirteenAppStateTest.escapeClosesOnlyOverlays`).
  Before API 34 the first navigation key after a touch only leaves touch mode, in every app, and on API 30
  the soft keyboard takes the first Esc in the editor; the device test sends a Tab first and a second Esc.

### Release build (R8)

`app-release-unsigned.apk` signed with the debug key into `/tmp` (`apksigner`, never the release keystore):
package `com.haugas.thirteen`, version 1.0.0 (1), minSdk 26, targetSdk 37; permissions `READ_CALENDAR`,
`WRITE_CALENDAR` and the generated `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` only; no mockup data in the
APK. On `Thirteen_Phone` with the calendar permissions granted: "Create a calendar on this device" made the
"Thirteen" calendar; a new event "R8 smoke" with "Every IFC month on the 13th" was saved ("Event saved.",
the Month day list row "07:00, R8 smoke, Thirteen, repeats", stored as a UTC `RDATE` list from `20261020T040000Z`);
Day, Week, Year, Today, History, Compare, Convert and Ctrl+Shift+5 (List) opened; the crash buffer stayed
empty.

### Earlier reports checked

- D6's open item, a tap on a Month day list row not opening details, works on the D9 build
  (`d9-phone-details-from-month-row.png`).
- D7's question whether Today's Up next rows can be dragged: no; without `LocalEventMoves` the drag source
  adds nothing.
- Robolectric at SDK 37 was tried: every Compose test fails in Espresso 3.7.0 (`NoSuchMethodException:
  android.hardware.input.InputManager.getInstance()`, 179 failures), so the JVM tests stay on SDK 36.

### Screenshots

Mockup data set, today 2026-10-19 (QA extras), 24-hour time. In `docs/screenshots/`: `android-calendar-month.png`,
`android-calendar-day.png`, `android-today-up-next.png`, `android-event-editor.png`, `android-repeat.png`,
`android-calendars.png`, `android-access.png` (phone) and `android-tablet-calendar-month.png`,
`android-tablet-calendar-week.png` (tablet). D9 took 36 shots in `/tmp/thirteen-shots/android/`, named `d9-*`:
phone Month, Year, Day, List, Today, the editor, the repeat picker, the Calendars sheet, landscape Week,
details from a Month row, the access card in Month and Today, Month, Day and the editor at font scale 2.0,
and the three TalkBack shots; tablet Month, Week, Day, Year, List, details, the editor, the repeat picker,
the Calendars pane, keyboard focus and Enter, Esc's discard question, Month and Week at font scale 2.0;
the release build's Month after the save, List and Day. Those `d9-*` files are gone from `/tmp` (the
cross-platform review of 2026-10-27 found only 9 later `phone-*` and `tablet-*` shots there), and the
`docs/screenshots/android-*.png` files date from 2026-10-20, before D9's fixes, the review fixes and the
cross-platform fixes. They are retaken at release with the demo-mode procedure of android/README.md
"QA runs" (owner's note: screenshots are retaken at release).

## Review fixes (2026-10-20 and 2026-10-26/27)

Not a gate run. The fixes for the review of the Android Events feature (31 findings: 4 blockers, 13
major, 14 minor), and the full suites and builds after them. A first fix run on 2026-10-20 (06:48 to
07:50 EEST, the "review pass" D2 and D3 refer to above) fixed the data-layer findings and wrote
`ReviewFindingsDataTest` and `ReviewFindingsDataProviderTest`; the 2026-10-26 runs added the navigation
guard; a run from 2026-10-26 23:25 to 2026-10-27 01:13 EET checked every finding against the code and
fixed the rest. A last run (2026-10-27 from 01:18 EET, after a server restart cut the one before off)
built the tree as it was left, found every fix below in the code with its test, ran the suites and
builds, and fixed the one bug they found (finding 19's names query, below; "Suites and builds after the
fixes" at the end of this section).

| # | Finding (severity) | Result |
|---|---|---|
| 1 | Ctrl+Shift+1 to 5 over a changed draft discarded it (blocker) | fixed: shortcuts pause while the editor is on top (`shortcutsPaused`), and every navigation that would close a changed editor (mode switch, Month title, Day, tab reselect, Ctrl+T, links) waits for its discard question (`guardEditors`, `discardRequest`). `ThirteenAppStateTest.modeShortcutsPauseWhileTheEditorIsOpen`, `aModeSwitchOverAChangedDraftAsksFirst`, `reselectingTheTabOfAChangedDraftAsksFirst` |
| 2 | a `thirteen://` link over a changed draft discarded it (blocker) | fixed: the link waits; "Keep editing" drops it. `aLinkOverAChangedDraftWaitsForTheDiscardQuestion` |
| 3 | V18 and V20 fallbacks missing (blocker) | fixed: `ReminderReceiver`, `POST_NOTIFICATIONS` (asked when the first alert is set in the "Thirteen" calendar), `alert.android.blocked` with "Open settings" in the editor, the Settings switch and footer, `calendars.createDevice.message.alerts`, `notification.body`; `alarmsEditable = false` for Google invitations. New `ReminderReceiverTest` |
| 4 | Day's expanded details panel: Edit and Duplicate did nothing (major) | fixed (`CalendarModeActions.openEditor`). `DayModeExpandedTest.thePanelsEditOpensTheEditor` |
| 5 | List: no backward loading, a pull from a later day blanked the list (major) | fixed: per-year reads keyed by year, the rows stay while a year loads, the first visible day entry stays anchored (`requestScrollToItem`). `ListModeTest.aPullAtTheTopAddsEarlierDaysAboveAndKeepsTheRowInPlace` |
| 6 | shortcuts took Ctrl+arrows and Ctrl+T from the editor's text fields (major) | fixed: no shortcut while a text field has focus (`onCheckIsTextEditor`) or the editor is on top; `KeyboardShortcuts` doc comment updated |
| 7 | Save with an issue left focus in Title and announced nothing (major) | fixed on 2026-10-26/27: a date pill or row with an issue can take focus in touch mode (`focusProperties { canFocus = true }`; its focus scrolls it into view), and every Save with an issue announces it (`announceForAccessibility`). `EventEditorScreenTest.saveWithAnIssueMovesFocusToTheFirstFieldWithIt` puts the window in touch mode as a device is after a tap; without the fix it fails ("Focused = 'false'" on the Ends pill) |
| 8 | "Show calendars" moved no focus (major) | fixed on 2026-10-26/27: `ThirteenAppState.showCalendars` (Month, Week, Day, List, Up next, the day sheet); the list opens the first hidden calendar's group if collapsed, scrolls to its row and focuses its switch, which TalkBack follows. `CalendarsListTest.showCalendarsFocusesTheFirstHiddenCalendar`, `showCalendarsOpensTheGroupOfTheFirstHiddenCalendar`, `ThirteenAppStateTest.showCalendarsAsksTheListToFocusTheFirstHiddenCalendar` |
| 9 | compact Month day list rows named like List rows (major) | fixed: `calendar.item.a11y` ("Sprint planning, 09:30 to 10:30, Work, repeats"). `MonthModeTest.theSelectedDaysListUsesTheItemLabels` |
| 10 | all-day multi-day rows named "Day 1 of 7, ..." while showing "All day" (major) | fixed: "All day, Autumn school break, Family, day 1 of 7", as Apple and web. `ListModeTest`, `TodayUpNextTest`, `DayEventsSectionTest` |
| 11 | medium width: the first lane covered the Gregorian digits (minor) | fixed on 2026-10-26/27: the stacked cell header is measured as `DayCell` draws it (4 dp + the 26 dp number circle + the label box + the 13 sp Gregorian line + 2 dp: 45 dp at 100% against 43 dp drawn; it was 40 dp) |
| 12 | expanded: details and the editor full width (minor) | fixed on 2026-10-26/27: details are a detail pane beside the screen they came from (`ListDetailScene.besidePane`, Close button), the editor a dialog of about 600 dp (Navigation3 `DialogSceneStrategy`; a tap outside does not close it, Back and Esc ask first). `CalendarsPaneTest.detailsOpenBesideTheGridAndTheEditorIsADialog` |
| 13 | the compact back arrow said "Back" (minor) | fixed on 2026-10-26/27: it reads the parent ("2026", "October", "Upcoming"). `MonthModeTest.theBackArrowReadsTheParent`, `CalendarPeriodsTest.theBackArrowReadsTheParent` |
| 14 | Day on an intercalary day had no "No weekday" plate (minor) | fixed on 2026-10-26/27: the plate (`picker.noWeekday`) beside "Year Day 2026" in the top bar |
| 15 | Year cell labels write "Gregorian:" with a colon (minor) | fixed on 2026-10-27 by the cross-platform review's decision (the Windows form, §2.20): "{date}. Gregorian {gregorianDate}"; see "Cross-platform review fixes" below |
| 16 | "Show my events" off: List still offered, a blank page (minor) | fixed on 2026-10-26/27: no List toggle or segment, Ctrl+Shift+5 does nothing, a List entry shows Month (`listOffered`). `MonthModeTest.withEventsOffTheGridIsTheCalendarAlone`, `ThirteenAppTest` |
| 17 | compact Month without access dropped the selected day's header (minor) | fixed on 2026-10-26/27: the header (date, Gregorian line, "+", chevron) stays under the card. `MonthModeTest.withoutAccessTheCardAsksAndTheGridStays` |
| 18 | font scale 200%: the Day title cut, a 30-minute block's time line clipped (minor) | fixed on 2026-10-26/27: from 1.5 the compact Day title is the medium form ("Thu, Oct 12, 2026"; spoken in full), and timeline blocks choose their lines from the text's own line heights at the font scale (one line with the start time where two do not fit) |
| 19 | invitees as a count only (minor) | fixed on 2026-10-26/27: names (the provider's `ATTENDEE_NAME`, else the address) up to 5; more as "{n} invitees" that opens the list (tap or TalkBack's expand). Without names (the mockup data) the count, as Apple. `EventDetailScreenTest.fiveInviteesOrFewerAreListedByName`, `moreThanFiveInviteesOpenTheirList`. The last run found that the names query broke the details of every provider event with invitees: it sorted by a bare `_id`, which the provider's join of Attendees, Events and Calendars makes ambiguous ("ambiguous column name: _id", so `event()` returned null and the details did not open; `ProviderRepositoryTest.aMoveToAnotherAccountKeepsExceptionsAndInviteesAreRefused` failed with a NullPointerException). Fixed (no sort order); that test now also checks the names |
| 20 | screenshots show the emulator's real clock (minor) | procedure fixed: android/README.md "QA runs" turns on System UI demo mode (09:41) before capturing. The screenshots are not retaken here: they are retaken at release |
| 21 | V20: a Google invitation's alerts editable (blocker) | fixed: `INVITEE_ALERTS_GOOGLE = false`. `ReviewFindingsDataTest.aGoogleInvitationsAlertsAreNotEditableWhileGateV20IsUnrun` |
| 22 | Thirteen's own write wrote the next held change early, losing its Undo (major) | fixed: each held change keeps a fingerprint of its event and is written early only when that changed. `ReviewFindingsDataTest.thirteensOwnWriteOfTheFirstHeldChangeDoesNotWriteTheSecondOneEarly`, `ReviewFindingsDataProviderTest.theWriteOfOneHeldDeleteDoesNotWriteTheNextOneEarly` |
| 23 | a detached copy's details lost its series (major) | fixed: details take the event, repeat and spans from the series and the original date from the marker; "Delete all future events" from a copy ends the series. `ReviewFindingsDataProviderTest.aChangedOccurrenceUnderTheDetachedFallbackStaysAnOccurrenceOfItsSeries` |
| 24 | a single event moved to another account with a new time was refused (major) | fixed. `ReviewFindingsDataTest.aSingleEventMovesToAnotherAccountWithANewTimeInOneSave`, `ReviewFindingsDataProviderTest.aSingleEventMovesToAnotherAccountWithANewTime` |
| 25 | email notifications read and rewritten as alerts (major) | fixed: only `METHOD_ALERT`, `METHOD_DEFAULT` and `METHOD_ALARM` rows are alerts; other rows are kept. `anEmailNotificationIsNotADeviceAlertAndSurvivesAnAlertEdit` |
| 26 | a held future delete left changed occurrences and later parts on screen (major) | fixed: the series' row ids are held. `aHeldFutureDeleteHidesTheSeriesChangedOccurrencesAndLaterParts` |
| 27 | one detached copy counted as two dropped changes (major) | fixed. `oneDetachedCopyCountsAsOneDroppedChange` |
| 28 | a move dropped what a duplicate part held (minor) | fixed: the duplicates' `EXDATE` and exception rows are merged first, as top-up does. `aMoveBetweenAccountsKeepsWhatADuplicatePartHolds` |
| 29 | a held move overwrote a time change made elsewhere (minor) | fixed: it fails as `calendar.commitFailed.changed.move`. `aHeldMoveWhoseTimeGroupChangedElsewhereFailsInsteadOfOverwritingIt` |
| 30 | the held move's alert time from the wall clock (minor) | fixed: core's `alarmFireTime` with the start instant. `theHeldMoveAlertTimeIsTheEnginesAlarmFireTimeOnAClockChangeDay` |
| 31 | a foreign rule that keeps its own end was rewritten by a cut (minor) | fixed: its text stays as read; otherwise only the `COUNT=` or `UNTIL=` part changes in place. `aForeignRuleWhoseOwnEndComesEarlierKeepsItsTextWhenTheSeriesIsCut` |

Every `ReviewFindings*` test shows a real bug, so all of them stay (10 JVM, 3 instrumented); none was
deleted. Lint's five `ReminderReceiver` warnings (`ObsoleteSdkInt`, `UseKtx`) were fixed too.

### Phase 0 and the `RDATE` constants

The probe report asked to apply phase 0 to the date-list form and the part size: Google's web import kept
the `TZID;` form, and it refused every event with more than about 4,096 characters of `RDATE` text (254 timed
`TZID` values, 4,089 characters, kept; 255 refused; 400 timed refused even over 10 lines; 400 all-day kept).
Spec v3.3 already reads these results, and Android follows it: `TIMED_DATE_LIST_FORM = UTC` and
`PART_SIZE = 210` stay. §8.2 (gate status, owner) ships V10's fallback while its Android sync leg is not
run, and the `TZID;` retention seen on Google web is "evidence only" until then (§4.4). In the UTC form a
value takes 17 characters (18 with its comma), so the largest kept size of about 250 timed `TZID` values
would be about 4,500 characters of UTC text, over the limit; 210 values (211 with the part's start) are
about 3,800, which leaves room for the part's `EXDATE`, holds a new weekly series' 3-year horizon in one
part, and stays the same for all-day series, so an all-day toggle never re-cuts parts (§4.4 Parts). If V10's
Android leg passes, `TIMED_DATE_LIST_FORM` becomes `ZONED` and `PART_SIZE` stays 210 (the cut must be the
same on every device and version).

### Suites and builds after the fixes

Run on 2026-10-27 (EET) on the final code, from `android/`, with
`JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` and `THIRTEEN_PERF_SCALE=3`.
The host was shared with other builds and simulators and its load average swung between about 20 and
1,000 during the run, which is what the emulator failures below come from.

| What | Command | Result |
|---|---|---|
| Engine | `./gradlew :core:test --rerun` | 80 tests, 0 failures (01:41) |
| JVM app suite | `./gradlew :app:testDebugUnitTest` | 414 tests in 61 classes, 0 failures, 0 skipped (02:33, after the last code change); also with `--rerun` at 01:41 before it |
| `ReviewFindings*` | in the two suites above and below | `ReviewFindingsDataTest` 10 of 10, `ReviewFindingsDataProviderTest` 3 of 3 |
| Lint | `./gradlew :app:lintDebug :app:lintRelease` (analysis re-run with `--rerun` at 01:50, and again at 02:39 after the last code change) | "No issues found." for debug and release |
| R8 release build | `./gradlew :app:assembleRelease` (`minifyReleaseWithR8` re-run) | BUILD SUCCESSFUL; `app-release-unsigned.apk` 2.9 MB. Not installed in this run (the emulator was unstable); D9's smoke test of the release build stands |
| Instrumented suite | `am instrument -w -r com.haugas.thirteen.test/androidx.test.runner.AndroidJUnitRunner` on `Thirteen_Phone` (API 37, emulator-5584, headless, 24-hour time) | final APK: `Tests run: 41, Failures: 1`; the failure, `CalendarAccessibilityTest.aCalendarAppOpensAThirteenEventsDay` ("not found: the event's day in Day mode. On screen: []", the app had not drawn yet), passed when run alone (`OK (1 test)`). `ProviderRepositoryTest` `OK (18 tests)` after the names fix; `ProviderTimeZoneTest` logged "PROBE zones provider: 14 cases, 0 differ" and "device: 29 cases, 0 differ" (tzdata 2025c) |

Earlier attempts in the same run, for the record: the first full run stopped after 3 tests with
"INSTRUMENTATION_ABORTED: System has crashed." (the emulator's `system_server` was killed by its
watchdog: "Blocked in monitor InputManagerService ... for 16s", "DeadSystemException"); a package run
stopped with "Process crashed." when the app missed its startup deadline ("ANR in com.haugas.thirteen,
Reason: ... failed to complete startup"); one `CalendarAccessibilityTest` run failed all 5 tests behind a
"System UI isn't responding" dialog and passed (`OK (5 tests)`) once it was dismissed. API 26 and 30 were
not run again.

Device checks of the findings on the same emulator, with the mockup data set
(`--ez thirteen.qa.fakeEvents true`, today 2026-10-19); screenshots and UI dumps in
`/tmp/thirteen-review-fixes/android/`:

- 1: the editor open on a new event with the title "Mode switch draft", then Ctrl+Shift+3: nothing
  happens, the editor and its title stay (`f01-modeswitch`).
- 6: Ctrl+Left in that Title field, then "X": "Mode switch Xdraft"; Ctrl+T then changes nothing
  (`f03-ctrlleft`).
- 2: `thirteen://day/2026-11-02` over the changed draft: "Discard this event?" with "Discard event" and
  "Keep editing"; "Keep editing" keeps the draft (`f02-deeplink`, `f02b-keep`). "Discard event" and the
  link applied after it could not be watched on the device (ANR dialogs from the starved system came
  up over it; the app's main thread was idle in the ANR trace); `ThirteenAppStateTest` covers that step.
- 5: List opened from IFC October 26 (Gregorian November 2), a slow pull at the top: "Tuesday, October
  24" appears above, October 26 stays where it was, and scrolling up shows October 19 and 20; the list
  is never blank (`f05b-list`, `f05c-pull1`, `f05d-scrollup`).
- 4 and 12, with the display set to 2560 x 1600 at 320 dpi (expanded, then reset): Day's panel "Edit"
  opens the editor as a dialog of about 600 dp over Day and the panel (`t03-editor`); a Week block's
  details open in a pane beside the week (`t05-week-details`).
- The font scale 2.0 check of finding 18 was not done: the emulator's system crashed again during it.
- The provider SQL of `ReminderReceiver` (V18) compiles on API 37: `content query` on `calendar_alerts`
  with its projection, selection and sort gave "No result found." with no error; the same command
  reproduced the names query's "ambiguous column name: _id".

## Cross-platform review fixes (2026-10-27)

Not a gate run. The cross-platform consistency review of 2026-10-27 compared the four platforms with
each other and with the boards and found six Android issues (one major, five minor). All are fixed;
none was rejected. Checking them on the emulator found a seventh, a drawing bug that hid issue 3's fix
on devices (the "found on the device" row). The review left no `ReviewFindings*` tests of its own; the
new tests below each fail without their fix (checked by reverting the bar edge, the repeat text and the
move question for one run: 4 of the 4 tests failed; and the drag source for another: its test failed;
then the code was restored).

| # | Issue (severity) | Result |
|---|---|---|
| 1 | a Calendar change to another account copied the event and deleted the original without `move.confirm` (major) | fixed: Save asks "Move {title} to {calendar}?" / "It will be copied there and removed from {old calendar}." / "Move", "Cancel" (`move_confirm_*` in `strings_events_editor.xml`, `EditorState.moveConfirmation`, `MoveConfirmDialog`), after the span question as on Apple; Cancel keeps the editor open with nothing written. Not asked within an account, for new events, or for "this event only" on a series (the repository refuses a calendar change for one occurrence). `EditorStateTest.aMoveToAnotherAccountAsksFirst`, `EventEditorScreenTest.aCalendarInAnotherAccountAsksBeforeTheMove`, `aCalendarInTheSameAccountSavesAtOnce` |
| 2 | both-dates labels wrote "Gregorian:" with a colon (minor; QA finding 15) | fixed in the Windows form (§2.20): `both_dates` "%1$s. Gregorian %2$s", `weekday_strips_a11y` "%1$s: %2$s. Gregorian %3$s.", and the Gregorian-first `both_dates_gregorian_first` "%1$s. %2$s %3$s" ("Monday, October 19, 2026. IFC Thursday, October 12, 2026"). Unchanged, as Windows writes them: the Gregorian-primary plate's name "Gregorian {date}. IFC: {date}" (no colon after "Gregorian") and Compare's visible Friday 13th caption "Gregorian: Feb 13, Mar 13, Nov 13" (a count caption, not a date label). Assertions updated in `PhrasingTest`, `YearModeTest`, `FontScale200Test`, `DayDetailScreenTest`, `TodayScreenTest`, `ConvertScreenTest` |
| 3 | Month day list rows lacked the repeat (minor) | fixed: in the selected day's list and the "+N more" list a repeating row's second line adds " · " and core's `describe` of its series ("until 10:30 · Every 2 weeks on Monday", "Raamatukoi · Every IFC month on the 12th", board A1), read once per series and change (`RepeatTexts.kt`, as Apple's `RepeatDescriptions`). List, Up next and the day sheet are unchanged (board J2 has no repeat there; web shows it in Month only). `MonthModeTest.theSelectedDaysRowsSayTheRepeat`, `MonthModeMoreTest.hiddenItemsAreCountedAndOpenTheDay` |
| 4 | bars were a plain fill, without the 2 px edge (minor) | fixed: `MonthBar` draws a 2 dp edge in the calendar color on its leading side, clipped to the rounded start, and none where the bar continues from before its row (as web's `.notchStart` and Windows' `EventChipVisual`). The same component draws Week and Day's all-day bars and the intercalary band, as on web and Windows. `MonthBarEdgeTest` (pixels) |
| 5 | a gregorian-only calendar showed the 28-day footer and the Exchange note under it (minor) | fixed: the 13-month section's footer is the Exchange note alone on those calendars, as Apple's `RepeatPickerLogic.thirteenFooter`. `EventEditorScreenTest.anExchangeCalendarsThirteenFooterIsTheExchangeNote` |
| found on the device | the repeat text of issue 3 did not appear on the emulator although the JVM tests passed: every draggable item (`eventDragSource`) kept its first drawing when something inside changed without changing its size. Foundation's default drag shadow painter records the content once per size (a `CacheDrawModifierNode`) and draws that recording in place of the content, so the repeat text, which arrives after the first frame, stayed unseen until the row was composed again (switching days showed it) | fixed: `eventDragSource` records the content into a graphics layer on every draw, draws that, and gives it to the `dragAndDropSource(drawDragDecoration, block)` overload as the shadow. A long-press drag still moves an event on the emulator ("Event moved to Friday, October 13, 2026." with Undo). `DragSourceRedrawTest` (pixels: a row's drawing changes when its text changes in place; it fails without the fix). By the same mechanism any in-place change of a draggable chip, row or block that kept its size would have stayed stale (a title or color changed while it was on screen, the "Now" plate coming or going); those cases were not checked one by one |
| 6 | `SystemData.kt` said the history text keeps an en dash; the `d9-*` shots are gone and `docs/screenshots/android-*.png` predate the fixes (minor) | comment corrected ("skipping 3 to 13 September", no dash, as the text and the other engines). Screenshots not retaken: they are retaken at release (owner's note) with the demo-mode procedure of android/README.md; "Screenshots" above says so |

Suites and builds on the final code (2026-10-27, EET, from `android/`, `JAVA_HOME` as above,
`THIRTEEN_PERF_SCALE=3`; host load average 90 to 600 from other work):

| What | Command | Result |
|---|---|---|
| Engine | `./gradlew :core:test --rerun` (after the `SystemData.kt` comment, the only `:core` change) | 80 tests, 0 failures (04:39) |
| JVM app suite | `./gradlew :app:testDebugUnitTest` | 421 tests in 63 classes, 0 failures, 0 skipped (05:01, final code); 420 in 62 at 04:40 before the drag source fix |
| `ReviewFindings*` | in the suites above and below | `ReviewFindingsDataTest` 10 of 10, `ReviewFindingsDataProviderTest` 3 of 3; all still show real bugs, none deleted |
| Lint | `./gradlew :app:lintDebug :app:lintRelease` (analysis re-run on the final code) | "No issues found." for debug and release |
| R8 release build | `./gradlew :app:assembleRelease` (`minifyReleaseWithR8` re-run) | BUILD SUCCESSFUL; `app-release-unsigned.apk` 2.9 MB |
| Instrumented suite | `am instrument -w -r com.haugas.thirteen.test/androidx.test.runner.AndroidJUnitRunner` on `Thirteen_Phone` (API 37, emulator-5584, headless, 24-hour time) | `OK (41 tests)` on the build before the drag source fix (50.9 s) and again on the final APK (114.7 s) |

Device checks on the same emulator with the mockup data set (`--ez thirteen.qa.fakeEvents true`,
today 2026-10-19); screenshots in `/tmp/thirteen-acpf/shots/`:

- 1: Dentist, Dr. Tamm, Calendar Home to Work, Save: "Move Dentist, Dr. Tamm to Work?", "It will be
  copied there and removed from Home.", "Move", "Cancel" (`phone-move-confirm.png`); Cancel left the
  editor open with Work chosen; Save then Move closed it with "Event saved." and the details read
  "Work, liis.kask@example.com".
- 2: Year at expanded width, the cells' names read "Thursday, January 5, 2026. Gregorian Monday,
  January 5, 2026" (UI dump).
- 3: compact Month on IFC October 12: "until 10:30 · Every 2 weeks on Monday", "until 11:30 · Every week
  on Monday", "Raamatukoi · Every IFC month on the 12th", Dentist "Tartu mnt 18" alone
  (`phone-month-fixed.png`, as board A1); before the drag source fix the same screen showed only "until
  10:30" (`phone-month-today.png`).
- 4: Month with the display at 2560 x 1600, 320 dpi (reset afterwards): every bar starting in its row
  has the 2 dp edge in its calendar color (Rent, Team offsite, Autumn school break, Recycling pickup,
  Payday, Halloween); the Autumn school break's continuation in the next row is notched with no edge
  (`expanded-month.png`, `crop-start.png`, `crop-cont.png`).
- The drag source fix: a long-press drag of the Dentist row onto IFC October 13 still moves it ("Event
  moved to Friday, October 13, 2026." with Undo, `phone-drag.png`).


## Gates that need the owner's devices or accounts

None of these can run on emulators with LOCAL calendars. §8.3 item 2 counts a gate whose fallback shipped
as passed, so each row says what ships if the gate stays unrun, and whether that is in the code now.

| Gate | Needs | Ships if it stays unrun | In the code now |
|---|---|---|---|
| V2 (Android leg) | a Google account on an iPhone and an Android device | Apple-made `BYYEARDAY` series read-only except their alerts | yes (`BYYEARDAY_ALERTS_ONLY = true`) |
| V3 | a Google account, an Android device with Google Calendar, an iPhone | the detached fallback for "this event only" on `RDATE` series, `repeat.note.androidReencode.firstOnly`, the support FAQ line | yes (`RDATE_EXCEPTION_ROWS = false`) |
| V4 | an Exchange or Microsoft 365 account on an Android device | the gate stays; the §2.13 Outlook notes keep their text | nothing to switch |
| V5 (Android leg) | two Google accounts on one device | the §4.7 fallbacks stay on | as built: a move copies every exception row and part in one batch (§4.7); D8 checked it on LOCAL accounts |
| V9 | two Android devices on one Google account | the §4.4 behaviour without the marker | yes (rows without a marker are read from their stored dates) |
| V10 | a Google account and sync | the UTC form, parts of at most 210 values | yes (`TIMED_DATE_LIST_FORM = UTC`, `PART_SIZE = 210`) |
| V14 | a Google account and sync | "On the day at 09:00" hidden | yes (`AlertPickerPage`) |
| V18 | a Pixel with only Google Calendar and a Samsung with Samsung Calendar | the `ReminderReceiver` fallback and its copy | yes (`THIRTEEN_CALENDAR_ALERTS = true`; review pass of 2026-10-20; `ReminderReceiverTest` since 2026-10-27, the provider's alert rows not driven by a test) |
| V20 | a Google invitation on a device | `alarmsEditable = false` for Google invitations | yes (`INVITEE_ALERTS_GOOGLE = false` in `ProviderMapping.alarmsEditable`; review pass of 2026-10-20) |
| V21 | Google Calendar and Samsung Calendar on devices | "Open in calendar app" hidden where nothing resolves `ACTION_VIEW` of `Events/{id}` | yes (`ExternalCalendarIntents.canHandle`) |
