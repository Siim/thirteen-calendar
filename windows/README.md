# Thirteen for Windows

Native Windows port of Thirteen: a C# engine (`Thirteen.Core`, a port of `@thirteen/core` and a mirror of
`apple/ThirteenKit`), its parity tests, and the Avalonia desktop app (Today, Calendar, Convert, Compare,
History, Settings; five colour themes in light and dark plus three always-dark ones) with a per-user installer for x64 and Arm64. The rules live in [`docs/SPEC.md`](../docs/SPEC.md); the TypeScript engine is the source of
truth and the golden vectors in [`fixtures/conversions.json`](../fixtures/conversions.json) keep every port
in step.

```
windows/
├─ Thirteen.sln
├─ Directory.Build.props        net10.0, C# latest, nullable, warnings as errors, version + build number, company
├─ global.json                  .NET SDK 10.0.1xx (roll forward to the latest feature band)
├─ Thirteen.Core/               the engine: no dependencies beyond the BCL
├─ Thirteen.Core.Tests/         xUnit: fixture parity, every day of 0001..9999, edge days
├─ Thirteen.Desktop/            Avalonia 11.3 app (AssemblyName Thirteen), Fluent theme
│  ├─ Views/  Views/Parts/      screens and shared parts (date plate, month grid, comparison, ...)
│  ├─ ViewModels/               AppState, MainViewModel and one view model per screen (no Avalonia types)
│  ├─ Controls/                 drawn charts and panels, arrow-key day navigation
│  ├─ Themes/                   ThemeTokens.cs (generated), ThemeResources/ThemeService, styles
│  ├─ Services/  Support/       settings.json, single instance, local clock; Phrasing (port of Phrasing.swift), links
│  └─ Assets/                   Thirteen.ico, Geist + Geist Mono
├─ Thirteen.Desktop.Tests/      xUnit + Avalonia.Headless: view models, settings, themes, phrasing, window
├─ installer/                   Thirteen.iss (Inno Setup 6) + VM-side build and verify scripts
└─ build-windows.sh             Mac -> Windows VM pipeline: test, publish, smoke, installers
```

## Requirements

- On the Mac: the .NET 10 SDK (`dotnet --list-sdks` shows 10.0.102). .NET 10 is the current LTS; .NET 8
  leaves support in November 2026.
- For packaging: the Windows 11 VM reachable over SSH (`siim@192.168.64.3`, cmd.exe shell). It needs no
  .NET SDK: the app is published self-contained on the Mac. Inno Setup 6 is installed there on first use
  if missing (6.7.0 is installed now).

## Commands

```sh
cd windows
dotnet test                                               # 1835 engine + 516 app tests, a few minutes
dotnet run --project Thirteen.Desktop                     # the app (also runs on macOS for development)
dotnet run --project Thirteen.Desktop -- --page year --theme slate --mode dark   # QA options, below
dotnet run --project Thirteen.Desktop -- --fake-events --route month/2026/11     # Calendar on the mockup data set
dotnet run --project Thirteen.Desktop -- --smoke          # print today's dates, exit 0, no window
dotnet run --project Thirteen.Desktop -- --smoke --date 2024-12-31   # the same for any day
dotnet run --project Thirteen.Desktop -- --smoke-ui --screenshot today.png
dotnet publish Thirteen.Desktop -c Release -r win-arm64 -f net10.0-windows10.0.19041.0 -o publish/win-arm64   # or win-x64
./build-windows.sh                                        # the whole pipeline, unsigned
```

`--smoke` prints the IFC date on its first line and some context:

```
Today (IFC):  Thursday, October 12, 2026 [2026-M11-12]
Gregorian:    Monday, October 19, 2026 [2026-10-19]
Positivist:   Friday, Descartes 12, 238
Year Day in:  73 days
Thirteen 1.0.0 on Microsoft Windows 10.0.26200, process Arm64, OS Arm64, runtime win-arm64, .NET 10.0.2
```

`--quit` closes the Thirteen running in this session (as its close button would) and waits until it has
exited; the installer and the uninstaller use it. `--clear-alerts` removes every toast Thirteen scheduled
and exits 0 (the uninstaller runs it; without a registered app user model id it does nothing).

`Thirteen.Desktop` targets `net10.0` (runs on macOS for development, no toasts) and
`net10.0-windows10.0.19041.0` (the toast scheduler through the Windows SDK projection, `#if WINDOWS`), so
`dotnet publish` needs `-f net10.0-windows10.0.19041.0`; `build-windows.sh` passes it. The projection
(CsWinRT 2.x) brings 35 IL2081 trim warnings from its generic ABI fallbacks, rooted by the module
initialisers of `Microsoft.Windows.SDK.NET` and CommunityToolkit.Mvvm's Windows asset. Thirteen only uses
`ToastNotificationManager`, `ToastNotifier`, `ScheduledToastNotification`, `XmlDocument` and
`UISettings.TextScaleFactor`, all inside try/catch, so `Thirteen.Desktop/ILLink.WindowsSdk.xml` suppresses IL2081 for those two assemblies only,
with that reason written in the file; every other trim warning stays an error. Both architectures publish
trimmed without a warning.

`--smoke-ui` opens the real window, prints the text it rendered and exits (add `--screenshot file.png`
to save it). Over SSH the process runs in session 0 without a desktop, so ANGLE logs Direct3D swap
chain errors; the render itself still works and a watchdog guarantees the exit code. Run the app from the
desktop session to see it normally.

A publish is self-contained, single-file and trimmed: `Thirteen.exe` plus Avalonia's three native
libraries (`libSkiaSharp.dll`, `libHarfBuzzSharp.dll`, `av_libglesv2.dll`) beside it, so nothing is
extracted to `%TEMP%` at start-up, and `Licenses\Geist-OFL.txt`, the licence of the embedded fonts.
Trimming takes `Thirteen.exe` from 92 MB to 24.1 MB (arm64); see Sizes below.

### Launch options (screenshots and QA)

```
Thirteen.exe --page today|calendar|year|convert|compare|history|settings
             --calendar-mode day|week|month|year|list   --route month/2026/11 (a thirteen:// route, below)
             --fake-events (the mockup data set, today 2026-10-19)   --text-scale 1.5 (or 150%)
             --high-contrast [aquatic|desert|dusk|nightsky] (a Windows contrast theme; alone: aquatic)
             --theme almanac|graphite|slate|forest|mono|obsidian|midnight|phosphor
             --mode light|dark|system   --system ifc|positivist
             --date 2026-10-19 (pretend today)   --select 2026-10-19 (day details, and Calendar on that day)
             --year 2024 (Calendar and Compare)   --width 1280 --height 860   --maximized   --scroll top|center|bottom
```

`--page year` opens Calendar in Year mode (Year was a section before Calendar replaced it); `--calendar-mode`
alone opens Calendar in that mode. `--route` takes a route of the table below without its scheme
(`month/2026/11`, `week/2026-10-19`, `day/2026-12-31`, `year/2026`, `calendar`, `new-event?date=...`).
`--text-scale` stands in for the Windows text size: at 150 % and above Month becomes the list of days and
Week falls back to Day (docs/EVENTS.md §2.4, §2.20), and every text grows by the factor (icons keep their
size). Without it Thirteen follows the Windows text size (Settings, Accessibility, Text size), read at start
and whenever the window is activated. Screenshots of the Calendar on the mockup data set:

```sh
dotnet run --project Thirteen.Desktop -- --smoke-ui --fake-events --route month/2026/11 --screenshot month.png
dotnet run --project Thirteen.Desktop -- --smoke-ui --fake-events --page year --screenshot year.png
dotnet run --project Thirteen.Desktop -- --smoke-ui --fake-events --calendar-mode list --screenshot list.png
```

`--high-contrast` stands in for a Windows contrast theme (Settings, Accessibility, Contrast themes) with the default
colours of one of Windows 11's four (below, "Text size and contrast"); without it Thirteen follows Windows.

Any of `--page --theme --mode --system --date --select --year --scroll --calendar-mode --route --text-scale
--high-contrast --fake-events` (and `--smoke-ui`) makes the run
read-only: `settings.json` is read but never written, and the run does not join the single instance. That
holds even when a value is not understood: a bad value (`--page agenda`, `--date 2026-02-30`,
`--year 10000`, `--width -5`, an unknown `thirteen:` link) is reported on stderr, ignored, and the saved
setting stays in force. `--year` wins over the year of `--select`. Obsidian, Midnight and Phosphor are
always dark, so `--mode` only decides what is saved underneath them.
`THIRTEEN_TRACE=1` copies Avalonia's binding and layout warnings to stderr. `--fake-events` (also
read-only) runs on the mockup data set, `fixtures/mockup/mockup-events.json`, embedded in the app, instead
of the stored calendars: nothing is written and no subscription is refreshed. The data set is about Monday,
October 19, 2026 (IFC Thursday, October 12; docs/EVENTS.md §6.7), so a `--fake-events` run is on that day
unless `--date` says otherwise.

Files and links (§6.4 "Command line", docs/EVENTS.md): `Thirteen.exe "C:\path\file.ics"` and
`--import <path>` (`.ics`, `.ical`, `.ifb`, `.zip`, several at once) open the Import dialog with those
files, as files dropped on the window do (a set of Thirteen exports opens "Restore calendars"); `webcal://...`, `webcals://...` and `thirteen://subscribe?url=<percent-encoded link>`
open the Subscribe dialog with the link filled in, and nothing is fetched until Subscribe is pressed. A
second start hands its link and its files (as full paths) to the running window.

### thirteen:// links

The same routes as the Apple apps (`apple/Shared/App/DeepLink.swift`), on the command line or through the
`thirteen:` scheme the installer registers. A second start hands its link to the running window.

| Link | Opens |
|---|---|
| `thirteen://today` | Today |
| `thirteen://calendar` | Calendar in its last mode |
| `thirteen://year/2026` | Calendar, Year mode, 2026 (a Gregorian year, 1 to 9999) |
| `thirteen://year/2024?day=2024-06-17` | Year 2024 scrolled to that day, with its day details |
| `thirteen://month/2026/11` (or `month?year=2026&month=11`) | Month mode: Gregorian year 2026, 13-month month 11 (IFC October; Sol is month 7) of the selected or given system, on today if it is in that month, else on day 1 |
| `thirteen://week/2026-10-19` | Week mode for the 13-month week containing that day (Day at 150 % text) |
| `thirteen://day/2026-10-19` | Day mode on that day (also the target of alert toasts) |
| `thirteen://new-event?date=2026-10-19` | Calendar on that day and the editor for a new event (task W7) |
| `thirteen://convert?date=2026-10-19` (or `convert/2026-10-19`) | Convert, Gregorian side, on that day |
| `thirteen://convert?thirteen=2024-LD` | Convert, 13-month side, on a numeric 13-month date (`2026-M07-01`, `0238-YD` with `system=positivist`) |
| `thirteen://compare/2030` (or `compare?year=2030`) | Compare 2030 |
| `thirteen://history` | History |

