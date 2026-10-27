using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Thirteen.Desktop.Services;

// The calendar index of docs/EVENTS.md §3.6: %LOCALAPPDATA%\Thirteen\Calendars\calendars.json,
// {"version": 1, "calendars": [index records]}, plus "failedCommits" (§2.11) and "collapsedGroups" (§2.15).
// Read and written with source-generated System.Text.Json (trimming safe, no reflection).

/// <summary>The kind of a stored calendar (§3.6 <c>"kind"</c>).</summary>
public static class CalendarKinds
{
    /// <summary>A calendar on this computer that the user edits.</summary>
    public const string Local = "local";

    /// <summary>A subscribed feed: read-only, stored exactly as fetched.</summary>
    public const string Subscription = "subscription";
}

/// <summary>The update intervals of a subscription (§3.6 <c>"interval"</c>, §2.17 step 3).</summary>
public static class SubscriptionIntervals
{
    /// <summary>Every hour.</summary>
    public const string Hourly = "PT1H";

    /// <summary>Every 6 hours (the default).</summary>
    public const string SixHours = "PT6H";

    /// <summary>Every day.</summary>
    public const string Daily = "P1D";

    /// <summary>Every week.</summary>
    public const string Weekly = "P7D";

    /// <summary>Only when the user asks.</summary>
    public const string Manual = "manual";

    /// <summary>The options in the order of the Subscribe dialog's "Update" picker.</summary>
    public static IReadOnlyList<string> All { get; } = [Hourly, SixHours, Daily, Weekly, Manual];

    /// <summary>The labels of <see cref="All"/> (§2.19 <c>subscribe.update.options</c>).</summary>
    public static IReadOnlyList<string> Labels { get; } = ["Every hour", "Every 6 hours", "Every day", "Every week", "Manually"];

    /// <summary>The interval as a time span, or null for <see cref="Manual"/> and unknown values.</summary>
    public static TimeSpan? Length(string? interval) => interval switch
    {
        Hourly => TimeSpan.FromHours(1),
        SixHours => TimeSpan.FromHours(6),
        Daily => TimeSpan.FromDays(1),
        Weekly => TimeSpan.FromDays(7),
        _ => null,
    };

    /// <summary>
    /// The option nearest to a feed's <c>REFRESH-INTERVAL</c> or <c>X-PUBLISHED-TTL</c> duration (§2.17 step 3, on a
    /// log scale, a tie going to the more frequent option), or <see cref="SixHours"/> when there is none or it
    /// cannot be read. Never <see cref="Manual"/>.
    /// </summary>
    public static string FromFeed(string? duration)
    {
        if (duration is null || !TryParseDuration(duration, out var length) || length <= TimeSpan.Zero) return SixHours;
        var best = SixHours;
        var bestDistance = double.MaxValue;
        foreach (var option in All)
        {
            if (Length(option) is not { } span) continue;
            var distance = Math.Abs(Math.Log(length.TotalMinutes) - Math.Log(span.TotalMinutes));
            if (distance < bestDistance - 1e-9)
            {
                best = option;
                bestDistance = distance;
            }
        }
        return best;
    }

    /// <summary>Reads an RFC 5545 duration (<c>P1W</c>, <c>PT12H</c>, <c>P1DT6H</c>); a sign is not allowed.</summary>
    internal static bool TryParseDuration(string text, out TimeSpan duration)
    {
        duration = TimeSpan.Zero;
        var s = text.Trim().ToUpperInvariant();
        if (s.StartsWith('+')) s = s[1..];
        if (!s.StartsWith('P') || s.Length < 3) return false;
        var inTime = false;
        var number = -1L;
        var total = 0.0;
        var any = false;
        for (var i = 1; i < s.Length; i++)
        {
            var c = s[i];
            if (c == 'T')
            {
                if (inTime || number >= 0) return false;
                inTime = true;
                continue;
            }
            if (c is >= '0' and <= '9')
            {
                number = (number < 0 ? 0 : number) * 10 + (c - '0');
                if (number > 1_000_000_000) return false;
                continue;
            }
            if (number < 0) return false;
            var minutes = (c, inTime) switch
            {
                ('W', false) => number * 7.0 * 1440,
                ('D', false) => number * 1440.0,
                ('H', true) => number * 60.0,
                ('M', true) => number,
                ('S', true) => number / 60.0,
                _ => double.NaN,
            };
            if (double.IsNaN(minutes)) return false;
            total += minutes;
            number = -1;
            any = true;
        }
        if (!any || number >= 0) return false;
        duration = TimeSpan.FromMinutes(total);
        return true;
    }
}

