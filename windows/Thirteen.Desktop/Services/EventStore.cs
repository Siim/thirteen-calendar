using System.Diagnostics;
using System.Globalization;
using System.Text;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;

namespace Thirteen.Desktop.Services;

/// <summary>
/// The events of Windows on disk (docs/EVENTS.md §3.6, §2.16, §6.4): <c>%LOCALAPPDATA%\Thirteen\Calendars</c> holds
/// <c>calendars.json</c> and one <c>{id}.ics</c> per calendar, each with <c>{id}.ics.bak</c>, the previous version.
/// <list type="bullet">
/// <item>Every document is loaded on a background thread at start; a file that cannot be read is replaced by its
/// backup (the file is renamed <c>{id}.ics.broken-{yyyyMMddHHmmss}</c>), and with no readable backup the calendar stays
/// in the list, read-only (§2.16).</item>
/// <item>Every writer goes through the calendar's queue; inside it the file is read, its SHA-256 compared with the
/// version last loaded, and a file changed outside Thirteen reloaded first (<c>store.reloaded</c>) so the change is
/// applied to it.</item>
/// <item>Writes go to <c>{id}.ics.tmp</c> (write-through), then <c>File.Move</c> when <c>{id}.ics</c> does not exist
/// and <c>File.Replace</c> with <c>{id}.ics.bak</c> otherwise; <c>calendars.json</c> the same way.</item>
/// <item>A <see cref="FileSystemWatcher"/> (debounced 500 ms) reloads calendars changed outside Thirteen and ignores
/// Thirteen's own writes by their hash.</item>
/// <item>One process at a time: the store holds <c>Calendars\.lock</c> open exclusively while it lives.</item>
/// </list>
/// </summary>
public sealed class EventStore : EventStoreBase, IDisposable
{
    private const string IndexName = "calendars.json";
    private const string LockName = ".lock";
    private readonly bool _readOnly;
    private readonly Dictionary<string, Timer> _debounce = new(StringComparer.Ordinal);
    private readonly object _watchGate = new();
    private FileSystemWatcher? _watcher;
    private FileStream? _lock;
    private bool _disposed;

    /// <summary>
    /// A store in <paramref name="folder"/> (default <see cref="DefaultFolder"/>). <paramref name="readOnly"/> (screenshot
    /// and QA runs): nothing is written, renamed or locked, and no "Personal" is created.
    /// </summary>
    public EventStore(string? folder = null, IZoneResolver? zones = null, Func<string>? deviceZone = null, TimeProvider? time = null, bool readOnly = false)
        : base(zones ?? WindowsZoneResolver.Shared, deviceZone ?? WindowsZoneResolver.DeviceZoneId, time)
    {
        Folder = folder ?? DefaultFolder;
        _readOnly = readOnly;
    }

    /// <summary><c>%LOCALAPPDATA%\Thirteen\Calendars</c>.</summary>
    public static string DefaultFolder =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Thirteen", "Calendars");

    /// <inheritdoc />
    public override string Folder { get; }

    /// <inheritdoc />
    public override bool IsReadOnly => _readOnly;

    /// <summary>How long the watcher waits after the last change of a file before it reads it.</summary>
    public TimeSpan WatchDelay { get; init; } = TimeSpan.FromMilliseconds(500);

