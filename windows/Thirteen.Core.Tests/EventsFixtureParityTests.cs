using System.Text.Json;
using System.Text.Json.Nodes;
using Thirteen.Core.Events;
using Thirteen.Core.Tests.Support;
using Xunit.Abstractions;
using static Thirteen.Core.Tests.Support.EventsJson;

namespace Thirteen.Core.Tests;

/// <summary>
/// Golden parity with @thirteen/core's events engine: every section of fixtures/events.json (version 1,
/// docs/EVENTS.md §5.5), replayed from the JSON alone as packages/core/test/events/*.test.ts do. Results are
/// written in the fixture's JSON form and compared key for key (same keys in the same order, explicit
/// nulls). The envelope must list exactly the known sections and every <c>counts</c> entry is asserted,
/// so an unknown, missing or truncated section fails the run.
///
/// Zone data: <c>zones</c> runs through <see cref="TimeZoneInfoZoneResolver"/> (the platform's IANA data);
/// <c>zoneMath</c> through each case's synthetic table; <c>untils</c>, <c>series</c> and
/// <c>alarmInstants</c> through <see cref="RecordedZoneResolver"/> over <c>zoneOffsets</c> alone.
///
/// Not implemented in C# (docs/EVENTS.md §5.7, "Swift and C#"): the <c>dateLists</c> section (the .ics
/// module's <c>parseDateList</c> / <c>formatDateList</c>) and the <c>parts</c> field of <c>thirteenRules</c>
/// (<c>thirteenRuleRdateParts</c>). Their counts and shapes are still asserted.
/// </summary>
public sealed class EventsFixtureParityTests(ITestOutputHelper output)
{
    /// <summary>Sections and fields this port lists as not implemented (§5.7), with the reason.</summary>
    public static readonly IReadOnlyDictionary<string, string> NotImplemented = new Dictionary<string, string>
    {
        ["dateLists"] = "parseDateList / formatDateList belong to the .ics module, not ported to C# (§5.7)",
        ["thirteenRules.parts"] = "thirteenRuleRdateParts is Android only, not ported to C# (§5.7)",
    };

    private static readonly string[] EnvelopeKeys = ["version", "complete", "generatedBy", "spec", "tzVersion", "counts"];

    // ---- Envelope ----------------------------------------------------------------------------

    [Fact]
    public void Envelope_IsVersion1_Complete_WithExactlyTheKnownSections_AndEveryCount()
    {
        var root = EventsFixture.Root;
        Assert.Equal(1, root.GetProperty("version").GetInt32());
        Assert.True(root.GetProperty("complete").GetBoolean());
        Assert.Equal("@thirteen/core", root.GetProperty("generatedBy").GetString());
        Assert.Equal("docs/EVENTS.md", root.GetProperty("spec").GetString());
        var tzVersion = root.GetProperty("tzVersion").GetString()!;
        Assert.Matches("^[0-9]{4}[a-z]$", tzVersion);

        // Unknown sections fail: the file is complete, so the key list is exact.
        var names = EventsFixture.Sections.Select(s => s.Name).ToArray();
        Assert.Equal([.. EnvelopeKeys, .. names], root.EnumerateObject().Select(p => p.Name).ToArray());

        var counts = root.GetProperty("counts");
        Assert.Equal(names, counts.EnumerateObject().Select(p => p.Name).ToArray());
        foreach (var (name, expected) in EventsFixture.Sections)
        {
            Assert.True(counts.GetProperty(name).GetInt32() == expected, $"counts.{name}: {counts.GetProperty(name).GetInt32()}, expected {expected}");
            Assert.True(EventsFixture.Cases(name).Length == expected, $"{name}: {EventsFixture.Cases(name).Length} cases, expected {expected}");
        }
        output.WriteLine($"Fixture {EventsFixture.Path}: {names.Length} sections, {EventsFixture.Sections.Sum(s => s.Count)} cases, tzVersion {tzVersion}, culture '{System.Globalization.CultureInfo.CurrentCulture.Name}'");
    }

