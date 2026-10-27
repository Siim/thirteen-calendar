using Thirteen.Core;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;
using static Thirteen.Desktop.Tests.Dates;

namespace Thirteen.Desktop.Tests;

/// <summary>Sections, the day details pane, Home, year stepping, deep links and the midnight roll-over.</summary>
public class NavigationTests
{
    [Fact]
    public void StartsOnTodayWithFiveSectionsAndSettings()
    {
        var model = new TestShell().Model;
        Assert.Equal(AppSection.Today, model.Section);
        Assert.Equal(["Today", "Calendar", "Convert", "Compare", "History"], model.NavItems.Select(i => i.Title));
        Assert.Equal("Settings", model.SettingsItem.Title);
        Assert.Equal(["Today (Ctrl+1)", "Calendar (Ctrl+2)", "Convert (Ctrl+3)", "Compare (Ctrl+4)", "History (Ctrl+5)"], model.NavItems.Select(i => i.ToolTip));
        Assert.Equal("Settings (Ctrl+,)", model.SettingsItem.ToolTip);
        Assert.True(model.NavItems[0].IsSelected);
        Assert.Same(model.TodayPage, model.CurrentPage);
        Assert.False(model.HasDetail);
    }

    [Fact]
    public void NavigateSelectsExactlyOneSection()
    {
        var model = new TestShell().Model;
        foreach (var section in Enum.GetValues<AppSection>())
        {
            model.NavigateCommand.Execute(section);
            Assert.Equal(section, model.Section);
            Assert.Single(model.Pages, p => p.IsActive);
            Assert.Equal(section, model.Pages.Single(p => p.IsActive).Section);
            Assert.Equal(section == AppSection.Settings, model.SettingsItem.IsSelected);
            Assert.Equal(section is not (AppSection.Settings or AppSection.Calendar), model.ShowsSystemSwitch);
            foreach (var item in model.NavItems) Assert.Equal(item.Section == section, item.IsSelected);
        }
    }

    [Fact]
    public void PaneItemsNavigateWhenChecked()
    {
        var model = new TestShell().Model;
        model.NavItems.Single(i => i.Section == AppSection.Compare).IsSelected = true;
        Assert.Equal(AppSection.Compare, model.Section);
        model.SettingsItem.IsSelected = true;
        Assert.Equal(AppSection.Settings, model.Section);
        Assert.False(model.NavItems.Single(i => i.Section == AppSection.Compare).IsSelected);
    }

    [Fact]
    public void PagesAreBuiltOnFirstVisitAndKept()
    {
        var model = new TestShell().Model;
        Assert.NotNull(model.TodayPage.Loaded);
        Assert.Null(model.CalendarPage.Loaded);
        Assert.Null(model.HistoryPage.Loaded);
        model.Section = AppSection.Calendar;
        Assert.Same(model.CalendarPage, model.CalendarPage.Loaded);
        // Only the mode on screen is built (Month on first launch, §2.1).
        Assert.NotNull(model.CalendarPage.MonthMode.Loaded);
        Assert.Null(model.CalendarPage.YearMode.Loaded);
        model.Section = AppSection.Today;
        Assert.Same(model.CalendarPage, model.CalendarPage.Loaded);
    }

    [Fact]
    public void SectionIdsRoundTrip()
    {
        foreach (var section in Enum.GetValues<AppSection>()) Assert.Equal(section, AppSections.FromId(section.Id()));
        Assert.Equal(AppSection.Calendar, AppSections.FromId("calendar"));
        Assert.Null(AppSections.FromId("year"));                 // Year is a Calendar mode now
        Assert.Null(AppSections.FromId("1"));
    }

    [Fact]
    public void DetailPaneOpensStepsAndCloses()
    {
        var model = new TestShell().Model;
        model.Section = AppSection.Calendar;
        model.ShowDetail(Day("2026-03-01"));
        Assert.True(model.HasDetail);
        Assert.Equal(Day("2026-03-01"), model.Detail!.Date);
        Assert.True(model.Detail.IsNotToday);

        model.Detail.NextDayCommand.Execute(null);
        Assert.Equal(Day("2026-03-02"), model.Detail.Date);
        model.Detail.PreviousDayCommand.Execute(null);
        model.Detail.PreviousDayCommand.Execute(null);
        Assert.Equal(Day("2026-02-28"), model.Detail.Date);
        model.Detail.TodayCommand.Execute(null);
        Assert.Equal(TestShell.October19, model.Detail.Date);
        Assert.False(model.Detail.IsNotToday);

        // Opening another day reuses the pane.
        var pane = model.Detail;
        model.ShowDetail(Day("2026-12-31"));
        Assert.Same(pane, model.Detail);
        Assert.Contains("Year Day", model.Detail.Content.Title);

        model.EscapeCommand.Execute(null);
        Assert.False(model.HasDetail);
    }

