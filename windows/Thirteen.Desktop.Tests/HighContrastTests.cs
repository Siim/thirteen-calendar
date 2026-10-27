using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Styling;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.Controls;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Themes;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views;
using CalendarMode = Thirteen.Desktop.ViewModels.CalendarMode;

namespace Thirteen.Desktop.Tests;

/// <summary>
/// Windows contrast themes (docs/EVENTS.md §2.20 "Forced colors and high contrast", §6.4 "Text size and contrast"): the
/// system colours replace the theme, and the Calendar's drawn chips, bars, blocks, dots and band follow the web's
/// forced-colors rules. Checked on the rendered pixels with the four Windows 11 contrast themes standing in for the
/// system (<c>--high-contrast</c>); on Windows the colours come from <c>GetSysColor</c>. Set THIRTEEN_TEST_SCREENSHOTS to
/// a folder to save what they render.
/// </summary>
public class HighContrastTests
{
    [Fact]
    public void LaunchOptionPicksAContrastTheme()
    {
        Assert.Same(HighContrastColors.Aquatic, LaunchOptions.Parse(["--high-contrast"]).HighContrast);
        Assert.Same(HighContrastColors.Desert, LaunchOptions.Parse(["--high-contrast", "desert"]).HighContrast);
        Assert.Same(HighContrastColors.NightSky, LaunchOptions.Parse(["--high-contrast", "Night sky"]).HighContrast);
        Assert.Same(HighContrastColors.Dusk, LaunchOptions.Parse(["--high-contrast", "DUSK"]).HighContrast);

        // A switch, a link or a file after it is not its value.
        var withSwitch = LaunchOptions.Parse(["--high-contrast", "--fake-events"]);
        Assert.Same(HighContrastColors.Aquatic, withSwitch.HighContrast);
        Assert.True(withSwitch.FakeEvents);
        Assert.Empty(withSwitch.Errors);
        var withLink = LaunchOptions.Parse(["--high-contrast", "thirteen://month/2026/11"]);
        Assert.Same(HighContrastColors.Aquatic, withLink.HighContrast);
        Assert.NotNull(withLink.Link);

        // A name that is not understood is reported and Aquatic is used; the run is read-only either way.
        var bad = LaunchOptions.Parse(["--high-contrast", "neon"]);
        Assert.Same(HighContrastColors.Aquatic, bad.HighContrast);
        Assert.Contains(bad.Errors, e => e.StartsWith("--high-contrast:", StringComparison.Ordinal));
        Assert.True(bad.IsReadOnly);
        Assert.Null(LaunchOptions.Parse(["--fake-events"]).HighContrast);
    }

    [Fact]
    public void SystemColoursAreFollowedOnlyOnWindows()
    {
        var high = new PlatformColorValues { ContrastPreference = ColorContrastPreference.High };
        var none = new PlatformColorValues { ContrastPreference = ColorContrastPreference.NoPreference };
        Assert.Equal(OperatingSystem.IsWindows(), HighContrastColors.IsRequested(high));
        Assert.False(HighContrastColors.IsRequested(none));
        Assert.False(HighContrastColors.IsRequested(null));
        if (!OperatingSystem.IsWindows()) Assert.Null(HighContrastColors.ReadSystem());
    }

    [AvaloniaFact]
    public void AContrastThemeReplacesEveryRole()
    {
        foreach (var colors in HighContrastColors.Presets.Values)
        {
            var dictionary = ThemeResources.Build(ThirteenTheme.Forest, colors);
            foreach (var variant in new[] { ThemeVariant.Default, ThemeVariant.Light, ThemeVariant.Dark })
            {
                var r = (IResourceDictionary)dictionary.ThemeDictionaries[variant];
                Color C(string key) => (Color)r[key + "Color"]!;
                Assert.Equal(colors.Canvas, C("ThPaper"));
                Assert.Equal(colors.Canvas, C("ThPaperRaised"));
                Assert.Equal(colors.Canvas, C("ThPaperSunk"));
                Assert.Equal(colors.CanvasText, C("ThInk"));
                Assert.Equal(colors.CanvasText, C("ThInk2"));
                Assert.Equal(colors.CanvasText, C("ThInk3"));
                Assert.Equal(colors.CanvasText, C("ThRule"));
                Assert.Equal(colors.Highlight, C("ThAccent"));
                Assert.Equal(colors.HighlightText, C("ThOnAccent"));
                Assert.Equal(colors.LinkText, C("ThAccentText"));
                Assert.Equal(true, r["ThHighContrast"]);
                Assert.Equal(colors.CanvasText, (Color)r["ThDotRingColor"]!);
                Assert.Equal(colors.Highlight, ((ISolidColorBrush)r["ThSelectedRing"]!).Color);

                // Text on every surface the contrast theme fills reads at 4.5:1 or more: the selected and hover washes,
                // today's Highlight, and a control's tint.
                Assert.True(ThemeResources.Contrast(colors.CanvasText, C("ThAccentWash")) >= 4.5, $"{colors.Name}: ink on accent-wash");
                Assert.True(ThemeResources.Contrast(colors.CanvasText, C("ThAccentSoft")) >= 4.5, $"{colors.Name}: ink on accent-soft");
                Assert.True(ThemeResources.Contrast(colors.HighlightText, colors.Highlight) >= 4.5, $"{colors.Name}: HighlightText on Highlight");
                Assert.True(ThemeResources.Contrast(C("ThOnControlTint"), C("ThControlTint")) >= 4.5, $"{colors.Name}: text on the control tint");
            }
        }

        // The themes themselves say nothing of contrast.
        var plain = (IResourceDictionary)ThemeResources.Build(ThirteenTheme.Forest).ThemeDictionaries[ThemeVariant.Light];
        Assert.Equal(false, plain["ThHighContrast"]);
        Assert.Equal(Colors.Transparent, (Color)plain["ThDotRingColor"]!);
        Assert.Equal(Colors.Transparent, ((ISolidColorBrush)plain["ThSelectedRing"]!).Color);
    }

