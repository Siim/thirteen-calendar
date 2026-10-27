// RFC 5545 §3.3.10 recurrence rules (docs/EVENTS.md §4.3, §4.5, §5.2), mirroring
// `packages/core/src/events/rrule.ts`: the `RRule` value, its strict text syntax
// (`RRule(text:)`, `.text`), semantic equality (`isEquivalent(to:)`), the reading of `UNTIL` as a
// wall-clock end (`RRuleUntil.local(zone:using:)`, `LocalDateTime.untilEndDate(startMinute:)`) and
// the writing of an end date as an `UNTIL` (`RRuleUntil.text(endDate:allDay:zone:using:)`).
//
// Syntax: `NAME=VALUE` parts separated by `;`, in any order, with an optional `RRULE:` prefix and
// one optional trailing `;`. Names and enumerated values are ASCII case-insensitive; `RSCALE`
// values and `X-` names are stored uppercase, `X-` values verbatim. Event times have minute
// precision, so an `UNTIL` date-time drops its seconds when read and is written with `59`.

/// `FREQ` values. TS: `Frequency` (lowercase strings).
public enum Frequency: String, Sendable, Hashable, Codable, CaseIterable {
    case secondly, minutely, hourly, daily, weekly, monthly, yearly
}

/// One `BYDAY` entry: a weekday with an optional ordinal (`2TU` is weekday 2, ordinal 2).
/// TS: `WeekdayNum`.
public struct WeekdayNum: Sendable, Hashable, Codable {
    public var weekday: Weekday
    /// `±1…53`, or `nil` for every such weekday.
    public var ordinal: Int?

    public init(weekday: Weekday, ordinal: Int? = nil) {
        self.weekday = weekday
        self.ordinal = ordinal
    }

    enum CodingKeys: String, CodingKey { case weekday, ordinal }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(weekday, forKey: .weekday)
        try c.encode(ordinal, forKey: .ordinal)
    }
}

/// An `UNTIL` value as written: a date, a floating date-time or a UTC date-time (seconds dropped).
/// TS: `RRuleUntil`.
public enum RRuleUntil: Sendable, Hashable {
    case date(GregorianDate)
    /// Minute `0…1439`.
    case floating(LocalDateTime)
    /// Minute `0…1439`.
    case utc(LocalDateTime)
}

/// One `X-NAME=VALUE` part of a rule (JSON: `[name, value]`).
public struct RRuleExtension: Sendable, Hashable {
    /// `X-` followed by uppercase letters, digits and `-`.
    public var name: String
    /// Characters above U+0020 except `;` and U+007F.
    public var value: String

    public init(name: String, value: String) {
        self.name = name
        self.value = value
    }
}

/// A parsed `RRULE` (or `EXRULE`) value. Lists keep their input order. TS: `RRule`.
///
/// Plain data like the TypeScript object: every engine function validates the rules it gets
/// (ranges, never both `count` and `until`) and throws ``ThirteenError/invalidRule(_:)``.
public struct RRule: Sendable, Hashable {
    public var freq: Frequency
    /// `>= 1`, default 1.
    public var interval: Int
    public var count: Int?
    /// Never both `count` and `until`.
    public var until: RRuleUntil?
    public var bySecond: [Int]
    public var byMinute: [Int]
    public var byHour: [Int]
    public var byDay: [WeekdayNum]
    /// `±1…31`.
    public var byMonthDay: [Int]
    /// `±1…366`.
    public var byYearDay: [Int]
    /// `±1…53`.
    public var byWeekNo: [Int]
    /// `1…12`.
    public var byMonth: [Int]
    /// `±1…366`.
    public var bySetPos: [Int]
    public var wkst: Weekday?
    /// RFC 7529 `RSCALE`, uppercase.
    public var rscale: String?
    /// RFC 7529 `SKIP`: `OMIT`, `BACKWARD` or `FORWARD`.
    public var skip: String?
    /// `X-NAME=VALUE` parts, kept in order.
    public var extensions: [RRuleExtension]

