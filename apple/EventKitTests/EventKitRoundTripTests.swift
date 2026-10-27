import EventKit
import Foundation
import Testing
import ThirteenKit

@testable import Thirteen

/// Saves through `EventKitStore` into a local calendar and reads back through a new `EKEventStore`
/// (docs/EVENTS.md §6.2 `EventKitRoundTripTests`, §3.3, §4.7, §4.9). The all-day read rule of §3.3 is
/// pinned to what this measures; the dates EventKit returns before 1583 are recorded (lines starting
/// `EVENTKIT-RECORD`) for docs/events-verification/apple.md, not asserted equal to other platforms.
@Suite("EventKit round trips", .serialized)
struct EventKitRoundTripTests {
    typealias S = EventKitTestSupport
    static let tallinn = "Europe/Tallinn"

    /// A store and a fresh local calendar, removed after `body`.
    static func withCalendar(_ name: String, _ body: (EventKitStore, String) async throws -> Void) async throws {
        try S.requireAccess()
        let store = EventKitStore()
        let id = try await store.createLocalCalendar(title: "Thirteen \(name) \(UUID().uuidString.prefix(8))")
        do {
            try await body(store, id)
        } catch {
            try? await store.removeCalendar(id: id)
            throw error
        }
        try await store.removeCalendar(id: id)
    }

    static func draft(
        _ title: String, allDay: Bool, start: String, end: String, zone: String? = tallinn, calendar: String,
        recurrence: EventRecurrence? = nil
    ) -> EventDraft {
        EventDraft(
            title: title, allDay: allDay, start: S.local(start), end: S.local(end), timeZone: allDay ? nil : zone, calendarID: calendar,
            recurrence: recurrence, availability: allDay ? .free : .busy)
    }

    /// Every event of a calendar in `[from, to)`, read through a new EKEventStore.
    static func readBack(_ calendarID: String, from: String, to: String, zone: String = tallinn) throws -> [EKEvent] {
        let fresh = EKEventStore()
        let calendar = try #require(fresh.calendar(withIdentifier: calendarID))
        let start = try #require(EventInstants.instant(S.local(from), zone: zone))
        let end = try #require(EventInstants.instant(S.local(to), zone: zone))
        return S.events(fresh, in: calendar, from: start, to: end).sorted { $0.startDate < $1.startDate }
    }

    static func occurrences(_ store: EventKitStore, _ calendarID: String, from: String, to: String) async throws -> [OccurrenceSnapshot] {
        let start = try #require(EventInstants.instant(S.local(from), zone: tallinn))
        let end = try #require(EventInstants.instant(S.local(to), zone: tallinn))
        return try await store.occurrences(in: DateInterval(start: start, end: end), calendars: [calendarID])
    }

    // MARK: Times (§3.3)

    @Test func allDayAndMidnightEventsKeepTheirDays() async throws {
        try await Self.withCalendar("times") { store, calendar in
            let drafts = [
                Self.draft("One day", allDay: true, start: "2026-10-19T00:00", end: "2026-10-19T24:00", calendar: calendar),
                Self.draft("Three days", allDay: true, start: "2026-10-19T00:00", end: "2026-10-21T24:00", calendar: calendar),
                Self.draft("Across Year Day", allDay: true, start: "2026-12-30T00:00", end: "2027-01-01T24:00", calendar: calendar),
                Self.draft("Until midnight", allDay: false, start: "2026-10-19T22:00", end: "2026-10-19T24:00", calendar: calendar),
            ]
            for draft in drafts { _ = try await store.save(draft: draft, span: .thisEvent, target: .new) }
            let events = try Self.readBack(calendar, from: "2026-10-01T00:00", to: "2027-02-01T00:00")
            #expect(events.count == drafts.count)
            for draft in drafts {
                let event = try #require(events.first { $0.title == draft.title }, "\(draft.title) was not read back")
                let times = try #require(EventKitMapping.times(of: event, deviceZone: S.zone))
                #expect(times.allDay == draft.allDay && times.start == draft.start && times.end == draft.end, "\(draft.title): \(times)")
                if draft.allDay {
                    let lastDay = draft.end.date
                    let dayStart = try #require(EventInstants.startOfDay(lastDay, zone: S.zone))
                    S.record(
                        "all-day \(draft.title): startDate is local midnight: \(event.startDate == EventInstants.startOfDay(draft.start.date, zone: S.zone)); endDate is \(Int(event.endDate.timeIntervalSince(dayStart))) s after the last day's first instant")
                } else {
                    #expect(event.timeZone?.identifier == Self.tallinn)
                }
            }
            // The views' occurrences (device wall clock) agree.
            let occurrences = try await Self.occurrences(store, calendar, from: "2026-10-01T00:00", to: "2027-02-01T00:00")
            #expect(occurrences.map(\.title).sorted() == drafts.map(\.title).sorted())
        }
    }

