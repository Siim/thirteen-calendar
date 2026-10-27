package com.haugas.thirteen.feature.events

import android.content.Context
import androidx.core.content.edit
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.DateStyle
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.NameStyle
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.ThirteenSlot
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.core.inSlot
import com.haugas.thirteen.core.sameSlotInYearOrPrevious
import com.haugas.thirteen.feature.calendar.EventDates
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType
import java.time.Instant
import java.time.ZoneOffset

// The 13-month date field (docs/EVENTS.md §2.12): the closed button with the system's short name
// and the Gregorian caption, and the picker sheet with the 13-month and Gregorian tabs, the year
// stepper, the slot strip, the grid (a list of days at font scale 1.5 and above) and the footer
// with the other calendar's date. In the editor the range is 1583 to 9999 (§3.1.1).

/** The editor's earliest and latest dates (§3.1.1, §2.12 Range). */
object EditorRange {
    val first: GregorianDate = GregorianDate(1583, 1, 1)
    val last: GregorianDate = GregorianDate(9999, 12, 31)
}

private val MEDIUM_WEEKDAY = FormatOptions(style = DateStyle.MEDIUM, includeWeekday = true)
private val LONG_WEEKDAY = FormatOptions(style = DateStyle.LONG, includeWeekday = true)
private val LONG_NO_YEAR = FormatOptions(style = DateStyle.LONG, includeYear = false, includeWeekday = true)
private val GREGORIAN_SHORT = FormatOptions(style = DateStyle.SHORT, includeWeekday = true)

/** The closed button's text: "IFC Thu, Oct 12, 2026", or "Year Day 2026" (`editor.dateButton`). */
fun dateButtonText(date: GregorianDate, system: CalendarSystemId, resources: android.content.res.Resources): String =
    when (val t = ThirteenDate.of(date, system)) {
        is ThirteenMonthDate -> resources.getString(R.string.editor_dateButton, system.shortName, t.formatted(MEDIUM_WEEKDAY))
        is ThirteenIntercalaryDate -> t.formatted(FormatOptions.LONG)
    }

/** The accessible name of a date button (`editor.dateButton.a11y`). */
fun dateButtonLabel(field: String, date: GregorianDate, system: CalendarSystemId, resources: android.content.res.Resources): String =
    when (val t = ThirteenDate.of(date, system)) {
        is ThirteenMonthDate -> resources.getString(R.string.editor_dateButton_a11y, field, system.shortName, t.formatted(LONG_WEEKDAY), EventDates.gregorianLong(date))
        is ThirteenIntercalaryDate -> resources.getString(R.string.editor_dateButton_a11y_intercalary, field, t.formatted(FormatOptions.LONG), EventDates.gregorianLong(date))
    }

/**
 * A pill button of the date row (the date, or the time). While it carries an issue ([error]) it can
 * take focus in touch mode too, so Save moves focus to it (§2.11 Validation; a clickable is otherwise
 * focusable only with a keyboard), and the focus brings it into view.
 */
@Composable
fun FieldPill(text: String, label: String, onClick: () -> Unit, error: Boolean, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val colors = Thirteen.colors
    Box(
        modifier
            .heightIn(min = 48.dp)
            .border(BorderStroke(1.dp, if (error) MaterialTheme.colorScheme.error else colors.rule), RoundedCornerShape(10.dp))
            .background(if (error) MaterialTheme.colorScheme.error.copy(alpha = 0.08f) else colors.paperRaised, RoundedCornerShape(10.dp))
            .focusProperties { if (error) canFocus = true }
            .clickable(enabled = enabled, onClickLabel = null, role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = label }
            .padding(horizontal = Spacing.m, vertical = Spacing.s),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = if (error) MaterialTheme.colorScheme.error else colors.ink, maxLines = 2)
    }
}

