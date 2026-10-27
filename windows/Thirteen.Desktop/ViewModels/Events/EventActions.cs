using System.ComponentModel;
using System.Diagnostics;
using Avalonia.Threading;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels.Events;

/// <summary>
/// The details, editor, delete, duplicate, undo and toasts of a window (docs/EVENTS.md §2.10, §2.11; task W7): the
/// <see cref="ICalendarActions"/> the Calendar views call through <see cref="CalendarViewModel.Actions"/>, and the
/// <see cref="ICalendarMoveFeedback"/> of drag edits (task W6), so every change of the window shares one toast and one
/// undo stack (<see cref="UndoHistory"/>, Ctrl+Z and Ctrl+Y).
/// <list type="bullet">
/// <item>Moves and deletes are held first (<see cref="PendingChanges"/>): their toast's Undo discards them, and the toast
/// closing (its timeout, Close, the next action) writes them. A failure shows its toast (Try again for a transient
/// cause); failures recorded while no window was in the foreground show at the next start (<see cref="CheckRecordedFailures"/>).</item>
/// <item>Editor saves are written at once (<see cref="EventWriter"/>); a save of a single event, of "this event only" and
/// an add are undoable, "future events" and "all events" are not (no Undo, not registered).</item>
/// <item>The next action (another change, paging, Today, a mode or section switch, opening details or the editor)
/// closes the toast first, and so writes its held change.</item>
/// </list>
/// The windows themselves are behind <see cref="IEventsUi"/> (Views/Events/WindowEventsUi), so tests script them.
/// </summary>
public sealed class EventActions : ViewModelBase, ICalendarActions, ICalendarMoveFeedback, IDisposable
{
    private readonly CalendarViewModel _calendar;
    private readonly EventsModel _events;
    private readonly IEventsUi _ui;
    private readonly PendingChanges? _pending;
    private readonly Action<Action> _post;
    private readonly HashSet<PendingChange> _retried = [];
    private EventToastViewModel? _toast;
    private EventToastViewModel? _recordedToast;
    private EventDetailsViewModel? _details;
    private EventEditorViewModel? _editor;
    private bool _writing;
    private bool _loadSeen;
    private bool _disposed;

    /// <summary>
    /// The actions of <paramref name="calendar"/> over <paramref name="events"/>, showing their windows through
    /// <paramref name="ui"/>. Pending-change events (raised on background threads) reach the toasts through
    /// <paramref name="post"/>, the UI thread's queue by default (tests run them at once).
    /// </summary>
    public EventActions(CalendarViewModel calendar, EventsModel events, IEventsUi ui, Action<Action>? post = null)
    {
        _calendar = calendar ?? throw new ArgumentNullException(nameof(calendar));
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _ui = ui ?? throw new ArgumentNullException(nameof(ui));
        _post = post ?? (action => Dispatcher.UIThread.Post(action));
        Writer = new EventWriter(events.Store, events.Clock);
        _pending = events.Pending;
        History = new UndoHistory(Writer, _pending);
        if (_pending is not null)
        {
            _pending.Failed += OnFailed;
        }
        events.Changed += OnEventsChanged;
        calendar.PropertyChanged += OnCalendarChanged;
        calendar.Shell.PropertyChanged += OnShellChanged;
        OnEventsChanged(null, EventArgs.Empty);
    }

    /// <summary>The writer of editor saves.</summary>
    public EventWriter Writer { get; }

    /// <summary>The undo stack of the window.</summary>
    public UndoHistory History { get; }

    /// <summary>The toast shown now, or null (bound by the window's toast host).</summary>
    public EventToastViewModel? Toast
    {
        get => _toast;
        private set
        {
            if (!SetProperty(ref _toast, value)) return;
            OnPropertyChanged(nameof(HasToast));
        }
    }

    /// <summary>Whether a toast shows.</summary>
    public bool HasToast => _toast is not null;

