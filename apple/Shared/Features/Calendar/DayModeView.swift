import SwiftUI
import ThirteenKit

// Calendar's Day mode (docs/EVENTS.md §2.6, board J1, task A6). A header strip with the day's
// 13-month week as small day buttons (on an intercalary day: the week before it plus the day), the
// all-day row, and the timeline of Week with one column (`layoutDayEvents`, `maxSlots` = floor(column
// width / 64 pt)). On phones a swipe or the paging actions change the day, and touch and hold on
// empty time opens the editor on a one-hour draft at that half hour (a tap on empty time does
// nothing); blocks can be long-pressed and dragged. Regular width adds a details panel on the
// right: the selected event's summary, or the day's comparison when nothing is selected.

/// Calendar's Day mode.
struct DayModeView: View {
    var compact = false

    @Environment(AppModel.self) private var model
    /// The size of the time axis labels (caption 2 at the current text size).
    @ScaledMetric(relativeTo: .caption2) private var labelSize: CGFloat = Typography.baseSize(.caption2)
    @ScaledMetric(relativeTo: .body) private var hourHeight: CGFloat = 48

    /// The time axis's width: the boards' 52 pt, scaled, or more for the widest hour and now labels in
    /// the OS clock form (`12:00 PM` in 12-hour locales, §2.5).
    private var gutter: CGFloat { TimelineAxis.width(labelSize: labelSize) }

    var body: some View {
        let day = model.calendarDate
        let occurrences = model.events.occurrences(on: day)
        let byKey = Dictionary(occurrences.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
        VStack(spacing: 0) {
            if model.events.accessCard != nil || model.events.allCalendarsHidden {
                VStack(alignment: .leading) {
                    CalendarAccessBanner()
                    if model.events.allCalendarsHidden { AllCalendarsHiddenLine() }
                }
                .padding(Spacing.m)
            }
            if ThirteenDate(day, system: model.system).isIntercalary { DayNoWeekdayPlate(day: day) }
            DayWeekStrip(day: day)
            GeometryReader { proxy in
                let showsPanel = !compact && proxy.size.width >= 720
                let panelWidth: CGFloat = showsPanel ? min(360, proxy.size.width * 0.36) : 0
                let columnWidth = max(proxy.size.width - panelWidth - gutter, 1)
                let layout = try? DayEventLayout(
                    date: day, occurrences: occurrences.map(\.occurrence),
                    maxSlots: TimelineMetrics.maxSlots(columnWidth: columnWidth, minimumSlotWidth: 64))
                let columns = [TimelineColumn(index: 0, day: day, x: 0, width: columnWidth, isIntercalary: false)]
                let first = layout?.timed.filter { !$0.hidden }.map(\.startMinute).min()
                HStack(spacing: 0) {
                    VStack(spacing: 0) {
                        DayAllDayList(day: day, keys: layout?.allDay ?? [], byKey: byKey, gutter: gutter)
                        EventTimeline(
                            columns: columns, timed: layout?.timed ?? [], overflow: layout?.overflow ?? [], byKey: byKey, gutter: gutter,
                            metrics: TimelineMetrics(hourHeight: hourHeight), initialMinute: TimelineMetrics.initialMinute(firstEvent: first),
                            pageID: day.julianDayNumber)
                    }
                    .frame(width: proxy.size.width - panelWidth)
                    if showsPanel {
                        Divider().overlay(Palette.rule)
                        DayDetailsPanel(day: day, occurrences: occurrences)
                            .frame(width: panelWidth - 1)
                    }
                }
            }
        }
        .background(Palette.paperRaised)
        .calendarPaging(model, unit: .day)
    }
}

/// The header strip (§2.6): the 13-month week of the day as small day buttons (plus intercalary
/// days), the selected one filled, each with its Gregorian day under it.
/// The "No weekday" plate under the title of an intercalary day (§2.1 Titles, Day: "`Year Day
/// 2026` (with a 'No weekday' plate)"), drawn like the Month band's code plate (`picker.noWeekday`).
private struct DayNoWeekdayPlate: View {
    let day: GregorianDate

    @Environment(AppModel.self) private var model

