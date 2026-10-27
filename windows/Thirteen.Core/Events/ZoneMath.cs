namespace Thirteen.Core.Events;

/// <summary>
/// Answers UTC offsets for IANA zone ids. Implemented per platform (Windows: <c>TimeZoneInfo</c>, see
/// <see cref="TimeZoneInfoZoneResolver"/>); every conversion rule lives in <see cref="ZoneMath"/>, so all
/// four engines agree on DST gaps, overlaps and the edges of years 1 to 9999. TS: <c>ZoneResolver</c>.
/// </summary>
public interface IZoneResolver
{
    /// <summary><c>true</c> when the platform has rules for <paramref name="tzid"/> (an IANA id such as <c>Europe/Tallinn</c>, or <c>UTC</c>).</summary>
    bool IsKnown(string tzid);

    /// <summary>
    /// The UTC offset in force at the UTC instant <paramref name="utc"/>, in whole minutes east of UTC
    /// (Tallinn in summer: 180; New York in winter: -300), between -1439 and 1439; offsets with seconds are
    /// truncated toward zero. Core only asks about instants from 0001-01-01T00:00 to 9999-12-31T23:59 UTC.
    /// </summary>
    int OffsetMinutesAt(string tzid, LocalDateTime utc);
}

/// <summary>
/// The last few offsets the resolver gave for one zone, by UTC instant, so a caller that converts many
/// nearby times asks once per instant. A resolver answers by the instant alone, so the results are the
/// same as without it. TS: <c>OffsetMemo</c>.
/// </summary>
internal sealed class OffsetMemo(string zone)
{
    private const int Size = 4;
    private readonly long[] _instants = [long.MinValue, long.MinValue, long.MinValue, long.MinValue];
    private readonly int[] _offsets = new int[Size];
    private int _slot;

    public string Zone { get; } = zone;

    public bool TryGet(long instant, out int offset)
    {
        for (var i = 0; i < Size; i++)
        {
            if (_instants[i] == instant)
            {
                offset = _offsets[i];
                return true;
            }
        }
        offset = 0;
        return false;
    }

    public void Add(long instant, int offset)
    {
        _instants[_slot] = instant;
        _offsets[_slot] = offset;
        _slot = (_slot + 1) % Size;
    }
}

/// <summary>
/// Converts between a zone's wall clock and UTC with the rule of §3.3 and §5.2, the same on every
/// platform. TS: <c>zonedToUtc</c>, <c>utcToZoned</c>.
/// </summary>
public static class ZoneMath
{
    /// <summary>
    /// Converts a wall-clock value in <paramref name="zone"/> to UTC (§3.3): a time inside a DST gap moves
    /// forward by the gap's length (New York 2026-03-08T02:30 is 07:30Z), and an ambiguous time takes the
    /// earlier instant (RFC 5545 §3.3.5). With <c>b</c> the offset at the UTC instant <c>local - 1 day</c>
    /// and <c>a</c> the offset at <c>local + 1 day</c>, the candidates are <c>local - b</c> and
    /// <c>local - a</c>; a candidate <c>U</c> is valid when <c>U + offset(U) = local</c>. Two valid,
    /// different candidates: the earlier. One: it. None (a gap): <c>local - b</c>.
    /// <paramref name="local"/> may be an end at 24:00. TS: <c>zonedToUtc</c>.
    /// </summary>
    /// <returns>The UTC wall clock (minute 0..1439), or <c>null</c> when it falls outside years 1 to 9999.</returns>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidEvent"/> for an empty or unknown zone, or a resolver that returns an invalid offset.
    /// </exception>
    public static LocalDateTime? ToUtc(LocalDateTime local, string zone, IZoneResolver zones)
    {
        AssertKnownZone(zone, zones);
        return LocalDateTime.FromAbsolute(ToUtcAbsolute(local.Absolute, zone, zones));
    }