    /// <summary>The details shown now, or null.</summary>
    public EventDetailsViewModel? Details
    {
        get => _details;
        private set => SetProperty(ref _details, value);
    }

    /// <summary>The editor open now, or null.</summary>
    public EventEditorViewModel? Editor
    {
        get => _editor;
        private set => SetProperty(ref _editor, value);
    }

    /// <summary>Whether a screen reader runs (a toast with an action then stays until the next action, §2.11). Tests replace it.</summary>
    public Func<bool> ScreenReaderRunning { get; set; } = ScreenReader.IsRunning;

    /// <summary>How long a toast stays (the longer of 8 seconds and Windows' notification time). Tests replace it.</summary>
    public Func<TimeSpan> ToastTime { get; set; } = ScreenReader.ToastTime;

    private IEventStore Store => _events.Store;

    private AppState State => _calendar.State;

    private CalendarSystemId System => State.System;

    private string DeviceZone => Store.DeviceZone;

    private static bool Use24Hour => EventStrings.Use24Hour;

    // ---- ICalendarActions ---------------------------------------------------------------------------------------

    /// <inheritdoc />
    public void ShowDetails(CalendarItem item, object? anchor) => Run(() => ShowDetailsAsync(item, anchor));

    /// <inheritdoc />
    public void NewEvent(GregorianDate date, int? startMinute, int? endMinute, object? anchor) => Run(() => NewEventAsync(date, startMinute, endMinute, anchor));

    /// <inheritdoc />
    public void Edit(CalendarItem item, object? anchor) => Run(() => EditAsync(item, anchor));

    /// <inheritdoc />
    public void Delete(CalendarItem item, object? anchor) => Run(() => DeleteAsync(item, anchor));

    /// <inheritdoc />
    public void Duplicate(CalendarItem item, GregorianDate? date, int? startMinute, object? anchor) => Run(() => DuplicateAsync(item, date, startMinute, anchor));

    /// <inheritdoc />
    public void Undo() => Run(UndoAsync);

    /// <inheritdoc />
    public void Redo() => Run(RedoAsync);

    /// <inheritdoc />
    public bool CanUndo => History.CanUndo;

    /// <inheritdoc />
    public bool CanRedo => History.CanRedo;

    // ---- ICalendarMoveFeedback (task W6) --------------------------------------------------------------------------

    /// <inheritdoc />
    public void MoveHeld(PendingChange change, string message, object? anchor)
    {
        ArgumentNullException.ThrowIfNull(change);
        History.RegisterPending(change, message);
        ShowToast(PendingToast(change, message));
    }

    /// <inheritdoc />
    public void ShowMessage(string message) => ShowToast(MakeToast(message));

    // ---- Details --------------------------------------------------------------------------------------------------

    /// <summary>Opens the details of <paramref name="item"/> (§2.10).</summary>
    public async Task ShowDetailsAsync(CalendarItem item, object? anchor)
    {
        ArgumentNullException.ThrowIfNull(item);
        await NextActionAsync();
        item = Fresh(item);
        _calendar.SelectedItem = item;
        var details = CreateDetails(item, anchor);
        Details = details;
        _ui.ShowDetails(details, anchor);
    }

    /// <summary>The details of <paramref name="item"/> with their actions wired (the flyout, the dialog, the Day panel).</summary>
    private EventDetailsViewModel CreateDetails(CalendarItem item, object? anchor)
    {
        var resolved = Writer.Resolve(item.Source);
        var details = new EventDetailsViewModel(item, resolved, System, DeviceZone, Use24Hour, _ui) { Stacked = State.UsesLargeText };
        details.EditRequested += () => FromDetails(details, () => EditAsync(item, anchor));
        details.EditAlertsRequested += () => FromDetails(details, () => OpenEditorAsync(item, EditorMode.Alerts, anchor));
        details.DeleteRequested += () => FromDetails(details, () => DeleteAsync(item, anchor));
        details.DuplicateRequested += () => FromDetails(details, () => DuplicateAsync(item, null, null, anchor));
        return details;
    }

