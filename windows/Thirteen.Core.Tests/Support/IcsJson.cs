using System.Text.Json;
using System.Text.Json.Nodes;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using static Thirteen.Core.Tests.Support.EventsJson;

namespace Thirteen.Core.Tests.Support;

/// <summary>
/// The JSON forms of fixtures/ics (docs/EVENTS.md §5.6; packages/core/scripts/ics-json.ts and ics-procedures.ts):
/// readers from <see cref="JsonElement"/> and writers to <see cref="JsonNode"/> with the TypeScript field names in the
/// TypeScript order, so results compare with <see cref="JsonCompare"/> key for key. Explicit code throughout.
/// </summary>
internal static class IcsJson
{
    // ---- Writers -------------------------------------------------------------------------------

    public static JsonObject DateValueJson(IcsDateValue value) => value switch
    {
        IcsDateValue.DateValue d => Obj(("kind", "date"), ("date", DateJson(d.Date))),
        IcsDateValue.FloatingValue f => Obj(("kind", "floating"), ("value", LocalJson(f.Value))),
        IcsDateValue.UtcValue u => Obj(("kind", "utc"), ("value", LocalJson(u.Value))),
        IcsDateValue.ZonedValue z => Obj(("kind", "zoned"), ("value", LocalJson(z.Value)), ("tzid", z.Tzid)),
        _ => throw new InvalidOperationException("Unknown IcsDateValue"),
    };

    public static JsonNode? OptDateValueJson(IcsDateValue? value) => value is null ? null : DateValueJson(value);

    public static JsonObject PropertyJson(IcsProperty p) => Obj(
        ("name", p.Name),
        ("params", Arr(p.Params, x => new JsonArray(x.Name, x.Value))),
        ("value", p.Value));

    private static JsonObject TriggerJson(IcsTrigger trigger) => trigger switch
    {
        IcsTrigger.Relative r => Obj(("kind", "relative"), ("minutes", r.Minutes), ("related", r.Related.RawValue())),
        IcsTrigger.Absolute a => Obj(("kind", "absolute"), ("value", DateValueJson(a.Value))),
        _ => throw new InvalidOperationException("Unknown trigger"),
    };

    private static JsonObject AlarmJson(IcsAlarm a) => Obj(("action", a.Action), ("trigger", TriggerJson(a.Trigger)), ("extra", Arr(a.Extra, PropertyJson)));

    private static JsonObject RdateJson(IcsRdate r) => Obj(("value", DateValueJson(r.Value)), ("period", r.Period));

    /// <summary>Every field of §5.4 except Raw and Original, in declaration order; rules as their canonical text.</summary>
    public static JsonObject EventJson(IcsEvent e) => Obj(
        ("uid", e.Uid),
        ("uidDerived", e.UidDerived),
        ("recurrenceId", OptDateValueJson(e.RecurrenceId)),
        ("sequence", e.Sequence),
        ("summary", e.Summary),
        ("location", e.Location),
        ("description", e.Description),
        ("url", e.Url),
        ("start", DateValueJson(e.Start)),
        ("end", OptDateValueJson(e.End)),
        ("duration", e.Duration),
        ("rrules", Strs(e.RRules.Select(r => r.ToString()))),
        ("exrules", Strs(e.ExRules.Select(r => r.ToString()))),
        ("rdates", Arr(e.Rdates, RdateJson)),
        ("exdates", Arr(e.Exdates, DateValueJson)),
        ("status", e.Status),
        ("transp", e.Transp),
        ("thirteenRule", e.ThirteenRule),
        ("alarms", Arr(e.Alarms, AlarmJson)),
        ("created", OptDateValueJson(e.Created)),
        ("lastModified", OptDateValueJson(e.LastModified)),
        ("dtstamp", OptDateValueJson(e.Dtstamp)),
        ("importedLastModified", OptDateValueJson(e.ImportedLastModified)),
        ("extra", Arr(e.Extra, PropertyJson)),
        ("line", e.Line));

    public static JsonObject GroupJson(IcsGroup g) => Obj(
        ("uid", g.Uid),
        ("master", g.Master is null ? null : EventJson(g.Master)),
        ("overrides", Arr(g.Overrides, EventJson)));

    /// <summary>Warnings as <c>{line, code}</c>: the README says <c>detail</c> is informative and ports compare <c>line</c> and <c>code</c>.</summary>
    public static JsonObject WarningKeyJson(IcsWarning w) => Obj(("line", w.Line), ("code", w.Code.RawValue()));

    public static JsonObject WarningKeyJson(JsonElement w) => Obj(("line", Int(w.P("line"))), ("code", Str(w.P("code"))));

    public static JsonObject CalendarJson(IcsCalendar c) => Obj(
        ("name", c.Name),
        ("color", c.Color),
        ("refreshInterval", c.RefreshInterval),
        ("extra", Arr(c.Extra, PropertyJson)),
        ("timeZones", Arr(c.TimeZones, t => Obj(
            ("tzid", t.Tzid),
            ("observances", t.Observances.Count),
            ("generated", t.Generated is { } g ? Obj(("first", g.First), ("last", g.Last)) : null),
            ("line", t.Line)))),
        ("others", Arr(c.Others, o => Obj(("name", o.Name), ("line", o.Line)))));

    public static JsonObject OccurrenceJson(IcsExpandedEvent o) => Obj(
        ("key", o.Key),
        ("calendarId", o.CalendarId),
        ("title", o.Title),
        ("allDay", o.AllDay),
        ("start", LocalJson(o.Start)),
        ("end", LocalJson(o.End)));

