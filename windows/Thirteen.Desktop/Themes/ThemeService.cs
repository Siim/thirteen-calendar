using Avalonia;
using Avalonia.Controls;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;

namespace Thirteen.Desktop.Themes;

/// <summary>Light, dark, or the Windows setting. Independent of the colour theme (design/DECISIONS.md).</summary>
public enum AppearanceMode
{
    /// <summary>Follow the Windows app mode (the default).</summary>
    System,

    /// <summary>Always light.</summary>
    Light,

    /// <summary>Always dark.</summary>
    Dark,
}

/// <summary>Stable ids for <see cref="AppearanceMode"/>, as stored in settings.json.</summary>
public static class AppearanceModes
{
    /// <summary>Every mode, in the order Settings lists them.</summary>
    public static IReadOnlyList<AppearanceMode> Ordered { get; } = [AppearanceMode.System, AppearanceMode.Light, AppearanceMode.Dark];

    /// <summary>"system", "light" or "dark".</summary>
    public static string Id(this AppearanceMode mode) => mode switch
    {
        AppearanceMode.Light => "light",
        AppearanceMode.Dark => "dark",
        _ => "system",
    };

    /// <summary>The mode with this id; <see cref="AppearanceMode.System"/> for null or unknown ids.</summary>
    public static AppearanceMode FromId(string? id) => id?.Trim().ToLowerInvariant() switch
    {
        "light" => AppearanceMode.Light,
        "dark" => AppearanceMode.Dark,
        _ => AppearanceMode.System,
    };

    /// <summary>The label in Settings.</summary>
    public static string DisplayName(this AppearanceMode mode) => mode switch
    {
        AppearanceMode.Light => "Light",
        AppearanceMode.Dark => "Dark",
        _ => "Use Windows setting",
    };
}

/// <summary>Applies a colour theme and an appearance to the running app.</summary>
public interface IThemeService
{
    /// <summary>Makes <paramref name="theme"/> and <paramref name="mode"/> current, at once, for every window.</summary>
    void Apply(ThirteenTheme theme, AppearanceMode mode);
}

/// <summary>A theme service that does nothing (tests of view models without an Avalonia application).</summary>
public sealed class NullThemeService : IThemeService
{
    /// <summary>Every call, in order.</summary>
    public List<(ThirteenTheme Theme, AppearanceMode Mode)> Calls { get; } = [];

    /// <inheritdoc />
    public void Apply(ThirteenTheme theme, AppearanceMode mode) => Calls.Add((theme, mode));
}

/// <summary>
/// Swaps the theme dictionary (<see cref="ThemeResources.Build"/>) in the application's resources and sets
/// <see cref="Application.RequestedThemeVariant"/>: Default follows Windows, Light and Dark pin the mode, and
/// an always-dark theme (Obsidian, Midnight, Phosphor) forces Dark whatever the mode, so Fluent's own
/// controls are dark too (design/DECISIONS.md). Views reference the theme's brushes with DynamicResource,
/// so the change is immediate, no restart.
/// </summary>
public sealed class ThemeService(Application application) : IThemeService
{
    private ResourceDictionary? _current;
    private ThirteenTheme? _currentTheme;
    private AppearanceMode _currentMode;
    private HighContrastColors? _contrast;
    private HighContrastColors? _appliedContrast;

    /// <summary>The theme now applied, or null before the first <see cref="Apply"/>.</summary>
    public ThirteenTheme? CurrentTheme => _currentTheme;

    /// <summary>
    /// The Windows contrast theme in force, or null (docs/EVENTS.md §2.20 "Forced colors and high contrast"). While it is
    /// set, every window paints with its system colours instead of the chosen theme (which stays saved and comes back
    /// when it is cleared), in the Dark variant when its background is dark. Setting it re-applies at once.
    /// </summary>
    public HighContrastColors? HighContrast
    {
        get => _contrast;
        set
        {
            if (Equals(_contrast, value)) return;
            _contrast = value;
            if (_currentTheme is { } theme) Apply(theme, _currentMode);
        }
    }

    /// <inheritdoc />
    public void Apply(ThirteenTheme theme, AppearanceMode mode)
    {
        _currentMode = mode;
        if (_currentTheme != theme || _current is null || !Equals(_appliedContrast, _contrast))
        {
            var next = _contrast is { } contrast ? ThemeResources.Build(theme, contrast) : ThemeResources.Build(theme);
            var merged = application.Resources.MergedDictionaries;
            // Replace whichever theme dictionary is in place (also one added by another service instance).
            var index = -1;
            for (var i = merged.Count - 1; i >= 0; i--)
            {
                if (merged[i] is not IResourceDictionary d || !d.ContainsKey(ThemeResources.ThemeIdKey)) continue;
                if (index >= 0) merged.RemoveAt(index);
                index = i;
            }
            if (index >= 0) merged[index] = next;
            else merged.Insert(0, next);
            _current = next;
            _currentTheme = theme;
            _appliedContrast = _contrast;
            if (application.Styles.OfType<FluentTheme>().FirstOrDefault() is { } fluent)
            {
                if (_contrast is { } colors) ThemeResources.ApplyFluentPalettes(fluent, colors);
                else ThemeResources.ApplyFluentPalettes(fluent, theme);
            }
        }
        application.RequestedThemeVariant = _contrast is { } c ? (c.IsDark ? ThemeVariant.Dark : ThemeVariant.Light) : Variant(theme, mode);
    }

    /// <summary>The variant the app runs in for <paramref name="theme"/> and <paramref name="mode"/>.</summary>
    public static ThemeVariant Variant(ThirteenTheme theme, AppearanceMode mode) => theme.ForcedThemeVariant() ?? mode switch
    {
        AppearanceMode.Light => ThemeVariant.Light,
        AppearanceMode.Dark => ThemeVariant.Dark,
        _ => ThemeVariant.Default,
    };
}
