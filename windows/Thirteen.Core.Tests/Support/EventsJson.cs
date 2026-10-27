using System.Text.Json;
using System.Text.Json.Nodes;
using Thirteen.Core.Events;

namespace Thirteen.Core.Tests.Support;

/// <summary>
/// The JSON forms of events.json (docs/EVENTS.md §5.5; packages/core/scripts/events-fixtures.ts,
/// recurrence-fixtures.ts and layout-fixtures.ts): readers from <see cref="JsonElement"/> and writers to
/// <see cref="JsonNode"/> with the TypeScript field names in the TypeScript order, so results compare with
/// <see cref="JsonCompare"/> key for key. Explicit code throughout: no reflection-based serialisation.
/// </summary>
internal static class EventsJson
{
    // ---- Readers: scalars ----------------------------------------------------------------------

    public static bool IsNull(JsonElement e) => e.ValueKind == JsonValueKind.Null;

    public static string Str(JsonElement e) => e.ValueKind == JsonValueKind.String ? e.GetString()! : throw new InvalidDataException($"Expected a string, got {e.GetRawText()}");

    public static string? OptStr(JsonElement e) => IsNull(e) ? null : Str(e);

    public static int Int(JsonElement e) =>
        e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out var value) ? value : throw new UnrepresentableException($"Expected an integer, got {e.GetRawText()}");

    public static int? OptInt(JsonElement e) => IsNull(e) ? null : Int(e);

    public static long Long(JsonElement e) =>
        e.ValueKind == JsonValueKind.Number && e.TryGetInt64(out var value) ? value : throw new UnrepresentableException($"Expected an integer, got {e.GetRawText()}");

    public static bool Bool(JsonElement e) => e.GetBoolean();

    public static GregorianDate Date(JsonElement e) => GregorianDate.ParseIso(Str(e));

    public static LocalDateTime Local(JsonElement e) => LocalDateTime.Parse(Str(e));

    public static LocalDateTime? OptLocal(JsonElement e) => IsNull(e) ? null : Local(e);

    public static CalendarSystemId SystemId(JsonElement e) => CalendarSystemIdExtensions.Parse(Str(e));

    public static T Raw<T>(JsonElement e, Func<T, string> raw) where T : struct, Enum
    {
        var text = Str(e);
        foreach (var value in Enum.GetValues<T>())
        {
            if (raw(value) == text) return value;
        }
        throw new InvalidDataException($"Unknown {typeof(T).Name} {text}");
    }

    public static JsonElement P(this JsonElement e, string name) =>
        e.TryGetProperty(name, out var value) ? value : throw new InvalidDataException($"Missing \"{name}\" in {Short(e)}");

    public static JsonElement[] A(this JsonElement e, string name) => e.P(name).EnumerateArray().ToArray();

    public static string Short(JsonElement e)
    {
        var text = e.GetRawText();
        return text.Length <= 160 ? text : text[..160] + "...";
    }

    // ---- Readers: events types -----------------------------------------------------------------

    public static RRuleUntil ReadUntil(JsonElement e) => Str(e.P("kind")) switch
    {
        "date" => RRuleUntil.OnDate(Date(e.P("date"))),
        "floating" => RRuleUntil.Floating(Local(e.P("value"))),
        "utc" => RRuleUntil.Utc(Local(e.P("value"))),
        var kind => throw new InvalidDataException($"Unknown until kind {kind}"),
    };

    private static ValueList<int> Ints(JsonElement e) => e.EnumerateArray().Select(Int).ToValueList();

    public static RRule ReadRRule(JsonElement e)
    {
        if (!FrequencyExtensions.TryParse(Str(e.P("freq")), out var freq)) throw new InvalidDataException($"Unknown freq in {Short(e)}");
        return new RRule(freq)
        {
            Interval = Int(e.P("interval")),
            Count = OptInt(e.P("count")),
            Until = IsNull(e.P("until")) ? null : ReadUntil(e.P("until")),
            BySecond = Ints(e.P("bySecond")),
            ByMinute = Ints(e.P("byMinute")),
            ByHour = Ints(e.P("byHour")),
            ByDay = e.A("byDay").Select(d => new WeekdayNum((Weekday)Int(d.P("weekday")), OptInt(d.P("ordinal")))).ToValueList(),
            ByMonthDay = Ints(e.P("byMonthDay")),
            ByYearDay = Ints(e.P("byYearDay")),
            ByWeekNo = Ints(e.P("byWeekNo")),
            ByMonth = Ints(e.P("byMonth")),
            BySetPos = Ints(e.P("bySetPos")),
            Wkst = IsNull(e.P("wkst")) ? null : (Weekday)Int(e.P("wkst")),
            Rscale = OptStr(e.P("rscale")),
            Skip = OptStr(e.P("skip")),
            Extensions = e.A("extensions").Select(x => new RRuleExtension(Str(x[0]), Str(x[1]))).ToValueList(),
        };
    }

    public static RepeatEnd ReadEnd(JsonElement e) => Str(e.P("kind")) switch
    {
        "never" => RepeatEnd.Never,
        "count" => RepeatEnd.AfterCount(Int(e.P("count"))),
        "until" => RepeatEnd.Until(Date(e.P("date"))),
        var kind => throw new InvalidDataException($"Unknown end kind {kind}"),
    };

    public static ThirteenRule ReadThirteenRule(JsonElement e)
    {
        var system = SystemId(e.P("system"));
        return Str(e.P("kind")) switch
        {
            "monthly" => new ThirteenRule.Monthly(system, Int(e.P("day"))),
            "weekly" => new ThirteenRule.Weekly(system, (Weekday)Int(e.P("weekday")), Int(e.P("interval"))),
            "yearly" => new ThirteenRule.Yearly(system, Int(e.P("month")), Int(e.P("day"))),
            "intercalary" => new ThirteenRule.Intercalary(system, IntercalaryDayIdExtensions.Parse(Str(e.P("id")))),
            var kind => throw new InvalidDataException($"Unknown 13-month rule kind {kind}"),
        };
    }

    private static EndedRule ReadEndedRule(JsonElement e) => new(RRule.Parse(Str(e.P("rrule"))), ReadEnd(e.P("end")));

    public static RepeatRule ReadRule(JsonElement e) => Str(e.P("kind")) switch
    {
        "rrule" => RepeatRule.Of(RRule.Parse(Str(e.P("rrule")))),
        "thirteen" => RepeatRule.Of(ReadThirteenRule(e.P("rule"))),
        "dates" => RepeatRule.Dates,
        "foreign" => RepeatRule.Foreign(e.A("rules").Select(ReadEndedRule).ToValueList(), e.A("exrules").Select(ReadEndedRule).ToValueList()),
        var kind => throw new InvalidDataException($"Unknown rule kind {kind}"),
    };

    public static ExtraDate ReadExtraDate(JsonElement e) =>
        e.ValueKind == JsonValueKind.String ? new ExtraDate(Date(e)) : new ExtraDate(Date(e.P("date")), OptInt(e.P("minute")), IsNull(e.P("durationMinutes")) ? null : Long(e.P("durationMinutes")));

    public static OriginalDate ReadOriginalDate(JsonElement e) =>
        e.ValueKind == JsonValueKind.String ? new OriginalDate(Date(e)) : new OriginalDate(Date(e.P("date")), OptInt(e.P("minute")));

    public static ValueList<OriginalDate> ReadOriginalDates(JsonElement e) => e.EnumerateArray().Select(ReadOriginalDate).ToValueList();

    public static EventRecurrence ReadRecurrence(JsonElement e) => new(
        ReadRule(e.P("rule")),
        ReadEnd(e.P("end")),
        e.A("extraDates").Select(ReadExtraDate).ToValueList(),
        ReadOriginalDates(e.P("exceptDates")));

    public static EventRecurrence? ReadOptRecurrence(JsonElement e) => IsNull(e) ? null : ReadRecurrence(e);

    public static Alarm ReadAlarm(JsonElement e) => Str(e.P("kind")) switch
    {
        "relative" => Alarm.Relative(Int(e.P("offsetMinutes"))),
        "absolute" => Alarm.Absolute(Local(e.P("at"))),
        var kind => throw new InvalidDataException($"Unknown alarm kind {kind}"),
    };

    public static EventDraft ReadDraft(JsonElement e) => new()
    {
        Title = Str(e.P("title")),
        Location = Str(e.P("location")),
        Notes = Str(e.P("notes")),
        Url = Str(e.P("url")),
        AllDay = Bool(e.P("allDay")),
        Start = Local(e.P("start")),
        End = Local(e.P("end")),
        TimeZone = OptStr(e.P("timeZone")),
        CalendarId = Str(e.P("calendarId")),
        Recurrence = ReadOptRecurrence(e.P("recurrence")),
        Alarms = e.A("alarms").Select(ReadAlarm).ToValueList(),
        Availability = Raw<Availability>(e.P("availability"), ModelText.RawValue),
    };

    public static CalendarInfo ReadCalendar(JsonElement e) => new(
        Str(e.P("id")),
        Str(e.P("title")),
        Str(e.P("color")),
        Str(e.P("accountId")),
        Str(e.P("accountTitle")),
        Raw<CalendarAccountKind>(e.P("accountKind"), ModelText.RawValue),
        Bool(e.P("writable")),
        Raw<ThirteenRepeats>(e.P("thirteenRepeats"), ModelText.RawValue),
        OptInt(e.P("maxAlarms")),
        Bool(e.P("supportsAvailability")),
        Bool(e.P("supportsUrl")),
        Bool(e.P("isPlatformDefault")));

    private static StoredRule ReadStoredRule(JsonElement e) => new(RRule.Parse(Str(e.P("rrule"))), OptLocal(e.P("until")));

    public static RecognitionInput ReadRecognitionInput(JsonElement e) => new(
        Local(e.P("start")),
        e.A("rrules").Select(ReadStoredRule).ToValueList(),
        e.A("exrules").Select(ReadStoredRule).ToValueList(),
        e.A("rdates").Select(ReadExtraDate).ToValueList(),
        ReadOriginalDates(e.P("exdates")),
        OptStr(e.P("marker")));

    private static OverrideInput ReadOverride(JsonElement e) => new(
        Str(e.P("id")),
        Date(e.P("originalDate")),
        OptInt(e.P("originalMinute")),
        Bool(e.P("canceled")),
        Bool(e.P("allDay")),
        Local(e.P("start")),
        Local(e.P("end")),
        OptStr(e.P("zone")));

    public static SeriesInput ReadSeries(JsonElement e) => new(
        Str(e.P("id")),
        ReadOptRecurrence(e.P("recurrence")),
        Bool(e.P("allDay")),
        Local(e.P("start")),
        Local(e.P("end")),
        OptStr(e.P("zone")),
        e.A("overrides").Select(ReadOverride).ToValueList(),
        IsNull(e.P("duration")) ? null : new SeriesDuration(Int(e.P("duration").P("days")), Long(e.P("duration").P("minutes"))));

    public static EventOccurrence ReadOccurrence(JsonElement e) => new(
        Str(e.P("key")),
        Str(e.P("calendarId")),
        Str(e.P("title")),
        Bool(e.P("allDay")),
        Local(e.P("start")),
        Local(e.P("end")));

    public static EventOccurrence[] ReadOccurrences(JsonElement e) => e.EnumerateArray().Select(ReadOccurrence).ToArray();

    // ---- Writers: helpers ----------------------------------------------------------------------

    public static JsonObject Obj(params (string Name, JsonNode? Value)[] fields)
    {
        var o = new JsonObject();
        foreach (var (name, value) in fields) o[name] = value;
        return o;
    }

    public static JsonArray Arr<T>(IEnumerable<T> items, Func<T, JsonNode?> write) => new([.. items.Select(write)]);

    public static JsonArray Ints(IEnumerable<int> items) => Arr(items, i => (JsonNode)i);

    public static JsonArray Strs(IEnumerable<string> items) => Arr(items, s => (JsonNode)s);

    public static JsonNode DateJson(GregorianDate date) => date.ToIsoString();

    public static JsonNode? OptDateJson(GregorianDate? date) => date is { } d ? DateJson(d) : null;

    public static JsonNode LocalJson(LocalDateTime value) => value.ToString();

    public static JsonNode? OptLocalJson(LocalDateTime? value) => value is { } v ? LocalJson(v) : null;

    // ---- Writers: events types -----------------------------------------------------------------

    public static JsonObject UntilJson(RRuleUntil until) => until switch
    {
        RRuleUntil.DateUntil d => Obj(("kind", "date"), ("date", DateJson(d.Date))),
        RRuleUntil.FloatingUntil f => Obj(("kind", "floating"), ("value", LocalJson(f.Value))),
        RRuleUntil.UtcUntil u => Obj(("kind", "utc"), ("value", LocalJson(u.Value))),
        _ => throw new InvalidOperationException("Unknown until"),
    };

    public static JsonObject RRuleJson(RRule rule) => Obj(
        ("freq", rule.Freq.RawValue()),
        ("interval", rule.Interval),
        ("count", rule.Count),
        ("until", rule.Until is null ? null : UntilJson(rule.Until)),
        ("bySecond", Ints(rule.BySecond)),
        ("byMinute", Ints(rule.ByMinute)),
        ("byHour", Ints(rule.ByHour)),
        ("byDay", Arr(rule.ByDay, d => Obj(("weekday", (int)d.Weekday), ("ordinal", d.Ordinal)))),
        ("byMonthDay", Ints(rule.ByMonthDay)),
        ("byYearDay", Ints(rule.ByYearDay)),
        ("byWeekNo", Ints(rule.ByWeekNo)),
        ("byMonth", Ints(rule.ByMonth)),
        ("bySetPos", Ints(rule.BySetPos)),
        ("wkst", rule.Wkst is { } w ? (int)w : null),
        ("rscale", rule.Rscale),
        ("skip", rule.Skip),
        ("extensions", Arr(rule.Extensions, x => new JsonArray(x.Name, x.Value))));

    public static JsonObject EndJson(RepeatEnd end) => end switch
    {
        RepeatEnd.CountEnd c => Obj(("kind", "count"), ("count", c.Count)),
        RepeatEnd.UntilEnd u => Obj(("kind", "until"), ("date", DateJson(u.Date))),
        _ => Obj(("kind", "never")),
    };

    public static JsonObject ThirteenRuleJson(ThirteenRule rule) => rule switch
    {
        ThirteenRule.Monthly m => Obj(("kind", "monthly"), ("system", m.System.RawValue()), ("day", m.Day)),
        ThirteenRule.Weekly w => Obj(("kind", "weekly"), ("system", w.System.RawValue()), ("weekday", (int)w.Weekday), ("interval", w.Interval)),
        ThirteenRule.Yearly y => Obj(("kind", "yearly"), ("system", y.System.RawValue()), ("month", y.Month), ("day", y.Day)),
        ThirteenRule.Intercalary i => Obj(("kind", "intercalary"), ("system", i.System.RawValue()), ("id", i.Id.RawValue())),
        _ => throw new InvalidOperationException("Unknown 13-month rule"),
    };

    public static JsonNode? OptThirteenRuleJson(ThirteenRule? rule) => rule is null ? null : ThirteenRuleJson(rule);

    private static JsonObject EndedRuleJson(EndedRule rule) => Obj(("rrule", rule.RRule.ToString()), ("end", EndJson(rule.End)));

    public static JsonObject RuleJson(RepeatRule rule) => rule switch
    {
        RepeatRule.RRuleRepeat r => Obj(("kind", "rrule"), ("rrule", r.RRule.ToString())),
        RepeatRule.ThirteenRepeat t => Obj(("kind", "thirteen"), ("rule", ThirteenRuleJson(t.Rule))),
        RepeatRule.DatesRepeat => Obj(("kind", "dates")),
        RepeatRule.ForeignRepeat f => Obj(("kind", "foreign"), ("rules", Arr(f.Rules, EndedRuleJson)), ("exrules", Arr(f.Exrules, EndedRuleJson))),
        _ => throw new InvalidOperationException("Unknown rule"),
    };

    public static JsonNode ExtraDateJson(ExtraDate x) =>
        x.Minute is null && x.DurationMinutes is null
            ? DateJson(x.Date)
            : Obj(("date", DateJson(x.Date)), ("minute", x.Minute), ("durationMinutes", x.DurationMinutes));

    public static JsonNode OriginalDateJson(OriginalDate x) => x.Minute is null ? DateJson(x.Date) : Obj(("date", DateJson(x.Date)), ("minute", x.Minute));

    public static JsonObject RecurrenceJson(EventRecurrence r) => Obj(
        ("rule", RuleJson(r.Rule)),
        ("end", EndJson(r.End)),
        ("extraDates", Arr(r.ExtraDates, ExtraDateJson)),
        ("exceptDates", Arr(r.ExceptDates, OriginalDateJson)));

    public static JsonNode? OptRecurrenceJson(EventRecurrence? r) => r is null ? null : RecurrenceJson(r);

    public static JsonObject AlarmJson(Alarm alarm) => alarm switch
    {
        Alarm.RelativeAlarm r => Obj(("kind", "relative"), ("offsetMinutes", r.OffsetMinutes)),
        Alarm.AbsoluteAlarm a => Obj(("kind", "absolute"), ("at", LocalJson(a.At))),
        _ => throw new InvalidOperationException("Unknown alarm"),
    };

    public static JsonObject DraftJson(EventDraft d) => Obj(
        ("title", d.Title),
        ("location", d.Location),
        ("notes", d.Notes),
        ("url", d.Url),
        ("allDay", d.AllDay),
        ("start", LocalJson(d.Start)),
        ("end", LocalJson(d.End)),
        ("timeZone", d.TimeZone),
        ("calendarId", d.CalendarId),
        ("recurrence", OptRecurrenceJson(d.Recurrence)),
        ("alarms", Arr(d.Alarms, AlarmJson)),
        ("availability", d.Availability.RawValue()));

    public static JsonArray FieldsJson(IEnumerable<DraftField> fields) => Strs(fields.Select(f => f.RawValue()));

    public static JsonObject ExceptionMapJson(ExceptionMap map) =>
        Obj(("from", OriginalDateJson(map.From)), ("to", map.To is { } to ? OriginalDateJson(to) : null));

    public static JsonObject SplitResultJson(SplitResult s) => Obj(
        ("head", OptRecurrenceJson(s.Head)),
        ("tail", OptRecurrenceJson(s.Tail)),
        ("overrides", Arr(s.Overrides, ExceptionMapJson)),
        ("droppedCount", s.DroppedCount),
        ("dropped", s.Dropped));

    public static JsonObject RetimeResultJson(RetimeResult r) => Obj(
        ("recurrence", RecurrenceJson(r.Recurrence)),
        ("overrides", Arr(r.Overrides, ExceptionMapJson)),
        ("untils", Arr(r.Untils, u => Obj(("rule", u.Rule.RawValue()), ("index", u.Index), ("endDate", DateJson(u.EndDate))))),
        ("droppedCount", r.DroppedCount),
        ("dropped", r.Dropped));

    public static JsonObject RecognitionJson(Recognition r) => Obj(
        ("recurrence", RecurrenceJson(r.Recurrence)),
        ("source", r.Source.RawValue()),
        ("editable", r.Editable),
        ("alternatives", Arr(r.Alternatives, ThirteenRuleJson)),
        ("openEnded", r.OpenEnded),
        ("series", r.Series),
        ("part", r.Part));

    public static JsonObject PresetJson(RepeatPreset p) => Obj(
        ("id", p.Id),
        ("section", p.Section.RawValue()),
        ("label", p.Label),
        ("exchangeSafe", p.ExchangeSafe),
        ("recurrence", OptRecurrenceJson(p.Recurrence)));

    public static JsonObject ExpandedOccurrenceJson(ExpandedOccurrence o) => Obj(
        ("originalDate", DateJson(o.OriginalDate)),
        ("originalMinute", o.OriginalMinute),
        ("overrideId", o.OverrideId),
        ("allDay", o.AllDay),
        ("start", LocalJson(o.Start)),
        ("end", LocalJson(o.End)),
        ("startUtc", OptLocalJson(o.StartUtc)));

    // ---- Writers: layouts ----------------------------------------------------------------------

    public static JsonObject ThirteenJson(ThirteenDate date) => date switch
    {
        ThirteenMonthDate m => Obj(("kind", "month"), ("system", m.System.RawValue()), ("year", m.Year), ("month", m.Month), ("day", m.Day)),
        ThirteenIntercalaryDate i => Obj(("kind", "intercalary"), ("system", i.System.RawValue()), ("year", i.Year), ("id", i.Id.RawValue())),
        _ => throw new InvalidOperationException("Unknown 13-month date"),
    };

    public static JsonObject MonthItemJson(MonthItem item) => Obj(
        ("key", item.Key),
        ("style", item.Style == MonthItemStyle.Bar ? "bar" : "dot"),
        ("startColumn", item.StartColumn),
        ("endColumn", item.EndColumn),
        ("lane", item.Lane),
        ("continuesBefore", item.ContinuesBefore),
        ("continuesAfter", item.ContinuesAfter));

    public static JsonObject MonthLayoutJson(ThirteenMonthEventLayout layout) => Obj(
        ("year", layout.Year),
        ("month", layout.Month),
        ("system", layout.System.RawValue()),
        ("columnGregorianWeekdays", Ints(layout.ColumnGregorianWeekdays.Select(w => (int)w))),
        ("weeks", Arr(layout.Weeks, row => Obj(
            ("week", row.Week),
            ("items", Arr(row.Items, MonthItemJson)),
            ("visibleLanes", Ints(row.VisibleLanes)),
            ("hidden", Ints(row.Hidden))))),
        ("intercalary", Arr(layout.Intercalary, band => Obj(
            ("id", band.Id.RawValue()),
            ("gregorian", DateJson(band.Gregorian)),
            ("items", Arr(band.Items, MonthItemJson)),
            ("visibleLanes", band.VisibleLanes),
            ("hidden", band.Hidden)))));

    public static JsonObject TimedItemJson(TimedItem t) => Obj(
        ("key", t.Key),
        ("column", t.Column),
        ("startMinute", t.StartMinute),
        ("endMinute", t.EndMinute),
        ("clippedStart", t.ClippedStart),
        ("clippedEnd", t.ClippedEnd),
        ("slot", t.Slot),
        ("slotCount", t.SlotCount),
        ("hidden", t.Hidden));

    public static JsonObject TimedOverflowJson(TimedOverflow o) => Obj(
        ("column", o.Column),
        ("slot", o.Slot),
        ("slotCount", o.SlotCount),
        ("startMinute", o.StartMinute),
        ("endMinute", o.EndMinute),
        ("keys", Strs(o.Keys)));

    public static JsonObject WeekLayoutJson(WeekEventLayout layout) => Obj(
        ("columns", Arr(layout.Columns, c => Obj(("kind", c.Kind), ("gregorian", DateJson(c.Gregorian)), ("thirteen", ThirteenJson(c.Thirteen))))),
        ("allDay", Arr(layout.AllDay, MonthItemJson)),
        ("timed", Arr(layout.Timed, TimedItemJson)),
        ("overflow", Arr(layout.Overflow, TimedOverflowJson)));

    public static JsonObject DayLayoutJson(DayEventLayout layout) => Obj(
        ("allDay", Strs(layout.AllDay)),
        ("timed", Arr(layout.Timed, TimedItemJson)),
        ("overflow", Arr(layout.Overflow, TimedOverflowJson)));

    private static string PartText(AgendaPart part) => part switch
    {
        AgendaPart.Single => "single",
        AgendaPart.First => "first",
        AgendaPart.Middle => "middle",
        _ => "last",
    };

    public static JsonArray AgendaJson(IEnumerable<AgendaDay> days) => Arr(days, day => Obj(
        ("gregorian", DateJson(day.Gregorian)),
        ("thirteen", ThirteenJson(day.Thirteen)),
        ("items", Arr(day.Items, item => Obj(
            ("key", item.Key),
            ("part", PartText(item.Part)),
            ("dayIndex", item.DayIndex),
            ("dayCount", item.DayCount),
            ("startMinute", item.StartMinute),
            ("endMinute", item.EndMinute))))));

    public static JsonArray YearMarksJson(IEnumerable<YearMark> marks) => Arr(marks, mark => Obj(
        ("dayOfYear", mark.DayOfYear),
        ("gregorian", DateJson(mark.Gregorian)),
        ("count", mark.Count),
        ("calendarIds", Strs(mark.CalendarIds))));
}
