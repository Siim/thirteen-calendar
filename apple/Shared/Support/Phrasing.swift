import ThirteenKit

/// Plain-language English sentences for the comparison metrics (SPEC §3), shared by every screen
/// and by VoiceOver labels.
enum Phrasing {
    /// `"1 day"`, `"7 days"`.
    static func days(_ count: Int) -> String {
        count == 1 ? "1 day" : "\(count) days"
    }

    /// The system's year-end intercalary day: `"Year Day"` / `"Festival of All the Dead"`.
    static func yearDayName(_ system: CalendarSystemID) -> String {
        system.intercalaryDayInfo(.yearDay).name
    }

    /// `"73 days until Year Day"`, `"Year Day is tomorrow"`, `"Today is Year Day"`.
    static func countdown(_ days: Int, system: CalendarSystemID) -> String {
        let name = yearDayName(system)
        switch days {
        case 0: return "Today is \(name)"
        case 1: return "\(name) is tomorrow"
        default: return "\(Self.days(days)) until \(name)"
        }
    }

    /// Short direction of a weekday shift: `"in step"`, `"3 days ahead"`, `"2 days behind"`.
    /// Shifts of 4–6 days read more naturally as 3–1 days behind on the 7-day cycle.
    static func shiftAmount(_ shift: Int) -> String {
        switch shift {
        case 0: "in step"
        case 1...3: "\(days(shift)) ahead"
        default: "\(days(7 - shift)) behind"
        }
    }

    /// Sentence for the fixed vs real weekday (SPEC §3 `weekdayShift`).
    static func weekdayShift(_ comparison: Comparison) -> String {
        let real = comparison.gregorianWeekday.name()
        guard let fixed = comparison.thirteenWeekday, let shift = comparison.weekdayShift else {
            let name = comparison.thirteen.intercalaryDate?.info.name ?? "This day"
            return "\(name) sits outside the week, so it has no weekday. The real week carries on: it is a \(real)."
        }
        if shift == 0 {
            return "\(fixed.name()) on both calendars: the fixed 13-month week is in step with the real week."
        }
        // "3 days ahead of the real one", but "2 days behind the real one" (never "behind of").
        let relation = (1...3).contains(shift) ? "\(shiftAmount(shift)) of" : shiftAmount(shift)
        return "Fixed \(fixed.name()), real \(real): the 13-month week runs \(relation) the real one."
    }

    /// Sentence for the label drift (SPEC §3 `labelDrift`); `relativeToToday` uses
    /// "was … ago" / "is in …" instead of "earlier" / "later".
    static func labelDrift(_ comparison: Comparison, relativeToToday: Bool = false) -> String {
        switch comparison.thirteen {
        case let .intercalary(day):
            return "\(day.info.name) belongs to no month, so it has no Gregorian label to compare."
        case let .month(date):
            let label = date.formatted(.init(style: .long, includeYear: false))
            guard let drift = comparison.labelDrift, let labelDate = date.sameLabelInGregorian else {
                if date.system == .positivist {
                    return "\(date.monthInfo.name) has no Gregorian namesake: Positivist months honour people, so their labels never collide."
                }
                return "\(date.monthInfo.name) has no Gregorian namesake, so “\(label)” only exists in the 13-month calendar."
            }
            let weekday = labelDate.weekday.name()
            if drift == 0 {
                return "Same label on both calendars: Gregorian \(label) is this very day."
            }
            let amount = days(abs(drift))
            if drift > 0 {
                let tail = relativeToToday ? "was \(amount) ago, a \(weekday)" : "is \(amount) earlier, a \(weekday)"
                return "The 13-month label runs \(amount) behind: Gregorian \(label) \(tail)."
            }
            let tail = relativeToToday ? "is still \(amount) away, a \(weekday)" : "is \(amount) later, a \(weekday)"
            return "The 13-month label runs \(amount) ahead: Gregorian \(label) \(tail)."
        }
    }

    /// Compact drift value: `"7 days behind"`, `"3 days ahead"`, `"none"`, or `"no match"` when
    /// the day has no Gregorian label to compare (intercalary days, Positivist months).
    static func driftAmount(_ drift: Int?) -> String {
        guard let drift else { return "no match" }
        if drift == 0 { return "none" }
        return drift > 0 ? "\(days(drift)) behind" : "\(days(-drift)) ahead"
    }

    /// VoiceOver label reading both dates, in the form of `calendar.cell.a11y` ("Gregorian", a space,
    /// the date, never a colon; docs/EVENTS.md §2.20, as on Android and Windows):
    /// `"Thursday, October 12, 2026. Gregorian Monday, October 19, 2026"`.
    static func bothDates(thirteen: ThirteenDate, gregorian: GregorianDate) -> String {
        "\(longWithWeekday(thirteen)). Gregorian \(gregorian.formatted(.init(style: .long, includeWeekday: true)))"
    }