    [Fact]
    public void EveryDocumentedSection_IsReplayed_OrListedAsNotImplemented()
    {
        var replayed = typeof(EventsFixtureParityTests).GetMethods()
            .Where(m => m.GetCustomAttributes(typeof(FactAttribute), false).Length > 0 && m.Name.StartsWith("Section_", StringComparison.Ordinal))
            .Select(m => m.Name["Section_".Length..].Split('_')[0])
            .ToHashSet(StringComparer.Ordinal);
        foreach (var (name, _) in EventsFixture.Sections)
        {
            Assert.True(replayed.Contains(name, StringComparer.OrdinalIgnoreCase), $"No Section_{name} test");
        }
    }

    [Fact]
    public void Fixture_HasNoEnOrEmDash()
    {
        Assert.DoesNotContain('\u2013', EventsFixture.Text);
        Assert.DoesNotContain('\u2014', EventsFixture.Text);
    }

    // ---- Helpers -----------------------------------------------------------------------------

    /// <summary>Replays every case of a section, collecting mismatches and unexpected exceptions.</summary>
    private void Replay(string section, Action<JsonElement, string, Mismatches> body)
    {
        var cases = EventsFixture.Cases(section);
        var expected = EventsFixture.Sections.Single(s => s.Name == section).Count;
        Assert.Equal(expected, cases.Length);
        var m = new Mismatches();
        for (var i = 0; i < cases.Length; i++)
        {
            var label = $"{section}[{i}]";
            try
            {
                body(cases[i], label, m);
            }
            catch (Exception error)
            {
                m.Check(false, $"{label}: unexpected {error.GetType().Name}: {error.Message}\n    {Short(cases[i])}");
            }
        }
        output.WriteLine($"{section}: {cases.Length} cases replayed, {m.Count} mismatch(es)");
        m.AssertNone(section);
    }

    /// <summary>The value, or null when the engine rejects the input (TS <c>attempt</c>, RangeError as <see cref="ThirteenException"/>).</summary>
    private static T? Attempt<T>(Func<T> run) where T : class
    {
        try
        {
            return run();
        }
        catch (ThirteenException)
        {
            return null;
        }
    }

    private static JsonNode? AttemptNode(Func<JsonNode?> run)
    {
        try
        {
            return run();
        }
        catch (ThirteenException)
        {
            return null;
        }
    }

    private static bool Throws(Action run)
    {
        try
        {
            run();
            return false;
        }
        catch (ThirteenException)
        {
            return true;
        }
    }

    private static JsonArray DatesJson(IEnumerable<GregorianDate> dates) => Arr(dates, d => DateJson(d));

    // ---- C1: time, zone math, drafts, alarms ------------------------------------------------------

    [Fact]
    public void Section_LocalDateTimes() => Replay("localDateTimes", (c, label, m) =>
    {
        var valid = LocalDateTime.TryParse(Str(c.P("text")), out var parsed);
        m.Json(Obj(("valid", valid), ("formatted", valid ? LocalJson(parsed) : null)), Expected(c, "valid", "formatted"), label);
    });

    [Fact]
    public void Section_EndForms() => Replay("endForms", (c, label, m) =>
    {
        var start = Local(c.P("start"));
        var end = Local(c.P("end"));
        m.Json(AttemptNode(() => LocalJson(EventTime.NormalizeEnd(start, end))), c.P("normalized"), $"{label} normalized");
        m.Json(AttemptNode(() => DatesJson(EventTime.OccurrenceDays(start, end))), c.P("days"), $"{label} days");
        m.Json(AttemptNode(() => LocalJson(EventTime.DisplayEnd(end))), c.P("display"), $"{label} display");
    });

    [Fact]
    public void Section_WallClock() => Replay("wallClock", (c, label, m) =>
    {
        var from = Local(c.P("from"));
        if (!c.P("minutes").TryGetInt64(out var minutes))
        {
            // A non-integer minute count (1.5) is rejected by TypeScript; C# cannot pass one.
            m.Check(IsNull(c.P("expected")), $"{label}: non-integer minutes {c.P("minutes").GetRawText()} must expect a rejection");
            return;
        }
        m.Json(AttemptNode(() => LocalJson(EventTime.AddMinutesLocal(from, minutes))), c.P("expected"), label);
    });

    [Fact]
    public void Section_ZoneMath() => Replay("zoneMath", (c, label, m) =>
    {
        var zone = c.P("zone");
        var zones = new SyntheticZoneResolver(zone);
        var name = Str(zone.P("name"));
        var result = c.TryGetProperty("local", out var local)
            ? ZoneMath.ToUtc(Local(local), name, zones)
            : ZoneMath.ToZoned(Local(c.P("utc")), name, zones);
        m.Json(OptLocalJson(result), c.P("expected"), $"{label} {name} {(c.TryGetProperty("local", out var l) ? "local " + Str(l) : "utc " + Str(c.P("utc")))}");
    });

