using System.ComponentModel;
using System.Diagnostics;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// The toasts of drag edits (docs/EVENTS.md §2.11 "Undo", "Toast timing"). Optional: the actions of task W7
/// (<see cref="CalendarViewModel.Actions"/>) implement it to show moves in their own toast and undo stack; until they do,
/// <see cref="EventMover"/> shows its own minimal toast (<see cref="MoveToastViewModel"/>).
/// </summary>
public interface ICalendarMoveFeedback
{
    /// <summary>
    /// A move was held (§2.11 "Moves and deletes are pending first"): its toast (<paramref name="message"/>, "Event moved to
    /// 14:00.") with Undo and Close, registered for Ctrl+Z; the toast closing (timeout, Close, the next action) commits it
    /// (<see cref="PendingChanges.CommitAsync"/>), Undo while pending discards it (<see cref="PendingChanges.Discard"/>).
    /// </summary>
    void MoveHeld(PendingChange change, string message, object? anchor);

    /// <summary>
    /// A toast without Undo: a "Move future events" change written at once (never undoable, §2.11), a refused drop (the
    /// issue's text, §2.11 "Validation") or a move that could not be written.
    /// </summary>
    void ShowMessage(string message);
}

/// <summary>
/// Drag edits of the Calendar views (docs/EVENTS.md §2.4, §2.5, §2.6, §2.11 "Drag edits"): a drop is applied to the
/// freshly fetched event (<see cref="EventMoves"/>), validated like an editor save, and asks for the span first on a
/// repeating occurrence (<see cref="Ask"/>, the span dialog with the repeat change and the losses); then "this event
/// only" and single events are held as pending changes (Undo discards them), and "future events" is written at once. An
/// Alt-drag copies (Duplicate as an unsaved draft at the dropped place, §2.4); a drag on empty time makes an unsaved draft
/// of that range.
/// </summary>
public sealed class EventMover : ViewModelBase
{
    private readonly CalendarViewModel _calendar;
    private PendingChanges? _watched;
    private bool _busy;

    /// <summary>The mover of <paramref name="calendar"/>.</summary>
    public EventMover(CalendarViewModel calendar)
    {
        _calendar = calendar ?? throw new ArgumentNullException(nameof(calendar));
        Toast = new MoveToastViewModel(calendar);
        calendar.PropertyChanged += OnCalendarChanged;
    }

    /// <summary>
    /// Asks the span question of a repeating occurrence (the views set it to the span dialog; tests answer directly):
    /// the chosen <see cref="MoveChoice"/>, or null for Cancel. The second argument is the drop's anchor.
    /// </summary>
    public Func<MovePlan.Question, object?, Task<MoveChoice?>>? Ask { get; set; }

    /// <summary>The fallback toast, shown while <see cref="CalendarViewModel.Actions"/> does not implement <see cref="ICalendarMoveFeedback"/>.</summary>
    public MoveToastViewModel Toast { get; }

    /// <summary>A drop is being handled (a second drop waits for it).</summary>
    public bool IsBusy
    {
        get => _busy;
        private set => SetProperty(ref _busy, value);
    }

    /// <summary>The question last asked (tests and the no-dashes walk read it).</summary>
    public MovePlan.Question? LastQuestion { get; private set; }

    private ICalendarMoveFeedback? Feedback => _calendar.Actions as ICalendarMoveFeedback;

    /// <summary>Whether <paramref name="item"/> can be picked up (read-only events cannot, §2.11).</summary>
    public static bool CanMove(CalendarItem item) => item?.CanEdit ?? false;

