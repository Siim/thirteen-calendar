import Foundation
import Observation
import OSLog
import SwiftUI
import ThirteenKit

/// A day whose comparison is shown in the detail sheet.
struct DaySelection: Identifiable, Hashable, Sendable {
    let date: GregorianDate
    var id: Int { date.julianDayNumber }
}

/// An event whose details are open (docs/EVENTS.md §2.10). The iPad and Mac popover points at the
/// event's chip, block or row; `anchorDay` is the day it falls back to (a Month cell) for an event
/// with none on screen, like one hidden in "+N more".
struct EventPresentation: Identifiable, Hashable, Sendable {
    let key: String
    var anchorDay: GregorianDate?
    var id: String { key }
}

/// A delete that needs a question before it is held (§2.11): the span of a repeating event, or the
/// invitee question of an event the user organizes. The span dialogs (task A7) answer it with
/// ``AppModel/confirmDelete(_:span:undoManager:)``.
struct DeleteRequest: Identifiable, Sendable {
    let snapshot: EventSnapshot
    var id: String { snapshot.key }
    /// A repeating occurrence: ask "Delete This Event Only" or "Delete All Future Events".
    var needsSpan: Bool { snapshot.occurrence.isRepeating }
    /// The event has invitees (they will be told).
    var hasInvitees: Bool { snapshot.event.attendeeCount > 0 }
}

/// One window's model: the app-wide ``AppState`` (calendar system, overlay preference, today,
/// events) plus this window's navigation, the selected screen and each screen's position, which
/// deep links and keyboard shortcuts drive. Every iPad window has its own, so windows navigate
/// independently; the Mac's single main window shares its model with the menu bar extra.
///
/// Calendar (docs/EVENTS.md §2.1): ``calendarMode`` and ``calendarDate`` (the selected day; Year
/// mode shows its year, Month its 13-month month, Week its 13-month week). The events entry points
/// (new event, details, editor, delete) are documented at the top of `EventsModel.swift`.
@MainActor
@Observable
final class AppModel {
    /// The state every window shares.
    let state: AppState

    /// The 13-month system every screen shows (app-wide, persisted).
    var system: CalendarSystemID {
        get { state.system }
        set { state.system = newValue }
    }

    /// Whether the Year grids show the Gregorian date in every cell (app-wide, persisted).
    var showsGregorianOverlay: Bool {
        get { state.showsGregorianOverlay }
        set { state.showsGregorianOverlay = newValue }
    }

    /// Today's local date (Gregorian), app-wide.
    var today: GregorianDate { state.today }

    /// The events (app-wide).
    var events: EventsModel { state.events }

    /// The visible screen. A switch is a "next action" (§2.11): it closes a toast that stays.
    var section: AppSection = .today {
        didSet { if section != oldValue { noteNextAction() } }
    }
    /// The Calendar mode (§2.1; first launch: Month). A switch is a "next action".
    var calendarMode: CalendarMode = .month {
        didSet { if calendarMode != oldValue { noteNextAction() } }
    }
    /// The selected day of Calendar: the day Day mode shows and whose month, week or year the other
    /// modes show. Selecting a day changes it; paging and Today go through ``pageCalendar(by:)`` and
    /// ``showTodayInCalendar()``.
    var calendarDate: GregorianDate
    /// Gregorian year shown by Calendar's Year mode: the year of ``calendarDate``. Setting it keeps
    /// the 13-month slot (a leap-only day falls back to the day before it).
    var year: Int {
        get { calendarDate.year }
        set {
            let year = Self.clampYear(newValue)
            guard year != calendarDate.year else { return }
            calendarDate = CalendarPeriod.sameSlot(calendarDate, inYear: year, system: system) ?? calendarDate
        }
    }
    /// Gregorian year shown by the Compare screen.
    var compareYear: Int
    /// The converter's day (both sides of the converter show this same day).
    var convertDay: GregorianDate
    /// Which side of the converter is the input.
    var convertDirection: ConvertDirection = .fromGregorian
    /// The day whose comparison sheet is open, if any.
    var detail: DaySelection?
    /// Whether the settings sheet is open (iPhone and iPad; the Mac has a Settings window).
    var showsSettings = false
    /// A day the Year screen should scroll into view (its month), set by deep links, "Show in
    /// Year" and the Year screen's Today button; the Year screen clears it once it has scrolled.
    var yearFocus: GregorianDate?

