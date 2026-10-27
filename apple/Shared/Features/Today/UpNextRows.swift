import SwiftUI
import ThirteenKit

// The event rows of Today's Up next (docs/EVENTS.md §2.8, board B1) and of the day sheet's Events
// section (§2.9): a time column in Geist Mono ("11:00", "11:00 AM", "All day" or "Day 2 of 3"), the
// calendar dot, the title (with the Now plate while it runs), and a second line with the location
// or "until 11:30". Each row is one button named by `calendar.row.a11y` + flags (§2.20) that opens
// the event's details. The texts come from `UpNextAgenda`.

/// One event row.
struct UpNextRow: View {
    let occurrence: OccurrenceSnapshot
    let item: AgendaItem
    /// The device wall clock, for the Now plate (`nil`: never shown).
    let now: LocalDateTime?
    let open: (String) -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let use24Hour = EventFormat.uses24HourClock
        let time = UpNextAgenda.timeText(occurrence, item: item, use24Hour: use24Hour)
        let detail = UpNextAgenda.detailText(occurrence, item: item, use24Hour: use24Hour)
        let calendar = model.events.calendar(id: occurrence.calendarID)
        let inProgress = now.map { UpNextAgenda.isInProgress(occurrence, now: $0) } ?? false
        let stacked = dynamicTypeSize.isAccessibilitySize
        Button {
            open(occurrence.key)
        } label: {
            let layout = stacked
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.xxs))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: Spacing.m))
            layout {
                TimeColumn(text: time, stacked: stacked)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                        UpNextDot(hex: calendar?.info.color)
                        titleLine(inProgress: inProgress)
                    }
                    if !detail.isEmpty {
                        Text(detail)
                            .font(Typography.text(.footnote))
                            .foregroundStyle(Palette.inkTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.leading, UpNextDot.defaultSize + Spacing.s)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, Spacing.s)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(UpNextRowButtonStyle())
        .accessibilityLabel(
            UpNextAgenda.accessibilityLabel(occurrence, item: item, calendarTitle: calendar?.info.title ?? "", time: time))
        .accessibilityValue(inProgress ? "Now" : "")
    }

    @ViewBuilder
    private func titleLine(inProgress: Bool) -> some View {
        // One flowing line: the title wraps, the Now plate and the status tag follow it.
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            Text(occurrence.title)
                .font(Typography.text(.subheadline, weight: .semibold))
                .foregroundStyle(occurrence.status == .canceled ? Palette.inkSecondary : Palette.ink)
                .strikethrough(occurrence.status == .canceled)
                .fixedSize(horizontal: false, vertical: true)
                .layoutPriority(1)
            if inProgress { NowPlate() }
            switch occurrence.status {
            case .tentative: UpNextStatusTag(text: "Tentative")
            case .canceled: UpNextStatusTag(text: "Canceled")
            case .confirmed: EmptyView()
            }
        }
    }
}

/// The time column, sized for "12:30 PM" at the current text size (§2.19 formatting rules), so the
/// titles line up; longer texts ("Day 10 of 12") wrap inside it.
private struct TimeColumn: View {
    let text: String
    let stacked: Bool

    var body: some View {
        if stacked {
            Text(text)
                .font(Typography.mono(.footnote))
                .foregroundStyle(Palette.inkSecondary)
        } else {
            ZStack(alignment: .topLeading) {
                Text("12:30 PM").hidden()
                Text(text)
                    .foregroundStyle(Palette.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .font(Typography.mono(.footnote))
            .accessibilityHidden(true)
        }
    }
}

/// A calendar's colour as a small dot with a hairline ring (board B1 `.swatch`).
struct UpNextDot: View {
    static let defaultSize: CGFloat = 8
    let hex: String?
    var size: CGFloat = UpNextDot.defaultSize

    var body: some View {
        Circle()
            .fill(Color(calendarHex: hex ?? "#888888"))
            .overlay { Circle().strokeBorder(Palette.rule, lineWidth: 0.5) }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// `today.now`: the plate on an event running now, in the accent (board B1 `.nowplate`).
private struct NowPlate: View {
    var body: some View {
        Text("Now")
            .font(Typography.mono(.caption2, weight: .semibold))
            .textCase(.uppercase)
            .tracking(0.4)
            .foregroundStyle(Palette.onAccent)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(Palette.accent, in: .rect(cornerRadius: 4))
            .fixedSize()
            .accessibilityHidden(true)
    }
}

/// `event.tentative` / `event.canceled` as a text tag (the status is never only a colour, §2.20).
struct UpNextStatusTag: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Typography.mono(.caption2, weight: .medium))
            .textCase(.uppercase)
            .tracking(0.5)
            .foregroundStyle(Palette.inkTertiary)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .overlay { RoundedRectangle(cornerRadius: 4).strokeBorder(Palette.rule, lineWidth: 1) }
            .fixedSize()
            .accessibilityHidden(true)
    }
}

/// A day's heading in Up next: "Today", "Tomorrow", or "Saturday, October 14" with "Gregorian
/// Wed, Oct 21" (§2.8, board B1).
struct UpNextDayHeading: View {
    let kind: UpNextAgenda.Kind
    let gregorian: GregorianDate
    let thirteen: ThirteenDate

    var body: some View {
        Group {
            switch kind {
            case .today:
                name("Today").accessibilityLabel("Today")
            case .tomorrow:
                name("Tomorrow").accessibilityLabel("Tomorrow")
            case .later:
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                        name(UpNextAgenda.dayHeading(thirteen))
                        caption
                    }
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        name(UpNextAgenda.dayHeading(thirteen))
                        caption
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(UpNextAgenda.dayHeadingLabel(thirteen: thirteen, gregorian: gregorian))
            }
        }
        .accessibilityAddTraits(.isHeader)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func name(_ text: String) -> some View {
        Text(text)
            .font(Typography.text(.footnote, weight: .bold))
            .foregroundStyle(Palette.ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var caption: some View {
        Text(UpNextAgenda.gregorianCaption(gregorian))
            .font(Typography.mono(.caption2))
            .foregroundStyle(Palette.inkTertiary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A row that dims while pressed and shows the keyboard focus on iPad and Mac.
private struct UpNextRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background {
                if configuration.isPressed {
                    Rectangle().fill(Palette.ink.opacity(0.06)).padding(.horizontal, -Spacing.l)
                }
            }
    }
}

/// A faint divider between rows (board B1 `rule-soft`).
struct UpNextDivider: View {
    var body: some View {
        Rectangle()
            .fill(Palette.rule.opacity(0.6))
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}
