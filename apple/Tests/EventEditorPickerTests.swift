import Foundation
import Testing
import ThirteenKit

private func day(_ iso: String) -> GregorianDate { EventsTest.day(iso) }
private func local(_ iso: String) -> LocalDateTime { EventsTest.local(iso) }

/// The editor's pickers (docs/EVENTS.md §2.12 to §2.15, task A7): the 13-month date picker (slots
/// and their names, the grid, the 1583 floor, leap-only days falling back, leap-year stepping for a
/// leap-day repeat, keyboard moves, typed dates), the repeat picker (core's labels, the checked
/// row, "Next:", Exchange disabling and its note, the platform sentence, Custom), the calendar
/// picker's same-account rule, and the no-dashes rule for every editor string (§2.19).
@MainActor
struct EventEditorPickerTests {

    static func picker(_ iso: String, system: CalendarSystemID = .ifc, leapRepeat: Bool = false) -> ThirteenDatePickerModel {
        ThirteenDatePickerModel(system: system, selected: day(iso), range: ThirteenDatePickerModel.editorRange, leapRepeat: leapRepeat)
    }

    // MARK: Date picker (§2.12)

    @Test func slotsInPickerOrderWithTheirNames() {
        let slots = Self.picker("2028-03-01").slots
        #expect(slots.map(\.label) == ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "LD", "Sol", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "YD"])
        #expect(slots[6].accessibilityName == "Leap Day, leap years only")
        #expect(slots[7].accessibilityName == "Sol, month 7 of 13")
        #expect(slots[11].accessibilityName == "October, month 11 of 13")
        #expect(slots[14].accessibilityName == "Year Day, belongs to no month")
        #expect(!Self.picker("2027-03-01").slots.contains { $0.label == "LD" }, "LD only in leap years")

        let positivist = Self.picker("2028-03-01", system: .positivist).slots.suffix(2).map(\.accessibilityName)
        #expect(positivist == ["Festival of All the Dead, belongs to no month", "Festival of Holy Women, belongs to no month, leap years only"])
        #expect(Self.picker("2026-10-19", system: .positivist).yearAccessibilityValue == "238, Gregorian 2026")
        #expect(Self.picker("2026-10-19").yearAccessibilityValue == "2026")
    }

    @Test func theGridSpeaksBothCalendars() {
        let picker = Self.picker("2026-10-19")
        let cells = picker.cells
        #expect(cells.count == 28)
        #expect(cells[11].accessibilityName == "Thursday, October 12. Gregorian Monday, October 19")
        #expect(cells[11].gregorianText == "19" && cells[24].gregorianText == "Nov 1")
        #expect(picker.weekdayHeader.map { "\($0.thirteen)\($0.gregorian)" } == ["ST", "MF", "TS", "WS", "TM", "FT", "SW"])
        #expect(picker.weekdayHeader[0].accessibilityName == "Sunday. Gregorian Thursday")
        #expect(picker.intercalary == nil)
        #expect(Self.picker("2026-12-31").intercalary?.name == "Year Day" && Self.picker("2026-12-31").cells.isEmpty)
    }

    @Test func aLeapDayFallsBackInACommonYear() throws {
        let step = try #require(Self.picker("2028-06-17").steppingYear(by: 1))
        #expect(step.date == day("2029-06-17") && step.caption == "2029 has no Leap Day, so the date moved to June 28.")
        let positivist = try #require(Self.picker("2028-12-31", system: .positivist).steppingYear(by: 1))
        #expect(positivist.date == day("2029-12-31"))
        #expect(positivist.caption == "241 has no Festival of Holy Women, so the date moved to the Festival of All the Dead.")
        let plain = try #require(Self.picker("2026-10-19").steppingYear(by: 1))
        #expect(plain.date == day("2027-10-19") && plain.caption == nil)
    }

