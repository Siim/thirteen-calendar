// English formatting of Gregorian and 13-month dates, and parsing of the 13-month numeric form
// (SPEC §3.1), mirroring `format.ts`. Output is byte-identical to `formatThirteen` /
// `formatGregorian` (verified against every `formats` vector of fixtures/conversions.json).
//
// | style     | 13-month month date | intercalary           | Gregorian            |
// |-----------|---------------------|-----------------------|----------------------|
// | `long`    | `October 12, 2026`  | `Year Day 2026`       | `October 19, 2026`   |
// | `medium`  | `Oct 12, 2026`      | `Year Day 2026`       | `Oct 19, 2026`       |
// | `short`   | `Oct 12`            | `Year Day`            | `Oct 19`             |
// | `numeric` | `2026-M11-12`       | `2026-YD` / `2024-LD` | `2026-10-19` (ISO)   |

/// Output style for ``ThirteenDate/formatted(_:)`` and ``GregorianDate/formatted(_:)``. TS: `DateStyle`.
public enum DateStyle: String, Sendable, Hashable, Codable, CaseIterable {
    case long
    case medium
    case short
    case numeric
}

/// Formatting options. TS: `FormatOptions` — every field is optional and `nil` means "default":
/// - `style`: default `.long`;
/// - `includeYear`: default `true`, except `false` for `.short`;
/// - `includeWeekday`: default `false`; prefixes the full weekday name for `.long` and the
///   3-letter one for `.medium`/`.short`; ignored for `.numeric` and intercalary days. The weekday
///   of a 13-month date is its fixed weekday.
///
/// Decoding is as strict as the TypeScript option validation: unknown keys and `null` values are
/// rejected.
public struct FormatOptions: Sendable, Hashable {
    public var style: DateStyle?
    public var includeYear: Bool?
    public var includeWeekday: Bool?

    public init(style: DateStyle? = nil, includeYear: Bool? = nil, includeWeekday: Bool? = nil) {
        self.style = style
        self.includeYear = includeYear
        self.includeWeekday = includeWeekday
    }

    /// `October 12, 2026` (the default).
    public static let long = FormatOptions(style: .long)
    /// `Oct 12, 2026`.
    public static let medium = FormatOptions(style: .medium)
    /// `Oct 12`.
    public static let short = FormatOptions(style: .short)
    /// `2026-M11-12` / `2026-10-19`.
    public static let numeric = FormatOptions(style: .numeric)

    /// The style after applying the default.
    public var resolvedStyle: DateStyle { style ?? .long }
    /// `includeYear` after applying the style-dependent default.
    public var resolvedIncludeYear: Bool { includeYear ?? (resolvedStyle != .short) }
    /// `includeWeekday` after applying the default.
    public var resolvedIncludeWeekday: Bool { includeWeekday ?? false }
}

extension FormatOptions: Codable {
    enum CodingKeys: String, CodingKey, CaseIterable { case style, includeYear, includeWeekday }

    private struct AnyKey: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    public init(from decoder: any Decoder) throws {
        let all = try decoder.container(keyedBy: AnyKey.self)
        let known = Set(CodingKeys.allCases.map(\.stringValue))
        if let unknown = all.allKeys.first(where: { !known.contains($0.stringValue) }) {
            throw DecodingError.dataCorruptedError(
                forKey: unknown, in: all,
                debugDescription: "Unknown format option \"\(unknown.stringValue)\" "
                    + "(expected 'style', 'includeYear', 'includeWeekday')")
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Present keys must hold a real value: `null` is rejected like in TypeScript.
        style = c.contains(.style) ? try c.decode(DateStyle.self, forKey: .style) : nil
        includeYear = c.contains(.includeYear) ? try c.decode(Bool.self, forKey: .includeYear) : nil
        includeWeekday = c.contains(.includeWeekday) ? try c.decode(Bool.self, forKey: .includeWeekday) : nil
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(style, forKey: .style)
        try c.encodeIfPresent(includeYear, forKey: .includeYear)
        try c.encodeIfPresent(includeWeekday, forKey: .includeWeekday)
    }
}

/// Formatting helpers without a natural receiver.
public enum ThirteenFormat {
    /// A year for numeric output: 4-digit zero padding with a leading `-` for negative numbers
    /// (Positivist years before 1789): `"0238"`, `"0000"`, `"-1787"`. TS: `formatNumericYear`.
    public static func numericYear(_ year: Int) -> String {
        year < 0 ? "-" + Calc.pad(year.magnitude, 4) : Calc.pad(year, 4)
    }

