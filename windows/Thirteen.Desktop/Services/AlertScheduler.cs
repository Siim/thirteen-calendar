using System.Diagnostics;
using System.Globalization;
using System.Security;
using System.Text;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.Services;

/// <summary>One alert to schedule as a Windows toast (§2.14, §6.4).</summary>
/// <param name="Id">The toast id: <see cref="AlertPlanner.IdLength"/> hex digits of the SHA-256 of what it shows and when, so an unchanged alert keeps its id.</param>
/// <param name="Key">The occurrence key (§3.2).</param>
/// <param name="Index">The alarm's index in its component.</param>
/// <param name="FireAt">When it shows (UTC).</param>
/// <param name="Title">The event's title (user text).</param>
/// <param name="Body"><c>notification.body</c>.</param>
/// <param name="Day">The occurrence's first day on the device's wall clock: the toast opens <c>thirteen://day/{date}</c>.</param>
public sealed record PlannedAlert(string Id, string Key, int Index, DateTimeOffset FireAt, string Title, string Body, GregorianDate Day)
{
    /// <summary>The toast XML (§6.4): protocol activation through the <c>thirteen:</c> scheme, the title and the body.</summary>
    public string Xml => AlertPlanner.ToastXml(Title, Body, Day);

    /// <summary>The toast to hand to Windows.</summary>
    public ScheduledToast ToToast() => new(Id, Xml, FireAt);
}

/// <summary>
/// What alerts fire when (docs/EVENTS.md §2.14 "When an alert fires", §6.4 AlertScheduler): the pure part of the
/// scheduler, tested without Windows. Every alert of the visible local calendars (subscriptions never alert) whose fire
/// time, from <see cref="Alarm.FireTime(Alarm, bool, LocalDateTime, LocalDateTime?, string, IZoneResolver)"/> with the
/// occurrence's <c>StartUtc</c>, lies in the next <see cref="Days"/> days, at most <see cref="MaxAlerts"/>, earliest first.
/// Canceled occurrences have no alerts; <c>VALARM</c>s that are not alerts (<c>ACTION:EMAIL</c>, <c>NONE</c>) are skipped,
/// and an alarm core cannot place is skipped and logged as a code.
/// </summary>
public static class AlertPlanner
{
    /// <summary>Alerts are scheduled this many days ahead (§2.18 <c>settings.alerts.windows.footer</c>).</summary>
    public const int Days = 60;

    /// <summary>At most this many toasts are scheduled (§6.4).</summary>
    public const int MaxAlerts = 1000;

    /// <summary>
    /// How far before an occurrence's start an alert set in another app may fire and still be found: the occurrences
    /// read reach this far past the schedule's end ("1 week before" is the longest preset).
    /// </summary>
    public static readonly TimeSpan Lead = TimeSpan.FromDays(31);

