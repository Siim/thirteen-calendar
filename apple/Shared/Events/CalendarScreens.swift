import CoreGraphics
import Foundation
import ThirteenKit

// The logic of the Calendar screens (docs/EVENTS.md §2.1 to §2.7, §2.19, §2.20; tasks A5 and A6),
// kept apart from the SwiftUI views so the macOS logic tests can check it: the titles' subtitles
// and paging announcements, every accessible name of the §2.20 table, Month's density and lanes,
// the rows of the selected day's list and of Month at accessibility sizes (with runs of empty
// days), and the timeline's geometry. The views are in Features/Calendar.

// MARK: - Texts (§2.19, §2.20)

/// The Calendar screens' texts: the copy catalogue strings of §2.19 with their placeholders filled
/// from core's formatters (never an interval formatter, so no dashes appear).
enum CalendarText {
    // MARK: Titles and subtitles (§2.1)

    /// The subtitle of a mode's title: `Gregorian 2026` (Year, Positivist only), `Gregorian Oct 8 to
    /// Nov 4` (Month, through its intercalary days), `Gregorian Oct 15 to 21` (Week), `Gregorian
    /// Monday, October 19, 2026` (Day), none for List and IFC Year.
    static func subtitle(mode: CalendarMode, date: GregorianDate, system: CalendarSystemID) -> String? {
        switch mode {
        case .year:
            return system == .positivist ? "Gregorian \(date.year)" : nil
        case .month:
            let days = CalendarPeriod.monthPageDays(of: CalendarPeriod.month(of: date, system: system), system: system)
            guard let first = days.first, let last = days.last else { return nil }
            return "Gregorian \(range(first, last, sameMonthShort: false))"
        case .week:
            let days = CalendarPeriod.days(of: CalendarPeriod.week(of: date, system: system), system: system)
            guard let first = days.first, let last = days.last else { return nil }
            return "Gregorian \(range(first, last, sameMonthShort: true))"
        case .day:
            return "Gregorian \(EventFormat.gregorianDate(date))"
        case .list:
            return nil
        }
    }

    /// `calendar.subtitle.range` without the word: "Oct 8 to Nov 4", "Oct 15 to 21" (a week inside
    /// one Gregorian month), with the years when the range crosses one.
    static func range(_ first: GregorianDate, _ last: GregorianDate, sameMonthShort: Bool) -> String {
        if first.year != last.year {
            let start = first.formatted(FormatOptions(style: .short, includeYear: true))
            return "\(start) to \(last.formatted(FormatOptions(style: .short, includeYear: true)))"
        }
        let start = first.formatted(FormatOptions(style: .short))
        if sameMonthShort && first.month == last.month { return "\(start) to \(last.day)" }
        return "\(start) to \(last.formatted(FormatOptions(style: .short)))"
    }

    /// `calendar.announce.page`: "November 2026. Gregorian Nov 5 to Dec 2." (§2.1 paging).
    static func pageAnnouncement(title: String, subtitle: String?) -> String {
        guard let subtitle else { return "\(title)." }
        return "\(title). \(subtitle)."
    }

    // MARK: Day headers

    /// A day's header line 1 in the day lists, List and the "+N more" popover: `Thursday, October
    /// 12`, or an intercalary day's name, `Year Day`.
    static func dayTitle(_ day: GregorianDate, system: CalendarSystemID) -> String {
        ThirteenDate(day, system: system).formatted(FormatOptions(style: .long, includeYear: false, includeWeekday: true))
    }

    /// Line 2: `Gregorian Mon, Oct 19`.
    static func dayGregorianLine(_ day: GregorianDate) -> String {
        "Gregorian \(day.formatted(FormatOptions(style: .short, includeWeekday: true)))"
    }

    /// The 13-month date without weekday or year (`October 21`, `Year Day`), for `calendar.emptyRun`.
    static func plainDate(_ day: GregorianDate, system: CalendarSystemID) -> String {
        ThirteenDate(day, system: system).formatted(FormatOptions(style: .long, includeYear: false))
    }

