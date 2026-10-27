using System.Text.Json;
using Thirteen.Core.Events;

namespace Thirteen.Core.Tests.Support;

/// <summary>
/// Loads fixtures/events.json (format version 1, docs/EVENTS.md §5.5, fixtures/README.md) straight from the
/// repository, found the same way as conversions.json (<see cref="Fixture.RepositoryRoot"/>). Every failure
/// throws: a missing or truncated fixture fails the run, it never skips.
/// </summary>
internal static class EventsFixture
{
    /// <summary>The sections of §5.5 in file order, with the case counts the file must hold.</summary>
    public static readonly (string Name, int Count)[] Sections =
    [
        ("localDateTimes", 29), ("endForms", 19), ("wallClock", 21), ("zoneMath", 36), ("rrules", 101), ("rruleEquality", 33),
        ("untils", 26), ("dateLists", 26), ("thirteenRules", 91), ("ruleFromStart", 45), ("expansions", 135), ("endBefore", 20),
        ("splits", 20), ("retimes", 20), ("seriesEdits", 12), ("series", 38), ("recognitions", 55), ("presets", 16),
        ("descriptions", 55), ("nextOccurrences", 23), ("repeatNotes", 23), ("adaptations", 23), ("drafts", 79), ("newDrafts", 19),
        ("merges", 15), ("alarms", 8), ("alarmInstants", 15), ("chipTimes", 20), ("monthColumns", 65), ("monthLayouts", 15),
        ("weekLayouts", 10), ("dayLayouts", 18), ("agendas", 8), ("yearMarks", 4), ("zones", 29), ("zoneOffsets", 64),
    ];

    private static readonly Lazy<(JsonDocument Document, string Path, string Text)> Loaded = new(Load, LazyThreadSafetyMode.ExecutionAndPublication);

    private static readonly Lazy<RecordedZoneResolver> RecordedZones = new(() => new RecordedZoneResolver(Cases("zoneOffsets")), LazyThreadSafetyMode.ExecutionAndPublication);

    public static JsonElement Root => Loaded.Value.Document.RootElement;

    public static string Path => Loaded.Value.Path;

    public static string Text => Loaded.Value.Text;

    /// <summary>The port's <c>RecordedZoneResolver</c>: the file's <c>zoneOffsets</c> and nothing else.</summary>
    public static RecordedZoneResolver Recorded => RecordedZones.Value;

    public static JsonElement[] Cases(string section) =>
        Root.TryGetProperty(section, out var value) && value.ValueKind == JsonValueKind.Array
            ? value.EnumerateArray().ToArray()
            : throw new InvalidDataException($"events.json has no section \"{section}\"");

    private static (JsonDocument, string, string) Load()
    {
        var path = System.IO.Path.Combine(Fixture.RepositoryRoot(), "fixtures", "events.json");
        var text = File.ReadAllText(path);
        return (JsonDocument.Parse(text), path, text);
    }
}

/// <summary>A fixture value C# cannot represent (a non-integer where the API takes an integer).</summary>
internal sealed class UnrepresentableException(string message) : Exception(message);

/// <summary>Thrown by the test resolvers for a zone or year they do not hold.</summary>
internal sealed class ZoneDataMissingException(string message) : Exception(message);

/// <summary>
/// The synthetic zone tables of the <c>zoneMath</c> section (packages/core/scripts/zone-resolvers.ts
/// <c>syntheticZoneResolver</c>): the offset in force at a UTC instant is the <c>offset</c> of the last
/// transition whose <c>at</c> is at or before it, or the zone's initial <c>offset</c>.
/// </summary>
internal sealed class SyntheticZoneResolver : IZoneResolver
{
    private readonly string _name;
    private readonly int _offset;
    private readonly (LocalDateTime At, int Offset)[] _transitions;

    public SyntheticZoneResolver(JsonElement zone)
    {
        _name = zone.GetProperty("name").GetString()!;
        _offset = zone.GetProperty("offset").GetInt32();
        _transitions = zone.GetProperty("transitions").EnumerateArray()
            .Select(t => (LocalDateTime.Parse(t.GetProperty("at").GetString()!), t.GetProperty("offset").GetInt32()))
            .ToArray();
        for (var i = 1; i < _transitions.Length; i++)
        {
            if (_transitions[i - 1].At.CompareTo(_transitions[i].At) >= 0)
            {
                throw new InvalidDataException($"Synthetic zone {_name}: transitions must be in ascending order");
            }
        }
    }

    public bool IsKnown(string tzid) => tzid == _name;

    public int OffsetMinutesAt(string tzid, LocalDateTime utc)
    {
        if (tzid != _name) throw new ZoneDataMissingException($"Unknown synthetic zone {tzid}");
        var offset = _offset;
        foreach (var (at, value) in _transitions)
        {
            if (at.CompareTo(utc) > 0) break;
            offset = value;
        }
        return offset;
    }
}

/// <summary>
/// Answers from <c>zoneOffsets</c> entries alone (packages/core/scripts/zone-resolvers.ts
/// <c>recordedZoneResolver</c>): knows exactly the zones they list and throws for a known zone in a UTC year
/// the table does not hold, so no test falls back to the platform's zone data.
/// </summary>
internal sealed class RecordedZoneResolver : IZoneResolver
{
    private readonly Dictionary<string, Dictionary<int, (int Start, (LocalDateTime At, int Offset)[] Transitions)>> _table = new(StringComparer.Ordinal);

    public RecordedZoneResolver(IEnumerable<JsonElement> entries)
    {
        foreach (var entry in entries)
        {
            var zone = entry.GetProperty("zone").GetString()!;
            var year = entry.GetProperty("year").GetInt32();
            if (!_table.TryGetValue(zone, out var years)) _table[zone] = years = [];
            if (years.ContainsKey(year)) throw new InvalidDataException($"zoneOffsets holds {zone} {year} twice");
            var transitions = entry.GetProperty("transitions").EnumerateArray()
                .Select(t => (LocalDateTime.Parse(t.GetProperty("utc").GetString()!), t.GetProperty("offset").GetInt32()))
                .ToArray();
            for (var i = 0; i < transitions.Length; i++)
            {
                if (transitions[i].Item1.Date.Year != year || (i > 0 && transitions[i - 1].Item1.CompareTo(transitions[i].Item1) >= 0))
                {
                    throw new InvalidDataException($"zoneOffsets {zone} {year}: transitions must be ascending and inside the year");
                }
            }
            years[year] = (entry.GetProperty("startOffset").GetInt32(), transitions);
        }
    }

    public bool IsKnown(string tzid) => _table.ContainsKey(tzid);

    public int OffsetMinutesAt(string tzid, LocalDateTime utc)
    {
        if (!_table.TryGetValue(tzid, out var years)) throw new ZoneDataMissingException($"Unknown time zone {tzid} (not in zoneOffsets)");
        if (!years.TryGetValue(utc.Date.Year, out var year))
        {
            throw new ZoneDataMissingException($"zoneOffsets holds no offsets for {tzid} in {utc.Date.Year} (asked for {utc})");
        }
        var offset = year.Start;
        foreach (var (at, value) in year.Transitions)
        {
            if (at.CompareTo(utc) > 0) break;
            offset = value;
        }
        return offset;
    }
}
