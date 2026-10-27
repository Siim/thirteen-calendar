using Avalonia;
using Avalonia.Automation;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Core.Events;
using Thirteen.Desktop.Controls;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.Tests.Events;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views;
using Thirteen.Desktop.Views.CalendarSection;
using static Thirteen.Desktop.Tests.Dates;
using CalendarMode = Thirteen.Desktop.ViewModels.CalendarMode;

namespace Thirteen.Desktop.Tests.CalendarSection;

/// <summary>
/// Week and Day in the real window on the headless platform with the mockup data set (§6.7; task W6): the column
/// containers as named Groups and the blocks' names (§2.20), the keyboard (§2.21), and drag and drop with the mouse:
/// move a block (held, shown at once, toast with Undo), resize its bottom edge, drag on empty time, Alt-drag to copy,
/// drop on the all-day row, the span dialog of a repeating event, and Month's chips between days (§2.4). Set
/// THIRTEEN_TEST_SCREENSHOTS to a folder to save what they render.
/// </summary>
public class TimelineUiTests
{
    private static (MainWindow Window, MainViewModel Model, List<string> Requests, EventsHost Host) Open(CalendarMode mode)
    {
        var options = LaunchOptions.Parse(["--page", "calendar", "--fake-events", "--width", "1440", "--height", "900"]);
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
        model.CalendarPage.Mode = mode;
        Settle();
        return (window, model, requests, host);
    }

    private static void Settle()
    {
        for (var i = 0; i < 6; i++) Dispatcher.UIThread.RunJobs();
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
        // The headless renderer draws on its timer: tick it so the frame shows the current scroll position.
        AvaloniaHeadlessPlatform.ForceRenderTimerTick();
        window.CaptureRenderedFrame()?.Save(Path.Combine(folder, name));
    }

    private static Button Block(Control view, string title) =>
        view.GetVisualDescendants().OfType<Button>().First(b => b.DataContext is TimelineBlock block && block.Title == title && b.IsEffectivelyVisible);

    /// <summary>A point of <paramref name="control"/> in window coordinates (after scrolling it into view).</summary>
    private static Point At(Window window, Control control, double x, double y)
    {
        control.BringIntoView();
        Settle();
        return control.TranslatePoint(new Point(x, y), window) ?? throw new InvalidOperationException("not in the window");
    }

    /// <summary>A mouse drag in steps, with <paramref name="modifiers"/> held at the release.</summary>
    private static void Drag(Window window, Point from, Point to, RawInputModifiers modifiers = RawInputModifiers.None)
    {
        window.MouseMove(from);
        window.MouseDown(from, MouseButton.Left);
        Settle();
        for (var i = 1; i <= 4; i++)
        {
            var p = new Point(from.X + (to.X - from.X) * i / 4, from.Y + (to.Y - from.Y) * i / 4);
            window.MouseMove(p, RawInputModifiers.LeftMouseButton | modifiers);
            Settle();
        }
        window.MouseUp(to, MouseButton.Left, modifiers);
        Settle();
        for (var i = 0; i < 20; i++)
        {
            Dispatcher.UIThread.RunJobs();
            Thread.Sleep(5);
        }
    }

