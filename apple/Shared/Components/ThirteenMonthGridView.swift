import SwiftUI
import ThirteenKit

/// The hero motif: one 13-month month as a perfect 4 × 7 grid. Every cell can show the Gregorian
/// date it falls on (the "overlay"), marks where a Gregorian month begins, highlights today and
/// the selection, and reads both dates to VoiceOver. At accessibility text sizes the grid becomes
/// a list of days so nothing clips.
struct ThirteenMonthGridView: View {
    enum Density {
        /// Today, converter and the Year screen on touch screens: 44 pt cells.
        case regular
        /// The Mac's Year screen and menu bar extra (pointer only): small cells.
        case compact
    }

    let layout: ThirteenMonthLayout
    var today: GregorianDate?
    var selection: GregorianDate?
    var showsGregorian = true
    var density: Density = .regular
    /// Gap between cells; `nil` for the density's default (4 pt regular, 2 pt compact).
    var cellSpacing: CGFloat?
    /// Event dots by Julian Day Number (Calendar's Year mode, docs/EVENTS.md §2.3); empty elsewhere.
    var eventDots: [Int: EventDots] = [:]
    var onSelect: ((DayCell) -> Void)?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.marksWithoutColor) private var marksWithoutColor

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            listLayout
        } else {
            gridLayout
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        }
    }

    private var spacing: CGFloat { cellSpacing ?? (density == .regular ? 4 : 2) }

    private var gridLayout: some View {
        Grid(horizontalSpacing: spacing, verticalSpacing: spacing) {
            GridRow {
                ForEach(layout.weekdays) { weekday in
                    Text(weekday.name(density == .regular ? .short : .narrow))
                        .font(Typography.mono(.caption2, weight: .medium))
                        .textCase(.uppercase)
                        .foregroundStyle(Palette.inkTertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.bottom, Spacing.xxs)
                }
            }
            .accessibilityHidden(true)
            ForEach(0..<layout.weeks.count, id: \.self) { week in
                GridRow {
                    ForEach(layout.weeks[week]) { cell in
                        DayCellView(
                            cell: cell,
                            isToday: cell.gregorian == today,
                            isSelected: cell.gregorian == selection,
                            showsGregorian: showsGregorian,
                            density: density,
                            dots: eventDots[cell.gregorian.julianDayNumber],
                            action: onSelect.map { select in { select(cell) } })
                    }
                }
            }
        }
    }

    /// Lazy: at the largest text sizes a month is several screens tall, and the Year screen
    /// stacks 13 of them.
    private var listLayout: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(layout.days) { cell in
                let isSunday = cell.thirteenWeekday == .sunday
                let row = HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
                    Text("\(cell.thirteen.day)")
                        .titleFont(.title2, weight: isSunday && marksWithoutColor ? .bold : .semibold)
                        .foregroundStyle(cell.gregorian == today || isSunday ? Palette.accentText : Palette.ink)
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        Text(cell.thirteenWeekday.name())
                            .font(Typography.text(.body))
                            .foregroundStyle(Palette.ink)
                        if showsGregorian {
                            Text("Gregorian \(cell.gregorian.formatted(.init(style: .medium, includeWeekday: true)))")
                                .font(Typography.text(.callout))
                                .foregroundStyle(Palette.foil)
                        }
                        if cell.gregorian == today {
                            Text("Today").eyebrow(Palette.accentText)
                        }
                        if let dots = eventDots[cell.gregorian.julianDayNumber] {
                            EventDotRow(dots: dots, size: 6)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, Spacing.s)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
                .background(cell.gregorian == selection ? Palette.accentWash : .clear)

                Group {
                    if let onSelect {
                        Button { onSelect(cell) } label: { row }
                            .buttonStyle(.plain)
                    } else {
                        row
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(DayCellView.accessibilityLabel(for: cell))
                .accessibilityValue(DayCellView.accessibilityValue(isToday: cell.gregorian == today, dots: eventDots[cell.gregorian.julianDayNumber]))
                .accessibilityAddTraits(cell.gregorian == selection ? .isSelected : [])
                Divider().overlay(Palette.rule)
            }
        }
    }
}

/// One cell of ``ThirteenMonthGridView``.
struct DayCellView: View {
    let cell: DayCell
    var isToday = false
    var isSelected = false
    var showsGregorian = true
    var density: ThirteenMonthGridView.Density = .regular
    /// Up to three event dots under the day number (Year mode, §2.3).
    var dots: EventDots?
    var action: (() -> Void)?

    /// The compact cells' Gregorian date: 9 pt at the default text size, scaling with Dynamic
    /// Type (up to the grid's XXXL cap).
    @ScaledMetric(relativeTo: .caption2) private var compactGregorianSize: CGFloat = 9
    @Environment(\.marksWithoutColor) private var marksWithoutColor

    /// A red-letter day, like the web's grids: Sunday's numeral in the accent text colour, and
    /// bold where marks are made without colour (Mono, Differentiate Without Colour).
    private var isSunday: Bool { cell.thirteenWeekday == .sunday }