    // MARK: Write-back (§4.9)

    @Test func aTitleOnlySaveKeepsTheByYearDayRule() async throws {
        try await Self.withCalendar("byyearday") { store, calendar in
            let monthly = EventRecurrence(rule: .thirteen(.monthly(system: .ifc, day: 12)))
            let draft = Self.draft(
                "Book club", allDay: false, start: "2026-01-12T19:00", end: "2026-01-12T21:00", calendar: calendar, recurrence: monthly)
            let created = try await store.save(draft: draft, span: .thisEvent, target: .new)
            let first = try #require(created.key)
            let before = try #require(try Self.readBack(calendar, from: "2026-01-01T00:00", to: "2026-02-01T00:00").first?.recurrenceRules?.first)
            let snapshot = try #require(try await store.event(key: first))
            #expect(snapshot.recurrence?.recognition?.source == .byYearDay)
            #expect(snapshot.event.recurrence == monthly && snapshot.isFirstOccurrence)
            var edited = snapshot.event.draft
            edited.title = "Book club: Cotsworth"
            let result = try await store.save(draft: edited, span: .futureEvents, target: .existing(key: first, original: snapshot.event.draft))
            #expect(result.written == [.title])
            let events = try Self.readBack(calendar, from: "2026-01-01T00:00", to: "2027-01-01T00:00")
            #expect(events.count == 13 && events.allSatisfy { $0.title == "Book club: Cotsworth" })
            let after = try #require(events.first?.recurrenceRules?.first)
            #expect(after.frequency == before.frequency && after.interval == before.interval)
            #expect(after.daysOfTheYear == before.daysOfTheYear && after.recurrenceEnd == nil)
            #expect(after.daysOfTheYear?.map(\.intValue) == [12, 40, 68, 96, 124, 152, -186, -158, -130, -102, -74, -46, -18])
        }
    }

    // MARK: 13-month forms (§4.3, §4.4, §4.5)

    struct FormCase: Sendable {
        let title: String
        let allDay: Bool
        let start: String
        let rule: ThirteenRule
        let end: RepeatEnd
        /// The end recognition reads back (a leap-only repeat's Never is stored as `UNTIL` on its cap).
        let readEnd: RepeatEnd
        let source: Recognition.Source
        let window: (from: Int, to: Int)
    }

    static let formCases: [FormCase] = [
        FormCase(
            title: "Year on IFC November 12 (a)", allDay: true, start: "2026-10-19", rule: .yearly(system: .ifc, month: 11, day: 12),
            end: .never, readEnd: .never, source: .gregorian, window: (2026, 2034)),
        FormCase(
            title: "Year Day (a)", allDay: true, start: "2026-12-31", rule: .intercalary(system: .ifc, id: .yearDay), end: .count(3),
            readEnd: .count(3), source: .gregorian, window: (2026, 2034)),
        FormCase(
            title: "Rent (b)", allDay: true, start: "2026-01-01", rule: .monthly(system: .ifc, day: 1), end: .count(5), readEnd: .count(5),
            source: .byYearDay, window: (2026, 2027)),
        FormCase(
            title: "Book club (b)", allDay: false, start: "2026-01-12", rule: .monthly(system: .ifc, day: 12),
            end: .until(try! GregorianDate(isoString: "2026-04-01")), readEnd: .until(try! GregorianDate(isoString: "2026-04-01")),
            source: .byYearDay, window: (2026, 2027)),
        FormCase(
            title: "Recycling (b)", allDay: true, start: "2026-01-06", rule: .weekly(system: .ifc, weekday: .friday, interval: 2),
            end: .never, readEnd: .never, source: .byYearDay, window: (2026, 2028)),
        FormCase(
            title: "Leap Day (c)", allDay: true, start: "2028-06-17", rule: .intercalary(system: .ifc, id: .leapDay), end: .never,
            readEnd: .never, source: .leapInterval, window: (2028, 2100)),
        FormCase(
            title: "Holy Women (c)", allDay: false, start: "2028-12-31", rule: .intercalary(system: .positivist, id: .leapDay),
            end: .never, readEnd: .never, source: .leapInterval, window: (2028, 2100)),
        FormCase(
            title: "Leap Day until 2040 (c)", allDay: true, start: "2028-06-17", rule: .intercalary(system: .ifc, id: .leapDay),
            end: .until(try! GregorianDate(isoString: "2040-06-17")), readEnd: .until(try! GregorianDate(isoString: "2040-06-17")),
            source: .leapInterval, window: (2028, 2100)),
        // A count longer than the cap allows is written as UNTIL on the cap, so it reads back as Never (v3.3).
        FormCase(
            title: "Leap Day 5 times from 2088 (c)", allDay: true, start: "2088-06-17", rule: .intercalary(system: .ifc, id: .leapDay),
            end: .count(5), readEnd: .never, source: .leapInterval, window: (2088, 2100)),
    ]

