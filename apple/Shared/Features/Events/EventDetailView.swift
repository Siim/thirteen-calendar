import SwiftUI
import ThirteenKit

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

// Event details (docs/EVENTS.md §2.10, design/events/mockups.html board G1, task A7): the title
// with the calendar's color bar and the Tentative or Canceled tag; the date plate in both
// calendars (Starts and Ends lines for a multi-day event); the time, with a second line in the
// event's own zone; the repeat; the calendar; the alerts; Show as, location, URL, notes, organizer
// and invitees; the read-only reason; and the actions: Edit, Delete Event and Duplicate for
// writable events, "Open in Calendar" and "Edit Alerts" for invitations, Duplicate for every other
// read-only event. Pushed on iPhone, a popover on iPad and Mac, a sheet at accessibility sizes
// (EventPresentation.swift).

/// The details of one occurrence.
struct EventDetailView: View {
    enum Style: Hashable {
        /// Pushed onto the section's navigation stack (iPhone).
        case pushed
        /// A sheet with its own navigation stack and Done.
        case sheet
        /// An iPad or Mac popover.
        case popover
    }

    let key: String
    var style: Style = .sheet

    @Environment(AppModel.self) private var model
    @State private var snapshot: EventSnapshot?
    @State private var loaded = false
    /// The height of the scrolled content, so an iPad popover fits it (within 320 to 640 pt).
    @State private var contentHeight: CGFloat = 0

    /// The popover's navigation bar and its margins above the content.
    private static let barAllowance: CGFloat = 76

    var body: some View {
        switch style {
        case .pushed:
            content
        case .sheet:
            NavigationStack { content }
                #if os(macOS)
                .frame(minWidth: 360, idealWidth: 400, minHeight: 420, idealHeight: 560)
                #endif
        case .popover:
            #if os(macOS)
            // A Mac popover has no toolbar of its own: `.toolbar` items there land in the main
            // window's toolbar. Its actions are a row in the content instead (board A2 frame 8:
            // Edit, the ⋯ menu with Duplicate, Delete Event), and the title is only the heading.
            scroll(popoverRow: true)
                .background {
                    // Escape closes the popover (§2.21).
                    Button(EditorCopy.done) { model.presentedEvent = nil }
                        .keyboardShortcut(.cancelAction)
                        .opacity(0)
                        .accessibilityHidden(true)
                }
                .frame(minWidth: 360, idealWidth: 400, minHeight: 420, idealHeight: 560)
            #else
            NavigationStack { content }
                .frame(idealHeight: contentHeight > 0 ? contentHeight + Self.barAllowance : 560)
            #endif
        }
    }

    private var content: some View {
        scroll(popoverRow: false)
            .navigationTitle(snapshot?.event.title ?? "")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                #if os(iOS)
                // The title is the large heading of the content (board G1), not repeated in the bar.
                ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1).accessibilityHidden(true) }
                #endif
                toolbar
            }
    }

    /// The scrolled details; `popoverRow`: the actions as a row of buttons (Mac popover).
    private func scroll(popoverRow: Bool) -> some View {
        ScrollView {
            if let snapshot {
                EventDetailBody(snapshot: snapshot, popoverRow: popoverRow)
                    .padding(.horizontal, Spacing.l)
                    .padding(.vertical, Spacing.m)
                    .frame(maxWidth: Measure.column, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { contentHeight = $0 }
            } else if loaded {
                Text(EditorCopy.occurrenceGone)
                    .font(Typography.text(.body))
                    .foregroundStyle(Palette.inkSecondary)
                    .padding(Spacing.l)
            } else {
                ProgressView().padding(Spacing.xl)
            }
        }
        .background(Palette.paper)
        .task(id: "\(key)#\(model.events.changeCount)") { await load() }
        .eventDeleteDialog(model, host: .details(key))
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if style != .pushed {
            ToolbarItem(placement: .cancellationAction) {
                Button(EditorCopy.done) { model.presentedEvent = nil }
                    .keyboardShortcut(.cancelAction)
            }
        }
        if let snapshot {
            ToolbarItemGroup(placement: .primaryAction) {
                Menu(EditorCopy.more, systemImage: "ellipsis") {
                    Button(EditorCopy.duplicate, systemImage: "plus.square.on.square") {
                        Task { await model.duplicateEvent(key: snapshot.key) }
                    }
                }
                .accessibilityIdentifier("event.more")
                if snapshot.occurrence.readOnly == nil {
                    Button(EditorCopy.edit) { Task { await model.editEvent(key: snapshot.key) } }
                        .keyboardShortcut("e", modifiers: .command)
                        .accessibilityIdentifier("event.edit")
                }
            }
        }
    }

    private func load() async {
        do {
            let fetched = try await model.events.event(key: key)
            snapshot = fetched
            loaded = true
            if fetched == nil, model.presentedEvent?.key == key, loaded { model.presentedEvent = nil }
        } catch {
            snapshot = nil
            loaded = true
        }
    }
}

