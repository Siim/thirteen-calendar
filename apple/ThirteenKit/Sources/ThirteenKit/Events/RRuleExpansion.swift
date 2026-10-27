// The RFC 5545 §3.3.10 engine behind recurrence expansion (docs/EVENTS.md §4.6 step 1),
// mirroring `packages/core/src/events/rrule-expansion.ts`: the candidate dates one `RRULE` (or
// `EXRULE`) produces, period by period, with the calendar-time guard. Internal: the public API is
// `EventRecurrence.expand(start:in:limit:)` and the functions built on it.
//
// Dates are Julian Day Numbers. The civil arithmetic here is unchecked, so a week period may begin
// in year 0 and a `BYWEEKNO` week may end in year 10000; no date outside 0001-01-01 … 9999-12-31 is
// ever produced.
//
// Periods: DAILY steps days from the start, WEEKLY steps weeks that begin on WKST (default Monday)
// from the week holding the start, MONTHLY steps months from the start's month and YEARLY steps
// calendar years from the start's year, each by INTERVAL. Candidates of a period are described in
// the TypeScript module; BYSETPOS then picks positions in the period's sorted candidates. Invalid
// dates are skipped, never moved.
//
// Guard: the engine stops, and reports `truncated`, at the first period whose first day lies in a
// year more than `400 × INTERVAL` years after the year of the last candidate on or after the start
// (or of the start).
//
// Jumping ahead: when the caller does not count occurrences, the engine may skip from the period
// after its first candidate straight to the first period that can reach the wanted dates. This
// gives exactly the dates and the `truncated` flag of a step-by-step run.

/// Unchecked civil arithmetic on any proleptic Gregorian date (no range check).
enum Civil {
    /// Julian Day Number of any proleptic Gregorian date.
    static func jdn(_ year: Int, _ month: Int, _ day: Int) -> Int {
        let a = Calc.floorDiv(14 - month, 12)
        let y = year + 4800 - a
        let m = month + 12 * a - 3
        return day + Calc.floorDiv(153 * m + 2, 5) + 365 * y + Calc.floorDiv(y, 4) - Calc.floorDiv(y, 100)
            + Calc.floorDiv(y, 400) - 32045
    }

    /// Year, month and day of any Julian Day Number.
    static func ymd(_ jdn: Int) -> (year: Int, month: Int, day: Int) {
        let a = jdn + 32044
        let b = Calc.floorDiv(4 * a + 3, 146_097)
        let c = a - Calc.floorDiv(146_097 * b, 4)
        let d = Calc.floorDiv(4 * c + 3, 1461)
        let e = c - Calc.floorDiv(1461 * d, 4)
        let m = Calc.floorDiv(5 * e + 2, 153)
        return (100 * b + d - 4800 + Calc.floorDiv(m, 10), m + 3 - 12 * Calc.floorDiv(m, 10), e - Calc.floorDiv(153 * m + 2, 5) + 1)
    }

    /// The year of any Julian Day Number.
    static func year(_ jdn: Int) -> Int { ymd(jdn).year }

    /// The Gregorian leap-year rule for any integer year.
    static func isLeap(_ year: Int) -> Bool { year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) }

    /// Days in a month of any year.
    static func monthLength(_ year: Int, _ month: Int) -> Int {
        month == 2 && isLeap(year) ? 29 : maxMonthLengths[month - 1] - (month == 2 ? 1 : 0)
    }

    /// Weekday raw value (`0 = Sunday`) of any Julian Day Number.
    static func weekday(_ jdn: Int) -> Int { Calc.mod(jdn + 1, 7) }

    /// The longest each month can be (February 29).
    static let maxMonthLengths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

    /// `ceil(a / b)` for `b > 0`.
    static func ceilDiv(_ a: Int, _ b: Int) -> Int { -Calc.floorDiv(-a, b) }
}

/// Whether the engine can expand a rule (§4.6 step 6).
enum RRuleSupport {
    case supported, unsupported, impossible

