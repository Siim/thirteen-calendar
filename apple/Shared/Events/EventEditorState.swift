import Foundation
import Observation
import ThirteenKit

/// One open event editor (docs/EVENTS.md §2.11; `AppModel.editor`): the draft being edited, the
/// draft as opened (the three-way merge's `original`), the validation issues, the notices, the
/// questions it asks (span, conflict, discard, invitees, moves between accounts) and the dirty flag.
/// `AppModel` makes it (`newEvent`, `editEvent`, `duplicateEvent`, `editAlerts`) and saves it
/// (`requestSave(undoManager:)` in EventEditorFlow.swift); `EventEditorView` edits it through the
/// methods below, never by writing ``draft``'s time, repeat, calendar or alert fields itself, so the
/// rules of §2.11 (duration kept, repeat re-derived, all-day restore, alert trimming) always apply.
@MainActor
@Observable
final class EventEditorState: Identifiable {
    enum Mode: Sendable, Hashable {
        /// "New event" ("+", ⌘N, a deep link, a drag or double-click on empty time).
        case new
        /// "Edit event" of an existing occurrence.
        case edit
        /// "Duplicate": an unsaved copy of another event; saved as a new event ("Add").
        case duplicate
        /// "Edit alerts" of an invitation: only Alert and Second alert (§3.5).
        case alertsOnly
    }

    /// What the iPad and Mac popover is anchored to (§2.11 Presentation); `.none` opens a sheet
    /// (iPad form sheet, Mac sheet window).
    enum Anchor: Sendable, Hashable {
        case none
        /// A draft block made by dragging in Week or Day, or a copy's drop.
        case draft
        /// A Month cell (double-click, touch and hold).
        case day(GregorianDate)
        /// An event (Edit or Duplicate in its details popover).
        case event(key: String)
    }

    /// The fields an issue or a focus request names, in form order (§2.11 Validation).
    enum Field: String, Sendable, Hashable, CaseIterable {
        case title, location, starts, ends, repeatRule, endRepeat, calendar, alert, secondAlert, url, notes
    }

    /// A notice under a field, announced politely once (§2.11).
    struct Notice: Sendable, Hashable {
        let field: Field
        let text: String
    }

    let id = UUID()
    let mode: Mode
    /// The occurrence being edited (edit, alerts only), or the source of a duplicate.
    let source: EventSnapshot?
    /// The draft as opened: the `original` of `mergeDraft` (§2.11) and the base of ``isDirty``.
    let original: EventDraft
    /// The draft as edited.
    var draft: EventDraft
    /// The span chosen in the span dialog (repeating events), `nil` until asked.
    var span: EditSpan?
    /// The issues the last save attempt (or the store) reported; ``liveIssues`` are the current ones.
    var issues: [DraftIssue] = []
    /// Write-only access: the Calendar row is fixed to the default calendar (§2.11, gate V22).
    let writeOnly: Bool
    var anchor: Anchor
    /// Another app changed a group the user also changed (the banner `editor.changedElsewhere`).
    var changedElsewhere = false
    /// A save is running.
    var isSaving = false
    /// The editor shows in a popover anchored to the calendar (iPad at regular width, Mac; set by
    /// `EventEditorView`): paging, Today and mode switches then ask first (§2.11).
    @ObservationIgnored var isInPopover = false
    /// What runs after "Discard Changes" when a navigation asked the discard question (paging,
    /// Today, a mode switch, a deep link, opening another event; §2.11).
    @ObservationIgnored var afterDiscard: (@MainActor () -> Void)?

    // MARK: Context (set by `AppModel` when the editor opens and when the calendars change)

    /// The calendars the store reports (the picker shows the writable ones).
    var calendars: [CalendarSnapshot] = []
    var system: CalendarSystemID = .ifc
    var deviceZone: String = TimeZone.current.identifier
    var use24Hour = true
    /// The Mac editor asks before sending changes to invitees (§2.11).
    var isMac: Bool = {
        #if os(macOS)
        true
        #else
        false
        #endif
    }()

    // MARK: Editing state