    public init(
        freq: Frequency, interval: Int = 1, count: Int? = nil, until: RRuleUntil? = nil, bySecond: [Int] = [],
        byMinute: [Int] = [], byHour: [Int] = [], byDay: [WeekdayNum] = [], byMonthDay: [Int] = [],
        byYearDay: [Int] = [], byWeekNo: [Int] = [], byMonth: [Int] = [], bySetPos: [Int] = [],
        wkst: Weekday? = nil, rscale: String? = nil, skip: String? = nil, extensions: [RRuleExtension] = []
    ) {
        self.freq = freq
        self.interval = interval
        self.count = count
        self.until = until
        self.bySecond = bySecond
        self.byMinute = byMinute
        self.byHour = byHour
        self.byDay = byDay
        self.byMonthDay = byMonthDay
        self.byYearDay = byYearDay
        self.byWeekNo = byWeekNo
        self.byMonth = byMonth
        self.bySetPos = bySetPos
        self.wkst = wkst
        self.rscale = rscale
        self.skip = skip
        self.extensions = extensions
    }

    /// The rule without `COUNT` and `UNTIL`.
    var withoutEnd: RRule {
        var copy = self
        copy.count = nil
        copy.until = nil
        return copy
    }
}

// MARK: - Tables

/// One numeric list part.
struct NumberListPart: Sendable {
    let keyPath: WritableKeyPath<RRule, [Int]> & Sendable
    let name: String
    /// Signed parts are `±1…max` (never 0); unsigned parts are `min…max`.
    let signed: Bool
    let min: Int
    let max: Int
    /// The RFC's digit count (`1*2DIGIT`, `1*3DIGIT`).
    let digits: Int

    func inRange(_ value: Int) -> Bool {
        signed ? value != 0 && abs(value) <= max : value >= min && value <= max
    }

    var rangeText: String { signed ? "-\(max)..-1 or 1..\(max)" : "\(min)..\(max)" }
}

enum RRuleTables {
    static let weekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]
    static let skipValues = ["OMIT", "BACKWARD", "FORWARD"]
    /// The numeric list parts in canonical order; `BYDAY` is written between `BYHOUR` and `BYMONTHDAY`.
    static let numberLists: [NumberListPart] = [
        NumberListPart(keyPath: \.bySecond, name: "BYSECOND", signed: false, min: 0, max: 60, digits: 2),
        NumberListPart(keyPath: \.byMinute, name: "BYMINUTE", signed: false, min: 0, max: 59, digits: 2),
        NumberListPart(keyPath: \.byHour, name: "BYHOUR", signed: false, min: 0, max: 23, digits: 2),
        NumberListPart(keyPath: \.byMonthDay, name: "BYMONTHDAY", signed: true, min: 1, max: 31, digits: 2),
        NumberListPart(keyPath: \.byYearDay, name: "BYYEARDAY", signed: true, min: 1, max: 366, digits: 3),
        NumberListPart(keyPath: \.byWeekNo, name: "BYWEEKNO", signed: true, min: 1, max: 53, digits: 2),
        NumberListPart(keyPath: \.byMonth, name: "BYMONTH", signed: false, min: 1, max: 12, digits: 2),
        NumberListPart(keyPath: \.bySetPos, name: "BYSETPOS", signed: true, min: 1, max: 366, digits: 3),
    ]
    /// `BYDAY` comes after this many entries of ``numberLists`` (BYSECOND, BYMINUTE, BYHOUR).
    static let byDayPosition = 3

    /// The iCalendar weekday code (`SU`…`SA`).
    static func code(_ weekday: Weekday) -> String { weekdayCodes[weekday.rawValue] }

    /// The weekday of a code (`SU`…`SA`, ASCII case-insensitive), or `nil`.
    static func weekday(code text: Substring) -> Weekday? {
        guard text.utf8.count == 2, text.unicodeScalars.allSatisfy(Text.isASCIILetter) else { return nil }
        guard let index = weekdayCodes.firstIndex(of: text.uppercased()) else { return nil }
        return Weekday(rawValue: index)
    }

    /// `^[A-Za-z0-9-]+$`.
    static func isName(_ text: Substring) -> Bool {
        !text.isEmpty && text.unicodeScalars.allSatisfy { Text.isASCIILetter($0) || Text.isASCIIDigit($0) || $0 == "-" }
    }

    /// `^[A-Z0-9-]+$` (a stored `RSCALE`).
    static func isRscale(_ text: String) -> Bool {
        !text.isEmpty
            && text.unicodeScalars.allSatisfy { ("A"..."Z").contains($0) || Text.isASCIIDigit($0) || $0 == "-" }
    }

    /// `^X-[A-Z0-9-]+$`.
    static func isXName(_ text: String) -> Bool {
        text.hasPrefix("X-") && isRscale(String(text.dropFirst(2)))
    }

    /// An `X-` value: any characters above U+0020 except `;` and U+007F.
    static func isXValue(_ text: String) -> Bool {
        !text.isEmpty && text.unicodeScalars.allSatisfy { $0.value > 0x20 && $0 != ";" && $0.value != 0x7F }
    }
}