    /// `.unsupported` for `HOURLY`, `MINUTELY` and `SECONDLY`, an `RSCALE` other than `GREGORIAN`, any
    /// `SKIP`, `BYHOUR`, `BYMINUTE` or `BYSECOND` with more than one value, and the parts RFC 5545
    /// does not allow with the frequency. With `startMinute`, a single `BYHOUR` or `BYMINUTE` value
    /// must also be the start's, and a single `BYSECOND` value 0. `.impossible` for a rule whose
    /// `BYMONTH` and `BYMONTHDAY` never meet.
    init(_ rule: RRule, startMinute: Int?) {
        switch rule.freq {
        case .secondly, .minutely, .hourly:
            self = .unsupported
            return
        default: break
        }
        if let rscale = rule.rscale, rscale != "GREGORIAN" {
            self = .unsupported
            return
        }
        if rule.skip != nil || rule.byHour.count > 1 || rule.byMinute.count > 1 || rule.bySecond.count > 1 {
            self = .unsupported
            return
        }
        if let startMinute {
            if rule.byHour.count == 1 && rule.byHour[0] != startMinute / 60
                || rule.byMinute.count == 1 && rule.byMinute[0] != startMinute % 60
                || rule.bySecond.count == 1 && rule.bySecond[0] != 0
            {
                self = .unsupported
                return
            }
        }
        if !rule.byWeekNo.isEmpty && rule.freq != .yearly
            || !rule.byYearDay.isEmpty && (rule.freq == .weekly || rule.freq == .monthly)
            || !rule.byMonthDay.isEmpty && rule.freq == .weekly
        {
            self = .unsupported
            return
        }
        if !rule.byMonth.isEmpty && !rule.byMonthDay.isEmpty {
            let meets = rule.byMonth.contains { month in
                rule.byMonthDay.contains { abs($0) <= Civil.maxMonthLengths[month - 1] }
            }
            if !meets {
                self = .impossible
                return
            }
        }
        self = .supported
    }
}

/// A rule compiled for candidate generation.
private struct CompiledRule {
    let freq: Frequency
    let interval: Int
    /// Bit `m` set for each `BYMONTH` month; 0 without `BYMONTH`.
    let months: Int
    let monthList: [Int]
    let weekNos: [Int]
    let yearDays: [Int]
    let monthDays: [Int]
    let hasByDay: Bool
    /// Bit `w` set for each `BYDAY` weekday matched on every such day.
    let plainDays: Int
    /// `BYDAY` entries whose ordinal counts.
    let ordinalDays: [(weekday: Int, ordinal: Int)]
    let setPos: [Int]
    let wkst: Int
    let dayLevel: Bool

    init(_ rule: RRule) {
        freq = rule.freq
        interval = rule.interval
        // Ordinals count only in MONTHLY rules and in YEARLY rules without BYWEEKNO.
        let ordinalsCount = rule.freq == .monthly || (rule.freq == .yearly && rule.byWeekNo.isEmpty)
        var plain = 0
        var ordinals: [(weekday: Int, ordinal: Int)] = []
        for entry in rule.byDay {
            if let ordinal = entry.ordinal, ordinalsCount {
                ordinals.append((entry.weekday.rawValue, ordinal))
            } else {
                plain |= 1 << entry.weekday.rawValue
            }
        }
        plainDays = plain
        ordinalDays = ordinals
        var bits = 0
        for month in rule.byMonth { bits |= 1 << month }
        months = bits
        monthList = Array(Set(rule.byMonth)).sorted()
        weekNos = rule.byWeekNo
        yearDays = rule.byYearDay
        monthDays = rule.byMonthDay
        hasByDay = !rule.byDay.isEmpty
        setPos = rule.bySetPos
        wkst = (rule.wkst ?? .monday).rawValue
        dayLevel = !rule.byWeekNo.isEmpty || !rule.byYearDay.isEmpty || !rule.byMonthDay.isEmpty || !rule.byDay.isEmpty
    }

    func inMonths(_ month: Int) -> Bool { months == 0 || months & (1 << month) != 0 }

