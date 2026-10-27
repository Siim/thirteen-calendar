import Foundation
import Testing
import ThirteenKit

private func day(_ iso: String) -> GregorianDate { EventsTest.day(iso) }
private func local(_ iso: String) -> LocalDateTime { EventsTest.local(iso) }

/// The editor's rules and flows on the fake store (docs/EVENTS.md §2.11, §4.7, §6.2
/// `EventEditorStateTests`, task A7): defaults, start moves and the re-derivation notices, all-day
/// toggles and Show as, midnight ends, validation and its focus order, the Exchange conflict and its
/// choices, alert trimming, dirty tracking and the discard paths, the span offering (including
/// repeats set in another app, "Save for all events" through `applyToSeries` and
/// `span.keep.firstGone`), the later-events lines and `span.deletesLater`, the merge banner, the
/// occurrence-gone path, the Mac invitee question, Duplicate and the delete question.
@MainActor
@Suite(.serialized)
struct EventEditorStateTests {

    static let bookClub = EventUndoTests.bookClub
    static let dentist = EventUndoTests.dentist
    static let standupFourth = "home/standup|2026-10-22T10:00"
    static let weekNoFirst = "home/week-twenty|2026-05-11T12:00"
    static let weekNoSecond = "home/week-twenty|2027-05-17T12:00"
    static let party = "home/party|2026-10-23T18:00"

    /// The mockup with an Exchange calendar ("Work", one alert), a calendar without alerts, a
    /// 10-time weekly series, a `BYWEEKNO` series (a repeat set in another app) and an event the
    /// user organizes with 3 invitees.
    static func mockup() throws -> FakeCalendarStore.Mockup {
        let base = try EventsTest.mockup()
        let exchange = CalendarInfo(
            id: "exchange", title: "Work", color: "#0f766e", accountID: "exchange", accountTitle: "Exchange", accountKind: .exchange,
            writable: true, thirteenRepeats: .gregorianOnly, maxAlarms: 1, supportsAvailability: true, supportsURL: true,
            isPlatformDefault: false)
        let quiet = CalendarInfo(
            id: "quiet", title: "Quiet", color: "#64748b", accountID: "device", accountTitle: "On My Mac", accountKind: .device,
            writable: true, thirteenRepeats: .all, maxAlarms: 0, supportsAvailability: true, supportsURL: true, isPlatformDefault: false)
        func timed(_ start: String, _ end: String, recurrence: EventRecurrence? = nil, calendar: String = "home") -> EventDraft {
            EventDraft(
                allDay: false, start: local(start), end: local(end), timeZone: EventsTest.zone, calendarID: calendar,
                recurrence: recurrence, availability: .busy)
        }
        var standup = timed("2026-10-01T10:00", "2026-10-01T10:15", recurrence: EventRecurrence(rule: .rrule(RRule(freq: .weekly)), end: .count(10)))
        standup.title = "Standup"
        var weekNo = timed(
            "2026-05-11T12:00", "2026-05-11T13:00",
            recurrence: EventRecurrence(rule: .rrule(RRule(freq: .yearly, byDay: [WeekdayNum(weekday: .monday)], byWeekNo: [20]))))
        weekNo.title = "Week twenty lunch"
        var party = timed("2026-10-23T18:00", "2026-10-23T20:00")
        party.title = "Party"
        let events =
            base.events + [
                CalendarEvent(id: "home/standup", draft: standup),
                CalendarEvent(id: "home/week-twenty", draft: weekNo),
                CalendarEvent(
                    id: "home/party", draft: party, organizer: CalendarEvent.Organizer(name: "Liis Kask", isCurrentUser: true),
                    attendeeCount: 3),
            ]
        return FakeCalendarStore.Mockup(
            now: base.now, deviceZone: base.deviceZone, calendars: base.calendars + [exchange, quiet], events: events,
            occurrences: base.occurrences)
    }

    /// A window on the fake store with the extended mockup.
    static func window() async throws -> (AppModel, FakeCalendarStore, Announcements) {
        let store = FakeCalendarStore(scenario: .fullAccess, mockup: try mockup(), deviceZone: EventsTest.zone)
        let (events, announcements) = EventsTest.model(store: store)
        let model = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") }, events: events)
        events.now = { EventsTest.now }
        await events.start()
        await events.load(years: 2026...2027)
        return (model, store, announcements)
    }

    static func editor(_ model: AppModel, key: String) async throws -> EventEditorState {
        await model.editEvent(key: key)
        return try #require(model.editor)
    }

