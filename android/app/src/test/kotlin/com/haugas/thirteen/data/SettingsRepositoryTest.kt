package com.haugas.thirteen.data

import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.preferencesOf
import androidx.datastore.preferences.core.stringPreferencesKey
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.ui.theme.ThirteenTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
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

/** Settings persistence: a real preferences DataStore on a temporary file. */
@OptIn(ExperimentalCoroutinesApi::class)
class SettingsRepositoryTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val file: File by lazy { File(folder.root, "${SettingsRepository.FILE_NAME}.preferences_pb") }

    /** Runs [block] with a repository whose DataStore lives exactly as long as the block (one DataStore per file at a time). */
    private suspend fun withRepository(dispatcher: TestDispatcher, block: suspend (SettingsRepository) -> Unit) {
        val job = Job()
        val dataStore = PreferenceDataStoreFactory.create(
            corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
            scope = CoroutineScope(dispatcher + job),
            produceFile = { file },
        )
        try {
            block(SettingsRepository(dataStore))
        } finally {
            job.cancelAndJoin()
        }
    }

    @Test
    fun newUsersGetTheDefaults() = runTest {
        withRepository(UnconfinedTestDispatcher(testScheduler)) { repository ->
            val settings = repository.settings.first()
            assertEquals(UserSettings(), settings)
            assertEquals(CalendarSystemId.IFC, settings.system)
            assertTrue(settings.showsGregorianOverlay)
            assertEquals(ThirteenTheme.Almanac, settings.theme)
            assertEquals(Appearance.SYSTEM, settings.appearance)
        }
    }

    @Test
    fun everySettingSurvivesARestart() = runTest {
        val dispatcher = UnconfinedTestDispatcher(testScheduler)
        withRepository(dispatcher) { repository ->
            repository.setSystem(CalendarSystemId.POSITIVIST)
            repository.setShowsGregorianOverlay(false)
            repository.setTheme(ThirteenTheme.Forest)
            repository.setAppearance(Appearance.DARK)
        }
        assertTrue("written to the file", file.length() > 0)
        withRepository(dispatcher) { reopened ->
            assertEquals(
                UserSettings(CalendarSystemId.POSITIVIST, showsGregorianOverlay = false, ThirteenTheme.Forest, Appearance.DARK),
                reopened.settings.first(),
            )
        }
    }

    @Test
    fun changesAreEmitted() = runTest {
        withRepository(UnconfinedTestDispatcher(testScheduler)) { repository ->
            assertEquals(ThirteenTheme.Almanac, repository.settings.first().theme)
            repository.setTheme(ThirteenTheme.Mono)
            assertEquals(ThirteenTheme.Mono, repository.settings.first().theme)
            repository.setAppearance(Appearance.LIGHT)
            repository.setAppearance(Appearance.SYSTEM)
            assertEquals(Appearance.SYSTEM, repository.settings.first().appearance)
        }
    }

    @Test
    fun aCorruptFileFallsBackToTheDefaults() = runTest {
        file.writeBytes(byteArrayOf(0x7f, 0x13, 0x00, 0x42, 0x13))
        withRepository(UnconfinedTestDispatcher(testScheduler)) { repository ->
            assertEquals(UserSettings(), repository.settings.first())
            repository.setTheme(ThirteenTheme.Slate)
            assertEquals(ThirteenTheme.Slate, repository.settings.first().theme)
        }
    }

    @Test
    fun unknownStoredValuesFallBackToTheDefaults() {
        val decoded = SettingsRepository.decode(
            preferencesOf(
                stringPreferencesKey("selectedSystem") to "julian",
                stringPreferencesKey("theme") to "neon",
                stringPreferencesKey("appearance") to "sepia",
                booleanPreferencesKey("showsGregorianOverlay") to false,
            ),
        )
        assertEquals(UserSettings(showsGregorianOverlay = false), decoded)
        assertFalse(decoded.showsGregorianOverlay)
    }

    @Test
    fun storedIdsMatchTheAppleKeys() {
        val decoded = SettingsRepository.decode(
            preferencesOf(
                stringPreferencesKey("selectedSystem") to "positivist",
                stringPreferencesKey("theme") to "graphite",
                stringPreferencesKey("appearance") to "light",
            ),
        )
        assertEquals(UserSettings(CalendarSystemId.POSITIVIST, true, ThirteenTheme.Graphite, Appearance.LIGHT), decoded)
    }

    @Test
    fun appearanceFollowsTheDeviceOnlyOnSystem() {
        assertTrue(Appearance.SYSTEM.isDark(systemIsDark = true))
        assertFalse(Appearance.SYSTEM.isDark(systemIsDark = false))
        assertFalse(Appearance.LIGHT.isDark(systemIsDark = true))
        assertTrue(Appearance.DARK.isDark(systemIsDark = false))
    }
}
