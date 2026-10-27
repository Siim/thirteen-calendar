using System.Text.Json;
using Thirteen.Core.Events;
using Thirteen.Desktop.Services;
using Xunit.Abstractions;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// <see cref="WindowsZoneResolver"/> through the <c>zones</c> section of fixtures/events.json (§5.5, §6.4: tested by
/// that section only), with the cases the Windows registry cannot answer as tzdata does listed by case id and reason.
/// </summary>
public class WindowsZoneResolverTests(ITestOutputHelper output)
{
    /// <summary>
    /// Cases the platform's zone data answers differently from tzdata, by case id ("zone local|utc value"). macOS and
    /// Linux (tzdata): none. Windows (registry zones, IANA ids mapped through ICU): Samoa's 2011 date-line change, the
    /// same exception as Thirteen.Core.Tests' EventsFixtureParityTests (windows/README.md). A listed case that starts
    /// answering as tzdata fails, so the list stays minimal.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, string> PlatformExceptions = OperatingSystem.IsWindows()
        ? new Dictionary<string, string>
        {
            ["Pacific/Apia utc 2011-12-30T10:00"] =
                "Windows' Samoa Standard Time keeps UTC-10 to the end of 2011; tzdata crosses the date line at 2011-12-29T10:00Z",
        }
        : new Dictionary<string, string>();

    [Fact]
    public void TheZonesSectionThroughTheWindowsResolver()
    {
        using var json = JsonDocument.Parse(File.ReadAllText(RepoPaths.Fixture("events.json")));
        var cases = json.RootElement.GetProperty("zones").EnumerateArray().ToList();
        Assert.Equal(29, cases.Count);
        var resolver = new WindowsZoneResolver();
        var failures = new List<string>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in cases)
        {
            var zone = c.GetProperty("zone").GetString()!;
            var isLocal = c.TryGetProperty("local", out var local);
            var value = isLocal ? local.GetString()! : c.GetProperty("utc").GetString()!;
            var id = $"{zone} {(isLocal ? "local" : "utc")} {value}";
            Assert.True(ids.Add(id), $"duplicate case {id}");
            Assert.True(resolver.IsKnown(zone), $"{zone} is not known");
            var result = isLocal
                ? ZoneMath.ToUtc(LocalDateTime.Parse(value), zone, resolver)
                : ZoneMath.ToZoned(LocalDateTime.Parse(value), zone, resolver);
            var expectedElement = c.GetProperty(isLocal ? "expectedUtc" : "expectedLocal");
            var expected = expectedElement.ValueKind == JsonValueKind.Null ? null : expectedElement.GetString();
            var same = result?.ToString() == expected;
            if (PlatformExceptions.TryGetValue(id, out var reason))
            {
                if (same) failures.Add($"{id}: listed as a platform exception but answers as tzdata now");
                else output.WriteLine($"platform exception {id}: {reason}");
            }
            else if (!same)
            {
                failures.Add($"{id}: expected {expected ?? "null"}, got {result?.ToString() ?? "null"}");
            }
        }
        foreach (var listed in PlatformExceptions.Keys) Assert.Contains(listed, ids);
        if (failures.Count > 0)
        {
            Assert.Fail($"zones (fixture tzVersion {json.RootElement.GetProperty("tzVersion").GetString()}, " +
                        $"{System.Runtime.InteropServices.RuntimeInformation.OSDescription}):\n" + string.Join("\n", failures));
        }
    }

    [Fact]
    public void WindowsIdsAreNotZoneIdsButTheDeviceZoneIsAlwaysIana()
    {
        var resolver = new WindowsZoneResolver();
        Assert.False(resolver.IsKnown("FLE Standard Time"));     // the .ics module maps it to IANA first (§5.4)
        Assert.True(resolver.IsKnown("Europe/Tallinn"));
        Assert.True(resolver.IsKnown("UTC"));
        Assert.False(resolver.IsKnown("Mars/Olympus_Mons"));
        Assert.Equal(180, resolver.OffsetMinutesAt("Europe/Tallinn", LocalDateTime.Parse("2026-07-01T12:00")));
        Assert.Equal(120, resolver.OffsetMinutesAt("Europe/Tallinn", LocalDateTime.Parse("2026-12-01T12:00")));

        Assert.Equal("Europe/Tallinn", WindowsZoneResolver.IanaIdOf(TimeZoneInfo.FindSystemTimeZoneById("Europe/Tallinn")));
        Assert.Equal("UTC", WindowsZoneResolver.IanaIdOf(TimeZoneInfo.Utc));
        var device = WindowsZoneResolver.DeviceZoneId();
        Assert.True(resolver.IsKnown(device), $"device zone {device}");
        if (TimeZoneInfo.TryFindSystemTimeZoneById("FLE Standard Time", out var fle))
        {
            Assert.Contains(WindowsZoneResolver.IanaIdOf(fle), new[] { "Europe/Kiev", "Europe/Kyiv" });
        }
    }

    [Fact]
    public void TheMonitorNoticesAZoneOrOffsetChange()
    {
        var reading = ("Europe/Tallinn", TimeSpan.FromHours(3));
        var monitor = new DeviceZoneMonitor(() => reading);
        Assert.False(monitor.Check());
        reading = ("Europe/Tallinn", TimeSpan.FromHours(2));      // DST ended
        Assert.True(monitor.Check());
        Assert.False(monitor.Check());
        reading = ("America/New_York", TimeSpan.FromHours(-5));
        Assert.True(monitor.Check());
        Assert.Equal("America/New_York", monitor.ZoneId);
    }
}
