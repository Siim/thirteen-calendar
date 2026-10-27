using System.Diagnostics.CodeAnalysis;
using System.Text;

namespace Thirteen.Core.Events;

// RFC 5545 §3.3.10 recurrence rules (docs/EVENTS.md §4.3, §4.5, §5.2), mirroring
// packages/core/src/events/rrule.ts: the RRule value, its strict text syntax (Parse, ToString), semantic
// equality (IsEquivalentTo), the reading of UNTIL as a wall-clock end (Until.InZone, Until.EndDate) and
// the writing of an end date as an UNTIL (Until.Format).
//
// Syntax accepted by Parse: NAME=VALUE parts separated by ';', in any order, with an optional "RRULE:"
// prefix and one optional trailing ';'. Names and enumerated values are ASCII case-insensitive; RSCALE
// values and X- names are stored uppercase, X- values verbatim. Numbers are plain ASCII digits with the
// RFC's digit counts, signed only where the RFC allows a sign. Minute precision: an UNTIL date-time keeps
// its minute (seconds dropped when reading, written as 59).

/// <summary><c>FREQ</c> values. TS: <c>Frequency</c> (lowercase strings).</summary>
public enum Frequency
{
    /// <summary><c>SECONDLY</c> (never expanded, §4.6).</summary>
    Secondly,
    /// <summary><c>MINUTELY</c> (never expanded).</summary>
    Minutely,
    /// <summary><c>HOURLY</c> (never expanded).</summary>
    Hourly,
    /// <summary><c>DAILY</c>.</summary>
    Daily,
    /// <summary><c>WEEKLY</c>.</summary>
    Weekly,
    /// <summary><c>MONTHLY</c>.</summary>
    Monthly,
    /// <summary><c>YEARLY</c>.</summary>
    Yearly,
}

/// <summary>Text forms of <see cref="Frequency"/>.</summary>
public static class FrequencyExtensions
{
    private static readonly string[] Names = ["secondly", "minutely", "hourly", "daily", "weekly", "monthly", "yearly"];

    /// <summary>The TypeScript and JSON value: <c>"weekly"</c>.</summary>
    public static string RawValue(this Frequency frequency) => Names[(int)frequency];

    /// <summary>Parses a lowercase TypeScript value (<c>"weekly"</c>).</summary>
    public static bool TryParse(string? text, out Frequency frequency)
    {
        var index = Array.IndexOf(Names, text);
        frequency = (Frequency)Math.Max(index, 0);
        return index >= 0;
    }
}

/// <summary>
/// One <c>BYDAY</c> entry: a weekday with an optional ordinal (<c>2TU</c> is Tuesday with ordinal 2).
/// TS: <c>WeekdayNum</c>.
/// </summary>
public readonly record struct WeekdayNum
{
    /// <summary>A validated entry: <paramref name="ordinal"/> is <c>-53..-1</c>, <c>1..53</c> or <c>null</c>.</summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidRule"/> otherwise.</exception>
    public WeekdayNum(Weekday weekday, int? ordinal = null)
    {
        if (!Weekdays.IsValid((int)weekday)) throw Ev.RuleFail($"BYDAY weekday must be 0..6, got {((int)weekday).Inv()}");
        if (ordinal is { } n && (n == 0 || Math.Abs(n) > 53)) throw Ev.RuleFail($"BYDAY ordinal must be -53..-1 or 1..53, got {n.Inv()}");
        Weekday = weekday;
        Ordinal = ordinal;
    }

    /// <summary>The weekday.</summary>
    public Weekday Weekday { get; }

    /// <summary><c>-53..-1</c> or <c>1..53</c>, or <c>null</c> for every such weekday.</summary>
    public int? Ordinal { get; }

    /// <summary><c>2TU</c>, <c>-1FR</c>, <c>MO</c>.</summary>
    public override string ToString() => $"{(Ordinal is { } n ? n.Inv() : "")}{ICalText.WeekdayCode(Weekday)}";
}

/// <summary>An <c>UNTIL</c> value as written: a date, a floating date-time or a UTC date-time (seconds dropped). TS: <c>RRuleUntil</c>.</summary>
public abstract record RRuleUntil
{
    private RRuleUntil()
    {
    }

    /// <summary><c>"date"</c>, <c>"floating"</c> or <c>"utc"</c>.</summary>
    public abstract string Kind { get; }

    /// <summary>A DATE until (<c>UNTIL=20261231</c>).</summary>
    public static RRuleUntil OnDate(GregorianDate date) => new DateUntil(date);

