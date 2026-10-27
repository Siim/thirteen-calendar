using Thirteen.Core;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;
using static Thirteen.Desktop.Tests.Dates;

namespace Thirteen.Desktop.Tests.CalendarSection;

/// <summary>
/// The Calendar section's models (docs/EVENTS.md §2.1 to §2.7, §2.20, §2.22) over the mockup data set (§6.7, today
/// Monday, October 19, 2026, which is IFC Thursday, October 12): paging and titles, routes, Month's grid, its
/// labels, lanes and "+N more", the list of days at large text, List's rows, Year's dots and the actions seam.
/// </summary>
public class CalendarModelTests
{
    /// <summary>A window model on the mockup data set, events attached and loaded, today 2026-10-19.</summary>
    internal static (TestShell Shell, CalendarViewModel Calendar, FakeEventStore Store) Mockup(GregorianDate? today = null, AppSettings? settings = null)
    {
        var shell = new TestShell(today ?? TestShell.October19, settings);
        var store = new FakeEventStore();
        store.LoadAsync().GetAwaiter().GetResult();
        shell.Model.AttachEvents(new EventsModel(store, post: action => action()));
        shell.Model.Section = AppSection.Calendar;
        return (shell, shell.Model.CalendarPage, store);
    }

    // ---- Paging and titles (§2.1) -------------------------------------------------------------------

    [Theory]
    [InlineData(CalendarMode.Year, "2026-10-19", "ifc", "2026", null)]
    [InlineData(CalendarMode.Year, "2026-10-19", "positivist", "238", "Gregorian 2026")]
    [InlineData(CalendarMode.Month, "2026-10-19", "ifc", "October 2026", "Gregorian Oct 8 to Nov 4")]
    [InlineData(CalendarMode.Month, "2026-10-19", "positivist", "Descartes 238", "Gregorian Oct 8 to Nov 4")]
    [InlineData(CalendarMode.Week, "2026-10-19", "ifc", "October 2026, week 2", "Gregorian Oct 15 to 21")]
    [InlineData(CalendarMode.Day, "2026-10-19", "ifc", "Thursday, October 12, 2026", "Gregorian Monday, October 19, 2026")]
    [InlineData(CalendarMode.Day, "2026-12-31", "ifc", "Year Day 2026", "Gregorian Thursday, December 31, 2026")]
    [InlineData(CalendarMode.List, "2026-10-19", "ifc", "Upcoming", null)]
    public void Titles(CalendarMode mode, string date, string system, string title, string? subtitle)
    {
        var id = system == "ifc" ? CalendarSystemId.Ifc : CalendarSystemId.Positivist;
        Assert.Equal((title, subtitle), CalendarPeriod.Titles(mode, Day(date), id));
        Assert.All(new[] { title, subtitle ?? "" }, t => Assert.False(t.Contains('–') || t.Contains('—')));
    }

    [Theory]
    [InlineData(CalendarMode.Month, "2026-10-19", 1, "2026-11-16")]      // IFC October 12 to November 12
    [InlineData(CalendarMode.Month, "2026-10-19", -1, "2026-09-21")]
    [InlineData(CalendarMode.Month, "2026-12-31", -1, "2026-12-02")]     // Year Day pages from day 28 of December: November 28
    [InlineData(CalendarMode.Week, "2026-10-19", 1, "2026-10-26")]
    [InlineData(CalendarMode.Week, "2026-12-24", 1, "2027-01-01")]      // week 4 of December to week 1 of January
    [InlineData(CalendarMode.Week, "2027-01-01", -1, "2026-12-24")]
    [InlineData(CalendarMode.Day, "2026-12-30", 1, "2026-12-31")]
    [InlineData(CalendarMode.Year, "2024-02-29", 1, "2025-02-28")]
    [InlineData(CalendarMode.List, "2026-10-19", 1, "2026-11-05")]       // a month at a time, from its first day
    public void Paging(CalendarMode mode, string from, int delta, string to) =>
        Assert.Equal(Day(to), CalendarPeriod.Step(Day(from), mode, delta, CalendarSystemId.Ifc));

