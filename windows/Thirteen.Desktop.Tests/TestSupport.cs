using Avalonia;
using Avalonia.Headless;
using Thirteen.Core;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Themes;
using Thirteen.Desktop.ViewModels;

[assembly: AvaloniaTestApplication(typeof(Thirteen.Desktop.Tests.TestAppBuilder))]

namespace Thirteen.Desktop.Tests;

/// <summary>The real <see cref="App"/> (styles, fonts, theme service) on Avalonia's headless platform.</summary>
public static class TestAppBuilder
{
    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>().UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false })
            .UseSkia();
}

/// <summary>A main view model over in-memory settings, a recording theme service and a fixed clock.</summary>
internal sealed class TestShell
{
    public static readonly GregorianDate October19 = new(2026, 10, 19);

    private GregorianDate _now;

    public TestShell(GregorianDate? today = null, AppSettings? settings = null)
    {
        _now = today ?? October19;
        Store = new MemorySettingsStore(settings);
        Themes = new NullThemeService();
        State = new AppState(Store, Themes, () => _now);
        Model = new MainViewModel(State);
    }

    public MemorySettingsStore Store { get; }

    public NullThemeService Themes { get; }

    public AppState State { get; }

    public MainViewModel Model { get; }

    /// <summary>Moves the clock and lets the app notice, as the window's timer does.</summary>
    public void SetClock(GregorianDate now)
    {
        _now = now;
        State.RefreshToday();
    }
}

internal static class Dates
{
    public static GregorianDate Day(string iso) => GregorianDate.ParseIso(iso);
}