    /// <summary>A floating date-time until.</summary>
    public static RRuleUntil Floating(LocalDateTime value) => new FloatingUntil(value);

    /// <summary>A UTC date-time until.</summary>
    public static RRuleUntil Utc(LocalDateTime value) => new UtcUntil(value);

    /// <summary>A DATE until.</summary>
    public sealed record DateUntil(GregorianDate Date) : RRuleUntil
    {
        /// <inheritdoc />
        public override string Kind => "date";
    }

    /// <summary>A floating date-time until (minute 0..1439).</summary>
    public sealed record FloatingUntil : RRuleUntil
    {
        /// <summary>Validated: minute 0..1439.</summary>
        public FloatingUntil(LocalDateTime value)
        {
            if (value.Minute == Ev.Day) throw Ev.RuleFail($"Invalid UNTIL: until value must be a local date-time with minute 0..1439, got \"{value}\"");
            Value = value;
        }

        /// <summary>The wall clock.</summary>
        public LocalDateTime Value { get; }

        /// <inheritdoc />
        public override string Kind => "floating";
    }

    /// <summary>A UTC date-time until (minute 0..1439).</summary>
    public sealed record UtcUntil : RRuleUntil
    {
        /// <summary>Validated: minute 0..1439.</summary>
        public UtcUntil(LocalDateTime value)
        {
            if (value.Minute == Ev.Day) throw Ev.RuleFail($"Invalid UNTIL: until value must be a local date-time with minute 0..1439, got \"{value}\"");
            Value = value;
        }

        /// <summary>The UTC wall clock.</summary>
        public LocalDateTime Value { get; }

        /// <inheritdoc />
        public override string Kind => "utc";
    }

    /// <summary>The value text as <see cref="RRule.ToString"/> writes it (<c>20261231</c>, <c>20261116T165959Z</c>).</summary>
    internal string ValueText() => this switch
    {
        DateUntil d => ICalText.FormatDate(d.Date),
        FloatingUntil f => ICalText.FormatDateTime(f.Value, 59, false),
        UtcUntil u => ICalText.FormatDateTime(u.Value, 59, true),
        _ => throw new InvalidOperationException(),
    };
}

/// <summary>An <c>X-NAME=VALUE</c> part of a rule, kept in order. TS: <c>[name, value]</c>.</summary>
public readonly record struct RRuleExtension(string Name, string Value);

/// <summary>
/// A parsed <c>RRULE</c> (or <c>EXRULE</c>) value; lists keep their input order. TS: <c>RRule</c>.
/// </summary>
/// <remarks>
/// Every property validates its value (RFC ranges, uppercase <c>RSCALE</c>, <c>SKIP</c> and <c>X-</c>
/// names), also in <c>with</c> expressions; <see cref="Count"/> together with <see cref="Until"/> is
/// rejected by every function that reads a rule. Record equality is exact (lists in order); for the
/// RFC's meaning use <see cref="IsEquivalentTo"/>. <see cref="ToString"/> is the canonical text.
/// </remarks>
public sealed record RRule
{
    private readonly int _interval = 1;
    private readonly int? _count;
    private readonly ValueList<int> _bySecond = ValueList<int>.Empty;
    private readonly ValueList<int> _byMinute = ValueList<int>.Empty;
    private readonly ValueList<int> _byHour = ValueList<int>.Empty;
    private readonly ValueList<WeekdayNum> _byDay = ValueList<WeekdayNum>.Empty;
    private readonly ValueList<int> _byMonthDay = ValueList<int>.Empty;
    private readonly ValueList<int> _byYearDay = ValueList<int>.Empty;
    private readonly ValueList<int> _byWeekNo = ValueList<int>.Empty;
    private readonly ValueList<int> _byMonth = ValueList<int>.Empty;
    private readonly ValueList<int> _bySetPos = ValueList<int>.Empty;
    private readonly Weekday? _wkst;
    private readonly string? _rscale;
    private readonly string? _skip;
    private readonly ValueList<RRuleExtension> _extensions = ValueList<RRuleExtension>.Empty;

    /// <summary>A rule of frequency <paramref name="freq"/>, interval 1 and no other part.</summary>
    public RRule(Frequency freq)
    {
        Freq = freq;
    }

    /// <summary>The frequency.</summary>
    public Frequency Freq { get; init; }

    /// <summary><c>1..2147483647</c>, default 1.</summary>
    public int Interval
    {
        get => _interval;
        init => _interval = value >= 1 ? value : throw Ev.RuleFail($"Invalid rrule: interval must be an integer 1..{Ev.MaxInt.Inv()}, got {value.Inv()}");
    }