    [Fact]
    public void PagingStopsAtTheEndsOfTheRange()
    {
        Assert.Null(CalendarPeriod.Step(Day("9999-12-31"), CalendarMode.Day, 1, CalendarSystemId.Ifc));
        Assert.Null(CalendarPeriod.Step(Day("0001-01-01"), CalendarMode.Month, -1, CalendarSystemId.Ifc));
        Assert.Null(CalendarPeriod.Step(Day("9999-06-01"), CalendarMode.Year, 1, CalendarSystemId.Ifc));
    }

    [Fact]
    public void TodayIsHiddenWhileTodayIsOnScreen()
    {
        var (_, calendar, _) = Mockup();
        Assert.Equal(CalendarMode.Month, calendar.Mode);           // first launch: Month, today (§2.1)
        Assert.Equal(TestShell.October19, calendar.Date);
        Assert.False(calendar.ShowsTodayButton);
        calendar.Page(1);
        Assert.True(calendar.ShowsTodayButton);
        Assert.Equal("November 2026. Gregorian Nov 5 to Dec 2.", calendar.Announcement);   // the polite announcement
        Assert.Equal("Next month", calendar.NextName);
        Assert.Equal("Previous month (Ctrl+Left)", calendar.PreviousTip);
        calendar.TodayCommand.Execute(null);
        Assert.False(calendar.ShowsTodayButton);
        Assert.Equal(TestShell.October19, calendar.Date);

        calendar.Mode = CalendarMode.Week;
        Assert.Equal("Previous week", calendar.PreviousName);
        calendar.Date = Day("2026-10-14");                         // week 1: still October, not today's week
        Assert.True(calendar.ShowsTodayButton);
        calendar.Mode = CalendarMode.Month;
        Assert.False(calendar.ShowsTodayButton);
        calendar.Mode = CalendarMode.List;
        Assert.True(calendar.ShowsTodayButton);                    // List starts at today only on today
        Assert.Equal("Previous month", calendar.PreviousName);
        calendar.Mode = CalendarMode.Year;
        Assert.False(calendar.ShowsTodayButton);
        Assert.Equal("Next year", calendar.NextName);
    }

    [Fact]
    public void ModesAreBuiltWhenShownAndRememberTheDay()
    {
        var (shell, calendar, _) = Mockup();
        Assert.True(calendar.MonthMode.IsActive);
        Assert.Null(calendar.ListMode.Loaded);
        calendar.Mode = CalendarMode.List;
        Assert.False(calendar.MonthMode.IsActive);
        Assert.Same(calendar.ListMode, calendar.ListMode.Loaded);
        Assert.Equal(["Day", "Week", "Month", "Year", "List"], calendar.ModeOptions.Select(o => o.Title));
        Assert.Equal("Week (Ctrl+Shift+2)", calendar.ModeOptions[1].ToolTip);
        Assert.True(calendar.ModeOptions[4].IsSelected);
        calendar.ModeOptions[0].IsSelected = true;
        Assert.Equal(CalendarMode.Day, calendar.Mode);

        // Week falls back to Day at 150 % text and above (§2.20 "Text size").
        calendar.Mode = CalendarMode.Week;
        Assert.Equal(CalendarMode.Week, calendar.DisplayedMode);
        shell.State.TextScale = 1.5;
        Assert.Equal(CalendarMode.Day, calendar.DisplayedMode);
        Assert.True(calendar.DayMode.IsActive);
        Assert.False(calendar.WeekMode.IsActive);
        shell.State.TextScale = 1;
        Assert.True(calendar.WeekMode.IsActive);

        // Leaving the section and coming back keeps the mode and the day.
        calendar.Date = Day("2026-11-16");
        shell.Model.Section = AppSection.Convert;
        Assert.False(calendar.WeekMode.IsActive);
        shell.Model.Section = AppSection.Calendar;
        Assert.Equal(CalendarMode.Week, calendar.Mode);
        Assert.Equal(Day("2026-11-16"), calendar.Date);
        Assert.True(calendar.WeekMode.IsActive);
    }

    // ---- Routes (§2.22) -----------------------------------------------------------------------------

