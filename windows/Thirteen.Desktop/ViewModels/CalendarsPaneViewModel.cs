using System.Collections.ObjectModel;
using Avalonia.Media;
using Avalonia.Media.Immutable;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>How a row's status line looks (§2.16 "Subscription states").</summary>
public enum CalendarRowStatus
{
    /// <summary>No status line.</summary>
    None,

    /// <summary>A plain line ("Updated 10 min ago").</summary>
    Plain,

    /// <summary>"Updating", with a spinner.</summary>
    Updating,

    /// <summary>A warning icon: stale, or a feed held back.</summary>
    Warning,

    /// <summary><c>accent-text</c> with an error icon: "Couldn't update. {reason}".</summary>
    Error,
}

/// <summary>
/// The Calendars pane of Windows (docs/EVENTS.md §2.15, §2.16; boards D2, L1, L2): "On this computer" and
/// "Subscriptions", each collapsible with "Hide all" / "Show all"; rows with a color swatch, name, visibility checkbox,
/// status line and an info button for the calendar's settings; the offline banner; "New calendar", "Subscribe to
/// calendar", "Import .ics file", "Export"; and "Your events are saved on this computer." with "Open folder". The
/// actions that open dialogs are raised as events for the window.
/// </summary>
public sealed partial class CalendarsPaneViewModel : ViewModelBase, IDisposable
{
    private readonly IEventStore _store;
    private readonly SubscriptionService? _subscriptions;
    private readonly TimeProvider _time;
    private readonly Action<Action> _post;
    private bool _isOffline;
    private bool _anyStale;
    private bool _disposed;
    private Action? _importRequested;
    private Action<string?>? _exportRequested;

    /// <summary>
    /// The pane over <paramref name="store"/> (and <paramref name="subscriptions"/> for refreshes and offline). Store and
    /// service events are posted to the UI thread with <paramref name="post"/> (tests run them at once).
    /// </summary>
    public CalendarsPaneViewModel(IEventStore store, SubscriptionService? subscriptions = null, TimeProvider? time = null, Action<Action>? post = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _subscriptions = subscriptions;
        _time = time ?? TimeProvider.System;
        _post = post ?? (action => Dispatcher.UIThread.Post(action));
        Local = new CalendarGroupViewModel(this, CalendarKinds.Local, EventStrings.GroupComputer);
        Subscribed = new CalendarGroupViewModel(this, CalendarKinds.Subscription, EventStrings.GroupSubscriptions);
        Groups = [Local, Subscribed];
        NewCalendarCommand = new RelayCommand(() => NewCalendarRequested?.Invoke());
        SubscribeCommand = new RelayCommand(() => SubscribeRequested?.Invoke(null));
        ImportCommand = new RelayCommand(() => _importRequested?.Invoke(), () => _importRequested is not null);
        ExportCommand = new RelayCommand(() => _exportRequested?.Invoke(null), () => _exportRequested is not null);
        OpenFolderCommand = new RelayCommand(() => OpenFolderRequested?.Invoke(), () => _store.Folder is not null);
        _store.Changed += OnStoreChanged;
        if (_subscriptions is not null) _subscriptions.StateChanged += OnSubscriptionsChanged;
        Refresh();
    }

    /// <summary>"Calendars".</summary>
    public string Title => EventStrings.CalendarsTitle;

    /// <summary>The two groups, in list order.</summary>
    public IReadOnlyList<CalendarGroupViewModel> Groups { get; }

    /// <summary>"On this computer".</summary>
    public CalendarGroupViewModel Local { get; }

    /// <summary>"Subscriptions" (hidden while there are none).</summary>
    public CalendarGroupViewModel Subscribed { get; }

    /// <summary>The offline banner is shown (§2.16 "Offline").</summary>
    public bool IsOffline
    {
        get => _isOffline;
        private set => SetProperty(ref _isOffline, value);
    }

    /// <summary><c>calendars.offline</c></summary>
    public string OfflineText => EventStrings.Offline;

