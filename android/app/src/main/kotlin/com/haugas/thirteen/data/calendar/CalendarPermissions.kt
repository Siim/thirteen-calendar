package com.haugas.thirteen.data.calendar

import android.Manifest
import android.content.Context
import androidx.compose.runtime.Immutable
import androidx.datastore.core.DataStore
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException

/**
 * The flags of the calendar access state machine (docs/EVENTS.md §2.16, §6.3). They live in their own
 * preferences file, outside the backup rules: runtime permissions never move to another device, so
 * a restored "denied once" would read a fresh install as permanently denied.
 */
private val Context.calendarAccessDataStore: DataStore<Preferences> by preferencesDataStore(
    name = CalendarPermissions.FILE_NAME,
    corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
)

/** The persisted flags (§6.3 `CalendarPermissions`). */
@Immutable
data class CalendarAccessFlags(
    /** Thirteen asked for the permissions at least once (`calendarAsked`). */
    val asked: Boolean = false,
    /** The user denied once: the rationale was shown, or a result came back denied (`calendarDeniedOnce`). */
    val deniedOnce: Boolean = false,
    /** When "Not now" hid the card (`calendarCardDismissedAt`, epoch milliseconds), or `null`. */
    val cardDismissedAt: Long? = null,
    /** The user tried an events action while access was blocked ("+", the link, the Settings row; `eventsActionTried`). */
    val eventsActionTried: Boolean = false,
    /**
     * Launches that showed the not-asked or denied-once card on Today (`accessCardLaunches`, §2.16
     * "Card persistence on Today"); from the third on, Today shows the one-line link instead.
     */
    val cardLaunches: Int = 0,
)

/** The states of §2.16's Android table. */
enum class CalendarAccessState {
    /** Never asked: "See your events in 13 months" with "Show my calendars" and "Not now". */
    NOT_ASKED,

    /** Denied once (`shouldShowRequestPermissionRationale` true): the rationale card with "Allow access". */
    DENIED_ONCE,

    /** Denied permanently, before any events action: the one-line link "See your events here". */
    BLOCKED_LINK,

    /** Denied permanently, after an events action: "Calendar access is off" with "Open settings". */
    BLOCKED,

    /** Read granted, write denied: the banner with "Allow changes" (requests `WRITE_CALENDAR`). */
    READ_ONLY,

    /** Read granted, write denied permanently: the same banner; "Allow changes" opens the app's settings. */
    READ_ONLY_BLOCKED,

    /** Both granted (the calendars decide between no card, "No calendars yet" and "nothing writable"). */
    GRANTED,
}

/** The card state and whether "Not now" hides it for now (30 days, §2.16). */
@Immutable
data class CalendarAccess(val state: CalendarAccessState, val cardHidden: Boolean) {
    val canRead: Boolean get() = state == CalendarAccessState.GRANTED || state == CalendarAccessState.READ_ONLY || state == CalendarAccessState.READ_ONLY_BLOCKED
    val canWrite: Boolean get() = state == CalendarAccessState.GRANTED

    companion object {
        /** "Not now" hides the not-asked and denied-once cards for 30 days. */
        const val CARD_PAUSE_MS: Long = 30L * 24 * 60 * 60 * 1000

        /**
         * The state of §2.16 from what Android reports now and the flags. "Permanently denied" is:
         * not granted, the user denied before ([CalendarAccessFlags.deniedOnce]), and the rationale is
         * false now. (A request whose result arrives without a dialog marks [CalendarAccessFlags.deniedOnce]
         * too, see [CalendarPermissions.onRequestResult].)
         */
        fun of(
            permission: ProviderPermission,
            rationale: Boolean,
            writeRationale: Boolean,
            flags: CalendarAccessFlags,
            nowMillis: Long,
        ): CalendarAccess {
            val hidden = flags.cardDismissedAt?.let { nowMillis - it in 0 until CARD_PAUSE_MS } ?: false
            val state = when {
                permission.read && permission.write -> CalendarAccessState.GRANTED
                permission.read -> if (flags.deniedOnce && !writeRationale) CalendarAccessState.READ_ONLY_BLOCKED else CalendarAccessState.READ_ONLY
                rationale -> CalendarAccessState.DENIED_ONCE
                flags.deniedOnce -> if (flags.eventsActionTried) CalendarAccessState.BLOCKED else CalendarAccessState.BLOCKED_LINK
                else -> CalendarAccessState.NOT_ASKED
            }
            val pausable = state == CalendarAccessState.NOT_ASKED || state == CalendarAccessState.DENIED_ONCE
            return CalendarAccess(state, cardHidden = pausable && hidden)
        }
    }
}

