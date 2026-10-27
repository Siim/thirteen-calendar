// Event recurrence (docs/EVENTS.md §4, §5.2), mirroring `packages/core/src/events/recurrence.ts`:
// the `EventRecurrence` value, its expansion into original dates (`expand(start:in:limit:)`,
// `nextOccurrences(start:count:)`), ends (`endedBefore(_:start:)`, `laterCount(start:at:)`), the
// "future events" split (`split(start:at:overrideDates:change:)`), the retime of a series'
// exceptions (`retimed(...)`) and the `RRULE` a repeat is written as (`rrule(start:)`).
// Descriptions, presets, notes and adaptation live in RecurrenceText.swift; recognition in
// Recognition.swift.
//
// Dates and minutes: a recurrence works on original dates in the event's zone. The start's time of
// day is the master's, which is why an `ExtraDate` or `OriginalDate` has a `minute` only when it
// differs from the master's start minute (`nil` stands for the master's minute). Two values are
// the same occurrence when their dates and minutes are equal.
//
// Expansion (§4.6) builds, in this order: the rule stream (the start first, then the rule's dates
// after it), the ends applied to that stream only (`COUNT` counts the start and dates that are later
// excluded), the extra dates added whatever their date (a value already produced at the same date
// and minute is not repeated), and the exclusions (`exceptDates` by date and minute; a `foreign`
// rule's `EXRULE`s remove dates at the master's minute).

// MARK: - Types (§5.2)

/// How a repeat ends: never, after `count` occurrences (counting the start), or on the last
/// occurrence on or before a date. TS: `RepeatEnd`.
public enum RepeatEnd: Sendable, Hashable {
    case never
    case count(Int)
    case until(GregorianDate)
}

/// One `RRULE` or `EXRULE` with its own end (inside a `foreign` rule); `rrule` has no `COUNT` or
/// `UNTIL`. TS: `EndedRule`.
public struct EndedRule: Sendable, Hashable {
    public var rrule: RRule
    public var end: RepeatEnd

    public init(rrule: RRule, end: RepeatEnd) {
        self.rrule = rrule
        self.end = end
    }
}

/// The rule part of a recurrence. TS: `RepeatRule`.
public enum RepeatRule: Sendable, Hashable {
    /// One Gregorian `RRULE`, without `COUNT` / `UNTIL` (they live in ``RepeatEnd``).
    case rrule(RRule)
    /// A 13-month rule (§4.2).
    case thirteen(ThirteenRule)
    /// No rule: the start plus `extraDates`.
    case dates
    /// Several `RRULE`s and/or `EXRULE`s, each with its own end; the recurrence's end is `.never`.
    case foreign(rules: [EndedRule], exrules: [EndedRule])
}

/// An `RDATE`. `minute` and `durationMinutes` nil = the master's start time and length
/// (`RDATE;VALUE=PERIOD` sets both). TS: `ExtraDate` (and `ExpandedDate`).
public struct ExtraDate: Sendable, Hashable {
    public var date: GregorianDate
    /// `0…1439`, or `nil` for the master's start minute.
    public var minute: Int?
    /// `>= 0`, or `nil` for the master's length.
    public var durationMinutes: Int?

    public init(date: GregorianDate, minute: Int? = nil, durationMinutes: Int? = nil) {
        self.date = date
        self.minute = minute
        self.durationMinutes = durationMinutes
    }
}

/// An original date, with its own time and length if it has them. TS: `ExpandedDate`.
public typealias ExpandedDate = ExtraDate

/// An original occurrence: an `EXDATE` value, a `RECURRENCE-ID` or an `ORIGINAL_INSTANCE_TIME`.
/// `minute` nil = the master's start time (or a `DATE` value); a minute = an extra date's own
/// time. Values are equal when their dates and minutes are (§4.6). TS: `OriginalDate`.
public struct OriginalDate: Sendable, Hashable {
    public var date: GregorianDate
    public var minute: Int?

    public init(date: GregorianDate, minute: Int? = nil) {
        self.date = date
        self.minute = minute
    }
}

/// A repeat: its rule, end, extra dates (`RDATE`) and removed dates (`EXDATE`). TS: `EventRecurrence`.
public struct EventRecurrence: Sendable, Hashable {
    public var rule: RepeatRule
    public var end: RepeatEnd
    /// RDATEs not explained by the rule; kept, expanded and written back.
    public var extraDates: [ExtraDate]
    /// Original occurrences removed (EXDATE).
    public var exceptDates: [OriginalDate]

    public init(rule: RepeatRule, end: RepeatEnd = .never, extraDates: [ExtraDate] = [], exceptDates: [OriginalDate] = []) {
        self.rule = rule
        self.end = end
        self.extraDates = extraDates
        self.exceptDates = exceptDates
    }
}

/// A window of original dates, both ends inclusive. TS: `ExpansionWindow`.
public struct ExpansionWindow: Sendable, Hashable {
    public var from: GregorianDate
    public var to: GregorianDate

    public init(from: GregorianDate, to: GregorianDate) {
        self.from = from
        self.to = to
    }
}

/// The result of ``EventRecurrence/expand(start:in:limit:)``. TS: `Expansion`.
public struct Expansion: Sendable, Hashable {
    /// Ascending by date, then by minute (the master's time first), without duplicates.
    public let occurrences: [ExpandedDate]
    /// The `limit` was reached, the calendar-time guard stopped a rule, or the rule can never match.
    public let truncated: Bool
    /// The rule cannot be expanded (§4.6 step 6): `occurrences` holds only the start when the window holds it.
    public let unsupported: Bool
}

/// Where an exception (an `EXDATE` or an override's original) goes: `to` nil means it is dropped.
/// TS: `ExceptionMap`.
public struct ExceptionMap: Sendable, Hashable {
    public let from: OriginalDate
    public let to: OriginalDate?
}

/// The result of ``EventRecurrence/split(start:at:overrideDates:change:)`` (§4.7). TS: `SplitResult`.
public struct SplitResult: Sendable, Hashable {
    /// The series before `at`; `nil` when `at` is the first occurrence.
    public let head: EventRecurrence?
    /// The series from `at`; `nil` for "Delete all future events" (and when the repeat becomes Never).
    public let tail: EventRecurrence?
    /// Every override original on or after `at` (except the edited occurrence's own), mapped into the tail.
    public let overrides: [ExceptionMap]
    /// Exceptions and extra dates on or after `at` that the tail does not keep.
    public let droppedCount: Int
    /// `droppedCount > 0`.
    public let dropped: Bool
}

