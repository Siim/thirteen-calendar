// The repeat picker's texts and rows (docs/EVENTS.md §2.11, §2.13, §5.2 grammars), mirroring the
// text, preset and adaptation parts of `packages/core/src/events/recurrence.ts`: descriptions
// (`description(start:system:)`), the "Next:" line (`nextOccurrencesText(start:system:count:)`), the
// notes (`repeatNotes(start:system:gregorianOnlyCalendar:)`), presets (`RepeatPreset.all`,
// `RepeatPreset.match`) and the re-derivation of a repeat for a new start (`adapted(from:to:)`).
// Every string is the §2.19 copy, English and exact.

/// What happened to the repeat when the start moved (the §2.11 table). TS: `RepeatChange`.
public enum RepeatChange: String, Sendable, Hashable, Codable {
    case none, adapted, converted, dropped
}

/// A row of the repeat picker (§2.13). TS: `RepeatPreset`.
public struct RepeatPreset: Sendable, Hashable {
    /// The section a preset belongs to.
    public enum Section: String, Sendable, Hashable, Codable {
        case never, gregorian, thirteen
    }

    /// `never`, `daily`, `weekly`, `biweekly`, `monthly`, `yearly`, `thirteen-monthly`,
    /// `thirteen-weekly`, `thirteen-biweekly`, `thirteen-yearly` or `thirteen-intercalary`.
    public let id: String
    public let section: Section
    public let label: String
    /// End never; `nil` for Never.
    public let recurrence: EventRecurrence?
    public let exchangeSafe: Bool
}

// MARK: - Descriptions (§5.2 grammar)

