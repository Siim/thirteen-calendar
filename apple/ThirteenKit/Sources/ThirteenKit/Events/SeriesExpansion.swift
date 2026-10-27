// The series pipeline (docs/EVENTS.md §4.6, §5.2), mirroring `packages/core/src/events/occurrences.ts`:
// `SeriesExpansion.expand` turns one stored series (its master, recurrence and overrides) into the
// occurrences a device shows in a window of its own wall clock. Apple displays EventKit's own
// expansion; the pipeline is ported so the four engines stay identical (§5.7).

/// One stored override (changed or canceled occurrence) of a series, whatever its date.
/// TS: `OverrideInput`.
public struct OverrideInput: Sendable, Hashable {
    /// The platform's handle.
    public var id: String
    /// `RECURRENCE-ID` / `ORIGINAL_INSTANCE_TIME` date in the series' zone.
    public var originalDate: GregorianDate
    /// `nil`: at the master's start time; else an extra date's own time.
    public var originalMinute: Int?
    public var canceled: Bool
    public var allDay: Bool
    /// In `zone`, end-of-day form.
    public var start: LocalDateTime
    public var end: LocalDateTime
    /// `nil`: floating.
    public var zone: String?

    public init(
        id: String, originalDate: GregorianDate, originalMinute: Int? = nil, canceled: Bool = false, allDay: Bool,
        start: LocalDateTime, end: LocalDateTime, zone: String?
    ) {
        self.id = id
        self.originalDate = originalDate
        self.originalMinute = originalMinute
        self.canceled = canceled
        self.allDay = allDay
        self.start = start
        self.end = end
        self.zone = zone
    }
}

/// A nominal length given as an RFC 5545 `DURATION` with days (§5.4).
public struct SeriesDuration: Sendable, Hashable, Codable {
    public var days: Int
    public var minutes: Int

    public init(days: Int, minutes: Int) {
        self.days = days
        self.minutes = minutes
    }
}

/// A stored series: its master, recurrence and every override. TS: `SeriesInput`.
public struct SeriesInput: Sendable, Hashable {
    public var id: String
    /// `nil`: a single event (still converted and windowed).
    public var recurrence: EventRecurrence?
    public var allDay: Bool
    /// The master, in `zone`.
    public var start: LocalDateTime
    public var end: LocalDateTime
    public var zone: String?
    /// All of them, whatever their dates.
    public var overrides: [OverrideInput]
    /// The master's length when RFC 5545 text gives it as `DURATION`: every timed occurrence ends
    /// `days` days after its start on the wall clock of the series' zone, then `minutes` later
    /// exactly. `nil`: every occurrence lasts the master's exact length. Ignored for all-day series
    /// and extra dates with their own length.
    public var duration: SeriesDuration?

    public init(
        id: String, recurrence: EventRecurrence?, allDay: Bool, start: LocalDateTime, end: LocalDateTime, zone: String?,
        overrides: [OverrideInput] = [], duration: SeriesDuration? = nil
    ) {
        self.id = id
        self.recurrence = recurrence
        self.allDay = allDay
        self.start = start
        self.end = end
        self.zone = zone
        self.overrides = overrides
        self.duration = duration
    }
}

/// One occurrence in the device's wall clock. TS: `ExpandedOccurrence`.
public struct ExpandedOccurrence: Sendable, Hashable {
    /// Part of the occurrence key (§3.2).
    public let originalDate: GregorianDate
    /// As in ``OverrideInput``; part of the key when not nil.
    public let originalMinute: Int?
    public let overrideID: String?
    public let allDay: Bool
    /// DEVICE wall clock, end-of-day form.
    public let start: LocalDateTime
    public let end: LocalDateTime
    /// The start instant as a UTC wall clock for a timed occurrence (pass it to
    /// ``Alarm/fireTime(allDay:start:startUtc:deviceZone:zones:)``); `nil` for an all-day one.
    public let startUtc: LocalDateTime?
}

/// A window of the device's wall clock, `[from, to)`; `to` may be `9999-12-31T24:00`. TS: `DeviceWindow`.
public struct DeviceWindow: Sendable, Hashable {
    public var from: LocalDateTime
    public var to: LocalDateTime