/// The change a "future events" split applies (§4.7): the tail's repeat (`nil`: Never), its start,
/// and whether the user chose a new repeat or end.
public struct SplitChange: Sendable, Hashable {
    public var recurrence: EventRecurrence?
    public var start: GregorianDate
    public var ruleChanged: Bool

    public init(recurrence: EventRecurrence?, start: GregorianDate, ruleChanged: Bool) {
        self.recurrence = recurrence
        self.start = start
        self.ruleChanged = ruleChanged
    }
}

/// One stored `RRULE` or `EXRULE` whose `UNTIL` a retime rewrites: its index in stored order and its
/// until end date (computed with the OLD start minute). Platforms write
/// `RRuleUntil.text(endDate:allDay:zone:using:)` into that rule's `UNTIL=` part only (§4.7).
/// TS: `UntilRewrite`.
public struct UntilRewrite: Sendable, Hashable {
    public enum Rule: String, Sendable, Hashable, Codable {
        case rrule, exrule
    }

    public let rule: Rule
    public let index: Int
    public let endDate: GregorianDate
}

/// The all-day toggle of a retimed series. TS: `'to-all-day' | 'to-timed'`.
public enum AllDayToggle: String, Sendable, Hashable, Codable {
    case toAllDay = "to-all-day"
    case toTimed = "to-timed"
}

/// The result of ``EventRecurrence/retimed(overrideDates:from:to:newRecurrence:minuteDelta:allDay:)``.
public struct RetimeResult: Sendable, Hashable {
    public let recurrence: EventRecurrence
    public let overrides: [ExceptionMap]
    public let untils: [UntilRewrite]
    public let droppedCount: Int
    public let dropped: Bool
}

// MARK: - Validation

extension RepeatEnd {
    /// Throws unless a `count` is `1…2147483647`.
    func validate(_ context: String) throws(ThirteenError) {
        if case let .count(count) = self, !(1...EventTime.maxInt).contains(count) {
            throw .invalidRule("\(context): end count must be an integer 1..\(EventTime.maxInt), got \(count)")
        }
    }

    /// `never`, `count:10` or `until:2027-06-30` (the Android marker URI).
    var uriText: String {
        switch self {
        case .never: "never"
        case let .count(count): "count:\(count)"
        case let .until(date): "until:\(date.isoString)"
        }
    }

    init(uriText text: String, context: String) throws(ThirteenError) {
        if text == "never" {
            self = .never
            return
        }
        if text.hasPrefix("count:") {
            let digits = text.dropFirst(6)
            if let first = digits.unicodeScalars.first, first != "0", let count = Text.unsigned(digits, maxDigits: 18),
                count <= EventTime.maxInt
            {
                self = .count(count)
                return
            }
        } else if text.hasPrefix("until:"), let date = try? GregorianDate(isoString: String(text.dropFirst(6))) {
            self = .until(date)
            return
        }
        throw .invalidRule(
            "\(context): end must be 'never', 'count:N' (N 1..\(EventTime.maxInt)) or 'until:YYYY-MM-DD', got \(Calc.quoted(text))")
    }
}

extension EventRecurrence {
    /// Validates the shape (TS `assertValidRecurrence`): a 13-month rule's fields, `RRule`s that are
    /// valid and have no `COUNT` or `UNTIL`, extra dates with minutes `0…1439` and lengths `>= 0`,
    /// removed dates with minutes `0…1439`. A `count` end may be any number here: whether it is in
    /// `1…999` is a draft issue (`count-out-of-range`).
    /// - Throws: ``ThirteenError/invalidRule(_:)``.
    public func validateShape() throws(ThirteenError) {
        func check(_ rrule: RRule, _ context: String) throws(ThirteenError) {
            do {
                try rrule.validate(context)
            } catch {
                throw .invalidRule("Invalid recurrence: \(error.description)")
            }
            if rrule.count != nil || rrule.until != nil {
                throw .invalidRule("Invalid recurrence: \(context) must not have COUNT or UNTIL (the end lives in the recurrence)")
            }
        }
        switch rule {
        case let .rrule(rrule): try check(rrule, "rrule")
        case let .thirteen(rule): try rule.validate()
        case .dates: break
        case let .foreign(rules, exrules):
            for entry in rules { try check(entry.rrule, "rules rrule") }
            for entry in exrules { try check(entry.rrule, "exrules rrule") }
        }
        for extra in extraDates {
            if let minute = extra.minute, !(0..<EventTime.day).contains(minute) {
                throw .invalidRule("Invalid recurrence: extraDates minute must be 0..1439 or null, got \(minute)")
            }
            if let duration = extra.durationMinutes, duration < 0 {
                throw .invalidRule("Invalid recurrence: extraDates durationMinutes must be >= 0 or null, got \(duration)")
            }
        }
        try EventRecurrence.validate(originals: exceptDates, "exceptDates")
    }

    /// Validates a recurrence for expansion (TS `assertExpandable`): its shape, every `count` an
    /// integer `1…2147483647`, and the end of a `dates` or `foreign` rule `.never`.
    /// - Throws: ``ThirteenError/invalidRule(_:)``.
    public func validate() throws(ThirteenError) {
        try validateShape()
        try end.validate("Invalid recurrence")
        switch rule {
        case .dates, .foreign:
            guard case .never = end else {
                throw .invalidRule(
                    "Invalid recurrence: a '\(ruleKindName)' rule ends through its own rules, so its end must be 'never'")
            }
            if case let .foreign(rules, exrules) = rule {
                for entry in rules + exrules { try entry.end.validate("Invalid recurrence: foreign rule") }
            }
        default: break
        }
    }

    static func validate(originals: [OriginalDate], _ name: String) throws(ThirteenError) {
        for value in originals {
            if let minute = value.minute, !(0..<EventTime.day).contains(minute) {
                throw .invalidRule("\(name) entries must be { date, minute: 0..1439 | null }, got minute \(minute)")
            }
        }
    }

    var ruleKindName: String {
        switch rule {
        case .rrule: "rrule"
        case .thirteen: "thirteen"
        case .dates: "dates"
        case .foreign: "foreign"
        }
    }
}

// MARK: - Rule streams

/// A numeric key for a date and minute (`nil` sorts first).
@inline(__always)
func occurrenceKey(_ day: Int, _ minute: Int?) -> Int { day * 1441 + (minute ?? -1) + 1 }

@inline(__always)
func dateOf(_ day: Int) -> GregorianDate { GregorianDate(uncheckedJulianDayNumber: day) }

/// Ascending candidate dates (Julian Day Numbers); -1 at the end.
protocol DayStream: AnyObject {
    func next() -> Int
    var truncated: Bool { get }
}