    /// <summary>
    /// Converts a UTC wall clock to the wall clock of <paramref name="zone"/> (UTC plus the offset in force
    /// at that instant). <paramref name="utc"/> may be an end at 24:00. TS: <c>utcToZoned</c>.
    /// </summary>
    /// <returns>The zone's wall clock (minute 0..1439), or <c>null</c> when it falls outside years 1 to 9999.</returns>
    /// <exception cref="ThirteenException">As <see cref="ToUtc"/>.</exception>
    public static LocalDateTime? ToZoned(LocalDateTime utc, string zone, IZoneResolver zones)
    {
        AssertKnownZone(zone, zones);
        return LocalDateTime.FromAbsolute(ToZonedAbsolute(utc.Absolute, zone, zones));
    }

    /// <summary>Validates a zone id and resolver: a non-empty id the resolver knows. TS: <c>assertKnownZone</c>.</summary>
    internal static void AssertKnownZone(string? zone, IZoneResolver? zones)
    {
        if (string.IsNullOrEmpty(zone)) throw Ev.Fail($"Time zone id must be a non-empty string, got {Ev.Show(zone)}");
        if (zones is null) throw Ev.Fail("zones must be a ZoneResolver with isKnown and offsetMinutesAt");
        if (!zones.IsKnown(zone)) throw Ev.Fail($"Unknown time zone {Ev.Show(zone)}");
    }

    /// <summary>The resolver's offset at an absolute UTC minute, the probe kept inside years 1 to 9999.</summary>
    private static int OffsetAt(IZoneResolver zones, string zone, long absolute)
    {
        var probe = LocalDateTime.FromAbsolute(Math.Clamp(absolute, LocalDateTime.MinAbsolute, LocalDateTime.MaxAbsolute))!.Value;
        var offset = zones.OffsetMinutesAt(zone, probe);
        if (offset is <= -Ev.Day or >= Ev.Day)
        {
            throw Ev.Fail(
                $"ZoneResolver.offsetMinutesAt({Ev.Show(zone)}, {probe}) must return an integer number of minutes between -1439 and 1439, got {offset.Inv()}");
        }
        return offset;
    }

    private static int MemoOffsetAt(IZoneResolver zones, string zone, long absolute, OffsetMemo? memo)
    {
        if (memo is null || !string.Equals(memo.Zone, zone, StringComparison.Ordinal)) return OffsetAt(zones, zone, absolute);
        if (memo.TryGet(absolute, out var cached)) return cached;
        var offset = OffsetAt(zones, zone, absolute);
        memo.Add(absolute, offset);
        return offset;
    }

    /// <summary><see cref="ToUtc"/> on absolute minutes, without validating the zone and without the range check.</summary>
    internal static long ToUtcAbsolute(long target, string zone, IZoneResolver zones) => ToUtcSteady(target, zone, zones).Utc;

    /// <summary>
    /// <see cref="ToUtcAbsolute"/>, also telling whether the offset is the same at the two probes (the UTC
    /// instants <c>target - 1 day</c> and <c>target + 1 day</c>): then no transition lies between them, the
    /// result is <c>target - offset</c>, and <c>Steady</c> is that offset; otherwise null. TS: <c>zonedToUtcSteady</c>.
    /// </summary>
    internal static (long Utc, int? Steady) ToUtcSteady(long target, string zone, IZoneResolver zones, OffsetMemo? memo = null)
    {
        var before = MemoOffsetAt(zones, zone, target - Ev.Day, memo);
        var after = MemoOffsetAt(zones, zone, target + Ev.Day, memo);
        var early = target - before; // also the gap rule: local - b
        if (before == after) return (early, before);
        var late = target - after;
        var earlyValid = early + MemoOffsetAt(zones, zone, early, memo) == target;
        var lateValid = late + MemoOffsetAt(zones, zone, late, memo) == target;
        if (earlyValid && lateValid) return (Math.Min(early, late), null);
        return (lateValid ? late : early, null);
    }

    /// <summary><see cref="ToZoned"/> on absolute minutes, without validating the zone and without the range check.</summary>
    internal static long ToZonedAbsolute(long instant, string zone, IZoneResolver zones, OffsetMemo? memo = null) =>
        instant + MemoOffsetAt(zones, zone, instant, memo);
}
