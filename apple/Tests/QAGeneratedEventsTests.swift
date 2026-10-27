import Foundation
import Testing
import ThirteenKit

/// The generated load of the performance check (`-ThirteenQAGeneratedEvents 1000`, task A10): the
/// same events on every run, all in 2026, in the writable calendars, with the overflow cluster.
@Suite("Generated QA events")
struct QAGeneratedEventsTests {
    static let zone = "Europe/Tallinn"

    @Test func aThousandEventsInTheYear() throws {
        let events = QAGeneratedEvents.events(count: 1000)
        #expect(events.count == 1000)
        #expect(Set(events.map(\.id)).count == 1000, "unique ids")
        #expect(events.allSatisfy { $0.draft.start.date.year == 2026 })
        #expect(Set(events.map(\.draft.calendarID)) == Set(QAGeneratedEvents.calendarIDs))
        #expect(events.allSatisfy { $0.draft.end > $0.draft.start })
        let timed = events.filter { !$0.draft.allDay }.count
        #expect(timed > 650 && timed < 850, "about three in four are timed: \(timed)")
        #expect(QAGeneratedEvents.events(count: 1000) == events, "the same events every run")
    }

    @Test func theClusterOverflowsOneHour() throws {
        let events = QAGeneratedEvents.events(count: 1000)
        let cluster = events.prefix(QAGeneratedEvents.clusterSize)
        #expect(cluster.allSatisfy { $0.draft.start == (try? LocalDateTime(iso: "2026-10-20T14:00")) })
        #expect(cluster.map(\.draft.title).first == "Cluster 1")
    }

    @Test func theFakeStoreServesThem() async throws {
        let mockup = try FakeCalendarStore.loadMockup(from: try TestResources.url("mockup-events")).addingGeneratedEvents(1000)
        #expect(mockup.events.count == 1024)
        let store = FakeCalendarStore(scenario: .fullAccess, mockup: mockup, deviceZone: Self.zone)
        let start = try #require(EventInstants.instant(try LocalDateTime(iso: "2026-01-01T00:00"), zone: Self.zone))
        let end = try #require(EventInstants.instant(try LocalDateTime(iso: "2027-01-01T00:00"), zone: Self.zone))
        let occurrences = try await store.occurrences(
            in: DateInterval(start: start, end: end), calendars: ["home", "family", "work", "running-club", "holidays", "birthdays"])
        #expect(occurrences.filter { $0.key.contains("/load-") }.count == 1000)
    }
}
