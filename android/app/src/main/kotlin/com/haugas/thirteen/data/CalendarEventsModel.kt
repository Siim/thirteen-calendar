package com.haugas.thirteen.data

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.SelfStatus
import com.haugas.thirteen.data.calendar.CalendarAccessFlags
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.data.calendar.CalendarPermissions
import com.haugas.thirteen.data.calendar.CalendarRepository
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.data.calendar.ProviderCalendarRepository
import com.haugas.thirteen.data.calendar.ProviderPermission
import com.haugas.thirteen.data.calendar.TopUpReport
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicReference

/** The occurrences of one Gregorian year as the views get them (§6.3 "Reading occurrences"). */
@Immutable
data class YearEvents(
    val year: Int,
    /** In the device's wall clock, sorted by start; declined invitations removed (§2.2). */
    val occurrences: List<CalendarOccurrence>,
    val status: Status,
) {
    enum class Status {
        /** The first read is running (no data yet), or a re-read after a change (the old data stays). */
        LOADING,
        LOADED,

        /** The read failed: `calendar.loadFailed` with "Try again" (§2.4 States). */
        FAILED,
    }
}

/**
 * The Calendar's events, shared by every screen of the window (docs/EVENTS.md §2.3 to §2.8):
 * one [CalendarRepository] (the Calendar Provider, or the mockup data set in debug QA runs and
 * tests), the calendars, and the occurrences of the Gregorian years on screen, re-read when the
 * calendar data, the permission or the visible calendars change. Year merges dedupe by key
 * ([merged], §3.2).
 *
 * Views read [yearEvents] through [rememberYearEvents], which asks for the year; at most
 * [CACHE_YEARS] years stay in memory. Hidden calendars are not fetched (§2.15): [setVisibility]
 * passes the visible ids to the repository.
 *
 * Seams for the events tasks that build on the Calendar (D5 to D8): read the model through
 * [LocalCalendarEvents]; [repository] writes, [refresh] after a write, [now] is the wall clock
 * (fixed to the data set's `now` in QA runs).
 */