/// Small text helpers shared by the events engine.
enum Text {
    static func isASCIIDigit(_ s: Unicode.Scalar) -> Bool { ("0"..."9").contains(s) }
    static func isASCIILetter(_ s: Unicode.Scalar) -> Bool { ("A"..."Z").contains(s) || ("a"..."z").contains(s) }

    /// Unsigned ASCII digits only, `1…maxDigits` of them, as a number (no sign, no spaces).
    static func unsigned(_ text: Substring, maxDigits: Int) -> Int? {
        guard !text.isEmpty, text.utf8.count <= maxDigits, text.unicodeScalars.allSatisfy(isASCIIDigit) else {
            return nil
        }
        return Int(text)
    }

    /// An optional `+` or `-` followed by `1…maxDigits` ASCII digits.
    static func signed(_ text: Substring, maxDigits: Int) -> Int? {
        if let first = text.first, first == "+" || first == "-" {
            guard let magnitude = unsigned(text.dropFirst(), maxDigits: maxDigits) else { return nil }
            return first == "-" ? -magnitude : magnitude
        }
        return unsigned(text, maxDigits: maxDigits)
    }

    /// Splits like JavaScript's `String.prototype.split(separator)` (empty pieces kept).
    static func split(_ text: some StringProtocol, _ separator: Character) -> [Substring] {
        Substring(text).split(separator: separator, omittingEmptySubsequences: false)
    }
}

// MARK: - iCalendar DATE and DATE-TIME text

/// A DATE or DATE-TIME value of iCalendar text, minute precision.
enum ICalTextValue {
    case date(GregorianDate)
    case local(LocalDateTime)
    case utc(LocalDateTime)

    /// Parses `yyyyMMdd`, `yyyyMMddTHHmmss` or `yyyyMMddTHHmmssZ` (`T` and `Z` in either case).
    /// Years 0001…9999, hours 00…23, minutes 00…59, seconds 00…60; seconds are dropped.
    init?(_ text: Substring) {
        let bytes = Array(text.utf8)
        guard bytes.count == 8 || bytes.count == 15 || bytes.count == 16,
            let year = Calc.digits(bytes, 0, 4), let month = Calc.digits(bytes, 4, 2), let day = Calc.digits(bytes, 6, 2),
            GregorianDate.isValid(year: year, month: month, day: day)
        else { return nil }
        let date = GregorianDate(unchecked: year, month, day)
        if bytes.count == 8 {
            self = .date(date)
            return
        }
        guard bytes[8] == UInt8(ascii: "T") || bytes[8] == UInt8(ascii: "t"),
            let hour = Calc.digits(bytes, 9, 2), let minute = Calc.digits(bytes, 11, 2),
            let second = Calc.digits(bytes, 13, 2), hour <= 23, minute <= 59, second <= 60
        else { return nil }
        let value = LocalDateTime(unchecked: date, minute: hour * 60 + minute)
        if bytes.count == 16 {
            guard bytes[15] == UInt8(ascii: "Z") || bytes[15] == UInt8(ascii: "z") else { return nil }
            self = .utc(value)
        } else {
            self = .local(value)
        }
    }

    /// `yyyyMMdd`.
    static func dateText(_ date: GregorianDate) -> String {
        "\(Calc.pad(date.year, 4))\(Calc.pad(date.month, 2))\(Calc.pad(date.day, 2))"
    }