    /// <summary>A visible subscription is stale: the Calendar toolbar shows "Subscriptions not updated" (§2.1).</summary>
    public bool AnyStale
    {
        get => _anyStale;
        private set => SetProperty(ref _anyStale, value);
    }

    /// <summary><c>calendar.subscriptionsStale</c></summary>
    public string StaleText => EventStrings.SubscriptionsStale;

    /// <summary><c>calendars.new</c></summary>
    public string NewCalendarText => EventStrings.NewCalendar;

    /// <summary><c>calendars.subscribe</c></summary>
    public string SubscribeText => EventStrings.SubscribeToCalendar;

    /// <summary><c>calendars.import</c></summary>
    public string ImportText => EventStrings.ImportIcs;

    /// <summary><c>calendars.export</c></summary>
    public string ExportText => EventStrings.Export;

    /// <summary><c>calendars.storage.windows</c></summary>
    public string StorageText => EventStrings.StorageWindows;

    /// <summary><c>calendars.openFolder</c></summary>
    public string OpenFolderText => EventStrings.OpenFolder;

    /// <summary>The store has a folder to open (the file store; not the mockup data set).</summary>
    public bool HasFolder => _store.Folder is not null;

    /// <summary>"New calendar".</summary>
    public RelayCommand NewCalendarCommand { get; }

    /// <summary>"Subscribe to calendar".</summary>
    public RelayCommand SubscribeCommand { get; }

    /// <summary>"Import .ics file".</summary>
    public RelayCommand ImportCommand { get; }

    /// <summary>"Export".</summary>
    public RelayCommand ExportCommand { get; }

    /// <summary>"Open folder" (the Calendars folder in Explorer).</summary>
    public RelayCommand OpenFolderCommand { get; }

    /// <summary>"New calendar" was chosen.</summary>
    public event Action? NewCalendarRequested;

    /// <summary>"Subscribe to calendar" was chosen (the argument prefills the link).</summary>
    public event Action<string?>? SubscribeRequested;

    /// <summary>"Import .ics file" was chosen. The button is enabled once something handles it (the Import flow, task W8).</summary>
    public event Action? ImportRequested
    {
        add
        {
            _importRequested += value;
            ImportCommand.NotifyCanExecuteChanged();
        }
        remove
        {
            _importRequested -= value;
            ImportCommand.NotifyCanExecuteChanged();
        }
    }

    /// <summary>
    /// "Export" was chosen (the argument is one calendar's id, or null for the Export dialog). The button is enabled once
    /// something handles it (the Export flow, task W8).
    /// </summary>
    public event Action<string?>? ExportRequested
    {
        add
        {
            _exportRequested += value;
            ExportCommand.NotifyCanExecuteChanged();
        }
        remove
        {
            _exportRequested -= value;
            ExportCommand.NotifyCanExecuteChanged();
        }
    }

    internal void RequestExport(string id) => _exportRequested?.Invoke(id);

    /// <summary>Whether something handles Export (the settings dialog's Export button).</summary>
    public bool CanExport => _exportRequested is not null;

    /// <summary>"Open folder" was chosen.</summary>
    public event Action? OpenFolderRequested;

    /// <summary>A row's info button: the calendar's settings.</summary>
    public event Action<string>? SettingsRequested;

    /// <summary>The store.</summary>
    public IEventStore Store => _store;

    /// <summary>The subscription service, if any.</summary>
    public SubscriptionService? Subscriptions => _subscriptions;

    internal void RequestSettings(string id) => SettingsRequested?.Invoke(id);

    internal void RequestOpenFolder() => OpenFolderRequested?.Invoke();

    internal async Task SetVisibleAsync(IEnumerable<string> ids, bool visible)
    {
        foreach (var id in ids.ToList())
        {
            if (_store.Find(id) is not { } calendar || calendar.Visible == visible) continue;
            try
            {
                await _store.UpdateRecordAsync(id, r => r with { Visible = visible });
            }
            catch (EventStoreException e)
            {
                System.Diagnostics.Trace.WriteLine($"Thirteen: could not change the visibility of {id}: {e.Message}");
            }
        }
    }

