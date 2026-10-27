import Foundation
import ThirteenKit

/// The `{date}`, `{time}` and range forms of the copy catalogue (docs/EVENTS.md §2.19), shared by
/// every events screen so their texts agree. Never an interval formatter (they insert dashes).
enum EventFormat {
    /// Whether the OS shows 12-hour times (the `j` skeleton of the locale has a day period).
    static var uses24HourClock: Bool {
        let format = DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: .current) ?? "HH"
        return !format.contains("a") && !format.contains("b") && !format.contains("B")
    }

    /// `{time}`: the short time in the OS 12 or 24-hour setting, `09:30` or `9:30 AM` (§2.19).
    /// `minute` is a wall-clock minute of the day (`0…1440`; 1440 reads as `00:00`).
    static func time(_ minute: Int, use24Hour: Bool = uses24HourClock) -> String {
        let value = ((minute % 1440) + 1440) % 1440
        let hour = value / 60
        let minutes = value % 60
        let mm = minutes < 10 ? "0\(minutes)" : "\(minutes)"
        if use24Hour { return "\(hour < 10 ? "0" : "")\(hour):\(mm)" }
        return "\(hour % 12 == 0 ? 12 : hour % 12):\(mm) \(hour < 12 ? "AM" : "PM")"
    }

    /// `{date}`: the long 13-month date with its weekday, "Thursday, October 12, 2026", or the
    /// intercalary day's name with the year, "Year Day 2026" (§2.19).
    static func date(_ day: GregorianDate, system: CalendarSystemID) -> String {
        ThirteenDate(day, system: system).formatted(FormatOptions(style: .long, includeWeekday: true))
    }

    /// `{gregorianDate}`: "Monday, October 19, 2026".
    static func gregorianDate(_ day: GregorianDate) -> String {
        day.formatted(FormatOptions(style: .long, includeWeekday: true))
    }

    /// `event.timeRange`: "{start} to {end}", each end on its own.
    static func timeRange(start: Int, end: Int, use24Hour: Bool = uses24HourClock) -> String {
        "\(time(start, use24Hour: use24Hour)) to \(time(end, use24Hour: use24Hour))"
    }

    /// `event.readOnly.*` (Apple forms): why an event cannot be changed (§2.10, §2.20).
    static func readOnlyReason(_ reason: ReadOnlyReason) -> String {
        switch reason {
        case .subscribed: "This event is in a subscribed calendar, so it can't be changed here."
        case .birthday: "Birthdays come from your contacts. Change them in Contacts."
        case .invitation: "You're invited to this event. Reply to it or change it in the Calendar app."
        case .calendar: "You can view this calendar but not change it."
        case .noWritePermission: "Thirteen can show your events but not change them."
        case .historical: "Thirteen can't change events before 1583."
        }
    }
}
