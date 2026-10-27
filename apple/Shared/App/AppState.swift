import Foundation
import Observation
import ThirteenKit

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// App-wide state shared by every window: the selected calendar system and the Year-grid overlay
/// preference (both persisted), today's date, kept current across midnight, time-zone and clock
/// changes, and the events (``EventsModel``: access, calendars, cached occurrences, undo). Each
/// window's navigation lives in its own ``AppModel``.
@MainActor
@Observable
final class AppState {
    /// `UserDefaults` keys (the same keys `@AppStorage` would use).
    enum Keys {
        static let system = "selectedSystem"
        static let gregorianOverlay = "showsGregorianOverlay"
        /// QA / screenshot override, e.g. launch argument `-ThirteenFixedToday 2026-10-19`.
        static let fixedToday = "ThirteenFixedToday"
    }

    /// The 13-month system every screen of every window shows. Persisted.
    var system: CalendarSystemID {
        didSet {
            guard system != oldValue else { return }
            defaults.set(system.rawValue, forKey: Keys.system)
        }
    }

    /// Whether the Year grids show the Gregorian date in every cell. Persisted.
    var showsGregorianOverlay: Bool {
        didSet {
            guard showsGregorianOverlay != oldValue else { return }
            defaults.set(showsGregorianOverlay, forKey: Keys.gregorianOverlay)
        }
    }

    /// Today's local date (Gregorian); updated at midnight and on significant time changes.
    private(set) var today: GregorianDate

    /// The events of every window (docs/EVENTS.md §6.2): EventKit, or the fake store with the
    /// mockup data for `-ThirteenQAEvents fake`.
    let events: EventsModel

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let todayProvider: @MainActor () -> GregorianDate
    @ObservationIgnored private var clockTask: Task<Void, Never>?
    @ObservationIgnored private var observers: [any NSObjectProtocol] = []
    /// The windows' models, told when the day changes so screens on the current year follow it.
    @ObservationIgnored private var windows: [WeakWindow] = []

    private struct WeakWindow {
        weak var model: AppModel?
    }

    /// - Parameters:
    ///   - defaults: Where the system choice and overlay preference persist.
    ///   - today: Supplies today's date; defaults to the local wall-clock date, or the
    ///     `ThirteenFixedToday` default (ISO date) when set.
    ///   - events: The events model; `nil` makes the standard one for the launch arguments
    ///     (``makeEvents(defaults:)``). Nothing asks the store anything before `events.start()`.
    init(defaults: UserDefaults = .standard, today: (@MainActor () -> GregorianDate)? = nil, events: EventsModel? = nil) {
        self.defaults = defaults
        let provider = today ?? { Self.localToday(defaults: defaults) }
        todayProvider = provider
        self.today = provider()
        system = defaults.string(forKey: Keys.system).flatMap(CalendarSystemID.init(rawValue:)) ?? .default
        showsGregorianOverlay = defaults.object(forKey: Keys.gregorianOverlay) as? Bool ?? true
        self.events = events ?? Self.makeEvents(defaults: defaults)
        self.events.system = { [weak self] in self?.system ?? .default }
        self.events.onChange = { [weak self] in self?.eventsDidChange() }
        if today != nil || defaults.string(forKey: Keys.fixedToday) != nil {
            // A fixed today (tests, `-ThirteenFixedToday`): the events clock keeps that day, at the
            // real time of day (the mockup data set's 09:41 with the fake store).
            let zone = self.events.deviceZone
            let fakeMinute = Self.isFakeSource(self.events.source) ? Self.mockupNow?.minute : nil
            self.events.now = { [weak self] in
                let clock = EventsModel.wallClock(Date(), zone: zone)
                let day = self?.today ?? clock.date
                return (try? LocalDateTime(date: day, minute: fakeMinute ?? clock.minute)) ?? clock
            }
        }
    }