private final class NoCandidates: DayStream {
    func next() -> Int { -1 }
    var truncated: Bool { false }
}

extension RRuleCandidates: DayStream {}

/// A 13-month rule's dates on or after the start, year by year (§4.2).
private final class ThirteenCandidates: DayStream {
    var truncated: Bool { false }
    private let common: [Int]
    private let leap: [Int]
    private let startJdn: Int
    private let stop: Int
    private var year: Int
    private var days: [Int] = []
    private var base = 0
    private var index = 0

    init(_ rule: ThirteenRule, start: GregorianDate, stop: Int, jumpTo: Int?) {
        let days = rule.yearDays(start: start)
        common = days.common
        leap = days.leap
        startJdn = start.julianDayNumber
        self.stop = min(stop, GregorianDate.maxJulianDayNumber)
        year = jumpTo.map { max(start.year, Civil.year(max($0, GregorianDate.minJulianDayNumber))) } ?? start.year
        load()
    }

    private func load() {
        if year > GregorianDate.maxYear || Civil.jdn(year, 1, 1) > stop {
            year = GregorianDate.maxYear + 1
            return
        }
        base = Civil.jdn(year, 1, 1) - 1
        days = Calc.isLeap(year) ? leap : common
        index = 0
    }

    func next() -> Int {
        while year <= GregorianDate.maxYear {
            if index < days.count {
                let day = base + days[index]
                index += 1
                if day < startJdn { continue }
                if day > stop {
                    year = GregorianDate.maxYear + 1
                    return -1
                }
                return day
            }
            year += 1
            load()
        }
        return -1
    }
}

/// A rule stream with its end (§4.6 steps 1 and 2): the start first (when `forceStart`, as for every
/// `RRULE`), then the candidates after it, stopping after `count` dates or after `last`, and at `stop`.
final class EndedStream: DayStream {
    private let candidates: any DayStream
    private let startJdn: Int
    private let forceStart: Bool
    private let count: Int
    private let last: Int
    private let stop: Int
    private let impossible: Bool
    private var emitted = 0
    private var started: Bool

    init(_ candidates: any DayStream, startJdn: Int, forceStart: Bool, count: Int, last: Int, stop: Int, impossible: Bool) {
        self.candidates = candidates
        self.startJdn = startJdn
        self.forceStart = forceStart
        self.count = count
        self.last = last
        self.stop = stop
        self.impossible = impossible
        started = !forceStart
    }

    var truncated: Bool { impossible || candidates.truncated }

    func next() -> Int {
        if emitted >= count { return -1 }
        if !started {
            started = true
            if startJdn > stop {
                emitted = count
                return -1
            }
            emitted += 1
            return startJdn
        }
        while true {
            let day = candidates.next()
            if day < 0 || day > last || day > stop {
                emitted = count
                return -1
            }
            if forceStart && day <= startJdn { continue }
            emitted += 1
            return day
        }
    }
}

/// The union of several ascending streams, without duplicates.
private final class UnionStream: DayStream {
    private let streams: [EndedStream]
    private var heads: [Int]

    init(_ streams: [EndedStream]) {
        self.streams = streams
        heads = streams.map { $0.next() }
    }

    var truncated: Bool { streams.contains { $0.truncated } }

    func next() -> Int {
        var best = -1
        for head in heads where head >= 0 && (best < 0 || head < best) { best = head }
        if best < 0 { return -1 }
        for (i, head) in heads.enumerated() where head == best { heads[i] = streams[i].next() }
        return best
    }
}

extension RepeatEnd {
    /// The end of a rule as a count and a last date.
    var bounds: (count: Int, last: Int) {
        switch self {
        case .never: (Int.max, GregorianDate.maxJulianDayNumber)
        case let .count(count): (count, GregorianDate.maxJulianDayNumber)
        case let .until(date): (Int.max, date.julianDayNumber)
        }
    }

    var isCount: Bool {
        if case .count = self { return true }
        return false
    }
}

/// One `RRULE` (or `EXRULE` when `forceStart` is false) with its end, as a stream up to `stop`.
func rruleStream(_ rrule: RRule, _ end: RepeatEnd, _ start: GregorianDate, _ stop: Int, _ jumpTo: Int?, _ forceStart: Bool)
    -> EndedStream
{
    let (count, last) = end.bounds
    let startJdn = start.julianDayNumber
    if RRuleSupport(rrule, startMinute: nil) == .impossible {
        return EndedStream(
            NoCandidates(), startJdn: startJdn, forceStart: forceStart, count: count, last: last, stop: stop, impossible: true)
    }
    let source = RRuleCandidates(rrule, start: start, stop: min(last, stop), jumpTo: end.isCount ? nil : jumpTo)
    return EndedStream(source, startJdn: startJdn, forceStart: forceStart, count: count, last: last, stop: stop, impossible: false)
}

extension EventRecurrence {
    /// The rule stream (§4.6 steps 1 and 2) up to `stop`; `jumpTo` lets uncounted streams skip earlier dates.
    func ruleStream(start: GregorianDate, stop: Int, jumpTo: Int?) -> any DayStream {
        let startJdn = start.julianDayNumber
        switch rule {
        case let .thirteen(rule):
            let bounds = end.bounds
            // A leap-only repeat stops at its cap whatever its end, as its stored rule does (§4.3 c).
            let last = rule.cap(start: start).map { min(bounds.last, $0.julianDayNumber) } ?? bounds.last
            let source = ThirteenCandidates(rule, start: start, stop: min(last, stop), jumpTo: end.isCount ? nil : jumpTo)
            return EndedStream(
                source, startJdn: startJdn, forceStart: true, count: bounds.count, last: last, stop: stop, impossible: false)
        case let .rrule(rrule):
            return rruleStream(rrule, end, start, stop, jumpTo, true)
        case .dates:
            return EndedStream(
                NoCandidates(), startJdn: startJdn, forceStart: true, count: 1, last: GregorianDate.maxJulianDayNumber,
                stop: stop, impossible: false)
        case let .foreign(rules, _):
            var streams = rules.map { rruleStream($0.rrule, $0.end, start, stop, jumpTo, true) }
            // The start is always the first occurrence, also of a foreign rule without RRULEs.
            streams.append(
                EndedStream(
                    NoCandidates(), startJdn: startJdn, forceStart: true, count: 1, last: GregorianDate.maxJulianDayNumber,
                    stop: stop, impossible: false))
            return UnionStream(streams)
        }
    }