    var body: some View {
        Group {
            if let action {
                Button(action: action) { face }
                    .buttonStyle(DayCellButtonStyle())
            } else {
                face
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.accessibilityLabel(for: cell))
        .accessibilityValue(Self.accessibilityValue(isToday: isToday, dots: dots))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    /// "Today", the day's events (`year.cell.events`, "3 events"), or both.
    static func accessibilityValue(isToday: Bool, dots: EventDots?) -> String {
        var parts: [String] = []
        if isToday { parts.append("Today") }
        if let dots, dots.count > 0 { parts.append(dots.count == 1 ? "1 event" : "\(dots.count) events") }
        return parts.joined(separator: ", ")
    }

    private var face: some View {
        VStack(spacing: 0) {
            Text("\(cell.thirteen.day)")
                .font(numeralFont)
                .foregroundStyle(isToday ? Palette.onAccent : isSunday ? Palette.accentText : Palette.ink)
            if showsGregorian {
                Text(gregorianText)
                    .font(gregorianFont)
                    .foregroundStyle(isToday ? Palette.onAccent : Palette.foil)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            if let dots {
                EventDotRow(dots: dots, size: 4, onAccent: isToday)
                    .padding(.top, 1)
            }
        }
        .frame(maxWidth: .infinity, minHeight: minHeight)
        .padding(.vertical, density == .regular ? Spacing.xs : Spacing.xxs)
        .background {
            RoundedRectangle(cornerRadius: density == .regular ? Radius.cell : 5, style: .continuous)
                .fill(isToday ? Palette.accent : Palette.paperSunk.opacity(density == .regular ? 0.75 : 0.55))
        }
        .overlay(alignment: .leading) {
            if cell.isGregorianMonthStart {
                // Gregorian month boundary marker: a foil bar on the leading edge.
                Capsule()
                    .fill(isToday ? Palette.onAccent : Palette.foil)
                    .frame(width: density == .regular ? 3 : 2)
                    .padding(.vertical, density == .regular ? 6 : 3)
                    .padding(.leading, 1)
            }
        }
        .overlay {
            if isSelected {
                // AccentText, not Accent: the ring must reach 3:1 against the cell (Almanac and
                // Forest light: Accent is 2.9:1 there, AccentText 4.9:1 and 5.3:1).
                RoundedRectangle(cornerRadius: density == .regular ? Radius.cell : 5, style: .continuous)
                    .strokeBorder(Palette.accentText, lineWidth: 2)
            }
        }
        .contentShape(.rect)
    }

    private var numeralFont: Font {
        let style: Font.TextStyle = density == .regular ? .title3 : .footnote
        return Typography.display(style, weight: isToday || (isSunday && marksWithoutColor) ? .bold : .medium)
    }

    /// The Gregorian date under the numeral, in Geist Mono (bold where a Gregorian month begins).
    private var gregorianFont: Font {
        let weight: Font.Weight = cell.isGregorianMonthStart ? .bold : .regular
        return density == .regular
            ? Typography.mono(.caption2, weight: weight)
            : Typography.font(.mono, fixedSize: compactGregorianSize, weight: weight)
    }

    private var minHeight: CGFloat {
        switch (density, showsGregorian) {
        case (.regular, _): 44
        case (.compact, true): 30
        case (.compact, false): 24
        }
    }

    /// `"8"`, or the month abbreviation (`"Nov"`) where a Gregorian month begins.
    private var gregorianText: String {
        cell.isGregorianMonthStart ? cell.gregorian.monthInfo.shortName : "\(cell.gregorian.day)"
    }

    static func accessibilityLabel(for cell: DayCell) -> String { Phrasing.dayCell(cell) }
}

/// Pressed-state feedback for tappable day cells.
struct DayCellButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.7 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.94 : 1)
            .animation(reduceMotion ? nil : .snappy(duration: 0.15), value: configuration.isPressed)
    }
}

/// The event dots of one day (docs/EVENTS.md §2.3): the colours of the first three calendars with
/// events that day (`yearEventMarks` order) and the number of events.
struct EventDots: Hashable, Sendable {
    /// `#rrggbb` colours, at most three.
    let colors: [String]
    let count: Int
}

/// Up to three dots in calendar colours, each with a 1 pt ring so pale colours stay visible.
struct EventDotRow: View {
    let dots: EventDots
    var size: CGFloat = 4
    /// On today's accent fill: rings in the on-accent colour.
    var onAccent = false

    var body: some View {
        HStack(spacing: max(1, size / 2)) {
            ForEach(Array(dots.colors.prefix(3).enumerated()), id: \.offset) { _, hex in
                Circle()
                    .fill(Color(calendarHex: hex))
                    .overlay(Circle().strokeBorder(onAccent ? Palette.onAccent : Palette.rule, lineWidth: size > 4 ? 1 : 0.5))
                    .frame(width: size, height: size)
            }
        }
        .frame(height: size)
        .accessibilityHidden(true)
    }
}
