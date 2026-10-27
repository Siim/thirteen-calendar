package com.haugas.thirteen.feature.events

import android.content.res.Resources
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.CalendarAccountKind
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.Frequency
import com.haugas.thirteen.core.events.PresetSection
import com.haugas.thirteen.core.events.RRule
import com.haugas.thirteen.core.events.RepeatPreset
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.ThirteenRepeats
import com.haugas.thirteen.core.events.WeekdayNum
import com.haugas.thirteen.core.events.alarmPresets
import com.haugas.thirteen.core.events.describe
import com.haugas.thirteen.core.events.describeAlarm
import com.haugas.thirteen.core.events.describeNext
import com.haugas.thirteen.core.events.repeatNotes
import com.haugas.thirteen.data.CalendarGroups
import com.haugas.thirteen.data.calendar.RecurrenceStorage
import com.haugas.thirteen.data.calendar.StorageNote
import com.haugas.thirteen.data.calendar.StoredForm
import com.haugas.thirteen.feature.calendar.calendarColor
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

// The editor's pushed lists (docs/EVENTS.md §2.13 to §2.15): the repeat picker with its "Next:"
// line, notes and Android storage notes under the selected row, the custom repeat (Gregorian
// only), the two alert pickers, and the calendar picker. They push inside the editor's dialog,
// so Back returns to the form.

/** The text of an Android storage note (§2.13). */
fun storageNoteText(resources: Resources, note: StorageNote): String = when (note) {
    is StorageNote.Horizon -> resources.getString(R.string.repeat_note_androidHorizon, note.year)
    is StorageNote.HorizonInvitees -> resources.getString(R.string.repeat_note_androidHorizon_invitees, note.year)
    StorageNote.HorizonCapped -> resources.getString(R.string.repeat_note_androidHorizon_capped)
    StorageNote.ReencodeFirstOnly -> resources.getString(R.string.repeat_note_androidReencode_firstOnly)
}

/** "{name} ({account kind})" (`repeat.calendarWithKind`): "Work (Exchange)"; the name alone for an account kind without a name. */
fun calendarWithKind(resources: Resources, calendar: CalendarInfo): String =
    EditorState.accountKindName(calendar.accountKind)?.let { resources.getString(R.string.repeat_calendarWithKind, calendar.title, it) } ?: calendar.title

/** The note of a calendar that cannot keep 13-month repeats (§2.13, `repeat.note.exchange`). */
fun exchangeNote(resources: Resources, calendar: CalendarInfo, calendars: List<CalendarInfo>): String {
    val kinds = EditorState.kindsKeepingRepeats(calendars).map {
        when (it) {
            CalendarAccountKind.ICLOUD -> resources.getString(R.string.repeat_kind_icloud)
            CalendarAccountKind.GOOGLE -> resources.getString(R.string.repeat_kind_google)
            CalendarAccountKind.CALDAV -> resources.getString(R.string.repeat_kind_caldav)
            else -> resources.getString(R.string.repeat_kind_device)
        }
    }
    val name = calendarWithKind(resources, calendar)
    return when (kinds.size) {
        0 -> resources.getString(R.string.repeat_note_exchange_none, name)
        1 -> resources.getString(R.string.repeat_note_exchange, name, kinds[0])
        2 -> resources.getString(R.string.repeat_note_exchange, name, resources.getString(R.string.repeat_list_or_two, kinds[0], kinds[1]))
        else -> resources.getString(
            R.string.repeat_note_exchange,
            name,
            resources.getString(R.string.repeat_list_or_three, kinds.dropLast(2).joinToString(", "), kinds[kinds.size - 2], kinds.last()),
        )
    }
}

/** An eyebrow section header of a picker list. */
@Composable
fun PickerHeader(text: String) {
    Text(
        text.uppercase(),
        style = ThirteenType.eyebrow,
        color = Thirteen.colors.inkTertiary,
        modifier = Modifier.padding(start = Spacing.l, end = Spacing.l, top = Spacing.l, bottom = Spacing.xs).semantics { heading() },
    )
}

/** A section footer of a picker list. */
@Composable
fun PickerFooter(text: String, error: Boolean = false) {
    Row(Modifier.padding(horizontal = Spacing.l, vertical = Spacing.xs)) {
        if (error) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(16.dp).padding(top = 2.dp))
            Spacer(Modifier.width(Spacing.xs))
        }
        Text(text, style = MaterialTheme.typography.bodySmall, color = Thirteen.colors.inkSecondary)
    }
}

