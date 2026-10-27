import EventKit
import Foundation
import Testing
import ThirteenKit

/// Finds the test bundle's resources (fixtures/events.json and the mockup data set, referenced from
/// project.yml, never copied).
final class TestBundleToken {}

enum TestResources {
    static var bundle: Bundle { Bundle(for: TestBundleToken.self) }

    static func url(_ name: String) throws -> URL {
        try #require(bundle.url(forResource: name, withExtension: "json"), "\(name).json is not in the test bundle")
    }

    /// One section of fixtures/events.json as plain JSON objects.
    static func eventsSection(_ name: String) throws -> [[String: Any]] {
        let data = try Data(contentsOf: try url("events"))
        let root = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        return try #require(root[name] as? [[String: Any]], "events.json has no section \(name)")
    }
}

/// Every `RRULE` of the `rrules` fixture section, and every 13-month encoding of `thirteenRules`,
/// through `EKRecurrenceRule` and back (docs/EVENTS.md §6.2 `RecurrenceMappingTests`). EventKit rules
/// are built without an event store, so nothing here touches calendar data or asks for access.
@Suite("Recurrence mapping")
struct RecurrenceMappingTests {
    static let tallinn = "Europe/Tallinn"

    /// What EventKit has no field for (`RecurrenceMapping.ekRule` throws for these).
    static func isRepresentable(_ rule: RRule) -> Bool {
        if [.secondly, .minutely, .hourly].contains(rule.freq) { return false }
        if !rule.byHour.isEmpty || !rule.byMinute.isEmpty || !rule.bySecond.isEmpty { return false }
        if let rscale = rule.rscale, rscale != "GREGORIAN" { return false }
        if rule.skip != nil || !rule.extensions.isEmpty { return false }
        if let wkst = rule.wkst, wkst != .monday, (rule.freq == .weekly && rule.interval > 1) || !rule.byWeekNo.isEmpty { return false }
        return true
    }

    /// The context that reads an `UNTIL` back in its own form: a date for all-day, a floating time
    /// for floating events, UTC for zoned ones.
    static func context(for rule: RRule) -> RecurrenceMapping.Context {
        switch rule.until {
        case .date?: RecurrenceMapping.Context(allDay: true, zone: nil, deviceZone: tallinn)
        case .floating?: RecurrenceMapping.Context(allDay: false, zone: nil, deviceZone: tallinn)
        default: RecurrenceMapping.Context(allDay: false, zone: tallinn, deviceZone: tallinn)
        }
    }

    /// The rule as it comes back: EventKit stores no week start (it always uses Monday) and no
    /// `RSCALE=GREGORIAN`.
    static func expectedBack(_ rule: RRule) -> RRule {
        var expected = rule
        expected.wkst = nil
        expected.rscale = nil
        return expected
    }