    @Test func aLeapDayRepeatStepsBetweenLeapYears() throws {
        let next = try #require(Self.picker("2028-06-17", leapRepeat: true).steppingYear(by: 1))
        #expect(next.date == day("2032-06-17"))
        #expect(next.caption == "Every Leap Day happens only in leap years, so the year moved to 2032.")
        let previous = try #require(Self.picker("2028-06-17", leapRepeat: true).steppingYear(by: -1))
        #expect(previous.date == day("2024-06-17"))
        let skips2100 = try #require(Self.picker("2096-06-17", leapRepeat: true).steppingYear(by: 1))
        #expect(skips2100.date == day("2104-06-17"), "2100 is not a leap year")
    }

    @Test func theEditorRangeIs1583To9999() {
        #expect(!Self.picker("1583-03-01").canStepYear(by: -1) && Self.picker("1583-03-01").canStepYear(by: 1))
        #expect(!Self.picker("9999-03-01").canStepYear(by: 1))
        #expect(Self.picker("2026-10-19").parse("1500-01-01") == nil)
        #expect(Self.picker("1583-01-01").moving(.left) == nil)
    }

    @Test func keyboardMoves() {
        // Right from IFC June 28 in a leap year selects Leap Day, Right again Sol 1; Left back.
        #expect(Self.picker("2028-06-16").moving(.right) == day("2028-06-17"))
        #expect(Self.picker("2028-06-17").moving(.right) == day("2028-06-18"))
        #expect(Self.picker("2028-06-18").moving(.left) == day("2028-06-17"))
        // Up and Down: same column, across months, skipping intercalary days.
        #expect(Self.picker("2026-10-19").moving(.up) == day("2026-10-12"))
        #expect(Self.picker("2026-12-24").moving(.down) == day("2027-01-01"), "IFC December 22 down to January 1, past Year Day")
        #expect(Self.picker("2026-12-31").moving(.up) == day("2026-12-30"), "from Year Day, Up is the day before")
        #expect(Self.picker("2026-10-19").moving(.pageDown) == day("2026-11-16"))
        #expect(Self.picker("2026-10-19").moving(.home) == day("2026-10-08"))
        #expect(Self.picker("2026-10-19").moving(.end) == day("2026-11-04"))
        #expect(Self.picker("2026-10-19").moving(.yearDown) == day("2027-10-19"))
    }

    /// Days the event's zone skips are disabled, refused when typed and passed over by the keys
    /// (§2.12, SPEC §1.5): Pacific/Apia skipped Gregorian 2011-12-30 (IFC Saturday, December 28).
    @Test func daysTheZoneSkipsAreDisabled() throws {
        let skips = ThirteenDatePickerModel.skippedDays(zone: "Pacific/Apia")
        #expect(skips(day("2011-12-30")) && !skips(day("2011-12-29")) && !skips(day("2011-12-31")))
        #expect(!ThirteenDatePickerModel.skippedDays(zone: "Europe/Tallinn")(day("2011-12-30")))
        #expect(!ThirteenDatePickerModel.skippedDays(zone: nil)(day("2011-12-30")), "all-day and floating events skip nothing")

        let picker = ThirteenDatePickerModel(
            system: .ifc, selected: day("2011-12-29"), range: ThirteenDatePickerModel.editorRange, skips: skips)
        let cell = try #require(picker.cells.first { $0.date == day("2011-12-30") })
        #expect(cell.accessibilityName == "Saturday, December 28. Gregorian Friday, December 30" && !cell.enabled)
        #expect(picker.cells.filter { !$0.enabled }.count == 1)
        #expect(picker.moving(.right) == day("2011-12-31"), "Right passes over the skipped day (to Year Day)")
        #expect(picker.parse("2011-12-30") == nil && picker.parse("2011-M13-28") == nil && picker.parse("2011-M13-27") == day("2011-12-29"))
        #expect(!picker.listRows.contains { $0.date == day("2011-12-30") }, "the accessibility-size list leaves it out")
    }

    @Test func typedDates() {
        let picker = Self.picker("2026-01-01")
        #expect(picker.parse("2026-M11-12") == day("2026-10-19"))
        #expect(picker.parse("2026-YD") == day("2026-12-31"))
        #expect(picker.parse("2026-10-19") == day("2026-10-19"))
        #expect(picker.parse("tomorrow") == nil)
    }

