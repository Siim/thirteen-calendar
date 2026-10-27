using Thirteen.Core;
using Thirteen.Desktop.Services;

namespace Thirteen.Desktop.Tests;

/// <summary>Tests that change state of the whole process (the TZ variable, this session's instance name): run alone.</summary>
[CollectionDefinition(nameof(ProcessWideCollection), DisableParallelization = true)]
public sealed class ProcessWideCollection;

/// <summary>When the app reads the clock, and that it follows a changed time zone (Services/LocalClock.cs).</summary>
[Collection(nameof(ProcessWideCollection))]
public class ClockTests
{
    private static DateTimeOffset At(string local, TimeZoneInfo zone)
    {
        var wall = DateTime.Parse(local, System.Globalization.CultureInfo.InvariantCulture);
        return new DateTimeOffset(wall, zone.GetUtcOffset(wall));
    }

    [Fact]
    public void ChecksJustAfterMidnightAndAtLeastTwiceAMinute()
    {
        var tallinn = TimeZoneInfo.FindSystemTimeZoneById("Europe/Tallinn");
        Assert.Equal(TimeSpan.FromSeconds(30), LocalClock.UntilNextCheck(At("2026-10-19T12:00:00", tallinn), tallinn));
        Assert.Equal(TimeSpan.FromSeconds(10.25), LocalClock.UntilNextCheck(At("2026-10-19T23:59:50", tallinn), tallinn));
        Assert.Equal(TimeSpan.FromSeconds(1), LocalClock.UntilNextCheck(At("2026-10-19T23:59:59.9", tallinn), tallinn));
        // The day after a skipped day comes next (Samoa skipped 30 December 2011).
        var apia = TimeZoneInfo.FindSystemTimeZoneById("Pacific/Apia");
        var lastSecondOf29th = new DateTimeOffset(2011, 12, 30, 9, 59, 50, TimeSpan.Zero);
        Assert.Equal(new GregorianDate(2011, 12, 29), GregorianDate.FromInstant(lastSecondOf29th, apia));
        Assert.Equal(TimeSpan.FromSeconds(10.25), LocalClock.UntilNextCheck(lastSecondOf29th, apia));
        // The last supported day has no next one.
        Assert.Equal(TimeSpan.FromSeconds(30), LocalClock.UntilNextCheck(new DateTimeOffset(9999, 12, 31, 23, 59, 50, TimeSpan.Zero), TimeZoneInfo.Utc));
    }

    [Fact]
    public void TodayFollowsATimeZoneChange()
    {
        // Windows reads its zone from the system, not from TZ; the cache refresh under test is the same there.
        if (OperatingSystem.IsWindows()) return;
        var saved = Environment.GetEnvironmentVariable("TZ");
        try
        {
            // UTC+14 and UTC-11 are 25 hours apart, so their dates always differ.
            Environment.SetEnvironmentVariable("TZ", "Pacific/Kiritimati");
            var east = LocalClock.Today();
            Environment.SetEnvironmentVariable("TZ", "Pacific/Pago_Pago");
            var west = LocalClock.Today();
            Assert.True(east > west, $"{east} after {west}");
            Assert.Equal(GregorianDate.FromInstant(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Pacific/Pago_Pago")), west);
        }
        finally
        {
            Environment.SetEnvironmentVariable("TZ", saved);
            TimeZoneInfo.ClearCachedData();
        }
    }
}