    /// `true` when the engine cannot expand some `RRULE` or `EXRULE` of the recurrence (§4.6 step 6).
    func isUnsupported(startMinute: Int?) -> Bool {
        let all: [RRule]
        switch rule {
        case let .rrule(rrule): all = [rrule]
        case let .foreign(rules, exrules): all = (rules + exrules).map(\.rrule)
        default: all = []
        }
        return all.contains { RRuleSupport($0, startMinute: startMinute) == .unsupported }
    }
}

// MARK: - Expansion (§4.6)

/// An occurrence's original date as a Julian Day Number, with its own minute and length (nil: the master's).
struct DayOccurrence: Sendable {
    let day: Int
    let minute: Int?
    let durationMinutes: Int?
}

/// The occurrences of a recurrence from `from` through `to` (Julian Day Numbers), ascending, lazily.
private final class Expander {
    private let rule: any DayStream
    private let exrules: [EndedStream]
    private var exruleHeads: [Int]
    private let extras: [DayOccurrence]
    private let except: Set<Int>
    private var extraIndex = 0
    private var ruleHead: Int

    init(_ recurrence: EventRecurrence, start: GregorianDate, from: Int, to: Int) {
        rule = recurrence.ruleStream(start: start, stop: to, jumpTo: from)
        if case let .foreign(_, exrules) = recurrence.rule {
            self.exrules = exrules.map { rruleStream($0.rrule, $0.end, start, to, from, false) }
        } else {
            exrules = []
        }
        exruleHeads = exrules.map { $0.next() }
        // Extra dates sorted by date and minute (the master's time first), repeated values once (the first wins).
        var seen = Set<Int>()
        var sorted: [DayOccurrence] = []
        for extra in recurrence.extraDates {
            let day = extra.date.julianDayNumber
            if !seen.insert(occurrenceKey(day, extra.minute)).inserted { continue }
            sorted.append(DayOccurrence(day: day, minute: extra.minute, durationMinutes: extra.durationMinutes))
        }
        sorted.sort { occurrenceKey($0.day, $0.minute) < occurrenceKey($1.day, $1.minute) }
        extras = sorted.filter { $0.day >= from && $0.day <= to }
        except = Set(recurrence.exceptDates.map { occurrenceKey($0.date.julianDayNumber, $0.minute) })
        var head = rule.next()
        while head >= 0 && head < from { head = rule.next() }
        ruleHead = head
    }

    var truncated: Bool { rule.truncated }

    /// `true` when an `EXRULE` produces `day` (queries come in ascending order).
    private func exruled(_ day: Int) -> Bool {
        var hit = false
        for (i, stream) in exrules.enumerated() {
            var head = exruleHeads[i]
            while head >= 0 && head < day { head = stream.next() }
            exruleHeads[i] = head
            if head == day { hit = true }
        }
        return hit
    }

    private func excluded(_ day: Int, _ minute: Int?) -> Bool {
        except.contains(occurrenceKey(day, minute)) || (minute == nil && !exrules.isEmpty && exruled(day))
    }

    /// The next occurrence, or `nil` at the end.
    func next() -> DayOccurrence? {
        while true {
            let extra = extraIndex < extras.count ? extras[extraIndex] : nil
            let ruleKey = ruleHead >= 0 ? occurrenceKey(ruleHead, nil) : Int.max
            let extraKey = extra.map { occurrenceKey($0.day, $0.minute) } ?? Int.max
            if ruleKey == Int.max && extraKey == Int.max { return nil }
            let next: DayOccurrence
            if ruleKey <= extraKey {
                next = DayOccurrence(day: ruleHead, minute: nil, durationMinutes: nil)
                ruleHead = rule.next()
                if extraKey == ruleKey { extraIndex += 1 }  // the same occurrence: produced once
            } else {
                next = extra!
                extraIndex += 1
            }
            if !excluded(next.day, next.minute) { return next }
        }
    }
}

extension EventRecurrence {
    /// The default `limit` of expansion (§4.6 step 5).
    static let defaultLimit = 10_000

    /// Expansion for a valid recurrence on Julian Day Numbers (`from` and `to` inclusive).
    /// `startMinute`, when known, lets the support check compare single `BYHOUR` and `BYMINUTE`
    /// values with the start's time (series expansion passes it).
    func expandDays(start: GregorianDate, from: Int, to: Int, limit: Int, startMinute: Int?)
        -> (occurrences: [DayOccurrence], truncated: Bool, unsupported: Bool)
    {
        let startJdn = start.julianDayNumber
        if isUnsupported(startMinute: startMinute) {
            let inWindow = startJdn >= from && startJdn <= to
            return (inWindow ? [DayOccurrence(day: startJdn, minute: nil, durationMinutes: nil)] : [], false, true)
        }
        let expander = Expander(self, start: start, from: from, to: to)
        var occurrences: [DayOccurrence] = []
        var truncated = false
        while let next = expander.next() {
            if occurrences.count == limit {
                truncated = true
                break
            }
            occurrences.append(next)
        }
        return (occurrences, truncated || expander.truncated, false)
    }

    /// The original dates of the occurrences inside `window` (both ends inclusive), in the event's
    /// zone (§4.6): ascending by date, then by minute with the master's time first, without
    /// duplicates. `start` is always the first occurrence; ends apply to the rule stream only (a
    /// leap-only 13-month repeat also stops at its cap); extra dates are added whatever their date;
    /// exclusions remove the `exceptDates` occurrence with the same date and minute and every date
    /// an `EXRULE` produces at the master's minute. At most `limit` (default 10,000) occurrences,
    /// with `truncated`; unsupported rules give only the start, if it is in the window, with
    /// `unsupported`. TS: `expandRecurrence`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid recurrence, window or limit.
    public func expand(start: GregorianDate, in window: ExpansionWindow, limit: Int = 10_000) throws(ThirteenError)
        -> Expansion
    {
        try validate()
        guard window.from <= window.to else {
            throw .invalidRule("Expansion window ends before it starts: \(window.from.isoString)..\(window.to.isoString)")
        }
        try EventRecurrence.validate(limit: limit, "expandRecurrence")
        let result = expandDays(
            start: start, from: window.from.julianDayNumber, to: window.to.julianDayNumber, limit: limit, startMinute: nil)
        return Expansion(
            occurrences: result.occurrences.map { ExtraDate(date: dateOf($0.day), minute: $0.minute, durationMinutes: $0.durationMinutes) },
            truncated: result.truncated, unsupported: result.unsupported)
    }

