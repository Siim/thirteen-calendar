using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Platform;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views;

/// <summary>
/// The main window: keeps today's date current, adapts the navigation pane and the detail pane to the
/// window width, and remembers its size and position.
/// </summary>
public partial class MainWindow : Window
{
    /// <summary>Below this width the navigation pane collapses to a compact rail.</summary>
    public const double RailWidth = 1008;

    /// <summary>Below this width the day details float over the page instead of sitting beside it.</summary>
    public const double OverlayDetailWidth = 1240;

    // Reads the clock just after each local midnight and at least every 30 seconds, so the dates roll over
    // at midnight and follow a time-zone or clock change (Services/LocalClock.cs).
    private readonly DispatcherTimer _clockTimer = new() { Interval = LocalClock.MaximumInterval };
    private MainViewModel? _model;
    private bool? _narrow;
    private bool _adjustingPane;
    private PixelPoint _normalPosition;
    private Size _normalSize;
    // The last control focused outside the day details, where the focus goes back when they close.
    private Control? _focusBeforeDetail;
    private bool _detailHadVisibleFocus;

    /// <summary>Creates the window.</summary>
    public MainWindow()
    {
        InitializeComponent();
        // Greyscale antialiasing: subpixel (ClearType-style) fringes tinted the small coloured figures
        // differently from cell to cell at 100% scaling.
        RenderOptions.SetTextRenderingMode(this, TextRenderingMode.Antialias);
        if (OperatingSystem.IsWindows())
        {
            // Windows 11 style: the page colours run up under the system caption buttons.
            ExtendClientAreaToDecorationsHint = true;
            ExtendClientAreaChromeHints = ExtendClientAreaChromeHints.PreferSystemChrome;
            ExtendClientAreaTitleBarHeightHint = 40;
            TitleBar.IsVisible = true;
        }
        _clockTimer.Tick += (_, _) =>
        {
            _model?.State.RefreshToday();
            ScheduleClock();
        };
        Opened += (_, _) =>
        {
            ScheduleClock();
            _clockTimer.Start();
            Dispatcher.UIThread.Post(UpdateNavTabStop, DispatcherPriority.Loaded);
        };
        Closed += (_, _) => _clockTimer.Stop();
        Activated += (_, _) => _model?.State.RefreshToday();
        DataContextChanged += (_, _) =>
        {
            if (_model is not null)
            {
                _model.PropertyChanged -= OnModelChanged;
                _model.PropertyChanging -= OnModelChanging;
                _model.CalendarsPaneRequested -= OnCalendarsPaneRequested;
            }
            _model = DataContext as MainViewModel;
            if (_model is not null)
            {
                _model.PropertyChanged += OnModelChanged;
                _model.PropertyChanging += OnModelChanging;
                _model.CalendarsPaneRequested += OnCalendarsPaneRequested;
                _model.TextInputFocused = () => FocusManager?.GetFocusedElement() is TextBox;
            }
        };
        AddHandler(GotFocusEvent, (_, e) =>
        {
            if (e.Source is Control control && !DetailHost.IsVisualAncestorOf(control)) _focusBeforeDetail = control;
        }, RoutingStrategies.Bubble, handledEventsToo: true);
        PositionChanged += (_, _) =>
        {
            if (WindowState == WindowState.Normal) _normalPosition = Position;
        };
        Pane.AddHandler(KeyDownEvent, OnPaneKeyDown);
        InitializeEvents();
        InitializeEditor();
    }

    private void ScheduleClock() => _clockTimer.Interval = LocalClock.UntilNextCheck(DateTimeOffset.UtcNow, TimeZoneInfo.Local);

    /// <summary>The navigation items in pane order: the five pages, then Settings.</summary>
    private RadioButton[] NavButtons() =>
        [.. NavList.GetVisualDescendants().OfType<RadioButton>(), SettingsNav];