/**
 * The calendar access state machine of §2.16 (Android): READ_CALENDAR and WRITE_CALENDAR are
 * requested together; the flags remember what Android does not tell (whether Thirteen asked,
 * whether the user denied before, "Not now", and whether an events action was tried while blocked).
 *
 * The UI calls [onRequestStarted] before `launch`, [onRequestResult] with the result (and whether
 * the activity paused, i.e. a dialog was shown), [onNotNow], and [onEventsAction].
 */
class CalendarPermissions(private val dataStore: DataStore<Preferences>) {

    val flags: Flow<CalendarAccessFlags> = dataStore.data
        .catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }
        .map(::decode)
        .distinctUntilChanged()

    suspend fun current(): CalendarAccessFlags = flags.first()

    /** Before the system dialog: Thirteen has asked. */
    suspend fun onRequestStarted() {
        dataStore.edit { it[Keys.ASKED] = true }
    }

    /**
     * After the request. A denial with the rationale now shown, or a result that arrived without the
     * activity pausing (no dialog: the system denied by itself, so the user had blocked it), records
     * that the user denied. A grant clears the pause.
     */
    suspend fun onRequestResult(granted: ProviderPermission, rationaleNow: Boolean, dialogShown: Boolean) {
        dataStore.edit { prefs ->
            prefs[Keys.ASKED] = true
            if (granted.read && granted.write) {
                prefs.remove(Keys.DISMISSED_AT)
            } else if (rationaleNow || !dialogShown || granted.read) {
                prefs[Keys.DENIED_ONCE] = true
            }
        }
    }

    /** Whenever Android reports the rationale as shown: the user has denied once. */
    suspend fun onRationaleSeen() {
        dataStore.edit { it[Keys.DENIED_ONCE] = true }
    }

    /** "Not now": the card is hidden for 30 days ("+" still asks). */
    suspend fun onNotNow(nowMillis: Long) {
        dataStore.edit { it[Keys.DISMISSED_AT] = nowMillis }
    }

    /** "+", the one-line link or the Settings row while access is blocked: the full card is shown from now on. */
    suspend fun onEventsAction() {
        dataStore.edit { it[Keys.EVENTS_ACTION_TRIED] = true }
    }

    /** Today showed the not-asked or denied-once card at this launch (counted once per launch by the caller). */
    suspend fun onAccessCardShown() {
        dataStore.edit { it[Keys.CARD_LAUNCHES] = (it[Keys.CARD_LAUNCHES] ?: 0) + 1 }
    }

    internal object Keys {
        val ASKED = booleanPreferencesKey("calendarAsked")
        val DENIED_ONCE = booleanPreferencesKey("calendarDeniedOnce")
        val DISMISSED_AT = longPreferencesKey("calendarCardDismissedAt")
        val EVENTS_ACTION_TRIED = booleanPreferencesKey("eventsActionTried")
        val CARD_LAUNCHES = intPreferencesKey("accessCardLaunches")
    }

    companion object {
        /** DataStore file name (without `.preferences_pb`); not in the backup rules. */
        const val FILE_NAME = "thirteen_calendar_access"

        /** The permissions requested together (§2.16). */
        val PERMISSIONS: Array<String> = arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)

        /** The state machine on the app's access file. One DataStore per process. */
        fun from(context: Context): CalendarPermissions = CalendarPermissions(context.applicationContext.calendarAccessDataStore)

        internal fun decode(preferences: Preferences): CalendarAccessFlags = CalendarAccessFlags(
            asked = preferences[Keys.ASKED] ?: false,
            deniedOnce = preferences[Keys.DENIED_ONCE] ?: false,
            cardDismissedAt = preferences[Keys.DISMISSED_AT],
            eventsActionTried = preferences[Keys.EVENTS_ACTION_TRIED] ?: false,
            cardLaunches = preferences[Keys.CARD_LAUNCHES] ?: 0,
        )
    }
}

/**
 * Detects whether a permission request showed a dialog (§6.3): the activity pauses while the system
 * dialog is up. Call [start] just before launching the request, [onPause] from the activity's
 * `ON_PAUSE`, and read [finish] with the result.
 */
class PermissionRequestTracker {
    private var requesting = false
    private var paused = false

    fun start() {
        requesting = true
        paused = false
    }

    fun onPause() {
        if (requesting) paused = true
    }

    /** `true` when the activity paused during the request (a dialog was shown). */
    fun finish(): Boolean {
        val shown = paused
        requesting = false
        paused = false
        return shown
    }
}