    [Fact]
    public void Section_Drafts() => Replay("drafts", (c, label, m) =>
    {
        EventDraft draft;
        try
        {
            draft = ReadDraft(c.P("draft"));
        }
        catch (UnrepresentableException)
        {
            // COUNT=2.5: TypeScript reports count-out-of-range; RepeatEnd.AfterCount takes an int.
            m.Json(Strs(["count-out-of-range"]), c.P("issues"), $"{label} (non-integer count, not representable)");
            return;
        }
        var issues = Drafts.Validate(draft, ReadCalendar(c.P("calendar")));
        m.Json(Strs(issues.Select(i => i.RawValue())), c.P("issues"), label);
    });

    [Fact]
    public void Section_NewDrafts() => Replay("newDrafts", (c, label, m) =>
    {
        var draft = Drafts.New(Date(c.P("day")), Local(c.P("now")), "home", Bool(c.P("allDay")));
        m.Json(DraftJson(draft), c.P("expected"), label);
    });

    [Fact]
    public void Section_Merges() => Replay("merges", (c, label, m) =>
    {
        var result = DraftMerge.Merge(ReadDraft(c.P("original")), ReadDraft(c.P("edited")), ReadDraft(c.P("current")));
        m.Json(Obj(("merged", DraftJson(result.Merged)), ("written", FieldsJson(result.Written)), ("conflicts", FieldsJson(result.Conflicts))), c.P("expected"), label);
    });

    [Fact]
    public void Section_SeriesEdits() => Replay("seriesEdits", (c, label, m) =>
    {
        var result = DraftMerge.ApplyToSeries(
            ReadDraft(c.P("master")),
            ReadDraft(c.P("opened")),
            ReadDraft(c.P("edited")),
            IsNull(c.P("override")) ? null : ReadDraft(c.P("override")));
        var retime = result.Retime is null
            ? null
            : Obj(("minuteDelta", result.Retime.MinuteDelta), ("allDay", result.Retime.AllDay is { } a ? a.RawValue() : null));
        m.Json(Obj(
            ("master", DraftJson(result.Master)),
            ("override", result.Override is null ? null : DraftJson(result.Override)),
            ("written", FieldsJson(result.Written)),
            ("retime", retime)), c.P("expected"), label);
    });

    [Fact]
    public void Section_Alarms() => Replay("alarms", (c, label, m) =>
    {
        var presets = Alarm.Presets(Bool(c.P("allDay")), Bool(c.P("allowAfterStart")), Bool(c.P("use24Hour")));
        m.Json(Arr(presets, p => Obj(("id", p.Id), ("label", p.Label), ("alarm", p.Alarm is null ? null : AlarmJson(p.Alarm)))), c.P("presets"), label);
    });

    [Fact]
    public void Section_AlarmInstants() => Replay("alarmInstants", (c, label, m) =>
    {
        var zones = EventsFixture.Recorded;
        var occurrence = c.P("occurrence");
        var allDay = Bool(occurrence.P("allDay"));
        var start = Local(occurrence.P("start"));
        var startUtc = OptLocal(occurrence.P("startUtc"));
        var deviceZone = Str(c.P("deviceZone"));
        if (!allDay) m.Json(OptLocalJson(ZoneMath.ToUtc(start, deviceZone, zones)), occurrence.P("startUtc"), $"{label} startUtc");
        var fire = Alarm.FireTime(ReadAlarm(c.P("alarm")), allDay, start, startUtc, deviceZone, zones);
        m.Json(OptLocalJson(fire), c.P("expected"), label);
    });

    // ---- C2: RRULE text, equality, UNTIL; date lists ------------------------------------------------

    [Fact]
    public void Section_RRules() => Replay("rrules", (c, label, m) =>
    {
        var text = Str(c.P("text"));
        m.Json(RRule.TryParse(text, out var parsed) ? RRuleJson(parsed) : null, c.P("parsed"), $"{label} {text}");
        var formatted = IsNull(c.P("parsed")) ? null : ReadRRule(c.P("parsed")).ToString();
        m.Json(formatted, c.P("formatted"), $"{label} formatted");
    });