    /// <summary><c>1..2147483647</c> or <c>null</c>.</summary>
    public int? Count
    {
        get => _count;
        init => _count = value is null or >= 1 ? value : throw Ev.RuleFail($"Invalid rrule: count must be an integer 1..{Ev.MaxInt.Inv()} or null, got {value.Value.Inv()}");
    }

    /// <summary>The until, or <c>null</c>. Never set together with <see cref="Count"/>.</summary>
    public RRuleUntil? Until { get; init; }

    /// <summary><c>0..60</c>.</summary>
    public ValueList<int> BySecond { get => _bySecond; init => _bySecond = Checked(value, Parts[0]); }

    /// <summary><c>0..59</c>.</summary>
    public ValueList<int> ByMinute { get => _byMinute; init => _byMinute = Checked(value, Parts[1]); }

    /// <summary><c>0..23</c>.</summary>
    public ValueList<int> ByHour { get => _byHour; init => _byHour = Checked(value, Parts[2]); }

    /// <summary><c>BYDAY</c> entries.</summary>
    public ValueList<WeekdayNum> ByDay { get => _byDay; init => _byDay = value ?? throw Ev.RuleFail("Invalid rrule: byDay must be a list"); }

    /// <summary><c>-31..-1</c> or <c>1..31</c>.</summary>
    public ValueList<int> ByMonthDay { get => _byMonthDay; init => _byMonthDay = Checked(value, Parts[3]); }

    /// <summary><c>-366..-1</c> or <c>1..366</c>.</summary>
    public ValueList<int> ByYearDay { get => _byYearDay; init => _byYearDay = Checked(value, Parts[4]); }

    /// <summary><c>-53..-1</c> or <c>1..53</c>.</summary>
    public ValueList<int> ByWeekNo { get => _byWeekNo; init => _byWeekNo = Checked(value, Parts[5]); }

    /// <summary><c>1..12</c> (Gregorian months).</summary>
    public ValueList<int> ByMonth { get => _byMonth; init => _byMonth = Checked(value, Parts[6]); }

    /// <summary><c>-366..-1</c> or <c>1..366</c>.</summary>
    public ValueList<int> BySetPos { get => _bySetPos; init => _bySetPos = Checked(value, Parts[7]); }

    /// <summary><c>WKST</c>, or <c>null</c> (Monday).</summary>
    public Weekday? Wkst
    {
        get => _wkst;
        init => _wkst = value is null || Weekdays.IsValid((int)value.Value) ? value : throw Ev.RuleFail("Invalid rrule: wkst must be a weekday 0..6 or null");
    }

    /// <summary>RFC 7529 <c>RSCALE</c>, uppercase letters, digits and <c>-</c>, or <c>null</c>.</summary>
    public string? Rscale
    {
        get => _rscale;
        init => _rscale = value is null || IsRscale(value) ? value : throw Ev.RuleFail($"Invalid rrule: rscale must be null or uppercase letters, digits and '-', got {Ev.Show(value)}");
    }

    /// <summary>RFC 7529 <c>SKIP</c>: <c>OMIT</c>, <c>BACKWARD</c>, <c>FORWARD</c> or <c>null</c>.</summary>
    public string? Skip
    {
        get => _skip;
        init => _skip = value is null || Array.IndexOf(SkipValues, value) >= 0 ? value : throw Ev.RuleFail($"Invalid rrule: skip must be null or one of OMIT, BACKWARD, FORWARD, got {Ev.Show(value)}");
    }

    /// <summary><c>X-NAME=VALUE</c> parts, kept in order.</summary>
    public ValueList<RRuleExtension> Extensions
    {
        get => _extensions;
        init
        {
            ArgumentNullException.ThrowIfNull(value);
            foreach (var x in value)
            {
                if (!IsXName(x.Name) || !IsXValue(x.Value))
                {
                    throw Ev.RuleFail("Invalid rrule: extensions must be an array of [X-NAME, value] pairs (uppercase name; value without spaces, controls or ';')");
                }
            }
            _extensions = value;
        }
    }

    // ---- Tables ---------------------------------------------------------------------------------

    private sealed record ListPart(string Name, bool Signed, int Min, int Max, int Digits);

    /// <summary>The numeric list parts in canonical order; BYDAY is written after the first three.</summary>
    private static readonly ListPart[] Parts =
    [
        new("BYSECOND", false, 0, 60, 2),
        new("BYMINUTE", false, 0, 59, 2),
        new("BYHOUR", false, 0, 23, 2),
        new("BYMONTHDAY", true, 1, 31, 2),
        new("BYYEARDAY", true, 1, 366, 3),
        new("BYWEEKNO", true, 1, 53, 2),
        new("BYMONTH", false, 1, 12, 2),
        new("BYSETPOS", true, 1, 366, 3),
    ];