private enum Words {
    static let custom = "Repeats on a custom schedule"
    static let ordinals: [Int: String] = [1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", -1: "last"]
    static let weekdaysMask = 0b0111110
    static let weekendMask = 0b1000001
    static let allDaysMask = 0b1111111

    static func weekday(_ weekday: Weekday) -> String { weekday.name(.long) }
    static func weekday(raw: Int) -> String { Weekday(rawValue: raw)!.name(.long) }
    static func month(_ month: Int) -> String { Calc.monthNames[month - 1] }

    /// `a`, `a and b`, `a, b and c`.
    static func joinAnd(_ items: [String]) -> String {
        if items.count <= 1 { return items.joined() }
        return "\(items.dropLast().joined(separator: ", ")) and \(items.last!)"
    }

    /// `Every {unit}` or `Every {n} {units}`.
    static func every(_ interval: Int, _ unit: String) -> String {
        interval == 1 ? "Every \(unit)" : "Every \(interval) \(unit)s"
    }

    /// The values in first-seen order without repeats.
    static func unique(_ values: [Int]) -> [Int] {
        var seen = Set<Int>()
        return values.filter { seen.insert($0).inserted }
    }

    /// `the 1st, 15th and last day` for month days (positive ascending, then -1); nil for other negatives.
    static func monthDays(_ days: [Int]) -> String? {
        let distinct = unique(days)
        if distinct.contains(where: { $0 < -1 }) { return nil }
        var items = distinct.filter { $0 > 0 }.sorted().map(ThirteenFormat.ordinal)
        if distinct.contains(-1) { items.append("last day") }
        return "the \(joinAnd(items))"
    }

    /// The weekday set of `BYDAY` entries without ordinals as a bit mask; nil when one has an ordinal.
    static func plainMask(_ days: [WeekdayNum]) -> Int? {
        var mask = 0
        for d in days {
            if d.ordinal != nil { return nil }
            mask |= 1 << d.weekday.rawValue
        }
        return mask
    }

    /// The weekday of a one-bit mask, or nil.
    static func single(_ mask: Int) -> Int? {
        mask > 0 && mask & (mask - 1) == 0 ? mask.trailingZeroBitCount : nil
    }

    /// The "On the" phrase of a monthly or yearly rule (`second Tuesday`, `last weekday`, `first
    /// weekend day`); nil for anything else.
    static func onThe(_ rule: RRule) -> String? {
        if !rule.byMonthDay.isEmpty { return nil }
        if rule.bySetPos.isEmpty {
            guard rule.byDay.count == 1, let n = rule.byDay[0].ordinal, let word = ordinals[n] else { return nil }
            return "\(word) \(weekday(rule.byDay[0].weekday))"
        }
        guard rule.bySetPos.count == 1, let word = ordinals[rule.bySetPos[0]], let mask = plainMask(rule.byDay) else {
            return nil
        }
        let kind: String?
        switch mask {
        case allDaysMask: kind = "day"
        case weekdaysMask: kind = "weekday"
        case weekendMask: kind = "weekend day"
        default: kind = single(mask).map(weekday(raw:))
        }
        return kind.map { "\(word) \($0)" }
    }

    /// The text of a Gregorian rule (without end), or nil outside the §5.2 grammar.
    static func describe(_ rule: RRule, start: GregorianDate) -> String? {
        if RRuleSupport(rule, startMinute: nil) != .supported || !rule.byWeekNo.isEmpty || !rule.byYearDay.isEmpty {
            return nil
        }
        let interval = rule.interval
        switch rule.freq {
        case .daily:
            if !rule.byMonth.isEmpty || !rule.byMonthDay.isEmpty || !rule.byDay.isEmpty || !rule.bySetPos.isEmpty { return nil }
            return every(interval, "day")
        case .weekly:
            if !rule.byMonth.isEmpty || !rule.bySetPos.isEmpty { return nil }
            guard let mask = rule.byDay.isEmpty ? 1 << start.weekday.rawValue : plainMask(rule.byDay) else { return nil }
            if mask == weekdaysMask { return interval == 1 ? "Every weekday" : "Every \(interval) weeks on weekdays" }
            if mask == weekendMask { return interval == 1 ? "Every weekend" : "Every \(interval) weeks on weekends" }
            let names = (0...6).filter { mask & (1 << $0) != 0 }.map(weekday(raw:))
            return "\(every(interval, "week")) on \(joinAnd(names))"
        case .monthly:
            if !rule.byMonth.isEmpty { return nil }
            if rule.byDay.isEmpty && rule.bySetPos.isEmpty {
                guard let days = monthDays(rule.byMonthDay.isEmpty ? [start.day] : rule.byMonthDay) else { return nil }
                return "\(every(interval, "month")) on \(days)"
            }
            return onThe(rule).map { "\(every(interval, "month")) on the \($0)" }
        case .yearly:
            let prefix = every(interval, "year")
            if rule.byMonth.isEmpty {
                if !rule.byMonthDay.isEmpty || !rule.byDay.isEmpty || !rule.bySetPos.isEmpty { return nil }
                return "\(prefix) on \(month(start.month)) \(start.day)"
            }
            let months = Array(Set(rule.byMonth)).sorted().map(month)
            if rule.byDay.isEmpty && rule.bySetPos.isEmpty {
                let days = rule.byMonthDay.isEmpty ? [start.day] : unique(rule.byMonthDay)
                if months.count == 1 && days.count == 1 && days[0] > 0 { return "\(prefix) on \(months[0]) \(days[0])" }
                return monthDays(days).map { "\(prefix) in \(joinAnd(months)) on \($0)" }
            }
            return onThe(rule).map { "\(prefix) on the \($0) of \(joinAnd(months))" }
        default:
            return nil
        }
    }

    /// The text of a 13-month rule (§5.2).
    static func describe(_ rule: ThirteenRule) -> String {
        let short = rule.system.shortName
        switch rule {
        case let .monthly(_, day): return "Every \(short) month on the \(ThirteenFormat.ordinal(day))"
        case let .weekly(_, weekday, interval):
            return interval == 1 ? "Every \(short) week on \(Words.weekday(weekday))" : "Every 2 \(short) weeks on \(Words.weekday(weekday))"
        case let .yearly(system, month, day): return "Every year on \(short) \(system.months[month - 1].name) \(day)"
        case let .intercalary(system, id): return "Every \(system.intercalaryDayInfo(id).name)"
        }
    }
}

extension EventRecurrence {
    /// ``description(start:system:)`` for a valid recurrence.
    func describe(start: GregorianDate) -> String {
        var text: String
        switch rule {
        case let .thirteen(rule): text = Words.describe(rule)
        case let .rrule(rrule):
            guard let described = Words.describe(rrule, start: start) else { return Words.custom }
            text = described
        default: return Words.custom
        }
        switch end {
        case let .count(count): text += count == 1 ? ", once" : ", \(count) times"
        case let .until(date):
            if case let .thirteen(rule) = rule {
                text += ", until \(date.thirteen(in: rule.system).formatted(.long))"
            } else {
                text += ", until \(date.formatted(.long))"
            }
        case .never: break
        }
        let extra = extraDates.count
        if extra > 0 { text += extra == 1 ? ", and 1 more date" : ", and \(extra) more dates" }
        return text
    }

