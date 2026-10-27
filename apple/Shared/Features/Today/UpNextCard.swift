import SwiftUI
import ThirteenKit

// Today's "Up next" card under the hero (docs/EVENTS.md §2.8, board B1): "Up next" with "+" (a new
// event today) and "Show All in Calendar" (List mode from today); the groups Today, Tomorrow and
// later days (both calendars) for today and the 6 days after it, at most 6 rows and "{n} more in
// the next 7 days"; the Now plate; "Nothing else today." and "No events in the next 7 days.".
// Without access the card holds the access card's content (§2.16), and after 3 launches without a
// decision it collapses to the one-line link "See your events here", which expands it again.
// Shown whenever "Show my events" is on. The rows and their texts: UpNextRows.swift,
// Shared/Events/UpNextAgenda.swift.

/// Today's "Up next" card.
struct UpNextCard: View {
    @Environment(AppModel.self) private var model
    @State private var expandsLink = false

    var body: some View {
        let events = model.events
        if events.showsEvents && events.hasReadAuthorization {
            let today = model.today
            Group {
                if let card = events.accessCard {
                    if card == .notAsked && events.accessCardCollapsed && !expandsLink {
                        AccessLinkCard { expandsLink = true }
                    } else {
                        cardFrame {
                            AccessCardView(card: card, style: .embedded)
                                .padding(.horizontal, Spacing.l)
                                .padding(.bottom, Spacing.l)
                        }
                    }
                } else {
                    cardFrame {
                        TimelineView(.everyMinute) { _ in
                            UpNextContent(today: today, now: events.now())
                        }
                    }
                }
            }
            .onAppear { events.noteAccessCardShown() }
            .task(id: TaskKey(today: today, canShow: events.canShowEvents)) {
                await events.load(from: today, through: UpNextAgenda.lastDay(from: today))
            }
        }
    }

    private func cardFrame<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            UpNextHeader()
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.paperRaised, in: .rect(cornerRadius: Radius.card))
        .overlay { RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Palette.rule, lineWidth: 1) }
        .clipShape(.rect(cornerRadius: Radius.card))
        .accessibilityElement(children: .contain)
    }

    private struct TaskKey: Hashable {
        let today: GregorianDate
        let canShow: Bool
    }
}

/// "Up next" with "+" and "Show All in Calendar"; the actions move under the title when the
/// text is too large for one line.
private struct UpNextHeader: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: Spacing.m) {
                title
                Spacer(minLength: Spacing.s)
                actions
            }
            VStack(alignment: .leading, spacing: Spacing.xs) {
                title
                actions
            }
        }
        .padding(.horizontal, Spacing.l)
        .padding(.top, Spacing.m)
        .padding(.bottom, Spacing.xs)
    }

    private var title: some View {
        Text("Up next")
            .titleFont(.title3)
            .foregroundStyle(Palette.ink)
            .accessibilityAddTraits(.isHeader)
    }

    private var actions: some View {
        HStack(spacing: Spacing.s) {
            Button {
                Task { await model.newEvent(on: model.today) }
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.controlTint)
            .accessibilityLabel("New Event")
            .help("New Event")
            Button {
                model.noteNextAction()
                model.calendarDate = model.today
                model.showCalendar(mode: .list)
            } label: {
                Text("Show All in Calendar")
                    .font(Typography.text(.footnote, weight: .medium))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(minHeight: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.controlTint)
        }
        .padding(.vertical, -Spacing.s)
    }
}

/// The rows, or the state of the 7 days: loading, a failed load, every calendar hidden, nothing
/// left today, nothing at all.
private struct UpNextContent: View {
    let today: GregorianDate
    let now: LocalDateTime

    @Environment(AppModel.self) private var model

    var body: some View {
        let events = model.events
        let lastDay = UpNextAgenda.lastDay(from: today)
        let occurrences = events.occurrences(from: today, through: lastDay)
        // The clock's date is "today"; before the first minute tick after midnight AppState's
        // today may be ahead, so the agenda starts on whichever is later.
        let clock = now.date < today ? ((try? LocalDateTime(date: today, minute: 0)) ?? now) : now
        let agenda = UpNextAgenda(occurrences: occurrences, now: clock, system: model.system)
        let years = Set([today.year, lastDay.year])
        let states = years.map { events.loadState(year: $0) }
        VStack(alignment: .leading, spacing: 0) {
            if !events.calendars.isEmpty && events.visibleCalendarIDs.isEmpty {
                stateLine("All calendars are hidden.", button: "Show Calendars") { model.showCalendarsList() }
            } else if occurrences.isEmpty, states.contains(where: { if case .failed = $0 { true } else { false } }) {
                stateLine("Couldn’t load events.", button: "Try Again") {
                    Task { await events.load(from: today, through: lastDay) }
                }
            } else if occurrences.isEmpty, states.contains(where: { $0 == .loading || $0 == .notLoaded }) {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 64)
                    .accessibilityLabel("Loading events")
            } else if agenda.isEmpty {
                emptyLine("No events in the next 7 days.")
            } else {
                if !agenda.todayLeft {
                    groupHeading(.today, gregorian: today)
                    emptyLine("Nothing else today.")
                }
                ForEach(agenda.groups) { group in
                    groupHeading(group.kind, gregorian: group.gregorian, thirteen: group.thirteen)
                    ForEach(group.items, id: \.key) { item in
                        if let occurrence = occurrences.first(where: { $0.key == item.key }) {
                            UpNextDivider()
                            UpNextRow(occurrence: occurrence, item: item, now: clock) { model.openEvent(key: $0) }
                                .padding(.horizontal, Spacing.l)
                        }
                    }
                }
                if agenda.more > 0 {
                    UpNextDivider()
                    Text(UpNextAgenda.moreText(agenda.more))
                        .font(Typography.text(.footnote))
                        .foregroundStyle(Palette.inkTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, Spacing.l)
                        .padding(.vertical, Spacing.m)
                }
            }
        }
        .padding(.bottom, agenda.more > 0 ? 0 : Spacing.s)
    }

    private func groupHeading(_ kind: UpNextAgenda.Kind, gregorian: GregorianDate, thirteen: ThirteenDate? = nil) -> some View {
        UpNextDayHeading(kind: kind, gregorian: gregorian, thirteen: thirteen ?? ThirteenDate(gregorian, system: model.system))
            .padding(.horizontal, Spacing.l)
            .padding(.top, Spacing.m)
            .padding(.bottom, Spacing.xs)
    }

    private func emptyLine(_ text: String) -> some View {
        Text(text)
            .font(Typography.text(.subheadline))
            .foregroundStyle(Palette.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, Spacing.s)
    }

    private func stateLine(_ text: String, button: String, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text(text)
                .font(Typography.text(.subheadline))
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(button, action: action)
                .buttonStyle(.plain)
                .font(Typography.text(.subheadline, weight: .semibold))
                .foregroundStyle(Palette.controlTint)
                .frame(minHeight: 44)
        }
        .padding(.horizontal, Spacing.l)
        .padding(.top, Spacing.s)
        .padding(.bottom, Spacing.xs)
    }
}
