import Foundation
import Observation
import OSLog
import ThirteenKit

// EventsModel: the app-wide events state (docs/EVENTS.md §6.2, task A4), owned by `AppState` and
// reached from any view as `model.events` (`model` is the window's `AppModel`).
//
// Seams for the screen tasks (A5 to A9). Every screen reads from here and writes through here;
// none talks to a `CalendarStore` itself, and none makes its own `EventsModel` or `EventUndo`.
// Previews and UI tests get the mockup data with `-ThirteenQAEvents fake` (QAOptions.swift), or
// `EventsModel(store: FakeCalendarStore(...), source: .fake(.fullAccess), ...)` in code.
//
// Reading (all synchronous, for `body`; load first in `.task(id:)`):
//   - `canShowEvents`: "Show my events" is on and access is full. When false, show no events, no
//     dots and no "+" (§2.16); `accessCard` says which card to show instead (A9).
//   - `await events.load(years:)` / `load(from:through:)` fetch whole Gregorian years once (in-flight
//     requests are shared); `loadState(year:)` is `.failed` for `calendar.loadFailed`.
//   - `occurrences(from:through:)` (inclusive days), `occurrences(on:)`: deduplicated by key across
//     cached years (§3.2), sorted by the §5.3 order key, with pending moves and deletes applied
//     (moved items appear at their new time, deleted ones are gone). `occurrence(key:)` finds one.
//     Pass `.map(\.occurrence)` to the ThirteenKit layouts (§5.3).
//   - `yearMarks(year:)` (Year dots, A5; empty when `showsEventsInYear` is off), `agenda(from:through:system:)`
//     (List, Up next, the day sheet).
//   - `calendars`, `visibleCalendarIDs`, `isVisible(_:)`, `accountGroups`, `isCollapsed(_:)`,
//     `defaultCalendar`, `writableCalendars`, `calendar(id:)` (Calendars list and picker, A7 and A9).
//   - `event(key:)` fetches the full `EventSnapshot` for details and the editor (A7).
//   - `now()` is the device wall clock (the Week and Day now line, Up next); `deviceZone` its zone.
//
// Writing:
//   - Editor saves go through the window's `AppModel` (`requestSave` and the `answer…` methods of
//     EventEditorFlow.swift end in `saveEditor(span:draft:target:undoManager:)`), which calls
//     `save(draft:span:target:)` or `saveAlarms(key:alarms:span:)` and then `undo.recordSave(...)`
//     (or `undo.showWritten(...)`). They are written at once (§2.11), after any pending change to
//     the same event.
//   - Drags and deletes of one occurrence: `movedDraft(_:toDeviceStart:)` + `movedOccurrence(_:to:)`, then
//     `undo.holdMove(...)` / `undo.holdDelete(...)` (held until §2.11 writes them). "Future events"
//     moves and deletes are written at once: `save(...)` / `remove(key:span:)` + `undo.showWritten(...)`.
//   - Calendars list: `setVisible(_:calendarID:)`, `setVisible(_:account:)` (Show all, Hide all),
//     `setCollapsed(_:account:)`; Settings: `showsEvents`, `showsEventsInYear`, `setDefaultCalendar(id:)`.
//   - Access: `requestAccess()` ("Continue", and "+" when access is undecided); the access card's
//     launch counter: `noteAccessCardShown()` and `accessCardCollapsed` (Up next, A9).
//
// Opening things (entry points in `AppModel`, per window; each is a "next action" of §2.11):
//   - New event: `await newEvent(on:allDay:anchor:)` ("+", ⌘N, "New Event", touch and hold, the
//     `new-event` deep link). It runs the "+" column of §2.16 (asks for access when undecided, or
//     sets `eventsAlert` instead of opening the editor) and sets `editor`.
//   - Details: `openEvent(key:)` sets `presentedEvent` and `selectedEventKey`.
//   - Editor: `await editEvent(key:anchor:)` (⌘E, "Edit"), `await duplicateEvent(key:)`,
//     `await editAlerts(key:)` (invitations), each setting `editor` (an `EventEditorState`);
//     `requestCloseEditor()` (asks before discarding) and `closeEditor()`.
//   - Delete: `await requestDelete(key:undoManager:)` (⌫, "Delete") always asks first: it
//     sets `deleteRequest` ("Delete This Event?", the span or invitee question); the dialog answers with
//     `confirmDelete(_:span:undoManager:)`.
//   - Drag and drop: `EventMoveFlow` (Shared/Events/EventMoveFlow.swift), one per Calendar screen,
//     `await flow.drop(key:at:copy:)`.
//   - Where they show: the window root presents `presentedEvent` and `editor` (sheet, popover or
//     pushed, EventPresentation.swift); a view becomes a popover anchor with
//     `.eventPopoverAnchor(.event(key))`, `.day(date)` or `.draft`.
//   Window state: `editor`, `presentedEvent`, `deleteRequest`, `eventsAlert`, `selectedEventKey`,
//   `showsCalendars` (the sidebar list) and `toggleCalendarsList()` (⌥⌘K), `showCalendarsList()`
//   ("Show Calendars" of the all-hidden line: the sheet at compact width, the sidebar at regular;
//   added by A8/A9 in Shared/Events/CalendarAccessCopy.swift), `showsCalendarsSheet` (compact),
//   `isCompactWidth`, `undoManager` (the window's, for changes made outside a view).
//   Calendar navigation: `calendarMode`, `calendarDate`, `pageCalendar(by:)`, `showTodayInCalendar()`,
//   `calendarShowsToday(mode:)`, `showCalendar(mode:)`, and `CalendarPeriod` (months, weeks, paging,
//   titles) in Shared/App/CalendarMode.swift. Deep links: `DeepLink` and `AppModel.open(_:)`.
//
// Undo and the toast: `events.undo` (`EventUndo`, the §2.11 table, pending changes, commit failures);
// the toast is `EventToastView`, shown by the window root. Every "next action" of §2.11 goes
// through `model.noteNextAction()` (the `AppModel` methods above already call it; a screen calls it
// itself only for a next action of its own, such as its "‹" and "›" when they bypass
// `pageCalendar(by:)`).
//
// Screen files, by the three screen tasks that build on this model in parallel:
//   1. Calendar modes and timelines (A5, A6): Features/Calendar/ CalendarView.swift (modes,
//      toolbars, paging, the compact drill-down), YearModeView.swift, MonthModeView.swift,
//      MonthDayListView.swift, ListModeView.swift, WeekModeView.swift, DayModeView.swift,
//      EventTimelineView.swift, EventChipView.swift, EventMoveDialog.swift; logic in
//      Shared/Events/CalendarScreens.swift and EventMoveFlow.swift.
//   2. Details and editor (A7): Features/Events/ EventPresentation.swift (sheets and popovers),
//      EventDetailView.swift, EventEditorView.swift, ThirteenDateField.swift,
//      RecurrencePickerView.swift, AlertPickerView.swift, CalendarPickerView.swift,
//      SpanDialogs.swift; logic in Shared/Events/ EventEditorState.swift, EventEditorFlow.swift,
//      EventEditorCopy.swift, RepeatPickerLogic.swift, ThirteenDatePickerLogic.swift,
//      CalendarPickerGroups.swift, EventPresentationState.swift.
//   3. Today, day sheet, menu bar, Calendars, Settings, access (A8, A9): Features/Today/
//      UpNextCard.swift, UpNextRows.swift, Features/Detail/DayEventsSection.swift,
//      macOS/MenuBarNextLine.swift, Features/Events/ CalendarsListView.swift (with the sidebar
//      section), AccessCardView.swift (with `CalendarAccessBanner`), EventSettingsSection.swift,
//      EventsAlerts.swift; logic in Shared/Events/ UpNextAgenda.swift, CalendarAccess.swift,
//      CalendarAccessCopy.swift.
//   This task (A4): this file, EventUndo.swift, Features/Events/EventToastView.swift (the toast and
//   "Changes that couldn't be saved"), Shared/App/* (AppState, AppModel, AppSection, CalendarMode,
//   DeepLink, ThirteenCommands, ThirteenApp), the root views and QAOptions.swift. A screen task that
//   needs a new model or AppModel entry point adds it with a small, targeted edit and lists it here.

