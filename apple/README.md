# Thirteen for iPhone, iPad and Mac

Native SwiftUI apps for *Thirteen*, the 13-month (13 × 28 days) calendar: the International Fixed
Calendar (default) and Comte's Positivist calendar, set against the Gregorian calendar. All
calendar logic comes from the [`ThirteenKit`](ThirteenKit) package, the Swift port of
`@thirteen/core`. The apps contain no date arithmetic of their own. Domain rules and product
surfaces are in [`docs/SPEC.md`](../docs/SPEC.md).

ThirteenKit also holds the events engine (docs/EVENTS.md §5.7), the port of
`packages/core/src/events`: wall clocks and zone math, `RRULE`, the 13-month repeat rules and their
`RRULE` encodings, recurrence expansion, splits and retimes, recognition of stored rules, repeat
presets and texts, `expandSeries`, the editor model (validation, defaults, merge, alerts) and the
Month, Week, Day, List and Year layouts. The `.ics` module and the Android-only date lists are not
ported. It is kept identical to the TypeScript engine by `fixtures/events.json` (every section
except the Android-only `dateLists`, with its `counts`), a Foundation `Calendar.RecurrenceRule`
oracle for the `BYYEARDAY` encodings, and differential runs against random cases from the
TypeScript engine. Its names and parity tests are in the "Events" section of the
[ThirteenKit README](ThirteenKit/README.md#events).

| | iPhone | iPad | Mac |
|---|---|---|---|
| Navigation | iOS 26 tab bar (Today, Calendar, Convert, Compare, History), one `NavigationStack` per tab | `NavigationSplitView` sidebar (the Calendars list under the sections while Calendar is selected); every window navigates on its own | `NavigationSplitView` sidebar, one main window |
| Calendar (docs/EVENTS.md §2.1) | Day, Month, Year, List (Week shows as Day) | Day, Week, Month, Year, List in a segmented control | the same, with **View** menu shortcuts |
| System switcher | toolbar menu | toolbar menu | toolbar segmented control, **Settings** (⌘,), **Calendar** menu |
| Day detail | sheet with medium/large detents | full-height form sheet | resizable sheet |
| Settings (theme, appearance, system, overlay) | gear in every tab's navigation bar, sheet with medium/large detents | gear in the sidebar, form sheet | **Settings** window (⌘,) |
| Extras | | hardware-keyboard shortcuts | menu bar extra with today's date ("Oct 12", read to VoiceOver as "Thirteen, IFC date: Thursday, October 12, 2026"), keyboard shortcuts |

Screenshots: [`docs/screenshots/ios-*.png`](../docs/screenshots) and `macos-*.png` (from before
the redesign and events; retaken at release, see [Screenshots (at release)](#screenshots-at-release)).

## Requirements

- Xcode 27 (iOS 26 / macOS 26 SDKs or later), Swift 6.
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) 2.44 or later (`brew install xcodegen`).
- Running: iOS / iPadOS 26 or later, macOS 26 or later.

## Generate, build, run

The Xcode project is generated and not committed (`apple/*.xcodeproj/` is git-ignored, and so is
`apple/Generated/`, where XcodeGen writes the Info.plist URL types). Regenerate it after every pull
or after adding or removing files:

```sh
cd apple && xcodegen generate           # or, from the repo root: pnpm apple:gen
```

```sh
# iOS app (iPhone + iPad), simulator build
xcodebuild -project Thirteen.xcodeproj -scheme Thirteen \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath /tmp/thirteen-dd build

# Mac app, ad-hoc signed (the project defaults to "-" signing; App Sandbox is on)
xcodebuild -project Thirteen.xcodeproj -scheme "Thirteen Mac" \
  -destination 'platform=macOS' -derivedDataPath /tmp/thirteen-dd CODE_SIGN_IDENTITY=- build

# App logic tests (Swift Testing, macOS, no app launch): deep links, model, Calendar modes and
# paging, 13-month picker, phrasing, themes (groups, forced dark, the Appearance setting, colours),
# the design rules, the calendar store's pure parts (FakeCalendarStore, recurrence mapping, the
# per-account table), and EventsModel and EventUndo on the fake store
xcodebuild -project Thirteen.xcodeproj -scheme "Thirteen Mac" \
  -destination 'platform=macOS' -derivedDataPath /tmp/thirteen-dd CODE_SIGN_IDENTITY=- test

# EventKit tests (iOS Simulator only): creates a private simulator, grants it calendar access with
# simctl, runs ThirteenEventKitTests hosted in the iOS app, deletes the simulator
scripts/eventkit-tests.sh               # --only EventKitRoundTripTests, --skip Suite (repeatable), --keep

# UI tests (XCUITest, iOS Simulator, the fake store, no calendar access) in a private simulator:
scripts/ui-tests.sh --shots /tmp/thirteen-shots/apple     # --ipad, --only EventEditorUITests, --keep
scripts/ui-tests.sh --skip ScrollPerformanceUITests       # leave out the slow performance check
scripts/ui-tests.sh --increase-contrast --only AccessibilityUITests   # with Increase Contrast on
scripts/ui-tests.sh --eventkit --only EventKitEndToEndUITests        # the one test on real EventKit
# Classes: CalendarLabelsUITests (the §2.20 accessible names), CalendarFlowsUITests (create, future
# events, delete and Undo, drags, Calendars list, access cards, Settings), AccessibilityUITests (AX5,
# paging, iPad keyboard, Increase Contrast, Xcode's accessibility audit), CalendarKeyboardUITests
# (iPad: arrows, Return and Escape in Month), ScrollPerformanceUITests (1,000 generated events:
# scroll metrics and paging times), EventEditorUITests (details, editor), EventKitEndToEndUITests
# (add, edit and delete through EventKit in the simulator's local store, after `--eventkit` granted
# access; it skips without the grant); --only and --skip are repeatable;
# or by hand (event details and editor tests: EventEditorUITests);
# with TEST_RUNNER_THIRTEEN_SHOTS_DIR in the environment, each test also writes its screenshots
# there as {iphone|ipad}-{name}.png (event-details, event-editor, span-dialog, span-dialog-losses,
# date-picker, repeat-picker; iPad also event-details-popover and event-editor-popover); they are
# always attached to the result bundle
TEST_RUNNER_THIRTEEN_SHOTS_DIR=/tmp/thirteen-shots/apple xcodebuild -project Thirteen.xcodeproj \
  -scheme "Thirteen UI Tests" -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /tmp/thirteen-dd test

# Engine tests
cd ThirteenKit && swift test            # or: pnpm apple:test
```

Run on the simulator:

```sh
xcrun simctl boot "iPhone 17 Pro"
xcrun simctl install booted /tmp/thirteen-dd/Build/Products/Debug-iphonesimulator/Thirteen.app
xcrun simctl launch booted com.haugas.thirteen
```

Run on the Mac: `open /tmp/thirteen-dd/Build/Products/Debug/Thirteen.app`, or use ⌘R in Xcode with
the *Thirteen Mac* scheme.

Bundle id: `com.haugas.thirteen` for both apps. The Mac app used `com.haugas.thirteen.mac` before
1.0; it now shares the iOS id, so a Mac App Store build can join the same App Store record
(universal purchase), and the Developer ID DMG uses it too. The team (`DEVELOPMENT_TEAM`) is set
in `project.yml`.

## Deep links

Both apps register the `thirteen` URL scheme and route it with `onOpenURL`
(`Shared/App/DeepLink.swift`). Years are **Gregorian** years 1…9999, like every year parameter
of the engine. An invalid year or date still opens the screen but ignores the bad value.

| URL | Opens |
|---|---|
| `thirteen://today` | Today |
| `thirteen://calendar` | Calendar in its last mode |
| `thirteen://year/2026` | Calendar, Year mode, 2026 |
| `thirteen://year/2024?day=2024-06-17` | Calendar, Year mode 2024, scrolled to that day's month, with its day-detail sheet |
| `thirteen://month/2026/11` | Calendar, Month mode: 13-month month 11 (of the selected or given system) of Gregorian year 2026 |
| `thirteen://week/2026-10-19` | Calendar, Week mode for the 13-month week holding that day (Day on compact width) |
| `thirteen://day/2026-10-19` | Calendar, Day mode on that day |
| `thirteen://new-event?date=2026-10-19` | the editor for a new event that day (after the access prompt if access is undecided; an alert when events cannot be added, docs/EVENTS.md §2.16) |
| `thirteen://convert?date=2026-10-19` | Converter, Gregorian → 13-month (also `convert/2026-10-19`) |
| `thirteen://convert?thirteen=2024-LD` | Converter, 13-month → Gregorian, from the numeric 13-month form (display year of the system) |
| `thirteen://compare/2024` | Compare for 2024 |
| `thirteen://history` | History |
| any of the above `…?system=positivist` | also switches (and persists) the calendar system |

```sh
xcrun simctl openurl booted 'thirteen://year/2026?day=2026-10-19'
open 'thirteen://compare/2024'                       # Mac, once the app is registered
open -a /path/to/Thirteen.app 'thirteen://today'     # Mac, a build that LaunchServices ignores (e.g. in /tmp)
```

The simulator asks "Open in Thirteen?" for every `openurl` from the command line. For unattended
screenshot runs, pre-approve the scheme once per simulator and reboot it:

```sh
P=~/Library/Developer/CoreSimulator/Devices/<UDID>/data/Library/Preferences/com.apple.launchservices.schemeapproval.plist
/usr/libexec/PlistBuddy -c "Add :com.apple.CoreSimulator.CoreSimulatorBridge-->thirteen string com.haugas.thirteen" "$P"
```

### Screenshot QA launch arguments

These have no effect unless passed, e.g. `xcrun simctl launch booted com.haugas.thirteen -ThirteenQAScroll bottom`:

| Argument | Effect |
|---|---|
| `-ThirteenFixedToday 2026-10-19` | pretend today is that ISO date (with the fake store, the events clock is that day at the mockup's 09:41) |
| `-ThirteenQAEvents fake` | events from `FakeCalendarStore` with the mockup data set (`fixtures/mockup/mockup-events.json`, in its zone Europe/Tallinn), never EventKit: for UI tests and screenshots, no calendar access needed. Without it every build uses EventKit |
| `-ThirteenQAAccess notDetermined\|denied\|writeOnly\|restricted\|empty\|noWritable` | with the fake store: the access state of docs/EVENTS.md §2.16 (default full access) |
| `-ThirteenQAEvents seed` | Debug builds: EventKit, and once full access is granted (`xcrun simctl privacy <udid> grant calendar com.haugas.thirteen`) a local calendar "Thirteen QA" filled once with the mockup events (`UserDefaults` `ThirteenQASeeded`). Simulators only |
| `-ThirteenQAShowEvents off\|on` | "Show my events" for this launch, over the stored setting (not saved) |
| `-ThirteenQACalendarMode day\|week\|month\|year\|list` | start every window in Calendar, in that mode |
| `-ThirteenQAOpenCalendars YES` | open the Calendars sheet (docs/EVENTS.md §2.15) at launch |
| `-ThirteenQAFrameProbe YES` | iOS Debug builds: log the main thread's frame delivery once a second (`ThirteenQA frames 60 late 0 hitch 0.0 ms/s max 16.7 ms (refresh 16.7 ms)`; read with `xcrun simctl spawn <udid> log show --last 10m --predicate 'eventMessage CONTAINS "ThirteenQA frames"'`), for the scrolling check in a simulator, where XCTest's hitch metrics are not available |
| `-ThirteenQAGeneratedEvents 1000` | with the fake store: that many generated single events in 2026 on top of the mockup data set (`Shared/Events/QAGeneratedEvents.swift`: the same every run, 16 of them at 14:00 on 2026-10-20 so Week and Day show "+{n}" and Month "+N more"), for the scrolling performance check |
| `-ThirteenQAOpenEvent '<key>'` | Debug builds: open that occurrence's details once the calendars have loaded, e.g. `'home/book-club\|2026-10-19T19:00'` with the fake store (keys are `{event id}\|{local start}`) |
| `-ThirteenQAEditEvent '<key>'` | Debug builds: open the editor on that occurrence |
| `-ThirteenQANewEvent 2026-10-21` | Debug builds: open the editor for a new event on that day |
| `-accessCardLaunches 3` | the `UserDefaults` key of the access card's launch counter: with access undecided, Today's Up next shows the one-line link "See your events here" (§2.16) |
| `-ThirteenQAScroll top\|center\|bottom` | where every page starts scrolled (simctl cannot scroll) |
| `-ThirteenQAAppearance light\|dark` | force the app's appearance over the stored Settings choice (an always-dark theme stays dark) |
| `-appAppearance system\|light\|dark` | start with light or dark pinned (the `@AppStorage` key of Settings > Appearance; wins over the stored choice while passed) |
| `-ThirteenQAMenuBarPreview YES` | macOS Debug builds: also show the menu bar extra's content in a regular window, so it can be captured with `screencapture -l` (a status item cannot be opened by a script) |
| `-ThirteenQAOpenSettings YES` | open Settings at launch: the settings sheet on iPhone and iPad; on macOS (Debug builds) also the Settings window, for `screencapture -l` |
| `-appTheme graphite` | start in a colour theme (`almanac`, `graphite`, `slate`, `forest`, `mono`, or the always-dark `obsidian`, `midnight`, `phosphor`). This is the `@AppStorage` key, so while the argument is passed it wins over the stored choice |
| `-ThirteenQAMeasureYear YES` | iOS Debug builds: two seconds after launch, switch to the Year tab and log how long it took to appear (`ThirteenQA Year appeared in 190 ms`; read it with `xcrun simctl spawn booted log show --last 1m --predicate 'eventMessage CONTAINS "ThirteenQA"'`) |
| `-ThirteenQAAccessibilityProbe YES` | iOS Debug builds (`iOS/QAAccessibilityProbe.swift`, task A10): while a UI test runs, the app reads its own accessibility tree for what XCUITest cannot see (the mockup day's Month cell custom actions, the "Events" rotor, walked twelve steps with "next", which must reach later days, the "Next month" / "Previous month" paging actions, which it invokes) and puts the result in the label of a 1 pt element `qa.a11yProbe` (`AccessibilityUITests/testRotorCellActionsAndPagingActions`) |
| `-ThirteenQASmoke YES` | macOS Debug builds, with `-ThirteenQAEvents fake -ThirteenFixedToday 2026-10-19`: the Mac smoke check (`macOS/QAMacSmoke.swift`, task A10). The app checks the mockup day, the Event menu's ⌘E and ⌫, and that ⌫ deletes the selected event only when it reaches no text input (Convert's date field, a date field and a text field in Day) and the event is on screen, asking "Delete This Event?" first, pressing keys in process (`NSApp.sendEvent`, no accessibility access); it writes `ThirteenQA smoke: PASS ...` lines to stderr and quits. Launch with `open -n -a Thirteen.app --stderr /tmp/smoke.err --args ...`; the key steps are skipped while another app is in front |
| `-ThirteenQASnapshot YES` | macOS Debug builds: four seconds after launch, render every window in-process to `~/Library/Containers/com.haugas.thirteen/Data/tmp/thirteen-<window>.png` (and the sidebar list to `thirteen-sidebar.png`), drawn as if active, and log the appearance of the app, its main menu and every window (`ThirteenQA appearance: ...`). For checks while the Mac is locked and `screencapture` returns black; Liquid Glass and materials are not drawn, so it is not a substitute for real screenshots |

Light and dark mode on the simulator: `xcrun simctl ui booted appearance dark`; text size:
`xcrun simctl ui booted content_size accessibility-extra-extra-extra-large` (`large` is the
default).

### Screenshots (at release)

Every screenshot is taken on the fake store with the mockup data set
(`fixtures/mockup/mockup-events.json`) and `-ThirteenFixedToday 2026-10-19` (the mockups' day),
in Almanac light unless its name says dark, never with EventKit (no calendar access, no privacy
prompt). The iOS sets come from `scripts/screenshots.sh`; the Mac set (`macos-*.png`) needs an
unlocked screen and is taken by hand (below).

iOS: `scripts/screenshots.sh` builds the Debug app and the UI test runner into `DERIVED_DATA`
(default `/tmp/thirteen-dd-screenshots`), installs the app in the script's own named simulator
and writes one set per run:

| Command | Simulator | Files |
|---|---|---|
| `scripts/screenshots.sh` | Thirteen Shots iPhone 17 Pro (1206 x 2622) | `docs/screenshots/ios-{today-up-next,calendar-month,calendar-week,event-editor,repeat,year,today-dark}.png` (the README set) |
| `scripts/screenshots.sh --ipad` | Thirteen Shots iPad Pro 13 (2064 x 2752) | `docs/screenshots/ios-ipad-{calendar-month,calendar-week}.png` |
| `scripts/screenshots.sh --store` | Thirteen Shots iPhone 17 Pro Max (1320 x 2868, the App Store's 6.9-inch size; `--pro-max` is the same) | `docs/store/screenshots/iphone-6.9/{01-today,02-month,03-week,04-editor,05-year,06-convert}.png` |
| `scripts/screenshots.sh --store --ipad` | Thirteen Shots iPad Pro 13 (2064 x 2752, the 13-inch size) | `docs/store/screenshots/ipad-13/`, the same six names |

Options: `--only NAME` takes one shot (repeatable; the name as `--list` prints it without the
prefix, e.g. `calendar-month` or `02-month`), `--no-build` uses the build already in
`DERIVED_DATA`, `--locale en_US` sets the app and the simulator to 12-hour time (the App Store
sets are taken that way, docs/store/app-store.md; `--list` shows the locale a run will use),
`--out DIR` writes elsewhere, `--list` prints the set and exits, `--delete` deletes the simulator
afterwards (by default it is shut down and kept for the next run). Most screens are reached with the launch arguments above; Convert with the deep link
`thirteen://convert?thirteen=2026-M11-12` (the scheme is pre-approved in the simulator, so no
"Open in Thirteen?" alert); the repeat picker (`ios-repeat.png` and the store's `04-editor.png`)
by the UI test `EventEditorUITests/testRepeatPicker`. Week on iPhone is the Day timeline with its
week strip (compact width has no Week mode).

A new simulator shows system banners after its first boot ("Ready for Apple Intelligence" once
covered a Month title), so the script keeps its simulators between runs, waits out the first boot
(`SETTLE`, 150 s), sets the simulator's region to the shots' locale, overrides the status bar
(09:41 on Monday, October 19, 2026, full signal and battery) and keeps a shot only when three
captures `STEP` (4 s) apart are identical; a shot that never settles is kept with a warning and
exit status 1. It then removes the alpha channel (App Store Connect wants flattened images) and
checks each file's size. Look at every file before committing it.

Mac (the screen unlocked, Do Not Disturb on in Control Center, the Debug app; the fake store never
asks for calendar access):

```sh
APP=/tmp/thirteen-dd/Build/Products/Debug/Thirteen.app
ARGS=(-ThirteenFixedToday 2026-10-19 -ThirteenQAEvents fake -ThirteenQAAppearance light -AppleLocale en_GB)
open -n -a "$APP" --args "${ARGS[@]}" -ThirteenQACalendarMode month   # also week, day
screencapture -o -w ../docs/screenshots/macos-calendar-month.png         # then click the window
open -n -a "$APP" --args "${ARGS[@]}"                                    # macos-today-up-next.png
open -n -a "$APP" --args "${ARGS[@]}" -ThirteenQACalendarMode month -ThirteenQAEditEvent 'home/book-club|2026-10-19T19:00'   # macos-event-editor.png
open -n -a "$APP" --args "${ARGS[@]}" -ThirteenQAMenuBarPreview YES     # macos-menu-bar.png
```

Quit the app (⌘Q) between launches. `-ThirteenQASnapshot` is no substitute: it draws no Liquid
Glass or materials.

## Keyboard shortcuts (Mac, and iPad with a keyboard)

| Shortcut | Action |
|---|---|
| ⌘T | in Calendar: today in the current mode; elsewhere Today (and Calendar and Compare back to today) |
| ⌘← / ⌘→ | previous / next period: the Calendar mode's unit (day, week, month, year; List pages Month), Compare's year; from other screens, opens Calendar |
| ⌘1 … ⌘5 | Today, Calendar, Convert, Compare, History |
| ⌃⌘1 … ⌃⌘5 | Calendar in Day, Week, Month, Year, List (**View** menu) |
| ⌘N | New Event (**File**; on iPad, New Window moves to ⌥⌘N) |
| ⌘E / ⌫ | edit / delete the selected event (**Event** menu; a read-only event announces why instead; ⌫ asks "Delete This Event?" first). Only while the event is on screen (its details, or the current Calendar page: `AppModel.selectedEventIsOnScreen`, so paging away, Today or Year turn them off), and ⌫ typed into a text or date field stays there: the Mac offers a plain key to the menu after the focused view, and a date field passes ⌫ on |
| ⌘Z / ⇧⌘Z | undo / redo event moves, deletes and saves where §2.11 allows (**Edit**: "Undo Move Event", "Undo Delete Event", "Undo Edit Event") |
| ⌥⌘K | show / hide the Calendars list in the sidebar (**View**) |
| ⌘R | Refresh Calendars (`refreshSourcesIfNecessary`, **View**) |
| ←, →, ↑, ↓ | in Month and Week: move the selected day (Month: ↑ and ↓ by a week); among a day's events: move the selection (also Tab and ⇧Tab) |
| Return or F2 / Esc | in Month and Week: into the selected day's events (its first is selected) / back to the day; Return on a selected event opens its details |
| ⌥← / ⌥→ | previous / next day in the day-detail sheet |
| ⌃⌘S | show / hide the sidebar (Mac, **View** menu) |
| ⌘, | Settings (Mac) |

The **Go**, **View** and **Event** shortcuts act on the focused window (each iPad window has its
own screen); the **Calendar** menu changes the app-wide system and overlay preference.

## Architecture

```
apple/
├─ project.yml                 XcodeGen spec: targets Thirteen (iOS), Thirteen Mac (macOS), ThirteenAppTests,
│                              ThirteenEventKitTests (iOS Simulator)
├─ ThirteenKit/                the engine, calendar and events (Swift package; see its README)
├─ Shared/                     compiled into both apps
│  ├─ App/                     ThirteenApp (scenes), AppState (app-wide), AppModel (one window),
│  │                           AppSection, CalendarMode (Calendar's modes and CalendarPeriod:
│  │                           13-month months, weeks, paging, titles), DeepLink, SectionContent
│  │                           (sidebar layout for iPad and Mac), ThirteenCommands (menus, shortcuts)
│  ├─ Features/
│  │  ├─ Today/                hero plate (Liquid Glass), Up next, countdown, weekday shift, label
│  │  │                        drift, the 13-month grid and the Gregorian month with its 13-month dates
│  │  ├─ Calendar/             CalendarView (the Calendar section: drill-down, toolbars, titles,
│  │  │                        paging) and one view per mode: YearModeView, MonthModeView (and
│  │  │                        MonthDayListView at accessibility sizes), WeekModeView,
│  │  │                        DayModeView, ListModeView; EventTimelineView (Week and Day),
│  │  │                        EventChipView (chips, bars, rows, drag items), EventMoveDialog
│  │  ├─ Events/               event details, editor and its pickers, span dialogs, the access
│  │  │                        cards and alerts, the Calendars list, the Settings group, and
│  │  │                        EventToastView (the undo toast)
│  │  ├─ Year/                 13 grids in an adaptive grid (YearGridLayout), built lazily row by
│  │  │                        row, intercalary days in place, Gregorian overlay (Calendar's Year mode)
│  │  ├─ Convert/              two-way converter, ThirteenPickerLogic (13-month input), lookups, notable days
│  │  ├─ Compare/              ribbon, month lengths, Friday 13ths, quarters, shapes, weekday drift, systems
│  │  ├─ History/              merged timeline + the three calendars' summaries
│  │  └─ Detail/               DayDetailSheet (full comparison of one day)
│  ├─ Components/              ThirteenMonthGridView (4 × 7), GregorianMonthGridView (ragged, with
│  │                           13-month dates), IntercalaryDayBadge, DatePlate,
│  │                           YearProgressView (13 segments), MonthRibbonView (Canvas),
│  │                           MonthLengthBarsView (Swift Charts), ComparisonDetailView,
│  │                           WeekdayShiftView, SystemMenu, YearStepperHeader, ThemePicker
│  │                           (swatches in their groups) and ThemePreview
│  ├─ Design/                  ThemeTokens (generated colour themes and groups), Palette (theme
│  │                           colours as shape styles, the theme in the environment, marks
│  │                           without colour), Appearance (System, Light, Dark; forced dark;
│  │                           themedRoot), Hatch (the Gregorian band style), Typography (Geist,
│  │                           Geist Mono, font registration), Layout (spacing, radii, Card,
│  │                           PageScroll)
│  ├─ Support/                 Phrasing (plain-language sentences and VoiceOver labels),
│  │                           QAOptions (screenshot and timing launch arguments)
│  ├─ Events/                  the calendar store (see "Calendar store" below): CalendarStore
│  │                           (protocol, snapshots, errors, the per-account table), EventKitStore,
│  │                           FakeCalendarStore, EventKitMapping, RecurrenceMapping, EventInstants;
│  │                           and the events model (see "Events model and undo"): EventsModel,
│  │                           EventUndo, EventEditorState, CalendarAccess, EventFormat, QASeed
│  └─ Resources/               Assets.xcassets (the iOS AppIcon, AccentColor), Fonts (Geist and
│                              Geist Mono TTFs, OFL.txt); fixtures/mockup/mockup-events.json is
│                              bundled from fixtures/ by reference (project.yml)
├─ iOS/                        PhoneOrPadRootView: tab bar (compact width) or sidebar (regular);
│                              SettingsSheet and its gear button; QAAccessibilityProbe (Debug only)
├─ macOS/                      MacRootView, MenuBarContent, SettingsView, StatusItemAccessibility
│                              (VoiceOver label of the menu bar item), QASnapshot and QAMacSmoke
│                              (Debug only),
│                              entitlements (App Sandbox); the app icon is
│                              design/icon/exports/apple/AppIcon.icon, referenced from project.yml
├─ Tests/                      ThirteenAppTests (Swift Testing, macOS): AppModelTests, ThemeTests,
│                              CalendarStoreTests, FakeCalendarStoreTests, RecurrenceMappingTests,
│                              CalendarNavigationTests, EventsModelTests, EventUndoTests,
│                              EventEditorStateTests, EventEditorPickerTests
├─ UITests/                    ThirteenUITests (XCUITest, iOS Simulator, the fake store):
│                              EventEditorUITests (details, editor, pickers, discard, validation),
│                              CalendarLabelsUITests (§2.20 names), CalendarFlowsUITests (create,
│                              edit, delete and Undo, drags, Calendars list, access cards, Settings),
│                              AccessibilityUITests (AX5, paging, keyboard, Increase Contrast, audit),
│                              CalendarKeyboardUITests (iPad keyboard in Month),
│                              ScrollPerformanceUITests (1,000 events), EventKitEndToEndUITests
│                              (real EventKit in the simulator), UITestSupport
├─ EventKitTests/              ThirteenEventKitTests (iOS Simulator, hosted in the app):
│                              EventKitMappingTests, EventKitExpansionTests, EventKitRoundTripTests
└─ scripts/                    make-icons.sh + render-icon.swift (the iOS AppIcon),
                               app-icon-snapshot.swift (the icon of a built app),
                               eventkit-tests.sh (the EventKit tests in a private simulator),
                               ui-tests.sh (the UI tests in a private simulator),
                               screenshots.sh (the iOS release screenshots on the fake store)
```

**State.** Two `@Observable @MainActor` models:

- `AppState`, one per app, shared by every window: the selected system and the Year-grid
  overlay preference, persisted in `UserDefaults` under the keys `selectedSystem` and
  `showsGregorianOverlay` (the keys `@AppStorage` would use); and `today`, refreshed at the next
  local midnight, on day-change, time-zone, clock and significant-time-change notifications (and
  wake on the Mac), and when a scene becomes active. It tells every window when the day changes,
  so screens that were showing today move on with it. It also owns the `EventsModel`.
- `AppModel`, one per window, in the environment: the selected section and each screen's
  position (Calendar's mode and selected day, Compare year, converter day and direction, the open
  day-detail sheet), and the window's events state (the selected event, open details or editor, a
  delete question, an alert).
  It forwards `system`, `showsGregorianOverlay` and `today` to the shared `AppState`, so views
  read everything from one object. Every iPad window creates its own, so two windows can show
  different screens and sheets; a deep link moves only the window that opens it. Deep links and
  keyboard shortcuts only change these values, so the tab bar and the sidebar share one routing
  path, and resizing an iPad window between the two layouts keeps the current screen. The Mac's
  single main window shares its `AppModel` with the menu bar extra and the menus.

The colour theme is one `@AppStorage("appTheme")` value (an `AppTheme` id, `almanac` by
default), read at the root of every scene, sheet and the menu bar extra (`themedRoot()`), so a
change in Settings re-themes every window at once. Light and dark follow the system unless
Settings > Appearance pins one (`@AppStorage("appAppearance")`: `system`, `light`, `dark`). An
always-dark theme (Obsidian, Midnight, Phosphor: `ThemeGroup.dark`) forces dark whatever that
choice says, without changing it: `AppearanceSetting` combines the two into the effective
appearance, so picking a light and dark theme again brings the user's choice back.
`themedRoot()` applies the effective appearance to every window through
`UIWindow.overrideUserInterfaceStyle` (iOS) or `NSApplication.appearance` (macOS, which covers
the Settings window and the menu bar extra too), which, unlike `preferredColorScheme`, return
cleanly to the system appearance. While a dark theme is chosen, Settings shows the Appearance
segments disabled on Dark, with a note ("Midnight is always dark. Pick a light and dark theme to
use Appearance again.") that VoiceOver reads as the control's hint.

Views compute ThirteenKit values (`ThirteenYearLayout`, `Comparison`, `MonthAlignment`,
`YearStats`, …) directly from that state. They are cheap, pure value types. What costs is the
views: the Year screen has about 365 day cells, each with a formatted VoiceOver label, so its rows
of month cards are a `LazyVStack` (and so are the day lists at accessibility text sizes). Measured
with `-ThirteenQAMeasureYear YES` (Debug, iPhone 17 Pro Max simulator), the Year tab appeared in
0.8 s at the default text size and 1.5 s at the largest accessibility size when every card was
built up front, and in about 0.27 s and 0.19 s lazily. Scrolling to a month (deep links,
**Today**) targets the row of cards holding it.

**Design.** The look is a "rational almanac" (SPEC §6, `design/DECISIONS.md`) in eight colour
themes, listed in Settings in two groups (`ThemeGroup`). "Light and dark": Almanac (default: warm
paper, ink, signal orange `#ea580c`), Graphite, Slate, Forest and Mono, each with a light and a
dark variant (the system's, or the one pinned in Settings). "Dark": Obsidian (near black for OLED,
brand orange), Midnight (deep navy, teal, periwinkle foil) and Phosphor (green black, phosphor
green, amber foil), which are always dark (see State above). Every colour comes
from `design/tokens.json` through the generated `Shared/Design/ThemeTokens.swift` (`pnpm tokens`;
never edit it by hand), the same source as the web, Android and Windows apps. `Palette.ink`,
`Palette.accent` and the other roles are `ThemeColor` shape styles that resolve against
`EnvironmentValues.appTheme` and then the colour scheme, so views use them like colours
(`foregroundStyle`, `fill`, `background`); Canvas, Charts, gradients and glass tints take
`Palette.x.color(for: theme)` with the theme from the environment. Each theme's accent is for
fills (today, progress, marks), `accentText` for text, icons and selection rings (3:1 or more on
a day cell, where the accent itself is 2.9:1 in Almanac and Forest light), and system controls
(sidebar, toolbar, links, switches) take the theme's `controlTint` (4.5:1 or more on paper; in
dark mode also 3:1 or more for white text on it, the band in `design/README.md`). The iPhone tab
bar alone takes `accentText` (`PhoneTabView`): it draws the selected tab over its own glass, which
is lighter than the paper in dark mode, where the control tint measured 4.19:1 in Obsidian and
3.79:1 in Almanac dark; with `accentText` every theme measures 5.4:1 or more (no token changed;
measurements in `docs/events-verification/apple.md`). A
Mac `List` draws its selected row in the app's accent colour, which is the AccentColor asset and
cannot follow a theme chosen at run time (`.tint` and `listItemTint` do not reach it). The Mac
sidebar (`MacSidebar` in `SectionContent.swift`) keeps `List(selection:)`, so keyboard focus,
the arrow keys, type to select and VoiceOver's selected row stay native, but turns the table's own
highlight off (`selectionHighlightStyle = .none`, set by a small probe view in the list's
background), and each row draws its own at the native insets: icon and title white on the
theme's control tint while the list has keyboard focus in the active window (a `@FocusState` on
the list; the window opens with the focus there), ink on a soft wash otherwise (the system's
unemphasised look), so the highlight still shows where the focus is, and icons in the control
tint elsewhere. Nothing in the sidebar uses the
AccentColor asset any more. The iPad sidebar keeps the system highlight, which iPadOS draws in the
`.tint`. Bordered buttons keep the accent wash with
ink labels, like the web's buttons. The asset catalog keeps only the iOS AppIcon and AccentColor
(Almanac's control tint, for system UI outside the SwiftUI tint).

Sundays are red-letter days, as on the web: their numerals in `accentText` in both month grids.
Mono's accent is its ink, so there (and in every theme while Differentiate Without Colour is on:
`EnvironmentValues.marksWithoutColor`) Sundays and the current month's card title and number are
bold instead, beside the existing today fill, progress needle and card outline, and the Compare
charts (ribbon, month-length bars, quarters, weekday drift) fill their Gregorian bands with a
diagonal foil hatch (`GregorianBandStyle`, one `ShapeStyle` for shapes, `Canvas` and Swift
Charts), so the two calendars differ by pattern and not only by a shade of grey. Labels on a
hatched band (ribbon months, quarters, weekday chips) get a 1 pt halo in the band's wash
(`gregorianBandLabel(opacity:)`, `Hatch.haloOffsets` in a `Canvas`), like the web's
`--t-foil-halo`, so the lines do not run through the letters.

Type is Geist for display and text and Geist Mono for labels, small figures and codes (SIL Open
Font License 1.1, static TTFs from vercel/geist-font v1.8.1 in `Shared/Resources/Fonts` with
`OFL.txt`). The fonts are registered for the process at launch (`AppFonts.register()`, Core
Text), so the Info.plist needs no `UIAppFonts`. Every size is `Font.custom(_:size:relativeTo:)`
or `@ScaledMetric`, so Dynamic Type still scales it. Big numerals are Geist Bold with tabular
figures and -0.04 em tracking, titles semibold with -0.025 em, eyebrows uppercase Geist Mono.
System chrome (tab bar, toolbars, navigation titles, menus, alerts, system controls) keeps the
system font. Liquid Glass comes from the system components (tab bar, toolbars, sidebar, sheets)
plus one `glassEffect` on the Today hero. Charts follow the dataviz rules: one zero-based scale,
small multiples, direct labels and a hover/scrub readout. User-visible text has no em or en dash
(`Phrasing.withoutDashes` covers engine text).

**Accessibility.** Every day cell, intercalary badge and date plate reads both dates to VoiceOver
("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026.", then the event count, plus
"Gregorian November begins." on month-start cells and "Today" as the value; the §2.20 names are
asserted in CalendarLabelsUITests); Gregorian grid cells read the Gregorian
date first ("Monday, October 19, 2026. IFC Thursday, October 12, 2026", and "IFC October begins."
where a 13-month month starts). No label puts a colon after "Gregorian" or the system name, as on
Android and Windows. The ribbon gives VoiceOver one child per month, and the year header is an adjustable
element. Grids cap their own text at XXXL. At accessibility text sizes they become lists, plates
and fact rows stack vertically, and the year header puts its caption on its own row, so nothing
clips. On iPhone and iPad every day cell of the Year grids is at least 44 × 44 pt, down to
375 pt wide phones (iPhone SE, 13 mini); only the Mac's pointer-driven Year screen uses compact
cells. Year and day transitions are animated only when Reduce Motion is off. Text placed on
accent or foil fills uses dedicated on-colours that pass contrast in every theme, light and dark
(`pnpm tokens:check`); the "Design rules" tests recheck the blended combinations the apps draw
(cells, badges, strips) in every theme and mode, and scan every string literal for em and en
dashes. Each theme swatch in Settings is one button named after its theme, with the theme's
summary as its hint ("... Always dark." for the dark group) and the selected trait on the current
one; each group is a container named "Light and dark themes" or "Dark themes" under a heading.
At accessibility text sizes the swatches become rows with the page above the name and summary.
The current Year card reads "Current month" as its title's value. Bordered buttons whose label can
wrap become rounded rectangles at accessibility sizes (`wrappingButtonShape()`), and the
converter's notable days fall into one column.

## Events

Thirteen shows, adds and edits the events of the device's calendars in its 13-month views
([docs/EVENTS.md](../docs/EVENTS.md), boards in
[design/events/mockups.html](../design/events/mockups.html)). Views read and write through
`EventsModel` (`model.events`), which talks to one `CalendarStore`:

| Store | Used | What it serves |
|---|---|---|
| `EventKitStore` | every normal launch on iPhone, iPad and Mac | the device's calendars (iCloud, Google, Exchange, CalDAV, on this device, subscriptions) through the process's only `EKEventStore`, made on first use; nothing touches EventKit while Settings > Calendar > "Show my events" is off |
| `FakeCalendarStore` | `-ThirteenQAEvents fake`, the app tests, previews | the mockup data set `fixtures/mockup/mockup-events.json` (6 calendars, 24 events, Europe/Tallinn) in memory; `-ThirteenQAAccess` picks the access state; never EventKit, never a privacy prompt |
| `EventKitStore` + seed | `-ThirteenQAEvents seed` (Debug builds, simulators) | EventKit, with a local calendar "Thirteen QA" filled once with the mockup events |

**The fake store.** With `-ThirteenFixedToday 2026-10-19 -ThirteenQAEvents fake` the app shows the
mockups' day: IFC Thursday, October 12, 2026 (Gregorian Monday, October 19) at 09:41 Tallinn time.
Every screenshot and UI test uses it:

```sh
xcrun simctl launch <udid> com.haugas.thirteen -ThirteenFixedToday 2026-10-19 -ThirteenQAEvents fake
xcrun simctl launch <udid> com.haugas.thirteen -ThirteenFixedToday 2026-10-19 -ThirteenQAEvents fake \
  -ThirteenQAAccess denied              # notDetermined, denied, writeOnly, restricted, empty, noWritable
open -n /tmp/thirteen-dd/Build/Products/Debug/Thirteen.app --args \
  -ThirteenFixedToday 2026-10-19 -ThirteenQAEvents fake     # the Mac: always with the fake store
```

The Mac app is run only with the fake store while developing: an EventKit launch would show the
macOS calendar privacy prompt, and an ad-hoc signed build loses its grant at every rebuild (Apple
Development signing and `open` are needed, `tccutil reset Calendar com.haugas.thirteen` resets it).

**EventKit in the simulator.** Real EventKit is tested in an iOS Simulator only, against its own
local calendar store:

- `scripts/eventkit-tests.sh` builds the app with the hosted test bundle `ThirteenEventKitTests`
  (scheme "Thirteen EventKit Tests"), creates a private simulator, grants it calendar access with
  `xcrun simctl privacy <udid> grant calendar com.haugas.thirteen` (the tests run inside the app,
  so the app's grant applies and no prompt appears), runs `EventKitMappingTests`,
  `EventKitExpansionTests` and `EventKitRoundTripTests`, and deletes the simulator. `--only <Suite>`
  runs one suite, `--keep` keeps the simulator. What they measured is in
  [docs/events-verification/apple.md](../docs/events-verification/apple.md).
- By hand: `xcrun simctl privacy <udid> grant|revoke|reset calendar com.haugas.thirteen`, then
  launch with `-ThirteenQAEvents seed` for a calendar holding the mockup events.

**Screens** (§6.2):

| Screen | Files | Spec |
|---|---|---|
| Calendar: Day, Week, Month, Year, List | `Features/Calendar/` | §2.1 to §2.7 |
| Event details, editor, date field, repeat, alerts, calendar picker | `Features/Events/` | §2.10 to §2.14 |
| Today's "Up next" card | `Features/Today/UpNextCard.swift`, rows in `UpNextRows.swift`, texts in `Shared/Events/UpNextAgenda.swift` | §2.8, board B1 |
| The day sheet's Events section | `Features/Detail/DayEventsSection.swift` | §2.9 |
| The Mac menu bar line "Next: 19:00 Book club: Cotsworth" | `macOS/MenuBarNextLine.swift` | §2.8 |
| Calendars list (sidebar and sheet) | `Features/Events/CalendarsListView.swift` | §2.15, boards A2 and D1 |
| Access cards and the one-line link | `Features/Events/AccessCardView.swift`, texts in `Shared/Events/CalendarAccessCopy.swift` | §2.16, board E |
| Settings > Calendar | `Features/Events/EventSettingsSection.swift` | §2.18 |

- **Up next** sits under Today's hero whenever "Show my events" is on: today and the 6 days after
  it, at most 6 rows under "Today", "Tomorrow" and later days named in both calendars ("Saturday,
  October 14", "Gregorian Wed, Oct 21"), then "{n} more in the next 7 days". Events that ended
  earlier today drop off; one running now wears the Now plate. Rows open the event's details; "+"
  adds an event today; "Show All in Calendar" opens List. Without access the card holds the access
  card, which collapses to "See your events here" after 3 launches without a decision. With every
  calendar hidden it says "All calendars are hidden." with "Show Calendars", which opens the list
  where the layout keeps it (`AppModel.showCalendarsList()`: the sheet at compact width, the sidebar
  under Calendar at regular width, shown first if it was collapsed through the split view's
  `columnVisibility`, `AppModel.sidebarVisibility`), then moves VoiceOver and keyboard focus to the
  first hidden calendar's toggle (`calendarsFocusRequest`, its group expanded). The readings match the web's `upNext`
  (`packages/ui/src/events/upNext.ts`) and are pinned by `UpNextTests`.
- **The day sheet** starts with the day's events (the same rows, ended ones included), "New Event"
  and "Open in Calendar" (Day mode). A day without events shows "No events." and "New Event" only
  (§2.9, as the web does); with every calendar hidden, the same all-hidden line as Up next. Opening
  an event, the editor or the Calendars list closes the sheet first, since they are presented from
  the window root.
- **The menu bar line** names today's next timed event that has not started yet, and nothing when
  there is none (an event tomorrow would read as one today, since the line shows only a time). The
  menu bar extra starts the events model itself (`events.start()` is shared and only reads the
  access status), so the line also appears when the main window did not open at launch.
- **The Calendars list** groups calendars by account in the platform's order; each group collapses
  (stored per device, "1 calendar, 1 shown") and has "Hide All" or "Show All". Rows: the colour, the
  name, a "Read only" tag and a switch (the sheet) or a checkbox in the calendar's colour (the iPad
  and Mac sidebars, board A2).
  Hiding is Thirteen's own: Calendar.app never changes, and hidden calendars are not fetched. The
  sheet (`model.showsCalendarsSheet`) is presented from the window root; before full access, and
  with full access but no calendars ("No calendars yet"), it holds the access card instead.
- **Access cards** (Calendar's modes and Up next; never a modal, never at launch): "Continue"
  (the system prompt) before access is decided, "Open Settings" / "Open System Settings" when it is
  off or write-only, no button when restricted or without calendars. The button is the control tint
  with white text in light mode and the on-accent ink in dark mode (4.5:1 or more in every theme).
- **Settings > Calendar**: "Show my events" first, then "Calendar access" (its value; tapping does
  what the card's button does), "Default calendar" ("New events go to Home.") and "Show events in
  Year view", all hidden while "Show my events" is off.
- **Details and the editor** (task A7, §2.10 to §2.14). Where they appear is decided by
  `EventPresentationState` (`model.eventPresentation`): on compact width details are pushed onto the
  section's stack (`SectionContent` adds `.eventDetailsDestination(section)`) and the editor is a
  sheet at the large detent; at regular width (iPad, Mac) both are a popover anchored to the view
  that opened them, which marks itself with `.eventPopoverAnchor(.event(key))`, `.day(date)` or
  `.draft`; with no marked view (and for "+", ⌘N, deep links) they are a form sheet. A sheet that
  shows events presents its own with `.eventPresentation(model, nested: true)`. Details show the
  §2.10 rows; an invitation gets "Open in Calendar" and "Edit Alerts", and "Duplicate" (More menu)
  opens an unsaved draft without the repeat. The editor's logic is in `Shared/Events` so the app
  tests reach it: `EventEditorState` (fields, live validation, the later-events line, repeat
  re-derivation and the adaptation notices, the three-way merge banner, write-only mode, all-day
  Free), `EventEditorFlow` (save, span, conflict, invitees, move between accounts, discard, delete),
  `RepeatPickerLogic` (presets, storage notes, custom repeat), `ThirteenDatePickerLogic` (the 13-month
  date field: 1583 to 9999, leap-year stepping, the days the event's zone skips disabled, as
  Pacific/Apia 2011-12-30) and `EventEditorCopy` (every §2.19 string). A changed draft asks before
  it is discarded by Cancel, Escape, a swipe down or a tap outside (iOS: `DismissAttemptObserver`;
  Mac: `MacPopoverGuard`), by ⌘W and the close button on the Mac (`MacWindowCloseGuard` in
  macOS/MacRootView.swift: a local ⌘W key monitor and the close button's target, so SwiftUI's
  window delegate stays; "Discard" then closes the window), and by a navigation: paging, Today and a
  mode switch while the editor is a popover (so its anchor never leaves the screen), a deep link or
  opening another event while any editor is open. Those paths go through `AppModel.leaveEditor(popoverOnly:then:)`
  (`EventEditorFlow.swift`): an unchanged draft just closes, a changed one asks "Discard Changes?"
  and the navigation follows "Discard Changes". A URL typed without a scheme is saved with
  `https://` (`EventEditorState.normalizedURL`, as the web's `normalizeUrl`); a URL the user did not
  touch is written back as read.
- **Calendar modes** (tasks A5 and A6, §2.1 to §2.7). On compact width Calendar is a drill-down
  (Year, then Month or List, then Day; compact Week shows Day); at regular width one page with
  "‹", "›", "Today" (hidden while today is on screen), the segmented mode control and "New Event"
  (its words show when the page is 900 pt wide or more, always on the Mac). Titles and subtitles
  follow the §2.1 table (`CalendarText.subtitle`), the compact title is a menu with the system
  choice and "Calendars", and paging is announced. Month shows titles in cells 60 pt wide and wider
  at Large text and smaller, else up to three dots and a count, and becomes a list of days with
  runs of empty days at accessibility sizes; regular width fits its lanes to the cell and opens
  "+N more" in a popover. Each Month cell is one VoiceOver element with its events as custom
  actions, and the grid's "Events" rotor has one entry per day with events, naming them in order
  (one entry per event trapped "next" on the first day, whose entries all pointed at one cell). Week and Day are one timeline (`EventTimeline`): overflow blocks, the
  now line under the blocks, each column an accessibility container with "Add event", opening at
  07:00 (or the first event's hour when earlier). Touch and hold on empty time (iPhone and iPad)
  or a drag or double-click (Mac) makes an unsaved draft. With a pointer (Mac, iPad with a
  trackpad or mouse) a writable block's bottom edge drags to a new end: 15-minute steps, at least
  15 minutes long, held like a move through `EventMoveFlow` (`EventDropTarget.end`) with the toast
  "Event saved."; a finger never hovers, so touch keeps touch and hold to move. Month and Week take
  the §2.21 keys (`calendarKeyboard`, `CalendarKeyboard`): the arrows move the selected day,
  Return or F2 goes into its events, the arrows and Tab move among them, Return opens one and Esc
  goes back to the day; the grid has the keyboard from the start on iPad and after a click (or
  Tab) on the Mac. The testable parts are in `Shared/Events/CalendarScreens.swift`.
- **Drag and drop** (§2.4, §2.11 "Drag edits"): chips, bars, blocks and rows are `Transferable`
  `EventDragItem`s (exported type `com.haugas.thirteen.event`, `project.yml`); cells, columns and
  the all-day rows take drops. `EventMoveFlow` (`Shared/Events/EventMoveFlow.swift`) checks the
  moved draft with `validateDraft` first, asks for the span of a repeating event (with the
  changed-repeat and lost-events counts) and the invitee question, holds a single move with Undo
  and writes a future-events move at once. Option-drag (Mac, iPad with a keyboard) opens Duplicate
  at the drop. On touch, touch and hold on an item starts its drag, so items have no context menu
  there (the Mac keeps Open, Duplicate and Delete on right-click). Items, Month cells and the
  timeline's draft block mark themselves with `.eventPopoverAnchor`, so details and the editor
  are popovers on them on iPad and Mac.

## Calendar store (events)

The data layer of the events feature ([docs/EVENTS.md](../docs/EVENTS.md) §6.2, tasks A2 and A3), in
`Shared/Events/`. Views and models talk to the `CalendarStore` protocol only; everything that crosses
it is a Sendable value (ThirteenKit's `CalendarInfo`, `EventDraft`, `CalendarEvent`, `EventOccurrence`
and the snapshots `CalendarSnapshot`, `OccurrenceSnapshot`, `EventSnapshot`, `RecurrenceSnapshot`).

- **`EventKitStore`** (an actor) holds the process's only `EKEventStore`, made on the first call that
  needs it, so a launch with "Show my events" off or a fake-store QA run never touches EventKit.
  Queries are cut into pieces of at most four years, deduplicated by key
  (`{eventIdentifier}|{occurrenceDate as UTC ISO 8601}`, §3.2) and sorted by the order key of §5.3.
  An occurrence is found again by its `occurrenceDate` one day either side (never
  `event(withIdentifier:)`), then where it was last seen, then by `calendarItemExternalIdentifier`.
  Identifiers are compared by their series part: a detached occurrence's `eventIdentifier` gains
  `/RID=` and a number (`EventKitMapping.sameSeries`), so a key read before the change still finds it.
  Every save fetches the event again, runs `mergeDraft` and assigns only the written groups
  (`EventKitMapping.apply`; never `recurrenceRules` for an unchanged repeat, §4.9). "Future events"
  on a later occurrence runs the §4.7 count check; "Save for all events" goes through
  `applyToSeries` on the series' first occurrence and is refused with `.firstOccurrenceGone`
  (`span.keep.firstGone`) when that occurrence was removed or changed. Errors map to
  `editor.saveFailed.*` (§6.2), `EKCADErrorDomain 1013` on a move to `.moveNeedsCopy` (§4.7).
  `.EKEventStoreChanged` arrives in `changes`, coalesced over 300 ms.
- **`EventKitMapping`** and **`RecurrenceMapping`**: `EKEvent` <-> `CalendarEvent` / `EventDraft`,
  `EKAlarm` <-> `Alarm`, `EKCalendar` -> `CalendarInfo` (sRGB colour, account kind), and
  `EKRecurrenceRule` <-> `RRule`. The 13-month encodings are plain rules: form (a) `.yearly`, form
  (b) `.yearly` with `daysOfTheYear`, form (c) `.yearly`, interval 4, ending on the cap. Instants
  become dates with ThirteenKit's proleptic arithmetic (`EventInstants`), never Foundation's
  `.gregorian` components. The all-day rule is pinned by `EventKitRoundTripTests`: EventKit stores
  an all-day event's end as 23:59:59 of its last day, so the last day is the local date of
  `endDate - 1 s`. An all-day repeat's end is different: EventKit stores the end instant's date in
  the device's zone (`UNTIL=20261109`) and returns it as that date at 23:59:59 UTC in every zone, so
  `RecurrenceMapping` reads it as the UTC date (reading it in the device's zone gave the next day east
  of UTC, and an all-day "Every Leap Day" series was not recognized).
- **The per-account table** `CalendarSourcePolicy` (§3.4, §3.5, §2.13, risk R1) holds, per account
  kind, whether 13-month repeats in form (b) are kept, the alert limit, whether an invitation's
  alerts can be edited and the repeat footer sentences, all derived from one `Gates` value (V1, V2's
  EventKit leg, V20) and the kind of build (`Build`: Debug builds are development, every archive is
  a release). No gate has passed, so a release ships the fallbacks: iCloud and Google calendars are
  `gregorian-only` (forms (a) and (c) still work). Development keeps form (b) on iCloud and Google
  while those gates are open, so their open legs can be run (§8.2 "Phase 0 results", §9.10). In
  both, Exchange is always `gregorian-only` (and allows one alert), invitation alerts are read-only,
  and the only footer sentence is Google's `repeat.footer.appleGoogleAndroid`, which needs no gate.
  Write-only saves are checked against `writeOnlyCalendar(id:)`, a writable calendar with the
  strictest limits (Exchange's `gregorian-only` and one alert; the editor's picker disables form (b)
  rows), because the account of `defaultCalendarForNewEvents` cannot be read and may be Exchange.
  Changing a gate result is a one-line change there.
- **What both stores write the same way** (`SaveRules`, CalendarStore.swift): "this event only" on a
  series checks and writes the occurrence on its own, without the series' repeat (a new date for
  one occurrence of a 13-month series, or a move past the repeat's end, is allowed); a "future
  events" split carries the remaining count on unless the user chose a new repeat
  (`SaveRules.ruleChanged`: a repeat only re-derived from a new start is not a new choice, so a
  10-time series split at its 4th occurrence keeps 7, also through the count check). Alerts are
  read in one order (`AlarmOrder`; EventKit keeps its own) and compared sorted, and a stored URL
  reads back as typed (`EventKitMapping.urlText`: punycode hosts and non-ASCII escapes decoded).
- **`FakeCalendarStore`** (an actor) serves `fixtures/mockup/mockup-events.json` (§6.7; a bundle
  resource referenced in place from `fixtures/`, never copied), expanded with core's
  `SeriesExpansion.expand` in the device's zone, so any year can be shown and 2026 to 2027 in
  Europe/Tallinn equal the file's `occurrences` exactly. Its scenarios are the access states of §2.16
  (`-ThirteenQAAccess notDetermined|denied|writeOnly|restricted|empty|noWritable` with
  `-ThirteenQAEvents fake`); saves behave like EventKit (overrides, splits through core's
  `splitRecurrence`, `applyToSeries`, the three-way merge). Keys are the mockup file's.

**Permissions** (A3). Both apps carry `NSCalendarsFullAccessUsageDescription` with the text of
`purpose.apple` (§2.19) and no write-only or legacy key; the Mac app has the
`com.apple.security.personal-information.calendars` entitlement next to App Sandbox.
`scripts/release/mac-dmg.sh` fails unless the signed app has that entitlement and the purpose string,
and `scripts/release/ios-upload.sh` fails without the purpose string (`check_calendar_purpose` in
`scripts/release/common.sh`). `PrivacyInfo.xcprivacy` does not change (§7.2: EventKit is not a
required-reason API). The Mac app is exercised only with the fake store; calendar access is tested
only in a simulator (`xcrun simctl privacy <udid> grant calendar com.haugas.thirteen`).

**EventKit tests** (`scripts/eventkit-tests.sh`, iOS Simulator only, about five minutes with the
build): `EventKitMappingTests` (unsaved events: only written groups assigned, the 13-month forms,
proleptic dates in 1500 and 1583), `EventKitExpansionTests` (every form (b) and (c) case of the
`thirteenRules` fixture section saved into a local calendar and read back for 2024 to 2104: 81 cases,
124,986 dates, all equal to the engine), `EventKitRoundTripTests` (all-day and midnight ends, a
title-only save that keeps a `BYYEARDAY` rule, forms (a), (b) and (c) read back through recognition
with their ends, including a leap-only repeat's Never stored on its cap, all-day repeat ends, the
count check, "Save for all events", a deleted first occurrence, dates before 1583). What they
measured is in
[docs/events-verification/apple.md](../docs/events-verification/apple.md).

## Events model and undo

The app side of the events feature (docs/EVENTS.md §6.2, task A4), in `Shared/Events/` and
`Shared/App/`. Views read and write through these; none talks to a `CalendarStore` itself. The
top of `EventsModel.swift` lists every entry point (new event, details, editor, delete, drag and
drop), the model API, and the files of each screen task (Calendar modes and timelines; details and
editor; Today, the day sheet, the menu bar line, Calendars, Settings and access).

- **`EventsModel`** (one per app, owned by `AppState`, `model.events` in views): access
  (`authorization`, `requestAccess()`), "Show my events" (`showMyEvents`, default on: off means no
  events, no cards, no "+", and no access request) and "Show events in Year view"
  (`showEventsInYear`), the calendars, their visibility (`visibleCalendars` and `knownCalendars`
  as JSON references matched by id, then by account and title; a calendar added since is shown),
  collapsed account groups, the default calendar (`defaultCalendar`, falling back silently to the
  platform default), and the access card's launch counter (`accessCardLaunches`). Occurrences are
  cached per Gregorian year (local January 1 to January 1; 9999 ends at 9999-12-31T24:00): a year is
  fetched once, a second request while it loads shares the query, at most 8 years are kept, and
  every merge of years deduplicates by occurrence key, so an event crossing January 1 shows once.
  A store change (coalesced by the store over 300 ms; changes that arrive while the model
  refreshes are one more refresh, never one each) reads access and calendars again and refetches
  the cached years; old occurrences stay on screen until the new ones arrive. `start()` is shared:
  a caller that arrives while the first one reads access waits for it. Pending moves and deletes
  are applied on top, so the views show them before they are written.
- **`EventUndo`** (`events.undo`): the §2.11 Undo table for Apple. A move or delete of one occurrence
  is held (`holdMove`, `holdDelete`) and written when the first of these happens: its toast closes
  (8 s; 20 s on an iPhone or iPad with a hardware keyboard; until the next action while VoiceOver,
  Switch Control or AssistiveTouch runs), Close, the next action (another change, paging, Today, a
  mode or section switch, opening details or the editor), the app leaving the foreground, another
  write to the same event, a change to it elsewhere, or one minute before its earliest alert (one
  timer for all). Undo while pending discards it. After the write, a move of a non-repeating event
  without invitees stays undoable (the time group is written back through the three-way merge, or
  `calendar.undoUnavailable` if another app changed it since); a delete never is. Editor saves are
  written at once and are undoable only for a single event without invitees. Each change is
  registered with its window's `UndoManager` ("Undo Move Event", "Undo Delete Event", "Undo Edit
  Event"), at most 20 per window, cleared when access changes. A failed commit is retried once if
  the cause is transient, then the views go back and the toast says why ("Try Again" only for a
  transient cause); failures while no window is in the foreground are kept in `failedCommits` and
  shown at the next activation, one by name or several as "{n} changes couldn't be saved." with the
  list (a sheet on iPhone, at compact width and at accessibility sizes; a popover on iPad and Mac).
  Every toast is announced politely, with "Undo available: Command Z." where a keyboard is.
- **`AppModel`** (per window): `calendarMode` and `calendarDate` (paging with `CalendarPeriod`,
  remembered per window with `@SceneStorage`, first launch Month on today; the day is stored only
  while it is not today, so a window that was on today and is restored on a later day opens on the
  new today; a deep link that opened the window, and `-ThirteenFixedToday`, win over the restored
  day), the "+" flow of §2.16
  (`newEvent`: reads access first if the window has not yet, then the access prompt when
  undecided, the state's alert, the write-only editor), `openEvent`, `editEvent`, `duplicateEvent`,
  `editAlerts`, `requestDelete` / `confirmDelete` (every delete asks "Delete This Event?" first, ⌫
  and the context menu too; the answer holds it with Undo), `saveEditor`, `toggleCalendarsList()`
  (⌥⌘K: the sidebar list at regular width, a collapsed sidebar shown first; the Calendars sheet at
  compact width), `selectedEventIsOnScreen` (⌘E and ⌫ act only on an event the page shows), and
  the open `editor`
  (`EventEditorState`: draft, original, span, issues, dirty). An open editor whose event is
  deleted elsewhere closes with `editor.deletedElsewhere`.
- **Focus after actions** (§2.20, task A10): `AppModel.accessibilityFocusRequest` names where
  VoiceOver, Switch Control or Full Keyboard Access focus goes next: the saved event after Add or
  Save, the day cell after Delete (in List the next row), the restored event after Undo
  (`EventUndo.restorations`), the item that opened details when they close. The view marked with the
  same `.eventPopoverAnchor` (every chip, bar, block, row and Month cell) takes it with
  `@AccessibilityFocusState` when it is on screen or as soon as it appears; a request nobody takes
  lapses after 3 s. `CalendarNavigationTests/focusAfterActions` checks the requests; the focus move
  itself needs VoiceOver on a device.
- **Commands**: File > New Event (⌘N) replaces New Window (⌥⌘N on iPad). On the Mac no other
  `.newItem` command group may follow `ThirteenCommands`: an empty `CommandGroup(replacing:
  .newItem)` after it empties the File menu, New Event included.
- **The screens** were built on these seams in tasks A5 to A9 (`Features/Calendar`,
  `Features/Events`, `UpNextCard`, `DayEventsSection`, `MenuBarNextLine`); the placeholder views
  they started from are gone. The toast (`EventToastView`) belongs to this task.
- QA: `-ThirteenQAEvents fake` (the mockup data set, never EventKit), `-ThirteenQAAccess`,
  `-ThirteenQAShowEvents`, `-ThirteenQACalendarMode`, and in Debug builds `-ThirteenQAEvents seed`,
  `-ThirteenQAOpenEvent`, `-ThirteenQAEditEvent` and `-ThirteenQANewEvent` (see the launch
  arguments table above).

## App icon

The icon is "Page 13" (owner decision, `design/DECISIONS.md`): a tear-off calendar page, full
bleed, with Almanac's orange binding band and two ink ring holes across the top and a large "13" in
Geist Black on the paper below. It is one artwork on every platform, and its single source is
[`design/icon/`](../design/icon): the SVG masters and the exports are all generated by
`design/icon/build.py` (geometry and colours in [`design/icon/README.md`](../design/icon/README.md)).
Nothing under `apple/` is drawn by hand:

- **iOS and iPadOS**: `Shared/Resources/Assets.xcassets/AppIcon.appiconset`, three full-bleed
  1024 px PNGs (any, dark, tinted) rendered from the SVG masters, which the system masks. Rebuild
  it with `sh apple/scripts/make-icons.sh`.
- **macOS**: the Icon Composer document `design/icon/exports/apple/AppIcon.icon` (the same layers
  and geometry, with dark and tinted fills), referenced in place from `project.yml` so there is no
  copy to drift. macOS 26 and 27 draw it in their own squircle with the glass rim; an asset
  catalog image that is not already squircle shaped would sit in a grey tile on macOS 26.

XcodeGen needs to be told that a `.icon` is one file in the Resources phase (`options.fileTypes`
in `project.yml`); otherwise it adds the document's contents as loose resources. actool then
compiles it into the app's `Assets.car` (the layer stack for light, dark and tinted) and
`AppIcon.icns`, and it wins over an appiconset of the same name, so the appiconset has no Mac
slot. The `.icon` stays for the Mac only because on iOS it renders with the system's specular
rim and shadow, not identical to the flat asset catalog icon.

Checks (renders and compiled icons compared with the iOS PNG: same artwork, numeral box
186,418 to 836,888 px in all of them; `ictool` writes Display P3 PNGs, which convert back to the
sRGB `#ea580c` band and `#f4efe4` paper):

```sh
ICT="$(xcode-select -p)/../Applications/Icon Composer.app/Contents/Executables/ictool"
"$ICT" design/icon/exports/apple/AppIcon.icon --export-image --output-file /tmp/mac-26.png \
  --platform macOS --rendition Default --width 512 --height 512 --scale 2 --design-generation 26
# --design-generation 27, --rendition Dark, --platform iOS likewise
swift apple/scripts/app-icon-snapshot.swift /path/to/Thirteen.app /tmp/built-mac-icon.png
```
