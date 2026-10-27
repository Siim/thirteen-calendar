import SwiftUI
import ThirteenKit

/// An intercalary day (Year Day, Leap Day, the Positivist festivals): a day that belongs to no
/// month and no week. Drawn as a dashed "ticket" so it visibly sits outside the 4 × 7 grids.
struct IntercalaryDayBadge: View {
    let occurrence: IntercalaryOccurrence
    var isToday = false
    var isSelected = false
    var showsGregorian = true
    var compact = false
    /// Event dots (Calendar's Year mode, docs/EVENTS.md §2.3).
    var dots: EventDots?
    var action: (() -> Void)?

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
        .accessibilityLabel(accessibilityText)
        .accessibilityValue(DayCellView.accessibilityValue(isToday: isToday, dots: dots))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var system: CalendarSystemID { occurrence.thirteen.system }

    private var afterText: String {
        let month = system.months[occurrence.afterMonth - 1].name
        return "No weekday\u{00A0}· after \(month)\u{00A0}28"
    }

    private var face: some View {
        HStack(alignment: .center, spacing: Spacing.m) {
            Image(systemName: "seal")
                .font(compact ? .footnote : .title3)
                // AccentText: an icon on the accent wash (Accent is under 3:1 there in light mode).
                .foregroundStyle(isToday ? Palette.onAccent : Palette.accentText)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(compact ? occurrence.shortName : occurrence.name)
                    .titleFont(compact ? .footnote : .headline)
                    .foregroundStyle(isToday ? Palette.onAccent : Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(afterText)
                    .font(Typography.text(compact ? .caption2 : .caption))
                    .foregroundStyle(isToday ? Palette.onAccent : Palette.inkTertiary)
                if showsGregorian {
                    Text("Gregorian \(occurrence.gregorian.formatted(.init(style: .medium, includeYear: !compact, includeWeekday: true)))")
                        .font(Typography.text(compact ? .caption2 : .caption))
                        .foregroundStyle(isToday ? Palette.onAccent : Palette.foil)
                }
                if let dots {
                    EventDotRow(dots: dots, size: compact ? 4 : 6, onAccent: isToday)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, compact ? Spacing.s : Spacing.m)
        .padding(.vertical, compact ? Spacing.xs + 2 : Spacing.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                .fill(isToday ? Palette.accent : Palette.accentWash.opacity(0.55))
        }
        .overlay {
            RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                .strokeBorder(
                    isSelected ? Palette.accentText : Palette.accent.opacity(0.6),
                    style: StrokeStyle(lineWidth: isSelected ? 2 : 1.25, dash: isSelected ? [] : [5, 4]))
        }
        .contentShape(.rect)
    }

    private var accessibilityText: String {
        let date = ThirteenDate.intercalary(occurrence.thirteen)
        return "\(Phrasing.bothDates(thirteen: date, gregorian: occurrence.gregorian)). \(occurrence.description)"
    }
}