    [AvaloniaFact]
    public void MonthAndWeekDrawTheForcedColorsLook()
    {
        var app = (App)Application.Current!;
        try
        {
            var colors = HighContrastColors.Desert;
            var (window, model) = Open("--high-contrast", "desert", "--page", "calendar");
            Assert.False(app.FollowsSystemContrast);
            Assert.Same(colors, app.Themes!.HighContrast);
            // Desert is light; the saved theme and appearance are untouched underneath.
            Assert.Equal(ThemeVariant.Light, app.ActualThemeVariant);
            Assert.Equal(CalendarMode.Month, model.CalendarPage.Mode);
            Save(window, "windows-high-contrast-desert-month.png");

            // Every chip, bar and the band are in their contrast look.
            var chips = window.GetVisualDescendants().OfType<EventChipVisual>().Where(c => c.IsEffectivelyVisible).ToArray();
            Assert.NotEmpty(chips);
            Assert.All(chips, c => Assert.True(c.HighContrast, c.Title));
            Assert.All(window.GetVisualDescendants().OfType<HatchFill>(), h => Assert.True(h.HighContrast));

            // Today's number on Highlight with HighlightText.
            var today = window.GetVisualDescendants().OfType<Border>().Single(b => b.Classes.Contains("dayNumber") && b.Classes.Contains("today"));
            Assert.Equal(colors.Highlight, ((ISolidColorBrush)today.Background!).Color);
            Assert.Equal(colors.HighlightText, ((ISolidColorBrush)today.GetVisualDescendants().OfType<TextBlock>().First().Foreground!).Color);

            // A bar is Canvas with a CanvasText border: no tint and no colored edge.
            var frame = window.CaptureRenderedFrame()!;
            // The selected day (today) has the 2 px Highlight ring inside it.
            var selected = window.GetVisualDescendants().OfType<Button>().Single(b => b.Classes.Contains("monthCell") && b.Classes.Contains("selected"));
            var cell = selected.TranslatePoint(new Point(0, 0), window)!.Value;
            AssertPixel(frame, cell + new Point(2, selected.Bounds.Height - 30), colors.Highlight, "the selected day's ring");
            var bar = chips.First(c => c.IsBar && c.Title == "Autumn school break" && !c.ContinuesBefore);
            var origin = bar.TranslatePoint(new Point(0, 0), window)!.Value;
            var size = bar.Bounds.Size;
            AssertPixel(frame, origin + new Point(0.5, size.Height / 2), colors.CanvasText, "the bar's left border");
            AssertPixel(frame, origin + new Point(3.5, size.Height / 2), colors.Canvas, "inside the bar, where the colored edge was");
            AssertPixel(frame, origin + new Point(size.Width / 2, 0.5), colors.CanvasText, "the bar's top border");
            AssertPixel(frame, origin + new Point(size.Width - 3, size.Height - 3), colors.Canvas, "the bar's fill");

            // Week: blocks and the now line.
            model.CalendarPage.Mode = CalendarMode.Week;
            Settle();
            AvaloniaHeadlessPlatform.ForceRenderTimerTick();
            Settle();
            Save(window, "windows-high-contrast-desert-week.png");
            var blocks = window.GetVisualDescendants().OfType<TimelineBlockVisual>().Where(b => b.IsEffectivelyVisible && !b.IsDraft).ToArray();
            Assert.NotEmpty(blocks);
            Assert.All(blocks, b => Assert.True(b.HighContrast, b.Title));
            var grids = window.GetVisualDescendants().OfType<TimelineDayGrid>().ToArray();
            Assert.All(grids, g => Assert.True(g.HighContrast));
            var todayGrid = grids.Single(g => g.IsToday);
            Assert.NotNull(todayGrid.NowMinute);
            Assert.Equal(colors.Highlight, todayGrid.AccentColor);

            // The contrast theme turned off (Windows' setting): the chosen theme is back at once.
            app.Themes.HighContrast = null;
            Settle();
            Assert.All(window.GetVisualDescendants().OfType<TimelineBlockVisual>().Where(b => b.IsEffectivelyVisible), b => Assert.False(b.HighContrast));
            Assert.NotEqual(colors.Highlight, window.GetVisualDescendants().OfType<TimelineDayGrid>().First().AccentColor);
            window.Close();
        }
        finally
        {
            app.Themes!.HighContrast = null;
        }
    }

