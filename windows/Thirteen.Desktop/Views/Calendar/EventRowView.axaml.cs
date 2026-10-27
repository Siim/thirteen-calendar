using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.CalendarSection;

/// <summary>An event row: a click selects it, a double-click or Enter opens its details (§2.21 "Open focused event").</summary>
public partial class EventRowView : UserControl
{
    /// <summary>The width of the time column (List sizes it for "12:30 PM" at the current text size).</summary>
    public static readonly StyledProperty<double> TimeWidthProperty = AvaloniaProperty.Register<EventRowView, double>(nameof(TimeWidth), 72);

    /// <summary>The second line (location, "until 10:30", "Day 2 of 3"); Month's list of days shows one "time title" line (§2.4, board J3).</summary>
    public static readonly StyledProperty<bool> ShowsSubTextProperty = AvaloniaProperty.Register<EventRowView, bool>(nameof(ShowsSubText), true);

    /// <inheritdoc cref="ShowsSubTextProperty"/>
    public bool ShowsSubText { get => GetValue(ShowsSubTextProperty); set => SetValue(ShowsSubTextProperty, value); }

    /// <summary>Creates the view.</summary>
    public EventRowView()
    {
        InitializeComponent();
        Row.DoubleTapped += (_, e) =>
        {
            Open();
            e.Handled = true;
        };
        // Tunnel: the Button turns Enter into a click (select) before a bubbling handler would see it.
        Row.AddHandler(KeyDownEvent, (_, e) =>
        {
            if (e.Key != Key.Enter || e.KeyModifiers != KeyModifiers.None) return;
            Open();
            e.Handled = true;
        }, RoutingStrategies.Tunnel);
    }

    /// <inheritdoc cref="TimeWidthProperty"/>
    public double TimeWidth { get => GetValue(TimeWidthProperty); set => SetValue(TimeWidthProperty, value); }

    /// <inheritdoc />
    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == TimeWidthProperty) Columns.ColumnDefinitions[0].Width = new GridLength(TimeWidth);
        if (change.Property == ShowsSubTextProperty) SubLine.IsVisible = ShowsSubText;
    }

    private void Open()
    {
        if (DataContext is CalendarRow row && row.OpenCommand.CanExecute(Row)) row.OpenCommand.Execute(Row);
    }
}