    /// <inheritdoc />
    public EventDetailsViewModel? DetailsFor(CalendarItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        return _disposed ? null : CreateDetails(item, null);
    }

    private void FromDetails(EventDetailsViewModel details, Func<Task> next)
    {
        CloseDetails(details);
        Run(next);
    }

    private void CloseDetails(EventDetailsViewModel? details = null)
    {
        if (_details is null || (details is not null && !ReferenceEquals(details, _details))) return;
        Details = null;
        _ui.CloseDetails();
    }

    // ---- The editor -----------------------------------------------------------------------------------------------

    /// <summary>"New event": the editor on an unsaved draft (§2.4, §2.11) in the default calendar (§2.15).</summary>
    public async Task NewEventAsync(GregorianDate date, int? startMinute, int? endMinute, object? anchor)
    {
        await NextActionAsync();
        var calendar = await DefaultCalendarAsync();
        if (calendar is null) return;
        var allDay = startMinute is null;
        var draft = Drafts.New(date, _events.Now(), calendar.Id, allDay, allDay ? null : DeviceZone);
        if (startMinute is { } start)
        {
            var from = new LocalDateTime(date, Math.Clamp(start, 0, 1439));
            var to = endMinute is { } end && end > from.Minute ? new LocalDateTime(date, Math.Min(end, 1440)) : from.AddMinutes(60);
            draft = draft with { Start = from, End = to };
        }
        await ShowEditorAsync(CreateEditor(EditorMode.New, draft, null), anchor);
    }

    /// <summary>Ctrl+E, "Edit": the editor on the occurrence (historical events: "Edit alerts").</summary>
    public Task EditAsync(CalendarItem item, object? anchor)
    {
        ArgumentNullException.ThrowIfNull(item);
        return OpenEditorAsync(item, item.ReadOnly == ReadOnlyReason.Historical ? EditorMode.Alerts : EditorMode.Edit, anchor);
    }

    private async Task OpenEditorAsync(CalendarItem item, EditorMode mode, object? anchor)
    {
        await NextActionAsync();
        item = Fresh(item);
        _calendar.SelectedItem = item;
        if (Writer.Resolve(item.Source) is not { } resolved)
        {
            await _ui.AlertAsync(EditorStrings.OccurrenceGone);
            return;
        }
        await ShowEditorAsync(CreateEditor(mode, resolved.Draft, resolved), anchor);
    }

    /// <summary>"Duplicate" (§2.10) or an Alt-drag copy (§2.4): the editor on an unsaved copy without its repeat.</summary>
    public async Task DuplicateAsync(CalendarItem item, GregorianDate? date, int? startMinute, object? anchor)
    {
        ArgumentNullException.ThrowIfNull(item);
        await NextActionAsync();
        item = Fresh(item);
        var source = Writer.Resolve(item.Source)?.Draft ?? DraftOf(item);
        var calendarId = Store.Find(item.CalendarId) is { IsWritable: true } ? item.CalendarId : (await DefaultCalendarAsync())?.Id;
        if (calendarId is null) return;
        var draft = source.ToDraft() with { Recurrence = null, CalendarId = calendarId };
        if (date is not null || startMinute is not null)
        {
            var day = date ?? draft.Start.Date;
            var minute = draft.AllDay ? 0 : Math.Clamp(startMinute ?? draft.Start.Minute, 0, 1439);
            try
            {
                draft = Drafts.MoveStart(draft, new LocalDateTime(day, minute), System).Draft;
            }
            catch (ThirteenException e)
            {
                Trace.WriteLine($"Thirteen: a copy of {item.Key} could not be moved to {day.ToIsoString()}: {e.Message}");
            }
        }
        await ShowEditorAsync(CreateEditor(EditorMode.New, draft, null), anchor);
    }

