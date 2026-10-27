package com.haugas.thirteen.data

import com.haugas.thirteen.core.events.CalendarAccountKind
import com.haugas.thirteen.core.events.CalendarInfo

/**
 * "Default calendar" (docs/EVENTS.md §2.15, §2.18): where new events go. The user's choice
 * ([UserSettings.defaultCalendar], a §3.2 reference matched by id, then by account and name) while
 * it is still writable; otherwise, silently, the platform default: Android's primary writable
 * calendar (`isPlatformDefault`), else the first writable one. `null` when nothing is writable.
 */
object DefaultCalendar {
    fun resolve(calendars: List<CalendarInfo>, chosen: CalendarVisibility.Ref?): CalendarInfo? {
        val writable = calendars.filter { it.writable }
        if (chosen != null) {
            writable.firstOrNull { it.id == chosen.id }?.let { return it }
            writable.firstOrNull { it.accountId == chosen.accountId && it.title == chosen.title }?.let { return it }
        }
        return writable.firstOrNull { it.isPlatformDefault } ?: writable.firstOrNull()
    }
}

/**
 * The account groups of the Calendars list (§2.15): grouped by account in the platform's order
 * (iCloud, Google accounts, Exchange, other CalDAV, "On this device", Subscribed, Other), each
 * group's calendars in the order they were read. Every calendar of this device's own accounts
 * (`LOCAL`, among them Thirteen's device calendar) is one group, "On this device".
 */
object CalendarGroups {
    /** One account group. [key] identifies it in [UserSettings.collapsedAccounts]. */
    data class Group(val key: String, val title: String?, val kind: CalendarAccountKind, val calendars: List<CalendarInfo>) {
        /** The calendars of this group shown in Thirteen, given the visible ids. */
        fun shownCount(visibleIds: Set<String>): Int = calendars.count { it.id in visibleIds }
    }

    /** The key of the device group. */
    const val DEVICE_KEY: String = "device"

    private fun order(kind: CalendarAccountKind): Int = when (kind) {
        CalendarAccountKind.ICLOUD -> 0
        CalendarAccountKind.GOOGLE -> 1
        CalendarAccountKind.EXCHANGE -> 2
        CalendarAccountKind.CALDAV -> 3
        CalendarAccountKind.DEVICE -> 4
        CalendarAccountKind.SUBSCRIBED -> 5
        CalendarAccountKind.BIRTHDAYS, CalendarAccountKind.OTHER -> 6
    }

    /**
     * The groups of [calendars]. A group's kind is its first calendar's that is not a birthday
     * calendar (Google's contacts birthdays sit in the Google account); [Group.title] is the account
     * name, or `null` for the device group (the list says "On this device").
     */
    fun of(calendars: List<CalendarInfo>): List<Group> {
        val byKey = LinkedHashMap<String, MutableList<CalendarInfo>>()
        for (calendar in calendars) {
            val key = if (calendar.accountKind == CalendarAccountKind.DEVICE) DEVICE_KEY else calendar.accountId
            byKey.getOrPut(key) { ArrayList() } += calendar
        }
        val groups = byKey.map { (key, list) ->
            val kind = list.firstOrNull { it.accountKind != CalendarAccountKind.BIRTHDAYS }?.accountKind ?: list.first().accountKind
            Group(key, if (key == DEVICE_KEY) null else list.first().accountTitle, kind, list)
        }
        // A stable sort keeps the read order among accounts of one kind.
        return groups.sortedBy { order(it.kind) }
    }
}