    /// `calendar.emptyRun`: "No events, October 21 to October 23" (§2.4 accessibility sizes).
    static func emptyRun(from first: GregorianDate, to last: GregorianDate, system: CalendarSystemID) -> String {
        "No events, \(plainDate(first, system: system)) to \(plainDate(last, system: system))"
    }

    /// `calendar.more`: "+3 more".
    static func more(_ count: Int) -> String { "+\(count) more" }

    /// `calendar.dayOfDays`: "Day 2 of 3".
    static func dayOfDays(_ index: Int, _ total: Int) -> String { "Day \(index) of \(total)" }

    /// `calendar.until`: "until 10:30".
    static func until(_ minute: Int, use24Hour: Bool = EventFormat.uses24HourClock) -> String {
        "until \(EventFormat.time(minute, use24Hour: use24Hour))"
    }

    // MARK: Accessible names (§2.20)

    /// `calendar.weekday.a11y`: "Sunday. Gregorian Thursday".
    static func weekdayHeader(_ weekday: Weekday, gregorian: Weekday) -> String {
        "\(weekday.name(.long)). Gregorian \(gregorian.name(.long))"
    }

    /// `calendar.cell.events.a11y` (plural): "5 events." / "1 event.".
    static func eventCount(_ count: Int) -> String { count == 1 ? "1 event." : "\(count) events." }

    /// `year.cell.events` (plural): "3 events" / "1 event".
    static func yearCellValue(_ count: Int) -> String { count == 1 ? "1 event" : "\(count) events" }

    /// `calendar.cell.a11y` + `calendar.cell.events.a11y` + `calendar.gregorianMonthBegins.a11y`:
    /// "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events."
    static func cell(_ day: GregorianDate, system: CalendarSystemID, eventCount count: Int) -> String {
        var label = "\(EventFormat.date(day, system: system)). Gregorian \(EventFormat.gregorianDate(day))."
        if count > 0 { label += " \(eventCount(count))" }
        if day.day == 1 { label += " Gregorian \(day.monthInfo.name) begins." }
        return label
    }

    /// `calendar.band.a11y` (+ the count): "Year Day 2026, no weekday. Gregorian Thursday, December
    /// 31, 2026. 1 event."
    static func band(_ day: GregorianDate, system: CalendarSystemID, eventCount count: Int) -> String {
        var label = "\(EventFormat.date(day, system: system)), no weekday. Gregorian \(EventFormat.gregorianDate(day))."
        if count > 0 { label += " \(eventCount(count))" }
        if day.day == 1 { label += " Gregorian \(day.monthInfo.name) begins." }
        return label
    }

    /// `calendar.column.a11y`: "Thursday, October 12. Gregorian Monday, October 19";
    /// `calendar.column.intercalary.a11y`: "Year Day 2026, no weekday. Gregorian Thursday, December 31".
    static func column(_ day: GregorianDate, system: CalendarSystemID) -> String {
        let gregorian = day.formatted(FormatOptions(style: .long, includeYear: false, includeWeekday: true))
        let thirteen = ThirteenDate(day, system: system)
        if thirteen.isIntercalary {
            return "\(EventFormat.date(day, system: system)), no weekday. Gregorian \(gregorian)"
        }
        return "\(thirteen.formatted(FormatOptions(style: .long, includeYear: false, includeWeekday: true))). Gregorian \(gregorian)"
    }

    /// `calendar.more.a11y` (plural): "3 more events on Thursday, October 12, 2026".
    static func moreA11y(_ count: Int, day: GregorianDate, system: CalendarSystemID) -> String {
        let date = EventFormat.date(day, system: system)
        return count == 1 ? "1 more event on \(date)" : "\(count) more events on \(date)"
    }

    /// `calendar.moreAt.a11y` (plural): "3 more events at 14:00".
    static func moreAtA11y(_ count: Int, minute: Int, use24Hour: Bool = EventFormat.uses24HourClock) -> String {
        let time = EventFormat.time(minute, use24Hour: use24Hour)
        return count == 1 ? "1 more event at \(time)" : "\(count) more events at \(time)"
    }

