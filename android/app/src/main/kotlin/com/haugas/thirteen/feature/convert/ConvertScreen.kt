package com.haugas.thirteen.feature.convert

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CalendarLocale
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerColors
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DatePickerFormatter
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.Comparison
import com.haugas.thirteen.core.DateStyle
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.GregorianLabelLookup
import com.haugas.thirteen.core.IntercalaryOccurrence
import com.haugas.thirteen.core.NotableDateInYear
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenLabelLookup
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.ThirteenMonthLayout
import com.haugas.thirteen.core.ThirteenSlot
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.core.inSlot
import com.haugas.thirteen.core.name
import com.haugas.thirteen.core.sameSlotInYearOrPrevious
import com.haugas.thirteen.core.slotKey
import com.haugas.thirteen.navigation.ConvertDirection
import com.haugas.thirteen.ui.Phrasing
import com.haugas.thirteen.ui.components.AccentButton
import com.haugas.thirteen.ui.components.SegmentLabel
import com.haugas.thirteen.ui.components.AccentTextButton
import com.haugas.thirteen.ui.components.ComparisonDetail
import com.haugas.thirteen.ui.components.DatePlate
import com.haugas.thirteen.ui.components.Explanation
import com.haugas.thirteen.ui.components.Footnote
import com.haugas.thirteen.ui.components.IntercalaryBadge
import com.haugas.thirteen.ui.components.Measure
import com.haugas.thirteen.ui.components.PageColumn
import com.haugas.thirteen.ui.components.PlatePrimary
import com.haugas.thirteen.ui.components.PlateSize
import com.haugas.thirteen.ui.components.ScreenScaffold
import com.haugas.thirteen.ui.components.SettingsAction
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.SystemSwitcher
import com.haugas.thirteen.ui.components.ThirteenCard
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.components.ThirteenMonthGrid
import com.haugas.thirteen.ui.rememberPhrasing
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenAppTheme
import com.haugas.thirteen.ui.theme.ThirteenType
import java.time.Instant
import java.time.ZoneOffset

/**
 * Convert (SPEC §5.3): a two-way converter. Gregorian to 13-month with a date picker, and 13-month
 * to Gregorian with a year, a slot (13 months including Sol plus the intercalary days, in order)
 * and a 4 x 7 day picker. Both directions edit the same day, so swapping keeps it. Below: the full
 * comparison, "read this label in the other calendar" lookups and the year's notable days. Two
 * columns on wide windows.
 */
@Composable
fun ConvertScreen(
    day: GregorianDate,
    direction: ConvertDirection,
    today: GregorianDate,
    system: CalendarSystemId,
    onDayChange: (GregorianDate) -> Unit,
    onDirectionChange: (ConvertDirection) -> Unit,
    onShowInYear: (GregorianDate) -> Unit,
    onSystemChange: (CalendarSystemId) -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val comparison = remember(day, system) { Comparison(day, system) }
    BoxWithConstraints(modifier) {
        val wide = maxWidth >= Measure.twoColumns + 80.dp + Spacing.l * 2
        ScreenScaffold(
            title = stringResource(R.string.section_convert),
            actions = {
                if (wide) {
                    IconButton(onClick = { onDirectionChange(direction.toggled) }) {
                        Icon(ThirteenIcons.Convert, contentDescription = stringResource(R.string.swap_hint))
                    }
                }
                SystemSwitcher(system, onSystemChange)
                SettingsAction(onOpenSettings)
            },
        ) { padding ->
            ConvertContent(comparison, direction, today, wide, padding, onDayChange, onDirectionChange, onShowInYear)
        }
    }
}

@Composable
private fun ConvertContent(
    comparison: Comparison,
    direction: ConvertDirection,
    today: GregorianDate,
    wide: Boolean,
    padding: PaddingValues,
    onDayChange: (GregorianDate) -> Unit,
    onDirectionChange: (ConvertDirection) -> Unit,
    onShowInYear: (GregorianDate) -> Unit,
) {
    val day = comparison.gregorian
    val system = comparison.thirteen.system
    PageColumn(padding) {
        DirectionPicker(direction, system, onDirectionChange)
        if (wide) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.l)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
                    InputCard(direction, day, today, system, inline = true, onDayChange)
                    LabelLookupCard(day, system, onDayChange)
                    NotableDatesCard(day, system, onDayChange)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
                    ResultCard(comparison, direction, today, onShowInYear)
                }
            }
        } else {
            InputCard(direction, day, today, system, inline = false, onDayChange)
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                AccentButton(
                    stringResource(R.string.swap),
                    onClick = { onDirectionChange(direction.toggled) },
                    icon = ThirteenIcons.SwapVertical,
                )
            }
            ResultCard(comparison, direction, today, onShowInYear)
            LabelLookupCard(day, system, onDayChange)
            NotableDatesCard(day, system, onDayChange)
        }
    }
}

