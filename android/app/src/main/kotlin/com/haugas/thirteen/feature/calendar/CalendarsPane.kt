package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.haugas.thirteen.R
import com.haugas.thirteen.data.CalendarVisibility
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.feature.events.CalendarsList
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Thirteen

/**
 * The Calendars list for [Route.Calendars][com.haugas.thirteen.navigation.Route.Calendars]
 * (§2.1, §2.15): at expanded width the on-demand supporting pane beside the grid, with its title
 * and the Close icon (`editor.close`); in the compact and medium sheet, the title and the list
 * (the sheet closes by swiping down or Back). Close or Back pops the route, giving the grid its
 * full width back; nothing reopens it by itself. Opened by "Show calendars" ([focusFirstHidden]),
 * focus moves to the first hidden calendar's switch (§2.4 States).
 */
@Composable
fun CalendarsPane(
    visible: Set<CalendarVisibility.Ref>?,
    onVisibleChange: (Set<CalendarVisibility.Ref>?) -> Unit,
    inPane: Boolean,
    onClose: () -> Unit,
    onCreateDeviceCalendar: () -> Unit,
    modifier: Modifier = Modifier,
    focusFirstHidden: Boolean = false,
    onFocusHandled: () -> Unit = {},
) {
    val colors = Thirteen.colors
    val model = LocalCalendarEvents.current
    Column(
        modifier
            .fillMaxSize()
            .background(if (inPane) colors.paper else colors.paperRaised)
            .then(if (inPane) Modifier.statusBarsPadding() else Modifier),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.l, end = Spacing.xs, top = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.calendars_title),
                style = MaterialTheme.typography.titleLarge,
                color = colors.ink,
                modifier = Modifier
                    .weight(1f)
                    .semantics { heading() },
            )
            if (inPane) {
                IconButton(onClick = onClose) {
                    Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.editor_close))
                }
            }
        }
        CalendarsList(
            calendars = model?.calendars.orEmpty(),
            visible = visible,
            onVisibleChange = onVisibleChange,
            modifier = Modifier.weight(1f),
            onCreateDeviceCalendar = onCreateDeviceCalendar,
            focusFirstHidden = focusFirstHidden,
            onFocusHandled = onFocusHandled,
        )
    }
}
