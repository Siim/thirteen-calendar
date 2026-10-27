using System.Security.Cryptography;
using System.Text;
using Thirteen.Core.Events;

namespace Thirteen.Core.Ics;

// The .ics reader (docs/EVENTS.md §5.4), mirroring packages/core/src/ics/parse.ts: calendar text to IcsCalendar.
//
// Tolerant: every line end, a byte order mark, folds, lowercase names, quoted parameters and several VCALENDARs
// in one text (merged) are accepted, and a component or property that cannot be read produces a warning while
// parsing continues. Nothing is lost: every VEVENT and VTIMEZONE keeps the exact text it was read from (Raw), a
// property the reader does not model or cannot read stays in Extra, and a component it skips (VTODO, a VEVENT
// without DTSTART, an exact duplicate) is kept in Others, so writing the calendar back gives the text that was
// read (with CRLF line ends).

/// <summary>A component as tokenized: its own properties, its children and the physical lines it spans.</summary>
internal sealed class RawComponent(string name, int first, int last)
{
    public string Name { get; } = name;

    public int First { get; } = first;

    public int Last { get; set; } = last;

    public bool Closed { get; set; }

    public List<SourceProperty> Props { get; } = [];

    public List<RawComponent> Children { get; } = [];
}

/// <summary>Collects warnings in reading order.</summary>
internal sealed class IcsWarnings
{
    public List<IcsWarning> List { get; } = [];

    public void Add(int line, IcsWarningCode code, string detail) => List.Add(new IcsWarning(line, code, detail));
}

/// <summary>A source property with the values of an <c>RDATE</c> or <c>EXDATE</c> line.</summary>
internal sealed record SourceRdates(SourceProperty Prop, IReadOnlyList<IcsRdate> Values);

/// <summary>The fields of a <c>VEVENT</c> and the source properties behind them (the writer reuses them for untouched fields).</summary>
internal sealed class ReadEvent
{
    /// <summary>The fields (Raw, Original and Line unset).</summary>
    public required IcsEvent Fields { get; init; }

    /// <summary>The source property of each single-valued field that was read.</summary>
    public required Dictionary<string, SourceProperty> Single { get; init; }

    /// <summary><c>DTEND;VALUE=DATE:10000101</c> read as an end of 9999-12-31 (§3.1.1).</summary>
    public SourceProperty? YearTenThousandEnd { get; init; }

    public required List<SourceProperty> RRules { get; init; }

    public required List<SourceProperty> ExRules { get; init; }

    public required List<SourceRdates> Rdates { get; init; }

    public required List<SourceRdates> Exdates { get; init; }

    /// <summary>Parallel to <c>Fields.Extra</c>.</summary>
    public required List<SourceProperty> Extra { get; init; }

    /// <summary>Parallel to <c>Fields.Alarms</c>: each alarm's text as read.</summary>
    public required List<string> AlarmSources { get; init; }
}

/// <summary>The .ics reader. TS: <c>parseICalendar</c> (and the internal helpers of parse.ts).</summary>
public static class IcsReader
{
    /// <summary>Components that live directly in a <c>VCALENDAR</c> and never inside another one.</summary>
    private static readonly HashSet<string> TopLevel = new(StringComparer.Ordinal) { "VEVENT", "VTODO", "VJOURNAL", "VFREEBUSY", "VTIMEZONE", "VAVAILABILITY" };

    /// <summary>Properties with one value per event; a repeated one is kept in <c>Extra</c>.</summary>
    private static readonly HashSet<string> SingleNames = new(StringComparer.Ordinal)
    {
        "UID", "RECURRENCE-ID", "SEQUENCE", "SUMMARY", "LOCATION", "DESCRIPTION", "URL", "DTSTART", "DTEND", "DURATION",
        "STATUS", "TRANSP", "X-THIRTEEN-RULE", "CREATED", "LAST-MODIFIED", "DTSTAMP", "X-THIRTEEN-IMPORTED-LAST-MODIFIED",
    };

    private static readonly HashSet<string> DateFields = new(StringComparer.Ordinal)
    {
        "RECURRENCE-ID", "CREATED", "LAST-MODIFIED", "DTSTAMP", "X-THIRTEEN-IMPORTED-LAST-MODIFIED",
    };

    /// <summary>The text <c>10000101</c> read as a date.</summary>
    private static readonly GregorianDate Year1000 = new(1000, 1, 1);

    private sealed record Tokenized(List<string> Lines, int Calendars, List<SourceProperty> CalendarProps, List<RawComponent> Components);

    private static SourceProperty MakeSource(IReadOnlyList<string> lines, int first, int last, IcsProperty parsed) =>
        new(parsed, string.Join(IcsLexer.Crlf, Slice(lines, first, last)), first + 1);