@Composable
private fun DirectionPicker(direction: ConvertDirection, system: CalendarSystemId, onDirectionChange: (ConvertDirection) -> Unit) {
    val colors = Thirteen.colors
    val options = listOf(
        ConvertDirection.FROM_GREGORIAN to stringResource(R.string.direction_from_gregorian, system.shortName),
        ConvertDirection.FROM_THIRTEEN to stringResource(R.string.direction_from_thirteen, system.shortName),
    )
    SingleChoiceSegmentedButtonRow(Modifier.widthIn(max = 520.dp).fillMaxWidth()) {
        options.forEachIndexed { index, (option, label) ->
            SegmentedButton(
                selected = option == direction,
                onClick = { onDirectionChange(option) },
                shape = SegmentedButtonDefaults.itemShape(index, options.size),
                colors = SegmentedButtonDefaults.colors(
                    activeContainerColor = colors.accentWash,
                    activeContentColor = colors.ink,
                    activeBorderColor = colors.rule,
                    inactiveContainerColor = colors.paper,
                    inactiveContentColor = colors.ink,
                    inactiveBorderColor = colors.rule,
                ),
                label = { SegmentLabel(label) },
            )
        }
    }
}

@Composable
private fun InputCard(
    direction: ConvertDirection,
    day: GregorianDate,
    today: GregorianDate,
    system: CalendarSystemId,
    inline: Boolean,
    onDayChange: (GregorianDate) -> Unit,
) {
    AnimatedContent(targetState = direction, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "input") { shown ->
        when (shown) {
            ConvertDirection.FROM_GREGORIAN -> GregorianInputCard(day, today, inline, onDayChange)
            ConvertDirection.FROM_THIRTEEN -> ThirteenInputCard(day, today, system, onDayChange)
        }
    }
}

// Gregorian input

private fun GregorianDate.utcMillis(): Long = toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

internal fun gregorianOfUtcMillis(millis: Long): GregorianDate? =
    runCatching { GregorianDate.from(Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate()) }.getOrNull()

/** Material's date picker spans the whole supported range: java.time is proleptic Gregorian. */
private val PickerYears = GregorianDate.MIN_YEAR..GregorianDate.MAX_YEAR

/**
 * The picker's month title, headline and day labels, written by the engine. Material's own
 * formatter goes through ICU's calendar, which switches to Julian dates before 15 October 1582: for
 * proleptic Gregorian 1 March 1000 it showed "February 1000" over the March grid and the headline
 * "Feb 24, 1000", and TalkBack read the same wrong dates for the day cells. The grid itself, the
 * selection and text input use java.time, which is proleptic Gregorian like the engine.
 */
@OptIn(ExperimentalMaterial3Api::class)
internal object ProlepticDateFormatter : DatePickerFormatter {
    override fun formatMonthYear(monthMillis: Long?, locale: CalendarLocale): String? =
        monthMillis?.let(::gregorianOfUtcMillis)?.let { "${it.monthInfo.name} ${it.year}" }

