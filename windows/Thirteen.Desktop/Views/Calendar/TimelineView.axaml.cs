using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Controls;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.CalendarSection;

/// <summary>
/// The timeline of Week and Day (docs/EVENTS.md §2.5, §2.6): feeds the column width to the model (<c>maxSlots</c>),
/// scrolls a new period to 07:00 or its first event, moves the now line every half minute, and carries the keyboard
/// of §2.21 and the pointer of §2.5 (drag create, move, Alt-copy, resize, the all-day row). Drops go to
/// <see cref="CalendarViewModel.Mover"/>, which validates them, asks the span question and holds or writes them.
/// </summary>
public partial class TimelineView : UserControl
{
    /// <summary>Whether the column headers are shown (Week; Day has its strip instead).</summary>
    public static readonly StyledProperty<bool> ShowsHeadersProperty = AvaloniaProperty.Register<TimelineView, bool>(nameof(ShowsHeaders), true);

    /// <summary>How far the pointer moves before a press becomes a drag.</summary>
    public const double DragThreshold = 4;

    /// <summary>The bottom edge a press resizes from (§2.5).</summary>
    public const double ResizeEdge = 5;

    private readonly DispatcherTimer _clock;
    private TimelineModeViewModel? _model;
    private Drag? _drag;
    private GregorianDate? _enteredFrom;
    private int? _focusAfterPaging;

    /// <summary>Creates the view.</summary>
    public TimelineView()
    {
        InitializeComponent();
        Body.SizeChanged += (_, _) => UpdateColumnWidth();
        AddHandler(PointerPressedEvent, OnPointerPressed, RoutingStrategies.Tunnel);
        AddHandler(PointerMovedEvent, OnPointerMoved, RoutingStrategies.Tunnel);
        AddHandler(PointerReleasedEvent, OnPointerReleased, RoutingStrategies.Tunnel);
        AddHandler(PointerCaptureLostEvent, OnCaptureLost, RoutingStrategies.Bubble | RoutingStrategies.Direct);
        AddHandler(KeyDownEvent, OnKeyDown, RoutingStrategies.Tunnel);
        AddHandler(DoubleTappedEvent, OnDoubleTapped, RoutingStrategies.Bubble);
        _clock = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
        _clock.Tick += (_, _) => _model?.RefreshNow();
        DataContextChanged += (_, _) => Attach(DataContext as TimelineModeViewModel);
    }

    /// <inheritdoc cref="ShowsHeadersProperty"/>
    public bool ShowsHeaders { get => GetValue(ShowsHeadersProperty); set => SetValue(ShowsHeadersProperty, value); }

    /// <summary>The control Esc goes back to from a day's events (Day: its strip button); null: the column header.</summary>
    public Func<GregorianDate, Control?>? DayTarget { get; set; }

    /// <summary>The drag in progress, for tests: its kind, or null.</summary>
    internal string? DragKindName => _drag is { Active: true } d ? d.Kind.ToString() : null;

