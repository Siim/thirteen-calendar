// 13-month repeat rules (docs/EVENTS.md §4.2 to §4.5, §5.2), mirroring
// `packages/core/src/events/thirteen-rules.ts`: the `ThirteenRule` value, the rule made from a
// start, its dates, its one `RRULE` encoding (forms (a) to (c) of §4.3), the date list of form (d)
// (`rdates`), the `X-THIRTEEN-RULE` marker text and the Android rule URI (recognition reads both).
// Not ported (Android only, §5.7): `thirteenRuleRdateParts`, `formatDetachedUri`, `parseDetachedUri`.
//
// Dates come from the system's own month and intercalary tables, so they are exact for years 1 to
// 9999. An every-2-weeks rule takes its fortnight phase from the start: the 13-month weekday `w`
// falls on month days `k`, `k + 7`, `k + 14`, `k + 21`; the rule keeps the two in the start's week
// parity (weeks 1 and 3, or 2 and 4). A start on an intercalary day counts as week 1.

/// A repeat that follows the 13-month calendar of `system` (§4.2). TS: `ThirteenRule`.
///
/// JSON (§5.5): `{"kind":"monthly","system":"ifc","day":12}`,
/// `{"kind":"weekly","system":"ifc","weekday":4,"interval":2}`,
/// `{"kind":"yearly","system":"ifc","month":11,"day":12}`,
/// `{"kind":"intercalary","system":"ifc","id":"leap-day"}`.
public enum ThirteenRule: Sendable, Hashable {
    /// Every 13-month month on `day` (`1…28`).
    case monthly(system: CalendarSystemID, day: Int)
    /// Every (`interval` 1) or every second (`interval` 2) 13-month week on the 13-month `weekday`.
    case weekly(system: CalendarSystemID, weekday: Weekday, interval: Int)
    /// Every year on 13-month `month` (`1…13`) and `day` (`1…28`).
    case yearly(system: CalendarSystemID, month: Int, day: Int)
    /// Every Year Day or Leap Day (Positivist: Festival of All the Dead or of Holy Women).
    case intercalary(system: CalendarSystemID, id: IntercalaryDayID)

    /// The system the rule was made in.
    public var system: CalendarSystemID {
        switch self {
        case let .monthly(system, _), let .weekly(system, _, _), let .yearly(system, _, _), let .intercalary(system, _):
            system
        }
    }

    var kindName: String {
        switch self {
        case .monthly: "monthly"
        case .weekly: "weekly"
        case .yearly: "yearly"
        case .intercalary: "intercalary"
        }
    }
}

/// The 13-month rows of the repeat picker (§2.13); `biweekly` is the weekly rule with interval 2.
/// TS: `ThirteenRuleKind`.
public enum ThirteenRuleKind: String, Sendable, Hashable, Codable, CaseIterable {
    case monthly, weekly, biweekly, yearly, intercalary
}

/// The three `RRULE` encodings of §4.3: (a) plain yearly, (b) day-of-year list, (c) leap interval.
/// TS: `ThirteenEncodingForm`.
public enum ThirteenEncodingForm: String, Sendable, Hashable, Codable {
    case gregorianYearly = "gregorian-yearly"
    case byYearDay = "byyearday"
    case leapInterval = "leap-interval"
}

/// A rule's one `RRULE` encoding (§4.3), as Apple, Windows, the web and `.ics` export store it.
/// TS: `ThirteenEncoding`.
public struct ThirteenEncoding: Sendable, Hashable {
    public let form: ThirteenEncodingForm
    /// Without `COUNT` or `UNTIL`, except the leap-interval cap (a DATE until).
    public let rrule: RRule
    /// `form != .byYearDay`: Exchange and Outlook keep the rule.
    public let exchangeSafe: Bool
    /// The leap-interval cap (§4.3 c); `nil` for the other forms.
    public let cap: GregorianDate?
}

/// A parsed Android rule URI (§4.3 e): the rule, its end and the parts extras. TS: the result of
/// `parseThirteenRuleUri`.
public struct ThirteenRuleURI: Sendable, Hashable {
    public let rule: ThirteenRule
    public let end: RepeatEnd
    /// Lowercase UUID shared by every part of a series, or `nil`.
    public let series: String?
    /// The part number, `1…`, or `nil` (set together with `series`).
    public let part: Int?
}

