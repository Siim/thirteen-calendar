import Foundation
import ThirteenKit

/// The copy of event details, the editor, the date field, the repeat, alert and calendar pickers and
/// the span, conflict, move and delete questions (docs/EVENTS.md §2.19), in one place so the screens
/// and their tests agree and the no-dashes check has one list to read. English, verbatim; Apple
/// title case for buttons, navigation titles and alert titles (§2.19); typographic apostrophes, as
/// the other events strings of this app. Plural entries take their count.
enum EditorCopy {
    // MARK: Details (§2.10)

    static let tentative = "Tentative"
    static let canceled = "Canceled"
    static let allDay = "All day"
    static let starts = "Starts"
    static let ends = "Ends"
    static let time = "Time"
    static let repeatLabel = "Repeat"
    static let calendar = "Calendar"
    static let alerts = "Alerts"
    static let showAs = "Show as"
    static let location = "Location"
    static let url = "URL"
    static let notes = "Notes"
    static let organizer = "Organizer"
    static let invitees = "Invitees"
    static let edit = "Edit"
    static let deleteEvent = "Delete Event"
    static let editAlerts = "Edit Alerts"
    static let openInCalendar = "Open in Calendar"
    static let duplicate = "Duplicate"
    static let more = "More"
    static let done = "Done"
    static let customSchedule = "Repeats on a custom schedule"

    /// `event.invitees.count` (plural).
    static func inviteeCount(_ n: Int) -> String { n == 1 ? "1 invitee" : "\(n) invitees" }

    /// `event.timeRange`.
    static func timeRange(_ start: String, _ end: String) -> String { "\(start) to \(end)" }

    /// `event.zoneLine`: "In New York: 21:00 to 22:00".
    static func zoneLine(city: String, start: String, end: String) -> String { "In \(city): \(start) to \(end)" }

    /// `{name}, {account}` of the details' Calendar row ("Home, iCloud").
    static func calendarLine(_ name: String, account: String) -> String { account.isEmpty ? name : "\(name), \(account)" }

    /// The Show as values.
    static func availability(_ value: Availability) -> String {
        switch value {
        case .busy: busy
        case .free: free
        case .tentative: tentative
        case .unavailable: "Unavailable"
        }
    }

    // MARK: Editor (§2.11)

    static let titleNew = "New Event"
    static let titleEdit = "Edit Event"
    static let titleAlerts = "Edit Alerts"
    static let add = "Add"
    static let save = "Save"
    static let cancel = "Cancel"
    static let titlePlaceholder = "Title"
    static let defaultTitle = "New event"
    static let locationPlaceholder = "Location"
    static let allDayToggle = "All-day"
    static let endRepeat = "End Repeat"
    static let endRepeatNever = "Never"
    static let endRepeatOnDate = "On Date"
    static let endRepeatAfter = "After"
    static let alert = "Alert"
    static let secondAlert = "Second Alert"
    static let showAsRow = "Show As"
    static let busy = "Busy"
    static let free = "Free"
    static let urlPlaceholder = "URL"
    static let notesPlaceholder = "Notes"

    /// `editor.endRepeat.times` (plural).
    static func times(_ n: Int) -> String { n == 1 ? "1 time" : "\(n) times" }

    /// `editor.gregorianCaption`.
    static func gregorianCaption(_ date: GregorianDate) -> String { "Gregorian \(EventFormat.gregorianDate(date))" }

    /// `editor.thirteenCaption`: "IFC Thursday, October 12, 2026" (an intercalary day: "IFC Year Day 2026").
    static func thirteenCaption(_ date: GregorianDate, system: CalendarSystemID) -> String {
        "\(system.shortName) \(EventFormat.date(date, system: system))"
    }

    /// `editor.dateButton`: "IFC Thu, Oct 12, 2026"; an intercalary day "Year Day 2026".
    static func dateButton(_ date: GregorianDate, system: CalendarSystemID) -> String {
        let thirteen = ThirteenDate(date, system: system)
        if thirteen.isIntercalary { return thirteen.formatted(FormatOptions(style: .long)) }
        return "\(system.shortName) \(thirteen.formatted(FormatOptions(style: .medium, includeWeekday: true)))"
    }

