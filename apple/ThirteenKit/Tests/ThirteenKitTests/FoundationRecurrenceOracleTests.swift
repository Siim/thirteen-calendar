import Foundation
import Testing
import ThirteenKit

/// A second oracle for the 13-month `BYYEARDAY` encodings (docs/EVENTS.md §4.3 form (b), §5.5,
/// §6.2): every form (b) rule, expanded by Foundation's `Calendar.RecurrenceRule` (macOS 15+),
/// must give exactly `ThirteenRule.dates(inYear:start:)` (TS `thirteenRuleDatesInYear`) for every
/// year from 2024 to 2104.
///
/// The rules are every 13-month rule made from a date of 2024 (a leap year) in both systems, of
/// every kind (monthly, weekly, every 2 weeks in both fortnight phases, yearly, intercalary), plus
/// every `byyearday` case of the `thirteenRules` fixture section with its own start. Foundation is
/// not the engine that expands events for EventKit (the calendar daemon is); the iOS simulator's
/// `EventKitExpansionTests` covers that (§6.2).
@Suite("Foundation Calendar.RecurrenceRule oracle for BYYEARDAY encodings")
struct FoundationRecurrenceOracleTests {
    static let firstYear = 2024
    static let lastYear = 2104

    /// A rule and the start it is anchored on.
    struct Case: Hashable {
        let rule: ThirteenRule
        let start: GregorianDate
    }

    /// Every form (b) rule from the dates of 2024 and the fixture, one start per distinct encoding.
    static func cases() throws -> [Case] {
        var seen = Set<String>()
        var cases: [Case] = []
        func add(_ rule: ThirteenRule, _ start: GregorianDate) throws {
            let encoding = try rule.encoding(start: start)
            guard encoding.form == .byYearDay else { return }
            let key = "\(rule.markerText) \(try encoding.rrule.formatted()) \(start.year == firstYear ? "" : start.isoString)"
            if seen.insert(key).inserted { cases.append(Case(rule: rule, start: start)) }
        }
        for system in CalendarSystemID.allCases {
            for dayOfYear in 1...366 {
                let start = try GregorianDate(year: firstYear, dayOfYear: dayOfYear)
                for kind in ThirteenRuleKind.allCases {
                    if let rule = ThirteenRule(kind, start: start, system: system) { try add(rule, start) }
                }
            }
        }
        // Fixture starts from 1900 to 2104 (the later ones, up to 9999, have no year in range).
        for c in try EventsFixture.load().cases("thirteenRules") {
            let start = try fixtureDate(c.field("start"))
            if (1900...lastYear).contains(start.year) { try add(c.decode("rule", as: ThirteenRule.self), start) }
        }
        return cases
    }

    @Test("the case list covers every kind and both systems")
    func coverage() throws {
        let cases = try Self.cases()
        let kinds = Set(cases.map { c -> String in
            switch c.rule {
            case .monthly: "monthly"
            case let .weekly(_, _, interval): interval == 1 ? "weekly" : "biweekly"
            case .yearly: "yearly"
            case .intercalary: "intercalary"
            }
        })
        // Intercalary rules are form (b) only where the day moves in leap years (Positivist Festival
        // of All the Dead); IFC Year Day is a fixed Gregorian date and Leap Days use form (c).
        #expect(kinds == ["monthly", "weekly", "biweekly", "yearly", "intercalary"])
        #expect(Set(cases.map(\.rule.system)) == Set(CalendarSystemID.allCases))
        // 28 monthly + 7 weekly + 14 every-2-weeks per system at least, plus the yearly rules on
        // dates whose Gregorian date moves in leap years.
        #expect(cases.count >= 2 * (28 + 7 + 14))
    }

    @available(macOS 15, iOS 18, *)
    private static func foundationDates(_ rrule: RRule, start: GregorianDate, calendar: Calendar) throws -> [GregorianDate] {
        let rule = Calendar.RecurrenceRule.yearly(calendar: calendar, interval: rrule.interval, daysOfTheYear: rrule.byYearDay)
        let from = calendar.date(from: DateComponents(year: start.year, month: start.month, day: start.day, hour: 12))!
        let to = calendar.date(from: DateComponents(year: lastYear + 1, month: 1, day: 1))!
        return try rule.recurrences(of: from, in: from..<to).map { date in
            let parts = calendar.dateComponents([.year, .month, .day], from: date)
            return try GregorianDate(year: parts.year!, month: parts.month!, day: parts.day!)
        }
    }

    @Test("Calendar.RecurrenceRule expands every BYYEARDAY encoding to the rule's dates, 2024 to 2104")
    func byYearDayEncodings() throws {
        guard #available(macOS 15, iOS 18, *) else {
            Issue.record("Calendar.RecurrenceRule needs macOS 15 or iOS 18; this oracle did not run")
            return
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let cases = try Self.cases()
        var failures: [String] = []
        for c in cases {
            let encoding = try c.rule.encoding(start: c.start)
            let rrule = encoding.rrule
            // Form (b) is exactly FREQ=YEARLY;BYYEARDAY=list, with no end.
            #expect(rrule.freq == .yearly && rrule.interval == 1 && !rrule.byYearDay.isEmpty, "\(rrule.text)")
            #expect(rrule.count == nil && rrule.until == nil && rrule.byDay.isEmpty && rrule.byMonth.isEmpty, "\(rrule.text)")

            var expected: [GregorianDate] = []
            for year in max(Self.firstYear, c.start.year)...Self.lastYear {
                expected += try c.rule.dates(inYear: year, start: c.start).filter { $0 >= c.start }
            }
            let actual = try Self.foundationDates(rrule, start: c.start, calendar: calendar).filter { $0.year >= Self.firstYear }
            if actual != expected {
                let first = zip(actual, expected).first { $0 != $1 }
                failures.append(
                    "\(c.rule.markerText) from \(c.start.isoString) (\(try rrule.formatted())): Foundation \(actual.count) dates, "
                        + "engine \(expected.count); first difference \(first.map { "\($0.0.isoString) vs \($0.1.isoString)" } ?? "at the end")")
            }
        }
        #expect(failures.isEmpty, "\(failures.count) of \(cases.count) rules differ: \(failures.prefix(10).joined(separator: "; "))")
    }
}
