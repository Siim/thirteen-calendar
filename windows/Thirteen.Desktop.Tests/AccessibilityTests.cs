using Avalonia;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views;

namespace Thirteen.Desktop.Tests;

/// <summary>Keyboard-only use and what a screen reader reads, on the real window.</summary>
public class AccessibilityTests
{
    private static (MainWindow Window, MainViewModel Model) Open(params string[] args)
    {
        var options = LaunchOptions.Parse([.. args, "--date", "2026-10-19", "--width", "1280", "--height", "860"]);
        var window = ((App)Application.Current!).CreateMainWindow(options, new MemorySettingsStore());
        window.Show();
        Dispatcher.UIThread.RunJobs();
        return (window, (MainViewModel)window.DataContext!);
    }

    private static Control? Focused(Window window) => window.FocusManager?.GetFocusedElement() as Control;

    private static string? Name(Control control) => ControlAutomationPeer.CreatePeerForElement(control).GetName();

    private static void Press(Window window, Key key, RawInputModifiers modifiers = RawInputModifiers.None)
    {
        window.KeyPress(key, modifiers, PhysicalKey.None, null);
        window.KeyRelease(key, modifiers, PhysicalKey.None, null);
        Dispatcher.UIThread.RunJobs();
    }

    /// <summary>The names Tab visits, from the start of the window.</summary>
    private static List<string> TabWalk(Window window, int steps)
    {
        var names = new List<string>();
        for (var i = 0; i < steps; i++)
        {
            Press(window, Key.Tab);
            names.Add(Focused(window) is { } c ? Name(c) ?? "" : "(nothing)");
        }
        return names;
    }

    [AvaloniaFact]
    public void EveryFocusableControlHasAName()
    {
        var problems = new List<string>();
        void Check(Window window, string where)
        {
            Dispatcher.UIThread.RunJobs();
            foreach (var control in window.GetVisualDescendants().OfType<Control>()
                         .Where(c => c.Focusable && c.IsEffectivelyVisible && c.IsEffectivelyEnabled && c is not ScrollViewer))
            {
                // A combo box's own popup items are named by their text; its toggle part is not focusable.
                if (control.TemplatedParent is ComboBox) continue;
                var name = Name(control);
                if (string.IsNullOrWhiteSpace(name) || name.StartsWith("Avalonia.", StringComparison.Ordinal))
                {
                    problems.Add($"{where}: {control.GetType().Name} [{string.Join(",", control.Classes)}] \"{name}\"");
                }
            }
        }

        var (window, model) = Open("--select", "2026-10-19");
        foreach (var section in Enum.GetValues<AppSection>())
        {
            model.Section = section;
            Check(window, section.ToString());
        }
        model.Section = AppSection.Convert;
        model.ConvertPage.IsFromThirteen = true;
        Check(window, "Convert from 13-month");
        window.Close();

        Assert.True(problems.Count == 0, string.Join("\n", problems.Distinct()));
    }

    [AvaloniaFact]
    public void TabVisitsThePaneInOrderThenThePage()
    {
        var (window, _) = Open("--page", "year");
        var names = TabWalk(window, 10);
        // The Calendar toolbar (§2.1): "‹", "›" ("Today" is hidden while today is on screen), the mode control as one
        // stop on the mode shown, "New event" (exactly these: no system switch in Calendar); then Year mode's own row and grid.
        Assert.Equal(
            ["Close navigation", "Calendar", names[2], "Settings", "Previous year", "Next year", "Year", "New event",
             "Gregorian dates", names[9]],
            names);
        Assert.StartsWith("Today: ", names[2]);    // today at a glance, in the pane (no events attached in this test)
        Assert.Contains("October 12, 2026", names[9]);     // the day grid starts on today
        window.Close();
    }

    [AvaloniaFact]
    public void UpAndDownMoveBetweenThePages()
    {
        var (window, model) = Open("--page", "convert");
        Press(window, Key.Tab);
        Press(window, Key.Tab);
        Assert.Equal("Convert", Name(Focused(window)!));
        Press(window, Key.Down);
        Assert.Equal("Compare", Name(Focused(window)!));
        Press(window, Key.Down);
        Press(window, Key.Down);
        Assert.Equal("Settings", Name(Focused(window)!));
        Press(window, Key.Up);
        Assert.Equal("History", Name(Focused(window)!));
        Assert.Equal(AppSection.Convert, model.Section);     // focus moves, Space or Enter opens
        Press(window, Key.Space);
        Assert.Equal(AppSection.History, model.Section);
        window.Close();
    }

