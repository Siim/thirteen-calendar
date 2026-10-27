package com.haugas.thirteen.data.calendar

import android.content.Context
import androidx.compose.runtime.Immutable
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.haugas.thirteen.core.GregorianDate
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject

/**
 * Held changes that could not be written while no Thirteen window was in the foreground (§2.11
 * "Failures nobody saw"): recorded in DataStore `failedCommits` with the event's key and title, the
 * change and its cause, and shown at the next `ON_START` as `calendar.commitFailed.later.*`. A
 * record is cleared when its toast closes or its list is opened. Nothing is retried in the
 * background. The file is per device and not backed up (only the settings file is).
 */
class FailedCommits(private val store: DataStore<Preferences>) {
    /** One failure nobody saw. */
    @Immutable
    data class Record(
        val key: String,
        val title: String,
        /** `true` for a delete, `false` for a move. */
        val delete: Boolean,
        /** The target (the deleted occurrence's date for a delete), device wall clock. */
        val date: GregorianDate,
        /** The target time, `null` for all-day. */
        val minute: Int?,
        /** `transient`, `changed`, or a final reason's `editor.saveFailed.*` id. */
        val cause: String,
        /** A delete's span, so "Try again" can write it again; `null` for moves. */
        val span: DeleteSpan?,
    ) {
        val transient: Boolean get() = cause == TRANSIENT
        val changed: Boolean get() = cause == CHANGED
        val reason: FailureReason? get() = FailureReason.entries.firstOrNull { it.copyId == cause }
    }

    suspend fun records(): List<Record> = decode(store.data.first()[KEY])

    suspend fun add(record: Record) {
        store.edit { it[KEY] = encode(decode(it[KEY]) + record) }
    }

    suspend fun clear() {
        store.edit { it.remove(KEY) }
    }

    companion object {
        const val TRANSIENT = "transient"
        const val CHANGED = "changed"
        private val KEY = stringPreferencesKey("failedCommits")

        fun from(context: Context): FailedCommits = FailedCommits(context.applicationContext.failedCommitsStore)

        /** The record of a failed [PendingChanges.Event.Failed]. */
        fun recordOf(event: PendingChanges.Event.Failed): Record {
            val change = event.pending.change
            val cause = when (val c = event.cause) {
                PendingChanges.Cause.Transient -> TRANSIENT
                PendingChanges.Cause.Changed -> CHANGED
                is PendingChanges.Cause.Final -> c.reason.copyId
            }
            return when (change) {
                is PendingChanges.Change.Delete -> Record(
                    change.key, change.title, delete = true, date = change.start.date,
                    minute = if (change.allDay) null else change.start.minute, cause = cause, span = change.span,
                )
                is PendingChanges.Change.Move -> Record(
                    change.key, change.title, delete = false, date = change.targetDate, minute = change.targetMinute, cause = cause, span = null,
                )
            }
        }

        internal fun encode(records: List<Record>): String = JSONArray().apply {
            records.forEach { r ->
                put(
                    JSONObject()
                        .put("key", r.key)
                        .put("title", r.title)
                        .put("change", if (r.delete) "delete" else "move")
                        .put("date", r.date.isoString)
                        .put("minute", r.minute ?: JSONObject.NULL)
                        .put("cause", r.cause)
                        .put("span", r.span?.name ?: JSONObject.NULL),
                )
            }
        }.toString()

        internal fun decode(text: String?): List<Record> {
            if (text.isNullOrEmpty()) return emptyList()
            return try {
                val array = JSONArray(text)
                (0 until array.length()).mapNotNull { i ->
                    val o = array.getJSONObject(i)
                    Record(
                        key = o.getString("key"),
                        title = o.getString("title"),
                        delete = o.getString("change") == "delete",
                        date = GregorianDate.parseOrNull(o.getString("date")) ?: return@mapNotNull null,
                        minute = if (o.isNull("minute")) null else o.getInt("minute"),
                        cause = o.getString("cause"),
                        span = if (o.isNull("span")) null else DeleteSpan.entries.firstOrNull { it.name == o.getString("span") },
                    )
                }
            } catch (_: org.json.JSONException) {
                emptyList()
            }
        }
    }
}

private val Context.failedCommitsStore: DataStore<Preferences> by preferencesDataStore(name = "thirteen_failed_commits")