    /// The repeat's description (§5.2 grammar, English, exact): `Every week on Monday`, `Every IFC
    /// month on the 12th`, `Every year on Positivist Archimedes 12`, `Every Leap Day`, followed by
    /// its end (`, 10 times`, `, once`, `, until December 12, 2036`: 13-month long dates for 13-month
    /// rules, Gregorian long dates for Gregorian rules) and its extra dates (`, and 2 more dates`).
    /// `dates` and `foreign` rules and Gregorian rules outside the grammar are
    /// `Repeats on a custom schedule`. A 13-month rule names its own system whichever `system` is
    /// selected. TS: `describeRecurrence`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid recurrence.
    public func description(start: GregorianDate, system: CalendarSystemID = .ifc) throws(ThirteenError) -> String {
        try validate()
        return describe(start: start)
    }

    /// The repeat picker's "Next:" line (§2.13, §5.2): `Next: ` and the next `count` (default 3)
    /// occurrence dates after the start as Gregorian `{Wkd}, {Mon} {d}` (`, {yyyy}` added when the
    /// year is not the start's), joined with `; `; for 13-month rules the first date is preceded by
    /// `Gregorian `. Fewer dates when the repeat ends sooner; `""` when there are none.
    /// TS: `describeNextOccurrences`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid recurrence or a `count` outside `1…100`.
    public func nextOccurrencesText(start: GregorianDate, system: CalendarSystemID = .ifc, count: Int = 3)
        throws(ThirteenError) -> String
    {
        try validate()
        guard (1...100).contains(count) else {
            throw .invalidRule("describeNextOccurrences option 'count' must be an integer 1..100, got \(count)")
        }
        let dates = nextDates(start: start, count: count)
        if dates.isEmpty { return "" }
        var parts = dates.map { date in
            let text = "\(date.weekday.name(.short)), \(Calc.monthShortNames[date.month - 1]) \(date.day)"
            return date.year == start.year ? text : "\(text), \(date.year)"
        }
        if case .thirteen = rule { parts[0] = "Gregorian \(parts[0])" }
        return "Next: \(parts.joined(separator: "; "))"
    }

