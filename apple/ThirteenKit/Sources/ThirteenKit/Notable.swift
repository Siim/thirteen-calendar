// Well-known fixed-date Gregorian days, used to show "your days in the 13-month calendar",
// mirroring `notable.ts`. Only month/day labels — no year-specific claims.

/// A day celebrated on the same Gregorian month/day every year. TS: `NotableDate`.
public struct NotableDate: Sendable, Hashable, Codable, Identifiable {
    /// Stable kebab-case id, e.g. `"pi-day"`.
    public let id: String
    public let name: String
    /// Gregorian month, `1…12`.
    public let month: Int
    /// Gregorian day (never 29 February, so it exists every year).
    public let day: Int

    /// Notable fixed Gregorian dates in chronological order. TS: `NOTABLE_DATES`.
    public static let all: [NotableDate] = [
        NotableDate(id: "new-years-day", name: "New Year’s Day", month: 1, day: 1),
        NotableDate(id: "valentines-day", name: "Valentine’s Day", month: 2, day: 14),
        NotableDate(id: "international-womens-day", name: "International Women’s Day", month: 3, day: 8),
        NotableDate(id: "pi-day", name: "Pi Day", month: 3, day: 14),
        NotableDate(id: "earth-day", name: "Earth Day", month: 4, day: 22),
        NotableDate(id: "halloween", name: "Halloween", month: 10, day: 31),
        NotableDate(id: "christmas-day", name: "Christmas Day", month: 12, day: 25),
        NotableDate(id: "new-years-eve", name: "New Year’s Eve", month: 12, day: 31),
    ]
}

/// A notable date resolved for a specific year and system. TS: `NotableDateInYear`.
public struct NotableDateInYear: Sendable, Hashable, Identifiable {
    public let notable: NotableDate
    public let gregorian: GregorianDate
    /// The 13-month date the day falls on.
    public let thirteen: ThirteenDate
    /// The 13-month date carrying the same label (IFC only; `nil` for Positivist or day > 28).
    public let sameLabel: ThirteenMonthDate?

    /// The notable date's id, for `ForEach`.
    public var id: String { notable.id }

    /// ``NotableDate/all`` resolved for Gregorian year `year` in a system. TS: `notableDatesInYear`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)``.
    public static func all(inYear year: Int, system: CalendarSystemID = .ifc) throws(ThirteenError)
        -> [NotableDateInYear]
    {
        try GregorianDate.validateYear(year)
        return NotableDate.all.map { notable in
            let gregorian = GregorianDate(unchecked: year, notable.month, notable.day)
            return NotableDateInYear(
                notable: notable,
                gregorian: gregorian,
                thirteen: ThirteenDate(gregorian, system: system),
                sameLabel: gregorian.sameLabel(in: system))
        }
    }
}

extension NotableDateInYear: Codable {
    enum CodingKeys: String, CodingKey { case notable, gregorian, thirteen, sameLabel }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(notable, forKey: .notable)
        try c.encode(gregorian, forKey: .gregorian)
        try c.encode(thirteen, forKey: .thirteen)
        try c.encode(sameLabel, forKey: .sameLabel)
    }
}
