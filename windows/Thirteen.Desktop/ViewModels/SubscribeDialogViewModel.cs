using Avalonia.Media;
using Avalonia.Media.Immutable;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>A palette color in a picker.</summary>
/// <param name="Hex"><c>#rrggbb</c>.</param>
/// <param name="Name">Its name (§2.19 <c>calendars.colors</c>), the accessible name of its swatch.</param>
public sealed record ColorOption(string Hex, string Name)
{
    /// <summary>The swatch's brush.</summary>
    public IBrush Brush { get; } = new ImmutableSolidColorBrush(Color.Parse(Hex));

    /// <summary>The palette (§3.6).</summary>
    public static IReadOnlyList<ColorOption> Palette { get; } =
        CalendarPalette.Colors.Select((hex, i) => new ColorOption(hex, CalendarPalette.Names[i])).ToArray();

    /// <summary>The palette, plus <paramref name="current"/> first when it is not a palette color.</summary>
    public static IReadOnlyList<ColorOption> PaletteWith(string current) =>
        Palette.Any(c => string.Equals(c.Hex, current, StringComparison.OrdinalIgnoreCase))
            ? Palette
            : [new ColorOption(current.ToLowerInvariant(), current.ToUpperInvariant()), .. Palette];
}

/// <summary>An update interval in the "Update" picker.</summary>
/// <param name="Value">A <see cref="SubscriptionIntervals"/> value.</param>
/// <param name="Label">"Every hour", ... "Manually" (§2.19 <c>subscribe.update.options</c>).</param>
public sealed record IntervalOption(string Value, string Label)
{
    /// <summary>The options in picker order.</summary>
    public static IReadOnlyList<IntervalOption> All { get; } =
        SubscriptionIntervals.All.Select((value, i) => new IntervalOption(value, SubscriptionIntervals.Labels[i])).ToArray();

    /// <inheritdoc />
    public override string ToString() => Label;
}

/// <summary>
/// The Subscribe dialog (docs/EVENTS.md §2.17 "Subscribe", board D2): the link, "Subscribe" fetches it ("Checking the
/// link"), errors inline under the field; on success "{name}: {n} events" with Name, Color and Update, and the second
/// "Subscribe" adds it. A prefilled link (<c>webcal://</c>, <c>thirteen://subscribe?url=</c>) is never fetched until
/// the user presses Subscribe.
/// </summary>
public sealed partial class SubscribeDialogViewModel : ViewModelBase
{
    private readonly SubscriptionService _service;
    private readonly IEventStore _store;
    private string _link;
    private string? _error;
    private bool _isChecking;
    private FeedCheck? _found;
    private string _name = "";
    private ColorOption _color;
    private IntervalOption _interval;
    private bool _isSubscribing;
    private CancellationTokenSource? _checking;

    /// <summary>The dialog, with <paramref name="link"/> prefilled.</summary>
    public SubscribeDialogViewModel(SubscriptionService service, IEventStore store, string? link = null)
    {
        _service = service ?? throw new ArgumentNullException(nameof(service));
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _link = link ?? "";
        var next = CalendarPalette.NextFree(store.Calendars.Select(c => c.Color));
        _color = Colors.First(c => c.Hex == next);
        _interval = Intervals[1];
        SubscribeCommand = new AsyncRelayCommand(SubscribeAsync, () => !_isChecking && !_isSubscribing);
        CancelCommand = new RelayCommand(Cancel);
    }

    /// <summary>"Subscribe to a calendar", or "{name}: {n} events" once found.</summary>
    public string Title => _found is null ? EventStrings.SubscribeTitle : EventStrings.SubscribeFound(_found.SuggestedName, _found.EventCount);

    /// <summary>The window's title: "Subscribe to a calendar".</summary>
    public string WindowTitle => EventStrings.SubscribeTitle;

    /// <summary>"Calendar link".</summary>
    public string LinkLabel => EventStrings.SubscribeLink;

    /// <summary>"webcal:// or https:// link".</summary>
    public string Placeholder => EventStrings.SubscribePlaceholder;

    /// <summary>The help text.</summary>
    public string Help => EventStrings.SubscribeHelp;

    /// <summary>"Checking the link".</summary>
    public string CheckingText => EventStrings.SubscribeChecking;

    /// <summary>"Subscribe".</summary>
    public string SubscribeText => EventStrings.SubscribeButton;

    /// <summary>"Cancel".</summary>
    public string CancelText => EventStrings.Cancel;

    /// <summary>"Name".</summary>
    public string NameLabel => EventStrings.Name;

    /// <summary>"Color".</summary>
    public string ColorLabel => EventStrings.Color;

    /// <summary>"Update".</summary>
    public string UpdateLabel => EventStrings.SubscribeUpdate;