    // MARK: Events (per window)

    /// The selected event (⌘E edits it, ⌫ deletes it).
    var selectedEventKey: String?
    /// The open event details (§2.10). Closing them (not for the editor) returns assistive focus
    /// to the item that opened them (§2.20).
    var presentedEvent: EventPresentation? {
        didSet {
            if presentedEvent == nil, let closed = oldValue?.key, editor == nil { moveAccessibilityFocus(to: .event(closed)) }
        }
    }
    /// Where assistive focus goes next (§2.20 Focus after actions): the view marked with the same
    /// anchor takes it once, when it is on screen (`EventPopoverAnchorModifier`).
    var accessibilityFocusRequest: AccessibilityFocusRequest?
    /// The open editor (§2.11). A new editor gets the calendars, system and zone it needs
    /// (`prepareEditor`, EventEditorFlow.swift).
    var editor: EventEditorState? {
        didSet { if let editor, editor !== oldValue { prepareEditor(editor) } }
    }
    /// Where details and the editor are shown in this window (sheet, popover, pushed; task A7).
    let eventPresentation = EventPresentationState()
    /// A delete waiting for its question (span, invitees).
    var deleteRequest: DeleteRequest?
    /// An alert to show (the "+" alerts of §2.16, the editor's closing alerts).
    var eventsAlert: EventsAlert?
    /// The Calendars list in the sidebar while Calendar is selected (regular width, §2.1); ⌥⌘K
    /// hides and shows it.
    var showsCalendars = true
    /// The Calendars sheet of the title menu (compact width).
    var showsCalendarsSheet = false
    /// The split view's columns (iPad and Mac, `SplitRootView`): "Show Calendars" and ⌥⌘K show a
    /// collapsed sidebar first (§2.4 States, §2.21).
    /// Starts with both columns, as the split view showed them before it was bound (on a 13-inch
    /// iPad in portrait too; a bound `.automatic` collapsed the sidebar there).
    var sidebarVisibility: NavigationSplitViewVisibility = .all
    /// "Show Calendars" asks for focus on the first hidden calendar's toggle (§2.4 States); that
    /// row takes it once it is on screen (`CalendarVisibilityRow`) and clears the request.
    var calendarsFocusRequest: UUID?
    /// The window is at compact width (iPhone, iPad in Slide Over or a narrow split; set by the
    /// iOS root view). The Mac is always regular.
    var isCompactWidth = false
    /// The window's undo manager (set by the window root from `@Environment(\.undoManager)`), for
    /// changes made from menus and other places without a view environment.
    @ObservationIgnored weak var undoManager: UndoManager?
    /// A deep link has navigated this window, so the restored Calendar mode and day of the window
    /// root must not override it.
    @ObservationIgnored private(set) var openedLink = false

    @ObservationIgnored private let logger = Logger(subsystem: "com.haugas.thirteen", category: "events")

    /// A window's model on the shared `state`, starting on Today.
    init(state: AppState) {
        self.state = state
        let now = state.today
        calendarDate = now
        compareYear = now.year
        convertDay = now
        if let mode = QAOptions.calendarMode {
            // Screenshot QA: start in Calendar, in that mode.
            calendarMode = mode
            section = .calendar
        }
        state.register(self)
    }

    /// A model with its own ``AppState`` (the Mac's single main window, tests).
    convenience init(defaults: UserDefaults = .standard, today: (@MainActor () -> GregorianDate)? = nil, events: EventsModel? = nil) {
        self.init(state: AppState(defaults: defaults, today: today, events: events))
    }

    // MARK: Derived values

    /// Today in the selected 13-month system.
    var todayThirteen: ThirteenDate { ThirteenDate(today, system: system) }

    /// The full comparison for today.
    var todayComparison: Comparison { Comparison(today, system: system) }