    public init(from: LocalDateTime, to: LocalDateTime) {
        self.from = from
        self.to = to
    }
}

/// The result of ``expand(_:window:deviceZone:zones:limit:)``.
public struct SeriesExpansion: Sendable, Hashable {
    public let occurrences: [ExpandedOccurrence]
    /// Override ids whose occurrence the recurrence does not produce, or that were a second
    /// override of one occurrence.
    public let orphans: [String]
    /// Occurrences dropped because they leave years 1 to 9999.
    public let outOfRange: Int
    public let truncated: Bool
    public let unsupported: Bool

    /// Expands one series into the occurrences that overlap a window of the device's wall clock
    /// (§4.6), in six steps: widen the event-zone dates (the longest length in days + 2 before, 2
    /// after); expand the recurrence; place each original date at the master's start minute (or the
    /// extra date's own) through ``ZoneMath`` in the event's zone (floating: the device's), lasting
    /// the master's exact length (or `duration`'s days on the wall clock plus its minutes); match
    /// overrides by original date and minute (canceled ones remove their occurrence, orphans are
    /// shown alone and reported); convert to the device's wall clock, dropping and counting
    /// occurrences outside years 1 to 9999; keep those that overlap `[from, to)`, sorted by start,
    /// then original date and minute. TS: `expandSeries`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` or ``ThirteenError/invalidRule(_:)`` for an
    ///   invalid series, window, zone or limit, or the resolver's own error.
    public static func expand(
        _ series: SeriesInput, window: DeviceWindow, deviceZone: String, zones: any ZoneResolver, limit: Int = 10_000
    ) throws(ThirteenError) -> SeriesExpansion {
        try ZoneMath.checkZone(deviceZone, zones)
        try series.validate(zones)
        guard window.to >= window.from else { throw .invalidEvent("Device window ends before it starts") }
        guard (1...EventTime.maxInt).contains(limit) else {
            throw .invalidEvent("expandSeries option 'limit' must be an integer 1..\(EventTime.maxInt), got \(limit)")
        }
        var pipeline = try SeriesPipeline(series, window: window, deviceZone: deviceZone, zones: zones, limit: limit)
        return try pipeline.run()
    }
}

extension SeriesInput {
    func validate(_ zones: any ZoneResolver) throws(ThirteenError) {
        func times(_ start: LocalDateTime, _ end: LocalDateTime, _ context: String) throws(ThirteenError) {
            try start.requirePlain("\(context) start")
            if end < start { throw .invalidEvent("Invalid \(context): the end is before the start") }
        }
        func knownZone(_ value: String?, _ context: String) throws(ThirteenError) {
            guard let value else { return }
            do {
                try ZoneMath.checkZone(value, zones)
            } catch {
                throw .invalidEvent("\(context): \(error.description)")
            }
        }
        try recurrence?.validate()
        try times(start, end, "series")
        try knownZone(zone, "series zone")
        for o in overrides {
            if let minute = o.originalMinute, !(0..<EventTime.day).contains(minute) {
                throw .invalidEvent("Override originalMinute must be 0..1439 or null, got \(minute)")
            }
            try times(o.start, o.end, "override \(Calc.quoted(o.id))")
            try knownZone(o.zone, "override \(Calc.quoted(o.id)) zone")
        }
        if let duration {
            let maxDays = 3_652_059
            guard (0...maxDays).contains(duration.days), (0...(maxDays * EventTime.day)).contains(duration.minutes) else {
                throw .invalidEvent(
                    "Series duration must be { days: 0..\(maxDays), minutes: 0..\(maxDays * EventTime.day) } or null, got \(duration)")
            }
        }
    }
}

/// Reads every own minute of a series as the occurrence it names (§4.6 steps 3 and 4): `nil` (the
/// master's) when it is the master's start minute or names the same instant as the master's start
/// time on that date; the extra date's own minute when it names that extra date's instant; else
/// the minute itself. An all-day series has no own minutes.
private final class OwnMinutes {
    private var own: [Int: [Int]] = [:]
    private let instant: (Int) throws(ThirteenError) -> Int
    private let allDay: Bool
    private let startMinute: Int

