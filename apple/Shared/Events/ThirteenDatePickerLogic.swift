import Foundation
import ThirteenKit

/// The 13-month date picker of the editor (docs/EVENTS.md §2.12): the year stepper, the slot strip
/// (months and intercalary days in picker order), the 4 x 7 grid or an intercalary day's badge, the
/// keyboard moves, the editor's range (1583 to 9999, §3.1.1) and its two captions: a leap-only day
/// that falls back to the day before it, and the Starts field of a draft that repeats on that day,
/// whose year stepper moves between leap years only (`picker.leapRepeat`). Built on the converter's
/// `ThirteenPickerLogic`. The view is `ThirteenDatePicker`.
struct ThirteenDatePickerModel {
    let system: CalendarSystemID
    /// The selected day.
    var selected: GregorianDate
    /// The days that can be chosen.
    let range: ClosedRange<GregorianDate>
    /// The Starts field while the draft repeats on this leap-only day: the stepper skips to leap years.
    var leapRepeat = false
    /// Days the event's zone skips as a whole (§2.12, SPEC §1.5: Pacific/Apia 2011-12-30): shown
    /// disabled and never selected. See ``skippedDays(zone:)``.
    var skips: (GregorianDate) -> Bool = { _ in false }

    /// Whether a day can be chosen: inside the range and not skipped by the zone.
    func allows(_ date: GregorianDate) -> Bool { range.contains(date) && !skips(date) }

    /// The days `zone` skips as a whole: the day's midnight and the next day's midnight name the
    /// same instant (the web's `skippedDays`). Starts and Ends of a timed event with a zone use it;
    /// an all-day or floating event, End Repeat and an unknown zone skip nothing.
    static func skippedDays(zone: String?) -> (GregorianDate) -> Bool {
        guard let zone, TimeZone(identifier: zone) != nil else { return { _ in false } }
        return { day in
            guard let next = try? day.adding(days: 1), let start = try? LocalDateTime(date: day, minute: 0),
                let end = try? LocalDateTime(date: next, minute: 0), let a = EventInstants.instant(start, zone: zone),
                let b = EventInstants.instant(end, zone: zone)
            else { return false }
            return a == b
        }
    }

    /// The editor's range (§3.1.1): 1583-01-01 to 9999-12-31.
    static let editorRange: ClosedRange<GregorianDate> = {
        let lower = try! GregorianDate(year: 1583, month: 1, day: 1)
        let upper = try! GregorianDate(year: 9999, month: 12, day: 31)
        return lower...upper
    }()

    var logic: ThirteenPickerLogic { ThirteenPickerLogic(system: system, day: selected) }
    var thirteen: ThirteenDate { ThirteenDate(selected, system: system) }
    var displayYear: Int { thirteen.displayYear }

    /// The year stepper's value ("2026"; Positivist "238").
    var yearText: String { "\(displayYear)" }
    /// The stepper's accessibility value (`picker.year.positivist`: "238, Gregorian 2026").
    var yearAccessibilityValue: String {
        system == .ifc ? "\(displayYear)" : EditorCopy.positivistYear(displayYear: displayYear, year: selected.year)
    }

    // MARK: Slots

    struct Slot: Identifiable, Hashable {
        let id: String
        /// The strip's text: "Oct", "Sol", "LD", "YD".
        let label: String
        /// "October, month 11 of 13", "Leap Day, leap years only", "Year Day, belongs to no month".
        let accessibilityName: String
        let isIntercalary: Bool
        let enabled: Bool
    }

    var slots: [Slot] {
        logic.slots.map { slot in
            switch slot {
            case let .month(month, info):
                let first = (try? ThirteenMonthDate(year: selected.year, month: month, day: 1, system: system))?.gregorian
                let last = (try? ThirteenMonthDate(year: selected.year, month: month, day: 28, system: system))?.gregorian
                let enabled = first.map { $0 <= range.upperBound } ?? false && (last.map { $0 >= range.lowerBound } ?? false)
                return Slot(
                    id: slot.id, label: info.shortName, accessibilityName: EditorCopy.slotMonth(info.name, index: month),
                    isIntercalary: false, enabled: enabled)
            case let .intercalary(id, occurrence):
                let name: String
                if system == .ifc {
                    name = id == .leapDay ? EditorCopy.slotLeapDay : EditorCopy.slotYearDay
                } else {
                    name = EditorCopy.slotFestival(occurrence.name, leapOnly: occurrence.leapOnly)
                }
                return Slot(
                    id: slot.id, label: occurrence.code, accessibilityName: name, isIntercalary: true,
                    enabled: allows(occurrence.gregorian))
            }
        }
    }

    var selectedSlotID: String { logic.slotID }

    /// Selecting a slot keeps the month day; an intercalary slot selects that day.
    func selectingSlot(_ id: String) -> GregorianDate { clamped(logic.settingSlot(id)) }