    /// The menu-bar style label for today: `"Oct 12"`, `"Des 12"`, `"Year Day"`.
    var todayShortLabel: String { todayThirteen.formatted(.short) }

    /// The Calendar day as the window stores it (§2.1): its ISO date, or empty while it is today,
    /// so a window restored on a later day follows today.
    var storedCalendarDate: String { calendarDate == today ? "" : calendarDate.isoString }

    /// The Calendar day a window restores from ``storedCalendarDate`` (`nil`: today).
    static func restoredCalendarDate(_ stored: String) -> GregorianDate? {
        stored.isEmpty ? nil : try? GregorianDate(isoString: stored)
    }

    /// Whether Calendar's page shows today (its "Today" button is hidden then, §2.1).
    func calendarShowsToday(mode: CalendarMode? = nil) -> Bool {
        CalendarPeriod.shows(today, mode: mode ?? calendarMode, on: calendarDate, system: system)
    }

    /// The unit ⌘← / ⌘→ step by on the current screen (Compare: years; Calendar: its mode's unit).
    var pagingUnit: PagingUnit? {
        switch section {
        case .compare: .year
        case .calendar: calendarMode.unit
        case .today, .convert, .history: calendarMode.unit ?? .month
        }
    }

    // MARK: Actions

    /// Re-reads today's date (for every window). Screens that were showing the old current year
    /// follow along.
    func refreshToday() {
        state.refreshToday()
    }

    /// Called by ``AppState`` when the day changes: screens that were showing today move on with
    /// it; a day or year the user picked stays.
    func todayDidChange(from previous: GregorianDate, to now: GregorianDate) {
        // Not under an editor popover: its anchor never leaves the screen by itself (§2.11).
        if calendarDate == previous && !(editor?.isInPopover ?? false) { calendarDate = now }
        if compareYear == previous.year { compareYear = now.year }
        if convertDay == previous { convertDay = now }
    }

    /// ⌘T: in Calendar, today in the current mode; elsewhere Today, with Calendar and Compare moved
    /// back to today.
    func goToToday() {
        guard leaveEditor(then: { [weak self] in self?.goToToday() }) else { return }
        refreshToday()
        noteNextAction()
        if section == .calendar {
            showTodayInCalendar()
            return
        }
        section = .today
        calendarDate = today
        compareYear = today.year
        convertDay = today
    }

    /// Calendar's "Today" (§2.1): today in the current mode. Year mode scrolls to today's month.
    func showTodayInCalendar() {
        guard leaveEditor(then: { [weak self] in self?.showTodayInCalendar() }) else { return }
        refreshToday()
        noteNextAction()
        calendarDate = today
        if calendarMode == .year { yearFocus = today }
    }

    /// Pages Calendar by its mode's unit (⌘← / ⌘→, "‹" and "›", the accessibility paging actions).
    func pageCalendar(by delta: Int) {
        // An editor popover asks first (§2.11, task A7), so its anchor never leaves the screen.
        guard leaveEditor(then: { [weak self] in self?.pageCalendar(by: delta) }) else { return }
        noteNextAction()
        calendarDate = CalendarPeriod.step(calendarDate, mode: calendarMode, by: delta, system: system)
    }

    /// ⌘← / ⌘→: Compare steps its year, Calendar pages by its mode's unit; from other screens it opens
    /// Calendar and pages there.
    func step(by delta: Int) {
        guard leaveEditor(then: { [weak self] in self?.step(by: delta) }) else { return }
        switch section {
        case .compare:
            compareYear = Self.clampYear(compareYear + delta)
        case .calendar:
            if calendarMode == .list { calendarMode = .month }
            pageCalendar(by: delta)
        case .today, .convert, .history:
            section = .calendar
            if calendarMode == .list { calendarMode = .month }
            pageCalendar(by: delta)
        }
    }

    /// Switches Calendar's mode (the segmented control, ⌃⌘1 to ⌃⌘5, the View menu), opening Calendar.
    func showCalendar(mode: CalendarMode) {
        guard leaveEditor(then: { [weak self] in self?.showCalendar(mode: mode) }) else { return }
        section = .calendar
        calendarMode = mode
    }

