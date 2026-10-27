package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The editor rules fixtures/events.json does not replay (docs/EVENTS.md §2.11, §2.13, §2.14):
 * moveDraftStart, setDraftAllDay, changedFields, describeAlarm, RepeatPreset.match and the alert
 * range edge. Expectations are the hand-written ones of packages/core/test/events/model.test.ts and
 * recurrence.test.ts.
 */
class EventsModelTest {
    private fun l(text: String) = LocalDateTime.parse(text)
    private fun g(text: String) = GregorianDate.parse(text)

    private val home = CalendarInfo(
        id = "home", title = "Home", color = "#ea580c", accountId = "icloud", accountTitle = "iCloud",
        accountKind = CalendarAccountKind.fromIdOrNull("icloud")!!, writable = true, thirteenRepeats = ThirteenRepeats.ALL,
        maxAlarms = null, supportsAvailability = true, supportsUrl = true, isPlatformDefault = true,
    )
    private val exchange = home.copy(
        id = "work", title = "Work", accountId = "exchange", accountTitle = "Exchange",
        accountKind = CalendarAccountKind.fromIdOrNull("exchange")!!, thirteenRepeats = ThirteenRepeats.GREGORIAN_ONLY,
        maxAlarms = 1, isPlatformDefault = false,
    )

    private fun thirteen(rule: ThirteenRule) = EventRecurrence(RepeatRule.Thirteen(rule))

    /** Book club: Cotsworth (§6.7), Monday 2026-10-19 = IFC Thursday October 12, 19:00 to 21:00. */
    private val bookClub = EventDraft(
        title = "Book club: Cotsworth", location = "Raamatukoi", allDay = false,
        start = l("2026-10-19T19:00"), end = l("2026-10-19T21:00"), timeZone = "Europe/Tallinn", calendarId = "home",
        recurrence = thirteen(ThirteenRule.Monthly(12)), alarms = listOf(Alarm.Relative(-60)), availability = Availability.BUSY,
    )
    private val single = bookClub.copy(recurrence = null)
    private val allDay = single.copy(
        title = "Autumn school break", allDay = true, start = l("2026-10-19T00:00"), end = l("2026-10-25T24:00"),
        timeZone = null, alarms = emptyList(), availability = Availability.FREE,
    )

    private fun timed(start: String, end: String) = single.copy(start = l(start), end = l(end))

    @Test
    fun moveDraftStartKeepsTheDurationAndAdaptsTheRepeat() {
        val moved = moveDraftStart(single, l("2026-10-21T14:30"))
        assertEquals(listOf("2026-10-21T14:30", "2026-10-21T16:30"), listOf(moved.draft.start.isoString, moved.draft.end.isoString))
        assertEquals(RepeatChange.NONE, moved.repeatChange)
        assertEquals(single, moved.draft.copy(start = single.start, end = single.end))
        assertEquals("2026-10-19T24:00", moveDraftStart(single, l("2026-10-19T22:00")).draft.end.isoString)
        assertEquals("2027-01-01T02:30", moveDraftStart(timed("2026-10-19T22:00", "2026-10-20T01:30"), l("2026-12-31T23:00")).draft.end.isoString)
        val allDayMoved = moveDraftStart(allDay, l("2026-12-28T00:00")).draft
        assertEquals(listOf("2026-12-28T00:00", "2027-01-03T24:00"), listOf(allDayMoved.start.isoString, allDayMoved.end.isoString))
        assertThrows(ThirteenException::class.java) { moveDraftStart(allDay, l("2026-12-28T09:00")) }
        assertEquals("9999-12-31T24:00", moveDraftStart(allDay, l("9999-12-29T00:00")).draft.end.isoString)
        val last = moveDraftStart(single, l("9999-12-31T23:00")).draft
        assertEquals("9999-12-31T24:00", last.end.isoString)
        assertEquals(listOf(DraftIssue.OUT_OF_RANGE), validateDraft(last, home))
        assertEquals(RepeatChange.NONE, moveDraftStart(bookClub, l("2026-11-16T19:00")).repeatChange)
        val adapted = moveDraftStart(bookClub, l("2026-10-20T19:00"))
        assertEquals(RepeatChange.ADAPTED, adapted.repeatChange)
        assertEquals(RepeatRule.Thirteen(ThirteenRule.Monthly(13)), adapted.draft.recurrence?.rule)
        assertEquals(emptyList<DraftIssue>(), validateDraft(adapted.draft, home))
        val dropped = moveDraftStart(bookClub, l("2026-12-31T19:00"))
        assertEquals(RepeatChange.DROPPED, dropped.repeatChange)
        assertNull(dropped.draft.recurrence)
        assertThrows(ThirteenException::class.java) { moveDraftStart(single, l("2026-10-19T24:00")) }
    }

