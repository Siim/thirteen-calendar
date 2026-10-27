import AppKit
import Foundation
import SwiftUI
import Testing

/// A throwaway defaults suite per test, so the settings tests do not touch the user's defaults.
private func scratchDefaults() -> UserDefaults {
    let name = "ThirteenThemeTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
}

/// A colour of the generated themes, resolved in the light (Aqua) or dark (Dark Aqua) appearance.
private struct Resolved: Equatable, CustomStringConvertible {
    let red: Double, green: Double, blue: Double

    init(_ color: Color, dark: Bool) {
        let platform = NSColor(color)
        var components = (0.0, 0.0, 0.0)
        NSAppearance(named: dark ? .darkAqua : .aqua)!.performAsCurrentDrawingAppearance {
            let srgb = platform.usingColorSpace(.sRGB)!
            components = (srgb.redComponent, srgb.greenComponent, srgb.blueComponent)
        }
        (red, green, blue) = components
    }

    init(red: Double, green: Double, blue: Double) { (self.red, self.green, self.blue) = (red, green, blue) }

    static let white = Resolved(red: 1, green: 1, blue: 1)

    var luminance: Double {
        func channel(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    }

    func contrast(_ other: Resolved) -> Double {
        let (a, b) = (luminance, other.luminance)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    var description: String {
        String(format: "#%02X%02X%02X", Int((red * 255).rounded()), Int((green * 255).rounded()), Int((blue * 255).rounded()))
    }
}

@Suite("Themes")
struct ThemeTests {
    @Test func groupsListTheAdaptiveThemesThenTheDarkOnes() {
        #expect(ThemeGroup.adaptive.themes == [.almanac, .graphite, .slate, .forest, .mono])
        #expect(ThemeGroup.dark.themes == [.obsidian, .midnight, .phosphor])
        #expect(ThemeGroup.allCases.flatMap(\.themes) == AppTheme.ordered)
        #expect(Set(AppTheme.ordered) == Set(AppTheme.allCases))
        #expect(ThemeGroup.dark.displayName == "Dark")
        #expect(AppTheme.defaultTheme.group == .adaptive)
    }

    @Test("Only the dark group forces a colour scheme, and it is dark", arguments: AppTheme.allCases)
    func forcedColorScheme(_ theme: AppTheme) {
        #expect(theme.isAlwaysDark == (theme.group == .dark))
        #expect(theme.forcedColorScheme == (theme.isAlwaysDark ? .dark : nil))
    }

    @Test("An always-dark theme has one set of colours, whatever the appearance", arguments: ThemeGroup.dark.themes)
    func alwaysDarkColoursIgnoreTheAppearance(_ theme: AppTheme) {
        let roles: [ThemeColor.Role] = [
            .paper, .paperRaised, .paperSunk, .ink, .inkSecondary, .inkTertiary, .rule, .accent, .accentText,
            .accentWash, .onAccent, .controlTint, .foil, .foilWash, .onFoil, .focus,
        ]
        for role in roles {
            let color = ThemeColor(role).color(for: theme)
            #expect(Resolved(color, dark: false) == Resolved(color, dark: true), "\(theme) \(role)")
        }
    }

    @Test("Adaptive themes differ between light and dark", arguments: ThemeGroup.adaptive.themes)
    func adaptiveThemesHaveBothModes(_ theme: AppTheme) {
        let paper = theme.colors.paper
        #expect(Resolved(paper, dark: false).luminance > 0.7)
        #expect(Resolved(paper, dark: true).luminance < 0.05)
    }

    @Test("Marks without colour exactly where the accent text is the ink", arguments: AppTheme.allCases)
    func marksWithoutColorMatchesTheTokens(_ theme: AppTheme) {
        let sameInBoth = [false, true].allSatisfy { dark in
            Resolved(theme.colors.accentText, dark: dark) == Resolved(theme.colors.ink, dark: dark)
        }
        #expect(theme.marksWithoutColor == sameInBoth)
    }

    /// (The other half, Differentiate Without Colour, is a read-only system setting.)
    @Test("The environment marks without colour in Mono only, by default", arguments: AppTheme.allCases)
    func environmentFollowsTheTheme(_ theme: AppTheme) {
        var environment = EnvironmentValues()
        environment.appTheme = theme
        #expect(environment.marksWithoutColor == (theme == .mono))
    }

    /// The Mac sidebar draws its selected row as white text on the control tint, and iOS and macOS
    /// draw white on it in date pickers and segmented controls (design/DECISIONS.md, "Follow-ups").
    @Test("White on the control tint reaches 3:1, and the dark tint 4.5:1 on every paper", arguments: AppTheme.allCases)
    func controlTintBand(_ theme: AppTheme) {
        let colors = theme.colors
        for dark in theme.isAlwaysDark ? [true] : [false, true] {
            let tint = Resolved(colors.controlTint, dark: dark)
            #expect(Resolved.white.contrast(tint) >= 3, "\(theme) \(dark ? "dark" : "light"): white on \(tint)")
            for paper in [colors.paper, colors.paperRaised, colors.paperSunk] {
                let ratio = tint.contrast(Resolved(paper, dark: dark))
                #expect(ratio >= 4.5, "\(theme) \(dark ? "dark" : "light"): tint \(tint) on paper is \(ratio)")
            }
        }
    }
}

@Suite("Appearance setting")
struct AppearanceSettingTests {
    @Test func followsTheChoiceInAnAdaptiveTheme() {
        for choice in AppAppearance.allCases {
            let setting = AppearanceSetting(choice: choice, theme: .graphite)
            #expect(!setting.isForced)
            #expect(setting.effective == choice)
            #expect(setting.shown == choice)
        }
        #expect(AppAppearance.system.colorScheme == nil)
        #expect(AppAppearance.light.colorScheme == .light)
        #expect(AppAppearance.dark.colorScheme == .dark)
    }

    @Test("An always-dark theme forces dark over every choice", arguments: ThemeGroup.dark.themes)
    func forcesDark(_ theme: AppTheme) {
        for choice in AppAppearance.allCases {
            let setting = AppearanceSetting(choice: choice, theme: theme)
            #expect(setting.isForced)
            #expect(setting.effective == .dark)
            #expect(setting.shown == .dark, "the disabled control shows what the app shows")
            #expect(setting.effective.colorScheme == theme.forcedColorScheme)
        }
    }

    @Test func picksAreIgnoredWhileForced() {
        var setting = AppearanceSetting(choice: .light, theme: .midnight)
        setting.select(.system)
        #expect(setting.choice == .light)
        #expect(setting.effective == .dark)
    }

    @Test("Switching back to a light and dark theme restores the stored choice")
    func restoresTheChoice() {
        let defaults = scratchDefaults()
        defaults.set(AppAppearance.light.rawValue, forKey: AppAppearance.storageKey)
        defaults.set(AppTheme.slate.rawValue, forKey: AppTheme.storageKey)
        #expect(AppearanceSetting(defaults: defaults).effective == .light)

        // Settings stores only the theme; the Appearance choice stays as it was.
        defaults.set(AppTheme.phosphor.rawValue, forKey: AppTheme.storageKey)
        let forced = AppearanceSetting(defaults: defaults)
        #expect(forced.effective == .dark)
        #expect(forced.choice == .light)
        #expect(defaults.string(forKey: AppAppearance.storageKey) == AppAppearance.light.rawValue)

        defaults.set(AppTheme.almanac.rawValue, forKey: AppTheme.storageKey)
        let restored = AppearanceSetting(defaults: defaults)
        #expect(!restored.isForced)
        #expect(restored.effective == .light)
    }

    @Test func missingOrUnknownValuesFallBack() {
        let defaults = scratchDefaults()
        #expect(AppearanceSetting(defaults: defaults) == AppearanceSetting(choice: .system, theme: .defaultTheme))
        defaults.set("sepia", forKey: AppAppearance.storageKey)
        defaults.set("harbor", forKey: AppTheme.storageKey)
        #expect(AppearanceSetting(defaults: defaults) == AppearanceSetting(choice: .system, theme: .defaultTheme))
    }

    @Test func notesExplainTheState() {
        let forced = AppearanceSetting(choice: .light, theme: .obsidian).note
        #expect(forced.hasPrefix("Obsidian is always dark."))
        #expect(forced.contains("light and dark theme"))
        let free = AppearanceSetting(choice: .system, theme: .mono).note
        #expect(free.hasPrefix("System follows"))
        for note in [forced, free] {
            #expect(!note.contains("\u{2013}") && !note.contains("\u{2014}"))
        }
    }
}
