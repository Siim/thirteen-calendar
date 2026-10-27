// Wall-clock date-times and time zones for events (docs/EVENTS.md §3.1, §3.1.1, §3.3, §5.2),
// mirroring `packages/core/src/events/time.ts`.
//
// Every event value is a wall-clock `LocalDateTime` with minute precision; the engine holds no
// time zone data. Platforms answer one question through `ZoneResolver` ("which UTC offset is in
// force at this instant?") and every conversion rule lives in `ZoneMath`, so all four engines
// agree on DST gaps, overlaps and the edges of years 1 to 9999.
//
// End-of-day form (§3.1.1): ends are exclusive. An end at `D+1 T00:00` that is later than its
// start is written `D T24:00` (minute 1440). Minute 1440 is accepted wherever a value may be an
// end; comparison treats `D T24:00` and `D+1 T00:00` as the same moment, and arithmetic never
// returns 24:00.

import Foundation

/// A wall-clock moment with minute precision. TS: `LocalDateTime` (`{date, minute}`).
///
/// `minute` is `0…1439`, or `1440` (`T24:00`) in an end value (§3.1.1). Values are valid by
/// construction. `==`, hashing and `<` are chronological on the wall clock, so `D T24:00` equals
/// `D+1 T00:00` (TS `compareLocalDateTime`). JSON: the text `"YYYY-MM-DDTHH:MM"` (§5.5).
public struct LocalDateTime: Sendable {
    public let date: GregorianDate
    /// Minutes after midnight, `0…1439`; `1440` (`T24:00`) only in an end value.
    public let minute: Int

    init(unchecked date: GregorianDate, minute: Int) {
        self.date = date
        self.minute = minute
    }

    /// Validated initializer: `minute` is `0…1440` (1440 = `T24:00`, for ends). TS: `localDateTime`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for a minute outside `0…1440`.
    public init(date: GregorianDate, minute: Int) throws(ThirteenError) {
        guard (0...EventTime.day).contains(minute) else {
            throw .invalidEvent("Minute must be an integer 0..1440 (1440 = 24:00), got \(minute)")
        }
        self.init(unchecked: date, minute: minute)
    }

    /// Parses `YYYY-MM-DDTHH:MM` (years 0001…9999, 24-hour clock, no seconds, no zone designator,
    /// no whitespace). `T24:00` is accepted (an end value); `T24:01`, `T25:00`, minutes above 59
    /// and impossible dates are not. TS: `parseLocalDateTime`; use `try?` for `tryParseLocalDateTime`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)``.
    public init(iso text: String) throws(ThirteenError) {
        let bytes = Array(text.utf8)
        guard bytes.count == 16, bytes[10] == UInt8(ascii: "T"), bytes[13] == UInt8(ascii: ":"),
            let hour = Calc.digits(bytes, 11, 2), let minute = Calc.digits(bytes, 14, 2)
        else { throw .invalidEvent("Invalid local date-time \(Calc.quoted(text)): expected YYYY-MM-DDTHH:MM") }
        let datePart = String(decoding: bytes[0..<10], as: UTF8.self)
        guard let date = try? GregorianDate(isoString: datePart) else {
            throw .invalidEvent(
                "Invalid local date-time \(Calc.quoted(text)): \(datePart) is not a date in years 0001..9999")
        }
        guard minute <= 59, hour <= 24, hour < 24 || minute == 0 else {
            throw .invalidEvent(
                "Invalid local date-time \(Calc.quoted(text)): the time must be 00:00..23:59, or 24:00 for an end")
        }
        self.init(unchecked: date, minute: hour * 60 + minute)
    }

    /// `YYYY-MM-DDTHH:MM` (`2026-10-19T09:30`; minute 1440 as `T24:00`). TS: `formatLocalDateTime`.
    public var isoString: String {
        "\(date.isoString)T\(Calc.pad(minute / 60, 2)):\(Calc.pad(minute % 60, 2))"
    }

    /// Minutes since the proleptic Julian Day epoch: `D T24:00` and `D+1 T00:00` are the same number.
    var absoluteMinutes: Int { date.julianDayNumber * EventTime.day + minute }

