import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Named colours of the design (SPEC §6), one per colour role of `design/tokens.json`. Each
/// resolves against the theme in the environment (``SwiftUI/EnvironmentValues/appTheme``) and
/// then the colour scheme, so `.foregroundStyle(Palette.ink)` draws the chosen theme's ink in
/// light or dark mode. The values come from the generated `ThemeTokens.swift`.
///
/// Where an API needs a concrete `Color` (Canvas shading, gradients, glass tints, Charts, system
/// control tints), read the theme from the environment and use ``ThemeColor/color(for:)``.
enum Palette {
    /// Page background.
    static let paper = ThemeColor(.paper)
    /// Cards and raised surfaces.
    static let paperRaised = ThemeColor(.paperRaised)
    /// Wells, grid cells and inset surfaces.
    static let paperSunk = ThemeColor(.paperSunk)
    /// Primary text (12:1 or more on every paper).
    static let ink = ThemeColor(.ink)
    /// Secondary text (7:1 or more on every paper).
    static let inkSecondary = ThemeColor(.inkSecondary)
    /// Tertiary text and captions (4.5:1 or more on every paper).
    static let inkTertiary = ThemeColor(.inkTertiary)
    /// Hairlines and card strokes.
    static let rule = ThemeColor(.rule)
    /// The theme's signal colour, for fills: today's cell, progress, marks. Never for text on
    /// paper (Almanac's `#ea580c` is only 3.1:1 there); text uses ``accentText``.
    static let accent = ThemeColor(.accent)
    /// Accent for text and icons on paper and on ``accentWash`` (4.5:1 or more).
    static let accentText = ThemeColor(.accentText)
    /// The `.tint` of system controls: sidebar selection, toolbar items, links, switches (4.5:1 or
    /// more on paper). Applied at every scene root by `themedRoot()`. The iPhone tab bar takes
    /// ``accentText`` instead: it draws its selection over its own lighter glass (`PhoneTabView`).
    static let controlTint = ThemeColor(.controlTint)
    /// Soft opaque accent fill behind accent text.
    static let accentWash = ThemeColor(.accentWash)
    /// The Gregorian "foil": a colour clearly apart from the accent, for everything 12-month.
    static let foil = ThemeColor(.foil)
    /// Soft opaque foil fill.
    static let foilWash = ThemeColor(.foilWash)
    /// Text and glyphs on a solid accent fill.
    static let onAccent = ThemeColor(.onAccent)
    /// Text and glyphs on a solid foil fill.
    static let onFoil = ThemeColor(.onFoil)
    /// Keyboard focus ring (3:1 or more against paper).
    static let focus = ThemeColor(.focus)
    /// Errors and destructive actions (the boards' `.errline`, `.btn.danger`, G3 and A2): `#b42318`
    /// in light mode, `#f97066` in dark, 5.1:1 or more on every paper, raised and sunk paper of the
    /// eight themes (system red is 2.3 to 3.3:1 on the light papers, §2.20).
    static let danger = DangerColor()
}

/// ``Palette/danger``: the boards' error and destructive red, by colour scheme.
struct DangerColor: ShapeStyle, Hashable {
    static let light = Color(.sRGB, red: 180 / 255.0, green: 35 / 255.0, blue: 24 / 255.0)
    static let dark = Color(.sRGB, red: 249 / 255.0, green: 112 / 255.0, blue: 102 / 255.0)

    func resolve(in environment: EnvironmentValues) -> Color.Resolved {
        (environment.colorScheme == .dark ? Self.dark : Self.light).resolve(in: environment)
    }
}

/// One colour role of the current theme, as a `ShapeStyle` that resolves against the
/// environment's ``AppTheme`` (and then its colour scheme). Use it wherever SwiftUI takes a
/// shape style: `foregroundStyle`, `fill`, `background`, `strokeBorder`, `overlay`.
struct ThemeColor: ShapeStyle, Hashable {
    /// The colour roles of `design/tokens.json` used by the apps.
    enum Role: Hashable, Sendable {
        case paper, paperRaised, paperSunk
        case ink, inkSecondary, inkTertiary
        case rule
        case accent, accentText, accentWash, onAccent, controlTint
        case foil, foilWash, onFoil
        case focus
    }

    /// The role, or `nil` for a clear colour (so `isOn ? Palette.accent : .clear` type-checks).
    let role: Role?
    /// Extra opacity applied on top of the role's own alpha.
    let alpha: Double

    init(_ role: Role?, alpha: Double = 1) {
        self.role = role
        self.alpha = alpha
    }

    /// No colour.
    static let clear = ThemeColor(nil)

    /// The same role at `opacity` times its current opacity.
    func opacity(_ opacity: Double) -> ThemeColor {
        ThemeColor(role, alpha: alpha * opacity)
    }

    /// The role's colour in `theme`. Still dynamic: it resolves light or dark wherever it is used.
    func color(for theme: AppTheme) -> Color {
        guard let role else { return .clear }
        let colors = theme.colors
        let base: Color =
            switch role {
            case .paper: colors.paper
            case .paperRaised: colors.paperRaised
            case .paperSunk: colors.paperSunk
            case .ink: colors.ink
            case .inkSecondary: colors.inkSecondary
            case .inkTertiary: colors.inkTertiary
            case .rule: colors.rule
            case .accent: colors.accent
            case .accentText: colors.accentText
            case .accentWash: colors.accentWash
            case .onAccent: colors.onAccent
            case .controlTint: colors.controlTint
            case .foil: colors.foil
            case .foilWash: colors.foilWash
            case .onFoil: colors.onFoil
            case .focus: colors.focus
            }
        return alpha == 1 ? base : base.opacity(alpha)
    }

    func resolve(in environment: EnvironmentValues) -> Color.Resolved {
        color(for: environment.appTheme).resolve(in: environment)
    }
}

// MARK: - The theme in the environment

extension AppTheme {
    /// The `UserDefaults` key of the chosen theme (`@AppStorage`): one choice for every window,
    /// the Mac menu bar extra and Settings.
    static let storageKey = "appTheme"
}

extension EnvironmentValues {
    /// The colour theme ``Palette`` colours resolve against. Set at every scene root from the
    /// user's choice (`themedRoot()`); a view can draw in another theme with `theme(_:)`.
    @Entry var appTheme: AppTheme = .defaultTheme
}

extension View {
    /// Draws this view in `theme`: ``Palette`` colours and the system control tint.
    func theme(_ theme: AppTheme) -> some View {
        environment(\.appTheme, theme)
            .tint(theme.colors.controlTint)
    }
}

// MARK: - Marks without colour

extension AppTheme {
    /// True for a theme whose accent is its ink (Mono), so a mark that other themes make in the
    /// accent colour has to be made another way (design/DECISIONS.md, "Follow-ups"): Sundays and
    /// the current month by weight, the Gregorian bands of the Compare charts with a hatch.
    /// The "Design rules" tests check that this is exactly the themes whose accent text resolves
    /// to their ink in light and dark.
    var marksWithoutColor: Bool { self == .mono }
}

extension EnvironmentValues {
    /// Whether marks are made by weight and pattern rather than colour: in Mono, and in every
    /// theme while the system's Differentiate Without Colour setting is on.
    var marksWithoutColor: Bool {
        appTheme.marksWithoutColor || accessibilityDifferentiateWithoutColor
    }
}
