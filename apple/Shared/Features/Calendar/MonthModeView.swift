import SwiftUI
import ThirteenKit

// Calendar's Month mode (docs/EVENTS.md §2.4, task A5; drag and drop A6). One 13-month month as a
// 4 x 7 grid with both dates in every cell and the two-line weekday header, the intercalary band
// under week 4 (`IntercalaryEventBand`), and the events:
//   - compact width: the titles density (cells at least 60 pt wide at the default text size, up to
//     2 lanes and "+N") or the dots density (up to three dots and the count over three), and under
//     the grid the selected day's list (tap a cell to select it, tap it again to open Day; long
//     press for "New Event", "Open Day", "Day Details"; drag a row onto a cell to move it);
//   - regular width: as many lanes as fit (`maxLanes` from the cell height, 20 pt lanes scaled with
//     the text size), `09:30 Sprint planning` chips and bars across the days of a row, "+N more"
//     with its popover of the whole day, double-click (Mac) or touch and hold (iPad) on empty space
//     for a new event anchored to the cell, and dragging chips to other cells (Option copies);
//   - accessibility text sizes: the list of the month's days (`MonthDayListView`).
// Lanes come from `ThirteenMonthEventLayout`; dots from `YearMark.marks` over the page.

/// Calendar's Month mode.
struct MonthModeView: View {
    var compact = false

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let data = MonthPageData(model: model)
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                MonthDayListView(data: data)
            } else if compact {
                CompactMonthView(data: data)
            } else {
                RegularMonthView(data: data)
            }
        }
    }
}

// MARK: - Data

/// What one Month page shows: the month, its days (28, then its intercalary days), the occurrences
/// touching them (pending changes applied) and the dots of each day.
@MainActor
struct MonthPageData {
    let month: CalendarPeriod.Month
    let system: CalendarSystemID
    /// The 28 month days, then the intercalary days that follow the month.
    let days: [GregorianDate]
    let occurrences: [OccurrenceSnapshot]
    let byKey: [String: OccurrenceSnapshot]
    /// Dots and counts by Julian Day Number (`yearEventMarks` order, §2.4 dots density).
    let dots: [Int: EventDots]
    let canShowEvents: Bool

    init(model: AppModel) {
        let system = model.system
        let month = CalendarPeriod.month(of: model.calendarDate, system: system)
        let days = CalendarPeriod.monthPageDays(of: month, system: system)
        self.month = month
        self.system = system
        self.days = days
        canShowEvents = model.events.canShowEvents
        if let first = days.first, let last = days.last {
            occurrences = model.events.occurrences(from: first, through: last)
        } else {
            occurrences = []
        }
        byKey = Dictionary(occurrences.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
        var dots: [Int: EventDots] = [:]
        let marks = (try? YearMark.marks(year: month.year, occurrences: occurrences.map(\.occurrence))) ?? []
        let range = (days.first?.julianDayNumber ?? 0)...(days.last?.julianDayNumber ?? 0)
        for mark in marks where range.contains(mark.gregorian.julianDayNumber) {
            let colors = mark.calendarIDs.map { model.events.calendar(id: $0)?.info.color ?? "#8a8a8a" }
            dots[mark.gregorian.julianDayNumber] = EventDots(colors: colors, count: mark.count)
        }
        self.dots = dots
    }

    /// The month days of week row `week` (1 to 4).
    func weekDays(_ week: Int) -> [GregorianDate] {
        Array(days.dropFirst((week - 1) * 7).prefix(7))
    }

    /// The intercalary days of the page.
    var intercalaryDays: [GregorianDate] { Array(days.dropFirst(28)) }

    /// The lanes of the month (§5.3), or nil when events cannot be shown.
    func layout(maxLanes: Int?) -> ThirteenMonthEventLayout? {
        guard canShowEvents else { return nil }
        return try? ThirteenMonthEventLayout(
            year: month.year, month: month.month, occurrences: occurrences.map(\.occurrence), system: system, maxLanes: maxLanes)
    }

    /// The occurrences of one day in agenda order (all-day first, then by start, §5.3).
    func agenda(_ day: GregorianDate) -> [(occurrence: OccurrenceSnapshot, item: AgendaItem)] {
        let touching = occurrences.filter { $0.start.date <= day && CalendarText.lastDay($0) >= day }
        let days = (try? AgendaDay.days(occurrences: touching.map(\.occurrence), from: day, to: day, system: system)) ?? []
        return (days.first?.items ?? []).compactMap { item in byKey[item.key].map { ($0, item) } }
    }

    /// The keys of a day's events in agenda order (keyboard navigation, §2.21).
    func eventKeys(_ day: GregorianDate) -> [String] {
        agenda(day).map(\.occurrence.key)
    }

    /// The 13-month weekday of each column (IFC weeks start on Sunday, Positivist weeks on Monday).
    var columnWeekdays: [Weekday] {
        weekDays(1).map { ThirteenDate($0, system: system).weekday ?? $0.weekday }
    }

    /// The Gregorian weekday each column falls on this month (§2.4 header line 2).
    var columnGregorianWeekdays: [Weekday] {
        (try? ThirteenMonthEventLayout.columnGregorianWeekdays(year: month.year, month: month.month, system: system))
            ?? weekDays(1).map(\.weekday)
    }
}

// MARK: - Weekday header (§2.4)

/// The two-line weekday header: the 13-month weekday, then in Geist Mono `ink-3` the Gregorian
/// weekday the column falls on this month. Read as "Sunday. Gregorian Thursday".
struct MonthWeekdayHeader: View {
    let weekdays: [Weekday]
    let gregorian: [Weekday]
    let compact: Bool

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(zip(weekdays, gregorian).enumerated()), id: \.offset) { _, pair in
                VStack(spacing: 1) {
                    Text(pair.0.name(compact ? .narrow : .short))
                        .font(Typography.text(.caption2, weight: .semibold))
                        .foregroundStyle(Palette.inkSecondary)
                    Text(pair.1.name(compact ? .narrow : .short))
                        .font(Typography.mono(.caption2))
                        .foregroundStyle(Palette.inkTertiary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.xs)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(CalendarText.weekdayHeader(pair.0, gregorian: pair.1))
                .accessibilityAddTraits(.isHeader)
            }
        }
    }
}

