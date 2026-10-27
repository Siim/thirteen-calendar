using System.Text;
using Thirteen.Core.Events;

namespace Thirteen.Core.Ics;

// The .ics writer (docs/EVENTS.md §3.6, §5.4), mirroring packages/core/src/ics/serialize.ts: IcsCalendar to text.
//
// - Components with Raw text (every VEVENT and VTIMEZONE as read, and Others) are written exactly as read, in
//   the order they were read.
// - An edited event (no Raw) is serialized: CRLF, lines folded at 75 octets, the property order of §3.6, and
//   every property of a field the edit did not change written as read (from its Original text: seconds, TZID
//   strings, PERIOD values, parameters, folding). A rule whose only change is its end keeps its text and gets a
//   new COUNT= or UNTIL= part in place (§4.9 rule 4); EXDATEs and RDATEs added to those read are written as new
//   lines after the lines as read.
// - VTIMEZONEs: one per TZID the events use. A definition no event uses is dropped; a missing one is generated
//   with BuildVTimeZone when the platform knows the zone (an IANA id or a Windows id); a generated one
//   (X-THIRTEEN-GENERATED) is rebuilt when the years used reach outside its years. Definitions from other files
//   are never rebuilt.

/// <summary>Collects output, reusing source properties as read where they are unchanged.</summary>
internal sealed class IcsTextWriter
{
    private readonly StringBuilder _text = new();
    private readonly HashSet<SourceProperty> _used = new(ReferenceEqualityComparer.Instance);

    public void Line(string text) => _text.Append(text).Append(IcsLexer.Crlf);

    public void Property(IcsProperty property) => _text.Append(IcsLexer.FoldLine(IcsLexer.ContentLineText(property))).Append(IcsLexer.Crlf);

    public void Chunk(string text) => _text.Append(text);

    /// <summary>Writes a source property as read; false when it was already written (or is null).</summary>
    public bool Source(SourceProperty? source)
    {
        if (source is null || !_used.Add(source)) return false;
        _text.Append(source.Source).Append(IcsLexer.Crlf);
        return true;
    }

    /// <summary>Writes <paramref name="property"/> as read when an unused source property is the same, else serialized.</summary>
    public void ReuseOrWrite(IcsProperty property, IReadOnlyList<SourceProperty> sources)
    {
        var source = sources.FirstOrDefault(s => !_used.Contains(s) && SameProperty(s.Property, property));
        if (!Source(source)) Property(property);
    }

    private static bool SameProperty(IcsProperty a, IcsProperty b) => a.Name == b.Name && a.Value == b.Value && a.Params.Equals(b.Params);

    public override string ToString() => _text.ToString();
}

/// <summary>The .ics writer. TS: <c>serializeICalendar</c>, <c>THIRTEEN_PRODID</c>.</summary>
public static class IcsWriter
{
    private const string Crlf = IcsLexer.Crlf;

    /// <summary>Thirteen's <c>PRODID</c> (§3.6). TS: <c>THIRTEEN_PRODID</c>.</summary>
    public const string ThirteenProdId = "-//Haugas Development OU//Thirteen 1.0//EN";

    private static IcsProperty Prop(string name, string value, IEnumerable<IcsParameter>? parameters = null) =>
        new(name, parameters?.ToValueList() ?? ValueList<IcsParameter>.Empty, value);

    private static IcsProperty DateProp(string name, IcsDateValue value) => Prop(name, IcsValues.DateValueText(value), IcsValues.DateValueParams(value));

    /// <summary><c>UNTIL</c> text with the seconds the canonical rule text writes (<c>59</c>, the end of the minute).</summary>
    private static string UntilText(RRuleUntil until) => until switch
    {
        RRuleUntil.DateUntil d => ICalText.FormatDate(d.Date),
        RRuleUntil.UtcUntil u => ICalText.FormatDateTime(u.Value, 59, true),
        RRuleUntil.FloatingUntil f => ICalText.FormatDateTime(f.Value, 59, false),
        _ => throw new InvalidOperationException("Unknown until"),
    };