    /// Forms (a), (b) and (c) saved through the store (all-day, and timed in Europe/Tallinn) come
    /// back from EventKit on the engine's dates and are recognized as the repeat that was saved
    /// (§4.5): form (a) as a Gregorian yearly rule listing the 13-month rule as an alternative,
    /// forms (b) and (c) as the 13-month rule with its end. A leap-only repeat stops at its cap.
    @Test func thirteenMonthFormsReadBackAsSaved() async throws {
        try await Self.withCalendar("forms") { store, calendar in
            for item in Self.formCases {
                let day = S.day(item.start)
                let recurrence = EventRecurrence(rule: .thirteen(item.rule), end: item.end)
                let draft =
                    item.allDay
                    ? Self.draft(item.title, allDay: true, start: "\(item.start)T00:00", end: "\(item.start)T24:00", calendar: calendar, recurrence: recurrence)
                    : Self.draft(item.title, allDay: false, start: "\(item.start)T09:00", end: "\(item.start)T10:00", calendar: calendar, recurrence: recurrence)
                _ = try await store.save(draft: draft, span: .thisEvent, target: .new)

                let expected = try recurrence.expand(
                    start: day,
                    in: ExpansionWindow(
                        from: try GregorianDate(year: item.window.from, month: 1, day: 1),
                        to: try GregorianDate(year: item.window.to, month: 12, day: 31))
                ).occurrences.map(\.date)
                let found = try await Self.occurrences(
                    store, calendar, from: "\(item.window.from)-01-01T00:00", to: "\(item.window.to + 1)-01-01T00:00"
                ).filter { $0.title == item.title }
                #expect(found.count == expected.count, "\(item.title): EventKit \(found.count), engine \(expected.count)")
                if item.allDay { #expect(found.map(\.start.date) == expected, "\(item.title)") }

                let first = try #require(found.first, "\(item.title) was not read back")
                let snapshot = try #require(try await store.event(key: first.key))
                #expect(snapshot.isFirstOccurrence, "\(item.title)")
                let recognition = try #require(snapshot.recurrence?.recognition, "\(item.title) was not recognized")
                #expect(recognition.source == item.source, "\(item.title): \(recognition.source)")
                if item.source == .gregorian {
                    #expect(recognition.alternatives.contains(item.rule), "\(item.title): \(recognition.alternatives)")
                    #expect(snapshot.event.recurrence?.end == item.readEnd, "\(item.title)")
                } else {
                    #expect(snapshot.event.recurrence == EventRecurrence(rule: .thirteen(item.rule), end: item.readEnd), "\(item.title): \(String(describing: snapshot.event.recurrence))")
                }
                S.record("form \(item.title): \(found.count) occurrences, read back as \(recognition.source.rawValue), end \(String(describing: snapshot.event.recurrence?.end))")

                // Form (c) is stored as a yearly rule with interval 4 that ends on its cap or before.
                if item.source == .leapInterval {
                    let stored = try #require(try Self.readBack(calendar, from: "\(item.start)T00:00", to: "\(item.window.to + 1)-01-01T00:00")
                        .first { $0.title == item.title }?.recurrenceRules?.first)
                    #expect(stored.frequency == .yearly && stored.interval == 4 && stored.recurrenceEnd?.occurrenceCount == 0, "\(item.title)")
                    let cap = try #require(try item.rule.encoding(start: day).cap)
                    // All-day: EventKit returns the stored until date at 23:59:59 UTC (allDayRepeatEndsReadBackOnTheirDay).
                    let endDay = try #require(
                        stored.recurrenceEnd?.endDate.flatMap { end in
                            item.allDay
                                ? RecurrenceMapping.allDayUntil(end, deviceZone: S.zone) : EventInstants.localDate(end, zone: Self.tallinn)
                        })
                    if case let .until(until) = item.readEnd { #expect(endDay == until, "\(item.title)") } else { #expect(endDay == cap, "\(item.title)") }
                }
            }
        }
    }