/// The app-wide events state: access, "Show my events", the calendars and their visibility, a cache
/// of occurrences per Gregorian year, the pending changes the views show before they are written,
/// and change handling (§6.2 `EventsModel`).
@MainActor
@Observable
final class EventsModel {
    /// `UserDefaults` keys (per device, §2.15, §2.18).
    enum Keys {
        /// "Show my events" (default on, §2.16).
        static let showsEvents = "showMyEvents"
        /// "Show events in Year view" (default on, §2.18).
        static let showsEventsInYear = "showEventsInYear"
        /// The visible calendars, as JSON `CalendarReference`s (§3.2).
        static let visibleCalendars = "visibleCalendars"
        /// Every calendar the visibility setting knew about when it was saved; a calendar added since
        /// is shown.
        static let knownCalendars = "knownCalendars"
        /// The collapsed account groups of the Calendars list (account ids).
        static let collapsedGroups = "collapsedCalendarGroups"
        /// The default calendar for new events, a JSON `CalendarReference`.
        static let defaultCalendar = "defaultCalendar"
        /// Launches with the access card shown on Today and no decision (§2.16 card persistence).
        static let accessCardLaunches = "accessCardLaunches"
    }

    /// Where events come from.
    enum Source: Sendable, Hashable {
        /// EventKit (`EventKitStore`), the default on every device.
        case eventKit
        /// `FakeCalendarStore` with the mockup data set (`-ThirteenQAEvents fake`, tests, previews).
        case fake(FakeCalendarStore.Scenario)
        /// EventKit, filled once with the mockup data in a local calendar "Thirteen QA"
        /// (`-ThirteenQAEvents seed`, Debug builds).
        case seed
    }

