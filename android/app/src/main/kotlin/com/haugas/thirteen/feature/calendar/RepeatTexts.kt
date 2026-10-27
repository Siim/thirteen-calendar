package com.haugas.thirteen.feature.calendar

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.events.describe
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.data.calendar.CalendarRepository
import com.haugas.thirteen.ui.Phrasing
import kotlinx.coroutines.CancellationException

/**
 * The repeat descriptions of Month's day list rows (§2.4, board A1: "until 10:30 · Every 2 weeks on
 * Monday", "Raamatukoi · Every IFC month on the 12th"; Apple's `RepeatDescriptions`, web's
 * `useRepeatText`): core's `describe` of the series' recurrence from the series' start, read once per
 * event while the events stay unchanged ([rememberRepeatTexts] makes a new one after every change).
 */
@Stable
class RepeatTexts internal constructor(private val repository: CalendarRepository, private val system: CalendarSystemId) {
    /** By event id; `""`: read, no description. Touched on the main thread only. */
    private val texts = HashMap<String, String>()

    /** The description already read for [o]'s event, or `null`. */
    fun cached(o: CalendarOccurrence): String? = texts[o.eventId]?.ifEmpty { null }

    /** Reads [o]'s series and describes its repeat; `null` for single events and unreadable rules. */
    suspend fun read(o: CalendarOccurrence): String? {
        texts[o.eventId]?.let { return it.ifEmpty { null } }
        val details = try {
            repository.event(o.key)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return null
        }
        val series = details?.event?.draft
        val text = series?.recurrence?.let { recurrence ->
            try {
                Phrasing.withoutDashes(recurrence.describe(series.start.date, system))
            } catch (_: ThirteenException) {
                null
            }
        }.orEmpty()
        texts[o.eventId] = text
        return text.ifEmpty { null }
    }
}

/** The [RepeatTexts] of the current events model and [system], renewed after every change; `null` without events. */
@Composable
fun rememberRepeatTexts(system: CalendarSystemId): RepeatTexts? {
    val model = LocalCalendarEvents.current ?: return null
    val generation = model.generation
    return remember(model, system, generation) { RepeatTexts(model.repository, system) }
}

/** [o]'s repeat in words for its row's second line, once read; `null` for single events. */
@Composable
fun RepeatTexts?.textOf(o: CalendarOccurrence): String? {
    val texts = this
    if (texts == null || !o.repeating) return null
    val text by produceState(texts.cached(o), texts, o.key) { value = texts.read(o) }
    return text
}
