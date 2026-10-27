// Layouts of event occurrences for the Calendar section (docs/EVENTS.md §2.3 to §2.8, §5.2, §5.3),
// mirroring `packages/core/src/events/layout.ts`: Month lanes and intercalary bands, the Week and Day
// timelines with their overflow blocks, the List agenda, Year dots, the Month header's Gregorian
// weekdays and the compact chip time.
//
// Every layout takes ``EventOccurrence``s in the DEVICE's wall clock, already filtered to visible
// calendars, with ends in end-of-day form (§3.1.1; `D+1 T00:00` is the same end as `D T24:00`).
// Days are Gregorian days: an occurrence touches every date from its start date to the date of its
// end-of-day form, inclusive (a zero-length occurrence touches its start date). Keys must be unique
// within one call.
//
// Bars and dots: an occurrence that is all-day or lasts 24 hours or more (wall clock) is a bar; a
// shorter timed occurrence is a dot in Month and a block on the Week and Day timelines.
//
// Order key (§5.3), ties broken left to right: start, earlier first; all-day bars, then timed
// bars, then dots; longer duration first; title by Unicode code points; key by Unicode code points.
//
// The interpretations where §5.3 leaves a detail open are those of layout.ts (the fixtures pin
// them): lanes sort by clipped start column, then bars before dots, then the order key; unlimited
// `maxLanes` shows the lanes the row uses; overflowed timeline items keep their full cluster's
// `slot` and `slotCount`; a timed occurrence whose end is before its start (a fall-back night) is
// laid out as zero-length; an all-day occurrence must not end before it starts.

// MARK: - Types (§5.2)

/// One bar or dot in a Month week row, an intercalary band or the Week all-day row. TS: `MonthItem`.
public struct MonthItem: Sendable, Hashable {
    /// `bar`: all-day or 24 hours or more; `dot`: a shorter timed occurrence (one item per day it touches).
    public enum Style: String, Sendable, Hashable, Codable {
        case bar, dot
    }

    public let key: String
    public let style: Style
    /// `0…6` within a week row (`0` in an intercalary band; up to `8` in the Week all-day row).
    public let startColumn: Int
    /// Inclusive.
    public let endColumn: Int
    public let lane: Int
    /// The occurrence starts before `startColumn`'s day (a previous row, month, band or week).
    public let continuesBefore: Bool
    /// The occurrence ends after `endColumn`'s day.
    public let continuesAfter: Bool
}

/// One week row of a Month layout. TS: `MonthWeekRow`.
public struct MonthWeekRow: Sendable, Hashable {
    /// `1…4`.
    public let week: Int
    /// In lane-assignment order: clipped start column, bars before dots, then the order key.
    public let items: [MonthItem]
    /// Per column (7 entries): lanes that show items; with an overflow the next lane holds "+{hidden} more".
    public let visibleLanes: [Int]
    /// Per column (7 entries): items not drawn in that column (0 when everything fits).
    public let hidden: [Int]
}

/// An intercalary day drawn as a full-width band under week 4 of the month it follows.
/// TS: `IntercalaryBand`.
public struct IntercalaryBand: Sendable, Hashable {
    public let id: IntercalaryDayID
    public let gregorian: GregorianDate
    public let items: [MonthItem]
    public let visibleLanes: Int
    public let hidden: Int
}

/// A 13-month month with its occurrences in lanes (§2.4, §5.3). TS: `ThirteenMonthEventLayout`.
public struct ThirteenMonthEventLayout: Sendable, Hashable {
    /// Gregorian year.
    public let year: Int
    public let month: Int
    public let system: CalendarSystemID
    /// The Gregorian weekday of each column this month (7 entries, §2.4 header line 2).
    public let columnGregorianWeekdays: [Weekday]
    /// Exactly 4 rows.
    public let weeks: [MonthWeekRow]
    /// The intercalary days with `afterMonth == month`, in chronological order (0, 1 or 2).
    public let intercalary: [IntercalaryBand]
}

/// A shorter timed occurrence on one Week or Day column. TS: `TimedItem`.
public struct TimedItem: Sendable, Hashable {
    public let key: String
    public let column: Int
    /// Clipped to the column's day, `0…1440`.
    public let startMinute: Int
    /// Clipped to the column's day, `0…1440`.
    public let endMinute: Int
    /// The occurrence starts on an earlier day.
    public let clippedStart: Bool
    /// The occurrence ends on a later day.
    public let clippedEnd: Bool
    /// Horizontal position inside its overlap cluster: x = `slot` x column width / `slotCount`.
    public let slot: Int
    public let slotCount: Int
    /// `true`: drawn only through its ``TimedOverflow``.
    public let hidden: Bool
}

/// The "+{n}" block of §2.5: the items a cluster could not show. TS: `TimedOverflow`.
public struct TimedOverflow: Sendable, Hashable {
    public let column: Int
    /// `maxSlots - 1`.
    public let slot: Int
    /// `maxSlots`.
    public let slotCount: Int
    /// The hidden items' earliest start.
    public let startMinute: Int
    /// The hidden items' latest effective end (`max(end, start + minDurationMinutes)`).
    public let endMinute: Int
    /// Hidden items in order-key order.
    public let keys: [String]
}