// MARK: - Validation and tables

/// A rule's dates as days of the year, ascending, in common and in leap years.
struct RuleYearDays: Sendable {
    let common: [Int]
    let leap: [Int]
}

extension ThirteenRule {
    /// Validates the rule's fields (day `1…28`, month `1…13`, interval 1 or 2).
    /// - Throws: ``ThirteenError/invalidRule(_:)``.
    public func validate() throws(ThirteenError) {
        let problem: String?
        switch self {
        case let .monthly(_, day):
            problem = (1...28).contains(day) ? nil : "day must be an integer 1..28, got \(day)"
        case let .weekly(_, _, interval):
            problem = interval == 1 || interval == 2 ? nil : "interval must be 1 or 2, got \(interval)"
        case let .yearly(_, month, day):
            problem =
                !(1...13).contains(month)
                ? "month must be an integer 1..13, got \(month)"
                : (1...28).contains(day) ? nil : "day must be an integer 1..28, got \(day)"
        case .intercalary:
            problem = nil
        }
        if let problem { throw .invalidRule("Invalid 13-month rule: \(problem)") }
    }

    /// Day of the year of 13-month month day `month`/`day`: its position plus the intercalary days
    /// before its month.
    private static func monthDayOfYear(_ system: CalendarSystemID, leap: Bool, _ month: Int, _ day: Int) -> Int {
        var before = 0
        for placement in system.placements(leap: leap) where placement.afterMonth < month { before += 1 }
        return 28 * (month - 1) + day + before
    }

    /// The month days of a weekly rule (§4.2): `k, k + 7, k + 14, k + 21`, or two of them in week
    /// parity `phase` for every 2 weeks.
    private static func weeklyDays(_ system: CalendarSystemID, _ weekday: Weekday, _ interval: Int, _ phase: Int) -> [Int] {
        let first = Calc.mod(weekday.rawValue - system.weekStartsOn.rawValue, 7) + 1
        let weeks = interval == 1 ? [0, 1, 2, 3] : [phase, phase + 2]
        return weeks.map { first + 7 * $0 }
    }

    /// The rule's dates as days of the year in common and leap years, in fortnight phase `phase`.
    func yearDays(phase: Int) -> RuleYearDays {
        let pairs: [(month: Int, day: Int)]
        switch self {
        case let .intercalary(system, id):
            let info = system.intercalaryDayInfo(id)
            return RuleYearDays(common: info.dayOfYear.common.map { [$0] } ?? [], leap: [info.dayOfYear.leap])
        case let .yearly(_, month, day):
            pairs = [(month, day)]
        case let .monthly(_, day):
            pairs = (1...13).map { ($0, day) }
        case let .weekly(system, weekday, interval):
            let days = ThirteenRule.weeklyDays(system, weekday, interval, phase)
            pairs = (1...13).flatMap { month in days.map { (month, $0) } }
        }
        return RuleYearDays(
            common: pairs.map { ThirteenRule.monthDayOfYear(system, leap: false, $0.month, $0.day) },
            leap: pairs.map { ThirteenRule.monthDayOfYear(system, leap: true, $0.month, $0.day) })
    }

    /// The fortnight phase of the rule for a start: 0 = weeks 1 and 3, 1 = weeks 2 and 4.
    func phase(start: GregorianDate) -> Int {
        guard case let .weekly(system, _, interval) = self, interval == 2 else { return 0 }
        guard case let .month(date) = start.thirteen(in: system) else { return 0 }
        return ((date.day - 1) / 7) % 2
    }

    /// The rule's dates as days of the year in the fortnight phase of `start` (valid rule).
    func yearDays(start: GregorianDate) -> RuleYearDays { yearDays(phase: phase(start: start)) }

    /// The rule's day-of-year list as form (b) writes it (positive values first, then negative values
    /// from -366 up), or `nil` for the leap-only rules. Valid rule.
    func yearDayList(start: GregorianDate) -> [Int]? {
        let days = yearDays(start: start)
        if days.common.isEmpty { return nil }
        return Array(Set(zip(days.common, days.leap).map { ThirteenRule.yearDayValue($0, $1) })).sorted(by: ThirteenRule.yearDayOrder)
    }

    /// The `BYYEARDAY` value of a date at day `common` of common years and `leap` of leap years.
    private static func yearDayValue(_ common: Int, _ leap: Int) -> Int {
        common == leap ? common : common - 366
    }