    private static readonly string[] SkipValues = ["OMIT", "BACKWARD", "FORWARD"];

    private static bool InRange(ListPart part, int value) =>
        part.Signed ? value != 0 && Math.Abs(value) <= part.Max : value >= part.Min && value <= part.Max;

    private static string RangeText(ListPart part) =>
        part.Signed ? $"-{part.Max.Inv()}..-1 or 1..{part.Max.Inv()}" : $"{part.Min.Inv()}..{part.Max.Inv()}";

    private static ValueList<int> Checked(ValueList<int> list, ListPart part)
    {
        ArgumentNullException.ThrowIfNull(list);
        foreach (var v in list)
        {
            if (!InRange(part, v)) throw Ev.RuleFail($"Invalid rrule: {part.Name} values must be {RangeText(part)}, got {v.Inv()}");
        }
        return list;
    }

    private ValueList<int> ListAt(int index) => index switch
    {
        0 => BySecond,
        1 => ByMinute,
        2 => ByHour,
        3 => ByMonthDay,
        4 => ByYearDay,
        5 => ByWeekNo,
        6 => ByMonth,
        _ => BySetPos,
    };

    private static bool IsName(string text) => text.Length > 0 && text.All(c => Ev.IsAsciiLetter(c) || Ev.IsAsciiDigit(c) || c == '-');

    private static bool IsRscale(string text) => text.Length > 0 && text.All(c => c is (>= 'A' and <= 'Z') or (>= '0' and <= '9') or '-');

    private static bool IsXName(string? text) =>
        text is not null && text.Length > 2 && text.StartsWith("X-", StringComparison.Ordinal) && IsRscale(text[2..]);

    /// <summary>An X- value: any characters above U+0020 except ';' and U+007F.</summary>
    private static bool IsXValue(string? text) => text is not null && text.Length > 0 && text.All(c => c > ' ' && c != ';' && c != '\u007f');

    // ---- Validation -------------------------------------------------------------------------

    /// <summary>Throws unless the rule could have come from <see cref="Parse"/> (never both count and until). TS: <c>assertValidRRule</c>.</summary>
    internal void Validate(string context = "rrule")
    {
        if (Count is not null && Until is not null) throw Ev.RuleFail($"Invalid {context}: count and until cannot both be set");
    }

    // ---- Parsing ----------------------------------------------------------------------------