/** A selectable picker row: its label, a check when selected, and the lines under it when selected. */
@Composable
fun PickerRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    enabled: Boolean = true,
    lines: List<String> = emptyList(),
    trailingArrow: Boolean = false,
    leading: (@Composable () -> Unit)? = null,
) {
    val colors = Thirteen.colors
    Column(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = Spacing.l, vertical = Spacing.m),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (leading != null) {
                leading()
                Spacer(Modifier.width(Spacing.m))
            }
            Text(
                label,
                style = MaterialTheme.typography.bodyLarge,
                color = when {
                    !enabled -> colors.inkTertiary
                    selected -> colors.accentText
                    else -> colors.ink
                },
                modifier = Modifier.weight(1f),
            )
            if (selected) Icon(Icons.Outlined.Check, contentDescription = null, tint = colors.accentText)
            if (trailingArrow) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = colors.inkTertiary)
        }
        if (selected) {
            for ((i, line) in lines.withIndex()) {
                Text(
                    line,
                    style = if (i == 0 && line.startsWith("Next:")) ThirteenType.mono else MaterialTheme.typography.bodySmall,
                    color = if (i == 0 && line.startsWith("Next:")) colors.accentText else colors.inkSecondary,
                    modifier = Modifier.padding(top = Spacing.xs),
                )
            }
        }
    }
}

/**
 * The repeat picker (§2.13): Never, the Gregorian presets, the selected system's presets (the
 * intercalary day's one row on an intercalary start), Custom, and "Keep: ..." for a repeat set in
 * another app. The selected row shows the "Next:" line, core's notes and the Android storage note.
 */
@Composable
fun RepeatPickerPage(state: EditorState, onPick: (EventRecurrence?) -> Unit, onKeep: () -> Unit, onCustom: () -> Unit, contentPadding: PaddingValues) {
    val resources = LocalResources.current
    val system = state.env.system
    val draft = state.draft
    val start = draft.start.date
    val presets = remember(start, system) { RepeatPreset.all(start, system) }
    val calendar = state.calendar
    val gregorianOnly = calendar?.thirteenRepeats == ThirteenRepeats.GREGORIAN_ONLY
    val keep = state.keepsForeignRule
    val selectedId = if (keep) null else safe { RepeatPreset.match(draft.recurrence, start, system) }
    val custom = !keep && selectedId == null && draft.recurrence != null
    val storage = state.storageNote

    fun linesFor(recurrence: EventRecurrence?): List<String> {
        if (recurrence == null) return emptyList()
        val withEnd = recurrence
        return buildList {
            safe { withEnd.describeNext(start, system) }?.takeIf { it.isNotEmpty() }?.let(::add)
            safe { withEnd.repeatNotes(start, system, gregorianOnly) }?.let(::addAll)
            storage?.let { add(storageNoteText(resources, it)) }
        }
    }

    LazyColumn(contentPadding = contentPadding) {
        if (state.offersKeep) {
            item {
                val description = state.opened.recurrence?.let { safe { it.describe(start, system) } } ?: resources.getString(R.string.repeat_customUnknown)
                PickerRow(resources.getString(R.string.repeat_keep, description), selected = keep, onClick = onKeep, lines = if (keep) linesFor(draft.recurrence) else emptyList())
                HorizontalDivider(color = Thirteen.colors.ruleSoft)
            }
        }
        item {
            PickerRow(resources.getString(R.string.repeat_never), selected = selectedId == "never", onClick = { onPick(null) })
        }
        item { PickerHeader(resources.getString(R.string.repeat_section_gregorian)) }
        items(presets.filter { it.section == PresetSection.GREGORIAN }, key = { it.id }) { preset ->
            val selected = preset.id == selectedId
            PickerRow(preset.label, selected, onClick = { onPick(preset.recurrence) }, lines = if (selected) linesFor(draft.recurrence) else emptyList())
        }
        item { PickerFooter(resources.getString(R.string.repeat_section_gregorian_footer)) }
        item { PickerHeader(system.fullName) }
        items(presets.filter { it.section == PresetSection.THIRTEEN }, key = { it.id }) { preset ->
            val selected = preset.id == selectedId
            val enabled = !gregorianOnly || preset.exchangeSafe
            PickerRow(preset.label, selected, enabled = enabled, onClick = { onPick(preset.recurrence) }, lines = if (selected) linesFor(draft.recurrence) else emptyList())
        }
        item {
            if (gregorianOnly && calendar != null) {
                // §2.13: on a calendar that cannot keep 13-month repeats the section footer is the
                // Exchange note in place of the 28-day sentence (as on Apple, RepeatPickerLogic.thirteenFooter).
                PickerFooter(exchangeNote(resources, calendar, state.calendars), error = state.repeatNotAllowed)
            } else {
                val details = state.details
                // The platform sentence (§2.13): only for the current row of an Apple-made BYYEARDAY series (V3 is not run).
                val currentByYearDayRow = details?.storedForm == StoredForm.BYYEARDAY && draft.recurrence == state.opened.recurrence
                val sentence = RecurrenceStorage.footerSentence(currentByYearDayRow)?.let { resources.getString(R.string.repeat_footer_appleGoogleAndroid) }
                PickerFooter(listOfNotNull(resources.getString(R.string.repeat_section_thirteen_footer), sentence).joinToString(" "))
            }
        }
        item {
            HorizontalDivider(color = Thirteen.colors.ruleSoft)
            PickerRow(resources.getString(R.string.repeat_custom), selected = custom, onClick = onCustom, trailingArrow = !custom, lines = if (custom) listOf(state.repeatDescription("")) + linesFor(draft.recurrence) else emptyList())
        }
    }
}