    /// <summary>"This link isn't encrypted. ..."</summary>
    public string HttpWarning => EventStrings.SubscribeWarningHttp;

    /// <summary>The link field (user text).</summary>
    public string Link
    {
        get => _link;
        set
        {
            if (!SetProperty(ref _link, value)) return;
            Error = null;
        }
    }

    /// <summary>The inline error under the field, or null.</summary>
    public string? Error
    {
        get => _error;
        private set
        {
            if (!SetProperty(ref _error, value)) return;
            OnPropertyChanged(nameof(HasError));
            OnPropertyChanged(nameof(ShowFoundError));
        }
    }

    /// <summary>An error is shown.</summary>
    public bool HasError => _error is not null;

    /// <summary>Adding the found subscription failed: the error under the fields.</summary>
    public bool ShowFoundError => _found is not null && _error is not null;

    /// <summary>"Checking the link" with a spinner.</summary>
    public bool IsChecking
    {
        get => _isChecking;
        private set
        {
            if (!SetProperty(ref _isChecking, value)) return;
            SubscribeCommand.NotifyCanExecuteChanged();
        }
    }

    /// <summary>The link was read: the Name, Color and Update fields are shown.</summary>
    public bool IsFound => _found is not null;

    /// <summary>The link field is shown.</summary>
    public bool IsEntering => _found is null;

    /// <summary>The found feed came over http (<c>subscribe.warning.http</c>).</summary>
    public bool ShowHttpWarning => _found?.IsUnencrypted ?? false;

    /// <summary>The name (default <c>X-WR-CALNAME</c>, else the host name).</summary>
    public string Name
    {
        get => _name;
        set => SetProperty(ref _name, value);
    }

    /// <summary>The palette.</summary>
    public IReadOnlyList<ColorOption> Colors { get; } = ColorOption.Palette;

    /// <summary>The chosen color (default: the next free palette color).</summary>
    public ColorOption SelectedColor
    {
        get => _color;
        set => SetProperty(ref _color, value ?? _color);
    }

    /// <summary>The update options.</summary>
    public IReadOnlyList<IntervalOption> Intervals { get; } = IntervalOption.All;

    /// <summary>The chosen interval (default from the feed, else every 6 hours).</summary>
    public IntervalOption SelectedInterval
    {
        get => _interval;
        set => SetProperty(ref _interval, value ?? _interval);
    }

    /// <summary>"Subscribe": checks the link, then (once found) subscribes.</summary>
    public AsyncRelayCommand SubscribeCommand { get; }

    /// <summary>"Cancel".</summary>
    public RelayCommand CancelCommand { get; }

    /// <summary>The dialog is done: the new subscription, or null when cancelled.</summary>
    public event Action<CalendarState?>? Finished;

    private async Task SubscribeAsync()
    {
        if (_found is null)
        {
            await CheckAsync();
            return;
        }
        _isSubscribing = true;
        SubscribeCommand.NotifyCanExecuteChanged();
        try
        {
            var state = await _service.SubscribeAsync(_found, _name, _color.Hex, _interval.Value);
            Finished?.Invoke(state);
        }
        catch (EventStoreException e)
        {
            Error = EventStrings.SubscribeError(e.Failure == StoreFailure.TooLarge ? "subscribe.error.tooLarge" : "subscribe.error.unreachable");
            System.Diagnostics.Trace.WriteLine($"Thirteen: could not add the subscription: {e.Message}");
        }
        finally
        {
            _isSubscribing = false;
            SubscribeCommand.NotifyCanExecuteChanged();
        }
    }

    private async Task CheckAsync()
    {
        Error = null;
        IsChecking = true;
        _checking = new CancellationTokenSource();
        try
        {
            var check = await _service.CheckAsync(_link, _checking.Token);
            if (check.Error is { } error)
            {
                Error = EventStrings.SubscribeError(error);
                return;
            }
            _found = check;
            Name = check.SuggestedName;
            SelectedInterval = Intervals.FirstOrDefault(i => i.Value == check.SuggestedInterval) ?? Intervals[1];
            OnPropertyChanged(nameof(IsFound));
            OnPropertyChanged(nameof(IsEntering));
            OnPropertyChanged(nameof(ShowFoundError));
            OnPropertyChanged(nameof(ShowHttpWarning));
            OnPropertyChanged(nameof(Title));
        }
        catch (OperationCanceledException)
        {
            // Cancelled with the dialog.
        }
        finally
        {
            IsChecking = false;
        }
    }

    private void Cancel()
    {
        CancelChecking();
        Finished?.Invoke(null);
    }

    /// <summary>Stops a check in progress (the dialog closed).</summary>
    public void CancelChecking() => _checking?.Cancel();
}

