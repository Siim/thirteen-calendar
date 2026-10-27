package com.haugas.thirteen.data.calendar

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.CalendarContract
import android.provider.CalendarContract.CalendarAlerts
import android.provider.CalendarContract.Calendars
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.net.toUri
import com.haugas.thirteen.MainActivity
import com.haugas.thirteen.R
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.data.SettingsRepository
import com.haugas.thirteen.feature.calendar.EventTimeFormat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/** Thirteen's own LOCAL "Thirteen" calendar (§6.3 `account_name = Thirteen`, `account_type = LOCAL`). */
fun isThirteenDeviceCalendar(calendar: com.haugas.thirteen.core.events.CalendarInfo): Boolean =
    calendar.accountKind == com.haugas.thirteen.core.events.CalendarAccountKind.DEVICE && calendar.accountTitle == ProviderCalendarRepository.DEVICE_ACCOUNT

/**
 * The V18 fallback (docs/EVENTS.md §2.14, §6.3): alerts for events in Thirteen's own LOCAL "Thirteen"
 * calendar, which the device's calendar app may not show. The Calendar Provider broadcasts
 * `EVENT_REMINDER` (an implicit broadcast that manifest receivers still get) when an alert is due;
 * this receiver reads the due `CalendarAlerts` rows in state `SCHEDULED` or `FIRED`, keeps only
 * events of the "Thirteen" calendar, and posts one notification per alert (channel "Event alerts",
 * title the event's title, text `notification.body`, a tap opens `thirteen://day/{date}`), unless
 * the Settings switch "Show alerts for the Thirteen calendar" is off or notifications are not
 * allowed. It never changes `CalendarAlerts` rows, so a calendar app that also handles them keeps
 * working, and it reads nothing from the broadcast itself: the intent is untrusted, the provider's
 * rows are the source. Still no network access.
 */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!ProviderGates.THIRTEEN_CALENDAR_ALERTS || intent.action != CalendarContract.ACTION_EVENT_REMINDER) return
        val app = context.applicationContext
        val done = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                post(app, System.currentTimeMillis())
            } catch (e: Exception) {
                // A broken provider row or a revoked permission must not crash the process.
                Log.w(TAG, "Alerts not shown: ${e.javaClass.simpleName}")
            } finally {
                done.finish()
            }
        }
    }

    companion object {
        private const val TAG = "ThirteenAlerts"

        /** The notification channel (§6.3 "Event alerts"). */
        const val CHANNEL_ID: String = "event_alerts"

        /** Alerts already posted (keys with their alarm time), so a later broadcast does not post them again. */
        private const val POSTED_FILE = "thirteen_alerts_posted"

        /** In [POSTED_FILE]: the notification permission was asked once (§2.14: asked when the first alert is set). */
        private const val ASKED_KEY = "_permissionAsked"

        /** Alerts due longer ago than this are not posted any more (a missed broadcast while the device was off). */
        private const val LATE_LIMIT_MS: Long = 24 * 60 * 60 * 1000L

        /** Whether Thirteen may post notifications now (the switch aside). */
        fun notificationsAllowed(context: Context): Boolean {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                return false
            }
            return NotificationManagerCompat.from(context).areNotificationsEnabled()
        }

        /** Whether this is the first time Thirteen asks for the notification permission (and records that it did). */
        fun firstPermissionAsk(context: Context): Boolean {
            val prefs = context.getSharedPreferences(POSTED_FILE, Context.MODE_PRIVATE)
            if (prefs.getBoolean(ASKED_KEY, false)) return false
            prefs.edit { putBoolean(ASKED_KEY, true) }
            return true
        }

        /** Opens Thirteen's notification settings (`alert.android.openSettings`). */
        fun openNotificationSettings(context: Context) {
            val intent = Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
            try {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: android.content.ActivityNotFoundException) {
                // No settings screen: nothing to open.
            }
        }

        /** Creates the "Event alerts" channel (idempotent). */
        fun ensureChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            val channel = NotificationChannel(CHANNEL_ID, context.getString(R.string.notification_channel_alerts), NotificationManager.IMPORTANCE_HIGH)
            manager.createNotificationChannel(channel)
        }

        /** The ids of Thirteen's own LOCAL calendars (§6.3 `account_name = Thirteen`, `account_type = LOCAL`). */
        private fun thirteenCalendars(context: Context): List<Long> = context.contentResolver.query(
            Calendars.CONTENT_URI,
            arrayOf(Calendars._ID),
            "${Calendars.ACCOUNT_NAME} = ? AND ${Calendars.ACCOUNT_TYPE} = ?",
            arrayOf(ProviderCalendarRepository.DEVICE_ACCOUNT, LOCAL_ACCOUNT_TYPE),
            null,
        )?.use { c -> buildList { while (c.moveToNext()) add(c.getLong(0)) } }.orEmpty()

        /** One due alert of the "Thirteen" calendar. */
        internal data class DueAlert(
            val eventId: Long,
            val begin: Long,
            val end: Long,
            val alarmTime: Long,
            val title: String,
            val location: String,
            val allDay: Boolean,
        ) {
            val key: String get() = "$eventId|$begin|$alarmTime"
        }

        /** Reads the due alerts and posts the ones not posted yet. */
        internal suspend fun post(context: Context, now: Long) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED) return
            val settings = SettingsRepository.from(context).settings.first()
            if (!settings.showEvents || !settings.thirteenCalendarAlerts || !notificationsAllowed(context)) return
            val calendars = thirteenCalendars(context)
            if (calendars.isEmpty()) return
            val due = dueAlerts(context, calendars, now)
            if (due.isEmpty()) return
            ensureChannel(context)
            val posted = context.getSharedPreferences(POSTED_FILE, Context.MODE_PRIVATE)
            val manager = NotificationManagerCompat.from(context)
            posted.edit {
                // Forget alerts long past, so the file stays small.
                for ((key, value) in posted.all) if (value is Long && value < now - 2 * LATE_LIMIT_MS) remove(key)
                for (alert in due) {
                    if (posted.contains(alert.key)) continue
                    try {
                        manager.notify(alert.key, 0, notification(context, alert))
                    } catch (_: SecurityException) {
                        break
                    }
                    putLong(alert.key, alert.alarmTime)
                }
            }
        }

        private fun dueAlerts(context: Context, calendars: List<Long>, now: Long): List<DueAlert> = context.contentResolver.query(
            CalendarAlerts.CONTENT_URI,
            arrayOf(
                CalendarAlerts.EVENT_ID, CalendarAlerts.BEGIN, CalendarAlerts.END, CalendarAlerts.ALARM_TIME,
                CalendarAlerts.TITLE, CalendarAlerts.EVENT_LOCATION, CalendarAlerts.ALL_DAY,
            ),
            "${CalendarAlerts.STATE} IN (${CalendarAlerts.STATE_SCHEDULED}, ${CalendarAlerts.STATE_FIRED}) AND " +
                "${CalendarAlerts.ALARM_TIME} <= ? AND ${CalendarAlerts.ALARM_TIME} >= ? AND " +
                "${CalendarAlerts.CALENDAR_ID} IN (${calendars.joinToString(",")})",
            arrayOf(now.toString(), (now - LATE_LIMIT_MS).toString()),
            "${CalendarAlerts.ALARM_TIME} ASC",
        )?.use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(
                        DueAlert(
                            eventId = c.getLong(0),
                            begin = c.getLong(1),
                            end = c.getLong(2),
                            alarmTime = c.getLong(3),
                            title = c.getString(4).orEmpty(),
                            location = c.getString(5).orEmpty(),
                            allDay = c.getInt(6) == 1,
                        ),
                    )
                }
            }
        }.orEmpty().distinctBy { it.key }

        /** `notification.body` (§2.19): "{time range}, {location}"; all-day "All day, {location}"; no location, the first part only. */
        internal fun body(context: Context, alert: DueAlert, zone: ZoneId, use24Hour: Boolean, locale: Locale): String {
            val first = if (alert.allDay) {
                context.getString(R.string.event_allDay)
            } else {
                val times = EventTimeFormat(use24Hour, locale)
                val start = Instant.ofEpochMilli(alert.begin).atZone(zone)
                val end = Instant.ofEpochMilli(maxOf(alert.begin, alert.end)).atZone(zone)
                context.getString(R.string.event_timeRange, times.time(start.hour * 60 + start.minute), times.time(end.hour * 60 + end.minute))
            }
            return if (alert.location.isBlank()) first else context.getString(R.string.notification_body, first, alert.location)
        }

        /** The day the alert's occurrence starts on: the UTC date for all-day events, else the device's. */
        internal fun day(alert: DueAlert, zone: ZoneId): GregorianDate {
            val date = Instant.ofEpochMilli(alert.begin).atZone(if (alert.allDay) ZoneOffset.UTC else zone).toLocalDate()
            return GregorianDate.from(date)
        }

        private fun notification(context: Context, alert: DueAlert): android.app.Notification {
            val zone = ZoneId.systemDefault()
            val locale = context.resources.configuration.locales[0] ?: Locale.ROOT
            val body = body(context, alert, zone, android.text.format.DateFormat.is24HourFormat(context), locale)
            // The tap opens the day in Thirteen (thirteen://day/{date}), an explicit intent to MainActivity.
            val open = Intent(Intent.ACTION_VIEW, "thirteen://day/${day(alert, zone).isoString}".toUri(), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            val tap = PendingIntent.getActivity(context, alert.key.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val title = alert.title.ifBlank { context.getString(R.string.editor_defaultTitle) }
            return NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setWhen(alert.begin)
                .setShowWhen(!alert.allDay)
                .setContentIntent(tap)
                .setAutoCancel(true)
                .build()
        }
    }
}
