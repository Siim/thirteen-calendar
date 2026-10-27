import SwiftUI
import ThirteenKit

// Calendar's List mode (docs/EVENTS.md §2.7, board J2, task A5): a continuous list of the events
// from the selected day onward, grouped by 13-month month (sticky header `October 2026`) and day
// (header `Thursday, October 12` + `Gregorian Mon, Oct 19`; an intercalary day heads as `Year Day`
// + `Gregorian Thu, Dec 31`). Days without events are skipped; a multi-day event appears on every
// day it covers with "Day 2 of 3" in place of the time; the time column is sized for "12:30 PM".
// It loads a Gregorian year at a time as it scrolls (and earlier years with "Show Earlier
// Events" at the top). Empty: "No upcoming events." with "New Event"; every calendar hidden: the
// line of §2.4.

/// Calendar's List mode.
struct ListModeView: View {
    @Environment(AppModel.self) private var model
    /// The last Gregorian year the list shows (grows as the list scrolls to its end).
    @State private var throughYear: Int?
    /// The first day the list shows (moves back a year with "Show Earlier Events").
    @State private var fromDay: GregorianDate?
    @ScaledMetric(relativeTo: .footnote) private var timeWidth: CGFloat = EventFormat.uses24HourClock ? 60 : 70

    var body: some View {
        let from = fromDay ?? model.calendarDate
        let lastYear = throughYear ?? min(model.calendarDate.year + 1, GregorianDate.maxYear)
        let through = (try? GregorianDate(year: lastYear, month: 12, day: 31)) ?? from
        let occurrences = model.events.occurrences(from: from, through: through)
        let byKey = Dictionary(occurrences.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
        let days = (try? AgendaDay.days(occurrences: occurrences.map(\.occurrence), from: from, to: max(from, through), system: model.system)) ?? []
        let groups = Self.group(days, system: model.system)
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    CalendarAccessBanner()
                        .padding(Spacing.l)
                    if model.events.allCalendarsHidden {
                        AllCalendarsHiddenLine().padding(Spacing.l)
                    } else if model.events.canShowEvents {
                        if from.year > GregorianDate.minYear {
                            Button("Show Earlier Events") {
                                fromDay = (try? GregorianDate(year: from.year - 1, month: 1, day: 1)) ?? from
                                Task { await model.events.load(years: (from.year - 1)...from.year) }
                            }
                            .buttonStyle(.borderless)
                            .foregroundStyle(Palette.accentText)
                            .padding(.horizontal, Spacing.l)
                            .padding(.vertical, Spacing.s)
                        }
                        if groups.isEmpty && !isLoading(lastYear) {
                            empty
                        }
                        ForEach(groups, id: \.month) { group in
                            Section {
                                ForEach(group.days, id: \.gregorian) { day in
                                    dayHeader(day.gregorian)
                                        .id(day.gregorian.julianDayNumber)
                                    ForEach(day.items, id: \.key) { item in
                                        if let occurrence = byKey[item.key] {
                                            row(occurrence, item: item)
                                        }
                                    }
                                }
                            } header: {
                                monthHeader(group.month)
                            }
                        }
                        if lastYear < GregorianDate.maxYear {
                            // Reaching the end loads the next Gregorian year (§2.7: 13 months at a time).
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .padding(Spacing.l)
                                .onAppear {
                                    let next = lastYear + 1
                                    throughYear = next
                                    Task { await model.events.load(years: next...next) }
                                }
                        }
                    }
                }
            }
            .background(Palette.paper)
            .onChange(of: model.calendarDate) { _, _ in
                fromDay = nil
                throughYear = nil
                proxy.scrollTo(model.calendarDate.julianDayNumber, anchor: .top)
            }
        }
    }

    private func isLoading(_ year: Int) -> Bool {
        model.events.loadState(year: year) == .loading || model.events.loadState(year: model.calendarDate.year) == .loading
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text("No upcoming events.")
                .font(Typography.text(.body))
                .foregroundStyle(Palette.inkSecondary)
            if model.events.showsEvents {
                Button("New Event") { Task { await model.newEvent(on: model.calendarDate) } }
                    .buttonStyle(.borderless)
                    .foregroundStyle(Palette.accentText)
            }
        }
        .padding(Spacing.l)
    }

    /// The days of the agenda grouped by 13-month month (an intercalary day goes with the month it follows).
    static func group(_ days: [AgendaDay], system: CalendarSystemID) -> [(month: CalendarPeriod.Month, days: [AgendaDay])] {
        var out: [(month: CalendarPeriod.Month, days: [AgendaDay])] = []
        for day in days {
            let month = CalendarPeriod.month(of: day.gregorian, system: system)
            if out.last?.month == month {
                out[out.count - 1].days.append(day)
            } else {
                out.append((month, [day]))
            }
        }
        return out
    }

    private func monthHeader(_ month: CalendarPeriod.Month) -> some View {
        let first = CalendarPeriod.firstDay(of: month, system: model.system) ?? model.calendarDate
        return Text(CalendarPeriod.title(mode: .month, date: first, system: model.system))
            .font(Typography.text(.footnote, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, Spacing.s)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.paperSunk)
            .accessibilityAddTraits(.isHeader)
    }

    private func dayHeader(_ day: GregorianDate) -> some View {
        let isToday = day == model.today
        return VStack(alignment: .leading, spacing: 2) {
            Text(CalendarText.dayTitle(day, system: model.system))
                .font(Typography.text(.subheadline, weight: .semibold))
                .foregroundStyle(isToday ? Palette.accentText : Palette.ink)
            Text(CalendarText.dayGregorianLine(day))
                .font(Typography.mono(.caption2))
                .foregroundStyle(Palette.inkTertiary)
        }
        .padding(.horizontal, Spacing.l)
        .padding(.top, Spacing.m)
        .padding(.bottom, Spacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .modifier(DayDrop(day: day))
    }

    private func row(_ occurrence: OccurrenceSnapshot, item: AgendaItem) -> some View {
        let now = model.events.now()
        return VStack(spacing: 0) {
            Button {
                model.openEvent(key: occurrence.key)
            } label: {
                CalendarEventRow(
                    occurrence: occurrence, item: item, timeWidth: timeWidth,
                    isNow: !occurrence.allDay && occurrence.start <= now && now < occurrence.end)
            }
            .buttonStyle(.plain)
            .eventDraggable(occurrence)
            .eventContextMenu(occurrence)
            .eventPopoverAnchor(.event(occurrence.key))
            Divider().overlay(Palette.rule)
        }
        .padding(.horizontal, Spacing.l)
    }
}