    [AvaloniaFact]
    public void WeekColumnsAreNamedGroupsAndTheBlocksAreNamed()
    {
        var (window, model, _, _) = Open(CalendarMode.Week);
        var week = model.CalendarPage.WeekMode;
        var view = window.GetVisualDescendants().OfType<WeekModeView>().Single();
        var timeline = view.GetVisualDescendants().OfType<TimelineView>().Single();

        // The width set maxSlots (§2.5) and the week opened at 07:00.
        Assert.NotNull(week.MaxSlots);
        Assert.True(week.MaxSlots >= 2, $"{week.MaxSlots} slots");
        var scroller = timeline.FindControl<ScrollViewer>("Scroller")!;
        Assert.Equal(7 * 60 * week.HourHeight / 60 - 6, scroller.Offset.Y, 1);
        Save(window, "windows-calendar-week-timeline.png");

        // Each column body is one container: a Group named calendar.column.a11y (§2.20).
        var panels = view.GetVisualDescendants().OfType<TimelineDayPanel>().ToArray();
        Assert.Equal(7, panels.Length);
        foreach (var panel in panels)
        {
            var peer = ControlAutomationPeer.CreatePeerForElement(panel);
            Assert.Equal(AutomationControlType.Group, peer.GetAutomationControlType());
            Assert.Equal(((TimelineColumn)panel.DataContext!).AutomationName, peer.GetName());
        }
        var todayPanel = panels.Single(p => ((TimelineColumn)p.DataContext!).IsToday);
        Assert.Equal("Thursday, October 12. Gregorian Monday, October 19", Name(todayPanel));
        Assert.Equal(["Sprint planning", "1:1 with Marta", "Dentist, Dr. Tamm", "Book club: Cotsworth"],
            todayPanel.GetVisualDescendants().OfType<Button>().Select(b => ((TimelineBlock)b.DataContext!).Title));
        Assert.Equal("Dentist, Dr. Tamm, 15:40 to 16:20, Home", Name(Block(view, "Dentist, Dr. Tamm")));
        var visual = Block(view, "Dentist, Dr. Tamm").GetVisualDescendants().OfType<TimelineBlockVisual>().Single();
        Assert.Equal(("Dentist, Dr. Tamm", "15:40 to 16:20"), (visual.Title, visual.TimeText));

        // Headers: one tab stop, today marked; the all-day bar named calendar.bar.a11y.
        var headers = timeline.FindControl<ItemsControl>("Headers")!;
        var heads = DayNavigation.Cells(headers);
        Assert.Equal(7, heads.Count);
        var todayHead = heads.Single(h => ((TimelineColumn)h.DataContext!).IsToday);
        Assert.Equal("Today", AutomationProperties.GetItemStatus(todayHead));
        Assert.Equal("Thursday, October 12. Gregorian Monday, October 19", Name(todayHead));
        var bar = view.GetVisualDescendants().OfType<Button>().Single(b => b.DataContext is AllDayBar);
        Assert.StartsWith("Autumn school break", Name(bar));

        // The hour labels and the now label are drawn; the axis says 09:41.
        var hours = view.GetVisualDescendants().OfType<TimelineHours>().Single();
        Assert.Equal((9 * 60 + 41, "09:41"), (hours.NowMinute, hours.NowText));
        Assert.Equal("07:00", hours.Labels![7]);

        CalendarsUiTests.AssertNoDashes(CalendarsUiTests.Texts(window), "week");
        window.Close();
    }

    [AvaloniaFact]
    public void WeekKeyboardGoesIntoADaysEventsAndBack()
    {
        var (window, _, requests, _) = Open(CalendarMode.Week);
        var timeline = window.GetVisualDescendants().OfType<WeekModeView>().Single().GetVisualDescendants().OfType<TimelineView>().Single();
        var headers = timeline.FindControl<ItemsControl>("Headers")!;
        var today = DayNavigation.Cells(headers).Single(h => ((TimelineColumn)h.DataContext!).IsToday);
        today.Focus(NavigationMethod.Tab);
        Settle();

        // Enter goes into the day's events: the all-day bar first, then the blocks in start order.
        Press(window, Key.Enter);
        Assert.IsType<AllDayBar>(Focused(window)!.DataContext);
        Press(window, Key.Down);
        Assert.Equal("Sprint planning", ((TimelineBlock)Focused(window)!.DataContext!).Title);
        Press(window, Key.Tab);
        Assert.Equal("1:1 with Marta", ((TimelineBlock)Focused(window)!.DataContext!).Title);
        Press(window, Key.Enter);
        Assert.StartsWith("details work/", requests[^1]);
        Press(window, Key.Escape);
        Assert.Same(today, Focused(window));
        Press(window, Key.Right);
        Assert.Equal(Day("2026-10-20"), ((TimelineColumn)Focused(window)!.DataContext!).Date);
        // F2 on a day too: the school break bar covers Friday as well, then Yoga.
        Press(window, Key.F2);
        Assert.IsType<AllDayBar>(Focused(window)!.DataContext);
        Press(window, Key.Down);
        Assert.Equal("Yoga", ((TimelineBlock)Focused(window)!.DataContext!).Title);
        // Esc from a bar spanning several days goes back to the day it was entered from.
        Press(window, Key.Up);
        Press(window, Key.Escape);
        Assert.Equal(Day("2026-10-20"), ((TimelineColumn)Focused(window)!.DataContext!).Date);
        window.Close();
    }

