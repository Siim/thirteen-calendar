import Foundation
import ThirteenKit

/// What the repeat picker shows for one editor state (docs/EVENTS.md §2.13): the rows from core's
/// `RepeatPreset.all` (so their labels match every platform), which row is checked, which 13-month
/// rows a `gregorian-only` calendar disables, the "Next:" line and notes of the selected row, the
/// section footers with the platform sentence of §2.13, and the "Keep:" row of a repeat set in
/// another app (`editable: false`, §4.5). The view is `RecurrencePickerView`.
struct RepeatPickerModel {
    /// The draft's start date: the presets are made from it and the "Next:" line counts from it.
    let start: GregorianDate
    let system: CalendarSystemID
    /// The draft's repeat.
    let current: EventRecurrence?
    /// The draft's calendar.
    let calendar: CalendarSnapshot?
    /// The writable calendars (the account kinds the Exchange note names).
    let writableCalendars: [CalendarSnapshot]
    /// The stored repeat's description while a repeat set in another app is kept (the "Keep:" row);
    /// `nil` otherwise.
    let keepDescription: String?

    /// The row id of the "Keep:" row and of Custom (neither is a core preset id).
    static let keepID = "keep"
    static let customID = "custom"

    var presets: [RepeatPreset] { RepeatPreset.all(start: start, system: system) }
    var gregorianPresets: [RepeatPreset] { presets.filter { $0.section == .gregorian } }
    var thirteenPresets: [RepeatPreset] { presets.filter { $0.section == .thirteen } }

    /// The calendar keeps only Exchange-safe 13-month repeats (§3.5).
    var gregorianOnly: Bool { calendar?.info.thirteenRepeats == .gregorianOnly }

    /// A 13-month row whose encoding is not Exchange-safe is disabled on a `gregorian-only` calendar.
    func isEnabled(_ preset: RepeatPreset) -> Bool {
        !(gregorianOnly && preset.section == .thirteen && !preset.exchangeSafe)
    }

    /// The checked row: "keep", a preset id, or "custom" (a Gregorian rule outside the presets).
    var checkedID: String {
        if keepDescription != nil { return Self.keepID }
        return ((try? RepeatPreset.match(current, start: start, system: system)) ?? nil) ?? Self.customID
    }

    /// The repeat a row sets: the preset's rule with the current end (a new rule has no removed or
    /// extra dates). Never: `nil`.
    func choosing(_ preset: RepeatPreset) -> EventRecurrence? {
        guard var recurrence = preset.recurrence else { return nil }
        recurrence.end = current?.end ?? .never
        return recurrence
    }

    /// The repeat's description, or "Repeats on a custom schedule".
    func description(_ recurrence: EventRecurrence?) -> String {
        guard let recurrence else { return EditorCopy.repeatNever }
        return (try? recurrence.description(start: start, system: system)) ?? EditorCopy.customSchedule
    }

    /// The description without its end, for the Repeat row's value and the Custom row.
    var currentLabel: String {
        if let keepDescription { return keepDescription }
        guard var recurrence = current else { return EditorCopy.repeatNever }
        recurrence.end = .never
        return description(recurrence)
    }

    /// The selected row's "Next:" line (`describeNextOccurrences`), `""` when none.
    var nextLine: String {
        guard let current else { return "" }
        return (try? current.nextOccurrencesText(start: start, system: system)) ?? ""
    }

    /// The selected row's notes (`describeRepeatNotes`; the Outlook forms on a `gregorian-only` calendar).
    var notes: [String] {
        guard let current else { return [] }
        return (try? current.repeatNotes(start: start, system: system, gregorianOnlyCalendar: gregorianOnly)) ?? []
    }

    /// The 13-month section's header: the selected system's name.
    var thirteenTitle: String { system.name }

    /// The calendar written "{name} ({account kind})".
    var calendarWithKind: String {
        guard let calendar else { return "" }
        // Write-only access: "Default calendar", whose account kind is unknown.
        if calendar.info.accountID == CalendarSourcePolicy.writeOnlyAccountID { return calendar.info.title }
        return EditorCopy.calendarWithKind(calendar.info.title, kind: EditorCopy.accountKind(calendar.info.accountKind))
    }

    /// The account kinds among the writable calendars that can keep 13-month repeats, in the order
    /// iCloud, Google, CalDAV, On My iPhone / iPad / Mac.
    var kindsKeepingThirteen: [String] {
        let order: [CalendarAccountKind] = [.icloud, .google, .caldav, .device]
        let kinds = Set(writableCalendars.filter { $0.info.thirteenRepeats == .all }.map(\.info.accountKind))
        return order.filter(kinds.contains).map(EditorCopy.accountKind)
    }

