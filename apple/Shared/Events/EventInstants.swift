import Foundation
import ThirteenKit

/// Instants (`Date`) and wall clocks (`LocalDateTime`) for the calendar stores (docs/EVENTS.md §3.1.1,
/// §3.3). Every conversion uses ThirteenKit's proleptic day arithmetic and `ZoneMath`, never
/// Foundation's `.gregorian` date components (which switch to the Julian calendar before
/// 1582-10-15). Seconds are dropped when reading (minute precision).
enum EventInstants {
    /// Julian Day Number of 1970-01-01.
    static let unixEpochJulianDayNumber = 2_440_588

    /// The resolver every store uses (Foundation's tzdata, §5.2).
    static let zones = FoundationZoneResolver()

    /// The device's zone id (`TimeZone.current`).
    static var deviceZone: String { TimeZone.current.identifier }

    /// The instant as a UTC wall clock, seconds dropped; `nil` outside years 1 to 9999.
    static func utc(_ date: Date) -> LocalDateTime? {
        let interval = date.timeIntervalSince1970
        guard interval.isFinite, abs(interval) < 1e13 else { return nil }
        let seconds = Int(interval.rounded(.down))
        let minutes = floorDiv(seconds, 60)
        let days = floorDiv(minutes, 1440)
        guard let day = try? GregorianDate(julianDayNumber: unixEpochJulianDayNumber + days) else { return nil }
        return try? LocalDateTime(date: day, minute: minutes - days * 1440)
    }

    /// The instant of a UTC wall clock (an end at 24:00 is the next midnight), plus `seconds`.
    static func date(utc: LocalDateTime, seconds: Int = 0) -> Date {
        let days = utc.date.julianDayNumber - unixEpochJulianDayNumber
        return Date(timeIntervalSince1970: TimeInterval(days * 86_400 + utc.minute * 60 + seconds))
    }

    /// The wall clock of an instant in `zone`; `nil` for an unknown zone or a result outside years 1 to 9999.
    static func wallClock(_ date: Date, zone: String) -> LocalDateTime? {
        guard let utc = utc(date) else { return nil }
        return try? ZoneMath.local(from: utc, zone: zone, using: zones)
    }

    /// The instant of a wall clock in `zone` (the gap and overlap rule of §3.3), plus `seconds`;
    /// `nil` for an unknown zone or an instant outside years 1 to 9999.
    static func instant(_ local: LocalDateTime, zone: String, seconds: Int = 0) -> Date? {
        guard let utc = try? ZoneMath.utc(from: local, zone: zone, using: zones) else { return nil }
        return date(utc: utc, seconds: seconds)
    }

    /// The first local instant of `day` in `zone` (local midnight, or the first existing time when a
    /// DST change skips midnight); `nil` when the zone skipped the whole day.
    static func startOfDay(_ day: GregorianDate, zone: String) -> Date? {
        guard let timeZone = TimeZone(identifier: zone) else { return nil }
        return day.date(timeZone: timeZone)
    }

    /// The local date of an instant in `zone` (proleptic).
    static func localDate(_ date: Date, zone: String) -> GregorianDate? {
        guard let timeZone = TimeZone(identifier: zone) else { return nil }
        return try? GregorianDate(date: date, timeZone: timeZone)
    }

    // MARK: Keys

    /// `yyyy-MM-ddTHH:mm:ssZ` for an instant, proleptic (the occurrence key of §3.2). Years outside
    /// 1 to 9999 cannot occur for an event EventKit returns in a supported window; they are written
    /// with their raw seconds so a key is still unique.
    static func isoUTC(_ date: Date) -> String {
        let seconds = Int(date.timeIntervalSince1970.rounded(.down))
        guard let utc = utc(date) else { return "@\(seconds)" }
        let second = seconds - floorDiv(seconds, 60) * 60
        return "\(utc.isoString):\(second < 10 ? "0" : "")\(second)Z"
    }

    /// The instant of an ``isoUTC(_:)`` text.
    static func parseISOUTC(_ text: String) -> Date? {
        if text.hasPrefix("@"), let seconds = Int(text.dropFirst()) { return Date(timeIntervalSince1970: TimeInterval(seconds)) }
        guard text.count == 20, text.hasSuffix("Z") else { return nil }
        let minutePart = String(text.prefix(16))
        let secondPart = text.dropFirst(17).prefix(2)
        guard let local = try? LocalDateTime(iso: minutePart), let second = Int(secondPart), (0...59).contains(second) else {
            return nil
        }
        return date(utc: local, seconds: second)
    }

    private static func floorDiv(_ a: Int, _ b: Int) -> Int {
        let q = a / b
        return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q
    }
}