/// The details' content, top to bottom (§2.10).
struct EventDetailBody: View {
    let snapshot: EventSnapshot
    /// The Mac popover: Edit and the ⋯ menu (Duplicate) join Delete Event in one row at the end
    /// (board A2 frame 8), since the popover has no toolbar.
    var popoverRow = false

    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showsInvitees = false

    private var event: CalendarEvent { snapshot.event }
    private var occurrence: OccurrenceSnapshot { snapshot.occurrence }
    private var calendar: CalendarSnapshot? { snapshot.calendar ?? model.events.calendar(id: occurrence.calendarID) }
    private var system: CalendarSystemID { model.system }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            titleRow
            datePlate
            VStack(alignment: .leading, spacing: Spacing.m) {
                timeRows
                if occurrence.isRepeating {
                    row(EditorCopy.repeatLabel) { Text(repeatText) }
                }
                if let calendar {
                    row(EditorCopy.calendar) {
                        HStack(spacing: Spacing.s) {
                            Circle().fill(Color(calendarHex: calendar.info.color)).frame(width: 9, height: 9).accessibilityHidden(true)
                            Text(EditorCopy.calendarLine(calendar.info.title, account: calendar.info.accountTitle))
                        }
                    }
                }
                if !event.alarms.isEmpty {
                    row(EditorCopy.alerts) {
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            ForEach(Array(event.alarms.enumerated()), id: \.offset) { _, alarm in
                                Text(alarmText(alarm))
                            }
                        }
                    }
                }
                if event.availability != .busy {
                    row(EditorCopy.showAs) { Text(EditorCopy.availability(event.availability)) }
                }
                if !event.location.isEmpty {
                    row(EditorCopy.location) {
                        Button {
                            openLocation(event.location)
                        } label: {
                            Text(event.location).foregroundStyle(Palette.accentText).multilineTextAlignment(.leading)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens Maps")
                    }
                }
                if !event.url.isEmpty, let url = Self.webURL(event.url) {
                    row(EditorCopy.url) {
                        Link(destination: url) {
                            Text(event.url).foregroundStyle(Palette.accentText).multilineTextAlignment(.leading)
                        }
                    }
                }
                if !event.notes.isEmpty {
                    row(EditorCopy.notes) {
                        Text(Self.linkified(event.notes))
                            .textSelection(.enabled)
                            .tint(Palette.accentText)
                    }
                }
                if let organizer = event.organizer, event.attendeeCount > 0 {
                    row(EditorCopy.organizer) { Text(organizer.name) }
                }
                if event.attendeeCount > 0 {
                    row(EditorCopy.invitees) { inviteesValue }
                }
            }
            if let reason = occurrence.readOnly {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                    Image(systemName: "lock").accessibilityHidden(true)
                    Text(EventFormat.readOnlyReason(reason))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .font(Typography.text(.subheadline))
                .foregroundStyle(Palette.inkSecondary)
                .padding(Spacing.m)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.paperSunk, in: .rect(cornerRadius: Radius.control))
                .accessibilityElement(children: .combine)
            }
            actions
        }
        .font(Typography.text(.body))
        .foregroundStyle(Palette.ink)
    }

    // MARK: Parts

    private var titleRow: some View {
        HStack(alignment: .top, spacing: Spacing.m) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(calendarHex: calendar?.info.color ?? "#888888"))
                .frame(width: 4)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(event.title)
                    .font(.custom(Typography.faceName(.sans, weight: .semibold), size: 22, relativeTo: .title2))
                    .strikethrough(event.status == .canceled)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if event.status != .confirmed {
                    Text(event.status == .canceled ? EditorCopy.canceled : EditorCopy.tentative)
                        .font(Typography.text(.caption, weight: .semibold))
                        .foregroundStyle(Palette.inkSecondary)
                        .padding(.horizontal, Spacing.s)
                        .padding(.vertical, Spacing.xxs)
                        .overlay(Capsule().strokeBorder(Palette.rule))
                }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    /// The occurrence's last day (end-of-day form) and whether it covers more than one day.
    private var lastDay: GregorianDate {
        if occurrence.allDay {
            return occurrence.end.minute == 0 ? ((try? occurrence.end.date.adding(days: -1)) ?? occurrence.end.date) : occurrence.end.date
        }
        return occurrence.end.date
    }

    private var isMultiDay: Bool { lastDay > occurrence.start.date }

    private var datePlate: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if isMultiDay {
                plateLine(label: EditorCopy.starts, date: occurrence.start.date, minute: occurrence.allDay ? nil : occurrence.start.minute)
                plateLine(label: EditorCopy.ends, date: lastDay, minute: occurrence.allDay ? nil : displayEnd.minute)
            } else {
                plateLine(label: nil, date: occurrence.start.date, minute: nil)
            }
        }
        .padding(Spacing.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.paperRaised, in: .rect(cornerRadius: Radius.control))
        .overlay(RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Palette.rule))
    }

    private func plateLine(label: String?, date: GregorianDate, minute: Int?) -> some View {
        let time = minute.map { " \(EventFormat.time($0))" } ?? ""
        return VStack(alignment: .leading, spacing: Spacing.xxs) {
            if let label {
                Text(label).eyebrow()
            }
            Text(EventFormat.date(date, system: system) + time)
                .font(Typography.text(.headline, weight: .semibold))
            // "Gregorian Monday, October 19, 2026" (board G1; every label writes Gregorian so, §2.20).
            Text(EditorCopy.gregorianCaption(date))
                .font(Typography.mono(.caption))
                .foregroundStyle(Palette.inkSecondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var displayEnd: LocalDateTime { (try? occurrence.end.displayEnd()) ?? occurrence.end }

    @ViewBuilder private var timeRows: some View {
        if occurrence.allDay {
            row(EditorCopy.time) { Text(EditorCopy.allDay) }
        } else if !isMultiDay {
            row(EditorCopy.time) {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(EventFormat.timeRange(start: occurrence.start.minute, end: displayEnd.minute))
                    if let zoneLine { Text(zoneLine).foregroundStyle(Palette.inkSecondary) }
                }
            }
        } else if let zoneLine {
            row(EditorCopy.time) { Text(zoneLine).foregroundStyle(Palette.inkSecondary) }
        }
    }

    /// `event.zoneLine` when the event's zone differs from the device's.
    private var zoneLine: String? {
        guard !event.allDay, let zone = event.timeZone, zone != model.events.deviceZone else { return nil }
        let end = (try? event.end.displayEnd()) ?? event.end
        return EditorCopy.zoneLine(
            city: EditorCopy.city(ofZone: zone), start: EventFormat.time(event.start.minute), end: EventFormat.time(end.minute))
    }

    private var repeatText: String {
        guard let recurrence = snapshot.recurrence, let recognition = recurrence.recognition else { return EditorCopy.customSchedule }
        return (try? recognition.recurrence.description(start: recurrence.seriesStart.date, system: system)) ?? EditorCopy.customSchedule
    }

    private func alarmText(_ alarm: Alarm) -> String {
        (try? alarm.description(allDay: event.allDay, system: system, use24Hour: EventFormat.uses24HourClock)) ?? ""
    }

    @ViewBuilder private var inviteesValue: some View {
        let names = snapshot.invitees
        if event.attendeeCount > 5 || names.isEmpty {
            if names.isEmpty {
                Text(EditorCopy.inviteeCount(event.attendeeCount))
            } else {
                Button {
                    showsInvitees.toggle()
                } label: {
                    HStack(spacing: Spacing.xs) {
                        Text(EditorCopy.inviteeCount(event.attendeeCount))
                        Image(systemName: showsInvitees ? "chevron.down" : "chevron.right")
                            .font(.caption.weight(.semibold))
                            .accessibilityHidden(true)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityValue(showsInvitees ? "Expanded" : "Collapsed")
                if showsInvitees {
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        ForEach(Array(names.enumerated()), id: \.offset) { _, name in Text(name) }
                    }
                    .padding(.top, Spacing.xxs)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                ForEach(Array(names.enumerated()), id: \.offset) { _, name in Text(name) }
            }
        }
    }

    /// A labelled row: the label in a 96 pt column, or above the value at accessibility text sizes
    /// (where the column would break "TIME" and "CALENDAR" inside the word, §2.20 Text size).
    @ViewBuilder private func row(_ label: String, @ViewBuilder value: () -> some View) -> some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(label).eyebrow()
                    value().frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
                        Text(label).eyebrow().frame(width: 96, alignment: .leading)
                        value().frame(maxWidth: .infinity, alignment: .leading)
                    }
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        Text(label).eyebrow()
                        value().frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Actions

    @ViewBuilder private var actions: some View {
        let readOnly = occurrence.readOnly
        if popoverRow {
            HStack(spacing: Spacing.s) {
                if readOnly == nil {
                    Button(EditorCopy.edit) { Task { await model.editEvent(key: snapshot.key) } }
                        .keyboardShortcut("e", modifiers: .command)
                        .accentBorderedButtonStyle()
                        .accessibilityIdentifier("event.edit")
                }
                Menu {
                    Button(EditorCopy.duplicate, systemImage: "plus.square.on.square") {
                        Task { await model.duplicateEvent(key: snapshot.key) }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .menuIndicator(.hidden)
                .fixedSize()
                .accessibilityLabel(EditorCopy.more)
                .accessibilityIdentifier("event.more")
                Spacer(minLength: Spacing.s)
                if readOnly == nil {
                    deleteButton.fixedSize()
                }
            }
            .padding(.top, Spacing.s)
            if readOnly == .invitation {
                HStack(spacing: Spacing.m) { invitationButtons }
            }
        } else if readOnly == .invitation {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.m) { invitationButtons }
                VStack(alignment: .leading, spacing: Spacing.m) { invitationButtons }
            }
        } else if readOnly == nil {
            deleteButton
                .frame(maxWidth: .infinity)
                .padding(.top, Spacing.s)
        }
    }

    /// "Delete Event": the boards' danger red on a neutral fill (`.btn.danger`), 5.1:1 or more on
    /// every theme (system red on its own red tint was 2.3 to 2.5:1, §2.20).
    private var deleteButton: some View {
        Button(role: .destructive) {
            Task { await requestDelete() }
        } label: {
            Text(EditorCopy.deleteEvent)
                .font(Typography.text(.body, weight: .medium))
                .foregroundStyle(Palette.danger)
                .padding(.horizontal, Spacing.m)
                .frame(maxWidth: popoverRow ? nil : .infinity, minHeight: popoverRow ? 32 : 44)
                .background(Palette.paperSunk, in: .rect(cornerRadius: Radius.control))
                .overlay(RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Palette.rule))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("event.delete")
    }

    @ViewBuilder private var invitationButtons: some View {
        // Board G1: "Open in Calendar" filled with the accent, "Edit Alerts" in accent text.
        Button {
            openInCalendar()
        } label: {
            Text(EditorCopy.openInCalendar).foregroundStyle(Palette.onAccent)
        }
        .buttonStyle(.borderedProminent)
        .tint(Palette.accent)
        .frame(minHeight: 44)
        if event.alarmsEditable {
            Button {
                Task { await model.editAlerts(key: snapshot.key) }
            } label: {
                Text(EditorCopy.editAlerts).foregroundStyle(Palette.accentText)
            }
            .buttonStyle(.bordered)
            .frame(minHeight: 44)
        }
    }

    private func requestDelete() async {
        model.eventPresentation.deleteHost = .details(snapshot.key)
        await model.requestDeleteFromEditor(key: snapshot.key)
    }

    /// "Open in Calendar" (§2.10, gate V21): `calshow:` with the occurrence's start; on the Mac,
    /// the Calendar app without a date when that link does not open.
    private func openInCalendar() {
        let start = EventInstants.instant(occurrence.start, zone: model.events.deviceZone) ?? Date()
        let url = CalendarAccess.calendarAppURL(occurrenceStart: start)
        #if os(iOS)
        UIApplication.shared.open(url)
        #elseif os(macOS)
        if !NSWorkspace.shared.open(url) {
            NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Calendar.app"))
        }
        #endif
    }

    private func openLocation(_ location: String) {
        var components = URLComponents()
        components.scheme = "maps"
        components.host = ""
        components.queryItems = [URLQueryItem(name: "q", value: location)]
        if let url = components.url { openURL(url) }
    }

    /// The URL with `https://` added when the scheme is missing (§2.11).
    static func webURL(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        if trimmed.range(of: "^[A-Za-z][A-Za-z0-9+.-]*://", options: .regularExpression) != nil { return URL(string: trimmed) }
        return URL(string: "https://\(trimmed)")
    }

    /// Notes with their links made tappable (the text itself is never changed).
    static func linkified(_ text: String) -> AttributedString {
        var attributed = AttributedString(text)
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return attributed }
        let ns = text as NSString
        for match in detector.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            guard let url = match.url, let range = Range(match.range, in: text),
                let lower = AttributedString.Index(range.lowerBound, within: attributed),
                let upper = AttributedString.Index(range.upperBound, within: attributed)
            else { continue }
            attributed[lower..<upper].link = url
        }
        return attributed
    }
}
