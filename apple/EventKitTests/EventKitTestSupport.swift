import EventKit
import Foundation
import Testing
import ThirteenKit

@testable import Thirteen

// Support for the EventKit tests (docs/EVENTS.md §6.2): unit tests hosted in the iOS app, run only
// in an iOS Simulator whose calendar access was granted with
// `xcrun simctl privacy <udid> grant calendar com.haugas.thirteen` (apple/scripts/eventkit-tests.sh).
// Every test works in a calendar it creates in the simulator's local source and deletes it again.

final class EventKitTestBundleToken {}

enum EventKitTestSupport {
    /// The zone the tests read all-day dates in: the simulator's own.
    static var zone: String { EventInstants.deviceZone }

    /// Fails the test unless the simulator granted full calendar access (never asks: a prompt would
    /// block the run).
    static func requireAccess() throws {
        let status = EKEventStore.authorizationStatus(for: .event)
        try #require(
            status == .fullAccess,
            "Calendar access is \(status.rawValue), not full access. Run apple/scripts/eventkit-tests.sh, which grants it with simctl.")
    }

    /// A new calendar in the local source ("On My iPhone").
    static func makeCalendar(_ store: EKEventStore, title: String) throws -> EKCalendar {
        let calendar = EKCalendar(for: .event, eventStore: store)
        calendar.title = title
        // A new store can list no sources yet on a busy machine (`EventKitStore.createLocalCalendar`
        // waits the same way): refresh and look again for up to 5 s.
        var found: EKSource?
        for attempt in 0..<20 {
            found = store.sources.first { $0.sourceType == .local } ?? store.defaultCalendarForNewEvents?.source
            if found != nil { break }
            store.refreshSourcesIfNecessary()
            if attempt < 19 { Thread.sleep(forTimeInterval: 0.25) }
        }
        let source = try #require(found, "no local calendar source")
        calendar.source = source
        try store.saveCalendar(calendar, commit: true)
        return calendar
    }

    static func writeContext(_ store: EKEventStore) -> EventKitMapping.WriteContext {
        EventKitMapping.WriteContext(deviceZone: zone) { store.calendar(withIdentifier: $0) }
    }

    /// The events of `calendar` overlapping `[from, to)`, read in pieces of at most four years.
    static func events(_ store: EKEventStore, in calendar: EKCalendar, from: Date, to: Date) -> [EKEvent] {
        EventKitStore.chunks(DateInterval(start: from, end: to)).flatMap { chunk in
            store.events(matching: store.predicateForEvents(withStart: chunk.start, end: chunk.end, calendars: [calendar]))
        }
    }

    /// One section of fixtures/events.json (a test bundle resource, referenced in place).
    static func eventsSection(_ name: String) throws -> [[String: Any]] {
        let url = try #require(Bundle(for: EventKitTestBundleToken.self).url(forResource: "events", withExtension: "json"))
        let root = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        return try #require(root[name] as? [[String: Any]])
    }

    static func decode<T: Decodable>(_ type: T.Type, from value: Any) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]))
    }

    static func day(_ iso: String) -> GregorianDate { try! GregorianDate(isoString: iso) }
    static func local(_ iso: String) -> LocalDateTime { try! LocalDateTime(iso: iso) }

    /// The first instant of a Gregorian year in the simulator's zone.
    static func yearStart(_ year: Int) -> Date {
        EventInstants.startOfDay(try! GregorianDate(year: year, month: 1, day: 1), zone: zone)!
    }

    /// A line for docs/events-verification/apple.md, printed to the test log with a marker the
    /// script collects.
    static func record(_ text: String) {
        print("EVENTKIT-RECORD \(text)")
    }
}
