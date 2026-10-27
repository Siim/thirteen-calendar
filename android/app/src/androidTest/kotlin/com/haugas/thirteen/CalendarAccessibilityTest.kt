package com.haugas.thirteen

import android.app.UiAutomation
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.provider.CalendarContract
import android.provider.CalendarContract.Events
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.haugas.thirteen.data.calendar.ProviderTestSupport
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The accessibility pass of task D9 on a device (docs/EVENTS.md §2.1, §2.20, §2.21, §8.3 item 3):
 * what TalkBack and Switch Access get from the framework's accessibility tree, read through
 * [UiAutomation] the way an accessibility service reads it, on the mockup data set (debug QA
 * extras, today 2026-10-19, 24-hour time).
 *
 * - The §2.20 names of Month's weekday header, today's cell (with its "Open {title}" actions), the
 *   selected day's rows and Day's column and blocks.
 * - Switch Access paging: the custom actions "Next month" / "Previous month" ("day") on the title
 *   and on the grid's elements, performed through `AccessibilityNodeInfo.performAction`, as Switch
 *   Access and TalkBack's actions menu do.
 * - Font scale 2.0: Month becomes the list of days, whose day headers keep the names and actions.
 * - A hardware keyboard: Ctrl+Right pages, Ctrl+Shift+5 shows List, Ctrl+T goes back to today,
 *   Ctrl+N opens the editor and Esc closes it.
 * - `HANDLE_CUSTOM_EVENT` end to end: a calendar app's "open in Thirteen" on an event in a LOCAL
 *   test calendar opens that event's day (the real provider, no QA extras).
 *
 * The test changes the emulator's font scale and 24-hour setting and restores them after each test.
 * It works only in LOCAL calendars it creates and deletes.
 */