/// A column of the Week timeline: a day of the 13-month week, or an intercalary day after week 4.
/// TS: `WeekColumn`.
public enum WeekColumn: Sendable, Hashable {
    case day(gregorian: GregorianDate, thirteen: ThirteenMonthDate)
    case intercalary(gregorian: GregorianDate, thirteen: ThirteenIntercalaryDate)

    public var gregorian: GregorianDate {
        switch self {
        case let .day(gregorian, _), let .intercalary(gregorian, _): gregorian
        }
    }

    public var thirteen: ThirteenDate {
        switch self {
        case let .day(_, date): .month(date)
        case let .intercalary(_, date): .intercalary(date)
        }
    }
}

/// A 13-month week with its all-day row and timeline (§2.5, §5.3). TS: `WeekEventLayout`.
public struct WeekEventLayout: Sendable, Hashable {
    /// The week's 7 days, plus the intercalary days that follow week 4 of the month.
    public let columns: [WeekColumn]
    /// Bars over the columns, in lanes (one row for the whole week).
    public let allDay: [MonthItem]
    /// By column, then in the column's sort order.
    public let timed: [TimedItem]
    /// By column, then in time order.
    public let overflow: [TimedOverflow]
}

/// One day for Day mode (§2.6, §5.3). TS: the `layoutDayEvents` result.
public struct DayEventLayout: Sendable, Hashable {
    /// The keys of the bars that touch the day, in order-key order.
    public let allDay: [String]
    /// The timeline of ``WeekEventLayout`` with a single column (column 0).
    public let timed: [TimedItem]
    public let overflow: [TimedOverflow]
}

/// One occurrence on one day of the agenda. TS: `AgendaItem`.
public struct AgendaItem: Sendable, Hashable {
    public enum Part: String, Sendable, Hashable, Codable {
        case single, first, middle, last
    }

    public let key: String
    public let part: Part
    /// 1-based day of the occurrence ("Day 2 of 3").
    public let dayIndex: Int
    /// Days the whole occurrence touches.
    public let dayCount: Int
    /// The part's start on this day; `nil` for all-day occurrences and middle parts.
    public let startMinute: Int?
    /// The part's end on this day (`1440` when it runs to midnight); `nil` for all-day occurrences
    /// and middle parts.
    public let endMinute: Int?
}

/// One day of the agenda (List mode, Up next, Month at accessibility sizes). TS: `AgendaDay`.
public struct AgendaDay: Sendable, Hashable {
    public let gregorian: GregorianDate
    public let thirteen: ThirteenDate
    /// All-day items and middle parts (order key), then by start minute, then the order key.
    public let items: [AgendaItem]
}

/// A day of the Gregorian year with events, for Year mode dots and the compact Month dots.
/// TS: `YearMark`.
public struct YearMark: Sendable, Hashable {
    public let dayOfYear: Int
    public let gregorian: GregorianDate
    /// Occurrences covering the day.
    public let count: Int
    /// Distinct calendar ids of those occurrences in order-key order, at most `maxCalendars`.
    public let calendarIDs: [String]
}

// MARK: - Prepared occurrences and the order key

/// Compares two strings by Unicode code points (as `compareCodePoints` does; UTF-8 byte order is
/// code point order). Swift's own `<` compares canonical equivalents as equal, which JavaScript does not.
func compareCodePoints(_ a: String, _ b: String) -> Int {
    var x = a.utf8.makeIterator()
    var y = b.utf8.makeIterator()
    while true {
        switch (x.next(), y.next()) {
        case (nil, nil): return 0
        case (nil, _): return -1
        case (_, nil): return 1
        case let (l?, r?): if l != r { return l < r ? -1 : 1 }
        }
    }
}

private enum Lay {
    static let day = EventTime.day
    static let daysPerWeek = 7
    static let weeksPerMonth = 4

    /// An occurrence validated and reduced to the numbers the layouts use.
    struct Prepared {
        let key: String
        let calendarID: String
        let title: String
        let allDay: Bool
        /// Absolute wall-clock minutes.
        let start: Int
        /// Absolute wall-clock minutes, never before `start`.
        let end: Int
        let duration: Int
        /// Julian Day Number of the first day touched.
        let firstDay: Int
        /// Julian Day Number of the last day touched.
        let lastDay: Int
        /// Criterion 2 of the order key: all-day bars 0, timed bars 1, dots 2.
        let rank: Int
        let bar: Bool
        /// Position in order-key order among the occurrences of the call.
        var order = 0
    }

    static func orderLess(_ a: Prepared, _ b: Prepared) -> Bool {
        if a.start != b.start { return a.start < b.start }
        if a.rank != b.rank { return a.rank < b.rank }
        if a.duration != b.duration { return a.duration > b.duration }
        let title = compareCodePoints(a.title, b.title)
        if title != 0 { return title < 0 }
        return compareCodePoints(a.key, b.key) < 0
    }

