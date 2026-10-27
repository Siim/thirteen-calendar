# Calendar section (web): modules and seams

The Calendar section of the web app (docs/EVENTS.md §2.1 to §2.7, §2.18, §2.21, §2.22). Task B3
built the shell of it: routes, toolbars, paging, the Year, Month and List modes, the Settings page and
one module per view that the later tasks fill in. Each later task owns its own files, so tasks B4 to
B7 can work at the same time without editing each other's files. Every view codes against the
`EventStore` interface of `@thirteen/ui` (`packages/ui/src/events/store.ts`), so tests and screenshots
run on `MemoryEventStore` with the mockup data set (`?store=mockup`) and the app on B2's IndexedDB store.

## How it fits together

```
main.tsx            ?store=mockup, ?today=, ?now=  ->  app/eventStore.ts (the store), app/Providers.tsx
app/Providers.tsx   Theme, system, today, EventStoreProvider, ClockProvider (useNow, useUse24Hour), ToastProvider
app/App.tsx         EventActionsProvider (B5) + CalendarsDialogsProvider (B6) around the Shell; the routes
app/router.ts       the routes of §2.22 (+ #/list/{date}); takeSubscribeUrl strips ?url= at once (§2.17)
app/Shell.tsx       nav "Calendar" (current on every Calendar route), the gear button for #/settings
features/calendar/
  CalendarPage.tsx  mode + day from the route (calendarState.ts), the toolbar, paging, Today, the
                    left column (CalendarsPane) or the compact Calendars sheet, keyboard (§2.21),
                    #/calendar, #/new-event and #/subscribe, the stale-subscriptions button, loading
  calendarState.ts  routeView, viewRoute, pageDate, showsToday, viewTitle, last view per window
  CalendarToolbar   regular and compact toolbars of §2.1
  YearMode.tsx      the old Year page + dots (yearEventMarks) + month titles that open Month
  MonthMode.tsx     MonthEventGrid (densities), the compact day list, "+N more", context menu, MonthDayList
  ListMode.tsx      AgendaList over merged years (useOccurrencesInYears dedupes by key), loads a year on scroll,
                    keeps the listed days while it loads, stops 10 empty years past the last listed day
                    (LIST_EMPTY_YEARS_AHEAD) and at once while every calendar is hidden
  WeekMode.tsx      SEAM B4   DayMode.tsx  SEAM B4   useCalendarDrag.ts  SEAM B4
  EventActions.tsx  B5 (done) CalendarsPane.tsx (+ .module.css)  B6 (done)
  KeyboardHelp.tsx  the "?" dialog (§2.21 web column), also opened from Settings next to the single-key switch
features/today/UpNext.tsx            B7 (UpNextCard and useUpNext of @thirteen/ui)
features/year/DayEvents.tsx          B7 (top of the Year day sheet)
features/settings/SettingsPage.tsx   B3: Default calendar, Show events in Year view, Single-key shortcuts
features/settings/AlertsRow.tsx      B7 (+ AlertsHost.tsx, lib/events/alerts.ts, public/alerts-sw.js)
features/settings/DataRows.tsx       B7 (Export all through B6's Export dialog, Delete all events)
lib/preferences.ts  the Settings values (yearDots, singleKey, default calendar), shared live
```

Shared components live in `packages/ui/src/events/` and are exported from `@thirteen/ui`:
`MonthEventGrid`, `IntercalaryEventBand`, `EventChip`, `MonthDayList`, `AgendaList`, `AgendaRows`,
`AgendaRow` (the row of the day list, List, "+N more" and Up next), `DayHeading`, the copy module
`copy.ts` (`copy`, `plural`, §2.19 strings checked verbatim against docs/EVENTS.md by `copy.test.ts`)
and `format.ts` (times, day headings, and the §2.20 labels `itemLabel`, `barLabel`, `rowLabel`,
`monthCellLabel`, `bandLabel`). Hooks: `useOccurrences(year)`, `useOccurrencesInYears(years)`,
`useNow()`, `useUse24Hour()`.

## The seams

A seam is a file that already has its final exports and props, with a placeholder body. The owning
task replaces the body and keeps the exports; nothing else has to change. Placeholders do nothing, or
the least that keeps the Calendar usable.

### B4: Week and Day timelines, drag and drop (done)