    [AvaloniaFact]
    public void DraggingABlockHoldsTheMoveWithUndo()
    {
        var (window, model, _, host) = Open(CalendarMode.Week);
        var view = window.GetVisualDescendants().OfType<WeekModeView>().Single();
        var calendar = model.CalendarPage;
        var hour = calendar.WeekMode.HourHeight;
        var dentist = Block(view, "Dentist, Dr. Tamm");
        // Picked up 20 minutes into the block, dropped an hour lower: 16:40, snapped to 16:45.
        var from = At(window, dentist, dentist.Bounds.Width / 2, hour * 20 / 60);
        Drag(window, from, from + new Point(0, hour));
        var change = Assert.Single(host.Pending.Pending);
        Assert.Equal(LocalDateTime.Parse("2026-10-19T16:45"), change.NewStart);
        Assert.Equal("Event moved to 16:45.", calendar.Mover.Toast.Message);
        var toast = window.GetVisualDescendants().OfType<Border>().Single(b => b.Name == "MoveToast");
        Assert.True(toast.IsEffectivelyVisible);
        Save(window, "windows-calendar-week-moved.png");
        var close = toast.GetVisualDescendants().OfType<Button>().Single(b => Name(b) == "Close");
        Assert.Equal((32, 32), (close.Bounds.Width, close.Bounds.Height));
        Assert.Contains(toast.GetVisualDescendants().OfType<Button>(), b => Name(b) == "Undo");
        // Shown at once where it was dropped.
        var moved = Block(view, "Dentist, Dr. Tamm");
        Assert.Equal(16 * 60 + 45, ((TimelineBlock)moved.DataContext!).StartMinute);

        // Undo: back where it was; nothing was written.
        calendar.Mover.Toast.UndoCommand.Execute(null);
        Settle();
        Assert.Empty(host.Pending.Pending);
        Assert.Equal(15 * 60 + 40, ((TimelineBlock)Block(view, "Dentist, Dr. Tamm").DataContext!).StartMinute);
        Assert.False(toast.IsVisible);
        window.Close();
    }

    [AvaloniaFact]
    public void DraggingTheBottomEdgeChangesTheEnd()
    {
        var (window, model, _, host) = Open(CalendarMode.Week);
        var view = window.GetVisualDescendants().OfType<WeekModeView>().Single();
        var hour = model.CalendarPage.WeekMode.HourHeight;
        var lunch = Block(view, "Lunch with Jaan");
        var from = At(window, lunch, lunch.Bounds.Width / 2, lunch.Bounds.Height - 2);
        Drag(window, from, from + new Point(0, hour / 2));
        var change = Assert.Single(host.Pending.Pending);
        Assert.Equal(LocalDateTime.Parse("2026-10-16T12:00"), change.NewStart);
        Assert.Equal(LocalDateTime.Parse("2026-10-16T13:30"), change.NewEnd);
        Assert.Equal("Event saved.", model.CalendarPage.Mover.Toast.Message);
        window.Close();
    }

    [AvaloniaFact]
    public void DraggingOnEmptyTimeMakesADraftAndAltDragCopies()
    {
        var (window, model, requests, host) = Open(CalendarMode.Week);
        var view = window.GetVisualDescendants().OfType<WeekModeView>().Single();
        var hour = model.CalendarPage.WeekMode.HourHeight;
        var sunday = view.GetVisualDescendants().OfType<TimelineDayPanel>().Single(p => ((TimelineColumn)p.DataContext!).Date == Day("2026-10-15"));
        var from = At(window, sunday, sunday.Bounds.Width / 2, hour * 9 + 2);
        Drag(window, from, from + new Point(0, hour * 1.5));
        Assert.Equal("new 2026-10-15 540", requests[^1]);
        Assert.Empty(host.Pending.Pending);

        // Alt-drag: Duplicate there, as an unsaved draft (the actions of task W7 open the editor).
        var lunch = Block(view, "Lunch with Jaan");
        var start = At(window, lunch, lunch.Bounds.Width / 2, 6);
        Drag(window, start, start + new Point(0, hour * 2), RawInputModifiers.Alt);
        Assert.StartsWith("duplicate home/lunch-jaan", requests[^1]);
        Assert.Empty(host.Pending.Pending);
        window.Close();
    }