    init(allDay: Bool, startMinute: Int, instant: @escaping (Int) throws(ThirteenError) -> Int) {
        self.allDay = allDay
        self.startMinute = startMinute
        self.instant = instant
    }

    /// The minute an extra date's own minute stands for; a new own minute is remembered.
    func extra(_ day: Int, _ minute: Int?) throws(ThirteenError) -> Int? {
        let value = try read(day, minute)
        if let value {
            if own[day] == nil {
                own[day] = [value]
            } else if !own[day]!.contains(value) {
                own[day]!.append(value)
            }
        }
        return value
    }

    /// The minute an excluded date's or override's own minute stands for.
    func read(_ day: Int, _ minute: Int?) throws(ThirteenError) -> Int? {
        guard !allDay, let minute, minute != startMinute else { return nil }
        let at = try instant(day * EventTime.day + minute)
        if at == (try instant(day * EventTime.day + startMinute)) { return nil }
        for value in own[day] ?? [] {
            if value == minute { return value }
            if at == (try instant(day * EventTime.day + value)) { return value }
        }
        return minute
    }
}

/// A placed occurrence, in absolute device minutes (`utc`: its start instant; nil for all-day).
private struct Placed {
    let day: Int
    let minute: Int?
    let overrideID: String?
    let allDay: Bool
    let start: Int
    let end: Int
    let utc: Int?
    /// Insertion order: the sort below is stable, as JavaScript's is.
    let index: Int
}

/// One run of the pipeline.
private struct SeriesPipeline {
    let series: SeriesInput
    let windowFrom: Int
    let windowTo: Int
    let window: DeviceWindow
    let deviceZone: String
    let zones: any ZoneResolver
    let limit: Int
    let allDay: Bool
    let startMinute: Int
    let masterDays: Int
    let masterLength: Int
    let nominal: SeriesDuration?
    let eventZone: String
    let eventMemo: OffsetMemo
    let deviceMemo: OffsetMemo
    var orphans: [String] = []
    var outOfRange = 0
    var placed: [Placed] = []

    init(_ series: SeriesInput, window: DeviceWindow, deviceZone: String, zones: any ZoneResolver, limit: Int) throws(ThirteenError) {
        self.series = series
        self.window = window
        windowFrom = window.from.absoluteMinutes
        windowTo = window.to.absoluteMinutes
        self.deviceZone = deviceZone
        self.zones = zones
        self.limit = limit
        allDay = series.allDay
        startMinute = series.allDay ? 0 : series.start.minute
        let masterStart = series.start.absoluteMinutes
        let masterEnd = series.end.absoluteMinutes
        eventZone = series.zone ?? deviceZone
        // All-day: whole days, at least one. Timed: the exact length between the two instants (§3.3).
        masterDays = max(1, Civil.ceilDiv(masterEnd - masterStart, EventTime.day))
        masterLength =
            series.allDay
            ? masterDays * EventTime.day
            : max(0, try ZoneMath.toUtc(masterEnd, eventZone, zones) - (try ZoneMath.toUtc(masterStart, eventZone, zones)))
        nominal = series.allDay ? nil : series.duration
        eventMemo = OffsetMemo(zone: eventZone)
        deviceMemo = eventZone == deviceZone ? eventMemo : OffsetMemo(zone: deviceZone)
    }

    // MARK: Placing (steps 3, 5 and 6)

    /// Keeps an occurrence given in device minutes when it overlaps the window, or counts it as out
    /// of range; the end stops at 9999-12-31T24:00.
    mutating func keep(_ day: Int, _ minute: Int?, _ overrideID: String?, _ utc: Int?, _ start: Int, _ rawEnd: Int) {
        if start < EventTime.minAbsolute || start >= EventTime.maxEndAbsolute {
            outOfRange += 1
            return
        }
        let end = min(max(rawEnd, start), EventTime.maxEndAbsolute)
        let inWindow = start == end ? start >= windowFrom && start < windowTo : start < windowTo && end > windowFrom
        if inWindow {
            placed.append(
                Placed(
                    day: day, minute: minute, overrideID: overrideID, allDay: utc == nil, start: start, end: end, utc: utc,
                    index: placed.count))
        }
    }

