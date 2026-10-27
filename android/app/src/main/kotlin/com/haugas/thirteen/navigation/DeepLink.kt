package com.haugas.thirteen.navigation

import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.parseNumericOrNull
import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder

/** Which side of the converter is the input. */
enum class ConvertDirection {
    /** Gregorian date in, 13-month date out. */
    FROM_GREGORIAN,

    /** 13-month date in, Gregorian date out. */
    FROM_THIRTEEN,
    ;

    val toggled: ConvertDirection get() = if (this == FROM_GREGORIAN) FROM_THIRTEEN else FROM_GREGORIAN
}

/**
 * A parsed `thirteen://` URL, routed exactly like the Apple app (apple/Shared/App/DeepLink.swift).
 *
 * | URL | Destination |
 * |---|---|
 * | `thirteen://today` | Today |
 * | `thirteen://year/2026` | Year 2026 (Gregorian year); `?day=2026-10-19` also opens that day's comparison |
 * | `thirteen://convert?date=2026-10-19` | Converter on that Gregorian date (also `convert/2026-10-19`) |
 * | `thirteen://convert?thirteen=2024-LD` | Converter on that 13-month date (display year of the system), 13-month side |
 * | `thirteen://compare/2024` | Compare for 2024 (also `?year=2024`) |
 * | `thirteen://history` | History |
 * | `thirteen://calendar` | Calendar in its last mode |
 * | `thirteen://month/2026/11` | Month mode: Gregorian year 2026, 13-month month 11 of the selected (or given) system |
 * | `thirteen://week/2026-10-19` | Week mode for the 13-month week of that Gregorian day (Day on compact widths) |
 * | `thirteen://day/2026-10-19` | Day mode |
 * | `thirteen://new-event?date=2026-10-19` | the editor for a new event that day (after access, if needed) |
 *
 * `year` opens the Calendar's Year mode (docs/EVENTS.md §2.22). Every link also accepts `?system=ifc|positivist`, which switches (and persists) the system. Years
 * are Gregorian years 1..9999 (SPEC §1.4); an invalid year or date keeps the destination but
 * ignores the bad value. The URI comes from other apps, so it is untrusted input: anything that
 * does not parse is ignored, and nothing but these values is read from it.
 */
data class DeepLink(val destination: Destination, val system: CalendarSystemId? = null) {

    sealed interface Destination {
        data object Today : Destination

        data class Year(val year: Int?, val day: GregorianDate?) : Destination

        data class Convert(val date: GregorianDate?, val direction: ConvertDirection?) : Destination

        data class Compare(val year: Int?) : Destination

        data object History : Destination

        /** The Calendar in its last mode. */
        data object Calendar : Destination

        /** Month mode; [month] 1..13 of the system the link leaves selected. Missing or bad values: defaults. */
        data class Month(val year: Int?, val month: Int?) : Destination

        /** Week mode for the week of [date] (Day on compact widths). */
        data class Week(val date: GregorianDate?) : Destination

        /** Day mode on [date]. */
        data class Day(val date: GregorianDate?) : Destination

        /** A new event on [date] (today when missing). */
        data class NewEvent(val date: GregorianDate?) : Destination
    }

    /** The canonical URL for this link (inverse of [parse] for the canonical forms). */
    fun toUriString(): String {
        val query = mutableListOf<String>()
        val base = when (val d = destination) {
            Destination.Today -> "today"
            is Destination.Year -> {
                d.day?.let { query += "day=${it.isoString}" }
                if (d.year != null) "year/${d.year}" else "year"
            }
            is Destination.Convert -> {
                d.date?.let { query += "date=${it.isoString}" }
                "convert"
            }
            is Destination.Compare -> if (d.year != null) "compare/${d.year}" else "compare"
            Destination.History -> "history"
            Destination.Calendar -> "calendar"
            is Destination.Month -> if (d.year != null && d.month != null) {
                "month/${d.year}/${d.month}"
            } else {
                d.year?.let { query += "year=$it" }
                d.month?.let { query += "month=$it" }
                "month"
            }
            is Destination.Week -> if (d.date != null) "week/${d.date.isoString}" else "week"
            is Destination.Day -> if (d.date != null) "day/${d.date.isoString}" else "day"
            is Destination.NewEvent -> {
                d.date?.let { query += "date=${it.isoString}" }
                "new-event"
            }
        }
        system?.let { query += "system=${it.id}" }
        return "$SCHEME://$base" + if (query.isEmpty()) "" else query.joinToString("&", prefix = "?")
    }