    /// `BYYEARDAY` order of §4.3 (b): positive values ascending, then negative values from -366 up.
    private static func yearDayOrder(_ a: Int, _ b: Int) -> Bool {
        if (a > 0) != (b > 0) { return a > 0 }
        return a < b
    }

    /// The rule's dates in a valid year, ascending.
    static func dates(_ days: RuleYearDays, year: Int) -> [GregorianDate] {
        let base = Calc.julianDayNumber(year, 1, 1)
        return (Calc.isLeap(year) ? days.leap : days.common).map { GregorianDate(uncheckedJulianDayNumber: base + $0 - 1) }
    }
}

// MARK: - Rules from a start, dates, inclusion (§4.2)

extension ThirteenRule {
    /// The 13-month rule of `kind` made from `start` in `system` (§4.2, §2.13): monthly on the
    /// start's month day, weekly or every 2 weeks on its 13-month weekday, yearly on its 13-month
    /// month and day, or the intercalary rule of its intercalary day. `nil` when the start cannot
    /// carry that kind (monthly, weekly and yearly rules cannot start on an intercalary day, and an
    /// intercalary rule starts only on its own day). TS: `thirteenRuleFor`.
    public init?(_ kind: ThirteenRuleKind, start: GregorianDate, system: CalendarSystemID = .ifc) {
        switch (kind, start.thirteen(in: system)) {
        case let (.intercalary, .intercalary(date)): self = .intercalary(system: system, id: date.id)
        case (.intercalary, .month), (_, .intercalary): return nil
        case let (.monthly, .month(date)): self = .monthly(system: system, day: date.day)
        case let (.yearly, .month(date)): self = .yearly(system: system, month: date.month, day: date.day)
        case let (.weekly, .month(date)): self = .weekly(system: system, weekday: date.weekday, interval: 1)
        case let (.biweekly, .month(date)): self = .weekly(system: system, weekday: date.weekday, interval: 2)
        }
    }

    /// The rule's dates in Gregorian year `year`, ascending (§4.2): 13 for a monthly rule, 52 for a
    /// weekly rule, 26 for an every-2-weeks rule (in the fortnight phase of `start`), one for a
    /// yearly rule, and one or none for an intercalary rule. The series' start and end do not limit
    /// them; `start` fixes only the fortnight phase. TS: `thirteenRuleDatesInYear`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` or ``ThirteenError/yearOutOfRange(_:)``.
    public func dates(inYear year: Int, start: GregorianDate) throws(ThirteenError) -> [GregorianDate] {
        try validate()
        try GregorianDate.validateYear(year)
        return ThirteenRule.dates(yearDays(start: start), year: year)
    }

    /// `true` when `date` is one of the rule's dates (§4.2), in the fortnight phase of `start` for an
    /// every-2-weeks rule. `rule.includes(start, start: start)` tells whether a start is on the rule.
    /// TS: `thirteenRuleIncludes`.
    /// - Throws: ``ThirteenError/invalidRule(_:)``.
    public func includes(_ date: GregorianDate, start: GregorianDate) throws(ThirteenError) -> Bool {
        try validate()
        return contains(date, start: start)
    }

    /// ``includes(_:start:)`` for a valid rule.
    func contains(_ date: GregorianDate, start: GregorianDate) -> Bool {
        let thirteen = date.thirteen(in: system)
        switch (self, thirteen) {
        case let (.intercalary(_, id), .intercalary(day)): return day.id == id
        case (.intercalary, _), (_, .intercalary): return false
        case let (.monthly(_, day), .month(m)): return m.day == day
        case let (.yearly(_, month, day), .month(m)): return m.month == month && m.day == day
        case let (.weekly(system, weekday, interval), .month(m)):
            return ThirteenRule.weeklyDays(system, weekday, interval, phase(start: start)).contains(m.day)
        }
    }
}

// MARK: - Encodings (§4.3 a to c)

