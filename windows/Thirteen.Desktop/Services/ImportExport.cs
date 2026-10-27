using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;

namespace Thirteen.Desktop.Services;

// Import, restore and export on Windows (docs/EVENTS.md §2.17, §3.6, §6.4 ImportExport.cs), the counterpart of the
// web's apps/web/src/lib/events/files.ts:
// - Reading the chosen files (ReadFiles, ReadPathsAsync): .ics, .ical, .ifb and Thirteen's .zip (one .ics per
//   calendar; a zip of another app is read too when its entries are calendar files), parsed and counted off the UI
//   thread. When every readable document is a Thirteen export (X-THIRTEEN-CALENDAR-ID), the plan is a restore.
// - Writing an import (ImportAsync): every document merged into its target through the store's read-modify-write
//   (IcsMerge.ImportCalendar: UID groups, versions and import baselines, override-only groups, colliding file-defined
//   VTIMEZONE names renamed), new calendars created first.
// - Writing a restore (RestoreAsync): each export back into the calendar with its id (version against version,
//   IcsMerge.RestoreCalendar), or a new calendar that keeps the id; a subscription comes back with the file as its
//   first copy and is refreshed on its schedule (due at once); one that still exists is left as it is.
// - Export (ExportText, ExportFiles, WriteFilesAsync): one VCALENDAR per calendar with X-WR-CALNAME, its color and
//   X-THIRTEEN-CALENDAR-ID (a subscription: its last fetched copy plus X-THIRTEEN-SUBSCRIPTION-URL and -INTERVAL),
//   one file or a folder of files, never one merged file; names made unique with " (2)".

/// <summary>Why a chosen file cannot be imported (the §2.19 ids).</summary>
public enum ImportFileError
{
    /// <summary><c>import.notIcs</c>: "This file isn't a calendar (.ics) file."</summary>
    NotIcs,

    /// <summary><c>import.empty</c>: "This file has no events."</summary>
    Empty,

    /// <summary><c>subscribe.error.tooLarge</c>: over 25 MB or 50,000 events (§3.6).</summary>
    TooLarge,
}

/// <summary>What a Thirteen export says about its calendar (§2.17 "Restore").</summary>
/// <param name="CalendarId">Its <c>X-THIRTEEN-CALENDAR-ID</c>.</param>
/// <param name="IsSubscription">It carries <c>X-THIRTEEN-SUBSCRIPTION-URL</c>.</param>
/// <param name="Name">Its <c>X-WR-CALNAME</c>, else the file name without its extension.</param>
/// <param name="Color"><c>#rrggbb</c>, or null when the file has none.</param>
/// <param name="SubscriptionUrl">The feed's link (subscriptions).</param>
/// <param name="SubscriptionInterval">One of <see cref="SubscriptionIntervals"/> (<c>PT6H</c> when the file's is unknown).</param>
public sealed record ThirteenExportInfo(string CalendarId, bool IsSubscription, string Name, string? Color, string? SubscriptionUrl, string SubscriptionInterval);

/// <summary>One calendar document of a chosen file (a <c>.ics</c>, or one <c>.ics</c> entry of a zip).</summary>
/// <param name="Id">Stable within a plan: <c>{file index}</c> or <c>{file index}/{entry index}</c>.</param>
/// <param name="Name">The name to show: the file's, or the zip entry's (user text).</param>
/// <param name="Text">The document's text.</param>
/// <param name="Events">UID groups plus unreadable events: the <c>{n}</c> of <c>import.summary</c>.</param>
/// <param name="Groups">UID groups (the event count of a restored calendar).</param>
/// <param name="Skipped">Events the reader could not read (<c>import.partial</c>).</param>
/// <param name="CalendarName">The name of a new calendar: <c>X-WR-CALNAME</c>, else the file name without its extension.</param>
/// <param name="Named">The file names its calendar: "New calendar" is the default target (§2.17 step 2).</param>
/// <param name="Thirteen">A Thirteen export's calendar, or null.</param>
public sealed record ImportSource(
    string Id,
    string Name,
    string Text,
    int Events,
    int Groups,
    int Skipped,
    string CalendarName,
    bool Named,
    ThirteenExportInfo? Thirteen);

/// <summary>A chosen file: its documents, or why it cannot be read.</summary>
public sealed record ImportFile(string Name, IReadOnlyList<ImportSource> Sources, ImportFileError? Error);