    private static IEnumerable<string> Slice(IReadOnlyList<string> lines, int first, int last)
    {
        for (var i = first; i <= last && i < lines.Count; i++) yield return lines[i];
    }

    /// <summary>
    /// Splits a text into <c>VCALENDAR</c> properties and top-level components. A component that is still open when
    /// another top-level component, an <c>END:VCALENDAR</c> or the end of the text arrives is closed as unclosed.
    /// </summary>
    private static Tokenized Tokenize(string text, IcsWarnings warnings)
    {
        var lines = IcsLexer.PhysicalLines(text);
        var calendarProps = new List<SourceProperty>();
        var components = new List<RawComponent>();
        var stack = new List<RawComponent>();
        var inCalendar = false;
        var calendars = 0;

        void CloseUnclosed(int last)
        {
            foreach (var component in stack)
            {
                component.Last = Math.Max(component.First, last);
                warnings.Add(component.First + 1, IcsWarningCode.UnclosedComponent, $"BEGIN:{component.Name} has no END:{component.Name}");
            }
            stack.Clear();
        }

        foreach (var content in IcsLexer.Unfold(lines))
        {
            var line = content.First + 1;
            var parsed = IcsLexer.ParseContentLine(content.Text);
            if (parsed is null)
            {
                warnings.Add(line, IcsWarningCode.BadLine, $"Not a content line: {Ev.Show(JsSlice(content.Text, 60))}");
                continue;
            }
            if (parsed.Name is "BEGIN" or "END")
            {
                var name = IcsLexer.Upper(IcsLexer.JsTrim(parsed.Value));
                if (parsed.Name == "BEGIN")
                {
                    if (name == "VCALENDAR")
                    {
                        CloseUnclosed(content.First - 1);
                        inCalendar = true;
                        calendars++;
                        continue;
                    }
                    if (!inCalendar)
                    {
                        warnings.Add(line, IcsWarningCode.BadLine, $"BEGIN:{name} outside a VCALENDAR");
                        continue;
                    }
                    if (stack.Count > 0 && TopLevel.Contains(name)) CloseUnclosed(content.First - 1);
                    var component = new RawComponent(name, content.First, content.Last);
                    if (stack.Count > 0) stack[^1].Children.Add(component);
                    else components.Add(component);
                    stack.Add(component);
                    continue;
                }
                if (name == "VCALENDAR")
                {
                    CloseUnclosed(content.First - 1);
                    inCalendar = false;
                    continue;
                }
                var index = stack.Count - 1;
                while (index >= 0 && stack[index].Name != name) index--;
                if (index < 0)
                {
                    warnings.Add(line, IcsWarningCode.BadLine, $"END:{name} without BEGIN:{name}");
                    continue;
                }
                while (stack.Count > index + 1)
                {
                    var inner = stack[^1];
                    stack.RemoveAt(stack.Count - 1);
                    inner.Last = content.First - 1;
                    warnings.Add(inner.First + 1, IcsWarningCode.UnclosedComponent, $"BEGIN:{inner.Name} has no END:{inner.Name}");
                }
                var closed = stack[^1];
                stack.RemoveAt(stack.Count - 1);
                closed.Last = content.Last;
                closed.Closed = true;
                continue;
            }
            if (!inCalendar)
            {
                warnings.Add(line, IcsWarningCode.BadLine, $"{parsed.Name} outside a VCALENDAR");
                continue;
            }
            var property = MakeSource(lines, content.First, content.Last, parsed);
            if (stack.Count > 0) stack[^1].Props.Add(property);
            else if (calendars == 1) calendarProps.Add(property);
        }
        CloseUnclosed(lines.Count - 1);
        return new Tokenized(lines, calendars, calendarProps, components);
    }

    /// <summary>The first <paramref name="length"/> UTF-16 code units (JavaScript <c>slice(0, n)</c>).</summary>
    private static string JsSlice(string text, int length) => text.Length <= length ? text : text[..length];

    /// <summary>The physical text of a component, CRLF line ends, with a final CRLF.</summary>
    private static string ComponentText(IReadOnlyList<string> lines, RawComponent component) =>
        string.Join(IcsLexer.Crlf, Slice(lines, component.First, component.Last)) + IcsLexer.Crlf;

    /// <summary>The unfolded content of a component, for finding exact duplicates.</summary>
    private static string ComponentContent(IReadOnlyList<string> lines, RawComponent component) =>
        string.Join("\n", IcsLexer.Unfold(lines, component.First, component.Last).Select(c => c.Text));