Every link takes `?system=ifc|positivist`, which switches (and saves) the calendar system. The scheme and
destination are case-insensitive, `thirteen:year/2026` and `thirteen:///year/2026` work too, and a fragment
is ignored. A year or date that is invalid or out of range (`year/0`, `convert?date=2026-02-29`, a Leap
Day in a common year, `month/2026/14`) keeps the destination and ignores the value; an unknown destination
opens nothing.

## build-windows.sh

Modelled on the owner's Superscribe pipeline, but the publish happens on the Mac and only finished
folders go to the VM:

1. `dotnet test` for `Thirteen.Core.Tests` and `Thirteen.Desktop.Tests` (skip with `--skip-tests`)
2. `dotnet publish -r win-x64` and `-r win-arm64` into `publish/` (stop here with `--publish-only`)
3. SSH check, then copy both builds, `installer/` and the icon to `C:\thirteen-build`
4. `Thirteen.exe --smoke` for both builds on Windows, which must also report the version from
   `Directory.Build.props`; x64 runs under emulation on the Arm64 VM; then, for both builds,
   `--smoke-ui --fake-events --route month/2026/11 --screenshot` (Month on the mockup data set, its title and
   the mockup's calendars in the printed text, the screenshot copied back to `dist/smoke/smoke-ui-<rid>.png`)
   and `--clear-alerts` (exit 0) (docs/EVENTS.md §6.4 "On the VM"; stop here with `--no-installer`)
5. Optional signing of both `Thirteen.exe` (see below)
6. `installer/build-installer.ps1` compiles both installers with ISCC
7. Optional signing of both installers
8. `installer/verify-install.ps1` installs each installer silently, checks the install folder, the Start
   menu entry and its target, the uninstall entry with its version and publisher, and the file version of
   the installed `Thirteen.exe` (`Version.BuildNumber`, e.g. 1.0.0.1), runs `--smoke` through the Start
   menu entry's target, checks the `thirteen:` registration, starts Thirteen and uninstalls while it is
   open, and checks that it was closed and nothing is left, that a scheduled toast is gone and that every
   calendar file in `%LOCALAPPDATA%\Thirteen\Calendars` is kept (not the store's `.lock`, which Thirteen
   deletes when it closes). On a computer without calendars it first puts a calendar with one alert there and
   checks that the started Thirteen schedules that toast and the uninstaller removes it; whatever the check
   created is removed again, also when it fails (skip with `--skip-verify`)
9. Copies the release artifacts back as `dist/Thirteen-<version>-windows-x64-setup.exe` and
   `dist/Thirteen-<version>-windows-arm64-setup.exe` (the names in `docs/RELEASING.md`), plus identical
   copies under the stable names `dist/Thirteen-windows-x64-setup.exe` and
   `dist/Thirteen-windows-arm64-setup.exe` for the `releases/latest/download/` links in
   `design/DECISIONS.md`

`THIRTEEN_WINDOWS_HOST` and `THIRTEEN_WINDOWS_BUILD_DIR` override the VM and its folder.

### Signing (optional)

Signing runs only when `THIRTEEN_AZURE_SIGNING_ENV` points at an env file using these variable names:

```sh
THIRTEEN_AZURE_SIGNING_ENV=/path/to/azure-signing.env ./build-windows.sh
```

| Variable | Meaning |
|---|---|
| `AZURE_SIGNING_KVT` | Azure tenant id (required) |
| `AZURE_SIGNING_KVI` | client id (required) |
| `AZURE_SIGNING_KVS` | client secret (required) |
| `AZURE_SIGNING_ENDPOINT` | optional, default `https://neu.codesigning.azure.net` |
| `AZURE_SIGNING_ACCOUNT` | Trusted Signing account name (required) |
| `AZURE_SIGNING_PROFILE` | certificate profile name (required) |

It uses the same tools on the VM as Superscribe (AzureTrustedSignTool's `signtool.exe` under
`C:\Users\siim\.dotnet\tools\.store\...` and `C:\trusted-signing-client\bin\x64\Azure.CodeSigning.Dlib.dll`,
installed if missing), signs `Thirteen.exe` in both builds before packaging and both installers after,
and verifies each signature. The values are parsed from the file (it is not sourced), sent to the VM in a
PowerShell script over SSH stdin, and never placed on a command line or printed. If the variable is set
but the file lacks one of the five required values, the build stops instead of producing unsigned files.

## Installer

`installer/Thirteen.iss`, compiled once per architecture (`/DArch=x64` or `/DArch=arm64`):

- per-user install into `%LOCALAPPDATA%\Programs\Thirteen`, no administrator rights;
- setup (when it replaces an older version) and the uninstaller first run `Thirteen.exe --quit`, which
  closes the Thirteen open in that session as its close button would (it saves its settings) and waits
  until it has exited, so no file is in use; without it, uninstalling while Thirteen was open left
  `Thirteen.exe` and its libraries behind;
- the uninstaller removes the program folder, the Start menu entry, the uninstall entry and the
  `thirteen:` registration; it leaves `%APPDATA%\Thirteen\settings.json` (the user's theme and calendar
  choices), as most desktop apps keep their settings; delete that folder to start fresh;
- a Start menu entry, an optional desktop icon, a launch checkbox on the last page;
- an uninstaller registered under Settings, Apps (`HKCU\...\Uninstall\{E9148DCE-F491-4088-9E7E-58032C992992}_is1`);
- one AppId for both architectures, so either installer upgrades or replaces the other;
- the `thirteen:` URL scheme under `HKCU\Software\Classes\thirteen` (removed by the uninstaller;
  `verify-install.ps1` checks both);
- alerts (§6.4): the Start menu entry carries the app user model id `HaugasDevelopment.Thirteen` and a
  toast activator CLSID (`E653BA95-A6A1-461C-A730-3CA20783D353`, generated once; Thirteen's toasts use
  protocol activation, so nothing is registered behind it), and
  `HKCU\Software\Classes\AppUserModelId\HaugasDevelopment.Thirteen` gives the toasts their name and
  icon; the uninstaller first runs `Thirteen.exe --clear-alerts`, so no scheduled toast outlives the app;
- files and links: Thirteen in "Open with" for `.ics` and `.ical` (ProgID `Thirteen.ics`, never taking
  the default), and a `webcal` / `webcals` handler (ProgID `Thirteen.webcal`) listed under Default apps
  (`HKCU\Software\HaugasDevelopment\Thirteen\Capabilities`, `RegisteredApplications`); all removed on
  uninstall, and `%LOCALAPPDATA%\Thirteen\Calendars` (the user's events) is kept, like the settings;
- the x64 installer also installs on Windows 11 on Arm (`x64compatible`); the arm64 one requires Arm64.

Version info: `AppVersion` and the uninstall entry show the product version (1.0.0); the setup's file
version is `Version.BuildNumber` (1.0.0.1), the same four-part file version as `Thirteen.exe`. Both
numbers live in `Directory.Build.props` (docs/RELEASING.md: bump `Version` per release, `BuildNumber`
for every build that leaves the machine).

On a Windows machine with this folder: `powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 -Version 1.0.0 -BuildNumber 1`.

## Thirteen.Core

```csharp
using Thirteen.Core;

var today = GregorianDate.Today();                       // local wall-clock date, e.g. 2026-10-19
var ifc = today.ToThirteen();                            // ThirteenMonthDate: IFC October 12, 2026
ifc.Format();                                            // "October 12, 2026"
ifc.Format(new FormatOptions(IncludeWeekday: true));     // "Thursday, October 12, 2026"
ifc.Format(FormatOptions.Numeric);                       // "2026-M11-12"
today.ToThirteen(CalendarSystemId.Positivist).Format();  // "Descartes 12, 238"

var c = new Comparison(today);                           // SPEC 3 diff
_ = (c.WeekdayShift, c.LabelDrift, c.YearProgress);      // 3, 7, 0.797...
today.DaysUntilYearDay();                                // 73

string name = ifc switch                                 // month date or intercalary day
{
    ThirteenMonthDate m => m.MonthInfo.Name,             // "October"
    ThirteenIntercalaryDate i => i.Info.Name,            // "Year Day"
    _ => "",
};

var year = new ThirteenYearLayout(2026);                 // 13 perfect 4 x 7 grids + Year Day
var grid = new GregorianMonthLayout(2026, 10);           // ragged month with 13-month cells
var slots = ThirteenSlot.InYear(2024);                   // picker order, incl. Leap Day
var stats = new YearStats(2026);                         // Friday-13ths, quarters, shapes
var ribbon = new MonthAlignment(2026, CalendarSystemId.Positivist);
var parsed = ThirteenDate.ParseNumeric("0238-M11-12", CalendarSystemId.Positivist);
var next = ifc.AddDays(1).AddMonths(1);                  // November 13, 2026
DateOnly dateOnly = today.ToDateOnly();                  // lossless both ways (same range)
var picked = GregorianDate.FromDateTime(datePicker.SelectedDate!.Value);  // a picker's DateTime; ToDateTime() back
var midnight = today.FirstInstant(TimeZoneInfo.Local);   // first local instant, or null (SPEC 1.5)
var years = GregorianDate.SupportedYears;                // 1..9999, for year steppers
string shown = DisplayText.WithoutDashes(GregorianCalendarInfo.Gregorian.History[^1].Text);  // copy rule, see below
string json = Thirteen.Core.Json.ThirteenJson.Serialize(c);  // the exact @thirteen/core JSON
```

| TypeScript / Swift | C# |
|---|---|
| `GregorianDate {year, month, day}` | `readonly struct GregorianDate`, valid by construction; `default` is 0001-01-01 |
| `ThirteenDate` (`kind: month / intercalary`) | `abstract record ThirteenDate` with `ThirteenMonthDate` and `ThirteenIntercalaryDate` (pattern match) |
| every `year` parameter is Gregorian | same; display years only in text, `DisplayYear` and `system.DisplayYear(...)` / `GregorianYear(...)` / `DisplayYearRange()` |
| `systemId` last, default `'ifc'` | `CalendarSystemId system = CalendarSystemId.Ifc` last; per-system helpers are extension methods |
| throws `RangeError` / `ThirteenError` | throws `ThirteenException : ArgumentException` with a `Kind` (`ThirteenErrorKind`) and a TS-like message |
| `tryParseISODate`, `tryParseThirteen` | `GregorianDate.TryParseIso`, `ThirteenDate.TryParseNumeric` |
| `compare`, `buildThirteenYear`, `yearStats`, ... | constructors: `new Comparison(...)`, `new ThirteenYearLayout(...)`, `new YearStats(...)`, ... |
| `gregorian...(date)` / `thirteen...(date)` | members: `date.Weekday`, `date.DayOfYear`, `date.AddDays(n)`, `date.SameLabel(system)`, ... |
| `Weekday` 0 = Sunday | `enum Weekday` with the same numbers as `DayOfWeek` (`ToDayOfWeek()` / `ToWeekday()`) |
| result JSON | `ThirteenJson` (System.Text.Json) writes the same keys, order and nulls; dates and format options read back with validation |
| `fromJSDate` / `toJSDate` | `GregorianDate.Today(zone)`, `FromInstant(instant, zone)`, `FirstInstant(zone)` |

All arithmetic is integer (Julian Day Numbers and day-of-year), over 0001-01-01..9999-12-31, exactly the
range of `DateOnly`, which is used only at the edges.

### Events

`Thirteen.Core.Events` (`windows/Thirteen.Core/Events`) is the port of `packages/core/src/events`
(docs/EVENTS.md §5.2, naming §5.7): wall-clock times, zone math, RRULE parsing and expansion, 13-month
rules, recurrence (expansion, ends, splits, retimes, recognition, presets, descriptions, adaptation), series
expansion, drafts and alarms, and the Month, Week, Day, agenda and Year layouts. Culture-invariant, ASCII
digits only, no reflection-based JSON.

```csharp
using Thirteen.Core.Events;

var start = LocalDateTime.Parse("2026-10-19T19:00");
var rule = new ThirteenRule.Monthly(CalendarSystemId.Ifc, 12);               // every IFC 12th
var recurrence = new EventRecurrence(RepeatRule.Of(rule));                   // end: never
recurrence.Describe(start.Date);                                             // "Every IFC month on the 12th"
var dates = recurrence.Expand(start.Date, new ExpansionWindow(start.Date, new GregorianDate(2027, 12, 31)));
rule.Encode(start.Date).RRule.ToString();                                    // "FREQ=YEARLY;BYYEARDAY=12,40,68,..."
var utc = ZoneMath.ToUtc(start, "Europe/Tallinn", TimeZoneInfoZoneResolver.Shared);  // 2026-10-19T16:00
var month = new ThirteenMonthEventLayout(2026, 11, occurrences, maxLanes: 3);
```

| TypeScript | C# |
|---|---|
| `LocalDateTime`, `parseLocalDateTime`, `tryParseLocalDateTime` | `readonly record struct LocalDateTime`, `LocalDateTime.Parse` / `TryParse` |
| `normalizeEventEnd`, `displayEnd`, `occurrenceDays`, `addMinutesLocal` | `EventTime.NormalizeEnd`, `DisplayEnd`, `OccurrenceDays`, `AddMinutesLocal` |
| `ZoneResolver`, `zonedToUtc`, `utcToZoned` | `IZoneResolver`, `ZoneMath.ToUtc(...)`, `ZoneMath.ToZoned(...)`; `TimeZoneInfoZoneResolver` (IANA ids through `TimeZoneInfo`, ICU on Windows) |
| `RRule`, `parseRRule`, `tryParseRRule`, `formatRRule`, `rruleEquals` | `sealed record RRule`, `RRule.Parse` / `TryParse`, `.ToString()`, `.IsEquivalentTo(other, ignoreEnd, ignoreWkst)` |
| `untilInZone`, `untilEndDate`, `formatUntil` | `Until.InZone(...)`, `Until.EndDate(...)`, `Until.Format(...)` |
| `ThirteenRule`, `thirteenRuleFor`, `thirteenRuleDatesInYear`, `thirteenRuleIncludes` | `abstract record ThirteenRule` (`Monthly`, `Weekly`, `Yearly`, `Intercalary`), `ThirteenRule.For`, `.DatesInYear`, `.Includes` |
| `encodeThirteenRule`, `thirteenRuleRdates` | `rule.Encode(start)`, `rule.Rdates(start, end, horizon)` |
| `formatThirteenRuleText` / `parse...`, `formatThirteenRuleUri` / `parse...`, `formatDetachedUri` / `parse...` | `.ToMarkerText()` / `ThirteenRule.ParseMarkerText`, `.ToUri(end, extras)` / `ThirteenRule.ParseUri`, `DetachedUri.Format` / `Parse` |
| `RepeatEnd`, `RepeatRule` | `RepeatEnd.Never` / `AfterCount(n)` / `Until(date)`; `RepeatRule.Of(rrule)` / `Of(thirteenRule)` / `Dates` / `Foreign(...)` |
| `EventRecurrence`, `expandRecurrence`, `nextOccurrences` | `sealed record EventRecurrence`, `.Expand(start, window, limit)`, `.NextOccurrences(start, count)` |
| `endRecurrenceBefore`, `laterOccurrenceCount`, `splitRecurrence`, `retimeExceptions` | `.EndBefore(...)`, `.LaterCount(...)`, `.Split(...)`, `.Retime(...)` |
| `recognizeRecurrence`, `repeatPresets`, `matchRepeatPreset` | `Recognition.Of(input, system)`, `RepeatPreset.All(...)`, `RepeatPreset.Match(...)` |
| `describeRecurrence`, `describeNextOccurrences`, `describeRepeatNotes`, `adaptRecurrenceToStart` | `.Describe(...)`, `.DescribeNext(...)`, `.RepeatNotes(...)`, `.AdaptToStart(...)` |
| `expandSeries` | `SeriesExpansion.Expand(series, window, deviceZone, zones, limit)` |
| `EventDraft`, `validateDraft`, `newEventDraft`, `moveDraftStart`, `setDraftAllDay` | `record EventDraft`, `Drafts.Validate`, `Drafts.New`, `Drafts.MoveStart`, `Drafts.SetAllDay` |
| `changedFields`, `mergeDraft`, `applyToSeries` | `DraftMerge.ChangedFields`, `DraftMerge.Merge`, `DraftMerge.ApplyToSeries` |
| `alarmPresets`, `alarmFireTime`, `describeAlarm` | `Alarm.Presets(...)`, `Alarm.FireTime(...)`, `alarm.Describe(...)` |
| `layoutThirteenMonthEvents`, `layoutThirteenWeekEvents`, `layoutDayEvents` | `new ThirteenMonthEventLayout(...)`, `new WeekEventLayout(...)`, `new DayEventLayout(...)` |
| `monthColumnGregorianWeekdays`, `formatChipTime`, `agenda`, `yearEventMarks` | `MonthColumns.GregorianWeekdays(...)`, `ChipTime.Text(...)`, `AgendaDay.Days(...)`, `YearMark.Marks(...)` |
| lists | `ValueList<T>`: read-only, equal by content, so records compare like the TS `plainEquals` |
| throws `RangeError` | `ThirteenException` with `ThirteenErrorKind.InvalidEvent` or `InvalidRule` |
| `thirteenRuleRdateParts`, `parseDateList`, `formatDateList` | not ported (Android only, §5.7) |

### Ics

`Thirteen.Core.Ics` (`windows/Thirteen.Core/Ics`) is the port of `packages/core/src/ics` (docs/EVENTS.md
§5.4): the `.ics` text Windows stores its local calendars in, imports, exports and subscribes to. The
reader is tolerant and keeps every component's text (`Raw`), so the writer copies untouched UID groups,
`VTIMEZONE`s and unread components byte for byte and re-serializes only edited groups, with the properties
of untouched fields as read (§3.6, §4.9). Derived UIDs use the BCL's SHA-256. Windows zone ids map to IANA
through the CLDR `windowsZones` table in `Ics/WindowsZones.g.cs`, generated from
`packages/core/src/ics/windows-zones.ts` by `node windows/scripts/windows-zones.mjs` (`--check` to verify;
`IcsConformanceTests` also compares both tables row by row). Still no dependencies beyond the BCL.

```csharp
using Thirteen.Core.Events;
using Thirteen.Core.Ics;

var calendar = IcsReader.Parse(text, calendarId: "work", zones);           // never throws for damaged input, see Warnings
var window = new DeviceWindow(LocalDateTime.Parse("2026-01-01T00:00"), LocalDateTime.Parse("2027-01-01T00:00"));
var events = IcsExpansion.EventsFromCalendar(calendar, "Europe/Tallinn", zones, window, calendarId: "work");
var group = calendar.Groups[0];
var edited = IcsGroups.ReplaceGroup(calendar, group with { Master = group.Master! with { Summary = "Renamed", Sequence = 1 } });
string stored = IcsWriter.Serialize(edited, zones, now: utcNow);           // every other group byte for byte
var imported = IcsMerge.ImportCalendar(edited, otherText, "work", zones);   // §2.17: imported.Added, .Updated, ...
```

| TypeScript (`@thirteen/core/ics`) | C# |
|---|---|
| `IcsDateValue` (`kind: date / floating / utc / zoned`) | `abstract record IcsDateValue` with `DateValue`, `FloatingValue`, `UtcValue`, `ZonedValue` (pattern match) |
| `IcsEvent`, `IcsGroup`, `IcsCalendar`, `IcsTimeZone`, `IcsObservance`, `IcsWarning`, ... | records of the same names; lists are `ValueList<T>`; warning codes and kinds are enums with `RawValue()` |
| `parseICalendar(text, { calendarId, zones })` | `IcsReader.Parse(text, calendarId, zones)` |
| `serializeICalendar(calendar, zones, { now })`, `THIRTEEN_PRODID` | `IcsWriter.Serialize(calendar, zones, now)`, `IcsWriter.ThirteenProdId` |
| `replaceGroup(..., { keepRaw })`, `removeGroup`, `eventVersion`, `groupVersion` | `IcsGroups.ReplaceGroup(calendar, group, keepRaw)`, `RemoveGroup`, `EventVersion`, `GroupVersion` |
| `withImportBaseline`, `mergeTimeZones`, `renameCollidingTimeZones` | `IcsGroups.WithImportBaseline`, `MergeTimeZones`, `RenameCollidingTimeZones` |
| `newICalendar`, `allDayEnd`, `untilFor`, `withRetimedUntils` | `IcsGroups.NewCalendar(id, name, color)`, `AllDayEnd` (an `IcsAllDayEnd`), `UntilFor`, `WithRetimedUntils` |
| `resolveTzid`, `toUtc`, `buildVTimeZone`, `sameTimeZoneDefinition`, `windowsZoneToIana` | `IcsZones.Resolve`, `ToUtc`, `BuildVTimeZone`, `SameDefinition`, `WindowsZoneToIana` |
| `eventsFromCalendar`, `expandCalendar`, `icsRecognitionInput` | `IcsExpansion.EventsFromCalendar`, `ExpandCalendar` (an `IcsExpansionResult`), `RecognitionInputFor` |
| `IcsExpandedEvent extends EventOccurrence` | `record IcsExpandedEvent` with the same fields; `.ToOccurrence()` gives the `EventOccurrence` |
| `importCalendar`, `restoreCalendar` (`packages/core/scripts/ics-procedures.ts`) | `IcsMerge.ImportCalendar` (an `IcsImportResult`), `IcsMerge.RestoreCalendar` (an `IcsRestoreResult`) |
| options objects | optional parameters (`calendarId: ""`, `zones: null`, `now: null`, `keepRaw: false`, `system: Ifc`, `limit: 10000`) |
| throws `RangeError` | `ThirteenException` with `ThirteenErrorKind.InvalidIcs` (expansion input: `InvalidEvent`, as `SeriesExpansion`) |

`IcsMerge.ImportCalendar` follows the reference step by step. One addition: a group (or override) with
neither `LAST-MODIFIED` nor `DTSTAMP`, where the reference throws because the fixtures never hold one, is
"older than any other" (§2.17): it is added when new, without a baseline line, and never replaces a stored
one.

Two places where the BCL differs from JavaScript, found with `ics-fuzz.sh` (below) and fixed: the reader
upper-cases component names, `STATUS`, `TRANSP`, `ACTION` and parameter values as JavaScript's
`toUpperCase` does (`Ics/JsCase.cs`: the one-to-many mappings of Unicode's SpecialCasing.txt and the dotless
ı, which `ToUpperInvariant` leaves alone, so `STATUS:Straße` is `STRASSE` and `TENTATıVE` is tentative), and
`ExtraDate.DurationMinutes` is a `long`, as TypeScript's number is, so an `RDATE;VALUE=PERIOD` longer than
an `int` of minutes still ends at 9999-12-31T24:00. The only casing differences left are letters of recent
scripts (U+A7CE to U+A7D5, U+16EA0 to U+16ED3) that one runtime's Unicode tables map and the other's do not.

## How parity is guaranteed

`Thirteen.Core.Tests` reads `fixtures/conversions.json` in place (the repository root is found from the
test source path or the test binary; set `THIRTEEN_REPO_ROOT` to override). A missing or truncated fixture
fails the run; nothing is skipped.

- **Every section of the fixture**: all 1620 conversion cases, each its own test case (both directions,
  day-of-year, display year, weekdays, weekday shift, label drift, long format, numeric round trip, JSON
  shape, plus a `DateOnly` cross-check), 68 comparisons, 21 x 63 formatted strings, 39 numeric parsing
  vectors, systems metadata, 14 year stats, 4 month alignments, 4 year layouts, 96 Gregorian month layouts,
  4 slot lists, 37 label lookups, 4 notable-date lists and 32 arithmetic vectors. Sections holding exact
  core JSON are compared key by key, in order, with explicit nulls. Section sizes are asserted.
- **Every day**: all 3,652,059 days of 0001-01-01..9999-12-31 in both systems, checked against
  `DateOnly` and against the SPEC 1.1 / 1.2 day-of-year formulas written out independently in the test,
  including the numeric format round trip and day-by-day succession; and every 13-month date of every year
  mapped back onto consecutive `DateOnly` days.
- **Edges and anchors**: the SPEC 2 anchor table and invariants, the first and last supported day,
  arithmetic past either end, display-year limits (Positivist -1787..8211), validation order, malformed
  ISO and numeric text, SPEC 1.5 time zones (Sao Paulo and Havana skipped midnights, Apia, Kiritimati and
  Kwajalein skipped days).
- **Events** (`EventsFixtureParityTests`): every section of `fixtures/events.json` (version 1, 36 sections,
  1236 cases) replayed from the JSON alone and compared key by key. The envelope must list exactly the
  known sections and every `counts` entry is asserted, so an unknown or truncated section fails. `zones`
  runs through `TimeZoneInfoZoneResolver`: every case on macOS; on Windows (registry zones) one case is
  listed by id with its reason, Samoa's December 2011 date-line change, which the registry rule places at
  the end of 2011 instead of 2011-12-29T10:00Z (`PlatformZoneExceptions`); `zoneMath` through each
  case's synthetic table; `untils`, `series` and `alarmInstants` through `RecordedZoneResolver`
  (`Support/EventsFixture.cs`), built from `zoneOffsets` alone, which throws for a zone or year it does not
  hold. Not implemented, as §5.7 lists for C#: the `dateLists` section and the `parts` field of
  `thirteenRules` (counts and shapes still asserted). Two TypeScript inputs C# cannot express (a `wallClock`
  of 1.5 minutes, a draft `COUNT` of 2.5) are checked to expect a rejection.
- **Culture** (`EventsCultureTests`): every events section replayed again with the thread culture set to
  sv-SE (U+2212 minus sign), tr-TR (dotted and dotless i), th-TH, ar-SA and fa-IR (Thai Buddhist, Umm
  al-Qura and Persian calendars); the results must not change. A number formatted with the current culture
  anywhere in the engine fails it.
- **Random inputs** (`sh windows/scripts/events-fuzz.sh [seed ...]`, on demand, not part of `dotnet test`):
  `scripts/events-fuzz.mjs` builds random cases in the section shapes of `events.json` with the TypeScript
  engine (plain, leap-only repeats around their caps, series on DST transition days and at the range
  edges), with their own `zoneOffsets`, and a copy of `EventsFixtureParityTests` replays them. Needs Node
  22.18 or later; nothing in the repository changes. Run it after engine changes, next to `pnpm fixtures`.
- **Ics** (`IcsConformanceTests`): every file of `fixtures/ics` replayed from `index.json`, through the same
  `RecordedZoneResolver` (never the platform's zone data). Each of the 31 cases: calendar fields, warnings
  (line and code), UID groups key by key, every expansion of its expected file (both device zones,
  Europe/Tallinn and America/New_York, plus the cases' own windows and zones), and the round trip byte for
  byte (28 `as-read`, 3 `zones-added`), which reads back to itself. The 11 procedure files (edits, imports,
  restore): every step's document byte for byte, the import and restore counts, the step expansions. The
  manifest must have exactly its keys and `counts`, and every file under `fixtures/ics` must be listed, so an
  unknown or missing file fails. `IcsUnitTests` covers the API the fixtures do not replay directly
  (lexer, values, generated `VTIMEZONE`s against the recorded offsets, versions, baselines, all-day ends).
- **Random .ics inputs** (`sh windows/scripts/ics-fuzz.sh [seed ...]`, on demand, not part of `dotnet test`;
  `THIRTEEN_FUZZ_CASES` documents per seed, default 300): `scripts/ics-fuzz.mjs` builds random calendar texts
  (components of the `fixtures/ics` cases, mutated; generated events, overrides, `VTIMEZONE`s and other
  components; folds, line ends, a byte order mark, lowercase names, duplicates, unclosed components, bad
  values, Windows, file-defined and unknown `TZID`s) and records what `@thirteen/core/ics` returns for them,
  with the zone offsets it used. `scripts/IcsFuzzReplay.cs`, built in a temporary project with the `Support`
  files, compares everything: the parse (fields, warnings, groups, raw texts), the round trip and its
  read-back, `Resolve` and `ToUtc`, `SameDefinition`, versions, import baselines, `UntilFor`, recognition
  inputs and recognitions, `ExpandCalendar` in several device zones and windows with every `IcsExpandedEvent`
  field (the fixtures compare only the `EventOccurrence` ones), random edits, the §2.17 import and restore
  merges, `BuildVTimeZone` for random zones and years, `AllDayEnd` and the lexer and value helpers. Merges
  where the reference throws for a group without a version are counted, not compared (the addition above).

The engine data is byte-identical to @thirteen/core, ThirteenKit and the Kotlin port, with no exceptions,
and has no en or em dash. The copy rule (no en or em dash in user-visible text, design/DECISIONS.md) is
still applied when text is shown, so engine text added later cannot bring one to the screen:
**pass engine text through `DisplayText.WithoutDashes`** (descriptor names, summaries, history, month
meanings, intercalary descriptions). It is the C# twin of the Apple apps' `Phrasing.withoutDashes`, so the
History screen reads "skipping 3 to 13 September" on every platform; a test runs every descriptor string
through it.

When the TypeScript engine changes: `pnpm fixtures`, then `dotnet test` here, then
`sh scripts/events-fuzz.sh` for the events engine and `sh scripts/ics-fuzz.sh` for the `.ics` module.

## The desktop app

A port of the Apple apps' screens (`apple/Shared`), laid out the Windows 11 way: a navigation pane on the
left (Today, Calendar, Convert, Compare, History, Settings at the bottom), the page on a raised layer with a
rounded corner, the system caption buttons over the extended title bar, and the day details as a pane
beside the page (over it below 1240 px). Below 1008 px the pane becomes a compact rail.

| Screen | What it shows |
|---|---|
| Today | the 13-month date plate with the Gregorian date, year progress in 13 equal months, countdown to Year Day, weekday strips with the weekday shift and label drift sentences, this month's 4 x 7 grid and the Gregorian month with 13-month dates |
| Calendar | the five modes of docs/EVENTS.md §2.1 (Day, Week, Month, Year, List) with the toolbar ("‹", "›", "Today", title and subtitle, "Subscriptions not updated", the mode control, "New event") and the Calendars list in the navigation pane; Year mode is the former Year screen (13 month cards plus Leap Day / Year Day badges, Gregorian dates on or off, event dots; a day opens its comparison, a month title opens Month) |
| Convert | Gregorian to 13-month (calendar + typed ISO date) and back (year, month or intercalary day, day grid), leap-day fallbacks, same-label lookups in both calendars, notable days |
| Compare | month boundaries ribbon, month lengths, Friday the 13th, quarters, month shapes, weekday drift, the three calendars side by side |
| History | timeline and the three calendars' stories |
| Settings | theme picker (five "Light and dark" swatches, three "Dark" ones), light / dark / Windows setting (disabled with a note under a Dark theme) with a live preview, calendar system, Gregorian dates in Year, keyboard shortcuts, version |

Everything on the Apple apps' screens is here, with the same sentences (`Support/Phrasing.cs`). Not ported:
the Mac menu bar extra and the touch layouts of iPhone and iPad. The Gregorian calendar control and the
typed date cover the whole range, 0001-01-01 to 9999-12-31 (the Apple date picker stops at 1583).

Keyboard: Ctrl+1..5 the screens, Ctrl+, Settings, Ctrl+T today (in Calendar: today in its mode), Home today
on the current screen, Ctrl+Left / Ctrl+Right the previous / next page of Calendar's mode (Compare: year),
Alt+Left / Alt+Right previous / next day in the details, Escape closes them, arrow keys move between days in
every grid. Calendar (docs/EVENTS.md §2.21): Ctrl+Shift+1..5 Day, Week, Month, Year, List; Ctrl+N New event;
Ctrl+Shift+K the Calendars list; F5 or Ctrl+R update subscriptions; Ctrl+E and Delete on the selected event;
Ctrl+Z / Ctrl+Y undo and redo (in every section while the window's undo history has a change, so a delete
made from Today's Up next is undone there too; a focused text field outside Calendar keeps its own Ctrl+Z);
Ctrl+O / Ctrl+Shift+E import and export. Windows has no menu bar, so there is no File menu (§2.17 lists
one): Import and Export are Ctrl+O, Ctrl+Shift+E, the Calendars pane's buttons and Settings' Export. In Month,
Enter or F2 goes into the focused day's events, the arrows and Tab move among them, Enter opens one and
Escape returns to the day. Window key bindings see a key before the focused control in Avalonia, so the
ones a text field also uses (Delete, Ctrl+Z, Ctrl+Y, Escape) only act while their command can run. Every day cell, badge, chart and
swatch has an `AutomationProperties.Name` (both dates in words), so Narrator reads the calendar, and every
focusable control has a spoken name (a test fails on an empty one or a type name such as
`Avalonia.Controls.StackPanel`, which is what a button with icon-plus-text content reads otherwise).

Tab order follows the reading order: menu button, the page list (one tab stop; Up and Down move between
the pages, Space or Enter opens one, as in WinUI's NavigationView), today at a glance, Settings, the
header's commands, then the page. Each day grid and the Convert calendar is one tab stop
(`Controls/DayNavigation.cs`, `ConvertView.axaml.cs`): Tab enters on the selected day, else today, and
returns to the day it left; the arrow keys do the rest. Focus rings follow Windows 11: 2 px in the
theme's focus colour with a 1 px paper line inside, 3 px outside the control and rounded to its corners
(`Themes/Controls.axaml`). The pages and the day details have their own clipped adorner layer
(`VisualLayerManager`), so a ring never spills over the header when its control scrolls away.

Pages sit in `Controls/PageColumn`: as wide as the window allows up to the page's `ContentMaxWidth`,
left-aligned under the title like Windows Settings; the header uses the same column, so the title, the
header's commands and the content share their edges at every width.

- **Themes.** `Themes/ThemeTokens.cs` is generated from `design/tokens.json`
  (`node scripts/design/gen-tokens.mjs --targets windows`, do not edit). `ThemeResources.Build` turns a
  theme into one resource dictionary with Light and Dark theme dictionaries: the `Th*` brushes the views
  use (paper, ink, accent, foil, rules, cells, ...) plus Fluent's own keys (`SystemAccentColor`, buttons,
  text boxes, combo boxes, calendar, toggles, radio buttons, flyouts, scroll bars) so standard controls
  wear the theme too. `ThemeService` swaps that dictionary in `Application.Resources` and sets
  `RequestedThemeVariant` (Default follows Windows until Settings pins Light or Dark; Obsidian, Midnight
  and Phosphor force Dark, `ThemeService.Variant`), so a theme change repaints at once, no restart.
  Mono, whose accent is its ink, marks without colour (design/DECISIONS.md): `ThMarkWeight` makes
  Sundays and the current month bold, and `ThFoilBand1/2` hatch the Compare screen's Gregorian bands.
  Sundays are red-letter days in every theme in the small month grids (Year, Today, Convert, Day mode's
  month: accent text numerals, as in the Apple grids and board B2); Calendar's Month mode draws every
  day number in ink, as board A2 and the other platforms do. The selection ring uses the accent text
  colour, which reaches 3:1 on a cell where the accent does not.
- **Type.** Geist and Geist Mono (SIL OFL 1.1, `Assets/Fonts`, licence shipped as
  `Licenses\Geist-OFL.txt`) with tabular figures (`tnum`) wherever numbers line up; Segoe Fluent Icons
  (Segoe MDL2 Assets on Windows 10) for glyphs. Text is greyscale-antialiased so small coloured figures
  look the same in every cell.
- **Copy.** `Support/Phrasing.cs` is a port of `apple/Shared/Support/Phrasing.swift` (one deliberate
  difference: "3 days behind the real one" instead of "behind of"). Engine text goes through
  `DisplayText.WithoutDashes`; a headless test walks every screen in both systems and fails on an en or em
  dash in any text, name or tooltip.
- **State.** `ViewModels/AppState.cs` holds the system, theme, appearance, Gregorian overlay, pane state
  and window placement and saves them to `%APPDATA%\Thirteen\settings.json` (source-generated
  System.Text.Json, atomic write) on every change. The window reopens where it was closed if that spot is
  still on a screen; a new session opens on Today, as on the Apple apps. Every screen keeps its year,
  day and scroll position through theme changes and resizes.
- **Today.** `Services/LocalClock.cs`: the window reads the clock a quarter of a second after each local
  midnight and at least every 30 seconds, and whenever it is activated. Each read refreshes .NET's cached
  time zone first (`TimeZoneInfo.ClearCachedData`), so a time zone changed in Windows Settings reaches the
  running app within 30 seconds; without it, .NET keeps the zone it started with. Screens on the old
  current year (Year, Compare) and a converter on the old today move on with it; a year or day the user
  picked, and an open day details pane, stay.
- **One window.** The first start in a Windows session holds the mutex `Local\HaugasDevelopment.Thirteen`
  (docs/EVENTS.md §6.4). A second start hands its `thirteen://` link, `webcal://` link or files to import (or
  just "come to the front") to the running instance over a per-user local named pipe (pipe names are
  machine-wide, so its name carries the user and the session) and exits. The pipe exists before the first start
  goes on, and closing the instance waits until its pipe is gone, so a start right after another finds the right
  one even on a busy machine. The only
  network use is calendar subscriptions (below).
- **Icon.** `Assets/Thirteen.ico` (window, taskbar, Start menu, installer and uninstaller) is a
  byte-for-byte copy of `design/icon/exports/windows/Thirteen.ico`, the shared "Page 13" artwork with the
  Windows squircle (one icon everywhere, design/DECISIONS.md). Never draw a Windows-only icon: after the
  design export changes, run `sh Thirteen.Desktop/Assets/sync-icon.sh`. `dotnet test` fails while the
  copy differs.
- **Release.** Assembly `Thirteen`, product Thirteen, company Haugas Development OU, version 1.0.0 and
  file version 1.0.0.1 from `Directory.Build.props` (also used for the installer).

### Events: calendars on this computer and subscriptions

docs/EVENTS.md §3.6, §2.15 to §2.17 and §6.4 (tasks W3 and W4). `Services/EventsHost.cs` creates the
services once per run in `App` (never in the tests):

- **`EventStore`**: `%LOCALAPPDATA%\Thirteen\Calendars`, one iCalendar document per calendar
  (`{id}.ics`, its previous copy `{id}.ics.bak`) and `calendars.json` (names, colors, order, visibility,
  subscription state, collapsed groups, failed commits; `.bak` too). Everything loads on a background
  thread at start; occurrences are cached per calendar and year and merged across years by key. Every
  writer (the UI, an import, a subscription refresh, a rename) goes through one queue per calendar and
  rewrites only the UID group it changes, the others copied raw. Before writing, the file's hash is
  compared with the one Thirteen last read or wrote, so a file changed outside Thirteen (the
  `FileSystemWatcher`, or the check before a save) is reloaded first and the save applied to it. Writes
  are atomic: a temporary file written through, then `File.Move` for a new file or `File.Replace` with
  the `.bak` otherwise. A file that cannot be read is renamed `{id}.ics.broken-{yyyyMMddHHmmss}` and its
  `.bak` loaded; with neither readable the calendar stays listed, read-only, and "Delete calendar" moves
  its files to `Calendars\Unreadable\`. `Calendars\.lock` keeps a second process out. First use creates
  "Personal" in the theme accent. QA runs read without writing, locking or creating anything.
- **`WindowsZoneResolver`**: event times through `TimeZoneInfo.GetUtcOffset` (IANA ids through ICU and
  the CLDR Windows zone table), never `TimeZoneInfo.ConvertTime`; `DeviceZoneMonitor` notices a changed
  Windows time zone.
- **`PendingChanges`**: the held moves and deletes of §2.11, written on the toast's close, the next
  action, window close (the window waits for the write), a write or reload of the same calendar, or a
  minute before the event's first alert; one retry on an I/O error, then the revert and the
  `calendar.commitFailed.*` message; a failure while closing is kept in `calendars.json` and reported at
  the next start.
- **`SubscriptionService`**: one `HttpClient` (automatic decompression, up to 5 redirects followed by
  hand, https to http refused, 30 s timeout, 25 MB cap, `User-Agent: Thirteen/1.0 (Windows)`,
  `If-None-Match` / `If-Modified-Since`, a content hash to skip unchanged bodies). One refresh per
  subscription at a time; a response older than the stored copy is dropped; a suspicious response (no
  events where the stored copy has more than 10, or more than 10% of its components unreadable) is held
  back and accepted when the next refresh has the same parse outcome. Due feeds refresh 10 s after start
  and are checked every minute; offline pauses refreshes until 5 s after the network returns.
- **UI** (`Views/Events`): `CalendarsPane` ("On this computer" and "Subscriptions", collapsible with
  "{n} calendars, {m} shown", "Hide all" / "Show all", rows with the visibility checkbox, a color swatch
  button, the "Read only" tag (every subscription, and a local calendar whose file can't be read; the
  name wraps beside it), status lines with "Try again" or "Open folder", the settings button; the
  offline banner; "New calendar", "Subscribe to calendar", "Import .ics file", "Export" and the storage
  line), `SubscribeDialog`, `NewCalendarDialog`, `CalendarSettingsDialog` and `ConfirmDialog`. Every
  dialog with a heading derives from `EventDialogWindow`: the heading is its one title (the title bar has
  no text, only the system close button, which is the one close control), and UI Automation names the
  window by the heading (`AutomationProperties.Name`). `ConfirmDialog` has no heading and keeps its title. The
  Calendar section shows the pane in the navigation pane (below); Import and Export open the flows of
  task W8 (below).

### Calendar

docs/EVENTS.md §2.1 to §2.7 and §2.22 (task W5). `AppSection.Calendar` replaced Year in the same place
(icon, Ctrl+2); `ViewModels/Calendar/CalendarViewModel.cs` holds the mode (first launch: Month), the day
every mode is about (`Date`), paging and titles (`CalendarPeriod` in `CalendarMode.cs`, a port of the web's
`calendarState.ts`), the toolbar's state and the polite announcement after paging. Each mode builds when it
is first shown and refreshes when the day, the system, today or the events change while it is on screen.
`EventsModel` is the one place the views read events from: the store's occurrences for a range of days as
`CalendarItem`s (calendar name and color, read-only reason of §3.5, the labels of §2.20), the load state
and one `Changed` on the UI thread.

- **Toolbar** (`Views/Calendar/CalendarToolbar.axaml`, in the window header): "‹", "›", "Today" (hidden
  while today is on screen), title and subtitle, "Subscriptions not updated" while a visible subscription
  is stale (opens the pane), a progress indicator after 300 ms of loading, the mode control (one tab stop,
  Left and Right switch) and "New event". The mode control and "New event" wrap under the title on a
  narrow window (`Controls/ToolbarLayout`). The window header's calendar system switch is hidden while
  Calendar is shown (§2.1 lists only these controls; Settings switches the system), so Week's toolbar is
  one line at 1280 px. Day's title on an intercalary day has the "No weekday" plate beside it.
- **Year** (`YearModeView`): the former Year screen with up to three 4 px dots per day and badge
  (`yearEventMarks`, hidden by Settings' "Show events in Year view", `AppState.ShowsYearEvents`) and
  "{n} events" as each cell's item status; a month title opens Month.
- **Month** (`MonthModeView`, `Controls/MonthWeekPanel`, `Controls/EventChip.cs`): the two-line weekday
  header, 4 rows sized to the window with as many 20 px lanes as fit (`layoutThirteenMonthEvents`), bars
  and dots with their notched continuations, tentative hatch and canceled strike, "+N more" with the whole
  day in a flyout, the hatched intercalary band under week 4, right-click menus, double-click for a new
  event. At 150 % text and above it is the list of days with runs of empty days, one "time title" line per
  event (board J3).
- **List** (`ListModeView`): from the Calendar's day for a Gregorian year, the next year loading near the
  end and the year before when scrolled up past the start; a sticky month header; the Now plate on the
  rows of events in progress (board J2, checked every 30 seconds).
- **Week and Day** (task W6; `WeekModeView`, `DayModeView`, both on `Views/Calendar/TimelineView`, models in
  `TimelineModeViewModel.cs` and `TimelineModels.cs`, panels in `Controls/TimelinePanel.cs`): the week's
  columns (an intercalary day 60 % wide and hatched) with headers in both calendars (an intercalary head has
  its code plate above its name; a narrow column shortens the Gregorian date to "Oct 15", then "15", instead
  of cutting it), or Day's strip and its details panel (the selected event's full details of §2.10, the same
  `EventDetailsView` as the details dialog with Edit, Delete event and its overflow; else the day's
  comparison, "No events." on an empty day); the all-day
  row with bars in lanes and "+N more" after 3 lanes; the timeline 00:00 to 24:00 (48 px an hour at 100 %
  text), opening at 07:00 or the period's first event, with blocks from `layoutThirteenWeekEvents` /
  `layoutDayEvents` (`maxSlots` = floor(column width / 48), Day / 64) and "+{n}" blocks named
  `calendar.moreAt.a11y` with their events in a flyout; the now line under the blocks (accent in today's
  column, faint in the others, "09:41" on the axis). Each column body is one `Group` named
  `calendar.column.a11y`; the headers (Day: the strip) are one tab stop, Enter or F2 goes into a day's events
  (its bars, then its blocks in start order), arrows and Tab move among them, Enter opens one, Esc goes back.
- **Drag edits** (task W6; `ViewModels/Calendar/EventMover.cs`, `Services/EventMoves.cs`): drag a block to
  another time or day, onto the all-day row (it becomes all-day) or its bottom edge (a new end); drag a bar
  along the all-day row or onto the timeline (one hour there); drag a Month chip or bar to another day;
  Alt-drag duplicates there as an unsaved draft; a drag on empty time makes a draft of that range (15
  minutes). A drop is applied to the event read again from its document, validated like an editor save
  (`EventEditing.IssuesFor` for the time and repeat groups; a refusal shows its text), and on a repeating
  event asks the span first (`Views/Calendar/MoveSpanDialog`: `span.move.*`, the repeat change with
  `laterOccurrenceCount`, `span.future.exceptionsDropped` before the choice, only "this event" for repeats
  set in another app). "This event only" and single events are held in `PendingChanges` and shown at once
  (`EventsModel` overlays pending moves and deletes); "Move future events" is written at once through
  `EventEditing.Save` with span "future events" and has no Undo. The toast with Undo is the actions' if
  they implement `ICalendarMoveFeedback` (W7), else the minimal one in `CalendarView` (`EventMover.Toast`,
  8 seconds, paused under the pointer; the next action, paging or a mode switch commits).
- **States**: "All calendars are hidden." with "Show calendars" (focuses the first hidden calendar's
  checkbox in the pane), and the "Couldn't load events." toast with "Try again".

Seams for the tasks that follow (one file per view, documented on `CalendarViewModel`):

- **W6** Week and Day timelines with drag and drop: done, above. For W7: implement `ICalendarMoveFeedback`
  on the actions to take over the drag toasts and their Undo (Ctrl+Z), and set `EventMover.Ask` to route the
  span question through `IEventsUi.ChooseAsync` if one dialog style is wanted; `ICalendarActions.Duplicate`
  receives the Alt-drag's day and minute, `NewEvent` a dragged range.
- **W7** details flyout, editor, date field, pickers, span dialogs and undo: done, below
  (`ViewModels/Events/EventActions.cs` implements `ICalendarActions` and `ICalendarMoveFeedback`; the main
  window assigns it to `CalendarViewModel.Actions` once it has its events). Tests that want to record the
  requests still replace it with `PlaceholderCalendarActions` after `App.AttachEvents`.
- **W8 and W9** import and export, files and links, toasts, Settings rows, Today's Up next, the day
  details' events: done, below. For W7: the editor's default calendar is `Services/DefaultCalendar.Resolve`
  (Settings' choice while it can be written, else the first local calendar), and `MainWindow.ShowNotice`
  shows a one-line result toast at the bottom of the window.

### Details, editor and undo

docs/EVENTS.md §2.10 to §2.14, §2.19 to §2.21, §4.7 and §6.4 (task W7):

- **Actions** (`ViewModels/Events/EventActions.cs`): the `ICalendarActions` of the window, attached by
  `Views/MainWindow.Editor.cs`, with every window behind `IEventsUi` (`Views/Events/WindowEventsUi.cs`;
  the tests script it). It also implements W6's `ICalendarMoveFeedback`, so drags, deletes and saves
  share one toast (`Views/Events/EventToastHost`, over the page) and one undo stack.
- **Details** (`EventDetailsViewModel`, `Views/Events/EventDetailsView`): a flyout at the item (a dialog at
  150 % text or with nothing to point at): title with the color bar and tag, the date plate in both
  calendars, Time (and "In {city}: ..." for another zone), Repeat, Show as, Location (Windows Maps) and URL
  as links, Notes, Calendar, Alerts, the read-only reason; Edit, More (Duplicate) and Delete event.
  Historical events (before 1583) offer only Edit alerts and Delete event; subscribed ones only Duplicate.
  Duplicate opens an unsaved draft without the repeat, in the same calendar if writable, else the default.
- **Editor** (`EventEditorViewModel`, `Views/Events/EventEditorDialog`): the 560 px dialog of board I1
  (640 px with labels above the fields at 150 %); Add / Save always enabled, errors under their field,
  attached as help text and announced, focus to the first field with one; the merge banner, "This event
  was deleted in another app." and `editor.occurrenceGone`; Escape, Cancel, the close button and Alt+F4
  ask "Discard changes?" / "Discard this event?"; Ctrl+Enter saves; all-day sets Free and restores the
  times, the zone and Busy; the repeat adaptation, later-events and retime notices; Save failures with the
  reason line and a code. Saves go through `Services/EventEditing.cs` (the port of the web's `icsModel`:
  the three-way merge, this / future / all events, splits with a new UID, retimes of the whole series,
  calendar moves written target first) and `Services/EventWriter.cs`.
- **Date field and picker** (`DateFieldViewModel`, `ThirteenDatePickerViewModel`, `Views/Events/
  ThirteenDateField`, `ThirteenDatePickerView`): typed `2026-M11-12`, `2026-YD` or ISO dates, 1583 to 9999
  in the editor, the IFC / Gregorian tabs (the last one used is kept in settings.json `datePickerTab`),
  the year stepper with the leap-only fallback and the leap-repeat stepping, the slot strip, the 4 x 7
  grid (a list of days in a full-size dialog at 150 %), the badge of an intercalary day, the keyboard of
  §2.12, Alt+Down and F4 to open it.
- **Repeat and alerts** (`RepeatPickerViewModel`, `CustomRepeatViewModel`, `AlertOption`): the picker's
  Gregorian and 13-month sections with "Next:" and the notes, Keep for repeats set in another app, Custom
  with its live description; End repeat Never / On date / After; Alert and Second alert (None moves the
  second one up).
- **Span questions** (`SpanQuestions`, `Views/Events/ChoiceDialog`): save (this / future, rule changes
  for future events only with the deletes-later line, repeats set in another app this / all, a new date
  this only), delete (single, this / all future), each with the losses lines before the choice.
- **Undo** (`Services/UndoHistory.cs`): 20 changes per window, Ctrl+Z and Ctrl+Y and the toast's Undo.
  Held moves and deletes are discarded while pending. Written ones and editor saves of a single event or
  "this event only" revert only the field groups the change touched (`EventWriter.RevertAsync`,
  `EventEditing.RevertFields`: title, location, notes, URL, time, alerts, show as and repeat, per member by
  RECURRENCE-ID): the stored group comes back exactly when nothing changed since, a note another app added
  stays, and only a change elsewhere to one of the touched groups gives `calendar.undoUnavailable`. "Future events" and "all events" are never
  registered. Commit failures show their toast with Try again (a second failure has none); failures
  recorded while no window was in the foreground show at the next start or activation (one names the
  event with Try again or Show event, several open "Changes that couldn't be saved").
- **Toast timing** (`EventToastViewModel`, `Services/ScreenReader.cs`): the longer of 8 seconds and
  `SPI_GETMESSAGEDURATION`, paused under the pointer or with focus inside, until the next action while
  `SPI_GETSCREENREADER` says a screen reader runs; Close (32 x 32 px) after the action; Escape inside
  closes it; the next action (another change, paging, Today, a mode or section switch, details, the
  editor) closes it and so writes its held change.

### Import, export, alerts and Today's events

docs/EVENTS.md §2.8, §2.9, §2.14, §2.17, §2.18, §2.20 and §6.4 (tasks W8 and W9):

- **Import** (`Services/ImportExport.cs`, `Views/Events/ImportDialog.axaml`, `ImportExportFlow.cs`): "Import
  .ics file" and Ctrl+O open the file picker (`.ics`, `.ical`, `.ifb`, `.zip`, several files); files
  dropped on the window, given on the command line or handed over by a second start open the same
  dialog. The files are read and counted off the UI thread; each document gets a row "{n} events in
  {file}" with "Add to" (the local calendars, or "New calendar: {name}", the default when the file names
  its calendar). Import merges each document into its calendar through the store's queue
  (`IcsMerge.ImportCalendar`: UID groups, versions and import baselines, override-only groups, colliding
  file-defined zone names renamed "(2)") and shows "Added {a}, updated {u}, unchanged {s}." at the bottom
  of the window, with the skipped and repeated counts when there are any. Errors per file: "This file
  isn't a calendar (.ics) file.", "This file has no events.", the 25 MB / 50,000 events limit.
- **Restore**: when every chosen document is a Thirteen export (`X-THIRTEEN-CALENDAR-ID`), the dialog is
  "Restore calendars" with a checkbox per calendar ("local · 41 events", "subscription"). Each export goes
  back into the calendar with its id (version against version, `IcsMerge.RestoreCalendar`, "{k} events
  changed after this backup, so their newer versions were kept."), or into a new calendar that keeps the
  id, name and color; a subscription comes back with the file as its first copy and its link and
  interval, and refreshes when due; one that still exists is left alone. On a fresh computer the empty
  first-use "Personal" gives way, so a restore gives exactly the backed-up calendars.
- **Export** (`Views/Events/ExportDialog.axaml`): the calendars to export (all, or the one whose settings
  asked), one calendar to a file chosen in the save picker (`{Calendar name}.ics`), several to a folder
  chosen in "Choose a folder", one `.ics` per calendar, names made unique with " (2)" and never written
  over an existing file. Each file carries `X-WR-CALNAME`, the color and `X-THIRTEEN-CALENDAR-ID`; a
  subscription its last copy plus `X-THIRTEEN-SUBSCRIPTION-URL` and `-INTERVAL`, with the note that the
  file contains its private link.
- **Alerts** (`Services/AlertScheduler.cs`): every alert of the visible local calendars in the next 60 days
  (at most 1,000, earliest first) is a scheduled Windows toast, fire times from core's `Alarm.FireTime`
  with each occurrence's UTC start (so a weekly alert keeps its wall-clock time across a DST change),
  title and "19:00 to 21:00, Raamatukoi". The toast activates `thirteen://day/{date}` (protocol
  activation), so a click opens that day whether or not Thirteen runs. The schedule is rebuilt at start,
  one second after the last change of a burst, when the Windows time zone changes and every 6 hours; a
  toast whose id (15 hex digits of a hash of what it shows and when; Windows refuses a scheduled toast id of 16
  characters or more with 0x803E0120, which the VM run of W11 found) is still planned stays, the others are
  removed. The log (`THIRTEEN_TRACE=1`) counts what Windows took, and names each toast it refused. Without a registered app user model id (`dotnet run`, a copied folder) the notifier is
  unavailable and the scheduler turns itself off for the session. `--clear-alerts` removes them all (the
  uninstaller runs it).
- **Settings, Calendar**: "Default calendar" (writable calendars; "New events go to {name}."), "Show
  events in Year view", the alerts note "Thirteen schedules alerts for the next 60 days each time it
  runs.", and "Your data" with "Open folder" and "Export all".
- **Today, Up next** (`ViewModels/UpNextViewModel.cs`, `Views/Parts/UpNextCard.axaml`): under the hero once
  a local calendar holds an event or a subscription exists; "Today", "Tomorrow", then each day as
  "Saturday, October 14" with "Gregorian Wed, Oct 21", 7 days, at most 6 rows and "{n} more in the next
  7 days"; ended events left out, a running one with the "Now" plate; "+" and "Show all in Calendar"
  (List). Empty: "Nothing else today." or "No events in the next 7 days.".
- **Day details** (`DayEventsViewModel`, `Views/Parts/DayEventsView.axaml`): "EVENTS" at the top of the
  details with the day's rows (the Now plate only on today), "New event" and "Open in Calendar" (Day
  mode); "No events." on an empty day.
- **Text size** (`Support/TextScaling.cs`): `UISettings.TextScaleFactor` (1 to 2.25) is read at start and
  on every activation; a coercion of `FontSize` on `TextBlock` and `TextPresenter` scales every text in the
  window and its dialogs, icons excepted. `--text-scale` fixes it for a run. Wrapped text styles use
  `LineSpacing` (extra space added to Geist's own line), not a fixed `LineHeight`, so scaled lines never
  overlap (task W10). At 150 % no text in any Calendar mode, Today, Settings, the editor, the repeat picker or
  the details is cut (`TextScaleTests`): the Calendars pane's group titles and footer labels wrap (its "Hide
  all" moves under the title), Settings' shortcut keys column fits its keys, the date plate's numeral face
  scales down to fit a narrow column, and the toolbar's mode control and "New event" take as many lines as
  they need. At 225 % the editor, pickers and details are still whole (from 150 % the details put each
  label above its value, and the editor's date rows put the date, the time and the caption on their own
  full-width lines); Year's Gregorian month labels in its
  36 px day cells, the comparison facts and weekday strips of the day details beside Day, and the Phosphor
  tile's name in Settings are cut there (docs/events-verification/windows.md).
- **Contrast themes** (`Themes/HighContrast.cs`, docs/EVENTS.md §2.20 "Forced colors and high contrast"):
  when Avalonia reports `PlatformColorValues.ContrastPreference == High` on Windows, Thirteen reads the
  system colours (`GetSysColor`: Window, WindowText, Highlight, HighlightText, HotLight, GrayText, ButtonFace,
  ButtonText) and paints with them instead of the chosen theme, which stays saved: every paper is Canvas,
  text and rules CanvasText, the accent Highlight with HighlightText on it (today, the now line, the selected
  day's 2 px ring), accent text LinkText; the variant is Dark when Canvas is dark. The Calendar's drawn chips,
  bars and blocks follow the web's forced-colors rules (Canvas with a 1 px CanvasText border, no tint or
  colored edge, a dashed border for tentative events, a 2 px Highlight outline when selected), event dots get
  a CanvasText ring, and the intercalary band and column lose their hatch (the band gets a dashed frame). It is
  read when the window is created, when Windows reports new colour values and on every activation;
  `--high-contrast` fixes it for a run. Checked on rendered pixels in `HighContrastTests`; not yet checked
  under a real Windows contrast theme (the VM was down, docs/events-verification/windows.md).
- **Time zone**: the clock timer and window activation ask `DeviceZoneMonitor`; a changed Windows zone
  clears the occurrence cache (events re-expand in the new zone) and rebuilds the alert schedule.

### Tests

`Thirteen.Desktop.Tests` runs the real `App` (styles, fonts, theme service) on Avalonia's headless
platform, so it needs no window system: navigation and shortcuts (Ctrl+1..5, Ctrl+,, Home, Ctrl+arrows,
Escape), the rail below 1008 px, the day details pane, deep links and launch options, the midnight
roll-over, settings persistence (round trip, corrupt file, read-only runs, saved once per change, window
placement on close, an always-dark theme across a relaunch), theme switching (every key in all eight
themes in light and dark, the forced Dark variant, contrast of text on filled controls and of every
colour the port derives on its cell, live repaint without restart, the grouped Settings picker and the
locked appearance), Phrasing against the Apple expectations, the 13-month picker logic, keyboard-only use
(tab order, one tab stop per grid and for the calendar, Up and Down in the pane, Shift+Tab through
Convert), a spoken name for every focusable control on every screen, arrow keys in the Year grid, and
the no-dash copy rule on every screen. Also: the converter across year boundaries and at the ends of the
range (arrow keys in the calendar, links, Open in Convert, Home, a system switch with the 13-month side
open), bad typed dates and years, the keyboard focus staying put when a new day rebuilds the page (arrow
keys in the 13-month day grid, Enter on a notable day) and coming back to the day when the day details
close, the single instance (a second start's link, and `--quit`), the Compare bars labelled with the
engine's short month names (`CompareTests`), every launch option and link form with bad values (`LaunchOptionTests`),
state through all themes and modes, resizes and a relaunch (`StateTests`), and the clock (`ClockTests`:
the midnight schedule, a skipped day, and today following a changed time zone through `TZ` on macOS
and Linux).

The events tests (`Thirteen.Desktop.Tests/Events`) use temp folders, a fixed clock and a feed server on
127.0.0.1 (`HttpListener`), never `%LOCALAPPDATA%` or the network: `EventStoreTests` (Move then Replace with
`.bak`, a deleted file written again, edits and spans, `.bak` recovery and the `.broken-*` rename, both
files unreadable, a second store refused, one Outlook event edited with every other group byte for byte,
a `VTODO`, an unreadable `VEVENT` and the `VTIMEZONE` only the `VTODO` uses kept as read through an edit of
another group, with a generated `VTIMEZONE` for a known zone the file used without one,
a UI save racing an import, a refresh and a rename, a file changed between load and save, the watcher
ignoring Thirteen's own writes), `SubscriptionServiceTests` (200, 304, an unchanged body with a new ETag,
redirects, the https to http downgrade, 401/403/404/410, the 25 MB cap, a slow server, a non-calendar
body, `webcal://` falling back to http, offline, an older response after a newer one, an empty feed and a
12% unreadable feed held back once and then accepted, `.bak`), `PendingChangesTests`,
`WindowsZoneResolverTests` (the `zones` fixture section), `FakeEventStoreTests` (the 405 occurrences of
the mockup data set), the Calendars pane and dialog models (`CalendarsPaneTests`, `SubscribeDialogTests`),
the views on the headless platform with their accessible names and the no-dash walk (`CalendarsUiTests`;
set `THIRTEEN_TEST_SCREENSHOTS=<folder>` to save what they render), and the command line
(`ExternalRequestTests`, a second start's arguments). They also run on Windows 11, where `HttpListener` is
http.sys: the feed server copies each request's headers as it arrives (http.sys disposes a request once its
response closes), and a response that announces more than 25 MB sends its first bytes so its headers go out
(http.sys sends nothing for a response closed short of its length). Tasks W8 and W9: `ImportExportTests` replays every
import and restore procedure of `fixtures/ics` (`imports/*.json`, `restore/restore.json`) through
`ImportExport` and the real store and compares each stored file with the fixture byte for byte, and
covers three Outlook files in one import, a new calendar, file errors, the backup zip on a fresh store
(exactly the three calendars, twice), an older backup, export names and folders that are never written
over, and export then restore on another store; `AlertSchedulerTests` (fire times across the October DST
change, all-day, relative to the end, absolute, two alarms at one moment, the 60-day window, the 1,000 cap,
subscriptions and hidden calendars, the device zone, the toast XML, the diff against Windows' schedule
through a fake platform); `TodayEventsUiTests` (Up next as board B1, its empty and hidden states, the day
details' events, Settings' Calendar rows, the always-dark Appearance note, the text size in the window and
its dialogs, and a file from the command line through the Import dialog to the result toast).

The Calendar tests (`Thirteen.Desktop.Tests/Calendar`) run on the mockup data set: `CalendarModelTests`
(titles and subtitles of every mode in both systems, paging including week 4 of December to January and
Year Day, the hidden "Today", modes built when shown and Week falling back to Day at 150 %, the §2.22
routes and their round trip, Month's labels of §2.20, bars split by row with their continuation flags,
"+N more" at two lanes, the intercalary band, the list of days with its empty runs, selection, Ctrl+E and
Delete on read-only events, List's grouping and "Day 2 of 3", Year's dots and month titles) and
`CalendarUiTests` (the toolbar and the Calendars pane in the window, Month's 28 cells and chips, Enter, F2,
the arrows and Escape, paging focus and the live announcement, every mode with named controls and no
dashes in both systems, Year's dots, List rows and the large-text list of days). Task W6:
`TimelineModelTests` (Week's columns, names, blocks, all-day bars, now line and scroll target, `maxSlots`
and the "+{n}" block, week 4 of December with Year Day, Day's strip and panel; drops planned: single, the
span question, dropped, first-occurrence and converted repeats, the losses line, repeats set in another app,
a refused drop; held, shown at once, undone, committed by Close and by the next action, future events
written at once, the whole series from its first occurrence, read-only events copied but never moved) and
`TimelineUiTests` (column Groups and block names, the keyboard in Week and Day, and mouse drags: move with
the toast and Undo, the bottom edge, empty time, Alt-drag, the all-day row, the span question, the span
dialog, Month chips between days). Task W7: `EventActionsTests` (details and their actions, historical
events with only Delete and Edit alerts, Duplicate as an unsaved draft, Add and Save with their spans and
toasts, calendar moves, an occurrence gone at save time, deleted and changed elsewhere, held deletes with
Undo, Ctrl+Z and Ctrl+Y, written deletes undone, the next action, commit failures with Try again, final
causes, failures recorded for the next start and their list), `EditorModelTests` (defaults, all-day and
Free, midnight ends, validation with focus and announcement, the 1583 floor, typed dates, URLs, the repeat
notices, later events, the retime notice and its losses line, the repeat picker, Custom, alerts, every
closing path, the picker's slots, fallback, leap-repeat stepping, range and keyboard), `EventEditingTests`
(13-month repeats with their marker, this / future / whole-series saves, repeats set in another app kept
as stored, series alerts, deletes, read-only and gone occurrences, the 20-change stack) and `EditorUiTests`
(the window's actions, Ctrl+N and Ctrl+Enter, the toast's names and Ctrl+Z, Escape and Alt+F4 asking, an
error under its field with its icon and as the field's help text, Alt+Down and the picker, stacked rows at
150 %, the details flyout and Edit, the span question's losses line, no dashes in any of them).

The design and data review's findings (2026-10-20) each have a test that failed on the code the review read:
`ReviewFindingsDataTests` (on the real file store: §4.9 rule 3 and the §4.7 UNTIL retiming in saves and
future-events splits, an all-day tail's date UNTIL, a UID already in the target calendar, a zone only its file
defines renamed `{TZID} (2)` on a move, a first event changed on its own saved for future events, an empty
head removed, restored calendar ids, half-written and broken files, field-scoped undo, UTC RECURRENCE-IDs, a
changed event of a series before 1583), `ReviewFindingsUiTests` (on the real window: Ctrl+Z on Today and a
text field's own Ctrl+Z, focus after Delete in Month and in a list, a new-event link or route at start,
"selected" on Month's cells and chips and Week's heads and blocks, the picker's year as one spinner, Day's
full details, the details' order) and `SubscriptionServiceTests` (a feed event without a UID keeps its UID
from a refresh to the next start).

Task W10 (accessibility, `Thirteen.Desktop.Tests/*.cs`): `HighContrastTests` (the `--high-contrast` option,
Windows-only following of the system, every role replaced by the system colours in all four Windows 11 contrast
themes with 4.5:1 text on the washes and fills, and on the rendered pixels: a bar's CanvasText border and Canvas
fill with no colored edge, today on Highlight with HighlightText, the selected day's Highlight ring, blocks and
the now line in Week, ringed Year dots, the dark variant for a dark contrast theme, and the theme back at once
when the contrast theme is turned off), `TextScaleTests` (no text cut in any Calendar mode, Today and Settings
at 100 % and 150 %, nor in the editor, the repeat picker and the details at 100 %, 150 % and 225 %: wider than
its box without an ellipsis or wrapping, cut by a clipping parent, or past the window's edge) and
`KeyboardPassTests` (the events with the keyboard alone on the real window: the mode keys, paging and today,
Tab through the toolbar and grid, Ctrl+N with typed text and the editor's fields, Ctrl+Enter, focus on the new
event, Ctrl+E and Escape, Delete with the question answered by Shift+Tab and Enter, Ctrl+Z and Ctrl+Y, Month's
grid into a day's events and back, Ctrl+Shift+K; every focus stop named).

Task W11 (the VM pass, 2026-10-26) added tests for what Windows showed: `EditorUiTests`
(`TheTimePickersFocusStopIsNamedWithItsTimeAndError`: the time picker's focus stop, its template's flyout button,
reads "Starts, 09:30" and carries the error, not "Avalonia.Controls.Grid"), `AlertSchedulerTests` (toast ids of
15 hex digits, and a fake platform that refuses longer ones as Windows does) and `PendingChangesTests`
(`TheEarlyCommitReadsAbsoluteAlertsInAnyFormAndTheMovedEnd`, review finding #35). `ConvertTests` now passes under
English cultures too (the year box parses integers only). Its wrap-up (2026-10-27) added two `ReviewFindingsUiTests`
(`TheNextRowKeepsTheFocusWhenTheHeldDeleteIsWritten`, `TheDayCellKeepsTheFocusWhenTheHeldDeleteIsWritten`): when a
held delete is written and the views rebuild, the focus stays on the next row in List and on the day cell in Month
(`WindowEventsUi` gives it back to the control that shows the same event or day).

### Sizes

| | x64 | arm64 |
|---|---|---|
| `Thirteen.exe` (trimmed) | 23.7 MB | 24.1 MB |
| publish folder | 38 MB | 37 MB |
| installer | 12.8 MB | 12.1 MB |

These are from before the events. With the events (task W11's VM pass, 2026-10-26, `build-windows.sh` run 4):
`Thirteen.exe` 25,335,950 bytes (x64) and 25,782,432 bytes (arm64), publish folders 40 MB and 39 MB, installers
13,911,379 bytes (x64) and 13,217,644 bytes (arm64).

Untrimmed, `Thirteen.exe` was 92 MB (arm64), the folder 102 MB and the installers about 30 MB. The
events services and the Windows SDK projection (toasts) added about 2.5 MB to `Thirteen.exe`; the
installer sizes above predate them. With the events (2026-10-20, `build-windows.sh --publish-only`):
`Thirteen.exe` 25,299,086 bytes (x64) and 25,745,568 bytes (arm64), publish folders 40 MB and 39 MB; after the
review fixes, 25,331,854 and 25,778,336 bytes.
Trimming is safe here because every XAML binding is compiled (`x:DataType`), settings use source-generated JSON, and nothing is created by
reflection; the trimmed builds were run on the Windows 11 Arm64 VM (x64 under emulation) through every
screen in all five themes, light and dark, a settings.json round trip with window placement, and the
single-instance hand-over of a `thirteen://` link; after the design review the trimmed arm64 build was run
there again through every screen in all eight themes, at the minimum size, 1280 x 800, 1280 x 672 and
maximised.

### Screenshots on the VM

The app has to run on the VM's interactive desktop (session 1); SSH sessions run in session 0, which has no
desktop. `scripts/vm/vmjob.sh` runs a PowerShell job there through a scheduled task (`schtasks /it`, task
`ThirteenQA`, folder `C:\thirteen-qa`) with the helpers of `scripts/vm/lib.ps1`: start Thirteen, find and invoke
UI Automation elements by name (the same tree Narrator reads), dump that tree, and capture a window with its
dialogs and popups drawn over it (`PrintWindow` with `PW_RENDERFULLCONTENT`, per-monitor DPI aware, cropped to the
DWM frame), so other apps on the desktop never appear in a capture.

```sh
# after build-windows.sh; Start-Process -Wait, because Windows ends what an SSH session started when it closes
ssh siim@192.168.64.3 "powershell -Command Start-Process -Wait C:\thirteen-build\dist\Thirteen-1.0.0-windows-arm64-setup.exe /VERYSILENT"
sh scripts/vm/screenshots.sh                       # the six docs/screenshots/windows-*.png, and their UI Automation trees
sh scripts/vm/vmjob.sh scripts/vm/v13.ps1 2400 Arch=arm64   # V13 without the reboot: toast with Thirteen closed, click, uninstall
sh scripts/vm/vmjob.sh --clean                     # remove the task and C:\thirteen-qa
```

`screenshots.sh` runs the installed Thirteen on the mockup data set (`--fake-events`, today 2026-10-19),
Almanac at 1440 x 900, light unless the name says dark: Month, Month dark, Week, the editor on "Book club:
Cotsworth" (board I1), the Subscribe dialog after a successful check of Google's public United States holidays
feed (board D2; nothing is subscribed), and the Calendars pane with a subscription's settings. It fails when a UI
Automation name has a dash, reads as a type name (`Avalonia.Controls.Grid`), or a focusable element has no name.
`v13.ps1` works only on a computer without a Thirteen store and removes everything it created; it uninstalls
Thirteen.
