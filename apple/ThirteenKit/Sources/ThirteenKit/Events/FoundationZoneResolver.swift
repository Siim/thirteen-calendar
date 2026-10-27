import Foundation

/// The Apple ``ZoneResolver`` (docs/EVENTS.md §5.2, §6.2): offsets from Foundation's
/// `TimeZone.secondsFromGMT(for:)`, which reads the system tzdata. It answers only offsets;
/// every conversion rule lives in ``ZoneMath``.
///
/// Offsets with seconds (local mean time before a zone adopted standard time) are truncated
/// toward zero, as every port does. `TimeZone(identifier:)` is cached per id; the resolver is a
/// value and safe to share across tasks.
public struct FoundationZoneResolver: ZoneResolver {
    public init() {}

    public func isKnown(_ tzid: String) -> Bool {
        FoundationZoneResolver.zone(tzid) != nil
    }

    public func offsetMinutes(_ tzid: String, at utc: LocalDateTime) throws(ThirteenError) -> Int {
        guard let zone = FoundationZoneResolver.zone(tzid) else {
            throw .invalidEvent("Unknown time zone \(Calc.quoted(tzid))")
        }
        let seconds = (utc.date.julianDayNumber - Calc.unixEpochJulianDayNumber) * Calc.secondsPerDay + utc.minute * 60
        let offset = zone.secondsFromGMT(for: Date(timeIntervalSince1970: TimeInterval(seconds)))
        return offset / 60  // Swift's integer division truncates toward zero
    }

    /// `TimeZone(identifier:)`, cached (an empty id is never a zone).
    private static func zone(_ tzid: String) -> TimeZone? {
        guard !tzid.isEmpty else { return nil }
        return cache.withLock { cache in
            if let cached = cache[tzid] { return cached }
            let zone = TimeZone(identifier: tzid)
            cache[tzid] = zone
            return zone
        }
    }

    private static let cache = Locked<[String: TimeZone?]>([:])
}

/// A tiny lock-protected box (Foundation's `NSLock`), for caches shared across tasks.
final class Locked<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    init(_ value: Value) { self.value = value }

    func withLock<T>(_ body: (inout Value) -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body(&value)
    }
}
