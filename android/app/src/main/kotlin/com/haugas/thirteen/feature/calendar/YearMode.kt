package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryOccurrence
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.ThirteenMonthLayout
import com.haugas.thirteen.core.ThirteenYearLayout
import com.haugas.thirteen.core.events.YearMark
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.core.stepYear
import com.haugas.thirteen.feature.year.YearGridLayout
import com.haugas.thirteen.ui.components.DayMarks
import com.haugas.thirteen.ui.components.Explanation
import com.haugas.thirteen.ui.components.Footnote
import com.haugas.thirteen.ui.components.IntercalaryBadge
import com.haugas.thirteen.ui.components.Measure
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.components.ThirteenMonthGrid
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenAppTheme
import com.haugas.thirteen.ui.theme.ThirteenType

/** Index of the first month row in the Year list (after the pager and the legend). */
private const val FIRST_MONTH_ROW = 2

/**
 * Year mode (SPEC §5.2, docs/EVENTS.md §2.3): all 13 perfect 4 x 7 grids with the intercalary
 * day(s) in their true positions, an optional Gregorian overlay, Gregorian month-start markers,
 * today highlighted, and up to three event dots per day. Tapping a day opens its comparison (next
 * to the grid on expanded windows, full screen otherwise); tapping a month title opens Month mode.
 * The year steps with the top app bar ("‹" and "›" at expanded width) and, on phones, the pager row
 * above the grids.
 *
 * [marks] are the year's event marks (`yearEventMarks`), `null` while events are not shown
 * ("Show my events" off, no access, "Show events in Year view" off): then no dots and no prompt.
 */