    /// The plain value (minute `0…1439`) at an absolute minute, or `nil` outside
    /// 0001-01-01T00:00 … 9999-12-31T23:59.
    static func plain(absolute: Int) -> LocalDateTime? {
        guard absolute >= EventTime.minAbsolute, absolute <= EventTime.maxAbsolute else { return nil }
        let jdn = Calc.floorDiv(absolute, EventTime.day)
        return LocalDateTime(unchecked: GregorianDate(uncheckedJulianDayNumber: jdn), minute: absolute - jdn * EventTime.day)
    }

    /// The end value at an absolute minute in end-of-day form: a midnight later than
    /// `start` is written as 24:00 of the day before. `nil` outside 0001-01-01T00:00 … 9999-12-31T24:00.
    static func end(absolute: Int, start: Int) -> LocalDateTime? {
        guard absolute >= EventTime.minAbsolute, absolute <= EventTime.maxEndAbsolute else { return nil }
        if absolute > start, absolute % EventTime.day == 0 {
            return LocalDateTime(
                unchecked: GregorianDate(uncheckedJulianDayNumber: absolute / EventTime.day - 1), minute: EventTime.day)
        }
        return plain(absolute: absolute)
    }

    // MARK: Wall-clock arithmetic

    /// Adds (or subtracts) minutes on the wall clock, ignoring time zones: 23:30 plus 60 minutes is
    /// 00:30 of the next day. The result is never written as 24:00. TS: `addMinutesLocal`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for a result outside
    ///   0001-01-01T00:00 … 9999-12-31T23:59.
    public func adding(minutes: Int) throws(ThirteenError) -> LocalDateTime {
        let (sum, overflow) = absoluteMinutes.addingReportingOverflow(minutes)
        guard !overflow, let result = LocalDateTime.plain(absolute: sum) else {
            throw .invalidEvent("\(isoString) plus \(minutes) minutes is outside 0001-01-01T00:00..9999-12-31T23:59")
        }
        return result
    }

    /// Wall-clock difference `self − other` in minutes (`D T24:00` counts as `D+1 T00:00`).
    /// TS: `diffMinutesLocal(a, b)` = `a.minutesSince(b)`.
    public func minutesSince(_ other: LocalDateTime) -> Int {
        absoluteMinutes - other.absoluteMinutes
    }

    // MARK: End-of-day form

    /// Writes an end in end-of-day form (§3.1.1): an end at `D+1 T00:00` that is later than the
    /// start becomes `D T24:00`; an end equal to the start (a zero-length event) is written like the
    /// start; any other end is returned as is. TS: `normalizeEventEnd`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` when `end` is before `start`, or when `start` is
    ///   24:00 (24:00 is only allowed in an end).
    public static func normalizedEnd(start: LocalDateTime, end: LocalDateTime) throws(ThirteenError) -> LocalDateTime {
        try start.requirePlain("event start")
        let startAbsolute = start.absoluteMinutes
        let endAbsolute = end.absoluteMinutes
        guard endAbsolute >= startAbsolute else {
            throw .invalidEvent("The end \(end.isoString) is before the start \(start.isoString)")
        }
        if endAbsolute == startAbsolute { return start }
        return LocalDateTime.end(absolute: endAbsolute, start: startAbsolute)!
    }

    /// The end as a date picker shows it (§2.12): `D T24:00` becomes `D+1 T00:00`, because no
    /// platform time picker can hold 24:00. Other values are returned as they are. TS: `displayEnd`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for `9999-12-31T24:00`, whose next day is outside
    ///   the supported range.
    public func displayEnd() throws(ThirteenError) -> LocalDateTime {
        guard minute == EventTime.day else { return self }
        guard let result = LocalDateTime.plain(absolute: absoluteMinutes) else {
            throw .invalidEvent("\(isoString) has no next day to display (it is the last supported end)")
        }
        return result
    }

    /// Every date an occurrence covers, `start.date` through the date of its end-of-day form,
    /// inclusive (§3.1.1). A zero-length event covers its start date; one ending at midnight does
    /// not cover the next day. TS: `occurrenceDays`.
    /// - Throws: as ``normalizedEnd(start:end:)``.
    public static func occurrenceDays(from start: LocalDateTime, to end: LocalDateTime) throws(ThirteenError)
        -> [GregorianDate]
    {
        let last = try normalizedEnd(start: start, end: end)
        return (start.date.julianDayNumber...last.date.julianDayNumber).map { GregorianDate(uncheckedJulianDayNumber: $0) }
    }