    /// English ordinal: `1st`, `2nd`, `3rd`, `4th`, `11th`, `12th`, `13th`, `21st`, `112th`, `-1st`.
    /// TS: `ordinal`.
    public static func ordinal(_ value: Int) -> String {
        let magnitude = value.magnitude
        let lastTwo = magnitude % 100
        let suffix: String =
            if (11...13).contains(lastTwo) { "th" }
            else {
                switch magnitude % 10 {
                case 1: "st"
                case 2: "nd"
                case 3: "rd"
                default: "th"
                }
            }
        return "\(value)\(suffix)"
    }
}

extension ThirteenDate {
    /// English text for the date (SPEC §3.1); years are display years (`Descartes 12, 238`).
    /// TS: `formatThirteen(date, options)`. Examples: `"October 12, 2026"`,
    /// `date.formatted(.medium)` → `"Oct 12, 2026"`, `date.formatted(.numeric)` → `"2026-M11-12"`,
    /// `"Year Day 2026"`, `"2026-YD"`, `"0238-M11-12"`, `"-1787-YD"`.
    public func formatted(_ options: FormatOptions = FormatOptions()) -> String {
        let style = options.resolvedStyle
        let includeYear = options.resolvedIncludeYear
        let year = displayYear
        switch self {
        case let .intercalary(date):
            let info = date.info
            if style == .numeric { return includeYear ? "\(ThirteenFormat.numericYear(year))-\(info.code)" : info.code }
            let name = style == .long ? info.name : info.shortName
            return includeYear ? "\(name) \(year)" : name
        case let .month(date):
            if style == .numeric {
                let monthDay = "M\(Calc.pad(date.month, 2))-\(Calc.pad(date.day, 2))"
                return includeYear ? "\(ThirteenFormat.numericYear(year))-\(monthDay)" : monthDay
            }
            let info = date.monthInfo
            let body = "\(style == .long ? info.name : info.shortName) \(date.day)\(includeYear ? ", \(year)" : "")"
            guard options.resolvedIncludeWeekday else { return body }
            return "\(date.weekday.name(style == .long ? .long : .short)), \(body)"
        }
    }

    /// Parses the full 13-month numeric form produced by `formatted(.numeric)` — `YYYY-Mmm-dd`,
    /// `YYYY-YD` or `YYYY-LD`, where `YYYY` is the system's **display year** (4 ASCII digits,
    /// optional leading `-`; Positivist `0238-M11-12`, `-1787-YD`). Exact inverse of the formatter:
    /// no whitespace, no lowercase, no unpadded fields, no `-0000`. TS: `parseThirteen`; use `try?`
    /// for `tryParseThirteen`.
    /// - Throws: ``ThirteenError/malformedThirteenNumeric(_:)`` for malformed text, otherwise the error
    ///   of the impossible date: ``ThirteenError/displayYearOutOfRange(_:system:)``,
    ///   ``ThirteenError/invalidThirteenMonth(_:)``, ``ThirteenError/invalidThirteenDay(_:)`` or
    ///   ``ThirteenError/intercalaryDayNotInYear(_:year:)``.
    public init(numeric text: String, system: CalendarSystemID = .ifc) throws(ThirteenError) {
        let bytes = Array(text.utf8)
        let negative = bytes.first == UInt8(ascii: "-")
        let yearStart = negative ? 1 : 0
        let bodyStart = yearStart + 5
        guard let magnitude = Calc.digits(bytes, yearStart, 4), bytes.count > bodyStart,
            bytes[yearStart + 4] == UInt8(ascii: "-"), !(negative && magnitude == 0)
        else { throw .malformedThirteenNumeric(text) }

        let body = Array(bytes[bodyStart...])
        var intercalary: IntercalaryDayID?
        var monthDay: (month: Int, day: Int)?
        if let id = IntercalaryDayID.allCases.first(where: { Array($0.code.utf8) == body }) {
            intercalary = id
        } else if body.count == 6, body[0] == UInt8(ascii: "M"), body[3] == UInt8(ascii: "-"),
            let month = Calc.digits(body, 1, 2), let day = Calc.digits(body, 4, 2)
        {
            monthDay = (month, day)
        } else {
            throw .malformedThirteenNumeric(text)
        }

        let year = try system.gregorianYear(forDisplayYear: negative ? -magnitude : magnitude)
        if let intercalary {
            self = try ThirteenDate(year: year, intercalary: intercalary, system: system)
        } else if let monthDay {
            self = try ThirteenDate(year: year, month: monthDay.month, day: monthDay.day, system: system)
        } else {
            throw .malformedThirteenNumeric(text)
        }
    }
}

extension ThirteenMonthDate {
    /// See ``ThirteenDate/formatted(_:)``.
    public func formatted(_ options: FormatOptions = FormatOptions()) -> String {
        thirteenDate.formatted(options)
    }
}

extension ThirteenIntercalaryDate {
    /// See ``ThirteenDate/formatted(_:)``.
    public func formatted(_ options: FormatOptions = FormatOptions()) -> String {
        thirteenDate.formatted(options)
    }
}

extension GregorianDate {
    /// English text for the date (SPEC §3.1): `"October 19, 2026"`, `"Mon, Oct 19, 2026"`,
    /// `"Oct 19"`; `.numeric` is ISO 8601 (`"2026-10-19"`, or `"10-19"` without the year).
    /// TS: `formatGregorian(date, options)`.
    public func formatted(_ options: FormatOptions = FormatOptions()) -> String {
        let style = options.resolvedStyle
        let includeYear = options.resolvedIncludeYear
        if style == .numeric {
            let monthDay = "\(Calc.pad(month, 2))-\(Calc.pad(day, 2))"
            return includeYear ? "\(Calc.pad(year, 4))-\(monthDay)" : monthDay
        }
        let name = style == .long ? Calc.monthNames[month - 1] : Calc.monthShortNames[month - 1]
        let body = "\(name) \(day)\(includeYear ? ", \(year)" : "")"
        guard options.resolvedIncludeWeekday else { return body }
        return "\(weekday.name(style == .long ? .long : .short)), \(body)"
    }
}