    /// The flags of §2.20, in order: repeats; tentative or canceled; invitation or read only; day
    /// n of total; continues from or to (in the bar's own Gregorian date form).
    static func flags(
        _ occurrence: OccurrenceSnapshot, dayOf: DayOf? = nil, continuesFrom: String? = nil, continuesTo: String? = nil
    ) -> String {
        var text = ""
        if occurrence.isRepeating { text += ", repeats" }
        switch occurrence.status {
        case .tentative: text += ", tentative"
        case .canceled: text += ", canceled"
        case .confirmed: break
        }
        if let reason = occurrence.readOnly { text += reason == .invitation ? ", invitation" : ", read only" }
        if let dayOf, dayOf.total > 1 { text += ", day \(dayOf.index) of \(dayOf.total)" }
        if let continuesFrom { text += ", continues from Gregorian \(continuesFrom)" }
        if let continuesTo { text += ", continues to Gregorian \(continuesTo)" }
        return text
    }

    /// `calendar.item.a11y` + flags (Month chip, day list row, Week and Day block): "Sprint planning,
    /// 09:30 to 10:30, Work, repeats".
    static func item(
        _ occurrence: OccurrenceSnapshot, calendar: String, dayOf: DayOf? = nil, use24Hour: Bool = EventFormat.uses24HourClock
    ) -> String {
        let time =
            occurrence.allDay
            ? "All day" : EventFormat.timeRange(start: occurrence.start.minute, end: occurrence.end.minute, use24Hour: use24Hour)
        return "\(occurrence.title), \(time), \(calendar)\(flags(occurrence, dayOf: dayOf))"
    }

    /// The Gregorian date form of a bar's label: long with the weekday, the year only when it is not
    /// the year of the row the bar is drawn in (§2.20).
    static func barDate(_ day: GregorianDate, rowYear: Int) -> String {
        day.formatted(FormatOptions(style: .long, includeYear: day.year != rowYear, includeWeekday: true))
    }

    /// `calendar.bar.a11y` (one day: `calendar.bar.oneDay.a11y`) + flags: "Autumn school break, all
    /// day, from Gregorian Monday, October 19 to Sunday, October 25, Family". A bar that continues
    /// past its row adds ", continues from (to) Gregorian {date}".
    static func bar(
        _ occurrence: OccurrenceSnapshot, calendar: String, rowYear: Int, continuesBefore: Bool = false, continuesAfter: Bool = false
    ) -> String {
        let first = occurrence.start.date
        let last = lastDay(occurrence)
        let from = continuesBefore ? barDate(first, rowYear: rowYear) : nil
        let to = continuesAfter ? barDate(last, rowYear: rowYear) : nil
        let flagText = flags(occurrence, continuesFrom: from, continuesTo: to)
        if first == last { return "\(occurrence.title), all day, \(calendar)\(flagText)" }
        let range = "from Gregorian \(barDate(first, rowYear: rowYear)) to \(barDate(last, rowYear: rowYear))"
        return "\(occurrence.title), all day, \(range), \(calendar)\(flagText)"
    }

    /// `calendar.row.a11y` + flags (List rows and the day lists): "15:40, Dentist, Dr. Tamm, Home,
    /// Tartu mnt 18"; `time` is a time, "All day" or "Day 2 of 3".
    static func row(_ occurrence: OccurrenceSnapshot, time: String, calendar: String, dayOf: DayOf? = nil) -> String {
        let location = occurrence.location.isEmpty ? "" : ", \(occurrence.location)"
        return "\(time), \(occurrence.title), \(calendar)\(location)\(flags(occurrence, dayOf: dayOf))"
    }

    /// The last Gregorian day an occurrence touches (its end in end-of-day form, §3.1.1).
    static func lastDay(_ occurrence: OccurrenceSnapshot) -> GregorianDate {
        let end = occurrence.end
        if end.minute == 0 && end > occurrence.start, let previous = try? end.date.adding(days: -1) { return previous }
        return end.date
    }
}

/// "Day {index} of {total}" of a multi-day occurrence.
struct DayOf: Sendable, Hashable {
    let index: Int
    let total: Int
}

