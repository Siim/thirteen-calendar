import SwiftUI
import ThirteenKit

/// The Settings scene (⌘,): colour theme (with a live preview), light or dark, calendar system
/// and Year-grid overlay. Every choice applies at once to the main window and the menu bar extra.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AppTheme.storageKey) private var theme: AppTheme = .defaultTheme
    @AppStorage(AppAppearance.storageKey) private var appearance: AppAppearance = .system

    var body: some View {
        @Bindable var model = model
        Form {
            Section {
                ThemePicker(selection: $theme)
                ThemePreview(comparison: model.todayComparison)
            } header: {
                Text("Theme")
            }
            Section {
                AppearancePicker()
                    .fixedSize()
            } footer: {
                Text(AppearanceSetting(choice: appearance, theme: theme).note)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Section {
                Picker("Calendar system", selection: $model.system) {
                    ForEach(CalendarSystem.all) { system in
                        VStack(alignment: .leading) {
                            Text(system.name)
                            Text("\(system.inventor), \(String(system.proposedYear))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .tag(system.id)
                    }
                }
                .pickerStyle(.radioGroup)
            } footer: {
                Text("Both are 13 × 28-day calendars. The choice applies to every screen and the menu bar.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Section {
                Toggle("Show Gregorian dates in Year grids", isOn: $model.showsGregorianOverlay)
            }
            EventSettingsSection()
        }
        .formStyle(.grouped)
        .frame(width: 540)
        .fixedSize(horizontal: false, vertical: true)
    }
}