    /// `editor.dateButton.a11y`: "Starts, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026".
    static func dateButtonLabel(field: String, date: GregorianDate, system: CalendarSystemID) -> String {
        "\(field), \(thirteenCaption(date, system: system)). Gregorian \(EventFormat.gregorianDate(date))"
    }

    /// `editor.zoneNote`: "Times are in New York time."
    static func zoneNote(city: String) -> String { "Times are in \(city) time." }

    /// The city of an IANA zone for `event.zoneLine` and `editor.zoneNote` ("America/New_York": "New York").
    static func city(ofZone zone: String) -> String {
        let last = zone.split(separator: "/").last.map(String.init) ?? zone
        return last.replacingOccurrences(of: "_", with: " ")
    }

    // Validation (§2.11, `editor.error.*`).
    static let errorEndBeforeStart = "The end must be after the start."
    static let errorUntilBeforeStart = "The repeat must end after the event starts."
    static func errorCountRange(max: Int = 999) -> String { "Choose from 1 to \(max) times." }
    static let errorURL = "Enter a web address, like example.com."
    static let errorReadOnlyCalendar = "This calendar can’t be changed. Choose another calendar."
    static let errorOutOfRange = "Choose a date from 1583 to 9999."

    static let calendarSameAccount = "Events with invitees stay in their own account."

    // Conflict dialog (`editor.conflict.*`).
    static func conflictTitle(calendar: String) -> String { "\(calendar) Can’t Keep This Repeat" }
    static let conflictMessage = "Exchange and Outlook calendars keep only repeats that follow the Gregorian calendar."
    static func conflictUseSafe(_ description: String) -> String { "Use “\(description)”" }
    static let conflictNever = "Change Repeat to Never"
    static let conflictOtherCalendar = "Choose Another Calendar"

    // Notices (`editor.notice.*`).
    static func repeatDropped(intercalaryName: String) -> String {
        "Repeat changed to Never: \(intercalaryName) belongs to no month and no week."
    }
    static func repeatChanged(_ description: String) -> String { "Repeat changed to \(description)." }
    static func laterDeleted(_ n: Int) -> String {
        n == 1
            ? "Saving for future events deletes 1 later event in this series."
            : "Saving for future events deletes the \(n) later events in this series."
    }
    static let laterDeletedEndless = "Saving for future events deletes every later event in this series."
    static func becomesSingle(date: String) -> String { "The series becomes one event on \(date)." }
    static func alertsTrimmed(calendar: String) -> String { "\(calendar) keeps only 1 alert, so the second alert was removed." }
    static func alertsRemoved(calendar: String) -> String { "\(calendar) doesn’t keep alerts, so the alerts were removed." }

    // Invitees (`editor.invitees.*`).
    static func inviteesFooter(_ n: Int) -> String { n == 1 ? "Changes are sent to 1 invitee." : "Changes are sent to \(n) invitees." }
    static func inviteesConfirm(_ n: Int) -> String { n == 1 ? "Send Changes to 1 Invitee?" : "Send Changes to \(n) Invitees?" }
    static let inviteesSend = "Send"

    // Write-only access.
    static let writeOnlyCalendar = "Default calendar"
    static let writeOnlyFooter = "New events go to your default calendar. To see them here, allow Full Access."

    // Discard (`editor.discard.*`).
    static let discardNewTitle = "Discard This Event?"
    static let discardNewButton = "Discard Event"
    static let discardEditTitle = "Discard Changes?"
    static let discardEditButton = "Discard Changes"
    static let discardKeep = "Keep Editing"

    static let changedElsewhere = "This event changed in another app. Your changes win where you both changed the same detail."
    static let deletedElsewhere = "This event was deleted in another app."
    static let occurrenceGone = "This event changed in another app. Open it again to edit it."
    static let saveFailedTitle = "Couldn’t Save the Event"
    static let saveFailedGeneric = "Please try again."
    static let saveFailedAccess = "Thirteen no longer has access to your calendars."
    static let saveFailedReadOnly = "This calendar can’t be changed. Choose another calendar."
    static let saveFailedAccount = "The calendar’s account didn’t accept this change. Try another calendar."

