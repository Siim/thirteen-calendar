using Avalonia.Controls;
using Avalonia.Input;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.Events;

/// <summary>A calendar's settings (see the XAML). Escape closes it like Close, keeping the name typed.</summary>
public partial class CalendarSettingsDialog : EventDialogWindow
{
    /// <summary>Creates the dialog.</summary>
    public CalendarSettingsDialog()
    {
        InitializeComponent();
        KeyDown += (_, e) =>
        {
            if (e.Key != Key.Escape || DataContext is not CalendarSettingsViewModel model) return;
            model.CloseCommand.Execute(null);
            e.Handled = true;
        };
    }
}