    @Test func dateButtonsAndCaptions() {
        #expect(EditorCopy.dateButton(day("2026-10-19"), system: .ifc) == "IFC Thu, Oct 12, 2026")
        #expect(EditorCopy.dateButton(day("2026-12-31"), system: .ifc) == "Year Day 2026")
        #expect(
            EditorCopy.dateButtonLabel(field: "Starts", date: day("2026-10-19"), system: .ifc)
                == "Starts, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026")
        #expect(EditorCopy.gregorianCaption(day("2026-10-19")) == "Gregorian Monday, October 19, 2026")
        #expect(EditorCopy.thirteenCaption(day("2026-10-19"), system: .ifc) == "IFC Thursday, October 12, 2026")
    }

    // MARK: Repeat picker (§2.13)

    static func calendar(_ kind: CalendarAccountKind, repeats: ThirteenRepeatSupport = .all, title: String = "Work") -> CalendarSnapshot {
        CalendarSnapshot(
            info: CalendarInfo(
                id: "\(kind.rawValue)-\(title)", title: title, color: "#2563eb", accountID: kind.rawValue, accountTitle: kind.rawValue,
                accountKind: kind, writable: true, thirteenRepeats: repeats, maxAlarms: nil, supportsAvailability: true, supportsURL: true,
                isPlatformDefault: false),
            settings: CalendarSourcePolicy.settings(for: kind))
    }

    static func repeatPicker(_ current: EventRecurrence?, calendar: CalendarSnapshot, writable: [CalendarSnapshot] = []) -> RepeatPickerModel {
        RepeatPickerModel(
            start: day("2026-10-19"), system: .ifc, current: current, calendar: calendar, writableCalendars: writable, keepDescription: nil)
    }

    @Test func presetLabelsComeFromCore() {
        let picker = Self.repeatPicker(nil, calendar: Self.calendar(.icloud))
        #expect(picker.gregorianPresets.map(\.label) == [
            "Every day", "Every week on Monday", "Every 2 weeks on Monday", "Every month on the 19th", "Every year on October 19",
        ])
        #expect(picker.thirteenPresets.map(\.label) == [
            "Every IFC month on the 12th", "Every IFC week on Thursday", "Every 2 IFC weeks on Thursday", "Every year on IFC October 12",
        ])
        #expect(picker.thirteenTitle == "International Fixed Calendar" && picker.checkedID == "never")
        #expect(picker.thirteenFooter == "Every 13-month month has 28 days, so monthly repeats never skip a month.")
    }

    @Test func theCheckedRowShowsNextAndNotes() throws {
        let monthly = try #require(EventEditorStateTests.preset("thirteen-monthly", start: day("2026-10-19")))
        let picker = Self.repeatPicker(monthly, calendar: Self.calendar(.google))
        #expect(picker.checkedID == "thirteen-monthly")
        #expect(picker.nextLine == "Next: Gregorian Mon, Nov 16; Mon, Dec 14; Tue, Jan 12, 2027")
        #expect(picker.thirteenFooter.hasSuffix("Calendar apps on Android may show other days."), "a Google calendar's sentence")
        let weekly = try #require(EventEditorStateTests.preset("thirteen-weekly", start: day("2026-10-19")))
        #expect(Self.repeatPicker(weekly, calendar: Self.calendar(.icloud)).notes.first?.contains("In 2027 it falls on") == true)
        let custom = EventRecurrence(rule: .rrule(RRule(freq: .weekly, byDay: [WeekdayNum(weekday: .monday), WeekdayNum(weekday: .friday)])))
        #expect(Self.repeatPicker(custom, calendar: Self.calendar(.icloud)).checkedID == RepeatPickerModel.customID)
    }

    @Test func aGregorianOnlyCalendarDisablesTheRowsItCannotKeep() {
        let exchange = Self.calendar(.exchange, repeats: .gregorianOnly)
        let picker = Self.repeatPicker(nil, calendar: exchange, writable: [Self.calendar(.icloud), Self.calendar(.google), exchange])
        #expect(picker.thirteenPresets.map(picker.isEnabled) == [false, false, false, true], "yearly on IFC October 12 is a plain rule")
        #expect(picker.thirteenFooter == "Work (Exchange) can’t keep 13-month repeats. Choose a calendar from iCloud or Google to use them.")
        let alone = Self.repeatPicker(nil, calendar: exchange, writable: [exchange])
        #expect(alone.thirteenFooter == "Work (Exchange) can’t keep 13-month repeats.")
        #expect(picker.exchangeSafeYearly.map { picker.description($0) } == "Every year on IFC October 12")
    }

    @Test func customRepeats() throws {
        let start = day("2026-10-19")
        var custom = CustomRecurrence(start: start)
        #expect(custom.frequency == .weekly && custom.weekdays == [.monday])
        custom.toggle(.wednesday)
        #expect(try custom.recurrence(end: .never).description(start: start) == "Every week on Monday and Wednesday")
        custom.frequency = .monthly
        custom.monthlyOnThe = true
        custom.ordinal = 2
        custom.dayKind = .weekday(.tuesday)
        #expect(try custom.recurrence(end: .count(5)).description(start: start) == "Every month on the second Tuesday, 5 times")
        custom.dayKind = .weekday5
        custom.ordinal = -1
        #expect(try custom.recurrence(end: .never).description(start: start) == "Every month on the last weekday")
        custom.frequency = .yearly
        custom.yearlyOnThe = false
        custom.toggle(month: 3)
        #expect(try custom.recurrence(end: .never).description(start: start) == "Every year in March and October on the 19th")
        let read = try #require(CustomRecurrence(rrule: custom.rrule, start: start))
        #expect(read.rrule == custom.rrule, "the editor reads back what it writes")
        #expect(CustomRecurrence(rrule: RRule(freq: .yearly, byDay: [WeekdayNum(weekday: .monday)], byWeekNo: [20]), start: start) == nil)
    }

    // MARK: Calendar picker (§2.15)

    @Test func eventsWithInviteesStayInTheirAccount() async throws {
        let (model, _, _) = try await EventEditorStateTests.window()
        await model.editEvent(key: EventEditorStateTests.party)
        let editor = try #require(model.editor)
        let groups = CalendarPickerGroups(editor: editor, accountGroups: model.events.accountGroups)
        #expect(groups.sameAccountRule)
        #expect(groups.groups.first { $0.id == "icloud" }?.enabled == true)
        #expect(groups.groups.first { $0.id == "google" }?.enabled == false)
        #expect(!groups.groups.contains { $0.id == "subscriptions" }, "writable calendars only")
        #expect(EditorCopy.calendarSameAccount == "Events with invitees stay in their own account.")
    }

    // MARK: Copy (§2.19)

    @Test func noEditorStringHasADash() throws {
        var texts = EditorCopy.samples
        for iso in ["2026-10-19", "2026-12-31", "2028-06-17", "2027-01-31", "2028-02-29"] {
            let start = day(iso)
            for system in CalendarSystemID.allCases {
                for preset in RepeatPreset.all(start: start, system: system) {
                    texts.append(preset.label)
                    if let recurrence = preset.recurrence {
                        texts.append(try recurrence.nextOccurrencesText(start: start, system: system))
                        texts += try recurrence.repeatNotes(start: start, system: system)
                        texts += try recurrence.repeatNotes(start: start, system: system, gregorianOnlyCalendar: true)
                    }
                }
                texts.append(EditorCopy.dateButton(start, system: system))
                texts.append(EditorCopy.dateButtonLabel(field: "Starts", date: start, system: system))
                let picker = ThirteenDatePickerModel(system: system, selected: start, range: ThirteenDatePickerModel.editorRange)
                texts += picker.slots.map(\.accessibilityName) + picker.cells.map(\.accessibilityName)
                texts += [picker.steppingYear(by: 1)?.caption, picker.steppingYear(by: -1)?.caption].compactMap { $0 }
            }
        }
        for allDay in [false, true] {
            texts += AlarmPreset.all(allDay: allDay, use24Hour: false).map(\.label)
        }
        let dashes = texts.filter { $0.contains("\u{2013}") || $0.contains("\u{2014}") }
        #expect(dashes.isEmpty, "\(dashes)")
    }
}
