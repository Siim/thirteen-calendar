import SwiftUI
import ThirteenKit

/// Progress through the year across 13 equal months (SPEC §5.1): 13 identical segments, with the
/// intercalary day(s) as small seals in their true positions (IFC Leap Day after June, the
/// year-end day(s) after the last month).
struct YearProgressView: View {
    let comparison: Comparison
    var showsCaption = true

    private var system: CalendarSystemID { comparison.thirteen.system }
    private var year: Int { comparison.gregorian.year }
    private var occurrences: [IntercalaryOccurrence] {
        (try? IntercalaryOccurrence.all(inYear: year, system: system)) ?? []
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack(alignment: .top, spacing: 3) {
                ForEach(system.months) { info in
                    VStack(spacing: Spacing.xs) {
                        segment(month: info.index)
                        Text(String(info.shortName.prefix(1)))
                            .font(Typography.mono(.caption2, weight: info.index == currentMonth ? .bold : .regular))
                            .foregroundStyle(info.index == currentMonth ? Palette.accentText : Palette.inkTertiary)
                    }
                    ForEach(occurrences.filter { $0.afterMonth == info.index }) { occurrence in
                        seal(occurrence)
                    }
                }
            }
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .accessibilityHidden(true)

            if showsCaption {
                ViewThatFits(in: .horizontal) {
                    HStack {
                        Text(Phrasing.dayOfYear(comparison))
                        Spacer()
                        Text("\(Phrasing.percent(comparison.yearProgress)) of the year done")
                    }
                    VStack(alignment: .leading) {
                        Text(Phrasing.dayOfYear(comparison))
                        Text("\(Phrasing.percent(comparison.yearProgress)) of the year done")
                    }
                }
                .font(Typography.display(.footnote))
                .foregroundStyle(Palette.inkSecondary)
                .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Year progress")
        .accessibilityValue(accessibilityValue)
    }

    private var currentMonth: Int? { comparison.thirteen.monthDate?.month }

    /// Completed fraction of month `month` at the start of today, and whether today is in it.
    private func fill(month: Int) -> (done: Double, isCurrent: Bool) {
        switch comparison.thirteen {
        case let .month(date):
            if month < date.month { return (1, false) }
            if month > date.month { return (0, false) }
            return (Double(date.day - 1) / 28, true)
        case let .intercalary(date):
            return (month <= date.info.afterMonth ? 1 : 0, false)
        }
    }

    private func segment(month: Int) -> some View {
        let (done, isCurrent) = fill(month: month)
        return GeometryReader { proxy in
            let width = proxy.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.paperSunk)
                Rectangle()
                    .fill(Palette.accent)
                    .frame(width: width * done)
                if isCurrent {
                    // Today: the day in progress, a lighter slice after the completed days.
                    Rectangle()
                        .fill(Palette.accent.opacity(0.4))
                        .frame(width: max(width / 28, 2))
                        .offset(x: width * done)
                }
            }
            .clipShape(Capsule())
        }
        .frame(height: 10)
        .overlay {
            if isCurrent {
                Capsule().strokeBorder(Palette.accent, lineWidth: 1)
            }
        }
    }

    private func seal(_ occurrence: IntercalaryOccurrence) -> some View {
        let passed = occurrence.dayOfYear < comparison.dayOfYear
        let isToday = occurrence.dayOfYear == comparison.dayOfYear
        return VStack(spacing: Spacing.xs) {
            Circle()
                .fill(passed || isToday ? Palette.accent : Palette.paperSunk)
                .overlay { Circle().strokeBorder(Palette.accent, lineWidth: isToday ? 2 : 1) }
                .frame(width: 10, height: 10)
            Text("·").font(Typography.mono(.caption2)).foregroundStyle(.clear)
        }
    }

    private var accessibilityValue: String {
        let position: String
        switch comparison.thirteen {
        case let .month(date): position = "month \(date.month) of 13, \(date.monthInfo.name)"
        case let .intercalary(date): position = date.info.name
        }
        return "\(Phrasing.percent(comparison.yearProgress)), \(position), \(Phrasing.dayOfYear(comparison))"
    }
}