    /// <summary>The unfolded text of a source property.</summary>
    internal static string UnfoldedSource(SourceProperty property)
    {
        var parts = property.Source.Split(IcsLexer.Crlf);
        var builder = new StringBuilder(parts[0]);
        for (var i = 1; i < parts.Length; i++) builder.Append(parts[i].Length > 0 ? parts[i][1..] : "");
        return builder.ToString();
    }

    private static IcsProperty Plain(SourceProperty p) => p.Property;

    // ---- VEVENT ----------------------------------------------------------------------------------

    /// <summary>Reads the values of an <c>RDATE</c> (dates, date-times or <c>VALUE=PERIOD</c>); null when one does not parse.</summary>
    private static List<IcsRdate>? ReadRdates(SourceProperty prop)
    {
        var isPeriod = IcsLexer.ParamValue(prop.Params, "VALUE") is { } v && IcsLexer.Upper(v) == "PERIOD";
        var output = new List<IcsRdate>();
        foreach (var part in prop.Value.Split(','))
        {
            if (isPeriod)
            {
                var slash = part.IndexOf('/', StringComparison.Ordinal);
                if (slash < 0) return null;
                var value = IcsValues.ReadDateValue(part[..slash], prop.Params);
                var period = IcsLexer.JsTrim(part[(slash + 1)..]);
                if (value is null || value is IcsDateValue.DateValue || period.Length == 0) return null;
                if (IcsValues.ReadDateValue(period, prop.Params) is null && IcsValues.ParseDuration(period) is null) return null;
                output.Add(new IcsRdate(value, period));
            }
            else
            {
                var value = IcsValues.ReadDateValue(part, prop.Params);
                if (value is null) return null;
                output.Add(new IcsRdate(value, null));
            }
        }
        return output;
    }

    private static List<IcsRdate>? ReadExdates(SourceProperty prop)
    {
        var output = new List<IcsRdate>();
        foreach (var part in prop.Value.Split(','))
        {
            var value = IcsValues.ReadDateValue(part, prop.Params);
            if (value is null) return null;
            output.Add(new IcsRdate(value, null));
        }
        return output;
    }

    private static IcsTrigger? ReadTrigger(SourceProperty prop)
    {
        if (IcsLexer.ParamValue(prop.Params, "VALUE") is { } v && IcsLexer.Upper(v) == "DATE-TIME")
        {
            var value = IcsValues.ReadDateValue(prop.Value, prop.Params);
            return value is null or IcsDateValue.DateValue ? null : new IcsTrigger.Absolute(value);
        }
        var duration = IcsValues.ParseDuration(prop.Value);
        if (duration is not { } d) return null;
        var related = IcsLexer.ParamValue(prop.Params, "RELATED") is { } r && IcsLexer.Upper(r) == "END" ? IcsTriggerRelation.End : IcsTriggerRelation.Start;
        return new IcsTrigger.Relative(IcsValues.DurationMinutes(d), related);
    }

    private static (IcsAlarm Alarm, string Source)? ReadAlarm(RawComponent component, IReadOnlyList<string> lines, IcsWarnings warnings)
    {
        string? action = null;
        IcsTrigger? trigger = null;
        var extra = new List<IcsProperty>();
        foreach (var prop in component.Props)
        {
            if (prop.Name == "ACTION" && action is null)
            {
                action = IcsLexer.Upper(IcsLexer.JsTrim(prop.Value));
            }
            else if (prop.Name == "TRIGGER" && trigger is null)
            {
                trigger = ReadTrigger(prop);
                if (trigger is null) warnings.Add(prop.Line, IcsWarningCode.BadLine, $"Unreadable TRIGGER {Ev.Show(prop.Value)}");
            }
            else
            {
                extra.Add(Plain(prop));
            }
        }
        if (trigger is null)
        {
            warnings.Add(component.First + 1, IcsWarningCode.SkippedComponent, "VALARM without a readable TRIGGER");
            return null;
        }
        return (new IcsAlarm(action ?? "", trigger, extra), ComponentText(lines, component));
    }

    /// <summary>The derived UID of a component without one (§2.17): <c>missing-</c> and 32 hex digits of SHA-256.</summary>
    internal static string DerivedUid(string calendarId, string dtstartLine, string summary)
    {
        var bytes = Encoding.UTF8.GetBytes($"{calendarId}\n{dtstartLine}\n{summary}");
        return "missing-" + Convert.ToHexStringLower(SHA256.HashData(bytes))[..32];
    }

