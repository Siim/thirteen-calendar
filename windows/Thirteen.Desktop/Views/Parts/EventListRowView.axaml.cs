using Avalonia;
using Avalonia.Controls;

namespace Thirteen.Desktop.Views.Parts;

/// <summary>An Up next or day-details row (see the XAML); <see cref="TimeWidth"/> sizes its time column for "12:30 PM".</summary>
public partial class EventListRowView : UserControl
{
    /// <summary>The width of the time column.</summary>
    public static readonly StyledProperty<double> TimeWidthProperty = AvaloniaProperty.Register<EventListRowView, double>(nameof(TimeWidth), 72);

    /// <summary>Creates the view.</summary>
    public EventListRowView() => InitializeComponent();

    /// <inheritdoc cref="TimeWidthProperty"/>
    public double TimeWidth { get => GetValue(TimeWidthProperty); set => SetValue(TimeWidthProperty, value); }

    /// <inheritdoc />
    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == TimeWidthProperty) Columns.ColumnDefinitions[0].Width = new GridLength(TimeWidth);
    }
}