    internal async Task SetColorAsync(string id, string color)
    {
        try
        {
            await _store.UpdateRecordAsync(id, r => r with { Color = color });
        }
        catch (EventStoreException e)
        {
            System.Diagnostics.Trace.WriteLine($"Thirteen: could not change the color of {id}: {e.Message}");
        }
    }

    internal async Task SetCollapsedAsync(string kind, bool collapsed)
    {
        try
        {
            await _store.SetCollapsedAsync(kind, collapsed);
        }
        catch (EventStoreException e)
        {
            System.Diagnostics.Trace.WriteLine($"Thirteen: could not store the collapsed group: {e.Message}");
        }
    }

    internal async Task TryAgainAsync(string id)
    {
        if (_subscriptions is null) return;
        try
        {
            await _subscriptions.RefreshAsync(id);
        }
        catch (Exception e) when (e is EventStoreException or InvalidOperationException)
        {
            System.Diagnostics.Trace.WriteLine($"Thirteen: could not refresh {id}: {e.Message}");
        }
    }

    private void OnStoreChanged(object? sender, StoreChangedEventArgs e) => _post(Refresh);

    private void OnSubscriptionsChanged(string? id) => _post(Refresh);

    /// <summary>Rebuilds the rows from the store (keeps the row objects of calendars still listed).</summary>
    public void Refresh()
    {
        if (_disposed) return;
        var now = _time.GetUtcNow();
        IsOffline = _subscriptions?.IsOffline ?? false;
        var calendars = _store.Calendars;
        var collapsed = _store.CollapsedGroups;
        Local.Update(calendars.Where(c => !c.IsSubscription).ToList(), collapsed.Contains(CalendarKinds.Local), now);
        Subscribed.Update(calendars.Where(c => c.IsSubscription).ToList(), collapsed.Contains(CalendarKinds.Subscription), now);
        AnyStale = calendars.Any(c => c.IsSubscription && c.Visible && SubscriptionService.IsStale(c.Record, now));
    }

    internal CalendarRowViewModel Row(CalendarState calendar, DateTimeOffset now, CalendarRowViewModel? existing)
    {
        var row = existing ?? new CalendarRowViewModel(this, calendar.Id);
        row.Update(calendar, now, _subscriptions?.IsRefreshing(calendar.Id) ?? false, IsOffline);
        return row;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _store.Changed -= OnStoreChanged;
        if (_subscriptions is not null) _subscriptions.StateChanged -= OnSubscriptionsChanged;
    }
}

/// <summary>One group of the Calendars pane ("On this computer", "Subscriptions").</summary>
public sealed partial class CalendarGroupViewModel : ViewModelBase
{
    private readonly CalendarsPaneViewModel _pane;
    private bool _isCollapsed;
    private bool _isEmpty = true;
    private string _collapsedText = "";
    private string _toggleAllText = EventStrings.HideAll;

    internal CalendarGroupViewModel(CalendarsPaneViewModel pane, string kind, string title)
    {
        _pane = pane;
        Kind = kind;
        Title = title;
        ToggleCollapsedCommand = new RelayCommand(() =>
        {
            IsCollapsed = !IsCollapsed;
            _ = _pane.SetCollapsedAsync(Kind, IsCollapsed);
        });
        ToggleAllCommand = new RelayCommand(() =>
        {
            var show = Rows.Any(r => !r.IsVisible);
            _ = _pane.SetVisibleAsync(Rows.Select(r => r.Id), show);
        });
    }

    /// <summary><see cref="CalendarKinds.Local"/> or <see cref="CalendarKinds.Subscription"/>.</summary>
    public string Kind { get; }

    /// <summary>"On this computer" / "Subscriptions".</summary>
    public string Title { get; }