    [AvaloniaFact]
    public void ADarkContrastThemeRunsDarkWithRingedDots()
    {
        var app = (App)Application.Current!;
        try
        {
            var colors = HighContrastColors.Aquatic;
            var (window, model) = Open("--high-contrast", "--page", "year", "--mode", "light");
            Assert.Same(colors, app.Themes!.HighContrast);
            Assert.Equal(ThemeVariant.Dark, app.ActualThemeVariant);
            Assert.Equal(CalendarMode.Year, model.CalendarPage.Mode);
            Save(window, "windows-high-contrast-aquatic-year.png");
            var dots = window.GetVisualDescendants().OfType<EventDots>().Where(d => d.DotColors is { Count: > 0 }).ToArray();
            Assert.NotEmpty(dots);
            Assert.All(dots, d => Assert.Equal(colors.CanvasText, d.RingColor));

            model.CalendarPage.Mode = CalendarMode.Month;
            Settle();
            Save(window, "windows-high-contrast-aquatic-month.png");
            Assert.All(window.GetVisualDescendants().OfType<EventChipVisual>().Where(c => c.IsEffectivelyVisible), c => Assert.True(c.HighContrast));
            window.Close();
        }
        finally
        {
            app.Themes!.HighContrast = null;
        }

        // A window without the option follows the system again (not a contrast theme on this machine).
        var (plain, _) = Open("--page", "calendar");
        Assert.True(app.FollowsSystemContrast);
        Assert.Null(app.Themes!.HighContrast);
        Assert.All(plain.GetVisualDescendants().OfType<EventChipVisual>().Where(c => c.IsEffectivelyVisible), c => Assert.False(c.HighContrast));
        plain.Close();
    }

    private static (MainWindow Window, MainViewModel Model) Open(params string[] args)
    {
        var options = LaunchOptions.Parse([.. args, "--fake-events", "--width", "1440", "--height", "900"]);
        var window = ((App)Application.Current!).CreateMainWindow(options, new MemorySettingsStore());
        var model = (MainViewModel)window.DataContext!;
        var store = new FakeEventStore();
        store.LoadAsync().GetAwaiter().GetResult();
        var host = new EventsHost(store, new SubscriptionService(store, time: store.Clock), refreshes: false);
        App.AttachEvents(model, host);
        window.Show();
        Settle();
        return (window, model);
    }

    private static void Settle()
    {
        for (var i = 0; i < 4; i++) Dispatcher.UIThread.RunJobs();
    }

    private static void Save(Window window, string name)
    {
        if (Environment.GetEnvironmentVariable("THIRTEEN_TEST_SCREENSHOTS") is not { Length: > 0 } folder) return;
        Directory.CreateDirectory(folder);
        window.CaptureRenderedFrame()?.Save(Path.Combine(folder, name));
    }

    /// <summary>Asserts the rendered pixel at a window point is <paramref name="expected"/> (within 3 per channel).</summary>
    private static void AssertPixel(WriteableBitmap frame, Point point, Color expected, string what)
    {
        var actual = Pixel(frame, (int)Math.Floor(point.X), (int)Math.Floor(point.Y));
        var close = Math.Abs(actual.R - expected.R) <= 3 && Math.Abs(actual.G - expected.G) <= 3 && Math.Abs(actual.B - expected.B) <= 3;
        Assert.True(close, $"{what}: expected {expected}, got {actual} at {point}");
    }

    private static Color Pixel(WriteableBitmap frame, int x, int y)
    {
        using var buffer = frame.Lock();
        var bytes = new byte[4];
        Marshal.Copy(buffer.Address + y * buffer.RowBytes + x * 4, bytes, 0, 4);
        return buffer.Format == PixelFormat.Rgba8888
            ? Color.FromArgb(bytes[3], bytes[0], bytes[1], bytes[2])
            : Color.FromArgb(bytes[3], bytes[2], bytes[1], bytes[0]);
    }
}
