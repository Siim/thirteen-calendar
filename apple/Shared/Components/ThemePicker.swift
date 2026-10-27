import SwiftUI
import ThirteenKit

/// The colour theme choice (Settings on every platform): one swatch per theme, each drawn in its
/// own theme and the current light or dark mode, with the chosen theme's one-line summary below.
/// The themes come in their groups (``ThemeGroup``): the five that follow light and dark, then
/// the always-dark ones under "Dark". Picking a swatch re-themes every window at once, so the app
/// itself is the live preview. Five tiles in a row where they fit (iPad, Mac), else three, the
/// same size in both groups; at accessibility text sizes a list of rows with each theme's summary.
struct ThemePicker: View {
    @Binding var selection: AppTheme

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var width: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            ForEach(ThemeGroup.allCases) { group in
                section(group)
            }
            if !dynamicTypeSize.isAccessibilitySize {
                Text("\(selection.displayName): \(selection.summary)")
                    .font(Typography.text(.footnote))
                    .foregroundStyle(Palette.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityHidden(true)  // each swatch reads its own summary
            }
        }
        .readWidth(into: $width)
    }

    /// One group: its heading, then its swatches.
    private func section(_ group: ThemeGroup) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text(group.displayName)
                .eyebrow()
                .accessibilityAddTraits(.isHeader)
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Spacing.m) {
                    swatches(group, row: true)
                }
            } else {
                LazyVGrid(
                    columns: Array(
                        repeating: GridItem(.flexible(), spacing: Spacing.m, alignment: .top),
                        count: width >= 400 ? 5 : 3),
                    alignment: .leading, spacing: Spacing.m
                ) {
                    swatches(group, row: false)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(group.displayName) themes")
    }

    private func swatches(_ group: ThemeGroup, row: Bool) -> some View {
        ForEach(group.themes) { theme in
            ThemeSwatch(theme: theme, isSelected: theme == selection, isRow: row) {
                selection = theme
            }
        }
    }
}

/// One theme as a tappable tile: a miniature almanac page (paper, ink numeral, a slice of the
/// 4 × 7 grid with today in the accent and a Gregorian month start in the foil) and its name.
/// As a row (accessibility text sizes) the page sits above the name and the theme's summary.
struct ThemeSwatch: View {
    let theme: AppTheme
    let isSelected: Bool
    var isRow = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if isRow {
                    // The page above its name and summary, so both get the row's full width: beside
                    // the page, "Almanac" broke inside the word at the largest sizes on an iPhone SE.
                    VStack(alignment: .leading, spacing: Spacing.s) {
                        // Its ideal height: in a VStack the page's square cells were squeezed out.
                        sample.frame(width: 120).fixedSize(horizontal: false, vertical: true)
                        name
                        Text(theme.summary)
                            .font(Typography.text(.footnote))
                            .foregroundStyle(Palette.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, Spacing.xs)
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    VStack(alignment: .leading, spacing: Spacing.s) {
                        sample
                        name
                    }
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(DayCellButtonStyle())
        // The button itself is the one accessibility element (its label content is replaced, not
        // wrapped in a second element), so VoiceOver and Full Keyboard Access press it directly.
        .accessibilityLabel(theme.displayName)
        .accessibilityHint(theme.summary)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var sample: some View {
        ThemeSample(isSelected: isSelected)
            .theme(theme)
    }

    private var name: some View {
        HStack(spacing: Spacing.xs) {
            Text(theme.displayName)
                .font(Typography.text(.footnote, weight: isSelected ? .semibold : .medium))
                .foregroundStyle(Palette.ink)
                .lineLimit(isRow ? nil : 1)
                .minimumScaleFactor(isRow ? 1 : 0.8)
            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.tint)
            }
        }
    }
}

/// The miniature page of a ``ThemeSwatch``, drawn with ``Palette`` in the environment's theme.
private struct ThemeSample: View {
    let isSelected: Bool

    private let shape = RoundedRectangle(cornerRadius: Radius.control, style: .continuous)

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text("13")
                    .font(Typography.font(.sans, fixedSize: 20, weight: .bold).monospacedDigit())
                    .tracking(-0.8)
                    .foregroundStyle(Palette.ink)
                Text("SOL")
                    .font(Typography.font(.mono, fixedSize: 8, weight: .medium))
                    .foregroundStyle(Palette.accentText)
                Spacer(minLength: 0)
            }
            Grid(horizontalSpacing: 2, verticalSpacing: 2) {
                ForEach(0..<2, id: \.self) { row in
                    GridRow {
                        ForEach(0..<7, id: \.self) { column in
                            cell(row * 7 + column)
                        }
                    }
                }
            }
            HStack(spacing: 3) {
                Capsule().fill(Palette.accent).frame(height: 3)
                Capsule().fill(Palette.paperSunk).frame(height: 3)
                    .frame(maxWidth: .infinity)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(Spacing.s + 2)
        .background(Palette.paper, in: shape)
        .overlay { shape.strokeBorder(isSelected ? Palette.accent : Palette.rule, lineWidth: isSelected ? 2 : 1) }
        .accessibilityHidden(true)
    }

    /// Day 10 is today (accent); day 4 starts a Gregorian month (foil bar).
    private func cell(_ index: Int) -> some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(index == 10 ? Palette.accent : Palette.paperSunk)
            .aspectRatio(1, contentMode: .fit)
            .overlay(alignment: .leading) {
                if index == 4 {
                    Capsule().fill(Palette.foil).frame(width: 2).padding(.vertical, 1)
                }
            }
    }
}

/// Live preview of the current theme in Settings: today's date plate and year progress, drawn
/// with the same components as the Today screen.
struct ThemePreview: View {
    let comparison: Comparison

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            DatePlate(comparison: comparison, size: .compact)
            YearProgressView(comparison: comparison, showsCaption: false)
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.paper, in: .rect(cornerRadius: Radius.control))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Palette.rule, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }
}
