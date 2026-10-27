using System.Text.RegularExpressions;

namespace Thirteen.Core;

/// <summary>
/// The copy rule for user-visible text (design/DECISIONS.md: no en dash or em dash). Engine data such as
/// calendar history stays byte-identical to @thirteen/core; apply <see cref="WithoutDashes"/> when
/// displaying it, so a dash in engine text never reaches the screen. Mirrors the Apple apps'
/// <c>Phrasing.withoutDashes</c>, so every platform shows the same words.
/// </summary>
public static partial class DisplayText
{
    /// <summary>
    /// Text made to follow the copy rule: a numeric range reads "to" ("3, en dash, 13 September"
    /// becomes "3 to 13 September"), a dash set off by spaces becomes ", ", and any other en or
    /// em dash becomes "-". Text without such dashes is returned unchanged (the same instance).
    /// </summary>
    public static string WithoutDashes(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        if (text.AsSpan().IndexOfAny(EnDash, EmDash) < 0) return text;
        text = NumericRange().Replace(text, "$1 to $2");
        text = SpacedDash().Replace(text, ", ");
        return AnyDash().Replace(text, "-");
    }

    private const char EnDash = '\u2013';
    private const char EmDash = '\u2014';

    // [0-9], not \d: in .NET \d also matches non-ASCII digits; ASCII digits only, as JavaScript's \d in
    // the web's withoutDashes (packages/ui/src/lib/labels.ts).
    [GeneratedRegex(@"([0-9])\s*[\u2013\u2014]\s*([0-9])")]
    private static partial Regex NumericRange();

    [GeneratedRegex(@"\s+[\u2013\u2014]\s+")]
    private static partial Regex SpacedDash();

    [GeneratedRegex(@"[\u2013\u2014]")]
    private static partial Regex AnyDash();
}