    // MARK: "Future events" and the count check (§4.7)

    /// A `COUNT=10` weekly series split at its 4th occurrence keeps 7 more; with End repeat set to
    /// After 3 times, 3. `countCorrected` (the second save) is recorded, not asserted: gate V23 found
    /// EventKit on macOS 27 writing the chosen count minus the head's.
    @Test(arguments: [nil, 3] as [Int?])
    func futureEventsKeepTheRightCount(_ newCount: Int?) async throws {
        try await Self.withCalendar("count") { store, calendar in
            let weekly = EventRecurrence(rule: .rrule(try RRule(text: "FREQ=WEEKLY")), end: .count(10))
            let draft = Self.draft(
                "Weekly", allDay: false, start: "2026-10-22T19:00", end: "2026-10-22T20:00", calendar: calendar, recurrence: weekly)
            _ = try await store.save(draft: draft, span: .thisEvent, target: .new)
            let all = try await Self.occurrences(store, calendar, from: "2026-10-01T00:00", to: "2027-02-01T00:00")
            #expect(all.count == 10)
            let fourth = all[3]
            #expect(fourth.start == S.local("2026-11-12T19:00"))
            let snapshot = try #require(try await store.event(key: fourth.key))
            #expect(!snapshot.isFirstOccurrence && snapshot.firstOccurrenceIntact)
            var edited = snapshot.event.draft
            edited.title = "Weekly, later"
            if let newCount { edited.recurrence = EventRecurrence(rule: weekly.rule, end: .count(newCount)) }
            let result = try await store.save(draft: edited, span: .futureEvents, target: .existing(key: fourth.key, original: snapshot.event.draft))
            S.record("future events split of COUNT=10 at the 4th, End repeat \(newCount.map { "After \($0) times" } ?? "kept"): count check corrected = \(result.countCorrected)")
            let events = try Self.readBack(calendar, from: "2026-10-01T00:00", to: "2027-06-01T00:00")
            let head = events.filter { $0.title == "Weekly" }
            let tail = events.filter { $0.title == "Weekly, later" }
            #expect(head.count == 3)
            #expect(tail.count == (newCount ?? 7))
            let tailRule = try #require(tail.first?.recurrenceRules?.first, "the new series has no rule")
            S.record("new series rule after the save: \(tailRule.description)")
            #expect(tailRule.recurrenceEnd?.occurrenceCount == (newCount ?? 7))
        }
    }

    // MARK: "Save for all events" (§4.7)

    /// A repeat the Custom editor cannot express (several `BYDAY` ordinals, `editable: false`, §4.5
    /// step 6) that EventKit expands: the first and third Monday of every month, from 2026-05-04.
    /// The spec names a `BYWEEKNO` series here, but EventKit (iOS 26.5 simulator) gives a `BYWEEKNO`
    /// rule only its first occurrence (`foreignRulesAreRecorded`), so no later occurrence exists to
    /// edit; the fixture's `BYWEEKNO` case stays covered by the `seriesEdits` parity tests.
    static let foreignRule = "FREQ=MONTHLY;BYDAY=1MO,3MO"
    static let foreignDates = ["2026-05-04", "2026-05-18", "2026-06-01", "2026-06-15", "2026-07-06"]

