/// Data model of a perennial 13 × 28 calendar system (SPEC §1), mirroring
/// `packages/core/src/systems/types.ts`. Systems are pure data; their JSON encoding is the
/// TypeScript JSON (verified against `fixtures/conversions.json`).

/// Identifier of a supported calendar system. TS: `CalendarSystemId` (`'ifc' | 'positivist'`).
/// `.ifc` is the default everywhere a `system:` parameter is optional.
public enum CalendarSystemID: String, Sendable, Hashable, Codable, CaseIterable, Identifiable,
    CustomStringConvertible
{
    /// International Fixed Calendar (SPEC §1.1).
    case ifc
    /// Positivist calendar (SPEC §1.2).
    case positivist

    /// The system used when none is specified. TS: `DEFAULT_SYSTEM_ID`.
    public static let `default`: CalendarSystemID = .ifc

    /// The raw value, for `ForEach` / `Picker`.
    public var id: String { rawValue }

    /// The raw value, `"ifc"` or `"positivist"`.
    public var description: String { rawValue }
}

/// Identifier of an intercalary (month-less, week-less) day. TS: `IntercalaryDayId`.
/// - `yearDay` (`"year-day"`): IFC "Year Day", Positivist "Festival of All the Dead".
/// - `leapDay` (`"leap-day"`): IFC "Leap Day", Positivist "Festival of Holy Women" (leap years only).
public enum IntercalaryDayID: String, Sendable, Hashable, Codable, CaseIterable, Identifiable,
    CustomStringConvertible
{
    case yearDay = "year-day"
    case leapDay = "leap-day"

    /// The raw value, for `ForEach`.
    public var id: String { rawValue }

    /// Compact code used by numeric formatting: `"YD"` or `"LD"`.
    public var code: String {
        switch self {
        case .yearDay: "YD"
        case .leapDay: "LD"
        }
    }

    /// The raw value, `"year-day"` or `"leap-day"`.
    public var description: String { rawValue }
}

/// Static information about one of the 13 months of a system. TS: `ThirteenMonthInfo`.
public struct ThirteenMonthInfo: Sendable, Hashable, Identifiable {
    /// Month number, `1…13`.
    public let index: Int
    /// Display name, e.g. `"Sol"`, `"Descartes"`.
    public let name: String
    /// Three/four-letter abbreviation, e.g. `"Sol"`, `"Des"`.
    public let shortName: String
    /// The Gregorian month (`1…12`) whose name this month carries, or `nil` when there is no
    /// namesake (IFC Sol, every Positivist month). Drives `labelDrift`.
    public let gregorianNameEquivalent: Int?
    /// Optional note on the name (etymology or Comte's theme for the month).
    public let meaning: String?

    init(index: Int, name: String, shortName: String, gregorianNameEquivalent: Int?, meaning: String? = nil) {
        self.index = index
        self.name = name
        self.shortName = shortName
        self.gregorianNameEquivalent = gregorianNameEquivalent
        self.meaning = meaning
    }

    /// The month number, for `ForEach`.
    public var id: Int { index }
}

extension ThirteenMonthInfo: Codable {
    enum CodingKeys: String, CodingKey { case index, name, shortName, gregorianNameEquivalent, meaning }

    /// Encodes like the TypeScript object: `gregorianNameEquivalent` is always present (possibly
    /// `null`), `meaning` only when set.
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(index, forKey: .index)
        try c.encode(name, forKey: .name)
        try c.encode(shortName, forKey: .shortName)
        try c.encode(gregorianNameEquivalent, forKey: .gregorianNameEquivalent)
        try c.encodeIfPresent(meaning, forKey: .meaning)
    }
}

/// Static information about an intercalary day of a system. TS: `IntercalaryDayInfo`.
public struct IntercalaryDayInfo: Sendable, Hashable, Codable, Identifiable {
    /// Gregorian day-of-year on which the day falls: `common` in non-leap years (`nil` when it
    /// does not exist), `leap` in leap years.
    public struct DayOfYear: Sendable, Hashable, Codable {
        public let common: Int?
        public let leap: Int

        enum CodingKeys: String, CodingKey { case common, leap }

        public func encode(to encoder: any Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(common, forKey: .common)
            try c.encode(leap, forKey: .leap)
        }
    }

