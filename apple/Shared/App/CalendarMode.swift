import Foundation
import ThirteenKit

/// The five modes of the Calendar section (docs/EVENTS.md §2.1), in the order of the segmented
/// control and of the View menu (⌃⌘1 to ⌃⌘5).
enum CalendarMode: String, CaseIterable, Identifiable, Hashable, Sendable, Codable {
    case day, week, month, year, list

    var id: String { rawValue }

    /// `calendar.mode.*` (§2.19).
    var title: String {
        switch self {
        case .day: "Day"
        case .week: "Week"
        case .month: "Month"
        case .year: "Year"
        case .list: "List"
        }
    }

    /// The digit of the ⌃⌘1…⌃⌘5 shortcut (§2.21).
    var shortcutDigit: Character {
        switch self {
        case .day: "1"
        case .week: "2"
        case .month: "3"
        case .year: "4"
        case .list: "5"
        }
    }

    /// The unit paging steps by (`calendar.previous.*`, `calendar.next.*`); `nil` for List, which
    /// does not page.
    var unit: PagingUnit? {
        switch self {
        case .day: .day
        case .week: .week
        case .month: .month
        case .year: .year
        case .list: nil
        }
    }

    /// The mode shown at a width: compact width has no Week mode, so a week (a deep link, the
    /// remembered mode of a window made narrow) shows as Day (§2.1, §2.22).
    func resolved(compact: Bool) -> CalendarMode {
        compact && self == .week ? .day : self
    }

    /// `-ThirteenQACalendarMode day|week|month|year|list`.
    init?(launchArgument value: String?) {
        guard let value, let mode = CalendarMode(rawValue: value.lowercased()) else { return nil }
        self = mode
    }
}

/// What one page of Calendar covers, and so what ⌘← / ⌘→, the toolbar's "‹" and "›" and the
/// accessibility paging actions step by (§2.1, §2.21).
enum PagingUnit: String, Sendable, Hashable {
    case day, week, month, year

    /// `calendar.previous.month|week|day` (Year: the existing "Previous Year").
    var previousTitle: String { "Previous \(rawValue.capitalized)" }
    /// `calendar.next.month|week|day` (Year: the existing "Next Year").
    var nextTitle: String { "Next \(rawValue.capitalized)" }
}

/// The 13-month period arithmetic of Calendar (§2.1): which month and week a day belongs to, and
/// where paging goes. Years are Gregorian; months are the 13 months of the system in that year.
/// An intercalary day belongs to the month it follows (`afterMonth`: its band in Month, §2.2) and
/// to that month's week 4 (its extra column in Week).
enum CalendarPeriod {
    /// A 13-month month of a Gregorian year.
    struct Month: Hashable, Sendable {
        let year: Int
        let month: Int
    }

    /// A 13-month week (1 to 4) of a month.
    struct Week: Hashable, Sendable {
        let month: Month
        let week: Int
    }

    /// The month `date` is shown in.
    static func month(of date: GregorianDate, system: CalendarSystemID) -> Month {
        switch ThirteenDate(date, system: system) {
        case let .month(day): Month(year: date.year, month: day.month)
        case let .intercalary(day): Month(year: date.year, month: day.info.afterMonth)
        }
    }

    /// The week `date` is shown in.
    static func week(of date: GregorianDate, system: CalendarSystemID) -> Week {
        switch ThirteenDate(date, system: system) {
        case let .month(day): Week(month: Month(year: date.year, month: day.month), week: (day.day - 1) / 7 + 1)
        case let .intercalary(day): Week(month: Month(year: date.year, month: day.info.afterMonth), week: 4)
        }
    }

    /// The first day of a month, or `nil` outside years 1 to 9999.
    static func firstDay(of month: Month, system: CalendarSystemID) -> GregorianDate? {
        (try? ThirteenMonthDate(year: month.year, month: month.month, day: 1, system: system))?.gregorian
    }

    /// The days of a week: 7 month days, plus for week 4 the intercalary days that follow the month.
    static func days(of week: Week, system: CalendarSystemID) -> [GregorianDate] {
        guard let first = try? ThirteenMonthDate(year: week.month.year, month: week.month.month, day: (week.week - 1) * 7 + 1, system: system)
        else { return [] }
        let count = week.week == 4 ? 7 + intercalaryCount(after: week.month, system: system) : 7
        return (0..<count).compactMap { try? first.gregorian.adding(days: $0) }
    }

    private static func intercalaryCount(after month: Month, system: CalendarSystemID) -> Int {
        ((try? IntercalaryOccurrence.all(inYear: month.year, system: system)) ?? []).filter { $0.afterMonth == month.month }.count
    }