// MARK: - Cell face

/// The date part of a Month cell (§2.2): the 13-month day large (Geist, tabular figures), the
/// Gregorian day small (Geist Mono, ink-3), and the Gregorian month's abbreviation as a separate
/// label above the Gregorian day where that month starts. Today keeps the accent fill on the number.
struct MonthCellDate: View {
    let day: GregorianDate
    let system: CalendarSystemID
    let isToday: Bool
    /// Regular width: the two numbers on one line (13-month left, Gregorian right).
    var regular = false

    private var number: String {
        let thirteen = ThirteenDate(day, system: system)
        return thirteen.monthDate.map { "\($0.day)" } ?? thirteen.formatted(FormatOptions(style: .short, includeYear: false))
    }

    var body: some View {
        if regular {
            HStack(alignment: .top, spacing: 2) {
                numberView
                Spacer(minLength: 0)
                gregorianView
            }
        } else {
            VStack(spacing: 0) {
                numberView
                gregorianView
            }
        }
    }

    private var numberView: some View {
        Text(number)
            .font(Typography.display(regular ? .subheadline : .callout, weight: isToday ? .bold : .semibold))
            .foregroundStyle(isToday ? Palette.onAccent : Palette.ink)
            .padding(.horizontal, isToday ? 5 : 0)
            .frame(minWidth: isToday ? 24 : 0, minHeight: isToday ? 22 : 0)
            .background {
                if isToday { Capsule().fill(Palette.accent) }
            }
    }

    private var gregorianView: some View {
        VStack(alignment: regular ? .trailing : .center, spacing: 0) {
            if day.day == 1 {
                Text(day.monthInfo.shortName.uppercased())
                    .font(Typography.font(.mono, .caption2, weight: .bold))
                    .foregroundStyle(Palette.inkTertiary)
            }
            Text("\(day.day)")
                .font(Typography.mono(.caption2))
                .foregroundStyle(Palette.inkTertiary)
        }
    }
}

// MARK: - Week rows with items

/// A bar or chip segment of a row: the columns it covers in one run of visible lanes.
private struct MonthSegment: Identifiable {
    let item: MonthItem
    let start: Int
    let end: Int
    let notchLeading: Bool
    let notchTrailing: Bool
    var id: String { "\(item.key)-\(start)" }

    /// The visible runs of each item (an item is drawn in the columns whose visible lanes include
    /// its lane, §5.3).
    static func segments(_ items: [MonthItem], visibleLanes: (Int) -> Int) -> [MonthSegment] {
        var out: [MonthSegment] = []
        for item in items {
            var runStart: Int?
            for column in item.startColumn...item.endColumn {
                let visible = item.lane < visibleLanes(column)
                if visible && runStart == nil { runStart = column }
                if !visible || column == item.endColumn, let start = runStart {
                    let end = visible ? column : column - 1
                    out.append(
                        MonthSegment(
                            item: item, start: start, end: end, notchLeading: start == item.startColumn && item.continuesBefore,
                            notchTrailing: end == item.endColumn && item.continuesAfter))
                    runStart = nil
                }
            }
        }
        return out
    }
}

/// Sizes of a Month row.
struct MonthRowMetrics {
    var columnWidth: CGFloat
    var rowHeight: CGFloat
    var headerHeight: CGFloat
    var laneHeight: CGFloat
}