    /// Opens the comparison sheet for a day.
    func showDetail(_ date: GregorianDate) {
        detail = DaySelection(date: date)
    }

    /// Opens Calendar's Year mode on `date`'s year, scrolled to its month, optionally with its
    /// comparison sheet ("Show in Year").
    func showInYear(_ date: GregorianDate, detail showsDetail: Bool = true) {
        section = .calendar
        calendarMode = .year
        calendarDate = date
        yearFocus = date
        if showsDetail { detail = DaySelection(date: date) }
    }

    /// The Year screen's Today button: the current year, scrolled to today's month.
    func showTodayInYear() {
        refreshToday()
        showInYear(today, detail: false)
    }

    /// Handles a `thirteen://` URL. Returns `false` if the URL is not a Thirteen deep link.
    @discardableResult
    func handle(url: URL) -> Bool {
        guard let link = DeepLink(url: url) else { return false }
        open(link)
        return true
    }

    /// Navigates to a deep link's destination.
    func open(_ link: DeepLink) {
        // An open editor with changes asks first; the link follows "Discard Changes" (§2.11).
        guard leaveEditor(popoverOnly: false, then: { [weak self] in self?.open(link) }) else { return }
        openedLink = true
        if let system = link.system { self.system = system }
        detail = nil
        showsSettings = false
        switch link.destination {
        case .today:
            refreshToday()
            section = .today
        case .calendar:
            section = .calendar
        case let .year(year, day):
            showCalendar(mode: .year)
            if let day { calendarDate = day }
            if let year { self.year = year }
            if let day {
                detail = DaySelection(date: day)
                if day.year == self.year { yearFocus = day }
            }
        case let .month(year, month):
            showCalendar(mode: .month)
            let year = year ?? calendarDate.year
            let month = month ?? CalendarPeriod.month(of: calendarDate, system: system).month
            if let first = CalendarPeriod.firstDay(of: .init(year: year, month: month), system: system) { calendarDate = first }
        case let .week(date):
            showCalendar(mode: .week)
            if let date { calendarDate = date }
        case let .day(date):
            showCalendar(mode: .day)
            if let date { calendarDate = date }
        case let .newEvent(date):
            showCalendar(mode: calendarMode == .list || calendarMode == .year ? .month : calendarMode)
            if let date { calendarDate = date }
            Task { await newEvent(on: date ?? calendarDate) }
        case let .convert(date, direction):
            section = .convert
            if let date { convertDay = date }
            if let direction { convertDirection = direction }
        case let .compare(year):
            section = .compare
            if let year { compareYear = year }
        case .history:
            section = .history
        }
    }

    // MARK: Events

    /// A next action (§2.11): closes a toast that stays, writing its pending change.
    func noteNextAction() {
        events.undo.nextAction()
    }

    /// "+", ⌘N, "New event", `thirteen://new-event` (§2.16 "+" column): asks for access first when
    /// it is undecided, shows the state's alert when events cannot be added, else opens the editor
    /// for a new event on `day` (timed: the next whole hour today, else 09:00, §2.11), in write-only
    /// mode with write-only access.
    func newEvent(on day: GregorianDate? = nil, allDay: Bool = false, anchor: EventEditorState.Anchor = .none) async {
        guard leaveEditor(popoverOnly: false, then: { [weak self] in Task { await self?.newEvent(on: day, allDay: allDay, anchor: anchor) } })
        else { return }
        noteNextAction()
        let day = day ?? (section == .calendar ? calendarDate : today)
        // A deep link at a cold launch can arrive before the window has read access: read it first,
        // so an earlier refusal shows its alert instead of passing for a refusal at the prompt.
        await events.start()
        var route = CalendarAccess.newEventRoute(
            showsEvents: events.showsEvents, authorization: events.authorization, calendars: events.calendars)
        if route == .requestAccess {
            await events.requestAccess()
            route = CalendarAccess.newEventRoute(
                showsEvents: events.showsEvents, authorization: events.authorization, calendars: events.calendars)
            // Denied at the prompt: the user just answered, so no alert follows.
            if case .alert(.accessDenied) = route { return }
        }
        switch route {
        case let .editor(writeOnly):
            let calendarID = events.defaultCalendar?.id ?? ""
            guard let draft = try? EventDraft(newOn: day, now: events.now(), calendarID: calendarID, allDay: allDay, timeZone: events.deviceZone)
            else { return }
            editor = EventEditorState(mode: .new, source: nil, draft: draft, writeOnly: writeOnly, anchor: anchor)
        case let .alert(alert):
            eventsAlert = alert
        case .requestAccess, .unavailable:
            break
        }
    }