    [Fact]
    public void ShowInYearAndOpenInConverter()
    {
        var model = new TestShell().Model;
        model.ShowInYear(Day("2024-06-17"));
        Assert.Equal(AppSection.Calendar, model.Section);
        Assert.Equal(CalendarMode.Year, model.CalendarPage.Mode);
        Assert.Equal(2024, model.CalendarPage.YearMode.Year);
        Assert.Equal(Day("2024-06-17"), model.Detail!.Date);

        model.Detail.OpenInConverterCommand.Execute(null);
        Assert.Equal(AppSection.Convert, model.Section);
        Assert.Equal(Day("2024-06-17"), model.ConvertPage.ConvertDay);
        Assert.Equal(ConvertDirection.FromGregorian, model.ConvertPage.Direction);
        Assert.False(model.HasDetail);
    }

    [Fact]
    public void HomeMeansTodayInEachScreen()
    {
        var model = new TestShell().Model;
        model.Section = AppSection.Calendar;
        model.CalendarPage.YearMode.Year = 1999;
        model.HomeCommand.Execute(null);
        Assert.Equal(AppSection.Calendar, model.Section);
        Assert.Equal(TestShell.October19, model.CalendarPage.Date);

        model.Section = AppSection.Compare;
        model.ComparePage.Year = 2100;
        model.HomeCommand.Execute(null);
        Assert.Equal(2026, model.ComparePage.Year);

        model.Section = AppSection.Convert;
        model.ConvertPage.ConvertDay = Day("2000-01-01");
        model.HomeCommand.Execute(null);
        Assert.Equal(TestShell.October19, model.ConvertPage.ConvertDay);

        model.Section = AppSection.History;
        model.HomeCommand.Execute(null);
        Assert.Equal(AppSection.Today, model.Section);
    }

    [Fact]
    public void GoToTodayResetsEveryScreen()
    {
        var model = new TestShell().Model;
        model.CalendarPage.YearMode.Year = 1900;
        model.ComparePage.Year = 1950;
        model.ConvertPage.ConvertDay = Day("1970-01-01");
        model.Section = AppSection.History;
        model.GoToTodayCommand.Execute(null);
        Assert.Equal(AppSection.Today, model.Section);
        Assert.Equal(TestShell.October19, model.CalendarPage.Date);
        Assert.Equal(2026, model.ComparePage.Year);
        Assert.Equal(TestShell.October19, model.ConvertPage.ConvertDay);

        // In Calendar, Ctrl+T is the toolbar's "Today" in the current mode (§2.21).
        model.Section = AppSection.Calendar;
        model.CalendarPage.Mode = CalendarMode.Week;
        model.CalendarPage.Date = Day("2025-01-01");
        model.GoToTodayCommand.Execute(null);
        Assert.Equal(AppSection.Calendar, model.Section);
        Assert.Equal(CalendarMode.Week, model.CalendarPage.Mode);
        Assert.Equal(TestShell.October19, model.CalendarPage.Date);
    }

    [Fact]
    public void PeriodSteppingIsClamped()
    {
        var model = new TestShell().Model;
        // From Today, Ctrl+Right opens Calendar and pages its mode (Month on first launch).
        model.NextPeriodCommand.Execute(null);
        Assert.Equal(AppSection.Calendar, model.Section);
        Assert.Equal(CalendarMode.Month, model.CalendarPage.Mode);
        Assert.Equal("November 2026", model.CalendarPage.PeriodTitle);
        model.PreviousPeriodCommand.Execute(null);
        Assert.Equal("October 2026", model.CalendarPage.PeriodTitle);

        model.CalendarPage.Mode = CalendarMode.Year;
        model.NextPeriodCommand.Execute(null);
        Assert.Equal(2027, model.CalendarPage.YearMode.Year);
        model.PreviousPeriodCommand.Execute(null);
        Assert.Equal(2026, model.CalendarPage.YearMode.Year);

        model.CalendarPage.YearMode.Year = 9999;
        model.StepPeriod(1);
        Assert.Equal(9999, model.CalendarPage.YearMode.Year);
        Assert.False(model.CalendarPage.NextCommand.CanExecute(null));
        model.CalendarPage.YearMode.Year = 1;
        model.StepPeriod(-1);
        Assert.Equal(1, model.CalendarPage.YearMode.Year);
        Assert.False(model.CalendarPage.PreviousCommand.CanExecute(null));

        model.Section = AppSection.Compare;
        model.StepPeriod(1);
        Assert.Equal(2027, model.ComparePage.Year);

        model.Section = AppSection.Settings;
        model.StepPeriod(1);
        Assert.Equal(AppSection.Settings, model.Section);
    }