    /// The slot's position (for the strip's adjustable action): one slot up or down.
    func selectingAdjacentSlot(_ delta: Int) -> GregorianDate {
        let ids = slots.filter(\.enabled).map(\.id)
        guard let index = ids.firstIndex(of: selectedSlotID) else { return selected }
        let next = min(max(index + delta, 0), ids.count - 1)
        return selectingSlot(ids[next])
    }

    // MARK: Grid

    struct Cell: Identifiable, Hashable {
        let date: GregorianDate
        /// 1 to 28.
        let day: Int
        /// The Gregorian day under it: "19", or "Nov 1" where a Gregorian month begins.
        let gregorianText: String
        let accessibilityName: String
        let enabled: Bool
        var id: Int { date.julianDayNumber }
    }

    /// The 13-month month on screen, or `nil` on an intercalary day.
    var month: ThirteenMonthDate? { thirteen.monthDate }

    /// The 28 days of the month on screen, in grid order.
    var cells: [Cell] {
        guard let month else { return [] }
        return (1...ThirteenDate.daysPerMonth).compactMap { day in
            guard let date = try? ThirteenMonthDate(year: month.year, month: month.month, day: day, system: system) else { return nil }
            let gregorian = date.gregorian
            let text = gregorian.day == 1 ? gregorian.formatted(.short) : "\(gregorian.day)"
            let short = date.formatted(FormatOptions(style: .long, includeYear: false, includeWeekday: true))
            let gregorianShort = gregorian.formatted(FormatOptions(style: .long, includeYear: false, includeWeekday: true))
            return Cell(
                date: gregorian, day: day, gregorianText: text,
                accessibilityName: EditorCopy.pickerCell(short: short, gregorianShort: gregorianShort),
                enabled: allows(gregorian))
        }
    }

    /// The two-line weekday header of §2.4: the 13-month weekday letter and the Gregorian weekday
    /// letter of the column in this month.
    var weekdayHeader: [(thirteen: String, gregorian: String, accessibilityName: String)] {
        guard let month else { return [] }
        return (1...7).compactMap { day in
            guard let date = try? ThirteenMonthDate(year: month.year, month: month.month, day: day, system: system) else { return nil }
            let weekday = date.weekday
            let gregorianWeekday = date.gregorian.weekday
            return (
                String(weekday.name(.short).prefix(1)), String(gregorianWeekday.name(.short).prefix(1)),
                "\(weekday.name(.long)). Gregorian \(gregorianWeekday.name(.long))"
            )
        }
    }

    /// The intercalary day on screen (its badge replaces the grid).
    var intercalary: IntercalaryOccurrence? {
        guard case let .intercalary(date) = thirteen else { return nil }
        return (try? IntercalaryOccurrence.all(inYear: selected.year, system: system))?.first { $0.id == date.id }
    }

    /// The days of the month for the accessibility-size list (§2.12): `Thursday, October 12` over
    /// `Gregorian Mon, Oct 19`; an intercalary slot's one day. Each row is read as the grid's cell
    /// (`picker.cell`, long forms: "Thursday, October 12. Gregorian Monday, October 19").
    var listRows: [(date: GregorianDate, title: String, gregorian: String, accessibilityName: String)] {
        if let intercalary {
            let gregorianLong = intercalary.gregorian.formatted(FormatOptions(style: .long, includeYear: false, includeWeekday: true))
            return [(
                intercalary.gregorian, intercalary.name,
                "Gregorian \(intercalary.gregorian.formatted(FormatOptions(style: .medium, includeWeekday: true)))",
                EditorCopy.pickerCell(short: intercalary.name, gregorianShort: gregorianLong)
            )]
        }
        return cells.filter(\.enabled).map { cell in
            let date = ThirteenDate(cell.date, system: system)
            return (
                cell.date, date.formatted(FormatOptions(style: .long, includeYear: false, includeWeekday: true)),
                "Gregorian \(cell.date.formatted(FormatOptions(style: .medium, includeYear: false, includeWeekday: true)))",
                cell.accessibilityName
            )
        }
    }

    // MARK: Year stepper

    /// The result of a step: the new day and the caption to show and announce, if any.
    struct Step: Equatable {
        let date: GregorianDate
        let caption: String?
    }

    /// The selected day is a leap-only intercalary day (IFC Leap Day, Positivist Festival of Holy Women).
    var isLeapOnlyDay: Bool {
        guard case let .intercalary(date) = thirteen else { return false }
        return date.info.leapOnly
    }

