package com.haugas.thirteen.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.NavMetadataKey
import androidx.navigation3.runtime.contains
import androidx.navigation3.runtime.metadata
import androidx.navigation3.scene.OverlayScene
import androidx.navigation3.scene.Scene
import androidx.navigation3.scene.SceneStrategy
import androidx.navigation3.scene.SceneStrategyScope
import com.haugas.thirteen.ui.theme.Thirteen

/** `true` inside a supporting pane: the pane closes with its Close icon (§2.1). */
val LocalInSupportingPane = staticCompositionLocalOf { false }

/**
 * An on-demand supporting pane on the trailing side of the entry below it (expanded windows,
 * docs/EVENTS.md §2.1, §2.15): the Calendars list beside the Calendar grid, 360 dp wide. The pane
 * is on the back stack only while open, so Back or its Close icon pops it and the main entry gets
 * its full width back. The scene's key is the main entry's, so the grid stays in place when the
 * pane opens or closes.
 */
class SupportingPaneScene(
    override val key: Any,
    override val previousEntries: List<NavEntry<Route>>,
    private val mainEntry: NavEntry<Route>,
    private val paneEntry: NavEntry<Route>,
) : Scene<Route> {
    override val entries: List<NavEntry<Route>> = listOf(mainEntry, paneEntry)

    override val content: @Composable () -> Unit = {
        Row(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f).fillMaxHeight()) { mainEntry.Content() }
            VerticalDivider(color = Thirteen.colors.rule)
            Box(
                Modifier
                    .width(PANE_WIDTH)
                    .fillMaxHeight()
                    .background(Thirteen.colors.paper),
            ) {
                CompositionLocalProvider(LocalInSupportingPane provides true) { paneEntry.Content() }
            }
        }
    }

    override fun equals(other: Any?): Boolean =
        other is SupportingPaneScene && key == other.key && previousEntries == other.previousEntries &&
            mainEntry == other.mainEntry && paneEntry == other.paneEntry

    override fun hashCode(): Int {
        var result = key.hashCode()
        result = 31 * result + previousEntries.hashCode()
        result = 31 * result + mainEntry.hashCode()
        result = 31 * result + paneEntry.hashCode()
        return result
    }

    companion object {
        /** The pane's width (§2.1). */
        val PANE_WIDTH: Dp = 360.dp

        /** Metadata of an entry shown as a supporting pane (a sheet on compact and medium windows). */
        fun pane(): Map<String, Any> = metadata { put(PaneKey, true) }
    }

    object PaneKey : NavMetadataKey<Boolean>
}

/**
 * The same entry on compact and medium windows: a modal bottom sheet over the entries below it
 * (the CalendarsSheet of §6.3). Dismissing the sheet (swipe, scrim, Back) pops the entry.
 */
@OptIn(ExperimentalMaterial3Api::class)
class SheetScene(
    override val key: Any,
    override val previousEntries: List<NavEntry<Route>>,
    override val overlaidEntries: List<NavEntry<Route>>,
    private val entry: NavEntry<Route>,
    private val onBack: () -> Unit,
) : OverlayScene<Route> {
    override val entries: List<NavEntry<Route>> = listOf(entry)

    override val content: @Composable () -> Unit = {
        ModalBottomSheet(
            onDismissRequest = onBack,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
            containerColor = Thirteen.colors.paperRaised,
        ) {
            Box(Modifier.fillMaxWidth().fillMaxHeight(0.9f)) { entry.Content() }
        }
    }

    override fun equals(other: Any?): Boolean =
        other is SheetScene && key == other.key && previousEntries == other.previousEntries && overlaidEntries == other.overlaidEntries && entry == other.entry

    override fun hashCode(): Int {
        var result = key.hashCode()
        result = 31 * result + previousEntries.hashCode()
        result = 31 * result + overlaidEntries.hashCode()
        result = 31 * result + entry.hashCode()
        return result
    }
}

/**
 * Shows an entry with [SupportingPaneScene.pane] metadata as a supporting pane beside the entry
 * below it on expanded windows, and as a [SheetScene] elsewhere; defers to the next strategy for
 * every other entry.
 */
class SupportingPaneSceneStrategy(private val isExpanded: Boolean) : SceneStrategy<Route> {
    override fun SceneStrategyScope<Route>.calculateScene(entries: List<NavEntry<Route>>): Scene<Route>? {
        val last = entries.lastOrNull() ?: return null
        if (!last.metadata.contains(SupportingPaneScene.PaneKey)) return null
        val main = entries.getOrNull(entries.lastIndex - 1) ?: return null
        val below = entries.dropLast(1)
        return if (isExpanded) {
            SupportingPaneScene(main.contentKey, below, main, last)
        } else {
            SheetScene(last.contentKey, below, below, last, onBack)
        }
    }
}
