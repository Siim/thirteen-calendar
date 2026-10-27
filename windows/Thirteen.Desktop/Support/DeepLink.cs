using System.Globalization;
using Thirteen.Core;

namespace Thirteen.Desktop.Support;

/// <summary>Which side of the converter is the input.</summary>
public enum ConvertDirection
{
    /// <summary>Gregorian date in, 13-month date out.</summary>
    FromGregorian,

    /// <summary>13-month date in, Gregorian date out.</summary>
    FromThirteen,
}

/// <summary>Where a <see cref="DeepLink"/> goes.</summary>
public enum DeepLinkKind
{
    /// <summary>thirteen://today</summary>
    Today,

    /// <summary>thirteen://year/2026?day=2026-10-19</summary>
    Year,

    /// <summary>thirteen://convert?date=2026-10-19 or ?thirteen=2026-M11-12</summary>
    Convert,

    /// <summary>thirteen://compare/2024</summary>
    Compare,

    /// <summary>thirteen://history</summary>
    History,

    /// <summary>thirteen://calendar: Calendar in its last mode (docs/EVENTS.md §2.22).</summary>
    Calendar,

    /// <summary>thirteen://month/2026/11: Month mode, Gregorian year 2026, 13-month month 11.</summary>
    Month,

    /// <summary>thirteen://week/2026-10-19: Week mode on the 13-month week holding that Gregorian day.</summary>
    Week,

    /// <summary>thirteen://day/2026-10-19: Day mode (also the target of an alert's toast).</summary>
    Day,

    /// <summary>thirteen://new-event?date=2026-10-19: the editor for a new event that day.</summary>
    NewEvent,
}

