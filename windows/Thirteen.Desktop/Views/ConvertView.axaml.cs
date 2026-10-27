using System.ComponentModel;
using Avalonia.Automation;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views;

/// <summary>
/// The Convert screen (see the XAML). Keeps the calendar's keyboard focus on its picked day: Avalonia's
/// Calendar moves the selection with the arrow keys but leaves the focus (and its ring) on the day button
/// Tab first reached, and every day button would otherwise be a tab stop of its own. Also keeps the keyboard
/// focus when a new day rebuilds the page's content (see <see cref="OnModelChanging"/>).
/// </summary>
public partial class ConvertView : UserControl
{
    private ConvertViewModel? _model;

    // Where the keyboard focus was in the content about to be replaced: its spoken name, its position among
    // the page's focusable controls, and whether it showed a focus ring.
    private string? _focusName;
    private int _focusIndex = -1;
    private bool _focusVisible;
    /// <summary>Creates the view.</summary>
    public ConvertView()
    {
        InitializeComponent();
        Picker.SelectedDatesChanged += (_, _) =>
        {
            if (Picker.IsKeyboardFocusWithin) Dispatcher.UIThread.Post(() => FocusPickedDay(NavigationMethod.Directional), DispatcherPriority.Loaded);
            else Dispatcher.UIThread.Post(UpdateTabStop, DispatcherPriority.Loaded);
        };
        Picker.AddHandler(GotFocusEvent, OnPickerGotFocus, RoutingStrategies.Bubble);
        Picker.AttachedToVisualTree += (_, _) => Dispatcher.UIThread.Post(UpdateTabStop, DispatcherPriority.Loaded);
        // The focus lands on the text boxes inside these controls; give them the controls' names.
        NameParts(TypedDate);
        NameParts(YearBox);
        // A cleared year box shows the day's year again rather than staying empty.
        YearBox.ValueChanged += (_, e) =>
        {
            if (e.NewValue is null) Dispatcher.UIThread.Post(RestoreYear, DispatcherPriority.Background);
        };
        DataContextChanged += (_, _) =>
        {
            if (_model is not null)
            {
                _model.PropertyChanging -= OnModelChanging;
                _model.PropertyChanged -= OnModelChanged;
            }
            _model = DataContext as ConvertViewModel;
            if (_model is not null)
            {
                _model.PropertyChanging += OnModelChanging;
                _model.PropertyChanged += OnModelChanged;
            }
        };
    }

    /// <summary>
    /// Every new day rebuilds the content (the 13-month day grid, the lookups, the notable days), which
    /// removes the control that had the keyboard focus: an arrow key in the day grid, or Enter on a notable
    /// day, left the focus nowhere and the next Tab started from the top of the window. Remember where it was.
    /// </summary>
    private void OnModelChanging(object? sender, PropertyChangingEventArgs e)
    {
        if (e.PropertyName != nameof(ConvertViewModel.Content)) return;
        _focusIndex = -1;
        if (TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement() is not Control focused || !this.IsVisualAncestorOf(focused)) return;
        _focusIndex = FocusStops().IndexOf(focused);
        _focusName = SpokenName(focused);
        _focusVisible = focused.Classes.Contains(":focus-visible");
    }

    private void OnModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(ConvertViewModel.Content) && _focusIndex >= 0) Dispatcher.UIThread.Post(RestoreFocus, DispatcherPriority.Loaded);
    }

    /// <summary>Puts the focus back on the control with the same name, else on the one in the same place.</summary>
    private void RestoreFocus()
    {
        var index = _focusIndex;
        _focusIndex = -1;
        if (index < 0 || TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement() is Control current && this.IsVisualAncestorOf(current)) return;
        var stops = FocusStops();
        if (stops.Count == 0) return;
        var target = stops.FirstOrDefault(c => SpokenName(c) == _focusName) ?? stops[Math.Min(index, stops.Count - 1)];
        target.Focus(_focusVisible ? NavigationMethod.Tab : NavigationMethod.Unspecified);
    }

    private List<Control> FocusStops() =>
        this.GetVisualDescendants().OfType<Control>().Where(c => c.Focusable && c.IsEffectivelyVisible && c.IsEffectivelyEnabled).ToList();

    private static string? SpokenName(Control control) =>
        AutomationProperties.GetName(control) is { Length: > 0 } name ? name : ControlAutomationPeer.CreatePeerForElement(control).GetName();

    private void RestoreYear()
    {
        if (YearBox.Value is null && DataContext is ConvertViewModel model) YearBox.Value = model.DisplayYear;
    }

    private static void NameParts(TemplatedControl control) => control.TemplateApplied += (_, e) =>
    {
        var name = AutomationProperties.GetName(control);
        if (e.NameScope.Find<TextBox>("PART_TextBox") is { } text) AutomationProperties.SetName(text, name);
        if (e.NameScope.Find<ButtonSpinner>("PART_Spinner") is { } spinner) AutomationProperties.SetName(spinner, name);
    };

    /// <summary>The button of the picked day in the month the calendar shows, or null.</summary>
    private CalendarDayButton? PickedDayButton()
    {
        if (Picker.SelectedDate is not { } picked) return null;
        return Picker.GetVisualDescendants().OfType<CalendarDayButton>()
            .FirstOrDefault(b => b.IsEffectivelyVisible && b.DataContext is DateTime day && day.Date == picked.Date);
    }

    private void UpdateTabStop()
    {
        if (PickedDayButton() is { } button) KeyboardNavigation.SetTabOnceActiveElement(Picker, button);
    }

    private void FocusPickedDay(NavigationMethod method)
    {
        if (PickedDayButton() is not { } button) return;
        KeyboardNavigation.SetTabOnceActiveElement(Picker, button);
        if (!button.IsFocused) button.Focus(method);
    }

    // Tab into the calendar lands on the picked day, not on the first button of the grid.
    private void OnPickerGotFocus(object? sender, GotFocusEventArgs e)
    {
        if (e.NavigationMethod != NavigationMethod.Tab || e.Source is not CalendarDayButton target) return;
        if (PickedDayButton() is { } picked && picked != target) picked.Focus(NavigationMethod.Tab);
    }
}
