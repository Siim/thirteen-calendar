using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Thirteen.Desktop.ViewModels.Events;

namespace Thirteen.Desktop.Views.Events;

/// <summary>
/// The 13-month date picker's view (§2.12): the keyboard of the grid (Left and Right by day through intercalary days, Up
/// and Down by row, Page Up and Page Down by month, with Shift by year, Home and End, Enter selects, Escape closes), the
/// year stepper's Up and Down, and the list of days at 150 % text.
/// </summary>
public partial class ThirteenDatePickerView : UserControl
{
    private ThirteenDatePickerViewModel? _model;

    /// <summary>Creates the view.</summary>
    public ThirteenDatePickerView()
    {
        InitializeComponent();
        Days.AddHandler(KeyDownEvent, OnDaysKeyDown, RoutingStrategies.Tunnel);
        DayList.AddHandler(KeyDownEvent, OnDayListKeyDown, RoutingStrategies.Tunnel);
        YearStepper.AddHandler(KeyDownEvent, OnYearKeyDown, RoutingStrategies.Tunnel);
        YearStepper.ValueRequested += year => _model?.SetYearValue((int)year);
        Badge.AddHandler(KeyDownEvent, OnDaysKeyDown, RoutingStrategies.Tunnel);
        AddHandler(KeyDownEvent, OnKeyDown, RoutingStrategies.Bubble);
        DataContextChanged += (_, _) => Attach(DataContext as ThirteenDatePickerViewModel);
    }

    private bool _usesList;

    /// <summary>The list of days instead of the grid (150 % text and above, §2.12).</summary>
    public bool UsesList
    {
        get => _usesList;
        set
        {
            _usesList = value;
            UpdateGridVisibility();
        }
    }

    private void Attach(ThirteenDatePickerViewModel? model)
    {
        if (_model is not null) _model.PropertyChanged -= OnModelChanged;
        _model = model;
        if (model is not null) model.PropertyChanged += OnModelChanged;
        UpdateGridVisibility();
    }

    private void OnModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(ThirteenDatePickerViewModel.ShowsGrid) or nameof(ThirteenDatePickerViewModel.IsIntercalary) or "") UpdateGridVisibility();
    }

    private void UpdateGridVisibility()
    {
        var showsGrid = _model?.ShowsGrid ?? true;
        GridPanel.IsVisible = showsGrid && !_usesList;
        DayList.IsVisible = showsGrid && _usesList;
    }

    /// <summary>Focus goes to the selected day (the grid, the list, or the badge of an intercalary day).</summary>
    public void FocusSelection()
    {
        Dispatcher.UIThread.Post(() =>
        {
            if (_model is null) return;
            if (_model.IsGregorianTab)
            {
                GregorianCalendar.Focus(NavigationMethod.Tab);
                return;
            }
            if (_model.IsIntercalary)
            {
                Badge.Focus(NavigationMethod.Tab);
                return;
            }
            var list = _usesList ? DayList : Days;
            if (_model.SelectedDay is { } day && list.ContainerFromItem(day) is Control container) container.Focus(NavigationMethod.Directional);
            else list.Focus(NavigationMethod.Tab);
        }, DispatcherPriority.Loaded);
    }

    private void OnDaysKeyDown(object? sender, KeyEventArgs e)
    {
        if (_model is null) return;
        var shift = e.KeyModifiers.HasFlag(KeyModifiers.Shift);
        switch (e.Key)
        {
            case Key.Left:
                _model.MoveDays(-1);
                break;
            case Key.Right:
                _model.MoveDays(1);
                break;
            case Key.Up:
                _model.MoveRows(-1);
                break;
            case Key.Down:
                _model.MoveRows(1);
                break;
            case Key.PageUp when shift:
                _model.StepYear(-1);
                break;
            case Key.PageDown when shift:
                _model.StepYear(1);
                break;
            case Key.PageUp:
                _model.MoveMonths(-1);
                break;
            case Key.PageDown:
                _model.MoveMonths(1);
                break;
            case Key.Home:
                _model.MoveToMonthEdge(end: false);
                break;
            case Key.End:
                _model.MoveToMonthEdge(end: true);
                break;
            case Key.Enter or Key.Space:
                _model.Done();
                break;
            default:
                return;
        }
        e.Handled = true;
        FocusSelection();
    }

    /// <summary>The list at 150 %: Up and Down by one day, Page Up and Page Down by month.</summary>
    private void OnDayListKeyDown(object? sender, KeyEventArgs e)
    {
        if (_model is null) return;
        switch (e.Key)
        {
            case Key.Up:
                _model.MoveDays(-1);
                break;
            case Key.Down:
                _model.MoveDays(1);
                break;
            case Key.PageUp:
                _model.MoveMonths(-1);
                break;
            case Key.PageDown:
                _model.MoveMonths(1);
                break;
            case Key.Enter or Key.Space:
                _model.Done();
                break;
            default:
                return;
        }
        e.Handled = true;
        FocusSelection();
    }

    private void OnYearKeyDown(object? sender, KeyEventArgs e)
    {
        if (_model is null) return;
        switch (e.Key)
        {
            case Key.Up or Key.Right or Key.PageUp:
                _model.StepYear(1);
                break;
            case Key.Down or Key.Left or Key.PageDown:
                _model.StepYear(-1);
                break;
            default:
                return;
        }
        e.Handled = true;
    }

    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Handled || _model is null || e.Key != Key.Escape) return;
        e.Handled = true;
        _model.Cancel();
    }

    /// <inheritdoc />
    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (_model is { } model) GregorianCalendar.DisplayDate = model.GregorianSelection ?? DateTime.Today;
        FocusSelection();
    }
}
