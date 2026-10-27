using System.Collections.Concurrent;
using System.Diagnostics;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;

namespace Thirteen.Desktop.Services;

/// <summary>
/// What <see cref="EventStore"/> (files) and <see cref="FakeEventStore"/> (memory) share: the calendars and their
/// documents, one write queue per calendar for every writer (§3.6, §6.4), read-modify-write of one UID group with the
/// others copied raw, the index with its own queue, and the per-year occurrence cache (§6.4). Subclasses store the
/// documents and the index.
/// </summary>
public abstract class EventStoreBase : IEventStore
{
    /// <summary>One calendar. Fields change only inside <see cref="Queue"/> (documents) or under the store's gate (records).</summary>
    protected sealed class Entry(CalendarRecord record)
    {
        /// <summary>The calendar's write queue: every writer of this calendar waits here (§3.6).</summary>
        public SemaphoreSlim Queue { get; } = new(1, 1);

        /// <summary>The calendars.json record.</summary>
        public CalendarRecord Record { get; set; } = record;

        /// <summary>The document as last read or written; null when unreadable.</summary>
        public IcsCalendar? Document { get; set; }

        /// <summary>What the row says.</summary>
        public CalendarNotice Notice { get; set; }

        /// <summary>SHA-256 of the file as Thirteen last read or wrote it; null when Thirteen expects no file.</summary>
        public string? FileHash { get; set; }

        /// <summary>Removed from the store (a writer that waited in the queue must not write).</summary>
        public bool Removed { get; set; }
    }

    private readonly object _gate = new();
    private readonly SemaphoreSlim _indexQueue = new(1, 1);
    private readonly SemaphoreSlim _loadQueue = new(1, 1);
    private readonly Func<string> _deviceZone;
    private readonly ConcurrentDictionary<(string Calendar, int Year), CachedYear> _years = new();
    private List<Entry> _entries = [];
    private IReadOnlyList<CalendarState> _snapshot = [];
    private List<FailedCommit> _failedCommits = [];
    private List<string> _collapsed = [];
    private volatile bool _loaded;
    private CalendarSystemId _system = CalendarSystemId.Ifc;

    private sealed record CachedYear(IcsCalendar Document, string Zone, CalendarSystemId System, ValueList<IcsExpandedEvent> Events);

    /// <summary>A store over <paramref name="zones"/>, with the device zone from <paramref name="deviceZone"/> (asked on every expansion).</summary>
    protected EventStoreBase(IZoneResolver zones, Func<string> deviceZone, TimeProvider? time)
    {
        Zones = zones ?? throw new ArgumentNullException(nameof(zones));
        _deviceZone = deviceZone ?? throw new ArgumentNullException(nameof(deviceZone));
        Time = time ?? TimeProvider.System;
    }

    /// <summary>The clock (tests replace it).</summary>
    protected TimeProvider Time { get; }

    /// <summary>The store's clock: the system clock, or the data set's fixed "now" for <see cref="FakeEventStore"/>.</summary>
    public TimeProvider Clock => Time;

    /// <inheritdoc />
    public IZoneResolver Zones { get; }

    /// <inheritdoc />
    public string DeviceZone => _deviceZone();

    /// <inheritdoc />
    public CalendarSystemId System
    {
        get => _system;
        set
        {
            if (_system == value) return;
            _system = value;
            RaiseChanged([], documents: true, index: false);
        }
    }

    /// <inheritdoc />
    public bool IsLoaded => _loaded;

    /// <inheritdoc />
    public abstract string? Folder { get; }

    /// <inheritdoc />
    public IReadOnlyList<CalendarState> Calendars => _snapshot;

    /// <inheritdoc />
    public IReadOnlyList<FailedCommit> FailedCommits
    {
        get
        {
            lock (_gate) return _failedCommits.ToArray();
        }
    }

    /// <inheritdoc />
    public IReadOnlyList<string> CollapsedGroups
    {
        get
        {
            lock (_gate) return _collapsed.ToArray();
        }
    }

    /// <inheritdoc />
    public event EventHandler<StoreChangedEventArgs>? Changed;

    /// <inheritdoc />
    public event Action<string>? ReloadedFromDisk;