/// <summary>The chosen files read (§2.17 steps 1 and 2).</summary>
/// <param name="Files">Every chosen file, in order.</param>
/// <param name="Sources">Every readable document, in file order.</param>
/// <param name="IsRestore">Every readable document is a Thirteen export: the dialog is "Restore calendars".</param>
public sealed record ImportPlan(IReadOnlyList<ImportFile> Files, IReadOnlyList<ImportSource> Sources, bool IsRestore);

/// <summary>Where an imported document goes: an existing local calendar (<see cref="CalendarId"/>), or a new one named <see cref="NewName"/>.</summary>
public sealed record ImportTarget(string? CalendarId, string? NewName)
{
    /// <summary>An existing local calendar.</summary>
    public static ImportTarget Existing(string calendarId) => new(calendarId, null);

    /// <summary>A new local calendar.</summary>
    public static ImportTarget New(string name) => new(null, name);
}

/// <summary>A document and where it goes.</summary>
public sealed record ImportChoice(ImportSource Source, ImportTarget Target);

/// <summary>What an import did (§2.17 step 4), counted in UID groups.</summary>
/// <param name="Added">New groups.</param>
/// <param name="Updated">Groups replaced, or with overrides added or replaced.</param>
/// <param name="Unchanged">Groups already held in the same or a later version.</param>
/// <param name="Duplicates">Further masters of one UID in a file (<c>import.duplicates</c>).</param>
/// <param name="Partial">Events the files' reader could not read (<c>import.partial</c>).</param>
/// <param name="CalendarIds">The calendars written, new ones included.</param>
public sealed record ImportOutcome(int Added, int Updated, int Unchanged, int Duplicates, int Partial, IReadOnlyList<string> CalendarIds);

/// <summary>What a restore did (§2.17 "Restore").</summary>
/// <param name="Calendars">Calendars restored (<c>import.restore.result</c>).</param>
/// <param name="KeptNewer">UID groups the calendars hold in a later version (<c>import.restore.keptNewer</c>).</param>
/// <param name="CalendarIds">The calendars restored.</param>
/// <param name="SubscriptionIds">Subscriptions created again from a backup (refreshed on their schedule: due at once).</param>
public sealed record RestoreOutcome(int Calendars, int KeptNewer, IReadOnlyList<string> CalendarIds, IReadOnlyList<string> SubscriptionIds);

/// <summary>One exported calendar: <c>{Calendar name}.ics</c> (unique within the export) and its text.</summary>
public sealed record ExportFile(string Name, string Text);

/// <summary>Import, restore and export of calendars (§2.17).</summary>
public static class ImportExport
{
    /// <summary>The file types the Import picker offers (§2.17 step 1).</summary>
    public static IReadOnlyList<string> Patterns { get; } = ["*.ics", "*.ical", "*.ifb", "*.zip"];

    /// <summary>The MIME types of the Import picker.</summary>
    public static IReadOnlyList<string> MimeTypes { get; } = ["text/calendar", "application/zip"];

    private const string CalendarIdProperty = "X-THIRTEEN-CALENDAR-ID";
    private const string SubscriptionUrlProperty = "X-THIRTEEN-SUBSCRIPTION-URL";
    private const string SubscriptionIntervalProperty = "X-THIRTEEN-SUBSCRIPTION-INTERVAL";

    // ---- Reading the chosen files (§2.17 steps 1 and 2) ------------------------------------------------

    /// <summary>A file name without its folder and extension.</summary>
    public static string BaseName(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        var slash = Math.Max(name.LastIndexOf('/'), name.LastIndexOf('\\'));
        var file = name[(slash + 1)..];
        var dot = file.LastIndexOf('.');
        return dot > 0 ? file[..dot] : file;
    }

    /// <summary>Reads the files at <paramref name="paths"/> on the thread pool (a file over 25 MB is not read: <see cref="ImportFileError.TooLarge"/>).</summary>
    public static Task<ImportPlan> ReadPathsAsync(IReadOnlyList<string> paths, IZoneResolver zones, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(paths);
        ArgumentNullException.ThrowIfNull(zones);
        return Task.Run(() =>
        {
            var files = new List<(string Name, byte[]? Bytes)>();
            foreach (var path in paths)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var name = Path.GetFileName(path);
                try
                {
                    var info = new FileInfo(path);
                    files.Add((name, info.Length > StoreText.MaxDocumentBytes ? null : File.ReadAllBytes(path)));
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
                {
                    Trace.WriteLine($"Thirteen: a file to import could not be read ({e.GetType().Name})");
                    files.Add((name, []));
                }
            }
            return ReadFiles(files, zones);
        }, cancellationToken);
    }