    /// <summary>A rule without its end, for comparing the rest.</summary>
    private static RRule WithoutEnd(RRule rule) => rule with { Count = null, Until = null };

    /// <summary>
    /// The text of a stored rule with only its end changed (§4.9 rule 4): the <c>COUNT=</c> or <c>UNTIL=</c> part
    /// replaced in place, removed, or (when the rule had none) inserted after <c>FREQ=</c>. Every other part keeps
    /// its text and order. TS: <c>patchRuleEnd</c>.
    /// </summary>
    internal static string PatchRuleEnd(string text, RRule rule)
    {
        var parts = text.Split(';').ToList();
        var end = rule.Until is not null ? $"UNTIL={UntilText(rule.Until)}" : rule.Count is { } count ? $"COUNT={count.Inv()}" : null;
        static string Name(string part)
        {
            var name = part.Split('=')[0];
            if (name.Length >= 6 && Ev.AsciiUpper(name[..6]) == "RRULE:") name = name[6..];
            return IcsLexer.Upper(name);
        }
        var index = parts.FindIndex(p => Name(p) is "COUNT" or "UNTIL");
        if (index >= 0)
        {
            if (end is null) parts.RemoveAt(index);
            else parts[index] = end;
        }
        else if (end is not null)
        {
            var freq = parts.FindIndex(p => Name(p) == "FREQ");
            parts.Insert(freq + 1, end);
        }
        return string.Join(";", parts);
    }

    // ---- VEVENT ----------------------------------------------------------------------------------

    private static string RdateKey(IcsRdate r) => $"{IcsValues.DateValueKey(r.Value)}/{r.Period ?? ""}";

    /// <summary>New <c>RDATE</c> or <c>EXDATE</c> properties: consecutive values with the same parameters share one line.</summary>
    private static List<IcsProperty> DateListProps(string name, IEnumerable<IcsRdate> values)
    {
        var output = new List<IcsProperty>();
        List<IcsParameter>? parameters = null;
        var texts = new List<string>();
        void Flush()
        {
            if (parameters is not null) output.Add(Prop(name, string.Join(",", texts), parameters));
            parameters = null;
            texts = [];
        }
        foreach (var r in values)
        {
            List<IcsParameter> next;
            if (r.Period is not null)
            {
                next = [new IcsParameter("VALUE", "PERIOD")];
                next.AddRange(IcsValues.DateValueParams(r.Value).Where(p => p.Name != "VALUE"));
            }
            else
            {
                next = IcsValues.DateValueParams(r.Value);
            }
            var text = r.Period is not null ? $"{IcsValues.DateValueText(r.Value)}/{r.Period}" : IcsValues.DateValueText(r.Value);
            if (parameters is null || !parameters.SequenceEqual(next))
            {
                Flush();
                parameters = next;
            }
            texts.Add(text);
        }
        Flush();
        return output;
    }

    /// <summary>Writes a list property group: as read when unchanged, or the lines as read plus new lines for values added after them.</summary>
    private static void WriteDateLists(IcsTextWriter writer, string name, IReadOnlyList<IcsRdate> values, IReadOnlyList<SourceRdates>? read)
    {
        var readValues = read is null ? [] : read.SelectMany(r => r.Values).ToList();
        var keepRead = read is not null && readValues.Count <= values.Count && readValues.Select((r, i) => RdateKey(r) == RdateKey(values[i])).All(x => x);
        if (keepRead)
        {
            foreach (var r in read!) writer.Source(r.Prop);
            foreach (var p in DateListProps(name, values.Skip(readValues.Count))) writer.Property(p);
            return;
        }
        foreach (var p in DateListProps(name, values)) writer.Property(p);
    }

