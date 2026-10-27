import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Light or dark mode (design/DECISIONS.md): follows the system unless the user pins one in
/// Settings. Independent of the colour theme, except that the always-dark themes
/// (``ThemeGroup/dark``) are dark whatever the choice; see ``AppearanceSetting``.
enum AppAppearance: String, CaseIterable, Identifiable, Sendable {
    case system, light, dark

    /// The `UserDefaults` key of the choice (`@AppStorage`), shared by every window. Launch with
    /// `-appAppearance dark` to start pinned (screenshots).
    static let storageKey = "appAppearance"

    var id: String { rawValue }

    /// The name shown in Settings.
    var displayName: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    /// The pinned colour scheme, or `nil` to follow the system.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    /// Applies the appearance to every window of the app at once (sheets, popovers and, on the
    /// Mac, the menu bar extra and Settings included). UIKit and AppKit overrides rather than
    /// `preferredColorScheme`, which does not reliably return to the system appearance when set
    /// back to `nil`. Apply the effective appearance (``AppearanceSetting/effective``), never the
    /// stored choice on its own.
    @MainActor
    func apply() {
        #if os(macOS)
        NSApplication.shared.appearance =
            switch self {
            case .system: nil
            case .light: NSAppearance(named: .aqua)
            case .dark: NSAppearance(named: .darkAqua)
            }
        #else
        let style: UIUserInterfaceStyle =
            switch self {
            case .system: .unspecified
            case .light: .light
            case .dark: .dark
            }
        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
            for window in scene.windows where window.overrideUserInterfaceStyle != style {
                window.overrideUserInterfaceStyle = style
            }
        }
        #endif
    }
}

/// The Appearance setting as Settings shows it: the user's stored choice, and the theme that may
/// override it. An always-dark theme forces dark (``AppTheme/forcedColorScheme``) without
/// touching the stored choice, so picking a light and dark theme again brings that choice back.
struct AppearanceSetting: Equatable, Sendable {
    /// What the user picked (`@AppStorage(AppAppearance.storageKey)`).
    var choice: AppAppearance
    /// The colour theme (`@AppStorage(AppTheme.storageKey)`).
    var theme: AppTheme

    /// Reads both from `defaults` (unknown or missing values fall back to the defaults).
    init(defaults: UserDefaults = .standard) {
        choice = defaults.string(forKey: AppAppearance.storageKey).flatMap(AppAppearance.init(rawValue:)) ?? .system
        theme = defaults.string(forKey: AppTheme.storageKey).flatMap(AppTheme.init(rawValue:)) ?? .defaultTheme
    }

    init(choice: AppAppearance, theme: AppTheme) {
        self.choice = choice
        self.theme = theme
    }

    /// True while the theme decides: the control is shown disabled with ``note``.
    var isForced: Bool { theme.forcedColorScheme != nil }

    /// What the app shows: dark for an always-dark theme, else the user's choice.
    var effective: AppAppearance {
        switch theme.forcedColorScheme {
        case .dark: .dark
        case .light: .light
        default: choice
        }
    }

    /// The segment the control shows selected: what the app shows.
    var shown: AppAppearance { effective }

    /// A pick from the control. Ignored while the theme forces the appearance.
    mutating func select(_ appearance: AppAppearance) {
        guard !isForced else { return }
        choice = appearance
    }

    /// The note under the control, and the VoiceOver hint of the disabled control.
    var note: String {
        isForced
            ? "\(theme.displayName) is always dark. Pick a \(ThemeGroup.adaptive.displayName.lowercased()) theme to use Appearance again."
            : "System follows the \(Self.deviceName)\u{2019}s light or dark setting. Dark themes are always dark."
    }

    #if os(macOS)
    private static let deviceName = "Mac"
    #else
    private static let deviceName = "device"
    #endif
}

/// The Appearance control of Settings (iOS sheet and Mac Settings): System, Light, Dark as
/// segments, disabled with a note while an always-dark theme is chosen.
struct AppearancePicker: View {
    @AppStorage(AppTheme.storageKey) private var theme: AppTheme = .defaultTheme
    @AppStorage(AppAppearance.storageKey) private var choice: AppAppearance = .system

    private var setting: AppearanceSetting { AppearanceSetting(choice: choice, theme: theme) }

    var body: some View {
        let setting = setting
        Picker(
            "Appearance",
            selection: Binding(
                get: { setting.shown },
                set: { appearance in
                    var updated = setting
                    updated.select(appearance)
                    choice = updated.choice
                })
        ) {
            ForEach(AppAppearance.allCases) { appearance in
                Text(appearance.displayName).tag(appearance)
            }
        }
        .pickerStyle(.segmented)
        .disabled(setting.isForced)
        .accessibilityHint(setting.isForced ? setting.note : "")
    }
}

/// See ``SwiftUI/View/themedRoot()``.
private struct ThemedRoot: ViewModifier {
    @AppStorage(AppTheme.storageKey) private var theme: AppTheme = .defaultTheme
    @AppStorage(AppAppearance.storageKey) private var appearance: AppAppearance = .system

    /// The appearance every window shows. The screenshot override (`-ThirteenQAAppearance`)
    /// stands in for the stored choice; an always-dark theme still wins over both.
    private var effective: AppAppearance {
        AppearanceSetting(choice: QAOptions.forcedAppearance ?? appearance, theme: theme).effective
    }

    func body(content: Content) -> some View {
        content
            .theme(theme)
            // Every window root runs this, so a new iPad window picks up the pinned appearance.
            .onChange(of: effective, initial: true) { _, effective in effective.apply() }
    }
}

extension View {
    /// Applies the user's stored theme (`@AppStorage`) to a scene's root, a sheet or a popover:
    /// the environment theme, the control tint and the appearance (the pinned one, or dark for
    /// an always-dark theme). Every window follows a change at once.
    func themedRoot() -> some View {
        modifier(ThemedRoot())
    }
}