    /// `true` when the weekday matches `BYDAY`; `nth` and `nthFromEnd` count it in its month or year.
    func dayMatches(_ weekday: Int, _ nth: Int, _ nthFromEnd: Int) -> Bool {
        if plainDays & (1 << weekday) != 0 { return true }
        return ordinalDays.contains { $0.weekday == weekday && ($0.ordinal > 0 ? $0.ordinal == nth : -$0.ordinal == nthFromEnd) }
    }
}

/// `true` when position `value` (1-based, negative from the end) of a run of `length` is `position`.
@inline(__always)
private func matchesPosition(_ value: Int, _ position: Int, _ length: Int) -> Bool {
    value > 0 ? value == position : length + value + 1 == position
}

private func inList(_ list: [Int], _ position: Int, _ length: Int) -> Bool {
    list.contains { matchesPosition($0, position, length) }
}

/// The first day of week 1 of `year` for weeks that begin on `wkst`: the `wkst` day on or before January 4.
private func weekOneStart(_ year: Int, _ wkst: Int) -> Int {
    let fourth = Civil.jdn(year, 1, 4)
    return fourth - Calc.mod(Civil.weekday(fourth) - wkst, 7)
}

/// `true` when day `jdn` (in calendar year `year`) lies in one of the `BYWEEKNO` weeks; `starts[i]`
/// is the start of week 1 of `year - 1 + i`.
private func inWeeks(_ jdn: Int, _ starts: [Int], _ weekNos: [Int]) -> Bool {
    let index = jdn < starts[1] ? 0 : jdn < starts[2] ? 1 : 2
    let first = starts[index]
    let count = (starts[index + 1] - first) / 7
    return inList(weekNos, Calc.floorDiv(jdn - first, 7) + 1, count)
}

private func applySetPos(_ candidates: [Int], _ setPos: [Int]) -> [Int] {
    if setPos.isEmpty { return candidates }
    var picked = Set<Int>()
    for value in setPos {
        let index = value > 0 ? value - 1 : candidates.count + value
        if index >= 0 && index < candidates.count { picked.insert(candidates[index]) }
    }
    return picked.sorted()
}

private func dailyCandidates(_ rule: CompiledRule, _ jdn: Int) -> [Int] {
    let (year, month, day) = Civil.ymd(jdn)
    if !rule.inMonths(month) { return [] }
    if !rule.monthDays.isEmpty && !inList(rule.monthDays, day, Civil.monthLength(year, month)) { return [] }
    if !rule.yearDays.isEmpty {
        let dayOfYear = jdn - Civil.jdn(year, 1, 1) + 1
        if !inList(rule.yearDays, dayOfYear, Civil.isLeap(year) ? 366 : 365) { return [] }
    }
    if rule.hasByDay && rule.plainDays & (1 << Civil.weekday(jdn)) == 0 { return [] }
    return applySetPos([jdn], rule.setPos)
}

private func weeklyCandidates(_ rule: CompiledRule, _ weekStart: Int, _ startWeekday: Int) -> [Int] {
    let wanted = rule.hasByDay ? rule.plainDays : 1 << startWeekday
    var out: [Int] = []
    for i in 0..<7 {
        let jdn = weekStart + i
        if wanted & (1 << Civil.weekday(jdn)) == 0 { continue }
        if rule.months != 0 && !rule.inMonths(Civil.ymd(jdn).month) { continue }
        out.append(jdn)
    }
    return applySetPos(out, rule.setPos)
}

private func monthlyCandidates(_ rule: CompiledRule, _ year: Int, _ month: Int, _ startDay: Int) -> [Int] {
    if !rule.inMonths(month) { return [] }
    let length = Civil.monthLength(year, month)
    let base = Civil.jdn(year, month, 1)
    if rule.monthDays.isEmpty && !rule.hasByDay { return startDay <= length ? [base + startDay - 1] : [] }
    var out: [Int] = []
    for day in 1...length {
        if !rule.monthDays.isEmpty && !inList(rule.monthDays, day, length) { continue }
        let jdn = base + day - 1
        if rule.hasByDay && !rule.dayMatches(Civil.weekday(jdn), (day - 1) / 7 + 1, (length - day) / 7 + 1) { continue }
        out.append(jdn)
    }
    return applySetPos(out, rule.setPos)
}

