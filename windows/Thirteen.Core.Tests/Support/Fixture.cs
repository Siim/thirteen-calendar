using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Thirteen.Core.Json;

namespace Thirteen.Core.Tests.Support;

/// <summary>
/// Loads fixtures/conversions.json (format version 2, documented in fixtures/README.md) straight from
/// the repository; the file is never copied into the test project. The repository root is the first
/// ancestor containing both fixtures/conversions.json and docs/SPEC.md, searched from this source file's
/// compile-time path, then from the test binary's directory, or taken from THIRTEEN_REPO_ROOT.
/// Every failure throws: a missing or truncated fixture fails the run, it never skips.
/// </summary>
internal static class Fixture
{
    private static readonly Lazy<JsonDocument> Document = new(Load, LazyThreadSafetyMode.ExecutionAndPublication);

    public static JsonElement Root => Document.Value.RootElement;

    public static string Path { get; private set; } = "";

    public static JsonElement Section(string name) =>
        Root.TryGetProperty(name, out var value) ? value : throw new InvalidDataException($"Fixture has no section \"{name}\"");

    public static JsonElement[] Array(string name) => Section(name).EnumerateArray().ToArray();

    public static JsonElement[] Array(string section, string name) =>
        Section(section).TryGetProperty(name, out var value)
            ? value.EnumerateArray().ToArray()
            : throw new InvalidDataException($"Fixture section \"{section}\" has no \"{name}\"");

    public static string RepositoryRoot() => FindRoot() ?? throw new FileNotFoundException(
        "Could not find the repository root (a directory containing fixtures/conversions.json and docs/SPEC.md). " +
        "Run the tests from inside the repository or set THIRTEEN_REPO_ROOT.");

    private static JsonDocument Load()
    {
        Path = System.IO.Path.Combine(RepositoryRoot(), "fixtures", "conversions.json");
        using var stream = File.OpenRead(Path);
        return JsonDocument.Parse(stream);
    }