private inline fun <T> safe(block: () -> T): T? = try {
    block()
} catch (_: ThirteenException) {
    null
}

/** The frequencies of the custom repeat (§2.13). */
private val FREQUENCIES = listOf(Frequency.DAILY, Frequency.WEEKLY, Frequency.MONTHLY, Frequency.YEARLY)

/**
 * The custom repeat (§2.13, Gregorian only): Frequency, "Every {n}" (1 to 99), weekday toggles
 * (weekly), "Each" days or "On the" (monthly), months and an optional "On the" (yearly). The live
 * description, "Next:" line and notes update as the user edits; [onApply] sets the repeat.
 */
@Composable
fun CustomRepeatPage(state: EditorState, onApply: (EventRecurrence) -> Unit, contentPadding: PaddingValues) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    val start = state.draft.start.date
    val existing = (state.draft.recurrence?.rule as? RepeatRule.Rrule)?.rrule
    var freq by rememberSaveable { mutableStateOf(existing?.freq ?: Frequency.WEEKLY) }
    var interval by rememberSaveable { mutableIntStateOf(existing?.interval ?: 1) }
    var weekdays by rememberSaveable { mutableStateOf(existing?.byDay?.filter { it.ordinal == null }?.map { it.weekday.value }?.toSet()?.takeIf { it.isNotEmpty() } ?: setOf(start.weekday.value)) }
    var monthDays by rememberSaveable { mutableStateOf(existing?.byMonthDay?.filter { it > 0 }?.toSet()?.takeIf { it.isNotEmpty() } ?: setOf(start.day)) }
    var onThe by rememberSaveable { mutableStateOf(false) }
    var ordinal by rememberSaveable { mutableIntStateOf(0) }
    // 0..6 a weekday, 7 day, 8 weekday, 9 weekend day.
    var dayKind by rememberSaveable { mutableIntStateOf(start.weekday.value) }
    var months by rememberSaveable { mutableStateOf(existing?.byMonth?.toSet()?.takeIf { it.isNotEmpty() } ?: setOf(start.month)) }

    val rule: RRule? = safe {
        val ord = if (ordinal == 5) -1 else ordinal + 1
        fun onTheParts(): Triple<List<WeekdayNum>, List<Int>, List<Int>> = when (dayKind) {
            7 -> Triple(emptyList(), listOf(ord), emptyList())
            8 -> Triple(listOf(Weekday.MONDAY, Weekday.TUESDAY, Weekday.WEDNESDAY, Weekday.THURSDAY, Weekday.FRIDAY).map { WeekdayNum(it) }, emptyList(), listOf(ord))
            9 -> Triple(listOf(Weekday.SATURDAY, Weekday.SUNDAY).map { WeekdayNum(it) }, emptyList(), listOf(ord))
            else -> Triple(listOf(WeekdayNum(Weekday.of(dayKind), ord)), emptyList(), emptyList())
        }
        when (freq) {
            Frequency.DAILY -> RRule(Frequency.DAILY, interval = interval)
            Frequency.WEEKLY -> RRule(Frequency.WEEKLY, interval = interval, byDay = weekdays.sorted().map { WeekdayNum(Weekday.of(it)) })
            Frequency.MONTHLY -> if (onThe) {
                val (byDay, byMonthDay, setPos) = onTheParts()
                RRule(Frequency.MONTHLY, interval = interval, byDay = byDay, byMonthDay = byMonthDay, bySetPos = setPos)
            } else {
                RRule(Frequency.MONTHLY, interval = interval, byMonthDay = monthDays.sorted())
            }
            else -> if (onThe) {
                val (byDay, byMonthDay, setPos) = onTheParts()
                RRule(Frequency.YEARLY, interval = interval, byMonth = months.sorted(), byDay = byDay, byMonthDay = byMonthDay, bySetPos = setPos)
            } else {
                RRule(Frequency.YEARLY, interval = interval, byMonth = months.sorted(), byMonthDay = listOf(start.day))
            }
        }
    }
    val recurrence = rule?.let { EventRecurrence(RepeatRule.Rrule(it), end = state.draft.recurrence?.end ?: com.haugas.thirteen.core.events.RepeatEnd.Never) }

    LazyColumn(contentPadding = contentPadding) {
        item {
            Text(
                recurrence?.let { safe { it.describe(start, state.env.system) } } ?: "",
                style = MaterialTheme.typography.titleMedium,
                color = colors.ink,
                modifier = Modifier.padding(Spacing.l).semantics { liveRegion = LiveRegionMode.Polite },
            )
            recurrence?.let { r ->
                val lines = listOfNotNull(safe { r.describeNext(start, state.env.system) }?.takeIf { it.isNotEmpty() }) + (safe { r.repeatNotes(start, state.env.system) } ?: emptyList())
                lines.forEach { PickerFooter(it) }
            }
        }
        item {
            PickerHeader(resources.getString(R.string.repeat_custom_frequency))
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = Spacing.l)) {
                val labels = listOf(R.string.repeat_custom_daily, R.string.repeat_custom_weekly, R.string.repeat_custom_monthly, R.string.repeat_custom_yearly)
                FREQUENCIES.forEachIndexed { i, f ->
                    SegmentedButton(selected = freq == f, onClick = { freq = f }, shape = SegmentedButtonDefaults.itemShape(i, FREQUENCIES.size)) {
                        Text(resources.getString(labels[i]), maxLines = 1)
                    }
                }
            }
        }
        item {
            PickerHeader(resources.getString(R.string.repeat_custom_every))
            Row(Modifier.padding(horizontal = Spacing.l), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { interval = (interval - 1).coerceAtLeast(1) }, enabled = interval > 1) {
                    Text("\u2212", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { contentDescription = resources.getString(R.string.repeat_custom_fewer) })
                }
                val unit = when (freq) {
                    Frequency.DAILY -> R.plurals.repeat_custom_unit_days
                    Frequency.WEEKLY -> R.plurals.repeat_custom_unit_weeks
                    Frequency.MONTHLY -> R.plurals.repeat_custom_unit_months
                    else -> R.plurals.repeat_custom_unit_years
                }
                Text(resources.getQuantityString(unit, interval, interval), style = MaterialTheme.typography.bodyLarge, color = colors.ink, modifier = Modifier.padding(horizontal = Spacing.m))
                IconButton(onClick = { interval = (interval + 1).coerceAtMost(99) }, enabled = interval < 99) {
                    Icon(Icons.Outlined.Add, contentDescription = resources.getString(R.string.repeat_custom_more))
                }
            }
        }
        when (freq) {
            Frequency.WEEKLY -> item {
                FlowRow(Modifier.padding(horizontal = Spacing.l, vertical = Spacing.s), horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    for (d in 0..6) {
                        val on = d in weekdays
                        ToggleChip(Weekday.of(d).displayName(com.haugas.thirteen.core.NameStyle.SHORT), on) {
                            weekdays = if (on && weekdays.size > 1) weekdays - d else weekdays + d
                        }
                    }
                }
            }
            Frequency.MONTHLY, Frequency.YEARLY -> {
                if (freq == Frequency.YEARLY) {
                    item {
                        FlowRow(Modifier.padding(horizontal = Spacing.l, vertical = Spacing.s), horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                            for (m in 1..12) {
                                val on = m in months
                                ToggleChip(MONTH_SHORT[m - 1], on) {
                                    months = if (on && months.size > 1) months - m else months + m
                                }
                            }
                        }
                    }
                }
                item {
                    if (freq == Frequency.MONTHLY) {
                        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = Spacing.l, vertical = Spacing.s)) {
                            listOf(R.string.repeat_custom_each, R.string.repeat_custom_onThe).forEachIndexed { i, label ->
                                SegmentedButton(selected = onThe == (i == 1), onClick = { onThe = i == 1 }, shape = SegmentedButtonDefaults.itemShape(i, 2)) { Text(resources.getString(label)) }
                            }
                        }
                    } else {
                        // Yearly: "On the" is optional.
                        Row(Modifier.padding(horizontal = Spacing.l, vertical = Spacing.s)) {
                            ToggleChip(resources.getString(R.string.repeat_custom_onThe), onThe) { onThe = !onThe }
                        }
                    }
                }
                if (onThe) {
                    item {
                        val ordinals = resources.getStringArray(R.array.repeat_custom_ordinals)
                        val kinds = resources.getStringArray(R.array.repeat_custom_dayKinds)
                        val dayKinds = (0..6).map { Weekday.of(it).displayName() } + kinds
                        Row(Modifier.padding(horizontal = Spacing.l), horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                            MenuField(ordinals[ordinal], ordinals.toList()) { ordinal = it }
                            MenuField(dayKinds[dayKind], dayKinds) { dayKind = it }
                        }
                    }
                } else if (freq == Frequency.MONTHLY) {
                    item {
                        FlowRow(Modifier.padding(horizontal = Spacing.l, vertical = Spacing.s), horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                            for (d in 1..31) {
                                val on = d in monthDays
                                ToggleChip(d.toString(), on) { monthDays = if (on && monthDays.size > 1) monthDays - d else monthDays + d }
                            }
                        }
                    }
                }
            }
            else -> Unit
        }
        item {
            Row(Modifier.fillMaxWidth().padding(Spacing.l), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { recurrence?.let(onApply) }, enabled = recurrence != null) { Text(resources.getString(R.string.picker_done)) }
            }
        }
    }
}