    /// The notes under the selected repeat (§2.13, §5.2 grammar, in this order, each only when it
    /// applies; `{Y}` is the start's year + 1): month days 29 to 31, February 29, the leap-only cap,
    /// the 13-month weekly drift and the Gregorian weekly weekday in the 13-month system. With
    /// `gregorianOnlyCalendar` the first two are the Outlook notes. The year sentences are left out
    /// when `{Y}` is after 9999. TS: `describeRepeatNotes`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid recurrence.
    public func repeatNotes(start: GregorianDate, system: CalendarSystemID = .ifc, gregorianOnlyCalendar: Bool = false)
        throws(ThirteenError) -> [String]
    {
        try validate()
        var notes: [String] = []
        let next = start.year + 1
        switch rule {
        case let .rrule(rrule):
            if let day = RepeatNotes.longMonthDay(rrule, start) {
                notes.append(
                    gregorianOnlyCalendar
                        ? "Outlook and Exchange move this to the last day of shorter months."
                        : "Months without a \(ThirteenFormat.ordinal(day)) are skipped.")
            }
            if RepeatNotes.onLeapDay(rrule, start) {
                notes.append(
                    gregorianOnlyCalendar ? "Outlook and Exchange move this to February 28 in other years." : "Happens only in leap years.")
            }
            if let weekday = RepeatNotes.weeklyWeekday(rrule, start), next <= GregorianDate.maxYear {
                let short = system.shortName
                let (before, after) = RepeatNotes.thirteenWeekdays(of: weekday, year: next, system: system)
                let plural = RepeatNotes.plural
                notes.append(
                    system == .ifc && Calc.isLeap(next)
                        ? "In \(next) \(plural(weekday)) are \(short) \(plural(before)) until Leap Day and \(short) \(plural(after)) after it."
                        : "In \(next) \(plural(weekday)) are \(short) \(plural(before)).")
            }
        case let .thirteen(rule):
            if let cap = RepeatNotes.leapCapNote(rule, start) { notes.append(cap) }
            if case .weekly = rule {
                let ifc = rule.system == .ifc
                var text =
                    ifc
                    ? "Year Day and Leap Day belong to no week, so the repeat waits one extra day after each, and its Gregorian weekday moves."
                    : "The Festival of All the Dead and the Festival of Holy Women belong to no week, so the repeat waits one extra day after each, and its Gregorian weekday moves."
                if next <= GregorianDate.maxYear {
                    let (before, after) = RepeatNotes.thirteenWeeklyWeekdays(rule, year: next, start: start)
                    let plural = RepeatNotes.plural
                    text +=
                        ifc && Calc.isLeap(next)
                        ? " In \(next) it falls on \(plural(before)) until Leap Day and on \(plural(after)) after it."
                        : " In \(next) it falls on \(plural(before))."
                }
                notes.append(text)
            }
        default:
            break
        }
        return notes
    }
}

private enum RepeatNotes {
    static func plural(_ weekday: Weekday) -> String { "\(weekday.name(.long))s" }

    /// The largest month day from 29 to 31 of a Gregorian monthly rule by month days, or nil.
    static func longMonthDay(_ rule: RRule, _ start: GregorianDate) -> Int? {
        if rule.freq != .monthly || !rule.byDay.isEmpty || !rule.bySetPos.isEmpty || !rule.byMonth.isEmpty { return nil }
        let days = rule.byMonthDay.isEmpty ? [start.day] : rule.byMonthDay
        return days.filter { $0 >= 29 }.max()
    }

    /// `true` for a Gregorian yearly rule on February 29.
    static func onLeapDay(_ rule: RRule, _ start: GregorianDate) -> Bool {
        if rule.freq != .yearly || !rule.byDay.isEmpty || !rule.bySetPos.isEmpty || !rule.byWeekNo.isEmpty
            || !rule.byYearDay.isEmpty
        {
            return false
        }
        if rule.byMonth.isEmpty && rule.byMonthDay.isEmpty { return start.month == 2 && start.day == 29 }
        return rule.byMonth == [2] && rule.byMonthDay == [29]
    }

    /// The weekday of a Gregorian weekly rule on one weekday every week or every 2 weeks, or nil.
    static func weeklyWeekday(_ rule: RRule, _ start: GregorianDate) -> Weekday? {
        if rule.freq != .weekly || (rule.interval != 1 && rule.interval != 2) { return nil }
        if !rule.byMonth.isEmpty || !rule.bySetPos.isEmpty || !rule.byMonthDay.isEmpty || !rule.byYearDay.isEmpty
            || !rule.byWeekNo.isEmpty
        {
            return nil
        }
        if rule.byDay.isEmpty { return start.weekday }
        return Words.plainMask(rule.byDay).flatMap(Words.single).flatMap { Weekday(rawValue: $0) }
    }