    override fun formatDate(dateMillis: Long?, locale: CalendarLocale, forContentDescription: Boolean): String? =
        dateMillis?.let(::gregorianOfUtcMillis)?.formatted(if (forContentDescription) Phrasing.LONG_WEEKDAY else FormatOptions.MEDIUM)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun pickerColors(): DatePickerColors {
    val colors = Thirteen.colors
    return DatePickerDefaults.colors(
        containerColor = colors.paperRaised,
        titleContentColor = colors.inkSecondary,
        headlineContentColor = colors.ink,
        weekdayContentColor = colors.inkTertiary,
        subheadContentColor = colors.inkSecondary,
        navigationContentColor = colors.ink,
        yearContentColor = colors.ink,
        currentYearContentColor = colors.accentText,
        selectedYearContentColor = colors.onAccent,
        selectedYearContainerColor = colors.accent,
        dayContentColor = colors.ink,
        selectedDayContentColor = colors.onAccent,
        selectedDayContainerColor = colors.accent,
        todayContentColor = colors.accentText,
        todayDateBorderColor = colors.accent,
        dividerColor = colors.rule,
    )
}

/** Gregorian input: Material's date picker, inline on wide windows, in a dialog on phones. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GregorianInputCard(day: GregorianDate, today: GregorianDate, inline: Boolean, onDayChange: (GregorianDate) -> Unit) {
    val colors = Thirteen.colors
    var showsDialog by rememberSaveable { mutableStateOf(false) }
    ThirteenCard(title = stringResource(R.string.gregorian_date)) {
        if (inline) {
            InlinePicker(day, onDayChange)
        } else {
            AccentButton(
                day.formatted(Phrasing.LONG_WEEKDAY),
                onClick = { showsDialog = true },
                icon = ThirteenIcons.Year,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            AccentButton(
                stringResource(R.string.action_today),
                onClick = { onDayChange(today) },
                icon = ThirteenIcons.Today,
                enabled = day != today,
            )
            Spacer(Modifier.weight(1f))
            val iso = day.isoString
            val isoLabel = stringResource(R.string.iso_date_a11y, iso)
            SelectionContainer(Modifier.semantics { contentDescription = isoLabel }) {
                Text(iso, style = ThirteenType.code, color = colors.inkSecondary, maxLines = 1)
            }
        }
    }
    if (showsDialog) {
        val state = rememberDatePickerState(initialSelectedDateMillis = day.utcMillis(), yearRange = PickerYears)
        DatePickerDialog(
            onDismissRequest = { showsDialog = false },
            confirmButton = {
                AccentTextButton(stringResource(R.string.ok), onClick = {
                    state.selectedDateMillis?.let(::gregorianOfUtcMillis)?.let(onDayChange)
                    showsDialog = false
                })
            },
            dismissButton = {
                AccentTextButton(stringResource(R.string.cancel), onClick = { showsDialog = false })
            },
            colors = pickerColors(),
        ) {
            DatePicker(state = state, dateFormatter = ProlepticDateFormatter, colors = pickerColors())
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InlinePicker(day: GregorianDate, onDayChange: (GregorianDate) -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = day.utcMillis(), yearRange = PickerYears)
    val currentDay by rememberUpdatedState(day)
    val currentOnDayChange by rememberUpdatedState(onDayChange)
    // The converter's day is the source of truth: follow changes from elsewhere (Today, notable
    // days, lookups) and report picks.
    LaunchedEffect(day) {
        val millis = day.utcMillis()
        if (state.selectedDateMillis != millis) {
            state.selectedDateMillis = millis
            state.displayedMonthMillis = millis
        }
    }
    LaunchedEffect(state) {
        snapshotFlow { state.selectedDateMillis }.collect { millis ->
            val picked = millis?.let(::gregorianOfUtcMillis) ?: return@collect
            if (picked != currentDay) currentOnDayChange(picked)
        }
    }
    DatePicker(
        state = state,
        dateFormatter = ProlepticDateFormatter,
        title = null,
        headline = null,
        showModeToggle = false,
        colors = pickerColors(),
    )
}

// 13-month input

/**
 * 13-month input: display year, slot (month or intercalary day, in order) and day. A leap-only day
 * moved to a common year falls back to the day before it (June 28, Festival of All the Dead).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ThirteenInputCard(day: GregorianDate, today: GregorianDate, system: CalendarSystemId, onDayChange: (GregorianDate) -> Unit) {
    val phrasing = rememberPhrasing()
    val colors = Thirteen.colors
    val thirteen = remember(day, system) { ThirteenDate.of(day, system) }
    val slots = remember(day.year, system) { ThirteenSlot.allInYear(day.year, system) }
    val displayYear = thirteen.displayYear
    val range = system.displayYearRange
    fun moveToDisplayYear(target: Int) {
        if (target in range) onDayChange(thirteen.sameSlotInYearOrPrevious(system.gregorianYearOf(target)).gregorian)
    }
    ThirteenCard(title = stringResource(R.string.thirteen_date, system.shortName)) {
        val yearValue = stringResource(R.string.convert_year_value, system.shortName, displayYear.toString())
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).clearAndSetSemantics { contentDescription = yearValue }) {
                Text(stringResource(R.string.field_year), style = MaterialTheme.typography.bodyMedium, color = colors.inkSecondary)
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    Text(displayYear.toString(), style = MaterialTheme.typography.headlineSmall, color = colors.ink)
                    phrasing.gregorianYearNote(day.year, system)?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = colors.inkTertiary, modifier = Modifier.padding(bottom = 3.dp))
                    }
                }
            }
            YearStepButton(ThirteenIcons.ChevronLeft, stringResource(R.string.previous_year), displayYear - 1 in range) {
                moveToDisplayYear(displayYear - 1)
            }
            YearStepButton(ThirteenIcons.ChevronRight, stringResource(R.string.next_year), displayYear + 1 in range) {
                moveToDisplayYear(displayYear + 1)
            }
        }

        var expanded by remember { mutableStateOf(false) }
        val current = slots.firstOrNull { it.key == thirteen.slotKey }
        ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
            OutlinedTextField(
                value = current?.name.orEmpty(),
                onValueChange = {},
                readOnly = true,
                singleLine = true,
                label = { Text(stringResource(R.string.field_month)) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = colors.accent,
                    unfocusedBorderColor = colors.inkTertiary,
                    focusedLabelColor = colors.accentText,
                    unfocusedLabelColor = colors.inkSecondary,
                    focusedTextColor = colors.ink,
                    unfocusedTextColor = colors.ink,
                    focusedTrailingIconColor = colors.ink,
                    unfocusedTrailingIconColor = colors.inkSecondary,
                ),
                modifier = Modifier
                    .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable)
                    .fillMaxWidth(),
            )
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
                containerColor = colors.paperRaised,
            ) {
                for (slot in slots) {
                    DropdownMenuItem(
                        text = {
                            Text(
                                slot.name,
                                style = MaterialTheme.typography.bodyLarge,
                                color = if (slot is ThirteenSlot.Intercalary) colors.accentText else colors.ink,
                            )
                        },
                        onClick = {
                            expanded = false
                            onDayChange(thirteen.inSlot(slot).gregorian)
                        },
                        contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding,
                    )
                }
            }
        }

        when (thirteen) {
            is ThirteenMonthDate -> {
                val layout = remember(thirteen.year, thirteen.month, system) { ThirteenMonthLayout(thirteen.year, thirteen.month, system) }
                Text(stringResource(R.string.field_day), style = MaterialTheme.typography.bodyMedium, color = colors.inkSecondary)
                ThirteenMonthGrid(layout, today = today, selection = day, showsGregorian = true, onSelect = { onDayChange(it.gregorian) })
            }
            is ThirteenIntercalaryDate -> {
                val occurrence = remember(thirteen) { IntercalaryOccurrence.allInYear(thirteen.year, system).first { it.id == thirteen.id } }
                IntercalaryBadge(occurrence, isToday = occurrence.gregorian == today, isSelected = true)
            }
        }
    }
}

@Composable
private fun YearStepButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    val colors = Thirteen.colors
    androidx.compose.material3.FilledTonalIconButton(
        onClick = onClick,
        enabled = enabled,
        colors = androidx.compose.material3.IconButtonDefaults.filledTonalIconButtonColors(
            containerColor = colors.accentWash,
            contentColor = colors.ink,
        ),
    ) { Icon(icon, contentDescription = label) }
}

// Result

@Composable
private fun ResultCard(comparison: Comparison, direction: ConvertDirection, today: GregorianDate, onShowInYear: (GregorianDate) -> Unit) {
    ThirteenCard(title = stringResource(R.string.result)) {
        DatePlate(
            comparison,
            size = PlateSize.Compact,
            primary = if (direction == ConvertDirection.FROM_GREGORIAN) PlatePrimary.Thirteen else PlatePrimary.Gregorian,
        )
        AccentButton(stringResource(R.string.show_in_year), onClick = { onShowInYear(comparison.gregorian) }, icon = ThirteenIcons.Year)
        ComparisonDetail(comparison, relativeToToday = comparison.gregorian == today)
    }
}

// Lookups

/** "Read this label in the other calendar" (SPEC §3 reverse lookups), both ways. */
@Composable
private fun LabelLookupCard(day: GregorianDate, system: CalendarSystemId, onDayChange: (GregorianDate) -> Unit) {
    val gregorianLookup = remember(day, system) { GregorianLabelLookup(day, system) }
    val thirteenLookup = remember(day, system) { ThirteenLabelLookup(ThirteenDate.of(day, system)) }
    val noYear = FormatOptions(style = DateStyle.LONG, includeYear = false)
    val mediumWeekday = FormatOptions(style = DateStyle.MEDIUM, includeWeekday = true)
    val gregorianLabel = day.formatted(noYear)
    val thirteenLabel = thirteenLookup.thirteen.formatted(noYear)

    val firstText = gregorianLookup.sameLabel?.let { same ->
        stringResource(
            R.string.lookup_falls_on,
            system.shortName,
            same.formatted(noYear),
            gregorianLookup.sameLabelFallsOn?.formatted(mediumWeekday).orEmpty(),
        )
    } ?: if (system == CalendarSystemId.POSITIVIST) {
        stringResource(R.string.lookup_no_positivist)
    } else {
        stringResource(R.string.lookup_no_label, system.shortName, gregorianLabel)
    }
    val secondText = thirteenLookup.sameLabel?.let { same ->
        stringResource(
            R.string.lookup_gregorian_is,
            same.formatted(noYear),
            system.shortName,
            thirteenLookup.sameLabelFallsOn?.formatted(mediumWeekday).orEmpty(),
        )
    } ?: stringResource(R.string.lookup_no_gregorian_month, thirteenLookup.thirteen.monthDate?.monthInfo?.name ?: thirteenLabel)

    ThirteenCard(title = stringResource(R.string.lookup_title), subtitle = stringResource(R.string.lookup_subtitle)) {
        LookupRow(stringResource(R.string.lookup_heading_system, gregorianLabel, system.shortName), firstText, gregorianLookup.sameLabelFallsOn, day, onDayChange)
        HorizontalDivider(color = Thirteen.colors.rule)
        LookupRow(stringResource(R.string.lookup_heading_gregorian, thirteenLabel), secondText, thirteenLookup.sameLabel, day, onDayChange)
    }
}

@Composable
private fun LookupRow(heading: String, text: String, target: GregorianDate?, day: GregorianDate, onDayChange: (GregorianDate) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(heading, style = MaterialTheme.typography.titleSmall, color = Thirteen.colors.ink)
        Explanation(text)
        if (target != null && target != day) {
            AccentTextButton(
                stringResource(R.string.go_to_gregorian, target.formatted(FormatOptions.MEDIUM)),
                onClick = { onDayChange(target) },
                icon = ThirteenIcons.GoTo,
            )
        }
    }
}