/** The time picker of a date row (§2.12 Time field): Material's time picker in the OS 12 or 24-hour form. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimePickerDialog(title: String, minute: Int, use24Hour: Boolean, onDismiss: () -> Unit, onPick: (Int) -> Unit) {
    val state = rememberTimePickerState(initialHour = (minute % 1440) / 60, initialMinute = minute % 60, is24Hour = use24Hour)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { TimePicker(state = state) },
        confirmButton = { TextButton(onClick = { onPick(state.hour * 60 + state.minute) }) { Text(LocalResources.current.getString(R.string.picker_done)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(LocalResources.current.getString(R.string.editor_cancel)) } },
    )
}

/** The picker's tabs (§2.12): the selected system's, or Gregorian. The last one used is remembered on this device. */
enum class PickerTab { THIRTEEN, GREGORIAN }

/** The tab the picker opens on: the one last used on this device (first time: the 13-month tab). */
object PickerTabMemory {
    private const val FILE = "thirteen_picker"
    private const val KEY = "pickerTab"

    fun read(context: Context): PickerTab =
        if (context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null) == "gregorian") PickerTab.GREGORIAN else PickerTab.THIRTEEN

    fun write(context: Context, tab: PickerTab) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit { putString(KEY, if (tab == PickerTab.GREGORIAN) "gregorian" else "thirteen") }
    }
}

/** The slot of a date in its year. */
private fun slotOf(date: ThirteenDate, slots: List<ThirteenSlot>): ThirteenSlot =
    slots.first { s ->
        when (s) {
            is ThirteenSlot.Month -> date is ThirteenMonthDate && date.month == s.month
            is ThirteenSlot.Intercalary -> date is ThirteenIntercalaryDate && date.id == s.id
        }
    }

/** A slot's accessible name (`picker.slot.*`). */
private fun slotLabel(slot: ThirteenSlot, system: CalendarSystemId, resources: android.content.res.Resources): String = when (slot) {
    is ThirteenSlot.Month -> resources.getString(R.string.picker_slot_month, slot.monthInfo.name, slot.month)
    is ThirteenSlot.Intercalary -> {
        val info = system.intercalaryDayInfo(slot.id)
        when {
            system == CalendarSystemId.IFC && slot.id == IntercalaryDayId.LEAP_DAY -> resources.getString(R.string.picker_slot_leapDay)
            system == CalendarSystemId.IFC -> resources.getString(R.string.picker_slot_yearDay)
            info.leapOnly -> resources.getString(R.string.picker_slot_festival_leap, info.name)
            else -> resources.getString(R.string.picker_slot_festival, info.name)
        }
    }
}

private fun slotShort(slot: ThirteenSlot, system: CalendarSystemId): String = when (slot) {
    is ThirteenSlot.Month -> slot.monthInfo.shortName
    is ThirteenSlot.Intercalary -> system.intercalaryDayInfo(slot.id).code
}

/** The year a step of the year stepper lands on (§2.12): one year, or the next leap year while the draft repeats on its leap-only day. */
internal fun stepPickerYear(date: ThirteenDate, delta: Int, leapRepeat: Boolean): Int? {
    var year = date.gregorian.year + delta
    if (leapRepeat && date is ThirteenIntercalaryDate && date.info.leapOnly) {
        while (year in EditorRange.first.year..EditorRange.last.year && !GregorianDate.isLeapYear(year)) year += delta
    }
    return year.takeIf { it in EditorRange.first.year..EditorRange.last.year }
}

/** The caption after a year step (§2.12): the leap-only fallback or the leap repeat's year, or `null`. */
private fun yearCaption(before: ThirteenDate, after: ThirteenDate, leapStep: Boolean, resources: android.content.res.Resources): String? {
    if (before !is ThirteenIntercalaryDate || !before.info.leapOnly) return null
    if (leapStep) return resources.getString(R.string.picker_leapRepeat, before.info.name, after.displayYear)
    if (after is ThirteenIntercalaryDate && after.id == before.id) return null
    val dayAndMonth = when (after) {
        is ThirteenMonthDate -> after.formatted(FormatOptions(style = DateStyle.LONG, includeYear = false))
        is ThirteenIntercalaryDate -> "the ${after.info.name}"
    }
    return resources.getString(R.string.picker_fellBack, after.displayYear, before.info.name, dayAndMonth)
}

