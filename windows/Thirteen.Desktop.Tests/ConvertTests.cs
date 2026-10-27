using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Core;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views;
using static Thirteen.Desktop.Tests.Dates;

namespace Thirteen.Desktop.Tests;

/// <summary>
/// The converter on the real window: every way of reaching a day lands on that day, including across a year
/// boundary and at the ends of the supported range, and bad input in the boxes changes nothing.
/// </summary>
public class ConvertTests
{
    private static (MainWindow Window, MainViewModel Model) Open(params string[] args)
    {
        var options = LaunchOptions.Parse([.. args, "--date", "2026-10-19", "--width", "1280", "--height", "860"]);
        var window = ((App)Application.Current!).CreateMainWindow(options, new MemorySettingsStore());
        window.Show();
        Dispatcher.UIThread.RunJobs();
        return (window, (MainViewModel)window.DataContext!);
    }

    private static void Press(Window window, Key key, RawInputModifiers modifiers = RawInputModifiers.None)
    {
        window.KeyPress(key, modifiers, PhysicalKey.None, null);
        window.KeyRelease(key, modifiers, PhysicalKey.None, null);
        Dispatcher.UIThread.RunJobs();
    }

    private static T Visible<T>(Window window) where T : Control =>
        window.GetVisualDescendants().OfType<T>().Single(c => c.IsEffectivelyVisible);

    private static void FocusCalendarDay(Window window, GregorianDate date)
    {
        var day = Visible<Calendar>(window).GetVisualDescendants().OfType<CalendarDayButton>()
            .First(b => b.IsEffectivelyVisible && b.DataContext is DateTime d && d.Date == date.ToDateTime());
        day.Focus(NavigationMethod.Tab);
        Dispatcher.UIThread.RunJobs();
    }

    // The Month box re-selected its old slot when it got the new year's list and wrote it back: Right on
    // 31 December 2026 gave 31 December 2027, a link to Leap Day 2028 gave Year Day 2028.
    [AvaloniaTheory]
    [InlineData("2026-12-31", Key.Right, "2027-01-01")]
    [InlineData("2027-01-01", Key.Left, "2026-12-31")]
    [InlineData("2026-12-28", Key.Down, "2027-01-04")]
    [InlineData("2027-01-03", Key.Up, "2026-12-27")]
    [InlineData("2024-12-31", Key.Right, "2025-01-01")]
    public void CalendarArrowKeysCrossTheYearEnd(string start, Key key, string expected)
    {
        var (window, model) = Open($"thirteen://convert?date={start}");
        FocusCalendarDay(window, Day(start));
        Press(window, key);
        Assert.Equal(Day(expected), model.ConvertPage.ConvertDay);
        Assert.Equal(Day(expected).ToDateTime(), Visible<Calendar>(window).SelectedDate);
        window.Close();
    }

    [AvaloniaFact]
    public void EveryWayInLandsOnTheDayAsked()
    {
        var (window, model) = Open("thirteen://convert?date=0001-01-01");
        var convert = model.ConvertPage;
        void Expect(string iso, string why)
        {
            Dispatcher.UIThread.RunJobs();
            Assert.True(Day(iso) == convert.ConvertDay, $"{why}: expected {iso}, got {convert.ConvertDay}");
            if (convert.IsFromGregorian) Assert.Equal(Day(iso).ToDateTime(), Visible<Calendar>(window).SelectedDate);
        }

        convert.ConvertDay = Day("9999-12-31");
        Expect("9999-12-31", "from the first day to the last");
        convert.ConvertDay = Day("2024-06-17");
        Expect("2024-06-17", "to IFC Leap Day");
        model.Open(DeepLink.TryParse("thirteen://convert?thirteen=2028-LD")!);
        Expect("2028-06-17", "link to IFC Leap Day 2028");
        model.OpenInConverter(Day("2031-05-05"));
        Expect("2031-05-05", "Open in Convert");
        model.Open(DeepLink.TryParse("thirteen://convert?date=2030-12-31")!);
        Expect("2030-12-31", "link to Year Day 2030");
        Press(window, Key.Home);
        Expect("2026-10-19", "Home");

        // The same from the 13-month side.
        convert.IsFromThirteen = true;
        Dispatcher.UIThread.RunJobs();
        convert.ConvertDay = Day("2029-12-31");
        Expect("2029-12-31", "Year Day 2029 on the 13-month side");
        model.Open(DeepLink.TryParse("thirteen://convert?thirteen=0236-M07-01&system=positivist")!);
        Expect("2024-06-17", "Positivist link");
        Assert.Equal(236m, convert.DisplayYear);
        Assert.Equal("month-7", convert.SelectedSlot!.Key);
        window.Close();
    }