    enum LoadState: Sendable, Hashable {
        case notLoaded, loading, loaded
        /// `calendar.loadFailed` ("Couldn't load events." with "Try again").
        case failed(String)
    }

    /// A move or delete that views show before it is written (§2.11). Owned by ``EventUndo``.
    struct PendingChange: Sendable, Hashable {
        enum Kind: Sendable, Hashable {
            /// The occurrence as the views show it after the move.
            case move(OccurrenceSnapshot)
            case delete
        }

        let entryID: UUID
        /// The occurrence's key as stored.
        let key: String
        let kind: Kind
    }

    /// The calendars of one account, in the list's order (§2.15).
    struct AccountGroup: Identifiable, Hashable {
        let id: String
        let title: String
        let kind: CalendarAccountKind
        let calendars: [CalendarSnapshot]
    }

    // MARK: Configuration

    let source: Source
    /// The device's zone: occurrences are in its wall clock.
    let deviceZone: String
    @ObservationIgnored let store: any CalendarStore
    /// Undo, pending changes and the toast.
    let undo: EventUndo
    /// The device wall clock (minute precision).
    @ObservationIgnored var now: @MainActor () -> LocalDateTime
    /// The selected 13-month system (repeat recognition prefers it, §4.5; toast dates use it).
    @ObservationIgnored var system: @MainActor () -> CalendarSystemID = { .ifc }
    /// Called after every store change (`AppState` tells each window, so an open editor can refresh).
    @ObservationIgnored var onChange: (@MainActor () -> Void)?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let logger = Logger(subsystem: "com.haugas.thirteen", category: "events")

    // MARK: State

    /// Calendar access; `.notDetermined` until ``start()`` has read it.
    private(set) var authorization: CalendarAuthorization = .notDetermined
    /// Access has been read at least once (so a card never flashes at launch).
    private(set) var hasReadAuthorization = false
    /// "Show my events" (Settings > Calendar, default on). Off: no events, no cards, no "+", and
    /// Thirteen never asks for access (§2.16).
    var showsEvents: Bool {
        didSet {
            guard showsEvents != oldValue else { return }
            defaults.set(showsEvents, forKey: Keys.showsEvents)
            Task { await showsEventsChanged() }
        }
    }
    /// "Show events in Year view" (default on).
    var showsEventsInYear: Bool {
        didSet {
            guard showsEventsInYear != oldValue else { return }
            defaults.set(showsEventsInYear, forKey: Keys.showsEventsInYear)
        }
    }
    /// The calendars, in the store's order (empty without full access).
    private(set) var calendars: [CalendarSnapshot] = []
    /// The calendars shown (hidden ones are not fetched, §2.15).
    private(set) var visibleCalendarIDs: Set<String> = []
    /// Collapsed account groups (account ids).
    private(set) var collapsedGroups: Set<String> = []
    /// Bumped after every store change and cache reload (views may key tasks on it).
    private(set) var changeCount = 0
    /// Pending moves and deletes by occurrence key.
    private(set) var pending: [String: PendingChange] = [:]
    private var years: [Int: YearEntry] = [:]

    @ObservationIgnored private var started = false
    @ObservationIgnored private var startTask: Task<Void, Never>?
    @ObservationIgnored private var changeTask: Task<Void, Never>?
    /// Bumped whenever ``pending`` changes, so the Year dots cache never mistakes one pending
    /// change for another with the same count.
    @ObservationIgnored private var pendingRevision = 0
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var useCounter = 0
    @ObservationIgnored private var marksCache: [Int: (stamp: Int, marks: [YearMark])] = [:]
    @ObservationIgnored private var accessCardLaunchesAtStart = 0
    @ObservationIgnored private var countedAccessCardThisLaunch = false
    /// The most Gregorian years kept in memory.
    static let cachedYearLimit = 8

    private struct YearEntry {
        var state: LoadState
        var occurrences: [OccurrenceSnapshot] = []
        var generation: Int
        var lastUse: Int
        var task: Task<Void, Never>?
    }

    /// - Parameters:
    ///   - store: the calendar store; nothing is asked of it before ``start()``.
    ///   - deviceZone: the zone occurrences are shown in (the fake store's, for QA runs).
    ///   - now: the device wall clock; defaults to the real one in `deviceZone`.
    ///   - showsEvents: "Show my events" for this launch only (`-ThirteenQAShowEvents`), not stored.
    init(
        store: any CalendarStore, source: Source, deviceZone: String = EventInstants.deviceZone, defaults: UserDefaults = .standard,
        now: (@MainActor () -> LocalDateTime)? = nil, showsEvents override: Bool? = nil
    ) {
        self.store = store
        self.source = source
        self.deviceZone = deviceZone
        self.defaults = defaults
        let zone = deviceZone
        self.now = now ?? { EventsModel.wallClock(Date(), zone: zone) }
        showsEvents = override ?? defaults.object(forKey: Keys.showsEvents) as? Bool ?? true
        showsEventsInYear = defaults.object(forKey: Keys.showsEventsInYear) as? Bool ?? true
        collapsedGroups = Set((defaults.array(forKey: Keys.collapsedGroups) as? [String]) ?? [])
        undo = EventUndo(defaults: defaults)
        undo.events = self
    }