extension ThirteenRule {
    /// The `RRULE` form a valid rule is encoded in (§4.3): leap-only intercalary days use the leap
    /// interval (c); a yearly or intercalary rule whose Gregorian month and day are the same in
    /// common and leap years is the plain yearly rule (a); every other rule is a day-of-year list (b).
    var encodingForm: ThirteenEncodingForm {
        switch self {
        case .monthly, .weekly: return .byYearDay
        default:
            let days = yearDays(phase: 0)
            guard let common = days.common.first else { return .leapInterval }
            // Day `common` of a common year and day `leap` of a leap year: the same month and day?
            let a = Calc.monthDay(2001, dayOfYear: common)
            let b = Calc.monthDay(2004, dayOfYear: days.leap[0])
            return a.month == b.month && a.day == b.day ? .gregorianYearly : .byYearDay
        }
    }

    /// The last leap year in range (9996): the latest possible leap-interval cap.
    private static let lastLeapYear = 9996

    /// The leap-interval cap (§4.3 c) of a leap-only rule starting on its day in `startYear`.
    private static func leapCap(_ days: RuleYearDays, startYear: Int) -> GregorianDate {
        var century = (startYear / 100 + 1) * 100
        while century % 400 == 0 { century += 100 }
        let year = min(century - 4, lastLeapYear)
        return GregorianDate(uncheckedJulianDayNumber: Calc.julianDayNumber(year, 1, 1) + days.leap[0] - 1)
    }

    /// The last date a leap-only repeat may produce from `start`, its leap-interval cap (§4.3 c);
    /// `nil` for every other rule. The start need not be one of the rule's dates. Valid rule.
    func cap(start: GregorianDate) -> GregorianDate? {
        guard encodingForm == .leapInterval else { return nil }
        return ThirteenRule.leapCap(yearDays(phase: 0), startYear: start.year)
    }

    /// The rule's one `RRULE` encoding (§4.3): (a) `.gregorianYearly` `FREQ=YEARLY` (date from
    /// `DTSTART`), (b) `.byYearDay` `FREQ=YEARLY;BYYEARDAY=list` (positive values first; IFC months
    /// 7 to 13 count back from December 31), (c) `.leapInterval` `FREQ=YEARLY;INTERVAL=4;UNTIL={cap}`.
    /// Only (b) is not Exchange-safe. Forms (a) and (c) take their dates from `DTSTART`, so `start`
    /// must be one of the rule's dates. TS: `encodeThirteenRule`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid rule or a start the rule does not produce.
    public func encoding(start: GregorianDate) throws(ThirteenError) -> ThirteenEncoding {
        try validate()
        guard contains(start, start: start) else {
            throw .invalidRule(
                "Cannot encode a 13-month rule from \(start.isoString): the rule does not produce its start (\(markerText))")
        }
        let form = encodingForm
        switch form {
        case .gregorianYearly:
            return ThirteenEncoding(form: form, rrule: RRule(freq: .yearly), exchangeSafe: true, cap: nil)
        case .byYearDay:
            return ThirteenEncoding(
                form: form, rrule: RRule(freq: .yearly, byYearDay: yearDayList(start: start) ?? []), exchangeSafe: false,
                cap: nil)
        case .leapInterval:
            let cap = ThirteenRule.leapCap(yearDays(start: start), startYear: start.year)
            return ThirteenEncoding(
                form: form, rrule: RRule(freq: .yearly, interval: 4, until: .date(cap)), exchangeSafe: true, cap: cap)
        }
    }
}

// MARK: - Android date lists (§4.3 d, §4.4)

extension ThirteenRule {
    /// The rule's dates after `start`, ascending, up to the end and `horizon`, at most `limit` of
    /// them; `more` tells whether another date was left out by the limit. A `count` end counts the start.
    func datesAfter(start: GregorianDate, end: RepeatEnd, horizon: GregorianDate, limit: Int)
        -> (dates: [GregorianDate], more: Bool)
    {
        let days = yearDays(start: start)
        let first = start.julianDayNumber
        var last = horizon.julianDayNumber
        if case let .until(date) = end { last = min(last, date.julianDayNumber) }
        var remaining = if case let .count(count) = end { count - 1 } else { Int.max }
        var dates: [GregorianDate] = []
        var year = start.year
        while year <= GregorianDate.maxYear && remaining > 0 {
            let base = Calc.julianDayNumber(year, 1, 1)
            if base > last { break }
            for doy in Calc.isLeap(year) ? days.leap : days.common {
                let day = base + doy - 1
                if day <= first { continue }
                if day > last { return (dates, false) }
                if dates.count == limit { return (dates, true) }
                dates.append(GregorianDate(uncheckedJulianDayNumber: day))
                remaining -= 1
                if remaining == 0 { break }
            }
            year += 1
        }
        return (dates, false)
    }

