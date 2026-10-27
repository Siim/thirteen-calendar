using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.ViewModels.Events;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// The windows of events, scripted (task W7): questions are answered from <see cref="Answers"/> (Cancel when empty),
/// alerts are recorded, the editor and the pickers are handed to the test, which drives them.
/// </summary>
internal sealed class ScriptedUi : IEventsUi
{
    public Queue<int?> Answers { get; } = new();

    public List<ChoiceQuestion> Questions { get; } = [];

    public List<string> Alerts { get; } = [];

    public List<Uri> Launched { get; } = [];

    public List<(string CalendarId, string Uid)> Focused { get; } = [];

    public EventDetailsViewModel? Details { get; private set; }

    public int DetailsClosed { get; private set; }

    public EventEditorViewModel? Editor { get; private set; }

    public FailedChangesViewModel? FailedList { get; private set; }

    /// <summary>Picks a row of the repeat picker (null: closes it without choosing).</summary>
    public Func<RepeatPickerViewModel, RepeatRowViewModel?>? PickRepeat { get; set; }

    /// <summary>Sets up the Custom dialog and presses Done (true) or Cancel.</summary>
    public Func<CustomRepeatViewModel, bool>? Custom { get; set; }

    public void ShowDetails(EventDetailsViewModel details, object? anchor) => Details = details;

    public void CloseDetails()
    {
        if (Details is not null) DetailsClosed++;
        Details = null;
    }

    public Task ShowEditorAsync(EventEditorViewModel editor, object? anchor)
    {
        Editor = editor;
        return Task.CompletedTask;
    }

    public Task<int?> ChooseAsync(ChoiceQuestion question)
    {
        Questions.Add(question);
        return Task.FromResult(Answers.Count > 0 ? Answers.Dequeue() : null);
    }

    public Task AlertAsync(string message)
    {
        Alerts.Add(message);
        return Task.CompletedTask;
    }

    public Task<bool> ShowRepeatPickerAsync(RepeatPickerViewModel picker)
    {
        if (PickRepeat?.Invoke(picker) is { } row)
        {
            picker.Choose(row);
            return Task.FromResult(true);
        }
        return Task.FromResult(false);
    }

    public Task<bool> ShowCustomRepeatAsync(CustomRepeatViewModel custom) => Task.FromResult(Custom?.Invoke(custom) ?? false);

    public Task ShowFailedChangesAsync(FailedChangesViewModel list)
    {
        FailedList = list;
        return Task.CompletedTask;
    }

    public void Launch(Uri uri) => Launched.Add(uri);

    public void FocusEvent(string calendarId, string uid) => Focused.Add((calendarId, uid));

    public List<CalendarItem> DeleteFocus { get; } = [];

    public void FocusAfterDelete(CalendarItem item) => DeleteFocus.Add(item);
}

/// <summary>A window model over the mockup data set with the actions of task W7 attached.</summary>
internal sealed class EditorFixture : IDisposable
{
    public static readonly LocalDateTime Day19 = LocalDateTime.Parse("2026-10-19T00:00");

    private EditorFixture(TestShell shell, FakeEventStore fake, IEventStore store, PendingChanges? pending, EventsModel events, ScriptedUi ui, EventActions actions)
    {
        Shell = shell;
        Fake = fake;
        Store = store;
        Pending = pending;
        Events = events;
        Ui = ui;
        Actions = actions;
    }

    public TestShell Shell { get; }

    public FakeEventStore Fake { get; }

    public IEventStore Store { get; }

    public PendingChanges? Pending { get; }

    public EventsModel Events { get; }

    public ScriptedUi Ui { get; }

    public EventActions Actions { get; }

    public CalendarViewModel Calendar => Shell.Model.CalendarPage;

    /// <summary>The mockup data set (today 2026-10-19), pending changes on; <paramref name="wrap"/> wraps the store (a flaky one).</summary>
    public static async Task<EditorFixture> CreateAsync(Func<IEventStore, IEventStore>? wrap = null, bool pending = true, bool screenReader = false)
    {
        var shell = new TestShell();
        var fake = new FakeEventStore();
        await fake.LoadAsync();
        var store = wrap?.Invoke(fake) ?? fake;
        var changes = pending ? new PendingChanges(store, fake.Clock) : null;
        var events = new EventsModel(store, pending: changes, post: action => action());
        shell.Model.AttachEvents(events);
        shell.Model.Section = AppSection.Calendar;
        var ui = new ScriptedUi();
        var actions = new EventActions(shell.Model.CalendarPage, events, ui, post: action => action())
        {
            ScreenReaderRunning = () => screenReader,
            ToastTime = () => TimeSpan.FromSeconds(8),
        };
        shell.Model.CalendarPage.Actions = actions;
        return new EditorFixture(shell, fake, store, changes, events, ui, actions);
    }

    /// <summary>The item titled <paramref name="title"/> on <paramref name="day"/> (default today).</summary>
    public CalendarItem Item(string title, string day = "2026-10-19")
    {
        var date = GregorianDate.ParseIso(day);
        return Events.Items(date, date).Single(i => i.Title == title);
    }

    public bool Shows(string title, string day = "2026-10-19")
    {
        var date = GregorianDate.ParseIso(day);
        return Events.Items(date, date).Any(i => i.Title == title);
    }

    public IcsGroup? Group(string calendarId, string uid) => Fake.FindGroup(calendarId, uid);

    public void Dispose()
    {
        Actions.Dispose();
        Pending?.Dispose();
        Events.Dispose();
    }
}