    [Fact]
    public void Section_RRuleEquality() => Replay("rruleEquality", (c, label, m) =>
    {
        var equal = RRule.Parse(Str(c.P("a"))).IsEquivalentTo(RRule.Parse(Str(c.P("b"))), Bool(c.P("ignoreEnd")), Bool(c.P("ignoreWkst")));
        m.Equal(Bool(c.P("equal")), equal, $"{label} {Str(c.P("a"))} vs {Str(c.P("b"))}");
    });

    [Fact]
    public void Section_Untils() => Replay("untils", (c, label, m) =>
    {
        var zones = EventsFixture.Recorded;
        var zone = OptStr(c.P("zone"));
        var inZone = Until.InZone(ReadUntil(c.P("until")), zone, zones);
        m.Json(OptLocalJson(inZone), c.P("inZone"), $"{label} inZone");
        var endDate = inZone is { } value ? AttemptNode(() => DateJson(Until.EndDate(value, Int(c.P("startMinute"))))) : null;
        m.Json(endDate, c.P("endDate"), $"{label} endDate");
        var text = IsNull(c.P("endDate")) ? null : Until.Format(Date(c.P("endDate")), Bool(c.P("allDay")), zone, zones);
        m.Json(text, c.P("text"), $"{label} text");
    });

    [Fact]
    public void Section_DateLists_NotImplemented_ShapeAndCountOnly()
    {
        // §5.7: Swift and C# list dateLists as not implemented (the .ics module's date list text forms).
        Assert.True(NotImplemented.ContainsKey("dateLists"));
        var cases = EventsFixture.Cases("dateLists");
        Assert.Equal(26, cases.Length);
        foreach (var c in cases) Assert.Equal(["text", "parsed", "form", "formatted"], c.EnumerateObject().Select(p => p.Name).ToArray());
        output.WriteLine($"dateLists: {cases.Length} cases, not implemented in C#: {NotImplemented["dateLists"]}");
    }

    // ---- C3: 13-month rules ------------------------------------------------------------------------

    [Fact]
    public void Section_ThirteenRules() => Replay("thirteenRules", (c, label, m) =>
    {
        var rule = ReadThirteenRule(c.P("rule"));
        var start = Date(c.P("start"));
        label = $"{label} {Str(c.P("marker"))} from {start}";
        m.Json(ThirteenRuleJson(rule), c.P("rule"), $"{label} rule round trip");
        foreach (var d in c.A("datesIn"))
        {
            m.Json(DatesJson(rule.DatesInYear(Int(d.P("year")), start)), d.P("dates"), $"{label} datesIn {Int(d.P("year"))}");
        }

        var encoding = rule.Encode(start);
        var expectedEncoding = c.P("encoding");
        m.Check(encoding.RRule == RRule.Parse(Str(expectedEncoding.P("rrule"))), $"{label}: encoding rrule differs from the parsed fixture rule");
        m.Json(Obj(
            ("form", encoding.Form.RawValue()),
            ("rrule", encoding.RRule.ToString()),
            ("exchangeSafe", encoding.ExchangeSafe),
            ("cap", OptDateJson(encoding.Cap))), expectedEncoding, $"{label} encoding");

        var marker = Str(c.P("marker"));
        m.Equal(marker, rule.ToMarkerText(), $"{label} marker");
        m.Check(ThirteenRule.ParseMarkerText(marker) == rule, $"{label}: ParseMarkerText({marker}) != rule");

        var uri = c.P("uri");
        var end = ReadEnd(uri.P("end"));
        var series = OptStr(uri.P("series"));
        var part = OptInt(uri.P("part"));
        m.Equal(Str(uri.P("text")), rule.ToUri(end, new RuleUriExtras(series, part)), $"{label} uri");
        m.Equal(new ThirteenRuleUri(rule, end, series, part), ThirteenRule.ParseUri(Str(uri.P("text"))), $"{label} parsed uri");

        var rdates = c.P("rdates");
        var (dates, truncated) = rule.Rdates(start, ReadEnd(rdates.P("end")), Date(rdates.P("horizon")));
        m.Json(Obj(("dates", DatesJson(dates)), ("truncated", truncated)), Expected(rdates, "dates", "truncated"), $"{label} rdates");
        m.Json(EndJson(ReadEnd(rdates.P("end"))), rdates.P("end"), $"{label} rdates end round trip");

        // `parts` (thirteenRuleRdateParts) is listed as not implemented (§5.7).

        var detached = c.P("detached");
        if (!IsNull(detached))
        {
            var original = Date(detached.P("original"));
            var detachedSeries = Str(detached.P("series"));
            m.Equal(Str(detached.P("text")), DetachedUri.Format(detachedSeries, original), $"{label} detached");
            var parsedDetached = DetachedUri.Parse(Str(detached.P("text")));
            m.Check(parsedDetached is { } p && p.Series == detachedSeries && p.Original == original, $"{label}: parsed detached {parsedDetached}");
        }

        m.Check(rule.Includes(start, start), $"{label}: does not include its start");
        foreach (var d in rdates.A("dates")) m.Check(rule.Includes(Date(d), start), $"{label}: does not include RDATE {Str(d)}");
    });