    static func prepareOne(_ o: EventOccurrence, _ index: Int, _ context: String) throws(ThirteenError) -> Prepared {
        let place = "\(context): occurrence \(index) (key \(Calc.quoted(o.key)))"
        do {
            try o.start.requirePlain("start of \(place)")
        } catch {
            throw .invalidEvent(error.description)
        }
        let start = o.start.absoluteMinutes
        var end = o.end.absoluteMinutes
        if o.allDay {
            if o.start.minute != 0 || (o.end.minute != 0 && o.end.minute != day) {
                throw .invalidEvent("\(place): an all-day occurrence runs from T00:00 to T24:00 (or T00:00) of whole days")
            }
            if end < start { throw .invalidEvent("\(place): the end is before the start") }
        } else if end < start {
            end = start  // a fall-back night: laid out as zero-length (§5.3 step 6)
        }
        let duration = end - start
        let firstDay = Calc.floorDiv(start, day)
        let bar = o.allDay || duration >= day
        return Prepared(
            key: o.key, calendarID: o.calendarID, title: o.title, allDay: o.allDay, start: start, end: end, duration: duration,
            firstDay: firstDay, lastDay: duration > 0 ? Calc.floorDiv(end - 1, day) : firstDay, rank: o.allDay ? 0 : bar ? 1 : 2,
            bar: bar)
    }

    /// Validates `occurrences` and returns them prepared, in order-key order.
    static func prepare(_ occurrences: [EventOccurrence], _ context: String) throws(ThirteenError) -> [Prepared] {
        var keys = Set<[UInt8]>()
        var prepared: [Prepared] = []
        prepared.reserveCapacity(occurrences.count)
        for (i, o) in occurrences.enumerated() {
            let item = try prepareOne(o, i, context)
            if !keys.insert(Array(item.key.utf8)).inserted {
                throw .invalidEvent(
                    "\(context): the occurrence key \(Calc.quoted(item.key)) is used twice (keys must be unique, §3.2)")
            }
            prepared.append(item)
        }
        prepared.sort(by: orderLess)
        for i in prepared.indices { prepared[i].order = i }
        return prepared
    }

    static func checkInteger(_ value: Int?, _ name: String, _ context: String, min: Int, max: Int? = nil) throws(ThirteenError) {
        guard let value else { return }
        if value < min || (max.map { value > $0 } ?? false) {
            let range = max.map { "\(min)..\($0)" } ?? "\(min) or more"
            throw .invalidEvent("\(context) option '\(name)' must be an integer \(range), got \(value)")
        }
    }

    // MARK: Lanes (Month rows, intercalary bands, the Week all-day row)

    struct LaneWork {
        let source: Prepared
        let style: MonthItem.Style
        let startColumn: Int
        let endColumn: Int
        let continuesBefore: Bool
        let continuesAfter: Bool
        var lane = -1

        var item: MonthItem {
            MonthItem(
                key: source.key, style: style, startColumn: startColumn, endColumn: endColumn, lane: lane,
                continuesBefore: continuesBefore, continuesAfter: continuesAfter)
        }
    }

    /// Adds the items of `p` for the contiguous days `first…last` (Julian Day Numbers, column =
    /// day - first): one bar clipped to the range, or one dot per day touched. `withDots: false`
    /// skips dots (the Week all-day row).
    static func collectLaneItems(_ p: Prepared, _ first: Int, _ last: Int, withDots: Bool, _ out: inout [LaneWork]) {
        if p.lastDay < first || p.firstDay > last { return }
        let from = max(p.firstDay, first)
        let to = min(p.lastDay, last)
        if p.bar {
            out.append(
                LaneWork(
                    source: p, style: .bar, startColumn: from - first, endColumn: to - first, continuesBefore: p.firstDay < from,
                    continuesAfter: p.lastDay > to))
            return
        }
        guard withDots else { return }
        for day in from...to {
            out.append(
                LaneWork(
                    source: p, style: .dot, startColumn: day - first, endColumn: day - first, continuesBefore: p.firstDay < day,
                    continuesAfter: p.lastDay > day))
        }
    }

    static func laneLess(_ a: LaneWork, _ b: LaneWork) -> Bool {
        if a.startColumn != b.startColumn { return a.startColumn < b.startColumn }
        if a.style != b.style { return a.style == .bar }
        return a.source.order < b.source.order
    }