@Composable
fun YearMode(
    year: Int,
    system: CalendarSystemId,
    today: GregorianDate,
    showsGregorianOverlay: Boolean,
    selection: GregorianDate?,
    focus: GregorianDate?,
    marks: Map<GregorianDate, DayMarks>?,
    showsPager: Boolean,
    contentPadding: PaddingValues,
    onYearChange: (Int) -> Unit,
    onSelectDay: (GregorianDate) -> Unit,
    onOpenMonth: (Int) -> Unit,
    onOverlayChange: (Boolean) -> Unit,
    onFocusConsumed: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val layout = remember(year, system) { ThirteenYearLayout(year, system) }
    val listState = rememberLazyListState()
    BoxWithConstraints(modifier.fillMaxSize().background(Thirteen.colors.paper)) {
        val contentWidth = minOf(maxWidth, Measure.page) - Spacing.l * 2
        val grid = YearGridLayout.forWidth(contentWidth)
        val rows = remember(layout, grid.columns) { layout.months.chunked(grid.columns) }

        // Deep links, "Show in Year" and the Today action: bring the day's month into view.
        LaunchedEffect(focus, grid.columns, year) {
            val day = focus ?: return@LaunchedEffect
            if (day.year == year) {
                val month = when (val t = ThirteenDate.of(day, system)) {
                    is ThirteenMonthDate -> t.month
                    is ThirteenIntercalaryDate -> t.info.afterMonth
                }
                listState.animateScrollToItem(FIRST_MONTH_ROW + (month - 1) / grid.columns)
            }
            onFocusConsumed()
        }

        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                top = contentPadding.calculateTopPadding() + Spacing.m,
                bottom = contentPadding.calculateBottomPadding() + Spacing.xl,
            ),
            verticalArrangement = Arrangement.spacedBy(YearGridLayout.CARD_SPACING),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item(key = "header") {
                if (showsPager) {
                    YearPager(year, layout, onYearChange, Modifier.pageWidth())
                } else {
                    Footnote(yearCaption(year, layout), Modifier.pageWidth(), color = Thirteen.colors.inkSecondary)
                }
            }
            item(key = "legend") {
                Legend(showsGregorianOverlay, onOverlayChange, Modifier.pageWidth())
            }
            items(rows.size, key = { "row-${rows[it].first().month}" }) { index ->
                Row(
                    Modifier
                        .pageWidth()
                        .height(IntrinsicSize.Max),
                    horizontalArrangement = Arrangement.spacedBy(YearGridLayout.CARD_SPACING),
                ) {
                    for (month in rows[index]) {
                        MonthCard(
                            month = month,
                            intercalary = layout.intercalary.filter { it.afterMonth == month.month },
                            grid = grid,
                            today = today,
                            selection = selection,
                            showsGregorian = showsGregorianOverlay,
                            marks = marks,
                            onSelectDay = onSelectDay,
                            onOpenMonth = { onOpenMonth(month.month) },
                            modifier = Modifier.weight(1f).fillMaxHeight(),
                        )
                    }
                    repeat(grid.columns - rows[index].size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** The Year grid's dots from the year's marks and the calendars' colors (`yearEventMarks` order, §2.3). */
fun yearDayMarks(marks: List<YearMark>, colors: Map<String, String>): Map<GregorianDate, DayMarks> =
    marks.associate { mark -> mark.gregorian to DayMarks(mark.calendarIds.map { calendarColor(colors[it]) }, mark.count) }

/** Page width: at most [Measure.page], with the page's side padding. */
private fun Modifier.pageWidth(): Modifier = this
    .padding(horizontal = Spacing.l)
    .widthIn(max = Measure.page)
    .fillMaxWidth()

@Composable
private fun yearCaption(year: Int, layout: ThirteenYearLayout): String {
    val structure = stringResource(R.string.year_structure, layout.intercalary.joinToString(stringResource(R.string.year_structure_join)) { it.shortName })
    val days = stringResource(if (GregorianDate.isValid(year, 2, 29)) R.string.leap_year_days else R.string.common_year_days)
    return listOf(structure, days).joinToString(stringResource(R.string.caption_join))
}

/**
 * Previous and next year around the year's structure (phones): the top app bar already names the
 * year, so this row carries the step buttons and the caption, and the paging actions for TalkBack.
 */
@Composable
private fun YearPager(year: Int, layout: ThirteenYearLayout, onYearChange: (Int) -> Unit, modifier: Modifier = Modifier) {
    val colors = Thirteen.colors
    val previous = stringResource(R.string.previous_year)
    val next = stringResource(R.string.next_year)
    val canGoBack = GregorianDate.stepYear(year, -1) != year
    val canGoForward = GregorianDate.stepYear(year, 1) != year
    val caption = yearCaption(year, layout)
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
        PagerButton(ThirteenIcons.ChevronLeft, previous, canGoBack) { onYearChange(GregorianDate.stepYear(year, -1)) }
        Text(
            caption,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.inkSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .weight(1f)
                .semantics {
                    customActions = buildList {
                        if (canGoBack) add(CustomAccessibilityAction(previous) { onYearChange(GregorianDate.stepYear(year, -1)); true })
                        if (canGoForward) add(CustomAccessibilityAction(next) { onYearChange(GregorianDate.stepYear(year, 1)); true })
                    }
                },
        )
        PagerButton(ThirteenIcons.ChevronRight, next, canGoForward) { onYearChange(GregorianDate.stepYear(year, 1)) }
    }
}

@Composable
private fun PagerButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    val colors = Thirteen.colors
    FilledTonalIconButton(
        onClick = onClick,
        enabled = enabled,
        colors = IconButtonDefaults.filledTonalIconButtonColors(
            containerColor = colors.accentWash,
            contentColor = colors.ink,
            disabledContainerColor = colors.paperSunk,
            disabledContentColor = colors.ink.copy(alpha = 0.38f),
        ),
    ) {
        Icon(icon, contentDescription = label)
    }
}

@Composable
private fun Legend(showsOverlay: Boolean, onOverlayChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val colors = Thirteen.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m), verticalAlignment = Alignment.Top) {
            Box(
                Modifier
                    .padding(top = 3.dp)
                    .size(width = 3.dp, height = 14.dp)
                    .background(colors.foil, CircleShape),
            )
            Explanation(stringResource(if (showsOverlay) R.string.year_legend_overlay else R.string.year_legend_plain))
        }
        FilterChip(
            selected = showsOverlay,
            onClick = { onOverlayChange(!showsOverlay) },
            label = { Text(stringResource(R.string.gregorian_dates)) },
            leadingIcon = if (showsOverlay) {
                { Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(FilterChipDefaults.IconSize)) }
            } else {
                null
            },
            colors = FilterChipDefaults.filterChipColors(
                containerColor = colors.paper,
                labelColor = colors.ink,
                selectedContainerColor = colors.foilWash,
                selectedLabelColor = colors.ink,
                selectedLeadingIconColor = colors.foil,
            ),
            border = FilterChipDefaults.filterChipBorder(
                enabled = true,
                selected = showsOverlay,
                borderColor = colors.rule,
                selectedBorderColor = colors.foil.copy(alpha = 0.5f),
            ),
        )
    }
}

