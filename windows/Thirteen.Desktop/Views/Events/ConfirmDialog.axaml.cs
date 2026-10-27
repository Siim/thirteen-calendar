using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Threading;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.Views.Events;

/// <summary>A question with "Cancel" and an action; the result is true when the action was chosen.</summary>
public partial class ConfirmDialog : Window
{
    /// <summary>For the XAML loader.</summary>
    public ConfirmDialog()
        : this("", EventStrings.Close)
    {
    }

    /// <summary>Asks <paramref name="message"/>; <paramref name="action"/> is the button that goes ahead ("Unsubscribe", "Delete calendar").</summary>
    public ConfirmDialog(string message, string action)
    {
        InitializeComponent();
        // No heading in its content, so the title bar keeps the title (nothing is shown twice).
        Title = action;
        Message.Text = message;
        CancelButton.Content = EventStrings.Cancel;
        AutomationProperties.SetName(CancelButton, EventStrings.Cancel);
        ActionButton.Content = action;
        AutomationProperties.SetName(ActionButton, action);
        CancelButton.Click += (_, _) => Close(false);
        ActionButton.Click += (_, _) => Close(true);
        // Cancel has the focus, so Enter never deletes by accident.
        Opened += (_, _) => Dispatcher.UIThread.Post(() => CancelButton.Focus());
    }
}
