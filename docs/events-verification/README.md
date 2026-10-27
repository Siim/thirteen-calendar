# Events verification gates

The index of the verification gates in [docs/EVENTS.md §8.2](../EVENTS.md#82-verification-gates). Each
gate checks something the events design relies on but that only real devices, accounts and browsers can
show (what iCloud, Google, Exchange, the Android calendar provider or a browser actually do). The spec says
what passes and what ships instead when a gate fails; this folder records what happened.

Each team records its own runs in its own file, so no file has two editors:

| File | Written by | Holds |
|---|---|---|
| [apple.md](apple.md) | Apple team | the Apple gates: iPhone, iPad and Mac, EventKit, iCloud, Google and Exchange accounts on iOS and macOS |
| [android.md](android.md) | Android team | the Android gates: the calendar provider on API 26, 30 and 37 images and devices, Google sync |
| [windows.md](windows.md) | Windows team | the Windows gates: toasts, the installed app, `.ics` export into other apps |
| [web.md](web.md) | Web team | the web gates: subscriptions, alerts and storage in Chromium, Firefox and Safari |
| [phase0.md](phase0.md) | the teams that ran the probes | phase 0 (§6.0): V1, V2, V3, V10, V12 and V23 with hand-made events; a probe that requires a change to §4.4 or §4.7 says so |

This README belongs to the Core team; it only indexes the gates and never records a result.

## How to record a run

§8.2 asks for the date, the OS versions, the result and screenshots. In practice each entry, one per run
under the gate's id, gives:

- the date, and who ran it;
- OS and app versions (iOS, macOS, Android API level and image, Windows build, browser versions) and the
  Thirteen build or commit;
- the devices and the kind of account (iCloud, Google, Exchange, local), without account names,
  addresses or calendar links;
- the result: **pass**, or **fail** with the fallback from §8.2 that ships instead (and the pull request
  that ships it);
- screenshots, under `docs/screenshots/` or next to the file, linked from the entry;
- anything the spec did not expect (what Calendar.app or Google web calls a repeat, a count EventKit
  writes, how a provider expands a date).

A gate whose fallback ships counts as passed for the 1.0 release gate (§8.3 item 2); the entry must say
which fallback and where it shipped.

## The gates

Phase 0 runs V1, V2, V3, V10, V12 and V23 with hand-made events; the rest run in phase 4 (§6.0). "Pass"
and "If it fails" are summaries; §8.2 is normative.

| Gate | What | Owner | Phase | Pass | If it fails | Recorded in |
|---|---|---|---|---|---|---|
| V1 | Form (b) saved by EventKit into iCloud: right days 2026 to 2030 on a second iPhone, a Mac and iCloud.com, after a title edit in Calendar.app; what Calendar.app calls the repeat | Apple | 0 | right days everywhere | iCloud gets `gregorian-only` (R1); no footer sentence | [apple.md](apple.md), [phase0.md](phase0.md) |
| V2 | Form (b) saved into a Google account on iOS, then edited in Thirteen for Android (title edit, one-occurrence edit and delete, drag of the first occurrence, end date, "future events" split); checked on Google web and the iPhone | Apple, Android | 0 | right days on Google web; the iPhone shows every date and both exceptions after the Android edits | Google sources on Apple get `gregorian-only`; Android makes `BYYEARDAY` series read-only except alerts | [apple.md](apple.md), [android.md](android.md), [phase0.md](phase0.md) |
| V3 | Form (d) from Android into Google: Google web, Google Calendar for Android, the iPhone; an exception made through `CONTENT_EXCEPTION_URI` and one made on Google web; a series in two parts | Android | 0 | right days on Google web and Android; the Android exception shows as a changed occurrence everywhere | Apple details note and support FAQ, `repeat.note.androidReencode.firstOnly`; the detached fallback of §4.4 for `RDATE` exceptions | [android.md](android.md), [phase0.md](phase0.md) |
| V4 | Exchange / Microsoft 365 calendar on iOS and Android: forms (a) and (c) work, form (b) is rejected or mangled; where Outlook places monthly-on-the-31st and yearly-February-29 repeats | Apple, Android | 4 | forms (a) and (c) right; Outlook's placement matches the §2.13 notes | the gate stays; the note text says what Outlook does | [apple.md](apple.md), [android.md](android.md) |
| V5 | `EKCADErrorDomain 1013` on iOS and macOS 26/27 (detach with an alarm, move between iCloud and Google, move a series with a deleted and a changed occurrence); Android: move such a series between two Google accounts | Apple, Android | 4 | no error, or the fallbacks work as §4.7 says | the fallbacks stay on | [apple.md](apple.md), [android.md](android.md) |
| V6 | Do EventKit events created without alarms get the account's default alert? | Apple | 4 | documented | FAQ text | [apple.md](apple.md) |
| V7 | macOS 26/27 deep link to Privacy & Security > Calendars | Apple | 4 | opens the pane | open System Settings | [apple.md](apple.md) |
| V8 | `requestFullAccessToEvents` from the store actor on a sandboxed, Developer ID signed Mac build | Apple | 4 | prompt shown | request on the main actor | [apple.md](apple.md) |
| V9 | Do `CUSTOM_APP_PACKAGE` and `CUSTOM_APP_URI` survive Google sync to a second Android device? | Android | 4 | documented | the §4.4 behaviour without the marker | [android.md](android.md) |
| V10 | `RDATE` in `TZID;` form survives a Google sync round trip; a 400-value list and a list as Google writes it back read correctly | Android | 0 | unchanged dates; 400 values kept | UTC form; smaller parts | [android.md](android.md), [phase0.md](phase0.md) |
| V11 | Exported `.ics` with form (b) imported into Apple Calendar (macOS 26), Google Calendar web, Outlook web and Thunderbird | Windows, Web | 4 | right days in Apple and Google | exporters switch to form (d) with a 10-year horizon | [windows.md](windows.md), [web.md](web.md) |
| V12 | Provider expansion on API 26, 30 and 37 images (`ProviderRecurrenceTest`): 1890, 1900, 2038 to 2040 and 2400 dates, `Instances` windows, an `RDATE` list crossing 2038 | Android | 0 | matches §4.4, including the API 30 rules | extend the API 30 rules to the failing API levels | [android.md](android.md), [phase0.md](phase0.md) |
| V13 | Windows scheduled toasts on the trimmed single-file build: app closed, after reboot, x64 and Arm64; a click opens the day; no toast after uninstall | Windows | 4 | delivered and routed | the R16 fallback | [windows.md](windows.md) |
| V14 | Android all-day reminders: minutes from local midnight; negative minutes accepted by Google sync | Android | 4 | documented | keep "On the day at 09:00" hidden, or add it back | [android.md](android.md) |
| V15 | Web subscriptions from Google, iCloud, Outlook, Fastmail and Proton links in Chromium, Firefox and Safari, three refreshes each | Web | 4 | documented | update the host list in `subscribe.error.cors` | [web.md](web.md) |
| V16 | iCloud all-day flip of a repeating occurrence (the two-step save of §4.7) on iOS 26/27 | Apple | 4 | right day | keep the two-step save | [apple.md](apple.md) |
| V17 | Web alerts through `alerts-sw.js` fire and open the day: Chrome, Firefox and Safari on macOS, Chrome on Android, a Home Screen install on iOS 26; unsupported pages hide the pickers | Web | 4 | delivered and routed where supported | hide alerts on the failing browser | [web.md](web.md) |
| V18 | Alerts for events in the local "Thirteen" calendar on a Pixel with only Google Calendar, and on a Samsung with Samsung Calendar | Android | 4 | delivered on both | ship the `ReminderReceiver` fallback and its copy | [android.md](android.md) |
| V19 | Safari 26 eviction: local events after 8 days without opening Thirteen, in a tab and as a Dock app; the `persist()` result in each | Web | 4 | documented | adjust the Safari notice text | [web.md](web.md) |
| V20 | Invitee alert edits: EventKit saves an invitee's alarms in iCloud, Google and Exchange and they survive sync; Android `Reminders` rows on a Google invitation | Apple, Android | 4 | saved and kept | `alarmsEditable = false` for that account kind | [apple.md](apple.md), [android.md](android.md) |
| V21 | "Open in Calendar": `calshow:` on iOS and macOS 26/27; Android `ACTION_VIEW` of `Events/{id}` in Google Calendar and Samsung Calendar | Apple, Android | 4 | opens the date or event | Mac: open the Calendar app; Android: hide the button where unresolved | [apple.md](apple.md), [android.md](android.md) |
| V22 | Write-only access: `save` into `defaultCalendarForNewEvents` on iOS and macOS 26/27 | Apple | 4 | event created | "+" in write-only shows the card text in an alert | [apple.md](apple.md) |
| V23 | EventKit "future events" split in iCloud and Google: a `COUNT=10` series split at its 4th occurrence, with one removed and one detached occurrence after the split, with the repeat kept and with End repeat set to After 3 times, on iOS and macOS 26/27 | Apple | 0 | documented; the span copy matches; after the count check of §4.7 the new series has 7 (or the chosen 3) | `span.future.exceptionsLost` where EventKit drops them; the count check corrects a wrong count, or "future events" on `COUNT` series starts only from the first occurrence on Apple | [apple.md](apple.md), [phase0.md](phase0.md) |

## What CI covers instead

The gates are manual because they need real accounts and devices. Everything that can run without them
runs in CI (`.github/workflows/ci.yml`, §6.6): the fixture staleness check, the TypeScript, Swift
(`apple-kit`), Kotlin and C# parity suites with their per-section counts, the Android JVM tests and lint,
the web e2e suite, and the optional `android-provider` job, which runs the instrumented provider tests
behind V12 on emulator images (API 26, 30 and 37).
