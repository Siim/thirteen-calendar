import Foundation
import Testing
import ThirteenKit

private func local(_ iso: String) -> LocalDateTime { try! LocalDateTime(iso: iso) }

/// FakeCalendarStore on the mockup data set (docs/EVENTS.md §6.7): the same occurrences as the file,
/// the access scenarios of §2.16, and EventKit-like saves.
@Suite("Fake calendar store")
struct FakeCalendarStoreTests {
    static let zone = "Europe/Tallinn"

    static func mockup() throws -> FakeCalendarStore.Mockup {
        try FakeCalendarStore.loadMockup(from: try TestResources.url("mockup-events"))
    }

    static func store(_ scenario: FakeCalendarStore.Scenario = .fullAccess, grants: Bool = true) throws -> FakeCalendarStore {
        FakeCalendarStore(scenario: scenario, mockup: try mockup(), deviceZone: zone, grantsOnRequest: grants)
    }

    /// `[from, to)` of Tallinn wall clocks as instants.
    static func interval(_ from: String, _ to: String) throws -> DateInterval {
        let start = try #require(EventInstants.instant(local(from), zone: zone))
        let end = try #require(EventInstants.instant(local(to), zone: zone))
        return DateInterval(start: start, end: end)
    }

    static let allCalendars: Set<String> = ["home", "family", "work", "running-club", "holidays", "birthdays"]

    @Test func loadsTheMockupDataSet() throws {
        let mockup = try Self.mockup()
        #expect(mockup.calendars.map(\.id) == ["home", "family", "work", "running-club", "holidays", "birthdays"])
        #expect(mockup.events.count == 24)
        #expect(mockup.occurrences.count == 405)
        #expect(mockup.now == local("2026-10-19T09:41"))
        #expect(mockup.deviceZone == Self.zone)
    }

    @Test func theBundledFileIsTheFixture() throws {
        // The app bundles the same file the tests do (project.yml references fixtures/ in place).
        let url = try TestResources.url("mockup-events")
        #expect(url.lastPathComponent == "mockup-events.json")
    }

    /// The fake store expands every event with core's `expandSeries`: for the file's window in its
    /// zone it gives exactly the file's occurrences, in the file's order (the §5.3 order key).
    @Test func occurrencesMatchTheFile() async throws {
        let store = try Self.store()
        let occurrences = try await store.occurrences(
            in: try Self.interval("2026-01-01T00:00", "2028-01-01T00:00"), calendars: Self.allCalendars)
        let expected = try Self.mockup().occurrences
        #expect(occurrences.count == expected.count)
        #expect(occurrences.map(\.occurrence) == expected)
    }

    @Test func otherYearsExpandToo() async throws {
        let store = try Self.store()
        let occurrences = try await store.occurrences(in: try Self.interval("2030-01-01T00:00", "2031-01-01T00:00"), calendars: ["home"])
        // Rent (13 IFC months), Book club (13), Payday (12), Recycling pickup (26).
        #expect(occurrences.filter { $0.title == "Rent" }.count == 13)
        #expect(occurrences.filter { $0.title == "Book club: Cotsworth" }.count == 13)
        #expect(occurrences.filter { $0.title == "Payday" }.count == 12)
        #expect(occurrences.filter { $0.title == "Recycling pickup" }.count == 26)
        #expect(occurrences.allSatisfy { $0.calendarID == "home" })
    }

    @Test func hiddenCalendarsAreNotFetched() async throws {
        let store = try Self.store()
        let none = try await store.occurrences(in: try Self.interval("2026-10-01T00:00", "2026-11-01T00:00"), calendars: [])
        #expect(none.isEmpty)
        let work = try await store.occurrences(in: try Self.interval("2026-10-19T00:00", "2026-10-20T00:00"), calendars: ["work"])
        #expect(work.map(\.title) == ["Sprint planning", "1:1 with Marta"])
    }

    // MARK: Access (§2.16)

    @Test(arguments: FakeCalendarStore.Scenario.allCases)
    func scenarios(_ scenario: FakeCalendarStore.Scenario) async throws {
        let store = try Self.store(scenario)
        let status = await store.authorizationStatus()
        let calendars = try await store.calendars()
        let occurrences = try await store.occurrences(in: try Self.interval("2026-10-01T00:00", "2026-12-01T00:00"), calendars: Self.allCalendars)
        switch scenario {
        case .fullAccess:
            #expect(status == .fullAccess && calendars.count == 6 && !occurrences.isEmpty)
        case .empty:
            #expect(status == .fullAccess && calendars.isEmpty && occurrences.isEmpty)
        case .noWritable:
            #expect(status == .fullAccess && calendars.map(\.id) == ["holidays", "birthdays"])
            #expect(calendars.allSatisfy { !$0.info.writable })
            #expect(Set(occurrences.map(\.title)) == ["Halloween", "All Souls' Day", "Ilona's birthday"])
        case .notDetermined, .denied, .restricted, .writeOnly:
            #expect(status.rawValue == scenario.rawValue && calendars.isEmpty && occurrences.isEmpty)
        }
    }

