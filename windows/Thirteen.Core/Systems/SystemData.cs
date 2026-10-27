// Generated from the @thirteen/core system data as recorded in fixtures/conversions.json
// (sections "systems" and "gregorianCalendar"); keep in sync. FixtureParityTests compares these
// values with the fixture field by field and requires them to be identical. The engine text is kept
// byte-identical to @thirteen/core, ThirteenKit and the Kotlin port and has no en or em dash. The
// copy rule is still applied when text is displayed (DisplayText.WithoutDashes, as the Apple apps do
// with Phrasing.withoutDashes), so engine text added later cannot bring a dash to the screen.

namespace Thirteen.Core;

internal static class SystemData
{
    internal static readonly CalendarSystem Ifc = new(
        id: CalendarSystemId.Ifc,
        name: "International Fixed Calendar",
        shortName: "IFC",
        inventor: "Moses B. Cotsworth",
        proposedYear: 1902,
        summary: "Moses B. Cotsworth’s perennial calendar, first presented in 1902: thirteen 28-day months that all start on a Sunday, with Sol inserted between June and July. Promoted by the International Fixed Calendar League (founded 1923) with George Eastman’s backing and considered by the League of Nations’ calendar-reform inquiries of the 1920s and 1930s, it was used internally at Eastman Kodak from 1928 to 1989.",
        history:
        [
            new HistoryEvent(1902, "Moses B. Cotsworth first presents his 13-month International Fixed Calendar."),
            new HistoryEvent(1923, "The International Fixed Calendar League is founded with George Eastman’s backing, after a League of Nations calendar-reform inquiry rates the plan the best of some 130 proposals."),
            new HistoryEvent(1928, "Eastman Kodak adopts the calendar for its internal business use."),
            new HistoryEvent(1937, "The plan fails to win final approval from the League of Nations, and the IFC League winds down."),
            new HistoryEvent(1989, "Eastman Kodak stops using the calendar, after 61 years."),
        ],
        weekStartsOn: Weekday.Sunday,
        yearOffset: 0,
        months:
        [
            new ThirteenMonthInfo(1, "January", "Jan", 1),
            new ThirteenMonthInfo(2, "February", "Feb", 2),
            new ThirteenMonthInfo(3, "March", "Mar", 3),
            new ThirteenMonthInfo(4, "April", "Apr", 4),
            new ThirteenMonthInfo(5, "May", "May", 5),
            new ThirteenMonthInfo(6, "June", "Jun", 6),
            new ThirteenMonthInfo(7, "Sol", "Sol", null, "Latin for “sun”: the inserted month sits mid-year, near the northern summer solstice."),
            new ThirteenMonthInfo(8, "July", "Jul", 7),
            new ThirteenMonthInfo(9, "August", "Aug", 8),
            new ThirteenMonthInfo(10, "September", "Sep", 9),
            new ThirteenMonthInfo(11, "October", "Oct", 10),
            new ThirteenMonthInfo(12, "November", "Nov", 11),
            new ThirteenMonthInfo(13, "December", "Dec", 12),
        ],
        intercalaryDays:
        [
            new IntercalaryDayInfo(
                IntercalaryDayId.LeapDay,
                "LD",
                "Leap Day",
                "Leap Day",
                "Follows June 28 in leap years (always Gregorian 17 June). It belongs to no month and has no weekday.",
                LeapOnly: true,
                AfterMonth: 6,
                new IntercalaryDayOfYear(Common: null, Leap: 169)),
            new IntercalaryDayInfo(
                IntercalaryDayId.YearDay,
                "YD",
                "Year Day",
                "Year Day",
                "Follows December 28 (always Gregorian 31 December). It belongs to no month and has no weekday.",
                LeapOnly: false,
                AfterMonth: 13,
                new IntercalaryDayOfYear(Common: 365, Leap: 366)),
        ]);

    internal static readonly CalendarSystem Positivist = new(
        id: CalendarSystemId.Positivist,
        name: "Positivist Calendar",
        shortName: "Positivist",
        inventor: "Auguste Comte",
        proposedYear: 1849,
        summary: "Auguste Comte’s 1849 calendar of thirteen 28-day months, each named after a figure he considered a great contributor to humanity and each starting on a Monday. Years are counted from the French Revolution: 1789 is year 1.",
        history:
        [
            new HistoryEvent(1789, "The French Revolution begins; Comte later makes 1789 year 1 of the Positivist era."),
            new HistoryEvent(1849, "Auguste Comte proposes the Positivist calendar: 13 months named after great contributors to humanity, plus festival days."),
        ],
        weekStartsOn: Weekday.Monday,
        yearOffset: -1788,
        months:
        [
            new ThirteenMonthInfo(1, "Moses", "Mos", null, "Initial religiosity"),
            new ThirteenMonthInfo(2, "Homer", "Hom", null, "Ancient poets"),
            new ThirteenMonthInfo(3, "Aristotle", "Ari", null, "Ancient philosophers"),
            new ThirteenMonthInfo(4, "Archimedes", "Arc", null, "Ancient science"),
            new ThirteenMonthInfo(5, "Caesar", "Cae", null, "Military civilisation"),
            new ThirteenMonthInfo(6, "Saint Paul", "Pau", null, "Catholicism"),
            new ThirteenMonthInfo(7, "Charlemagne", "Cha", null, "Feudal civilisation"),
            new ThirteenMonthInfo(8, "Dante", "Dan", null, "Modern epics"),
            new ThirteenMonthInfo(9, "Gutenberg", "Gut", null, "Modern industry"),
            new ThirteenMonthInfo(10, "Shakespeare", "Sha", null, "Modern drama"),
            new ThirteenMonthInfo(11, "Descartes", "Des", null, "Modern philosophy"),
            new ThirteenMonthInfo(12, "Frederick", "Fre", null, "Modern politics"),
            new ThirteenMonthInfo(13, "Bichat", "Bic", null, "Modern science"),
        ],
        intercalaryDays:
        [
            new IntercalaryDayInfo(
                IntercalaryDayId.YearDay,
                "YD",
                "Festival of All the Dead",
                "All the Dead",
                "The complementary day after Bichat 28 (Gregorian 31 December, or 30 December in leap years). It belongs to no month and has no weekday.",
                LeapOnly: false,
                AfterMonth: 13,
                new IntercalaryDayOfYear(Common: 365, Leap: 365)),
            new IntercalaryDayInfo(
                IntercalaryDayId.LeapDay,
                "LD",
                "Festival of Holy Women",
                "Holy Women",
                "Follows the Festival of All the Dead in leap years (always Gregorian 31 December). It belongs to no month and has no weekday.",
                LeapOnly: true,
                AfterMonth: 13,
                new IntercalaryDayOfYear(Common: null, Leap: 366)),
        ]);

    internal static readonly GregorianCalendarInfo Gregorian = new(
        name: "Gregorian calendar",
        shortName: "Gregorian",
        inventor: "Pope Gregory XIII",
        proposedYear: 1582,
        summary: "The reform of the Julian calendar promulgated by Pope Gregory XIII in 1582: twelve months of 28 to 31 days and a leap day every fourth year, except in centuries not divisible by 400. It is today’s international civil calendar.",
        history:
        [
            new HistoryEvent(1582, "Pope Gregory XIII’s bull Inter gravissimas reforms the Julian calendar; Thursday 4 October is followed by Friday 15 October."),
            new HistoryEvent(1752, "Great Britain and its colonies adopt the Gregorian calendar, skipping 3 to 13 September."),
            new HistoryEvent(1923, "Greece becomes the last European country to adopt it for civil use."),
        ]);
}