    /// <inheritdoc />
    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _clock.Start();
        _model?.RefreshNow();
    }

    /// <inheritdoc />
    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        _clock.Stop();
        CancelDrag();
    }

    private void Attach(TimelineModeViewModel? model)
    {
        if (ReferenceEquals(model, _model)) return;
        if (_model is not null)
        {
            _model.PropertyChanged -= OnModelChanged;
            _model.Calendar.Paging -= OnPaging;
            _model.Calendar.Paged -= OnPaged;
        }
        _model = model;
        if (model is null) return;
        model.PropertyChanged += OnModelChanged;
        model.Calendar.Paging += OnPaging;
        model.Calendar.Paged += OnPaged;
        // The span dialog of drag edits (tests answer it themselves).
        model.Calendar.Mover.Ask ??= MoveSpanDialog.AskOver(this);
        WireColumns();
        UpdateColumnWidth();
        RequestScroll();
    }

    private void OnModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(TimelineModeViewModel.Columns):
                WireColumns();
                Dispatcher.UIThread.Post(UpdateColumnWidth, DispatcherPriority.Loaded);
                break;
            case nameof(TimelineModeViewModel.ScrollRequest):
            case nameof(TimelineModeViewModel.HourHeight):
                RequestScroll();
                break;
        }
    }

    /// <summary>The columns' "New event" uses the next half hour at the top of the visible timeline (§2.6).</summary>
    private void WireColumns()
    {
        if (_model is null) return;
        foreach (var column in _model.Columns) column.NextHalfHour = NextHalfHour;
    }

    private int NextHalfHour()
    {
        var hour = _model?.HourHeight ?? Timeline.BaseHourHeight;
        var minute = Scroller.Offset.Y / hour * 60;
        return Math.Clamp((int)Math.Ceiling(minute / 30) * 30, 0, 23 * 60);
    }

    /// <summary><c>maxSlots</c> from the width of a day column (an intercalary column is 60 % of it).</summary>
    private void UpdateColumnWidth()
    {
        if (_model is null) return;
        var width = Body.Bounds.Width;
        if (width <= 0) return;
        var total = _model.ColumnWeights.Sum();
        if (total <= 0) return;
        _model.SetColumnWidth(width / total);
    }

    private void RequestScroll() => Dispatcher.UIThread.Post(ScrollToRequested, DispatcherPriority.Loaded);

    /// <summary>A new period opens at 07:00, or at its first event if earlier (§2.5).</summary>
    private void ScrollToRequested() => ScrollTo(attempts: 4);

    private void ScrollTo(int attempts)
    {
        if (_model is null) return;
        var y = Math.Max(0, _model.ScrollMinute * _model.HourHeight / 60 - 6);
        if (Scroller.Extent.Height - Scroller.Viewport.Height < y && attempts > 0)
        {
            // Not laid out yet (a view shown for the first time): once it is, the offset is not clamped away.
            Dispatcher.UIThread.Post(() => ScrollTo(attempts - 1), DispatcherPriority.Background);
            return;
        }
        Scroller.Offset = new Vector(0, y);
    }

    // ---- Paging keeps the focused column (§2.1) ----------------------------------------------------

    private void OnPaging(object? sender, EventArgs e)
    {
        _focusAfterPaging = null;
        if (!IsEffectivelyVisible || TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement() is not Visual focused || !Headers.IsVisualAncestorOf(focused)) return;
        if (focused.FindAncestorOfType<Button>(includeSelf: true)?.DataContext is TimelineColumn column) _focusAfterPaging = column.Column;
    }

    private void OnPaged(object? sender, EventArgs e)
    {
        if (_focusAfterPaging is not { } index) return;
        _focusAfterPaging = null;
        Dispatcher.UIThread.Post(() =>
        {
            var cells = DayNavigation.Cells(Headers);
            if (cells.Count == 0) return;
            var target = cells.FirstOrDefault(c => c.DataContext is TimelineColumn col && col.Column == index) ?? cells[^1];
            target.Focus(NavigationMethod.Directional);
        }, DispatcherPriority.Loaded);
    }

    // ---- Keyboard (§2.21) ----------------------------------------------------------------------------

    /// <summary>The buttons of a day's events, in the order they are focused: its all-day bars (by lane), then its blocks in start order.</summary>
    internal Button[] ItemsOf(GregorianDate date)
    {
        if (_model is null) return [];
        var column = _model.Columns.FirstOrDefault(c => c.Date == date);
        if (column is null) return [];
        var bars = AllDayItems.GetVisualDescendants().OfType<Button>()
            .Where(b => b.IsEffectivelyVisible && b.DataContext is ITimelinePlacement p and (AllDayBar or AllDayMore)
                && p.Column <= column.Column && column.Column < p.Column + p.ColumnSpan)
            .OrderBy(b => ((ITimelinePlacement)b.DataContext!).Lane);
        var panel = DayPanelOf(column);
        IEnumerable<Button> blocks = panel is null
            ? []
            : panel.GetVisualDescendants().OfType<Button>()
                .Where(b => b.IsEffectivelyVisible && b.DataContext is TimelineBlock or TimelineOverflow)
                .OrderBy(b => b.DataContext is TimelineBlock t ? t.StartMinute : ((TimelineOverflow)b.DataContext!).StartMinute)
                .ThenBy(b => b.DataContext is TimelineBlock t ? t.Slot : ((TimelineOverflow)b.DataContext!).Slot);
        return bars.Concat(blocks).ToArray();
    }

    /// <summary>The column body (the Group of §2.20) of a column.</summary>
    internal TimelineDayPanel? DayPanelOf(TimelineColumn column) =>
        Body.GetVisualDescendants().OfType<TimelineDayPanel>().FirstOrDefault(p => ReferenceEquals(p.DataContext, column));

    /// <summary>Enter or F2 on a day: focus goes to its first event; false when it has none.</summary>
    public bool FocusFirstItem(GregorianDate date)
    {
        var first = ItemsOf(date).FirstOrDefault();
        if (first is null) return false;
        _enteredFrom = date;
        first.Focus(NavigationMethod.Directional);
        first.BringIntoView();
        return true;
    }

    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (_drag is { Active: true } && e.Key == Key.Escape)
        {
            CancelDrag();
            e.Handled = true;
            return;
        }
        if (e.Source is not Visual source) return;
        var button = source.FindAncestorOfType<Button>(includeSelf: true);
        switch (button?.DataContext)
        {
            case TimelineColumn column when e.KeyModifiers == KeyModifiers.None && e.Key is Key.Enter or Key.F2:
                // Into the day's events; a day without events takes Enter as a click (select).
                if (FocusFirstItem(column.Date)) e.Handled = true;
                break;
            case TimelineBlock or TimelineOverflow or AllDayBar or AllDayMore:
                OnItemKeyDown(button!, e);
                break;
        }
    }

    private void OnItemKeyDown(Button item, KeyEventArgs e)
    {
        var date = DayOfItem(item);
        var items = date is { } d ? ItemsOf(d) : [item];
        var index = Array.IndexOf(items, item);
        switch (e.Key)
        {
            case Key.Escape:
                if (date is { } day && DayControl(day) is { } target)
                {
                    target.Focus(NavigationMethod.Directional);
                    e.Handled = true;
                }
                break;
            case Key.Enter when e.KeyModifiers == KeyModifiers.None:
                switch (item.DataContext)
                {
                    case TimelineBlock block:
                        block.OpenCommand.Execute(item);
                        e.Handled = true;
                        break;
                    case AllDayBar bar:
                        bar.OpenCommand.Execute(item);
                        e.Handled = true;
                        break;
                }
                // "+{n}" and "+N more" take Enter as a click (their flyouts).
                break;
            case Key.Up or Key.Left when e.KeyModifiers == KeyModifiers.None:
            case Key.Tab when e.KeyModifiers == KeyModifiers.Shift:
                if (index > 0)
                {
                    items[index - 1].Focus(NavigationMethod.Directional);
                    items[index - 1].BringIntoView();
                    e.Handled = true;
                }
                else if (e.Key != Key.Tab)
                {
                    e.Handled = true;
                }
                break;
            case Key.Down or Key.Right when e.KeyModifiers == KeyModifiers.None:
            case Key.Tab when e.KeyModifiers == KeyModifiers.None:
                if (index >= 0 && index < items.Length - 1)
                {
                    items[index + 1].Focus(NavigationMethod.Directional);
                    items[index + 1].BringIntoView();
                    e.Handled = true;
                }
                else if (e.Key != Key.Tab)
                {
                    e.Handled = true;
                }
                break;
        }
    }

    /// <summary>The day an item belongs to: the day it was entered from when that is one of its days, else its first column's day.</summary>
    private GregorianDate? DayOfItem(Button item)
    {
        if (_model is null) return null;
        switch (item.DataContext)
        {
            case TimelineBlock block:
                return block.Day;
            case TimelineOverflow overflow:
                return overflow.Day;
            case ITimelinePlacement placement:
            {
                var columns = _model.Columns;
                if (_enteredFrom is { } entered && columns.FirstOrDefault(c => c.Date == entered) is { } c
                    && c.Column >= placement.Column && c.Column < placement.Column + placement.ColumnSpan)
                {
                    return entered;
                }
                return placement.Column < columns.Count ? columns[placement.Column].Date : null;
            }
            default:
                return null;
        }
    }

    private Control? DayControl(GregorianDate date)
    {
        if (DayTarget is { } target) return target(date);
        return DayNavigation.Cells(Headers).FirstOrDefault(c => c.DataContext is TimelineColumn col && col.Date == date);
    }

    // ---- Pointer (§2.5) ----------------------------------------------------------------------------

    private enum DragKind
    {
        Move,
        Resize,
        Create,
        Bar,
    }

    /// <summary>A press that may become a drag, and what it would drop.</summary>
    private sealed class Drag
    {
        public required DragKind Kind { get; init; }
        public required Point Start { get; init; }
        public required int Column { get; init; }
        public required GregorianDate Day { get; init; }
        public required int PressMinute { get; init; }
        public CalendarItem? Item { get; init; }
        public Control? Source { get; init; }
        public TimelineBlock? Block { get; init; }
        public AllDayBar? Bar { get; init; }
        public long Offset { get; init; }
        public bool Active { get; set; }
        public IPointer? Pointer { get; set; }

        // What a release now would do.
        public MoveTarget? Target { get; set; }
        public GregorianDate DropDate { get; set; }
        public int? DropMinute { get; set; }
        public int CreateFrom { get; set; }
        public int CreateTo { get; set; }
    }

    private static int Snap(double minute) => (int)Math.Round(minute / EventMoves.SnapMinutes, MidpointRounding.AwayFromZero) * EventMoves.SnapMinutes;

    private double MinuteAt(Point bodyPoint) => Math.Clamp(bodyPoint.Y * 60 / (_model?.HourHeight ?? Timeline.BaseHourHeight), 0, 1440);

    private int ColumnAt(double x)
    {
        var weights = _model?.ColumnWeights;
        return TimelineGeometry.ColumnAt(weights, weights?.Count ?? 1, Body.Bounds.Width, x);
    }

    private bool OverAllDay(PointerEventArgs e)
    {
        var p = e.GetPosition(AllDayArea);
        return p.X >= 0 && p.X <= AllDayArea.Bounds.Width && p.Y >= -2 && p.Y <= AllDayArea.Bounds.Height + 2;
    }

    private bool OverBody(PointerEventArgs e)
    {
        var p = e.GetPosition(Scroller);
        return p.X >= 0 && p.X <= Scroller.Bounds.Width && p.Y >= 0 && p.Y <= Scroller.Bounds.Height
            && e.GetPosition(Body).X >= 0 && e.GetPosition(Body).X <= Body.Bounds.Width;
    }

    private void OnPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (_model is null || _drag is { Active: true }) return;
        _drag = null;
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed || e.ClickCount > 1) return;
        var source = e.Source as Visual;
        var button = source?.FindAncestorOfType<Button>(includeSelf: true);
        var columns = _model.Columns;
        if (columns.Count == 0) return;
        var body = e.GetPosition(Body);
        switch (button?.DataContext)
        {
            case TimelineBlock block when Body.IsVisualAncestorOf(button):
            {
                var minute = MinuteAt(body);
                var bottom = e.GetPosition(button).Y >= button.Bounds.Height - ResizeEdge;
                var resize = bottom && block.CanResize && button.Bounds.Height > 3 * ResizeEdge;
                var press = new LocalDateTime(block.Day, Math.Min(1439, (int)minute));
                _drag = new Drag
                {
                    Kind = resize ? DragKind.Resize : DragKind.Move,
                    Start = body,
                    Column = block.Column,
                    Day = block.Day,
                    PressMinute = (int)minute,
                    Item = block.Item,
                    Source = button,
                    Block = block,
                    Offset = press.MinutesSince(block.Item.Start),
                };
                break;
            }
            case AllDayBar bar when AllDayItems.IsVisualAncestorOf(button):
            {
                var column = ColumnAt(e.GetPosition(AllDayArea).X);
                _drag = new Drag
                {
                    Kind = DragKind.Bar,
                    Start = body,
                    Column = column,
                    Day = columns[Math.Clamp(column, 0, columns.Count - 1)].Date,
                    PressMinute = 0,
                    Item = bar.Item,
                    Source = button,
                    Bar = bar,
                };
                break;
            }
            case null when source is not null && source.FindAncestorOfType<TimelineDayPanel>(includeSelf: true) is { DataContext: TimelineColumn column } panel:
            {
                // Empty time: a drag makes a draft of that range.
                _drag = new Drag
                {
                    Kind = DragKind.Create,
                    Start = body,
                    Column = column.Column,
                    Day = column.Date,
                    PressMinute = (int)MinuteAt(body),
                    Source = panel,
                };
                break;
            }
        }
    }

    private void OnPointerMoved(object? sender, PointerEventArgs e)
    {
        if (_drag is not { } drag || _model is null) return;
        var body = e.GetPosition(Body);
        if (!drag.Active)
        {
            if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            {
                _drag = null;
                return;
            }
            var delta = body - drag.Start;
            if (Math.Abs(delta.X) < DragThreshold && Math.Abs(delta.Y) < DragThreshold) return;
            drag.Active = true;
            drag.Pointer = e.Pointer;
            // The button under the press loses the pointer (no click on release); the view follows the drag.
            e.Pointer.Capture(this);
        }
        AutoScroll(e);
        Track(drag, e);
        e.Handled = true;
    }

    /// <summary>Works out what a release would do now and shows it: the ghost block on the timeline, or the target columns of the all-day row.</summary>
    private void Track(Drag drag, PointerEventArgs e)
    {
        var model = _model!;
        var columns = model.Columns;
        var body = e.GetPosition(Body);
        var column = Math.Clamp(ColumnAt(body.X), 0, columns.Count - 1);
        var date = columns[column].Date;
        var minute = MinuteAt(body);
        drag.Target = null;
        drag.DropMinute = null;
        HideGhost();
        switch (drag.Kind)
        {
            case DragKind.Create:
            {
                var from = Math.Clamp(Snap(drag.PressMinute - EventMoves.SnapMinutes / 2.0), 0, 1440 - EventMoves.SnapMinutes);
                var to = Snap(minute);
                var start = Math.Min(from, to);
                var end = Math.Max(Math.Max(from, to), start + EventMoves.SnapMinutes);
                drag.CreateFrom = start;
                drag.CreateTo = Math.Min(1440, end);
                ShowGhost(drag.Column, start, drag.CreateTo, CalendarStrings.NewEvent, CalendarStrings.TimeRange(EventStrings.Time(start), EventStrings.Time(drag.CreateTo)));
                break;
            }
            case DragKind.Resize:
            {
                var block = drag.Block!;
                var end = Math.Clamp(Snap(minute), block.StartMinute + EventMoves.SnapMinutes, 1440);
                drag.Target = MoveTarget.ToEnd(new LocalDateTime(block.Day, end));
                ShowGhost(block.Column, block.StartMinute, end, block.Title, CalendarStrings.TimeRange(EventStrings.Time(block.Item.Start.Minute), EventStrings.Time(end)));
                break;
            }
            case DragKind.Move:
            {
                var item = drag.Item!;
                if (OverAllDay(e))
                {
                    var allDayColumn = Math.Clamp(ColumnAt(e.GetPosition(AllDayArea).X), 0, columns.Count - 1);
                    drag.Target = MoveTarget.ToAllDay(columns[allDayColumn].Date, drag.Day);
                    drag.DropDate = columns[allDayColumn].Date;
                    Highlight(allDayColumn, allDayColumn);
                    break;
                }
                if (!OverBody(e)) break;
                var duration = Math.Max(EventMoves.SnapMinutes, item.End.MinutesSince(item.Start));
                var start = new LocalDateTime(date, Math.Min(1439, (int)minute)).AddMinutes(-drag.Offset);
                start = new LocalDateTime(start.Date, 0).AddMinutes(Snap(start.Minute));
                drag.Target = MoveTarget.ToTime(start);
                drag.DropDate = start.Date;
                drag.DropMinute = start.Minute;
                var top = (int)Math.Clamp(start.MinutesSince(new LocalDateTime(date, 0)), 0, 1440);
                var bottom = (int)Math.Clamp(start.MinutesSince(new LocalDateTime(date, 0)) + duration, 0, 1440);
                var end = start.AddMinutes(duration);
                ShowGhost(column, top, Math.Max(bottom, top + EventMoves.SnapMinutes), item.Title,
                    CalendarStrings.TimeRange(EventStrings.Time(start.Minute), EventStrings.Time(end.Minute)));
                break;
            }
            case DragKind.Bar:
            {
                var bar = drag.Bar!;
                var item = drag.Item!;
                if (OverAllDay(e))
                {
                    var allDayColumn = Math.Clamp(ColumnAt(e.GetPosition(AllDayArea).X), 0, columns.Count - 1);
                    var shift = allDayColumn - drag.Column;
                    drag.Target = MoveTarget.ToAllDay(columns[allDayColumn].Date, drag.Day);
                    drag.DropDate = item.FirstDay.AddDays(shift);
                    Highlight(bar.Column + shift, bar.Column + bar.ColumnSpan - 1 + shift);
                    break;
                }
                if (!OverBody(e)) break;
                // An all-day bar dropped on the timeline becomes one hour long there (§2.5).
                var start = Math.Clamp(Snap(minute), 0, 1440 - 60);
                drag.Target = MoveTarget.ToTime(new LocalDateTime(date, start));
                drag.DropDate = date;
                drag.DropMinute = start;
                ShowGhost(column, start, start + 60, item.Title, CalendarStrings.TimeRange(EventStrings.Time(start), EventStrings.Time(start + 60)));
                break;
            }
        }
    }

    private void ShowGhost(int column, int startMinute, int endMinute, string title, string time)
    {
        if (_model is null) return;
        var weights = _model.ColumnWeights;
        var edges = TimelineGeometry.Edges(weights, weights.Count, Body.Bounds.Width);
        if (column < 0 || column >= edges.Length - 1) return;
        var hour = _model.HourHeight;
        var top = startMinute * hour / 60 + 1;
        var height = Math.Max(6, (endMinute - startMinute) * hour / 60 - 2);
        Ghost.Title = title;
        Ghost.TimeText = time;
        Ghost.StartText = time;
        Ghost.Width = Math.Max(8, edges[column + 1] - edges[column] - 2 * TimelineDayPanel.Inset);
        Ghost.Height = height;
        Canvas.SetLeft(Ghost, edges[column] + TimelineDayPanel.Inset);
        Canvas.SetTop(Ghost, top);
        Ghost.IsVisible = true;
    }

    private void HideGhost()
    {
        Ghost.IsVisible = false;
        AllDayRules.HighlightFrom = -1;
        AllDayRules.HighlightTo = -1;
    }

    private void Highlight(int from, int to)
    {
        AllDayRules.HighlightFrom = Math.Max(0, from);
        AllDayRules.HighlightTo = Math.Max(0, to);
    }

    /// <summary>Near the top or bottom of the timeline the drag scrolls it.</summary>
    private void AutoScroll(PointerEventArgs e)
    {
        var x = e.GetPosition(Body).X;
        if (x < 0 || x > Body.Bounds.Width) return;
        var y = e.GetPosition(Scroller).Y;
        var height = Scroller.Bounds.Height;
        const double edge = 28;
        double step = 0;
        if (y >= 0 && y < edge) step = -16;
        else if (y <= height && y > height - edge) step = 16;
        if (step == 0) return;
        var max = Math.Max(0, Scroller.Extent.Height - Scroller.Viewport.Height);
        Scroller.Offset = new Vector(Scroller.Offset.X, Math.Clamp(Scroller.Offset.Y + step, 0, max));
    }

    private void OnPointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (_drag is not { } drag) return;
        _drag = null;
        if (!drag.Active || _model is null) return;
        e.Handled = true;
        Track(drag, e);
        HideGhost();
        drag.Pointer?.Capture(null);
        var copy = e.KeyModifiers.HasFlag(KeyModifiers.Alt);
        _ = DropAsync(drag, copy);
    }

    private void OnCaptureLost(object? sender, PointerCaptureLostEventArgs e)
    {
        if (_drag is { Active: true } && ReferenceEquals(e.Pointer, _drag.Pointer) && !ReferenceEquals(e.Pointer.Captured, this)) CancelDrag();
    }

    private void CancelDrag()
    {
        var drag = _drag;
        _drag = null;
        HideGhost();
        if (drag is { Active: true }) drag.Pointer?.Capture(null);
    }

    /// <summary>A release: a draft of the range, a copy (Alt), or a move through <see cref="EventMover"/>.</summary>
    private async Task DropAsync(Drag drag, bool copy)
    {
        if (_model is null) return;
        var mover = _model.Calendar.Mover;
        switch (drag.Kind)
        {
            case DragKind.Create:
                mover.NewFromRange(drag.Day, drag.CreateFrom, drag.CreateTo, drag.Source);
                return;
            case DragKind.Move or DragKind.Bar when copy && drag.Item is { } item:
                if (drag.Target is null) return;
                mover.Copy(item, drag.DropDate, drag.DropMinute, drag.Source);
                return;
            default:
                if (drag.Item is not { } moved || drag.Target is not { } target) return;
                await mover.MoveAsync(moved, target, drag.Source).ConfigureAwait(true);
                return;
        }
    }

    /// <summary>A double-click on empty time: New event at that half hour (§2.5); on an event: its details.</summary>
    private void OnDoubleTapped(object? sender, TappedEventArgs e)
    {
        var source = e.Source as Visual;
        var button = source?.FindAncestorOfType<Button>(includeSelf: true);
        switch (button?.DataContext)
        {
            case TimelineBlock block:
                block.OpenCommand.Execute(button);
                e.Handled = true;
                return;
            case AllDayBar bar:
                bar.OpenCommand.Execute(button);
                e.Handled = true;
                return;
            case null when source?.FindAncestorOfType<TimelineDayPanel>(includeSelf: true) is { DataContext: TimelineColumn column } panel:
                column.NewEventAt((int)MinuteAt(e.GetPosition(Body)), panel);
                e.Handled = true;
                return;
        }
    }
}
