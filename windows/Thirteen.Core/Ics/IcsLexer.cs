using System.Text;
using Thirteen.Core.Events;

namespace Thirteen.Core.Ics;

// iCalendar content lines (RFC 5545 §3.1), mirroring packages/core/src/ics/lexer.ts: physical lines,
// unfolding, properties with parameters, TEXT escaping and 75-octet folding.
//
// The reader is tolerant: CRLF, LF and CR line ends, a UTF-8 byte order mark, folds that begin with a space or
// a tab, lowercase names and quoted parameter values are accepted. The writer is strict: CRLF, uppercase
// names, lines folded at 75 octets without splitting a UTF-8 sequence. Indices are UTF-16 code units, as in
// TypeScript.

/// <summary>One logical (unfolded) content line and the physical lines it came from (indices, inclusive).</summary>
internal readonly record struct ContentLine(string Text, int First, int Last);

/// <summary>A parsed content line with the physical text it was read from. Compared by reference (the writer marks each one used once).</summary>
internal sealed class SourceProperty(IcsProperty property, string source, int line)
{
    public IcsProperty Property { get; } = property;

    public string Name => Property.Name;

    public ValueList<IcsParameter> Params => Property.Params;

    public string Value => Property.Value;

    /// <summary>The physical lines as read, joined with CRLF, without a final line end.</summary>
    public string Source { get; } = source;

    /// <summary>1-based line number of its first physical line.</summary>
    public int Line { get; } = line;
}

internal static class IcsLexer
{
    public const string Crlf = "\r\n";

    private const char Bom = (char)0xfeff;

    /// <summary>The characters JavaScript's <c>String.prototype.trim</c> removes.</summary>
    private static readonly char[] JsWhitespace =
    [
        (char)0x09, (char)0x0a, (char)0x0b, (char)0x0c, (char)0x0d, (char)0x20, (char)0xa0, (char)0x1680, (char)0x2000,
        (char)0x2001, (char)0x2002, (char)0x2003, (char)0x2004, (char)0x2005, (char)0x2006, (char)0x2007, (char)0x2008,
        (char)0x2009, (char)0x200a, (char)0x2028, (char)0x2029, (char)0x202f, (char)0x205f, (char)0x3000, (char)0xfeff,
    ];

    /// <summary>JavaScript <c>trim()</c>.</summary>
    public static string JsTrim(string text) => text.Trim(JsWhitespace);

    /// <summary>JavaScript <c>toUpperCase()</c> for the values the module upper-cases (names, enumerations); see <see cref="JsCase"/>.</summary>
    public static string Upper(string text) => JsCase.Upper(text);

    /// <summary>The physical lines of a text (BOM dropped, any line end), without the empty line after a final line end.</summary>
    public static List<string> PhysicalLines(string text)
    {
        var body = text.Length > 0 && text[0] == Bom ? text[1..] : text;
        var lines = new List<string>();
        var start = 0;
        for (var i = 0; i < body.Length; i++)
        {
            var c = body[i];
            if (c != '\r' && c != '\n') continue;
            lines.Add(body[start..i]);
            if (c == '\r' && i + 1 < body.Length && body[i + 1] == '\n') i++;
            start = i + 1;
        }
        lines.Add(body[start..]);
        if (lines.Count > 0 && lines[^1].Length == 0) lines.RemoveAt(lines.Count - 1);
        return lines;
    }

    /// <summary>Unfolds physical lines <paramref name="from"/>..<paramref name="to"/> (inclusive) into logical lines; empty physical lines are skipped.</summary>
    public static List<ContentLine> Unfold(IReadOnlyList<string> lines, int from = 0, int? to = null)
    {
        var last = to ?? lines.Count - 1;
        var output = new List<ContentLine>();
        StringBuilder? text = null;
        var first = 0;
        var end = 0;
        for (var i = from; i <= last; i++)
        {
            var line = lines[i];
            var continues = line.Length > 0 && (line[0] == ' ' || line[0] == '\t');
            if (continues && text is not null)
            {
                text.Append(line, 1, line.Length - 1);
                end = i;
                continue;
            }
            if (text is not null) output.Add(new ContentLine(text.ToString(), first, end));
            text = null;
            if (line.Length == 0) continue;
            text = new StringBuilder(line);
            first = i;
            end = i;
        }
        if (text is not null) output.Add(new ContentLine(text.ToString(), first, end));
        return output;
    }

    private static bool IsNameChar(char c) => Ev.IsAsciiLetter(c) || Ev.IsAsciiDigit(c) || c == '-';

    private static int NameLength(string text, int start)
    {
        var i = start;
        while (i < text.Length && IsNameChar(text[i])) i++;
        return i - start;
    }

    private static char At(string text, int i) => i < text.Length ? text[i] : '\0';

