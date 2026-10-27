using System.ComponentModel;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Thirteen.Desktop.ViewModels.Events;

namespace Thirteen.Desktop.Views.Events;

/// <summary>
/// Shows <see cref="EventActions.Toast"/> and times it (§2.11): it closes after <see cref="EventToastViewModel.Duration"/>
/// unless the pointer is over it or focus is inside it, never on its own while a screen reader runs and it has an
/// action, and on Escape while focus is inside it. Closing runs the toast's close routine (a held change is written).
/// </summary>
public partial class EventToastHost : UserControl
{
    private EventActions? _actions;
    private EventToastViewModel? _shown;
    private DispatcherTimer? _timer;
    private bool _pointerOver;

    /// <summary>Creates the host.</summary>
    public EventToastHost()
    {
        InitializeComponent();
        ToastBox.PointerEntered += (_, _) =>
        {
            _pointerOver = true;
            UpdateTimer();
        };
        ToastBox.PointerExited += (_, _) =>
        {
            _pointerOver = false;
            UpdateTimer();
        };
        ToastBox.AddHandler(GotFocusEvent, (_, _) => UpdateTimer(), RoutingStrategies.Bubble);
        ToastBox.AddHandler(LostFocusEvent, (_, _) => Dispatcher.UIThread.Post(UpdateTimer), RoutingStrategies.Bubble);
        ToastBox.AddHandler(KeyDownEvent, (_, e) =>
        {
            if (e.Key != Key.Escape || _shown is null) return;
            e.Handled = true;
            _ = _shown.CloseAsync();
        }, RoutingStrategies.Bubble);
        DataContextChanged += (_, _) => Attach(DataContext as EventActions);
    }

    /// <summary>The toast's timer is running (tests).</summary>
    public bool IsTiming => _timer?.IsEnabled ?? false;

    private void Attach(EventActions? actions)
    {
        if (_actions is not null) _actions.PropertyChanged -= OnActionsChanged;
        _actions = actions;
        if (actions is not null) actions.PropertyChanged += OnActionsChanged;
        Show(actions?.Toast);
    }

    private void OnActionsChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(EventActions.Toast) or "") Show(_actions?.Toast);
    }

    private void Show(EventToastViewModel? toast)
    {
        if (ReferenceEquals(toast, _shown)) return;
        _timer?.Stop();
        _timer = null;
        _shown = toast;
        if (toast is null) return;
        if (!toast.StaysUntilNextAction)
        {
            _timer = new DispatcherTimer { Interval = toast.Duration };
            _timer.Tick += (_, _) =>
            {
                _timer?.Stop();
                _ = toast.CloseAsync();
            };
        }
        UpdateTimer();
    }

    private void UpdateTimer()
    {
        if (_timer is null) return;
        var paused = _pointerOver || ToastBox.IsKeyboardFocusWithin;
        if (paused) _timer.Stop();
        else if (_shown is { IsClosed: false }) _timer.Start();
    }
}
