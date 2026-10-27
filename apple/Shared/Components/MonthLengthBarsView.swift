import Charts
import SwiftUI
import ThirteenKit

/// Month lengths, 12 vs 13 (SPEC §5.4): small multiples on one shared 0–31 day scale. Each bar is
/// four weeks (28 days, a light step) plus the days beyond four weeks (the strong step), so the
/// Gregorian months' 0–3 extra days stand out while the 13-month bars are exactly four weeks.
/// Tap or drag across a chart to read a month's length.
struct MonthLengthBarsView: View {
    let stats: YearStats

    @State private var selectedGregorian: String?
    @State private var selectedThirteen: String?
    @State private var width: CGFloat = 0
    @Environment(\.appTheme) private var theme
    @Environment(\.self) private var environment

    private struct Bar: Identifiable {
        let id: Int
        let name: String
        let shortName: String
        let days: Int
        var extra: Int { days - ThirteenDate.daysPerMonth }
    }

    private struct Segment: Identifiable {
        let bar: Bar
        let part: String
        let days: Int
        var id: String { "\(bar.id)-\(part)" }
    }

    private static let fourWeeks = "Four weeks"
    private static let extraDays = "Extra days"

    private var gregorianBars: [Bar] {
        GregorianMonthInfo.all.map {
            Bar(id: $0.index, name: $0.name, shortName: $0.shortName, days: stats.gregorianMonthLengths[$0.index - 1])
        }
    }

    private var thirteenBars: [Bar] {
        stats.system.months.map {
            Bar(id: $0.index, name: $0.name, shortName: $0.shortName, days: stats.thirteenMonthLengths[$0.index - 1])
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            legend
            chart(
                title: "Gregorian · 12 months of 28 to 31 days",
                bars: gregorianBars, color: Palette.foil, gregorian: true, selection: $selectedGregorian)
            chart(
                title: "\(stats.system.shortName) · 13 months of exactly 28",
                bars: thirteenBars, color: Palette.accent, gregorian: false, selection: $selectedThirteen)
        }
    }

    private var legend: some View {
        HStack(spacing: Spacing.l) {
            HStack(spacing: Spacing.xs) {
                RoundedRectangle(cornerRadius: 2).fill(GregorianBandStyle(opacity: 0.45)).frame(width: 14, height: 10)
                Text("Four weeks (28 days)")
            }
            HStack(spacing: Spacing.xs) {
                RoundedRectangle(cornerRadius: 2).fill(Palette.foil).frame(width: 14, height: 10)
                Text("Days beyond four weeks")
            }
        }
        .font(Typography.text(.caption))
        .foregroundStyle(Palette.inkSecondary)
        .accessibilityHidden(true)
    }

    private func segments(_ bars: [Bar]) -> [Segment] {
        bars.flatMap { bar in
            [Segment(bar: bar, part: Self.fourWeeks, days: min(bar.days, 28))]
                + (bar.extra > 0 ? [Segment(bar: bar, part: Self.extraDays, days: bar.extra)] : [])
        }
    }

    private func chart(
        title: String, bars: [Bar], color themeColor: ThemeColor, gregorian: Bool, selection: Binding<String?>
    ) -> some View {
        // Charts gets concrete colours of the current theme.
        let color = themeColor.color(for: theme)
        // The four-week part: the plain tone, or for the Gregorian months in Mono a hatch, so the
        // two charts differ by more than a shade of grey.
        let fourWeeks =
            gregorian
            ? GregorianBandStyle(opacity: 0.45).resolve(in: environment) : AnyShapeStyle(color.opacity(0.45))
        let rule = Palette.rule.color(for: theme)
        let axisLabel = Palette.inkTertiary.color(for: theme)
        return VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(Typography.text(.subheadline, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                Spacer()
                if let name = selection.wrappedValue, let bar = bars.first(where: { $0.shortName == name }) {
                    Text("\(bar.name): \(Phrasing.days(bar.days))")
                        .font(Typography.mono(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
            Chart(segments(bars)) { segment in
                let dimmed = selection.wrappedValue != nil && selection.wrappedValue != segment.bar.shortName
                BarMark(
                    x: .value("Month", segment.bar.shortName),
                    y: .value("Days", segment.days),
                    width: .ratio(0.62))
                    .foregroundStyle(
                        (segment.part == Self.fourWeeks ? fourWeeks : AnyShapeStyle(color)).opacity(dimmed ? 0.45 : 1))
                    .cornerRadius(segment.part == Self.extraDays || segment.bar.extra == 0 ? 3 : 0, style: .continuous)
                    .accessibilityLabel(segment.bar.name)
                    .accessibilityValue(
                        segment.part == Self.fourWeeks
                            ? "\(Phrasing.days(segment.bar.days)) in total"
                            : "\(Phrasing.days(segment.days)) beyond four weeks")
                    .annotation(position: .top, spacing: 2) {
                        if segment.part == Self.extraDays || (segment.bar.extra == 0 && bars.count == 12) {
                            Text("\(segment.bar.days)")
                                .font(Typography.mono(.caption2))
                                .foregroundStyle(Palette.inkSecondary)
                        }
                    }
            }
            .chartYScale(domain: 0...33)
            .chartYAxis {
                AxisMarks(position: .leading, values: [0, 7, 14, 21, 28]) { _ in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5)).foregroundStyle(rule)
                    AxisValueLabel().font(Typography.mono(.caption2)).foregroundStyle(axisLabel)
                }
            }
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let name = value.as(String.self) {
                            // Three-letter names when every month gets ≥ 26 pt, else initials.
                            Text(width / CGFloat(bars.count) >= 26 ? String(name.prefix(3)) : String(name.prefix(1)))
                        }
                    }
                    .font(Typography.mono(.caption2))
                    .foregroundStyle(axisLabel)
                }
            }
            .chartLegend(.hidden)
            .chartXSelection(value: selection)
            .frame(height: 130)
            .padding(.top, Spacing.m)
            .readWidth(into: $width)
        }
    }
}