    /// `yyyyMMddTHHmmss`, with `Z` when `utc`; `value.minute` must be `0…1439`.
    static func dateTimeText(_ value: LocalDateTime, seconds: Int, utc: Bool) -> String {
        "\(dateText(value.date))T\(Calc.pad(value.minute / 60, 2))\(Calc.pad(value.minute % 60, 2))"
            + "\(Calc.pad(seconds, 2))\(utc ? "Z" : "")"
    }
}

// MARK: - Validation

extension RRule {
    /// Validates the rule: every value one ``RRule/init(text:)`` could have produced (ranges,
    /// uppercase `rscale`, `skip` and `X-` names, never both `count` and `until`).
    /// - Throws: ``ThirteenError/invalidRule(_:)``.
    public func validate(_ context: String = "rrule") throws(ThirteenError) {
        if let problem = problem { throw .invalidRule("Invalid \(context): \(problem)") }
    }

    private var problem: String? {
        let maxInt = EventTime.maxInt
        guard (1...maxInt).contains(interval) else { return "interval must be an integer 1..\(maxInt), got \(interval)" }
        if let count, !(1...maxInt).contains(count) { return "count must be an integer 1..\(maxInt) or null, got \(count)" }
        if let until {
            switch until {
            case .date: break
            case let .floating(value), let .utc(value):
                if value.minute >= EventTime.day {
                    return "until value must be a local date-time with minute 0..1439, got \(value.isoString)"
                }
            }
        }
        if count != nil && until != nil { return "count and until cannot both be set" }
        for part in RRuleTables.numberLists where !self[keyPath: part.keyPath].allSatisfy(part.inRange) {
            return "\(part.name) must be integers \(part.rangeText), got \(self[keyPath: part.keyPath])"
        }
        for entry in byDay {
            if let ordinal = entry.ordinal, ordinal == 0 || abs(ordinal) > 53 {
                return "byDay ordinals must be -53..-1 or 1..53, got \(ordinal)"
            }
        }
        if let rscale, !RRuleTables.isRscale(rscale) {
            return "rscale must be null or uppercase letters, digits and '-', got \(Calc.quoted(rscale))"
        }
        if let skip, !RRuleTables.skipValues.contains(skip) {
            return "skip must be null or one of OMIT, BACKWARD, FORWARD, got \(Calc.quoted(skip))"
        }
        for x in extensions where !RRuleTables.isXName(x.name) || !RRuleTables.isXValue(x.value) {
            return "extensions must be [X-NAME, value] pairs (uppercase name; value without spaces, controls or ';'), "
                + "got [\(Calc.quoted(x.name)), \(Calc.quoted(x.value))]"
        }
        return nil
    }
}

// MARK: - Parsing and formatting

