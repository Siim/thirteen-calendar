using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Core;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.ViewModels.Events;
using CalendarItem = Thirteen.Desktop.ViewModels.CalendarItem;

namespace Thirteen.Desktop.Views.Events;

/// <summary>
/// The windows of events over the main window (§2.10 to §2.13, §2.20): the details as a flyout at the item (a dialog at
/// 150 % text and above, or with nothing to point at), the editor and every question as modal dialogs over the window
/// or over the dialog on top, and focus going back to the item that opened them.
/// </summary>
public sealed class WindowEventsUi : IEventsUi
{
    private readonly Window _owner;
    private readonly Func<bool> _largeText;
    private readonly List<Window> _dialogs = [];
    private Flyout? _detailsFlyout;
    private Window? _detailsDialog;
    private Control? _detailsAnchor;

    /// <summary>The windows of events over <paramref name="owner"/>; <paramref name="largeText"/> is true at 150 % text and above.</summary>
    public WindowEventsUi(Window owner, Func<bool> largeText)
    {
        _owner = owner ?? throw new ArgumentNullException(nameof(owner));
        _largeText = largeText ?? (() => false);
        // The last chip, block or row that had focus: a delete asked through a dialog finds its place in a list again.
        owner.AddHandler(InputElement.GotFocusEvent, (_, e) =>
        {
            if (e.Source is Control control && ItemOf(control.DataContext) is not null) _lastItemFocus = control;
            WatchFocus(e.Source as Control, e.NavigationMethod);
        }, Avalonia.Interactivity.RoutingStrategies.Bubble, handledEventsToo: true);
    }

    private Control? _lastItemFocus;

    // §2.20 "Focus after actions": a change of the store or of the held changes rebuilds the views, which drops the
    // focused chip, block, row or day cell with its control (in List, the toast's timeout writing a held delete took the
    // focus off the row that Delete had moved it to). The control that shows the same event or day after the rebuild
    // gets the focus back, unless something else has it or one of these dialogs or the details flyout is open.
    private Control? _watched;
    private object? _watchedContext;
    private NavigationMethod _watchedMethod;

    private void WatchFocus(Control? control, NavigationMethod method)
    {
        if (_watched is not null) _watched.DetachedFromVisualTree -= OnWatchedDetached;
        var context = control?.DataContext;
        _watched = ItemOf(context) is not null || DayOf(context) is not null ? control : null;
        _watchedContext = _watched is null ? null : context;
        _watchedMethod = method;
        if (_watched is not null) _watched.DetachedFromVisualTree += OnWatchedDetached;
    }

    private void OnWatchedDetached(object? sender, VisualTreeAttachmentEventArgs e)
    {
        if (sender is not Control lost || !ReferenceEquals(lost, _watched)) return;
        lost.DetachedFromVisualTree -= OnWatchedDetached;
        var context = _watchedContext;
        var method = _watchedMethod;
        _watched = null;
        _watchedContext = null;
        // After the rebuild that removed it, and after a focus move already on its way (FocusAfterDelete, ReturnFocus).
        Dispatcher.UIThread.Post(() => RestoreFocus(context, method), DispatcherPriority.ContextIdle);
    }

    private void RestoreFocus(object? context, NavigationMethod method)
    {
        if (context is null || !_owner.IsVisible || _dialogs.Count > 0 || _detailsFlyout is { IsOpen: true }) return;
        if (_owner.FocusManager?.GetFocusedElement() is Visual focused && !ReferenceEquals(focused, _owner) && focused.IsAttachedToVisualTree()) return;
        var key = ItemOf(context)?.Key;
        var day = DayOf(context);
        var kind = context.GetType();
        var same = FocusTargets().Where(c => c.DataContext?.GetType() == kind).ToList();
        var target = same.FirstOrDefault(c => Equals(c.DataContext, context))
            ?? (key is null ? null : same.FirstOrDefault(c => ItemOf(c.DataContext)?.Key == key))
            ?? (day is not { } date ? null : same.FirstOrDefault(c => DayOf(c.DataContext) is { } d && d.Equals(date)));
        target?.Focus(method);
    }

    /// <summary>The dialog on top, or the main window.</summary>
    public Window Top => _dialogs.Count > 0 ? _dialogs[^1] : _owner;

    /// <summary>The dialogs open now, bottom first (tests).</summary>
    public IReadOnlyList<Window> Dialogs => _dialogs;

    /// <summary>Raised when one of these dialogs is activated or deactivated (the window tracks whether the app is in the foreground).</summary>
    public event Action? ActivationChanged;

