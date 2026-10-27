using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views;
using Thirteen.Desktop.Views.CalendarSection;
using CalendarMode = Thirteen.Desktop.ViewModels.CalendarMode;

namespace Thirteen.Desktop.Tests;

/// <summary>The real window on the headless platform: keyboard shortcuts, layout modes, copy and accessibility.</summary>
public class MainWindowTests
{
    private static (MainWindow Window, MainViewModel Model, MemorySettingsStore Store) Open(params string[] args)
    {
        var store = new MemorySettingsStore();
        var options = LaunchOptions.Parse([.. args, "--date", "2026-10-19", "--width", "1280", "--height", "860"]);
        var window = ((App)Application.Current!).CreateMainWindow(options, store);
        window.Show();
        Dispatcher.UIThread.RunJobs();
        return (window, (MainViewModel)window.DataContext!, store);
    }

    private static void Press(Window window, Key key, PhysicalKey physical, RawInputModifiers modifiers = RawInputModifiers.None)
    {
        window.KeyPress(key, modifiers, physical, null);
        window.KeyRelease(key, modifiers, physical, null);
        Dispatcher.UIThread.RunJobs();
    }

    [AvaloniaFact]
    public void KeyboardShortcutsNavigate()
    {
        var (window, model, _) = Open();
        Press(window, Key.D2, PhysicalKey.Digit2, RawInputModifiers.Control);
        Assert.Equal(AppSection.Calendar, model.Section);
        Press(window, Key.D3, PhysicalKey.Digit3, RawInputModifiers.Control);
        Assert.Equal(AppSection.Convert, model.Section);
        Press(window, Key.D4, PhysicalKey.Digit4, RawInputModifiers.Control);
        Assert.Equal(AppSection.Compare, model.Section);
        Press(window, Key.D5, PhysicalKey.Digit5, RawInputModifiers.Control);
        Assert.Equal(AppSection.History, model.Section);
        Press(window, Key.OemComma, PhysicalKey.Comma, RawInputModifiers.Control);
        Assert.Equal(AppSection.Settings, model.Section);
        Press(window, Key.D1, PhysicalKey.Digit1, RawInputModifiers.Control);
        Assert.Equal(AppSection.Today, model.Section);

        // Calendar: Ctrl+Right pages the mode (Month first), Ctrl+Shift+1 to 5 pick the mode, Home and Ctrl+T go to today.
        Press(window, Key.D2, PhysicalKey.Digit2, RawInputModifiers.Control);
        Press(window, Key.Right, PhysicalKey.ArrowRight, RawInputModifiers.Control);
        Assert.Equal("November 2026", model.CalendarPage.PeriodTitle);
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.Equal("October 2026", model.CalendarPage.PeriodTitle);
        Press(window, Key.D4, PhysicalKey.Digit4, RawInputModifiers.Control | RawInputModifiers.Shift);
        Assert.Equal(CalendarMode.Year, model.CalendarPage.Mode);
        Press(window, Key.Right, PhysicalKey.ArrowRight, RawInputModifiers.Control);
        Assert.Equal(2027, model.CalendarPage.YearMode.Year);
        Press(window, Key.T, PhysicalKey.T, RawInputModifiers.Control);
        Assert.Equal(2026, model.CalendarPage.YearMode.Year);
        var modes = new[] { CalendarMode.Day, CalendarMode.Week, CalendarMode.Month, CalendarMode.Year, CalendarMode.List };
        var keys = new[] { (Key.D1, PhysicalKey.Digit1), (Key.D2, PhysicalKey.Digit2), (Key.D3, PhysicalKey.Digit3), (Key.D4, PhysicalKey.Digit4), (Key.D5, PhysicalKey.Digit5) };
        for (var i = 0; i < modes.Length; i++)
        {
            Press(window, keys[i].Item1, keys[i].Item2, RawInputModifiers.Control | RawInputModifiers.Shift);
            Assert.Equal(modes[i], model.CalendarPage.Mode);
            Assert.True(modes[i] switch
            {
                CalendarMode.Day => model.CalendarPage.DayMode.IsActive,
                CalendarMode.Week => model.CalendarPage.WeekMode.IsActive,
                CalendarMode.Month => model.CalendarPage.MonthMode.IsActive,
                CalendarMode.Year => model.CalendarPage.YearMode.IsActive,
                _ => model.CalendarPage.ListMode.IsActive,
            });
        }
        window.Close();
    }

