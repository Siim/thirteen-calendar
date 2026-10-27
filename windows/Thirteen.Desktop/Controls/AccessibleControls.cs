using Avalonia;
using Avalonia.Automation;
using Avalonia.Automation.Peers;
using Avalonia.Automation.Provider;
using Avalonia.Controls;

namespace Thirteen.Desktop.Controls;

/// <summary>
/// A button that is also a selectable item for UI Automation (docs/EVENTS.md §2.20 "traits Today, Selected"): Month's day
/// cells and intercalary band, the Week and Day column heads, the Day strip, and the event chips and blocks. Its peer has
/// the <c>SelectionItem</c> pattern, so Narrator says "selected" on the day or event that Ctrl+N, Enter and Delete act
/// on. Styled as a <see cref="Button"/>.
/// </summary>
public class SelectableButton : Button
{
    /// <summary>Whether the day or event is the selected one.</summary>
    public static readonly StyledProperty<bool> IsSelectedItemProperty =
        AvaloniaProperty.Register<SelectableButton, bool>(nameof(IsSelectedItem));

    /// <summary>Whether the day or event is the selected one.</summary>
    public bool IsSelectedItem
    {
        get => GetValue(IsSelectedItemProperty);
        set => SetValue(IsSelectedItemProperty, value);
    }

    /// <inheritdoc />
    protected override Type StyleKeyOverride => typeof(Button);

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SelectablePeer(this);

    /// <inheritdoc />
    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == IsSelectedItemProperty && ControlAutomationPeer.FromElement(this) is { } peer)
        {
            peer.RaisePropertyChangedEvent(SelectionItemPatternIdentifiers.IsSelectedProperty, change.GetOldValue<bool>(), change.GetNewValue<bool>());
        }
    }

    /// <summary>A button peer with the SelectionItem pattern; Select invokes the button (it selects the day or event).</summary>
    private sealed class SelectablePeer(SelectableButton owner) : ButtonAutomationPeer(owner), ISelectionItemProvider
    {
        public bool IsSelected => owner.IsSelectedItem;

        public ISelectionProvider? SelectionContainer => null;

        public void AddToSelection() => Select();

        public void RemoveFromSelection()
        {
        }

        public void Select()
        {
            if (!owner.IsSelectedItem && owner.Command?.CanExecute(owner.CommandParameter) == true) owner.Command.Execute(owner.CommandParameter);
        }
    }
}

/// <summary>
/// One adjustable control (docs/EVENTS.md §2.12 "Year"): the date picker's year, a focusable box whose peer has the
/// <c>RangeValue</c> pattern (a spinner) with the shown year as its value, so UI Automation and voice access can read and
/// set it. Up, Down, Page Up and Page Down step it (the view handles the keys); <see cref="ValueRequested"/> asks for a
/// year set through UI Automation.
/// </summary>
public class YearStepper : Border
{
    /// <summary>The year shown (the 13-month display year).</summary>
    public static readonly StyledProperty<double> ValueProperty = AvaloniaProperty.Register<YearStepper, double>(nameof(Value));

    /// <summary>The first year that can be chosen.</summary>
    public static readonly StyledProperty<double> MinimumProperty = AvaloniaProperty.Register<YearStepper, double>(nameof(Minimum), 1);

    /// <summary>The last year that can be chosen.</summary>
    public static readonly StyledProperty<double> MaximumProperty = AvaloniaProperty.Register<YearStepper, double>(nameof(Maximum), 9999);

    /// <summary>The year shown.</summary>
    public double Value
    {
        get => GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    /// <summary>The first year that can be chosen.</summary>
    public double Minimum
    {
        get => GetValue(MinimumProperty);
        set => SetValue(MinimumProperty, value);
    }

    /// <summary>The last year that can be chosen.</summary>
    public double Maximum
    {
        get => GetValue(MaximumProperty);
        set => SetValue(MaximumProperty, value);
    }

    /// <summary>Raised with a year set through UI Automation.</summary>
    public event Action<double>? ValueRequested;

    /// <summary>Creates the stepper (focusable).</summary>
    public YearStepper() => Focusable = true;

    /// <inheritdoc />
    protected override Type StyleKeyOverride => typeof(Border);

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new StepperPeer(this);

    /// <inheritdoc />
    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == ValueProperty && ControlAutomationPeer.FromElement(this) is { } peer)
        {
            peer.RaisePropertyChangedEvent(RangeValuePatternIdentifiers.ValueProperty, change.GetOldValue<double>(), change.GetNewValue<double>());
        }
    }

    /// <summary>A spinner peer with the RangeValue pattern.</summary>
    private sealed class StepperPeer(YearStepper owner) : ControlAutomationPeer(owner), IRangeValueProvider
    {
        public bool IsReadOnly => !owner.IsEffectivelyEnabled;

        public double Minimum => owner.Minimum;

        public double Maximum => owner.Maximum;

        public double Value => owner.Value;

        public double SmallChange => 1;

        public double LargeChange => 1;

        public void SetValue(double value) => owner.ValueRequested?.Invoke(Math.Clamp(Math.Round(value), owner.Minimum, owner.Maximum));

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Spinner;

        protected override bool IsControlElementCore() => true;

        protected override bool IsContentElementCore() => true;
    }
}