    private static string? FindRoot([CallerFilePath] string sourceFile = "")
    {
        var fromEnvironment = Environment.GetEnvironmentVariable("THIRTEEN_REPO_ROOT");
        if (!string.IsNullOrEmpty(fromEnvironment))
        {
            return IsRoot(fromEnvironment) ? fromEnvironment : throw new DirectoryNotFoundException(
                $"THIRTEEN_REPO_ROOT={fromEnvironment} does not contain fixtures/conversions.json and docs/SPEC.md");
        }
        foreach (var start in new[] { System.IO.Path.GetDirectoryName(sourceFile), AppContext.BaseDirectory })
        {
            for (var dir = string.IsNullOrEmpty(start) ? null : new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            {
                if (IsRoot(dir.FullName)) return dir.FullName;
            }
        }
        return null;
    }

    private static bool IsRoot(string dir) =>
        File.Exists(System.IO.Path.Combine(dir, "fixtures", "conversions.json")) && File.Exists(System.IO.Path.Combine(dir, "docs", "SPEC.md"));

    // ---- Typed readers ------------------------------------------------------------------------

    public static GregorianDate Gregorian(JsonElement e) =>
        e.ValueKind == JsonValueKind.String ? GregorianDate.ParseIso(e.GetString()!) : ThirteenJson.Deserialize<GregorianDate>(e.GetRawText());

    public static GregorianDate? OptionalGregorian(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : Gregorian(e);

    public static ThirteenDate Thirteen(JsonElement e) => ThirteenJson.Deserialize<ThirteenDate>(e.GetRawText())
        ?? throw new InvalidDataException($"Expected a ThirteenDate, got {e.GetRawText()}");

    public static ThirteenDate? OptionalThirteen(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : Thirteen(e);

    public static CalendarSystemId SystemId(JsonElement e) => CalendarSystemIdExtensions.Parse(e.GetString());

    public static int? OptionalInt(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : e.GetInt32();
}

/// <summary>
/// Exact structural JSON comparison: object keys must match in name and order, null is not absent,
/// numbers compare as doubles, strings ordinally.
/// </summary>
internal static class JsonCompare
{
    public static JsonNode ToNode<T>(T value) => JsonSerializer.SerializeToNode(value, ThirteenJson.Options)
        ?? throw new InvalidOperationException("Serialised to null");

    /// <summary>Returns a description of the first difference, or null when equal.</summary>
    public static string? FirstDifference(JsonNode? actual, JsonElement expected, string path = "$")
    {
        using var doc = JsonDocument.Parse(actual?.ToJsonString() ?? "null");
        return FirstDifference(doc.RootElement, expected, path);
    }

    public static string? FirstDifference(JsonElement actual, JsonElement expected, string path = "$")
    {
        if (actual.ValueKind != expected.ValueKind)
        {
            var bothBool = actual.ValueKind is JsonValueKind.True or JsonValueKind.False && expected.ValueKind is JsonValueKind.True or JsonValueKind.False;
            return bothBool
                ? $"{path}: {actual.GetRawText()} != {expected.GetRawText()}"
                : $"{path}: kind {actual.ValueKind} != {expected.ValueKind} ({actual.GetRawText()} vs {expected.GetRawText()})";
        }
        switch (expected.ValueKind)
        {
            case JsonValueKind.Object:
            {
                var a = actual.EnumerateObject().ToArray();
                var e = expected.EnumerateObject().ToArray();
                var aKeys = string.Join(",", a.Select(p => p.Name));
                var eKeys = string.Join(",", e.Select(p => p.Name));
                if (aKeys != eKeys) return $"{path}: keys [{aKeys}] != [{eKeys}]";
                for (var i = 0; i < e.Length; i++)
                {
                    var d = FirstDifference(a[i].Value, e[i].Value, $"{path}.{e[i].Name}");
                    if (d is not null) return d;
                }
                return null;
            }
            case JsonValueKind.Array:
            {
                var a = actual.EnumerateArray().ToArray();
                var e = expected.EnumerateArray().ToArray();
                if (a.Length != e.Length) return $"{path}: length {a.Length} != {e.Length}";
                for (var i = 0; i < e.Length; i++)
                {
                    var d = FirstDifference(a[i], e[i], $"{path}[{i}]");
                    if (d is not null) return d;
                }
                return null;
            }
            case JsonValueKind.Number:
                return actual.GetDouble().Equals(expected.GetDouble()) ? null : $"{path}: {actual.GetRawText()} != {expected.GetRawText()}";
            case JsonValueKind.String:
                return string.Equals(actual.GetString(), expected.GetString(), StringComparison.Ordinal)
                    ? null
                    : $"{path}: \"{actual.GetString()}\" != \"{expected.GetString()}\"";
            default:
                return null; // null, true, false: equal kinds are equal values
        }
    }
}

/// <summary>Collects mismatches so a loop over hundreds of vectors reports them all at once.</summary>
internal sealed class Mismatches
{
    private readonly List<string> _items = [];

    public int Count => _items.Count;

    public void Check(bool condition, string message)
    {
        if (!condition) _items.Add(message);
    }

    public void Equal<T>(T expected, T actual, string context)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual)) _items.Add($"{context}: expected {expected}, got {actual}");
    }

    public void Json(JsonNode? actual, JsonElement expected, string context)
    {
        var d = JsonCompare.FirstDifference(actual, expected);
        if (d is not null) _items.Add($"{context}: {d}");
    }

    public void Throws<TException>(Action action, string context) where TException : Exception
    {
        try
        {
            action();
            _items.Add($"{context}: expected {typeof(TException).Name}, nothing was thrown");
        }
        catch (TException)
        {
        }
        catch (Exception other)
        {
            _items.Add($"{context}: expected {typeof(TException).Name}, got {other.GetType().Name}: {other.Message}");
        }
    }

    public void AssertNone(string what)
    {
        if (_items.Count == 0) return;
        Assert.Fail($"{_items.Count} mismatch(es) in {what}:\n  " + string.Join("\n  ", _items.Take(25)));
    }
}