    // MARK: Span questions (§2.11, §4.7)

    static let spanTitle = "This is a repeating event."
    static let spanSaveMessage = "Save your changes for this event only, or for this and all future events?"
    static let spanSaveThis = "Save for This Event Only"
    static let spanSaveFuture = "Save for Future Events"
    static let spanSaveAll = "Save for All Events"
    static let spanKeepMessage = "Its repeat was set in another app. Save your changes for this event only, or for all events?"
    static let spanKeepDateMessage = "Its repeat was set in another app, so a new date can apply to this event only."
    static let spanKeepFirstGone =
        "Its repeat was set in another app, and its first event was changed or deleted, so this change can apply to this event only."
    static let spanRuleChanged = "Changing the repeat applies to this and all future events."
    static let spanExceptionsLost = "Changes you made to single events after this one will be lost."
    static func spanDeletesLater(_ n: Int) -> String {
        n == 1 ? "1 later event in this series will be deleted." : "The \(n) later events in this series will be deleted."
    }
    static let spanDeletesLaterEndless = "Every later event in this series will be deleted."

    // Moves between accounts (§4.7).
    static func moveConfirmTitle(title: String, calendar: String) -> String { "Move \(title) to \(calendar)?" }
    static func moveConfirmMessage(oldCalendar: String) -> String { "It will be copied there and removed from \(oldCalendar)." }
    static let moveConfirmButton = "Move"
    static func moveRepeatingTitle(calendar: String) -> String { "This Repeating Event Can’t Be Moved to \(calendar)" }
    static let moveRepeatingMessage =
        "Repeating events can’t be moved to a calendar in another account here. Duplicate it instead, or move it in the Calendar app."

    // Deletes (`delete.*`).
    static let deleteSingleTitle = "Delete This Event?"
    static let deleteSingleButton = "Delete Event"
    static let deleteRepeatingMessage = "Delete this event only, or this and all future events?"
    static let deleteRepeatingThis = "Delete This Event Only"
    static let deleteRepeatingFuture = "Delete All Future Events"
    static func deleteInvitees(_ n: Int) -> String {
        n == 1 ? "1 invitee will get a cancellation." : "\(n) invitees will get a cancellation."
    }

    // MARK: Date picker (§2.12)

    static let pickerGregorian = "Gregorian"
    static let pickerYear = "Year"
    static let pickerNoWeekday = "No weekday"
    static let previousYear = "Previous Year"
    static let nextYear = "Next Year"

    /// `picker.year.positivist`: "238, Gregorian 2026".
    static func positivistYear(displayYear: Int, year: Int) -> String { "\(displayYear), Gregorian \(year)" }
    /// `picker.slot.month`: "October, month 11 of 13".
    static func slotMonth(_ name: String, index: Int) -> String { "\(name), month \(index) of 13" }
    static let slotLeapDay = "Leap Day, leap years only"
    static let slotYearDay = "Year Day, belongs to no month"
    /// `picker.slot.festival`; Holy Women adds ", leap years only".
    static func slotFestival(_ name: String, leapOnly: Bool) -> String {
        leapOnly ? "\(name), belongs to no month, leap years only" : "\(name), belongs to no month"
    }
    /// `picker.cell`: "Thursday, October 12. Gregorian Monday, October 19".
    static func pickerCell(short: String, gregorianShort: String) -> String { "\(short). Gregorian \(gregorianShort)" }
    /// `picker.leapOnly`: "Leap Day happens only in leap years."
    static func leapOnly(_ dayName: String) -> String { "\(dayName) happens only in leap years." }
    /// `picker.fellBack`: "2027 has no Leap Day, so the date moved to June 28."
    static func fellBack(year: Int, dayName: String, dayAndMonth: String) -> String {
        "\(year) has no \(dayName), so the date moved to \(dayAndMonth)."
    }
    /// `picker.leapRepeat`: "Every Leap Day happens only in leap years, so the year moved to 2032."
    static func leapRepeat(dayName: String, year: Int) -> String {
        "Every \(dayName) happens only in leap years, so the year moved to \(year)."
    }