    static func preset(_ id: String, start: GregorianDate) -> EventRecurrence? {
        RepeatPreset.all(start: start, system: .ifc).first { $0.id == id }?.recurrence
    }

    // MARK: Defaults, times and all-day

    @Test func newEventDefaultsAndContext() async throws {
        let (model, _, _) = try await Self.window()
        await model.newEvent(on: day("2026-10-21"))
        let editor = try #require(model.editor)
        #expect(editor.calendars.count == model.events.calendars.count && editor.calendar?.id == "home", "the editor knows the calendars")
        #expect(editor.draft.start == local("2026-10-21T09:00") && editor.draft.end == local("2026-10-21T10:00"))
        #expect(editor.draft.availability == .busy && editor.draft.recurrence == nil && editor.draft.alarms.isEmpty)
        #expect(editor.title == "New Event" && editor.confirmTitle == "Add" && editor.liveIssues.isEmpty)
        #expect(editor.zoneNote == nil && editor.inviteesFooter == nil && editor.showsSecondAlert == false)
    }

    @Test func startMovesEndAndEndNeverMovesStart() async throws {
        let (model, _, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.dentist)
        editor.setStartMinute(16 * 60)
        #expect(editor.draft.start == local("2026-10-19T16:00") && editor.draft.end == local("2026-10-19T16:40"), "duration kept")
        editor.setEndMinute(18 * 60)
        #expect(editor.draft.start == local("2026-10-19T16:00") && editor.draft.end == local("2026-10-19T18:00"))
        editor.setStartDate(day("2026-10-21"))
        #expect(editor.draft.start == local("2026-10-21T16:00") && editor.draft.end == local("2026-10-21T18:00"))
        #expect(editor.isDirty)
    }

    @Test func midnightEndsShowAsTheNextDay() async throws {
        let (model, _, _) = try await Self.window()
        await model.newEvent(on: day("2026-10-21"))
        let editor = try #require(model.editor)
        editor.setStartMinute(23 * 60)
        editor.setEndDate(day("2026-10-22"))
        editor.setEndMinute(0)
        #expect(editor.draft.end == local("2026-10-21T24:00"), "stored in end-of-day form")
        #expect(editor.displayEnd == local("2026-10-22T00:00"), "shown as 00:00 of the next day")
        #expect(editor.liveIssues.isEmpty)
    }

    @Test func allDayOnAndOffChangesNothing() async throws {
        let (model, _, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.dentist)
        editor.setAllDay(true)
        #expect(editor.draft.allDay && editor.draft.timeZone == nil && editor.draft.availability == .free)
        #expect(editor.draft.start == local("2026-10-19T00:00") && editor.draft.end == local("2026-10-19T24:00"))
        editor.setAllDay(false)
        #expect(editor.draft == editor.original && !editor.isDirty, "times, zone and Busy come back")

        editor.setAvailability(.busy)
        editor.setAllDay(true)
        #expect(editor.draft.availability == .busy, "a Show as the user chose stays")
    }

    @Test func newAllDayEventTurnedTimedGetsTheDeviceZone() async throws {
        let (model, _, _) = try await Self.window()
        await model.newEvent(on: day("2026-10-21"), allDay: true)
        let editor = try #require(model.editor)
        #expect(editor.draft.allDay && editor.draft.availability == .free)
        editor.setAllDay(false)
        #expect(editor.draft.timeZone == EventsTest.zone && editor.draft.start == local("2026-10-21T09:00"))
        #expect(editor.draft.end == local("2026-10-21T10:00") && editor.draft.availability == .busy)
    }

    // MARK: Re-derivation notices (§2.11 table)