    @Test func saveForAllEventsKeepsTheFirstDate() async throws {
        try await Self.withCalendar("allevents") { store, calendar in
            let rule = EventRecurrence(rule: .rrule(try RRule(text: Self.foreignRule)))
            let draft = Self.draft("Review", allDay: false, start: "2026-05-04T19:00", end: "2026-05-04T20:00", calendar: calendar, recurrence: rule)
            _ = try await store.save(draft: draft, span: .thisEvent, target: .new)
            let before = try await Self.occurrences(store, calendar, from: "2026-05-01T00:00", to: "2026-07-15T00:00")
            #expect(before.map(\.start.date.isoString) == Self.foreignDates)
            let fifth = try #require(before.last)
            let snapshot = try #require(try await store.event(key: fifth.key))
            #expect(snapshot.recurrence?.recognition?.editable == false)
            #expect(snapshot.firstOccurrenceIntact && !snapshot.isFirstOccurrence)
            #expect(snapshot.recurrence?.seriesStart == S.local("2026-05-04T19:00"))
            var edited = snapshot.event.draft
            edited.start = S.local("2026-07-06T20:30")
            edited.end = S.local("2026-07-06T21:30")
            let result = try await store.save(draft: edited, span: .allEvents, target: .existing(key: fifth.key, original: snapshot.event.draft))
            #expect(result.written == [.time])
            let events = try Self.readBack(calendar, from: "2026-05-01T00:00", to: "2026-07-15T00:00")
            #expect(events.compactMap { EventInstants.wallClock($0.startDate, zone: Self.tallinn)?.isoString } == Self.foreignDates.map { "\($0)T20:30" })
            #expect(Set(events.compactMap(\.eventIdentifier)).count == 1, "the series was split")
            let stored = try #require(events.first?.recurrenceRules?.first)
            #expect(stored.daysOfTheWeek?.map(\.weekNumber) == [1, 3])
        }
    }