    // MARK: Repeat picker (§2.13)

    static let repeatTitle = "Repeat"
    static let repeatNever = "Never"
    static let repeatSectionGregorian = "Gregorian calendar"
    static let repeatGregorianFooter = "These follow the Gregorian calendar, like every other calendar app."
    static let repeatThirteenFooter = "Every 13-month month has 28 days, so monthly repeats never skip a month."
    static let repeatCustom = "Custom"
    static func repeatKeep(_ description: String) -> String { "Keep: \(description)" }
    static func repeatFooterSentence(_ footer: CalendarSourcePolicy.RepeatFooter) -> String {
        switch footer {
        case .apple: "Calendar on your iPhone, iPad and Mac shows the same days."
        case .appleGoogle: "Google Calendar on the web shows the same days."
        case .appleGoogleAndroid: "Calendar apps on Android may show other days."
        }
    }
    /// `repeat.note.exchange` / `.none`.
    static func exchangeNote(calendar: String, kinds: [String]) -> String {
        if kinds.isEmpty { return "\(calendar) can’t keep 13-month repeats." }
        return "\(calendar) can’t keep 13-month repeats. Choose a calendar from \(orList(kinds)) to use them."
    }
    /// `repeat.calendarWithKind`: "Work (Exchange)".
    static func calendarWithKind(_ name: String, kind: String) -> String { "\(name) (\(kind))" }
    /// `repeat.list.or`: "A", "A or B", "A, B or C".
    static func orList(_ items: [String]) -> String {
        if items.count <= 1 { return items.joined() }
        return "\(items.dropLast().joined(separator: ", ")) or \(items.last!)"
    }
    /// `repeat.kind` (Exchange for the calendar's own name in the notes and the conflict title).
    static func accountKind(_ kind: CalendarAccountKind) -> String {
        switch kind {
        case .icloud: "iCloud"
        case .google: "Google"
        case .caldav: "CalDAV"
        case .exchange: "Exchange"
        case .device:
            #if os(macOS)
            "On My Mac"
            #else
            deviceIsPad ? "On My iPad" : "On My iPhone"
            #endif
        case .subscribed: "Subscribed"
        case .birthdays: "Birthdays"
        case .other: "Other"
        }
    }

    /// Set by the app at launch on iPad (`repeat.kind` "On My iPad").
    nonisolated(unsafe) static var deviceIsPad = false

    // Custom repeat (`repeat.custom.*`).
    static let customFrequency = "Frequency"
    static let customEvery = "Every"
    static let customEach = "Each"
    static let customOnThe = "On the"
    static func frequency(_ f: CustomRecurrence.Frequency) -> String {
        switch f {
        case .daily: "Daily"
        case .weekly: "Weekly"
        case .monthly: "Monthly"
        case .yearly: "Yearly"
        }
    }
    /// `repeat.custom.unit` (plural).
    static func unit(_ f: CustomRecurrence.Frequency, _ n: Int) -> String {
        let (one, many): (String, String) =
            switch f {
            case .daily: ("day", "days")
            case .weekly: ("week", "weeks")
            case .monthly: ("month", "months")
            case .yearly: ("year", "years")
            }
        return n == 1 ? "1 \(one)" : "\(n) \(many)"
    }
    static let ordinals: [(Int, String)] = [(1, "first"), (2, "second"), (3, "third"), (4, "fourth"), (5, "fifth"), (-1, "last")]
    static func dayKind(_ kind: CustomRecurrence.DayKind) -> String {
        switch kind {
        case let .weekday(day): day.name(.long)
        case .day: "day"
        case .weekday5: "weekday"
        case .weekendDay: "weekend day"
        }
    }

    // MARK: Alerts (§2.14)

    static let alertNone = "None"