    companion object {
        const val SCHEME = "thirteen"

        /** Longer input is not a Thirteen link; it is rejected before parsing. */
        const val MAX_LENGTH = 2048

        /** Parses a `thirteen://` URL; `null` for other schemes, unknown destinations or garbage. */
        fun parse(text: String?): DeepLink? {
            if (text == null || text.length > MAX_LENGTH) return null
            val uri = try {
                URI(text)
            } catch (_: URISyntaxException) {
                return null
            }
            if (!uri.scheme.equals(SCHEME, ignoreCase = true)) return null

            // thirteen://year/2026 has host "year"; also accept thirteen:year/2026 (opaque) and
            // thirteen:///year/2026 (empty host), like URLComponents on Apple platforms.
            val rawPath: String
            val rawQuery: String?
            val segments = mutableListOf<String>()
            if (uri.isOpaque) {
                val ssp = uri.rawSchemeSpecificPart ?: return null
                val q = ssp.indexOf('?')
                rawPath = if (q >= 0) ssp.substring(0, q) else ssp
                rawQuery = if (q >= 0) ssp.substring(q + 1) else null
            } else {
                rawPath = uri.rawPath.orEmpty()
                rawQuery = uri.rawQuery
                val host = uri.host ?: uri.rawAuthority?.substringBefore(':')?.substringAfterLast('@')
                if (!host.isNullOrEmpty()) segments += decode(host) ?: return null
            }
            for (part in rawPath.split('/')) {
                if (part.isNotEmpty()) segments += decode(part) ?: return null
            }
            val head = segments.firstOrNull()?.lowercase() ?: return null
            val argument = segments.getOrNull(1)
            val query = parseQuery(rawQuery)
            val system = query["system"]?.lowercase()?.let(CalendarSystemId::fromIdOrNull)

            val destination = when (head) {
                "today" -> Destination.Today
                "year" -> Destination.Year(year(argument), date(query["day"]))
                "convert" -> {
                    val thirteen = query["thirteen"]?.let { ThirteenDate.parseNumericOrNull(it, system ?: CalendarSystemId.IFC) }
                    if (thirteen != null) {
                        Destination.Convert(thirteen.gregorian, ConvertDirection.FROM_THIRTEEN)
                    } else {
                        val date = date(query["date"] ?: argument)
                        Destination.Convert(date, if (date == null) null else ConvertDirection.FROM_GREGORIAN)
                    }
                }
                "compare" -> Destination.Compare(year(argument ?: query["year"]))
                "history" -> Destination.History
                "calendar" -> Destination.Calendar
                "month" -> Destination.Month(year(argument ?: query["year"]), month(segments.getOrNull(2) ?: query["month"]))
                "week" -> Destination.Week(date(argument ?: query["date"]))
                "day" -> Destination.Day(date(argument ?: query["date"]))
                "new-event" -> Destination.NewEvent(date(query["date"] ?: argument))
                else -> return null
            }
            return DeepLink(destination, system)
        }

        /** `name=value` pairs with lowercase names; items without a value are skipped, the last one wins. */
        private fun parseQuery(raw: String?): Map<String, String> {
            if (raw.isNullOrEmpty()) return emptyMap()
            val result = LinkedHashMap<String, String>()
            for (item in raw.split('&')) {
                val eq = item.indexOf('=')
                if (eq < 0) continue
                val name = decode(item.substring(0, eq)) ?: continue
                val value = decode(item.substring(eq + 1)) ?: continue
                result[name.lowercase()] = value
            }
            return result
        }

        /** Percent-decoding only: a `+` stays a plus sign (as in URLComponents). */
        private fun decode(text: String): String? = try {
            URLDecoder.decode(text.replace("+", "%2B"), "UTF-8")
        } catch (_: IllegalArgumentException) {
            null
        }

        private fun year(text: String?): Int? = text?.toIntOrNull()?.takeIf(GregorianDate::isValidYear)

        private fun date(text: String?): GregorianDate? = text?.let(GregorianDate::parseOrNull)

        private fun month(text: String?): Int? = text?.toIntOrNull()?.takeIf { it in 1..13 }
    }
}
