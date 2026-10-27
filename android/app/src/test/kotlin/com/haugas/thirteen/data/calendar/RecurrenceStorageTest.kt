package com.haugas.thirteen.data.calendar

import android.provider.CalendarContract.Events
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.core.events.DateList
import com.haugas.thirteen.core.events.DateListForm
import com.haugas.thirteen.core.events.DateListValue
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.RRule
import com.haugas.thirteen.core.events.RecognitionSource
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.ThirteenRule
import com.haugas.thirteen.data.calendar.ProviderTestRows.ctx
import com.haugas.thirteen.data.calendar.ProviderTestRows.date
import com.haugas.thirteen.data.calendar.ProviderTestRows.env
import com.haugas.thirteen.data.calendar.ProviderTestRows.local
import com.haugas.thirteen.data.calendar.ProviderTestRows.ms
import com.haugas.thirteen.data.calendar.ProviderTestRows.timed
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** RecurrenceStorage (docs/EVENTS.md §4.3 d and e, §4.4, §4.9, §2.13 notes): plain JVM, no provider. */
class RecurrenceStorageTest {
    private val bookClub = ThirteenRule.Monthly(12)
    private val bookClubStart = local("2026-01-12T19:00")
    private val bookClubList = "FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18"

    @Test
    fun gateDecisionsAreSingleConstants() {
        // V10 and V3 are not run (owner, v3.3): the UTC list form, 210-value parts (phase 0), the detached fallback.
        assertEquals(DateListForm.UTC, ProviderGates.TIMED_DATE_LIST_FORM)
        assertEquals(210, ProviderGates.PART_SIZE)
        assertFalse(ProviderGates.RDATE_EXCEPTION_ROWS)
        assertTrue(ProviderGates.BYYEARDAY_ALERTS_ONLY)
        assertEquals(DateListForm.DATE, RecurrenceStorage.listForm(allDay = true))
        assertEquals(ProviderGates.TIMED_DATE_LIST_FORM, RecurrenceStorage.listForm(allDay = false))
    }

    @Test
    fun listsAreWrittenThroughDateList() {
        // Timed: the occurrence's instant through zonedToUtc in the event's zone (19:00 Tallinn in November is 17:00Z).
        val timed = RecurrenceStorage.formatDates(listOf(date("2026-11-16"), date("2026-12-14")), 19 * 60, false, ProviderTestRows.ZONE, ctx)
        assertEquals("20261116T170000Z,20261214T170000Z", timed)
        assertEquals(timed, DateList.format(DateList.parse(timed!!), DateListForm.UTC))
        // All-day: dates.
        assertEquals("20261019,20261116", RecurrenceStorage.formatDates(listOf(date("2026-10-19"), date("2026-11-16")), 0, true, null, ctx))
        // An empty list clears the column.
        assertNull(RecurrenceStorage.formatDates(emptyList(), 0, true, null, ctx))
        // A summer date of the same series: +3.
        assertEquals("20260615T160000Z", RecurrenceStorage.formatDates(listOf(date("2026-06-15")), 19 * 60, false, ProviderTestRows.ZONE, ctx))
    }

    @Test
    fun readerAcceptsEveryForm() {
        val time = StoredTime(false, local("2026-10-19T19:00"), local("2026-10-19T21:00"), ProviderTestRows.ZONE)
        val expected = OriginalDate(date("2026-11-16"))
        // The TZID; form, the UTC form, and a value on a line without TZID (read as UTC, as the provider does).
        assertEquals(expected, RecurrenceStorage.originalOf(DateList.parse("Europe/Tallinn;20261116T190000").single(), time, ctx))
        assertEquals(expected, RecurrenceStorage.originalOf(DateList.parse("20261116T170000Z").single(), time, ctx))
        assertEquals(expected, RecurrenceStorage.originalOf(DateList.parse("20261116T170000").single(), time, ctx))
        assertEquals(expected, RecurrenceStorage.originalOf(DateListValue.Date(date("2026-11-16")), time, ctx))
        // An own time (15:00 local) keeps its minute.
        assertEquals(OriginalDate(date("2026-11-16"), 15 * 60), RecurrenceStorage.originalOf(DateList.parse("20261116T130000Z").single(), time, ctx))
    }