    /// <summary>
    /// Parses an <c>RRULE</c> (or <c>EXRULE</c>) value with the strict grammar above.
    /// <c>RRule.Parse("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261116T165959Z")</c> is a weekly rule on Monday and
    /// Wednesday until 2026-11-16T16:59 UTC. TS: <c>parseRRule</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidRule"/> for malformed text, a value outside its RFC range,
    /// <c>COUNT</c> with <c>UNTIL</c>, or a repeated or unknown name.
    /// </exception>
    public static RRule Parse(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        ThirteenException Bad(string why) => Ev.RuleFail($"Invalid RRULE {Ev.Show(text)}: {why}");
        var body = text.Length >= 6 && Ev.AsciiUpper(text[..6]) == "RRULE:" ? text[6..] : text;
        if (body.EndsWith(';')) body = body[..^1];
        if (body.Length == 0) throw Bad("FREQ is required");

        Frequency? freq = null;
        var interval = 1;
        int? count = null;
        RRuleUntil? until = null;
        var lists = new ValueList<int>[Parts.Length];
        for (var i = 0; i < lists.Length; i++) lists[i] = ValueList<int>.Empty;
        var byDay = ValueList<WeekdayNum>.Empty;
        Weekday? wkst = null;
        string? rscale = null;
        string? skip = null;
        var extensions = new List<RRuleExtension>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        string[] Items(string name, string value)
        {
            var parts = value.Split(',');
            if (parts.Contains("")) throw Bad($"{name} has an empty list item");
            return parts;
        }

        int Counter(string name, string value)
        {
            if (value.Length is >= 1 and <= 10 && value.All(Ev.IsAsciiDigit) && long.TryParse(value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var n)
                && n >= 1 && n <= Ev.MaxInt)
            {
                return (int)n;
            }
            throw Bad($"{name} must be an integer 1..{Ev.MaxInt.Inv()}, got {Ev.Show(value)}");
        }

        foreach (var part in body.Split(';'))
        {
            var eq = part.IndexOf('=', StringComparison.Ordinal);
            var rawName = eq < 0 ? part : part[..eq];
            if (eq < 0 || !IsName(rawName)) throw Bad($"expected NAME=VALUE, got {Ev.Show(part)}");
            var name = Ev.AsciiUpper(rawName);
            var value = part[(eq + 1)..];
            if (value.Length == 0) throw Bad($"{name} has no value");
            if (!seen.Add(name)) throw Bad($"{name} appears more than once");

            var listIndex = Array.FindIndex(Parts, p => p.Name == name);
            if (listIndex >= 0)
            {
                var list = Parts[listIndex];
                lists[listIndex] = Items(name, value).Select(item =>
                {
                    var number = ParseSigned(item, list.Signed, list.Digits);
                    if (number is not { } n || !InRange(list, n)) throw Bad($"{name} values must be {RangeText(list)}, got {Ev.Show(item)}");
                    return n;
                }).ToValueList();
                continue;
            }
            switch (name)
            {
                case "FREQ":
                {
                    var lower = value.All(Ev.IsAsciiLetter) ? Ev.AsciiLower(value) : "";
                    if (!FrequencyExtensions.TryParse(lower, out var f)) throw Bad($"unknown FREQ {Ev.Show(value)}");
                    freq = f;
                    break;
                }
                case "INTERVAL":
                    interval = Counter(name, value);
                    break;
                case "COUNT":
                    count = Counter(name, value);
                    break;
                case "UNTIL":
                {
                    var parsed = ICalText.ParseValue(value)
                        ?? throw Bad($"UNTIL must be yyyyMMdd, yyyyMMddTHHmmss or yyyyMMddTHHmmssZ, got {Ev.Show(value)}");
                    until = parsed.Kind switch
                    {
                        ICalValueKind.Date => new RRuleUntil.DateUntil(parsed.Date),
                        ICalValueKind.Utc => new RRuleUntil.UtcUntil(parsed.Value),
                        _ => new RRuleUntil.FloatingUntil(parsed.Value),
                    };
                    break;
                }
                case "BYDAY":
                    byDay = Items(name, value).Select(item => ParseByDay(item) ?? throw Bad(
                        $"BYDAY values must be SU..SA with an optional ordinal -53..-1 or 1..53, got {Ev.Show(item)}")).ToValueList();
                    break;
                case "WKST":
                    wkst = ICalText.ParseWeekdayCode(value) ?? throw Bad($"WKST must be SU..SA, got {Ev.Show(value)}");
                    break;
                case "RSCALE":
                    if (!IsName(value)) throw Bad($"RSCALE must be letters, digits and '-', got {Ev.Show(value)}");
                    rscale = Ev.AsciiUpper(value);
                    break;
                case "SKIP":
                {
                    var upper = value.All(Ev.IsAsciiLetter) ? Ev.AsciiUpper(value) : "";
                    if (Array.IndexOf(SkipValues, upper) < 0) throw Bad($"SKIP must be OMIT, BACKWARD or FORWARD, got {Ev.Show(value)}");
                    skip = upper;
                    break;
                }
                default:
                    if (!IsXName(name)) throw Bad($"unknown part {name}");
                    if (!IsXValue(value)) throw Bad($"{name} has a space, a control character or ';' in its value");
                    extensions.Add(new RRuleExtension(name, value));
                    break;
            }
        }
        if (freq is null) throw Bad("FREQ is required");
        if (count is not null && until is not null) throw Bad("COUNT and UNTIL cannot both be present");
        return new RRule(freq.Value)
        {
            Interval = interval,
            Count = count,
            Until = until,
            BySecond = lists[0],
            ByMinute = lists[1],
            ByHour = lists[2],
            ByDay = byDay,
            ByMonthDay = lists[3],
            ByYearDay = lists[4],
            ByWeekNo = lists[5],
            ByMonth = lists[6],
            BySetPos = lists[7],
            Wkst = wkst,
            Rscale = rscale,
            Skip = skip,
            Extensions = extensions,
        };
    }

    /// <summary>Like <see cref="Parse"/> but returns <c>false</c> instead of throwing. TS: <c>tryParseRRule</c>.</summary>
    public static bool TryParse([NotNullWhen(true)] string? text, [NotNullWhen(true)] out RRule? rule)
    {
        rule = null;
        if (text is null) return false;
        try
        {
            rule = Parse(text);
            return true;
        }
        catch (ThirteenException)
        {
            return false;
        }
    }

