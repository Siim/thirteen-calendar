import ThirteenKit

/// The 13-month side of the converter: reads the converter's Gregorian day as
/// (display year, slot, month day) and turns each edit back into a Gregorian day.
struct ThirteenPickerLogic {
    let system: CalendarSystemID
    let day: GregorianDate

    /// The converter's day in the system.
    var thirteen: ThirteenDate { ThirteenDate(day, system: system) }

    /// The system's year number (`238` for Positivist 2026).
    var displayYear: Int { thirteen.displayYear }

    /// The selectable positions of the year: 13 months plus the intercalary day(s) in place.
    var slots: [ThirteenSlot] { (try? ThirteenSlot.all(inYear: day.year, system: system)) ?? [] }

    /// The id of the slot holding the day (`"month-11"`, `"year-day"`), matching ``ThirteenSlot/id``.
    var slotID: String {
        switch thirteen {
        case let .month(date): "month-\(date.month)"
        case let .intercalary(date): date.id.rawValue
        }
    }

    /// The day of the month (1…28), or `nil` on an intercalary day.
    var monthDay: Int? { thirteen.monthDate?.day }

    /// Moves to the same slot in another display year. A leap-only day that does not exist in
    /// the target year (IFC Leap Day, Festival of Holy Women) falls back to the day before it
    /// (June 28 / Festival of All the Dead).
    func settingDisplayYear(_ displayYear: Int) -> GregorianDate {
        guard let year = try? system.gregorianYear(forDisplayYear: displayYear) else { return day }
        if let same = try? thirteen.sameSlot(inYear: year) { return same.gregorian }
        if let previous = try? thirteen.adding(days: -1), let moved = try? previous.sameSlot(inYear: year) {
            return moved.gregorian
        }
        return (try? GregorianDate(year: year, month: 1, day: 1)) ?? day
    }

    /// Moves to another slot of the same year, keeping the month day (day 1 when coming from an
    /// intercalary day).
    func settingSlot(_ id: String) -> GregorianDate {
        guard let slot = slots.first(where: { $0.id == id }) else { return day }
        switch slot {
        case let .month(month, _):
            let date = try? ThirteenMonthDate(year: day.year, month: month, day: monthDay ?? 1, system: system)
            return date?.gregorian ?? day
        case let .intercalary(_, occurrence):
            return occurrence.gregorian
        }
    }

    /// Moves to another day (1…28) of the current month; no-op on intercalary days.
    func settingMonthDay(_ monthDay: Int) -> GregorianDate {
        guard let date = thirteen.monthDate,
            let moved = try? ThirteenMonthDate(year: date.year, month: date.month, day: monthDay, system: system)
        else { return day }
        return moved.gregorian
    }

    /// Menu label for a slot: the month name, or the intercalary day's name.
    static func label(for slot: ThirteenSlot) -> String {
        switch slot {
        case let .month(_, info): info.name
        case let .intercalary(_, occurrence): occurrence.name
        }
    }
}