    static func validate(limit: Int, _ context: String) throws(ThirteenError) {
        guard (1...EventTime.maxInt).contains(limit) else {
            throw .invalidRule("\(context) option 'limit' must be an integer 1..\(EventTime.maxInt), got \(limit)")
        }
    }

    /// The dates of the next `count` occurrences after `start` (strictly later dates), ascending and
    /// without repeated dates; fewer when the repeat ends sooner. Exclusions apply; extra dates
    /// count. An unsupported rule has none. TS: `nextOccurrences`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid recurrence or a `count` outside `0…1000`.
    public func nextOccurrences(start: GregorianDate, count: Int) throws(ThirteenError) -> [GregorianDate] {
        try validate()
        guard (0...1000).contains(count) else { throw .invalidRule("count must be an integer 0..1000, got \(count)") }
        return nextDates(start: start, count: count)
    }

    func nextDates(start: GregorianDate, count: Int) -> [GregorianDate] {
        let from = start.julianDayNumber + 1
        if count == 0 || from > GregorianDate.maxJulianDayNumber || isUnsupported(startMinute: nil) { return [] }
        let expander = Expander(self, start: start, from: from, to: GregorianDate.maxJulianDayNumber)
        var days: [Int] = []
        while days.count < count, let next = expander.next() {
            if days.last != next.day { days.append(next.day) }
        }
        return days.map(dateOf)
    }
}

// MARK: - Ends (§4.7)

/// The number of dates of a rule stream (start included, exclusions not applied) before `at`.
private func streamCountBefore(_ make: (Int) -> any DayStream, _ at: Int) -> Int {
    let stream = make(at - 1)
    var n = 0
    while stream.next() >= 0 { n += 1 }
    return n
}

/// The head end of one rule stream ended before `at` (§4.7): a count of the dates before it, or the
/// day before it.
private func headEnd(_ end: RepeatEnd, _ countBefore: () -> Int, _ at: Int) -> RepeatEnd {
    if case let .count(count) = end {
        let before = countBefore()
        return before >= count ? end : .count(before)
    }
    let dayBefore = at - 1
    if case let .until(date) = end, date.julianDayNumber <= dayBefore { return end }
    return .until(dateOf(dayBefore))
}

extension EventRecurrence {
    /// ``endedBefore(_:start:)`` for valid input.
    func head(start: GregorianDate, at: Int) -> EventRecurrence? {
        if at <= start.julianDayNumber { return nil }
        let headRule: RepeatRule
        var headEndValue = RepeatEnd.never
        switch rule {
        case .thirteen, .rrule:
            headRule = rule
            headEndValue = headEnd(end, { streamCountBefore({ self.ruleStream(start: start, stop: $0, jumpTo: nil) }, at) }, at)
        case .dates:
            headRule = .dates
        case let .foreign(rules, exrules):
            func ended(_ r: EndedRule, _ forceStart: Bool) -> EndedRule {
                EndedRule(
                    rrule: r.rrule,
                    end: headEnd(r.end, { streamCountBefore({ rruleStream(r.rrule, r.end, start, $0, nil, forceStart) }, at) }, at))
            }
            headRule = .foreign(rules: rules.map { ended($0, true) }, exrules: exrules.map { ended($0, false) })
        }
        return EventRecurrence(
            rule: headRule, end: headEndValue,
            extraDates: extraDates.filter { $0.date.julianDayNumber < at },
            exceptDates: exceptDates.filter { $0.date.julianDayNumber < at })
    }

    /// The series ended before `date` (§4.7, "Delete all future events" and the head of a split): a
    /// rule with a `count` keeps the number of its dates before `date` (counting excluded dates);
    /// otherwise it ends on the day before `date`, unless its own end comes earlier. A `foreign`
    /// rule does this for each of its `RRULE`s and `EXRULE`s. Extra and excluded dates before `date`
    /// stay. TS: `endRecurrenceBefore`.
    /// - Returns: the head, or `nil` when `date` is on or before the start.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid recurrence.
    public func endedBefore(_ date: GregorianDate, start: GregorianDate) throws(ThirteenError) -> EventRecurrence? {
        try validate()
        return head(start: start, at: date.julianDayNumber)
    }

    /// `true` when some rule stream of the recurrence never ends (a leap-only repeat always ends at its cap).
    private func endless(start: GregorianDate) -> Bool {
        switch rule {
        case .dates: return false
        case let .foreign(rules, _): return rules.contains { $0.end == .never }
        case let .thirteen(rule) where rule.cap(start: start) != nil: return false
        default: return end == .never
        }
    }

    /// ``laterCount(start:at:)`` for valid input.
    func later(start: GregorianDate, at: Int) -> Int? {
        if endless(start: start) { return nil }
        let from = at + 1
        if from > GregorianDate.maxJulianDayNumber || isUnsupported(startMinute: nil) { return 0 }
        let expander = Expander(self, start: start, from: from, to: GregorianDate.maxJulianDayNumber)
        var n = 0
        while expander.next() != nil { n += 1 }
        return n
    }

    /// The number of occurrences after `at` (on later dates; excluded dates not counted, extra dates
    /// counted) that ending the repeat at `at` would delete (§2.11); 0 at the last occurrence.
    /// `nil` when the series never ends. A leap-only 13-month repeat always ends, at its cap.
    /// TS: `laterOccurrenceCount`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid recurrence.
    public func laterCount(start: GregorianDate, at: GregorianDate) throws(ThirteenError) -> Int? {
        try validate()
        return later(start: start, at: at.julianDayNumber)
    }

    /// The dates (Julian Day Numbers) the rule stream produces from `from` through `to`.
    func ruleDates(start: GregorianDate, from: Int, to: Int) -> Set<Int> {
        var out = Set<Int>()
        if from > to { return out }
        let stream = ruleStream(start: start, stop: to, jumpTo: from)
        var day = stream.next()
        while day >= 0 {
            if day >= from { out.insert(day) }
            day = stream.next()
        }
        return out
    }
}

// MARK: - Splitting (§4.7)