    /// <summary>
    /// Reads chosen files (§2.17 steps 1 and 2): a zip is opened and each of its calendar entries read; every document is
    /// parsed and counted. A file that is not iCalendar, has no events or is over the limits gets its error instead. A
    /// null <c>Bytes</c> stands for a file too large to read.
    /// </summary>
    public static ImportPlan ReadFiles(IReadOnlyList<(string Name, byte[]? Bytes)> files, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(files);
        ArgumentNullException.ThrowIfNull(zones);
        var result = new List<ImportFile>();
        for (var index = 0; index < files.Count; index++)
        {
            var (name, bytes) = files[index];
            if (bytes is null || bytes.LongLength > StoreText.MaxDocumentBytes)
            {
                result.Add(new ImportFile(name, [], ImportFileError.TooLarge));
                continue;
            }
            List<(string Name, string Id, byte[] Bytes)> documents;
            if (IsZip(bytes))
            {
                try
                {
                    documents = ReadZip(bytes, index);
                }
                catch (Exception e) when (e is InvalidDataException or IOException or NotSupportedException or ArgumentException)
                {
                    result.Add(new ImportFile(name, [], ImportFileError.NotIcs));
                    continue;
                }
                if (documents.Count == 0)
                {
                    result.Add(new ImportFile(name, [], ImportFileError.NotIcs));
                    continue;
                }
            }
            else
            {
                documents = [(name, index.ToString(System.Globalization.CultureInfo.InvariantCulture), bytes)];
            }
            var sources = new List<ImportSource>();
            ImportFileError? error = null;
            foreach (var document in documents)
            {
                var (source, problem) = ReadDocument(document.Name, document.Id, StoreText.Decode(document.Bytes), zones);
                if (source is not null) sources.Add(source);
                else error ??= problem;
            }
            result.Add(new ImportFile(name, sources, sources.Count > 0 ? null : error ?? ImportFileError.NotIcs));
        }
        var all = result.SelectMany(f => f.Sources).ToArray();
        return new ImportPlan(result, all, all.Length > 0 && all.All(s => s.Thirteen is not null));
    }

    private static (ImportSource? Source, ImportFileError? Error) ReadDocument(string name, string id, string text, IZoneResolver zones)
    {
        IcsCalendar calendar;
        try
        {
            calendar = IcsReader.Parse(text, "import-" + id, zones);
        }
        catch (ThirteenException)
        {
            return (null, ImportFileError.NotIcs);
        }
        if (StoreText.EventComponents(calendar) > StoreText.MaxEvents) return (null, ImportFileError.TooLarge);
        var (groups, skipped, _) = StoreText.ParseOutcome(calendar);
        var events = groups + skipped;
        var named = !string.IsNullOrWhiteSpace(calendar.Name);
        var calendarName = named ? calendar.Name!.Trim() : BaseName(name);
        if (calendarName.Length == 0) calendarName = BaseName(name);
        var thirteen = ExportInfoOf(calendar, calendarName);
        // An empty Thirteen export is still a calendar to restore; any other empty file has nothing to import.
        if (events == 0 && thirteen is null) return (null, ImportFileError.Empty);
        return (new ImportSource(id, name, text, events, groups, skipped, calendarName, named, thirteen), null);
    }

    private static ThirteenExportInfo? ExportInfoOf(IcsCalendar calendar, string calendarName)
    {
        var id = PropertyText(calendar, CalendarIdProperty)?.Trim() ?? "";
        if (id.Length == 0) return null;
        var url = PropertyText(calendar, SubscriptionUrlProperty)?.Trim() ?? "";
        var interval = PropertyText(calendar, SubscriptionIntervalProperty)?.Trim() ?? "";
        if (!SubscriptionIntervals.All.Contains(interval)) interval = SubscriptionIntervals.SixHours;
        var color = calendar.Color is { Length: 7 } c && c[0] == '#' && c.Skip(1).All(Uri.IsHexDigit) ? c.ToLowerInvariant() : null;
        return new ThirteenExportInfo(id, url.Length > 0, calendarName, color, url.Length > 0 ? url : null, interval);
    }

