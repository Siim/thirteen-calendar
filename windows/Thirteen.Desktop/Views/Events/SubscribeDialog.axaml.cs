using Avalonia.Controls;
using Avalonia.Threading;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.Events;

/// <summary>The Subscribe dialog (see the XAML). The link field has the focus; once the link is read, the name field.</summary>
public partial class SubscribeDialog : EventDialogWindow
{
    /// <summary>Creates the dialog.</summary>
    public SubscribeDialog()
    {
        InitializeComponent();
        Opened += (_, _) => Dispatcher.UIThread.Post(() => LinkBox.Focus());
        Closing += (_, _) => (DataContext as SubscribeDialogViewModel)?.CancelChecking();
        DataContextChanged += (_, _) =>
        {
            if (DataContext is SubscribeDialogViewModel model)
            {
                model.PropertyChanged += (_, e) =>
                {
                    if (e.PropertyName == nameof(SubscribeDialogViewModel.IsFound) && model.IsFound) Dispatcher.UIThread.Post(() => NameBox.Focus());
                };
            }
        };
    }
}
