using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Thirteen.Desktop.ViewModels.Events;

namespace Thirteen.Desktop.Views.Events;

/// <summary>
/// The 13-month date field's view (§2.12): typed text is committed on Enter and when focus leaves; the picker opens
/// as a flyout under the field, or as a full-size dialog at 150 % text and above (§2.20).
/// </summary>
public partial class ThirteenDateField : UserControl
{
    private DateFieldViewModel? _model;
    private Flyout? _flyout;

    /// <summary>Creates the field.</summary>
    public ThirteenDateField()
    {
        InitializeComponent();
        Box.LostFocus += (_, _) => _model?.CommitText();
        Box.AddHandler(KeyDownEvent, OnBoxKeyDown, RoutingStrategies.Tunnel);
        DataContextChanged += (_, _) => Attach(DataContext as DateFieldViewModel);
    }

    /// <summary>The picker opens as a dialog with the list of days (150 % text and above).</summary>
    public bool LargeText { get; set; }

    /// <summary>The picker open now, or null (tests).</summary>
    public ThirteenDatePickerViewModel? OpenPicker { get; private set; }

    /// <summary>Focuses the field's text.</summary>
    public void FocusField() => Box.Focus(NavigationMethod.Tab);

    private string? _errorText;

    /// <summary>
    /// The error of the row the field is in (the editor's end before start, out of range, until before start), attached
    /// to the field as its help text so Narrator reads it with the field (§2.11 Validation); the field's own refused typed
    /// date is used while there is none.
    /// </summary>
    public string? ErrorText
    {
        get => _errorText;
        set
        {
            _errorText = value;
            UpdateHelp();
        }
    }

    /// <summary>The field's text box (tests).</summary>
    public TextBox TextBox => Box;

    private void UpdateHelp() => Avalonia.Automation.AutomationProperties.SetHelpText(Box, _errorText ?? _model?.Error);

    private void Attach(DateFieldViewModel? model)
    {
        if (_model is not null)
        {
            _model.PickerRequested -= OnPickerRequested;
            _model.PropertyChanged -= OnModelChanged;
        }
        _model = model;
        if (model is not null)
        {
            model.PickerRequested += OnPickerRequested;
            model.PropertyChanged += OnModelChanged;
        }
        UpdateHelp();
    }

    private void OnModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(DateFieldViewModel.Error) or "" or null) UpdateHelp();
    }

    private void OnBoxKeyDown(object? sender, KeyEventArgs e)
    {
        if (_model is null) return;
        if (e.Key == Key.Enter && e.KeyModifiers == KeyModifiers.None)
        {
            // Enter commits what was typed; Ctrl+Enter goes on to the editor (it saves).
            _model.CommitText();
            e.Handled = true;
        }
        else if ((e.Key == Key.Down && e.KeyModifiers == KeyModifiers.Alt) || (e.Key == Key.F4 && e.KeyModifiers == KeyModifiers.None))
        {
            _model.CommitText();
            _model.OpenPickerCommand.Execute(null);
            e.Handled = true;
        }
    }

    private void OnPickerRequested(object? sender, ThirteenDatePickerViewModel picker)
    {
        _model?.CommitText();
        OpenPicker = picker;
        if (LargeText && TopLevel.GetTopLevel(this) is Window owner)
        {
            _ = ShowDialogAsync(owner, picker);
            return;
        }
        var view = new ThirteenDatePickerView { DataContext = picker };
        _flyout = new Flyout
        {
            Content = view,
            Placement = PlacementMode.BottomEdgeAlignedLeft,
            ShowMode = FlyoutShowMode.Standard,
        };
        picker.CloseRequested += (_, _) => _flyout?.Hide();
        _flyout.Closed += (_, _) =>
        {
            OpenPicker = null;
            _flyout = null;
            Dispatcher.UIThread.Post(() => Box.Focus(NavigationMethod.Tab));
        };
        _flyout.ShowAt(Box);
    }

    private async Task ShowDialogAsync(Window owner, ThirteenDatePickerViewModel picker)
    {
        var view = new ThirteenDatePickerView { DataContext = picker, UsesList = true, Width = double.NaN };
        var dialog = new Window
        {
            Classes = { "eventDialog" },
            Title = picker.Field.Label,
            Width = 520,
            Content = new Border { Padding = new Avalonia.Thickness(24, 20), Child = view },
        };
        picker.CloseRequested += (_, _) => dialog.Close();
        await dialog.ShowDialog(owner);
        OpenPicker = null;
        Box.Focus(NavigationMethod.Tab);
    }
}