    /// The note of a leap-only intercalary rule (§5.2), or nil when its start is not on it.
    static func leapCapNote(_ rule: ThirteenRule, _ start: GregorianDate) -> String? {
        guard case let .intercalary(system, id) = rule, rule.encodingForm == .leapInterval, rule.contains(start, start: start),
            let cap = rule.cap(start: start)
        else { return nil }
        let text = "Repeats every 4 years until \(cap.thirteen(in: system).formatted(.long))."
        // A cap set by the end of the range (9996) has no missing leap year after it.
        if cap.year + 4 > GregorianDate.maxYear { return text }
        return "\(text) \(cap.year + system.yearOffset + 4) has no \(system.intercalaryDayInfo(id).name), so the repeat stops before it."
    }

    /// The Gregorian weekdays of a 13-month weekly rule in `year`: before and after IFC Leap Day.
    static func thirteenWeeklyWeekdays(_ rule: ThirteenRule, year: Int, start: GregorianDate) -> (Weekday, Weekday) {
        let dates = ThirteenRule.dates(rule.yearDays(start: start), year: year)
        let after = dates.first { date in
            if case let .month(m) = date.thirteen(in: rule.system) { return m.month >= 7 }
            return false
        }!
        return (dates[0].weekday, after.weekday)
    }

    /// The 13-month weekday of Gregorian weekday `weekday` in `year`, before and after IFC Leap Day.
    static func thirteenWeekdays(of weekday: Weekday, year: Int, system: CalendarSystemID) -> (Weekday, Weekday) {
        func weekdayIn(_ month: Int, from day: Int) -> Weekday {
            let date = (0..<7).lazy.map { GregorianDate(unchecked: year, month, day + $0) }.first { $0.weekday == weekday }!
            return date.thirteen(in: system).weekday!
        }
        // IFC Sol 1 is June 18 in leap years; any month day after Leap Day carries the later weekday.
        return (weekdayIn(1, from: 1), weekdayIn(6, from: 18))
    }
}

// MARK: - Presets (§2.13)

extension RepeatPreset {
    /// The Gregorian presets' minimal forms (§4.1), in picker order.
    static let gregorian: [(id: String, rrule: RRule)] = [
        ("daily", RRule(freq: .daily)),
        ("weekly", RRule(freq: .weekly)),
        ("biweekly", RRule(freq: .weekly, interval: 2)),
        ("monthly", RRule(freq: .monthly)),
        ("yearly", RRule(freq: .yearly)),
    ]

    /// The explicit form of a Gregorian preset for `start` (§4.1): `BYDAY=MO`, `BYMONTHDAY=19`,
    /// `BYMONTH=10;BYMONTHDAY=19`.
    static func explicitForm(_ id: String, start: GregorianDate) -> RRule? {
        switch id {
        case "weekly": RRule(freq: .weekly, byDay: [WeekdayNum(weekday: start.weekday)])
        case "biweekly": RRule(freq: .weekly, interval: 2, byDay: [WeekdayNum(weekday: start.weekday)])
        case "monthly": RRule(freq: .monthly, byMonthDay: [start.day])
        case "yearly": RRule(freq: .yearly, byMonthDay: [start.day], byMonth: [start.month])
        default: nil
        }
    }

    /// The 13-month preset kinds for `start` in `system`, in picker order.
    static func thirteen(start: GregorianDate, system: CalendarSystemID) -> [(id: String, rule: ThirteenRule)] {
        let kinds: [(String, ThirteenRuleKind)] = [
            ("thirteen-monthly", .monthly), ("thirteen-weekly", .weekly), ("thirteen-biweekly", .biweekly),
            ("thirteen-yearly", .yearly), ("thirteen-intercalary", .intercalary),
        ]
        return kinds.compactMap { id, kind in ThirteenRule(kind, start: start, system: system).map { (id, $0) } }
    }

