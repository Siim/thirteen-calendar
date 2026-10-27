using Avalonia.Controls;
using Avalonia.Threading;

namespace Thirteen.Desktop.Views.Events;

/// <summary>The Import events and Restore calendars dialog (see the XAML). Import or Restore has the focus when it opens.</summary>
public partial class ImportDialog : EventDialogWindow
{
    /// <summary>Creates the dialog.</summary>
    public ImportDialog()
    {
        InitializeComponent();
        Opened += (_, _) => Dispatcher.UIThread.Post(() =>
        {
            if (SubmitButton.IsVisible) SubmitButton.Focus();
            else CancelButton.Focus();
        });
    }
}