    @Test func requestingAccessFollowsThePrompt() async throws {
        let granting = try Self.store(.notDetermined)
        #expect(await granting.requestAccess() == .fullAccess)
        #expect(try await granting.calendars().count == 6)
        let refusing = try Self.store(.notDetermined, grants: false)
        #expect(await refusing.requestAccess() == .denied)
        let denied = try Self.store(.denied)
        #expect(await denied.requestAccess() == .denied)
    }

    @Test func launchArguments() {
        #expect(FakeCalendarStore.Scenario(launchArgument: "writeOnly") == .writeOnly)
        #expect(FakeCalendarStore.Scenario(launchArgument: "noWritable") == .noWritable)
        #expect(FakeCalendarStore.Scenario(launchArgument: nil) == .fullAccess)
        #expect(FakeCalendarStore.Scenario(launchArgument: "nonsense") == .fullAccess)
    }

    @Test func changesAreAnnounced() async throws {
        let store = try Self.store(.notDetermined)
        var iterator = store.changes.makeAsyncIterator()
        await store.setScenario(.fullAccess)
        let next: Void? = await iterator.next()
        #expect(next != nil)
    }

    // MARK: Events and saves

    @Test func eventDetailsOfAnOccurrence() async throws {
        let store = try Self.store()
        let snapshot = try #require(try await store.event(key: "home/book-club|2026-10-19T19:00"))
        #expect(snapshot.event.title == "Book club: Cotsworth" && snapshot.event.location == "Raamatukoi")
        #expect(snapshot.event.start == local("2026-10-19T19:00") && snapshot.event.end == local("2026-10-19T21:00"))
        #expect(snapshot.event.recurrence?.rule == .thirteen(.monthly(system: .ifc, day: 12)))
        #expect(snapshot.recurrence?.recognition?.source == .byYearDay)
        #expect(snapshot.recurrence?.seriesStart == local("2026-01-12T19:00"))
        #expect(!snapshot.isFirstOccurrence && snapshot.firstOccurrenceIntact)
        #expect(snapshot.calendar?.info.title == "Home")
        let invitation = try #require(try await store.event(key: "work/design-review|2026-10-21T14:00"))
        #expect(invitation.event.readOnly == .invitation && invitation.event.attendeeCount == 6)
        #expect(try await store.event(key: "home/book-club|2026-10-20T19:00") == nil)
    }

    @Test func savingOneOccurrenceMakesAnOverride() async throws {
        let store = try Self.store()
        let key = "home/book-club|2026-10-19T19:00"
        let original = try #require(try await store.event(key: key)).event.draft
        var edited = original
        edited.title = "Book club: Eastman"
        let result = try await store.save(draft: edited, span: .thisEvent, target: .existing(key: key, original: original))
        #expect(result.written == [.title])
        let window = try Self.interval("2026-09-01T00:00", "2026-12-01T00:00")
        let titles = try await store.occurrences(in: window, calendars: ["home"]).filter { $0.eventID == "home/book-club" }
        #expect(titles.map(\.start.date.isoString) == ["2026-09-21", "2026-10-19", "2026-11-16"])
        #expect(titles.map(\.title) == ["Book club: Cotsworth", "Book club: Eastman", "Book club: Cotsworth"])
        #expect(titles.map(\.isDetached) == [false, true, false])
        #expect(try await store.hasChangedOccurrences(after: "home/book-club|2026-09-21T19:00"))
    }

    @Test func savingFutureEventsSplitsTheSeries() async throws {
        let store = try Self.store()
        let key = "work/one-on-one|2026-10-19T11:00"
        let original = try #require(try await store.event(key: key)).event.draft
        var edited = original
        edited.title = "1:1 with Marta and Jaan"
        let result = try await store.save(draft: edited, span: .futureEvents, target: .existing(key: key, original: original))
        let newKey = try #require(result.key)
        #expect(newKey.hasSuffix("|2026-10-19T11:00") && !newKey.hasPrefix("work/one-on-one|"))
        let window = try Self.interval("2026-10-05T00:00", "2026-11-03T00:00")
        let ones = try await store.occurrences(in: window, calendars: ["work"]).filter { $0.title.hasPrefix("1:1") }
        #expect(ones.map(\.title) == ["1:1 with Marta", "1:1 with Marta", "1:1 with Marta and Jaan", "1:1 with Marta and Jaan", "1:1 with Marta and Jaan"])
    }

