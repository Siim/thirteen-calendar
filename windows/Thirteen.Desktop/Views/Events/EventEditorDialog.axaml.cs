using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels.Events;

namespace Thirteen.Desktop.Views.Events;

/// <summary>
/// The editor's window (§2.11, board I1). Every way out of it (Escape, Cancel, the close button, Alt+F4) goes through
/// <see cref="EventEditorViewModel.RequestCloseAsync"/>, which asks "Discard changes?" when the draft changed; Ctrl+Enter
/// saves (typed dates are committed first). A failed Save moves focus to the field with the problem.
/// </summary>
public partial class EventEditorDialog : EventDialogWindow
{
    private EventEditorViewModel? _model;
    private bool _closing;

    /// <summary>Creates the dialog.</summary>
    public EventEditorDialog()
    {
        InitializeComponent();
        NameTimeButton(StartTimeBox);
        NameTimeButton(EndTimeBox);
        AddHandler(KeyDownEvent, OnKeyDownTunnel, RoutingStrategies.Tunnel);
        Closing += OnClosing;
        Opened += (_, _) => Dispatcher.UIThread.Post(FocusFirst, DispatcherPriority.Loaded);
        DataContextChanged += (_, _) => Attach(DataContext as EventEditorViewModel);
    }

    /// <summary>The editor shown.</summary>
    public EventEditorViewModel? Model => _model;

    private void Attach(EventEditorViewModel? model)
    {
        if (_model is not null)
        {
            _model.CloseRequested -= OnCloseRequested;
            _model.FocusRequested -= OnFocusRequested;
            _model.PropertyChanged -= OnModelChanged;
        }
        _model = model;
        if (model is null) return;
        model.CloseRequested += OnCloseRequested;
        model.FocusRequested += OnFocusRequested;
        model.PropertyChanged += OnModelChanged;
        foreach (var field in new[] { StartDate, EndDate, EndRepeatDate }) field.LargeText = model.LargeText;
        if (model.LargeText) StackRows();
        UpdateFieldHelp();
    }

