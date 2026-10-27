import Foundation
import ThirteenKit

/// Today's "Up next" (docs/EVENTS.md §2.8, board B1), the rows it shares with the day sheet's
/// Events section (§2.9), and the Mac menu bar's "Next:" line. Pure values, so the tests pin them
/// with the mockup data set (§6.7) without a view.
///
/// Readings of §2.8 and board B1, the same as the web's `upNext` (packages/ui/src/events/upNext.ts):
/// - "7 days ahead" is today and the 6 days after it (board B1 counts "5 more in the next 7 days"
///   through Sunday, October 25).
/// - An event appears once, on the first day of the range it touches: a multi-day event that
///   started before today is listed today ("Day 2 of 3") and not again later (board B1 lists
///   Autumn school break under Today only).
/// - Events that ended earlier today are left out; one running now keeps its row with the Now
///   plate. Rows keep the agenda's order (all-day items and middle parts first, then by start), so
///   a running event leads the timed rows, under the all-day ones, as board B1 draws it.
/// - The rows past the sixth are counted, each event once, in ``more``.
struct UpNextAgenda: Sendable, Hashable {
    /// Today and the 6 days after it.
    static let dayCount = 7
    /// At most this many rows; the rest are counted (`today.moreNext7`).
    static let maxRows = 6

    /// How a group is headed (§2.8): "Today", "Tomorrow", or the day in both calendars.
    enum Kind: Sendable, Hashable {
        case today, tomorrow, later
    }

    /// The rows of one day.
    struct Group: Sendable, Hashable, Identifiable {
        let kind: Kind
        let gregorian: GregorianDate
        let thirteen: ThirteenDate
        /// The rows of this day, in the agenda's order.
        let items: [AgendaItem]

        var id: Int { gregorian.julianDayNumber }
    }

    /// Days with rows, in date order.
    let groups: [Group]
    /// Events in the range past the row limit (`today.moreNext7`).
    let more: Int
    /// Today still has something to show (else `today.emptyToday`, when later days do).
    let todayLeft: Bool
    /// Nothing at all in the 7 days (`today.emptyWeek`).
    let isEmpty: Bool
    /// The last day of the range (inclusive).
    let lastDay: GregorianDate

    /// The last day of the range that starts on `today`.
    static func lastDay(from today: GregorianDate, days: Int = dayCount) -> GregorianDate {
        (try? today.adding(days: days - 1)) ?? today
    }

    /// The Up next rows for `now` (the device wall clock; its date is "today") from the visible
    /// calendars' occurrences, which must cover `now.date` to 6 days later.
    init(occurrences: [OccurrenceSnapshot], now: LocalDateTime, system: CalendarSystemID, days: Int = dayCount, maxRows: Int = maxRows) {
        let from = now.date
        let to = Self.lastDay(from: from, days: days)
        let tomorrow = try? from.adding(days: 1)
        let current = occurrences.filter { !Self.hasEnded($0, now: now) }.map(\.occurrence)
        let agenda = (try? AgendaDay.days(occurrences: current, from: from, to: to, system: system)) ?? []
        var seen = Set<String>()
        var groups: [Group] = []
        var shown = 0
        var total = 0
        var todayLeft = false
        for day in agenda {
            var rows: [AgendaItem] = []
            for item in day.items where seen.insert(item.key).inserted {
                total += 1
                if day.gregorian == from { todayLeft = true }
                if shown < maxRows {
                    rows.append(item)
                    shown += 1
                }
            }
            guard !rows.isEmpty else { continue }
            let kind: Kind = day.gregorian == from ? .today : day.gregorian == tomorrow ? .tomorrow : .later
            groups.append(Group(kind: kind, gregorian: day.gregorian, thirteen: day.thirteen, items: rows))
        }
        self.groups = groups
        more = total - shown
        self.todayLeft = todayLeft
        isEmpty = total == 0
        lastDay = to
    }

    /// Ended before `now`: its end is at or before now (a zero-length event at now has not ended).
    static func hasEnded(_ occurrence: OccurrenceSnapshot, now: LocalDateTime) -> Bool {
        occurrence.end <= now && occurrence.start < now
    }

    /// Timed and running now (`start <= now < end`): the row wears the Now plate (§2.8).
    static func isInProgress(_ occurrence: OccurrenceSnapshot, now: LocalDateTime) -> Bool {
        !occurrence.allDay && occurrence.start <= now && now < occurrence.end
    }

    /// The rows of one day for the day sheet (§2.9): every item of the day, ended ones included.
    static func items(on day: GregorianDate, occurrences: [OccurrenceSnapshot], system: CalendarSystemID) -> [AgendaItem] {
        let agenda = (try? AgendaDay.days(occurrences: occurrences.map(\.occurrence), from: day, to: day, system: system)) ?? []
        return agenda.first?.items ?? []
    }

    // MARK: Row texts