    /// The question the editor shows (span, conflict, discard, invitees, moves), or none.
    var question: EditorQuestion?
    /// A save that failed (`editor.saveFailed.*`), shown at the top of the form.
    var saveFailure: SaveFailureNotice?
    /// The field to move focus to (Save with issues, "Choose Another Calendar").
    var focusRequest: Field?
    /// The calendar picker is open ("Choose Another Calendar" of the conflict dialog).
    var showsCalendarPicker = false
    /// The repeat notice (`editor.notice.repeatDropped` / `repeatChanged`) of the last start change.
    private(set) var repeatNotice: String?
    /// The alerts notice (`editor.notice.alertsTrimmed` / `alertsRemoved`) of the last calendar change.
    private(set) var alertsNotice: String?
    /// The user chose a repeat or an end in the picker (not a re-derivation): the span dialog then
    /// offers only "future events" (§2.11).
    private(set) var userChangedRepeat = false
    /// The user replaced "Keep" with another repeat.
    private(set) var replacedKeep = false
    /// The repeat the start re-derivations start from: the last one the user chose, at the start it
    /// was chosen for, so moving away and back restores it.
    private var repeatBase: RepeatBase
    /// The times before all-day was turned on (restored when it is turned off).
    private var lastTimes: Times?
    /// The user chose Show as in this editor (all-day toggles no longer change it).
    private(set) var availabilityTouched = false
    /// The zone restored when all-day is turned off: the device zone for a new event, the zone the
    /// event had before it became all-day for an existing one. `.some(nil)` is a floating event
    /// (it comes back floating); `nil` is not known (an existing all-day event: the device zone).
    private var zoneBeforeAllDay: String??

    private struct RepeatBase: Hashable {
        var recurrence: EventRecurrence?
        var start: GregorianDate
    }

    private struct Times: Hashable {
        var start: Int
        var end: Int
    }

    init(mode: Mode, source: EventSnapshot?, draft: EventDraft, writeOnly: Bool = false, anchor: Anchor = .none) {
        self.mode = mode
        self.source = source
        self.original = draft
        self.draft = draft
        self.writeOnly = writeOnly
        self.anchor = anchor
        repeatBase = RepeatBase(recurrence: draft.recurrence, start: draft.start.date)
        if !draft.allDay {
            zoneBeforeAllDay = .some(draft.timeZone)
            lastTimes = Times(start: draft.start.minute, end: Self.displayEndMinute(draft))
        }
    }

    /// The editor for an existing occurrence (its own values, the series' repeat).
    convenience init(editing snapshot: EventSnapshot, anchor: Anchor = .none) {
        self.init(mode: .edit, source: snapshot, draft: snapshot.event.draft, anchor: anchor)
    }

    /// Sets what the editor needs to know about the app (calendars, system, zone, clock).
    func configure(calendars: [CalendarSnapshot], system: CalendarSystemID, deviceZone: String, use24Hour: Bool) {
        self.calendars = calendars
        self.system = system
        self.deviceZone = deviceZone
        self.use24Hour = use24Hour
        // A new event, and an existing all-day one, get the device's zone when all-day is turned off.
        if isNew || original.allDay, (zoneBeforeAllDay ?? nil) == nil { zoneBeforeAllDay = .some(deviceZone) }
    }

    // MARK: Basics

    /// The draft has changes (Cancel asks to discard them; the sheet cannot be swiped away).
    var isDirty: Bool { draft != original }

    /// "Add" for new events and duplicates, "Save" otherwise.
    var isNew: Bool { mode == .new || mode == .duplicate }

    /// The navigation title (Apple title case): "New Event", "Edit Event", "Edit Alerts".
    var title: String {
        switch mode {
        case .new, .duplicate: EditorCopy.titleNew
        case .edit: EditorCopy.titleEdit
        case .alertsOnly: EditorCopy.titleAlerts
        }
    }

    /// "Add" or "Save".
    var confirmTitle: String { isNew ? EditorCopy.add : EditorCopy.save }

    /// The occurrence key of an existing event.
    var key: String? { isNew ? nil : source?.key }

    /// The occurrence is part of a repeating series (a save asks for the span first, §2.11).
    var isRepeating: Bool { !isNew && (source?.occurrence.isRepeating ?? false) }

    /// Where a save writes.
    var target: SaveTarget {
        if isNew { return .new }
        guard let source else { return .new }
        return .existing(key: source.key, original: original)
    }

