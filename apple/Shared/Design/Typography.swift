import CoreText
import OSLog
import SwiftUI

/// The bundled typefaces (design/DECISIONS.md): Geist for display and text, Geist Mono for
/// labels, small figures and code-like captions. Both are SIL Open Font License 1.1 (see
/// `Resources/Fonts/OFL.txt`), static TTFs from github.com/vercel/geist-font v1.8.1.
///
/// The files sit in `Shared/Resources/Fonts`, which XcodeGen copies into the app bundle, and are
/// registered for this process at launch, so no Info.plist entry is needed.
enum AppFonts {
    /// PostScript names of the bundled faces (also their file names).
    static let faces = [
        "Geist-Regular", "Geist-Medium", "Geist-SemiBold", "Geist-Bold",
        "GeistMono-Regular", "GeistMono-Medium", "GeistMono-SemiBold", "GeistMono-Bold",
    ]

    private static let logger = Logger(subsystem: "com.haugas.thirteen", category: "fonts")

    /// Registers the bundled faces with Core Text for this process. Synchronous for process
    /// scope, so call it before the first view is built (`ThirteenApp.init`). Idempotent.
    @MainActor
    static func register(bundle: Bundle = .main) {
        guard !isRegistered else { return }
        isRegistered = true
        let urls = faces.compactMap { bundle.url(forResource: $0, withExtension: "ttf") }
        if urls.count != faces.count {
            logger.error("Missing bundled fonts: found \(urls.count) of \(faces.count)")
        }
        CTFontManagerRegisterFontURLs(urls as CFArray, .process, true) { errors, _ in
            for case let error as NSError in errors as NSArray {
                // Already registered (e.g. by a second app instance in previews) is fine.
                if error.code != CTFontManagerError.alreadyRegistered.rawValue {
                    logger.error("Font registration failed: \(error.localizedDescription, privacy: .public)")
                }
            }
            return true
        }
        let missing = missingFaces()
        if missing.isEmpty {
            logger.debug("Registered \(faces.count) Geist faces")
        } else {
            logger.error("Fonts not available after registration: \(missing.joined(separator: ", "), privacy: .public)")
        }
    }

    @MainActor private static var isRegistered = false

    /// Bundled faces Core Text cannot resolve by PostScript name (empty once registered).
    static func missingFaces() -> [String] {
        faces.filter { name in
            let font = CTFontCreateWithName(name as CFString, 12, nil)
            return CTFontCopyPostScriptName(font) as String != name
        }
    }
}

/// Typography: Geist through `Font.custom(_:size:relativeTo:)`, so every size follows Dynamic Type
/// like the system text styles it is relative to, and numerals use tabular figures so they do not
/// jiggle when they change. System chrome (tab bar, toolbars, navigation titles, menus, alerts,
/// system controls) keeps the system font.
enum Typography {
    enum Family {
        /// Geist: display and text.
        case sans
        /// Geist Mono: labels, small figures, codes.
        case mono
    }

    /// Geist display type (titles, names, numerals) with tabular figures. Headlines default to
    /// semibold like the system style.
    static func display(_ style: Font.TextStyle, weight: Font.Weight? = nil) -> Font {
        font(.sans, style, weight: weight ?? defaultWeight(style)).monospacedDigit()
    }

    /// Geist running text: sentences, explanations, values.
    static func text(_ style: Font.TextStyle, weight: Font.Weight? = nil) -> Font {
        font(.sans, style, weight: weight ?? defaultWeight(style))
    }

    /// Geist Mono: eyebrows, axis and grid labels, small figures and codes.
    static func mono(_ style: Font.TextStyle, weight: Font.Weight? = nil) -> Font {
        font(.mono, style, weight: weight ?? defaultWeight(style))
    }

    /// A face of `family` at the system size of `style`, scaling with Dynamic Type.
    static func font(_ family: Family, _ style: Font.TextStyle, weight: Font.Weight) -> Font {
        .custom(faceName(family, weight: weight), size: baseSize(style), relativeTo: style)
    }

    /// A face of `family` at a fixed point size (already scaled by the caller, e.g. with
    /// `@ScaledMetric`).
    static func font(_ family: Family, fixedSize size: CGFloat, weight: Font.Weight) -> Font {
        .custom(faceName(family, weight: weight), fixedSize: size)
    }

    /// The PostScript name of the bundled face closest to `weight` (Regular, Medium, SemiBold,
    /// Bold).
    static func faceName(_ family: Family, weight: Font.Weight) -> String {
        let face: String
        switch weight {
        case .medium: face = "Medium"
        case .semibold: face = "SemiBold"
        case .bold, .heavy, .black: face = "Bold"
        default: face = "Regular"
        }
        return "\(family == .sans ? "Geist" : "GeistMono")-\(face)"
    }

    private static func defaultWeight(_ style: Font.TextStyle) -> Font.Weight {
        style == .headline ? .semibold : .regular
    }

