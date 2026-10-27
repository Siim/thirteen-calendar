using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Platform.Storage;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.Events;

/// <summary>
/// Import and export over a window (docs/EVENTS.md §2.17, §6.4 ImportExport.cs): the open picker (several files), the
/// files read off the UI thread, the Import or Restore dialog and its result toast; the Export dialog with the save picker
/// (one calendar) or the folder picker (several, "Choose a folder"). Started by "Import .ics file" and "Export" in the
/// Calendars pane and a calendar's settings, Ctrl+O and Ctrl+Shift+E, "Export all" in Settings, files dropped on the
/// window, and <c>Thirteen.exe "file.ics"</c> / <c>--import</c> (also from a second start).
/// </summary>
public sealed class ImportExportFlow
{
    private readonly Window _owner;
    private readonly Func<IEventStore?> _store;
    private readonly Func<string?> _defaultCalendarId;
    private readonly Action<string> _notify;
    private bool _busy;

    /// <summary>The flow over <paramref name="owner"/>; <paramref name="notify"/> shows a result toast.</summary>
    public ImportExportFlow(Window owner, Func<IEventStore?> store, Func<string?> defaultCalendarId, Action<string> notify)
    {
        _owner = owner ?? throw new ArgumentNullException(nameof(owner));
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _defaultCalendarId = defaultCalendarId ?? throw new ArgumentNullException(nameof(defaultCalendarId));
        _notify = notify ?? throw new ArgumentNullException(nameof(notify));
    }

    /// <summary>A picker or dialog of this flow is open (a second request waits for it to close).</summary>
    public bool IsBusy => _busy;

    /// <summary>The Import dialog open now (tests), or null.</summary>
    public ImportDialog? OpenImportDialog { get; private set; }

    /// <summary>The Export dialog open now (tests), or null.</summary>
    public ExportDialog? OpenExportDialog { get; private set; }

    /// <summary>The type filter of the Import picker (§2.17 step 1).</summary>
    public static FilePickerFileType CalendarFiles { get; } = new("Calendar (.ics)")
    {
        Patterns = [.. ImportExport.Patterns],
        MimeTypes = [.. ImportExport.MimeTypes],
        AppleUniformTypeIdentifiers = ["com.apple.ical.ics", "public.zip-archive"],
    };

    /// <summary>"Import .ics file", Ctrl+O: the open picker (several files may be chosen), then the Import dialog.</summary>
    public async Task PickAndImportAsync()
    {
        if (_busy || _store() is null) return;
        _busy = true;
        IReadOnlyList<IStorageFile> picked;
        try
        {
            picked = await _owner.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
            {
                Title = ImportStrings.Title,
                AllowMultiple = true,
                FileTypeFilter = [CalendarFiles],
            });
        }
        catch (Exception e) when (e is InvalidOperationException or NotSupportedException or IOException)
        {
            Trace.WriteLine($"Thirteen: the open picker failed ({e.GetType().Name})");
            _busy = false;
            return;
        }
        _busy = false;
        var paths = picked.Select(f => f.TryGetLocalPath()).OfType<string>().ToArray();
        if (paths.Length > 0) await ImportAsync(paths);
    }

    /// <summary>
    /// The Import dialog for files given by path (the picker, a drop, the command line): the files are read and counted
    /// off the UI thread once the calendars have loaded; nothing is written before Import or Restore is pressed.
    /// </summary>
    public async Task ImportAsync(IReadOnlyList<string> paths)
    {
        ArgumentNullException.ThrowIfNull(paths);
        if (_busy || paths.Count == 0 || _store() is not { } store) return;
        _busy = true;
        try
        {
            try
            {
                // A file given at start-up can arrive before the calendars have loaded: the dialog lists them.
                await store.LoadAsync();
            }
            catch (EventStoreException e)
            {
                Trace.WriteLine($"Thirteen: no Import dialog, the calendars could not be loaded ({e.Failure})");
                return;
            }
            var plan = await ImportExport.ReadPathsAsync(paths, store.Zones);
            await ShowImportDialogAsync(store, plan);
        }
        finally
        {
            _busy = false;
        }
    }

    private async Task ShowImportDialogAsync(IEventStore store, ImportPlan plan)
    {
        var model = new ImportDialogViewModel(store, plan, _defaultCalendarId());
        var dialog = new ImportDialog { DataContext = model };
        string? toast = null;
        model.Finished += text =>
        {
            toast = text;
            dialog.Close();
        };
        OpenImportDialog = dialog;
        try
        {
            await dialog.ShowDialog(_owner);
        }
        finally
        {
            OpenImportDialog = null;
        }
        if (toast is not null) _notify(toast);
    }

    /// <summary>"Export" (the pane, a calendar's settings with its id, Ctrl+Shift+E, "Export all" in Settings): the Export dialog.</summary>
    public async Task ExportAsync(string? calendarId = null)
    {
        if (_busy || _store() is not { } store) return;
        _busy = true;
        try
        {
            try
            {
                await store.LoadAsync();
            }
            catch (EventStoreException)
            {
                return;
            }
            if (store.Calendars.Count == 0) return;
            var initial = calendarId is not null && store.Find(calendarId) is not null ? new[] { calendarId } : null;
            var model = new ExportDialogViewModel(store, initial);
            var dialog = new ExportDialog { DataContext = model };
            model.Export = ids => WriteAsync(dialog, store, ids);
            model.Finished += _ => dialog.Close();
            OpenExportDialog = dialog;
            try
            {
                await dialog.ShowDialog(_owner);
            }
            finally
            {
                OpenExportDialog = null;
            }
        }
        finally
        {
            _busy = false;
        }
    }

    /// <summary>
    /// One calendar: the save picker with <c>{name}.ics</c>; several: the folder picker ("Choose a folder") and one file per
    /// calendar written into it, never over a file already there. False when the user canceled a picker.
    /// </summary>
    internal static async Task<bool> WriteAsync(TopLevel picker, IEventStore store, IReadOnlyList<string> ids)
    {
        var now = ImportExport.UtcNow((store as EventStoreBase)?.Clock);
        if (ids.Count == 1)
        {
            if (store.Find(ids[0]) is not { } calendar) return false;
            var file = await picker.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
            {
                Title = ImportStrings.ExportTitle,
                SuggestedFileName = ImportExport.SuggestedName(calendar.Name),
                DefaultExtension = "ics",
                ShowOverwritePrompt = true,
                FileTypeChoices = [new FilePickerFileType("Calendar (.ics)") { Patterns = ["*.ics"], MimeTypes = ["text/calendar"] }],
            });
            if (file is null) return false;
            await using var stream = await file.OpenWriteAsync();
            if (!await ImportExport.WriteOneAsync(store, calendar.Id, stream, now)) throw new IOException("The calendar could not be exported");
            return true;
        }
        var folders = await picker.StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions
        {
            Title = ImportStrings.ChooseFolder,
            AllowMultiple = false,
        });
        if (folders.Count == 0) return false;
        var path = folders[0].TryGetLocalPath() ?? throw new IOException("The chosen folder has no local path");
        await ImportExport.WriteFilesAsync(store, ids, path, now);
        return true;
    }
}