    private static string? PropertyText(IcsCalendar calendar, string name) =>
        calendar.Extra.FirstOrDefault(p => p.Name == name) is { } property ? UnescapeText(property.Value) : null;

    /// <summary>The bytes start like a zip (a local header, or the end record of an empty zip).</summary>
    public static bool IsZip(ReadOnlySpan<byte> bytes) =>
        bytes.Length >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4B && ((bytes[2] == 3 && bytes[3] == 4) || (bytes[2] == 5 && bytes[3] == 6));

    private static List<(string Name, string Id, byte[] Bytes)> ReadZip(byte[] bytes, int fileIndex)
    {
        var documents = new List<(string, string, byte[])>();
        using var archive = new ZipArchive(new MemoryStream(bytes, writable: false), ZipArchiveMode.Read);
        var entryIndex = 0;
        long total = 0;
        foreach (var entry in archive.Entries)
        {
            var entryName = entry.FullName;
            if (entryName.EndsWith('/') || entryName.EndsWith('\\')) continue;
            if (!(entryName.EndsWith(".ics", StringComparison.OrdinalIgnoreCase) || entryName.EndsWith(".ical", StringComparison.OrdinalIgnoreCase)
                  || entryName.EndsWith(".ifb", StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }
            total += entry.Length;
            if (entry.Length > StoreText.MaxDocumentBytes || total > 4 * StoreText.MaxDocumentBytes) throw new InvalidDataException("A zip entry is too large");
            using var stream = entry.Open();
            using var memory = new MemoryStream();
            stream.CopyTo(memory);
            documents.Add((entry.Name, $"{fileIndex.ToString(System.Globalization.CultureInfo.InvariantCulture)}/{entryIndex.ToString(System.Globalization.CultureInfo.InvariantCulture)}", memory.ToArray()));
            entryIndex++;
        }
        return documents;
    }

    // ---- Writing an import (§2.17 step 3) -------------------------------------------------------------

    /// <summary>
    /// Imports the chosen documents (§2.17 step 3): new calendars are created first, then every document is merged into
    /// its calendar through the store's read-modify-write of that calendar (<see cref="IcsMerge.ImportCalendar"/>). A new
    /// calendar whose import failed is removed again.
    /// </summary>
    /// <exception cref="EventStoreException">A target is not a writable local calendar, the document would be too large, or the write failed.</exception>
    public static async Task<ImportOutcome> ImportAsync(IEventStore store, IReadOnlyList<ImportChoice> choices, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(choices);
        int added = 0, updated = 0, unchanged = 0, duplicates = 0, partial = 0;
        var ids = new List<string>();
        var created = new List<string>();
        try
        {
            foreach (var choice in choices)
            {
                string id;
                if (choice.Target.CalendarId is { } existing)
                {
                    var state = store.Find(existing) ?? throw new EventStoreException(StoreFailure.NotFound, "The calendar no longer exists");
                    if (!state.IsWritable) throw new EventStoreException(StoreFailure.ReadOnly, "Events can be imported only into a local calendar that can be read");
                    id = existing;
                }
                else
                {
                    var name = string.IsNullOrWhiteSpace(choice.Target.NewName) ? choice.Source.CalendarName : choice.Target.NewName!.Trim();
                    if (string.IsNullOrWhiteSpace(name)) name = EventStoreBase.PersonalName;
                    var state = await store.CreateCalendarAsync(name, cancellationToken: cancellationToken).ConfigureAwait(false);
                    id = state.Id;
                    created.Add(id);
                }
                IcsImportResult? result = null;
                var text = choice.Source.Text;
                await store.UpdateDocumentAsync(id, document =>
                {
                    result = IcsMerge.ImportCalendar(document, text, id, store.Zones);
                    return result.Calendar;
                }, cancellationToken).ConfigureAwait(false);
                if (result is null) continue;
                added += result.Added;
                updated += result.Updated;
                unchanged += result.Unchanged;
                duplicates += result.Skipped;
                partial += choice.Source.Skipped;
                if (!ids.Contains(id)) ids.Add(id);
            }
        }
        catch (Exception e) when (e is EventStoreException or ThirteenException)
        {
            foreach (var id in created.Where(id => !ids.Contains(id))) await TryDeleteAsync(store, id).ConfigureAwait(false);
            if (e is ThirteenException t) throw new EventStoreException(StoreFailure.Changed, $"The file could not be imported: {t.Message}", t);
            throw;
        }
        return new ImportOutcome(added, updated, unchanged, duplicates, partial, ids);
    }

    private static async Task TryDeleteAsync(IEventStore store, string id)
    {
        try
        {
            await store.DeleteCalendarAsync(id).ConfigureAwait(false);
        }
        catch (EventStoreException e)
        {
            Trace.WriteLine($"Thirteen: an empty calendar of a failed import could not be removed ({e.Failure})");
        }
    }

    // ---- Writing a restore (§2.17 "Restore") ----------------------------------------------------------

    /// <summary>A UUID (version 4 layout) derived from a calendar id that cannot be a file name.</summary>
    private static string StableIdFor(string id)
    {
        var hash = System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes("thirteen-calendar-id:" + id));
        hash[6] = (byte)((hash[6] & 0x0F) | 0x40);
        hash[8] = (byte)((hash[8] & 0x3F) | 0x80);
        return new Guid(hash.AsSpan(0, 16), bigEndian: true).ToString("D");
    }

    /// <summary>
    /// Restores Thirteen exports (§2.17 "Restore"): each goes back into the calendar with its <c>X-THIRTEEN-CALENDAR-ID</c>
    /// when that is a calendar of the same kind, else into a new calendar that keeps the id (a new id only when the id
    /// belongs to a calendar of the other kind, or to a local calendar that cannot be read), with the file's name and
    /// color. Local calendars merge version against version (<see cref="IcsMerge.RestoreCalendar"/>); a subscription that
    /// still exists is left as it is, a missing one comes back with the file as its first copy and is due for a refresh at
    /// once. The first-use "Personal", while it is the only calendar and holds nothing, gives way to restored local
    /// calendars, so a restore on a fresh computer gives exactly the backed-up calendars.
    /// </summary>
    /// <exception cref="EventStoreException">A write failed.</exception>
    public static async Task<RestoreOutcome> RestoreAsync(IEventStore store, IReadOnlyList<ImportSource> sources, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(sources);
        var exports = sources.Where(s => s.Thirteen is not null).ToList();
        var planned = new Dictionary<ImportSource, string>();
        foreach (var source in exports)
        {
            var file = source.Thirteen!;
            // An id from the file that is not safe as a file name (written by hand or by another app: a space, "../x")
            // is never used as one; such a calendar comes back under a UUID derived from it, the same on every restore.
            var wanted = EventStoreBase.IsSafeCalendarId(file.CalendarId) ? file.CalendarId : StableIdFor(file.CalendarId);
            var existing = store.Find(wanted);
            var keep = existing is null || (existing.IsSubscription == file.IsSubscription && (file.IsSubscription || !existing.IsUnreadable));
            planned[source] = keep ? wanted : Guid.NewGuid().ToString("D");
        }
        var present = store.Calendars;
        var firstUse = exports.Any(s => !s.Thirteen!.IsSubscription)
            && present.Count == 1
            && present[0] is { IsSubscription: false, Document: { } only } personal
            && personal.Name == EventStoreBase.PersonalName
            && only.Groups.Count == 0 && only.Others.Count == 0
            && !planned.ContainsValue(personal.Id)
                ? present[0].Id
                : null;
        var keptNewer = 0;
        var restored = new List<string>();
        var subscriptions = new List<string>();
        foreach (var source in exports)
        {
            var file = source.Thirteen!;
            var id = planned[source];
            var record = store.Find(id);
            if (record is not null && record.IsSubscription != file.IsSubscription)
            {
                throw new EventStoreException(StoreFailure.Changed, "The calendar changed while restoring");
            }
            if (file.IsSubscription)
            {
                if (!restored.Contains(id)) restored.Add(id);
                if (record is not null) continue; // Feeds are never rewritten (§4.9).
                var subscription = new SubscriptionRecord { Url = file.SubscriptionUrl ?? "", Interval = file.SubscriptionInterval };
                var color = file.Color ?? CalendarPalette.NextFree(store.Calendars.Select(c => c.Color));
                await store.CreateSubscriptionAsync(file.Name, color, subscription, source.Text, id, cancellationToken).ConfigureAwait(false);
                subscriptions.Add(id);
                continue;
            }
            if (record is null) await store.CreateCalendarAsync(file.Name, file.Color, id, cancellationToken).ConfigureAwait(false);
            IcsRestoreResult? result = null;
            var text = source.Text;
            try
            {
                await store.UpdateDocumentAsync(id, document =>
                {
                    result = IcsMerge.RestoreCalendar(document, text, id, store.Zones);
                    return result.Calendar;
                }, cancellationToken).ConfigureAwait(false);
            }
            catch (ThirteenException e)
            {
                throw new EventStoreException(StoreFailure.Changed, $"The backup could not be restored: {e.Message}", e);
            }
            keptNewer += result?.KeptNewer ?? 0;
            if (!restored.Contains(id)) restored.Add(id);
        }
        if (firstUse is not null && store.Find(firstUse) is { IsSubscription: false, Document: { } doc } && doc.Groups.Count == 0 && doc.Others.Count == 0)
        {
            await TryDeleteAsync(store, firstUse).ConfigureAwait(false);
        }
        return new RestoreOutcome(restored.Count, keptNewer, restored, subscriptions);
    }

    // ---- Export (§2.17 "Export") ----------------------------------------------------------------------

    /// <summary>
    /// The export of one calendar: its own <c>VCALENDAR</c> with its name, color and <c>X-THIRTEEN-CALENDAR-ID</c>; a
    /// subscription is its last fetched copy plus <c>X-THIRTEEN-SUBSCRIPTION-URL</c> and <c>-INTERVAL</c>. Groups and
    /// <c>VTIMEZONE</c>s are copied as stored. A calendar whose document cannot be read is exported as its file stands;
    /// null when the calendar is gone (or unreadable without a file).
    /// </summary>
    public static string? ExportText(IEventStore store, string calendarId, LocalDateTime nowUtc)
    {
        ArgumentNullException.ThrowIfNull(store);
        if (store.Find(calendarId) is not { } state) return null;
        if (state.Document is not { } document)
        {
            if (store.Folder is not { } folder) return null;
            try
            {
                return StoreText.Decode(File.ReadAllBytes(Path.Combine(folder, calendarId + ".ics")));
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                return null;
            }
        }
        var extra = SetProperty(document.Extra, CalendarIdProperty, EscapeText(calendarId));
        if (state.Record.Subscription is { } subscription)
        {
            extra = SetProperty(extra, SubscriptionUrlProperty, subscription.Url);
            extra = SetProperty(extra, SubscriptionIntervalProperty, subscription.Interval);
        }
        else
        {
            extra = extra.Where(p => p.Name is not (SubscriptionUrlProperty or SubscriptionIntervalProperty)).ToList();
        }
        var calendar = document with { Name = state.Name, Color = state.Color.ToLowerInvariant(), Extra = extra.ToValueList() };
        return IcsWriter.Serialize(calendar, store.Zones, nowUtc);
    }

    /// <summary>Sets a calendar property in place (later ones of the name removed), or appends it.</summary>
    private static List<IcsProperty> SetProperty(IEnumerable<IcsProperty> extra, string name, string value)
    {
        var list = extra.ToList();
        var index = list.FindIndex(p => p.Name == name);
        var property = new IcsProperty(name, value);
        if (index < 0)
        {
            list.Add(property);
            return list;
        }
        var result = new List<IcsProperty>();
        for (var i = 0; i < list.Count; i++)
        {
            if (i == index) result.Add(property);
            else if (list[i].Name != name) result.Add(list[i]);
        }
        return result;
    }

    /// <summary>Characters Windows does not take in a file name, and control characters, as <c>_</c>; leading and trailing dots and spaces dropped.</summary>
    public static string FileNameOf(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        var builder = new StringBuilder(name.Length);
        foreach (var c in name) builder.Append(c < 0x20 || c == 0x7F || "/\\:*?\"<>|".Contains(c) ? '_' : c);
        var cleaned = builder.ToString().Trim().Trim('.', ' ').Trim();
        if (cleaned.Length == 0) return "Calendar";
        // Names Windows reserves for devices.
        var stem = cleaned.Split('.')[0].ToUpperInvariant();
        if (stem is "CON" or "PRN" or "AUX" or "NUL" || (stem.Length == 4 && (stem.StartsWith("COM", StringComparison.Ordinal) || stem.StartsWith("LPT", StringComparison.Ordinal)) && char.IsAsciiDigit(stem[3])))
        {
            cleaned = "_" + cleaned;
        }
        return cleaned.Length > 120 ? cleaned[..120].TrimEnd('.', ' ') : cleaned;
    }

    /// <summary>One file per calendar, in the given order, with unique names (<c>{name}.ics</c>, then <c>{name} (2).ics</c>, ...).</summary>
    public static IReadOnlyList<ExportFile> ExportFiles(IEventStore store, IReadOnlyList<string> calendarIds, LocalDateTime nowUtc, ISet<string>? taken = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(calendarIds);
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (taken is not null) used.UnionWith(taken);
        var files = new List<ExportFile>();
        foreach (var id in calendarIds)
        {
            if (store.Find(id) is not { } state || ExportText(store, id, nowUtc) is not { } text) continue;
            var name = UniqueName(FileNameOf(state.Name), used);
            used.Add(name);
            files.Add(new ExportFile(name, text));
        }
        return files;
    }

    private static string UniqueName(string stem, ISet<string> used)
    {
        var name = stem + ".ics";
        for (var n = 2; used.Contains(name); n++) name = $"{stem} ({n.ToString(System.Globalization.CultureInfo.InvariantCulture)}).ics";
        return name;
    }

    /// <summary>
    /// Writes the files into <paramref name="folder"/> (Windows: the folder the user chose, §2.17), never over a file that
    /// is already there (a name in use gets " (2)"); returns the paths written. UTF-8 without a byte order mark.
    /// </summary>
    public static Task<IReadOnlyList<string>> WriteFilesAsync(IEventStore store, IReadOnlyList<string> calendarIds, string folder, LocalDateTime nowUtc, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(folder);
        return Task.Run<IReadOnlyList<string>>(() =>
        {
            Directory.CreateDirectory(folder);
            var existing = new HashSet<string>(Directory.EnumerateFiles(folder).Select(Path.GetFileName).OfType<string>(), StringComparer.OrdinalIgnoreCase);
            var paths = new List<string>();
            foreach (var file in ExportFiles(store, calendarIds, nowUtc, existing))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var path = Path.Combine(folder, file.Name);
                using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    var bytes = new UTF8Encoding(false).GetBytes(file.Text);
                    stream.Write(bytes);
                }
                paths.Add(path);
            }
            return paths;
        }, cancellationToken);
    }

    /// <summary>Writes one calendar's export to a stream the user chose (the save picker of a single calendar).</summary>
    public static async Task<bool> WriteOneAsync(IEventStore store, string calendarId, Stream stream, LocalDateTime nowUtc, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(stream);
        var text = await Task.Run(() => ExportText(store, calendarId, nowUtc), cancellationToken).ConfigureAwait(false);
        if (text is null) return false;
        var bytes = new UTF8Encoding(false).GetBytes(text);
        if (stream.CanSeek) stream.SetLength(0);
        await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    /// <summary>The suggested file name of one calendar's export: <c>{Calendar name}.ics</c>.</summary>
    public static string SuggestedName(string calendarName) => FileNameOf(calendarName) + ".ics";

    /// <summary>The current UTC time as an event value (minute precision), for the export's <c>DTSTAMP</c>s.</summary>
    public static LocalDateTime UtcNow(TimeProvider? time = null)
    {
        var now = (time ?? TimeProvider.System).GetUtcNow().UtcDateTime;
        return new LocalDateTime(new GregorianDate(now.Year, now.Month, now.Day), now.Hour * 60 + now.Minute);
    }

    /// <summary>iCalendar TEXT escaping of a property value (<c>\\</c>, <c>;</c>, <c>,</c>, line breaks).</summary>
    private static string EscapeText(string text) =>
        text.Replace("\\", "\\\\", StringComparison.Ordinal).Replace(";", "\\;", StringComparison.Ordinal)
            .Replace(",", "\\,", StringComparison.Ordinal).Replace("\r\n", "\\n", StringComparison.Ordinal)
            .Replace("\n", "\\n", StringComparison.Ordinal).Replace("\r", "\\n", StringComparison.Ordinal);

    private static string UnescapeText(string text)
    {
        if (!text.Contains('\\', StringComparison.Ordinal)) return text;
        var builder = new StringBuilder(text.Length);
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] == '\\' && i + 1 < text.Length)
            {
                var next = text[++i];
                builder.Append(next is 'n' or 'N' ? '\n' : next);
            }
            else
            {
                builder.Append(text[i]);
            }
        }
        return builder.ToString();
    }
}
