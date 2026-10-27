package com.haugas.thirteen.core.events

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File

/**
 * Loads fixtures/events.json (docs/EVENTS.md §5.5) straight from the repository; the file is never
 * copied into the Android project. Gradle passes the path as the `thirteen.eventsFixtures` system
 * property (android/core -> ../../fixtures/events.json, a declared test input). Without Gradle (an
 * IDE runner) the file is found by walking up from the working directory. A missing file is a test
 * failure, never a skip.
 */
object EventsFixture {
    /** Every section of the file, in publication order (the order of `counts`). The file is complete: no other key is allowed. */
    val SECTIONS: List<String> = listOf(
        "localDateTimes", "endForms", "wallClock", "zoneMath", "rrules", "rruleEquality", "untils", "dateLists",
        "thirteenRules", "ruleFromStart", "expansions", "endBefore", "splits", "retimes", "seriesEdits", "series",
        "recognitions", "presets", "descriptions", "nextOccurrences", "repeatNotes", "adaptations", "drafts", "newDrafts",
        "merges", "alarms", "alarmInstants", "chipTimes", "monthColumns", "monthLayouts", "weekLayouts", "dayLayouts",
        "agendas", "yearMarks", "zones", "zoneOffsets",
    )

    /** The envelope keys before the sections. */
    val ENVELOPE: List<String> = listOf("version", "complete", "generatedBy", "spec", "tzVersion", "counts")

    val file: File by lazy { locate() }

    val root: JsonObject by lazy { Json.parseToJsonElement(file.readText()).jsonObject }

    fun section(name: String): JsonArray =
        (root[name] ?: throw AssertionError("fixtures/events.json has no section \"$name\"")).jsonArray

    /** The `RecordedZoneResolver` of the file: its `zoneOffsets` and nothing else. */
    val recorded: RecordedZoneResolver by lazy { RecordedZoneResolver(section("zoneOffsets")) }

    private fun locate(): File {
        val looked = mutableListOf<String>()
        System.getProperty("thirteen.eventsFixtures")?.let { path ->
            val file = File(path)
            if (file.isFile) return file
            looked += file.absolutePath
        }
        var directory: File? = File(System.getProperty("user.dir")).absoluteFile
        while (directory != null) {
            val candidate = File(directory, "fixtures/events.json")
            if (candidate.isFile && File(directory, "docs/EVENTS.md").isFile) return candidate
            looked += candidate.path
            directory = directory.parentFile
        }
        throw AssertionError(
            "Events fixtures not found: fixtures/events.json is required (looked at ${looked.joinToString()}). " +
                "Run the tests from the repository checkout; they are never skipped.",
        )
    }
}