    private static EventDraft DraftOf(CalendarItem item) => new()
    {
        Title = item.Title,
        Location = item.Location,
        AllDay = item.AllDay,
        Start = item.Start,
        End = item.End,
        CalendarId = item.CalendarId,
        Availability = item.AllDay ? Availability.Free : Availability.Busy,
    };

    private EventEditorViewModel CreateEditor(EditorMode mode, EventDraft draft, ResolvedEvent? resolved)
    {
        var editor = new EventEditorViewModel(mode, draft, resolved, Store.Calendars, System, DeviceZone, () => State.Today, _ui, SaveAsync, Use24Hour, State.UsesLargeText)
        {
            Zones = Store.Zones,
        };
        editor.DeleteRequested += () => Run(() => DeleteFromEditorAsync(editor));
        return editor;
    }

    private async Task ShowEditorAsync(EventEditorViewModel editor, object? anchor)
    {
        CloseDetails();
        Editor = editor;
        editor.CloseRequested += (_, _) =>
        {
            if (ReferenceEquals(_editor, editor)) Editor = null;
            // After Add or Save, focus goes to the event (§2.20).
            if (editor.Saved && _lastSaved is { } saved) FocusEvent(saved.CalendarId, saved.Uid, saved.Day);
        };
        _lastSaved = null;
        await _ui.ShowEditorAsync(editor, anchor);
    }

    private (string CalendarId, string Uid, GregorianDate Day)? _lastSaved;

    /// <summary>
    /// The editor's save routine (§2.11): an add, an edit for its span, or the alerts of a historical event, written at
    /// once. Throws what the write throws (the editor shows it).
    /// </summary>
    public async Task SaveAsync(EditorSaveRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        // A save is the next change registered for undo: the toast closes first, and its held change is written.
        await NextActionAsync();
        var occurrence = request.Occurrence;
        if (request.Mode != EditorMode.New && occurrence is null) throw new InvalidOperationException("An edit needs its occurrence");
        var primary = request.Mode == EditorMode.New ? request.Draft.CalendarId : occurrence!.CalendarId;
        WriteOutcome outcome;
        _writing = true;
        try
        {
            outcome = await Writer.RunAsync(primary, (ws, ctx) => request.Mode switch
            {
                EditorMode.New => EventEditing.Create(ws, request.Draft, ctx),
                EditorMode.Alerts => EventEditing.SetAlarms(ws, occurrence!, request.Draft.Alarms, ctx),
                _ => EventEditing.Save(ws, occurrence!, request.Original, request.Draft, request.Span, ctx),
            });
        }
        finally
        {
            _writing = false;
        }
        var single = occurrence is null || !occurrence.Recurring || occurrence.Orphan;
        var undoable = request.Mode == EditorMode.New || single || request.Span == EditSpan.This;
        if (undoable && outcome.Changes.Count > 0)
        {
            var changes = outcome.Changes;
            History.RegisterWritten(changes);
            ShowToast(MakeToast(EditorStrings.Saved, EditorStrings.Undo, () => UndoWrittenAsync(changes), undoHint: true));
        }
        else
        {
            ShowToast(MakeToast(EditorStrings.Saved));
        }
        if (outcome.Result is { CalendarId: { } calendarId, Uid: { } uid }) _lastSaved = (calendarId, uid, request.Draft.Start.Date);
    }

    private async Task DeleteFromEditorAsync(EventEditorViewModel editor)
    {
        if (editor.Resolved is not { } resolved) return;
        var item = new CalendarItem(resolved.Occurrence, Store.Find(resolved.Occurrence.CalendarId));
        await DeleteAsync(item, null, editor);
    }

    // ---- Delete ---------------------------------------------------------------------------------------------------

