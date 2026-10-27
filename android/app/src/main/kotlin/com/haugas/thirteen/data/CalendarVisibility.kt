package com.haugas.thirteen.data

import androidx.compose.runtime.Immutable
import com.haugas.thirteen.core.events.CalendarInfo
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * Thirteen's own calendar visibility (docs/EVENTS.md §2.15, §3.2): which calendars the views show.
 * It never changes Android's own `VISIBLE` column. A calendar is referenced by its id, then by
 * account and display name, because a sync can re-create a calendar with a new id.
 */
object CalendarVisibility {
    /** A persisted reference to a calendar. */
    @Immutable
    data class Ref(val id: String, val accountId: String, val title: String) {
        /** One string per reference: the three fields percent-encoded and joined by spaces. */
        val encoded: String get() = listOf(id, accountId, title).joinToString(" ") { URLEncoder.encode(it, "UTF-8") }

        /** Whether this reference names [calendar]: same id, or same account and display name. */
        fun matches(calendar: CalendarInfo): Boolean = calendar.id == id || (calendar.accountId == accountId && calendar.title == title)

        companion object {
            fun of(calendar: CalendarInfo): Ref = Ref(calendar.id, calendar.accountId, calendar.title)

            /** The reference [encoded] holds, or `null` for anything else. */
            fun decode(encoded: String): Ref? {
                val parts = encoded.split(' ')
                if (parts.size != 3) return null
                return try {
                    val (id, account, title) = parts.map { URLDecoder.decode(it, "UTF-8") }
                    Ref(id, account, title)
                } catch (_: IllegalArgumentException) {
                    null
                }
            }
        }
    }

    /** The ids of [calendars] that are shown: all of them when [refs] is `null`. */
    fun visibleIds(calendars: List<CalendarInfo>, refs: Set<Ref>?): Set<String> =
        if (refs == null) calendars.mapTo(LinkedHashSet()) { it.id } else calendars.filter { c -> refs.any { it.matches(c) } }.mapTo(LinkedHashSet()) { it.id }

    /** The references after showing or hiding [calendar] (a first change lists every other shown calendar). */
    fun toggled(calendars: List<CalendarInfo>, refs: Set<Ref>?, calendar: CalendarInfo, visible: Boolean): Set<Ref> {
        val shown = calendars.filter { c -> refs == null || refs.any { it.matches(c) } }.filter { it.id != calendar.id }
        return (shown + if (visible) listOf(calendar) else emptyList()).mapTo(LinkedHashSet(), Ref::of)
    }

    /** The references after showing or hiding every calendar of [group]. */
    fun groupToggled(calendars: List<CalendarInfo>, refs: Set<Ref>?, group: List<CalendarInfo>, visible: Boolean): Set<Ref> {
        val ids = group.mapTo(HashSet()) { it.id }
        val shown = calendars.filter { c -> c.id !in ids && (refs == null || refs.any { it.matches(c) }) }
        return (shown + if (visible) group else emptyList()).mapTo(LinkedHashSet(), Ref::of)
    }
}