extension EventRecurrence {
    /// Splits a series at the occurrence on `at` for a "future events" change or "Delete all future
    /// events" (§4.7). `head` is ``endedBefore(_:start:)``; `tail` (nil without `change`, or when
    /// `change.recurrence` is nil) starts at `change.start`: with the repeat kept (`ruleChanged`
    /// false) it takes `change.recurrence`'s rule with the original end carried on (a 10-time series
    /// split at its 4th occurrence keeps 7), else `change.recurrence` as it is. Exceptions on or
    /// after `at` move to the tail when its rule produces their date shifted by the days the start
    /// moved, else they are dropped; extra dates before `at` stay in the head, later ones are
    /// dropped. `droppedCount` counts what the tail does not keep. TS: `splitRecurrence`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for invalid input, a kept repeat of a `foreign`
    ///   or `dates` rule or of a rule with extra dates, or a kept `count` that `at` has used up.
    public func split(start: GregorianDate, at: GregorianDate, overrideDates: [OriginalDate], change: SplitChange? = nil)
        throws(ThirteenError) -> SplitResult
    {
        try validate()
        try EventRecurrence.validate(originals: overrideDates, "overrideDates")
        if let chosen = change?.recurrence { try chosen.validate() }
        let atJdn = at.julianDayNumber
        let headValue = head(start: start, at: atJdn)
        let laterExcept = exceptDates.filter { $0.date.julianDayNumber >= atJdn }
        let laterOverrides = overrideDates.filter {
            $0.date.julianDayNumber >= atJdn && !($0.date.julianDayNumber == atJdn && $0.minute == nil)
        }
        let laterExtras = extraDates.filter { $0.date.julianDayNumber >= atJdn }

        var tail: EventRecurrence?
        if let change, let chosen = change.recurrence {
            if !change.ruleChanged {
                if cannotKeep {
                    let what = extraDates.isEmpty ? "'\(ruleKindName)' rule" : "rule with extra dates"
                    throw .invalidRule("A \(what) cannot be kept by a split: it is anchored on its own start")
                }
                var tailEnd = end
                if case let .count(count) = end {
                    let before = streamCountBefore({ self.ruleStream(start: start, stop: $0, jumpTo: nil) }, atJdn)
                    let left = count - before
                    if left < 1 {
                        throw .invalidRule("Cannot split at \(at.isoString): the series' \(count) occurrences end before it")
                    }
                    tailEnd = .count(left)
                }
                tail = EventRecurrence(rule: chosen.rule, end: tailEnd)
            } else {
                var copy = chosen
                copy.exceptDates = []
                tail = copy
            }
        }

        var droppedCount = laterExtras.count
        var overrides: [ExceptionMap] = []
        if var kept = tail, let change {
            let tailStart = change.start
            let shift = tailStart.julianDayNumber - atJdn
            let targets = (laterExcept + laterOverrides).filter { $0.minute == nil }.map { $0.date.julianDayNumber + shift }
                .filter { $0 >= GregorianDate.minJulianDayNumber && $0 <= GregorianDate.maxJulianDayNumber }
            let produced =
                targets.isEmpty ? Set<Int>() : kept.ruleDates(start: tailStart, from: targets.min()!, to: targets.max()!)
            func map(_ o: OriginalDate) -> OriginalDate? {
                guard o.minute == nil else { return nil }
                let target = o.date.julianDayNumber + shift
                return produced.contains(target) ? OriginalDate(date: dateOf(target), minute: nil) : nil
            }
            var carried: [OriginalDate] = []
            var seen = Set<Int>()
            for e in laterExcept {
                guard let to = map(e) else {
                    droppedCount += 1
                    continue
                }
                if seen.insert(to.date.julianDayNumber).inserted { carried.append(to) }
            }
            var taken = Set<Int>()
            for o in laterOverrides {
                var to = map(o)
                if let target = to, taken.contains(target.date.julianDayNumber) { to = nil }
                if let target = to {
                    taken.insert(target.date.julianDayNumber)
                } else {
                    droppedCount += 1
                }
                overrides.append(ExceptionMap(from: o, to: to))
            }
            kept.exceptDates = carried
            tail = kept
        } else {
            droppedCount += laterExcept.count + laterOverrides.count
            overrides = laterOverrides.map { ExceptionMap(from: $0, to: nil) }
        }
        return SplitResult(head: headValue, tail: tail, overrides: overrides, droppedCount: droppedCount, dropped: droppedCount > 0)
    }

    /// `true` when the recurrence is one a kept repeat cannot carry to a new start (§4.7).
    private var cannotKeep: Bool {
        switch rule {
        case .foreign, .dates: true
        default: !extraDates.isEmpty
        }
    }
}

// MARK: - Retiming (§4.7)

extension EventRecurrence {
    /// The `UNTIL` rewrites of a recurrence (§4.7): one per stored rule with an until end, in stored
    /// order (`RRULE`s, then `EXRULE`s); for a 13-month rule, the `UNTIL` of its encoding, the
    /// leap-interval cap included.
    func untilRewrites(start: GregorianDate) -> [UntilRewrite] {
        switch rule {
        case .dates:
            return []
        case let .foreign(rules, exrules):
            var out: [UntilRewrite] = []
            for (index, r) in rules.enumerated() {
                if case let .until(date) = r.end { out.append(UntilRewrite(rule: .rrule, index: index, endDate: date)) }
            }
            for (index, r) in exrules.enumerated() {
                if case let .until(date) = r.end { out.append(UntilRewrite(rule: .exrule, index: index, endDate: date)) }
            }
            return out
        case .rrule:
            if case let .until(date) = end { return [UntilRewrite(rule: .rrule, index: 0, endDate: date)] }
            return []
        case let .thirteen(rule):
            guard rule.contains(start, start: start), let stored = try? storedRRule(start: start) else {
                if case let .until(date) = end { return [UntilRewrite(rule: .rrule, index: 0, endDate: date)] }
                return []
            }
            if case let .date(date)? = stored.until { return [UntilRewrite(rule: .rrule, index: 0, endDate: date)] }
            return []
        }
    }

