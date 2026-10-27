using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Core;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.Themes;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views;
using static Thirteen.Desktop.Tests.Dates;

namespace Thirteen.Desktop.Tests;

/// <summary>What the user set up survives a theme change, a resize, midnight and a relaunch.</summary>
public class StateTests
{
    private static MainWindow Show(ISettingsStore store, params string[] args)
    {
        var window = ((App)Application.Current!).CreateMainWindow(LaunchOptions.Parse(args), store);
        window.Show();
        Dispatcher.UIThread.RunJobs();
        return window;
    }

    private sealed record Snapshot(
        AppSection Section, int Year, int CompareYear, GregorianDate ConvertDay, ConvertDirection Direction, GregorianDate? Detail,
        bool Overlay, CalendarSystemId System, int SelectedCells, double YearScroll);

    private static Snapshot Take(MainWindow window, MainViewModel model)
    {
        var scroller = window.GetVisualDescendants().OfType<ScrollViewer>().FirstOrDefault(s => s.Name == "Scroller" && s.IsEffectivelyVisible);
        return new Snapshot(
            model.Section, model.CalendarPage.YearMode.Year, model.ComparePage.Year, model.ConvertPage.ConvertDay, model.ConvertPage.Direction,
            model.Detail?.Date, model.State.ShowsGregorianOverlay, model.State.System,
            model.CalendarPage.YearMode.Content.Months.Sum(m => m.Grid.Cells.Count(c => c.IsSelected) + m.Intercalary.Count(i => i.IsSelected)),
            Math.Round(scroller?.Offset.Y ?? -1));
    }

    [AvaloniaFact]
    public void ThemeChangesAndResizesKeepEveryScreensState()
    {
        var window = Show(new MemorySettingsStore(), "--width", "1400", "--height", "900");
        var model = (MainViewModel)window.DataContext!;
        model.ConvertPage.ConvertDay = Day("2024-06-17");
        model.ConvertPage.IsFromThirteen = true;
        model.ComparePage.Year = 1999;
        model.State.System = CalendarSystemId.Positivist;
        model.State.ShowsGregorianOverlay = false;
        model.ShowInYear(Day("2030-12-31"));
        Dispatcher.UIThread.RunJobs();
        var scroller = window.GetVisualDescendants().OfType<ScrollViewer>().First(s => s.Name == "Scroller" && s.IsEffectivelyVisible);
        scroller.Offset = new Vector(0, 400);
        Dispatcher.UIThread.RunJobs();
        var before = Take(window, model);
        Assert.Equal(1, before.SelectedCells);
        Assert.Equal(400, before.YearScroll);

        foreach (var theme in ThemeTokens.Ordered)
        {
            foreach (var mode in AppearanceModes.Ordered)
            {
                model.State.Theme = theme;
                model.State.Appearance = mode;
                Dispatcher.UIThread.RunJobs();
                Assert.Equal(before, Take(window, model));
            }
        }

        foreach (var width in new[] { 700.0, 1100, 1600 })
        {
            window.Width = width;
            Dispatcher.UIThread.RunJobs();
            Assert.Equal(before with { YearScroll = 0 }, Take(window, model) with { YearScroll = 0 });
            Assert.True(window.FindControl<Border>("DetailHost")!.IsVisible);
        }
        Assert.True(model.IsPaneOpen);              // back on a wide window the pane opens as it was
        Assert.True(model.State.PaneExpanded);
        window.Close();
    }

    [AvaloniaFact]
    public void ARelaunchStartsWhereTheLastSessionStopped()
    {
        var store = new MemorySettingsStore();
        var window = Show(store, "--width", "1100", "--height", "760");
        var model = (MainViewModel)window.DataContext!;
        model.State.Theme = ThirteenTheme.Phosphor;
        model.State.Appearance = AppearanceMode.Light;
        model.State.System = CalendarSystemId.Positivist;
        model.State.ShowsGregorianOverlay = false;
        model.IsPaneOpen = false;
        window.Close();

        // A real (not read-only) start: no options, the saved placement.
        var next = Show(store);
        var again = (MainViewModel)next.DataContext!;
        Assert.Equal(ThirteenTheme.Phosphor, again.State.Theme);
        Assert.Equal(AppearanceMode.Light, again.State.Appearance);          // kept under the always-dark theme
        Assert.Equal(Avalonia.Styling.ThemeVariant.Dark, Application.Current!.RequestedThemeVariant);
        Assert.Equal(CalendarSystemId.Positivist, again.State.System);
        Assert.False(again.State.ShowsGregorianOverlay);
        Assert.False(again.IsPaneOpen);
        Assert.Equal(1100, next.Width);
        Assert.Equal(760, next.Height);
        Assert.Equal(AppSection.Today, again.Section);                       // like the Apple apps, a new session opens on Today
        next.Close();
    }

