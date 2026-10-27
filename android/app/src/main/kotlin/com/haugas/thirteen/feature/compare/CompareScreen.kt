package com.haugas.thirteen.feature.compare

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystem
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.GregorianCalendarInfo
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.GregorianMonthLayout
import com.haugas.thirteen.core.MonthAlignment
import com.haugas.thirteen.core.NameStyle
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.core.YearStats
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.ui.Phrasing
import com.haugas.thirteen.ui.components.AccentButton
import com.haugas.thirteen.ui.components.CapFontScale
import com.haugas.thirteen.ui.components.Explanation
import com.haugas.thirteen.ui.components.Eyebrow
import com.haugas.thirteen.ui.components.Footnote
import com.haugas.thirteen.ui.components.PageColumn
import com.haugas.thirteen.ui.components.ScreenScaffold
import com.haugas.thirteen.ui.components.SettingsAction
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.SystemSwitcher
import com.haugas.thirteen.ui.components.ThirteenCard
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.components.YearStepperHeader
import com.haugas.thirteen.ui.components.drawHatch
import com.haugas.thirteen.ui.rememberPhrasing
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenAppTheme
import com.haugas.thirteen.ui.theme.ThirteenType

/**
 * Compare (SPEC §5.4): 12 vs 13 for one year: month-boundary ribbon, month-length bars, Friday the
 * 13ths, quarter lengths, month shapes, weekday drift and the three calendars side by side.
 */
