import SwiftUI
import ThirteenKit

/// A date set like an almanac plate: the fixed weekday as an eyebrow, a big Geist day numeral,
/// month and year, and the other calendar's reading of the same day underneath. Normally the
/// 13-month date is primary; the converter flips it to show a Gregorian result.
struct DatePlate: View {
    enum Size {
        /// Today hero (≈ 112 pt numeral).
        case hero
        /// Sheets, popovers, the converter and the menu bar (≈ 56 pt numeral).
        case compact
    }

    enum Primary {
        case thirteen
        case gregorian
    }

    let comparison: Comparison
    var size: Size = .hero
    var primary: Primary = .thirteen

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var thirteen: ThirteenDate { comparison.thirteen }
    private var gregorian: GregorianDate { comparison.gregorian }

    var body: some View {
        VStack(alignment: .leading, spacing: size == .hero ? Spacing.s : Spacing.xs) {
            Text(eyebrowText)
                .eyebrow(primary == .thirteen ? Palette.accentText : Palette.foil)

            switch (primary, thirteen) {
            case let (.thirteen, .month(date)):
                numeralFace(day: date.day, month: date.monthInfo.name, displayYear: date.displayYear)
            case let (.thirteen, .intercalary(date)):
                intercalaryFace(date)
            case (.gregorian, _):
                numeralFace(day: gregorian.day, month: gregorian.monthInfo.name, displayYear: gregorian.year)
            }

            Rectangle()
                .fill(Palette.rule)
                .frame(height: 1)
                .padding(.vertical, size == .hero ? Spacing.xs : Spacing.xxs)
                .accessibilityHidden(true)

            secondaryLine
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    // MARK: Text

    private var eyebrowText: String {
        if primary == .gregorian {
            return "\(gregorian.weekday.name())\u{00A0}· Gregorian"
        }
        switch thirteen {
        case let .month(date):
            return "\(date.weekday.name())\u{00A0}· Month\u{00A0}\(date.month)\u{00A0}of\u{00A0}13"
        case let .intercalary(date):
            let after = date.system.months[date.info.afterMonth - 1].name
            return "No weekday\u{00A0}· after \(after)\u{00A0}28"
        }
    }

    private var accessibilityText: String {
        let both = Phrasing.bothDates(thirteen: thirteen, gregorian: gregorian)
        guard primary == .gregorian else { return both }
        return "Gregorian \(gregorian.formatted(.init(style: .long, includeWeekday: true))). \(thirteen.system.shortName): \(thirteen.formatted(.init(style: .long, includeWeekday: true)))"
    }

    // MARK: Faces

    private var stackLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.xs))
            : AnyLayout(HStackLayout(alignment: .lastTextBaseline, spacing: size == .hero ? Spacing.m : Spacing.s))
    }

    private func numeralFace(day: Int, month: String, displayYear: Int) -> some View {
        stackLayout {
            Text(String(day))
                .displayNumeral(size: size == .hero ? 112 : 56, trimsTop: true)
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .contentTransition(.numericText())
            VStack(alignment: .leading, spacing: 0) {
                Text(month)
                    .displayWord(size: Typography.baseSize(monthStyle), relativeTo: monthStyle)
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                yearLine(displayYear)
            }
        }
    }

    private var monthStyle: Font.TextStyle { size == .hero ? .largeTitle : .title2 }

    private func intercalaryFace(_ date: ThirteenIntercalaryDate) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(date.info.name)
                .displayWord(size: size == .hero ? 52 : 30, relativeTo: .title, weight: .bold)
                .foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
            yearLine(date.displayYear)
        }
    }

    private func yearLine(_ displayYear: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            Text(String(displayYear))
                .font(Typography.mono(size == .hero ? .callout : .footnote, weight: .medium))
                .foregroundStyle(Palette.inkSecondary)
            if primary == .thirteen, let note = Phrasing.gregorianYearNote(gregorian.year, system: thirteen.system) {
                Text(note)
                    .font(Typography.text(.caption))
                    .foregroundStyle(Palette.inkTertiary)
            }
        }
    }

    // MARK: The other calendar

    private var secondaryTitle: String { primary == .thirteen ? "Gregorian" : thirteen.system.shortName }

    private var secondaryText: String {
        switch primary {
        case .thirteen:
            return gregorian.formatted(.init(style: .long, includeWeekday: true))
        case .gregorian:
            if thirteen.isIntercalary { return "\(thirteen.formatted(.long)) (no weekday)" }
            return thirteen.formatted(.init(style: .long, includeWeekday: true))
        }
    }

    private var secondaryLine: some View {
        let color = primary == .thirteen ? Palette.foil : Palette.accentText
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                Text(secondaryTitle).eyebrow(color)
                secondaryValue
            }
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(secondaryTitle).eyebrow(color)
                secondaryValue
            }
        }
    }

    private var secondaryValue: some View {
        Text(secondaryText)
            .font(Typography.display(size == .hero ? .title3 : .body))
            .foregroundStyle(Palette.ink)
            .fixedSize(horizontal: false, vertical: true)
    }
}
