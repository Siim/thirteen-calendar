using Avalonia;
using Avalonia.Headless.XUnit;
using Avalonia.Styling;
using Avalonia.Threading;
using Thirteen.Core;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.Themes;
using Thirteen.Desktop.ViewModels;
using static Thirteen.Desktop.Tests.Dates;

namespace Thirteen.Desktop.Tests;

/// <summary>Every command-line option and thirteen:// link form on the real window, and bad values ignored safely.</summary>
public class LaunchOptionTests
{
    private static readonly AppSettings Saved = new() { Theme = "forest", Appearance = "light", System = "positivist", ShowsGregorianOverlay = false };

    private static (Views.MainWindow Window, MainViewModel Model, MemorySettingsStore Store) Open(params string[] args)
    {
        var store = new MemorySettingsStore(Saved.Clone());
        var window = ((App)Application.Current!).CreateMainWindow(LaunchOptions.Parse(args), store);
        window.Show();
        Dispatcher.UIThread.RunJobs();
        return (window, (MainViewModel)window.DataContext!, store);
    }

    [AvaloniaTheory]
    [InlineData("today", AppSection.Today)]
    [InlineData("calendar", AppSection.Calendar)]
    [InlineData("year", AppSection.Calendar)]
    [InlineData("convert", AppSection.Convert)]
    [InlineData("compare", AppSection.Compare)]
    [InlineData("history", AppSection.History)]
    [InlineData("settings", AppSection.Settings)]
    [InlineData("SETTINGS", AppSection.Settings)]
    public void EveryPage(string id, AppSection section)
    {
        var (window, model, _) = Open("--page", id);
        Assert.Equal(section, model.Section);
        Assert.True(model.CurrentPage.IsActive);
        window.Close();
    }

    [AvaloniaFact]
    public void EveryThemeAndMode()
    {
        foreach (var theme in ThemeTokens.Ordered)
        {
            foreach (var mode in new[] { "light", "dark", "system" })
            {
                var (window, model, _) = Open("--theme", theme.Id(), "--mode", mode);
                Assert.Equal(theme, model.State.Theme);
                Assert.Equal(AppearanceModes.FromId(mode), model.State.Appearance);
                var expected = theme.IsAlwaysDark() ? ThemeVariant.Dark : mode switch
                {
                    "light" => ThemeVariant.Light,
                    "dark" => ThemeVariant.Dark,
                    _ => ThemeVariant.Default,
                };
                Assert.Equal(expected, Application.Current!.RequestedThemeVariant);
                window.Close();
            }
        }
    }

    [AvaloniaFact]
    public void SystemDateYearSelectAndSize()
    {
        var (window, model, _) = Open("--system", "ifc", "--date", "2024-12-31", "--year", "2030", "--select", "2024-06-17",
            "--width", "1100", "--height", "700");
        Assert.Equal(CalendarSystemId.Ifc, model.State.System);
        Assert.Equal(Day("2024-12-31"), model.State.Today);
        Assert.Equal("Today is Year Day", model.SummaryCountdown);
        Assert.Equal(2030, model.CalendarPage.YearMode.Year);    // --year wins over --select's year
        Assert.Equal(2030, model.ComparePage.Year);
        Assert.Equal(Day("2024-06-17"), model.Detail!.Date);
        Assert.Equal(1100, window.Width);
        Assert.Equal(700, window.Height);
        window.Close();

        (window, model, _) = Open("--select", "2024-06-17", "--maximized");
        Assert.Equal(2024, model.CalendarPage.YearMode.Year);     // --select alone opens its year
        Assert.Equal(Avalonia.Controls.WindowState.Maximized, window.WindowState);
        window.Close();
    }