/// <summary>
/// A calendar's settings (§2.15, the info button): name and color; for subscriptions the link, the update interval,
/// "Update now" and "Unsubscribe"; for local calendars "Export" and "Delete calendar". Changes apply at once.
/// </summary>
public sealed partial class CalendarSettingsViewModel : ViewModelBase
{
    private readonly IEventStore _store;
    private readonly SubscriptionService? _subscriptions;
    private string _name;
    private ColorOption _color;
    private IntervalOption _interval;
    private readonly Action<string>? _export;

    /// <summary>
    /// The settings of <paramref name="calendarId"/>. <paramref name="export"/> exports one calendar (the Export flow,
    /// task W8); without it the Export button is disabled.
    /// </summary>
    public CalendarSettingsViewModel(IEventStore store, SubscriptionService? subscriptions, string calendarId, Action<string>? export = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _subscriptions = subscriptions;
        _export = export;
        Id = calendarId;
        var calendar = store.Find(calendarId) ?? throw new ArgumentException($"No calendar {calendarId}", nameof(calendarId));
        _name = calendar.Name;
        Colors = ColorOption.PaletteWith(calendar.Color);
        _color = Colors.First(c => string.Equals(c.Hex, calendar.Color, StringComparison.OrdinalIgnoreCase));
        IsSubscription = calendar.IsSubscription;
        Link = calendar.Record.Subscription?.Url ?? "";
        _interval = Intervals.FirstOrDefault(i => i.Value == calendar.Record.Subscription?.Interval) ?? Intervals[1];
        EventCount = calendar.EventCount;
        UpdateNowCommand = new AsyncRelayCommand(UpdateNowAsync, () => _subscriptions is not null);
        UnsubscribeCommand = new AsyncRelayCommand(UnsubscribeAsync);
        DeleteCommand = new AsyncRelayCommand(DeleteAsync);
        ExportCommand = new RelayCommand(() => _export?.Invoke(Id), () => _export is not null);
        CloseCommand = new AsyncRelayCommand(CloseAsync);
    }

    /// <summary>The calendar id.</summary>
    public string Id { get; }

    /// <summary>The events in it.</summary>
    public int EventCount { get; }

    /// <summary>A subscription.</summary>
    public bool IsSubscription { get; }

    /// <summary>A local calendar.</summary>
    public bool IsLocal => !IsSubscription;

    /// <summary>"Calendar settings" (the window's title).</summary>
    public string Title => EventStrings.CalendarSettings;

    /// <summary>"Name".</summary>
    public string NameLabel => EventStrings.Name;

    /// <summary>"Color".</summary>
    public string ColorLabel => EventStrings.Color;

    /// <summary>"Calendar link".</summary>
    public string LinkLabel => EventStrings.SubscribeLink;

    /// <summary>"Update".</summary>
    public string UpdateLabel => EventStrings.SubscribeUpdate;

    /// <summary>"Update now".</summary>
    public string UpdateNowText => EventStrings.UpdateNow;

    /// <summary>"Unsubscribe".</summary>
    public string UnsubscribeText => EventStrings.Unsubscribe;

    /// <summary>"Export".</summary>
    public string ExportText => EventStrings.Export;

    /// <summary>"Delete calendar".</summary>
    public string DeleteText => EventStrings.DeleteCalendar;

    /// <summary>"Close".</summary>
    public string CloseText => EventStrings.Close;

    /// <summary>The name field (user text).</summary>
    public string Name
    {
        get => _name;
        set => SetProperty(ref _name, value);
    }

    /// <summary>The palette (with the calendar's own color first when it is not in it).</summary>
    public IReadOnlyList<ColorOption> Colors { get; }

    /// <summary>The color; applies at once.</summary>
    public ColorOption SelectedColor
    {
        get => _color;
        set
        {
            if (value is null || !SetProperty(ref _color, value)) return;
            _ = Apply(r => r with { Color = value.Hex });
        }
    }

    /// <summary>The subscription's link (user text, shown as is).</summary>
    public string Link { get; }

    /// <summary>The update options.</summary>
    public IReadOnlyList<IntervalOption> Intervals { get; } = IntervalOption.All;

    /// <summary>The update interval; applies at once.</summary>
    public IntervalOption SelectedInterval
    {
        get => _interval;
        set
        {
            if (value is null || !SetProperty(ref _interval, value) || !IsSubscription) return;
            _ = Apply(r => r with { Subscription = r.Subscription! with { Interval = value.Value } });
        }
    }

    /// <summary>"Update now".</summary>
    public AsyncRelayCommand UpdateNowCommand { get; }

    /// <summary>"Unsubscribe" (asks first).</summary>
    public AsyncRelayCommand UnsubscribeCommand { get; }