extension RRule {
    /// Parses an `RRULE` (or `EXRULE`) value with the strict grammar of the module documentation.
    /// Accepts an optional `RRULE:` prefix (any case) and one trailing `;`; parts may come in any
    /// order and any case. TS: `parseRRule`; use `try?` for `tryParseRRule`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for malformed text, a value outside its RFC range,
    ///   `COUNT` with `UNTIL`, or a repeated or unknown name.
    public init(text: String) throws(ThirteenError) {
        func bad(_ why: String) -> ThirteenError { .invalidRule("Invalid RRULE \(Calc.quoted(text)): \(why)") }
        var body = Substring(text)
        if body.utf8.count >= 6, body.prefix(6).uppercased() == "RRULE:" { body = body.dropFirst(6) }
        if body.hasSuffix(";") { body = body.dropLast() }
        if body.isEmpty { throw bad("FREQ is required") }

        var rule = RRule(freq: .yearly)
        var freq: Frequency?
        var seen = Set<String>()

        func items(_ name: String, _ value: Substring) throws(ThirteenError) -> [Substring] {
            let parts = Text.split(value, ",")
            if parts.contains(where: \.isEmpty) { throw bad("\(name) has an empty list item") }
            return parts
        }
        func counter(_ name: String, _ value: Substring) throws(ThirteenError) -> Int {
            guard let number = Text.unsigned(value, maxDigits: 10), (1...EventTime.maxInt).contains(number) else {
                throw bad("\(name) must be an integer 1..\(EventTime.maxInt), got \(Calc.quoted(String(value)))")
            }
            return number
        }

        for part in Text.split(body, ";") {
            let eq = part.firstIndex(of: "=")
            let rawName = eq.map { part[part.startIndex..<$0] } ?? part
            guard let eq, RRuleTables.isName(rawName) else { throw bad("expected NAME=VALUE, got \(Calc.quoted(String(part)))") }
            let name = rawName.uppercased()
            let value = part[part.index(after: eq)...]
            if value.isEmpty { throw bad("\(name) has no value") }
            if seen.contains(name) { throw bad("\(name) appears more than once") }
            seen.insert(name)

            if let list = RRuleTables.numberLists.first(where: { $0.name == name }) {
                var numbers: [Int] = []
                for item in try items(name, value) {
                    let number = list.signed ? Text.signed(item, maxDigits: list.digits) : Text.unsigned(item, maxDigits: list.digits)
                    guard let number, list.inRange(number) else {
                        throw bad("\(name) values must be \(list.rangeText), got \(Calc.quoted(String(item)))")
                    }
                    numbers.append(number)
                }
                rule[keyPath: list.keyPath] = numbers
                continue
            }
            switch name {
            case "FREQ":
                guard value.unicodeScalars.allSatisfy(Text.isASCIILetter), let parsed = Frequency(rawValue: value.lowercased())
                else { throw bad("unknown FREQ \(Calc.quoted(String(value)))") }
                freq = parsed
            case "INTERVAL":
                rule.interval = try counter(name, value)
            case "COUNT":
                rule.count = try counter(name, value)
            case "UNTIL":
                switch ICalTextValue(value) {
                case let .date(date)?: rule.until = .date(date)
                case let .local(local)?: rule.until = .floating(local)
                case let .utc(utc)?: rule.until = .utc(utc)
                case nil:
                    throw bad(
                        "UNTIL must be yyyyMMdd, yyyyMMddTHHmmss or yyyyMMddTHHmmssZ, got \(Calc.quoted(String(value)))")
                }
            case "BYDAY":
                var days: [WeekdayNum] = []
                for item in try items(name, value) {
                    guard let entry = RRule.byDayItem(item) else {
                        throw bad(
                            "BYDAY values must be SU..SA with an optional ordinal -53..-1 or 1..53, got \(Calc.quoted(String(item)))")
                    }
                    days.append(entry)
                }
                rule.byDay = days
            case "WKST":
                guard let weekday = RRuleTables.weekday(code: value) else {
                    throw bad("WKST must be SU..SA, got \(Calc.quoted(String(value)))")
                }
                rule.wkst = weekday
            case "RSCALE":
                guard RRuleTables.isName(value) else {
                    throw bad("RSCALE must be letters, digits and '-', got \(Calc.quoted(String(value)))")
                }
                rule.rscale = value.uppercased()
            case "SKIP":
                let upper = value.unicodeScalars.allSatisfy(Text.isASCIILetter) ? value.uppercased() : ""
                guard RRuleTables.skipValues.contains(upper) else {
                    throw bad("SKIP must be OMIT, BACKWARD or FORWARD, got \(Calc.quoted(String(value)))")
                }
                rule.skip = upper
            default:
                guard RRuleTables.isXName(name) else { throw bad("unknown part \(name)") }
                guard RRuleTables.isXValue(String(value)) else {
                    throw bad("\(name) has a space, a control character or ';' in its value")
                }
                rule.extensions.append(RRuleExtension(name: name, value: String(value)))
            }
        }
        guard let freq else { throw bad("FREQ is required") }
        if rule.count != nil && rule.until != nil { throw bad("COUNT and UNTIL cannot both be present") }
        rule.freq = freq
        self = rule
    }

    /// `^(?:([+-]?)(\d{1,2}))?([A-Za-z]{2})$` with a non-zero ordinal up to 53.
    private static func byDayItem(_ item: Substring) -> WeekdayNum? {
        guard item.utf8.count >= 2 else { return nil }
        let code = item.suffix(2)
        guard let weekday = RRuleTables.weekday(code: code) else { return nil }
        let prefix = item.dropLast(2)
        if prefix.isEmpty { return WeekdayNum(weekday: weekday, ordinal: nil) }
        guard let ordinal = Text.signed(prefix, maxDigits: 2), ordinal != 0, abs(ordinal) <= 53 else { return nil }
        return WeekdayNum(weekday: weekday, ordinal: ordinal)
    }

