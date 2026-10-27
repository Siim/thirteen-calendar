import SwiftUI
import ThirteenKit

/// 12 vs 13 on one day-of-year axis (SPEC §3 month alignment): the ragged Gregorian months on
/// top, the 13 equal months and intercalary day(s) below, with every month boundary drawn so the
/// mismatch is visible at a glance. Drawn with `Canvas`; VoiceOver gets one element per month.
struct MonthRibbonView: View {
    let alignment: MonthAlignment
    /// Day-of-year to mark (today), if it is in this year.
    var markedDayOfYear: Int?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.appTheme) private var theme
    @Environment(\.marksWithoutColor) private var marksWithoutColor

    private let bandHeight: CGFloat = 38
    private let gap: CGFloat = 18
    private let captionHeight: CGFloat = 18

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Canvas { context, size in draw(in: &context, size: size) }
                .frame(height: captionHeight * 2 + bandHeight * 2 + gap)
                // The band captions are drawn into fixed 18 pt rows; VoiceOver users get the
                // per-month children below, so the drawing stops growing at XL text.
                .dynamicTypeSize(...DynamicTypeSize.xLarge)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Month boundaries, \(alignment.year)")
                .accessibilityValue(
                    "12 Gregorian months of 28 to 31 days above 13 \(alignment.system.shortName) months of 28 days")
                .accessibilityChildren { accessibilityRows }
            legend
        }
    }

    private var legend: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Spacing.l) { legendItems }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), alignment: .leading)], alignment: .leading, spacing: Spacing.xs) {
                legendItems
            }
        }
        .font(Typography.text(.caption))
        .foregroundStyle(Palette.inkSecondary)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var legendItems: some View {
        legendSwatch(GregorianBandStyle(opacity: 0.35), "Gregorian month")
        legendSwatch(Palette.accent.opacity(0.35), "\(alignment.system.shortName) month")
        legendSwatch(Palette.accent, "Intercalary day")
        if markedDayOfYear != nil { legendSwatch(Palette.ink, "Today") }
    }

    private func legendSwatch(_ style: some ShapeStyle, _ title: String) -> some View {
        HStack(spacing: Spacing.xs) {
            RoundedRectangle(cornerRadius: 2).fill(style).frame(width: 14, height: 10)
            Text(title)
        }
    }

    // MARK: Drawing

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let days = CGFloat(alignment.daysInYear)
        let width = size.width
        func x(_ dayOfYear: Int) -> CGFloat { (CGFloat(dayOfYear - 1) / days * width).rounded() }

        let topY = captionHeight
        let bottomY = captionHeight + bandHeight + gap
        let caption = Typography.font(.mono, fixedSize: 10, weight: .medium)
        let foil = Palette.foil.color(for: theme)
        let accent = Palette.accent.color(for: theme)
        let ink = Palette.ink.color(for: theme)

        // Captions.
        context.draw(
            Text("12 · GREGORIAN").font(caption).tracking(0.8).foregroundStyle(foil),
            at: CGPoint(x: 0, y: captionHeight / 2), anchor: .leading)
        context.draw(
            Text("13 · \(alignment.system.shortName.uppercased())").font(caption).tracking(0.8)
                .foregroundStyle(Palette.accentText.color(for: theme)),
            at: CGPoint(x: 0, y: bottomY + bandHeight + captionHeight / 2), anchor: .leading)

        // Gregorian months (alternating tones), 2 pt surface gaps between them. Hatched in Mono
        // (GregorianBandStyle), where the foil and the accent are both greys.
        for span in alignment.gregorianMonths {
            let rect = CGRect(
                x: x(span.startDayOfYear) + 1, y: topY,
                width: max(x(span.endDayOfYear + 1) - x(span.startDayOfYear) - 2, 1), height: bandHeight)
            context.fill(
                Path(roundedRect: rect, cornerRadius: 4), with: .style(GregorianBandStyle(opacity: gregorianTone(span.month))))
        }

        // 13-month months and intercalary days.
        for span in alignment.thirteenMonths {
            let rect = CGRect(
                x: x(span.startDayOfYear) + 1, y: bottomY,
                width: max(x(span.endDayOfYear + 1) - x(span.startDayOfYear) - 2, 1), height: bandHeight)
            let tone = span.month.isMultiple(of: 2) ? 0.2 : 0.34
            context.fill(Path(roundedRect: rect, cornerRadius: 4), with: .color(accent.opacity(tone)))
        }
        for day in alignment.intercalary {
            let center = (x(day.dayOfYear) + x(day.dayOfYear + 1)) / 2
            let rect = CGRect(x: center - 1.5, y: bottomY - 3, width: 3, height: bandHeight + 6)
            context.fill(Path(roundedRect: rect, cornerRadius: 1.5), with: .color(accent))
        }

        // Today, under the labels.
        if let marked = markedDayOfYear {
            let center = (x(marked) + x(marked + 1)) / 2
            // Solid outside the bands, faint across them so month labels stay legible.
            var outside = Path()
            outside.move(to: CGPoint(x: center, y: topY - 4))
            outside.addLine(to: CGPoint(x: center, y: topY))
            outside.move(to: CGPoint(x: center, y: topY + bandHeight))
            outside.addLine(to: CGPoint(x: center, y: bottomY))
            outside.move(to: CGPoint(x: center, y: bottomY + bandHeight))
            outside.addLine(to: CGPoint(x: center, y: bottomY + bandHeight + 4))
            context.stroke(outside, with: .color(ink), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
            var inside = Path()
            inside.move(to: CGPoint(x: center, y: topY))
            inside.addLine(to: CGPoint(x: center, y: topY + bandHeight))
            inside.move(to: CGPoint(x: center, y: bottomY))
            inside.addLine(to: CGPoint(x: center, y: bottomY + bandHeight))
            context.stroke(inside, with: .color(ink.opacity(0.35)), lineWidth: 1)
            var cap = Path()
            cap.addEllipse(in: CGRect(x: center - 4, y: topY - 10, width: 8, height: 8))
            context.fill(cap, with: .color(ink))
        }

        labels(alignment.gregorianMonths.map { ($0.monthInfo.shortName, $0.startDayOfYear, $0.endDayOfYear) },
               y: topY, x: x, context: &context,
               haloTones: marksWithoutColor ? alignment.gregorianMonths.map { gregorianTone($0.month) } : nil)
        labels(alignment.thirteenMonths.map { ($0.monthInfo.shortName, $0.startDayOfYear, $0.endDayOfYear) },
               y: bottomY, x: x, context: &context)

        // Boundary connectors across the gap: Gregorian month starts (foil, from above) and
        // 13-month starts (accent, from below). Their mismatch is the point of the chart.
        for span in alignment.gregorianMonths.dropFirst() {
            var path = Path()
            path.move(to: CGPoint(x: x(span.startDayOfYear), y: topY + bandHeight))
            path.addLine(to: CGPoint(x: x(span.startDayOfYear), y: topY + bandHeight + gap * 0.55))
            context.stroke(path, with: .color(foil), lineWidth: 1)
        }
        for span in alignment.thirteenMonths.dropFirst() {
            var path = Path()
            path.move(to: CGPoint(x: x(span.startDayOfYear), y: bottomY))
            path.addLine(to: CGPoint(x: x(span.startDayOfYear), y: bottomY - gap * 0.55))
            context.stroke(path, with: .color(accent), lineWidth: 1)
        }
    }

    /// The foil opacity of a Gregorian month's band: alternating tones.
    private func gregorianTone(_ month: Int) -> Double { month.isMultiple(of: 2) ? 0.22 : 0.36 }

    /// Month labels for one band, all in the same form: the short name (`Jan`) if every one fits
    /// its month, else the initial (`J`), else none. `haloTones` (hatched Gregorian bands, one
    /// tone per month) puts a halo in the band's wash around each label, as
    /// ``SwiftUI/View/gregorianBandLabel(opacity:)`` does, so the hatching stays out of the letters.
    private func labels(
        _ months: [(name: String, start: Int, end: Int)], y: CGFloat, x: (Int) -> CGFloat,
        context: inout GraphicsContext, haloTones: [Double]? = nil
    ) {
        let font = Typography.font(.mono, fixedSize: 10, weight: .medium)
        let ink = Palette.ink.color(for: theme)
        let rects = months.map { CGRect(x: x($0.start), y: y, width: x($0.end + 1) - x($0.start), height: bandHeight) }
        for form in [{ (name: String) in name }, { (name: String) in String(name.prefix(1)) }] {
            let resolved = months.map { context.resolve(Text(form($0.name)).font(font).foregroundStyle(ink)) }
            let fits = zip(resolved, rects).allSatisfy { $0.measure(in: $1.size).width + 3 <= $1.width }
            guard fits else { continue }
            for (index, (text, rect)) in zip(resolved, rects).enumerated() {
                let center = CGPoint(x: rect.midX, y: rect.midY)
                if let tone = haloTones?[index] {
                    drawHalo(form(months[index].name), font: font, at: center, tone: tone, in: context)
                }
                context.draw(text, at: center, anchor: .center)
            }
            return
        }
    }

    /// The halo of a label on a hatched Gregorian band: the glyphs 1 pt out in every direction in
    /// the card's colour, then in the band's foil wash as one layer.
    private func drawHalo(_ label: String, font: Font, at center: CGPoint, tone: Double, in context: GraphicsContext) {
        let card = context.resolve(Text(label).font(font).foregroundStyle(Palette.paperRaised.color(for: theme)))
        let wash = context.resolve(Text(label).font(font).foregroundStyle(Palette.foil.color(for: theme)))
        func points() -> [CGPoint] { Hatch.haloOffsets.map { CGPoint(x: center.x + $0.width, y: center.y + $0.height) } }
        for point in points() { context.draw(card, at: point, anchor: .center) }
        var washContext = context
        washContext.opacity = tone * Hatch.washOpacity
        washContext.drawLayer { layer in
            for point in points() { layer.draw(wash, at: point, anchor: .center) }
        }
    }

    // MARK: Accessibility

    @ViewBuilder private var accessibilityRows: some View {
        ForEach(alignment.gregorianMonths) { span in
            Text(
                "Gregorian \(span.monthInfo.name): \(span.length) days, \(span.start.formatted(.short)) to \(span.end.formatted(.short)) in \(alignment.system.shortName)"
            )
        }
        ForEach(alignment.thirteenMonths) { span in
            Text(
                "\(alignment.system.shortName) \(span.monthInfo.name): 28 days, Gregorian \(span.start.formatted(.short)) to \(span.end.formatted(.short))"
            )
        }
        ForEach(alignment.intercalary) { day in
            Text("\(day.name): Gregorian \(day.gregorian.formatted(.short)), outside any month")
        }
    }
}
