# Apple verification gates

The Apple team's record of the verification gates of [docs/EVENTS.md §8.2](../EVENTS.md#82-verification-gates)
(V1, V2's EventKit leg, V4 to V8, V16, V20 to V23; the index is [README.md](README.md)). Each run is
recorded under its gate as README.md "How to record a run" describes. The phase 0 probe run of V1 and V23
(macOS 27, iCloud) is in [phase0.md](phase0.md).

## Status

| Gate | Status | In force until it passes |
|---|---|---|
| V1 | partial: phase 0 passed the Mac EventKit leg on iCloud ([phase0.md](phase0.md)); iCloud.com, a Calendar.app edit and a second iPhone not run | in a release, iCloud calendars are `gregorian-only`; development (Debug) builds keep form (b) on iCloud (§8.2 "Phase 0 results"); no footer sentence in either (`CalendarSourcePolicy.gates.v1ICloud = false` and `CalendarSourcePolicy.Build`, apple/Shared/Events/CalendarStore.swift) |
| V2, EventKit leg | not run (owner: Google Calendar web only for now, §8.2) | in a release, Google calendars are `gregorian-only`; development builds keep form (b); no `repeat.footer.appleGoogle` in either (`v2GoogleEventKit = false`) |
| V4 | not run | Exchange is `gregorian-only` with one alert in every build (§3.4) |
| V5 | not run | the 1013 fallbacks of §4.7 (`CalendarStoreError.moveNeedsCopy`) |
| V6 | incidental finding in phase 0 (all-day events got the account's default alert) | |
| V7 | not run | |
| V8 | not run | the request stays on the store actor |
| V16 | not run | the two-step all-day save of §4.7 (`EventKitStore.saveThisEvent`) |
| V20 | not run | invitation alerts are read-only (`v20InviteeAlarms = []`) |
| V21 | not run | |
| V22 | not run | write-only saves are checked as the strictest account, Exchange's `gregorian-only` and one alert (`writeOnlyCalendar(id:)`, Review fixes below) |
| V23 | documented for macOS 27 on iCloud in phase 0; iOS and Google not run. The simulator runs below match it on iOS 26.5 for a local calendar | the count check of §4.7, which also treats a missing rule as a wrong end; `span.future.exceptionsLost` on every Apple calendar |

## Prerequisite: EventKit tests in an iOS Simulator (task A2)

Not a gate: the automated checks of §6.2 that run against EventKit's real calendar store before the
manual gates, `EventKitExpansionTests` first (before V1, risk R1), then `EventKitRoundTripTests` and
`EventKitMappingTests`.

- **When:** 2026-10-20 01:21 to 01:26 EEST (Europe/Tallinn), by the A2+A3 agent; rerun 01:51 to 01:54
  EEST with the alerts and changed-occurrence test added.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work; apple/Shared/Events and
  apple/EventKitTests.
- **Tools:** Xcode 27.0 (27A266a) on macOS 27.0.1 (26A434).
- **Device:** a private simulator made for the run ("Thirteen EventKit", iPhone 17 Pro, iOS 26.5
  runtime 23F77), deleted afterwards; its local calendar store only (the "Default" local source), no
  accounts. Calendar access granted with `xcrun simctl privacy <udid> grant calendar
  com.haugas.thirteen`; no prompt, no Mac calendar data touched. Device zone Europe/Tallinn.
- **Command:** `apple/scripts/eventkit-tests.sh` (builds the scheme "Thirteen EventKit Tests" with
  `-derivedDataPath /tmp/thirteen-dd-eventkit`, runs ThirteenEventKitTests hosted in the iOS app).
- **Result: pass.** `Test run with 15 tests in 3 suites passed after 10.732 seconds`, `** TEST EXECUTE
  SUCCEEDED **` (the first run: 14 tests, 14.356 seconds).

**Rerun 2026-10-26** (21:02 to 21:36 EET, by the A2+A3 agent, against the v3.3 engine and fixtures; the
same tools, runtime, zone and script, `DERIVED_DATA=/tmp/thirteen-dd-A2A3-eventkit`, each run in a new
private simulator deleted afterwards). Two tests were added: `thirteenMonthFormsReadBackAsSaved` (nine
form (a), (b) and (c) series saved through `EventKitStore` and read back through `event(key:)` and
recognition) and `allDayRepeatEndsReadBackOnTheirDay` (below).

- First run: **fail**, `Test run with 16 tests in 3 suites failed after 9.650 seconds with 8 issues`.
  Every all-day repeat with an end read back one day late in Europe/Tallinn: "Leap Day until 2040"
  read as until 2040-06-18, and the all-day "Every Leap Day" series (end Never, stored on its cap) and
  a count of 5 from 2088 were not recognized as Leap Day repeats (an end of 2096-06-18 is past the cap,
  so §4.5 step 3 does not apply). The timed series were right.
- Cause, measured (`allDayRepeatEndsReadBackOnTheirDay`, weekly all-day series from Monday 2026-10-19
  with six end instants on 2026-11-09): EventKit stores the end instant's date **in the device's zone**
  (local 00:00, 12:00 and 23:59:59 and UTC 00:00 and 12:00 all became `UNTIL=20261109`; UTC 23:59:59,
  which is 01:59:59 on 2026-11-10 in Tallinn, became `UNTIL=20261110`) and returns it as **that date at
  23:59:59 UTC** (`2026-11-09T23:59:59Z`), which is 01:59:59 on November 10 in Tallinn. Phase 0 saw the
  same on macOS 27 with iCloud (`UNTIL=20960617`, description `UNTIL=20960617T235959Z`). The app read
  the end as its date in the device's zone, so every zone east of UTC got the next day. Thirteen's
  write (23:59:59 of the until day in the device's zone) was right. A floating timed series (no zone)
  keeps a UTC `UNTIL` (`UNTIL=20261109T215959Z` for 23:59:59 Tallinn time) and reads back as written.
- Fix: `RecurrenceMapping.untilValue` reads an all-day end at 23:59:59 UTC as its UTC date (any other
  instant, an end not stored yet, as its date in the device's zone); `RecurrenceMappingTests` check it
  in Tallinn, New York, Kiritimati, Pago Pago and UTC.
- Final run: **pass**, `Test run with 17 tests in 3 suites passed after 8.456 seconds`, `** TEST EXECUTE
  SUCCEEDED **`. Forms read back: IFC yearly on November 12 and Year Day (form (a)) as Gregorian yearly
  rules listing the 13-month rule as an alternative (9 and 3 occurrences); Rent (all-day, count 5),
  Book club (09:00 Tallinn, until 2026-04-01) and every 2 IFC weeks on Friday (form (b)) as `byyearday`
  with their ends (5, 3 and 78 occurrences); every IFC Leap Day (all-day) and every Positivist Festival
  of Holy Women (09:00 Tallinn) from 2028 with end Never as `leap-interval`, end Never, 18 occurrences
  each, stored with interval 4 ending on the 2096 cap; Leap Day until 2040 as `leap-interval` until
  2040-06-17 (4); Leap Day 5 times from 2088 as `leap-interval`, end Never, 3 occurrences (the count was
  written as `UNTIL` on the cap, §4.3 c). `EventKitExpansionTests`: 81 cases, 124,986 dates, all equal
  again; the count check, "Save for all events", the alerts and the dates before 1583 recorded as on
  2026-10-20.

### EventKitExpansionTests: the daemon's expansion of forms (b) and (c)

Every form (b) (`BYYEARDAY`, 76 cases) and form (c) (leap interval, 5 cases) case of the `thirteenRules`
section of fixtures/events.json was saved through the app's mapping (`EventKitMapping.apply`, all-day,
`EKRecurrenceRule(.yearly, ..., daysOfTheYear:)` or interval 4 with the cap as
`EKRecurrenceEnd(end:)`) into a new local calendar, read back with `events(matching:)` in pieces of four
years, and compared with the engine's `expandRecurrence` (which stops a leap-only repeat at its cap).
Window: 2024 to 2104, or from the start year when it is later (starts in 2104, 9904, 9990 and 9998, up to
the last year the fixture lists, 9999 included). The fixture's own `datesIn` were compared for every
listed year inside the window as well.

**Result:** 81 cases, 124,986 dates, every one equal. EventKit's expander agrees with the engine and with
Foundation's `Calendar.RecurrenceRule` (FoundationRecurrenceOracleTests in ThirteenKit) for every
encoding, including the leap caps 2096 and 9996, a start on 0001-01-01 and occurrences in 9999.

### EventKitRoundTripTests: what EventKit stores and returns

Saved through `EventKitStore`, read back through a new `EKEventStore`:

- **All-day ends (pins the read rule of §3.3).** One-day (2026-10-19), three-day (2026-10-19 to 21) and
  across Year Day (2026-12-30 to 2027-01-01) events, written with `startDate` = the first local instant
  of the first day and `endDate` = the first local instant of the last day: EventKit returns `startDate`
  at local midnight and `endDate` **86,399 s after the last day's first instant** (23:59:59 of the last
  day). The last day is therefore the local date of `endDate - 1 s`; all three read back with their days.
  A timed event 22:00 to 24:00 reads back as 22:00 to `T24:00` in Europe/Tallinn.
- **Title-only save of a form (b) series.** "Every IFC month on the 12th", 19:00 Europe/Tallinn from
  2026-01-12, title changed with "future events" on its first occurrence: `recurrenceRules` were not
  assigned, and the stored rule kept `.yearly`, interval 1, the same 13 `daysOfTheYear` and no end; all
  13 occurrences of 2026 have the new title.
- **"Future events" on a `COUNT=10` weekly series at its 4th occurrence** (19:00 from Thursday
  2026-10-22, split on 2026-11-12):
  - repeat kept: head 3, new series `RRULE FREQ=WEEKLY;INTERVAL=1;COUNT=7`, 7 occurrences; the count check
    made **no** second save.
  - End repeat set to After 3 times: the new series ended with 3 occurrences
    (`FREQ=WEEKLY;INTERVAL=1;COUNT=3`), but only after the count check's **second save** (EventKit's
    own split did not leave 3). This matches phase 0's V23 finding on macOS 27 (EventKit counts the
    chosen 3 from the original start), so §6.2's "(no corrective save)" does not hold on iOS 26.5
    either; the test records the second save instead of asserting its absence.