    /// The draft's calendar. With write-only access: the default calendar, whose account is unknown,
    /// with the strictest limits (`CalendarSourcePolicy.writeOnlyCalendar`), so the repeat picker
    /// disables the 13-month rows that are not Exchange-safe and only one alert is offered.
    var calendar: CalendarSnapshot? {
        if writeOnly {
            return CalendarSnapshot(
                info: CalendarSourcePolicy.writeOnlyCalendar(id: draft.calendarID), settings: CalendarSourcePolicy.writeOnlySettings)
        }
        return calendars.first { $0.id == draft.calendarID } ?? (source?.calendar?.id == draft.calendarID ? source?.calendar : nil)
    }

    /// The writable calendars of the picker.
    var writableCalendars: [CalendarSnapshot] { calendars.filter { $0.info.writable } }

    /// The stored repeat was set in another app and cannot be edited (§4.5): "Keep:" is checked
    /// until the user picks another repeat.
    var keepsForeignRepeat: Bool {
        guard !isNew, !replacedKeep, let stored = source?.recurrence else { return false }
        // A repeat core could not read is never written either (§4.5).
        return !(stored.recognition?.editable ?? false)
    }

    /// The description of the kept repeat ("Keep: {description}").
    var keepDescription: String? {
        guard keepsForeignRepeat else { return nil }
        guard let recurrence = source?.recurrence?.recognition?.recurrence, let start = source?.recurrence?.seriesStart.date else {
            return EditorCopy.customSchedule
        }
        return (try? recurrence.description(start: start, system: system)) ?? EditorCopy.customSchedule
    }

    /// The event has invitees that the user organizes (the footer, the Mac question, §2.11).
    var inviteeCount: Int {
        guard let source, !isNew, source.occurrence.organizedByCurrentUser else { return 0 }
        return source.event.attendeeCount
    }

    /// `editor.invitees.apple`, or nil.
    var inviteesFooter: String? { inviteeCount > 0 ? EditorCopy.inviteesFooter(inviteeCount) : nil }

    /// `editor.zoneNote` when the event's zone differs from the device's.
    var zoneNote: String? {
        guard !draft.allDay, let zone = draft.timeZone, zone != deviceZone,
            TimeZone(identifier: zone)?.identifier != TimeZone(identifier: deviceZone)?.identifier
        else { return nil }
        return EditorCopy.zoneNote(city: EditorCopy.city(ofZone: zone))
    }

    /// The calendar keeps more than one alert (the Second alert row, §2.14).
    var maxAlarms: Int? { calendar?.info.maxAlarms }

    /// The calendar supports Show as.
    var showsAvailability: Bool { calendar?.info.supportsAvailability ?? true }

    /// The calendar keeps a URL.
    var showsURL: Bool { calendar?.info.supportsURL ?? true }

    // MARK: Dates and times

    /// The Ends value as the date and time fields show it: a timed `D T24:00` is `D+1 00:00`
    /// (`displayEnd`, §2.12); an all-day end shows its last day.
    var displayEnd: LocalDateTime { Self.displayEnd(draft) }

    static func displayEnd(_ draft: EventDraft) -> LocalDateTime {
        if draft.allDay {
            let last = draft.end.minute == 0 ? ((try? draft.end.date.adding(days: -1)) ?? draft.end.date) : draft.end.date
            return (try? LocalDateTime(date: max(last, draft.start.date), minute: 0)) ?? draft.start
        }
        return (try? draft.end.displayEnd()) ?? draft.end
    }

    private static func displayEndMinute(_ draft: EventDraft) -> Int {
        draft.end.minute == Self.dayMinutes ? Self.dayMinutes : (try? draft.end.displayEnd().minute) ?? draft.end.minute
    }

    /// Changing Starts' date (time kept).
    func setStartDate(_ date: GregorianDate) {
        guard let start = try? LocalDateTime(date: date, minute: draft.allDay ? 0 : draft.start.minute) else { return }
        moveStart(to: start)
    }

    /// Changing Starts' time (date kept).
    func setStartMinute(_ minute: Int) {
        guard !draft.allDay, let start = try? LocalDateTime(date: draft.start.date, minute: minute) else { return }
        moveStart(to: start)
    }