    @Test
    fun dragFromIfcMarch3ToMarch4NeedsARepeatExchangeCannotKeep() {
        val march3 = timed("2026-02-28T19:00", "2026-02-28T21:00").copy(recurrence = thirteen(ThirteenRule.Yearly(3, 3)))
        assertEquals(emptyList<DraftIssue>(), validateDraft(march3, exchange))
        val moved = moveDraftStart(march3, l("2026-03-01T19:00"))
        assertEquals(RepeatChange.ADAPTED, moved.repeatChange)
        assertEquals(RepeatRule.Thirteen(ThirteenRule.Yearly(3, 4)), moved.draft.recurrence?.rule)
        assertEquals(listOf(DraftIssue.THIRTEEN_REPEAT_NOT_ALLOWED), validateDraft(moved.draft, exchange))
    }

    @Test
    fun setDraftAllDayKeepsDatesAndRestoresTimes() {
        val on = setDraftAllDay(timed("2026-10-19T22:00", "2026-10-20T01:30"), true)
        assertEquals(listOf("2026-10-19T00:00", "2026-10-20T24:00"), listOf(on.start.isoString, on.end.isoString))
        assertEquals(listOf(null, Availability.FREE, true), listOf(on.timeZone, on.availability, on.allDay))
        assertEquals("2026-10-19T24:00", setDraftAllDay(timed("2026-10-19T23:00", "2026-10-19T24:00"), true).end.isoString)
        assertEquals("2026-10-19T24:00", setDraftAllDay(timed("2026-10-19T00:00", "2026-10-19T00:00"), true).end.isoString)
        assertEquals("2026-10-21T24:00", setDraftAllDay(timed("2026-10-19T10:00", "2026-10-22T00:00"), true).end.isoString)
        assertEquals(emptyList<DraftIssue>(), validateDraft(on, home))
        assertEquals(Availability.BUSY, setDraftAllDay(single, true, availabilityTouched = true).availability)
        assertEquals(Availability.FREE, setDraftAllDay(allDay, false, availabilityTouched = true).availability)

        val off = setDraftAllDay(allDay, false)
        assertEquals(listOf("2026-10-19T09:00", "2026-10-25T10:00"), listOf(off.start.isoString, off.end.isoString))
        assertEquals(listOf(null, Availability.BUSY), listOf(off.timeZone, off.availability))
        val oneDay = allDay.copy(end = l("2026-10-19T24:00"))
        val restored = setDraftAllDay(oneDay, false, previousTimes = PreviousTimes(19 * 60, 21 * 60))
        assertEquals(listOf("2026-10-19T19:00", "2026-10-19T21:00"), listOf(restored.start.isoString, restored.end.isoString))
        val overnight = setDraftAllDay(oneDay, false, previousTimes = PreviousTimes(22 * 60, 90))
        assertEquals(listOf("2026-10-19T22:00", "2026-10-20T01:30"), listOf(overnight.start.isoString, overnight.end.isoString))
        val midnight = setDraftAllDay(oneDay, false, previousTimes = PreviousTimes(23 * 60, 1440))
        assertEquals(listOf("2026-10-19T23:00", "2026-10-19T24:00"), listOf(midnight.start.isoString, midnight.end.isoString))
        val created = newEventDraft(g("2026-10-19"), l("2026-10-19T10:20"), "home", allDay = true, timeZone = "Europe/Tallinn")
        assertNull(created.timeZone)
        assertEquals("Europe/Tallinn", setDraftAllDay(created, false, timeZone = "Europe/Tallinn").timeZone)
        assertNull(setDraftAllDay(timed("2026-10-19T10:00", "2026-10-19T11:00"), true, timeZone = "Europe/Tallinn").timeZone)

        val original = timed("2026-10-19T22:00", "2026-10-20T01:30")
        val back = setDraftAllDay(setDraftAllDay(original, true), false, previousTimes = PreviousTimes(22 * 60, 90), timeZone = original.timeZone)
        assertEquals(original, back)
        assertEquals(emptyList<DraftField>(), changedFields(original, back))
        assertEquals(bookClub.recurrence, setDraftAllDay(bookClub, true).recurrence)
        assertEquals(bookClub, setDraftAllDay(bookClub, false))
        assertThrows(ThirteenException::class.java) { PreviousTimes(1440, 1440) }
        assertThrows(ThirteenException::class.java) { PreviousTimes(0, 1441) }
        assertThrows(ThirteenException::class.java) { setDraftAllDay(allDay, false, timeZone = "") }
    }

