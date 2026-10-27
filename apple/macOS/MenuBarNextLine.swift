import SwiftUI
import ThirteenKit

// The menu bar extra's line under the date (docs/EVENTS.md §2.8): "Next: 19:00 Book club:
// Cotsworth", read to VoiceOver as "Next event: Book club: Cotsworth at 19:00", or nothing. The
// next event is today's first timed occurrence that has not started yet (`UpNextAgenda.nextEvent`);
// the line follows the clock minute by minute. Nothing while "Show my events" is off or without
// full access.

/// The "Next:" line of the menu bar extra.
struct MenuBarNextLine: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let events = model.events
        if events.canShowEvents {
            let today = model.today
            TimelineView(.everyMinute) { _ in
                let now = events.now()
                if let next = UpNextAgenda.nextEvent(occurrences: events.occurrences(on: now.date), now: now) {
                    let use24Hour = EventFormat.uses24HourClock
                    HStack(spacing: Spacing.s) {
                        UpNextDot(hex: events.calendar(id: next.calendarID)?.info.color)
                        Text(UpNextAgenda.menuBarText(next, use24Hour: use24Hour))
                            .font(Typography.text(.callout, weight: .medium))
                            .foregroundStyle(Palette.ink)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(UpNextAgenda.menuBarLabel(next, use24Hour: use24Hour))
                    // Its own gap under the date (MenuBarContent stacks it with no spacing), so
                    // nothing is left behind when there is no next event.
                    .padding(.top, Spacing.m)
                }
            }
            .task(id: today) { await events.load(from: today, through: today) }
        }
    }
}