    /// Sorts `items` and gives each the lowest lane free in all of its columns (§5.3 Month step 2).
    /// Returns the number of lanes used.
    static func assignLanes(_ items: inout [LaneWork], columnCount: Int) -> Int {
        items.sort(by: laneLess)
        var used = [[Bool]](repeating: [], count: columnCount)
        var firstFree = [Int](repeating: 0, count: columnCount)
        func isUsed(_ column: Int, _ lane: Int) -> Bool { lane < used[column].count && used[column][lane] }
        var laneCount = 0
        for i in items.indices {
            let columns = items[i].startColumn...items[i].endColumn
            // A lane free in every column is at least each column's lowest free lane.
            var lane = columns.map { firstFree[$0] }.max() ?? 0
            while columns.contains(where: { isUsed($0, lane) }) { lane += 1 }
            items[i].lane = lane
            for c in columns {
                if used[c].count <= lane { used[c].append(contentsOf: repeatElement(false, count: lane + 1 - used[c].count)) }
                used[c][lane] = true
                while isUsed(c, firstFree[c]) { firstFree[c] += 1 }
            }
            laneCount = max(laneCount, lane + 1)
        }
        return laneCount
    }

    /// §5.3 Month step 3: visible lanes and hidden counts per column.
    static func laneVisibility(_ items: [LaneWork], columnCount: Int, laneCount: Int, maxLanes: Int?) -> (
        visibleLanes: [Int], hidden: [Int]
    ) {
        guard let maxLanes else {
            return ([Int](repeating: laneCount, count: columnCount), [Int](repeating: 0, count: columnCount))
        }
        var highest = [Int](repeating: -1, count: columnCount)
        var atOrBeyondLast = [Int](repeating: 0, count: columnCount)
        for item in items {
            for c in item.startColumn...item.endColumn {
                highest[c] = max(highest[c], item.lane)
                if item.lane >= maxLanes - 1 { atOrBeyondLast[c] += 1 }
            }
        }
        let fits = highest.map { $0 < maxLanes }
        return (fits.map { $0 ? maxLanes : maxLanes - 1 }, (0..<columnCount).map { fits[$0] ? 0 : atOrBeyondLast[$0] })
    }

    // MARK: Week and Day timelines

    struct TimedWork {
        let source: Prepared
        let column: Int
        let startMinute: Int
        let endMinute: Int
        let effectiveEnd: Int
        let clippedStart: Bool
        let clippedEnd: Bool
        var slot = 0
        var slotCount = 1
        var hidden = false
    }

    /// The part of a dot occurrence `p` on day `day` (Julian Day Number), if it touches it.
    static func timedPart(_ p: Prepared, day: Int, column: Int, minDuration: Int) -> TimedWork? {
        if p.bar || p.lastDay < day || p.firstDay > day { return nil }
        let dayStart = day * Lay.day
        let startMinute = max(p.start, dayStart) - dayStart
        let endMinute = min(p.end, dayStart + Lay.day) - dayStart
        return TimedWork(
            source: p, column: column, startMinute: startMinute, endMinute: endMinute,
            effectiveEnd: max(endMinute, startMinute + minDuration), clippedStart: p.start < dayStart,
            clippedEnd: p.end > dayStart + Lay.day)
    }

    static func timedLess(_ a: TimedWork, _ b: TimedWork) -> Bool {
        if a.startMinute != b.startMinute { return a.startMinute < b.startMinute }
        let la = a.endMinute - a.startMinute
        let lb = b.endMinute - b.startMinute
        if la != lb { return la > lb }
        return a.source.order < b.source.order
    }

    private static func flush(
        _ cluster: [TimedWork], slotCount: Int, maxSlots: Int?, _ timed: inout [TimedItem], _ overflow: inout [TimedOverflow]
    ) {
        guard let firstItem = cluster.first else { return }
        let overflows = maxSlots.map { slotCount > $0 } ?? false
        var hiddenItems: [TimedWork] = []
        for var item in cluster {
            item.slotCount = slotCount
            if overflows, let maxSlots {
                if item.slot > maxSlots - 2 {
                    item.hidden = true
                    hiddenItems.append(item)
                } else {
                    item.slotCount = maxSlots
                }
            }
            timed.append(
                TimedItem(
                    key: item.source.key, column: item.column, startMinute: item.startMinute, endMinute: item.endMinute,
                    clippedStart: item.clippedStart, clippedEnd: item.clippedEnd, slot: item.slot, slotCount: item.slotCount,
                    hidden: item.hidden))
        }
        if overflows, let maxSlots {
            overflow.append(
                TimedOverflow(
                    column: firstItem.column, slot: maxSlots - 1, slotCount: maxSlots,
                    startMinute: hiddenItems.map(\.startMinute).min()!, endMinute: hiddenItems.map(\.effectiveEnd).max()!,
                    keys: hiddenItems.sorted { $0.source.order < $1.source.order }.map(\.source.key)))
        }
    }

    /// §5.3 timeline steps 4 and 5 for one column: sorts `items`, groups them in overlap clusters,
    /// gives each a slot, and hides what does not fit in `maxSlots`. Appends to `timed` and `overflow`.
    static func layoutColumn(_ items: [TimedWork], maxSlots: Int?, _ timed: inout [TimedItem], _ overflow: inout [TimedOverflow]) {
        var cluster: [TimedWork] = []
        var slotEnds: [Int] = []
        var clusterEnd = 0
        for var item in items.sorted(by: timedLess) {
            if !cluster.isEmpty && item.startMinute >= clusterEnd {
                flush(cluster, slotCount: slotEnds.count, maxSlots: maxSlots, &timed, &overflow)
                cluster = []
                slotEnds = []
            }
            let slot = slotEnds.firstIndex { $0 <= item.startMinute } ?? slotEnds.count
            if slot == slotEnds.count { slotEnds.append(item.effectiveEnd) } else { slotEnds[slot] = item.effectiveEnd }
            item.slot = slot
            clusterEnd = cluster.isEmpty ? item.effectiveEnd : max(clusterEnd, item.effectiveEnd)
            cluster.append(item)
        }
        flush(cluster, slotCount: slotEnds.count, maxSlots: maxSlots, &timed, &overflow)
    }