/// One week row (or an intercalary band's items): the cells behind, then the bars and chips in
/// their lanes, then "+N" where a column hides items.
private struct MonthItemsOverlay: View {
    let segments: [MonthSegment]
    /// Per column: the lane holding "+N", and how many items it stands for.
    let more: [(column: Int, lane: Int, hidden: Int)]
    let data: MonthPageData
    let metrics: MonthRowMetrics
    let days: [GregorianDate]
    let compact: Bool
    let rowYear: Int
    var originX: CGFloat = 0

    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(segments) { segment in
                if let occurrence = data.byKey[segment.item.key] {
                    chip(segment, occurrence)
                        .frame(width: max(0, CGFloat(segment.end - segment.start + 1) * metrics.columnWidth - 3), height: metrics.laneHeight - 2)
                        .offset(
                            x: originX + CGFloat(segment.start) * metrics.columnWidth + 1.5,
                            y: metrics.headerHeight + CGFloat(segment.item.lane) * metrics.laneHeight)
                }
            }
            ForEach(more, id: \.column) { entry in
                MonthMoreButton(day: days[entry.column], hidden: entry.hidden, compact: compact, data: data)
                    .frame(width: metrics.columnWidth - 3, height: metrics.laneHeight - 2, alignment: .leading)
                    .offset(
                        x: originX + CGFloat(entry.column) * metrics.columnWidth + 1.5, y: metrics.headerHeight + CGFloat(entry.lane) * metrics.laneHeight)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder private func chip(_ segment: MonthSegment, _ occurrence: OccurrenceSnapshot) -> some View {
        let view = EventChipView(
            occurrence: occurrence, hex: calendarHex(model, occurrence), isBar: segment.item.style == .bar,
            continuesBefore: segment.notchLeading, continuesAfter: segment.notchTrailing, showsTime: !compact,
            isSelected: !compact && model.selectedEventKey == occurrence.key)
        if compact {
            // Phones: the cells are the targets; the day list holds the events (§2.20 Targets).
            view.allowsHitTesting(false).accessibilityHidden(true)
        } else {
            MonthChipInteraction(occurrence: occurrence, rowYear: rowYear, segment: segment) { view }
        }
    }
}

/// A regular-width chip's interactions (§2.4): Mac click selects and double-click opens details;
/// iPad tap opens details; touch and hold or a pointer drag moves it (Option copies); a context menu
/// with Open, Duplicate and Delete. VoiceOver reaches the events through the cell's actions and the
/// "Events" rotor, so chips are hidden from it.
private struct MonthChipInteraction<Content: View>: View {
    let occurrence: OccurrenceSnapshot
    let rowYear: Int
    let segment: MonthSegment
    @ViewBuilder var content: Content

    @Environment(AppModel.self) private var model

    var body: some View {
        content
            .contentShape(.rect)
            #if os(macOS)
            .onTapGesture(count: 2) { model.openEvent(key: occurrence.key) }
            .simultaneousGesture(TapGesture().onEnded { model.selectedEventKey = occurrence.key })
            #else
            .onTapGesture { model.openEvent(key: occurrence.key) }
            #endif
            .eventDraggable(occurrence)
            .eventContextMenu(occurrence)
            .eventPopoverAnchor(.event(occurrence.key))
            .help(segment.item.style == .bar
                ? CalendarText.bar(occurrence, calendar: calendarName(model, occurrence), rowYear: rowYear)
                : CalendarText.item(occurrence, calendar: calendarName(model, occurrence)))
            .accessibilityHidden(true)
    }
}

extension View {
    /// The context menu of an event item on the Mac (right-click). On iPhone and iPad touch and hold
    /// on a chip, row or block starts its drag (§2.4 iPad by touch, §2.6, §6.2), so there is no item
    /// menu there: a menu would take the long press, and sliding on to "Delete" deleted the event.
    /// Details (a tap) has Duplicate and Delete.
    @ViewBuilder func eventContextMenu(_ occurrence: OccurrenceSnapshot) -> some View {
        #if os(macOS)
        contextMenu { EventItemMenu(occurrence: occurrence) }
        #else
        self
        #endif
    }
}

/// The context menu of an event (chips, rows, blocks): Open, Duplicate, and Delete when writable.
struct EventItemMenu: View {
    let occurrence: OccurrenceSnapshot

    @Environment(AppModel.self) private var model

    var body: some View {
        Button("Open", systemImage: "info.circle") { model.openEvent(key: occurrence.key) }
        Button("Duplicate", systemImage: "plus.square.on.square") { Task { await model.duplicateEvent(key: occurrence.key) } }
        if occurrence.readOnly == nil {
            Divider()
            Button("Delete", systemImage: "trash", role: .destructive) {
                Task { await model.requestDelete(key: occurrence.key, undoManager: model.undoManager) }
            }
        }
    }
}

/// "+N more" (regular) or "+N" (compact titles density); regular width opens the popover of the
/// whole day (§2.4), compact width only shows the count (the cell opens the day list).
private struct MonthMoreButton: View {
    let day: GregorianDate
    let hidden: Int
    let compact: Bool
    let data: MonthPageData

    @State private var showsPopover = false
    @Environment(AppModel.self) private var model