    [AvaloniaFact]
    public void BadValuesAreReportedIgnoredAndNeverSaved()
    {
        string[] args =
        [
            "--page", "agenda", "--theme", "neon", "--mode", "sepia", "--system", "julian", "--date", "2026-02-30",
            "--select", "0000-01-01", "--year", "10000", "--width", "-5", "--height", "tall", "--scroll", "sideways",
            "thirteen://nowhere",
        ];
        var options = LaunchOptions.Parse(args);
        Assert.Equal(11, options.Errors.Count);
        Assert.All(options.Errors, e => Assert.DoesNotContain('–', e));
        Assert.True(options.IsReadOnly);        // a mistyped QA run still never writes settings.json
        Assert.Null(options.Link);

        // The settings file the app would use for this run (read-only, as App.OnFrameworkInitializationCompleted makes it).
        var path = global::System.IO.Path.Combine(global::System.IO.Path.GetTempPath(), $"thirteen-{Guid.NewGuid():N}", "settings.json");
        new SettingsStore(path).Save(Saved);
        var before = File.ReadAllBytes(path);
        try
        {
            var window = ((App)Application.Current!).CreateMainWindow(options, new SettingsStore(path, readOnly: options.IsReadOnly));
            window.Show();
            Dispatcher.UIThread.RunJobs();
            var model = (MainViewModel)window.DataContext!;
            Assert.Equal(AppSection.Today, model.Section);                       // saved choices stay in force
            Assert.Equal(ThirteenTheme.Forest, model.State.Theme);
            Assert.Equal(AppearanceMode.Light, model.State.Appearance);
            Assert.Equal(CalendarSystemId.Positivist, model.State.System);
            Assert.False(model.HasDetail);
            Assert.True(window.Width >= window.MinWidth);
            model.State.System = CalendarSystemId.Ifc;                          // even a choice made in the run
            window.Close();
            Assert.Equal(before, File.ReadAllBytes(path));
        }
        finally
        {
            Directory.Delete(global::System.IO.Path.GetDirectoryName(path)!, recursive: true);
        }

        // A switch without its value, or followed by another switch.
        Assert.Null(LaunchOptions.Parse(["--page"]).Page);
        var shifted = LaunchOptions.Parse(["--page", "--theme", "slate"]);
        Assert.Null(shifted.Page);
        Assert.Equal(ThirteenTheme.Slate, shifted.Theme);
        Assert.Single(shifted.Errors);
        Assert.False(LaunchOptions.Parse(["thirteen://today"]).IsReadOnly);   // a link joins the running instance
    }

    [Theory]
    [InlineData("thirteen://today", DeepLinkKind.Today, null, null, null)]
    [InlineData("THIRTEEN://Today", DeepLinkKind.Today, null, null, null)]
    [InlineData("thirteen:today", DeepLinkKind.Today, null, null, null)]
    [InlineData("thirteen:///year/2026", DeepLinkKind.Year, 2026, null, null)]
    [InlineData("thirteen://year/2024?day=2024-06-17", DeepLinkKind.Year, 2024, "2024-06-17", null)]
    [InlineData("thirteen://year?day=2024-06-17", DeepLinkKind.Year, null, "2024-06-17", null)]
    [InlineData("thirteen://year/abc?day=2024-13-01", DeepLinkKind.Year, null, null, null)]
    [InlineData("thirteen://year/0", DeepLinkKind.Year, null, null, null)]
    [InlineData("thirteen://year/9999", DeepLinkKind.Year, 9999, null, null)]
    [InlineData("thirteen://convert?date=0001-01-01", DeepLinkKind.Convert, null, "0001-01-01", ConvertDirection.FromGregorian)]
    [InlineData("thirteen://convert/9999-12-31", DeepLinkKind.Convert, null, "9999-12-31", ConvertDirection.FromGregorian)]
    [InlineData("thirteen://convert?thirteen=2024-LD", DeepLinkKind.Convert, null, "2024-06-17", ConvertDirection.FromThirteen)]
    [InlineData("thirteen://convert?thirteen=2025-LD", DeepLinkKind.Convert, null, null, null)]            // no Leap Day in 2025
    [InlineData("thirteen://convert?thirteen=2025-LD&date=2025-01-01", DeepLinkKind.Convert, null, "2025-01-01", ConvertDirection.FromGregorian)]
    [InlineData("thirteen://convert?thirteen=0238-YD&system=positivist", DeepLinkKind.Convert, null, "2026-12-31", ConvertDirection.FromThirteen)]
    [InlineData("thirteen://convert?thirteen=-1787-M01-01&system=positivist", DeepLinkKind.Convert, null, "0001-01-01", ConvertDirection.FromThirteen)]
    [InlineData("thirteen://convert?date=2026-02-29", DeepLinkKind.Convert, null, null, null)]
    [InlineData("thirteen://compare/1582", DeepLinkKind.Compare, 1582, null, null)]
    [InlineData("thirteen://compare?year=10000", DeepLinkKind.Compare, null, null, null)]
    [InlineData("thirteen://history#top", DeepLinkKind.History, null, null, null)]
    public void LinkForms(string url, DeepLinkKind kind, int? year, string? day, ConvertDirection? direction)
    {
        var link = DeepLink.TryParse(url);
        Assert.NotNull(link);
        Assert.Equal(kind, link.Kind);
        Assert.Equal(year, link.Year);
        Assert.Equal(day is null ? null : Day(day), link.Day);
        Assert.Equal(direction, link.Direction);
    }

    [Theory]
    [InlineData("thirteen://")]
    [InlineData("thirteen://nowhere/2026")]
    [InlineData("thirteenx://today")]
    [InlineData("https://thirteen.haugas.dev/")]
    [InlineData("today")]
    [InlineData("")]
    public void NotThirteenLinks(string url) => Assert.Null(DeepLink.TryParse(url));

