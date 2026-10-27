using Avalonia;
using Avalonia.Automation;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.ViewModels.Events;
using Thirteen.Desktop.Views;
using Thirteen.Desktop.Views.Events;
using CalendarItem = Thirteen.Desktop.ViewModels.CalendarItem;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// The details flyout, the editor dialog, its questions, the date field's picker and the toast on the headless
/// platform (task W7): the window attaches its actions, Ctrl+N and Ctrl+Enter, every closing path asking before
/// discarding, the §2.20 names of fields and toasts, the stacked rows at 150 % text, and no dash in any visible text.
/// </summary>
public class EditorUiTests
{
    private static (MainWindow Window, MainViewModel Model, FakeEventStore Store) Open(params string[] args)
    {
        var options = LaunchOptions.Parse([.. args, "--fake-events", "--width", "1440", "--height", "900", "--page", "calendar"]);
        var window = ((App)Application.Current!).CreateMainWindow(options, new MemorySettingsStore());
        var model = (MainViewModel)window.DataContext!;
        var store = new FakeEventStore();
        store.LoadAsync().GetAwaiter().GetResult();
        var host = new EventsHost(store, new SubscriptionService(store, time: store.Clock), refreshes: false);
        App.AttachEvents(model, host);
        window.Show();
        Settle();
        var actions = window.EventActions!;
        actions.ScreenReaderRunning = () => false;
        actions.ToastTime = () => TimeSpan.FromSeconds(8);
        return (window, model, store);
    }

    private static void Settle()
    {
        for (var i = 0; i < 6; i++) Dispatcher.UIThread.RunJobs();
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

    private static T Dialog<T>(MainWindow window) where T : Window => window.EventsUi.Dialogs.OfType<T>().Last();

    private static void AssertNoDashes(Visual root)
    {
        foreach (var text in root.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text ?? ""))
        {
            Assert.False(text.Contains('–') || text.Contains('—'), $"A dash in: {text}");
        }
    }

    private static void Shot(TopLevel window, string name)
    {
        if (Environment.GetEnvironmentVariable("THIRTEEN_TEST_SCREENSHOTS") is not { Length: > 0 } folder) return;
        Directory.CreateDirectory(folder);
        window.CaptureRenderedFrame()?.Save(Path.Combine(folder, name));
    }

    [AvaloniaFact]
    public void TheWindowAttachesTheEventActions()
    {
        var (window, model, _) = Open();
        Assert.IsType<EventActions>(model.CalendarPage.Actions);
        Assert.Same(window.EventActions, model.CalendarPage.Actions);
        Assert.NotNull(window.EventToastHost);
        window.Close();
    }