    /// <summary>The alerts of <paramref name="store"/> that fire after <paramref name="now"/> and within <see cref="Days"/> days, earliest first.</summary>
    public static IReadOnlyList<PlannedAlert> Plan(IEventStore store, DateTimeOffset now, bool use24Hour)
    {
        ArgumentNullException.ThrowIfNull(store);
        if (!store.IsLoaded) return [];
        var zone = store.DeviceZone;
        var zones = store.Zones;
        var end = now + TimeSpan.FromDays(Days);
        var nowWall = Wall(now, zone, zones);
        var endWall = Wall(end + Lead, zone, zones);
        // Alerts after the start ("10 minutes after") of occurrences that started up to two days ago.
        var from = nowWall.AddMinutes(-2 * 1440);
        var calendars = store.Calendars.Where(c => !c.IsSubscription && c.Document is not null && c.Visible).ToDictionary(c => c.Id, StringComparer.Ordinal);
        var planned = new List<PlannedAlert>();
        IReadOnlyList<IcsExpandedEvent> occurrences;
        try
        {
            occurrences = store.Occurrences(from, endWall);
        }
        catch (Exception e) when (e is ThirteenException or ArgumentException)
        {
            Trace.WriteLine($"Thirteen: alerts not planned (expand-failed): {e.GetType().Name}");
            return [];
        }
        foreach (var occurrence in occurrences)
        {
            if (!calendars.TryGetValue(occurrence.CalendarId, out var calendar)) continue;
            if (occurrence.Status == EventStatus.Canceled || occurrence.Component.Alarms.Count == 0) continue;
            for (var index = 0; index < occurrence.Component.Alarms.Count; index++)
            {
                LocalDateTime? fire;
                try
                {
                    if (AlarmOf(occurrence.Component.Alarms[index], occurrence, calendar.Document!, zone, zones) is not { } alarm) continue;
                    fire = Alarm.FireTime(alarm, occurrence.AllDay, occurrence.Start, occurrence.StartUtc, zone, zones);
                }
                catch (ThirteenException)
                {
                    Trace.WriteLine("Thirteen: an alert was skipped (alarm-unplaceable)");
                    continue;
                }
                if (fire is not { } f) continue;
                var at = Instant(f);
                if (at <= now || at > end) continue;
                var body = Body(occurrence, use24Hour);
                planned.Add(new PlannedAlert(IdOf(occurrence.Key, at, occurrence.Title, body), occurrence.Key, index, at, occurrence.Title, body, occurrence.Start.Date));
            }
        }
        planned.Sort((a, b) =>
        {
            var c = a.FireAt.CompareTo(b.FireAt);
            if (c != 0) return c;
            c = string.CompareOrdinal(a.Key, b.Key);
            return c != 0 ? c : a.Index.CompareTo(b.Index);
        });
        // Two alarms of one occurrence at the same moment show once.
        var unique = new List<PlannedAlert>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var alert in planned)
        {
            if (!seen.Add(alert.Id)) continue;
            unique.Add(alert);
            if (unique.Count == MaxAlerts) break;
        }
        return unique;
    }

    /// <summary>
    /// A <c>VALARM</c> as core's <see cref="Alarm"/>: <c>DISPLAY</c> and <c>AUDIO</c> alarms only; a trigger relative to the
    /// end is counted from the start with the occurrence's length; an absolute trigger becomes a device wall clock (a
    /// zoned value through the document's zones, a floating one is the device's own). Null for alarms that are not alerts
    /// or cannot be placed.
    /// </summary>
    public static Alarm? AlarmOf(IcsAlarm alarm, IcsExpandedEvent occurrence, IcsCalendar document, string deviceZone, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(alarm);
        ArgumentNullException.ThrowIfNull(occurrence);
        if (alarm.Action is not ("DISPLAY" or "AUDIO")) return null;
        switch (alarm.Trigger)
        {
            case IcsTrigger.Relative relative:
            {
                var minutes = relative.Minutes + (relative.Related == IcsTriggerRelation.End ? occurrence.End.MinutesSince(occurrence.Start) : 0);
                return minutes is >= int.MinValue / 2 and <= int.MaxValue / 2 ? Alarm.Relative((int)minutes) : null;
            }
            case IcsTrigger.Absolute absolute:
            {
                LocalDateTime? utc = absolute.Value switch
                {
                    IcsDateValue.UtcValue u => u.Value,
                    IcsDateValue.ZonedValue z => IcsZones.ToUtc(z, IcsZones.Resolve(z.Tzid, document, zones)) ?? ZoneMath.ToUtc(z.Value, deviceZone, zones),
                    IcsDateValue.FloatingValue f => ZoneMath.ToUtc(f.Value, deviceZone, zones),
                    _ => null,
                };
                if (utc is not { } instant || ZoneMath.ToZoned(instant, deviceZone, zones) is not { } wall) return null;
                return Alarm.Absolute(wall);
            }
            default:
                return null;
        }
    }

    /// <summary><c>notification.body</c>: "19:00 to 21:00, Raamatukoi"; all-day "All day, {location}"; the location left out when empty.</summary>
    public static string Body(IcsExpandedEvent occurrence, bool use24Hour)
    {
        ArgumentNullException.ThrowIfNull(occurrence);
        var time = occurrence.AllDay
            ? CalendarStrings.AllDay
            : CalendarStrings.TimeRange(TimeText(occurrence.Start.Minute, use24Hour), TimeText(occurrence.End.Minute, use24Hour));
        return ImportStrings.NotificationBody(time, occurrence.Component.Location);
    }

    private static string TimeText(int minute, bool use24Hour)
    {
        minute = ((minute % 1440) + 1440) % 1440;
        var hour = minute / 60;
        var minutes = (minute % 60).ToString("00", CultureInfo.InvariantCulture);
        if (use24Hour) return $"{hour.ToString("00", CultureInfo.InvariantCulture)}:{minutes}";
        return $"{(hour % 12 == 0 ? 12 : hour % 12).ToString(CultureInfo.InvariantCulture)}:{minutes} {(hour < 12 ? "AM" : "PM")}";
    }

    /// <summary>
    /// The toast XML: <c>&lt;toast activationType="protocol" launch="thirteen://day/2026-10-19"&gt;</c> (§6.4), so a click
    /// reaches Thirteen through its URL scheme whether or not it runs, with the title and the body as text.
    /// </summary>
    public static string ToastXml(string title, string body, GregorianDate day)
    {
        var launch = "thirteen://day/" + day.ToIsoString();
        var xml = new StringBuilder();
        xml.Append("<toast activationType=\"protocol\" launch=\"").Append(SecurityElement.Escape(launch)).Append("\">");
        xml.Append("<visual><binding template=\"ToastGeneric\">");
        xml.Append("<text>").Append(SecurityElement.Escape(title.Length == 0 ? "Thirteen" : title)).Append("</text>");
        xml.Append("<text>").Append(SecurityElement.Escape(body)).Append("</text>");
        xml.Append("</binding></visual></toast>");
        return xml.ToString();
    }

    /// <summary>
    /// The length of a toast id: Windows refuses a scheduled toast whose id has 16 or more characters
    /// (<c>WPN_E_DEV_ID_SIZE</c>, 0x803E0120: "The size of the developer id for scheduled notification is too large"),
    /// found on Windows 11 build 26200 in task W11. 15 hex digits are 60 bits, ample for at most <see cref="MaxAlerts"/> toasts.
    /// </summary>
    public const int IdLength = 15;

    /// <summary>
    /// <see cref="IdLength"/> hex digits of the SHA-256 of the occurrence key, the fire time, the title and the body (not
    /// the alarm's index: two alarms of one occurrence at the same moment are one toast).
    /// </summary>
    public static string IdOf(string key, DateTimeOffset fireAt, string title, string body)
    {
        var text = string.Join('\u001f', key, fireAt.UtcTicks.ToString(CultureInfo.InvariantCulture), title, body);
        return StoreText.Sha256Hex(Encoding.UTF8.GetBytes(text))[..IdLength];
    }

    private static LocalDateTime Wall(DateTimeOffset instant, string zone, IZoneResolver zones)
    {
        var utc = instant.UtcDateTime;
        var value = new LocalDateTime(new GregorianDate(utc.Year, utc.Month, utc.Day), utc.Hour * 60 + utc.Minute);
        return ZoneMath.ToZoned(value, zone, zones) ?? value;
    }

    private static DateTimeOffset Instant(LocalDateTime utc) =>
        new DateTimeOffset(utc.Date.Year, utc.Date.Month, utc.Date.Day, 0, 0, 0, TimeSpan.Zero).AddMinutes(utc.Minute);
}

