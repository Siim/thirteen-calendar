<img src="apps/web/public/favicon.svg" width="56" height="56" alt="">

# Thirteen

Thirteen is a 13-month calendar with your events in it. It shows every day in the International
Fixed Calendar, or in Auguste Comte's Positivist calendar, next to the ordinary Gregorian date. You
can add, edit and repeat events in 13-month terms, convert dates in both directions, and see where
the two calendars disagree: the weekday, the month name, the length of every month and where each
month begins.

Thirteen runs in the browser and as an app for iPhone, iPad, Mac and Android. A Windows app is
coming in a later release. All of them use one calendar engine, written in TypeScript and ported to
Swift, Kotlin and C#, and every port is tested against the same golden fixtures.

## The calendars

Both calendars have 13 months of exactly 28 days, four full weeks each, which makes 364 days. The
365th day, and the 366th in leap years, belongs to no month and no week. Because every month has the
same shape, a date falls on the same weekday in every month of every year. Leap years follow the
Gregorian rule, and both calendars start on Gregorian 1 January, so day *n* of the year is the same
day in all three calendars.

The **International Fixed Calendar** (IFC) is the default. Moses B. Cotsworth proposed it in 1902,
and Eastman Kodak used it internally from 1928 to 1989. Its months are January to June, then
**Sol**, then July to December. Every month starts on a Sunday, so the 13th is always a Friday.
**Year Day** follows December 28 and is always Gregorian 31 December. In leap years **Leap Day**
follows June 28 and is always Gregorian 17 June. Neither day has a weekday, and the year number is
the Gregorian year.

The **Positivist calendar** was proposed by Auguste Comte in 1849. Its months are named after people
(Moses, Homer, Aristotle and ten more, ending with Bichat), and every month starts on a Monday. The
Festival of All the Dead follows Bichat 28, and in leap years the Festival of Holy Women follows it,
so the leap day comes at the end of the year. Year 1 is Gregorian 1789, so 2026 is year 238.

For example, Gregorian Monday, 19 October 2026 is IFC Thursday, October 12, 2026 and Positivist
Friday, Descartes 12, 238. The full rules, test vectors and comparison semantics are in
[docs/SPEC.md](docs/SPEC.md).

## Features

Every version has the same five sections.

- **Today**: today's 13-month date with its fixed weekday and the real one, Up next (your next
  events), how far the month name has drifted from the Gregorian date of the same name, how much
  of the year has gone and the countdown to Year Day.
- **Calendar**: your events in Day, Week, Month, Year and List views, with the Gregorian date in
  every 13-month day (iPhone and narrow screens show Day instead of Week). Add, edit, move and delete
  events with alerts, notes, links and repeats. On top of the usual Gregorian repeats there are
  13-month ones: every IFC month on the 12th, every IFC week on Thursday, every year on a 13-month
  date, every Year Day, every Leap Day. Show or hide calendars and pick the default one for new
  events.
- **Convert**: Gregorian to 13-month and back, including Sol, Year Day and Leap Day, for any year
  from 1 to 9999, plus the day a label such as "October 12" names in the other calendar.
- **Compare**: month lengths and month boundaries side by side, the year's Friday the 13ths,
  quarter lengths and how the fixed weekdays drift against the real ones.
- **History**: one timeline of the Gregorian calendar, the IFC and the Positivist calendar.

There are five themes in light and dark plus three always-dark ones, and settings for the calendar
system, the Gregorian overlay in Year and events. The Mac also has a menu bar item with today's
13-month date and your next event.

### Where events come from

Thirteen has no accounts and no server. Where the operating system has a calendar database, Thirteen
uses it; elsewhere it keeps its own calendars.

| Platform | Events | Sync | Alerts |
|---|---|---|---|
| iPhone, iPad, Mac | the device's calendars, read and written through EventKit after you allow access | whatever the system syncs: iCloud, Google, Exchange, Outlook and Microsoft 365, CalDAV, subscribed calendars | the system's calendar notifications |
| Android | the phone's calendars, read and written through CalendarContract after you allow access | whatever the phone's accounts sync, such as Google, Exchange or Outlook | the phone's calendar app; for a calendar Thirteen creates on the phone, Thirteen itself |
| Windows (coming soon) | Thirteen's own calendars in `%LOCALAPPDATA%\Thirteen\Calendars` | none: `.ics` import and export, and read-only subscriptions by `webcal://` or `https://` link | scheduled Windows notifications |
| Web | Thirteen's own calendars in the browser's storage for the site | none: `.ics` import and export, and read-only subscriptions by link | browser notifications while a Thirteen tab is open |