    /// <summary>Writes the <c>RRULE</c>s or <c>EXRULE</c>s: as read when unchanged; with only the end patched when only the end changed; else canonical.</summary>
    private static void WriteRules(IcsTextWriter writer, string name, IReadOnlyList<RRule> rules, IReadOnlyList<RRule> readRules, IReadOnlyList<SourceProperty> sources)
    {
        for (var i = 0; i < rules.Count; i++)
        {
            var rule = rules[i];
            var source = i < sources.Count ? sources[i] : null;
            var before = i < readRules.Count ? readRules[i] : null;
            if (source is not null && before is not null && WithoutEnd(before).Equals(WithoutEnd(rule)))
            {
                if (before.Equals(rule)) writer.Source(source);
                else writer.Property(Prop(name, PatchRuleEnd(source.Value, rule), source.Params));
                continue;
            }
            writer.Property(Prop(name, rule.ToString()));
        }
    }

    private static void WriteAlarm(IcsTextWriter writer, IcsAlarm alarm)
    {
        writer.Line("BEGIN:VALARM");
        writer.Property(Prop("ACTION", alarm.Action));
        switch (alarm.Trigger)
        {
            case IcsTrigger.Relative relative:
                writer.Property(Prop(
                    "TRIGGER",
                    IcsValues.FormatDurationMinutes(relative.Minutes),
                    relative.Related == IcsTriggerRelation.End ? [new IcsParameter("RELATED", "END")] : null));
                break;
            case IcsTrigger.Absolute absolute:
                var parameters = new List<IcsParameter> { new("VALUE", "DATE-TIME") };
                parameters.AddRange(IcsValues.DateValueParams(absolute.Value));
                writer.Property(Prop("TRIGGER", IcsValues.DateValueText(absolute.Value), parameters));
                break;
        }
        foreach (var p in alarm.Extra) writer.Property(p);
        writer.Line("END:VALARM");
    }

