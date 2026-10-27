import SwiftUI
import ThirteenKit

/// The reverse view of ``ThirteenMonthGridView``: one Gregorian month as its ragged grid (4–6
/// rows, blanks before day 1), every day annotated with its 13-month date in small type. A bar
/// marks where a 13-month month begins, intercalary days carry their code ("YD") inside a dashed
/// outline, and today is filled. Columns start on the system's week start, so the grid lines up
/// with the 13-month grid next to it. At accessibility text sizes the grid becomes a list of days.
struct GregorianMonthGridView: View {
    let layout: GregorianMonthLayout
    var today: GregorianDate?
    var selection: GregorianDate?
    var onSelect: ((GregorianDayCell) -> Void)?

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

    private var gridLayout: some View {
        Grid(horizontalSpacing: 4, verticalSpacing: 4) {
            GridRow {
                ForEach(layout.weekdays) { weekday in
                    Text(weekday.name(.short))
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
                    ForEach(0..<layout.weeks[week].count, id: \.self) { column in
                        if let cell = layout.weeks[week][column] {
                            GregorianDayCellView(
                                cell: cell,
                                isToday: cell.gregorian == today,
                                isSelected: cell.gregorian == selection,
                                action: onSelect.map { select in { select(cell) } })
                        } else {
                            Color.clear
                                .frame(maxWidth: .infinity)
                                .gridCellUnsizedAxes(.vertical)
                                .accessibilityHidden(true)
                        }
                    }
                }
            }
        }
    }

    private var listLayout: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(layout.days) { cell in
                let isToday = cell.gregorian == today
                let isSunday = cell.gregorianWeekday == .sunday
                let row = HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
                    Text("\(cell.gregorian.day)")
                        .titleFont(.title2, weight: isSunday && marksWithoutColor ? .bold : .semibold)
                        .foregroundStyle(isToday || isSunday ? Palette.accentText : Palette.ink)
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        Text(cell.gregorianWeekday.name())
                            .font(Typography.text(.body))
                            .foregroundStyle(Palette.ink)
                        Text("\(layout.system.shortName) \(cell.thirteen.formatted(.init(style: .medium, includeWeekday: true)))")
                            .font(Typography.text(.callout))
                            .foregroundStyle(Palette.accentText)
                        if isToday {
                            Text("Today").eyebrow(Palette.accentText)
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
                .accessibilityLabel(GregorianDayCellView.accessibilityLabel(for: cell))
                .accessibilityValue(isToday ? "Today" : "")
                .accessibilityAddTraits(cell.gregorian == selection ? .isSelected : [])
                Divider().overlay(Palette.rule)
            }
        }
    }
}

/// One day of ``GregorianMonthGridView``: the Gregorian day large, its 13-month date small.
struct GregorianDayCellView: View {
    let cell: GregorianDayCell
    var isToday = false
    var isSelected = false
    var action: (() -> Void)?

    @Environment(\.marksWithoutColor) private var marksWithoutColor

    /// A red-letter day (see ``DayCellView``): a Gregorian Sunday.
    private var isSunday: Bool { cell.gregorianWeekday == .sunday }

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
        .accessibilityValue(isToday ? "Today" : "")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Radius.cell, style: .continuous) }

    private var face: some View {
        VStack(spacing: 0) {
            Text("\(cell.gregorian.day)")
                .font(Typography.display(.title3, weight: isToday || (isSunday && marksWithoutColor) ? .bold : .medium))
                .foregroundStyle(isToday ? Palette.onAccent : isSunday ? Palette.accentText : Palette.ink)
            Text(thirteenText)
                .font(Typography.mono(.caption2, weight: cell.isThirteenMonthStart || cell.thirteen.isIntercalary ? .bold : .regular))
                .foregroundStyle(isToday ? Palette.onAccent : Palette.accentText)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .padding(.vertical, Spacing.xs)
        .background { shape.fill(isToday ? Palette.accent : Palette.paperSunk.opacity(0.75)) }
        .overlay(alignment: .leading) {
            if cell.isThirteenMonthStart {
                // 13-month month boundary: an accent bar on the leading edge (the foil bar's twin
                // in the 13-month grid).
                Capsule()
                    .fill(isToday ? Palette.onAccent : Palette.accentText)
                    .frame(width: 3)
                    .padding(.vertical, 6)
                    .padding(.leading, 1)
            }
        }
        .overlay {
            if isSelected {
                shape.strokeBorder(Palette.accentText, lineWidth: 2)  // 3:1 or more on the cell
            } else if cell.thirteen.isIntercalary {
                // Outside every month and week: the dashed "ticket" of the intercalary badge.
                shape.strokeBorder(
                    isToday ? Palette.onAccent : Palette.accentText,
                    style: StrokeStyle(lineWidth: 1.25, dash: [4, 3]))
            }
        }
        .contentShape(.rect)
    }

    /// `"12"`, the month abbreviation where a 13-month month begins (`"Nov"`), or the
    /// intercalary day's code (`"YD"`, `"LD"`).
    private var thirteenText: String {
        switch cell.thirteen {
        case let .intercalary(date): date.info.code
        case let .month(date): cell.isThirteenMonthStart ? date.monthInfo.shortName : "\(date.day)"
        }
    }

    static func accessibilityLabel(for cell: GregorianDayCell) -> String { Phrasing.gregorianDayCell(cell) }
}
