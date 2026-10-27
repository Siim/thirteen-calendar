using System.ComponentModel;
using Avalonia.Threading;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.ViewModels.Events;
using Thirteen.Desktop.Views.Events;

namespace Thirteen.Desktop.Views;

// The main window's part of task W7 (docs/EVENTS.md §2.10 to §2.13, §6.4): once the window has its events, the details,
// editor, delete, duplicate, undo and toasts of EventActions become the Calendar's actions (CalendarViewModel.Actions),
// shown through WindowEventsUi; the event toast sits over the page; failures recorded while no window was in the
// foreground show when the window is activated again.
public partial class MainWindow
{
    private MainViewModel? _editorModel;
    private EventsModel? _actionsEvents;
    // Read from the pending changes' writes on other threads (§2.11 "Failures nobody saw"), so not Window.IsActive.
    private volatile bool _isForeground = true;

    /// <summary>The window's event actions (null until the window has its events).</summary>
    public EventActions? EventActions { get; private set; }

    /// <summary>The windows of events over this window.</summary>
    public WindowEventsUi EventsUi => _eventsUi ??= new WindowEventsUi(this, () => _editorModel?.State.UsesLargeText ?? false);

    private WindowEventsUi? _eventsUi;

    /// <summary>The event toast (tests).</summary>
    public EventToastHost EventToastHost => EventToasts;

    private void InitializeEditor()
    {
        DataContextChanged += (_, _) => AttachEditorModel(DataContext as MainViewModel);
        AttachEditorModel(DataContext as MainViewModel);
        Activated += (_, _) =>
        {
            _isForeground = true;
            EventActions?.CheckRecordedFailures();
        };
        // A New event link given at a cold start waits for the window, its actions and the calendars (§2.22).
        Opened += (_, _) => Dispatcher.UIThread.Post(OpenDeferredNewEvent, DispatcherPriority.Background);
        // The window deactivates when one of its own dialogs (the editor) opens: still in the foreground then.
        Deactivated += (_, _) => Dispatcher.UIThread.Post(UpdateForeground, DispatcherPriority.Background);
        EventsUi.ActivationChanged += () => Dispatcher.UIThread.Post(UpdateForeground, DispatcherPriority.Background);
        ThirteenDatePickerViewModel.TabChosen += OnPickerTabChosen;
        Closed += (_, _) =>
        {
            ThirteenDatePickerViewModel.TabChosen -= OnPickerTabChosen;
            DetachActions();
        };
    }

    private void UpdateForeground() => _isForeground = IsActive || EventsUi.AnyDialogActive;

    private void AttachEditorModel(MainViewModel? model)
    {
        if (ReferenceEquals(model, _editorModel)) return;
        if (_editorModel is not null) _editorModel.PropertyChanged -= OnEditorModelChanged;
        _editorModel = model;
        if (model is not null)
        {
            model.PropertyChanged += OnEditorModelChanged;
            // The picker opens on the tab last used on this device (§2.12).
            ThirteenDatePickerViewModel.LastTab = model.State.DatePickerOnGregorian ? PickerTab.Gregorian : PickerTab.Thirteen;
        }
        AttachActions();
    }

    private void OnPickerTabChosen(PickerTab tab)
    {
        if (_editorModel is { } model) model.State.DatePickerOnGregorian = tab == PickerTab.Gregorian;
    }

    private void OnEditorModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(MainViewModel.Events) or "") AttachActions();
    }

    private void AttachActions()
    {
        var model = _editorModel;
        var events = model?.Events;
        if (ReferenceEquals(events, _actionsEvents) && EventActions is not null) return;
        DetachActions();
        if (model is null || events is null) return;
        _actionsEvents = events;
        // A held change that fails while the window is not in the foreground is recorded and shown on the next
        // activation or start, not as a toast nobody sees (§2.11).
        if (events.Pending is { } pending) pending.IsForeground = () => _isForeground;
        var actions = new EventActions(model.CalendarPage, events, EventsUi);
        EventActions = actions;
        model.CalendarPage.Actions = actions;
        EventToasts.DataContext = actions;
        if (model.DeferredNewEvent is not null)
        {
            events.Changed += OnDeferredEventsChanged;
            Dispatcher.UIThread.Post(OpenDeferredNewEvent, DispatcherPriority.Background);
        }
    }

    private void OnDeferredEventsChanged(object? sender, EventArgs e) => Dispatcher.UIThread.Post(OpenDeferredNewEvent, DispatcherPriority.Background);

    private void OpenDeferredNewEvent()
    {
        if (_editorModel is not { DeferredNewEvent: not null } model || !IsVisible) return;
        if (model.OpenDeferredNewEvent() && _actionsEvents is { } events) events.Changed -= OnDeferredEventsChanged;
    }

    private void DetachActions()
    {
        if (EventActions is not { } actions) return;
        if (_actionsEvents is { } attached) attached.Changed -= OnDeferredEventsChanged;
        if (_editorModel is { } model && ReferenceEquals(model.CalendarPage.Actions, actions)) model.CalendarPage.Actions = new PlaceholderCalendarActions();
        EventToasts.DataContext = null;
        actions.Dispose();
        EventActions = null;
        _actionsEvents = null;
    }
}
