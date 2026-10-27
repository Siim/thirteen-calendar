using System.Globalization;
using System.Numerics;
using Thirteen.Core.Events;

namespace Thirteen.Core.Ics;

// iCalendar value types the .ics module reads and writes (RFC 5545 §3.3), mirroring
// packages/core/src/ics/values.ts: DATE and DATE-TIME values with their VALUE and TZID parameters, durations
// and UTC offsets. Minute precision, as everywhere in the events engine (seconds are dropped when reading,
// §3.3).

/// <summary>A duration: nominal days (weeks count 7) and exact seconds, with one sign. Both at most 2^53 - 1.</summary>
internal readonly record struct IcsDuration(bool Negative, long Days, long Seconds);

internal static class IcsValues
{
    /// <summary>JavaScript's <c>Number.MAX_SAFE_INTEGER</c>.</summary>
    private const long MaxSafe = 9_007_199_254_740_991;

    /// <summary>Reads a DATE or DATE-TIME value with its <c>VALUE</c> and <c>TZID</c> parameters; null when it does not parse or contradicts <c>VALUE</c>.</summary>
    public static IcsDateValue? ReadDateValue(string text, IReadOnlyList<IcsParameter> parameters)
    {
        var parsed = ICalText.ParseValue(IcsLexer.JsTrim(text));
        if (parsed is not { } value) return null;
        var valueType = IcsLexer.ParamValue(parameters, "VALUE") is { } v ? IcsLexer.Upper(v) : null;
        if (valueType == "DATE" && value.Kind != ICalValueKind.Date) return null;
        if (valueType is "DATE-TIME" or "PERIOD" && value.Kind == ICalValueKind.Date) return null;
        if (value.Kind == ICalValueKind.Date) return new IcsDateValue.DateValue(value.Date);
        if (value.Kind == ICalValueKind.Utc) return new IcsDateValue.UtcValue(value.Value);
        var tzid = IcsLexer.ParamValue(parameters, "TZID");
        if (!string.IsNullOrEmpty(tzid)) return new IcsDateValue.ZonedValue(value.Value, tzid);
        return new IcsDateValue.FloatingValue(value.Value);
    }

    /// <summary>The text of a value: <c>yyyyMMdd</c>, <c>yyyyMMddTHHmmss</c> or <c>yyyyMMddTHHmmssZ</c> (seconds <c>00</c>).</summary>
    public static string DateValueText(IcsDateValue value) => value switch
    {
        IcsDateValue.DateValue d => ICalText.FormatDate(d.Date),
        IcsDateValue.UtcValue u => ICalText.FormatDateTime(u.Value, 0, true),
        IcsDateValue.FloatingValue f => ICalText.FormatDateTime(f.Value, 0, false),
        IcsDateValue.ZonedValue z => ICalText.FormatDateTime(z.Value, 0, false),
        _ => throw new InvalidOperationException("Unknown IcsDateValue"),
    };

    /// <summary>The wall clock of a date-time value (a date at 00:00).</summary>
    public static LocalDateTime WallClock(IcsDateValue value) => value switch
    {
        IcsDateValue.DateValue d => LocalDateTime.Unchecked(d.Date, 0),
        IcsDateValue.UtcValue u => u.Value,
        IcsDateValue.FloatingValue f => f.Value,
        IcsDateValue.ZonedValue z => z.Value,
        _ => throw new InvalidOperationException("Unknown IcsDateValue"),
    };

    /// <summary>The parameters a value is written with: <c>VALUE=DATE</c> for a date, <c>TZID</c> for a zoned date-time.</summary>
    public static List<IcsParameter> DateValueParams(IcsDateValue value) => value switch
    {
        IcsDateValue.DateValue => [new IcsParameter("VALUE", "DATE")],
        IcsDateValue.ZonedValue z => [new IcsParameter("TZID", IcsLexer.QuoteParam(z.Tzid))],
        _ => [],
    };

    /// <summary>A text key that is equal for equal values (kind, zone and wall clock).</summary>
    public static string DateValueKey(IcsDateValue value) => value switch
    {
        IcsDateValue.DateValue d => $"D {d.Date.ToIsoString()}",
        IcsDateValue.FloatingValue f => $"F {f.Value}",
        IcsDateValue.UtcValue u => $"U {u.Value}",
        IcsDateValue.ZonedValue z => $"Z {z.Tzid} {z.Value}",
        _ => throw new InvalidOperationException("Unknown IcsDateValue"),
    };