    /// Changing Starts moves Ends by the same amount and re-derives the repeat from the new start
    /// (`moveDraftStart`, `adaptRecurrenceToStart`, §2.11), with the notice of the table.
    func moveStart(to start: LocalDateTime) {
        saveFailure = nil
        guard var moved = try? draft.movingStart(to: start, system: system).draft else { return }
        let base = repeatBase
        var change = RepeatChange.none
        if keepsForeignRepeat {
            moved.recurrence = draft.recurrence
        } else if let recurrence = base.recurrence, let adapted = try? recurrence.adapted(from: base.start, to: start.date) {
            moved.recurrence = adapted.recurrence
            change = adapted.change
        } else {
            moved.recurrence = base.recurrence
        }
        draft = moved
        switch change {
        case .dropped:
            let name = ThirteenDate(start.date, system: repeatSystem(base.recurrence)).intercalaryDate?.info.name ?? ""
            repeatNotice = EditorCopy.repeatDropped(intercalaryName: name)
        case .converted:
            repeatNotice = EditorCopy.repeatChanged(repeatDescription(draft.recurrence))
        case .none, .adapted:
            repeatNotice = nil
        }
    }

    private func repeatSystem(_ recurrence: EventRecurrence?) -> CalendarSystemID {
        if case let .thirteen(rule)? = recurrence?.rule { return rule.system }
        return system
    }

    /// Changing Ends' date (time kept). Ends never moves Starts; an end before the start stays as
    /// typed so its error shows.
    func setEndDate(_ date: GregorianDate) {
        saveFailure = nil
        if draft.allDay {
            if let end = try? LocalDateTime(date: date, minute: Self.dayMinutes) { draft.end = end }
            return
        }
        setEnd(date: date, minute: displayEnd.minute)
    }

    /// Changing Ends' time (date kept).
    func setEndMinute(_ minute: Int) {
        guard !draft.allDay else { return }
        saveFailure = nil
        setEnd(date: displayEnd.date, minute: minute)
    }

    private func setEnd(date: GregorianDate, minute: Int) {
        guard let end = try? LocalDateTime(date: date, minute: minute) else { return }
        // `normalizeEventEnd` (§2.12): a midnight end is stored as 24:00 of the day before.
        draft.end = (try? LocalDateTime.normalizedEnd(start: draft.start, end: end)) ?? end
    }

    /// All-day on keeps the dates and drops the times, and sets Show as to Free unless the user
    /// chose it; off restores the last times (or 09:00 to 10:00), the zone and Busy (`setDraftAllDay`).
    func setAllDay(_ allDay: Bool) {
        guard allDay != draft.allDay else { return }
        saveFailure = nil
        if allDay {
            lastTimes = Times(start: draft.start.minute, end: Self.displayEndMinute(draft))
            // A floating existing event stays floating; a new one always gets a zone.
            if draft.timeZone != nil || !isNew { zoneBeforeAllDay = .some(draft.timeZone) }
        }
        let previous = lastTimes.map { (start: $0.start, end: $0.end) }
        let restoredZone: String? = zoneBeforeAllDay ?? deviceZone
        guard
            let changed = try? draft.settingAllDay(
                allDay, previousTimes: allDay ? nil : previous, availabilityTouched: availabilityTouched,
                timeZone: allDay ? nil : restoredZone)
        else { return }
        draft = changed
    }

    /// Show as.
    func setAvailability(_ availability: Availability) {
        availabilityTouched = true
        draft.availability = availability
    }

    // MARK: Repeat

    /// A repeat chosen in the picker (a preset, Never or Custom): it replaces "Keep" and counts as a
    /// change of the rule (§2.11 span dialog).
    func setRecurrence(_ recurrence: EventRecurrence?) {
        saveFailure = nil
        draft.recurrence = recurrence
        repeatBase = RepeatBase(recurrence: recurrence, start: draft.start.date)
        userChangedRepeat = recurrence != original.recurrence
        if keepsForeignRepeat { replacedKeep = true }
        repeatNotice = nil
    }

    /// Picks "Keep: …" again: the stored repeat as read.
    func keepStoredRepeat() {
        draft.recurrence = original.recurrence
        repeatBase = RepeatBase(recurrence: original.recurrence, start: draft.start.date)
        replacedKeep = false
        userChangedRepeat = false
        repeatNotice = nil
    }

    /// End Repeat: Never, On date or After {n} times.
    func setRepeatEnd(_ end: RepeatEnd) {
        guard var recurrence = draft.recurrence else { return }
        recurrence.end = end
        setRecurrence(recurrence)
    }

