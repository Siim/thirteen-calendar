package com.haugas.thirteen.feature.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.Comparison
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.core.plusDaysOrNull
import com.haugas.thirteen.ui.components.AccentButton
import com.haugas.thirteen.ui.components.ComparisonDetail
import com.haugas.thirteen.ui.components.DatePlate
import com.haugas.thirteen.ui.components.Measure
import com.haugas.thirteen.ui.components.NavigationAction
import com.haugas.thirteen.ui.components.PageColumn
import com.haugas.thirteen.ui.components.PlateSize
import com.haugas.thirteen.ui.components.ScreenScaffold
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.theme.ThirteenAppTheme

/**
 * The full comparison of one day (the Apple app's day-detail sheet), with previous and next day
 * stepping. A full screen with a back arrow, or the detail pane next to the Year grid with a close
 * button. [events] is the day's Events section (docs/EVENTS.md §2.9, [DayEventsSection]), drawn
 * above the comparison, under the plate and the stepping buttons, as on the Apple sheet.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DayDetailScreen(
    date: GregorianDate,
    today: GregorianDate,
    system: CalendarSystemId,
    navigationAction: NavigationAction,
    onNavigate: () -> Unit,
    onDateChange: (GregorianDate) -> Unit,
    onOpenInConverter: (GregorianDate) -> Unit,
    modifier: Modifier = Modifier,
    events: @Composable () -> Unit = {},
) {
    val comparison = remember(date, system) { Comparison(date, system) }
    val previous = date.plusDaysOrNull(-1)
    val next = date.plusDaysOrNull(1)
    ScreenScaffold(
        title = comparison.thirteen.formatted(FormatOptions.MEDIUM),
        modifier = modifier,
        navigationAction = navigationAction,
        onNavigate = onNavigate,
    ) { padding ->
        PageColumn(padding, maxWidth = Measure.column) {
            DatePlate(comparison, size = PlateSize.Compact)
            FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
                verticalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                AccentButton(
                    stringResource(R.string.previous_day),
                    onClick = { previous?.let(onDateChange) },
                    icon = ThirteenIcons.ChevronLeft,
                    enabled = previous != null,
                )
                AccentButton(
                    stringResource(R.string.next_day),
                    onClick = { next?.let(onDateChange) },
                    trailingIcon = ThirteenIcons.ChevronRight,
                    enabled = next != null,
                )
                if (date != today) {
                    AccentButton(stringResource(R.string.action_today), onClick = { onDateChange(today) }, icon = ThirteenIcons.Today)
                }
            }
            events()
            ComparisonDetail(comparison, relativeToToday = date == today)
            AccentButton(
                stringResource(R.string.open_in_converter),
                onClick = { onOpenInConverter(date) },
                icon = ThirteenIcons.Convert,
            )
        }
    }
}

@Preview(widthDp = 411, heightDp = 1600)
@Composable
private fun DayDetailPreview() {
    ThirteenAppTheme {
        DayDetailScreen(
            GregorianDate(2024, 6, 17), GregorianDate(2026, 10, 19), CalendarSystemId.IFC,
            NavigationAction.Back, {}, {}, {},
        )
    }
}