    /// Rewrites a series' exceptions when its first occurrence (the whole series) gets a new start
    /// time, zone, all-day setting or date (§4.7, §4.9 rule 4). The result keeps `newRecurrence`'s
    /// rule and end and replaces its extra and excluded dates with this recurrence's, rewritten:
    /// values at the series' time keep their date (shifted by the days the start moved where the new
    /// rule produces the shifted date, else dropped); values with their own time shift by
    /// `minuteDelta`; `.toAllDay` makes every value its date (an extra date that then falls on a
    /// rule date or another extra date is dropped with its exceptions), `.toTimed` writes every value
    /// at the new start time; orphans are dropped. `overrides` maps every entry of `overrideDates`,
    /// in order; `untils` lists the stored rules whose `UNTIL` the platform rewrites.
    /// TS: `retimeExceptions`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for invalid input.
    public func retimed(
        overrideDates: [OriginalDate], from oldStart: GregorianDate, to newStart: GregorianDate,
        newRecurrence: EventRecurrence, minuteDelta: Int = 0, allDay toggle: AllDayToggle? = nil
    ) throws(ThirteenError) -> RetimeResult {
        try validate()
        try EventRecurrence.validate(originals: overrideDates, "overrideDates")
        try newRecurrence.validate()
        let dayDelta = newStart.julianDayNumber - oldStart.julianDayNumber

        // The dates both rule streams produce around every value involved.
        let values = (extraDates.map(\.date) + exceptDates.map(\.date) + overrideDates.map(\.date)).map(\.julianDayNumber)
        let low = min(values.min() ?? Int.max, oldStart.julianDayNumber)
        let high = max(values.max() ?? Int.min, oldStart.julianDayNumber)
        let oldRule = ruleDates(start: oldStart, from: low, to: high)
        let newRule = newRecurrence.ruleDates(
            start: newStart, from: max(min(low, low + dayDelta), GregorianDate.minJulianDayNumber),
            to: min(max(high, high + dayDelta), GregorianDate.maxJulianDayNumber))

        var droppedCount = 0
        var extras: [ExtraDate] = []
        /// Old extra date key → its new value, or nil when it was dropped.
        var extraMap: [Int: OriginalDate?] = [:]
        var kept = Set<Int>()
        for extra in extraDates {
            let day = extra.date.julianDayNumber
            let oldKey = occurrenceKey(day, extra.minute)
            if extraMap[oldKey] != nil { continue }  // a repeated value: expansion never produced it twice
            var next: ExtraDate?
            if toggle == .toAllDay {
                next = newRule.contains(day) || kept.contains(occurrenceKey(day, nil)) ? nil : ExtraDate(date: extra.date)
            } else if toggle == nil, let minute = extra.minute {
                let absolute = day * EventTime.day + minute + minuteDelta
                let shifted = Calc.floorDiv(absolute, EventTime.day)
                next =
                    (GregorianDate.minJulianDayNumber...GregorianDate.maxJulianDayNumber).contains(shifted)
                    ? ExtraDate(date: dateOf(shifted), minute: absolute - shifted * EventTime.day, durationMinutes: extra.durationMinutes)
                    : nil
            } else {
                next = extra
            }
            guard let value = next else {
                droppedCount += 1
                extraMap[oldKey] = .some(nil)
                continue
            }
            kept.insert(occurrenceKey(value.date.julianDayNumber, value.minute))
            extras.append(value)
            extraMap[oldKey] = .some(OriginalDate(date: value.date, minute: value.minute))
        }

        let nullExtraDays = Set(extraDates.filter { $0.minute == nil }.map(\.date.julianDayNumber))
        func map(_ value: OriginalDate) -> OriginalDate? {
            let day = value.date.julianDayNumber
            if let minute = value.minute { return extraMap[occurrenceKey(day, minute)] ?? nil }
            if !oldRule.contains(day) { return nullExtraDays.contains(day) ? (extraMap[occurrenceKey(day, nil)] ?? nil) : nil }
            let shifted = day + dayDelta
            return newRule.contains(shifted) ? OriginalDate(date: dateOf(shifted), minute: nil) : nil
        }

        var newExcept: [OriginalDate] = []
        var excepted = Set<Int>()
        for value in exceptDates {
            guard let to = map(value) else {
                droppedCount += 1
                continue
            }
            if excepted.insert(occurrenceKey(to.date.julianDayNumber, to.minute)).inserted { newExcept.append(to) }
        }
        var overrides: [ExceptionMap] = []
        var taken = Set<Int>()
        for value in overrideDates {
            var to = map(value)
            if let target = to, !taken.insert(occurrenceKey(target.date.julianDayNumber, target.minute)).inserted { to = nil }
            if to == nil { droppedCount += 1 }
            overrides.append(ExceptionMap(from: value, to: to))
        }
        return RetimeResult(
            recurrence: EventRecurrence(
                rule: newRecurrence.rule, end: newRecurrence.end, extraDates: extras, exceptDates: newExcept),
            overrides: overrides, untils: newRecurrence.untilRewrites(start: newStart), droppedCount: droppedCount,
            dropped: droppedCount > 0)
    }
}

// MARK: - The RRULE a repeat is written as (§4.3, §4.4)

extension EventRecurrence {
    /// ``rrule(start:)`` for a valid recurrence.
    func storedRRule(start: GregorianDate) throws(ThirteenError) -> RRule? {
        func withEnd(_ base: RRule, cap: GregorianDate?) -> RRule {
            var rule = base
            switch end {
            case let .count(count):
                if let cap {
                    // The leap interval's cap wins over a longer count (§4.3 c).
                    let fit = Calc.floorDiv(cap.year - start.year, 4) + 1
                    if count > fit {
                        rule.count = nil
                        return rule
                    }
                }
                rule.count = count
                rule.until = nil
            case let .until(date):
                rule.count = nil
                rule.until = .date(cap.map { $0 < date ? $0 : date } ?? date)
            case .never:
                break
            }
            return rule
        }
        switch rule {
        case let .rrule(rrule): return withEnd(rrule.withoutEnd, cap: nil)
        case let .thirteen(rule):
            let encoding = try rule.encoding(start: start)
            return withEnd(encoding.rrule, cap: encoding.cap)
        default: return nil
        }
    }

    /// The one `RRULE` a repeat is written as (§4.3, §4.4): a Gregorian rule with its end, or a
    /// 13-month rule's encoding (forms (a) to (c)) with its end. A `count` end becomes `COUNT`, an
    /// `until` end a DATE `UNTIL` (writers of timed events turn it into the end of that day with
    /// `RRuleUntil.text`). The leap-interval cap wins over a later until or a longer count. `nil` for
    /// `dates` and `foreign` rules. TS: `recurrenceToRRule`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid recurrence, or a 13-month rule that
    ///   does not produce its start.
    public func rrule(start: GregorianDate) throws(ThirteenError) -> RRule? {
        try validate()
        return try storedRRule(start: start)
    }
}

// MARK: - Codable (§5.5)

extension RepeatEnd: Codable {
    enum CodingKeys: String, CodingKey { case kind, count, date }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "never": self = .never
        case "count": self = .count(try c.decode(Int.self, forKey: .count))
        case "until": self = .until(try c.decode(EventJSONDate.self, forKey: .date).date)
        case let kind:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "end kind must be 'never', 'count' or 'until', got '\(kind)'")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .never:
            try c.encode("never", forKey: .kind)
        case let .count(count):
            try c.encode("count", forKey: .kind)
            try c.encode(count, forKey: .count)
        case let .until(date):
            try c.encode("until", forKey: .kind)
            try c.encode(date.isoString, forKey: .date)
        }
    }
}

/// An `RRule` as its canonical text inside recurrence JSON (§5.5).
private struct RRuleText: Codable {
    let rule: RRule

