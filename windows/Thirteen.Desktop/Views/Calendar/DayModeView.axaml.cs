using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Thirteen.Desktop.Controls;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.CalendarSection;

/// <summary>
/// Calendar's Day mode: the header strip is the day's focus stop (arrows between days, Enter or F2 on the shown day into
/// its events, Esc from an event back to the strip, §2.21); the timeline does the rest (Views/Calendar/TimelineView).
/// </summary>
public partial class DayModeView : UserControl
{
    /// <summary>Creates the view.</summary>
    public DayModeView()
    {
        InitializeComponent();
        Timeline.DayTarget = date => DayNavigation.Cells(Strip).FirstOrDefault(c => c.DataContext is DayStripItem item && item.Date == date);
        Strip.AddHandler(KeyDownEvent, OnStripKeyDown, RoutingStrategies.Tunnel);
    }

    private void OnStripKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.KeyModifiers != KeyModifiers.None || e.Key is not (Key.Enter or Key.F2)) return;
        var button = (e.Source as Visual)?.FindAncestorOfType<Button>(includeSelf: true);
        if (button?.DataContext is DayStripItem item && DataContext is DayModeViewModel model && item.Date == model.Day && Timeline.FocusFirstItem(item.Date))
        {
            e.Handled = true;
        }
    }
}
