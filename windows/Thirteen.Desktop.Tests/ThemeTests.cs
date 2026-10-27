using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Media;
using Avalonia.Styling;
using Thirteen.Desktop.Themes;

namespace Thirteen.Desktop.Tests;

/// <summary>The five light-and-dark themes and the three always-dark ones, switched at run time.</summary>
public class ThemeTests
{
    private static readonly string[] RequiredKeys =
    [
        "ThPaper", "ThPaperRaised", "ThPaperSunk", "ThInk", "ThInk2", "ThInk3", "ThRule", "ThAccent", "ThAccentText",
        "ThAccentWash", "ThOnAccent", "ThControlTint", "ThFoil", "ThFoilWash", "ThFocus", "ThCell", "ThCellHover",
        "ThPaperColor", "ThAccentColor", "ThInk3Color", "SystemAccentColor", "SystemAccentColorDark1", "SystemAccentColorLight1",
        "ButtonBackground", "TextControlBackground", "ComboBoxBackground", "CalendarViewBackground", "ToggleSwitchFillOn",
    ];

    [Fact]
    public void TokensListEightThemesWithAlmanacFirst()
    {
        Assert.Equal(
            [ThirteenTheme.Almanac, ThirteenTheme.Graphite, ThirteenTheme.Slate, ThirteenTheme.Forest, ThirteenTheme.Mono,
             ThirteenTheme.Obsidian, ThirteenTheme.Midnight, ThirteenTheme.Phosphor],
            ThemeTokens.Ordered);
        Assert.Equal(ThirteenTheme.Almanac, ThemeTokens.DefaultTheme);
        Assert.Equal([ThemeGroup.Adaptive, ThemeGroup.Dark], ThemeTokens.Groups);
        Assert.Equal([ThirteenTheme.Obsidian, ThirteenTheme.Midnight, ThirteenTheme.Phosphor], ThemeGroup.Dark.Themes());
        Assert.All(ThemeGroup.Dark.Themes(), t => Assert.Same(t.Palette(dark: true), t.Palette(dark: false)));
        foreach (var theme in ThemeTokens.Ordered)
        {
            Assert.Equal(theme, ThemeTokens.FromId(theme.Id()));
            Assert.False(string.IsNullOrWhiteSpace(theme.DisplayName()));
            Assert.DoesNotContain('—', theme.Summary());
            Assert.DoesNotContain('–', theme.Summary());
        }
    }

    [AvaloniaFact]
    public void EveryThemeHasEveryKeyInLightAndDark()
    {
        foreach (var theme in ThemeTokens.Ordered)
        {
            var dictionary = ThemeResources.Build(theme);
            foreach (var (variant, dark) in new[] { (ThemeVariant.Light, false), (ThemeVariant.Dark, true), (ThemeVariant.Default, false) })
            {
                var resources = (IResourceDictionary)dictionary.ThemeDictionaries[variant];
                foreach (var key in RequiredKeys) Assert.True(resources.ContainsKey(key), $"{theme} {variant}: {key}");
                var palette = theme.Palette(dark);
                Assert.Equal(palette.Paper, ((ISolidColorBrush)resources["ThPaper"]!).Color);
                Assert.Equal(palette.Accent, ((ISolidColorBrush)resources["ThAccent"]!).Color);
                Assert.Equal(palette.ControlTint, (Color)resources["SystemAccentColor"]!);
            }
        }
    }

    [AvaloniaFact]
    public void TextOnFilledControlsIsReadable()
    {
        foreach (var theme in ThemeTokens.Ordered)
        {
            foreach (var dark in new[] { false, true })
            {
                var p = theme.Palette(dark);
                var on = ThemeResources.OnColor(p.ControlTint, p);
                Assert.True(ThemeResources.Contrast(on, p.ControlTint) >= 3, $"{theme} dark={dark}: {ThemeResources.Contrast(on, p.ControlTint):0.00}");
                Assert.True(ThemeResources.Contrast(p.Ink, p.Paper) >= 7, $"{theme} dark={dark}: ink on paper");
            }
        }
    }

