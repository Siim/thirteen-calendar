using Avalonia;
using Avalonia.Automation;
using Avalonia.Automation.Peers;
using Avalonia.Automation.Provider;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Core;
using Thirteen.Desktop.Controls;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.ViewModels.Events;
using Thirteen.Desktop.Views;
using Thirteen.Desktop.Views.CalendarSection;
using Thirteen.Desktop.Views.Events;
using CalendarItem = Thirteen.Desktop.ViewModels.CalendarItem;
using CalendarMode = Thirteen.Desktop.ViewModels.CalendarMode;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// Review findings (UI) for the Windows events on the headless platform, each over the mockup data set with today fixed
/// to 2026-10-19: Ctrl+Z outside Calendar, focus after Delete, a New event link at a cold start, the Selected trait of
/// day cells and chips, the date picker's year as one spinner, the Day panel's full details, and their line order; and
/// from the cross-platform review: the "Read only" tag on subscriptions, Sunday numbers in ink in Month, and dialogs that
/// show their title and a close control once.
/// </summary>
public class ReviewFindingsUiTests
{
    private static readonly GregorianDate Day19 = new(2026, 10, 19);

    private static (MainWindow Window, MainViewModel Model, FakeEventStore Store) Open(params string[] args)
    {
        var options = LaunchOptions.Parse([.. args, "--fake-events", "--width", "1440", "--height", "900"]);
        var window = ((App)Application.Current!).CreateMainWindow(options, new MemorySettingsStore());
        var model = (MainViewModel)window.DataContext!;
        var store = new FakeEventStore();
        store.LoadAsync().GetAwaiter().GetResult();
        var host = new EventsHost(store, new SubscriptionService(store, time: store.Clock), refreshes: false);
        App.AttachEvents(model, host);
        window.Show();
        Settle();
        if (window.EventActions is { } actions)
        {
            actions.ScreenReaderRunning = () => false;
            actions.ToastTime = () => TimeSpan.FromSeconds(8);
        }
        return (window, model, store);
    }

    private static void Settle()
    {
        for (var i = 0; i < 8; i++)
        {
            Dispatcher.UIThread.RunJobs();
            AvaloniaHeadlessPlatform.ForceRenderTimerTick();
        }
    }

    private static void Press(TopLevel window, Key key, RawInputModifiers modifiers = RawInputModifiers.None)
    {
        window.KeyPress(key, modifiers, PhysicalKey.None, null);
        Settle();
        try
        {
            window.KeyRelease(key, modifiers, PhysicalKey.None, null);
        }
        catch (InvalidOperationException)
        {
            // The key closed the dialog it was pressed in.
        }
        Settle();
    }

    private static string? Name(Control control) => ControlAutomationPeer.CreatePeerForElement(control).GetName();

    /// <summary>A click: the button's command, or its Click event when it has none (the dialogs' buttons).</summary>
    private static void Click(Button button)
    {
        if (button.Command is { } command) command.Execute(button.CommandParameter);
        else button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        Settle();
    }

    private static CalendarItem Item(MainViewModel model, string title, GregorianDate? day = null) =>
        model.CalendarPage.Events!.Items(day ?? Day19, day ?? Day19).First(i => i.Title == title);

    /// <summary>Answers "Delete this event?" with "Delete event".</summary>
    private static void ConfirmDelete(MainWindow window)
    {
        var question = window.EventsUi.Dialogs.OfType<ChoiceDialog>().Last();
        Click(question.GetVisualDescendants().OfType<Button>().First(b => Name(b) == "Delete event"));
    }

    // ---- §2.11: Ctrl+Z and Ctrl+Y act on events in every section --------------------------------------------

