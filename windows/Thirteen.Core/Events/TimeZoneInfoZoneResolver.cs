using System.Collections.Concurrent;

namespace Thirteen.Core.Events;

/// <summary>
/// An <see cref="IZoneResolver"/> over the platform's <see cref="TimeZoneInfo"/> data: IANA ids
/// (<c>Europe/Tallinn</c>, <c>UTC</c>) through <see cref="TimeZoneInfo.FindSystemTimeZoneById"/>, which reads
/// tzdata on macOS and Linux and, on Windows 10 1903 and later, maps IANA ids to registry zones through
/// ICU. Offsets come from <see cref="TimeZoneInfo.GetUtcOffset(DateTime)"/> at a UTC instant, truncated
/// toward zero to whole minutes; no conversion rule lives here (see <see cref="ZoneMath"/>, §3.1.1), so
/// <see cref="TimeZoneInfo.ConvertTimeToUtc(DateTime, TimeZoneInfo)"/> is never used. Windows ids
/// (<c>FLE Standard Time</c>) are not accepted: event data names IANA zones. Thread-safe.
/// </summary>
/// <remarks>
/// On Windows the registry's history is shorter than tzdata's, so a few historical answers differ; the
/// <c>zones</c> section of fixtures/events.json lists those cases (docs/EVENTS.md §5.5).
/// </remarks>
public sealed class TimeZoneInfoZoneResolver : IZoneResolver
{
    private readonly ConcurrentDictionary<string, TimeZoneInfo?> _zones = new(StringComparer.Ordinal);

    /// <summary>A shared instance (zones are cached per id).</summary>
    public static TimeZoneInfoZoneResolver Shared { get; } = new();

    /// <inheritdoc />
    public bool IsKnown(string tzid) => Find(tzid) is not null;

    /// <inheritdoc />
    public int OffsetMinutesAt(string tzid, LocalDateTime utc)
    {
        var zone = Find(tzid) ?? throw Ev.Fail($"Unknown time zone {Ev.Show(tzid)}");
        var instant = new DateTime(utc.Date.Year, utc.Date.Month, utc.Date.Day, 0, 0, 0, DateTimeKind.Utc).AddMinutes(Math.Min(utc.Minute, Ev.Day - 1));
        TimeSpan offset;
        try
        {
            offset = zone.GetUtcOffset(instant);
        }
        catch (ArgumentOutOfRangeException)
        {
            // At the very edges of DateTime the zone's local time leaves its range; the offset two days
            // inward is the same local mean time or far-future rule.
            offset = zone.GetUtcOffset(instant.Year == 1 ? instant.AddDays(2) : instant.AddDays(-2));
        }
        return (int)(offset.Ticks / TimeSpan.TicksPerMinute);
    }

    private TimeZoneInfo? Find(string? tzid)
    {
        if (string.IsNullOrEmpty(tzid)) return null;
        return _zones.GetOrAdd(tzid, static id =>
        {
            if (string.Equals(id, "UTC", StringComparison.Ordinal)) return TimeZoneInfo.Utc;
            if (!id.Contains('/', StringComparison.Ordinal) && TimeZoneInfo.TryConvertWindowsIdToIanaId(id, out _)) return null;
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(id);
            }
            catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException or ArgumentException or System.Security.SecurityException)
            {
                return null;
            }
        });
    }
}
