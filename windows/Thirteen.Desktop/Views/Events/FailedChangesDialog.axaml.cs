using Avalonia.Controls;
using Thirteen.Desktop.ViewModels.Events;

namespace Thirteen.Desktop.Views.Events;

/// <summary>The list "Changes that couldn't be saved" (§2.11).</summary>
public partial class FailedChangesDialog : EventDialogWindow
{
    /// <summary>For the XAML loader.</summary>
    public FailedChangesDialog() => InitializeComponent();

    /// <summary>The list of <paramref name="model"/>.</summary>
    public FailedChangesDialog(FailedChangesViewModel model)
        : this()
    {
        ArgumentNullException.ThrowIfNull(model);
        DataContext = model;
        CloseButton.Click += (_, _) => Close();
        model.CloseRequested += (_, _) => Close();
    }
}