    [Theory]
    [InlineData("thirteen://calendar", DeepLinkKind.Calendar, null, null, null)]
    [InlineData("thirteen://month/2026/11", DeepLinkKind.Month, 2026, 11, null)]
    [InlineData("thirteen://month?year=2026&month=13", DeepLinkKind.Month, 2026, 13, null)]
    [InlineData("thirteen://month/2026/14", DeepLinkKind.Month, 2026, null, null)]      // invalid: the route's screen with defaults
    [InlineData("thirteen://week/2026-10-19", DeepLinkKind.Week, null, null, "2026-10-19")]
    [InlineData("thirteen://day/2026-10-19?system=positivist", DeepLinkKind.Day, null, null, "2026-10-19")]
    [InlineData("thirteen://new-event?date=2026-10-20", DeepLinkKind.NewEvent, null, null, "2026-10-20")]
    [InlineData("thirteen://day/2026-02-30", DeepLinkKind.Day, null, null, null)]
    public void CalendarRoutes(string url, DeepLinkKind kind, int? year, int? month, string? day)
    {
        var link = DeepLink.TryParse(url);
        Assert.NotNull(link);
        Assert.Equal(kind, link.Kind);
        Assert.Equal(year, link.Year);
        Assert.Equal(month, link.Month);
        Assert.Equal(day is null ? null : Day(day), link.Day);
        Assert.Equal(link, DeepLink.TryParse(link.ToUrl()));
    }

    [Fact]
    public void RoutesOpenTheirMode()
    {
        var (shell, calendar, _) = Mockup();
        var model = shell.Model;
        var actions = new PlaceholderCalendarActions();
        var requests = new List<string>();
        actions.Requested += requests.Add;
        calendar.Actions = actions;

        model.Section = AppSection.Today;
        model.Open(DeepLink.TryParse("thirteen://month/2026/13")!);
        Assert.Equal(AppSection.Calendar, model.Section);
        Assert.Equal(CalendarMode.Month, calendar.Mode);
        Assert.Equal("December 2026", calendar.PeriodTitle);
        Assert.Equal(Day("2026-12-03"), calendar.Date);

        model.Open(DeepLink.TryParse("thirteen://week/2026-10-19")!);
        Assert.Equal(CalendarMode.Week, calendar.Mode);
        Assert.Equal("October 2026, week 2", calendar.PeriodTitle);

        model.Open(DeepLink.TryParse("thirteen://day/2026-12-31")!);
        Assert.Equal(CalendarMode.Day, calendar.Mode);
        Assert.Equal("Year Day 2026", calendar.PeriodTitle);

        model.Open(DeepLink.TryParse("thirteen://calendar")!);     // its last mode
        Assert.Equal(CalendarMode.Day, calendar.Mode);

        model.Open(DeepLink.TryParse("thirteen://year/2027")!);
        Assert.Equal(CalendarMode.Year, calendar.Mode);
        Assert.Equal(2027, calendar.YearMode.Year);

        model.Open(DeepLink.TryParse("thirteen://new-event?date=2026-10-20")!);
        Assert.Equal(Day("2026-10-20"), calendar.Date);
        Assert.Equal("new 2026-10-20 540", requests[^1]);           // 09:00 on another day than today (§2.4)
    }

    // ---- Month (§2.4) -------------------------------------------------------------------------------

    [Fact]
    public void MonthGridLabelsMatchTheSpec()
    {
        var (_, calendar, _) = Mockup();
        var month = calendar.MonthMode;
        Assert.Equal("October 2026, IFC", month.GridName);
        Assert.Equal(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], month.Weekdays.Select(w => w.Line1));
        Assert.Equal(["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"], month.Weekdays.Select(w => w.Line2));
        Assert.Equal("Sunday. Gregorian Thursday", month.Weekdays[0].AutomationName);
        Assert.Equal(4, month.Weeks.Count);
        Assert.False(month.HasBands);

        var cells = month.Weeks.SelectMany(w => w.Cells).ToArray();
        Assert.Equal(28, cells.Length);
        var today = cells.Single(c => c.IsToday);
        Assert.Equal(TestShell.October19, today.Date);
        Assert.Equal("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.", today.AutomationName);
        Assert.Equal("Today", today.ItemStatus);
        Assert.True(today.IsSelected);
        Assert.Equal(("12", "19"), (today.Number, today.GregorianDay));

