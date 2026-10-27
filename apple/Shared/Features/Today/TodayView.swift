import SwiftUI
import ThirteenKit

/// Today (SPEC §5.1): today's 13-month date, its Gregorian equivalent, fixed vs real weekday,
/// label drift, 13-segment year progress, the countdown to Year Day, the current 13-month grid
/// and, the other way round, the current Gregorian month with its 13-month dates.
struct TodayView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.appTheme) private var theme
    @State private var width: CGFloat = 0

    var body: some View {
        let comparison = model.todayComparison
        PageScroll {
            if width >= Measure.twoColumnThreshold {
                HStack(alignment: .top, spacing: Spacing.l) {
                    VStack(spacing: Spacing.l) {
                        hero(comparison)
                        UpNextCard()
                        countdownCard(comparison)
                        differenceCard(comparison)
                    }
                    .frame(maxWidth: .infinity)
                    VStack(spacing: Spacing.l) {
                        monthCard(comparison)
                        gregorianMonthCard
                    }
                    .frame(maxWidth: .infinity)
                }
            } else {
                hero(comparison)
                UpNextCard()
                countdownCard(comparison)
                differenceCard(comparison)
                monthCard(comparison)
                gregorianMonthCard
            }
        }
        .readWidth(into: $width)
        .navigationTitle("Today")
        .systemMenuToolbar()
    }

    // MARK: Hero

    private func hero(_ comparison: Comparison) -> some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            DatePlate(comparison: comparison, size: .hero)
            YearProgressView(comparison: comparison)
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { HeroBackdrop() }
        .glassEffect(.regular.tint(Palette.accent.opacity(0.06).color(for: theme)), in: .rect(cornerRadius: Radius.hero))
        .clipShape(.rect(cornerRadius: Radius.hero))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.hero).strokeBorder(Palette.rule.opacity(0.6), lineWidth: 1)
        }
    }

    // MARK: Cards

    private func countdownCard(_ comparison: Comparison) -> some View {
        let days = model.today.daysUntilYearDay(in: model.system)
        return Card {
            HStack(alignment: .center, spacing: Spacing.l) {
                Text("\(days)")
                    .displayNumeral(size: 48, relativeTo: .largeTitle)
                    .foregroundStyle(Palette.accentText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(Phrasing.countdown(days, system: model.system))
                        .font(Typography.text(.headline))
                        .foregroundStyle(Palette.ink)
                    Text(model.system.intercalaryDayInfo(.yearDay).description)
                        .font(Typography.text(.footnote))
                        .foregroundStyle(Palette.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func differenceCard(_ comparison: Comparison) -> some View {
        Card(title: "Against the Gregorian calendar") {
            VStack(alignment: .leading, spacing: Spacing.l) {
                WeekdayShiftView(comparison: comparison)
                Rectangle().fill(Palette.rule).frame(height: 1).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Label drift").eyebrow()
                        Spacer()
                        Text(Phrasing.driftAmount(comparison.labelDrift))
                            .titleFont(.body)
                            .foregroundStyle(Palette.accentText)
                    }
                    Text(Phrasing.labelDrift(comparison, relativeToToday: true))
                        .explanation()
                }
                .accessibilityElement(children: .combine)
                Button("Full comparison", systemImage: "list.bullet.rectangle") {
                    model.showDetail(model.today)
                }
                .accentBorderedButtonStyle()
                .wrappingButtonShape()
            }
        }
    }

    @ViewBuilder
    private func monthCard(_ comparison: Comparison) -> some View {
        switch comparison.thirteen {
        case let .month(date):
            if let layout = try? ThirteenMonthLayout(year: date.year, month: date.month, system: date.system) {
                Card(title: "\(date.monthInfo.name) \(date.displayYear)", subtitle: monthSubtitle(layout)) {
                    ThirteenMonthGridView(
                        layout: layout, today: model.today, showsGregorian: true, density: .regular,
                        onSelect: { model.showDetail($0.gregorian) })
                    Text("Every month starts on a \(date.system.weekStartsOn.name()) and has exactly four weeks. Small numbers are the Gregorian dates; a bar marks where a Gregorian month begins.")
                        .font(Typography.text(.footnote))
                        .foregroundStyle(Palette.inkTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        case let .intercalary(date):
            if let occurrence = (try? IntercalaryOccurrence.all(inYear: date.year, system: date.system))?
                .first(where: { $0.id == date.id })
            {
                Card(title: "Outside the grid", subtitle: "Today belongs to no month and no week.") {
                    IntercalaryDayBadge(occurrence: occurrence, isToday: true) {
                        model.showDetail(model.today)
                    }
                }
            }
        }
    }

    /// The current Gregorian month, ragged as it is, with each day's 13-month date.
    @ViewBuilder
    private var gregorianMonthCard: some View {
        let today = model.today
        let system = model.system
        if let layout = try? GregorianMonthLayout(year: today.year, month: today.month, system: system),
            let first = layout.days.first, let last = layout.days.last
        {
            let span = "\(first.thirteen.formatted(.init(style: .short, includeYear: false))) to \(last.thirteen.formatted(.init(style: .short, includeYear: false)))"
            Card(title: "Gregorian \(layout.monthInfo.name) \(String(today.year))", subtitle: "\(system.shortName) \(span)") {
                GregorianMonthGridView(layout: layout, today: today, onSelect: { model.showDetail($0.gregorian) })
                Text("\(layout.monthInfo.name) has \(layout.days.count) days and starts on a \(first.gregorianWeekday.name()), so it spans \(layout.weeks.count) rows; next month has a different shape again. Small numbers are the \(system.shortName) dates; a bar marks where \(system == .ifc ? "an" : "a") \(system.shortName) month begins.")
                    .font(Typography.text(.footnote))
                    .foregroundStyle(Palette.inkTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func monthSubtitle(_ layout: ThirteenMonthLayout) -> String {
        let first = layout.weeks[0][0].gregorian.formatted(.short)
        let last = layout.weeks[3][6].gregorian.formatted(.short)
        return "Gregorian \(first) to \(last)"
    }
}

/// Decorative backdrop behind the Today hero glass: a faint 4 × 7 grid and a low orange sun
/// (for Sol), so the glass has something to refract.
private struct HeroBackdrop: View {
    @Environment(\.appTheme) private var theme

    var body: some View {
        let rule = Palette.rule.color(for: theme)
        let accent = Palette.accent.color(for: theme)
        Canvas { context, size in
            let columns = 7
            let rows = 4
            let cell = size.width / CGFloat(columns)
            let gridHeight = cell * CGFloat(rows)
            let originY = size.height - gridHeight
            var grid = Path()
            for column in 0...columns {
                let x = CGFloat(column) * cell
                grid.move(to: CGPoint(x: x, y: originY))
                grid.addLine(to: CGPoint(x: x, y: size.height))
            }
            for row in 0...rows {
                let y = originY + CGFloat(row) * cell
                grid.move(to: CGPoint(x: 0, y: y))
                grid.addLine(to: CGPoint(x: size.width, y: y))
            }
            // Fade the ruling in towards the bottom so it never crosses the numerals, and keep it
            // faint: it sits behind the Gregorian line and the progress caption.
            context.stroke(
                grid,
                with: .linearGradient(
                    Gradient(colors: [rule.opacity(0), rule.opacity(0.4)]),
                    startPoint: CGPoint(x: 0, y: originY + gridHeight * 0.5),
                    endPoint: CGPoint(x: 0, y: size.height)),
                lineWidth: 1)

            let radius = min(size.width, size.height) * 0.42
            let sun = Path(ellipseIn: CGRect(
                x: size.width - radius * 1.25, y: -radius * 0.55, width: radius * 2, height: radius * 2))
            context.fill(
                sun,
                with: .radialGradient(
                    Gradient(colors: [accent.opacity(0.32), accent.opacity(0)]),
                    center: CGPoint(x: size.width - radius * 0.25, y: radius * 0.45),
                    startRadius: 0, endRadius: radius))
        }
        .background(Palette.paperRaised)
        .accessibilityHidden(true)
    }
}
