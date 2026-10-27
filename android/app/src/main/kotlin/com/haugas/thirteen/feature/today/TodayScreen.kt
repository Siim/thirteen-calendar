package com.haugas.thirteen.feature.today

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.Comparison
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.GregorianMonthLayout
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.IntercalaryOccurrence
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.ThirteenMonthLayout
import com.haugas.thirteen.core.daysUntilYearDay
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.ui.Phrasing
import com.haugas.thirteen.ui.components.AccentButton
import com.haugas.thirteen.ui.components.DatePlate
import com.haugas.thirteen.ui.components.Explanation
import com.haugas.thirteen.ui.components.Eyebrow
import com.haugas.thirteen.ui.components.Footnote
import com.haugas.thirteen.ui.components.GregorianMonthGrid
import com.haugas.thirteen.ui.components.IntercalaryBadge
import com.haugas.thirteen.ui.components.Measure
import com.haugas.thirteen.ui.components.PageColumn
import com.haugas.thirteen.ui.components.ScreenScaffold
import com.haugas.thirteen.ui.components.SettingsAction
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.SystemSwitcher
import com.haugas.thirteen.ui.components.ThirteenCard
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.components.ThirteenMonthGrid
import com.haugas.thirteen.ui.components.WeekdayShift
import com.haugas.thirteen.ui.components.YearProgress
import com.haugas.thirteen.ui.rememberPhrasing
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenAppTheme
import com.haugas.thirteen.ui.theme.ThirteenType

/**
 * Today (SPEC §5.1): today's 13-month date, its Gregorian equivalent, fixed vs real weekday, label
 * drift, 13-segment year progress, the countdown to Year Day, the current 13-month grid and, the
 * other way round, the current Gregorian month with its 13-month dates. Two columns on wide
 * windows. [upNext] is the "Up next" card of docs/EVENTS.md §2.8 (task D7), drawn under the hero
 * and before "Against the Gregorian calendar".
 */
@Composable
fun TodayScreen(
    today: GregorianDate,
    system: CalendarSystemId,
    onShowDetail: (GregorianDate) -> Unit,
    onSystemChange: (CalendarSystemId) -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
    upNext: @Composable () -> Unit = {},
) {
    val comparison = remember(today, system) { Comparison(today, system) }
    ScreenScaffold(
        title = stringResource(R.string.section_today),
        modifier = modifier,
        actions = {
            SystemSwitcher(system, onSystemChange)
            SettingsAction(onOpenSettings)
        },
    ) { padding ->
        TodayContent(comparison, padding, onShowDetail, upNext)
    }
}

@Composable
private fun TodayContent(comparison: Comparison, padding: PaddingValues, onShowDetail: (GregorianDate) -> Unit, upNext: @Composable () -> Unit) {
    BoxWithConstraints {
        val wide = maxWidth >= Measure.twoColumns + Spacing.l * 2
        PageColumn(padding) {
            if (wide) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.l)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
                        Hero(comparison)
                        upNext()
                        CountdownCard(comparison)
                        DifferenceCard(comparison, onShowDetail)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
                        MonthCard(comparison, onShowDetail)
                        GregorianMonthCard(comparison, onShowDetail)
                    }
                }
            } else {
                Hero(comparison)
                upNext()
                CountdownCard(comparison)
                DifferenceCard(comparison, onShowDetail)
                MonthCard(comparison, onShowDetail)
                GregorianMonthCard(comparison, onShowDetail)
            }
        }
    }
}

/** The hero plate: today's date as an almanac page over a faint 4 x 7 ruling and a low sun. */
@Composable
private fun Hero(comparison: Comparison) {
    val colors = Thirteen.colors
    val shape = RoundedCornerShape(Radius.hero)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(colors.paperRaised)
            .drawBehind {
                // A faint 4 x 7 grid fading in towards the bottom, and a low accent sun (for Sol).
                val cell = size.width / 7f
                val gridHeight = cell * 4f
                val originY = size.height - gridHeight
                val brush = Brush.verticalGradient(
                    listOf(colors.rule.copy(alpha = 0f), colors.rule.copy(alpha = 0.4f)),
                    startY = originY + gridHeight * 0.5f,
                    endY = size.height,
                )
                val stroke = 1.dp.toPx()
                for (column in 0..7) {
                    val x = column * cell
                    drawLine(brush, Offset(x, originY), Offset(x, size.height), stroke)
                }
                for (row in 0..4) {
                    val y = originY + row * cell
                    drawLine(brush, Offset(0f, y), Offset(size.width, y), stroke)
                }
                val radius = minOf(size.width, size.height) * 0.42f
                val center = Offset(size.width - radius * 0.25f, radius * 0.45f)
                drawCircle(
                    Brush.radialGradient(
                        listOf(colors.accent.copy(alpha = 0.32f), colors.accent.copy(alpha = 0f)),
                        center = center,
                        radius = radius,
                    ),
                    radius = radius,
                    center = center,
                )
            }
            .border(1.dp, colors.rule.copy(alpha = 0.6f), shape)
            .padding(Spacing.xl),
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        DatePlate(comparison)
        YearProgress(comparison)
    }
}

