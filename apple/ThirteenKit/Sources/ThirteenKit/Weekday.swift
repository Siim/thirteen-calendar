/// Name length for weekday and month names. TS: `NameStyle`.
public enum NameStyle: String, Sendable, Hashable, Codable, CaseIterable {
    case long
    case short
    case narrow
}

/// Day of the week, `0 = Sunday … 6 = Saturday` (SPEC §1.3, the JavaScript `Date#getDay`
/// convention shared with `@thirteen/core`). Encodes as its integer raw value.
///
/// `Comparable` orders by raw value (Sunday first); use ``ordered(startingOn:)`` for display order.
public enum Weekday: Int, Sendable, Hashable, Codable, CaseIterable, Comparable, Identifiable,
    CustomStringConvertible
{
    case sunday = 0
    case monday = 1
    case tuesday = 2
    case wednesday = 3
    case thursday = 4
    case friday = 5
    case saturday = 6

    /// The raw value `0…6`, for `ForEach`.
    public var id: Int { rawValue }

    /// Normalises any integer with a true (non-negative) modulo 7: `Weekday(wrapping: -1) == .saturday`,
    /// `Weekday(wrapping: 9) == .tuesday`. TS: `toWeekday`.
    public init(wrapping value: Int) {
        self = Weekday(rawValue: Calc.mod(value, 7))!
    }

    private static let longNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    private static let shortNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    private static let narrowNames = ["S", "M", "T", "W", "T", "F", "S"]

    /// English weekday names indexed by raw value (`names(.long)[0] == "Sunday"`). TS: `WEEKDAY_NAMES[style]`.
    public static func names(_ style: NameStyle) -> [String] {
        switch style {
        case .long: longNames
        case .short: shortNames
        case .narrow: narrowNames
        }
    }

    /// English name: `"Thursday"`, `"Thu"` or `"T"`. TS: `weekdayName`.
    public func name(_ style: NameStyle = .long) -> String {
        Weekday.names(style)[rawValue]
    }

    /// The weekday `days` days later (or earlier, if negative).
    public func advanced(by days: Int) -> Weekday {
        Weekday(wrapping: rawValue + Calc.mod(days, 7))
    }

    /// The seven weekdays in display order for a week starting on `first`:
    /// `ordered(startingOn: .monday) == [.monday, …, .saturday, .sunday]`. TS: `orderedWeekdays`.
    public static func ordered(startingOn first: Weekday = .sunday) -> [Weekday] {
        (0..<7).map { first.advanced(by: $0) }
    }

    public static func < (lhs: Weekday, rhs: Weekday) -> Bool { lhs.rawValue < rhs.rawValue }

    /// The long English name.
    public var description: String { name(.long) }
}
