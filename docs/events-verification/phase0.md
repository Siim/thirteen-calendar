# Phase 0 sync probes

Phase 0 of [docs/EVENTS.md](../EVENTS.md) §6.0 runs V1, V2, V3, V10, V12 and V23 with hand-made events
(§8.2 is normative for what passes and what ships when a gate fails). This file records the probe run
of V1 and V23 on iCloud and the web-only proxies for V2, V3 and V10 on Google. V12 (provider expansion
on emulator images) is not part of this run.

## Run

- **When:** 2026-10-19 23:43 to 2026-10-20 00:20 EEST (Europe/Tallinn), by the phase 0 sync probe agent,
  with the owner's permission to use temporary test calendars only.
- **Mac:** macOS 27.0.1 (`sw_vers` build 26A434), this Mac's EventKit with an iCloud account (CalDAV
  source "iCloud"). Device zone Europe/Tallinn. No second iPhone.
- **Google:** a Google Workspace account, Google Calendar on the web only, in Chrome on this Mac. There is
  no Google account in this Mac's Calendar, so nothing went through EventKit or Android.
- **Calendars used:** a temporary "Thirteen QA" calendar in each account, created for this run and
  deleted at its end. No other calendar was read beyond listing names, and nothing else in either account
  was changed.
- **Harness:** `ThirteenProbe.app` (scratch, outside the repo; bundle id `com.haugas.thirteen.probe`,
  Developer ID signed, Full Calendar access granted by the owner). Every write checked that the target was
  the iCloud "Thirteen QA" calendar the harness itself had created. Two private EventKit methods were used
  for evidence only: `ICSDataForCalendarItems:options:` (to read back the stored iCalendar text) and
  `importICSData:intoCalendar:options:` (the V3 proxy below).
- **Expected dates and files:** computed with `packages/core` from the working tree of 2026-10-19 (HEAD
  `7753452` plus uncommitted work): `thirteenRuleFor`, `encodeThirteenRule`, `thirteenRuleDatesInYear`,
  `expandRecurrence`, `thirteenRuleRdates`; the `.ics` files were written by `serializeICalendar` (through
  the `thirteenEvent` helper of `packages/core/scripts/ics-cases.ts`) and read back with `parseICalendar`,
  `eventsFromCalendar` and `recognizeRecurrence`.

## Summary

| Gate | Run here | Result | What it means now (§8.2 "If it fails") |
|---|---|---|---|
| V1 | Mac EventKit leg on iCloud; iCloud.com, Calendar.app and the second iPhone not run | partial: the Mac leg passes | form (b) stays allowed on iCloud sources for development; V1 is not passed until the owner runs the iCloud.com, Calendar.app and second-device legs; if those fail, iCloud gets `gregorian-only` (R1) and the footer sentence goes |
| V23 | macOS 27 EventKit on iCloud, both variants; iOS, iCloud.com and Google not run | documented (macOS only) | kept repeat: count right (7), removed occurrence kept, detached occurrence lost as an exception and shown twice, so `span.future.exceptionsLost` is needed on Apple; changed count: EventKit wrote no rule at all (not "10 again"); the §4.7 count check corrected it |
| V2 | web-only proxy: form (b) `.ics` import into Google, web edits, export | proxy: BYYEARDAY kept, right days on Google web | evidence only; V2's EventKit and Android legs not run, so Google sources on Apple keep the `gregorian-only` fallback until the owner runs them |
| V3 | web-only proxy: form (d) `.ics` import into Google, a Google web "this event only" edit; Apple importer proxy | proxy: right days on Google web, exception written as a `RECURRENCE-ID` override; Apple's `.ics` importer kept only the first date | evidence only; Android, Google Calendar for Android and iPhone legs not run |
| V10 | web-only proxy: `RDATE;TZID=` lists imported, edited on Google web, exported | proxy: TZID form kept; a 400-value timed list rejected at import | evidence for keeping the TZID form and for smaller parts (about 250 timed values); the Android sync leg decides |

## V1: form (b) saved by EventKit into iCloud