/// <summary>The parse outcome of a feed body held back as suspicious (§2.16, §3.6 <c>"suspect"</c>).</summary>
public sealed record SuspectOutcome
{
    /// <summary><c>"empty"</c> (no events where the stored copy has more than 10) or <c>"partial"</c> (over 10% skipped).</summary>
    public string Kind { get; init; } = "empty";

    /// <summary>The number of events the body held (UID groups).</summary>
    public int Events { get; init; }

    /// <summary>The number of components the parse skipped.</summary>
    public int Skipped { get; init; }
}

/// <summary>The subscription part of an index record (§3.6).</summary>
public sealed record SubscriptionRecord
{
    /// <summary>The feed's link (<c>webcal://</c> already turned into <c>https://</c>, or <c>http://</c>).</summary>
    public string Url { get; init; } = "";

    /// <summary>One of <see cref="SubscriptionIntervals"/>.</summary>
    public string Interval { get; init; } = SubscriptionIntervals.SixHours;

    /// <summary>The <c>ETag</c> of the stored body (sent as <c>If-None-Match</c>).</summary>
    public string? Etag { get; init; }

    /// <summary>The <c>Last-Modified</c> of the stored body (sent as <c>If-Modified-Since</c>).</summary>
    public string? LastModified { get; init; }

    /// <summary><c>sha256:&lt;hex&gt;</c> of the last stored body, used to skip re-parsing an unchanged feed.</summary>
    public string? ContentHash { get; init; }

    /// <summary>The outcome of a body held back as suspicious, accepted when the next one has the same outcome.</summary>
    public SuspectOutcome? Suspect { get; init; }

    /// <summary>When the last refresh started (UTC, ISO 8601).</summary>
    public string? LastAttemptAt { get; init; }

    /// <summary>When the fetch of the stored body started (UTC, ISO 8601).</summary>
    public string? LastSuccessAt { get; init; }

    /// <summary>One of the <c>subscribe.error.*</c> ids, <c>feed-empty</c> or <c>feed-partial</c>; null after a success.</summary>
    public string? LastError { get; init; }
}

/// <summary>One calendar in calendars.json (§3.6 "Index record").</summary>
public sealed record CalendarRecord
{
    /// <summary>A UUID (or the id kept from a restored export, §2.17).</summary>
    public string Id { get; init; } = "";

    /// <summary><see cref="CalendarKinds.Local"/> or <see cref="CalendarKinds.Subscription"/>.</summary>
    public string Kind { get; init; } = CalendarKinds.Local;

    /// <summary>The name the user sees.</summary>
    public string Name { get; init; } = "";

    /// <summary><c>#rrggbb</c>, lowercase.</summary>
    public string Color { get; init; } = CalendarPalette.Colors[0];

    /// <summary>Position in the Calendars list.</summary>
    public int Order { get; init; }

    /// <summary>Thirteen's own visibility (§2.15).</summary>
    public bool Visible { get; init; } = true;

    /// <summary>When the calendar was made (UTC, ISO 8601).</summary>
    public string CreatedAt { get; init; } = "";

    /// <summary>For subscriptions, the feed; null for local calendars.</summary>
    public SubscriptionRecord? Subscription { get; init; }

    /// <summary>True for a subscription.</summary>
    [JsonIgnore]
    public bool IsSubscription => Kind == CalendarKinds.Subscription;
}

/// <summary>What a failed pending change was doing (§2.11 "Failures nobody saw").</summary>
public sealed record FailedChange
{
    /// <summary><c>"move"</c> or <c>"delete"</c>.</summary>
    public string Kind { get; init; } = "move";

    /// <summary>The target date of a move, or the deleted occurrence's date (Gregorian, ISO <c>yyyy-MM-dd</c>).</summary>
    public string Date { get; init; } = "";

    /// <summary>The target time of a timed move in minutes after midnight; null for all-day events and deletes.</summary>
    public int? Minute { get; init; }

    /// <summary>Whether the event is all-day.</summary>
    public bool AllDay { get; init; }
}

/// <summary>A pending change that could not be written while no window was in the foreground (§2.11), kept until it is shown.</summary>
public sealed record FailedCommit
{
    /// <summary>The occurrence key (§3.2).</summary>
    public string Key { get; init; } = "";

    /// <summary>The event's title (user text, never changed).</summary>
    public string Title { get; init; } = "";