private func yearlyCandidates(_ rule: CompiledRule, _ year: Int, _ start: (month: Int, day: Int), _ startWeekday: Int)
    -> [Int]
{
    if !rule.dayLevel {
        let months = rule.monthList.isEmpty ? [start.month] : rule.monthList
        let out = months.filter { start.day <= Civil.monthLength(year, $0) }.map { Civil.jdn(year, $0, start.day) }
        return applySetPos(out, rule.setPos)
    }
    let yearLength = Civil.isLeap(year) ? 366 : 365
    let weeks: [Int]? = rule.weekNos.isEmpty ? nil : (0..<4).map { weekOneStart(year - 1 + $0, rule.wkst) }
    var out: [Int] = []
    var dayOfYear = 0
    var jdn = Civil.jdn(year, 1, 1) - 1
    for month in 1...12 {
        let length = Civil.monthLength(year, month)
        if !rule.inMonths(month) {
            dayOfYear += length
            jdn += length
            continue
        }
        for day in 1...length {
            dayOfYear += 1
            jdn += 1
            if !rule.yearDays.isEmpty && !inList(rule.yearDays, dayOfYear, yearLength) { continue }
            if !rule.monthDays.isEmpty && !inList(rule.monthDays, day, length) { continue }
            if let weeks, !inWeeks(jdn, weeks, rule.weekNos) { continue }
            let weekday = Civil.weekday(jdn)
            if rule.hasByDay {
                let inMonth = rule.months != 0
                let nth = inMonth ? (day - 1) / 7 + 1 : (dayOfYear - 1) / 7 + 1
                let nthFromEnd = inMonth ? (length - day) / 7 + 1 : (yearLength - dayOfYear) / 7 + 1
                if !rule.dayMatches(weekday, nth, nthFromEnd) { continue }
            } else if weeks != nil && weekday != startWeekday {
                continue
            }
            out.append(jdn)
        }
    }
    return applySetPos(out, rule.setPos)
}

/// The dates one supported rule produces from `start` (inclusive, only when the rule produces it)
/// through `stop` (inclusive), ascending. ``next()`` returns -1 at the end; ``truncated`` then
/// tells whether the guard stopped it. With `jumpTo` (a day; the caller does not count dates),
/// dates before it may be skipped.
final class RRuleCandidates {
    private static let guardYears = 400

    private let rule: CompiledRule
    private let startYear: Int
    private let startMonth: Int
    private let startDay: Int
    private let startJdn: Int
    private let startWeekday: Int
    private let stop: Int
    private let jumpTo: Int?
    /// The index of the next period to generate.
    private var period = 0
    private var queue: [Int] = []
    private var head = 0
    private var lastYear: Int
    private var found = false
    private var jumped = false
    private var done = false
    /// Days between dates for a DAILY or WEEKLY rule with no BY parts; 0 for every other rule.
    private let step: Int
    /// `true` once the guard has stopped the stream.
    private(set) var truncated = false

    init(_ rule: RRule, start: GregorianDate, stop: Int, jumpTo: Int?) {
        let compiled = CompiledRule(rule)
        self.rule = compiled
        startYear = start.year
        startMonth = start.month
        startDay = start.day
        startJdn = start.julianDayNumber
        startWeekday = Civil.weekday(startJdn)
        self.stop = min(stop, GregorianDate.maxJulianDayNumber)
        self.jumpTo = jumpTo
        lastYear = start.year
        let plain = compiled.months == 0 && !compiled.dayLevel && compiled.setPos.isEmpty
        step = !plain ? 0 : compiled.freq == .daily ? compiled.interval : compiled.freq == .weekly ? 7 * compiled.interval : 0
        // HOURLY and finer have no day candidates: an unsupported rule gives only its start (§4.6
        // step 6), also where splits and retimes read a rule's dates. (TS: RRuleCandidates.fill has
        // no case for them and throws a TypeError there; reported to Core.)
        if [.secondly, .minutely, .hourly].contains(compiled.freq) { done = true }
    }