    public let id: IntercalaryDayID
    /// Compact code used by numeric formatting: `"YD"` (year-day) or `"LD"` (leap-day).
    public let code: String
    /// Display name, e.g. `"Year Day"`, `"Festival of All the Dead"`.
    public let name: String
    /// Compact display name, e.g. `"Year Day"`, `"All the Dead"`.
    public let shortName: String
    /// One-sentence description of where the day falls.
    public let description: String
    /// `true` when the day only exists in Gregorian leap years.
    public let leapOnly: Bool
    /// The day comes after day 28 of this month (`1…13`); e.g. 6 for the IFC Leap Day.
    public let afterMonth: Int
    public let dayOfYear: DayOfYear
}

/// One dated event in a calendar's history (for the Compare view timeline). TS: `HistoryEvent`.
public struct HistoryEvent: Sendable, Hashable, Codable, Identifiable {
    /// Gregorian year of the event.
    public let year: Int
    /// One sentence describing the event.
    public let text: String

    /// `"<year> <text>"`, unique within a history.
    public var id: String { "\(year) \(text)" }
}

/// Descriptive (non-arithmetic) information shared by every calendar, including the Gregorian
/// one. TS: `CalendarDescriptor`.
public protocol CalendarDescriptor: Sendable {
    /// Full name, e.g. `"International Fixed Calendar"`.
    var name: String { get }
    /// Compact name for switchers, e.g. `"IFC"`.
    var shortName: String { get }
    /// Person who proposed (or, for the Gregorian calendar, promulgated) the calendar.
    var inventor: String { get }
    /// Year the calendar was proposed / first presented / promulgated.
    var proposedYear: Int { get }
    /// One- or two-sentence history.
    var summary: String { get }
    /// Key dated events, chronologically (ascending `year`).
    var history: [HistoryEvent] { get }
}

/// A complete 13 × 28 perennial calendar definition. TS: `CalendarSystem`
/// (`IFC` = ``CalendarSystem/ifc``, `POSITIVIST` = ``CalendarSystem/positivist``,
/// `CALENDAR_SYSTEMS` = ``CalendarSystem/all``).
public struct CalendarSystem: CalendarDescriptor, Sendable, Hashable, Codable, Identifiable {
    public let id: CalendarSystemID
    public let name: String
    public let shortName: String
    public let inventor: String
    public let proposedYear: Int
    public let summary: String
    public let history: [HistoryEvent]
    /// Weekday of day 1 of every month; day `n` falls on `(weekStartsOn + n − 1) mod 7`.
    public let weekStartsOn: Weekday
    /// `displayYear = gregorianYear + yearOffset` (IFC 0, Positivist −1788).
    public let yearOffset: Int
    /// The 13 months in order (`months[0].index == 1`).
    public let months: [ThirteenMonthInfo]
    /// Intercalary days in chronological order within a leap year.
    public let intercalaryDays: [IntercalaryDayInfo]

    /// Both systems in display order (IFC first). TS: `CALENDAR_SYSTEMS`.
    public static let all: [CalendarSystem] = [.ifc, .positivist]

    /// The definition of a system. TS: `getCalendarSystem(id)`.
    public init(_ id: CalendarSystemID) {
        self = id.definition
    }

    init(
        id: CalendarSystemID, name: String, shortName: String, inventor: String, proposedYear: Int,
        summary: String, history: [HistoryEvent], weekStartsOn: Weekday, yearOffset: Int,
        months: [ThirteenMonthInfo], intercalaryDays: [IntercalaryDayInfo]
    ) {
        self.id = id
        self.name = name
        self.shortName = shortName
        self.inventor = inventor
        self.proposedYear = proposedYear
        self.summary = summary
        self.history = history
        self.weekStartsOn = weekStartsOn
        self.yearOffset = yearOffset
        self.months = months
        self.intercalaryDays = intercalaryDays
    }
}

/// The Gregorian calendar as a ``CalendarDescriptor``, plus its 12 months. TS: `GregorianCalendarInfo`
/// (`GREGORIAN_CALENDAR` = ``GregorianCalendarInfo/gregorian``).
public struct GregorianCalendarInfo: CalendarDescriptor, Sendable, Hashable, Codable {
    public let name: String
    public let shortName: String
    public let inventor: String
    public let proposedYear: Int
    public let summary: String
    public let history: [HistoryEvent]
    /// The 12 months in order (`months[0].index == 1`); the same values as ``GregorianMonthInfo/all``.
    public let months: [GregorianMonthInfo]
}