    /// <summary>
    /// Serializes one event (§3.6 property order): <c>UID</c>, <c>RECURRENCE-ID</c>, <c>DTSTAMP</c>, <c>CREATED</c>,
    /// <c>LAST-MODIFIED</c>, <c>SEQUENCE</c>, <c>SUMMARY</c>, <c>LOCATION</c>, <c>DESCRIPTION</c>, <c>URL</c>,
    /// <c>DTSTART</c>, <c>DTEND</c> or <c>DURATION</c>, <c>RRULE</c>s, <c>RDATE</c>s, <c>EXDATE</c>s, <c>EXRULE</c>s,
    /// <c>X-THIRTEEN-RULE</c>, <c>TRANSP</c>, <c>STATUS</c>, the other properties in their order, <c>VALARM</c>s,
    /// <c>X-THIRTEEN-IMPORTED-LAST-MODIFIED</c>. Properties of fields equal to the Original text's are written as read.
    /// </summary>
    internal static string SerializeEvent(IcsEvent e, LocalDateTime? now)
    {
        var read = e.Original is null ? null : IcsReader.ReadEventText(e.Original);
        var before = read?.Fields;
        var writer = new IcsTextWriter();
        SourceProperty? Single(string name) => read is not null && read.Single.TryGetValue(name, out var p) ? p : null;
        void Keep(string name, bool same, Func<IcsProperty> property)
        {
            if (!(same && writer.Source(Single(name)))) writer.Property(property());
        }
        void KeepDate(string name, IcsDateValue? value, IcsDateValue? old, bool hasOld)
        {
            if (value is not null) Keep(name, hasOld && IcsValues.SameDateValue(value, old), () => DateProp(name, value));
        }
        // A text field: written when not empty, and an empty property that was read stays as read (§4.9 rule 1).
        void KeepText(string name, string value, string? old)
        {
            if (value.Length > 0 || (old == "" && Single(name) is not null)) Keep(name, old == value, () => Prop(name, IcsLexer.EscapeText(value)));
        }
        var hasBefore = before is not null;

        writer.Line("BEGIN:VEVENT");
        Keep("UID", before is not null && before.Uid == e.Uid && !before.UidDerived, () => Prop("UID", IcsLexer.EscapeText(e.Uid)));
        KeepDate("RECURRENCE-ID", e.RecurrenceId, before?.RecurrenceId, hasBefore);
        KeepDate("DTSTAMP", e.Dtstamp ?? (now is { } n ? new IcsDateValue.UtcValue(n) : null), before?.Dtstamp, hasBefore);
        KeepDate("CREATED", e.Created, before?.Created, hasBefore);
        KeepDate("LAST-MODIFIED", e.LastModified, before?.LastModified, hasBefore);
        Keep("SEQUENCE", before is not null && before.Sequence == e.Sequence && Single("SEQUENCE") is not null, () => Prop("SEQUENCE", e.Sequence.Inv()));
        KeepText("SUMMARY", e.Summary, before?.Summary);
        KeepText("LOCATION", e.Location, before?.Location);
        KeepText("DESCRIPTION", e.Description, before?.Description);
        if (e.Url.Length > 0) Keep("URL", before?.Url == e.Url, () => Prop("URL", e.Url));
        KeepDate("DTSTART", e.Start, before?.Start, hasBefore);
        if (e.End is not null)
        {
            KeepDate("DTEND", e.End, before?.End, hasBefore);
        }
        else if (e.Duration is not null)
        {
            if (IcsValues.ParseDuration(e.Duration) is null) throw ThirteenException.InvalidIcs($"Invalid DURATION {Ev.Show(e.Duration)}");
            var same = before is not null && before.End is null && before.Duration == e.Duration;
            if (!(same && read!.YearTenThousandEnd is not null && writer.Source(read.YearTenThousandEnd)))
            {
                Keep("DURATION", same, () => Prop("DURATION", e.Duration));
            }
        }
        WriteRules(writer, "RRULE", e.RRules, before?.RRules ?? ValueList<RRule>.Empty, read?.RRules ?? []);
        WriteDateLists(writer, "RDATE", e.Rdates, read?.Rdates);
        WriteDateLists(writer, "EXDATE", e.Exdates.Select(x => new IcsRdate(x, null)).ToList(), read?.Exdates);
        WriteRules(writer, "EXRULE", e.ExRules, before?.ExRules ?? ValueList<RRule>.Empty, read?.ExRules ?? []);
        if (e.ThirteenRule is not null)
        {
            Keep("X-THIRTEEN-RULE", before?.ThirteenRule == e.ThirteenRule, () => Prop("X-THIRTEEN-RULE", e.ThirteenRule, [new IcsParameter("VERSION", "1")]));
        }
        if (e.Transp is not null) Keep("TRANSP", before?.Transp == e.Transp, () => Prop("TRANSP", e.Transp));
        if (e.Status is not null) Keep("STATUS", before?.Status == e.Status, () => Prop("STATUS", e.Status));
        foreach (var p in e.Extra) writer.ReuseOrWrite(p, read?.Extra ?? []);
        var unusedAlarms = before is null ? new List<int>() : Enumerable.Range(0, before.Alarms.Count).ToList();
        foreach (var alarm in e.Alarms)
        {
            var position = unusedAlarms.FindIndex(i => before!.Alarms[i].Equals(alarm));
            if (position < 0)
            {
                WriteAlarm(writer, alarm);
            }
            else
            {
                var index = unusedAlarms[position];
                unusedAlarms.RemoveAt(position);
                writer.Chunk(read!.AlarmSources[index]);
            }
        }
        KeepDate("X-THIRTEEN-IMPORTED-LAST-MODIFIED", e.ImportedLastModified, before?.ImportedLastModified, hasBefore);
        writer.Line("END:VEVENT");
        return writer.ToString();
    }

    // ---- VTIMEZONE -------------------------------------------------------------------------------

