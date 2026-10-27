using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Core.Tests.Support;
using Xunit.Abstractions;
using static Thirteen.Core.Tests.Support.EventsJson;
using static Thirteen.Core.Tests.Support.IcsJson;

namespace Thirteen.Core.Tests;

/// <summary>
/// The C# conformance test of fixtures/ics (docs/EVENTS.md §5.4, §5.6, task W2), replayed the way
/// packages/core/test/ics/fixtures.test.ts replays it: from the files on disk and index.json, with every value that
/// needs zone data computed through the <see cref="RecordedZoneResolver"/> built from the <c>zoneOffsets</c> of
/// fixtures/events.json (never the platform's zone data).
/// <list type="bullet">
/// <item>Every case: calendar fields, warnings (line and code; the detail is informative), UID groups, every
/// expansion of the expected file (both device zones, Europe/Tallinn and America/New_York, in the default window,
/// plus the cases' own windows and zones), and the byte-exact round trip (kind <c>as-read</c> or <c>zones-added</c>),
/// which also reads back to itself.</item>
/// <item>Every procedure (edits, imports, restore): each step's document byte for byte, import and restore counts,
/// and the step's expansions; every stored document reads back to itself.</item>
/// <item>index.json is complete: exactly the known keys, counts, and every file under fixtures/ics accounted for.</item>
/// </list>
/// </summary>
public sealed partial class IcsConformanceTests(ITestOutputHelper output)
{
    // ---- The set on disk -----------------------------------------------------------------------

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    private static readonly Lazy<string> IcsDir = new(() => Path.Combine(Fixture.RepositoryRoot(), "fixtures", "ics"));

    private static readonly Lazy<Dictionary<string, byte[]>> Files = new(LoadFiles, LazyThreadSafetyMode.ExecutionAndPublication);

    private static readonly Lazy<JsonDocument> Index = new(() => JsonDocument.Parse(Bytes("index.json")), LazyThreadSafetyMode.ExecutionAndPublication);

    private static IZoneResolver Zones => EventsFixture.Recorded;

    /// <summary>Every file under fixtures/ics by path relative to it, with '/' separators (dot files included).</summary>
    private static Dictionary<string, byte[]> LoadFiles()
    {
        var root = IcsDir.Value;
        if (!Directory.Exists(root)) throw new DirectoryNotFoundException($"fixtures/ics not found at {root}");
        return Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
            .ToDictionary(path => Path.GetRelativePath(root, path).Replace('\\', '/'), File.ReadAllBytes, StringComparer.Ordinal);
    }

    private static byte[] Bytes(string path) => Files.Value.TryGetValue(path, out var bytes) ? bytes : throw new FileNotFoundException($"fixtures/ics has no {path}");

    /// <summary>A committed file as text (strict UTF-8, a byte order mark kept as U+FEFF).</summary>
    private static string Text(string path) => StrictUtf8.GetString(Bytes(path));

    private static JsonDocument Json(string path) => JsonDocument.Parse(Bytes(path));

    private static JsonElement IndexRoot => Index.Value.RootElement;

    private static LocalDateTime Now => LocalDateTime.Parse(Str(IndexRoot.P("now")));

    public static TheoryData<string> Cases()
    {
        var data = new TheoryData<string>();
        foreach (var c in IndexRoot.A("cases")) data.Add(Str(c.P("file")));
        return data;
    }

    public static TheoryData<string> Procedures()
    {
        var data = new TheoryData<string>();
        foreach (var key in new[] { "edits", "imports", "restore" })
        {
            foreach (var f in IndexRoot.A(key)) data.Add(Str(f));
        }
        return data;
    }

    private static JsonElement CaseEntry(string file) =>
        IndexRoot.A("cases").FirstOrDefault(c => Str(c.P("file")) == file) is { ValueKind: JsonValueKind.Object } entry
            ? entry
            : throw new InvalidDataException($"index.json lists no {file}");

    /// <summary>A text with CRLF line ends and without a byte order mark: what the writer gives back for a text it copies as read.</summary>
    private static string NormalizeLineEnds(string text)
    {
        var body = text.StartsWith((char)0xFEFF) ? text[1..] : text;
        return LineEnd().Replace(body, "\r\n");
    }

