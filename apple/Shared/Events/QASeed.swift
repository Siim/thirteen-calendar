#if DEBUG
import Foundation
import OSLog
import ThirteenKit

/// `-ThirteenQAEvents seed` (Debug builds, docs/EVENTS.md §6.2 QA launch arguments): once full access
/// is granted, makes the local calendar "Thirteen QA" in EventKit and fills it with the mockup data
/// set's events, so a simulator shows the mockups' events through the real store. It runs once per
/// install (`UserDefaults` `ThirteenQASeeded`); delete the calendar in the Calendar app, or erase the
/// simulator, to start again. Meant for simulators granted with
/// `xcrun simctl privacy <udid> grant calendar com.haugas.thirteen`.
enum QASeed {
    static let calendarTitle = "Thirteen QA"
    static let seededKey = "ThirteenQASeeded"

    /// Seeds the store if it is EventKit with full access and has not been seeded. Returns the
    /// number of events saved (0 when nothing was done).
    @discardableResult
    static func runIfNeeded(store: any CalendarStore, defaults: UserDefaults) async -> Int {
        let logger = Logger(subsystem: "com.haugas.thirteen", category: "events")
        guard !defaults.bool(forKey: seededKey), let eventKit = store as? EventKitStore,
            await eventKit.authorizationStatus() == .fullAccess,
            let url = FakeCalendarStore.mockupURL(), let mockup = try? FakeCalendarStore.loadMockup(from: url)
        else { return 0 }
        do {
            let calendarID = try await eventKit.createLocalCalendar(title: calendarTitle)
            var saved = 0
            for event in mockup.events {
                var draft = event.draft
                draft.calendarID = calendarID
                do {
                    _ = try await eventKit.save(draft: draft, span: .thisEvent, target: .new)
                    saved += 1
                } catch {
                    logger.error("QA seed skipped an event: \(String(describing: error), privacy: .public)")
                }
            }
            defaults.set(true, forKey: seededKey)
            logger.info("QA seed saved \(saved, privacy: .public) of \(mockup.events.count, privacy: .public) events into \(calendarTitle, privacy: .public)")
            return saved
        } catch {
            logger.error("QA seed failed: \(String(describing: error), privacy: .public)")
            return 0
        }
    }
}
#endif
