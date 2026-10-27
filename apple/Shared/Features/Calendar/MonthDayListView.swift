import SwiftUI
import ThirteenKit

// Month at accessibility text sizes (docs/EVENTS.md §2.4, board J3, task A5): the grid becomes a
// vertical list of the month's days, like the Year grid at those sizes. A day row reads `Thursday,
// October 12` + `Gregorian Mon, Oct 19`, then up to three event lines (time and title, wrapping)
// and "+{n} more", which opens Day. A day without events is one line; a run of two or more is one
// line, "No events, October 21 to October 23", which opens Day on the run's first day. There is no
// separate selected-day list. Order and runs come from `agenda(..., includeEmptyDays: true)`.

/// The list of a month's days at accessibility text sizes.
struct MonthDayListView: View {
    let data: MonthPageData

    @Environment(AppModel.self) private var model
    @Environment(EventMoveFlow.self) private var flow

    var body: some View {
        let rows = listRows
        let target = MonthListRow.scrollTarget(rows, selected: model.calendarDate)
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    CalendarAccessBanner()
                        .padding(Spacing.l)
                    if model.events.allCalendarsHidden {
                        AllCalendarsHiddenLine().padding(Spacing.l)
                    }
                    ForEach(rows) { row in
                        VStack(spacing: 0) {
                            rowView(row)
                            Divider().overlay(Palette.rule)
                        }
                        .id(row.id)
                    }
                }
                .calendarPaging(model, unit: .month)
            }
            .background(Palette.paper)
            // Opens on the selected day with the day before it above (board J3), and follows a
            // new selection or page.
            .onAppear { if let target { proxy.scrollTo(target, anchor: .top) } }
            .onChange(of: target) { _, new in if let new { proxy.scrollTo(new, anchor: .top) } }
        }
    }

    private var listRows: [MonthListRow] {
        guard let first = data.days.first, let last = data.days.last else { return [] }
        let days = (try? AgendaDay.days(
            occurrences: data.occurrences.map(\.occurrence), from: first, to: last, system: data.system, includeEmptyDays: true)) ?? []
        return MonthListRow.rows(days)
    }

    @ViewBuilder private func rowView(_ row: MonthListRow) -> some View {
        switch row {
        case let .day(day):
            dayRow(day)
        case let .emptyDay(day):
            emptyDayRow(day)
        case let .emptyRun(first, last):
            Button { openDay(first) } label: {
                Text(CalendarText.emptyRun(from: first, to: last, system: data.system))
                    .font(Typography.text(.body))
                    .foregroundStyle(Palette.inkSecondary)
                    .padding(.horizontal, Spacing.l)
                    .padding(.vertical, Spacing.m)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the day")
        }
    }

    private func emptyDayRow(_ day: GregorianDate) -> some View {
        Button { openDay(day) } label: {
            VStack(alignment: .leading, spacing: 2) {
                title(day)
                gregorian(day)
            }
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, Spacing.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(day == model.today ? Palette.accentWash : ThemeColor.clear)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(dayName(day, eventCount: 0))
        .accessibilityValue(day == model.today ? "Today" : "")
        .accessibilityAddTraits(.isButton)
        .modifier(DayDrop(day: day))
    }

    private func dayRow(_ day: AgendaDay) -> some View {
        let isToday = day.gregorian == model.today
        let entries = day.items.compactMap { item in data.byKey[item.key].map { ($0, item) } }
        return VStack(alignment: .leading, spacing: Spacing.xs) {
            Button { openDay(day.gregorian) } label: {
                VStack(alignment: .leading, spacing: 2) {
                    title(day.gregorian, accent: isToday)
                    gregorian(day.gregorian)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(dayName(day.gregorian, eventCount: entries.count))
            .accessibilityValue(isToday ? "Today" : "")
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Opens the day")
            ForEach(Array(entries.prefix(MonthListRow.shownEvents)), id: \.0.key) { occurrence, item in
                Button { model.openEvent(key: occurrence.key) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                        EventDot(hex: calendarHex(model, occurrence), size: 10)
                        let text = CalendarRowText(occurrence, item: item)
                        Text(text.time)
                            .font(Typography.mono(.body))
                            .foregroundStyle(Palette.inkSecondary)
                        EventTitleText(occurrence: occurrence, font: Typography.text(.body), lineLimit: nil)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .eventDraggable(occurrence)
                .accessibilityElement(children: .ignore)
                .accessibilityAddTraits(.isButton)
                // A day list row reads like the chip it stands for (§2.20 `calendar.item.a11y`).
                .accessibilityLabel(
                    CalendarText.item(occurrence, calendar: calendarName(model, occurrence), dayOf: CalendarRowText(occurrence, item: item).dayOf))
            }
            if entries.count > MonthListRow.shownEvents {
                Button(CalendarText.more(entries.count - MonthListRow.shownEvents)) { openDay(day.gregorian) }
                    .buttonStyle(.plain)
                    .font(Typography.text(.body, weight: .semibold))
                    .foregroundStyle(Palette.accentText)
                    .accessibilityLabel(CalendarText.moreA11y(entries.count - MonthListRow.shownEvents, day: day.gregorian, system: data.system))
            }
        }
        .padding(.horizontal, Spacing.l)
        .padding(.vertical, Spacing.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isToday || day.gregorian == model.calendarDate ? Palette.accentWash : ThemeColor.clear)
        .modifier(DayDrop(day: day.gregorian))
    }

    /// The day's name: `calendar.cell.a11y`, or for an intercalary day the band's
    /// `calendar.band.a11y` ("Year Day 2026, no weekday. Gregorian ..."), with the event count.
    private func dayName(_ day: GregorianDate, eventCount: Int) -> String {
        ThirteenDate(day, system: data.system).isIntercalary
            ? CalendarText.band(day, system: data.system, eventCount: eventCount)
            : CalendarText.cell(day, system: data.system, eventCount: eventCount)
    }

    private func title(_ day: GregorianDate, accent: Bool = false) -> some View {
        Text(CalendarText.dayTitle(day, system: data.system))
            .titleFont(.title3, weight: .bold)
            .foregroundStyle(accent ? Palette.accentText : Palette.ink)
    }

    private func gregorian(_ day: GregorianDate) -> some View {
        Text(CalendarText.dayGregorianLine(day))
            .font(Typography.mono(.body))
            .foregroundStyle(Palette.inkTertiary)
    }

    private func openDay(_ day: GregorianDate) {
        model.calendarDate = day
        model.calendarMode = .day
    }
}

/// A day as a drop destination for dragged events (same time of day, §2.11 Drag edits).
struct DayDrop: ViewModifier {
    let day: GregorianDate

    @Environment(EventMoveFlow.self) private var flow

    func body(content: Content) -> some View {
        content.dropDestination(for: EventDragItem.self) { items, _ in
            guard let item = items.first else { return }
            let copy = DropModifiers.optionHeld
            Task { await flow.drop(key: item.key, at: .day(day), copy: copy) }
        }
    }
}
