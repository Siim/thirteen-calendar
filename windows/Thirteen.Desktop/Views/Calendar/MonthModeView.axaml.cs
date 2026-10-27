using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Core;
using Thirteen.Desktop.Controls;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.CalendarSection;

/// <summary>
/// Calendar's Month mode: sizes the rows to the window and tells the model how many lanes fit (§2.4), and carries the
/// keyboard of §2.21 (Enter or F2 into the focused day's events, arrows and Tab among them, Enter opens one, Esc back
/// to the day), double-click for a new event, and the focus after paging ("focus stays on the same grid position").
/// <para>
/// Dragging a chip or bar to another day moves it (§2.4, task W6; a multi-day bar keeps the offset of the day it was
/// picked up on), Alt-drag duplicates it there as an unsaved draft; the drop goes to <see cref="CalendarViewModel.Mover"/>.
/// </para>
/// </summary>
public partial class MonthModeView : UserControl
{
    private MonthModeViewModel? _model;
    private int? _focusAfterPaging;

    /// <summary>Creates the view.</summary>
    public MonthModeView()
    {
        InitializeComponent();
        GridScroller.SizeChanged += (_, _) => UpdateGeometry();
        Days.AddHandler(KeyDownEvent, OnGridKeyDown, RoutingStrategies.Tunnel);
        Days.AddHandler(DoubleTappedEvent, OnGridDoubleTapped, RoutingStrategies.Bubble);
        Days.AddHandler(PointerPressedEvent, OnChipPressed, RoutingStrategies.Tunnel);
        Days.AddHandler(PointerMovedEvent, OnChipMoved, RoutingStrategies.Tunnel);
        Days.AddHandler(PointerReleasedEvent, OnChipReleased, RoutingStrategies.Tunnel);
        Days.AddHandler(PointerCaptureLostEvent, OnChipCaptureLost, RoutingStrategies.Bubble | RoutingStrategies.Direct);
        AddHandler(KeyDownEvent, OnDragKeyDown, RoutingStrategies.Tunnel);
        DataContextChanged += (_, _) =>
        {
            if (_model is not null)
            {
                _model.PropertyChanged -= OnModelChanged;
                _model.Calendar.Paging -= OnPaging;
                _model.Calendar.Paged -= OnPaged;
            }
            _model = DataContext as MonthModeViewModel;
            if (_model is not null)
            {
                _model.PropertyChanged += OnModelChanged;
                _model.Calendar.Paging += OnPaging;
                _model.Calendar.Paged += OnPaged;
                _model.Calendar.Mover.Ask ??= MoveSpanDialog.AskOver(this);
            }
            UpdateGeometry();
        };
    }