    /// The point size of a text style at the default content size, per platform (Apple HIG
    /// typography tables), so Geist sits where the system style would.
    static func baseSize(_ style: Font.TextStyle) -> CGFloat {
        #if os(macOS)
        switch style {
        case .largeTitle: 26
        case .title: 22
        case .title2: 17
        case .title3: 15
        case .headline, .body: 13
        case .callout: 12
        case .subheadline: 11
        case .footnote, .caption, .caption2: 10
        default: 13
        }
        #else
        switch style {
        case .largeTitle: 34
        case .title: 28
        case .title2: 22
        case .title3: 20
        case .headline, .body: 17
        case .callout: 16
        case .subheadline: 15
        case .footnote: 13
        case .caption: 12
        case .caption2: 11
        default: 17
        }
        #endif
    }
}

/// Letter spacing of the type roles in em, as on the web (`--t-tracking-*` in tokens.css).
enum Tracking {
    /// Big numerals (design/DECISIONS.md: about -0.04 em at display sizes).
    static let numeral: CGFloat = -0.04
    /// Display words: month and intercalary day names on the date plate.
    static let display: CGFloat = -0.035
    /// Titles: card titles, month cards, headings.
    static let title: CGFloat = -0.025
    /// Uppercase Geist Mono labels (eyebrows).
    static let caps: CGFloat = 0.08
}

/// A bundled face at a text style's size, scaled with Dynamic Type through `@ScaledMetric` (which
/// honours `dynamicTypeSize` caps), with tracking in em of that size and optional tabular figures.
struct TypefaceModifier: ViewModifier {
    @ScaledMetric private var size: CGFloat
    private let family: Typography.Family
    private let weight: Font.Weight
    private let tracking: CGFloat
    private let tabular: Bool
    private let topTrim: CGFloat

    init(
        _ family: Typography.Family, size: CGFloat, relativeTo style: Font.TextStyle, weight: Font.Weight,
        tracking: CGFloat, tabular: Bool, topTrim: CGFloat = 0
    ) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: style)
        self.family = family
        self.weight = weight
        self.tracking = tracking
        self.tabular = tabular
        self.topTrim = topTrim
    }

    func body(content: Content) -> some View {
        let font = Typography.font(family, fixedSize: size, weight: weight)
        content
            .font(tabular ? font.monospacedDigit() : font)
            .tracking(tracking * size)
            .padding(.top, -topTrim * size)
    }
}

/// Uppercase, tracked Geist Mono label used above headings and inside plates.
struct EyebrowStyle: ViewModifier {
    var color: ThemeColor = Palette.inkTertiary

    func body(content: Content) -> some View {
        content
            .typeface(.mono, .caption, weight: .medium, tracking: Tracking.caps)
            .textCase(.uppercase)
            .foregroundStyle(color)
    }
}

extension View {
    /// A bundled face at the size of `style`, scaling with Dynamic Type, with `tracking` in em.
    func typeface(
        _ family: Typography.Family = .sans, _ style: Font.TextStyle, weight: Font.Weight = .regular,
        tracking: CGFloat = 0, tabular: Bool = false
    ) -> some View {
        modifier(
            TypefaceModifier(
                family, size: Typography.baseSize(style), relativeTo: style, weight: weight, tracking: tracking,
                tabular: tabular))
    }

    /// Geist title type: semibold, tabular figures and tight title tracking (-0.025 em).
    func titleFont(_ style: Font.TextStyle, weight: Font.Weight = .semibold) -> some View {
        typeface(.sans, style, weight: weight, tracking: Tracking.title, tabular: true)
    }

    /// A big Geist numeral (the Today hero's day, year headers, statistics) of `size` points at the
    /// default Dynamic Type size, scaling relative to `style`: bold, tabular and tightly tracked
    /// (-0.04 em, design/DECISIONS.md).
    ///
    /// Geist's line box reaches 1.0 em above the baseline while its figures stop at the cap height
    /// (0.71 em); `trimsTop` removes most of that empty band, so a big day number sits close to
    /// the label above it (the web sets these numerals with a line height of 0.76).
    func displayNumeral(
        size: CGFloat, relativeTo style: Font.TextStyle = .largeTitle, weight: Font.Weight = .bold,
        trimsTop: Bool = false
    ) -> some View {
        modifier(
            TypefaceModifier(
                .sans, size: size, relativeTo: style, weight: weight, tracking: Tracking.numeral, tabular: true,
                topTrim: trimsTop ? 0.18 : 0))
    }

    /// Display words (the date plate's month or intercalary day name) of `size` points at the
    /// default Dynamic Type size: semibold Geist, display tracking (-0.035 em).
    func displayWord(size: CGFloat, relativeTo style: Font.TextStyle = .largeTitle, weight: Font.Weight = .semibold)
        -> some View
    {
        modifier(
            TypefaceModifier(
                .sans, size: size, relativeTo: style, weight: weight, tracking: Tracking.display, tabular: true))
    }

    /// Uppercase tracked Geist Mono caption ("eyebrow").
    func eyebrow(_ color: ThemeColor = Palette.inkTertiary) -> some View {
        modifier(EyebrowStyle(color: color))
    }
}
