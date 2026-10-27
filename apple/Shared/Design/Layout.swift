import SwiftUI
#if os(macOS)
import AppKit
#endif

/// Spacing scale (4 pt base), shared by every screen.
enum Spacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    static let xxxl: CGFloat = 48
}

/// Corner radii (continuous corners).
enum Radius {
    static let cell: CGFloat = 8
    static let control: CGFloat = 12
    static let card: CGFloat = 22
    static let hero: CGFloat = 32
}

/// Content widths for readable layouts on iPad and Mac.
enum Measure {
    /// Maximum width of single-column content.
    static let column: CGFloat = 760
    /// Maximum width of wide (multi-column) content.
    static let page: CGFloat = 1280
    /// Width above which screens use two columns.
    static let twoColumnThreshold: CGFloat = 760
}

/// A raised paper card with an optional title: the basic container of every screen.
struct Card<Content: View>: View {
    var title: String?
    var subtitle: String?
    var padding: CGFloat = Spacing.l
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            if title != nil || subtitle != nil {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    // Wrap, never truncate: in the Compare stat grid a subtitle was cut to
                    // "…weekday and lengt…" on iPad.
                    if let title {
                        Text(title)
                            .titleFont(.title3)
                            .foregroundStyle(Palette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                    }
                    if let subtitle {
                        Text(subtitle)
                            .font(Typography.text(.subheadline))
                            .foregroundStyle(Palette.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            content
        }
        .padding(padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.paperRaised, in: .rect(cornerRadius: Radius.card))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Palette.rule, lineWidth: 1)
        }
    }
}

/// The scrolling page every feature screen uses: paper background, readable width, padding.
struct PageScroll<Content: View>: View {
    var maxWidth: CGFloat = Measure.page
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                content
            }
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, Spacing.m)
            .frame(maxWidth: maxWidth)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(QAOptions.initialScrollAnchor)
        .background(Palette.paper)
    }
}

/// See ``SwiftUI/View/accentBorderedButtonStyle()``.
private struct AccentBorderedButtonStyle: ViewModifier {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.appTheme) private var theme

    func body(content: Content) -> some View {
        content
            .buttonStyle(.bordered)
            .tint(Palette.accent.color(for: theme))
            // An explicit style replaces the system's disabled dimming, so fade the ink here.
            .foregroundStyle(isEnabled ? Palette.ink : Palette.ink.opacity(0.35))
    }
}

/// See ``SwiftUI/View/wrappingButtonShape()``.
private struct WrappingButtonShape: ViewModifier {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func body(content: Content) -> some View {
        content.buttonBorderShape(
            dynamicTypeSize.isAccessibilitySize ? .roundedRectangle(radius: Radius.control) : .automatic)
    }
}

extension View {
    /// The app's bordered button: the accent wash with an ink label, like the web's buttons.
    /// iOS draws a `.bordered` label in the tint colour on a wash of that colour, and the icon
    /// orange on its own wash is only 2.5:1 in light mode (still under 4.5:1 with AccentText);
    /// ink is over 11:1 in both themes. On the Mac, bordered buttons keep the system look.
    /// Apply `.disabled` outside this modifier, so the label can fade when disabled.
    func accentBorderedButtonStyle() -> some View {
        modifier(AccentBorderedButtonStyle())
    }

    /// A rounded rectangle instead of the default capsule at accessibility text sizes, where a
    /// bordered button's label wraps onto several lines and a capsule turns into a blob. Apply
    /// to buttons whose label can wrap (not to icon-only or circular buttons).
    func wrappingButtonShape() -> some View {
        modifier(WrappingButtonShape())
    }

    /// Reports the view's width into `width` (for container-width based layouts that work on
    /// iPhone, iPad and Mac alike).
    func readWidth(into width: Binding<CGFloat>) -> some View {
        onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width.wrappedValue = $0 }
    }
}