/// <summary>The alert scheduler of a run (§6.4): rebuilds Windows' toast schedule from the store.</summary>
public interface IAlertScheduler
{
    /// <summary>False once the toast platform turned out to be unavailable in this session (no AUMID registration, not Windows).</summary>
    bool IsEnabled { get; }

    /// <summary>Plans the alerts again and brings Windows' schedule in line with them.</summary>
    Task RebuildAsync();
}

/// <summary>
/// Thirteen's alerts on Windows (docs/EVENTS.md §2.14, §6.4 AlertScheduler): scheduled toasts for every alert in the next
/// 60 days (at most 1,000), rebuilt at start, after every change of the store (one second after the last of a burst), when
/// the device's time zone changes, and every 6 hours while Thirteen runs, so the 60 days move on. Windows shows them
/// whether or not Thirteen is running; a click opens <c>thirteen://day/{date}</c>. The schedule is cleared and rebuilt as
/// a set: a toast whose id (a hash of what it shows and when) is still planned stays, the others are removed and the new
/// ones added. When the notifier cannot be created (<c>dotnet run</c>, a copied folder: no shortcut or registration
/// carries the app user model id) the scheduler turns itself off for the session and logs a code. Planning runs after a
/// save has been written and never fails or undoes it.
/// </summary>
public sealed class AlertScheduler : IAlertScheduler, IDisposable
{
    private readonly IEventStore _store;
    private readonly IToastPlatform _platform;
    private readonly TimeProvider _time;
    private readonly Func<bool> _use24Hour;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly object _timers = new();
    private ITimer? _debounce;
    private ITimer? _periodic;
    private bool _started;
    private bool _disabled;
    private bool _disposed;

