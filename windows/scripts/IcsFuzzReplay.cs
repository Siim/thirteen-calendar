using System.Text.Json;
using System.Text.Json.Nodes;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Core.Tests.Support;
using Xunit.Abstractions;
using static Thirteen.Core.Tests.Support.EventsJson;
using static Thirteen.Core.Tests.Support.IcsJson;

namespace Thirteen.Core.Tests;

/// <summary>
/// Replays a file written by windows/scripts/ics-fuzz.mjs (random .ics inputs run through @thirteen/core/ics) through
/// the C# port and compares every result: parse (calendar fields, warnings, groups, raw texts), the writer and its
/// read-back, resolveTzid and toUtc, sameTimeZoneDefinition, versions, import baselines, untilFor, the recognition
/// input and recognition, expandCalendar with every IcsExpandedEvent field, edits, the §2.17 import and restore
/// merges, buildVTimeZone, allDayEnd, and the lexer and value helpers. Zone answers come from the file's own
/// zoneOffsets through <see cref="RecordedZoneResolver"/>. Not part of Thirteen.Core.Tests: ics-fuzz.sh compiles it
/// with the Support files into a temporary test project (windows/README.md).
/// </summary>
public sealed class IcsFuzzReplay(ITestOutputHelper output)
{
    private readonly List<string> _found = [];
    private int _checks;
    private int _skippedByDesign;

    private void Add(string where, string what) => _found.Add($"{where}: {what}");

    private void Json(string where, JsonNode? actual, JsonElement expected)
    {
        _checks++;
        var d = JsonCompare.FirstDifference(actual, expected);
        if (d is not null) Add(where, d);
    }

    private void Same(string where, string? actual, JsonElement expected)
    {
        _checks++;
        var e = IsNull(expected) ? null : Str(expected);
        if (actual == e) return;
        if (actual is null || e is null)
        {
            Add(where, $"got {(actual is null ? "null" : "text")}, expected {(e is null ? "null" : "text")}");
            return;
        }
        var a = actual.Split("\r\n");
        var x = e.Split("\r\n");
        for (var i = 0; i < Math.Max(a.Length, x.Length); i++)
        {
            var p = i < a.Length ? a[i] : "<end>";
            var q = i < x.Length ? x[i] : "<end>";
            if (p == q) continue;
            Add(where, $"line {i + 1}: got {Calc.Quoted(p)}, expected {Calc.Quoted(q)}");
            return;
        }
        Add(where, "texts differ only in line ends");
    }

    /// <summary>Runs <paramref name="f"/> where TypeScript gave <paramref name="error"/> (null: no error); false when the result is not to be compared.</summary>
    private bool Outcome<T>(string where, JsonElement error, Func<T> f, out T value)
    {
        _checks++;
        var tsError = IsNull(error) ? null : Str(error);
        try
        {
            value = f();
            if (tsError is null) return true;
            Add(where, $"TypeScript threw ({tsError}), C# returned a value");
            return false;
        }
        catch (ZoneDataMissingException missing)
        {
            value = default!;
            Add(where, $"C# needed zone data TypeScript never asked for: {missing.Message}");
            return false;
        }
        catch (Exception) when (tsError is not null)
        {
            value = default!;
            return false;
        }
        catch (Exception thrown)
        {
            value = default!;
            Add(where, $"C# threw {thrown.GetType().Name}: {thrown.Message}");
            return false;
        }
    }

    private static readonly JsonElement Missing = JsonDocument.Parse("null").RootElement.Clone();

    private static JsonElement Opt(JsonElement e, string name) => e.TryGetProperty(name, out var v) ? v : Missing;

    // ---- JSON forms the fixtures do not have -------------------------------------------------------

    private static JsonObject FullOccurrenceJson(IcsExpandedEvent o) => Obj(
        ("key", o.Key),
        ("calendarId", o.CalendarId),
        ("title", o.Title),
        ("allDay", o.AllDay),
        ("start", LocalJson(o.Start)),
        ("end", LocalJson(o.End)),
        ("uid", o.Uid),
        ("group", o.Group),
        ("originalDate", DateJson(o.OriginalDate)),
        ("originalMinute", o.OriginalMinute),
        ("recurring", o.Recurring),
        ("orphan", o.Orphan),
        ("status", o.Status.RawValue()),
        ("zone", o.Zone),
        ("startUtc", OptLocalJson(o.StartUtc)),
        ("componentLine", o.Component.Line),
        ("componentRecurrenceId", OptDateValueJson(o.Component.RecurrenceId)));