    [AvaloniaFact]
    public void DroppingOnTheAllDayRowMakesItAllDay()
    {
        var (window, model, _, host) = Open(CalendarMode.Week);
        var view = window.GetVisualDescendants().OfType<WeekModeView>().Single();
        var timeline = view.GetVisualDescendants().OfType<TimelineView>().Single();
        var lunch = Block(view, "Lunch with Jaan");
        var from = At(window, lunch, lunch.Bounds.Width / 2, 6);
        var area = timeline.FindControl<Panel>("AllDayArea")!;
        var to = area.TranslatePoint(new Point(0, area.Bounds.Height / 2), window)!.Value.WithX(from.X);
        Drag(window, from, to);
        var change = Assert.Single(host.Pending.Pending);
        Assert.True(change.IsAllDay);
        Assert.Equal(LocalDateTime.Parse("2026-10-16T00:00"), change.NewStart);
        Assert.Equal("Event moved to Monday, October 9, 2026.", model.CalendarPage.Mover.Toast.Message);
        Assert.Contains(view.GetVisualDescendants().OfType<Button>(), b => b.DataContext is AllDayBar { Title: "Lunch with Jaan" });
        window.Close();
    }

    [AvaloniaFact]
    public void DraggingARepeatingEventAsksTheSpan()
    {
        var (window, model, _, host) = Open(CalendarMode.Week);
        var view = window.GetVisualDescendants().OfType<WeekModeView>().Single();
        var calendar = model.CalendarPage;
        Assert.NotNull(calendar.Mover.Ask);         // the span dialog, set by the view
        MovePlan.Question? asked = null;
        calendar.Mover.Ask = (question, _) =>
        {
            asked = question;
            return Task.FromResult<MoveChoice?>(question.Choices[0]);
        };
        var hour = calendar.WeekMode.HourHeight;
        var marta = Block(view, "1:1 with Marta");
        var from = At(window, marta, marta.Bounds.Width / 2, 4);
        Drag(window, from, from + new Point(0, hour));
        Assert.NotNull(asked);
        Assert.Equal(["Move this event only", "Move future events"], asked!.Choices.Select(c => c.Label));
        var change = Assert.Single(host.Pending.Pending);
        Assert.Equal(LocalDateTime.Parse("2026-10-19T12:00"), change.NewStart);
        window.Close();
    }

    [AvaloniaFact]
    public async Task TheSpanDialogShowsTheQuestionAndAnswers()
    {
        var (window, _, _, _) = Open(CalendarMode.Week);
        var draft = Drafts.New(Day("2026-10-19"), LocalDateTime.Parse("2026-10-19T09:41"), "work");
        var question = new MovePlan.Question(MoveStrings.SpanTitle, MoveStrings.DropsRepeatEndless("Year Day 2026"), [MoveStrings.ExceptionsDropped(2)],
            [new MoveChoice(MoveSpan.This, MoveStrings.MoveThis, false, draft), new MoveChoice(MoveSpan.Future, MoveStrings.MoveDeleteLater, true, draft)]);
        var dialog = new MoveSpanDialog(question);
        var answer = dialog.ShowDialog<MoveChoice?>(window);
        Settle();
        var texts = dialog.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text).ToList();
        Assert.Contains("This is a repeating event.", texts);
        Assert.Contains(MoveStrings.ExceptionsDropped(2), texts);
        CalendarsUiTests.AssertNoDashes(texts.Select(t => t ?? ""), "span dialog");
        Assert.Equal(["Move this event only", "Move and delete later events", "Cancel"], dialog.ChoiceButtons.Select(Name));
        Assert.Contains("destructive", dialog.ChoiceButtons[1].Classes);
        Save(dialog, "windows-calendar-move-span.png");
        dialog.ChoiceButtons[1].RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        Settle();
        Assert.Same(question.Choices[1], await answer);