    var body: some View {
        let thirteen = ThirteenDate(day, system: model.system)
        HStack(spacing: Spacing.s) {
            Text(thirteen.intercalaryDate?.info.code ?? "")
                .font(Typography.mono(.caption2, weight: .bold))
                .foregroundStyle(Palette.accentText)
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .background(Palette.accentWash, in: .rect(cornerRadius: 4))
                .accessibilityHidden(true)
            Text(EditorCopy.pickerNoWeekday)
                .font(Typography.mono(.caption, weight: .medium))
                .foregroundStyle(Palette.inkSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Spacing.l)
        .padding(.top, Spacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(EditorCopy.pickerNoWeekday)
    }
}

private struct DayWeekStrip: View {
    let day: GregorianDate

    @Environment(AppModel.self) private var model

    var body: some View {
        let days = CalendarPeriod.days(of: CalendarPeriod.week(of: day, system: model.system), system: model.system)
        HStack(spacing: 0) {
            ForEach(days, id: \.julianDayNumber) { date in
                let thirteen = ThirteenDate(date, system: model.system)
                let isSelected = date == day
                let isToday = date == model.today
                Button {
                    model.calendarDate = date
                } label: {
                    VStack(spacing: 2) {
                        Text(thirteen.weekday.map { $0.name(.narrow) } ?? thirteen.intercalaryDate?.info.code ?? "")
                            .font(Typography.mono(.caption2, weight: .medium))
                            .foregroundStyle(Palette.inkTertiary)
                        Text(thirteen.monthDate.map { "\($0.day)" } ?? (thirteen.intercalaryDate?.info.code ?? ""))
                            .font(Typography.display(.callout, weight: .semibold))
                            .foregroundStyle(isSelected ? Palette.onAccent : isToday ? Palette.accentText : Palette.ink)
                            .frame(minWidth: 30, minHeight: 30)
                            .background { if isSelected { Circle().fill(Palette.accent) } }
                        Text("\(date.day)")
                            .font(Typography.mono(.caption2))
                            .foregroundStyle(Palette.inkTertiary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(CalendarText.column(date, system: model.system))
                .accessibilityValue(isToday ? "Today" : "")
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .padding(.horizontal, Spacing.s)
        .padding(.vertical, Spacing.xs)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.rule).frame(height: 1) }
    }
}

/// Day mode's all-day row: the day's bars, one per line, with "Day n of total" on multi-day ones;
/// a drop on it makes a timed event all-day on this day.
private struct DayAllDayList: View {
    let day: GregorianDate
    let keys: [String]
    let byKey: [String: OccurrenceSnapshot]
    let gutter: CGFloat

    @Environment(AppModel.self) private var model
    @Environment(EventMoveFlow.self) private var flow
    @ScaledMetric(relativeTo: .caption2) private var laneHeight: CGFloat = 22
    @State private var isTargeted = false

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Text("all-day")
                .font(Typography.mono(.caption2))
                .foregroundStyle(Palette.inkTertiary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .frame(width: gutter - 9, alignment: .trailing)
                .padding(.leading, 3)
                .padding(.top, 5)
                .accessibilityHidden(true)
            VStack(spacing: 2) {
                ForEach(keys, id: \.self) { key in
                    if let occurrence = byKey[key] {
                        bar(occurrence)
                    }
                }
                if keys.isEmpty { Color.clear.frame(height: laneHeight - 4) }
            }
            .padding(.horizontal, 3)
            .padding(.vertical, 3)
            .frame(maxWidth: .infinity)
        }
        .background(isTargeted ? Palette.accentWash : ThemeColor.clear)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.rule).frame(height: 1) }
        .dropDestination(for: EventDragItem.self) { items, _ in
            isTargeted = false
            guard let item = items.first else { return }
            let copy = DropModifiers.optionHeld
            Task { await flow.drop(key: item.key, at: .allDay(day), copy: copy) }
        }
        .onDropHover { isTargeted = $0 != nil }
    }

    private func bar(_ occurrence: OccurrenceSnapshot) -> some View {
        let last = CalendarText.lastDay(occurrence)
        let total = last.julianDayNumber - occurrence.start.date.julianDayNumber + 1
        let index = day.julianDayNumber - occurrence.start.date.julianDayNumber + 1
        return EventChipView(
            occurrence: occurrence, hex: calendarHex(model, occurrence), isBar: true, continuesBefore: occurrence.start.date < day,
            continuesAfter: last > day, isSelected: model.selectedEventKey == occurrence.key,
            trailingText: total > 1 ? CalendarText.dayOfDays(index, total) : nil)
            .frame(height: laneHeight - 2)
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
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                CalendarText.bar(
                    occurrence, calendar: calendarName(model, occurrence), rowYear: day.year, continuesBefore: occurrence.start.date < day,
                    continuesAfter: last > day))
            .accessibilityAddTraits(.isButton)
    }
}

/// Regular width's details panel (§2.6): a summary of the selected event with "Show Details" and
/// "Edit", or the day's comparison when nothing on this day is selected.
private struct DayDetailsPanel: View {
    let day: GregorianDate
    let occurrences: [OccurrenceSnapshot]

    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                if let key = model.selectedEventKey, let occurrence = occurrences.first(where: { $0.key == key }) {
                    summary(occurrence)
                } else {
                    let comparison = Comparison(day, system: model.system)
                    DatePlate(comparison: comparison, size: .compact)
                    ComparisonDetailView(comparison: comparison, relativeToToday: day == model.today)
                }
            }
            .padding(Spacing.l)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Palette.paper)
    }

    private func summary(_ occurrence: OccurrenceSnapshot) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            HStack(alignment: .top, spacing: Spacing.s) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(calendarHex: calendarHex(model, occurrence)))
                    .frame(width: 4, height: 28)
                    .accessibilityHidden(true)
                EventTitleText(occurrence: occurrence, font: Typography.text(.title3, weight: .semibold), lineLimit: 3)
                EventStatusTag(status: occurrence.status)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(EventFormat.date(occurrence.start.date, system: model.system))
                    .font(Typography.text(.subheadline, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                Text(EventFormat.gregorianDate(occurrence.start.date))
                    .font(Typography.mono(.caption))
                    .foregroundStyle(Palette.inkTertiary)
            }
            .padding(Spacing.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.paperSunk, in: .rect(cornerRadius: Radius.cell))
            Text(occurrence.allDay ? "All day" : EventFormat.timeRange(start: occurrence.start.minute, end: occurrence.end.minute))
                .font(Typography.text(.body))
                .foregroundStyle(Palette.ink)
            if let calendar = model.events.calendar(id: occurrence.calendarID) {
                HStack(spacing: Spacing.s) {
                    EventDot(hex: calendar.info.color, size: 8)
                    Text("\(calendar.info.title), \(calendar.info.accountTitle)")
                        .font(Typography.text(.subheadline))
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
            if !occurrence.location.isEmpty {
                Text(occurrence.location)
                    .font(Typography.text(.subheadline))
                    .foregroundStyle(Palette.inkSecondary)
            }
            if let reason = occurrence.readOnly {
                HStack(alignment: .top, spacing: Spacing.s) {
                    Image(systemName: "lock").foregroundStyle(Palette.inkTertiary).accessibilityHidden(true)
                    Text(EventFormat.readOnlyReason(reason))
                        .font(Typography.text(.footnote))
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
            // Side by side when they fit, else one above the other (accessibility text sizes),
            // never breaking a word.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.s) { summaryButtons(occurrence, oneLine: true) }
                VStack(alignment: .leading, spacing: Spacing.s) { summaryButtons(occurrence, oneLine: false) }
            }
        }
    }

    @ViewBuilder private func summaryButtons(_ occurrence: OccurrenceSnapshot, oneLine: Bool) -> some View {
        Button("Show Details") { model.openEvent(key: occurrence.key) }
            .accentBorderedButtonStyle()
            .fixedSize(horizontal: oneLine, vertical: false)
        if occurrence.readOnly == nil {
            Button("Edit") { Task { await model.editEvent(key: occurrence.key) } }
                .accentBorderedButtonStyle()
                .fixedSize(horizontal: oneLine, vertical: false)
        }
    }
}