    [AvaloniaFact]
    public void CtrlNOpensTheEditorAndCtrlEnterAdds()
    {
        var (window, model, store) = Open();
        Press(window, Key.N, RawInputModifiers.Control);
        var dialog = Dialog<EventEditorDialog>(window);
        Assert.Equal("New event", Name(dialog));
        var editor = dialog.Model!;
        Shot(dialog, "windows-editor-new.png");

        // §2.20 names: every field is named by its label; the date field by its full both-calendar name.
        Assert.Equal("Title", AutomationProperties.GetName(dialog.FindControl<TextBox>("TitleBox")!));
        var startDate = dialog.FindControl<ThirteenDateField>("StartDate")!;
        var pickerButton = startDate.GetVisualDescendants().OfType<Button>().Single(b => b.Name == "PickerButton");
        Assert.Equal("Starts, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026", Name(pickerButton));
        Assert.Equal("Add", Name(dialog.FindControl<Button>("SaveButton")!));
        Assert.Null(dialog.FindControl<Button>("CloseButton"));   // the title bar's close button is the only one
        Assert.False(dialog.FindControl<Button>("DeleteButton")!.IsVisible);
        AssertNoDashes(dialog);

        dialog.FindControl<TextBox>("TitleBox")!.Text = "Haircut";
        Settle();
        Press(dialog, Key.Enter, RawInputModifiers.Control);
        Assert.True(editor.IsClosed);
        Assert.Empty(window.EventsUi.Dialogs);
        Assert.Contains(store.Occurrences(new(new(2026, 10, 19), 0), new(new(2026, 10, 20), 0)), o => o.Title == "Haircut");

        // The toast: the message, Undo, and the Close button after it.
        var host = window.EventToastHost;
        Assert.True(host.FindControl<Border>("ToastBox")!.IsVisible);
        Assert.Equal("Event saved.", host.FindControl<TextBlock>("MessageText")!.Text);
        Assert.Equal("Event saved. Undo available: Control Z.", AutomationProperties.GetName(host.FindControl<TextBlock>("MessageText")!));
        Assert.Equal(AutomationLiveSetting.Polite, AutomationProperties.GetLiveSetting(host.FindControl<TextBlock>("MessageText")!));
        Assert.Equal("Undo", Name(host.FindControl<Button>("ActionButton")!));
        Assert.Equal("Close", Name(host.FindControl<Button>("CloseButton")!));
        Assert.True(host.IsTiming);
        Shot(window, "windows-editor-toast.png");

        // Ctrl+Z undoes the add.
        Press(window, Key.Z, RawInputModifiers.Control);
        Assert.DoesNotContain(store.Occurrences(new(new(2026, 10, 19), 0), new(new(2026, 10, 20), 0)), o => o.Title == "Haircut");
        window.Close();
    }

    [AvaloniaFact]
    public void EscapeAsksBeforeDiscardingAndKeepEditingStays()
    {
        var (window, model, _) = Open();
        Press(window, Key.N, RawInputModifiers.Control);
        var dialog = Dialog<EventEditorDialog>(window);
        var editor = dialog.Model!;

        // Unchanged: Escape just closes.
        Press(dialog, Key.Escape);
        Assert.True(editor.IsClosed);

        Press(window, Key.N, RawInputModifiers.Control);
        dialog = Dialog<EventEditorDialog>(window);
        editor = dialog.Model!;
        dialog.FindControl<TextBox>("LocationBox")!.Text = "Tartu";
        Settle();
        Press(dialog, Key.Escape);
        var question = Dialog<ChoiceDialog>(window);
        Assert.Equal("Discard this event?", question.Question.Title);
        var buttons = question.GetVisualDescendants().OfType<Button>().Select(Name).ToList();
        Assert.Equal(["Discard event", "Keep editing"], buttons);
        AssertNoDashes(question);

        // Escape on the question is Keep editing.
        Press(question, Key.Escape);
        Assert.False(editor.IsClosed);
        Assert.Single(window.EventsUi.Dialogs);

        // The window's close button (Alt+F4) asks too; Discard event closes.
        dialog.Close();
        Settle();
        Assert.False(editor.IsClosed);
        question = Dialog<ChoiceDialog>(window);
        question.GetVisualDescendants().OfType<Button>().First(b => Name(b) == "Discard event").RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        Settle();
        Assert.True(editor.IsClosed);
        Assert.Empty(window.EventsUi.Dialogs);
        window.Close();
    }