    @Test
    fun gregorianRuleUntilIsTheEndOfTheDayInTheEventZone() {
        val recurrence = EventRecurrence(RepeatRule.Rrule(RRule.parse("FREQ=WEEKLY")), RepeatEnd.Until(date("2026-11-09")))
        val encoded = RecurrenceStorage.encode(recurrence, local("2026-10-19T19:00"), false, ProviderTestRows.ZONE, ctx, env)
        assertEquals(StoredForm.RRULE, encoded.form)
        val row = encoded.rows.single()
        assertEquals("FREQ=WEEKLY;UNTIL=20261109T215959Z", row.columns[Events.RRULE])
        assertNull(row.columns[Events.RDATE])
        assertNull(row.columns[Events.CUSTOM_APP_URI])
        // All-day: a date UNTIL.
        val allDay = RecurrenceStorage.encode(recurrence, local("2026-10-19T00:00"), true, null, ctx, env)
        assertEquals("FREQ=WEEKLY;UNTIL=20261109", allDay.rows.single().columns[Events.RRULE])
    }

    @Test
    fun thirteenMonthlyIsFormDWithHorizonAndMarker() {
        val recurrence = EventRecurrence(RepeatRule.Thirteen(bookClub))
        val encoded = RecurrenceStorage.encode(recurrence, bookClubStart, false, ProviderTestRows.ZONE, ctx, env, seriesId = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8")
        assertEquals(StoredForm.RDATE, encoded.form)
        val row = encoded.rows.single()
        assertNull(row.columns[Events.RRULE])
        // Today 2026: monthly repeats are written through December 31 of 2036: 11 years of 13 dates. The
        // start is the first value, because the provider does not count DTSTART of an RDATE-only row.
        val dates = DateList.parse(row.columns[Events.RDATE] as String)
        assertEquals(11 * 13, dates.size)
        assertEquals(DateListValue.Utc(local("2026-01-12T17:00")), dates.first())
        assertEquals(DateListValue.Utc(local("2026-02-09T17:00")), dates[1])
        assertEquals(DateListValue.Utc(local("2036-12-14T17:00")), dates.last())
        assertEquals(RecurrenceStorage.PACKAGE, row.columns[Events.CUSTOM_APP_PACKAGE])
        assertEquals(
            "thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never&series=0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8&part=1",
            row.columns[Events.CUSTOM_APP_URI],
        )
        assertEquals(1, row.part)
    }

    @Test
    fun weeklySeriesFrom2020IsWrittenInPartsAndGrowsDeterministically() {
        val rule = ThirteenRule.Weekly(Weekday.WEDNESDAY, 1)
        val recurrence = EventRecurrence(RepeatRule.Thirteen(rule))
        val start = local("2020-01-04T00:00")
        val in2026 = RecurrenceStorage.encode(recurrence, start, true, null, ctx, env, seriesId = SERIES)
        // §6.3: three parts of 210, 210 and 97 later dates with the 2029 horizon (positions 1 to 211, 212 to 422, ...);
        // each part's RDATE also holds its own start.
        assertEquals(listOf(211, 211, 98), in2026.rows.map { DateList.parse(it.columns[Events.RDATE] as String).size })
        assertTrue(in2026.rows.all { row -> DateList.parse(row.columns[Events.RDATE] as String).first() == DateListValue.Date(row.start) })
        assertEquals(listOf(date("2020-01-04"), date("2024-01-25"), date("2028-02-15")), in2026.rows.map { it.start })
        // In 2032 the horizon is 2035: the earlier parts are unchanged, part 3 is full and a fourth part appears.
        val in2032 = RecurrenceStorage.encode(recurrence, start, true, null, ctx, StorageEnv(date("2032-03-01"), 37), seriesId = SERIES)
        assertEquals(listOf(211, 211, 211, 199), in2032.rows.map { DateList.parse(it.columns[Events.RDATE] as String).size })
        assertEquals(in2026.rows[0].columns[Events.RDATE], in2032.rows[0].columns[Events.RDATE])
        assertEquals(in2026.rows[1].columns[Events.RDATE], in2032.rows[1].columns[Events.RDATE])
        assertEquals(listOf(1, 2, 3, 4), in2032.rows.map { it.part })
        assertTrue(in2032.rows.all { (it.columns[Events.CUSTOM_APP_URI] as String).contains("&series=$SERIES&part=${it.part}") })
    }

    @Test
    fun api30AndLowerCapListsAt2037() {
        val legacy = StorageEnv(date("2030-05-01"), sdkInt = 30)
        assertEquals(date("2037-12-31"), RecurrenceStorage.horizon(bookClub, RepeatEnd.Never, legacy))
        assertEquals(date("2037-12-31"), RecurrenceStorage.horizon(bookClub, RepeatEnd.Count(999), legacy))
        assertEquals(date("2040-12-31"), RecurrenceStorage.horizon(bookClub, RepeatEnd.Never, StorageEnv(date("2030-05-01"), sdkInt = 31)))
        assertEquals(date("2029-12-31"), RecurrenceStorage.horizon(ThirteenRule.Weekly(Weekday.THURSDAY, 1), RepeatEnd.Never, env))
        assertEquals(date("2031-12-31"), RecurrenceStorage.horizon(ThirteenRule.Weekly(Weekday.THURSDAY, 2), RepeatEnd.Never, env))
        assertEquals(GregorianDate.MAX, RecurrenceStorage.horizon(bookClub, RepeatEnd.Count(10), env))
        // Capped at 9999-12-31.
        assertEquals(GregorianDate.MAX, RecurrenceStorage.horizon(bookClub, RepeatEnd.Never, StorageEnv(date("9995-01-01"), 37)))
        val encoded = RecurrenceStorage.encode(EventRecurrence(RepeatRule.Thirteen(bookClub)), local("2030-01-12T19:00"), false, ProviderTestRows.ZONE, ctx, legacy)
        val last = DateList.parse(encoded.rows.last().columns[Events.RDATE] as String).last()
        assertEquals(date("2037-12-14"), (last as DateListValue.Utc).value.date)
    }

    @Test
    fun appleMadeByYearDaySeriesKeepsFormBForEveryNonPickerChange() {
        // A new end without a picker choice: the same BYYEARDAY rule with UNTIL, never RDATEs (§4.9 rule 3).
        val recurrence = EventRecurrence(RepeatRule.Thirteen(bookClub), RepeatEnd.Until(date("2027-06-30")))
        val encoded = RecurrenceStorage.encode(recurrence, bookClubStart, false, ProviderTestRows.ZONE, ctx, env, keepByYearDay = true)
        assertEquals(StoredForm.BYYEARDAY, encoded.form)
        val row = encoded.rows.single()
        assertEquals(
            "FREQ=YEARLY;UNTIL=20270630T205959Z;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18",
            row.columns[Events.RRULE],
        )
        assertNull(row.columns[Events.RDATE])
        assertEquals("thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=until:2027-06-30", row.columns[Events.CUSTOM_APP_URI])
    }

    @Test
    fun plainRulesStayRules() {
        // Form (c): Leap Day every 4 years until the cap, the end of June 17, 2096 in Tallinn (summer, +3).
        val leap = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Intercalary(IntercalaryDayId.LEAP_DAY)))
        val encoded = RecurrenceStorage.encode(leap, local("2024-06-17T18:00"), false, ProviderTestRows.ZONE, ctx, env)
        assertEquals("FREQ=YEARLY;INTERVAL=4;UNTIL=20960617T205959Z", encoded.rows.single().columns[Events.RRULE])
        assertEquals("thirteen://rule?v=1&system=ifc&kind=intercalary&day=LD&end=never", encoded.rows.single().columns[Events.CUSTOM_APP_URI])
        // Form (a): Year Day is December 31 in every year.
        val yearDay = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Intercalary(IntercalaryDayId.YEAR_DAY)))
        assertEquals("FREQ=YEARLY", RecurrenceStorage.encode(yearDay, local("2026-12-31T00:00"), true, null, ctx, env).rows.single().columns[Events.RRULE])
    }

    @Test
    fun untilRewritesChangeOnlyTheUntilPart() {
        assertEquals(
            "FREQ=WEEKLY;UNTIL=20261116T215959Z;BYDAY=MO;WKST=SU",
            RecurrenceStorage.replaceUntil("FREQ=WEEKLY;UNTIL=20261116T170000Z;BYDAY=MO;WKST=SU", "20261116T215959Z"),
        )
        assertEquals("RRULE:FREQ=DAILY;until=20261116", RecurrenceStorage.replaceUntil("RRULE:FREQ=DAILY;until=20260101", "20261116"))
        assertEquals("FREQ=DAILY;COUNT=3", RecurrenceStorage.replaceUntil("FREQ=DAILY;COUNT=3", "20261116"))
        // The new end takes the old one's place; the other parts keep their text and order (§4.9 rule 4).
        assertEquals("FREQ=WEEKLY;COUNT=3;BYDAY=MO;WKST=SU", RecurrenceStorage.withEnd("FREQ=WEEKLY;COUNT=10;BYDAY=MO;WKST=SU", RepeatEnd.Count(3), false, ProviderTestRows.ZONE, ctx))
        assertEquals(
            "FREQ=WEEKLY;UNTIL=20261108T215959Z;BYDAY=MO",
            RecurrenceStorage.withEnd("FREQ=WEEKLY;COUNT=10;BYDAY=MO", RepeatEnd.Until(date("2026-11-08")), false, ProviderTestRows.ZONE, ctx),
        )
        assertEquals("FREQ=WEEKLY;BYDAY=MO", RecurrenceStorage.withEnd("FREQ=WEEKLY;UNTIL=20261108T215959Z;BYDAY=MO", RepeatEnd.Never, false, ProviderTestRows.ZONE, ctx))
        assertEquals(
            "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261108T215959Z",
            RecurrenceStorage.withEnd("FREQ=WEEKLY;BYDAY=MO", RepeatEnd.Until(date("2026-11-08")), false, ProviderTestRows.ZONE, ctx),
        )
    }

    @Test
    fun aRemovedOccurrenceAddsOneValueInTheListsOwnForm() {
        val time = StoredTime(false, local("2026-10-19T19:00"), local("2026-10-19T21:00"), ProviderTestRows.ZONE)
        val nov23 = OriginalDate(date("2026-11-23"))
        assertEquals("20261116T170000Z,20261123T170000Z", RecurrenceStorage.appendValue("20261116T170000Z", nov23, time, ctx))
        assertEquals("Europe/Tallinn;20261116T190000,20261123T190000", RecurrenceStorage.appendValue("Europe/Tallinn;20261116T190000", nov23, time, ctx))
        assertEquals("20261123T170000Z", RecurrenceStorage.appendValue(null, nov23, time, ctx))
        // Already there: unchanged.
        assertEquals("20261123T170000Z", RecurrenceStorage.appendValue("20261123T170000Z", nov23, time, ctx))
        // An extra date with its own time is excluded at that time.
        assertEquals("20261123T130000Z", RecurrenceStorage.appendValue(null, OriginalDate(date("2026-11-23"), 15 * 60), time, ctx))
        // A mixed list is rewritten in Thirteen's form.
        assertEquals(
            "20261116T170000Z,20261130T170000Z,20261123T170000Z",
            RecurrenceStorage.appendValue("20261116T170000Z\nEurope/Tallinn;20261130T190000", nov23, time, ctx),
        )
        val allDay = StoredTime(true, local("2026-10-19T00:00"), local("2026-10-19T24:00"), null)
        assertEquals("20261116,20261123", RecurrenceStorage.appendValue("20261116", nov23, allDay, ctx))
    }

    @Test
    fun keptDuplicatePartIsChosenTheSameWayOnEveryDevice() {
        val a = timed(10, 0, 60).copy(syncId = "b-sync")
        val b = timed(11, 0, 60).copy(syncId = "a-sync")
        val c = timed(5, 0, 60)
        val d = timed(7, 0, 60)
        assertEquals(b, RecurrenceStorage.keptPart(listOf(a, b, c)))
        assertEquals(a, RecurrenceStorage.keptPart(listOf(a, c, d)))
        assertEquals(c, RecurrenceStorage.keptPart(listOf(d, c)))
        val uri = { part: Int -> ThirteenRule.Monthly(12).formatUri(RepeatEnd.Never, SERIES, part) }
        val groups = RecurrenceStorage.groupParts(
            listOf(timed(1, 0, 60, uri = uri(1)), timed(3, 0, 60, uri = uri(2)), timed(4, 0, 60, uri = uri(3)), timed(2, 0, 60, uri = uri(3))),
        )
        assertEquals(listOf(1L, 3L, 2L), groups.kept.map { it.id })
        assertEquals(listOf(4L), groups.duplicates.map { it.id })
    }

    @Test
    fun topUpRunsWhenTheLastDateIsLessThanHalfTheHorizonAway() {
        val weekly = ThirteenRule.Weekly(Weekday.WEDNESDAY, 1)
        // Written in 2026 through 2029-12-27; in 2026 that is more than 18 months away.
        assertFalse(RecurrenceStorage.needsTopUp(weekly, date("2029-12-27"), env))
        assertTrue(RecurrenceStorage.needsTopUp(weekly, date("2029-12-27"), StorageEnv(date("2028-10-01"), 37)))
        // At the horizon there is nothing to add.
        assertFalse(RecurrenceStorage.needsTopUp(weekly, date("2031-12-31"), StorageEnv(date("2028-10-01"), 37)))
        // Monthly: 10 years, top-up below 5 years away.
        assertFalse(RecurrenceStorage.needsTopUp(bookClub, date("2036-12-12"), env))
        assertTrue(RecurrenceStorage.needsTopUp(bookClub, date("2030-12-12"), env))
        // API 30: the list is complete at the 2037 cap.
        assertFalse(RecurrenceStorage.needsTopUp(bookClub, date("2037-12-14"), StorageEnv(date("2034-01-01"), 30)))
    }

    @Test
    fun storageNotesAndTheirConditions() {
        val monthly = EventRecurrence(RepeatRule.Thirteen(bookClub))
        assertEquals(StorageNote.Horizon(2036), RecurrenceStorage.storageNote(monthly, bookClubStart.date, StoredForm.NONE, false, env))
        assertEquals("repeat.note.androidHorizon", StorageNote.Horizon(2036).copyId)
        assertEquals(StorageNote.HorizonInvitees(2036), RecurrenceStorage.storageNote(monthly, bookClubStart.date, StoredForm.NONE, true, env))
        // An existing series: the last year already written.
        assertEquals(StorageNote.Horizon(2035), RecurrenceStorage.storageNote(monthly, bookClubStart.date, StoredForm.RDATE, false, env, existingHorizonYear = 2035))
        // With an end the list holds exactly the repeat's dates: no note.
        assertNull(RecurrenceStorage.storageNote(monthly.copy(end = RepeatEnd.Count(10)), bookClubStart.date, StoredForm.NONE, false, env))
        // API 30 once the list reaches 2037.
        assertEquals(StorageNote.HorizonCapped, RecurrenceStorage.storageNote(monthly, date("2030-01-12"), StoredForm.NONE, false, StorageEnv(date("2030-01-12"), 30)))
        // Plain rules and Gregorian rows have no Android note.
        val yearly = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Yearly(1, 12)))
        assertNull(RecurrenceStorage.storageNote(yearly, date("2026-01-12"), StoredForm.NONE, false, env))
        assertNull(RecurrenceStorage.storageNote(EventRecurrence(RepeatRule.Rrule(RRule.parse("FREQ=WEEKLY"))), date("2026-10-19"), StoredForm.NONE, false, env))
        // While V2's fallback holds, an Apple-made BYYEARDAY series is not edited, so no re-encode note is shown.
        assertNull(RecurrenceStorage.storageNote(monthly, bookClubStart.date, StoredForm.BYYEARDAY, false, env))
        // The footer sentence: always for the current row of an Apple-made BYYEARDAY series; the V3 sentence is left out.
        assertEquals("repeat.footer.appleGoogleAndroid", RecurrenceStorage.footerSentence(selectedIsCurrentByYearDayRow = true))
        assertNull(RecurrenceStorage.footerSentence(selectedIsCurrentByYearDayRow = false))
    }

    @Test
    fun formDRoundTripsThroughRecognition() {
        val recurrence = EventRecurrence(RepeatRule.Thirteen(bookClub), exceptDates = listOf(OriginalDate(date("2026-03-09"))))
        val encoded = RecurrenceStorage.encode(recurrence, bookClubStart, false, ProviderTestRows.ZONE, ctx, env, seriesId = SERIES)
        val columns = encoded.rows.single().columns
        assertEquals("20260309T170000Z", columns[Events.EXDATE])
        val row = timed(1, ms(2026, 1, 12, 19), 120, rdate = columns[Events.RDATE] as String, exdate = columns[Events.EXDATE] as String, uri = columns[Events.CUSTOM_APP_URI] as String)
        val time = EventMapping.time(row, ctx)!!
        val recognition = RecurrenceStorage.recognize(row, time, ctx, CalendarSystemId.IFC)!!
        assertEquals(RecognitionSource.MARKER, recognition.source)
        assertEquals(RepeatRule.Thirteen(bookClub), recognition.recurrence.rule)
        assertEquals(RepeatEnd.Never, recognition.recurrence.end)
        assertEquals(listOf(OriginalDate(date("2026-03-09"))), recognition.recurrence.exceptDates)
        assertTrue(recognition.openEnded)
        assertEquals(SERIES, recognition.series)
        assertEquals(1, recognition.part)
        assertEquals(StoredForm.RDATE, RecurrenceStorage.formOf(row))
    }

    @Test
    fun appleMadeByYearDayRuleIsRecognizedAndSelfExpanded() {
        val row = timed(1, ms(2026, 1, 12, 19), 120, rrule = bookClubList)
        assertEquals(StoredForm.BYYEARDAY, RecurrenceStorage.formOf(row))
        val recognition = RecurrenceStorage.recognize(row, EventMapping.time(row, ctx)!!, ctx, CalendarSystemId.IFC)!!
        assertEquals(RecognitionSource.BYYEARDAY, recognition.source)
        assertEquals(RepeatRule.Thirteen(bookClub), recognition.recurrence.rule)
        assertTrue(RecurrenceStorage.isByYearDayRule(bookClubList))
        assertFalse(RecurrenceStorage.isByYearDayRule("FREQ=WEEKLY"))
    }

    @Test
    fun unreadableColumnsAreKeptAsRead() {
        val row = timed(1, ms(2026, 1, 12, 19), 120, rrule = "FREQ=FORTNIGHTLY")
        val stored = RecurrenceStorage.parse(row)
        assertTrue(stored.unreadable)
        val recognition = RecurrenceStorage.recognize(row, EventMapping.time(row, ctx)!!, ctx, CalendarSystemId.IFC)!!
        assertFalse(recognition.editable)
    }

    @Test
    fun originalsMatchTheMastersInstantAcrossTheDstChange() {
        // A 19:00 series read in November (winter) and in June (summer).
        val time = StoredTime(false, local("2026-01-12T19:00"), local("2026-01-12T21:00"), ProviderTestRows.ZONE)
        assertEquals(OriginalDate(date("2026-06-15")), RecurrenceStorage.originalOfMillis(ms(2026, 6, 15, 19), time, ctx))
        assertEquals(OriginalDate(date("2026-06-15"), 18 * 60), RecurrenceStorage.originalOfMillis(ms(2026, 6, 15, 18), time, ctx))
        assertEquals(ms(2026, 11, 16, 19), RecurrenceStorage.instantOf(OriginalDate(date("2026-11-16")), time, ctx))
        val allDay = StoredTime(true, local("2026-01-01T00:00"), local("2026-01-01T24:00"), null)
        assertEquals(ProviderTestRows.utcMidnight(2026, 2, 26), RecurrenceStorage.instantOf(OriginalDate(date("2026-02-26")), allDay, ctx))
        assertEquals(LocalDateTime(date("2026-02-26"), 0).date, RecurrenceStorage.originalOfMillis(ProviderTestRows.utcMidnight(2026, 2, 26), allDay, ctx)!!.date)
    }

    @Test
    fun theStartIsWrittenIntoRdateOnlyListsAndDroppedOnRead() {
        // The provider counts DTSTART of an RDATE-only row only through its own value (ProviderRecurrenceTest).
        assertEquals(listOf(date("2026-01-12"), date("2026-02-09")), RecurrenceStorage.withStart(date("2026-01-12"), listOf(date("2026-02-09"))))
        assertEquals(listOf(date("2026-01-12"), date("2026-02-09")), RecurrenceStorage.withStart(date("2026-01-12"), listOf(date("2026-01-12"), date("2026-02-09"))))
        assertTrue(RecurrenceStorage.withStart(date("2026-01-12"), emptyList()).isEmpty())
        // Another app's date list with the start's own value: the value is not an extra date.
        val row = timed(1, ms(2026, 10, 19, 19), 60, rdate = "20261019T160000Z,20261105T170000Z")
        val time = EventMapping.time(row, ctx)!!
        assertEquals(listOf(OriginalDate(date("2026-11-05"))), RecurrenceStorage.datesOf(row, time, ctx))
        val recognition = RecurrenceStorage.recognize(row, time, ctx, CalendarSystemId.IFC)!!
        assertEquals(RepeatRule.Dates, recognition.recurrence.rule)
        assertEquals(listOf(date("2026-11-05")), recognition.recurrence.extraDates.map { it.date })
        // Written back (a Dates recurrence re-encoded), the start comes first again.
        val encoded = RecurrenceStorage.encode(recognition.recurrence, local("2026-10-19T19:00"), false, ProviderTestRows.ZONE, ctx, env)
        assertEquals("20261019T160000Z,20261105T170000Z", encoded.rows.single().columns[Events.RDATE])
    }

    private companion object {
        const val SERIES = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8"
    }
}