    private static JsonObject RecognitionInputJson(RecognitionInput i) => Obj(
        ("start", LocalJson(i.Start)),
        ("rrules", Arr(i.RRules, r => Obj(("rrule", r.RRule.ToString()), ("until", OptLocalJson(r.Until))))),
        ("exrules", Arr(i.ExRules, r => Obj(("rrule", r.RRule.ToString()), ("until", OptLocalJson(r.Until))))),
        ("rdates", Arr(i.Rdates, ExtraDateJson)),
        ("exdates", Arr(i.Exdates, OriginalDateJson)),
        ("marker", i.Marker));

    private static JsonArray WarningsJson(IEnumerable<IcsWarning> warnings) => Arr(warnings, WarningKeyJson);

    // ---- Steps ------------------------------------------------------------------------------------

    private static IcsGroup GroupOf(IcsCalendar calendar, string uid) =>
        calendar.Groups.FirstOrDefault(g => g.Uid == uid) ?? throw new InvalidDataException($"The calendar has no group {uid}");

    /// <summary>TS <c>applyChanges</c> of packages/core/scripts/ics-procedures.ts.</summary>
    private static IcsCalendar ApplyChanges(IcsCalendar calendar, IEnumerable<JsonElement> changes, IZoneResolver zones)
    {
        var next = calendar;
        foreach (var change in changes)
        {
            switch (Str(change.P("op")))
            {
                case "set":
                {
                    var group = GroupOf(next, Str(change.P("uid")));
                    var recurrenceId = ReadOptDateValue(change.P("recurrenceId"));
                    bool Matches(IcsEvent e) => recurrenceId is null ? e.RecurrenceId is null : e.RecurrenceId is not null && IcsValues.SameDateValue(e.RecurrenceId, recurrenceId);
                    if (!group.Members.Any(Matches)) throw new InvalidDataException($"Group {group.Uid} has no such member");
                    IcsEvent Update(IcsEvent e) => Matches(e) ? ApplyFields(e, change.P("fields")) : e;
                    next = IcsGroups.ReplaceGroup(next, new IcsGroup(group.Uid, group.Master is null ? null : Update(group.Master), group.Overrides.Select(Update).ToValueList()));
                    break;
                }
                case "untils":
                {
                    var group = GroupOf(next, Str(change.P("uid")));
                    if (group.Master is null) throw new InvalidDataException($"Group {group.Uid} has no master");
                    var untils = change.A("untils").Select(ReadUntilRewrite).ToList();
                    next = IcsGroups.ReplaceGroup(next, group with { Master = IcsGroups.WithRetimedUntils(group.Master, untils, next, zones) });
                    break;
                }
                case "add":
                {
                    var e = ReadEvent(change.P("event"));
                    next = IcsGroups.ReplaceGroup(next, new IcsGroup(e.Uid, e, ValueList<IcsEvent>.Empty));
                    break;
                }
                case "remove":
                {
                    var uid = Str(change.P("uid"));
                    GroupOf(next, uid);
                    next = IcsGroups.RemoveGroup(next, uid);
                    break;
                }
                default:
                    throw new InvalidDataException($"Unknown change {Short(change)}");
            }
        }
        return next;
    }

    private void Expansion(string where, IcsCalendar calendar, string calendarId, JsonElement e, IZoneResolver zones)
    {
        var zone = Str(e.P("deviceZone"));
        var window = new DeviceWindow(Local(e.P("window").P("from")), Local(e.P("window").P("to")));
        var limit = OptInt(e.P("limit")) ?? EventRecurrence.DefaultLimit;
        var system = SystemId(e.P("system"));
        var at = $"{where} expand {zone} {window.From}..{window.To}{(IsNull(e.P("limit")) ? "" : $" limit {limit}")} {system.RawValue()}";
        if (!Outcome(at, e.P("error"), () => IcsExpansion.ExpandCalendar(calendar, zone, zones, window, system, calendarId, limit), out var result)) return;
        Json($"{at} warnings", WarningsJson(result.Warnings), e.P("warnings"));
        Json($"{at} occurrences", Arr(result.Events, FullOccurrenceJson), e.P("occurrences"));
    }

