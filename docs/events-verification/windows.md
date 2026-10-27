# Windows verification gates

The Windows team's record of the verification gates of [docs/EVENTS.md §8.2](../EVENTS.md#82-verification-gates)
(V11 and V13; the index is [README.md](README.md)) and of its release checks of §8.3 (items 1, 3, 6 for the
Windows screenshots, and 7). Each run is recorded under its gate as README.md "How to record a run" describes.
Newest first: the cross-platform review fixes (2026-10-27, Mac only), the W11 wrap-up (2026-10-27, Mac only), the
W11 VM pass (2026-10-26 and 27), the W3 and W4 re-check
of the store and subscriptions, the W2 re-check of the `.ics` port, the W1 re-check of the events port, the review
fixes, tasks W10 and W11 of 2026-10-20 (QA, with the VM off), then the checks of W8 and W9 and of W7 that the gates
build on.

None of this is committed: `windows/`, `docs/screenshots/` and this folder are untracked on HEAD `7753452`, and
`windows/dist/` and `windows/publish/` are ignored by `windows/.gitignore`.

## Status

| Gate | Status |
|---|---|
| V11 | not run (owner-run: Apple Calendar on macOS 26, Google Calendar web, Outlook web and Thunderbird with real accounts). The days to expect are in "V11" below. The input files exported through the Windows export path on 2026-10-20 were in `/tmp` and are gone; export them again (Export in the Calendars pane, mockup data set) before the run. |
| V13 | **failed** on the build of 2026-10-26 (`build-windows.sh` run 4, W11 VM pass below): Windows refused every toast Thirteen scheduled (`0x803E0120`: the toast ids had 16 characters, Windows takes at most 15), so no alert fired and the click leg could not run. Fixed in the code (15-character ids, `AlertPlanner.IdLength`) and pinned by `AlertSchedulerTests`, green on macOS (W11 wrap-up below). The fixed code is published on the Mac (`windows/publish/`, 2026-10-27 01:04 and 01:07) but has never run on Windows: the VM went down at about 01:04 and was still down in the wrap-up. `windows/dist/` still holds run 4's installers (2026-10-26 23:55), without the fix. Left: rebuild, then the closed-app, click and uninstall legs on both architectures ("What is left on Windows" below). The reboot leg is owner-run. |