    /// The repeat's description for the Repeat row (`describeRecurrence` without the end).
    func repeatDescription(_ recurrence: EventRecurrence?) -> String {
        if let keepDescription { return keepDescription }
        guard var recurrence else { return EditorCopy.repeatNever }
        recurrence.end = .never
        return (try? recurrence.description(start: draft.start.date, system: system)) ?? EditorCopy.customSchedule
    }

    /// The model of the repeat picker for this draft.
    var repeatPicker: RepeatPickerModel {
        RepeatPickerModel(
            start: draft.start.date, system: system, current: draft.recurrence, calendar: calendar,
            writableCalendars: writableCalendars, keepDescription: keepDescription)
    }

    /// The draft repeats on its leap-only start day (IFC Leap Day, Positivist Festival of Holy
    /// Women): the Starts year stepper moves between leap years (§2.11, §2.12).
    var repeatsOnLeapOnlyDay: Bool {
        guard case let .thirteen(.intercalary(system, id))? = draft.recurrence?.rule, id == .leapDay else { return false }
        return ThirteenDate(draft.start.date, system: system).intercalaryDate?.id == .leapDay
    }

    /// The original date of the edited occurrence (in the series' zone).
    var occurrenceOriginalDate: GregorianDate? {
        guard let source else { return nil }
        let zone = original.allDay ? deviceZone : (original.timeZone ?? deviceZone)
        return EventInstants.localDate(source.occurrence.occurrenceDate, zone: zone) ?? source.event.draft.start.date
    }

    /// The occurrences after this one that ending the repeat here would delete (`laterOccurrenceCount`):
    /// `nil` for a series that never ends.
    var laterCount: Int?? {
        guard let source, let recurrence = source.recurrence?.recognition?.recurrence ?? original.recurrence,
            let seriesStart = source.recurrence?.seriesStart.date ?? Optional(original.start.date), let at = occurrenceOriginalDate
        else { return .none }
        return .some((try? recurrence.laterCount(start: seriesStart, at: at)) ?? nil)
    }

    /// The later-events line under the Repeat notice (§2.11): the repeat of an edited occurrence
    /// became Never, so saving for future events deletes the later events.
    var laterEventsLine: String? {
        guard mode == .edit, let source, source.occurrence.isRepeating, draft.recurrence == nil else { return nil }
        if source.isFirstOccurrence { return EditorCopy.becomesSingle(date: EventFormat.date(draft.start.date, system: system)) }
        guard case let .some(count) = laterCount else { return nil }
        guard let count else { return EditorCopy.laterDeletedEndless }
        return count > 0 ? EditorCopy.laterDeleted(count) : nil
    }

    // MARK: Calendar and alerts

    /// Changing Calendar trims the alerts at once to what the new calendar keeps (§2.11), with the
    /// notice under Alert.
    func setCalendar(_ id: String) {
        saveFailure = nil
        draft.calendarID = id
        alertsNotice = nil
        guard let info = calendar?.info, let max = info.maxAlarms, draft.alarms.count > max else { return }
        draft.alarms = Array(draft.alarms.prefix(max))
        alertsNotice = max == 0 ? EditorCopy.alertsRemoved(calendar: info.title) : EditorCopy.alertsTrimmed(calendar: info.title)
    }

    /// Alert (index 0) and Second alert (index 1). "None" on Alert removes both.
    func setAlarm(_ alarm: Alarm?, at index: Int) {
        saveFailure = nil
        var alarms = draft.alarms
        if let alarm {
            if index < alarms.count {
                alarms[index] = alarm
            } else {
                alarms.append(alarm)
            }
        } else if index < alarms.count {
            alarms.remove(at: index)
        }
        draft.alarms = alarms
        alertsNotice = nil
    }

    /// The Second alert row shows once Alert is set and the calendar keeps more than one alert.
    var showsSecondAlert: Bool { !draft.alarms.isEmpty && (maxAlarms.map { $0 > 1 } ?? true) }

    /// The alert rows show unless the calendar keeps no alerts.
    var showsAlerts: Bool { maxAlarms.map { $0 > 0 } ?? true }

    // MARK: Validation (§2.11)