    /// Opens an event's details (a chip, block or row; "Show Event" of a failure toast).
    /// `anchorDay`: the day the iPad and Mac popover points at when the event has no chip, block or
    /// row on screen (a row of "+N more").
    func openEvent(key: String, anchorDay: GregorianDate? = nil) {
        guard leaveEditor(popoverOnly: false, then: { [weak self] in self?.openEvent(key: key, anchorDay: anchorDay) }) else { return }
        noteNextAction()
        selectedEventKey = key
        presentedEvent = EventPresentation(key: key, anchorDay: anchorDay)
    }

    /// ⌘E and "Edit": opens the editor on the occurrence. A read-only event changes nothing and
    /// announces its reason (§2.20); one that is gone shows `editor.occurrenceGone`.
    func editEvent(key: String, anchor: EventEditorState.Anchor = .none) async {
        guard leaveEditor(popoverOnly: false, then: { [weak self] in Task { await self?.editEvent(key: key, anchor: anchor) } })
        else { return }
        noteNextAction()
        guard let snapshot = await fetch(key) else { return }
        if let reason = snapshot.occurrence.readOnly {
            events.undo.announce(EventFormat.readOnlyReason(reason))
            return
        }
        // Details stay open under the editor (pushed on iPhone; the popover shows the editor in
        // their place on iPad and Mac, §2.11), so they show the saved event afterwards.
        editor = EventEditorState(editing: snapshot, anchor: anchor)
    }

    /// "Duplicate" (§2.10): an unsaved copy in the same calendar if it is writable, else the
    /// default calendar; nothing is stored until Add.
    func duplicateEvent(key: String) async {
        guard leaveEditor(popoverOnly: false, then: { [weak self] in Task { await self?.duplicateEvent(key: key) } }) else { return }
        noteNextAction()
        guard let snapshot = await fetch(key) else { return }
        var draft = snapshot.event.draft
        // The event's fields without its repeat, invitees or identifiers (§2.10).
        draft.recurrence = nil
        if !(events.calendar(id: draft.calendarID)?.info.writable ?? false) {
            draft.calendarID = events.defaultCalendar?.id ?? draft.calendarID
        }
        editor = EventEditorState(mode: .duplicate, source: snapshot, draft: draft, anchor: .event(key: key))
    }

    /// "Edit alerts" of an invitation (§3.5): the editor reduced to the alerts.
    func editAlerts(key: String) async {
        guard leaveEditor(popoverOnly: false, then: { [weak self] in Task { await self?.editAlerts(key: key) } }) else { return }
        noteNextAction()
        guard let snapshot = await fetch(key), snapshot.event.alarmsEditable else { return }
        editor = EventEditorState(mode: .alertsOnly, source: snapshot, draft: snapshot.event.draft, anchor: .event(key: key))
    }

    /// Closes the editor without saving (after the discard question when it is dirty).
    func closeEditor() {
        editor = nil
    }

    /// ⌫, "Delete" (menus, the context menu): every delete asks first (§2.11): ``deleteRequest`` is
    /// set for "Delete This Event?" (a repeating occurrence: the span question; invitees: their
    /// line), and the answer (`confirmDelete`) holds the delete with Undo. A read-only event changes
    /// nothing and announces its reason.
    func requestDelete(key: String, undoManager: UndoManager?) async {
        guard let snapshot = await fetch(key) else { return }
        if let reason = snapshot.occurrence.readOnly {
            events.undo.announce(EventFormat.readOnlyReason(reason))
            return
        }
        deleteRequest = DeleteRequest(snapshot: snapshot)
    }

