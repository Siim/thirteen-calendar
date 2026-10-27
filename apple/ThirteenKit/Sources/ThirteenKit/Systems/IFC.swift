// Generated from the @thirteen/core system data (packages/core/src/systems); keep in sync.
// The parity tests compare this value with fixtures/conversions.json field by field.

extension CalendarSystem {
    /// Moses B. Cotsworth's International Fixed Calendar (SPEC §1.1), id `"ifc"` — the default system.
    public static let ifc = CalendarSystem(
        id: .ifc,
        name: "International Fixed Calendar",
        shortName: "IFC",
        inventor: "Moses B. Cotsworth",
        proposedYear: 1902,
        summary:
            "Moses B. Cotsworth’s perennial calendar, first presented in 1902: thirteen 28-day months that all start on a Sunday, with Sol inserted between June and July. Promoted by the International Fixed Calendar League (founded 1923) with George Eastman’s backing and considered by the League of Nations’ calendar-reform inquiries of the 1920s and 1930s, it was used internally at Eastman Kodak from 1928 to 1989.",
        history: [
            HistoryEvent(year: 1902, text: "Moses B. Cotsworth first presents his 13-month International Fixed Calendar."),
            HistoryEvent(year: 1923, text: "The International Fixed Calendar League is founded with George Eastman’s backing, after a League of Nations calendar-reform inquiry rates the plan the best of some 130 proposals."),
            HistoryEvent(year: 1928, text: "Eastman Kodak adopts the calendar for its internal business use."),
            HistoryEvent(year: 1937, text: "The plan fails to win final approval from the League of Nations, and the IFC League winds down."),
            HistoryEvent(year: 1989, text: "Eastman Kodak stops using the calendar, after 61 years."),
        ],
        weekStartsOn: .sunday,
        yearOffset: 0,
        months: [
            ThirteenMonthInfo(index: 1, name: "January", shortName: "Jan", gregorianNameEquivalent: 1),
            ThirteenMonthInfo(index: 2, name: "February", shortName: "Feb", gregorianNameEquivalent: 2),
            ThirteenMonthInfo(index: 3, name: "March", shortName: "Mar", gregorianNameEquivalent: 3),
            ThirteenMonthInfo(index: 4, name: "April", shortName: "Apr", gregorianNameEquivalent: 4),
            ThirteenMonthInfo(index: 5, name: "May", shortName: "May", gregorianNameEquivalent: 5),
            ThirteenMonthInfo(index: 6, name: "June", shortName: "Jun", gregorianNameEquivalent: 6),
            ThirteenMonthInfo(index: 7, name: "Sol", shortName: "Sol", gregorianNameEquivalent: nil, meaning: "Latin for “sun”: the inserted month sits mid-year, near the northern summer solstice."),
            ThirteenMonthInfo(index: 8, name: "July", shortName: "Jul", gregorianNameEquivalent: 7),
            ThirteenMonthInfo(index: 9, name: "August", shortName: "Aug", gregorianNameEquivalent: 8),
            ThirteenMonthInfo(index: 10, name: "September", shortName: "Sep", gregorianNameEquivalent: 9),
            ThirteenMonthInfo(index: 11, name: "October", shortName: "Oct", gregorianNameEquivalent: 10),
            ThirteenMonthInfo(index: 12, name: "November", shortName: "Nov", gregorianNameEquivalent: 11),
            ThirteenMonthInfo(index: 13, name: "December", shortName: "Dec", gregorianNameEquivalent: 12),
        ],
        intercalaryDays: [
            IntercalaryDayInfo(
                id: .leapDay,
                code: "LD",
                name: "Leap Day",
                shortName: "Leap Day",
                description: "Follows June 28 in leap years (always Gregorian 17 June). It belongs to no month and has no weekday.",
                leapOnly: true,
                afterMonth: 6,
                dayOfYear: .init(common: nil, leap: 169)
            ),
            IntercalaryDayInfo(
                id: .yearDay,
                code: "YD",
                name: "Year Day",
                shortName: "Year Day",
                description: "Follows December 28 (always Gregorian 31 December). It belongs to no month and has no weekday.",
                leapOnly: false,
                afterMonth: 13,
                dayOfYear: .init(common: 365, leap: 366)
            ),
        ]
    )
}
