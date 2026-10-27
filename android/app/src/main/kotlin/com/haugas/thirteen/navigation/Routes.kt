package com.haugas.thirteen.navigation

import com.haugas.thirteen.core.GregorianDate
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * The top-level screens: the navigation bar on phones, the navigation rail on larger windows.
 * Calendar replaced Year in the same place, with the same icon and Ctrl+2 (docs/EVENTS.md §2.1).
 */
enum class Section {
    TODAY,
    CALENDAR,
    CONVERT,
    COMPARE,
    HISTORY,
    ;

    companion object {
        /** The section saved as [name], or `null` (a key from an older version, such as `YEAR`). */
        fun fromNameOrNull(name: String): Section? = entries.firstOrNull { it.name == name }
    }
}

/**
 * The five Calendar modes (§2.1), in the order of the segmented buttons at expanded width. [id] is
 * the stable form in route keys and links.
 */
enum class CalendarMode(val id: String) {
    DAY("day"),
    WEEK("week"),
    MONTH("month"),
    YEAR("year"),
    LIST("list"),
    ;

    companion object {
        fun fromIdOrNull(id: String): CalendarMode? = entries.firstOrNull { it.id == id }
    }
}

/**
 * A destination on a section's back stack. [key] is a stable string: it is what the back stacks
 * save across configuration changes and process death, so a route needs no reflection or
 * serialization library (and no R8 keep rules). Values that come from data (event keys, draft
 * keys) are percent-encoded in the key, so a key never holds the space and newline that separate
 * saved routes and sections.
 */
sealed interface Route {
    val key: String

    /**
     * The root of a section. The Calendar section's root is Year mode, the top of the compact
     * drill-down (§2.1): Month, List, Week and Day are [Calendar] routes above it.
     */
    data class Root(val section: Section) : Route {
        override val key: String get() = "root:${section.name.lowercase()}"
    }

    /** Settings, pushed on the current section. */
    data object Settings : Route {
        override val key: String get() = "settings"
    }

    /** The font license, pushed from Settings. */
    data object Licenses : Route {
        override val key: String get() = "licenses"
    }

    /**
     * The day comparison in Year mode: the detail pane next to the grid on expanded windows, a
     * full screen otherwise. The day itself is the app state's `yearSelection`, so the grid
     * highlights it and stepping through days moves the highlight.
     */
    data object YearDay : Route {
        override val key: String get() = "year-day"
    }

    /** The full comparison of one day, from Today and the converter. */
    data class Day(val date: GregorianDate) : Route {
        override val key: String get() = "day:${date.isoString}"
    }

    /**
     * A Calendar mode other than Year (Year is the section's [Root]). The day it shows is the app
     * state's `calendarDate`, shared by the modes, so paging changes state instead of the back stack
     * (no transition per page, and the screen keeps its scroll and saved state).
     */
    data class Calendar(val mode: CalendarMode) : Route {
        init {
            require(mode != CalendarMode.YEAR) { "Year mode is the Calendar section's root" }
        }

        override val key: String get() = "calendar:${mode.id}"
    }

    /** The details of one occurrence (§2.10); [occurrenceKey] is the repository's opaque key (§3.2). */
    data class Event(val occurrenceKey: String) : Route {
        override val key: String get() = "event:${encode(occurrenceKey)}"
    }

    /**
     * The event editor (§2.11), a full-screen dialog. [draftKey] says what it edits; build it with
     * [EditorTarget] (`new:2026-10-19`, `edit:{occurrence key}`, ...). The draft itself lives in the
     * entry's saved state (it survives process death).
     */
    data class EventEditor(val draftKey: String) : Route {
        override val key: String get() = "editor:${encode(draftKey)}"
    }

    /**
     * The Calendars list (§2.15): a supporting pane beside the Calendar grid at expanded width,
     * a bottom sheet over it at compact and medium width. On the stack only while open.
     */
    data object Calendars : Route {
        override val key: String get() = "calendars"
    }