// MARK: - Period pages

extension CalendarPeriod {
    /// The days a Month page shows: the 28 month days, then the intercalary days that follow the
    /// month (its bands, §2.2).
    static func monthPageDays(of month: Month, system: CalendarSystemID) -> [GregorianDate] {
        guard let first = firstDay(of: month, system: system) else { return [] }
        let extra = ((try? IntercalaryOccurrence.all(inYear: month.year, system: system)) ?? []).filter { $0.afterMonth == month.month }.count
        return (0..<(28 + extra)).compactMap { try? first.adding(days: $0) }
    }

    /// The subtitle of the §2.1 table (see ``CalendarText/subtitle(mode:date:system:)``).
    static func subtitle(mode: CalendarMode, date: GregorianDate, system: CalendarSystemID) -> String? {
        CalendarText.subtitle(mode: mode, date: date, system: system)
    }

    /// What a compact drill-down page's back button reads (§2.1: "2026", "October"): Month and List
    /// go back to Year, Day to Month; Year has no back button.
    static func parentTitle(mode: CalendarMode, date: GregorianDate, system: CalendarSystemID) -> String? {
        switch mode {
        case .year: return nil
        case .month, .list, .week: return String(ThirteenDate(date, system: system).displayYear)
        case .day:
            let month = CalendarPeriod.month(of: date, system: system)
            return (try? system.monthInfo(month.month))?.name
        }
    }
}

// MARK: - Month (§2.4)

/// How Month cells show their events, chosen once per screen (§2.4).
enum MonthDensity: Sendable, Hashable {
    /// Bars and titles in lanes.
    case titles
    /// Up to three 6 pt dots and a count over three.
    case dots

    /// Compact width: titles when cells are at least 60 pt wide and the text size is Large (the
    /// default) or smaller; dots otherwise. Regular width always shows titles.
    static func choose(compact: Bool, cellWidth: CGFloat, textSizeAtMostDefault: Bool) -> MonthDensity {
        guard compact else { return .titles }
        return cellWidth >= 60 && textSizeAtMostDefault ? .titles : .dots
    }

    /// Regular width: as many lanes as fit under the day header (`maxLanes`, at least 1, §2.4).
    static func lanes(cellHeight: CGFloat, headerHeight: CGFloat, laneHeight: CGFloat) -> Int {
        guard laneHeight > 0 else { return 1 }
        return max(1, Int(((cellHeight - headerHeight) / laneHeight).rounded(.down)))
    }
}

/// One row of Month at accessibility text sizes (§2.4): a day with its first three events, a
/// single day without events, or a run of two or more days without events.
enum MonthListRow: Hashable, Identifiable, Sendable {
    case day(AgendaDay)
    case emptyDay(GregorianDate)
    case emptyRun(first: GregorianDate, last: GregorianDate)

    var id: Int {
        switch self {
        case let .day(day): day.gregorian.julianDayNumber
        case let .emptyDay(day): day.julianDayNumber
        case let .emptyRun(first, _): first.julianDayNumber
        }
    }

    /// The day the row opens in Day mode (a run: its first day).
    var firstDay: GregorianDate {
        switch self {
        case let .day(day): day.gregorian
        case let .emptyDay(day): day
        case let .emptyRun(first, _): first
        }
    }

    /// Whether the row covers `date` (a run covers each of its days).
    func covers(_ date: GregorianDate) -> Bool {
        switch self {
        case let .day(day): day.gregorian == date
        case let .emptyDay(day): day == date
        case let .emptyRun(first, last): first.julianDayNumber <= date.julianDayNumber && date.julianDayNumber <= last.julianDayNumber
        }
    }

    /// The row the list scrolls to the top when it opens on `selected`: the row before the selected
    /// day's, so the day keeps the one before it above (board J3); nil when no row covers it.
    static func scrollTarget(_ rows: [MonthListRow], selected: GregorianDate) -> Int? {
        guard let index = rows.firstIndex(where: { $0.covers(selected) }) else { return nil }
        return rows[max(index - 1, 0)].id
    }