    /// The canonical text of the rule, without a prefix:
    /// `FREQ;INTERVAL (if not 1);COUNT or UNTIL;BYSECOND;BYMINUTE;BYHOUR;BYDAY;BYMONTHDAY;BYYEARDAY;
    /// BYWEEKNO;BYMONTH;BYSETPOS;WKST;RSCALE;SKIP;X- parts`. Empty lists are left out, list values
    /// keep their stored order. A date-time `UNTIL` is written with seconds `59`. TS: `formatRRule`
    /// (the rule must be valid: see ``validate(_:)``).
    public var text: String {
        var parts = ["FREQ=\(freq.rawValue.uppercased())"]
        if interval != 1 { parts.append("INTERVAL=\(interval)") }
        if let count { parts.append("COUNT=\(count)") }
        if let until { parts.append("UNTIL=\(until.valueText)") }
        for (index, list) in RRuleTables.numberLists.enumerated() {
            if index == RRuleTables.byDayPosition, !byDay.isEmpty {
                let days = byDay.map { "\($0.ordinal.map(String.init) ?? "")\(RRuleTables.code($0.weekday))" }
                parts.append("BYDAY=\(days.joined(separator: ","))")
            }
            let values = self[keyPath: list.keyPath]
            if !values.isEmpty { parts.append("\(list.name)=\(values.map(String.init).joined(separator: ","))") }
        }
        if let wkst { parts.append("WKST=\(RRuleTables.code(wkst))") }
        if let rscale { parts.append("RSCALE=\(rscale)") }
        if let skip { parts.append("SKIP=\(skip)") }
        for x in extensions { parts.append("\(x.name)=\(x.value)") }
        return parts.joined(separator: ";")
    }

    /// The canonical text after validating the rule. TS: `formatRRule`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid rule.
    public func formatted() throws(ThirteenError) -> String {
        try validate()
        return text
    }

    // MARK: Equality

    /// `true` when two rules mean the same (TS `rruleEquals`): equal `freq` and `interval`, equal
    /// `count` and `until`, every list compared as a set, `BYDAY` entries by weekday and ordinal,
    /// and the RFC defaults applied (no `WKST` = `MO`, no `RSCALE` = `GREGORIAN`, no `SKIP` =
    /// `OMIT`). `X-` parts are compared as a set of name and value pairs. `ignoringEnd` leaves out
    /// `count` and `until`, `ignoringWkst` leaves out `wkst`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid rule.
    public func isEquivalent(to other: RRule, ignoringEnd: Bool = false, ignoringWkst: Bool = false) throws(ThirteenError)
        -> Bool
    {
        try validate("first rrule")
        try other.validate("second rrule")
        return equivalent(to: other, ignoringEnd: ignoringEnd, ignoringWkst: ignoringWkst)
    }

    func equivalent(to b: RRule, ignoringEnd: Bool, ignoringWkst: Bool) -> Bool {
        let a = self
        if a.freq != b.freq || a.interval != b.interval { return false }
        if !ignoringEnd {
            if a.count != b.count { return false }
            switch (a.until, b.until) {
            case (nil, nil): break
            case let (x?, y?): if x.kindName != y.kindName || x.valueText != y.valueText { return false }
            default: return false
            }
        }
        for list in RRuleTables.numberLists where Set(a[keyPath: list.keyPath]) != Set(b[keyPath: list.keyPath]) {
            return false
        }
        if Set(a.byDay) != Set(b.byDay) { return false }
        if !ignoringWkst && (a.wkst ?? .monday) != (b.wkst ?? .monday) { return false }
        if (a.rscale ?? "GREGORIAN") != (b.rscale ?? "GREGORIAN") || (a.skip ?? "OMIT") != (b.skip ?? "OMIT") { return false }
        return Set(a.extensions) == Set(b.extensions)
    }
}

// MARK: - UNTIL (§4.4, §4.5)

extension RRuleUntil {
    var kindName: String {
        switch self {
        case .date: "date"
        case .floating: "floating"
        case .utc: "utc"
        }
    }

