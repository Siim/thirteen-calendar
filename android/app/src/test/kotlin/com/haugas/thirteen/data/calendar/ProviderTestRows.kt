package com.haugas.thirteen.data.calendar

import android.provider.CalendarContract.Calendars
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.JavaTimeZoneResolver
import com.haugas.thirteen.core.events.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime

/** Rows and contexts shared by the provider JVM tests. Times are in Europe/Tallinn unless a test says otherwise. */
object ProviderTestRows {
    const val ZONE = "Europe/Tallinn"
    val zones = JavaTimeZoneResolver()
    val ctx = ZoneContext(ZONE, zones)

    /** Today of the mockup data set: Monday, October 19, 2026. */
    val today: GregorianDate = GregorianDate(2026, 10, 19)
    val env = StorageEnv(today, sdkInt = 37)

    /** The millisecond instant of a wall clock in [zone]. */
    fun ms(year: Int, month: Int, day: Int, hour: Int = 0, minute: Int = 0, zone: String = ZONE): Long =
        ZonedDateTime.of(year, month, day, hour, minute, 0, 0, ZoneId.of(zone)).toInstant().toEpochMilli()

    /** UTC midnight of a date. */
    fun utcMidnight(year: Int, month: Int, day: Int): Long = ms(year, month, day, zone = "UTC")

    fun local(text: String): LocalDateTime = LocalDateTime.parse(text)

    fun date(text: String): GregorianDate = GregorianDate.parse(text)

    val calendar = CalendarRow(
        id = 1, displayName = "Work", color = 0xFF2563EB.toInt(), accountName = "liis.kask@example.com", accountType = "com.google",
        accessLevel = Calendars.CAL_ACCESS_OWNER, ownerAccount = "liis.kask@example.com", maxReminders = 5, allowedReminders = "0,1,2",
        allowedAvailability = "0,1,2", isPrimary = true,
    )

    val otherAccount = CalendarRow(
        id = 2, displayName = "Thirteen", color = 0xFFEA580C.toInt(), accountName = "Thirteen", accountType = LOCAL_ACCOUNT_TYPE,
        accessLevel = Calendars.CAL_ACCESS_OWNER, ownerAccount = "Thirteen",
    )

    val calendars: Map<Long, CalendarRow> = listOf(calendar, otherAccount).associateBy { it.id }

    fun planner(env: StorageEnv = this.env): ProviderWritePlanner = ProviderWritePlanner(ctx, env, calendars)

    fun model(rows: SeriesRows): SeriesModel = SeriesModel(rows, ctx, CalendarSystemId.IFC)

    /** A timed event in Tallinn: [start] for [minutes]; repeating rows get `DURATION`, single rows `DTEND`. */
    fun timed(
        id: Long,
        start: Long,
        minutes: Long,
        rrule: String? = null,
        rdate: String? = null,
        exdate: String? = null,
        title: String = "Book club",
        uri: String? = null,
        calendarId: Long = 1,
    ): EventRow {
        val repeating = rrule != null || rdate != null
        return EventRow(
            id = id, calendarId = calendarId, title = title, dtStart = start,
            dtEnd = if (repeating) null else start + minutes * 60_000,
            duration = if (repeating) "P${minutes * 60}S" else null,
            timeZone = ZONE, endTimeZone = ZONE, rrule = rrule, rdate = rdate, exdate = exdate,
            customAppPackage = uri?.let { RecurrenceStorage.PACKAGE }, customAppUri = uri, status = 1,
        )
    }

    /** An exception row of [series] for the occurrence at [original]. */
    fun exception(id: Long, series: Long, original: Long, start: Long, minutes: Long, title: String = "Moved", canceled: Boolean = false, dirty: Boolean = false) =
        EventRow(
            id = id, calendarId = 1, title = title, dtStart = start, dtEnd = start + minutes * 60_000, timeZone = ZONE, endTimeZone = ZONE,
            originalId = series, originalInstanceTime = original, originalAllDay = false, status = if (canceled) 2 else 1, dirty = dirty,
        )
}