    /// The wall clock of an instant in a zone (the device clock; 1970 if the zone is unknown).
    static func wallClock(_ date: Date, zone: String) -> LocalDateTime {
        EventInstants.wallClock(date, zone: zone) ?? EventInstants.utc(date) ?? (try! LocalDateTime(iso: "1970-01-01T00:00"))
    }

    // MARK: Derived

    /// Events can be shown: "Show my events" is on and access is full.
    var canShowEvents: Bool { showsEvents && authorization == .fullAccess }

    /// The access card of §2.16 for Month, Week, Day, List and Up next (`nil` before access is read).
    var accessCard: CalendarAccess.Card? {
        guard hasReadAuthorization else { return nil }
        return CalendarAccess.card(showsEvents: showsEvents, authorization: authorization, calendars: calendars)
    }

    /// The calendars that can take new events.
    var writableCalendars: [CalendarSnapshot] { calendars.filter { $0.info.writable } }

    func calendar(id: String) -> CalendarSnapshot? { calendars.first { $0.id == id } }

    func isVisible(_ calendarID: String) -> Bool { visibleCalendarIDs.contains(calendarID) }

    func isCollapsed(_ accountID: String) -> Bool { collapsedGroups.contains(accountID) }

    /// The calendars grouped by account, in the platform's order (§2.15): iCloud, Google, Exchange,
    /// CalDAV, on this device, subscribed, other; each group's calendars by title.
    var accountGroups: [AccountGroup] {
        func rank(_ kind: CalendarAccountKind) -> Int {
            switch kind {
            case .icloud: 0
            case .google: 1
            case .exchange: 2
            case .caldav: 3
            case .device: 4
            case .subscribed: 5
            case .birthdays, .other: 6
            }
        }
        var groups: [String: [CalendarSnapshot]] = [:]
        var order: [String] = []
        for calendar in calendars {
            if groups[calendar.info.accountID] == nil { order.append(calendar.info.accountID) }
            groups[calendar.info.accountID, default: []].append(calendar)
        }
        return order.compactMap { id -> AccountGroup? in
            guard let members = groups[id], let first = members.first else { return nil }
            return AccountGroup(id: id, title: first.info.accountTitle, kind: first.info.accountKind, calendars: members)
        }
        .sorted { (rank($0.kind), $0.title) < (rank($1.kind), $1.title) }
    }

    /// The calendar new events go to: the one chosen in Settings while it exists and is writable,
    /// else the platform default, else the first writable calendar (§2.15).
    var defaultCalendar: CalendarSnapshot? {
        let writable = writableCalendars
        if let reference = Self.decode(CalendarReference.self, defaults.data(forKey: Keys.defaultCalendar)),
            let info = reference.resolve(in: writable.map(\.info)), let chosen = writable.first(where: { $0.id == info.id })
        {
            return chosen
        }
        return writable.first { $0.info.isPlatformDefault } ?? writable.first
    }

    /// Whether the Today card has been seen 3 launches without a decision, so it shows as the
    /// one-line link "See your events here" (§2.16 card persistence).
    var accessCardCollapsed: Bool { accessCardLaunchesAtStart >= 3 && authorization == .notDetermined }

    // MARK: Lifecycle

    /// Reads access, the calendars and the visible years, and starts listening for changes.
    /// Idempotent; the window root calls it. A caller that arrives while the first start is still
    /// running waits for it, so it sees access as read (a `thirteen://new-event` link at a cold
    /// launch must not mistake "not read yet" for "not asked"). Nothing touches the store while
    /// "Show my events" is off.
    func start() async {
        if let startTask {
            await startTask.value
            return
        }
        started = true
        accessCardLaunchesAtStart = defaults.integer(forKey: Keys.accessCardLaunches)
        listenForChanges()
        let task = Task { await refreshAuthorization() }
        startTask = task
        await task.value
    }

    /// A window became active: access is read again, sources are refreshed, and failures nobody saw
    /// are shown (§2.11, §6.2).
    func sceneBecameActive() async {
        undo.isForeground = true
        guard started else { return }
        await refreshAuthorization()
        if canShowEvents { await store.refreshSources() }
        undo.presentFailuresNobodySaw()
    }

    /// The app left the foreground: pending changes are written now (§2.11).
    func sceneLeftForeground(background: Bool) async {
        if background { undo.isForeground = false }
        await undo.commitAll(foreground: !background)
    }

