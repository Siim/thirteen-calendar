package com.haugas.thirteen.data.calendar

import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.emptyPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** The access state machine of docs/EVENTS.md §2.16 (Android) with its DataStore flags (§6.3). */
@OptIn(ExperimentalCoroutinesApi::class)
class CalendarPermissionsTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val file: File by lazy { File(folder.root, "${CalendarPermissions.FILE_NAME}.preferences_pb") }

    private suspend fun withPermissions(dispatcher: TestDispatcher, block: suspend (CalendarPermissions) -> Unit) {
        val job = Job()
        val dataStore = PreferenceDataStoreFactory.create(
            corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
            scope = CoroutineScope(dispatcher + job),
            produceFile = { file },
        )
        try {
            block(CalendarPermissions(dataStore))
        } finally {
            job.cancelAndJoin()
        }
    }

    private val none = ProviderPermission.NONE
    private val day = 24L * 60 * 60 * 1000
    private val now = 1_792_000_000_000L

    private fun state(permission: ProviderPermission, rationale: Boolean, flags: CalendarAccessFlags, writeRationale: Boolean = false, at: Long = now) =
        CalendarAccess.of(permission, rationale, writeRationale, flags, at)

    @Test
    fun everyStateOfTheTable() {
        assertEquals(CalendarAccess(CalendarAccessState.NOT_ASKED, false), state(none, false, CalendarAccessFlags()))
        assertEquals(CalendarAccessState.DENIED_ONCE, state(none, true, CalendarAccessFlags(asked = true, deniedOnce = true)).state)
        // Denied permanently: denied before and the rationale is false now. Before any events action, the link.
        assertEquals(CalendarAccessState.BLOCKED_LINK, state(none, false, CalendarAccessFlags(asked = true, deniedOnce = true)).state)
        assertEquals(CalendarAccessState.BLOCKED, state(none, false, CalendarAccessFlags(asked = true, deniedOnce = true, eventsActionTried = true)).state)
        // Asked, but the dialog was dismissed without a decision: still the not-asked card.
        assertEquals(CalendarAccessState.NOT_ASKED, state(none, false, CalendarAccessFlags(asked = true)).state)
        val readOnly = ProviderPermission(read = true, write = false)
        assertEquals(CalendarAccessState.READ_ONLY, state(readOnly, false, CalendarAccessFlags(), writeRationale = true).state)
        assertEquals(CalendarAccessState.READ_ONLY_BLOCKED, state(readOnly, false, CalendarAccessFlags(deniedOnce = true), writeRationale = false).state)
        val granted = state(ProviderPermission.FULL, false, CalendarAccessFlags(asked = true, deniedOnce = true))
        assertEquals(CalendarAccessState.GRANTED, granted.state)
        assertTrue(granted.canRead && granted.canWrite)
        assertTrue(state(readOnly, false, CalendarAccessFlags()).canRead)
        assertFalse(state(readOnly, false, CalendarAccessFlags()).canWrite)
    }

    @Test
    fun notNowHidesTheCardFor30Days() {
        val dismissed = CalendarAccessFlags(cardDismissedAt = now)
        assertTrue(state(none, false, dismissed, at = now + 29 * day).cardHidden)
        assertFalse(state(none, false, dismissed, at = now + 30 * day).cardHidden)
        assertTrue(state(none, true, dismissed.copy(deniedOnce = true), at = now + day).cardHidden)
        // The blocked states are not paused by "Not now".
        assertFalse(state(none, false, dismissed.copy(deniedOnce = true), at = now + day).cardHidden)
    }

    @Test
    fun requestsAndChoicesUpdateTheFlags() = runTest {
        withPermissions(UnconfinedTestDispatcher(testScheduler)) { permissions ->
            assertEquals(CalendarAccessFlags(), permissions.current())
            permissions.onRequestStarted()
            assertTrue(permissions.current().asked)
            // The first denial shows the rationale afterwards.
            permissions.onRequestResult(none, rationaleNow = true, dialogShown = true)
            assertTrue(permissions.current().deniedOnce)
            assertEquals(CalendarAccessState.DENIED_ONCE, state(none, true, permissions.current()).state)
            // The second denial: no rationale any more, so it is permanent.
            permissions.onRequestResult(none, rationaleNow = false, dialogShown = true)
            assertEquals(CalendarAccessState.BLOCKED_LINK, state(none, false, permissions.current()).state)
            permissions.onEventsAction()
            assertEquals(CalendarAccessState.BLOCKED, state(none, false, permissions.current()).state)
            permissions.onNotNow(now)
            assertEquals(now, permissions.current().cardDismissedAt)
            // Granted in Settings: the pause is cleared.
            permissions.onRequestResult(ProviderPermission.FULL, rationaleNow = false, dialogShown = true)
            assertEquals(null, permissions.current().cardDismissedAt)
        }
    }

    @Test
    fun aResultWithoutADialogIsPermanent() = runTest {
        withPermissions(UnconfinedTestDispatcher(testScheduler)) { permissions ->
            permissions.onRequestStarted()
            // The activity never paused: the system answered by itself (the user had blocked the permission).
            permissions.onRequestResult(none, rationaleNow = false, dialogShown = false)
            assertEquals(CalendarAccessState.BLOCKED_LINK, state(none, false, permissions.current()).state)
        }
        // A dismissed dialog (no decision) leaves the not-asked card.
        file.delete()
        withPermissions(UnconfinedTestDispatcher(testScheduler)) { permissions ->
            permissions.onRequestStarted()
            permissions.onRequestResult(none, rationaleNow = false, dialogShown = true)
            assertEquals(CalendarAccessState.NOT_ASKED, state(none, false, permissions.current()).state)
        }
    }

    @Test
    fun theTrackerSeesWhetherADialogWasShown() {
        val tracker = PermissionRequestTracker()
        tracker.onPause()
        tracker.start()
        assertFalse(tracker.finish())
        tracker.start()
        tracker.onPause()
        assertTrue(tracker.finish())
        assertFalse(tracker.finish())
    }

    @Test
    fun theFlagsLiveOutsideTheBackedUpSettingsFile() {
        assertEquals("thirteen_calendar_access", CalendarPermissions.FILE_NAME)
        assertEquals(listOf("android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR"), CalendarPermissions.PERMISSIONS.toList())
    }
}
