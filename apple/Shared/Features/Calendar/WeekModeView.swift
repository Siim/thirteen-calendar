import SwiftUI
import ThirteenKit

// Calendar's Week mode (docs/EVENTS.md §2.5, board F1, task A6; regular width only, compact width
// and accessibility text sizes show Day). The 7 days of one 13-month week as columns, plus one
// column per intercalary day after week 4 (60% wide and hatched, headed by its code plate); the
// header `Thu 12` over `Mon, Oct 19`; the all-day row; and the timeline (`EventTimeline`) with
// `maxSlots` = floor(column width / 48 pt), scrolled on open to 07:00 or the week's first event if
// earlier. Previous and next step by one 13-month week. Each column is one accessibility container
// named for its day.

/// Calendar's Week mode.
struct WeekModeView: View {
    @Environment(AppModel.self) private var model
    /// The size of the time axis labels (caption 2 at the current text size).
    @ScaledMetric(relativeTo: .caption2) private var labelSize: CGFloat = Typography.baseSize(.caption2)
    @ScaledMetric(relativeTo: .body) private var hourHeight: CGFloat = 48

    /// The time axis's width: the boards' 52 pt, scaled, or more for the widest hour and now labels in
    /// the OS clock form (`12:00 PM` in 12-hour locales, §2.5).
    private var gutter: CGFloat { TimelineAxis.width(labelSize: labelSize) }

    var body: some View {
        let system = model.system
        let week = CalendarPeriod.week(of: model.calendarDate, system: system)
        let days = CalendarPeriod.days(of: week, system: system)
        let occurrences = days.first.flatMap { first in days.last.map { model.events.occurrences(from: first, through: $0) } } ?? []
        let byKey = Dictionary(occurrences.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
        VStack(spacing: 0) {
            if model.events.accessCard != nil || model.events.allCalendarsHidden {
                VStack(alignment: .leading) {
                    CalendarAccessBanner()
                    if model.events.allCalendarsHidden { AllCalendarsHiddenLine() }
                }
                .padding(Spacing.m)
            }
            GeometryReader { proxy in
                let columns = TimelineColumn.columns(days, width: max(proxy.size.width - gutter, 1), system: system)
                let dayWidth = columns.first { !$0.isIntercalary }?.width ?? 100
                let maxSlots = TimelineMetrics.maxSlots(columnWidth: dayWidth, minimumSlotWidth: 48)
                let layout = try? WeekEventLayout(
                    year: week.month.year, month: week.month.month, week: week.week, occurrences: occurrences.map(\.occurrence), system: system,
                    maxSlots: maxSlots)
                let first = layout?.timed.filter { !$0.hidden }.map(\.startMinute).min()
                VStack(spacing: 0) {
                    WeekColumnHeader(columns: columns, gutter: gutter)
                    TimelineAllDayRow(columns: columns, items: layout?.allDay ?? [], byKey: byKey, gutter: gutter)
                    EventTimeline(
                        columns: columns, timed: layout?.timed ?? [], overflow: layout?.overflow ?? [], byKey: byKey, gutter: gutter,
                        metrics: TimelineMetrics(hourHeight: hourHeight), initialMinute: TimelineMetrics.initialMinute(firstEvent: first),
                        pageID: days.first?.julianDayNumber ?? 0)
                }
            }
        }
        .background(Palette.paperRaised)
        .calendarPaging(model, unit: .week)
        .calendarKeyboard(model, weekStep: nil) { Self.agendaKeys($0, occurrences: occurrences, system: system) }
    }

    /// The keys of a day's events in agenda order: all-day first, then by start (keyboard
    /// navigation, §2.21).
    static func agendaKeys(_ day: GregorianDate, occurrences: [OccurrenceSnapshot], system: CalendarSystemID) -> [String] {
        let touching = occurrences.filter { $0.start.date <= day && CalendarText.lastDay($0) >= day }
        let days = (try? AgendaDay.days(occurrences: touching.map(\.occurrence), from: day, to: day, system: system)) ?? []
        return days.first?.items.map(\.key) ?? []
    }
}

/// The Week column headers (§2.5): the 13-month weekday and day over the Gregorian date
/// (`Mon, Oct 19`, ink-3); an intercalary column: its code plate, name and Gregorian date. A header
/// opens that day in Day mode.
struct WeekColumnHeader: View {
    let columns: [TimelineColumn]
    let gutter: CGFloat

    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: gutter, height: 1)
            ForEach(columns) { column in
                Button {
                    model.calendarDate = column.day
                    model.calendarMode = .day
                } label: {
                    header(column)
                        .frame(width: column.width, alignment: .leading)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(CalendarText.column(column.day, system: model.system))
                .accessibilityHint("Opens the day")
            }
        }
        .padding(.vertical, Spacing.xs)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.rule).frame(height: 1) }
    }

    @ViewBuilder private func header(_ column: TimelineColumn) -> some View {
        let thirteen = ThirteenDate(column.day, system: model.system)
        let isToday = column.day == model.today
        VStack(alignment: .leading, spacing: 0) {
            if let intercalary = thirteen.intercalaryDate {
                Text(intercalary.info.code)
                    .font(Typography.mono(.caption2, weight: .bold))
                    .foregroundStyle(isToday ? Palette.onAccent : Palette.accentText)
                    .padding(.horizontal, 3)
                    .background(isToday ? Palette.accent : Palette.accentWash, in: .rect(cornerRadius: 3))
                Text(intercalary.info.shortName)
                    .font(Typography.text(.subheadline, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            } else if let date = thirteen.monthDate {
                Text(date.weekday.name(.short).uppercased())
                    .font(Typography.mono(.caption2, weight: .medium))
                    .foregroundStyle(isToday ? Palette.accentText : Palette.inkTertiary)
                Text("\(date.day)")
                    .font(Typography.display(.title3, weight: .semibold))
                    .foregroundStyle(isToday ? Palette.accentText : Palette.ink)
            }
            Text(column.day.formatted(FormatOptions(style: .short, includeWeekday: true)))
                .font(Typography.mono(.caption2))
                .foregroundStyle(Palette.inkTertiary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 6)
    }
}