    /// <summary>
    /// The colours the Windows port derives itself, on the surfaces they sit on: the day cell (paper-sunk at
    /// 75% over a card), today's accent fill, red-letter Sundays, the small foil dates, the selection ring and
    /// the focus ring. Text needs 4.5:1 (WCAG AA, the figures are 10 to 16 px); rings and fills 3:1.
    /// </summary>
    [Fact]
    public void GridColoursAreReadableOnTheirCells()
    {
        static Color Over(Color top, Color under)
        {
            var a = top.A / 255.0;
            byte C(byte t, byte u) => (byte)Math.Round(t * a + u * (1 - a));
            return Color.FromRgb(C(top.R, under.R), C(top.G, under.G), C(top.B, under.B));
        }
        var problems = new List<string>();
        foreach (var theme in ThemeTokens.Ordered)
        {
            foreach (var dark in new[] { false, true })
            {
                var p = theme.Palette(dark);
                var cell = Over(ThemeResources.WithAlpha(p.PaperSunk, 0.75), p.PaperRaised);
                void Need(string what, Color a, Color b, double min)
                {
                    var ratio = ThemeResources.Contrast(a, b);
                    if (ratio < min) problems.Add($"{theme} {(dark ? "dark" : "light")}: {what} {ratio:0.00} < {min}");
                }
                Need("day number on cell", p.Ink, cell, 4.5);
                Need("Sunday number on cell", p.AccentText, cell, 4.5);
                Need("foil date on cell", p.Foil, cell, 4.5);
                Need("today number on accent", p.OnAccent, p.Accent, 4.5);
                Need("selection ring on cell", p.AccentText, cell, 3);
                Need("focus ring on paper", p.Focus, p.Paper, 3);
                Need("focus ring on card", p.Focus, p.PaperRaised, 3);
                Need("caption on card", p.InkTertiary, p.PaperRaised, 4.5);
                Need("foil caption on card", p.Foil, p.PaperRaised, 4.5);
            }
        }
        Assert.True(problems.Count == 0, string.Join("\n", problems));
    }

    [AvaloniaFact]
    public void ThemeServiceSwapsWithoutRestart()
    {
        var app = Application.Current!;
        var service = new ThemeService(app);
        var before = app.Resources.MergedDictionaries.Count;

        service.Apply(ThirteenTheme.Slate, AppearanceMode.Dark);
        Assert.Equal(ThemeVariant.Dark, app.RequestedThemeVariant);
        Assert.True(app.TryGetResource("ThAccent", ThemeVariant.Dark, out var slateAccent));
        Assert.Equal(ThirteenTheme.Slate.Palette(true).Accent, ((ISolidColorBrush)slateAccent!).Color);

        service.Apply(ThirteenTheme.Forest, AppearanceMode.Light);
        Assert.Equal(ThemeVariant.Light, app.RequestedThemeVariant);
        Assert.True(app.TryGetResource("ThAccent", ThemeVariant.Light, out var forestAccent));
        Assert.Equal(ThirteenTheme.Forest.Palette(false).Accent, ((ISolidColorBrush)forestAccent!).Color);
        Assert.Equal(ThirteenTheme.Forest, service.CurrentTheme);

        // One theme dictionary at a time, never stacked.
        Assert.True(app.Resources.MergedDictionaries.Count <= Math.Max(before, 1));

        // System follows the OS light/dark setting.
        service.Apply(ThirteenTheme.Almanac, AppearanceMode.System);
        Assert.Equal(ThemeVariant.Default, app.RequestedThemeVariant);

        // An always-dark theme is dark whatever the mode, so Fluent's own controls are dark too.
        foreach (var mode in AppearanceModes.Ordered)
        {
            service.Apply(ThirteenTheme.Midnight, mode);
            Assert.Equal(ThemeVariant.Dark, app.RequestedThemeVariant);
        }
        Assert.True(app.TryGetResource("ThPaper", ThemeVariant.Dark, out var midnightPaper));
        Assert.Equal(ThirteenTheme.Midnight.Palette(true).Paper, ((ISolidColorBrush)midnightPaper!).Color);
        service.Apply(ThirteenTheme.Almanac, AppearanceMode.System);
        Assert.Equal(ThemeVariant.Default, app.RequestedThemeVariant);
    }