/** Quick picks: well-known fixed Gregorian days in the converter's year. */
@Composable
private fun NotableDatesCard(day: GregorianDate, system: CalendarSystemId, onDayChange: (GregorianDate) -> Unit) {
    val colors = Thirteen.colors
    val dates = remember(day.year, system) { NotableDateInYear.allInYear(day.year, system) }
    ThirteenCard(title = stringResource(R.string.notable_title, day.year.toString())) {
        BoxWithConstraints {
            val columns = ((maxWidth + Spacing.s) / (150.dp + Spacing.s)).toInt().coerceIn(1, 4)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                for (row in dates.chunked(columns)) {
                    Row(Modifier.height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        for (notable in row) {
                            val selected = notable.gregorian == day
                            val shape = RoundedCornerShape(Radius.control)
                            val label = stringResource(
                                R.string.notable_a11y,
                                notable.notable.name,
                                notable.gregorian.formatted(FormatOptions.LONG),
                                system.shortName,
                                notable.thirteen.formatted(FormatOptions.LONG),
                            )
                            Column(
                                Modifier
                                    .weight(1f)
                                    .fillMaxHeight()
                                    .background(if (selected) colors.accentWash else colors.paperSunk.copy(alpha = 0.6f), shape)
                                    // AccentText, as on Apple: Accent is under 3:1 against the accent wash in light themes.
                                    .border(1.5.dp, if (selected) colors.accentText else colors.paperSunk.copy(alpha = 0f), shape)
                                    .selectable(selected = selected, role = Role.Button) { onDayChange(notable.gregorian) }
                                    .clearAndSetSemantics {
                                        contentDescription = label
                                        this.selected = selected
                                    }
                                    .padding(Spacing.m),
                                verticalArrangement = Arrangement.spacedBy(Spacing.xxs),
                            ) {
                                Text(notable.notable.name, style = MaterialTheme.typography.titleSmall, color = colors.ink)
                                Footnote(stringResource(R.string.notable_gregorian, notable.gregorian.formatted(FormatOptions.SHORT)), color = colors.foil)
                                Text(
                                    stringResource(R.string.notable_thirteen, system.shortName, notable.thirteen.formatted(FormatOptions.SHORT)),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = colors.accentText,
                                )
                            }
                        }
                        repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

@Preview(widthDp = 411, heightDp = 2200)
@Composable
private fun ConvertPreview() {
    ThirteenAppTheme {
        ConvertScreen(
            GregorianDate(2024, 6, 17), ConvertDirection.FROM_THIRTEEN, GregorianDate(2026, 10, 19), CalendarSystemId.IFC,
            {}, {}, {}, {}, {},
        )
    }
}