    /// The repeat picker's rows for a start (§2.13), in order: Never; the Gregorian presets (every
    /// day, week, 2 weeks, month, year, in their minimal forms); and the 13-month presets of
    /// `system` (every month, week, 2 weeks and year, or on an intercalary start only that day's
    /// repeat). Labels are the descriptions without an end; `exchangeSafe` is false for 13-month
    /// rules stored as day-of-year lists (§4.3 b). TS: `repeatPresets`.
    public static func all(start: GregorianDate, system: CalendarSystemID = .ifc) -> [RepeatPreset] {
        var presets = [RepeatPreset(id: "never", section: .never, label: "Never", recurrence: nil, exchangeSafe: true)]
        for (id, rrule) in gregorian {
            let recurrence = EventRecurrence(rule: .rrule(rrule))
            presets.append(
                RepeatPreset(id: id, section: .gregorian, label: recurrence.describe(start: start), recurrence: recurrence, exchangeSafe: true))
        }
        for (id, rule) in thirteen(start: start, system: system) {
            presets.append(
                RepeatPreset(
                    id: id, section: .thirteen, label: Words.describe(rule), recurrence: EventRecurrence(rule: .thirteen(rule)),
                    exchangeSafe: rule.encodingForm != .byYearDay))
        }
        return presets
    }

    /// The id of the picker row a repeat shows as checked (§2.13): `never` for no repeat; a
    /// Gregorian preset when the rule equals its minimal or explicit form (§4.1; `X-` parts and
    /// `WKST` ignored); a 13-month preset when the rule is the one that preset makes from `start` in
    /// `system`. The end and excluded dates do not matter. `nil` (Custom, or "Keep") for anything
    /// else, including any repeat with extra dates. TS: `matchRepeatPreset`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid recurrence.
    public static func match(_ recurrence: EventRecurrence?, start: GregorianDate, system: CalendarSystemID = .ifc)
        throws(ThirteenError) -> String?
    {
        guard let recurrence else { return "never" }
        try recurrence.validate()
        if !recurrence.extraDates.isEmpty { return nil }
        switch recurrence.rule {
        case let .rrule(rrule):
            var plain = rrule
            plain.extensions = []
            for (id, minimal) in gregorian {
                let forms = [minimal] + (explicitForm(id, start: start).map { [$0] } ?? [])
                if forms.contains(where: { plain.equivalent(to: $0, ignoringEnd: true, ignoringWkst: true) }) { return id }
            }
            return nil
        case let .thirteen(rule):
            if rule.system != system { return nil }
            return thirteen(start: start, system: system).first { $0.rule == rule }?.id
        default:
            return nil
        }
    }
}

// MARK: - Adaptation to a new start (§2.11)

extension EventRecurrence {
    /// Re-derives a repeat when the start of its first occurrence moves from `oldStart` to `newStart`
    /// (the §2.11 table), so that no change of repeat kind is ever silent. 13-month rules are
    /// re-derived in their own system: monthly and weekly follow the new day (`adapted`) or become
    /// Never on an intercalary day (`nil`, `dropped`); yearly follows (`adapted`) or becomes that
    /// day's intercalary repeat (`converted`); intercalary stays on its own day (`none`) or becomes
    /// the other day's repeat or yearly on the new date (`converted`). Gregorian presets in their
    /// explicit form matching `oldStart` are rewritten (`adapted`); everything else stays (`none`).
    /// The end, extra and removed dates are kept. TS: `adaptRecurrenceToStart`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` for an invalid recurrence.
    public func adapted(from oldStart: GregorianDate, to newStart: GregorianDate) throws(ThirteenError)
        -> (recurrence: EventRecurrence?, change: RepeatChange)
    {
        try validateShape()
        return adaptedValid(from: oldStart, to: newStart)
    }

