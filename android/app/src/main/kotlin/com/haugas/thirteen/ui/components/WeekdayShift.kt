package com.haugas.thirteen.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.Comparison
import com.haugas.thirteen.core.NameStyle
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.ui.rememberPhrasing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/**
 * Fixed vs real weekday: two 7-day strips (13-month above, Gregorian below), each with its
 * weekday marked, plus the shift in plain language. TalkBack reads both weekdays and the sentence.
 */
@Composable
fun WeekdayShift(comparison: Comparison, modifier: Modifier = Modifier) {
    val phrasing = rememberPhrasing()
    val colors = Thirteen.colors
    val system = comparison.thirteen.system
    val sentence = phrasing.weekdayShift(comparison)
    val fixedName = comparison.thirteenWeekday?.displayName() ?: stringResource(R.string.weekday_no_weekday)
    val description = stringResource(
        R.string.weekday_strips_a11y,
        system.shortName,
        fixedName,
        comparison.gregorianWeekday.displayName(),
    ) + " " + sentence
    val order = Weekday.ordered(system.weekStartsOn)

    Column(
        modifier.clearAndSetSemantics { contentDescription = description },
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        CapFontScale {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m), verticalAlignment = Alignment.CenterVertically) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    Box(Modifier.height(28.dp), contentAlignment = Alignment.CenterStart) {
                        Eyebrow(system.shortName, color = colors.accentText)
                    }
                    Box(Modifier.height(28.dp), contentAlignment = Alignment.CenterStart) {
                        Eyebrow(stringResource(R.string.gregorian), color = colors.foil)
                    }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    Strip(order, comparison.thirteenWeekday, colors.accent, colors.onAccent)
                    Strip(order, comparison.gregorianWeekday, colors.foil, colors.onFoil)
                }
            }
        }
        Explanation(sentence)
    }
}

/** Seven weekday letters in the system's week order with one marked. */
@Composable
private fun Strip(order: List<Weekday>, marked: Weekday?, fill: Color, onFill: Color) {
    val colors = Thirteen.colors
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (weekday in order) {
            val isMarked = weekday == marked
            Box(
                Modifier
                    .weight(1f)
                    .height(28.dp)
                    .background(if (isMarked) fill else colors.paperSunk.copy(alpha = 0.7f), RoundedCornerShape(6.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    weekday.displayName(NameStyle.SHORT).take(2),
                    style = ThirteenType.mono.copy(fontWeight = if (isMarked) FontWeight.Bold else FontWeight.Normal),
                    color = if (isMarked) onFill else colors.inkTertiary,
                    maxLines = 1,
                )
            }
        }
    }
}