    [AvaloniaFact]
    public void CtrlZUndoesADeleteMadeOnToday()
    {
        var (window, model, _) = Open("--page", "today");
        Assert.Equal(AppSection.Today, model.Section);
        var dentist = Item(model, "Dentist, Dr. Tamm");
        window.EventActions!.Delete(dentist, null);
        Settle();
        ConfirmDelete(window);
        Assert.Equal("Event deleted.", window.EventActions.Toast!.Message);
        Assert.DoesNotContain(model.CalendarPage.Events!.Items(Day19, Day19), i => i.Title == "Dentist, Dr. Tamm");

        // The announcement promises Control Z: it works on Today too.
        Assert.Equal(AppSection.Today, model.Section);
        Press(window, Key.Z, RawInputModifiers.Control);
        Assert.Contains(model.CalendarPage.Events!.Items(Day19, Day19), i => i.Title == "Dentist, Dr. Tamm");
        Assert.Equal(AppSection.Today, model.Section);
        window.Close();
    }

    [AvaloniaFact]
    public void OutsideCalendarATextFieldKeepsItsOwnCtrlZ()
    {
        var (window, model, _) = Open("--page", "today");
        window.EventActions!.Delete(Item(model, "Dentist, Dr. Tamm"), null);
        Settle();
        ConfirmDelete(window);
        model.Section = AppSection.Convert;
        Settle();
        var box = window.GetVisualDescendants().OfType<TextBox>().First(t => t.IsEffectivelyVisible);
        box.Focus();
        Settle();
        Assert.True(model.TextInputFocused());
        Assert.False(model.UndoCommand.CanExecute(null));
        window.Close();
    }

    // ---- §2.20: after Delete, focus goes to the deleted event's day cell ---------------------------------------

    [AvaloniaFact]
    public void DeleteMovesFocusToTheDeletedEventsDayCell()
    {
        var (window, model, _) = Open("--page", "calendar", "--calendar-mode", "month");
        Assert.Equal(CalendarMode.Month, model.CalendarPage.Mode);
        var chip = window.GetVisualDescendants().OfType<Button>()
            .First(b => b.Classes.Contains("eventChip") && b.DataContext is MonthChip { Item.Title: "Dentist, Dr. Tamm" });
        Click(chip);
        chip.Focus(NavigationMethod.Tab);
        Settle();
        Assert.Same(chip, window.FocusManager!.GetFocusedElement());
        Press(window, Key.Delete);
        ConfirmDelete(window);
        Settle();
        var focused = window.FocusManager!.GetFocusedElement() as Control;
        Assert.NotNull(focused);
        var cell = Assert.IsType<MonthDayCell>(focused.DataContext);
        Assert.Equal(Day19, cell.Date);
        window.Close();
    }

    [AvaloniaFact]
    public void DeleteInAListMovesFocusToTheNextRow()
    {
        var (window, model, _) = Open("--page", "calendar", "--calendar-mode", "list");
        var rows = window.GetVisualDescendants().OfType<Button>()
            .Where(b => b.Classes.Contains("eventRow") && b.IsEffectivelyVisible && b.DataContext is CalendarRow).ToList();
        var index = rows.FindIndex(b => ((CalendarRow)b.DataContext!).Item.Title == "Dentist, Dr. Tamm");
        Assert.True(index >= 0 && index + 1 < rows.Count);
        var next = ((CalendarRow)rows[index + 1].DataContext!).Item.Key;
        Click(rows[index]);
        rows[index].Focus(NavigationMethod.Tab);
        Settle();
        Press(window, Key.Delete);
        ConfirmDelete(window);
        Settle();
        var focused = window.FocusManager!.GetFocusedElement() as Control;
        Assert.Equal(next, Assert.IsType<CalendarRow>(focused!.DataContext).Item.Key);
        window.Close();
    }

    /// <summary>Closes the toast as its timeout does, which writes its held change, and waits for the write and the rebuild.</summary>
    private static void CloseToastAndWrite(MainWindow window)
    {
        var close = window.EventActions!.Toast!.CloseAsync();
        for (var i = 0; i < 1000 && !close.IsCompleted; i++)
        {
            Settle();
            Thread.Sleep(10);
        }
        Assert.True(close.IsCompleted);
        for (var i = 0; i < 10; i++)
        {
            Settle();
            Thread.Sleep(10);
        }
    }

