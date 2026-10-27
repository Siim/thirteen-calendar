package com.haugas.thirteen.navigation

import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.navigation.DeepLink.Destination
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The same cases as the Apple app's DeepLinkTests (apple/Tests/AppModelTests.swift), plus Android-only inputs. */
class DeepLinkTest {
    private fun day(iso: String) = GregorianDate.parse(iso)

    @Test
    fun everyDocumentedLinkParses() {
        val cases = listOf(
            "thirteen://today" to DeepLink(Destination.Today),
            "thirteen://year/2026" to DeepLink(Destination.Year(2026, null)),
            "thirteen://year/2024?day=2024-06-17" to DeepLink(Destination.Year(2024, day("2024-06-17"))),
            "thirteen://convert?date=2026-10-19" to DeepLink(Destination.Convert(day("2026-10-19"), ConvertDirection.FROM_GREGORIAN)),
            "thirteen://convert/2026-10-19" to DeepLink(Destination.Convert(day("2026-10-19"), ConvertDirection.FROM_GREGORIAN)),
            "thirteen://compare/2024" to DeepLink(Destination.Compare(2024)),
            "thirteen://compare?year=2024" to DeepLink(Destination.Compare(2024)),
            "thirteen://history" to DeepLink(Destination.History),
            "THIRTEEN://Today?system=positivist" to DeepLink(Destination.Today, CalendarSystemId.POSITIVIST),
            "thirteen:///year/2026" to DeepLink(Destination.Year(2026, null)),
            "thirteen:year/2026" to DeepLink(Destination.Year(2026, null)),
            // The Calendar (docs/EVENTS.md §2.1, §6.3)
            "thirteen://calendar" to DeepLink(Destination.Calendar),
            "thirteen://month/2026/11" to DeepLink(Destination.Month(2026, 11)),
            "thirteen://month?year=2026&month=13&system=positivist" to DeepLink(Destination.Month(2026, 13), CalendarSystemId.POSITIVIST),
            "thirteen://month" to DeepLink(Destination.Month(null, null)),
            "thirteen://week/2026-10-19" to DeepLink(Destination.Week(day("2026-10-19"))),
            "thirteen://day/2024-02-29" to DeepLink(Destination.Day(day("2024-02-29"))),
            "thirteen://day?date=2026-10-19" to DeepLink(Destination.Day(day("2026-10-19"))),
            "thirteen://new-event?date=2026-10-21" to DeepLink(Destination.NewEvent(day("2026-10-21"))),
            "thirteen://new-event" to DeepLink(Destination.NewEvent(null)),
        )
        for ((text, expected) in cases) {
            assertEquals(text, expected, DeepLink.parse(text))
        }
    }

    @Test
    fun thirteenNumericInputUsesTheSystemsDisplayYear() {
        assertEquals(
            DeepLink(Destination.Convert(day("2026-10-19"), ConvertDirection.FROM_THIRTEEN), CalendarSystemId.POSITIVIST),
            DeepLink.parse("thirteen://convert?thirteen=0238-M11-12&system=positivist"),
        )
        assertEquals(
            Destination.Convert(day("2024-06-17"), ConvertDirection.FROM_THIRTEEN),
            DeepLink.parse("thirteen://convert?thirteen=2024-LD")?.destination,
        )
    }

    @Test
    fun badValuesKeepTheDestination() {
        val cases = listOf(
            "thirteen://year/0" to Destination.Year(null, null),
            "thirteen://year/10000" to Destination.Year(null, null),
            "thirteen://year/abc" to Destination.Year(null, null),
            "thirteen://compare/-5" to Destination.Compare(null),
            "thirteen://convert?date=2026-02-30" to Destination.Convert(null, null),
            "thirteen://convert?date=2026-M11-12" to Destination.Convert(null, null),
            "thirteen://convert?thirteen=2025-LD" to Destination.Convert(null, null),
            "thirteen://today?system=julian" to Destination.Today,
            "thirteen://month/2026/14" to Destination.Month(2026, null),
            "thirteen://month/2026/0" to Destination.Month(2026, null),
            "thirteen://month/0/3" to Destination.Month(null, 3),
            "thirteen://week/2026-02-30" to Destination.Week(null),
            "thirteen://day/tomorrow" to Destination.Day(null),
            "thirteen://new-event?date=2026-13-01" to Destination.NewEvent(null),
        )
        for ((text, expected) in cases) {
            assertEquals(text, expected, DeepLink.parse(text)?.destination)
        }
        assertNull(DeepLink.parse("thirteen://today?system=julian")?.system)
    }

    @Test
    fun rejectsForeignLinksAndGarbage() {
        val rejected = listOf(
            null,
            "",
            "https://example.com/year/2026",
            "thirteen://",
            "thirteen://settings",
            "other://today",
            "thirteen://to day",
            "thirteen://year/%zz",
            "thirteen://today?" + "a=b&".repeat(600),
        )
        for (text in rejected) {
            assertNull(text?.take(60), DeepLink.parse(text))
        }
    }

    @Test
    fun queryNamesIgnoreCaseAndTheLastValueWins() {
        assertEquals(Destination.Compare(2024), DeepLink.parse("thirteen://compare?YEAR=2020&year=2024")?.destination)
        assertEquals(CalendarSystemId.IFC, DeepLink.parse("thirteen://today?system=positivist&System=IFC")?.system)
        assertEquals(Destination.Year(2026, day("2026-10-19")), DeepLink.parse("thirteen://year/2026?day=2026-10-19&ignored")?.destination)
    }

    @Test
    fun linksRoundTrip() {
        val links = listOf(
            DeepLink(Destination.Today),
            DeepLink(Destination.Year(2026, day("2026-10-19"))),
            DeepLink(Destination.Convert(day("2026-10-19"), ConvertDirection.FROM_GREGORIAN)),
            DeepLink(Destination.Compare(2024), CalendarSystemId.POSITIVIST),
            DeepLink(Destination.History),
            DeepLink(Destination.Calendar),
            DeepLink(Destination.Month(2026, 11), CalendarSystemId.IFC),
            DeepLink(Destination.Month(null, null)),
            DeepLink(Destination.Month(2027, null)),
            DeepLink(Destination.Month(null, 13)),
            DeepLink(Destination.Week(day("2026-12-31"))),
            DeepLink(Destination.Day(day("2026-10-19"))),
            DeepLink(Destination.Day(null)),
            DeepLink(Destination.NewEvent(day("2026-10-21"))),
            DeepLink(Destination.NewEvent(null)),
        )
        for (link in links) {
            assertEquals(link.toUriString(), link, DeepLink.parse(link.toUriString()))
        }
    }
}
