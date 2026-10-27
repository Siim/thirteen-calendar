import Foundation
import Testing
import ThirteenKit

/// Shared setup for the events model and undo tests: the mockup data set in its zone, a fresh
/// `UserDefaults` suite per test, and a store wrapper that counts calls and fails on demand.
@MainActor
enum EventsTest {
    nonisolated static let zone = "Europe/Tallinn"
    /// The mockup's "now": IFC Thursday, October 12, 2026 at 09:41.
    nonisolated static let now = local("2026-10-19T09:41")

    nonisolated static func local(_ iso: String) -> LocalDateTime { try! LocalDateTime(iso: iso) }
    nonisolated static func day(_ iso: String) -> GregorianDate { try! GregorianDate(isoString: iso) }

    static func freshDefaults() -> UserDefaults {
        let name = "ThirteenEventsTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    static func mockup() throws -> FakeCalendarStore.Mockup {
        try FakeCalendarStore.loadMockup(from: try TestResources.url("mockup-events"))
    }

    static func fake(_ scenario: FakeCalendarStore.Scenario = .fullAccess, grants: Bool = true, mockup: FakeCalendarStore.Mockup? = nil) throws
        -> FakeCalendarStore
    {
        FakeCalendarStore(scenario: scenario, mockup: try mockup ?? Self.mockup(), deviceZone: zone, grantsOnRequest: grants)
    }

    /// An events model on `store`, its undo with manual timers, a recorded announcer and the
    /// mockup's clock.
    static func model(
        store: any CalendarStore, defaults: UserDefaults = freshDefaults(), source: EventsModel.Source = .fake(.fullAccess),
        assistive: EventUndo.Assistive = EventUndo.Assistive(isMac: true, hardwareKeyboard: true)
    ) -> (EventsModel, Announcements) {
        let model = EventsModel(store: store, source: source, deviceZone: zone, defaults: defaults, now: { now })
        let announcements = Announcements()
        model.undo.automaticTimers = false
        model.undo.assistive = { assistive }
        model.undo.announce = { announcements.texts.append($0) }
        model.undo.clock = { EventInstants.instant(now, zone: zone)! }
        return (model, announcements)
    }

    /// The instant of a Tallinn wall clock.
    nonisolated static func instant(_ iso: String) -> Date { EventInstants.instant(local(iso), zone: zone)! }

    /// An undo manager that groups explicitly (no run loop in tests).
    static func undoManager() -> UndoManager {
        let manager = UndoManager()
        manager.groupsByEvent = false
        return manager
    }
}

extension EventUndo.Assistive {
    init(isMac: Bool, hardwareKeyboard: Bool, voiceOver: Bool = false, switchControl: Bool = false, assistiveTouch: Bool = false) {
        self.init()
        self.isMac = isMac
        self.hardwareKeyboard = hardwareKeyboard
        self.voiceOver = voiceOver
        self.switchControl = switchControl
        self.assistiveTouch = assistiveTouch
    }
}

/// What the undo announced (the polite announcements of §2.11).
@MainActor
final class Announcements {
    var texts: [String] = []
}

/// A store that forwards to another one, counts calls, and can fail the next saves or removes.
actor RecordingStore: CalendarStore {
    let base: any CalendarStore
    nonisolated let changes: AsyncStream<Void>
    /// With `ownChanges`, the test sends the store's changes itself (``sendChange()``).
    private nonisolated let changeContinuation: AsyncStream<Void>.Continuation?
    private(set) var occurrenceCalls = 0
    private(set) var saveCalls = 0
    private(set) var removeCalls = 0
    /// Errors for the next writes (saves and removes), in order.
    private var failures: [CalendarStoreError] = []

    /// - Parameter ownChanges: the changes stream is the test's (``sendChange()``, buffered like
    ///   the real stores' streams: the newest one) instead of the base store's.
    init(_ base: any CalendarStore, ownChanges: Bool = false) {
        self.base = base
        if ownChanges {
            let (stream, continuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
            changes = stream
            changeContinuation = continuation
        } else {
            changes = base.changes
            changeContinuation = nil
        }
    }

    /// One store change, sent at once without suspending (only with `ownChanges`).
    nonisolated func sendChange() { changeContinuation?.yield() }

    func failNextWrites(_ errors: [CalendarStoreError]) { failures = errors }

    private func nextFailure() -> CalendarStoreError? {
        failures.isEmpty ? nil : failures.removeFirst()
    }

    func authorizationStatus() async -> CalendarAuthorization { await base.authorizationStatus() }
    func requestAccess() async -> CalendarAuthorization { await base.requestAccess() }
    func setPreferredSystem(_ system: CalendarSystemID) async { await base.setPreferredSystem(system) }
    func calendars() async throws(CalendarStoreError) -> [CalendarSnapshot] { try await base.calendars() }

    func occurrences(in interval: DateInterval, calendars: Set<String>) async throws(CalendarStoreError) -> [OccurrenceSnapshot] {
        occurrenceCalls += 1
        return try await base.occurrences(in: interval, calendars: calendars)
    }

    func event(key: String) async throws(CalendarStoreError) -> EventSnapshot? { try await base.event(key: key) }
    func refreshEvent(key: String) async throws(CalendarStoreError) -> EventSnapshot? { try await base.refreshEvent(key: key) }
    func hasChangedOccurrences(after key: String) async throws(CalendarStoreError) -> Bool {
        try await base.hasChangedOccurrences(after: key)
    }

    func save(draft: EventDraft, span: EditSpan, target: SaveTarget) async throws(CalendarStoreError) -> SaveResult {
        saveCalls += 1
        if let failure = nextFailure() { throw failure }
        return try await base.save(draft: draft, span: span, target: target)
    }

    func saveAlarms(key: String, alarms: [Alarm], span: EditSpan) async throws(CalendarStoreError) {
        try await base.saveAlarms(key: key, alarms: alarms, span: span)
    }

    func remove(key: String, span: EditSpan) async throws(CalendarStoreError) {
        removeCalls += 1
        if let failure = nextFailure() { throw failure }
        try await base.remove(key: key, span: span)
    }

    func refreshSources() async { await base.refreshSources() }
    func reset() async { await base.reset() }
}

extension SaveFailure {
    static let generic = SaveFailure(reason: .generic, code: "EKErrorDomain 1", transient: true)
    static let readOnly = SaveFailure(reason: .readOnly, code: "EKErrorDomain 11", transient: false)
}