    @Test func monthlyRepeatDroppedOnYearDayAndBack() async throws {
        let (model, _, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.bookClub)
        let monthly = editor.draft.recurrence
        editor.setStartDate(day("2026-12-31"))
        #expect(editor.draft.recurrence == nil)
        #expect(editor.notices(for: .repeatRule) == [
            "Repeat changed to Never: Year Day belongs to no month and no week.",
            "Saving for future events deletes every later event in this series.",
        ])
        editor.setStartDate(day("2026-10-20"))
        guard case .thirteen(.monthly(_, 13))? = editor.draft.recurrence?.rule else {
            Issue.record("follows the new month day")
            return
        }
        #expect(editor.notices(for: .repeatRule).isEmpty)
        editor.setStartDate(day("2026-10-19"))
        #expect(editor.draft.recurrence == monthly)
    }

    @Test func yearlyRepeatConvertsToTheIntercalaryRepeat() async throws {
        let (model, _, _) = try await Self.window()
        await model.newEvent(on: day("2026-10-19"))
        let editor = try #require(model.editor)
        editor.setRecurrence(Self.preset("thirteen-yearly", start: day("2026-10-19")))
        editor.setStartDate(day("2026-12-31"))
        #expect(editor.notices(for: .repeatRule) == ["Repeat changed to Every Year Day."])
        editor.setStartDate(day("2028-06-17"))
        #expect(editor.notices(for: .repeatRule) == ["Repeat changed to Every Leap Day."])

        editor.setRecurrence(Self.preset("thirteen-intercalary", start: day("2028-06-17")))
        #expect(editor.repeatsOnLeapOnlyDay, "the Starts year stepper moves between leap years")
        editor.setStartDate(day("2028-06-16"))
        #expect(editor.notices(for: .repeatRule) == ["Repeat changed to Every year on IFC June 28."])
    }

    // MARK: Validation (§2.11)

    @Test func issuesShowUnderTheirFieldsAndSaveMovesFocus() async throws {
        let (model, _, announcements) = try await Self.window()
        await model.newEvent(on: day("2026-10-21"))
        let editor = try #require(model.editor)
        editor.draft.url = "example"
        editor.setEndMinute(8 * 60)
        #expect(editor.errors(for: .ends) == ["The end must be after the start."])
        #expect(editor.errors(for: .url) == ["Enter a web address, like example.com."])
        #expect(editor.firstIssueField == .ends)
        await model.requestSave(undoManager: nil)
        #expect(model.editor === editor && editor.focusRequest == .ends, "nothing saved, focus on Ends")
        #expect(announcements.texts.last == "The end must be after the start.")

        editor.setStartDate(day("1500-03-01"))
        #expect(editor.errors(for: .starts) == ["Choose a date from 1583 to 9999."])
        editor.setRecurrence(Self.preset("weekly", start: editor.draft.start.date))
        editor.setRepeatEnd(.count(1000))
        #expect(editor.errors(for: .endRepeat) == ["Choose from 1 to 999 times."])
        editor.setRepeatEnd(.until(day("1400-01-01")))
        #expect(editor.errors(for: .endRepeat) == ["The repeat must end after the event starts."])
    }

    // MARK: Exchange (§2.11 conflict dialog, alert trimming)

    @Test func exchangeConflictUsesTheSafeYearlyRepeat() async throws {
        let (model, store, _) = try await Self.window()
        await model.newEvent(on: day("2026-10-19"))
        let editor = try #require(model.editor)
        editor.draft.title = "Archive day"
        editor.setRecurrence(Self.preset("thirteen-monthly", start: day("2026-10-19")))
        editor.setCalendar("exchange")
        #expect(editor.liveIssues == [.thirteenRepeatNotAllowed])
        #expect(editor.errors(for: .repeatRule).first?.hasPrefix("Work (Exchange) can’t keep 13-month repeats.") == true)
        await model.requestSave(undoManager: nil)
        guard case let .conflict(conflict)? = editor.question else {
            Issue.record("Save opens the conflict dialog")
            return
        }
        #expect(conflict.title == "Work (Exchange) Can’t Keep This Repeat")
        #expect(conflict.message == "Exchange and Outlook calendars keep only repeats that follow the Gregorian calendar.")
        #expect(conflict.safeLabel == "Use “Every year on IFC October 12”")
        await model.answerConflict(.useSafe, undoManager: nil)
        #expect(model.editor == nil, "saved with the yearly repeat")
        let saved = model.events.occurrences(on: day("2026-10-19")).first { $0.title == "Archive day" }
        let savedKey = try #require(saved?.key)
        let snapshot = try #require(try await store.event(key: savedKey))
        guard case .thirteen(.yearly(_, 11, 12))? = snapshot.event.recurrence?.rule else {
            Issue.record("every year on IFC October 12")
            return
        }
    }

    @Test func exchangeConflictOtherChoices() async throws {
        let (model, _, _) = try await Self.window()
        await model.newEvent(on: day("2026-10-19"))
        let editor = try #require(model.editor)
        editor.setRecurrence(Self.preset("thirteen-weekly", start: day("2026-10-19")))
        editor.setCalendar("exchange")
        await model.requestSave(undoManager: nil)
        await model.answerConflict(.otherCalendar, undoManager: nil)
        #expect(editor.showsCalendarPicker && editor.focusRequest == .calendar && model.editor === editor)
        await model.requestSave(undoManager: nil)
        await model.answerConflict(.never, undoManager: nil)
        #expect(model.editor == nil, "saved without a repeat")
    }

    @Test func calendarChangeTrimsAlertsAtOnce() async throws {
        let (model, _, _) = try await Self.window()
        await model.newEvent(on: day("2026-10-21"))
        let editor = try #require(model.editor)
        editor.setAlarm(.relative(offsetMinutes: -15), at: 0)
        #expect(editor.showsSecondAlert)
        editor.setAlarm(.relative(offsetMinutes: -60), at: 1)
        editor.setCalendar("exchange")
        #expect(editor.draft.alarms == [.relative(offsetMinutes: -15)] && !editor.showsSecondAlert)
        #expect(editor.notices(for: .alert) == ["Work keeps only 1 alert, so the second alert was removed."])
        editor.setCalendar("quiet")
        #expect(editor.draft.alarms.isEmpty && !editor.showsAlerts)
        #expect(editor.notices(for: .alert) == ["Quiet doesn’t keep alerts, so the alerts were removed."])
        editor.setAlarm(nil, at: 0)
        #expect(editor.notices(for: .alert).isEmpty)
    }

    // MARK: Dirty and discard (§2.11)

    @Test func closingAChangedDraftAsksFirst() async throws {
        let (model, _, _) = try await Self.window()
        var editor = try await Self.editor(model, key: Self.dentist)
        model.requestCloseEditor()
        #expect(model.editor == nil, "an unchanged draft just closes")

        editor = try await Self.editor(model, key: Self.dentist)
        editor.draft.notes = "Bring the card"
        model.requestCloseEditor()
        #expect(editor.question == .discard(isNew: false) && model.editor === editor)
        #expect(editor.question?.title == "Discard Changes?")
        model.confirmDiscard()
        #expect(model.editor == nil)

        await model.newEvent(on: day("2026-10-21"))
        let new = try #require(model.editor)
        new.draft.title = "Lunch"
        model.requestCloseEditor()
        #expect(new.question == .discard(isNew: true) && new.question?.title == "Discard This Event?")
    }

    /// Paging, Today and a mode switch under an editor popover ask first, so its anchor never leaves
    /// the screen; "Discard Changes" then goes on with the navigation and "Keep Editing" stays put.
    /// An unchanged popover just closes. Under a sheet the calendar pages as before (§2.11).
    @Test func navigatingUnderAnEditorPopoverAsksFirst() async throws {
        let (model, _, _) = try await Self.window()
        model.section = .calendar
        model.calendarMode = .month
        let start = model.calendarDate

        var editor = try await Self.editor(model, key: Self.dentist)
        editor.isInPopover = true
        model.pageCalendar(by: 1)
        #expect(model.editor == nil && model.calendarDate != start, "an unchanged draft closes and the page turns")

        model.calendarDate = start
        editor = try await Self.editor(model, key: Self.dentist)
        editor.isInPopover = true
        editor.draft.notes = "Bring the card"
        model.pageCalendar(by: 1)
        #expect(editor.question == .discard(isNew: false) && model.calendarDate == start, "asks; the page stays")
        model.keepEditing()
        #expect(editor.question == nil && editor.afterDiscard == nil && model.editor === editor)
        model.showCalendar(mode: .week)
        #expect(model.calendarMode == .month && editor.question == .discard(isNew: false))
        model.confirmDiscard()
        #expect(model.editor == nil && model.calendarMode == .week, "Discard Changes, then the mode switch")

        editor = try await Self.editor(model, key: Self.dentist)
        editor.isInPopover = true
        editor.draft.notes = "Bring the card"
        model.goToToday()
        #expect(editor.question == .discard(isNew: false))
        model.requestCloseEditor()
        model.confirmDiscard()
        #expect(model.calendarMode == .week, "Cancel's own question forgets the navigation")

        // A sheet: the calendar under it pages by itself.
        let sheet = try await Self.editor(model, key: Self.dentist)
        sheet.draft.notes = "Bring the card"
        let before = model.calendarDate
        model.pageCalendar(by: 1)
        #expect(model.editor === sheet && sheet.question == nil && model.calendarDate != before)
    }

    /// A deep link or opening another event while any editor with changes is open asks first; the
    /// link follows "Discard Changes" (§2.11).
    @Test func aDeepLinkUnderAChangedEditorAsksFirst() async throws {
        let (model, _, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.dentist)
        editor.draft.title = "Dentist"
        model.open(DeepLink(.history))
        #expect(model.section != .history && editor.question == .discard(isNew: false))
        model.confirmDiscard()
        #expect(model.editor == nil && model.section == .history)

        let again = try await Self.editor(model, key: Self.dentist)
        again.draft.title = "Dentist"
        model.openEvent(key: Self.bookClub)
        #expect(model.presentedEvent?.key != Self.bookClub && again.question == .discard(isNew: false))
        model.confirmDiscard()
        #expect(model.presentedEvent?.key == Self.bookClub)
    }

    /// A URL typed without a scheme is saved with `https://`; another app's URL is not rewritten (§2.11, §4.9).
    @Test func aURLWithoutASchemeGetsHTTPS() async throws {
        #expect(EventEditorState.normalizedURL(" example.com/path ") == "https://example.com/path")
        #expect(EventEditorState.normalizedURL("http://example.com") == "http://example.com")
        #expect(EventEditorState.normalizedURL("mailto:liis@example.ee") == "mailto:liis@example.ee")
        #expect(EventEditorState.normalizedURL("  ") == "")

        let (model, store, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.dentist)
        editor.draft.url = "hambaarst.ee"
        #expect(editor.liveIssues.isEmpty && editor.draftForSave(span: .thisEvent).url == "https://hambaarst.ee")
        await model.requestSave(undoManager: nil)
        #expect(try await store.event(key: Self.dentist)?.event.url == "https://hambaarst.ee")

        let other = try await Self.editor(model, key: Self.dentist)
        other.draft.title = "Dentist"
        #expect(other.draftForSave(span: .thisEvent).url == other.original.url, "an untouched URL is written back as read")
    }

    // MARK: Spans (§2.11, §4.7)

    @Test func spanOfferingForATitleEdit() async throws {
        let (model, store, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.bookClub)
        editor.draft.title = "Book club: Eastman"
        await model.requestSave(undoManager: nil)
        guard case let .span(span)? = editor.question else {
            Issue.record("a repeating occurrence asks for the span")
            return
        }
        #expect(span.title == "This is a repeating event." && span.choices == [.thisEvent, .futureEvents])
        #expect(span.message == "Save your changes for this event only, or for this and all future events?" && span.lines.isEmpty)
        await model.answerSpan(.thisEvent, undoManager: nil)
        #expect(model.editor == nil && model.events.undo.toast?.message == "Event saved." && model.events.undo.toast?.action == nil)
        #expect(try await store.event(key: Self.bookClub)?.event.title == "Book club: Eastman")
        #expect(try await store.event(key: "home/book-club|2026-11-16T19:00")?.event.title == "Book club: Cotsworth")
    }

    @Test func aStartMoveKeepsThisEventOnlyAndItsRepeat() async throws {
        let (model, store, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.bookClub)
        editor.setStartDate(day("2026-10-20"))
        let span = editor.spanQuestion(changedLater: false)
        #expect(span.choices == [.thisEvent, .futureEvents], "a re-derived repeat is not a rule the user changed")
        #expect(editor.draftForSave(span: .thisEvent).recurrence == editor.original.recurrence)
        await model.answerSpan(.thisEvent, undoManager: nil)
        #expect(try await store.event(key: "home/book-club|2026-11-16T19:00") != nil, "the series still repeats on the 12th")
    }

    @Test func aChangedRuleOffersOnlyFutureEventsWithItsLosses() async throws {
        let (model, store, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.standupFourth)
        editor.setRecurrence(nil)
        #expect(editor.notices(for: .repeatRule) == ["Saving for future events deletes the 6 later events in this series."])
        let span = editor.spanQuestion(changedLater: true)
        #expect(span.choices == [.futureEvents] && span.futureDestructive)
        #expect(span.message == "Changing the repeat applies to this and all future events.")
        #expect(span.lines == [
            "Changes you made to single events after this one will be lost.", "The 6 later events in this series will be deleted.",
        ])
        await model.requestSave(undoManager: nil)
        await model.answerSpan(.futureEvents, undoManager: nil)
        #expect(model.editor == nil)
        await model.events.load(years: 2026...2026)
        #expect(!model.events.occurrences(on: day("2026-10-29")).contains { $0.title == "Standup" }, "later events deleted")
        #expect(model.events.occurrences(on: day("2026-10-22")).contains { $0.title == "Standup" })
        #expect(try await store.event(key: "home/standup|2026-10-15T10:00") != nil, "earlier events stay")
    }

    @Test func theFirstOccurrenceBecomesOneEvent() async throws {
        let (model, _, _) = try await Self.window()
        let editor = try await Self.editor(model, key: "home/standup|2026-10-01T10:00")
        editor.setRecurrence(nil)
        #expect(editor.laterEventsLine == "The series becomes one event on \(EventFormat.date(day("2026-10-01"), system: .ifc)).")
        #expect(editor.spanQuestion(changedLater: false).lines == ["The 9 later events in this series will be deleted."])
    }

    @Test func aRepeatSetInAnotherAppIsKept() async throws {
        let (model, store, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.weekNoSecond)
        #expect(editor.keepsForeignRepeat && editor.keepDescription == "Repeats on a custom schedule")
        #expect(editor.repeatPicker.checkedID == RepeatPickerModel.keepID)
        editor.setStartMinute(14 * 60)
        #expect(editor.draft.recurrence == editor.original.recurrence, "never re-derived")
        let span = editor.spanQuestion(changedLater: false)
        #expect(span.choices == [.thisEvent, .allEvents])
        #expect(span.message == "Its repeat was set in another app. Save your changes for this event only, or for all events?")
        await model.requestSave(undoManager: nil)
        await model.answerSpan(.allEvents, undoManager: nil)
        #expect(model.editor == nil)
        let first = try #require(try await store.event(key: "home/week-twenty|2026-05-11T14:00"))
        #expect(first.event.start == local("2026-05-11T14:00"), "the series keeps its own first date and takes the new time")

        let moved = try await Self.editor(model, key: "home/week-twenty|2027-05-17T14:00")
        moved.setStartDate(day("2027-05-18"))
        #expect(moved.spanQuestion(changedLater: false).choices == [.thisEvent])
        #expect(moved.spanQuestion(changedLater: false).message == "Its repeat was set in another app, so a new date can apply to this event only.")
        model.closeEditor()

        // Replacing "Keep" with another repeat is a rule change.
        let replaced = try await Self.editor(model, key: "home/week-twenty|2027-05-17T14:00")
        replaced.setRecurrence(Self.preset("yearly", start: day("2027-05-17")))
        #expect(!replaced.keepsForeignRepeat && replaced.spanQuestion(changedLater: false).choices == [.futureEvents])
    }

    @Test func saveForAllEventsNeedsTheFirstOccurrence() async throws {
        let (model, store, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.weekNoSecond)
        editor.draft.title = "Lunch, week 20"
        try await store.remove(key: Self.weekNoFirst, span: .thisEvent)
        await model.requestSave(undoManager: nil)
        await model.answerSpan(.allEvents, undoManager: nil)
        guard case let .span(span)? = editor.question else {
            Issue.record("the store refused: asked again")
            return
        }
        #expect(span.choices == [.thisEvent])
        #expect(span.message == "Its repeat was set in another app, and its first event was changed or deleted, so this change can apply to this event only.")
        model.closeEditor()

        let reopened = try await Self.editor(model, key: Self.weekNoSecond)
        reopened.draft.title = "Lunch, week 20"
        #expect(reopened.spanQuestion(changedLater: false).choices == [.thisEvent], "known at open: only this event")
    }

    // MARK: Changes elsewhere (§2.11)

    @Test func theMergeBannerShowsOnlyForTheSameGroup() async throws {
        let (model, store, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.dentist)
        editor.draft.title = "Dentist"
        let original = editor.original
        var elsewhere = original
        elsewhere.location = "Riia 1"
        _ = try await store.save(draft: elsewhere, span: .thisEvent, target: .existing(key: Self.dentist, original: original))
        model.noteEditorCurrent(try await store.event(key: Self.dentist))
        #expect(!editor.changedElsewhere, "another group: nothing shows")
        var titled = elsewhere
        titled.title = "Dentist, Dr. Tamm (moved)"
        _ = try await store.save(draft: titled, span: .thisEvent, target: .existing(key: Self.dentist, original: elsewhere))
        model.noteEditorCurrent(try await store.event(key: Self.dentist))
        #expect(editor.changedElsewhere)
        await model.requestSave(undoManager: nil)
        let saved = try #require(try await store.event(key: Self.dentist))
        #expect(saved.event.title == "Dentist" && saved.event.location == "Riia 1", "my title wins, their location stays")
    }

    @Test func anOccurrenceGoneClosesTheEditor() async throws {
        let (model, store, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.bookClub)
        editor.draft.title = "Book club"
        try await store.remove(key: Self.bookClub, span: .thisEvent)
        await model.requestSave(undoManager: nil)
        await model.answerSpan(.thisEvent, undoManager: nil)
        #expect(model.editor == nil && model.eventsAlert == .occurrenceGone)
        #expect(EditorCopy.occurrenceGone == "This event changed in another app. Open it again to edit it.")
    }

    // MARK: Moves between accounts and save errors (§2.11, §4.7)

    /// A window whose store can fail the next writes.
    static func recordingWindow() async throws -> (AppModel, RecordingStore) {
        let store = RecordingStore(FakeCalendarStore(scenario: .fullAccess, mockup: try mockup(), deviceZone: EventsTest.zone))
        let (events, _) = EventsTest.model(store: store)
        let model = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") }, events: events)
        events.now = { EventsTest.now }
        await events.start()
        await events.load(years: 2026...2027)
        return (model, store)
    }

    @Test func aSingleEventRefusedByAnotherAccountIsCopiedAfterAsking() async throws {
        let (model, store) = try await Self.recordingWindow()
        let editor = try await Self.editor(model, key: Self.dentist)
        editor.setCalendar("work")
        await store.failNextWrites([.moveNeedsCopy(repeating: false)])
        await model.requestSave(undoManager: nil)
        #expect(editor.question == .moveCopy(title: "Dentist, Dr. Tamm", calendar: "Work", oldCalendar: "Home"))
        #expect(editor.question?.title == "Move Dentist, Dr. Tamm to Work?")
        #expect(editor.question?.message == "It will be copied there and removed from Home.")
        await model.answerMoveCopy(true, undoManager: nil)
        #expect(model.editor == nil && editor.question == nil)
        let moved = try #require(model.events.occurrences(on: day("2026-10-19")).first { $0.title == "Dentist, Dr. Tamm" })
        #expect(moved.calendarID == "work")
    }

    @Test func aRepeatingEventRefusedByAnotherAccountOffersDuplicate() async throws {
        let (model, store) = try await Self.recordingWindow()
        let editor = try await Self.editor(model, key: Self.bookClub)
        editor.setCalendar("work")
        await model.requestSave(undoManager: nil)
        await store.failNextWrites([.moveNeedsCopy(repeating: true)])
        await model.answerSpan(.futureEvents, undoManager: nil)
        #expect(editor.question == .moveRepeating(calendar: "Work"))
        #expect(editor.question?.title == "This Repeating Event Can’t Be Moved to Work")
        #expect(
            editor.question?.message
                == "Repeating events can’t be moved to a calendar in another account here. Duplicate it instead, or move it in the Calendar app.")
        model.answerMoveRepeating(duplicate: true)
        let duplicate = try #require(model.editor)
        #expect(duplicate !== editor && duplicate.mode == .duplicate && duplicate.confirmTitle == "Add")
        #expect(duplicate.draft.recurrence == nil && duplicate.draft.calendarID == "work", "an unsaved copy without the repeat")
    }

    @Test func aFailedSaveShowsItsReasonAndCode() async throws {
        let (model, store) = try await Self.recordingWindow()
        let editor = try await Self.editor(model, key: Self.dentist)
        editor.draft.title = "Dentist"
        await store.failNextWrites([.saveFailed(.readOnly)])
        await model.requestSave(undoManager: nil)
        #expect(model.editor === editor, "nothing closes")
        #expect(editor.saveFailure?.reason == "This calendar can’t be changed. Choose another calendar.")
        #expect(editor.saveFailure?.code == "EKErrorDomain 11", "the technical code for support")
        await store.failNextWrites([.saveFailed(.generic)])
        await model.requestSave(undoManager: nil)
        #expect(editor.saveFailure?.reason == "Please try again." && editor.saveFailure?.code == "EKErrorDomain 1")
        editor.draft.title = "Dentist, again"
        await model.requestSave(undoManager: nil)
        #expect(model.editor == nil, "the next try saves")
    }

    // MARK: Invitees, Duplicate, delete

    @Test func invitationsAndInvitees() async throws {
        let (model, _, _) = try await Self.window()
        let editor = try await Self.editor(model, key: Self.party)
        #expect(editor.inviteeCount == 3 && editor.inviteesFooter == "Changes are sent to 3 invitees.")
        editor.draft.title = "Party!"
        #expect(editor.isMac, "the Mac test host")
        await model.requestSave(undoManager: nil)
        #expect(editor.question == .invitees(count: 3) && editor.question?.title == "Send Changes to 3 Invitees?")
        await model.answerInvitees(send: true, undoManager: nil)
        #expect(model.editor == nil)

        await model.editEvent(key: "work/design-review|2026-10-21T14:00")
        #expect(model.editor == nil, "an invitation is read-only")
        await model.editAlerts(key: "work/design-review|2026-10-21T14:00")
        let alerts = try #require(model.editor)
        #expect(alerts.mode == .alertsOnly && alerts.title == "Edit Alerts" && alerts.liveIssues.isEmpty)
    }

    @Test func duplicateIsAnUnsavedCopyWithoutTheRepeat() async throws {
        let (model, store, _) = try await Self.window()
        await model.duplicateEvent(key: Self.bookClub)
        let editor = try #require(model.editor)
        #expect(editor.mode == .duplicate && editor.confirmTitle == "Add" && editor.draft.recurrence == nil)
        #expect(editor.draft.title == "Book club: Cotsworth" && editor.draft.start == local("2026-10-19T19:00"))
        model.requestCloseEditor()
        #expect(model.editor == nil, "Cancel leaves no copy")
        let events = try await store.occurrences(in: try #require(model.events.interval(year: 2026)), calendars: ["home"])
        #expect(events.filter { $0.title == "Book club: Cotsworth" && $0.start == local("2026-10-19T19:00") }.count == 1)
    }

    @Test func theDeleteQuestion() async throws {
        let (model, _, _) = try await Self.window()
        await model.requestDeleteFromEditor(key: Self.party)
        let party = try #require(model.deleteRequest)
        #expect(party.title == "Delete This Event?" && party.message == "3 invitees will get a cancellation.")
        await model.requestDeleteFromEditor(key: Self.bookClub)
        let club = try #require(model.deleteRequest)
        #expect(club.title == "This is a repeating event." && club.message == "Delete this event only, or this and all future events?")

        let editor = try await Self.editor(model, key: Self.dentist)
        await model.requestDeleteFromEditor(key: Self.dentist)
        let request = try #require(model.deleteRequest)
        #expect(request.title == "Delete This Event?" && request.message == nil, "a single event asks too")
        model.confirmDeleteClosingEditor(request, span: .thisEvent, undoManager: nil)
        #expect(model.editor == nil && editor.question == nil && model.events.undo.toast?.message == "Event deleted.")
    }

    // MARK: Presentation (§2.10, §2.11)

    @Test func presentationStyles() async throws {
        let (model, _, _) = try await Self.window()
        let state = model.eventPresentation
        #expect(state.detailsStyle(key: Self.dentist, section: .calendar, regular: false, accessibilitySize: false) == .sheet)
        state.registerPush(.calendar)
        #expect(state.detailsStyle(key: Self.dentist, section: .calendar, regular: false, accessibilitySize: false) == .push)
        #expect(state.detailsStyle(key: Self.dentist, section: .calendar, regular: true, accessibilitySize: false) == .sheet)
        let token = UUID()
        state.register(.event(Self.dentist), token: token)
        #expect(state.detailsStyle(key: Self.dentist, section: .calendar, regular: true, accessibilitySize: false) == .popover(.event(Self.dentist)))
        #expect(state.detailsStyle(key: Self.dentist, section: .calendar, regular: true, accessibilitySize: true) == .sheet)

        model.openEvent(key: Self.dentist)
        let editor = try await Self.editor(model, key: Self.dentist)
        #expect(model.presentedEvent?.key == Self.dentist, "details stay under the editor")
        #expect(
            state.editorStyle(editor, presentedKey: Self.dentist, section: .calendar, regular: true, accessibilitySize: false)
                == .popover(.event(Self.dentist)), "Edit in a details popover: the same popover")
        #expect(state.editorStyle(editor, presentedKey: Self.dentist, section: .calendar, regular: false, accessibilitySize: false) == .sheet)
        state.unregister(.event(Self.dentist), token: token)
        #expect(state.editorStyle(editor, presentedKey: Self.dentist, section: .calendar, regular: true, accessibilitySize: false) == .sheet)
    }
}
