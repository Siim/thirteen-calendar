import SwiftUI

/// The fill of a Gregorian band in the Compare charts (ribbon, month-length bars, quarters,
/// weekday drift): the foil at `opacity`. Where marks are made without colour (Mono, whose accent
/// is its ink, and the system's Differentiate Without Colour setting; see
/// ``SwiftUI/EnvironmentValues/marksWithoutColor``), a light foil wash with diagonal foil
/// hatching instead, so the Gregorian bands differ from the plain 13-month ones by pattern and not
/// only by tone (design/DECISIONS.md, "Follow-ups").
///
/// A `ShapeStyle`, so the same value fills SwiftUI shapes, `Canvas` paths (`.style(_:)`) and
/// Swift Charts marks (`foregroundStyle`). Text on a band uses ``SwiftUI/View/gregorianBandLabel(opacity:)``
/// (or, in a `Canvas`, ``Hatch/haloOffsets``), which keeps the hatching out of the glyphs.
struct GregorianBandStyle: ShapeStyle {
    /// Opacity of the foil in the plain fill; the hatch scales its wash and lines from it.
    var opacity: Double = 1

    func resolve(in environment: EnvironmentValues) -> AnyShapeStyle {
        let foil = Palette.foil.color(for: environment.appTheme)
        guard environment.marksWithoutColor else { return AnyShapeStyle(foil.opacity(opacity)) }
        let color = Color(foil.resolve(in: environment))
        return AnyShapeStyle(
            Hatch.paint(
                line: color.opacity(min(1, 0.15 + opacity)),
                wash: color.opacity(opacity * Hatch.washOpacity)))
    }
}

/// Diagonal hatching as a tiling image.
enum Hatch {
    /// Distance between two lines along the x axis, in points.
    static let spacing: CGFloat = 6
    /// Line width, in points.
    static let lineWidth: CGFloat = 1.5
    /// Opacity of the foil wash behind the lines, as a fraction of the band's opacity.
    static let washOpacity: Double = 0.35
    /// Where a label on a hatched band draws its halo: copies of the glyphs in the band's wash,
    /// 1 pt out in every direction, like the web's `--t-foil-halo`.
    static let haloOffsets: [CGSize] = [
        CGSize(width: -1, height: -1), CGSize(width: 0, height: -1), CGSize(width: 1, height: -1),
        CGSize(width: -1, height: 0), CGSize(width: 1, height: 0),
        CGSize(width: -1, height: 1), CGSize(width: 0, height: 1), CGSize(width: 1, height: 1),
    ]

    /// A tile of `spacing` × `spacing` points: `wash` behind 45° lines in `line` (bottom left to
    /// top right), drawn so that tiles join without seams.
    static func paint(line: Color, wash: Color) -> ImagePaint {
        let side = spacing
        let image = Image(size: CGSize(width: side, height: side), label: nil) { context in
            context.fill(Path(CGRect(x: 0, y: 0, width: side, height: side)), with: .color(wash))
            var path = Path()
            // The main diagonal, plus the two corner pieces of its neighbours.
            path.move(to: CGPoint(x: 0, y: side))
            path.addLine(to: CGPoint(x: side, y: 0))
            path.move(to: CGPoint(x: -side / 2, y: side / 2))
            path.addLine(to: CGPoint(x: side / 2, y: -side / 2))
            path.move(to: CGPoint(x: side / 2, y: side * 1.5))
            path.addLine(to: CGPoint(x: side * 1.5, y: side / 2))
            context.stroke(path, with: .color(line), lineWidth: lineWidth)
        }
        return ImagePaint(image: image, scale: 1)
    }
}

extension View {
    /// Text on a ``GregorianBandStyle`` band of the same `opacity` that sits on a card
    /// (``Palette/paperRaised``): in ink, and where the band is hatched with a 1 pt halo in the
    /// band's wash around each glyph. The lines crossing the letters made short labels ("Th", "91")
    /// noisy; with the halo they read as on a plain band, and the band around them stays hatched
    /// (the web's `--t-foil-halo`). Apply it to the text itself, before any frame or background.
    func gregorianBandLabel(opacity: Double) -> some View {
        modifier(GregorianBandLabel(opacity: opacity))
    }
}

/// See ``SwiftUI/View/gregorianBandLabel(opacity:)``.
private struct GregorianBandLabel: ViewModifier {
    let opacity: Double

    @Environment(\.marksWithoutColor) private var marksWithoutColor

    func body(content: Content) -> some View {
        content
            .foregroundStyle(Palette.ink)
            .background {
                if marksWithoutColor {
                    // The card under the band, then the band's foil wash over it as one layer (so
                    // the overlapping copies do not add up), giving the band's own colour.
                    ZStack {
                        halo(content, Palette.paperRaised)
                        halo(content, Palette.foil)
                            .compositingGroup()
                            .opacity(opacity * Hatch.washOpacity)
                    }
                    .accessibilityHidden(true)
                }
            }
    }

    private func halo(_ content: Content, _ color: ThemeColor) -> some View {
        ZStack {
            ForEach(Hatch.haloOffsets.indices, id: \.self) { index in
                content
                    .foregroundStyle(color)
                    .offset(Hatch.haloOffsets[index])
            }
        }
    }
}