    /// <summary>A generated observance rule: <c>FREQ=YEARLY;BYMONTH=m;BYDAY=nWD[;UNTIL=...]</c>; any other rule canonically.</summary>
    private static string ObservanceRuleText(RRule rule)
    {
        var simple = rule.Freq == Frequency.Yearly
            && rule.Interval == 1
            && rule.Count is null
            && rule.ByMonth.Count == 1
            && rule.ByDay.Count == 1
            && rule.ByDay[0].Ordinal is not null
            && rule.BySecond.Count == 0 && rule.ByMinute.Count == 0 && rule.ByHour.Count == 0 && rule.ByMonthDay.Count == 0
            && rule.ByYearDay.Count == 0 && rule.ByWeekNo.Count == 0 && rule.BySetPos.Count == 0 && rule.Extensions.Count == 0
            && rule.Wkst is null
            && rule.Rscale is null
            && rule.Skip is null;
        if (!simple) return rule.ToString();
        var day = rule.ByDay[0];
        var until = rule.Until switch
        {
            null => "",
            RRuleUntil.DateUntil d => $";UNTIL={ICalText.FormatDate(d.Date)}",
            RRuleUntil.UtcUntil u => $";UNTIL={ICalText.FormatDateTime(u.Value, 0, true)}",
            RRuleUntil.FloatingUntil f => $";UNTIL={ICalText.FormatDateTime(f.Value, 0, false)}",
            _ => "",
        };
        return $"FREQ=YEARLY;BYMONTH={rule.ByMonth[0].Inv()};BYDAY={day.Ordinal!.Value.Inv()}{ICalText.WeekdayCode(day.Weekday)}{until}";
    }

    private static void WriteObservance(IcsTextWriter writer, IcsObservance observance)
    {
        var name = observance.Kind == IcsObservanceKind.Daylight ? "DAYLIGHT" : "STANDARD";
        writer.Line($"BEGIN:{name}");
        writer.Property(Prop("DTSTART", ICalText.FormatDateTime(observance.Start, 0, false)));
        writer.Property(Prop("TZOFFSETFROM", IcsValues.FormatUtcOffset(observance.OffsetFrom)));
        writer.Property(Prop("TZOFFSETTO", IcsValues.FormatUtcOffset(observance.OffsetTo)));
        foreach (var rule in observance.RRules) writer.Property(Prop("RRULE", ObservanceRuleText(rule)));
        if (observance.Rdates.Count > 0) writer.Property(Prop("RDATE", string.Join(",", observance.Rdates.Select(r => ICalText.FormatDateTime(r, 0, false)))));
        foreach (var n in observance.Names) writer.Property(Prop("TZNAME", IcsLexer.EscapeText(n)));
        writer.Line($"END:{name}");
    }

    /// <summary>A <c>VTIMEZONE</c> as text: its Raw text, or written from its observances (with <c>X-THIRTEEN-GENERATED</c> when generated).</summary>
    internal static string SerializeTimeZone(IcsTimeZone timeZone)
    {
        if (timeZone.Raw is not null) return timeZone.Raw.EndsWith(Crlf, StringComparison.Ordinal) ? timeZone.Raw : timeZone.Raw + Crlf;
        var writer = new IcsTextWriter();
        writer.Line("BEGIN:VTIMEZONE");
        writer.Property(Prop("TZID", IcsLexer.EscapeText(timeZone.Tzid)));
        if (timeZone.Generated is { } g) writer.Property(Prop("X-THIRTEEN-GENERATED", $"{g.First.Inv()}-{g.Last.Inv()}"));
        foreach (var observance in timeZone.Observances) WriteObservance(writer, observance);
        writer.Line("END:VTIMEZONE");
        return writer.ToString();
    }

    // ---- Years used (§5.4) -----------------------------------------------------------------------

    /// <summary>The year of a series' last occurrence: its end, or (open-ended) the later of its start year and the current year, plus one.</summary>
    private static int LastSeriesYear(IcsEvent e, int? currentYear)
    {
        var startDate = e.Start.DateOf;
        var startYear = startDate.Year;
        var last = startYear;
        foreach (var rule in e.RRules)
        {
            if (rule.Until is not null)
            {
                var untilYear = rule.Until switch
                {
                    RRuleUntil.DateUntil d => d.Date.Year,
                    RRuleUntil.UtcUntil u => u.Value.Date.Year,
                    RRuleUntil.FloatingUntil f => f.Value.Date.Year,
                    _ => startYear,
                };
                last = Math.Max(last, untilYear);
            }
            else if (rule.Count is { } count)
            {
                var recurrence = new EventRecurrence(RepeatRule.Of(WithoutEnd(rule)), RepeatEnd.AfterCount(count));
                var expansion = recurrence.Expand(startDate, new ExpansionWindow(startDate, new GregorianDate(9999, 12, 31)));
                if (expansion.Occurrences.Count > 0) last = Math.Max(last, expansion.Occurrences[^1].Date.Year);
            }
            else
            {
                last = Math.Max(last, Math.Max(startYear, currentYear ?? startYear) + 1);
            }
        }
        return Math.Min(last, 9999);
    }

