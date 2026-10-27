using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;

namespace Thirteen.Desktop.Services;

/// <summary>What the Calendars list says on a calendar's row about its stored file (§2.16).</summary>
public enum CalendarNotice
{
    /// <summary>Nothing to say.</summary>
    None,

    /// <summary><c>store.recovered</c>: the file could not be read, so the backup was loaded and the file renamed <c>.broken-*</c>.</summary>
    Recovered,

    /// <summary><c>store.unreadable</c>: neither the file nor its backup could be read; the calendar is read-only.</summary>
    Unreadable,

    /// <summary><c>store.reloaded</c>: the file changed outside Thirteen and was reloaded.</summary>
    Reloaded,
}

/// <summary>
/// One calendar of the store: its index record, its parsed document (null when unreadable) and its notice. Immutable;
/// the store hands out a new one after every change.
/// </summary>
/// <param name="Record">The calendars.json record.</param>
/// <param name="Document">The document as last read or written; null when it could not be read (§2.16).</param>
/// <param name="Notice">What its row says about its file.</param>
public sealed record CalendarState(CalendarRecord Record, IcsCalendar? Document, CalendarNotice Notice)
{
    /// <summary>The calendar id.</summary>
    public string Id => Record.Id;

    /// <summary>The name (user text).</summary>
    public string Name => Record.Name;

    /// <summary><c>#rrggbb</c>.</summary>
    public string Color => Record.Color;

    /// <summary>Thirteen's own visibility.</summary>
    public bool Visible => Record.Visible;

    /// <summary>A subscription (read-only, stored as fetched).</summary>
    public bool IsSubscription => Record.IsSubscription;

    /// <summary>The document could be read neither from the file nor from its backup.</summary>
    public bool IsUnreadable => Document is null;

    /// <summary>The user can add and change events: a local calendar whose document could be read.</summary>
    public bool IsWritable => !IsSubscription && Document is not null;

    /// <summary>The number of events (UID groups).</summary>
    public int EventCount => Document?.Groups.Count ?? 0;
}

/// <summary>Why a store operation failed.</summary>
public enum StoreFailure
{
    /// <summary>An I/O error that may pass (a locked file, a network drive); retried once by pending changes.</summary>
    Transient,

    /// <summary>The calendar cannot be written: a subscription, or a calendar whose file cannot be read (§2.16).</summary>
    ReadOnly,

    /// <summary>The calendar does not exist (any more).</summary>
    NotFound,

    /// <summary>The event or occurrence the change was for no longer resolves (§3.2), or its time group changed elsewhere.</summary>
    Changed,

    /// <summary>The disk is full, or the folder cannot be written (access denied).</summary>
    Storage,

    /// <summary>The document would be over 25 MB or hold more than 50,000 events (§3.6).</summary>
    TooLarge,
}

/// <summary>A store operation that failed for <see cref="Failure"/>.</summary>
public sealed class EventStoreException : Exception
{
    /// <summary>A failure with a message (English, for logs).</summary>
    public EventStoreException(StoreFailure failure, string message, Exception? inner = null)
        : base(message, inner) => Failure = failure;

    /// <summary>Why it failed.</summary>
    public StoreFailure Failure { get; }
}

/// <summary>What changed in the store.</summary>
public sealed class StoreChangedEventArgs(IReadOnlyList<string> calendarIds, bool documents, bool index) : EventArgs
{
    /// <summary>The calendars that changed (empty for a change of the whole index, such as the first load).</summary>
    public IReadOnlyList<string> CalendarIds { get; } = calendarIds;

    /// <summary>Events changed (documents written, reloaded or recovered): occurrences must be fetched again.</summary>
    public bool Documents { get; } = documents;

    /// <summary>Records changed (names, colors, visibility, order, subscription state, calendars added or removed).</summary>
    public bool Index { get; } = index;
}

/// <summary>
/// The events of Windows (docs/EVENTS.md §3.6): local calendars and subscriptions, each one iCalendar document, with
/// their index. Every writer (UI saves, pending-change commits, import, restore, subscription refresh) goes through
/// the store, which queues the writes of each calendar (§6.4). <see cref="EventStore"/> keeps them in
/// <c>%LOCALAPPDATA%\Thirteen\Calendars</c>; <see cref="FakeEventStore"/> holds the mockup data set in memory.
/// Members may be called from any thread; <see cref="Changed"/> is raised on a background thread.
/// </summary>
public interface IEventStore
{
    /// <summary>The zone data used for every conversion.</summary>
    IZoneResolver Zones { get; }