    func adaptedValid(from oldStart: GregorianDate, to newStart: GregorianDate) -> (recurrence: EventRecurrence?, change: RepeatChange) {
        var copy = self
        switch rule {
        case let .thirteen(rule):
            let (next, change) = EventRecurrence.adapt(rule, to: newStart)
            guard let next else { return (nil, change) }
            copy.rule = .thirteen(next)
            return (copy, change)
        case let .rrule(rrule):
            if let followed = EventRecurrence.followExplicitPreset(rrule, oldStart, newStart), followed != rrule {
                copy.rule = .rrule(followed)
                return (copy, .adapted)
            }
        default:
            break
        }
        return (copy, .none)
    }

    /// The 13-month rule re-derived from the new start in the rule's own system, with the change.
    private static func adapt(_ rule: ThirteenRule, to newStart: GregorianDate) -> (ThirteenRule?, RepeatChange) {
        let date = newStart.thirteen(in: rule.system)
        func follow(_ next: ThirteenRule) -> (ThirteenRule?, RepeatChange) { (next, next == rule ? .none : .adapted) }
        switch (rule, date) {
        case (.monthly, .intercalary), (.weekly, .intercalary): return (nil, .dropped)
        case let (.monthly(system, _), .month(m)): return follow(.monthly(system: system, day: m.day))
        case let (.weekly(system, _, interval), .month(m)): return follow(.weekly(system: system, weekday: m.weekday, interval: interval))
        case let (.yearly(system, _, _), .intercalary(day)): return (.intercalary(system: system, id: day.id), .converted)
        case let (.yearly(system, _, _), .month(m)): return follow(.yearly(system: system, month: m.month, day: m.day))
        case let (.intercalary(system, _), .month(m)): return (.yearly(system: system, month: m.month, day: m.day), .converted)
        case let (.intercalary(system, id), .intercalary(day)):
            return day.id == id ? (rule, .none) : (.intercalary(system: system, id: day.id), .converted)
        }
    }

    /// `true` when an RRULE has only the parts a Gregorian preset can have.
    private static func isPresetShaped(_ rule: RRule) -> Bool {
        rule.count == nil && rule.until == nil && rule.bySecond.isEmpty && rule.byMinute.isEmpty && rule.byHour.isEmpty
            && rule.byYearDay.isEmpty && rule.byWeekNo.isEmpty && rule.bySetPos.isEmpty
            && (rule.rscale == nil || rule.rscale!.uppercased() == "GREGORIAN") && rule.skip == nil && rule.extensions.isEmpty
    }

    /// A Gregorian preset in its explicit form matching the old start, rewritten for the new start;
    /// nil for any other rule.
    private static func followExplicitPreset(_ rule: RRule, _ oldStart: GregorianDate, _ newStart: GregorianDate) -> RRule? {
        guard isPresetShaped(rule) else { return nil }
        var copy = rule
        if rule.freq == .weekly, rule.interval == 1 || rule.interval == 2,
            rule.byDay == [WeekdayNum(weekday: oldStart.weekday)], rule.byMonthDay.isEmpty, rule.byMonth.isEmpty
        {
            copy.byDay = [WeekdayNum(weekday: newStart.weekday)]
            return copy
        }
        if rule.freq == .monthly, rule.interval == 1, rule.byDay.isEmpty, rule.byMonth.isEmpty, rule.byMonthDay == [oldStart.day] {
            copy.byMonthDay = [newStart.day]
            return copy
        }
        if rule.freq == .yearly, rule.interval == 1, rule.byDay.isEmpty, rule.byMonth == [oldStart.month],
            rule.byMonthDay == [oldStart.day]
        {
            copy.byMonth = [newStart.month]
            copy.byMonthDay = [newStart.day]
            return copy
        }
        return nil
    }
}

// MARK: - Codable (§5.5)

extension RepeatPreset: Codable {
    enum CodingKeys: String, CodingKey { case id, section, label, exchangeSafe, recurrence }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(section, forKey: .section)
        try c.encode(label, forKey: .label)
        try c.encode(exchangeSafe, forKey: .exchangeSafe)
        try c.encode(recurrence, forKey: .recurrence)
    }
}