- **"Save for all events"** on a repeat the Custom editor cannot express (`FREQ=MONTHLY;BYDAY=1MO,3MO`
  from 2026-05-04 19:00, `editable: false`), from its 5th occurrence (2026-07-06) with a new time of
  20:30: one series (one `eventIdentifier`), its first date 2026-05-04 kept, and all five occurrences
  from May 4 to July 6 at 20:30. The same series with its first occurrence deleted
  (`remove(_, span: .thisEvent)`): the snapshot's `firstOccurrenceIntact` is false, "Save for all
  events" throws `.firstOccurrenceGone` (`span.keep.firstGone`), and "this event only" still saves.
- **`BYWEEKNO` is not expanded by EventKit.** §6.2 names a `BYWEEKNO` series for the test above, but
  `FREQ=YEARLY;BYDAY=MO;BYWEEKNO=20` from 2026-05-11 (the `seriesEdits` fixture's series) is stored as
  `RRULE FREQ=YEARLY;INTERVAL=1;BYWEEKNO=20;BYDAY=MO` and EventKit returns **only its first occurrence**
  for 2026 to 2030 (the engine: 5, May 11, 2027-05-17, 2028-05-15, 2029-05-14, 2030-05-13); so does
  `FREQ=YEARLY;BYWEEKNO=20`. Rules EventKit does expand like the engine: `FREQ=MONTHLY;BYDAY=1MO,3MO`
  (112 dates) and `FREQ=YEARLY;BYMONTH=5;BYDAY=2MO` (5 dates). On Apple a `BYWEEKNO` series made in
  another app therefore shows one date (§4.8 "shows the occurrences EventKit returns"); the test uses the
  monthly rule instead.
- **A detached occurrence gets a new `eventIdentifier`.** A weekly `COUNT=5` series (07:00 from
  2026-11-02) with alerts saved for its 2nd occurrence only (`saveAlarms(_, span: .thisEvent)`): that
  occurrence becomes detached and its `eventIdentifier` becomes the series' identifier plus `/RID=` and a
  number, so its key changes; the other four keep theirs. §3.2's re-find ("match `eventIdentifier` and
  `occurrenceDate`") therefore compares the series part of the identifier (`EventKitMapping.sameSeries`):
  the key read before the change still finds the occurrence, and the found snapshot carries the new key.
  The same test checks that a changed occurrence after an occurrence is found
  (`hasChangedOccurrences(after:)`, `span.future.exceptionsLost`) and none after the last change, and that
  a delete made through another `EKEventStore` makes the open editor's `refresh()` fail
  (`editor.deletedElsewhere`).
- **Dates before 1583 (§3.1.1, recorded, not asserted equal to other platforms).**
  - An all-day event saved on proleptic 1500-03-01 reads back as proleptic 1500-03-01 through
    ThirteenKit's arithmetic; Foundation's `.gregorian` calendar calls the same instant 1500-02-20 (Julian).
  - A yearly all-day series saved from proleptic 1248-06-17 (Julian 1248-06-10): EventKit's first
    occurrence is proleptic 1248-06-17, but it repeats on the **Julian** month and day: 1582-06-20
    proleptic (Julian June 10), then **June 10** in Gregorian years: 1583-06-10, 2026-06-10. Thirteen shows
    what EventKit returns (2026-06-10) and treats every occurrence as `historical` (read-only), because
    the series starts before 1583.

### EventKitMappingTests: unsaved events

`EKEvent(eventStore: EKEventStore())` in the simulator: each field group alone changes only its own
properties, and an unchanged repeat keeps the same `EKRecurrenceRule` object; forms (a) to (c) become
`.yearly`, `.yearly` with `daysOfTheYear`, and `.yearly` interval 4 ending at 23:59:59 of the cap day;
all-day dates 1500-03-01, 1582-10-04, 1582-10-15 and 1583-01-01 write the proleptic midnight and read back
unchanged; a timed 1583-01-01 event in Europe/Tallinn keeps its wall clock; display alerts map both ways
and Apple's "no alert" placeholder (1976-04-01T00:55:45Z) is not an alert. EventKit returns alarms in
its own order (an absolute alarm before a relative one), so alert lists are compared as sets.

## The QA seed in a simulator (task A4)

Not a gate: a check that `-ThirteenQAEvents seed` (Debug builds) fills EventKit's local store with the
mockup data set and that the app reads it back as it reads the fake store.

- 2026-10-20, iOS 26.5 simulator (iPhone 17 Pro, private device, erased first), Debug build, access
  granted with `xcrun simctl privacy <udid> grant calendar com.haugas.thirteen`, launched with
  `-ThirteenQAEvents seed -ThirteenFixedToday 2026-10-19 -ThirteenQACalendarMode day`: Day mode on
  2026-10-19 listed Autumn school break, Sprint planning 09:30, 1:1 with Marta 11:00, Dentist 15:40
  and Book club 19:00, the same five occurrences as `-ThirteenQAEvents fake` (the three repeating ones
  expanded by EventKit). A relaunch did not seed again.
- The first run (on a new simulator) made two "Thirteen QA" calendars: the launch and the first scene
  activation both read access and both seeded. Fixed (`EventsModel.seedOnce()`, one
  seed task per launch) and checked with the erased simulator above.
- The simulator was deleted afterwards.

## Events model, commands and undo: re-check (task A4)

Not a gate: a re-check of `EventsModel`, `AppModel`, the commands, deep links and `EventUndo` against
spec v3.3 and the current tree. 2026-10-26, Xcode 27, macOS unit tests (`ThirteenAppTests`, the fake
store) and iOS 26.5 simulators (private devices, deleted afterwards).

- **Found and fixed:**
  - On the Mac, File > New Event (⌘N) was missing. `ThirteenApp` added an empty
    `CommandGroup(replacing: .newItem) {}` after `ThirteenCommands`, and a later replacement of the
    same group wins: a throwaway SwiftUI app with the same command order had an empty File menu, and
    without the empty group it showed "New Event ⌘N", "Close" and "Close All". The empty group is
    gone (the Mac app's own menu was not read: that would need accessibility access for a reader).
  - A `thirteen://new-event` link at a cold launch could run before the window had read access, so
    with access refused earlier it passed for a refusal at the prompt and showed nothing. `start()`
    is now shared and `newEvent` waits for it, so the denied alert shows.
  - The Year dots cache was keyed on the number of pending changes: undoing one move and making
    another showed the first move's dots. It is keyed on a revision of the pending changes now.
  - ⌥⌘K at compact width toggled a sidebar that is not there; it opens the Calendars sheet now.
  - The Calendar day was not remembered per window (only the mode was, §2.1). It is stored in
    `@SceneStorage` while it is not today; a deep link that opened the window and
    `-ThirteenFixedToday` win over it.
  - "Changes that couldn't be saved" was a sheet everywhere; it is a popover on iPad (regular width)
    and Mac, as §2.11 says, and a sheet on iPhone and at accessibility sizes.
- **Unit tests:** 258 tests in 21 suites passed, including the new `yearMarksFollowEveryPendingChange`,
  `aSecondStartWaitsForTheFirst`, `aBurstOfStoreChangesIsCoalesced`,
  `newEventAtAColdLaunchReadsAccessFirst`, `calendarsListCommand` and `calendarDayIsRememberedPerWindow`.
  The first four failed with the fixes reverted. The coalescing test records what the model does: ten
  changes at once are two refreshes (the first change, then one for the nine that arrived while it
  ran), never ten.
- **UI tests** (`scripts/ui-tests.sh`): on iPad, `AccessibilityUITests/testKeyboardShortcuts` (⌃⌘1 to
  ⌃⌘5, ⌘→, ⌘T, ⌘N, ⌘E) passed; on iPhone, all 12 `CalendarFlowsUITests` passed (create, future events,
  delete and Undo from the toast, drags, the Calendars list, access cards, Settings). The rest of
  `ThirteenUITests` was not run in this re-check.

## Today, calendars and access (tasks A8 and A9)

Not gates: checks of Up next, the day sheet's events, the Mac menu bar line, the Calendars list, the access
cards and Settings > Calendar, with the fake store (`-ThirteenQAEvents fake -ThirteenFixedToday 2026-10-19`,
the mockup data set at 09:41 Tallinn time) and once against EventKit in a simulator. 2026-10-20, iOS 26.5
simulators (iPhone 17 Pro and iPad Pro 13-inch, private devices deleted afterwards), Debug builds; the Mac
only with the fake store (`-ThirteenQASnapshot YES` renders of the menu bar preview, Settings and the sidebar).

- **Unit tests** (`ThirteenAppTests`, macOS): `UpNextTests` pin board B1 (Today: Autumn school break "All
  day" / "Day 1 of 7", Sprint planning 09:30 with Now, 1:1 with Marta, Dentist "Tartu mnt 18", Book club;
  Tomorrow: Yoga; "5 more in the next 7 days"), the §2.20 row names ("15:40, Dentist, Dr. Tamm, Home,
  Tartu mnt 18"), ended events dropping off, "Nothing else today.", "No events in the next 7 days.",
  multi-day events once, the day sheet's rows, and the menu bar line ("Next: 11:00 1:1 with Marta" at
  09:41, "Next: 19:00 Book club: Cotsworth" at 18:00, none at 19:30). `CalendarsAccessSettingsTests` pin
  the collapsed header ("1 calendar, 1 shown"), Hide All / Show All, the stored collapsed groups, the
  Settings values and actions, the card texts, and the contrast of the card buttons and the tab bar
  selection colour in every theme.
- **UI checks** (a throwaway XCUITest target in a private copy of the tree, not in the project; the
  `ThirteenUITests` target is task A10): Up next rows open details; "+" opens the editor; "Show All in
  Calendar" opens Calendar; the day sheet's rows, "New Event" and "Open in Calendar" close the sheet and
  then open details, the editor or Day mode; "Continue" on the not-asked card asks and the rows appear;
  the one-line link expands into the card; "Open Settings" opens the Settings app; "+" while denied shows
  the alert with Open Settings and Cancel; the Calendars sheet hides Work (its rows leave Up next),
  turns Hide All into Show All, and collapses iCloud to "2 calendars, 2 shown"; turning "Show my events"
  off hides the other Settings rows. All passed.
- **EventKit in the simulator**: with `xcrun simctl privacy <udid> reset calendar com.haugas.thirteen` the
  app (EventKit store) showed "See your events in 13 months" with Continue; after `revoke`, "Calendar
  access is off" with Open Settings; after `grant`, Up next read "No events in the next 7 days." and the
  Calendars list showed the simulator's own calendars: "Calendar" under "DEFAULT" (the simulator's local
  source is titled "Default"; a device says "On My iPhone") and "Birthdays" under "OTHER" with the Read
  only tag.
- **Tab bar contrast** (leftover of the redesign review). The iPhone tab bar draws the selected tab in
  the tint over its own glass, whose selection pill is much lighter than the paper in dark mode.
  Measured on screenshots (selected "Today" label's darkest or brightest glyph pixel against the pill
  around it, iPhone 17 Pro, Today on the mockup day):

  | Theme | Control tint (before) | Accent text (now) |
  |---|---|---|
  | Almanac light / dark | 5.50 / 3.79 | 5.50 / 5.41 |
  | Graphite light / dark | 6.97 / 3.91 | 6.97 / 5.91 |
  | Slate light / dark | 6.34 / 4.49 | 6.34 / 5.82 |
  | Forest light / dark | 6.31 / 4.36 | 6.31 / 6.83 |
  | Mono light / dark | 12.44 / 4.56 | 12.44 / 10.21 |
  | Obsidian | 4.19 | 5.62 |
  | Midnight | 4.39 | 7.36 |
  | Phosphor | 4.56 | 7.80 |

  The tab bar now takes `accentText` (no token changed); each tab's content keeps the control tint. In
  Mono dark the selected label is now white like the others, as in Mono light, where it already was
  ink: the selection shows by the pill, as Mono marks by weight and outline rather than colour.

### Re-check against spec v3.3 and the boards (tasks A8 and A9, 2026-10-26)

Debug builds from the current tree, the fake store only (`-ThirteenQAEvents fake -ThirteenFixedToday
2026-10-19`): a private iOS 26.5 simulator (iPhone 17 Pro, deleted afterwards) and the Mac app through
`-ThirteenQASnapshot YES` renders. Screens compared with boards B1, D1, E1 and E2 rendered from
`design/events/mockups.html` with headless Chromium. Screenshots: `/tmp/thirteen-shots/apple/ios-*.png`
and `macos-*.png` (not committed; the `docs/screenshots` set is retaken at release, task A12).

Found and fixed:

- **Mac menu bar, no next event.** With no timed event left today, the empty "Next:" line still took a
  slot in the popover's stack and added a gap under the date. Measured by rendering 2026-10-22 (no timed
  events) beside the same day with "Show my events" off: the two renders differed from the numeral down.
  The line now sits with the date in a stack without spacing and pads itself only while it shows; the
  two renders are now identical and the 09:41 render still reads "Next: 11:00 1:1 with Marta".