    /// <summary>Whether one of these dialogs is the active window.</summary>
    public bool AnyDialogActive => _dialogs.Any(d => d.IsActive);

    private void Track(Window dialog)
    {
        _dialogs.Add(dialog);
        dialog.Activated += (_, _) => ActivationChanged?.Invoke();
        dialog.Deactivated += (_, _) => ActivationChanged?.Invoke();
    }

    /// <summary>The details view shown now, or null (tests).</summary>
    public EventDetailsView? DetailsView { get; private set; }

    /// <inheritdoc />
    public void ShowDetails(EventDetailsViewModel details, object? anchor)
    {
        ArgumentNullException.ThrowIfNull(details);
        CloseDetails();
        var view = new EventDetailsView { DataContext = details };
        DetailsView = view;
        var target = anchor as Control;
        _detailsAnchor = target;
        if (_largeText() || target is not { IsEffectivelyVisible: true } || TopLevel.GetTopLevel(target) is null)
        {
            view.Width = double.NaN;
            // The details show the event's title as their heading, so the title bar has no text (EventDialogWindow).
            var dialog = new EventDialogWindow
            {
                Classes = { "eventDialog" },
                Width = _largeText() ? 560 : 400,
                Content = new Border { Padding = new Thickness(24, 20), Child = view },
            };
            Avalonia.Automation.AutomationProperties.SetName(dialog, details.EventTitle);
            dialog.KeyDown += (_, e) =>
            {
                if (e.Key != Key.Escape) return;
                e.Handled = true;
                dialog.Close();
            };
            dialog.Closed += (_, _) =>
            {
                if (ReferenceEquals(_detailsDialog, dialog)) _detailsDialog = null;
                _dialogs.Remove(dialog);
                if (ReferenceEquals(DetailsView, view)) DetailsView = null;
                ReturnFocus(target);
            };
            _detailsDialog = dialog;
            Track(dialog);
            dialog.Opened += (_, _) => view.FocusFirstAction();
            _ = dialog.ShowDialog(_owner);
            return;
        }
        var flyout = new Flyout
        {
            Content = view,
            Placement = PlacementMode.RightEdgeAlignedTop,
            ShowMode = FlyoutShowMode.Standard,
        };
        flyout.Closed += (_, _) =>
        {
            if (ReferenceEquals(_detailsFlyout, flyout)) _detailsFlyout = null;
            if (ReferenceEquals(DetailsView, view)) DetailsView = null;
            ReturnFocus(target);
        };
        _detailsFlyout = flyout;
        flyout.ShowAt(target);
        view.FocusFirstAction();
    }

    /// <inheritdoc />
    public void CloseDetails()
    {
        var flyout = _detailsFlyout;
        _detailsFlyout = null;
        flyout?.Hide();
        var dialog = _detailsDialog;
        _detailsDialog = null;
        dialog?.Close();
        DetailsView = null;
    }

    /// <inheritdoc />
    public async Task ShowEditorAsync(EventEditorViewModel editor, object? anchor)
    {
        ArgumentNullException.ThrowIfNull(editor);
        var dialog = new EventEditorDialog { DataContext = editor };
        await ShowModalAsync<object?>(dialog);
        if (!editor.Saved) ReturnFocus(anchor as Control ?? _detailsAnchor);
    }

    /// <inheritdoc />
    public Task<int?> ChooseAsync(ChoiceQuestion question) => ShowModalAsync<int?>(new ChoiceDialog(question));

    /// <inheritdoc />
    public Task AlertAsync(string message) => ShowModalAsync<int?>(new ChoiceDialog(new ChoiceQuestion(message, null, [], [], EditorStrings.Ok)));

    /// <inheritdoc />
    public async Task<bool> ShowRepeatPickerAsync(RepeatPickerViewModel picker) => await ShowModalAsync<bool>(new RepeatPickerDialog(picker));

    /// <inheritdoc />
    public async Task<bool> ShowCustomRepeatAsync(CustomRepeatViewModel custom) => await ShowModalAsync<bool>(new CustomRepeatDialog(custom));

    /// <inheritdoc />
    public Task ShowFailedChangesAsync(FailedChangesViewModel list) => ShowModalAsync<object?>(new FailedChangesDialog(list));

    private async Task<T> ShowModalAsync<T>(Window dialog)
    {
        var owner = Top;
        Track(dialog);
        try
        {
            return await dialog.ShowDialog<T>(owner);
        }
        finally
        {
            _dialogs.Remove(dialog);
        }
    }