    // ---- Readers -------------------------------------------------------------------------------

    public static IcsDateValue ReadDateValue(JsonElement e) => Str(e.P("kind")) switch
    {
        "date" => new IcsDateValue.DateValue(Date(e.P("date"))),
        "floating" => new IcsDateValue.FloatingValue(Local(e.P("value"))),
        "utc" => new IcsDateValue.UtcValue(Local(e.P("value"))),
        "zoned" => new IcsDateValue.ZonedValue(Local(e.P("value")), Str(e.P("tzid"))),
        var kind => throw new InvalidDataException($"Unknown IcsDateValue kind {kind}"),
    };

    public static IcsDateValue? ReadOptDateValue(JsonElement e) => IsNull(e) ? null : ReadDateValue(e);

    private static IcsProperty ReadProperty(JsonElement e) => new(
        Str(e.P("name")),
        e.A("params").Select(p =>
        {
            var pair = p.EnumerateArray().ToArray();
            if (pair.Length != 2) throw new InvalidDataException($"A parameter must be [name, value], got {Short(p)}");
            return new IcsParameter(Str(pair[0]), Str(pair[1]));
        }).ToValueList(),
        Str(e.P("value")));

    private static IcsTrigger ReadTrigger(JsonElement e) => Str(e.P("kind")) switch
    {
        "relative" => new IcsTrigger.Relative(Long(e.P("minutes")), Str(e.P("related")) == "end" ? IcsTriggerRelation.End : IcsTriggerRelation.Start),
        "absolute" => new IcsTrigger.Absolute(ReadDateValue(e.P("value"))),
        var kind => throw new InvalidDataException($"Unknown trigger kind {kind}"),
    };

    private static IcsAlarm ReadAlarm(JsonElement e) => new(Str(e.P("action")), ReadTrigger(e.P("trigger")), e.A("extra").Select(ReadProperty).ToValueList());

    private static IcsRdate ReadRdate(JsonElement e) => new(ReadDateValue(e.P("value")), OptStr(e.P("period")));

    /// <summary>The fields of <paramref name="json"/> (any subset of the settable fields) applied to <paramref name="e"/> (TS <c>{...e, ...icsEventFieldsFromJson(fields)}</c>).</summary>
    public static IcsEvent ApplyFields(IcsEvent e, JsonElement json)
    {
        foreach (var field in json.EnumerateObject())
        {
            var v = field.Value;
            e = field.Name switch
            {
                "recurrenceId" => e with { RecurrenceId = ReadOptDateValue(v) },
                "sequence" => e with { Sequence = Int(v) },
                "summary" => e with { Summary = Str(v) },
                "location" => e with { Location = Str(v) },
                "description" => e with { Description = Str(v) },
                "url" => e with { Url = Str(v) },
                "start" => e with { Start = ReadDateValue(v) },
                "end" => e with { End = ReadOptDateValue(v) },
                "duration" => e with { Duration = OptStr(v) },
                "rrules" => e with { RRules = v.EnumerateArray().Select(r => RRule.Parse(Str(r))).ToValueList() },
                "exrules" => e with { ExRules = v.EnumerateArray().Select(r => RRule.Parse(Str(r))).ToValueList() },
                "rdates" => e with { Rdates = v.EnumerateArray().Select(ReadRdate).ToValueList() },
                "exdates" => e with { Exdates = v.EnumerateArray().Select(ReadDateValue).ToValueList() },
                "status" => e with { Status = OptStr(v) },
                "transp" => e with { Transp = OptStr(v) },
                "thirteenRule" => e with { ThirteenRule = OptStr(v) },
                "alarms" => e with { Alarms = v.EnumerateArray().Select(ReadAlarm).ToValueList() },
                "created" => e with { Created = ReadOptDateValue(v) },
                "lastModified" => e with { LastModified = ReadOptDateValue(v) },
                "dtstamp" => e with { Dtstamp = ReadOptDateValue(v) },
                "importedLastModified" => e with { ImportedLastModified = ReadOptDateValue(v) },
                "extra" => e with { Extra = v.EnumerateArray().Select(ReadProperty).ToValueList() },
                var name => throw new InvalidDataException($"Unknown IcsEvent field {name}"),
            };
        }
        return e;
    }

    /// <summary>A new event (no text it was read from) from its JSON (TS <c>icsEventFromJson</c>).</summary>
    public static IcsEvent ReadEvent(JsonElement json)
    {
        var e = new IcsEvent
        {
            Uid = Str(json.P("uid")),
            UidDerived = Bool(json.P("uidDerived")),
            Start = ReadDateValue(json.P("start")),
            Raw = null,
            Original = null,
            Line = OptInt(json.P("line")),
        };
        var fields = new JsonObject();
        foreach (var field in json.EnumerateObject())
        {
            if (field.Name is "uid" or "uidDerived" or "line") continue;
            fields[field.Name] = JsonNode.Parse(field.Value.GetRawText());
        }
        using var document = JsonDocument.Parse(fields.ToJsonString());
        return ApplyFields(e, document.RootElement);
    }

    public static UntilRewrite ReadUntilRewrite(JsonElement e) => new(
        Str(e.P("rule")) switch
        {
            "rrule" => StoredRuleKind.RRule,
            "exrule" => StoredRuleKind.ExRule,
            var kind => throw new InvalidDataException($"Unknown rule kind {kind}"),
        },
        Int(e.P("index")),
        Date(e.P("endDate")));
}