    /// <summary>The rows.</summary>
    public ObservableCollection<CalendarRowViewModel> Rows { get; } = [];

    /// <summary>The group is collapsed (stored with the visibility, §2.15).</summary>
    public bool IsCollapsed
    {
        get => _isCollapsed;
        private set
        {
            if (!SetProperty(ref _isCollapsed, value)) return;
            OnPropertyChanged(nameof(IsExpanded));
            OnPropertyChanged(nameof(HeaderName));
        }
    }

    /// <summary>The rows are shown.</summary>
    public bool IsExpanded => !_isCollapsed;

    /// <summary>The group has no calendars (the Subscriptions group is then not shown).</summary>
    public bool IsEmpty
    {
        get => _isEmpty;
        private set
        {
            if (SetProperty(ref _isEmpty, value)) OnPropertyChanged(nameof(IsShown));
        }
    }

    /// <summary>The group is shown: "On this computer" always, "Subscriptions" when there is one.</summary>
    public bool IsShown => Kind == CalendarKinds.Local || !_isEmpty;

    /// <summary><c>calendars.group.collapsed</c>: "{n} calendars, {m} shown".</summary>
    public string CollapsedText
    {
        get => _collapsedText;
        private set => SetProperty(ref _collapsedText, value);
    }

    /// <summary>"Hide all", or "Show all" once something in the group is hidden.</summary>
    public string ToggleAllText
    {
        get => _toggleAllText;
        private set => SetProperty(ref _toggleAllText, value);
    }

    /// <summary>The header's accessible name: its title and, collapsed, how many calendars it holds.</summary>
    public string HeaderName => IsCollapsed ? $"{Title}, {CollapsedText}" : Title;

    /// <summary>The chevron: collapse or expand.</summary>
    public RelayCommand ToggleCollapsedCommand { get; }

    /// <summary>"Hide all" / "Show all".</summary>
    public RelayCommand ToggleAllCommand { get; }

    internal void Update(IReadOnlyList<CalendarState> calendars, bool collapsed, DateTimeOffset now)
    {
        var existing = Rows.ToDictionary(r => r.Id, StringComparer.Ordinal);
        var rows = calendars.Select(c => _pane.Row(c, now, existing.GetValueOrDefault(c.Id))).ToList();
        if (!rows.SequenceEqual(Rows))
        {
            Rows.Clear();
            foreach (var row in rows) Rows.Add(row);
        }
        IsCollapsed = collapsed;
        IsEmpty = rows.Count == 0;
        CollapsedText = EventStrings.GroupCollapsed(rows.Count, rows.Count(r => r.IsVisible));
        ToggleAllText = rows.Any(r => !r.IsVisible) ? EventStrings.ShowAll : EventStrings.HideAll;
        OnPropertyChanged(nameof(HeaderName));
    }
}

/// <summary>One calendar of the Calendars pane.</summary>
public sealed partial class CalendarRowViewModel : ViewModelBase
{
    private readonly CalendarsPaneViewModel _pane;
    private bool _updating;
    private string _name = "";
    private IBrush _swatch = Brushes.Gray;
    private string _color = "";
    private IReadOnlyList<ColorOption> _colors = ColorOption.Palette;
    private ColorOption? _selectedColor;
    private bool _isVisible;
    private bool _isReadOnly;
    private string? _statusText;
    private CalendarRowStatus _status;
    private bool _canTryAgain;
    private bool _canOpenFolder;

    internal CalendarRowViewModel(CalendarsPaneViewModel pane, string id)
    {
        _pane = pane;
        Id = id;
        TryAgainCommand = new AsyncRelayCommand(() => _pane.TryAgainAsync(Id));
        SettingsCommand = new RelayCommand(() => _pane.RequestSettings(Id));
        OpenFolderCommand = new RelayCommand(_pane.RequestOpenFolder);
    }

    /// <summary>The calendar id.</summary>
    public string Id { get; }

    /// <summary>The name (user text, never changed).</summary>
    public string Name
    {
        get => _name;
        private set => SetProperty(ref _name, value);
    }

