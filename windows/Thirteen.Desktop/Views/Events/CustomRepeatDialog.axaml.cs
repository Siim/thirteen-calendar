using System.ComponentModel;
using Avalonia.Controls;
using Avalonia.Input;
using Thirteen.Desktop.ViewModels.Events;

namespace Thirteen.Desktop.Views.Events;

/// <summary>The Custom repeat window (§2.13); the result is true when Done was pressed.</summary>
public partial class CustomRepeatDialog : EventDialogWindow
{
    /// <summary>For the XAML loader.</summary>
    public CustomRepeatDialog() => InitializeComponent();

    /// <summary>A dialog over <paramref name="model"/>.</summary>
    public CustomRepeatDialog(CustomRepeatViewModel model)
        : this()
    {
        ArgumentNullException.ThrowIfNull(model);
        DataContext = model;
        model.DoneRequested += () => Close(true);
        CancelButton.Click += (_, _) => Close(false);
        model.PropertyChanged += (_, e) => UpdateOnThe(model, e);
        UpdateOnThe(model, new PropertyChangedEventArgs(""));
        KeyDown += (_, e) =>
        {
            if (e.Key != Key.Escape) return;
            e.Handled = true;
            Close(false);
        };
    }

    private void UpdateOnThe(CustomRepeatViewModel model, PropertyChangedEventArgs e) =>
        OnTheLine.IsVisible = (model.IsMonthly && model.MonthlyOnThe) || (model.IsYearly && model.YearlyOnThe);
}