    /// <summary>Reads one <c>VEVENT</c>. Returns null (with a warning) when it has no readable <c>DTSTART</c>; such a component is kept in <c>Others</c> by the caller.</summary>
    internal static ReadEvent? ReadEventComponent(RawComponent component, IReadOnlyList<string> lines, string calendarId, IcsWarnings warnings)
    {
        var single = new Dictionary<string, SourceProperty>(StringComparer.Ordinal);
        var extra = new List<SourceProperty>();
        var rrules = new List<SourceProperty>();
        var exrules = new List<SourceProperty>();
        var rdates = new List<SourceRdates>();
        var exdates = new List<SourceRdates>();
        var parsedRules = new List<RRule>();
        var parsedExrules = new List<RRule>();
        var dates = new Dictionary<string, IcsDateValue>(StringComparer.Ordinal);
        IcsDateValue? start = null;
        var startBad = false;
        IcsDateValue? end = null;
        SourceProperty? yearTenThousandEnd = null;
        string? duration = null;
        var sequence = 0;

        foreach (var prop in component.Props)
        {
            var name = prop.Name;
            if (SingleNames.Contains(name))
            {
                if (single.ContainsKey(name) || (name == "DTEND" && yearTenThousandEnd is not null))
                {
                    extra.Add(prop);
                    continue;
                }
                switch (name)
                {
                    case "DTSTART":
                        start = IcsValues.ReadDateValue(prop.Value, prop.Params);
                        if (start is null)
                        {
                            startBad = true;
                            warnings.Add(prop.Line, IcsWarningCode.BadDate, $"Unreadable DTSTART {Ev.Show(prop.Value)}");
                            extra.Add(prop);
                            continue;
                        }
                        break;
                    case "DTEND":
                    {
                        var valueType = IcsLexer.ParamValue(prop.Params, "VALUE") is { } v ? IcsLexer.Upper(v) : "DATE";
                        if (IcsLexer.JsTrim(prop.Value) == "10000101" && valueType == "DATE")
                        {
                            yearTenThousandEnd = prop;
                            continue;
                        }
                        end = IcsValues.ReadDateValue(prop.Value, prop.Params);
                        if (end is null)
                        {
                            warnings.Add(prop.Line, IcsWarningCode.BadDate, $"Unreadable DTEND {Ev.Show(prop.Value)}");
                            extra.Add(prop);
                            continue;
                        }
                        break;
                    }
                    case "DURATION":
                        if (IcsValues.ParseDuration(prop.Value) is null)
                        {
                            warnings.Add(prop.Line, IcsWarningCode.BadLine, $"Unreadable DURATION {Ev.Show(prop.Value)}");
                            extra.Add(prop);
                            continue;
                        }
                        duration = IcsLexer.JsTrim(prop.Value);
                        break;
                    case "SEQUENCE":
                    {
                        var trimmed = IcsLexer.JsTrim(prop.Value);
                        if (trimmed.Length is < 1 or > 9 || !trimmed.All(Ev.IsAsciiDigit))
                        {
                            warnings.Add(prop.Line, IcsWarningCode.BadLine, $"Unreadable SEQUENCE {Ev.Show(prop.Value)}");
                            extra.Add(prop);
                            continue;
                        }
                        sequence = int.Parse(trimmed, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture);
                        break;
                    }
                    case "X-THIRTEEN-RULE":
                    {
                        var version = IcsLexer.ParamValue(prop.Params, "VERSION");
                        if (version is not null && version != "1")
                        {
                            extra.Add(prop);
                            continue;
                        }
                        break;
                    }
                    default:
                        if (DateFields.Contains(name))
                        {
                            var value = IcsValues.ReadDateValue(prop.Value, prop.Params);
                            if (value is null)
                            {
                                warnings.Add(prop.Line, IcsWarningCode.BadDate, $"Unreadable {name} {Ev.Show(prop.Value)}");
                                extra.Add(prop);
                                continue;
                            }
                            dates[name] = value;
                        }
                        break;
                }
                single[name] = prop;
                continue;
            }
            if (name is "RRULE" or "EXRULE")
            {
                try
                {
                    var rule = RRule.Parse(IcsLexer.JsTrim(prop.Value));
                    (name == "RRULE" ? parsedRules : parsedExrules).Add(rule);
                    (name == "RRULE" ? rrules : exrules).Add(prop);
                }
                catch (ThirteenException error)
                {
                    warnings.Add(prop.Line, IcsWarningCode.BadRRule, error.Message);
                    extra.Add(prop);
                }
                continue;
            }
            if (name == "RDATE")
            {
                var values = ReadRdates(prop);
                if (values is null)
                {
                    warnings.Add(prop.Line, IcsWarningCode.BadDate, $"Unreadable RDATE {Ev.Show(prop.Value)}");
                    extra.Add(prop);
                }
                else
                {
                    rdates.Add(new SourceRdates(prop, values));
                }
                continue;
            }
            if (name == "EXDATE")
            {
                var values = ReadExdates(prop);
                if (values is null)
                {
                    warnings.Add(prop.Line, IcsWarningCode.BadDate, $"Unreadable EXDATE {Ev.Show(prop.Value)}");
                    extra.Add(prop);
                }
                else
                {
                    exdates.Add(new SourceRdates(prop, values));
                }
                continue;
            }
            extra.Add(prop);
        }

        if (start is null)
        {
            if (!startBad) warnings.Add(component.First + 1, IcsWarningCode.MissingDtstart, "VEVENT without DTSTART");
            return null;
        }
        if (yearTenThousandEnd is not null)
        {
            if (start is IcsDateValue.DateValue startDate && startDate.Date > Year1000)
            {
                // DTEND;VALUE=DATE:10000101 after a start in year 1000 or later ends the event with 9999-12-31
                // (§3.1.1): the same event as DURATION:P{n}D. As January 1 of year 1000 it would end before it began.
                if (duration is not null)
                {
                    var durationProp = single["DURATION"];
                    warnings.Add(durationProp.Line, IcsWarningCode.BadLine, "DURATION next to DTEND is ignored");
                    single.Remove("DURATION");
                    extra.Add(durationProp);
                }
                var days = (long)GregorianDate.MaxJulianDayNumber - startDate.Date.JulianDayNumber + 1;
                duration = $"P{days.Inv()}D";
            }
            else
            {
                end = new IcsDateValue.DateValue(Year1000);
                single["DTEND"] = yearTenThousandEnd;
                yearTenThousandEnd = null;
            }
        }
        if (end is not null && duration is not null && yearTenThousandEnd is null)
        {
            var durationProp = single["DURATION"];
            warnings.Add(durationProp.Line, IcsWarningCode.BadLine, "DURATION next to DTEND is ignored");
            single.Remove("DURATION");
            extra.Add(durationProp);
            duration = null;
        }

        string Text(string key) => single.TryGetValue(key, out var p) ? IcsLexer.UnescapeText(p.Value) : "";
        string? Upper(string key) => single.TryGetValue(key, out var p) ? IcsLexer.Upper(IcsLexer.JsTrim(p.Value)) : null;
        var uid = single.TryGetValue("UID", out var uidProp) ? IcsLexer.UnescapeText(uidProp.Value) : null;
        var uidDerived = false;
        if (string.IsNullOrEmpty(uid))
        {
            uid = DerivedUid(calendarId, UnfoldedSource(single["DTSTART"]), Text("SUMMARY"));
            uidDerived = true;
            warnings.Add(component.First + 1, IcsWarningCode.MissingUid, $"VEVENT without UID; derived {uid}");
        }

        var alarms = new List<IcsAlarm>();
        var alarmSources = new List<string>();
        foreach (var child in component.Children)
        {
            if (child.Name != "VALARM")
            {
                warnings.Add(child.First + 1, IcsWarningCode.SkippedComponent, $"{child.Name} inside a VEVENT is not read");
                continue;
            }
            var read = ReadAlarm(child, lines, warnings);
            if (read is { } r)
            {
                alarms.Add(r.Alarm);
                alarmSources.Add(r.Source);
            }
        }

        return new ReadEvent
        {
            Fields = new IcsEvent
            {
                Uid = uid,
                UidDerived = uidDerived,
                RecurrenceId = dates.GetValueOrDefault("RECURRENCE-ID"),
                Sequence = sequence,
                Summary = Text("SUMMARY"),
                Location = Text("LOCATION"),
                Description = Text("DESCRIPTION"),
                Url = single.TryGetValue("URL", out var url) ? IcsLexer.JsTrim(url.Value) : "",
                Start = start,
                End = end,
                Duration = duration,
                RRules = parsedRules,
                ExRules = parsedExrules,
                Rdates = rdates.SelectMany(r => r.Values).ToValueList(),
                Exdates = exdates.SelectMany(r => r.Values.Select(v => v.Value)).ToValueList(),
                Status = Upper("STATUS"),
                Transp = Upper("TRANSP"),
                ThirteenRule = single.TryGetValue("X-THIRTEEN-RULE", out var marker) ? IcsLexer.JsTrim(marker.Value) : null,
                Alarms = alarms,
                Created = dates.GetValueOrDefault("CREATED"),
                LastModified = dates.GetValueOrDefault("LAST-MODIFIED"),
                Dtstamp = dates.GetValueOrDefault("DTSTAMP"),
                ImportedLastModified = dates.GetValueOrDefault("X-THIRTEEN-IMPORTED-LAST-MODIFIED"),
                Extra = extra.Select(Plain).ToValueList(),
            },
            Single = single,
            YearTenThousandEnd = yearTenThousandEnd,
            RRules = rrules,
            ExRules = exrules,
            Rdates = rdates,
            Exdates = exdates,
            Extra = extra,
            AlarmSources = alarmSources,
        };
    }