    /// <summary><c>true</c> when two values (or nulls) are the same value.</summary>
    public static bool SameDateValue(IcsDateValue? a, IcsDateValue? b)
    {
        if (a is null || b is null) return a is null && b is null;
        return DateValueKey(a) == DateValueKey(b);
    }

    // ---- Durations (RFC 5545 §3.3.6) --------------------------------------------------------------

    /// <summary>Reads <c>P1D</c>, <c>PT1H30M</c>, <c>-P1W</c>, <c>P1DT2H</c>; null for anything else (a <c>T</c> must be followed by a part).</summary>
    public static IcsDuration? ParseDuration(string text)
    {
        var s = IcsLexer.JsTrim(text);
        var i = 0;
        var negative = false;
        if (i < s.Length && s[i] is '+' or '-')
        {
            negative = s[i] == '-';
            i++;
        }
        if (i >= s.Length || s[i] is not ('P' or 'p')) return null;
        i++;
        string? w = null, d = null, h = null, m = null, sec = null;
        // Date part: optional W, then optional D (each a run of digits followed by its letter).
        if (TryPart(s, ref i, 'W', out var part)) w = part;
        if (TryPart(s, ref i, 'D', out part)) d = part;
        if (i < s.Length && s[i] is 'T' or 't')
        {
            i++;
            if (TryPart(s, ref i, 'H', out part)) h = part;
            if (TryPart(s, ref i, 'M', out part)) m = part;
            if (TryPart(s, ref i, 'S', out part)) sec = part;
        }
        if (i != s.Length) return null;
        if (w is null && d is null && h is null && m is null && sec is null) return null;
        if (s[^1] is 'T' or 't') return null;
        BigInteger N(string? x) => x is null ? BigInteger.Zero : BigInteger.Parse(x, NumberStyles.None, CultureInfo.InvariantCulture);
        var days = N(w) * 7 + N(d);
        var seconds = N(h) * 3600 + N(m) * 60 + N(sec);
        if (days > MaxSafe || seconds > MaxSafe) return null;
        return new IcsDuration(negative, (long)days, (long)seconds);
    }

    /// <summary>A run of ASCII digits followed by <paramref name="letter"/> (either case) at <paramref name="i"/>; advances past it.</summary>
    private static bool TryPart(string s, ref int i, char letter, out string digits)
    {
        var j = i;
        while (j < s.Length && Ev.IsAsciiDigit(s[j])) j++;
        if (j == i || j >= s.Length || char.ToUpperInvariant(s[j]) != letter || !Ev.IsAsciiLetter(s[j]))
        {
            digits = "";
            return false;
        }
        digits = s[i..j];
        i = j + 1;
        return true;
    }

    /// <summary>A duration's length in minutes (days as 1440 minutes, seconds truncated toward zero), signed; saturates far outside years 1 to 9999.</summary>
    public static long DurationMinutes(IcsDuration duration)
    {
        var days = Math.Min(duration.Days, long.MaxValue / 2 / Ev.Day);
        var minutes = days * Ev.Day + duration.Seconds / 60;
        return duration.Negative ? -minutes : minutes;
    }

    /// <summary>
    /// Writes a signed number of minutes as a duration: weeks or days when whole (<c>-P1W</c>, <c>-P2D</c>), else
    /// days and a time part (<c>-P1DT1H</c>, <c>-PT15M</c>); 0 is <c>PT0S</c>.
    /// </summary>
    public static string FormatDurationMinutes(long minutes)
    {
        if (minutes == 0) return "PT0S";
        var sign = minutes < 0 ? "-" : "";
        var rest = Math.Abs(minutes);
        if (rest % 10080 == 0) return $"{sign}P{(rest / 10080).Inv()}W";
        var days = rest / 1440;
        rest -= days * 1440;
        var hours = rest / 60;
        var mins = rest - hours * 60;
        var time = rest == 0 ? "" : $"T{(hours > 0 ? $"{hours.Inv()}H" : "")}{(mins > 0 ? $"{mins.Inv()}M" : "")}";
        return $"{sign}P{(days > 0 ? $"{days.Inv()}D" : "")}{time}";
    }

    // ---- UTC offsets (RFC 5545 §3.3.14) -------------------------------------------------------------