    /// Steps the year by `delta`. A leap-only day moves to the day before it in a year without it
    /// (`picker.fellBack`), except while `leapRepeat`: then the year moves to the previous or next
    /// leap year (`picker.leapRepeat`). `nil` past the range.
    func steppingYear(by delta: Int) -> Step? {
        guard delta != 0 else { return Step(date: selected, caption: nil) }
        if leapRepeat && isLeapOnlyDay {
            var year = selected.year + delta
            while GregorianDate.supportedYears.contains(year) && !((try? GregorianDate.isLeapYear(year)) ?? false) {
                year += delta > 0 ? 1 : -1
            }
            guard GregorianDate.supportedYears.contains(year),
                let date = try? ThirteenDate(year: year, intercalary: .leapDay, system: system).gregorian,
                range.contains(date)
            else { return nil }
            let name = system.intercalaryDayInfo(.leapDay).name
            let caption = abs(year - selected.year) == abs(delta) ? nil : EditorCopy.leapRepeat(dayName: name, year: year + system.yearOffset)
            return Step(date: date, caption: caption)
        }
        let target = logic.settingDisplayYear(displayYear + delta)
        guard target.year == selected.year + delta, range.contains(target) || clampedYearOK(target) else { return nil }
        let date = clamped(target)
        var caption: String?
        if isLeapOnlyDay, !ThirteenDate(date, system: system).isIntercalary || ThirteenDate(date, system: system).intercalaryDate?.id != .leapDay {
            let info = system.intercalaryDayInfo(.leapDay)
            let before = ThirteenDate(date, system: system)
            let dayAndMonth =
                before.monthDate.map { "\($0.monthInfo.name) \($0.day)" } ?? "the \(before.intercalaryDate?.info.name ?? "")"
            caption = EditorCopy.fellBack(year: date.year + system.yearOffset, dayName: info.name, dayAndMonth: dayAndMonth)
        }
        return Step(date: date, caption: caption)
    }

    private func clampedYearOK(_ date: GregorianDate) -> Bool {
        date.year >= range.lowerBound.year && date.year <= range.upperBound.year
    }

    func canStepYear(by delta: Int) -> Bool { steppingYear(by: delta) != nil }

    // MARK: Keyboard (§2.12)

    enum Move: Hashable, Sendable {
        case left, right, up, down, pageUp, pageDown, yearUp, yearDown, home, end
    }

    /// The day a key moves to (inside the range), or `nil` when it cannot move.
    func moving(_ move: Move) -> GregorianDate? {
        let result: GregorianDate?
        switch move {
        case .left: result = try? selected.adding(days: -1)
        case .right: result = try? selected.adding(days: 1)
        case .up, .down:
            let delta = move == .up ? -1 : 1
            if let month {
                result = Self.monthDay(month, plusWeeks: delta, system: system)
            } else {
                result = try? selected.adding(days: delta)
            }
        case .pageUp, .pageDown:
            let delta = move == .pageUp ? -1 : 1
            if let month {
                result = (try? month.adding(months: delta))?.gregorian
            } else if let intercalary {
                // From an intercalary day: the first day of the month after it, or the last of the one before.
                let anchor = (try? intercalary.gregorian.adding(days: delta)) ?? selected
                result = anchor
            } else {
                result = nil
            }
        case .yearUp: result = steppingYear(by: -1)?.date
        case .yearDown: result = steppingYear(by: 1)?.date
        case .home, .end:
            guard let month else { return nil }
            result = (try? ThirteenMonthDate(year: month.year, month: month.month, day: move == .home ? 1 : 28, system: system))?.gregorian
        }
        guard var result, range.contains(result) else { return nil }
        // A day the zone skips is passed over in the direction of the move.
        if skips(result) {
            let back: Bool = [.left, .up, .pageUp, .yearUp, .end].contains(move)
            guard let beyond = try? result.adding(days: back ? -1 : 1), allows(beyond) else { return nil }
            result = beyond
        }
        return result
    }

    /// The same weekday one row up or down, continuing into the previous or next month and skipping
    /// intercalary days (they are reached with Left and Right).
    static func monthDay(_ date: ThirteenMonthDate, plusWeeks weeks: Int, system: CalendarSystemID) -> GregorianDate? {
        var year = date.year
        var index = (date.month - 1) * 28 + (date.day - 1) + weeks * 7
        while index < 0 {
            year -= 1
            index += 364
        }
        while index >= 364 {
            year += 1
            index -= 364
        }
        return (try? ThirteenMonthDate(year: year, month: index / 28 + 1, day: index % 28 + 1, system: system))?.gregorian
    }

    // MARK: Typing (desktop)

    /// A typed date: the 13-month numeric form (`2026-M10-12`, `2026-YD`) or ISO (`2026-10-19`);
    /// `nil` when it cannot be read or is outside the range (`editor.error.outOfRange`).
    func parse(_ text: String) -> GregorianDate? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        let date = (try? ThirteenDate(numeric: trimmed, system: system))?.gregorian ?? (try? GregorianDate(isoString: trimmed))
        guard let date, allows(date) else { return nil }
        return date
    }

    private func clamped(_ date: GregorianDate) -> GregorianDate {
        min(max(date, range.lowerBound), range.upperBound)
    }
}