    /// <summary>Reads a single <c>VEVENT</c> text (as kept in Raw or Original) back into fields and source properties; null when it is not a readable <c>VEVENT</c>.</summary>
    internal static ReadEvent? ReadEventText(string text, string calendarId = "")
    {
        var warnings = new IcsWarnings();
        var lines = IcsLexer.PhysicalLines(text);
        var stack = new List<RawComponent>();
        RawComponent? root = null;
        foreach (var content in IcsLexer.Unfold(lines))
        {
            var parsed = IcsLexer.ParseContentLine(content.Text);
            if (parsed is null) continue;
            if (parsed.Name == "BEGIN")
            {
                var component = new RawComponent(IcsLexer.Upper(IcsLexer.JsTrim(parsed.Value)), content.First, content.Last);
                if (stack.Count > 0) stack[^1].Children.Add(component);
                else root ??= component;
                stack.Add(component);
            }
            else if (parsed.Name == "END")
            {
                if (stack.Count > 0)
                {
                    var component = stack[^1];
                    stack.RemoveAt(stack.Count - 1);
                    component.Last = content.Last;
                    component.Closed = true;
                }
            }
            else if (stack.Count > 0)
            {
                stack[^1].Props.Add(MakeSource(lines, content.First, content.Last, parsed));
            }
        }
        if (root is null || root.Name != "VEVENT") return null;
        return ReadEventComponent(root, lines, calendarId, warnings);
    }