    init(_ rule: RRule) { self.rule = rule }

    init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        do {
            rule = try RRule(text: try c.decode(String.self))
        } catch let error as ThirteenError {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: String(describing: error))
        }
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(rule.text)
    }
}

extension EndedRule: Codable {
    enum CodingKeys: String, CodingKey { case rrule, end }

    /// `{"rrule": canonical text, "end": RepeatEnd}`.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rrule = try c.decode(RRuleText.self, forKey: .rrule).rule
        end = try c.decode(RepeatEnd.self, forKey: .end)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(RRuleText(rrule), forKey: .rrule)
        try c.encode(end, forKey: .end)
    }
}

extension RepeatRule: Codable {
    enum CodingKeys: String, CodingKey { case kind, rrule, rule, rules, exrules }

    /// `{"kind":"rrule","rrule":"FREQ=WEEKLY;INTERVAL=2"}`, `{"kind":"thirteen","rule":…}`,
    /// `{"kind":"dates"}`, `{"kind":"foreign","rules":[…],"exrules":[…]}`.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "rrule": self = .rrule(try c.decode(RRuleText.self, forKey: .rrule).rule)
        case "thirteen": self = .thirteen(try c.decode(ThirteenRule.self, forKey: .rule))
        case "dates": self = .dates
        case "foreign":
            self = .foreign(rules: try c.decode([EndedRule].self, forKey: .rules), exrules: try c.decode([EndedRule].self, forKey: .exrules))
        case let kind:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "rule kind must be 'rrule', 'thirteen', 'dates' or 'foreign', got '\(kind)'")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .rrule(rrule):
            try c.encode("rrule", forKey: .kind)
            try c.encode(RRuleText(rrule), forKey: .rrule)
        case let .thirteen(rule):
            try c.encode("thirteen", forKey: .kind)
            try c.encode(rule, forKey: .rule)
        case .dates:
            try c.encode("dates", forKey: .kind)
        case let .foreign(rules, exrules):
            try c.encode("foreign", forKey: .kind)
            try c.encode(rules, forKey: .rules)
            try c.encode(exrules, forKey: .exrules)
        }
    }
}

extension ExtraDate: Codable {
    enum CodingKeys: String, CodingKey { case date, minute, durationMinutes }

    /// A date string when `minute` and `durationMinutes` are both nil, else `{"date","minute","durationMinutes"}`.
    public init(from decoder: any Decoder) throws {
        if let single = try? decoder.singleValueContainer(), let date = try? single.decode(EventJSONDate.self) {
            self.init(date: date.date)
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            date: try c.decode(EventJSONDate.self, forKey: .date).date, minute: try c.decode(Int?.self, forKey: .minute),
            durationMinutes: try c.decode(Int?.self, forKey: .durationMinutes))
    }

    public func encode(to encoder: any Encoder) throws {
        if minute == nil && durationMinutes == nil {
            var c = encoder.singleValueContainer()
            try c.encode(date.isoString)
            return
        }
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(date.isoString, forKey: .date)
        try c.encode(minute, forKey: .minute)
        try c.encode(durationMinutes, forKey: .durationMinutes)
    }
}

extension OriginalDate: Codable {
    enum CodingKeys: String, CodingKey { case date, minute }

    /// A date string when `minute` is nil, else `{"date","minute"}`.
    public init(from decoder: any Decoder) throws {
        if let single = try? decoder.singleValueContainer(), let date = try? single.decode(EventJSONDate.self) {
            self.init(date: date.date)
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(date: try c.decode(EventJSONDate.self, forKey: .date).date, minute: try c.decode(Int?.self, forKey: .minute))
    }

    public func encode(to encoder: any Encoder) throws {
        guard let minute else {
            var c = encoder.singleValueContainer()
            try c.encode(date.isoString)
            return
        }
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(date.isoString, forKey: .date)
        try c.encode(minute, forKey: .minute)
    }
}

extension EventRecurrence: Codable {
    enum CodingKeys: String, CodingKey { case rule, end, extraDates, exceptDates }

    /// Always with all four fields (§5.5).
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            rule: try c.decode(RepeatRule.self, forKey: .rule), end: try c.decode(RepeatEnd.self, forKey: .end),
            extraDates: try c.decode([ExtraDate].self, forKey: .extraDates),
            exceptDates: try c.decode([OriginalDate].self, forKey: .exceptDates))
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(rule, forKey: .rule)
        try c.encode(end, forKey: .end)
        try c.encode(extraDates, forKey: .extraDates)
        try c.encode(exceptDates, forKey: .exceptDates)
    }
}

extension ExpansionWindow: Codable {
    enum CodingKeys: String, CodingKey { case from, to }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = try c.decode(EventJSONDate.self, forKey: .from).date
        to = try c.decode(EventJSONDate.self, forKey: .to).date
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(from.isoString, forKey: .from)
        try c.encode(to.isoString, forKey: .to)
    }
}

extension Expansion: Codable {}

extension ExceptionMap: Codable {
    enum CodingKeys: String, CodingKey { case from, to }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(from, forKey: .from)
        try c.encode(to, forKey: .to)
    }
}

extension SplitResult: Codable {
    enum CodingKeys: String, CodingKey { case head, tail, overrides, droppedCount, dropped }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(head, forKey: .head)
        try c.encode(tail, forKey: .tail)
        try c.encode(overrides, forKey: .overrides)
        try c.encode(droppedCount, forKey: .droppedCount)
        try c.encode(dropped, forKey: .dropped)
    }
}

extension UntilRewrite: Codable {
    enum CodingKeys: String, CodingKey { case rule, index, endDate }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rule = try c.decode(Rule.self, forKey: .rule)
        index = try c.decode(Int.self, forKey: .index)
        endDate = try c.decode(EventJSONDate.self, forKey: .endDate).date
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(rule, forKey: .rule)
        try c.encode(index, forKey: .index)
        try c.encode(endDate.isoString, forKey: .endDate)
    }
}

extension RetimeResult: Codable {}
extension SplitChange: Codable {
    enum CodingKeys: String, CodingKey { case recurrence, start, ruleChanged }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        recurrence = try c.decode(EventRecurrence?.self, forKey: .recurrence)
        start = try c.decode(EventJSONDate.self, forKey: .start).date
        ruleChanged = try c.decode(Bool.self, forKey: .ruleChanged)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(recurrence, forKey: .recurrence)
        try c.encode(start.isoString, forKey: .start)
        try c.encode(ruleChanged, forKey: .ruleChanged)
    }
}