        // Escape is Cancel.
        var second = new MoveSpanDialog(question);
        var none = second.ShowDialog<MoveChoice?>(window);
        Settle();
        second.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
        Settle();
        Assert.Null(await none);
        window.Close();
    }

    [AvaloniaFact]
    public void DayHasTheStripTheTimelineAndThePanel()
    {
        var (window, model, requests, _) = Open(CalendarMode.Day);
        var view = window.GetVisualDescendants().OfType<DayModeView>().Single();
        var strip = view.FindControl<ItemsControl>("Strip")!;
        var days = DayNavigation.Cells(strip);
        Assert.Equal(7, days.Count);
        var shown = days.Single(d => ((DayStripItem)d.DataContext!).IsSelected);
        Assert.Equal("Thursday, October 12. Gregorian Monday, October 19", Name(shown));
        // The day opens at 07:00 (its first event, Sprint planning at 09:30, is later).
        var scroller = view.GetVisualDescendants().OfType<TimelineView>().Single().FindControl<ScrollViewer>("Scroller")!;
        Assert.Equal(7 * 60 * model.CalendarPage.DayMode.HourHeight / 60 - 6, scroller.Offset.Y, 1);
        Save(window, "windows-calendar-day-timeline.png");
        var panel = Assert.Single(view.GetVisualDescendants().OfType<TimelineDayPanel>());
        Assert.Equal(AutomationControlType.Group, ControlAutomationPeer.CreatePeerForElement(panel).GetAutomationControlType());
        var texts = view.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text).ToList();
        Assert.Contains("Thursday, October 12", texts);

        // Enter on the shown day goes into its events; Esc comes back to the strip.
        shown.Focus(NavigationMethod.Tab);
        Settle();
        Press(window, Key.Enter);
        Assert.IsType<AllDayBar>(Focused(window)!.DataContext);
        Press(window, Key.Down);
        Assert.Equal("Sprint planning", ((TimelineBlock)Focused(window)!.DataContext!).Title);
        Press(window, Key.Escape);
        Assert.Same(shown, Focused(window));

        // A selected event fills the panel.
        model.CalendarPage.SelectedItem = model.CalendarPage.DayMode.DayItems.Single(i => i.Title == "Dentist, Dr. Tamm");
        Settle();
        Assert.True(view.FindControl<StackPanel>("SelectedEventPanel")!.IsEffectivelyVisible);
        texts = view.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text).ToList();
        Assert.Contains("15:40 to 16:20", texts);
        CalendarsUiTests.AssertNoDashes(CalendarsUiTests.Texts(window), "day");
        Assert.Empty(requests);
        window.Close();
    }

    [AvaloniaFact]
    public void MonthChipsMoveToAnotherDay()
    {
        var (window, model, requests, host) = Open(CalendarMode.Month);
        var view = window.GetVisualDescendants().OfType<MonthModeView>().Single();
        var chip = view.GetVisualDescendants().OfType<Button>().First(b => b.DataContext is MonthChip { Title: "Dentist, Dr. Tamm" });
        var target = view.GetVisualDescendants().OfType<Button>().Single(b => b.DataContext is MonthDayCell c && c.Date == Day("2026-10-20"));
        var from = At(window, chip, chip.Bounds.Width / 2, chip.Bounds.Height / 2);
        var to = At(window, target, target.Bounds.Width / 2, target.Bounds.Height - 10);
        Drag(window, from, to);
        var change = Assert.Single(host.Pending.Pending);
        Assert.Equal(LocalDateTime.Parse("2026-10-20T15:40"), change.NewStart);
        Assert.Equal("Event moved to Friday, October 13, 2026.", model.CalendarPage.Mover.Toast.Message);
        Assert.DoesNotContain(target.Classes, c => c == "dropTarget");

        // Alt-drag duplicates.
        var lunch = view.GetVisualDescendants().OfType<Button>().First(b => b.DataContext is MonthChip { Title: "Lunch with Jaan" });
        Drag(window, At(window, lunch, lunch.Bounds.Width / 2, lunch.Bounds.Height / 2), to, RawInputModifiers.Alt);
        Assert.StartsWith("duplicate home/lunch-jaan", requests[^1]);
        window.Close();
    }
}