    var body: some View {
        if compact {
            Text("+\(hidden)")
                .font(Typography.mono(.caption2, weight: .medium))
                .foregroundStyle(Palette.inkSecondary)
                .padding(.leading, 3)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        } else {
            Button {
                showsPopover = true
            } label: {
                Text(CalendarText.more(hidden))
                    .font(Typography.mono(.caption2, weight: .medium))
                    .foregroundStyle(Palette.inkSecondary)
                    .padding(.leading, 3)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CalendarText.moreA11y(hidden, day: day, system: data.system))
            .popover(isPresented: $showsPopover, arrowEdge: .trailing) {
                DayEventsPopover(
                    day: day, entries: data.agenda(day).map { ($0.occurrence, Optional($0.item)) }, system: data.system,
                    close: { showsPopover = false }
                )
                .environment(model)
            }
        }
    }
}

/// The "+N more" popover (§2.4): titled with the day (`Thursday, October 12` + `Gregorian Mon, Oct
/// 19`), listing the whole day in the rows of the compact day list (44 pt rows); rows open details,
/// can be dragged onto the grid, and take Delete. A row closes the list first (`close`) and opens
/// the details once it has gone: UIKit refuses a presentation from a view controller that is still
/// presenting the list. The details of an event hidden in the overflow have no chip of their own,
/// so they anchor to the day (`AppModel.openEvent(key:anchorDay:)`: its Month cell, else a sheet).
struct DayEventsPopover: View {
    let day: GregorianDate
    let entries: [(occurrence: OccurrenceSnapshot, item: AgendaItem?)]
    let system: CalendarSystemID
    var title: String?
    /// Closes the popover or sheet that shows this list.
    var close: (() -> Void)?

    /// The event whose details open once this list has gone.
    @State private var opening: String?

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .footnote) private var timeWidth: CGFloat = EventFormat.uses24HourClock ? 60 : 70

    var body: some View {
        // At accessibility sizes the list is a sheet (§2.20 Text size), which it fills.
        let inSheet = dynamicTypeSize.isAccessibilitySize
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title ?? CalendarText.dayTitle(day, system: system))
                    .font(Typography.text(.headline))
                    .foregroundStyle(Palette.ink)
                    .accessibilityAddTraits(.isHeader)
                if title == nil {
                    Text(CalendarText.dayGregorianLine(day))
                        .font(Typography.mono(.caption))
                        .foregroundStyle(Palette.inkTertiary)
                }
            }
            .padding(.bottom, Spacing.s)
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(entries, id: \.occurrence.key) { entry in
                        Button {
                            open(entry.occurrence.key)
                        } label: {
                            CalendarEventRow(occurrence: entry.occurrence, item: entry.item, timeWidth: timeWidth, labelForm: .item)
                        }
                        .buttonStyle(.plain)
                        .eventDraggable(entry.occurrence)
                        .eventContextMenu(entry.occurrence)
                        Divider().overlay(Palette.rule)
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .padding(Spacing.l)
        .frame(minWidth: 280, idealWidth: 300, maxWidth: inSheet ? .infinity : 360, maxHeight: inSheet ? .infinity : 480)
        .background(Palette.paperRaised)
        .presentationCompactAdaptation(inSheet ? .sheet : .popover)
        .onDisappear {
            // The list has gone: now the details can be presented.
            guard let key = opening else { return }
            opening = nil
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(100))
                model.openEvent(key: key, anchorDay: day)
            }
        }
    }

    private func open(_ key: String) {
        guard let close else {
            model.openEvent(key: key, anchorDay: day)
            return
        }
        opening = key
        close()
    }
}

// MARK: - The "Events" rotor (§2.20 Grouping)

/// The month's events for the VoiceOver rotor "Events": each event once, on the first day of the
/// page it touches, named like its chip or bar; choosing an entry moves VoiceOver to that day's
/// cell, whose custom actions open the events. Swiping through the month stays one stop per day.
/// One entry per day, naming the day's events in order: entries that share a target cell trapped
/// the rotor on the first such day ("next" kept returning the same cell; task A10's in-app probe,
/// `-ThirteenQAAccessibilityProbe`), so a day's events are read together.
struct MonthRotorEntry: Identifiable {
    let id: Int
    let label: String
    let day: GregorianDate

    @MainActor
    static func entries(_ data: MonthPageData, model: AppModel) -> [MonthRotorEntry] {
        var seen = Set<String>()
        var out: [MonthRotorEntry] = []
        for day in data.days {
            var labels: [String] = []
            for (occurrence, _) in data.agenda(day) where seen.insert(occurrence.key).inserted {
                let calendar = calendarName(model, occurrence)
                let multiDay = CalendarText.lastDay(occurrence) > occurrence.start.date
                labels.append(
                    occurrence.allDay || multiDay
                        ? CalendarText.bar(occurrence, calendar: calendar, rowYear: day.year)
                        : CalendarText.item(occurrence, calendar: calendar))
            }
            if !labels.isEmpty {
                out.append(MonthRotorEntry(id: day.julianDayNumber, label: labels.joined(separator: ". "), day: day))
            }
        }
        return out
    }
}

extension EnvironmentValues {
    /// The namespace of the Month grid's rotor targets (the day cells).
    @Entry var monthRotorNamespace: Namespace.ID?
}

extension View {
    /// The "Events" rotor over a Month grid (§2.20).
    func monthEventsRotor(_ data: MonthPageData, model: AppModel, namespace: Namespace.ID) -> some View {
        accessibilityRotor("Events") {
            ForEach(MonthRotorEntry.entries(data, model: model)) { entry in
                AccessibilityRotorEntry(Text(verbatim: entry.label), id: entry.day.julianDayNumber, in: namespace)
            }
        }
    }