Because the Apple and Android apps work on the device's own calendars, an event added in Thirteen
appears in Apple Calendar, Google Calendar or Outlook through your accounts, and the other way
round. 13-month repeats have no standard form, so Thirteen stores them in forms other apps can read;
[the support page](https://thirteen.haugas.dev/support.html#repeats) lists which apps show them on
the right days. In this release the Apple apps offer the 13-month repeats that are not plain yearly
repeats (such as every IFC month on the 12th) only in calendars on the device and in CalDAV accounts,
not yet in iCloud or Google calendars, and no platform offers them in Exchange calendars. Every Year
Day and every Leap Day work everywhere.

On the web, many calendar hosts (Google, iCloud, Outlook among them) do not let web pages read their
subscription links; import their `.ics` file instead, or subscribe on the device.

## Get Thirteen

| Platform | Get it | Needs |
|---|---|---|
| Web | [thirteen.haugas.dev](https://thirteen.haugas.dev/) | a current browser |
| Mac | coming soon | macOS 26 or later, Apple silicon or Intel |
| Android | [Thirteen-android.apk](https://github.com/Siim/thirteen-calendar/releases/latest/download/Thirteen-android.apk) | Android 8.0 or later |
| iPhone and iPad | on the App Store soon, as "Thirteen: 13-Month Calendar" | iOS and iPadOS 26 or later |
| Windows | coming soon | Windows 10 version 1809 or later, x64 or Arm64 |

Every release, with versioned copies of these files (for example `Thirteen-1.0.0-android.apk`) and
their checksums, is on the [releases page](https://github.com/Siim/thirteen-calendar/releases).

Install notes:

- **Mac (soon).** The DMG and the app in it are signed with a Developer ID and notarized by Apple,
  so they open without warnings. Open the DMG and drag Thirteen to Applications.
- **Android.** The APK is not in Google Play. Open it on the phone and, when Android asks, allow
  your browser (or file manager) to install unknown apps. Later versions install over it, since
  every release is signed with the same key.
- **Windows (later).** Per-user installers for x64 and Arm64 that need no administrator rights.
  Code signing is optional in the build ([windows/README.md](windows/README.md)); if an installer is
  not signed, SmartScreen says "Windows protected your PC": choose More info, then Run anyway.
- **Web.** Nothing to install. To keep your events safe from the browser's storage clean-up, add the
  site to your Dock or Home Screen and export your calendars now and then
  ([support page](https://thirteen.haugas.dev/support.html#disappeared)).

## Screenshots

All captures use the mockup data set (`fixtures/mockup`) with today fixed to Monday,
19 October 2026, in the Almanac theme.

**Web**

| | | |
|---|---|---|
| <img src="docs/screenshots/web-today-up-next.png" width="280" alt="Web: Today with Up next"> | <img src="docs/screenshots/web-calendar-month.png" width="280" alt="Web: Calendar, Month with events"> | <img src="docs/screenshots/web-calendar-week.png" width="280" alt="Web: Calendar, Week"> |
| <img src="docs/screenshots/web-event-editor.png" width="280" alt="Web: the event editor"> | <img src="docs/screenshots/web-year.png" width="280" alt="Web: Year with the Gregorian overlay"> | <img src="docs/screenshots/web-subscribe.png" width="280" alt="Web: subscribing to a calendar by link"> |
| <img src="docs/screenshots/web-calendar-month-dark.png" width="280" alt="Web: Month in the dark theme"> | <img src="docs/screenshots/web-mobile-calendar.png" width="130" alt="Web on a phone: Calendar"> | |

**iPhone and iPad**

| | | | |
|---|---|---|---|
| <img src="docs/screenshots/ios-today-up-next.png" width="150" alt="iPhone: Today with Up next"> | <img src="docs/screenshots/ios-calendar-month.png" width="150" alt="iPhone: Calendar, Month"> | <img src="docs/screenshots/ios-calendar-week.png" width="150" alt="iPhone: the Day timeline with its week strip"> | <img src="docs/screenshots/ios-event-editor.png" width="150" alt="iPhone: the event editor"> |
| <img src="docs/screenshots/ios-repeat.png" width="150" alt="iPhone: the 13-month repeat picker"> | <img src="docs/screenshots/ios-year.png" width="150" alt="iPhone: Year"> | <img src="docs/screenshots/ios-today-dark.png" width="150" alt="iPhone: Today in dark mode"> | |

| | |
|---|---|
| <img src="docs/screenshots/ios-ipad-calendar-month.png" width="420" alt="iPad: Calendar, Month with the sidebar"> | <img src="docs/screenshots/ios-ipad-calendar-week.png" width="420" alt="iPad: Calendar, Week"> |

<!-- The Mac screenshots go back here, as a **Mac** heading and a two-column table of 420-wide
images like the iPad one, once they are retaken with the screen unlocked (apple/README.md,
"Screenshots (at release)"): Today with Up next, Calendar Month, Calendar Week and the event
editor. -->

**Android**

| | | | |
|---|---|---|---|
| <img src="docs/screenshots/android-today-up-next.png" width="150" alt="Android: Today with Up next"> | <img src="docs/screenshots/android-calendar-month.png" width="150" alt="Android: Calendar, Month"> | <img src="docs/screenshots/android-calendar-day.png" width="150" alt="Android: Calendar, Day"> | <img src="docs/screenshots/android-event-editor.png" width="150" alt="Android: the event editor"> |
| <img src="docs/screenshots/android-repeat.png" width="150" alt="Android: the 13-month repeat picker"> | <img src="docs/screenshots/android-calendars.png" width="150" alt="Android: the Calendars list"> | | |

| | |
|---|---|
| <img src="docs/screenshots/android-tablet-calendar-month.png" width="420" alt="Android tablet: Calendar, Month"> | <img src="docs/screenshots/android-tablet-calendar-week.png" width="420" alt="Android tablet: Calendar, Week"> |

**Windows** (from a pre-release build; retaken for the Windows release)

| | |
|---|---|
| <img src="docs/screenshots/windows-calendar-month.png" width="420" alt="Windows: Calendar, Month"> | <img src="docs/screenshots/windows-event-editor.png" width="420" alt="Windows: the event editor"> |

More are in [docs/screenshots](docs/screenshots).

## Building from source

Clone the repository. Each platform builds on its own; the details are in its README.

### Web

You need Node 22.18 or later (`.nvmrc` pins 22.21) and pnpm 10 through Corepack
(`packageManager` pins `pnpm@10.28.0`).

```sh
corepack enable
pnpm install
pnpm dev            # http://localhost:5173/#/today
```

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the web app's Vite dev server on port 5173. |
| `pnpm test` | Runs Vitest in every package (core, ui, web). |
| `pnpm typecheck` | Runs `tsc --noEmit` in every package. |
| `pnpm build` | Type-checks and builds the web app into `apps/web/dist`. |
| `pnpm preview` | Serves that build on port 4173. |
| `pnpm --filter @thirteen/web e2e` | Runs the Playwright end-to-end tests (Chromium, Firefox, WebKit). |
| `pnpm fixtures` | Regenerates the golden fixtures in `fixtures/` from `@thirteen/core`. |
| `pnpm tokens` | Regenerates every platform's theme colours from `design/tokens.json`. |
| `pnpm tokens:check` | Checks the theme colours' contrast. |

Packages export their TypeScript source, so nothing needs to be built before `dev` or `test`.
For a demo, `http://localhost:5173/?store=mockup#/calendar` runs on the mockup events, and
`?today=2024-06-17` pins today.

### iPhone, iPad and Mac

Xcode 27 and XcodeGen (`brew install xcodegen`). The Xcode project is generated and not committed:

```sh
pnpm apple:gen                 # cd apple && xcodegen generate
open apple/Thirteen.xcodeproj  # schemes: Thirteen (iPhone and iPad), Thirteen Mac
pnpm apple:test                # ThirteenKit, the Swift engine: swift test
```

[apple/README.md](apple/README.md) covers simulator and device runs, the tests, the `thirteen://`
links, the keyboard shortcuts, the screenshot launch arguments and the architecture.

### Android

JDK 17 or later (tested with 21) and the Android SDK with platform 37:

```sh
cd android
./gradlew :core:test :app:assembleDebug   # engine tests, then app/build/outputs/apk/debug/app-debug.apk
```

[android/README.md](android/README.md) covers the emulators, the test suites, release signing and
the architecture.

### Windows

The .NET 10 SDK. The app also runs on macOS for development:

```sh
cd windows
dotnet test                               # engine and app tests
dotnet run --project Thirteen.Desktop     # the app
```

The installers are built by `windows/build-windows.sh`, which publishes on the Mac and packages on a
Windows machine over SSH. [windows/README.md](windows/README.md) has the details.

## Project layout

```
.
├─ packages/
│  ├─ core/       @thirteen/core: the calendar and events engine (TypeScript, no runtime dependencies)
│  └─ ui/         @thirteen/ui: React components, hooks and design tokens
├─ apps/web/      @thirteen/web: the Vite web app, with privacy.html and support.html in public/
├─ fixtures/      golden vectors from core (conversions.json, events.json, ics/) and the mockup events
├─ apple/         ThirteenKit (the Swift port), the SwiftUI apps for iPhone, iPad and Mac, their tests
├─ android/       :core (the Kotlin port) and :app (Jetpack Compose)
├─ windows/       Thirteen.Core (the C# port), the Avalonia app, tests and the installer
├─ design/        DECISIONS.md, tokens.json (every colour), the app icon, the event boards
├─ docs/          SPEC.md, EVENTS.md, RELEASING.md, store text, screenshots, verification records
└─ scripts/       design token generators and the release scripts
```

## How correctness is checked

- **One engine.** All calendar and recurrence logic lives in `@thirteen/core`. The apps only
  display its results, through their ports.
- **An independent oracle.** `packages/core/test/oracle.test.ts` walks the calendars day by day
  with its own tables, sharing no code with the engine, and checks conversions, weekdays,
  formatting, parsing and comparisons for 120 years spread across 1 to 9999.
- **Golden fixtures.** `pnpm fixtures` writes `fixtures/conversions.json` and
  `fixtures/events.json`; a core test fails if the committed files are stale. The format is in
  [fixtures/README.md](fixtures/README.md).
- **Parity in every port.** The Swift, Kotlin and C# tests read the same fixture files in place and
  compare every section with their own results. Each port also checks every day from 0001-01-01 to
  9999-12-31.

## Documentation

- [docs/SPEC.md](docs/SPEC.md): calendar rules, test vectors, comparison semantics, product surfaces
- [docs/EVENTS.md](docs/EVENTS.md): the events design, data model, recurrence and per-platform plans
- [design/DECISIONS.md](design/DECISIONS.md): the owner's design and release decisions
- [docs/RELEASING.md](docs/RELEASING.md): version numbers and how each platform is released
- [packages/core/API.md](packages/core/API.md): the engine's public API
- [apple/README.md](apple/README.md), [android/README.md](android/README.md),
  [windows/README.md](windows/README.md): building and running each app

## Privacy

Thirteen has no accounts, no analytics, no ads and no tracking, and there is no Thirteen server.
Your events stay on your device or in your device's calendars, which sync through the accounts you
already use. The iPhone, iPad, Mac and Android apps make no network connections. The web app and the
Windows app connect only to download calendars you subscribe to, directly from the calendar's host.
The App Store privacy label is "Data Not Collected". The full policy is at
[thirteen.haugas.dev/privacy.html](https://thirteen.haugas.dev/privacy.html), and help is at
[thirteen.haugas.dev/support.html](https://thirteen.haugas.dev/support.html).

## License

MIT, copyright Haugas Development OU; see [LICENSE](LICENSE). The bundled fonts (Geist and Geist
Mono, SIL Open Font License 1.1) and the other third-party software in the apps are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