    private void Case(JsonElement c, IZoneResolver zones)
    {
        var name = Str(c.P("name"));
        var calendarId = Str(c.P("calendarId"));
        var now = Local(c.P("now"));
        var text = Str(c.P("text"));
        if (!Outcome($"{name} parse", c.P("error"), () => IcsReader.Parse(text, calendarId, zones), out var calendar)) return;

        Json($"{name} calendar", CalendarJson(calendar), c.P("calendar"));
        Json($"{name} warnings", WarningsJson(calendar.Warnings), c.P("warnings"));
        Json($"{name} groups", Arr(calendar.Groups, GroupJson), c.P("groups"));
        Json($"{name} raws", Arr(calendar.Groups, g => Arr(g.Members, m => (JsonNode?)m.Raw)), c.P("raws"));
        Json($"{name} others", Arr(calendar.Others, o => (JsonNode?)o.Raw), c.P("others"));
        Same($"{name} calendar raw", calendar.Raw, c.P("calendarRaw"));
        Json($"{name} zone raws", Arr(calendar.TimeZones, t => (JsonNode?)t.Raw), c.P("zoneRaws"));

        if (Outcome($"{name} serialize", c.P("roundtripError"), () => IcsWriter.Serialize(calendar, zones, now), out var written))
        {
            Same($"{name} roundtrip", written, c.P("roundtrip"));
            if (Outcome($"{name} read back", Opt(c, "againError"), () => IcsWriter.Serialize(IcsReader.Parse(written, calendarId, zones), zones, now), out var again))
            {
                Same($"{name} read back", again, c.P("again"));
            }
        }

        foreach (var r in c.A("resolutions"))
        {
            var tzid = Str(r.P("tzid"));
            var at = $"{name} resolve {Calc.Quoted(tzid)}";
            if (!Outcome(at, Opt(r, "error"), () => IcsZones.Resolve(tzid, calendar, zones), out var handle)) continue;
            Json($"{at} kind", (JsonNode)handle.Kind.RawValue(), r.P("kind"));
            Json($"{at} zone", (JsonNode?)handle.Zone, r.P("zone"));
            var probe = Local(r.P("probe"));
            if (Outcome($"{at} toUtc {probe}", r.P("utcError"), () => IcsZones.ToUtc(new IcsDateValue.ZonedValue(probe, tzid), handle), out var utc))
            {
                Json($"{at} toUtc {probe}", OptLocalJson(utc), r.P("utc"));
            }
        }
        Json($"{name} sameTimeZoneDefinition", Arr(calendar.TimeZones.SelectMany(a => calendar.TimeZones.Select(b => IcsZones.SameDefinition(a, b))), b => (JsonNode)b), c.P("sameDefinitions"));

        Json($"{name} versions", Arr(calendar.Groups, g => Obj(
            ("group", OptLocalJson(IcsGroups.GroupVersion(g))),
            ("members", Arr(g.Members, m => OptLocalJson(IcsGroups.EventVersion(m)))))), c.P("versions"));
        var baseline = Local(c.P("baseline"));
        var baselines = c.A("baselines");
        if (baselines.Length != calendar.Groups.Count) Add(name, $"{baselines.Length} baselines for {calendar.Groups.Count} groups");
        for (var i = 0; i < calendar.Groups.Count && i < baselines.Length; i++)
        {
            var b = baselines[i];
            var group0 = calendar.Groups[i];
            var at = $"{name} withImportBaseline {group0.Uid}";
            if (!Outcome(at, Opt(b, "error"), () => IcsGroups.WithImportBaseline(group0, baseline), out var group)) continue;
            Json(at, Arr(group.Members, m => Obj(("raw", m.Raw), ("original", m.Original), ("imported", OptDateValueJson(m.ImportedLastModified)))), b.P("members"));
        }

        var masters = calendar.Groups.Where(g => g.Master is not null).ToList();
        var untils = c.A("untils");
        if (untils.Length != masters.Count) Add(name, $"{untils.Length} untils for {masters.Count} masters");
        for (var i = 0; i < masters.Count && i < untils.Length; i++)
        {
            var u = untils[i];
            var master = masters[i].Master!;
            var endDate = Date(u.P("endDate"));
            var at = $"{name} untilFor {masters[i].Uid} {endDate.ToIsoString()}";
            if (Outcome(at, u.P("error"), () => IcsGroups.UntilFor(endDate, master, calendar, zones), out var until)) Json(at, UntilJson(until), u.P("until"));
        }

        var system = SystemId(c.P("system"));
        var repeating = calendar.Groups.Where(g => g.Master is not null && (g.Master.RRules.Count > 0 || g.Master.Rdates.Count > 0)).ToList();
        var recognitions = c.A("recognitions");
        if (recognitions.Length != repeating.Count) Add(name, $"{recognitions.Length} recognitions for {repeating.Count} repeating masters");
        for (var i = 0; i < repeating.Count && i < recognitions.Length; i++)
        {
            var r = recognitions[i];
            var master = repeating[i].Master!;
            var at = $"{name} recognition {repeating[i].Uid}";
            if (!Outcome($"{at} input", Opt(r, "error"), () => IcsExpansion.RecognitionInputFor(master, calendar, zones), out var input)) continue;
            Json($"{at} input", RecognitionInputJson(input), r.P("input"));
            if (Outcome(at, r.P("recognitionError"), () => Recognition.Of(input, system), out var recognition)) Json(at, RecognitionJson(recognition), r.P("recognition"));
        }

        foreach (var e in c.A("expansions")) Expansion(name, calendar, calendarId, e, zones);

        var step = 0;
        foreach (var edit in c.A("edits"))
        {
            step++;
            var at = $"{name} edit {step}";
            var input = Str(edit.P("input"));
            if (!Outcome(at, edit.P("error"), () => IcsWriter.Serialize(ApplyChanges(IcsReader.Parse(input, calendarId, zones), edit.A("changes"), zones), zones, now), out var edited)) continue;
            Same(at, edited, edit.P("expected"));
            if (edit.TryGetProperty("expansion", out var expansion) && Outcome($"{at} read", Missing, () => IcsReader.Parse(edited, calendarId, zones), out var stored))
            {
                Expansion(at, stored, calendarId, expansion, zones);
            }
        }

        step = 0;
        foreach (var merge in c.A("merges"))
        {
            step++;
            var kind = Str(merge.P("kind"));
            var at = $"{name} {kind} {step}";
            var error = merge.P("error");
            // The TypeScript reference throws for a group with neither LAST-MODIFIED nor DTSTAMP ("the set's inputs always
            // carry one"); the C# merge treats it as older than any other, as §2.17 says (windows/README.md).
            if (!IsNull(error) && Str(error).Contains("neither LAST-MODIFIED nor DTSTAMP", StringComparison.Ordinal))
            {
                _skippedByDesign++;
                continue;
            }
            var target = IcsReader.Parse(Str(merge.P("target")), calendarId, zones);
            var incoming = Str(merge.P("incoming"));
            if (kind == "import")
            {
                if (!Outcome(at, error, () => IcsMerge.ImportCalendar(target, incoming, calendarId, zones), out var imported)) continue;
                Json($"{at} result", Obj(("added", imported.Added), ("updated", imported.Updated), ("unchanged", imported.Unchanged), ("skipped", imported.Skipped)), merge.P("result"));
                if (Outcome($"{at} write", Opt(merge, "serializeError"), () => IcsWriter.Serialize(imported.Calendar, zones, now), out var mergedText)) Same(at, mergedText, merge.P("expected"));
            }
            else
            {
                if (!Outcome(at, error, () => IcsMerge.RestoreCalendar(target, incoming, calendarId, zones), out var restored)) continue;
                Json($"{at} result", Obj(("added", restored.Added), ("updated", restored.Updated), ("unchanged", restored.Unchanged), ("keptNewer", restored.KeptNewer)), merge.P("result"));
                if (Outcome($"{at} write", Opt(merge, "serializeError"), () => IcsWriter.Serialize(restored.Calendar, zones, now), out var mergedText)) Same(at, mergedText, merge.P("expected"));
            }
        }
    }