    [Fact]
    public void Section_RuleFromStart() => Replay("ruleFromStart", (c, label, m) =>
    {
        if (!ThirteenRuleText.TryParseKind(Str(c.P("kind")), out var kind)) throw new InvalidDataException($"Unknown kind {Str(c.P("kind"))}");
        var rule = ThirteenRule.For(kind, Date(c.P("start")), SystemId(c.P("system")));
        m.Json(OptThirteenRuleJson(rule), c.P("rule"), $"{label} {Str(c.P("kind"))} {Str(c.P("start"))} {Str(c.P("system"))}");
    });

    // ---- C4: recurrence --------------------------------------------------------------------------

    [Fact]
    public void Section_Expansions() => Replay("expansions", (c, label, m) =>
    {
        var recurrence = ReadRecurrence(c.P("recurrence"));
        var window = new ExpansionWindow(Date(c.P("window").P("from")), Date(c.P("window").P("to")));
        var limit = OptInt(c.P("limit")) ?? EventRecurrence.DefaultLimit;
        var result = recurrence.Expand(Date(c.P("start")), window, limit);
        m.Json(Arr(result.Occurrences, ExtraDateJson), c.P("occurrences"), $"{label} occurrences");
        m.Json(Obj(("truncated", result.Truncated), ("unsupported", result.Unsupported)), Expected(c, "truncated", "unsupported"), label);
    });

    [Fact]
    public void Section_EndBefore() => Replay("endBefore", (c, label, m) =>
    {
        var recurrence = ReadRecurrence(c.P("recurrence"));
        var start = Date(c.P("start"));
        var date = Date(c.P("date"));
        m.Json(OptRecurrenceJson(recurrence.EndBefore(start, date)), c.P("expected"), $"{label} head");
        m.Json(recurrence.LaterCount(start, date), c.P("later"), $"{label} later");
    });

    [Fact]
    public void Section_Splits() => Replay("splits", (c, label, m) =>
    {
        var recurrence = ReadRecurrence(c.P("recurrence"));
        var change = c.P("change");
        var splitChange = IsNull(change)
            ? null
            : new SplitChange(ReadOptRecurrence(change.P("recurrence")), Date(change.P("start")), Bool(change.P("ruleChanged")));
        SplitResult Run() => recurrence.Split(Date(c.P("start")), Date(c.P("at")), ReadOriginalDates(c.P("overrideDates")), splitChange);
        if (IsNull(c.P("expected"))) m.Check(Throws(() => Run()), $"{label}: expected a rejection");
        else m.Json(SplitResultJson(Run()), c.P("expected"), label);
    });

    [Fact]
    public void Section_Retimes() => Replay("retimes", (c, label, m) =>
    {
        var recurrence = ReadRecurrence(c.P("recurrence"));
        var allDay = IsNull(c.P("allDay")) ? (AllDayChange?)null : Raw<AllDayChange>(c.P("allDay"), RecurrenceText.RawValue);
        var result = recurrence.Retime(
            ReadOriginalDates(c.P("overrideDates")),
            Date(c.P("oldStart")),
            Date(c.P("newStart")),
            ReadRecurrence(c.P("newRecurrence")),
            IsNull(c.P("minuteDelta")) ? 0 : Long(c.P("minuteDelta")),
            allDay);
        m.Json(RetimeResultJson(result), c.P("expected"), label);
    });

    [Fact]
    public void Section_Recognitions() => Replay("recognitions", (c, label, m) =>
    {
        var recognition = Recognition.Of(ReadRecognitionInput(c.P("input")), SystemId(c.P("system")));
        m.Json(RecognitionJson(recognition), c.P("expected"), label);
    });