    /// <summary>
    /// Splits an unfolded line into name, parameters and value: <c>NAME;P=V;Q="x:y":value</c>. A parameter value
    /// ends at an unquoted <c>;</c> or <c>:</c> (commas separate the values of one parameter and stay in its
    /// text). Null when the line is not a content line.
    /// </summary>
    public static IcsProperty? ParseContentLine(string text)
    {
        var nameLength = NameLength(text, 0);
        if (nameLength == 0) return null;
        var name = Ev.AsciiUpper(text[..nameLength]);
        var i = nameLength;
        var parameters = new List<IcsParameter>();
        while (i < text.Length && text[i] == ';')
        {
            var paramLength = NameLength(text, i + 1);
            if (paramLength == 0) return null;
            var paramName = Ev.AsciiUpper(text.Substring(i + 1, paramLength));
            i += 1 + paramLength;
            if (At(text, i) != '=' || i >= text.Length) return null;
            i++;
            var start = i;
            for (;;)
            {
                if (i < text.Length && text[i] == '"')
                {
                    var close = text.IndexOf('"', i + 1);
                    if (close < 0) return null;
                    i = close + 1;
                }
                else
                {
                    while (i < text.Length && text[i] != ';' && text[i] != ':' && text[i] != ',' && text[i] != '"') i++;
                }
                if (i < text.Length && text[i] == ',')
                {
                    i++;
                    continue;
                }
                break;
            }
            if (i >= text.Length || (text[i] != ';' && text[i] != ':')) return null;
            parameters.Add(new IcsParameter(paramName, text[start..i]));
        }
        if (i >= text.Length || text[i] != ':') return null;
        return new IcsProperty(name, parameters, text[(i + 1)..]);
    }

    /// <summary>The first value of a parameter, without quotes, or null when the property has no such parameter.</summary>
    public static string? ParamValue(IReadOnlyList<IcsParameter> parameters, string name)
    {
        foreach (var p in parameters)
        {
            if (p.Name == name) return Unquote(FirstParamValue(p.Value));
        }
        return null;
    }

    /// <summary>The first comma-separated value of a parameter's text (quotes kept).</summary>
    private static string FirstParamValue(string text)
    {
        if (text.StartsWith('"'))
        {
            var close = text.IndexOf('"', 1);
            return close < 0 ? text : text[..(close + 1)];
        }
        var comma = text.IndexOf(',');
        return comma < 0 ? text : text[..comma];
    }

    /// <summary>A parameter value without its surrounding quotes.</summary>
    public static string Unquote(string text) =>
        text.Length >= 2 && text.StartsWith('"') && text.EndsWith('"') ? text[1..^1] : text;

    /// <summary>A parameter value as it must be written: quoted when it holds <c>:</c>, <c>;</c> or <c>,</c> (double quotes are dropped).</summary>
    public static string QuoteParam(string value)
    {
        var clean = value.Replace("\"", "", StringComparison.Ordinal);
        return clean.IndexOfAny([':', ';', ',']) >= 0 ? $"\"{clean}\"" : clean;
    }

    /// <summary>Decodes a <c>TEXT</c> value: <c>\n</c> and <c>\N</c> are line breaks, <c>\,</c> <c>\;</c> <c>\\</c> the character; any other <c>\x</c> is <c>x</c>.</summary>
    public static string UnescapeText(string value)
    {
        if (!value.Contains('\\', StringComparison.Ordinal)) return value;
        var output = new StringBuilder(value.Length);
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            if (c != '\\' || i == value.Length - 1)
            {
                output.Append(c);
                continue;
            }
            var next = value[++i];
            output.Append(next is 'n' or 'N' ? '\n' : next);
        }
        return output.ToString();
    }

    /// <summary>Encodes a <c>TEXT</c> value: backslash, <c>;</c>, <c>,</c> escaped, every line break (CRLF, CR, LF) as <c>\n</c>.</summary>
    public static string EscapeText(string text)
    {
        var output = new StringBuilder(text.Length + 8);
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            switch (c)
            {
                case '\\': output.Append("\\\\"); break;
                case ';': output.Append("\\;"); break;
                case ',': output.Append("\\,"); break;
                case '\r':
                    if (i + 1 < text.Length && text[i + 1] == '\n') i++;
                    output.Append("\\n");
                    break;
                case '\n': output.Append("\\n"); break;
                default: output.Append(c); break;
            }
        }
        return output.ToString();
    }

    /// <summary>The unfolded text of a property: <c>NAME;PARAM=value:value</c>.</summary>
    public static string ContentLineText(IcsProperty property)
    {
        var builder = new StringBuilder(property.Name);
        foreach (var p in property.Params) builder.Append(';').Append(p.Name).Append('=').Append(p.Value);
        return builder.Append(':').Append(property.Value).ToString();
    }

    /// <summary>
    /// Folds an unfolded line (RFC 5545 §3.1): the first physical line holds at most 75 octets of UTF-8, every
    /// continuation a space and at most 74 more; a code point is never split (a lone surrogate counts 3 octets,
    /// as TypeScript counts it). Returns the physical lines joined with CRLF, without a final line end.
    /// </summary>
    public static string FoldLine(string text)
    {
        var output = new StringBuilder(text.Length + 8);
        var octets = 0;
        var limit = 75;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            var pair = char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]);
            var size = pair ? 4 : c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
            if (octets + size > limit)
            {
                output.Append("\r\n ");
                octets = 0;
                limit = 74;
            }
            output.Append(c);
            if (pair) output.Append(text[++i]);
            octets += size;
        }
        return output.ToString();
    }
}