    private void Lexer(JsonElement l)
    {
        var s = Str(l.P("input"));
        var at = $"lexer {Calc.Quoted(s)}";
        Json($"{at} windows", (JsonNode?)IcsZones.WindowsZoneToIana(s), l.P("windows"));
        Json($"{at} css", (JsonNode?)IcsColors.CssColorHex(s), l.P("css"));
        if (l.TryGetProperty("windowsOnly", out _)) return;
        Same($"{at} fold", IcsLexer.FoldLine(s), l.P("fold"));
        Same($"{at} escape", IcsLexer.EscapeText(s), l.P("escape"));
        Same($"{at} unescape", IcsLexer.UnescapeText(s), l.P("unescape"));
        Same($"{at} quote", IcsLexer.QuoteParam(s), l.P("quote"));
        var content = IcsLexer.ParseContentLine(s);
        Json($"{at} content", content is null ? null : Obj(
            ("name", content.Name),
            ("params", Arr(content.Params, p => new JsonArray(p.Name, p.Value))),
            ("value", content.Value),
            ("valueParam", IcsLexer.ParamValue(content.Params, "VALUE")),
            ("tzid", IcsLexer.ParamValue(content.Params, "TZID"))), l.P("content"));
        Json($"{at} dateValue", content is null ? null : OptDateValueJson(IcsValues.ReadDateValue(content.Value, content.Params)), l.P("dateValue"));
        var duration = IcsValues.ParseDuration(s);
        Json($"{at} duration", duration is { } d ? Obj(("negative", d.Negative), ("days", d.Days), ("seconds", d.Seconds), ("minutes", IcsValues.DurationMinutes(d))) : null, l.P("duration"));
        Same($"{at} formatDurationMinutes", IcsValues.FormatDurationMinutes(Long(l.P("minutes"))), l.P("formatted"));
        Json($"{at} offset", (JsonNode?)IcsValues.ParseUtcOffset(s), l.P("offset"));
        Json($"{at} hex", (JsonNode?)IcsColors.NormalizeHexColor(s), l.P("hex"));
        Same($"{at} nearest", IcsColors.NearestCssColorName(Str(l.P("color"))), l.P("nearest"));
    }

