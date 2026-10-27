using System.Text.Json;
using Thirteen.Core;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Themes;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Tests;

/// <summary>%APPDATA%\Thirteen\settings.json and the app state that persists into it.</summary>
public sealed class SettingsTests : IDisposable
{
    private readonly string _folder = Path.Combine(Path.GetTempPath(), "thirteen-tests-" + Guid.NewGuid().ToString("N"));

    private string SettingsPath => Path.Combine(_folder, "Thirteen", "settings.json");

    public void Dispose()
    {
        if (Directory.Exists(_folder)) Directory.Delete(_folder, recursive: true);
    }

    [Fact]
    public void DefaultPathIsUnderAppData()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        Assert.Equal(Path.Combine(appData, "Thirteen", "settings.json"), SettingsStore.DefaultPath);
    }

    [Fact]
    public void MissingFileGivesDefaults()
    {
        var settings = new SettingsStore(SettingsPath).Load();
        Assert.Equal("almanac", settings.Theme);
        Assert.Equal("system", settings.Appearance);
        Assert.Equal("ifc", settings.System);
        Assert.True(settings.ShowsGregorianOverlay);
        Assert.True(settings.PaneExpanded);
        Assert.Null(settings.Window);
    }

    [Fact]
    public void SaveCreatesTheFolderAndRoundTrips()
    {
        var store = new SettingsStore(SettingsPath);
        store.Save(new AppSettings
        {
            Theme = "slate",
            Appearance = "dark",
            System = "positivist",
            ShowsGregorianOverlay = false,
            PaneExpanded = false,
            Window = new WindowPlacement { X = 120, Y = 80, Width = 1200, Height = 800, Maximized = true },
        });
        Assert.True(File.Exists(SettingsPath));
        Assert.False(File.Exists(SettingsPath + ".tmp"));

        var loaded = new SettingsStore(SettingsPath).Load();
        Assert.Equal("slate", loaded.Theme);
        Assert.Equal("dark", loaded.Appearance);
        Assert.Equal("positivist", loaded.System);
        Assert.False(loaded.ShowsGregorianOverlay);
        Assert.False(loaded.PaneExpanded);
        Assert.Equal(new WindowPlacement { X = 120, Y = 80, Width = 1200, Height = 800, Maximized = true }, loaded.Window);

        // Human-readable camelCase JSON.
        using var json = JsonDocument.Parse(File.ReadAllText(SettingsPath));
        Assert.Equal("slate", json.RootElement.GetProperty("theme").GetString());
        Assert.False(json.RootElement.GetProperty("showsGregorianOverlay").GetBoolean());
    }

    [Fact]
    public void CorruptFileGivesDefaults()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        File.WriteAllText(SettingsPath, "{ \"theme\": ");
        Assert.Equal("almanac", new SettingsStore(SettingsPath).Load().Theme);
        File.WriteAllText(SettingsPath, "null");
        Assert.Equal("almanac", new SettingsStore(SettingsPath).Load().Theme);
    }

    [Fact]
    public void ReadOnlyStoreNeverWrites()
    {
        var store = new SettingsStore(SettingsPath, readOnly: true);
        store.Save(new AppSettings { Theme = "forest" });
        Assert.False(File.Exists(SettingsPath));
    }

    [Fact]
    public void UnknownValuesFallBack()
    {
        var shell = new TestShell(settings: new AppSettings { Theme = "neon", Appearance = "sepia", System = "julian" });
        Assert.Equal(ThirteenTheme.Almanac, shell.State.Theme);
        Assert.Equal(AppearanceMode.System, shell.State.Appearance);
        Assert.Equal(CalendarSystemId.Ifc, shell.State.System);
    }

    [Fact]
    public void StoredValuesAreRead()
    {
        var shell = new TestShell(settings: new AppSettings { Theme = "mono", Appearance = "light", System = "positivist", ShowsGregorianOverlay = false });
        Assert.Equal(ThirteenTheme.Mono, shell.State.Theme);
        Assert.Equal(AppearanceMode.Light, shell.State.Appearance);
        Assert.Equal(CalendarSystemId.Positivist, shell.State.System);
        Assert.False(shell.State.ShowsGregorianOverlay);
        Assert.True(shell.Model.IsPositivist);
    }

    [Fact]
    public void EveryChoiceIsSavedOnce()
    {
        var shell = new TestShell();
        shell.State.System = CalendarSystemId.Positivist;
        shell.State.ShowsGregorianOverlay = false;
        shell.State.Theme = ThirteenTheme.Forest;
        shell.State.Appearance = AppearanceMode.Dark;
        shell.State.PaneExpanded = false;
        shell.State.WindowPlacement = new WindowPlacement { X = 1, Y = 2, Width = 900, Height = 700 };
        Assert.Equal(6, shell.Store.SaveCount);

        // Setting the same values again writes nothing.
        shell.State.System = CalendarSystemId.Positivist;
        shell.State.Theme = ThirteenTheme.Forest;
        shell.State.PaneExpanded = false;
        Assert.Equal(6, shell.Store.SaveCount);

        var saved = shell.Store.Current;
        Assert.Equal("positivist", saved.System);
        Assert.False(saved.ShowsGregorianOverlay);
        Assert.Equal("forest", saved.Theme);
        Assert.Equal("dark", saved.Appearance);
        Assert.False(saved.PaneExpanded);
        Assert.Equal(900, saved.Window!.Width);

        // A new session starts where the last one stopped.
        var next = new AppState(shell.Store, new NullThemeService(), () => TestShell.October19);
        Assert.Equal(ThirteenTheme.Forest, next.Theme);
        Assert.Equal(AppearanceMode.Dark, next.Appearance);
        Assert.Equal(CalendarSystemId.Positivist, next.System);
    }

    [Fact]
    public void AnAlwaysDarkThemeSurvivesARelaunchAndKeepsTheAppearance()
    {
        // The picker writes settings.json at once; the next start reads the same theme back.
        var first = new AppState(new SettingsStore(SettingsPath), new NullThemeService(), () => TestShell.October19);
        first.Appearance = AppearanceMode.Light;
        first.Theme = ThirteenTheme.Midnight;
        Assert.Equal("midnight", new SettingsStore(SettingsPath).Load().Theme);

        var themes = new NullThemeService();
        var next = new AppState(new SettingsStore(SettingsPath), themes, () => TestShell.October19);
        next.ApplyTheme();
        Assert.Equal(ThirteenTheme.Midnight, next.Theme);
        // Light stays saved underneath (the theme forces Dark while it is chosen, ThemeService.Variant).
        Assert.Equal((ThirteenTheme.Midnight, AppearanceMode.Light), themes.Calls[^1]);
        Assert.Equal(Avalonia.Styling.ThemeVariant.Dark, ThemeService.Variant(next.Theme, next.Appearance));
        Assert.Equal(Avalonia.Styling.ThemeVariant.Light, ThemeService.Variant(ThirteenTheme.Slate, next.Appearance));
    }

    [Fact]
    public void SettingsScreenWritesThroughToState()
    {
        var shell = new TestShell();
        var settings = shell.Model.SettingsPage;
        settings.Systems.Single(s => s.System == CalendarSystemId.Positivist).IsSelected = true;
        Assert.Equal(CalendarSystemId.Positivist, shell.State.System);
        Assert.True(settings.Systems.Single(s => s.System == CalendarSystemId.Positivist).IsSelected);
        Assert.False(settings.Systems.Single(s => s.System == CalendarSystemId.Ifc).IsSelected);

        settings.ShowsGregorianOverlay = false;
        Assert.False(shell.State.ShowsGregorianOverlay);
        Assert.False(shell.Model.CalendarPage.YearMode.ShowsGregorianOverlay);

        Assert.Equal("Thirteen 1.0.0", settings.VersionText);
    }
}