    /// `true` (counted in `outOfRange`) when a timed occurrence's instant leaves years 1 to 9999.
    mutating func instantOutOfRange(_ utcStart: Int) -> Bool {
        if utcStart >= EventTime.minAbsolute && utcStart < EventTime.maxEndAbsolute { return false }
        outOfRange += 1
        return true
    }

    /// Keeps an occurrence that starts at a UTC instant and lasts `length` minutes, in the device's
    /// wall clock (the device zone is asked before the range check, as for any other occurrence).
    mutating func keepInstant(_ day: Int, _ minute: Int?, _ overrideID: String?, _ utcStart: Int, _ length: Int, _ memo: OffsetMemo?)
        throws(ThirteenError)
    {
        let start = try ZoneMath.toZoned(utcStart, deviceZone, zones, memo)
        if instantOutOfRange(utcStart) { return }
        keep(day, minute, overrideID, utcStart, start, try ZoneMath.toZoned(utcStart + length, deviceZone, zones, memo))
    }

    /// A generated occurrence at the master's times (or the extra date's own).
    mutating func placeGenerated(_ day: Int, _ minute: Int?, _ durationMinutes: Int?) throws(ThirteenError) {
        if allDay {
            let days = durationMinutes.map { max(1, Civil.ceilDiv($0, EventTime.day)) } ?? masterDays
            keep(day, minute, nil, nil, day * EventTime.day, (day + days) * EventTime.day)
            return
        }
        let local = day * EventTime.day + (minute ?? startMinute)
        let (utc, steady) = try ZoneMath.toUtcSteady(local, eventZone, zones, eventMemo)
        var length = durationMinutes ?? masterLength
        if durationMinutes == nil, let nominal {
            // DURATION: its days on this occurrence's wall clock, then its exact minutes (RFC 5545 §3.3.6).
            let endUtc = try ZoneMath.toUtcSteady(local + nominal.days * EventTime.day, eventZone, zones, eventMemo).utc
            length = max(0, endUtc + nominal.minutes - utc)
        }
        if let steady, eventZone == deviceZone {
            if instantOutOfRange(utc) { return }
            // The offset is `steady` from `local` minus a day to `local` plus a day: no resolver call can change it.
            let end = utc + length
            keep(
                day, minute, nil, utc, local,
                end <= local + EventTime.day ? end + steady : try ZoneMath.toZoned(end, deviceZone, zones, deviceMemo))
            return
        }
        try keepInstant(day, minute, nil, utc, length, deviceMemo)
    }

    /// An override at its own times, converted from its own zone (floating: the device's).
    mutating func placeOverride(_ o: OverrideInput, _ day: Int, _ minute: Int?) throws(ThirteenError) {
        let start = o.start.absoluteMinutes
        let end = o.end.absoluteMinutes
        if o.allDay {
            keep(day, minute, o.id, nil, start, max(end, start + EventTime.day))
            return
        }
        let zone = o.zone ?? deviceZone
        let utcStart = try ZoneMath.toUtc(start, zone, zones)
        try keepInstant(day, minute, o.id, utcStart, max(0, try ZoneMath.toUtc(end, zone, zones) - utcStart), nil)
    }

    // MARK: Overrides (step 4)

    /// Matches every override to its occurrence: places the replacements and orphans, records orphan
    /// ids, and returns the keys of the generated occurrences the overrides took.
    mutating func applyOverrides(
        _ overrides: [OverrideInput], _ generated: Set<Int>, _ produced: (Int, Int?) throws(ThirteenError) -> Bool
    ) throws(ThirteenError) -> Set<Int> {
        var taken = Set<Int>()
        var claimed = Set<Int>()
        for o in overrides {
            let minute = allDay || o.originalMinute == startMinute ? nil : o.originalMinute
            let day = o.originalDate.julianDayNumber
            let k = occurrenceKey(day, minute)
            if claimed.contains(k) {
                orphans.append(o.id)
                continue
            }
            if !(try produced(day, minute)) {
                orphans.append(o.id)
                if !o.canceled { try placeOverride(o, day, minute) }
                continue
            }
            claimed.insert(k)
            if generated.contains(k) { taken.insert(k) }
            if !o.canceled { try placeOverride(o, day, minute) }
        }
        return taken
    }