- **Mac menu bar without the main window.** The events model was started only by the main window, so a
  launch that restored no main window (closed when the app last quit) never showed the line. The menu
  bar content now calls `events.start()` too (shared and idempotent; it only reads the access status).
- **Day sheet, empty day** (§2.9 "On days with no events the section shows 'No events.' and 'New
  event'"): "Open in Calendar" was shown on empty days too; it now shows only when the day has events,
  as the web's `DayEvents` does.
- **All calendars hidden.** The day sheet said "No events." with every calendar hidden; it now shows
  "All calendars are hidden." with "Show Calendars", like Up next (§2.4 States). Both buttons opened
  the Calendars sheet at every width; they now open the list where the layout keeps it
  (`AppModel.showCalendarsList()`: the sheet at compact width, the sidebar under Calendar at regular
  width, §2.4 States).
- **Calendars sheet with full access and no calendars** showed only the footer; it now shows the "No
  calendars yet" card (§2.16), as Calendar's modes do.
- **Board B1 and D1 details**: Up next and day sheet row dividers run the full card width, and a
  collapsed group's "1 calendar, 1 shown" is in Geist Mono.

Checked and unchanged: Up next against B1 (groups, rows, the Now plate, "5 more in the next 7 days");
the Calendars sheet against D1 (order iCloud, Google, Subscribed, Other; Hide All; Read only; the iOS
footer); the access cards against E1 and E2; Settings > Calendar on iPhone and Mac ("Show my events"
first, then Calendar access, Default calendar with "New events go to Home.", Show events in Year view);
the copy against §2.19 (Apple title case on buttons). Leftovers of the redesign review: `Phrasing` reads
"3 days behind the real one" (pinned by `shiftBehindHasNoOf`), the tab bar takes `accentText` (pinned
by "Tab bar selection colour reaches 4.5:1 on every paper"), and apple/README.md's icon section
describes "Page 13" with the Mac's `AppIcon.icon`.

Re-measured by task A10 on 2026-10-26 (iPhone 17 Pro, iOS 26.5, Almanac light, a UI test screenshot of
Calendar): the selected "Calendar" label `#a73100` on its pill `#ede7d9` is 5.53:1 (5.50:1 in the table above).

## Event details and the editor in an iOS Simulator (task A7)

Not a gate: the automated checks of §6.2 for the details and editor flows, on the fake store
(`-ThirteenQAEvents fake`, the mockup data set): no EventKit, no calendar access, no privacy prompt.

- 2026-10-20, Debug build, iOS 26.5 simulators made for the run ("Thirteen A7 iPhone", iPhone 17 Pro;
  "Thirteen A7 iPad", iPad Pro 13-inch (M5)), `xcodebuild test -scheme "Thirteen UI Tests"
  -only-testing:ThirteenUITests/EventEditorUITests` (`apple/scripts/ui-tests.sh` does the same in a
  simulator of its own): iPhone 8 of 8 passed; iPad 7 passed and 1 skipped
  (`testSwipeDownAsksBeforeDiscarding`: the iPad editor is a form sheet or popover, which a tap
  outside closes, not a swipe). The tests open the screens with the Debug launch arguments
  `-ThirteenQAOpenEvent`, `-ThirteenQAEditEvent` and `-ThirteenQANewEvent` and check: an
  invitation's details ("Open in Calendar", "Edit Alerts", no Edit, Duplicate in the More menu, both
  dates, the read-only notice) and its alerts-only editor; Duplicate as an unsaved "New Event" with
  "Add" and no repeat; "Save for This Event Only" in the span dialog and the "Event saved." toast;
  the 13-month date picker moving Starts and, with it, Ends; the repeat picker's checked row, its
  "Next:" line and the Gregorian presets; Cancel and a swipe down asking before a changed draft is
  discarded (and not for an unchanged one); an invalid URL stopping the save with its message; and
  no en or em dash in any text on those screens (§2.19).
- The same day, `ThirteenAppTests` on macOS (`THIRTEEN_PERF_SCALE=3`): 246 tests in 20 suites
  passed, among them `EventEditorStateTests` (the editor's state on the fake store: validation,
  out-of-range dates, the later-events line, repeat re-derivation and its notices, the three-way
  merge banner, the conflict and span questions with `span.keep.firstGone`, all-day Free, alert
  trimming on a calendar change; write-only mode has no test of its own) and `EventEditorPickerTests` (the 13-month date field's
  1583 floor and leap-year stepping, the repeat picker's rows and notes, custom repeat, the
  same-account rule of the calendar picker, and the §2.19 strings without dashes).
- Found and fixed on the way: a dismiss attempt (swipe down) never reached the editor until its
  delegate bridge waited for the sheet to be presented; the compact time field had no width; details
  fell back to a sheet in Calendar on iPhone because Month is pushed over the section's root; on iPad
  the date picker was a half-height sheet inside the form sheet and is now a popover.
- Not covered here: VoiceOver and Full Keyboard Access walk-throughs, the Mac popover (only built),
  and the editor's EventKit saves (the store's paths are in `EventKitRoundTripTests` above).
- Both simulators were deleted afterwards.

## Calendar modes and drag and drop (tasks A5 and A6)