    [Fact]
    public void Section_Presets() => Replay("presets", (c, label, m) =>
    {
        var presets = RepeatPreset.All(Date(c.P("start")), SystemId(c.P("system")));
        m.Json(Arr(presets, PresetJson), c.P("presets"), $"{label} {Str(c.P("start"))} {Str(c.P("system"))}");
    });

    [Fact]
    public void Section_Descriptions() => Replay("descriptions", (c, label, m) =>
    {
        var text = ReadRecurrence(c.P("recurrence")).Describe(Date(c.P("start")), SystemId(c.P("system")));
        m.Equal(Str(c.P("text")), text, label);
    });

    [Fact]
    public void Section_NextOccurrences() => Replay("nextOccurrences", (c, label, m) =>
    {
        var text = ReadRecurrence(c.P("recurrence")).DescribeNext(Date(c.P("start")), SystemId(c.P("system")), Int(c.P("count")));
        m.Equal(Str(c.P("text")), text, label);
    });

    [Fact]
    public void Section_RepeatNotes() => Replay("repeatNotes", (c, label, m) =>
    {
        var notes = ReadRecurrence(c.P("recurrence")).RepeatNotes(Date(c.P("start")), SystemId(c.P("system")), Bool(c.P("gregorianOnlyCalendar")));
        m.Json(Strs(notes), c.P("notes"), label);
    });

    [Fact]
    public void Section_Adaptations() => Replay("adaptations", (c, label, m) =>
    {
        var recurrence = ReadRecurrence(c.P("recurrence"));
        var oldStart = Date(c.P("oldStart"));
        var result = recurrence.AdaptToStart(oldStart, Date(c.P("newStart")));
        var expected = c.P("expected");
        m.Json(OptRecurrenceJson(result.Recurrence), expected.P("recurrence"), $"{label} recurrence");
        m.Equal(Str(expected.P("change")), result.Change.RawValue(), $"{label} change");
        if (!IsNull(expected.P("laterCount")))
        {
            m.Json(recurrence.LaterCount(oldStart, oldStart), expected.P("laterCount"), $"{label} laterCount");
        }
    });

    [Fact]
    public void Section_Series() => Replay("series", (c, label, m) =>
    {
        var series = ReadSeries(c.P("series"));
        var window = new DeviceWindow(Local(c.P("window").P("from")), Local(c.P("window").P("to")));
        var deviceZone = Str(c.P("deviceZone"));
        var result = SeriesExpansion.Expand(series, window, deviceZone, EventsFixture.Recorded);
        m.Json(Obj(
            ("occurrences", Arr(result.Occurrences, ExpandedOccurrenceJson)),
            ("orphans", Strs(result.Orphans)),
            ("outOfRange", result.OutOfRange)), c.P("expected"), $"{label} {series.Id} {deviceZone}");
    });

    // ---- C5: layout ------------------------------------------------------------------------------

    [Fact]
    public void Section_ChipTimes() => Replay("chipTimes", (c, label, m) =>
        m.Equal(Str(c.P("text")), ChipTime.Text(Int(c.P("minute")), Bool(c.P("use24Hour"))), label));

    [Fact]
    public void Section_MonthColumns() => Replay("monthColumns", (c, label, m) =>
    {
        var weekdays = MonthColumns.GregorianWeekdays(Int(c.P("year")), Int(c.P("month")), SystemId(c.P("system")));
        m.Json(Ints(weekdays.Select(w => (int)w)), c.P("weekdays"), label);
    });

    [Fact]
    public void Section_MonthLayouts() => Replay("monthLayouts", (c, label, m) =>
    {
        var layout = new ThirteenMonthEventLayout(Int(c.P("year")), Int(c.P("month")), ReadOccurrences(c.P("occurrences")), SystemId(c.P("system")), OptInt(c.P("maxLanes")));
        m.Json(MonthLayoutJson(layout), c.P("expected"), label);
    });

    [Fact]
    public void Section_WeekLayouts() => Replay("weekLayouts", (c, label, m) =>
    {
        var layout = new WeekEventLayout(Int(c.P("year")), Int(c.P("month")), Int(c.P("week")), ReadOccurrences(c.P("occurrences")), SystemId(c.P("system")), maxSlots: OptInt(c.P("maxSlots")));
        m.Json(WeekLayoutJson(layout), c.P("expected"), label);
    });

