using Thirteen.Core;

namespace Thirteen.Desktop.Services;

/// <summary>
/// Today's local date and when to look at the clock again, so the app rolls over at local midnight and
/// follows a time-zone or clock change (the Windows counterpart of the Apple apps' AppState clock).
/// </summary>
public static class LocalClock
{
    /// <summary>The longest the app waits between two looks at the clock.</summary>
    public static readonly TimeSpan MaximumInterval = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Today's local wall-clock date. .NET caches <see cref="TimeZoneInfo.Local"/> for the life of the
    /// process, so the zone is read again first: without that, a time zone changed in Windows Settings
    /// would never reach a running app.
    /// </summary>
    public static GregorianDate Today()
    {
        TimeZoneInfo.ClearCachedData();
        return GregorianDate.Today();
    }

    /// <summary>
    /// How long to wait before reading the clock again: until just after the next local midnight, but never
    /// longer than <see cref="MaximumInterval"/>, so a changed time zone or clock is noticed soon.
    /// </summary>
    public static TimeSpan UntilNextCheck(DateTimeOffset now, TimeZoneInfo zone)
    {
        try
        {
            var today = GregorianDate.FromInstant(now, zone);
            // A zone may skip a whole day (Pacific/Apia 2011-12-30): then the day after it comes next.
            var next = today.AddDays(1).FirstInstant(zone) ?? today.AddDays(2).FirstInstant(zone);
            if (next is not { } midnight) return MaximumInterval;
            var wait = midnight - now + TimeSpan.FromMilliseconds(250);
            if (wait < TimeSpan.FromSeconds(1)) return TimeSpan.FromSeconds(1);
            return wait < MaximumInterval ? wait : MaximumInterval;
        }
        catch (ThirteenException)
        {
            // 31 December 9999 has no next day.
            return MaximumInterval;
        }
    }
}