    [GeneratedRegex("\r\n|\r|\n")]
    private static partial Regex LineEnd();

    [GeneratedRegex(@"BEGIN:VTIMEZONE\r\n(?:(?!END:VTIMEZONE\r\n)[\s\S])*?X-THIRTEEN-GENERATED:[\s\S]*?END:VTIMEZONE\r\n")]
    private static partial Regex GeneratedZone();

    /// <summary>A text without the <c>VTIMEZONE</c>s Thirteen generated (<c>X-THIRTEEN-GENERATED</c>).</summary>
    private static string WithoutGeneratedZones(string text) => GeneratedZone().Replace(text, "");

    private static DeviceWindow Window(JsonElement w) => new(Local(w.P("from")), Local(w.P("to")));

    /// <summary>Compares one expansion (<c>{deviceZone, window, warnings, occurrences}</c>) of a document with the engine's.</summary>
    private static void CheckExpansion(IcsCalendar calendar, string calendarId, JsonElement expansion, Mismatches mismatches, string context)
    {
        var zone = Str(expansion.P("deviceZone"));
        var window = Window(expansion.P("window"));
        var where = $"{context} {zone} {window.From}..{window.To}";
        IcsExpansionResult result;
        try
        {
            result = IcsExpansion.ExpandCalendar(calendar, zone, Zones, window, CalendarSystemId.Ifc, calendarId);
        }
        catch (Exception error)
        {
            mismatches.Check(false, $"{where}: threw {error.GetType().Name}: {error.Message}");
            return;
        }
        mismatches.Json(Arr(result.Events, OccurrenceJson), expansion.P("occurrences"), $"{where} occurrences");
        mismatches.Json(Arr(result.Warnings, WarningKeyJson), ToElement(Arr(expansion.A("warnings"), WarningKeyJson)), $"{where} warnings");
    }

    private static JsonElement ToElement(JsonNode node)
    {
        using var document = JsonDocument.Parse(node.ToJsonString());
        return document.RootElement.Clone();
    }

    private static string FirstDifferentLine(string actual, string expected)
    {
        var a = actual.Split("\r\n");
        var e = expected.Split("\r\n");
        for (var i = 0; i < Math.Max(a.Length, e.Length); i++)
        {
            var x = i < a.Length ? a[i] : "<end>";
            var y = i < e.Length ? e[i] : "<end>";
            if (x != y) return $"line {i + 1}: got {Calc.Quoted(x)}, expected {Calc.Quoted(y)}";
        }
        return "texts differ only in line ends";
    }

    // ---- index.json ----------------------------------------------------------------------------

    private static readonly string[] IndexKeys =
        ["version", "complete", "generatedBy", "spec", "zoneOffsets", "now", "system", "deviceZones", "defaultWindow", "counts", "cases", "edits", "imports", "restore", "inputs"];

    /// <summary>The counts index.json states, as generated (§5.6): 31 cases, 5 edits, 5 imports, 1 restore, 14 inputs.</summary>
    private static readonly (string Name, int Count)[] ExpectedCounts = [("cases", 31), ("edits", 5), ("imports", 5), ("restore", 1), ("inputs", 14)];

