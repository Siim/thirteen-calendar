using System.Diagnostics;
using Avalonia.Media;
using Avalonia.Threading;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// The events of one window as the views read them (docs/EVENTS.md §6.4): the store's occurrences for a range of days as
/// <see cref="CalendarItem"/>s, the device's "now", whether the store has loaded or failed, and one
/// <see cref="Changed"/> notification on the UI thread after every change of the store. Every events view (the Calendar
/// modes, and Today's Up next and the day details, tasks W9) reads through this one object, which
/// <see cref="MainViewModel.AttachEvents"/> creates once the window has its <see cref="EventsHost"/>.
/// </summary>
public sealed class EventsModel : IDisposable
{
    private readonly Action<Action> _post;
    private bool _disposed;
    private bool _loadFailed;

    /// <summary>
    /// The events over <paramref name="store"/>. Store events (raised on background threads) reach <see cref="Changed"/>
    /// through <paramref name="post"/>, the UI thread's queue by default (tests run them at once).
    /// </summary>
    public EventsModel(IEventStore store, SubscriptionService? subscriptions = null, PendingChanges? pending = null, Action<Action>? post = null)
    {
        Store = store ?? throw new ArgumentNullException(nameof(store));
        Subscriptions = subscriptions;
        Pending = pending;
        _post = post ?? (action => Dispatcher.UIThread.Post(action));
        Store.Changed += OnStoreChanged;
        // Held moves and deletes show at once (§2.11), so the views refresh when one is held, undone, written or reverted.
        if (Pending is not null) Pending.Changed += OnPendingChanged;
        _ = WatchLoadAsync();
    }

    /// <summary>The store (local calendars and subscriptions, or the mockup data set).</summary>
    public IEventStore Store { get; }

    /// <summary>The subscriptions (refresh with F5), or null.</summary>
    public SubscriptionService? Subscriptions { get; }

    /// <summary>The pending moves and deletes (§2.11), or null in tests that do not need them.</summary>
    public PendingChanges? Pending { get; }

    /// <summary>Raised on the UI thread after the store changed (documents, records or the first load).</summary>
    public event EventHandler? Changed;

    /// <summary>Counts the changes seen (views compare it to skip work).</summary>
    public int Revision { get; private set; }

    /// <summary>The store's clock: the system clock, or the mockup data set's fixed "now".</summary>
    public TimeProvider Clock => (Store as EventStoreBase)?.Clock ?? TimeProvider.System;

    /// <summary>Whether the store has loaded.</summary>
    public bool IsLoaded => Store.IsLoaded;

    /// <summary>Whether the calendars could not be read (§2.4 "Error reading events").</summary>
    public bool LoadFailed => _loadFailed;

    /// <summary>Whether there are calendars and every one of them is hidden (§2.4 "Every calendar hidden").</summary>
    public bool AllHidden => Store.Calendars.Count > 0 && Store.Calendars.All(c => !c.Visible);

    /// <summary>Whether a local calendar holds an event or a subscription exists (§2.8: Today shows Up next from then on).</summary>
    public bool HasUserEvents => Store.Calendars.Any(c => c.IsSubscription || c.EventCount > 0);

    /// <summary>Loads the store again after a failure ("Try again").</summary>
    public Task RetryLoadAsync() => WatchLoadAsync();

    private async Task WatchLoadAsync()
    {
        try
        {
            await Store.LoadAsync().ConfigureAwait(false);
            // Always once after the load (the views waiting for it, the toolbar's loading indicator), even when the
            // store loaded before this model existed and raises nothing more.
            _loadFailed = false;
            RaiseLater();
        }
        catch (EventStoreException e)
        {
            Trace.WriteLine($"Thirteen: the calendars could not be loaded ({e.Failure}): {e.Message}");
            _loadFailed = true;
            RaiseLater();
        }
    }

    private void OnStoreChanged(object? sender, StoreChangedEventArgs e) => RaiseLater();

    private void OnPendingChanged() => RaiseLater();

    private void RaiseLater() => _post(() =>
    {
        if (_disposed) return;
        Revision++;
        Changed?.Invoke(this, EventArgs.Empty);
    });

    /// <summary>The device's wall clock now (the store's clock in its device zone; the mockup's 2026-10-19T09:41 for the fake store).</summary>
    public LocalDateTime Now()
    {
        var utc = Clock.GetUtcNow().UtcDateTime;
        var value = new LocalDateTime(new GregorianDate(utc.Year, utc.Month, utc.Day), utc.Hour * 60 + utc.Minute);
        return ZoneMath.ToZoned(value, Store.DeviceZone, Store.Zones) ?? value;
    }