    [Fact]
    public void Section_DayLayouts() => Replay("dayLayouts", (c, label, m) =>
    {
        var layout = new DayEventLayout(Date(c.P("date")), ReadOccurrences(c.P("occurrences")), Int(c.P("minDurationMinutes")), OptInt(c.P("maxSlots")));
        m.Json(DayLayoutJson(layout), c.P("expected"), label);
    });

    [Fact]
    public void Section_Agendas() => Replay("agendas", (c, label, m) =>
    {
        var days = AgendaDay.Days(ReadOccurrences(c.P("occurrences")), Date(c.P("from")), Date(c.P("to")), SystemId(c.P("system")), Bool(c.P("includeEmptyDays")));
        m.Json(AgendaJson(days), c.P("expected"), label);
    });

    [Fact]
    public void Section_YearMarks() => Replay("yearMarks", (c, label, m) =>
    {
        var marks = YearMark.Marks(Int(c.P("year")), ReadOccurrences(c.P("occurrences")), Int(c.P("maxCalendars")));
        m.Json(YearMarksJson(marks), c.P("expected"), label);
    });

    // ---- Zones ---------------------------------------------------------------------------------

    /// <summary>
    /// Cases this platform's zone data cannot answer as tzdata does, by case id ("zone local|utc value"),
    /// with the reason (§5.5 "Zones"). macOS and Linux (TimeZoneInfo over the system tzdata): none.
    /// Windows (TimeZoneInfo over the registry zones; IANA ids mapped through ICU): the one below, checked on
    /// Windows 11 build 26200 with .NET 10.0.3. A listed case that starts answering as tzdata fails the test,
    /// so the list stays minimal.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> PlatformZoneExceptions = OperatingSystem.IsWindows()
        ? new Dictionary<string, string>
        {
            ["Pacific/Apia utc 2011-12-30T10:00"] =
                "Windows maps Pacific/Apia to the registry zone Samoa Standard Time, whose 2011 rule keeps UTC-10 to the end of " +
                "the year; tzdata moves Samoa across the date line at 2011-12-29T10:00Z (UTC+14), so Windows reads " +
                "2011-12-30T00:00 where tzdata reads 2011-12-31T00:00",
        }
        : new Dictionary<string, string>();

    [Fact]
    public void Section_Zones_ThroughTimeZoneInfo()
    {
        var zones = TimeZoneInfoZoneResolver.Shared;
        var cases = EventsFixture.Cases("zones");
        Assert.Equal(29, cases.Length);
        var m = new Mismatches();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var skipped = 0;
        foreach (var c in cases)
        {
            var zone = Str(c.P("zone"));
            var isLocal = c.TryGetProperty("local", out var local);
            var value = isLocal ? Str(local) : Str(c.P("utc"));
            var id = $"{zone} {(isLocal ? "local" : "utc")} {value}";
            m.Check(ids.Add(id), $"duplicate zones case {id}");
            try
            {
                var result = isLocal
                    ? ZoneMath.ToUtc(LocalDateTime.Parse(value), zone, zones)
                    : ZoneMath.ToZoned(LocalDateTime.Parse(value), zone, zones);
                var difference = JsonCompare.FirstDifference(OptLocalJson(result), c.P(isLocal ? "expectedUtc" : "expectedLocal"));
                if (PlatformZoneExceptions.TryGetValue(id, out var reason))
                {
                    skipped++;
                    m.Check(difference is not null, $"{id}: listed as a platform exception but now answers as tzdata; remove it from the list");
                    output.WriteLine($"zones: platform exception {id} ({difference}): {reason}");
                }
                else if (difference is not null)
                {
                    m.Check(false, $"{id}: {difference}");
                }
            }
            catch (Exception error)
            {
                m.Check(false, $"{id}: unexpected {error.GetType().Name}: {error.Message}");
            }
        }
        foreach (var listed in PlatformZoneExceptions.Keys) m.Check(ids.Contains(listed), $"platform exception {listed} is not a zones case");
        output.WriteLine($"zones: {cases.Length} cases, {skipped} listed as platform exceptions, {m.Count} mismatch(es)");
        if (m.Count > 0)
        {
            output.WriteLine($"fixture tzVersion {EventsFixture.Root.GetProperty("tzVersion").GetString()}; platform: {ZoneDataDescription()}");
        }
        m.AssertNone($"zones (fixture tzVersion {EventsFixture.Root.GetProperty("tzVersion").GetString()}, platform {ZoneDataDescription()})");
    }

