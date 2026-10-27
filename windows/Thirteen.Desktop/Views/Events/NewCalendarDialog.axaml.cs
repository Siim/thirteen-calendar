using Avalonia.Controls;
using Avalonia.Threading;

namespace Thirteen.Desktop.Views.Events;

/// <summary>The New calendar dialog (see the XAML).</summary>
public partial class NewCalendarDialog : EventDialogWindow
{
    /// <summary>Creates the dialog.</summary>
    public NewCalendarDialog()
    {
        InitializeComponent();
        Opened += (_, _) => Dispatcher.UIThread.Post(() => NameBox.Focus());
    }
}
