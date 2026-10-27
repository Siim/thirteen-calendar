using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Threading;

namespace Thirteen.Desktop.Views.Events;

/// <summary>An event's details (§2.10), shown in a flyout anchored to the item, or in a dialog at 150 % text and above.</summary>
public partial class EventDetailsView : UserControl
{
    /// <summary>Creates the view.</summary>
    public EventDetailsView() => InitializeComponent();

    /// <summary>Focus goes to the first action (Edit, Edit alerts, or More for read-only events).</summary>
    public void FocusFirstAction() => Dispatcher.UIThread.Post(() =>
    {
        Control target = EditButton.IsVisible ? EditButton : EditAlertsButton.IsVisible ? EditAlertsButton : MoreButton;
        target.Focus(NavigationMethod.Tab);
    }, DispatcherPriority.Loaded);
}