/// <summary>
/// A parsed <c>thirteen://</c> URL, the same routes as the Apple apps (apple/Shared/App/DeepLink.swift):
/// <c>today</c>, <c>calendar</c>, <c>year/2026[?day=2026-10-19]</c>, <c>month/2026/11</c>, <c>week/2026-10-19</c>,
/// <c>day/2026-10-19</c>, <c>new-event?date=2026-10-19</c> (docs/EVENTS.md §2.22), <c>convert?date=2026-10-19</c>
/// (also <c>convert/2026-10-19</c>), <c>convert?thirteen=2024-LD</c> (numeric 13-month form, display year of the
/// system), <c>compare/2024</c>, <c>history</c>; every link also accepts <c>?system=ifc|positivist</c>.
/// Years are Gregorian years 1..9999; an invalid year, month or date keeps the destination but ignores the value.
/// (<c>thirteen://subscribe?url=</c> is a request to subscribe, read by <see cref="ExternalRequest"/>.)
/// </summary>
public sealed record DeepLink(
    DeepLinkKind Kind,
    int? Year = null,
    GregorianDate? Day = null,
    ConvertDirection? Direction = null,
    CalendarSystemId? System = null,
    int? Month = null)
{
    /// <summary>The URL scheme, registered by the installer.</summary>
    public const string Scheme = "thirteen";

    /// <summary>Parses a <c>thirteen:</c> URL; null for other schemes or unknown destinations.</summary>
    public static DeepLink? TryParse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        text = text.Trim();
        var colon = text.IndexOf(':', StringComparison.Ordinal);
        if (colon <= 0 || !text[..colon].Equals(Scheme, StringComparison.OrdinalIgnoreCase)) return null;

        var rest = text[(colon + 1)..];
        var fragment = rest.IndexOf('#', StringComparison.Ordinal);
        if (fragment >= 0) rest = rest[..fragment];
        var queryStart = rest.IndexOf('?', StringComparison.Ordinal);
        var path = queryStart >= 0 ? rest[..queryStart] : rest;
        var queryText = queryStart >= 0 ? rest[(queryStart + 1)..] : "";

        // thirteen://year/2026 (host "year"); also thirteen:year/2026 and thirteen:///year/2026.
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0) return null;
        var head = Uri.UnescapeDataString(segments[0]).ToLowerInvariant();
        var argument = segments.Length > 1 ? Uri.UnescapeDataString(segments[1]) : null;

        var query = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var pair in queryText.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = pair.IndexOf('=', StringComparison.Ordinal);
            if (eq <= 0) continue;
            var key = Uri.UnescapeDataString(pair[..eq].Replace('+', ' ')).ToLowerInvariant();
            query[key] = Uri.UnescapeDataString(pair[(eq + 1)..].Replace('+', ' '));
        }
        CalendarSystemId? system = query.TryGetValue("system", out var s) && CalendarSystemIdExtensions.TryParse(s.ToLowerInvariant(), out var parsed)
            ? parsed
            : null;

        switch (head)
        {
            case "today":
                return new DeepLink(DeepLinkKind.Today, System: system);
            case "year":
                return new DeepLink(DeepLinkKind.Year, ParseYear(argument), ParseDate(query.GetValueOrDefault("day")), System: system);
            case "convert":
                if (query.TryGetValue("thirteen", out var numeric)
                    && ThirteenDate.TryParseNumeric(numeric, system ?? CalendarSystemId.Ifc, out var thirteen))
                {
                    return new DeepLink(DeepLinkKind.Convert, Day: thirteen.Gregorian, Direction: ConvertDirection.FromThirteen, System: system);
                }
                var date = ParseDate(query.GetValueOrDefault("date") ?? argument);
                return new DeepLink(DeepLinkKind.Convert, Day: date, Direction: date is null ? null : ConvertDirection.FromGregorian, System: system);
            case "compare":
                return new DeepLink(DeepLinkKind.Compare, ParseYear(argument ?? query.GetValueOrDefault("year")), System: system);
            case "history":
                return new DeepLink(DeepLinkKind.History, System: system);
            case "calendar":
                return new DeepLink(DeepLinkKind.Calendar, System: system);
            case "month":
            {
                var second = segments.Length > 2 ? Uri.UnescapeDataString(segments[2]) : null;
                return new DeepLink(DeepLinkKind.Month, ParseYear(argument ?? query.GetValueOrDefault("year")),
                    System: system, Month: ParseMonth(second ?? query.GetValueOrDefault("month")));
            }
            case "week":
                return new DeepLink(DeepLinkKind.Week, Day: ParseDate(argument ?? query.GetValueOrDefault("date")), System: system);
            case "day":
                return new DeepLink(DeepLinkKind.Day, Day: ParseDate(argument ?? query.GetValueOrDefault("date")), System: system);
            case "new-event":
                return new DeepLink(DeepLinkKind.NewEvent, Day: ParseDate(query.GetValueOrDefault("date") ?? argument), System: system);
            default:
                return null;
        }
    }

    /// <summary>The canonical URL for this link (inverse of <see cref="TryParse"/>).</summary>
    public string ToUrl()
    {
        var items = new List<string>();
        string host;
        var path = "";
        switch (Kind)
        {
            case DeepLinkKind.Year:
                host = "year";
                if (Year is { } year) path = "/" + year.ToString(CultureInfo.InvariantCulture);
                if (Day is { } day) items.Add("day=" + day.ToIsoString());
                break;
            case DeepLinkKind.Convert:
                host = "convert";
                if (Day is { } date) items.Add("date=" + date.ToIsoString());
                break;
            case DeepLinkKind.Compare:
                host = "compare";
                if (Year is { } compareYear) path = "/" + compareYear.ToString(CultureInfo.InvariantCulture);
                break;
            case DeepLinkKind.History:
                host = "history";
                break;
            case DeepLinkKind.Calendar:
                host = "calendar";
                break;
            case DeepLinkKind.Month:
                host = "month";
                if (Year is { } monthYear) path = "/" + monthYear.ToString(CultureInfo.InvariantCulture) + (Month is { } m ? "/" + m.ToString(CultureInfo.InvariantCulture) : "");
                else if (Month is { } onlyMonth) items.Add("month=" + onlyMonth.ToString(CultureInfo.InvariantCulture));
                break;
            case DeepLinkKind.Week:
                host = "week";
                if (Day is { } weekDay) path = "/" + weekDay.ToIsoString();
                break;
            case DeepLinkKind.Day:
                host = "day";
                if (Day is { } dayDay) path = "/" + dayDay.ToIsoString();
                break;
            case DeepLinkKind.NewEvent:
                host = "new-event";
                if (Day is { } newDay) items.Add("date=" + newDay.ToIsoString());
                break;
            default:
                host = "today";
                break;
        }
        if (System is { } system) items.Add("system=" + system.RawValue());
        return $"{Scheme}://{host}{path}" + (items.Count > 0 ? "?" + string.Join("&", items) : "");
    }

    private static int? ParseYear(string? text) =>
        int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var year) && GregorianDate.IsValidYear(year) ? year : null;

    private static GregorianDate? ParseDate(string? text) => GregorianDate.TryParseIso(text, out var date) ? date : null;

    /// <summary>A 13-month month number (both systems have 13 months), or null.</summary>
    private static int? ParseMonth(string? text) =>
        int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var month) && month is >= 1 and <= ThirteenDate.MonthsPerYear ? month : null;
}
