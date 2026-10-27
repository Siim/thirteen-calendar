import SwiftUI

/// iPhone (compact width): a tab bar with one `NavigationStack` per tab. iPad (regular width):
/// the shared sidebar layout. Navigation state lives in the window's `AppModel`, so resizing an
/// iPad window between the two keeps the screen.
struct PhoneOrPadRootView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if horizontalSizeClass == .compact {
                PhoneTabView()
            } else {
                SplitRootView()
            }
        }
        // The window's width for what has no view of its own (⌥⌘K: the sidebar list or the sheet).
        .onChange(of: horizontalSizeClass, initial: true) { _, sizeClass in model.isCompactWidth = sizeClass == .compact }
        #if DEBUG
        // `-ThirteenQAAccessibilityProbe YES` only (task A10): the rotor, cell actions and paging
        // actions that XCUITest cannot read.
        .overlay(alignment: .topLeading) { QAAccessibilityProbeView() }
        #endif
    }
}

/// The iOS 26 tab bar: Today, Calendar, Convert, Compare, History, each with the settings gear at
/// the leading edge of its navigation bar.
///
/// The tab bar draws its selected tab in the tint over its own Liquid Glass, which is lighter than
/// the paper behind it in dark mode: with the control tint the selected label measured 4.13:1 in
/// Obsidian and 4.58:1 in Phosphor there. So the tab bar alone takes the theme's accent text
/// (4.5:1 or more on every paper, about 8:1 in the dark themes and the same colour as the control
/// tint in most light ones), and each tab's content gets the control tint back.
struct PhoneTabView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.appTheme) private var theme

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.section) {
            ForEach(AppSection.allCases) { section in
                Tab(section.title, systemImage: section.systemImage, value: section) {
                    NavigationStack {
                        SectionContent(section: section)
                            .toolbar {
                                ToolbarItem(placement: .topBarLeading) {
                                    SettingsButton()
                                }
                            }
                    }
                    .tint(Palette.controlTint.color(for: theme))
                }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tint(Palette.accentText.color(for: theme))
    }
}