    [AvaloniaFact]
    public void MidnightMovesTodayEverywhereAndKeepsWhatTheUserPicked()
    {
        var now = Day("2026-12-31");
        var store = new MemorySettingsStore();
        var themes = ((App)Application.Current!).Themes!;
        var state = new AppState(store, themes, () => now);
        var model = new MainViewModel(state);
        var window = new MainWindow { DataContext = model };
        window.Show();
        Dispatcher.UIThread.RunJobs();
        model.ShowDetail(Day("2026-06-01"));
        model.Section = AppSection.Calendar;
        Dispatcher.UIThread.RunJobs();
        Assert.Equal("Year Day", model.TodayPage.Content.Hero.IntercalaryName);

        now = Day("2027-01-01");
        state.RefreshToday();
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(2027, model.CalendarPage.YearMode.Year);
        Assert.Equal("1", model.TodayPage.Content.Hero.Numeral);
        Assert.Equal("January", model.TodayPage.Content.Hero.Month);
        Assert.Equal("364 days until Year Day", model.SummaryCountdown);
        Assert.Equal(Day("2026-06-01"), model.Detail!.Date);                 // the open day stays open
        Assert.True(model.CalendarPage.YearMode.Content.Months[0].Grid.Cells[0].IsToday);
        Assert.Equal(Day("2027-01-01"), model.SettingsPage.Preview.Comparison.Gregorian);
        Assert.Equal(2027, model.ComparePage.Year);
        Assert.Equal(1, model.ComparePage.Content.MarkedDayOfYear);
        window.Close();
    }

    [AvaloniaTheory]
    [InlineData("0001-01-01", "ifc", "1")]
    [InlineData("0001-01-01", "positivist", "-1787")]
    [InlineData("9999-12-31", "ifc", "9999")]
    [InlineData("9999-12-31", "positivist", "8211")]
    public void TheEndsOfTheRangeWorkOnEveryScreen(string iso, string system, string displayYear)
    {
        var window = Show(new MemorySettingsStore(), "--date", iso, "--select", iso, "--system", system, "--width", "1400", "--height", "900");
        var model = (MainViewModel)window.DataContext!;
        foreach (var section in Enum.GetValues<AppSection>())
        {
            model.Section = section;
            Dispatcher.UIThread.RunJobs();
        }
        Assert.Equal(displayYear, model.CalendarPage.YearMode.Content.Header.YearText);
        Assert.Equal(displayYear, model.ComparePage.Content.Header.YearText);
        Assert.Equal(displayYear, model.TodayPage.Content.Hero.Year);
        var first = iso.StartsWith("0001", StringComparison.Ordinal);
        Assert.Equal(!first, model.CalendarPage.YearMode.PreviousYearCommand.CanExecute(null));
        Assert.Equal(first, model.CalendarPage.YearMode.NextYearCommand.CanExecute(null));
        Assert.Equal(!first, model.Detail!.PreviousDayCommand.CanExecute(null));
        Assert.Equal(first, model.Detail.NextDayCommand.CanExecute(null));
        Assert.Equal(first ? 7 : 1, model.ComparePage.Content.DriftYears.Count);   // the drift strip stops at 9999
        model.StepPeriod(first ? -1 : 1);                                            // Ctrl+Left / Ctrl+Right stop too
        Assert.Equal(first ? 1 : 9999, model.ComparePage.Year);
        Assert.Equal(first ? "364 days until " : "Today is ", model.SummaryCountdown[..(first ? 15 : 9)]);
        window.Close();
    }
}