    /// The events model for this launch: `-ThirteenQAEvents fake` (with `-ThirteenQAAccess`) gives
    /// `FakeCalendarStore` with the bundled mockup data in the data set's zone (Europe/Tallinn), so
    /// screenshots match design/events/mockups.html; otherwise EventKit (`EventKitStore`, whose
    /// `EKEventStore` is made only when first needed). `-ThirteenQAShowEvents off|on` sets "Show my
    /// events" for the launch.
    static func makeEvents(defaults: UserDefaults) -> EventsModel {
        let source = QAOptions.eventsSource
        let model: EventsModel
        switch source {
        case let .fake(scenario):
            let mockup = FakeCalendarStore.mockupURL().flatMap { try? FakeCalendarStore.loadMockup(from: $0) }?
                .addingGeneratedEvents(QAOptions.generatedEventCount)
            let zone = mockup?.deviceZone ?? EventInstants.deviceZone
            let store = FakeCalendarStore(scenario: scenario, mockup: mockup, deviceZone: zone)
            model = EventsModel(store: store, source: source, deviceZone: zone, defaults: defaults, showsEvents: QAOptions.showsEventsOverride)
        case .eventKit, .seed:
            model = EventsModel(store: EventKitStore(), source: source, defaults: defaults, showsEvents: QAOptions.showsEventsOverride)
        }
        return model
    }

    private static func isFakeSource(_ source: EventsModel.Source) -> Bool {
        if case .fake = source { return true }
        return false
    }

    /// The mockup data set's "now" (2026-10-19T09:41).
    private static var mockupNow: LocalDateTime? {
        FakeCalendarStore.mockupURL().flatMap { try? FakeCalendarStore.loadMockup(from: $0) }?.now
    }

    /// Tells every window that the calendar store changed (an open editor refreshes its event).
    private func eventsDidChange() {
        windows.removeAll { $0.model == nil }
        for window in windows {
            window.model?.eventsDidChange()
        }
    }

    /// Registers a window's model for ``AppModel/todayDidChange(from:to:)``. Held weakly.
    func register(_ model: AppModel) {
        windows.removeAll { $0.model == nil }
        windows.append(WeakWindow(model: model))
    }

    /// Re-reads today's date and tells every window, so screens showing the old current year
    /// follow along.
    func refreshToday() {
        let now = todayProvider()
        guard now != today else { return }
        let previous = today
        today = now
        windows.removeAll { $0.model == nil }
        for window in windows {
            window.model?.todayDidChange(from: previous, to: now)
        }
    }

    // MARK: Clock

    /// Keeps ``today`` current: a timer for the next local midnight plus the system's day-change,
    /// time-zone, clock and wake notifications. Idempotent.
    func startClock() {
        guard clockTask == nil else { return }
        clockTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.secondsUntilNextLocalDay()))
                guard let self else { return }
                self.refreshToday()
            }
        }

        var names: [Notification.Name] = [.NSCalendarDayChanged, .NSSystemTimeZoneDidChange, .NSSystemClockDidChange]
        #if canImport(UIKit)
        names.append(UIApplication.significantTimeChangeNotification)
        #endif
        for name in names {
            observers.append(
                NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated { self?.refreshToday() }
                })
        }
        #if canImport(AppKit) && !canImport(UIKit)
        observers.append(
            NSWorkspace.shared.notificationCenter.addObserver(
                forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.refreshToday() }
            })
        #endif
    }

    // MARK: Helpers

    private static func localToday(defaults: UserDefaults) -> GregorianDate {
        if let text = defaults.string(forKey: Keys.fixedToday), let fixed = try? GregorianDate(isoString: text) {
            return fixed
        }
        return GregorianDate.today()
    }

    /// Seconds until the next local day begins (re-checked at least every 6 hours).
    private static func secondsUntilNextLocalDay() -> Double {
        let today = GregorianDate.today()
        // A zone may skip a whole day (Pacific/Apia 2011-12-30): then the day after is next.
        let next = [1, 2].lazy.compactMap { (try? today.adding(days: $0))?.date(in: .current) }.first
        let interval = (next?.timeIntervalSinceNow ?? 3600) + 0.5
        return min(max(interval, 1), 6 * 3600)
    }
}
