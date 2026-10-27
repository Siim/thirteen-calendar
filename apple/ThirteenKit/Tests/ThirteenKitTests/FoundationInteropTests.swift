import Foundation
import Testing
import ThirteenKit

/// SPEC §1.5: `GregorianDate(date:calendar:)` reads the local wall-clock date; `date(in:)` returns the
/// first local instant of the day, or `nil` when the zone skipped the whole calendar day.
@Suite("Foundation Date interop (local time)")
struct FoundationInteropTests {
    static func zone(_ identifier: String) -> TimeZone { TimeZone(identifier: identifier)! }

    static func calendar(_ zone: TimeZone, _ identifier: Calendar.Identifier = .gregorian) -> Calendar {
        var calendar = Calendar(identifier: identifier)
        calendar.timeZone = zone
        return calendar
    }

    static func days(of year: Int) throws -> [GregorianDate] {
        try (1...GregorianDate.daysInYear(year)).map { try GregorianDate(year: year, dayOfYear: $0) }
    }

    struct SkippedDay: Sendable, CustomTestStringConvertible {
        let zone: String
        let missing: String
        let before: String
        let after: String
        var testDescription: String { "\(zone) \(missing)" }
    }

    static let skipped = [
        SkippedDay(zone: "Pacific/Apia", missing: "2011-12-30", before: "2011-12-29", after: "2011-12-31"),
        SkippedDay(zone: "Pacific/Kiritimati", missing: "1994-12-31", before: "1994-12-30", after: "1995-01-01"),
        SkippedDay(zone: "Pacific/Kwajalein", missing: "1993-08-21", before: "1993-08-20", after: "1993-08-22"),
    ]

    @Test("a day the zone skipped entirely does not exist locally: nil, never a neighbouring day", arguments: skipped)
    func skippedWholeDay(_ s: SkippedDay) throws {
        let calendar = Self.calendar(Self.zone(s.zone))
        let before = try GregorianDate(isoString: s.before)
        let after = try GregorianDate(isoString: s.after)
        let missing = try GregorianDate(isoString: s.missing)
        // Guard: the zone really is active (the neighbours exist and are one real day apart).
        let beforeInstant = try #require(before.date(in: calendar))
        let afterInstant = try #require(after.date(in: calendar))
        #expect(afterInstant.timeIntervalSince(beforeInstant) == 86_400)
        #expect(missing.date(in: calendar) == nil)
        #expect(missing.date(timeZone: calendar.timeZone) == nil)
        #expect(try GregorianDate(date: beforeInstant, calendar: calendar) == before)
        #expect(try GregorianDate(date: afterInstant, calendar: calendar) == after)

        // Every other day of the transition year round-trips, with the right real weekday.
        for date in try Self.days(of: missing.year) where date != missing {
            let instant = try #require(date.date(in: calendar), "\(date)")
            #expect(try GregorianDate(date: instant, calendar: calendar) == date, "\(date)")
            #expect(calendar.component(.weekday, from: instant) - 1 == date.weekday.rawValue, "\(date)")
        }
    }

    @Test(
        "when only local midnight is skipped (DST at 00:00) the first existing instant (01:00) is returned",
        arguments: [("America/Sao_Paulo", "2018-11-04"), ("America/Havana", "2024-03-10")])
    func skippedMidnight(zone: String, iso: String) throws {
        let calendar = Self.calendar(Self.zone(zone))
        let date = try GregorianDate(isoString: iso)
        let instant = try #require(date.date(in: calendar))
        #expect(try GregorianDate(date: instant, calendar: calendar) == date)
        #expect(calendar.component(.hour, from: instant) == 1)
        #expect(calendar.component(.minute, from: instant) == 0)
        // Nothing earlier on that day exists.
        #expect(try GregorianDate(date: instant.addingTimeInterval(-1), calendar: calendar) != date)
    }

    @Test("when midnight occurs twice (DST ends at 01:00 → 00:00) the earlier midnight is returned")
    func repeatedMidnight() throws {
        let calendar = Self.calendar(Self.zone("America/Havana"))
        let date = try GregorianDate(isoString: "2024-11-03")
        let instant = try #require(date.date(in: calendar))
        // 00:00 CDT (UTC−4) = 04:00Z, one hour before the repeated 00:00 CST.
        #expect(instant == ISO8601DateFormatter().date(from: "2024-11-03T04:00:00Z"))
        #expect(try GregorianDate(date: instant.addingTimeInterval(-1), calendar: calendar) != date)
    }

