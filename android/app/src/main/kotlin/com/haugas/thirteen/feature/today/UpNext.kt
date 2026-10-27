package com.haugas.thirteen.feature.today

import androidx.compose.runtime.Immutable
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.events.AgendaDay
import com.haugas.thirteen.core.events.AgendaItem
import com.haugas.thirteen.core.events.EventOccurrence
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.plusDaysOrNull

/**
 * Today's "Up next" rows (docs/EVENTS.md §2.8, board B1): the next 7 days' events from now, at most
 * 6 rows, grouped "Today", "Tomorrow" and then by day. The same readings as the web
 * (`packages/ui/src/events/upNext.ts`) and the Apple app, pinned by `UpNextTest` with the mockup
 * data set:
 * - "7 days ahead" is today and the 6 days after it (board B1 counts "5 more in the next 7 days"
 *   through Sunday, October 25).
 * - An event appears once, on the first day of the range it touches: a multi-day event that started
 *   before today is listed today ("Day 2 of 3") and not again on later days.
 * - Events that ended earlier today are left out; one running now keeps its row, with the Now
 *   plate. Rows keep the agenda's order (all-day items and middle parts first, then by start), so a
 *   running event leads the timed rows, under the all-day ones, as board B1 draws it.
 * - The rows past the sixth are counted, each event once, in [UpNext.more].
 */
@Immutable
data class UpNext(
    /** Days with rows, in date order. */
    val groups: List<Group>,
    /** Events in the range past the row limit (`today.moreNext7`). */
    val more: Int,
    /** Today still has something to show (else `today.emptyToday`, when later days do). */
    val todayLeft: Boolean,
    /** Nothing at all in the 7 days (`today.emptyWeek`). */
    val empty: Boolean,
    /** The last day of the range (inclusive). */
    val to: GregorianDate,
) {
    enum class Kind { TODAY, TOMORROW, LATER }

    /** One day's rows: "Today", "Tomorrow", or a later day headed by both calendars. */
    @Immutable
    data class Group(val kind: Kind, val gregorian: GregorianDate, val thirteen: ThirteenDate, val items: List<AgendaItem>)

    companion object {
        /** Today and the 6 days after it. */
        const val DAYS: Int = 7

        /** At most this many rows; the rest are counted. */
        const val MAX_ROWS: Int = 6

        /** Ended before [now]: its end is at or before now (a zero-length event at now has not ended). */
        private fun ended(occurrence: EventOccurrence, now: LocalDateTime): Boolean = occurrence.end <= now && occurrence.start < now

        /**
         * The Up next rows for [now] (the device's wall clock; its date is "today") from the visible
         * calendars' occurrences, which must cover `now.date` to 6 days later with unique keys
         * (merged across years by key, as `CalendarEventsModel.merge` does).
         */
        fun of(
            occurrences: List<EventOccurrence>,
            now: LocalDateTime,
            system: CalendarSystemId,
            days: Int = DAYS,
            maxRows: Int = MAX_ROWS,
        ): UpNext {
            val from = now.date
            val to = from.plusDaysOrNull(days - 1) ?: GregorianDate(GregorianDate.MAX_YEAR, 12, 31)
            val tomorrow = from.plusDaysOrNull(1)
            val current = occurrences.filter { !ended(it, now) }
            val agenda = AgendaDay.days(current, from, to, system)
            val seen = HashSet<String>()
            val groups = ArrayList<Group>()
            var shown = 0
            var total = 0
            var todayLeft = false
            for (day in agenda) {
                val rows = ArrayList<AgendaItem>()
                for (item in day.items) {
                    if (!seen.add(item.key)) continue
                    total++
                    if (day.gregorian == from) todayLeft = true
                    if (shown < maxRows) {
                        rows += item
                        shown++
                    }
                }
                if (rows.isEmpty()) continue
                val kind = when (day.gregorian) {
                    from -> Kind.TODAY
                    tomorrow -> Kind.TOMORROW
                    else -> Kind.LATER
                }
                groups += Group(kind, day.gregorian, day.thirteen, rows)
            }
            return UpNext(groups, more = total - shown, todayLeft = todayLeft, empty = total == 0, to = to)
        }
    }
}
