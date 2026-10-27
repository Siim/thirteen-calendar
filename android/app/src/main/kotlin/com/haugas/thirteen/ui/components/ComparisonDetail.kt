package com.haugas.thirteen.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.Comparison
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.daysUntilYearDay
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.ui.Phrasing
import com.haugas.thirteen.ui.rememberPhrasing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/**
 * The full SPEC §3 comparison of one day, as labelled facts with plain-language explanations.
 * Used by the day comparison and the converter.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ComparisonDetail(comparison: Comparison, modifier: Modifier = Modifier, relativeToToday: Boolean = false) {
    val phrasing = rememberPhrasing()
    val system = comparison.thirteen.system
    val other = if (system == CalendarSystemId.IFC) CalendarSystemId.POSITIVIST else CalendarSystemId.IFC
    val daysInYear = comparison.daysIntoYear + 1 + comparison.daysRemainingInYear
    val untilYearDay = comparison.gregorian.daysUntilYearDay(system)
    val monthLengthValue = comparison.thirteenMonthDays?.let {
        stringResource(R.string.month_length_value, comparison.gregorianMonthDays, it)
    } ?: stringResource(R.string.month_length_value_no_month, comparison.gregorianMonthDays)
    val gregorianMonth = comparison.gregorian.monthInfo.name
    val monthLengthText = when (val t = comparison.thirteen) {
        is ThirteenMonthDate -> stringResource(
            R.string.month_length_text_month, gregorianMonth, comparison.gregorianMonthDays, t.system.shortName, t.monthInfo.name,
        )
        is ThirteenIntercalaryDate -> stringResource(
            R.string.month_length_text_intercalary, gregorianMonth, comparison.gregorianMonthDays, t.info.name,
        )
    }
    val yearKind = stringResource(if (comparison.isLeapYear) R.string.leap_year_long else R.string.common_year_long)
    val otherDate = comparison.thirteen.convertedTo(other)
    val otherText = otherDate.weekday?.let {
        stringResource(R.string.other_system_weekday, otherDate.formatted(FormatOptions.LONG), it.displayName())
    } ?: stringResource(R.string.other_system_no_weekday, otherDate.formatted(FormatOptions.LONG))

    Column(modifier.fillMaxWidth()) {
        FactRow(stringResource(R.string.fact_weekday)) { WeekdayShift(comparison) }
        FactRow(stringResource(R.string.label_drift), value = phrasing.driftAmount(comparison.labelDrift)) {
            Explanation(phrasing.labelDrift(comparison, relativeToToday))
        }
        FactRow(stringResource(R.string.fact_month_length), value = monthLengthValue) { Explanation(monthLengthText) }
        FactRow(
            stringResource(R.string.fact_day_of_year),
            value = stringResource(R.string.day_of_year_value, comparison.dayOfYear, daysInYear),
        ) {
            Explanation(stringResource(R.string.day_of_year_text, phrasing.days(comparison.daysIntoYear), comparison.daysRemainingInYear, yearKind))
        }
        FactRow(stringResource(R.string.fact_year_progress), value = phrasing.percent(comparison.yearProgress)) {
            YearProgress(comparison, showsCaption = false)
        }
        FactRow(
            Phrasing.yearDayName(system),
            value = if (untilYearDay == 0) stringResource(R.string.year_day_today) else stringResource(R.string.year_day_in, phrasing.days(untilYearDay)),
        )
        FactRow(stringResource(R.string.fact_numeric)) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.xl),
                verticalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                CodeChip(system.shortName, comparison.thirteen.formatted(FormatOptions.NUMERIC))
                CodeChip(stringResource(R.string.iso_8601), comparison.gregorian.isoString)
            }
        }
        FactRow(other.fullName, showsDivider = false) {
            Text(otherText, style = MaterialTheme.typography.bodyLarge, color = Thirteen.colors.ink)
        }
    }
}

@Composable
private fun CodeChip(label: String, code: String) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
        Eyebrow(label)
        SelectionContainer {
            Text(code, style = ThirteenType.code, color = Thirteen.colors.ink, maxLines = 1)
        }
    }
}

/** A labelled fact: title (and optional short value) over an explanation or a small view. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FactRow(
    title: String,
    modifier: Modifier = Modifier,
    value: String? = null,
    showsDivider: Boolean = true,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val colors = Thirteen.colors
    Column(modifier.fillMaxWidth()) {
        Column(
            Modifier.padding(vertical = Spacing.m),
            verticalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleSmall,
                    color = colors.ink,
                    modifier = Modifier.semantics { heading() },
                )
                if (value != null) {
                    Text(value, style = MaterialTheme.typography.titleMedium, color = colors.accentText)
                }
            }
            content?.invoke(this)
        }
        if (showsDivider) HorizontalDivider(color = colors.rule)
    }
}