    /// <summary>Up and Down move between the navigation items (WinUI NavigationView); Space or Enter opens one.</summary>
    private void OnPaneKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.KeyModifiers != KeyModifiers.None || e.Key is not (Key.Up or Key.Down)) return;
        if (e.Source is not Visual source) return;
        var buttons = NavButtons();
        var index = Array.FindIndex(buttons, b => b == source || b.IsVisualAncestorOf(source));
        if (index < 0) return;
        var next = index + (e.Key == Key.Down ? 1 : -1);
        if (next < 0 || next >= buttons.Length) return;
        buttons[next].Focus(NavigationMethod.Directional);
        e.Handled = true;
    }

    /// <summary>
    /// "Show calendars", "Subscriptions not updated", Ctrl+Shift+K: the pane is open (MainViewModel.ShowCalendarsPane);
    /// the focus goes to the first hidden calendar's checkbox when every calendar is hidden (§2.4 "States"), else to the
    /// first calendar's.
    /// </summary>
    private void OnCalendarsPaneRequested(bool focusHidden)
    {
        Dispatcher.UIThread.Post(() =>
        {
            var boxes = CalendarsPaneView.GetVisualDescendants().OfType<CheckBox>().Where(b => b.IsEffectivelyVisible).ToArray();
            Control? target = (focusHidden ? boxes.FirstOrDefault(b => b.IsChecked != true) : null) ?? boxes.FirstOrDefault();
            target ??= CalendarsPaneView.GetVisualDescendants().OfType<Control>().FirstOrDefault(c => c.Focusable && c.IsEffectivelyVisible && c is not ScrollViewer);
            if (target is null) return;
            target.Focus(NavigationMethod.Tab);
            target.BringIntoView();
        }, DispatcherPriority.Loaded);
    }

    /// <summary>Tab enters the page list on the selected page, as in WinUI.</summary>
    private void UpdateNavTabStop()
    {
        if (NavButtons().FirstOrDefault(b => b.IsChecked == true && b != SettingsNav) is { } selected)
        {
            KeyboardNavigation.SetTabOnceActiveElement(NavList, selected);
        }
    }

    /// <summary>A second start of the app: opens its thirteen:// link, if any, and brings this window to the front.</summary>
    public void OpenFromAnotherStart(string? link)
    {
        if (link is not null && Support.DeepLink.TryParse(link) is { } parsed) _model?.Open(parsed);
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Show();
        Activate();
    }

    /// <summary>The events services of this run (null in tests that do not need them).</summary>
    public EventsHost? Events { get; set; }

    private bool _closingAfterCommit;

    /// <summary>
    /// A file or link handed to Thirteen (the command line, or a second start): a subscribe link opens the Subscribe
    /// dialog prefilled, nothing fetched until the user presses Subscribe (§2.17 step 6). Files to import open the Import
    /// dialog (or Restore calendars for Thirteen's own exports); nothing is written until Import or Restore is pressed.
    /// </summary>
    public async void HandleExternal(Support.ExternalRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        if (request.Kind != Support.ExternalKind.Subscribe)
        {
            ImportFiles(request.Files);
            return;
        }
        if (Events is not { } events || OwnedWindows.OfType<Views.Events.SubscribeDialog>().Any()) return;
        try
        {
            // A link given at start-up can arrive before the calendars have loaded: the dialog needs them (the next
            // free color, and a subscription added before the load would be dropped by it).
            await events.Store.LoadAsync();
        }
        catch (EventStoreException e)
        {
            System.Diagnostics.Trace.WriteLine($"Thirteen: no Subscribe dialog, the calendars could not be loaded: {e.Message}");
            return;
        }
        if (OwnedWindows.OfType<Views.Events.SubscribeDialog>().Any()) return;
        await Views.Events.EventDialogs.SubscribeAsync(this, events.Store, events.Subscriptions, request.Link);
    }

    /// <summary>Whether the pane is a rail (narrow window).</summary>
    public bool IsNarrow => _narrow ?? false;

    /// <summary>Applies a saved placement if it is still on a screen.</summary>
    public void Restore(WindowPlacement? placement)
    {
        if (placement is null || placement.Width < MinWidth || placement.Height < MinHeight) return;
        var screens = Screens.All;
        var rect = new PixelRect(placement.X, placement.Y, (int)placement.Width, (int)placement.Height);
        var visible = screens.Any(s => s.WorkingArea.Intersects(rect) &&
            s.WorkingArea.Contains(new PixelPoint(placement.X + 40, placement.Y + 20)));
        Width = placement.Width;
        Height = placement.Height;
        if (visible)
        {
            WindowStartupLocation = WindowStartupLocation.Manual;
            Position = new PixelPoint(placement.X, placement.Y);
        }
        if (placement.Maximized) WindowState = WindowState.Maximized;
    }

    /// <summary>The current placement (normal bounds, and whether maximized).</summary>
    public WindowPlacement CurrentPlacement()
    {
        var size = WindowState == WindowState.Normal ? ClientSize : _normalSize;
        var position = WindowState == WindowState.Normal ? Position : _normalPosition;
        if (size.Width <= 0) size = ClientSize;
        return new WindowPlacement
        {
            X = position.X,
            Y = position.Y,
            Width = Math.Round(size.Width),
            Height = Math.Round(size.Height),
            Maximized = WindowState == WindowState.Maximized,
        };
    }

    /// <inheritdoc />
    protected override void OnClosing(WindowClosingEventArgs e)
    {
        base.OnClosing(e);
        if (e.Cancel) return;
        if (_model is not null && WindowState != WindowState.Minimized) _model.State.WindowPlacement = CurrentPlacement();
        // Pending moves and deletes are written before the window goes, and the close waits for them (§2.11).
        if (!_closingAfterCommit && Events is { } events && events.Pending.Pending.Count > 0)
        {
            e.Cancel = true;
            _closingAfterCommit = true;
            _ = CloseAfterCommitAsync(events);
        }
    }

    private async Task CloseAfterCommitAsync(EventsHost events)
    {
        try
        {
            await events.CloseAsync();
        }
        catch (Exception ex) when (ex is EventStoreException or IOException)
        {
            System.Diagnostics.Trace.WriteLine($"Thirteen: pending changes on close: {ex.Message}");
        }
        Close();
    }

    /// <inheritdoc />
    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == ClientSizeProperty)
        {
            if (WindowState == WindowState.Normal) _normalSize = ClientSize;
            Adapt(ClientSize.Width);
        }
    }

    /// <summary>Rail or full pane; detail beside or over the page.</summary>
    private void Adapt(double width)
    {
        if (_model is null) return;
        var narrow = width < RailWidth;
        if (narrow != _narrow)
        {
            _narrow = narrow;
            _adjustingPane = true;
            Split.DisplayMode = narrow ? SplitViewDisplayMode.CompactOverlay : SplitViewDisplayMode.CompactInline;
            _model.IsPaneOpen = !narrow && _model.State.PaneExpanded;
            _adjustingPane = false;
        }

        var overlay = width < OverlayDetailWidth;
        Grid.SetColumn(DetailHost, overlay ? 0 : 1);
        Grid.SetColumnSpan(DetailHost, overlay ? 2 : 1);
        DetailHost.HorizontalAlignment = overlay ? HorizontalAlignment.Right : HorizontalAlignment.Stretch;
        DetailHost.Width = Math.Min(408, Math.Max(320, width - 120));
        DetailHost.BoxShadow = overlay
            ? new BoxShadows(new BoxShadow { OffsetX = -8, Blur = 32, Color = Color.FromArgb(0x40, 0, 0, 0) })
            : default;
    }

    private void OnModelChanging(object? sender, PropertyChangingEventArgs e)
    {
        if (e.PropertyName != nameof(MainViewModel.Detail)) return;
        var focused = FocusManager?.GetFocusedElement() as Control;
        _detailHadVisibleFocus = focused is not null && DetailHost.IsVisualAncestorOf(focused) && focused.Classes.Contains(":focus-visible");
    }

    /// <summary>
    /// The day details closed (Close, Esc, Open in Convert): a focus that was inside them would otherwise go
    /// nowhere, and the next Tab would start again at the menu button. It goes back where it came from (the
    /// day that was opened), or to the start of the page shown.
    /// </summary>
    private void ReturnFocusFromDetail()
    {
        var focused = FocusManager?.GetFocusedElement() as Control;
        if (focused is not null && focused.IsEffectivelyVisible && !DetailHost.IsVisualAncestorOf(focused)) return;
        var method = _detailHadVisibleFocus ? NavigationMethod.Tab : NavigationMethod.Unspecified;
        if (_focusBeforeDetail is { } back && back.IsEffectivelyVisible && back.IsAttachedToVisualTree() && back.Focus(method)) return;
        Pages.GetVisualDescendants().OfType<Control>()
            .FirstOrDefault(c => c.Focusable && c.IsEffectivelyVisible && c.IsEffectivelyEnabled && c is not ScrollViewer)
            ?.Focus(method);
    }

    private void OnModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (_model is null) return;
        if (e.PropertyName == nameof(MainViewModel.HasDetail) && !_model.HasDetail)
        {
            Dispatcher.UIThread.Post(ReturnFocusFromDetail, DispatcherPriority.Loaded);
            return;
        }
        if (e.PropertyName == nameof(MainViewModel.IsPaneOpen) && !_adjustingPane && _narrow == false)
        {
            _model.State.PaneExpanded = _model.IsPaneOpen;
        }
        else if (e.PropertyName == nameof(MainViewModel.Section))
        {
            Dispatcher.UIThread.Post(UpdateNavTabStop, DispatcherPriority.Loaded);
            // On a rail, picking a screen closes the overlay pane.
            if (_narrow == true) _model.IsPaneOpen = false;
        }
    }
}