    [Fact]
    public void Index_IsComplete_WithExactKeys_Counts_AndEveryFileAccountedFor()
    {
        var root = IndexRoot;
        Assert.Equal(IndexKeys, root.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal(1, Int(root.P("version")));
        Assert.True(Bool(root.P("complete")));
        Assert.Equal("@thirteen/core", Str(root.P("generatedBy")));
        Assert.Equal("docs/EVENTS.md", Str(root.P("spec")));
        Assert.Equal("fixtures/events.json", Str(root.P("zoneOffsets")));
        Assert.Equal("2026-10-19T06:41", Str(root.P("now")));
        Assert.Equal("ifc", Str(root.P("system")));
        Assert.Equal(["Europe/Tallinn", "America/New_York"], root.A("deviceZones").Select(Str).ToArray());
        Assert.Equal("2026-01-01T00:00", Str(root.P("defaultWindow").P("from")));
        Assert.Equal("2027-12-31T24:00", Str(root.P("defaultWindow").P("to")));

        var counts = root.P("counts");
        Assert.Equal(ExpectedCounts.Select(c => c.Name).ToArray(), counts.EnumerateObject().Select(p => p.Name).ToArray());
        foreach (var (name, count) in ExpectedCounts)
        {
            Assert.True(Int(counts.P(name)) == count, $"counts.{name}: {Int(counts.P(name))}, expected {count}");
            Assert.True(root.A(name).Length == count, $"{name}: {root.A(name).Length} entries, expected {count}");
        }

        // Every case entry is exact and names existing files; three cases add generated zones (§5.6).
        var listed = new HashSet<string>(StringComparer.Ordinal) { "index.json", "README.md", ".gitattributes", ".editorconfig" };
        foreach (var c in root.A("cases"))
        {
            Assert.Equal(["file", "expected", "roundtrip", "roundTrip"], c.EnumerateObject().Select(p => p.Name).ToArray());
            var file = Str(c.P("file"));
            Assert.StartsWith("cases/", file, StringComparison.Ordinal);
            var name = file["cases/".Length..^".ics".Length];
            Assert.Equal($"expected/{name}.json", Str(c.P("expected")));
            Assert.Equal($"roundtrip/{name}.ics", Str(c.P("roundtrip")));
            Assert.Contains(Str(c.P("roundTrip")), new[] { "as-read", "zones-added" });
            listed.Add(file);
            listed.Add(Str(c.P("expected")));
            listed.Add(Str(c.P("roundtrip")));
        }
        var zonesAdded = root.A("cases").Where(c => Str(c.P("roundTrip")) == "zones-added").Select(c => Str(c.P("file"))).ToArray();
        Assert.Equal(["cases/far-future.ics", "cases/unknown-tzid.ics", "cases/window-edges.ics"], zonesAdded);

        // Procedure files, their inputs and every step's document; the restore zip.
        var outputs = new List<string>();
        foreach (var key in new[] { "edits", "imports", "restore" })
        {
            foreach (var f in root.A(key))
            {
                var path = Str(f);
                listed.Add(path);
                using var procedure = Json(path);
                foreach (var scenario in procedure.RootElement.A("scenarios"))
                {
                    foreach (var step in scenario.A("steps")) outputs.Add(Str(step.P("expected")));
                }
                if (procedure.RootElement.TryGetProperty("zip", out var zip)) listed.Add(Str(zip.P("file")));
            }
        }
        Assert.Equal(outputs.Count, outputs.Distinct(StringComparer.Ordinal).Count());
        foreach (var input in root.A("inputs").Select(Str)) Assert.True(listed.Add(input), $"input {input} listed twice");
        foreach (var path in outputs) Assert.True(listed.Add(path), $"step output {path} is also listed elsewhere");

        var onDisk = Files.Value.Keys.ToHashSet(StringComparer.Ordinal);
        Assert.Equal(listed.Order(StringComparer.Ordinal).ToArray(), onDisk.Order(StringComparer.Ordinal).ToArray());
        output.WriteLine($"fixtures/ics: {onDisk.Count} files; {root.A("cases").Length} cases, {Procedures().Count} procedure files, {root.A("inputs").Length} inputs, {outputs.Count} step documents");
    }

    [Fact]
    public void Files_HoldNoEnOrEmDash()
    {
        var dashed = Files.Value.Where(f => !f.Key.EndsWith(".zip", StringComparison.Ordinal))
            .Where(f => StrictUtf8.GetString(f.Value).IndexOfAny([(char)0x2013, (char)0x2014]) >= 0)
            .Select(f => f.Key)
            .ToArray();
        Assert.Empty(dashed);
    }

    // ---- Cases ---------------------------------------------------------------------------------

    private static readonly string[] ExpectedKeys = ["version", "case", "calendarId", "system", "roundTrip", "calendar", "warnings", "groups", "expansions"];

    [Theory]
    [MemberData(nameof(Cases))]
    public void Case_ReadsExpandsAndRoundTrips_AsTypeScriptDoes(string file)
    {
        var entry = CaseEntry(file);
        var input = Text(file);
        using var expectedDocument = Json(Str(entry.P("expected")));
        var expected = expectedDocument.RootElement;
        Assert.Equal(ExpectedKeys, expected.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal(1, Int(expected.P("version")));
        Assert.Equal(file, Str(expected.P("case")));
        Assert.Equal("ifc", Str(expected.P("system")));
        Assert.Equal(Str(entry.P("roundTrip")), Str(expected.P("roundTrip")));
        var calendarId = Str(expected.P("calendarId"));
        Assert.Equal(file["cases/".Length..^".ics".Length], calendarId);

        var mismatches = new Mismatches();
        var calendar = IcsReader.Parse(input, calendarId, Zones);
        mismatches.Json(CalendarJson(calendar), expected.P("calendar"), "calendar");
        mismatches.Json(Arr(calendar.Warnings, WarningKeyJson), ToElement(Arr(expected.A("warnings"), WarningKeyJson)), "warnings");
        mismatches.Json(Arr(calendar.Groups, GroupJson), expected.P("groups"), "groups");
        var details = calendar.Warnings.Zip(expected.A("warnings")).Count(p => p.First.Detail != Str(p.Second.P("detail")));
        if (details > 0) output.WriteLine($"{file}: {details} warning detail(s) word their (informative) text differently");

        // Every expansion, and both device zones in the default window unless the case is only about another year.
        var expansions = expected.A("expansions");
        foreach (var expansion in expansions) CheckExpansion(calendar, calendarId, expansion, mismatches, file);
        foreach (var zone in IndexRoot.A("deviceZones").Select(Str))
        {
            var defaultWindow = IndexRoot.P("defaultWindow");
            var covered = expansions.Any(e => Str(e.P("deviceZone")) == zone
                && (file == "cases/far-future.ics" || (Str(e.P("window").P("from")) == Str(defaultWindow.P("from")) && Str(e.P("window").P("to")) == Str(defaultWindow.P("to")))));
            mismatches.Check(covered, $"{file}: no expansion for device zone {zone}");
        }
        output.WriteLine($"{file}: {calendar.Groups.Count} groups, {calendar.Warnings.Count} warnings, {expansions.Length} expansions, {expansions.Sum(e => e.A("occurrences").Length)} occurrences");

        // The round trip, byte for byte; its relation to the input; and that it reads back to itself.
        var roundtripPath = Str(entry.P("roundtrip"));
        var written = IcsWriter.Serialize(calendar, Zones, Now);
        var roundtrip = Text(roundtripPath);
        if (!StrictUtf8.GetBytes(written).AsSpan().SequenceEqual(Bytes(roundtripPath)))
        {
            mismatches.Check(false, $"{roundtripPath} differs: {FirstDifferentLine(written, roundtrip)}");
        }
        var normalized = NormalizeLineEnds(input);
        if (Str(entry.P("roundTrip")) == "as-read")
        {
            mismatches.Check(roundtrip == normalized, $"{roundtripPath} is not the input with CRLF line ends");
        }
        else
        {
            mismatches.Check(roundtrip != normalized && WithoutGeneratedZones(roundtrip) == normalized, $"{roundtripPath} is not the input plus generated VTIMEZONEs");
            mismatches.Check(roundtrip.Contains("X-THIRTEEN-GENERATED:", StringComparison.Ordinal), $"{roundtripPath} has no generated VTIMEZONE");
        }
        var again = IcsWriter.Serialize(IcsReader.Parse(roundtrip, calendarId, Zones), Zones, Now);
        mismatches.Check(again == roundtrip, $"{roundtripPath} does not read back to itself: {FirstDifferentLine(again, roundtrip)}");

        // The JSON form of every event reads back to itself (the test's own readers and writers).
        foreach (var group in expected.A("groups"))
        {
            var members = (IsNull(group.P("master")) ? Array.Empty<JsonElement>() : [group.P("master")]).Concat(group.A("overrides"));
            foreach (var member in members) mismatches.Json(EventJson(ReadEvent(member)), member, $"{file} event JSON round trip");
        }
        mismatches.AssertNone(file);
    }

    // ---- Procedures ----------------------------------------------------------------------------

    private static IcsGroup GroupOf(IcsCalendar calendar, string uid) =>
        calendar.Groups.FirstOrDefault(g => g.Uid == uid) ?? throw new InvalidDataException($"The calendar has no group {uid}");

    /// <summary>The calendar with an edit step's changes applied in order (TS <c>applyChanges</c>, the port side).</summary>
    private static IcsCalendar ApplyChanges(IcsCalendar calendar, IEnumerable<JsonElement> changes)
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
                    bool Matches(IcsEvent e) => recurrenceId is null ? e.RecurrenceId is null : e.RecurrenceId is not null && e.RecurrenceId.Equals(recurrenceId);
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
                    next = IcsGroups.ReplaceGroup(next, group with { Master = IcsGroups.WithRetimedUntils(group.Master, untils, next, Zones) });
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

    private static readonly string[] ProcedureKeys = ["version", "description", "now", "scenarios"];

    [Theory]
    [MemberData(nameof(Procedures))]
    public void Procedure_ReplaysByteForByte(string file)
    {
        using var document = Json(file);
        var procedure = document.RootElement;
        var keys = procedure.EnumerateObject().Select(p => p.Name).ToArray();
        Assert.Equal(file == "restore/restore.json" ? ["version", "description", "now", "calendars", "zip", "scenarios"] : ProcedureKeys, keys);
        Assert.Equal(1, Int(procedure.P("version")));
        Assert.Equal(Str(IndexRoot.P("now")), Str(procedure.P("now")));
        var now = Local(procedure.P("now"));
        var scenarios = procedure.A("scenarios");
        Assert.NotEmpty(scenarios);
        var mismatches = new Mismatches();
        var steps = 0;
        foreach (var scenario in scenarios)
        {
            var name = Str(scenario.P("name"));
            var calendarId = Str(scenario.P("calendarId"));
            var start = scenario.P("start");
            string doc;
            if (start.TryGetProperty("file", out var startFile))
            {
                doc = Text(Str(startFile));
            }
            else
            {
                var fresh = start.P("new");
                doc = IcsWriter.Serialize(IcsGroups.NewCalendar(Str(fresh.P("calendarId")), Str(fresh.P("name")), Str(fresh.P("color"))), Zones, now);
            }
            foreach (var step in scenario.A("steps"))
            {
                steps++;
                var expectedPath = Str(step.P("expected"));
                var context = $"{name}: {expectedPath}";
                var calendar = IcsReader.Parse(doc, calendarId, Zones);
                IcsCalendar next;
                switch (Str(step.P("kind")))
                {
                    case "edit":
                        next = ApplyChanges(calendar, step.A("changes"));
                        break;
                    case "import":
                    {
                        var imported = IcsMerge.ImportCalendar(calendar, Text(Str(step.P("file"))), calendarId, Zones);
                        var result = step.P("result");
                        Assert.Equal(["added", "updated", "unchanged", "skipped"], result.EnumerateObject().Select(p => p.Name).ToArray());
                        mismatches.Equal(
                            (Int(result.P("added")), Int(result.P("updated")), Int(result.P("unchanged")), Int(result.P("skipped"))),
                            (imported.Added, imported.Updated, imported.Unchanged, imported.Skipped),
                            $"{context} import result");
                        next = imported.Calendar;
                        break;
                    }
                    case "restore":
                    {
                        var restored = IcsMerge.RestoreCalendar(calendar, Text(Str(step.P("file"))), calendarId, Zones);
                        var result = step.P("result");
                        Assert.Equal(["added", "updated", "unchanged", "keptNewer"], result.EnumerateObject().Select(p => p.Name).ToArray());
                        mismatches.Equal(
                            (Int(result.P("added")), Int(result.P("updated")), Int(result.P("unchanged")), Int(result.P("keptNewer"))),
                            (restored.Added, restored.Updated, restored.Unchanged, restored.KeptNewer),
                            $"{context} restore result");
                        next = restored.Calendar;
                        break;
                    }
                    default:
                        throw new InvalidDataException($"Unknown step kind in {Short(step)}");
                }
                var written = IcsWriter.Serialize(next, Zones, now);
                var expected = Text(expectedPath);
                if (!StrictUtf8.GetBytes(written).AsSpan().SequenceEqual(Bytes(expectedPath)))
                {
                    mismatches.Check(false, $"{context} differs: {FirstDifferentLine(written, expected)}");
                }
                if (step.TryGetProperty("expansions", out var expansions))
                {
                    var stored = IcsReader.Parse(written, calendarId, Zones);
                    foreach (var expansion in expansions.EnumerateArray()) CheckExpansion(stored, calendarId, expansion, mismatches, context);
                }
                // A stored document reads back to itself.
                var again = IcsWriter.Serialize(IcsReader.Parse(written, calendarId, Zones), Zones, now);
                mismatches.Check(again == written, $"{context} does not read back to itself: {FirstDifferentLine(again, written)}");
                // Continue from the committed document, as a port replays the set.
                doc = expected;
            }
        }
        output.WriteLine($"{file}: {scenarios.Length} scenarios, {steps} steps");
        mismatches.AssertNone(file);
    }

    [Fact]
    public void Restore_ZipHoldsTheThreeExports_AndTheCalendarsAreAsListed()
    {
        using var document = Json("restore/restore.json");
        var restore = document.RootElement;
        var zip = restore.P("zip");
        using var archive = new ZipArchive(new MemoryStream(Bytes(Str(zip.P("file")))), ZipArchiveMode.Read);
        var entries = zip.A("entries").Select(Str).ToArray();
        Assert.Equal(entries, archive.Entries.Select(e => e.FullName).ToArray());
        foreach (var entry in archive.Entries)
        {
            using var stream = entry.Open();
            using var copy = new MemoryStream();
            stream.CopyTo(copy);
            Assert.True(copy.ToArray().AsSpan().SequenceEqual(Bytes($"restore/{entry.FullName}")), $"zip entry {entry.FullName} differs from restore/{entry.FullName}");
        }
        var calendars = restore.A("calendars");
        Assert.Equal(entries.Select(e => $"restore/{e}").ToArray(), calendars.Select(c => Str(c.P("file"))).ToArray());
        Assert.Equal(["local", "local", "subscription"], calendars.Select(c => Str(c.P("kind"))).ToArray());
        foreach (var c in calendars)
        {
            var text = Text(Str(c.P("file")));
            var calendar = IcsReader.Parse(text, zones: Zones);
            Assert.Equal(Str(c.P("name")), calendar.Name);
            Assert.Equal(Str(c.P("color")), calendar.Color);
            Assert.Contains($"X-THIRTEEN-CALENDAR-ID:{Str(c.P("calendarId"))}\r\n", text, StringComparison.Ordinal);
            Assert.Equal(Int(c.P("groups")), calendar.Groups.Count);
        }
        Assert.Equal(Text("restore/Personal.ics"), Text("restore/personal-restored.ics"));
        Assert.Equal(Text("restore/Personal.ics"), Text("restore/personal-restored-twice.ics"));
        Assert.DoesNotContain("X-THIRTEEN-IMPORTED-LAST-MODIFIED", Text("restore/older-restored.ics"), StringComparison.Ordinal);
    }

    // ---- The CLDR Windows zone table -----------------------------------------------------------

    [GeneratedRegex(@"^\s*\['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\],$", RegexOptions.Multiline)]
    private static partial Regex TypeScriptRow();

    [Fact]
    public void WindowsZones_AreTheRowsOfTheTypeScriptTable()
    {
        var path = Path.Combine(Fixture.RepositoryRoot(), "packages", "core", "src", "ics", "windows-zones.ts");
        var text = File.ReadAllText(path);
        var rows = TypeScriptRow().Matches(text)
            .Select(m => (Regex.Unescape(m.Groups[1].Value), Regex.Unescape(m.Groups[2].Value)))
            .ToArray();
        Assert.True(rows.Length > 130, $"Only {rows.Length} rows read from {path}");
        Assert.Equal(rows, WindowsZones.Table.Select(r => (r.Windows, r.Iana)).ToArray());
        Assert.Equal("Europe/Kiev", IcsZones.WindowsZoneToIana("FLE Standard Time"));
        Assert.Equal("Europe/Kiev", IcsZones.WindowsZoneToIana("fle standard time"));
        Assert.Null(IcsZones.WindowsZoneToIana("Europe/Tallinn"));
        output.WriteLine($"{rows.Length} Windows zones, identical in windows-zones.ts and WindowsZones.g.cs");
    }
}