@Composable
fun CompareScreen(
    year: Int,
    system: CalendarSystemId,
    today: GregorianDate,
    onYearChange: (Int) -> Unit,
    onShowHistory: () -> Unit,
    onSystemChange: (CalendarSystemId) -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val stats = remember(year, system) { YearStats(year, system) }
    val alignment = remember(year, system) { MonthAlignment(year, system) }
    ScreenScaffold(
        title = stringResource(R.string.section_compare),
        modifier = modifier,
        actions = {
            SystemSwitcher(system, onSystemChange)
            SettingsAction(onOpenSettings)
        },
    ) { padding ->
        PageColumn(padding) {
            YearStepperHeader(year, system, onYearChange, subtitle = stringResource(R.string.compare_subtitle))
            ThirteenCard(
                title = stringResource(R.string.month_boundaries),
                subtitle = stringResource(R.string.month_boundaries_subtitle),
            ) {
                MonthRibbon(alignment, markedDayOfYear = if (today.year == year) today.dayOfYear else null)
            }
            ThirteenCard(title = stringResource(R.string.month_lengths), subtitle = stringResource(R.string.month_lengths_subtitle)) {
                MonthLengthBars(stats)
            }
            AdaptiveGrid(minCellWidth = 300.dp) {
                listOf<@Composable (Modifier) -> Unit>(
                    { Friday13thCard(stats, it) },
                    { QuartersCard(stats, it) },
                    { MonthShapesCard(stats, it) },
                    { WeekdayDriftCard(year, system, it) },
                )
            }
            SystemsSideBySide(system)
            AccentButton(
                stringResource(R.string.history_button),
                onClick = onShowHistory,
                icon = ThirteenIcons.History,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** Cells of at least [minCellWidth] in as many columns as fit, rows of equal height. */
@Composable
internal fun AdaptiveGrid(
    minCellWidth: Dp,
    spacing: Dp = Spacing.l,
    cells: () -> List<@Composable (Modifier) -> Unit>,
) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val columns = ((maxWidth + spacing) / (minCellWidth + spacing)).toInt().coerceAtLeast(1)
        Column(verticalArrangement = Arrangement.spacedBy(spacing)) {
            for (row in cells().chunked(columns)) {
                Row(Modifier.height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(spacing)) {
                    for (cell in row) cell(Modifier.weight(1f).fillMaxHeight())
                    repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * The fill of a chart band: [color] at [alpha] in a 6 dp rounded rectangle. A [hatched] band (a
 * Gregorian one where marks are made without colour, Mono) is a light wash of the colour under
 * diagonal lines of it instead, so it differs from the plain 13-month bands by pattern and not
 * only by tone: the Apple app's `GregorianBandStyle`.
 */
private fun Modifier.band(color: Color, alpha: Float, hatched: Boolean): Modifier = drawBehind {
    val corner = CornerRadius(6.dp.toPx())
    if (hatched) {
        drawRoundRect(color.copy(alpha = alpha * 0.35f), cornerRadius = corner)
        drawHatch(Offset.Zero, size, color.copy(alpha = minOf(1f, 0.15f + alpha)), corner)
    } else {
        drawRoundRect(color.copy(alpha = alpha), cornerRadius = corner)
    }
}

/** A big number with a caption, one per calendar. */
@Composable
private fun StatFigure(value: String, caption: String, color: Color, modifier: Modifier = Modifier) {
    val colors = Thirteen.colors
    Column(modifier.clearAndSetSemantics { contentDescription = "$value, $caption" }) {
        Text(value, style = ThirteenType.numeral(40.sp), color = colors.ink, maxLines = 1)
        Box(Modifier.padding(top = 2.dp, bottom = Spacing.s).size(width = 24.dp, height = 3.dp).background(color, CircleShape))
        Text(caption, style = MaterialTheme.typography.bodySmall, color = colors.inkSecondary)
    }
}

@Composable
private fun Friday13thCard(stats: YearStats, modifier: Modifier) {
    val colors = Thirteen.colors
    val system = stats.system
    val gregorian = stats.gregorianFriday13ths.joinToString(", ") { it.gregorian.formatted(FormatOptions.SHORT) }
    val thirteenCaption = if (stats.thirteenFriday13ths.isEmpty()) {
        stringResource(R.string.friday13_never, system.shortName, system.fixedWeekday(13).displayName())
    } else {
        stringResource(R.string.friday13_every, system.shortName)
    }
    ThirteenCard(modifier, title = stringResource(R.string.friday13), subtitle = stringResource(R.string.friday13_subtitle)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.l)) {
            StatFigure(
                stats.gregorianFriday13ths.size.toString(),
                stringResource(R.string.friday13_gregorian, gregorian),
                colors.foil,
                Modifier.weight(1f),
            )
            StatFigure(stats.thirteenFriday13ths.size.toString(), thirteenCaption, colors.accent, Modifier.weight(1f))
        }
    }
}

@Composable
private fun QuartersCard(stats: YearStats, modifier: Modifier) {
    val phrasing = rememberPhrasing()
    val colors = Thirteen.colors
    ThirteenCard(modifier, title = stringResource(R.string.quarters), subtitle = stringResource(R.string.quarters_subtitle)) {
        QuarterRow(stringResource(R.string.gregorian), stats.gregorianQuarterLengths, colors.foil, colors.foil, gregorian = true)
        QuarterRow(stats.system.shortName, stats.thirteenQuarterLengths, colors.accent, colors.accentText)
        if (stats.intercalaryDayCount > 0) {
            Footnote(stringResource(R.string.quarters_plus, phrasing.days(stats.intercalaryDayCount)))
        }
    }
}

@Composable
private fun QuarterRow(title: String, lengths: List<Int>, color: Color, label: Color, gregorian: Boolean = false) {
    val colors = Thirteen.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Eyebrow(title, color = label)
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            lengths.forEachIndexed { index, days ->
                val description = stringResource(R.string.quarter_a11y, index + 1, days)
                Box(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 36.dp)
                        .band(color, if (index % 2 == 0) 0.22f else 0.34f, hatched = gregorian && Thirteen.marksWithoutColor)
                        .clearAndSetSemantics { contentDescription = "$title. $description" },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(days.toString(), style = MaterialTheme.typography.titleMedium, color = colors.ink)
                }
            }
        }
    }
}

/** Every Gregorian month drawn as a tiny ragged grid, against the single 13-month shape. */
@Composable
private fun MonthShapesCard(stats: YearStats, modifier: Modifier) {
    val colors = Thirteen.colors
    val layouts = remember(stats.year, stats.system) { (1..12).map { GregorianMonthLayout(stats.year, it, stats.system) } }
    ThirteenCard(modifier, title = stringResource(R.string.month_shapes), subtitle = stringResource(R.string.month_shapes_subtitle)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.l)) {
            StatFigure(stats.gregorianMonthShapeCount.toString(), stringResource(R.string.shapes_gregorian), colors.foil, Modifier.weight(1f))
            StatFigure(stats.thirteenMonthShapeCount.toString(), stringResource(R.string.shapes_thirteen), colors.accent, Modifier.weight(1f))
        }
        CapFontScale(1.15f) {
            Column(Modifier.clearAndSetSemantics { }, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                for (row in layouts.chunked(6)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        for (layout in row) {
                            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                                MonthShapeGlyph(layout.leadingBlanks, layout.days.size, colors.foil, Modifier.fillMaxWidth())
                                Text(
                                    layout.monthInfo.shortName,
                                    style = ThirteenType.mono.copy(fontSize = 11.sp),
                                    color = colors.inkTertiary,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
            MonthShapeGlyph(0, 28, colors.accent, Modifier.width(44.dp))
            Explanation(stringResource(R.string.shapes_line, stats.system.shortName, stats.system.weekStartsOn.displayName()))
        }
    }
}

/** A month silhouette: one square per day on a 7-column grid. */
@Composable
private fun MonthShapeGlyph(leadingBlanks: Int, days: Int, color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.aspectRatio(7f / 6f)) {
        val cell = size.width / 7f
        val dot = cell * 0.78f
        for (index in 0 until days) {
            val position = leadingBlanks + index
            drawRoundRect(
                color,
                topLeft = Offset((position % 7) * cell + (cell - dot) / 2, (position / 7) * cell + (cell - dot) / 2),
                size = Size(dot, dot),
                cornerRadius = CornerRadius(dot * 0.25f),
            )
        }
    }
}

/** New Year's Day weekday over seven years: drifting in Gregorian, fixed in 13-month. */
@Composable
private fun WeekdayDriftCard(year: Int, system: CalendarSystemId, modifier: Modifier) {
    val colors = Thirteen.colors
    val years = (year..minOf(year + 6, GregorianDate.MAX_YEAR)).toList()
    val text = stringResource(R.string.weekday_drift_text, system.shortName, system.weekStartsOn.displayName())
    ThirteenCard(modifier, title = stringResource(R.string.weekday_drift), subtitle = stringResource(R.string.weekday_drift_subtitle)) {
        CapFontScale(1.15f) {
            Column(Modifier.clearAndSetSemantics { }, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                DriftRow(label = {}, years) { y ->
                    Text(
                        Phrasing.displayYear(y, system),
                        style = ThirteenType.mono.copy(fontSize = 10.sp, textAlign = TextAlign.Center),
                        color = colors.inkTertiary,
                        maxLines = 1,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                DriftRow(label = { Eyebrow(stringResource(R.string.weekday_drift_greg), color = colors.foil) }, years) { y ->
                    Chip(GregorianDate(y, 1, 1).weekday, colors.foil, hatched = Thirteen.marksWithoutColor)
                }
                DriftRow(label = { Eyebrow(system.shortName.take(5), color = colors.accentText) }, years) { _ ->
                    Chip(system.weekStartsOn, colors.accent)
                }
            }
        }
        Explanation(text)
    }
}

@Composable
private fun DriftRow(label: @Composable () -> Unit, years: List<Int>, cell: @Composable (Int) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(46.dp)) { label() }
        for (y in years) Box(Modifier.weight(1f)) { cell(y) }
    }
}

@Composable
private fun Chip(weekday: Weekday, color: Color, hatched: Boolean = false) {
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 28.dp)
            .band(color, 0.22f, hatched),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            weekday.displayName(NameStyle.SHORT).take(2),
            style = ThirteenType.mono.copy(fontWeight = FontWeight.SemiBold),
            color = Thirteen.colors.ink,
            maxLines = 1,
        )
    }
}

