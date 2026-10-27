using System.Diagnostics;

namespace Thirteen.Desktop.Services;

/// <summary>
/// The events services of one app run (docs/EVENTS.md §6.4): the store, the pending moves and deletes, and the
/// subscriptions. Created once by <see cref="App"/> for a real run (the UI tests build their own over temp folders
/// or <see cref="FakeEventStore"/>, so they never touch <c>%LOCALAPPDATA%</c>).
/// </summary>
public sealed class EventsHost : IDisposable
{
    private readonly bool _refreshes;
    private bool _disposed;

    /// <summary>A host over <paramref name="store"/>. <paramref name="refreshes"/>: subscriptions update on their schedule.</summary>
    public EventsHost(EventStoreBase store, SubscriptionService subscriptions, bool refreshes, AlertScheduler? alerts = null, DeviceZoneMonitor? zoneMonitor = null)
    {
        Store = store ?? throw new ArgumentNullException(nameof(store));
        Subscriptions = subscriptions ?? throw new ArgumentNullException(nameof(subscriptions));
        Pending = new PendingChanges(store, store.Clock);
        _refreshes = refreshes;
        Alerts = alerts;
        _zoneMonitor = zoneMonitor;
    }

    private readonly DeviceZoneMonitor? _zoneMonitor;

    /// <summary>
    /// The alert toasts of a normal run (§2.14, §6.4; task W9), or null: QA, screenshot and <c>--fake-events</c> runs never
    /// schedule toasts.
    /// </summary>
    public AlertScheduler? Alerts { get; }

    /// <summary>
    /// On the window's clock timer and on activation (§6.4 "Time zone"): when the device's time zone or its offset
    /// changed, the occurrences are expanded again and the alert schedule rebuilt. Returns true on a change.
    /// </summary>
    public bool CheckDeviceZone()
    {
        if (_zoneMonitor is null || _disposed || !_zoneMonitor.Check()) return false;
        Trace.WriteLine("Thirteen: the device time zone changed; occurrences and alerts are built again");
        Store.DeviceZoneChanged();
        Alerts?.DeviceZoneChanged();
        return true;
    }

    /// <summary>
    /// The services for a run with <paramref name="options"/>: <c>--fake-events</c> gives the mockup data set in memory
    /// (no refreshes, nothing written); a QA run reads the stored calendars without writing, locking or refreshing; a
    /// normal run uses <c>%LOCALAPPDATA%\Thirteen\Calendars</c>. <paramref name="accentColor"/> is the color of a new
    /// "Personal" (§2.16: the theme accent).
    /// </summary>
    public static EventsHost Create(LaunchOptions options, string? accentColor)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (options.FakeEvents)
        {
            var fake = new FakeEventStore();
            return new EventsHost(fake, new SubscriptionService(fake, time: fake.Clock), refreshes: false);
        }
        var store = new EventStore(readOnly: options.IsReadOnly) { DefaultColor = accentColor };
        // Toasts only for a normal run: a QA run must not touch the schedule of the Thirteen the user runs.
        var alerts = options.IsReadOnly ? null : new AlertScheduler(store, ToastPlatform.Create());
        return new EventsHost(store, new SubscriptionService(store), refreshes: !options.IsReadOnly, alerts, new DeviceZoneMonitor());
    }

    /// <summary>The store.</summary>
    public EventStoreBase Store { get; }

    /// <summary>The subscriptions (refreshes, the Subscribe dialog's check).</summary>
    public SubscriptionService Subscriptions { get; }

    /// <summary>The pending moves and deletes (§2.11).</summary>
    public PendingChanges Pending { get; }

    /// <summary>Why the store could not be loaded (another Thirteen holds the folder, or it cannot be created), or null.</summary>
    public EventStoreException? LoadError { get; private set; }

    /// <summary>Loads every calendar on a background thread, then starts the subscription schedule (refresh of due feeds 10 s later).</summary>
    public async Task StartAsync()
    {
        try
        {
            await Store.LoadAsync().ConfigureAwait(false);
        }
        catch (EventStoreException e)
        {
            LoadError = e;
            Trace.WriteLine($"Thirteen: the calendars could not be loaded ({e.Failure}): {e.Message}");
            return;
        }
        if (_refreshes && !_disposed) Subscriptions.Start();
        if (!_disposed) Alerts?.Start();
    }

    /// <summary>Window close and app exit: writes the pending changes and waits for them (§2.11).</summary>
    public Task CloseAsync() => Pending.Pending.Count == 0 ? Task.CompletedTask : Pending.CloseAsync();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Subscriptions.Dispose();
        Alerts?.Dispose();
        Pending.Dispose();
        if (Store is IDisposable disposable) disposable.Dispose();
    }
}