    /// <summary>The calendar's color.</summary>
    public IBrush Swatch
    {
        get => _swatch;
        private set => SetProperty(ref _swatch, value);
    }

    /// <summary>The swatch button's accessible name: "Color, {color name}".</summary>
    public string ColorName => $"{EventStrings.Color}, {CalendarPalette.NameOf(_color) ?? _color.ToUpperInvariant()}";

    /// <summary>The colors the swatch button offers (the palette, with the calendar's own color first when it is not in it).</summary>
    public IReadOnlyList<ColorOption> Colors
    {
        get => _colors;
        private set => SetProperty(ref _colors, value);
    }

    /// <summary>The calendar's color in <see cref="Colors"/>; choosing another stores it (§2.15: the swatch changes the color on Windows).</summary>
    public ColorOption? SelectedColor
    {
        get => _selectedColor;
        set
        {
            if (value is null || !SetProperty(ref _selectedColor, value) || _updating) return;
            _ = _pane.SetColorAsync(Id, value.Hex);
        }
    }

    /// <summary>Thirteen's visibility: the checkbox (§2.15). Changing it stores it.</summary>
    public bool IsVisible
    {
        get => _isVisible;
        set
        {
            if (!SetProperty(ref _isVisible, value) || _updating) return;
            _ = _pane.SetVisibleAsync([Id], value);
        }
    }

    /// <summary>
    /// The "Read only" tag of a calendar that is not writable (§2.15; boards A2 note 9, D note 22, L2): every subscription,
    /// and a local calendar whose file cannot be read. Shown with the status line, as on the web and the Mac.
    /// </summary>
    public bool IsReadOnly
    {
        get => _isReadOnly;
        private set => SetProperty(ref _isReadOnly, value);
    }

    /// <summary>"Read only".</summary>
    public string ReadOnlyText => EventStrings.ReadOnly;

    /// <summary>The status line, or null.</summary>
    public string? StatusText
    {
        get => _statusText;
        private set
        {
            if (SetProperty(ref _statusText, value)) OnPropertyChanged(nameof(HasStatus));
        }
    }

    /// <summary>A status line is shown.</summary>
    public bool HasStatus => _statusText is not null;

    /// <summary>How the status line looks.</summary>
    public CalendarRowStatus Status
    {
        get => _status;
        private set
        {
            if (!SetProperty(ref _status, value)) return;
            OnPropertyChanged(nameof(IsWarning));
            OnPropertyChanged(nameof(IsError));
            OnPropertyChanged(nameof(IsUpdating));
            OnPropertyChanged(nameof(IsPlain));
        }
    }

    /// <summary>A warning icon before the line.</summary>
    public bool IsWarning => _status == CalendarRowStatus.Warning;

    /// <summary>The line in accent text with an error icon.</summary>
    public bool IsError => _status == CalendarRowStatus.Error;

    /// <summary>"Updating" with a spinner.</summary>
    public bool IsUpdating => _status == CalendarRowStatus.Updating;

    /// <summary>A plain line.</summary>
    public bool IsPlain => _status is CalendarRowStatus.Plain or CalendarRowStatus.Updating;

    /// <summary>"Try again" is offered (an error, or a feed held back).</summary>
    public bool CanTryAgain
    {
        get => _canTryAgain;
        private set => SetProperty(ref _canTryAgain, value);
    }

    /// <summary>"Open folder" is offered (the store notices of §2.16).</summary>
    public bool CanOpenFolder
    {
        get => _canOpenFolder;
        private set => SetProperty(ref _canOpenFolder, value);
    }

    /// <summary>"Try again".</summary>
    public string TryAgainText => EventStrings.TryAgain;

    /// <summary>"Open folder".</summary>
    public string OpenFolderText => EventStrings.OpenFolder;

    /// <summary>The checkbox's accessible name: the calendar and its status.</summary>
    public string AccessibleName => _statusText is null ? Name : $"{Name}, {_statusText}";