    /// Throws unless the minute is `0…1439` (24:00 is only allowed in an end).
    func requirePlain(_ context: String) throws(ThirteenError) {
        guard minute < EventTime.day else {
            throw .invalidEvent("Invalid \(context): minute must be an integer 0..1439 (24:00 is only allowed in an end), got 1440")
        }
    }
}

extension LocalDateTime: Hashable {
    public static func == (lhs: LocalDateTime, rhs: LocalDateTime) -> Bool {
        lhs.absoluteMinutes == rhs.absoluteMinutes
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(absoluteMinutes)
    }
}

extension LocalDateTime: Comparable {
    public static func < (lhs: LocalDateTime, rhs: LocalDateTime) -> Bool {
        lhs.absoluteMinutes < rhs.absoluteMinutes
    }
}

extension LocalDateTime: CustomStringConvertible {
    /// The ISO form, e.g. `"2026-10-19T09:30"`.
    public var description: String { isoString }
}

extension LocalDateTime: Codable {
    /// Decodes the text `"YYYY-MM-DDTHH:MM"` and validates it.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        let text = try c.decode(String.self)
        do {
            try self.init(iso: text)
        } catch {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: String(describing: error))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(isoString)
    }
}

/// Constants of the event engine's wall-clock arithmetic.
enum EventTime {
    /// Minutes in a day.
    static let day = 1440
    /// Absolute minute of 0001-01-01T00:00.
    static let minAbsolute = GregorianDate.minJulianDayNumber * day
    /// Absolute minute of 9999-12-31T23:59, the last plain (non-end) value.
    static let maxAbsolute = GregorianDate.maxJulianDayNumber * day + day - 1
    /// Absolute minute of 9999-12-31T24:00, the last end value.
    static let maxEndAbsolute = (GregorianDate.maxJulianDayNumber + 1) * day
    /// Largest count, interval, limit and part number: every port holds them in a 32-bit signed integer.
    static let maxInt = 2_147_483_647
}

// MARK: - Time zones

/// Answers UTC offsets for IANA zone ids (§5.2). Implemented per platform (here
/// ``FoundationZoneResolver``); every conversion rule lives in ``ZoneMath``. TS: `ZoneResolver`.
public protocol ZoneResolver: Sendable {
    /// `true` when the platform has rules for `tzid` (an IANA id such as `Europe/Tallinn`, or `UTC`).
    func isKnown(_ tzid: String) -> Bool
    /// The UTC offset in force at the UTC instant `utc`, in whole minutes east of UTC (Tallinn in
    /// summer: `180`; New York in winter: `-300`), between -1439 and 1439; offsets with seconds
    /// (local mean time) are truncated toward zero. Core only asks about instants from
    /// 0001-01-01T00:00 to 9999-12-31T23:59 UTC. TS: `offsetMinutesAt`.
    func offsetMinutes(_ tzid: String, at utc: LocalDateTime) throws(ThirteenError) -> Int
}

/// The last few offsets the resolver gave for one zone, by UTC instant, so a caller that converts
/// many nearby times asks once per instant. Results are the same as without it. Local use only.
final class OffsetMemo {
    let zone: String
    private var instants = [Int](repeating: Int.min, count: 4)
    private var offsets = [Int](repeating: 0, count: 4)
    private var slot = 0

    init(zone: String) { self.zone = zone }

    func offset(_ zones: any ZoneResolver, _ zone: String, _ absolute: Int) throws(ThirteenError) -> Int {
        guard zone == self.zone else { return try ZoneMath.offset(zones, zone, absolute) }
        for i in 0..<4 where instants[i] == absolute { return offsets[i] }
        let value = try ZoneMath.offset(zones, zone, absolute)
        instants[slot] = absolute
        offsets[slot] = value
        slot = (slot + 1) % 4
        return value
    }
}

