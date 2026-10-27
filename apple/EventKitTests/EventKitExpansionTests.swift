import EventKit
import Foundation
import Testing
import ThirteenKit

@testable import Thirteen

/// The calendar daemon's own expansion of the 13-month encodings (docs/EVENTS.md §6.2, task A2, run
/// before the manual gate V1): every form (b) and (c) case of the `thirteenRules` fixture section is
/// saved through the app's mapping into a new local calendar, read back with `events(matching:)` in
/// 4-year pieces for 2024 to 2104, and compared with the engine's dates (which the fixture pins
/// year by year, and FoundationRecurrenceOracleTests compares with Foundation's expander). Cases that
/// start after 2104 are read from their start year through the last year the fixture lists.
@Suite("EventKit expansion", .serialized)
struct EventKitExpansionTests {
    typealias S = EventKitTestSupport

    struct Case {
        let index: Int
        let rule: ThirteenRule
        let start: GregorianDate
        let form: String
        let cap: GregorianDate?
        let datesIn: [(year: Int, dates: [GregorianDate])]
    }

    static func cases() throws -> [Case] {
        try S.eventsSection("thirteenRules").enumerated().compactMap { index, item in
            let encoding = try #require(item["encoding"] as? [String: Any])
            let form = try #require(encoding["form"] as? String)
            guard form != "gregorian-yearly" else { return nil }
            let rule = try S.decode(ThirteenRule.self, from: try #require(item["rule"]))
            let start = S.day(try #require(item["start"] as? String))
            let cap = (encoding["cap"] as? String).map(S.day)
            let datesIn = try (item["datesIn"] as? [[String: Any]] ?? []).map { entry in
                (year: try #require(entry["year"] as? Int), dates: try #require(entry["dates"] as? [String]).map(S.day))
            }
            return Case(index: index, rule: rule, start: start, form: form, cap: cap, datesIn: datesIn)
        }
    }

    /// The years a case is read for.
    static func years(_ item: Case) -> ClosedRange<Int> {
        if item.start.year <= 2104 { return max(2024, item.start.year)...2104 }
        let last = item.datesIn.map(\.year).max() ?? item.start.year
        return item.start.year...min(9999, max(item.start.year, last))
    }

    @Test func formsBAndCExpandLikeTheEngine() throws {
        try S.requireAccess()
        let all = try Self.cases()
        #expect(all.count == 81)
        #expect(all.filter { $0.form == "byyearday" }.count == 76 && all.filter { $0.form == "leap-interval" }.count == 5)
        let store = EKEventStore()
        let calendar = try S.makeCalendar(store, title: "Thirteen expansion \(UUID().uuidString.prefix(8))")
        defer { try? store.removeCalendar(calendar, commit: true) }
        var compared = 0
        var dateCount = 0
        for item in all {
            let years = Self.years(item)
            let recurrence = EventRecurrence(rule: .thirteen(item.rule))
            let draft = EventDraft(
                title: "thirteenRules[\(item.index)]", allDay: true, start: try LocalDateTime(date: item.start, minute: 0),
                end: try LocalDateTime(date: item.start, minute: 1440), timeZone: nil, calendarID: calendar.calendarIdentifier,
                recurrence: recurrence, availability: .free)
            let event = EKEvent(eventStore: store)
            try EventKitMapping.apply(draft, groups: DraftField.allCases, to: event, context: S.writeContext(store))
            do {
                try store.save(event, span: .thisEvent, commit: true)
            } catch {
                Issue.record("thirteenRules[\(item.index)] (\(item.start), \(item.form)): EventKit refused the save: \(error)")
                continue
            }
            defer { try? store.remove(event, span: .futureEvents, commit: true) }

            let windowStart = try GregorianDate(year: years.lowerBound, month: 1, day: 1)
            let windowEnd = try GregorianDate(year: years.upperBound, month: 12, day: 31)
            let expected = try recurrence.expand(start: item.start, in: ExpansionWindow(from: windowStart, to: windowEnd), limit: 100_000)
                .occurrences.map(\.date)
            let to = years.upperBound == 9999 ? EventInstants.date(utc: S.local("9999-12-31T12:00")) : S.yearStart(years.upperBound + 1)
            let found = S.events(store, in: calendar, from: S.yearStart(years.lowerBound), to: to)
                .filter { $0.title == draft.title }
                .compactMap { EventInstants.localDate($0.startDate, zone: S.zone) }
            let actual = Array(Set(found)).sorted()
            #expect(actual == expected, "thirteenRules[\(item.index)] \(item.rule) from \(item.start): EventKit \(actual.count) dates, engine \(expected.count); first difference \(Self.firstDifference(actual, expected))")

            // The fixture's own dates for the years it lists (inside the window, from the start, up to the cap).
            for entry in item.datesIn where years.contains(entry.year) {
                let pinned = entry.dates.filter { date in date >= item.start && (item.cap.map { cap in date <= cap } ?? true) }
                #expect(actual.filter { $0.year == entry.year } == pinned, "thirteenRules[\(item.index)] in \(entry.year)")
            }
            compared += 1
            dateCount += actual.count
        }
        S.record("EventKitExpansionTests: \(compared) form (b) and (c) cases, \(dateCount) dates compared")
    }

    static func firstDifference(_ a: [GregorianDate], _ b: [GregorianDate]) -> String {
        for (x, y) in zip(a, b) where x != y { return "EventKit \(x), engine \(y)" }
        if a.count != b.count { return "lengths \(a.count) and \(b.count)" }
        return "none"
    }
}
