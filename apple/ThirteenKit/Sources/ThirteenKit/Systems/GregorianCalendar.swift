// Generated from the @thirteen/core Gregorian descriptor (packages/core/src/systems/gregorian.ts); keep in sync.

extension GregorianMonthInfo {
    /// The 12 Gregorian months in order (`all[0].index == 1`). TS: `GREGORIAN_MONTHS`.
    public static let all: [GregorianMonthInfo] = [
        GregorianMonthInfo(index: 1, name: "January", shortName: "Jan", narrowName: "J"),
        GregorianMonthInfo(index: 2, name: "February", shortName: "Feb", narrowName: "F"),
        GregorianMonthInfo(index: 3, name: "March", shortName: "Mar", narrowName: "M"),
        GregorianMonthInfo(index: 4, name: "April", shortName: "Apr", narrowName: "A"),
        GregorianMonthInfo(index: 5, name: "May", shortName: "May", narrowName: "M"),
        GregorianMonthInfo(index: 6, name: "June", shortName: "Jun", narrowName: "J"),
        GregorianMonthInfo(index: 7, name: "July", shortName: "Jul", narrowName: "J"),
        GregorianMonthInfo(index: 8, name: "August", shortName: "Aug", narrowName: "A"),
        GregorianMonthInfo(index: 9, name: "September", shortName: "Sep", narrowName: "S"),
        GregorianMonthInfo(index: 10, name: "October", shortName: "Oct", narrowName: "O"),
        GregorianMonthInfo(index: 11, name: "November", shortName: "Nov", narrowName: "N"),
        GregorianMonthInfo(index: 12, name: "December", shortName: "Dec", narrowName: "D"),
    ]
}

extension GregorianCalendarInfo {
    /// The Gregorian calendar (proleptic for years before 1582 in this engine), the "12" side of the
    /// 12 vs 13 Compare view. TS: `GREGORIAN_CALENDAR`.
    public static let gregorian = GregorianCalendarInfo(
        name: "Gregorian calendar",
        shortName: "Gregorian",
        inventor: "Pope Gregory XIII",
        proposedYear: 1582,
        summary:
            "The reform of the Julian calendar promulgated by Pope Gregory XIII in 1582: twelve months of 28 to 31 days and a leap day every fourth year, except in centuries not divisible by 400. It is today’s international civil calendar.",
        history: [
            HistoryEvent(year: 1582, text: "Pope Gregory XIII’s bull Inter gravissimas reforms the Julian calendar; Thursday 4 October is followed by Friday 15 October."),
            HistoryEvent(year: 1752, text: "Great Britain and its colonies adopt the Gregorian calendar, skipping 3 to 13 September."),
            HistoryEvent(year: 1923, text: "Greece becomes the last European country to adopt it for civil use."),
        ],
        months: GregorianMonthInfo.all
    )
}