    /// <summary>A scheduler over <paramref name="store"/> scheduling through <paramref name="platform"/>.</summary>
    public AlertScheduler(IEventStore store, IToastPlatform platform, TimeProvider? time = null, Func<bool>? use24Hour = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _platform = platform ?? throw new ArgumentNullException(nameof(platform));
        _time = time ?? TimeProvider.System;
        _use24Hour = use24Hour ?? (() => EventStrings.Use24Hour);
    }

    /// <summary>How long after a change the schedule is rebuilt (a burst of writes rebuilds once).</summary>
    public TimeSpan Debounce { get; init; } = TimeSpan.FromSeconds(1);

    /// <summary>How often the schedule moves on while Thirteen runs.</summary>
    public TimeSpan Period { get; init; } = TimeSpan.FromHours(6);

    /// <inheritdoc />
    public bool IsEnabled => !_disabled;

    /// <summary>The alerts of the last rebuild (tests, diagnostics).</summary>
    public IReadOnlyList<PlannedAlert> LastPlan { get; private set; } = [];

    /// <summary>How many rebuilds ran.</summary>
    public int Rebuilds { get; private set; }

    /// <summary>Starts: a rebuild now (the store must have loaded), after every change, and every <see cref="Period"/>.</summary>
    public void Start()
    {
        if (_started || _disposed) return;
        _started = true;
        _store.Changed += OnStoreChanged;
        _periodic = _time.CreateTimer(_ => _ = RebuildAsync(), null, Period, Period);
        _ = RebuildAsync();
    }

    private void OnStoreChanged(object? sender, StoreChangedEventArgs e)
    {
        if (!e.Documents && !e.Index) return;
        Schedule();
    }

    /// <summary>The device's time zone changed: occurrences and alert times move, so the schedule is rebuilt.</summary>
    public void DeviceZoneChanged() => Schedule();

    private void Schedule()
    {
        if (_disposed || _disabled) return;
        lock (_timers)
        {
            _debounce?.Dispose();
            _debounce = _time.CreateTimer(_ => _ = RebuildAsync(), null, Debounce, Timeout.InfiniteTimeSpan);
        }
    }

    /// <inheritdoc />
    public async Task RebuildAsync()
    {
        if (_disposed || _disabled) return;
        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed || _disabled) return;
            await Task.Run(RebuildLocked).ConfigureAwait(false);
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            // Planning never fails a save (§2.14): log a code and keep the previous schedule.
            Trace.WriteLine($"Thirteen: alert planning failed (plan-failed, {e.GetType().Name})");
        }
        finally
        {
            _gate.Release();
        }
    }

    private void RebuildLocked()
    {
        if (!_platform.IsAvailable)
        {
            _disabled = true;
            Trace.WriteLine("Thirteen: alerts are off for this session (toasts-unavailable)");
            return;
        }
        var plan = AlertPlanner.Plan(_store, _time.GetUtcNow(), _use24Hour());
        var wanted = plan.ToDictionary(a => a.Id, StringComparer.Ordinal);
        var scheduled = _platform.ScheduledIds();
        var stale = scheduled.Where(id => !wanted.ContainsKey(id)).ToArray();
        if (stale.Length > 0) _platform.Remove(stale);
        var present = scheduled.ToHashSet(StringComparer.Ordinal);
        var adding = plan.Where(a => !present.Contains(a.Id)).Select(a => a.ToToast()).ToArray();
        var added = adding.Length > 0 ? _platform.Schedule(adding) : 0;
        LastPlan = plan;
        Rebuilds++;
        // What Windows took, not what was planned: a toast Windows refused is logged by the platform and counted here.
        Trace.WriteLine($"Thirteen: {plan.Count} alerts planned, {added} of {adding.Length} new ones scheduled, {stale.Length} removed" +
            (added < adding.Length ? $" (schedule-refused: {adding.Length - added})" : ""));
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _store.Changed -= OnStoreChanged;
        lock (_timers)
        {
            _debounce?.Dispose();
            _periodic?.Dispose();
        }
    }
}
