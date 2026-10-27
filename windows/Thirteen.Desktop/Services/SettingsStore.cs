using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Thirteen.Desktop.Services;

/// <summary>
/// The user's choices, stored as JSON in <c>%APPDATA%\Thirteen\settings.json</c>. Ids are stored, not
/// display names (design/README.md), so renaming a theme keeps the choice; unknown values fall back to
/// the defaults when read.
/// </summary>
public sealed class AppSettings
{
    /// <summary>Colour theme id: "almanac" (default), "graphite", "slate", "forest", "mono".</summary>
    public string Theme { get; set; } = "almanac";

    /// <summary>"system" (follow Windows), "light" or "dark".</summary>
    public string Appearance { get; set; } = "system";

    /// <summary>13-month system id: "ifc" (default) or "positivist".</summary>
    public string System { get; set; } = "ifc";

    /// <summary>Whether the Year grids show the Gregorian date in every cell.</summary>
    public bool ShowsGregorianOverlay { get; set; } = true;

    /// <summary>"Show events in Year view" (docs/EVENTS.md §2.18): Year mode draws event dots.</summary>
    public bool ShowsYearEvents { get; set; } = true;

    /// <summary>"Default calendar" (docs/EVENTS.md §2.18): the id of the calendar new events go to; null for the platform default ("Personal", else the first local calendar).</summary>
    public string? DefaultCalendarId { get; set; }

    /// <summary>Whether the navigation pane is expanded on wide windows.</summary>
    public bool PaneExpanded { get; set; } = true;

    /// <summary>The 13-month date picker's tab last used on this device (docs/EVENTS.md §2.12): "gregorian", or null for the 13-month tab.</summary>
    public string? DatePickerTab { get; set; }

    /// <summary>The main window's last normal bounds and state, or null before the first close.</summary>
    public WindowPlacement? Window { get; set; }

    /// <summary>A copy (the store never hands out the instance it saves).</summary>
    public AppSettings Clone() => new()
    {
        Theme = Theme,
        Appearance = Appearance,
        System = System,
        ShowsGregorianOverlay = ShowsGregorianOverlay,
        ShowsYearEvents = ShowsYearEvents,
        DefaultCalendarId = DefaultCalendarId,
        PaneExpanded = PaneExpanded,
        DatePickerTab = DatePickerTab,
        Window = Window is null ? null : Window with { },
    };
}

/// <summary>Where the main window was: position in physical pixels, size in device-independent pixels.</summary>
public sealed record WindowPlacement
{
    /// <summary>Left edge in screen pixels.</summary>
    public int X { get; init; }

    /// <summary>Top edge in screen pixels.</summary>
    public int Y { get; init; }

    /// <summary>Client width in device-independent pixels.</summary>
    public double Width { get; init; }

    /// <summary>Client height in device-independent pixels.</summary>
    public double Height { get; init; }

    /// <summary>Whether the window was maximized.</summary>
    public bool Maximized { get; init; }
}

/// <summary>Source-generated JSON metadata (trimming safe, no reflection).</summary>
[JsonSourceGenerationOptions(
    WriteIndented = true,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    ReadCommentHandling = JsonCommentHandling.Skip,
    AllowTrailingCommas = true,
    UseStringEnumConverter = true)]
[JsonSerializable(typeof(AppSettings))]
internal sealed partial class SettingsJsonContext : JsonSerializerContext
{
}

/// <summary>Loads and saves <see cref="AppSettings"/>.</summary>
public interface ISettingsStore
{
    /// <summary>The stored settings, or defaults when there are none or they cannot be read.</summary>
    AppSettings Load();

    /// <summary>Stores the settings (best effort: a failure is logged, never thrown).</summary>
    void Save(AppSettings settings);
}

/// <summary>A JSON file store; writes go to a temporary file first and replace the old file in one step.</summary>
public sealed class SettingsStore : ISettingsStore
{
    /// <summary>Uses <paramref name="path"/>, or <see cref="DefaultPath"/>.</summary>
    public SettingsStore(string? path = null, bool readOnly = false)
    {
        Path = path ?? DefaultPath;
        ReadOnly = readOnly;
    }

    /// <summary><c>%APPDATA%\Thirteen\settings.json</c> (the roaming application data folder on Windows).</summary>
    public static string DefaultPath =>
        global::System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Thirteen", "settings.json");

    /// <summary>The settings file.</summary>
    public string Path { get; }

    /// <summary>When true, <see cref="Save"/> does nothing (screenshot and QA runs with command-line overrides).</summary>
    public bool ReadOnly { get; }

    /// <inheritdoc />
    public AppSettings Load()
    {
        try
        {
            if (!File.Exists(Path)) return new AppSettings();
            using var stream = File.OpenRead(Path);
            return JsonSerializer.Deserialize(stream, SettingsJsonContext.Default.AppSettings) ?? new AppSettings();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or NotSupportedException)
        {
            Trace.TraceWarning($"Thirteen: could not read {Path}, using defaults: {e.Message}");
            return new AppSettings();
        }
    }

    /// <inheritdoc />
    public void Save(AppSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        if (ReadOnly) return;
        try
        {
            var directory = global::System.IO.Path.GetDirectoryName(Path);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            var temporary = Path + ".tmp";
            File.WriteAllBytes(temporary, JsonSerializer.SerializeToUtf8Bytes(settings, SettingsJsonContext.Default.AppSettings));
            File.Move(temporary, Path, overwrite: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Trace.TraceWarning($"Thirteen: could not write {Path}: {e.Message}");
        }
    }
}

/// <summary>An in-memory store (tests).</summary>
public sealed class MemorySettingsStore : ISettingsStore
{
    private AppSettings _settings;

    /// <summary>Starts with <paramref name="initial"/> or defaults.</summary>
    public MemorySettingsStore(AppSettings? initial = null) => _settings = initial?.Clone() ?? new AppSettings();

    /// <summary>How many times <see cref="Save"/> ran.</summary>
    public int SaveCount { get; private set; }

    /// <summary>The last saved settings.</summary>
    public AppSettings Current => _settings.Clone();

    /// <inheritdoc />
    public AppSettings Load() => _settings.Clone();

    /// <inheritdoc />
    public void Save(AppSettings settings)
    {
        _settings = settings.Clone();
        SaveCount++;
    }
}