    /// The text of the value as the formatter writes it (`yyyyMMdd`, `yyyyMMddTHHmm59`, `…Z`).
    var valueText: String {
        switch self {
        case let .date(date): ICalTextValue.dateText(date)
        case let .floating(value): ICalTextValue.dateTimeText(value, seconds: 59, utc: false)
        case let .utc(value): ICalTextValue.dateTimeText(value, seconds: 59, utc: true)
        }
    }

    func validate() throws(ThirteenError) {
        switch self {
        case .date: return
        case let .floating(value), let .utc(value):
            guard value.minute < EventTime.day else {
                throw .invalidRule("Invalid UNTIL: until value must be a local date-time with minute 0..1439, got \(value.isoString)")
            }
        }
    }

    /// The `UNTIL` as a wall-clock value in the event's zone (§4.5), rounded down to the minute: a
    /// DATE until becomes `D T24:00`; a floating until is kept as it is; a UTC until is converted
    /// to `zone` (with `zone` nil, a floating or all-day event, its wall clock is kept as it is).
    /// TS: `untilInZone`.
    /// - Returns: `nil` when a UTC until converts to a wall clock outside years 1 to 9999.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for an empty or unknown zone.
    public func local(zone: String?, using zones: any ZoneResolver) throws(ThirteenError) -> LocalDateTime? {
        try validate()
        if let zone { try ZoneMath.checkZone(zone, zones) }
        switch self {
        case let .date(date): return LocalDateTime(unchecked: date, minute: EventTime.day)
        case let .floating(value): return value
        case let .utc(value):
            guard let zone else { return value }
            return LocalDateTime.plain(absolute: try ZoneMath.toZoned(value.absoluteMinutes, zone, zones, nil))
        }
    }

    /// Absolute minute of 9999-12-31T23:59, the last UTC minute an `UNTIL` can name.
    private static let lastUntilAbsolute = GregorianDate.maxJulianDayNumber * EventTime.day + EventTime.day - 1

    /// The `UNTIL` value text that ends a rule after `endDate` (§4.4 Ends, §4.7 retiming), without
    /// `UNTIL=`: all-day `yyyyMMdd`; floating (`zone` nil) `yyyyMMddT235959`; zoned the instant of
    /// 23:59:59 of `endDate` in `zone` as UTC `yyyyMMddTHHmmssZ` (an instant after
    /// 9999-12-31T23:59:59Z is written as `99991231T235959Z`). TS: `formatUntil`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` (timed, zoned) for an empty or unknown zone.
    public static func text(endDate: GregorianDate, allDay: Bool, zone: String?, using zones: any ZoneResolver)
        throws(ThirteenError) -> String
    {
        if allDay { return ICalTextValue.dateText(endDate) }
        let endOfDay = LocalDateTime(unchecked: endDate, minute: EventTime.day - 1)
        guard let zone else { return ICalTextValue.dateTimeText(endOfDay, seconds: 59, utc: false) }
        try ZoneMath.checkZone(zone, zones)
        let utc = min(try ZoneMath.toUtc(endOfDay.absoluteMinutes, zone, zones), lastUntilAbsolute)
        return ICalTextValue.dateTimeText(LocalDateTime.plain(absolute: utc)!, seconds: 59, utc: true)
    }
}

extension LocalDateTime {
    /// The last original date whose occurrence, starting at `startMinute`, starts at or before this
    /// until (§4.5): the until's date when `startMinute` is at or before its minute, else the day
    /// before. A DATE until (`D T24:00`) gives `D`. TS: `untilEndDate(until, startMinute)`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for a `startMinute` outside `0…1439`, or a
    ///   result before 0001-01-01.
    public func untilEndDate(startMinute: Int) throws(ThirteenError) -> GregorianDate {
        guard (0...1439).contains(startMinute) else {
            throw .invalidEvent("Start minute must be an integer 0..1439, got \(startMinute)")
        }
        if startMinute <= minute { return date }
        guard date.julianDayNumber > GregorianDate.minJulianDayNumber else {
            throw .invalidEvent(
                "No date before 0001-01-01: an occurrence at minute \(startMinute) starts after the until 0001-01-01 minute \(minute)")
        }
        return GregorianDate(uncheckedJulianDayNumber: date.julianDayNumber - 1)
    }
}