- `WeekMode.tsx`, `DayMode.tsx` draw `Timeline` and `WeekStrip` of `@thirteen/ui`
  (`packages/ui/src/events/Timeline.tsx`): column headers in both calendars, the all-day row (lanes,
  "+N" after 3 lanes), the 24-hour timeline laid out by core (`layoutThirteenWeekEvents`,
  `layoutDayEvents`) with `maxSlots` from the column width (48 px Week, 64 px Day, in rem), the "+{n}"
  block and its list, the now line under the blocks, intercalary columns (60%, hatched), columns as
  `role="group"` with a roving tab stop (arrows; Enter or F2 in; Escape out) and a "New event" action.
  Empty time: drag for a draft (15-minute snap), double-click for one hour, or (compact Day) the tap
  placeholder; each calls `actions.newEvent({date, anchor, start, end})` (device wall clock). A block's
  bottom edge changes its end. Week falls back to Day at accessibility text sizes. The placeholder is
  drawn on the tap's `click`, not on `pointerup` (after a touch, Chromium and WebKit hit-test that click
  after `pointerup`, so it would land on the new placeholder and open the editor at once). Day mode's one
  column is always full width, also on an intercalary day.
- `useCalendarDrag.ts`: pointer-event drags for Month chips (`itemProps`), list rows (`rowProps`: the
  compact day list, "+N more", the "+{n}" list) and timeline blocks and bars; targets are found under
  the pointer by `data-date` (Month cells and bands), `data-timeline-day` and `data-timeline-allday`.
  Returns `preview` (the timeline ghost), `resize` and `overlay` (render it once: the span question
  and the drag image). Alt at the drop copies (`actions.duplicate(key, anchor, {start, keepTime})`).
  The day a source was picked up on is the cell or column under the pointer (a timeline bar is one
  element over several columns, so it is found by `x` in the all-day row).
- `useEventMover.tsx` + `moves.ts` (pure, tested in `moves.test.ts`): the moved time group, the span
  question of `MoveSpanDialog.tsx` with the repeat change, later-events count and removed changes said
  before the choice, `validateDraft` before holding, then `actions.hold(request, {message, ...})` (B5's
  undo layer: toast, Undo, Ctrl+Z, commit and its failures).
- The store contract gained `overrideDates?(eventId)` (both stores implement it) for the losses line.

### B5: details, editor, date field, pickers, span dialogs, undo (done)