    @Test("UTC: midnight for every day of a leap year, and for years 1…99 and 9999")
    func utc() throws {
        let utc = Self.calendar(TimeZone(identifier: "UTC")!)
        var days = try Self.days(of: 2024)
        days += try [1, 4, 99, 100, 1582, 1600, 9999].flatMap { year in
            try [GregorianDate(year: year, month: 1, day: 1), GregorianDate(year: year, month: 12, day: 31)]
        }
        for date in days {
            let instant = try #require(date.date(in: utc))
            #expect(instant.timeIntervalSince1970 == Double((date.julianDayNumber - 2_440_588) * 86_400), "\(date)")
            #expect(try GregorianDate(date: instant, calendar: utc) == date, "\(date)")
            #expect(try GregorianDate(date: instant.addingTimeInterval(86_399.999), calendar: utc) == date, "\(date)")
        }
    }

    @Test("round-trips every day of 2024 and 2026 in DST and fractional-offset zones")
    func roundTrips() throws {
        let zones = ["America/New_York", "Europe/Tallinn", "Australia/Lord_Howe", "Asia/Kolkata", "Asia/Kathmandu", "America/St_Johns", "Pacific/Chatham"]
        for identifier in zones {
            let calendar = Self.calendar(Self.zone(identifier))
            for date in try Self.days(of: 2024) + Self.days(of: 2026) {
                let instant = try #require(date.date(in: calendar), "\(identifier) \(date)")
                #expect(try GregorianDate(date: instant, calendar: calendar) == date, "\(identifier) \(date)")
                #expect(try GregorianDate(date: instant.addingTimeInterval(-1), calendar: calendar) != date, "\(identifier) \(date)")
                // Agrees with Foundation's own start of day in the Gregorian era Foundation supports.
                #expect(instant == calendar.startOfDay(for: instant), "\(identifier) \(date)")
            }
        }
    }

    @Test("reads the local wall-clock date regardless of the time of day")
    func localDate() throws {
        let instant = ISO8601DateFormatter().date(from: "2026-10-19T23:30:00Z")!
        #expect(try GregorianDate(date: instant, timeZone: TimeZone(identifier: "UTC")!).isoString == "2026-10-19")
        #expect(try GregorianDate(date: instant, timeZone: Self.zone("Europe/Tallinn")).isoString == "2026-10-20")
        #expect(try GregorianDate(date: instant, timeZone: Self.zone("America/Los_Angeles")).isoString == "2026-10-19")
        #expect(try GregorianDate(date: instant, calendar: Self.calendar(Self.zone("Asia/Tokyo"))).isoString == "2026-10-20")
    }

    @Test("only the calendar's time zone is used: proleptic Gregorian for any calendar identifier and before 1582")
    func prolepticGregorian() throws {
        let tokyo = Self.zone("Asia/Tokyo")
        let instant = try #require(try GregorianDate(isoString: "2026-10-19").date(timeZone: tokyo))
        for identifier in [Calendar.Identifier.japanese, .buddhist, .hebrew, .islamicUmmAlQura, .persian] {
            #expect(try GregorianDate(date: instant, calendar: Self.calendar(tokyo, identifier)).isoString == "2026-10-19")
            #expect(try GregorianDate(isoString: "2026-10-19").date(in: Self.calendar(tokyo, identifier)) == instant)
        }
        // 1582-10-04 (Julian) was followed by 1582-10-15; proleptically 1582-10-05…14 exist.
        let utc = Self.calendar(TimeZone(identifier: "UTC")!)
        let october10 = try GregorianDate(isoString: "1582-10-10")
        let tenth = try #require(october10.date(in: utc))
        #expect(try GregorianDate(date: tenth, calendar: utc) == october10)
        #expect(try GregorianDate(date: tenth.addingTimeInterval(86_400), calendar: utc).isoString == "1582-10-11")
        #expect(try GregorianDate(date: Date(timeIntervalSince1970: -62_135_596_800), calendar: utc).isoString == "0001-01-01")
    }

    @Test("rejects non-finite instants and local dates outside years 1…9999")
    func outOfRange() throws {
        let utc = TimeZone(identifier: "UTC")!
        for interval in [Double.nan, .infinity, -.infinity, 1e300, -62_135_596_801, 253_402_300_800] {
            let date = Date(timeIntervalSince1970: interval)
            #expect(throws: ThirteenError.self, "\(interval)") { try GregorianDate(date: date, timeZone: utc) }
        }
        #expect(throws: ThirteenError.self) { try GregorianDate(date: .distantPast, timeZone: utc) }
        #expect(try GregorianDate(date: .distantFuture, timeZone: utc).isoString == "4001-01-01")
        #expect(try GregorianDate(date: Date(timeIntervalSince1970: 253_402_300_799), timeZone: utc).isoString == "9999-12-31")
    }

    @Test("today() is the current local date")
    func today() throws {
        let calendar = Calendar.current
        let before = try GregorianDate(date: Date(), calendar: calendar)
        let today = GregorianDate.today()
        let after = try GregorianDate(date: Date(), calendar: calendar)
        #expect(today == before || today == after)
        #expect(GregorianDate.supportedYears.contains(today.year))
        #expect(GregorianDate.today(calendar: Self.calendar(TimeZone(identifier: "UTC")!)).year >= 2026)
    }
}
