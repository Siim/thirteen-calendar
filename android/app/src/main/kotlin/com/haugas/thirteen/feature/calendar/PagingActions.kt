package com.haugas.thirteen.feature.calendar

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import com.haugas.thirteen.navigation.CalendarMode

/**
 * "Paging without gestures" (docs/EVENTS.md §2.1): the custom actions "Previous month" and "Next
 * month" ("week", "day" in those modes) on the grid as well as on the title, so TalkBack's actions
 * menu and Switch Access page from wherever focus is. Compose does not hand a container's actions
 * to its children, so every element of the grid carries them after its own actions: Month's day
 * cells, the intercalary band and the large-text list's day headers, and the Week and Day columns.
 * An action is left out where the period cannot move (before year 1 or after 9999).
 */
@Composable
internal fun rememberPagingActions(mode: CalendarMode, state: CalendarModeState, page: (Int) -> Unit): List<CustomAccessibilityAction> {
    val (previousRes, nextRes) = CalendarPeriods.pagingLabels(mode)
    val previous = stringResource(previousRes)
    val next = stringResource(nextRes)
    val current by rememberUpdatedState(page)
    val canGoBack = CalendarPeriods.pageDate(mode, state.date, -1, state.system) != null
    val canGoForward = CalendarPeriods.pageDate(mode, state.date, 1, state.system) != null
    return remember(previous, next, canGoBack, canGoForward) {
        buildList {
            if (canGoBack) add(CustomAccessibilityAction(previous) { current(-1); true })
            if (canGoForward) add(CustomAccessibilityAction(next) { current(1); true })
        }
    }
}