    /// Marks a Month cell as the target of its events' rotor entries.
    @ViewBuilder func monthRotorTarget(_ day: GregorianDate, in namespace: Namespace.ID?) -> some View {
        if let namespace {
            accessibilityRotorEntry(id: day.julianDayNumber, in: namespace)
        } else {
            self
        }
    }
}

// MARK: - Cells

/// The interactions of a Month cell's empty space (§2.4): tap selects (compact: a second tap opens
/// Day); double-click (Mac) or touch and hold (iPad) makes a new event draft for the day, anchored to
/// the cell; the context menu (compact long press, Mac right click) offers "New Event", "Open Day"
/// and "Day Details". VoiceOver reads the cell's dates and event count, offers its events as custom
/// actions ("Open {title}") and pages with the paging actions.
private struct MonthCellInteraction: ViewModifier {
    let day: GregorianDate
    let label: String
    let events: [OccurrenceSnapshot]
    let compact: Bool

    @Environment(AppModel.self) private var model
    @Environment(\.monthRotorNamespace) private var rotorNamespace

    private var isSelected: Bool { model.calendarDate == day }

    func body(content: Content) -> some View {
        content
            .contentShape(.rect)
            // The new event's editor (and an Option-drag copy's) is a popover on the cell (§2.4).
            .eventPopoverAnchor(.day(day))
            #if os(macOS)
            .onTapGesture(count: 2) { newEvent() }
            .simultaneousGesture(TapGesture().onEnded { select() })
            .contextMenu { menu }
            #else
            .onTapGesture { select() }
            .modifier(TouchAndHold(compact: compact, newEvent: newEvent, menu: { menu }))
            #endif
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityValue(day == model.today ? "Today" : "")
            .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
            .accessibilityAction { select() }
            .accessibilityActions {
                // SwiftUI on iOS 26 lists a view's custom actions in the reverse of their
                // declaration (measured with `-ThirteenQAAccessibilityProbe`, task A10), so they
                // are declared reversed there: VoiceOver then offers the day's events in the
                // day's order, then "New Event".
                #if os(iOS)
                if model.events.showsEvents {
                    Button("New Event") { newEvent() }
                }
                ForEach(Array(events.reversed())) { occurrence in
                    Button("Open \(occurrence.title)") { model.openEvent(key: occurrence.key) }
                }
                #else
                ForEach(events) { occurrence in
                    Button("Open \(occurrence.title)") { model.openEvent(key: occurrence.key) }
                }
                if model.events.showsEvents {
                    Button("New Event") { newEvent() }
                }
                #endif
            }
            .monthRotorTarget(day, in: rotorNamespace)
    }

    @ViewBuilder private var menu: some View {
        if model.events.showsEvents {
            Button("New Event", systemImage: "plus") { newEvent() }
        }
        Button("Open Day", systemImage: "calendar.day.timeline.left") { openDay() }
        Button("Day Details", systemImage: "info.circle") { model.showDetail(day) }
    }

    private func select() {
        if compact && isSelected {
            openDay()
        } else {
            model.calendarDate = day
        }
    }

    private func openDay() {
        model.calendarDate = day
        model.calendarMode = .day
    }

    private func newEvent() {
        model.calendarDate = day
        Task { await model.newEvent(on: day, anchor: compact ? .none : .day(day)) }
    }
}

#if os(iOS)
/// iOS: compact cells show the context menu on long press; on iPad by touch, touch and hold on a
/// cell's empty space makes the draft instead (§2.4).
private struct TouchAndHold<Menu: View>: ViewModifier {
    let compact: Bool
    let newEvent: () -> Void
    @ViewBuilder let menu: () -> Menu

    func body(content: Content) -> some View {
        if compact {
            content.contextMenu { menu() }
        } else {
            content.onLongPressGesture(minimumDuration: 0.5) { newEvent() }
        }
    }
}
#endif

/// One Month cell's face (background, dates, and in the dots density the dots and count).
private struct MonthCellFace: View {
    let day: GregorianDate
    let data: MonthPageData
    let density: MonthDensity
    let compact: Bool
    let isTargeted: Bool

    @Environment(AppModel.self) private var model