    @Test func savingAllEventsKeepsTheFirstDate() async throws {
        let store = try Self.store()
        let key = "work/sprint-planning|2026-10-19T09:30"
        let original = try #require(try await store.event(key: key)).event.draft
        var edited = original
        edited.start = local("2026-10-19T10:00")
        edited.end = local("2026-10-19T11:00")
        _ = try await store.save(draft: edited, span: .allEvents, target: .existing(key: key, original: original))
        let first = try #require(try await store.event(key: "work/sprint-planning|2026-01-12T10:00"))
        #expect(first.event.start == local("2026-01-12T10:00") && first.isFirstOccurrence)
    }

    @Test func threeWayMergeKeepsOtherChanges() async throws {
        let store = try Self.store()
        let key = "home/dentist|2026-10-19T15:40"
        let original = try #require(try await store.event(key: key)).event.draft
        var elsewhere = original
        elsewhere.notes = "Bring the referral."
        _ = try await store.save(draft: elsewhere, span: .thisEvent, target: .existing(key: key, original: original))
        var edited = original
        edited.title = "Dentist"
        let result = try await store.save(draft: edited, span: .thisEvent, target: .existing(key: key, original: original))
        #expect(result.written == [.title] && result.conflicts.isEmpty)
        let saved = try #require(try await store.event(key: key))
        #expect(saved.event.title == "Dentist" && saved.event.notes == "Bring the referral.")
    }

    @Test func readOnlyEventsAreNotSaved() async throws {
        let store = try Self.store()
        let key = "holidays/halloween|2026-10-31"
        let original = try #require(try await store.event(key: key)).event.draft
        var edited = original
        edited.title = "Halloween party"
        await #expect(throws: CalendarStoreError.readOnly(.subscribed)) {
            try await store.save(draft: edited, span: .thisEvent, target: .existing(key: key, original: original))
        }
    }

    @Test func newEventsAndRemoval() async throws {
        let store = try Self.store()
        let draft = EventDraft(
            title: "Sauna", allDay: false, start: local("2026-10-22T18:00"), end: local("2026-10-22T19:30"), timeZone: Self.zone,
            calendarID: "home", availability: .busy)
        let result = try await store.save(draft: draft, span: .thisEvent, target: .new)
        let key = try #require(result.key)
        let window = try Self.interval("2026-10-22T00:00", "2026-10-23T00:00")
        #expect(try await store.occurrences(in: window, calendars: ["home"]).map(\.title).contains("Sauna"))
        try await store.remove(key: key, span: .thisEvent)
        #expect(!(try await store.occurrences(in: window, calendars: ["home"]).map(\.title).contains("Sauna")))
        await #expect(throws: CalendarStoreError.occurrenceGone) { try await store.remove(key: key, span: .thisEvent) }
    }

    @Test func removingOccurrencesOfASeries() async throws {
        let store = try Self.store()
        try await store.remove(key: "home/rent|2026-10-08", span: .thisEvent)
        let window = try Self.interval("2026-09-01T00:00", "2027-01-01T00:00")
        var rent = try await store.occurrences(in: window, calendars: ["home"]).filter { $0.title == "Rent" }.map(\.start.date.isoString)
        #expect(rent == ["2026-09-10", "2026-11-05", "2026-12-03"])
        try await store.remove(key: "home/rent|2026-11-05", span: .futureEvents)
        rent = try await store.occurrences(in: window, calendars: ["home"]).filter { $0.title == "Rent" }.map(\.start.date.isoString)
        #expect(rent == ["2026-09-10"])
    }

    @Test func invalidDraftsAreRefused() async throws {
        let store = try Self.store()
        let draft = EventDraft(
            title: "Backwards", allDay: false, start: local("2026-10-22T18:00"), end: local("2026-10-22T17:00"), timeZone: Self.zone,
            calendarID: "home", availability: .busy)
        await #expect(throws: CalendarStoreError.invalidDraft([.endBeforeStart])) {
            try await store.save(draft: draft, span: .thisEvent, target: .new)
        }
    }
}
