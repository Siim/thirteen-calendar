package com.haugas.thirteen.core

// Static system data, copied from @thirteen/core (packages/core/src/systems) by way of
// ThirteenKit; keep in sync. FixtureParityTest compares every field with
// fixtures/conversions.json verbatim, typographic quotes included. The Gregorian history reads
// "skipping 3 to 13 September" (no dash), as in the other three engines and the fixture.
//
// The companion accessors (CalendarSystem.IFC, GregorianCalendarInfo.GREGORIAN ...) read these
// values through getters, so no class initializer captures a value of this file while it is
// still being initialized (constructing the values below initializes those classes).

internal val IfcDefinition = CalendarSystem(
    id = CalendarSystemId.IFC,
    name = "International Fixed Calendar",
    shortName = "IFC",
    inventor = "Moses B. Cotsworth",
    proposedYear = 1902,
    summary = "Moses B. Cotsworth’s perennial calendar, first presented in 1902: thirteen 28-day months that all " +
        "start on a Sunday, with Sol inserted between June and July. Promoted by the International Fixed Calendar " +
        "League (founded 1923) with George Eastman’s backing and considered by the League of Nations’ " +
        "calendar-reform inquiries of the 1920s and 1930s, it was used internally at Eastman Kodak from 1928 to 1989.",
    history = listOf(
        HistoryEvent(1902, "Moses B. Cotsworth first presents his 13-month International Fixed Calendar."),
        HistoryEvent(
            1923,
            "The International Fixed Calendar League is founded with George Eastman’s backing, after a League of " +
                "Nations calendar-reform inquiry rates the plan the best of some 130 proposals.",
        ),
        HistoryEvent(1928, "Eastman Kodak adopts the calendar for its internal business use."),
        HistoryEvent(1937, "The plan fails to win final approval from the League of Nations, and the IFC League winds down."),
        HistoryEvent(1989, "Eastman Kodak stops using the calendar, after 61 years."),
    ),
    weekStartsOn = Weekday.SUNDAY,
    yearOffset = 0,
    months = listOf(
        ThirteenMonthInfo(1, "January", "Jan", 1),
        ThirteenMonthInfo(2, "February", "Feb", 2),
        ThirteenMonthInfo(3, "March", "Mar", 3),
        ThirteenMonthInfo(4, "April", "Apr", 4),
        ThirteenMonthInfo(5, "May", "May", 5),
        ThirteenMonthInfo(6, "June", "Jun", 6),
        ThirteenMonthInfo(
            7, "Sol", "Sol", null,
            meaning = "Latin for “sun”: the inserted month sits mid-year, near the northern summer solstice.",
        ),
        ThirteenMonthInfo(8, "July", "Jul", 7),
        ThirteenMonthInfo(9, "August", "Aug", 8),
        ThirteenMonthInfo(10, "September", "Sep", 9),
        ThirteenMonthInfo(11, "October", "Oct", 10),
        ThirteenMonthInfo(12, "November", "Nov", 11),
        ThirteenMonthInfo(13, "December", "Dec", 12),
    ),
    intercalaryDays = listOf(
        IntercalaryDayInfo(
            id = IntercalaryDayId.LEAP_DAY,
            code = "LD",
            name = "Leap Day",
            shortName = "Leap Day",
            description = "Follows June 28 in leap years (always Gregorian 17 June). It belongs to no month and has no weekday.",
            leapOnly = true,
            afterMonth = 6,
            dayOfYear = IntercalaryDayInfo.DayOfYear(common = null, leap = 169),
        ),
        IntercalaryDayInfo(
            id = IntercalaryDayId.YEAR_DAY,
            code = "YD",
            name = "Year Day",
            shortName = "Year Day",
            description = "Follows December 28 (always Gregorian 31 December). It belongs to no month and has no weekday.",
            leapOnly = false,
            afterMonth = 13,
            dayOfYear = IntercalaryDayInfo.DayOfYear(common = 365, leap = 366),
        ),
    ),
)