    var body: some View {
        let isToday = day == model.today
        let isSelected = model.calendarDate == day
        VStack(spacing: 2) {
            MonthCellDate(day: day, system: data.system, isToday: isToday, regular: !compact)
            if density == .dots, let dots = data.dots[day.julianDayNumber] {
                HStack(spacing: 2) {
                    EventDotRow(dots: dots, size: 6)
                    if dots.count > 3 {
                        Text("\(dots.count)")
                            .font(Typography.mono(.caption2))
                            .foregroundStyle(Palette.inkSecondary)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, compact ? 1 : 5)
        .padding(.top, compact ? 5 : 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background {
            Rectangle().fill(isTargeted ? Palette.accentWash : isSelected ? Palette.accentWash.opacity(compact ? 1 : 0.7) : ThemeColor.clear)
        }
        // Column rules at every width (boards A1 and A2); the last column's falls on the edge.
        .overlay(alignment: .trailing) { Rectangle().fill(Palette.rule).frame(width: 1) }
    }
}

/// A week row of the grid: 7 cells with the row's items over them; the whole row is the drop
/// destination of dragged events (the column under the drop is the day).
private struct MonthWeekRowView: View {
    let days: [GregorianDate]
    let row: MonthWeekRow?
    let data: MonthPageData
    let density: MonthDensity
    let compact: Bool
    let metrics: MonthRowMetrics

    @Environment(AppModel.self) private var model
    @Environment(EventMoveFlow.self) private var flow
    @State private var targetColumn: Int?

    var body: some View {
        ZStack(alignment: .topLeading) {
            HStack(spacing: 0) {
                ForEach(Array(days.enumerated()), id: \.offset) { column, day in
                    let events = data.agenda(day).map(\.occurrence)
                    MonthCellFace(day: day, data: data, density: density, compact: compact, isTargeted: targetColumn == column)
                        .frame(width: metrics.columnWidth, height: metrics.rowHeight)
                        .modifier(
                            MonthCellInteraction(
                                day: day, label: CalendarText.cell(day, system: data.system, eventCount: data.dots[day.julianDayNumber]?.count ?? 0),
                                events: events, compact: compact))
                }
            }
            if density == .titles, let row {
                MonthItemsOverlay(
                    segments: MonthSegment.segments(row.items) { row.visibleLanes[$0] },
                    more: (0..<7).compactMap { column in
                        row.hidden[column] > 0 ? (column, row.visibleLanes[column], row.hidden[column]) : nil
                    },
                    data: data, metrics: metrics, days: days, compact: compact, rowYear: days.first?.year ?? data.month.year)
                    .frame(width: metrics.columnWidth * 7, height: metrics.rowHeight)
            }
        }
        .frame(width: metrics.columnWidth * 7, height: metrics.rowHeight, alignment: .topLeading)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.rule).frame(height: 1) }
        .dropDestination(for: EventDragItem.self) { items, session in
            targetColumn = nil
            guard let item = items.first else { return }
            let column = min(max(Int(session.location.x / max(metrics.columnWidth, 1)), 0), days.count - 1)
            let copy = DropModifiers.optionHeld
            Task { await flow.drop(key: item.key, at: .day(days[column]), copy: copy) }
        }
        .onDropHover { location in
            targetColumn = location.map { min(max(Int($0.x / max(metrics.columnWidth, 1)), 0), days.count - 1) }
        }
    }
}

// MARK: - Intercalary band (§2.2)

/// An intercalary day as a full-width band under week 4 (§2.2): the code plate (`YD`, `LD`), the
/// day's name and Gregorian date, "No weekday", a hatch, and that day's events inline in the
/// screen's density. It is a drop destination like a cell.
struct IntercalaryEventBand: View {
    let day: GregorianDate
    let band: IntercalaryBand?
    let data: MonthPageData
    let density: MonthDensity
    let compact: Bool
    let width: CGFloat
    let laneHeight: CGFloat

    @Environment(AppModel.self) private var model
    @Environment(EventMoveFlow.self) private var flow
    @Environment(\.appTheme) private var theme
    @State private var isTargeted = false

    private var labelWidth: CGFloat { compact ? min(width * 0.42, 150) : min(200, width * 0.25) }

    var body: some View {
        let thirteen = ThirteenDate(day, system: data.system)
        let info = thirteen.intercalaryDate?.info
        let lanes = band.map { $0.visibleLanes + ($0.hidden > 0 ? 1 : 0) } ?? 0
        let itemsHeight = density == .titles ? CGFloat(max(lanes, 1)) * laneHeight + 6 : 0
        let isSelected = model.calendarDate == day
        HStack(alignment: .top, spacing: Spacing.s) {
            HStack(alignment: .top, spacing: Spacing.s) {
                Text(info?.code ?? "")
                    .font(Typography.mono(.caption2, weight: .bold))
                    .foregroundStyle(day == model.today ? Palette.onAccent : Palette.accentText)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 2)
                    .background(day == model.today ? Palette.accent : Palette.accentWash, in: .rect(cornerRadius: 4))
                VStack(alignment: .leading, spacing: 1) {
                    Text(EventFormat.date(day, system: data.system))
                        .font(Typography.text(.footnote, weight: .semibold))
                        .foregroundStyle(Palette.ink)
                    Text(CalendarText.dayGregorianLine(day))
                        .font(Typography.mono(.caption2))
                        .foregroundStyle(Palette.inkTertiary)
                    Text("No weekday")
                        .font(Typography.mono(.caption2))
                        .foregroundStyle(Palette.inkTertiary)
                    if density == .dots, let dots = data.dots[day.julianDayNumber] {
                        HStack(spacing: 2) {
                            EventDotRow(dots: dots, size: 6)
                            if dots.count > 3 {
                                Text("\(dots.count)").font(Typography.mono(.caption2)).foregroundStyle(Palette.inkSecondary)
                            }
                        }
                        .padding(.top, 2)
                    }
                }
            }
            .frame(width: density == .titles ? labelWidth : nil, alignment: .leading)
            .frame(maxWidth: density == .titles ? nil : .infinity, alignment: .leading)
            .modifier(
                MonthCellInteraction(
                    day: day, label: CalendarText.band(day, system: data.system, eventCount: data.dots[day.julianDayNumber]?.count ?? 0),
                    events: data.agenda(day).map(\.occurrence), compact: compact))
            if density == .titles, let band {
                let itemWidth = max(width - labelWidth - 3 * Spacing.s, 40)
                MonthItemsOverlay(
                    segments: MonthSegment.segments(band.items) { _ in band.visibleLanes },
                    more: band.hidden > 0 ? [(0, band.visibleLanes, band.hidden)] : [],
                    data: data, metrics: MonthRowMetrics(columnWidth: itemWidth, rowHeight: itemsHeight, headerHeight: 0, laneHeight: laneHeight),
                    days: [day], compact: compact, rowYear: day.year)
                    .frame(width: itemWidth, height: itemsHeight)
            }
        }
        .padding(Spacing.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack {
                Rectangle().fill(isTargeted || isSelected ? Palette.accentWash : Palette.paperSunk.opacity(0.5))
                Rectangle().fill(Hatch.paint(line: Palette.accent.color(for: theme).opacity(0.18), wash: .clear))
            }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.rule).frame(height: 1) }
        .dropDestination(for: EventDragItem.self) { items, _ in
            isTargeted = false
            guard let item = items.first else { return }
            let copy = DropModifiers.optionHeld
            Task { await flow.drop(key: item.key, at: .day(day), copy: copy) }
        }
        .onDropHover { isTargeted = $0 != nil }
    }
}

