import SwiftUI
import ThirteenKit

/// Fixed vs real weekday: two 7-day strips (13-month above, Gregorian below), each with its
/// weekday marked, plus the shift in plain language.
struct WeekdayShiftView: View {
    let comparison: Comparison

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var system: CalendarSystemID { comparison.thirteen.system }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    labeled("\(system.shortName)", comparison.thirteenWeekday?.name() ?? "No weekday", Palette.accentText)
                    labeled("Gregorian", comparison.gregorianWeekday.name(), Palette.foil)
                }
            } else {
                Grid(alignment: .leading, horizontalSpacing: Spacing.m, verticalSpacing: Spacing.s) {
                    GridRow {
                        Text(system.shortName).eyebrow(Palette.accentText)
                        strip(marked: comparison.thirteenWeekday, color: Palette.accent, on: Palette.onAccent)
                    }
                    GridRow {
                        Text("Gregorian").eyebrow(Palette.foil)
                        strip(marked: comparison.gregorianWeekday, color: Palette.foil, on: Palette.onFoil)
                    }
                }
                .accessibilityHidden(true)
            }
            Text(Phrasing.weekdayShift(comparison))
                .font(Typography.text(.callout))
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private func labeled(_ title: String, _ value: String, _ color: ThemeColor) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).eyebrow(color)
            Text(value).font(Typography.text(.body, weight: .semibold))
        }
    }

    /// Seven weekday letters in the system's week order with one marked.
    private func strip(marked: Weekday?, color: ThemeColor, on onColor: ThemeColor) -> some View {
        HStack(spacing: 4) {
            ForEach(Weekday.ordered(startingOn: system.weekStartsOn)) { weekday in
                let isMarked = weekday == marked
                Text(weekday.name(.short).prefix(2))
                    .font(Typography.mono(.caption, weight: isMarked ? .bold : .regular))
                    .foregroundStyle(isMarked ? onColor : Palette.inkTertiary)
                    .frame(maxWidth: .infinity, minHeight: 26)
                    .background {
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(isMarked ? color : Palette.paperSunk.opacity(0.7))
                    }
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}