    /// <summary>The range of years each <c>TZID</c> is used in (§5.4 "years used").</summary>
    private static Dictionary<string, (int Min, int Max)> YearsUsed(IcsCalendar calendar, int? currentYear)
    {
        var ranges = new Dictionary<string, (int Min, int Max)>(StringComparer.Ordinal);
        void Add(string tzid, int year)
        {
            ranges[tzid] = ranges.TryGetValue(tzid, out var range) ? (Math.Min(range.Min, year), Math.Max(range.Max, year)) : (year, year);
        }
        void Note(IcsDateValue? value)
        {
            if (value is IcsDateValue.ZonedValue z) Add(z.Tzid, z.Value.Date.Year);
        }
        foreach (var group in calendar.Groups)
        {
            foreach (var e in group.Members)
            {
                Note(e.Start);
                Note(e.End);
                Note(e.RecurrenceId);
                foreach (var r in e.Rdates) Note(r.Value);
                foreach (var x in e.Exdates) Note(x);
                if (e.Start is IcsDateValue.ZonedValue zoned && e.RRules.Count > 0) Add(zoned.Tzid, LastSeriesYear(e, currentYear));
            }
        }
        return ranges;
    }

    /// <summary>The <c>TZID</c> parameters used inside components kept as read in Others (their definitions are kept, never generated).</summary>
    private static HashSet<string> TzidsOfOthers(IcsCalendar calendar)
    {
        var output = new HashSet<string>(StringComparer.Ordinal);
        foreach (var other in calendar.Others)
        {
            foreach (var content in IcsLexer.Unfold(IcsLexer.PhysicalLines(other.Raw)))
            {
                var parsed = IcsLexer.ParseContentLine(content.Text);
                var tzid = parsed is null ? null : IcsLexer.ParamValue(parsed.Params, "TZID");
                if (!string.IsNullOrEmpty(tzid)) output.Add(tzid);
            }
        }
        return output;
    }

    /// <summary>The <c>VTIMEZONE</c>s to write (§5.4): the ones in use, rebuilt or generated as needed.</summary>
    private static List<IcsTimeZone> TimeZonesToWrite(IcsCalendar calendar, IZoneResolver zones, int? currentYear)
    {
        var used = IcsReader.UsedTzids(calendar.Groups);
        var usedSet = used.Select(u => u.Tzid).ToHashSet(StringComparer.Ordinal);
        var usedByOthers = TzidsOfOthers(calendar);
        var years = YearsUsed(calendar, currentYear);
        var output = new List<IcsTimeZone>();
        var have = new HashSet<string>(StringComparer.Ordinal);
        IcsTimeZone? Build(string tzid, int? line)
        {
            if (!years.TryGetValue(tzid, out var range) || !IcsZones.KnownZone(tzid, zones)) return null;
            return IcsZones.BuildVTimeZone(tzid, [range.Min, range.Max], zones) with { Line = line };
        }
        foreach (var zone in calendar.TimeZones)
        {
            if ((!usedSet.Contains(zone.Tzid) && !usedByOthers.Contains(zone.Tzid)) || have.Contains(zone.Tzid)) continue;
            have.Add(zone.Tzid);
            var grown = zone.Generated is { } g && years.TryGetValue(zone.Tzid, out var range) && (range.Min < g.First || range.Max > g.Last);
            output.Add((grown ? Build(zone.Tzid, zone.Line) : null) ?? zone);
        }
        foreach (var (tzid, _) in used)
        {
            if (have.Contains(tzid)) continue;
            var zone = Build(tzid, null);
            if (zone is not null) output.Add(zone);
        }
        return output;
    }