    /// <inheritdoc />
    public Func<string, Task>? BeforeWrite { get; set; }

    private static readonly AsyncLocal<bool> SkipBeforeWrite = new();

    /// <summary>Writes made inside the returned scope do not call <see cref="BeforeWrite"/> (a pending change's own write).</summary>
    public static IDisposable WithoutBeforeWrite()
    {
        var previous = SkipBeforeWrite.Value;
        SkipBeforeWrite.Value = true;
        return new Scope(() => SkipBeforeWrite.Value = previous);
    }

    private sealed class Scope(Action end) : IDisposable
    {
        public void Dispose() => end();
    }

    /// <summary>Raises <see cref="ReloadedFromDisk"/>.</summary>
    protected void RaiseReloaded(string calendarId)
    {
        try
        {
            ReloadedFromDisk?.Invoke(calendarId);
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            Trace.WriteLine($"Thirteen: a reload handler failed: {e}");
        }
    }

    /// <summary>The current UTC time as an event value (minute precision), for <c>DTSTAMP</c> and <c>LAST-MODIFIED</c>.</summary>
    public LocalDateTime UtcNowValue()
    {
        var now = Time.GetUtcNow().UtcDateTime;
        return new LocalDateTime(new GregorianDate(now.Year, now.Month, now.Day), now.Hour * 60 + now.Minute);
    }

    // ---- Loading ---------------------------------------------------------------------------------

    /// <summary>The index and documents as loaded by a subclass.</summary>
    protected sealed record LoadedStore(IReadOnlyList<Entry> Entries, IReadOnlyList<FailedCommit> FailedCommits, IReadOnlyList<string> Collapsed);

    /// <summary>Reads the index and every document (runs on a background thread).</summary>
    protected abstract LoadedStore LoadStore(CancellationToken cancellationToken);

    /// <summary>Called once loading has finished (the file store starts its watcher here).</summary>
    protected virtual void OnLoaded()
    {
    }