    /// <summary>A number of 1 to <paramref name="digits"/> ASCII digits, with an optional sign when <paramref name="signed"/>.</summary>
    private static int? ParseSigned(string text, bool signed, int digits)
    {
        var start = signed && text.Length > 0 && text[0] is '+' or '-' ? 1 : 0;
        var length = text.Length - start;
        if (length < 1 || length > digits) return null;
        var value = 0;
        for (var i = start; i < text.Length; i++)
        {
            if (!Ev.IsAsciiDigit(text[i])) return null;
            value = value * 10 + (text[i] - '0');
        }
        return start == 1 && text[0] == '-' ? -value : value;
    }

    /// <summary><c>[+-]?[0-9]{1,2}</c> followed by a weekday code, or <c>null</c>.</summary>
    private static WeekdayNum? ParseByDay(string item)
    {
        if (item.Length < 2) return null;
        var weekday = ICalText.ParseWeekdayCode(item[^2..]);
        if (weekday is null) return null;
        var prefix = item[..^2];
        if (prefix.Length == 0) return new WeekdayNum(weekday.Value);
        var sign = prefix[0] is '+' or '-' ? prefix[0] : '\0';
        var digits = sign == '\0' ? prefix : prefix[1..];
        if (digits.Length is < 1 or > 2 || !digits.All(Ev.IsAsciiDigit)) return null;
        var size = int.Parse(digits, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture);
        if (size == 0 || size > 53) return null;
        return new WeekdayNum(weekday.Value, sign == '-' ? -size : size);
    }

    // ---- Formatting -------------------------------------------------------------------------

    /// <summary>
    /// The canonical text without a prefix:
    /// <c>FREQ;INTERVAL (if not 1);COUNT or UNTIL;BYSECOND;BYMINUTE;BYHOUR;BYDAY;BYMONTHDAY;BYYEARDAY;BYWEEKNO;BYMONTH;BYSETPOS;WKST;RSCALE;SKIP;X- parts</c>.
    /// Empty lists are left out, list values keep their order, a date-time <c>UNTIL</c> has seconds 59.
    /// <c>RRule.Parse(rule.ToString())</c> equals <c>rule</c>. TS: <c>formatRRule</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidRule"/> when both count and until are set.</exception>
    public override string ToString()
    {
        Validate();
        var parts = new List<string> { $"FREQ={Ev.AsciiUpper(Freq.RawValue())}" };
        if (Interval != 1) parts.Add($"INTERVAL={Interval.Inv()}");
        if (Count is { } count) parts.Add($"COUNT={count.Inv()}");
        if (Until is not null) parts.Add($"UNTIL={Until.ValueText()}");
        for (var index = 0; index < Parts.Length; index++)
        {
            if (index == 3 && ByDay.Count > 0) parts.Add($"BYDAY={string.Join(",", ByDay.Select(d => d.ToString()))}");
            var values = ListAt(index);
            if (values.Count > 0) parts.Add($"{Parts[index].Name}={string.Join(",", values.Select(v => v.Inv()))}");
        }
        if (Wkst is { } wkst) parts.Add($"WKST={ICalText.WeekdayCode(wkst)}");
        if (Rscale is not null) parts.Add($"RSCALE={Rscale}");
        if (Skip is not null) parts.Add($"SKIP={Skip}");
        foreach (var x in Extensions) parts.Add($"{x.Name}={x.Value}");
        return string.Join(";", parts);
    }

    // ---- Equality ---------------------------------------------------------------------------

    /// <summary>
    /// <c>true</c> when two rules mean the same: equal frequency and interval, equal count and until, every
    /// list compared as a set (<c>BYDAY</c> by weekday and ordinal), RFC defaults applied (no <c>WKST</c>
    /// is <c>MO</c>, no <c>RSCALE</c> is <c>GREGORIAN</c>, no <c>SKIP</c> is <c>OMIT</c>), <c>X-</c> parts as a
    /// set of pairs. <paramref name="ignoreEnd"/> leaves out count and until, <paramref name="ignoreWkst"/>
    /// leaves out <c>WKST</c>. TS: <c>rruleEquals</c>.
    /// </summary>
    public bool IsEquivalentTo(RRule other, bool ignoreEnd = false, bool ignoreWkst = false)
    {
        ArgumentNullException.ThrowIfNull(other);
        Validate("first rrule");
        other.Validate("second rrule");
        if (Freq != other.Freq || Interval != other.Interval) return false;
        if (!ignoreEnd && (Count != other.Count || !UntilEquals(Until, other.Until))) return false;
        for (var i = 0; i < Parts.Length; i++)
        {
            if (!SameSet(ListAt(i), other.ListAt(i))) return false;
        }
        if (!SameSet(ByDay, other.ByDay)) return false;
        if (!ignoreWkst && (Wkst ?? Weekday.Monday) != (other.Wkst ?? Weekday.Monday)) return false;
        if ((Rscale ?? "GREGORIAN") != (other.Rscale ?? "GREGORIAN") || (Skip ?? "OMIT") != (other.Skip ?? "OMIT")) return false;
        return SameSet(Extensions, other.Extensions);
    }

