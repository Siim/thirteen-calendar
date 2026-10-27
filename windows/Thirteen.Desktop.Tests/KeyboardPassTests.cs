using Avalonia;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views;
using Thirteen.Desktop.Views.Events;
using CalendarMode = Thirteen.Desktop.ViewModels.CalendarMode;

namespace Thirteen.Desktop.Tests;

/// <summary>
/// The keyboard pass of task W10 (docs/EVENTS.md §2.20, §2.21) on the real window with the real event actions and the
/// mockup data set, with no pointer at all: the mode keys, paging, today, a new event typed and added, its edit and
/// delete through the shortcuts, Undo and Redo, the Calendars pane, and Month's day grid into a day's events and back.
/// Every focus stop on the way must have a spoken name (what Narrator reads).
/// </summary>
public class KeyboardPassTests
{
    [AvaloniaFact]
    public void TheEventsWorkWithTheKeyboardAlone()
    {
        var (window, model, store, host) = Open();
        var calendar = model.CalendarPage;
        var stops = new List<string>();
        void Stop(TopLevel top, string where)
        {
            var focused = top.FocusManager?.GetFocusedElement() as Control;
            Assert.NotNull(focused);
            var name = ControlAutomationPeer.CreatePeerForElement(focused).GetName();
            Assert.False(string.IsNullOrWhiteSpace(name), $"{where}: the focused {focused.GetType().Name} [{string.Join(",", focused.Classes)}] has no name");
            stops.Add($"{where}: {name}");
        }

        // The mode keys (Ctrl+Shift+1 to 5) and paging (Ctrl+Left, Ctrl+Right, Ctrl+T).
        Press(window, Key.D1, RawInputModifiers.Control | RawInputModifiers.Shift);
        Assert.Equal(CalendarMode.Day, calendar.Mode);
        Press(window, Key.D2, RawInputModifiers.Control | RawInputModifiers.Shift);
        Assert.Equal(CalendarMode.Week, calendar.Mode);
        Press(window, Key.D5, RawInputModifiers.Control | RawInputModifiers.Shift);
        Assert.Equal(CalendarMode.List, calendar.Mode);
        Press(window, Key.D4, RawInputModifiers.Control | RawInputModifiers.Shift);
        Assert.Equal(CalendarMode.Year, calendar.Mode);
        Press(window, Key.D3, RawInputModifiers.Control | RawInputModifiers.Shift);
        Assert.Equal(CalendarMode.Month, calendar.Mode);
        var title = calendar.PeriodTitle;
        Press(window, Key.Right, RawInputModifiers.Control);
        Assert.NotEqual(title, calendar.PeriodTitle);
        Press(window, Key.T, RawInputModifiers.Control);
        Assert.Equal(title, calendar.PeriodTitle);

        // Tab reaches the toolbar and the Month grid; every stop is named.
        for (var i = 0; i < 14; i++)
        {
            Press(window, Key.Tab);
            Stop(window, $"Tab {i + 1}");
        }

        // Ctrl+N: the editor opens on its title; typed, then Ctrl+Enter adds the event.
        Press(window, Key.N, RawInputModifiers.Control);
        var editor = window.EventsUi.Dialogs.OfType<EventEditorDialog>().Last();
        Stop(editor, "editor");
        Assert.Same(editor.FindControl<TextBox>("TitleBox"), editor.FocusManager!.GetFocusedElement());
        editor.KeyTextInput("Keyboard check");
        Settle();
        // Tab walks the editor's fields, each named.
        for (var i = 0; i < 8; i++)
        {
            Press(editor, Key.Tab);
            Stop(editor, $"editor Tab {i + 1}");
        }
        Press(editor, Key.Enter, RawInputModifiers.Control);
        Assert.Empty(window.EventsUi.Dialogs);
        var added = store.Occurrences(new(LaunchOptions.MockupToday, 0), new(LaunchOptions.MockupToday.AddDays(1), 0)).Single(o => o.Title == "Keyboard check");

        // After Add the focus is on the new event (§2.20 "Focus after actions"), so Ctrl+E edits it and Escape closes the
        // unchanged editor without asking.
        Stop(window, "after Add");
        Assert.Contains("Keyboard check", ControlAutomationPeer.CreatePeerForElement((Control)window.FocusManager!.GetFocusedElement()!).GetName());
        Press(window, Key.E, RawInputModifiers.Control);
        editor = window.EventsUi.Dialogs.OfType<EventEditorDialog>().Last();
        Assert.Equal("Keyboard check", editor.FindControl<TextBox>("TitleBox")!.Text);
        Press(editor, Key.Escape);
        Assert.Empty(window.EventsUi.Dialogs);

        // Delete holds the delete with its toast (§2.11); Ctrl+Z discards it, Ctrl+Y holds it again, Ctrl+Z again.
        bool Held() => host.Pending.Pending.Any(p => p.Kind == PendingKind.Delete && p.Occurrence.Uid == added.Uid);
        Press(window, Key.Delete);
        // The question focuses the safe Cancel; Shift+Tab reaches "Delete event" and Enter presses it.
        var question = window.EventsUi.Dialogs.OfType<ChoiceDialog>().Last();
        Stop(question, "delete question");
        Assert.Equal("CancelButton", ((Control)question.FocusManager!.GetFocusedElement()!).Name);
        Press(question, Key.Tab, RawInputModifiers.Shift);
        Stop(question, "delete question, Shift+Tab");
        Press(question, Key.Enter);
        Assert.Empty(window.EventsUi.Dialogs);
        Assert.True(Held());
        Assert.Equal("Event deleted.", window.EventActions!.Toast!.Message);
        Press(window, Key.Z, RawInputModifiers.Control);
        Assert.False(Held());
        Press(window, Key.Y, RawInputModifiers.Control);
        Assert.True(Held());
        Press(window, Key.Z, RawInputModifiers.Control);
        Assert.False(Held());
        Assert.Contains(Today(store), o => o.Uid == added.Uid);

        // Month's grid is one stop: Home goes nowhere outside it, the arrows move by day, Enter goes into the day's
        // events and Escape back to the day.
        var cell = window.GetVisualDescendants().OfType<Button>().First(b => b.Classes.Contains("monthCell") && b.Classes.Contains("selected"));
        cell.Focus(NavigationMethod.Tab);
        Settle();
        Stop(window, "Month day");
        Press(window, Key.Right);
        Stop(window, "Month day, Right");
        Press(window, Key.Left);
        Press(window, Key.Enter);
        Stop(window, "into the day's events");
        var inside = (Control)window.FocusManager!.GetFocusedElement()!;
        Assert.Contains("eventChip", inside.Classes);
        Press(window, Key.Escape);
        Stop(window, "back to the day");
        Assert.Contains("monthCell", ((Control)window.FocusManager!.GetFocusedElement()!).Classes);

        // The Calendars pane from the keyboard (Ctrl+Shift+K) lands on a named control.
        Press(window, Key.K, RawInputModifiers.Control | RawInputModifiers.Shift);
        Stop(window, "Calendars pane");

        Assert.All(stops, s => Assert.DoesNotContain('–', s));
        Assert.All(stops, s => Assert.DoesNotContain('—', s));
        window.Close();
    }