Not gates: checks of the five Calendar modes (§2.1 to §2.7) and of drag and drop (§2.4, §2.11 "Drag
edits") with the fake store (`-ThirteenQAEvents fake -ThirteenFixedToday 2026-10-19`). 2026-10-20, iOS 26.5
simulators (iPhone 17 Pro and iPad Pro 13-inch M5, private devices deleted afterwards), Debug builds; the
Mac only with the fake store, through `-ThirteenQASnapshot YES` renders (Liquid Glass, the selected
segment and the sidebar list are not drawn in them).

- **Unit tests** (`ThirteenAppTests`, macOS): `CalendarScreensTests` (10 tests) pin the §2.1 subtitles
  ("Gregorian Oct 8 to Nov 4", "Gregorian Oct 15 to 21", "Gregorian Monday, October 19, 2026",
  "Gregorian 2026" in Positivist only), the back titles, a month page through its intercalary days, the
  day headers, runs of empty days ("No events, October 21 to October 23") and where the accessibility-size
  list opens, the §2.20 names on the mockup data, no dash in any label, the day-list rows ("All day" /
  "Day 1 of 7", "until 10:30"), the Month density rule (titles at 60 pt and Large text) and the timeline
  geometry (15-minute snap, the hold and drag drafts, `maxSlots` 48 and 64 pt, 07:00 at the top).
  `EventMoveFlowTests` (15 tests) pin the moves: a single event held with "Event moved to Saturday,
  October 14, 2026." and Undo, a timeline drop keeping the length, a timed event dropped on the all-day row
  turning all-day, nothing for the same place, read-only events never moving, `validateDraft` refusing
  1500 ("Choose a date from 1583 to 9999."), the span question before anything moves, future events
  written at once without Undo, "Moving future events to Year Day 2026 ends the repeat. Every later event
  in this series will be deleted." with "Move and Delete Later Events" destructive, Cancel and a dismissed
  dialog leaving everything as it was, "Send Changes to 8 Invitees?", and Option-drag opening Duplicate at
  the drop (no repeat, the default calendar for a read-only source, anchored to the drop).
- **UI checks** (a throwaway XCUITest class in `ThirteenUITests`, removed after the runs; the Calendar UI
  tests are task A10): on iPhone and iPad, touch and hold on empty Day time opened the editor on 13:00 to
  14:00; dragging the Dentist block held "Event moved to 14:15."; dragging the Dentist row of iPhone
  Month's day list onto Saturday's cell held "Event moved to Saturday, October 14, 2026."; dragging Sprint
  planning asked "This is a repeating event." with "Move This Event Only" and "Move Future Events", and
  the first held the move. On iPad, a tap on a Month chip or Week block opened details in a popover on it,
  touch and hold on a Month cell or on empty Week time opened the editor in a popover on the cell or the
  draft block, and Cancel removed the draft.
- Found and fixed on the way: touch and hold on a block opened its context menu, and sliding on deleted
  the event, so iPhone and iPad items have no context menu (touch and hold drags, §2.4 and §2.6); the span
  question never showed on iPhone, because it was attached under the pushed Month and Day pages; on a Mac
  Day page the timeline opened at 00:00, because the page is briefly taller than the day at launch; the
  iPad popover on a chip near the right edge was squeezed by its forced arrow edge; the editor popover on
  a new draft block never showed until the anchor's body read the editor (EventPresentation.swift).
- Not covered here: Option-drag with a real modifier key (the copy logic is unit tested), Mac drags and
  double-clicks (no Mac UI tests), VoiceOver walk-throughs, and resizing a block by its bottom edge (not
  built).

## UI tests, accessibility pass and performance check (task A10)

Not gates: the automated checks of §6.2 task A10, the accessibility pass of §2.20 and §8.3 item 3 as far as
a simulator and the fake store reach, and the scrolling check with 1,000 events. 2026-10-26 23:25 to
2026-10-27 04:05 (EET), by the A10 agent.

- **Code:** the working tree on HEAD `7753452` plus uncommitted work.
- **Tools:** Xcode 27.0 (27A266a) on macOS 27.0.1 (26A434).
- **Simulators:** private devices of this run, "Thirteen A10 iPhone" (iPhone 17 Pro) and "Thirteen A10
  iPad" (iPad Pro 13-inch (M5)), iOS 26.5 (23F77); the EventKit script makes and deletes its own iPhone 17
  Pro. Device zone Europe/Tallinn.

Three earlier attempts of this task were cut off by server restarts (the first on 2026-10-20, the last
from 2026-10-26 23:24 to 2026-10-27 01:13). The results below are from the fourth attempt (2026-10-27
01:18 to 04:05), which built the tree again and ran every suite on it; a row says so where it quotes an
earlier run.

### What ran

| Suite | Where | Command | Result |
|---|---|---|---|
| ThirteenKit | macOS 27.0.1 | `THIRTEEN_PERF_SCALE=3 swift test --scratch-path /tmp/thirteen-kit-A10` in apple/ThirteenKit | pass: `Test run with 111 tests in 10 suites passed after 87.314 seconds` (fixtures/events.json and conversions.json parity included) |
| ThirteenAppTests | macOS 27.0.1 | `xcodebuild -scheme "Thirteen Mac" -destination platform=macOS ... CODE_SIGN_IDENTITY=- test` | pass for every suite but one: on the final tree `Test run with 285 tests in 22 suites` with `focusAfterActions` passing and no build warnings; the only failures are the 21 issues of the review agent's "Review findings: data integrity" suite (see Not covered). Before that suite was added: `Test run with 274 tests in 21 suites passed after 4.349 seconds` (01:30) |
| Mac build and smoke check | this Mac, Debug, ad-hoc signed, fake store, screen unlocked (`IOConsoleLocked` false) | `open -n -a Thirteen.app --stderr <file> --args -ThirteenQAEvents fake -ThirteenFixedToday 2026-10-19 -ThirteenQASmoke YES -ThirteenQACalendarMode month -ThirteenQAAppearance light -AppleLocale en_GB` | pass: 8 of 8 steps, `DONE all passed` (below) |
| ThirteenUITests, all but ScrollPerformanceUITests | iPhone 17 Pro, iOS 26.5 | `xcodebuild -scheme "Thirteen UI Tests" test-without-building -skip-testing:ThirteenUITests/ScrollPerformanceUITests` | pass on the final build. AccessibilityUITests, CalendarFlowsUITests, EventEditorUITests and EventKitEndToEndUITests (02:46 to 03:07): `Executed 34 tests, with 5 tests skipped and 0 failures`; CalendarLabelsUITests, CalendarKeyboardUITests and the changed `testAX5OverflowListIsASheet` (03:20): 11 passed, 2 skipped. The skipped 7 are iPad only. An earlier full run on the build before this run's fixes (01:21) got through 36 of 42 tests before a background time limit stopped it: 29 passed, 6 skipped, 1 failed (the audit, fixed below) |
| the same | iPad Pro 13-inch (M5), iOS 26.5 | the same | the full suite on the build with the focus change, before the rotor and test fixes (02:28 to 03:07): `Executed 45 tests, with 4 tests skipped and 4 failures`. The four, from the result bundle's videos and hierarchies: the rotor probe (the rotor defect, fixed below); `testAX5OverflowListIsASheet` (the tap hit a "+11" block whose lower half was below the window; the test now brings it wholly on screen); `testDragABlockToANewTime` (the long-press drag did not register on the loaded machine; the block never moved); `testPopoverEditorOnIPad` (below). Rerun on the final build (03:19): the first three pass; `testPopoverEditorOnIPad` passes with its tap-outside step as an expected failure (03:58; the open item below), after four investigation runs. The 4 skipped are iPhone only |
| Increase Contrast | both | `xcrun simctl ui <udid> increase_contrast enabled`, then `-only-testing:ThirteenUITests/AccessibilityUITests/testBlockBorderFollowsIncreaseContrast` | pass on both: with the setting on, the Day block's top edge differs from its fill by 0.83 (RGB distance; the border in the calendar colour), against 0.0 at the default contrast |
| ScrollPerformanceUITests | iPhone 17 Pro | `-only-testing:ThirteenUITests/ScrollPerformanceUITests`, with `TEST_RUNNER_THIRTEEN_PERF_EVENTS` 1000 and 0 | pass, both runs: 5 of 5 tests with 1,000 generated events (2026-10-27 03:07, load average 23 to 63) and 5 of 5 with the mockup data set alone (03:13, load average 30 to 170); numbers below |
| EventKit tests | a private iPhone 17 Pro the script makes and deletes | `apple/scripts/eventkit-tests.sh --skip ReviewFindingsEventKitTests` | pass: `Test run with 17 tests in 3 suites passed after 13.754 seconds` (EventKitExpansionTests: 81 form (b) and (c) cases, 124986 dates compared; EventKitMappingTests; EventKitRoundTripTests). An earlier run (2026-10-27 01:05) failed one parallel case with `calendarNotFound("local source")`, fixed below |
| EventKitEndToEndUITests | both A10 simulators, calendar access granted with `xcrun simctl privacy <udid> grant calendar com.haugas.thirteen` | part of the full runs above | pass on both: iPhone `testAddEditAndDeleteThroughEventKit` passed (80.362 seconds), iPad passed (76.716 seconds); the seeded local calendar read back, an added event survived a relaunch, a title edit was saved, a delete committed by the toast's Close stayed deleted |

The machine was shared with about five other agents, other projects' builds, an Android emulator and
Blender; the load average was 50 to 930 during these runs. Every timing here is slower than the app is,
and the UI tests' long waits (60 s for a first screen) are for this machine.

### Accessibility pass

What the simulator and the fake store can check, against §2.20 (the mockup data set unless said):

- **Names (§2.20 table, `CalendarLabelsUITests`)**, on iPhone and iPad: Month weekday header cells
  ("Sunday. Gregorian Thursday"); day cells with the event count, "Gregorian November begins." and the
  Today and Selected traits; the 28 cells as one stop each; the compact day list rows
  (`calendar.item.a11y`); Week and Day columns as containers named `calendar.column.a11y` (seven in
  Week) and the intercalary column, holding their blocks in start order; all-day and multi-day bars with
  the continuation flags and the other year's date; the one-day bar of a read-only calendar
  ("Halloween, all day, Holidays in Estonia, read only"); the intercalary band; "+N more" (iPad Month)
  and "+{n}" (Day) with their lists; List and Up next rows with the "Now" value; Year cell values. Month
  chips at regular width are not separate elements (the cell carries them, with its events as custom
  actions). Every screen of these tests also passes the no-dashes check (§2.19).
- **Rotor, cell actions and paging actions** (`AccessibilityUITests/testRotorCellActionsAndPagingActions`,
  read inside the app with `-ThirteenQAAccessibilityProbe YES`, because XCUITest cannot see custom
  actions or rotors): the mockup day's cell offers `[Next month|Previous month|Open Autumn school break|Open Sprint planning|Open 1:1 with Marta|Open Dentist, Dr. Tamm|Open Book club: Cotsworth|New Event]` (the day's order, then New Event); the "Events" rotor walked with "next" from that cell gives `entries 10 days 10`, Friday, October 13 (2 events) through Saturday, October 28 (1 event), every later day of the page with events, then ends; before this run's fix it gave `entries 12 days 1` (stuck on the mockup day). The paging actions give `next November 2026 previous October 2026`. The same on iPhone (02:52) and iPad (03:19).
