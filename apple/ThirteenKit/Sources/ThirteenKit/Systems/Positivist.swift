// Generated from the @thirteen/core system data (packages/core/src/systems); keep in sync.
// The parity tests compare this value with fixtures/conversions.json field by field.

extension CalendarSystem {
    /// Auguste Comte's Positivist calendar (SPEC §1.2), id `"positivist"`.
    public static let positivist = CalendarSystem(
        id: .positivist,
        name: "Positivist Calendar",
        shortName: "Positivist",
        inventor: "Auguste Comte",
        proposedYear: 1849,
        summary:
            "Auguste Comte’s 1849 calendar of thirteen 28-day months, each named after a figure he considered a great contributor to humanity and each starting on a Monday. Years are counted from the French Revolution: 1789 is year 1.",
        history: [
            HistoryEvent(year: 1789, text: "The French Revolution begins; Comte later makes 1789 year 1 of the Positivist era."),
            HistoryEvent(year: 1849, text: "Auguste Comte proposes the Positivist calendar: 13 months named after great contributors to humanity, plus festival days."),
        ],
        weekStartsOn: .monday,
        yearOffset: -1788,
        months: [
            ThirteenMonthInfo(index: 1, name: "Moses", shortName: "Mos", gregorianNameEquivalent: nil, meaning: "Initial religiosity"),
            ThirteenMonthInfo(index: 2, name: "Homer", shortName: "Hom", gregorianNameEquivalent: nil, meaning: "Ancient poets"),
            ThirteenMonthInfo(index: 3, name: "Aristotle", shortName: "Ari", gregorianNameEquivalent: nil, meaning: "Ancient philosophers"),
            ThirteenMonthInfo(index: 4, name: "Archimedes", shortName: "Arc", gregorianNameEquivalent: nil, meaning: "Ancient science"),
            ThirteenMonthInfo(index: 5, name: "Caesar", shortName: "Cae", gregorianNameEquivalent: nil, meaning: "Military civilisation"),
            ThirteenMonthInfo(index: 6, name: "Saint Paul", shortName: "Pau", gregorianNameEquivalent: nil, meaning: "Catholicism"),
            ThirteenMonthInfo(index: 7, name: "Charlemagne", shortName: "Cha", gregorianNameEquivalent: nil, meaning: "Feudal civilisation"),
            ThirteenMonthInfo(index: 8, name: "Dante", shortName: "Dan", gregorianNameEquivalent: nil, meaning: "Modern epics"),
            ThirteenMonthInfo(index: 9, name: "Gutenberg", shortName: "Gut", gregorianNameEquivalent: nil, meaning: "Modern industry"),
            ThirteenMonthInfo(index: 10, name: "Shakespeare", shortName: "Sha", gregorianNameEquivalent: nil, meaning: "Modern drama"),
            ThirteenMonthInfo(index: 11, name: "Descartes", shortName: "Des", gregorianNameEquivalent: nil, meaning: "Modern philosophy"),
            ThirteenMonthInfo(index: 12, name: "Frederick", shortName: "Fre", gregorianNameEquivalent: nil, meaning: "Modern politics"),
            ThirteenMonthInfo(index: 13, name: "Bichat", shortName: "Bic", gregorianNameEquivalent: nil, meaning: "Modern science"),
        ],
        intercalaryDays: [
            IntercalaryDayInfo(
                id: .yearDay,
                code: "YD",
                name: "Festival of All the Dead",
                shortName: "All the Dead",
                description: "The complementary day after Bichat 28 (Gregorian 31 December, or 30 December in leap years). It belongs to no month and has no weekday.",
                leapOnly: false,
                afterMonth: 13,
                dayOfYear: .init(common: 365, leap: 365)
            ),
            IntercalaryDayInfo(
                id: .leapDay,
                code: "LD",
                name: "Festival of Holy Women",
                shortName: "Holy Women",
                description: "Follows the Festival of All the Dead in leap years (always Gregorian 31 December). It belongs to no month and has no weekday.",
                leapOnly: true,
                afterMonth: 13,
                dayOfYear: .init(common: nil, leap: 366)
            ),
        ]
    )
}