// MARK: - Codable (docs/EVENTS.md §5.5 JSON forms)

extension RRuleUntil: Codable {
    enum CodingKeys: String, CodingKey { case kind, date, value }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "date": self = .date(try c.decode(EventJSONDate.self, forKey: .date).date)
        case "floating": self = .floating(try c.decode(LocalDateTime.self, forKey: .value))
        case "utc": self = .utc(try c.decode(LocalDateTime.self, forKey: .value))
        case let kind:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "until kind must be 'date', 'floating' or 'utc', got '\(kind)'")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kindName, forKey: .kind)
        switch self {
        case let .date(date): try c.encode(date.isoString, forKey: .date)
        case let .floating(value), let .utc(value): try c.encode(value, forKey: .value)
        }
    }
}

extension RRuleExtension: Codable {
    public init(from decoder: any Decoder) throws {
        var c = try decoder.unkeyedContainer()
        name = try c.decode(String.self)
        value = try c.decode(String.self)
        guard c.isAtEnd else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "An extension is a [name, value] pair")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.unkeyedContainer()
        try c.encode(name)
        try c.encode(value)
    }
}

extension RRule: Codable {
    enum CodingKeys: String, CodingKey {
        case freq, interval, count, until, bySecond, byMinute, byHour, byDay, byMonthDay, byYearDay, byWeekNo, byMonth,
            bySetPos, wkst, rscale, skip, extensions
    }

    /// Decodes the full JSON object of §5.5 (every field present) and validates it.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            freq: try c.decode(Frequency.self, forKey: .freq),
            interval: try c.decode(Int.self, forKey: .interval),
            count: try c.decode(Int?.self, forKey: .count),
            until: try c.decode(RRuleUntil?.self, forKey: .until),
            bySecond: try c.decode([Int].self, forKey: .bySecond),
            byMinute: try c.decode([Int].self, forKey: .byMinute),
            byHour: try c.decode([Int].self, forKey: .byHour),
            byDay: try c.decode([WeekdayNum].self, forKey: .byDay),
            byMonthDay: try c.decode([Int].self, forKey: .byMonthDay),
            byYearDay: try c.decode([Int].self, forKey: .byYearDay),
            byWeekNo: try c.decode([Int].self, forKey: .byWeekNo),
            byMonth: try c.decode([Int].self, forKey: .byMonth),
            bySetPos: try c.decode([Int].self, forKey: .bySetPos),
            wkst: try c.decode(Weekday?.self, forKey: .wkst),
            rscale: try c.decode(String?.self, forKey: .rscale),
            skip: try c.decode(String?.self, forKey: .skip),
            extensions: try c.decode([RRuleExtension].self, forKey: .extensions))
        do {
            try validate()
        } catch {
            throw DecodingError.dataCorrupted(.init(codingPath: c.codingPath, debugDescription: String(describing: error)))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(freq, forKey: .freq)
        try c.encode(interval, forKey: .interval)
        try c.encode(count, forKey: .count)
        try c.encode(until, forKey: .until)
        try c.encode(bySecond, forKey: .bySecond)
        try c.encode(byMinute, forKey: .byMinute)
        try c.encode(byHour, forKey: .byHour)
        try c.encode(byDay, forKey: .byDay)
        try c.encode(byMonthDay, forKey: .byMonthDay)
        try c.encode(byYearDay, forKey: .byYearDay)
        try c.encode(byWeekNo, forKey: .byWeekNo)
        try c.encode(byMonth, forKey: .byMonth)
        try c.encode(bySetPos, forKey: .bySetPos)
        try c.encode(wkst, forKey: .wkst)
        try c.encode(rscale, forKey: .rscale)
        try c.encode(skip, forKey: .skip)
        try c.encode(extensions, forKey: .extensions)
    }
}

/// A Gregorian date in the events JSON form, `"YYYY-MM-DD"` (§5.5).
struct EventJSONDate: Codable, Hashable, Sendable {
    let date: GregorianDate

    init(_ date: GregorianDate) { self.date = date }

    init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        let text = try c.decode(String.self)
        do {
            date = try GregorianDate(isoString: text)
        } catch {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: String(describing: error))
        }
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(date.isoString)
    }
}