/**
 * The 13-month date picker (§2.12) as a bottom sheet (full screen at font scale 1.5 and above).
 * [title] names the field ("Starts"); [leapRepeat] keeps the year stepper to leap years while the
 * draft repeats on its leap-only day. [onDone] gets the chosen Gregorian date.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThirteenDatePickerSheet(
    title: String,
    initial: GregorianDate,
    system: CalendarSystemId,
    today: GregorianDate,
    leapRepeat: Boolean,
    onDismiss: () -> Unit,
    onDone: (GregorianDate) -> Unit,
) {
    val context = LocalContext.current
    val large = LocalDensity.current.fontScale >= 1.5f
    // Fully expanded, so the footer with the other calendar's date and Done is always on screen.
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Thirteen.colors.paper) {
        ThirteenDatePicker(
            title = title,
            initial = initial,
            system = system,
            today = today,
            leapRepeat = leapRepeat,
            large = large,
            initialTab = remember { PickerTabMemory.read(context) },
            onTabChange = { PickerTabMemory.write(context, it) },
            onDone = onDone,
            modifier = if (large) Modifier.fillMaxSize() else Modifier,
        )
    }
}

/** The picker's content (also used in tests without a sheet). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThirteenDatePicker(
    title: String,
    initial: GregorianDate,
    system: CalendarSystemId,
    today: GregorianDate,
    leapRepeat: Boolean,
    large: Boolean,
    initialTab: PickerTab,
    onTabChange: (PickerTab) -> Unit,
    onDone: (GregorianDate) -> Unit,
    modifier: Modifier = Modifier,
) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    var selectedIso by rememberSaveable { mutableStateOf(initial.isoString) }
    var tab by rememberSaveable { mutableStateOf(initialTab) }
    var caption by rememberSaveable { mutableStateOf<String?>(null) }
    val selected = GregorianDate.parse(selectedIso)
    val thirteen = ThirteenDate.of(selected, system)

    Column(modifier.padding(horizontal = Spacing.l).navigationBarsPadding()) {
        Text(
            title,
            style = MaterialTheme.typography.titleLarge,
            color = colors.ink,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.m),
        )
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            PickerTab.entries.forEachIndexed { index, t ->
                SegmentedButton(
                    selected = tab == t,
                    onClick = {
                        tab = t
                        onTabChange(t)
                    },
                    shape = SegmentedButtonDefaults.itemShape(index, PickerTab.entries.size),
                ) { Text(if (t == PickerTab.THIRTEEN) system.shortName else resources.getString(R.string.picker_tab_gregorian)) }
            }
        }
        Spacer(Modifier.size(Spacing.m))
        if (tab == PickerTab.THIRTEEN) {
            YearStepper(thirteen, system, onStep = { delta ->
                val target = stepPickerYear(thirteen, delta, leapRepeat) ?: return@YearStepper
                val leapStep = leapRepeat && thirteen is ThirteenIntercalaryDate && thirteen.info.leapOnly
                val moved = thirteen.sameSlotInYearOrPrevious(target)
                caption = yearCaption(thirteen, moved, leapStep, resources)
                selectedIso = moved.gregorian.coerceIn(EditorRange.first, EditorRange.last).isoString
            })
            SlotStrip(thirteen, system, onSlot = { slot ->
                caption = null
                selectedIso = thirteen.inSlot(slot).gregorian.coerceIn(EditorRange.first, EditorRange.last).isoString
            })
            Spacer(Modifier.size(Spacing.s))
            Box(Modifier.weight(1f, fill = large)) {
                when (thirteen) {
                    is ThirteenIntercalaryDate -> IntercalaryChoice(thirteen)
                    is ThirteenMonthDate -> if (large) {
                        DayList(thirteen, today, onPick = { selectedIso = it.isoString; caption = null })
                    } else {
                        DayGrid(thirteen, today, onPick = { selectedIso = it.isoString; caption = null })
                    }
                }
            }
            caption?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.ink,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = Spacing.s)
                        .background(colors.accentWash, RoundedCornerShape(8.dp))
                        .padding(Spacing.s)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        } else {
            GregorianTab(selected, onPick = { selectedIso = it.isoString; caption = null }, modifier = Modifier.weight(1f, fill = large))
        }
        // Footer: the other calendar's date, and Done (§2.12).
        Row(Modifier.fillMaxWidth().padding(vertical = Spacing.m), verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (tab == PickerTab.THIRTEEN) {
                    resources.getString(R.string.editor_gregorianCaption, EventDates.gregorianLong(selected))
                } else {
                    when (thirteen) {
                        is ThirteenMonthDate -> resources.getString(R.string.editor_thirteenCaption, system.shortName, EventDates.long(thirteen))
                        is ThirteenIntercalaryDate -> EventDates.long(thirteen)
                    }
                },
                style = ThirteenType.mono,
                color = colors.inkSecondary,
                modifier = Modifier.weight(1f),
            )
            androidx.compose.material3.Button(onClick = { onDone(selected) }) { Text(resources.getString(R.string.picker_done)) }
        }
    }
}

/** The adjustable "Year" control (§2.12): swipe up or down with TalkBack, or the arrows. */
@Composable
private fun YearStepper(date: ThirteenDate, system: CalendarSystemId, onStep: (Int) -> Unit) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    val year = date.gregorian.year
    val value = if (system == CalendarSystemId.IFC) year.toString() else resources.getString(R.string.picker_year_positivist, date.displayYear, year)
    Row(
        Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = false) {
                contentDescription = resources.getString(R.string.picker_year)
                stateDescription = value
                progressBarRangeInfo = ProgressBarRangeInfo(year.toFloat(), EditorRange.first.year.toFloat()..EditorRange.last.year.toFloat())
                setProgress { target ->
                    val delta = (target - year).let { if (it > 0) 1 else if (it < 0) -1 else 0 }
                    if (delta != 0) onStep(delta)
                    delta != 0
                }
            },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = { onStep(-1) }, enabled = year > EditorRange.first.year) {
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, contentDescription = resources.getString(R.string.previous_year))
        }
        Text(
            date.displayYear.toString(),
            style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.SemiBold),
            color = colors.ink,
            textAlign = TextAlign.Center,
            modifier = Modifier.weight(1f).clearAndSetSemantics { },
        )
        IconButton(onClick = { onStep(1) }, enabled = year < EditorRange.last.year) {
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = resources.getString(R.string.next_year))
        }
    }
}