    // ---- VTIMEZONE -------------------------------------------------------------------------------

    private static IcsObservance? ReadObservance(RawComponent component, IcsWarnings warnings)
    {
        LocalDateTime? start = null;
        int? offsetFrom = null;
        int? offsetTo = null;
        var rrules = new List<RRule>();
        var rdates = new List<LocalDateTime>();
        var names = new List<string>();
        foreach (var prop in component.Props)
        {
            switch (prop.Name)
            {
                case "DTSTART":
                {
                    var value = IcsValues.ReadDateValue(prop.Value, prop.Params);
                    if (value is not null) start = IcsValues.WallClock(value);
                    break;
                }
                case "TZOFFSETFROM":
                    offsetFrom = IcsValues.ParseUtcOffset(prop.Value);
                    break;
                case "TZOFFSETTO":
                    offsetTo = IcsValues.ParseUtcOffset(prop.Value);
                    break;
                case "RRULE":
                    try
                    {
                        rrules.Add(RRule.Parse(IcsLexer.JsTrim(prop.Value)));
                    }
                    catch (ThirteenException error)
                    {
                        warnings.Add(prop.Line, IcsWarningCode.BadRRule, error.Message);
                    }
                    break;
                case "RDATE":
                    foreach (var part in prop.Value.Split(','))
                    {
                        var slash = part.IndexOf('/', StringComparison.Ordinal);
                        var value = IcsValues.ReadDateValue(slash < 0 ? part : part[..slash], prop.Params);
                        if (value is not null) rdates.Add(IcsValues.WallClock(value));
                    }
                    break;
                case "TZNAME":
                    names.Add(IcsLexer.UnescapeText(prop.Value));
                    break;
            }
        }
        if (start is null || offsetFrom is null || offsetTo is null)
        {
            warnings.Add(component.First + 1, IcsWarningCode.SkippedComponent, $"{component.Name} without a readable DTSTART, TZOFFSETFROM and TZOFFSETTO");
            return null;
        }
        return new IcsObservance(
            component.Name == "DAYLIGHT" ? IcsObservanceKind.Daylight : IcsObservanceKind.Standard,
            start.Value,
            offsetFrom.Value,
            offsetTo.Value,
            rrules,
            rdates,
            names);
    }

    /// <summary><c>X-THIRTEEN-GENERATED</c>'s <c>{first}-{last}</c> (1 to 4 digits each, surrounding whitespace allowed), or null.</summary>
    private static IcsYearRange? GeneratedRange(string value)
    {
        var s = IcsLexer.JsTrim(value);
        var dash = s.IndexOf('-', StringComparison.Ordinal);
        if (dash < 1) return null;
        var a = s[..dash];
        var b = s[(dash + 1)..];
        if (a.Length > 4 || b.Length is < 1 or > 4 || !a.All(Ev.IsAsciiDigit) || !b.All(Ev.IsAsciiDigit)) return null;
        return new IcsYearRange(int.Parse(a, System.Globalization.CultureInfo.InvariantCulture), int.Parse(b, System.Globalization.CultureInfo.InvariantCulture));
    }