    /// ⌘R and pull to refresh: `refreshSourcesIfNecessary()`, then the cached years again.
    func refresh() async {
        guard canShowEvents else { return }
        await store.refreshSources()
        await reloadCalendars()
        await reloadLoadedYears()
    }

    /// "Continue" on the not-asked card, or "+" while access is undecided: the system prompt.
    @discardableResult
    func requestAccess() async -> CalendarAuthorization {
        guard showsEvents else { return authorization }
        let status = await store.requestAccess()
        await apply(status)
        return status
    }

    private func refreshAuthorization() async {
        guard showsEvents else { return }
        await store.setPreferredSystem(system())
        await apply(await store.authorizationStatus())
    }

    private func apply(_ status: CalendarAuthorization) async {
        let previous = authorization
        let first = !hasReadAuthorization
        authorization = status
        hasReadAuthorization = true
        if !first && previous != status {
            logger.info("Calendar access changed to \(status.rawValue, privacy: .public)")
            if status == .fullAccess { await store.reset() }
            await undo.accessChanged()
        }
        if status == .fullAccess {
            #if DEBUG
            if source == .seed, await seedOnce() > 0 {
                await reloadCalendars()
                await reloadLoadedYears()
                return
            }
            #endif
            await reloadCalendars()
            if !first && previous == status { return }
            await reloadLoadedYears()
        } else {
            calendars = []
            visibleCalendarIDs = []
            dropCaches()
        }
    }

    #if DEBUG
    @ObservationIgnored private var seedTask: Task<Int, Never>?

    /// `-ThirteenQAEvents seed`: one seed per launch even when launch and activation both read access.
    private func seedOnce() async -> Int {
        if let seedTask { _ = await seedTask.value; return 0 }
        let store = self.store
        let defaults = self.defaults
        let task = Task { await QASeed.runIfNeeded(store: store, defaults: defaults) }
        seedTask = task
        return await task.value
    }
    #endif

    private func showsEventsChanged() async {
        if showsEvents {
            await refreshAuthorization()
        } else {
            await undo.commitAll(foreground: true)
            calendars = []
            visibleCalendarIDs = []
            dropCaches()
        }
    }

    private func listenForChanges() {
        let changes = store.changes
        changeTask = Task { [weak self] in
            for await _ in changes {
                await self?.storeDidChange()
            }
        }
    }

    /// One coalesced store change: access and calendars are read again, the cached years refetched,
    /// pending changes whose event changed are written, and the windows are told (§6.2 Changes).
    func storeDidChange() async {
        guard showsEvents else { return }
        let status = await store.authorizationStatus()
        if status != authorization {
            await apply(status)
        } else if status == .fullAccess {
            await reloadCalendars()
            await reloadLoadedYears()
        }
        await undo.eventsDidChange()
        onChange?()
    }

    // MARK: Calendars

    private func reloadCalendars() async {
        do {
            calendars = try await store.calendars()
        } catch {
            logger.error("Couldn't read calendars: \(String(describing: error), privacy: .public)")
            calendars = []
        }
        resolveVisibility()
    }

    private func resolveVisibility() {
        let infos = calendars.map(\.info)
        guard let known = Self.decode([CalendarReference].self, defaults.data(forKey: Keys.knownCalendars)) else {
            visibleCalendarIDs = Set(calendars.map(\.id))
            return
        }
        let visible = Self.decode([CalendarReference].self, defaults.data(forKey: Keys.visibleCalendars)) ?? []
        let knownIDs = Set(known.compactMap { $0.resolve(in: infos)?.id })
        let visibleIDs = Set(visible.compactMap { $0.resolve(in: infos)?.id })
        visibleCalendarIDs = Set(calendars.map(\.id).filter { visibleIDs.contains($0) || !knownIDs.contains($0) })
    }

    private func saveVisibility() {
        defaults.set(Self.encode(calendars.filter { visibleCalendarIDs.contains($0.id) }.map(\.reference)), forKey: Keys.visibleCalendars)
        defaults.set(Self.encode(calendars.map(\.reference)), forKey: Keys.knownCalendars)
    }

    /// Shows or hides one calendar in Thirteen (never in Calendar.app, §2.15).
    func setVisible(_ visible: Bool, calendarID: String) {
        var ids = visibleCalendarIDs
        if visible { ids.insert(calendarID) } else { ids.remove(calendarID) }
        guard ids != visibleCalendarIDs else { return }
        visibleCalendarIDs = ids
        saveVisibility()
        Task { await reloadLoadedYears() }
    }

    /// "Show all" and "Hide all" of an account group.
    func setVisible(_ visible: Bool, account accountID: String) {
        let members = calendars.filter { $0.info.accountID == accountID }.map(\.id)
        var ids = visibleCalendarIDs
        if visible { ids.formUnion(members) } else { ids.subtract(members) }
        guard ids != visibleCalendarIDs else { return }
        visibleCalendarIDs = ids
        saveVisibility()
        Task { await reloadLoadedYears() }
    }