/** The slot strip in picker order (`thirteenSlots`), one adjustable control (§2.12). */
@Composable
private fun SlotStrip(date: ThirteenDate, system: CalendarSystemId, onSlot: (ThirteenSlot) -> Unit) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    val slots = remember(date.gregorian.year, system) { ThirteenSlot.allInYear(date.gregorian.year, system) }
    val current = slotOf(date, slots)
    val index = slots.indexOf(current)
    val scroll = rememberScrollState()
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(scroll)
            .semantics {
                contentDescription = resources.getString(R.string.picker_slot)
                stateDescription = slotLabel(current, system, resources)
                progressBarRangeInfo = ProgressBarRangeInfo(index.toFloat(), 0f..(slots.size - 1).toFloat(), steps = slots.size - 2)
                setProgress { target ->
                    val next = (index + if (target > index) 1 else if (target < index) -1 else 0).coerceIn(0, slots.lastIndex)
                    if (next != index) onSlot(slots[next])
                    next != index
                }
            },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        for (slot in slots) {
            val isSelected = slot == current
            val intercalary = slot is ThirteenSlot.Intercalary
            Box(
                Modifier
                    .sizeIn(minWidth = 44.dp, minHeight = 40.dp)
                    .background(
                        when {
                            isSelected -> colors.accent
                            intercalary -> colors.foilWash
                            else -> colors.paperSunk
                        },
                        RoundedCornerShape(8.dp),
                    )
                    .clickable { onSlot(slot) }
                    .clearAndSetSemantics { }
                    .padding(horizontal = Spacing.s),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    slotShort(slot, system),
                    style = MaterialTheme.typography.labelLarge,
                    color = if (isSelected) colors.onAccent else colors.ink,
                )
            }
        }
    }
    LaunchedEffect(index, slots.size) {
        if (slots.size > 1) scroll.animateScrollTo((scroll.maxValue * index / (slots.size - 1)))
    }
}