| Release check (§8.3) | Status |
|---|---|
| 1, parity in C# | green on macOS: `Thirteen.Core.Tests` 1835 of 1835 with `THIRTEEN_PERF_SCALE=3` (last run in the W11 wrap-up; events.json with every `counts` entry, the same again under five other cultures, fixtures/ics in both device zones, edits, imports and restore), plus 264,150 random events cases (W1 re-check below) and 3,900 random `.ics` documents (349,463 checks, W2 re-check below) with no difference. On Windows 11 (build 26200) every events and `.ics` test passes (127 of 127, W2 re-check) and a random `.ics` file replays with no difference; the whole suite has 4 failures, all in the calendar engine's `EdgeDayTests.FirstInstant_*` (registry zone data, W1 re-check), none in events or `.ics`. Those 4 are still open: they need a Windows exception list or a 1 ms rounding fix in the calendar engine, and the suite has not run on Windows since. |
| 3, Windows accessibility | partial: high contrast built and checked on rendered pixels, 150 % text checked with no cut text, a keyboard-only pass and the §2.20 names, all automated on Avalonia's headless platform (W10 below, green again in the W11 wrap-up); the review's accessibility findings (Selected traits, the year spinner, error help text and icons, focus after Delete, 32 px targets, the details at 225 %) fixed and tested (review fixes below). On Windows (W11 VM pass): the UI Automation trees of six screens, as Narrator reads them, have no dash, no unnamed focus stop and, after a fix, no type name (the editor's time pickers read "Avalonia.Controls.Grid"). Fixed in the W11 wrap-up: the focus left a list row or day cell when a held change was written (§2.20 "Focus after actions"); tested on the headless platform only. Owner-run, because each changes a system-wide setting of the shared VM: Narrator itself, a real contrast theme and the real Windows text size. Still cut at 225 % text on older screens (W10 below). |
| 6, screenshots (Windows part) | **to retake**: the six `docs/screenshots/windows-*.png` of §6.4 were taken on the VM on 2026-10-27 at about 00:13 (installed arm64 build of run 4, desktop session, real Segoe Fluent Icons, 1440 x 900; W11 VM pass), before the cross-platform review fixes (below) changed what they show: all six show the Calendars pane without the "Read only" tag on the two subscriptions, the five over Month draw Sundays 1, 8, 15 and 22 in the accent colour, and the editor and Calendar settings dialogs show their title twice (title bar and heading), the editor also an inner close button (the Subscribe dialog's title bar text goes too). Retake them with `scripts/vm/screenshots.sh` on the next VM session. |
| 7, `verify-install.ps1` on both architectures | **pass** on the build of 2026-10-26 (W11 VM pass): `PASS` for x64 and arm64 in runs 2, 3 and 4 (and x64 in run 1), with the toast check run (not skipped) over SSH, every calendar file kept, the scheduled toast removed and the open Thirteen closed. Run 1's arm64 failed on a script bug (the store's `.lock` counted as a calendar file), fixed. Since then (2026-10-27 01:01) it also checks, end to end, that the installed Thirteen schedules its own alert toast and that the uninstaller removes it. That check has never run (VM down) and needs the toast id fix, so the next `build-windows.sh` run is its first. |

## What is left on Windows

**The one Windows item left for the next VM session: V13 on the fixed build.** Windows code changed after the
installers in `windows/dist/` were built (2026-10-26 23:55): `Thirteen.Desktop/Services/ToastPlatform.cs` (00:49) and
`Services/AlertScheduler.cs` (00:56), the toast ids, `installer/verify-install.ps1` (01:01), and the wrap-up's focus fix
in `Thirteen.Desktop/Views/Events/WindowEventsUi.cs` (2026-10-27 02:01, after `windows/publish/` too), and the
cross-platform review fixes (2026-10-27 04:30 to 04:45: the "Read only" tag, Month's Sundays, the dialogs' titles). So
the installers must be built again first, and the six screenshots retaken after it (`sh scripts/vm/screenshots.sh`,
release check 6). When `ssh siim@192.168.64.3` answers (agents do not start UTM or the VM, and never reboot
it; that is the owner's call), from the repository root:

```sh
cd windows
./build-windows.sh --skip-tests    # publish, smoke, UI smoke, ISCC, verify-install.ps1 with its alert-toast check, dist/
for arch in x64 arm64; do
  ssh siim@192.168.64.3 "powershell -Command Start-Process -Wait C:\thirteen-build\dist\Thirteen-1.0.0-windows-$arch-setup.exe /VERYSILENT"
  sh scripts/vm/vmjob.sh scripts/vm/v13.ps1 2400 Arch=$arch    # about 18 minutes: toast A with Thirteen closed, its click, uninstall, no toast B
done
mkdir -p /tmp/thirteen-v13 && scp 'siim@192.168.64.3:C:/thirteen-qa/v13-*' /tmp/thirteen-v13/   # trace, banner and click captures
sh scripts/vm/vmjob.sh --clean     # removes the ThirteenQA task and C:\thirteen-qa
```

`--skip-tests` because both suites passed on the Mac on this code in the W11 wrap-up; drop it if anything in
`windows/` changed since. Each architecture passes when its job log (printed by `vmjob.sh`) has `scheduled toasts seen after start: 2`, a
`banner at ...` line and `click: invoke on '...V13 toast <arch> A...'`, an `after click: Thirteen.exe ... command
line:` with `thirteen://day/`, `uninstalled: exit 0; program folder present: False`, and `toast B ... after
uninstall: not shown`. `v13.ps1` refuses to run where a Thirteen store already exists, uninstalls Thirteen at its end
and removes the store and settings it created. The same session should remove what the W11 VM pass left there (its
"State left on the VM" below): the scheduled task `ThirteenW11`, `C:\thirteen-w11`, and
`%TEMP%\is-3072V9VVTA-uninstall.tmp` if it is still there. Record the result under V13 here and in the status table.

Owner-run, unchanged: V11 (imports into Apple Calendar, Google Calendar web, Outlook web and Thunderbird, from
files exported again), the V13 reboot leg, Narrator, a real Windows contrast theme and the real Windows text size. Known and open, outside the
gates: the 4 calendar-engine `EdgeDayTests.FirstInstant_*` failures on Windows (release check 1), the cuts at 225 %
text on the older screens (W10), and a real-store pass through the UI on Windows (create, edit, repeat, delete,
import and export in `%LOCALAPPDATA%`), which no task has run (the V13 and `verify-install.ps1` runs use a real store,
but only through files they put in place).

## Cross-platform review fixes (2026-10-27, Mac only)

Not a gate run: the three Windows findings of the cross-platform consistency review, all minor, fixed on the Mac and
tested on Avalonia's headless platform. The VM was down (`ssh -o ConnectTimeout=6 siim@192.168.64.3` at 04:28 and
04:45: `ssh: connect to host 192.168.64.3 port 22: Operation timed out`), so nothing was run on Windows and the
screenshots were not retaken (release check 6 above).

- **When:** 2026-10-27, 04:25 to about 04:50 EET. **Host:** the shared Mac, .NET SDK 10.0.102, load average 25 to 590.
- **"Read only" on subscriptions** (§2.15; boards A2 note 9, D note 22; the web and the Mac show it): the tag was set
  only for an unreadable local calendar. Now `CalendarRowViewModel.IsReadOnly` is `!calendar.IsWritable` (every
  subscription, and a local calendar whose file can't be read), with the status line kept. With the tag beside it the
  name was cut to "Holidays in Est..." in the 256 px pane, so the name now wraps to at most two lines, as on the web
  (`Views/Events/CalendarsPane.axaml`). Test: `ReviewFindingsUiTests.SubscriptionsCarryTheReadOnlyTag` (the tag on
  Holidays in Estonia and Birthdays only, the status lines, the name not cut).
- **Month's Sunday numbers** (board A2; the Mac, web and Android Month draw them in ink): Month drew 1, 8, 15 and 22 in
  the accent text colour. The `sunday` class and its style are gone from Month (`Views/Calendar/MonthModeView.axaml`,
  `Themes/Calendar.axaml`; the unused `MonthDayCell.IsSunday` removed); Year, Today, Convert and Day mode's month keep
  their red-letter Sundays (board B2). Test: `ReviewFindingsUiTests.MonthDrawsSundayNumbersInInk` (every day number
  but today's in `ThInk`, which differs from `ThAccentText`).
- **Dialogs showed their title twice and the editor two close controls** (board I1 and the web: one heading, one
  close control): the title bar read "Edit event" or "Calendar settings" over the same heading, and the editor and
  the repeat picker had an inner close button besides the title bar's. The heading stays (as the boards draw it), the
  title bar has no text, and its close button is the one close control: the dialogs with a heading derive from the
  new `Views/Events/EventDialogWindow.cs`, which clears `Title` (a window's default title is "Window") and names the
  window for UI Automation from `AutomationProperties.Name` (Avalonia's window peer reads only `Title`), so Narrator
  still announces "Edit event". That covers the editor, Calendar settings, New calendar, Subscribe, Import, Export,
  the repeat picker, Custom repeat, the questions (`ChoiceDialog`, `MoveSpanDialog`), the failed changes list and the
  details when they open as a dialog (they repeated the event's title). The inner close buttons of the editor and
  the repeat picker are gone (Escape, Cancel, the title bar's close button and Alt+F4 still ask before discarding).
  `ConfirmDialog` (no heading) and the date picker dialog (no heading) keep their titles. The title bar itself is not
  drawn on the headless platform, so what Windows shows there is unverified until the next VM session. Test:
  `ReviewFindingsUiTests.DialogsShowTheirTitleOnceWithOneCloseControl` (editor, Calendar settings and the details
  dialog: no title text, the automation name, the heading once, no inner Close button); `EditorUiTests`,
  `CalendarsUiTests` and `TodayEventsUiTests` now read the dialog's automation name instead of `Title`.

Runs, from `windows/`:

- **Build:** `dotnet build Thirteen.Desktop.Tests/Thirteen.Desktop.Tests.csproj --artifacts-path bin/xpf2-art` (and
  `Thirteen.Core.Tests` into `bin/xpf-art`): `0 Warning(s)`, `0 Error(s)`.
- **The changed classes first** (`ReviewFindingsUiTests`, `EditorUiTests`, `CalendarsUiTests`, `TodayEventsUiTests`,
  `CalendarsPaneTests`, `CalendarModelTests`): `Failed: 1, Passed: 95, Total: 96`, the one
  `CalendarsPaneTests.HideAllAndShowAllChangeThirteensOwnVisibility` (its 8 s `Eventually` timed out at load average
  229); `CalendarsPaneTests` alone three times: `Passed: 16` each. On the final code, `ReviewFindingsUiTests`,
  `TextScaleTests` and `EditorUiTests`: `Failed: 1, Passed: 29, Total: 30`, the one
  `EditorUiTests.CtrlNOpensTheEditorAndCtrlEnterAdds` line 116 (the save not finished, load average 517);
  `EditorUiTests` alone three times: `Passed: 9` each.
- **Whole Desktop suite, final code:** `dotnet test bin/xpf2-art/bin/Thirteen.Desktop.Tests/debug/Thirteen.Desktop.Tests.dll`:
  `Passed!  - Failed: 0, Passed: 516, Skipped: 0, Total: 516, Duration: 2 m 16 s` (513 plus the three new tests).
  An earlier full run on the build before the details-dialog change: `Passed: 516` too (2 m 10 s).
- **Core:** `THIRTEEN_PERF_SCALE=3 dotnet test bin/xpf-art/bin/Thirteen.Core.Tests/debug/Thirteen.Core.Tests.dll`:
  `Passed!  - Failed: 0, Passed: 1835, Skipped: 0, Total: 1835, Duration: 9 s` (Core not changed).
- **Trimmed publish of the Windows target** (`dotnet publish Thirteen.Desktop/Thirteen.Desktop.csproj -c Release -r
  win-x64 -f net10.0-windows10.0.19041.0`, private artifacts and output folders): exit 0, no warning in the log,
  `Thirteen.exe` 25,335,950 bytes (40 MB folder), `EventDialogWindow` in the bundle. Not run on Windows; arm64 not
  published.

Changed: `windows/Thirteen.Desktop/ViewModels/CalendarsPaneViewModel.cs`, `Views/Events/CalendarsPane.axaml`,
`Views/Calendar/MonthModeView.axaml`, `Themes/Calendar.axaml`, `ViewModels/Calendar/MonthModeViewModel.cs`,
`Views/Events/EventDialogWindow.cs` (new), ten dialog XAML files and their code-behind in `Views/Events`,
`Views/Events/ConfirmDialog.axaml.cs` (a comment), `Views/Calendar/MoveSpanDialog.axaml.cs`, `Views/Events/WindowEventsUi.cs`
(the details dialog), `ViewModels/Events/EventEditorViewModel.cs` (the unused `CloseText`), the tests named above
plus `Calendar/CalendarModelTests.cs`, `windows/README.md` and this file.

## W11 wrap-up (2026-10-27, Mac only)

Not a gate run: the end of task W11, whose agent was cut off at 01:13 while rewriting this file. It ran both Windows
test projects on the final code, fixed the one failure (a real focus bug, below), checked the scripts and the
evidence on the Mac, and finished this record. The VM was still down, so V13 was not run again.

- **When:** 2026-10-27, 01:18 to about 02:15 EET, by the W11 wrap-up agent.
- **Code:** the working tree on HEAD `7753452` plus the uncommitted events work. As found, the last Windows source
  change was `Thirteen.Desktop/Services/AlertScheduler.cs` at 00:56 (the toast ids) and the last script changes
  `installer/verify-install.ps1` at 01:01 and `scripts/vm/*` at 01:02 to 01:03; this task then changed
  `Views/Events/WindowEventsUi.cs` (02:01), `ReviewFindingsUiTests` and two scripts (below).
- **Host:** macOS 27.0.1 (26A434), .NET SDK 10.0.102, the shared machine (load average 480 to 930).
- **VM:** down. At 01:18 `ssh -o ConnectTimeout=5 -o BatchMode=yes siim@192.168.64.3` gave `ssh: connect to host
  192.168.64.3 port 22: Operation timed out`, `ping` lost every packet, the Mac had no `bridge100` interface and no
  UTM process; the VM's disk (`Windows.utm/Data/*.qcow2`) and its `screenshot.png` were last written at 01:04:25.
  The UTM app was opened again at 01:26:58, not by this task, but the VM stayed off: at 02:03 and again at 02:10
  there was still no `bridge100` and no QEMU process for it, and `ssh` timed out the same way. This task started neither (the task's
  rule).
- **Result:** pass on the Mac after one fix (below). V13 not re-run; it is the one item in "What is left on Windows".

Runs, from `windows/`, with private build folders inside the ignored `bin/`:

- **Build:** `dotnet build Thirteen.Desktop.Tests/Thirteen.Desktop.Tests.csproj --artifacts-path bin/w11c-art` and the
  same for `Thirteen.Core.Tests`: `0 Warning(s)`, `0 Error(s)` for both.
- **The classes W11 changed, first:** `dotnet test bin/w11c-art/bin/Thirteen.Desktop.Tests/debug/Thirteen.Desktop.Tests.dll
  --filter "FullyQualifiedName~AlertSchedulerTests|FullyQualifiedName~PendingChangesTests|FullyQualifiedName~EditorUiTests|FullyQualifiedName~ConvertTests"`:
  `Passed!  - Failed: 0, Passed: 56, Skipped: 0, Total: 56`.
- **Whole Desktop suite, as found:** `dotnet test bin/w11c-art/bin/Thirteen.Desktop.Tests/debug/Thirteen.Desktop.Tests.dll`:
  `Failed!  - Failed: 1, Passed: 510, Skipped: 0, Total: 511, Duration: 23 m 43 s`. The failure:
  `ReviewFindingsUiTests.DeleteInAListMovesFocusToTheNextRow [59 s]`, `System.NullReferenceException` at
  `ReviewFindingsUiTests.cs:line 175` (no focused element after the delete). The W3 and W4 re-check had seen the same
  failure once on the slow VM and left it as timing.
- **Core:** `THIRTEEN_PERF_SCALE=3 dotnet test bin/w11c-art/bin/Thirteen.Core.Tests/debug/Thirteen.Core.Tests.dll`:
  `Passed!  - Failed: 0, Passed: 1835, Skipped: 0, Total: 1835, Duration: 2 m 40 s`. Core was not changed after it.

**The failure was a real bug: a written change took the keyboard focus away.** A probe with the toast's time set to
an hour, so that its timer could not fire, and the toast then closed by hand showed it whatever the load: after
Delete in List the focus is on the next row, as §2.20 asks, but when the held delete is written (the toast's timeout,
its Close button or the next action), the store change rebuilds the list, the focused row's control goes, and nothing
has the focus (`Assert.NotNull() Failure: Value is null`). Month's day cell lost it the same way. Under load the
8-second toast timed out inside the test, which is why only a busy machine (and the slow VM) failed. Store changes
also come from a subscription refresh or another app's edit of the file, so a focused chip, block, row or day cell
could lose the focus the same way at any time; List and Month are the cases tested.

- **Fix** (`Views/Events/WindowEventsUi.cs`): the window watches the focused chip, block, row or day cell; when a
  rebuild removes it and nothing else has taken the focus (and no event dialog or details flyout is open), the
  control that now shows the same event, or the same day, gets it back, with the same navigation method.
- **New tests** (`ReviewFindingsUiTests`): `TheNextRowKeepsTheFocusWhenTheHeldDeleteIsWritten` (List: the held delete
  written through the toast's close, the row rebuilt, the focus on the next row) and
  `TheDayCellKeepsTheFocusWhenTheHeldDeleteIsWritten` (Month: the deleted event's day cell). Without the fix both fail
  (`Assert.NotNull() Failure: Value is null` at lines 221 and 244, checked by turning the watch off for one run);
  with it `ReviewFindingsUiTests` passes 13 of 13.
- **Whole Desktop suite, with the fix** (built again into `bin/w11c2-art`: `0 Warning(s)`, `0 Error(s)`): `dotnet test
  bin/w11c2-art/bin/Thirteen.Desktop.Tests/debug/Thirteen.Desktop.Tests.dll`: `Passed!  - Failed: 0, Passed: 513,
  Skipped: 0, Total: 513, Duration: 7 m 42 s` (511 before, plus the two new tests).
- **Trimmed publish of the Windows target with the fix** (`dotnet publish Thirteen.Desktop -c Release -r win-x64 -f
  net10.0-windows10.0.19041.0`, private output and artifacts folders, warnings as errors): exit 0 with no warning in
  the log; `Thirteen.exe` 25,335,950 bytes, the folder 40 MB. Not run on Windows (VM down); arm64 not published.
- **Scripts:** the five PowerShell scripts (`installer/verify-install.ps1`, `installer/build-installer.ps1`,
  `scripts/vm/lib.ps1`, `v13.ps1`, `screenshots.ps1`) parse with no error in PowerShell 7.6.9 on the Mac
  (`[System.Management.Automation.Language.Parser]::ParseFile`; nothing was run, the Windows APIs they call do not
  exist there). `bash -n` passes for `build-windows.sh`, `scripts/vm/vmjob.sh` and `scripts/vm/screenshots.sh`.
  `screenshots.sh`'s three UI Automation checks, run on the six saved trees (`/tmp/w11b-shots/final/*-tree.txt`): no
  dash, no type name, every focusable element named.
- **What the files show:** `windows/publish/win-x64/Thirteen.exe` (25,335,950 bytes, 01:04) and
  `win-arm64/Thirteen.exe` (25,782,432 bytes, 01:07) are run 5's publishes and hold the fixed toast code (its new
  log text, `alerts planned` and `schedule-refused`, is in both bundles), but not this task's focus fix.
  `windows/dist/` holds run 4's installers (23:55; 13,911,379 bytes x64 and 13,217,644 bytes arm64, each under both
  names), built before the fix. `docs/screenshots/windows-*.png` (00:14) are byte for byte the VM captures in
  `/tmp/w11b-shots/final/` (00:13), 1440 x 900 each.

Changed by this task: `Thirteen.Desktop/Views/Events/WindowEventsUi.cs` (the focus fix) and
`Thirteen.Desktop.Tests/Events/ReviewFindingsUiTests.cs` (the two tests); `scripts/vm/v13.ps1` (its header comment
said A alerts about 3 minutes and B about 9 minutes from now; the code makes it 7 to 8 and 15 to 16, as the
2026-10-26 run logged) and `scripts/vm/screenshots.ps1` (the
editor shot's fallback, Enter on the chip and Edit in its details when Ctrl+E opened no dialog, which the run that took
`windows-event-editor.png` had and the tidied script had lost); `windows/README.md` (the test counts and the new
tests); this file (the W11 VM pass entry below, from the W11 agent's draft checked against the logs on the Mac; the
status; what is left; notes in the older entries where their open items have since been done or their `/tmp` files
are gone).

## W11: the VM pass (2026-10-26 and 27)

Task W11 on the VM at last: §6.4 "On the VM", the installers, `verify-install.ps1` (§8.3 item 7), the UI smoke on
the mockup data set, V13 without the reboot, the trimmed builds, Windows UI Automation (§8.3 item 3) and the six
screenshots. It found three bugs, one of them a V13 failure, and fixed them.

- **When:** 2026-10-26 23:25 to 2026-10-27 01:13 EET, by the W11 agent (cut off while writing this entry; the
  wrap-up above finished it).
- **Code:** the working tree on HEAD `7753452` plus the uncommitted events work, with this task's changes (below).
- **Hosts:** macOS 27.0.1, .NET SDK 10.0.102, a machine shared with other agents (load average 20 at the start,
  470 to 820 from about 00:00). The build VM: Windows 11 build 26200.9711 Arm64, 4 GB, en-US, time zone FLE
  Standard Time, 3456 x 1998 at 100 %, Inno Setup 6 (`C:\Program Files (x86)\Inno Setup 6\ISCC.exe`), signed-in
  desktop session 1 (not locked), another app running there and left alone. No Thirteen was installed and there was
  no Thirteen store or settings before this task, and none after its last V13 run (00:53, below).
- **Evidence on the Mac** (temporary, outside the repository): the pipeline logs `/tmp/w11b-pipeline.log` and
  `w11b-pipeline2.log` to `w11b-pipeline5.log` (runs 1 to 5), the V13 job log `/tmp/w11b-v13-arm64.log`, the six
  captures with their UI Automation trees in `/tmp/w11b-shots/final/`, the job bodies as they ran in `/tmp/w11b-vm/`,
  and the Mac test logs `/tmp/w11b-core.log`, `w11b-core2.log`, `w11b-desktop.log`. The VM's own folder
  (`C:\thirteen-w11`) cannot be read while the VM is down; what this entry says about the id length probe, the first
  V13 attempt and the hand cleanups is from the W11 agent's notes.
- **VM down at about 01:04.** UTM quit while the host's load average was over 600 (no UTM process and no `bridge100`
  afterwards, the VM disk last written at 01:04:25; no crash report). It was not started again: the task forbids a
  reboot, and a cold start is one. Not run because of it: the fixed build on Windows (V13 again, the new
  `verify-install.ps1` check, the pipeline's VM half), the Windows test run, and the cleanup of the VM (below).

### Pipeline, installers and `verify-install.ps1`

`./build-windows.sh --skip-tests` (the suites ran on their own first, below), five times as the fixes came in:

| Run (ended) | Build | Result |
|---|---|---|
| 1 (23:34) | as found | steps 2 to 6 pass; `verify-install.ps1`: x64 `PASS`, arm64 `FAIL Thirteen-1.0.0-windows-arm64-setup.exe: the calendar file .lock was removed by the uninstaller` |
| 2 (23:39) | Convert year box, `verify-install.ps1` | `exit 0`, both `PASS` |
| 3 (23:50) | dialogs without minimize | `exit 0`, both `PASS` |
| 4 (23:55) | time pickers' names | `exit 0`, both `PASS`; the installers in `windows/dist/`; the screenshots, the UI Automation trees and V13 below ran on this build |
| 5 (01:07) | toast ids | both trimmed publishes built; then `ERROR: Cannot connect to the Windows VM at siim@192.168.64.3 (is it running with SSH enabled?)`, `exit 1` (the VM was down) |

- **Publish (step 2), the trimmed single-file build of the Windows target** (`PublishTrimmed`, `TrimMode` full),
  with warnings as errors (`Directory.Build.props`), so every run's publish had no trim warning; `Thirteen.exe`
  25,335,950 bytes (x64) and 25,782,432 bytes (arm64) in run 4 by the agent's notes (run 5's, still in
  `windows/publish/`, are the same sizes), folders 40 MB and 39 MB.
- **`--smoke`** (both builds, runs 1 to 4): today, the version and `process Arm64, OS Arm64, runtime win-arm64` /
  `process X64, OS Arm64, runtime win-x64`, `.NET 10.0.2`.
- **UI smoke (§6.4 "On the VM")**, `--smoke-ui --fake-events --route month/2026/11 --screenshot`, both builds, runs
  1 to 4: `UI smoke: window "Thirteen" rendered at 1044x788, 125 text blocks`, with "October 2026" and the mockup's
  calendars (`windows/dist/smoke/smoke-ui-win-x64.png` and `-arm64.png`, run 4); `--clear-alerts` exit 0 (nothing
  was installed then, so nothing to clear). In session 0 the capture is 1044 x 788 and cut at the right; the
  desktop-session captures below are not.
- **ISCC: the W8 and W9 changes to `installer/Thirteen.iss` compile.** Run 1: `Thirteen-1.0.0-windows-x64-setup.exe:
  13,909,943 bytes`, `Thirteen-1.0.0-windows-arm64-setup.exe: 13,217,362 bytes`; run 4: 13,911,379 and 13,217,644.
- **`verify-install.ps1`** (§8.3 item 7), runs 2 to 4, for both: installed per user, `exe version: 1.0.0.1`, the
  Start menu entry and its target, `--smoke` through it, `thirteen://`, the shortcut's `AUMID
  HaugasDevelopment.Thirteen, toast activator {E653BA95-A6A1-461C-A730-3CA20783D353}`, the `AppUserModelId` key,
  the `Thirteen.ics` ProgID (never the default), the webcal capabilities; `toasts: a test toast is scheduled under
  HaugasDevelopment.Thirteen` (the toast check ran over SSH, it was not skipped); Thirteen running while uninstalled;
  `toasts: the scheduled toast was removed by the uninstaller`; `calendars: ... is kept with its 1 file(s)`;
  `uninstalled: folder, Start menu entry, uninstall entry, thirteen:// and file registrations removed; the open
  Thirteen was closed`; `PASS`.
- **Fixed in `verify-install.ps1`:** (1) the W11 check of 2026-10-20 counted the store's `.lock` as a calendar file.
  Thirteen holds it open with `DeleteOnClose`, so it always goes when Thirteen closes, and the arm64 run failed;
  `.lock` and `*.tmp` are no longer counted. (2) It waits (at most 30 s) for the started Thirteen's first-use
  `calendars.json`, so there is a file to keep: run 1's x64 pass listed `0 file(s)`. (3) A failing check left the
  settings and calendars it had created on the VM (run 1 did; removed by hand); it now removes them on every exit.
  (4) New, after V13 below: on a computer without calendars it puts a calendar with one alert in place before
  Thirteen starts, requires the toast Thirteen schedules for it to be listed under the app user model id within
  60 s, and requires the uninstaller to remove it. The old toast check schedules its own toast from PowerShell, with
  a short id, so it could not see that Windows refused Thirteen's. Not run yet (VM down).

### V13 without the reboot: failed, fixed, not re-run

`windows/scripts/vm/v13.ps1` (then `/tmp/w11b-vm/v13-arm64.body.ps1`, the same steps in `C:\thirteen-w11`) in the
desktop session, on the arm64 install of run 4: a calendar file with two events put in place for the installed
Thirteen (A alerting about 8 minutes later, B 8 minutes after A, both 5 minutes before their start, relative
triggers), a normal start of Thirteen with `THIRTEEN_TRACE=1`, `--quit`, then toast A with Thirteen closed and a click
on its banner through UI Automation, then uninstall before B. The job ran from 00:36 to 00:53.

- **Result: fail.** No toast was ever scheduled: `scheduled toasts seen after start: 0`, and Thirteen's log:
  `Thirteen: could not schedule toast e6c02ba2c115a8a0 (0x803E0120):`, the same for `292ef4734cbc4ff1`, then
  `Thirteen: 2 alerts scheduled (2 added, 0 removed)`. No banner of A came (`no banner of toast A was found to
  click`), so the click leg did not run. The uninstall leg (`toast B ... after uninstall: not shown`) passed only
  because B was never scheduled. By the agent's notes, an earlier attempt the same way (no trace) showed the same:
  nothing listed, no banner. There is no record of a V13 run on the x64 build.
- **Cause:** `0x803E0120` is `WPN_E_DEV_ID_SIZE`, "The size of the developer id for scheduled notification is too
  large". Thirteen's toast ids were 16 hex digits. Probe on the VM (`/tmp/w11b-vm/idlen.ps1`), under Thirteen's app
  user model id, by the agent's notes: `length 12: scheduled`, `length 15: scheduled`, `length 16: 80131501 Exception
  setting "Id": "The size of the developer id for scheduled notification is too large. (Exception from HRESULT:
  0x803E0120)"`, the same for 17 (the probe's toasts were removed again, `left: 0`). The code's own comment said 16
  was the limit. So on Windows no alert of Thirteen's has ever fired: the R16 fallback of V13 would apply as built.
- **Fix:** ids are now 15 hex digits (`AlertPlanner.IdLength`, 60 bits, for at most 1,000 toasts), and the log
  says what Windows took: `{n} alerts planned, {k} of {m} new ones scheduled, {r} removed (schedule-refused: ...)`.
  `AlertSchedulerTests` pins 15 hex digits, and its fake platform refuses longer ids as Windows does; with the old
  length both `Plan_FiresAtCoreAlarmTimes_FromEachOccurrencesUtcStart` and
  `Scheduler_BringsWindowsScheduleInLine_AddingAndRemovingOnlyTheDifference` fail (checked by putting 16 back for
  one run).
- **Not done:** V13 on the fixed build (both architectures: toast with Thirteen closed, the click opening
  `thirteen://day/`, none after uninstall) and the new `verify-install.ps1` check. Run 5 published the fixed build
  on the Mac, then found the VM down. `windows/dist/` still holds run 4's installers, without the fix. The reboot
  leg stays owner-run. The exact commands are in "What is left on Windows" above.

### Screenshots and UI Automation (desktop session)

The six `docs/screenshots/windows-*.png` (§6.4), taken on the installed arm64 build of run 4 in the VM's desktop
session with what is now `windows/scripts/vm/screenshots.sh` (README "Screenshots on the VM"; then the bodies in
`/tmp/w11b-vm/`): mockup data set (`--fake-events`, today 2026-10-19, IFC Thursday, October 12), Almanac, 1440 x 900
at 100 %, real Segoe Fluent Icons, the window with its dialog drawn over it, nothing else of the desktop:

| File | Shows |
|---|---|
| [`windows-calendar-month.png`](../screenshots/windows-calendar-month.png) | Month, IFC October 2026 (board A) |
| [`windows-calendar-month-dark.png`](../screenshots/windows-calendar-month-dark.png) | the same in Almanac dark |
| [`windows-calendar-week.png`](../screenshots/windows-calendar-week.png) | Week 2, the now line at 9:41 AM, overlapping Design review blocks |
| [`windows-event-editor.png`](../screenshots/windows-event-editor.png) | Edit event on "Book club: Cotsworth" (board I1) |
| [`windows-subscribe.png`](../screenshots/windows-subscribe.png) | Subscribe after a successful check: "Holidays in United States: 317 events" (Google's public holiday feed; nothing subscribed) |
| [`windows-calendars.png`](../screenshots/windows-calendars.png) | the Calendars pane with "Calendar settings" of the Holidays in Estonia subscription (board D2) |

Times read "7:00 PM" and "9a": the VM is en-US, and Thirteen follows the Windows time format.

Each capture also dumped the window's UI Automation tree through Windows' own UIA client (the tree Narrator
reads; 185 to 353 lines a screen, in `/tmp/w11b-shots/final/*-tree.txt`). Checked over all six: no name with an en
or em dash, no focusable element without a name, and day cells, chips, the pane's rows and buttons, the editor's
fields and the dialogs' buttons read as in §2.20 (for example `Thursday, October 12, 2026. Gregorian Monday, October
19, 2026. 5 events.` and `Book club: Cotsworth, 7:00 PM to 9:00 PM, Home, repeats`, with the Invoke and
SelectionItem patterns). Found and fixed:

- **The editor's time pickers read "Avalonia.Controls.Grid".** Their focus stop is the template's flyout button,
  which had no name, so UIA named it after its content's type. It now carries the picker's name, time and help
  text: `Starts, 7:00 PM`, `Ends, 9:00 PM` in the tree after the fix. New test
  `EditorUiTests.TheTimePickersFocusStopIsNamedWithItsTimeAndError`; without the fix it fails with `Expected:
  "Starts, 09:30" Actual: "Avalonia.Controls.Grid"`. The headless `KeyboardPassTests` did not see it.
- **Every dialog had a minimize button and a greyed maximize button** (boards I1 and D2 show none). The dialog style
  (`Themes/Events.axaml`) sets `CanMinimize` and `CanMaximize` off, so Windows shows only Close (see the editor,
  Subscribe and Calendar settings screenshots).

Not run, owner-run on the shared VM because each is a system-wide setting: Narrator itself (speech, scan mode, the
live regions' timing), a real contrast theme (Aquatic, Desert, Dusk, Night sky) and the real Windows text size.

### Found on Windows, outside events

- **The Convert year box read "2.5" as year 3 on English Windows** (the W3 and W4 re-check's
  `ConvertTests.TheYearBoxAlwaysShowsTheDaysYear(text: "2.5")` failure): the `NumericUpDown` parsed with the
  current culture's number styles. It now parses integers only (`ParsingNumberStyle="Integer"`), so any fraction is
  refused in every culture. Reproduced on macOS under `LC_ALL=en_US.UTF-8` (`Expected: "2024" Actual: "3"`); after
  the fix `ConvertTests` pass under en_US, et_EE and de_DE (26 of 26 each).

### Review finding #35: a regression test

`PendingChangesTests.TheEarlyCommitReadsAbsoluteAlertsInAnyFormAndTheMovedEnd` (new): a floating absolute trigger
(a wall clock of the device), a zoned one (`America/New_York`) and an alert relative to the end of a moved event
give the right commit-before-alert time. Checked against the old behaviour by putting it back for one run each:
reading only UTC absolute triggers gives `Expected: 2026-10-19T11:10:00 Actual: null`; the old length gives
`Expected: 07:20 Actual: 07:30`.

### Runs on the Mac

- At the start, as found: `dotnet test Thirteen.Desktop.Tests` `Passed!  - Failed: 0, Passed: 509, Skipped: 0,
  Total: 509` (23:28); `THIRTEEN_PERF_SCALE=3 dotnet test Thirteen.Core.Tests` `Passed!  - Failed: 0, Passed: 1835,
  Skipped: 0, Total: 1835` (23:26). By the agent's notes the review fixes' tests still held: `ReviewFindingsDataTests`
  (17), `ReviewFindingsUiTests` (11) and the W10 classes (`HighContrastTests`, `TextScaleTests`,
  `KeyboardPassTests`) `Passed!  - Failed: 0, Passed: 39, Skipped: 0, Total: 39`.
- At the end, with every change of this task: Core `Passed!  - Failed: 0, Passed: 1835, Skipped: 0, Total: 1835`
  (01:05) and the build `0 Warning(s)`, `0 Error(s)` (01:12). The two last Desktop runs (started 01:03 and 01:12)
  have no result line: the agent was cut off. The wrap-up ran the whole Desktop suite on the same code (above).

### State left on the VM

The VM went down before the cleanup. As of the last V13 run (00:53): nothing of Thirteen installed (`uninstalled:
exit 0; program folder present: False`), no Thirteen store or settings (`cleaned: store present False, settings
present False`). Left, all made by this task: `C:\thirteen-w11` (the job scripts, the captures, the UI Automation
trees, the V13 logs and trace), the scheduled task `ThirteenW11` (the job runner; it runs nothing on its own),
`%TEMP%\is-3072V9VVTA-uninstall.tmp` (the uninstaller's temporary copy from the last V13 run) and the pipeline's
own `C:\thirteen-build` (run 4's builds and installers; run 5 stopped before copying). By the agent's notes, twice an
uninstall started from a session that then ended (SSH, the scheduled task) left `unins000.exe` in the program
folder: the uninstaller removes it last, from a temporary copy, and the session's end stopped that copy. Both
leftovers and their temporary folders were removed by hand. `verify-install.ps1`, which waits for the uninstaller,
never left one. The scripts in `windows/scripts/vm/` now use `C:\thirteen-qa` and the task `ThirteenQA` instead
(`vmjob.sh --clean` removes both); they are the tidied form of the bodies that ran and have not run on the VM in
this form.

### V11

Not run (owner-run, unchanged): the inputs and the days to expect are in the W11 entry of 2026-10-20 below.

## W3 and W4 re-check: the store and subscriptions (2026-10-26, automated)

Not a gate: a re-check of tasks W3 (`EventStore`, `WindowsZoneResolver`, `PendingChanges`, `FakeEventStore`,
`SingleInstance` arguments, the two targets, the trimmed publish) and W4 (`SubscriptionService`, the Subscribe dialog,
the Calendars pane). They were checked against docs/EVENTS.md §2.11, §2.15 to §2.17, §2.19, §3.6 and §6.4 (v3.2 with
the v3.3 readings of §9.10), boards D2 and L, and the finished engine. It was the first time the Windows app's tests
ran on Windows: before, the VM was off for every Desktop run.

- **When:** 2026-10-26, 22:13 to 23:20 EET, by the W3/W4 agent.
- **Code:** the working tree on HEAD `7753452` plus the uncommitted events work, including the W1 and W2 re-checks of
  the same evening (`ExtraDate.DurationMinutes` as `long?` and `Ics/JsCase.cs`; the Desktop builds against both
  unchanged).
- **Hosts:** macOS 27.0.1 (26A434), .NET SDK 10.0.102, a shared machine (load average 200 to 750). The build VM:
  Windows 11 build 26200.9711 (Arm64), .NET SDK 10.0.402, runtime 10.0.13, culture en-US. The VM work used a private
  folder, `C:\temp\thirteen-w34`, which was removed afterwards.
- **Result:** pass for W3 and W4 on both hosts, after two test-server fixes for Windows' `HttpListener`, one
  single-instance fix and one name change. The Windows run of the whole Desktop suite has 2 failures outside W3 and W4
  (below).

What was read, against what:

- `EventStore`: the §3.6 files and index, with the exact JSON names; loading on a background thread; the per-year cache
  keyed by calendar, document, device zone and system, merged by key; one `SemaphoreSlim` queue per calendar for UI
  saves, pending commits, import, restore, refreshes and deletes; the hash check before every write, which reloads
  first; `{id}.ics.tmp` written through, then `File.Move` or `File.Replace` with `.bak`; the watcher (500 ms debounce,
  Thirteen's own writes ignored by hash); `.bak` recovery, `.broken-*`, the read-only unreadable calendar and
  `Calendars\Unreadable\`; the 25 MB and 50,000-event limits. v3.3's writer rules come through W2's
  `IcsWriter.Serialize(document, zones, now)`: `others` written back, unused `VTIMEZONE`s dropped unless a kept
  component uses them, `zones-added`. A new test checks them through the store (below).
- `SubscriptionService`: one `HttpClient` over `SocketsHttpHandler` (decompression, `PooledConnectionLifetime` 10 min),
  redirects followed by hand (5, https to http refused), 30 s for the whole fetch, the 25 MB cap from the header and
  while reading, the `User-Agent` and `Accept` of §6.4, `If-None-Match` and `If-Modified-Since`, `contentHash`, one
  refresh per subscription, newer-only by `lastSuccessAt`, the suspicious rules by parse outcome (exact duplicates
  not counted as skipped, as the web's `summarize`), `.bak` through the store, offline with no row errors and resume
  after 5 s, due feeds 10 s after start and every minute, hidden feeds not fetched, the `webcal://` fallback to http.
- `PendingChanges`, `WindowsZoneResolver` (no `ConvertTime`; core only asks for minutes 0 to 1439), `FakeEventStore`
  (the embedded fixture, 405 occurrences), `SingleInstance`, the Subscribe dialog, the settings dialog and the
  Calendars pane against the §2.19 strings: every `calendars.*`, `store.*`, `subscribe.*`, `import.*` and `export.*`
  string that applies to Windows is in the code verbatim.
- The csproj (`TargetFramework` cleared, the two `TargetFrameworks`, the trim suppressions with their reason) and
  `build-windows.sh` (`-f net10.0-windows10.0.19041.0` on both publishes).

Found and changed:

- **Windows-only test failures.** The first Windows run of the W3 and W4 classes (107 tests) had 2 failures, both in
  the test's feed server, not in the app. `CheckReadsTheFeedAndSubscribeStoresItAsFetched`: `System.ObjectDisposedException
  : Cannot access a disposed object. Object name: 'System.Net.HttpListenerRequest'` (http.sys disposes a request once
  its response closes, and the test read its headers afterwards). `BodiesOverTheCapAreRefused`: `Expected:
  "subscribe.error.tooLarge" Actual: "subscribe.error.unreachable"` after 30 s (a response that announces 26 MB and is
  closed without a byte sends no headers at all on http.sys, so the client timed out). Now the server copies each
  request's URL and headers as it arrives (`FeedRequest`), and the oversized response sends its first bytes. After
  that: `Passed!  - Failed: 0, Passed: 31, Skipped: 0, Total: 31` for `SubscriptionServiceTests` and
  `SubscribeDialogTests` on the VM.
- **Single instance under load.** In the first Windows run of the whole suite,
  `SingleInstanceTests.ASecondStartHandsOverAndQuitAsksTheFirstToClose` failed at `Assert.True(second)` (the hand-over
  found the mutex but not the pipe within its 1.5 s). The listener thread created the first pipe only when it got to
  run, and `Dispose` did not wait for it to close its pipe. So on a busy machine, a start right after another found
  no pipe yet, or the previous instance's closing one. Now the first pipe is created before `Start` returns, and
  `Dispose` closes it and waits (at most 2 s) for the listener. After that: 10 runs of the process-wide classes on
  the VM, all `Passed!`, and the second whole-suite run passed it.
- **The mutex name of §6.4.** The mutex was `Local\Thirteen-{user}-{session}`; it is now
  `Local\HaugasDevelopment.Thirteen`. `Local\` objects belong to one session, so the name needs neither part. The
  pipe keeps the user and session in its name, because pipe names are machine-wide. `SingleInstanceTests` asserts
  the name.
- **New test** `EventStoreTests.KeptComponentsAndTheZonesTheyUseSurviveAnEditOfAnotherGroup`: a file from another app
  with a `VTODO` whose `DUE` names a file-defined `VTIMEZONE`, an unreadable `VEVENT`, an event in `Europe/Tallinn`
  without a `VTIMEZONE`, and a fourth event that is edited through the store. Every kept block is written back byte
  for byte in the order read, the `VTIMEZONE` only the `VTODO` uses stays, a generated `Europe/Tallinn` `VTIMEZONE`
  (`X-THIRTEEN-GENERATED`) is added, the `.bak` is the original, and a new store reads the same two groups and
  `others`.
- **Checked, no change:** on .NET 10 for Windows, `Directory.EnumerateFiles(folder, "*.ics")` returns only `a.ics` from
  `a.ics`, `a.ics.bak`, `a.ics.tmp`, `a.ics.broken-*` and `b.icsx` (no 8.3 short-name match), and the watcher's filter
  does not match `a.ics.tmp`. So the index rebuild and the watcher never take a backup or temporary file for a
  calendar (a probe with `dotnet run probe.cs` on the VM).

Runs:

- **macOS, final:** `dotnet test Thirteen.Desktop.Tests`: `Passed!  - Failed: 0, Passed: 509, Skipped: 0, Total: 509`
  (508 before, plus the new store test). `THIRTEEN_PERF_SCALE=3 dotnet test Thirteen.Core.Tests`: `Passed!  - Failed:
  0, Passed: 1835, Skipped: 0, Total: 1835` (Core unchanged by this task).
- **Windows, the whole Desktop suite** (the net10.0 build under xUnit and Avalonia.Headless, over SSH). First run, before
  the single-instance fix: `Failed!  - Failed: 3, Passed: 505, Skipped: 0, Total: 508`
  (`ConvertTests.TheYearBoxAlwaysShowsTheDaysYear(text: "2.5")`, `ReviewFindingsUiTests.DeleteInAListMovesFocusToTheNextRow`
  with a `NullReferenceException` after 2 m 3 s, and the single-instance test above). Second run, with every change:
  `Failed!  - Failed: 2, Passed: 507, Skipped: 0, Total: 509`. Every W3 and W4 test passed in it, and so did the
  review test (its first-run failure was a real focus bug, found and fixed in the W11 wrap-up above). The 2 failures are outside W3 and W4 and were left as they are:
  - `ConvertTests.TheYearBoxAlwaysShowsTheDaysYear(text: "2.5", shown: "2024")`: `Expected: "2024" Actual: "3"`, in
    both runs. The Convert year box reads "2.5" as a number in the current culture; with en-US's decimal point it
    becomes year 3. The Mac runs in an Estonian region with a decimal comma, so it never parses there. This is a
    real difference on English Windows, in the Convert screen (not events).
  - `EditorUiTests.CtrlNOpensTheEditorAndCtrlEnterAdds` (line 115, `Assert.True(editor.IsClosed)` right after
    Ctrl+Enter): only in the second run. With the review test that failed only in the first run, this looks like
    timing on the slow VM (9 to 18 minutes for the suite); task W7's tests.
- **Trimmed publish** of the Windows target (`dotnet publish Thirteen.Desktop -c Release -r win-x64|win-arm64 -f
  net10.0-windows10.0.19041.0`, private artifacts and output folders): `0 Warning(s)`, `0 Error(s)` for both.
  `Thirteen.exe` 25,331,854 bytes (x64) and 25,778,336 bytes (arm64), folders 40 MB and 39 MB, the same sizes as after
  the review fixes (the new mutex name is in both, checked in the bundle).
- **The trimmed builds on the VM:** `--smoke` printed today for both (`process Arm64, OS Arm64, runtime win-arm64`
  and `process X64, OS Arm64, runtime win-x64`). `--smoke-ui --fake-events --route month/2026/11 --screenshot` for both:
  `UI smoke: window "Thirteen" rendered at 1044x788, 125 text blocks`, with "October 2026", "On this computer", "Home",
  "Running club", "Subscriptions", "Holidays in Estonia" and "Your events are saved on this computer." in the printed
  text, and exit 0. So the embedded mockup data set, the store over it and the Calendars pane work in the trimmed
  single-file build. In session 0 the capture is always 1044 x 788 whatever `--width` asks for, and the page's right
  part (Friday onwards, the Year and List buttons) is cut. This is probably the session-0 desktop, not Month's layout;
  a desktop-session run would tell. `--clear-alerts` was not run there: it could remove the toasts of a Thirteen
  installed on the VM.

Not done here: the Windows screenshots (`docs/screenshots/windows-*.png`; the session-0 capture above is cut, and the
desktop session was left to the other apps on the VM), a real-store run of the trimmed build on Windows (only
`%LOCALAPPDATA%` can hold the store, and the VM user's own calendars were not to be read; the store's file behaviour
on NTFS is covered by `EventStoreTests` on the VM), and a live network refresh (the feed tests use 127.0.0.1).

## W2 re-check: the C# `.ics` port (2026-10-26, automated)

Not a gate: release check 1 for the `.ics` module (`windows/Thirteen.Core/Ics`, task W2), against the finished
`@thirteen/core/ics`, `packages/core/scripts/ics-procedures.ts` and `fixtures/ics`, including the `.ics`
items of v3.3 §9.10 (`original` and `line`, `others` and `raw`, unused `VTIMEZONE`s dropped unless a kept
component uses them, the options of `parseICalendar`, `eventsFromCalendar`, `serializeICalendar` and
`replaceGroup`, `expandCalendar`, `removeGroup`, `eventVersion`, `mergeTimeZones`, `newICalendar`, `allDayEnd`,
`untilFor`, the import and restore merges, the `zones-added` round trips).

- **When:** 2026-10-26, 21:15 to 22:30 EET, by the W2 agent.
- **Code:** the working tree on HEAD `7753452` plus the uncommitted events work; `packages/core/src/ics`,
  `packages/core/scripts` and `fixtures/` unchanged since 2026-10-19.
- **Hosts:** macOS 27.0.1, .NET SDK 10.0.102, Node 22.21.0 (ICU 77.1, Unicode 16.0), a heavily shared machine
  (load average about 160). The build VM: Windows 11 build 26200.9711, .NET SDK 10.0.402, in a private folder
  removed afterwards.
- **Result:** pass after two fixes (below). The port was already complete and green on the fixtures; a line by
  line reading against the TypeScript found nothing else, and the random inputs found only these two.

What ran:

- **Random inputs (new):** `windows/scripts/ics-fuzz.sh` (`ics-fuzz.mjs` writes random calendar texts and what
  `@thirteen/core/ics` returns for them; `IcsFuzzReplay.cs` replays them through the C# port; windows/README.md).
  It compares what the fixtures do not: every `IcsExpandedEvent` field (`zone`, `startUtc`, `orphan`, `status`,
  `originalDate`, `group`, the component), raw texts, `Resolve` and `ToUtc`, `SameDefinition`, versions,
  baselines, `UntilFor`, recognition inputs and recognitions, random edits and merges, `BuildVTimeZone` for
  random zones and years, and the lexer helpers. Before the fixes, seeds 11 to 13 (300 documents each) gave
  191 mismatches, all of the two kinds below. After: seeds 11 to 13 (900 documents, 80,968 checks) and 21 to 26
  (3,000 documents, 268,495 checks) with no mismatch. 324 merges where the TypeScript reference throws for a
  group without a version were counted, not compared (the C# behaviour there is pinned by
  `IcsUnitTests.ImportCalendar_WithoutAVersion_NeverReplacesAStoredGroupOrOverride`). Seed 11 also replayed on
  the VM: `300 cases, 27347 checks, 0 mismatches`; seeds 12 and 13 replayed under tr-TR and th-TH: no mismatch.
- **Fix 1, upper case:** the reader upper-cased `STATUS`, `TRANSP`, `ACTION`, component names and parameter
  values with `ToUpperInvariant`; JavaScript's `toUpperCase` also applies Unicode's one-to-many mappings and
  maps the dotless ı, so `STATUS:Straße` read as `STRAßE` (TypeScript `STRASSE`), `ﬁnal` as `ﬁNAL`, an untouched
  `STATUS` was rewritten on the next edit, `TENTATıVE` was not tentative and `VALUE=DATE-TıME` accepted a date.
  Now `Ics/JsCase.cs` (a 103-entry table taken from Node over every code point; the only upper-case
  differences left are 28 code points of recent scripts, U+A7CF to U+A7D5 and U+16EBB to U+16ED3, that the two
  runtimes' Unicode tables disagree on). The events engine
  upper-cases only ASCII-checked text and needed no change.
- **Fix 2, long PERIODs:** `ExtraDate.DurationMinutes` was an `int`, so the ics layer capped an
  `RDATE;VALUE=PERIOD` length at 2,147,483,647 minutes; a period like `P3652060D` ended in year 6109 instead of
  9999-12-31T24:00 and was missing from a 9999 window. `ExtraDate.DurationMinutes` (and the internal
  `DayOccurrence`) are now `long?`, as TypeScript's number. Desktop builds against it unchanged (both targets,
  0 warnings).
- **macOS:** `THIRTEEN_PERF_SCALE=3 dotnet test Thirteen.Core.Tests`: `Passed!  - Failed: 0, Passed: 1835,
  Skipped: 0, Total: 1835` (1832 before plus 3 new `IcsUnitTests`). `dotnet test Thirteen.Desktop.Tests`:
  `Passed!  - Failed: 0, Passed: 508, Skipped: 0, Total: 508`. The `.ics` tests under `LC_ALL` tr_TR, sv_SE,
  th_TH, ar_SA and fa_IR: 69 of 69 each. `node windows/scripts/windows-zones.mjs --check`: up to date.
- **Windows:** the events and `.ics` tests `Passed!  - Failed: 0, Passed: 127, Skipped: 0, Total: 127`. The whole
  suite: 1831 of 1835, the same 4 calendar-engine `EdgeDayTests.FirstInstant_*` failures as the W1 re-check.
- **Not done here:** the phase 0 change of §5.4 and §9.10 (`X-THIRTEEN-RULE` read as unescaped TEXT, the new
  `fixtures/ics/google-export.ics`, 32 cases). Core's `parseICalendar` still keeps the trimmed raw value and the
  case does not exist, so the C# reader keeps following core; when both land, `IcsReader` needs the unescape and
  `IcsConformanceTests` the new count.

## W1 re-check: the C# events port (2026-10-26, automated)

Not a gate: release check 1 for the events engine (`windows/Thirteen.Core/Events`), against the finished
core engine and its fixtures, including the eight places where they differ from spec v3.2 (v3.3 §9.10).

- **When:** 2026-10-26, 20:10 to 21:20 EET, by the W1 agent.
- **Code:** the working tree on HEAD `7753452` plus the uncommitted events work; `packages/core/src/events` and
  `fixtures/` unchanged since 2026-10-19.
- **Hosts:** macOS 27.0.1 (26A434), .NET SDK 10.0.102, Node 22.21.0. The build VM: Windows 11 build
  26200.9711, .NET SDK 10.0.402 (runtime 10.0.13), in a private folder removed afterwards.
- **Result:** pass for the events engine on both hosts. No engine change was needed.

What ran:

- **macOS:** `THIRTEEN_PERF_SCALE=3 dotnet test Thirteen.Core.Tests`: `Passed!  - Failed: 0, Passed: 1832, Skipped:
  0, Total: 1832` (1826 before, plus the new `EventsCultureTests`). `dotnet test Thirteen.Desktop.Tests`:
  `Passed!  - Failed: 0, Passed: 508, Skipped: 0, Total: 508`.
- **Windows:** the events and `.ics` tests `Passed!  - Failed: 0, Passed: 124, Skipped: 0, Total: 124`; `zones`
  through `TimeZoneInfo` with its one listed exception (Pacific/Apia utc 2011-12-30T10:00) and 0 mismatches;
  the culture test under all five cultures. The whole suite: 1828 of 1832. The 4 failures are calendar-engine
  tests (SPEC §1.5, not events): `EdgeDayTests.FirstInstant_IsNull_WhenTheZoneSkippedTheWholeDay` for
  Pacific/Kwajalein 1993-08-21, Pacific/Apia 2011-12-30 and Pacific/Kiritimati 1994-12-31 (the registry
  zones have no skipped day, so Windows answers local midnight, for example `1993-08-21T00:00:00+12:00`), and
  `FirstInstant_IsLocalMidnight_OrTheFirstExistingTime` for America/Sao_Paulo 2018-11-04 (expected
  `2018-11-04T01:00:00-02:00`, Windows `2018-11-04T00:59:59.999-02:00`: the registry rule puts the
  midnight change at 23:59:59.999). Left as they are: they need a Windows exception list like
  `PlatformZoneExceptions`, or a rounding fix for the 1 ms, in the calendar engine.
- **Culture:** the whole core suite under `LC_ALL` sv_SE, tr_TR, th_TH, ar_SA and fa_IR passed (1826 of 1826
  each). `EventsCultureTests` now replays every events section under those cultures in every run. Checked
  by breaking `Ev.Inv` to use the current culture for one run: the culture test failed under fa-IR, sv-SE
  and ar-SA (`rrules` and `thirteenRules`), while the parity test alone, under the host culture, passed.
- **Random inputs:** `windows/scripts/events-fuzz.sh` (new; see windows/README.md) builds random cases in the
  `events.json` section shapes with the TypeScript engine and replays them through the C# section tests.
  33 sections (all but `zones`, `zoneOffsets`, `dateLists` and `alarms`), three modes (plain; leap-only
  repeats around their caps; series on DST transition days with gap-time overrides, `EXDATE`s, extra dates,
  `DURATION`s and the year 1 and 9999 edges). 264,150 cases in 9 runs at 1,000 per section (seeds 21 to 23,
  each mode), plus smaller runs: no difference. Checked by corrupting five expected values (each one
  reported) and by changing the chip time's a/p rule for one run (reported, exit 1).
- **Trimming:** Thirteen.Core built with `IsTrimmable`, `IsAotCompatible` and the trim, AOT and single-file
  analyzers: `Events/` and `Ics/` have no findings. The only ones are IL2026 and IL3050 in
  `Json/ThirteenJson.cs` (the `Options` initializer's `DefaultJsonTypeInfoResolver`). That is the
  conversion JSON from before the events work; only tests call it, and its public methods carry
  `RequiresUnreferencedCode`.
- **Known differences (§9.10), where each is checked:** leap-only caps in every path (fixtures and the leap
  runs); `SeriesInput.duration` and `startUtc` (fixtures and the DST runs); `setDraftAllDay`'s `timeZone`
  (`Drafts.SetAllDay(..., timeZone)`, `EventsModelTests`); `describeAlarm` in both forms (`alarm.Describe(allDay,
  system, use24Hour)` with optional arguments); `applyToSeries` (`DraftMerge.ApplyToSeries`) and
  `formatUntil` (`Until.Format`); gap-time matching (fixtures and the DST runs); the layout readings
  (fixtures and the random layouts); `outOfRange` (fixtures and the DST runs); the history text
  (`SystemData.cs`, "skipping 3 to 13 September").
- **Not done here:** the phase 0 change of §9.10 for the C# reader (`X-THIRTEEN-RULE` read as unescaped TEXT,
  `fixtures/ics/google-export.ics`). Core's `parseICalendar` does not unescape yet and the fixture does not
  exist, so the C# reader (task W2's `Ics/`) keeps following core until both land.

## Review fixes (2026-10-20, automated)

Not a gate: the fixes for the design and data review of the Windows events feature (36 findings: 8
blockers, 13 majors, 15 minors), with the checks the gates build on.

- **When:** 2026-10-20, until 07:20 EEST, by the Windows fixes agent.
- **Code:** the working tree on HEAD `7753452` plus the uncommitted events work of W1 to W11 and this task.
- **Host:** macOS 27.0.1 (26A434), .NET SDK 10.0.102, Avalonia 11.3.22 on the headless platform; the shared
  machine. The VM was still off (`ping` lost every packet, `ssh: connect to host 192.168.64.3 port 22:
  Operation timed out` when the task started and again at about 07:15, no UTM process), so nothing ran on
  Windows.
- **Commands:** from `windows/`: `dotnet build` (both targets), `dotnet test Thirteen.Desktop.Tests`,
  `THIRTEEN_PERF_SCALE=3 dotnet test Thirteen.Core.Tests`, and `dotnet publish Thirteen.Desktop -c Release -r
  win-x64|win-arm64 -f net10.0-windows10.0.19041.0` into private folders under `/tmp`.
- **Result:** pass. Build `0 Warning(s)`, `0 Error(s)`. Desktop `Passed!  - Failed: 0, Passed: 508, Skipped: 0,
  Total: 508` (468 before W10, 479 after W11; the 29 new ones are below). Core `Passed!  - Failed: 0, Passed:
  1826, Skipped: 0, Total: 1826`. Both trimmed publishes without a warning; `Thirteen.exe` 25,331,854 bytes
  (x64) and 25,778,336 bytes (arm64), folders 40 MB and 39 MB.

Every data finding but the alert timer's has a test that failed on the code the review read and passes now:
`ReviewFindingsDataTests` (17: the review's 16 data tests, all kept, all real bugs, plus one for historical
overrides) and one `SubscriptionServiceTests` case. So do the main UI findings: `ReviewFindingsUiTests` (11, on
the real window), the details at 225 % (`TextScaleTests`), the error help text and icon (`EditorUiTests`), the
cell names (`PhrasingTests`) and the toolbar without the system switch (`AccessibilityTests`). The layout-only
ones (Week heads, targets, invitees line, stacked date rows, Now plate, "No weekday") were checked on the
renders below. The two
added data-side tests were checked against the old code by putting it back for one run: both failed
(`Expected: Historical, Actual: null`; two different `missing-...` UIDs), then the fixes were restored.

| Finding | What changed |
|---|---|
| §4.9 rule 3: a moved start keeps the old 13-month RRULE (editor, drags, future-events tails) | a 13-month rule counts as kept only when it encodes the same for the old and new start (end ignored); otherwise it is written again from the new start (`EventEditing.WithRecurrence`, `Retimed`) |
| §4.7: a tail at a later time or turned all-day keeps the stored UNTIL | UNTIL is derived again from the end date when the start's form, zone or time changed (a date UNTIL for an all-day series) |
| a move into a calendar that holds the same UID replaced that event | the moved group gets a new UID on every member; the change result, undo and focus follow it (`PlaceGroup`) |
| a zone only the file defines changed meaning in another calendar | moves, future-events tails and undo between calendars rename a colliding definition `{TZID} (2)` like the import (`EventEditing.PutGroup`, `IcsGroups.RenameCollidingTimeZones`) |
| future events from a first occurrence changed on its own moved the series and missed the edited event | that save goes through `DraftMerge.ApplyToSeries`: the master shifts only by the day difference and takes the minute and length; the override gets the changed fields too |
| delete all future events left a master with no occurrence | the group is removed when no override is kept and its head has no occurrence (delete and split) |
| restore trusted `X-THIRTEEN-CALENDAR-ID` as a file name | ids are checked at the store (`IsSafeCalendarId`: ASCII letters, digits, `-`, `_`, `.`, no leading dot, no device names, at most 120); a document path must stay in the folder; an unsafe id restores under a stable UUID made from it |
| a half-written file was taken as the calendar | a store document that does not end in `END:VCALENDAR` or has an unclosed component is unreadable (§2.16): set aside as `.broken-*` |
| a file broken while Thirteen runs went back to `.bak`, one save old | Thirteen keeps the copy it holds, sets the broken file aside and writes its copy back (`.bak` only at start) |
| UTC RECURRENCE-IDs: a held delete or move missed the override | the override the expansion showed is used by reference |
| undo reverted the whole group | undo reverts only the field groups the change touched (`EventEditing.RevertFields`), refused only when another app changed one of them |
| an override of a series before 1583 could be dragged | read-only is judged on the series master, and `EventEdits.MoveOccurrence` refuses it as a backstop |
| the commit-before-alert time used the old all-day setting and only UTC absolute triggers | alerts read as the scheduler reads them (`AlarmOf`, any trigger form) with the new all-day setting and end |
| refreshed feeds were parsed with calendar id "" | parsed with the subscription's id, so derived UIDs match the next start |
| the details cut their labels at 225 % | from 150 % each label sits above its value; `TextScaleTests` opens the details (`ShowDetails`), asserts the dialog exists, and also reports a word wider than a wrapping text |
| Ctrl+Z and Ctrl+Y only in Calendar | they act in every section while the window's history has a change and no text field has focus outside Calendar |
| editor errors not attached to their fields, no icon | Starts, Ends, their time pickers and End repeat carry the error as help text; each error line has the warning icon |
| no focus after Delete | focus goes to the deleted event's day cell, in lists to the next row |
| a new-event link or route at a cold start did nothing | it waits until the events have loaded, then opens the editor |
| no Selected trait | day cells, the band, Week and Day heads, the Day strip, chips and blocks are `SelectableButton`s whose peer has the SelectionItem pattern |
| the year stepper had no value; both buttons named "Year" | `YearStepper`'s peer is a spinner with the RangeValue pattern (value, minimum, maximum, settable); the buttons are "Previous year" and "Next year" |
| Day's panel showed a summary | it hosts the full details view of the selected event |
| details order | Time (with the zone line under it), Repeat, Calendar, Alerts, Show as, Location, URL, Notes |
| Week heads cut "Year Day" and the Gregorian day number | the code plate sits above the name; a narrow column shows "Oct 15", then "15" |
| targets under 32 px | toast actions at least 32 px with 8 px spacing, notice close 32 x 32, the pane's info button, swatch and "Hide all" 32 px |
| "Gregorian: " in Year and Today cell names | the colon is gone ("Gregorian Thursday, ...", "IFC Thursday, ...") |
| invitees line under Notes | under Location |
| editor rows at 150 % kept date and time side by side | date, time and caption each on a full-width line |
| no Now plate in List; two-line rows in Month's list | the Now plate on rows in progress; one "time title" line in Month's list |
| no "No weekday" plate on Day's intercalary title | added beside the title |
| the system switch in the Calendar toolbar | hidden while Calendar is shown; Week's toolbar is one line at 1280 px |
| no File menu (§2.17) | not added: Windows has no menu bar; recorded as a deviation in windows/README.md (Ctrl+O, Ctrl+Shift+E, the pane's buttons and Settings' Export) |
| no `docs/screenshots/windows-*.png` | not done here: the VM was off and headless renders on macOS have no Segoe Fluent Icons (boxes in place of icons). Taken on the VM since, in the W11 VM pass (2026-10-27) |

Renders (headless, macOS, mockup data set; icons are boxes): `/tmp/thirteen-winfix/textscale/windows-text-{100,150,225}-details.png`
(labels above values at 150 % and 225 %, nothing cut), `windows-text-225-editor.png`, and in
`/tmp/thirteen-winfix/shots/`: `week-yearday-1440.png`, `week-680.png`, `week-1280.png` (one-line toolbar),
`day-yearday-1280.png` (the "No weekday" plate), `list-1280.png` (the Now plate), `month-150.png` and
`editor-timed-225.png` (stacked date rows).

Not run: Narrator on these changes (the SelectionItem and RangeValue peers go through `Avalonia.Win32.Automation`,
which bridges both patterns, but no screen reader heard them), the six Windows screenshots, the installers and
V13 (VM off). The screenshots, the installers with `verify-install.ps1`, the UI Automation trees and a first V13 run
came later, in the W11 VM pass.

## W10: accessibility and tests (2026-10-20, automated)

- **When:** 2026-10-20, 05:12 to 05:50 EEST, by the W10/W11 agent.
- **Code:** the working tree on HEAD `7753452` plus the uncommitted events work of W1 to W9 and this task.
- **Host:** macOS 27.0.1 (26A434), .NET SDK 10.0.102, Avalonia 11.3.22 on the headless platform with Skia
  rendering; a machine shared with about 12 agents (load average 108 at the start).
- **Commands:** from `windows/`, with a private build folder inside the ignored `bin/` (the fixture tests
  find the repository from their binaries):
  `dotnet build Thirteen.Desktop.Tests/Thirteen.Desktop.Tests.csproj --artifacts-path bin/w11-art`, then
  `dotnet test bin/w11-art/bin/Thirteen.Desktop.Tests/debug/Thirteen.Desktop.Tests.dll` (whole suite and
  `--filter FullyQualifiedName~HighContrastTests|...~TextScaleTests|...~KeyboardPassTests`), and
  `THIRTEEN_PERF_SCALE=3 dotnet test bin/w11-art/bin/Thirteen.Core.Tests/debug/Thirteen.Core.Tests.dll`.
- **Result:** pass. Before this task's changes: Desktop `Passed!  - Failed: 0, Passed: 468, Skipped: 0, Total:
  468`, Core `Passed!  - Failed: 0, Passed: 1826, Skipped: 0, Total: 1826`. After them, the new tests
  `Passed!  - Failed: 0, Passed: 11, Skipped: 0, Total: 11` (5 contrast, 5 text size, 1 keyboard) and the whole
  Desktop suite green (the final count is in the W11 entry below).

### High contrast (§2.20 "Forced colors and high contrast")

Found: nothing in the Windows app handled a contrast theme; §2.20 and §6.4 ask for the web's forced-colors
rules with the system colours. Built (`Themes/HighContrast.cs`, `ThemeService`, `ThemeResources`, the drawn
controls in `Controls/EventChip.cs`, `Controls/TimelinePanel.cs`, `Controls/MonthEventGrid.cs`, styles in
`Themes/Calendar.axaml` and `Views/Calendar/TimelineView.axaml`):

- On Windows, when Avalonia reports `ContrastPreference == High`, the system colours are read with
  `GetSysColor` and replace the theme (which stays saved): papers Canvas, text and rules CanvasText, the
  accent Highlight with HighlightText on it, accent text LinkText; the app runs Dark when Canvas is dark. It is
  read when the window is created, on the platform's colour change and on every activation.
- Chips, bars and Week and Day blocks: Canvas with a 1 px CanvasText border, no tint, no colored edge; a
  tentative event has a dashed border instead of the hatch; selected, a 2 px Highlight outline. Dots: a
  CanvasText ring (Month dot items and Year's dots). Today: Highlight with HighlightText (Month, Year, Day
  strip, through the palette). The now line: Highlight, solid in every column. The intercalary hatch: gone (the
  band gets a dashed CanvasText frame). The selected Month day: a 2 px Highlight ring inside it.
- `--high-contrast [aquatic|desert|dusk|nightsky]` stands in for the system with the default colours of the
  four Windows 11 contrast themes (QA and the tests on macOS).

`HighContrastTests` checks every role in all four contrast themes (and 4.5:1 or more for text on the washes,
on Highlight and on the control tint), and on rendered pixels in Desert: a bar's left and top border are
CanvasText, its inside where the colored edge was and its fill are Canvas, today's number is on Highlight with
HighlightText, the selected day has its Highlight ring; in Week every block and the grid are in the contrast
look with the now line in Highlight; in Aquatic the app runs Dark and Year's dots have CanvasText rings; turning
the contrast theme off brings the theme back at once. Renders: `/tmp/thirteen-shots/windows/headless-mac-high-contrast-*.png`.

One problem found on the way: Avalonia did not paint a zero-blur inset `BoxShadow` (the first try at the
selected-day ring); the ring is an overlay border in the cell template instead.

### Text size at 150 % (§2.20 "Text size")

`TextScaleTests` walks every visible text and reports one that is wider than its box with neither an ellipsis
nor wrapping, cut at the side by a clipping parent, or past the window's edge. At 150 % (1280 x 800 window) it
first found, and this task fixed:

| Where | Cut | Fix |
|---|---|---|
| Calendars pane, every mode | "On this computer" under "Hide all" | group titles wrap; "Hide all" moves under the title when they do not fit side by side (`ToolbarLayout`) |
| Calendars pane footer | "Subscribe to calendar" | the four footer labels wrap (a grid instead of a horizontal stack) |
| Today, Settings: explanation texts | the last line cut at the bottom, lines overlapping | the four wrapped text styles use `LineSpacing` instead of a fixed `LineHeight`, which `TextScaling` did not scale |
| Settings, keyboard shortcuts | "Ctrl+Shift+1 to Ctrl+Shift+5" and three more | the keys column fits its longest keys (at least 200 px, one size for every row) |
| Day details, weekday strips | "GREGORIAN" | the label column fits its label (at least 96 px) |
| Year header | the legend ran under the "Gregorian dates" toggle and off the page | the legend wraps |
| Today hero date plate | "October" cut by 4 px (at 225 %: "Oc") | the numeral face scales down to fit its column (a `Viewbox`, down only) |
| Calendar toolbar, at 225 % | "New event" cut off at the right | the mode control and "New event" take as many lines as they need |
| Repeat picker, at 225 % | "International Fixed Calendar" | section headers wrap |

After the fixes nothing is cut at 100 % and 150 % in Day, Week (Day at this size), Month (the list of days),
Year, List, Today and Settings, nor at 100 %, 150 % and 225 % in the editor (labels stacked at 150 % and up),
the repeat picker and the event details (a dialog at these sizes). **Correction (review fixes, below):** this run
did not check the event details: the test never opened them (it executed the block's select command, so no
dialog existed and the walk ran on the main window), and at 225 % their 86 px label column cut "Repeat",
"Location" and "Calendar". Fixed and checked since. Still cut at 225 %, Windows' largest size, on
the older screens: Year's Gregorian month labels ("Jan" needs 41 px in a 36 px day cell), the day details'
comparison beside the Day timeline (the weekday strips' two-letter chips, and the fact titles "Label drift",
"Month length", "Day of year", "Year progress", "Year Day", "Positivist Calendar" beside their values) and
the "Phosphor" theme tile's name in Settings (by 4 px). They were never laid out for 225 %; task W9 made every
text follow Windows' text size, which exposed them. Renders: `/tmp/thirteen-shots/windows/headless-mac-*-text.png`.

### Keyboard and names (§2.20, §2.21)

`KeyboardPassTests` uses the events with the keyboard alone on the real window with the real event actions:
Ctrl+Shift+1 to 5, Ctrl+Right and Ctrl+T, Tab through the toolbar and the Month grid, Ctrl+N with the title
typed and Tab through the editor's fields, Ctrl+Enter, focus on the new event (§2.20 "Focus after actions"),
Ctrl+E then Escape, Delete with its question answered by Shift+Tab (from the safe Cancel) and Enter, Ctrl+Z
and Ctrl+Y, Month's grid with the arrows, Enter into a day's events and Escape back, and Ctrl+Shift+K. Every
focus stop has a spoken name, none with a dash. The §2.20 label table, Month's keyboard and the no-dashes walk
were already covered by W5 to W9 (`CalendarUiTests`, `TimelineUiTests`, `EditorUiTests`, `AccessibilityTests`).

What a headless run cannot show: what Narrator actually reads (UI Automation through Avalonia's Windows peers),
scan mode, the live regions' timing, the real `SPI_GETSCREENREADER`, and focus rectangles in a real contrast
theme. Those wait for the VM (runbook below).

## W11: the VM pipeline and the gates (2026-10-20)

- **When:** 2026-10-20, 05:12 to 05:55 EEST, by the W10/W11 agent.
- **VM:** off for the whole session. `ssh -o ConnectTimeout=5 siim@192.168.64.3` gave `ssh: connect to host
  192.168.64.3 port 22: Operation timed out` at 05:12, and a watch loop trying every minute had no answer by
  the end; `ping` lost every packet. The Mac had no `bridge100` interface (UTM's shared network) and no UTM or
  QEMU process: UTM had quit at about 03:58 (the VM's disk and `screenshot.png` were last written then; UTM
  is in the 23:59 Jetsam snapshot with QEMU at about 8.9 GB and absent from the 03:59:41 one), with no crash
  report, while the host was under memory pressure (Jetsam events at 03:59 and 05:07). That looks like a
  deliberate quit, so the VM was not started again by this task (the task forbids a reboot, and starting a 4 GB
  VM on a host that was killing processes for memory was not this task's call). Earlier agents saw it down from
  about 04:35.

What ran instead, on the Mac:

- **Tests, final run** (05:50, after every change of this task): `dotnet test
  bin/w11-art/bin/Thirteen.Desktop.Tests/debug/Thirteen.Desktop.Tests.dll` gave `Passed!  - Failed: 0, Passed:
  479, Skipped: 0, Total: 479`; the build before it `0 Warning(s)`, `0 Error(s)`. `Thirteen.Core` was not
  changed; its run at 05:15 gave `Passed!  - Failed: 0, Passed: 1826, Skipped: 0, Total: 1826`.
- **Pipeline, Mac half:** `./build-windows.sh --skip-tests --publish-only`: `✓ win-x64: Licenses Thirteen.exe
  av_libglesv2.dll libHarfBuzzSharp.dll libSkiaSharp.dll ( 40M)` and `✓ win-arm64: ... ( 39M)`, `exit 0`.
  Both are trimmed publishes of the Windows target with warnings as errors, so no trim warning;
  `Thirteen.exe` 25,299,086 bytes (x64) and 25,745,568 bytes (arm64).
- **Pipeline updates** (`build-windows.sh`, step 5): for both builds, `--smoke-ui --fake-events --route
  month/2026/11 --screenshot` (§6.4 "On the VM"), which must print the window line, "October 2026", the
  mockup's "Holidays in Estonia" and the saved screenshot (copied back to `dist/smoke/smoke-ui-<rid>.png`), and
  `--clear-alerts` with exit 0. `bash -n` passes; the step has not run on the VM.
- **`verify-install.ps1`:** now also lists every file in `%LOCALAPPDATA%\Thirteen\Calendars` before
  uninstalling and fails if one is gone after (§8.3 item 7, "uninstall keeps user calendars"); before, it only
  checked that the folder existed. Not run (no PowerShell on the Mac, VM off); the W8/W9 changes to
  `Thirteen.iss` have still not been compiled by ISCC.
- **Screenshots:** the VM method (README "Screenshots on the VM") could not run. Headless renders of the
  mockup data set on macOS stand in, named `headless-mac-*.png` in `/tmp/thirteen-shots/windows/`: Day,
  Week, Month, Year, List, Today, the editor and the repeat picker at 100 %, Month, Day, the editor and the
  repeat picker at 150 % (the last two also at 225 %), and four contrast-theme renders. They lack Segoe Fluent
  Icons (boxes in place of icons), so `docs/screenshots/windows-*.png` were not replaced then (the W11 VM pass took
  them on Windows).

### V11: exported files in other apps

Not run (owner-run). Input, exported through the Windows export path (`ImportExport.ExportText`, what the
Calendars pane's Export writes) from the mockup data set: `/tmp/w11-qa/v11/thirteen-windows-home.ics` and
`thirteen-windows-running-club.ics`. They hold form (b) repeats: Rent (IFC day 1 of every month, all day),
Book club: Cotsworth (IFC day 12, 19:00 Europe/Tallinn), Recycling pickup (every 2 IFC weeks on Friday), Yoga
(every IFC week on Friday, 07:15), each with `RRULE:FREQ=YEARLY;BYYEARDAY=...` and `X-THIRTEEN-RULE`, plus
plain Gregorian events (Payday monthly, Lunch with Jaan). The same files can be made on Windows with Export in
the Calendars pane. **They are gone** (checked in the W11 wrap-up, 2026-10-27: `/tmp/w11-qa/` is empty, and the
headless render folders of 2026-10-20 named in this file, under `/tmp/thirteen-shots/windows/` and
`/tmp/thirteen-winfix/`, are empty or gone too), so they must be exported again before V11. Right days
for Rent (from the file's own `BYYEARDAY` list):

- 2026: Jan 1, Jan 29, Feb 26, Mar 26, Apr 23, May 21, Jun 18, Jul 16, Aug 13, Sep 10, Oct 8, Nov 5, Dec 3.
- 2028 (leap): Jan 1, Jan 29, Feb 26, Mar 25, Apr 22, May 20, Jun 18, Jul 16, Aug 13, Sep 10, Oct 8, Nov 5, Dec 3.

Import each file into Apple Calendar (macOS 26), Google Calendar web, Outlook web and Thunderbird in a
scratch calendar, check those days in 2026 and 2028, and record what each app calls the repeat.

### V13 and the VM QA pass: runbook for the next VM run

**Superseded** by "What is left on Windows" at the top. The W11 VM pass (2026-10-26 and 27) ran step 1 (five
pipeline runs), the screenshots of step 2 on the arm64 install (not the contrast themes or the text size, which are
system-wide settings of the shared VM) and step 4 on arm64 (failed, fixed, not re-run). The VM is an Arm64 machine,
so the Arm64 leg is now part of the agent's rerun; only the reboot leg stays owner-run. Steps 3 and 5 have not run.
As written on 2026-10-20:

Owner-run by the task's terms: the reboot leg (V13 "after reboot") and the Arm64 leg. The rest is ready to run
as soon as the VM answers SSH:

1. `cd windows && ./build-windows.sh` (unsigned unless `THIRTEEN_AZURE_SIGNING_ENV` is set): tests, both
   publishes, `--smoke`, the new `--smoke-ui` and `--clear-alerts` step, both installers through ISCC, and
   `verify-install.ps1` for each (registrations, toast removed by the uninstaller, calendars kept).
2. Install `dist/Thirteen-1.0.0-windows-x64-setup.exe` on the VM. From the desktop session (README
   "Screenshots on the VM": a scheduled task with `/it`), run `Thirteen.exe --fake-events` and capture each
   Calendar mode, the editor and the repeat picker into `/tmp/thirteen-shots/windows/`. Then, without
   `--high-contrast`, turn on Settings, Accessibility, Contrast themes, Aquatic and then Desert, and check the
   forced-colors look of the W10 entry follows them; set Text size to 150 % and check no text is cut.
3. Real local store: create an event, edit it, give it an IFC monthly repeat, delete one occurrence and the
   series; Import an `.ics` (one of the V11 files) and Export a calendar.
4. V13, app closed: create an event with an alert 3 minutes ahead, close Thirteen, wait for the toast, click
   it (it must open `thirteen://day/<date>`), then schedule another, uninstall, and check no toast fires.
5. Narrator (Ctrl+Win+Enter) and keyboard only through the Month grid, a day's events, the editor and the
   repeat picker, against the §2.20 names.
6. Owner: the same after a reboot, and on Arm64 with the arm64 installer.

## W8 and W9: import, export, alerts (2026-10-20, automated)

Not a gate: the automated checks of tasks W8 and W9 that V11 and V13 rely on.

- **When:** 2026-10-20, about 04:40 EEST (Europe/Tallinn), by the W8/W9 agent.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work (the whole `windows/` tree is new),
  with W6 and W7 working in the same tree at the same time.
- **Host:** macOS 27.0.1 (26A434), .NET SDK 10.0.102, Avalonia 11.3.22 on the headless platform.
- **Commands:** from `windows/`, with a private build folder:
  `dotnet build Thirteen.Desktop.Tests/Thirteen.Desktop.Tests.csproj --artifacts-path bin/w89-art`, then
  `dotnet test ... --no-build --filter "FullyQualifiedName~ImportExportTests|FullyQualifiedName~AlertSchedulerTests|FullyQualifiedName~TodayEventsUiTests"`.
- **Result:** pass, 51 tests: `Passed!  - Failed: 0, Passed: 51, Skipped: 0, Total: 51`.

What they show:

- **Import procedures byte for byte through the real store.** Every step of `fixtures/ics/imports/*.json`
  (baselines, two "Customized Time Zone" files, Google and Apple exports in `Europe/Tallinn` with nothing
  renamed, a file without UIDs imported twice, an override without its master) and of
  `restore/restore.json`, replayed through `ImportExport.ImportAsync` / `RestoreAsync` and
  `EventStore`'s read-modify-write: each stored `{id}.ics` equals the fixture's expected document byte for
  byte, with the fixture's counts.
- **Restore on a fresh computer.** The backup zip on an empty store gives exactly its three calendars with
  their ids, names, colors and event counts (4, 2, 16), the subscription with its link and `P1D`; the
  empty first-use "Personal" gives way; restored again, still three, nothing kept newer.
- **Export.** A restored calendar exports to the backup file byte for byte; a subscription carries
  `X-THIRTEEN-SUBSCRIPTION-URL` and `-INTERVAL`; four calendars into a folder that already holds a
  `Personal.ics` give `Personal (2).ics`, `Work.ics`, `Work (2).ics` and `Holidays in Estonia.ics`
  without touching the existing file; those files restore the same four calendars on another store.
- **Alerts.** Fire times from `Alarm.FireTime` with each occurrence's `StartUtc`: a weekly 09:00 event in
  Tallinn alerts at 05:45Z before the October 25 DST change and 06:45Z after it; all-day at 09:00 the day
  before; relative to the end; absolute; the email alarm skipped; two alarms at one moment once; the
  60-day window's edges; the 1,000 cap; subscriptions and hidden calendars left out; a changed device
  zone. The toast XML parses, has `activationType="protocol"` and `launch="thirteen://day/2026-10-21"`
  and escapes user text. Through a fake platform the scheduler removes only stale toasts and adds only
  new ones, rebuilds after a store change, and turns itself off when the notifier is unavailable.
- **Today, day details, Settings, text size.** Up next shows board B1 (all day "Autumn school break", the
  Now plate on "Sprint planning", "1:1 with Marta", "Dentist, Dr. Tamm", "Book club: Cotsworth",
  tomorrow "Yoga", "5 more in the next 7 days"); the day details list the day's events with the Now plate
  only on today; Settings' Calendar rows set the default calendar and Year dots; under Phosphor the
  Appearance control is disabled with Dark shown and the note "Phosphor is always dark. Pick a light and
  dark theme to use Appearance again.", the saved Light kept; at text scale 1.5 an 18 px title is 27 px,
  icons keep their size and the Export dialog takes the window's scale; a file from the command line
  goes through the Import dialog to "Added 2, updated 0, unchanged 0.".

The whole suites at about 04:55: `Thirteen.Desktop.Tests` `Passed!  - Failed: 0, Passed: 467, Skipped:
0, Total: 467`; `Thirteen.Core.Tests` with `THIRTEEN_PERF_SCALE=3` `Passed!  - Failed: 0, Passed: 1826,
Skipped: 0, Total: 1826`.

Trimmed publish of the Windows target (`dotnet publish Thirteen.Desktop -c Release -r win-x64|win-arm64
-f net10.0-windows10.0.19041.0`, private output folders): both architectures publish without a warning
(the text size's `UISettings` call included); `Thirteen.exe` 25,282,702 bytes (x64) and 25,729,184 bytes
(arm64).

Not run: the VM checks (`--smoke`, `--clear-alerts`, `--smoke-ui --fake-events`, both installers through
`verify-install.ps1` with its new registration and scheduled-toast checks). The build VM did not answer
from about 04:35 to the end of the session (ssh and ping to 192.168.64.3 timed out), so these checks,
and V13 with them, are left to the next VM run (task W11).

## W7: details, editor and undo (2026-10-20, automated)

Not a gate: the automated checks of task W7 (docs/EVENTS.md §2.10 to §2.14, §2.19 to §2.21, §4.7, §6.4).

- **When:** 2026-10-20, about 05:00 EEST (Europe/Tallinn), by the W7 agent.
- **Code:** the working tree on HEAD `7753452` plus uncommitted work, with other tasks working in the same
  tree at the same time.
- **Host:** macOS 27.0.1 (26A434), .NET SDK 10.0.102, Avalonia 11.3.22 on the headless platform.
- **Commands:** from `windows/`, with a private build folder inside the ignored `obj/` (the fixture tests
  find the repository from their binaries):
  `dotnet build Thirteen.Desktop.Tests/Thirteen.Desktop.Tests.csproj --artifacts-path obj/w7-artifacts`, then
  `dotnet test ... --no-build --filter "FullyQualifiedName~EventActionsTests|FullyQualifiedName~EditorModelTests|FullyQualifiedName~EventEditingTests|FullyQualifiedName~EditorUiTests"`,
  then the whole suite `dotnet test ... --no-build`.
- **Result:** pass. The W7 tests: `Passed!  - Failed: 0, Passed: 95, Skipped: 0, Total: 95` (39 + 38 + 10 + 8).
  The whole Desktop suite: `Passed!  - Failed: 0, Passed: 468, Skipped: 0, Total: 468`.
- **Windows target:** `dotnet build -f net10.0-windows10.0.19041.0` and the trimmed
  `dotnet publish -c Release -r win-x64 -f net10.0-windows10.0.19041.0` (private output folder) finish with no
  warning; `Thirteen.exe` 25,282,702 bytes. The IL2075 that the W8/W9 run met in `WindowEventsUi.cs` is gone
  (the focus-after-save lookup no longer uses reflection).

Not run: the app on the VM (Narrator, the real toast timing settings, a real Calendar control and time
picker); the headless renders on macOS have no Segoe Fluent Icons, so no `docs/screenshots/windows-*.png`
were replaced.

## First CI run on GitHub (2026-10-27)

`windows-latest` (Windows Server 2025) gave the 4 known calendar-engine failures in `EdgeDayTests.FirstInstant_*`
(registry zone data, W1 re-check). The tests now hold Windows to what its registry zones say: the three
skipped days (Pacific/Apia 2011-12-30, Pacific/Kiritimati 1994-12-31, Pacific/Kwajalein 1993-08-21) exist
there, and São Paulo's first instant on 2018-11-04 is 1 ms early. macOS and Linux still check the IANA answers.