    // MARK: Run

    mutating func run() throws(ThirteenError) -> SeriesExpansion {
        let eventZone = self.eventZone
        let zones = self.zones
        let memo = eventMemo
        let ownMinutes = OwnMinutes(allDay: allDay, startMinute: startMinute) { (local: Int) throws(ThirteenError) -> Int in
            try ZoneMath.toUtcSteady(local, eventZone, zones, memo).utc
        }
        var recurrence = series.recurrence
        if var normalized = recurrence {
            var extras: [ExtraDate] = []
            for x in normalized.extraDates {
                extras.append(ExtraDate(date: x.date, minute: try ownMinutes.extra(x.date.julianDayNumber, x.minute), durationMinutes: x.durationMinutes))
            }
            var excepts: [OriginalDate] = []
            for x in normalized.exceptDates {
                excepts.append(OriginalDate(date: x.date, minute: try ownMinutes.read(x.date.julianDayNumber, x.minute)))
            }
            normalized.extraDates = extras
            normalized.exceptDates = excepts
            recurrence = normalized
        }
        var overrides: [OverrideInput] = []
        for o in series.overrides {
            var copy = o
            copy.originalMinute = try ownMinutes.read(o.originalDate.julianDayNumber, o.originalMinute)
            overrides.append(copy)
        }
        let checkMinute: Int? = allDay ? nil : startMinute
        let startDay = series.start.date.julianDayNumber
        var truncated = false
        var unsupported = false

        if let recurrence {
            let longest = max(masterLength, recurrence.extraDates.map { $0.durationMinutes ?? 0 }.max() ?? 0)
            let widen = Civil.ceilDiv(longest, EventTime.day) + 2
            let from = max(window.from.date.julianDayNumber - widen, GregorianDate.minJulianDayNumber)
            let to = min(window.to.date.julianDayNumber + 2, GregorianDate.maxJulianDayNumber)
            let expansion = recurrence.expandDays(start: series.start.date, from: from, to: to, limit: limit, startMinute: checkMinute)
            truncated = expansion.truncated
            unsupported = expansion.unsupported
            if unsupported {
                for o in expansion.occurrences { try placeGenerated(o.day, nil, nil) }
            } else if overrides.isEmpty {
                for o in expansion.occurrences { try placeGenerated(o.day, o.minute, o.durationMinutes) }
            } else {
                var generated: [Int: DayOccurrence] = [:]
                var order: [Int] = []
                for o in expansion.occurrences {
                    let k = occurrenceKey(o.day, o.minute)
                    if generated[k] == nil { order.append(k) }
                    generated[k] = o
                }
                let start = series.start.date
                let limit = self.limit
                let taken = try applyOverrides(overrides, Set(order)) { (day: Int, minute: Int?) throws(ThirteenError) -> Bool in
                    if generated[occurrenceKey(day, minute)] != nil { return true }
                    return recurrence.expandDays(start: start, from: day, to: day, limit: limit, startMinute: checkMinute)
                        .occurrences.contains { $0.minute == minute }
                }
                for k in order where !taken.contains(k) {
                    let o = generated[k]!
                    try placeGenerated(o.day, o.minute, o.durationMinutes)
                }
            }
        } else {
            let key = occurrenceKey(startDay, nil)
            let taken = try applyOverrides(overrides, [key]) { (day: Int, minute: Int?) throws(ThirteenError) -> Bool in
                day == startDay && minute == nil
            }
            if !taken.contains(key) { try placeGenerated(startDay, nil, nil) }
        }

        placed.sort { a, b in
            if a.start != b.start { return a.start < b.start }
            if a.day != b.day { return a.day < b.day }
            if (a.minute ?? -1) != (b.minute ?? -1) { return (a.minute ?? -1) < (b.minute ?? -1) }
            return a.index < b.index
        }
        let occurrences = placed.map { o -> ExpandedOccurrence in
            let startDate = Calc.floorDiv(o.start, EventTime.day)
            let endsAtMidnight = o.end > o.start && o.end % EventTime.day == 0
            let endDate = endsAtMidnight ? o.end / EventTime.day - 1 : Calc.floorDiv(o.end, EventTime.day)
            return ExpandedOccurrence(
                originalDate: dateOf(o.day), originalMinute: o.minute, overrideID: o.overrideID, allDay: o.allDay,
                start: LocalDateTime(unchecked: dateOf(startDate), minute: o.start - startDate * EventTime.day),
                end: LocalDateTime(unchecked: dateOf(endDate), minute: endsAtMidnight ? EventTime.day : o.end - endDate * EventTime.day),
                startUtc: o.utc.flatMap { LocalDateTime.plain(absolute: $0) })
        }
        return SeriesExpansion(
            occurrences: occurrences, orphans: orphans, outOfRange: outOfRange, truncated: truncated, unsupported: unsupported)
    }
}