    [AvaloniaFact]
    public void EscapeClosesTheDetailPane()
    {
        var (window, model, _) = Open("--page", "year", "--select", "2026-03-01");
        Assert.True(model.HasDetail);
        Assert.True(window.FindControl<Border>("DetailHost")!.IsVisible);
        Press(window, Key.Right, PhysicalKey.ArrowRight, RawInputModifiers.Alt);
        Assert.Equal(new Core.GregorianDate(2026, 3, 2), model.Detail!.Date);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.False(model.HasDetail);
        window.Close();
    }

    [AvaloniaFact]
    public void NarrowWindowsUseARail()
    {
        var (window, model, _) = Open("--width", "1280");
        var split = window.GetVisualDescendants().OfType<SplitView>().Single();
        Assert.Equal(SplitViewDisplayMode.CompactInline, split.DisplayMode);
        Assert.True(model.IsPaneOpen);

        window.Width = 820;
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(SplitViewDisplayMode.CompactOverlay, split.DisplayMode);
        Assert.False(model.IsPaneOpen);
        Assert.True(window.IsNarrow);
        Dispatcher.UIThread.RunJobs();
        var labels = window.GetVisualDescendants().OfType<TextBlock>().Where(t => t.Classes.Contains("navLabel")).ToArray();
        Assert.Equal(6, labels.Length);
        Assert.All(labels, l => Assert.False(l.IsVisible));     // icons only on the rail
        Assert.True(window.MinWidth >= 600 && window.MinHeight >= 480);
        window.Close();
    }

    [AvaloniaFact]
    public void ClosingRemembersThePlacement()
    {
        var store = new MemorySettingsStore();
        var window = ((App)Application.Current!).CreateMainWindow(LaunchOptions.Parse([]), store);
        window.Width = 1100;
        window.Height = 780;
        window.Show();
        Dispatcher.UIThread.RunJobs();
        window.Close();
        var placement = store.Current.Window;
        Assert.NotNull(placement);
        Assert.Equal(1100, placement.Width);
        Assert.Equal(780, placement.Height);
        Assert.False(placement.Maximized);
    }

    [AvaloniaFact]
    public void QaRunsLeaveSettingsAlone()
    {
        var (window, model, store) = Open("--theme", "slate");
        Assert.Equal(Themes.ThirteenTheme.Slate, model.State.Theme);
        window.Close();
        // The store passed in is used as-is; the app itself passes a read-only SettingsStore for QA runs.
        Assert.True(LaunchOptions.Parse(["--theme", "slate"]).IsReadOnly);
        Assert.Equal("slate", store.Current.Theme);
    }

    [AvaloniaFact]
    public void NoScreenShowsADash()
    {
        foreach (var system in new[] { "ifc", "positivist" })
        {
            foreach (var date in new[] { "2026-10-19", "2024-06-17", "2026-12-31" })
            {
                var (window, model, _) = Open("--system", system, "--date", date, "--select", date);
                foreach (var section in Enum.GetValues<AppSection>())
                {
                    model.Section = section;
                    Dispatcher.UIThread.RunJobs();
                    foreach (var control in window.GetVisualDescendants().OfType<Control>().Where(c => c.IsEffectivelyVisible))
                    {
                        var texts = new[]
                        {
                            (control as TextBlock)?.Text,
                            AutomationProperties.GetName(control),
                            AutomationProperties.GetHelpText(control),
                            ToolTip.GetTip(control) as string,
                        };
                        foreach (var text in texts.Where(t => t is not null))
                        {
                            Assert.False(text!.Contains('–') || text.Contains('—'), $"{system} {date} {section}: \"{text}\"");
                        }
                    }
                }
                window.Close();
            }
        }
    }