    /// VoiceOver label of a Gregorian month-grid cell, Gregorian first, in the same form:
    /// `"Monday, October 19, 2026. IFC Thursday, October 12, 2026"`.
    static func bothDates(gregorian: GregorianDate, thirteen: ThirteenDate) -> String {
        "\(gregorian.formatted(.init(style: .long, includeWeekday: true))). \(thirteen.system.shortName) \(longWithWeekday(thirteen))"
    }

    /// VoiceOver label of a 13-month grid cell (Year, Today, Convert, the Mac menu bar), with
    /// `calendar.gregorianMonthBegins.a11y` where a Gregorian month starts:
    /// `"Wednesday, October 25, 2026. Gregorian Sunday, November 1, 2026. Gregorian November begins."`.
    static func dayCell(_ cell: DayCell) -> String {
        let both = bothDates(thirteen: .month(cell.thirteen), gregorian: cell.gregorian)
        return cell.isGregorianMonthStart ? "\(both). Gregorian \(cell.gregorian.monthInfo.name) begins." : both
    }

    /// VoiceOver label of a Gregorian grid cell (Today, Convert), with the 13-month month's start:
    /// `"Thursday, December 3, 2026. IFC Sunday, December 1, 2026. IFC December begins."`.
    static func gregorianDayCell(_ cell: GregorianDayCell) -> String {
        let both = bothDates(gregorian: cell.gregorian, thirteen: cell.thirteen)
        guard cell.isThirteenMonthStart, let month = cell.thirteen.monthDate else { return both }
        return "\(both). \(month.system.shortName) \(month.monthInfo.name) begins."
    }

    /// VoiceOver label of the Mac menu bar item, whose title is only `"Oct 12"`:
    /// `"Thirteen, IFC date: Thursday, October 12, 2026"`.
    static func statusItemLabel(_ thirteen: ThirteenDate) -> String {
        "Thirteen, \(thirteen.system.shortName) date: \(thirteen.formatted(.init(style: .long, includeWeekday: true)))"
    }

    /// Tooltip of the Mac menu bar item:
    /// `"International Fixed Calendar: Thursday, October 12, 2026. Gregorian Monday, October 19, 2026"`.
    static func statusItemHelp(thirteen: ThirteenDate, gregorian: GregorianDate) -> String {
        "\(thirteen.system.name): \(bothDates(thirteen: thirteen, gregorian: gregorian))"
    }

    /// `"Thursday, October 12, 2026"`, `"Leap Day 2024, no weekday"`.
    private static func longWithWeekday(_ thirteen: ThirteenDate) -> String {
        switch thirteen {
        case .month: thirteen.formatted(.init(style: .long, includeWeekday: true))
        case .intercalary: "\(thirteen.formatted(.long)), no weekday"
        }
    }

    /// `"Day 292 of 365"`.
    static func dayOfYear(_ comparison: Comparison) -> String {
        "Day \(comparison.dayOfYear) of \(comparison.daysIntoYear + 1 + comparison.daysRemainingInYear)"
    }

    /// `"79.7%"`.
    static func percent(_ fraction: Double) -> String {
        let tenths = (fraction * 1000).rounded() / 10
        return tenths == tenths.rounded() ? "\(Int(tenths))%" : "\(tenths)%"
    }

    /// A system's year label: `"2026"`, or `"238"` for Positivist.
    static func displayYear(_ year: Int, system: CalendarSystemID) -> String {
        "\(year + system.yearOffset)"
    }

    /// Caption under a display year when it differs from the Gregorian year: `"Gregorian 2026"`.
    static func gregorianYearNote(_ year: Int, system: CalendarSystemID) -> String? {
        system.yearOffset == 0 ? nil : "Gregorian \(year)"
    }

    /// Engine text made to follow the copy rule (design/DECISIONS.md: no em or en dash in
    /// user-visible strings): a numeric range reads "to" (`"3–13 September"` becomes
    /// `"3 to 13 September"`), any other dash becomes a comma or a hyphen.
    static func withoutDashes(_ text: String) -> String {
        guard text.contains(where: { $0 == "\u{2013}" || $0 == "\u{2014}" }) else { return text }
        return text
            .replacing(/(\d)\s*[\u{2013}\u{2014}]\s*(\d)/) { "\($0.output.1) to \($0.output.2)" }
            .replacing(/\s+[\u{2013}\u{2014}]\s+/, with: ", ")
            .replacing(/[\u{2013}\u{2014}]/, with: "-")
    }
}
