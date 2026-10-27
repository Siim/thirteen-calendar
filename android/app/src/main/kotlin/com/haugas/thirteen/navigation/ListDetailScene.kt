package com.haugas.thirteen.navigation

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.material3.VerticalDivider
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
import androidx.navigation3.scene.Scene
import androidx.navigation3.scene.SceneStrategy
import androidx.navigation3.scene.SceneStrategyScope
import com.haugas.thirteen.ui.theme.Thirteen

/**
 * `true` inside the detail pane of a [ListDetailScene]: the detail closes with a close button
 * instead of showing a back arrow (the grid it belongs to is right next to it).
 */
val LocalInDetailPane = staticCompositionLocalOf { false }

/**
 * The Year grid and a day's comparison side by side (expanded windows). The list pane keeps the
 * grid at full height and takes the remaining width; the detail pane is a readable column. While
 * no day is open, the detail pane shows [placeholder], so selecting a day never reflows the grid.
 *
 * The scene's key is the list entry's, so NavDisplay keeps the scene in place when the detail
 * changes and the pane animates on its own.
 */
class ListDetailScene(
    override val key: Any,
    override val previousEntries: List<NavEntry<Route>>,
    private val listEntry: NavEntry<Route>,
    private val detailEntry: NavEntry<Route>?,
    private val placeholder: @Composable () -> Unit,
) : Scene<Route> {
    override val entries: List<NavEntry<Route>> = listOfNotNull(listEntry, detailEntry)

    override val content: @Composable () -> Unit = {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val detailWidth = detailPaneWidth(maxWidth)
            Row(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxHeight()) { listEntry.Content() }
                VerticalDivider(color = Thirteen.colors.rule)
                Box(
                    Modifier
                        .width(detailWidth)
                        .fillMaxHeight()
                        .background(Thirteen.colors.paper),
                ) {
                    CompositionLocalProvider(LocalInDetailPane provides true) {
                        AnimatedContent(
                            targetState = detailEntry,
                            contentKey = { it?.contentKey },
                            transitionSpec = {
                                (slideInHorizontally { it / 6 } + fadeIn()) togetherWith
                                    (slideOutHorizontally { it / 6 } + fadeOut())
                            },
                            label = "detailPane",
                        ) { entry ->
                            if (entry != null) entry.Content() else placeholder()
                        }
                    }
                }
            }
        }
    }

    // NavDisplay compares scenes to decide whether to animate; two scenes are the same when they
    // show the same entries in the same panes (the placeholder lambda does not change identity).
    override fun equals(other: Any?): Boolean =
        other is ListDetailScene &&
            key == other.key &&
            previousEntries == other.previousEntries &&
            listEntry == other.listEntry &&
            detailEntry == other.detailEntry

    override fun hashCode(): Int {
        var result = key.hashCode()
        result = 31 * result + previousEntries.hashCode()
        result = 31 * result + listEntry.hashCode()
        result = 31 * result + (detailEntry?.hashCode() ?: 0)
        return result
    }

    companion object {
        /** Metadata of the entry shown in the list pane. */
        fun listPane(): Map<String, Any> = metadata { put(ListKey, true) }

        /** Metadata of the entry shown in the detail pane. */
        fun detailPane(): Map<String, Any> = metadata { put(DetailKey, true) }

        /**
         * Metadata of an entry shown in a detail pane beside whatever entry it was opened from
         * (event details at expanded width, docs/EVENTS.md §2.10): that entry becomes the list pane.
         */
        fun besidePane(): Map<String, Any> = metadata { put(BesideKey, true) }

        /** About a third of the window, between 360 and 460 dp. */
        fun detailPaneWidth(total: Dp): Dp = (total * 0.36f).coerceIn(360.dp, 460.dp)
    }

    object ListKey : NavMetadataKey<Boolean>

    object DetailKey : NavMetadataKey<Boolean>

    object BesideKey : NavMetadataKey<Boolean>
}

/**
 * Shows a [ListDetailScene] on expanded windows when the last entry is a list entry, a detail entry
 * directly above its list entry, or a [ListDetailScene.besidePane] entry (beside the entry under
 * it); otherwise defers to the next strategy (single pane).
 */
class ListDetailSceneStrategy(
    private val isExpanded: Boolean,
    private val placeholder: @Composable () -> Unit,
) : SceneStrategy<Route> {
    override fun SceneStrategyScope<Route>.calculateScene(entries: List<NavEntry<Route>>): Scene<Route>? {
        if (!isExpanded) return null
        val last = entries.lastOrNull() ?: return null
        if (last.metadata.contains(ListDetailScene.ListKey)) {
            return ListDetailScene(last.contentKey, entries.dropLast(1), last, null, placeholder)
        }
        if (last.metadata.contains(ListDetailScene.DetailKey)) {
            val list = entries.getOrNull(entries.lastIndex - 1)
                ?.takeIf { it.metadata.contains(ListDetailScene.ListKey) } ?: return null
            return ListDetailScene(list.contentKey, entries.dropLast(1), list, last, placeholder)
        }
        if (last.metadata.contains(ListDetailScene.BesideKey)) {
            // Beside the entry it was opened from; over a detail (a day's comparison) it takes that
            // detail's place next to its list. Over the Calendars pane: no scene of its own.
            val below = entries.getOrNull(entries.lastIndex - 1) ?: return null
            if (below.metadata.contains(SupportingPaneScene.PaneKey)) return null
            val list = if (below.metadata.contains(ListDetailScene.DetailKey)) {
                entries.getOrNull(entries.lastIndex - 2)?.takeIf { it.metadata.contains(ListDetailScene.ListKey) } ?: return null
            } else {
                below
            }
            return ListDetailScene(list.contentKey, entries.dropLast(1), list, last, placeholder)
        }
        return null
    }
}