    [AvaloniaFact]
    public void ErrorsSitUnderTheirFieldAndAreAttachedToIt()
    {
        var (window, _, _) = Open();
        Press(window, Key.N, RawInputModifiers.Control);
        var dialog = Dialog<EventEditorDialog>(window);
        var editor = dialog.Model!;
        editor.EndTime = TimeSpan.FromHours(8);
        Settle();
        Press(dialog, Key.Enter, RawInputModifiers.Control);
        Assert.False(editor.IsClosed);
        var line = dialog.FindControl<Grid>("EndErrorLine")!;
        Assert.True(line.IsEffectivelyVisible);
        var texts = line.Children.OfType<TextBlock>().ToList();
        // §2.11 "an error icon plus text, never color alone": the warning glyph, then the message.
        Assert.Equal("\uEA39", texts[0].Text);
        Assert.Equal("The end must be after the start.", texts[1].Text);
        Assert.Equal("The end must be after the start.", AutomationProperties.GetName(dialog.FindControl<TextBlock>("LiveRegion")!));
        var endDate = dialog.FindControl<ThirteenDateField>("EndDate")!;
        Assert.True(endDate.IsKeyboardFocusWithin);
        // The error is attached to the Ends field and time as their help text (Narrator reads it with the field).
        Assert.Equal("The end must be after the start.", AutomationProperties.GetHelpText(endDate.TextBox));
        Assert.Equal("The end must be after the start.", AutomationProperties.GetHelpText(dialog.FindControl<TimePicker>("EndTimeBox")!));
        Assert.Null(AutomationProperties.GetHelpText(dialog.FindControl<ThirteenDateField>("StartDate")!.TextBox));
        Assert.Equal("The end must be after the start.", ControlAutomationPeer.CreatePeerForElement(endDate.TextBox).GetHelpText());
        Shot(dialog, "windows-editor-error.png");
        AssertNoDashes(dialog);
        editor.Close();
        Settle();
        window.Close();
    }

    [AvaloniaFact]
    public void TheTimePickersFocusStopIsNamedWithItsTimeAndError()
    {
        // Found on Windows (task W11): the time picker's focusable part, its template's flyout button, had no name, so
        // UI Automation read "Avalonia.Controls.Grid". It now reads like the date field's button: the label and the value.
        var use24Hour = EventStrings.Use24Hour;
        EventStrings.Use24Hour = true;
        try
        {
            var (window, _, _) = Open();
            Press(window, Key.N, RawInputModifiers.Control);
            var dialog = Dialog<EventEditorDialog>(window);
            var editor = dialog.Model!;
            editor.StartTime = TimeSpan.FromHours(9) + TimeSpan.FromMinutes(30);
            editor.EndTime = TimeSpan.FromHours(8);
            Settle();
            Button FlyoutButton(string picker) =>
                dialog.FindControl<TimePicker>(picker)!.GetVisualDescendants().OfType<Button>().Single(b => b.Name == "PART_FlyoutButton");
            var start = FlyoutButton("StartTimeBox");
            var end = FlyoutButton("EndTimeBox");
            Assert.True(start.Focusable);
            Assert.Equal("Starts, 09:30", Name(start));
            Assert.Equal("Ends, 08:00", Name(end));
            Press(dialog, Key.Enter, RawInputModifiers.Control);
            Assert.False(editor.IsClosed);
            Assert.Equal("The end must be after the start.", ControlAutomationPeer.CreatePeerForElement(end).GetHelpText());
            Assert.True(string.IsNullOrEmpty(ControlAutomationPeer.CreatePeerForElement(start).GetHelpText()));
            editor.EndTime = TimeSpan.FromHours(10) + TimeSpan.FromMinutes(45);
            Settle();
            Assert.Equal("Ends, 10:45", Name(end));
            Assert.True(string.IsNullOrEmpty(ControlAutomationPeer.CreatePeerForElement(end).GetHelpText()));
            editor.Close();
            Settle();
            window.Close();
        }
        finally
        {
            EventStrings.Use24Hour = use24Hour;
        }
    }

    [AvaloniaFact]
    public void AltDownOpensThePickerAndEscapeClosesIt()
    {
        var (window, _, _) = Open();
        Press(window, Key.N, RawInputModifiers.Control);
        var dialog = Dialog<EventEditorDialog>(window);
        var field = dialog.FindControl<ThirteenDateField>("StartDate")!;
        field.FocusField();
        Settle();
        Press(dialog, Key.Down, RawInputModifiers.Alt);
        var picker = Assert.IsType<ThirteenDatePickerViewModel>(field.OpenPicker);
        var view = dialog.GetVisualDescendants().OfType<ThirteenDatePickerView>().FirstOrDefault()
            ?? TopLevel.GetTopLevel(dialog)!.GetVisualDescendants().OfType<ThirteenDatePickerView>().FirstOrDefault();
        Assert.NotNull(picker);
        picker.MoveDays(1);
        picker.Done();
        Settle();
        Assert.Null(field.OpenPicker);
        Assert.Equal(new Core.GregorianDate(2026, 10, 20), dialog.Model!.Draft.Start.Date);
        dialog.Model.Close();
        Settle();
        window.Close();
    }