    private void OnModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is null or "" or nameof(EventEditorViewModel.StartError) or nameof(EventEditorViewModel.EndError) or nameof(EventEditorViewModel.EndRepeatError))
        {
            UpdateFieldHelp();
        }
    }

    /// <summary>
    /// §2.11 Validation: an error is attached to its field as the field's help text (Narrator reads it with the field):
    /// the Starts and Ends date fields and times, and the End repeat date.
    /// </summary>
    private void UpdateFieldHelp()
    {
        if (_model is not { } model) return;
        StartDate.ErrorText = model.StartError;
        Avalonia.Automation.AutomationProperties.SetHelpText(StartTimeBox, model.StartError);
        EndDate.ErrorText = model.EndError;
        Avalonia.Automation.AutomationProperties.SetHelpText(EndTimeBox, model.EndError);
        EndRepeatDate.ErrorText = model.EndRepeatError;
    }

    /// <summary>
    /// §2.20: a time picker takes the keyboard focus on its template's flyout button, which has no name of its own, so UI
    /// Automation (Narrator) read it by its content's type, "Avalonia.Controls.Grid" (found on Windows, task W11). The
    /// button gets the picker's name with the time ("Starts, 7:00 PM") and the picker's help text (the field's error).
    /// </summary>
    private static void NameTimeButton(TimePicker picker)
    {
        Button? button = null;
        void Update()
        {
            if (button is null) return;
            var label = Avalonia.Automation.AutomationProperties.GetName(picker);
            Avalonia.Automation.AutomationProperties.SetName(button,
                picker.SelectedTime is { } time ? $"{label}, {EventStrings.Time((int)time.TotalMinutes)}" : label);
            Avalonia.Automation.AutomationProperties.SetHelpText(button, Avalonia.Automation.AutomationProperties.GetHelpText(picker));
        }
        picker.TemplateApplied += (_, e) =>
        {
            button = e.NameScope.Find<Button>("PART_FlyoutButton");
            Update();
        };
        picker.SelectedTimeChanged += (_, _) => Update();
        picker.PropertyChanged += (_, e) =>
        {
            if (e.Property == Avalonia.Automation.AutomationProperties.NameProperty || e.Property == Avalonia.Automation.AutomationProperties.HelpTextProperty) Update();
        };
    }

    /// <summary>At 150 % text and above (§2.20): each label goes above its field, and the dialog grows to the window.</summary>
    private void StackRows()
    {
        Width = 640;
        Scroller.MaxHeight = 900;
        foreach (var row in Rows.Children.OfType<Grid>().Where(g => g.Classes.Contains("row")))
        {
            if (row.Children.Count < 2) continue;
            row.ColumnDefinitions.Clear();
            row.RowDefinitions = new RowDefinitions("Auto,Auto");
            var label = row.Children[0];
            label.Classes.Add("stacked");
            Grid.SetRow(label, 0);
            Grid.SetColumn(label, 0);
            label.Margin = new Avalonia.Thickness(0, 0, 0, 4);
            for (var i = 1; i < row.Children.Count; i++)
            {
                Grid.SetRow(row.Children[i], 1);
                Grid.SetColumn(row.Children[i], 0);
            }
        }
        InviteesLine.Margin = default;
        // §2.11 at 150 % and above: each date row stacks, the date field and the time each on its own line at full width.
        foreach (var line in new[] { StartLine, EndLine })
        {
            if (line.Parent is not Panel parent) continue;
            var index = parent.Children.IndexOf(line);
            var children = line.Children.ToList();
            line.Children.Clear();
            var stack = new StackPanel { Name = line.Name + "Stacked" };
            foreach (var child in children)
            {
                child.Margin = new Avalonia.Thickness(0, 0, 0, 4);
                child.HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Stretch;
                stack.Children.Add(child);
            }
            parent.Children.RemoveAt(index);
            parent.Children.Insert(index, stack);
        }
        foreach (var time in new[] { StartTimeBox, EndTimeBox })
        {
            time.Width = double.NaN;
            time.MaxWidth = double.PositiveInfinity;
        }
    }

    private void FocusFirst()
    {
        if (_model is null) return;
        if (_model.ShowsAllFields) TitleBox.Focus(NavigationMethod.Tab);
        else AlertBox.Focus(NavigationMethod.Tab);
    }

    private void OnFocusRequested(EditorField field)
    {
        Control? target = field switch
        {
            EditorField.Title => TitleBox,
            EditorField.Starts => StartDate,
            EditorField.Ends => EndDate,
            EditorField.EndRepeat => _model?.EndRepeatAfter == true ? EndRepeatCountBox : EndRepeatDate,
            EditorField.Calendar => CalendarBox,
            EditorField.Url => UrlBox,
            _ => null,
        };
        if (target is null) return;
        Dispatcher.UIThread.Post(() =>
        {
            target.BringIntoView();
            if (target is ThirteenDateField date) date.FocusField();
            else target.Focus(NavigationMethod.Tab);
        });
    }

    private void CommitTypedDates()
    {
        foreach (var field in new[] { StartDate, EndDate, EndRepeatDate })
        {
            if (field.DataContext is DateFieldViewModel model) model.CommitText();
        }
    }

    private void OnKeyDownTunnel(object? sender, KeyEventArgs e)
    {
        if (_model is null) return;
        if (e.Key == Key.Enter && e.KeyModifiers == KeyModifiers.Control)
        {
            e.Handled = true;
            CommitTypedDates();
            _ = _model.SaveAsync();
        }
        else if (e.Key == Key.Escape && e.KeyModifiers == KeyModifiers.None && !IsInsidePopup(e.Source))
        {
            e.Handled = true;
            _ = _model.RequestCloseAsync();
        }
    }

    /// <summary>Escape inside an open drop-down or the date picker closes that, not the editor.</summary>
    private static bool IsInsidePopup(object? source)
    {
        if (source is not Visual visual) return false;
        if (visual.FindAncestorOfType<ComboBox>(includeSelf: true) is { IsDropDownOpen: true }) return true;
        if (visual.FindAncestorOfType<TimePicker>(includeSelf: true) is not null) return false;
        return TopLevel.GetTopLevel(visual) is PopupRoot || visual.FindAncestorOfType<ThirteenDatePickerView>() is not null;
    }

    private void OnClosing(object? sender, WindowClosingEventArgs e)
    {
        if (_closing || _model is null || _model.IsClosed) return;
        // Alt+F4 and the system close button ask first, like Cancel.
        e.Cancel = true;
        _ = _model.RequestCloseAsync();
    }

    private void OnCloseRequested(object? sender, EventArgs e)
    {
        _closing = true;
        Close();
    }
}