// MARK: - Compact width

/// iPhone (and iPad at compact width): the grid in the titles or dots density and the selected
/// day's list under it.
private struct CompactMonthView: View {
    let data: MonthPageData

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var width: CGFloat = 390
    @ScaledMetric(relativeTo: .caption2) private var laneHeight: CGFloat = 16
    @Namespace private var rotorNamespace

    var body: some View {
        let columnWidth = max(width / 7, 1)
        let density = MonthDensity.choose(compact: true, cellWidth: columnWidth, textSizeAtMostDefault: dynamicTypeSize <= .large)
        let layout = data.layout(maxLanes: 2)
        let header: CGFloat = 40
        let rowHeight: CGFloat = density == .titles ? header + 2 * laneHeight + 6 : 58
        ScrollView {
            VStack(spacing: 0) {
                MonthWeekdayHeader(weekdays: data.columnWeekdays, gregorian: data.columnGregorianWeekdays, compact: true)
                    .overlay(alignment: .bottom) { Rectangle().fill(Palette.rule).frame(height: 1) }
                VStack(spacing: 0) {
                    ForEach(1...4, id: \.self) { week in
                        MonthWeekRowView(
                            days: data.weekDays(week), row: layout?.weeks[week - 1], data: data, density: density, compact: true,
                            metrics: MonthRowMetrics(columnWidth: columnWidth, rowHeight: rowHeight, headerHeight: header, laneHeight: laneHeight))
                    }
                    ForEach(Array(data.intercalaryDays.enumerated()), id: \.offset) { index, day in
                        IntercalaryEventBand(
                            day: day, band: layout?.intercalary[safe: index], data: data, density: density, compact: true, width: width,
                            laneHeight: laneHeight)
                    }
                }
                .calendarPaging(model, unit: .month)
                .calendarKeyboard(model, weekStep: 7) { data.eventKeys($0) }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(CalendarPeriod.title(mode: .month, date: model.calendarDate, system: data.system))
                .monthEventsRotor(data, model: model, namespace: rotorNamespace)
                .environment(\.monthRotorNamespace, rotorNamespace)
                MonthSelectedDayList(day: model.calendarDate, data: data)
                    .padding(.top, Spacing.m)
            }
            .readWidth(into: $width)
        }
        .background(Palette.paper)
    }
}

/// The selected day's list under the compact grid (§2.4): the day header (`Thursday, October 12`
/// + `Gregorian Mon, Oct 19`) with a chevron that opens Day and "+" for a new event that day; the
/// rows (all-day, then timed in start order), each opening details and draggable onto a cell; the
/// empty, hidden-calendars and access states.
private struct MonthSelectedDayList: View {
    let day: GregorianDate
    let data: MonthPageData

