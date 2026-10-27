import SwiftUI
import ThirteenKit

/// The full SPEC §3 comparison of one day, as labelled facts with plain-language explanations.
/// Used by the day-detail sheet and the converter.
struct ComparisonDetailView: View {
    let comparison: Comparison
    /// Phrase drift relative to today ("was 7 days ago") instead of "7 days earlier".
    var relativeToToday = false

    private var system: CalendarSystemID { comparison.thirteen.system }
    private var otherSystem: CalendarSystemID { system == .ifc ? .positivist : .ifc }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FactRow(title: "Weekday") {
                WeekdayShiftView(comparison: comparison)
            }
            FactRow(title: "Label drift", value: Phrasing.driftAmount(comparison.labelDrift)) {
                Text(Phrasing.labelDrift(comparison, relativeToToday: relativeToToday))
                    .explanation()
            }
            FactRow(title: "Month length", value: monthLengthValue) {
                Text(monthLengthText).explanation()
            }
            FactRow(title: "Day of year", value: "\(comparison.dayOfYear) of \(daysInYear)") {
                Text(dayOfYearText).explanation()
            }
            FactRow(title: "Year progress", value: Phrasing.percent(comparison.yearProgress)) {
                YearProgressView(comparison: comparison, showsCaption: false)
            }
            FactRow(
                title: Phrasing.yearDayName(system),
                value: daysUntilYearDay == 0 ? "today" : "in \(Phrasing.days(daysUntilYearDay))", content: { EmptyView() })
            FactRow(title: "Numeric", value: nil) {
                // Side by side, or stacked at large text sizes: a code never breaks across lines.
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: Spacing.xl) { codeChips }
                    VStack(alignment: .leading, spacing: Spacing.s) { codeChips }
                }
            }
            FactRow(title: otherSystem.name, value: nil, showsDivider: false) {
                otherSystemLine
            }
        }
    }

    // MARK: Values

    private var daysInYear: Int { comparison.daysIntoYear + 1 + comparison.daysRemainingInYear }
    private var daysUntilYearDay: Int { comparison.gregorian.daysUntilYearDay(in: system) }

    private var monthLengthValue: String {
        if let days = comparison.thirteenMonthDays { return "\(comparison.gregorianMonthDays) vs \(days)" }
        return "\(comparison.gregorianMonthDays) vs no month"
    }

    private var monthLengthText: String {
        let gregorian = "Gregorian \(comparison.gregorian.monthInfo.name) has \(comparison.gregorianMonthDays) days"
        switch comparison.thirteen {
        case let .month(date):
            return "\(gregorian); \(date.system.shortName) \(date.monthInfo.name) has 28, like every 13-month month: exactly four weeks."
        case let .intercalary(date):
            return "\(gregorian); \(date.info.name) belongs to no month at all."
        }
    }

    private var dayOfYearText: String {
        let leap = comparison.isLeapYear ? "a leap year of 366 days" : "a common year of 365 days"
        return "\(comparison.daysIntoYear) days done and \(comparison.daysRemainingInYear) to go in \(leap). Both calendars count from 1 January."
    }

    @ViewBuilder private var codeChips: some View {
        codeChip(comparison.thirteen.formatted(.numeric), label: system.shortName)
        codeChip(comparison.gregorian.isoString, label: "ISO 8601")
    }

    private func codeChip(_ code: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            Text(label).eyebrow()
            Text(code)
                .font(Typography.mono(.callout))
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .textSelection(.enabled)
        }
        .accessibilityElement(children: .combine)
    }

    private var otherSystemLine: some View {
        let other = comparison.thirteen.converted(to: otherSystem)
        let weekday = other.weekday.map { ", a \($0.name())" } ?? ", no weekday"
        return Text("\(other.formatted(.long))\(weekday)")
            .font(Typography.display(.body))
            .foregroundStyle(Palette.ink)
    }
}

/// A labelled fact: title (and optional short value) over an explanation or a small view.
struct FactRow<Content: View>: View {
    let title: String
    var value: String?
    var showsDivider = true
    @ViewBuilder var content: Content

    init(title: String, value: String? = nil, showsDivider: Bool = true, @ViewBuilder content: () -> Content) {
        self.title = title
        self.value = value
        self.showsDivider = showsDivider
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    titleText
                    Spacer(minLength: Spacing.m)
                    valueText
                }
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    titleText
                    valueText
                }
            }
            content
        }
        .padding(.vertical, Spacing.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            if showsDivider { Rectangle().fill(Palette.rule).frame(height: 1) }
        }
        .accessibilityElement(children: .combine)
    }

    private var titleText: some View {
        Text(title)
            .font(Typography.text(.subheadline, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private var valueText: some View {
        if let value {
            Text(value)
                .titleFont(.body)
                .foregroundStyle(Palette.accentText)
        }
    }
}

extension Text {
    /// Secondary explanatory sentence style.
    func explanation() -> some View {
        font(Typography.text(.callout))
            .foregroundStyle(Palette.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}