    /// Whether the page of `mode` on `date` shows `today` (§2.1 "Today" is hidden while it does):
    /// Month and Week contain it, Day and List are on it, Year is its year.
    static func shows(_ today: GregorianDate, mode: CalendarMode, on date: GregorianDate, system: CalendarSystemID) -> Bool {
        switch mode {
        case .day, .list: date == today
        case .week: week(of: date, system: system) == week(of: today, system: system)
        case .month: month(of: date, system: system) == month(of: today, system: system)
        case .year: date.year == today.year
        }
    }

    /// The day `delta` pages away in `mode` (List does not page). A month day keeps its day of the
    /// month and a week its column; an intercalary day pages from day 28 of the month it follows.
    /// Year keeps the 13-month slot (a leap-only day falls back to the day before it). Paging past
    /// years 1 to 9999 stays put.
    static func step(_ date: GregorianDate, mode: CalendarMode, by delta: Int, system: CalendarSystemID) -> GregorianDate {
        guard delta != 0, let unit = mode.unit else { return date }
        switch unit {
        case .day:
            return (try? date.adding(days: delta)) ?? date
        case .week:
            let position = week(of: date, system: system)
            let column: Int = ThirteenDate(date, system: system).monthDate.map { ($0.day - 1) % 7 } ?? 6
            let index = (position.month.month - 1) * 4 + (position.week - 1) + delta
            let target = shifted(year: position.month.year, monthIndex: Self.floorDiv(index, 4))
            let weekIndex = index - Self.floorDiv(index, 4) * 4
            guard let target,
                let day = try? ThirteenMonthDate(year: target.year, month: target.month, day: weekIndex * 7 + column + 1, system: system)
            else { return date }
            return day.gregorian
        case .month:
            let position = month(of: date, system: system)
            let monthDay = ThirteenDate(date, system: system).monthDate?.day ?? 28
            guard let target = shifted(year: position.year, monthIndex: position.month - 1 + delta),
                let day = try? ThirteenMonthDate(year: target.year, month: target.month, day: monthDay, system: system)
            else { return date }
            return day.gregorian
        case .year:
            return sameSlot(date, inYear: date.year + delta, system: system) ?? date
        }
    }

    /// The same 13-month slot in another Gregorian year; a leap-only day missing there falls back
    /// to the day before it (as the converter's year field does). `nil` outside years 1 to 9999.
    static func sameSlot(_ date: GregorianDate, inYear year: Int, system: CalendarSystemID) -> GregorianDate? {
        guard GregorianDate.isValidYear(year) else { return nil }
        let thirteen = ThirteenDate(date, system: system)
        if let same = try? thirteen.sameSlot(inYear: year) { return same.gregorian }
        if let previous = try? thirteen.adding(days: -1), let moved = try? previous.sameSlot(inYear: year) { return moved.gregorian }
        return try? GregorianDate(year: year, month: 1, day: 1)
    }

    /// The years a mode's page touches (Week and Day may cross January 1).
    static func years(mode: CalendarMode, date: GregorianDate) -> ClosedRange<Int> {
        let low = max(date.year - (date.dayOfYear <= 7 ? 1 : 0), GregorianDate.minYear)
        let high = min(date.year + (date.dayOfYear >= 359 ? 1 : 0), GregorianDate.maxYear)
        switch mode {
        case .list: return date.year...min(date.year + 1, GregorianDate.maxYear)
        default: return low...high
        }
    }

    /// The titles of §2.1 (the subtitles are task A5's).
    static func title(mode: CalendarMode, date: GregorianDate, system: CalendarSystemID) -> String {
        let thirteen = ThirteenDate(date, system: system)
        switch mode {
        case .year:
            return String(thirteen.displayYear)
        case .month:
            let month = CalendarPeriod.month(of: date, system: system)
            let name = (try? system.monthInfo(month.month))?.name ?? ""
            return "\(name) \(thirteen.displayYear)"
        case .week:
            let week = CalendarPeriod.week(of: date, system: system)
            let name = (try? system.monthInfo(week.month.month))?.name ?? ""
            return "\(name) \(thirteen.displayYear), week \(week.week)"
        case .day:
            return EventFormat.date(date, system: system)
        case .list:
            return "Upcoming"
        }
    }

    /// Month `monthIndex` (0-based, may be negative or past 12) counted from month 1 of `year`.
    private static func shifted(year: Int, monthIndex: Int) -> Month? {
        let years = floorDiv(monthIndex, 13)
        let month = monthIndex - years * 13 + 1
        let target = year + years
        guard GregorianDate.isValidYear(target) else { return nil }
        return Month(year: target, month: month)
    }

    private static func floorDiv(_ a: Int, _ b: Int) -> Int {
        let q = a / b
        return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q
    }
}