@Composable
private fun CountdownCard(comparison: Comparison) {
    val phrasing = rememberPhrasing()
    val colors = Thirteen.colors
    val system = comparison.thirteen.system
    val days = comparison.gregorian.daysUntilYearDay(system)
    val headline = phrasing.countdown(days, system)
    val description = Phrasing.withoutDashes(system.intercalaryDayInfo(IntercalaryDayId.YEAR_DAY).description)
    ThirteenCard(Modifier.clearAndSetSemantics { contentDescription = "$headline. $description" }) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.l), verticalAlignment = Alignment.CenterVertically) {
            Text(days.toString(), style = ThirteenType.numeral(48.sp), color = colors.accentText, maxLines = 1)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
                Text(headline, style = MaterialTheme.typography.titleMedium, color = colors.ink)
                Text(description, style = MaterialTheme.typography.bodySmall, color = colors.inkSecondary)
            }
        }
    }
}

@Composable
private fun DifferenceCard(comparison: Comparison, onShowDetail: (GregorianDate) -> Unit) {
    val phrasing = rememberPhrasing()
    val colors = Thirteen.colors
    val driftLabel = stringResource(R.string.label_drift)
    val driftValue = phrasing.driftAmount(comparison.labelDrift)
    val driftText = phrasing.labelDrift(comparison, relativeToToday = true)
    ThirteenCard(title = stringResource(R.string.today_against_gregorian)) {
        WeekdayShift(comparison)
        HorizontalDivider(color = colors.rule)
        Column(
            Modifier.clearAndSetSemantics { contentDescription = "$driftLabel: $driftValue. $driftText" },
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Eyebrow(driftLabel, Modifier.weight(1f))
                Text(driftValue, style = MaterialTheme.typography.titleMedium, color = colors.accentText)
            }
            Explanation(driftText)
        }
        AccentButton(
            stringResource(R.string.full_comparison),
            onClick = { onShowDetail(comparison.gregorian) },
            icon = ThirteenIcons.Details,
        )
    }
}

@Composable
private fun MonthCard(comparison: Comparison, onShowDetail: (GregorianDate) -> Unit) {
    val today = comparison.gregorian
    when (val thirteen = comparison.thirteen) {
        is ThirteenMonthDate -> {
            val layout = remember(thirteen) { ThirteenMonthLayout(thirteen.year, thirteen.month, thirteen.system) }
            val first = layout.weeks[0][0].gregorian.formatted(FormatOptions.SHORT)
            val last = layout.weeks[3][6].gregorian.formatted(FormatOptions.SHORT)
            ThirteenCard(
                title = stringResource(R.string.month_title, thirteen.monthInfo.name, thirteen.displayYear.toString()),
                subtitle = stringResource(R.string.gregorian_span, first, last),
            ) {
                ThirteenMonthGrid(layout, today = today, showsGregorian = true, onSelect = { onShowDetail(it.gregorian) })
                Footnote(stringResource(R.string.today_month_note, thirteen.system.weekStartsOn.displayName()))
            }
        }
        is ThirteenIntercalaryDate -> {
            val occurrence = remember(thirteen) {
                IntercalaryOccurrence.allInYear(thirteen.year, thirteen.system).first { it.id == thirteen.id }
            }
            ThirteenCard(
                title = stringResource(R.string.today_outside_grid),
                subtitle = stringResource(R.string.today_outside_grid_subtitle),
            ) {
                IntercalaryBadge(occurrence, isToday = true, onClick = { onShowDetail(today) })
            }
        }
    }
}

/** The current Gregorian month, ragged as it is, with each day's 13-month date. */
@Composable
private fun GregorianMonthCard(comparison: Comparison, onShowDetail: (GregorianDate) -> Unit) {
    val today = comparison.gregorian
    val system = comparison.thirteen.system
    val layout = remember(today.year, today.month, system) { GregorianMonthLayout(today.year, today.month, system) }
    val days = layout.days
    val first = days.first()
    val last = days.last()
    val noYear = FormatOptions(style = com.haugas.thirteen.core.DateStyle.SHORT, includeYear = false)
    val article = stringResource(if (system == CalendarSystemId.IFC) R.string.article_an else R.string.article_a)
    ThirteenCard(
        title = stringResource(R.string.today_gregorian_month_title, layout.monthInfo.name, today.year.toString()),
        subtitle = stringResource(
            R.string.today_gregorian_month_span,
            system.shortName,
            first.thirteen.formatted(noYear),
            last.thirteen.formatted(noYear),
        ),
    ) {
        GregorianMonthGrid(layout, today = today, onSelect = { onShowDetail(it.gregorian) })
        Footnote(
            stringResource(
                R.string.today_gregorian_month_note,
                layout.monthInfo.name,
                days.size,
                first.gregorianWeekday.displayName(),
                layout.weeks.size,
                system.shortName,
                article,
            ),
        )
    }
}

@Preview(widthDp = 411, heightDp = 1800)
@Composable
private fun TodayScreenPreview() {
    ThirteenAppTheme {
        TodayScreen(GregorianDate(2026, 10, 19), CalendarSystemId.IFC, {}, {}, {})
    }
}

@Preview(widthDp = 411, heightDp = 1400)
@Composable
private fun TodayYearDayPreview() {
    ThirteenAppTheme(dark = true) {
        TodayScreen(GregorianDate(2026, 12, 31), CalendarSystemId.POSITIVIST, {}, {}, {})
    }
}