    /// <summary>Reads a <c>VTIMEZONE</c>; null (with a warning) when it has no <c>TZID</c>.</summary>
    private static IcsTimeZone? ReadTimeZone(RawComponent component, IReadOnlyList<string> lines, IcsWarnings warnings)
    {
        var tzidProp = component.Props.FirstOrDefault(p => p.Name == "TZID");
        if (tzidProp is null || IcsLexer.JsTrim(IcsLexer.UnescapeText(tzidProp.Value)).Length == 0)
        {
            warnings.Add(component.First + 1, IcsWarningCode.SkippedComponent, "VTIMEZONE without TZID");
            return null;
        }
        var generatedProp = component.Props.FirstOrDefault(p => p.Name == "X-THIRTEEN-GENERATED");
        var observances = new List<IcsObservance>();
        foreach (var child in component.Children)
        {
            if (child.Name is not ("STANDARD" or "DAYLIGHT")) continue;
            var observance = ReadObservance(child, warnings);
            if (observance is not null) observances.Add(observance);
        }
        return new IcsTimeZone(
            IcsLexer.JsTrim(IcsLexer.UnescapeText(tzidProp.Value)),
            observances,
            ComponentText(lines, component),
            generatedProp is null ? null : GeneratedRange(generatedProp.Value),
            component.First + 1);
    }

    // ---- The calendar ----------------------------------------------------------------------------

    /// <summary>The key of an event inside its UID group: the master, or its <c>RECURRENCE-ID</c>.</summary>
    internal static string MemberKey(IcsEvent e) => e.RecurrenceId is null ? "master" : IcsValues.DateValueKey(e.RecurrenceId);

    /// <summary>Calendar fields from its properties (§5.4): name, color and refresh interval.</summary>
    internal static (string? Name, string? Color, string? RefreshInterval) CalendarFields(IReadOnlyList<IcsProperty> props)
    {
        IcsProperty? First(string name) => props.FirstOrDefault(p => p.Name == name);
        var nameProp = First("X-WR-CALNAME") ?? First("NAME");
        var appleColor = First("X-APPLE-CALENDAR-COLOR");
        var cssColor = First("COLOR");
        var refresh = First("REFRESH-INTERVAL") ?? First("X-PUBLISHED-TTL");
        var color = (appleColor is null ? null : IcsColors.NormalizeHexColor(appleColor.Value))
            ?? (cssColor is null ? null : IcsColors.CssColorHex(cssColor.Value));
        return (
            nameProp is null ? null : IcsLexer.UnescapeText(nameProp.Value),
            color,
            refresh is null ? null : IcsLexer.JsTrim(refresh.Value));
    }

    /// <summary>Every <c>TZID</c> the events use, with the line of its first use, in order of first use.</summary>
    internal static List<(string Tzid, int Line)> UsedTzids(IEnumerable<IcsGroup> groups)
    {
        var used = new List<(string, int)>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        void Note(IcsDateValue? value, int? line)
        {
            if (value is IcsDateValue.ZonedValue z && seen.Add(z.Tzid)) used.Add((z.Tzid, line ?? 0));
        }
        foreach (var group in groups)
        {
            foreach (var e in group.Members)
            {
                Note(e.Start, e.Line);
                Note(e.End, e.Line);
                Note(e.RecurrenceId, e.Line);
                foreach (var r in e.Rdates) Note(r.Value, e.Line);
                foreach (var x in e.Exdates) Note(x, e.Line);
            }
        }
        return used;
    }

    private sealed class GroupBuilder(string uid, IcsEvent? master)
    {
        public string Uid { get; } = uid;

        public IcsEvent? Master { get; set; } = master;

        public List<IcsEvent> Overrides { get; } = [];
    }