    // The year box clamped the old year to the new system's range before it got the new year, and the clamped
    // year moved the day (IFC 8500 became Positivist 8211, that is 9999).
    [AvaloniaTheory]
    [InlineData("8500-05-05", "positivist")]
    [InlineData("9999-12-31", "ifc")]
    [InlineData("0001-01-01", "ifc")]
    [InlineData("0001-01-01", "positivist")]
    public void SwitchingTheSystemKeepsTheDay(string iso, string to)
    {
        var from = to == "ifc" ? "positivist" : "ifc";
        var (window, model) = Open($"thirteen://convert?date={iso}&system={from}");
        model.ConvertPage.IsFromThirteen = true;
        Dispatcher.UIThread.RunJobs();
        model.State.System = to == "ifc" ? CalendarSystemId.Ifc : CalendarSystemId.Positivist;
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(Day(iso), model.ConvertPage.ConvertDay);
        Assert.Equal(Day(iso).ToThirteen(model.State.System).DisplayYear, Visible<NumericUpDown>(window).Value);
        window.Close();
    }

    [AvaloniaTheory]
    [InlineData("2026-02-30")]
    [InlineData("abc")]
    [InlineData("10000-01-01")]
    [InlineData("0000-01-01")]
    [InlineData("")]
    public void ABadTypedDateChangesNothing(string text)
    {
        var (window, model) = Open("--page", "convert");
        var box = Visible<CalendarDatePicker>(window).GetVisualDescendants().OfType<TextBox>().First();
        box.Focus();
        box.Text = text;
        Press(window, Key.Enter);
        window.FocusManager?.ClearFocus();
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(TestShell.October19, model.ConvertPage.ConvertDay);
        window.Close();
    }

    [AvaloniaTheory]
    [InlineData("0001-01-01")]
    [InlineData("9999-12-31")]
    [InlineData("2024-02-29")]
    public void TypedDatesReachTheWholeRange(string text)
    {
        var (window, model) = Open("--page", "convert");
        var box = Visible<CalendarDatePicker>(window).GetVisualDescendants().OfType<TextBox>().First();
        box.Focus();
        box.Text = text;
        Press(window, Key.Enter);
        Assert.Equal(Day(text), model.ConvertPage.ConvertDay);
        window.Close();
    }

    [AvaloniaTheory]
    [InlineData("", "2024")]
    [InlineData("abc", "2024")]
    [InlineData("2.5", "2024")]
    [InlineData("0", "1")]          // clamped to the first year
    [InlineData("10000", "9999")]   // and to the last
    public void TheYearBoxAlwaysShowsTheDaysYear(string text, string shown)
    {
        var (window, model) = Open("thirteen://convert?thirteen=2024-LD");
        var input = Visible<NumericUpDown>(window).GetVisualDescendants().OfType<TextBox>().First();
        input.Focus();
        input.Text = text;
        Press(window, Key.Enter);
        window.FocusManager?.ClearFocus();
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(shown, input.Text);
        Assert.Equal(int.Parse(shown, System.Globalization.CultureInfo.InvariantCulture), model.ConvertPage.ConvertDay.Year);
        window.Close();
    }