@Composable
private fun ToggleChip(label: String, on: Boolean, onToggle: () -> Unit) {
    val colors = Thirteen.colors
    Box(
        Modifier
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .background(if (on) colors.accent else colors.paperSunk, CircleShape)
            .toggleable(value = on, role = Role.Checkbox, onValueChange = { onToggle() }),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = if (on) colors.onAccent else colors.ink, modifier = Modifier.padding(horizontal = Spacing.s))
    }
}

@Composable
private fun MenuField(value: String, options: List<String>, onPick: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) { Text(value) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEachIndexed { i, option ->
                DropdownMenuItem(text = { Text(option) }, onClick = {
                    onPick(i)
                    open = false
                })
            }
        }
    }
}

/**
 * An alert picker (§2.14): None and the presets (Android leaves out "On the day at 09:00" until
 * V14), plus an alert set by another app that matches no preset, as its own row.
 */
@Composable
fun AlertPickerPage(allDay: Boolean, current: Alarm?, use24Hour: Boolean, system: CalendarSystemId, onPick: (Alarm?) -> Unit, contentPadding: PaddingValues) {
    val presets = remember(allDay, use24Hour) { alarmPresets(allDay, allowAfterStart = false, use24Hour = use24Hour) }
    LazyColumn(contentPadding = contentPadding) {
        if (current != null && presets.none { it.alarm == current }) {
            item { PickerRow(describeAlarm(current, allDay, system, use24Hour), selected = true, onClick = { onPick(current) }) }
        }
        items(presets, key = { it.id }) { preset ->
            PickerRow(preset.label, selected = preset.alarm == current, onClick = { onPick(preset.alarm) })
        }
    }
}