internal val PositivistDefinition = CalendarSystem(
    id = CalendarSystemId.POSITIVIST,
    name = "Positivist Calendar",
    shortName = "Positivist",
    inventor = "Auguste Comte",
    proposedYear = 1849,
    summary = "Auguste Comte’s 1849 calendar of thirteen 28-day months, each named after a figure he considered a " +
        "great contributor to humanity and each starting on a Monday. Years are counted from the French " +
        "Revolution: 1789 is year 1.",
    history = listOf(
        HistoryEvent(1789, "The French Revolution begins; Comte later makes 1789 year 1 of the Positivist era."),
        HistoryEvent(
            1849,
            "Auguste Comte proposes the Positivist calendar: 13 months named after great contributors to humanity, " +
                "plus festival days.",
        ),
    ),
    weekStartsOn = Weekday.MONDAY,
    yearOffset = -1788,
    months = listOf(
        ThirteenMonthInfo(1, "Moses", "Mos", null, meaning = "Initial religiosity"),
        ThirteenMonthInfo(2, "Homer", "Hom", null, meaning = "Ancient poets"),
        ThirteenMonthInfo(3, "Aristotle", "Ari", null, meaning = "Ancient philosophers"),
        ThirteenMonthInfo(4, "Archimedes", "Arc", null, meaning = "Ancient science"),
        ThirteenMonthInfo(5, "Caesar", "Cae", null, meaning = "Military civilisation"),
        ThirteenMonthInfo(6, "Saint Paul", "Pau", null, meaning = "Catholicism"),
        ThirteenMonthInfo(7, "Charlemagne", "Cha", null, meaning = "Feudal civilisation"),
        ThirteenMonthInfo(8, "Dante", "Dan", null, meaning = "Modern epics"),
        ThirteenMonthInfo(9, "Gutenberg", "Gut", null, meaning = "Modern industry"),
        ThirteenMonthInfo(10, "Shakespeare", "Sha", null, meaning = "Modern drama"),
        ThirteenMonthInfo(11, "Descartes", "Des", null, meaning = "Modern philosophy"),
        ThirteenMonthInfo(12, "Frederick", "Fre", null, meaning = "Modern politics"),
        ThirteenMonthInfo(13, "Bichat", "Bic", null, meaning = "Modern science"),
    ),
    intercalaryDays = listOf(
        IntercalaryDayInfo(
            id = IntercalaryDayId.YEAR_DAY,
            code = "YD",
            name = "Festival of All the Dead",
            shortName = "All the Dead",
            description = "The complementary day after Bichat 28 (Gregorian 31 December, or 30 December in leap " +
                "years). It belongs to no month and has no weekday.",
            leapOnly = false,
            afterMonth = 13,
            dayOfYear = IntercalaryDayInfo.DayOfYear(common = 365, leap = 365),
        ),
        IntercalaryDayInfo(
            id = IntercalaryDayId.LEAP_DAY,
            code = "LD",
            name = "Festival of Holy Women",
            shortName = "Holy Women",
            description = "Follows the Festival of All the Dead in leap years (always Gregorian 31 December). It " +
                "belongs to no month and has no weekday.",
            leapOnly = true,
            afterMonth = 13,
            dayOfYear = IntercalaryDayInfo.DayOfYear(common = null, leap = 366),
        ),
    ),
)

internal val GregorianDefinition = GregorianCalendarInfo(
    name = "Gregorian calendar",
    shortName = "Gregorian",
    inventor = "Pope Gregory XIII",
    proposedYear = 1582,
    summary = "The reform of the Julian calendar promulgated by Pope Gregory XIII in 1582: twelve months of 28 to 31 " +
        "days and a leap day every fourth year, except in centuries not divisible by 400. It is today’s " +
        "international civil calendar.",
    history = listOf(
        HistoryEvent(
            1582,
            "Pope Gregory XIII’s bull Inter gravissimas reforms the Julian calendar; Thursday 4 October is followed " +
                "by Friday 15 October.",
        ),
        HistoryEvent(1752, "Great Britain and its colonies adopt the Gregorian calendar, skipping 3 to 13 September."),
        HistoryEvent(1923, "Greece becomes the last European country to adopt it for civil use."),
    ),
    months = GregorianMonthInfo.ALL,
)

internal val AllSystems: List<CalendarSystem> = listOf(IfcDefinition, PositivistDefinition)