    // W11 wrap-up: the write of a held delete (the toast's timeout, about 8 s later) rebuilt the list and took the focus
    // off the row Delete had moved it to (focus null). Found when the test above failed on a machine under load.
    [AvaloniaFact]
    public void TheNextRowKeepsTheFocusWhenTheHeldDeleteIsWritten()
    {
        var (window, model, _) = Open("--page", "calendar", "--calendar-mode", "list");
        window.EventActions!.ToastTime = () => TimeSpan.FromHours(1);
        var rows = window.GetVisualDescendants().OfType<Button>()
            .Where(b => b.Classes.Contains("eventRow") && b.IsEffectivelyVisible && b.DataContext is CalendarRow).ToList();
        var index = rows.FindIndex(b => ((CalendarRow)b.DataContext!).Item.Title == "Dentist, Dr. Tamm");
        var next = ((CalendarRow)rows[index + 1].DataContext!).Item.Key;
        Click(rows[index]);
        rows[index].Focus(NavigationMethod.Tab);
        Settle();
        Press(window, Key.Delete);
        ConfirmDelete(window);
        Settle();
        var before = window.FocusManager!.GetFocusedElement() as Control;
        Assert.Equal(next, Assert.IsType<CalendarRow>(before!.DataContext).Item.Key);

        Assert.Single(model.CalendarPage.Events!.Pending!.Pending);
        CloseToastAndWrite(window);
        Assert.Empty(model.CalendarPage.Events!.Pending!.Pending);   // written
        Assert.DoesNotContain(model.CalendarPage.Events!.Items(Day19, Day19), i => i.Title == "Dentist, Dr. Tamm");
        var after = window.FocusManager!.GetFocusedElement() as Control;
        Assert.NotNull(after);
        Assert.NotSame(before, after);   // the list was rebuilt
        Assert.Equal(next, Assert.IsType<CalendarRow>(after.DataContext).Item.Key);
        window.Close();
    }

    [AvaloniaFact]
    public void TheDayCellKeepsTheFocusWhenTheHeldDeleteIsWritten()
    {
        var (window, _, _) = Open("--page", "calendar", "--calendar-mode", "month");
        window.EventActions!.ToastTime = () => TimeSpan.FromHours(1);
        var chip = window.GetVisualDescendants().OfType<Button>()
            .First(b => b.Classes.Contains("eventChip") && b.DataContext is MonthChip { Item.Title: "Dentist, Dr. Tamm" });
        Click(chip);
        chip.Focus(NavigationMethod.Tab);
        Settle();
        Press(window, Key.Delete);
        ConfirmDelete(window);
        Settle();
        Assert.Equal(Day19, Assert.IsType<MonthDayCell>((window.FocusManager!.GetFocusedElement() as Control)!.DataContext).Date);

        CloseToastAndWrite(window);
        var after = window.FocusManager!.GetFocusedElement() as Control;
        Assert.NotNull(after);
        Assert.Equal(Day19, Assert.IsType<MonthDayCell>(after.DataContext).Date);
        window.Close();
    }

    // ---- §2.22: thirteen://new-event at a cold start ------------------------------------------------------------

    [AvaloniaFact]
    public void ANewEventLinkGivenAtStartOpensTheEditor()
    {
        // As App.OnFrameworkInitializationCompleted: the window and its model first (Open runs the link), events after.
        var (window, model, _) = Open("thirteen://new-event?date=2026-10-21");
        Assert.Equal(AppSection.Calendar, model.Section);
        var dialog = window.EventsUi.Dialogs.OfType<EventEditorDialog>().LastOrDefault();
        Assert.NotNull(dialog);
        Assert.Equal("New event", Name(dialog));
        Assert.Equal(new GregorianDate(2026, 10, 21), dialog.Model!.Draft.Start.Date);
        Assert.Null(model.DeferredNewEvent);
        dialog.Model.Close();
        Settle();
        window.Close();
    }

    [AvaloniaFact]
    public void ANewEventRouteGivenAtStartOpensTheEditor()
    {
        var (window, _, _) = Open("--route", "new-event?date=2026-10-22");
        var dialog = window.EventsUi.Dialogs.OfType<EventEditorDialog>().LastOrDefault();
        Assert.NotNull(dialog);
        Assert.Equal(new GregorianDate(2026, 10, 22), dialog.Model!.Draft.Start.Date);
        dialog.Model.Close();
        Settle();
        window.Close();
    }