/** The month's 4 x 7 grid under the two-line weekday header (§2.12, §2.4). */
@Composable
private fun DayGrid(date: ThirteenMonthDate, today: GregorianDate, onPick: (GregorianDate) -> Unit) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    val first = ThirteenMonthDate(date.year, date.month, 1, date.system)
    Column(Modifier.fillMaxWidth()) {
        // Two-line weekday header: the 13-month weekday, and this month's Gregorian weekday of the column.
        Row(Modifier.fillMaxWidth().clearAndSetSemantics { }) {
            for (column in 0 until 7) {
                val day = first.plusDays(column)
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(Weekday.names(NameStyle.NARROW)[(day as ThirteenMonthDate).weekday.value], style = ThirteenType.eyebrow, color = colors.inkSecondary)
                    Text(Weekday.names(NameStyle.NARROW)[day.gregorian.weekday.value], style = ThirteenType.eyebrow.copy(fontSize = 9.sp), color = colors.inkTertiary)
                }
            }
        }
        for (row in 0 until 4) {
            Row(Modifier.fillMaxWidth()) {
                for (column in 0 until 7) {
                    val day = first.plusDays(row * 7 + column) as ThirteenMonthDate
                    val g = day.gregorian
                    val isSelected = day.day == date.day
                    val enabled = g >= EditorRange.first
                    val label = resources.getString(R.string.picker_cell, day.formatted(LONG_NO_YEAR), g.formatted(FormatOptions(style = DateStyle.LONG, includeYear = false, includeWeekday = true))) +
                        if (g == today) ". " + resources.getString(R.string.state_today) else ""
                    Column(
                        Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp)
                            .padding(2.dp)
                            .background(if (isSelected) colors.accent else Color.Transparent, RoundedCornerShape(8.dp))
                            .border(if (g == today && !isSelected) BorderStroke(1.dp, colors.accent) else BorderStroke(0.dp, Color.Transparent), RoundedCornerShape(8.dp))
                            .selectable(selected = isSelected, enabled = enabled, onClick = { onPick(g) })
                            .clearAndSetSemantics {
                                contentDescription = label
                                selected = isSelected
                                if (!enabled) disabled()
                                onClick { onPick(g); true }
                            },
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        val ink = when {
                            isSelected -> colors.onAccent
                            !enabled -> colors.inkTertiary
                            else -> colors.ink
                        }
                        Text(day.day.toString(), style = MaterialTheme.typography.titleMedium, color = ink)
                        Text(g.day.toString(), style = ThirteenType.mono.copy(fontSize = 10.sp), color = if (isSelected) colors.onAccent else colors.inkTertiary)
                    }
                }
            }
        }
    }
}

