package com.haugas.thirteen.navigation

import android.content.res.Resources
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.KeyboardShortcutInfo
import com.haugas.thirteen.R

/**
 * A hardware keyboard command (tablets, foldables and Chromebooks with a keyboard): the Apple app's
 * Go menu (apple/Shared/App/ThirteenCommands.swift, with Ctrl for the Command key), the day
 * sheet's Option-arrow stepping (Alt here) and the Calendar keys of docs/EVENTS.md §2.21 (the
 * Windows column, which uses Ctrl like this app). MainActivity routes key presses here before the
 * view hierarchy, except while a text field has focus (the event editor's Title, Location and
 * Notes, the converter's input: Ctrl+arrows move by word there) and while the event editor is on
 * top of the section ([ThirteenAppState.shortcutsPaused]): no shortcut changes the calendar under
 * the editor or closes it without its discard question (§2.11).
 *
 * | Keys | Command |
 * |---|---|
 * | Ctrl+T | In the Calendar, today in its mode; elsewhere Today, with the other screens back on today |
 * | Ctrl+Left, Ctrl+Right | Previous or next period of the Calendar's mode (Year: a year) or the Compare year; from elsewhere it opens the Calendar |
 * | Ctrl+1 to Ctrl+5 | Today, Calendar, Convert, Compare, History |
 * | Ctrl+Shift+1 to Ctrl+Shift+5 | Day, Week, Month, Year, List for the selected date (Week opens Day on compact widths) |
 * | Ctrl+N | New event (while the Calendar shows events) |
 * | Alt+Left, Alt+Right | Previous or next day in the day comparison on screen |
 *
 * Esc is not a [Shortcut]: MainActivity gives it to the view hierarchy first, and when nothing there
 * takes it, it closes what Back closes on top of a section (the editor, asking before it discards,
 * details, the Calendars list, a comparison, Settings; [ThirteenAppState.escapeCloses]), never a mode
 * or a section.
 */
enum class Shortcut(val keyCode: Int, val modifier: Int) {
    TODAY(KeyEvent.KEYCODE_T, KeyEvent.META_CTRL_ON),
    PREVIOUS_PERIOD(KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.META_CTRL_ON),
    NEXT_PERIOD(KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.META_CTRL_ON),
    SHOW_TODAY(KeyEvent.KEYCODE_1, KeyEvent.META_CTRL_ON),
    SHOW_CALENDAR(KeyEvent.KEYCODE_2, KeyEvent.META_CTRL_ON),
    SHOW_CONVERT(KeyEvent.KEYCODE_3, KeyEvent.META_CTRL_ON),
    SHOW_COMPARE(KeyEvent.KEYCODE_4, KeyEvent.META_CTRL_ON),
    SHOW_HISTORY(KeyEvent.KEYCODE_5, KeyEvent.META_CTRL_ON),
    MODE_DAY(KeyEvent.KEYCODE_1, KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON),
    MODE_WEEK(KeyEvent.KEYCODE_2, KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON),
    MODE_MONTH(KeyEvent.KEYCODE_3, KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON),
    MODE_YEAR(KeyEvent.KEYCODE_4, KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON),
    MODE_LIST(KeyEvent.KEYCODE_5, KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON),
    NEW_EVENT(KeyEvent.KEYCODE_N, KeyEvent.META_CTRL_ON),
    PREVIOUS_DAY(KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.META_ALT_ON),
    NEXT_DAY(KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.META_ALT_ON),
    ;

    /** The section a Ctrl+digit shortcut shows, or `null`. */
    val section: Section?
        get() = when (this) {
            SHOW_TODAY -> Section.TODAY
            SHOW_CALENDAR -> Section.CALENDAR
            SHOW_CONVERT -> Section.CONVERT
            SHOW_COMPARE -> Section.COMPARE
            SHOW_HISTORY -> Section.HISTORY
            else -> null
        }

    /** The Calendar mode a Ctrl+Shift+digit shortcut shows, or `null`. */
    val mode: CalendarMode?
        get() = when (this) {
            MODE_DAY -> CalendarMode.DAY
            MODE_WEEK -> CalendarMode.WEEK
            MODE_MONTH -> CalendarMode.MONTH
            MODE_YEAR -> CalendarMode.YEAR
            MODE_LIST -> CalendarMode.LIST
            else -> null
        }

    companion object {
        /**
         * The shortcut of a key with these modifiers: exactly one of Ctrl and Alt (either side),
         * Shift only with Ctrl (the mode keys), and no Meta or Fn, so system combinations pass through.
         */
        fun of(keyCode: Int, metaState: Int): Shortcut? {
            val ctrl = metaState and KeyEvent.META_CTRL_ON != 0
            val alt = metaState and KeyEvent.META_ALT_ON != 0
            val shift = metaState and KeyEvent.META_SHIFT_ON != 0
            val others = KeyEvent.META_META_ON or KeyEvent.META_FUNCTION_ON or KeyEvent.META_SYM_ON
            if (ctrl == alt || metaState and others != 0 || (shift && !ctrl)) return null
            val modifier = (if (ctrl) KeyEvent.META_CTRL_ON else KeyEvent.META_ALT_ON) or (if (shift) KeyEvent.META_SHIFT_ON else 0)
            return entries.firstOrNull { it.keyCode == keyCode && it.modifier == modifier }
        }

        fun of(event: KeyEvent): Shortcut? = of(event.keyCode, event.metaState)

        /** The shortcuts for the system's keyboard shortcuts list (Meta+/), in the app's words. */
        fun groups(resources: Resources): List<KeyboardShortcutGroup> {
            fun info(label: Int, shortcut: Shortcut) =
                KeyboardShortcutInfo(resources.getString(label), shortcut.keyCode, shortcut.modifier)
            return listOf(
                KeyboardShortcutGroup(
                    resources.getString(R.string.shortcuts_go),
                    listOf(
                        info(R.string.shortcut_today, TODAY),
                        info(R.string.shortcut_previous_period, PREVIOUS_PERIOD),
                        info(R.string.shortcut_next_period, NEXT_PERIOD),
                    ),
                ),
                KeyboardShortcutGroup(
                    resources.getString(R.string.shortcuts_sections),
                    listOf(
                        info(R.string.section_today, SHOW_TODAY),
                        info(R.string.nav_calendar, SHOW_CALENDAR),
                        info(R.string.section_convert, SHOW_CONVERT),
                        info(R.string.section_compare, SHOW_COMPARE),
                        info(R.string.section_history, SHOW_HISTORY),
                    ),
                ),
                KeyboardShortcutGroup(
                    resources.getString(R.string.shortcuts_calendar),
                    listOf(
                        info(R.string.calendar_mode_day, MODE_DAY),
                        info(R.string.calendar_mode_week, MODE_WEEK),
                        info(R.string.calendar_mode_month, MODE_MONTH),
                        info(R.string.calendar_mode_year, MODE_YEAR),
                        info(R.string.calendar_mode_list, MODE_LIST),
                        info(R.string.shortcut_new_event, NEW_EVENT),
                    ),
                ),
                KeyboardShortcutGroup(
                    resources.getString(R.string.shortcuts_day),
                    listOf(
                        info(R.string.previous_day, PREVIOUS_DAY),
                        info(R.string.next_day, NEXT_DAY),
                    ),
                ),
            )
        }
    }
}