    func setCollapsed(_ collapsed: Bool, account accountID: String) {
        if collapsed { collapsedGroups.insert(accountID) } else { collapsedGroups.remove(accountID) }
        defaults.set(collapsedGroups.sorted(), forKey: Keys.collapsedGroups)
    }

    /// Settings > Default calendar.
    func setDefaultCalendar(id: String) {
        guard let calendar = calendar(id: id), calendar.info.writable else { return }
        defaults.set(Self.encode(calendar.reference), forKey: Keys.defaultCalendar)
        changeCount += 1
    }

    // MARK: Access card counter

    /// The Today access card was shown at this launch (counted once per launch while access is
    /// undecided).
    func noteAccessCardShown() {
        guard !countedAccessCardThisLaunch, authorization == .notDetermined, showsEvents else { return }
        countedAccessCardThisLaunch = true
        defaults.set(defaults.integer(forKey: Keys.accessCardLaunches) + 1, forKey: Keys.accessCardLaunches)
    }

    // MARK: Year caches

    /// Local January 1 of `year` to the next January 1 in the device zone (for 9999, the end is the
    /// instant of 9999-12-31T24:00, §6.2 Fetching).
    func interval(year: Int) -> DateInterval? {
        guard let first = try? GregorianDate(year: year, month: 1, day: 1),
            let startLocal = try? LocalDateTime(date: first, minute: 0),
            let start = EventInstants.instant(startLocal, zone: deviceZone)
        else { return nil }
        let endLocal: LocalDateTime?
        if year < GregorianDate.maxYear, let next = try? GregorianDate(year: year + 1, month: 1, day: 1) {
            endLocal = try? LocalDateTime(date: next, minute: 0)
        } else if let last = try? GregorianDate(year: year, month: 12, day: 31) {
            endLocal = try? LocalDateTime(date: last, minute: 1440)
        } else {
            endLocal = nil
        }
        guard let endLocal, let end = EventInstants.instant(endLocal, zone: deviceZone) ?? Optional(start.addingTimeInterval(366 * 86_400)),
            end > start
        else { return nil }
        return DateInterval(start: start, end: end)
    }

    /// Fetches Gregorian years into the cache (a year already cached or loading is not fetched again).
    func load(years range: ClosedRange<Int>) async {
        guard canShowEvents else { return }
        let valid = range.clamped(to: GregorianDate.supportedYears)
        guard !valid.isEmpty else { return }
        var tasks: [Task<Void, Never>] = []
        for year in valid {
            if let task = loadTask(year) { tasks.append(task) }
        }
        for task in tasks { await task.value }
        await settle(Array(valid))
        evict(keeping: valid)
    }

    /// Waits until none of `years` is loading (a change during a fetch starts a newer one, which
    /// this then waits for), so a caller sees the store's current state when it returns.
    private func settle(_ years: [Int]) async {
        for year in years {
            while let entry = self.years[year], entry.state == .loading, let task = entry.task {
                await task.value
            }
        }
    }

    /// Fetches the years that the days `from` to `through` touch.
    func load(from: GregorianDate, through: GregorianDate) async {
        await load(years: min(from.year, through.year)...max(from.year, through.year))
    }

    private func loadTask(_ year: Int) -> Task<Void, Never>? {
        useCounter += 1
        if var entry = years[year] {
            entry.lastUse = useCounter
            years[year] = entry
            switch entry.state {
            case .loaded: return nil
            case .loading: return entry.task
            case .notLoaded, .failed: break
            }
        }
        return fetch(year, keeping: years[year]?.occurrences ?? [])
    }

    private func fetch(_ year: Int, keeping occurrences: [OccurrenceSnapshot]) -> Task<Void, Never> {
        let stamp = generation
        let ids = visibleCalendarIDs
        let interval = interval(year: year)
        let store = self.store
        let task = Task { [weak self] in
            guard let interval else {
                self?.finish(year, stamp: stamp, result: .failure(.engine("No interval for year \(year)")))
                return
            }
            do throws(CalendarStoreError) {
                let result = try await store.occurrences(in: interval, calendars: ids)
                self?.finish(year, stamp: stamp, result: .success(result))
            } catch {
                self?.finish(year, stamp: stamp, result: .failure(error))
            }
        }
        years[year] = YearEntry(state: .loading, occurrences: occurrences, generation: stamp, lastUse: useCounter, task: task)
        return task
    }

    private func finish(_ year: Int, stamp: Int, result: Result<[OccurrenceSnapshot], CalendarStoreError>) {
        guard var entry = years[year], entry.generation == stamp else { return }
        switch result {
        case let .success(occurrences):
            entry.occurrences = occurrences
            entry.state = .loaded
        case let .failure(error):
            logger.error("Couldn't load \(year, privacy: .public): \(String(describing: error), privacy: .public)")
            entry.state = .failed(String(describing: error))
        }
        entry.task = nil
        years[year] = entry
        changeCount += 1
    }