    internal static bool SameSet<T>(IEnumerable<T> a, IEnumerable<T> b) => new HashSet<T>(a).SetEquals(b);

    private static bool UntilEquals(RRuleUntil? a, RRuleUntil? b)
    {
        if (a is null || b is null) return a is null && b is null;
        return a.Kind == b.Kind && a.ValueText() == b.ValueText();
    }

    /// <summary>A plain rule of <paramref name="freq"/> (internal shorthand of TS <c>simpleRRule</c>).</summary>
    internal static RRule Of(Frequency freq) => new(freq);
}

/// <summary>The kind of an iCalendar DATE or DATE-TIME text value.</summary>
internal enum ICalValueKind
{
    Date,
    Local,
    Utc,
}

/// <summary>A DATE or DATE-TIME value of iCalendar text, minute precision. TS: <c>ICalTextValue</c>.</summary>
internal readonly record struct ICalValue(ICalValueKind Kind, GregorianDate Date, LocalDateTime Value);

/// <summary>iCalendar DATE and DATE-TIME text and weekday codes (shared with the .ics module). TS: rrule.ts helpers.</summary>
internal static class ICalText
{
    private static readonly string[] WeekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

    /// <summary>
    /// Parses <c>yyyyMMdd</c>, <c>yyyyMMddTHHmmss</c> or <c>yyyyMMddTHHmmssZ</c> (T and Z in either case),
    /// years 0001..9999, hours 00..23, minutes 00..59, seconds 00..60; seconds are dropped. Null otherwise.
    /// TS: <c>parseICalValue</c>.
    /// </summary>
    public static ICalValue? ParseValue(string text)
    {
        if (text.Length is not (8 or 15 or 16)) return null;
        var year = Calc.Digits(text, 0, 4);
        var month = Calc.Digits(text, 4, 2);
        var day = Calc.Digits(text, 6, 2);
        if (year < 0 || month < 0 || day < 0 || !GregorianDate.IsValid(year, month, day)) return null;
        var date = new GregorianDate(year, month, day);
        if (text.Length == 8) return new ICalValue(ICalValueKind.Date, date, default);
        if (text[8] is not ('T' or 't')) return null;
        var hour = Calc.Digits(text, 9, 2);
        var minute = Calc.Digits(text, 11, 2);
        var second = Calc.Digits(text, 13, 2);
        if (hour < 0 || minute < 0 || second < 0) return null;
        var utc = false;
        if (text.Length == 16)
        {
            if (text[15] is not ('Z' or 'z')) return null;
            utc = true;
        }
        if (hour > 23 || minute > 59 || second > 60) return null;
        return new ICalValue(utc ? ICalValueKind.Utc : ICalValueKind.Local, date, LocalDateTime.Unchecked(date, hour * 60 + minute));
    }

    /// <summary><c>yyyyMMdd</c>. TS: <c>formatICalDate</c>.</summary>
    public static string FormatDate(GregorianDate date) => $"{Ev.Pad(date.Year, 4)}{Ev.Pad(date.Month, 2)}{Ev.Pad(date.Day, 2)}";

    /// <summary><c>yyyyMMddTHHmmss</c>, with <c>Z</c> when <paramref name="utc"/>; minute 0..1439. TS: <c>formatICalDateTime</c>.</summary>
    public static string FormatDateTime(LocalDateTime value, int seconds, bool utc)
    {
        var builder = new StringBuilder(16);
        builder.Append(FormatDate(value.Date)).Append('T')
            .Append(Ev.Pad(value.Minute / 60, 2)).Append(Ev.Pad(value.Minute % 60, 2)).Append(Ev.Pad(seconds, 2));
        if (utc) builder.Append('Z');
        return builder.ToString();
    }

    /// <summary>The weekday code <c>SU</c>..<c>SA</c>. TS: <c>weekdayCode</c>.</summary>
    public static string WeekdayCode(Weekday weekday) => WeekdayCodes[(int)weekday];