    /// The rows of an agenda made with `includeEmptyDays: true` (§5.3), in order.
    static func rows(_ days: [AgendaDay]) -> [MonthListRow] {
        var out: [MonthListRow] = []
        var run: [GregorianDate] = []
        func flush() {
            if run.count == 1 { out.append(.emptyDay(run[0])) }
            if run.count > 1, let first = run.first, let last = run.last { out.append(.emptyRun(first: first, last: last)) }
            run = []
        }
        for day in days {
            if day.items.isEmpty {
                run.append(day.gregorian)
            } else {
                flush()
                out.append(.day(day))
            }
        }
        flush()
        return out
    }

    /// Event lines a day row shows before "+{n} more".
    static let shownEvents = 3
}

// MARK: - Timeline (§2.5, §2.6)

/// The Week and Day timeline's geometry: minutes to points and back, the slot limits and where it
/// starts scrolled.
struct TimelineMetrics: Sendable, Hashable {
    /// Points per hour (grows with the text size, §2.20).
    var hourHeight: CGFloat

    /// The height of the whole day.
    var dayHeight: CGFloat { hourHeight * 24 }

    /// The y of a minute of the day.
    func y(_ minute: Int) -> CGFloat { CGFloat(minute) / 60 * hourHeight }

    /// The scroll offset that puts the hour of `minute` at the top, with the inset above its line
    /// left showing so its label is not cut.
    func scrollOffset(toHourOf minute: Int) -> CGFloat { CGFloat(max(minute, 0) / 60) * hourHeight }

    /// The minute at `y`, rounded down to `snap` minutes and kept inside the day (a start: at most
    /// `1440 - snap`).
    func minute(atY y: CGFloat, snap: Int = 15) -> Int {
        guard hourHeight > 0 else { return 0 }
        let raw = Int((y / hourHeight * 60).rounded(.down))
        let snapped = Int((Double(raw) / Double(snap)).rounded(.down)) * snap
        return min(max(snapped, 0), 1440 - snap)
    }

    /// The minute at `y`, rounded to the nearest `snap` minutes (a drag's end), `0…1440`.
    func roundedMinute(atY y: CGFloat, snap: Int = 15) -> Int {
        guard hourHeight > 0 else { return 0 }
        let raw = (y / hourHeight * 60) / CGFloat(snap)
        return min(max(Int(raw.rounded()) * snap, 0), 1440)
    }

    /// The height of an item, at least the 15-minute minimum (§2.5).
    func height(start: Int, end: Int, minimumMinutes: Int = 15) -> CGFloat {
        y(max(end, start + minimumMinutes)) - y(start)
    }

    /// `maxSlots` = floor(column width / minimum slot width), at least 1 (Week 48 pt, Day 64 pt).
    static func maxSlots(columnWidth: CGFloat, minimumSlotWidth: CGFloat) -> Int {
        guard minimumSlotWidth > 0, columnWidth.isFinite, columnWidth > 0 else { return 1 }
        return max(1, Int((columnWidth / minimumSlotWidth).rounded(.down)))
    }

    /// Where the timeline starts scrolled (§2.5): 07:00, or the first timed event of the page if earlier.
    static func initialMinute(firstEvent: Int?) -> Int {
        min(7 * 60, firstEvent ?? 7 * 60)
    }

    /// A touch-and-hold draft (§2.4, §2.6): one hour from the half hour at `minute`, kept inside
    /// the day.
    static func holdDraft(atMinute minute: Int) -> (start: Int, end: Int) {
        let start = min(max((minute / 30) * 30, 0), 1380)
        return (start, start + 60)
    }

    /// A drag on empty time (§2.5): its range snapped to 15 minutes, at least 15 minutes long.
    static func dragDraft(fromMinute a: Int, toMinute b: Int) -> (start: Int, end: Int) {
        let low = min(a, b), high = max(a, b)
        let start = min(max((low / 15) * 15, 0), 1425)
        let end = min(max(((high + 14) / 15) * 15, start + 15), 1440)
        return (start, end)
    }
}