    /// <summary>
    /// Reads an iCalendar text (§5.4). <paramref name="calendarId"/> seeds the derived UIDs of components without
    /// one (<c>missing-</c> and the first 32 hex digits of the SHA-256 of
    /// <c>{calendarId}\n{DTSTART line as read, unfolded}\n{SUMMARY text}</c>, §2.17). With <paramref name="zones"/>,
    /// a <c>TZID</c> that resolves to nothing (§5.4 order) gets an <c>unknown-tzid</c> warning.
    /// <para>
    /// UID groups: the first master of a UID and every override of it form one group; a second master starts
    /// another group with the same UID, and a second override of one <c>RECURRENCE-ID</c> stays in the group (both
    /// with a <c>duplicate-uid</c> warning; <see cref="IcsExpansion.EventsFromCalendar"/> gives their keys <c>#2</c>,
    /// <c>#3</c>). A component that repeats an earlier one of its UID exactly is kept in <c>Others</c>, not in a
    /// group. TS: <c>parseICalendar</c>.
    /// </para>
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidIcs"/> only when the text has no <c>VCALENDAR</c> at all.</exception>
    public static IcsCalendar Parse(string text, string calendarId = "", IZoneResolver? zones = null)
    {
        ArgumentNullException.ThrowIfNull(text);
        ArgumentNullException.ThrowIfNull(calendarId);
        var warnings = new IcsWarnings();
        var tokens = Tokenize(text, warnings);
        if (tokens.Calendars == 0) throw ThirteenException.InvalidIcs("This text has no VCALENDAR");
        var lines = tokens.Lines;

        var timeZones = new List<IcsTimeZone>();
        var others = new List<IcsOtherComponent>();
        var builders = new List<GroupBuilder>();
        var byUid = new Dictionary<string, List<int>>(StringComparer.Ordinal);
        var contents = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

        void Other(RawComponent component) => others.Add(new IcsOtherComponent(component.Name, ComponentText(lines, component), component.First + 1));

        foreach (var component in tokens.Components)
        {
            if (!component.Closed)
            {
                Other(component);
                continue;
            }
            if (component.Name == "VTIMEZONE")
            {
                var zone = ReadTimeZone(component, lines, warnings);
                if (zone is null) Other(component);
                else timeZones.Add(zone);
                continue;
            }
            if (component.Name != "VEVENT")
            {
                warnings.Add(component.First + 1, IcsWarningCode.SkippedComponent, $"{component.Name} is not read");
                Other(component);
                continue;
            }
            var read = ReadEventComponent(component, lines, calendarId, warnings);
            if (read is null)
            {
                Other(component);
                continue;
            }
            var raw = ComponentText(lines, component);
            var e = read.Fields with { Raw = raw, Original = raw, Line = component.First + 1 };
            var content = ComponentContent(lines, component);
            if (!contents.TryGetValue(e.Uid, out var seen)) contents[e.Uid] = seen = new HashSet<string>(StringComparer.Ordinal);
            if (seen.Contains(content))
            {
                warnings.Add(e.Line!.Value, IcsWarningCode.DuplicateUid, $"An exact copy of an earlier component of UID {e.Uid} is kept as read but not shown");
                Other(component);
                continue;
            }
            seen.Add(content);
            if (!byUid.TryGetValue(e.Uid, out var indexes)) byUid[e.Uid] = indexes = [];
            if (e.RecurrenceId is null)
            {
                var open = indexes.Select(i => builders[i]).FirstOrDefault(b => b.Master is null);
                if (open is not null)
                {
                    open.Master = e;
                }
                else
                {
                    if (indexes.Count > 0) warnings.Add(e.Line!.Value, IcsWarningCode.DuplicateUid, $"A second master of UID {e.Uid}");
                    indexes.Add(builders.Count);
                    builders.Add(new GroupBuilder(e.Uid, e));
                }
            }
            else
            {
                if (indexes.Count == 0)
                {
                    indexes.Add(builders.Count);
                    builders.Add(new GroupBuilder(e.Uid, null));
                }
                var group = builders[indexes[0]];
                var key = MemberKey(e);
                if (group.Overrides.Any(o => MemberKey(o) == key))
                {
                    warnings.Add(e.Line!.Value, IcsWarningCode.DuplicateUid, $"A second override of UID {e.Uid} for the same RECURRENCE-ID");
                }
                group.Overrides.Add(e);
            }
        }

        var groups = builders.Select(b => new IcsGroup(b.Uid, b.Master, b.Overrides)).ToValueList();
        var extra = tokens.CalendarProps.Select(Plain).ToValueList();
        var fields = CalendarFields(extra);
        var calendar = new IcsCalendar
        {
            Name = fields.Name,
            Color = fields.Color,
            RefreshInterval = fields.RefreshInterval,
            Groups = groups,
            TimeZones = timeZones,
            Extra = extra,
            Others = others,
            Raw = string.Concat(tokens.CalendarProps.Select(p => p.Source + IcsLexer.Crlf)),
        };

        if (zones is not null)
        {
            foreach (var (tzid, line) in UsedTzids(groups))
            {
                if (IcsZones.Resolve(tzid, calendar, zones).Kind == ZoneHandleKind.Floating)
                {
                    warnings.Add(line, IcsWarningCode.UnknownTzid, $"TZID {Ev.Show(tzid)} is not a known zone and has no usable VTIMEZONE; its times are read as floating");
                }
            }
        }
        var sorted = warnings.List.Select((w, i) => (w, i)).OrderBy(x => x.w.Line).ThenBy(x => x.i).Select(x => x.w).ToValueList();
        return calendar with { Warnings = sorted };
    }
}