    [AvaloniaFact]
    public void LinksOnTheCommandLineOpenTheirScreen()
    {
        var (window, model, store) = Open("thirteen://convert?thirteen=0236-M07-01&system=ifc");
        // system=ifc reads the numeric date in IFC: 0236-M07-01 is Sol 1 of IFC year 236.
        Assert.Equal(AppSection.Convert, model.Section);
        Assert.Equal(ConvertDirection.FromThirteen, model.ConvertPage.Direction);
        Assert.Equal(new ThirteenMonthDate(236, 7, 1, CalendarSystemId.Ifc).Gregorian, model.ConvertPage.ConvertDay);
        Assert.Equal(CalendarSystemId.Ifc, model.State.System);
        window.Close();
        Assert.Equal("ifc", store.Current.System);            // a link's system is a real choice and is kept

        (window, model, _) = Open("thirteen://year/2024?day=2024-06-17&system=positivist");
        Assert.Equal(AppSection.Calendar, model.Section);
        Assert.Equal(CalendarMode.Year, model.CalendarPage.Mode);
        Assert.Equal(2024, model.CalendarPage.YearMode.Year);
        Assert.Equal(Day("2024-06-17"), model.Detail!.Date);
        Assert.Contains("Leap Day", model.Detail.Content.Detail.OtherSystemText);
        window.Close();
    }

    [AvaloniaFact]
    public void CalendarModesRoutesAndTextScale()
    {
        // --page year: Calendar in Year mode (the section Calendar replaced).
        var (window, model, _) = Open("--page", "year");
        Assert.Equal(AppSection.Calendar, model.Section);
        Assert.Equal(CalendarMode.Year, model.CalendarPage.Mode);
        window.Close();

        // --calendar-mode alone opens Calendar in that mode.
        (window, model, _) = Open("--calendar-mode", "list");
        Assert.Equal(AppSection.Calendar, model.Section);
        Assert.Equal(CalendarMode.List, model.CalendarPage.Mode);
        Assert.Equal("Upcoming", model.CalendarPage.PeriodTitle);
        window.Close();

        // --route: a §2.22 route without its scheme.
        // Month 12 of IFC 2026 is November (Sol is month 7); today is not in it, so it opens on day 1.
        (window, model, _) = Open("--system", "ifc", "--date", "2026-10-19", "--route", "month/2026/12");
        Assert.Equal(AppSection.Calendar, model.Section);
        Assert.Equal(CalendarMode.Month, model.CalendarPage.Mode);
        Assert.Equal("November 2026", model.CalendarPage.PeriodTitle);
        Assert.Equal("Gregorian Nov 5 to Dec 2", model.CalendarPage.PeriodSubtitle);
        Assert.Equal(Day("2026-11-05"), model.CalendarPage.Date);
        window.Close();

        (window, model, _) = Open("--route", "week/2026-10-19", "--text-scale", "150%");
        Assert.Equal(1.5, model.State.TextScale);
        Assert.Equal(CalendarMode.Week, model.CalendarPage.Mode);
        Assert.Equal(CalendarMode.Day, model.CalendarPage.DisplayedMode);   // Week falls back to Day at large text
        window.Close();

        var options = LaunchOptions.Parse(["--route", "nowhere/1", "--calendar-mode", "agenda", "--text-scale", "huge", "--page", "2"]);
        Assert.Equal(4, options.Errors.Count);
        Assert.Null(options.Route);
        Assert.Null(options.CalendarMode);
        Assert.Null(options.TextScale);
        Assert.Null(options.Page);
        Assert.True(options.IsReadOnly);
        Assert.All(options.Errors, e => Assert.DoesNotContain('\u2013', e));
    }

    [Fact]
    public void FakeEventsFixToday()
    {
        // The mockup data set is about Monday, October 19, 2026 (§6.7): a --fake-events run is on that day.
        var fake = LaunchOptions.Parse(["--fake-events"]);
        Assert.True(fake.FakeEvents);
        Assert.True(fake.IsReadOnly);
        Assert.Equal(LaunchOptions.MockupToday, fake.Today);
        Assert.Equal(Day("2026-10-19"), LaunchOptions.MockupToday);
        // --date still wins.
        Assert.Equal(Day("2027-01-01"), LaunchOptions.Parse(["--fake-events", "--date", "2027-01-01"]).Today);
        Assert.Null(LaunchOptions.Parse([]).Today);

        var host = EventsHost.Create(fake, null);
        try
        {
            Assert.IsType<FakeEventStore>(host.Store);
        }
        finally
        {
            host.Dispose();
        }
    }
}