class CalendarEventsModel(
    val repository: CalendarRepository,
    /** The access flags of §2.16; `null` in tests that do not need them. */
    val permissions: CalendarPermissions? = null,
    /** QA runs: the device's wall clock is fixed here (`thirteen.qa.fakeEvents`, §6.3). */
    val fixedNow: LocalDateTime? = null,
    private val work: CoroutineDispatcher = Dispatchers.IO,
    /** The selected system, for the repository's 13-month reads (the provider's self-expansion). */
    private val selectedSystem: AtomicReference<CalendarSystemId> = AtomicReference(CalendarSystemId.DEFAULT),
) : ViewModel() {
    /** READ_CALENDAR and WRITE_CALENDAR as granted now. */
    val permission: StateFlow<ProviderPermission> = repository.permission

    private val flagsState = MutableStateFlow(CalendarAccessFlags())

    /** The persisted access flags (§2.16); defaults until the file is read. */
    val accessFlags: StateFlow<CalendarAccessFlags> = flagsState.asStateFlow()

    /** The calendars that can show events, in the Calendars list's order; empty without read access. */
    var calendars: List<CalendarInfo> by mutableStateOf(emptyList())
        private set

    /** Whether [calendars] has been read at least once since the last permission change. */
    var calendarsLoaded: Boolean by mutableStateOf(false)
        private set

    /** The persisted visibility references (§3.2); `null`: every calendar. */
    var visibleRefs: Set<CalendarVisibility.Ref>? by mutableStateOf(null)
        private set

    /** The ids of the visible calendars, for the repository; `null` while every calendar is shown. */
    val visibleIds: Set<String>?
        get() = visibleRefs?.let { CalendarVisibility.visibleIds(calendars, it) }

    /** Every calendar is hidden (§2.4 States): calendars exist and none is visible. */
    val allHidden: Boolean
        get() = calendars.isNotEmpty() && visibleIds?.isEmpty() == true

    private val years = mutableStateMapOf<Int, YearEvents>()
    private val loads = HashMap<Int, Job>()

    /** Bumped on every change, so views waiting for a year ask again. */
    var generation: Int by mutableIntStateOf(0)
        private set

    /**
     * Launches that had shown Today's not-asked or denied-once card before this one (§2.16 "Card
     * persistence on Today"), read once per model, i.e. once per launch; `null` until the flags are
     * read. From 3 on, Today shows the one-line link "See your events here" instead (task D7).
     */
    var cardLaunchesAtStart: Int? by mutableStateOf(if (permissions == null) 0 else null)
        private set

    private var cardCounted = false

    /**
     * Moves and deletes held until their toast closes (§2.11 Undo, task D6): [yearEvents] and
     * [merged] show them applied; a change in the calendar data writes them early.
     */
    val pending: com.haugas.thirteen.data.calendar.PendingChanges =
        com.haugas.thirteen.data.calendar.PendingChanges(repository, viewModelScope, onWritten = { reloadAll() })

    init {
        viewModelScope.launch {
            var last: ProviderPermission? = null
            repository.permission.collect { now ->
                if (last != null && last != now) {
                    calendarsLoaded = false
                    reloadAll()
                }
                last = now
            }
        }
        viewModelScope.launch {
            repository.changes.collect {
                pending.onDataChanged()
                reloadAll()
            }
        }
        permissions?.let { p ->
            viewModelScope.launch {
                p.flags.collect {
                    if (cardLaunchesAtStart == null) cardLaunchesAtStart = it.cardLaunches
                    flagsState.value = it
                }
            }
        }
        reloadCalendars()
    }

    /** Today showed the not-asked or denied-once card: counted once per launch (per model). */
    fun noteAccessCardShown() {
        if (cardCounted || cardLaunchesAtStart == null) return
        cardCounted = true
        permissions?.let { p -> viewModelScope.launch { p.onAccessCardShown() } }
    }

    /** The occurrences of [year] read so far, or `null` before the first read. */
    fun yearEvents(year: Int): YearEvents? = years[year]?.let { y -> if (pending.held.isEmpty()) y else y.copy(occurrences = pending.overlay(y.occurrences)) }

    /**
     * Reads [year] unless it is in memory (or already being read). [force] reads it again (Try
     * again, a change).
     */
    fun load(year: Int, force: Boolean = false) {
        if (!GregorianDate.isValidYear(year)) return
        if (!force && (years[year]?.status == YearEvents.Status.LOADED || loads[year]?.isActive == true)) return
        loads[year]?.cancel()
        val previous = years[year]
        years[year] = YearEvents(year, previous?.occurrences.orEmpty(), YearEvents.Status.LOADING)
        val visible = visibleIds
        loads[year] = viewModelScope.launch {
            val result = try {
                val list = withContext(work) { repository.occurrences(year, visible) }
                // Keys are unique per read (§3.2); the layouts reject repeats, so a repeat never reaches them.
                YearEvents(year, list.filter { it.selfStatus != SelfStatus.DECLINED }.distinctBy { it.key }, YearEvents.Status.LOADED)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                YearEvents(year, previous?.occurrences.orEmpty(), YearEvents.Status.FAILED)
            }
            years[year] = result
            evict(year)
        }
    }

    /** Keeps the [CACHE_YEARS] years nearest to [around]. */
    private fun evict(around: Int) {
        if (years.size <= CACHE_YEARS) return
        years.keys.sortedByDescending { kotlin.math.abs(it - around) }.take(years.size - CACHE_YEARS).forEach {
            years.remove(it)
            loads.remove(it)?.cancel()
        }
    }

    /** Re-reads the calendars and every year in memory (after a change, a permission or visibility change). */
    fun refresh() = reloadAll()

    private fun reloadAll() {
        generation++
        reloadCalendars()
        years.keys.toList().forEach { load(it, force = true) }
    }

    private var calendarsJob: Job? = null

    private fun reloadCalendars() {
        calendarsJob?.cancel()
        calendarsJob = viewModelScope.launch {
            val list = try {
                withContext(work) { repository.calendars() }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                calendars
            }
            val before = visibleIds
            calendars = list
            calendarsLoaded = true
            // References that matched nothing before (the list was empty) can match now.
            if (visibleRefs != null && before != visibleIds) years.keys.toList().forEach { load(it, force = true) }
        }
    }

    /** The persisted visibility setting; the years in memory are read again when the visible set changes. */
    fun setVisibility(refs: Set<CalendarVisibility.Ref>?) {
        if (refs == visibleRefs) return
        val before = visibleIds
        visibleRefs = refs
        if (before != visibleIds) {
            generation++
            years.keys.toList().forEach { load(it, force = true) }
        }
    }

    /** The calendar system the views show (the repository reads 13-month data with it). */
    fun setSystem(system: CalendarSystemId) {
        if (selectedSystem.getAndSet(system) != system) reloadAll()
    }

    /** Re-reads the permission (the app returned to the foreground, a request finished). */
    fun refreshPermission() = repository.refreshPermission()

    private var topUpJob: Job? = null

    /**
     * One top-up run (§4.4 Top-up and Duplicate parts, §6.3): the repository extends the date lists
     * of open-ended 13-month series and removes duplicate parts, at most 50 series per run. Runs only
     * with write access, and never twice at once; `null` when it does not start. A failed run is
     * left for the next start. What it writes reaches the views like any other write.
     */
    fun topUpHorizons(): Job? {
        if (topUpJob?.isActive == true) return null
        repository.refreshPermission()
        if (!repository.permission.value.write) return null
        return viewModelScope.launch {
            val report = try {
                withContext(work) { repository.topUpHorizons() }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                TopUpReport.NONE
            }
            if (report != TopUpReport.NONE) reloadAll()
        }.also { topUpJob = it }
    }

    /**
     * Runs [topUpHorizons] on every `ON_START` of [lifecycle] while this model lives (§6.3: the
     * process lifecycle, [ProcessLifecycleOwner], so a rotation does not run it again). Call on the
     * main thread. A lifecycle that has already started delivers `ON_START` at once.
     */
    fun runTopUpsOnStart(lifecycle: Lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_START) topUpHorizons() }
        lifecycle.addObserver(observer)
        addCloseable { lifecycle.removeObserver(observer) }
    }

    /**
     * The occurrences of [yearRange] merged into one list: an occurrence that crosses January 1 is in
     * both years' lists, and appears once (§3.2, §6.3). Sorted by start, then key.
     */
    fun merged(yearRange: IntRange): List<CalendarOccurrence> = pending.overlay(merge(yearRange.mapNotNull { years[it]?.occurrences }))

    /** The device's wall clock now ([fixedNow] in QA runs). */
    fun now(): LocalDateTime = fixedNow ?: deviceNow()

    companion object {
        /** Years kept in memory. */
        const val CACHE_YEARS: Int = 6

        /** Lists merged by key (first copy wins), sorted by start, then key. */
        fun merge(lists: List<List<CalendarOccurrence>>): List<CalendarOccurrence> {
            val seen = HashSet<String>()
            val out = ArrayList<CalendarOccurrence>()
            for (list in lists) for (o in list) if (seen.add(o.key)) out += o
            out.sortWith(compareBy<CalendarOccurrence>({ it.occurrence.start }, { !it.occurrence.allDay }, { it.key }))
            return out
        }

        /** The device's wall clock as a core [LocalDateTime]. */
        fun deviceNow(): LocalDateTime {
            val now = java.time.LocalDateTime.now()
            return LocalDateTime(GregorianDate(now.year, now.monthValue, now.dayOfMonth), now.hour * 60 + now.minute)
        }

        /**
         * The app's model: the Calendar Provider, or in a debug QA run ([fake]) the mockup data set
         * from the debug assets with its fixed `now` (§6.3, android/README.md "QA runs").
         */
        fun create(context: Context, fake: Boolean): CalendarEventsModel {
            val app = context.applicationContext
            val permissions = CalendarPermissions.from(app)
            if (fake) {
                FakeCalendarRepository.fromAssets(app)?.let { return CalendarEventsModel(it, permissions, fixedNow = it.now) }
            }
            val system = AtomicReference(CalendarSystemId.DEFAULT)
            return CalendarEventsModel(ProviderCalendarRepository(app, system = { system.get() }), permissions, selectedSystem = system)
                .also { it.runTopUpsOnStart(ProcessLifecycleOwner.get().lifecycle) }
        }
    }
}

/** The window's events, or `null` where events are not available (previews, tests without events). */
val LocalCalendarEvents = staticCompositionLocalOf<CalendarEventsModel?> { null }

/**
 * The occurrences of [year] from [model], read on first use, again after every change, and again
 * when the model let the year go to keep its cache small ([CalendarEventsModel.CACHE_YEARS]).
 */
@Composable
fun rememberYearEvents(model: CalendarEventsModel?, year: Int): YearEvents? {
    if (model == null) return null
    val events = model.yearEvents(year)
    LaunchedEffect(model, year, model.generation, events == null) { model.load(year) }
    return events
}

/** The device's wall clock, ticking at each minute ([CalendarEventsModel.fixedNow] in QA runs). */
@Composable
fun rememberCalendarNow(model: CalendarEventsModel?): LocalDateTime {
    val fixed = model?.fixedNow
    val state = produceState(fixed ?: CalendarEventsModel.deviceNow(), fixed) {
        if (fixed != null) {
            value = fixed
            return@produceState
        }
        while (true) {
            value = CalendarEventsModel.deviceNow()
            delay(60_000L - (System.currentTimeMillis() % 60_000L))
        }
    }
    return state.value
}
