package com.haugas.thirteen.feature.settings

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.haugas.thirteen.testing.setThirteenContent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class LicensesScreenTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun showsTheBundledFontLicense() {
        var back = false
        compose.setThirteenContent { LicensesScreen(onBack = { back = true }) }
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodes(androidx.compose.ui.test.hasText("PREAMBLE")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("SIL OPEN FONT LICENSE Version 1.1", substring = true).assertExists()
        compose.onNodeWithText("Copyright 2024 The Geist Project Authors", substring = true).assertExists()
        compose.onNodeWithContentDescription("Back").performClick()
        assertTrue(back)
    }

    @Test
    fun reflowJoinsHardWrappedLinesAndKeepsHeadings() {
        val text = """
            Copyright 2024 Someone
            (https://example.com)

            ------------------
            SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
            ------------------

            PREAMBLE
            The goals of the
            license are simple.

            DISCLAIMER
            THE FONT SOFTWARE IS PROVIDED
            "AS IS".
        """.trimIndent()
        val blocks = licenseBlocks(text)
        assertEquals(4, blocks.size)
        assertEquals(LicenseBlock(null, "Copyright 2024 Someone (https://example.com)"), blocks[0])
        assertEquals(LicenseBlock(null, "SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007"), blocks[1])
        assertEquals(LicenseBlock("PREAMBLE", "The goals of the license are simple."), blocks[2])
        assertEquals("DISCLAIMER", blocks[3].heading)
        assertEquals("THE FONT SOFTWARE IS PROVIDED \"AS IS\".", blocks[3].body)
        assertNull(licenseBlocks("\n\n").firstOrNull())
    }
}