private data class SystemColumn(
    val id: String,
    val name: String,
    val byline: String,
    val rows: List<Pair<String, String>>,
    val isSelected: Boolean,
    val tint: Color,
)

/** The three calendars' rules side by side. */
@Composable
private fun SystemsSideBySide(selected: CalendarSystemId) {
    val colors = Thirteen.colors
    val gregorian = GregorianCalendarInfo.GREGORIAN
    val months = stringResource(R.string.row_months)
    val weeks = stringResource(R.string.row_weeks)
    val leapDay = stringResource(R.string.row_leap_day)
    val yearNumber = stringResource(R.string.row_year_number)
    val outside = stringResource(R.string.row_outside_week)
    val columns = buildList {
        add(
            SystemColumn(
                "gregorian", gregorian.name, stringResource(R.string.system_byline, gregorian.inventor, gregorian.proposedYear.toString()),
                listOf(
                    months to stringResource(R.string.gregorian_months_value),
                    weeks to stringResource(R.string.gregorian_weeks_value),
                    leapDay to stringResource(R.string.gregorian_leap_value),
                    yearNumber to stringResource(R.string.gregorian_year_value),
                ),
                isSelected = false, tint = colors.foil,
            ),
        )
        for (system in CalendarSystem.ALL) {
            val names = system.intercalaryDays.map { it.name }
            val intercalary = if (names.size == 2) stringResource(R.string.and_join, names[0], names[1]) else names.joinToString()
            val leap = system.intercalaryDays.firstOrNull { it.leapOnly }
            val leapText = when {
                leap == null -> stringResource(R.string.none)
                leap.afterMonth == ThirteenDate.MONTHS_PER_YEAR -> stringResource(R.string.leap_end_of_year, leap.name)
                else -> stringResource(R.string.leap_after_month, leap.name, system.months[leap.afterMonth - 1].name)
            }
            val yearText = if (system.yearOffset == 0) {
                stringResource(R.string.year_number_gregorian)
            } else {
                stringResource(R.string.year_number_offset, -system.yearOffset, 1 - system.yearOffset)
            }
            add(
                SystemColumn(
                    system.id.id, system.name, stringResource(R.string.system_byline, system.inventor, system.proposedYear.toString()),
                    listOf(
                        months to stringResource(R.string.thirteen_months_value, system.months.joinToString(" ") { it.shortName }),
                        weeks to stringResource(R.string.thirteen_weeks_value, system.weekStartsOn.displayName()),
                        outside to intercalary,
                        leapDay to leapText,
                        yearNumber to yearText,
                    ),
                    isSelected = system.id == selected,
                    tint = if (system.id == selected) colors.accent else colors.inkSecondary,
                ),
            )
        }
    }
    val selectedLabel = stringResource(R.string.state_selected)
    ThirteenCard(title = stringResource(R.string.side_by_side)) {
        AdaptiveGrid(minCellWidth = 240.dp, spacing = Spacing.m) {
            columns.map { column ->
                @Composable { cellModifier: Modifier ->
                    val shape = RoundedCornerShape(Radius.control)
                    Column(
                        cellModifier
                            .background(colors.paperSunk.copy(alpha = 0.5f), shape)
                            .border(1.5.dp, if (column.isSelected) colors.accent.copy(alpha = 0.7f) else Color.Transparent, shape)
                            .padding(Spacing.m)
                            .semantics(mergeDescendants = true) { },
                        verticalArrangement = Arrangement.spacedBy(Spacing.s),
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(width = 18.dp, height = 4.dp).background(column.tint, CircleShape))
                            if (column.isSelected) Eyebrow(selectedLabel, color = colors.accentText)
                        }
                        Text(column.name, style = MaterialTheme.typography.titleMedium, color = colors.ink)
                        Text(column.byline, style = MaterialTheme.typography.bodySmall, color = colors.inkSecondary)
                        for ((title, value) in column.rows) {
                            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                                Eyebrow(title)
                                Text(value, style = MaterialTheme.typography.bodyMedium, color = colors.ink)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Preview(widthDp = 411, heightDp = 2600)
@Composable
private fun ComparePreview() {
    ThirteenAppTheme {
        CompareScreen(2026, CalendarSystemId.IFC, GregorianDate(2026, 10, 19), {}, {}, {}, {})
    }
}