    /// <summary>
    /// Delete (§2.11): "Delete this event?" or the span question of a repeating occurrence; "this event only" and single
    /// events are held (Undo discards them), "all future events" is written at once and has no Undo.
    /// </summary>
    public Task DeleteAsync(CalendarItem item, object? anchor) => DeleteAsync(item, anchor, null);

    private async Task DeleteAsync(CalendarItem item, object? anchor, EventEditorViewModel? editor)
    {
        ArgumentNullException.ThrowIfNull(item);
        if (editor is null) await NextActionAsync();
        item = Fresh(item);
        var repeating = item.Recurring && !item.Source.Orphan;
        var question = SpanQuestions.ForDelete(repeating);
        var answer = await _ui.ChooseAsync(question.Question);
        if (answer is not { } index) return;
        var span = question.Spans[index];
        editor?.Close();
        if (editor is not null) await NextActionAsync();
        CloseDetails();
        // §2.20: focus goes to the deleted event's day cell, or in a list to the next row (found before the views drop it).
        _ui.FocusAfterDelete(item);
        if (span == EditSpan.Future || _pending is null)
        {
            // Written at once: "all future events" is never undoable (§8.4); without pending changes (tests) a delete is.
            WriteOutcome outcome;
            _writing = true;
            try
            {
                outcome = await Writer.RunAsync(item.CalendarId, (ws, ctx) => EventEditing.Delete(ws, item.Source, span, ctx));
            }
            catch (EventStoreException e)
            {
                ShowToast(MakeToast(FailureText(e.Failure, move: false)));
                return;
            }
            catch (Exception e) when (e is ThirteenException or IOException or InvalidDraftException)
            {
                Trace.WriteLine($"Thirteen: deleting {item.Key} failed: {e.Message}");
                ShowToast(MakeToast(EventStrings.CommitFailed(move: false)));
                return;
            }
            finally
            {
                _writing = false;
            }
            if (span != EditSpan.Future && outcome.Changes.Count > 0)
            {
                var changes = outcome.Changes;
                History.RegisterWritten(changes);
                ShowToast(MakeToast(EditorStrings.Deleted, EditorStrings.Undo, () => UndoWrittenAsync(changes), undoHint: true));
            }
            else
            {
                ShowToast(MakeToast(EditorStrings.Deleted));
            }
            return;
        }
        var change = _pending.HoldDelete(item.Source);
        History.RegisterPending(change, EditorStrings.Deleted);
        ShowToast(PendingToast(change, EditorStrings.Deleted));
        if (ReferenceEquals(_calendar.SelectedItem, item) || _calendar.SelectedItem?.Key == item.Key) _calendar.SelectedItem = null;
    }

    private static string FailureText(StoreFailure failure, bool move) => failure switch
    {
        StoreFailure.Changed or StoreFailure.NotFound => EventStrings.CommitFailedChanged(move),
        StoreFailure.ReadOnly => EventStrings.CommitFailedFinal(move, EventStrings.SaveFailedReadOnly),
        _ => EventStrings.CommitFailed(move),
    };

    // ---- Undo -----------------------------------------------------------------------------------------------------

    /// <summary>Ctrl+Z (§2.11): undoes the latest change of the window; a held one is discarded (its toast closes without writing).</summary>
    public async Task UndoAsync()
    {
        var toast = _toast;
        if (toast?.Change is { State: PendingState.Pending } change && History.Contains(change))
        {
            Toast = null;
            toast.Dismiss();
            Report(await History.UndoAsync(change));
            return;
        }
        if (toast is not null)
        {
            Toast = null;
            await toast.CloseAsync();
        }
        Report(await History.UndoAsync());
    }

    /// <summary>Ctrl+Y: redoes the latest undone change; a held move or delete is held again with its toast.</summary>
    public async Task RedoAsync()
    {
        await NextActionAsync();
        var result = await History.RedoAsync();
        if (result.Held is { } held)
        {
            ShowToast(PendingToast(held, result.Message ?? ""));
            return;
        }
        Report(result);
    }