    // ---- The calendar ----------------------------------------------------------------------------

    /// <summary>Sets a calendar property's value (the first of that name; later ones removed), appends it when missing, or removes it (null).</summary>
    private static void SetCalendarProp(List<IcsProperty> props, string name, string? value, IEnumerable<IcsParameter>? parameters = null)
    {
        var index = props.FindIndex(p => p.Name == name);
        for (var i = props.Count - 1; i > index; i--)
        {
            if (props[i].Name == name) props.RemoveAt(i);
        }
        if (value is null)
        {
            if (index >= 0) props.RemoveAt(index);
            return;
        }
        if (index >= 0) props[index] = Prop(name, value, parameters);
        else props.Add(Prop(name, value, parameters));
    }

    /// <summary>The calendar properties to write: Extra, with <c>VERSION</c> and <c>PRODID</c> ensured and the field properties set where the fields changed.</summary>
    private static List<IcsProperty> CalendarProps(IcsCalendar calendar)
    {
        var props = calendar.Extra.ToList();
        if (!props.Any(p => p.Name == "PRODID")) props.Insert(0, Prop("PRODID", ThirteenProdId));
        if (!props.Any(p => p.Name == "VERSION")) props.Insert(0, Prop("VERSION", "2.0"));
        var derived = IcsReader.CalendarFields(props);
        if (calendar.Name != derived.Name)
        {
            var value = calendar.Name is null ? null : IcsLexer.EscapeText(calendar.Name);
            SetCalendarProp(props, "X-WR-CALNAME", value);
            SetCalendarProp(props, "NAME", value);
        }
        var color = calendar.Color is null ? null : IcsColors.NormalizeHexColor(calendar.Color);
        if (calendar.Color is not null && color is null) throw ThirteenException.InvalidIcs($"Calendar color must be '#rrggbb', got {Ev.Show(calendar.Color)}");
        if (color != derived.Color)
        {
            SetCalendarProp(props, "X-APPLE-CALENDAR-COLOR", color?.ToUpperInvariant());
            SetCalendarProp(props, "COLOR", color is null ? null : IcsColors.NearestCssColorName(color));
        }
        if (calendar.RefreshInterval != derived.RefreshInterval)
        {
            if (calendar.RefreshInterval is not null && IcsValues.ParseDuration(calendar.RefreshInterval) is null)
            {
                throw ThirteenException.InvalidIcs($"Calendar refreshInterval must be a duration such as 'PT6H', got {Ev.Show(calendar.RefreshInterval)}");
            }
            SetCalendarProp(props, "REFRESH-INTERVAL", calendar.RefreshInterval, [new IcsParameter("VALUE", "DURATION")]);
            SetCalendarProp(props, "X-PUBLISHED-TTL", calendar.RefreshInterval);
        }
        return props;
    }

    /// <summary>The source properties of a calendar's raw property lines.</summary>
    private static List<SourceProperty> RawCalendarProps(string? raw)
    {
        var output = new List<SourceProperty>();
        if (raw is null) return output;
        var lines = IcsLexer.PhysicalLines(raw);
        foreach (var content in IcsLexer.Unfold(lines))
        {
            var parsed = IcsLexer.ParseContentLine(content.Text);
            if (parsed is null) continue;
            output.Add(new SourceProperty(parsed, string.Join(Crlf, lines.Skip(content.First).Take(content.Last - content.First + 1)), content.First + 1));
        }
        return output;
    }

    /// <param name="Line">The line it was read on, or the line it is placed after.</param>
    /// <param name="After"><c>true</c> when placed after <paramref name="Line"/> (it has no line of its own).</param>
    /// <param name="Rank">Order of creation.</param>
    /// <param name="Text">Its text.</param>
    private readonly record struct Placed(double Line, bool After, int Rank, string Text);

