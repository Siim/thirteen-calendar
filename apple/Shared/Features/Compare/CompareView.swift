import SwiftUI
import ThirteenKit

/// Compare (SPEC §5.4): 12 vs 13 for one year — month-boundary ribbon, month-length bars,
/// Friday-the-13ths, quarter lengths, month shapes, weekday drift and the systems side by side.
struct CompareView: View {
    @Environment(AppModel.self) private var model

    private let statColumns = [GridItem(.adaptive(minimum: 300), spacing: Spacing.l, alignment: .top)]

    var body: some View {
        @Bindable var model = model
        let year = model.compareYear
        let stats = try? YearStats(year: year, system: model.system)
        let alignment = try? MonthAlignment(year: year, system: model.system)
        PageScroll {
            YearStepperHeader(year: $model.compareYear, system: model.system, subtitle: "12\u{00A0}vs\u{00A0}13")
            if let alignment {
                Card(title: "Month boundaries", subtitle: "Both calendars start on 1 January and share every day; only the month lines differ.") {
                    MonthRibbonView(
                        alignment: alignment,
                        markedDayOfYear: model.today.year == year ? model.today.dayOfYear : nil)
                }
            }
            if let stats {
                Card(title: "Month lengths", subtitle: "Both on one scale from zero: four weeks, plus any days beyond them.") {
                    MonthLengthBarsView(stats: stats)
                }
                LazyVGrid(columns: statColumns, alignment: .leading, spacing: Spacing.l) {
                    Friday13thCard(stats: stats)
                    QuartersCard(stats: stats)
                    MonthShapesCard(stats: stats)
                    WeekdayDriftCard(year: year, system: model.system)
                }
            }
            SystemsSideBySideCard(selected: model.system)
            Button {
                model.section = .history
            } label: {
                Label("History of the three calendars", systemImage: AppSection.history.systemImage)
                    .frame(maxWidth: .infinity)
            }
            .accentBorderedButtonStyle()
            .wrappingButtonShape()
            .controlSize(.large)
        }
        .navigationTitle("Compare")
        .systemMenuToolbar()
    }
}

// MARK: - Stat cards

/// The fill of a quarter or a weekday chip at `tone`: a Gregorian band (``GregorianBandStyle``,
/// hatched in Mono, with its text in ``SwiftUI/View/gregorianBandLabel(opacity:)``) or the accent.
private func bandFill(gregorian: Bool, tone: Double) -> AnyShapeStyle {
    gregorian ? AnyShapeStyle(GregorianBandStyle(opacity: tone)) : AnyShapeStyle(Palette.accent.opacity(tone))
}

/// A big number with a caption, one per calendar.
private struct StatFigure: View {
    let value: String
    let caption: String
    let color: ThemeColor

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            Text(value)
                .displayNumeral(size: 40, relativeTo: .largeTitle)
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .overlay(alignment: .bottomLeading) {
                    Capsule().fill(color).frame(width: 24, height: 3).offset(y: 6)
                }
                .padding(.bottom, Spacing.xs)
            Text(caption)
                .font(Typography.text(.footnote))
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct Friday13thCard: View {
    let stats: YearStats

    var body: some View {
        let gregorian = stats.gregorianFriday13ths.map { $0.gregorian.formatted(.short) }.joined(separator: ", ")
        let system = stats.system
        Card(title: "Friday the 13th", subtitle: "How often the 13th of a month is a Friday.") {
            HStack(alignment: .top, spacing: Spacing.l) {
                StatFigure(
                    value: "\(stats.gregorianFriday13ths.count)",
                    caption: "Gregorian: \(gregorian)", color: Palette.foil)
                StatFigure(
                    value: "\(stats.thirteenFriday13ths.count)",
                    caption: stats.thirteenFriday13ths.isEmpty
                        ? "\(system.shortName): never, since every 13th is a \((try? system.fixedWeekday(day: 13))?.name() ?? "Saturday")"
                        : "\(system.shortName): every month, every year",
                    color: Palette.accent)
            }
        }
    }
}

private struct QuartersCard: View {
    let stats: YearStats

    var body: some View {
        Card(title: "Quarters", subtitle: "Days per quarter; 13-month quarters are 3¼ months each.") {
            VStack(alignment: .leading, spacing: Spacing.m) {
                row("Gregorian", stats.gregorianQuarterLengths, label: Palette.foil, gregorian: true)
                row(stats.system.shortName, stats.thirteenQuarterLengths, label: Palette.accentText, gregorian: false)
                if stats.intercalaryDayCount > 0 {
                    Text("Plus \(Phrasing.days(stats.intercalaryDayCount)) outside the 13-month quarters.")
                        .font(Typography.text(.footnote))
                        .foregroundStyle(Palette.inkTertiary)
                }
            }
        }
    }