    /// The answer to a delete question: "this event only" is held (pending, undoable), "all future
    /// events" is written at once without Undo (§2.11 table).
    func confirmDelete(_ request: DeleteRequest, span: EditSpan, undoManager: UndoManager?) {
        deleteRequest = nil
        presentedEvent = nil
        if selectedEventKey == request.snapshot.key { selectedEventKey = nil }
        moveAccessibilityFocus(to: focusAfterDelete(request.snapshot.occurrence))
        if span == .thisEvent {
            events.undo.holdDelete(request.snapshot, undoManager: undoManager)
            return
        }
        Task {
            do throws(CalendarStoreError) {
                try await events.remove(key: request.snapshot.key, span: span)
                events.undo.showWritten("Event deleted.")
            } catch {
                logger.error("Delete failed: \(String(describing: error), privacy: .public)")
                events.undo.showWritten(Self.saveFailedMessage(error))
            }
        }
    }

    /// Asks the view marked with `anchor` to take assistive focus (§2.20 Focus after actions).
    func moveAccessibilityFocus(to anchor: EventPopoverAnchor) {
        accessibilityFocusRequest = AccessibilityFocusRequest(anchor: anchor)
    }

    /// Where focus goes after a delete (§2.20): in List the next row (the agenda's next event within
    /// 60 days), elsewhere the deleted occurrence's day cell.
    func focusAfterDelete(_ occurrence: OccurrenceSnapshot) -> EventPopoverAnchor {
        let day = occurrence.start.date
        guard section == .calendar, calendarMode == .list, let last = try? day.adding(days: 60) else { return .day(day) }
        let nearby = events.occurrences(from: day, through: last)
        let agenda = (try? AgendaDay.days(occurrences: nearby.map(\.occurrence), from: day, to: last, system: system)) ?? []
        let keys = agenda.flatMap { $0.items.map(\.key) }
        if let index = keys.firstIndex(of: occurrence.key), let next = keys[(index + 1)...].first(where: { $0 != occurrence.key }) {
            return .event(next)
        }
        return .day(day)
    }

    /// Saves the open editor with `span` (`.thisEvent` for single events and new ones): the store
    /// write, then the toast and Undo of §2.11 (Undo only where it is exact). Returns the store's
    /// error for the editor to show (`editor.saveFailed.*`, `occurrenceGone`, validation issues); on
    /// success the editor closes and the saved event is selected.
    /// `draft` and `target` replace the editor's own (the span's draft, a copy to another account).
    @discardableResult
    func saveEditor(span: EditSpan = .thisEvent, draft override: EventDraft? = nil, target: SaveTarget? = nil, undoManager: UndoManager?)
        async -> CalendarStoreError?
    {
        guard let editor else { return nil }
        editor.isSaving = true
        defer { editor.isSaving = false }
        var draft = override ?? editor.draft
        if draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { draft.title = "New event" }
        do {
            let result: SaveResult
            if editor.mode == .alertsOnly, let key = editor.key {
                try await events.saveAlarms(key: key, alarms: draft.alarms, span: span == .allEvents ? .futureEvents : span)
                result = SaveResult(key: key, written: [.alarms], conflicts: [], countCorrected: false)
            } else {
                result = try await events.save(draft: draft, span: span, target: target ?? editor.target)
            }
            self.editor = nil
            if let key = result.key {
                selectedEventKey = key
                moveAccessibilityFocus(to: .event(key))
            }
            if editor.isNew {
                if editor.writeOnly { events.undo.showWritten("Event added to your default calendar.") }
            } else if case .copyToCalendar? = target {
                // A copy into another account and a delete (`move.confirm`): a new identifier, so the
                // reversal is not exact and there is no Undo (§2.11 table).
                events.undo.showWritten("Event saved.")
            } else if let source = editor.source {
                events.undo.recordSave(before: source, saved: draft, span: span, result: result, undoManager: undoManager)
            }
            return nil
        } catch {
            if case .occurrenceGone = error {
                self.editor = nil
                eventsAlert = .occurrenceGone
            } else if case let .invalidDraft(issues) = error {
                editor.issues = issues
            }
            return error
        }
    }