    /// <summary>"Delete calendar" (asks first).</summary>
    public AsyncRelayCommand DeleteCommand { get; }

    /// <summary>"Export" (one calendar).</summary>
    public RelayCommand ExportCommand { get; }

    /// <summary>Close: stores the name.</summary>
    public AsyncRelayCommand CloseCommand { get; }

    /// <summary>Asks a question (message, action label); true to go ahead. Set by the view.</summary>
    public Func<string, string, Task<bool>>? Confirm { get; set; }

    /// <summary>The dialog should close.</summary>
    public event Action? Finished;

    private async Task Apply(Func<CalendarRecord, CalendarRecord> change)
    {
        try
        {
            await _store.UpdateRecordAsync(Id, change);
        }
        catch (EventStoreException e)
        {
            System.Diagnostics.Trace.WriteLine($"Thirteen: could not change calendar {Id}: {e.Message}");
        }
    }

    private async Task UpdateNowAsync()
    {
        if (_subscriptions is not null) await _subscriptions.RefreshAsync(Id);
    }

    private async Task UnsubscribeAsync()
    {
        var name = _store.Find(Id)?.Name ?? _name;
        if (Confirm is null || !await Confirm(EventStrings.UnsubscribeMessage(name), EventStrings.Unsubscribe)) return;
        await _store.DeleteCalendarAsync(Id);
        Finished?.Invoke();
    }

    private async Task DeleteAsync()
    {
        var calendar = _store.Find(Id);
        var name = calendar?.Name ?? _name;
        if (Confirm is null || !await Confirm(EventStrings.DeleteCalendarMessage(name, calendar?.EventCount ?? EventCount), EventStrings.DeleteCalendar)) return;
        await _store.DeleteCalendarAsync(Id);
        Finished?.Invoke();
    }

    private async Task CloseAsync()
    {
        var name = _name.Trim();
        if (name.Length > 0 && _store.Find(Id) is { } calendar && calendar.Name != name) await Apply(r => r with { Name = name });
        Finished?.Invoke();
    }
}

/// <summary>"New calendar" (§2.15 footer): a name and a color (the next free palette color), "Cancel" and "Save".</summary>
public sealed partial class NewCalendarViewModel : ViewModelBase
{
    private readonly IEventStore _store;
    private string _name = "";
    private ColorOption _color;
    private bool _busy;

    /// <summary>The dialog over <paramref name="store"/>.</summary>
    public NewCalendarViewModel(IEventStore store)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        var next = CalendarPalette.NextFree(store.Calendars.Select(c => c.Color));
        _color = Colors.First(c => c.Hex == next);
        SaveCommand = new AsyncRelayCommand(SaveAsync, () => !_busy && _name.Trim().Length > 0);
        CancelCommand = new RelayCommand(() => Finished?.Invoke(null));
    }

    /// <summary>"New calendar".</summary>
    public string Title => EventStrings.NewCalendar;

    /// <summary>"Name".</summary>
    public string NameLabel => EventStrings.Name;

    /// <summary>"Color".</summary>
    public string ColorLabel => EventStrings.Color;

    /// <summary>"Save".</summary>
    public string SaveText => EventStrings.Save;

    /// <summary>"Cancel".</summary>
    public string CancelText => EventStrings.Cancel;

    /// <summary>The name (user text).</summary>
    public string Name
    {
        get => _name;
        set
        {
            if (SetProperty(ref _name, value)) SaveCommand.NotifyCanExecuteChanged();
        }
    }

    /// <summary>The palette.</summary>
    public IReadOnlyList<ColorOption> Colors { get; } = ColorOption.Palette;

    /// <summary>The color.</summary>
    public ColorOption SelectedColor
    {
        get => _color;
        set => SetProperty(ref _color, value ?? _color);
    }

    /// <summary>"Save": creates the calendar.</summary>
    public AsyncRelayCommand SaveCommand { get; }

    /// <summary>"Cancel".</summary>
    public RelayCommand CancelCommand { get; }

    /// <summary>The dialog is done: the new calendar, or null when cancelled or it could not be created.</summary>
    public event Action<CalendarState?>? Finished;

    private async Task SaveAsync()
    {
        var name = _name.Trim();
        if (name.Length == 0) return;
        _busy = true;
        SaveCommand.NotifyCanExecuteChanged();
        try
        {
            Finished?.Invoke(await _store.CreateCalendarAsync(name, _color.Hex));
        }
        catch (EventStoreException e)
        {
            System.Diagnostics.Trace.WriteLine($"Thirteen: could not create the calendar: {e.Message}");
            Finished?.Invoke(null);
        }
        finally
        {
            _busy = false;
            SaveCommand.NotifyCanExecuteChanged();
        }
    }
}