- **Switch Control paging.** The probe invokes the grid's "Next month" and "Previous month" custom actions
  as Switch Control and VoiceOver do, and they page; on iPad the toolbar's ‹ › buttons and ⌘← ⌘→ page as
  well (`testPagingWithoutAPreciseGesture`, `testKeyboardShortcuts`), and the selected day keeps its grid
  position. Switch Control itself was not run (it needs a person and a switch).
- **Dynamic Type at AX5** (`-UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL`):
  Month is the list of days with runs of empty days ("No events, October 21 to October 23"), Week falls
  back to Day, details, the "+{n}" list, the date picker and the iPad editor are sheets (no popover), the
  editor's date and time stack, and the date picker is a list of days. The iPad sidebar is 420 pt wide at
  accessibility sizes, so section names no longer break inside words.
- **Increase Contrast** (§2.20 Contrast): with the simulator's Increase Contrast on (`xcrun simctl ui <udid> increase_contrast enabled`), chips and blocks get a 1 pt border in the calendar colour: the Dentist block's top edge reads `(0.918, 0.345, 0.047)` against its fill `(0.965, 0.820, 0.729)`, distance 0.83, on iPhone and iPad; at the default contrast the two are the same pixel (distance 0.0). The setting was turned off again afterwards
- **Keyboard.** iPad: ⌃⌘1 to ⌃⌘5, ⌘→, ⌘T, ⌘N, ⌘E (`testKeyboardShortcuts`), and in Month the arrows,
  Return into the day's events and Return to open one (`CalendarKeyboardUITests`); ⌫ holds a delete
  (`testDeleteAndUndoWithTheKeyboard`). The Mac: the smoke check below.
- **Focus after actions (§2.20), built in this run.** After Add or Save focus goes to the event's chip,
  block or row; after Delete to its day cell, or in List to the next row; after Undo to the restored
  event; after closing details to the item that opened them. `AppModel.accessibilityFocusRequest` names
  the target, and the view marked with the same popover anchor (every chip, bar, block, row and Month
  cell) takes it with `@AccessibilityFocusState` when it is on screen or as soon as it appears; an
  untaken request lapses after 3 s. `CalendarNavigationTests/focusAfterActions` checks the requests.
  VoiceOver focus itself is not visible to XCUITest and VoiceOver does not run in the simulator, so the
  focus moves are unverified until a VoiceOver run on a device. One risk to check there: on timeline
  blocks, all-day bars and Day's rows `.eventPopoverAnchor` sits before `.accessibilityElement(children:
  .ignore)`, so the focus binding may not reach the element VoiceOver focuses.
- **Xcode's accessibility audit** (`testAccessibilityAuditOfTheCalendarScreens`, Month, Day, List, Week on
  iPad, Today): passes with its documented exceptions (the test's `isKnownException`). On iPhone the
  compact Day title menu's label is sometimes given without ", Actions Menu"; the exception now matches
  both forms. Its contrast findings were measured on screenshots instead (next item).
- **Contrast measured on screenshots** (darkest glyph pixel against the background around it, Almanac
  light): text in the app's tokens is 5.30:1 or more (`ink-3` `#6b6152` on `paper` `#f4efe4` in the Month
  weekday rows, cell numbers, the day list's times and second lines; 5.68 to 5.73:1 in the iPad
  sidebar's account headers, footer and "73 days until Year Day"; accent text 5.53 to 5.59:1; the all-day
  bar's "Day 1 of 7" 7.70:1). Below 4.5:1, all in system-styled secondary text: the navigation subtitle
  ("Gregorian Oct 8 to Nov 4", iPhone `#868483`, 3.25:1; iPad toolbar `#8b8577`, 3.43:1), the iPad
  sidebar's "Today" section header (`#888789`, 3.37:1), and Form section headers and footers, which hold
  the §2.13 repeat notes ("These follow the Gregorian calendar, like every other calendar app.",
  `#868483`, 3.25:1). These take the system's secondary label colour over the paper (open item below).

### The Mac smoke check

There is no Mac UI test target (XCUITest on the Mac needs UI automation access for its runner, a privacy
prompt), so the Debug app checks itself in process with `-ThirteenQASmoke YES` (`macOS/QAMacSmoke.swift`,
started from `MacRootView`) and quits. Key presses are built as the window server builds them and sent
with `NSApp.sendEvent` inside the app; nothing is posted to the system. It needs the app in front, so it
was run only with the screen unlocked; the key steps log SKIP while another app is in front (one run here
was skipped that way and repeated). Result on the final build, 2026-10-27 03:20:

```
PASS events on 2026-10-19: Autumn school break; Sprint planning; 1:1 with Marta; Dentist, Dr. Tamm; Book club: Cotsworth
PASS Event menu: ["Edit [U+0065 mask 1048576]", "Delete [U+0008 mask 0]"]
PASS Convert, date field focused: ⌫ (U+007F) with focus on PlatformDatePicker: no delete
PASS Convert, no focus: ⌫ (U+007F) with focus on AppKitWindow: no delete
PASS Day, a date field focused: ⌫ (U+007F) with focus on NSDatePicker: no delete
PASS Day, a text field focused: ⌫ (U+007F) with focus on NSTextView: no delete
PASS Day, no focus: ⌫ (U+007F) with focus on AppKitWindow: delete held, toast "Event deleted."
PASS ⌘Z (Edit menu "Undo Delete Event") restores Dentist
DONE all passed
```

This closes the open A4 item: the Event > Delete key equivalent (plain ⌫) does not fire while a text
field or date field outside the editor has focus, nor while the selected event is not on screen.

### Performance (1,000 events in a year)

`ScrollPerformanceUITests` on the A10 iPhone 17 Pro simulator, Debug build, with `-ThirteenQAGeneratedEvents
1000` (1,000 single events in 2026 on top of the 24 mockup events, `QAGeneratedEvents`, the same every run)
or `0`, and `-ThirteenQAFrameProbe YES`. Each test repeats its gesture five times (XCTest `measure`):
List and Year are flung up and down, Day's timeline is flung, Month pages four times by swipe, Day pages
six times. In a simulator XCTest's scroll metric reports only the gesture's duration (its hitch ratio
needs a device), so the app's frame probe logs once a second how many frames arrived on the main thread,
how many came late (a gap over 1.5 refresh intervals) and the time lost to them; `frames.py` sums them
over each test's run. Simulator refresh 60 Hz.

| Test | 1,000 events: frames/s | late frames | hitch ms/s (mean, p95) | longest frame | mockup only: frames/s | late frames | hitch ms/s (mean, p95) | longest frame |
|---|---|---|---|---|---|---|---|---|
| List, fling | 57.7 | 1.5% | 41.9, 143.3 | 193 ms | 58.1 | 1.4% | 35.5, 116.8 | 196 ms |
| Day timeline, fling | 56.4 | 3.8% | 63.2, 174.5 | 181 ms | 55.4 | 4.4% | 75.5, 320.8 | 209 ms |
| Year, fling | 54.6 | 2.3% | 97.4, 327.2 | 260 ms | 55.5 | 1.6% | 85.2, 352.4 | 255 ms |
| Month, paging by swipe | 45.1 | 9.0% | 263.6, 530.2 | 312 ms | 46.3 | 7.9% | 236.8, 492.1 | 299 ms |
| Day, paging by swipe | 47.1 | 6.3% | 221.6, 514.7 | 451 ms | 51.3 | 4.5% | 151.3, 337.2 | 300 ms |

XCTest's own numbers (average of five, 1,000 events then mockup only): List scroll gesture 2.560 s and
2.570 s; Year scroll gesture 2.450 s and 2.557 s, Year test clock 6.722 s and 6.689 s; Day timeline clock
0.976 s and 1.073 s; Month, four pages each waiting for the new title, 8.065 s and 8.640 s; Day, six pages,
12.039 s and 11.219 s.

Reading: with 1,000 events the app delivers frames as it does with the 24 mockup events (within a few
percent, inside the run-to-run noise of a shared machine), so the event load does not cost scrolling
time on the main thread (the views read the events model's year caches and lay out only the visible page
or rows). Paging is where frames drop in both runs, about 45 to 51 frames a second; scrolling List, Year
and Day stays at 55 to 58.
The attempt of 2026-10-27 00:58, with the same 1,000 events under a load average of 500 to 900, gave List
55.0 frames/s with 3.4% late, Year 52.0, Day 53.3, Month paging 36.2, Day paging 34.3: the machine's load,
not the events, moves these numbers.

What this does not show: an iPhone 12-class device's 60 fps. A simulator runs on the Mac's CPU and GPU,
in a Debug build, so these bound the app's main-thread work only; the §6.2 target needs a run on a
device (Instruments' Animation Hitches template, Release build). The paging hitches (about 150 to 260 ms
lost per second while paging, in both runs) are the first place to look on a device.

### Found and fixed

- **Mac: ⌫ in Convert's date field deleted the selected Calendar event** (the open A4 item). The Event
  menu's Delete has the plain key equivalent ⌫, and the Mac offers a plain key to the menu after the
  focused view passed it on: a text field's editor keeps ⌫ (checked with a throwaway SwiftUI app), but
  Convert's date field (`NSDatePicker`) passes it on. With Dentist selected in Calendar and Convert's date
  field focused, one ⌫ held Dentist's delete on a screen that did not show it. Now Event > Edit and
  Delete act only while the selected event is on screen (Calendar, or its details), and a ⌫ typed while
  a text view or date field has focus never deletes (`ThirteenCommands.swift`). Choosing Event > Delete
  with the pointer still deletes.