    /// <summary>Reads <c>+0300</c>, <c>-0500</c>, <c>+053000</c> as minutes east of UTC (seconds dropped); null for anything else.</summary>
    public static int? ParseUtcOffset(string text)
    {
        var s = IcsLexer.JsTrim(text);
        if (s.Length is not (5 or 7) || s[0] is not ('+' or '-')) return null;
        for (var i = 1; i < s.Length; i++)
        {
            if (!Ev.IsAsciiDigit(s[i])) return null;
        }
        var hours = (s[1] - '0') * 10 + (s[2] - '0');
        var minutes = (s[3] - '0') * 10 + (s[4] - '0');
        if (hours > 23 || minutes > 59 || (s.Length == 7 && (s[5] - '0') * 10 + (s[6] - '0') > 59)) return null;
        var total = hours * 60 + minutes;
        return s[0] == '-' && total != 0 ? -total : total;
    }

    /// <summary>Writes minutes east of UTC as <c>+HHMM</c> / <c>-HHMM</c>.</summary>
    public static string FormatUtcOffset(int minutes)
    {
        var sign = minutes < 0 ? "-" : "+";
        var abs = Math.Abs(minutes);
        return $"{sign}{Ev.Pad(abs / 60, 2)}{Ev.Pad(abs % 60, 2)}";
    }
}

/// <summary>
/// Calendar colors (docs/EVENTS.md §3.6), mirroring packages/core/src/ics/colors.ts:
/// <c>X-APPLE-CALENDAR-COLOR</c> holds <c>#RRGGBB</c> (sometimes with an alpha byte), RFC 7986 <c>COLOR</c> a CSS3
/// color name. Thirteen writes both; the name is the nearest CSS3 color.
/// </summary>
internal static class IcsColors
{
    /// <summary>The 147 CSS Color Module Level 3 keywords, alphabetical, packed as <c>name:rrggbb</c>.</summary>
    private const string Css3 =
        "aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 " +
        "black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 " +
        "chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff " +
        "darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 " +
        "darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 " +
        "darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f " +
        "darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 " +
        "dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc " +
        "ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 " +
        "honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa " +
        "lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff " +
        "lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 " +
        "lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 " +
        "lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 " +
        "mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 " +
        "mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 " +
        "midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 " +
        "oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa " +
        "palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f " +
        "pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 " +
        "saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 " +
        "skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 " +
        "tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff " +
        "whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32";

    private static readonly (string Name, int Value)[] Colors = Css3.Split(' ')
        .Select(entry =>
        {
            var colon = entry.IndexOf(':', StringComparison.Ordinal);
            return (entry[..colon], int.Parse(entry[(colon + 1)..], NumberStyles.HexNumber, CultureInfo.InvariantCulture));
        })
        .ToArray();

    private static readonly Dictionary<string, int> ByName = Colors.ToDictionary(c => c.Name, c => c.Value, StringComparer.Ordinal);

    private static bool IsHex(char c) => c is (>= '0' and <= '9') or (>= 'a' and <= 'f') or (>= 'A' and <= 'F');

    /// <summary><c>#rrggbb</c> (lowercase) from <c>#RRGGBB</c> or <c>#RRGGBBAA</c> (any case), or null.</summary>
    public static string? NormalizeHexColor(string text)
    {
        var s = IcsLexer.JsTrim(text);
        if (s.Length is not (7 or 9) || s[0] != '#') return null;
        for (var i = 1; i < s.Length; i++)
        {
            if (!IsHex(s[i])) return null;
        }
        return "#" + Ev.AsciiLower(s[1..7]);
    }

    /// <summary><c>#rrggbb</c> of a CSS3 color name (any case), or null.</summary>
    public static string? CssColorHex(string name) =>
        ByName.TryGetValue(IcsLexer.JsTrim(name).ToLowerInvariant(), out var value) ? $"#{value.ToString("x6", CultureInfo.InvariantCulture)}" : null;

    /// <summary>
    /// The CSS3 color name nearest to <c>#rrggbb</c> (squared distance in sRGB; ties go to the name that comes
    /// first alphabetically, so <c>aqua</c> before <c>cyan</c> and <c>gray</c> before <c>grey</c>).
    /// </summary>
    public static string NearestCssColorName(string hex)
    {
        var rgb = int.Parse(hex[1..], NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        var r = rgb >> 16;
        var g = (rgb >> 8) & 255;
        var b = rgb & 255;
        var best = Colors[0].Name;
        var bestDistance = long.MaxValue;
        foreach (var (name, value) in Colors)
        {
            long dr = (value >> 16) - r;
            long dg = ((value >> 8) & 255) - g;
            long db = (value & 255) - b;
            var distance = dr * dr + dg * dg + db * db;
            if (distance < bestDistance)
            {
                best = name;
                bestDistance = distance;
            }
        }
        return best;
    }
}
