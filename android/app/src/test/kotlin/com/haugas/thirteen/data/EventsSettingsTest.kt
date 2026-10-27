package com.haugas.thirteen.data

import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.emptyPreferences
import com.haugas.thirteen.core.events.CalendarAccountKind
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.ThirteenRepeats
import com.haugas.thirteen.data.calendar.CalendarPermissions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * Task D7's settings (docs/EVENTS.md §2.15, §2.18, §6.3): the default calendar and its silent
 * fallback, the collapsed account groups, and the Today card's launch counter.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EventsSettingsTest {
    @get:Rule
    val folder = TemporaryFolder()

    private fun calendar(id: String, account: String, writable: Boolean = true, primary: Boolean = false, title: String = id) = CalendarInfo(
        id = id,
        title = title,
        color = "#2563eb",
        accountId = account,
        accountTitle = account,
        accountKind = CalendarAccountKind.GOOGLE,
        writable = writable,
        thirteenRepeats = ThirteenRepeats.ALL,
        maxAlarms = null,
        supportsAvailability = true,
        supportsUrl = false,
        isPlatformDefault = primary,
    )

    @Test
    fun theDefaultCalendarIsTheChoiceElseThePrimaryElseTheFirstWritable() {
        val calendars = listOf(
            calendar("holidays", "a", writable = false),
            calendar("work", "a"),
            calendar("home", "b", primary = true),
        )
        assertEquals("home", DefaultCalendar.resolve(calendars, null)?.id)
        assertEquals("work", DefaultCalendar.resolve(calendars, CalendarVisibility.Ref.of(calendars[1]))?.id)
        // A read-only choice is not a default; a re-created calendar is found by account and name.
        assertEquals("home", DefaultCalendar.resolve(calendars, CalendarVisibility.Ref.of(calendars[0]))?.id)
        assertEquals("work", DefaultCalendar.resolve(calendars, CalendarVisibility.Ref("old-id", "a", "work"))?.id)
        // Gone: the platform default, silently.
        assertEquals("home", DefaultCalendar.resolve(calendars, CalendarVisibility.Ref("gone", "x", "Gone"))?.id)
        assertEquals("work", DefaultCalendar.resolve(calendars.filter { it.id != "home" }, null)?.id)
        assertNull(DefaultCalendar.resolve(listOf(calendars[0]), null))
    }

    @Test
    fun theDefaultCalendarAndCollapsedGroupsPersist() = runTest {
        val job = Job()
        val store = PreferenceDataStoreFactory.create(
            corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler) + job),
            produceFile = { File(folder.root, "${SettingsRepository.FILE_NAME}.preferences_pb") },
        )
        val repository = SettingsRepository(store)
        assertNull(repository.settings.first().defaultCalendar)
        assertEquals(emptySet<String>(), repository.settings.first().collapsedAccounts)
        val ref = CalendarVisibility.Ref("7", "com.google/liis.kask@example.com", "Work, team")
        repository.setDefaultCalendar(ref)
        repository.setCollapsedAccounts(setOf("other", "device"))
        assertEquals(ref, repository.settings.first().defaultCalendar)
        assertEquals(setOf("other", "device"), repository.settings.first().collapsedAccounts)
        repository.setDefaultCalendar(null)
        repository.setCollapsedAccounts(emptySet())
        assertNull(repository.settings.first().defaultCalendar)
        assertEquals(emptySet<String>(), repository.settings.first().collapsedAccounts)
        job.cancelAndJoin()
    }

    @Test
    fun theTodayCardCountsItsLaunches() = runTest {
        val job = Job()
        val store = PreferenceDataStoreFactory.create(
            corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler) + job),
            produceFile = { File(folder.root, "${CalendarPermissions.FILE_NAME}.preferences_pb") },
        )
        val permissions = CalendarPermissions(store)
        assertEquals(0, permissions.current().cardLaunches)
        repeat(3) { permissions.onAccessCardShown() }
        assertEquals(3, permissions.current().cardLaunches)
        job.cancelAndJoin()
    }
}