    // MARK: Agenda

    struct AgendaWork {
        let item: AgendaItem
        let order: Int
        /// 0: all-day items and middle parts; 1: parts with a start time.
        let group: Int
    }

    static func agendaLess(_ a: AgendaWork, _ b: AgendaWork) -> Bool {
        if a.group != b.group { return a.group < b.group }
        if a.group == 1, a.item.startMinute! != b.item.startMinute! { return a.item.startMinute! < b.item.startMinute! }
        return a.order < b.order
    }

    static func agendaPart(_ p: Prepared, day: Int) -> AgendaWork {
        let dayCount = p.lastDay - p.firstDay + 1
        let dayIndex = day - p.firstDay + 1
        let part: AgendaItem.Part = dayCount == 1 ? .single : dayIndex == 1 ? .first : dayIndex == dayCount ? .last : .middle
        if p.allDay || part == .middle {
            return AgendaWork(
                item: AgendaItem(key: p.key, part: part, dayIndex: dayIndex, dayCount: dayCount, startMinute: nil, endMinute: nil),
                order: p.order, group: 0)
        }
        let dayStart = day * Lay.day
        let startMinute = max(p.start, dayStart) - dayStart
        let endMinute = min(p.end, dayStart + Lay.day) - dayStart
        return AgendaWork(
            item: AgendaItem(
                key: p.key, part: part, dayIndex: dayIndex, dayCount: dayCount, startMinute: startMinute, endMinute: endMinute),
            order: p.order, group: 1)
    }
}

// MARK: - Month

extension ThirteenMonthEventLayout {
    /// The Gregorian weekday of each column of 13-month month `month` of Gregorian year `year`
    /// (7 entries, column 0 first): the weekday of month day `c + 1`, which month days `c + 8`,
    /// `c + 15` and `c + 22` share (§2.4 header line 2, §5.3 step 5). IFC October 2026: Thursday to
    /// Wednesday. TS: `monthColumnGregorianWeekdays`.
    /// - Throws: ``ThirteenError`` for an invalid year or month.
    public static func columnGregorianWeekdays(year: Int, month: Int, system: CalendarSystemID = .ifc) throws(ThirteenError)
        -> [Weekday]
    {
        try ThirteenMonthDate.monthDays(year: year, month: month, system: system).prefix(Lay.daysPerWeek).map(\.weekday)
    }

    /// Lays out `occurrences` on 13-month month `month` of Gregorian year `year` (§2.4, §5.3 "Month
    /// lanes"): bars become one item per week row (and intercalary band) they touch, clipped to it;
    /// shorter timed occurrences a dot on each day they touch. Each row (and band, with one column)
    /// sorts its items by clipped start column, bars before dots, then the order key, and gives each
    /// the lowest lane free in all of its columns. With `maxLanes`, a column whose highest lane is
    /// below `maxLanes` shows `maxLanes` lanes; otherwise `maxLanes - 1` and `hidden` counts its
    /// items with a lane of `maxLanes - 1` or more. Unlimited (`nil`): every column shows the lanes
    /// its row uses. The bands are the intercalary days with `afterMonth == month`.
    /// TS: `layoutThirteenMonthEvents`.
    /// - Throws: ``ThirteenError`` for an invalid year or month, an invalid occurrence, a repeated
    ///   key or a `maxLanes` below 1.
    public init(year: Int, month: Int, occurrences: [EventOccurrence], system: CalendarSystemID = .ifc, maxLanes: Int? = nil)
        throws(ThirteenError)
    {
        let context = "layoutThirteenMonthEvents"
        let days = try ThirteenMonthDate.monthDays(year: year, month: month, system: system)
        try Lay.checkInteger(maxLanes, "maxLanes", context, min: 1)
        let prepared = try Lay.prepare(occurrences, context)
        let firstDay = days[0].julianDayNumber

        var weeks: [MonthWeekRow] = []
        for w in 0..<Lay.weeksPerMonth {
            let rowFirst = firstDay + w * Lay.daysPerWeek
            var work: [Lay.LaneWork] = []
            for p in prepared { Lay.collectLaneItems(p, rowFirst, rowFirst + Lay.daysPerWeek - 1, withDots: true, &work) }
            let laneCount = Lay.assignLanes(&work, columnCount: Lay.daysPerWeek)
            let visibility = Lay.laneVisibility(work, columnCount: Lay.daysPerWeek, laneCount: laneCount, maxLanes: maxLanes)
            weeks.append(
                MonthWeekRow(week: w + 1, items: work.map(\.item), visibleLanes: visibility.visibleLanes, hidden: visibility.hidden))
        }

        var intercalary: [IntercalaryBand] = []
        for occurrence in IntercalaryOccurrence.unchecked(year: year, system: system) where occurrence.afterMonth == month {
            let day = occurrence.gregorian.julianDayNumber
            var work: [Lay.LaneWork] = []
            for p in prepared { Lay.collectLaneItems(p, day, day, withDots: true, &work) }
            let laneCount = Lay.assignLanes(&work, columnCount: 1)
            let visibility = Lay.laneVisibility(work, columnCount: 1, laneCount: laneCount, maxLanes: maxLanes)
            intercalary.append(
                IntercalaryBand(
                    id: occurrence.id, gregorian: occurrence.gregorian, items: work.map(\.item),
                    visibleLanes: visibility.visibleLanes[0], hidden: visibility.hidden[0]))
        }

        self.year = year
        self.month = month
        self.system = system
        self.columnGregorianWeekdays = days.prefix(Lay.daysPerWeek).map(\.weekday)
        self.weeks = weeks
        self.intercalary = intercalary
    }
}