    private static string ZoneDataDescription()
    {
        var version = OperatingSystem.IsWindows() ? "Windows registry time zones (IANA ids mapped through ICU)" : "unknown";
        foreach (var path in new[] { "/usr/share/zoneinfo/+VERSION", "/usr/share/zoneinfo/tzdata.zi" })
        {
            if (!File.Exists(path)) continue;
            var first = File.ReadLines(path).FirstOrDefault() ?? "";
            version = $"{path}: {first.Trim()}";
            break;
        }
        return $"{System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription} on {System.Runtime.InteropServices.RuntimeInformation.OSDescription}, TimeZoneInfo data {version}";
    }

    [Fact]
    public void Section_ZoneOffsets_AndTheRecordedResolver()
    {
        var entries = EventsFixture.Cases("zoneOffsets");
        Assert.Equal(64, entries.Length);
        var keys = entries.Select(e => $"{Str(e.P("zone"))} {Int(e.P("year")).ToString("D4", System.Globalization.CultureInfo.InvariantCulture)}").ToArray();
        Assert.Equal(keys.Order(StringComparer.Ordinal).ToArray(), keys);
        Assert.Equal(keys.Length, keys.Distinct(StringComparer.Ordinal).Count());
        foreach (var entry in entries)
        {
            Assert.Equal(["zone", "year", "startOffset", "transitions"], entry.EnumerateObject().Select(p => p.Name).ToArray());
            foreach (var t in entry.A("transitions"))
            {
                Assert.Equal(["utc", "offset"], t.EnumerateObject().Select(p => p.Name).ToArray());
                Assert.Equal(Int(entry.P("year")), Local(t.P("utc")).Date.Year);
            }
        }
        var tallinn = entries.Single(e => Str(e.P("zone")) == "Europe/Tallinn" && Int(e.P("year")) == 2026);
        Assert.Null(JsonCompare.FirstDifference(
            Obj(("zone", "Europe/Tallinn"), ("year", 2026), ("startOffset", 120), ("transitions", new JsonArray(
                Obj(("utc", "2026-03-29T01:00"), ("offset", 180)),
                Obj(("utc", "2026-10-25T01:00"), ("offset", 120))))),
            tallinn));
        foreach (var key in new[] { "America/New_York 0001", "America/New_York 9999", "Asia/Tokyo 0001", "Pacific/Kiritimati 9999", "Pacific/Honolulu 2026" })
        {
            Assert.Contains(key, keys);
        }

        // The recorded resolver answers from the table only and throws outside it.
        var recorded = EventsFixture.Recorded;
        Assert.True(recorded.IsKnown("Europe/Tallinn"));
        Assert.False(recorded.IsKnown("Mars/Olympus"));
        Assert.Equal(120, recorded.OffsetMinutesAt("Europe/Tallinn", LocalDateTime.Parse("2026-03-29T00:59")));
        Assert.Equal(180, recorded.OffsetMinutesAt("Europe/Tallinn", LocalDateTime.Parse("2026-03-29T01:00")));
        Assert.Throws<ZoneDataMissingException>(() => recorded.OffsetMinutesAt("Europe/Tallinn", LocalDateTime.Parse("2061-06-01T00:00")));
        Assert.Throws<ZoneDataMissingException>(() => recorded.OffsetMinutesAt("Mars/Olympus", LocalDateTime.Parse("2026-06-01T00:00")));
        Assert.Throws<ZoneDataMissingException>(() => ZoneMath.ToUtc(LocalDateTime.Parse("2061-06-01T12:00"), "Europe/Tallinn", recorded));
    }

    // ---- Shared ----------------------------------------------------------------------------------

    /// <summary>A copy of the named fields of <paramref name="c"/>, in that order, for comparing part of a case.</summary>
    private static JsonElement Expected(JsonElement c, params string[] fields)
    {
        var o = new JsonObject();
        foreach (var field in fields) o[field] = JsonNode.Parse(c.P(field).GetRawText());
        using var doc = JsonDocument.Parse(o.ToJsonString());
        return doc.RootElement.Clone();
    }
}