    @Test func everyFixtureRRuleRoundTrips() throws {
        let cases = try TestResources.eventsSection("rrules")
        #expect(cases.count == 101)
        var representable = 0
        var refused = 0
        for (index, item) in cases.enumerated() {
            guard item["parsed"] is [String: Any], let text = item["text"] as? String else { continue }
            let rule = try RRule(text: text)
            let context = Self.context(for: rule)
            if Self.isRepresentable(rule) {
                let ekRule = try RecurrenceMapping.ekRule(rule, context: context)
                let back = try RecurrenceMapping.rrule(ekRule, context: context)
                #expect(back == Self.expectedBack(rule), "rrules[\(index)] \(text): came back as \(back.text)")
                representable += 1
            } else {
                #expect(throws: RecurrenceMapping.Unrepresentable.self, "rrules[\(index)] \(text)") {
                    try RecurrenceMapping.ekRule(rule, context: context)
                }
                refused += 1
            }
        }
        // Every parseable case is either mapped or refused; the counts pin the split.
        #expect(representable + refused == cases.filter { $0["parsed"] is [String: Any] }.count)
        #expect(representable >= 40)
    }

    @Test func thirteenMonthEncodingsRoundTrip() throws {
        let cases = try TestResources.eventsSection("thirteenRules")
        #expect(cases.count == 91)
        var forms: [String: Int] = [:]
        for (index, item) in cases.enumerated() {
            let encoding = try #require(item["encoding"] as? [String: Any])
            let text = try #require(encoding["rrule"] as? String)
            let form = try #require(encoding["form"] as? String)
            forms[form, default: 0] += 1
            let rule = try RRule(text: text)
            // All-day, as the 13-month repeats in the mockup data set; the cap of form (c) is a date.
            let context = RecurrenceMapping.Context(allDay: true, zone: nil, deviceZone: Self.tallinn)
            let ekRule = try RecurrenceMapping.ekRule(rule, context: context)
            #expect(ekRule.frequency == .yearly, "thirteenRules[\(index)]")
            let back = try RecurrenceMapping.rrule(ekRule, context: context)
            #expect(back == rule, "thirteenRules[\(index)] \(text): came back as \(back.text)")
            switch form {
            case "byyearday":
                #expect(ekRule.daysOfTheYear?.map(\.intValue) == rule.byYearDay)
                #expect(ekRule.interval == 1)
            case "leap-interval":
                #expect(ekRule.interval == 4)
                #expect(ekRule.recurrenceEnd?.endDate != nil)
            default:
                #expect(ekRule.daysOfTheYear == nil && ekRule.interval == 1)
            }
        }
        #expect(forms == ["byyearday": 76, "gregorian-yearly": 10, "leap-interval": 5])
    }

    /// §4.4 Ends: an until day ends at 23:59:59 in the event's zone (the device's zone for a floating
    /// or all-day event); a count is an occurrence count.
    @Test func endsAreWrittenAsTheLastSecondOfTheDay() throws {
        let rule = try RRule(text: "FREQ=WEEKLY;UNTIL=20261116")
        let zoned = try RecurrenceMapping.end(rule, context: .init(allDay: false, zone: "America/New_York", deviceZone: Self.tallinn))
        // 2026-11-16 23:59:59 in New York (EST, UTC-5) = 2026-11-17 04:59:59Z.
        #expect(zoned?.endDate == Date(timeIntervalSince1970: 1_794_891_599))
        let allDay = try RecurrenceMapping.end(rule, context: .init(allDay: true, zone: nil, deviceZone: Self.tallinn))
        // 2026-11-16 23:59:59 in Tallinn (EET, UTC+2) = 21:59:59Z.
        #expect(allDay?.endDate == Date(timeIntervalSince1970: 1_794_866_399))
        let count = try RecurrenceMapping.end(try RRule(text: "FREQ=DAILY;COUNT=10"), context: .init(allDay: false, zone: Self.tallinn))
        #expect(count?.occurrenceCount == 10 && count?.endDate == nil)
    }

    /// All-day ends read back on their day in every zone (pinned by EventKitRoundTripTests): EventKit
    /// returns a stored `UNTIL=20960617` as 2096-06-17 23:59:59 UTC, and an end not stored yet is the
    /// date of the instant in the device's zone, which is also the date EventKit stores.
    @Test(arguments: ["Europe/Tallinn", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"])
    func allDayEndsReadBackOnTheirDay(_ zone: String) throws {
        let context = RecurrenceMapping.Context(allDay: true, zone: nil, deviceZone: zone)
        let day = try GregorianDate(isoString: "2096-06-17")
        let stored = EventInstants.date(utc: try LocalDateTime(date: day, minute: 1439), seconds: 59)
        #expect(RecurrenceMapping.untilValue(stored, context: context) == .date(day))
        let rule = try RRule(text: "FREQ=YEARLY;INTERVAL=4;UNTIL=20960617")
        let written = try #require(try RecurrenceMapping.end(rule, context: context)?.endDate)
        #expect(EventInstants.localDate(written, zone: zone) == day)
        #expect(RecurrenceMapping.untilValue(written, context: context) == .date(day))
    }

    /// EventKit reports Monday (2) as the week start of every rule it makes; that reads as no `WKST`.
    @Test func weekStartMondayReadsAsDefault() throws {
        let ekRule = try RecurrenceMapping.ekRule(try RRule(text: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU"), context: .init(allDay: false, zone: Self.tallinn))
        #expect(ekRule.firstDayOfTheWeek == 2 || ekRule.firstDayOfTheWeek == 0)
        #expect(try RecurrenceMapping.rrule(ekRule, context: .init(allDay: false, zone: Self.tallinn)).wkst == nil)
        #expect(throws: RecurrenceMapping.Unrepresentable.self) {
            try RecurrenceMapping.ekRule(try RRule(text: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;WKST=SU"), context: .init(allDay: false, zone: Self.tallinn))
        }
    }

    /// EKWeekday is the core weekday + 1, and `weekNumber` is the ordinal (0 = none).
    @Test func weekdaysAndOrdinals() throws {
        let ekRule = try RecurrenceMapping.ekRule(try RRule(text: "FREQ=MONTHLY;BYDAY=-1FR,2TU,SU"), context: .init(allDay: false, zone: Self.tallinn))
        let days = try #require(ekRule.daysOfTheWeek)
        #expect(days.map(\.dayOfTheWeek) == [.friday, .tuesday, .sunday])
        #expect(days.map(\.weekNumber) == [-1, 2, 0])
    }
}