    /// The issues of the draft now (`validateDraft`), each shown under its field as soon as it
    /// exists. For an existing event only the issues its changed groups can cause count (a title
    /// edit of a series another app gave 1,500 times saves). `too-many-alarms` is fixed when the
    /// calendar changes and `repeat-not-on-start` by re-derivation, so neither shows. An occurrence
    /// of a series whose repeat the user did not choose is checked on its own, as "this event only"
    /// writes it (`SaveRules.thisEventOnly`): moving one occurrence past the repeat's end is allowed.
    /// "Future events" re-derives the repeat; the store checks that new series and its issues come
    /// back through ``noteReported(_:)``.
    var liveIssues: [DraftIssue] {
        guard mode != .alertsOnly else { return [] }
        let info: CalendarInfo
        if writeOnly {
            info = CalendarSourcePolicy.writeOnlyCalendar(id: draft.calendarID)
        } else if let calendar = calendar?.info {
            info = calendar
        } else {
            return []
        }
        var checked = draft
        var written = isNew ? DraftField.allCases : ((try? original.changedFields(to: draft)) ?? DraftField.allCases)
        if isRepeating && !repeatChosen { (checked, written) = SaveRules.thisEventOnly(draft, written: written) }
        let all = (try? EventKitStore.issues(of: checked, calendar: info, written: written)) ?? []
        return all.filter { $0 != .tooManyAlarms && $0 != .repeatNotOnStart }
    }

    /// The user chose the repeat in the picker and it differs from the stored one (the span dialog
    /// then offers only "future events", §2.11).
    var repeatChosen: Bool { userChangedRepeat && draft.recurrence != original.recurrence }

    /// Issues the store reported for the draft as it was saved (`invalidDraft`: a "future events"
    /// save whose new series cannot keep its repeat, say), with the draft they were found in.
    private var reported: (issues: [DraftIssue], draft: EventDraft)?

    /// Notes the store's issues: they show under their fields until the draft changes.
    func noteReported(_ issues: [DraftIssue]) {
        self.issues = issues
        reported = (issues, draft)
    }

    /// The issues shown under the fields: the live ones, plus what the store reported for this very
    /// draft (only issues with a text: `repeat-not-on-start` and `too-many-alarms` have none).
    var shownIssues: [DraftIssue] {
        let live = liveIssues
        guard let reported, reported.draft == draft else { return live }
        return live + reported.issues.filter { !live.contains($0) && !text(of: $0).isEmpty }
    }

    /// The field an issue is shown under.
    func field(of issue: DraftIssue) -> Field? {
        switch issue {
        case .endBeforeStart: .ends
        case .outOfRange: draft.start.date.year < 1583 ? .starts : .ends
        case .untilBeforeStart, .countOutOfRange: .endRepeat
        case .invalidURL: .url
        case .calendarReadOnly: .calendar
        case .thirteenRepeatNotAllowed: .repeatRule
        case .tooManyAlarms: .alert
        case .repeatNotOnStart: .repeatRule
        }
    }

    /// The text of an issue (`editor.error.*`); the Exchange conflict reads as the repeat picker's note.
    func text(of issue: DraftIssue) -> String {
        switch issue {
        case .endBeforeStart: EditorCopy.errorEndBeforeStart
        case .outOfRange: EditorCopy.errorOutOfRange
        case .untilBeforeStart: EditorCopy.errorUntilBeforeStart
        case .countOutOfRange: EditorCopy.errorCountRange()
        case .invalidURL: EditorCopy.errorURL
        case .calendarReadOnly: EditorCopy.errorReadOnlyCalendar
        case .thirteenRepeatNotAllowed: repeatPicker.thirteenFooter
        case .tooManyAlarms, .repeatNotOnStart: ""
        }
    }

    /// The error texts under a field.
    func errors(for field: Field) -> [String] {
        shownIssues.filter { self.field(of: $0) == field }.map(text(of:))
    }

    /// The notices under a field (repeat, later events, alerts), in order.
    func notices(for field: Field) -> [String] {
        switch field {
        case .repeatRule: [repeatNotice, laterEventsLine].compactMap { $0 }
        case .alert: [alertsNotice].compactMap { $0 }
        default: []
        }
    }

    /// The issues Save stops on (every issue but the Exchange conflict, which opens its dialog).
    var blockingIssues: [DraftIssue] { liveIssues.filter { $0 != .thirteenRepeatNotAllowed } }