    /// <summary>
    /// Writes a calendar (§5.4): <c>BEGIN:VCALENDAR</c>, its properties (as read where unchanged), then its components
    /// in the order they were read: <c>VTIMEZONE</c>s, UID group members and Others with a Line by that line; a group
    /// member without one right after the last member of its group that has one (new groups at the end, in Groups
    /// order); a new or generated <c>VTIMEZONE</c> after the last <c>VTIMEZONE</c> as read (or before the first
    /// component). <paramref name="now"/> (UTC) is the <c>DTSTAMP</c> of serialized events that have none, and its
    /// year is the "current year" of the years used by series without an end (without it, their start year).
    /// TS: <c>serializeICalendar</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidIcs"/> for an invalid calendar, color, refresh interval, duration or <paramref name="now"/> at 24:00.</exception>
    public static string Serialize(IcsCalendar calendar, IZoneResolver zones, LocalDateTime? now = null)
    {
        ArgumentNullException.ThrowIfNull(calendar);
        if (zones is null) throw ThirteenException.InvalidIcs("zones must be a ZoneResolver with isKnown and offsetMinutesAt");
        if (now is { IsEndOfDay: true }) throw ThirteenException.InvalidIcs("serializeICalendar option 'now' must not be 24:00");

        var placed = new List<Placed>();
        var rank = 0;
        var zonesWritten = TimeZonesToWrite(calendar, zones, now?.Date.Year);
        var zoneLines = zonesWritten.Where(z => z.Line is not null).Select(z => (double)z.Line!.Value).ToList();
        var positionedLines = zoneLines
            .Concat(calendar.Groups.SelectMany(g => g.Members).Where(m => m.Line is not null).Select(m => (double)m.Line!.Value))
            .Concat(calendar.Others.Where(o => o.Line is not null).Select(o => (double)o.Line!.Value))
            .ToList();
        var lastZoneLine = zoneLines.Count == 0 ? double.NegativeInfinity : zoneLines.Max();
        var firstLine = positionedLines.Count == 0 ? double.PositiveInfinity : positionedLines.Min();
        var newZoneLine = !double.IsNegativeInfinity(lastZoneLine)
            ? lastZoneLine
            : double.IsPositiveInfinity(firstLine) ? double.NegativeInfinity : firstLine - 0.5;

        static string WithEnd(string text) => text.EndsWith(Crlf, StringComparison.Ordinal) ? text : text + Crlf;
        foreach (var zone in zonesWritten)
        {
            placed.Add(new Placed(zone.Line ?? newZoneLine, zone.Line is null, rank++, SerializeTimeZone(zone)));
        }
        foreach (var group in calendar.Groups)
        {
            var members = group.Members.ToList();
            var lines = members.Where(m => m.Line is not null).Select(m => m.Line!.Value).ToList();
            var groupLine = lines.Count == 0 ? double.PositiveInfinity : lines.Max();
            foreach (var member in members)
            {
                var text = member.Raw is not null ? WithEnd(member.Raw) : SerializeEvent(member, now);
                placed.Add(new Placed(member.Line ?? groupLine, member.Line is null, rank++, text));
            }
        }
        foreach (var other in calendar.Others)
        {
            placed.Add(new Placed(other.Line ?? double.PositiveInfinity, other.Line is null, rank++, WithEnd(other.Raw)));
        }
        placed.Sort((a, b) => a.Line != b.Line ? a.Line.CompareTo(b.Line) : a.After != b.After ? (a.After ? 1 : -1) : a.Rank.CompareTo(b.Rank));

        var writer = new IcsTextWriter();
        writer.Line("BEGIN:VCALENDAR");
        var sources = RawCalendarProps(calendar.Raw);
        foreach (var p in CalendarProps(calendar)) writer.ReuseOrWrite(p, sources);
        foreach (var item in placed) writer.Chunk(item.Text);
        writer.Line("END:VCALENDAR");
        return writer.ToString();
    }
}