    @Test
    fun changedFieldsListsGroupsInOrderAndComparesMoments() {
        assertEquals(emptyList<DraftField>(), changedFields(bookClub, bookClub))
        assertEquals(
            listOf(DraftField.TITLE, DraftField.TIME, DraftField.AVAILABILITY),
            changedFields(bookClub, bookClub.copy(availability = Availability.FREE, title = "X", end = l("2026-10-19T22:00"))),
        )
        val midnight = timed("2026-10-19T23:00", "2026-10-19T24:00")
        assertEquals(emptyList<DraftField>(), changedFields(midnight, midnight.copy(end = l("2026-10-20T00:00"))))
        assertEquals(listOf(DraftField.TIME), changedFields(bookClub, bookClub.copy(timeZone = "UTC")))
        assertEquals(listOf(DraftField.CALENDAR), changedFields(bookClub, bookClub.copy(calendarId = "work")))
        assertEquals(listOf(DraftField.RECURRENCE), changedFields(bookClub, bookClub.copy(recurrence = null)))
        val two = listOf(Alarm.Relative(-60), Alarm.Relative(-15))
        assertEquals(listOf(DraftField.ALARMS), changedFields(bookClub.copy(alarms = two), bookClub.copy(alarms = two.reversed())))
        val edited = bookClub.copy(title = "Book club (moved)", start = l("2026-10-19T20:00"), end = l("2026-10-19T22:00"))
        val current = bookClub.copy(notes = "Bring the pamphlet.", title = "Book club: Cotsworth and Comte")
        val merge = mergeDraft(bookClub, edited, current)
        assertEquals(listOf(DraftField.TITLE, DraftField.TIME), merge.written)
        assertEquals(listOf(DraftField.TITLE), merge.conflicts)
        assertEquals(edited.copy(notes = "Bring the pamphlet."), merge.merged)
    }

    @Test
    fun alarmPresetsAndDescriptions() {
        assertEquals(
            listOf("none", "at-time", "before-5m", "before-10m", "before-15m", "before-30m", "before-1h", "before-2h", "before-1d", "before-2d", "before-1w"),
            alarmPresets(false).map { it.id },
        )
        assertEquals(
            listOf("None", "1 day before at 9:00 AM", "2 days before at 9:00 AM", "1 week before at 9:00 AM"),
            alarmPresets(true, allowAfterStart = false, use24Hour = false).map { it.label },
        )
        val rel = { minutes: Int -> Alarm.Relative(minutes) }
        assertEquals("45 minutes before", describeAlarm(rel(-45), false))
        assertEquals("1 minute before", describeAlarm(rel(-1), false))
        assertEquals("90 minutes before", describeAlarm(rel(-90), false))
        assertEquals("3 hours before", describeAlarm(rel(-180), false))
        assertEquals("14 days before", describeAlarm(rel(-20160), false))
        assertEquals("10 minutes after", describeAlarm(rel(10), false))
        assertEquals("1 minute after", describeAlarm(rel(1), false))
        assertEquals("1 day before at 23:45", describeAlarm(rel(-15), true))
        assertEquals("3 days before at 18:30", describeAlarm(rel(-1440 * 3 + 1110), true))
        assertEquals("On the day at 00:00", describeAlarm(rel(0), true))
        assertEquals("On the day at 12:00 AM", describeAlarm(rel(0), true, CalendarSystemId.IFC, use24Hour = false))
        assertEquals("On the day at 12:00 PM", describeAlarm(rel(720), true, CalendarSystemId.IFC, use24Hour = false))
        assertEquals("1500 minutes after", describeAlarm(rel(1500), true))
        val at = { text: String -> Alarm.Absolute(l(text)) }
        assertEquals("At 08:00 on Thursday, October 12, 2026", describeAlarm(at("2026-10-19T08:00"), false))
        assertEquals("At 08:00 on Friday, Descartes 12, 238", describeAlarm(at("2026-10-19T08:00"), true, CalendarSystemId.POSITIVIST))
        assertEquals("At 8:15 PM on Year Day 2026", describeAlarm(at("2026-12-31T20:15"), false, CalendarSystemId.IFC, use24Hour = false))
        val labels = (alarmPresets(true) + alarmPresets(false) + alarmPresets(true, false, false)).map { it.label }
        assertEquals(emptyList<String>(), labels.filter { it.contains('–') || it.contains('—') })
    }

