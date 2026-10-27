package com.haugas.thirteen.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.stepYear
import com.haugas.thirteen.ui.Phrasing
import com.haugas.thirteen.ui.rememberPhrasing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/**
 * A big Geist year with previous and next buttons: the header of the Year and Compare screens.
 * [year] is Gregorian; the system's display year is shown (Positivist 238 with "Gregorian 2026").
 * TalkBack reads the year and its caption as one heading with "Previous year" and "Next year"
 * actions.
 */
@Composable
fun YearStepperHeader(
    year: Int,
    system: CalendarSystemId,
    onYearChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
) {
    val phrasing = rememberPhrasing()
    val colors = Thirteen.colors
    val displayYear = Phrasing.displayYear(year, system)
    val parts = buildList {
        phrasing.gregorianYearNote(year, system)?.let(::add)
        add(stringResource(if (GregorianDate.isValid(year, 2, 29)) R.string.leap_year_days else R.string.common_year_days))
        subtitle?.let(::add)
    }
    val caption = parts.joinToString(stringResource(R.string.caption_join))
    val previousLabel = stringResource(R.string.previous_year)
    val nextLabel = stringResource(R.string.next_year)
    val canGoBack = GregorianDate.stepYear(year, -1) != year
    val canGoForward = GregorianDate.stepYear(year, 1) != year
    val headerLabel = stringResource(R.string.year_header_a11y, displayYear, caption)

    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StepButton(ThirteenIcons.ChevronLeft, previousLabel, canGoBack) { onYearChange(GregorianDate.stepYear(year, -1)) }
        Column(
            Modifier
                .weight(1f)
                .clearAndSetSemantics {
                    heading()
                    contentDescription = headerLabel
                    customActions = buildList {
                        if (canGoBack) add(CustomAccessibilityAction(previousLabel) { onYearChange(GregorianDate.stepYear(year, -1)); true })
                        if (canGoForward) add(CustomAccessibilityAction(nextLabel) { onYearChange(GregorianDate.stepYear(year, 1)); true })
                    }
                },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xxs),
        ) {
            AnimatedContent(
                targetState = year,
                transitionSpec = {
                    val forward = targetState > initialState
                    (slideInVertically { if (forward) it / 2 else -it / 2 } + fadeIn()) togetherWith
                        (slideOutVertically { if (forward) -it / 2 else it / 2 } + fadeOut())
                },
                label = "year",
            ) { shown ->
                Text(
                    Phrasing.displayYear(shown, system),
                    style = ThirteenType.numeral(44.sp),
                    color = colors.ink,
                    maxLines = 1,
                )
            }
            Text(
                caption,
                style = MaterialTheme.typography.bodySmall,
                color = colors.inkSecondary,
                textAlign = TextAlign.Center,
            )
        }
        StepButton(ThirteenIcons.ChevronRight, nextLabel, canGoForward) { onYearChange(GregorianDate.stepYear(year, 1)) }
    }
}

@Composable
private fun StepButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
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