    /// The 13-month section's footer: on a `gregorian-only` calendar the Exchange note; otherwise the
    /// 28-day sentence and the platform sentences of the calendar's account kind (gates, §2.13).
    var thirteenFooter: String {
        if gregorianOnly { return EditorCopy.exchangeNote(calendar: calendarWithKind, kinds: kindsKeepingThirteen) }
        let sentences = (calendar?.settings.repeatFooter ?? []).map(EditorCopy.repeatFooterSentence)
        return ([EditorCopy.repeatThirteenFooter] + sentences).joined(separator: " ")
    }

    /// The current repeat cannot be kept by the calendar (`thirteen-repeat-not-allowed`): the Repeat
    /// row shows the note with an error icon.
    var currentNotAllowed: Bool {
        guard gregorianOnly, case let .thirteen(rule)? = current?.rule else { return false }
        return !((try? rule.encoding(start: start).exchangeSafe) ?? true)
    }

    /// The start's 13-month yearly or intercalary repeat when it is Exchange-safe (the conflict
    /// dialog's "Use “…”" button, §2.11), with the current end.
    var exchangeSafeYearly: EventRecurrence? {
        let candidate = thirteenPresets.first { ($0.id == "thirteen-yearly" || $0.id == "thirteen-intercalary") && $0.exchangeSafe }
        return candidate.flatMap(choosing)
    }
}

// MARK: - Custom repeat (§2.13)

/// The Custom repeat editor's state (Gregorian only, like Apple Calendar): frequency, interval,
/// weekdays, month days or "On the", months. It reads the simple rules it can show back and writes
/// one `RRULE`.
struct CustomRecurrence: Hashable, Sendable {
    enum Frequency: String, CaseIterable, Hashable, Sendable { case daily, weekly, monthly, yearly }

    /// The second column of "On the": a weekday, or any day, weekday or weekend day.
    enum DayKind: Hashable, Sendable {
        case weekday(Weekday)
        case day
        case weekday5
        case weekendDay

        static var all: [DayKind] { Weekday.allCases.map { .weekday($0) } + [.day, .weekday5, .weekendDay] }

        /// The `BYDAY` set of the kind.
        var days: [Weekday] {
            switch self {
            case let .weekday(day): [day]
            case .day: Weekday.allCases
            case .weekday5: [.monday, .tuesday, .wednesday, .thursday, .friday]
            case .weekendDay: [.sunday, .saturday]
            }
        }
    }

    var frequency: Frequency = .weekly
    /// 1 to 99.
    var interval = 1
    var weekdays: Set<Weekday> = []
    /// Monthly: "Each" (days) or "On the".
    var monthlyOnThe = false
    var monthDays: Set<Int> = []
    /// `1…5` or `-1` (last).
    var ordinal = 1
    var dayKind: DayKind = .day
    var months: Set<Int> = []
    /// Yearly: the optional "On the".
    var yearlyOnThe = false

    static let intervals = 1...99

    /// The defaults for a start: its weekday, month day and month.
    init(start: GregorianDate) {
        weekdays = [start.weekday]
        monthDays = [start.day]
        months = [start.month]
        ordinal = min((start.day - 1) / 7 + 1, 5)
        if ordinal == 5 { ordinal = -1 }
        dayKind = .weekday(start.weekday)
    }