    [AvaloniaFact]
    public void ControlsRepaintWhenTheThemeChanges()
    {
        var app = Application.Current!;
        var service = new ThemeService(app);
        service.Apply(ThirteenTheme.Almanac, AppearanceMode.Light);
        var border = new Border();
        border[!Border.BackgroundProperty] = new Avalonia.Markup.Xaml.MarkupExtensions.DynamicResourceExtension("ThPaper");
        var window = new Window { Content = border };
        window.Show();
        Assert.Equal(ThirteenTheme.Almanac.Palette(false).Paper, ((ISolidColorBrush)border.Background!).Color);

        service.Apply(ThirteenTheme.Graphite, AppearanceMode.Dark);
        Assert.Equal(ThirteenTheme.Graphite.Palette(true).Paper, ((ISolidColorBrush)border.Background!).Color);
        window.Close();
        service.Apply(ThirteenTheme.Almanac, AppearanceMode.System);
    }

    [Fact]
    public void AppStateAppliesThemeAndAppearance()
    {
        var shell = new TestShell();
        shell.State.ApplyTheme();
        Assert.Equal((ThirteenTheme.Almanac, AppearanceMode.System), shell.Themes.Calls[^1]);

        shell.State.Theme = ThirteenTheme.Slate;
        Assert.Equal((ThirteenTheme.Slate, AppearanceMode.System), shell.Themes.Calls[^1]);
        shell.State.Appearance = AppearanceMode.Dark;
        Assert.Equal((ThirteenTheme.Slate, AppearanceMode.Dark), shell.Themes.Calls[^1]);

        var count = shell.Themes.Calls.Count;
        shell.State.Theme = ThirteenTheme.Slate;
        Assert.Equal(count, shell.Themes.Calls.Count);
    }

    [Fact]
    public void SettingsPickerSwitchesTheme()
    {
        var shell = new TestShell();
        var settings = shell.Model.SettingsPage;
        Assert.Equal(8, settings.Themes.Count);
        Assert.Equal(["Light and dark", "Dark"], settings.ThemeGroups.Select(g => g.Name));
        Assert.Equal(5, settings.ThemeGroups[0].Themes.Count);
        Assert.Equal(3, settings.ThemeGroups[1].Themes.Count);
        Assert.Null(settings.ThemeGroups[1].SelectedTheme);
        Assert.Equal(ThirteenTheme.Almanac, settings.SelectedTheme!.Theme);

        settings.SelectedTheme = settings.Themes.Single(t => t.Theme == ThirteenTheme.Mono);
        Assert.Equal(ThirteenTheme.Mono, shell.State.Theme);
        Assert.Equal((ThirteenTheme.Mono, AppearanceMode.System), shell.Themes.Calls[^1]);
        Assert.StartsWith("Mono: ", settings.ThemeSummary);

        settings.Appearances.Single(a => a.Mode == AppearanceMode.Light).IsSelected = true;
        Assert.Equal(AppearanceMode.Light, shell.State.Appearance);
        Assert.Equal((ThirteenTheme.Mono, AppearanceMode.Light), shell.Themes.Calls[^1]);
        Assert.False(settings.Appearances.Single(a => a.Mode == AppearanceMode.System).IsSelected);

        Assert.Equal(["Use Windows setting", "Light", "Dark"], settings.Appearances.Select(a => a.Name));

        // Picking an always-dark theme locks the appearance on Dark (shown disabled with a note) and keeps
        // the saved choice for when a light-and-dark theme comes back.
        settings.ThemeGroups[1].SelectedTheme = settings.ThemeGroups[1].Themes.Single(t => t.Theme == ThirteenTheme.Phosphor);
        Assert.Equal(ThirteenTheme.Phosphor, shell.State.Theme);
        Assert.Null(settings.ThemeGroups[0].SelectedTheme);
        Assert.True(settings.IsAppearanceLocked);
        Assert.False(settings.IsAppearanceEnabled);
        Assert.Equal("Phosphor is always dark. Pick a light and dark theme to use Appearance again.", settings.AppearanceNote);
        Assert.True(settings.Appearances.Single(a => a.Mode == AppearanceMode.Dark).IsSelected);
        settings.Appearances.Single(a => a.Mode == AppearanceMode.System).IsSelected = true;
        Assert.Equal(AppearanceMode.Light, shell.State.Appearance);
        settings.SelectedTheme = settings.Themes.Single(t => t.Theme == ThirteenTheme.Forest);
        Assert.False(settings.IsAppearanceLocked);
        Assert.True(settings.Appearances.Single(a => a.Mode == AppearanceMode.Light).IsSelected);
    }
}