    @Test func aDeletedFirstOccurrenceOffersOnlyThisEvent() async throws {
        try await Self.withCalendar("firstgone") { store, calendar in
            let rule = EventRecurrence(rule: .rrule(try RRule(text: Self.foreignRule)))
            let draft = Self.draft("Review", allDay: false, start: "2026-05-04T19:00", end: "2026-05-04T20:00", calendar: calendar, recurrence: rule)
            _ = try await store.save(draft: draft, span: .thisEvent, target: .new)
            let before = try await Self.occurrences(store, calendar, from: "2026-05-01T00:00", to: "2026-07-15T00:00")
            #expect(before.count == 5)
            try await store.remove(key: try #require(before.first).key, span: .thisEvent)
            let fifth = try #require(before.last)
            let snapshot = try #require(try await store.event(key: fifth.key))
            #expect(!snapshot.firstOccurrenceIntact)
            var edited = snapshot.event.draft
            edited.start = S.local("2026-07-06T20:30")
            edited.end = S.local("2026-07-06T21:30")
            await #expect(throws: CalendarStoreError.firstOccurrenceGone) {
                try await store.save(draft: edited, span: .allEvents, target: .existing(key: fifth.key, original: snapshot.event.draft))
            }
            // "This event only" still works.
            _ = try await store.save(draft: edited, span: .thisEvent, target: .existing(key: fifth.key, original: snapshot.event.draft))
            let events = try Self.readBack(calendar, from: "2026-05-01T00:00", to: "2026-07-15T00:00")
            #expect(events.compactMap { EventInstants.wallClock($0.startDate, zone: Self.tallinn)?.isoString } == [
                "2026-05-18T19:00", "2026-06-01T19:00", "2026-06-15T19:00", "2026-07-06T20:30",
            ])
        }
    }

    // MARK: Alerts only, changed occurrences, deletes seen by an open editor

    @Test func alertsChangedOccurrencesAndRefresh() async throws {
        try await Self.withCalendar("changes") { store, calendar in
            let weekly = EventRecurrence(rule: .rrule(try RRule(text: "FREQ=WEEKLY")), end: .count(5))
            let draft = Self.draft("Run", allDay: false, start: "2026-11-02T07:00", end: "2026-11-02T08:00", calendar: calendar, recurrence: weekly)
            _ = try await store.save(draft: draft, span: .thisEvent, target: .new)
            let all = try await Self.occurrences(store, calendar, from: "2026-11-01T00:00", to: "2026-12-15T00:00")
            #expect(all.count == 5)

            // "Edit alerts" writes only the alarms of that one occurrence (§3.5).
            try await store.saveAlarms(key: all[1].key, alarms: [.relative(offsetMinutes: -30)], span: .thisEvent)
            let afterAlarms = try await Self.occurrences(store, calendar, from: "2026-11-01T00:00", to: "2026-12-15T00:00")
            #expect(afterAlarms.map(\.isDetached) == [false, true, false, false, false])
            let renamed = afterAlarms[1].key != all[1].key
            let seriesID = EventKitMapping.parseKey(all[1].key)?.eventID ?? ""
            let detachedID = EventKitMapping.parseKey(afterAlarms[1].key)?.eventID ?? ""
            let suffixed: Bool = detachedID.hasPrefix(seriesID + "/RID=")
            let othersKept: Bool = [0, 2, 3, 4].allSatisfy { afterAlarms[$0].key == all[$0].key }
            S.record(
                "EventKitRoundTripTests: alerts saved for this event only: occurrence detached, key changed \(renamed), "
                    + "its eventIdentifier is the series' plus /RID= and a number \(suffixed), the other keys unchanged \(othersKept)")
            // The key read before the change still finds the occurrence (§3.2).
            let second = try #require(try await store.event(key: all[1].key))
            #expect(second.key == afterAlarms[1].key)
            #expect(second.event.alarms == [.relative(offsetMinutes: -30)] && second.event.title == "Run")
            #expect(second.event.start == S.local("2026-11-09T07:00"))
            // A changed occurrence after this one (span.future.exceptionsLost, §2.11).
            let third = try #require(try await store.event(key: all[2].key))
            #expect(third.event.alarms.isEmpty)
            var edited = third.event.draft
            edited.title = "Long run"
            _ = try await store.save(draft: edited, span: .thisEvent, target: .existing(key: all[2].key, original: third.event.draft))
            #expect(try await store.hasChangedOccurrences(after: all[0].key))
            #expect(!(try await store.hasChangedOccurrences(after: all[3].key)))

            // An open editor sees a delete made elsewhere (refresh() is false: editor.deletedElsewhere).
            _ = try #require(try await store.event(key: all[0].key))
            let other = EKEventStore()
            let first = try #require(Self.readBack(calendar, from: "2026-11-01T00:00", to: "2026-11-03T00:00").first)
            let firstID = try #require(first.eventIdentifier)
            let elsewhere = try #require(other.event(withIdentifier: firstID))
            try other.remove(elsewhere, span: .futureEvents, commit: true)
            #expect(try await store.refreshEvent(key: all[0].key) == nil)
        }
    }

    // MARK: Repeat ends of all-day events (§4.4 Ends)

    /// What EventKit stores and returns as the `recurrenceEnd` of an all-day series, for several
    /// end instants: it stores the date of the instant in the device's zone (`UNTIL=20261109`) and
    /// returns that date at 23:59:59 UTC, which `RecurrenceMapping.untilValue` reads as the until
    /// date. Before 2026-10-26 the app read it as its date in the device's zone, one day late east of
    /// UTC. A floating timed series is recorded too.
    @Test func allDayRepeatEndsReadBackOnTheirDay() async throws {
        try S.requireAccess()
        let store = EKEventStore()
        let calendar = try S.makeCalendar(store, title: "Thirteen ends \(UUID().uuidString.prefix(8))")
        defer { try? store.removeCalendar(calendar, commit: true) }
        let until = S.day("2026-11-09")
        let ends: [(String, Date)] = [
            ("local 23:59:59", try #require(EventInstants.instant(try LocalDateTime(date: until, minute: 1439), zone: S.zone, seconds: 59))),
            ("local 12:00", try #require(EventInstants.instant(try LocalDateTime(date: until, minute: 720), zone: S.zone))),
            ("local 00:00", try #require(EventInstants.startOfDay(until, zone: S.zone))),
            ("UTC 23:59:59", EventInstants.date(utc: try LocalDateTime(date: until, minute: 1439), seconds: 59)),
            ("UTC 12:00", EventInstants.date(utc: try LocalDateTime(date: until, minute: 720))),
            ("UTC 00:00", EventInstants.date(utc: try LocalDateTime(date: until, minute: 0))),
        ]
        for (label, end) in ends {
            let event = EKEvent(eventStore: store)
            event.calendar = calendar
            event.title = "Ends \(label)"
            event.isAllDay = true
            event.startDate = try #require(EventInstants.startOfDay(S.day("2026-10-19"), zone: S.zone))
            event.endDate = event.startDate
            event.recurrenceRules = [EKRecurrenceRule(recurrenceWith: .weekly, interval: 1, end: EKRecurrenceEnd(end: end))]
            try store.save(event, span: .thisEvent, commit: true)
            let fresh = EKEventStore()
            let events = S.events(
                fresh, in: try #require(fresh.calendar(withIdentifier: calendar.calendarIdentifier)), from: S.yearStart(2026),
                to: S.yearStart(2027)
            ).filter { $0.title == event.title }
            let rule = events.first?.recurrenceRules?.first
            let read = rule?.recurrenceEnd?.endDate
            let days = events.compactMap { EventInstants.localDate($0.startDate, zone: S.zone)?.isoString }
            S.record(
                "all-day end \(label) in \(S.zone): wrote \(EventInstants.isoUTC(end)), read \(read.map(EventInstants.isoUTC) ?? "none") (local date \(read.flatMap { EventInstants.localDate($0, zone: S.zone)?.isoString } ?? "none"), UTC date \(read.flatMap { EventInstants.utc($0)?.date.isoString } ?? "none")), stored \(rule?.description ?? "none"), \(days.count) days, last \(days.last ?? "none")"
            )
            #expect(!days.isEmpty)
            let expected = try #require(EventInstants.localDate(end, zone: S.zone))
            let readEnd = try #require(read, "\(label): no end read back")
            #expect(readEnd == EventInstants.date(utc: try LocalDateTime(date: expected, minute: 1439), seconds: 59), "\(label)")
            let context = RecurrenceMapping.Context(allDay: true, zone: nil, deviceZone: S.zone)
            #expect(RecurrenceMapping.untilValue(readEnd, context: context) == .date(expected), "\(label)")
            try? store.remove(event, span: .futureEvents, commit: true)
        }

        // A floating timed series (no zone; Thirteen never makes one, other apps can), recorded.
        let floating = EKEvent(eventStore: store)
        floating.calendar = calendar
        floating.title = "Floating"
        floating.isAllDay = false
        floating.timeZone = nil
        floating.startDate = try #require(EventInstants.instant(S.local("2026-10-19T19:00"), zone: S.zone))
        floating.endDate = floating.startDate.addingTimeInterval(3600)
        let floatingEnd = try #require(EventInstants.instant(try LocalDateTime(date: until, minute: 1439), zone: S.zone, seconds: 59))
        floating.recurrenceRules = [EKRecurrenceRule(recurrenceWith: .weekly, interval: 1, end: EKRecurrenceEnd(end: floatingEnd))]
        try store.save(floating, span: .thisEvent, commit: true)
        let fresh = EKEventStore()
        let back = S.events(
            fresh, in: try #require(fresh.calendar(withIdentifier: calendar.calendarIdentifier)), from: S.yearStart(2026), to: S.yearStart(2027)
        ).filter { $0.title == "Floating" }
        let floatingRule = back.first?.recurrenceRules?.first
        let floatingRead = floatingRule?.recurrenceEnd?.endDate
        let floatingContext = RecurrenceMapping.Context(allDay: false, zone: nil, deviceZone: S.zone)
        S.record(
            "floating timed end local 23:59:59 in \(S.zone): wrote \(EventInstants.isoUTC(floatingEnd)), read \(floatingRead.map(EventInstants.isoUTC) ?? "none"), event zone \(back.first?.timeZone?.identifier ?? "nil"), read as \(floatingRead.flatMap { RecurrenceMapping.untilValue($0, context: floatingContext) }.map { "\($0)" } ?? "none"), stored \(floatingRule?.description ?? "none"), \(back.count) occurrences, last \(back.last.flatMap { EventInstants.wallClock($0.startDate, zone: S.zone)?.isoString } ?? "none")"
        )
        #expect(!back.isEmpty)
    }

    // MARK: Rules the Custom editor cannot express, recorded

    /// How EventKit expands rules that Thirteen only keeps (`editable: false`, §4.5 step 6).
    @Test(arguments: [
        ("FREQ=YEARLY;BYDAY=MO;BYWEEKNO=20", "2026-05-11T19:00"),
        ("FREQ=YEARLY;BYWEEKNO=20", "2026-05-11T19:00"),
        ("FREQ=MONTHLY;BYDAY=1MO,3MO", "2026-05-04T19:00"),
        ("FREQ=YEARLY;BYMONTH=5;BYDAY=2MO", "2026-05-11T19:00"),
    ])
    func foreignRulesAreRecorded(_ text: String, _ start: String) async throws {
        try await Self.withCalendar("foreign") { store, calendar in
            let rule = EventRecurrence(rule: .rrule(try RRule(text: text)))
            let startValue = S.local(start)
            let end = try startValue.adding(minutes: 60)
            let draft = Self.draft("Rule", allDay: false, start: start, end: end.isoString, calendar: calendar, recurrence: rule)
            _ = try await store.save(draft: draft, span: .thisEvent, target: .new)
            let events = try Self.readBack(calendar, from: "2026-01-01T00:00", to: "2031-01-01T00:00")
            let stored = events.first?.recurrenceRules?.first?.description ?? "none"
            let dates = events.compactMap { EventInstants.wallClock($0.startDate, zone: Self.tallinn)?.date.isoString }
            let engine = try rule.expand(start: startValue.date, in: ExpansionWindow(from: S.day("2026-01-01"), to: S.day("2030-12-31")))
                .occurrences.map(\.date.isoString)
            S.record("rule \(text) from \(start): EventKit stored \(stored); EventKit \(dates.count) dates 2026 to 2030 \(dates.prefix(6)); engine \(engine.count) \(engine.prefix(6))")
            #expect(!dates.isEmpty)
        }
    }

    // MARK: Dates before 1583 (§3.1.1), recorded

    @Test func datesBefore1583AreRecorded() async throws {
        try S.requireAccess()
        let store = EKEventStore()
        let calendar = try S.makeCalendar(store, title: "Thirteen history \(UUID().uuidString.prefix(8))")
        defer { try? store.removeCalendar(calendar, commit: true) }
        // Thirteen never creates these (validateDraft: out-of-range); they stand for events other apps made.
        let single = Self.draft("1500-03-01", allDay: true, start: "1500-03-01T00:00", end: "1500-03-01T24:00", calendar: calendar.calendarIdentifier)
        let yearly = Self.draft(
            "Yearly from 1248", allDay: true, start: "1248-06-17T00:00", end: "1248-06-17T24:00", calendar: calendar.calendarIdentifier,
            recurrence: EventRecurrence(rule: .rrule(try RRule(text: "FREQ=YEARLY"))))
        for draft in [single, yearly] {
            let event = EKEvent(eventStore: store)
            try EventKitMapping.apply(draft, groups: DraftField.allCases, to: event, context: S.writeContext(store))
            try store.save(event, span: .thisEvent, commit: true)
        }
        let fresh = EKEventStore()
        let freshCalendar = try #require(fresh.calendar(withIdentifier: calendar.calendarIdentifier))
        func read(_ from: String, _ to: String) -> [EKEvent] {
            S.events(fresh, in: freshCalendar, from: EventInstants.startOfDay(S.day(from), zone: S.zone)!, to: EventInstants.startOfDay(S.day(to), zone: S.zone)!)
        }
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = TimeZone(identifier: S.zone)!
        func describe(_ event: EKEvent) -> String {
            let proleptic = EventKitMapping.times(of: event, deviceZone: S.zone).map { "\($0.start.date)...\($0.end.date)" } ?? "?"
            let parts = gregorian.dateComponents([.year, .month, .day], from: event.startDate)
            return "proleptic \(proleptic), Foundation .gregorian \(parts.year ?? 0)-\(parts.month ?? 0)-\(parts.day ?? 0)"
        }
        let old = read("1500-02-01", "1500-04-01").filter { $0.title == single.title }
        #expect(old.count == 1)
        for event in old { S.record("all-day event saved on proleptic 1500-03-01, read back: \(describe(event))") }
        for (from, to) in [("1248-06-01", "1248-07-01"), ("1582-01-01", "1584-01-01"), ("2026-01-01", "2027-01-01")] {
            let found = read(from, to).filter { $0.title == yearly.title }
            S.record("yearly series from proleptic 1248-06-17, occurrences \(from) to \(to): \(found.map(describe).joined(separator: "; "))")
        }
        #expect(!read("2026-01-01", "2027-01-01").filter { $0.title == yearly.title }.isEmpty)
        // A series that starts before 1583 is read-only (historical) in every occurrence (§3.5).
        let thirteen = EventKitStore()
        let year2026 = DateInterval(start: S.yearStart(2026), end: S.yearStart(2027))
        let occurrences = try await thirteen.occurrences(in: year2026, calendars: [calendar.calendarIdentifier])
        #expect(!occurrences.isEmpty && occurrences.allSatisfy { $0.readOnly == .historical })
    }
}