    private void OnModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(MonthModeViewModel.LaneHeight) or nameof(MonthModeViewModel.DayHeaderHeight) or nameof(MonthModeViewModel.HasBands))
        {
            UpdateGeometry();
        }
    }

    /// <summary>The rows share the height left by the bands; the lanes that fit follow (at least two lanes, else the rows scroll).</summary>
    private void UpdateGeometry()
    {
        if (_model is null) return;
        var height = GridScroller.Bounds.Height;
        if (height <= 0) return;
        var bands = _model.HasBands ? _model.Bands.Count * _model.BandHeight : 0;
        var row = Math.Max(_model.MinRowHeight, Math.Floor((height - bands - 1) / 4));
        _model.SetGeometry(row, _model.LanesFor(row));
    }

    /// <summary>Before paging: the grid position of the focused day (a chip counts as its day).</summary>
    private void OnPaging(object? sender, EventArgs e)
    {
        _focusAfterPaging = null;
        if (!IsEffectivelyVisible || TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement() is not Visual focused || !Days.IsVisualAncestorOf(focused)) return;
        var button = focused.FindAncestorOfType<Button>(includeSelf: true);
        _focusAfterPaging = button?.DataContext switch
        {
            MonthDayCell cell => cell.NavIndex,
            MonthChip or MonthMore when _lastCell?.DataContext is MonthDayCell last => last.NavIndex,
            _ => null,
        };
    }

    /// <summary>After paging: the same grid position in the new month (§2.1 "focus stays on the same grid position").</summary>
    private void OnPaged(object? sender, EventArgs e)
    {
        if (_focusAfterPaging is not { } index) return;
        _focusAfterPaging = null;
        Dispatcher.UIThread.Post(() => DayNavigation.Focus(Days, dc => dc is MonthDayCell cell && cell.NavIndex == index), DispatcherPriority.Loaded);
    }

    // ---- Keyboard (§2.21) ----------------------------------------------------------------------------

    private void OnGridKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Source is not Visual source) return;
        var button = source.FindAncestorOfType<Button>(includeSelf: true);
        switch (button?.DataContext)
        {
            case MonthDayCell or MonthBand when e.KeyModifiers == KeyModifiers.None && e.Key is Key.Enter or Key.F2:
                // Into the day's events; a day without events takes Enter as a click (select).
                if (ItemsOf(button!).FirstOrDefault() is { } first)
                {
                    first.Focus(NavigationMethod.Directional);
                    e.Handled = true;
                }
                break;
            case MonthChip or MonthMore:
                OnItemKeyDown(button!, e);
                break;
        }
    }

    private void OnItemKeyDown(Button item, KeyEventArgs e)
    {
        var day = DayButtonOf(item);
        var items = day is null ? [item] : ItemsOf(day);
        var index = Array.IndexOf(items, item);
        switch (e.Key)
        {
            case Key.Escape:
                day?.Focus(NavigationMethod.Directional);
                e.Handled = day is not null;
                break;
            case Key.Enter when e.KeyModifiers == KeyModifiers.None:
                if (item.DataContext is MonthChip chip)
                {
                    chip.OpenCommand.Execute(item);
                    e.Handled = true;
                }
                // "+N more" takes Enter as a click (its flyout).
                break;
            case Key.Up or Key.Left when e.KeyModifiers == KeyModifiers.None:
            case Key.Tab when e.KeyModifiers == KeyModifiers.Shift:
                if (index > 0)
                {
                    items[index - 1].Focus(NavigationMethod.Directional);
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
                    e.Handled = true;
                }
                else if (e.Key != Key.Tab)
                {
                    e.Handled = true;
                }
                break;
        }
    }

    /// <summary>The chips and "+N more" of a day cell or band, top to bottom.</summary>
    private Button[] ItemsOf(Button day)
    {
        var buttons = Days.GetVisualDescendants().OfType<Button>().Where(b => b.IsEffectivelyVisible).ToArray();
        switch (day.DataContext)
        {
            case MonthDayCell cell:
            {
                var row = day.FindAncestorOfType<MonthWeekPanel>();
                return buttons
                    .Where(b => b.FindAncestorOfType<MonthWeekPanel>() == row && b.DataContext is (MonthChip or MonthMore) and IMonthPlacement p
                        && p.Column <= cell.Column && cell.Column < p.Column + p.ColumnSpan)
                    .OrderBy(b => ((IMonthPlacement)b.DataContext!).Lane)
                    .ToArray();
            }
            case MonthBand band:
                return buttons.Where(b => b.DataContext is MonthChip chip && band.Chips.Contains(chip)
                        || b.DataContext is MonthMore more && more == band.More)
                    .ToArray();
            default:
                return [];
        }
    }

    /// <summary>The day an item was entered from: the cell of its first column in its row, or its band.</summary>
    private Button? DayButtonOf(Button item)
    {
        var buttons = Days.GetVisualDescendants().OfType<Button>().ToArray();
        if (item.FindAncestorOfType<MonthWeekPanel>() is { } row && item.DataContext is IMonthPlacement placement)
        {
            var focusedColumn = _lastCell is { } last && last.FindAncestorOfType<MonthWeekPanel>() == row && last.DataContext is MonthDayCell lc
                && lc.Column >= placement.Column && lc.Column < placement.Column + placement.ColumnSpan
                ? lc.Column
                : placement.Column;
            return buttons.FirstOrDefault(b => b.FindAncestorOfType<MonthWeekPanel>() == row && b.DataContext is MonthDayCell c && c.Column == focusedColumn);
        }
        return buttons.FirstOrDefault(b => b.DataContext is MonthBand band
            && (item.DataContext is MonthChip chip && band.Chips.Contains(chip) || item.DataContext is MonthMore more && more == band.More));
    }

    private Button? _lastCell;

    /// <inheritdoc />
    protected override void OnGotFocus(GotFocusEventArgs e)
    {
        base.OnGotFocus(e);
        if ((e.Source as Visual)?.FindAncestorOfType<Button>(includeSelf: true) is { DataContext: MonthDayCell or MonthBand } cell) _lastCell = cell;
    }

    // ---- Pointer ------------------------------------------------------------------------------------

    private void OnGridDoubleTapped(object? sender, TappedEventArgs e)
    {
        var button = (e.Source as Visual)?.FindAncestorOfType<Button>(includeSelf: true);
        switch (button?.DataContext)
        {
            case MonthDayCell cell:
                cell.NewEventCommand.Execute(button);
                e.Handled = true;
                break;
            case MonthBand band:
                band.NewEventCommand.Execute(button);
                e.Handled = true;
                break;
            case MonthChip chip:
                chip.OpenCommand.Execute(button);
                e.Handled = true;
                break;
        }
    }

    // ---- Drag (§2.4, task W6) -------------------------------------------------------------------------

    private sealed class ChipDrag
    {
        public required Button Source { get; init; }
        public required MonthChip Chip { get; init; }
        public required GregorianDate From { get; init; }
        public required Point Start { get; init; }
        public bool Active { get; set; }
        public IPointer? Pointer { get; set; }
        public Button? Over { get; set; }
    }

    private ChipDrag? _chipDrag;

    /// <summary>The day cell or band under the pointer.</summary>
    private Button? CellAt(PointerEventArgs e) => Days.GetVisualDescendants().OfType<Button>()
        .Where(b => b.DataContext is MonthDayCell or MonthBand && b.IsEffectivelyVisible)
        .FirstOrDefault(b =>
        {
            var p = e.GetPosition(b);
            return p.X >= 0 && p.Y >= 0 && p.X < b.Bounds.Width && p.Y < b.Bounds.Height;
        });

    private static GregorianDate? DateOf(Button? cell) => cell?.DataContext switch
    {
        MonthDayCell c => c.Date,
        MonthBand b => b.Date,
        _ => null,
    };

    private void OnChipPressed(object? sender, PointerPressedEventArgs e)
    {
        _chipDrag = null;
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed || e.ClickCount > 1) return;
        var button = (e.Source as Visual)?.FindAncestorOfType<Button>(includeSelf: true);
        if (button?.DataContext is not MonthChip chip) return;
        // The day the chip was picked up on: a multi-day bar keeps its offset from it.
        if (DateOf(CellAt(e)) is not { } from) return;
        _chipDrag = new ChipDrag { Source = button, Chip = chip, From = from, Start = e.GetPosition(Days) };
    }

    private void OnChipMoved(object? sender, PointerEventArgs e)
    {
        if (_chipDrag is not { } drag) return;
        if (!drag.Active)
        {
            if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            {
                _chipDrag = null;
                return;
            }
            var delta = e.GetPosition(Days) - drag.Start;
            if (Math.Abs(delta.X) < TimelineView.DragThreshold && Math.Abs(delta.Y) < TimelineView.DragThreshold) return;
            drag.Active = true;
            drag.Pointer = e.Pointer;
            e.Pointer.Capture(Days);
        }
        var over = CellAt(e);
        if (!ReferenceEquals(over, drag.Over))
        {
            drag.Over?.Classes.Set("dropTarget", false);
            over?.Classes.Set("dropTarget", true);
            drag.Over = over;
        }
        e.Handled = true;
    }

    private void OnChipReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (_chipDrag is not { } drag) return;
        _chipDrag = null;
        if (!drag.Active) return;
        e.Handled = true;
        drag.Over?.Classes.Set("dropTarget", false);
        drag.Pointer?.Capture(null);
        if (_model is null || DateOf(CellAt(e)) is not { } date) return;
        var mover = _model.Calendar.Mover;
        var item = drag.Chip.Item;
        if (e.KeyModifiers.HasFlag(KeyModifiers.Alt))
        {
            // Alt-drag: Duplicate there, an unsaved draft at the event's own time (§2.4).
            mover.Copy(item, item.Start.Date.AddDays(date.JulianDayNumber - drag.From.JulianDayNumber), null, drag.Source);
            return;
        }
        if (date == drag.From) return;
        _ = mover.MoveAsync(item, MoveTarget.ToDay(date, drag.From), drag.Source);
    }

    private void OnChipCaptureLost(object? sender, PointerCaptureLostEventArgs e)
    {
        if (_chipDrag is { Active: true } drag && ReferenceEquals(e.Pointer, drag.Pointer) && !ReferenceEquals(e.Pointer.Captured, Days)) CancelChipDrag();
    }

    private void OnDragKeyDown(object? sender, KeyEventArgs e)
    {
        if (_chipDrag is not { Active: true } || e.Key != Key.Escape) return;
        CancelChipDrag();
        e.Handled = true;
    }

    private void CancelChipDrag()
    {
        var drag = _chipDrag;
        _chipDrag = null;
        if (drag is null) return;
        drag.Over?.Classes.Set("dropTarget", false);
        if (drag.Active) drag.Pointer?.Capture(null);
    }
}