**Run.** Six events in the iCloud "Thirteen QA" calendar, saved through EventKit with
`EKRecurrenceRule` exactly as §4.4 says, then read back through EventKit (rule fields and occurrences)
right after saving, after `refreshSourcesIfNecessary` plus 60 s, and again about 25 minutes later after
another refresh plus 90 s.

| Event | Start | Saved rule | Stored as (EventKit's iCalendar text) |
|---|---|---|---|
| Every IFC month on the 12th, all-day | 2026-01-12 | `.yearly`, interval 1, `daysOfTheYear` 13 values | `RRULE:FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18` |
| Every IFC month on the 12th, 19:00 Europe/Tallinn | 2026-01-12 19:00 | same | same, `DTSTART;TZID=Europe/Tallinn:20260112T190000` |
| Every IFC week on Thursday, 19:00 Europe/Tallinn | 2026-01-05 19:00 | `.yearly`, `daysOfTheYear` 52 values | `RRULE:FREQ=YEARLY;BYYEARDAY=5,12,19,26,...,159,166,-193,-186,...,-11,-4` |
| Every year on IFC April 12, all-day | 2026-04-06 | `.yearly`, `daysOfTheYear` [96] | `RRULE:FREQ=YEARLY;BYYEARDAY=96` |
| Every Leap Day (form c), all-day | 2028-06-17 | `.yearly`, interval 4, end 2096-06-17 23:59:59 | `RRULE:FREQ=YEARLY;INTERVAL=4;UNTIL=20960617` (the rule's `description` says `UNTIL=20960617T235959Z`) |
| Every Year Day (form a), all-day | 2026-12-31 | `.yearly`, interval 1 | `RRULE:FREQ=YEARLY` |

`EKRecurrenceRule.description` read back as `RRULE FREQ=YEARLY;INTERVAL=1;BYYEARDAY=...` with the lists
unchanged at every read.

**Occurrences through EventKit, 2026-01-01 to 2030-12-31**, compared with core's `expandRecurrence`:
monthly all-day 65 of 65, monthly 19:00 65 of 65 (all at 19:00), weekly 260 of 260 (all at 19:00),
April 12 5 of 5 (2028-04-05 in the leap year), Leap Day 1 of 1, Year Day 5 of 5; identical at every
read. Leap Day 2026 to 2100: the 18 dates 2028-06-17, 2032-06-17, ..., 2096-06-17 and none after.

**Title edit.** iCloud.com was not available (below), and Calendar.app was not used for editing. As a
stand-in, the title of the timed monthly series was changed through EventKit on its first occurrence
with `.futureEvents` (without assigning `recurrenceRules`, as §4.9 rule 2 says). Read back after a
refresh plus 90 s: every `EKRecurrenceRule` field unchanged (`.yearly`, interval 1, the same 13
`daysOfTheYear`, no end), `SEQUENCE:0`, and the same 65 days.

**Not run.**

- iCloud.com: the browser was signed out of iCloud ("Sign in with Apple Account"): **needs owner
  sign-in**. Not checked: the days on iCloud.com, a title edit there, what iCloud.com calls the repeat.
- Calendar.app: not checked. Opening the event with an `ical://ekevent/...` link did not bring up the
  event; the owner was using the Mac at the time, and a capture of Calendar's window would also show the
  owner's other calendars. One capture of the Calendar window area was checked by text recognition for
  the probe titles only (no match) and deleted without being viewed. What Calendar.app calls the repeat is
  still unknown.
- Second iPhone: not available.

**Result: partial.** On this Mac, iCloud kept form (b) through save, sync and an EventKit title save, and
EventKit gives the right days for 2026 to 2030. Nothing failed, but the server-side legs (iCloud.com, a
second device, a Calendar.app edit) are the ones R1 is about.

**Incidental (V6).** The all-day events, saved with no alarms, came back with the account's default
alert: `BEGIN:VALARM`, `TRIGGER:-PT15H`, `X-APPLE-DEFAULT-ALARM:TRUE`. The timed events came back with
none. The new series created by the V23 splits came back with Apple's "no alert" placeholder
(`ACTION:NONE`, `TRIGGER;VALUE=DATE-TIME:19760401T005545Z`).

## V23: "future events" split in iCloud (macOS 27, EventKit)

**Setup.** Two series, "keep" and "after3", each `RRULE:FREQ=WEEKLY;COUNT=10`, 19:00 Europe/Tallinn,
from Thursday 2026-10-22 (occurrences October 22 and 29, November 5, 12, 19 and 26, December 3, 10, 17
and 24). On each, the 6th occurrence (November 26) was removed with `remove(_, span: .thisEvent)`
(stored as `EXDATE;TZID=Europe/Tallinn:20261126T190000`) and the 8th (December 10) was detached by a new
title and a start one hour later, `save(_, span: .thisEvent)` (stored as an override with
`RECURRENCE-ID;TZID=Europe/Tallinn:20261210T190000`). After a sync wait, each series was split at its
4th occurrence (November 12) with `save(_, span: .futureEvents)`.

**Repeat kept** (only the title changed):

- Head: `RRULE:FREQ=WEEKLY;COUNT=3` (October 22, 29, November 5).
- New series (new UID, linked by `RELATED-TO;RELTYPE=X-CALENDARSERVER-RECURRENCE-SET`):
  `RRULE:FREQ=WEEKLY;COUNT=7`, with `EXDATE;TZID=Europe/Tallinn:20261126T190000` carried over. **Count
  right (7); the removed occurrence stays removed.**
- The detached occurrence is **not** kept as an exception of the new series. It became a separate
  calendar item whose UID is `{new UID}/RID=818614800` (still holding the `RECURRENCE-ID` override,
  `isDetached` false), and the new series produces its own regular December 10 19:00 occurrence. December
  10 therefore shows twice (19:00 with the series title, 20:00 with the detached title). Unchanged after
  another refresh plus 120 s.

**End repeat set to After 3 times** (`recurrenceRules` = weekly with `EKRecurrenceEnd(occurrenceCount: 3)`):

- Head: `RRULE:FREQ=WEEKLY;COUNT=3`.
- New series: **no recurrence rule at all**, but `EXDATE;TZID=Europe/Tallinn:20261126T190000` and the
  December 10 override (`RECURRENCE-ID`) were carried. EventKit appears to count the chosen 3 from the
  original start and subtract the head's 3, giving 0. The new "series" showed only November 12, plus the
  detached December 10.
- Count check of §4.7: setting `recurrenceRules` = weekly with `occurrenceCount: 3` on the new series'
  first occurrence (November 12) and saving with `.futureEvents` was **accepted**:
  `RRULE:FREQ=WEEKLY;COUNT=3`, `EXDATE` kept, `SEQUENCE:1`. Occurrences November 12 and 19 (November 26
  is excluded and counts towards the 3); the December 10 override, now outside the series, was dropped.

Read through EventKit right after each save and after `refreshSourcesIfNecessary` plus 120 s (same
result). **Not run:** iCloud.com (needs owner sign-in), iOS 26/27, a Google account through EventKit.

**Result: documented for macOS 27 on iCloud.** Against §8.2:

- A detached occurrence after the split point is lost as an exception and duplicated, so Apple's span
  dialog needs `span.future.exceptionsLost` when such an occurrence exists. Removed occurrences survive.
- With the repeat kept the new count is right (7), so the count check makes no second save.
- With another count, EventKit's count is wrong in a way §8.2 did not list: not 10 again, but the chosen
  count minus the head's count, which removed the rule entirely for 3. The count check fixed it, so
  "future events" on `COUNT` series can stay offered from any occurrence, provided the count check also
  treats a missing rule as a wrong end.

## Apple proxy for V3: an `RDATE` series imported into iCloud

A Thirteen-written `.ics` with `DTSTART;TZID=Europe/Tallinn:20260112T190000` and one
`RDATE;TZID=Europe/Tallinn:...` property with 20 values (every IFC month on the 12th) was imported into
the iCloud "Thirteen QA" calendar through EventKit's own importer (`importICSData:intoCalendar:options:`,
no UI and no new permission). EventKit stored a **single, non-repeating event** on the first date: the
`RDATE` was dropped (it is not in EventKit's iCalendar text), and the `X-THIRTEEN-RULE` marker was kept
but re-escaped as `SYSTEM=ifc\;KIND=monthly\;DAY=12`. iCloud.com was not checked.

This shows that Apple's own `.ics` import keeps only the first date. It does not show what an iPhone
does with an `RDATE` series that arrives from Google over CalDAV, which is the V3 leg; that leg still
needs an Android-made series and the iPhone.

## Google, web only: proxies for V2, V3 and V10

**Files.** Written with core's writer, each event with its `X-THIRTEEN-RULE` marker:

| Event | Form | Content |
|---|---|---|
| Every IFC month on the 12th, all-day | (b) | `RRULE:FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18` |
| Every IFC week on Thursday, 19:00 Europe/Tallinn | (b) | `RRULE:FREQ=YEARLY;BYYEARDAY=` the 52 values |
| Every Leap Day, all-day, from 2028-06-17 | (c) | `RRULE:FREQ=YEARLY;INTERVAL=4;UNTIL=20960617` |
| Every IFC month on the 12th, 19:00 | (d) | `DTSTART` + one `RDATE;TZID=Europe/Tallinn:` property with 40 values |
| Every IFC week on Thursday, 19:00 | (d) | the same with 200, 250, 254, 255, 256, 275, 300, 399 and 400 values; 400 values also split over 10 `RDATE` lines of 40 |
| Every IFC week on Thursday, all-day | (d) | `RDATE;VALUE=DATE:` with 400 values |

**Import** (Settings, Import and export, Import, into "Thirteen QA"; Google resets "Add to calendar" to
the primary calendar after every import, so the calendar was re-selected and checked before each one):

| File | Google |
|---|---|
| forms (b) and (c), the 40, 200, 250 and 254 timed lists, the 400 all-day list | "Imported 1 out of 1 event." |
| the 255, 256, 275, 300, 399 and 400 timed lists, and 400 timed values over 10 lines | "Imported 0 out of 0 events. Unable to process your iCal/CSV file." |
| all five first events in one file (with the 400 timed list) | the whole file rejected the same way |

The limit follows the length of the `RDATE` text, not the number of values: 254 timed values are 4,089
characters unfolded (accepted), 255 are 4,105 (rejected), 400 all-day values are 3,616 (accepted), and
splitting the 400 timed values over several lines does not help. It looks like about 4,096 characters
of `RDATE` text per event.

**Read back.** "Secret address in iCal format" is not offered for this Workspace account (the
"Integrate calendar" section has no such field), so no secret address was copied and no file holding one
exists. The stored form was read instead through the QA calendar's own "Export calendar" link (a zip
with only that calendar), before and after the web edits; the downloads were deleted afterwards.

- **BYYEARDAY kept**, byte for byte, in both form (b) series.
- **Leap Day rule** stored as `RRULE:FREQ=YEARLY;UNTIL=20960617;INTERVAL=4` (the same rule, parts
  reordered).
- **Marker kept** on every series, but TEXT-escaped:
  `X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc\;KIND=monthly\;DAY=12`. `parseICalendar` keeps the backslashes and
  `parseThirteenRuleText` rejects the value, so the marker step of recognition does not match. Core still
  recognized every series correctly, through the day-of-year list, leap interval and date list steps.
- **`RDATE` TZID form kept**, not rewritten to UTC; Google writes one property per value:
  `RDATE;TZID=Europe/Tallinn:20260112T190000`, then the next on its own line. Values kept: 40 of 40, 200
  of 200, 250 of 250, 254 of 254 (timed) and 400 of 400 (all-day, `RDATE;VALUE=DATE:20260112`, one per
  line). The rejected lists were never stored.
- **What Google web calls the repeats:** in the event editor, "Unsupported recurrence" for both
  `BYYEARDAY` series and "Does not repeat" for the `RDATE` series (saving still offers "This event",
  "This and following events" and "All events").

**Days on Google web** (the QA calendar's own embed view in Schedule mode, so only QA events were on the
page), compared with core for February to March 2026, October to December 2026, August to September 2027,
June to August 2028 (with Leap Day 2028-06-17), December 2028 to February 2029, March to April 2029 and
November 2030 to February 2031: every series showed exactly the expected dates (54 of 54 comparisons, and
the January and February 2031 dates match `thirteenRuleDatesInYear`). Leap Day also showed on 2032-06-17
and 2096-06-17, and not in 2100.

**Edits on Google web:**

- "This event" title edit on the weekly form (b) series (November 16, 2026) and on the 40-value `RDATE`
  series (December 14, 2026): each stored as a separate `VEVENT` with the series' UID and
  `RECURRENCE-ID;TZID=Europe/Tallinn:20261116T190000` (and `...20261214T190000`), its own `DTSTART`,
  `SEQUENCE:0`, no marker, and no `EXDATE` on the series. Google web showed both as changed occurrences.
- "All events" title edit on the monthly form (b) series and on the 250-value `RDATE` series: the
  `RRULE`, `RDATE` and `X-THIRTEEN-RULE` lines of every series were identical before and after (compared
  line by line); the new titles showed on every date.
- After the edits, core still read every series with the expected occurrences, and each edited series
  with one override.

**Results.**

- V2 proxy: Google keeps `BYYEARDAY` from an `.ics` import, through series and single-occurrence edits on
  the web, and Google web shows the right days. This is evidence only: V2's EventKit leg (saving into a
  Google calendar through iOS) and its Android legs were not run.
