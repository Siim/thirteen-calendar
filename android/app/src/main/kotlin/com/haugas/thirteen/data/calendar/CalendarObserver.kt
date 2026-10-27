package com.haugas.thirteen.data.calendar

import android.content.ContentResolver
import android.database.ContentObserver
import android.provider.CalendarContract
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map

/**
 * Changes in the calendar data (docs/EVENTS.md §6.3): a [ContentObserver] on
 * `CalendarContract.CONTENT_URI` and its descendants, registered only while `READ_CALENDAR` is
 * granted (a revoked permission throws `SecurityException`, which ends the registration quietly),
 * debounced 300 ms so that one sync or one batch is one emission.
 */
class CalendarObserver(private val resolver: ContentResolver) {

    /** One emission per burst of changes while [permission] has read access. */
    @OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
    fun changes(permission: Flow<ProviderPermission>): Flow<Unit> =
        permission.map { it.read }
            .distinctUntilChanged()
            .flatMapLatest { read -> if (read) observe() else emptyFlow() }
            .debounce(DEBOUNCE_MS)

    /** The raw notifications of the provider, without debouncing. */
    fun observe(): Flow<Unit> = callbackFlow {
        val observer = object : ContentObserver(null) {
            override fun onChange(selfChange: Boolean) {
                trySend(Unit)
            }
        }
        val registered = try {
            resolver.registerContentObserver(CalendarContract.CONTENT_URI, true, observer)
            true
        } catch (_: SecurityException) {
            false
        }
        awaitClose {
            if (registered) {
                try {
                    resolver.unregisterContentObserver(observer)
                } catch (_: IllegalStateException) {
                    // Already unregistered.
                }
            }
        }
    }

    companion object {
        const val DEBOUNCE_MS: Long = 300L
    }
}
