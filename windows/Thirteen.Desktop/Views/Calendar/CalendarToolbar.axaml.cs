using System.ComponentModel;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.CalendarSection;

/// <summary>The Calendar toolbar; shows the loading indicator only when loading takes longer than 300 ms (§2.4 "States").</summary>
public partial class CalendarToolbar : UserControl
{
    /// <summary>How long loading runs before the indicator shows.</summary>
    public static readonly TimeSpan SpinnerDelay = TimeSpan.FromMilliseconds(300);

    private readonly DispatcherTimer _spinnerTimer = new() { Interval = SpinnerDelay };
    private CalendarViewModel? _model;

    /// <summary>Creates the toolbar.</summary>
    public CalendarToolbar()
    {
        InitializeComponent();
        _spinnerTimer.Tick += (_, _) =>
        {
            _spinnerTimer.Stop();
            Spinner.IsVisible = _model?.IsLoading ?? false;
        };
        DataContextChanged += (_, _) =>
        {
            if (_model is not null) _model.PropertyChanged -= OnModelChanged;
            _model = DataContext as CalendarViewModel;
            if (_model is not null) _model.PropertyChanged += OnModelChanged;
            UpdateSpinner();
        };
        DetachedFromVisualTree += (_, _) => _spinnerTimer.Stop();
        ModeList.AddHandler(KeyDownEvent, OnModeKeyDown, RoutingStrategies.Tunnel);
        ModeList.AddHandler(GotFocusEvent, (_, _) => UpdateModeTabStop(), RoutingStrategies.Bubble);
        ModeList.LayoutUpdated += (_, _) => UpdateModeTabStop();
    }

    private RadioButton[] ModeButtons() => ModeList.GetVisualDescendants().OfType<RadioButton>().ToArray();

    /// <summary>Tab enters the mode control on the mode shown.</summary>
    private void UpdateModeTabStop()
    {
        if (ModeButtons().FirstOrDefault(b => b.IsChecked == true) is { } selected
            && KeyboardNavigation.GetTabOnceActiveElement(ModeList) != selected)
        {
            KeyboardNavigation.SetTabOnceActiveElement(ModeList, selected);
        }
    }

    /// <summary>Left and Right pick the previous or next mode, and the focus goes with it.</summary>
    private void OnModeKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.KeyModifiers != KeyModifiers.None || e.Key is not (Key.Left or Key.Right)) return;
        var buttons = ModeButtons();
        var index = Array.FindIndex(buttons, b => b.IsFocused);
        var next = index + (e.Key == Key.Right ? 1 : -1);
        e.Handled = true;
        if (index < 0 || next < 0 || next >= buttons.Length) return;
        buttons[next].IsChecked = true;
        buttons[next].Focus(NavigationMethod.Directional);
        UpdateModeTabStop();
    }

    private void OnModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(CalendarViewModel.IsLoading)) UpdateSpinner();
    }

    private void UpdateSpinner()
    {
        if (_model?.IsLoading == true)
        {
            if (!Spinner.IsVisible && !_spinnerTimer.IsEnabled) _spinnerTimer.Start();
            return;
        }
        _spinnerTimer.Stop();
        Spinner.IsVisible = false;
    }
}