    @Test
    fun repeatPresetsMatchMinimalAndExplicitForms() {
        val start = g("2026-10-19")
        fun rr(text: String, end: RepeatEnd = RepeatEnd.Never, extra: List<ExtraDate> = emptyList()) =
            EventRecurrence(RepeatRule.Rrule(RRule.parse(text)), end, extra)
        assertEquals(
            listOf("never", "daily", "weekly", "biweekly", "monthly", "yearly", "thirteen-monthly", "thirteen-weekly", "thirteen-biweekly", "thirteen-yearly"),
            RepeatPreset.all(start).map { it.id },
        )
        assertEquals(
            listOf("never", "daily", "weekly", "biweekly", "monthly", "yearly", "thirteen-intercalary"),
            RepeatPreset.all(g("2026-12-31")).map { it.id },
        )
        assertEquals("never", RepeatPreset.match(null, start))
        assertEquals("weekly", RepeatPreset.match(rr("FREQ=WEEKLY"), start))
        assertEquals("weekly", RepeatPreset.match(rr("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;WKST=SU"), start))
        assertEquals("biweekly", RepeatPreset.match(rr("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"), start))
        assertEquals("monthly", RepeatPreset.match(rr("FREQ=MONTHLY;BYMONTHDAY=19"), start))
        assertEquals("yearly", RepeatPreset.match(rr("FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=19"), start))
        assertNull(RepeatPreset.match(rr("FREQ=WEEKLY;BYDAY=TU"), start))
        assertEquals("weekly", RepeatPreset.match(rr("FREQ=WEEKLY", RepeatEnd.Count(3)), start))
        assertEquals("thirteen-monthly", RepeatPreset.match(thirteen(ThirteenRule.Monthly(12)), start))
        assertNull(RepeatPreset.match(thirteen(ThirteenRule.Monthly(12)), start, CalendarSystemId.POSITIVIST))
        assertNull(RepeatPreset.match(rr("FREQ=WEEKLY", extra = listOf(ExtraDate(g("2026-10-21")))), start))
    }

    @Test
    fun alarmFireTimeStaysInsideYears1To9999() {
        val zones = JavaTimeZoneResolver()
        // A relative alert on a timed occurrence counts from its UTC start, exactly.
        assertEquals(
            "2026-10-19T15:00",
            alarmFireTime(Alarm.Relative(-60), false, l("2026-10-19T19:00"), l("2026-10-19T16:00"), "Europe/Tallinn", zones)?.isoString,
        )
        // An all-day alert is a device wall clock: 09:00 the day before in Tallinn.
        assertEquals("2026-10-18T06:00", alarmFireTime(Alarm.Relative(-900), true, l("2026-10-19T00:00"), null, "Europe/Tallinn", zones)?.isoString)
        assertNull(alarmFireTime(Alarm.Relative(-60), false, l("0001-01-01T00:30"), l("0001-01-01T00:30"), "UTC", zones))
        assertThrows(ThirteenException::class.java) { alarmFireTime(Alarm.Relative(-60), false, l("2026-10-19T19:00"), null, "UTC", zones) }
        assertThrows(ThirteenException::class.java) { alarmFireTime(Alarm.Relative(0), false, l("2026-10-19T19:00"), l("2026-10-19T19:00"), "Mars/Olympus", zones) }
    }
}