    [AvaloniaFact]
    public void ADayGridIsOneTabStopThatStartsOnToday()
    {
        var (window, _) = Open("--page", "today");
        var names = TabWalk(window, 10);
        var days = names.Where(n => n.Contains(", 2026. ", StringComparison.Ordinal) && !n.StartsWith("Today: ", StringComparison.Ordinal)).ToArray();
        // One stop for the 13-month grid and one for the Gregorian grid, each on today.
        Assert.Equal(2, days.Length);
        Assert.All(days, d => Assert.EndsWith("Today", d));
        Assert.Equal("Close navigation", names[^1]);   // and then back to the start

        // Arrow keys move inside the grid; Tab leaves it and Shift+Tab returns to the same day.
        Press(window, Key.Tab, RawInputModifiers.Shift);
        Press(window, Key.Tab, RawInputModifiers.Shift);
        Press(window, Key.Right);
        var moved = Name(Focused(window)!);
        Assert.Contains("October 13, 2026", moved);
        Press(window, Key.Tab);
        Press(window, Key.Tab, RawInputModifiers.Shift);
        Assert.Equal(moved, Name(Focused(window)!));
        window.Close();
    }

    [AvaloniaFact]
    public void TheConvertCalendarIsOneTabStopAndFocusFollowsTheArrowKeys()
    {
        var (window, model) = Open("--page", "convert");
        var calendar = window.GetVisualDescendants().OfType<Calendar>().Single(c => c.IsEffectivelyVisible);
        var stops = new List<Control>();
        for (var i = 0; i < 14; i++)
        {
            Press(window, Key.Tab);
            stops.Add(Focused(window)!);
        }
        var days = stops.OfType<CalendarDayButton>().ToArray();
        Assert.Single(days);
        Assert.Equal("19", Name(days[0]));         // enters on the selected day

        // Back into the calendar: Right picks the next day and the keyboard focus goes with it.
        for (var i = 0; i < 20 && Focused(window) is not CalendarDayButton; i++) Press(window, Key.Tab, RawInputModifiers.Shift);
        Assert.IsType<CalendarDayButton>(Focused(window));
        Press(window, Key.Right);
        Assert.Equal(new Core.GregorianDate(2026, 10, 20), model.ConvertPage.ConvertDay);
        Assert.Equal("20", Name(Focused(window)!));
        Assert.True(calendar.IsKeyboardFocusWithin);
        window.Close();
    }

    // Closing the day details from inside them left the focus nowhere: the next Tab started at the menu button.
    [AvaloniaFact]
    public void ClosingTheDayDetailsReturnsTheFocus()
    {
        var (window, model) = Open("--page", "year", "--width", "1400");
        var cell = window.GetVisualDescendants().OfType<Button>().First(b => b.IsEffectivelyVisible && b.DataContext is DayCellViewModel c && c.IsToday);
        cell.Focus(NavigationMethod.Tab);
        Dispatcher.UIThread.RunJobs();
        Press(window, Key.Enter);
        Assert.True(model.HasDetail);
        Press(window, Key.Tab);
        Assert.Equal("Close day details", Name(Focused(window)!));
        Press(window, Key.Enter);
        Assert.False(model.HasDetail);
        Assert.Same(cell, Focused(window));
        Assert.Contains(":focus-visible", cell.Classes);

        // Open in Convert: the focus goes to the start of the converter.
        Press(window, Key.Enter);
        var open = window.GetVisualDescendants().OfType<Button>().First(b => b.IsEffectivelyVisible && Name(b) == "Open in Convert");
        open.Focus(NavigationMethod.Tab);
        Press(window, Key.Enter);
        Assert.Equal(AppSection.Convert, model.Section);
        Assert.True(window.GetVisualDescendants().OfType<ConvertView>().Single().IsVisualAncestorOf(Focused(window)!));
        window.Close();
    }
}