- **The "Events" rotor trapped VoiceOver on one day.** Its entries were one per event, and every event
  of a day pointed at the same day cell; walking the rotor with "next" from the mockup day's cell
  (the in-app probe, twelve steps) never left that cell (`rotor Events entries 12 days 1`). The rotor has
  one entry per day with events now, naming the day's events in order (`MonthModeView.swift`,
  `MonthRotorEntry`), and the probe test requires it to reach later days.
- **VoiceOver offered a Month day's events backwards.** SwiftUI on iOS 26 lists a view's custom actions in
  the reverse of their declaration; they are declared reversed on iOS now and read in the day's order,
  then "New Event" (`MonthModeView.swift`).
- **iPad sidebar at AX5:** section names broke inside words ("Con vert", "His-tory") in the 240 pt
  sidebar; it is 420 pt wide at accessibility sizes (`SectionContent.swift`).
- **Focus after actions (§2.20) was not built** (only the editor's validation focus existed, and
  `EventUndo.restoredKey` was set but never read). Built as described above (`AppModel.swift`,
  `EventPresentation.swift`, `EventPresentationState.swift`, `EventUndo.swift`).
- **EventKit tests:** one parallel case of `foreignRulesAreRecorded` failed with
  `calendarNotFound("local source")`: a new `EKEventStore` listed no sources yet on the loaded machine.
  `EventKitStore.createLocalCalendar` (Debug only) and the tests' `makeCalendar` now refresh the sources
  and look again for up to 5 s.
- **Tests:** `testEndingTheRepeatSaysWhatIsDeleted` left the repeat picker with the first navigation
  bar's first button, which on iPad is the Calendar's "Previous Month"; it uses the picker's own bar now.
  `testAX5MonthIsAListOfDays` swiped past the run of empty days; it drags without a fling now. The overflow
  tests load only the 16-event cluster (`-ThirteenQAGeneratedEvents 16`): with 1,000 events XCUITest's
  snapshot of iPad Day timed out. The audit exception for the title menu (above).
  `testAX5OverflowListIsASheet` tapped a "+11" block whose lower half was below the iPad window; it now
  drags (without a fling) until the block is wholly on screen. `testPopoverEditorOnIPad` tapped outside
  the popover near the bottom edge, where the software keyboard's one-time "Quickly Change Keyboards" tip
  sat after a simulator reboot; it taps higher now (and see the open item below).
- **Added:** `EventKitEndToEndUITests` (§6.2 "one end-to-end test against real EventKit": the seeded
  local calendar reads back, an added event survives a relaunch, a title edit is saved, a delete
  committed by the toast's Close stays deleted after another relaunch; `ui-tests.sh --eventkit` grants
  access first, and without access the test skips and never taps Continue);
  `CalendarLabelsUITests/testOneDayBar`; `AccessibilityUITests/testRotorCellActionsAndPagingActions`
  with the in-app probe; the Mac smoke check; `CalendarNavigationTests/focusAfterActions`;
  `ui-tests.sh --eventkit` and repeatable `--only`; `eventkit-tests.sh --skip`.
- **docs:** apple/README.md read the day cell as "Gregorian: Monday" (with a colon); it now gives the
  §2.20 form.

### Not covered, or still open

- **No VoiceOver, Switch Control or Full Keyboard Access walk-through by a person**, on a device or in
  the simulator (VoiceOver does not run in the iOS Simulator). The names, the rotor, the cell actions and
  the paging actions are checked by UI tests and the in-app probe; the focus moves after actions are
  checked only as requests.
- **Focus after paging** keeps the selected day's grid position (tested), but no request moves VoiceOver
  focus to it; the new title is announced (§2.1).