    /// <summary>The device zone (an IANA id) used for occurrences.</summary>
    string DeviceZone { get; }

    /// <summary>The 13-month system the expansion recognizes rules for (§4.5).</summary>
    CalendarSystemId System { get; set; }

    /// <summary>True once <see cref="LoadAsync"/> has finished.</summary>
    bool IsLoaded { get; }

    /// <summary>The folder of the files, or null for a store in memory.</summary>
    string? Folder { get; }

    /// <summary>The calendars, in list order (local calendars, then subscriptions; each by <see cref="CalendarRecord.Order"/>).</summary>
    IReadOnlyList<CalendarState> Calendars { get; }

    /// <summary>Changes that could not be written while no window was in the foreground (§2.11), oldest first.</summary>
    IReadOnlyList<FailedCommit> FailedCommits { get; }

    /// <summary>The collapsed groups of the Calendars list (<see cref="CalendarKinds.Local"/>, <see cref="CalendarKinds.Subscription"/>).</summary>
    IReadOnlyList<string> CollapsedGroups { get; }

    /// <summary>Raised after every change, on a background thread.</summary>
    event EventHandler<StoreChangedEventArgs>? Changed;

    /// <summary>Raised (on a background thread) after a calendar changed outside Thirteen was reloaded, recovered or found unreadable (§2.16).</summary>
    event Action<string>? ReloadedFromDisk;

    /// <summary>
    /// Awaited before every write of a calendar's document (UI saves, import, restore), except the writes of pending
    /// changes themselves: <see cref="PendingChanges"/> commits the calendar's pending moves and deletes here, so they
    /// are written before the next write to the same calendar (§2.11).
    /// </summary>
    Func<string, Task>? BeforeWrite { get; set; }

    /// <summary>Loads the index and every document (off the calling thread). Safe to call more than once.</summary>
    Task LoadAsync(CancellationToken cancellationToken = default);

    /// <summary>The calendar with this id, or null.</summary>
    CalendarState? Find(string calendarId);

    /// <summary>
    /// The occurrences that overlap <c>[from, to)</c> of the device's wall clock, from the visible calendars (or all with
    /// <paramref name="includeHidden"/>), sorted by start, then key. Expanded per Gregorian year and cached until the
    /// calendar, the device zone or the system changes.
    /// </summary>
    IReadOnlyList<IcsExpandedEvent> Occurrences(LocalDateTime from, LocalDateTime to, bool includeHidden = false);

    /// <summary>The UID group of an event, as last read or written, or null.</summary>
    IcsGroup? FindGroup(string calendarId, string uid);

    /// <summary>
    /// Read-modify-write of a calendar's document (§3.6): inside the calendar's write queue, reads the current document
    /// (reloading it first when the file changed outside Thirteen), applies <paramref name="change"/> to it and writes the
    /// result. <paramref name="change"/> runs exactly once, on a background thread; returning the same instance writes
    /// nothing. Returns the document as stored.
    /// </summary>
    /// <exception cref="EventStoreException">The calendar is read-only or missing, the document is too large, or the write failed.</exception>
    Task<IcsCalendar> UpdateDocumentAsync(string calendarId, Func<IcsCalendar, IcsCalendar> change, CancellationToken cancellationToken = default);

    /// <summary>
    /// Read-modify-write of one UID group (§3.6): <paramref name="change"/> gets the current group (null when the UID is
    /// new) and returns the new group (null, or a group without members, removes it). Only that group is re-serialized;
    /// every other group, kept component and <c>VTIMEZONE</c> is written back byte for byte.
    /// </summary>
    Task<IcsCalendar> UpdateGroupAsync(string calendarId, string uid, Func<IcsCalendar, IcsGroup?, IcsGroup?> change, CancellationToken cancellationToken = default);

    /// <summary>Adds a local calendar (its file is written with its first event). <paramref name="color"/> null: the next free palette color.</summary>
    Task<CalendarState> CreateCalendarAsync(string name, string? color = null, string? id = null, CancellationToken cancellationToken = default);

    /// <summary>The first local calendar, or "Personal" created again when there is none (§2.16).</summary>
    Task<CalendarState> EnsureLocalCalendarAsync(CancellationToken cancellationToken = default);