    // ---- §2.20: Month day cells, chips and blocks carry the Selected trait --------------------------------------

    private static ISelectionItemProvider Selection(Control control) =>
        ControlAutomationPeer.CreatePeerForElement(control).GetProvider<ISelectionItemProvider>()
        ?? throw new InvalidOperationException($"{control.GetType().Name} has no SelectionItem pattern");

    [AvaloniaFact]
    public void MonthDayCellsAndChipsSaySelected()
    {
        var (window, model, _) = Open("--page", "calendar", "--calendar-mode", "month");
        var cells = window.GetVisualDescendants().OfType<SelectableButton>().Where(b => b.Classes.Contains("monthCell")).ToList();
        var selected = cells.Single(c => ((MonthDayCell)c.DataContext!).Date == model.CalendarPage.Date);
        Assert.True(Selection(selected).IsSelected);
        Assert.Equal("Today", AutomationProperties.GetItemStatus(selected));
        var other = cells.First(c => ((MonthDayCell)c.DataContext!).Date == new GregorianDate(2026, 10, 21));
        Assert.False(Selection(other).IsSelected);
        // Select through UI Automation: the day becomes the selected one.
        Selection(other).Select();
        Settle();
        Assert.Equal(new GregorianDate(2026, 10, 21), model.CalendarPage.Date);
        Assert.True(Selection(other).IsSelected);
        Assert.False(Selection(selected).IsSelected);

        var chip = window.GetVisualDescendants().OfType<SelectableButton>()
            .First(b => b.Classes.Contains("eventChip") && b.DataContext is MonthChip { Item.Title: "Design review" });
        Assert.False(Selection(chip).IsSelected);
        Click(chip);
        Assert.True(Selection(chip).IsSelected);
        window.Close();
    }

    [AvaloniaFact]
    public void WeekColumnHeadsAndBlocksSaySelected()
    {
        var (window, model, _) = Open("--page", "calendar", "--calendar-mode", "week");
        var head = window.GetVisualDescendants().OfType<SelectableButton>()
            .First(b => b.Classes.Contains("timelineHead") && b.DataContext is TimelineColumn column && column.Date == model.CalendarPage.Date);
        Assert.True(Selection(head).IsSelected);
        var block = window.GetVisualDescendants().OfType<SelectableButton>()
            .First(b => b.Classes.Contains("timelineBlock") && b.DataContext is TimelineBlock { Item.Title: "Dentist, Dr. Tamm" });
        Click(block);
        Assert.True(Selection(block).IsSelected);
        window.Close();
    }

    // ---- §2.12: the date picker's year is one adjustable control named "Year" -----------------------------------

    [AvaloniaFact]
    public void ThePickersYearIsOneSpinnerWithItsValue()
    {
        var (window, _, _) = Open("--page", "calendar");
        Press(window, Key.N, RawInputModifiers.Control);
        var dialog = window.EventsUi.Dialogs.OfType<EventEditorDialog>().Last();
        var field = dialog.FindControl<ThirteenDateField>("StartDate")!;
        field.FocusField();
        Settle();
        Press(dialog, Key.Down, RawInputModifiers.Alt);
        var view = TopLevel.GetTopLevel(dialog)!.GetVisualDescendants().OfType<ThirteenDatePickerView>().First();
        var stepper = view.GetVisualDescendants().OfType<YearStepper>().Single();
        var peer = ControlAutomationPeer.CreatePeerForElement(stepper);
        Assert.Equal("Year", peer.GetName());
        Assert.Equal(AutomationControlType.Spinner, peer.GetAutomationControlType());
        var range = peer.GetProvider<IRangeValueProvider>()!;
        Assert.Equal(2026, range.Value);
        Assert.False(range.IsReadOnly);
        range.SetValue(2028);
        Settle();
        Assert.Equal(2028, range.Value);
        Assert.Equal(2028, field.OpenPicker!.Date.Year);
        // The buttons on each side have their own names.
        var buttons = view.GetVisualDescendants().OfType<Button>().Where(b => b.Name is "PreviousYear" or "NextYear").ToList();
        Assert.Equal(["Previous year", "Next year"], buttons.Select(Name));
        field.OpenPicker.Cancel();
        Settle();
        dialog.Model!.Close();
        Settle();
        window.Close();
    }