    [Fact]
    public void SystemSwitchRebuildsScreens()
    {
        var shell = new TestShell();
        var model = shell.Model;
        model.Section = AppSection.Calendar;
        model.CalendarPage.Mode = CalendarMode.Year;
        Assert.Equal("January", model.CalendarPage.YearMode.Content.Months[0].Name);
        Assert.Contains(model.CalendarPage.YearMode.Content.Months, m => m.Name == "Sol");

        model.IsPositivist = true;
        Assert.Equal(CalendarSystemId.Positivist, shell.State.System);
        Assert.True(model.IsPositivist);
        Assert.False(model.IsIfc);
        Assert.Equal("Moses", model.CalendarPage.YearMode.Content.Months[0].Name);
        Assert.Equal("238", model.CalendarPage.YearMode.Content.Header.YearText);
        Assert.Equal("238", model.CalendarPage.PeriodTitle);
        Assert.Equal("Gregorian 2026", model.CalendarPage.PeriodSubtitle);
        Assert.Contains("Descartes 12", model.SummaryAutomationName);
        Assert.Equal("positivist", shell.Store.Current.System);
    }

    [Fact]
    public void RollsOverAtMidnight()
    {
        var shell = new TestShell(Day("2026-12-31"));
        var model = shell.Model;
        Assert.Equal("Today is Year Day", model.SummaryCountdown);
        model.CalendarPage.YearMode.Year = 2026;
        model.ConvertPage.ConvertDay = Day("2026-12-31");
        model.ComparePage.Year = 2030;

        shell.SetClock(Day("2027-01-01"));
        Assert.Equal(Day("2027-01-01"), shell.State.Today);
        Assert.Equal(2027, model.CalendarPage.YearMode.Year);    // was on today: follows
        Assert.Equal(Day("2027-01-01"), model.ConvertPage.ConvertDay);
        Assert.Equal(2030, model.ComparePage.Year);              // was elsewhere: stays
        Assert.Equal("364 days until Year Day", model.SummaryCountdown);
        Assert.Equal(Day("2027-01-01"), model.TodayPage.Content.Comparison.Gregorian);
    }

    [Theory]
    [InlineData("thirteen://today", AppSection.Today)]
    [InlineData("thirteen://history", AppSection.History)]
    [InlineData("thirteen://compare/2030", AppSection.Compare)]
    [InlineData("thirteen://year/2024", AppSection.Calendar)]
    [InlineData("thirteen://calendar", AppSection.Calendar)]
    [InlineData("thirteen://month/2026/13", AppSection.Calendar)]
    [InlineData("thirteen://week/2026-10-19", AppSection.Calendar)]
    [InlineData("thirteen://day/2026-10-19", AppSection.Calendar)]
    [InlineData("thirteen://new-event?date=2026-10-20", AppSection.Calendar)]
    [InlineData("thirteen://convert?date=2024-02-29", AppSection.Convert)]
    public void DeepLinksOpenTheirScreen(string url, AppSection section)
    {
        var link = DeepLink.TryParse(url);
        Assert.NotNull(link);
        var model = new TestShell().Model;
        model.Open(link);
        Assert.Equal(section, model.Section);
        Assert.Equal(link, DeepLink.TryParse(link.ToUrl()));
    }