- **iPad keyboard:** Esc does not close the editor opened with ⌘N in the iPad simulator, and ⌘Z does not
  undo a held delete there (the toast's Undo does). Both are expected failures in the tests until tried
  with a real iPad keyboard; they may be app bugs (the Cancel button's `.cancelAction` inside the editor
  popover; the window's undo manager off the responder chain after the details popover closes) rather
  than simulator limits. On the Mac ⌘Z restores a held delete (smoke check).
- **System secondary text under 4.5:1** (measured above): the navigation subtitle, the iPad sidebar's
  section header and Form section headers and footers (the §2.13 repeat notes) use the system's secondary
  label colour over the paper. Giving them `ink-3` is a design change across every Form and theme; left to
  the owner.
- **The Mac's accessibility tree** (rotor, cell actions, column groups) was not checked: without an
  assistive app connected, SwiftUI gives in-process `accessibilityChildren()` only the window frame (6
  elements), and reading it from outside needs accessibility access (a TCC prompt). The Mac window's
  title for VoiceOver and the Window menu is the system's: AppKit joins the navigation title and subtitle
  with an en dash (U+2013), "October 2026", dash, "Gregorian Oct 8 to Nov 4". The app's own strings have none.
- **Not run on a real device:** the iPhone 12-class 60 fps target (performance above); text sizes,
  contrast and keyboard on hardware.
- **iPad: a tap outside a changed editor popover does not ask** (§2.11 discard paths). In
  `testPopoverEditorOnIPad`, after "!" is typed into the title of the editor in the details popover, a tap
  on the calendar outside the popover does nothing: the popover and the draft stay (nothing is lost), but
  "Discard Changes" never appears. Checked with temporary logging in four runs, with and without the
  software keyboard: SwiftUI never calls the popover's `isPresented` binding, and UIKit calls neither
  `presentationControllerDidAttemptToDismiss` nor a `presentationControllerShouldDismiss` that returns
  false (`interactiveDismissDisabled` does not set `isModalInPresentation` on the popover). Cancel and a
  swipe down on the iPhone sheet ask as they should (`testCancelAsksBeforeDiscarding`,
  `testSwipeDownAsksBeforeDiscarding`); Cancel inside the popover asks too (the same test, 03:58). The test keeps the tap-outside step as an
  expected failure and closes through Cancel; the fix (a dismissal hook SwiftUI's popover honours on
  iOS 26) is open, and the Mac's click outside a changed popover was not run either. The logging was
  removed again.
- **Review findings:** during this run a review agent added `Tests/ReviewFindingsDataTests.swift` (21
  issues at the last run) and `EventKitTests/ReviewFindingsEventKitTests.swift`, which pin defects found
  in a review and fail until they are fixed. They are not part of A10 and were not fixed here; the
  EventKit script ran with `--skip ReviewFindingsEventKitTests`, and the ThirteenAppTests row counts
  them apart. (Fixed later the same day; both suites pass: "Review fixes" below.)

### §8.2 Apple gates that still need the owner's devices or accounts

Nothing in this run touched a real calendar or account; these stay as the Status table above says
(V1 and V23 results: [phase0.md](phase0.md)):

- **V1:** iCloud.com (the owner's sign-in), a title edit in Calendar.app and the days on a second iPhone
  (iOS 26 or 27). Until then a release ships iCloud as `gregorian-only` (§8.2 "Phase 0 results").
- **V2, EventKit leg:** a Google account in Calendar on an iPhone, a form (b) series saved into it, checked
  on Google Calendar web.
- **V4:** an Exchange or Microsoft 365 account on an iPhone.
- **V5:** `EKCADErrorDomain 1013` on iOS 26/27 and macOS 26/27 with iCloud and Google calendars.
- **V6:** documented for iCloud all-day events in phase 0; timed events and other accounts not.
- **V7:** the Privacy & Security > Calendars link on macOS 26 and 27 (opens System Settings on a real Mac).
- **V8:** `requestFullAccessToEvents` from the store actor in a sandboxed, Developer ID signed Mac build (a
  TCC prompt; only the owner may trigger it).
- **V16:** the iCloud all-day flip of a repeating occurrence on iOS 26/27.
- **V20:** invitee alert edits on iCloud, Google and Exchange invitations.
- **V21:** "Open in Calendar" (`calshow:`) on iOS 26/27 and macOS 26/27 devices.
- **V22:** write-only access saving into `defaultCalendarForNewEvents` on iOS 26/27 and macOS 26/27.
- **V23:** the two splits on iOS 26/27, checked on iCloud.com, and both in a Google calendar through
  EventKit (phase 0 ran macOS 27 on iCloud only; the simulator EventKit tests above match it for a local
  calendar).

## Review fixes (task "Apple fixes", 2026-10-27)

Not a gate: the fixes for the two review reports of 2026-10-27 (data integrity, UX), and the phase 0
results applied to Apple's per-account table. 2026-10-27 04:00 to 05:40 (EET), by the Apple fixes
agent, on the working tree on HEAD `7753452` plus uncommitted work; Xcode 27.0 (27A266a) on macOS 27.0.1
(26A434); simulators: each script's private iPhone 17 Pro or iPad Pro 13-inch (M5), iOS 26.5 (23F77),
made and deleted by the script. Device zone Europe/Tallinn.

### Phase 0 results in the per-account table

`CalendarSourcePolicy` (apple/Shared/Events/CalendarStore.swift) already carried the phase 0 outcome;
this task checked it against the probe report and spec v3.3 (§3.4, §8.2 "Phase 0 results", §9.10) and
changed only the write-only row:

| Gate (phase 0) | Result | Apple setting in force |
|---|---|---|
| V1 (iCloud, forms a, b, c) | partial: the Mac EventKit leg passed; iCloud.com, Calendar.app and a second iPhone not run | `v1ICloud = false`: a release gives iCloud calendars `gregorian-only` (the fallback); Debug builds keep form (b) on iCloud so the open legs can be run (§8.2, §9.10); no `repeat.footer.apple` in either |
| V2, EventKit leg | not run (Google web import proxy only) | `v2GoogleEventKit = false`: a release gives Google calendars `gregorian-only`; Debug builds keep form (b) (§9.10 "development keeps `all`"); no `repeat.footer.appleGoogle`. The probe report suggested `gregorian-only` for Google in development too; spec v3.3, which the engine and this table follow, keeps `all` there, so it was not applied |
| V23 (iCloud, macOS 27) | documented | `span.future.exceptionsLost` when a changed occurrence follows the split point, on every Apple calendar; the §4.7 count check treats a missing rule as a wrong end (EventKit wrote the chosen count minus the head's); "future events" on `COUNT` series stays offered from every occurrence (the correction was accepted) |
| V6 (incidental) | iCloud all-day events got the account's default alert | documented only (FAQ text) |
| V4, V5, V7, V8, V16, V20, V21, V22 | not run | their fallbacks, as in the Status table |
| write-only (no gate: the account of `defaultCalendarForNewEvents` is unknown) | | **changed**: checked as the strictest kind, Exchange's `gregorian-only` and one alert (`writeOnlyCalendar(id:)`, `writeOnlySettings`), so no form (b) repeat and no second alert reach an Exchange calendar, or an iCloud or Google one in a release before V1 or V2 |

Owner update 2026-10-26: the owner checked Calendar and the "Thirteen QA" calendar of phase 0 is gone,
so the deletion is confirmed outside EventKit too (phase0.md "Clean-up").

### What the reviews found, and what happened

Data-integrity review (tests `Tests/ReviewFindingsDataTests.swift`, `EventKitTests/ReviewFindingsEventKitTests.swift`;
every finding was real, so both suites stay as regression tests and now pass):

- **Blocker, fixed: "this event only" date and time moves of a series were refused.** The stores
  validated the merged draft with the series' repeat (`repeat-not-on-start` after a new date for one
  occurrence of a 13-month series; `until-before-start` after a move past the repeat's end), and so did
  the editor. Now `SaveRules.thisEventOnly` checks and writes the occurrence without the series' repeat
  in `EventKitStore.saveExisting`, `FakeCalendarStore.save` and so in every held drag; the editor's
  `liveIssues` check a repeating occurrence the same way until the user chooses a repeat, and issues the
  store reports for a "future events" save show under their fields (`shownIssues`); an issue without a
  text (`repeat-not-on-start`) shows "Couldn't Save the Event" instead of nothing.
- **Blocker, fixed: a re-derived repeat restarted the count of a "future events" split** (a 10-time
  series edited at its 4th occurrence ended with 13). `SaveRules.ruleChanged` treats a repeat as the
  user's choice only when it differs from the stored repeat re-derived to the new start
  (`adaptRecurrenceToStart`), so the editor's re-derivation and a drag's adapted repeat keep the
  remaining count; the EventKit count check and the fake store's split both use core's `split` with
  it. EventKit simulator: "re-derived split of COUNT=10 at the 4th: countCorrected true, 10
  occurrences" (head `COUNT=3`, new series `COUNT=7;BYYEARDAY=13,41,...`).
- **Major, fixed: Undo of a save that made a single event repeating left it repeating.** A save that
  writes the repeat group is not exactly reversible, so it gets no Undo (`EventUndo.recordSave`).
- **Major, fixed: drags between the all-day row and the timeline changed Show as.** `movedDraft` keeps
  the availability (`settingAllDay(true, availabilityTouched: true)`, no `.busy` on the way back).
- **Major, fixed: Undo of a two-alert change always failed** (EventKit returned [-60, -15] for
  [-15, -60]). Alerts are read in one order (`AlarmOrder`: relative ones latest first, then absolute
  ones) and compared sorted in `revertWritten` and `eventsDidChange`. Simulator: "alarms saved [-15,
  -60], read back [-15, -60]", Undo removed both.
- **Major, fixed: write-only saves were checked as an unlimited calendar** (above). The write-only
  editor's calendar has the same limits, so the repeat picker disables the 13-month rows that are not
  Exchange-safe, only one alert row shows, and the conflict dialog reads "Default calendar Can't Keep
  This Repeat".
- **Major, fixed: all-day on and off made a floating event zoned.** The editor tells "floating" from "not
  known" (`zoneBeforeAllDay: String??`); an existing floating event comes back floating and unchanged.
- **Minor, fixed: the drag's later-events count used the occurrence's current date**; it now counts
  from the original date in the series' zone, as the editor does.
- **Minor, fixed: a move copied to another account offered Undo**; it shows "Event saved." without
  Undo. **Minor, fixed: non-ASCII URLs read back as punycode and percent escapes**;
  `EventKitMapping.urlText` decodes the host's `xn--` labels and non-ASCII escapes (ASCII escapes such
  as `%20` stay). Simulator: "https://bücher.de/über" reads back as typed.

UX review:

- **Major, fixed: ⌫ and the context menu deleted a single event without asking.** Every delete now asks
  "Delete This Event?" ("Delete Event", "Cancel", plus the invitee line); the answer holds the delete
  with Undo. The Mac smoke check's step 4 answers the question before ⌘Z.
- **Major, fixed: ⌘E and ⌫ acted on a selected event that was no longer on screen.** The Event menu
  uses `AppModel.selectedEventIsOnScreen`: its details are open, or the current page shows it (Month and
  its bands, Week, Day; List: any loaded event; never Year).
- **Major, fixed: "Show Calendars" could not show a collapsed sidebar and moved no focus.** The split
  view's `columnVisibility` is the window model's `sidebarVisibility`; "Show Calendars" and ⌥⌘K show a
  collapsed sidebar first, the first hidden calendar's group is expanded, and its toggle takes
  VoiceOver and keyboard focus (`calendarsFocusRequest`, `@AccessibilityFocusState` and `@FocusState`
  on the row). The bound visibility starts at `.all`: a bound `.automatic` collapsed the sidebar on a
  13-inch iPad in portrait, where it showed before (found by the first iPad UI run, below).
- **Major, fixed: the Mac details popover's Done, ⋯ and Edit went to the main window's toolbar.** A Mac
  popover has no toolbar of its own, so its actions are a row in the popover (board A2 frame 8: Edit, ⋯
  with Duplicate, Delete Event), with no title bar; Escape still closes it. iPad, iPhone and the Mac
  sheet keep the toolbar.
- **Major, fixed: system red text under 4.5:1.** Errors (the text and icon under a field, the invalid
  date and time buttons, "Couldn't Save the Event") and "Delete Event" use `Palette.danger`, the boards'
  `#b42318` (light) and `#f97066` (dark): 5.1:1 or more on paper, raised and sunk paper of all eight
  themes (computed from design/tokens.json). "Delete Event" is that red on a neutral sunk fill.
- **Major, fixed: rows of "+N more" and "+{n}" opened details over the open list.** A row closes the
  list first and opens the details once the list has disappeared; an event hidden in the overflow has no chip, so its
  details anchor to the day's Month cell (`EventPresentation.anchorDay`, `detailsStyle`'s fallback),
  else a sheet. `CalendarLabelsUITests.testOverflowLabels` taps a row on iPad and expects the details.
- **Major, fixed: ⌘W and the close button closed the Mac window over a changed draft.**
  `MacWindowCloseGuard` (macOS/MacRootView.swift) asks "Discard Changes?" first through a local ⌘W
  key monitor and the close button's target (SwiftUI's window delegate stays as it is); "Discard" then
  closes the window. Not pressed in this run: the Mac screen was locked (below).
- **Major, fixed: touch targets under 44 pt.** The date picker's slot strip (the 32 pt chips now sit
  in 44 x 44 pt targets), its day cells (44 pt), the custom repeat's day and month buttons (44 pt, the
  whole cell tappable) and the iPad sidebar's group headers (32 pt plus 6 pt around, as the sheet).
- **Major, fixed: the App Store text** (docs/store/app-store.md): §7.3 applied, Productivity then
  Reference, the CALENDAR paragraph in place of "does not read or change the events in your own
  calendar", the new last paragraph, keywords (96 characters), promotional text (149), the
  calendar-access review notes, and the screenshot order of §6.2. The Year tab of the old review
  notes is now Calendar's Year view.
- **Minor, fixed:** the "No weekday" plate on an intercalary Day page (under the title, as the Month
  band's code plate); the compact drill-down's back buttons read the parent ("2026", "October":
  `navigationItem.backButtonTitle` of the covered page, the system button and its swipe kept); the load
  failure is the toast "Couldn't load events." with "Try Again" (`EventUndo.showLoadFailure`) instead of
  a banner; the picker's tab control is named "Calendar System", so "Year" is only the stepper; the
  Mac's typed date says "Choose a date from 1583 to 9999." only for a real date out of range, and text
  that names no date stays in the field with the system beep; Title and Location wrap to 4 lines at
  accessibility sizes (Return still saves); the day sheet's Events section is at the top (§2.9).
- **Minor, not fixed: the large title's menu chevron and paging actions on the title** (iPhone Month,
  List, Year). The large title is drawn by the system and shows no chevron for `toolbarTitleMenu`; a
  chevron or custom actions need a custom title in place of the system's, which would lose its
  subtitle and menu behaviour. The inline title (Day, accessibility sizes) has the chevron, and the
  grid has the paging actions.