    private async Task UndoPendingAsync(PendingChange change) => Report(await History.UndoAsync(change));

    private async Task UndoWrittenAsync(IReadOnlyList<GroupChange> changes) => Report(await History.UndoWrittenAsync(changes));

    private void Report(UndoResult result)
    {
        switch (result.Outcome)
        {
            case UndoOutcome.Unavailable:
                ShowToast(MakeToast(EditorStrings.UndoUnavailable));
                break;
            case UndoOutcome.Done when result is { CalendarId: { } calendarId, Uid: { } uid }:
                // After Undo, focus goes to the restored event (§2.20).
                FocusEvent(calendarId, uid, null);
                break;
        }
    }

    // ---- Toasts ---------------------------------------------------------------------------------------------------

    private EventToastViewModel MakeToast(string message, string? actionText = null, Func<Task>? action = null, Func<Task>? closed = null, bool undoHint = false, PendingChange? change = null) =>
        new(message, actionText, action, closed, undoHint)
        {
            Duration = ToastTime(),
            StaysUntilNextAction = action is not null && ScreenReaderRunning(),
            Change = change,
        };

    /// <summary>The toast of a held move or delete: Undo discards it (or undoes it once written early), closing writes it.</summary>
    private EventToastViewModel PendingToast(PendingChange change, string message) =>
        MakeToast(message, EditorStrings.Undo, () => UndoPendingAsync(change), () => CommitAsync(change), undoHint: true, change: change);

    private async Task CommitAsync(PendingChange change)
    {
        if (_pending is not null) await _pending.CommitAsync(change);
    }

    /// <summary>Shows <paramref name="toast"/>; the toast shown before closes (and writes its held change).</summary>
    public void ShowToast(EventToastViewModel toast)
    {
        ArgumentNullException.ThrowIfNull(toast);
        var previous = _toast;
        toast.Closed += (_, _) =>
        {
            if (ReferenceEquals(_toast, toast)) Toast = null;
        };
        Toast = toast;
        if (previous is not null && !ReferenceEquals(previous, toast)) Run(previous.CloseAsync);
    }

    /// <summary>The next action closes the toast first, and so writes its held change (§2.11 "The next action").</summary>
    public async Task NextActionAsync()
    {
        if (_toast is not { } toast) return;
        Toast = null;
        await toast.CloseAsync();
    }