    /// <summary>The change.</summary>
    public FailedChange Change { get; init; } = new();

    /// <summary>
    /// <c>"transient"</c>, <c>"changed"</c> (the occurrence no longer resolves, or its time group changed elsewhere), or a
    /// final cause: <c>"access"</c>, <c>"readOnly"</c>, <c>"account"</c>, <c>"storage"</c>.
    /// </summary>
    public string Cause { get; init; } = "transient";
}

/// <summary>The whole of calendars.json.</summary>
public sealed record CalendarIndexDocument
{
    /// <summary>Always 1.</summary>
    public int Version { get; init; } = 1;

    /// <summary>The calendars, in list order.</summary>
    public IReadOnlyList<CalendarRecord> Calendars { get; init; } = [];

    /// <summary>Failed commits nobody saw yet (§2.11); omitted when there are none.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<FailedCommit>? FailedCommits { get; init; }

    /// <summary>The collapsed groups of the Calendars list (<c>"local"</c>, <c>"subscription"</c>), stored with visibility (§2.15); omitted when none.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? CollapsedGroups { get; init; }

    /// <summary>The JSON text (indented, UTF-8).</summary>
    public byte[] ToUtf8() => JsonSerializer.SerializeToUtf8Bytes(this, CalendarIndexJsonContext.Default.CalendarIndexDocument);

    /// <summary>Reads calendars.json text; null when it is not an index of version 1.</summary>
    public static CalendarIndexDocument? FromUtf8(ReadOnlySpan<byte> utf8)
    {
        try
        {
            var document = JsonSerializer.Deserialize(utf8, CalendarIndexJsonContext.Default.CalendarIndexDocument);
            if (document is null || document.Version != 1) return null;
            return document with { Calendars = (document.Calendars ?? []).Where(c => c is not null && c.Id.Length > 0).ToArray() };
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>Source-generated JSON metadata for calendars.json.</summary>
[JsonSourceGenerationOptions(
    WriteIndented = true,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    ReadCommentHandling = JsonCommentHandling.Skip,
    AllowTrailingCommas = true)]
[JsonSerializable(typeof(CalendarIndexDocument))]
internal sealed partial class CalendarIndexJsonContext : JsonSerializerContext
{
}

/// <summary>The palette for new calendars and subscriptions (§3.6, copy <c>calendars.colors</c>).</summary>
public static class CalendarPalette
{
    /// <summary>Orange, Red, Amber, Green, Teal, Blue, Indigo, Purple, Pink, Brown, Graphite.</summary>
    public static IReadOnlyList<string> Colors { get; } =
        ["#ea580c", "#dc2626", "#d97706", "#16a34a", "#0d9488", "#2563eb", "#4f46e5", "#9333ea", "#db2777", "#92400e", "#57534e"];

    /// <summary>The names of <see cref="Colors"/> (§2.19 <c>calendars.colors</c>), for accessible names.</summary>
    public static IReadOnlyList<string> Names { get; } =
        ["Orange", "Red", "Amber", "Green", "Teal", "Blue", "Indigo", "Purple", "Pink", "Brown", "Graphite"];

    /// <summary>The first palette color no calendar uses, else the first color.</summary>
    public static string NextFree(IEnumerable<string> used)
    {
        var taken = new HashSet<string>(used.Select(c => c.ToLowerInvariant()), StringComparer.Ordinal);
        return Colors.FirstOrDefault(c => !taken.Contains(c)) ?? Colors[0];
    }

    /// <summary>The palette name of a color, or null for a color outside the palette.</summary>
    public static string? NameOf(string color)
    {
        for (var i = 0; i < Colors.Count; i++)
        {
            if (string.Equals(Colors[i], color, StringComparison.OrdinalIgnoreCase)) return Names[i];
        }
        return null;
    }
}

/// <summary>ISO 8601 UTC timestamps as calendars.json stores them.</summary>
public static class StoreTime
{
    /// <summary><c>2026-10-19T09:41:00Z</c> (whole seconds, as <c>createdAt</c>).</summary>
    public static string Seconds(DateTimeOffset time) =>
        time.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

    /// <summary><c>2026-10-19T09:41:00.123Z</c> (milliseconds, for refresh times, which are compared).</summary>
    public static string Precise(DateTimeOffset time) =>
        time.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary>Reads a stored timestamp; null when it is missing or not a date-time.</summary>
    public static DateTimeOffset? Parse(string? text) =>
        text is not null && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var value)
            ? value
            : null;
}