    /// The store changed: an open editor reads its event again; if it was deleted elsewhere the
    /// editor closes with `editor.deletedElsewhere` (§6.2 Changes). The merge banner is the editor's.
    func eventsDidChange() {
        guard let editor, let key = editor.key else { return }
        Task {
            let current = try? await events.store.refreshEvent(key: key)
            if current == nil, self.editor === editor {
                self.editor = nil
                eventsAlert = .deletedElsewhere
            } else if self.editor === editor {
                noteEditorCurrent(current)
            }
        }
    }

    /// ⌘R: refreshes the calendars (`refreshSourcesIfNecessary`, §2.21).
    func refreshCalendars() {
        Task { await events.refresh() }
    }

    /// View > Show Calendars (⌥⌘K, §2.21): opens Calendar; at regular width it shows the Calendars
    /// list in the sidebar (or hides it when Calendar already shows it), at compact width (no
    /// sidebar) it opens the Calendars sheet.
    func toggleCalendarsList() {
        let wasCalendar = section == .calendar
        if !wasCalendar { section = .calendar }
        if isCompactWidth {
            showsCalendarsSheet = true
        } else if wasCalendar && showsCalendars && !sidebarCollapsed {
            showsCalendars = false
        } else {
            showsCalendars = true
            // A collapsed sidebar is shown first, so the list is on screen.
            if sidebarCollapsed { sidebarVisibility = .all }
        }
    }

    /// The user collapsed the sidebar (the split view's toggle, or ⌃⌘S on the Mac).
    var sidebarCollapsed: Bool { sidebarVisibility == .detailOnly }

    /// The selected event is on screen (Event > Edit ⌘E and Delete ⌫ act on it only then, §2.21):
    /// its details are open, or Calendar's current page shows it (Month: the month and its bands;
    /// Week: the week; Day: the day; List: any loaded event). Year shows marks, not events. After
    /// paging, Today or a mode switch away from it, ⌫ deletes nothing.
    var selectedEventIsOnScreen: Bool {
        guard let key = selectedEventKey else { return false }
        if presentedEvent?.key == key { return true }
        guard section == .calendar else { return false }
        let days: [GregorianDate]
        switch calendarMode.resolved(compact: isCompactWidth) {
        case .year: return false
        case .list: return events.occurrence(key: key) != nil
        case .month: days = CalendarPeriod.monthPageDays(of: CalendarPeriod.month(of: calendarDate, system: system), system: system)
        case .week: days = CalendarPeriod.days(of: CalendarPeriod.week(of: calendarDate, system: system), system: system)
        case .day: days = [calendarDate]
        }
        guard let first = days.first, let last = days.last else { return false }
        return events.occurrences(from: first, through: last).contains { $0.key == key }
    }

    /// The title of the Show Calendars menu item for this window.
    var calendarsListCommandTitle: String {
        !isCompactWidth && section == .calendar && showsCalendars && !sidebarCollapsed ? "Hide Calendars" : "Show Calendars"
    }

    private func fetch(_ key: String) async -> EventSnapshot? {
        do {
            if let snapshot = try await events.event(key: key) { return snapshot }
        } catch {
            logger.error("Couldn't open an event: \(String(describing: error), privacy: .public)")
        }
        eventsAlert = .occurrenceGone
        return nil
    }

    /// "Couldn't save the event" with its reason line (§2.19 `editor.saveFailed.*`).
    static func saveFailedMessage(_ error: CalendarStoreError) -> String {
        switch EventUndo.cause(of: error) {
        case let .final(reason?): "Couldn’t save the event. \(reason.text)"
        default: "Couldn’t save the event. Please try again."
        }
    }

    // MARK: Clock

    /// Starts the shared clock that keeps ``today`` current (idempotent).
    func startClock() {
        state.startClock()
    }

    // MARK: Helpers

    static func clampYear(_ year: Int) -> Int {
        min(max(year, GregorianDate.minYear), GregorianDate.maxYear)
    }
}