    /// Refetches every cached year (after a change, a visibility change or a write) and waits for it.
    /// The old occurrences stay on screen until the new ones arrive.
    func reloadLoadedYears() async {
        generation += 1
        guard canShowEvents else {
            dropCaches()
            return
        }
        let cached = years.keys.sorted()
        var tasks: [Task<Void, Never>] = []
        for year in cached {
            tasks.append(fetch(year, keeping: years[year]?.occurrences ?? []))
        }
        for task in tasks { await task.value }
        await settle(cached)
        changeCount += 1
    }

    private func dropCaches() {
        generation += 1
        for entry in years.values { entry.task?.cancel() }
        years = [:]
        marksCache = [:]
        changeCount += 1
    }

    private func evict(keeping range: ClosedRange<Int>) {
        guard years.count > Self.cachedYearLimit else { return }
        let removable = years.filter { !range.contains($0.key) && $0.value.state != .loading }.sorted { $0.value.lastUse < $1.value.lastUse }
        for (year, _) in removable.prefix(years.count - Self.cachedYearLimit) {
            years[year] = nil
            marksCache[year] = nil
        }
    }

    /// The load state of a Gregorian year.
    func loadState(year: Int) -> LoadState { years[year]?.state ?? .notLoaded }

    /// The Gregorian years in the cache.
    var cachedYears: [Int] { years.keys.sorted() }

    // MARK: Reading

    /// Every occurrence touching the days `from` to `through` (inclusive, device wall clock), from
    /// the cached years, deduplicated by key (§3.2), with pending changes applied, in order-key order.
    func occurrences(from: GregorianDate, through: GregorianDate) -> [OccurrenceSnapshot] {
        guard canShowEvents, from <= through,
            let lower = try? LocalDateTime(date: from, minute: 0), let upper = try? LocalDateTime(date: through, minute: 1440)
        else { return [] }
        func touches(_ o: OccurrenceSnapshot) -> Bool {
            o.start < upper && (o.end > lower || (o.end == o.start && o.start >= lower))
        }
        var seen = Set<String>()
        var out: [OccurrenceSnapshot] = []
        for year in years.keys.sorted() where year >= from.year && year <= through.year {
            for occurrence in years[year]?.occurrences ?? [] where seen.insert(occurrence.key).inserted {
                // A pending move is added below at its new time; a pending delete is gone.
                if pending[occurrence.key] == nil && touches(occurrence) { out.append(occurrence) }
            }
        }
        for change in pending.values {
            if case let .move(moved) = change.kind, touches(moved), !out.contains(where: { $0.key == moved.key }) { out.append(moved) }
        }
        return OccurrenceOrder.sorted(out)
    }

    /// The occurrences of one day.
    func occurrences(on day: GregorianDate) -> [OccurrenceSnapshot] { occurrences(from: day, through: day) }

    /// The occurrences touching a Gregorian year.
    func occurrences(inYear year: Int) -> [OccurrenceSnapshot] {
        guard let first = try? GregorianDate(year: year, month: 1, day: 1), let last = try? GregorianDate(year: year, month: 12, day: 31)
        else { return [] }
        return occurrences(from: first, through: last)
    }

    /// One occurrence from the cache (with a pending move applied; `nil` when pending deletion).
    func occurrence(key: String) -> OccurrenceSnapshot? {
        switch pending[key]?.kind {
        case let .move(moved)?: return moved
        case .delete?: return nil
        case nil: break
        }
        for entry in years.values {
            if let found = entry.occurrences.first(where: { $0.key == key }) { return found }
        }
        return nil
    }

    /// Year dots (§2.3): the marks of a Gregorian year, or none while "Show events in Year view" is off.
    func yearMarks(year: Int) -> [YearMark] {
        guard canShowEvents, showsEventsInYear else { return [] }
        let stamp = changeCount &* 1_000_003 &+ pendingRevision
        if let cached = marksCache[year], cached.stamp == stamp { return cached.marks }
        let marks = (try? YearMark.marks(year: year, occurrences: occurrences(inYear: year).map(\.occurrence))) ?? []
        marksCache[year] = (stamp, marks)
        return marks
    }

    /// The agenda of §5.3 for List, Up next and the day sheet (days with items only, unless
    /// `includeEmptyDays`).
    func agenda(from: GregorianDate, through: GregorianDate, system: CalendarSystemID, includeEmptyDays: Bool = false) -> [AgendaDay] {
        let items = occurrences(from: from, through: through).map(\.occurrence)
        return (try? AgendaDay.days(occurrences: items, from: from, to: through, system: system, includeEmptyDays: includeEmptyDays)) ?? []
    }

    /// The full event for details and the editor (fetched again, never from the cache).
    func event(key: String) async throws(CalendarStoreError) -> EventSnapshot? {
        try await store.event(key: key)
    }