- V3 proxy: an `RDATE` series shows the right days on Google web, and a Google web "this event only" edit
  is written as a `RECURRENCE-ID` override and shown as a changed occurrence. The Android, Google Calendar
  for Android and iPhone legs were not run.
- V10 proxy: the TZID form survives import, a web edit and export unchanged. A 400-value timed list does
  not get in through web import; 254 is the largest timed list that did. The Android sync leg was not run.

## Clean-up

- iCloud: "Thirteen QA" deleted with `removeCalendar(_:commit:)`; after a refresh plus 60 s EventKit has
  no calendar with that id or title. On 2026-10-26 the owner checked Calendar: no "Thirteen QA" calendar
  is listed. iCloud.com itself was not checked.
- Google: "Thirteen QA" permanently deleted in its settings; it is gone from the settings list and its
  embed view shows no calendar.
- No secret address was copied (none offered). The exported zips, the decoded copies, the agenda page
  texts and the temporary upload folder were deleted. The browser tabs opened for the run were closed.

## What the owner still needs to run before release

1. **V1:** sign in to iCloud.com (or run it there yourself): the days of a form (b) series for sample
   months of 2026 to 2030, a title edit of the series in Calendar.app (or iCloud.com) followed by a check
   that the rule and days are unchanged, and what Calendar.app and iCloud.com call the repeat; then the
   same days on a second iPhone (iOS 26 or 27).
2. **V23:** the same two splits on iOS 26/27 and checked on iCloud.com, and both splits in a Google
   calendar through EventKit (needs a Google account in Calendar on the iPhone or Mac).
3. **V2:** add a Google account to an iPhone, save a form (b) series into it through EventKit (Thirteen
   or the harness), check Google web and Google Calendar for Android, then the Android edits of §8.2 and
   the iPhone check.
4. **V3:** a form (d) series made by Thirteen for Android in a Google account: Google web, Google Calendar
   for Android, the iPhone (Calendar.app and EventKit), an exception through `CONTENT_EXCEPTION_URI`, one
   from Google web, and a series in two parts.
5. **V10:** the Android leg: a `TZID;` date list through Google sync and back, an edit on Google web, a
   list at the planned part size, and a list as Google writes it back.
6. **V12:** not part of this run.
