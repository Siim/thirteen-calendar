using CommunityToolkit.Mvvm.Input;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels.Events;

/// <summary>
/// One toast of the Calendar (docs/EVENTS.md §2.11 "Toast timing"): its message, its one action (Undo, Try again, Show
/// event, Show) and its Close button (<c>toast.close</c>). A toast with an action stays 8 seconds (the longer of 8
/// seconds and the system's notification time), paused while the pointer is over it or focus is inside it, and stays
/// until the next action while a screen reader runs. Closing it (timeout, Close, the next action) runs its
/// <c>closed</c> routine once: a held move or delete is written then. Close never undoes.
/// </summary>
public sealed class EventToastViewModel : ViewModelBase
{
    private readonly Func<Task>? _action;
    private readonly Func<Task>? _closed;
    private bool _isClosed;
    private string? _actionText;

    /// <summary>A toast saying <paramref name="message"/>, with an optional action, and a routine run when it closes.</summary>
    public EventToastViewModel(string message, string? actionText = null, Func<Task>? action = null, Func<Task>? closed = null, bool undoHint = false)
    {
        Message = message ?? throw new ArgumentNullException(nameof(message));
        _actionText = actionText;
        _action = action;
        _closed = closed;
        UndoHint = undoHint;
        ActionCommand = new AsyncRelayCommand(RunActionAsync, () => HasAction);
        CloseCommand = new AsyncRelayCommand(CloseAsync);
    }

    /// <summary>The message (§2.19).</summary>
    public string Message { get; }

    /// <summary>The action's text ("Undo", "Try again", "Show event", "Show"), or null.</summary>
    public string? ActionText
    {
        get => _actionText;
        private set
        {
            if (!SetProperty(ref _actionText, value)) return;
            OnPropertyChanged(nameof(HasAction));
            OnPropertyChanged(nameof(Announcement));
            ActionCommand.NotifyCanExecuteChanged();
        }
    }

    /// <summary>Whether the action shows.</summary>
    public bool HasAction => _actionText is not null && _action is not null;

    /// <summary>The action is Undo: the announcement adds the shortcut (§2.11 "Announcement").</summary>
    public bool UndoHint { get; private set; }

    /// <summary><c>toast.close</c></summary>
    public string CloseText => CalendarStrings.ToastClose;

    /// <summary>
    /// The polite announcement: <c>calendar.announce.undo</c> ("Event deleted. Undo available: Control Z.") for a toast
    /// with Undo, else the message.
    /// </summary>
    public string Announcement => UndoHint && HasAction ? EditorStrings.AnnounceUndo(Message) : Message;

    /// <summary>The action.</summary>
    public AsyncRelayCommand ActionCommand { get; }

    /// <summary>Close (commits a held change as the timeout does; never undoes).</summary>
    public AsyncRelayCommand CloseCommand { get; }

    /// <summary>Whether it has closed.</summary>
    public bool IsClosed => _isClosed;

    /// <summary>Raised once when the toast closes.</summary>
    public event EventHandler? Closed;

    /// <summary>How long it stays when nothing pauses it (the longer of 8 seconds and the system's setting).</summary>
    public TimeSpan Duration { get; init; } = ScreenReader.DefaultToastTime;

    /// <summary>A toast with an action stays until the next action while a screen reader runs.</summary>
    public bool StaysUntilNextAction { get; init; }

    /// <summary>The held move or delete this toast commits when it closes, or null.</summary>
    public PendingChange? Change { get; init; }

    /// <summary>Removes the action at once (a change written early that is no longer undoable, §2.11).</summary>
    public void RemoveAction()
    {
        UndoHint = false;
        ActionText = null;
    }

    private async Task RunActionAsync()
    {
        if (_isClosed || _action is null) return;
        // The action replaces the close routine: Undo discards a held change instead of writing it.
        _isClosed = true;
        Closed?.Invoke(this, EventArgs.Empty);
        await _action().ConfigureAwait(true);
    }

    /// <summary>Closes the toast without its close routine (Ctrl+Z undoes its held change instead of writing it).</summary>
    public void Dismiss()
    {
        if (_isClosed) return;
        _isClosed = true;
        Closed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Closes the toast (timeout, Close, the next action) and runs its close routine once.</summary>
    public async Task CloseAsync()
    {
        if (_isClosed) return;
        _isClosed = true;
        Closed?.Invoke(this, EventArgs.Empty);
        if (_closed is not null) await _closed().ConfigureAwait(true);
    }
}

/// <summary>A row of "Changes that couldn't be saved" (§2.11): one failure's text, and Try again for a transient cause.</summary>
public sealed class FailedChangeRow
{
    internal FailedChangeRow(FailedCommit failure, string text, Func<FailedCommit, Task> open, Func<FailedCommit, Task> retry)
    {
        Failure = failure;
        Text = text;
        OpenCommand = new AsyncRelayCommand(() => open(failure));
        RetryCommand = new AsyncRelayCommand(() => retry(failure));
    }

    /// <summary>The recorded failure.</summary>
    public FailedCommit Failure { get; }

    /// <summary>The row's text (<c>calendar.commitFailed.later.*</c>).</summary>
    public string Text { get; }

    /// <summary>Whether the row offers Try again.</summary>
    public bool CanRetry => Failure.Cause == "transient";

    /// <summary><c>calendar.tryAgain</c></summary>
    public string RetryText => EventStrings.TryAgain;

    /// <summary>Opens the event's details.</summary>
    public AsyncRelayCommand OpenCommand { get; }

    /// <summary>Writes the change at once.</summary>
    public AsyncRelayCommand RetryCommand { get; }
}

/// <summary>The dialog "Changes that couldn't be saved" (§2.11), opened from the "{n} changes couldn't be saved." toast.</summary>
public sealed class FailedChangesViewModel
{
    internal FailedChangesViewModel(IReadOnlyList<FailedChangeRow> rows) => Rows = rows;

    /// <summary><c>calendar.commitFailed.list.title</c></summary>
    public string Title => EventStrings.CommitFailedListTitle;

    /// <summary>The rows.</summary>
    public IReadOnlyList<FailedChangeRow> Rows { get; }

    /// <summary><c>editor.close</c></summary>
    public string CloseText => EditorStrings.Close;

    /// <summary>Raised when a row opens its event (the dialog closes first).</summary>
    public event EventHandler? CloseRequested;

    /// <summary>Closes the dialog.</summary>
    public void RequestClose() => CloseRequested?.Invoke(this, EventArgs.Empty);

    /// <summary>Every text the dialog shows, for the no-dashes check.</summary>
    public IEnumerable<string> CopyTexts() => new[] { Title, CloseText }.Concat(Rows.SelectMany(r => new[] { r.Text, r.RetryText }));
}