    /// The `RDATE` values of form (d) (§4.3 d, §4.4): the rule's dates after `start`, ascending, up to
    /// the end and through `horizon`. A `count` end counts the start; an `until` end includes its
    /// date. At most `maxValues` dates (default 400, one Android part); `truncated` is `true` when
    /// more exist before the end and the horizon. TS: `thirteenRuleRdates`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid rule, end or `maxValues`.
    public func rdates(start: GregorianDate, end: RepeatEnd, horizon: GregorianDate, maxValues: Int = 400)
        throws(ThirteenError) -> (dates: [GregorianDate], truncated: Bool)
    {
        try validate()
        try end.validate("thirteenRuleRdates")
        guard (1...EventTime.maxInt).contains(maxValues) else {
            throw .invalidRule("thirteenRuleRdates option 'maxValues' must be an integer 1..\(EventTime.maxInt), got \(maxValues)")
        }
        let result = datesAfter(start: start, end: end, horizon: horizon, limit: maxValues)
        return (result.dates, result.more)
    }
}

// MARK: - Markers (§4.3 e)

extension ThirteenRule {
    private static let intercalaryCodes: [IntercalaryDayID: String] = [.yearDay: "YD", .leapDay: "LD"]

    /// The rule's keys and values in marker order; `upper` gives the `X-THIRTEEN-RULE` key names.
    private func fields(upper: Bool) -> [String] {
        func key(_ name: String) -> String { upper ? name.uppercased() : name }
        var fields = ["\(key("system"))=\(system.rawValue)", "\(key("kind"))=\(kindName)"]
        switch self {
        case let .monthly(_, day):
            fields.append("\(key("day"))=\(day)")
        case let .weekly(_, weekday, interval):
            fields.append("\(key("weekday"))=\(RRuleTables.code(weekday))")
            if interval == 2 { fields.append("\(key("interval"))=2") }
        case let .yearly(_, month, day):
            fields.append("\(key("month"))=\(month)")
            fields.append("\(key("day"))=\(day)")
        case let .intercalary(_, id):
            fields.append("\(key("day"))=\(ThirteenRule.intercalaryCodes[id]!)")
        }
        return fields
    }

    /// The rule's canonical marker value (§4.3 e), without `X-THIRTEEN-RULE;VERSION=1:`:
    /// `SYSTEM=ifc;KIND=weekly;WEEKDAY=TH;INTERVAL=2`. TS: `formatThirteenRuleText` (valid rule).
    public var markerText: String { fields(upper: true).joined(separator: ";") }

    /// Parses a marker value (§4.3 e) with the strict grammar `SYSTEM=(ifc|positivist);KIND=(…)`
    /// followed by `DAY=1..28`, `WEEKDAY=SU..SA[;INTERVAL=1|2]`, `MONTH=1..13;DAY=1..28` or
    /// `DAY=YD|LD`. TS: `parseThirteenRuleText`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for text that does not match the grammar.
    public init(markerText text: String) throws(ThirteenError) {
        let context = "Invalid 13-month rule text \(Calc.quoted(text))"
        var reader = FieldReader(pairs: try FieldReader.split(text, ";", context), upper: true, context: context)
        self = try reader.rule()
        try reader.done()
    }

    /// The Android marker URI (§4.3 e) of the rule and its end:
    /// `thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never`, then `series` and `part`
    /// for a series stored in parts. TS: `formatThirteenRuleUri`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid rule or end, a series that is not
    ///   a lowercase UUID, a part outside `1…2147483647`, or only one of the two.
    public func uri(end: RepeatEnd, series: String? = nil, part: Int? = nil) throws(ThirteenError) -> String {
        try validate()
        try end.validate("formatThirteenRuleUri")
        if let series, !FieldReader.isUUID(series) {
            throw .invalidRule("formatThirteenRuleUri: series must be a lowercase UUID or null, got \(Calc.quoted(series))")
        }
        if let part, !(1...EventTime.maxInt).contains(part) {
            throw .invalidRule("formatThirteenRuleUri: part must be an integer 1..\(EventTime.maxInt) or null, got \(part)")
        }
        if (series == nil) != (part == nil) {
            throw .invalidRule("formatThirteenRuleUri: series and part must be both set or both null")
        }
        var fields = ["v=1"] + fields(upper: false) + ["end=\(end.uriText)"]
        if let series, let part { fields += ["series=\(series)", "part=\(part)"] }
        return FieldReader.rulePrefix + fields.joined(separator: "&")
    }
}

