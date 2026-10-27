import SwiftUI
import ThirteenKit

// The Settings group "Calendar" (docs/EVENTS.md §2.18) on iPhone and iPad (SettingsSheet) and the
// Mac (SettingsView), in the table's order: "Show my events" first (default on, with its footer),
// then "Calendar access" (`CalendarAccess.settingsValue`; it does what the access card's button
// does), "Default calendar" (the writable calendars; footer "New events go to {name}.") and "Show
// events in Year view". Everything after the first row is hidden while "Show my events" is off,
// and "Default calendar" also without full access (its picker needs the calendars).

/// The Settings group "Calendar".
struct EventSettingsSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var events = model.events
        Section {
            Toggle("Show my events", isOn: $events.showsEvents)
                .settingsRowInk()
        } header: {
            Text("Calendar").settingsHeaderInk()
        } footer: {
            Text("Shows the events from your calendars in Thirteen. When off, Thirteen never asks for calendar access.")
                .settingsFooterInk()
        }
        if events.showsEvents {
            Section {
                CalendarAccessSettingsRow()
                if events.canShowEvents, !events.writableCalendars.isEmpty {
                    Picker("Default calendar", selection: defaultCalendarSelection) {
                        ForEach(events.writableCalendars) { calendar in
                            Text(calendar.info.title).tag(calendar.id)
                        }
                    }
                    .settingsRowInk()
                }
            } footer: {
                if events.canShowEvents, let calendar = events.defaultCalendar {
                    Text(EventSettings.defaultCalendarFooter(calendar.info.title))
                        .settingsFooterInk()
                }
            }
            Section {
                Toggle("Show events in Year view", isOn: $events.showsEventsInYear)
                    .settingsRowInk()
            }
        }
    }

    private var defaultCalendarSelection: Binding<String> {
        Binding(
            get: { model.events.defaultCalendar?.id ?? "" },
            set: { model.events.setDefaultCalendar(id: $0) })
    }
}

/// "Calendar access": the state ("Full access", "Off", "Add only", "Restricted", "Not set up") and
/// the access card's action.
private struct CalendarAccessSettingsRow: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let events = model.events
        let value = CalendarAccess.settingsValue(events.authorization)
        let action = EventSettings.accessAction(events.authorization)
        #if os(macOS)
        LabeledContent("Calendar access") {
            HStack(spacing: Spacing.s) {
                Text(value).foregroundStyle(.secondary)
                if let action {
                    Button(action == .requestAccess ? "Continue" : AccessCardView.settingsButton) { perform(action) }
                }
            }
        }
        #else
        if let action {
            Button {
                perform(action)
            } label: {
                LabeledContent("Calendar access") {
                    HStack(spacing: Spacing.s) {
                        Text(value).foregroundStyle(Palette.inkSecondary)
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Palette.inkTertiary)
                            .accessibilityHidden(true)
                    }
                }
                .foregroundStyle(Palette.ink)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(EventSettings.accessHint(action))
        } else {
            LabeledContent("Calendar access") {
                Text(value).foregroundStyle(Palette.inkSecondary)
            }
            .foregroundStyle(Palette.ink)
        }
        #endif
    }

    private func perform(_ action: EventSettings.AccessAction) {
        switch action {
        case .requestAccess: Task { await model.events.requestAccess() }
        case .openSettings: CalendarAccess.openSystemSettings()
        }
    }
}

private extension View {
    /// Row text: the theme's ink on iPhone and iPad (the settings sheet is themed); the Mac's
    /// grouped form keeps the system's.
    @ViewBuilder
    func settingsRowInk() -> some View {
        #if os(macOS)
        self
        #else
        foregroundStyle(Palette.ink)
        #endif
    }

    @ViewBuilder
    func settingsHeaderInk() -> some View {
        #if os(macOS)
        self
        #else
        foregroundStyle(Palette.inkSecondary)
        #endif
    }

    @ViewBuilder
    func settingsFooterInk() -> some View {
        #if os(macOS)
        font(.footnote)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        #else
        foregroundStyle(Palette.inkSecondary)
        #endif
    }
}