    /// The next date (a Julian Day Number), or -1 at the end.
    func next() -> Int {
        if step != 0 {
            if done { return -1 }
            if found && !jumped && jumpTo != nil { jump() }
            // Period k of a weekly rule holds the start's weekday of its week: the start plus k weeks.
            let (product, overflow) = step.multipliedReportingOverflow(by: period)
            period += 1
            let jdn = startJdn + product
            if overflow || jdn > stop {
                done = true
                return -1
            }
            found = true
            return jdn
        }
        while true {
            if head < queue.count {
                let jdn = queue[head]
                head += 1
                if jdn > stop {
                    done = true
                    queue = []
                    return -1
                }
                return jdn
            }
            if done { return -1 }
            fill()
        }
    }

    /// Generates the next period with candidates on or after the start, or ends the stream.
    private func fill() {
        while true {
            if found && !jumped && jumpTo != nil { jump() }
            let k = period
            period += 1
            var first: Int
            var year: Int
            var candidates: [Int] = []
            switch rule.freq {
            case .daily:
                first = startJdn + k * rule.interval
                year = first > stop ? 0 : Civil.year(first)
                if first <= stop { candidates = dailyCandidates(rule, first) }
            case .weekly:
                let weekStart = self.weekStart + 7 * rule.interval * k
                first = weekStart
                year = Civil.year(first)
                if first <= stop { candidates = weeklyCandidates(rule, weekStart, startWeekday) }
            case .monthly:
                let index = startYear * 12 + startMonth - 1 + rule.interval * k
                year = Calc.floorDiv(index, 12)
                let month = index - year * 12 + 1
                first = Civil.jdn(year, month, 1)
                if first <= stop { candidates = monthlyCandidates(rule, year, month, startDay) }
            default:  // yearly (HOURLY and finer end in init)
                year = startYear + rule.interval * k
                first = Civil.jdn(year, 1, 1)
                if first <= stop {
                    candidates = yearlyCandidates(rule, year, (startMonth, startDay), startWeekday)
                }
            }
            if first > stop {
                done = true
                return
            }
            if year > lastYear + RRuleCandidates.guardYears * rule.interval {
                done = true
                truncated = true
                return
            }
            if !candidates.isEmpty { found = true }
            let kept = candidates.filter { $0 >= startJdn && $0 >= GregorianDate.minJulianDayNumber }
            if let last = kept.last {
                lastYear = Civil.year(last)
                queue = kept
                head = 0
                return
            }
        }
    }

    /// The first day of the week holding the start.
    private var weekStart: Int { startJdn - Calc.mod(startWeekday - rule.wkst, 7) }

    /// Skips to the first period that can reach `jumpTo` (see the module documentation).
    private func jump() {
        jumped = true
        guard let target = jumpTo else { return }
        let step = rule.interval
        let k: Int
        switch rule.freq {
        case .daily:
            k = Civil.ceilDiv(target - startJdn, step)
        case .weekly:
            k = Civil.ceilDiv(target - 6 - weekStart, 7 * step)
        case .monthly:
            let (year, month, _) = Civil.ymd(target)
            k = Civil.ceilDiv(year * 12 + month - 1 - (startYear * 12 + startMonth - 1), step)
        default:
            k = Civil.ceilDiv(Civil.year(target) - startYear, step)
        }
        if k <= period { return }
        period = k
        // The rule has produced a candidate, so the next one is less than one cycle away from any period.
        let first: Int
        switch rule.freq {
        case .daily: first = startJdn + k * step
        case .weekly: first = weekStart + 7 * step * k
        case .monthly: first = Civil.jdn(Calc.floorDiv(startYear * 12 + startMonth - 1 + step * k, 12), 1, 1)
        default: first = Civil.jdn(startYear + step * k, 1, 1)
        }
        lastYear = max(lastYear, Civil.year(first))
    }
}