    /// <inheritdoc />
    public void Launch(Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);
        try
        {
            if (TopLevel.GetTopLevel(_owner)?.Launcher is { } launcher) _ = launcher.LaunchUriAsync(uri);
        }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            Trace.WriteLine($"Thirteen: could not open {uri}: {e.Message}");
        }
    }

    /// <inheritdoc />
    public void FocusEvent(string calendarId, string uid) => Dispatcher.UIThread.Post(() =>
    {
        var target = _owner.GetVisualDescendants().OfType<Control>()
            .Where(c => c.Focusable && c.IsEffectivelyVisible)
            .FirstOrDefault(c => ItemOf(c.DataContext) is { } item && item.CalendarId == calendarId && item.Source.Uid == uid);
        target?.Focus(NavigationMethod.Tab);
    }, DispatcherPriority.Background);

    /// <summary>The event a view's item stands for: a <see cref="CalendarItem"/>, or the chip, block, bar or row of one (no reflection, so trimming keeps it).</summary>
    private static CalendarItem? ItemOf(object? context) => context switch
    {
        CalendarItem item => item,
        MonthChip chip => chip.Item,
        TimelineBlock block => block.Item,
        AllDayBar bar => bar.Item,
        CalendarRow row => row.Item,
        EventListRow listRow => listRow.Row.Item,
        DayPanelEvent panel => panel.Item,
        _ => null,
    };

    /// <summary>A row of a list (List mode, Up next, the day lists): after a delete focus goes to the next one.</summary>
    private static bool IsListRow(object? context) => context is CalendarRow or EventListRow or DayPanelEvent;

    /// <summary>The day a day cell stands for (Month cells and band, the Week and Day column heads, the Day strip, the Month list).</summary>
    private static GregorianDate? DayOf(object? context) => context switch
    {
        MonthDayCell cell => cell.Date,
        MonthBand band => band.Date,
        TimelineColumn column => column.Date,
        DayStripItem strip => strip.Date,
        MonthListDay day => day.Date,
        _ => null,
    };

    private IEnumerable<Control> FocusTargets() =>
        _owner.GetVisualDescendants().OfType<Control>().Where(c => c.Focusable && c.IsEffectivelyVisible && c.IsEffectivelyEnabled);

    /// <inheritdoc />
    public void FocusAfterDelete(CalendarItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        var focused = _owner.FocusManager?.GetFocusedElement() as Control;
        bool Shows(Control? c) => c is not null && c.IsAttachedToVisualTree() && ItemOf(c.DataContext)?.Key == item.Key;
        var origin = Shows(focused) ? focused : Shows(_lastItemFocus) ? _lastItemFocus : Shows(_detailsAnchor) ? _detailsAnchor : null;
        // In a list: the next row (the previous one at the end), found now, before the list drops the deleted row.
        string? nextKey = null;
        if (origin is not null && IsListRow(origin.DataContext))
        {
            var rows = FocusTargets().Where(c => IsListRow(c.DataContext)).ToList();
            var index = rows.IndexOf(origin);
            if (index >= 0)
            {
                var others = rows.Select((c, i) => (Control: c, Index: i)).Where(r => ItemOf(r.Control.DataContext)?.Key != item.Key).ToList();
                var next = others.FirstOrDefault(r => r.Index > index).Control ?? others.LastOrDefault(r => r.Index < index).Control;
                nextKey = next is null ? null : ItemOf(next.DataContext)?.Key;
            }
        }
        var first = item.FirstDay;
        var last = item.LastDay;
        // After the views have dropped the event (and after a closing flyout gave focus back to its item).
        Dispatcher.UIThread.Post(() => Dispatcher.UIThread.Post(() =>
        {
            var targets = FocusTargets().ToList();
            var target = nextKey is null ? null : targets.FirstOrDefault(c => IsListRow(c.DataContext) && ItemOf(c.DataContext)?.Key == nextKey);
            target ??= targets.Where(c => DayOf(c.DataContext) is { } d && d.CompareTo(first) >= 0 && d.CompareTo(last) <= 0)
                .OrderBy(c => DayOf(c.DataContext)!.Value.JulianDayNumber)
                .FirstOrDefault();
            target?.Focus(NavigationMethod.Tab);
        }, DispatcherPriority.Background), DispatcherPriority.ContextIdle);
    }

    private static void ReturnFocus(Control? target)
    {
        if (target is null) return;
        Dispatcher.UIThread.Post(() =>
        {
            if (target.IsEffectivelyVisible && target.Focusable) target.Focus(NavigationMethod.Tab);
        }, DispatcherPriority.Background);
    }
}
