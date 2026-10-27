using Avalonia;
using Avalonia.Automation;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.Controls;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Tests.Events;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views;
using Thirteen.Desktop.Views.CalendarSection;
using CalendarMode = Thirteen.Desktop.ViewModels.CalendarMode;

namespace Thirteen.Desktop.Tests.CalendarSection;

/// <summary>
/// The Calendar section in the real window on the headless platform with the mockup data set (§6.7): the toolbar, the
/// Calendars pane in the navigation pane, Month's grid and its keyboard (§2.21), paging focus, the modes' views, the
/// accessible names and the no-dashes walk (§2.19). Set THIRTEEN_TEST_SCREENSHOTS to a folder to save what they render.
/// </summary>
public class CalendarUiTests
{
    private static (MainWindow Window, MainViewModel Model, List<string> Requests) Open(params string[] args)
    {
        var options = LaunchOptions.Parse([.. args, "--fake-events", "--width", "1440", "--height", "900"]);
        var window = ((App)Application.Current!).CreateMainWindow(options, new MemorySettingsStore());
        var model = (MainViewModel)window.DataContext!;
        var store = new FakeEventStore();
        store.LoadAsync().GetAwaiter().GetResult();
        var host = new EventsHost(store, new SubscriptionService(store, time: store.Clock), refreshes: false);
        App.AttachEvents(model, host);
        var actions = new PlaceholderCalendarActions();
        var requests = new List<string>();
        actions.Requested += requests.Add;
        model.CalendarPage.Actions = actions;
        window.Show();
        Settle();
        return (window, model, requests);
    }

    private static void Settle()
    {
        for (var i = 0; i < 4; i++) Dispatcher.UIThread.RunJobs();
    }

    private static void Press(Window window, Key key, RawInputModifiers modifiers = RawInputModifiers.None)
    {
        window.KeyPress(key, modifiers, PhysicalKey.None, null);
        window.KeyRelease(key, modifiers, PhysicalKey.None, null);
        Settle();
    }

    private static Control? Focused(Window window) => window.FocusManager?.GetFocusedElement() as Control;

    private static string? Name(Control control) => ControlAutomationPeer.CreatePeerForElement(control).GetName();

    private static void Save(Window window, string name)
    {
        if (Environment.GetEnvironmentVariable("THIRTEEN_TEST_SCREENSHOTS") is not { Length: > 0 } folder) return;
        Directory.CreateDirectory(folder);
        window.CaptureRenderedFrame()?.Save(Path.Combine(folder, name));
    }

    [AvaloniaFact]
    public void MonthShowsTheMockupWithTheToolbarAndThePane()
    {
        var (window, model, _) = Open("--page", "calendar");
        Save(window, "windows-calendar-month.png");
        var calendar = model.CalendarPage;
        Assert.Equal(CalendarMode.Month, calendar.Mode);
        Assert.Equal(LaunchOptions.MockupToday, model.State.Today);

        // The toolbar of §2.1 replaces the page title.
        var toolbar = window.GetVisualDescendants().OfType<CalendarToolbar>().Single();
        var texts = toolbar.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text).ToList();
        Assert.Contains("October 2026", texts);
        Assert.Contains("Gregorian Oct 8 to Nov 4", texts);
        Assert.Contains("New event", texts);
        Assert.False(toolbar.FindControl<Button>("TodayButton")!.IsVisible);     // today is on screen
        Assert.False(toolbar.FindControl<Button>("StaleButton")!.IsVisible);     // the mockup's feeds are fresh
        Assert.Equal(["Day", "Week", "Month", "Year", "List"],
            toolbar.GetVisualDescendants().OfType<RadioButton>().Select(Name));
        Assert.True(toolbar.GetVisualDescendants().OfType<RadioButton>().Single(r => Name(r) == "Month").IsChecked);

        // The Calendars pane sits under the sections while Calendar is shown; Today at a glance gives way to it.
        Assert.True(window.FindControl<Views.Events.CalendarsPane>("CalendarsPaneView")!.IsEffectivelyVisible);
        Assert.False(window.FindControl<Button>("TodaySummary")!.IsVisible);
        model.Section = AppSection.Convert;
        Settle();
        Assert.False(window.FindControl<Views.Events.CalendarsPane>("CalendarsPaneView")!.IsEffectivelyVisible);
        Assert.True(window.FindControl<Button>("TodaySummary")!.IsVisible);
        model.Section = AppSection.Calendar;
        Settle();