extension ThirteenRuleURI {
    /// Parses an Android marker URI (§4.3 e) with the strict grammar written by
    /// ``ThirteenRule/uri(end:series:part:)``. TS: `parseThirteenRuleUri`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for anything else, including another version.
    public init(text: String) throws(ThirteenError) {
        let context = "Invalid 13-month rule URI \(Calc.quoted(text))"
        guard text.hasPrefix(FieldReader.rulePrefix) else {
            throw .invalidRule("\(context): expected the prefix '\(FieldReader.rulePrefix)'")
        }
        let body = text.dropFirst(FieldReader.rulePrefix.count)
        var reader = FieldReader(pairs: try FieldReader.split(body, "&", context), upper: false, context: context)
        _ = try reader.oneOf("v", ["1"])
        let rule = try reader.rule()
        let end = try RepeatEnd(uriText: try reader.take("end"), context: context)
        var series: String?
        var part: Int?
        if reader.next("series") {
            let value = try reader.take("series")
            guard FieldReader.isUUID(value) else {
                throw .invalidRule("\(context): series must be a lowercase UUID, got \(Calc.quoted(value))")
            }
            series = value
            part = try reader.number("part", 1, EventTime.maxInt)
        }
        try reader.done()
        self.init(rule: rule, end: end, series: series, part: part)
    }
}

/// Reads `KEY=VALUE` pairs in a fixed order; every mismatch throws with `context`.
private struct FieldReader {
    static let rulePrefix = "thirteen://rule?"

    let pairs: [(key: String, value: String)]
    let upper: Bool
    let context: String
    var index = 0

    init(pairs: [(key: String, value: String)], upper: Bool, context: String) {
        self.pairs = pairs
        self.upper = upper
        self.context = context
    }

    /// Splits at `separator`, each pair at its first `=`; throws for an empty or `=`-less pair.
    static func split(_ text: some StringProtocol, _ separator: Character, _ context: String) throws(ThirteenError)
        -> [(key: String, value: String)]
    {
        var out: [(key: String, value: String)] = []
        for pair in Text.split(text, separator) {
            guard let at = pair.firstIndex(of: "="), at != pair.startIndex else {
                throw .invalidRule("\(context): expected KEY=VALUE, got \(Calc.quoted(String(pair)))")
            }
            out.append((String(pair[pair.startIndex..<at]), String(pair[pair.index(after: at)...])))
        }
        return out
    }

    /// `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.
    static func isUUID(_ text: String) -> Bool {
        let groups = Text.split(text, "-")
        guard groups.map(\.utf8.count) == [8, 4, 4, 4, 12] else { return false }
        return groups.allSatisfy { $0.unicodeScalars.allSatisfy { Text.isASCIIDigit($0) || ("a"..."f").contains($0) } }
    }

    private func name(_ key: String) -> String { upper ? key.uppercased() : key }

    /// `true` when the next pair has key `key`.
    func next(_ key: String) -> Bool { index < pairs.count && pairs[index].key == name(key) }

    /// The value of the next pair, which must have key `key`.
    mutating func take(_ key: String) throws(ThirteenError) -> String {
        guard next(key) else {
            let found = index < pairs.count ? "'\(pairs[index].key)'" : "the end"
            throw .invalidRule("\(context): expected '\(name(key))' at position \(index + 1), found \(found)")
        }
        index += 1
        return pairs[index - 1].value
    }

    /// The next value as an integer `min…max` written without sign or leading zeros.
    mutating func number(_ key: String, _ min: Int, _ max: Int) throws(ThirteenError) -> Int {
        let text = try take(key)
        let digits = Substring(text)
        guard let first = digits.unicodeScalars.first, first != "0", let value = Text.unsigned(digits, maxDigits: 18),
            value >= min, value <= max
        else {
            throw .invalidRule("\(context): \(name(key)) must be an integer \(min)..\(max), got \(Calc.quoted(text))")
        }
        return value
    }