    /// <summary>Adds a subscription with its first copy of the feed, stored exactly as fetched.</summary>
    Task<CalendarState> CreateSubscriptionAsync(string name, string color, SubscriptionRecord subscription, string body, string? id = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Removes a calendar and deletes its files; an unreadable calendar's files are moved into <c>Calendars\Unreadable</c>
    /// instead (§2.16).
    /// </summary>
    Task DeleteCalendarAsync(string calendarId, CancellationToken cancellationToken = default);

    /// <summary>Changes a calendar's record (name, color, visibility, order, subscription settings). A local calendar's document gets the new name and color the next time it is written.</summary>
    Task<CalendarState> UpdateRecordAsync(string calendarId, Func<CalendarRecord, CalendarRecord> change, CancellationToken cancellationToken = default);

    /// <summary>
    /// A subscription refresh (§3.6), inside the calendar's write queue: <paramref name="decide"/> gets the current record
    /// and returns the new record and, when the body is to be stored, the body (the old copy becomes <c>{id}.ics.bak</c>),
    /// or null to change nothing. Returns true when a body was stored.
    /// </summary>
    Task<bool> UpdateSubscriptionAsync(string calendarId, Func<CalendarRecord, SubscriptionUpdate?> decide, CancellationToken cancellationToken = default);

    /// <summary>Collapses or expands a group of the Calendars list (stored with the visibility, §2.15).</summary>
    Task SetCollapsedAsync(string group, bool collapsed, CancellationToken cancellationToken = default);

    /// <summary>Records failed commits nobody saw (§2.11).</summary>
    Task AddFailedCommitsAsync(IReadOnlyList<FailedCommit> failures, CancellationToken cancellationToken = default);

    /// <summary>Clears the failed commits once they were shown.</summary>
    Task ClearFailedCommitsAsync(CancellationToken cancellationToken = default);
}

/// <summary>The outcome of a subscription refresh's decision (<see cref="IEventStore.UpdateSubscriptionAsync"/>).</summary>
/// <param name="Record">The record to store.</param>
/// <param name="Body">The feed text to store as the calendar's document, or null to keep the stored copy.</param>
/// <param name="Document">The body already parsed (saves parsing it again), or null.</param>
public sealed record SubscriptionUpdate(CalendarRecord Record, string? Body = null, IcsCalendar? Document = null);

/// <summary>Helpers shared by the store, the subscription service and the import.</summary>
public static class StoreText
{
    /// <summary>A document over this many bytes is refused (§3.6).</summary>
    public const long MaxDocumentBytes = 25L * 1024 * 1024;

    /// <summary>A document with more events (VEVENTs) than this is refused (§3.6).</summary>
    public const int MaxEvents = 50_000;

    /// <summary><c>sha256:&lt;hex&gt;</c> of UTF-8 text (the <c>contentHash</c> of §3.6).</summary>
    public static string ContentHash(string text) => "sha256:" + Sha256Hex(System.Text.Encoding.UTF8.GetBytes(text));

    /// <summary>Lowercase hex SHA-256 of bytes.</summary>
    public static string Sha256Hex(ReadOnlySpan<byte> bytes) => Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(bytes));

    /// <summary>Decodes a calendar file: UTF-8 (with or without a byte order mark), or UTF-16 with a byte order mark.</summary>
    public static string Decode(byte[] bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF) return System.Text.Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
        if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) return System.Text.Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2);
        if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF) return System.Text.Encoding.BigEndianUnicode.GetString(bytes, 2, bytes.Length - 2);
        return System.Text.Encoding.UTF8.GetString(bytes);
    }

    /// <summary>The number of <c>VEVENT</c> components a document holds (groups' members and kept ones).</summary>
    public static int EventComponents(IcsCalendar calendar) =>
        calendar.Groups.Sum(g => g.Members.Count()) + calendar.Others.Count(o => o.Name == "VEVENT");

    /// <summary>
    /// How a feed body parsed (§2.16 "Suspicious feed results"): its events (UID groups) and the <c>VEVENT</c>s the
    /// reader could not read (kept in <see cref="IcsCalendar.Others"/>; exact duplicates are not counted).
    /// </summary>
    public static (int Events, int Skipped, int Components) ParseOutcome(IcsCalendar calendar)
    {
        var duplicates = calendar.Warnings
            .Where(w => w.Code == IcsWarningCode.DuplicateUid && w.Detail.StartsWith("An exact copy", StringComparison.Ordinal))
            .Select(w => w.Line)
            .ToHashSet();
        var skipped = calendar.Others.Count(o => o.Name == "VEVENT" && !(o.Line is { } line && duplicates.Contains(line)));
        var read = calendar.Groups.Sum(g => g.Members.Count());
        return (calendar.Groups.Count, skipped, read + skipped);
    }
}