    [Fact]
    public void DeepLinkDetails()
    {
        var model = new TestShell().Model;
        model.Open(DeepLink.TryParse("thirteen://year/2024?day=2024-06-17")!);
        Assert.Equal(CalendarMode.Year, model.CalendarPage.Mode);
        Assert.Equal(2024, model.CalendarPage.YearMode.Year);
        Assert.Equal(Day("2024-06-17"), model.Detail!.Date);

        model.Open(DeepLink.TryParse("thirteen://convert?date=2024-02-29")!);
        Assert.Equal(Day("2024-02-29"), model.ConvertPage.ConvertDay);
        Assert.False(model.HasDetail);

        model.Open(DeepLink.TryParse("thirteen://compare?year=1999&system=positivist")!);
        Assert.Equal(1999, model.ComparePage.Year);
        Assert.Equal(CalendarSystemId.Positivist, model.State.System);

        Assert.Null(DeepLink.TryParse("https://example.com/year/2024"));
        Assert.Null(DeepLink.TryParse("thirteen://nowhere"));
        Assert.Null(DeepLink.TryParse("thirteen://year/10000")!.Year); // out-of-range year: the screen, not the year
        Assert.Equal(DeepLinkKind.Convert, DeepLink.TryParse("thirteen://convert?thirteen=2026-07-01")!.Kind);
        Assert.Null(DeepLink.TryParse(null));
    }

    [Fact]
    public void LaunchOptionsAreParsed()
    {
        var options = LaunchOptions.Parse(["--page", "year", "--theme", "slate", "--mode", "dark", "--system", "positivist",
            "--date", "2026-10-19", "--select", "2026-06-17", "--width", "1100", "--scroll", "bottom"]);
        Assert.Equal(AppSection.Calendar, options.Page);
        Assert.Equal(CalendarMode.Year, options.CalendarMode);
        Assert.Equal(Themes.ThirteenTheme.Slate, options.Theme);
        Assert.Equal(Themes.AppearanceMode.Dark, options.Mode);
        Assert.Equal(CalendarSystemId.Positivist, options.System);
        Assert.Equal(TestShell.October19, options.Today);
        Assert.Equal(Day("2026-06-17"), options.Select);
        Assert.Equal(1100, options.Width);
        Assert.Equal("bottom", options.Scroll);
        Assert.True(options.IsReadOnly);
        Assert.Empty(options.Errors);

        var plain = LaunchOptions.Parse([]);
        Assert.False(plain.IsReadOnly);
        Assert.Null(plain.Page);

        var bad = LaunchOptions.Parse(["--theme", "neon", "--page", "agenda", "--mode", "sepia"]);
        Assert.Equal(3, bad.Errors.Count);
        Assert.Null(bad.Theme);

        var link = LaunchOptions.Parse(["thirteen://history"]);
        Assert.Equal(DeepLinkKind.History, link.Link!.Kind);
        Assert.False(link.IsReadOnly);
    }

    [Fact]
    public void ThirteenPickerKeepsTheSlot()
    {
        // IFC Leap Day 2024 moved to 2025 (no Leap Day) falls back to June 28.
        var leapDay = new ThirteenPickerLogic(CalendarSystemId.Ifc, Day("2024-06-17"));
        Assert.True(leapDay.Thirteen.IsIntercalary);
        Assert.Equal(Day("2025-06-17"), leapDay.SettingDisplayYear(2025));
        Assert.Equal(new ThirteenMonthDate(2025, 6, 28, CalendarSystemId.Ifc).Gregorian, leapDay.SettingDisplayYear(2025));
        Assert.Equal(Day("2024-06-17"), leapDay.SettingDisplayYear(0));

        var october12 = new ThirteenPickerLogic(CalendarSystemId.Ifc, TestShell.October19);
        Assert.Equal(12, october12.MonthDay);
        Assert.Equal(new ThirteenMonthDate(2026, 11, 28, CalendarSystemId.Ifc).Gregorian, october12.SettingMonthDay(28));
        Assert.Equal(TestShell.October19, october12.SettingMonthDay(29));
        Assert.Equal(new ThirteenMonthDate(2026, 7, 12, CalendarSystemId.Ifc).Gregorian, october12.SettingSlot(october12.Slots[6].Key));
        Assert.Equal("Sol", ThirteenPickerLogic.Label(october12.Slots[6]));

        // Positivist display years count from 1789.
        var positivist = new ThirteenPickerLogic(CalendarSystemId.Positivist, TestShell.October19);
        Assert.Equal(238, positivist.DisplayYear);
        Assert.Equal(2027, positivist.SettingDisplayYear(239).Year);
    }
}