/** At font scale 1.5 and above the grid becomes a list of the month's 28 days (§2.12, board J4). */
@Composable
private fun DayList(date: ThirteenMonthDate, today: GregorianDate, onPick: (GregorianDate) -> Unit) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    val first = ThirteenMonthDate(date.year, date.month, 1, date.system)
    val state = rememberLazyListState(initialFirstVisibleItemIndex = (date.day - 2).coerceAtLeast(0))
    LazyColumn(state = state, modifier = Modifier.fillMaxWidth()) {
        itemsIndexed((0 until 28).map { first.plusDays(it) as ThirteenMonthDate }) { _, day ->
            val g = day.gregorian
            val isSelected = day.day == date.day
            val enabled = g >= EditorRange.first
            val label = resources.getString(R.string.picker_cell, day.formatted(LONG_NO_YEAR), g.formatted(FormatOptions(style = DateStyle.LONG, includeYear = false, includeWeekday = true))) +
                if (g == today) ". " + resources.getString(R.string.state_today) else ""
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(if (isSelected) colors.accentWash else Color.Transparent)
                    .selectable(selected = isSelected, enabled = enabled, onClick = { onPick(g) })
                    .clearAndSetSemantics {
                        contentDescription = label
                        selected = isSelected
                        if (!enabled) disabled()
                        onClick { onPick(g); true }
                    }
                    .padding(vertical = Spacing.s, horizontal = Spacing.s),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(day.formatted(LONG_NO_YEAR), style = MaterialTheme.typography.titleLarge, color = if (isSelected) colors.accentText else colors.ink)
                    Text(EventDates.gregorianShort(resources, g), style = ThirteenType.mono, color = colors.inkSecondary)
                }
                if (isSelected) Icon(Icons.Outlined.Check, contentDescription = null, tint = colors.accentText)
            }
        }
    }
}

/** An intercalary slot selects its day directly: the badge and its Gregorian date (§2.12). */
@Composable
private fun IntercalaryChoice(date: ThirteenIntercalaryDate) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = Spacing.s)
            .border(BorderStroke(1.dp, colors.foil), RoundedCornerShape(12.dp))
            .background(colors.foilWash, RoundedCornerShape(12.dp))
            .semantics(mergeDescendants = true) { selected = true }
            .padding(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.background(colors.foil, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp)) {
            Text(date.info.code, style = MaterialTheme.typography.labelLarge, color = colors.onFoil)
        }
        Spacer(Modifier.size(Spacing.m))
        Column {
            Text(date.formatted(FormatOptions.LONG), style = MaterialTheme.typography.titleMedium, color = colors.ink)
            Text(
                resources.getString(R.string.picker_noWeekday) + ". " + resources.getString(R.string.editor_gregorianCaption, EventDates.gregorianLong(date.gregorian)),
                style = MaterialTheme.typography.bodySmall,
                color = colors.inkSecondary,
            )
            if (date.info.leapOnly) {
                Text(resources.getString(R.string.picker_leapOnly, date.info.name), style = MaterialTheme.typography.bodySmall, color = colors.inkSecondary)
            }
        }
    }
}

/** The Gregorian tab: the platform's date picker (§2.12), 1583 to 9999. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GregorianTab(selected: GregorianDate, onPick: (GregorianDate) -> Unit, modifier: Modifier = Modifier) {
    val millis = selected.toEpochDay() * 86_400_000L
    val first = EditorRange.first.toEpochDay() * 86_400_000L
    val state = rememberDatePickerState(
        initialSelectedDateMillis = millis,
        yearRange = EditorRange.first.year..EditorRange.last.year,
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean = utcTimeMillis >= first
            override fun isSelectableYear(year: Int): Boolean = year in EditorRange.first.year..EditorRange.last.year
        },
    )
    LaunchedEffect(state.selectedDateMillis) {
        val ms = state.selectedDateMillis ?: return@LaunchedEffect
        val d = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()
        val picked = GregorianDate(d.year, d.monthValue, d.dayOfMonth)
        if (picked != selected) onPick(picked)
    }
    Box(modifier.fillMaxWidth()) {
        DatePicker(state = state, title = null, headline = null, showModeToggle = false, colors = DatePickerDefaults.colors(containerColor = Thirteen.colors.paper))
    }
}

private fun GregorianDate.toEpochDay(): Long = java.time.LocalDate.of(year, month, day).toEpochDay()

private fun GregorianDate.coerceIn(min: GregorianDate, max: GregorianDate): GregorianDate = if (this < min) min else if (this > max) max else this
