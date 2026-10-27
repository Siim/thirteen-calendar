import SwiftUI
import ThirteenKit

// The Alert and Second alert pickers (docs/EVENTS.md §2.14, task A7): the presets of core's
// `AlarmPreset.all(allDay:)` (timed: None, At time of event, 5 to 30 minutes, 1 and 2 hours, 1 and 2
// days, 1 week before; all-day: None and On the day, 1 day, 2 days and 1 week before at 09:00, in
// the OS 12 or 24-hour form). An alert another app set that matches no preset shows as its own
// row ("45 minutes before", "At 08:00 on Thursday, October 12, 2026") and is kept unless the user
// picks another row. The editor hides Second alert until Alert is set and the calendar keeps more
// than one alert, and trims the alerts at once when the calendar changes.

/// One alert picker, pushed from the editor's Alert or Second Alert row.
struct AlertPickerView: View {
    @Bindable var editor: EventEditorState
    /// 0: Alert, 1: Second alert.
    let index: Int

    @Environment(\.dismiss) private var dismiss

    private var current: Alarm? { index < editor.draft.alarms.count ? editor.draft.alarms[index] : nil }

    var body: some View {
        let presets = AlarmPreset.all(allDay: editor.draft.allDay, use24Hour: editor.use24Hour)
        let matches = presets.contains { $0.alarm == current }
        List {
            Group {
                if let current, !matches {
                    // Set by another app: kept unless the user changes this picker.
                    row(EditorAlerts.text(current, editor: editor), checked: true) { dismiss() }
                }
                ForEach(presets, id: \.id) { preset in
                    row(preset.label, checked: preset.alarm == current) {
                        editor.setAlarm(preset.alarm, at: index)
                        dismiss()
                    }
                }
            }
            .listRowBackground(Rectangle().fill(Palette.paperRaised))
        }
        // The editor's paper, not the system's grouped grey.
        .scrollContentBackground(.hidden)
        .background(Palette.paper)
        .navigationTitle(index == 0 ? EditorCopy.alert : EditorCopy.secondAlert)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private func row(_ label: String, checked: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(label).foregroundStyle(Palette.ink)
                Spacer()
                if checked { Image(systemName: "checkmark").foregroundStyle(Palette.accentText).accessibilityHidden(true) }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}

/// Alert texts for the editor's rows.
enum EditorAlerts {
    @MainActor
    static func text(_ alarm: Alarm?, editor: EventEditorState) -> String {
        guard let alarm else { return EditorCopy.alertNone }
        return (try? alarm.description(allDay: editor.draft.allDay, system: editor.system, use24Hour: editor.use24Hour)) ?? ""
    }
}