    /// What the time column shows (§2.8): a time (`09:30`, `9:30 AM`), "All day", or "Day 2 of 3"
    /// on the later days of a timed event that runs over several days.
    static func timeText(_ occurrence: OccurrenceSnapshot, item: AgendaItem, use24Hour: Bool = EventFormat.uses24HourClock) -> String {
        if occurrence.allDay { return "All day" }
        if item.part == .middle || item.part == .last { return dayOfDays(item) }
        return EventFormat.time(item.startMinute ?? occurrence.start.minute, use24Hour: use24Hour)
    }

    /// The second line (§2.8): "Day 1 of 7" (an all-day event over several days), the location, or
    /// "until 11:30"; empty when there is nothing to say.
    static func detailText(_ occurrence: OccurrenceSnapshot, item: AgendaItem, use24Hour: Bool = EventFormat.uses24HourClock) -> String {
        if occurrence.allDay { return item.dayCount > 1 ? dayOfDays(item) : "" }
        if !occurrence.location.isEmpty { return occurrence.location }
        if item.part == .single || item.part == .last, let end = item.endMinute {
            return "until \(EventFormat.time(end, use24Hour: use24Hour))"
        }
        return ""
    }

    /// `calendar.dayOfDays`: "Day 2 of 3".
    static func dayOfDays(_ item: AgendaItem) -> String { "Day \(item.dayIndex) of \(item.dayCount)" }

    /// `calendar.row.a11y` + flags (§2.20): "15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18". `time` is
    /// what the time column shows; ", {location}" is left out when there is none.
    static func accessibilityLabel(_ occurrence: OccurrenceSnapshot, item: AgendaItem, calendarTitle: String, time: String) -> String {
        var label = "\(time), \(occurrence.title), \(calendarTitle)"
        if !occurrence.location.isEmpty { label += ", \(occurrence.location)" }
        return label + flags(occurrence, item: item)
    }

    /// The flags of §2.20 in their order: repeats, tentative or canceled, invitation or read only,
    /// day {n} of {total}.
    static func flags(_ occurrence: OccurrenceSnapshot, item: AgendaItem) -> String {
        var flags = ""
        if occurrence.isRepeating { flags += ", repeats" }
        switch occurrence.status {
        case .tentative: flags += ", tentative"
        case .canceled: flags += ", canceled"
        case .confirmed: break
        }
        switch occurrence.readOnly {
        case .invitation?: flags += ", invitation"
        case .some: flags += ", read only"
        case nil: break
        }
        if item.dayCount > 1 { flags += ", day \(item.dayIndex) of \(item.dayCount)" }
        return flags
    }

    /// "Thursday, October 12" (or "Year Day"): a later day's heading.
    static func dayHeading(_ thirteen: ThirteenDate) -> String {
        thirteen.formatted(FormatOptions(style: .long, includeYear: false, includeWeekday: true))
    }

    /// "Gregorian Mon, Oct 19": the Gregorian line beside a later day's heading.
    static func gregorianCaption(_ gregorian: GregorianDate) -> String {
        "Gregorian \(gregorian.formatted(FormatOptions(style: .short, includeWeekday: true)))"
    }

    /// The heading as VoiceOver reads it, in long forms: "Saturday, October 14. Gregorian
    /// Wednesday, October 21".
    static func dayHeadingLabel(thirteen: ThirteenDate, gregorian: GregorianDate) -> String {
        "\(dayHeading(thirteen)). Gregorian \(gregorian.formatted(FormatOptions(style: .long, includeYear: false, includeWeekday: true)))"
    }

    /// `today.moreNext7` (plural): "5 more in the next 7 days", "1 more in the next 7 days".
    static func moreText(_ count: Int) -> String { "\(count) more in the next 7 days" }

    // MARK: The menu bar line

    /// The next event for the Mac menu bar extra's line under today's date (§2.8): the first timed
    /// occurrence of today that has not started yet (an event already running is not "next";
    /// all-day events have no time to show). `nil` shows no line. Only today: the line sits under
    /// today's date and says only a time, so an event tomorrow would read as one today.
    static func nextEvent(occurrences: [OccurrenceSnapshot], now: LocalDateTime) -> OccurrenceSnapshot? {
        occurrences
            .filter { !$0.allDay && $0.start.date == now.date && $0.start >= now }
            .min { ($0.start, $0.key) < ($1.start, $1.key) }
    }

    /// `menubar.next`: "Next: 19:00 Book club: Cotsworth".
    static func menuBarText(_ occurrence: OccurrenceSnapshot, use24Hour: Bool = EventFormat.uses24HourClock) -> String {
        "Next: \(EventFormat.time(occurrence.start.minute, use24Hour: use24Hour)) \(occurrence.title)"
    }

    /// `menubar.next.a11y`: "Next event: Book club: Cotsworth at 19:00".
    static func menuBarLabel(_ occurrence: OccurrenceSnapshot, use24Hour: Bool = EventFormat.uses24HourClock) -> String {
        "Next event: \(occurrence.title) at \(EventFormat.time(occurrence.start.minute, use24Hour: use24Hour))"
    }
}