    private static IEnumerable<Thirteen.Core.Ics.IcsExpandedEvent> Today(FakeEventStore store) =>
        store.Occurrences(new(LaunchOptions.MockupToday, 0), new(LaunchOptions.MockupToday.AddDays(1), 0));

    private static (MainWindow Window, MainViewModel Model, FakeEventStore Store, EventsHost Host) Open()
    {
        var options = LaunchOptions.Parse(["--fake-events", "--page", "calendar", "--width", "1440", "--height", "900"]);
        var window = ((App)Application.Current!).CreateMainWindow(options, new MemorySettingsStore());
        var model = (MainViewModel)window.DataContext!;
        var store = new FakeEventStore();
        store.LoadAsync().GetAwaiter().GetResult();
        var host = new EventsHost(store, new SubscriptionService(store, time: store.Clock), refreshes: false);
        App.AttachEvents(model, host);
        window.Show();
        Settle();
        window.EventActions!.ScreenReaderRunning = () => false;
        window.EventActions.ToastTime = () => TimeSpan.FromSeconds(8);
        return (window, model, store, host);
    }

    private static void Settle()
    {
        for (var i = 0; i < 6; i++) Dispatcher.UIThread.RunJobs();
    }

    private static void Press(TopLevel top, Key key, RawInputModifiers modifiers = RawInputModifiers.None)
    {
        top.KeyPress(key, modifiers, PhysicalKey.None, null);
        Settle();
        try
        {
            top.KeyRelease(key, modifiers, PhysicalKey.None, null);
        }
        catch (InvalidOperationException)
        {
            // The key closed the dialog it was pressed in.
        }
        Settle();
    }
}