    /// <summary>
    /// Moves <paramref name="item"/> as dropped at <paramref name="target"/>. Returns true when something was held or
    /// written; false when the drop changed nothing, was refused (its text shows as a toast), or the span question was
    /// cancelled.
    /// </summary>
    public async Task<bool> MoveAsync(CalendarItem item, MoveTarget target, object? anchor = null)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(target);
        if (_calendar.Events is not { } events || _busy) return false;
        if (!item.CanEdit)
        {
            _calendar.Announce(CalendarStrings.ReadOnlyReason(item.ReadOnly) ?? "");
            return false;
        }
        IsBusy = true;
        try
        {
            WatchFailures(events.Pending);
            var store = events.Store;
            // An earlier move of this event that is still pending is written first (the next action closes its toast), and
            // the event is read again where that move put it.
            if (events.Pending?.Pending.FirstOrDefault(p => p.Key == item.Key && p.CalendarId == item.CalendarId) is { } prior)
            {
                await Toast.CommitAsync().ConfigureAwait(true);
                await events.Pending.CommitAsync(prior).ConfigureAwait(true);
                var again = events.Items(item.FirstDay, item.LastDay)
                    .FirstOrDefault(i => i.CalendarId == item.CalendarId && i.Source.Uid == item.Source.Uid && i.Start == item.Start && i.AllDay == item.AllDay);
                if (again is null)
                {
                    Show(EventStrings.CommitFailedChanged(move: true));
                    return false;
                }
                item = again;
            }

            var resolved = EventMoves.Resolve(store, item.Source);
            if (resolved is null)
            {
                Show(EventStrings.CommitFailedChanged(move: true));
                return false;
            }
            var moved = EventMoves.Move(resolved, target, store.DeviceZone, store.System);
            if (moved is null) return false;
            var calendar = store.Find(item.CalendarId);
            if (calendar is null)
            {
                Show(EventStrings.CommitFailedChanged(move: true));
                return false;
            }
            var plan = EventMoves.Plan(resolved, moved, EventEditing.InfoOf(calendar), store.System);
            switch (plan)
            {
                case MovePlan.Refused refused:
                    Show(refused.Message);
                    return false;
                case MovePlan.Single:
                    return await HoldAsync(events, resolved, moved, item, anchor).ConfigureAwait(true);
                case MovePlan.Question question:
                {
                    LastQuestion = question;
                    if (Ask is null) return false;
                    var choice = await Ask(question, anchor).ConfigureAwait(true);
                    if (choice is null) return false;
                    return choice.Span == MoveSpan.Future
                        ? await WriteFutureAsync(events, resolved, moved, choice, item).ConfigureAwait(true)
                        : await HoldAsync(events, resolved, moved, item, anchor).ConfigureAwait(true);
                }
                default:
                    return false;
            }
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>"This event only" or a single event: held as a pending change (§2.11), with its toast and Undo.</summary>
    private async Task<bool> HoldAsync(EventsModel events, ResolvedEvent resolved, MovedEvent moved, CalendarItem item, object? anchor)
    {
        var message = EventMoves.MovedMessage(item.AllDay, item.Start, moved, events.Store.System);
        var allDay = moved.AllDay == resolved.Occurrence.AllDay ? (bool?)null : moved.AllDay;
        if (events.Pending is not { } pending)
        {
            // No pending changes (tests without them): written at once.
            try
            {
                var store = events.Store;
                var now = EventMoves.ContextOf(store).Now;
                await store.UpdateGroupAsync(resolved.Occurrence.CalendarId, resolved.Occurrence.Uid, (document, group) =>
                    EventEdits.MoveOccurrence(document, group, resolved.Occurrence, moved.Start, moved.End, store.DeviceZone, store.Zones, now, allDay)).ConfigureAwait(true);
                Show(message);
                return true;
            }
            catch (EventStoreException e)
            {
                Show(FailureText(e));
                return false;
            }
        }
        var change = pending.HoldMove(resolved.Occurrence, moved.Start, moved.End, allDay);
        if (Feedback is { } feedback) feedback.MoveHeld(change, message, anchor);
        else await Toast.ShowAsync(change, message).ConfigureAwait(true);
        return true;
    }

    /// <summary>"Move future events": written at once, no Undo (§2.11).</summary>
    private async Task<bool> WriteFutureAsync(EventsModel events, ResolvedEvent resolved, MovedEvent moved, MoveChoice choice, CalendarItem item)
    {
        // The next action writes what is pending first.
        await Toast.CommitAsync().ConfigureAwait(true);
        try
        {
            await EventMoves.WriteFutureAsync(events.Store, resolved, choice.Draft).ConfigureAwait(true);
        }
        catch (EventStoreException e)
        {
            Show(FailureText(e));
            return false;
        }
        catch (InvalidDraftException e)
        {
            Show(MoveStrings.Issue(e.Issues[0]));
            return false;
        }
        catch (ThirteenException e)
        {
            Trace.WriteLine($"Thirteen: a future-events move of {item.Key} failed: {e.Message}");
            Show(EventStrings.CommitFailed(move: true));
            return false;
        }
        Show(EventMoves.MovedMessage(item.AllDay, item.Start, moved, events.Store.System));
        return true;
    }

    private static string FailureText(EventStoreException e) => e.Failure switch
    {
        StoreFailure.Changed or StoreFailure.NotFound => EventStrings.CommitFailedChanged(move: true),
        StoreFailure.ReadOnly => EventStrings.CommitFailedFinal(move: true, EventStrings.SaveFailedReadOnly),
        _ => EventStrings.CommitFailed(move: true),
    };

    /// <summary>
    /// An Alt-drag (§2.4): Duplicate at the dropped place, an unsaved draft on <paramref name="date"/> (at
    /// <paramref name="startMinute"/> on the timelines, else at the event's own time) in the editor dialog. Read-only events
    /// can be copied; nothing is stored until Add.
    /// </summary>
    public void Copy(CalendarItem item, GregorianDate date, int? startMinute, object? anchor)
    {
        ArgumentNullException.ThrowIfNull(item);
        _calendar.SelectedItem = item;
        _calendar.Actions.Duplicate(item, date, startMinute, anchor);
    }

    /// <summary>A drag on empty time (§2.5): the editor on an unsaved draft of that range (snapped to 15 minutes, at least 15 minutes long).</summary>
    public void NewFromRange(GregorianDate date, int startMinute, int endMinute, object? anchor)
    {
        var start = Math.Clamp(Math.Min(startMinute, endMinute), 0, 1440 - EventMoves.SnapMinutes);
        var end = Math.Clamp(Math.Max(startMinute, endMinute), start + EventMoves.SnapMinutes, 1440);
        _calendar.Actions.NewEvent(date, start, end, anchor);
    }

    private void Show(string message)
    {
        if (Feedback is { } feedback) feedback.ShowMessage(message);
        else Toast.ShowMessage(message);
    }

    private void WatchFailures(PendingChanges? pending)
    {
        if (ReferenceEquals(pending, _watched)) return;
        if (_watched is not null) _watched.Failed -= OnFailed;
        _watched = pending;
        if (pending is not null) pending.Failed += OnFailed;
    }

    /// <summary>A held move that could not be written went back (§2.11); its toast says so (unless W7's toasts handle failures).</summary>
    private void OnFailed(CommitFailure failure)
    {
        if (failure.Change.Kind != PendingKind.Move || Feedback is not null || !failure.Seen) return;
        Dispatcher.UIThread.Post(() => Toast.ShowMessage(failure.Message));
    }

    /// <summary>The next action (paging, Today, a mode switch, another day) commits a held move (§2.11 "The next action").</summary>
    private void OnCalendarChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(CalendarViewModel.Mode) or nameof(CalendarViewModel.PeriodTitle) && Toast.HasChange) _ = Toast.CommitAsync();
    }
}