    /// The first field with an issue, in form order (Save moves focus there, §2.11).
    var firstIssueField: Field? {
        let fields = Set(blockingIssues.compactMap(field(of:)))
        return Field.allCases.first(where: fields.contains)
    }

    // MARK: What Save writes

    /// The draft a save with `span` writes: an empty title is "New event"; a URL the user typed
    /// without a scheme gets `https://` (§2.11); "this event only" keeps the series' repeat (a
    /// re-derivation from a new start applies to future events only).
    func draftForSave(span: EditSpan) -> EventDraft {
        var out = draft
        if out.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.title = EditorCopy.defaultTitle }
        // Only a URL changed here: another app's URL is a group the user did not touch (§4.9).
        if out.url != original.url { out.url = Self.normalizedURL(out.url) }
        if isRepeating && span == .thisEvent { out.recurrence = original.recurrence }
        if keepsForeignRepeat { out.recurrence = original.recurrence }
        return out
    }

    /// The span question for a save of a repeating occurrence (§2.11, §4.7). `changedLater`: a
    /// changed occurrence of the series comes after this one (`span.future.exceptionsLost`).
    func spanQuestion(changedLater: Bool) -> SpanQuestion {
        let source = self.source
        if keepsForeignRepeat {
            if draft.start.date != original.start.date {
                return SpanQuestion(message: EditorCopy.spanKeepDateMessage, choices: [.thisEvent])
            }
            if !(source?.firstOccurrenceIntact ?? false) {
                return SpanQuestion(message: EditorCopy.spanKeepFirstGone, choices: [.thisEvent])
            }
            return SpanQuestion(message: EditorCopy.spanKeepMessage, choices: [.thisEvent, .allEvents])
        }
        let ruleChanged = repeatChosen
        var lines: [String] = []
        if changedLater && !(source?.isFirstOccurrence ?? true) { lines.append(EditorCopy.spanExceptionsLost) }
        var destructive = false
        if draft.recurrence == nil, case let .some(count) = laterCount, count != 0 {
            lines.append(count.map(EditorCopy.spanDeletesLater) ?? EditorCopy.spanDeletesLaterEndless)
            destructive = true
        }
        if ruleChanged {
            return SpanQuestion(message: EditorCopy.spanRuleChanged, lines: lines, choices: [.futureEvents], futureDestructive: destructive)
        }
        return SpanQuestion(message: EditorCopy.spanSaveMessage, lines: lines, choices: [.thisEvent, .futureEvents], futureDestructive: destructive)
    }

    /// The span question when the store reports that the series' first occurrence is gone
    /// (`span.keep.firstGone`).
    var firstGoneQuestion: SpanQuestion { SpanQuestion(message: EditorCopy.spanKeepFirstGone, choices: [.thisEvent]) }

    /// The conflict dialog of `thirteen-repeat-not-allowed` (§2.11).
    var conflictQuestion: ConflictQuestion {
        let picker = repeatPicker
        let safe = picker.exchangeSafeYearly
        return ConflictQuestion(
            title: EditorCopy.conflictTitle(calendar: picker.calendarWithKind), message: EditorCopy.conflictMessage,
            safeRecurrence: safe, safeLabel: safe.map { EditorCopy.conflictUseSafe(picker.description(Self.withoutEnd($0))) })
    }

    private static func withoutEnd(_ recurrence: EventRecurrence) -> EventRecurrence {
        var copy = recurrence
        copy.end = .never
        return copy
    }

    /// The question Cancel (or a swipe, a click outside, Escape) asks when the draft changed; `nil`
    /// closes at once (§2.11).
    var discardQuestion: EditorQuestion? {
        isDirty ? .discard(isNew: isNew) : nil
    }

    /// Notes another app's change while the editor is open (§2.11): the banner shows when the same
    /// group changed both here and elsewhere.
    func noteCurrent(_ current: EventSnapshot) {
        guard !isNew, let merge = try? EventDraft.merged(original: original, edited: draft, current: current.event.draft) else { return }
        changedElsewhere = !merge.conflicts.isEmpty
    }
}

// MARK: - Questions

