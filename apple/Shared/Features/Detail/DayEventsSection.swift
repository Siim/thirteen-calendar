import SwiftUI
import ThirteenKit

// The Events section at the top of the day sheet (docs/EVENTS.md §2.9): the day's items as in Up
// next (UpNextRows.swift, every item of the day, the Now plate while one runs), "New Event" and
// "Open in Calendar" (Day mode). A day without events shows "No events." and "New Event" only
// (§2.9, as the web's DayEvents does); with every calendar hidden, "All calendars are hidden."
// and "Show Calendars" (§2.4 states, as Up next). Not shown while "Show my events" is off, nor
// without full access (Calendar's modes show the access cards, §2.16).
//
// Details and the editor are presented from the window root (EventPresentation.swift), which cannot
// present while this sheet is up, so a row and "New Event" close the sheet first.

/// The day sheet's Events section.
struct DayEventsSection: View {
    let date: GregorianDate

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let events = model.events
        if events.canShowEvents {
            let occurrences = events.occurrences(on: date)
            let items = UpNextAgenda.items(on: date, occurrences: occurrences, system: model.system)
            let allHidden = !events.calendars.isEmpty && events.visibleCalendarIDs.isEmpty
            VStack(alignment: .leading, spacing: 0) {
                Text("Events")
                    .titleFont(.title3)
                    .foregroundStyle(Palette.ink)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.horizontal, Spacing.l)
                    .padding(.top, Spacing.m)
                    .padding(.bottom, Spacing.xs)
                TimelineView(.everyMinute) { _ in
                    let now = events.now()
                    VStack(alignment: .leading, spacing: 0) {
                        if items.isEmpty {
                            if allHidden {
                                stateLine("All calendars are hidden.")
                                Button("Show Calendars") {
                                    closeSheet { model.showCalendarsList() }
                                }
                                .buttonStyle(.plain)
                                .font(Typography.text(.subheadline, weight: .semibold))
                                .foregroundStyle(Palette.controlTint)
                                .frame(minHeight: 44)
                                .padding(.horizontal, Spacing.l)
                            } else if case .failed = events.loadState(year: date.year) {
                                stateLine("Couldn’t load events.")
                            } else if events.loadState(year: date.year) == .loaded {
                                stateLine("No events.")
                            } else {
                                ProgressView()
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                    .accessibilityLabel("Loading events")
                            }
                        } else {
                            ForEach(items, id: \.key) { item in
                                if let occurrence = occurrences.first(where: { $0.key == item.key }) {
                                    UpNextDivider()
                                    UpNextRow(occurrence: occurrence, item: item, now: date == now.date ? now : nil) { key in
                                        closeSheet { model.openEvent(key: key) }
                                    }
                                    .padding(.horizontal, Spacing.l)
                                }
                            }
                        }
                    }
                }
                actions(opensDay: !items.isEmpty)
                    .padding(.horizontal, Spacing.l)
                    .padding(.top, Spacing.s)
                    .padding(.bottom, Spacing.l)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.paperRaised, in: .rect(cornerRadius: Radius.card))
            .overlay { RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Palette.rule, lineWidth: 1) }
            .accessibilityElement(children: .contain)
            .task(id: date) { await events.load(from: date, through: date) }
        }
    }

    private func stateLine(_ text: String) -> some View {
        Text(text)
            .font(Typography.text(.subheadline))
            .foregroundStyle(Palette.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, Spacing.s)
    }

    /// "New Event", and "Open in Calendar" when the day has events (§2.9: an empty day shows "No
    /// events." and "New Event").
    private func actions(opensDay: Bool) -> some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.s))
            : AnyLayout(HStackLayout(spacing: Spacing.s))
        return layout {
            Button("New Event", systemImage: "plus") {
                let day = date
                closeSheet { Task { await model.newEvent(on: day) } }
            }
            if opensDay {
                Button("Open in Calendar", systemImage: "calendar") {
                    let day = date
                    closeSheet(waits: false) {
                        model.calendarDate = day
                        model.showCalendar(mode: .day)
                    }
                }
            }
        }
        .accentBorderedButtonStyle()
        .wrappingButtonShape()
        .controlSize(.small)
    }

    /// Closes the day sheet, then runs `action`: once the sheet is gone when `waits`, so a sheet
    /// presented from the window root (details, the editor, an alert) can appear.
    private func closeSheet(waits: Bool = true, then action: @escaping @MainActor () -> Void) {
        model.noteNextAction()
        model.detail = nil
        dismiss()
        guard waits else {
            action()
            return
        }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(Self.dismissDelay))
            action()
        }
    }

    /// Long enough for the sheet's dismissal to finish on iPhone, iPad and Mac.
    private static let dismissDelay = 450
}