// MARK: - Week and Day timelines

extension WeekEventLayout {
    /// Lays out the 13-month week `week` (1 to 4) of month `month` of Gregorian year `year` for Week
    /// mode (§2.5, §5.3 "Week and day timeline"): the week's 7 columns, plus for week 4 the
    /// intercalary days with `afterMonth == month`; an all-day row of bars in lanes (no lane limit);
    /// and a timeline of every shorter timed occurrence, clipped to each day it touches. Per column,
    /// items sort by start minute, then longer first, then the order key; with effective end =
    /// `max(endMinute, startMinute + minDurationMinutes)` an item joins the current cluster while it
    /// starts before the cluster's latest effective end, and takes the first slot whose last item
    /// ends (effectively) at or before its start, else a new slot. With `maxSlots`, a cluster with
    /// more slots keeps slots `0…maxSlots - 2` visible (with `slotCount = maxSlots`), hides every
    /// other item and adds one ``TimedOverflow`` in slot `maxSlots - 1`. TS: `layoutThirteenWeekEvents`.
    /// - Throws: ``ThirteenError`` for an invalid year, month or week, an invalid occurrence, a
    ///   repeated key, a `minDurationMinutes` outside 0 to 1440 or a `maxSlots` below 1.
    public init(
        year: Int, month: Int, week: Int, occurrences: [EventOccurrence], system: CalendarSystemID = .ifc,
        minDurationMinutes: Int = 15, maxSlots: Int? = nil
    ) throws(ThirteenError) {
        let context = "layoutThirteenWeekEvents"
        let days = try ThirteenMonthDate.monthDays(year: year, month: month, system: system)
        guard (1...Lay.weeksPerMonth).contains(week) else {
            throw .invalidEvent("\(context): week must be 1, 2, 3 or 4, got \(week)")
        }
        try Lay.checkInteger(minDurationMinutes, "minDurationMinutes", context, min: 0, max: Lay.day)
        try Lay.checkInteger(maxSlots, "maxSlots", context, min: 1)
        let prepared = try Lay.prepare(occurrences, context)

        var columns: [WeekColumn] = (0..<Lay.daysPerWeek).map { d in
            let day = (week - 1) * Lay.daysPerWeek + d + 1
            return .day(gregorian: days[day - 1], thirteen: ThirteenMonthDate(unchecked: system, year, month, day))
        }
        if week == Lay.weeksPerMonth {
            for occurrence in IntercalaryOccurrence.unchecked(year: year, system: system) where occurrence.afterMonth == month {
                columns.append(.intercalary(gregorian: occurrence.gregorian, thirteen: occurrence.thirteen))
            }
        }
        // The columns are consecutive days: day 28 of a month is followed by its intercalary days.
        let first = columns[0].gregorian.julianDayNumber
        let last = first + columns.count - 1

        var bars: [Lay.LaneWork] = []
        for p in prepared { Lay.collectLaneItems(p, first, last, withDots: false, &bars) }
        _ = Lay.assignLanes(&bars, columnCount: columns.count)

        var timed: [TimedItem] = []
        var overflow: [TimedOverflow] = []
        for c in columns.indices {
            let items = prepared.compactMap { Lay.timedPart($0, day: first + c, column: c, minDuration: minDurationMinutes) }
            Lay.layoutColumn(items, maxSlots: maxSlots, &timed, &overflow)
        }
        self.columns = columns
        self.allDay = bars.map(\.item)
        self.timed = timed
        self.overflow = overflow
    }
}