    /// <summary>The path of a calendar's document; never outside <see cref="Folder"/> (an id that would leave it throws).</summary>
    public string DocumentPath(string calendarId)
    {
        var path = Path.Combine(Folder, calendarId + ".ics");
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Folder)) + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(path);
        if (!IsSafeCalendarId(calendarId) || !full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || Path.GetDirectoryName(full) != Path.TrimEndingDirectorySeparator(root))
        {
            throw new EventStoreException(StoreFailure.Storage, $"The calendar id \"{calendarId}\" is not a file name in {Folder}");
        }
        return path;
    }

    /// <summary>The path of calendars.json.</summary>
    public string IndexPath => Path.Combine(Folder, IndexName);

    // ---- Loading ---------------------------------------------------------------------------------

    /// <inheritdoc />
    protected override LoadedStore LoadStore(CancellationToken cancellationToken)
    {
        if (!_readOnly)
        {
            Directory.CreateDirectory(Folder);
            try
            {
                _lock = new FileStream(Path.Combine(Folder, LockName), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose);
            }
            catch (IOException e)
            {
                throw new EventStoreException(StoreFailure.Storage, $"Another Thirteen is using {Folder}", e);
            }
            catch (UnauthorizedAccessException e)
            {
                throw new EventStoreException(StoreFailure.Storage, $"Thirteen cannot write {Folder}", e);
            }
        }
        var index = ReadIndex(out var firstUse);
        var entries = new List<Entry>();
        foreach (var record in index.Calendars)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (entries.Any(e => e.Record.Id == record.Id) || !IsSafeId(record.Id)) continue;
            var entry = new Entry(record);
            LoadDocument(entry);
            entries.Add(entry);
        }
        if (firstUse && !_readOnly)
        {
            // First use creates the local calendar "Personal" (§2.16); its file is written with its first event.
            var personal = new CalendarRecord
            {
                Id = NewId(),
                Kind = CalendarKinds.Local,
                Name = PersonalName,
                Color = (DefaultColor ?? CalendarPalette.Colors[0]).ToLowerInvariant(),
                Order = 0,
                Visible = true,
                CreatedAt = StoreTime.Seconds(Time.GetUtcNow()),
            };
            entries.Add(new Entry(personal) { Document = EmptyDocument(personal) });
            WriteAtomic(IndexPath, new CalendarIndexDocument { Calendars = [personal] }.ToUtf8());
        }
        return new LoadedStore(entries, index.FailedCommits ?? [], index.CollapsedGroups ?? []);
    }

    private static bool IsSafeId(string id) => IsSafeCalendarId(id);

    /// <summary>
    /// calendars.json, else its backup, else (both unreadable) an index rebuilt from the documents in the folder so no
    /// calendar is lost. <paramref name="firstUse"/>: neither file exists.
    /// </summary>
    private CalendarIndexDocument ReadIndex(out bool firstUse)
    {
        firstUse = false;
        var path = IndexPath;
        var exists = File.Exists(path);
        if (exists && TryReadIndex(path) is { } index) return index;
        var backup = path + ".bak";
        if (File.Exists(backup) && TryReadIndex(backup) is { } previous)
        {
            if (exists) MoveAside(path);
            Trace.WriteLine($"Thirteen: {IndexName} could not be read; using its backup");
            return previous;
        }
        if (!exists)
        {
            firstUse = !Directory.Exists(Folder) || !Directory.EnumerateFiles(Folder, "*.ics").Any();
            if (firstUse) return new CalendarIndexDocument();
        }
        if (exists) MoveAside(path);
        Trace.WriteLine($"Thirteen: {IndexName} could not be read; rebuilding it from the calendar files");
        return RebuildIndex();
    }

    private static CalendarIndexDocument? TryReadIndex(string path)
    {
        try
        {
            return CalendarIndexDocument.FromUtf8(File.ReadAllBytes(path));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private CalendarIndexDocument RebuildIndex()
    {
        var records = new List<CalendarRecord>();
        if (!Directory.Exists(Folder)) return new CalendarIndexDocument();
        foreach (var file in Directory.EnumerateFiles(Folder, "*.ics").Order(StringComparer.Ordinal))
        {
            var id = Path.GetFileNameWithoutExtension(file);
            if (!IsSafeId(id)) continue;
            string? name = null;
            string? color = null;
            try
            {
                var calendar = IcsReader.Parse(StoreText.Decode(File.ReadAllBytes(file)), id);
                name = calendar.Name;
                color = calendar.Color;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or ThirteenException or DecoderFallbackException)
            {
                // Listed anyway: it then shows as unreadable.
            }
            records.Add(new CalendarRecord
            {
                Id = id,
                Kind = CalendarKinds.Local,
                Name = string.IsNullOrWhiteSpace(name) ? id : name,
                Color = color ?? CalendarPalette.NextFree(records.Select(r => r.Color)),
                Order = records.Count,
                Visible = true,
                CreatedAt = StoreTime.Seconds(File.GetCreationTimeUtc(file)),
            });
        }
        var index = new CalendarIndexDocument { Calendars = records };
        if (!_readOnly) WriteAtomic(IndexPath, index.ToUtf8());
        return index;
    }

    /// <summary>Loads (or reloads) an entry's document with the recovery of §2.16. Runs at load or inside the queue.</summary>
    private void LoadDocument(Entry entry)
    {
        var id = entry.Record.Id;
        var path = DocumentPath(id);
        var read = ReadFile(path);
        if (read.Missing)
        {
            entry.Document = EmptyDocument(entry.Record);
            entry.FileHash = null;
            if (entry.Notice == CalendarNotice.Unreadable) entry.Notice = CalendarNotice.None;
            return;
        }
        if (read.Bytes is { } bytes && TryParse(bytes, id) is { } document)
        {
            entry.Document = document;
            entry.FileHash = StoreText.Sha256Hex(bytes);
            if (entry.Notice == CalendarNotice.Unreadable) entry.Notice = CalendarNotice.None;
            return;
        }
        // The file cannot be read or parsed: the backup, if it can be (§2.16 "Unreadable data").
        var backup = ReadFile(path + ".bak");
        if (backup.Bytes is { } backupBytes && TryParse(backupBytes, id) is { } previous && !_readOnly && MoveAside(path))
        {
            entry.Document = previous;
            entry.FileHash = null;
            entry.Notice = CalendarNotice.Recovered;
            Trace.WriteLine($"Thirteen: calendar {id} could not be read; restored its last saved copy");
            return;
        }
        if (_readOnly && backup.Bytes is { } readOnlyBackup && TryParse(readOnlyBackup, id) is { } shown)
        {
            entry.Document = shown;
            entry.FileHash = read.Bytes is null ? null : StoreText.Sha256Hex(read.Bytes);
            entry.Notice = CalendarNotice.Recovered;
            return;
        }
        entry.Document = null;
        entry.FileHash = read.Bytes is null ? null : StoreText.Sha256Hex(read.Bytes);
        entry.Notice = CalendarNotice.Unreadable;
        Trace.WriteLine($"Thirteen: calendar {id} could not be read and has no readable backup; it is read-only");
    }

    private IcsCalendar? TryParse(byte[] bytes, string calendarId)
    {
        try
        {
            if (bytes.LongLength > StoreText.MaxDocumentBytes) return null;
            var text = StoreText.Decode(bytes);
            if (text.Contains('�', StringComparison.Ordinal) && !IsValidUtf8(bytes)) return null;
            var calendar = IcsReader.Parse(text, calendarId, Zones);
            // Thirteen always writes a store document whole: one cut off (a sync tool or editor that stopped half way, no
            // END:VCALENDAR, a component without its END) is a file that cannot be read (§2.16), never the calendar.
            if (!EndsWithCalendarEnd(text) || calendar.Warnings.Any(w => w.Code == IcsWarningCode.UnclosedComponent)) return null;
            return calendar;
        }
        catch (ThirteenException)
        {
            return null;
        }
    }

    private static bool EndsWithCalendarEnd(string text)
    {
        var trimmed = text.AsSpan().TrimEnd();
        var lastBreak = trimmed.LastIndexOfAny('\r', '\n');
        var last = (lastBreak < 0 ? trimmed : trimmed[(lastBreak + 1)..]).Trim();
        return last.Equals("END:VCALENDAR", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsValidUtf8(byte[] bytes)
    {
        try
        {
            _ = new UTF8Encoding(false, true).GetString(bytes);
            return true;
        }
        catch (DecoderFallbackException)
        {
            return false;
        }
    }

    private readonly record struct FileRead(byte[]? Bytes, bool Missing);

    private static FileRead ReadFile(string path)
    {
        try
        {
            if (!File.Exists(path)) return new FileRead(null, true);
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            return new FileRead(buffer.ToArray(), false);
        }
        catch (FileNotFoundException)
        {
            return new FileRead(null, true);
        }
        catch (DirectoryNotFoundException)
        {
            return new FileRead(null, true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Trace.WriteLine($"Thirteen: could not read {path}: {e.Message}");
            return new FileRead(null, false);
        }
    }

    /// <summary>Renames a file that cannot be read to <c>{name}.broken-{yyyyMMddHHmmss}</c> (never overwritten). False when it could not be renamed.</summary>
    private bool MoveAside(string path)
    {
        if (_readOnly) return false;
        try
        {
            if (!File.Exists(path)) return true;
            var stamp = Time.GetUtcNow().UtcDateTime.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);
            var target = $"{path}.broken-{stamp}";
            for (var n = 2; File.Exists(target); n++) target = $"{path}.broken-{stamp}-{n}";
            File.Move(path, target);
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Trace.WriteLine($"Thirteen: could not rename {path}: {e.Message}");
            return false;
        }
    }

    /// <inheritdoc />
    protected override void OnLoaded()
    {
        if (_readOnly || _disposed) return;
        try
        {
            var watcher = new FileSystemWatcher(Folder, "*.ics")
            {
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.CreationTime,
                IncludeSubdirectories = false,
            };
            watcher.Changed += (_, e) => Schedule(e.Name);
            watcher.Created += (_, e) => Schedule(e.Name);
            watcher.Deleted += (_, e) => Schedule(e.Name);
            watcher.Renamed += (_, e) =>
            {
                Schedule(e.OldName);
                Schedule(e.Name);
            };
            watcher.Error += (_, e) => Trace.WriteLine($"Thirteen: the Calendars folder watcher failed: {e.GetException().Message}");
            watcher.EnableRaisingEvents = true;
            _watcher = watcher;
        }
        catch (Exception e) when (e is IOException or ArgumentException or PlatformNotSupportedException)
        {
            Trace.WriteLine($"Thirteen: no watcher on {Folder}: {e.Message}");
        }
    }

    // ---- Changes outside Thirteen ----------------------------------------------------------------

    private void Schedule(string? name)
    {
        if (name is null || !name.EndsWith(".ics", StringComparison.OrdinalIgnoreCase)) return;
        var id = name[..^4];
        if (EntryOf(id) is null) return;
        lock (_watchGate)
        {
            if (_disposed) return;
            if (_debounce.TryGetValue(id, out var timer))
            {
                timer.Change(WatchDelay, Timeout.InfiniteTimeSpan);
                return;
            }
            _debounce[id] = new Timer(_ => _ = CheckOutsideChangeAsync(id), null, WatchDelay, Timeout.InfiniteTimeSpan);
        }
    }

    /// <summary>
    /// Reloads a calendar whose file no longer has the hash Thirteen last read or wrote (§2.16 "Changed outside
    /// Thirteen"); Thirteen's own writes have that hash and are ignored. Public for tests.
    /// </summary>
    public async Task<bool> CheckOutsideChangeAsync(string calendarId)
    {
        lock (_watchGate)
        {
            if (_debounce.Remove(calendarId, out var timer)) timer.Dispose();
        }
        var entry = EntryOf(calendarId);
        if (entry is null || _disposed) return false;
        await entry.Queue.WaitAsync().ConfigureAwait(false);
        bool reloaded;
        try
        {
            if (entry.Removed) return false;
            reloaded = ReloadIfChanged(entry);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Trace.WriteLine($"Thirteen: could not check {calendarId}: {e.Message}");
            return false;
        }
        finally
        {
            entry.Queue.Release();
        }
        if (reloaded)
        {
            RaiseChanged([calendarId], documents: true, index: false);
            RaiseReloaded(calendarId);
        }
        return reloaded;
    }

    /// <summary>Reloads the entry when its file's hash differs from the one Thirteen expects. Inside the queue.</summary>
    private bool ReloadIfChanged(Entry entry)
    {
        var read = ReadFile(DocumentPath(entry.Record.Id));
        if (!read.Missing && read.Bytes is null) return false;          // locked right now; the next check reads it
        var hash = read.Bytes is null ? null : StoreText.Sha256Hex(read.Bytes);
        if (hash == entry.FileHash) return false;
        var wasUnreadable = entry.Document is null;
        if (read.Bytes is { } bytes && entry.Document is { } held && !_readOnly && TryParse(bytes, entry.Record.Id) is null && KeepHeldCopy(entry, held))
        {
            Publish();
            return true;
        }
        LoadDocument(entry);
        // A file read cleanly from outside replaces an earlier notice (a restored or unreadable copy): the row says the
        // latest thing that happened to the calendar.
        var readCleanly = hash is not null && entry.FileHash == hash && entry.Document is not null;
        if (readCleanly || entry.Notice == CalendarNotice.None || (wasUnreadable && entry.Document is not null)) entry.Notice = CalendarNotice.Reloaded;
        Publish();
        return true;
    }

    /// <summary>
    /// A file broken from outside while Thirteen runs (§2.16): the copy Thirteen holds is the version it last read or
    /// saved (the hash it expected), and <c>{id}.ics.bak</c> is one save older, so the held copy stays. The broken file
    /// is renamed <c>.broken-*</c> and the held copy written back. False when the file could not be renamed (then the
    /// start-up recovery runs). Inside the queue.
    /// </summary>
    private bool KeepHeldCopy(Entry entry, IcsCalendar held)
    {
        var path = DocumentPath(entry.Record.Id);
        if (!MoveAside(path)) return false;
        try
        {
            StoreDocument(entry, IcsWriter.Serialize(held, Zones, UtcNowValue()));
        }
        catch (Exception e) when (e is EventStoreException or ThirteenException)
        {
            // Kept in memory; the next save writes it (the file is gone, so that write is a plain move).
            entry.FileHash = null;
            Trace.WriteLine($"Thirteen: could not write back calendar {entry.Record.Id}: {e.Message}");
        }
        entry.Notice = CalendarNotice.Recovered;
        Trace.WriteLine($"Thirteen: calendar {entry.Record.Id} was changed outside Thirteen into a file it cannot read; kept the copy it last saved");
        return true;
    }

    /// <inheritdoc />
    protected override IcsCalendar? CurrentDocument(Entry entry)
    {
        ReloadIfChanged(entry);
        return entry.Document;
    }

    // ---- Writing ---------------------------------------------------------------------------------

    /// <inheritdoc />
    protected override void StoreDocument(Entry entry, string text)
    {
        if (_readOnly) throw new EventStoreException(StoreFailure.ReadOnly, "This store is read-only");
        var bytes = new UTF8Encoding(false).GetBytes(text);
        WriteAtomic(DocumentPath(entry.Record.Id), bytes);
        entry.FileHash = StoreText.Sha256Hex(bytes);
    }

    /// <inheritdoc />
    protected override void StoreIndex(CalendarIndexDocument index)
    {
        if (_readOnly) return;
        WriteAtomic(IndexPath, index.ToUtf8());
    }

    /// <summary>
    /// <c>{path}.tmp</c> written through, then <c>File.Move</c> when <paramref name="path"/> does not exist, else
    /// <c>File.Replace</c> keeping the old file as <c>{path}.bak</c> (§3.6). I/O errors become <see cref="EventStoreException"/>s.
    /// </summary>
    private static void WriteAtomic(string path, byte[] bytes)
    {
        var temporary = path + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.WriteThrough))
            {
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }
            if (File.Exists(path)) File.Replace(temporary, path, path + ".bak", ignoreMetadataErrors: true);
            else File.Move(temporary, path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            try
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
            catch (Exception cleanup) when (cleanup is IOException or UnauthorizedAccessException)
            {
                Trace.WriteLine($"Thirteen: could not remove {temporary}: {cleanup.Message}");
            }
            throw new EventStoreException(Classify(e), $"Could not write {path}: {e.Message}", e);
        }
    }

    /// <summary>Disk full and access denied are final (<see cref="StoreFailure.Storage"/>); other I/O errors may pass.</summary>
    internal static StoreFailure Classify(Exception e)
    {
        if (e is EventStoreException store) return store.Failure;
        if (e is UnauthorizedAccessException) return StoreFailure.Storage;
        if (OperatingSystem.IsWindows())
        {
            // ERROR_DISK_FULL (0x70) and ERROR_HANDLE_DISK_FULL (0x27), as HRESULTs 0x80070070 and 0x80070027.
            return (e.HResult & 0xFFFF) is 0x70 or 0x27 ? StoreFailure.Storage : StoreFailure.Transient;
        }
        // .NET on macOS and Linux carries the errno: ENOSPC is 28 on both.
        return e.HResult == 28 ? StoreFailure.Storage : StoreFailure.Transient;
    }

    /// <inheritdoc />
    protected override void RemoveDocument(Entry entry)
    {
        var path = DocumentPath(entry.Record.Id);
        try
        {
            if (entry.Document is null)
            {
                // §2.16: an unreadable calendar's files go into Calendars\Unreadable, never deleted.
                var aside = Path.Combine(Folder, "Unreadable");
                Directory.CreateDirectory(aside);
                foreach (var file in Directory.EnumerateFiles(Folder, entry.Record.Id + ".ics*"))
                {
                    var name = Path.GetFileName(file);
                    if (!name.Equals(entry.Record.Id + ".ics", StringComparison.Ordinal) && !name.StartsWith(entry.Record.Id + ".ics.", StringComparison.Ordinal)) continue;
                    var target = Path.Combine(aside, name);
                    for (var n = 2; File.Exists(target); n++) target = Path.Combine(aside, $"{name}-{n}");
                    File.Move(file, target);
                }
                return;
            }
            if (File.Exists(path)) File.Delete(path);
            if (File.Exists(path + ".bak")) File.Delete(path + ".bak");
            if (File.Exists(path + ".tmp")) File.Delete(path + ".tmp");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new EventStoreException(Classify(e), $"Could not remove {path}: {e.Message}", e);
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        lock (_watchGate)
        {
            if (_disposed) return;
            _disposed = true;
            foreach (var timer in _debounce.Values) timer.Dispose();
            _debounce.Clear();
        }
        _watcher?.Dispose();
        _lock?.Dispose();
    }
}