    /// Every user-visible template of this file with sample values, for the no-dashes check (§2.19).
    static var samples: [String] {
        var out = [
            tentative, canceled, allDay, starts, ends, time, repeatLabel, calendar, alerts, showAs, location, url, notes, organizer,
            invitees, edit, deleteEvent, editAlerts, openInCalendar, duplicate, more, done, customSchedule, titleNew, titleEdit,
            titleAlerts, add, save, cancel, titlePlaceholder, defaultTitle, locationPlaceholder, allDayToggle, endRepeat,
            endRepeatNever, endRepeatOnDate, endRepeatAfter, alert, secondAlert, showAsRow, busy, free, urlPlaceholder,
            notesPlaceholder, errorEndBeforeStart, errorUntilBeforeStart, errorCountRange(), errorURL, errorReadOnlyCalendar,
            errorOutOfRange, calendarSameAccount, conflictTitle(calendar: "Work (Exchange)"), conflictMessage,
            conflictUseSafe("Every year on IFC October 12"), conflictNever, conflictOtherCalendar,
            repeatDropped(intercalaryName: "Year Day"), repeatChanged("Every Year Day"), laterDeleted(1), laterDeleted(7),
            laterDeletedEndless, becomesSingle(date: "Year Day 2026"), alertsTrimmed(calendar: "Work"), alertsRemoved(calendar: "Work"),
            inviteesFooter(1), inviteesFooter(8), inviteesConfirm(1), inviteesConfirm(8), inviteesSend, writeOnlyCalendar,
            writeOnlyFooter, discardNewTitle, discardNewButton, discardEditTitle, discardEditButton, discardKeep, changedElsewhere,
            deletedElsewhere, occurrenceGone, saveFailedTitle, saveFailedGeneric, saveFailedAccess, saveFailedReadOnly,
            saveFailedAccount, spanTitle, spanSaveMessage, spanSaveThis, spanSaveFuture, spanSaveAll, spanKeepMessage,
            spanKeepDateMessage, spanKeepFirstGone, spanRuleChanged, spanExceptionsLost, spanDeletesLater(1), spanDeletesLater(7),
            spanDeletesLaterEndless, moveConfirmTitle(title: "Lunch", calendar: "Work"), moveConfirmMessage(oldCalendar: "Home"),
            moveConfirmButton, moveRepeatingTitle(calendar: "Work"), moveRepeatingMessage, deleteSingleTitle, deleteSingleButton,
            deleteRepeatingMessage, deleteRepeatingThis, deleteRepeatingFuture, deleteInvitees(1), deleteInvitees(8),
            pickerGregorian, pickerYear, pickerNoWeekday, previousYear, nextYear, positivistYear(displayYear: 238, year: 2026),
            slotMonth("October", index: 11), slotLeapDay, slotYearDay, slotFestival("Festival of Holy Women", leapOnly: true),
            pickerCell(short: "Thursday, October 12", gregorianShort: "Monday, October 19"), leapOnly("Leap Day"),
            fellBack(year: 2027, dayName: "Leap Day", dayAndMonth: "June 28"), leapRepeat(dayName: "Leap Day", year: 2032),
            repeatTitle, repeatNever, repeatSectionGregorian, repeatGregorianFooter, repeatThirteenFooter, repeatCustom,
            repeatKeep("Repeats on a custom schedule"), exchangeNote(calendar: "Work (Exchange)", kinds: ["iCloud", "Google"]),
            exchangeNote(calendar: "Work (Exchange)", kinds: []), customFrequency, customEvery, customEach, customOnThe, alertNone,
            inviteeCount(1), inviteeCount(6), zoneLine(city: "New York", start: "21:00", end: "22:00"), zoneNote(city: "New York"),
            times(1), times(3),
        ]
        out += CalendarSourcePolicy.RepeatFooter.allCases.map(repeatFooterSentence)
        out += CustomRecurrence.Frequency.allCases.flatMap { [frequency($0), unit($0, 1), unit($0, 2)] }
        out += ordinals.map(\.1)
        return out
    }
}