        // The grid: 28 day cells, the lanes that fit, the events drawn as chips and bars.
        var view = window.GetVisualDescendants().OfType<MonthModeView>().Single();
        var cells = view.GetVisualDescendants().OfType<Button>().Where(b => b.DataContext is MonthDayCell).ToArray();
        Assert.Equal(28, cells.Length);
        Assert.NotNull(calendar.MonthMode.MaxLanes);
        Assert.True(calendar.MonthMode.MaxLanes >= 3, $"{calendar.MonthMode.MaxLanes} lanes at 1440 x 900");
        var chips = view.GetVisualDescendants().OfType<EventChipVisual>().Where(c => c.IsEffectivelyVisible).ToArray();
        Assert.Contains(chips, c => c.Title == "Autumn school break" && c.IsBar);
        Assert.Contains(chips, c => c.Title == "Sprint planning" && !c.IsBar && c.Time == "09:30");
        var today = cells.Single(b => ((MonthDayCell)b.DataContext!).IsToday);
        Assert.Equal("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.", Name(today));
        Assert.Equal("Today", AutomationProperties.GetItemStatus(today));
        var header = view.GetVisualDescendants().OfType<Border>().First(b => b.DataContext is MonthWeekdayHeader);
        Assert.Equal("Sunday. Gregorian Thursday", AutomationProperties.GetName(header));
        window.Close();
    }

    [AvaloniaFact]
    public void MonthKeyboardGoesIntoADaysEventsAndBack()
    {
        var (window, model, requests) = Open("--page", "calendar");
        var view = window.GetVisualDescendants().OfType<MonthModeView>().Single();
        var today = view.GetVisualDescendants().OfType<Button>().Single(b => b.DataContext is MonthDayCell { IsToday: true });
        today.Focus(NavigationMethod.Tab);
        Settle();

        // Arrows move between days.
        Press(window, Key.Right);
        Assert.Contains("October 13, 2026", Name(Focused(window)!));
        Press(window, Key.Left);
        Assert.Same(today, Focused(window));

        // Enter (or F2) goes into the day's events, top lane first; Down and Tab move among them; Esc goes back.
        Press(window, Key.Enter);
        var first = Focused(window)!;
        Assert.IsType<MonthChip>(first.DataContext);
        Assert.StartsWith("Autumn school break, all day", Name(first));
        Press(window, Key.Down);
        var second = Focused(window)!;
        Assert.IsType<MonthChip>(second.DataContext);
        Assert.NotSame(first, second);
        Press(window, Key.Up);
        Assert.Same(first, Focused(window));
        Press(window, Key.Escape);
        Assert.Same(today, Focused(window));
        Press(window, Key.F2);
        Assert.Same(first, Focused(window));

        // Enter on an event opens its details (task W7 behind the actions seam).
        Press(window, Key.Enter);
        Assert.StartsWith("details ", requests[^1]);
        Assert.Equal(((MonthChip)first.DataContext!).Item.Key, model.CalendarPage.SelectedItem?.Key);
        window.Close();
    }

    [AvaloniaFact]
    public void PagingKeepsTheGridPositionAndAnnounces()
    {
        var (window, model, _) = Open("--page", "calendar");
        var view = window.GetVisualDescendants().OfType<MonthModeView>().Single();
        var today = view.GetVisualDescendants().OfType<Button>().Single(b => b.DataContext is MonthDayCell { IsToday: true });
        var position = ((MonthDayCell)today.DataContext!).NavIndex;
        today.Focus(NavigationMethod.Tab);
        Settle();
        Press(window, Key.Right, RawInputModifiers.Control);
        Assert.Equal("November 2026", model.CalendarPage.PeriodTitle);
        var live = window.GetVisualDescendants().OfType<TextBlock>().Single(t => t.Name == "LiveRegion");
        Assert.Equal("November 2026. Gregorian Nov 5 to Dec 2.", live.Text);
        Assert.Equal(AutomationLiveSetting.Polite, AutomationProperties.GetLiveSetting(live));
        var focused = Focused(window);
        Assert.Equal(position, Assert.IsType<MonthDayCell>(focused?.DataContext).NavIndex);
        Assert.Contains("November 12, 2026", Name(focused!));

        // "Today" shows while today is off screen and brings it back.
        var todayButton = window.GetVisualDescendants().OfType<Button>().Single(b => b.Name == "TodayButton");
        Assert.True(todayButton.IsVisible);
        todayButton.Command!.Execute(null);
        Settle();
        Assert.Equal("October 2026", model.CalendarPage.PeriodTitle);
        Assert.False(todayButton.IsVisible);
        window.Close();
    }

    [AvaloniaFact]
    public void EveryModeRendersNamedAndWithoutDashes()
    {
        foreach (var system in new[] { "ifc", "positivist" })
        {
            var (window, model, _) = Open("--page", "calendar", "--system", system);
            foreach (var mode in CalendarModes.All)
            {
                model.CalendarPage.Mode = mode;
                Settle();
                var where = $"{system} {mode}";
                if (system == "ifc") Save(window, $"windows-calendar-{mode.Id()}.png");
                CalendarsUiTests.AssertNoDashes(CalendarsUiTests.Texts(window), where);
                foreach (var control in window.GetVisualDescendants().OfType<Control>()
                             .Where(c => c.Focusable && c.IsEffectivelyVisible && c.IsEffectivelyEnabled && c is not ScrollViewer))
                {
                    if (control.TemplatedParent is ComboBox) continue;
                    var name = Name(control);
                    Assert.False(string.IsNullOrWhiteSpace(name) || name.StartsWith("Avalonia.", StringComparison.Ordinal),
                        $"{where}: {control.GetType().Name} [{string.Join(",", control.Classes)}] \"{name}\"");
                }
            }

            // Year Day's band in December, and the list of days at 150 % text.
            model.Open(Support.DeepLink.TryParse("thirteen://month/2026/13")!);
            Settle();
            CalendarsUiTests.AssertNoDashes(CalendarsUiTests.Texts(window), $"{system} December");
            model.State.TextScale = 1.5;
            Settle();
            CalendarsUiTests.AssertNoDashes(CalendarsUiTests.Texts(window), $"{system} list of days");
            window.Close();
        }
    }

    [AvaloniaFact]
    public void YearListAndTheLargeTextDayList()
    {
        var (window, model, requests) = Open("--route", "year/2026");
        var calendar = model.CalendarPage;
        Assert.Equal(CalendarMode.Year, calendar.Mode);
        Save(window, "windows-calendar-year-dots.png");
        var year = window.GetVisualDescendants().OfType<YearModeView>().Single();
        var dots = year.GetVisualDescendants().OfType<EventDots>().Where(d => d.IsEffectivelyVisible && d.DotColors is { Count: > 0 }).ToArray();
        Assert.NotEmpty(dots);
        var todayCell = year.GetVisualDescendants().OfType<Button>().Single(b => b.DataContext is DayCellViewModel { IsToday: true });
        Assert.Equal("5 events", AutomationProperties.GetItemStatus(todayCell));
        // The month title opens Month.
        var title = year.GetVisualDescendants().OfType<Button>().First(b => b.Classes.Contains("monthTitle") && Name(b) == "March");
        title.Command!.Execute(null);
        Settle();
        Assert.Equal(CalendarMode.Month, calendar.Mode);
        Assert.Equal("March 2026", calendar.PeriodTitle);

        // List: rows by month and day; Enter on a row opens its details.
        calendar.Date = LaunchOptions.MockupToday;
        calendar.Mode = CalendarMode.List;
        Settle();
        var list = window.GetVisualDescendants().OfType<ListModeView>().Single();
        var rows = list.GetVisualDescendants().OfType<EventRowView>().ToArray();
        Assert.NotEmpty(rows);
        var dentist = rows.Select(r => r.GetVisualDescendants().OfType<Button>().First()).First(b => Name(b)!.StartsWith("15:40, Dentist", StringComparison.Ordinal));
        dentist.Focus(NavigationMethod.Tab);
        Press(window, Key.Enter);
        Assert.StartsWith("details ", requests[^1]);
        Assert.Contains("October 2026", list.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text));

        // Month at 150 % text: the list of days with runs of empty days.
        calendar.Mode = CalendarMode.Month;
        model.State.TextScale = 1.5;
        Settle();
        Save(window, "windows-calendar-month-large-text.png");
        var month = window.GetVisualDescendants().OfType<MonthModeView>().Single();
        Assert.False(month.FindControl<Grid>("GridHost")!.IsVisible);
        var lines = month.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text ?? "").ToList();
        Assert.Contains("Thursday, October 12", lines);
        Assert.Contains(lines, l => l.StartsWith("No events, ", StringComparison.Ordinal));
        window.Close();
    }
}