    [AvaloniaFact]
    public void ThemePickerIsAccessible()
    {
        var (window, model, _) = Open("--page", "settings");
        var pickers = window.GetVisualDescendants().OfType<ListBox>().Where(l => l.Classes.Contains("swatches")).ToArray();
        Assert.Equal(["Theme: Light and dark", "Theme: Dark"], pickers.Select(AutomationProperties.GetName));
        var picker = pickers[0];
        var items = picker.GetVisualDescendants().OfType<ListBoxItem>().ToArray();
        Assert.Equal(["Almanac", "Graphite", "Slate", "Forest", "Mono"], items.Select(AutomationProperties.GetName));
        Assert.Equal(["Obsidian", "Midnight", "Phosphor"], pickers[1].GetVisualDescendants().OfType<ListBoxItem>().Select(AutomationProperties.GetName));
        Assert.All(items, i => Assert.False(string.IsNullOrWhiteSpace(AutomationProperties.GetHelpText(i))));
        Assert.All(items, i => Assert.True(i.Focusable));

        // Arrow keys move the selection, and the theme follows.
        items[0].Focus();
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal(Themes.ThirteenTheme.Graphite, model.State.Theme);
        window.Close();
    }

    [AvaloniaFact]
    public void DayCellsHaveScreenReaderNamesAndArrowKeys()
    {
        var (window, model, _) = Open("--page", "year");
        var cells = window.GetVisualDescendants().OfType<Button>().Where(b => b.Classes.Contains("day") && b.IsEffectivelyVisible).ToArray();
        Assert.True(cells.Length >= 13 * 28, $"{cells.Length} day cells");
        Assert.All(cells.Take(40), c => Assert.False(string.IsNullOrWhiteSpace(AutomationProperties.GetName(c))));
        var today = cells.Single(c => c.Classes.Contains("today"));
        Assert.Contains("October 12", AutomationProperties.GetName(today));
        today.Focus();
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        var focused = window.FocusManager?.GetFocusedElement() as Button;
        Assert.NotNull(focused);
        Assert.Contains("October 13", AutomationProperties.GetName(focused));
        Press(window, Key.Down, PhysicalKey.ArrowDown);
        focused = window.FocusManager?.GetFocusedElement() as Button;
        Assert.Contains("October 20", AutomationProperties.GetName(focused!));
        window.Close();
    }

    [AvaloniaFact]
    public void YearScrollsTheSelectedMonthToTheTop()
    {
        var (window, model, _) = Open("--page", "year", "--date", "2024-06-17", "--select", "2024-06-17", "--width", "1440", "--height", "900");
        for (var i = 0; i < 5; i++) Dispatcher.UIThread.RunJobs();
        var view = window.GetVisualDescendants().OfType<YearModeView>().Single();
        var scroller = view.GetVisualDescendants().OfType<ScrollViewer>().First(s => s.Name == "Scroller");
        var months = view.GetVisualDescendants().OfType<ItemsControl>().First(c => c.Name == "Months");
        var june = (Control)months.ContainerFromIndex(5)!;
        var top = june.TranslatePoint(new Point(0, 0), (Visual)scroller.Content!)!.Value.Y;
        Assert.True(scroller.Offset.Y >= top - 16 && scroller.Offset.Y <= top, $"offset {scroller.Offset} extent {scroller.Extent} viewport {scroller.Viewport} june top {top}");

        // Leap Day (after June) has the focus and the comparison pane.
        var focused = window.FocusManager?.GetFocusedElement() as Control;
        Assert.IsType<IntercalaryBadgeModel>(focused?.DataContext);
        Assert.Equal(new Core.GregorianDate(2024, 6, 17), model.Detail!.Date);
        window.Close();
    }
}