    private void OnCalendarChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Paging, Today and a mode switch; scrolling and selecting a day do not close it.
        if (e.PropertyName is nameof(CalendarViewModel.Mode) or nameof(CalendarViewModel.PeriodTitle)) Run(NextActionAsync);
    }

    private void OnShellChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(MainViewModel.Section)) Run(NextActionAsync);
    }

    // ---- Failures -------------------------------------------------------------------------------------------------

    /// <summary>A held change that could not be written went back (§2.11): its toast, with Try again for a transient cause.</summary>
    private void OnFailed(CommitFailure failure) => _post(() =>
    {
        if (_disposed) return;
        if (!failure.Seen)
        {
            // Recorded for the next activation; its toast ("Event deleted.") is not left on screen.
            if (_toast is { } shown && ReferenceEquals(shown.Change, failure.Change))
            {
                Toast = null;
                shown.Dismiss();
            }
            return;
        }
        var retried = _retried.Remove(failure.Change);
        if (failure.CanRetry && !retried)
        {
            ShowToast(MakeToast(failure.Message, EventStrings.TryAgain, () => RetryAsync(failure)));
        }
        else
        {
            ShowToast(MakeToast(failure.Message));
        }
    });

    /// <summary>"Try again": writes the change at once (no second hold, no new Undo window); a second failure has no Try again.</summary>
    private async Task RetryAsync(CommitFailure failure)
    {
        if (_pending is null) return;
        _retried.Add(failure.Change);
        if (await _pending.RetryAsync(failure)) _retried.Remove(failure.Change);
    }

    private void OnEventsChanged(object? sender, EventArgs e)
    {
        if (_disposed) return;
        if (!_loadSeen && Store.IsLoaded)
        {
            _loadSeen = true;
            CheckRecordedFailures();
        }
        WatchEditor();
    }

    /// <summary>
    /// The toast for failures recorded while no window was in the foreground (§2.11 "Failures nobody saw"), at the start
    /// and when the window is activated again: one names the event (Try again, or Show event), several give
    /// "{n} changes couldn't be saved." with Show. The records are cleared when the toast closes or the list opens.
    /// </summary>
    public void CheckRecordedFailures()
    {
        if (_disposed || !Store.IsLoaded || _recordedToast is { IsClosed: false }) return;
        var failures = Store.FailedCommits.ToList();
        if (failures.Count == 0 || PendingChanges.LaterMessage(failures, System) is not { } message) return;
        Func<Task> act = failures.Count > 1
            ? () => ShowFailedListAsync(failures)
            : failures[0].Cause == "transient" ? () => RetryRecordedAsync(failures[0]) : () => ShowRecordedEventAsync(failures[0]);
        var toast = MakeToast(message, PendingChanges.LaterAction(failures), async () =>
        {
            await ClearRecordedAsync();
            await act();
        }, ClearRecordedAsync);
        _recordedToast = toast;
        ShowToast(toast);
    }

    private async Task ClearRecordedAsync()
    {
        try
        {
            await Store.ClearFailedCommitsAsync();
        }
        catch (Exception e) when (e is EventStoreException or IOException or InvalidOperationException)
        {
            Trace.WriteLine($"Thirteen: could not clear the failed changes: {e.Message}");
        }
    }

    private async Task ShowFailedListAsync(IReadOnlyList<FailedCommit> failures)
    {
        FailedChangesViewModel? list = null;
        var rows = failures.Select(f => new FailedChangeRow(
            f,
            PendingChanges.LaterRow(f, System),
            async failure =>
            {
                list?.RequestClose();
                await ShowRecordedEventAsync(failure);
            },
            RetryRecordedAsync)).ToList();
        list = new FailedChangesViewModel(rows);
        await _ui.ShowFailedChangesAsync(list);
    }

    /// <summary>The stored occurrence a recorded failure was about (its key, §3.2), or null when it no longer resolves.</summary>
    public IcsExpandedEvent? FindRecorded(FailedCommit failure)
    {
        ArgumentNullException.ThrowIfNull(failure);
        var key = failure.Key;
        var slash = key.IndexOf('/', StringComparison.Ordinal);
        var bar = key.LastIndexOf('|');
        if (slash <= 0 || bar <= slash + 1 || key.Length < bar + 11) return null;
        if (!GregorianDate.TryParseIso(key.Substring(bar + 1, 10), out var original)) return null;
        var meta = Store.Find(key[..slash]);
        if (meta?.Document is not { } document) return null;
        return EventEditing.Resolve(document, meta, key, key[(slash + 1)..bar], original, Writer.Context())?.Occurrence;
    }

    /// <summary>"Show event": the details of the recorded event at its stored time, in the Calendar.</summary>
    private async Task ShowRecordedEventAsync(FailedCommit failure)
    {
        if (FindRecorded(failure) is not { } occurrence)
        {
            ShowToast(MakeToast(EventStrings.CommitFailedChanged(failure.Change.Kind != "delete")));
            return;
        }
        _calendar.Shell.Section = AppSection.Calendar;
        _calendar.Date = occurrence.Start.Date;
        await ShowDetailsAsync(new CalendarItem(occurrence, Store.Find(occurrence.CalendarId)), null);
    }

    /// <summary>"Try again" on a recorded failure: the change is made again and written at once.</summary>
    private async Task RetryRecordedAsync(FailedCommit failure)
    {
        var move = failure.Change.Kind != "delete";
        if (_pending is null || FindRecorded(failure) is not { } occurrence)
        {
            ShowToast(MakeToast(EventStrings.CommitFailedChanged(move)));
            return;
        }
        PendingChange change;
        if (!move)
        {
            change = _pending.HoldDelete(occurrence);
        }
        else
        {
            if (!GregorianDate.TryParseIso(failure.Change.Date, out var date)) return;
            var allDay = failure.Change.AllDay;
            var start = new LocalDateTime(date, allDay ? 0 : failure.Change.Minute ?? occurrence.Start.Minute);
            var length = Math.Max(allDay ? 1440 : 0, occurrence.End.MinutesSince(occurrence.Start));
            change = _pending.HoldMove(occurrence, start, start.AddMinutes(length), allDay == occurrence.AllDay ? null : allDay);
        }
        _retried.Add(change);
        if (await _pending.CommitAsync(change)) _retried.Remove(change);
    }

    // ---- The open editor and the store ----------------------------------------------------------------------------

    /// <summary>
    /// The store changed while the editor is open (§2.11 "Changes elsewhere"): the occurrence is resolved again; a deleted
    /// event closes the editor, a group changed both here and elsewhere shows the banner.
    /// </summary>
    private void WatchEditor()
    {
        if (_writing || _editor is not { IsClosed: false, Mode: not EditorMode.New, Resolved: { } resolved } editor) return;
        var occurrence = resolved.Occurrence;
        var exists = Store.FindGroup(occurrence.CalendarId, occurrence.Uid) is not null;
        var current = exists ? Writer.Resolve(occurrence) : null;
        Run(() => editor.OnStoreChangedAsync(current, exists));
    }

    // ---- Helpers --------------------------------------------------------------------------------------------------

    /// <summary>
    /// The item as stored now: a held move written by the next action changed a single event's key, so the event is found
    /// again at the same place.
    /// </summary>
    private CalendarItem Fresh(CalendarItem item)
    {
        if (Writer.Resolve(item.Source) is not null) return item;
        return _events.Items(item.FirstDay, item.LastDay).FirstOrDefault(i =>
            i.CalendarId == item.CalendarId && i.Source.Uid == item.Source.Uid && i.Start == item.Start && i.AllDay == item.AllDay) ?? item;
    }

    private async Task<CalendarState?> DefaultCalendarAsync()
    {
        try
        {
            return await DefaultCalendar.EnsureAsync(Store, State.DefaultCalendarId);
        }
        catch (Exception e) when (e is EventStoreException or IOException or InvalidOperationException)
        {
            Trace.WriteLine($"Thirteen: no calendar for a new event: {e.Message}");
            ShowToast(MakeToast($"{EditorStrings.SaveFailedTitle}. {EditorStrings.SaveFailedGeneric}"));
            return null;
        }
    }

    /// <summary>Selects and focuses the event <paramref name="uid"/> (on <paramref name="day"/> when known), best effort.</summary>
    private void FocusEvent(string calendarId, string uid, GregorianDate? day)
    {
        if (day is { } d && _events.Items(d, d).FirstOrDefault(i => i.CalendarId == calendarId && i.Source.Uid == uid) is { } item)
        {
            _calendar.SelectedItem = item;
        }
        _ui.FocusEvent(calendarId, uid);
    }

    private static void Run(Func<Task> work) => _ = RunCoreAsync(work);

    private static async Task RunCoreAsync(Func<Task> work)
    {
        try
        {
            await work();
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            Trace.WriteLine($"Thirteen: an event action failed: {e}");
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_pending is not null) _pending.Failed -= OnFailed;
        _events.Changed -= OnEventsChanged;
        _calendar.PropertyChanged -= OnCalendarChanged;
        _calendar.Shell.PropertyChanged -= OnShellChanged;
    }
}