    /// <summary>The info button's accessible name: "Calendar settings, {name}".</summary>
    public string SettingsName => $"{EventStrings.CalendarSettings}, {Name}";

    /// <summary>The info button's tooltip.</summary>
    public string SettingsTip => EventStrings.CalendarSettings;

    /// <summary>"Try again": refreshes the subscription now.</summary>
    public AsyncRelayCommand TryAgainCommand { get; }

    /// <summary>The info button.</summary>
    public RelayCommand SettingsCommand { get; }

    /// <summary>"Open folder".</summary>
    public RelayCommand OpenFolderCommand { get; }

    internal void Update(CalendarState calendar, DateTimeOffset now, bool refreshing, bool offline)
    {
        _updating = true;
        try
        {
            Name = calendar.Name;
            Swatch = Color.TryParse(calendar.Color, out var color) ? new ImmutableSolidColorBrush(color) : Brushes.Gray;
            if (!string.Equals(_color, calendar.Color, StringComparison.OrdinalIgnoreCase))
            {
                _color = calendar.Color;
                Colors = ColorOption.PaletteWith(calendar.Color);
                SelectedColor = Colors.FirstOrDefault(c => string.Equals(c.Hex, calendar.Color, StringComparison.OrdinalIgnoreCase));
                OnPropertyChanged(nameof(ColorName));
            }
            IsVisible = calendar.Visible;
            IsReadOnly = !calendar.IsWritable;
            var (text, status, tryAgain, folder) = StatusOf(calendar, now, refreshing, offline);
            StatusText = text;
            Status = status;
            CanTryAgain = tryAgain;
            CanOpenFolder = folder && _pane.Store.Folder is not null;
            OnPropertyChanged(nameof(AccessibleName));
            OnPropertyChanged(nameof(SettingsName));
        }
        finally
        {
            _updating = false;
        }
    }

    /// <summary>The status line of §2.16 for a calendar.</summary>
    internal static (string? Text, CalendarRowStatus Status, bool TryAgain, bool OpenFolder) StatusOf(CalendarState calendar, DateTimeOffset now, bool refreshing, bool offline)
    {
        if (!calendar.IsSubscription)
        {
            return calendar.Notice switch
            {
                CalendarNotice.Recovered => (EventStrings.StoreRecovered(calendar.Name), CalendarRowStatus.Plain, false, true),
                CalendarNotice.Unreadable => (EventStrings.StoreUnreadable(calendar.Name), CalendarRowStatus.Plain, false, true),
                CalendarNotice.Reloaded => (EventStrings.StoreReloaded(calendar.Name), CalendarRowStatus.Plain, false, true),
                _ => (null, CalendarRowStatus.None, false, false),
            };
        }
        if (calendar.Notice is CalendarNotice.Unreadable) return (EventStrings.StoreUnreadable(calendar.Name), CalendarRowStatus.Plain, false, true);
        if (refreshing) return (EventStrings.Updating, CalendarRowStatus.Updating, false, false);
        var subscription = calendar.Record.Subscription;
        switch (subscription?.LastError)
        {
            case "feed-empty":
                return (EventStrings.FeedEmpty, CalendarRowStatus.Warning, true, false);
            case "feed-partial":
                return (EventStrings.FeedPartial, CalendarRowStatus.Warning, true, false);
            case { } error when !offline && EventStrings.SubscribeError(error) is { } reason:
                return (EventStrings.UpdateFailed(reason), CalendarRowStatus.Error, true, false);
        }
        var last = StoreTime.Parse(subscription?.LastSuccessAt);
        if (last is null) return (null, CalendarRowStatus.None, false, false);
        var text = EventStrings.Updated(Phrasing.WithoutDashes(EventStrings.Ago(now - last.Value)));
        return SubscriptionService.IsStale(calendar.Record, now)
            ? (text, CalendarRowStatus.Warning, false, false)
            : (text, CalendarRowStatus.Plain, false, false);
    }
}