extension DayEventLayout {
    /// Lays out one day for Day mode (§2.6, §5.3): `allDay` lists the keys of the bars that touch
    /// `date`, in order-key order; `timed` and `overflow` are the timeline of ``WeekEventLayout``
    /// with a single column. TS: `layoutDayEvents`.
    /// - Throws: ``ThirteenError`` for an invalid occurrence, a repeated key, a
    ///   `minDurationMinutes` outside 0 to 1440 or a `maxSlots` below 1.
    public init(date: GregorianDate, occurrences: [EventOccurrence], minDurationMinutes: Int = 15, maxSlots: Int? = nil)
        throws(ThirteenError)
    {
        let context = "layoutDayEvents"
        try Lay.checkInteger(minDurationMinutes, "minDurationMinutes", context, min: 0, max: Lay.day)
        try Lay.checkInteger(maxSlots, "maxSlots", context, min: 1)
        let prepared = try Lay.prepare(occurrences, context)
        let day = date.julianDayNumber
        var allDay: [String] = []
        var items: [Lay.TimedWork] = []
        for p in prepared where p.lastDay >= day && p.firstDay <= day {
            if p.bar {
                allDay.append(p.key)
            } else {
                items.append(Lay.timedPart(p, day: day, column: 0, minDuration: minDurationMinutes)!)
            }
        }
        var timed: [TimedItem] = []
        var overflow: [TimedOverflow] = []
        Lay.layoutColumn(items, maxSlots: maxSlots, &timed, &overflow)
        self.allDay = allDay
        self.timed = timed
        self.overflow = overflow
    }
}

/// The Month chip time (§2.19). TS: `formatChipTime`.
public enum ChipTime {
    /// 24-hour `HH:MM` (`09:30`); 12-hour the hour without a leading zero, `:MM` only when the minutes
    /// are not 0, then `a` or `p` (`9:30a`, `2p`; noon `12p`, midnight `12a`).
    /// - Parameter minute: a start time, `0…1439`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for a minute outside `0…1439`.
    public static func text(minute: Int, use24Hour: Bool) throws(ThirteenError) -> String {
        guard (0..<EventTime.day).contains(minute) else {
            throw .invalidEvent("Chip time minute must be an integer 0..1439, got \(minute)")
        }
        let hour = minute / 60
        let minutes = minute % 60
        if use24Hour { return "\(Calc.pad(hour, 2)):\(Calc.pad(minutes, 2))" }
        let clockHour = hour % 12 == 0 ? 12 : hour % 12
        return "\(clockHour)\(minutes == 0 ? "" : ":\(Calc.pad(minutes, 2))")\(hour < 12 ? "a" : "p")"
    }
}

// MARK: - Agenda and Year marks

extension AgendaDay {
    /// The agenda from `from` to `to` (inclusive) for List mode, Up next and Month at accessibility
    /// sizes (§2.4, §2.7, §2.8, §5.3 "Agenda"): one ``AgendaDay`` per date that has items (every
    /// date with `includeEmptyDays`). Each occurrence appears on every day it touches as a `single`,
    /// `first`, `middle` or `last` part with its `dayIndex` of `dayCount` and its start and end
    /// minutes on that day (`nil` for all-day occurrences and middle parts). TS: `agenda`.
    /// - Throws: ``ThirteenError`` for `to` before `from`, an invalid occurrence or a repeated key.
    public static func days(
        occurrences: [EventOccurrence], from: GregorianDate, to: GregorianDate, system: CalendarSystemID = .ifc,
        includeEmptyDays: Bool = false
    ) throws(ThirteenError) -> [AgendaDay] {
        let context = "agenda"
        let first = from.julianDayNumber
        let last = to.julianDayNumber
        if last < first { throw .invalidEvent("\(context): to (\(to.isoString)) is before from (\(from.isoString))") }
        let prepared = try Lay.prepare(occurrences, context)
        var byDay: [Int: [Lay.AgendaWork]] = [:]
        for p in prepared {
            let end = min(p.lastDay, last)
            let start = max(p.firstDay, first)
            if start > end { continue }
            for day in start...end { byDay[day, default: []].append(Lay.agendaPart(p, day: day)) }
        }
        let dayNumbers = includeEmptyDays ? Array(first...last) : byDay.keys.sorted()
        return dayNumbers.map { day in
            let gregorian = GregorianDate(uncheckedJulianDayNumber: day)
            let items = (byDay[day] ?? []).sorted(by: Lay.agendaLess).map(\.item)
            return AgendaDay(gregorian: gregorian, thirteen: gregorian.thirteen(in: system), items: items)
        }
    }
}