    // ---- §2.6: the regular-width Day panel shows the details of §2.10 ------------------------------------------

    [AvaloniaFact]
    public void TheDayPanelShowsTheSelectedEventsFullDetails()
    {
        var (window, model, _) = Open("--page", "calendar", "--calendar-mode", "day");
        var block = window.GetVisualDescendants().OfType<Button>()
            .First(b => b.Classes.Contains("timelineBlock") && b.DataContext is TimelineBlock { Item.Title: "Sprint planning" });
        Click(block);
        var day = window.GetVisualDescendants().OfType<DayModeView>().Single();
        var details = day.FindControl<EventDetailsView>("SelectedDetailsView")!;
        Assert.True(details.IsEffectivelyVisible);
        var texts = details.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text).ToList();
        Assert.Contains("Repeat", texts);
        Assert.Contains("Every 2 weeks on Monday", texts);
        Assert.Contains("Calendar", texts);
        var buttons = details.GetVisualDescendants().OfType<Button>().Where(b => b.IsEffectivelyVisible).Select(Name).ToList();
        Assert.Contains("Edit", buttons);
        Assert.Contains("Delete event", buttons);
        Assert.Contains("More", buttons);
        window.Close();
    }

    // ---- §2.10 and board A2: the details' lines in order ---------------------------------------------------------

    [AvaloniaFact]
    public void TheDetailsListTimeRepeatCalendarAndAlertsBeforeLocationAndNotes()
    {
        var (window, model, _) = Open("--page", "calendar");
        var book = Item(model, "Book club: Cotsworth");
        var details = window.EventActions!.DetailsFor(book)!;
        Assert.Equal(["Time", "Repeat", "Calendar", "Alerts", "Location", "Notes"], details.Lines.Select(l => l.Label));
        Assert.Equal("Home, On this computer", details.Lines[2].Value);
        Assert.True(details.Lines[2].HasDot);
        Assert.Equal("1 hour before", details.Lines[3].Value);
        window.Close();
    }

    // ---- Cross-platform review: what Windows drew differently from the board and the other platforms --------------

    private static void Shot(TopLevel window, string name)
    {
        if (Environment.GetEnvironmentVariable("THIRTEEN_TEST_SCREENSHOTS") is not { Length: > 0 } folder) return;
        Directory.CreateDirectory(folder);
        window.CaptureRenderedFrame()?.Save(Path.Combine(folder, name));
    }

    private static Color BrushColor(IBrush? brush) => Assert.IsAssignableFrom<ISolidColorBrush>(brush).Color;

    private static Color Resource(Control control, string key) =>
        control.TryFindResource(key, control.ActualThemeVariant, out var value) ? BrushColor(value as IBrush) : throw new KeyNotFoundException(key);

    /// <summary>§2.15, boards A2 (note 9) and D (note 22): every calendar that is not writable has the "Read only" tag, subscriptions too.</summary>
    [AvaloniaFact]
    public void SubscriptionsCarryTheReadOnlyTag()
    {
        var (window, _, _) = Open("--page", "calendar", "--calendar-mode", "month");
        var pane = window.GetVisualDescendants().OfType<CalendarsPane>().Single(p => p.IsEffectivelyVisible);
        var model = (CalendarsPaneViewModel)pane.DataContext!;
        Assert.All(model.Subscribed.Rows, r => Assert.True(r.IsReadOnly, r.Name));
        Assert.All(model.Local.Rows, r => Assert.False(r.IsReadOnly, r.Name));
        var tagged = pane.GetVisualDescendants().OfType<Border>().Where(b => b.Name == "ReadOnlyTag" && b.IsEffectivelyVisible)
            .Select(b => ((CalendarRowViewModel)b.DataContext!).Name).ToList();
        Assert.Equal(["Holidays in Estonia", "Birthdays"], tagged);
        Assert.All(pane.GetVisualDescendants().OfType<Border>().Where(b => b.Name == "ReadOnlyTag" && b.IsEffectivelyVisible),
            b => Assert.Equal("Read only", b.GetVisualDescendants().OfType<TextBlock>().Single().Text));
        // The status line stays under the name, and the whole name shows beside the tag (it wraps, as on the web).
        Assert.Contains("Updated 10 min ago", pane.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text));
        var name = pane.GetVisualDescendants().OfType<TextBlock>().Single(t => t.Name == "NameText" && t.Text == "Holidays in Estonia");
        Assert.DoesNotContain(name.TextLayout.TextLines, l => l.HasCollapsed);
        Shot(window, "review-read-only-tag.png");
        window.Close();
    }

    /// <summary>Board A2 and the Mac, web and Android Month: Sunday day numbers are ink, like every other day (only Year's mini grids use the accent).</summary>
    [AvaloniaFact]
    public void MonthDrawsSundayNumbersInInk()
    {
        var (window, _, _) = Open("--page", "calendar", "--calendar-mode", "month");
        var numbers = window.GetVisualDescendants().OfType<TextBlock>()
            .Where(t => t.Classes.Contains("monthDay") && t.DataContext is MonthDayCell { IsToday: false }).ToList();
        Assert.Equal(27, numbers.Count);
        var ink = Resource(window, "ThInk");
        Assert.NotEqual(ink, Resource(window, "ThAccentText"));
        var sundays = numbers.Where(t => ((MonthDayCell)t.DataContext!).Column == 0).ToList();
        Assert.Equal(["1", "8", "15", "22"], sundays.Select(t => t.Text));
        Assert.All(numbers, t => Assert.Equal(ink, BrushColor(t.Foreground)));
        window.Close();
    }

    /// <summary>
    /// Board I1 and the web: a dialog shows its title once (the heading in its content; the title bar has no text) and
    /// has one close control (the title bar's close button; the editor's inner close button is gone). UI Automation
    /// still names the window by its title.
    /// </summary>
    [AvaloniaFact]
    public void DialogsShowTheirTitleOnceWithOneCloseControl()
    {
        var (window, model, store) = Open("--page", "calendar", "--calendar-mode", "month");
        static List<string?> VisibleTexts(Window dialog) =>
            dialog.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text).ToList();

        Press(window, Key.N, RawInputModifiers.Control);
        var editor = window.EventsUi.Dialogs.OfType<EventEditorDialog>().Last();
        Assert.True(string.IsNullOrEmpty(editor.Title));
        Assert.Equal("New event", Name(editor));
        Assert.Single(VisibleTexts(editor), t => t == "New event");
        Assert.DoesNotContain(editor.GetVisualDescendants().OfType<Button>(), b => b.IsEffectivelyVisible && Name(b) == "Close");
        Shot(editor, "review-editor-dialog.png");
        editor.Model!.Close();
        Settle();

        _ = EventDialogs.SettingsAsync(window, store, null, "holidays");
        Settle();
        var settings = window.OwnedWindows.OfType<CalendarSettingsDialog>().Single();
        Assert.True(string.IsNullOrEmpty(settings.Title));
        Assert.Equal("Calendar settings", Name(settings));
        Assert.Single(VisibleTexts(settings), t => t == "Calendar settings");
        Shot(settings, "review-calendar-settings.png");
        settings.Close();
        Settle();

        // The details as a dialog (nothing to point at, or 150 % text): the event's title once, as their heading.
        window.EventActions!.ShowDetails(Item(model, "Book club: Cotsworth"), null);
        Settle();
        var details = window.EventsUi.Dialogs.Last();
        Assert.True(string.IsNullOrEmpty(details.Title));
        Assert.Equal("Book club: Cotsworth", Name(details));
        Assert.Single(VisibleTexts(details), t => t == "Book club: Cotsworth");
        details.Close();
        Settle();
        window.Close();
    }
}