        var november = cells.Single(c => c.Date == Day("2026-11-01"));
        Assert.Equal("Wednesday, October 25, 2026. Gregorian Sunday, November 1, 2026. Gregorian November begins.", november.AutomationName);
        Assert.Equal("NOV", november.GregorianMonthLabel);
        Assert.Null(today.GregorianMonthLabel);
        Assert.All(cells.Where(c => c.Column == 0), c => Assert.Equal(1, c.Thirteen.Day % 7));   // the Sundays 1, 8, 15, 22
    }

    [Fact]
    public void MonthChipsBarsAndMore()
    {
        var (_, calendar, _) = Mockup();
        var month = calendar.MonthMode;
        var week2 = month.Weeks[1];
        var chips = week2.Chips.ToArray();

        // A timed event is a dot with its start time; its name is calendar.item.a11y with the repeat flag.
        var sprint = chips.Single(c => c.Title == "Sprint planning");
        Assert.False(sprint.IsBar);
        Assert.Equal("09:30", sprint.Time);
        Assert.Equal("Sprint planning, 09:30 to 10:30, Work, repeats", sprint.AutomationName);
        Assert.Equal((4, 1), (sprint.Column, sprint.ColumnSpan));

        // A multi-day all-day event is a bar across the days it covers in the row, squared where it continues.
        var school = chips.Single(c => c.Title == "Autumn school break");
        Assert.True(school.IsBar);
        Assert.Equal((4, 3), (school.Column, school.ColumnSpan));
        Assert.False(school.ContinuesBefore);
        Assert.True(school.ContinuesAfter);
        Assert.Equal("Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family, continues to Gregorian Sunday, October 25",
            school.AutomationName);
        var rest = month.Weeks[2].Chips.Single(c => c.Title == "Autumn school break");
        Assert.Equal((0, 4), (rest.Column, rest.ColumnSpan));
        Assert.True(rest.ContinuesBefore);
        Assert.EndsWith(", Family, continues from Gregorian Monday, October 19", rest.AutomationName);

        // Unlimited lanes (no geometry yet): nothing is hidden.
        Assert.DoesNotContain(month.Weeks.SelectMany(w => w.Elements), e => e is MonthMore);

        // Two lanes: today keeps one lane of chips and "+N more" in the last, which lists the whole day.
        month.SetGeometry(80, 2);
        var row = month.Weeks[1];
        var more = row.Elements.OfType<MonthMore>().Single(m => m.Day == TestShell.October19);
        Assert.Equal(1, more.Lane);
        Assert.Equal("+4 more", more.Text);
        Assert.Equal("4 more events on Thursday, October 12, 2026", more.AutomationName);
        Assert.Equal("Thursday, October 12", more.Heading);
        Assert.Equal("Gregorian Mon, Oct 19", more.Caption);
        Assert.Equal(["All day", "09:30", "11:00", "15:40", "19:00"], more.Rows.Select(r => r.TimeText));
        Assert.Equal("Autumn school break", more.Rows[0].Title);
        Assert.Equal("Day 1 of 7", more.Rows[0].SubText);
        Assert.Equal("until 10:30", more.Rows[1].SubText);
        Assert.All(row.Chips.Where(c => c.Column <= 4 && 4 < c.Column + c.ColumnSpan), c => Assert.Equal(0, c.Lane));
    }

    [Fact]
    public void MonthIntercalaryBand()
    {
        var (_, calendar, _) = Mockup();
        calendar.ShowMonth(2026, 13);
        var month = calendar.MonthMode;
        Assert.True(month.HasBands);
        var band = Assert.Single(month.Bands);
        Assert.Equal("YD", band.Code);
        Assert.Equal("Year Day 2026", band.Name);
        Assert.Equal("Gregorian Thu, Dec 31", band.GregorianText);
        Assert.StartsWith("Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026.", band.AutomationName);

        // Positivist: the festivals follow Bichat.
        calendar.State.System = CalendarSystemId.Positivist;
        calendar.ShowMonth(2026, 13);
        Assert.Equal("Bichat 238", calendar.PeriodTitle);
        Assert.Single(calendar.MonthMode.Bands);
    }

    [Fact]
    public void MonthListOfDaysAtLargeText()
    {
        var (shell, calendar, _) = Mockup();
        var month = calendar.MonthMode;
        Assert.True(month.UsesGrid);
        shell.State.TextScale = 1.5;
        Assert.True(month.UsesDayList);
        Assert.False(month.UsesGrid);
        Assert.Equal(30, month.LaneHeight);

        var list = month.DayList;
        var days = list.OfType<MonthListDay>().ToArray();
        var today = days.Single(d => d.Date == TestShell.October19);
        Assert.Equal("Thursday, October 12", today.Heading);
        Assert.Equal("Gregorian Mon, Oct 19", today.Caption);
        Assert.Equal(3, today.Lines.Count);                       // up to three lines, then "+2 more" (opens Day)
        Assert.Equal("+2 more", today.MoreText);
        Assert.Equal("2 more events on Thursday, October 12, 2026", today.MoreName);
        Assert.True(today.IsToday);

        // Days without events: one line each, a run of two or more as "No events, {start} to {end}".
        var runs = list.OfType<MonthListEmptyRun>().ToArray();
        Assert.All(runs, r => Assert.True(r.Last > r.First));       // a single empty day is a row of its own, not a run
        Assert.All(runs, r => Assert.Matches(@"^No events, \w+ \d+ to \w+ \d+$", r.Text));
        // Every day of the month is in the list once, in a row or a run.
        static IEnumerable<GregorianDate> DaysOf(MonthListEmptyRun run)
        {
            for (var d = run.First; d <= run.Last; d = d.AddDays(1)) yield return d;
        }
        var covered = days.Select(d => d.Date).Concat(runs.SelectMany(DaysOf)).ToArray();
        Assert.Equal(28, covered.Distinct().Count());
        Assert.Equal(28, covered.Length);

        // Opening a run opens Day on its first day.
        if (runs.FirstOrDefault() is { } run)
        {
            run.OpenDayCommand.Execute(null);
            Assert.Equal(CalendarMode.Day, calendar.Mode);
            Assert.Equal(run.First, calendar.Date);
        }
    }

    [Fact]
    public void SelectingAndReadOnlyEvents()
    {
        var (shell, calendar, _) = Mockup();
        var actions = new PlaceholderCalendarActions();
        var requests = new List<string>();
        actions.Requested += requests.Add;
        calendar.Actions = actions;
        var month = calendar.MonthMode;

        var dentist = month.Weeks[1].Chips.Single(c => c.Title == "Dentist, Dr. Tamm");
        dentist.SelectCommand.Execute(null);
        Assert.Same(dentist.Item, calendar.SelectedItem);
        Assert.True(dentist.IsSelected);
        dentist.OpenCommand.Execute(null);
        Assert.Equal("details " + dentist.Item.Key, requests[^1]);
        shell.Model.EditEventCommand.Execute(null);
        Assert.Equal("edit " + dentist.Item.Key, requests[^1]);
        shell.Model.DeleteEventCommand.Execute(null);
        Assert.Equal("delete " + dentist.Item.Key, requests[^1]);

        // A subscribed event: Ctrl+E and Delete change nothing and announce why (§2.20 "Read-only events").
        calendar.ShowMonth(2026, 11);
        var halloween = calendar.MonthMode.Weeks.SelectMany(w => w.Chips).Single(c => c.Title == "Halloween");
        Assert.False(halloween.CanDelete);
        Assert.False(halloween.DeleteCommand.CanExecute(null));
        halloween.SelectCommand.Execute(null);
        var count = requests.Count;
        shell.Model.EditEventCommand.Execute(null);
        shell.Model.DeleteEventCommand.Execute(null);
        Assert.Equal(count, requests.Count);
        Assert.Equal(CalendarStrings.ReadOnlyReason(Core.Events.ReadOnlyReason.Subscribed), calendar.Announcement);

        // New event: on today, the next whole hour (the mockup's now is 09:41), one hour long.
        calendar.NewEventCommand.Execute(null);
        Assert.Equal("new 2026-10-19 600", requests[^1]);
        shell.Model.UndoCommand.Execute(null);
        shell.Model.RedoCommand.Execute(null);
        Assert.Equal(["undo", "redo"], requests[^2..]);
    }

    [Fact]
    public async Task HiddenCalendarsAndTheLoadFailure()
    {
        var (shell, calendar, store) = Mockup();
        foreach (var c in store.Calendars.ToList()) await store.UpdateRecordAsync(c.Id, r => r with { Visible = false });
        Assert.True(calendar.MonthMode.ShowsAllHidden);
        Assert.Empty(calendar.MonthMode.Weeks.SelectMany(w => w.Chips));
        Assert.Equal("All calendars are hidden.", calendar.MonthMode.AllHiddenText);
        Assert.Equal("Show calendars", calendar.MonthMode.ShowCalendarsText);
        calendar.Mode = CalendarMode.List;
        Assert.True(calendar.ListMode.ShowsAllHidden);
        Assert.False(calendar.ListMode.ShowsEmpty);
        Assert.False(calendar.LoadFailed);
        Assert.False(calendar.IsLoading);
        Assert.Equal("Couldn't load events.", calendar.LoadFailedText);
        Assert.Equal("Try again", calendar.TryAgainText);
        _ = shell;
    }

    // ---- List (§2.7) --------------------------------------------------------------------------------

    [Fact]
    public void ListGroupsByMonthAndDay()
    {
        var (_, calendar, _) = Mockup();
        calendar.Mode = CalendarMode.List;
        var list = calendar.ListMode;
        Assert.Equal(TestShell.October19, list.From);
        Assert.Equal(Day("2027-10-18"), list.To);                 // one Gregorian year at a time
        var rows = list.Rows;
        Assert.Equal("October 2026", Assert.IsType<ListMonthHeader>(rows[0]).Text);
        var day = Assert.IsType<ListDayHeader>(rows[1]);
        Assert.Equal("Thursday, October 12", day.Heading);
        Assert.Equal("Gregorian Mon, Oct 19", day.Caption);
        Assert.True(day.IsToday);
        var first = Assert.IsType<CalendarRow>(rows[2]);
        Assert.Equal("All day", first.TimeText);
        Assert.Equal("Autumn school break", first.Title);
        Assert.Equal("Day 1 of 7", first.SubText);
        var dentist = rows.OfType<CalendarRow>().First(r => r.Title == "Dentist, Dr. Tamm");
        Assert.Equal("15:40", dentist.TimeText);
        Assert.StartsWith("15:40, Dentist, Dr. Tamm, Home", dentist.AutomationName);

        // A multi-day event is on every day it covers, with "Day 2 of 3" in place of the time.
        var trip = rows.OfType<CalendarRow>().Where(r => r.Title == "Amsterdam trip").ToArray();
        Assert.Equal(3, trip.Length);
        Assert.Equal("All day", trip[1].TimeText);
        Assert.Equal("Day 2 of 3", trip[1].SubText);

        // Days without events are skipped; month headers follow the 13-month months.
        Assert.DoesNotContain(rows.OfType<ListDayHeader>(), h => h.Date == Day("2026-10-28"));
        Assert.Contains(rows.OfType<ListMonthHeader>(), h => h.Text == "November 2026");
        Assert.Contains(rows.OfType<ListMonthHeader>(), h => h.Text == "December 2026");
        Assert.Equal("October 2026", list.MonthHeaderAt(5)!.Text);

        // Scrolling up past the start loads the year before; paging starts again from day 1 of the next month.
        Assert.True(list.LoadEarlier());
        Assert.Equal(Day("2025-10-19"), list.From);
        calendar.Page(1);
        Assert.Equal(Day("2026-11-05"), list.From);
        Assert.Equal("November 2026", Assert.IsType<ListMonthHeader>(list.Rows[0]).Text);
    }

    // ---- Year (§2.3) --------------------------------------------------------------------------------

    [Fact]
    public void YearShowsEventDotsAndOpensMonths()
    {
        var (shell, calendar, _) = Mockup();
        calendar.Mode = CalendarMode.Year;
        var year = calendar.YearMode;
        var october = year.Content.Months[10];                   // IFC: Sol is the 7th month
        var today = october.Grid.Cells.Single(c => c.Date == TestShell.October19);
        Assert.True(today.ShowsEventRow);
        Assert.Equal(3, today.EventColors.Count);                 // the first three calendars with events that day
        Assert.Equal("5 events", today.EventStatus);
        var empty = october.Grid.Cells.First(c => c.Date == Day("2026-10-28"));
        Assert.True(empty.ShowsEventRow);                         // reserves its row
        Assert.Empty(empty.EventColors);
        Assert.Null(empty.EventStatus);

        // "Show events in Year view" off hides the dots.
        shell.State.ShowsYearEvents = false;
        Assert.False(year.Content.Months[10].Grid.Cells.Single(c => c.Date == TestShell.October19).ShowsEventRow);

        // A month title opens Month on that month.
        year.Content.Months[2].OpenMonthCommand.Execute(null);
        Assert.Equal(CalendarMode.Month, calendar.Mode);
        Assert.Equal("March 2026", calendar.PeriodTitle);
    }
}
