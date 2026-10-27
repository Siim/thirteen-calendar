using System.Collections.Concurrent;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;

namespace Thirteen.Desktop.Services;

/// <summary>
/// The zone data of the Windows app (docs/EVENTS.md §6.4): an <see cref="IZoneResolver"/> on
/// <see cref="TimeZoneInfo.GetUtcOffset(DateTime)"/> at UTC instants. IANA ids (<c>Europe/Tallinn</c>) are found
/// through <see cref="TimeZoneInfo.FindSystemTimeZoneById"/> (ICU maps them to registry zones on Windows 10 1903 and
/// later; tzdata on macOS and Linux), then through <see cref="TimeZoneInfo.TryConvertIanaIdToWindowsId(string, out string)"/>,
/// then through the CLDR Windows table of Thirteen.Core (a registry zone whose Windows id maps to that IANA id). Every
/// conversion rule lives in core's <see cref="ZoneMath"/>; nothing here calls
/// <see cref="TimeZoneInfo.ConvertTime(DateTime, TimeZoneInfo)"/>, which throws in gaps and picks the later instant
/// in overlaps (§3.1.1, §6.4). Windows ids are not accepted as zone ids: files name them in <c>TZID</c>s, and the
/// <c>.ics</c> module maps them to IANA first (§5.4). Thread-safe.
/// </summary>
public sealed class WindowsZoneResolver : IZoneResolver
{
    private readonly ConcurrentDictionary<string, TimeZoneInfo?> _zones = new(StringComparer.Ordinal);
    private static readonly Lazy<Dictionary<string, string>> RegistryByIana = new(BuildRegistryByIana);

    /// <summary>A shared instance (zones are cached per id).</summary>
    public static WindowsZoneResolver Shared { get; } = new();

    /// <inheritdoc />
    public bool IsKnown(string tzid) => Find(tzid) is not null;

    /// <inheritdoc />
    public int OffsetMinutesAt(string tzid, LocalDateTime utc)
    {
        var zone = Find(tzid) ?? throw new ThirteenException(ThirteenErrorKind.InvalidEvent, $"Unknown time zone \"{tzid}\"");
        var instant = new DateTime(utc.Date.Year, utc.Date.Month, utc.Date.Day, 0, 0, 0, DateTimeKind.Utc).AddMinutes(Math.Min(utc.Minute, 1439));
        TimeSpan offset;
        try
        {
            offset = zone.GetUtcOffset(instant);
        }
        catch (ArgumentOutOfRangeException)
        {
            // At the very edges of DateTime the zone's local time leaves its range; two days inward has the same rule.
            offset = zone.GetUtcOffset(instant.Year == 1 ? instant.AddDays(2) : instant.AddDays(-2));
        }
        return (int)(offset.Ticks / TimeSpan.TicksPerMinute);
    }

    /// <summary>Forgets the cached zones (after <see cref="TimeZoneInfo.ClearCachedData"/>).</summary>
    public void ClearCache() => _zones.Clear();

    private TimeZoneInfo? Find(string? tzid)
    {
        if (string.IsNullOrEmpty(tzid)) return null;
        return _zones.GetOrAdd(tzid, static id =>
        {
            if (id is "UTC" or "Etc/UTC") return TimeZoneInfo.Utc;
            // A Windows id is not an event zone (the .ics module maps it first); only IANA ids are answered.
            if (!id.Contains('/', StringComparison.Ordinal) && IcsZones.WindowsZoneToIana(id) is not null) return null;
            if (TryFind(id) is { } direct) return direct;
            if (TimeZoneInfo.TryConvertIanaIdToWindowsId(id, out var windowsId) && TryFind(windowsId) is { } converted) return converted;
            return RegistryByIana.Value.TryGetValue(id, out var registry) ? TryFind(registry) : null;
        });
    }

    private static TimeZoneInfo? TryFind(string id)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id);
        }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException or ArgumentException or System.Security.SecurityException)
        {
            return null;
        }
    }

    /// <summary>The registry zones of this system by the IANA id the CLDR table gives their Windows id (Windows only).</summary>
    private static Dictionary<string, string> BuildRegistryByIana()
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!OperatingSystem.IsWindows()) return map;
        foreach (var zone in TimeZoneInfo.GetSystemTimeZones())
        {
            if (IcsZones.WindowsZoneToIana(zone.Id) is { } iana) map.TryAdd(iana, zone.Id);
        }
        return map;
    }

    /// <summary>
    /// The device zone as an IANA id: <see cref="TimeZoneInfo.Local"/>'s id when it is one (macOS, Linux), else its
    /// Windows id through ICU (<see cref="TimeZoneInfo.TryConvertWindowsIdToIanaId(string, out string)"/>) or the CLDR
    /// table; <c>UTC</c> when the zone is unknown.
    /// </summary>
    public static string DeviceZoneId() => IanaIdOf(TimeZoneInfo.Local);

    /// <summary>The IANA id of a system zone (see <see cref="DeviceZoneId"/>).</summary>
    public static string IanaIdOf(TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);
        if (zone.Id is "UTC" or "Etc/UTC" or "Coordinated Universal Time") return "UTC";
        string? iana = null;
        if (zone.HasIanaId) iana = zone.Id;
        else if (TimeZoneInfo.TryConvertWindowsIdToIanaId(zone.Id, out var converted)) iana = converted;
        else iana = IcsZones.WindowsZoneToIana(zone.Id);
        return iana is not null && Shared.IsKnown(iana) ? iana : "UTC";
    }
}

/// <summary>
/// Notices a change of the device's time zone (§6.4): on the one-minute timer and on window activation the app calls
/// <see cref="Check"/>, which clears <see cref="TimeZoneInfo"/>'s cache and compares the local zone's id and its
/// current UTC offset with the last values. No <c>Microsoft.Win32.SystemEvents</c>.
/// </summary>
public sealed class DeviceZoneMonitor
{
    private readonly Func<(string Id, TimeSpan Offset)> _read;
    private (string Id, TimeSpan Offset) _last;

    /// <summary>Watches the system zone (tests pass their own reading).</summary>
    public DeviceZoneMonitor(Func<(string Id, TimeSpan Offset)>? read = null)
    {
        _read = read ?? ReadSystem;
        _last = _read();
    }

    /// <summary>The IANA id of the zone last seen.</summary>
    public string ZoneId => _last.Id;

    /// <summary>True when the zone or its offset changed since the last check (then rebuild occurrences and alerts).</summary>
    public bool Check()
    {
        var now = _read();
        if (now == _last) return false;
        _last = now;
        return true;
    }

    private static (string Id, TimeSpan Offset) ReadSystem()
    {
        TimeZoneInfo.ClearCachedData();
        WindowsZoneResolver.Shared.ClearCache();
        var local = TimeZoneInfo.Local;
        return (WindowsZoneResolver.IanaIdOf(local), local.GetUtcOffset(DateTime.UtcNow));
    }
}