    /// <summary>The weekday of a code (ASCII case-insensitive), or null. TS: <c>parseWeekdayCode</c>.</summary>
    public static Weekday? ParseWeekdayCode(string text)
    {
        if (text.Length != 2 || !Ev.IsAsciiLetter(text[0]) || !Ev.IsAsciiLetter(text[1])) return null;
        var index = Array.IndexOf(WeekdayCodes, Ev.AsciiUpper(text));
        return index < 0 ? null : (Weekday)index;
    }
}

/// <summary>
/// <c>UNTIL</c> values in the event's zone (§4.4, §4.5, §4.7). TS: <c>untilInZone</c>, <c>untilEndDate</c>,
/// <c>formatUntil</c>.
/// </summary>
public static class Until
{
    /// <summary>Absolute minute of 9999-12-31T23:59, the last UTC minute an UNTIL can name.</summary>
    private const long LastUntilAbsolute = LocalDateTime.MaxAbsolute;

    /// <summary>
    /// An <c>UNTIL</c> as a wall-clock value in the event's zone (§4.5), rounded down to the minute: a DATE
    /// until becomes <c>D T24:00</c>; a floating until is kept; a UTC until is converted to
    /// <paramref name="zone"/> (with <paramref name="zone"/> null, its wall clock is kept as it is).
    /// <c>UNTIL=20261116T165959Z</c> in <c>Europe/Tallinn</c> is <c>2026-11-16T18:59</c>. TS: <c>untilInZone</c>.
    /// </summary>
    /// <returns>The until in the event's zone, or <c>null</c> when a UTC until converts outside years 1 to 9999.</returns>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for a zone that is empty or unknown.</exception>
    public static LocalDateTime? InZone(RRuleUntil until, string? zone, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(until);
        if (zone is not null) ZoneMath.AssertKnownZone(zone, zones);
        return until switch
        {
            RRuleUntil.DateUntil d => LocalDateTime.Unchecked(d.Date, Ev.Day),
            RRuleUntil.FloatingUntil f => f.Value,
            RRuleUntil.UtcUntil u when zone is null => u.Value,
            RRuleUntil.UtcUntil u => ZoneMath.ToZoned(u.Value, zone!, zones),
            _ => throw new InvalidOperationException(),
        };
    }

    /// <summary>
    /// The last original date whose occurrence, starting at <paramref name="startMinute"/>, starts at or
    /// before <paramref name="until"/> (§4.5): <c>until.Date</c> when the start minute is at or before
    /// <c>until.Minute</c>, else the day before. TS: <c>untilEndDate</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidEvent"/> for a start minute outside 0..1439 or a result before 0001-01-01.
    /// </exception>
    public static GregorianDate EndDate(LocalDateTime until, int startMinute)
    {
        if (startMinute is < 0 or > 1439) throw Ev.Fail($"Start minute must be an integer 0..1439, got {startMinute.Inv()}");
        if (startMinute <= until.Minute) return until.Date;
        if (until.Date.JulianDayNumber == GregorianDate.MinJulianDayNumber)
        {
            throw Ev.Fail($"No date before 0001-01-01: an occurrence at minute {startMinute.Inv()} starts after the until 0001-01-01 minute {until.Minute.Inv()}");
        }
        return until.Date.AddDays(-1);
    }

    /// <summary>
    /// The <c>UNTIL</c> value text (without <c>UNTIL=</c>) that ends a rule after <paramref name="endDate"/>
    /// (§4.4, §4.7): all-day <c>yyyyMMdd</c>; floating 23:59:59 of the date, <c>yyyyMMddT235959</c>; zoned, the
    /// instant of 23:59:59 of the date in <paramref name="zone"/> as UTC <c>yyyyMMddTHHmmssZ</c>, capped at
    /// <c>99991231T235959Z</c>. Tallinn, 2026-11-09: <c>20261109T215959Z</c>. TS: <c>formatUntil</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for an empty or unknown zone (timed, zoned).</exception>
    public static string Format(GregorianDate endDate, bool allDay, string? zone, IZoneResolver zones)
    {
        if (allDay) return ICalText.FormatDate(endDate);
        var endOfDay = LocalDateTime.Unchecked(endDate, 1439);
        if (zone is null) return ICalText.FormatDateTime(endOfDay, 59, false);
        ZoneMath.AssertKnownZone(zone, zones);
        var utc = Math.Min(ZoneMath.ToUtcAbsolute(endOfDay.Absolute, zone, zones), LastUntilAbsolute);
        return ICalText.FormatDateTime(LocalDateTime.FromAbsolute(utc)!.Value, 59, true);
    }
}