/// Zone conversions with the gap and overlap rule of §3.3, the same on every platform.
public enum ZoneMath {
    /// Converts a wall-clock value in `zone` to UTC (§3.3, §5.2): a time inside a DST gap moves
    /// forward by the gap's length (New York 2026-03-08T02:30 is 07:30Z, which is 03:30 local), and
    /// an ambiguous time takes the earlier instant. `local` may be an end at 24:00. TS: `zonedToUtc`.
    /// - Returns: the UTC wall clock (minute `0…1439`), or `nil` when it falls outside years 1 to 9999.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for an empty or unknown zone or an invalid offset
    ///   from the resolver, or the resolver's own error.
    public static func utc(from local: LocalDateTime, zone: String, using zones: any ZoneResolver) throws(ThirteenError)
        -> LocalDateTime?
    {
        try checkZone(zone, zones)
        return LocalDateTime.plain(absolute: try toUtcSteady(local.absoluteMinutes, zone, zones, nil).utc)
    }

    /// Converts a UTC wall clock to the wall clock of `zone` (UTC plus the offset in force at that
    /// instant). `utc` may be an end at 24:00. TS: `utcToZoned`.
    /// - Returns: the zone's wall clock (minute `0…1439`), or `nil` outside years 1 to 9999.
    /// - Throws: as ``utc(from:zone:using:)``.
    public static func local(from utc: LocalDateTime, zone: String, using zones: any ZoneResolver) throws(ThirteenError)
        -> LocalDateTime?
    {
        try checkZone(zone, zones)
        return LocalDateTime.plain(absolute: try toZoned(utc.absoluteMinutes, zone, zones, nil))
    }

    /// Throws unless `zone` is a non-empty id the resolver knows.
    static func checkZone(_ zone: String, _ zones: any ZoneResolver) throws(ThirteenError) {
        guard !zone.isEmpty else { throw .invalidEvent("Time zone id must be a non-empty string, got \"\"") }
        guard zones.isKnown(zone) else { throw .invalidEvent("Unknown time zone \(Calc.quoted(zone))") }
    }

    /// The resolver's offset at an absolute UTC minute, the probe kept inside years 1 to 9999.
    static func offset(_ zones: any ZoneResolver, _ zone: String, _ absolute: Int) throws(ThirteenError) -> Int {
        let probe = LocalDateTime.plain(absolute: min(max(absolute, EventTime.minAbsolute), EventTime.maxAbsolute))!
        let value = try zones.offsetMinutes(zone, at: probe)
        guard value > -EventTime.day, value < EventTime.day else {
            throw .invalidEvent(
                "ZoneResolver.offsetMinutes(\(Calc.quoted(zone)), \(probe.isoString)) must return an integer "
                    + "number of minutes between -1439 and 1439, got \(value)")
        }
        return value
    }

    /// `zonedToUtc` on absolute minutes, without validating the zone and without the range check.
    static func toUtc(_ target: Int, _ zone: String, _ zones: any ZoneResolver) throws(ThirteenError) -> Int {
        try toUtcSteady(target, zone, zones, nil).utc
    }

    /// `zonedToUtc` on absolute minutes, also giving the offset when it is the same at both probes
    /// (`target ± 1 day`): then no transition lies between them and `utc = target − steady`.
    static func toUtcSteady(_ target: Int, _ zone: String, _ zones: any ZoneResolver, _ memo: OffsetMemo?)
        throws(ThirteenError) -> (utc: Int, steady: Int?)
    {
        func offsetAt(_ absolute: Int) throws(ThirteenError) -> Int {
            if let memo { return try memo.offset(zones, zone, absolute) }
            return try offset(zones, zone, absolute)
        }
        let before = try offsetAt(target - EventTime.day)
        let after = try offsetAt(target + EventTime.day)
        let early = target - before  // also the gap rule: local − b
        if before == after { return (early, before) }
        let late = target - after
        let earlyValid = early + (try offsetAt(early)) == target
        let lateValid = late + (try offsetAt(late)) == target
        if earlyValid && lateValid { return (min(early, late), nil) }
        return (lateValid ? late : early, nil)
    }

    /// `utcToZoned` on absolute minutes, without validating the zone and without the range check.
    static func toZoned(_ instant: Int, _ zone: String, _ zones: any ZoneResolver, _ memo: OffsetMemo?)
        throws(ThirteenError) -> Int
    {
        if let memo { return instant + (try memo.offset(zones, zone, instant)) }
        return instant + (try offset(zones, zone, instant))
    }
}
