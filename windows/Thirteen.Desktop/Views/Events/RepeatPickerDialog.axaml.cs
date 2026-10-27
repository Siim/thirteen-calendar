using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.ViewModels.Events;

namespace Thirteen.Desktop.Views.Events;

/// <summary>The repeat picker's window (§2.13); the result is true when a row was chosen (Custom closes it with false).</summary>
public partial class RepeatPickerDialog : EventDialogWindow
{
    /// <summary>For the XAML loader.</summary>
    public RepeatPickerDialog() => InitializeComponent();

    /// <summary>A picker over <paramref name="model"/>.</summary>
    public RepeatPickerDialog(RepeatPickerViewModel model)
        : this()
    {
        ArgumentNullException.ThrowIfNull(model);
        DataContext = model;
        model.Chosen += _ => Close(true);
        model.CustomRequested += () => Close(false);
        KeyDown += (_, e) =>
        {
            if (e.Key != Key.Escape) return;
            e.Handled = true;
            Close(false);
        };
        // Focus starts on the checked row.
        Opened += (_, _) => Dispatcher.UIThread.Post(() =>
        {
            var rows = this.GetVisualDescendants().OfType<Button>().Where(b => b.DataContext is RepeatRowViewModel).ToList();
            (rows.FirstOrDefault(b => b.DataContext is RepeatRowViewModel { IsSelected: true }) ?? rows.FirstOrDefault())?.Focus(NavigationMethod.Tab);
        }, DispatcherPriority.Loaded);
    }
}