    [AvaloniaFact]
    public void LargeTextStacksTheLabelsAboveTheirFields()
    {
        var (window, _, _) = Open("--text-scale", "1.5");
        Press(window, Key.N, RawInputModifiers.Control);
        var dialog = Dialog<EventEditorDialog>(window);
        Assert.True(dialog.Model!.LargeText);
        var rows = dialog.FindControl<StackPanel>("Rows")!.Children.OfType<Grid>().Where(g => g.Classes.Contains("row")).ToList();
        Assert.All(rows, row => Assert.Equal(2, row.RowDefinitions.Count));
        Assert.All(rows, row => Assert.Equal(1, Grid.GetRow(row.Children[1])));
        Shot(dialog, "windows-editor-large-text.png");
        dialog.Model.Close();
        Settle();
        window.Close();
    }

    [AvaloniaFact]
    public void DetailsShowInAFlyoutAndEditOpensTheEditor()
    {
        var (window, model, _) = Open();
        var item = model.Events!.Items(new(2026, 10, 19), new(2026, 10, 19)).Single(i => i.Title == "Book club: Cotsworth");
        var anchor = window.GetVisualDescendants().OfType<Button>().First(b => b.IsEffectivelyVisible);
        model.CalendarPage.Actions.ShowDetails(item, anchor);
        Settle();
        var view = window.EventsUi.DetailsView!;
        Assert.NotNull(view);
        var texts = view.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text).ToList();
        Assert.Contains("Book club: Cotsworth", texts);
        Assert.Contains("Thursday, October 12, 2026", texts);
        Assert.Contains("Every IFC month on the 12th", view.GetVisualDescendants().OfType<SelectableTextBlock>().Select(t => t.Text));
        Assert.Equal("Edit", Name(view.FindControl<Button>("EditButton")!));
        Assert.Equal("Delete event", Name(view.FindControl<Button>("DeleteButton")!));
        Assert.Equal("More", Name(view.FindControl<Button>("MoreButton")!));
        AssertNoDashes(view);
        Shot(window, "windows-details.png");

        view.FindControl<Button>("EditButton")!.Command!.Execute(null);
        Settle();
        Assert.Null(window.EventsUi.DetailsView);
        var dialog = Dialog<EventEditorDialog>(window);
        Assert.Equal("Edit event", Name(dialog));
        Assert.True(dialog.FindControl<Button>("DeleteButton")!.IsVisible);
        AssertNoDashes(dialog);
        dialog.Model!.Close();
        Settle();
        window.Close();
    }

    [AvaloniaFact]
    public void TheSpanQuestionShowsItsLossesLines()
    {
        var question = new ChoiceDialog(new ChoiceQuestion(
            "This is a repeating event.",
            "Changing the repeat applies to this and all future events.",
            ["Every later event in this series will be deleted."],
            [new Choice("Save for future events", ChoiceStyle.Destructive)],
            "Cancel"));
        question.Show();
        Settle();
        var texts = question.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text).ToList();
        Assert.Contains("Every later event in this series will be deleted.", texts);
        var buttons = question.GetVisualDescendants().OfType<Button>().ToList();
        Assert.Equal(["Save for future events", "Cancel"], buttons.Select(Name));
        Assert.Contains("destructive", buttons[0].Classes);
        Assert.True(buttons[1].IsFocused);                                   // a destructive choice: Cancel has the focus
        AssertNoDashes(question);
        Shot(question, "windows-span-question.png");
        question.Close();
    }
}