    /// The next value, which must be one of `values`.
    mutating func oneOf(_ key: String, _ values: [String]) throws(ThirteenError) -> String {
        let text = try take(key)
        guard values.contains(text) else {
            let list = values.map { "'\($0)'" }.joined(separator: ", ")
            throw .invalidRule("\(context): \(name(key)) must be \(list), got \(Calc.quoted(text))")
        }
        return text
    }

    /// Throws unless every pair was read.
    func done() throws(ThirteenError) {
        if index < pairs.count {
            throw .invalidRule("\(context): unexpected '\(pairs[index].key)' at position \(index + 1)")
        }
    }

    /// The rule's fields (§4.3 e), in order.
    mutating func rule() throws(ThirteenError) -> ThirteenRule {
        let system = CalendarSystemID(rawValue: try oneOf("system", ["ifc", "positivist"]))!
        switch try oneOf("kind", ["monthly", "weekly", "yearly", "intercalary"]) {
        case "monthly":
            return .monthly(system: system, day: try number("day", 1, 28))
        case "weekly":
            let weekday = Weekday(rawValue: RRuleTables.weekdayCodes.firstIndex(of: try oneOf("weekday", RRuleTables.weekdayCodes))!)!
            let interval = next("interval") ? try number("interval", 1, 2) : 1
            return .weekly(system: system, weekday: weekday, interval: interval)
        case "yearly":
            let month = try number("month", 1, 13)
            return .yearly(system: system, month: month, day: try number("day", 1, 28))
        default:
            return .intercalary(system: system, id: try oneOf("day", ["YD", "LD"]) == "YD" ? .yearDay : .leapDay)
        }
    }
}

// MARK: - Codable (§5.5)

extension ThirteenRule: Codable {
    enum CodingKeys: String, CodingKey { case kind, system, day, weekday, interval, month, id }

    /// Decodes the JSON of §5.5 and validates it.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let system = try c.decode(CalendarSystemID.self, forKey: .system)
        switch try c.decode(String.self, forKey: .kind) {
        case "monthly":
            self = .monthly(system: system, day: try c.decode(Int.self, forKey: .day))
        case "weekly":
            self = .weekly(
                system: system, weekday: try c.decode(Weekday.self, forKey: .weekday),
                interval: try c.decode(Int.self, forKey: .interval))
        case "yearly":
            self = .yearly(system: system, month: try c.decode(Int.self, forKey: .month), day: try c.decode(Int.self, forKey: .day))
        case "intercalary":
            self = .intercalary(system: system, id: try c.decode(IntercalaryDayID.self, forKey: .id))
        case let kind:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "kind must be 'monthly', 'weekly', 'yearly' or 'intercalary', got '\(kind)'")
        }
        do {
            try validate()
        } catch {
            throw DecodingError.dataCorrupted(.init(codingPath: c.codingPath, debugDescription: String(describing: error)))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kindName, forKey: .kind)
        try c.encode(system, forKey: .system)
        switch self {
        case let .monthly(_, day):
            try c.encode(day, forKey: .day)
        case let .weekly(_, weekday, interval):
            try c.encode(weekday, forKey: .weekday)
            try c.encode(interval, forKey: .interval)
        case let .yearly(_, month, day):
            try c.encode(month, forKey: .month)
            try c.encode(day, forKey: .day)
        case let .intercalary(_, id):
            try c.encode(id, forKey: .id)
        }
    }
}

extension ThirteenEncoding: Codable {
    enum CodingKeys: String, CodingKey { case form, rrule, exchangeSafe, cap }

    /// JSON as in the `thirteenRules` fixture: the `rrule` as its canonical text, `cap` a date or null.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        form = try c.decode(ThirteenEncodingForm.self, forKey: .form)
        do {
            rrule = try RRule(text: try c.decode(String.self, forKey: .rrule))
        } catch {
            throw DecodingError.dataCorruptedError(forKey: .rrule, in: c, debugDescription: String(describing: error))
        }
        exchangeSafe = try c.decode(Bool.self, forKey: .exchangeSafe)
        cap = try c.decode(EventJSONDate?.self, forKey: .cap)?.date
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(form, forKey: .form)
        try c.encode(rrule.text, forKey: .rrule)
        try c.encode(exchangeSafe, forKey: .exchangeSafe)
        try c.encode(cap.map(EventJSONDate.init), forKey: .cap)
    }
}