    // MARK: Writing

    /// An editor save (written at once, §2.11), after any pending change to the same event.
    func save(draft: EventDraft, span: EditSpan, target: SaveTarget) async throws(CalendarStoreError) -> SaveResult {
        var target = target
        switch target {
        case let .existing(key, original):
            target = .existing(key: await undo.commitPending(touching: key), original: original)
        case let .copyToCalendar(key, original):
            target = .copyToCalendar(key: await undo.commitPending(touching: key), original: original)
        case .new:
            break
        }
        let result = try await store.save(draft: draft, span: span, target: target)
        await reloadLoadedYears()
        return result
    }

    /// "Edit alerts" of an invitation (§3.5).
    func saveAlarms(key: String, alarms: [Alarm], span: EditSpan) async throws(CalendarStoreError) {
        let key = await undo.commitPending(touching: key)
        try await store.saveAlarms(key: key, alarms: alarms, span: span)
        await reloadLoadedYears()
    }

    /// A delete written at once ("Delete all future events"); single deletes are held with
    /// `undo.holdDelete`.
    func remove(key: String, span: EditSpan) async throws(CalendarStoreError) {
        let key = await undo.commitPending(touching: key)
        try await store.remove(key: key, span: span)
        await reloadLoadedYears()
    }

    /// The fetched event with its time group moved so it starts at `start` (device wall clock),
    /// keeping its length: all-day events by whole days (the start's date counts), timed events in
    /// their own zone (floating ones in the device's).
    func movedDraft(_ snapshot: EventSnapshot, toDeviceStart start: LocalDateTime) -> EventDraft? {
        var draft = snapshot.event.draft
        if draft.allDay {
            guard let newStart = try? LocalDateTime(date: start.date, minute: 0),
                let end = try? newStart.adding(minutes: draft.end.minutesSince(draft.start)),
                let normalized = try? LocalDateTime.normalizedEnd(start: newStart, end: end)
            else { return nil }
            draft.start = newStart
            draft.end = normalized
            return draft
        }
        let zone = draft.timeZone ?? deviceZone
        guard let instant = EventInstants.instant(start, zone: deviceZone), let local = EventInstants.wallClock(instant, zone: zone),
            let end = try? local.adding(minutes: draft.end.minutesSince(draft.start)),
            let normalized = try? LocalDateTime.normalizedEnd(start: local, end: end)
        else { return nil }
        draft.start = local
        draft.end = normalized
        return draft
    }

    /// The occurrence as the views show it after a move to `start` (device wall clock).
    func movedOccurrence(_ occurrence: OccurrenceSnapshot, to start: LocalDateTime) -> OccurrenceSnapshot? {
        let length = occurrence.end.minutesSince(occurrence.start)
        let newStart = occurrence.allDay ? (try? LocalDateTime(date: start.date, minute: 0)) : start
        guard let newStart, let end = try? newStart.adding(minutes: length),
            let normalized = try? LocalDateTime.normalizedEnd(start: newStart, end: end)
        else { return nil }
        let startUtc = occurrence.allDay ? nil : EventInstants.instant(newStart, zone: deviceZone).flatMap { EventInstants.utc($0) }
        return OccurrenceSnapshot(
            key: occurrence.key, eventID: occurrence.eventID, calendarID: occurrence.calendarID, title: occurrence.title,
            location: occurrence.location, allDay: occurrence.allDay, start: newStart, end: normalized, startUtc: startUtc,
            occurrenceDate: occurrence.occurrenceDate, timeZone: occurrence.timeZone, isRepeating: occurrence.isRepeating,
            isDetached: occurrence.isDetached, availability: occurrence.availability, status: occurrence.status,
            readOnly: occurrence.readOnly, attendeeCount: occurrence.attendeeCount, organizedByCurrentUser: occurrence.organizedByCurrentUser,
            alarms: occurrence.alarms)
    }

    // MARK: Pending changes (EventUndo only)

    func setPending(_ change: PendingChange) {
        pending[change.key] = change
        pendingRevision &+= 1
    }

    func clearPending(entryID: UUID) {
        let kept = pending.filter { $0.value.entryID != entryID }
        guard kept.count != pending.count else { return }
        pending = kept
        pendingRevision &+= 1
    }

    // MARK: Helpers

    /// Two event ids of the same event or series (EventKit gives a changed occurrence its series id
    /// plus `/RID=` and a number).
    static func sameEvent(_ a: String, _ b: String) -> Bool {
        func series(_ id: String) -> String {
            guard let marker = id.range(of: "/RID=") else { return id }
            return String(id[..<marker.lowerBound])
        }
        return a == b || series(a) == series(b)
    }

    private static func decode<T: Decodable>(_ type: T.Type, _ data: Data?) -> T? {
        guard let data else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private static func encode<T: Encodable>(_ value: T) -> Data? {
        try? JSONEncoder().encode(value)
    }
}