@RunWith(AndroidJUnit4::class)
class CalendarAccessibilityTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val automation: UiAutomation get() = instrumentation.uiAutomation
    private val packageName get() = instrumentation.targetContext.packageName
    private var timeFormat: String? = null

    @Before
    fun setUp() {
        timeFormat = shell("settings get system time_12_24").trim().takeIf { it.isNotEmpty() && it != "null" }
        shell("settings put system time_12_24 24")
        shell("settings put system font_scale 1.0")
        shell("input keyevent KEYCODE_WAKEUP")
        shell("wm dismiss-keyguard")
    }

    @After
    fun tearDown() {
        shell("settings put system font_scale 1.0")
        timeFormat?.let { shell("settings put system time_12_24 $it") } ?: shell("settings delete system time_12_24")
        // Only the custom event test granted access and made a calendar.
        runCatching { ProviderTestSupport.deleteTestCalendars() }
    }

    @Test
    fun monthNamesItsCellsAndPagesFromTheTitleAndTheGrid() {
        launch("thirteen://month/2026/11?system=ifc")
        val title = waitFor("the title") { it.says() == "October 2026. Gregorian Oct 8 to Nov 4." }
        assertTrue(title.customLabels().toString(), title.customLabels().containsAll(listOf("Previous month", "Next month")))
        waitFor("the weekday header") { it.says() == "Sunday. Gregorian Thursday" }
        val today = waitFor("today's cell") { it.says() == "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events." }
        if (Build.VERSION.SDK_INT >= 30) assertEquals("Today", today.stateDescription?.toString())
        val labels = today.customLabels()
        assertTrue(labels.toString(), labels.containsAll(listOf("Open Sprint planning", "Open Dentist, Dr. Tamm", "Previous month", "Next month")))
        // Compact width: the selected day's list row (calendar.row.a11y); expanded width: the cell's chip (calendar.item.a11y).
        waitFor("Sprint planning's row or chip") { it.says() == "09:30, Sprint planning, Work, repeats" || it.says() == "Sprint planning, 09:30 to 10:30, Work, repeats" }

        // Switch Access and TalkBack's actions menu: "Next month" from a grid cell, then from the title.
        perform(today, "Next month")
        val november = waitFor("November") { it.says() == "November 2026. Gregorian Nov 5 to Dec 2." }
        perform(november, "Previous month")
        waitFor("October again") { it.says() == "October 2026. Gregorian Oct 8 to Nov 4." }
    }

    @Test
    fun dayNamesItsColumnAndBlocksAndPagesByADay() {
        launch("thirteen://day/2026-10-19?system=ifc")
        val column = waitFor("Day's column") { it.says() == "Thursday, October 12. Gregorian Monday, October 19" }
        assertEquals(listOf("New event", "Previous day", "Next day"), column.customLabels().filter { it in setOf("New event", "Previous day", "Next day") })
        waitFor("a block") { it.says() == "Dentist, Dr. Tamm, 15:40 to 16:20, Home" }
        perform(column, "Next day")
        waitFor("the next day's column") { it.says() == "Friday, October 13. Gregorian Tuesday, October 20" }
    }

    @Test
    fun atFontScale200MonthIsAListOfDays() {
        shell("settings put system font_scale 2.0")
        launch("thirteen://month/2026/11?system=ifc")
        val today = waitFor("today's day header") { it.says() == "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events." }
        // The list of days has no 4 x 7 grid: no weekday header.
        assertTrue(nodes().none { it.says() == "Sunday. Gregorian Thursday" })
        assertTrue(today.customLabels().toString(), today.customLabels().containsAll(listOf("Previous month", "Next month")))
        perform(today, "Next month")
        waitFor("November") { it.says() == "November 2026. Gregorian Nov 5 to Dec 2." }
    }

    @Test
    fun aHardwareKeyboardPagesAndSwitchesModes() {
        launch("thirteen://month/2026/11?system=ifc")
        waitFor("the title") { it.says() == "October 2026. Gregorian Oct 8 to Nov 4." }
        // A keyboard user's first key leaves touch mode: before API 34 the platform spends the first
        // navigation key (an arrow, with or without Ctrl, or Tab) after a touch on that, in every app
        // (ViewRootImpl), so a Tab goes first, as it would on a device in use with a keyboard.
        instrumentation.setInTouchMode(false)
        key(KeyEvent.KEYCODE_TAB, 0)
        SystemClock.sleep(500)
        key(KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON)
        waitFor("November") { it.says() == "November 2026. Gregorian Nov 5 to Dec 2." }
        key(KeyEvent.KEYCODE_5, KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON or KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON)
        waitFor("List") { it.says()?.startsWith("Upcoming") == true }
        key(KeyEvent.KEYCODE_3, KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON or KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON)
        waitFor("Month") { it.says()?.matches(Regex("(October|November) 2026\\. Gregorian .*")) == true }
        key(KeyEvent.KEYCODE_T, KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON)
        waitFor("back on today's month") { it.says() == "October 2026. Gregorian Oct 8 to Nov 4." }
        // Ctrl+N opens the editor on a new event; Esc closes it (nothing typed, so no question).
        key(KeyEvent.KEYCODE_N, KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON)
        waitFor("the editor") { it.says() == "Add" }
        key(KeyEvent.KEYCODE_ESCAPE, 0)
        // Without a hardware keyboard the soft keyboard is up over the title field and takes the
        // first Esc to close itself (API 30); the next one reaches the app.
        SystemClock.sleep(1500)
        if (nodes().any { it.says() == "Add" }) key(KeyEvent.KEYCODE_ESCAPE, 0)
        waitFor("the month after Esc") { it.says() == "October 2026. Gregorian Oct 8 to Nov 4." }
        assertTrue(nodes().none { it.says() == "Add" })
    }

    @Test
    fun aCalendarAppOpensAThirteenEventsDay() {
        ProviderTestSupport.grantCalendarPermissions()
        ProviderTestSupport.deleteTestCalendars()
        val calendar = ProviderTestSupport.createCalendar("Custom event link")
        val start = ProviderTestSupport.ms(2026, 10, 19, 10, 0)
        val id = ProviderTestSupport.insertEvent(
            ProviderTestSupport.timedValues(calendar, "Opened from a calendar app", start, 30).apply {
                put(Events.CUSTOM_APP_PACKAGE, packageName)
                put(Events.CUSTOM_APP_URI, "thirteen://day/2026-10-19")
            },
        )
        val intent = Intent(CalendarContract.ACTION_HANDLE_CUSTOM_EVENT).apply {
            setDataAndType(Uri.parse("content://com.android.calendar/events/$id"), "vnd.android.cursor.item/event")
            putExtra(CalendarContract.EXTRA_CUSTOM_APP_URI, "thirteen://day/2026-10-19")
            setClassName(packageName, "$packageName.MainActivity")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        }
        instrumentation.targetContext.startActivity(intent)
        waitFor("the event's day in Day mode") { it.says() == "Thursday, October 12. Gregorian Monday, October 19" }
        waitFor("the event") { it.says()?.startsWith("Opened from a calendar app, 10:00 to 10:30") == true }
    }

    // --- helpers ---

    private fun shell(command: String): String =
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command)).use { it.readBytes().decodeToString() }

    /** Starts Thirteen on [link] in a new task, with the QA extras (mockup events, today 2026-10-19). */
    private fun launch(link: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link)).apply {
            setClassName(packageName, "$packageName.MainActivity")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            putExtra(QaOptions.EXTRA_TODAY, "2026-10-19")
            putExtra(QaOptions.EXTRA_FAKE_EVENTS, true)
        }
        instrumentation.targetContext.startActivity(intent)
        instrumentation.waitForIdleSync()
    }

    /**
     * Every node of the active window, as an accessibility service sees them. Each node is
     * refreshed from the app: Compose sends its content-change events only while a real
     * accessibility service (TalkBack, Switch Access) is on, so the UiAutomation cache alone would
     * keep a paged title's old name.
     */
    private fun nodes(): List<AccessibilityNodeInfo> {
        val root = automation.rootInActiveWindow ?: return emptyList()
        if (!root.refresh()) return emptyList()
        val out = ArrayList<AccessibilityNodeInfo>()
        val queue = ArrayDeque(listOf(root))
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            out += node
            for (i in 0 until node.childCount) node.getChild(i)?.takeIf { it.refresh() }?.let(queue::addLast)
        }
        return out
    }

    private fun AccessibilityNodeInfo.says(): String? = (contentDescription ?: text)?.toString()?.replace(' ', ' ')?.replace(' ', ' ')

    /** The labels of the node's actions that carry one (Compose's custom actions, labelled clicks). */
    private fun AccessibilityNodeInfo.customLabels(): List<String> = actionList.mapNotNull { it.label?.toString() }

    private fun waitFor(what: String, timeoutMs: Long = 20_000, predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        var last: List<AccessibilityNodeInfo> = emptyList()
        while (SystemClock.uptimeMillis() < deadline) {
            last = runCatching { nodes() }.getOrDefault(emptyList())
            last.firstOrNull(predicate)?.let { return it }
            SystemClock.sleep(250)
        }
        val seen = last.mapNotNull { it.says() }.filter { it.isNotBlank() }.take(80)
        fail("not found: $what. On screen: $seen")
        error("unreachable")
    }

    /** Performs the custom action [label] through the framework, as Switch Access does. */
    private fun perform(node: AccessibilityNodeInfo, label: String) {
        val action = node.actionList.firstOrNull { it.label?.toString() == label } ?: error("no action $label on ${node.says()}: ${node.customLabels()}")
        Log.i(TAG, "performing \"$label\" on \"${node.says()}\"")
        assertTrue("\"$label\" was refused", node.performAction(action.id))
    }

    /** A hardware key with [meta] held, injected as a keyboard would send it. */
    private fun key(keyCode: Int, meta: Int) {
        val now = SystemClock.uptimeMillis()
        assertTrue(automation.injectInputEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0, meta), true))
        assertTrue(automation.injectInputEvent(KeyEvent(now, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, keyCode, 0, meta), true))
        instrumentation.waitForIdleSync()
    }

    private companion object {
        const val TAG = "ThirteenA11yTest"
    }
}