    /// <summary>
    /// The occurrences of the visible calendars that touch the days <paramref name="first"/> to <paramref name="last"/>
    /// (inclusive), sorted by start, then key, with the pending moves and deletes applied (§2.11: they change the views at
    /// once and are written later). Empty before the store has loaded.
    /// </summary>
    public IReadOnlyList<CalendarItem> Items(GregorianDate first, GregorianDate last)
    {
        if (!Store.IsLoaded || last < first) return [];
        var from = new LocalDateTime(first, 0);
        var to = new LocalDateTime(last, 1440);
        IEnumerable<IcsExpandedEvent> occurrences = Store.Occurrences(from, to);
        var pending = Pending?.Pending.Where(p => p.State is PendingState.Pending or PendingState.Writing).ToArray() ?? [];
        if (pending.Length > 0) occurrences = WithPending(occurrences, pending, from, to);
        var calendars = Store.Calendars.ToDictionary(c => c.Id, StringComparer.Ordinal);
        return occurrences.Select(o => new CalendarItem(o, calendars.GetValueOrDefault(o.CalendarId))).ToList();
    }

    /// <summary>
    /// The occurrences of a range with pending changes applied: a delete removes its occurrence, a move puts it at its new
    /// times (and into a range it was not in before, or out of one). The key stays the same, so selection and focus follow.
    /// </summary>
    private IEnumerable<IcsExpandedEvent> WithPending(IEnumerable<IcsExpandedEvent> occurrences, IReadOnlyList<PendingChange> pending, LocalDateTime from, LocalDateTime to)
    {
        var list = occurrences.ToList();
        foreach (var change in pending)
        {
            var calendar = Store.Find(change.CalendarId);
            if (calendar is { Visible: false }) continue;
            list.RemoveAll(o => o.Key == change.Key && o.CalendarId == change.CalendarId);
            if (change.Kind != PendingKind.Move || change.NewStart is not { } start || change.NewEnd is not { } end) continue;
            // Touches the range: starts before its end and ends after its start (a zero-length one at its start).
            var touches = start.CompareTo(to) < 0 && (end.CompareTo(from) > 0 || (end.CompareTo(start) == 0 && start.CompareTo(from) >= 0));
            if (!touches) continue;
            var allDay = change.IsAllDay;
            list.Add(change.Occurrence with
            {
                Start = start,
                End = end,
                AllDay = allDay,
                Zone = allDay ? null : change.NewAllDay == false ? Store.DeviceZone : change.Occurrence.Zone,
                StartUtc = allDay ? null : ZoneMath.ToUtc(start, Store.DeviceZone, Store.Zones),
            });
        }
        list.Sort((a, b) =>
        {
            var c = a.Start.CompareTo(b.Start);
            return c != 0 ? c : string.CompareOrdinal(a.Key, b.Key);
        });
        return list;
    }

    /// <summary>
    /// The read-only reason of §3.5 on Windows, first match: a subscription, a calendar that cannot be written (its file
    /// could not be read), an event that starts before 1583-01-01 in its own zone (<c>historical</c>, which keeps Delete
    /// and its alerts). Windows has no invitations to answer: an imported event with invitees is changed locally (§3.5).
    /// </summary>
    public static ReadOnlyReason? ReadOnlyOf(CalendarState? calendar, IcsExpandedEvent occurrence)
    {
        ArgumentNullException.ThrowIfNull(occurrence);
        if (calendar is null || calendar.IsSubscription) return ReadOnlyReason.Subscribed;
        if (!calendar.IsWritable) return ReadOnlyReason.Calendar;
        // Judged on the series, as the editor does (EventEditing): a changed occurrence of a series that starts before
        // 1583 is historical too, whatever its own start.
        var judged = occurrence.Component;
        if (judged.RecurrenceId is not null && !occurrence.Orphan
            && calendar.Document?.Groups.FirstOrDefault(g => g.Uid == occurrence.Uid)?.Master is { } master)
        {
            judged = master;
        }
        return judged.Start.DateOf < EventEdits.FirstEditable ? ReadOnlyReason.Historical : null;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Store.Changed -= OnStoreChanged;
        if (Pending is not null) Pending.Changed -= OnPendingChanged;
    }
}

/// <summary>
/// One occurrence as the Calendar views show it: the store's <see cref="IcsExpandedEvent"/> with its calendar's name and
/// color, its read-only reason, the days it covers, and the time and accessible-name texts of §2.19 and §2.20.
/// </summary>
public sealed class CalendarItem
{
    /// <summary>The item for <paramref name="source"/> in <paramref name="calendar"/>.</summary>
    public CalendarItem(IcsExpandedEvent source, CalendarState? calendar)
    {
        Source = source ?? throw new ArgumentNullException(nameof(source));
        CalendarName = calendar?.Name ?? "";
        Color = calendar is not null && Avalonia.Media.Color.TryParse(calendar.Color, out var color) ? color : Colors.Gray;
        ReadOnly = EventsModel.ReadOnlyOf(calendar, source);
        var days = EventTime.OccurrenceDays(source.Start, source.End);
        FirstDay = days[0];
        LastDay = days[^1];
        DayCount = days.Count;
    }

    /// <summary>The store's occurrence (its component, UID, original date and zone).</summary>
    public IcsExpandedEvent Source { get; }

    /// <summary>The occurrence key (§3.2).</summary>
    public string Key => Source.Key;

    /// <summary>The title (user text, never changed).</summary>
    public string Title => Source.Title;

