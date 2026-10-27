using Avalonia.Controls;
using Avalonia.Threading;

namespace Thirteen.Desktop.Views.Events;

/// <summary>The Export dialog (see the XAML). Export has the focus when it opens.</summary>
public partial class ExportDialog : EventDialogWindow
{
    /// <summary>Creates the dialog.</summary>
    public ExportDialog()
    {
        InitializeComponent();
        Opened += (_, _) => Dispatcher.UIThread.Post(() => ExportButton.Focus());
    }
}