/**
 * The calendar picker (§2.15): writable calendars grouped by account, with dot and name, the
 * current one checked. For an existing event with invitees, calendars of other accounts are
 * disabled under `editor.calendar.sameAccount`.
 */
@Composable
fun CalendarPickerPage(state: EditorState, onPick: (String) -> Unit, contentPadding: PaddingValues) {
    val resources = LocalResources.current
    val writable = state.calendars.filter { it.writable }
    val groups = remember(writable) { CalendarGroups.of(writable) }
    val ownAccount = state.details?.calendar?.accountId
    val sameAccountOnly = !state.isNew && (state.details?.event?.attendeeCount ?: 0) > 0
    LazyColumn(contentPadding = contentPadding) {
        for (group in groups) {
            item(key = "head-${group.key}") {
                PickerHeader(group.title ?: resources.getString(R.string.calendars_group_device))
            }
            items(group.calendars, key = { it.id }) { calendar ->
                val enabled = !sameAccountOnly || calendar.accountId == ownAccount
                PickerRow(
                    calendar.title,
                    selected = calendar.id == state.draft.calendarId,
                    enabled = enabled,
                    onClick = { onPick(calendar.id) },
                    leading = { Box(Modifier.size(12.dp).background(if (enabled) calendarColor(calendar.color) else Color.Gray, CircleShape)) },
                )
            }
        }
        if (sameAccountOnly) item { PickerFooter(resources.getString(R.string.editor_calendar_sameAccount)) }
    }
}

/** The calendar's color dot. */
@Composable
fun CalendarDot(color: String, modifier: Modifier = Modifier) {
    Box(modifier.size(10.dp).background(calendarColor(color), CircleShape))
}

private val MONTH_SHORT = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