    /// One calendar's quarters, in alternating tones of its colour: Gregorian bands
    /// (``GregorianBandStyle``, hatched in Mono) or the accent.
    private func row(_ title: String, _ lengths: [Int], label: ThemeColor, gregorian: Bool) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(title).eyebrow(label)
            HStack(spacing: 2) {
                ForEach(Array(lengths.enumerated()), id: \.offset) { index, days in
                    let tone = index.isMultiple(of: 2) ? 0.22 : 0.34
                    Group {
                        if gregorian {
                            Text("\(days)").titleFont(.headline).gregorianBandLabel(opacity: tone)
                        } else {
                            Text("\(days)").titleFont(.headline).foregroundStyle(Palette.ink)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 36)
                    .background(bandFill(gregorian: gregorian, tone: tone), in: .rect(cornerRadius: 6))
                    .accessibilityLabel("Quarter \(index + 1): \(days) days")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }
}

/// Every Gregorian month drawn as a tiny ragged grid, against the single 13-month shape.
private struct MonthShapesCard: View {
    let stats: YearStats

    var body: some View {
        Card(title: "Month shapes", subtitle: "A month\u{2019}s shape is its first weekday and length.") {
            HStack(alignment: .top, spacing: Spacing.l) {
                StatFigure(
                    value: "\(stats.gregorianMonthShapeCount)",
                    caption: "distinct Gregorian shapes this year", color: Palette.foil)
                StatFigure(value: "\(stats.thirteenMonthShapeCount)", caption: "13-month shape, forever", color: Palette.accent)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Spacing.s), count: 6), spacing: Spacing.s) {
                ForEach(1...12, id: \.self) { month in
                    if let layout = try? GregorianMonthLayout(year: stats.year, month: month, system: stats.system) {
                        VStack(spacing: Spacing.xxs) {
                            MonthShapeGlyph(leadingBlanks: layout.leadingBlanks, days: layout.days.count, color: Palette.foil)
                            Text(layout.monthInfo.shortName)
                                .font(Typography.mono(.caption2))
                                .foregroundStyle(Palette.inkTertiary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                    }
                }
            }
            // Six glyphs a row: the labels stop growing before they would truncate ("M…").
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
            .accessibilityHidden(true)
            HStack(spacing: Spacing.s) {
                MonthShapeGlyph(leadingBlanks: 0, days: 28, color: Palette.accent)
                    .frame(width: 44)
                Text("Every \(stats.system.shortName) month: four full weeks, starting \(stats.system.weekStartsOn.name()).")
                    .font(Typography.text(.footnote))
                    .foregroundStyle(Palette.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// A month silhouette: one square per day on a 7-column grid.
struct MonthShapeGlyph: View {
    let leadingBlanks: Int
    let days: Int
    let color: ThemeColor

    @Environment(\.appTheme) private var theme

    var body: some View {
        let color = color.color(for: theme)
        Canvas { context, size in
            let cell = size.width / 7
            let dot = cell * 0.78
            for index in 0..<days {
                let position = leadingBlanks + index
                let rect = CGRect(
                    x: CGFloat(position % 7) * cell + (cell - dot) / 2,
                    y: CGFloat(position / 7) * cell + (cell - dot) / 2,
                    width: dot, height: dot)
                context.fill(Path(roundedRect: rect, cornerRadius: dot * 0.25), with: .color(color))
            }
        }
        .aspectRatio(7.0 / 6.0, contentMode: .fit)
    }
}

/// New Year's Day weekday over seven years: drifting in Gregorian, fixed in 13-month.
private struct WeekdayDriftCard: View {
    let year: Int
    let system: CalendarSystemID

    var body: some View {
        Card(title: "Weekday drift", subtitle: "The weekday of 1 January, year by year.") {
            VStack(spacing: Spacing.s) {
                row(label: Text("")) { year in
                    // Full display years: a two-digit "38" would be ambiguous for Positivist 238.
                    Text(Phrasing.displayYear(year, system: system))
                        .font(Typography.mono(.caption2))
                        .foregroundStyle(Palette.inkTertiary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                }
                row(label: Text("Greg").eyebrow(Palette.foil)) { year in
                    chip(gregorianStart(year), gregorian: true)
                }
                row(label: Text(system.shortName.prefix(5)).eyebrow(Palette.accentText)) { _ in
                    chip(system.weekStartsOn, gregorian: false)
                }
            }
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
            .accessibilityHidden(true)
            Text("Gregorian years start one weekday later each year (two after a leap year). Every \(system.shortName) year starts on a \(system.weekStartsOn.name()).")
                .explanation()
        }
        .accessibilityElement(children: .combine)
    }

    @ScaledMetric(relativeTo: .caption) private var labelWidth: CGFloat = 46

    /// A label column of fixed width, then one equal-width cell per year.
    private func row(label: some View, @ViewBuilder cell: @escaping (Int) -> some View) -> some View {
        let years = Array(year...min(year + 6, GregorianDate.maxYear))
        return HStack(spacing: 6) {
            label
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                // The rows are capped at XXL text, so the label column stops growing there too.
                .frame(width: min(labelWidth, 64), alignment: .leading)
            ForEach(years, id: \.self) { year in
                cell(year).frame(maxWidth: .infinity)
            }
        }
    }

    private func gregorianStart(_ year: Int) -> Weekday {
        ((try? GregorianDate(year: year, month: 1, day: 1))?.weekday) ?? .sunday
    }

    /// A weekday on a Gregorian band (``GregorianBandStyle``, hatched in Mono) or the accent.
    private func chip(_ weekday: Weekday, gregorian: Bool) -> some View {
        let tone = 0.22
        let text = Text(weekday.name(.short).prefix(2))
            .font(Typography.mono(.caption, weight: .semibold))
        return Group {
            if gregorian {
                text.gregorianBandLabel(opacity: tone)
            } else {
                text.foregroundStyle(Palette.ink)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(maxWidth: .infinity, minHeight: 28)
        .background(bandFill(gregorian: gregorian, tone: tone), in: .rect(cornerRadius: 6))
    }
}

// MARK: - Systems side by side

private struct SystemsSideBySideCard: View {
    let selected: CalendarSystemID

    private struct Column: Identifiable {
        let id: String
        let name: String
        let inventor: String
        let year: Int
        let rows: [(String, String)]
        let isSelected: Bool
        let tint: ThemeColor
    }

    private var columns: [Column] {
        let gregorian = GregorianCalendarInfo.gregorian
        var result = [
            Column(
                id: "gregorian", name: gregorian.name, inventor: gregorian.inventor, year: gregorian.proposedYear,
                rows: [
                    ("Months", "12, of 28 to 31 days"),
                    ("Weeks", "Run across months; dates drift by weekday every year"),
                    ("Leap day", "29 February"),
                    ("Year number", "Anno Domini"),
                ],
                isSelected: false, tint: Palette.foil)
        ]
        for system in CalendarSystem.all {
            let intercalary = system.intercalaryDays.map(\.name).joined(separator: " and ")
            let leap = system.intercalaryDays.first(where: \.leapOnly)
            let leapText = leap.map { leap in
                leap.afterMonth == ThirteenDate.monthsPerYear
                    ? "\(leap.name), at the end of leap years"
                    : "\(leap.name), after \(system.months[leap.afterMonth - 1].name) 28"
            } ?? "None"
            result.append(
                Column(
                    id: system.id.rawValue, name: system.name, inventor: system.inventor, year: system.proposedYear,
                    rows: [
                        ("Months", "13 × 28 days: \(system.months.map(\.shortName).joined(separator: " "))"),
                        ("Weeks", "Every month starts on \(system.weekStartsOn.name()); dates keep their weekday forever"),
                        ("Outside the week", intercalary),
                        ("Leap day", leapText),
                        ("Year number", system.yearOffset == 0 ? "Gregorian year" : "Gregorian year minus \(-system.yearOffset) (year 1 = \(1 - system.yearOffset))"),
                    ],
                    isSelected: system.id == selected,
                    tint: system.id == selected ? Palette.accent : Palette.inkSecondary))
        }
        return result
    }

    var body: some View {
        Card(title: "Side by side") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: Spacing.m, alignment: .top)], spacing: Spacing.m) {
                ForEach(columns) { column in
                    VStack(alignment: .leading, spacing: Spacing.s) {
                        HStack {
                            Capsule().fill(column.tint).frame(width: 18, height: 4)
                            if column.isSelected { Text("Selected").eyebrow(Palette.accentText) }
                        }
                        Text(column.name)
                            .titleFont(.headline)
                            .foregroundStyle(Palette.ink)
                        Text("\(column.inventor), \(String(column.year))")
                            .font(Typography.text(.footnote))
                            .foregroundStyle(Palette.inkSecondary)
                        ForEach(column.rows, id: \.0) { title, value in
                            VStack(alignment: .leading, spacing: 1) {
                                Text(title).eyebrow()
                                Text(value).font(Typography.text(.callout)).foregroundStyle(Palette.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(Spacing.m)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.paperSunk.opacity(0.5), in: .rect(cornerRadius: Radius.control))
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.control)
                            .strokeBorder(column.isSelected ? Palette.accent.opacity(0.7) : .clear, lineWidth: 1.5)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}