    /// The editor's state for a Gregorian rule it can show; `nil` for anything else.
    init?(rrule: RRule, start: GregorianDate) {
        self.init(start: start)
        guard rrule.byYearDay.isEmpty, rrule.byWeekNo.isEmpty, rrule.byHour.isEmpty, rrule.byMinute.isEmpty, rrule.bySecond.isEmpty,
            rrule.rscale == nil || rrule.rscale == "GREGORIAN", Self.intervals.contains(rrule.interval)
        else { return nil }
        interval = rrule.interval
        switch rrule.freq {
        case .daily:
            guard rrule.byDay.isEmpty, rrule.byMonthDay.isEmpty, rrule.byMonth.isEmpty, rrule.bySetPos.isEmpty else { return nil }
            frequency = .daily
        case .weekly:
            guard rrule.byMonthDay.isEmpty, rrule.byMonth.isEmpty, rrule.bySetPos.isEmpty, rrule.byDay.allSatisfy({ $0.ordinal == nil })
            else { return nil }
            frequency = .weekly
            if !rrule.byDay.isEmpty { weekdays = Set(rrule.byDay.map(\.weekday)) }
        case .monthly:
            guard rrule.byMonth.isEmpty else { return nil }
            frequency = .monthly
            if rrule.byDay.isEmpty && rrule.bySetPos.isEmpty {
                guard rrule.byMonthDay.allSatisfy({ (1...31).contains($0) }) else { return nil }
                if !rrule.byMonthDay.isEmpty { monthDays = Set(rrule.byMonthDay) }
            } else {
                guard rrule.byMonthDay.isEmpty, readOnThe(rrule) else { return nil }
                monthlyOnThe = true
            }
        case .yearly:
            frequency = .yearly
            if !rrule.byMonth.isEmpty { months = Set(rrule.byMonth) }
            if !rrule.byDay.isEmpty || !rrule.bySetPos.isEmpty {
                guard rrule.byMonthDay.isEmpty, readOnThe(rrule) else { return nil }
                yearlyOnThe = true
            } else if !(rrule.byMonthDay.isEmpty || (rrule.byMonthDay == [start.day])) {
                return nil
            }
        default:
            return nil
        }
    }

    /// Reads "On the" from `BYDAY` (one weekday with an ordinal) or `BYSETPOS` with a day set.
    private mutating func readOnThe(_ rrule: RRule) -> Bool {
        let valid: Set<Int> = [1, 2, 3, 4, 5, -1]
        if rrule.bySetPos.isEmpty {
            guard rrule.byDay.count == 1, let n = rrule.byDay[0].ordinal, valid.contains(n) else { return false }
            ordinal = n
            dayKind = .weekday(rrule.byDay[0].weekday)
            return true
        }
        guard rrule.bySetPos.count == 1, valid.contains(rrule.bySetPos[0]), rrule.byDay.allSatisfy({ $0.ordinal == nil }) else {
            return false
        }
        let days = Set(rrule.byDay.map(\.weekday))
        guard let kind = DayKind.all.first(where: { Set($0.days) == days }) else { return false }
        ordinal = rrule.bySetPos[0]
        dayKind = kind
        return true
    }

    /// The "On the" parts.
    private var onTheParts: (byDay: [WeekdayNum], bySetPos: [Int]) {
        if case let .weekday(day) = dayKind { return ([WeekdayNum(weekday: day, ordinal: ordinal)], []) }
        return (dayKind.days.sorted().map { WeekdayNum(weekday: $0) }, [ordinal])
    }

    /// The rule (without an end).
    var rrule: RRule {
        let interval = min(max(interval, 1), 99)
        switch frequency {
        case .daily:
            return RRule(freq: .daily, interval: interval)
        case .weekly:
            return RRule(freq: .weekly, interval: interval, byDay: weekdays.sorted().map { WeekdayNum(weekday: $0) })
        case .monthly:
            if monthlyOnThe {
                let parts = onTheParts
                return RRule(freq: .monthly, interval: interval, byDay: parts.byDay, bySetPos: parts.bySetPos)
            }
            return RRule(freq: .monthly, interval: interval, byMonthDay: monthDays.sorted())
        case .yearly:
            let byMonth = months.sorted()
            if yearlyOnThe {
                let parts = onTheParts
                return RRule(freq: .yearly, interval: interval, byDay: parts.byDay, byMonth: byMonth, bySetPos: parts.bySetPos)
            }
            return RRule(freq: .yearly, interval: interval, byMonth: byMonth)
        }
    }

    /// The repeat with `end`.
    func recurrence(end: RepeatEnd) -> EventRecurrence { EventRecurrence(rule: .rrule(rrule), end: end) }

    /// Toggles a weekday, never leaving none.
    mutating func toggle(_ weekday: Weekday) {
        if weekdays.contains(weekday) {
            if weekdays.count > 1 { weekdays.remove(weekday) }
        } else {
            weekdays.insert(weekday)
        }
    }

    /// Toggles a month day, never leaving none.
    mutating func toggle(monthDay: Int) {
        if monthDays.contains(monthDay) {
            if monthDays.count > 1 { monthDays.remove(monthDay) }
        } else {
            monthDays.insert(monthDay)
        }
    }

    /// Toggles a month, never leaving none.
    mutating func toggle(month: Int) {
        if months.contains(month) {
            if months.count > 1 { months.remove(month) }
        } else {
            months.insert(month)
        }
    }
}