    companion object {
        /** The route saved as [key], or `null` if it is not one. */
        fun fromKey(key: String): Route? = when {
            key.startsWith("root:") -> Section.entries.firstOrNull { it.name.lowercase() == key.removePrefix("root:") }?.let(::Root)
            key == Settings.key -> Settings
            key == Licenses.key -> Licenses
            key == YearDay.key -> YearDay
            key == Calendars.key -> Calendars
            key.startsWith("day:") -> GregorianDate.parseOrNull(key.removePrefix("day:"))?.let(::Day)
            key.startsWith("calendar:") -> CalendarMode.fromIdOrNull(key.removePrefix("calendar:"))
                ?.takeIf { it != CalendarMode.YEAR }?.let(::Calendar)
            key.startsWith("event:") -> decode(key.removePrefix("event:"))?.takeIf { it.isNotEmpty() }?.let(::Event)
            key.startsWith("editor:") -> decode(key.removePrefix("editor:"))?.takeIf { it.isNotEmpty() }?.let(::EventEditor)
            else -> null
        }

        private fun encode(text: String): String = URLEncoder.encode(text, "UTF-8")

        private fun decode(text: String): String? = try {
            URLDecoder.decode(text, "UTF-8")
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}

/**
 * What the event editor opens on, as the [Route.EventEditor] draft key. The editor (task D6)
 * parses the key with [parse]; nothing else reads it.
 */
sealed interface EditorTarget {
    val draftKey: String

    /**
     * A new event on [date]; [minute] is the start chosen on a timeline (Day placeholder, Week drag),
     * `null` for the default start (next whole hour today, else 09:00, §2.4).
     */
    data class New(val date: GregorianDate, val minute: Int? = null) : EditorTarget {
        init {
            require(minute == null || minute in 0 until 1440) { "minute $minute" }
        }

        override val draftKey: String
            get() = if (minute == null) "new:${date.isoString}" else "new:${date.isoString}T${minute / 60}:${minute % 60}"
    }

    /** An edit of the occurrence [occurrenceKey]. */
    data class Edit(val occurrenceKey: String) : EditorTarget {
        override val draftKey: String get() = "edit:$occurrenceKey"
    }

    /** "Duplicate" (§2.10): an unsaved draft copied from [occurrenceKey], optionally moved to [date]. */
    data class Duplicate(val occurrenceKey: String, val date: GregorianDate? = null) : EditorTarget {
        override val draftKey: String get() = "duplicate:${date?.isoString ?: ""}:$occurrenceKey"
    }

    /** "Edit alerts" (§2.10): only the alerts of [occurrenceKey]. */
    data class Alerts(val occurrenceKey: String) : EditorTarget {
        override val draftKey: String get() = "alerts:$occurrenceKey"
    }

    companion object {
        /** The target of a draft key, or `null` for a key this version does not know. */
        fun parse(draftKey: String): EditorTarget? {
            val colon = draftKey.indexOf(':')
            if (colon <= 0) return null
            val value = draftKey.substring(colon + 1)
            return when (draftKey.substring(0, colon)) {
                "new" -> {
                    val t = value.indexOf('T')
                    val date = GregorianDate.parseOrNull(if (t < 0) value else value.substring(0, t)) ?: return null
                    if (t < 0) {
                        New(date)
                    } else {
                        val parts = value.substring(t + 1).split(':')
                        val hour = parts.getOrNull(0)?.toIntOrNull() ?: return null
                        val minute = parts.getOrNull(1)?.toIntOrNull() ?: return null
                        if (hour !in 0..23 || minute !in 0..59) return null
                        New(date, hour * 60 + minute)
                    }
                }
                "edit" -> value.takeIf { it.isNotEmpty() }?.let(::Edit)
                "alerts" -> value.takeIf { it.isNotEmpty() }?.let(::Alerts)
                "duplicate" -> {
                    val second = value.indexOf(':')
                    if (second < 0) return null
                    val dateText = value.substring(0, second)
                    val key = value.substring(second + 1).takeIf { it.isNotEmpty() } ?: return null
                    val date = if (dateText.isEmpty()) null else GregorianDate.parseOrNull(dateText) ?: return null
                    Duplicate(key, date)
                }
                else -> null
            }
        }
    }
}

/** [Route.EventEditor] for [target]. */
fun Route.Companion.editor(target: EditorTarget): Route.EventEditor = Route.EventEditor(target.draftKey)