    [AvaloniaFact]
    public void TheCalendarStopsAtTheEndsOfTheRange()
    {
        var (window, model) = Open("thirteen://convert?date=0001-01-01");
        var calendar = Visible<Calendar>(window);
        Assert.False(calendar.GetVisualDescendants().OfType<Button>().Single(b => b.Name == "PART_PreviousButton").IsEffectivelyEnabled);
        FocusCalendarDay(window, Day("0001-01-01"));
        foreach (var key in new[] { Key.Left, Key.Up, Key.PageUp }) Press(window, key);
        Assert.Equal(Day("0001-01-01"), model.ConvertPage.ConvertDay);

        model.ConvertPage.ConvertDay = Day("9999-12-31");
        Dispatcher.UIThread.RunJobs();
        FocusCalendarDay(window, Day("9999-12-31"));
        foreach (var key in new[] { Key.Right, Key.Down, Key.PageDown }) Press(window, key);
        Assert.Equal(Day("9999-12-31"), model.ConvertPage.ConvertDay);
        window.Close();
    }

    private static Control? Focused(Window window) => window.FocusManager?.GetFocusedElement() as Control;

    // Each move rebuilt the day grid and dropped the focus: the first arrow key worked, the rest did nothing.
    [AvaloniaFact]
    public void ArrowKeysKeepWorkingInTheThirteenMonthDayGrid()
    {
        var (window, model) = Open("thirteen://convert?thirteen=2026-M11-26");
        var cell = window.GetVisualDescendants().OfType<Button>()
            .First(b => b.IsEffectivelyVisible && b.DataContext is DayCellViewModel c && c.IsSelected);
        cell.Focus(NavigationMethod.Tab);
        Dispatcher.UIThread.RunJobs();
        foreach (var (key, month, day) in new[] { (Key.Right, 11, 27), (Key.Right, 11, 28), (Key.Right, 11, 28), (Key.Up, 11, 21), (Key.Left, 11, 20), (Key.Down, 11, 27) })
        {
            Press(window, key);
            var expected = new ThirteenMonthDate(2026, month, day, CalendarSystemId.Ifc).Gregorian;
            Assert.Equal(expected, model.ConvertPage.ConvertDay);
            Assert.Equal(expected, Assert.IsType<DayCellViewModel>(Focused(window)?.DataContext).Date);
        }
        window.Close();
    }

    [AvaloniaFact]
    public void PickingANotableDayWithTheKeyboardKeepsTheFocus()
    {
        var (window, model) = Open("--page", "convert");
        var pick = window.GetVisualDescendants().OfType<Button>()
            .First(b => b.IsEffectivelyVisible && b.DataContext is NotablePick p && p.Name.StartsWith("Christmas", StringComparison.Ordinal));
        pick.Focus(NavigationMethod.Tab);
        Dispatcher.UIThread.RunJobs();
        Press(window, Key.Enter);
        Assert.Equal(Day("2026-12-25"), model.ConvertPage.ConvertDay);
        var focused = Focused(window);
        Assert.StartsWith("Christmas", Assert.IsType<NotablePick>(focused?.DataContext).Name);
        Assert.Contains(":focus-visible", focused!.Classes);
        Assert.True(Assert.IsType<NotablePick>(focused.DataContext).IsSelected);

        // A "Go to" link disappears once used; the focus moves to what took its place, never to nowhere.
        var go = window.GetVisualDescendants().OfType<Button>().First(b => b.IsEffectivelyVisible && b.Classes.Contains("link"));
        go.Focus(NavigationMethod.Tab);
        Press(window, Key.Enter);
        Assert.NotNull(Focused(window));
        Assert.True(window.GetVisualDescendants().OfType<ConvertView>().Single().IsVisualAncestorOf(Focused(window)!));
        window.Close();
    }
}
