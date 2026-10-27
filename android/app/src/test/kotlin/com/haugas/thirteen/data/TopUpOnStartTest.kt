package com.haugas.thirteen.data

import android.os.Looper
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.data.calendar.CalendarRepository
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.data.calendar.ProviderPermission
import com.haugas.thirteen.data.calendar.TopUpReport
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The 13-month top-up's trigger (docs/EVENTS.md §4.4 Top-up and Duplicate parts, §6.3): the
 * repository's `topUpHorizons()` runs on every `ON_START` of the process lifecycle while write access
 * is granted, never twice at once, and not after the model is gone. What one run writes is tested on
 * the planner (`ProviderWritesTest`) and on devices (`ProviderRepositoryTest`).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class TopUpOnStartTest {
    /** Counts top-up runs; a run waits for [gate] when one is set, and fails while [fails]. */
    private class Counting(inner: CalendarRepository, var report: TopUpReport = TopUpReport.NONE) : CalendarRepository by inner {
        var runs = 0
        var gate: CompletableDeferred<Unit>? = null
        var fails = false

        override suspend fun topUpHorizons(): TopUpReport {
            runs++
            gate?.await()
            if (fails) throw IllegalStateException("provider went away")
            return report
        }
    }

    /** Stands in for the process (ProcessLifecycleOwner): Thirteen has one activity. */
    private class Process : LifecycleOwner {
        val registry = LifecycleRegistry(this)
        override val lifecycle: Lifecycle get() = registry

        fun start() = registry.handleLifecycleEvent(Lifecycle.Event.ON_START)

        fun stop() = registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)

        fun restart() {
            stop()
            start()
        }
    }

    private val store = ViewModelStore()

    @After
    fun tearDown() = store.clear()

    private fun fake(permission: ProviderPermission = ProviderPermission.FULL): FakeCalendarRepository =
        requireNotNull(FakeCalendarRepository.fromAssets(ApplicationProvider.getApplicationContext(), permission))

    private fun model(repository: CalendarRepository): CalendarEventsModel {
        val factory = viewModelFactory { initializer { CalendarEventsModel(repository, work = Dispatchers.Unconfined) } }
        return ViewModelProvider(store, factory)[CalendarEventsModel::class.java]
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    @Test
    fun everyStartRunsATopUpWhileWriteAccessIsGranted() {
        val fake = fake()
        val repository = Counting(fake)
        val process = Process()
        model(repository).runTopUpsOnStart(process.lifecycle)
        assertEquals("no run before the process starts", 0, repository.runs)
        process.start()
        idle()
        assertEquals(1, repository.runs)
        process.restart()
        idle()
        assertEquals("the next start runs again", 2, repository.runs)

        // §6.3 "when write access is granted": read-only access and no access run nothing.
        fake.setPermission(ProviderPermission(read = true, write = false))
        process.restart()
        fake.setPermission(ProviderPermission.NONE)
        process.restart()
        idle()
        assertEquals(2, repository.runs)
        fake.setPermission(ProviderPermission.FULL)
        process.restart()
        idle()
        assertEquals(3, repository.runs)
    }

    @Test
    fun aProcessThatHasAlreadyStartedRunsATopUpAtOnce() {
        // The model is created while the activity composes, after the process may have started.
        val repository = Counting(fake())
        val process = Process().apply { start() }
        model(repository).runTopUpsOnStart(process.lifecycle)
        idle()
        assertEquals(1, repository.runs)
    }

    @Test
    fun aRunningTopUpIsNotStartedTwiceAndAFailedOneIsTriedAtTheNextStart() {
        val repository = Counting(fake()).apply { gate = CompletableDeferred() }
        val process = Process()
        val model = model(repository)
        model.runTopUpsOnStart(process.lifecycle)
        process.start()
        assertEquals(1, repository.runs)
        process.restart()
        assertNull("a second run while the first one is busy", model.topUpHorizons())
        assertEquals(1, repository.runs)

        // The busy run fails: nothing crashes, and the next start tries again.
        repository.fails = true
        repository.gate!!.complete(Unit)
        idle()
        repository.gate = null
        repository.fails = false
        process.restart()
        idle()
        assertEquals(2, repository.runs)
    }

    @Test
    fun aRunThatWroteSomethingReloadsTheYearsAndAQuietOneDoesNot() {
        val repository = Counting(fake())
        val model = model(repository)
        idle()
        val before = model.generation
        model.topUpHorizons()
        idle()
        assertEquals("TopUpReport.NONE: nothing was written", before, model.generation)
        repository.report = TopUpReport(seriesToppedUp = 1, partsAdded = 1, duplicatesRemoved = 0)
        model.topUpHorizons()
        idle()
        assertTrue("a run that added a part reads the years again", model.generation > before)
    }

    @Test
    fun aClearedModelStopsListeningToTheProcess() {
        val repository = Counting(fake())
        val process = Process()
        model(repository).runTopUpsOnStart(process.lifecycle)
        process.start()
        idle()
        assertEquals(1, process.registry.observerCount)
        store.clear()
        assertEquals("the observer leaves with the model", 0, process.registry.observerCount)
        process.restart()
        idle()
        assertEquals(1, repository.runs)
    }
}