    /// <summary>The calendar id.</summary>
    public string CalendarId => Source.CalendarId;

    /// <summary>The calendar's name (user text).</summary>
    public string CalendarName { get; }

    /// <summary>The calendar's color (sRGB, never themed).</summary>
    public Color Color { get; }

    /// <summary>All-day.</summary>
    public bool AllDay => Source.AllDay;

    /// <summary>Start on the device's wall clock.</summary>
    public LocalDateTime Start => Source.Start;

    /// <summary>End on the device's wall clock, in end-of-day form.</summary>
    public LocalDateTime End => Source.End;

    /// <summary>Part of a series.</summary>
    public bool Recurring => Source.Recurring;

    /// <summary>Confirmed, tentative or canceled.</summary>
    public EventStatus Status => Source.Status;

    /// <summary>The location (user text), or "".</summary>
    public string Location => Source.Component.Location ?? "";

    /// <summary>Why it cannot be changed (§3.5), or null.</summary>
    public ReadOnlyReason? ReadOnly { get; }

    /// <summary>Edit, move and the other changes are allowed (not read-only).</summary>
    public bool CanEdit => ReadOnly is null;

    /// <summary>Delete is allowed: a writable event, or a historical one (Windows keeps Delete for them, §3.5).</summary>
    public bool CanDelete => ReadOnly is null or ReadOnlyReason.Historical;

    /// <summary>The first day it covers.</summary>
    public GregorianDate FirstDay { get; }

    /// <summary>The last day it covers (an end at midnight does not cover the next day).</summary>
    public GregorianDate LastDay { get; }

    /// <summary>How many days it covers.</summary>
    public int DayCount { get; }

    /// <summary>An all-day occurrence or one of 24 hours or more: a bar (§2.2).</summary>
    public bool IsBar => AllDay || End.MinutesSince(Start) >= 1440;

    /// <summary>The plain occurrence the layouts take.</summary>
    public EventOccurrence Occurrence => Source.ToOccurrence();

    /// <summary><c>event.timeRange</c> ("09:30 to 10:30"), or <c>event.allDay</c>.</summary>
    public string TimeRangeText => AllDay
        ? CalendarStrings.AllDay
        : CalendarStrings.TimeRange(EventStrings.Time(Start.Minute), EventStrings.Time(End.Minute));

    /// <summary>The §2.20 flags in their order: repeats, tentative or canceled, invitation or read only, day of, continuation.</summary>
    public string Flags((int N, int Total)? dayOf = null, string? continuesFrom = null, string? continuesTo = null)
    {
        var flags = "";
        if (Recurring) flags += CalendarStrings.FlagRepeats;
        if (Status == EventStatus.Tentative) flags += CalendarStrings.FlagTentative;
        else if (Status == EventStatus.Canceled) flags += CalendarStrings.FlagCanceled;
        if (ReadOnly == ReadOnlyReason.Invitation) flags += CalendarStrings.FlagInvitation;
        else if (ReadOnly is not null) flags += CalendarStrings.FlagReadOnly;
        if (dayOf is { } d) flags += CalendarStrings.FlagDayOf(d.N, d.Total);
        if (continuesFrom is not null) flags += CalendarStrings.FlagContinuesFrom(continuesFrom);
        if (continuesTo is not null) flags += CalendarStrings.FlagContinuesTo(continuesTo);
        return flags;
    }

    /// <summary><c>calendar.item.a11y</c> + flags: a Month chip, a day list row, a Week or Day block.</summary>
    public string ItemLabel(string? continuesFrom = null, string? continuesTo = null) =>
        CalendarStrings.ItemA11y(Title, TimeRangeText, CalendarName) + Flags(continuesFrom: continuesFrom, continuesTo: continuesTo);

    /// <summary>
    /// <c>calendar.bar.a11y</c> (one day: <c>calendar.bar.oneDay.a11y</c>) + flags, for a bar drawn in a row of
    /// <paramref name="rowYear"/>, cut by the row before and after as given. A timed bar is named like a chip.
    /// </summary>
    public string BarLabel(int rowYear, bool cutBefore, bool cutAfter)
    {
        var from = cutBefore ? CalendarStrings.BarDate(FirstDay, rowYear) : null;
        var to = cutAfter ? CalendarStrings.BarDate(LastDay, rowYear) : null;
        if (!AllDay) return ItemLabel(from, to);
        var head = FirstDay == LastDay
            ? CalendarStrings.BarOneDayA11y(Title, CalendarName)
            : CalendarStrings.BarA11y(Title, CalendarStrings.BarDate(FirstDay, rowYear), CalendarStrings.BarDate(LastDay, rowYear), CalendarName);
        return head + Flags(continuesFrom: from, continuesTo: to);
    }

    /// <summary><c>calendar.row.a11y</c> + flags: an Up next or List row; <paramref name="time"/> is what its time column shows.</summary>
    public string RowLabel(string time, (int N, int Total)? dayOf = null) =>
        CalendarStrings.RowA11y(time, Title, CalendarName, Location) + Flags(dayOf);
}