// MARK: - Codable (§5.5)

extension OverrideInput: Codable {
    enum CodingKeys: String, CodingKey { case id, originalDate, originalMinute, canceled, allDay, start, end, zone }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try c.decode(String.self, forKey: .id), originalDate: try c.decode(EventJSONDate.self, forKey: .originalDate).date,
            originalMinute: try c.decode(Int?.self, forKey: .originalMinute), canceled: try c.decode(Bool.self, forKey: .canceled),
            allDay: try c.decode(Bool.self, forKey: .allDay), start: try c.decode(LocalDateTime.self, forKey: .start),
            end: try c.decode(LocalDateTime.self, forKey: .end), zone: try c.decode(String?.self, forKey: .zone))
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(originalDate.isoString, forKey: .originalDate)
        try c.encode(originalMinute, forKey: .originalMinute)
        try c.encode(canceled, forKey: .canceled)
        try c.encode(allDay, forKey: .allDay)
        try c.encode(start, forKey: .start)
        try c.encode(end, forKey: .end)
        try c.encode(zone, forKey: .zone)
    }
}

extension SeriesInput: Codable {
    enum CodingKeys: String, CodingKey { case id, recurrence, allDay, start, end, zone, overrides, duration }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try c.decode(String.self, forKey: .id), recurrence: try c.decode(EventRecurrence?.self, forKey: .recurrence),
            allDay: try c.decode(Bool.self, forKey: .allDay), start: try c.decode(LocalDateTime.self, forKey: .start),
            end: try c.decode(LocalDateTime.self, forKey: .end), zone: try c.decode(String?.self, forKey: .zone),
            overrides: try c.decode([OverrideInput].self, forKey: .overrides),
            duration: try c.decodeIfPresent(SeriesDuration.self, forKey: .duration))
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(recurrence, forKey: .recurrence)
        try c.encode(allDay, forKey: .allDay)
        try c.encode(start, forKey: .start)
        try c.encode(end, forKey: .end)
        try c.encode(zone, forKey: .zone)
        try c.encode(overrides, forKey: .overrides)
        try c.encode(duration, forKey: .duration)
    }
}

extension ExpandedOccurrence: Codable {
    enum CodingKeys: String, CodingKey { case originalDate, originalMinute, overrideID = "overrideId", allDay, start, end, startUtc }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        originalDate = try c.decode(EventJSONDate.self, forKey: .originalDate).date
        originalMinute = try c.decode(Int?.self, forKey: .originalMinute)
        overrideID = try c.decode(String?.self, forKey: .overrideID)
        allDay = try c.decode(Bool.self, forKey: .allDay)
        start = try c.decode(LocalDateTime.self, forKey: .start)
        end = try c.decode(LocalDateTime.self, forKey: .end)
        startUtc = try c.decode(LocalDateTime?.self, forKey: .startUtc)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(originalDate.isoString, forKey: .originalDate)
        try c.encode(originalMinute, forKey: .originalMinute)
        try c.encode(overrideID, forKey: .overrideID)
        try c.encode(allDay, forKey: .allDay)
        try c.encode(start, forKey: .start)
        try c.encode(end, forKey: .end)
        try c.encode(startUtc, forKey: .startUtc)
    }
}

extension DeviceWindow: Codable {}