extension YearMark {
    /// Event marks for Gregorian year `year` (§2.3, §2.4 dots density, §5.3 "Year marks"): for each
    /// day covered by at least one occurrence, ascending, the number of occurrences covering it and
    /// the distinct calendar ids of those occurrences in order-key order, at most `maxCalendars`
    /// (0 gives counts only). TS: `yearEventMarks`.
    /// - Throws: ``ThirteenError`` for an invalid year, an invalid occurrence, a repeated key or a
    ///   negative `maxCalendars`.
    public static func marks(year: Int, occurrences: [EventOccurrence], maxCalendars: Int = 3) throws(ThirteenError) -> [YearMark] {
        let context = "yearEventMarks"
        try GregorianDate.validateYear(year)
        try Lay.checkInteger(maxCalendars, "maxCalendars", context, min: 0)
        let prepared = try Lay.prepare(occurrences, context)
        let first = Calc.julianDayNumber(year, 1, 1)
        let last = Calc.julianDayNumber(year, 12, 31)
        var counts = [Int](repeating: 0, count: last - first + 1)
        var calendars = [[String]](repeating: [], count: last - first + 1)
        for p in prepared {
            let end = min(p.lastDay, last)
            let start = max(p.firstDay, first)
            if start > end { continue }
            for day in start...end {
                let index = day - first
                counts[index] += 1
                if calendars[index].count < maxCalendars
                    && !calendars[index].contains(where: { compareCodePoints($0, p.calendarID) == 0 })
                {
                    calendars[index].append(p.calendarID)
                }
            }
        }
        return counts.indices.compactMap { index in
            guard counts[index] > 0 else { return nil }
            return YearMark(
                dayOfYear: index + 1, gregorian: GregorianDate(uncheckedJulianDayNumber: first + index), count: counts[index],
                calendarIDs: calendars[index])
        }
    }
}

// MARK: - Codable (§5.5)

extension MonthItem: Codable {}

extension MonthWeekRow: Codable {}

extension IntercalaryBand: Codable {
    enum CodingKeys: String, CodingKey { case id, gregorian, items, visibleLanes, hidden }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(IntercalaryDayID.self, forKey: .id)
        gregorian = try c.decode(EventJSONDate.self, forKey: .gregorian).date
        items = try c.decode([MonthItem].self, forKey: .items)
        visibleLanes = try c.decode(Int.self, forKey: .visibleLanes)
        hidden = try c.decode(Int.self, forKey: .hidden)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(gregorian.isoString, forKey: .gregorian)
        try c.encode(items, forKey: .items)
        try c.encode(visibleLanes, forKey: .visibleLanes)
        try c.encode(hidden, forKey: .hidden)
    }
}

extension ThirteenMonthEventLayout: Codable {}

extension TimedItem: Codable {}

extension TimedOverflow: Codable {}

extension WeekColumn: Codable {
    enum CodingKeys: String, CodingKey { case kind, gregorian, thirteen }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let gregorian = try c.decode(EventJSONDate.self, forKey: .gregorian).date
        switch try c.decode(String.self, forKey: .kind) {
        case "day": self = .day(gregorian: gregorian, thirteen: try c.decode(ThirteenMonthDate.self, forKey: .thirteen))
        case "intercalary":
            self = .intercalary(gregorian: gregorian, thirteen: try c.decode(ThirteenIntercalaryDate.self, forKey: .thirteen))
        case let kind:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "week column kind must be 'day' or 'intercalary', got '\(kind)'")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .day(gregorian, thirteen):
            try c.encode("day", forKey: .kind)
            try c.encode(gregorian.isoString, forKey: .gregorian)
            try c.encode(thirteen, forKey: .thirteen)
        case let .intercalary(gregorian, thirteen):
            try c.encode("intercalary", forKey: .kind)
            try c.encode(gregorian.isoString, forKey: .gregorian)
            try c.encode(thirteen, forKey: .thirteen)
        }
    }
}

extension WeekEventLayout: Codable {}

extension DayEventLayout: Codable {}

extension AgendaItem: Codable {
    enum CodingKeys: String, CodingKey { case key, part, dayIndex, dayCount, startMinute, endMinute }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(key, forKey: .key)
        try c.encode(part, forKey: .part)
        try c.encode(dayIndex, forKey: .dayIndex)
        try c.encode(dayCount, forKey: .dayCount)
        try c.encode(startMinute, forKey: .startMinute)
        try c.encode(endMinute, forKey: .endMinute)
    }
}

extension AgendaDay: Codable {
    enum CodingKeys: String, CodingKey { case gregorian, thirteen, items }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        gregorian = try c.decode(EventJSONDate.self, forKey: .gregorian).date
        thirteen = try c.decode(ThirteenDate.self, forKey: .thirteen)
        items = try c.decode([AgendaItem].self, forKey: .items)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(gregorian.isoString, forKey: .gregorian)
        try c.encode(thirteen, forKey: .thirteen)
        try c.encode(items, forKey: .items)
    }
}

extension YearMark: Codable {
    enum CodingKeys: String, CodingKey { case dayOfYear, gregorian, count, calendarIDs = "calendarIds" }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        dayOfYear = try c.decode(Int.self, forKey: .dayOfYear)
        gregorian = try c.decode(EventJSONDate.self, forKey: .gregorian).date
        count = try c.decode(Int.self, forKey: .count)
        calendarIDs = try c.decode([String].self, forKey: .calendarIDs)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(dayOfYear, forKey: .dayOfYear)
        try c.encode(gregorian.isoString, forKey: .gregorian)
        try c.encode(count, forKey: .count)
        try c.encode(calendarIDs, forKey: .calendarIDs)
    }
}