// MARK: - Keyboard (§2.21)

/// What a key does on a Month or Week grid (§2.21), kept apart from the view (CalendarView.swift,
/// `calendarKeyboard`) so the logic tests can check it.
enum CalendarKeyboard {
    enum Key: Equatable {
        case left, right, up, down, tab, backTab, returnKey, f2, escape
    }

    enum Action: Equatable {
        /// Select another day (leaving its events).
        case selectDay(GregorianDate)
        /// Select an event of the selected day (into its events, or among them).
        case selectEvent(String)
        /// Open the selected event's details.
        case open(String)
        /// Back from the events to the day.
        case backToDay
    }

    /// The action of `key` on `day`, whose events are `events` (agenda order), with `selected` the
    /// window's selected event; `weekStep` is 7 in Month and nil in Week (up and down do not move
    /// the day there). Nil: the key is not the grid's.
    static func action(
        _ key: Key, day: GregorianDate, events: [String], selected: String?, weekStep: Int?
    ) -> Action? {
        let index = selected.flatMap { events.firstIndex(of: $0) }
        if let index {
            // Among the day's events.
            switch key {
            case .left, .up, .backTab:
                return .selectEvent(events[max(index - 1, 0)])
            case .right, .down, .tab:
                return .selectEvent(events[min(index + 1, events.count - 1)])
            case .returnKey:
                return .open(events[index])
            case .f2:
                return nil
            case .escape:
                return .backToDay
            }
        }
        switch key {
        case .left, .right:
            return (try? day.adding(days: key == .left ? -1 : 1)).map { .selectDay($0) }
        case .up, .down:
            guard let weekStep else { return nil }
            return (try? day.adding(days: key == .up ? -weekStep : weekStep)).map { .selectDay($0) }
        case .returnKey, .f2:
            return events.first.map { .selectEvent($0) }
        case .tab, .backTab, .escape:
            return nil
        }
    }
}

// MARK: - Event rows

/// What one row of a day list (Month's selected day, the "+N more" popover, List mode) shows: the
/// time column and the second line (§2.8 row design).
struct CalendarRowText: Sendable, Hashable {
    /// `11:00` / `11:00 AM`, "All day", or "Day 2 of 3".
    let time: String
    /// The location, or `until 11:30`.
    let detail: String?
    /// "Day n of total" for a part of a multi-day event (the accessible name's flag).
    let dayOf: DayOf?
    /// The time column holds a clock time (Geist Mono), not "All day" or "Day n of total".
    let isClockTime: Bool

    /// The row of `occurrence` on a day of the agenda (`item` is its part on that day, §5.3).
    init(_ occurrence: OccurrenceSnapshot, item: AgendaItem?, use24Hour: Bool = EventFormat.uses24HourClock) {
        let total = item?.dayCount ?? 1
        let index = item?.dayIndex ?? 1
        dayOf = total > 1 ? DayOf(index: index, total: total) : nil
        let location = occurrence.location.isEmpty ? nil : occurrence.location
        if occurrence.allDay {
            // Boards A1 and J2: "All day" in the time column, "Day 1 of 7" on the second line.
            time = "All day"
            let parts = [total > 1 ? CalendarText.dayOfDays(index, total) : nil, location].compactMap { $0 }
            detail = parts.isEmpty ? nil : parts.joined(separator: " · ")
            isClockTime = false
            return
        }
        switch item?.part ?? .single {
        case .middle, .last:
            time = CalendarText.dayOfDays(index, total)
            isClockTime = false
            if let location {
                detail = location
            } else if item?.part == .last, let end = item?.endMinute {
                detail = CalendarText.until(end, use24Hour: use24Hour)
            } else {
                detail = nil
            }
        case .single, .first:
            time = EventFormat.time(item?.startMinute ?? occurrence.start.minute, use24Hour: use24Hour)
            isClockTime = true
            if let location {
                detail = location
            } else if item?.part == .first {
                detail = nil
            } else {
                detail = CalendarText.until(item?.endMinute ?? occurrence.end.minute, use24Hour: use24Hour)
            }
        }
    }
}
