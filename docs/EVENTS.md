# Events in Thirteen: specification and plan

Status: spec v3.3 for release 1.0. v1 was written 2026-10-19 from the owner's brief in
[`design/DECISIONS.md`](../design/DECISIONS.md) ("Events"). v2 (the same day) answered the parts of the
v1 design review it received. v3 (the same day) answers the complete review: all 65 findings of the
feasibility, UX and data-integrity critics are fixed in place or listed with their reason in §9. v3.1 (the
same day) answers the first re-check of v3 (§9.6). v3.2 (the same day) answers the second re-check
(§9.8). v3.3 (2026-10-20) writes down what the finished core engine (`packages/core/src/events`,
`packages/core/src/ics`, [`packages/core/API.md`](../packages/core/API.md)) and its fixtures do where
v3.2 said otherwise or said nothing, the owner's decisions made since, and the outcomes of the phase 0
probes (§8.2, "Phase 0 results"; all listed in §9.10). This file
is the contract between the five teams, the same way [`docs/SPEC.md`](SPEC.md) is for the calendar engine:
if code and this file disagree, fix the code or change this file on purpose, in the same pull request.
Teams that started on v2 should read §9 first: it lists every section v3 changed; teams that started on v3
read §9.7 for what v3.1 changed, teams that started on v3.1 read §9.9 for what v3.2 changed, and teams
that started on v3.2 read §9.10 for what v3.3 changed.

Mockups: [`design/events/mockups.html`](../design/events/mockups.html) (open it in a browser; board v3.2,
groups A to L; v3.3 changes no board, and §6.7 lists where the data set differs from a board).

Conventions used below:

- "13-month" means the system the user selected (IFC by default, or Positivist). Examples use IFC unless
  they say otherwise. The example "today" is Gregorian Monday, October 19, 2026 = IFC Thursday, October
  12, 2026 (SPEC §2).
- Every year in an API is a Gregorian year (SPEC §1.4). A 13-month year starts and ends on the same days
  as the Gregorian year, so every 13-month month, week and day lies inside one Gregorian year.
- MUST, SHOULD and MAY have their usual meaning. "Teams" are Core (TypeScript engine), Apple, Android,
  Windows and Web (§6.0).
- Quoted English text is final user-visible copy. Every string has an id in the copy catalogue (§2.19).
  Copy uses US spelling ("color", "canceled") because the store listings are English (U.S.), and it never
  contains an em dash or en dash (design/DECISIONS.md, "Copy"), including text that platform formatters
  produce at run time (§2.19, "Formatting rules").
- `IFC` and `Positivist` in copy come from the system descriptor's `shortName`.
- Times in examples are 24-hour because the example device is in Tallinn. Every time on screen follows the
  OS 12 or 24-hour setting (§2.19); the U.S. App Store screenshots use 12-hour (§7.3).

---

## 0. Decisions at a glance

1. **One events feature, two storage models.** iPhone, iPad and Mac use EventKit; Android uses
   CalendarContract; both read and write the calendars that the operating system already syncs. Windows
   and web keep Thirteen's own local calendars, import and export `.ics`, and subscribe to read-only iCal
   feeds by URL. No accounts, no servers, no Google or Microsoft sign-in.
2. **The Year section becomes "Calendar"**, with five modes: Day, Week, Month, Year and List. Today gets
   an "Up next" card. Convert, Compare and History are unchanged. Old `year` links keep working. On phones,
   Today, paging and New event are reachable without gestures (§2.1).
3. **The 13-month month is the hero.** Month mode is a 4 x 7 grid whose header names each column's
   13-month weekday and the Gregorian weekday it falls on that month, with every Gregorian date in its
   cell and the month's intercalary day(s) as a band under it. Week mode adds intercalary days as an extra
   column.
4. **Event editor like Apple Calendar's**, with a 13-month date field (any month day, Year Day, Leap Day,
   the Positivist festivals) that always shows the Gregorian equivalent, and a time field.
5. **Repeats:** all the Gregorian repeats of Apple Calendar (presets and Custom) plus four 13-month
   repeats: every 13-month month on day N, every 13-month week (or 2 weeks) on a 13-month weekday, every
   year on a 13-month date, and every Year Day, Leap Day or Positivist festival.
6. **Storage of 13-month repeats:** as one RFC 5545 `RRULE` with `BYYEARDAY` on Apple and in `.ics`
   (exact and endless), as an explicit `RDATE` list on Android (the Android calendar provider ignores
   `BYYEARDAY`; verified by running its code, §4.4), and as a plain Gregorian yearly rule wherever the
   date never moves. Leap-only days repeat every 4 years and stop before the next century without a leap
   year (2096 for IFC Leap Day). Exchange and Outlook calendars do not offer 13-month repeats. A series
   made on an Apple device keeps a `BYYEARDAY` rule whatever is edited on Android (title, time, dates,
   end, splits); only a new choice in the repeat picker re-encodes it (§4.9). Until gate V2's Android leg
   is run, Android changes only the alerts of such a series (its fallback, §8.2).
7. **One shared engine.** New pure code in `@thirteen/core` (events, recurrence, layout, `.ics`) with a
   new golden file `fixtures/events.json` and an `.ics` conformance set `fixtures/ics/`, ported to Swift,
   Kotlin and C# like the rest of the engine (the `.ics` module only to C#).
8. **Privacy stays "Data Not Collected"** on the App Store. Apple and Android apps still make no network
   connections. Windows and web connect only to calendar feeds the user subscribes to; the privacy policy
   says so (§7). The web app registers a service worker that only shows alerts.
9. **The web cannot read Google, iCloud or Outlook feeds directly** (they send no CORS headers; Google's
   was checked on 2026-10-19). 1.0 ships without a proxy (owner decision, §8.5): the web app subscribes to
   feeds that allow it and offers file import otherwise.
10. **The web app has an origin of its own: `https://thirteen.haugas.dev/`.** Local events, secret feed
    links and the notification permission are stored per origin, and `siim.github.io` is shared with the
    owner's other GitHub Pages sites, so the app moves to its own custom domain before 1.0 (§3.6, §8.5).
11. **Thirteen writes back what it read.** A save changes only the fields the user changed, merged with
    whatever changed elsewhere meanwhile. Repeats, exceptions, imported events, time zones and feeds keep
    their stored text until the user edits that very thing (§4.9). Moves and deletes are held for the
    length of their Undo toast before anything is written, and a hold that cannot be written is undone on
    screen and reported (§2.11).
12. **Order of work:** Core and fixtures, then the ports, then each platform's UI, then QA and the
    verification gates (§6.0). **1.0 ships when the gates in §8.2 pass on every platform.**

---

## 1. Goals, non-goals and the sync model

### 1.1 Goals for 1.0

- See events from all of the user's calendars in every 13-month view, next to the Gregorian dates.
- Add, edit, move and delete events the way Apple Calendar does: title, location, all-day, start and end,
  repeat, calendar, up to two alerts, show as busy or free, URL and notes; occurrence edits with "this
  event only" and "future events"; undo with each platform's own undo (⌘Z, Ctrl+Z, shake), not only a
  toast, and without side effects for moves and deletes (they are written only after the Undo window).
- Never damage data that other apps made: no silent re-encoding of repeats, no lost exceptions when a
  series is split, moved or retimed, no rewriting of imported events the user did not touch (§4.9).
- Repeat events by 13-month rules that keep working in Apple Calendar, Google Calendar and other apps,
  wherever the platform allows it (§4.8).
- Show and hide calendars inside Thirteen, choose the default calendar for new events, and turn events off
  entirely on Apple and Android ("Show my events", §2.18).
- Invitations: see them, open them in the system calendar app to reply, and set your own alerts on them
  where the account keeps them (§2.10).
- Windows and web: local calendars that survive restarts, `.ics` import and export, read-only
  subscriptions by `webcal://`, `https://` (and, on Windows, `http://`) link, refreshed on a schedule.
- Alerts: delivered by the OS calendar on Apple and Android (for Thirteen's own Android calendar, by
  Thirteen if gate V18 requires it); by Thirteen on Windows (scheduled toasts) and on the web (while a
  Thirteen tab is open, in browsers that allow it, §2.14).
- Full keyboard, screen reader, Dynamic Type / font scaling, forced colors and reduced motion support,
  like the rest of the app.

### 1.2 Non-goals for 1.0

Not in 1.0 (the full deferred list with reasons is §8.4): search, inviting people or replying to
invitations inside Thirteen, editing attendees, a time zone picker, travel time, reminders (to-dos),
widgets, `.ics` import on Apple and Android, CalDAV or any account sign-in on Windows and web, syncing
local events between Windows and the web, and the web as an offline PWA.

### 1.3 Sync model per platform

| | iPhone, iPad | Mac | Android | Windows | Web |
|---|---|---|---|---|---|
| Event source | EventKit (all calendars on the device) | EventKit | CalendarContract (Calendar Provider) | Thirteen's local calendars + subscriptions | same as Windows |
| Synced with | whatever the OS syncs: iCloud, Google, Exchange, Microsoft 365, Yahoo, CalDAV, subscribed calendars, Birthdays | same | whatever has a sync adapter: Google, Exchange (Gmail app, Samsung, Outlook app), DAVx5, local calendars | nothing; `.ics` export and import move events between devices | nothing; same as Windows |
| Who does the networking | the OS | the OS | the OS sync adapters | Thirteen, only to fetch subscribed feeds | the browser, only to fetch subscribed feeds |
| Permission | Calendars, Full Access | Calendars, Full Access + sandbox entitlement | `READ_CALENDAR`, `WRITE_CALENDAR` (+ `POST_NOTIFICATIONS` only if the V18 fallback ships) | none | none (Notifications only if the user turns on alerts) |
| Alerts fired by | iOS Calendar notifications | macOS | the device's calendar app via the provider; for the "Thirteen" device calendar, Thirteen itself if V18 fails (§2.14) | Thirteen, as scheduled Windows toasts | Thirteen, while a tab is open, through its notifications-only service worker |
| Data lives | in the user's accounts and the OS database | same | same | `%LOCALAPPDATA%\Thirteen\Calendars\` | the browser's IndexedDB for the site's origin (§3.6) |

Thirteen never writes Calendar.app's or Android's own show/hide state, never creates accounts, and never
sends event data anywhere. The one exception to "no calendar of its own" on Android is the optional
"Thirteen" calendar on the device (§2.15), created only when the user asks because no calendar can be
written.

**The web origin.** Everything the web app stores (IndexedDB, the notification permission, the storage
persistence grant, Web Locks, BroadcastChannel) belongs to the page's origin, not its path. 1.0 serves
the web app from `https://thirteen.haugas.dev/`, an origin that no other site uses (§3.6, §8.3, §8.5).

### 1.4 What keeps the privacy label

The App Store label "Data Not Collected" stays true as long as event data never leaves the device through
Thirteen: no analytics, no crash SDK, no logging of event text to anything that is uploaded (Apple
`OSLog` interpolations of titles, notes or locations MUST be `privacy: .private`), no network code in the
Apple and Android apps. Details in §7.

---

## 2. UX

Everything here applies to every platform unless a platform is named. Platform idiom wins for chrome
(navigation bars, sheets, menus, dialogs, pickers); Thirteen's own components (grids, chips, plates,
badges) look the same everywhere, drawn from `design/tokens.json`.

**Widths.** Compact width: iPhone, iPad in Slide Over or a narrow split, Android compact and medium width,
web under 48rem (768 px, the Shell's existing breakpoint). Regular width: everything else. The Mac (minimum
window 860 pt) and Windows (minimum window 680 px) always use regular width.

### 2.1 Navigation changes

The five sections become: **Today, Calendar, Convert, Compare, History**. "Calendar" replaces "Year" in the
same position, with the same icon (SF Symbol `calendar`, Phosphor `CalendarBlank`, Material
`calendar_month`) and the same shortcut (⌘2 / Ctrl+2).

Calendar has five **modes**:

| Mode | Shows | Compact width | Regular width |
|---|---|---|---|
| Year | 13 month grids + intercalary days, today, Gregorian overlay, event dots | yes (top of the drill-down) | yes |
| Month | one 13-month month: 4 x 7 grid with events, intercalary band | yes (default) | yes (default) |
| Week | one 13-month week as a 7 (8 or 9 with intercalary days) column timeline | no | yes |
| Day | one day as a timeline with an all-day row | yes | yes |
| List | every upcoming event, grouped by 13-month month and day | yes | yes |

- **Compact width**: Apple Calendar's drill-down. Year shows 13 small months; tapping a month opens Month;
  in Month, tapping a day selects it and lists its events under the grid; the day header in that list (or
  a second tap on the selected day) opens Day. The back button reads the parent ("2026", "October").
- **Regular width**: a segmented control "Day, Week, Month, Year, List" in the toolbar (Apple, Windows,
  web); on Android expanded width a segmented button row in the top app bar. The sidebar (Apple iPad and
  Mac, Windows pane, web left column) shows the Calendars list (§2.15) under the sections while Calendar
  is selected. Android expanded width has no such sidebar (its navigation rail holds only the sections),
  so its top app bar keeps the overflow menu with the system choice and "Calendars"; "Calendars" opens
  the Calendars list as an on-demand supporting pane on the trailing side of the grid (owner decision;
  Navigation3 supporting pane scene, 360 dp wide): hidden until the user opens it, closed by its Close
  button (`editor.close`) or Back, and not reopened by itself, so the Calendar grid starts at full width.
- Calendar remembers its last mode and date per window. First launch: Month, today.

**Toolbars.** Exactly these controls, in this order. "Today" goes to today in the current mode and is
hidden (not disabled) while today is already on screen: Month contains today, Week contains today, Day is
today, List starts at today, Year is the current year.

| Platform and width | Leading | Title | Trailing |
|---|---|---|---|
| iOS compact | back to the parent (none in Year) | large title and subtitle; the title is a title menu (`toolbarTitleMenu`) with the system choice (IFC, Positivist) and "Calendars" | "Today" (text), List / Month toggle (Month and List only), "+" |
| Android compact and medium | back arrow (none in Year) | title and subtitle in a `TopAppBar` | "Today" action (icon `today`, label "Today"), List / Month toggle, overflow menu with the system choice and "Calendars"; the FAB is "New event" |
| Web compact | back (none in Year) | title button with a menu: the system choice and "Calendars"; "‹" and "›" buttons on both sides of the subtitle | "Today", List / Month toggle, "+" |
| Regular width: Apple, Windows, web | "‹", "›", "Today" | title and subtitle | segmented mode control; "New event" |
| Android expanded | "‹", "›", "Today" | title and subtitle in the `TopAppBar` | segmented button row, overflow menu with the system choice and "Calendars" (the supporting pane above); the extended FAB is "New event" |

**Stale subscriptions** (Windows, web). While any visible subscription is stale (not updated for twice
its interval, §2.16, offline or not), the Calendar toolbar shows a status button with the warning icon,
"Subscriptions not updated" (`calendar.subscriptionsStale`), after the title and subtitle (web compact:
on the subtitle line). It opens the Calendars list (the pane on Windows, the left column on web wide, the
title menu's "Calendars" sheet on web compact), where the stale rows say which feed and since when. So
someone offline for days sees in Month, List and Up next that a feed's events may be outdated.

**Paging without gestures.** Swiping left or right on Month, Week and Day moves to the next or previous
period on touch platforms, but no task needs a gesture:

- iOS: `accessibilityScrollAction` on the Month, Week and Day surfaces (VoiceOver three-finger swipe), and
  the custom actions "Previous month" and "Next month" ("week", "day" in those modes) on the grid and on
  the title, for Switch Control, Voice Control and Full Keyboard Access.
- Android: the same two custom actions on the grid and the title (TalkBack actions menu, Switch Access),
  and Ctrl+Left / Ctrl+Right with a hardware keyboard.
- Web compact: the "‹" and "›" buttons. Regular width and Windows have them in the toolbar.
- After paging, the new title and subtitle are announced politely ("November 2026. Gregorian Nov 5 to
  Dec 2.") and focus stays on the same grid position.

The system switcher, theme and Gregorian overlay behave as today (on compact width the system switcher
lives in the title menu). Month, Week, Day and List always show Gregorian dates; the overlay setting only
affects Year.

Titles:

| Mode | Title | Subtitle |
|---|---|---|
| Year | `2026` (display year: `238` in Positivist) | `Gregorian 2026` (Positivist only) |
| Month | `October 2026` (`Descartes 238`) | `Gregorian Oct 8 to Nov 4` (year added when the range crosses years) |
| Week | `October 2026, week 2` | `Gregorian Oct 15 to 21` |
| Day | `Thursday, October 12, 2026` / `Year Day 2026` (with a "No weekday" plate) | `Gregorian Monday, October 19, 2026` / `Gregorian Thursday, December 31, 2026` |
| List | `Upcoming` | none |

### 2.2 Visual language for events

- **Calendar color** marks an event, never carries text. Chips use a 3 px leading bar (timed) or a fill
  at 16% of the color over `paper-raised` (all-day and multi-day bars), with text in `ink`. On the dark
  themes the fill is 24%. Dots are 6 px with a 1 px `rule` ring, so pale colors (yellow) stay visible.
  Calendar colors come from the platform (EventKit, `CALENDAR_COLOR` / `DISPLAY_COLOR`) or from the user
  (Windows, web: palette in §3.6). Colors are converted to sRGB once and never themed.
- **Timed single-day event** (Month, Year day sheet, List): dot + start time in Geist Mono (§2.19 time
  forms) + title in Geist. In Week and Day: a block from start to end with title, time and location.
- **All-day event and any event of 24 hours or more**: a bar. In Month a bar spans the days it covers
  inside one week row. In Week and Day it sits in the all-day row.
- **Continuation**: a bar that continues before or after the visible row has a squared, notched end
  (6 px chevron cut) on that side instead of a rounded end. The accessible label says "continues from" or
  "continues to" (§2.20).
- **Tentative** events (status tentative or the user's reply "maybe"): diagonal hatch at 8% and a
  "Tentative" tag. **Canceled** events (organizer canceled): title struck through in `ink-2` (never
  `ink-3`, which drops under 4.5:1 on the dark tints) and a "Canceled" tag. Declined invitations are
  hidden (like Apple Calendar's default).
- **Read-only** events show no grab handles, cannot be dragged, and their details show a lock glyph and a
  reason (§2.10).
- **Today** keeps the accent fill on the day number. **Now** in Week and Day is a 2 px accent line drawn
  under the event blocks (blocks cover it; it shows between them), with a 10 px dot and the time label on
  the time axis, never inside a column, so it cannot be mistaken for a canceled event's strikethrough.
- **Intercalary days** are never squeezed into a weekday column. In Month they are a full-width band below
  week 4 of the month they follow (`afterMonth`: IFC Leap Day after June, IFC Year Day after December,
  Positivist festivals after Bichat), drawn like the existing `IntercalaryDayBadge` (code plate `YD`,
  `LD`, hatch) with that day's events inline. In Week they are an extra column after Saturday (Sunday for
  Positivist, whose weeks start on Monday), headed by the code plate. In Year they keep their badge, with
  event dots.
- **Gregorian dates**: in Month every cell shows the 13-month day large (Geist, tabular figures) and the
  Gregorian day small (Geist Mono, `ink-3`). Where a Gregorian month starts, its abbreviation (`NOV`) is a
  separate small label directly above that Gregorian day, inside the same cell, never on the same line as
  a number.
- **Minimum sizes** at the default text size, scaled with the user's text size: chip and bar text 11 pt
  (sp, CSS px), Gregorian day 10, weekday header 10, dots 6.

### 2.3 Year mode

The existing Year screen, plus:

- Under each day number, up to three 4 px dots in the colors of the first three calendars with events that
  day (order from `yearEventMarks`, §5.3), or nothing. Intercalary badges get the same dots.
- The accessible value of a day cell adds `year.cell.events`, "{n} events" (or "1 event"; plural), on
  days with events.
- Selecting a day still opens the day sheet (§2.9), which now starts with that day's events.
- Selecting a month title opens Month mode for that month.
- Setting "Show events in Year view" (default on) hides the dots when off.
- With no calendar access, or with "Show my events" off (Apple, Android, §2.18), Year shows no dots and no
  prompt; prompts live in Month, Week, Day, List and Today (§2.16).

### 2.4 Month mode

**Weekday header (every width).** Two lines per column. Line 1: the 13-month weekday (IFC weeks start on
Sunday, Positivist weeks on Monday). Line 2, in Geist Mono `ink-3`: the Gregorian weekday that column falls
on in this month. Inside one 13-month month a column always falls on the same Gregorian weekday, because
the intercalary days sit between months (SPEC §3, weekday shift), so the header is exact. Values come from
`monthColumnGregorianWeekdays` (§5.2), so the four ports draw the same header; the 13-month date picker
(§2.12) uses the same header.

| Width | Line 1 | Line 2 (IFC October 2026) | Accessible name of a header cell |
|---|---|---|---|
| Compact | `S M T W T F S` | `T F S S M T W` | "Sunday. Gregorian Thursday" |
| Regular | `Sun Mon Tue Wed Thu Fri Sat` | `Thu Fri Sat Sun Mon Tue Wed` | same |

**Compact width (phones)**

- 4 rows x 7 cells. Each cell: the 13-month day number, the Gregorian day under it (with the Gregorian
  month label above it where a month starts, §2.2), then the day's events in one of two **densities**,
  chosen once per screen (never per cell) from the cell width and the text size:
  - **Titles** when cells are at least 60 pt (dp, CSS px) wide and the text size is the default or smaller
    (Apple Large, Android font scale 1.0, browser 16 px): up to 2 lanes of bars and titles (lane order
    from `layoutThirteenMonthEvents` with `maxLanes: 2`; timed items without their time), chip text 11 pt,
    then "+N" when items are hidden. Examples: iPhone Plus and Pro Max (430 and 440 pt), Android medium
    width, a web window 600 px wide.
  - **Dots** otherwise: up to three 6 px dots in calendar colors (order from `yearEventMarks`, §5.3) and,
    when the day has more than three events, the count in Geist Mono (`5`). Examples: iPhone 375 to 402
    pt, Android 360 to 412 dp.
- The grid takes about half of the screen. The intercalary band sits under week 4 when the month is
  followed by one or two intercalary days, in the same density as the cells.
- Below the grid: the **selected day's list**. Header: `Thursday, October 12` + `Gregorian Mon, Oct 19`,
  with a chevron to open Day and a "+" to add an event on that day. Rows: all-day items, then timed items
  in start order (the row design of Today's Up next, §2.8). Empty: "No events." with a "New event" text
  button.
- Tapping a cell selects it (today is selected on open). Tapping the selected cell again opens Day.
  Long-press on a cell (Android, iOS context menu) offers "New event", "Open day", "Day details" (the
  comparison sheet).
- **Moving an event on a phone** starts from the selected day's list, never from a cell: long-press a
  row, then drop it on a cell of the grid (it keeps its time; §2.11 drag rules). Cells are too small to
  pick up one event safely. Day mode keeps long-press and drag on its full-width blocks.
- **Accessibility text sizes** (Apple AX1 and larger, Android font scale 1.5 and larger, browser text
  24 px and larger): the grid becomes a vertical list of the month's days, like the Year grid at those
  sizes. A day row reads `Thursday, October 12` + `Gregorian Mon, Oct 19`, then up to three event lines
  (time and title, wrapping) and "+{n} more", which opens Day. A single day without events is one line
  (its date and Gregorian date); a run of two or more such days is one line, "No events, October 21 to
  October 23" (`calendar.emptyRun`, 13-month dates without weekday or year; an intercalary day by its
  name, "No events, December 27 to Year Day"), which opens Day on the run's first day. The separate
  selected-day list is not shown, because the rows already hold the titles. The order and runs come from
  `agenda(..., {includeEmptyDays: true})` (§5.3).

**Regular width (iPad, Mac, Windows, web, Android expanded)**

- Same grid at full size: as many lanes as fit (`maxLanes` = floor((cellHeight - dayHeader) / laneHeight),
  lane height 20 pt at the default text size, scaled with it), timed items show `09:30 Sprint planning`
  (12-hour: `9:30a Sprint planning`, §2.19), bars show the title once per row.
- Click selects a day; double-click on empty space in a cell opens the editor on an unsaved draft for
  that day (next whole hour if it is today, else 09:00, one hour long; nothing is stored until Add, and
  Cancel leaves nothing behind). On the Mac and iPad that editor is a popover anchored to the cell
  (§2.11). Click on an item selects it; double-click or Enter opens its details popover (Mac, iPad with a
  pointer, web) or flyout (Windows).
- **iPad by touch** (regular width, a finger rather than a pointer), as Calendar on iPad does, in Month,
  Week and Day: a tap on a chip or block opens its details popover; a tap on a cell's empty space selects
  the day; touch and hold on a Month cell's empty space, or on empty Week or Day time, makes the unsaved
  draft (Month: as a double-click does; Week and Day: one hour at that half hour, stretched by dragging
  before lifting) and opens the anchored popover editor; touch and hold on a chip or block, then drag,
  moves it (a drag on empty time scrolls). Month chips keep their 20 pt lanes: each chip's hit area is
  the full cell width and at least the lane height, and the cell's "+N more" popover lists the day in
  44 pt rows for anyone who needs larger targets (the exception to §2.20 Targets).
- Drag an item to another cell to move it. **Option-drag (Mac, iPad with a keyboard) or Alt-drag
  (Windows, web) copies it**: the drop opens Duplicate (§2.10) at the dropped place, an unsaved draft on
  the dropped day with the event's own time (Week and Day: at the dropped time), in the popover editor
  anchored to the drop on the Mac and iPad and in the editor dialog on Windows and web. Duplicate's
  field rules apply (no repeat, invitees or identifiers; the same calendar if it is writable, else the
  default calendar), read-only events can be copied, and nothing is stored until Add, so there is no
  toast and nothing to undo before then; Add is an editor save (§2.11).
- "+N more" opens a popover titled with the day (`Thursday, October 12` + `Gregorian Mon, Oct 19`) that
  lists the whole day in the rows of the compact day list. Its rows open details, can be dragged onto the
  grid, and take Delete. The compact selected-day list is not shown at this width.
- On web wide and Windows, a right-click context menu on a cell or item mirrors the long-press menu, plus
  "Delete" on items.

**States** (every width; the same lines apply to Week, Day, List and Up next):

| State | What shows |
|---|---|
| Loading | the grid renders immediately; items fade in (no fade with Reduce Motion); a small progress indicator in the toolbar after 300 ms |
| No access (Apple, Android) | the grid without items and the access card of §2.16 above the day list (compact) or as a top banner (regular) |
| "Show my events" off (Apple, Android) | the grid without items and without any card |
| Every calendar hidden | the grid without items, and "All calendars are hidden." with the button "Show calendars" where the day list, List or Up next would say "No events." The button opens the Calendars list where that layout keeps it: the Calendars sheet on compact width (Apple, Android, the web's title menu sheet), the sidebar on iPad and Mac (shown first if it was collapsed), the pane on Windows, the left column on web wide, the supporting pane on Android expanded (§2.1); focus moves to the first hidden calendar's toggle |
| Error reading events | the toast "Couldn't load events." with the button "Try again" |
| Offline with subscriptions (Windows, web) | stored events as usual; the offline banner of §2.16 in the Calendars list, and once a visible subscription is stale, the toolbar status button of §2.1 ("Subscriptions not updated") |

### 2.5 Week mode (regular width only)

- Columns: the 7 days of one 13-month week (row 1 to 4 of the month), plus one column per intercalary day
  that follows that week (IFC: week 4 of June in leap years and week 4 of December; Positivist: week 4 of
  Bichat, one or two columns). Intercalary columns are 60% wide and hatched.
- Column header: `Thu 12` (13-month weekday and day) and `Mon, Oct 19` under it (Gregorian, `ink-3`).
  Intercalary header: plate `YD` + `Year Day` + `Thu, Dec 31`.
- All-day row on top (bars across columns, lanes, collapsible after 3 lanes with "+N").
- Timeline 00:00 to 24:00, hour rules every hour, half-hour hairlines, scrolled on open to 07:00 or the
  first event of the week if earlier; hour labels in Geist Mono in the OS 12 or 24-hour form (`09:00`,
  `9 AM`), in a label column wide enough for `12 PM` at the current text size.
- Event blocks positioned by `layoutThirteenWeekEvents` (§5.3) with `maxSlots` = floor(column width /
  48 pt), at least 1. Minimum visual height 15 minutes. A cluster with more overlapping events than
  `maxSlots` shows its first `maxSlots - 1` slots and a "+{n}" block in the last one, covering the hidden
  events' time range; it opens a popover that lists them (accessible name "3 more events at 14:00").
- Click and drag on empty time creates an unsaved draft from the drag range (snapped to 15 minutes) and
  opens the editor (a popover anchored to the draft block on the Mac and iPad, §2.11; iPad by touch:
  touch and hold, §2.4). Drag a block to
  move (15-minute snap, across columns, including into the all-day row, which turns it all-day); Option
  or Alt-drag copies it as in Month (§2.4). Drag a block's bottom edge to change the end (pointer
  platforms and iPad with pointer).
- Previous and next step by one 13-month week; week 4 of December goes to week 1 of January.
- Each column is one accessibility container named for its day, with its blocks inside it (§2.20).

### 2.6 Day mode

- Header strip: the 13-month week of the day as 7 small day buttons (plus intercalary), the selected one
  filled. On an intercalary day the strip shows the week before it plus the intercalary day.
- All-day row, then the timeline of Week with one column; `maxSlots` = floor(column width / 64 pt).
- Phones: swipe or the paging actions of §2.1 change the day; long-press and drag a block to move it.
  Creating an event from the timeline follows each platform's own calendar app:
  - iOS: touch and hold empty time; the editor opens on a one-hour draft at that half hour. A tap on
    empty time does nothing (it would fight scrolling and dismissing).
  - Android and web compact: a tap on empty time draws a one-hour "New event" placeholder block at that
    half hour (accessible name `calendar.placeholder.a11y`, "New event, 14:00 to 15:00"); a tap on the
    placeholder opens the editor, a tap anywhere else removes it. Nothing is stored before Add.
  - Assistive technology: each column's "Add event" action (§2.20) opens the editor at the next half
    hour on screen.
- Regular width: a details panel on the right (the event details of §2.10 for the selected event, or the
  day's comparison when nothing is selected).

### 2.7 List mode

- A continuous list from the selected day onward (backward on scroll up), grouped by 13-month month
  (sticky header `October 2026`) and day (header `Thursday, October 12` + `Gregorian Mon, Oct 19`). Days
  without events are skipped. Intercalary days head as `Year Day` + `Gregorian Thu, Dec 31`.
- Multi-day events appear on every day they cover, with "Day 2 of 3" in place of the time.
- Time column in the OS 12 or 24-hour form, sized for `12:30 PM` at the current text size.
- Loads 13 months at a time (one Gregorian year per fetch, §6).
- Empty: "No upcoming events." with "New event". Every calendar hidden: the line of §2.4.

### 2.8 Today: Up next

A new card under the hero on Today, before "Against the Gregorian calendar":

- Title "Up next", trailing "+" (new event today) and "Show all in Calendar" (opens List).
- Groups: "Today", "Tomorrow", then each later day as `Saturday, October 14` + `Gregorian Wed, Oct 21`,
  up to 7 days ahead and at most 6 rows (the rest summarized as "{n} more in the next 7 days").
- Row: time column (Geist Mono: `11:00` or `11:00 AM`, or "All day", or "Day 2 of 3"), calendar dot,
  title, second line with location or `until 11:30`. An event in progress shows a "Now" plate in the
  accent and its row first.
- Events that ended earlier today are not shown.
- Empty: "Nothing else today." when today has nothing left but later days do; "No events in the next 7
  days." when the whole range is empty.
- When the card is shown:
  - Apple and Android: whenever "Show my events" is on (§2.18). Without access it holds the access card
    content of §2.16, which collapses to the one-line link "See your events here" after 3 launches
    without a decision.
  - Windows and web: once a local calendar holds an event or a subscription exists. Before that Today has
    no Up next card, so people who never use events see nothing new.
- The Mac menu bar extra adds one line under the date: `Next: 19:00 Book club: Cotsworth` (or nothing),
  read to VoiceOver as "Next event: Book club: Cotsworth at 19:00".

### 2.9 Day sheet (the existing day detail)

The comparison sheet opened from Year (and from Today and Convert) gains an **Events** section at the top:
the day's items as in §2.8, "New event" and "Open in Calendar" (Day mode). The rest of the sheet is
unchanged. On days with no events the section shows "No events." and "New event". With "Show my events"
off the section is not shown.

### 2.10 Event details

Phones: pushed screen (Apple), full screen (Android), full-screen sheet (web compact). Regular width:
popover anchored to the item (Mac, iPad, web), flyout (Windows), detail pane (Android expanded). Closing a
popover or flyout returns focus to the item that opened it.

Content, top to bottom:

1. Title (Geist semibold 22), calendar color bar on the leading edge, "Tentative" or "Canceled" tag.
2. Date plate: the 13-month date `Thursday, October 12, 2026` (or `Year Day 2026`) and the Gregorian date
   `Monday, October 19, 2026` under it in Geist Mono. Multi-day: `Starts` and `Ends` lines, each with both
   dates.
3. Time: `09:30 to 10:30`, or "All day". If the event's time zone differs from the device's: a second line
   "In New York: 21:00 to 22:00" (zone's city name from the platform).
4. Repeat: the description from `describeRecurrence` (§5.2), for example "Every IFC month on the 12th".
   On Android, for a series that uses `BYYEARDAY` (made on an Apple device): the note
   `event.androidByYearDay`, "Other Android calendar apps may show this repeat on the wrong days, and
   alerts on this phone may come on the wrong days. Thirteen shows the right days." (The provider's own
   instances, one per year, drive Android's alarms; §6.3.)
5. Calendar: dot, name, account (`Home, iCloud`).
6. Alerts: one line per alert, or none.
7. Show as (only if not Busy), Location (tappable: opens Maps / `geo:` intent / Windows Maps / Google Maps
   web search; on Android started in try/catch and shown as plain text when no app handles it, §6.3), URL
   (tappable), Notes (selectable text, links detected), Organizer and Invitees (names, read-only, Apple
   and Android only; more than 5 invitees show as "{n} invitees" with the list behind it).
8. Read-only notice when applicable (§3.5): lock glyph + the reason line `event.readOnly.*` (§2.19).
9. Actions:
   - Writable events: "Edit" (toolbar on Apple, top app bar on Android, button on Windows and web),
     "Delete event" (destructive, bottom), and "Duplicate" in the overflow menu. Duplicate opens the
     editor on an unsaved draft: the event's fields without its repeat, invitees or identifiers, in the
     same calendar if it is writable, else the default calendar; title "New event", button "Add".
     Nothing is stored until Add, so Cancel leaves no copy behind.
   - Invitations (Apple, Android): "Open in Calendar" (Apple) or "Open in calendar app" (Android), to
     reply or change the event there, and "Edit alerts" when `alarmsEditable` (§3.5, gate V20), which opens
     the editor reduced to Alert and Second alert. "Duplicate" stays.
     - Apple: `calshow:{seconds from 2001-01-01T00:00:00Z to the occurrence start}` through
       `UIApplication.open` (iOS) or `NSWorkspace.open` (Mac). It opens the Calendar app on that day. Gate
       V21; Mac fallback: open the Calendar app without a date.
     - Android: `Intent(ACTION_VIEW, ContentUris.withAppendedId(Events.CONTENT_URI, id))` with
       `EXTRA_EVENT_BEGIN_TIME` and `EXTRA_EVENT_END_TIME`; it opens the event itself. The button is hidden
       when no app resolves the intent (manifest `<queries>`, §6.3).
   - Other read-only events (subscribed, Birthdays, read-only calendars): no Edit or Delete; "Duplicate"
     stays.
   - Android, while the fallback of gate V2's Android leg is in force (§8.2): a series whose stored
     `RRULE` uses `BYYEARDAY` (made on an Apple device) is read-only except its alerts (§3.5): "Edit
     alerts", no Edit or Delete, "Duplicate" stays, and the reason line
     `event.readOnly.byYearDay.android` under the `event.androidByYearDay` note.
   - Events before 1583 (`historical`, §3.5) on Windows and web: "Edit alerts" and "Delete event" next to
     the reason line `event.readOnly.historical.local`, because no other app can change them there. On
     Apple and Android they are like other read-only events.

### 2.11 Event editor

Presentation:

| Platform | Opened by | Container | Chrome |
|---|---|---|---|
| iPhone, and iPad at compact width (Slide Over, a narrow split) | everything | sheet, large detent | leading "Cancel", trailing "Add" / "Save" |
| iPad at regular width, Mac | a draft made by dragging in Week or Day, double-clicking in Month, touch and hold on empty time or a Month cell (iPad by touch, §2.4), an Option-drag copy (§2.4), "Edit" or "Duplicate" in a details popover | popover anchored to the draft block, cell or event (Duplicate: the source event; a copy: its drop); 360 pt wide, up to 640 pt tall, scrolling; the repeat, alert and calendar pickers push inside it, and the 13-month date field (§2.12) and the time picker expand inline under their row, so a popover never opens a second popover | same buttons at the top of the popover |
| iPad at regular width, Mac | "+", ⌘N, "New event" in a menu, a deep link | form sheet (iPad), sheet window 480 x 680 pt (Mac) | same |
| Android | everything | full-screen dialog (compact), dialog (expanded) | navigation icon Close (X, `editor.close`), title, trailing text button "Add" / "Save"; "Delete event" in the overflow menu (edit mode) |
| Windows, web wide | everything | modal dialog 560 px wide | "Cancel" and "Add" / "Save" in the footer, "Delete event" on the left of the footer |
| Web compact | everything | full-screen sheet | as Windows, footer pinned |

Title "New event", "Edit event" or "Edit alerts" (invitations). Add and Save are always enabled (see
Validation). At accessibility text sizes (Apple AX1+, Android 1.5+, Windows 150%+, browser text 24 px+)
the popover form becomes the sheet form, and each date row (§2.12) stacks vertically: label, date button,
time button and caption, each on its own line at full width.

Fields, in order (grouped like Apple Calendar):

| Group | Field | Notes |
|---|---|---|
| 1 | Title | placeholder "Title"; autofocus on new events; if left empty, saved as "New event" |
| 1 | Location | placeholder "Location"; free text |
| 1 | Invitees footer | only for events with invitees: Apple organizer "Changes are sent to {n} invitees."; Android organizer "Your calendar account may send these changes to {n} invitees."; Windows and web, an imported event with `ATTENDEE` lines: "Changes stay in Thirteen. Invitees aren't told." |
| 2 | All-day | switch |
| 2 | Starts | 13-month date field (§2.12) + time field (hidden when all-day); caption under it: `Gregorian Monday, October 19, 2026` |
| 2 | Ends | same; caption; error "The end must be after the start." when invalid |
| 2 | Time zone note | only when the event's zone differs from the device's: "Times are in New York time." (no picker in 1.0) |
| 3 | Repeat | shows the current description; opens the repeat picker (§2.13). Android: the storage note that the picker shows under the selected row (`repeat.note.androidHorizon*` or `repeat.note.androidReencode*`, §2.13, under the same conditions) is repeated as a caption under this row (board H2); it updates when End repeat changes |
| 3 | End repeat | only when repeating: "Never", "On date" (13-month date field), "After" ({n} times, 1 to 999, on every platform) |
| 4 | Calendar | dot + name; opens the calendar picker (writable calendars only; for an existing event with invitees, only calendars of the same account, §2.15). Apple write-only access: fixed, reads "Default calendar", footer "New events go to your default calendar. To see them here, allow Full Access." |
| 5 | Alert, Second alert | §2.14; Second alert appears once Alert is set and the calendar keeps more than one alert |
| 5 | Show as | "Busy" / "Free"; only when the calendar supports it |
| 6 | URL | placeholder "URL"; `https://` is added when a scheme is missing |
| 6 | Notes | multi-line |
| 7 | Delete event | edit mode only, destructive (Android: in the overflow menu instead) |

Behaviour:

- New event defaults: start = the selected day at the next whole hour if it is today (23:00 when the next
  whole hour would be tomorrow), otherwise 09:00; one hour long; all-day off (on when created from an
  all-day row or bar); repeat Never; calendar = the default calendar (§2.15); alerts none; show as Busy
  for timed events and Free for all-day events (as Apple Calendar and Google Calendar do).
- Changing Starts moves Ends by the same amount (duration kept). Changing Ends never moves Starts.
- Turning all-day on keeps the dates and drops times, and sets Show as to Free unless the user already
  chose a value in this editor; turning it off restores the last times or 09:00 to 10:00, and Busy under
  the same condition (`setDraftAllDay`, §5.2). Turning it off also restores the zone (its `timeZone`
  option): the device zone for a new event, the zone the event had before it became all-day for an
  existing one, so turning all-day on and off again changes nothing.
- Changing Starts re-derives the repeat from the new start (`adaptRecurrenceToStart`, §5.2), with exactly
  these outcomes, so no change of repeat kind is ever silent:

  | Repeat | New start | Result | Notice under Repeat |
  |---|---|---|---|
  | 13-month monthly, weekly, every 2 weeks | a month day | follows the new month day, weekday or fortnight phase | none |
  | 13-month monthly, weekly, every 2 weeks | an intercalary day | Never | `editor.notice.repeatDropped`: "Repeat changed to Never: Year Day belongs to no month and no week.", then the later-events line below |
  | 13-month yearly | a month day | yearly on the new date | none |
  | 13-month yearly | an intercalary day | that day's intercalary repeat | `editor.notice.repeatChanged`: "Repeat changed to Every Year Day." |
  | intercalary | the same day in another year | unchanged | none |
  | intercalary | another intercalary day | that day's repeat | `editor.notice.repeatChanged` |
  | intercalary | a month day | 13-month yearly on the new date | `editor.notice.repeatChanged`: "Repeat changed to Every year on IFC June 28." |
  | Gregorian preset | any day | follows the new day (minimal forms derive it from the start) | none |
  | Gregorian custom with explicit days, `Keep:` rules | any day | unchanged (the start stays the first occurrence even on a day the rule skips, as in Apple Calendar and RFC 5545) | none |

  While the start is a leap-only day (IFC Leap Day, Positivist Festival of Holy Women) and the repeat is
  that day's repeat, the date field's year stepper moves between leap years only (§2.12), so "every 4
  years" never turns into a yearly repeat by accident.

  **Later events deleted.** When an edited occurrence's repeat becomes Never (the table's `dropped` row,
  or the user picks Never), saving for future events deletes every later occurrence. The editor says so
  under the Repeat notice as soon as it applies, with the count from `laterOccurrenceCount` (§5.2):
  `editor.notice.laterDeleted`, "Saving for future events deletes the {n} later events in this series."
  (plural); `editor.notice.laterDeleted.endless`, "Saving for future events deletes every later event in
  this series." when the series never ends; on the first occurrence `editor.notice.becomesSingle`, "The
  series becomes one event on {date}." The span dialog repeats the line (below).

  **On Android, an Apple-made `BYYEARDAY` series** follows a new start with a new `BYYEARDAY` list (or
  with the form (a) or (c) rule of a converted repeat), never with a list of dates, and shows no
  re-encode note (§4.9 rule 3).
- **Changed occurrences that a retime would drop** (Android, Windows, web; on Apple EventKit retimes the
  series itself): when Starts or All-day changes on the first occurrence of a series that has changed or
  removed occurrences, the editor runs `retimeExceptions` (§4.7) at once, and when it would drop some,
  `editor.notice.exceptionsRemoved`, "Changes to {n} single events in this series will be removed when
  you save." (plural), shows under Starts and is announced politely. It goes away if the change is
  undone in the editor.
- Changing Calendar:
  - to one that keeps fewer alerts: at once, the Second alert row disappears and the notice "Work keeps
    only 1 alert, so the second alert was removed." shows under Alert (for a calendar without alerts:
    "Work doesn't keep alerts, so the alerts were removed."). The notice is announced politely.
  - to one that cannot keep the chosen 13-month repeat (§3.5): the repeat stays and the Repeat row shows
    the note of §2.13 with an error icon; Save then opens the conflict dialog below.
- **Validation.** Issues come from `validateDraft` (§5.2). Each issue shows as soon as it exists, under
  its field, as an error icon plus text (never color alone), is announced politely once
  (`UIAccessibility` announcement, Compose `LiveRegionMode.Polite`, Avalonia
  `AutomationProperties.LiveSetting="Polite"`, `aria-live="polite"`), and is attached to its field as its
  error (Apple `accessibilityValue` + hint, Compose `semantics { error(text) }`, Avalonia
  `AutomationProperties.HelpText`, web `aria-invalid="true"` + `aria-describedby`). Pressing Save with
  issues saves nothing, moves focus to the first field with an issue and announces its text. Issue to
  field: `end-before-start` Ends; `out-of-range` Starts or Ends ("Choose a date from 1583 to 9999.",
  §3.1.1); `until-before-start` and `count-out-of-range` End repeat; `invalid-url`
  URL; `calendar-read-only` Calendar; `too-many-alarms` is fixed automatically (above);
  `repeat-not-on-start` is fixed by re-derivation; `thirteen-repeat-not-allowed` opens:
- **Conflict dialog** (`thirteen-repeat-not-allowed`): title "Work (Exchange) can't keep this repeat",
  message "Exchange and Outlook calendars keep only repeats that follow the Gregorian calendar.", buttons
  "Use “Every year on IFC October 12”" (only when the start's 13-month yearly or intercalary repeat is
  Exchange-safe, §4.3 a and c), "Change repeat to Never", "Choose another calendar" (opens the calendar
  picker), "Cancel".
- **Closing a changed draft asks first**, on every path: Cancel; swipe down on the iOS sheet
  (`interactiveDismissDisabled(isDirty)` plus the same question from
  `presentationControllerDidAttemptToDismiss`); tapping outside an iPad form sheet; tapping or clicking
  outside the editor popover (iPad: `interactiveDismissDisabled(isDirty)` on the popover's content, with
  the question from the same presentation controller delegate; Mac: the `NSPopover` behavior is
  `.transient` while the draft is unchanged and `.applicationDefined` once it changed, and a click
  outside then asks); Escape in the popover; paging, Today, a mode switch, a deep link or opening another
  event while the popover is open (the calendar under an open editor popover does not scroll, page or
  switch modes by itself, so the anchor never leaves the screen); Android Back and predictive back
  (`BackHandler`); Escape, browser Back (`popstate`) and closing the tab (`beforeunload`, with the
  browser's own text) on the web; ⌘W and the close button on the Mac; the close button, Escape and
  Alt+F4 on Windows. An unchanged draft just closes on each of these. "Changed" means different from the
  draft the editor opened with. Copy: "Discard
  changes?" ("Discard changes", "Keep editing"); a new event: "Discard this event?" ("Discard event",
  "Keep editing").
- Save on a repeating event's occurrence asks for the span (§4.7): "This is a repeating event." / "Save
  your changes for this event only, or for this and all future events?" / "Save for this event only",
  "Save for future events", "Cancel". When the repeat rule itself changed, only "Save for future events"
  and "Cancel" are offered with "Changing the repeat applies to this and all future events."
  - **Losses are said before the choice.** Before the dialog opens, Android, Windows and web compute
    what each offered choice would do (`splitRecurrence` for future events, `retimeExceptions` when the
    first occurrence changes its start, §4.7). When changed or removed occurrences after this one would
    be dropped, the dialog adds `span.future.exceptionsDropped`, "Changes you made to {n} single events
    after this one will be removed." (plural). Apple adds `span.future.exceptionsLost` when a changed
    (detached) occurrence of the series comes after this one: gate V23 showed EventKit's split turning
    it into a separate event, with its date shown again, unchanged, in the new series (iCloud on macOS 27,
    phase 0, §4.7). Removed occurrences survive the split, so they alone add nothing. Until V23 is run
    on iOS and with Google calendars, the same rule applies to every Apple calendar. When the repeat
    becomes Never, the dialog adds
    `span.deletesLater`, "The {n} later events in this series will be deleted." (plural), or
    `span.deletesLater.endless`, "Every later event in this series will be deleted.", and "Save for future
    events" takes the destructive style. Nothing is lost silently after the dialog closes.
  - **Repeats set in another app** (`editable: false`, §4.5) cannot be split while their rule is kept
    (§4.7), so their dialog offers "Save for this event only", "Save for all events" (`span.save.all`:
    the change applies to the series in place through `applyToSeries`, §4.7: the series keeps its own
    first date, and takes the edited occurrence's time of day, length, all-day setting, zone and other
    changed details) and "Cancel", with
    `span.keep.message`, "Its repeat was set in another app. Save your changes for this event only, or
    for all events?" When the edit moves the occurrence to another date, only "Save for this event only"
    and "Cancel" are offered, with `span.keep.dateMessage`, "Its repeat was set in another app, so a new
    date can apply to this event only." On Apple, "Save for all events" is offered only while the
    series' own first occurrence still exists unchanged (§4.7); otherwise only "Save for this event only"
    and "Cancel" are offered, with `span.keep.firstGone`, "Its repeat was set in another app, and its
    first event was changed or deleted, so this change can apply to this event only." When the user
    replaced "Keep" with another repeat, the dialog is the rule-changed one above.
- **Invitees are told before anything is sent** (Apple and Android, events with invitees that the user
  organizes; §3.5):
  - Mac editor: Save first asks "Send changes to {n} invitees?" ("Send", "Cancel"), as Calendar on the
    Mac does. iPhone, iPad and Android editors rely on the footer.
  - Drag moves, on every Apple and Android device: before the move is held, Apple asks "Send changes to
    {n} invitees?" (`move.invitees.title`) with "Move and send" and "Cancel"; Android asks "Move this
    event?" (`move.invitees.title.android`) with the editor footer text (`editor.invitees.android`) and
    "Move", "Cancel".
  - Deletes (details, editor, menus, ⌫ and Delete keys): the confirmation adds `delete.invitees.apple`,
    "{n} invitees will get a cancellation." or `delete.invitees.android`, "Your calendar account may send
    {n} invitees a cancellation." (both plural).
  - While such a move or delete is pending, its toast adds `calendar.invitees.apple`, "Invitees will be
    told." or `calendar.invitees.android`, "Your calendar account may tell invitees." ("Event moved to
    14:00. Invitees will be told.").
- Delete asks "Delete this event?" ("Delete event", "Cancel"); for a repeating occurrence: "This is a
  repeating event." / "Delete this event only, or this and all future events?" / "Delete this event
  only", "Delete all future events", "Cancel".
- **Saving is a three-way merge.** The editor keeps the event as it was when the editor opened (the
  original). Save fetches the event again and applies only the field groups where the draft differs from
  the original (`mergeDraft`, §5.2; groups: title, location, notes, URL, time (all-day, start, end, zone),
  repeat, calendar, alerts, show as). Groups the user did not touch keep whatever another app or device
  wrote meanwhile, and are not written at all (§4.9). While the editor is open:
  - the event deleted elsewhere: the editor closes with the alert "This event was deleted in another app."
  - the same group changed both here and elsewhere: the banner `editor.changedElsewhere`, "This event
    changed in another app. Your changes win where you both changed the same detail." Save still works.
    A change elsewhere to groups the user did not touch shows nothing and is kept.
  - the edited occurrence can no longer be found at save time (the series was retimed, split or rewritten
    elsewhere, so the plus or minus one day lookup of §3.2, `ORIGINAL_INSTANCE_TIME` or the
    `RECURRENCE-ID` misses): nothing is saved, and the alert `editor.occurrenceGone`, "This event changed
    in another app. Open it again to edit it.", closes the editor after "OK". No orphan exception is ever
    written.
- Save errors show "Couldn't save the event" with a reason line (§2.19 `editor.saveFailed.*`) and a
  technical code in Geist Mono (`EKErrorDomain 11`, `SQLiteException`, `QuotaExceededError`) for support.
- **Apple write-only access**: "+" opens the editor with the Calendar row fixed to the default calendar
  (EventKit saves to `defaultCalendarForNewEvents` without read access; gate V22). After Add, the toast
  "Event added to your default calendar." (Thirteen cannot show it).
- **Drag edits** (regular-width Month, the compact day list's rows, Week, Day): dropping a moved event
  needs no editor. The move is a change of the time group only, applied to the freshly fetched event
  (never to a cached snapshot), and it is held as a pending change (Undo, below). Read-only events cannot
  be picked up. A repeating occurrence asks for the span first (move: "this event only" or "future
  events"), with the losses lines of the span dialog above (`span.future.exceptionsDropped`, computed
  before the dialog opens). Then:
  - **Repeat changes.** When moving future events (or the first occurrence) would change the repeat
    (`adaptRecurrenceToStart` returns `converted` or `dropped`, table above), the dialog says what
    happens and nothing moves without that choice. `converted`: "Moving future events to Year Day 2026
    changes the repeat to Every Year Day." (`span.move.changesRepeat`), with "Move this event only", "Move
    future events and change repeat" and "Cancel". `dropped`: "Moving future events to Year Day 2026 ends
    the repeat. The {n} later events in this series will be deleted." (`span.move.dropsRepeat`, plural;
    `span.move.dropsRepeat.endless` "... ends the repeat. Every later event in this series will be
    deleted." when the series never ends; on the first occurrence `span.move.dropsRepeat.first`, "Moving
    the first event to Year Day 2026 ends the repeat. The series becomes one event on Year Day 2026."),
    with "Move this event only", "Move and delete later events" (`span.move.deleteLater`, destructive
    style) and "Cancel". The count comes from `laterOccurrenceCount` (§5.2).
  - **Validation.** Before a drag is held, the merged draft (the fetched event with the moved time group
    and, for future events, the adapted repeat) goes through `validateDraft` (§5.2), like an editor save.
    When "future events" would give `thirteen-repeat-not-allowed` (a 13-month yearly repeat on IFC March
    3, which Exchange keeps as form (a), moved to March 4, which needs form (b)), the dialog offers only
    "Move this event only" and "Cancel", with `span.move.notAllowed`, "{calendar} can't keep the repeat
    this move needs, so only this event can be moved." Any other issue (a drop before 1583,
    `out-of-range`) refuses the drop: the event goes back and the issue's text shows as a toast.
  - **Repeats set in another app** (`editable: false`) move only one occurrence: the dialog offers "Move
    this event only" and "Cancel", with `span.move.keep.message`, "Its repeat was set in another app, so
    only this event can be moved."
  - **Invitees.** Events with invitees that the user organizes then ask the invitee question above.
  - On Android a drag never re-encodes an Apple-made `BYYEARDAY` series (§4.9 rule 3), so no drag needs
    the re-encode note.
  - **Toast.** After a move the toast says "Event moved to Thursday, October 13, 2026." (another day, the
    `{date}` form of §2.19, with the year, which names intercalary days: "Event moved to Year Day
    2026."), "Event moved to 14:00." (same day, new time) or "Event moved to Thursday, October 13, 2026
    at 14:00."; after a delete, "Event deleted."
- **Undo.** What can be undone is the same table on every screen; it differs by platform only where a
  written change cannot be reversed exactly:

  | Change | Apple | Android | Windows, web |
  |---|---|---|---|
  | Move or delete (drags, Delete, the menus) while it is pending | Undo discards it | Undo discards it | Undo discards it |
  | A move after it was written (toast closed, or written early) | non-repeating events without invitees | no | yes |
  | A delete after it was written | no | no | yes |
  | Editor save of a single event or of "this event only" (written at once) | non-repeating events without invitees | no | yes |
  | "Future events" and "all events" changes (written at once) | no | no | no |

  Every undoable change is registered with the platform's undo: `UndoManager` on Apple (Edit > Undo and
  Redo, ⌘Z and ⇧⌘Z, shake to undo on iPhone), Ctrl+Z and Ctrl+Y on Windows, Ctrl+Z and Ctrl+Shift+Z (⌘Z
  and ⇧⌘Z on a Mac) on the web outside text fields, and the toast's "Undo" everywhere (the only path on
  Android). A change that is not undoable is never registered: its toast ("Event saved." after an editor
  save of a repeating occurrence on iPhone, any editor save on Android) has no Undo button and no undo
  hint, and Edit > Undo does not offer it.
  - **Moves and deletes are pending first.** They change the views at once but are written only when the
    first of these happens: the toast closes (Toast timing, below); the app or tab leaves the foreground
    (`scenePhase` not active, `visibilitychange` to hidden or `pagehide`, Android `ON_STOP`, the Windows
    window closing or the app exiting, which wait for the write); another write to the same event starts
    (on Windows and web, to the same calendar document); the event changes elsewhere; an alert of the
    event (at its stored time or at its new one) is less than a minute away. For the last trigger each
    platform keeps one timer for the earliest such alert of every pending change, so the OS calendar on
    Apple and Android never fires an alert for an event that is about to be deleted or moved, and Windows
    and web never plan one from stale data. Undo while the
    change is pending discards it: nothing was written, nothing was sent to invitees, and no identifier
    changed. This covers the cases that cannot be reversed after writing (a deleted event with invitees, an
    Apple "this event only" delete, an Android `RDATE` occurrence change).
  - **The web journal.** On the web each pending change is also recorded synchronously in `localStorage`
    (`thirteen-pending`) when it is made, tagged with its tab's id (a random UUID per tab), and removed
    once it is written or undone, because an IndexedDB transaction started while a tab closes may never
    complete. Every tab holds the Web Lock `thirteen-tab-{tab id}` for as long as it is open. On load and
    whenever a tab becomes visible, it replays, inside the `thirteen-events` lock, only the entries whose
    tab lock is free (`navigator.locks.query()` lists no holder for it, so that tab has closed); the
    entries of a tab that is still open are left to that tab, so its Undo keeps working. A replay goes
    through `mergeDraft` on the stored group. A delete whose event is already gone, or a move whose time
    group already equals the moved one, counts as written (the write completed before the tab closed and
    only the journal removal was lost) and is removed without a toast; a replay that cannot be written is
    a failure nobody saw (below).
  - **Written early.** When a pending change is written before its toast closes (backgrounding, another
    write, a change elsewhere, an alert), the toast stays. If the written change is still undoable (the
    table), its Undo now undoes the written change; otherwise the Undo button is removed at once and the
    change leaves the undo stack.
  - **A pending change that cannot be written** is never left on screen. Transient errors (a generic
    `EKError`, a provider exception, an aborted IndexedDB transaction, an I/O error) are retried once at
    once. If the retry fails, or the cause is final (the occurrence no longer resolves, §3.2; the calendar
    became read-only or access was revoked; the account refused the change; the time group of a moved
    event changed elsewhere; storage is full), the views return to the stored state (the moved event goes
    back, the deleted one comes back) and the toast says so, announced politely:
    - a transient cause: "Couldn't move the event." (`calendar.commitFailed.move`) or "Couldn't delete the
      event." (`calendar.commitFailed.delete`) with "Try again" (`calendar.tryAgain`) and no reason line,
      because the button already says what to do;
    - a final cause: the same sentence and the reason line of `editor.saveFailed.*` (`access`,
      `readOnly`, `account` or `storage`, never `generic`), for example "Couldn't move the event. This
      calendar can't be changed. Choose another calendar." (`calendar.commitFailed.move.final`,
      `calendar.commitFailed.delete.final`), without "Try again";
    - the occurrence no longer resolves, or the time group changed elsewhere: "This event changed in
      another app, so it wasn't moved." ("... so it wasn't deleted."; `calendar.commitFailed.changed.move`
      and `.delete`).

    "Try again" writes the change at once: there is no second hold and no new Undo window, and if it
    fails again the final-cause toast follows.
  - **Failures nobody saw.** A failure while no Thirteen window is in the foreground (a commit on
    backgrounding, a closing tab, Windows shutting down, a web journal entry replayed on the next load)
    is recorded with the per-device settings (Apple `UserDefaults`, Android DataStore, Windows
    `calendars.json` `"failedCommits"`, web `localStorage`), with the event's key and title, the change
    and its cause. Its toast is shown at the next foreground or launch and names the event and where it
    was going, because by then the user may be looking at another view and the event has quietly gone
    back:
    - one failure: "Couldn't move “{title}” to {date} at {time}." (`calendar.commitFailed.later.move`;
      all-day: `calendar.commitFailed.later.move.day`, "Couldn't move “{title}” to {date}.") or
      "Couldn't delete “{title}” on {date}." (`calendar.commitFailed.later.delete`), with `{date}` and
      `{time}` the target (the deleted occurrence's date for a delete). A final cause adds its reason
      line; an occurrence that no longer resolves adds "It changed in another app."
      (`calendar.commitFailed.later.changed`). The toast's one action is "Try again" for a transient
      cause (it writes at once, as above) and "Show event" (`calendar.showEvent`, which opens the event's
      details at its stored time) for every other cause.
    - two or more failures: one toast, "{n} changes couldn't be saved." (`calendar.commitFailed.later.many`,
      plural), with "Show" (`calendar.commitFailed.show`), which opens the list "Changes that couldn't be
      saved" (`calendar.commitFailed.list.title`; a sheet on phones, a popover on iPad and Mac, a dialog
      on Windows and web). Each row is one failure's text from the line above; a row opens that event's
      details, and rows with a transient cause have their own "Try again".

    A record is cleared when its toast closes or its list is opened. Nothing is retried in the
    background.
  - **Editor saves are written at once** (a deliberate save must survive a crash).
  - **After a change is written**, it stays undoable only where the reversal is exact (the table above):
    on Windows and web, every change (the previous version, with the same `UID`, is written back); on
    Apple, edits and moves of non-repeating events without invitees. A written delete is never undone on
    Apple: re-creating the event would give it a new identifier, which breaks references from other
    apps, and would lose what EventKit cannot write or Thirteen does not map (attachments, structured
    location, travel time, the creation date). So a delete committed early loses its Undo at once, like
    every other reversal that is not exact. On Android the toast is the only Undo, so Undo ends when the
    change is written (an editor save's toast on Android therefore has no Undo action). Every other
    written change leaves the undo stack.
  - Undo of a written change reverts only the field groups that change touched, through `mergeDraft`. If
    another app changed one of those groups since, nothing is changed and the toast says "This event
    changed in another app, so it can't be undone." (`calendar.undoUnavailable`).
  - The stack keeps the last 20 changes per window and is cleared when calendar access changes. "Future
    events" and "all events" changes are never undoable (§8.4); their toast has no Undo.
- **Toast timing.** 8 seconds, paused while the pointer is over the toast or focus is inside it, and
  longer wherever the platform says the user needs more time:
  - **Stays until the next action.** A toast with an action stays until the next action (below) or
    Escape while any assistive technology Thirteen can detect is in use: Apple
    `UIAccessibility.isVoiceOverRunning`, `isSwitchControlRunning`, `isAssistiveTouchRunning` (Mac:
    VoiceOver and Switch Control); Android `AccessibilityManager.isTouchExplorationEnabled`; Windows
    `SystemParametersInfo(SPI_GETSCREENREADER)`.
  - **iPhone and iPad with a hardware keyboard** (`GCKeyboard.coalesced`, which covers Full Keyboard
    Access, itself not detectable) and none of those running: 20 seconds, because ⌘Z keeps working after
    the toast closes for changes that stay undoable, and an iPad on a keyboard case is common.
  - **Otherwise** the time follows the system setting where one exists: Android
    `AccessibilityManager.getRecommendedTimeoutMillis(8000, FLAG_CONTENT_TEXT | FLAG_CONTENT_CONTROLS)` on
    API 29 and later (the "Time to take action" setting that Switch Access and Voice Access users rely on),
    Windows the longer of 8 seconds and `SPI_GETMESSAGEDURATION` ("Dismiss notifications after this amount
    of time"). The web cannot detect either, so there a toast with an action stays 20 seconds. Voice Control
    (Apple) cannot be detected; its "Undo that" command and every keyboard Undo keep working after the toast
    closes for changes that stay undoable (above).
  - **The next action** is the same on every platform: the next change registered for undo (another
    move, delete or save), paging or Today, a mode switch, a section switch, opening an event's details
    or the editor, or the toast's Close button. Each of these closes a toast that stays, and so commits
    its pending change, before it takes effect. Scrolling, selecting a day and opening a menu do not.
  - **Close button.** Every toast with an action, on every platform, ends with a Close button: an X icon
    with the accessible name "Close" (`toast.close`), at least 44 x 44 pt on Apple, 48 x 48 dp on Android
    (Compose `Snackbar` with `withDismissAction`) and 32 x 32 px on Windows and web, in the focus order
    after the action, so Switch Control, AssistiveTouch, Switch Access and keyboard users can clear a toast
    that stays. Close commits a pending change as the timeout does; it never undoes.
  - **Announcement.** The polite announcement adds the shortcut where one exists: "Event deleted. Undo
    available: Command Z." (Apple with a keyboard, and the web on a Mac), "...: Control Z." (Windows, and
    the web on other systems), "Event deleted. Undo available." otherwise. A toast without Undo announces
    only its message.

### 2.12 The 13-month date field

The editor's date control and the repeat end date use one component everywhere:

- **Closed state**: a button showing the date with the system's short name, `IFC Thu, Oct 12, 2026` (or
  `Year Day 2026`), and the Gregorian equivalent as the caption under the row. Accessible name: "Starts,
  IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026" ("Ends", "End repeat" likewise).
- **Open state**: popover (regular width), expanded inline under its row when the editor is itself a
  popover (iPad and Mac, §2.11), or sheet with medium detent (compact):
  - Tabs: `IFC` (the selected system's short name) and `Gregorian`. The picker opens on the tab last used
    on this device (first time: the 13-month tab), stored with the other per-device view settings.
  - 13-month tab:
    - **Year stepper**: one adjustable control named "Year" (VoiceOver and TalkBack swipe up or down; web
      `role="spinbutton"` with `aria-valuetext`; Windows `NumericUpDown` automation pattern), value
      "2026" (Positivist "238, Gregorian 2026"); `ThirteenPickerLogic` rules (SPEC §3.2).
    - **Slot strip** in picker order (`thirteenSlots`: `Jan Feb Mar Apr May Jun LD Sol Jul Aug Sep Oct Nov
      Dec YD`; `LD` only in leap years): one adjustable control on Apple and Android (swipe up or down
      moves one slot), a `radiogroup` of `radio` buttons on the web, a `ListBox` on Windows. Each slot's
      accessible name gives its full name and place: "October, month 11 of 13", "Sol, month 7 of 13",
      "Leap Day, leap years only", "Year Day, belongs to no month". The selected slot has the selected
      trait.
    - **Grid**: the month's 4 x 7 grid under the two-line weekday header of §2.4. Each cell shows the
      13-month day with the Gregorian day under it; accessible name "Thursday, October 12. Gregorian
      Monday, October 19", with the selected trait on the selected day and "Today" on today.
    - Selecting an intercalary slot selects that day directly (the grid is replaced by the day's badge and
      its Gregorian date).
    - Moving to a year without the selected leap-only day falls back to the day before it
      (`ThirteenPickerLogic.settingDisplayYear`), and the caption "2027 has no Leap Day, so the date moved
      to June 28." appears under the grid and is announced. Exception: in the editor's Starts field, while
      the draft repeats on that leap-only day (§2.11), the stepper skips to the previous or next leap year
      instead, with the announced caption `picker.leapRepeat`, "Every Leap Day happens only in leap years,
      so the year moved to 2032." (Positivist: "Every Festival of Holy Women ...").
    - **Range.** In the editor (Starts, Ends, End repeat) the earliest year is 1583 and the latest 9999
      (§3.1.1): the stepper stops there, earlier slots and days are disabled, and typed dates outside the
      range are refused with `editor.error.outOfRange`. The Converter's picker keeps years 1 to 9999.
  - Gregorian tab: the platform's date picker (graphical on Apple, `DatePicker` on Android, `Calendar`
    control on Windows, a Gregorian month grid on web), with the 13-month equivalent shown under it.
  - Footer: the other calendar's date, always visible: `Gregorian Monday, October 19, 2026` or
    `IFC Thursday, October 12, 2026`.
  - Days a time zone skips (Pacific/Apia 2011-12-30) are disabled (SPEC §1.5).
  - **Accessibility text sizes** (Apple AX1+, Android 1.5+, Windows 150%+, browser text 24 px+): the
    picker opens at the large detent on iPhone and as a full-screen sheet on Android and web compact (a
    sheet on iPad and Mac, a full-size dialog on Windows and web wide, like every popover at these sizes,
    §2.20). The tabs, the year stepper and the slot strip stay (the strip scrolls horizontally, with the
    selected slot scrolled into view); the 13-month grid becomes a vertical list of the month's 28 days,
    one row each, like Month at these sizes (§2.4): `Thursday, October 12` and under it `Gregorian Mon,
    Oct 19`, with the selected trait and a check on the selected day and "Today" on today; the two-line
    weekday header is not shown, because each row names its weekday. An intercalary slot shows its one
    row. The list opens scrolled to the selected day; keyboard Up and Down move by one day there, Page Up
    and Page Down by month. The footer and Done stay pinned at the bottom (board J4).
- **Keyboard** (desktop, iPad keyboard, web): Tab moves between the tabs, the year stepper, the slot
  strip, the grid and Done; focus enters the grid on the selected day. Left and Right move by one day in
  reading order, through intercalary days: Right from IFC June 28 in a leap year selects Leap Day (the
  badge replaces the grid), Right again selects Sol 1, Left from Sol 1 selects Leap Day. Up and Down move
  to the same column one row up or down, continuing into the previous or next month (intercalary days are
  reached with Left and Right; from an intercalary day, Up selects the day before it and Down the day
  after it). Page Up and Page Down move by 13-month month, with Shift by year; Home and End go to the
  first and last day of the month; Enter selects; Escape closes. Typing a numeric 13-month date
  (`2026-M10-12`, `2026-YD`) or an ISO date into the field (desktop) parses it with `parseThirteen` /
  `parseISODate`.
- **Time field**: the platform time picker (Apple `DatePicker(.hourAndMinute)`, inline inside the popover
  editor: wheels on iPad, the stepper field on the Mac; Android `TimePicker` dialog, Avalonia
  `TimePicker`, web `<input type="time">`), in the OS 12 or 24-hour form, minute interval 5 (1 when the
  existing value is not on a 5-minute step).
- **Midnight ends.** No platform time picker can hold 24:00, so a timed end stored as `D T24:00` (end-of-day
  form, §3.1.1) is shown and edited as date D+1 at 00:00 (`displayEnd`, §5.2): the Ends date button shows
  the next day and the time field 00:00. Any change to Ends is normalized back with `normalizeEventEnd`
  before validation and saving. An event from 23:00 to midnight therefore reads "Ends IFC Fri, Oct 13 ...
  00:00", never a blank time or a zero-length event. All-day ends keep showing their last day.

### 2.13 Repeat picker

A list (sheet on phones, popover on regular width):

```
Never
GREGORIAN CALENDAR
  Every day
  Every week on Monday                 (Gregorian weekday of the start)
  Every 2 weeks on Monday
  Every month on the 19th              (Gregorian day of the start)
  Every year on October 19
  footer: These follow the Gregorian calendar, like every other calendar app.
INTERNATIONAL FIXED CALENDAR           (the selected system's name)
  Every IFC month on the 12th
  Every IFC week on Thursday
  Every 2 IFC weeks on Thursday
  Every year on IFC October 12
  footer: Every 13-month month has 28 days, so monthly repeats never skip a month. {platform sentence}
Custom
```

- Labels come from `repeatPresets(start, system)` (§5.2) so they are identical on every platform.
- On an intercalary start day, the 13-month section has one row: "Every Year Day", "Every Leap Day",
  "Every Festival of All the Dead" or "Every Festival of Holy Women"; the Gregorian section is unchanged.
- **Next line.** The selected row shows a check and, under it, the next three occurrences after the start,
  always as Gregorian dates with weekdays (`describeNextOccurrences`, §5.2), so the user sees the real
  days a 13-month repeat lands on:
  - Gregorian rows: "Next: Mon, Oct 26; Mon, Nov 2; Mon, Nov 9".
  - 13-month rows: "Next: Gregorian Mon, Nov 16; Mon, Dec 14; Tue, Jan 12, 2027" (the year is added to
    every date whose year differs from the start's).
- **Notes** under the selected row when they apply (generated by `describeRepeatNotes`, §5.2, except the
  last three):
  - Gregorian monthly on the 29th, 30th or 31st: "Months without a 31st are skipped." On a
    `gregorian-only` (Exchange, Outlook) calendar instead: "Outlook and Exchange move this to the last day
    of shorter months." (Exchange places these occurrences on the month's last day, so Outlook and Thirteen
    would otherwise disagree silently; gate V4 confirms.)
  - Gregorian yearly on February 29: "Happens only in leap years." On a `gregorian-only` calendar
    instead: "Outlook and Exchange move this to February 28 in other years."
  - Leap-only days: "Repeats every 4 years until Leap Day 2096. 2100 has no Leap Day, so the repeat stops
    before it." (Positivist: "Repeats every 4 years until Festival of Holy Women 308. 312 has no Festival
    of Holy Women, so the repeat stops before it."). The cap is the 13-month `{date}` of §2.19, so it is
    never read as the IFC date June 17.
  - 13-month weekly and every 2 weeks: "Year Day and Leap Day belong to no week, so the repeat waits one
    extra day after each, and its Gregorian weekday moves. In 2027 it falls on Tuesdays." (When the next
    year is an IFC leap year: "In 2028 it falls on Wednesdays until Leap Day and on Thursdays after it.")
  - Gregorian weekly and every 2 weeks: "In 2027 Mondays are IFC Wednesdays." (IFC leap year: "In 2028
    Mondays are IFC Tuesdays until Leap Day and IFC Mondays after it.")
  - Android, 13-month rows stored as a list of dates (form (d): every 13-month row except yearly on a
    date that never moves, Year Day, Leap Day and Holy Women, which are plain rules), only while End
    repeat is Never (with an end, the list holds exactly the repeat's dates and nothing is added):
    - `repeat.note.androidHorizon`: "Saved as a list of dates through 2036. Thirteen adds more dates
      whenever you open it." (`{year}`: the horizon of §4.4, or the last year already written for an
      existing series.)
    - With invitees, where top-up is skipped (§3.5): `repeat.note.androidHorizon.invitees`, "Saved as a
      list of dates through {year}. Because this event has invitees, Thirteen won't add more dates."
    - On API 30 and lower once the list reaches the 2037 cap (§4.4): `repeat.note.androidHorizon.capped`,
      "Saved as a list of dates through 2037, the last year this phone can store."
  - Android, when the event's current repeat is an Apple-made `BYYEARDAY` rule and the newly selected row
    is stored as a list of dates (form (d); never for Never, Gregorian rows or the plain-rule 13-month
    rows, which keep a rule), with End repeat Never: `repeat.note.androidReencode`, "This repeat will be
    saved as a list of dates through {year}. Calendar on iPhone and Mac may not show later dates." If gate
    V3 shows that Apple devices read only the first date of such a list, it becomes
    `repeat.note.androidReencode.firstOnly`, "This repeat will be saved as a list of dates. Calendar on
    iPhone and Mac will show only the first date.", shown with any End repeat. Either replaces the horizon
    note. Keeping the current row writes nothing, and no other change re-encodes (§4.9). V3 is not run
    for now (owner, §8.2), so `firstOnly` is the variant that ships until V3 passes; and while the
    fallback of V2's Android leg is in force, Android does not edit the repeat of an Apple-made series at
    all, so neither variant is shown until then.
  - A calendar that can't keep 13-month repeats: the note in the next bullet.
- **Platform sentence** at the end of the 13-month footer, chosen by platform, target calendar and gate
  results. Until its gate passes, the sentence is left out.

  | Platform, target calendar | Sentence | Gate |
  |---|---|---|
  | Apple; iCloud, On My iPhone, On My iPad, On My Mac | "Calendar on your iPhone, iPad and Mac shows the same days." | V1 |
  | Apple; Google | "Google Calendar on the web shows the same days." | V2 |
  | Apple; Google | "Calendar apps on Android may show other days." (always: the Android provider ignores `BYYEARDAY`, §4.8) | none |
  | Apple; other CalDAV, Windows, web | none | |
  | Android; Google or this device; the selected row is stored as a list of dates (form (d)) or as a plain rule (forms (a), (c)) | "Google Calendar shows the same days." | V3 |
  | Android; any calendar; the selected row is stored as a `BYYEARDAY` rule (form (b): the current row of a series made on an Apple device, kept by §4.9 rule 3) | "Calendar apps on Android may show other days." (`repeat.footer.appleGoogleAndroid`; always, matching the details note `event.androidByYearDay`, §2.10) | none |

- **Calendars that cannot keep 13-month repeats** (Exchange, Outlook and unknown Android accounts, §3.5;
  on Apple also iCloud or Google calendars in a release made before gate V1 or V2's EventKit leg passes,
  §3.4):
  13-month rows whose encoding is not Exchange-safe (§4.3) are shown disabled, and the section footer
  says "Work (Exchange) can't keep 13-month repeats. Choose a calendar from iCloud or Google to use them."
  The calendar is written "{name} ({account kind})"; the list names only the account kinds that can keep
  them among the user's writable calendars, in the order iCloud, Google, CalDAV, On My iPhone / On My iPad
  / On My Mac / this device, joined as "A, B or C". With none: "Work (Exchange) can't keep 13-month
  repeats." Rows that encode as plain Gregorian rules (yearly on an invariant date, Year Day, Leap Day)
  stay enabled.
- **Custom** (Gregorian only, like Apple Calendar): Frequency (Daily, Weekly, Monthly, Yearly) and "Every
  {n} days / weeks / months / years" (1 to 99). Weekly: weekday toggles (Sun to Sat, Gregorian). Monthly:
  "Each" (multi-select of days 1 to 31) or "On the" (first, second, third, fourth, fifth, last) x
  (Sunday to Saturday, day, weekday, weekend day). Yearly: months (multi-select) and optional "On the".
  The live description, "Next:" line and notes update as the user edits.
- **Rules Thirteen cannot edit** (set by another app: `BYSETPOS` combinations beyond "On the", `BYWEEKNO`,
  several `BYDAY` ordinals, hourly rules, `RDATE` lists that are not a 13-month pattern, a rule with extra
  `RDATE`s, several `RRULE`s, any `EXRULE`; `editable: false`, §4.5): the Repeat row shows the
  description (or "Repeats on a custom schedule") and the picker shows a top row "Keep: {description}"
  checked. While "Keep" stays checked the stored recurrence is never rewritten (§4.9), and saves offer
  "this event only" or "all events" (§2.11). Choosing anything else replaces the rule from this
  occurrence on (span: future events only; the stored rules end before it, §4.7).

### 2.14 Alerts

Two pickers, "Alert" and "Second alert" (Apple Calendar's model), offering:

- Timed events: None, At time of event, 5 minutes before, 10 minutes before, 15 minutes before, 30
  minutes before, 1 hour before, 2 hours before, 1 day before, 2 days before, 1 week before.
- All-day events: None, On the day at 09:00, 1 day before at 09:00, 2 days before at 09:00, 1 week before
  at 09:00 (times in the OS 12 or 24-hour form). Android omits "On the day at 09:00" until verification
  V14 (§8.2) shows that Google sync keeps alerts after the start of an all-day event.
- An alert set by another app that matches no preset shows as its own row ("45 minutes before", "At
  08:00 on Thursday, October 12, 2026") and is kept unless the user changes that picker.
- New events default to None. Whether the account adds its own default is gate V6: in phase 0 (iCloud on
  macOS 27), all-day events saved through EventKit with no alerts came back with the account's default
  alert (`TRIGGER:-PT15H`, `X-APPLE-DEFAULT-ALARM:TRUE`), and timed events with none (§8.2). The support
  FAQ says so (§7.1); iOS and other accounts are still to be recorded.
- Invitations: both pickers are editable when `alarmsEditable` (§3.5, V20); everything else stays
  read-only.
- **When an alert fires** (Windows and web, which plan alerts themselves; `alarmFireTime`, §5.2): a
  relative alert on a timed event fires at the occurrence's start instant plus the offset, exactly. An
  all-day alert fires at its wall-clock time in the device's zone on its day ("On the day at 09:00" is 09:00
  on that date even on a daylight saving day), and an absolute alert at its device wall-clock time. The
  occurrence's start instant is the `startUtc` that `expandSeries` and `eventsFromCalendar` return with
  every timed occurrence (§5.2, §5.4); planners pass it to `alarmFireTime` and never rebuild it from the
  device wall clock, which names two instants in a fall-back hour. The `alarmInstants` fixtures cover
  spring-forward and fall-back days.

**Web.**

- Supported when `'Notification' in window` and `'serviceWorker' in navigator`, and the page is not a
  Safari tab on iPhone or iPad (iOS and iPadOS expose notifications only to web apps added to the Home
  Screen: `navigator.standalone === true` or `display-mode: standalone`). Where unsupported, the alert
  pickers and the Settings switch are hidden and Settings > Calendar shows "This browser can't show alerts
  from web pages." Existing alerts on imported events are kept in the data.
- Thirteen shows alerts with `(await navigator.serviceWorker.ready).showNotification(title, {body, tag,
  data: {route}})` and never calls `new Notification()` (it throws on Chrome for Android). The service
  worker `alerts-sw.js` (§6.5) only handles `notificationclick`: it focuses an open Thirteen tab and routes
  it to `#/day/{date}`, or opens one. It has no `fetch` handler, so it is not the deferred offline mode
  (§8.4).
- Timers run only while a Thirteen tab is open. Phone and tablet browsers pause background tabs, so on
  those devices the Settings footer says "On phones and tablets, alerts appear only while Thirteen is on
  screen."
- **One tab plans alerts.** With several Thirteen tabs open, only the tab holding the Web Lock
  `thirteen-alerts` (`navigator.locks.request('thirteen-alerts', ...)`, held until the tab closes) plans
  timers; when it closes, the next waiting tab takes over and re-plans. Each notification's `tag` is
  `{occurrence key}|{alarm index}`, so even a double planning replaces rather than repeats an alert.
- The browser asks for permission the first time an alert is set (a user gesture). If it is denied, the
  editor shows "Your browser blocks notifications from Thirteen, so this alert won't appear." under the
  picker.
- Alert planning runs after a save has committed, inside its own try/catch: a failure logs an error code
  and never fails or undoes the save.

**Android, Thirteen's own calendar.** Alerts for events in the "Thirteen" device calendar (§2.15) appear
only if the device's calendar app shows that calendar. Gate V18 checks Google Calendar (Pixel) and Samsung
Calendar. If V18 fails, the fallback of §6.3 ships: Thirteen shows those alerts itself (Settings switch
"Show alerts for the Thirteen calendar", §2.18). That needs the notification permission on Android 13 and
later, asked when the first alert is set in that calendar; if it is denied the editor shows
"Notifications for Thirteen are off, so this alert won't appear." with "Open settings".

### 2.15 Calendars list and calendar picker

**Calendars list** (sidebar on regular width, sheet titled "Calendars" on compact). Android expanded
width has no sidebar: there the list is an on-demand supporting pane on the trailing side of the
Calendar grid (owner decision; §2.1, §6.3), not shown until the user opens it from the overflow menu's
"Calendars" or with "Show calendars" (§2.4), and closed by its Close button (`editor.close`) or Back. Its
content is the same list as below.

- Grouped by account in the platform's order: iCloud, Google accounts, Exchange, other CalDAV, "On My
  iPhone" / "On this device", Subscribed, Other (Birthdays, Holidays). Windows: "On this computer",
  "Subscriptions". Web: "In this browser", "Subscriptions".
- Each account group can be collapsed (chevron on its header; state stored per device with the visibility
  settings). A collapsed header reads "{n} calendars, {m} shown".
- Row: color swatch (button that changes color on Windows and web only), name, "Read only" tag when not
  writable, visibility toggle (checkbox on desktop, switch on phones). Info button on Windows and web
  opens the calendar's settings (name, color, for subscriptions: link, update interval, "Update now",
  "Unsubscribe"; for local calendars: "Export", "Delete calendar").
- Group header actions: "Show all", "Hide all".
- Visibility is Thirteen's own (stored per device, §6). Hiding a calendar never changes Calendar.app or
  Android's visibility. Hidden calendars are not fetched.
- Footers:
  - iOS: "Hiding a calendar here hides it only in Thirteen. Add accounts and subscriptions in Settings >
    Apps > Calendar."
  - Mac: "Hiding a calendar here hides it only in Thirteen. Add accounts in System Settings > Internet
    Accounts, and subscriptions in the Calendar app."
  - Android: "Hiding a calendar here hides it only in Thirteen." + "Missing your Google calendars? In the
    Google Calendar app, open Settings > General and turn on Share Google Calendar data with other apps."
  - Windows / web: buttons "New calendar", "Subscribe to calendar", "Import .ics file", "Export", and the
    storage and status lines of §2.16.
- Android, when no calendar is writable: a row "Create a calendar on this device" that asks "Events in
  this calendar stay on this phone. They aren't synced or backed up. Some calendar apps don't show this
  calendar or its alerts." ("Create calendar", "Cancel"; if the V18 fallback ships, the last sentence is
  "Thirteen shows their alerts."), then creates "Thirteen" (§6.3).

**Calendar picker** (editor): writable calendars only, grouped by account, with dot and name; the current
one checked. On compact width it is a pushed list; on regular width a menu. For an existing event with
invitees (Apple, Android), calendars of other accounts are shown disabled under the footer "Events with
invitees stay in their own account." (`editor.calendar.sameAccount`): a move between accounts is a copy
and a delete, which would send every invitee a cancellation and a new invitation (§4.7).

**Default calendar** (Settings, §2.18): the platform default (EventKit `defaultCalendarForNewEvents`,
Android primary writable calendar, Windows and web "Personal") unless the user chose one. If the chosen
calendar disappears, fall back silently to the platform default (Windows and web: the first local calendar
in the list; with none, "Personal" is created again on the next "+", §2.16).

### 2.16 Access and status states

These cards appear in Month (above the day list on compact, top banner on regular), Week, Day, List and
Today's Up next. Never as a modal and never at launch. Every other feature works without access.

**Show my events** (Apple, Android; Settings > Calendar, default on). When off, Calendar is the 13-month
calendar only: no events, no access cards, no "+" or "New event", no event dots, no Up next card, no
Events section in the day sheet, and Thirteen never asks for calendar access. Turning it on again restores
everything; with access still undecided, the not-asked card appears.

**Apple** (status from `EKEventStore.authorizationStatus(for: .event)`):

| Status | Card | Button | "+" |
|---|---|---|---|
| `notDetermined` | "See your events in 13 months" / "Thirteen can show the events from the calendars on this {iPhone, iPad, Mac}, including iCloud, Google and Exchange, and add the events you create. Your events stay on your device and in your own accounts." | "Continue" (only button, App Review 5.1.1(iv)); calls `requestFullAccessToEvents()` | the system prompt appears directly |
| `denied` | "Calendar access is off" / iOS: "To see and edit your events in Thirteen, open Settings and set Calendars to Full Access." Mac: "To see and edit your events in Thirteen, open System Settings > Privacy & Security > Calendars and allow full access for Thirteen." | "Open Settings" (iOS, `UIApplication.openSettingsURLString`) / "Open System Settings" (Mac, §6.2) | an alert with the card's text, "Open Settings" and "Cancel" |
| `writeOnly` | "Thirteen can only add events" / iOS: "To see your events here too, set Calendars to Full Access for Thirteen in Settings." Mac: "To see your events here too, open System Settings > Privacy & Security > Calendars and allow full access for Thirteen." | "Open Settings" (iOS) / "Open System Settings" (Mac, the same link as `denied`, §6.2) | opens the editor in write-only mode (§2.11) |
| `restricted` | "Calendar access is restricted" / "A Screen Time or device management setting doesn't allow Thirteen to use your calendars. Everything else in Thirteen still works." | none | an alert with the card's text and "OK" |
| `fullAccess`, no calendars | "No calendars yet" / iOS: "Add an iCloud, Google or other account in Settings > Apps > Calendar, or create a calendar in the Calendar app." Mac: "Add an account in System Settings > Internet Accounts, or create a calendar in the Calendar app." | none | an alert with the card's text and "OK" |
| `fullAccess`, no writable calendar | no card | | stays enabled; an alert "None of your calendars can be changed. Create a calendar in the Calendar app." with "OK" |

**Android** (runtime permissions `READ_CALENDAR` + `WRITE_CALENDAR`, requested together):

| State | Card | Buttons |
|---|---|---|
| never asked | "See your events in 13 months" / "Thirteen can show the events from the calendars on this phone, including Google and Exchange, and add the events you create. Your events stay on your phone and in your own accounts." | "Show my calendars" (requests both), "Not now" (hides the card for 30 days, `calendarCardDismissedAt`; "+" still asks) |
| denied once (`shouldShowRequestPermissionRationale` true) | "Thirteen needs calendar access to show your events" / "Without it, Thirteen shows the calendar without your events." | "Allow access", "Not now" (30 days) |
| denied permanently (§6.3 detection), before any events action | the one-line link "See your events here" (it expands into the next row's card) | |
| denied permanently, after an events action ("+", the link, the Settings row) | "Calendar access is off" / "To see and edit your events in Thirteen, open Settings > Permissions > Calendar and choose Allow." | "Open settings" (`ACTION_APPLICATION_DETAILS_SETTINGS`) |
| read granted, write denied | banner "Thirteen can show your events but not change them." | "Allow changes" (requests `WRITE_CALENDAR`, or opens settings when blocked); editing controls hidden |
| granted, no calendars | "No calendars yet" / "Add a Google or other account in your phone's Settings under Accounts." + Google sharing hint (§2.15) | none |
| granted, nothing writable | "None of your calendars can be changed from this phone." | "Create a calendar on this device" |

While permission is missing, "+" offers "Add in your calendar app", which starts `Intent.ACTION_INSERT` on
`Events.CONTENT_URI` with the draft's title, times and all-day flag (no permission needed) inside
try/catch; on `ActivityNotFoundException` the toast "No calendar app can add this event." appears.

**Card persistence on Today** (Apple, Android). The not-asked and denied-once cards on Today collapse to
the one-line link "See your events here" (which expands them) after Thirteen has been opened 3 times with
the card shown and no decision. In Calendar they stay cards. "Show my events" off removes them.

**Windows and web: storage and status.** No permission states.

- First use creates the local calendar "Personal" (color: theme accent). If the user deletes every local
  calendar, the next "+" or import into a new calendar creates "Personal" again.
- Calendars list footer: "Your events are saved in this browser on this device. Export them to keep a copy
  or to move them." (web) or "Your events are saved on this computer." with "Open folder" (Windows).
- **Web storage persistence.** After the first save Thirteen checks `navigator.storage.persisted()`,
  which never prompts. If it is false, the Calendars list shows one card:
  - Safari (WebKit) in a browser tab, not added to the Dock or Home Screen: "Safari deletes this site's
    data if you don't open Thirteen for about a week. Add Thirteen to your Dock or Home Screen, or export
    your calendars." with "How to add it" (`support.html#install`) and "Export all".
  - Other browsers: "Your browser may clear Thirteen's data when your device runs low on space." with
    "Keep my data" (calls `navigator.storage.persist()` from the click; Firefox then shows its own
    permission prompt) and "Export all". If `persist()` returns true the card goes away; if false the
    button is replaced by the line "Export your calendars now and then to keep a copy."
- **Export reminder** (web): when local calendars hold events and nothing has been exported for 30 days
  (or, if never, 30 days after the first event), the Calendars list shows "You haven't exported your
  calendars in 30 days." with "Export all" and "Not now" (asks again in 30 days).
- **Storage unavailable** (web): if IndexedDB cannot be opened (a privacy setting, some private windows, a
  zero quota), events work in memory for this tab and Calendar shows the banner "This browser doesn't let
  Thirteen save events here, so events you add disappear when you close this tab. Private windows and
  some privacy settings block saving." New events, import, subscribe and export still work.
- **Unreadable data.** Windows: if `{id}.ics` cannot be read or parsed but `{id}.ics.bak` can, Thirteen
  loads the backup, renames the broken file to `{id}.ics.broken-{yyyyMMddHHmmss}` and shows on that
  calendar's row "Thirteen couldn't read the latest changes to {name}, so it restored the last saved
  copy." with "Open folder". If neither file can be read, the calendar stays in the list, read-only, with
  "Thirteen couldn't read {name}. Its file is still in the Calendars folder." and "Open folder"; Thirteen
  never writes to it, and "Delete calendar" removes it from the list and moves its files into
  `Calendars\Unreadable\`. Web: a stored document that fails to parse shows "Thirteen couldn't read
  {name}." with "Download it" (its raw text) and "Delete calendar".
- **Subscription states** (Windows, web), on each subscription row: "Updated 10 min ago", "Updating" (with
  a spinner), or "Couldn't update. {reason}" in `accent-text` with an error icon and "Try again". Stale
  data stays visible. When a feed has not updated for twice its interval, the row reads "Updated 3 days
  ago" with a warning icon, whatever the reason (manual feeds never warn), and while any visible
  subscription is stale the Calendar toolbar shows "Subscriptions not updated" (§2.1).
- **Suspicious feed results** (Windows, web). A response that parses but looks like a server glitch is not
  stored: zero events where the stored copy has more than 10, or a parse that skipped more than 10% of its
  components. The row shows "The feed returned no events. Showing the last copy." (`calendars.feedEmpty`)
  or "Part of the feed couldn't be read. Showing the last copy." (`calendars.feedPartial`) with the
  warning icon and "Try again". If the next refresh is suspicious in the same way with the same **parse
  outcome** (the same number of events and the same number of skipped components), it is accepted: the
  feed really changed. The outcome is compared, not the body's hash, because feeds such as Google's write
  every `DTSTAMP` as the time of the request, so two copies of an unchanged feed never hash alike. The
  previous copy is always kept (`{id}.ics.bak` on Windows, `previousIcs` on the web, §3.6).
- **Changed outside Thirteen** (Windows). When a calendar file in the folder changes and Thirteen did not
  write it (the user edited it after "Open folder", or a sync tool replaced it), Thirteen reloads that
  calendar and shows on its row "{name} changed outside Thirteen, so Thirteen reloaded it."
  (`store.reloaded`). A change being saved at that moment is applied to the reloaded file (§3.6).
- **Offline** (Windows: `NetworkInterface.GetIsNetworkAvailable()` and
  `NetworkChange.NetworkAvailabilityChanged`; web: `navigator.onLine` and the `online` / `offline`
  events): refreshes pause, network failures add no per-row errors, and the Calendars list shows one
  banner, "You're offline. Subscriptions update when you're back online." Refresh resumes 5 seconds after
  the connection returns.

### 2.17 Windows and web: import, export, subscribe

**Import .ics** (Calendars list button, File menu on Windows, `Ctrl+O` on Windows, drag a file onto the
window, Windows file association "Open with Thirteen"):

1. File picker (`.ics`, `.ical`, `.ifb`, `text/calendar`, and `.zip` files written by Thirteen's export;
   several files may be chosen or dropped at once). Parsing runs off the UI thread (Web Worker, Windows
   thread pool).
2. Dialog "Import events": "{n} events in {file name}", picker "Add to" with the local calendars and
   "New calendar: {X-WR-CALNAME or file name}" (default when the file has a calendar name), "Import".
   When every chosen file is a Thirteen export (it carries `X-THIRTEEN-CALENDAR-ID`), the dialog is
   "Restore calendars" instead: "{n} calendars in {file name}", the calendars as a checked list (name,
   "local" or "subscription", event count; any can be unchecked), and "Restore" (below; board I2).
3. Merging works on **UID groups**: a master `VEVENT` and its `RECURRENCE-ID` overrides share one `UID`
   and always move together.
   - A group whose `UID` is new to the target calendar is added.
   - A group whose `UID` exists is compared by **version**: the newest `LAST-MODIFIED` in the group, or
     its newest `DTSTAMP` where `LAST-MODIFIED` is missing (a group with neither is older than any other).
     `SEQUENCE` never counts, so Thirteen's own increments never block a newer export from Google.
     - A stored group with an import baseline (`X-THIRTEEN-IMPORTED-LAST-MODIFIED`, recorded when it was
       imported, §3.6; for a stored group without a master, the latest of its overrides' baselines) is
       replaced when the incoming version is later than that baseline, even if it was edited in Thirteen
       since: the other app's newer copy wins.
     - A stored group without a baseline (made in Thirteen, or restored from Thirteen's own export) is
       replaced only when the incoming version is later than its own version; a newer stored group
       stays.
     - Otherwise the group counts as unchanged. A replacing group records the new baseline (§3.6).
   - An incoming group with overrides but no master (for example a single invited instance of someone
     else's repeating meeting in a Google export):
     - with no stored group of that `UID`, it is stored as read (raw text, with the baseline of §3.6 in
       each override) and counted as added. Its overrides are shown as single events through
       `expandSeries`' orphan path (§4.6), as Apple Calendar shows them and as a subscription shows the
       same component. They are edited like single events except that Repeat is shown as "Never",
       disabled, with the caption `editor.repeat.instanceOnly`, "This is one event of a series from
       another calendar, so it can't repeat here."; a save keeps the `UID` and `RECURRENCE-ID`, and a
       delete removes that component (and the group once it is empty).
     - with a stored group of that `UID`, each incoming override is compared with the stored override
       that has the same `RECURRENCE-ID`, the same way whole groups are compared: no stored override, it
       is added; a stored override with an import baseline (in its own raw text) is replaced when the
       incoming override's version (its own `LAST-MODIFIED`, else `DTSTAMP`) is later than that
       baseline; one without a baseline is replaced only when the incoming version is later than its own
       version. A replaced or added override records its own baseline. The group counts as updated when
       any override was added or replaced, else as unchanged; the stored master is never touched. So an
       older file's override never replaces an override edited in Thirteen or imported later.
   - Several masters with one `UID` in one file: the newest (by the same rule) is used, the others count
     as skipped.
   - A `VEVENT` without `UID` gets `missing-` followed by the first 32 hex digits of the SHA-256 of the
     target calendar's id, the `DTSTART` line and the `SUMMARY` value, so importing the same file again
     updates instead of duplicating (§3.2).
4. Result toast: "Added {a}, updated {u}, unchanged {s}." (counted in UID groups, override-only groups
   included). Errors: "This file isn't a calendar (.ics)
   file.", "This file has no events.", "{n} events couldn't be read and were skipped.", "{n} repeated
   events in the file were skipped." (`import.duplicates`).

**Export** (button, per-calendar menu, File menu, "Export all" in Settings and in the export reminder):
dialog "Export" with calendar checkboxes. One calendar gives one file, `{Calendar name}.ics`. Several
calendars give one file per calendar, never one merged file (a merged file would come back as one
calendar and lose names, colors and subscriptions): on the web one download, `Thirteen calendars
{yyyy-MM-dd}.zip`, an uncompressed zip written by `files.ts` without a library; on Windows a folder picker
("Choose a folder", `export.chooseFolder`) that receives the files. File names are made unique with " (2)".
Each file is the calendar's own `VCALENDAR` with `X-WR-CALNAME`, its color and `X-THIRTEEN-CALENDAR-ID`;
its `UID`s are unique within it (one group per `UID`, above). A subscription is exported as its last
fetched copy plus `X-THIRTEEN-SUBSCRIPTION-URL` and `X-THIRTEEN-SUBSCRIPTION-INTERVAL`; when a
subscription is among the chosen calendars, the dialog shows "Exported subscriptions include their links.
Treat secret links like passwords." (`export.secretLinks`). A successful export records the time for the
export reminder (§2.16).

**Restore** (Import of Thirteen export files): each file goes back into the local calendar with its
`X-THIRTEEN-CALENDAR-ID` if that exists, else into a new calendar that keeps that id (so restoring the
same file twice gives one calendar, not two; a new id is made only if the id belongs to a calendar of the
other kind), with the file's name and color. A subscription file becomes the subscription again, with the
file's events as its first copy and a refresh on its schedule; a subscription that still exists is left as
it is (feeds are never rewritten, §4.9). For local calendars, restore merges UID groups by version
against version, ignoring baselines: a group only in the backup is added (this brings back deleted
events), a group only in the calendar stays (restore never deletes), and a group in both is replaced only
when the backup's version is later. An older backup therefore never overwrites an event edited since,
even with every calendar checked; such groups are counted as kept. Restore adds no import baselines: the
groups keep the lines they were exported with. The toast says "Restored {n} calendars."
(`import.restore.result`), followed by "{k} events changed after this backup, so their newer versions
were kept." (`import.restore.keptNewer`) when k > 0.
The web e2e suite exports two local calendars and a subscription, restores them into a fresh browser
profile and compares names, colors, kinds, events and links (§6.5).

**Subscribe** (dialog "Subscribe to a calendar"):

1. Field "Calendar link", placeholder "webcal:// or https:// link". Help text: "Use a public or secret
   iCal link. In Google Calendar it's in the calendar's settings under Integrate calendar, Secret address
   in iCal format. In iCloud, share the calendar as a public calendar and copy its link."
2. "Subscribe" fetches the link ("Checking the link" with a spinner; request rules in §6.4 and §6.5).
   `webcal://` and `webcals://` become `https://`; Windows retries `http://` if `https://` fails and the
   user typed `webcal://`.
3. Success: "{name}: {n} events", fields Name (default `X-WR-CALNAME`, else the host name), Color (next
   free palette color), "Update" (Every hour, Every 6 hours, Every day, Every week, Manually; default
   from the feed's `REFRESH-INTERVAL` or `X-PUBLISHED-TTL` rounded to the nearest option, else Every 6
   hours), "Subscribe".
4. Errors (inline under the field, with an error icon): "Enter a link that starts with webcal://, https://
   or http://."; web only, `http://`: "This page can't open unencrypted links. Use the https:// version of
   the link."; network: "Couldn't reach the server. Check the link and your connection."; web, known host
   without CORS (`calendar.google.com`, `*.icloud.com`, `outlook.office365.com`, `outlook.live.com`):
   "This calendar's server doesn't let web pages read it. Download the .ics file and import it, or
   subscribe in Thirteen for Windows.", and the dialog's buttons become "Cancel", "Import .ics file"
   (opens the Import flow) and "Subscribe" (board D2); web, any other fetch failure: "Couldn't read this link. The server
   may be offline, or it may not let web pages read it."; 401 or 403: "The server refused access. The link
   may be private or expired."; 404 or 410: "Nothing was found at this link."; not iCalendar: "This link
   doesn't lead to a calendar."; over 25 MB: "This calendar is too large (over 25 MB)." Windows, `http://`
   success: warning "This link isn't encrypted. Others on your network could see this calendar."
5. Unsubscribe asks "Unsubscribe from {name}? Its events disappear from Thirteen." ("Unsubscribe",
   "Cancel").
6. Opened from a link (`#/subscribe?url=` on the web, `thirteen://subscribe?url=` or `webcal://` on
   Windows): the field is prefilled and nothing is fetched until the user presses Subscribe. On the web
   the dialog removes `url` from the address with `history.replaceState` as soon as it has read it, so a
   secret link does not stay in the browser history (which browsers sync to their accounts).

Subscribed events are read-only, never alert, and keep the feed's colors only if the user sets none.

### 2.18 Settings additions

New group "Calendar" in Settings on every platform. The web has no Settings screen today: it gets a
Settings page (`#/settings`, a gear button in the Shell header) that holds this group; the theme and
system controls stay where they are.

| Row | Platforms | Behaviour |
|---|---|---|
| Show my events | Apple, Android | switch, default on; footer "Shows the events from your calendars in Thirteen. When off, Thirteen never asks for calendar access." (§2.16) |
| Calendar access | Apple, Android | value "Full access", "Off", "Add only" (Apple write-only), "Read only" (Android: read granted, write denied), "Restricted" (Apple) or "Not set up"; tapping goes to the card's action; hidden while Show my events is off |
| Default calendar | all | picker of writable calendars; footer "New events go to {name}." On Apple and Android hidden while Show my events is off (its picker would need calendar access) |
| Show events in Year view | all | switch, default on; on Apple and Android hidden while Show my events is off |
| Alerts | web | switch "Show alerts" + footer "Alerts appear only while Thirteen is open in a browser tab." (phones and tablets: "On phones and tablets, alerts appear only while Thirteen is on screen."); where unsupported (§2.14), the line "This browser can't show alerts from web pages." instead of the switch |
| Alerts | Windows | footer only: "Thirteen schedules alerts for the next 60 days each time it runs." |
| Alerts for the Thirteen calendar | Android, only if the V18 fallback ships and the device calendar exists | switch "Show alerts for the Thirteen calendar", default on; footer "Turn this off if your calendar app already shows these alerts." |
| Single-key shortcuts | web | switch, default on, footer "Press C for a new event, T for today, and D, W, M, Y or L to switch views." (WCAG 2.1.4) |
| Your data | Windows, web | Windows: "Open folder", "Export all" (a folder of files, §2.17); web: "Export all" (one zip, §2.17), "Delete all events" (confirm "Delete every event and calendar saved in this browser? This can't be undone.") |

### 2.19 Copy catalogue

All new user-visible strings. Placeholders in braces. Apple applies title case to buttons, menu items and
navigation titles per the HIG ("New Event", "Save for Future Events"); Android, Windows and web use the
sentence case shown here. Apostrophes ship as typographic ’ where the platform's existing strings do.

**Plurals.** Every string marked `(plural)` takes a count and is declared with plural forms: String
Catalog plural variations (Apple), `<plurals>` (Android), plural-aware entries in the Windows string table
(`one` / `other` chosen with the same CLDR rule), `Intl.PluralRules` (web). English needs two forms; they
are written here as `other | one`.

**Formatting rules.**

- `{date}` is one preformatted value from core, never assembled from parts:
  `formatThirteen(t, {style: 'long', includeWeekday: true})` gives "Thursday, October 12, 2026" for a
  month day and "Year Day 2026" for an intercalary day. Templates never use `{Weekday}, {Month} {d}`
  around a 13-month date, so intercalary days read correctly. `{gregorianDate}` is
  `formatGregorian(g, {style: 'long', includeWeekday: true})`.
- `{time}` is the platform's short time in the OS 12 or 24-hour setting ("09:30", "9:30 AM"). Time
  columns are sized for "12:30 PM" at the current text size. Month chips use core's compact form
  `formatChipTime` ("09:30"; 12-hour "9:30a", "2p").
- A range is always `event.timeRange` "{start} to {end}" with each end formatted on its own. Never use
  interval formatters (`DateIntervalFormatter`, `Date.FormatStyle` intervals, `DateUtils.formatDateRange`,
  `Intl.DateTimeFormat.prototype.formatRange`): they insert en dashes.
- Any other text a platform formatter produces (relative times, list joins) passes through the existing
  dash filters: Apple `Phrasing.withoutDashes`, Android `Phrasing.withoutDashes`, Windows
  `Phrasing.WithoutDashes`; the web adds the same `withoutDashes` to `packages/ui/src/lib/labels.ts`.
- Text the user or another app supplied (titles, locations, notes, calendar names, feed content) is never
  changed, dashes included.
- Checks, run on every events screen with the mockup data set (§6.7): Android `assertNoDashes()`; Apple UI
  tests dump the visible static text and assert; the web e2e suite scans `document.body.innerText` minus
  elements marked `data-user-text`; Windows headless tests walk the visual tree's text. User-supplied text
  is excluded from all four.

```
nav.calendar                     Calendar
calendar.mode.day|week|month|year|list   Day | Week | Month | Year | List
calendar.today                   Today
calendar.calendars               Calendars
calendar.newEvent                New event
calendar.previous.month|week|day Previous month | Previous week | Previous day      (accessibility actions, §2.1)
calendar.next.month|week|day     Next month | Next week | Next day
calendar.announce.page           {title}. {subtitle}.
calendar.title.week              {Month} {displayYear}, week {n}
calendar.subtitle.range          Gregorian {start} to {end}
calendar.subtitle.day            Gregorian {gregorianDate}
calendar.weekday.a11y            {weekday}. Gregorian {gregorianWeekday}
calendar.more                    +{n} more
calendar.more.a11y               {n} more events on {date} | 1 more event on {date}            (plural)
calendar.moreAt.a11y             {n} more events at {time} | 1 more event at {time}            (plural; "+N" block in Week and Day)
calendar.list.title              Upcoming
calendar.list.empty              No upcoming events.
calendar.day.empty               No events.
calendar.emptyRun                No events, {start} to {end}                 (accessibility-size Month, §2.4; "No events, October 21 to October 23")
calendar.placeholder             New event                                   (Android and web compact Day placeholder block, §2.6)
calendar.placeholder.a11y        New event, {time range}
calendar.allHidden               All calendars are hidden.
calendar.allHidden.button        Show calendars
calendar.loadFailed              Couldn't load events.
calendar.tryAgain                Try again
calendar.dayOfDays               Day {n} of {total}
calendar.until                   until {time}
calendar.moved.day               Event moved to {date}.
calendar.moved.time              Event moved to {time}.
calendar.moved.dayTime           Event moved to {date} at {time}.
calendar.deleted                 Event deleted.
calendar.saved                   Event saved.
calendar.addedWriteOnly          Event added to your default calendar.
calendar.undo                    Undo
calendar.undoUnavailable         This event changed in another app, so it can't be undone.
calendar.commitFailed.move       Couldn't move the event.                           (transient cause; with calendar.tryAgain, no reason line, §2.11)
calendar.commitFailed.delete     Couldn't delete the event.
calendar.commitFailed.move.final    Couldn't move the event. {reason}               ({reason}: editor.saveFailed.access | .readOnly | .account | .storage, never .generic)
calendar.commitFailed.delete.final  Couldn't delete the event. {reason}
calendar.commitFailed.changed.move    This event changed in another app, so it wasn't moved.
calendar.commitFailed.changed.delete  This event changed in another app, so it wasn't deleted.
calendar.commitFailed.later.move      Couldn't move “{title}” to {date} at {time}.     (a failure nobody saw, shown at the next foreground or launch, §2.11)
calendar.commitFailed.later.move.day  Couldn't move “{title}” to {date}.               (all-day)
calendar.commitFailed.later.delete    Couldn't delete “{title}” on {date}.
calendar.commitFailed.later.changed   It changed in another app.                       (appended when the occurrence no longer resolves; a final cause appends its reason instead)
calendar.commitFailed.later.many      {n} changes couldn't be saved. | 1 change couldn't be saved.   (plural; two or more failures nobody saw)
calendar.commitFailed.show       Show                                                (opens calendar.commitFailed.list.title)
calendar.commitFailed.list.title Changes that couldn't be saved
calendar.showEvent               Show event
toast.close                      Close                                               (every toast with an action; accessible name of its X button, §2.11)
calendar.invitees.apple          Invitees will be told.                              (appended to a pending move or delete toast)
calendar.invitees.android        Your calendar account may tell invitees.
calendar.announce.undo           {message} Undo available: {shortcut}.        (shortcut: Command Z on Apple and on the web on a Mac | Control Z on Windows and on the web elsewhere)
calendar.announce.undoNoKey      {message} Undo available.
calendar.subscriptionsStale      Subscriptions not updated                           (Windows, web toolbar status button, §2.1)
calendar.menu.openDay            Open day
calendar.menu.dayDetails         Day details
calendar.menu.duplicate          Duplicate
calendar.menu.delete             Delete

(accessible names, §2.20; the parts are joined exactly as written, flags in the order listed)
calendar.cell.a11y               {date}. Gregorian {gregorianDate}.                    (Month day cell, both densities)
calendar.cell.events.a11y        {n} events. | 1 event.                                 (plural; appended with a space to calendar.cell.a11y and calendar.band.a11y when n > 0)
calendar.gregorianMonthBegins.a11y  Gregorian {Month} begins.                           (appended with a space to the cell where a Gregorian month starts)
calendar.band.a11y               {name}, no weekday. Gregorian {gregorianDate}.         (Month intercalary band)
calendar.column.a11y             {shortDate}. Gregorian {gregorianShortDate}            (Week column container; long forms without the year, as picker.cell)
calendar.column.intercalary.a11y {name}, no weekday. Gregorian {gregorianShortDate}     ("Year Day 2026, no weekday. Gregorian Thursday, December 31")
calendar.item.a11y               {title}, {time range}, {calendar}                      (Month chip, day list row, Week and Day block; {time range}: event.timeRange, or event.allDay)
calendar.bar.a11y                {title}, all day, from Gregorian {startDate} to {endDate}, {calendar}   (all-day or multi-day bar, every platform)
calendar.bar.oneDay.a11y         {title}, all day, {calendar}
calendar.row.a11y                {time}, {title}, {calendar}, {location}                (Up next and List rows; {time}: a time, event.allDay or calendar.dayOfDays; ", {location}" omitted when empty)
calendar.flag.repeats            , repeats
calendar.flag.tentative          , tentative
calendar.flag.canceled           , canceled
calendar.flag.invitation         , invitation
calendar.flag.readOnly           , read only
calendar.flag.dayOf              , day {n} of {total}
calendar.flag.continuesFrom      , continues from Gregorian {date}                      ({date}: the bar's date form, §2.20)
calendar.flag.continuesTo        , continues to Gregorian {date}
year.cell.events                 {n} events | 1 event                                   (plural; Year day cell value, §2.3)

today.upNext                     Up next
today.now                        Now
today.tomorrow                   Tomorrow
today.showAll                    Show all in Calendar
today.moreNext7                  {n} more in the next 7 days | 1 more in the next 7 days       (plural)
today.emptyToday                 Nothing else today.
today.emptyWeek                  No events in the next 7 days.
today.seeEvents                  See your events here
menubar.next                     Next: {time} {title}
menubar.next.a11y                Next event: {title} at {time}

event.allDay                     All day
event.timeRange                  {start} to {end}
event.starts                     Starts
event.ends                       Ends
event.zoneLine                   In {city}: {start} to {end}
event.repeat                     Repeat
event.calendar                   Calendar
event.alerts                     Alerts
event.showAs                     Show as
event.location                   Location
event.url                        URL
event.notes                      Notes
event.organizer                  Organizer
event.invitees                   Invitees
event.invitees.count             {n} invitees | 1 invitee                                       (plural)
event.tentative                  Tentative
event.canceled                   Canceled
event.edit                       Edit
event.delete                     Delete event
event.editAlerts                 Edit alerts
event.openInCalendar             Open in Calendar
event.openInCalendar.android     Open in calendar app
event.readOnly.subscribed        This event is in a subscribed calendar, so it can't be changed here.
event.readOnly.birthday          Birthdays come from your contacts. Change them in Contacts.
event.readOnly.invitation        You're invited to this event. Reply to it or change it in the Calendar app.
event.readOnly.invitation.android  You're invited to this event. Reply to it or change it in your calendar app.
event.readOnly.calendar          You can view this calendar but not change it.
event.readOnly.noWrite           Thirteen can show your events but not change them.
event.readOnly.historical        Thirteen can't change events before 1583.
event.readOnly.historical.local  Thirteen can't change events that start before 1583, except to delete them or change their alerts.   (Windows, web)
event.androidByYearDay           Other Android calendar apps may show this repeat on the wrong days, and alerts on this phone may come on the wrong days. Thirteen shows the right days.
event.readOnly.byYearDay.android  To keep this repeat right on your other devices, Thirteen changes only its alerts here.   (Android, fallback of V2's Android leg, §8.2)

editor.title.new                 New event
editor.title.edit                Edit event
editor.title.alerts              Edit alerts
editor.add                       Add
editor.save                      Save
editor.cancel                    Cancel
editor.close                     Close                                       (Android navigation icon, accessible name; also closes the Calendars supporting pane, §2.1)
editor.titlePlaceholder          Title
editor.defaultTitle              New event
editor.locationPlaceholder       Location
editor.allDay                    All-day
editor.starts                    Starts
editor.ends                      Ends
editor.dateButton                {IFC} {Wkd}, {Mon} {d}, {displayYear}     (intercalary: Year Day 2026)
editor.dateButton.a11y           {field}, {IFC} {date}. Gregorian {gregorianDate}
editor.gregorianCaption          Gregorian {gregorianDate}
editor.thirteenCaption           {IFC} {date}
editor.zoneNote                  Times are in {city} time.
editor.repeat                    Repeat
editor.endRepeat                 End repeat
editor.endRepeat.never           Never
editor.endRepeat.onDate          On date
editor.endRepeat.after           After
editor.endRepeat.times           {n} times | 1 time                                            (plural)
editor.repeat.instanceOnly       This is one event of a series from another calendar, so it can't repeat here.   (Windows, web: an imported override without its master, §2.17)
editor.calendar                  Calendar
editor.alert                     Alert
editor.secondAlert               Second alert
editor.showAs                    Show as
editor.busy                      Busy
editor.free                      Free
editor.urlPlaceholder            URL
editor.notes                     Notes
editor.delete                    Delete event
editor.error.endBeforeStart      The end must be after the start.
editor.error.untilBeforeStart    The repeat must end after the event starts.
editor.error.countRange          Choose from 1 to {max} times.
editor.error.url                 Enter a web address, like example.com.
editor.error.readOnlyCalendar    This calendar can't be changed. Choose another calendar.
editor.error.outOfRange          Choose a date from 1583 to 9999.
editor.calendar.sameAccount      Events with invitees stay in their own account.
editor.conflict.title            {calendar} can't keep this repeat
editor.conflict.message          Exchange and Outlook calendars keep only repeats that follow the Gregorian calendar.
editor.conflict.useSafe          Use “{description}”
editor.conflict.never            Change repeat to Never
editor.conflict.otherCalendar    Choose another calendar
editor.notice.repeatDropped      Repeat changed to Never: {intercalary name} belongs to no month and no week.
editor.notice.repeatChanged      Repeat changed to {description}.
editor.notice.exceptionsRemoved  Changes to {n} single events in this series will be removed when you save. | Changes to 1 single event in this series will be removed when you save.   (plural)
editor.notice.laterDeleted       Saving for future events deletes the {n} later events in this series. | Saving for future events deletes 1 later event in this series.   (plural)
editor.notice.laterDeleted.endless  Saving for future events deletes every later event in this series.
editor.notice.becomesSingle      The series becomes one event on {date}.
editor.notice.alertsTrimmed      {calendar name} keeps only 1 alert, so the second alert was removed.
editor.notice.alertsRemoved      {calendar name} doesn't keep alerts, so the alerts were removed.
editor.invitees.apple            Changes are sent to {n} invitees. | Changes are sent to 1 invitee.     (plural)
editor.invitees.android          Your calendar account may send these changes to {n} invitees. | Your calendar account may send these changes to 1 invitee.   (plural)
editor.invitees.local            Changes stay in Thirteen. Invitees aren't told.
editor.invitees.confirm          Send changes to {n} invitees? | Send changes to 1 invitee?     (plural; Mac)
editor.invitees.send             Send
editor.writeOnly.calendar        Default calendar
editor.writeOnly.footer          New events go to your default calendar. To see them here, allow Full Access.
editor.discard.new.title         Discard this event?
editor.discard.new.button        Discard event
editor.discard.edit.title        Discard changes?
editor.discard.edit.button       Discard changes
editor.discard.keep              Keep editing
editor.changedElsewhere          This event changed in another app. Your changes win where you both changed the same detail.
editor.deletedElsewhere          This event was deleted in another app.
editor.occurrenceGone            This event changed in another app. Open it again to edit it.
editor.saveFailed.title          Couldn't save the event
editor.saveFailed.generic        Please try again.
editor.saveFailed.access         Thirteen no longer has access to your calendars.
editor.saveFailed.readOnly       This calendar can't be changed. Choose another calendar.
editor.saveFailed.account        The calendar's account didn't accept this change. Try another calendar.
editor.saveFailed.storage        There's no room left to save events in this browser. Export and delete old calendars to make room.
span.title                       This is a repeating event.
span.save.message                Save your changes for this event only, or for this and all future events?
span.save.this                   Save for this event only
span.save.future                 Save for future events
span.save.all                    Save for all events                         (repeats set in another app, §2.11)
span.keep.message                Its repeat was set in another app. Save your changes for this event only, or for all events?
span.keep.dateMessage            Its repeat was set in another app, so a new date can apply to this event only.
span.keep.firstGone              Its repeat was set in another app, and its first event was changed or deleted, so this change can apply to this event only.   (Apple, §4.7)
span.future.exceptionsDropped    Changes you made to {n} single events after this one will be removed. | Changes you made to 1 single event after this one will be removed.   (plural; Android, Windows, web)
span.deletesLater                The {n} later events in this series will be deleted. | 1 later event in this series will be deleted.   (plural)
span.deletesLater.endless        Every later event in this series will be deleted.
span.ruleChanged.message         Changing the repeat applies to this and all future events.
span.move.message                Move this event only, or this and all future events?
span.move.this                   Move this event only
span.move.future                 Move future events
span.move.changesRepeat          Moving future events to {date} changes the repeat to {description}.
span.move.dropsRepeat            Moving future events to {date} ends the repeat. The {n} later events in this series will be deleted. | Moving future events to {date} ends the repeat. 1 later event in this series will be deleted.   (plural)
span.move.dropsRepeat.endless    Moving future events to {date} ends the repeat. Every later event in this series will be deleted.
span.move.dropsRepeat.first      Moving the first event to {date} ends the repeat. The series becomes one event on {date}.
span.move.futureChange           Move future events and change repeat
span.move.deleteLater            Move and delete later events                (destructive style)
span.move.notAllowed             {calendar} can't keep the repeat this move needs, so only this event can be moved.
span.move.keep.message           Its repeat was set in another app, so only this event can be moved.
span.future.exceptionsLost       Changes you made to single events after this one will be lost.     (Apple, when a changed occurrence follows this one; gate V23, §2.11)
move.confirm.title               Move {title} to {calendar}?
move.confirm.message             It will be copied there and removed from {old calendar}.
move.confirm.button              Move
move.repeating.title             This repeating event can't be moved to {calendar}
move.repeating.message           Repeating events can't be moved to a calendar in another account here. Duplicate it instead, or move it in the Calendar app.
move.repeating.duplicate         Duplicate
move.invitees.title              Send changes to {n} invitees? | Send changes to 1 invitee?     (plural; Apple drag moves)
move.invitees.send               Move and send
move.invitees.title.android      Move this event?                            (message: editor.invitees.android)
move.invitees.move               Move
delete.single.title              Delete this event?
delete.single.button             Delete event
delete.repeating.message         Delete this event only, or this and all future events?
delete.repeating.this            Delete this event only
delete.repeating.future          Delete all future events
delete.invitees.apple            {n} invitees will get a cancellation. | 1 invitee will get a cancellation.   (plural)
delete.invitees.android          Your calendar account may send {n} invitees a cancellation. | Your calendar account may send 1 invitee a cancellation.   (plural)

picker.tab.gregorian             Gregorian
picker.done                      Done
picker.year                      Year
picker.year.positivist           {displayYear}, Gregorian {year}
picker.slot.month                {Month}, month {n} of 13
picker.slot.leapDay              Leap Day, leap years only
picker.slot.yearDay              Year Day, belongs to no month
picker.slot.festival             {festival name}, belongs to no month       (Holy Women adds: , leap years only)
picker.cell                      {shortDate}. Gregorian {gregorianShortDate}        (long forms without the year: "Thursday, October 12. Gregorian Monday, October 19")
picker.noWeekday                 No weekday
picker.leapOnly                  {Leap Day} happens only in leap years.
picker.fellBack                  {year} has no {day name}, so the date moved to {dayAndMonth}.   ("June 28"; Positivist: "the Festival of All the Dead")
picker.leapRepeat                Every {day name} happens only in leap years, so the year moved to {year}.

repeat.title                     Repeat
repeat.never                     Never
repeat.section.gregorian         Gregorian calendar
repeat.section.gregorian.footer  These follow the Gregorian calendar, like every other calendar app.
repeat.section.thirteen          {system name}
repeat.section.thirteen.footer   Every 13-month month has 28 days, so monthly repeats never skip a month.
repeat.footer.apple              Calendar on your iPhone, iPad and Mac shows the same days.        (after V1, §2.13)
repeat.footer.appleGoogle        Google Calendar on the web shows the same days.                  (after V2)
repeat.footer.appleGoogleAndroid Calendar apps on Android may show other days.                 (Apple with a Google calendar; Android rows stored as BYYEARDAY, §2.13)
repeat.footer.android            Google Calendar shows the same days.                             (after V3)
repeat.custom                    Custom
repeat.keep                      Keep: {description}
repeat.customUnknown             Repeats on a custom schedule
repeat.note.exchange             {calendar} can't keep 13-month repeats. Choose a calendar from {kinds} to use them.
repeat.note.exchange.none        {calendar} can't keep 13-month repeats.
repeat.calendarWithKind          {name} ({account kind})
repeat.kind                      iCloud | Google | CalDAV | On My iPhone | On My iPad | On My Mac | this device
repeat.list.or                   {a} or {b} | {a}, {b} or {c}
repeat.note.androidHorizon       Saved as a list of dates through {year}. Thirteen adds more dates whenever you open it.
repeat.note.androidHorizon.invitees  Saved as a list of dates through {year}. Because this event has invitees, Thirteen won't add more dates.
repeat.note.androidHorizon.capped    Saved as a list of dates through 2037, the last year this phone can store.   (API 30 and lower)
repeat.note.androidReencode      This repeat will be saved as a list of dates through {year}. Calendar on iPhone and Mac may not show later dates.
repeat.note.androidReencode.firstOnly  This repeat will be saved as a list of dates. Calendar on iPhone and Mac will show only the first date.   (V3 fallback: ships until V3 passes, §8.2)
repeat.custom.frequency          Frequency
repeat.custom.daily|weekly|monthly|yearly   Daily | Weekly | Monthly | Yearly
repeat.custom.every              Every
repeat.custom.unit               {n} days | 1 day, {n} weeks | 1 week, {n} months | 1 month, {n} years | 1 year   (plural)
repeat.custom.each               Each
repeat.custom.onThe              On the
repeat.custom.ordinals           first | second | third | fourth | fifth | last
repeat.custom.dayKinds           day | weekday | weekend day
(core generates the preset labels, descriptions, the "Next:" line and the repeat notes; their exact grammar is §5.2)

alert.none                       None
alert.atTime                     At time of event
alert.minutesBefore              {n} minutes before | 1 minute before                          (plural)
alert.hoursBefore                {n} hours before | 1 hour before                              (plural)
alert.daysBefore                 {n} days before | 1 day before                                (plural)
alert.weekBefore                 1 week before
alert.onDayAt                    On the day at {time}
alert.daysBeforeAt               {n} days before at {time} | 1 day before at {time}            (plural)
alert.weekBeforeAt               1 week before at {time}
alert.minutesAfter               {n} minutes after | 1 minute after                            (plural)
alert.absolute                   At {time} on {date}
alert.web.blocked                Your browser blocks notifications from Thirteen, so this alert won't appear.
alert.web.unsupported            This browser can't show alerts from web pages.
alert.android.blocked            Notifications for Thirteen are off, so this alert won't appear.     (V18 fallback)
alert.android.openSettings       Open settings
notification.body                {time range}, {location}      (all-day: All day, {location}; location omitted when empty)

calendars.title                  Calendars
calendars.showAll                Show all
calendars.hideAll                Hide all
calendars.readOnly               Read only
calendars.group.collapsed        {n} calendars, {m} shown | 1 calendar, {m} shown              (plural on n)
calendars.footer.ios             Hiding a calendar here hides it only in Thirteen. Add accounts and subscriptions in Settings > Apps > Calendar.
calendars.footer.mac             Hiding a calendar here hides it only in Thirteen. Add accounts in System Settings > Internet Accounts, and subscriptions in the Calendar app.
calendars.footer.android         Hiding a calendar here hides it only in Thirteen.
calendars.googleHint             Missing your Google calendars? In the Google Calendar app, open Settings > General and turn on Share Google Calendar data with other apps.
calendars.createDevice           Create a calendar on this device
calendars.createDevice.message   Events in this calendar stay on this phone. They aren't synced or backed up. Some calendar apps don't show this calendar or its alerts.
calendars.createDevice.message.alerts  Events in this calendar stay on this phone. They aren't synced or backed up. Thirteen shows their alerts.   (when the V18 fallback ships)
calendars.createDevice.button    Create calendar
calendars.deviceName             Thirteen
calendars.group.computer         On this computer
calendars.group.browser          In this browser
calendars.group.subscriptions    Subscriptions
calendars.personal               Personal
calendars.new                    New calendar
calendars.subscribe              Subscribe to calendar
calendars.import                 Import .ics file
calendars.export                 Export
calendars.name                   Name
calendars.color                  Color
calendars.delete                 Delete calendar
calendars.delete.message         Delete {name} and its {n} events? This can't be undone. | Delete {name} and its 1 event? This can't be undone.   (plural)
calendars.updated                Updated {relative time}
calendars.updating               Updating
calendars.updateFailed           Couldn't update. {reason}
calendars.feedEmpty              The feed returned no events. Showing the last copy.
calendars.feedPartial            Part of the feed couldn't be read. Showing the last copy.
calendars.offline                You're offline. Subscriptions update when you're back online.
calendars.updateNow              Update now
calendars.unsubscribe            Unsubscribe
calendars.unsubscribe.message    Unsubscribe from {name}? Its events disappear from Thirteen.
calendars.storage.web            Your events are saved in this browser on this device. Export them to keep a copy or to move them.
calendars.storage.safari         Safari deletes this site's data if you don't open Thirteen for about a week. Add Thirteen to your Dock or Home Screen, or export your calendars.
calendars.storage.safari.help    How to add it
calendars.storage.persist        Your browser may clear Thirteen's data when your device runs low on space.
calendars.storage.persist.button Keep my data
calendars.storage.persist.denied Export your calendars now and then to keep a copy.
calendars.exportReminder         You haven't exported your calendars in 30 days.
calendars.exportReminder.later   Not now
calendars.exportAll              Export all
calendars.storage.windows        Your events are saved on this computer.
calendars.openFolder             Open folder
calendars.colors                 Orange | Red | Amber | Green | Teal | Blue | Indigo | Purple | Pink | Brown | Graphite   (§3.6)
storage.unavailable              This browser doesn't let Thirteen save events here, so events you add disappear when you close this tab. Private windows and some privacy settings block saving.
store.recovered                  Thirteen couldn't read the latest changes to {name}, so it restored the last saved copy.
store.unreadable                 Thirteen couldn't read {name}. Its file is still in the Calendars folder.
store.unreadable.web             Thirteen couldn't read {name}.
store.download                   Download it
store.reloaded                   {name} changed outside Thirteen, so Thirteen reloaded it.

access.notAsked.title            See your events in 13 months
access.notAsked.body.apple       Thirteen can show the events from the calendars on this {device}, including iCloud, Google and Exchange, and add the events you create. Your events stay on your device and in your own accounts.
access.notAsked.body.android     Thirteen can show the events from the calendars on this phone, including Google and Exchange, and add the events you create. Your events stay on your phone and in your own accounts.
access.continue                  Continue
access.android.show              Show my calendars
access.android.notNow            Not now
access.rationale.title           Thirteen needs calendar access to show your events
access.rationale.body            Without it, Thirteen shows the calendar without your events.
access.rationale.button          Allow access
access.denied.title              Calendar access is off
access.denied.body.ios           To see and edit your events in Thirteen, open Settings and set Calendars to Full Access.
access.denied.body.mac           To see and edit your events in Thirteen, open System Settings > Privacy & Security > Calendars and allow full access for Thirteen.
access.denied.body.android       To see and edit your events in Thirteen, open Settings > Permissions > Calendar and choose Allow.
access.openSettings              Open Settings          (Android: Open settings; Mac: Open System Settings)
access.writeOnly.title           Thirteen can only add events
access.writeOnly.body            To see your events here too, set Calendars to Full Access for Thirteen in Settings.
access.writeOnly.body.mac        To see your events here too, open System Settings > Privacy & Security > Calendars and allow full access for Thirteen.   (button: access.openSettings, Mac form Open System Settings)
access.restricted.title          Calendar access is restricted
access.restricted.body           A Screen Time or device management setting doesn't allow Thirteen to use your calendars. Everything else in Thirteen still works.
access.noCalendars.title         No calendars yet
access.noCalendars.body.ios      Add an iCloud, Google or other account in Settings > Apps > Calendar, or create a calendar in the Calendar app.
access.noCalendars.body.mac      Add an account in System Settings > Internet Accounts, or create a calendar in the Calendar app.
access.noCalendars.body.android  Add a Google or other account in your phone's Settings under Accounts.
access.noWritable.apple          None of your calendars can be changed. Create a calendar in the Calendar app.
access.noWritable.android        None of your calendars can be changed from this phone.
access.ok                        OK
access.readOnly.banner           Thirteen can show your events but not change them.
access.readOnly.button           Allow changes
access.insertFallback            Add in your calendar app
access.insertFallback.none       No calendar app can add this event.
purpose.apple                    Thirteen shows the events from your calendars in its 13-month views and saves the events you add or change to the calendar you choose.

import.title                     Import events
import.summary                   {n} events in {file} | 1 event in {file}                       (plural)
import.into                      Add to
import.newCalendar               New calendar: {name}
import.button                    Import
import.result                    Added {a}, updated {u}, unchanged {s}.
import.notIcs                    This file isn't a calendar (.ics) file.
import.empty                     This file has no events.
import.partial                   {n} events couldn't be read and were skipped. | 1 event couldn't be read and was skipped.   (plural)
import.duplicates                {n} repeated events in the file were skipped. | 1 repeated event in the file was skipped.   (plural)
import.restore.title             Restore calendars
import.restore.summary           {n} calendars in {file} | 1 calendar in {file}                 (plural)
import.restore.button            Restore
import.restore.result            Restored {n} calendars. | Restored 1 calendar.                  (plural)
import.restore.keptNewer         {n} events changed after this backup, so their newer versions were kept. | 1 event changed after this backup, so its newer version was kept.   (plural; appended to import.restore.result)
export.title                     Export
export.calendars                 Calendars to export
export.button                    Export
export.fileZip                   Thirteen calendars {yyyy-MM-dd}.zip                            (web, several calendars)
export.chooseFolder              Choose a folder                                                (Windows, several calendars)
export.secretLinks               Exported subscriptions include their links. Treat secret links like passwords.
subscribe.title                  Subscribe to a calendar
subscribe.link                   Calendar link
subscribe.placeholder            webcal:// or https:// link
subscribe.help                   Use a public or secret iCal link. In Google Calendar it's in the calendar's settings under Integrate calendar, Secret address in iCal format. In iCloud, share the calendar as a public calendar and copy its link.
subscribe.checking               Checking the link
subscribe.found                  {name}: {n} events | {name}: 1 event                           (plural)
subscribe.update                 Update
subscribe.update.options         Every hour | Every 6 hours | Every day | Every week | Manually
subscribe.button                 Subscribe
subscribe.error.invalid          Enter a link that starts with webcal://, https:// or http://.
subscribe.error.httpOnWeb        This page can't open unencrypted links. Use the https:// version of the link.
subscribe.error.unreachable      Couldn't reach the server. Check the link and your connection.
subscribe.error.cors             This calendar's server doesn't let web pages read it. Download the .ics file and import it, or subscribe in Thirteen for Windows.
subscribe.error.webGeneric       Couldn't read this link. The server may be offline, or it may not let web pages read it.
subscribe.error.denied           The server refused access. The link may be private or expired.
subscribe.error.notFound         Nothing was found at this link.
subscribe.error.notCalendar      This link doesn't lead to a calendar.
subscribe.error.tooLarge         This calendar is too large (over 25 MB).
subscribe.warning.http           This link isn't encrypted. Others on your network could see this calendar.

settings.title.web               Settings
settings.group                   Calendar
settings.showEvents              Show my events
settings.showEvents.footer       Shows the events from your calendars in Thirteen. When off, Thirteen never asks for calendar access.
settings.access                  Calendar access
settings.access.values           Full access | Off | Add only | Read only | Restricted | Not set up   (Add only and Restricted: Apple; Read only: Android, read granted and write denied)
settings.defaultCalendar         Default calendar
settings.defaultCalendar.footer  New events go to {name}.
settings.yearDots                Show events in Year view
settings.alerts.web              Show alerts
settings.alerts.web.footer       Alerts appear only while Thirteen is open in a browser tab.
settings.alerts.web.footer.mobile  On phones and tablets, alerts appear only while Thirteen is on screen.
settings.alerts.windows.footer   Thirteen schedules alerts for the next 60 days each time it runs.
settings.alerts.android          Show alerts for the Thirteen calendar
settings.alerts.android.footer   Turn this off if your calendar app already shows these alerts.
settings.singleKey               Single-key shortcuts
settings.singleKey.footer        Press C for a new event, T for today, and D, W, M, Y or L to switch views.
settings.data                    Your data
settings.exportAll               Export all
settings.deleteAll               Delete all events
settings.deleteAll.message       Delete every event and calendar saved in this browser? This can't be undone.
```

### 2.20 Accessibility

**Labels.** Exact accessible names, asserted in each platform's UI tests with the mockup data set. Every
template is a catalogue string (§2.19), declared plural where it takes a count, and every label writes
"Gregorian" the same way: the word, a space, then the date, never with a colon.

| Element | Name (ids of §2.19) | Example |
|---|---|---|
| Month weekday header cell | `calendar.weekday.a11y` | "Sunday. Gregorian Thursday" |
| Month day cell (both densities) | `calendar.cell.a11y`, then `calendar.cell.events.a11y` (plural, when the day has events) and `calendar.gregorianMonthBegins.a11y` where it applies; traits Today, Selected | "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events."; "Wednesday, October 25, 2026. Gregorian Sunday, November 1, 2026. Gregorian November begins." |
| Month chip (titles density, regular width) and day list row | `calendar.item.a11y` + flags | "Sprint planning, 09:30 to 10:30, Work, repeats" |
| Week column (a container) | `calendar.column.a11y`; intercalary `calendar.column.intercalary.a11y` | "Thursday, October 12. Gregorian Monday, October 19"; "Year Day 2026, no weekday. Gregorian Thursday, December 31" |
| Week or Day block (inside its column) | `calendar.item.a11y` + flags | "Design review, 14:00 to 15:30, Work, invitation" |
| All-day or multi-day bar (every platform) | `calendar.bar.a11y` (one day: `calendar.bar.oneDay.a11y`) + flags | "Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family" |
| Intercalary band | `calendar.band.a11y`, then `calendar.cell.events.a11y` when it has events | "Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026. 1 event." |
| "+N more" (Month) | `calendar.more.a11y` | "3 more events on Thursday, October 12, 2026" |
| "+N" block (Week, Day) | `calendar.moreAt.a11y` | "3 more events at 14:00" |
| Up next and List rows | `calendar.row.a11y` + flags | "15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18" |
| Year day cell value | `year.cell.events` (plural, §2.3) | "3 events" |

Bar dates are Gregorian on every platform, and say so ("from Gregorian ..."), because the bar sits in a
13-month grid whose cell labels already carry the 13-month date. They are long Gregorian dates with the
weekday (`formatGregorian`, long, with weekday), without the year unless it differs from the year of the
row the bar is drawn in. Flags, in this order: `calendar.flag.repeats`, `calendar.flag.tentative` or
`calendar.flag.canceled`, `calendar.flag.invitation` or `calendar.flag.readOnly`, `calendar.flag.dayOf`,
`calendar.flag.continuesFrom` or `calendar.flag.continuesTo`. The continuation flags name the date the
event starts or ends in the bar's own form (", continues from Gregorian Sunday, October 18"), so a bar's
label never mixes the two calendars.

**Grouping.**

- VoiceOver and TalkBack, Month: each day cell is one element; its events are custom actions ("Open
  {title}") and a VoiceOver custom rotor "Events", so swiping through a month is 28 stops, not hundreds.
- Week: each column is an accessibility container with the column name above, holding its blocks in
  start order (SwiftUI `.accessibilityElement(children: .contain)` + label; Compose `semantics {
  isTraversalGroup = true; contentDescription = ... }`; an Avalonia automation peer of type `Group` with
  `Name`; web `role="group"` + `aria-label`). Item navigation on Mac and Windows therefore announces the
  day when entering a column.
- Web Month (`role="grid"`): arrows move between `gridcell`s with a roving tabindex, as the Year grid does;
  Tab leaves the grid. Enter or F2 moves focus into the focused cell's events (buttons); arrows or Tab move
  among them; Escape returns to the cell. Enter on an event opens its details. Windows uses the same model.

**Focus after actions** (every platform): after Add or Save, focus goes to the event's chip, block or row;
after Delete, to its day cell (in lists, to the next row); after Undo, to the restored event; after closing
details, to the item that opened them; after paging, to the same grid position, with the new title
announced (§2.1).

- **Timeline.** Blocks are focusable in start order inside their column. An "Add event" action exists on
  each column (no per-slot focus stops). Hour labels are hidden from assistive tech; the block label
  carries the time.
- **Dragging** always has an alternative (WCAG 2.5.7): Edit changes dates and times.
- **Editor errors and notices**: §2.11 Validation.
- **Read-only events**: Edit and Delete are absent from their menus; ⌘E / Ctrl+E / E and Delete on a
  selected read-only event change nothing and announce its read-only reason (`event.readOnly.*`).
  Historical events on Windows and web keep Delete and "Edit alerts" (§3.5), so Delete works on them.
- **Contrast.** Text on chips is `ink` on a tint of at most 24%: 16% in light themes (24% under Apple
  Increase Contrast) and 24% in dark themes, always; canceled titles use `ink-2`; calendar color is never
  the only cue (calendar name in labels and details). Tentative and canceled have text tags. Measured
  with `design/tokens.json` over `paper-raised` and the platforms' own calendar colors, the worst cases
  are `ink-2` at 4.84:1 (Forest dark, 24% iCloud yellow `#ffcc00`) and 5.81:1 (Forest light, 24% Google
  Grape); a dark tint of 32% would drop `ink-2` to 3.84:1, so no setting raises the dark tint.
  `scripts/design/check-contrast.mjs` gains these chip cases (Core, C10): `ink` and `ink-2` over 16% and
  24% light tints and 24% dark tints, in every theme, with the mockup palette (§3.6) and the platform
  palettes (iCloud yellow `#ffcc00`, orange `#ff9500`, green `#34c759`; Google Banana `#f6bf26`,
  Tangerine `#f4511e`, Sage `#33b679`, Grape `#8e24aa`), each at least 4.5:1.
- **Forced colors and high contrast.** Web `@media (forced-colors: active)`, like the existing `DateCell`
  rules: chips and bars get a 1 px `CanvasText` border and no tint; the tentative hatch becomes a dashed
  border; dots get a `CanvasText` ring; the now line uses `Highlight`; today uses `Highlight` and
  `HighlightText`. Windows high contrast (Avalonia `PlatformColorValues.ContrastPreference == High`): the
  same rules with the system colors. Apple Increase Contrast: light tints at 24%, dark tints unchanged at
  24%, and a 1 pt border in the calendar color on every chip and bar.
- **Text size.** Apple Dynamic Type, Android font scale, Windows text scale (`UISettings.TextScaleFactor`
  on the Windows target, applied to Thirteen's own font sizes and rechecked on window activation),
  browser text size. Month follows §2.4 (densities, list of days at accessibility sizes). Week falls back
  to Day at accessibility sizes (Apple AX1+, Android 1.5+, Windows 150%+, browser text 24 px+). Timeline
  hour height grows with the text size. At those sizes every popover (event details, "+N more", the
  "+{n}" overflow list, the 13-month date picker, the editor on iPad and Mac) is shown as a sheet
  instead, and editor date rows stack (§2.11). The 13-month date picker also replaces its grid with a
  list of the month's days (§2.12). Minimum sizes: §2.2.
- **Motion.** Mode and period transitions are animated only when Reduce Motion is off; drag previews stay.
- **Targets.** Every tappable item is at least 44 x 44 pt (Apple) / 48 x 48 dp (Android) / 32 x 32 px
  with 8 px spacing (pointer platforms). Two exceptions keep the grid readable: Month cells on phones
  are the targets and the day list holds the event targets; Month chips on iPad by touch are as tall as
  their lane (20 pt at the default size) with a hit area the full width of the cell, and the cell's "+N
  more" popover lists the same events in 44 pt rows (§2.4). Toast actions and Close buttons meet the
  minimum (§2.11).
- **Announcements.** After save, move, delete and undo, a polite announcement with the toast text and the
  undo hint (§2.11); a pending change that could not be written announces its failure toast the same
  way.

### 2.21 Keyboard

| Action | Mac, iPad keyboard | Windows | Web (single keys can be turned off) |
|---|---|---|---|
| New event | ⌘N | Ctrl+N | C |
| Today | ⌘T | Ctrl+T | T |
| Previous / next period | ⌘← / ⌘→ (was year only; now the mode's unit) | Ctrl+Left / Ctrl+Right | K / J (also P / N) |
| Day, Week, Month, Year, List (for the selected date) | ⌃⌘1 to ⌃⌘5 | Ctrl+Shift+1 to Ctrl+Shift+5 | D, W, M, Y, L |
| Move focus by day in Month / Week | arrows | arrows | arrows |
| Into the focused day's events / back to the day | Return or F2 / Esc | Enter or F2 / Esc | Enter or F2 / Esc |
| Move among a day's events | arrows, Tab | arrows, Tab | arrows, Tab |
| Open focused event | Return | Enter | Enter |
| Edit selected event | ⌘E | Ctrl+E | E |
| Delete selected event | ⌫ | Delete | Delete or Backspace |
| Undo / Redo (moves, deletes, saves) | ⌘Z / ⇧⌘Z (Edit menu) | Ctrl+Z / Ctrl+Y | Ctrl+Z / Ctrl+Shift+Z (⌘Z / ⇧⌘Z on a Mac) |
| Save in editor | ⌘Return (Return in single-line fields) | Ctrl+Enter | Ctrl+Enter (⌘Enter on a Mac) |
| Close popover, editor (asks to discard) | Esc | Esc | Esc |
| Calendars list | ⌥⌘K | Ctrl+Shift+K | none |
| Refresh | ⌘R (`refreshSourcesIfNecessary`) | F5, Ctrl+R (update subscriptions) | none (button) |
| Import / Export | none | Ctrl+O / Ctrl+Shift+E | none (buttons) |
| Keyboard help | none | none | ? |

Single-key shortcuts on the web never fire while focus is in a text field, select, or dialog. In a text
field, Undo and Redo act on the text, not on events.

### 2.22 Deep links and routes

All platforms (`thirteen://`), with the web's hash routes in the same shape. Years are Gregorian; every
route takes `?system=ifc|positivist` as today.

| Route | Opens |
|---|---|
| `thirteen://calendar` / `#/calendar` | Calendar in its last mode |
| `thirteen://year/2026` / `#/year/2026` (unchanged) | Calendar, Year mode |
| `thirteen://month/2026/11` / `#/month/2026/11` | Month mode: Gregorian year 2026, 13-month month 11 of the selected (or given) system |
| `thirteen://week/2026-10-19` / `#/week/2026-10-19` | Week mode for the 13-month week containing that Gregorian day (Day on compact) |
| `thirteen://day/2026-10-19` / `#/day/2026-10-19` | Day mode (also the target of alert clicks on Windows and web) |
| `thirteen://new-event?date=2026-10-19` / `#/new-event?date=2026-10-19` | the editor for a new event that day (after access, if needed) |
| `#/subscribe?url=<percent-encoded>` (web), `thirteen://subscribe?url=` (Windows) | the Subscribe dialog prefilled; never subscribes without the user pressing Subscribe; the web strips `url` from the address at once (§2.17) |
| `#/settings` (web) | the web Settings page (§2.18) |

Invalid values open the route's screen with defaults, as the existing routes do. There are no event
links in 1.0 (event identifiers are not stable across devices).

---

## 3. Data model

### 3.1 Core types

The platform-neutral model lives in `packages/core/src/events/` and is ported to Swift, Kotlin and C#
(names per §5.7). TypeScript is normative. The engine stays free of time zone databases: every value is a
**wall-clock** date and time; platform code supplies its own time zone data (Foundation `TimeZone`,
`java.time.ZoneId`, `TimeZoneInfo`, `Intl.DateTimeFormat`) through a `ZoneResolver` that only answers
UTC offsets, and every conversion between instants and wall clock runs in core (`zonedToUtc`,
`utcToZoned`, §3.3, §5.2). An instant is written as a UTC wall clock (`LocalDateTime` read as UTC), as in
an expanded occurrence's `startUtc` (§5.2).

```ts
/** A wall-clock moment with minute precision. `minute` is 0...1439, or 1440 ("24:00") in an end value. */
export interface LocalDateTime {
  readonly date: GregorianDate;
  readonly minute: number;
}

export type Availability = 'busy' | 'free' | 'tentative' | 'unavailable';
export type EventStatus = 'confirmed' | 'tentative' | 'canceled';
export type ReadOnlyReason =
  | 'calendar' | 'subscribed' | 'birthday' | 'invitation' | 'no-write-permission' | 'historical';  // §3.5
export type CalendarAccountKind =
  | 'icloud' | 'google' | 'exchange' | 'caldav' | 'device' | 'subscribed' | 'birthdays' | 'other';

export type Alarm =
  | { readonly kind: 'relative'; readonly offsetMinutes: number }   // negative = before the start
  | { readonly kind: 'absolute'; readonly at: LocalDateTime };      // device wall clock; kept, never offered

export interface CalendarInfo {
  readonly id: string;
  readonly title: string;
  readonly color: string;                  // '#rrggbb', sRGB
  readonly accountId: string;              // groups the Calendars list
  readonly accountTitle: string;           // 'iCloud', 'liis.kask@example.com', 'On My iPhone'
  readonly accountKind: CalendarAccountKind;
  readonly writable: boolean;
  readonly thirteenRepeats: 'all' | 'gregorian-only';   // §3.5
  readonly maxAlarms: number | null;       // null: no known limit
  readonly supportsAvailability: boolean;
  readonly supportsUrl: boolean;           // false on Android
  readonly isPlatformDefault: boolean;
}

/** What the editor edits. Wall-clock values are in `timeZone` (device zone for new events). */
export interface EventDraft {
  readonly title: string;
  readonly location: string;               // '' = none (same for notes and url)
  readonly notes: string;
  readonly url: string;
  readonly allDay: boolean;
  readonly start: LocalDateTime;           // all-day: T00:00 of the first day
  readonly end: LocalDateTime;             // end-of-day form (3.1.1); all-day: T24:00 of the last day
  readonly timeZone: string | null;        // IANA id; null = floating; always null for all-day (setDraftAllDay
                                           // takes the zone back as its timeZone option, §5.2)
  readonly calendarId: string;
  readonly recurrence: EventRecurrence | null;   // §4
  readonly alarms: readonly Alarm[];
  readonly availability: Availability;
}

/** A stored event as read from the platform (series master or single event). */
export interface CalendarEvent extends EventDraft {
  readonly id: string;                     // §3.2
  readonly status: EventStatus;
  readonly readOnly: ReadOnlyReason | null;
  readonly organizer: { readonly name: string; readonly isCurrentUser: boolean } | null;
  readonly attendeeCount: number;
  readonly alarmsEditable: boolean;        // §3.5: true for writable events and for invitations whose store keeps per-user alerts
  readonly selfStatus: 'accepted' | 'declined' | 'tentative' | 'needs-action' | null;
}

/** One occurrence as the views lay it out, in the DEVICE's wall clock. Platforms keep richer objects by key. */
export interface EventOccurrence {
  readonly key: string;                    // unique among the occurrences passed to one call (§3.2)
  readonly calendarId: string;
  readonly title: string;
  readonly allDay: boolean;
  readonly start: LocalDateTime;
  readonly end: LocalDateTime;             // end-of-day form
}
```

#### 3.1.1 End-of-day form

Ends are exclusive. To keep an all-day event on 9999-12-31 inside the supported range (its exclusive end
would be 10000-01-01) and to make day coverage trivial, every end is stored in **end-of-day form**: an end
at `D+1 T00:00` that is later than the start is written `D T24:00`. `normalizeEventEnd(start, end)` does
this; `compareLocalDateTime` treats `D T24:00` and `D+1 T00:00` as equal. Text form: `2026-10-19T24:00`.

- Days covered by an occurrence (`occurrenceDays`): every date from `start.date` to `end.date`,
  inclusive. A zero-length event covers its start date.
- An all-day event from October 19 to 21 is `2026-10-19T00:00` to `2026-10-21T24:00`.
- A timed event from 22:00 to 01:30 the next day covers both days; one from 09:00 to 24:00 covers one.
- An end earlier than its start is invalid everywhere (`RangeError`); platform adapters clamp foreign data
  with an end before the start to a zero-length event and log it. The one end that can come out before
  its start is a device wall clock: a short timed occurrence across a fall-back hour. `expandSeries` ends
  such an occurrence at its start, and the layouts lay out a timed occurrence whose wall-clock end is
  before its start as zero-length (§5.3); an all-day occurrence that ends before it starts is still a
  `RangeError` there.
- Pickers never show `T24:00`: a timed end `D T24:00` is displayed and edited as D+1 at 00:00
  (`displayEnd`) and normalized back on change (§2.12).

**Supported range for events.**

- Years 1 to 9999 are shown, as everywhere in Thirteen. No value with year 0 or 10000 is ever created:
  a fetch or expansion window that ends after the last day is written `9999-12-31T24:00`, and Android's
  `RDATE` horizon is capped at 9999-12-31.
- Converting a foreign occurrence between its zone and the device's can leave the range (15:00 on
  9999-12-31 in Tallinn is 03:00 on January 1, 10000 on a Pacific/Kiritimati device; 01:00 on 0001-01-01
  in Tokyo is in year 0 in UTC). `zonedToUtc` and `utcToZoned` (§5.2) then return null, and readers drop
  that occurrence with the warning `out-of-range` instead of throwing or clamping (C#'s
  `TimeZoneInfo.ConvertTime` clamps silently; the ports must not use it at the edges).
- **A timed occurrence whose instant leaves the range is dropped on every device**, its own zone included,
  and counted in `outOfRange`: 23:00 on 9999-12-31 in New York is 04:00 on January 1, 10000 in UTC, so
  it is not shown even on a New York device, where its wall clock would fit (`zonedToUtc` has no answer
  for it). The same holds at year 1 (01:00 on 0001-01-01 in Tokyo is dropped in Tokyo too). The fixtures
  use exactly these cases (`series`, `zones`, `far-future.ics`).
- Events Thirteen creates or edits start on or after 1583-01-01, and timed events end on or before
  9999-12-29T24:00 in their own zone, which leaves room for every conversion of up to 14 hours. Otherwise
  `validateDraft` reports `out-of-range`. 1583 is the first full year of the Gregorian calendar: before
  1582-10-15 Foundation's `.gregorian` calendar is Julian, so EventKit expands rules on Julian dates there
  and Apple would disagree with the other platforms. Existing events that start before 1583-01-01 are
  shown everywhere and are read-only (`historical`, §3.5; on Windows and web they can still be deleted
  and their alerts changed). Dates before 1583 may differ on Apple: EventKit expands repeats there on
  Julian dates, and CalDAV date values before 1582-10-15 are read as Julian, so the stored instant can
  already be 10 days off. Apple's mapping converts instants to dates with ThirteenKit's proleptic day
  arithmetic (never Foundation `.gregorian` date components) and does not try to correct such instants;
  `EventKitRoundTripTests` records what EventKit returns for an all-day event on 1500-03-01 and a yearly
  series from 1248 (documented, not asserted equal to the other platforms).
- **The exclusive end of 9999-12-31.** An all-day event that ends on 9999-12-31 has its exclusive end in
  year 10000, which RFC 5545 dates cannot hold (4-digit years) and core cannot represent. The `.ics`
  writer therefore omits `DTEND` for such an event when it lasts one day and writes `DURATION:P{n}D`
  when it lasts n days (the one case where Thirteen writes `DURATION`, §3.3). Android stores a single
  all-day event's `DTEND` as the instant 10000-01-01T00:00Z (253402300800000 ms); the Android reader
  and the `.ics` reader (which also accepts `DTEND;VALUE=DATE:10000101` from other writers) map that
  end straight to `9999-12-31T24:00`.

### 3.2 Identity

| | Event id | Occurrence key | Calendar id | Persisted reference (visibility, default calendar) |
|---|---|---|---|---|
| Apple | `eventIdentifier` | `{eventIdentifier}\|{occurrenceDate as UTC ISO 8601}` | `calendarIdentifier` | `{id, title, sourceTitle, color}`; match by id, then (sourceTitle, title) |
| Android | `Events._ID` | `{_ID}\|{Instances.BEGIN}` (self-expanded: `{_ID}\|{original start ms}`) | `Calendars._ID` | `{id, accountName, accountType, displayName}`; match by id, then (account, displayName) |
| Windows, web | `{calendarId}/{UID}` | `{calendarId}/{UID}\|{original start as LocalDateTime text, or date}` | UUID v4 | the UUID |

- `eventIdentifier` can change when an event moves calendars or after some syncs (research, Apple §3):
  after a save, re-read the event by the identifier EventKit returns; to re-find an occurrence, query a
  window of plus or minus one day around `occurrenceDate` and match `eventIdentifier` and
  `occurrenceDate`, falling back to `calendarItemExternalIdentifier` + start. Never use
  `event(withIdentifier:)` to edit an occurrence (it returns the first one).
- Windows and web create UIDs as lowercase UUID v4 strings. Imported UIDs are kept. A `VEVENT` without
  `UID` (import or feed) gets the derived `missing-{32 hex}` of §2.17, computed the same way on every
  read, so its key is stable across refreshes.
- Keys must be unique (layout ties and UI keys depend on it). Feeds are stored raw and may repeat a `UID`
  and `RECURRENCE-ID` pair: `eventsFromCalendar` collapses components that are exact duplicates, and gives
  any remaining colliding keys the suffix `#2`, `#3` in document order, with the warning `duplicate-uid`
  (§5.4).
- Android 13-month series stored as `RDATE` parts (§4.4) share the series id in their marker URI
  (`series=`); Thirteen shows the parts as one series, and keys stay per part (`{_ID}|{BEGIN}`). Two
  rows with the same series id and part number are duplicates (two devices topped up at once, §4.4):
  only the one kept by the rule of §4.4 is shown.
- Every merge of cached years (List, Up next, Week, Month across January 1) dedupes occurrences by key:
  an event that crosses January 1 is in both years' caches (§4.6).

### 3.3 Event fields on each platform

| Core field | EventKit (`EKEvent`) | CalendarContract | `.ics` (local store, import, export) |
|---|---|---|---|
| id | `eventIdentifier` | `Events._ID` | `UID` |
| title | `title` | `TITLE` | `SUMMARY` |
| location | `location` (`structuredLocation` kept untouched) | `EVENT_LOCATION` | `LOCATION` |
| notes | `notes` | `DESCRIPTION` | `DESCRIPTION` |
| url | `url` | not available (row hidden) | `URL` |
| allDay | `isAllDay` | `ALL_DAY = 1`, `EVENT_TIMEZONE = "UTC"` | `DTSTART;VALUE=DATE` |
| start, end (timed) | `startDate`, `endDate` instants | `DTSTART` ms; `DTEND` ms (single) or `DURATION = "P{seconds}S"` (recurring) | `DTSTART`, `DTEND` (`DURATION` read; written only in the year-9999 case of §3.1.1) |
| start, end (all-day) | write: `startDate` = first local instant of the first day, `endDate` = first local instant of the last day; read: last day = local date of `endDate - 1 s`, never before the start date | `DTSTART` = UTC midnight of the first day; `DTEND` = UTC midnight after the last day (single) or `DURATION = "P{days}D"` (recurring); an end of 10000-01-01T00:00Z reads as `9999-12-31T24:00` (§3.1.1) | `DTSTART;VALUE=DATE`, `DTEND;VALUE=DATE` exclusive (ending on 9999-12-31: no `DTEND`, or `DURATION:P{n}D`, §3.1.1) |
| timeZone | `timeZone` (`nil` = floating); new timed events: `TimeZone.current`; existing: kept | `EVENT_TIMEZONE` (IANA); `EVENT_END_TIMEZONE` written equal; no floating events (device zone) | `TZID` parameter; `Z` = UTC; neither = floating |
| calendarId | `calendar.calendarIdentifier` | `CALENDAR_ID` | the calendar document it is in |
| recurrence | `recurrenceRules` (one rule) + EventKit's internal exceptions | `RRULE`, `RDATE`, `EXDATE`, `EXRULE` (the last only read and kept) + exception rows (`ORIGINAL_ID`, `ORIGINAL_INSTANCE_TIME`); text formats parsed and written by core (`parseDateList`, `formatDateList`, §5.2) | `RRULE` (one or several), `RDATE` (dates, date-times or `VALUE=PERIOD`), `EXDATE`, `EXRULE` (kept and applied), `X-THIRTEEN-RULE`, override `VEVENT`s with `RECURRENCE-ID` |
| alarms | `alarms`: `EKAlarm(relativeOffset: offsetMinutes * 60)`; `absoluteDate` read only | `Reminders` rows: `MINUTES = -offsetMinutes`, `METHOD = METHOD_ALERT` (or `METHOD_DEFAULT` when `ALERT` is not in `ALLOWED_REMINDERS`) | `VALARM` with `ACTION:DISPLAY`, `DESCRIPTION` = title, `TRIGGER:-PT15M` (`TRIGGER;VALUE=DATE-TIME` read only) |
| availability | `availability` (`.busy`, `.free`, `.tentative`, `.unavailable`; written only when supported) | `AVAILABILITY` (`BUSY` 0, `FREE` 1, `TENTATIVE` 2) | `TRANSP` (`OPAQUE` busy, `TRANSPARENT` free); `X-MICROSOFT-CDO-BUSYSTATUS` read |
| status | `status` | `STATUS` (`TENTATIVE` 0, `CONFIRMED` 1, `CANCELED` 2) | `STATUS` |
| organizer, invitees | `organizer`, `attendees` (read only) | `ORGANIZER`, `Attendees` table (read only in 1.0) | `ORGANIZER`, `ATTENDEE` kept verbatim; name and count shown |
| selfStatus | the current user's `participantStatus` | `SELF_ATTENDEE_STATUS` | none |
| birthday | `birthdayContactIdentifier != nil` | calendar is a contacts-birthday calendar | none |

Rules that apply on every platform:

- Wall clock to instant uses the event's zone; a time inside a DST gap moves forward by the gap length
  (02:30 on a spring-forward night becomes 03:30), and an ambiguous time takes the earlier instant (RFC
  5545 §3.3.5). This is not every platform's default: `TimeZoneInfo.ConvertTimeToUtc` throws inside a gap
  and takes the standard (later) instant in an overlap, and Foundation and `Intl` have no such rule. So
  the rule is implemented once, in core's `zonedToUtc` (§5.2), on top of each platform's `ZoneResolver`
  (which only answers "UTC offset at this instant"); no port calls a platform conversion that applies its
  own rule. Fixture sections `zoneMath` (a synthetic zone) and `zones` (real zones) check it.
- **Occurrence ends.** A timed occurrence ends at its start instant plus the master's exact duration
  (`DTEND` minus `DTSTART` as instants, both through the event's zone), as RFC 5545 defines for repeats.
  A floating series measures that length through the device's zone, as it places its start, so a floating
  01:00 to 03:00 on a spring-forward night shows 01:00 to 03:00. An `.ics` `DURATION` is nominal in its
  days and weeks and exact in its hours, minutes and seconds (RFC 5545 §3.3.6, §3.8.5.3): every
  occurrence of a timed master with `DURATION:P1D` ends at the same wall-clock time on the next day in
  the event's zone, also across a DST change (23 or 25 hours), and a `DURATION` without days (`PT25H`)
  is exact. Core carries the days separately for this (`SeriesInput.duration`, §5.2), and an
  `RDATE;VALUE=PERIOD` with a duration counts its days on that extra date's own wall clock (§5.4). An
  all-day occurrence covers the master's number of days. Android's `DURATION` is the exact value
  (`P{seconds}S`, or `P{days}D` for all-day; the provider reads it exactly), and it belongs to the time
  field group: `DURATION`, and the switch between `DTEND` and `DURATION`, is written whenever the
  master's start or end changes and never otherwise (§4.9). When Thirteen writes a repeating event, the
  master's end is the draft's end in the event's zone, as typed; if that first occurrence crosses a DST
  change, every occurrence gets that exact length, as in Apple Calendar.
- **All-day alert times** are wall-clock times in the device's zone on the alert's day (§2.14).
- Views always show the device's wall clock. An event made in New York at 21:00 shows at 04:00 the next
  day on a phone in Tallinn, and the details add "In New York: 21:00 to 22:00".
- Seconds are dropped when reading (minute precision), but never lost by a save: fields the user did not
  change are not written (§4.9), and on Windows and web an event keeps its original text until it is
  edited (§3.6).

### 3.4 Calendars on each platform

| CalendarInfo | EventKit (`EKCalendar`) | CalendarContract (`Calendars`) | Windows, web |
|---|---|---|---|
| id | `calendarIdentifier` | `_ID` | UUID |
| title | `title` | `CALENDAR_DISPLAY_NAME` | `NAME` / `X-WR-CALNAME` |
| color | `cgColor` converted to sRGB inside the store actor | `CALENDAR_COLOR` (ARGB int) | user's palette choice (§3.6) |
| accountId, accountTitle | `source.sourceIdentifier`, `source.title` | (`ACCOUNT_NAME`, `ACCOUNT_TYPE`), `ACCOUNT_NAME` | `local` "On this computer" / "In this browser"; `subscriptions` "Subscriptions" |
| accountKind | `source.sourceType`: `.local` device, `.exchange` exchange, `.mobileMe` icloud, `.calDAV` icloud when the source title is "iCloud", google when it is a Gmail or Google address, else caldav; `.subscribed` subscribed; `.birthdays` birthdays | `ACCOUNT_TYPE`: `com.google` google; `LOCAL` device; any type containing `exchange` or starting with `com.microsoft` exchange; `at.bitfire.davdroid` caldav; else other | device / subscribed |
| writable | `allowsContentModifications` and type is not birthday and not subscribed | `CALENDAR_ACCESS_LEVEL >= 500` and `SYNC_EVENTS = 1` and not `DELETED` and `WRITE_CALENDAR` granted | local: yes; subscription: no |
| thirteenRepeats | `gregorian-only` for exchange, else `all`; a release made before gate V1 passes also gives icloud `gregorian-only`, and one made before V2's EventKit leg passes gives google `gregorian-only` (their fallbacks, §8.2, §8.3 item 2) | `all` for google, device and caldav (`at.bitfire.davdroid`); `gregorian-only` for every other type | `all` |
| maxAlarms | 1 for exchange, else null | `MAX_REMINDERS` | null |
| supportsAvailability | `supportedEventAvailabilities` contains busy and free | `ALLOWED_AVAILABILITY` contains 0 and 1 (missing column: yes) | yes |
| supportsUrl | yes | no | yes |
| isPlatformDefault | equals `defaultCalendarForNewEvents` | first writable calendar with `IS_PRIMARY = 1` | "Personal" |

Android reads only calendars with `SYNC_EVENTS = 1` (the provider generates no instances for the others)
and never writes `VISIBLE` (writing it drops the provider's alarms for that calendar).

### 3.5 Read-only and capability rules

An event is read-only, with the first matching reason, when:

1. its calendar is a subscription (`subscribed`) or Birthdays (`birthday`), or not writable (`calendar`);
2. it is a birthday event (`birthday`);
3. it is an invitation: the organizer is someone else and the user may not modify it (Apple: `organizer`
   present, `!organizer.isCurrentUser`, `attendees` not empty; Android: `ORGANIZER` differs from the
   calendar's `OWNER_ACCOUNT`, `HAS_ATTENDEE_DATA = 1` and `GUESTS_CAN_MODIFY = 0`) (`invitation`);
4. Android only: `WRITE_CALENDAR` is not granted (`no-write-permission`);
5. it starts before 1583-01-01 in its own zone (`historical`, §3.1.1).

`alarmsEditable` is true for every writable event. For read-only events it is false, except for
invitations in a calendar that keeps each person's own alerts: Android, any calendar that is writable for
its own rows (alerts are `Reminders` rows, separate from the event); Apple, iCloud, Google and Exchange
calendars once gate V20 shows that EventKit saves an invitee's `alarms` there (until then false). An
invitation's alert edit changes only the alarms; title, times, repeat and every other field are never
written.

`historical` on Windows and web: no other app can change Thirteen's local events there, so a
`historical` event keeps `alarmsEditable` true and can be deleted with every delete span (§2.10,
`event.readOnly.historical.local`); its other fields stay read-only. The write keeps every untouched
property as read (§4.9), so its pre-1583 dates are never re-derived. On Apple and Android it is
read-only like any other reason.

**Apple-made `BYYEARDAY` series on Android, while the fallback of gate V2's Android leg is in force**
(owner: that leg is not run for now, §8.2). A series whose stored `RRULE` uses `BYYEARDAY` is read-only
on Android except its alerts, wherever §2 treats read-only events: no Edit or Delete, it cannot be
picked up for a drag, "Edit alerts" changes only its `Reminders` rows (like an invitation's alerts,
above), "Duplicate" stays, and the details show the reason line `event.readOnly.byYearDay.android`.
This is a platform rule of the Android app: core's `ReadOnlyReason` has no value for it, so the Android
mapping keeps it next to the `CalendarEvent` (a writable calendar's event keeps `readOnly: null` and
`alarmsEditable: true` in core). Once V2's Android leg passes, the rule goes and the write-back rules of
§4.4 and §4.9 apply.

Capabilities, checked by `validateDraft` (§5.2) and the editor:

- 13-month repeats whose encoding is not Exchange-safe (§4.3) need `thirteenRepeats = 'all'`.
- At most `maxAlarms` alarms are saved.
- "Show as" is shown only when `supportsAvailability`; URL only when `supportsUrl`.
- Events with invitees that the user organizes: Thirteen edits title, time, location, notes, URL, alerts
  and repeat like Apple Calendar, and says so before anything is sent: the editor footer on Apple and
  Android, the "Send changes to {n} invitees?" question on the Mac, the invitee question before a drag
  move, the cancellation line in the delete confirmation, and the invitee line in the pending toast
  (§2.11). The account sends the updates as it always does. Android top-up of RDATE lists (§4.4) is skipped for events with invitees, because each
  top-up would be sent as an update.
- Events with invitees (organized by the user or received) never move to a calendar of another account on
  Apple and Android (§2.15, §4.7): such a move is a copy and a delete, which the account would send to
  every invitee as a cancellation and a new invitation.
- Windows and web never send anything to invitees; an imported event with `ATTENDEE` lines is edited
  locally only and the editor says so (§2.11).

### 3.6 Local store (Windows, web)

Each local calendar and each subscription is stored as **one iCalendar document** (RFC 5545), the same
format that import and export use, so storage and export cannot drift. Metadata the user edits lives in an
index next to the documents.

**A document is a list of raw components, not a re-serialized model.** The reader (§5.4) keeps, for every
`VEVENT` and `VTIMEZONE`, the exact text it was read from (its content lines from `BEGIN` to `END`, folding
included, line ends normalized to CRLF), and keeps every component it does not model (`VTODO`,
`VJOURNAL`, an unreadable `VEVENT`, an exact duplicate) as read in `others`, which is written back too. A
write re-serializes only the **UID group** (master plus overrides) that the change touched, and copies
every other group, every kept component and every `VTIMEZONE` still in use back byte for byte, in the
order they were read. So editing one event in a calendar imported from Outlook leaves every other imported
event, its seconds, its `RDATE;VALUE=PERIOD`, its Windows zone id and its original `VTIMEZONE` exactly as
they were (fixture `edits/outlook-edit-one.ics`, §5.6). An edited group keeps its original `TZID` string
and `VTIMEZONE` when its zone did not change, and the properties of the fields the user did not touch as
read. A `VTIMEZONE` that nothing written references any more (no group, and no component kept in
`others`, such as a `VTODO`'s `DUE;TZID`) is dropped. A known zone (an IANA id or a Windows id, §5.4)
that the document uses without defining gets a generated `VTIMEZONE` when the document is written, also
the first time a file read from elsewhere is written (the `zones-added` round trips of §5.6).

Two exceptions change stored text on purpose, both when a group enters the store rather than later:

- **Import records its baseline in the raw text.** When an import (not a restore of Thirteen's own
  export) adds or replaces a group, the line `X-THIRTEEN-IMPORTED-LAST-MODIFIED:{value}` (the incoming
  group's newest `LAST-MODIFIED`, or `DTSTAMP` where that is missing, in UTC) is inserted into the raw
  text of its master just before `END:VEVENT`, replacing an earlier such line. In a group without a
  master, and for an override merged into a stored group (§2.17 step 3), each override carries its own
  line instead, with that override's own version. Every other byte of the group stays as read, and from
  then on the group is copied byte for byte like any other (§2.17 step 3 uses the value).
- **Time zone names that collide are renamed, but only names that mean nothing without the file.** A
  `TZID` that `resolveTzid` (§5.4) resolves through platform zone data, a known IANA id
  (`Europe/Tallinn`) or a name in the CLDR Windows table (`FLE Standard Time`), is never renamed: its
  `VTIMEZONE` is never read for times, and every app maps the id itself. Thirteen's own generated
  `VTIMEZONE`, Google's and Apple's for the same IANA id always differ in their observances, so comparing
  them would rename on every ordinary import. For such a `TZID` the incoming groups keep their `TZID` and
  their raw text byte for byte, and the document keeps one `VTIMEZONE` for it: its existing one (a
  generated one is rebuilt if the years used grow, §5.4), or the incoming one when the document had none.
  Only a `TZID` that resolves through the file's own `VTIMEZONE` (Outlook's "Customized Time Zone" and
  any other name that is neither a known IANA id nor in the CLDR table) is compared: when the target
  document already defines it differently (Outlook's rules differ from file to file), the incoming one is
  renamed `{TZID} (2)` (then `(3)`, ...), and the `TZID` parameters of the incoming groups that use it are
  rewritten, so those groups are stored re-serialized instead of raw. Two definitions are the same when
  their observances (kind, `DTSTART`, `TZOFFSETFROM`, `TZOFFSETTO`, `RRULE`, `RDATE`) are equal, ignoring
  order, `LAST-MODIFIED`, `TZURL` and `X-` properties; a same definition is shared, not duplicated.

| | Web | Windows |
|---|---|---|
| Index | IndexedDB database `thirteen-events`, version 1, store `calendars` (keyPath `id`) | `%LOCALAPPDATA%\Thirteen\Calendars\calendars.json`: `{"version": 1, "calendars": [index records]}` |
| Documents | store `documents` (keyPath `calendarId`): `{calendarId, ics, savedAt, previousIcs}` (`previousIcs`: subscriptions only, the copy before the last accepted refresh) | `%LOCALAPPDATA%\Thirteen\Calendars\{id}.ics`, with `{id}.ics.bak` (the previous version, for local calendars and subscriptions alike) |
| Other state | store `meta` (key-value): `lastExportAt`, `exportReminderSnoozedUntil` (§2.16) | none |
| Write | read-modify-write inside `navigator.locks.request('thirteen-events', ...)`: read the calendar's current record from IndexedDB (never write a tab's in-memory copy), apply the change to its one UID group, write, then `BroadcastChannel('thirteen-events')` posts `{type: 'changed', calendarId}`; other tabs reload that calendar | every writer (UI saves, pending-change commits, import, restore, subscription refresh) goes through one per-calendar queue (`SemaphoreSlim` per calendar id) inside `EventStore`; inside it, read the file, compare its SHA-256 with the hash of the version last loaded, and if it differs reload first (`store.reloaded`, §2.16) and apply the change to the reloaded document; then write `{id}.ics.tmp` in the same folder (`FileOptions.WriteThrough`), then `File.Move(tmp, {id}.ics)` when `{id}.ics` does not exist (the first save of every calendar, or after the user deleted the file) and `File.Replace(tmp, {id}.ics, {id}.ics.bak)` otherwise; `calendars.json` the same way; one process at a time (named mutex, §6.4); a `FileSystemWatcher` on the folder (debounced 500 ms, ignoring Thirteen's own writes by hash) reloads calendars changed outside Thirteen |
| Reading fails | §2.16 "Unreadable data" | §2.16: `.bak` recovery, `.broken-*` rename, read-only unreadable calendar |
| Uninstall / clear | clearing site data deletes everything | the uninstaller leaves the folder (user data) and removes scheduled alerts (§6.4) |

**The web origin.** IndexedDB, `navigator.storage.persist()`, the notification permission, Web Locks and
BroadcastChannel are scoped to the page's origin (scheme, host and port), not its path. Every GitHub Pages
project site of one account shares `https://<account>.github.io`, and `siim.github.io` already serves
another project (`/PHP-forum/`). On that origin any page of any of those sites could read and change
Thirteen's events and the stored subscription links (secret Google and iCloud links work like
passwords), and clearing site data for one site clears all of them. Moving to another origin after 1.0
would strand every user's local events, because IndexedDB cannot be moved between origins. So 1.0 MUST
serve the web app from an origin no other site uses. The owner chose the GitHub Pages custom domain
`https://thirteen.haugas.dev/`, served from the site root (§8.5; release gate §8.3 item 10). Events are
only ever stored there: every link to the web app, the repository's own included, points at
`https://thirteen.haugas.dev/`, GitHub Pages sends the project's old Pages address there before any
page loads, and the app never opens IndexedDB on any other origin.

Index record (both platforms, JSON names):

```json
{
  "id": "6f1c2d1e-8a7b-4c2e-9a51-3f0f5d9b2c11",
  "kind": "local",
  "name": "Personal",
  "color": "#ea580c",
  "order": 0,
  "visible": true,
  "createdAt": "2026-10-19T09:41:00Z",
  "subscription": null
}
```

For `"kind": "subscription"`, `subscription` is
`{"url": "https://...", "interval": "PT6H", "etag": null, "lastModified": null, "contentHash": null,
"suspect": null, "lastAttemptAt": null, "lastSuccessAt": null, "lastError": null}` with `interval`
one of `PT1H`, `PT6H`, `P1D`, `P7D`, `manual`; `etag` and `lastModified` filled on Windows only (the web
never sends conditional headers, §6.5); `contentHash` the SHA-256 of the last stored body as
`"sha256:<hex>"` on both, used to skip re-parsing an unchanged feed; `suspect` the parse outcome of a
body held back as suspicious, `{"kind": "empty" | "partial", "events": n, "skipped": m}` (§2.16),
accepted if the next refresh is held back with the same outcome; `lastSuccessAt` the time
the stored body's fetch **started**; and `lastError` one of the `subscribe.error.*` ids or `feed-empty`,
`feed-partial`.

**Refreshing a subscription** (both platforms): one refresh per subscription at a time (web: inside
`navigator.locks.request('thirteen-sub-' + id, {ifAvailable: true}, ...)`, skipped when another tab holds
it; Windows: a per-subscription queue in `SubscriptionService`). The body is stored only if this fetch
started after the stored `lastSuccessAt` (so a slow, older response never overwrites a newer one), its
hash differs from `contentHash`, and it is not suspicious (or is suspicious with the same outcome as the
stored `suspect`, §2.16). Storing moves the current copy to
`previousIcs` (web) or `{id}.ics.bak` (Windows) first.

Calendar document rules:

- `VCALENDAR` carries `VERSION:2.0`, `PRODID:-//Haugas Development OU//Thirteen 1.0//EN`, `CALSCALE:GREGORIAN`,
  `X-WR-CALNAME`, `NAME`, `X-APPLE-CALENDAR-COLOR:#EA580C`, `COLOR` (nearest CSS3 color name, RFC 7986)
  and `X-THIRTEEN-CALENDAR-ID`. Subscription documents are stored exactly as fetched (raw text), never
  rewritten.
- When Thirteen serializes a group (new, or edited), it writes per `VEVENT`: `UID`, `DTSTAMP`, `CREATED`,
  `LAST-MODIFIED`, `SEQUENCE` (incremented on every user change), `SUMMARY`, `LOCATION`, `DESCRIPTION`,
  `URL`, `DTSTART`, `DTEND`, `RRULE`(s), `RDATE`, `EXDATE`, `EXRULE` (as read), `X-THIRTEEN-RULE`,
  `TRANSP`, `STATUS`, `VALARM`s, `X-THIRTEEN-IMPORTED-LAST-MODIFIED` (imported groups only: the newest
  `LAST-MODIFIED` or `DTSTAMP` of the group as it was last imported, §2.17), and one `VTIMEZONE` per
  `TZID` used that is not already in the document (§5.4). A `VTIMEZONE` that Thirteen generated carries
  `X-THIRTEEN-GENERATED:{first year}-{last year}` (the years it was built for) and is rebuilt whenever
  the document is written and the events using its `TZID` reach outside those years; raw `VTIMEZONE`s
  from other files are never rebuilt. Field groups the user did not change keep their read values,
  including recurrence text (§4.9).
- Properties Thirteen does not understand (`ATTENDEE`, `ORGANIZER`, `CATEGORIES`, `X-*`, `ATTACH`, ...) on
  imported events are kept verbatim, in their original order, also when their group is re-serialized, and
  written back on export.
- Palette for new calendars and subscriptions, first color not in use: Orange `#ea580c`, Red `#dc2626`,
  Amber `#d97706`, Green `#16a34a`, Teal `#0d9488`, Blue `#2563eb`, Indigo `#4f46e5`, Purple `#9333ea`,
  Pink `#db2777`, Brown `#92400e`, Graphite `#57534e`.
- Limits: a document over 25 MB or with more than 50,000 `VEVENT`s is refused with
  `subscribe.error.tooLarge` / `import` errors. Expansion is per Gregorian year (§6), so large
  calendars stay fast.

---

## 4. Recurrence

### 4.1 Supported options

| Option (label for start Monday, October 19, 2026 = IFC Thursday, October 12) | Kind | Exchange-safe |
|---|---|---|
| Never | none | yes |
| Every day | Gregorian `FREQ=DAILY` | yes |
| Every week on Monday | Gregorian `FREQ=WEEKLY` | yes |
| Every 2 weeks on Monday | Gregorian `FREQ=WEEKLY;INTERVAL=2` | yes |
| Every month on the 19th | Gregorian `FREQ=MONTHLY` | yes |
| Every year on October 19 | Gregorian `FREQ=YEARLY` | yes |
| Custom (daily, weekly with days, monthly by days or "on the", yearly by months, every N) | Gregorian `RRULE` | yes (Exchange accepts the Calendar.app subset) |
| Every IFC month on the 12th | 13-month monthly | no |
| Every IFC week on Thursday | 13-month weekly, interval 1 | no |
| Every 2 IFC weeks on Thursday | 13-month weekly, interval 2 | no |
| Every year on IFC October 12 | 13-month yearly | yes for dates that never move (§4.3 a), else no |
| Every Year Day / Every Leap Day / Every Festival of All the Dead / Every Festival of Holy Women | 13-month intercalary | Year Day, Leap Day, Holy Women yes; All the Dead no |
| Keep: {description} | foreign rule, preserved | as it was |

"Exchange-safe" means Exchange and Outlook store the rule. Two Gregorian rules are stored but placed
differently there: a monthly rule on the 29th, 30th or 31st and a yearly rule on February 29 fall on the
month's last day in Outlook, where Thirteen, Apple and Google skip the month or year. They stay offered,
with the Outlook note of §2.13 on `gregorian-only` calendars (gate V4).

Not offered, because no platform can store them as one rule (Apple allows one `RRULE` per event, research
Apple §6): "every N 13-month months" for N from 2 to 12, every 3 or more 13-month weeks, and several
13-month rules on one event. Every 13 months is "every year". Ends: Never, On date, After N times (1 to
999) for every option. Presets use the minimal Gregorian forms above (EventKit and Google derive the day
from `DTSTART`); recognition (§4.5) also accepts the explicit forms (`BYDAY=MO`, `BYMONTHDAY=19`,
`BYMONTH=10;BYMONTHDAY=19`).

### 4.2 13-month rules

```ts
export type ThirteenRule =
  | { readonly kind: 'monthly'; readonly system: CalendarSystemId; readonly day: number }          // 1...28
  | { readonly kind: 'weekly'; readonly system: CalendarSystemId; readonly weekday: Weekday; readonly interval: 1 | 2 }
  | { readonly kind: 'yearly'; readonly system: CalendarSystemId; readonly month: number; readonly day: number } // 1...13, 1...28
  | { readonly kind: 'intercalary'; readonly system: CalendarSystemId; readonly id: IntercalaryDayId };
```

Dates of a rule in Gregorian year `Y` (all through existing engine functions, so they are exact for
years 1 to 9999):

- **monthly**: `createMonthDate(Y, m, day, system)` for m = 1...13 (13 dates every year).
- **weekly**: the 13-month weekday `weekday` falls on month days `k, k+7, k+14, k+21` of every month,
  with `k = ((weekday - weekStartsOn + 7) mod 7) + 1` (IFC weekStartsOn Sunday, Positivist Monday).
  Interval 1: all four in all 13 months (52 dates). Interval 2: the two of them in the same fortnight
  phase as the start, `{p, p + 14}` with `p = ((startDay - 1) mod 14) + 1`, in all 13 months (26 dates).
  Intercalary days are never weekly occurrences, and because 364 = 26 x 14 the phase never drifts.
- **yearly**: `createMonthDate(Y, month, day, system)`.
- **intercalary**: the intercalary day's date in `Y`, if it exists (`intercalaryDayOfYear`); leap-only
  days only in Gregorian leap years.

A rule is created from a start date by `thirteenRuleFor` (§5.2); a monthly, weekly or yearly rule cannot
start on an intercalary day, and an intercalary rule only on its day. The start date is always the first
occurrence.

A rule belongs to the system it was made in. In the other system its dates are still shown correctly, and
its description names its own system ("Every IFC month on the 12th" while Positivist is selected).

### 4.3 Encodings

Every 13-month rule has exactly one **RRULE encoding** (`encodeThirteenRule`), chosen in this order:

**(a) Gregorian yearly.** A yearly or intercalary rule whose Gregorian month and day are the same in
common and leap years is the plain rule `FREQ=YEARLY` with `DTSTART` on the date. That covers IFC dates
with day-of-year up to 59 (January 1 to March 3) and from Sol 1 on (Sol 1 = June 18 ... December 28 =
December 30), IFC Year Day (December 31), and Positivist dates with day-of-year up to 59 (Moses 1 to
Aristotle 3). Exchange-safe.

**(b) Day-of-year list.** Every other monthly, weekly or yearly rule, and Positivist All the Dead, is
`FREQ=YEARLY;BYYEARDAY=list`. For each 13-month date (month `m`, day `d`) of the rule, with
`p = 28(m - 1) + d` (its day-of-year in a common year):

- IFC, months 1 to 6: `p`. IFC, months 7 to 13: `p - 366` (counted back from the end of the year, which
  absorbs Leap Day before them and Year Day after them).
- Positivist, every month: `p` (Positivist's extra days are at the end of the year). All the Dead: `365`.

The list is sorted ascending (positives first, then negatives from -365 up), without duplicates. Examples
(verified with Foundation's RFC 5545 engine for 2024 to 2104, research Apple §6):

| Rule | `RRULE` |
|---|---|
| Every IFC month on the 12th | `FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18` |
| Every IFC month on the 1st | `FREQ=YEARLY;BYYEARDAY=1,29,57,85,113,141,-197,-169,-141,-113,-85,-57,-29` |
| Every IFC month on the 28th | `FREQ=YEARLY;BYYEARDAY=28,56,84,112,140,168,-170,-142,-114,-86,-58,-30,-2` |
| Every Positivist month on the 12th | `FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,180,208,236,264,292,320,348` |
| Every IFC week on Thursday | `FREQ=YEARLY;BYYEARDAY=5,12,19,26,...,166,-193,-186,...,-4` (52 values) |
| Every year on IFC April 12 | `FREQ=YEARLY;BYYEARDAY=96` |
| Every Festival of All the Dead | `FREQ=YEARLY;BYYEARDAY=365` |

Not Exchange-safe (Exchange and Outlook accept only template rules; research Apple §6).

**(c) Leap interval.** IFC Leap Day and Positivist Festival of Holy Women are
`FREQ=YEARLY;INTERVAL=4;UNTIL={cap}` with `DTSTART` on the day (June 17 or December 31 of a leap year).
`cap` is that day in the last leap year before the first century year after the start that is not a leap
year (`Y mod 100 = 0` and `Y mod 400 != 0`): for any start from 2024 to 2096 the cap is 2096 (from 2104
it is 2196; from 9904 the end of the range makes it 9996). A user-chosen end earlier than the cap wins;
a later until or a longer count is written as the cap (`recurrenceToRRule` drops the `COUNT` and keeps
`UNTIL={cap}`). The cap holds in core whatever the end: every expansion path stops a leap-only repeat at
its cap (`expandRecurrence`, `expandSeries`, `nextOccurrences`, `laterOccurrenceCount`, splits; §4.6),
so End repeat Never means "until the cap", and a stored `UNTIL` equal to the cap reads back as Never
(§4.5). "Every Leap Day, 5 times" from 2088 therefore has 3 occurrences (2088, 2092, 2096), is stored with
`UNTIL=20960617`, and reads back as Never; its description says ", 5 times" only until it is saved. The
editor shows `repeat.note.leapCap`. Exchange-safe. `BYYEARDAY=366` would be exact on Apple but is not
used, so every platform stores the same rule.

**(d) RDATE list (Android only).** `DTSTART` plus `RDATE` with every later occurrence up to the end or
the horizon (§4.4), no `RRULE` (`thirteenRuleRdates`), split into parts of at most 210 values when longer
(`thirteenRuleRdateParts` with `maxValues: 210`, §4.4). Not Exchange-safe.

**(e) Marker.** Wherever a 13-month rule is stored outside EventKit, Thirteen also stores its canonical
text, so it is recognized even after another app edits around it:

```
X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=monthly;DAY=12
X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=weekly;WEEKDAY=TH;INTERVAL=2
X-THIRTEEN-RULE;VERSION=1:SYSTEM=positivist;KIND=yearly;MONTH=4;DAY=4
X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc;KIND=intercalary;DAY=LD
```

Grammar: `SYSTEM=(ifc|positivist);KIND=(monthly|weekly|yearly|intercalary)` then `DAY=1..28` (monthly),
`WEEKDAY=SU..SA[;INTERVAL=1|2]` (weekly), `MONTH=1..13;DAY=1..28` (yearly), `DAY=YD|LD` (intercalary;
for Positivist `YD` is All the Dead and `LD` is Holy Women, matching the engine's ids `year-day` and
`leap-day`). Keys in this order, no spaces, uppercase keys and lowercase values except weekday and day
codes. On Android the same information is the URI `thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never`
(`end=never`, `end=count:10` or `end=until:2027-06-30`) in `CUSTOM_APP_URI`, with
`CUSTOM_APP_PACKAGE = com.haugas.thirteen`. A series stored as several `RDATE` parts (§4.4) adds
`&series={uuid}&part={n}` (lowercase UUID v4 made when the series is created; parts numbered from 1).
A marker is trusted only if re-encoding it from the event's start gives the stored rule or date list
(§4.5). Keys appear in this order: `v`, `system`, `kind`, the rule's keys, `end`, `series`, `part`.

The `X-THIRTEEN-RULE` value is TEXT (RFC 5545 §3.8.8.2: an `X-` property's default value type), and
other apps write it back TEXT-escaped: Google Calendar's export and EventKit's iCalendar text both give
`X-THIRTEEN-RULE;VERSION=1:SYSTEM=ifc\;KIND=monthly\;DAY=12` (phase 0, §8.2). The `.ics` reader therefore
unescapes the value (`\;`, `\,`, `\\`, `\n` and `\N`) before it reaches `parseThirteenRuleText`
(`IcsEvent.thirteenRule`, §5.4), so the marker step of recognition (§4.5) still matches after a round trip
through Google or Apple. Thirteen goes on writing the value unescaped, as above (both apps kept it), and an
untouched marker line is written back as read (§4.9). The Android URI is not affected.

On Android, a copy of one occurrence that had to be stored as a separate event (the fallback of §4.4)
carries `thirteen://detached?v=1&series={_SYNC_ID or _ID of the series}&original={yyyy-MM-dd}` instead,
so "future events" operations, Undo and the details view find it. Every operation of §4.7 that removes or
moves the occurrences on or after a date also deletes the detached copies whose `original` is on or after
that date, or re-points the carried ones to the new series (`series=` of the new series' first part).

### 4.4 Storage per platform

| Rule | Apple (EventKit) | Android (Calendar Provider) | Windows and web (store, export) |
|---|---|---|---|
| Gregorian preset or Custom | one `EKRecurrenceRule`, mapped field by field (§6.2) | `RRULE` text (`formatRRule`) | `RRULE` |
| 13-month, form (a) | `EKRecurrenceRule(recurrenceWith: .yearly, interval: 1, end:)` | `RRULE:FREQ=YEARLY` + marker URI | `RRULE:FREQ=YEARLY` + `X-THIRTEEN-RULE` |
| 13-month, form (b) | `EKRecurrenceRule(.yearly, interval: 1, daysOfTheWeek: nil, daysOfTheMonth: nil, monthsOfTheYear: nil, weeksOfTheYear: nil, daysOfTheYear: list, setPositions: nil, end:)` | a 13-month row picked in the repeat picker on Android: form (d), `RDATE` parts + marker URI. A recognized `BYYEARDAY` series read from the provider (made on an Apple device) stays form (b) for every change that is not a picker choice (§4.9 rule 3): untouched `RRULE`, `RDATE` and `EXDATE` text when the recurrence is unchanged; a re-derived `BYYEARDAY` list when the start moves to another day; the same `RRULE` with `COUNT` or `UNTIL` for a new end; `BYYEARDAY` `RRULE`s for both the head and the tail of a split. Thirteen self-expands it (§6.3). While the fallback of gate V2's Android leg is in force (§8.2), Android changes only the alerts of such a series (§3.5), so none of these writes happens until that leg passes | `RRULE:FREQ=YEARLY;BYYEARDAY=list` + `X-THIRTEEN-RULE` |
| 13-month, form (c) | `EKRecurrenceRule(.yearly, interval: 4, end: EKRecurrenceEnd(end: cap))` | `RRULE:FREQ=YEARLY;INTERVAL=4;UNTIL=cap` + marker URI | same `RRULE` + `X-THIRTEEN-RULE` |
| Ends | `EKRecurrenceEnd(occurrenceCount:)` / `(end:)` with the instant 23:59:59 of the until day in the event's zone (the device zone for a floating event) | `COUNT=` or `UNTIL=`, the value from core's `formatUntil` (§5.2): a date for all-day; for timed, 23:59:59 of the until day in the event's zone converted to UTC, `yyyyMMdd'T'HHmmss'Z'`; never both | same as Android (`formatUntil`); a floating event writes a floating `UNTIL` (`yyyyMMdd'T'235959`) |
| Removed occurrence | `remove(_:span: .thisEvent)` | `RRULE` series: exception row with `STATUS = CANCELED`; `RDATE` series: date added to the holding part's `EXDATE`, or, when the occurrence already has an exception row, `STATUS = CANCELED` on that row (deleting the row would bring the occurrence back); a detached copy (§4.3) is deleted, its date already being in `EXDATE`. An extra date with its own time is excluded at that time (the `EXDATE` value, and `ORIGINAL_INSTANCE_TIME`, carry its own minute) | `EXDATE` (at the extra date's own time when it has one) |
| Changed occurrence | `save(_:span: .thisEvent)` | exception row through `CONTENT_EXCEPTION_URI`, for `RRULE` and `RDATE` series alike (the provider treats an event with `RDATE` as recurring; `ProviderRecurrenceTest` and gate V3 confirm). Only if that fails: date added to `EXDATE` + a new single event carrying the `thirteen://detached` marker (§4.3 e). V3 is not run for now (owner, §8.2), so on `RDATE` series this fallback is what ships until V3 passes; `RRULE` series keep the exception row | override `VEVENT` with `RECURRENCE-ID` |
| Start time, zone or all-day of the series changed (first occurrence, all events) | EventKit's business (the series is saved in place) | `DTSTART` updated; every `EXDATE` value and every `RDATE` value without a time of its own rewritten at the new time on the same date, `RDATE` and `EXDATE` values with their own time shifted by the same number of minutes, every exception row's `ORIGINAL_INSTANCE_TIME` rewritten the same way, and the `UNTIL` of every `RRULE` and `EXRULE` rewritten from `retimeExceptions`' `untils` (§4.7): the end of its until end date (`untilEndDate` with the old start minute, §4.5) in the event's zone, through `formatUntil`; an all-day toggle also switches the date-list form (dates `20261019` or `TZID;` date-times; UTC date-times while the V10 fallback is in force, below) and sets `ORIGINAL_ALL_DAY` on every exception row | every `RECURRENCE-ID`, `EXDATE` and `RDATE` value rewritten likewise, and every `RRULE` and `EXRULE` `UNTIL` rewritten from `untils` the same way (only the `UNTIL=` part of the rule text changes); an all-day toggle switches them between `VALUE=DATE` and date-times, `UNTIL` included (a date for an all-day series, UTC for a zoned one, floating for a floating one) |

**Why Android differs.** The researchers compiled AOSP's `calendarcommon2` (`RecurrenceProcessor`, the
code that fills `Instances`) and ran it on 2026-10-19 (a scratch harness outside the repo; the Android
team turns it into the instrumented test `ProviderRecurrenceTest`, §6.3): `FREQ=YEARLY;BYYEARDAY=...`
produced only the start's anniversary each year, and `FREQ=DAILY;BYYEARDAY=...` produced wrong days, while
`RDATE` lists, `RRULE` + `RDATE` unions, `EXDATE` and `FREQ=YEARLY;INTERVAL=4` expanded correctly
(including 1800, 2100 and 2400). Instances drive Android's alarms and every other Android calendar app, so
an exact date list is the only form that keeps alerts and other apps right.

**Android 11 and older (API 26 to 30).** That harness ran today's `calendarcommon2`, which has its own
`Time` class. On Android 11 and earlier the provider's `CalendarInstancesHelper` and `RecurrenceProcessor`
use `android.text.format.Time` (android11-release sources; android12-release switched), whose arithmetic
is 32-bit and documented as reliable only from 1902 to 2037. Thirteen reads every event from `Instances`
and lets users browse years 1 to 9999, so on API 30 and lower it:

- writes `RDATE` lists only up to 2037-12-31 (from 2028 on this is shorter than the normal horizon; top-up
  still extends a list up to that date, and a newer device's Thirteen tops it up further);
- reads any year window that reaches outside 1902-01-01 to 2037-12-31 from `Events` (`deleted = 0`), not
  from `Instances`, and expands every event in it with the core expander, merging exception rows exactly
  as for `BYYEARDAY` series (§6.3). A recognized form (d) series stored in parts is expanded **once per
  series id**: the rule recognized from part 1 (its start and the marker's end), with the `EXDATE` values
  of every part as excluded dates and the exception rows of every part as overrides; the other parts are
  not expanded on their own, because each of them, recognized alone with the marker's end, would give
  the rule's later dates again. So a two-part weekly series viewed in 2040 shows each date once, and an
  open-ended series goes on past the 2037 cap of the stored list. A part without a recognized marker is
  expanded from its stored dates (a `dates` recurrence: `DTSTART`, `RDATE`, minus `EXDATE`);
- applies the same two rules on newer API levels if gate V12 shows the provider failing there.

**Android horizon.** For a 13-month rule in form (d) with end Never, Thirteen writes dates through
December 31 of: current year + 10 (monthly, yearly, intercalary), + 3 (weekly), + 5 (every 2 weeks),
capped at 9999-12-31 (and at 2037-12-31 on API 30 and lower, above). With an end (count or until) it
writes exactly the dates up to the end; "After" allows 1 to 999 times as everywhere.

**Parts.** One event's `RDATE` column holds at most **210 values** (`maxValues: 210` for
`thirteenRuleRdateParts`; core's default and the fixture cases stay at 400). v3.2 planned 400, to be
confirmed by V10. V10 is not run (owner, §8.2), so its "smaller parts" fallback ships, with the size
taken from phase 0: Google Calendar's web import refused every event with more than about 4,096
characters of `RDATE` text (254 timed `TZID=Europe/Tallinn` values, 4,089 characters, were accepted; 255,
4,105 characters, were refused; splitting the values over several `RDATE` lines did not help; 400 all-day
values, 3,616 characters, were accepted). A timed value in the UTC form that Android writes while the V10
fallback holds (below) takes 17 characters, so 210 values are about 3,600 characters, which leaves room
for the part's `EXDATE` values; and 210 still holds a new weekly series' 208 dates through its 3-year
horizon (above) in one part. The same size applies to all-day and timed series, so an all-day toggle
never re-cuts parts, and it stays 210 if V10 passes later: the cut must be the same on every device and
version (duplicate parts, below). A longer list is
stored as consecutive **parts**, each a separate event with the same fields: part 1 starts at the series
start, part k+1 at the occurrence after part k's last date, and every part's marker URI carries the same
`series` id and its `part` number (§4.3 e). The split is deterministic (`thirteenRuleRdateParts`, §5.2:
`1 + maxValues` occurrences per part, so positions 1 to 211 in part 1, 212 to 422 in part 2, and so on,
counting excluded dates), so parts never need rewriting except the last, which grows. A weekly series
started in January 2026 fits one part through its 2029 horizon and gets a second part in about 2028,
when top-up extends it to 2031. (With core's default of 400, a weekly series started in 2020 is created
as two parts and gets a third once its horizon reaches 2035: the `thirteenRules` `parts` case, 400, 400
and 29 dates, the earlier parts unchanged.) Thirteen shows the parts as one
series (§3.2), and every operation on "the series" applies to all parts in one `applyBatch` (§4.7).

**Top-up.** When Thirteen starts or returns to the foreground and has write access, it tops up every
writable, recognized form (d) series whose marker says `end=never`, that has no invitees, and whose last
date is less than half the horizon away: it extends the last part through the full horizon, and adds
parts when the last one is full (one `applyBatch` per series, at most 50 series per start).

**Duplicate parts.** Two devices on one account (a phone and a tablet) can top up the same series before
sync carries the other's change, and both insert part n+1. Rows with the same series id and part number
are duplicates: Thirteen shows only one, chosen the same way on every device (a row with `_SYNC_ID` over
one without; between two synced rows, the smaller `_SYNC_ID` in code-point order; between two unsynced
rows, the lower `_ID`), and the next top-up run deletes the others (on every start with write access,
whether or not the series needs more dates). The parts carry the same `RDATE`s (the split is
deterministic), but not necessarily the same exceptions: a device that was offline, or whose sync lagged,
may have deleted or edited an occurrence in its own copy. So before a duplicate is deleted, in the same
`applyBatch` per series: its `EXDATE` values are added to the kept part's `EXDATE` (a union, through
`DateList`), and each of its exception rows is re-inserted as an exception of the kept part (as moves do,
§4.7). Where both copies have a row for the same `ORIGINAL_INSTANCE_TIME`, the newer one is kept: a row
with `DIRTY = 1` (changed on this device and not yet synced) over a synced one, otherwise the kept part's
own row. Only then is the duplicate deleted with its exception rows. Without the
marker (the event came from another Android device whose `CUSTOM_APP_*` columns did not sync, verification
V9), each part is shown as its own series with its last date as its end ("Every IFC month on the 12th,
until December 12, 2036") and the user can set the end back to Never.

`RDATE` and `EXDATE` text formats, parsed and written only through core's `parseDateList` and
`formatDateList` (§5.2, fixture section `dateLists`): all-day `20261019,20261116,...` (`EVENT_TIMEZONE` =
`UTC`); timed `Europe/Tallinn;20261116T190000,20261214T190000,...` (the event's zone and wall-clock time;
the provider's `TZID;` prefix form). Verification V10 checks that Google's sync adapter keeps it; the
fallback is the UTC form `20261116T170000Z,...` computed per date. V10 is not run for now (owner, §8.2),
so Android writes timed lists in the UTC form until V10 passes (`formatDateList(values, 'utc')`, each
value the occurrence's instant through `zonedToUtc` in the event's zone); all-day lists keep the date
form. The reader also accepts the `TZID;` form and comma lists of mixed forms as Google writes them back.
Phase 0 found Google keeping the `TZID` form through its web import, a web edit and its export (one
`RDATE;TZID=Europe/Tallinn:` property per value, never rewritten to UTC), but that is evidence only: the
UTC form stays until V10's Android leg passes.

**Windows and web** always store form (a), (b) or (c), never (d). Export writes the stored text.
Verification V11 decides whether exports should instead write form (d) for compatibility; the encoder
supports both, so the switch is one line in each exporter. Phase 0 makes form (d) an unlikely fix: Google
Calendar's web import kept form (b) and showed the right days, EventKit's own `.ics` importer kept only
the first date of a date list, and Google's import refuses a date list longer than about 4,096 characters
(a weekly list over a 10-year horizon is about twice that), so V11's failure column changed (§8.2).

### 4.5 Recognition

When reading an event, every platform runs `recognizeRecurrence` (§5.2) to turn stored data back into a
`ThirteenRule`, a Gregorian preset, an editable custom rule or a preserved foreign rule. Inputs, all in
the event's zone: the start (date and minute), every parsed `RRULE` and `EXRULE` with its `UNTIL`
converted to the event's zone (`untilInZone`, §5.2), the `RDATE` values (dates, with their own time or
duration where it differs from the master's), the `EXDATE` values (dates, with their own minute where it
differs from the master's start minute, `OriginalDate`, §5.2), and the marker text if any.

**`UNTIL` is an instant.** RFC 5545 defines `UNTIL` as the last moment an occurrence may start. Core turns
it into the end date `untilEndDate(until, startMinute)`: the until's date when the start minute is at or
before the until's minute, else the day before. `UNTIL=20261116T165959Z` on a 19:00 Tallinn weekly event
is 18:59 local on November 16, before the 19:00 start, so its end date is November 15, the last date
whose occurrence can start by then; the Monday series therefore ends with November 9, as Apple, Google
and `ical.js` do, and a split written that way never shows November 16 twice. A date-only `UNTIL`
includes its whole day.

Steps, first match wins:

1. **Marker.** If a marker parses and either its encoding from the start equals the single `RRULE`
   (compared with `rruleEquals`, ignoring `COUNT`, `UNTIL` and `WKST`), or (Android) the stored dates are
   a **prefix** of the rule's dates: `{start} ∪ RDATE ∪ EXDATE` equals the rule's dates from the start up
   to the latest stored date, `thirteenRuleRdates(rule, start, until(latest), latest)` plus the start,
   with no value limit. A list written under an older horizon, or one part of a series stored in parts,
   is therefore still recognized after January 1 (fixtures cover both). The rule is the marker's. The end
   comes from `COUNT` / `UNTIL` (an `RRULE`'s `RDATE`s stay as extra dates), or, for a date list, from
   the marker's `end` on Android and until the latest stored date for an `X-THIRTEEN-RULE`. A leap-only
   marker (IFC Leap Day, Positivist Holy Women) is trusted only when that end is on or before its cap, as
   in step 3: a stored `FREQ=YEARLY;INTERVAL=4` whose `UNTIL` another app moved past the cap produces
   2100-06-17, so it falls through to a Gregorian rule (step 4) that expands like the stored text, and a
   list of Leap Days past the cap is not a prefix of the rule (its dates end at the cap), so it falls
   through to step 5.
2. **Day-of-year list.** One `RRULE` with `FREQ=YEARLY`, interval 1, only `BYYEARDAY` (plus optional
   `COUNT`, `UNTIL`, `WKST`), and no `RDATE` or `EXRULE`: build the candidates from the start date (monthly on its month day, weekly on its weekday with
   interval 1 and 2, yearly on its date, or its intercalary day), in the preferred system first, then the
   other; the first candidate whose form (b) list equals the `BYYEARDAY` set (order and duplicates
   ignored) wins. A single positive value up to 168 matches in both systems; the preferred one is used
   and the other goes into `alternatives`.
3. **Leap interval.** `FREQ=YEARLY;INTERVAL=4`, no BY parts and no `RDATE`, start on June 17 of a leap
   year (IFC Leap Day) or December 31 of a leap year (Positivist Holy Women), and an end on or before the
   cap (a count fits when its last date, every fourth year from the start, is in the cap's year or
   earlier): the intercalary rule. Without such an end it stays a Gregorian rule (it would hit 2100). An
   `UNTIL` exactly on the cap, which is how Thirteen stores Never (§4.3 c), reads back as end Never, and
   in steps 1 and 3 alike: a leap-only repeat stops at its cap in every expansion (§4.6), so Never and
   `UNTIL={cap}` expand the same, and the editor shows the user's Never with the cap note.
4. **Gregorian.** Any other `RRULE` that the Custom editor can express (FREQ daily to yearly, INTERVAL,
   BYDAY without ordinals for weekly, BYMONTHDAY or one ordinal BYDAY (`2TU`, `-1FR`) or a
   `BYDAY` day kind with `BYSETPOS` (`MO,TU,WE,TH,FR;BYSETPOS=-1`) for monthly, BYMONTH plus the same for
   yearly) is a Gregorian rule; it matches a preset when equal to the preset's minimal or explicit form.
   A plain `FREQ=YEARLY` on a date where form (a) applies also lists the 13-month yearly rule in
   `alternatives`, so details can say "Every year on October 19 (IFC October 12)". `RDATE`s alongside the
   rule are kept as `extraDates` (they are never dropped); a rule with extra dates is `editable: false`
   and is described as "Every week on Monday, and 2 more dates".
5. **Date list.** No `RRULE`, a non-empty `RDATE`: try the step 2 candidates against the dates
   (`{start} ∪ RDATE ∪ EXDATE` equals the candidate's dates up to the latest date, all at the start's
   time). A match is a 13-month rule with end until the latest date. A leap-only candidate matches only
   a list that ends on or before its cap (as in step 1); a list of Leap Days or Holy Women past the cap is
   a plain date list. Otherwise it is a `dates` rule whose dates are `extraDates` (shown as "Repeats on a
   custom schedule", kept as is).
6. **Anything else.** Several `RRULE`s or any `EXRULE`: a `foreign` rule that keeps every rule and is
   expanded as RFC 5545 defines (the union of the rules and `RDATE`s, minus the `EXRULE` expansions and
   `EXDATE`s), `editable: false`. One `RRULE` the Custom editor cannot express (`BYWEEKNO`, several `BYDAY`
   ordinals, hourly frequencies, `RSCALE` other than `GREGORIAN`): an `rrule` rule with `editable: false`.

Whenever `editable` is false, no platform re-encodes or normalizes the stored recurrence: its rule text,
`RDATE`, `EXDATE` and `EXRULE` lines stay as read, and only the operations that must touch them do so,
each with the least change: a removed occurrence adds one `EXDATE` value, a retime rewrites the time part
of the values and the `UNTIL=` part of each rule (§4.9 rule 4), "all events" changes go through
`applyToSeries` (§4.7), and ending the series before an occurrence ("Delete all future events", or a new
repeat chosen from there) gives each rule an end (§4.7). Its rule cannot be carried into a new series,
so it is never split with the rule kept (§2.11 offers "all events" instead).

### 4.6 Expansion

Two layers, both in core:

- `expandRecurrence(recurrence, start, window)` returns the **original dates** of the occurrences (in the
  event's zone) inside a date window, ascending, without duplicates; an occurrence from an extra date with
  its own time or duration carries them. Apple calls it only for the "Next:" line and tests (EventKit
  expands for display).
- `expandSeries(series, window, deviceZone, zones)` (§5.2) is the whole pipeline every self-expanding
  platform uses: Android for series the provider cannot expand (§6.3), Windows and web for everything
  (through `eventsFromCalendar`, §5.4). No platform re-implements any step of it.

`expandSeries`, given a window `[from, to)` in the device's wall clock:

1. **Widen.** Expand over the event-zone dates from `from.date` minus (the longest length in days + 2)
   to `to.date` plus 2, clamped to 0001-01-01 and 9999-12-31, where the longest length is the larger of
   the master's length and the longest `durationMinutes` among the extra dates (a `PERIOD` extra date can
   last longer than the master). This catches an event that started before
   the window and lasts into it (the mockup set's Winter break, December 28, 2026 to January 3, 2027, in
   the 2027 window) and an occurrence whose event-zone date and device date fall in different years
   (01:00 on January 1 in Pacific/Kiritimati is December 31 on a Honolulu device).
2. **Expand** with `expandRecurrence`.
3. **Times.** Each original date gets the master's start minute (or the extra date's own), becomes an
   instant through `zonedToUtc` in the event's zone (floating events: the device's zone), and ends at that
   instant plus the master's exact duration (§3.3: `end` minus `start` as instants, both through that same
   zone, so a floating series measures its length through the device's zone like its start; an extra
   date's own `durationMinutes` when it has one). With `SeriesInput.duration` (a timed `.ics` master whose
   `DURATION` has days, §5.4) each occurrence instead ends its `days` later on its own wall clock in that
   zone, then `minutes` later exactly (RFC 5545 §3.8.5.3). All-day occurrences keep dates and their day
   count.
4. **Overrides** are matched to generated dates by their original date and minute (`RECURRENCE-ID`,
   `ORIGINAL_INSTANCE_TIME` as an `OriginalDate`, §5.2: minute null matches the occurrence at the
   master's start time, a minute matches the extra date with that own time). An own minute that names the
   same instant as an occurrence's start on that date is that occurrence's, which happens only around a
   DST gap: a master at 02:30 on a spring-forward night starts at 03:30, so a `RECURRENCE-ID`, `EXDATE`
   or `ORIGINAL_INSTANCE_TIME` naming that instant (in UTC, or as 03:30 local) matches the 02:30
   occurrence instead of becoming an orphan, and an extra date at that instant is not a second
   occurrence. Excluded dates are read the same way (step 4 of the algorithm below). The match works
   within one date, so a zone that skips a whole day (Pacific/Apia, 2011-12-30) is not covered. Every
   override of the series is passed in, whatever its date: a
   canceled override removes its occurrence; any other override replaces it and is placed at its **own**
   start and end (converted from its own zone). An override whose original date lies outside the widened
   range is checked against the rule for that one date (`expandRecurrence` over `[date, date]`) and placed
   the same way, so an override moved into the window from far outside appears, and one moved out of it
   disappears. An override whose original date the rule does not produce (an orphan,
   possible only in foreign data, §4.7, or a group imported without its master, §2.17) is shown as a
   single event at its own time (unless canceled) and reported in `orphans`; so is a second override of
   an occurrence another override already took, which is not shown. An unsupported recurrence (step 6
   below) shows only the master's first occurrence, its overrides ignored.
5. **Device wall clock.** Convert with `utcToZoned` to the device's zone; drop (and count as
   `outOfRange`) any occurrence whose conversion leaves years 1 to 9999, and any timed occurrence whose
   instant does, on every device, the event's own zone included (§3.1.1: 23:00 on 9999-12-31 in New
   York is dropped on a New York device too). An end after `9999-12-31T24:00` stops there. A timed
   occurrence whose device end falls before its start (a short event across a fall-back hour) ends at
   its start.
6. **Window.** Keep the occurrences that overlap `[from, to)` (a zero-length occurrence: its start lies in
   it), sorted by start, then original date and minute. Each timed occurrence carries its start instant
   (`startUtc`, §5.2) for alert planning (§2.14); all-day ones carry null.

`expandRecurrence` algorithm:

RFC 5545 bounds only the rules: `COUNT` and `UNTIL` limit the dates a rule generates, extra dates
(`RDATE`) are added whatever their date, and `EXDATE` and `EXRULE` subtract from the result (as `ical.js`,
Apple and Google do). So `FREQ=WEEKLY;COUNT=3` plus one `RDATE` has 4 occurrences, and an `RDATE` after
the `UNTIL` is shown.

1. **Rule stream.** `start` is always the first occurrence. Then:
   - `thirteen` rule: for each Gregorian year from `start.year` to 9999, the rule's dates in that year
     (§4.2), ascending, skipping dates up to `start`. A leap-only rule (IFC Leap Day, Positivist Holy
     Women) stops at its leap-interval cap (§4.3 c) whatever its end, as its stored
     `FREQ=YEARLY;INTERVAL=4;UNTIL={cap}` does: "Every Leap Day" from 2024 ends on 2096-06-17, and a
     count longer than the cap allows gives only the dates up to the cap. This holds in every path that
     uses the rule stream: `expandRecurrence`, `expandSeries`, `nextOccurrences` and
     `describeNextOccurrences`, `laterOccurrenceCount` (which therefore returns a number for a
     never-ending leap-only repeat) and the head counts of `splitRecurrence`.
   - `rrule` rule: RFC 5545 §3.3.10 expansion over periods of the rule's frequency starting at the period
     containing `start`, stepping by `INTERVAL` periods. In each period, BY parts expand or limit the
     candidate set in the RFC order BYMONTH, BYWEEKNO, BYYEARDAY, BYMONTHDAY, BYDAY, then BYSETPOS on the
     sorted set. Expand or limit per frequency exactly as RFC 5545's table (page 44):

     | Part | DAILY | WEEKLY | MONTHLY | YEARLY |
     |---|---|---|---|---|
     | BYMONTH | limit | limit | limit | expand |
     | BYWEEKNO | n/a | n/a | n/a | expand |
     | BYYEARDAY | limit (tolerated) | n/a | n/a | expand |
     | BYMONTHDAY | limit | n/a | expand | expand |
     | BYDAY | limit | expand | expand, or limit if BYMONTHDAY | expand, or limit if BYYEARDAY or BYMONTHDAY; ordinals count in the month if BYMONTH, else in the year |

     Without BY parts, WEEKLY uses the start's weekday, MONTHLY its month day, YEARLY its month and day.
     Week periods start on `WKST` (default Monday); BYWEEKNO uses ISO-style weeks with `WKST`.
     Invalid dates (February 30, the 31st of a 30-day month, day-of-year 366 in a common year) are
     skipped, not moved. Candidates before `start` are dropped.
   - `dates` rule: `start` only (its other dates are extra dates, step 3).
   - `foreign` rule: the union of each rule's stream, ascending, without duplicates.
2. **Ends**, applied to the rule stream only. `count`: stop after `count` dates, counting `start` and
   counting dates that step 4 later excludes (RFC: EXDATE applies after COUNT). `until`: stop after the
   last date on or before the end date (from `untilEndDate`, §4.5). A `foreign` rule applies each
   `EndedRule`'s own end to that rule's stream before the union (its `recurrence.end` is `never`).
3. **Extra dates.** Add every `extraDates` value, whatever the ends of step 2. A value whose date and
   start minute (its own, or the master's when it has none) are already produced is not repeated (RFC
   5545: the recurrence set has no duplicates), so an extra date at 15:00 on a day the rule produces at
   09:00 adds a second occurrence that day, as in `ical.js`, Apple and Google.
4. **Exclusions.** Drop each `exceptDates` value from the occurrences with the same date and the same
   start minute (minute null: the master's start minute), so an `EXDATE` at 15:00 removes only that
   day's 15:00 extra date and never the rule's 09:00 occurrence, and every date produced by a `foreign`
   rule's `exrules` (each expanded from `start` with its own end; they produce dates at the master's
   start minute).
5. **Window and range.** Emit dates within `[window.from, window.to]`. The rule stream stops at the
   window's end, the until date, the count or 9999-12-31; extra dates beyond the window are simply not
   emitted. Guards: stop and set `truncated: true` after `limit` (default 10,000) emitted dates, or when
   the iteration has passed 400 x `INTERVAL` Gregorian years beyond the last candidate (or the start)
   without a new one. Every rule's pattern repeats within that span (the
   Gregorian calendar repeats every 400 years), so the guard only stops rules that can never match again,
   while `FREQ=DAILY;BYMONTH=2;BYMONTHDAY=29` (gaps of up to 8 years) keeps going as in Apple, Google and
   `ical.js`. A rule whose month and month-day pairs never exist (`BYMONTH=2;BYMONTHDAY=30`) is detected
   before iterating and returns only `start` with `truncated: true`.
6. **Unsupported input.** `HOURLY`, `MINUTELY`, `SECONDLY`, `BYHOUR`/`BYMINUTE`/`BYSECOND` with more than
   one value or a value different from the start's, `RSCALE` other than `GREGORIAN`, any `SKIP` (also
   `SKIP=OMIT`), or a BY part the table above marks n/a for the rule's frequency (`BYWEEKNO` outside
   `YEARLY`, `BYYEARDAY` in `WEEKLY` or `MONTHLY`, `BYMONTHDAY` in `WEEKLY`): return only `start` (if in
   the window) with `unsupported: true`; the details show "Repeats on a custom schedule".

Overrides are applied by `expandSeries` (its step 4), in core, for every self-expanding platform.

**Caches.** Windows, web and Android's self-expansion cache occurrences per Gregorian year as
`expandSeries` over that year's window (device wall clock, January 1 to the next January 1, or
`9999-12-31T24:00` for 9999). Apple's and Android's provider queries for a year also return events that
cross the year's edges. Either way an occurrence can be in two years' caches, so every view that merges
years (List, Up next, a Month or Week whose bars cross January 1) dedupes by occurrence key (§3.2).

### 4.7 Editing a repeating event

The span choices of §2.11 map to platform operations:

Every operation first re-resolves the occurrence (§3.2); when it cannot be found, nothing is written
(`editor.occurrenceGone`, §2.11). Every write applies only the changed field groups (§4.9).

| User choice | Apple | Android, `RRULE` series | Android, `RDATE` series (in parts) | Windows, web |
|---|---|---|---|---|
| Save for this event only | fetch the occurrence, apply the merged changes, `save(_, span: .thisEvent)` | insert into `CONTENT_EXCEPTION_URI/{id}` with `ORIGINAL_INSTANCE_TIME` and `STATUS = CONFIRMED` (the provider defaults exceptions to TENTATIVE); if the occurrence already is an exception row, update that row's changed columns | the same, on the part that holds the occurrence; only if gate V3 shows the exception path failing for `RDATE` series: add the date to that part's `EXDATE` and insert a single event with the `thirteen://detached` marker, in one `applyBatch` (V3 is not run for now, so this fallback ships until it passes, §4.4, §8.2) | add or replace the override `VEVENT` (`RECURRENCE-ID` in the `DTSTART` form, `SEQUENCE + 1`) |
| Save for future events | `save(_, span: .futureEvents)` on the occurrence (EventKit splits the series when it is not the first; gate V23 records what the new series keeps); for a `COUNT` series, then the count check below | `splitRecurrence` (below): the original's `RRULE` becomes the head; a new event from the occurrence gets the tail (`RRULE`, `EXDATE`) and the carried overrides as its exception rows; the original's exception rows on or after the split are deleted. An Apple-made `BYYEARDAY` series keeps `BYYEARDAY` rules in both (§4.9 rule 3). One `applyBatch`: the new event's exception rows are inserted into `Events` with `ORIGINAL_ID` as a back reference (if the provider refuses that, a second batch through `CONTENT_EXCEPTION_URI/{newId}` follows at once) | `splitRecurrence` on the dates, in one `applyBatch`: the holding part is cut before the occurrence; later parts are deleted with their exception rows; the holding part's exception rows on or after the occurrence are deleted; a new series (new `series` id) starts at the occurrence with its own parts, the carried `EXDATE`s, and the carried overrides re-inserted as its exception rows; detached copies (§4.3) on or after the occurrence are re-pointed to the new series when carried and deleted otherwise | `splitRecurrence`: the master gets the head; a new `VEVENT` (new UID) starts at the occurrence with the tail; carried `EXDATE`s and overrides move to it, their `RECURRENCE-ID`s at the new series' start time |
| Either, on the first occurrence | the whole series, in place | update `Events/{id}`'s changed columns; a new start time, zone or all-day runs `retimeExceptions` (below) | update every part; retime likewise | update the master, keep the UID; retime likewise |
| Save for all events (repeats set in another app, `editable: false`, §2.11) | read the master's own start (the series' first occurrence by its `occurrenceDate`, found by the plus or minus one day lookup of §3.2 around the master's `startDate`); only when that occurrence still exists and is not detached, apply `applyToSeries` (below) to it and `save(_, span: .futureEvents)`; otherwise the span dialog offers only "this event only" (`span.keep.firstGone`), because `.futureEvents` on a later occurrence would split the series and carry the foreign rule to a new start | `applyToSeries` (below), then as on the first occurrence: update `Events/{id}`'s changed columns, and a time of day, zone or all-day change retimes with the options it returns | the same, on every part | `applyToSeries`, then as on the first occurrence |
| Delete this event only | `remove(_, span: .thisEvent)` | exception with `STATUS = CANCELED` (or set it on the existing exception row; deleting the row would bring the occurrence back) | add the date to the holding part's `EXDATE` (an extra date with its own time: at that time); if the occurrence already has an exception row, set `STATUS = CANCELED` on that row instead (the row is a separate event that the provider and Google keep showing); a detached copy is deleted | add `EXDATE` (an extra date with its own time: at that time, so it matches in other apps and never removes the rule's occurrence on the same day), remove an override for that date and minute |
| Delete all future events | `remove(_, span: .futureEvents)` | the head of `splitRecurrence` and deletion of the exception rows on or after the occurrence; delete the event if it is the first occurrence | in one `applyBatch`: cut the holding part, delete later parts (all parts at the first occurrence) with their exception rows, delete the holding part's exception rows and the detached copies on or after the occurrence | the head, dropping overrides on or after the occurrence; or delete the whole group |

**Splitting** (`splitRecurrence(recurrence, start, at, overrideDates, change)`, §5.2, fixture section
`splits`), the same on Android `RRULE` and `RDATE` series, Windows and web:

- Head: the series ends before `at`. With `COUNT`, the head's count is the number of rule dates before
  `at`, counting excluded dates as RFC 5545 counts them; with `UNTIL` or Never, `UNTIL` is the end of the
  day before `at` (§4.4). A `foreign` rule does this for each of its `RRULE`s and `EXRULE`s on that rule's
  own stream (a rule whose own end comes earlier keeps it).
- Extra dates (`RDATE`s): those before `at` stay in the head; those on or after `at` leave it. A series
  with extra dates is split only with a new repeat (next bullet), so they are dropped, and counted
  (below); none is ever in both the head and the tail, so no other app shows one twice.
- Tail end: when the user kept the repeat, a `COUNT` tail gets the original count minus the head's count
  (a 10-time series split at its 4th occurrence keeps 7 more, never 10), and an `UNTIL` tail keeps the
  original until date. When the user chose a new repeat, its own end.
- A series with `editable: false` (a `foreign` or `dates` rule, a rule with extra dates, or a rule the
  Custom editor cannot express, §4.5) has a tail only with a new repeat: its stored rules are anchored on
  its own `DTSTART` and cannot be carried to a new start. `splitRecurrence` throws `RangeError` when asked
  to keep a `foreign` or `dates` rule or a rule with extra dates; the span dialog never asks for that
  (§2.11 offers "all events" for every `editable: false` series). "Delete all future events" needs only
  the head, so it works for every series.
- Exceptions on or after `at` (deleted dates and overrides) carry over to the tail when the tail's rule
  produces the same original date. If only the time changed, they keep their dates and are rewritten at
  the new time. If the start date moved by some days, each is shifted by the same number of days when the
  tail's rule produces the shifted date. Otherwise it is dropped. `SplitResult.droppedCount` counts what
  is dropped (exceptions and extra dates), and the span dialog says so before the user chooses
  (`span.future.exceptionsDropped`, §2.11); nothing is reported after the fact.
- Apple: EventKit splits by itself. Gate V23 records what its new series keeps. Phase 0 recorded it on
  iCloud with macOS 27 (§8.2; iOS and Google calendars are not run yet): removed occurrences (`EXDATE`s)
  are carried; a changed (detached) occurrence after the split point does not stay an exception of the
  new series but becomes a separate event (UID `{new UID}/RID=` and a number), while the new series
  produces the original date again, so that date shows twice; and the new `COUNT` is right when the
  repeat and its end were kept (7 of 10, split at the 4th occurrence). So Apple's span dialog for "future
  events" adds `span.future.exceptionsLost` when a changed occurrence comes after the occurrence (§2.11).
  That warning is the gate's fallback: Thirteen does not move or delete the separated event, and shows it
  as the event it now is. **Count check:** after
  a "future events" save of a `COUNT` series, Thirteen re-reads the new series (by the identifier
  EventKit returns, §3.2) and compares it with what the user chose in that save. When the repeat and its
  end were kept, the expected count is the original count minus the head's; when the user chose another
  end (After 3 times, an end date, Never) or another repeat, the expected end is that choice. Only when
  the new series differs from the expected end does Thirteen set it as the `recurrenceEnd` and save once
  more with `.futureEvents` from its first occurrence (a second update to invitees, so it happens only
  when EventKit got it wrong). A new series with **no recurrence rule** differs too: when the user chose
  another count, EventKit wrote that count minus the head's count, so After 3 times at the 4th
  occurrence (3 minus 3) left the new series without a rule (phase 0). Thirteen then sets the rule the
  user chose, with that end, as the new series' `recurrenceRules` and saves once more the same way. EventKit accepted that save
  (`COUNT=3`, the removed occurrence kept), so "future events" on `COUNT` series stays offered from every
  occurrence. `EventKitRoundTripTests` cover a `COUNT=10` series split at its 4th
  occurrence with the repeat kept (7 remain, no second save) and with End repeat changed to After 3 times
  (3 remain after the count check; on iCloud phase 0 saw no rule and a second save, and the test records
  in `docs/events-verification/apple.md` whether the simulator's local store needed the second save).

**Applying a change to the whole series** (`applyToSeries(master, opened, edited, override)`, §5.2,
fixture section `seriesEdits`) is how "Save for all events" (`editable: false` series, §2.11) works on
every platform. The edited occurrence is not the series' first one, so its time group cannot be copied
to the master as it is (its start carries the occurrence's date, and a foreign rule is anchored on the
master's own `DTSTART`):

- The master keeps its own start date. It takes the edited occurrence's start minute as an absolute
  wall-clock time (never a delta from the opened occurrence, which may be an override with a time of its
  own), the edited length (minutes for timed events, days for all-day), the all-day setting and the
  zone. When the user did not change the time group (`edited` equals `opened` there), the master's time
  group is not touched.
- Every other group the user changed (title, location, notes, URL, calendar, alerts, show as) is taken
  from `edited`; groups the user did not change keep the master's current values (`mergeDraft`).
- When the edited occurrence is an override (`override` not null), the same changed groups are applied
  to that override too, its time group as the edited occurrence's own date and time, so the occurrence
  the user edited shows the change; every other override keeps its own values, as in Apple Calendar.
- It returns the merged master, the merged override (or null), the written groups, and the
  `retimeExceptions` options of the change (`minuteDelta`: the new start minute minus the master's old
  one; `allDay` when the setting flipped; null when the time group did not change), which every
  platform then applies as for a retime of the first occurrence (below).

On Apple, EventKit has no master object: Thirteen fetches the first occurrence (the master's own
`startDate`, by the lookup of §3.2) and assigns the merged master's written properties to it, then saves
with `.futureEvents`; an edited occurrence that is detached is then saved with `.thisEvent` with the
merged override's written properties. When the first occurrence was removed or detached, EventKit's
earliest occurrence is a later one, and `.futureEvents` there would split the series and carry the
foreign rule to a new start (§4.5), so Apple offers only "this event only" (`span.keep.firstGone`,
§2.11). `EventKitRoundTripTests` cover a time change from the 5th occurrence of a `BYWEEKNO` series (its
first date stays) and a series whose first occurrence was deleted (only "this event only").

**Retiming** (`retimeExceptions(recurrence, overrideDates, oldStart, newStart, newRecurrence, options)`,
fixture section `retimes`): when the first occurrence (the whole series) gets a new start time, zone or
all-day setting, every `RECURRENCE-ID`, `ORIGINAL_INSTANCE_TIME` and `EXDATE` value at the series' time,
and every `RDATE` value without a time of its own, is rewritten at the new time on the same original
date, so other apps keep matching them. An extra date with its own time (`ExtraDate.minute` not null),
and an `EXDATE` value or override original that carries its own minute (`OriginalDate.minute`), is
shifted by the same number of minutes as the start instead (`options.minuteDelta`; its date moves when
it crosses midnight), so it keeps its distance from the series' time and goes on matching its extra
date. An all-day toggle (`options.allDay`) changes the value
type, which RFC 5545 requires `RECURRENCE-ID` and `EXDATE` to match: to all-day, every value becomes
its date (`VALUE=DATE`; Android: the date-list form `20261019`, and `ORIGINAL_ALL_DAY = 1` on every
exception row) and extra dates lose their own times (an extra date that then falls on a date the rule
produces is dropped and counted); to timed, every value gets the new start time
(Android: the `TZID;` form, or the UTC form while the V10 fallback is in force, §4.4;
`ORIGINAL_ALL_DAY = 0`). When the start date moves, exceptions shift by the
same number of days where the new rule produces the shifted date, and are dropped otherwise (counted in
`droppedCount` and shown in the editor at once, §2.11). Thirteen never stores an override, exception row
or `EXDATE` that its rule does not produce.

**`UNTIL` is retimed too**, on every platform and for every stored `RRULE` and `EXRULE`, `foreign` and
`editable: false` rules included. An `UNTIL` is an instant (§4.5): left as it was, an `UNTIL` written at
the last occurrence's start (Outlook writes `UNTIL=20261116T170000Z` for a 19:00 Tallinn series) drops
that occurrence once the series moves to 19:30, and an all-day toggle would leave a date-time `UNTIL`
beside `DTSTART;VALUE=DATE`, which RFC 5545 forbids. So `retimeExceptions` returns `untils`: for each
rule with an `UNTIL`, in stored order, its until end date (`untilEndDate` computed with the **old** start
minute, which is the date recognition already holds, §4.5). Every platform writes that rule's `UNTIL` as
the end of that date in the event's zone with `formatUntil` (§5.2): a date for an all-day series, the
UTC instant of 23:59:59 for a zoned one, a floating 23:59:59 for a floating one. The last occurrence is
therefore kept at the new time, and only the `UNTIL=` part of the rule text changes (§4.9 rule 4).

Other rules:

- Changing the rule, its end, or the start of the first occurrence always uses "future events". On an
  `editable: false` series, a new time of day or zone uses "all events" (the series in place through
  `applyToSeries`, retimed),
  and a new repeat chosen on a later occurrence ends the stored rules before it (the head, above) and
  starts a new series with the new repeat.
- On Apple, when the user turns an occurrence of a repeating iCloud event into an all-day event, save it
  timed with `.thisEvent` first, then set `isAllDay` and save again (research Apple §8).
- **Moving to a calendar in another account** (the editor's Calendar field):
  - Events with invitees never move between accounts (§3.5); the picker shows other accounts disabled.
  - Apple tries `save` with the new calendar, which keeps EventKit's exceptions. If it fails with an
    access error (the iOS 18.4+ `EKCADErrorDomain 1013` regression, V5): a non-repeating event is copied to
    the new calendar and the original removed, after `move.confirm` ("Move {title} to {calendar}? It will
    be copied there and removed from {old calendar}.", "Move", "Cancel"); a repeating event is not copied,
    because EventKit cannot recreate removed occurrences and a copy would bring them back. The alert
    `move.repeating` explains it and offers "Duplicate" (an unsaved non-repeating copy, §2.10) and
    "Cancel".
  - Android always moves across accounts by copy then delete (`CALENDAR_ID` cannot change between
    accounts with sync adapters), in one `applyBatch`: insert the copy with the original's recurrence text
    unchanged (and every part of an `RDATE` series), re-insert each exception row (changed and canceled)
    as an exception of the copy (as for splits above), then delete the original. After `move.confirm`.
- Apple's `exceptDates` and overrides are EventKit's business; Thirteen never reconstructs them.

### 4.8 What other apps show

Expected behaviour; every "verify" is a gate in §8.2.

| Created by | Stored in | Apple Calendar | Google Calendar web | Google Calendar and other apps on Android | Outlook | Thirteen elsewhere |
|---|---|---|---|---|---|---|
| Thirteen on Apple, 13-month form (b) | iCloud | right days (verify V1; phase 0: right days through EventKit on a Mac, 2026 to 2030) | not applicable | not applicable (no iCloud sync on Android without DAVx5; with it, wrong days) | not applicable | right days |
| Thirteen on Apple, form (b) | Google calendar (CalDAV) | right days | verify V2 (phase 0, the same rule imported from an `.ics`: right days; its editor calls the repeat "Unsupported recurrence") | wrong days: the provider ignores BYYEARDAY (Thirteen for Android expands it itself and shows the right days, with the note of §2.10) | not applicable | right days |
| Thirteen on Apple, form (b) | Exchange | not offered | | | | |
| Thirteen on Android, form (d) | Google calendar | verify V3 (`RDATE` via CalDAV; phase 0: EventKit's own `.ics` importer keeps only the first date) | right days (Google supports RDATE; phase 0: right days, its editor says "Does not repeat") | right days | not applicable | right days on Android; on Apple per V3 |
| Thirteen on any platform, forms (a) and (c) | any | right days | right days | right days | right days | right days |
| Windows or web export, form (b) | `.ics` file | verify V11 | right days (phase 0, a file from core's writer; V11 confirms) | not applicable | not supported (BYYEARDAY is not an Outlook template) | right days |

When Thirteen reads a series it cannot fully represent (Apple reading an Android `RDATE` series if EventKit
exposes only its occurrences), it shows the occurrences EventKit returns and treats each as editable with
"this event only".

Google Calendar on the web, as phase 0 found it (§8.2): its editor calls a `BYYEARDAY` repeat
"Unsupported recurrence" and a date list "Does not repeat", yet "This event" and "All events" title edits
there kept the `RRULE`, `RDATE` and `X-THIRTEEN-RULE` lines byte for byte. Google writes each `RDATE`
value as a property of its own, may reorder rule parts (`FREQ=YEARLY;UNTIL=20960617;INTERVAL=4`) and
TEXT-escapes the marker (§4.3 e); a "This event" edit there is an override `VEVENT` with the series'
`UID`, `RECURRENCE-ID;TZID=...`, `SEQUENCE:0` and no marker. Readers therefore compare rules with
`rruleEquals` (§4.5) and take the marker from the master only.

An iPhone-made form (b) series edited on Android keeps a `BYYEARDAY` rule whatever changes (title, alert,
location, time, a new start date or end, either half of a split, a drag; §4.9 rule 3), so Apple devices
go on showing every date. Only a new 13-month choice in the repeat picker turns it into a list of dates,
with the note of §2.13. Until gate V2's Android leg is run (§8.2), its fallback holds instead: Android
changes only the alerts of such a series (§3.5).

### 4.9 Writing back what was read

Every platform, every save path (editor, drag, undo, import merge, top-up, span operations):

1. **Only changed field groups are written** (`mergeDraft`, §5.2). Apple assigns only the changed
   `EKEvent` properties; Android's `ContentValues` contain only the changed columns; Windows and web
   re-serialize only the touched UID group, and inside it keep every property of an untouched field group
   as read.
2. **An unchanged recurrence is written back exactly as it was read.** The recurrence counts as unchanged
   when the rule, its end, the extra dates, the excluded dates and the start date, time and zone are all
   unchanged. Then Apple never assigns `recurrenceRules`; Android leaves `RRULE`, `RDATE`, `EXDATE`,
   `EXRULE` and the `CUSTOM_APP_*` marker columns out of the update; Windows and web keep those property
   lines byte for byte. The event's length is not part of the recurrence: on Android `DURATION` (and the
   switch between `DTEND` and `DURATION`) belongs to the time group and is written, with the exact length
   of §3.3, whenever the master's start or end changes, so a new end time "for all events" or a resize
   of the first occurrence is saved while `RRULE`, `RDATE` and `EXDATE` stay byte for byte. In particular
   a title edit of an Apple-made `BYYEARDAY` series on Android keeps its `RRULE` byte for byte (a
   `ProviderRepositoryTest` case), and saving "for all events" from its first occurrence does too.
3. **Re-encoding happens only on an explicit choice in the repeat picker.** Android writes form (d) only
   when the user picks a 13-month row that is stored as a list of dates (§2.13), with
   `repeat.note.androidReencode` when the series was an Apple-made `BYYEARDAY` rule. Every other change
   to a recognized `BYYEARDAY` series keeps form (b), and Thirteen keeps self-expanding it (§6.3):
   - a start moved to another day (editor or drag): the repeat follows the start
     (`adaptRecurrenceToStart`, §2.11) and is written in the new rule's own `RRULE` encoding
     (`encodeThirteenRule`: a new `BYYEARDAY` list, or form (a) or (c) when the new rule has that form),
     never as `RDATE`s;
   - a new end: the same `RRULE` with `COUNT` or `UNTIL` (§4.4 Ends);
   - "future events": the head is the `RRULE` with its new end, the tail a `BYYEARDAY` `RRULE` from the
     occurrence (with the marker URI, as every 13-month rule Thirteen writes on Android);
   - a time, zone or all-day change: rule 4.
   No drag or editor change other than a picker choice re-encodes, so no drag dialog needs the re-encode
   note. A rule with `editable: false` is never re-encoded unless "Keep" is replaced. While the fallback
   of gate V2's Android leg is in force (§8.2), Android writes nothing but alerts for a series whose
   stored `RRULE` uses `BYYEARDAY` (§3.5); this rule applies once that leg passes.
4. **A changed start time, zone or all-day setting retimes, it does not re-encode**: `retimeExceptions`
   (§4.7) rewrites the time part (or the value type) of every stored `RECURRENCE-ID`, `EXDATE`, `RDATE`
   and `ORIGINAL_INSTANCE_TIME` value, and the `UNTIL` of every `RRULE` and `EXRULE` (from its `untils`,
   through `formatUntil`), on every platform. Every other part of the rule text stays byte for byte
   (`FREQ`, `BY` parts, `INTERVAL`, `WKST`, `COUNT`, the order of the parts), for `foreign` and
   `editable: false` rules too.
5. **Feeds are never rewritten.** Subscription documents are stored as fetched (§3.6).

---

## 5. Shared engine work

### 5.1 Modules

```
packages/core/src/events/            (new; exported from @thirteen/core; zero dependencies; lib ES2022)
  time.ts          LocalDateTime, end-of-day form, wall-clock arithmetic, ZoneResolver, zonedToUtc / utcToZoned,
                   UNTIL conversion
  model.ts         CalendarInfo, EventDraft, CalendarEvent, EventOccurrence, Alarm, validation, defaults,
                   three-way merge, alarm fire times
  rrule.ts         RRule parse / format / equality (RFC 5545 §3.3.10 syntax)
  date-lists.ts    RDATE / EXDATE value lists in the Android provider's text forms (TZID; prefix, UTC, dates)
  thirteen-rules.ts ThirteenRule, dates, encodings (a) to (d), RDATE parts, marker text, rule from a start
  recurrence.ts    EventRecurrence, expansion, presets, descriptions, recognition, splitting, retiming, adaptation
  rrule-expansion.ts  internal: the RFC 5545 candidate engine recurrence.ts expands RRULEs with (not exported)
  occurrences.ts   expandSeries: the full series pipeline (widened window, overrides, zones, range, window)
  layout.ts        month, week, day, agenda and year layouts of occurrences
  index.ts
packages/core/src/ics/               (new; exported as @thirteen/core/ics; zero dependencies)
  lexer.ts         unfolding, content lines, parameters, escaping
  parse.ts         VCALENDAR / VEVENT / VALARM / VTIMEZONE to model
  serialize.ts     model to text (CRLF, 75-octet folding, deterministic order; untouched raw groups copied as read)
  groups.ts        UID groups, versions, import baselines, zone merging and renaming, new calendars, all-day
                   ends, retimed UNTILs
  events.ts        occurrences of a calendar (eventsFromCalendar, expandCalendar) and recognition input
  zones.ts         VTIMEZONE evaluation and generation, Windows zone ids to IANA (CLDR table); ZoneResolver
                   itself lives in events/time.ts
  windows-zones.ts the CLDR windowsZones table, generated by scripts/windows-zones.ts (Unicode License v3)
  types.ts, values.ts, colors.ts, sha256.ts   model types and internal helpers
  index.ts
packages/core/scripts/events-fixtures.ts, recurrence-fixtures.ts, layout-fixtures.ts   (new) the sections of
                                           fixtures/events.json, assembled by events-file.ts (new)
packages/core/scripts/zone-resolvers.ts    (new) the Node Intl, synthetic, recording and recorded zone resolvers
packages/core/scripts/ics-*.ts             (new) fixtures/ics: cases, scenarios, JSON forms, and the reference
                                           import and restore merges (ics-procedures.ts, §5.6)
packages/core/scripts/mockup-events.ts     (new) builds fixtures/mockup/mockup-events.json (§6.7)
packages/core/scripts/generate-fixtures.ts (changed) also writes the new files
packages/core/test/events/*.test.ts, test/ics/*.test.ts   (new) unit, oracle and staleness tests
```

Ports (same functions, same fixture results; the `ics` module only where it is used):

| Module | Swift (`apple/ThirteenKit`) | Kotlin (`android/core`) | C# (`windows/Thirteen.Core`) |
|---|---|---|---|
| events | `Sources/ThirteenKit/Events/` | `core/events/` (package `com.haugas.thirteen.core.events`) | `Events/` (namespace `Thirteen.Core.Events`) |
| ics | not ported | not ported | `Ics/` (namespace `Thirteen.Core.Ics`) |
| fixtures tests | `Tests/ThirteenKitTests/EventsFixtureParityTests.swift` | `src/test/.../events/EventsFixtureParityTest.kt` | `Thirteen.Core.Tests/EventsFixtureParityTests.cs`, `IcsConformanceTests.cs` |

`docs/SPEC.md` gets a new §7 "Events" pointing here, and `packages/core/API.md` lists the new API (Core
team, §6.1).

### 5.2 API (TypeScript, normative)

Conventions of SPEC §4.1 apply: plain data, fresh results, `RangeError` on invalid input, `systemId` last
before an options bag. JSON names in fixtures equal these field names.

```ts
// ---------- events/time.ts
export interface LocalDateTime { readonly date: GregorianDate; readonly minute: number }
export function localDateTime(date: GregorianDate, minute: number): LocalDateTime;  // 0...1440, else RangeError
export function parseLocalDateTime(text: string): LocalDateTime;                     // '2026-10-19T09:30', 'T24:00' allowed; strict
export function tryParseLocalDateTime(text: string): LocalDateTime | null;
export function formatLocalDateTime(value: LocalDateTime): string;                   // 'YYYY-MM-DDTHH:MM'
export function compareLocalDateTime(a: LocalDateTime, b: LocalDateTime): -1 | 0 | 1; // D T24:00 == D+1 T00:00
export function addMinutesLocal(value: LocalDateTime, minutes: number): LocalDateTime; // wall clock; never returns 24:00
export function diffMinutesLocal(a: LocalDateTime, b: LocalDateTime): number;        // a - b, wall clock
export function normalizeEventEnd(start: LocalDateTime, end: LocalDateTime): LocalDateTime; // §3.1.1; RangeError if end < start
export function displayEnd(end: LocalDateTime): LocalDateTime;                       // D T24:00 -> D+1 T00:00 for pickers (§2.12)
export function occurrenceDays(start: LocalDateTime, end: LocalDateTime): GregorianDate[];   // inclusive

/** Implemented per platform (Foundation TimeZone, java.time ZoneRules, TimeZoneInfo.GetUtcOffset, Intl). Answers
 *  only offsets; every conversion rule lives in core. */
export interface ZoneResolver {
  isKnown(tzid: string): boolean;
  offsetMinutesAt(tzid: string, utc: LocalDateTime): number;       // UTC offset in force at a UTC instant
}
/** Wall clock in `zone` to UTC, with the gap and overlap rule of §3.3. null when the result leaves years 1 to 9999. */
export function zonedToUtc(local: LocalDateTime, zone: string, zones: ZoneResolver): LocalDateTime | null;
export function utcToZoned(utc: LocalDateTime, zone: string, zones: ZoneResolver): LocalDateTime | null;

// ---------- events/model.ts  (types of §3.1, plus:)
export type DraftIssue =
  | 'end-before-start' | 'out-of-range' | 'until-before-start' | 'calendar-read-only' | 'thirteen-repeat-not-allowed'
  | 'too-many-alarms' | 'repeat-not-on-start' | 'invalid-url' | 'count-out-of-range';
export function validateDraft(draft: EventDraft, calendar: CalendarInfo): DraftIssue[];      // [] = valid, issues in this order
export function newEventDraft(day: GregorianDate, now: LocalDateTime, calendarId: string,
                              options?: { allDay?: boolean; timeZone?: string | null }): EventDraft; // §2.11 defaults
export type RepeatChange = 'none' | 'adapted' | 'converted' | 'dropped';                    // §2.11 table
export function moveDraftStart(draft: EventDraft, start: LocalDateTime, systemId?: CalendarSystemId):
  { draft: EventDraft; repeatChange: RepeatChange };                                         // keeps duration, adapts repeat
export function setDraftAllDay(draft: EventDraft, allDay: boolean,
                               options?: { previousTimes?: { start: number; end: number }; availabilityTouched?: boolean;
                                           timeZone?: string | null }): EventDraft;
                                 // all-day: Free unless touched (§2.11). Turning all-day off: the zone is timeZone (the
                                 // device zone for a new event, the zone before all-day for an existing one; none: floating)
export type DraftField = 'title' | 'location' | 'notes' | 'url' | 'time' | 'recurrence' | 'calendar' | 'alarms' | 'availability';
export function changedFields(a: EventDraft, b: EventDraft): DraftField[];                   // 'time' = allDay, start, end, timeZone
/** Three-way merge (§2.11, §4.9): the groups where `edited` differs from `original` are taken from `edited`, the rest from `current`. */
export function mergeDraft(original: EventDraft, edited: EventDraft, current: EventDraft):
  { merged: EventDraft; written: DraftField[]; conflicts: DraftField[] };                     // conflicts: changed on both sides
/** "Save for all events" (§4.7): the changes made on one occurrence (`opened` -> `edited`) applied to the series `master`
 *  (fetched now) without taking the occurrence's date; `override`: the edited occurrence's stored override, or null. */
export function applyToSeries(master: EventDraft, opened: EventDraft, edited: EventDraft, override: EventDraft | null):
  { master: EventDraft; override: EventDraft | null; written: DraftField[];
    retime: { minuteDelta: number; allDay: 'to-all-day' | 'to-timed' | null } | null };       // null: time group unchanged
/** When an alert fires, as a UTC wall clock (§2.14); null outside years 1 to 9999. occurrence.startUtc: the expanded
 *  occurrence's start instant (ExpandedOccurrence.startUtc, IcsExpandedEvent.startUtc), required for timed ones;
 *  all-day occurrences pass null and their date at T00:00 as start, and the device zone is used. */
export function alarmFireTime(alarm: Alarm, occurrence: { allDay: boolean; start: LocalDateTime; startUtc: LocalDateTime | null },
                              deviceZone: string, zones: ZoneResolver): LocalDateTime | null;
export interface AlarmPreset { readonly id: string; readonly label: string; readonly alarm: Alarm | null }
export function alarmPresets(allDay: boolean, options?: { allowAfterStart?: boolean; use24Hour?: boolean }): AlarmPreset[];
/** Two call shapes: absolute alerts name their 13-month date in IFC, or in systemId (before the options, SPEC §4.1). */
export function describeAlarm(alarm: Alarm, allDay: boolean, options?: { use24Hour?: boolean }): string;
export function describeAlarm(alarm: Alarm, allDay: boolean, systemId?: CalendarSystemId, options?: { use24Hour?: boolean }): string;

// ---------- events/rrule.ts
export type Frequency = 'secondly' | 'minutely' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export interface WeekdayNum { readonly weekday: Weekday; readonly ordinal: number | null }  // ordinal +-1...53
export type RRuleUntil =
  | { readonly kind: 'date'; readonly date: GregorianDate }
  | { readonly kind: 'floating'; readonly value: LocalDateTime }
  | { readonly kind: 'utc'; readonly value: LocalDateTime };
export interface RRule {
  readonly freq: Frequency;
  readonly interval: number;                 // >= 1, default 1
  readonly count: number | null;
  readonly until: RRuleUntil | null;         // never both count and until (parse error)
  readonly bySecond: readonly number[]; readonly byMinute: readonly number[]; readonly byHour: readonly number[];
  readonly byDay: readonly WeekdayNum[];
  readonly byMonthDay: readonly number[];    // +-1...31
  readonly byYearDay: readonly number[];     // +-1...366
  readonly byWeekNo: readonly number[];      // +-1...53
  readonly byMonth: readonly number[];       // 1...12
  readonly bySetPos: readonly number[];      // +-1...366
  readonly wkst: Weekday | null;
  readonly rscale: string | null;            // RFC 7529
  readonly skip: string | null;
  readonly extensions: readonly (readonly [string, string])[];   // X-NAME=VALUE parts, kept in order
}
export function parseRRule(text: string): RRule;          // accepts an optional 'RRULE:' prefix; keys case-insensitive
export function tryParseRRule(text: string): RRule | null;
export function formatRRule(rule: RRule): string;         // canonical: FREQ;INTERVAL(if != 1);COUNT|UNTIL;BYSECOND;BYMINUTE;
                                                          // BYHOUR;BYDAY;BYMONTHDAY;BYYEARDAY;BYWEEKNO;BYMONTH;BYSETPOS;WKST;
                                                          // RSCALE;SKIP;extensions. Lists in input order. No prefix.
export function rruleEquals(a: RRule, b: RRule, options?: { ignoreEnd?: boolean; ignoreWkst?: boolean }): boolean; // lists as sets
/** An UNTIL in the event's zone, rounded down to the minute; a DATE until becomes D T24:00; floating is kept as is. */
export function untilInZone(until: RRuleUntil, zone: string | null, zones: ZoneResolver): LocalDateTime | null;
/** The last original date whose occurrence, starting at startMinute, starts at or before `until` (§4.5). */
export function untilEndDate(until: LocalDateTime, startMinute: number): GregorianDate;
/** The UNTIL value text that ends a rule after `endDate` (§4.4 Ends, §4.7 retiming): 'yyyyMMdd' for all-day;
 *  23:59:59 of endDate in `zone` as UTC 'yyyyMMddTHHmmssZ' for zoned; 'yyyyMMddT235959' for floating (zone null). */
export function formatUntil(endDate: GregorianDate, allDay: boolean, zone: string | null, zones: ZoneResolver): string;

// ---------- events/date-lists.ts  (Android provider RDATE / EXDATE text, §4.4)
export type DateListValue =
  | { readonly kind: 'date'; readonly date: GregorianDate }
  | { readonly kind: 'utc'; readonly value: LocalDateTime }
  | { readonly kind: 'zoned'; readonly value: LocalDateTime; readonly tzid: string }
  | { readonly kind: 'floating'; readonly value: LocalDateTime };
export function parseDateList(text: string): DateListValue[];   // '20261019,20261116', 'Europe/Tallinn;20261116T190000,...',
                                                                 // '20261116T170000Z,...', mixed lists; RangeError on bad values
export function formatDateList(values: readonly DateListValue[], form: 'date' | 'zoned' | 'utc'): string;  // one form per list

// ---------- events/thirteen-rules.ts
export type ThirteenRule = /* §4.2 */;
export type ThirteenRuleKind = 'monthly' | 'weekly' | 'biweekly' | 'yearly' | 'intercalary';
export function thirteenRuleFor(kind: ThirteenRuleKind, start: GregorianDate, systemId?: CalendarSystemId): ThirteenRule | null;
export function thirteenRuleDatesInYear(rule: ThirteenRule, year: number, start: GregorianDate): GregorianDate[];
export function thirteenRuleIncludes(rule: ThirteenRule, date: GregorianDate, start: GregorianDate): boolean;
export type ThirteenEncodingForm = 'gregorian-yearly' | 'byyearday' | 'leap-interval';
export interface ThirteenEncoding {
  readonly form: ThirteenEncodingForm;
  readonly rrule: RRule;                    // without COUNT / UNTIL (except the leap-interval cap)
  readonly exchangeSafe: boolean;           // form !== 'byyearday'
  readonly cap: GregorianDate | null;       // leap-interval only
}
export function encodeThirteenRule(rule: ThirteenRule, start: GregorianDate): ThirteenEncoding;
export function thirteenRuleRdates(rule: ThirteenRule, start: GregorianDate, end: RepeatEnd, horizon: GregorianDate,
                                   options?: { maxValues?: number }): { dates: GregorianDate[]; truncated: boolean }; // excludes start
export interface RdatePart { readonly part: number; readonly start: GregorianDate; readonly dates: GregorianDate[] } // dates exclude start
/** Android parts (§4.4): every occurrence from `start` to the end or horizon, cut by position into parts of
 *  1 + maxValues occurrences (default maxValues 400). Deterministic: a later horizon only grows the last part
 *  and appends parts. */
export function thirteenRuleRdateParts(rule: ThirteenRule, start: GregorianDate, end: RepeatEnd, horizon: GregorianDate,
                                       options?: { maxValues?: number }): RdatePart[];
export function formatThirteenRuleText(rule: ThirteenRule): string;     // marker value, no 'X-THIRTEEN-RULE;VERSION=1:'
export function parseThirteenRuleText(text: string): ThirteenRule;      // strict grammar of §4.3 (e)
export interface RuleUriExtras { readonly series: string | null; readonly part: number | null }
export function formatThirteenRuleUri(rule: ThirteenRule, end: RepeatEnd, extras?: RuleUriExtras): string;   // Android marker
export function parseThirteenRuleUri(text: string): { rule: ThirteenRule; end: RepeatEnd } & RuleUriExtras;
export function formatDetachedUri(series: string, original: GregorianDate): string;  // thirteen://detached?v=1&...
export function parseDetachedUri(text: string): { series: string; original: GregorianDate } | null;

// ---------- events/recurrence.ts
export type RepeatEnd =
  | { readonly kind: 'never' } | { readonly kind: 'count'; readonly count: number } | { readonly kind: 'until'; readonly date: GregorianDate };
export interface EndedRule { readonly rrule: RRule; readonly end: RepeatEnd }            // one RRULE or EXRULE with its own end
export type RepeatRule =
  | { readonly kind: 'rrule'; readonly rrule: RRule }                // without COUNT / UNTIL (they live in RepeatEnd)
  | { readonly kind: 'thirteen'; readonly rule: ThirteenRule }
  | { readonly kind: 'dates' }                                       // no rule: the start plus extraDates
  | { readonly kind: 'foreign'; readonly rules: readonly EndedRule[]; readonly exrules: readonly EndedRule[] };
                                                                     // several RRULEs and/or EXRULEs; recurrence.end is 'never'
/** An RDATE. minute and durationMinutes null = the master's start time and length (RDATE;VALUE=PERIOD sets both). */
export interface ExtraDate { readonly date: GregorianDate; readonly minute: number | null; readonly durationMinutes: number | null }
/** An original occurrence: an EXDATE value, a RECURRENCE-ID or ORIGINAL_INSTANCE_TIME. minute null = the master's start
 *  time (or a DATE value); a minute = an extra date's own time. Matched, deduped and retimed by date and minute (§4.6). */
export interface OriginalDate { readonly date: GregorianDate; readonly minute: number | null }
export interface EventRecurrence {
  readonly rule: RepeatRule;
  readonly end: RepeatEnd;
  readonly extraDates: readonly ExtraDate[];                         // RDATEs not explained by the rule; kept, expanded, written back
  readonly exceptDates: readonly OriginalDate[];                     // original occurrences removed (EXDATE)
}
export interface ExpansionWindow { readonly from: GregorianDate; readonly to: GregorianDate }   // inclusive
export type ExpandedDate = ExtraDate;                                // an original date, with its own time and length if it has them
export interface Expansion { readonly occurrences: ExpandedDate[]; readonly truncated: boolean; readonly unsupported: boolean }
/** §4.6. A leap-only 13-month repeat stops at its leap-interval cap whatever its end (§4.3 c), here and in every
 *  function below that expands (nextOccurrences, laterOccurrenceCount, splitRecurrence, expandSeries). */
export function expandRecurrence(recurrence: EventRecurrence, start: GregorianDate, window: ExpansionWindow,
                                 options?: { limit?: number }): Expansion;
export function nextOccurrences(recurrence: EventRecurrence, start: GregorianDate, count: number): GregorianDate[];  // after start
export function endRecurrenceBefore(recurrence: EventRecurrence, start: GregorianDate, date: GregorianDate): EventRecurrence | null;
/** Occurrences after `at` (excluded dates not counted, extra dates counted) that ending the repeat at `at` would delete;
 *  null when the series never ends (span.move.dropsRepeat, editor.notice.laterDeleted, §2.11). A leap-only 13-month
 *  repeat always ends, at its cap, so it has a number. */
export function laterOccurrenceCount(recurrence: EventRecurrence, start: GregorianDate, at: GregorianDate): number | null;
export interface ExceptionMap { readonly from: OriginalDate; readonly to: OriginalDate | null }   // null: dropped
export interface SplitResult {
  readonly head: EventRecurrence | null;          // null: `at` is the first occurrence
  readonly tail: EventRecurrence | null;          // null: "Delete all future events"
  readonly overrides: readonly ExceptionMap[];    // override original dates on or after `at`, mapped into the tail
  readonly droppedCount: number;                  // exceptions and extra dates dropped (span.future.exceptionsDropped, §2.11)
  readonly dropped: boolean;                      // droppedCount > 0
}
export function splitRecurrence(recurrence: EventRecurrence, start: GregorianDate, at: GregorianDate,
                                overrideDates: readonly OriginalDate[],
                                change?: { readonly recurrence: EventRecurrence | null; readonly start: GregorianDate;
                                           readonly ruleChanged: boolean } | null): SplitResult;     // §4.7
/** One stored RRULE or EXRULE whose UNTIL a retime rewrites: index in stored order; endDate = untilEndDate with the
 *  OLD start minute. Platforms write formatUntil(endDate, allDay, zone) into that rule's UNTIL= part only (§4.7). */
export interface UntilRewrite { readonly rule: 'rrule' | 'exrule'; readonly index: number; readonly endDate: GregorianDate }
export function retimeExceptions(recurrence: EventRecurrence, overrideDates: readonly OriginalDate[],
                                 oldStart: GregorianDate, newStart: GregorianDate, newRecurrence: EventRecurrence,
                                 options?: { readonly minuteDelta?: number;            // new start minute - old (own-time values)
                                             readonly allDay?: 'to-all-day' | 'to-timed' | null }):   // all-day toggle of the series
  { recurrence: EventRecurrence; overrides: readonly ExceptionMap[]; untils: readonly UntilRewrite[];
    droppedCount: number; dropped: boolean };   // §4.7
export function recurrenceToRRule(recurrence: EventRecurrence, start: GregorianDate): RRule | null;  // a, b, c forms + end; null for 'dates', 'foreign';
                                                                  // the leap cap wins over a later until or a longer count (§4.3 c)
export interface RepeatPreset {
  readonly id: string;              // 'never','daily','weekly','biweekly','monthly','yearly',
                                    // 'thirteen-monthly','thirteen-weekly','thirteen-biweekly','thirteen-yearly','thirteen-intercalary'
  readonly section: 'never' | 'gregorian' | 'thirteen';
  readonly label: string;
  readonly recurrence: EventRecurrence | null;   // end never
  readonly exchangeSafe: boolean;
}
export function repeatPresets(start: GregorianDate, systemId?: CalendarSystemId): RepeatPreset[];
export function matchRepeatPreset(recurrence: EventRecurrence | null, start: GregorianDate, systemId?: CalendarSystemId): string | null;
export function describeRecurrence(recurrence: EventRecurrence, start: GregorianDate, systemId?: CalendarSystemId): string;
export function describeNextOccurrences(recurrence: EventRecurrence, start: GregorianDate, systemId?: CalendarSystemId,
                                        options?: { count?: number }): string;       // repeat picker "Next:" line
export function describeRepeatNotes(recurrence: EventRecurrence, start: GregorianDate, systemId?: CalendarSystemId,
                                    options?: { gregorianOnlyCalendar?: boolean }): string[];   // true: the Outlook notes (§2.13)
export function adaptRecurrenceToStart(recurrence: EventRecurrence, oldStart: GregorianDate, newStart: GregorianDate):
  { recurrence: EventRecurrence | null; change: RepeatChange };   // the §2.11 table
export interface RecognitionInput {               // every value already in the event's zone
  readonly start: LocalDateTime;                  // minute 0 for all-day
  readonly rrules: readonly { readonly rrule: RRule; readonly until: LocalDateTime | null }[];   // until from untilInZone
  readonly exrules: readonly { readonly rrule: RRule; readonly until: LocalDateTime | null }[];
  readonly rdates: readonly ExtraDate[];
  readonly exdates: readonly OriginalDate[];      // minute null when it equals the start's minute or the value is a DATE
  readonly marker: string | null;                 // X-THIRTEEN-RULE value or Android marker URI
}
export interface Recognition {
  readonly recurrence: EventRecurrence;
  readonly source: 'marker' | 'byyearday' | 'leap-interval' | 'gregorian' | 'rdates' | 'dates' | 'foreign';
  readonly editable: boolean;                    // false: show "Keep: ..." and preserve
  readonly alternatives: readonly ThirteenRule[];
  readonly openEnded: boolean;                   // Android: marker says end=never (top-up allowed)
  readonly series: string | null;                // Android parts: the marker's series id and part number
  readonly part: number | null;
}
export function recognizeRecurrence(input: RecognitionInput, systemId?: CalendarSystemId): Recognition;
                                     // §4.5; a leap-only rule only with an end on or before its cap; UNTIL on the cap = never

// ---------- events/occurrences.ts  (§4.6; used by Android self-expansion and by eventsFromCalendar)
export interface OverrideInput {
  readonly id: string;                           // the platform's handle: override UID|RECURRENCE-ID, exception row _ID
  readonly originalDate: GregorianDate;          // RECURRENCE-ID / ORIGINAL_INSTANCE_TIME date in the series' zone
  readonly originalMinute: number | null;        // null: at the master's start time; else an extra date's own time
  readonly canceled: boolean;
  readonly allDay: boolean;
  readonly start: LocalDateTime; readonly end: LocalDateTime;   // in `zone`, end-of-day form
  readonly zone: string | null;                  // null: floating
}
export interface SeriesInput {
  readonly id: string;
  readonly recurrence: EventRecurrence | null;   // null: a single event (still converted and windowed)
  readonly allDay: boolean;
  readonly start: LocalDateTime; readonly end: LocalDateTime;   // the master, in `zone`
  readonly zone: string | null;
  readonly overrides: readonly OverrideInput[];  // all of them, whatever their dates
  /** The master's length when RFC 5545 text gives it as a DURATION with days (set by the .ics reader, §5.4): every timed
   *  occurrence ends `days` later on its own wall clock in the series' zone (a week is 7 days), then `minutes` later
   *  exactly (RFC 5545 §3.3.6, §3.8.5.3). Absent or null: every occurrence lasts the master's exact length, `end` minus
   *  `start` as instants (§3.3). Ignored for all-day series and for extra dates with their own length. */
  readonly duration?: { readonly days: number; readonly minutes: number } | null;
}
export interface ExpandedOccurrence {
  readonly originalDate: GregorianDate;          // part of the occurrence key (§3.2)
  readonly originalMinute: number | null;        // as in OverrideInput; part of the key when not null
  readonly overrideId: string | null;
  readonly allDay: boolean;
  readonly start: LocalDateTime; readonly end: LocalDateTime;   // DEVICE wall clock, end-of-day form
  readonly startUtc: LocalDateTime | null;       // a timed occurrence's start instant as a UTC wall clock (null for all-day):
                                                 // what alert planners pass to alarmFireTime (§2.14); the device wall clock
                                                 // cannot be turned back into it in a fall-back hour
}
export interface DeviceWindow { readonly from: LocalDateTime; readonly to: LocalDateTime }  // [from, to); to may be 9999-12-31T24:00
export function expandSeries(series: SeriesInput, window: DeviceWindow, deviceZone: string, zones: ZoneResolver,
                             options?: { limit?: number }):
  { occurrences: ExpandedOccurrence[]; orphans: string[]; outOfRange: number; truncated: boolean; unsupported: boolean };
                             // §4.6; sorted by start, then original date and minute; outOfRange counts every occurrence
                             // dropped because its device wall clock or its instant leaves years 1 to 9999

// ---------- events/layout.ts
export interface MonthItem {
  readonly key: string;
  readonly style: 'bar' | 'dot';               // bar: all-day or >= 24 h; dot: shorter timed (one item per day touched)
  readonly startColumn: number;                // 0...6 within the week row (or 0 in an intercalary band)
  readonly endColumn: number;                  // inclusive
  readonly lane: number;
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
}
export interface MonthWeekRow { readonly week: 1 | 2 | 3 | 4; readonly items: MonthItem[];
                                readonly visibleLanes: number[]; readonly hidden: number[] }   // per column (7 entries)
export interface IntercalaryBand { readonly id: IntercalaryDayId; readonly gregorian: GregorianDate;
                                   readonly items: MonthItem[]; readonly visibleLanes: number; readonly hidden: number }
export interface ThirteenMonthEventLayout { readonly year: number; readonly month: number; readonly system: CalendarSystemId;
                                            readonly columnGregorianWeekdays: Weekday[];   // 7 entries, §2.4 header line 2
                                            readonly weeks: MonthWeekRow[]; readonly intercalary: IntercalaryBand[] }
export function layoutThirteenMonthEvents(year: number, month: number, occurrences: readonly EventOccurrence[],
                                          systemId?: CalendarSystemId, options?: { maxLanes?: number }): ThirteenMonthEventLayout;
export function monthColumnGregorianWeekdays(year: number, month: number, systemId?: CalendarSystemId): Weekday[];
                                          // the Gregorian weekday of each column (also for the date picker, which has no events)

export interface TimedItem {
  readonly key: string; readonly column: number;
  readonly startMinute: number; readonly endMinute: number;     // clipped to the column's day, 0...1440
  readonly clippedStart: boolean; readonly clippedEnd: boolean;
  readonly slot: number; readonly slotCount: number;            // horizontal position inside its overlap cluster
  readonly hidden: boolean;                                     // true: drawn only through its TimedOverflow
}
export interface TimedOverflow {                                // the "+{n}" block of §2.5
  readonly column: number; readonly slot: number; readonly slotCount: number;
  readonly startMinute: number; readonly endMinute: number;     // the hidden items' earliest start and latest effective end
  readonly keys: string[];                                      // hidden items in order-key order
}
export type WeekColumn =
  | { readonly kind: 'day'; readonly gregorian: GregorianDate; readonly thirteen: ThirteenMonthDate }
  | { readonly kind: 'intercalary'; readonly gregorian: GregorianDate; readonly thirteen: ThirteenIntercalaryDate };
export interface WeekEventLayout { readonly columns: WeekColumn[]; readonly allDay: MonthItem[];   // columns span the whole week
                                   readonly timed: TimedItem[]; readonly overflow: TimedOverflow[] }
export function layoutThirteenWeekEvents(year: number, month: number, week: 1 | 2 | 3 | 4,
                                         occurrences: readonly EventOccurrence[], systemId?: CalendarSystemId,
                                         options?: { minDurationMinutes?: number; maxSlots?: number }): WeekEventLayout;
export function layoutDayEvents(date: GregorianDate, occurrences: readonly EventOccurrence[],
                                options?: { minDurationMinutes?: number; maxSlots?: number }):
  { allDay: string[]; timed: TimedItem[]; overflow: TimedOverflow[] };
export function formatChipTime(minute: number, use24Hour: boolean): string;   // '09:30'; 12-hour '9:30a', '2p', '12p', '12a'

export interface AgendaItem { readonly key: string; readonly part: 'single' | 'first' | 'middle' | 'last';
                              readonly dayIndex: number; readonly dayCount: number;
                              readonly startMinute: number | null; readonly endMinute: number | null }
export interface AgendaDay { readonly gregorian: GregorianDate; readonly thirteen: ThirteenDate; readonly items: AgendaItem[] }
export function agenda(occurrences: readonly EventOccurrence[], from: GregorianDate, to: GregorianDate,
                       systemId?: CalendarSystemId, options?: { includeEmptyDays?: boolean }): AgendaDay[];

export interface YearMark { readonly dayOfYear: number; readonly gregorian: GregorianDate; readonly count: number;
                            readonly calendarIds: string[] }
export function yearEventMarks(year: number, occurrences: readonly EventOccurrence[],
                               options?: { maxCalendars?: number }): YearMark[];   // days with events only, ascending
```

`describeRecurrence` grammar (English, exact; `{ord}` is `ordinal()` of the engine: 1st, 2nd, 12th):

| Rule | Text |
|---|---|
| daily, interval n | `Every day` / `Every {n} days` |
| weekly, no BYDAY or one day | `Every week on {Weekday}` / `Every {n} weeks on {Weekday}` (start's weekday) |
| weekly, several days | `Every week on Monday, Wednesday and Friday`; all 5 weekdays: `Every weekday`; Sat + Sun: `Every weekend` |
| monthly by day(s) | `Every month on the {ord}` / `Every {n} months on the 1st and 15th` / `the last day` for -1 |
| monthly "on the" | `Every month on the second Tuesday` / `on the last weekday` / `on the first weekend day` |
| yearly | `Every year on {Month} {d}` / `Every {n} years on ...` / with BYMONTH list: `Every year in March and September on the {ord}` / `Every year on the last Sunday of March` |
| 13-month monthly | `Every {IFC} month on the {ord}` |
| 13-month weekly | `Every {IFC} week on {13-month weekday}` / `Every 2 {IFC} weeks on {weekday}` |
| 13-month yearly | `Every year on {IFC} {Month} {d}` (Positivist: `Every year on Positivist Archimedes 12`) |
| intercalary | `Every Year Day`, `Every Leap Day`, `Every Festival of All the Dead`, `Every Festival of Holy Women` |
| dates, foreign, unsupported | `Repeats on a custom schedule` |
| any rule with `extraDates` | the rule's text + `, and {n} more dates` (`, and 1 more date`) |
| end count | `, {n} times` (`, once` for 1) |
| end until | `, until {date}`: 13-month long format of the system for 13-month rules (`, until December 12, 2036`), Gregorian long format for Gregorian rules |

`repeatPresets` labels are the descriptions of the presets without an end. Weekday and month names come
from the engine's tables; `{IFC}` is the system's `shortName`.

`describeNextOccurrences` grammar: `Next: ` followed by the next `count` (default 3) occurrence dates after
the start, each as the Gregorian `{Wkd}, {Mon} {d}` with `, {yyyy}` added when its year differs from the
start's, joined with `; `. For `thirteen` rules the first date is preceded by `Gregorian `. Fewer dates when
the repeat ends sooner; `''` when there are none. Examples (start 2026-10-19):
`Next: Mon, Oct 26; Mon, Nov 2; Mon, Nov 9` (every week) and
`Next: Gregorian Mon, Nov 16; Mon, Dec 14; Tue, Jan 12, 2027` (every IFC month on the 12th).

`describeRepeatNotes` grammar, in this order, each only when it applies. `{Y}` is the start's year + 1;
"until Leap Day" forms apply only when `{Y}` is a leap year and the system is IFC (Positivist's extra days
come at the end of the year, so its weekday never changes mid-year).

| Applies to | Text |
|---|---|
| Gregorian monthly by a month day from 29 to 31 | `Months without a {ord} are skipped.`; with `gregorianOnlyCalendar`: `Outlook and Exchange move this to the last day of shorter months.` |
| Gregorian yearly on February 29 | `Happens only in leap years.`; with `gregorianOnlyCalendar`: `Outlook and Exchange move this to February 28 in other years.` |
| leap-only intercalary rule | `Repeats every 4 years until {cap}. {cap display year + 4} has no {day name}, so the repeat stops before it.` with `{cap}` the 13-month long date without weekday (`formatThirteen`, long: `Leap Day 2096`, Positivist `Festival of Holy Women 308`), never a Gregorian date |
| 13-month weekly, interval 1 or 2 (IFC) | `Year Day and Leap Day belong to no week, so the repeat waits one extra day after each, and its Gregorian weekday moves.` + ` In {Y} it falls on {Weekday}s.` or ` In {Y} it falls on {Weekday}s until Leap Day and on {Weekday}s after it.` |
| 13-month weekly, interval 1 or 2 (Positivist) | `The Festival of All the Dead and the Festival of Holy Women belong to no week, so the repeat waits one extra day after each, and its Gregorian weekday moves. In {Y} it falls on {Weekday}s.` |
| Gregorian weekly on one weekday, interval 1 or 2 | `In {Y} {Weekday}s are {IFC} {Weekday}s.` or `In {Y} {Weekday}s are {IFC} {Weekday}s until Leap Day and {IFC} {Weekday}s after it.` |

Weekday plurals are the English names plus "s". Examples (start 2026-10-19): every IFC week on Thursday
gives `... In 2027 it falls on Tuesdays.`; every week on Monday gives `In 2027 Mondays are IFC Wednesdays.`;
with a start in 2027, `In 2028 it falls on Wednesdays until Leap Day and on Thursdays after it.`

`formatChipTime`: 24-hour `HH:MM`; 12-hour: the hour without a leading zero, `:MM` only when the minutes
are not 0, then `a` or `p` (`9:30a`, `2p`; noon `12p`, midnight `12a`).

`zonedToUtc(L, zone)`: let `b` be the offset at the UTC instant L minus 1 day and `a` the offset at L plus
1 day (both read as UTC). The candidates are `L - b` and `L - a`; a candidate U is valid when U plus the
offset at U equals L. Two valid, different candidates (an overlap): the earlier. One: it. None (a gap):
`L - b`, which lands the gap's length later in wall clock (New York 2026-03-08T02:30 becomes 07:30Z, which
is 03:30 local). This assumes at most one transition within 2 days, true for every zone in tzdata.

`mergeDraft(original, edited, current)`: for each `DraftField`, the group is "written" when `edited`
differs from `original`, and a "conflict" when `current` also differs from `original` and from `edited`.
`merged` takes written groups from `edited` and every other group from `current`. Platforms write only the
`written` groups (§4.9) and show `editor.changedElsewhere` only for conflicts.

`splitRecurrence`, `retimeExceptions` and `applyToSeries` follow §4.7; `thirteenRuleRdateParts` follows
§4.4; `expandSeries` follows §4.6. `OriginalDate` values compare equal when their dates are equal and
their minutes are equal, with null standing for the master's start minute.

### 5.3 Layout algorithms

All layouts take occurrences in the device's wall clock, already filtered to visible calendars and
normalized (§3.1.1; an end `D+1 T00:00` is accepted as `D T24:00`), with keys unique within one call (a
repeated key is a `RangeError`). Sorting uses this **order key** everywhere (ties broken left to right):
1. start (earlier first), 2. three ranks: all-day bars, then timed bars (24 hours or more), then dots
(this satisfies both "bars before dots" and "all-day before timed"), 3. longer duration first,
4. title by Unicode code points, 5. key by code points (never by UTF-16 code units, which order
differently where a surrogate meets U+E000 to U+FFFF). The header of `packages/core/src/events/layout.ts`
states these readings, and the layout fixtures pin them for the ports.

**Month lanes** (`layoutThirteenMonthEvents`):

1. Items: every occurrence that is all-day or lasts 24 hours or more becomes one bar per week row it
   touches (columns clipped to the row) plus one bar per intercalary band it touches; every shorter timed
   occurrence becomes a dot on each day it touches (at most two). `continuesBefore` / `continuesAfter` are
   true when the occurrence extends past the item's first or last column (including into or out of an
   intercalary day, a previous month, or a next month).
2. For each week row independently, sort items by their clipped start column, then bars before dots,
   then the full order key (so the dots of one day keep their time order, as boards A2 and K1 show), and
   give each the lowest lane free in all of its columns; `items` lists them in that order. Each
   intercalary band does the same with one column.
3. With `maxLanes` (default unlimited): in a column whose highest lane is below `maxLanes`, all lanes are
   visible (`visibleLanes = maxLanes`, `hidden = 0`). Otherwise `visibleLanes = maxLanes - 1` and `hidden`
   is the number of that column's items with `lane >= maxLanes - 1`; the platform draws "+{hidden} more" in
   the last lane. A bar is drawn only in the columns where its lane is visible. Without `maxLanes`,
   every column's `visibleLanes` is the number of lanes the row (or band) uses, and `hidden` is 0.
4. The month's intercalary bands are those with `afterMonth == month` (SPEC §1).
5. `columnGregorianWeekdays` (and `monthColumnGregorianWeekdays`): for column `c` (0...6), the Gregorian
   weekday of month day `c + 1`. Day `c + 1 + 7k` falls on the same Gregorian weekday for k = 1, 2, 3
   because no intercalary day lies inside a month.
6. Compact Month in the dots density (§2.4) does not use lanes: it draws `yearEventMarks` for the month's
   days (calendars and count per day).

**Week and day timeline** (`layoutThirteenWeekEvents`, `layoutDayEvents`):

1. Columns: the week's 7 days plus, for week 4, the intercalary days with `afterMonth == month`.
2. All-day row: occurrences that are all-day or last 24 hours or more, as bars over columns, lanes as in
   month step 2 (one row for the whole week).
3. Timed items: every shorter occurrence, clipped to each day it touches (`startMinute`, `endMinute` in
   0...1440; `clippedStart` / `clippedEnd` when cut).
4. Per column, sort by start minute, then longer first, then the order key. Effective end =
   `max(endMinute, startMinute + minDurationMinutes)` (default 15). Clusters: an item joins the current
   cluster while its start is before the cluster's latest effective end; otherwise it starts a new one.
   Inside a cluster, each item takes the first slot whose last item's effective end is at or before its
   start, else a new slot. `slotCount` = slots in the cluster. Width = column width / `slotCount`; x =
   `slot` x width.
5. Overflow, with `maxSlots` (default unlimited; the platform passes floor(column width / 48 pt) in Week
   and floor(width / 64 pt) in Day, at least 1): in a cluster with `slotCount > maxSlots`, items in slots
   `0 ... maxSlots - 2` stay visible and get `slotCount = maxSlots`; every other item gets `hidden: true`,
   and one `TimedOverflow` takes slot `maxSlots - 1` from the earliest start to the latest effective end
   of the hidden items, listing their keys in order-key order. With `maxSlots = 1` the whole cluster is
   one overflow block. Clusters that fit are unchanged (`hidden: false`, no overflow). A hidden item keeps
   the `slot` and `slotCount` of its full cluster; only `hidden` changes. The overflow's `endMinute` is
   the hidden items' latest effective end, so near midnight it can pass 1440 by less than
   `minDurationMinutes`.
6. DST days are drawn on a 24-hour wall-clock axis: an event from 01:30 to 03:30 on a spring-forward day
   is drawn 01:30 to 03:30 (one real hour). A timed occurrence whose wall-clock end is before its start (a
   fall-back night) is laid out as zero-length, so it is drawn with the minimum duration; an all-day
   occurrence that ends before it starts is a `RangeError`.

**Agenda** (`agenda`): one `AgendaDay` per date from `from` to `to` that has items (all dates with
`includeEmptyDays`). Each occurrence appears on every day it touches: `part` single, first, middle or last;
`dayIndex` (1-based) and `dayCount`; `startMinute` / `endMinute` for the part on that day (null for
all-day and middle parts). Items sorted: all-day and middle parts first (order key), then by start minute,
then the order key.

**Year marks** (`yearEventMarks`): for each day of the Gregorian year covered by at least one occurrence,
the count of occurrences covering it and the distinct calendar ids of those occurrences in order-key order,
at most `maxCalendars` (default 3).

### 5.4 The `.ics` module (TypeScript and C#)

Used by Windows and web for storage, import, export and subscriptions. RFC 5545 with RFC 7986 calendar
properties; tolerant reader, strict writer. Exported as `@thirteen/core/ics` (`package.json` `exports`),
separately from `@thirteen/core`; the declarations below are its whole public surface (also in
`packages/core/API.md`, "ICS"). The events types they use (`LocalDateTime`, `ZoneResolver`, `RRule`,
`RRuleUntil`, `UntilRewrite`, `DeviceWindow`, `EventOccurrence`, `RecognitionInput`, ...) come from
`@thirteen/core`.

```ts
export type IcsDateValue =
  | { readonly kind: 'date'; readonly date: GregorianDate }
  | { readonly kind: 'floating'; readonly value: LocalDateTime }
  | { readonly kind: 'utc'; readonly value: LocalDateTime }
  | { readonly kind: 'zoned'; readonly value: LocalDateTime; readonly tzid: string };   // tzid as written
export interface IcsProperty { readonly name: string; readonly params: readonly (readonly [string, string])[]; readonly value: string }
export type IcsTrigger =
  | { readonly kind: 'relative'; readonly minutes: number; readonly related: 'start' | 'end' }
  | { readonly kind: 'absolute'; readonly value: IcsDateValue };
export interface IcsAlarm { readonly action: string; readonly trigger: IcsTrigger; readonly extra: readonly IcsProperty[] }
export interface IcsRdate { readonly value: IcsDateValue; readonly period: string | null }   // period: the PERIOD's end or duration text
export interface IcsEvent {
  readonly uid: string; readonly uidDerived: boolean;                 // true: `missing-{hash}` (§2.17)
  readonly recurrenceId: IcsDateValue | null; readonly sequence: number;
  readonly summary: string; readonly location: string; readonly description: string; readonly url: string;
  readonly start: IcsDateValue; readonly end: IcsDateValue | null; readonly duration: string | null;
  readonly rrules: readonly RRule[]; readonly exrules: readonly RRule[];
  readonly rdates: readonly IcsRdate[]; readonly exdates: readonly IcsDateValue[];
  readonly status: string | null; readonly transp: string | null; readonly thirteenRule: string | null;
  readonly alarms: readonly IcsAlarm[]; readonly created: IcsDateValue | null; readonly lastModified: IcsDateValue | null;
  readonly dtstamp: IcsDateValue | null; readonly importedLastModified: IcsDateValue | null;  // X-THIRTEEN-IMPORTED-LAST-MODIFIED
  readonly extra: readonly IcsProperty[];                             // everything else, verbatim, in order
  readonly raw: string | null;      // the component's text as read (BEGIN to END, CRLF); null once edited or for new events
  readonly original: string | null; // the text as read, kept after an edit, so untouched fields are written as read; null: new
  readonly line: number | null;     // 1-based line the component began on in the text it was read from; the writer keeps that order
}
export interface IcsGroup { readonly uid: string; readonly master: IcsEvent | null; readonly overrides: readonly IcsEvent[] }
export interface IcsObservance { readonly kind: 'standard' | 'daylight'; readonly start: LocalDateTime;   // local, in offsetFrom
                                 readonly offsetFrom: number; readonly offsetTo: number;   // minutes east of UTC
                                 readonly rrules: readonly RRule[]; readonly rdates: readonly LocalDateTime[];
                                 readonly names: readonly string[] }                     // TZNAME values
export interface IcsTimeZone { readonly tzid: string; readonly observances: readonly IcsObservance[]; readonly raw: string | null;
                               readonly generated: { readonly first: number; readonly last: number } | null;  // X-THIRTEEN-GENERATED (§5.4)
                               readonly line: number | null }
/** A component kept as read and written back but not modeled: VTODO, VJOURNAL, VFREEBUSY, an unreadable or unclosed VEVENT,
 *  an exact duplicate of an earlier component. */
export interface IcsOtherComponent { readonly name: string; readonly raw: string; readonly line: number | null }
export interface IcsWarning { readonly line: number; readonly code: 'bad-line' | 'bad-date' | 'bad-rrule' | 'unknown-tzid'
                                                     | 'missing-uid' | 'missing-dtstart' | 'unclosed-component' | 'skipped-component'
                                                     | 'duplicate-uid' | 'out-of-range';
                              readonly detail: string }   // line 0: an expansion warning; detail is informative
export interface IcsCalendar { readonly name: string | null; readonly color: string | null; readonly refreshInterval: string | null;
                               readonly groups: readonly IcsGroup[]; readonly timeZones: readonly IcsTimeZone[];
                               readonly extra: readonly IcsProperty[]; readonly warnings: readonly IcsWarning[];
                               readonly others: readonly IcsOtherComponent[];
                               readonly raw: string | null }   // the calendar's own property lines as read; null for new calendars
/** How a TZID resolves (§5.4 order): kind 'iana' | 'windows' (zone: the IANA id), 'vtimezone' (timeZone: the file's
 *  definition), 'floating'; resolver answers offsets for it (null for floating). */
export interface ZoneHandle { readonly kind: 'iana' | 'windows' | 'vtimezone' | 'floating'; readonly tzid: string;
                              readonly zone: string | null; readonly timeZone: IcsTimeZone | null; readonly resolver: ZoneResolver | null }

/** calendarId seeds derived UIDs; with zones, an unresolvable TZID gets unknown-tzid. Throws only when there is no VCALENDAR. */
export function parseICalendar(text: string, options?: { calendarId?: string; zones?: ZoneResolver }): IcsCalendar;
/** Groups, VTIMEZONEs and others with `raw` are copied as read, in the order read; others are serialized. Unused VTIMEZONEs
 *  are dropped (one that a component in `others` uses is kept); a known zone used without one gets a generated one.
 *  now ('YYYY-MM-DDTHH:MM', UTC): the DTSTAMP of serialized events and the "current year" of series without an end. */
export function serializeICalendar(calendar: IcsCalendar, zones: ZoneResolver, options?: { now?: string }): string;
export const THIRTEEN_PRODID = '-//Haugas Development OU//Thirteen 1.0//EN';
/** An empty Thirteen calendar (§3.6 document rules). */
export function newICalendar(calendar: { readonly calendarId: string; readonly name: string; readonly color: string }): IcsCalendar;
/** The group in place of its UID's group(s), or added; members' raw cleared (an edit) unless keepRaw (import, restore);
 *  a group with no members removes the UID. */
export function replaceGroup(calendar: IcsCalendar, group: IcsGroup, options?: { keepRaw?: boolean }): IcsCalendar;
export function removeGroup(calendar: IcsCalendar, uid: string): IcsCalendar;
/** An event's LAST-MODIFIED, else its DTSTAMP, in UTC; null when it has neither. */
export function eventVersion(event: IcsEvent): LocalDateTime | null;
/** The newest LAST-MODIFIED of the group, else its newest DTSTAMP, in UTC; null when it has neither (§2.17 step 3). */
export function groupVersion(group: IcsGroup): LocalDateTime | null;
/** Inserts or replaces X-THIRTEEN-IMPORTED-LAST-MODIFIED in the raw text of the master (per override in a group without
 *  one), §3.6. */
export function withImportBaseline(group: IcsGroup, baseline: LocalDateTime): IcsGroup;
/** Adds the source's VTIMEZONEs for TZIDs the target does not define, as read (§2.17 import, §3.6). */
export function mergeTimeZones(target: IcsCalendar, source: IcsCalendar): IcsCalendar;
/** Renames incoming VTIMEZONEs whose TZID resolves only through the file's own VTIMEZONE (neither a known IANA id nor
 *  in the CLDR Windows table) and that the target defines differently, to `{TZID} (2)`, `(3)`, ..., and rewrites the
 *  TZID parameters of the incoming groups that use them (their raw text cleared). Known ids are never renamed: their
 *  groups keep their raw text and the target keeps one VTIMEZONE for them (§3.6). */
export function renameCollidingTimeZones(target: IcsCalendar, incoming: IcsCalendar, zones: ZoneResolver): IcsCalendar;
/** The DTEND of an all-day event from first to last, or none / DURATION:P{n}D when it ends on 9999-12-31 (§3.1.1). */
export function allDayEnd(first: GregorianDate, last: GregorianDate): { end: IcsDateValue | null; duration: string | null };
/** The UNTIL that ends the event's series after endDate in its own zone, as formatUntil (§4.4, §5.2) does. */
export function untilFor(endDate: GregorianDate, event: IcsEvent, calendar: IcsCalendar, zones: ZoneResolver): RRuleUntil;
/** Rewrites only the UNTIL= part of the rules retimeExceptions lists in untils (§4.7, §4.9 rule 4); raw cleared. */
export function withRetimedUntils(event: IcsEvent, untils: readonly UntilRewrite[], calendar: IcsCalendar,
                                  zones: ZoneResolver): IcsEvent;

export function resolveTzid(tzid: string, calendar: IcsCalendar, zones: ZoneResolver): ZoneHandle; // IANA, Windows id, VTIMEZONE, or floating
export function toUtc(value: IcsDateValue, handle: ZoneHandle): LocalDateTime | null;  // through zonedToUtc (§5.2) or the VTIMEZONE
export function buildVTimeZone(tzid: string, years: readonly number[], zones: ZoneResolver): IcsTimeZone;
export function sameTimeZoneDefinition(a: IcsTimeZone, b: IcsTimeZone): boolean;   // equal observances in any order (§3.6)
export function windowsZoneToIana(windowsId: string): string | null;              // 'FLE Standard Time' -> 'Europe/Kiev'

/** An occurrence with what the platform needs to open and edit it, and its start instant for alerts (§2.14). */
export interface IcsExpandedEvent extends EventOccurrence {
  readonly uid: string; readonly group: number;          // index in calendar.groups
  readonly component: IcsEvent;                          // the override that replaced it, or the master
  readonly originalDate: GregorianDate; readonly originalMinute: number | null;
  readonly recurring: boolean; readonly orphan: boolean; readonly status: EventStatus;
  readonly zone: string | null;                          // IANA id, file-defined TZID or 'UTC'; null: floating or all-day
  readonly startUtc: LocalDateTime | null;               // as ExpandedOccurrence.startUtc
}
/** One expandSeries per group (§4.6); keys `{calendarId}/{UID}|{original start}` (§3.2) with #n suffixes for
 *  duplicates; sorted by start, then key. A timed master's DURATION with days sets SeriesInput.duration. */
export function eventsFromCalendar(calendar: IcsCalendar, deviceZone: string, zones: ZoneResolver, window: DeviceWindow,
                                   systemId?: CalendarSystemId, options?: { calendarId?: string; limit?: number }): IcsExpandedEvent[];
/** eventsFromCalendar plus its out-of-range warnings (values and occurrences that leave years 1 to 9999). */
export function expandCalendar(calendar: IcsCalendar, deviceZone: string, zones: ZoneResolver, window: DeviceWindow,
                               systemId?: CalendarSystemId, options?: { calendarId?: string; limit?: number }):
  { events: IcsExpandedEvent[]; warnings: IcsWarning[] };
/** A stored master's recurrence data in its own zone, for recognizeRecurrence (§4.5). */
export function icsRecognitionInput(master: IcsEvent, calendar: IcsCalendar, zones: ZoneResolver): RecognitionInput;
```

Reader rules:

- Accepts CRLF, LF or CR line ends, a UTF-8 BOM, folded lines (a leading space or tab), lowercase names,
  quoted parameter values, `\n`, `\N`, `\,`, `\;`, `\\` escapes, and several `VCALENDAR`s in one file
  (merged). Unknown components (`VTODO`, `VJOURNAL`, `VFREEBUSY`, `VAVAILABILITY`) are skipped with a
  `skipped-component` warning and kept as read in `others`. A broken `VEVENT` (no readable `DTSTART`,
  never closed) is skipped with a warning and kept in `others` too; parsing continues. Every component
  keeps `raw` and `line`; every event also keeps `original`, its text as read, after an edit. `raw` on the
  calendar keeps its own property lines, so unchanged ones are written back as read.
- `DTSTART;VALUE=DATE` = all-day. Missing `DTEND` and `DURATION`: all-day lasts 1 day, timed lasts 0.
  `DTEND;VALUE=DATE:10000101` (written by some apps for an all-day event on 9999-12-31) is accepted as
  the end `9999-12-31T24:00` (§3.1.1) after an all-day start later than 1000-01-01 (before that it is
  the valid date 1000-01-01); no other 5-digit year is.
  `DURATION` (`P1D`, `PT1H30M`, `P1W`) is nominal for days and weeks (applied on the wall clock) and
  exact for hours, minutes and seconds (RFC 5545 §3.3.6). On a repeating timed master the days apply
  to every occurrence on its own wall clock (RFC 5545 §3.8.5.3), so `eventsFromCalendar` passes them as
  `SeriesInput.duration` (§5.2): a daily `P1D` series ends each occurrence at the same wall-clock time
  the next day, also across a DST change (`duration.ics`).
- `RDATE;VALUE=PERIOD` becomes an extra date with the period's start time and its own length: an end
  as an exact length, a duration with its days on that extra date's own wall clock (a `P1D` period across
  spring forward lasts 23 hours, `period-rdate.ics`). Floating values (and a floating series' extra
  dates) are measured in the device's zone. Several `RRULE`s or any `EXRULE` make a `foreign` rule (§4.5
  step 6), expanded as RFC 5545 defines.
- Components are grouped by `UID` (master plus overrides). An exact duplicate of an earlier component of
  its `UID` is not shown and is kept in `others` (written back as read) with a `duplicate-uid` warning;
  a second master or a repeated `RECURRENCE-ID` within a group is kept with a `#2`, `#3` key suffix in
  document order and a `duplicate-uid` warning. A `VEVENT` without `UID` gets the derived UID of §2.17
  (`missing-uid` warning, `uidDerived: true`): `missing-` and the first 32 hex digits of the SHA-256 of
  the UTF-8 text `{calendarId}\n{the DTSTART line as read, unfolded}\n{the SUMMARY text}`.
- Occurrences whose conversion leaves years 1 to 9999, and timed occurrences whose instant does, are
  dropped (`far-future.ics`, §5.6), never clamped; `expandCalendar` reports them as `out-of-range`
  warnings, as it does `RDATE` values that leave the range.
- Time zones, in this order: an IANA id the platform knows (`Europe/Tallinn`); a Windows zone id mapped
  to IANA through the embedded CLDR `windowsZones` table (`FLE Standard Time`, as Outlook writes); the
  file's own `VTIMEZONE` (observances expanded with the engine's RRULE expander); otherwise floating with
  an `unknown-tzid` warning. Google feeds use IANA ids, Outlook uses Windows ids with `VTIMEZONE`.
- `X-WR-CALNAME`, `NAME`, `X-APPLE-CALENDAR-COLOR`, `COLOR`, `REFRESH-INTERVAL`, `X-PUBLISHED-TTL` fill
  the calendar fields.
- `X-THIRTEEN-RULE` is read as TEXT: `IcsEvent.thirteenRule` holds the unescaped value (`\;`, `\,`,
  `\\`, `\n`, `\N`), so the escaped form Google's export and EventKit write
  (`SYSTEM=ifc\;KIND=monthly\;DAY=12`, phase 0) parses like Thirteen's own (§4.3 e). An untouched line is
  still written back as read. (Phase 0 found the v3.3 reader keeping the backslashes, so
  `parseThirteenRuleText` refused such markers; recognition then fell through to steps 2 to 5 of §4.5.
  TypeScript and C# change together, with a `fixtures/ics` case taken from a Google export, §5.6.)

Writer rules: groups, `VTIMEZONE`s and `others` with `raw` text are written exactly as read (§3.6), in the
order they were read (by `line`; a new group at the end, a new or generated `VTIMEZONE` after the last
one read). A UTF-8 byte order mark is not written, and `BEGIN:VCALENDAR` / `END:VCALENDAR` are written in
uppercase. Serialized groups: CRLF, lines folded at 75 octets without splitting a UTF-8 sequence,
property order as listed in §3.6, `DTSTAMP` in UTC (`now` for events without one), all-day `VALUE=DATE`,
floating values without `Z`, and the original `TZID` string (a Windows id such as `FLE Standard Time`, or
a name defined only by the file's own `VTIMEZONE`) whenever the event's zone did not change; the
properties of the fields the user did not touch are written as read (from `original`, an empty
`DESCRIPTION:` included). An all-day event ending on 9999-12-31 is written without `DTEND` (one day) or
with `DURATION:P{n}D` (§3.1.1). A `VTIMEZONE` that nothing written uses is dropped, except one that a
component kept in `others` uses (a `VTODO`'s `DUE;TZID`), which is kept as read. Every known zone (an
IANA id the platform knows, or a Windows id the CLDR table maps to one) that a group uses without a
`VTIMEZONE` in the document gets one, also on the first write of a file read from elsewhere, so such a
round trip adds it (`zones-added`, §5.6); a `TZID` that resolves to nothing gets none. A zone that needs a
new `VTIMEZONE` gets one from `buildVTimeZone`, which covers the **years used** with **one observance
pair per rule period**:

- Years used: for each event with that `TZID`, from its start year to its last occurrence's year; a
  series without an end counts from its start year through the later of its start year and the current
  year, plus one (the current year is the year of `serializeICalendar`'s `now`; without `now`, the start
  year). `years` passed to `buildVTimeZone` is that range.
- **The first onset comes before the first event.** RFC 5545 defines no offset before a `VTIMEZONE`'s
  earliest onset, so readers that honor the file's `VTIMEZONE` (Outlook, `ical.js` without its zone
  registry) could apply the wrong one to an occurrence between January 1 and the first transition of the
  first year. Sampling therefore starts on January 1 of the year **before** the first year used: the
  first period's `STANDARD` and `DAYLIGHT` then have onsets in that earlier year, and January 1 of the
  first year lies after them. A zone with no transition in that earlier year (no DST then) begins with a
  `STANDARD` whose `DTSTART` is January 1 of that year at 00:00, with `TZOFFSETFROM` equal to
  `TZOFFSETTO`. (Apple and Google write 1970-era onsets for the same reason.)
- Transitions are found by sampling `offsetMinutesAt` daily (at 00:00 UTC) over those years and
  bisecting to the minute; consecutive years whose transitions follow the same `BYMONTH`/`BYDAY` pattern
  (`nWD`, or `-1WD` when the day is in the month's last 7 days, with the same local time and offsets)
  become one `STANDARD` and one `DAYLIGHT` with `DTSTART` at the period's first transition and
  `RRULE ... ;UNTIL=` its last (UTC). A period of one year that is not the last has no `RRULE` (its
  `DTSTART` is the onset). Every transition fits one such pattern, so a rule that moves between patterns
  starts a new period instead of needing `RDATE`s: Asia/Jerusalem's "Friday before the last Sunday" of
  March is `-1FR` through 2027 and `4FR` from 2028 (`jerusalem.ics`). The writer never writes `RDATE`
  observances; the reader reads them where other apps write them.
- **The last period is open-ended**: its `RRULE` has no `UNTIL`, so it goes on as the zone data itself
  does. Without this, RFC 5545 applies the last onset's offset for ever after it, and every summer
  occurrence of an endless series after the sampled years would be an hour off in Outlook and every
  other app that reads the file's `VTIMEZONE`.
- A zone without DST in the last period ends with a single `STANDARD`.
- The `VTIMEZONE` carries `X-THIRTEEN-GENERATED:{first year}-{last year}` (the years used; sampling
  starts one year earlier, above). When the
  document is written and the years used for its `TZID` reach outside them (a 2005 event added to a
  document built for 2026 to 2027, or a 2031 event added to it), it is rebuilt with
  `buildVTimeZone`; raw `VTIMEZONE`s from other files are never rebuilt (§3.6).

So America/New_York events in 2005 and 2026 export both the pre-2007 and the current rules, the current
ones without an end, and Outlook shows every occurrence at the right hour (fixtures `ny-2005-2026.ics`,
`ny-open-ended.ics` and `jerusalem.ics`, §5.6).

### 5.5 `fixtures/events.json`

Generated by `pnpm fixtures` (Core team) next to `conversions.json`; a staleness test fails until it is
regenerated. Format version 1, same layout rules as `conversions.json` (pretty envelope, one compact value
per line in arrays, trailing newline), under 700 kB (the case lists below produce about 695 kB; the
budget is `EVENTS_FILE_BUDGET_BYTES` in `packages/core/test/events/fixtures.test.ts`). Dates are
`"YYYY-MM-DD"` strings and wall-clock times `"YYYY-MM-DDTHH:MM"` strings (unlike `conversions.json`,
which uses date objects). `null` expected values mean "throws". Top-level keys, in order:

```
{
  "version": 1, "complete": true,                        // complete: every section present (§6.0); removed at 1.0
  "generatedBy": "@thirteen/core", "spec": "docs/EVENTS.md",
  "tzVersion": "2025b",                                  // Node's process.versions.tz when generated
  "counts": {"localDateTimes": 29, ...},                 // cases per section; every port asserts each count
  "localDateTimes":  [ {"text", "valid": bool, "formatted"|null} ],
  "endForms":        [ {"start", "end", "normalized"|null, "days": [dates]|null, "display"|null} ],   // display: displayEnd
  "wallClock":       [ {"from", "minutes", "expected"} ],                                  // addMinutesLocal
  "zoneMath":        [ {"zone": synthetic table, "local"|"utc", "expected"} ],             // zonedToUtc / utcToZoned, every port (synthetic resolver)
  "rrules":          [ {"text", "parsed": RRule JSON | null, "formatted": string | null} ],
  "rruleEquality":   [ {"a", "b", "ignoreEnd", "ignoreWkst", "equal"} ],
  "untils":          [ {"until": RRuleUntil JSON, "zone"|null, "startMinute", "inZone", "endDate", "allDay", "text"} ],  // untilInZone, untilEndDate,
                                                                                         // text: formatUntil(endDate, allDay, zone)
  "dateLists":       [ {"text", "parsed": [DateListValue JSON] | null, "form", "formatted"} ],
  "thirteenRules":   [ {"rule", "start", "datesIn": {"year", "dates"}[], "encoding": {"form", "rrule", "exchangeSafe", "cap"},
                        "marker", "uri": {"end", "series", "part", "text"}, "rdates": {"end", "horizon", "dates", "truncated"},
                        "parts": {"end", "horizon", "maxValues", "parts": [{"part", "start", "dates"}]} | null,
                        "detached": {"series", "original", "text"} | null} ],   // uri: formatThirteenRuleUri(rule, end, extras)
                                                                                 // detached: formatDetachedUri(series, original)
  "ruleFromStart":   [ {"kind", "start", "system", "rule"|null} ],
  "expansions":      [ {"recurrence", "start", "window": {"from","to"}, "limit"|null, "occurrences", "truncated", "unsupported"} ],
  "endBefore":       [ {"recurrence", "start", "date", "expected"|null, "later": number|null} ],   // later: laterOccurrenceCount
  "splits":          [ {"recurrence", "start", "at", "overrideDates", "change"|null, "expected": SplitResult JSON} ],
  "retimes":         [ {"recurrence", "overrideDates", "oldStart", "newStart", "newRecurrence", "minuteDelta"|null, "allDay"|null,
                        "expected": {"recurrence", "overrides", "untils", "droppedCount", "dropped"}} ],
  "seriesEdits":     [ {"master", "opened", "edited", "override"|null, "expected": {"master", "override"|null, "written", "retime"|null}} ],  // applyToSeries
  "series":          [ {"series": SeriesInput JSON, "window", "deviceZone", "expected": {"occurrences", "orphans", "outOfRange"}} ],
                                                       // SeriesInput JSON always has "duration" (null or {"days","minutes"});
                                                       // occurrences are ExpandedOccurrence JSON with "startUtc" (null for all-day)
  "recognitions":    [ {"input": RecognitionInput JSON, "system", "expected": Recognition JSON} ],
  "presets":         [ {"start", "system", "presets": [{"id","section","label","exchangeSafe","recurrence"}]} ],
  "descriptions":    [ {"recurrence", "start", "system", "text"} ],
  "nextOccurrences": [ {"recurrence", "start", "system", "count", "text"} ],
  "repeatNotes":     [ {"recurrence", "start", "system", "gregorianOnlyCalendar", "notes": [string]} ],
  "adaptations":     [ {"recurrence", "oldStart", "newStart", "expected": {"recurrence"|null, "change", "laterCount": number|null}} ],   // laterCount: dropped rows only
  "drafts":          [ {"draft", "calendar", "issues"} ],
  "newDrafts":       [ {"day", "now", "allDay", "expected": EventDraft JSON} ],
  "merges":          [ {"original", "edited", "current", "expected": {"merged", "written", "conflicts"}} ],
  "alarms":          [ {"allDay", "allowAfterStart", "use24Hour", "presets": [{"id","label","alarm"}]} ],
  "alarmInstants":   [ {"alarm", "occurrence": {"allDay", "start", "startUtc"}, "deviceZone", "expected"|null} ],
                                                       // alarmFireTime, through the recorded resolver (below)
  "chipTimes":       [ {"minute", "use24Hour", "text"} ],
  "monthColumns":    [ {"year", "month", "system", "weekdays": [7 numbers]} ],
  "monthLayouts":    [ {"year", "month", "system", "maxLanes"|null, "occurrences", "expected": ThirteenMonthEventLayout JSON} ],
  "weekLayouts":     [ {"year", "month", "week", "system", "maxSlots"|null, "occurrences", "expected": WeekEventLayout JSON} ],
  "dayLayouts":      [ {"date", "occurrences", "minDurationMinutes", "maxSlots"|null, "expected"} ],
  "agendas":         [ {"from", "to", "system", "includeEmptyDays", "occurrences", "expected"} ],
  "yearMarks":       [ {"year", "maxCalendars", "occurrences", "expected"} ],
  "zones":           [ {"zone", "local", "expectedUtc"} , {"zone", "utc", "expectedLocal"} ],  // platform adapters, not core
  "zoneOffsets":     [ {"zone", "year", "startOffset", "transitions": [{"utc", "offset"}]} ]  // recorded resolver for untils, series,
                                                                                            // alarmInstants, the mockup file, fixtures/ics
}
```

JSON forms: `ThirteenRule` as in §4.2 (`{"kind":"monthly","system":"ifc","day":12}`,
`{"kind":"intercalary","system":"ifc","id":"leap-day"}`); `RepeatEnd` `{"kind":"never"}`,
`{"kind":"count","count":10}`, `{"kind":"until","date":"2027-06-30"}`; `RepeatRule` with `rrule` as its
canonical text (`{"kind":"rrule","rrule":"FREQ=WEEKLY;INTERVAL=2"}`, `{"kind":"dates"}`,
`{"kind":"foreign","rules":[{"rrule":"...","end":...}],"exrules":[...]}`); `EventRecurrence` always with
all four fields; `ExtraDate` and `ExpandedDate` as a date string when `minute` and `durationMinutes` are
both null, else `{"date","minute","durationMinutes"}`; `OriginalDate` (in `exceptDates`, `exdates`,
`overrideDates`, `ExceptionMap` and override inputs) as a date string when `minute` is null, else
`{"date","minute"}`; `UntilRewrite` as `{"rule","index","endDate"}`; `RRule` JSON with every field of §5.2 in
declaration order, weekdays as numbers, `until` as `{"kind":"utc","value":"2026-12-31T23:59"}`;
occurrences `{"key","calendarId","title","allDay","start","end"}`. Zone cases use real IANA zones on dates
whose rules are settled history in tzdata (no announced change), and every port prints `tzVersion` next
to its own tzdata version when a zone case fails, so a data mismatch is named as such.

**Recorded zone offsets.** Only the `zones` section tests a platform's own zone data. Every other
section that needs zones (`series`, `alarmInstants`, `untils`), the mockup file (§6.7), and every
`fixtures/ics` case (expected occurrences, and the byte-exact generated `VTIMEZONE`s of `ny-2005-2026.ics`, `jerusalem.ics` and the
`edits/` cases), runs in every port through a `RecordedZoneResolver` built from `zoneOffsets`: the
generator wraps Node's `Intl` resolver and records, for every zone and UTC year it was asked about while
computing those expectations, the offset at the start of that year and each transition in it. The
recorded resolver answers `offsetMinutesAt` from that table and throws for a zone and year it does not
hold, so no test silently falls back to another tzdata. This keeps those expectations identical where
platform zone data differs from Node's ICU tzdata, in particular on Windows, where `TimeZoneInfo` reads
the registry (whose history is shorter and whose `zones` answers can differ: `windows-latest` in CI has
no tzdata to print). Each port's own resolver (`FoundationZoneResolver`, `JavaTimeZoneResolver`,
`WindowsZoneResolver`, the web's `Intl` resolver) is tested only by `zones`, and a port that cannot
answer a `zones` case as tzdata does lists that case by id, with the reason, in its parity test's
exclusion list and its README (Windows: the cases its registry lacks history for, decided when W1 first
runs on `windows-latest`, for example `Pacific/Apia` 2011-12-30 if the registry has no dynamic rule
there). No other exclusion is allowed.

**Case lists** (each bullet is at least one case; the generator enumerates them from tables so the counts
are exact and asserted; the number after each section is its count in `counts` as generated for 1.0):

- `localDateTimes`, `endForms`, `wallClock` (29, 19 and 21): `T24:00` accepted only as an end; `T24:01`,
  `T25:00`, `2026-02-29T10:00`, `10000-01-01T00:00`, `0000-12-31T00:00` invalid; midnight-ending timed
  event; zero-length at midnight; all-day 9999-12-31; end before start (throws); days of a 22:00 to 01:30
  event; adding 1440 minutes across Year Day; across 2024-06-17 (Leap Day); past 9999-12-31 (throws).
- `rrules` (101; `rruleEquality` 33): every part; `RRULE:` prefix; lowercase; `BYDAY=-1FR`, `2TU`,
  `+3WE`; `BYSETPOS`; `UNTIL` as date, floating and UTC; `COUNT` + `UNTIL` (throws); `INTERVAL=0` (throws); `BYMONTHDAY=32`,
  `BYYEARDAY=367`, `BYWEEKNO=54`, `BYMONTH=13` (throw); `RSCALE=HEBREW`; `X-NAME=1` kept; duplicate keys
  (throws); trailing semicolon accepted; formatter round trips; Apple's 52-value weekly `BYYEARDAY`.
- `thirteenRules` (91): IFC monthly day 1, 12, 28 and Positivist monthly day 1, 12, 28 with starts in
  2026 (common), 2028 (leap), 2099, 2100 (not leap), 9998; IFC and Positivist weekly for all 7 weekdays,
  interval 1 and 2 (phase from days 3 and 17); yearly IFC January 1, March 3 (day 59, form a), March 4
  (day 60, form b), June 28 (day 168), Sol 1, December 28, Positivist Aristotle 3 and 4, Bichat 28;
  intercalary IFC Year Day, IFC Leap Day from 2024, 2096 and 2104 (cap 2196), Positivist All the Dead,
  Holy Women from 2024; `rdates` with horizons for each kind, ends never, count and until, and the
  400-value truncation; `parts` for a weekly series started in 2020 with the 2029 horizon (two parts), the
  same series with the 2035 horizon (parts of 400, 400 and 29 values: the second part grows to full, a
  third is appended, the first is identical; with 400 values per part a third part needs 802
  occurrences, which the 2033 horizon does not reach), a count of 999, a horizon of 9999-12-31; markers
  and URIs for every case, with and without `series` and `part`; detached URIs.
- `untils` (26): `UNTIL=20261116T165959Z` on a 19:00 Europe/Tallinn weekly event (18:59 there, so the
  end date is November 15, the last date whose occurrence can start by then, as `untilEndDate` gives;
  a Monday series therefore ends with November 9); `UNTIL=20261116T000000Z` on a 19:00 event in UTC+2
  (end date November 15); `UNTIL` exactly at an occurrence's start (included); an end-of-day value; a
  date `UNTIL`; a floating `UNTIL`; an America/New_York event whose `UNTIL` is read on a device in
  Europe/Tallinn (the event's zone decides); values on DST change days; the range edges (null). Every
  case also gives `text`, `formatUntil` of its end date: `20261115T215959Z` for the first case, a date for
  all-day cases, `T235959` without `Z` for floating ones, and a New York end date in winter and in summer
  (the UTC hour differs). The first case as generated:
  `{"until":{"kind":"utc","value":"2026-11-16T16:59"},"zone":"Europe/Tallinn","startMinute":1140,"inZone":"2026-11-16T18:59","endDate":"2026-11-15","allDay":false,"text":"20261115T215959Z"}`.
- `dateLists` (26): the all-day, `TZID;` and UTC forms, mixed lists as Google writes them back,
  whitespace, an empty list, bad values (throw), and each form formatted from the same values.
- `zoneMath` (36): a synthetic zone table with a spring-forward gap, a fall-back overlap, a
  30-minute gap, a skipped day, and a transition at midnight; both directions; the year 1 and 9999 edges
  (null). Every port runs this section through a synthetic `ZoneResolver` built from the case's table,
  so the gap and overlap rule is checked in each port's `ZoneMath` without its tzdata.
- `ruleFromStart` (45): every kind from a month day, from Year Day, from Leap Day, from All the Dead
  and Holy Women (monthly and weekly give null).
- `expansions` (135): every `thirteenRules` case over the first of the windows 2024-01-01 to
  2026-12-31, 2099-01-01 to 2101-12-31 and 9998-01-01 to 9999-12-31 that holds one of its occurrences
  (a series that ends outside all three over its own years), so no case is empty; separate cases run
  weekly and yearly 13-month rules through the 2099 to 2101 window and to 9999-12-31 (IFC weekly
  Thursday, Positivist every 2 weeks, IFC yearly March 4, Positivist weekly Friday and yearly Bichat 28),
  and leap-only repeats past their cap (Leap Day over 2090 to 2110, Holy Women with a count of 30 from
  2088: both stop at the cap, §4.6); with count, until and `exceptDates` (count still
  counts them); Gregorian: daily interval 3 with until; weekly `BYDAY=MO,WE,FR`; the RFC's `WKST` example
  (`FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU` with `WKST=MO` vs `WKST=SU`); monthly on the 31st (skips);
  `BYMONTHDAY=-1`; `BYDAY=2TU`; `BYDAY=-1FR`; `BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1`; yearly on February 29
  (leap years only, 2100 skipped); `BYMONTH=3;BYDAY=-1SU`; `BYWEEKNO=1;BYDAY=MO`; `BYYEARDAY=366`;
  `BYYEARDAY=-1`; a start that does not match the rule (still first); `dates` rules; `RRULE` plus extra
  dates (union, a duplicate date counted once, an extra date with its own time, a `PERIOD` extra date with
  its own length); `FREQ=WEEKLY;COUNT=3` plus one `RDATE` (4 occurrences); an `RDATE` after the `UNTIL`
  (shown); an `RDATE` on an `EXDATE` (removed); an `RDATE` at 15:00 on a day the rule produces at 09:00
  (both kept); an `EXDATE` at 15:00 on that day (only the 15:00 extra date removed) and one at 09:00
  (only the rule's occurrence removed); a `foreign` rule with two `RRULE`s and one with an `EXRULE`; `FREQ=DAILY;BYMONTH=2;
  BYMONTHDAY=29` and `FREQ=DAILY;BYYEARDAY=366` from 2024 over 2024 to 2112 (they keep going past the old
  1,000-period guard); `HOURLY` and `RSCALE` unsupported; an impossible rule (`BYMONTH=2;BYMONTHDAY=30`,
  truncated before iterating); a truncation by `limit` (a daily rule with `limit` 10); year 1 (IFC and
  Positivist rules from 0001-01-01, a Gregorian yearly rule from year 1) and the end of the range
  (9999-12-31 is the last date).
- `endBefore` (20): count and until series split at the first, a middle and the last occurrence;
  `later` for each (null for series without an end, 0 at the last occurrence); a leap-only repeat with a
  count and one without an end (`later` a number: the occurrences up to the cap, §4.6).
- `splits` (20): a `COUNT=10` series split at its 4th occurrence with the repeat kept (tail `COUNT=7`)
  and with a new repeat; an `UNTIL` series; an `EXDATE` after the split (carried) and one before (stays);
  an override after the split, with the time changed (carried), the date moved by 2 days where the tail
  produces the shifted date (carried) and where it does not (dropped, `droppedCount` 1); splits at the
  second and at the last occurrence; "Delete all future events" (tail null); a 13-month rule; an `RDATE`
  series; a rule with extra dates on both sides of the split and a new repeat (the earlier ones stay in
  the head, the later ones are dropped and counted); a `foreign` rule with a `COUNT` `RRULE`, an `UNTIL`
  `RRULE` and an `EXRULE`, split with a new repeat (each rule gets its own head end) and with the repeat
  kept (throws).
- `retimes` (20): time only (dates kept), date moved within the rule (shifted), date moved off the
  rule (dropped), with `EXDATE`s and overrides, for a Gregorian and a 13-month rule; an extra date with
  its own time shifted by `minuteDelta` (also across midnight), with an `EXDATE` and an override on that
  own-time extra date (shifted with it, still matching it); all-day to timed and timed to all-day
  with `EXDATE`s, overrides and extra dates (an extra date that lands on a rule date when it loses its
  time is dropped and counted); `untils`: an all-day toggle of a series with `UNTIL` in both directions
  (a date `UNTIL` for the all-day series, a UTC end of day for the timed one), an Outlook-style
  `UNTIL=20261116T170000Z` on a 19:00 Tallinn weekly series moved to 19:30 (end date November 16, so
  the last occurrence is kept), a `foreign` rule whose `RRULE` and `EXRULE` both have an `UNTIL` (one
  entry each, in stored order), and a `COUNT` rule (no entry).
- `seriesEdits` (12), `applyToSeries`: a time change from 19:00 to 19:30 on the 5th occurrence of
  a `FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO` series (the master keeps its own date, takes 19:30, `minuteDelta`
  30); the same edit made on an override whose own time is 20:00 (the master takes 19:30 as an absolute
  time, not 20:00 minus 30 minutes, and the override takes 19:30 on its own date); an all-day toggle
  (`retime.allDay`); a length change only; a zone change; a title change on an override occurrence (the
  master and that override get it); a title change with the time group untouched (`retime` null, the
  master's time unchanged); a change another app made to the master's notes meanwhile (kept).
- `series` (38), each with device zones Europe/Tallinn and America/New_York: a window starting
  2027-01-01 with the all-day Winter break from 2026-12-28 to 2027-01-03, a timed event crossing midnight
  on December 31, an event at 01:00 on January 1 in Pacific/Kiritimati seen from Pacific/Honolulu, an
  override moved from December 15 into January (shown) and one moved from January into December (hidden),
  a canceled override, an orphan override, a floating event, a timed repeat whose master crosses a DST
  change (exact length), daily occurrences across spring-forward and fall-back days, a `PERIOD` extra date
  longer than the master that starts before the window (found by the widened range), a master whose
  length is a `DURATION` of one day (`duration` `{"days":1,"minutes":0}`: each occurrence ends on the
  next day at its own wall clock, across a DST change too), an occurrence on a spring-forward day whose
  02:30 start falls in the New York gap, with an override and, in a second case, an `EXDATE` written at
  03:30, the same instant (matched, §4.6), and the range edges (an event at 9999-12-31T23:00 in
  America/New_York seen from Europe/Tallinn and from New York: dropped, `outOfRange` 1 on both devices;
  one at 0001-01-01T01:00 in Asia/Tokyo seen from UTC and from Asia/Tokyo: dropped, `outOfRange` 1).
- `recognitions` (55): Apple-style `BYYEARDAY` lists for every `thirteenRules` case, shuffled and
  with duplicates; single positive values up to 168 (both systems, preferred first, alternative listed);
  negative singles; `INTERVAL=4` Leap Day with and without an end before the cap; plain yearly on
  invariant dates (alternatives); presets in minimal and explicit forms; Android `RDATE` lists complete,
  with an `EXDATE`, with one date missing (not recognized: `dates`), with the marker URI (`openEnded`),
  written under an older horizon (still recognized), truncated at 400 values (still recognized), and a
  second part of a series (`series`, `part`); `UNTIL` one second before an occurrence (end date the
  occurrence before); an `EXDATE` at the start's minute (minute null) and one at an own-time `RDATE`'s
  minute (minute kept); markers that agree and that disagree with the rule (ignored); `RRULE` with extra
  `RDATE`s (`extraDates`, not editable); foreign rules (`BYWEEKNO`, two `RRULE`s, an `EXRULE`, `HOURLY`).
- `presets` (16): starts 2026-10-19, 2026-01-31, 2024-02-29, 2024-06-17 (IFC Leap Day), 2026-12-31
  (Year Day), 2024-12-30 and 2024-12-31 (Positivist festivals), 2026-06-18 (Sol 1), each in both systems.
- `descriptions` (55): every grammar row of §5.2 with and without ends, both systems, and year 1
  (a Positivist until date in display year -1787: `, until Moses 1, -1787`).
- `nextOccurrences` (23): every preset of the `presets` starts, both systems, counts 1 and 3; a
  repeat that ends after 2 dates; one that crosses a year; an intercalary rule.
- `repeatNotes` (23): every row of the `describeRepeatNotes` table, starts in 2026 (next year common)
  and 2027 (next year leap), both systems, with and without `gregorianOnlyCalendar`, plus repeats with no
  notes; the leap-only notes name the cap in 13-month form ("until Leap Day 2096", Positivist "until
  Festival of Holy Women 308").
- `chipTimes` (20): 00:00, 00:30, 09:00, 09:30, 12:00, 12:05, 13:00, 23:59, both forms.
- `monthColumns` (65): every month of IFC 2026, 2027 and 2028 and Positivist 2026 and 2028 (columns
  before and after Leap Day differ).
- `adaptations`, `drafts`, `newDrafts`, `alarms` (23, 79, 19 and 8): start moved within a month, across
  months, onto Year Day (monthly and weekly `dropped`), onto Leap Day; every row of the §2.11 adaptation table
  (yearly onto Year Day `converted` to Every Year Day; Every Leap Day onto IFC June 28 `converted` to
  yearly; Every Year Day onto Leap Day `converted`; Holy Women to another leap year unchanged); every
  `DraftIssue`, including `out-of-range` (a start in 1582, a timed end on 9999-12-30); `laterCount` for
  the `dropped` rows (a count, an until and an endless series); `thirteen-repeat-not-allowed` for a
  13-month yearly repeat on IFC March 3 moved to March 4 on a `gregorian-only` calendar (the drag check of
  §2.11); defaults at 10:20
  (11:00 to 12:00), at 23:30 (the next whole hour would be tomorrow, so 23:00 to 24:00 on the selected
  day, `display` D+1 00:00), on a day that is not today (09:00 to 10:00), all-day (Free); `setDraftAllDay`
  with and without a touched Show as; alarm presets both kinds, 12 and 24-hour labels.
- `merges` (15): one field changed here; one changed elsewhere (kept, not written); the same field
  changed on both sides (conflict); both sides made the same change (no conflict); a time change here and
  a notes change elsewhere; a recurrence change here.
- `alarmInstants` (15), with device zones Europe/Tallinn and America/New_York: relative alerts on timed
  occurrences on spring-forward and fall-back days (exact, from the occurrence's `startUtc`), "On the day
  at 09:00" and "1 day before at 09:00" for all-day events on those days (09:00 wall clock), an absolute
  alert, and an alert that would fire before year 1 (null).
- `monthLayouts` (15): the mockup data set's IFC October 2026 (§6.7), with `maxLanes` 2, 4 and
  unlimited; IFC June 2024 with a bar from June 27 through Leap Day to Sol 2 (continues into the band and
  the next month); IFC December 2026 with a bar from December 27 through Year Day to January 2, 2027;
  Positivist Bichat 2024 with both festivals (two bands); a bar longer than the month; an occurrence
  entirely outside the month (ignored); a 23-hour timed event across midnight (two dots); a 24-hour event
  (bar); zero-length event; 9999 December with an all-day event on 9999-12-31; ties broken by title and
  key.
- `weekLayouts` (10): IFC October 2026 week 2 (the mockup week); IFC December 2026 week 4 (8 columns,
  Year Day); IFC June 2024 week 4 (Leap Day column); Positivist Bichat 2024 week 4 (9 columns); all-day
  bars across the intercalary column; overnight timed event; a 10-way overlap at 14:00 with `maxSlots` 3
  (2 visible slots and one overflow of 8) and with `maxSlots` unlimited.
- `dayLayouts` (18): no overlap; two overlapping; three in a chain (A overlaps B, B overlaps C, A not
  C: 2 slots); nested; equal starts; touching end to start (no overlap); zero-length events and the
  15-minute minimum; clipping at midnight; spring-forward and fall-back wall-clock days; the 10-way
  overlap with `maxSlots` 1, 4 and unlimited; two separate clusters where only one overflows.
- `agendas` (8): multi-day parts, a 3-day all-day event crossing Year Day, ordering, empty days.
- `yearMarks` (4): 2024 (leap) and 2026 with more than three calendars on a day.
- `zones` (29, used by every platform's adapter tests): `America/New_York` 2026-03-08T02:30 (gap:
  03:30 local, 07:30Z), 2026-11-01T01:30 (overlap: first, 05:30Z); `Europe/Tallinn` 2026-03-29T03:30
  (gap), 2026-10-25T03:30 (overlap); `Australia/Lord_Howe` 2026-10-04T02:15 (30-minute gap);
  `Pacific/Apia` 2011-12-30T09:00 (day skipped: offset before the gap); `America/Sao_Paulo`
  2018-11-04T00:00 (midnight skipped); `Asia/Kathmandu` +05:45; `UTC`; and the reverse conversions,
  including UTC `UNTIL=20261231T215959Z` to the local until date in `Europe/Tallinn`; the range edges
  (9999-12-31T23:00 America/New_York and 0001-01-01T01:00 Asia/Tokyo to UTC: null). Run by every port
  through its own `ZoneResolver` and core's `zonedToUtc`, the only section that is; a port's exclusions
  are listed by case id (above).
- `zoneOffsets` (64, generated, not hand-listed): one entry per zone and UTC year that the `series`,
  `alarmInstants` and `untils` cases, the mockup file and the `fixtures/ics` expectations touch,
  recorded from Node's `Intl` while the generator computes them (above).

Oracles in `packages/core/test/events/` (dev dependencies only): Node's `Intl` for zones; `ical.js` 2.2
(MPL-2.0, Mozilla) to cross-check every Gregorian `expansions` case and the `.ics` reader (outside ten
cases where `ical.js` departs from RFC 5545 or §4.6, listed with their reasons in `ICAL_DEVIATIONS` in
`fixture-sections-c4.test.ts`, each pinned to hand-checked values and asserted to still differ, so the
list stays minimal: February 29 moved to March 1, `BYWEEKNO=1` as every Monday, a start the rule does not
produce dropped, the start dropped with `RDATE`s and no `RRULE`, an `RDATE` on a rule date shown twice, a
second `COUNT` `RRULE` stopped early, `EXRULE` ignored, `DAILY;BYYEARDAY` rejected, an all-day `HOURLY`
event failing, February 30 moved to March 2); the engine's own
`fromThirteen` for every 13-month date. On Apple, `ThirteenKit` tests also expand every `BYYEARDAY`
case with Foundation's `Calendar.RecurrenceRule` (macOS 15+) as a second oracle. Foundation is not the
engine that expands events for `EKEventStore.events(matching:)` and Calendar.app (the calendar daemon
does), so the Apple team also runs every form (b) and (c) rule through real EventKit on the iOS simulator
(`EventKitExpansionTests`, §6.2) before the manual gate V1.

### 5.6 `fixtures/ics/`

A conformance set for the `.ics` module, shared by TypeScript and C#:

```
fixtures/ics/
  README.md                       what each file tests, where it came from (anonymized)
  index.json                      the manifest: version, complete, counts, now, device zones, default window,
                                  every case with its round-trip kind, and every procedure file
  cases/*.ics                     inputs
  expected/*.json                 per input: calendar fields (with the components kept as read in `others`),
                                  warnings, groups (uid, start/end as IcsDateValue, rule text, rdates, exdates,
                                  overrides, alarms), and expanded occurrences for 2026-01-01T00:00 to
                                  2027-12-31T24:00 in two device zones, Europe/Tallinn and America/New_York, as
                                  EventOccurrence JSON (cases about other years add their own windows and zones)
  roundtrip/*.ics                 serializeICalendar(parseICalendar(input), zones, { now }) for every case, byte for
                                  byte; kind "as-read": equal to the input with line ends normalized to CRLF and
                                  no byte order mark (raw groups are copied as read); kind "zones-added": that,
                                  plus a generated VTIMEZONE for each known zone the input names without defining
  edits/*.ics, edits/*.json       an edit applied to one group (the JSON names it) and the exact expected output
  imports/*.ics, imports/*.json   a target document, the files imported into it in order, and the exact expected document
  restore/                        the restore inputs (below), restore.json with the exact results
```

Every value that needs zone data is computed through the `RecordedZoneResolver` built from the
`zoneOffsets` of `fixtures/events.json` (§5.5). A case is read with `parseICalendar(text, { calendarId,
zones })`, `calendarId` being the file name without `.ics`; its occurrences come from `expandCalendar`
(`eventsFromCalendar` plus its warnings, §5.4) with system `ifc`; its round trip is written with the
manifest's `now` (`2026-10-19T06:41`). Three cases round-trip with kind `zones-added`: `far-future.ics`,
`unknown-tzid.ics` and `window-edges.ics` name known zones without a `VTIMEZONE`, and the writer adds
a generated one for each (§5.4); the other 28 are `as-read`. The `imports/` and `restore/` expectations
are produced by reference implementations of the §2.17 import and restore merges,
`importCalendar` and `restoreCalendar` in `packages/core/scripts/ics-procedures.ts`; Windows and the web
implement the same steps (§2.17) and compare with the exact documents. Everything under `fixtures/ics` is
generated by `pnpm fixtures`, inputs included. Counts as generated: 31 cases, 5 edits, 5 imports, 1
restore, and 14 procedure inputs (`index.json` `counts`).

Phase 0 adds one case, which the Core team generates with the marker change of §5.4 (the case count
grows to 32 when it lands): `google-export.ics`, Thirteen-written series as Google Calendar's web export
gives them back (phase 0, §8.2): the TEXT-escaped `X-THIRTEEN-RULE`, one `RDATE;TZID=` property per
value, the leap-interval rule as `FREQ=YEARLY;UNTIL=20960617;INTERVAL=4`, and a "This event" override
with `RECURRENCE-ID;TZID=`, `SEQUENCE:0` and no marker. Every series is recognized from its marker
(`source: 'marker'`).

Cases (at least): `google-holidays.ics` (a trimmed copy of the public US holidays feed, all-day events
2021 onward), `google-secret.ics` (timed events with `TZID=Europe/Tallinn`, `RRULE` with `UNTIL` in UTC,
`EXDATE`, an override with `RECURRENCE-ID`, a canceled override), `icloud-export.ics` (Apple `VTIMEZONE`,
`X-APPLE-*` properties, `VALARM` with `X-WR-ALARMUID`, `X-APPLE-TRAVEL-ADVISORY-BEHAVIOR`),
`outlook-publish.ics` (Windows zone ids `FLE Standard Time` with `VTIMEZONE`, `X-MICROSOFT-CDO-BUSYSTATUS`),
`fastmail.ics`, `thunderbird.ics`, `thirteen-roundtrip.ics` (every 13-month form with markers), `folding.ics`
(multi-byte characters across the fold), `escapes.ics`, `line-endings.ics` (LF and CR), `bom.ics`,
`duration.ics`, `period-rdate.ics`, `floating.ics`, `unknown-tzid.ics`, `broken.ics` (unclosed `VEVENT`,
bad dates, missing `UID`), `components.ics` (`VTODO`, `VJOURNAL`), `marker-mismatch.ics` (an
`X-THIRTEEN-RULE` that disagrees with its `RRULE`), `rscale.ics`, and:

- `far-future.ics`: all-day events on 9999-12-31 (kept), a timed event at 9999-12-31T23:00 in
  America/New_York (its UTC instant is in year 10000, so it is dropped on every device with
  `out-of-range`), one at 9999-12-31T15:00 in Europe/Tallinn (kept in Tallinn; dropped on a
  Pacific/Kiritimati device, where it would be 03:00 on January 1, 10000), a daily repeat that runs into 9999-12-31 (stops there),
  and an all-day event with `DTEND;VALUE=DATE:10000101` (read as ending `9999-12-31T24:00`); expected
  output for the window 9999-01-01 to `9999-12-31T24:00` in the two device zones plus
  Pacific/Kiritimati, a third device zone used only by this case.
- `until-instant.ics`: a weekly 19:00 Europe/Tallinn series with `UNTIL=20261116T165959Z` and its
  continuation from November 16 (no duplicate on November 16); `UNTIL=20261116T000000Z` on the same event.
- `rrule-rdate.ics`, `exrule.ics`, `two-rrules.ics`: extra dates (one with its own time, one `PERIOD`
  longer than the master), `FREQ=WEEKLY;COUNT=3` plus one `RDATE` (4 occurrences), an `RDATE` after the
  `UNTIL` (shown), an `EXRULE`, two `RRULE`s; expected occurrences equal `ical.js`.
- `duplicate-uid.ics`: two masters with one `UID`, a repeated `RECURRENCE-ID`, an exact duplicate
  component; expected keys with `#2` and the `duplicate-uid` warnings.
- `override-only.ics`: an invited single instance (an override without its master), imported on top of
  `google-secret.ics` (merged into its master), into an empty calendar (stored as read, shown as a
  single event through the orphan path, counted as added), and an older copy of the same file imported
  over an override that was edited in Thirteen (unchanged; the edit stays) and a newer one (replaces it,
  the stored master byte for byte).
- `missing-uid.ics`: two events without `UID`, imported twice into the same calendar (no duplicates).
- `window-edges.ics`: the Winter break across January 1, an event at 01:00 on January 1 in
  Pacific/Kiritimati (expected also for device zone Pacific/Honolulu), overrides moved across January 1.
- `ny-2005-2026.ics`: America/New_York events in 2005 (one of them on January 10, 2005) and 2026,
  exported with a generated `VTIMEZONE` that holds both rule periods, the first with onsets in 2004
  (§5.4), the current one without `UNTIL`; `jerusalem.ics`: Asia/Jerusalem events in 2026 and 2029.
  With `America/New_York` removed from `ical.js`'s zone registry, the January 2005 event is at UTC-5.
- `ny-open-ended.ics`: a never-ending weekly America/New_York repeat from Monday, January 5, 2026 as
  Thirteen exports it. The test removes `America/New_York` from `ical.js`'s zone registry, expands the
  file with only its own `VTIMEZONE`, and checks that the January 5, 2026 occurrence is at UTC-5 (before
  the first 2026 transition), a July 2030 occurrence at UTC-4 and a January 2031 one at UTC-5.
- `edits/outlook-edit-one.ics`: `outlook-publish.ics` with one event's title changed; every other group,
  the Windows zone ids and the original `VTIMEZONE` stay byte for byte.
- `edits/generated-tz-grow.ics`: a 2031 America/New_York event added to a document whose generated
  `VTIMEZONE` records 2026-2027; it is rebuilt (`X-THIRTEEN-GENERATED:2026-2031`), other groups byte for
  byte. A 2005 event added to the same document adds the pre-2007 period.
- `edits/year-9999.ics`: new all-day events on 9999-12-31 (one day: no `DTEND`) and from 9999-12-29 to
  9999-12-31 (`DURATION:P3D`), read back as ending `9999-12-31T24:00`.
- `edits/retime-until.ics`: an Outlook-style weekly series (Windows zone id, `UNTIL=20261116T170000Z`,
  last occurrence November 16 at 19:00 Tallinn) moved to 19:30: `UNTIL` becomes `20261116T215959Z` and
  November 16 stays, every other byte of the rule and of the other groups as read; then toggled to
  all-day (`UNTIL=20261116`, `EXDATE;VALUE=DATE`) and back to timed (`UNTIL` a UTC end of day again).
- `edits/own-time-rdate.ics`: a weekly 09:00 series with an `RDATE` at 15:00 on a Monday it also
  produces: both occurrences are read; "Delete this event only" on the 15:00 one writes
  `EXDATE;TZID=...:20261102T150000` and the 09:00 occurrence stays; a retime of the series to 10:00
  rewrites that `EXDATE` and the `RDATE` to 16:00.
- `imports/customized-tz.json` with `imports/customized-tz-a.ics` and `imports/customized-tz-b.ics`: two
  Outlook files whose different `VTIMEZONE`s are both named "Customized Time Zone", imported one after
  the other into one calendar; the second is renamed "Customized Time Zone (2)" and its events keep
  their times. A third file with the same definition as the first shares it.
- `imports/known-tz.json`: a calendar holding an event made in Thirteen in `Europe/Tallinn` (with its
  generated `VTIMEZONE`), then a Google export and an Apple export that both use `Europe/Tallinn` with
  their own, different `VTIMEZONE`s, imported into it: nothing is renamed, every imported group is
  stored byte for byte, and the document keeps one `Europe/Tallinn` `VTIMEZONE` (Thirteen's, rebuilt
  if the imported events reach outside its years). The same imports into an empty calendar keep the
  Google file's `VTIMEZONE`.
- `imports/baseline.json`: a Google export imported, edited in Thirteen, then a newer and an older Google
  export imported over it (the newer replaces, the older is unchanged; the baseline line in the raw text);
  a Google export over an event created in Thirteen with the same `UID` (the newer version wins).
- `restore/`: two local calendars and one subscription as Thirteen exports them (one file each, and the
  same as one `.zip`), used by the restore tests, plus `restore/older.ics`, an earlier export of the
  first calendar: restoring it over the calendar edited since keeps the edit (counted as kept newer) and
  brings back a deleted event, and restoring the same file twice leaves one calendar with the same id.

### 5.7 Port naming

Ports follow their existing idioms (apple/README.md, android/README.md and windows/README.md tables); the
fixtures are the contract. Main names:

| TypeScript | Swift | Kotlin | C# |
|---|---|---|---|
| `LocalDateTime` | `struct LocalDateTime: Hashable, Comparable, Sendable` | `data class LocalDateTime` | `readonly record struct LocalDateTime` |
| `parseLocalDateTime` | `LocalDateTime(iso:) throws` | `LocalDateTime.parse` / `parseOrNull` | `LocalDateTime.Parse` / `TryParse` |
| `normalizeEventEnd`, `occurrenceDays` | `LocalDateTime.normalizedEnd(start:end:)`, `occurrenceDays(from:to:)` | `normalizeEventEnd`, `occurrenceDays` | `EventTime.NormalizeEnd`, `EventTime.OccurrenceDays` |
| `RRule`, `parseRRule`, `formatRRule` | `RRule`, `RRule(text:)`, `.text` | `RRule`, `RRule.parse`, `.format()` | `RRule`, `RRule.Parse`, `.ToString()` |
| `ThirteenRule` | `enum ThirteenRule` | `sealed interface ThirteenRule` | `abstract record ThirteenRule` |
| `encodeThirteenRule` | `rule.encoding(start:)` | `rule.encode(start)` | `rule.Encode(start)` |
| `EventRecurrence`, `expandRecurrence` | `EventRecurrence`, `.expand(start:in:limit:)` | `.expand(start, window, limit)` | `.Expand(start, window, limit)` |
| `recognizeRecurrence` | `Recognition(_:system:)` | `Recognition.of(input, system)` | `Recognition.Of(input, system)` |
| `describeRecurrence`, `repeatPresets` | `.description(start:system:)`, `RepeatPreset.all(start:system:)` | `.describe(...)`, `RepeatPreset.all(...)` | `.Describe(...)`, `RepeatPreset.All(...)` |
| `layoutThirteenMonthEvents` etc. | `ThirteenMonthEventLayout(year:month:occurrences:system:maxLanes:)` | `ThirteenMonthEventLayout(...)` | `new ThirteenMonthEventLayout(...)` |
| `monthColumnGregorianWeekdays`, `formatChipTime` | `ThirteenMonthEventLayout.columnGregorianWeekdays(year:month:system:)`, `ChipTime.text(minute:use24Hour:)` | `monthColumnGregorianWeekdays(...)`, `ChipTime.text(...)` | `MonthColumns.GregorianWeekdays(...)`, `ChipTime.Text(...)` |
| `describeNextOccurrences`, `describeRepeatNotes` | `.nextOccurrencesText(start:system:count:)`, `.repeatNotes(start:system:)` | `.describeNext(...)`, `.repeatNotes(...)` | `.DescribeNext(...)`, `.RepeatNotes(...)` |
| `agenda`, `yearEventMarks` | `AgendaDay.days(...)`, `YearMark.marks(...)` | `AgendaDay.days(...)`, `YearMark.marks(...)` | `AgendaDay.Days(...)`, `YearMark.Marks(...)` |
| `ZoneResolver`, `zonedToUtc`, `utcToZoned` | `protocol ZoneResolver`, `ZoneMath.utc(from:zone:using:)`, `ZoneMath.local(from:zone:using:)` | `interface ZoneResolver`, `ZoneMath.toUtc(...)`, `ZoneMath.toZoned(...)` | `IZoneResolver`, `ZoneMath.ToUtc(...)`, `ZoneMath.ToZoned(...)` |
| `untilInZone`, `untilEndDate`, `formatUntil` | `RRuleUntil.local(zone:using:)`, `LocalDateTime.untilEndDate(startMinute:)`, `RRuleUntil.text(endDate:allDay:zone:using:)` | `untilInZone(...)`, `untilEndDate(...)`, `formatUntil(...)` | `Until.InZone(...)`, `Until.EndDate(...)`, `Until.Format(...)` |
| `mergeDraft`, `changedFields`, `alarmFireTime` | `EventDraft.merged(original:edited:current:)`, `.changedFields(to:)`, `Alarm.fireTime(...)` | `mergeDraft(...)`, `changedFields(...)`, `alarmFireTime(...)` | `DraftMerge.Merge(...)`, `DraftMerge.ChangedFields(...)`, `Alarm.FireTime(...)` |
| `applyToSeries` | `EventDraft.appliedToSeries(master:opened:override:)` | `applyToSeries(...)` | `DraftMerge.ApplyToSeries(...)` |
| `OriginalDate` | `struct OriginalDate: Hashable, Sendable` | `data class OriginalDate` | `readonly record struct OriginalDate` |
| recorded resolver (tests only) | `RecordedZoneResolver` (test target) | `RecordedZoneResolver` (test source set) | `RecordedZoneResolver` (`Thirteen.Core.Tests`) |
| `splitRecurrence`, `retimeExceptions`, `laterOccurrenceCount` | `.split(start:at:overrideDates:change:)`, `.retimed(overrideDates:from:to:newRecurrence:minuteDelta:allDay:)`, `.laterCount(start:at:)` | `.split(...)`, `.retime(...)`, `.laterCount(...)` | `.Split(...)`, `.Retime(...)`, `.LaterCount(...)` |
| `expandSeries` | `SeriesExpansion.expand(_:window:deviceZone:zones:limit:)` | `expandSeries(...)` | `SeriesExpansion.Expand(...)` |
| `thirteenRuleRdateParts`, `parseDateList`, `formatDateList`, `formatDetachedUri` | not ported (Android only) | `rule.rdateParts(...)`, `DateList.parse(...)`, `DateList.format(...)`, `DetachedUri.format(...)` | not ported (Android only) |
| errors | `throws(ThirteenError)` with new cases `.invalidEvent`, `.invalidRule` | `ThirteenException` subclasses | `ThirteenException` with new `ThirteenErrorKind` values |

A port's parity test lists the sections and fields it does not implement (Swift and C#: `dateLists` and
the `parts` field of `thirteenRules`); every other section is required in every port, including `series`
in Swift (Apple displays EventKit's expansion, but the shared pipeline is ported so the four engines stay
identical) and `zoneMath` (through a synthetic `ZoneResolver` in each port's test), and the `counts` must
match. `series`, `alarmInstants`, `untils` and the `.ics` conformance cases run through the
`RecordedZoneResolver` of `zoneOffsets`; only `zones` runs through the port's own resolver, and its
exclusions are listed by case id with a reason (§5.5).

Each port's README gets an "Events" table like the ones above, written by its team.

---

## 6. Platform plans

### 6.0 Order of work, dependencies and file ownership

**Order.** Work runs in this order. A phase starts when its inputs are merged on `main`; nothing in a
later phase is "done" before the earlier phase's outputs it depends on are merged.

| Phase | What | Starts when | Done when |
|---|---|---|---|
| 0. Probes (week 1, in parallel with phase 1) | gates V1, V2, V3, V10, V12 and V23 run with hand-made events and the scratch harness | spec v3 merged | results recorded (§8.2), or a gate the owner defers recorded with the fallback that ships in its place (v3.3: V2's Android leg, V3 and V10, §8.2); §4.4 and §4.7 changed if a probe requires it, before C3 and C4 are marked complete (the probes ran on 2026-10-19; results and the legs still open: §8.2 "Phase 0 results") |
| 1. Core and fixtures | C1 to C10 (§6.1): `packages/core` events, recurrence, occurrences, layout, `.ics`; `fixtures/events.json`; `fixtures/ics/`; `fixtures/mockup/mockup-events.json` | spec v3 merged (work begun on v2 continues; it adopts the v3 changes listed in §9 before its task is marked done) | C6 and C8 marked complete (`"complete": true`) |
| 2. Ports and data layers | Ports: A1, D1, W1, W2. Data layers: A2, A3, D2, D3, W3, W4, B2 | each port: the fixture sections it uses are published; each data layer: the §3 types (day 1), switched to the ported types when its port lands | parity tests green in Swift, Kotlin and C#; each platform's store passes its own tests against fakes and the real store |
| 3. UI, per platform | Apple A4 to A9, Android D4 to D8, Windows W5 to W9, Web B1, B3 to B7 | the team's fake store task (A2, D2, W3, B1) | every screen of §2 runs on the real store and the ported core; the team's screenshots match the board |
| 4. QA and verification | A10, A11, D9, D10, W10, W11, B8; every gate of §8.2; accessibility passes | the team's phase 3 tasks | §8.3 items 1 to 3 and 7 to 9 for that platform |
| 5. Release | privacy and store texts (§7), screenshots, B9, A12, the release checklist (§8.3) | phase 4 on every platform | §8.3 complete |

Phase 3 work may begin on a fake store before the team's port lands (fakes load
`fixtures/mockup/mockup-events.json`, §6.7, so screens and screenshots match `design/events/mockups.html`),
but a phase 3 task is done only when it runs on the real store and the ported engine.

Fixture sections are published by the Core team in this order and announced as each lands:
`localDateTimes`, `endForms`, `wallClock`, `zoneMath`, `rrules`, `rruleEquality`, `untils`, `dateLists`,
`thirteenRules`, `ruleFromStart`, `expansions`, `endBefore`, `splits`, `retimes`, `recognitions`,
`presets`, `descriptions`, `nextOccurrences`, `repeatNotes`, `adaptations`, `drafts`, `newDrafts`,
`merges`, `seriesEdits`, `alarms`, `chipTimes`, `monthColumns`, the layout sections (`monthLayouts`,
`weekLayouts`, `dayLayouts`, `agendas`, `yearMarks`), then the sections that need zone data: `zones`
(the platform's own resolver), `series` and `alarmInstants` (the recorded resolver). `zoneOffsets` is
published with `untils` and regenerated whenever a section that uses it grows. `fixtures/mockup/mockup-events.json` is published with `recognitions` (it needs
the rule texts). Ports pin to the section list in their parity test and fail on unknown sections only
after the Core team marks the file complete (`"version": 1` plus `"complete": true`, removed at 1.0).
Every section carries its case count in `counts`, and every port asserts it.

```
Phase 0  probes V1 V2 V3 V10 V12 V23 ......................................... (can change §4.4, §4.7; V2 Android, V3, V10 deferred: fallbacks)
Phase 1  C1 time+zones+model ─ C2 rrule+date lists ─ C3 thirteen-rules ─ C4 recurrence+occurrences ─ C5 layout ─ C6 fixtures complete
                                    └─ C7 ics (needs C2, C4) ─ C8 fixtures/ics complete ─ C9 exports ─ C10 docs, CI
Phase 2  A1 Swift port   D1 Kotlin port   W1 C# events, W2 C# ics          (ports, need C6 / C8)
         A2, A3 EventKit D2, D3 provider   W3 store, W4 subscriptions  B2 IndexedDB + subscriptions   (data layers)
Phase 3  A4..A9          D4..D8            W5..W9                      B1, B3..B7                       (UI per platform)
Phase 4  A10 A11         D9 D10            W10 W11                     B8                               (QA, gates)
Phase 5  A12             D10 notes         W11 release                 B9                               (texts, screenshots)
```

**File ownership.** Nobody edits another team's files. Each team owns whole trees; a file outside every
tree belongs to exactly one team below. The trees do not overlap, and each shared file appears once.

| Team | Owns (whole trees) | Shared files it alone changes |
|---|---|---|
| Core | `packages/core/**`, `fixtures/**` | `docs/SPEC.md`, `README.md` (root), `docs/RELEASING.md`, `.github/workflows/ci.yml`, `docs/events-verification/README.md`, root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `scripts/design/check-contrast.mjs` (only the event chip cases of §2.20) |
| Apple | `apple/**` | `scripts/release/mac-dmg.sh`, `scripts/release/ios-upload.sh`, `scripts/release/common.sh`, `docs/store/app-store.md`, `docs/screenshots/ios-*.png`, `docs/screenshots/macos-*.png`, `docs/events-verification/apple.md` |
| Android | `android/**` | `docs/screenshots/android-*.png`, `docs/events-verification/android.md` |
| Windows | `windows/**` | `docs/screenshots/windows-*.png`, `docs/events-verification/windows.md` |
| Web | `packages/ui/**`, `apps/web/**` (including `apps/web/public/privacy.html`, `support.html` and the new `alerts-sw.js`) | `docs/screenshots/web-*.png`, `docs/events-verification/web.md`, `.github/workflows/pages.yml` |

`pnpm-lock.yaml` is generated, never edited by hand, and is the one file two teams change, in a fixed
order: Core's C1 pull request adds `ical.js` to `packages/core/package.json`; Web's B1 pull request then
adds `fake-indexeddb`, `@playwright/test` and `@axe-core/playwright` to `apps/web/package.json`, rebased
on C1. Each commits the lockfile that `pnpm install` produces, and no other pull request changes it.
`design/tokens.json`, `scripts/design/**` and the generated `ThemeTokens` files in each tree do not change
in this work, except the event chip cases that Core adds to `scripts/design/check-contrast.mjs` (§2.20):
event colors are data (§3.6), and a new token needs a spec pull request.

`docs/EVENTS.md` and `design/events/**` change only through spec pull requests reviewed by the owner.
Changes another team needs in a file it does not own (for example a CI job for Android or Windows in
`ci.yml`) are requested from the owning team. The per-platform sections below list the files each team
expects to add or change; they are a plan, not the ownership rule.

### 6.1 Core (TypeScript)

Libraries: none at runtime. Dev only: `ical.js` 2.2.1 (MPL-2.0) as a test oracle, added in C1 (§6.0, lockfile
order).

| # | Task | Depends on | Done when |
|---|---|---|---|
| C1 | `events/time.ts` (including `ZoneResolver`, `zonedToUtc`, `utcToZoned`, `displayEnd`), `events/model.ts` (types, `validateDraft` with `out-of-range`, `newEventDraft`, `moveDraftStart`, `setDraftAllDay`, `changedFields`, `mergeDraft`, `applyToSeries`, `alarmFireTime`, alarm presets and descriptions) | spec | unit tests; `localDateTimes`, `endForms`, `wallClock`, `zoneMath`, `drafts`, `newDrafts`, `merges`, `seriesEdits`, `alarms` sections |
| C2 | `events/rrule.ts` parse, format, equality, `untilInZone`, `untilEndDate`, `formatUntil`; `events/date-lists.ts` | C1 | `rrules`, `rruleEquality`, `untils`, `dateLists` sections; every fixture round-trips |
| C3 | `events/thirteen-rules.ts`, including `thirteenRuleRdateParts` and the marker and detached URIs | C2, phase 0 results | `thirteenRules`, `ruleFromStart`; every encoding cross-checked by expanding it with `ical.js` for 2024 to 2104 and comparing with `thirteenRuleDatesInYear` |
| C4 | `events/recurrence.ts`: expansion (rule ends before extra dates, `foreign` rules, the calendar-time guard), ends, `laterOccurrenceCount`, `splitRecurrence` (`droppedCount`, extra dates, `foreign` heads), `retimeExceptions` (own-time extra dates and exclusions, all-day toggles, `untils`), `OriginalDate` matching by date and minute, presets, descriptions, `describeNextOccurrences`, `describeRepeatNotes`, recognition (instant `UNTIL`, prefix matching), adaptation; `events/occurrences.ts` (`expandSeries`) | C3 | `expansions` (Gregorian cases equal `ical.js` outside the ten deviations listed in `ICAL_DEVIATIONS`, §5.5), `endBefore`, `splits`, `retimes`, `recognitions`, `presets`, `descriptions`, `nextOccurrences`, `repeatNotes`, `adaptations`; `series` and `alarmInstants` through the Node `Intl` resolver |
| C5 | `events/layout.ts`, including `monthColumnGregorianWeekdays`, timeline `maxSlots` overflow and `formatChipTime` | C1 | `chipTimes`, `monthColumns`, `monthLayouts`, `weekLayouts`, `dayLayouts`, `agendas`, `yearMarks`; performance: 2,000 occurrences laid out for a month in under 5 ms, a year of 500 recurring events expanded with `expandSeries` in under 50 ms, the worst-case guard (an impossible daily rule from year 1) in under 100 ms (Node, M-class laptop) |
| C6 | `scripts/events-fixtures.ts`, `scripts/mockup-events.ts` (§6.7), `generate-fixtures.ts` writes all three files, `test/events/fixtures.test.ts` staleness check, `zones` section from `Intl`, `zoneOffsets` recorded while generating, a `RecordedZoneResolver` used by the TS tests of `series`, `alarmInstants`, `untils` and `fixtures/ics`, `tzVersion` and `counts` | C1 to C5 | `pnpm fixtures` reproducible; `events.json` under 700 kB (`EVENTS_FILE_BUDGET_BYTES`, §5.5); marked complete |
| C7 | `ics/` reader (raw text per component, UID groups, duplicates, derived UIDs, the year-10000 all-day end), writer (raw groups copied, per-period `VTIMEZONE`s with an open-ended last period and `X-THIRTEEN-GENERATED`, rebuilt when the years grow, original `TZID`s, the year-9999 all-day end), `replaceGroup`, `groupVersion`, `withImportBaseline` (per override in groups without a master), `renameCollidingTimeZones` (file-defined names only), override-only groups and per-override versions, the first `VTIMEZONE` onset before the first year, retimed `UNTIL`s, zones (CLDR `windowsZones` table generated by a script into `ics/windows-zones.ts`, Unicode License v3), `eventsFromCalendar` on `expandSeries` | C2, C4 | unit tests; `ical.js` agrees on every `fixtures/ics` case's occurrences outside `FIXTURE_DEVIATIONS` in `test/ics/oracle.test.ts` (each a whole file or a UID with its reason, asserted to still differ: `DURATION` hours added on the wall clock, `broken.ics`, the second override of `duplicate-uid.ics`, the year-10000 `DTEND` of `far-future.ics`, `RSCALE`), and the two pinned places where `ical.js` departs from the gap and overlap rule of §3.3 |
| C8 | `fixtures/ics/` cases (§5.6, including `edits/` and `restore/`), expected JSON for both device zones, round-trip outputs, README | C7 | TS conformance test green; marked complete |
| C9 | `package.json` exports `"./ics"`; `index.ts` exports; `API.md` "Events" and "ICS" sections | C1 to C7 | `pnpm typecheck` with `tsconfig.src.json` (no DOM, no Node) |
| C10 | `docs/SPEC.md` §5 (Calendar section) and §7 (pointer to this file), `fixtures/README.md` (events.json, ics and mockup), root `README.md` (§7.5), `docs/events-verification/README.md` (the gate table of §8.2 with links to the four team files), CI (`pnpm fixtures` staleness for all three files, the jobs of §6.6 including the macOS job), the event chip cases in `scripts/design/check-contrast.mjs` (§2.20) | C6, C8 | review by all teams; the macOS job green on `main`; the contrast check passes |

### 6.2 Apple (iPhone, iPad, Mac)

**Build and permissions** (`apple/project.yml`):

- Both app targets: `INFOPLIST_KEY_NSCalendarsFullAccessUsageDescription: "Thirteen shows the events from
  your calendars in its 13-month views and saves the events you add or change to the calendar you
  choose."` No write-only key, no legacy `NSCalendarsUsageDescription` (TN3152).
- Mac target entitlements (`entitlements.properties` in `project.yml`, generating
  `macOS/Thirteen.entitlements`): add `com.apple.security.personal-information.calendars: true` (covers
  App Sandbox and Hardened Runtime).
- `ThirteenAppTests` and a new `ThirteenUITests` target (iOS simulator) get the new sources.
- `scripts/release/mac-dmg.sh`: next to the sandbox check, fail unless
  `codesign -d --entitlements :- Thirteen.app` contains the calendars entitlement and the bundle's
  `Info.plist` has `NSCalendarsFullAccessUsageDescription`. `scripts/release/ios-upload.sh`: fail without
  the purpose string.
- Calendar access testing on the Mac needs Apple Development signing (ad-hoc signed builds lose the TCC
  grant on every rebuild) and launching through `open`, not the bare executable. Reset with
  `tccutil reset Calendar com.haugas.thirteen`. Simulator: `xcrun simctl privacy booted grant|revoke|reset
  calendar com.haugas.thirteen`.

**Architecture** (Swift 6, strict concurrency, approachable concurrency as configured):

```
apple/Shared/Events/
  CalendarStore.swift        protocol CalendarStore: Sendable { authorizationStatus, requestAccess(), calendars(),
                             occurrences(in: DateInterval, calendars: Set<String>) async throws -> [OccurrenceSnapshot],
                             event(key:) , save(draft:, span:, target:), saveAlarms(key:, alarms:), remove(key:, span:),
                             changes: AsyncStream<Void>, refreshSources(), reset() }
  EventKitStore.swift        actor EventKitStore: CalendarStore; the only EKEventStore in the process; returns Sendable
                             snapshots (OccurrenceSnapshot, CalendarSnapshot with sRGB color, RecurrenceSnapshot as core
                             RRule + end); maps EventDraft onto a freshly fetched EKEvent inside the actor
  FakeCalendarStore.swift    in-memory store with the mockup data set and switchable authorization (tests, previews, QA)
  EventKitMapping.swift      EKEvent <-> CalendarEvent / EventDraft, EKAlarm <-> Alarm, all-day end rule (pinned to what
                             EventKitRoundTripTests measures), availability, alarmsEditable for invitations (§3.5);
                             instants to dates with ThirteenKit's proleptic day arithmetic (§3.1.1); applies only the
                             written field groups of mergeDraft to the fetched EKEvent (§4.9)
  FoundationZoneResolver.swift  ZoneResolver on TimeZone.secondsFromGMT(for:) (§5.2)
  RecurrenceMapping.swift    EKRecurrenceRule <-> RRule (frequency, interval, firstDayOfTheWeek <-> WKST, daysOfTheWeek
                             (EKWeekday = weekday + 1, weekNumber <-> ordinal), daysOfTheMonth, daysOfTheYear,
                             weeksOfTheYear, monthsOfTheYear, setPositions, recurrenceEnd)
  EventsModel.swift          @MainActor @Observable, owned by AppState: authorization, "Show my events", calendars, visible
                             set (UserDefaults "visibleCalendars" as JSON refs §3.2), collapsed account groups, default
                             calendar ("defaultCalendar"), per-Gregorian-year cache of EventOccurrence (+ snapshots by
                             key), change handling, Year dots, Up next, the access card's launch counter
  CalendarAccess.swift       status mapping to the §2.16 cards; open-settings URLs; calshow URLs (§2.10)
  EventUndo.swift            registers the undoable changes of the §2.11 table with the window's UndoManager (and only
                             those); holds pending moves and deletes and commits them on toast close (timeout, Close
                             or the next action of §2.11), scenePhase change, the next write to the same event, a
                             change notification for it, or one minute before its earliest alert; one retry on a
                             transient EKError, then the commit-failure toast and the revert of §2.11 (failures in
                             the background are kept in UserDefaults "failedCommits" with key, title, change and
                             cause, and shown at the next activation as calendar.commitFailed.later.*); removes the
                             toast's Undo when an early commit is not exactly undoable, deletes included; toast
                             timing from VoiceOver, Switch Control, AssistiveTouch (stays) and, on iPhone and iPad,
                             GCKeyboard.coalesced (20 s)
```

- `AppModel` (per window) gains `calendarMode`, `calendarDate`, `selectedEventKey`, `editor` (an
  `EventEditorState` with the draft, original, span, issues and the dirty flag) and `presentedEvent`.
- `AppSection.year` becomes `.calendar` ("Calendar", `calendar`, ⌘2). `DeepLink` parses the new routes of
  §2.22 and maps `year/...` to Calendar in Year mode.
- Never run EventKit work in a plain `nonisolated async` helper (with `NonisolatedNonsendingByDefault`
  it runs on the caller's actor): keep it in `EventKitStore` or mark it `@concurrent`. No
  `@unchecked Sendable` wrappers around EventKit objects.
- **Fetching**: one query per visible Gregorian year (local January 1 to the next January 1; for 9999 the
  end is the instant of `9999-12-31T24:00`, never a year-10000 `LocalDateTime`) with the visible calendars,
  chunked so no query spans more than 4 years; results sorted by the order key. An event crossing January
  1 comes back in both years, so every merge of years dedupes by occurrence key (§3.2). Today and Up next
  fetch the 8 days from today (two years near December 31). Nothing is fetched while "Show my events" is
  off.
- **Changes**: `.EKEventStoreChanged` (object: the store) into `AsyncStream<Void>`, coalesced 300 ms, then
  re-read authorization and calendars and invalidate the cached years. While an editor is open, call
  `event.refresh()` on the edited event inside the actor; false closes the editor
  (`editor.deletedElsewhere`). Re-check authorization at launch and on `scenePhase == .active`; call
  `refreshSourcesIfNecessary()` on activation and ⌘R / pull to refresh; call `reset()` after a transition
  to `.fullAccess`.
- **Access request**: `requestFullAccessToEvents()` from the actor. If verification V8 shows the request
  denied instantly when made off the main actor on a sandboxed Mac build, move only the request to the
  main actor with a short-lived store, then `reset()` the actor's store.
- **Write-only access**: `save` uses `defaultCalendarForNewEvents` and reads nothing back (gate V22).
- **macOS settings link**: try `x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars`;
  if `NSWorkspace.open` returns false, open System Settings (`/System/Applications/System Settings.app`)
  (V7).
- **Saving**: §3.3 mapping, §4.4 storage, §4.7 spans, §4.9 write-back. Inside the actor: fetch the event
  (or re-resolve the occurrence; none found is `editor.occurrenceGone`), run `mergeDraft(original,
  edited, current)`, and assign only the written groups' properties (never `recurrenceRules` when the
  recurrence is unchanged). New timed events get `TimeZone.current`; existing events keep their zone
  (including floating). Exchange calendars hide non-safe 13-month repeats. Invitation alert edits
  (`saveAlarms`) change only `alarms` and save with `.thisEvent` or `.futureEvents` as chosen. Moves to
  another account follow §4.7 (never for events with invitees; the 1013 fallback copies only non-repeating
  events). Errors are mapped: `.calendarReadOnly`, `.eventNotMutable` to `saveFailed.readOnly`;
  `.eventStoreNotAuthorized` to `saveFailed.access`; `EKCADErrorDomain 1013` to the fallbacks of §4.7;
  others `saveFailed.generic` with the code.
- **Views** (`Features/Calendar`): `CalendarView` (modes, the toolbars of §2.1 with `toolbarTitleMenu` on
  compact width, segmented control on regular width, drill-down on compact, `accessibilityScrollAction`
  and the paging custom actions), `YearModeView` (existing `YearView` + dots), `MonthModeView`,
  `MonthEventGridView` (a custom `Layout` placing chips by lane, or dots, §2.4), `MonthDayListView` (the
  accessibility-size list of days), `IntercalaryEventBand`, `WeekModeView` (column containers, §2.20),
  `DayModeView` (touch and hold on empty time creates a draft on iPhone, §2.6), `TimelineView` (`Canvas`
  for rules, hours and the now line drawn under the blocks, buttons for blocks and overflow blocks),
  `ListModeView`, `EventChipView`. `Features/Events`: `EventDetailView` ("Open in Calendar", "Edit
  alerts", Duplicate as an unsaved draft), `EventEditorView` (`Form`; presented as a sheet, or on iPad and
  Mac as a `.popover` anchored to the draft, cell or event per §2.11 (Duplicate: the source event; iPad
  at compact width and accessibility sizes: the sheet); `interactiveDismissDisabled(isDirty)` and a
  `UIAdaptivePresentationControllerDelegate` bridge whose `presentationControllerDidAttemptToDismiss`
  shows the discard question, for the sheet and the iPad popover alike; on the Mac the popover's
  `NSPopover.behavior` switches from `.transient` to `.applicationDefined` when the draft becomes dirty,
  and an outside click, Escape, paging or a mode switch asks first; the calendar under an open editor
  popover does not page, scroll or switch modes; inside the popover the 13-month date field and the time
  picker expand inline; date rows stack at accessibility sizes), `ThirteenDateField` and `ThirteenDatePicker` (reusing `ThirteenPickerLogic`;
  adjustable year stepper and slot strip, the 1583 floor and leap-year stepping in the editor, midnight
  ends shown as 00:00 of the next day, the large detent and list of days at accessibility sizes, §2.12),
  `RecurrencePickerView`, `CustomRecurrenceView`,
  `AlertPickerView`, `CalendarPickerView`, `CalendarsListView` (collapsible groups), `AccessCardView`
  (including the one-line form), conflict and span `confirmationDialog`s. `Features/Today/UpNextCard.swift`.
  Drag and drop with `Transferable` (`EventDragItem` carrying the key): sources are regular-width chips,
  compact day-list rows and timeline blocks; `.dropDestination` on cells and time slots; a drop with
  Option held opens the Duplicate draft at the drop (§2.4). iPad by touch (§2.4): a tap on a chip or
  block presents its details popover, touch and hold on empty Month cell space or empty time
  (`onLongPressGesture` that hands over to a drag for the draft's length) makes the draft and presents
  the anchored editor popover, and touch and hold on a chip or block starts its drag; chips get a
  `contentShape` the full cell width and the lane height. The toast (`EventToastView`) has its Close
  button (`toast.close`, 44 pt).
- **Undo**: `EventUndo` registers each change with `@Environment(\.undoManager)` (shake to undo works on
  iPhone through the window's undo manager); Edit > Undo and Redo show "Undo Move Event", "Undo Delete
  Event", "Undo Edit Event". Moves and deletes stay pending in `EventsModel` (the views show them, the
  store does not have them) until committed per §2.11; a written change that cannot be reversed exactly is
  removed from the stack with `removeAllActions(withTarget:)` for its target.
- **Commands**: File > New Event ⌘N (replaces the default New Window, which moves to ⌥⌘N on iPad), Edit >
  Undo ⌘Z and Redo ⇧⌘Z, View > Day, Week, Month, Year, List ⌃⌘1 to ⌃⌘5, View > Show Calendars ⌥⌘K, Event >
  Edit ⌘E, Delete ⌫, View > Refresh Calendars ⌘R. Existing ⌘T, ⌘← / ⌘→ step by the Calendar mode's unit.
- **Mac menu bar extra**: the "Next:" line (§2.8).
- **Logging**: `Logger(subsystem: "com.haugas.thirteen", category: "events")`; titles, notes, locations,
  URLs and attendee names only as `privacy: .private`.
- **QA launch arguments** (README table, `Shared/Support/QAOptions.swift`): `-ThirteenQAEvents fake`
  (FakeCalendarStore with the mockup data, no EventKit), `-ThirteenQAAccess
  notDetermined|denied|writeOnly|restricted|empty|noWritable` (with the fake store), `-ThirteenQAShowEvents
  off`, `-ThirteenQAEvents seed` (DEBUG builds: creates the local calendar "Thirteen QA" in EventKit and
  fills it with the mockup data once), `-ThirteenQACalendarMode day|week|month|year|list`, plus the system
  `-UIPreferredContentSizeCategoryName` for text sizes and `-AppleLocale en_US` for 12-hour
  screenshots.

**Tests**

- `ThirteenKit`: `EventsFixtureParityTests` (every section), `FoundationRecurrenceOracleTests` (every
  `BYYEARDAY` encoding expanded with `Calendar.RecurrenceRule` equals `thirteenRuleDatesInYear`, 2024 to
  2104), the `zones` section through `FoundationZoneResolver` and core `ZoneMath`, and `zoneMath` through
  a synthetic resolver.
- `ThirteenAppTests` (macOS, no app launch): `EventsModelTests` (fake store: every authorization
  transition, "Show my events", coalescing, year cache invalidation, visible-calendar persistence and the
  (source, title) fallback, the card's launch counter), `EventEditorStateTests` (defaults, start moves, "Save for all events" through
  `applyToSeries` and `span.keep.firstGone` when the first occurrence is gone,
  all-day toggles and Show as, span offering, the adaptation notices and the drag span dialog, validation
  focus order, Exchange conflict choices, immediate alert trimming, dirty tracking, merge conflicts and the
  occurrence-gone path, the later-events lines and `span.deletesLater`, `editable: false` span choices,
  the drag `validateDraft` check with an IFC March 3 yearly repeat on a `gregorian-only` calendar moved to
  March 4 (only "Move this event only"), the invitee questions for drags and deletes, the popover discard
  paths), `EventUndoTests` (pending commit triggers, including the next action, Close and an alert one
  minute away; discard while pending; the §2.11 Undo table, including an editor save of a repeating
  occurrence with no Undo and a delete committed early that loses Undo; `calendar.undoUnavailable`; a
  commit that fails (reverted, one retry; a transient cause without a reason line and with "Try again",
  which writes at once; a final cause with its reason); commits that fail in the background (one: the
  named `calendar.commitFailed.later.*` toast with "Try again" or "Show event"; two: the plural toast and
  its list); toast timing per assistive technology, 20 s with only a hardware keyboard), `RecurrenceMappingTests` (every fixture RRULE
  through `EKRecurrenceRule` and back, built without a store), `EventKitMappingTests` (unsaved
  `EKEvent(eventStore: EKEventStore())`; only written groups assigned; proleptic dates in 1500 and 1583),
  `DeepLinkTests` (new routes), and the existing `AppModelTests` updated for `.calendar`.
- `ThirteenUITests` (iOS simulator):
  - `EventKitExpansionTests`, run first (task A2), against real EventKit after `simctl privacy grant`:
    for every form (b) and (c) case of the `thirteenRules` fixture section, save the rule into a new
    local calendar, read `events(matching:)` in 4-year chunks for 2024 to 2104, compare with the fixture's
    dates, then delete the calendar. This checks the calendar daemon's expander, which Foundation's oracle
    does not, before the manual gate V1.
  - `EventKitRoundTripTests`, next to it: save 1-day, 3-day and Year-Day-spanning all-day events (and a
    timed event ending at midnight) into a local calendar, fetch them again through a new `EKEventStore`,
    and assert the same days and times; the read rule of §3.3 is pinned to what this test measures. Also:
    a title-only save of a form (b) series leaves its `recurrenceRules` unchanged; a "future events" save
    of a `COUNT=10` series at its 4th occurrence leaves a new series of 7 (the count check of §4.7), and
    the same save with End repeat set to After 3 times leaves 3 after the count check (on iCloud, phase 0
    saw EventKit leave the new series without a rule and the corrective save fix it; the test records
    whether the local store needed that save); "Save for all
    events" with a new time from the 5th occurrence of a `BYWEEKNO` series keeps the series' first date
    and every earlier occurrence, and the same series with its first occurrence deleted offers only
    "this event only"; and
    an all-day event on 1500-03-01 and a yearly series from 1248 are saved and read back, with the dates
    EventKit returns recorded in `docs/events-verification/apple.md` (§3.1.1; not asserted equal to the
    other platforms).
  - With the fake store: create, edit, "this event only" and "future events", delete and undo (toast and
    ⌘Z), drag from the compact day list, repeat picker labels, Next lines and notes, Calendars list toggles
    and collapsing, access cards for each state, discard on swipe-down, the §2.20 label table, focus after
    actions, and the no-dashes text dump (§2.19).
  - One end-to-end test against real EventKit. CI script `apple/scripts/ui-tests.sh`.
- Manual matrix: §8.2.

**Screenshots** (`docs/screenshots/`, `-ThirteenFixedToday 2026-10-19 -ThirteenQAEvents fake`):
`ios-calendar-month.png`, `ios-calendar-day.png`, `ios-calendar-list.png`, `ios-today-up-next.png`,
`ios-event-details.png`, `ios-event-editor.png`, `ios-event-date-picker.png`, `ios-repeat.png`,
`ios-calendars.png`, `ios-access-off.png`, `ios-calendar-month-dark.png`, `ios-calendar-month-ax.png`,
`ios-ipad-calendar-week.png`, `ios-ipad-calendar-month.png`, `macos-calendar-month.png`,
`macos-calendar-week.png`, `macos-event-editor.png`, `macos-menu-bar-next.png`, plus the 6.9-inch and
13-inch App Store sets in 12-hour time with the order Calendar month, Today, editor with 13-month date,
repeat picker, Year, Convert.

| # | Task | Depends on | Phase |
|---|---|---|---|
| A1 | ThirteenKit `Events/` port (including `ZoneMath`, `mergeDraft`, `splitRecurrence`, `retimeExceptions`, `expandSeries`) + parity (with `counts`) and Foundation oracle tests | C6 | 2 |
| A2 | `CalendarStore`, `FakeCalendarStore` (loads `fixtures/mockup/mockup-events.json` as a bundle resource), `EventKitStore`, `FoundationZoneResolver`, mappings (only written groups, proleptic dates), mapping tests; `EventKitExpansionTests` as soon as the `thirteenRules` section is published, then `EventKitRoundTripTests` | spec (types), A1 for recurrence | 2 |
| A3 | project.yml purpose string and entitlement, release script checks | none | 2 |
| A4 | `EventsModel` (year caches with key dedupe, pending changes), AppState/AppModel changes, `AppSection.calendar`, deep links, commands, `EventUndo` (the Undo table, pending and written undo, commit failures and failures nobody saw, early commits, the alert trigger, toast timing, the next action and Close, §2.11) | A2 | 3 |
| A5 | Calendar modes: toolbars and paging (§2.1), Year dots, Month (both densities, list of days with empty-day runs at accessibility sizes, regular width with "+N more" popover), List | A4, A1 layout | 3 |
| A6 | Week and Day timelines (overflow blocks, column containers, touch and hold to create on iPhone and iPad by touch), drag and drop (Option-drag copies as a Duplicate draft) (time-group moves, `validateDraft` before holding, the repeat-changing span dialog with counts, the invitee question) | A5 | 3 |
| A7 | Event details (invitations, Duplicate as a draft), editor (sheet and anchored popover with its discard paths and inline date and time fields, validation including `out-of-range`, later-events lines, three-way merge and its banner, occurrence-gone, conflict dialog, discard paths, write-only mode, all-day Free, adaptation notices), 13-month date field (1583 floor, leap-year stepping, midnight ends), repeat picker, custom repeat, alerts, calendar picker (same-account rule), span dialogs ("Save for all events" through `applyToSeries`, `span.keep.firstGone`), moves between accounts (§4.7) | A4, A1 | 3 |
| A8 | Today Up next, day sheet events, Mac menu bar line | A4 | 3 |
| A9 | Calendars list, Settings rows ("Show my events" first), access cards and flows | A4 | 3 |
| A10 | UI tests, accessibility pass (VoiceOver rotor and containers, Switch Control paging, Dynamic Type to AX5 with popovers as sheets and stacked date rows, Increase Contrast, keyboard), performance check (1,000 events in a year scroll at 60 fps on iPhone 12-class hardware) | A5 to A9 | 4 |
| A11 | Verification gates V1, V2 (its EventKit leg: Google is checked through Google Calendar web only for now, owner, §8.2), V4 to V8, V16, V20 to V23 (V1, V2 and V23 start in phase 0 with hand-made events) | A2 | 0 and 4 |
| A12 | Store texts (§7.3), review notes, screenshots, README | A10 | 5 |

### 6.3 Android

**Manifest** (`android/app/src/main/AndroidManifest.xml`):

```xml
<uses-permission android:name="android.permission.READ_CALENDAR" />
<uses-permission android:name="android.permission.WRITE_CALENDAR" />

<queries>
  <intent><action android:name="android.intent.action.INSERT" /><data android:mimeType="vnd.android.cursor.dir/event" /></intent>
  <intent><action android:name="android.intent.action.VIEW" /><data android:scheme="geo" /></intent>
  <intent><action android:name="android.intent.action.VIEW" /><data android:mimeType="vnd.android.cursor.item/event" /></intent>
</queries>
```

Still no `INTERNET`. Update the header comment: "Calendar permissions read and write the device's
calendars through the Calendar Provider; the OS sync adapters do all networking. Thirteen still makes no
network calls." The `<queries>` entries let Thirteen decide whether to show "Add in your calendar app",
the Location tap and "Open in calendar app" (package visibility on API 30+); every `startActivity` for
them is still wrapped in try/catch `ActivityNotFoundException`. Add to `MainActivity` an intent filter for
`android.provider.calendar.action.HANDLE_CUSTOM_EVENT` with `mimeType="vnd.android.cursor.item/event"`
(calendar apps send it for events whose `CUSTOM_APP_PACKAGE` is Thirteen); it opens that event's day,
treating the intent as untrusted (only `EXTRA_CUSTOM_APP_URI` and the event id are read).

**Only if gate V18 fails** (§2.14): add `POST_NOTIFICATIONS` and a receiver

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<receiver android:name=".data.calendar.ReminderReceiver" android:exported="true">
  <intent-filter>
    <action android:name="android.intent.action.EVENT_REMINDER" />
    <data android:scheme="content" android:host="com.android.calendar" />
  </intent-filter>
</receiver>
```

`EVENT_REMINDER` is on Android's list of implicit broadcasts that manifest receivers still get. On receipt
the receiver (`goAsync`, work on `Dispatchers.IO`) reads `CalendarAlerts` rows that are due and in state
`SCHEDULED` or `FIRED`, keeps only events in Thirteen's own LOCAL calendar, and posts one notification per
alert (channel "Event alerts", title = event title, text = `notification.body`, tap opens
`thirteen://day/{date}`), unless the Settings switch is off or notifications are not allowed. It never
changes `CalendarAlerts` rows, so a calendar app that also handles them keeps working. Still no `INTERNET`.

**Data layer** (`data/calendar/`):

```
CalendarRepository.kt        interface: permission, calendars(), occurrences(year, visible), event(key), save(draft, span),
                             saveReminders(key, alarms), delete(key, span), createDeviceCalendar(), changes: Flow<Unit>,
                             topUpHorizons()
ProviderCalendarRepository.kt ContentResolver on Dispatchers.IO; applyBatch per user action (one transaction; never
                             withYieldAllowed; never mixing sync-adapter and app URIs in one batch)
FakeCalendarRepository.kt    mockup data set, switchable permission state (tests, previews, QA)
ProviderMapping.kt           Cursor <-> CalendarEvent / CalendarInfo / EventOccurrence; ContentValues builders that
                             contain only the columns of mergeDraft's written groups (§4.9)
RecurrenceStorage.kt         §4.4 and §4.7: RRULE text, RDATE / EXDATE text through :core DateList (never hand-built),
                             form, marker URI, parts (thirteenRuleRdateParts) and their grouping by series id, top-up,
                             splits (splitRecurrence), retimes (retimeExceptions), the detached fallback, the
                             2037-12-31 cap on API 30 and lower; leaves recurrence columns untouched when unchanged
SelfExpansion.kt             reads Events + exception rows for series the provider cannot expand (BYYEARDAY) and for
                             windows outside 1902 to 2037 on API 30 and lower; expands them with :core expandSeries;
                             a form (d) series in parts once per series id (part 1's rule, every part's EXDATE and
                             exception rows, §4.4)
JavaTimeZoneResolver.kt      ZoneResolver on java.time ZoneRules (§5.2)
PendingChanges.kt            pending moves and deletes (§2.11): applied to the in-memory occurrences at once, committed
                             when the snackbar closes (timeout, its Close icon or the next action), on ON_STOP of the
                             process lifecycle, before another write to the same event, when CalendarObserver reports
                             a change to it, or one minute before its earliest Reminders alert; one retry on a
                             transient provider exception, then the revert and calendar.commitFailed.* (failures in
                             the background kept in DataStore "failedCommits" with key, title, change and cause,
                             shown at the next ON_START as calendar.commitFailed.later.*); snackbar timing from
                             getRecommendedTimeoutMillis and touch exploration
CalendarObserver.kt          ContentObserver on CalendarContract.CONTENT_URI (descendants), registered only while
                             READ_CALENDAR is granted (catching SecurityException), debounced 300 ms into a Flow
CalendarPermissions.kt       state machine of §2.16 with DataStore flags "calendarAsked", "calendarDeniedOnce",
                             "calendarCardDismissedAt", "eventsActionTried"; permanently denied = not granted, rationale was
                             shown before and is false now, or the result arrived without the activity pausing (no dialog)
ExternalCalendarIntents.kt   ACTION_INSERT fallback, ACTION_VIEW of Events/{id}, geo: intent; resolve via <queries>,
                             start in try/catch
ReminderReceiver.kt          only if V18 fails (above)
```

- **Reading occurrences**: per Gregorian year, `Instances.CONTENT_URI/{begin}/{end}` built by hand (not
  `Instances.query`, which filters on `VISIBLE`) with `begin` = local January 1 minus 14 hours and `end`
  = next January 1 plus 14 hours (so UTC-dated all-day events are included), selection
  `calendar_id IN (...)`, sort `begin ASC`; projection of research §5 (`EVENT_ID, BEGIN, END, ALL_DAY,
  TITLE, EVENT_LOCATION, DISPLAY_COLOR, CALENDAR_ID, EVENT_TIMEZONE, RRULE, RDATE, ORIGINAL_ID,
  ORIGINAL_INSTANCE_TIME, STATUS, SELF_ATTENDEE_STATUS, AVAILABILITY, CALENDAR_ACCESS_LEVEL`). Day
  bucketing is Thirteen's: all-day by the UTC date of `BEGIN` to `END` (exclusive), timed by the device
  zone. Hide `SELF_ATTENDEE_STATUS = DECLINED`. On API 30 and lower, a year outside 1902 to 2037 is read
  through `SelfExpansion` instead (§4.4). The query for 9999 ends at the instant of `9999-12-31T24:00`.
  The plus or minus 14 hours return boundary-crossing events in both years, so year merges dedupe by key
  (§3.2).
- **Self-expansion**: events whose `RRULE` contains `BYYEARDAY` (the provider expands them wrongly) are
  read from `Events` (`deleted = 0`) with their exception rows (`ORIGINAL_ID`), expanded with
  `expandSeries` (§4.6: widened window, overrides by original date, zones, range), and every `Instances`
  row whose `EVENT_ID` is a self-expanded series or whose `ORIGINAL_ID` points to one is dropped: each
  non-canceled exception row is an event of its own with its own instance, and reaches the views only as
  an override through `expandSeries`, so an edited occurrence never shows twice. The details show `event.androidByYearDay`. Their alarms still come from the
  provider's own instances (one per year), which the note says.
- **Writing**: §3.3 mapping, §4.9 write-back. Every save fetches the current row and runs `mergeDraft`;
  the update's `ContentValues` hold only the written groups' columns, so an untouched `RRULE`, `RDATE`,
  `EXDATE`, `EXRULE` or marker is never rewritten (an Apple-made `BYYEARDAY` series keeps its rule byte
  for byte). `DURATION` belongs to the time group: it is written, with the exact length of §3.3, whenever
  the master's start or end changes, and never otherwise. A recognized `BYYEARDAY` series stays form (b)
  for every change that is not a picker choice (§4.9 rule 3): a new start day writes the re-derived
  `BYYEARDAY` list, a new end adds `COUNT` or `UNTIL`, and both halves of a split are `BYYEARDAY` rules.
  While the fallback of gate V2's Android leg is in force (owner: that leg is not run for now, §8.2),
  none of these writes happens: a series whose stored `RRULE` uses `BYYEARDAY` is read-only except its
  alerts (§3.5; the Android mapping marks it next to the `CalendarEvent`, the editor, drags and deletes
  refuse it, "Edit alerts" writes only its `Reminders` rows). The form (b) cases of
  `ProviderRepositoryTest` below still test the repository's write path, which the app does not reach
  until that leg passes. Insert = `Events` insert + `Reminders` inserts with
  `withValueBackReference(Reminders.EVENT_ID, 0)`. All-day uses `EVENT_TIMEZONE = "UTC"`; recurring
  events use `DURATION` (the master's exact duration, §3.3) and no `DTEND` (switching single to repeating
  sets `DURATION` and clears `DTEND`, and back). `UNTIL` (end of the until day in the event's zone) and
  `COUNT` never together. Occurrence changes on `RRULE` and `RDATE` series alike go through
  `CONTENT_EXCEPTION_URI` (pass `STATUS_CONFIRMED`); splits, retimes and moves between accounts follow
  §4.7, each in one `applyBatch` (moves copy every exception row and every part; events with invitees do
  not move between accounts). An occurrence that cannot be re-resolved by `ORIGINAL_INSTANCE_TIME` is not
  written (`editor.occurrenceGone`). Do not write `VISIBLE`, `EVENT_COLOR`, extended properties or
  attendees. Invitation alert edits (`saveReminders`) replace only that event's `Reminders` rows.
- **13-month repeats**: form (d) in parts with horizon and marker (§4.4), written only when the user picks
  a 13-month row in the repeat picker (never by a drag, a new start or end, or a split of an Apple-made
  `BYYEARDAY` series, which keep form (b), §4.9); `CUSTOM_APP_PACKAGE` and `CUSTOM_APP_URI` set on save; `topUpHorizons()` runs on
  `ON_START` of the process lifecycle when write access is granted (at most 50 series per run; extends
  the last part, adds parts); dates capped at 2037-12-31 on API 30 and lower and at 9999-12-31; the
  same run removes duplicate parts (§4.4).
- **"Thirteen" device calendar**: `Calendars.CONTENT_URI` with `caller_is_syncadapter=true`,
  `account_name=Thirteen`, `account_type=LOCAL`; values `NAME` and `CALENDAR_DISPLAY_NAME` "Thirteen",
  `CALENDAR_COLOR` = Almanac accent, `CALENDAR_ACCESS_LEVEL = 700`, `OWNER_ACCOUNT = Thirteen`,
  `VISIBLE = 1`, `SYNC_EVENTS = 1`. Reuse an existing one with the same account (it survives reinstall).
- **Settings** (preferences DataStore): `showEvents` (default true), `visibleCalendars` (refs §3.2,
  absent = all visible), `collapsedAccounts`, `defaultCalendar`, `yearEventDots`, `calendarAsked`,
  `calendarDeniedOnce`, `calendarCardDismissedAt` (30 days), `eventsActionTried`, `accessCardLaunches`,
  `pickerTab`, and (V18 fallback) `thirteenCalendarAlerts`.
- **Process death**: revoking the permission in Settings kills the process; the saved back stack keys
  restore the screen and the access card appears. Editor drafts are saved in `SavedStateHandle` (survive
  process death) and restored.

**UI** (Compose, Material 3, Navigation3): `feature/calendar/` (`CalendarScreen` with modes and the
`TopAppBar` of §2.1 (Today action, List toggle, overflow with the system choice and "Calendars", paging
custom actions), `YearMode` (existing Year screen moved, dots), `MonthMode`, `MonthEventGrid` (custom
`Layout`, titles or dots density), `MonthDayList` (the accessibility-size list), `IntercalaryBand`,
`WeekMode` (columns as traversal groups), `DayMode`, `Timeline` (Canvas with the now line under the
blocks, focusable blocks and overflow blocks), `ListMode`, `EventChip`), `feature/events/`
(`EventDetailScreen` with "Open in calendar app", "Edit alerts" and Duplicate as an unsaved draft,
`EventEditorScreen` (full-screen dialog with the Close icon, the "Add" / "Save" text action and "Delete
event" in the overflow menu, §2.11; `BackHandler` and predictive back ask before discarding; date rows
stack at font scale 1.5 and above), `ThirteenDateField`,
`ThirteenDatePickerSheet` (`ModalBottomSheet`, reusing `:core` slot helpers; adjustable year and slot
strip), `RepeatPicker`, `CustomRepeatScreen`, `AlertPicker`, `CalendarPicker`, `CalendarsSheet`
(collapsible groups), `AccessCard` (and its one-line form), `SpanDialog`, `ConflictDialog`),
`feature/today/UpNextCard.kt`. Routes: `Route.Calendar(mode, date)`, `Route.Event(key)`,
`Route.EventEditor(draftKey)`, `Route.Calendars`. `Section.YEAR` becomes `Section.CALENDAR`. FAB for new
events. At expanded width `Route.Calendars` is an on-demand supporting pane beside the Calendar grid
(owner decision; Navigation3 `SupportingPaneSceneStrategy`, §2.1, §2.15): it is on the back stack only
after the user opens it from the overflow menu's "Calendars" or from "Show calendars", has a Close icon,
and Close or Back pops it, giving the grid its full width back; at compact and medium width it is the
`CalendarsSheet`. Day mode on phones: a tap on empty time draws the "New event" placeholder block, a tap on it opens
the editor (§2.6). Drag and drop with `Modifier.dragAndDropSource` / `dragAndDropTarget` after a long press
on compact day-list rows and timeline blocks. Undo: the snackbar's "Undo" action and its Close icon
(`withDismissAction = true`, `toast.close`, 48 dp), with `SnackbarDuration.Indefinite` while touch
exploration is on (dismissed by the next action of §2.11, Close or Escape) and otherwise the duration of
`getRecommendedTimeoutMillis` (§2.11 Toast timing); it discards the pending change (`PendingChanges`), so
on Android every Undo happens before anything is written. Strings move to `res/values/strings.xml` with the
catalogue ids (dots become underscores), plurals to `<plurals>`.

**Libraries**: none new at runtime. Tests: `androidx.test:runner`, `androidx.test:rules`
(`GrantPermissionRule`), `androidx.test.ext:junit` (Apache-2.0), Gradle Managed Devices.

**Tests**

- `:core:test`: `EventsFixtureParityTest` (every section), `EventsExhaustiveTest` (every 13-month rule's
  dates for every year 1 to 9999 against the SPEC formulas).
- `:app:testDebugUnitTest` (Robolectric, move the pin to SDK 37 now that Robolectric 4.17 supports it):
  screens with `FakeCalendarRepository` (modes, both Month densities and the accessibility list, editor
  validation and conflict, spans and the repeat-changing drag dialog, the Day placeholder, access cards for
  every state including the 30-day "Not now" and the one-line forms, "Show my events" off, TalkBack
  semantics and the §2.20 labels, `assertNoDashes()`), `CalendarPermissions` state machine,
  `PendingChanges` (commit triggers, including the next action, Close and an alert one minute away; Undo
  discards; a failed commit reverted after one retry, without a reason line and with "Try again" (which
  writes at once) for a transient cause and with its reason for a final one; a background failure shown
  at the next `ON_START` as the named `calendar.commitFailed.later.*` snackbar, two as the plural one with
  its list), `RecurrenceStorage` (text through
  `DateList`, parts and grouping, duplicate parts, top-up decisions, the API 30 cap, an unchanged
  recurrence produces no `RRULE`, `RDATE`, `EXDATE`, `EXRULE` or marker columns while a changed start or
  end still writes `DURATION`, a retime rewrites `UNTIL` through `formatUntil` from `untils`, the notes
  of §2.13 and their conditions, and the 13-month footer sentence: "Calendar apps on Android may show
  other days." for the current row of an Apple-made `BYYEARDAY` series, the V3 sentence for rows stored
  as dates), `ProviderMapping` with
  `MatrixCursor` inputs (only written groups in `ContentValues`; an all-day `DTEND` of
  253402300800000 reads as `9999-12-31T24:00`),
  `ExternalCalendarIntents` with no resolving activity.
- `:app:connectedAndroidTest` (new `androidTest` source set; Gradle Managed Devices on API 26, 30 and 37
  `google_apis` images; CI job `android-provider`): `ProviderRecurrenceTest` (records how the real
  provider expands `BYYEARDAY`, `RDATE`, `RRULE` + `RDATE`, `EXDATE`, `INTERVAL=4`, 1890 to 2400 dates,
  including `Instances` windows for 1890 to 1901 and 2038 to 2040 and an `RDATE` list crossing 2038, and
  how it treats exception rows inserted through `CONTENT_EXCEPTION_URI` on an `RDATE` series and on a
  `BYYEARDAY` series; asserts the behaviour §4.4 relies on per API level), `ProviderRepositoryTest`
  (insert, edit, all span operations on `RRULE` and `RDATE` series, all-day across Year Day, top-up and
  parts, device calendar creation and reuse, canceled exceptions, deletes of never-synced events,
  invitation reminder edits, and these cases: a title edit of a `BYYEARDAY` series keeps `RRULE`, `RDATE`
  and `EXDATE` byte for byte; "for all events" from its first occurrence keeps them too; a retime of an
  `RDATE` series rewrites every `RDATE` and `EXDATE` time and every `ORIGINAL_INSTANCE_TIME`; edited and
  canceled exceptions on a `BYYEARDAY` series, each shown once (the exception row's own `Instances` row
  dropped); a drag of the first occurrence of a `BYYEARDAY` series by one day writes a new `BYYEARDAY`
  list and no `RDATE`; setting an end date on it adds `UNTIL` to the `RRULE` and writes no `RDATE`; a
  "future events" title edit from a later occurrence leaves a `BYYEARDAY` head and a `BYYEARDAY` tail; an
  end-time edit of a series updates `DURATION` and keeps `RRULE`, `RDATE` and `EXDATE` byte for byte; a
  "future events" split of a `COUNT=10` series at its 4th occurrence (tail `COUNT=7`) with a canceled and
  an edited occurrence after the split (both carried); deleting a previously edited occurrence of an
  `RDATE` series cancels its exception row; "delete all future events" on an `RDATE` series with an
  edited occurrence after the cut deletes that exception row, and the same with the detached fallback
  deletes the detached copy; a retime that toggles all-day rewrites `EXDATE` to the date form and sets
  `ORIGINAL_ALL_DAY`, and one that moves the time shifts an own-time `RDATE` value by the same minutes;
  two pre-inserted copies of part 3 of a series show once and the next top-up deletes one, and when the
  losing copy holds an `EXDATE` value and an edited occurrence, both end up on the kept copy (the deleted
  occurrence stays deleted and the edit stays); on API 30, a two-part weekly series viewed in 2040 shows
  each date once; a retime of an Outlook-style series moved 30 minutes later rewrites its `UNTIL` and
  keeps the last occurrence; "Delete this event only" on an `RDATE` at its own time writes the `EXDATE`
  at that time and keeps the rule's occurrence on the same day; a weekly
  series started in 2020 is written as three parts of 210, 210 and 97 values with the 2029 horizon and
  topped up into a fourth with the 2035 horizon (parts of 210 values, §4.4); a cross-account move of a
  series with a canceled and an edited occurrence keeps both; a move of an event with attendees is
  refused), `ProviderTimeZoneTest` (zones fixture against the provider's instance times).
- Manual: §8.2 V2 (Android part), V3, V4, V5 (Android part), V9, V10, V12 to V15, V18, V20, V21 on a Pixel (Google account, Google Calendar as the
  only calendar app), a Samsung (Samsung Calendar, Exchange through Samsung Email) and a device with the
  Outlook app's calendar sync. The owner skipped the Android-to-Google checks for now: V2's Android leg,
  V3 and V10 are not run on devices, and their fallbacks ship (§8.2) unless they are run later.

**Screenshots** (`docs/screenshots/`): `android-calendar-month.png`, `android-calendar-day.png`,
`android-today-up-next.png`, `android-event-editor.png`, `android-repeat.png`, `android-calendars.png`,
`android-access.png`, `android-tablet-calendar-week.png`, `android-tablet-calendar-month.png` (QA intent
extras `thirteen.qa.today=2026-10-19`, `thirteen.qa.fakeEvents=true`, debug builds only).

| # | Task | Depends on | Phase |
|---|---|---|---|
| D1 | `:core` events port (including `ZoneMath`, `DateList`, parts, `mergeDraft`, `splitRecurrence`, `retimeExceptions`, `expandSeries`) + parity (with `counts`) and exhaustive tests | C6 | 2 |
| D2 | Manifest (`<queries>`), `CalendarPermissions`, `FakeCalendarRepository` (loads `fixtures/mockup/mockup-events.json` from debug assets) | spec | 2 |
| D3 | `ProviderCalendarRepository` (merge on save, only written columns, `DURATION` in the time group, re-resolution), `ProviderMapping`, `CalendarObserver`, `RecurrenceStorage` (write-back, form (b) kept for Apple-made series, parts and duplicate parts (exceptions merged before a copy is deleted), splits, retimes with `UNTIL`, retimes including all-day toggles, exceptions and deletes on `RDATE` series, detached fallback), `SelfExpansion` on `expandSeries`, `JavaTimeZoneResolver`, `PendingChanges`, `androidTest` set with `ProviderRecurrenceTest` first (it gates §4.4, the API 30 rules and the `RDATE` exception path) | D1, D2 | 2 |
| D4 | Navigation (`Section.CALENDAR`, routes, deep links, `HANDLE_CUSTOM_EVENT`), top app bar and paging, the Calendars supporting pane at expanded width, Calendar modes Year, Month (both densities, accessibility list with empty-day runs), List (year merges dedupe by key) | D2, D1 | 3 |
| D5 | Week and Day timelines (overflow, traversal groups, the tap placeholder), drag and drop (time-group moves, `validateDraft` before holding, the repeat-changing span dialog with counts and losses, the invitee question) | D4 | 3 |
| D6 | Details (invitations, Duplicate as a draft), editor (Close, Save, overflow Delete; validation including `out-of-range`; merge banner; occurrence-gone; conflict; back handling; all-day Free; adaptation notices and later-events lines; the retime notice), date field (1583 floor, leap-year stepping, midnight ends), repeat picker (storage notes and their conditions, §2.13), custom repeat, alerts, calendar picker (same-account rule), span dialogs (losses lines, `editable: false` choices), delete confirmation with invitees, undo snackbar on `PendingChanges` with commit failures | D3, D4 | 3 |
| D7 | Today Up next, day screen events, Settings rows ("Show my events" first), Calendars sheet, device calendar, `ExternalCalendarIntents` | D3 | 3 |
| D8 | Top-up and parts, self-expansion of `BYYEARDAY` and of out-of-range years (form (d) once per series id), cross-account moves with exception rows; `ReminderReceiver` if V18 fails | D3 | 3 |
| D9 | Robolectric and instrumented suites complete, accessibility pass (TalkBack, Switch Access paging, font scale 200%, keyboard on tablets) | D4 to D8 | 4 |
| D10 | Verification gates (Android side of V2, V3, V4, V5, V9, V10, V12 to V15, V18, V20, V21; V2, V3, V10, V12 start in phase 0; V2's Android leg, V3 and V10 are deferred by the owner, so D10 records them as not run with their fallbacks in force, §8.2), screenshots, README, release notes | D9 | 0, 4 and 5 |

### 6.4 Windows

**Projects**

- `Thirteen.Core`: `Events/` (port of `events`), `Ics/` (port of `ics`, including the CLDR Windows zone
  table, which on Windows also lets `TimeZoneInfo.FindSystemTimeZoneById` take IANA ids through ICU).
  Still no dependencies beyond the BCL.
- `Thirteen.Desktop.csproj`: `<TargetFramework></TargetFramework>` (clears the single value that
  `Directory.Build.props` sets) and `<TargetFrameworks>net10.0;net10.0-windows10.0.19041.0</TargetFrameworks>`.
  The Windows target compiles the toast scheduler and `UISettings` text scaling (`#if WINDOWS`); `net10.0`
  keeps running on macOS for development with a no-op scheduler. `build-windows.sh` passes
  `-f net10.0-windows10.0.19041.0` to both `dotnet publish` calls (without it a multi-target publish
  fails). No new package: time zone changes are detected without `Microsoft.Win32.SystemEvents` (below).
- The published app stays trimmed (`PublishTrimmed`, `TrimMode=full`) and warnings stay errors
  (`TreatWarningsAsErrors`). Task W3 publishes the Windows target once with the toast code in place and
  fixes or suppresses, with a written reason, every trim warning that the Windows SDK projection brings.
- `Thirteen.Desktop.Tests` (exists; xUnit, `Avalonia.Headless.XUnit` 11.3, MIT) gains the events tests.

**Services** (`Thirteen.Desktop/Services/`):

```
EventStore.cs           §3.6 files; loads every document on a background thread at start; in-memory index; per-year
                        occurrence cache (ics eventsFromCalendar with the device zone, merged across years by key);
                        one write queue per calendar for every writer, read-modify-write of one UID group with the
                        others copied raw, the hash check before writing, FileSystemWatcher reloads; atomic writes
                        (Move for a new file, Replace with .bak otherwise); recovery and unreadable calendars of §2.16
WindowsZoneResolver.cs  ZoneResolver on TimeZoneInfo.GetUtcOffset (IANA ids through the CLDR table and ICU); no
                        TimeZoneInfo.ConvertTime at the range edges (§3.1.1); tested by the zones section only,
                        with its registry exclusions listed by case id (§5.5)
PendingChanges.cs       pending moves and deletes (§2.11), committed on toast close (timeout, Close or the next
                        action), window close and app exit (both wait for the write), the next write to the same
                        calendar, a reload of it, or one minute before the event's earliest alert (before
                        AlertScheduler would show it); one retry on an I/O error, then the revert and
                        calendar.commitFailed.*; a failure while closing is kept in calendars.json "failedCommits"
                        (key, title, change, cause) and shown at the next start as calendar.commitFailed.later.*
SubscriptionService.cs  one HttpClient (SocketsHttpHandler: automatic decompression, 5 redirects, https to http
                        downgrade refused, PooledConnectionLifetime 10 min), 30 s timeout, 25 MB cap,
                        User-Agent "Thirteen/1.0 (Windows)", Accept "text/calendar, */*;q=0.5", If-None-Match /
                        If-Modified-Since from the stored ETag / Last-Modified, contentHash to skip unchanged bodies;
                        one refresh per subscription at a time, stored only if newer and not suspicious, a
                        suspicious body accepted when the next one has the same parse outcome (§3.6, §2.16);
                        due check every minute while running and online
                        (NetworkChange.NetworkAvailabilityChanged); refresh of due feeds 10 s after start
AlertScheduler.cs       IAlertScheduler; Windows: toasts scheduled with ToastNotificationManager.CreateToastNotifier(
                        "HaugasDevelopment.Thirteen").AddToSchedule(ScheduledToastNotification) for every alert in the
                        next 60 days (max 1,000), cleared and rebuilt after every change and at start
SingleInstance.cs       (exists) Mutex "Local\HaugasDevelopment.Thirteen" + named pipe: a second launch forwards its
                        arguments (.ics path, webcal:// or thirteen:// link) and exits; extended for the new arguments
ImportExport.cs         Avalonia StorageProvider open, save and folder pickers, worker-thread parsing, UID-group merge
                        rules (versions and import baselines, override-only groups, per-override versions) and
                        restore (version against version, ids kept), colliding file-defined VTIMEZONE names
                        renamed (§2.17, §3.6), one file per calendar for several calendars
FolderLauncher.cs       opens %LOCALAPPDATA%\Thirteen\Calendars in Explorer
ScreenReader.cs         SystemParametersInfo(SPI_GETSCREENREADER) and SPI_GETMESSAGEDURATION for toast timing (§2.11)
```

- **Toasts from an unpackaged app.** Every toast's XML is
  `<toast activationType="protocol" launch="thirteen://day/2026-10-19">`, so a click goes through the
  HKCU `thirteen` protocol to `Thirteen.exe` and `SingleInstance`, whether or not Thirteen is running; no
  COM activator is needed. The process calls `SetCurrentProcessExplicitAppUserModelID` with the same id.
  Every scheduler call is inside try/catch: `CreateToastNotifier` throws when no shortcut or registration
  carries the AUMID (`dotnet run`, a copied folder), and then the scheduler turns itself off for the
  session and logs a code. `Thirteen.exe --clear-alerts` removes every scheduled toast and exits.
- **Time zone**: device zone `TimeZoneInfo.Local`. On the existing one-minute timer and on window
  activation, call `TimeZoneInfo.ClearCachedData()` and compare `TimeZoneInfo.Local.Id` (and the current
  UTC offset) with the last values; on a change, rebuild occurrences and the alert schedule. DST rules of
  §3.3 come from core's `ZoneMath` over `WindowsZoneResolver`; no code calls
  `TimeZoneInfo.ConvertTimeToUtc` for event times (it throws in gaps and picks the later instant in
  overlaps). Alert times come from `alarmFireTime` (§2.14).
- **Text size and contrast**: on the Windows target read `UISettings.TextScaleFactor` at start and on
  activation and scale Thirteen's font sizes; high contrast through Avalonia's `PlatformColorValues`
  (§2.20).
- **Undo**: a per-window undo stack of the §2.11 changes behind Ctrl+Z and Ctrl+Y; pending moves and
  deletes through `PendingChanges`; a written change is undone by writing the previous version of its UID
  group back through `mergeDraft`.
- **Command line**: `Thirteen.exe "C:\path\file.ics"` and `--import <path>` open the Import dialog;
  `webcal://...` opens the Subscribe dialog prefilled; `thirteen://...` routes (§2.22); `--clear-alerts`
  (above). `--smoke` is unchanged (no network, no event store). `--smoke-ui` gains `--route month/2026/11`
  and `--fake-events`.

**Installer** (`installer/Thirteen.iss`):

- `[Icons]` Start menu entry gets `AppUserModelID: "HaugasDevelopment.Thirteen"` and
  `AppUserModelToastActivatorCLSID` set to a fixed stub GUID generated once for Thirteen (Microsoft's "no
  COM activator" option for unpackaged apps; clicks still arrive through the protocol).
- Registry (HKCU): `Software\Classes\AppUserModelId\HaugasDevelopment.Thirteen` with `DisplayName`
  "Thirteen" and `IconUri` (the installed icon), so toasts show the right name and icon even without the
  shortcut; the `thirteen` URL protocol; ProgID `Thirteen.ics` with `"{app}\Thirteen.exe" "%1"` and
  `.ics` / `.ical` `OpenWithProgids` (Thirteen appears in "Open with", it never takes the default);
  `Software\RegisteredApplications` + `Capabilities` declaring `webcal` and `webcals` URL associations so
  users can choose Thirteen in Settings > Default apps (not set as default). All removed on uninstall
  (`uninsdeletekey` / `uninsdeletevalue`); user data in `%LOCALAPPDATA%\Thirteen` is kept.
- `[UninstallRun]`: `Thirteen.exe --clear-alerts` (`RunOnceId: "ClearAlerts"`, `Flags: runhidden`), so no
  scheduled toast fires after uninstall.
- `verify-install.ps1`: checks the shortcut's AUMID and toast activator CLSID, the `AppUserModelId` key,
  the ProgID, the capabilities, and that uninstall removes them and the scheduled toasts but leaves
  `%LOCALAPPDATA%\Thirteen\Calendars`.

**UI** (Avalonia, compiled bindings, CommunityToolkit.Mvvm): `Views/Calendar/` (`CalendarView` with the
segmented mode control and toolbar, including the "Subscriptions not updated" status button of §2.1, `YearModeView` (existing YearView + dots), `MonthModeView`,
`WeekModeView`, `DayModeView`, `ListModeView`), `Controls/MonthEventGrid.cs`, `Controls/TimelinePanel.cs`
(overflow blocks, the now line under the blocks), `Controls/EventChip.cs` (drawn like the existing
`Controls/Drawn.cs`, with automation peers per day, per week column (a `Group`) and per event),
`Views/Events/` (`EventDetailFlyout`, `EventEditorDialog` (asks before discarding on Escape, the close
button and Alt+F4), `ThirteenDateField` + picker flyout, `RepeatPicker`, `CustomRepeatDialog`,
`AlertPicker`, `CalendarPicker`, `CalendarsPane` (collapsible groups, offline banner, stale rows),
`SubscribeDialog`, `ImportDialog`, `ExportDialog`), Today's Up next in `TodayView`. Keyboard per §2.21
(`KeyBinding`s in `MainWindow.axaml`). Drag and drop with Avalonia `DragDrop` (Alt held at the drop opens
the Duplicate draft in the editor dialog, §2.4). The toast control has its Close button (`toast.close`).
UI Automation names per §2.20 (Narrator).

**Tests**

- `Thirteen.Core.Tests`: `EventsFixtureParityTests` (`series`, `alarmInstants` and `untils` through the
  `RecordedZoneResolver` of `zoneOffsets`), `IcsConformanceTests` (every `fixtures/ics` case, including
  byte-exact round trips and the generated `VTIMEZONE`s, through the same recorded resolver), and the
  `zones` section through `WindowsZoneResolver` and `TimeZoneInfo`, with the case ids the Windows registry
  cannot answer as tzdata does listed, with reasons, in the test and in `windows/README.md`; the job
  prints the Windows build and `TimeZoneInfo` data source next to `tzVersion` on a failure.
- `Thirteen.Desktop.Tests`: `EventStore` on a temp folder (first write of a new calendar through
  `File.Move`, later writes through `File.Replace`, a deleted file written again, edits, spans, `.bak`
  recovery and the `.broken-*` rename, a calendar with both files unreadable stays read-only, second
  process blocked; editing one event of the imported `outlook-publish.ics` leaves every other group byte
  for byte; a UI save racing an import and a subscription refresh into one calendar loses neither; a file
  changed outside Thirteen between load and save is reloaded and the save applied to it; the watcher
  ignores Thirteen's own writes); `SubscriptionService` against an `HttpListener` server (200, 304 with
  ETag, unchanged body with a new ETag, redirect chain, https to http downgrade refused, 401, 404, 25 MB
  cap, slow server timeout, non-calendar body, offline pause, an older response finishing after a newer
  one is not stored, a 200 with zero events held back and then accepted on repetition, a feed with 12%
  unreadable components and a new `DTSTAMP` on every request held back once and accepted on the next
  refresh with the same outcome, `.bak` kept);
  `ImportExport` (UID groups, override-only groups into an empty calendar and over a stored master,
  per-override versions, duplicate masters, missing UIDs imported twice, a local edit does not block a
  newer file, the `fixtures/ics/imports` cases (baselines in the raw text, a Google export over an event
  created in Thirteen with the same `UID`, two "Customized Time Zone" files, Google and Apple exports in
  `Europe/Tallinn` with nothing renamed), export
  of three calendars into a folder, restore of `fixtures/ics/restore` (an older export over an event edited
  since keeps the edit and is counted; the same file restored twice leaves one calendar));
  `AlertScheduler` schedule computation through `alarmFireTime` and toast XML (pure part, including
  `activationType="protocol"`) and the disabled state when the notifier throws; `PendingChanges` and the
  undo stack (a failed commit reverted and reported, without a reason line and with "Try again" for a
  transient cause; a failure on close shown at the next start as the named `calendar.commitFailed.later.*`
  toast, two as the plural one; an early commit keeps Undo because Windows reverts written changes
  exactly; the next action and Close commit; an alert one minute away commits); view models with `FakeEventStore`;
  historical events offer only Delete and Edit alerts; headless UI tests for Month keyboard navigation (Enter or
  F2 into a day's events), the editor's discard paths, the §2.20 labels and the no-dashes text walk.
- On the VM (`build-windows.sh`): smoke as today, plus `--smoke-ui --fake-events --route month/2026/11
  --screenshot` for both architectures, and the `verify-install.ps1` checks above. Gate V13 runs on this
  trimmed single-file publish of the Windows target.

**Screenshots**: `windows-calendar-month.png`, `windows-calendar-week.png`, `windows-event-editor.png`,
`windows-subscribe.png`, `windows-calendars.png`, `windows-calendar-month-dark.png`.

| # | Task | Depends on | Phase |
|---|---|---|---|
| W1 | `Thirteen.Core/Events` port (including `ZoneMath`, `mergeDraft`, `splitRecurrence`, `retimeExceptions`, `expandSeries`) + parity tests (with `counts`) | C6 | 2 |
| W2 | `Thirteen.Core/Ics` port (raw groups, `replaceGroup`, per-period `VTIMEZONE`s, duplicates, derived UIDs) + conformance tests (both device zones, round trips, `edits/`) | C8 | 2 |
| W3 | `EventStore` (per-calendar write queue, read-modify-write of one group, hash check, `FileSystemWatcher`), `WindowsZoneResolver`, `PendingChanges`, `FakeEventStore` (loads `fixtures/mockup/mockup-events.json` as a linked resource), `SingleInstance` arguments, csproj targets (`TargetFramework` cleared, `-f` in `build-windows.sh`), trimmed publish of the Windows target without warnings | W1 (types), W2 for persistence | 2 |
| W4 | `SubscriptionService` (conditional requests, offline, one refresh per subscription, newer-only and suspicious-result rules, `.bak`), Subscribe dialog, Calendars pane | W2, W3 | 2 |
| W5 | Calendar modes Year, Month (accessibility list with empty-day runs), List; `AppSection.Calendar`; deep links | W3 | 3 |
| W6 | Week and Day timelines (overflow, column groups), drag and drop (time-group moves, `validateDraft` before holding, the repeat-changing span dialog with counts and losses) | W5 | 3 |
| W7 | Details flyout (Duplicate as a draft; Delete and Edit alerts on historical events), editor (validation including `out-of-range`, merge banner, occurrence-gone, discard paths, all-day Free, adaptation notices, later-events lines, the retime notice), date field (1583 floor, leap-year stepping, midnight ends), repeat and alert pickers, span dialogs (losses lines, `editable: false` choices), undo with commit failures | W3, W5 | 3 |
| W8 | Import (UID groups, versions and baselines, colliding zone names, several files, restore with ids kept), export (one file or a folder of files, `export.secretLinks`), file and protocol arguments, installer registrations (`AppUserModelId` key, toast activator CLSID, `[UninstallRun]`) | W2, W3 | 3 |
| W9 | `AlertScheduler` (protocol toasts, `--clear-alerts`, times from `alarmFireTime`), Settings rows, Today Up next, day detail events, time zone and text-scale checks | W3 | 3 |
| W10 | Tests complete, Narrator and keyboard pass, high contrast and 150% text scale check | W4 to W9 | 4 |
| W11 | VM pipeline updates, verification gates (Windows side: V11, V13), screenshots, README | W10 | 4 and 5 |

### 6.5 Web

**Packages**

- `packages/ui/src/events/` (new React components, CSS modules, tokens only from `design/tokens.json`):
  `EventChip`, `MonthEventGrid` (titles and dots densities, two-line weekday header), `MonthDayList` (the
  accessibility-size list), `IntercalaryEventBand`, `Timeline` (Week and Day; overflow blocks; the now line
  under the blocks), `AgendaList`, `EventDetails`, `EventEditor`, `ThirteenDateField` (the converter's
  `ThirteenPicker` logic moves here so both use it), `RepeatPicker`, `CustomRepeat`, `AlertPicker`,
  `CalendarPicker`, `CalendarsPanel`, `SubscribeDialog`, `ImportDialog`, `ExportDialog`, `UpNext`,
  `StorageNotice`. New primitives: `Dialog` (native `<dialog>` with `showModal()`, focus return, Escape
  routed through the discard check), `Popover` (Popover API, positioned by script, returns focus to its
  anchor on close), `Menu` (menu button pattern), `Toast` (`role="status"`, polite; 8 s, or 20 s with an
  action; paused on hover and focus; a Close button named "Close" after the action; closed by the next
  action of §2.11).
- `packages/ui/src/hooks/useEvents.ts`: `EventStoreProvider`, `useCalendars()`, `useOccurrences(year)`,
  `useUpNext()`, `useEventUndo()`; the store is an interface so tests and screenshots use
  `MemoryEventStore`.
- `ThirteenYearGrid`, `ThirteenMonthGrid`, `DateCell`, `IntercalaryDayToken` gain an optional `marks`
  prop (Year dots); `DateCell`'s existing forced-colors rules are extended to chips (§2.20).

**App** (`apps/web/src/`, `apps/web/public/`):

```
features/calendar/   CalendarPage (modes, toolbars of §2.1 with the stale-subscriptions button, routes), YearMode
                     (existing YearPage + dots), MonthMode,
                     WeekMode, DayMode, ListMode
features/today/      UpNext.tsx in TodayPage
features/settings/   SettingsPage (#/settings, the Calendar group of §2.18)
features/convert/    ConvertPage and ThirteenPicker use the shared ThirteenDateField logic
lib/events/
  db.ts              IndexedDB schema of §3.6 (no library; about 120 lines); open failure switches to memory mode
  store.ts           EventStore: in-memory index, per-year expansion cache (merged across years by key), writes as
                     read-modify-write of one UID group inside the Web Lock (§3.6), BroadcastChannel sync, pending
                     moves and deletes (§2.11: committed on toast close, the next action, visibilitychange to
                     hidden and pagehide, or a minute before an alert; journaled in localStorage
                     "thirteen-pending" with the tab's id, while the tab holds the lock "thirteen-tab-{id}";
                     replayed on load and on becoming visible, inside "thirteen-events", only for entries
                     whose tab lock is free (navigator.locks.query), a delete of a missing event or a move
                     already in place counting as written; one retry on an aborted transaction, then the
                     revert and calendar.commitFailed.*), memory mode when IndexedDB is unavailable (§2.16)
  ics.worker.ts      parse and expand off the main thread (Vite worker)
  zones.ts           ZoneResolver on Intl.DateTimeFormat (offset by formatToParts), device zone checks every minute
                     and on visibilitychange
  subscriptions.ts   §2.17 and below
  alerts.ts          alert planning in the tab that holds the 'thirteen-alerts' lock (§2.14), times from alarmFireTime;
                     showNotification through the service worker registration
  storage.ts         persisted() check, the persist() button, Safari-in-a-tab detection, export reminder
  files.ts           import (input type=file with multiple, drag and drop of several files, Thirteen's .zip),
                     UID-group merge (versions and import baselines) and restore (version against version, ids
                     kept), colliding VTIMEZONE names renamed (§2.17, §3.6), export (one .ics, or one uncompressed .zip of one .ics per
                     calendar written without a library: local file headers, CRC-32, central directory)
  undo.ts            per-tab undo stack behind Ctrl+Z / Ctrl+Shift+Z (⌘ on a Mac); discards pending changes, writes
                     the previous group back through mergeDraft for written ones
public/alerts-sw.js  the notifications-only service worker
```

- **Subscriptions** (`subscriptions.ts`): `fetch(url, {mode: 'cors', credentials: 'omit', cache:
  'no-cache', referrerPolicy: 'no-referrer', redirect: 'follow', signal: AbortSignal.timeout(30000)})`,
  read as a stream with a 25 MB cap. The web never sets request headers itself: `If-None-Match` and
  `If-Modified-Since` are not CORS-safelisted, so setting them would turn every refresh into a preflighted
  request, which many feed hosts that send `Access-Control-Allow-Origin: *` do not answer. With
  `cache: 'no-cache'` the browser revalidates from its own HTTP cache with its own validators, without a
  preflight. "Unchanged" is detected by comparing the body's SHA-256 (`crypto.subtle.digest`) with
  `contentHash` (§3.6); a suspicious body is accepted when the next one has the same parse outcome
  (§2.16). Error mapping of §2.17 (`TypeError` + known host = cors). Refresh on load, on
  visibility and every minute while visible and online (§2.16). Each subscription's whole refresh (fetch,
  parse, compare, write) runs inside `navigator.locks.request('thirteen-sub-' + id, {ifAvailable: true},
  ...)`; it stores the body only under the newer-only and suspicious-result rules of §3.6 and §2.16, and
  moves the stored copy to `previousIcs` first.
- **Alerts** (`alerts.ts`, `alerts-sw.js`): support detection and behaviour of §2.14. The page registers
  `alerts-sw.js` with the app's base path as its scope (`/` on the app's own origin) only when the user
  turns alerts on. Only the tab holding the `thirteen-alerts` lock plans: timers for alerts in the next 24
  hours are re-planned every 15 minutes, on change and on `visibilitychange`; each fires
  `registration.showNotification(...)` with `tag` = `{occurrence key}|{alarm index}` and `data.route` =
  `#/day/{date}`. The worker has one listener, `notificationclick`: `clients.matchAll({type:
  'window', includeUncontrolled: true})`, focus the first Thirteen client and `postMessage` the route, or
  `clients.openWindow(base + route)`. No `fetch`, `install` caching or push code. Planning errors are
  caught and logged as codes (§2.14).
- **Storage** (`storage.ts`): after the first save, `navigator.storage.persisted()`; `persist()` only from
  the "Keep my data" button; Safari in a tab = WebKit without `navigator.standalone` and without
  `display-mode: standalone`; the export reminder of §2.16 from `meta.lastExportAt`.
  `QuotaExceededError` maps to `editor.saveFailed.storage`.
- **Router**: `calendar`, `month/{year}/{month}`, `week/{date}`, `day/{date}`, `new-event`, `subscribe`,
  `settings` routes; `year` stays. The Subscribe dialog strips `url` with `history.replaceState` after
  reading it. `Shell` nav label "Calendar" and a gear button for `#/settings`. Single-key shortcuts with
  the Settings switch. The editor listens for `popstate` and `beforeunload` while dirty (§2.11).
- No new runtime dependencies. Dev: `fake-indexeddb` 6 (Apache-2.0), `@playwright/test` 1 (Apache-2.0),
  `@axe-core/playwright` 4 (MPL-2.0), all added in B1 (§6.0, lockfile order).

**Tests**

- `packages/ui`: component tests (RTL) for every new component: grid roles and labels (the §2.20 table),
  roving focus and the Enter / F2 / Escape model, both Month densities, chip labels, editor validation
  (`aria-invalid`, `aria-describedby`, focus on Save), repeat picker labels, Next lines and notes from core,
  dialogs' focus handling, popover focus return, toast timing, forced-colors snapshots.
- `apps/web`: store with `fake-indexeddb` (create, spans, two instances syncing through BroadcastChannel,
  lock contention, two instances editing different events of one calendar (both edits survive), a field
  changed in one instance while the other edits another field (both kept; a conflict only for the same
  field), quota error, memory mode when `indexedDB.open` fails, an untouched imported group stays byte for
  byte), subscriptions with mocked `fetch` (CORS-style `TypeError`, unchanged body by hash, oversize stream,
  redirect, the exact fetch options including `referrerPolicy: 'no-referrer'` and no custom headers, two
  instances refreshing the same feed (one fetch), an older response finishing last (not stored), zero events
  held back then accepted, a partly unreadable feed whose every response has a new `DTSTAMP` held back
  once and accepted on the next refresh with the same outcome), router (including `url` stripping), alerts timing with fake timers and a fake
  registration (`showNotification` called, `new Notification` never, only the lock holder plans, tags),
  storage notices per browser, `files.ts` (zip written and read back, UID-group merge, the
  `fixtures/ics/imports` cases including `known-tz` (nothing renamed, imported groups byte for byte),
  override-only groups into an empty calendar and an older override over an edited one, restore: an older
  export over an event edited since keeps the edit and is counted, the same file restored twice leaves one
  calendar), undo (pending discard, written undo,
  `calendar.undoUnavailable`), pending commits (a failed commit reverted and reported, a quota error, a
  journal entry left by a closed tab committed on the next load, or reported by name when the event
  changed; two tabs: a second tab opened while the first shows an Undo toast leaves the first tab's entry
  alone, Undo in the first tab still discards it, and the entry is replayed only after the first tab
  closes; an entry whose write had completed (event already deleted, move already in place) is removed
  without a toast; two failures shown as the plural toast),
  historical events offering only Delete and Edit alerts.
- `apps/web/e2e` (Playwright, Chromium, Firefox and WebKit): create, edit, "this event only" and "future
  events", delete with undo (toast and Ctrl+Z), import `fixtures/ics/cases/google-secret.ics`, export then
  re-import equals the original, export all (two local calendars and one subscription) then restore into a
  fresh browser context (same names, colors, kinds, events and link), subscribe to a local server that sends
  CORS headers, one that does not, and one that answers GET with `Access-Control-Allow-Origin: *` but
  OPTIONS with 405 (subscribe and three refreshes must succeed), offline banner (context offline),
  keyboard-only flow, discard on Escape and Back, the no-dashes text scan, an axe scan of each mode with
  zero serious violations, and screenshot capture. Service worker notification click is covered by gate
  V17 (Playwright cannot click system notifications).

**Screenshots**: `web-calendar-month.png`, `web-calendar-week.png`, `web-calendar-month-dark.png`,
`web-event-editor.png`, `web-subscribe.png`, `web-mobile-calendar.png`, `web-today-up-next.png`
(Playwright, `MemoryEventStore` with the mockup data, fixed date 2026-10-19).

| # | Task | Depends on | Phase |
|---|---|---|---|
| B1 | Primitives (`Dialog`, `Popover`, `Menu`, `Toast`), `MemoryEventStore` (imports `fixtures/mockup/mockup-events.json`), the web dev dependencies | none (merges after C1 for the lockfile, §6.0) | 3 (first) |
| B2 | `db.ts`, `store.ts` (read-modify-write of one group, pending changes, memory mode), `zones.ts`, worker, `subscriptions.ts` (per-subscription lock, newer-only, suspicious results, `previousIcs`), `storage.ts` | C4, C7 | 2 |
| B3 | Calendar modes Year, Month (densities, accessibility list with empty-day runs), List (year merges dedupe by key); toolbars and paging; router; Shell; Settings page | C5, B1 | 3 |
| B4 | Week and Day timelines (overflow, column groups, the compact tap placeholder), drag and drop (time-group moves, `validateDraft` before holding, the repeat-changing span dialog with counts and losses) | B3 | 3 |
| B5 | Details (Duplicate as a draft; Delete and Edit alerts on historical events), editor (validation including `out-of-range`, merge banner, occurrence-gone, discard paths, all-day Free, adaptation notices, later-events lines, the retime notice), date field (1583 floor, leap-year stepping, midnight ends), repeat and alert pickers, span dialogs (losses lines, `editable: false` choices), undo with commit failures | C4, B1 | 3 |
| B6 | Calendars panel (collapsible groups, storage notices, offline, stale and suspicious rows), import (several files, zip, UID groups, versions and baselines, colliding zone names, restore with ids kept), export (one file or a zip, `export.secretLinks`), subscribe dialog (Import button in the CORS state) | B2, C8 | 3 |
| B7 | Today Up next, day panel events, Settings rows, alerts (one planning tab, tags, `alarmFireTime`) and `alerts-sw.js` | B2, B3 | 3 |
| B8 | Unit, component and e2e suites; accessibility pass (NVDA + Firefox, VoiceOver + Safari, forced colors, axe); gates V15, V17, V19 | B3 to B7 | 4 |
| B9 | `privacy.html`, `support.html` (§7, including the `#install` help), screenshots | B8 | 5 |

### 6.6 Continuous integration

`.github/workflows/ci.yml` (Core team, on request of the other teams): the web job also checks that
`fixtures/events.json`, `fixtures/ics/expected/*` and `fixtures/mockup/mockup-events.json` are fresh and
runs the e2e suite with its local feed servers; the android job runs `:core:test` with the events parity
tests; a new optional job `android-provider` runs the managed-device instrumented tests on API 26, 30 and
37 (KVM runner); the windows job runs both test projects (on `windows-latest`, where `TimeZoneInfo` reads
the registry: every fixture section that needs zones except `zones` uses the recorded resolver, §5.5, and
the job lists the `zones` exclusions it applied). A new required job **`apple-kit`** on a
GitHub-hosted macOS runner (`macos-15` or newer with Swift 6; free for this public repository) runs
`swift test --package-path apple/ThirteenKit`, so `ThirteenKit` is checked against `conversions.json` and
`events.json` on every pull request, and a Core change that breaks Swift parity fails before merge. The
simulator suites (`apple/scripts/ui-tests.sh`) still run locally and in the release scripts. Every parity
job asserts the per-section `counts` (§5.5).

### 6.7 The mockup data set

One data set feeds every fake store, screenshot run and the mockups, so screenshots across platforms
match. Today: 2026-10-19 09:41 (Europe/Tallinn). Calendars: Home (iCloud, orange `#ea580c`), Work
(Google, blue `#2563eb`), Family (iCloud, shared, green `#16a34a`), Running club (Google, teal
`#0d9488`), Holidays in Estonia (subscribed, read only, graphite `#57534e`), Birthdays (read only, purple
`#9333ea`). Every timed event is in `Europe/Tallinn`.

**The data set is a generated file, not this table.** `packages/core/scripts/mockup-events.ts` (Core, C6)
writes `fixtures/mockup/mockup-events.json` from the rows below: for each event its calendar, title,
location, all-day flag, `DTSTART` and `DTEND` (event-zone wall clock), zone, `RRULE` text and marker (or
none), alerts and invitation fields, plus the expanded occurrences from 2026-01-01 to 2027-12-31 as
`EventOccurrence` JSON. Every fake store loads that file (Apple `FakeCalendarStore` as a bundle resource
referenced from `project.yml`, Android `FakeCalendarRepository` from debug assets that point at
`fixtures/mockup/`, Windows `FakeEventStore` as a linked resource, web `MemoryEventStore` by import); no
team copies the table into code. A staleness test fails until the file is regenerated, and the
`monthLayouts` fixture for IFC October 2026 is built from the same file.

The table gives each repeating event's explicit first date (`DTSTART`), chosen so that the occurrence the
mockups show is a real one. "Every 2 weeks" in particular depends on it: started on Monday, January 5,
2026, Sprint planning would fall on October 12 and 26, not 19.

| Title | DTSTART (first occurrence) | Occurrence on the board | Calendar | Repeat |
|---|---|---|---|---|
| Rent | 2026-01-01, all day | Oct 8 2026, all day | Home | Every IFC month on the 1st |
| Half marathon | | Oct 10, 09:00 to 12:00, "Tartu" | Running club | none |
| Team offsite, Pärnu | | Oct 12 to 14, all day | Work | none |
| Kodak archive call | | Oct 15, 16:00 to 16:45 | Work | none |
| Lunch with Jaan | | Oct 16, 12:00 to 13:00 | Home | none |
| Long run | | Oct 17, 08:00 to 10:00 | Running club | none |
| Family brunch | | Oct 18, 11:00 to 13:00 | Family | none |
| Autumn school break | | Oct 19 to 25, all day | Family | none |
| Sprint planning | 2026-01-12T09:30 | Oct 19, 09:30 to 10:30 | Work | Every 2 weeks on Monday (`FREQ=WEEKLY;INTERVAL=2`) |
| 1:1 with Marta | 2026-01-05T11:00 | Oct 19, 11:00 to 11:30 | Work | Every week on Monday (`FREQ=WEEKLY`) |
| Dentist, Dr. Tamm | | Oct 19, 15:40 to 16:20, "Tartu mnt 18" | Home | none |
| Book club: Cotsworth | 2026-01-12T19:00 | Oct 19, 19:00 to 21:00, "Raamatukoi", alert 1 hour before | Home | Every IFC month on the 12th |
| Yoga | 2026-01-06T07:15 | Oct 20, 07:15 to 08:15 | Running club | Every IFC week on Friday |
| Design review | | Oct 21, 14:00 to 15:30, "Room Sol"; invitation from Marta Kask with 6 invitees, alert 15 minutes before | Work | none |
| Design review prep | | Oct 21, 13:00 to 14:15 | Work | none |
| Flight TLL to AMS | | Oct 24, 06:10 to 08:20 | Family | none |
| Amsterdam trip | | Oct 24 to 26, all day | Family | none |
| Payday | 2026-01-25, all day | Oct 25, all day | Home | Every month on the 25th (`FREQ=MONTHLY`) |
| Recycling pickup | 2026-01-06, all day | Oct 27, all day | Home | Every 2 IFC weeks on Friday |
| Halloween | | Oct 31, all day | Holidays in Estonia | (feed) |
| All Souls' Day | | Nov 2, all day | Holidays in Estonia | (feed) |
| Ilona's birthday | | Nov 4, all day | Birthdays | (contacts) |
| New Year's Eve dinner | | Dec 31, 19:00 to 23:30 | Family | none |
| Winter break | | Dec 28, 2026 to Jan 3, 2027, all day | Family | none |

Rows without a `DTSTART` are single events on the date shown. (IFC Friday falls on month days 6, 13, 20
and 27, so Yoga and Recycling pickup start on IFC January 6 = Gregorian January 6, 2026; IFC October 13 =
Gregorian October 20 and IFC October 20 = Gregorian October 27.)

Board frames that need data outside this set say so on the board (the Week overflow in K2 uses the
fixture's 10-way overlap; the Exchange calendar in C3 and G3 is a hypothetical "Work (Exchange)").

Book club's location is "Raamatukoi" (owner decision): that is the value in the data set, in
`mockup-events.json` and in every screenshot. The details and editor frames of boards A2, C1, G2, H2 and
I1 show the longer "Raamatukoi, Tartu"; the boards stay as drawn, and screenshots that differ from them
only there match.

---

## 7. Privacy and store impact

### 7.1 Privacy policy (`apps/web/public/privacy.html`, Web team)

New effective date: the 1.0 release day. Replace the summary box and the sections below; keep "Hosting
and app stores", "Children", "Changes" and "Contact" as they are.

**Summary box**

> Thirteen collects no data. There are no accounts, no analytics, no ads and no tracking. Your events and
> settings stay on your devices and in the calendar accounts you already use, and Thirteen never sends
> them to us or to anyone else.

**What Thirteen collects**

> Nothing. Thirteen does not collect, store on any server, sell or share any personal information. It
> has no sign-in, no analytics or advertising code, and no third-party libraries that send data anywhere.

**Your calendars and events** (new)

> iPhone, iPad and Mac: if you allow it, Thirteen reads and changes the events in the calendars on your
> device through Apple's calendar system. Those calendars sync with iCloud, Google, Exchange or other
> accounts exactly as they do for Apple's Calendar app, under those services' own terms. Thirteen itself
> sends nothing. You can turn access off at any time in Settings > Privacy & Security > Calendars (on a
> Mac, in System Settings).
>
> Android: if you allow it, Thirteen reads and changes the events in your phone's calendars through
> Android's calendar storage. Your accounts' own sync (for example Google) moves them, not Thirteen. You
> can turn access off in your phone's Settings under Apps > Thirteen > Permissions.
>
> Windows and the website: the events you create are saved only on your computer (Windows) or in your
> browser's storage for this site (web). Calendar files you import are read on your device. Nothing is
> uploaded. Browsers may delete a site's storage on their own: Safari does so when you haven't opened a
> site for about a week, unless you added it to your Dock or Home Screen. Export your calendars to keep a
> copy.

**Network connections**

> Apps for iPhone, iPad, Mac and Android: they make no network connections. Calendar syncing is done by
> your device's own accounts.
>
> Windows app and website: they connect to the internet only to download calendars you subscribe to by
> link, directly from the server in that link (for example Google or iCloud): when you subscribe, when you
> choose Update now, and on the schedule you pick. Like any download, the request shows that server your
> IP address and that the request comes from Thirteen or your browser; it sends no cookies and does not
> tell the server which page asked, and it contains nothing about you or your other events. The links
> are saved only on your device, in storage that belongs to Thirteen's website alone. Apart from those
> downloads, the website only loads its own files from the server that hosts it, and it loads nothing
> from other sites.

**Notifications** (new)

> On Windows, event alerts are scheduled as Windows notifications on your computer. On the website,
> alerts use your browser's notifications only if you turn them on in Settings; the website then installs
> a small background script (a service worker) whose only job is to show those alerts and open the right
> day when you click one. It downloads nothing and sends nothing. On Android, if Thirteen shows the alerts
> for its own "Thirteen" calendar, it asks for permission to send notifications first. Alerts are planned
> on your device and never sent anywhere.

**Settings on your device**: add "which calendars you hide in Thirteen and your default calendar for new
events" to the list.

**Deleting your data** (new)

> Events in your Apple or Android calendars belong to those calendars: delete them in Thirteen or in your
> calendar app. On Windows, your calendars are in the folder `%LOCALAPPDATA%\Thirteen\Calendars`;
> uninstalling Thirteen keeps them, deleting the folder removes them. On the website, use Settings >
> Delete all events, or clear the site's data in your browser.

`apps/web/public/support.html`: the FAQ "Does it work offline?" becomes "Yes. The apps for iPhone, iPad,
Mac and Android never connect to the internet. The Windows app and the website connect only to download
calendars you subscribe to. Nothing is collected; see the privacy policy." New FAQs: "Why can't I see my
Google calendars on Android?" (the sharing setting, §2.15), "Why can't the website subscribe to my Google
or iCloud calendar?" (CORS explanation in two sentences: "Google and iCloud don't let web pages read their
calendar links. Download the .ics file and import it, or use Thirteen for Windows."), "Will my 13-month
repeats show in other calendar apps?" (§4.8 in plain words; while gate V3 is not run, it also says that
Calendar on iPhone and Mac may show only the first date of a repeat set in Thirteen for Android, §8.2;
and that Google Calendar on the web shows the dates while its editor calls such a repeat "Unsupported
recurrence" or "Does not repeat", and that editing the title there keeps the repeat, phase 0),
"Where are my events stored?" (§1.3), "Why
did my events disappear from the website?" (browser storage limits, the Safari one-week rule, export), "Do
new events get my account's default alerts?" (the V6 result; so far, phase 0 on iCloud: an all-day event
saved with no alerts gets the account's default alert for all-day events, a timed event gets none), and
the anchor `#install` "Add Thirteen to
your Dock or Home Screen" (Safari on Mac: File > Add to Dock; iPhone and iPad: Share > Add to Home
Screen).

### 7.2 App Store privacy label and manifest

- **Label stays "Data Not Collected".** Apple defines collecting as transmitting data off the device in a
  way that lets the developer or its partners access it, and says data processed only on device is not
  collected (App Privacy Details). Thirteen reads and writes events on the device through EventKit; the
  sync to iCloud, Google or Exchange is done by the operating system under the user's account, not by
  Thirteen, and never reaches Haugas Development OU. The Apple apps contain no networking code and no
  third-party SDKs. Conditions that keep this true are in §1.4; a change to any of them requires
  re-answering the questionnaire.
- `PrivacyInfo.xcprivacy` does not change (EventKit is not a required-reason API; no collected data
  types).
- Purpose string `purpose.apple` (§2.19), localized if the app is ever localized.

### 7.3 App Store metadata (`docs/store/app-store.md`, Apple team)

- **Category**: primary **Productivity**, secondary Reference (the old reasoning, "not an event
  calendar", no longer holds). The Mac's `LSApplicationCategoryType` stays productivity.
- **Description**: replace the paragraph "Thirteen does not read or change the events in your own
  calendar..." with:
  "CALENDAR / Your own events in 13 months: Thirteen shows the calendars already on your iPhone and iPad,
  from iCloud, Google, Exchange and others, in Day, Week, Month, Year and List views, with every Gregorian
  date beside the 13-month one. Add and edit events like in the Calendar app, including repeats that only
  a 13-month calendar has: every month on the 12th, every Year Day, every Leap Day. Changes sync through
  your own accounts." and change the last paragraph to "No account, no ads, no tracking and no in-app
  purchases. Thirteen makes no network connections of its own: your calendars sync through your device's
  accounts. Your settings stay on your device." The YEAR heading becomes CALENDAR (Guideline 2.5.1: the
  integration is described).
- **Keywords** (96 characters): `calendar,events,planner,fixed,international,cotsworth,positivist,gregorian,leap,reform,converter`
- **Promotional text** (149 characters): "Your own events in 13 months of 28 days. Every 13th is a Friday,
  every month on the 12th falls on a Thursday, and Year Day belongs to no week at all."
  (Subtitle unchanged.)
- **Review notes**, appended:

```
Calendar access: Thirteen shows the user's own events in its 13-month views and can add, edit and delete them (EventKit, full access). It asks only when the user taps Continue on the "See your events in 13 months" card in the Calendar tab, or taps + to add an event. Every other feature works without access, and the Calendar tab still shows the 13-month calendar without events if access is denied.

To test: open the Calendar tab, tap Continue and allow Full Access. Tap +, set a title, tap Starts to pick a 13-month date (for example 2028, Leap Day), set Repeat to "Every Leap Day", and Add. The event appears in Apple's Calendar app on Saturday, June 17, 2028, and every four years after that. To try it without a leap year: pick Year Day 2026 and "Every Year Day"; it appears on Thursday, December 31, 2026.

Thirteen never transmits event data; syncing is done by the device's accounts. There is still no login, no network access of its own, no in-app purchase and no user-generated content shared with others.
```

- Age rating answers do not change (events are private; "User-generated content" is about content shared
  with other users).
- Screenshots: new order of §6.2, captured in 12-hour time (`-AppleLocale en_US`) because the listing is
  English (U.S.).

### 7.4 Android

- Distribution stays the sideloaded APK on GitHub Releases. Release notes for 1.0 list the new
  permissions: "Thirteen now asks for calendar access to show and edit your events. It still has no
  internet permission." If the V18 fallback ships, add: "It asks to send notifications only to show
  alerts for its own Thirteen calendar."
- In-app rationale: the cards of §2.16 (asked in context, never at launch, "Not now" always available).
- If a Play listing is ever made: Data safety "No data collected, no data shared"; the calendar
  permission is core functionality of a calendar app.

### 7.5 Windows and web: the end of "no network"

What changes and where:

| Before | After | Where |
|---|---|---|
| "The apps do not connect to the internet." | §7.1 "Network connections" | `privacy.html`, `support.html`, root `README.md` |
| Windows app has no network code | `SubscriptionService` only; no telemetry, no update checks, no other hosts; requests only to user-entered links; HTTP only after a warning | `windows/README.md` ("Network" section listing exactly this) |
| Website fetches only its own files | plus user-entered feed links, `credentials: 'omit'`, no referrer (`referrerPolicy: 'no-referrer'`), no custom request headers (§6.5) | `privacy.html` |
| Website has no service worker | `alerts-sw.js`, registered only when the user turns alerts on; it only handles notification clicks (no `fetch` handler, no cache, no push) | `privacy.html` ("Notifications") |
| Website served from `siim.github.io` | `https://thirteen.haugas.dev/`, an origin of its own (§3.6, §8.5) | `privacy.html`, `support.html`, canonical and Open Graph URLs, store links (`design/DECISIONS.md` already updated by the owner) |
| Windows installer | unchanged wording; new file and protocol registrations listed in `windows/README.md` | `windows/README.md` |

The Apple and Android statements ("make no network connections") stay true and stay in the copy.

### 7.6 Logging and diagnostics

No platform logs event titles, notes, locations, URLs, attendee names or subscription URLs in release
builds (Apple: `privacy: .private`; Android: no `Log` of event fields; Windows and web: no logging of
them). Errors log codes and counts only.

---

## 8. Risks, verification and what waits

### 8.1 Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | `BYYEARDAY` rules are RFC-valid but untested in iCloud, Calendar.app and Google's UI; another app may replace them with a Gregorian rule when the user edits the repeat there | `EventKitExpansionTests` (simulator) before V1; V1, V2 in phase 0 (V2's EventKit leg on Google Calendar web only for now, §8.2; phase 0 passed V1's Mac EventKit leg, and Google web kept an imported `BYYEARDAY` rule through its own edits); recognition never assumes a marker on Apple, so a replaced rule is simply shown as what it now is; if V1 or V2 fails for an account type, that type gets `thirteenRepeats = 'gregorian-only'` (forms a and c still work) and the repeat footer drops its sentence (§2.13), as does a release made before that gate passes (§8.3 item 2) |
| R2 | Exchange and Outlook accept only template rules | 13-month forms (b) and (d) are not offered for Exchange, Outlook and unknown Android accounts (§3.4); the conflict dialog (§2.11); V4 confirms |
| R3 | Android's provider expands `BYYEARDAY` wrongly (verified), so iPhone-made 13-month repeats show wrong days in other Android apps, and their alerts fire on wrong days | Android writes form (d) for repeats it creates; Thirteen for Android expands `BYYEARDAY` itself and explains days and alerts (§2.10); the Apple footer says so for Google calendars (§2.13); Android never converts an Apple-made series except on an explicit 13-month choice in the repeat picker, with a note: new dates, ends, splits and drags keep `BYYEARDAY` (§4.9); the explicit conversion offer is deferred (§8.4); while gate V2's Android leg is not run, Android changes only the alerts of an Apple-made series (§3.5, §8.2) |
| R4 | `RDATE` lists end at their horizon if Thirteen is never opened again; the marker may not sync; long series outgrow one event's list | horizons of 10, 5 and 3 years; top-up on every start; parts of at most 210 values (§4.4, sized from phase 0); prefix recognition across horizons; the end is shown honestly; V9, V10 |
| R5 | Google's sync adapter may rewrite the `TZID;` `RDATE` form, or refuse long lists | V10; fallback to the UTC form, which ships while V10 is not run (owner, §8.2); parts of at most 210 values, under the roughly 4,096 characters of `RDATE` text that Google's web import accepted in phase 0, which also kept the `TZID` form (§4.4) |
| R6 | EventKit regression since iOS 18.4: saving a detached occurrence with alarms or moving across accounts fails with `EKCADErrorDomain 1013` | copy-then-delete for moves of non-repeating events without invitees only; repeating events are not copied (their exceptions would be lost) and Duplicate is offered (§4.7); for detach failures, the editor offers "Save for future events" instead and reports the error; V5 |
| R7 | macOS permission failures are silent (missing entitlement or purpose string, bare-executable launch, ad-hoc signing) | release script checks (§6.2), README instructions, authorization status logged (no private data) |
| R8 | The access request may be denied instantly off the main actor on macOS | V8 and the main-actor fallback (§6.2) |
| R9 | Swift 6 traps: `nonisolated async` helpers run on the main actor; EventKit objects are not Sendable | the actor rule and no `@unchecked Sendable` (§6.2); code review checklist item |
| R10 | Unstable identifiers (`eventIdentifier`, `calendarIdentifier`, provider ids after restore) | fallbacks of §3.2; no event links in 1.0 |
| R11 | Time handling: all-day ends at 23:59:59 on Apple and UTC dates on Android, DST gaps and overlaps, zone changes, skipped days | end-of-day form (§3.1.1), mapping rules (§3.3), `zones` fixtures on every platform, time zone change handling per platform |
| R12 | iOS terminates the app when calendar permission changes in Settings | state restoration of the selected screen; an open editor draft is lost in that case (accepted: access is gone anyway) |
| R13 | Privacy texts contradict the new behaviour | §7 texts are part of the release gate (§8.3) |
| R14 | Web cannot read Google, iCloud and Outlook feeds (no CORS) | honest error copy and file import (with an Import button in the error state); Windows subscribes to them; no proxy (owner, §8.5) |
| R15 | The browser deletes the web app's data: Safari deletes all script-writable storage of a site not opened for about 7 days of Safari use (only Dock and Home Screen web apps are documented as exempt, and `persist()` is granted by heuristics); other browsers evict under storage pressure | Safari-specific notice with the Dock / Home Screen help, "Keep my data" (`persist()` from a click), the 30-day export reminder (§2.16), the privacy and support texts (§7.1); V19 measures Safari 26 with and without a Dock install |
| R16 | Scheduled toasts from an unpackaged Windows app: clicks after the app exited do not reach it without COM activation; the notifier throws without an AUMID registration; toasts outlive an uninstall | protocol-activated toasts, stub toast activator CLSID and `AppUserModelId` registry key, try/catch with the scheduler off when unregistered, `--clear-alerts` on uninstall (§6.4); V13 on the trimmed publish; fallback: alerts only while Thirteen runs, Settings footer changed accordingly |
| R17 | `.ics` files in the wild are messy | tolerant reader, conformance set from real exports, `ical.js` oracle, size limits, worker threads |
| R18 | Four ports drift | `fixtures/events.json` + `fixtures/ics`, staleness checks in CI, per-section `counts` asserted by every port, the `apple-kit` macOS CI job (§6.6), shared logic in core instead of platform code (zone math, overrides, `UNTIL`, Android date lists, the mockup data set), `tzVersion` named on zone failures, recorded zone offsets for every section except `zones` (§5.5), so Windows' registry and each platform's tzdata cannot change the shared expectations |
| R19 | Calendar colors with poor contrast | colors only as bars, tints and dots with an ink ring; text always `ink`, canceled `ink-2` (§2.2); forced-colors rules (§2.20) |
| R20 | Google calendars missing on Android when Google's sharing switch is off | the hint in the Calendars list and support FAQ |
| R21 | Account default alerts may or may not apply to events Thirteen creates | V6 (phase 0: iCloud on macOS 27 adds its default alert to all-day events saved with none, not to timed ones); documented in the support FAQ either way |
| R22 | Schedule: 1.0 waits for all of this on four platforms | the explicit phase order (§6.0); fakes and the shared data set let UI start early; if the owner later wants to cut scope, the cut order is Week mode, drag to resize, Custom repeat, List mode (each is self-contained) |
| R23 | The web origin `siim.github.io` is shared with the owner's other Pages sites: they can read and change local events and secret feed links, and moving origins after 1.0 strands local data | `https://thirteen.haugas.dev/` before 1.0 (§3.6, §8.3 item 10, §8.5) |
| R24 | Android 11 and older expand with a 32-bit `Time` (1902 to 2037) | the API 30 rules of §4.4 (2037 cap, self-expansion outside the range); V12 on API 26 and 30 |
| R25 | Alerts for the LOCAL "Thirteen" calendar on Android depend on the calendar app showing LOCAL calendars | V18; the `ReminderReceiver` fallback (§6.3) |
| R26 | Web alerts: no page `Notification` constructor on mobile, none in iOS Safari tabs, background tabs paused | service-worker `showNotification`, feature detection with hidden pickers, honest Settings footers (§2.14); V17 |
| R27 | Mobile-sized controls: 13-month weekdays without Gregorian context, tiny chips, gesture-only paging | two-line weekday header, densities and minimum sizes, paging actions (§2.1, §2.2, §2.4); accessibility passes in phase 4 |
| R28 | Thirteen damages data other apps made: re-encoded repeats, rewritten imports, lost exceptions on splits, moves and retimes, stale overwrites | the write-back rule (§4.9), raw UID groups (§3.6), `splitRecurrence` and `retimeExceptions` in core with fixtures (§4.7), exception rows copied on Android moves, no repeating copies on Apple, three-way merge (§2.11); `ProviderRepositoryTest` byte-for-byte cases; V2, V3, V5, V23 |
| R29 | Concurrent writers (tabs, threads, other apps, sync) overwrite each other | read-modify-write inside the Web Lock, per-calendar write queues and external change detection on Windows, one refresh per subscription, newer-only feed storage, one alert-planning tab (§3.6, §2.14); multi-instance tests (§6.4, §6.5) |
| R30 | Undo that cannot be exact (new identifiers, invitee mail, EventKit exceptions); a held change that later cannot be written | moves and deletes held as pending changes until the Undo window ends; written changes undoable only where exact (§2.11); a failed commit is retried once, then reverted on screen and reported, also after backgrounding, by the event's name and target; the web journals pending changes in `localStorage` per tab (§2.11); pending changes commit before the event's alerts and on the next action, and every lingering toast has a Close button |
| R31 | Time edge cases: `UNTIL` instants, events at the year 1 and 9999 edges, Julian dates in Foundation | `untilEndDate` (§4.5), `out-of-range` handling and the 1583 floor for editing (§3.1.1), proleptic date mapping on Apple; `untils`, `series` and `zones` fixtures |

### 8.2 Verification gates

Each gate is run on real devices and accounts and recorded by its owner in
`docs/events-verification/{apple,android,windows,web}.md` (one file per team, so no file has two
editors; the Core team's `README.md` there indexes them) with date, OS versions, result and screenshots.
Phase 0 runs V1, V2, V3, V10, V12 and V23 with hand-made events (except the gates the owner deferred,
below); the rest run in phase 4.

| Gate | What | Owner | Pass | If it fails |
|---|---|---|---|---|
| V1 | Form (b) saved by EventKit into iCloud: right days 2026 to 2030 on a second iPhone and a Mac, on iCloud.com, after editing the title in Calendar.app; what Calendar.app calls the repeat | Apple | right days everywhere | iCloud gets `gregorian-only` (R1); no footer sentence |
| V2, EventKit leg | Form (b) saved into a Google account on iOS: Google Calendar web and Android Google Calendar (for now Google Calendar web only, owner, below) | Apple | right days on Google web | Google sources on Apple get `gregorian-only` |
| V2, Android leg | The series of the EventKit leg, then in Thirteen for Android: a title edit of the series (the `RRULE` stays byte for byte), a "this event only" edit and a delete of one occurrence, a drag of the first occurrence by one day (a new `BYYEARDAY` list), an end date set in the editor (`UNTIL` added) and a "future events" title edit from a later occurrence (two `BYYEARDAY` series); check Google web and the iPhone | Android | after the Android edits, the iPhone still shows every date (moved, ended and split as made) and the two exceptions | Android makes `BYYEARDAY` series read-only except alerts (§3.5, `event.readOnly.byYearDay.android`) |
| V3 | Form (d) from Android into Google: Google web, Google Calendar Android, iPhone (Calendar.app and Thirteen through EventKit); a "this event only" edit made in Thirteen for Android through `CONTENT_EXCEPTION_URI` and one made in Google web; a series in two parts | Android | right days on Google web and Android; the Android exception shows as a changed occurrence on Google web, Google Calendar for Android and the iPhone | iPhone shows only the first date: details note on Apple "Repeats set on Android show only some dates here.", support FAQ, and Android's re-encode note becomes `repeat.note.androidReencode.firstOnly` (§2.13); the exception path fails for `RDATE` series: the detached fallback of §4.4 |
| V4 | Exchange / Microsoft 365 calendar on iOS and Android: forms (a) and (c) work; form (b) is rejected or mangled (confirms the gate); where Outlook places monthly-on-the-31st and yearly-February-29 repeats | Apple, Android | forms a, c right; the Outlook placement matches the §2.13 notes | (gate stays); note text changed to what Outlook does |
| V5 | `EKCADErrorDomain 1013` on iOS 26/27 and macOS 26/27: detach an occurrence with an alarm; move a non-repeating event between iCloud and Google; try to move a repeating series with a deleted and a changed occurrence (Thirteen must refuse on the fallback path and keep both exceptions on the direct path); Android: move such a series between two Google accounts (both exceptions kept) | Apple, Android | no error, or fallbacks work as §4.7 says | fallbacks stay on |
| V6 | Do EventKit-created events with no alarms get the account's default alert? | Apple | documented | FAQ text |
| V7 | macOS 26/27 deep link to Privacy & Security > Calendars | Apple | opens the pane | open System Settings |
| V8 | `requestFullAccessToEvents` from the store actor on a sandboxed, Developer ID signed Mac build (`log stream --predicate 'subsystem == "com.apple.TCC"'`) | Apple | prompt shown | main-actor request |
| V9 | Do `CUSTOM_APP_PACKAGE` / `CUSTOM_APP_URI` survive Google sync to a second Android device? | Android | documented | behaviour of §4.4 without marker |
| V10 | `RDATE` in `TZID;` form survives Google sync round trip (edit on Google web, read back); a list at the part size (210 values, §4.4) and a list as Google writes it back are read correctly | Android | unchanged dates; 210 values kept | UTC form; smaller parts (the largest size that is kept; phase 0 set 210 from the limit of Google's web import, §4.4) |
| V11 | Exported `.ics` with form (b): import into Apple Calendar (macOS 26), Google Calendar web, Outlook web, Thunderbird | Windows, Web | right days in Apple and Google (Google web: right days for a file from core's writer in phase 0) | exports keep form (b), and the support FAQ names the app that shows other days; form (d) only if V11 shows Apple Calendar keeping every date of a form (d) file and Google accepting it (phase 0: EventKit's own importer kept only the first date, and Google's web import refuses date lists over about 4,096 characters, §4.4) |
| V12 | Provider expansion on API 26, 30 and 37 images (`ProviderRecurrenceTest`): 1890, 1900, 2038 to 2040 and 2400 dates, `Instances` windows for 1890 to 1901 and 2038 to 2040, an `RDATE` list crossing 2038 | Android | matches §4.4, including the API 30 rules | extend the API 30 rules (2037 cap, self-expansion) to the failing API levels |
| V13 | Windows scheduled toasts on the trimmed single-file publish of the Windows target: app closed, after reboot, x64 and Arm64; clicking opens the day (protocol activation); no toast after uninstall | Windows | delivered and routed | R16 fallback |
| V14 | Android all-day reminders: minutes measured from local midnight; negative minutes accepted by Google sync | Android | documented | keep "On the day at 09:00" hidden, or add it back |
| V15 | Web subscriptions from Google, iCloud, Outlook, Fastmail and Proton links in Chromium, Firefox and Safari, including three refreshes each | Web | documented | update the host list in `subscribe.error.cors` |
| V16 | iCloud all-day flip of a repeating occurrence (two-step save of §4.7) on iOS 26/27 | Apple | right day | keep the two-step save |
| V17 | Web alerts through `alerts-sw.js`: they fire and a click opens the day, in Chrome, Firefox and Safari on macOS, Chrome on Android (tab on screen), and a Home Screen install on iOS 26; unsupported pages hide the pickers | Web | delivered and routed where supported | hide alerts on the failing browser (feature detection list in §2.14) |
| V18 | Alerts for an event in the LOCAL "Thirteen" calendar on a Pixel whose only calendar app is Google Calendar, and on a Samsung with Samsung Calendar | Android | delivered on both | ship the `ReminderReceiver` fallback and its copy (§2.14, §2.15, §6.3, §7.1, §7.4) |
| V19 | Safari 26 eviction: local events after 8 days without opening Thirteen, in a tab and as a Dock app; `persist()` result in each | Web | documented | adjust the Safari notice text to the measured behaviour |
| V20 | Invitee alert edits: EventKit saves an invitee's `alarms` on invitations in iCloud, Google and Exchange calendars, and the alert survives sync; Android `Reminders` rows on a Google invitation | Apple, Android | saved and kept | `alarmsEditable = false` for that account kind (no "Edit alerts") |
| V21 | "Open in Calendar": `calshow:` on iOS 26/27 and macOS 26/27 opens Calendar on the date; Android `ACTION_VIEW` of `Events/{id}` in Google Calendar and Samsung Calendar | Apple, Android | opens the date or event | Mac: open the Calendar app; Android: hide the button where unresolved |
| V22 | Write-only access: `save` into `defaultCalendarForNewEvents` succeeds on iOS 26/27 and macOS 26/27 | Apple | event created | "+" in write-only shows the card text in an alert |
| V23 | EventKit "future events" split in iCloud and Google: a `COUNT=10` series split at its 4th occurrence, with one removed and one detached occurrence after the split, once with the repeat kept and once with End repeat set to After 3 times; record the new series' count, and whether the removed and detached occurrences survive, on iOS 26/27 and macOS 26/27 | Apple | documented; Thirteen's span copy matches it; after the count check of §4.7 the new series has the remaining count (7) or the chosen one (3) | `span.future.exceptionsLost` shown where EventKit drops them (phase 0: a changed occurrence after the split point, §2.11, §4.7); when EventKit gives the new series a wrong count (10 again, or the chosen count minus the head's, which left no rule at all in phase 0), the count check corrects it (phase 0: accepted), and if EventKit refuses the correction, "future events" on `COUNT` series is offered on Apple only from the first occurrence |

**Gate status (owner, v3.3).** Two owner decisions change what runs before 1.0:

- **The Android-to-Google checks are skipped for now**: V2's Android leg, V3 and V10 are not run on
  devices, and their fallbacks ship unless a gate is run later and passes (§8.3 item 2: "its fallback
  shipped"). Shipping fallbacks:
  - V2's Android leg: Apple-made `BYYEARDAY` series are read-only on Android except their alerts (§3.5,
    §2.10, §4.8, §4.9 rule 3, §6.3), with the reason line `event.readOnly.byYearDay.android` (§2.19).
  - V3: "this event only" edits on `RDATE` series use the detached fallback (§4.3 e, §4.4, §4.7: the
    date added to the part's `EXDATE` and a single event with the `thirteen://detached` marker; `RRULE`
    series keep exception rows, and deletes add the date to `EXDATE` as before); the re-encode note is
    `repeat.note.androidReencode.firstOnly` (§2.13), which is not shown while the V2 fallback holds;
    `repeat.footer.android` is left out. The
    Apple details note "Repeats set on Android show only some dates here." does not ship: without V3's
    iPhone findings there is no tested way for Thirteen on Apple to tell which events were set on
    Android, so the support FAQ "Will my 13-month repeats show in other calendar apps?" (§7.1) says
    instead that Calendar on iPhone and Mac may show only the first date of a repeat set in Thirteen for
    Android.
  - V10: Android writes timed date lists in the UTC form (§4.4, `formatDateList(values, 'utc')`); the
    "smaller parts" fallback takes its size from phase 0 (below): parts of at most 210 values (§4.4).
- **Google on Apple is checked through Google Calendar web only for now**: V2's EventKit leg stays open
  and is run on Google Calendar web (no Android Google Calendar check in this leg); until it passes, the
  `repeat.footer.appleGoogle` sentence is left out (§2.13), and if it fails, or 1.0 is released before
  it is run, Google sources on Apple get `gregorian-only` (§3.4, §8.3 item 2).

Each team records a deferred gate in its `docs/events-verification/` file as "not run (owner, v3.3)"
with the fallback in force.

**Phase 0 results (2026-10-19).** The probes ran from 23:43 on 2026-10-19 to 00:20 on 2026-10-20
(EEST) on macOS 27.0.1, through EventKit on the owner's Mac with an iCloud account and through Google
Calendar on the web with a Google Workspace account, each in a temporary "Thirteen QA" calendar deleted
at the end (the iCloud deletion confirmed through EventKit only). The full record, with the legs still open for the owner, is
[`docs/events-verification/phase0.md`](events-verification/phase0.md). No gate passed in full and none
failed; V23's findings put parts of its failure column in force. What changed in this file:

- **V1, partial.** The Mac EventKit leg passes: forms (a), (b) and (c) were stored as written, EventKit's
  days for 2026 to 2030 equal core's at every read (right after saving, after a refresh, about 25 minutes
  later), and an EventKit title save kept the rule. iCloud.com (it needs the owner's sign-in),
  Calendar.app and the second iPhone were not run. Until they pass, development keeps form (b) on iCloud
  and the footer sentence stays out; a release made before then ships V1's fallback (iCloud gets
  `gregorian-only`, §3.4, §8.3 item 2).
- **V23, documented for iCloud on macOS 27** (iOS 26/27, iCloud.com and Google through EventKit not
  run). Removed occurrences survive the split; a changed occurrence after the split point becomes a
  separate event and its date shows twice, so Apple shows `span.future.exceptionsLost` (§2.11, §4.7).
  With the repeat kept the count is right (7); with After 3 times EventKit left the new series with no
  rule, and the count check, which now treats a missing rule as a wrong end, corrected it with an
  accepted second save, so "future events" on `COUNT` series stays offered from every occurrence (§4.7,
  §6.2 `EventKitRoundTripTests`).
- **V2's EventKit leg, not run** (no Google account in Calendar on the Mac). Proxy: a form (b) file from
  core's writer, imported into Google Calendar web, kept `BYYEARDAY` through import and web edits, with
  the right days in 54 sample-month checks from 2026 to 2031. Evidence only; the gate status above
  stands. The same import is the Google leg of V11, whose failure column changed because form (d) is
  unlikely to help (§4.4).
- **V3 and V10, deferred: web-only proxies.** Google web shows a date-list series on the right days,
  stores a "this event only" edit as a `RECURRENCE-ID` override, keeps the `TZID` form, and refuses at
  import any event with more than about 4,096 characters of `RDATE` text. EventKit's own `.ics` importer
  kept only the first date of a date-list series. The fallbacks stand; the V10 fallback's part size is
  now 210 values (§4.3 d, §4.4).
- **Markers.** Google's export and EventKit both write `X-THIRTEEN-RULE` TEXT-escaped, which the v3.3
  reader did not unescape: readers now unescape it (§4.3 e, §5.4, a new `fixtures/ics` case, §5.6).
- **V6, incidental.** On iCloud, all-day events saved with no alerts got the account's default alert;
  timed events got none (§2.14, §7.1, R21).
- V12 was not part of the run. What Google web calls the repeats and how it stores edits is in §4.8.

### 8.3 Release gate for 1.0

1. Parity: `fixtures/events.json` green in TypeScript, Swift, Kotlin and C# with every `counts` entry
   matched, Swift through the `apple-kit` CI job; `fixtures/ics` green in TypeScript and C# for both device
   zones, including `edits/` and `restore/`; staleness checks green for all three fixture files.
2. Every gate in §8.2 passed or its fallback shipped.
3. Accessibility passes recorded per platform (VoiceOver, TalkBack, Narrator, NVDA + VoiceOver on web;
   largest text sizes; keyboard only; switch access paging; forced colors and high contrast; reduced
   motion), including the §2.20 label table in UI tests and the no-dashes checks of §2.19.
4. `privacy.html` and `support.html` live with §7 texts before App Store submission; `app-store.md`
   updated; review notes in App Store Connect.
5. Release scripts check the Mac entitlement and the purpose string; the uploaded build was checked.
6. Screenshots of §6 captured; `docs/screenshots` and the store sets updated (store sets in 12-hour).
7. Windows: `verify-install.ps1` passes on both architectures; uninstall keeps user calendars and removes
   scheduled toasts.
8. Web: e2e suite green on Chromium, Firefox and WebKit; export then import round trip equal; export all
   then restore into a fresh profile equal.
9. Android: instrumented suite green on API 26, 30 and 37; release notes mention the permissions.
10. Web: served from `https://thirteen.haugas.dev/`, an origin no other site uses (§3.6), with the canonical, Open Graph, privacy and
    support URLs and the App Store support and privacy links pointing at it.

### 8.4 Deferred (not in 1.0)

| Item | Why it waits | Target |
|---|---|---|
| Search | EventKit has no text search (4-year chunked scans); a title filter over only the cached years would silently miss events on Apple and Android, and a Windows and web only filter would make the platforms differ; needs its own design per platform | 1.1 |
| Replying to invitations, editing invitees | Android writes to Google send real invitations; Apple needs EventKitUI on iOS only. 1.0 offers "Open in Calendar" and the invitee's own alerts (§2.10) | 1.1 (iOS `EKEventViewController`, Android `SELF_ATTENDEE_STATUS`) |
| Time zone picker, floating-time toggle | rarely needed; existing zones are kept | 1.1 |
| "Make Android compatible" (an explicit action that rewrites an iPhone-made `BYYEARDAY` series as an `RDATE` list) | would change the series on Apple devices too; needs V3 results. Ordinary Android saves never do this conversion (§4.9); only a new Repeat choice re-encodes, with a note | 1.1 |
| `.ics` import and export on Apple and Android | iOS and Android already import `.ics` into their own calendars | later |
| Widgets, Live Activities, complications, Siri / App Intents, Android widgets | separate surfaces | later |
| Week numbers, travel time, attachments, per-event colors (Google palette) | not needed for parity with the brief | later |
| Reminders (to-dos) | different EventKit entity and permission | later |
| `webcal:` handler on the web (`registerProtocolHandler`) | small; after the CORS and origin questions are settled | 1.1 |
| Windows background subscription refresh while closed | needs a scheduled task or startup entry | later |
| Web alerts while no tab is open (Web Push or notification triggers) | Web Push needs a push server, which the brief rules out; notification triggers are not shipped in browsers | not planned |
| Sync between Windows and web, CalDAV, Google or Microsoft sign-in | excluded by the owner's brief | not planned |
| Offline web (a caching service worker) | 1.0's service worker only shows alerts (§2.14); offline caching needs its own update and storage design | later |
| Undo for "future events" changes | needs series snapshots on every platform | later |

### 8.5 Questions for the owner (answered)

Both questions of v2 are decided in `design/DECISIONS.md`, "Web origin and feeds" (2026-10-19):

1. **Web subscriptions to Google, iCloud and Outlook links: no CORS proxy.** The web subscribes to feeds
   that allow cross-origin reads and gives the others the clear message and the `.ics` import path of
   §2.17; Windows subscribes to them, and on Apple and Android the operating system's own calendar
   subscriptions cover them. The "no servers" decision and the privacy policy stay as they are.
2. **The web app's origin: `https://thirteen.haugas.dev/`**, a GitHub Pages custom domain with HTTPS
   enforced, served from the site root (Vite base `/`); the GitHub Pages project address redirects to it.
   The privacy and support pages are `https://thirteen.haugas.dev/privacy.html` and
   `/support.html`. The Route 53 `CNAME` to `siim.github.io` is created only when Pages is enabled for the
   repository, so the name is never left dangling. Release gate §8.3 item 10 checks that the canonical,
   Open Graph, privacy, support and App Store links point there.

No question is open in v3.

---

## 9. Design review of v1: resolutions and rejections

Three critics reviewed spec v1: feasibility (13 findings), UX (27) and data integrity (25), 65 findings
in all. Ids below are `{critic}#{n}` in the order of the review. v2 received the feasibility findings in
full, the UX findings up to #24 (of #24 only its first sentences) and none of the integrity findings.
**v3 handled the full set**: every finding is listed here with where it is resolved. "v2" means it was
fixed in v2 and still holds (v3 may extend it); "v3" means v3 fixed it. Where v3 adjusted a proposal or
did not take it, the reason is in §9.4.

### 9.1 Feasibility

| Id | Finding | Resolution |
|---|---|---|
| feasibility#1 | Web alerts used the page `Notification` constructor | v2: §2.14, §2.18, §6.5, §7.1, §7.5, V17, R26. v3 adds one planning tab and tags (§2.14) |
| feasibility#2 | Conditional headers made web refreshes preflighted | v2: §6.5 (no custom headers, `cache: 'no-cache'`, body hash), §3.6, the 405-on-OPTIONS e2e case |
| feasibility#3 | Shared `siim.github.io` origin | v2 as a requirement; v3: the owner chose `https://thirteen.haugas.dev/` (§0 item 10, §1.3, §3.6, §7.5, §8.3 item 10, §8.5, R23) |
| feasibility#4 | Safari's 7-day storage deletion | v2: §2.16, §6.5, §7.1, support FAQ, R15, V19 |
| feasibility#5 | Android 11 and older `Time` range (1902 to 2037) | v2: §4.4, §6.3, V12, R24 |
| feasibility#6 | Android LOCAL calendar alerts | v2: §2.14, §2.15, §2.18, §6.3 fallback, §7.1, §7.4, V18, R25 |
| feasibility#7 | Windows toast clicks, AUMID registration, uninstall | v2: §6.4, V13, R16 |
| feasibility#8 | `SystemEvents`, multi-target publish, `TargetFramework` | v2: §6.4 (no new package, `-f`, cleared `TargetFramework`) |
| feasibility#9 | `File.Replace` on a missing file | v2: §3.6, §6.4 tests |
| feasibility#10 | Android package visibility for intents | v2: §6.3 `<queries>` and try/catch, §2.10, §2.16 |
| feasibility#11 | Foundation is not EventKit's expander | v2: §5.5, §6.2 `EventKitExpansionTests` in A2 |
| feasibility#12 | Missing `referrerPolicy`; secret links in history | v2: §6.5, §2.17, §2.22 |
| feasibility#13 | Review notes dated 2024 | v2: §7.3 (2028 Leap Day, Year Day 2026) |

### 9.2 UX

| Id | Finding | Resolution |
|---|---|---|
| ux#1 | Compact toolbar, Today, gesture-only paging | v2: §2.1; board A1, E1, H1 |
| ux#2 | Month header without Gregorian weekdays | v2: §2.4, §2.12, §5.2, §5.3, `monthColumns`; board A1, A2, C2, F2 |
| ux#3 | Repeat picker "Next:" mixing systems; weekday drift unexplained | v2: §2.13, §5.2 (`describeNextOccurrences`, `describeRepeatNotes`); board C3 |
| ux#4 | Footer claims about other apps; Exchange note | v2: §2.13 (gated platform sentence, account kinds present), §2.19 |
| ux#5 | Date field accessibility, fallback, tab memory | v2: §2.12; board C2 |
| ux#6 | Week labels without the day | v2: §2.20 label table and column containers, §2.5 |
| ux#7 | Undo only in a timed toast | v2: §2.11, §2.21, §6.2 to §6.5. v3 reworks how Undo works underneath (integrity#15) |
| ux#8 | Editor validation and the Exchange conflict | v2: §2.11 (Save always enabled, announced errors, conflict dialog, immediate trim); board G3 |
| ux#9 | Access cards that never go away | v2: §2.16, §2.18 ("Show my events", one-line link, 30-day "Not now") |
| ux#10 | Write-only "+" and no writable calendar | v2: §2.11, §2.16, V22 |
| ux#11 | Missing states (all hidden, offline, storage, corrupt store, no local calendar) | v2: §2.4, §2.15, §2.16, §6.4, §6.5; board L1, L2. v3 adds suspicious feeds and external file changes (§2.16) |
| ux#12 | Board missed the riskiest states | v2: board groups G to L (27 frames) |
| ux#13 | Unreadable chips on small phones; month label overflow | v2: §2.2, §2.4 (densities, minimum sizes); board A1, H1 (adjusted, §9.4) |
| ux#14 | Drag on tiny chips | v2: §2.4 (drag from the day list) |
| ux#15 | Timeline overlaps without a minimum width; long calendar lists | v2: §2.5, §2.6, §5.2, §5.3, fixtures, §2.15; board K2 |
| ux#16 | Invitations as a dead end; silent updates to invitees | v2: §2.10, §2.11, §3.5, V20, V21; board G1 |
| ux#17 | Drafts lost on other dismiss paths | v2: §2.11, §6.2 to §6.5 |
| ux#18 | Plurals; intercalary dates in templates | v2: §2.19 |
| ux#19 | Copy details (next 7 days, section header, Try again, board note, `{calendar}`) | v2: §2.8, §2.13, §2.4, §2.19; board C3 |
| ux#20 | Dashes from platform formatters | v2: §2.19 "Formatting rules" |
| ux#21 | 12-hour time | v2: Conventions, §2.4, §2.5, §2.7, §2.19, §5.2 `formatChipTime`, §7.3; board J2 |
| ux#22 | Canceled contrast, now line, forced colors | v2: §2.2, §2.20; board F1 |
| ux#23 | Web grid keyboard model and focus | v2: §2.20, §2.21 |
| ux#24 | Month, editor rows and popovers at accessibility sizes | v2 answered the received part (Month as a list of days with titles, §2.4; board J3). v3: runs of empty days collapse into one line (§2.4, `calendar.emptyRun`, from `agenda`), editor date rows stack, and popovers become sheets (§2.11, §2.20); board J3 note |
| ux#25 | Platform idioms: Android editor chrome, Mac and iPad popover editor, phone Day creation | v3: §2.11 presentation table (Android Close, "Save", Delete in the overflow; on Mac and iPad an anchored popover for drafts made by drag or double-click, the sheet for "+" and ⌘N), §2.6 (iOS touch and hold; Android and web compact placeholder, then a second tap), §6.2, §6.3, `editor.close`, `calendar.placeholder*`; board H2, J1, A2 notes (adjusted for Windows and web, §9.4) |
| ux#26 | All-day Busy default; Duplicate and double-click save before editing; Android 400 cap; search | v3: all-day defaults to Free (§2.11, `setDraftAllDay`); Duplicate, double-click and drag open unsaved drafts (§2.10, §2.4, §2.5); the 400 cap is gone (parts, §4.4), so "After" is 1 to 999 everywhere and no helper is needed; search stays deferred (§8.4, §9.4) |
| ux#27 | Board and spec disagree | v3, preferring the spec: board A2 (Duplicate in the ••• menu), B1 ("Show all in Calendar"; "Tomorrow" without dates), D1 (per-group "Hide all", no global button), D2 (info buttons on Windows and web rows), F1 (dark tints 24%). Preferring the board: §2.17 now lists the "Import .ics file" button in the web CORS error state. A1's Today button was settled in v2: hidden while today is on screen (§2.1), shown in H1. "+N more" and "+N" were already consistent |

### 9.3 Data integrity

| Id | Finding | Resolution |
|---|---|---|
| integrity#1 (blocker) | Android saves converted Apple-made `BYYEARDAY` series to `RDATE` lists, collapsing them on Apple devices; `RDATE` and `EXDATE` times not rewritten when a series' start time changes | v3: the write-back rule §4.9 (only changed groups are written; an unchanged recurrence is written back as read; only a new Repeat choice re-encodes), §4.4 table (form b on Android, the retime row), §4.7 retiming, §2.13 `repeat.note.androidReencode`, §6.3 writing, `ProviderRepositoryTest` cases (title edit keeps `RRULE` byte for byte; retime rewrites every `RDATE`, `EXDATE` and `ORIGINAL_INSTANCE_TIME`), V2 extended, §8.4, R3, R28 |
| integrity#2 | `UNTIL` reduced to a date, so a series split one second before an occurrence shows it twice; "end of the until day" without a zone | v3: §4.5 (`untilEndDate`), §5.2 (`untilInZone`, `untilEndDate`, `RecognitionInput` with event-zone values), §4.4 Ends row (23:59:59 of the until day in the event's zone), `untils` fixtures, `until-instant.ics` (adjusted, §9.4) |
| integrity#3 | `EventRecurrence` could not hold `RRULE` + `RDATE`, several `RRULE`s, `EXRULE` or `PERIOD`, so saves dropped them | v3: §5.2 (`extraDates`, `ExtraDate`, `dates` and `foreign` kinds, `Expansion.occurrences`), §4.5 steps 4 to 6, §4.6 (union, `EXRULE` subtraction), §5.4 reader, §5.5 JSON forms and cases, `rrule-rdate.ics`, `exrule.ics`, `two-rrules.ics`; untouched when `editable` is false (§4.5, §4.9, §2.13) |
| integrity#4 | Re-serializing each local calendar rewrote every imported event (seconds, `PERIOD`, Windows zone ids, `VTIMEZONE`s) | v3: §3.6 raw UID groups and `VTIMEZONE`s copied byte for byte, §5.4 (`raw`, `replaceGroup`, original `TZID` strings, `VTIMEZONE` per rule period with `RDATE` observances where needed), §3.3 seconds, §5.6 `edits/outlook-edit-one.ics`, `ny-2005-2026.ics`, `jerusalem.ics` |
| integrity#5 | The 400-value `RDATE` cap ends long series silently; recognition broke after January 1 | v3: §4.4 parts and top-up (no truncation), §4.3 (e) `series` and `part`, §4.5 prefix matching, §5.2 `thirteenRuleRdateParts`, `parts` and recognition fixtures (older horizon, truncated list, second part), the 2020 weekly `ProviderRepositoryTest` case, V10 measures the part size, R4 (adjusted, §9.4) |
| integrity#6 | An edited occurrence of an `RDATE` series became an unlinked single event | v3: §4.4 and §4.7 (exception rows through `CONTENT_EXCEPTION_URI` for `RDATE` series too), the `thirteen://detached` fallback marker (§4.3 e) used only if V3 fails, `ProviderRecurrenceTest`, V3 extended |
| integrity#7 | Splitting a series differed per platform; deleted occurrences came back; the tail's `COUNT` was undefined | v3: §4.7 `splitRecurrence` (head and tail ends, carried and shifted exceptions), §5.2, `splits` fixtures, §6.3 explicit Android splits for `RRULE` and `RDATE` series, V23 records EventKit's behaviour and `span.future.exceptionsLost` follows it |
| integrity#8 | Retiming the first occurrence orphaned `RECURRENCE-ID`s, exception rows and `EXDATE`s | v3: §4.7 `retimeExceptions`, §4.4 retime row, §5.2, `retimes` fixtures, `editor.notice.exceptionsRemoved`; no override that the rule does not produce is ever stored |
| integrity#9 | Cross-account moves lost exceptions and re-invited invitees | v3: §4.7 moves (Android copies every exception row and part in one batch; Apple never copies a repeating event, `move.repeating` offers Duplicate), events with invitees never move between accounts (§3.5, §2.15 `editor.calendar.sameAccount`), V5 extended, `ProviderRepositoryTest` cases, R6 (adjusted, §9.4) |
| integrity#10 | Windows missed events crossing window edges; yearly queries returned them twice | v3: §4.6 `expandSeries` (widened window, overrides placed by their own start, overlap in device wall clock), caches and key dedupe (§3.2, §4.6, §6.2 to §6.5), `series` fixtures, `window-edges.ics` |
| integrity#11 | Year 1 and 9999 edges throw or clamp; fetch windows reach year 10000; Foundation is Julian before 1582 | v3: §3.1.1 supported range (null conversions and `out-of-range` drops, windows ending `9999-12-31T24:00`, horizons capped), `out-of-range` `DraftIssue`, the 1583 floor in the editor (§2.12), `historical` read-only (§3.5), Apple's proleptic mapping (§6.2), `far-future.ics` expected output, `zones` and `series` edge cases, R31 (adjusted, §9.4) |
| integrity#12 | Import compared single `VEVENT`s; local `SEQUENCE` blocked newer exports; no `UID` duplicates; colliding keys | v3: §2.17 step 3 (UID groups, `X-THIRTEEN-IMPORTED-LAST-MODIFIED`, override-only groups, duplicate masters, derived UIDs), §3.2 keys and `#n` suffixes, §3.6, §5.4 (`duplicate-uid`), `import.duplicates`, `duplicate-uid.ics`, `override-only.ics`, `missing-uid.ics` |
| integrity#13 | Exporting several calendars merged them into one file, so a restore lost the structure | v3: §2.17 export (one file per calendar: a zip on the web, a folder on Windows; calendar ids, colors, subscription links) and Restore, §2.18, §6.4, §6.5 `files.ts`, `fixtures/ics/restore/`, the e2e restore test, §8.3 item 8 (adjusted, §9.4) |
| integrity#14 | Concurrent writes lost edits; saves replaced untouched fields; unresolved occurrences; alerts once per tab | v3: §3.6 read-modify-write in the lock and per-calendar queues with a hash check and `FileSystemWatcher` (`store.reloaded`), §2.11 three-way merge (`mergeDraft`, changed `editor.changedElsewhere`) and `editor.occurrenceGone`, drag moves on freshly fetched events, §2.14 one alert tab and tags, tests in §6.4 and §6.5, R29 |
| integrity#15 | Undo by re-saving the previous version re-invites, cannot remove EventKit exceptions, breaks `RDATE` series and overwrites remote changes | v3: §2.11 moves and deletes pending until the Undo window ends, written changes undoable only where exact, field-scoped undo with `calendar.undoUnavailable`; `EventUndo`, `PendingChanges` and `undo.ts` (§6.2 to §6.5), R30 (adjusted, §9.4) |
| integrity#16 | Fixture plan left gaps: no Swift CI, logic in platform code, tzdata drift, one device zone, no year 1, no counts | v3: the `apple-kit` macOS CI job (§6.6, C10, §8.3 item 1); overrides (`expandSeries`), zone math (`ZoneResolver`, `zonedToUtc`), `UNTIL` conversion and Android date lists moved into core with fixtures (§5.1, §5.2, §5.5); `tzVersion`; America/New_York as a second device zone (§5.6); year-1 `expansions` and `descriptions`; `counts` asserted (§5.5, §5.7, §6.0), R18 |
| integrity#17 | Drags onto Year Day or Leap Day ended repeats silently; adaptations undefined | v3: §2.11 adaptation table (monthly and weekly dropped, yearly and intercalary converted, notices) and the drag span dialog (`span.move.changesRepeat`, `span.move.dropsRepeat`, `span.move.futureChange`), §2.12 leap-year stepping (`picker.leapRepeat`), `RepeatChange` in §5.2, `adaptations` fixture rows. The toast already took a preformatted `{date}` since v2, which names intercalary days |
| integrity#18 | DST rule claim wrong for `TimeZoneInfo`; occurrence lengths and all-day alert times undefined | v3: §3.3 (the gap and overlap rule implemented once in core; exact durations; Android `DURATION`), §2.14 alert times, §5.2 `zonedToUtc` algorithm and `alarmFireTime`, `zoneMath`, `series` and `alarmInstants` fixtures on DST days, §6.4 |
| integrity#19 | The 1,000-period guard truncated valid daily rules | v3: §4.6 step 4 (400 x `INTERVAL` years; impossible month and day pairs detected first), `expansions` cases for daily February 29 and day 366, the C5 worst-case timing |
| integrity#20 | Mockup data ambiguous for "every 2 weeks" | v3: §6.7 explicit `DTSTART`s (Sprint planning 2026-01-12), `fixtures/mockup/mockup-events.json` generated by core (C6) and loaded by every fake store (A2, D2, W3, B1) |
| integrity#21 | The EventKit all-day end rule was tested only without a store | v3: `EventKitRoundTripTests` against a real store (§6.2, A2); the read rule is pinned to it |
| integrity#22 | Midnight ends (`T24:00`) cannot be shown by time pickers | v3: §2.12 midnight ends, §3.1.1, `displayEnd` (§5.2), `endForms` and `newDrafts` cases, UI tests in A7, D6, W7, B5 |
| integrity#23 | Monthly-on-the-31st and February 29 placed differently by Outlook; footer claims | v3: §4.1, §2.13 Outlook notes on `gregorian-only` calendars, `describeRepeatNotes` option (§5.2), `repeatNotes` cases, V4 extended. The footer claims were already gated per platform in v2 (§2.13) |
| integrity#24 | Self-expanded `BYYEARDAY` series alert on wrong days; untested exceptions | v3: `event.androidByYearDay` names alerts too (§2.10), §6.3, `ProviderRecurrenceTest` and `ProviderRepositoryTest` cases for edited and canceled exceptions, V2 extended |
| integrity#25 | Subscription refresh races; glitch responses replaced good data; no previous copy | v3: §3.6 refresh rules (one refresh per subscription, newer-only, previous copy as `previousIcs` or `.bak`), §2.16 suspicious results (`calendars.feedEmpty`, `calendars.feedPartial`, accepted on repetition), §6.4, §6.5 tests |

### 9.4 Considered and rejected or adjusted

From v2 (still valid):

- **Web alerts with no tab open** (follows from feasibility#1): not in 1.0. Web Push needs a push server,
  which the brief excludes, and notification triggers are not shipped in browsers (§8.4).
- **Compact Month title threshold of about 56 pt** (ux#13): adjusted to 60 pt. At 56 to 59 pt an 11 pt
  title shows about five letters, which carries as little as the v1 chips did; 60 pt gives about seven.
- **A separate 375 pt iPhone frame** (ux#13): not added. At 375 to 402 pt the Month uses the dots density,
  so a 375 pt frame would look like A1; the 360 dp Android frame H1 covers the narrowest layout.
- **"Show my events" on Windows and web** (ux#9): not added. Those platforms never ask for a permission,
  so there is no prompt or card to suppress; instead Up next appears only once there is something to show
  (§2.8).
- **Mac-style "Send changes?" confirmation on Windows and web** (ux#16): not applicable; those platforms
  never send anything to invitees, and the editor says so (§2.11).
- **12-hour Month chips without a period ("9:30")** (ux#21): rejected for "9:30a" and "2p", because a time
  without AM or PM is ambiguous in a month view.
- **`NetworkInformation` (WinRT) for offline detection on Windows** (ux#11): replaced by the BCL's
  `NetworkInterface` and `NetworkChange`, which work in the plain `net10.0` target too.
- **Keeping `siim.github.io` with a release check that no other Pages site exists** (feasibility#3): not
  recommended in v2; the owner has since chosen `https://thirteen.haugas.dev/` (§8.5), so the question is
  closed.

New in v3:

- **integrity#2, `UNTIL` to the minute in `RepeatEnd`**: adjusted. `RepeatEnd` keeps a date; core turns
  the `UNTIL` instant into the last date whose occurrence starts at or before it (`untilEndDate`). Every
  occurrence a rule generates starts at the same minute in the event's zone, so this is exactly
  equivalent to comparing date and minute, and keeps the fixture JSON and every port's types simple.
  Extra dates need no minute here: RFC 5545 bounds only the rules with `COUNT` and `UNTIL`, and extra
  dates are added whatever their date (§4.6, corrected in v3.1; v3 wrongly compared them with the
  until).
- **integrity#5, roll-forward with a cut a year back**: adjusted to append-only parts. The critic proposed
  ending the event before one year ago and continuing in a new event; parts instead keep every part's
  dates as written, are deterministic from the series start (so the same computation works at creation
  with a past start and at every top-up), and only the last part ever grows. The other proposal, raising
  the cap after measuring, is folded into V10, which confirms 400 or lowers the part size.
- **integrity#9, never offering moves of repeating series on Apple**: adjusted. A direct EventKit move
  keeps EventKit's own exceptions, so it stays offered; Thirteen refuses only on the copy fallback, the
  path that would lose them.
- **integrity#11, the 1583 floor only where Apple disagrees**: adjusted to every platform, so the four
  platforms allow the same edits and the date field behaves the same everywhere. Earlier events stay
  visible and become read-only (`historical`).
- **integrity#13, one tagged file with "Restore {n} calendars"**: not taken as the main format. One file
  per calendar imports correctly into Apple Calendar and Google, which put a file into one calendar;
  Thirteen's own restore still reads the calendar ids. Subscriptions are exported as their last copy plus
  their link (not the link alone), with a warning line, so a restore works offline too.
- **integrity#14, comparing the file's mtime on Windows**: replaced by a SHA-256 of the file, because
  copy and sync tools preserve or coarsen modification times.
- **integrity#15, deferring every undoable change**: adjusted. Moves and deletes are pending; editor saves
  are written at once, because a crash or a killed process during the Undo window must not lose a
  deliberate edit. The critic's fallback of hiding Undo where a pending write is impossible is not needed:
  every platform holds pending moves and deletes.
- **integrity#16, simulator suites in CI**: not taken. The `apple-kit` job runs `swift test` for parity;
  the EventKit simulator suites need calendar privacy grants and stay in `apple/scripts/ui-tests.sh` and
  the release scripts.
- **integrity#23, disabling monthly-on-the-31st and February 29 on Exchange**: not taken. They are
  legitimate repeats on which Thirteen, Apple and Google agree; only Outlook places them differently, so a
  note says so.
- **ux#25, an anchored popover editor on Windows and web**: not taken. Avalonia flyouts and a web popover
  that host nested pickers, validation and the discard question are fragile, and those platforms are
  pointer-first with the 560 px dialog showing the draft's times; Android expanded keeps the Material
  dialog. Web compact uses Android's placeholder pattern because it is touch-first.
- **ux#26, a title filter in List mode for 1.0**: not taken (§8.4). Over cached years only, it would miss
  events on Apple and Android without saying so, and a Windows and web only filter would make the
  platforms differ.
- **ux#26, an "Up to 400 times" helper on Android**: not needed; parts removed the limit.
- **ux#27, "Show all" instead of "Show all in Calendar"**: the spec's label stays (it says where the button
  goes, also to screen readers); the board was changed.

New in v3.1 (re-check round 1, §9.6):

- **r1 integrity#3, splits of `foreign` rules**: adjusted. The head is defined for every rule (each
  `RRULE` and `EXRULE` gets its own end before the occurrence), so "Delete all future events" and a new
  repeat from a later occurrence work on every series. A tail that keeps a `foreign` or `dates` rule, or
  a rule with extra dates, is not defined: those rules are anchored on their own `DTSTART` (weekday,
  month day, interval phase), so moving the start would change their dates. For `editable: false`
  series the span dialog offers "this event only" and "all events" instead of "future events", on every
  platform, so the platforms behave alike even though EventKit could split such a rule itself.
- **r1 integrity#4, `X-THIRTEEN-GENERATED:1`**: adjusted to `X-THIRTEEN-GENERATED:{first year}-{last
  year}`. With only a flag, a writer cannot tell whether the years used grew; the range makes the rebuild
  decision local to the document.
- **r1 integrity#5, where the import baseline lives**: in the raw text (one inserted property line), not
  in the index. The baseline then travels with the group through export and restore, and the index stays
  calendar metadata only. The line is inserted when the group enters the store, so the promise that
  stored groups are copied byte for byte afterwards still holds; the round-trip fixtures (parse then
  serialize) are unaffected because they do not import.
- **r1 integrity#6, deleting an edited `RDATE` occurrence**: the exception row is canceled
  (`STATUS = CANCELED`), not deleted with an `EXDATE` added, which matches the `RRULE` column and does
  not depend on how sync adapters treat a deleted exception row.
- **r1 integrity#9, which duplicate part survives**: adjusted. "Delete the newer row by `_SYNC_ID`
  presence, then lower `_ID`" can make two devices delete different rows (`_ID`s are local), and both
  copies would go. The choice is now the same on every device: a synced row over an unsynced one, then
  the smaller `_SYNC_ID`.
- **r1 integrity#14, `historical` per occurrence**: not taken. An occurrence edit or a split of a series
  that starts before 1583 writes its master on Apple (EventKit saves the master for every occurrence
  change) and reads its start through Julian dates there, the very disagreement the floor avoids. The
  reviewer's minimum is taken instead: on Windows and web, where no other app can change Thirteen's local
  events and core's dates are proleptic, historical events can be deleted (every span) and their alerts
  changed. The false claim about Apple's pre-1583 dates is gone (§3.1.1).
- **r1 integrity#15 and r1 ux#3, committing on the web**: adjusted. `pagehide` is added, but an IndexedDB
  transaction started during unload may still never complete, so pending changes are also journaled
  synchronously in `localStorage` and replayed on the next load.
- **r1 ux#1, "The {n} later events" for every series**: adjusted. A series without an end has no count,
  so it says "Every later event in this series will be deleted." (`*.endless` strings).
- **r1 ux#2, the losses line on every platform**: adjusted for Apple. EventKit splits and retimes by
  itself, and Thirteen cannot count what it drops before it acts; Apple keeps `span.future.exceptionsLost`,
  gated by V23. Android, Windows and web show the counted line.
- **r1 ux#4, scrolling under the popover editor**: scrolling and paging are blocked while the editor
  popover is open, rather than asking the discard question on a scroll gesture; the explicit commands
  (paging buttons, Today, a mode switch) ask. On the Mac the popover is `.transient` while unchanged and
  `.applicationDefined` once changed (not `.semitransient`, which still closes on some outside clicks).
- **r1 ux#5, the drag question on every platform**: applied on Apple and Android only. Windows and web
  never send anything to invitees, and the editor already says so (v2 rejection, still valid).
- **r1 ux#8, canceled titles in `ink` under Increase Contrast**: not needed. With the dark tint kept at
  24%, `ink-2` measures at least 4.84:1 in every dark theme against the platform palettes; the light tint
  can rise to 24% (at least 5.81:1). The strikethrough stays in `ink-2`, which keeps canceled events
  visibly quieter.
- **r1 ux#9, longer toasts for Switch Control, Voice Control and Full Keyboard Access**: partly taken.
  Apple exposes Switch Control and AssistiveTouch, so they count; Voice Control and Full Keyboard Access
  are not detectable, so a connected hardware keyboard counts instead, and Voice Control's "Undo that"
  and every keyboard Undo keep working after the toast for changes that stay undoable. Android and
  Windows use the user's own timeout settings (`getRecommendedTimeoutMillis`, `SPI_GETMESSAGEDURATION`).

New in v3.2 (re-check round 2, §9.8):

- **r2 integrity#1, `applyToSeries`**: taken, with one addition. The edited occurrence's own override
  (when it has one) gets the same changed groups, so the occurrence the user edited shows the change;
  on Apple that is a second save with `.thisEvent`, made only when the edited occurrence is detached.
- **r2 integrity#4, override-only groups**: stored and edited as single events (Repeat locked with
  `editor.repeat.instanceOnly`) rather than read-only with a note. On Windows and web every imported
  event is editable locally, invitations included (`editor.invitees.local`), so a read-only orphan would
  be the one exception; keeping `UID` and `RECURRENCE-ID` on save lets a later import of the master merge
  with it.
- **r2 integrity#6, "the newer row" of two duplicate parts**: the provider keeps no modification time
  for event rows, so "newer" is a row with `DIRTY = 1` (changed on this device and not yet synced) over
  a synced one, and otherwise the kept part's own row. The losing copy's `EXDATE` values are always
  added, because a deleted occurrence must not come back.
- **r2 integrity#8, self-expansion of parts on API 30 and lower**: the rule once per series id (from
  part 1), not each part's stored dates. Stored dates stop at the 2037 cap that the same API levels
  impose, so a never-ending series would show nothing after 2037 on exactly the devices that need
  self-expansion for those years; the rule with every part's exclusions and exception rows gives the
  dates the series means, once.
- **r2 integrity#11, the first `VTIMEZONE` onset**: sampling starts one year before the first year
  used, instead of writing a 1970-era onset. The earlier year's real transitions define the offset on
  January 1 of the first year exactly, and the definition stays as small as before; a 1970 onset would
  claim 1970's rules for every year between.
- **r2 integrity#13, repeating a suspicious result**: compared by parse outcome (event and skipped
  counts), not by a hash of the body without `DTSTAMP` lines. `DTSTAMP` is only the most common
  per-request field; the outcome is what the suspicion was about, and it repeats whatever else the
  server rewrites.
- **r2 integrity#14, recorded zone offsets**: taken for every port, not only Windows. Apple's and
  Android's tzdata can also trail Node's, and one rule for all four keeps the shared expectations
  shared; only `zones` tests each platform's own data, with listed exclusions.
- **r2 ux#1, actions on a later failure toast**: one action, "Try again" for a transient cause and
  "Show event" for every other cause, not both. Material snackbars carry one action (plus Close), so
  two would differ between platforms; the message already names the event and its target, and "Show
  event" matters most where trying again cannot help.
- **r2 ux#2, toasts with only a hardware keyboard**: 20 seconds instead of staying, as suggested;
  ⌘Z keeps working afterwards for changes that stay undoable. The alert trigger commits a minute before
  the event's earliest alert.
- **r2 ux#3, the Calendars list on Android expanded**: the overflow menu stays and opens a supporting
  pane, rather than a permanent list-detail pane, so the 13-month grid keeps its full width until the
  user asks for the list.
- **r2 ux#9, the date picker at accessibility sizes**: the list of days, not the alternative of capping
  the grid at AX1 with the Large Content Viewer, which exists only on Apple and would leave the cells
  unreadable to people who do not know the long-press gesture.
- **r2 ux#10, Option and Alt-drag copies**: defined as Duplicate at the dropped place (an unsaved draft),
  not as a direct save, so it follows ux#26 (every new-event gesture opens a draft) and needs no
  `calendar.copied.*` strings or Undo rules of its own.
- **r2 ux#11, when the stale status shows**: only once a visible subscription is stale (twice its
  interval), not as soon as refreshes pause offline. An hour offline does not make a daily feed
  outdated; the offline banner in the Calendars list still says it at once.
- **r2 ux#13, copy inconsistencies**: the finding reached v3.2 cut off after its second item. The two
  items received are fixed (Command Z for the web on a Mac; toast dates with the year, as `{date}`
  defines), and board C4's note now says "once the draft changed" instead of "once the draft has a
  title". Later items were not received and are not answered.

### 9.5 What v3 changed, for teams that started on v2

- **Core**: new `occurrences.ts` (`expandSeries`) and `date-lists.ts`; `ZoneResolver`, `zonedToUtc`,
  `utcToZoned`, `displayEnd` in `time.ts`; `mergeDraft`, `changedFields`, `alarmFireTime`, `out-of-range`
  and `RepeatChange` in `model.ts`; `untilInZone` and `untilEndDate` in `rrule.ts`; parts and detached URIs
  in `thirteen-rules.ts`; `extraDates`, the `dates` and `foreign` kinds, `Expansion.occurrences`,
  `splitRecurrence`, `retimeExceptions`, the new `RecognitionInput` and the calendar-time guard in
  `recurrence.ts`; raw groups, `replaceGroup`, derived UIDs, duplicate keys and per-period `VTIMEZONE`s in
  `ics/`; new fixture sections, `tzVersion`, `counts`, the mockup data file, new `fixtures/ics` cases and a
  second device zone; the `apple-kit` CI job.
- **Apple**: only changed properties are assigned; merge on save and occurrence re-resolution; pending
  moves and deletes; the anchored popover editor on iPad and Mac; touch and hold to create on iPhone;
  proleptic date mapping; the 1583 floor; `EventKitRoundTripTests`; moves between accounts per §4.7; V23.
- **Android**: the write-back rule (no recurrence columns unless changed; Apple-made `BYYEARDAY` series
  kept); exceptions on `RDATE` series through `CONTENT_EXCEPTION_URI`; parts instead of the 400 cap;
  explicit splits and retimes; moves copy exception rows; `PendingChanges`; editor chrome (Close, Save,
  overflow Delete); the Day placeholder; new provider test cases.
- **Windows**: raw groups and per-calendar write queues with external change detection; newer-only and
  suspicious-result feed rules; UID-group import, restore and folder export; `PendingChanges`; alert times
  from `alarmFireTime`; no `TimeZoneInfo` conversions for event times.
- **Web**: read-modify-write of one group inside the lock; per-subscription refresh locks, `previousIcs`;
  one alert-planning tab; zip export and restore; pending changes; the Import button in the CORS state;
  the origin `https://thirteen.haugas.dev/`.
- **Everyone**: three-way merge on save; Duplicate and new-event gestures open unsaved drafts; all-day
  events default to Free; the adaptation table and the drag span dialog; midnight ends shown as 00:00 of
  the next day; empty-day runs at accessibility sizes; popovers as sheets at accessibility sizes; year
  caches merged by key.

### 9.6 Re-check of v3, round 1 (v3.1)

The data-integrity and UX critics re-checked v3. Ids below are `r1 {critic}#{n}` in the order of the
re-check; adjustments and rejections have their reason in §9.4 ("New in v3.1"). The UX list reached v3.1
cut off after its ninth finding (toast timing); any later finding of that round was not received and is
not answered here.

| Id | Finding | Resolution |
|---|---|---|
| r1 integrity#1 (major) | Apple-made `BYYEARDAY` series still re-encoded or undefined on Android for new start days, new ends and split halves | §4.9 rule 3 (form (b) for every change that is not a picker choice), §4.4 form (b) row, §4.8, §0 item 6, §2.11 (adaptation note, drags never re-encode), §6.3 writing and 13-month repeats; `ProviderRepositoryTest` cases (drag by one day, end date, "future events" from a later occurrence); V2 extended with the drag |
| r1 integrity#2 (major) | `DURATION` counted as recurrence, so a new end time of a series was never written | §4.9 rule 2 and §3.3 (`DURATION` and the `DTEND` switch in the time group), §6.3 writing; `RecurrenceStorage` test wording; `ProviderRepositoryTest` end-time case |
| r1 integrity#3 (major) | `COUNT`/`UNTIL` bounded `RDATE`s; extra dates in splits; widening; "future events" on `editable: false` series | §4.6 (rule stream, rule ends, then extra dates, then exclusions; widening by the longest extra date), §9.4 integrity#2 corrected, §4.7 (extra dates in splits, heads of `foreign` rules, no kept-rule tails), §2.11 and §2.13 ("all events" for `editable: false`), §4.5, §5.2 `droppedCount`; `expansions`, `splits`, `series` cases and `rrule-rdate.ics` against `ical.js` (adjusted, §9.4) |
| r1 integrity#4 (major) | Generated `VTIMEZONE`s ended with `UNTIL`, putting later summers an hour off; never rebuilt | §5.4 (open-ended last period, years used, `X-THIRTEEN-GENERATED` with the year range, rebuild on growth), §3.6; `ny-open-ended.ics` (zone registry cleared), `edits/generated-tz-grow.ics`, C7 (adjusted, §9.4) |
| r1 integrity#5 (major) | Import and restore comparison undefined for groups without a baseline; restore could revert edits or duplicate calendars | §2.17 step 3 (versions, baselines, groups without one) and Restore (version against version, never older over newer, ids kept, `import.restore.keptNewer`), §3.6 (baseline inserted into the raw text at import), §5.4 `groupVersion`, `withImportBaseline`; `imports/baseline.json`, `restore/older.ics`; `ImportExport` and `files.ts` tests (adjusted, §9.4) |
| r1 integrity#6 (major) | `RDATE` deletes and splits left exception rows and detached copies behind | §4.7 `RDATE` column (cancel an existing exception row; delete or carry exception rows on or after the cut; delete or re-point detached copies), §4.4 removed-occurrence row, §4.3 detached marker; three `ProviderRepositoryTest` cases |
| r1 integrity#7 | Retimes ignored all-day toggles and overwrote own-time extra dates | §4.7 Retiming, §4.4 retime row (value types, `ORIGINAL_ALL_DAY`, date-list form, shifted own-time extra dates), §4.9 rule 4, §5.2 `retimeExceptions` options; `retimes` cases, `ProviderRepositoryTest` cases |
| r1 integrity#8 | Drags skipped `validateDraft`, so a drag could write an Exchange-incompatible rule | §2.11 Drag edits (validation before holding, `span.move.notAllowed`, other issues refuse the drop); `drafts` case; UI tests in A6, D5, W6, B4 and `EventEditorStateTests` |
| r1 integrity#9 | Concurrent top-ups duplicated parts | §4.4 duplicate parts (one kept the same way on every device, others deleted by the next top-up run), §3.2, §6.3; `ProviderRepositoryTest` with two copies of part 3 (adjusted, §9.4) |
| r1 integrity#10 | Self-expanded series showed edited occurrences twice | §6.3 self-expansion (drop `Instances` rows by `EVENT_ID` or `ORIGINAL_ID`); the `BYYEARDAY` exceptions test asserts one occurrence each |
| r1 integrity#11 | All-day events on 9999-12-31 needed a year-10000 end | §3.1.1 (no `DTEND` or `DURATION:P{n}D`; readers map 10000-01-01 to `9999-12-31T24:00`), §3.3, §5.4; `edits/year-9999.ics`, `far-future.ics`, `ProviderMapping` test |
| r1 integrity#12 | Colliding `VTIMEZONE` names from Outlook files resolved through the wrong zone | §3.6 (rename `{TZID} (2)` when definitions differ, groups re-serialized), §5.4 `renameCollidingTimeZones`; `imports/customized-tz.json` |
| r1 integrity#13 | `zoneMath` "core only"; Apple test line; fixture names; Kiritimati expectations | §5.5 (`zoneMath` in every port through a synthetic resolver), §5.7, §6.2 tests, §3.6 fixture name, §5.6 `far-future.ics` with Pacific/Kiritimati |
| r1 integrity#14 | False claim about Apple's pre-1583 dates; historical series could never be deleted | §3.1.1 (claim removed, Apple records what EventKit returns), §3.5 and §2.10 (Delete and Edit alerts on Windows and web), `event.readOnly.historical.local` (adjusted, §9.4) |
| r1 integrity#15 | Failed commits of pending changes undefined | §2.11 (retry, revert, `calendar.commitFailed.*`, background failures shown later, `pagehide` and the web journal), §2.19, §2.20; `EventUndo`, `PendingChanges`, `store.ts` and their tests (adjusted, §9.4) |
| r1 integrity#16 | EventKit's tail `COUNT` was never corrected | §4.7 Apple count check, V23 pass and failure columns, `EventKitRoundTripTests` |
| r1 ux#1 (major) | Dragging future events onto Year Day deleted later events behind a mild label | §2.11 (`span.move.dropsRepeat*` with the count, "Move and delete later events" destructive, the editor's later-events lines, `span.deletesLater*`), §5.2 `laterOccurrenceCount`, `adaptations` and `endBefore` counts; board G4 (adjusted, §9.4) |
| r1 ux#2 (major) | Dropped exceptions reported only after a split or a drag | §2.11 (losses computed before the span dialog, `span.future.exceptionsDropped`; the retime notice live in the editor), §4.7, §5.2 `droppedCount`, `editor.notice.exceptionsRemoved` plural (adjusted for Apple, §9.4) |
| r1 ux#3 (major) | No state for a pending change that fails; Undo after an early commit | §2.11 (failure toasts, revert, "Try again", background failures at the next foreground; Undo removed at once when an early commit is not exactly undoable), §2.19, §2.20; tests in §6.2 to §6.5; board G5 |
| r1 ux#4 (major) | The popover editor's dismiss paths, nested popovers, Duplicate, compact iPad | §2.11 presentation table (Duplicate anchored to its source, compact iPad uses the sheet, date and time inline) and dismiss list (outside taps and clicks, Escape, paging, mode switches; the surface does not scroll), §2.12, §6.2; board C4 (adjusted, §9.4) |
| r1 ux#5 (major) | Drags and deletes sent updates to invitees without warning | §2.11 (drag question, delete line, pending toast line), §3.5, §2.19 `move.invitees.*`, `delete.invitees.*`, `calendar.invitees.*`; board G5 (adjusted, §9.4) |
| r1 ux#6 | The re-encode note's trigger and wording; start-date changes on Android | §2.13 (only for rows stored as lists, End repeat Never, concrete wording, V3 variant), §4.9 rule 3 (new start days keep form (b), no note), §2.11 |
| r1 ux#7 | The horizon note was wrong with invitees, with an end, and on API 30 and lower | §2.13 (`androidHorizon` only with End repeat Never; `.invitees`, `.capped`), §2.11 Repeat row repeats the note (board H2 matches) |
| r1 ux#8 | Increase Contrast lowered canceled titles below 4.5:1 | §2.20 (dark tint stays 24% with a border, light tint 24%, measured minima, chip cases in `check-contrast.mjs`), §6.0 ownership, C10 (adjusted, §9.4) |
| r1 ux#9 | Longer toasts only for screen readers | §2.11 Toast timing (Switch Control, AssistiveTouch, hardware keyboards; Android and Windows timeout settings), §6.2 to §6.4 (partly taken, §9.4) |

### 9.7 What v3.1 changed, for teams that started on v3

- **Core**: `expandRecurrence` applies `COUNT` and `UNTIL` to the rule stream only, then adds extra
  dates; `expandSeries` widens by the longest extra date; `laterOccurrenceCount`; `SplitResult.droppedCount`,
  extra dates and `foreign` heads in `splitRecurrence` (kept-rule tails of `foreign`, `dates` and
  extra-date rules throw); `retimeExceptions` options (`minuteDelta`, `allDay`); in `ics/`, open-ended
  last `VTIMEZONE` periods with `X-THIRTEEN-GENERATED`, `groupVersion`, `withImportBaseline`,
  `renameCollidingTimeZones`, the year-9999 all-day end; new fixture cases and fields (`endBefore.later`,
  `adaptations.laterCount`, `retimes` options, `zoneMath` in every port); new `fixtures/ics` cases
  (`ny-open-ended.ics`, `edits/generated-tz-grow.ics`, `edits/year-9999.ics`, `imports/`,
  `restore/older.ics`); the event chip cases in `check-contrast.mjs`.
- **Apple**: "all events" for repeats set in another app; the count check after "future events" splits;
  the popover editor's dismiss paths, inline date and time fields, Duplicate anchored to its source and
  the sheet at compact width; invitee questions for drags and deletes; commit failures, early commits and
  toast timing in `EventUndo`; Increase Contrast tints; pre-1583 dates recorded, not claimed equal.
- **Android**: form (b) kept for Apple-made series on every change except a picker choice; `DURATION` in
  the time group; `RDATE` deletes and splits handle exception rows and detached copies; all-day retimes;
  duplicate parts; self-expansion drops exception rows' own instances; the year-9999 `DTEND`; the
  storage notes' conditions; invitee questions; commit failures and snackbar timing.
- **Windows and web**: import versions and baselines, restore by version with ids kept, renamed colliding
  zone names, generated `VTIMEZONE`s rebuilt as years grow; historical events can be deleted and their
  alerts changed; commit failures (Windows waits for the write on close; the web adds `pagehide` and the
  `localStorage` journal); toast timing (Windows `SPI_GETMESSAGEDURATION`).
- **Everyone**: drags validate before holding; the span dialog states losses and deleted later events
  before the choice, with counts; "Save for all events" for repeats set in another app; new strings in
  §2.19.

### 9.8 Re-check of v3.1, round 2 (v3.2)

The data-integrity and UX critics re-checked v3.1. Ids below are `r2 {critic}#{n}` in the order of the
re-check; adjustments and rejections have their reason in §9.4 ("New in v3.2"). The UX list reached v3.2
cut off inside its thirteenth finding (copy inconsistencies, after its second item); anything after that
was not received and is not answered here.

| Id | Finding | Resolution |
|---|---|---|
| r2 integrity#1 (major) | "Save for all events" took the edited occurrence's date into the master, dropping earlier occurrences, shifting exceptions and splitting on Apple; overrides with their own time; Apple's first occurrence gone; the edited override kept its old values | §4.7 `applyToSeries` (own start date, absolute start minute, length, all-day, zone; the edited override updated; retime options returned) and the span table row, §2.11 (`span.keep.firstGone` on Apple), §4.5, §5.2, §5.7; `seriesEdits` fixtures (`BYWEEKNO` 5th occurrence, an override with its own time, an all-day toggle); `EventKitRoundTripTests` (the `BYWEEKNO` case and a deleted first occurrence); `EventEditorStateTests` |
| r2 integrity#2 (major) | Retimes on Windows and web left `UNTIL` as it was: an invalid `UNTIL` after an all-day toggle and a lost last occurrence after Outlook-style `UNTIL`s moved later; Android's "same until day" ambiguous | §4.7 (`UNTIL` is retimed too, from `untils`: `untilEndDate` with the old start minute, written with `formatUntil`), §4.4 retime row (all columns) and Ends row, §4.5, §4.9 rule 4 (only `UNTIL=` changes in the rule text), §5.2 (`UntilRewrite`, `formatUntil`); `retimes` cases (all-day toggles both ways, Outlook-style `UNTIL` moved 30 minutes later, a `foreign` rule), `untils` `text`, `edits/retime-until.ics`; `RecurrenceStorage` and `ProviderRepositoryTest` cases |
| r2 integrity#3 (major) | Every IANA and Windows zone id was renamed on ordinary imports (Google after Apple, Google after Thirteen), losing raw text and breaking zone resolution | §3.6 (only file-defined names are compared and renamed; known ids keep their raw groups and one `VTIMEZONE`), §5.4 `renameCollidingTimeZones`; `imports/known-tz.json`; `ImportExport` and `files.ts` tests |
| r2 integrity#4 (major) | Override-only groups were skipped without a master; overrides merged into a master without a version rule | §2.17 step 3 (stored and shown as single events through the orphan path, counted; per-override versions and baselines), §3.6 baselines per override, §4.6 orphans, `editor.repeat.instanceOnly`; `override-only.ics` (empty calendar, older and newer overrides); `ImportExport` and `files.ts` tests (adjusted, §9.4) |
| r2 integrity#5 | `EXDATE` values, recognition inputs and override originals had no minute, so own-time extra dates were deduped, deleted and retimed wrongly | §5.2 `OriginalDate` (`exceptDates`, `exdates`, `overrideDates`, `ExceptionMap`, `originalMinute`), §4.6 steps 3 and 4 and `expandSeries` step 4 (date and minute), §4.4 and §4.7 deletes at the own time, §4.7 retiming (own-time values shifted by `minuteDelta`), §4.5, §5.5 JSON forms; `expansions`, `recognitions` and `retimes` cases, `edits/own-time-rdate.ics`, a `ProviderRepositoryTest` case |
| r2 integrity#6 | Deleting a duplicate part lost the exceptions only that copy held | §4.4 duplicate parts (union of `EXDATE`, exception rows re-inserted on the kept part, the newer row kept, one `applyBatch`), §6.3; `ProviderRepositoryTest` with a losing copy that holds an `EXDATE` and an edited occurrence (adjusted, §9.4) |
| r2 integrity#7 | Apple's count check overwrote a new end chosen in the same save | §4.7 count check (compared with the user's choice; a second save only when EventKit got it wrong), V23 (both cases); `EventKitRoundTripTests` with After 3 times |
| r2 integrity#8 | On API 30 and lower each part of a form (d) series was self-expanded with the rule, doubling dates after 2037 | §4.4 Android 11 and older (once per series id, part 1's rule, every part's exclusions and exception rows; parts without a marker by their stored dates), §6.3 `SelfExpansion`; `ProviderRepositoryTest` on API 30 viewing 2040 (adjusted, §9.4) |
| r2 integrity#9 | The web journal could not tell a closed tab's entries from an open tab's, and replayed completed writes as failures | §2.11 the web journal (tab ids, `thirteen-tab-{id}` locks, replay only for free locks, completed writes counted as written), §6.5 `store.ts`; store test with two tabs |
| r2 integrity#10 | Android's footer said Google Calendar shows the same days for `BYYEARDAY` series that it shows wrongly | §2.13 platform sentence table (form (b) rows on Android use `repeat.footer.appleGoogleAndroid`), §2.19; `RecurrenceStorage` notes tests |
| r2 integrity#11 | Generated `VTIMEZONE`s defined no offset before the first transition of the first year | §5.4 (sampling from the year before the first year used), §5.6 `ny-2005-2026.ics` and `ny-open-ended.ics` January checks with the zone registry cleared (adjusted, §9.4) |
| r2 integrity#12 | Apple re-created early-committed deletes as an exact undo | §2.11 Undo table and "After a change is written" (written deletes are never undone on Apple), §6.2 `EventUndo`; `EventUndoTests` |
| r2 integrity#13 | A suspicious feed with per-request `DTSTAMP`s never repeated its hash, so it stayed frozen | §2.16 (same parse outcome accepts), §3.6 `suspect`, §6.4, §6.5; `SubscriptionService` and `subscriptions.ts` tests with per-request `DTSTAMP`s (adjusted, §9.4) |
| r2 integrity#14 | Zone data drift on Windows: fixture expectations came from Node's tzdata, the registry from Windows | §5.5 recorded zone offsets (`zoneOffsets`, `RecordedZoneResolver` for every section except `zones`, exclusions by case id), §5.7, §6.0, §6.1 C6, §6.4 tests, §6.6, R18 (adjusted, §9.4) |
| r2 ux#1 (major) | Failures shown later did not name the event, and several failures, "Try again" after a relaunch and its behaviour were undefined | §2.11 failures nobody saw (`calendar.commitFailed.later.*` with title and target, the plural toast and its list, "Show event", "Try again" writes at once and only for transient causes), §2.19; tests in `EventUndoTests`, `PendingChanges`, `PendingChanges.cs` and `store.ts`; board G5 (adjusted, §9.4) |
| r2 ux#2 (major) | "Next action" was undefined, toasts that stay had no Close, a pending delete could outlive its alert, iPad keyboards made every toast stay | §2.11 Toast timing (the next action, the Close button `toast.close`, 20 s with only a hardware keyboard) and the alert trigger for pending changes, §2.20 Targets, §6.2 to §6.5; board G5 |
| r2 ux#3 (major) | Android expanded width had no way to reach the Calendars list | §2.1 (Android expanded toolbar row, overflow menu, supporting pane), §2.4 "Show calendars" per layout, §6.3 UI and D4; board H1 note (adjusted, §9.4) |
| r2 ux#4 | The failure toast's reason line repeated "Try again" | §2.11 (no reason line with "Try again"; reasons only for final causes, never `generic`), §2.19 `calendar.commitFailed.*.final`; board G5 |
| r2 ux#5 | Which saves show Undo was unclear; Apple registered saves it could not undo | §2.11 Undo table (pending moves and deletes everywhere; written saves on Windows and web, Apple non-repeating without invitees, Android never; "Event saved." without Undo), board G2 note 37 |
| r2 ux#6 | Screen reader templates had no catalogue ids or plurals, and wrote "Gregorian" two ways | §2.19 accessible names (`calendar.cell.a11y`, `calendar.cell.events.a11y` plural, `calendar.band.a11y`, `calendar.item.a11y`, `calendar.bar.a11y`, `calendar.column.*`, `calendar.flag.*`, `calendar.gregorianMonthBegins.a11y`, `year.cell.events`), §2.20 table (one "Gregorian {date}" form, the Week intercalary column with its Gregorian date), §2.3 |
| r2 ux#7 | Gregorian dates without the word in bar labels, continuation flags and the leap-only note | §2.20 (bar labels "from Gregorian ..." on every platform, flags in the bar's form), §2.13 and §5.2 (the leap note names the cap in 13-month form), `repeatNotes` cases |
| r2 ux#8 | iPad by touch had only pointer gestures and 20 pt chips | §2.4 iPad by touch (tap opens details, touch and hold creates or drags), §2.5, §2.11 presentation table, §2.20 Targets exception, §6.2 |
| r2 ux#9 | The 13-month date picker had no rule at accessibility sizes | §2.12 (large detent or full screen, a list of days with both dates), §2.20 Text size, §6.2; board J4 (adjusted, §9.4) |
| r2 ux#10 | Option and Alt-drag copies were one undefined sentence | §2.4 (Duplicate at the drop, an unsaved draft with Duplicate's rules), §2.5, §2.11, §6.2, §6.4 (adjusted, §9.4) |
| r2 ux#11 | Stale subscriptions were visible only in the Calendars list | §2.1 (`calendar.subscriptionsStale` status button), §2.4 states, §2.16, §6.4, §6.5; board L1 note (adjusted, §9.4) |
| r2 ux#12 | Mac write-only card pointed to iOS Settings; no Android "Read only" value; Default calendar and Year dots rows needed access with Show my events off | §2.16 Apple `writeOnly` row (Mac text and "Open System Settings"), §2.18 rows, §2.19 `access.writeOnly.body.mac`, `settings.access.values`; board E2 |
| r2 ux#13 | Copy inconsistencies (received up to its second item) | `calendar.announce.undo` (Command Z on the web on a Mac), §2.11 toasts with the year of `{date}`, board C4 note 59 (adjusted, §9.4) |

### 9.9 What v3.2 changed, for teams that started on v3.1

- **Core**: `applyToSeries` (and `seriesEdits`); `formatUntil`; `OriginalDate` in `exceptDates`,
  `RecognitionInput.exdates`, `overrideDates`, `ExceptionMap`, `OverrideInput.originalMinute` and
  `ExpandedOccurrence.originalMinute`, with matching and dedupe by date and minute; `retimeExceptions`
  returns `untils`; the leap-only note names its cap in 13-month form; in `ics/`, renames only for
  file-defined zone names (`renameCollidingTimeZones` takes the resolver), override-only groups and
  per-override versions, baselines per override, the first `VTIMEZONE` onset a year early; fixtures
  `zoneOffsets` and the `RecordedZoneResolver`, new `retimes`, `untils`, `expansions`, `recognitions`
  and `repeatNotes` cases, `fixtures/ics` cases `edits/retime-until.ics`, `edits/own-time-rdate.ics`,
  `imports/known-tz.json` and the extended `override-only.ics` and New York cases.
- **Apple**: "Save for all events" through `applyToSeries` from the master's own first occurrence, or
  "this event only" when it is gone; the count check compares with the user's choice; written deletes
  are not undoable; the Undo table; failures nobody saw named; the next action, Close, the alert
  trigger, 20 s with only a hardware keyboard; iPad by touch; Option-drag copies as a draft; the date
  picker at accessibility sizes; the Mac write-only card.
- **Android**: the Calendars supporting pane at expanded width; duplicate parts merge their exceptions
  before deletion; self-expansion of parts once per series id on API 30 and lower; retimes rewrite
  `UNTIL` through `formatUntil`; own-time `EXDATE`s; the footer for `BYYEARDAY` rows; the snackbar's
  Close icon, next action and alert trigger; failures nobody saw named; the "Read only" access value;
  rows hidden while Show my events is off.
- **Windows and web**: `UNTIL` retimed; known zone ids never renamed; override-only groups stored and
  shown; per-override versions; suspicious feeds accepted by parse outcome; the stale-subscriptions
  status button; Alt-drag copies as a draft; the web journal's tab ids and tab locks; Windows' fixture
  tests through the recorded resolver.
- **Everyone**: the Undo table, the commit-failure copy without a reason line when "Try again" is
  offered, failures nobody saw, toast Close buttons and the next action; accessible names as catalogue
  strings with "Gregorian {date}" everywhere and Gregorian bar labels on every platform; new strings in
  §2.19.

### 9.10 What v3.3 changed, for teams that started on v3.2

v3.3 writes down what the finished core engine and its fixtures do where v3.2 said otherwise or said
nothing (the engine and fixtures were right; no engine or fixture changes with this version), and the
owner's decisions made since. The phase 0 probe outcomes, added afterwards (below), are the exception:
they ask for one reader change in core and C# (the `X-THIRTEEN-RULE` unescape, §5.4) and one new
`fixtures/ics` case. No board changes. Every change, by topic:

- **Leap-only repeats stop at their cap everywhere** (§4.3 c, §4.5 steps 1, 3 and 5, §4.6, §5.2): the
  cap is 2096 for starts from 2024 to 2096, 2196 from 2104 and 9996 from 9904; `expandRecurrence`,
  `expandSeries`, `nextOccurrences` and `describeNextOccurrences`, `laterOccurrenceCount` (a number, not
  null, for a never-ending leap-only repeat) and `splitRecurrence` stop at the cap whatever the end;
  `recurrenceToRRule` writes a later until or a longer count as `UNTIL={cap}`; a stored `UNTIL` on the cap
  reads back as Never; a leap-only marker, an `INTERVAL=4` rule or a list of Leap Days or Holy Women is
  recognized only with an end on or before the cap (a list past it is a plain date list); a count of 5
  from 2088 gives 3 occurrences and is described as ", 5 times" only until it is saved.
- **Additive API** (§3.1, §5.2, §5.4, packages/core/API.md): `SeriesInput.duration` (`{days, minutes}` or
  null); `ExpandedOccurrence.startUtc` and `IcsExpandedEvent.startUtc` (null for all-day), which the
  alert planners of Windows and web pass to `alarmFireTime` instead of rebuilding the instant from the
  device wall clock (§2.14);
  `setDraftAllDay`'s `timeZone` option, which restores the zone when all-day is turned off (§2.11);
  `describeAlarm(alarm, allDay, systemId?, options?)` next to the §5.2 form `(alarm, allDay, options)`;
  `applyToSeries` is in `model.ts` and `formatUntil` in `rrule.ts`. §3.1 also says that platforms only
  answer UTC offsets through a `ZoneResolver` and that every conversion runs in core.
- **Lengths** (§3.3, §4.6 step 1, §5.4): a master's exact length is `end` minus `start` as instants
  through the event's zone, and a floating series measures it through the device zone, like its start.
  `.ics` `DURATION` days and weeks are nominal (RFC 5545 §3.3.6, §3.8.5.3): on a repeating timed master
  each occurrence ends that many days later on its own wall clock (23 or 25 hours across a DST change,
  `SeriesInput.duration`), and an `RDATE;VALUE=PERIOD` duration counts its days on the extra date's own
  wall clock. Android's `DURATION` stays exact.
- **DST gaps and overrides** (§4.6): an override, `EXDATE`, `ORIGINAL_INSTANCE_TIME` or extra date that
  names the same instant as an occurrence's start on that date (only possible at a gap) belongs to that
  occurrence; a second override of an occurrence already taken is an orphan and not shown; a canceled
  orphan is not shown; an unsupported recurrence shows only its first occurrence and ignores overrides;
  occurrences sort by start, then original date and minute.
- **The range** (§3.1.1, §4.6, §5.4): the §3.1.1 example is corrected (09:00 on 9999-12-31 in New York is
  still 9999 in Tallinn); a timed occurrence whose instant leaves years 1 to 9999 is dropped on every
  device, its own zone included, and counted in `outOfRange` (23:00 on 9999-12-31 in New York; 01:00 on
  0001-01-01 in Tokyo); an end after `9999-12-31T24:00` stops there; a device end before its start (a
  short occurrence across a fall-back hour) ends at its start.
- **Unsupported rules** (§4.6 step 6): any `SKIP`, `SKIP=OMIT` included, and a BY part that the table
  marks n/a for the rule's frequency.
- **Layout readings** (§5.3, the header of `packages/core/src/events/layout.ts`): the order key has three
  ranks (all-day bars, timed bars of 24 hours or more, dots); titles and keys compare by code points;
  keys are unique per call; month lanes sort by clipped start column, then bars before dots, then the
  order key; unlimited `maxLanes` reports the lanes a row uses (`hidden` 0); hidden timeline items keep
  their slots, and the overflow block's end can pass 1440; a timed occurrence whose wall-clock end is
  before its start is laid out zero-length (an all-day one is a `RangeError`).
- **The `.ics` module** (§3.6, §5.4): exported as `@thirteen/core/ics`, with its whole surface in §5.4:
  `IcsEvent.original` and `line`; `IcsCalendar.others` (`VTODO`, `VJOURNAL`, unreadable or unclosed
  `VEVENT`s and exact duplicates, kept and written back as read) and `raw`; the types `IcsTrigger`,
  `IcsRdate`, `IcsObservance`, `IcsOtherComponent`, `ZoneHandle` and `IcsExpandedEvent`;
  `parseICalendar(text, { calendarId, zones })`, `serializeICalendar(calendar, zones, { now })`,
  `replaceGroup(..., { keepRaw })`, `eventsFromCalendar(..., { calendarId, limit })`; the new
  `expandCalendar`, `newICalendar`, `THIRTEEN_PRODID`, `removeGroup`, `eventVersion`, `mergeTimeZones`,
  `allDayEnd`, `untilFor`, `withRetimedUntils`, `sameTimeZoneDefinition`, `windowsZoneToIana` and
  `icsRecognitionInput`. Writer: components in the order read, no byte order mark, the properties of
  untouched fields as read, a `VTIMEZONE` kept when a kept component uses it, a generated `VTIMEZONE`
  for every known zone used without one (also on the first write of another app's file: the
  `zones-added` round trips), generated `VTIMEZONE`s that start a new period instead of writing `RDATE`
  observances (Asia/Jerusalem `-1FR` through 2027, `4FR` from 2028), the current year from `now`.
  Reader: the year-10000 all-day `DTEND` only after starts later than 1000-01-01, the derived `UID`'s
  exact input, `out-of-range` warnings through `expandCalendar`. The §2.17 import and restore merges have
  reference implementations in `packages/core/scripts/ics-procedures.ts` (§5.6).
- **Fixtures** (§5.5, §5.6, §6.7): the `events.json` budget is 700 kB (`EVENTS_FILE_BUDGET_BYTES`; about
  695 kB as generated); the envelope has `complete` and `tzVersion` `2025b`; each case list gives its
  exact count; new fields `rruleEquality.ignoreWkst`, `thirteenRules` `uri` as an object and `detached`,
  `repeatNotes.gregorianOnlyCalendar`, `series` `duration` and `startUtc`, `alarmInstants` occurrences
  with `startUtc`; the first `untils` case has end date November 15 and text `20261115T215959Z`; the
  weekly 2020 `parts` case uses the 2035 horizon (400, 400 and 29 dates); each `thirteenRules` case is
  expanded over the first window that holds an occurrence, with separate late, last-year and past-cap
  cases; a `limit` of 10 replaces the 10,000-limit case; leap-only `endBefore` cases; the `series` cases
  for `DURATION` days, the DST gap and the range edges on both devices; the mockup file runs through the
  recorded resolver; `ical.js` checks list their documented deviations (`ICAL_DEVIATIONS`,
  `FIXTURE_DEVIATIONS`); `fixtures/ics` has `index.json`, `restore/`, round-trip kinds (`as-read`, and
  `zones-added` for `far-future.ics`, `unknown-tzid.ics` and `window-edges.ics`) and is fully generated.
- **Plan** (§5.1, §6.0, §6.1): the module and script list as built; the C4, C6 (700 kB) and C7 done
  criteria; phase 0 records a deferred gate with its fallback.
- **Owner decisions**:
  - Android expanded width: the Calendars list is an on-demand supporting pane, hidden until opened and
    no longer remembered open (§2.1, §2.15, §6.3).
  - The web origin is `https://thirteen.haugas.dev/` only; the old project address is not named any more
    (§3.6, §8.5).
  - Book club's location is "Raamatukoi" in the data set and screenshots; boards A2, C1, G2, H2 and I1
    keep "Raamatukoi, Tartu" (§6.7).
  - The Android-to-Google checks are skipped for now (§8.2 gate status): V2 is split into an EventKit leg
    and an Android leg, and the fallbacks of V2's Android leg, V3 and V10 ship. Android: Apple-made
    `BYYEARDAY` series are read-only except their alerts (§0 item 6, §2.10, §2.13, §3.5, §4.4, §4.8, §4.9
    rule 3, §6.3; new string `event.readOnly.byYearDay.android`); "this event only" edits on `RDATE`
    series use the detached fallback (§4.4, §4.7); `repeat.note.androidReencode.firstOnly` is the variant
    (§2.13, §2.19); timed date lists use the UTC form (§4.4, §4.7), and parts hold at most 210 values
    (phase 0, below; v3.3 as first written kept 400); the support FAQ covers what the Apple details
    note would have said (§7.1); R1, R3, R5, A11, D10 and the manual list of §6.3 say so.
  - Google on Apple is checked through Google Calendar web only for now; V2's EventKit leg stays open
    (§6.2 A11, §8.2).
- **Phase 0 probe outcomes** (§8.2 "Phase 0 results", `docs/events-verification/phase0.md`; run
  2026-10-19 on macOS 27 with iCloud through EventKit and Google Calendar on the web; added to v3.3 after
  the probes, no board changes). A gate not fully run keeps its fallback for release unless the owner
  runs it:
  - V1 (Mac EventKit leg passed; iCloud.com, Calendar.app and the second iPhone not run) and V2's
    EventKit leg (not run; a Google web import proxy kept `BYYEARDAY` with the right days): a release
    made before either passes gives icloud or google calendars on Apple `gregorian-only` (§3.4, §8.2,
    R1); development keeps `all`, and the footer sentences stay out until the gates pass (§2.13, as
    before).
  - V23 (iCloud, macOS 27): `span.future.exceptionsLost` is shown on Apple when a changed occurrence
    follows the split point, because EventKit separates it and shows its date twice; removed occurrences
    survive (§2.11, §2.19 note, §4.7). The count check also treats a new series with no recurrence rule
    as a wrong end (EventKit wrote the chosen count minus the head's: none for After 3 times at the 4th
    occurrence) and sets the chosen rule; EventKit accepted the correction, so "future events" on
    `COUNT` series stays offered from every occurrence (§4.7, V23 row). `EventKitRoundTripTests` expect 3
    after the count check for After 3 times, no longer "no corrective save" (§6.2).
  - V10's fallback gets its part size: Google Calendar's web import refused events with more than about
    4,096 characters of `RDATE` text (254 timed values accepted, 255 refused, 400 all-day accepted), so
    Android cuts parts of at most 210 values (`maxValues: 210`) for all-day and timed series, and keeps
    that size if V10 passes later (§4.3 d, §4.4, §8.2 gate status and V10 row, R4, R5). Google kept the
    `TZID` form on its web paths; the UTC form stays until V10's Android leg passes (§4.4).
  - V11's failure column: exports keep form (b) and the support FAQ names the app that shows other
    days; form (d) only if V11 shows Apple Calendar keeping a whole date list and Google accepting it,
    because EventKit's own importer kept only the first date and Google refuses long lists (§4.4, §4.8,
    §8.2). Google web showed a form (b) file from core's writer on the right days.
  - The `X-THIRTEEN-RULE` value is TEXT: Google's export and EventKit write it escaped
    (`SYSTEM=ifc\;KIND=monthly\;DAY=12`), the v3.3 reader kept the backslashes and
    `parseThirteenRuleText` refused it. `IcsEvent.thirteenRule` is now the unescaped value; the writer
    is unchanged (§4.3 e, §5.4), and `fixtures/ics` gains `google-export.ics` (§5.6).
  - What Google web shows and stores: "Unsupported recurrence" for `BYYEARDAY`, "Does not repeat" for a
    date list, title edits keep the stored lines, one `RDATE` property per value, reordered rule parts,
    overrides without a marker (§4.8, §7.1 FAQ).
  - V6 on iCloud (macOS 27): all-day events saved with no alerts get the account's default alert,
    timed events none (§2.14, §7.1, R21).
- **Outside this file**: the shared Gregorian history text now reads "skipping 3 to 13 September" (no
  dash) in all four calendar engines and in `fixtures/conversions.json`; it belongs to `docs/SPEC.md`, and
  no events text quotes it.

Who acts: **Apple** runs V2's EventKit leg on Google Calendar web. **Android** ships the three fallbacks
and the new reason line, and makes the Calendars pane on-demand. **Windows and web** pass each
occurrence's `startUtc` to `alarmFireTime` when they plan alerts (§2.14), adopt the §5.4 surface
(`others`, `original`, `now`, `keepRaw`, `expandCalendar`, `zones-added` round trips) and compare
imports and restores with the reference documents. **Ports** (Swift, Kotlin, C#) add the leap
cap, `SeriesInput.duration`, `startUtc`, the gap matching and the layout readings, and assert the new
counts.

After phase 0: **Apple** shows `span.future.exceptionsLost` when a changed occurrence follows the split
point, handles a new series without a rule in the count check, updates `EventKitRoundTripTests`, and
records the probe legs it runs with the owner (V1's iCloud.com, Calendar.app and second-iPhone legs,
V23 on iOS and with Google, V2's EventKit leg). **Android** cuts parts of 210 values. **Core** unescapes
`X-THIRTEEN-RULE` in `parseICalendar` and adds `google-export.ics`; **Windows** does the same in the C#
reader (the web uses core). **Windows and web** keep exporting form (b) (V11).