    [Fact]
    public void Replay()
    {
        var path = Environment.GetEnvironmentVariable("THIRTEEN_ICS_FUZZ") ?? throw new InvalidOperationException("Set THIRTEEN_ICS_FUZZ to a file written by ics-fuzz.mjs");
        using var document = JsonDocument.Parse(File.ReadAllBytes(path));
        var root = document.RootElement;
        var zones = new RecordedZoneResolver(root.A("zoneOffsets"));
        var cases = root.A("cases");
        foreach (var c in cases)
        {
            try
            {
                Case(c, zones);
            }
            catch (Exception thrown)
            {
                Add(Str(c.P("name")), $"replay threw {thrown.GetType().Name}: {thrown.Message}");
            }
        }
        foreach (var t in root.A("tzBuilds"))
        {
            var tzid = Str(t.P("tzid"));
            var years = t.A("years").Select(Int).ToArray();
            var at = $"buildVTimeZone {Calc.Quoted(tzid)} {years[0]}-{years[1]}";
            if (Outcome(at, t.P("error"), () => IcsWriter.SerializeTimeZone(IcsZones.BuildVTimeZone(tzid, years, zones)), out var text)) Same(at, text, t.P("text"));
        }
        foreach (var a in root.A("allDayEnds"))
        {
            var first = Date(a.P("first"));
            var last = Date(a.P("last"));
            var at = $"allDayEnd {first.ToIsoString()} {last.ToIsoString()}";
            if (!Outcome(at, a.P("error"), () => IcsGroups.AllDayEnd(first, last), out var end)) continue;
            Json($"{at} end", OptDateValueJson(end.End), a.P("end"));
            Json($"{at} duration", (JsonNode?)end.Duration, a.P("duration"));
        }
        foreach (var l in root.A("lexerCases")) Lexer(l);

        File.WriteAllLines(path + ".mismatches.txt", _found);
        output.WriteLine($"{cases.Length} cases, {_checks} checks, {_found.Count} mismatches, {_skippedByDesign} merges skipped by design (no version)");
        Assert.True(_found.Count == 0, $"{_found.Count} mismatch(es) (all in {path}.mismatches.txt):\n  " + string.Join("\n  ", _found.Take(30)));
    }
}
