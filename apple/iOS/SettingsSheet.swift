import SwiftUI
import ThirteenKit

/// Settings on iPhone and iPad: the colour theme (with a live preview), light or dark, the
/// calendar system and the Year-grid overlay. Opened from the gear button (tab screens on iPhone, the sidebar on
/// iPad). Every choice applies to all windows at once.
struct SettingsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @AppStorage(AppTheme.storageKey) private var theme: AppTheme = .defaultTheme
    @AppStorage(AppAppearance.storageKey) private var appearance: AppAppearance = .system

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            ScrollViewReader { proxy in
                Form {
                    Section {
                        ThemePicker(selection: $theme)
                            .padding(.vertical, Spacing.xs)
                        ThemePreview(comparison: model.todayComparison)
                    } header: {
                        Text("Theme").foregroundStyle(Palette.inkSecondary)
                    }
                    .listRowBackground(rowBackground)

                    Section {
                        AppearancePicker()
                            .labelsHidden()
                            .accessibilityLabel("Appearance")
                            .id(Self.appearanceID)
                    } header: {
                        Text("Appearance").foregroundStyle(Palette.inkSecondary)
                    } footer: {
                        Text(AppearanceSetting(choice: appearance, theme: theme).note)
                            .foregroundStyle(Palette.inkSecondary)
                    }
                    .listRowBackground(rowBackground)

                    Section {
                        Picker("Calendar system", selection: $model.system) {
                            ForEach(CalendarSystem.all) { system in
                                VStack(alignment: .leading, spacing: Spacing.xxs) {
                                    Text(system.name)
                                        .foregroundStyle(Palette.ink)
                                    Text("\(system.inventor), \(String(system.proposedYear))")
                                        .font(.footnote)
                                        .foregroundStyle(Palette.inkSecondary)
                                }
                                .tag(system.id)
                            }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    } header: {
                        Text("Calendar system").foregroundStyle(Palette.inkSecondary)
                    } footer: {
                        Text("Both are 13 × 28-day calendars. The choice applies to every screen.")
                            .foregroundStyle(Palette.inkSecondary)
                    }
                    .listRowBackground(rowBackground)

                    Section {
                        Toggle("Gregorian dates in Year grids", isOn: $model.showsGregorianOverlay)
                            .foregroundStyle(Palette.ink)
                    }
                    .listRowBackground(rowBackground)

                    EventSettingsSection()
                        .listRowBackground(rowBackground)
                }
                .scrollContentBackground(.hidden)
                .background(Palette.paper)
                .task {
                    // Screenshot QA (`-ThirteenQAScroll center|bottom`): show the Appearance section.
                    guard QAOptions.initialScrollAnchor != nil else { return }
                    try? await Task.sleep(for: .milliseconds(600))
                    proxy.scrollTo(Self.appearanceID, anchor: .center)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // Text, like the day-detail sheet: the icon-only form draws a white check on the
                // theme's control tint, which is under 3:1 on several dark themes.
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { close() }
                }
            }
        }
    }

    private static let appearanceID = "settings-appearance"

    private var rowBackground: Color { Palette.paperRaised.color(for: theme) }

    private func close() {
        model.showsSettings = false
        dismiss()
    }
}

/// The gear that opens ``SettingsSheet``.
struct SettingsButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Button("Settings", systemImage: "gearshape") {
            model.showsSettings = true
        }
        .help("Theme, appearance, calendar system and Year grid options")
    }
}

/// Presents the window's settings sheet (`AppModel.showsSettings`): medium and large detents on
/// iPhone, so the screen behind shows a theme change as it happens; a form sheet on iPad.
private struct SettingsSheetModifier: ViewModifier {
    @Bindable var model: AppModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    /// Medium on iPhone; large when screenshot QA scrolls the pages (`-ThirteenQAScroll`), so the
    /// lower sections can be captured.
    @State private var detent: PresentationDetent = QAOptions.initialScrollAnchor == nil ? .medium : .large

    func body(content: Content) -> some View {
        content.sheet(isPresented: $model.showsSettings) {
            SettingsSheet()
                .environment(model)
                .themedRoot()
                .presentationDetents(
                    horizontalSizeClass == .compact ? [.medium, .large] : [.large],
                    selection: horizontalSizeClass == .compact ? $detent : .constant(.large))
                .presentationDragIndicator(horizontalSizeClass == .compact ? .visible : .hidden)
        }
    }
}

extension View {
    /// Presents the model's settings sheet (`AppModel.showsSettings`).
    func settingsSheet(_ model: AppModel) -> some View {
        modifier(SettingsSheetModifier(model: model))
    }
}