- **Minor, recorded as deviations: strings outside §2.19** ("Show Earlier Events", "Show Less", "Show
  Details", "Events", "Time", "More", "Previous Year", "Next Year"). "Time" and "More" are the boards'
  (A2, G1), "Previous Year" and "Next Year" are the year unit of `calendar.previous` and `next`, the
  rest are control labels the catalogue has no key for; the catalogue cannot be changed in this run.
  List loads earlier events with "Show Earlier Events" instead of on scroll up (§2.7).

### What ran

| Suite | Where | Command | Result |
|---|---|---|---|
| ThirteenKit | macOS 27.0.1 | `swift test --scratch-path /tmp/thirteen-applefixes-kit` in apple/ThirteenKit | pass: `Test run with 111 tests in 10 suites passed after 32.499 seconds` |
| ThirteenAppTests | macOS 27.0.1 | `xcodebuild -scheme "Thirteen Mac" -destination platform=macOS -derivedDataPath /tmp/thirteen-dd-applefixes-mac CODE_SIGN_IDENTITY=- test` | pass on the final tree: `Test run with 290 tests in 22 suites passed after 3.671 seconds`, no build warnings; "Review findings: data integrity" 10 of 10 (it failed 21 issues before the fixes). Five tests were added (Show Calendars with a collapsed sidebar, the selected event on screen, the write-only editor, URLs read back, the alert order); `deleting`, `focusAfterActions` and the write-only calendar test were changed to the new behaviour |
| Builds | macOS, generic iOS Simulator | `build` in Debug and `-configuration Release` for "Thirteen Mac" and "Thirteen" | `** BUILD SUCCEEDED **` for all four, no warnings |
| Mac smoke check | a copy of the Debug app with its own bundle id (`com.haugas.thirteen.applefixes`, no entitlements, removed afterwards with its defaults), fake store | `open -n -a ThirteenFixes.app --stderr <file> --args -ThirteenQASmoke YES -ThirteenQAEvents fake -ThirteenFixedToday 2026-10-19` | partial: steps 1 and 2 pass (the mockup day's five events; the Event menu's Edit ⌘E and Delete ⌫); steps 3 and 4 `SKIP ... the app is not active`, `DONE incomplete`, because the screen was locked |
| EventKit tests | a private iPhone 17 Pro the script makes and deletes | `DERIVED_DATA=/tmp/thirteen-dd-applefixes-ek apple/scripts/eventkit-tests.sh` (no `--skip`) | pass: `Test run with 22 tests in 4 suites passed after 9.279 seconds`, "Review findings: EventKit data integrity" 5 of 5 with the other three suites |
| ThirteenUITests | iPhone 17 Pro, iOS 26.5 | `apple/scripts/ui-tests.sh --eventkit --shots ...` (every class, ScrollPerformanceUITests and EventKitEndToEndUITests included) | pass: `Executed 50 tests, with 7 tests skipped and 0 failures` (the 7 are iPad only; EventKitEndToEndUITests passed in 59.8 s). After the last fixes, CalendarLabelsUITests, AccessibilityUITests and CalendarFlowsUITests again: `Executed 33 tests, with 5 tests skipped and 0 failures` |
| the same | iPad Pro 13-inch (M5), iOS 26.5 | `apple/scripts/ui-tests.sh --ipad` (first run without, final run with `--eventkit`) | first run: `Executed 50 tests, with 5 tests skipped and 2 failures`: `testCalendarsListTogglesAndCollapsing` (the bound split view started collapsed; fixed by starting at `.all`) and the new step of `testOverflowLabels` (it tapped a cell's line instead of the popover's row; the query now looks inside the popover, and the details open when the list has disappeared). Both alone afterwards: 2 passed. Final full run on the final build: `Executed 50 tests, with 4 tests skipped and 0 failures` (EventKitEndToEndUITests passed; `testPopoverEditorOnIPad` passes with A10's expected failure for the tap outside) |

Every simulator was made and deleted by its script; none is left. The load average was 17 to 560 during
the runs (other projects' builds, an Android emulator).

### Still open

- The Mac smoke check's key steps (3 and 4: ⌫ in fields, ⌫ asking "Delete This Event?", ⌘Z) and the
  ⌘W and close-button guard were not pressed: the Mac's screen was locked for the whole run
  (`CGSSessionScreenIsLocked` true), so only steps 1 and 2 ran.
- From A10, not part of the reviews: on iPad a tap outside a changed editor popover still does nothing
  (nothing is lost; no question), and Esc and ⌘Z in the iPad simulator stay expected failures.
- The §8.2 gates of the Status table still need the owner's devices and accounts.

## Cross-platform review fixes (task "Apple cross-platform fixes", 2026-10-27)

Not a gate: the two Apple findings of the cross-platform consistency review of 2026-10-27. 05:42 to
06:55 (EET), by the Apple cross-platform fixes agent, on the working tree on HEAD `7753452` plus
uncommitted work; Xcode 27.0 (27A266a) on macOS 27.0.1 (26A434); simulators: iPhone 17 Pro and iPad
Pro 13-inch (M5), iOS 26.5 (23F77), each made and deleted by its script. Device zone Europe/Tallinn.

### What the review found, and what happened

- **Minor, fixed: the both-dates names had a colon.** The Year, Today, Convert and menu bar grid
  cells, the intercalary badges, the date plate and the Mac sidebar's Today row read "Thursday,
  October 12, 2026. Gregorian: Monday, October 19, 2026" (Gregorian first: "Monday, October 19, 2026.
  IFC: Thursday, ..."), unlike §2.20, Windows, Android, the web and Apple's own Month cells.
  `Phrasing.bothDates` now reads "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026" and
  "Monday, October 19, 2026. IFC Thursday, October 12, 2026", as Windows `Phrasing.BothDates` and
  Android `both_dates` / `both_dates_gregorian_first`. The grid cells take their names from the new
  `Phrasing.dayCell` and `Phrasing.gregorianDayCell`, whose month-start sentence ends with a full stop
  (`calendar.gregorianMonthBegins.a11y`: "Wednesday, October 25, 2026. Gregorian Sunday, November 1,
  2026. Gregorian November begins."; on the Gregorian grids "IFC October begins."), as the Month cells
  and the web. Kept as it is: the date plate with Gregorian on top ("Gregorian Monday, October 19,
  2026. IFC: Thursday, October 12, 2026"), which Windows (`DatePlateModel`) and Android
  (`plate_a11y_gregorian_primary`) read the same way. Tests: `AppModelTests` `gridCellsReadWithoutColons`
  (new: no colon in any October 2026 or Gregorian December 2026 cell name, the month-start
  sentences), `voiceOverReadsBothDates` and `gregorianFirstAndStatusItem` (new strings);
  `CalendarLabelsUITests/testYearCellValues` asserts the exact Year cell names now (it matched
  "... 2026. Gregorian" as a prefix, which the colon passed), `testUpNextRows` the Today grids and,
  on iPad, the sidebar's Today row.
- **Minor, prepared, retaken at release: no Apple events screenshots in `docs/screenshots`.** The
  `ios-*.png` and `macos-*.png` files predate the redesign and the events screens, and an earlier
  Month shot in /tmp had a "Ready for Apple Intelligence" banner over its title. The review's fix is
  a release step (and the set is retaken at release, task A12), so the files in `docs/screenshots`
  were not replaced. New `apple/scripts/screenshots.sh` takes the iOS set on the fake store with the
  mockup data set and today fixed to 2026-10-19: its own named simulator, a wait after the first
  boot, the status bar at 09:41 on Monday, October 19 with full signal and battery, and a shot kept
  only when three captures 4 s apart are identical (a banner or a screen still loading changes the
  pixels). The Mac set is taken by hand with the screen unlocked and Do Not Disturb on;
  apple/README.md "Screenshots (at release)" gives the commands, docs/store/app-store.md the App
  Store sizes. Trial runs into /tmp: 8 iPhone shots (`ios-calendar-month`, `-day`, `-list`, `-year`,
  `ios-today-up-next`, `ios-event-details`, `ios-event-editor`, `ios-calendars`) and 7 iPad shots
  (`ios-ipad-calendar-month`, `-week`, `-day`, `-year`, `ios-ipad-today-up-next`,
  `ios-ipad-event-details`, `ios-ipad-event-editor`), every one settled, no banner, the mockup
  day's events on screen. Found on the way: given with the other overrides, the iPad status bar read
  "Thu Oct 19" for the date 2026-10-19; the script sets the date on its own call.

### What ran

| Suite | Where | Command | Result |
|---|---|---|---|
| ThirteenAppTests | macOS 27.0.1 | `xcodebuild -scheme "Thirteen Mac" -destination platform=macOS -derivedDataPath /tmp/thirteen-dd-xpf-mac CODE_SIGN_IDENTITY=- test` | pass: `Test run with 291 tests in 22 suites passed after 2.368 seconds` (one new), no Swift warnings |
| ThirteenKit | macOS 27.0.1 | `swift test --scratch-path /tmp/thirteen-xpf-kit` in apple/ThirteenKit | pass: `Test run with 111 tests in 10 suites passed after 26.543 seconds` |
| Builds | macOS, generic iOS Simulator | `-configuration Release build` for "Thirteen Mac" and "Thirteen" | `** BUILD SUCCEEDED **` for both, no Swift warnings |
| EventKit tests | a private iPhone 17 Pro the script makes and deletes | `DERIVED_DATA=/tmp/thirteen-dd-xpf-ek apple/scripts/eventkit-tests.sh` | pass: `Test run with 22 tests in 4 suites passed after 8.872 seconds` ("Review findings: EventKit data integrity" with the other three) |
| ThirteenUITests | iPad Pro 13-inch (M5) | `apple/scripts/ui-tests.sh --ipad --eventkit --shots ...` | pass: `Executed 50 tests, with 4 tests skipped and 0 failures` |
| the same | iPhone 17 Pro | `apple/scripts/ui-tests.sh --eventkit --shots ...` | `Executed 50 tests, with 7 tests skipped and 1 failure`: `ScrollPerformanceUITests/testMonthPaging` ("paged to November 2026"). Alone again: failed the same way; with the old (colon) names as a negative check: passed (61.8 s); with the new names once more: passed (59.0 s). See "Still open" |

### Still open

- **iPhone Month paging by swipe can leave Month (intermittent).** In the failing runs the screen
  recording and the UI hierarchy show the right swipe on the December page popping Calendar back to
  Year (Month is pushed on Year on iPhone) instead of paging to November: iOS 26's back swipe from
  the content wins over the paging `DragGesture` (`CalendarPagingModifier`) now and then. Not caused
  by the names (it passed and failed with both), and the test passed in the earlier full run; §2.1
  "Paging without gestures" has a left or right swipe on Month, Week and Day move to the next or
  previous period. Not changed here: the fix (a horizontal pager the system's back swipe
  yields to, or turning off the content back swipe on Month and Day) changes navigation and needs
  its own check.
- `docs/screenshots/ios-*.png` and `macos-*.png` are still the old set until the release run.