- `EventActions.tsx`: `EventActionsProvider({ defaultCalendarId, children })` (mounted in App.tsx) and
  `useEventActions(): EventActions` with `openDetails(key, anchor)`, `newEvent({date, allDay?, anchor?})`,
  `edit(key)`, `requestDelete(key, anchor)`, `duplicate(key, anchor)`, `undo()`, `redo()`. The views call
  them: Enter or double-click on a chip, a row click, double-click on a Month cell's empty space, "+",
  "New event", C, E and Delete or Backspace on the focused event (List rows, the day list, "+N more"
  rows, which carry `data-event-list`, and Up next) or else the selected one, Ctrl+Z / Cmd+Z and Ctrl+Shift+Z /
  Cmd+Shift+Z outside text fields, the Month context menu (Duplicate, Delete), and `#/new-event?date=`
  (CalendarPage calls `newEvent({date})` once and replaces the entry with the day's Month route). The
  provider renders the popover, the editor dialog and their questions itself. Focus after actions
  (§2.20): chips, rows and cells carry `data-key` / `data-date`, so the provider can find them.
- Toasts: `useToast()` (B1). CalendarPage already calls `toast.nextAction()` before paging, Today and
  mode switches (§2.11 "next action").
- `hold(request, {message, undoableWhenWritten, restoreKey?})` holds a move or delete with its toast and
  Undo (B4's drags call it); it returns null, with a failure toast, when the store refuses the change.
- The components are in `packages/ui/src/events/editor/` (exported from `@thirteen/ui`): `EventDetails`
  (offers: Edit, Duplicate in the ••• menu, Delete event; Edit alerts and Delete event for events before
  1583; Duplicate for other read-only events), `EventEditor` (requests `new`, `edit`, `alerts`),
  `ThirteenDateField` and `DatePickerPanel`, `RepeatPicker`, the alert pickers, `ChoiceDialog` (span,
  delete, discard, conflict questions), and the pure rules in `dateField.ts`, `editorModel.ts`,
  `repeat.ts`, `alerts.ts`. Undo is `EventUndo` (`packages/ui/src/events/undo.ts`) with
  `EventUndoProvider` / `useEventUndo()`: held changes are discarded on Undo; written ones are restored
  exactly through the optional store methods `snapshotEvent` / `restoreEvent`, or (a single event that
  changed since) only the field groups the change touched, else `calendar.undoUnavailable`. Commit failures come
  from `onCommitFailure`; failures nobody saw from `failedCommits` / `clearFailedCommits`, shown at
  launch and when the tab becomes visible. `ResolvedOccurrence.repeatEditable` and `instanceOnly` feed
  the Keep rows and span questions.
- Re-check (2026-10-26): "Edit alerts" is offered only where the browser can show alerts (elsewhere the
  pickers are hidden and the reduced editor would be empty); changing a series' alerts has no Undo (an
  "all events" change); `ThirteenDateField` takes `disabledDay` (the editor passes `skippedDays(zone,
  zones)` of `dateField.ts` for a timed event with a zone: days the zone skips, such as Pacific/Apia
  2011-12-30, are disabled, §2.12); the 24 px day list opens on the selected day; the editor's history
  guard sends a deep link that arrives while a changed draft is open back to the editor's page until the
  discard question is answered ("Discard changes" then follows the link).

### B6: Calendars panel, import, export, subscribe (done)

- `CalendarsPane.tsx`: `CalendarsPane({ headingLevel?, hideHeading? })` is the left column at regular
  width and the content of the compact Calendars sheet (the title menu's "Calendars"; the sheet is a
  `Dialog` in CalendarPage). It draws `CalendarsPanel` of `@thirteen/ui`
  (`packages/ui/src/events/calendars/`): groups "In this browser" and "Subscriptions", collapsible
  (remembered in localStorage `thirteen-calendars-collapsed`), "Hide all" / "Show all", check boxes
  (switches on compact width) in the calendar's colour, "Read only", the info button (the calendar's
  settings: name, colour; link, update interval, "Update now", "Unsubscribe"; "Export", "Delete
  calendar"), the subscription states of §2.16, unreadable calendars ("Download it", "Delete calendar"),
  the offline banner, the four buttons, the storage cards, the export reminder and the storage line. It
  keeps `data-calendars-pane` on its root and `data-calendar-visibility={id}` on every toggle.
- `CalendarNotices()`: the "storage unavailable" banner above every mode (memory mode).
- `CalendarsDialogsProvider` (mounted in App.tsx) renders the Subscribe, Import or Restore, Export, New
  calendar and settings dialogs, the hidden file input and file drops on the window.
  `useCalendarsDialogs()`: `openSubscribe(url)` (`#/subscribe?url=` calls it once), `openImport()` (the
  file picker; call it from a click), `openExport(ids | null)`, `exportAll()` (the Export dialog with every calendar checked: the storage
  cards, the export reminder and Settings' "Export all" use it, as §2.17 lists them and as Windows does,
  so `export.secretLinks` shows whenever a subscription goes along), `openSettings(id)`, `openNewCalendar()`,
  `confirmDelete(id)`.
- Documents and subscriptions: `lib/events/files.ts` (zip, the import and restore merges of
  `packages/core/scripts/ics-procedures.ts`, reading files, export) and `lib/events/services.ts`
  (`servicesFor(store)`: the web store's services, or a fallback for the mockup store that checks links and
  reads files but writes nothing), both loaded with a dynamic import. Settings' "Export all"
  (`features/settings/DataRows.tsx`) opens the Export dialog through `useCalendarsDialogs().exportAll()`.
  Restore (B8): a browser's own "Personal" created on first use gives way to the restored local
  calendars while it is the only calendar and holds nothing, so a backup restored into a fresh browser
  gives exactly the backed-up calendars (§8.3 item 8). The merges replace UID groups in one pass
  (`GroupMerge`, the same documents as the reference, checked in `files.test.ts`), so a large file
  merges in linear time (20,000 events: about 0.3 s instead of 10 s).
- A file without its own calendar name is offered to Settings' Default calendar (`useDefaultCalendar`).
- Stale subscriptions: one rule, `isStaleSubscription` of `@thirteen/ui` (twice the interval since the
  last update, or since it was added here when it never updated, as on Windows; manual feeds never
  warn), read by the rows, the toolbar's `hasStaleSubscription` and `lib/events/subscriptions.ts`.
  Hidden subscriptions are not refreshed on their schedule (§2.15, as on Windows); "Update now" is.
- `CalendarsPane.module.css` holds the banner's styles; the list's are in `@thirteen/ui`.

### B7: Up next, day panel events, Settings rows, alerts

- `features/today/UpNext.tsx`: `UpNext()`, mounted in TodayPage under the hero, before the year
  progress. "Show all in Calendar" goes to `{ name: 'list', date: today }` (`#/list/{iso}`).
- `features/year/DayEvents.tsx`: `DayEvents({ date })`, mounted at the top of the Year day sheet
  (`DayDetailPanel`). "Open in Calendar" goes to `{ name: 'day', date: iso }`.
- `features/settings/AlertsRow.tsx`, `DataRows.tsx`: rows of the Calendar group on the Settings page;
  use `styles.row`, `styles.footer`, `styles.buttons` from `SettingsPage.module.css`.
- Rows: `AgendaRow` / `AgendaRows` from `@thirteen/ui` (time column, dot, title, second line, the Now
  plate with `now={useNow()}`, `calendar.row.a11y` labels).
- Alerts land on `#/day/{date}` (the router has that route).

Done (B7). What other tasks use:

- `useUpNext()`, `upNext()` and `UpNextCard` are in `@thirteen/ui` (§6.5 `useUpNext`). The card shows
  once a local calendar holds an event this year or next, or a subscription exists (§2.8, §9.4).
- Alerts: `lib/events/alerts.ts` (support detection, the switch, `AlertPlanner` in the tab holding the
  `thirteen-alerts` lock, times from `alarmFireTime` with `startUtc`, tags `{key}|{index}`),
  `lib/events/useAlerts.ts` (`useAlerts()`: `supported`, `permission`, `enabled`, `setEnabled`,
  `alertChosen`) and `public/alerts-sw.js` (only `notificationclick`). `features/settings/AlertsHost.tsx`
  (mounted in App.tsx) runs the planner while alerts are on and opens the route a notification click
  posts. Alerts are on while the browser allows notifications, unless the switch was turned off, so an
  editor that asks for the permission when an alert is set (§2.14) turns them on. `EventActions.tsx`
  passes `useAlerts().alertChosen()` to the editor as `requestAlertPermission` (B8), so the prompt comes
  from that gesture, is never shown once the switch was turned off, and registers the worker at once
  (also when "Show alerts" was on but its own prompt had been dismissed).
  `supported` false hides the pickers; `permission === 'denied'` shows `alert.web.blocked`. The planner
  plans every calendar's alerts except subscriptions' (§2.17 "never alert", whatever the store passes);
  hidden calendars still alert.
- "Show calendars" outside the Calendar: `features/today/ShowCalendars.tsx` (`useShowCalendars()`).

### B2: the store

- `app/eventStore.ts` `createPersistentStore()` returns the IndexedDB store (`startWebEvents` of
  `lib/events/index.ts`); `?store=mockup` returns the mockup `MemoryEventStore` instead.

## Copy and labels

Every visible string of these screens comes from `@thirteen/ui`'s `copy.ts` (the §2.19 catalogue,
verbatim, typographic apostrophes as the web's other strings). Add the strings a new screen needs to
`copy.ts` with a small edit in its own block (several tasks add to it; `copy.test.ts` checks each one
against docs/EVENTS.md). Two names are the app's existing ones because §2.19 has none: "Previous year"
and "Next year" (Year mode paging). The keyboard help dialog (`KeyboardHelp.tsx`) has no §2.19 strings
either: it uses the §2.21 table's own action names and keys, kept in that module. User-supplied text (titles, locations, calendar names) is marked
`data-user-text` for the no-dashes scan of §2.19.

## The clock

Views that compare anything with "now" read the app's clock, never `Date.now()` or `new Date()` directly:
`useNow()` (the device wall clock, pinned by `?now=` and by the mockup store to 2026-10-19 09:41) and
`useToday()`, or `useNowMs()` of `CalendarsPane.tsx` for epoch milliseconds (the subscription rows and
the toolbar's "Subscriptions not updated" both read it, so they agree). Screenshots and tests pin the
clock; a view on the real clock drifts from the rest of the screen as the real date moves on.

## Routes (§2.22)

`#/calendar` (last mode and day of this window, sessionStorage; first launch Month, today),
`#/year/2026[?day=]`, `#/month/2026/11[?day=]`, `#/week/2026-10-19` (Day on compact and at accessibility text sizes, §2.20),
`#/day/2026-10-19`, `#/list/2026-10-19` (not in §2.22; List needs a URL like the other modes),
`#/new-event?date=`, `#/subscribe?url=`, `#/settings`. Every Calendar route takes `?system=`, applied
once per history entry. Invalid values open the screen with defaults.