/// A question the editor asks (§2.11): each is shown as a confirmation dialog or an alert by
/// `EventEditorView`, and answered through `AppModel` (EventEditorFlow.swift).
enum EditorQuestion: Identifiable, Hashable {
    /// "This is a repeating event." with the span choices.
    case span(SpanQuestion)
    /// "Work (Exchange) Can’t Keep This Repeat".
    case conflict(ConflictQuestion)
    /// "Discard Changes?" / "Discard This Event?".
    case discard(isNew: Bool)
    /// Mac: "Send Changes to {n} Invitees?".
    case invitees(count: Int)
    /// `move.confirm`: EventKit refused a move to another account; a single event is copied.
    case moveCopy(title: String, calendar: String, oldCalendar: String)
    /// `move.repeating`: a repeating event cannot be copied to another account.
    case moveRepeating(calendar: String)

    var id: String {
        switch self {
        case .span: "span"
        case .conflict: "conflict"
        case .discard: "discard"
        case .invitees: "invitees"
        case .moveCopy: "moveCopy"
        case .moveRepeating: "moveRepeating"
        }
    }

    /// The question's title.
    var title: String {
        switch self {
        case let .span(question): question.title
        case let .conflict(question): question.title
        case let .discard(isNew): isNew ? EditorCopy.discardNewTitle : EditorCopy.discardEditTitle
        case let .invitees(count): EditorCopy.inviteesConfirm(count)
        case let .moveCopy(title, calendar, _): EditorCopy.moveConfirmTitle(title: title, calendar: calendar)
        case let .moveRepeating(calendar): EditorCopy.moveRepeatingTitle(calendar: calendar)
        }
    }

    /// The question's message, if any.
    var message: String? {
        switch self {
        case let .span(question): question.fullMessage
        case let .conflict(question): question.message
        case .discard, .invitees: nil
        case let .moveCopy(_, _, oldCalendar): EditorCopy.moveConfirmMessage(oldCalendar: oldCalendar)
        case .moveRepeating: EditorCopy.moveRepeatingMessage
        }
    }
}

/// The span dialog of a save (§2.11): the message, the losses lines said before the choice, and the
/// choices offered.
struct SpanQuestion: Hashable, Sendable {
    var title = EditorCopy.spanTitle
    var message: String
    /// `span.future.exceptionsLost`, `span.deletesLater*`.
    var lines: [String] = []
    var choices: [EditSpan]
    /// "Save for Future Events" takes the destructive style (the repeat becomes Never).
    var futureDestructive = false

    var fullMessage: String { ([message] + lines).joined(separator: " ") }

    static func buttonTitle(_ span: EditSpan) -> String {
        switch span {
        case .thisEvent: EditorCopy.spanSaveThis
        case .futureEvents: EditorCopy.spanSaveFuture
        case .allEvents: EditorCopy.spanSaveAll
        }
    }
}

/// The conflict dialog of `thirteen-repeat-not-allowed` (§2.11).
struct ConflictQuestion: Hashable, Sendable {
    let title: String
    let message: String
    /// The start's Exchange-safe 13-month yearly or intercalary repeat, if any.
    let safeRecurrence: EventRecurrence?
    let safeLabel: String?
}

/// A failed save shown at the top of the editor: "Couldn’t Save the Event", the reason line
/// (`editor.saveFailed.*`) and the technical code in Geist Mono (§2.11).
struct SaveFailureNotice: Hashable, Sendable {
    let reason: String
    let code: String?

    @MainActor init(_ error: CalendarStoreError) {
        switch EventUndo.cause(of: error) {
        case let .final(reason?): self.reason = reason.text
        default: self.reason = EditorCopy.saveFailedGeneric
        }
        switch error {
        case let .saveFailed(failure): code = failure.code.isEmpty ? nil : failure.code
        case let .engine(text): code = text
        case let .unsupportedRecurrence(text): code = text
        case let .calendarNotFound(id): code = "calendarNotFound \(id)"
        default: code = nil
        }
    }
}

// MARK: - Helpers

extension EventEditorState {
    /// 1440, the minutes of a day (an end at 24:00).
    nonisolated static let dayMinutes = 1440

    /// A URL as saved (§2.11 URL): trimmed, with `https://` added when the text names no scheme
    /// (the web's `normalizeUrl`): "example.com" is "https://example.com", "mailto:a@b.ee" stays.
    nonisolated static func normalizedURL(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "" }
        let hasScheme = trimmed.range(of: "^[A-Za-z][A-Za-z0-9+.-]*:", options: .regularExpression) != nil
        return hasScheme ? trimmed : "https://\(trimmed)"
    }
}