    @Environment(AppModel.self) private var model
    @ScaledMetric(relativeTo: .footnote) private var timeWidth: CGFloat = EventFormat.uses24HourClock ? 60 : 70

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CalendarAccessBanner()
                .padding(.horizontal, Spacing.l)
                .padding(.bottom, model.events.accessCard == nil ? 0 : Spacing.m)
            HStack(alignment: .center, spacing: Spacing.s) {
                Button {
                    model.calendarDate = day
                    model.calendarMode = .day
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(CalendarText.dayTitle(day, system: data.system))
                            .font(Typography.text(.headline))
                            .foregroundStyle(Palette.ink)
                        Text(CalendarText.dayGregorianLine(day))
                            .font(Typography.mono(.caption))
                            .foregroundStyle(Palette.inkTertiary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isHeader)
                .accessibilityHint("Opens the day")
                if model.events.showsEvents {
                    Button {
                        Task { await model.newEvent(on: day) }
                    } label: {
                        Image(systemName: "plus").font(.body.weight(.semibold)).frame(width: 44, height: 44).contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Palette.accentText)
                    .accessibilityLabel("New Event")
                }
                Button {
                    model.calendarDate = day
                    model.calendarMode = .day
                } label: {
                    Image(systemName: "chevron.right").font(.body.weight(.semibold)).frame(width: 44, height: 44).contentShape(.rect)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.accentText)
                .accessibilityLabel("Open Day")
            }
            .padding(.leading, Spacing.l)
            .padding(.trailing, Spacing.xs)
            Divider().overlay(Palette.rule)
            rows
                .padding(.horizontal, Spacing.l)
        }
        .padding(.bottom, Spacing.xl)
    }

    @ViewBuilder private var rows: some View {
        if model.events.allCalendarsHidden {
            AllCalendarsHiddenLine().padding(.vertical, Spacing.m)
        } else if model.events.canShowEvents {
            let entries = data.agenda(day)
            if entries.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.s) {
                    Text("No events.")
                        .font(Typography.text(.body))
                        .foregroundStyle(Palette.inkSecondary)
                    Button("New Event") { Task { await model.newEvent(on: day) } }
                        .buttonStyle(.borderless)
                        .foregroundStyle(Palette.accentText)
                }
                .padding(.vertical, Spacing.m)
            } else {
                let now = model.events.now()
                ForEach(entries, id: \.occurrence.key) { entry in
                    Button {
                        model.openEvent(key: entry.occurrence.key)
                    } label: {
                        CalendarEventRow(
                            occurrence: entry.occurrence, item: entry.item, timeWidth: timeWidth,
                            isNow: !entry.occurrence.allDay && entry.occurrence.start <= now && now < entry.occurrence.end, labelForm: .item)
                    }
                    .buttonStyle(.plain)
                    // Moving an event on a phone starts from this list: long press a row, then drop
                    // it on a cell (§2.4).
                    .eventDraggable(entry.occurrence)
                    .eventContextMenu(entry.occurrence)
                    Divider().overlay(Palette.rule)
                }
            }
        }
    }
}

// MARK: - Regular width

/// iPad and Mac: the full-size grid with as many lanes as fit, "+N more" popovers, and the access
/// card as a top banner.
private struct RegularMonthView: View {
    let data: MonthPageData

    @Environment(AppModel.self) private var model
    @ScaledMetric(relativeTo: .caption2) private var laneHeight: CGFloat = 20
    @ScaledMetric(relativeTo: .subheadline) private var headerHeight: CGFloat = 30
    @Namespace private var rotorNamespace

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let bandCount = data.intercalaryDays.count
            let bandHeight = headerHeight + 2 * laneHeight + 4
            let banner: CGFloat = 0
            let available = proxy.size.height - 40 - CGFloat(bandCount) * bandHeight - banner
            let rowHeight = max(available / 4, headerHeight + 2 * laneHeight + 4)
            let maxLanes = MonthDensity.lanes(cellHeight: rowHeight, headerHeight: headerHeight, laneHeight: laneHeight)
            let layout = data.layout(maxLanes: maxLanes)
            let bandLayout = data.layout(maxLanes: 2)
            let columnWidth = max(width / 7, 1)
            ScrollView {
                VStack(spacing: 0) {
                    if model.events.accessCard != nil || model.events.allCalendarsHidden {
                        VStack(alignment: .leading) {
                            CalendarAccessBanner()
                            if model.events.allCalendarsHidden { AllCalendarsHiddenLine() }
                        }
                        .padding(Spacing.m)
                    }
                    MonthWeekdayHeader(weekdays: data.columnWeekdays, gregorian: data.columnGregorianWeekdays, compact: false)
                        .frame(height: 40)
                        .overlay(alignment: .bottom) { Rectangle().fill(Palette.rule).frame(height: 1) }
                    VStack(spacing: 0) {
                        ForEach(1...4, id: \.self) { week in
                            MonthWeekRowView(
                                days: data.weekDays(week), row: layout?.weeks[week - 1], data: data, density: .titles, compact: false,
                                metrics: MonthRowMetrics(columnWidth: columnWidth, rowHeight: rowHeight, headerHeight: headerHeight, laneHeight: laneHeight))
                        }
                        ForEach(Array(data.intercalaryDays.enumerated()), id: \.offset) { index, day in
                            IntercalaryEventBand(
                                day: day, band: bandLayout?.intercalary[safe: index], data: data, density: .titles, compact: false, width: width,
                                laneHeight: laneHeight)
                        }
                    }
                    .calendarPaging(model, unit: .month)
                    .calendarKeyboard(model, weekStep: 7) { data.eventKeys($0) }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(CalendarPeriod.title(mode: .month, date: model.calendarDate, system: data.system))
                    .monthEventsRotor(data, model: model, namespace: rotorNamespace)
                    .environment(\.monthRotorNamespace, rotorNamespace)
                }
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(Palette.paperRaised)
    }
}

extension Array {
    /// The element at `index`, or nil outside the array.
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