    /// <inheritdoc />
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        await _loadQueue.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_loaded) return;
            var loaded = await Task.Run(() => LoadStore(cancellationToken), cancellationToken).ConfigureAwait(false);
            lock (_gate)
            {
                _entries = [.. loaded.Entries];
                _failedCommits = [.. loaded.FailedCommits];
                _collapsed = [.. loaded.Collapsed];
                PublishLocked();
            }
            _loaded = true;
            OnLoaded();
        }
        finally
        {
            _loadQueue.Release();
        }
        RaiseChanged([], documents: true, index: true);
    }

    // ---- Reading ---------------------------------------------------------------------------------

    /// <inheritdoc />
    public CalendarState? Find(string calendarId)
    {
        foreach (var state in _snapshot)
        {
            if (state.Id == calendarId) return state;
        }
        return null;
    }

    /// <summary>The entry of a calendar, or null.</summary>
    protected Entry? EntryOf(string calendarId)
    {
        lock (_gate) return _entries.FirstOrDefault(e => e.Record.Id == calendarId);
    }

    /// <summary>Every entry (a copy of the list).</summary>
    protected IReadOnlyList<Entry> Entries()
    {
        lock (_gate) return _entries.ToArray();
    }

    /// <inheritdoc />
    public IcsGroup? FindGroup(string calendarId, string uid) =>
        Find(calendarId)?.Document?.Groups.FirstOrDefault(g => g.Uid == uid);

    /// <inheritdoc />
    public IReadOnlyList<IcsExpandedEvent> Occurrences(LocalDateTime from, LocalDateTime to, bool includeHidden = false)
    {
        if (to.CompareTo(from) < 0) throw new ArgumentException("The window ends before it starts", nameof(to));
        var zone = DeviceZone;
        var system = _system;
        var last = to.AddMinutes(-1).Date.Year;
        if (to.CompareTo(from) == 0) last = from.Date.Year;
        var byKey = new Dictionary<string, IcsExpandedEvent>(StringComparer.Ordinal);
        foreach (var state in _snapshot)
        {
            if (state.Document is not { } document || (!state.Visible && !includeHidden)) continue;
            for (var year = from.Date.Year; year <= Math.Max(from.Date.Year, last); year++)
            {
                foreach (var e in YearOf(state.Id, document, year, zone, system))
                {
                    var inWindow = e.Start.CompareTo(e.End) == 0
                        ? e.Start.CompareTo(from) >= 0 && e.Start.CompareTo(to) < 0
                        : e.Start.CompareTo(to) < 0 && e.End.CompareTo(from) > 0;
                    if (inWindow) byKey.TryAdd(e.Key, e);
                }
            }
        }
        var list = byKey.Values.ToList();
        list.Sort((a, b) =>
        {
            var c = a.Start.CompareTo(b.Start);
            return c != 0 ? c : string.CompareOrdinal(a.Key, b.Key);
        });
        return list;
    }

    private ValueList<IcsExpandedEvent> YearOf(string calendarId, IcsCalendar document, int year, string zone, CalendarSystemId system)
    {
        if (_years.TryGetValue((calendarId, year), out var cached)
            && ReferenceEquals(cached.Document, document) && cached.Zone == zone && cached.System == system)
        {
            return cached.Events;
        }
        var from = new LocalDateTime(new GregorianDate(year, 1, 1), 0);
        var to = year == GregorianDate.MaxYear ? new LocalDateTime(new GregorianDate(year, 12, 31), 1440) : new LocalDateTime(new GregorianDate(year + 1, 1, 1), 0);
        ValueList<IcsExpandedEvent> events;
        try
        {
            events = IcsExpansion.EventsFromCalendar(document, zone, Zones, new DeviceWindow(from, to), system, calendarId);
        }
        catch (ThirteenException e)
        {
            Trace.WriteLine($"Thirteen: could not expand calendar {calendarId} for {year}: {e.Message}");
            events = ValueList<IcsExpandedEvent>.Empty;
        }
        _years[(calendarId, year)] = new CachedYear(document, zone, system, events);
        return events;
    }

    /// <summary>Forgets every cached year (the device zone changed).</summary>
    public void ClearOccurrenceCache() => _years.Clear();

    /// <summary>
    /// The device's time zone (or its rules) changed (§6.4 "Time zone"): forgets the cached years and raises
    /// <see cref="Changed"/>, so every view and the alert schedule are built again.
    /// </summary>
    public void DeviceZoneChanged()
    {
        ClearOccurrenceCache();
        RaiseChanged([], documents: true, index: false);
    }

    // ---- Writing documents -----------------------------------------------------------------------

    /// <summary>
    /// The document to change, read inside the calendar's queue: the file store compares the file's hash with the one it
    /// last loaded and reloads a file changed outside Thirteen first (§3.6). Null when the calendar cannot be read.
    /// </summary>
    protected abstract IcsCalendar? CurrentDocument(Entry entry);

    /// <summary>Stores a document's text (the file store: atomic write with <c>.bak</c>). Runs inside the calendar's queue.</summary>
    protected abstract void StoreDocument(Entry entry, string text);

    /// <summary>Stores the index (the file store: calendars.json). Runs inside the index queue.</summary>
    protected abstract void StoreIndex(CalendarIndexDocument index);

    /// <summary>Removes a calendar's stored document (an unreadable one is moved aside, §2.16). Runs inside the calendar's queue.</summary>
    protected abstract void RemoveDocument(Entry entry);

    /// <summary>The store refuses every write (QA and screenshot runs).</summary>
    public virtual bool IsReadOnly => false;

    private void AssertWritable()
    {
        if (IsReadOnly) throw new EventStoreException(StoreFailure.ReadOnly, "This store is read-only (a screenshot or QA run)");
        if (!_loaded) throw new InvalidOperationException("Load the store first");
    }

    /// <inheritdoc />
    public async Task<IcsCalendar> UpdateDocumentAsync(string calendarId, Func<IcsCalendar, IcsCalendar> change, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(change);
        AssertWritable();
        var entry = EntryOf(calendarId) ?? throw new EventStoreException(StoreFailure.NotFound, $"No calendar {calendarId}");
        if (BeforeWrite is { } before && !SkipBeforeWrite.Value) await before(calendarId).ConfigureAwait(false);
        await entry.Queue.WaitAsync(cancellationToken).ConfigureAwait(false);
        IcsCalendar stored;
        bool written;
        try
        {
            (stored, written) = await Task.Run(() => UpdateDocumentLocked(entry, change), cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            entry.Queue.Release();
        }
        if (written) RaiseChanged([calendarId], documents: true, index: false);
        return stored;
    }

    private (IcsCalendar Stored, bool Written) UpdateDocumentLocked(Entry entry, Func<IcsCalendar, IcsCalendar> change)
    {
        if (entry.Removed) throw new EventStoreException(StoreFailure.NotFound, $"Calendar {entry.Record.Id} was deleted");
        if (entry.Record.IsSubscription) throw new EventStoreException(StoreFailure.ReadOnly, $"Calendar {entry.Record.Id} is a subscription");
        var before = entry.Document;
        var current = CurrentDocument(entry);
        if (!ReferenceEquals(before, current)) Publish();
        if (current is null) throw new EventStoreException(StoreFailure.ReadOnly, $"Calendar {entry.Record.Id} could not be read");
        var changed = change(current);
        ArgumentNullException.ThrowIfNull(changed);
        if (ReferenceEquals(changed, current) && ReferenceEquals(before, current)) return (current, false);
        if (ReferenceEquals(changed, current)) return (current, true);
        var stored = WriteLocked(entry, WithRecordFields(changed, entry.Record));
        return (stored, true);
    }

    /// <summary>Serializes, checks the limits, stores and re-reads a document (so its raw texts are the stored ones).</summary>
    private IcsCalendar WriteLocked(Entry entry, IcsCalendar document)
    {
        string text;
        try
        {
            text = IcsWriter.Serialize(document, Zones, UtcNowValue());
        }
        catch (ThirteenException e)
        {
            throw new EventStoreException(StoreFailure.Changed, $"The change cannot be written: {e.Message}", e);
        }
        if (StoreText.EventComponents(document) > StoreText.MaxEvents || (long)text.Length * 3 > StoreText.MaxDocumentBytes
            && global::System.Text.Encoding.UTF8.GetByteCount(text) > StoreText.MaxDocumentBytes)
        {
            throw new EventStoreException(StoreFailure.TooLarge, $"Calendar {entry.Record.Id} would be over 25 MB or 50,000 events");
        }
        StoreDocument(entry, text);
        var stored = IcsReader.Parse(text, entry.Record.Id, Zones);
        entry.Document = stored;
        if (entry.Notice == CalendarNotice.Unreadable) entry.Notice = CalendarNotice.None;
        Publish();
        return stored;
    }

    /// <summary>A local calendar's document carries its record's name, color and id (§3.6).</summary>
    private static IcsCalendar WithRecordFields(IcsCalendar document, CalendarRecord record)
    {
        if (record.IsSubscription) return document;
        var result = document;
        if (result.Name != record.Name || !string.Equals(result.Color, record.Color, StringComparison.OrdinalIgnoreCase))
        {
            result = result with { Name = record.Name, Color = record.Color.ToLowerInvariant() };
        }
        if (!result.Extra.Any(p => p.Name == "X-THIRTEEN-CALENDAR-ID"))
        {
            result = result with { Extra = result.Extra.Append(new IcsProperty("X-THIRTEEN-CALENDAR-ID", record.Id)).ToValueList() };
        }
        return result;
    }

    /// <summary>The empty document of a calendar that has no file yet.</summary>
    protected static IcsCalendar EmptyDocument(CalendarRecord record) =>
        IcsGroups.NewCalendar(record.Id, record.Name.Length > 0 ? record.Name : "Calendar", IcsColorOrDefault(record.Color));

    private static string IcsColorOrDefault(string color) =>
        color.Length == 7 && color[0] == '#' && color.Skip(1).All(Uri.IsHexDigit) ? color.ToLowerInvariant() : CalendarPalette.Colors[0];

    /// <inheritdoc />
    public Task<IcsCalendar> UpdateGroupAsync(string calendarId, string uid, Func<IcsCalendar, IcsGroup?, IcsGroup?> change, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(uid);
        ArgumentNullException.ThrowIfNull(change);
        return UpdateDocumentAsync(calendarId, document =>
        {
            var group = document.Groups.FirstOrDefault(g => g.Uid == uid);
            var updated = change(document, group);
            if (ReferenceEquals(updated, group)) return document;
            if (updated is null || (updated.Master is null && updated.Overrides.Count == 0))
            {
                return group is null ? document : IcsGroups.RemoveGroup(document, uid);
            }
            if (updated.Uid != uid) throw new ArgumentException($"The group must keep UID {uid}", nameof(change));
            return IcsGroups.ReplaceGroup(document, updated);
        }, cancellationToken);
    }

    // ---- Calendars -------------------------------------------------------------------------------

    /// <summary>A new calendar id (a UUID).</summary>
    protected virtual string NewId() => Guid.NewGuid().ToString("D");

    private static readonly HashSet<string> ReservedNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    /// <summary>
    /// A calendar id that is safe as a file name in the Calendars folder (UUIDs and the ids of restored exports): ASCII
    /// letters, digits, '-', '_' and '.', not starting with '.', at most 120 characters, and not a reserved Windows
    /// device name. Every id the store creates or loads passes this, so <c>{id}.ics</c> never names a path outside the folder.
    /// </summary>
    public static bool IsSafeCalendarId(string? id) =>
        id is { Length: > 0 and <= 120 }
        && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.')
        && id[0] != '.'
        && !ReservedNames.Contains(id.Split('.')[0]);

    private static string CheckedId(string? id, Func<string> fresh)
    {
        var value = id ?? fresh();
        if (!IsSafeCalendarId(value)) throw new ArgumentException($"A calendar id must be safe as a file name, got \"{value}\"", nameof(id));
        return value;
    }

    /// <inheritdoc />
    public async Task<CalendarState> CreateCalendarAsync(string name, string? color = null, string? id = null, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        AssertWritable();
        Entry entry;
        lock (_gate)
        {
            id = CheckedId(id, NewId);
            if (_entries.Any(e => e.Record.Id == id)) throw new EventStoreException(StoreFailure.Changed, $"A calendar {id} exists");
            var record = new CalendarRecord
            {
                Id = id,
                Kind = CalendarKinds.Local,
                Name = name.Trim(),
                Color = (color ?? CalendarPalette.NextFree(_entries.Select(e => e.Record.Color))).ToLowerInvariant(),
                Order = NextOrder(CalendarKinds.Local),
                Visible = true,
                CreatedAt = StoreTime.Seconds(Time.GetUtcNow()),
            };
            entry = new Entry(record);
            entry.Document = EmptyDocument(record);
            _entries.Add(entry);
            PublishLocked();
        }
        await SaveIndexAsync(cancellationToken).ConfigureAwait(false);
        RaiseChanged([entry.Record.Id], documents: true, index: true);
        return Find(entry.Record.Id)!;
    }

    /// <inheritdoc />
    public async Task<CalendarState> EnsureLocalCalendarAsync(CancellationToken cancellationToken = default)
    {
        var existing = _snapshot.FirstOrDefault(c => c.IsWritable);
        if (existing is not null) return existing;
        return await CreateCalendarAsync(PersonalName, DefaultColor, cancellationToken: cancellationToken).ConfigureAwait(false);
    }

    /// <summary>"Personal" (§2.19 <c>calendars.personal</c>).</summary>
    public const string PersonalName = "Personal";

    /// <summary>The color of "Personal" when it is created: the theme accent (§2.16); null for the first palette color.</summary>
    public string? DefaultColor { get; set; }

    /// <inheritdoc />
    public async Task<CalendarState> CreateSubscriptionAsync(string name, string color, SubscriptionRecord subscription, string body, string? id = null, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentNullException.ThrowIfNull(subscription);
        ArgumentNullException.ThrowIfNull(body);
        AssertWritable();
        Entry entry;
        lock (_gate)
        {
            id = CheckedId(id, NewId);
            if (_entries.Any(e => e.Record.Id == id)) throw new EventStoreException(StoreFailure.Changed, $"A calendar {id} exists");
            var record = new CalendarRecord
            {
                Id = id,
                Kind = CalendarKinds.Subscription,
                Name = name.Trim(),
                Color = color.ToLowerInvariant(),
                Order = NextOrder(CalendarKinds.Subscription),
                Visible = true,
                CreatedAt = StoreTime.Seconds(Time.GetUtcNow()),
                Subscription = subscription,
            };
            entry = new Entry(record);
        }
        var document = await Task.Run(() => IcsReader.Parse(body, entry.Record.Id, Zones), cancellationToken).ConfigureAwait(false);
        await entry.Queue.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await Task.Run(() => StoreDocument(entry, body), cancellationToken).ConfigureAwait(false);
            entry.Document = document;
            lock (_gate)
            {
                _entries.Add(entry);
                PublishLocked();
            }
        }
        finally
        {
            entry.Queue.Release();
        }
        await SaveIndexAsync(cancellationToken).ConfigureAwait(false);
        RaiseChanged([entry.Record.Id], documents: true, index: true);
        return Find(entry.Record.Id)!;
    }

    private int NextOrder(string kind)
    {
        var orders = _entries.Where(e => e.Record.Kind == kind).Select(e => e.Record.Order).ToList();
        return orders.Count == 0 ? 0 : orders.Max() + 1;
    }

    /// <inheritdoc />
    public async Task DeleteCalendarAsync(string calendarId, CancellationToken cancellationToken = default)
    {
        AssertWritable();
        var entry = EntryOf(calendarId) ?? throw new EventStoreException(StoreFailure.NotFound, $"No calendar {calendarId}");
        await entry.Queue.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (entry.Removed) return;
            await Task.Run(() => RemoveDocument(entry), cancellationToken).ConfigureAwait(false);
            entry.Removed = true;
            lock (_gate)
            {
                _entries.Remove(entry);
                PublishLocked();
            }
            foreach (var key in _years.Keys.Where(k => k.Calendar == calendarId).ToList()) _years.TryRemove(key, out _);
        }
        finally
        {
            entry.Queue.Release();
        }
        await SaveIndexAsync(cancellationToken).ConfigureAwait(false);
        RaiseChanged([calendarId], documents: true, index: true);
    }

    /// <inheritdoc />
    public async Task<CalendarState> UpdateRecordAsync(string calendarId, Func<CalendarRecord, CalendarRecord> change, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(change);
        AssertWritable();
        var entry = EntryOf(calendarId) ?? throw new EventStoreException(StoreFailure.NotFound, $"No calendar {calendarId}");
        bool documentChanged;
        lock (_gate)
        {
            var before = entry.Record;
            var after = change(before) ?? throw new ArgumentException("The change returned no record", nameof(change));
            if (after.Id != before.Id || after.Kind != before.Kind) throw new ArgumentException("A record keeps its id and kind", nameof(change));
            entry.Record = after with { Color = after.Color.ToLowerInvariant() };
            documentChanged = !after.IsSubscription && (after.Name != before.Name || !string.Equals(after.Color, before.Color, StringComparison.OrdinalIgnoreCase));
            if (documentChanged && entry.Document is { } document && entry.FileHash is null)
            {
                // Not written yet: the empty document follows the record until the first event is saved.
                entry.Document = WithRecordFields(document, entry.Record);
            }
            PublishLocked();
        }
        await SaveIndexAsync(cancellationToken).ConfigureAwait(false);
        RaiseChanged([calendarId], documents: false, index: true);
        return Find(calendarId)!;
    }

    /// <inheritdoc />
    public async Task<bool> UpdateSubscriptionAsync(string calendarId, Func<CalendarRecord, SubscriptionUpdate?> decide, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(decide);
        AssertWritable();
        var entry = EntryOf(calendarId) ?? throw new EventStoreException(StoreFailure.NotFound, $"No calendar {calendarId}");
        await entry.Queue.WaitAsync(cancellationToken).ConfigureAwait(false);
        bool stored;
        try
        {
            if (entry.Removed) throw new EventStoreException(StoreFailure.NotFound, $"Calendar {calendarId} was deleted");
            if (!entry.Record.IsSubscription) throw new EventStoreException(StoreFailure.ReadOnly, $"Calendar {calendarId} is not a subscription");
            CalendarRecord current;
            lock (_gate) current = entry.Record;
            var update = decide(current);
            if (update is null) return false;
            if (update.Record.Id != current.Id || !update.Record.IsSubscription) throw new ArgumentException("A subscription keeps its id and kind", nameof(decide));
            stored = update.Body is not null;
            if (update.Body is { } body)
            {
                var document = update.Document ?? await Task.Run(() => IcsReader.Parse(body, calendarId, Zones), cancellationToken).ConfigureAwait(false);
                await Task.Run(() => StoreDocument(entry, body), cancellationToken).ConfigureAwait(false);
                entry.Document = document;
                entry.Notice = CalendarNotice.None;
            }
            lock (_gate)
            {
                // The user may have renamed or recolored it meanwhile: only the subscription part comes from the refresh.
                entry.Record = entry.Record with { Subscription = update.Record.Subscription };
                PublishLocked();
            }
        }
        finally
        {
            entry.Queue.Release();
        }
        await SaveIndexAsync(cancellationToken).ConfigureAwait(false);
        RaiseChanged([calendarId], documents: stored, index: true);
        return stored;
    }

    /// <inheritdoc />
    public async Task SetCollapsedAsync(string group, bool collapsed, CancellationToken cancellationToken = default)
    {
        AssertWritable();
        lock (_gate)
        {
            _collapsed.Remove(group);
            if (collapsed) _collapsed.Add(group);
        }
        await SaveIndexAsync(cancellationToken).ConfigureAwait(false);
        RaiseChanged([], documents: false, index: true);
    }

    /// <inheritdoc />
    public async Task AddFailedCommitsAsync(IReadOnlyList<FailedCommit> failures, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(failures);
        if (failures.Count == 0) return;
        AssertWritable();
        lock (_gate) _failedCommits.AddRange(failures);
        await SaveIndexAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task ClearFailedCommitsAsync(CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            if (_failedCommits.Count == 0) return;
            _failedCommits.Clear();
        }
        if (IsReadOnly) return;
        await SaveIndexAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Writes the index as it is now (every record change before this call is in it).</summary>
    protected async Task SaveIndexAsync(CancellationToken cancellationToken)
    {
        if (IsReadOnly) return;
        await _indexQueue.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var index = CurrentIndex();
            await Task.Run(() => StoreIndex(index), cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _indexQueue.Release();
        }
    }

    /// <summary>The index as it is in memory.</summary>
    protected CalendarIndexDocument CurrentIndex()
    {
        lock (_gate)
        {
            return new CalendarIndexDocument
            {
                Version = 1,
                Calendars = Ordered(_entries).Select(e => e.Record).ToArray(),
                FailedCommits = _failedCommits.Count == 0 ? null : _failedCommits.ToArray(),
                CollapsedGroups = _collapsed.Count == 0 ? null : _collapsed.ToArray(),
            };
        }
    }

    // ---- Snapshots and notifications --------------------------------------------------------------

    private static IEnumerable<Entry> Ordered(IEnumerable<Entry> entries) =>
        entries.OrderBy(e => e.Record.IsSubscription ? 1 : 0).ThenBy(e => e.Record.Order).ThenBy(e => e.Record.CreatedAt, StringComparer.Ordinal);

    /// <summary>Publishes a new snapshot of the calendars.</summary>
    protected void Publish()
    {
        lock (_gate) PublishLocked();
    }

    private void PublishLocked() =>
        _snapshot = Ordered(_entries).Select(e => new CalendarState(e.Record, e.Document, e.Notice)).ToArray();

    /// <summary>Raises <see cref="Changed"/> (handlers' exceptions are logged, never thrown into the writer).</summary>
    protected void RaiseChanged(IReadOnlyList<string> calendarIds, bool documents, bool index)
    {
        var handler = Changed;
        if (handler is null) return;
        try
        {
            handler(this, new StoreChangedEventArgs(calendarIds, documents, index));
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            Trace.WriteLine($"Thirteen: a store change handler failed: {e}");
        }
    }
}