/**
 * One month of Year mode: the title (a button that opens Month mode), Gregorian span, the 4 x 7
 * grid and any intercalary day after it.
 */
@Composable
private fun MonthCard(
    month: ThirteenMonthLayout,
    intercalary: List<IntercalaryOccurrence>,
    grid: YearGridLayout,
    today: GregorianDate,
    selection: GregorianDate?,
    showsGregorian: Boolean,
    marks: Map<GregorianDate, DayMarks>?,
    onSelectDay: (GregorianDate) -> Unit,
    onOpenMonth: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Thirteen.colors
    val containsToday = month.days.any { it.gregorian == today }
    val shape = RoundedCornerShape(Radius.card - 4.dp)
    val first = month.weeks[0][0].gregorian.formatted(FormatOptions.SHORT)
    val last = month.weeks[3][6].gregorian.formatted(FormatOptions.SHORT)
    val span = stringResource(R.string.gregorian_span, first, last)
    val meaning = month.monthInfo.meaning
    val spanText = if (meaning != null && month.system == CalendarSystemId.POSITIVIST) "$meaning · $span" else span
    val monthLabel = stringResource(R.string.month_of_13, month.month)
    val currentMonth = stringResource(R.string.current_month)
    val openMonth = stringResource(R.string.calendar_mode_month)
    // Where marks are made without colour (Mono: its accent text is its ink), the current month's
    // name and number are bold as well as outlined, as in the Apple app.
    val emphasis = containsToday && Thirteen.marksWithoutColor
    Column(
        modifier
            .background(colors.paperRaised, shape)
            .border(if (containsToday) 1.5.dp else 1.dp, if (containsToday) colors.accent.copy(alpha = 0.7f) else colors.rule, shape)
            .padding(grid.cardPadding),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Row(
            Modifier
                .heightIn(min = 48.dp)
                .clickable(role = Role.Button, onClickLabel = openMonth, onClick = onOpenMonth),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                month.monthInfo.name,
                style = MaterialTheme.typography.titleLarge.let { if (emphasis) it.copy(fontWeight = FontWeight.Bold) else it },
                color = colors.ink,
                modifier = Modifier.weight(1f).semantics {
                    heading()
                    if (containsToday) stateDescription = currentMonth
                },
            )
            Text(
                month.month.toString(),
                style = ThirteenType.mono.copy(fontSize = 15.sp, fontWeight = if (emphasis) FontWeight.Bold else FontWeight.Normal),
                color = if (containsToday) colors.accentText else colors.inkTertiary,
                modifier = Modifier.semantics { contentDescription = monthLabel },
            )
        }
        Footnote(spanText, color = colors.foil)
        ThirteenMonthGrid(
            layout = month,
            today = today,
            selection = selection,
            showsGregorian = showsGregorian,
            cellSpacing = grid.cellSpacing,
            marks = marks,
            onSelect = { onSelectDay(it.gregorian) },
        )
        for (occurrence in intercalary) {
            IntercalaryBadge(
                occurrence,
                isToday = occurrence.gregorian == today,
                isSelected = occurrence.gregorian == selection,
                showsGregorian = showsGregorian,
                marks = marks?.let { it[occurrence.gregorian] ?: DayMarks.NONE },
                onClick = { onSelectDay(occurrence.gregorian) },
            )
        }
    }
}

/**
 * The detail pane before a day is picked (expanded windows): a hint where the comparison will
 * open.
 */
@Composable
fun YearDetailPlaceholder(modifier: Modifier = Modifier) {
    val colors = Thirteen.colors
    Box(modifier.fillMaxSize().background(colors.paper).padding(Spacing.xxl), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
            Icon(ThirteenIcons.Year, contentDescription = null, tint = colors.inkTertiary, modifier = Modifier.size(40.dp))
            Text(
                stringResource(R.string.year_placeholder_title),
                style = MaterialTheme.typography.titleLarge,
                color = colors.ink,
            )
            Text(
                stringResource(R.string.year_placeholder_text),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.inkSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = 320.dp),
            )
        }
    }
}

@Preview(widthDp = 411, heightDp = 1200)
@Composable
private fun YearModePreview() {
    ThirteenAppTheme {
        YearMode(
            2026, CalendarSystemId.IFC, GregorianDate(2026, 10, 19), true, null, null, null, true, PaddingValues(),
            {}, {}, {}, {}, {},
        )
    }
}