/// <summary>
/// The minimal toast of a drag edit while the toasts of task W7 are not attached (§2.11): the message, Undo for a held
/// move (it discards the change: nothing was written), and Close (an X named "Close", which commits). It closes after 8
/// seconds, or the longer time Windows asks for, and commits; the next drag, paging and a mode switch commit it too.
/// </summary>
public sealed class MoveToastViewModel : ViewModelBase
{
    private readonly CalendarViewModel _calendar;
    private PendingChange? _change;
    private string _message = "";
    private bool _isOpen;
    private DispatcherTimer? _timer;

    internal MoveToastViewModel(CalendarViewModel calendar)
    {
        _calendar = calendar;
        UndoCommand = new RelayCommand(Undo);
        CloseCommand = new AsyncRelayCommand(CommitAsync);
    }

    /// <summary>How long a toast stays (§2.11 "Toast timing"; Windows: the longer of 8 seconds and the system setting).</summary>
    public static TimeSpan Duration { get; set; } = TimeSpan.FromSeconds(8);

    /// <summary>The text ("Event moved to 14:00.").</summary>
    public string Message
    {
        get => _message;
        private set => SetProperty(ref _message, value);
    }

    /// <summary>Whether the toast is shown.</summary>
    public bool IsOpen
    {
        get => _isOpen;
        private set => SetProperty(ref _isOpen, value);
    }

    /// <summary>A held change is shown (Undo is offered).</summary>
    public bool HasChange => _change is { State: PendingState.Pending };

    /// <summary><c>calendar.undo</c></summary>
    public string UndoText => MoveStrings.Undo;

    /// <summary><c>toast.close</c></summary>
    public string CloseText => MoveStrings.Close;

    /// <summary>Undo: discards the held change.</summary>
    public RelayCommand UndoCommand { get; }

    /// <summary>Close: commits the held change and closes.</summary>
    public AsyncRelayCommand CloseCommand { get; }

    /// <summary>Shows a held move; a toast already open is closed first (its change is committed, §2.11 "The next action").</summary>
    public async Task ShowAsync(PendingChange change, string message)
    {
        await CommitAsync().ConfigureAwait(true);
        _change = change;
        Open(message);
        _calendar.Announce(MoveStrings.AnnounceUndo(message));
    }

    /// <summary>Shows a message without Undo.</summary>
    public void ShowMessage(string message)
    {
        _ = CommitAsync();
        Open(message);
        _calendar.Announce(message);
    }

    private void Open(string message)
    {
        Message = message;
        IsOpen = true;
        OnPropertyChanged(nameof(HasChange));
        _timer?.Stop();
        _timer = new DispatcherTimer { Interval = Duration };
        _timer.Tick += (_, _) => _ = CommitAsync();
        _timer.Start();
    }

    /// <summary>Pauses the timeout while the pointer is over the toast or focus is inside it (§2.11).</summary>
    public void Pause(bool paused)
    {
        if (_timer is null) return;
        if (paused) _timer.Stop();
        else if (IsOpen) _timer.Start();
    }

    private void Undo()
    {
        var change = _change;
        _change = null;
        if (change is not null && _calendar.Events?.Pending is { } pending) pending.Discard(change);
        Close();
    }

    /// <summary>Closes the toast and writes its held change (timeout, Close, the next action).</summary>
    public async Task CommitAsync()
    {
        var change = _change;
        _change = null;
        Close();
        if (change is { State: PendingState.Pending } && _calendar.Events?.Pending is { } pending) await pending.CommitAsync(change).ConfigureAwait(true);
    }

    private void Close()
    {
        _timer?.Stop();
        _timer = null;
        IsOpen = false;
        OnPropertyChanged(nameof(HasChange));
    }
}
