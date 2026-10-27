using System.ComponentModel;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Platform.Storage;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views.Events;

namespace Thirteen.Desktop.Views;

// The main window's part of tasks W8 and W9 (docs/EVENTS.md §2.17, §2.20, §6.4): import and export (the Calendars pane's
// buttons, Ctrl+O and Ctrl+Shift+E, files dropped on the window, files from the command line), the result toast, the
// Windows text size and the device time zone checks on the clock timer and on activation.
public partial class MainWindow
{
    private ImportExportFlow? _flow;
    private MainViewModel? _eventsModel;
    private CalendarsPaneViewModel? _pane;

    /// <summary>
    /// Whether the window follows Windows' text size (<c>UISettings.TextScaleFactor</c>, read at start and on every
    /// activation). False when <c>--text-scale</c> fixed it (QA, screenshots).
    /// </summary>
    public bool FollowsSystemTextScale { get; set; }

    /// <summary>Import and export over this window.</summary>
    public ImportExportFlow ImportExport => _flow ??= new ImportExportFlow(
        this,
        () => _eventsModel?.Events?.Store ?? Events?.Store,
        () => _eventsModel?.State.DefaultCalendarId,
        ShowNotice);

    /// <summary>Shows a result toast at the bottom of the window ("Added 46, updated 0, unchanged 0.").</summary>
    public void ShowNotice(string text) => Notice.Show(text);

    /// <summary>The result toast (tests).</summary>
    public NoticeToast NoticeToast => Notice;

    private void InitializeEvents()
    {
        DragDrop.SetAllowDrop(this, true);
        AddHandler(DragDrop.DragOverEvent, OnDragOver);
        AddHandler(DragDrop.DropEvent, OnDrop);
        _clockTimer.Tick += (_, _) => Events?.CheckDeviceZone();
        Activated += (_, _) =>
        {
            Events?.CheckDeviceZone();
            // A contrast theme turned on or off in Settings while Thirteen was in the background (§2.20).
            (Avalonia.Application.Current as App)?.RefreshHighContrast();
            if (FollowsSystemTextScale && _eventsModel is { } model && TextScaling.ReadSystem() is { } scale) model.State.TextScale = scale;
        };
        DataContextChanged += (_, _) => AttachEventsModel(DataContext as MainViewModel);
        AttachEventsModel(DataContext as MainViewModel);
    }

    private void AttachEventsModel(MainViewModel? model)
    {
        if (ReferenceEquals(model, _eventsModel)) return;
        if (_eventsModel is not null)
        {
            _eventsModel.PropertyChanged -= OnEventsModelChanged;
            _eventsModel.State.PropertyChanged -= OnEventsStateChanged;
        }
        _eventsModel = model;
        if (model is not null)
        {
            model.PropertyChanged += OnEventsModelChanged;
            model.State.PropertyChanged += OnEventsStateChanged;
            TextScaling.SetScale(this, model.State.TextScale);
        }
        AttachPane(model?.CalendarsPane);
    }

    private void OnEventsModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(MainViewModel.CalendarsPane)) AttachPane(_eventsModel?.CalendarsPane);
    }

    private void OnEventsStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(AppState.TextScale) && _eventsModel is { } model) TextScaling.SetScale(this, model.State.TextScale);
    }

    /// <summary>"Import .ics file" and "Export" of the Calendars pane (and Ctrl+O, Ctrl+Shift+E, Settings' "Export all") open their flows here.</summary>
    private void AttachPane(CalendarsPaneViewModel? pane)
    {
        if (ReferenceEquals(pane, _pane)) return;
        if (_pane is not null)
        {
            _pane.ImportRequested -= OnImportRequested;
            _pane.ExportRequested -= OnExportRequested;
        }
        _pane = pane;
        if (pane is not null)
        {
            pane.ImportRequested += OnImportRequested;
            pane.ExportRequested += OnExportRequested;
        }
    }

    private void OnImportRequested() => _ = ImportExport.PickAndImportAsync();

    private void OnExportRequested(string? calendarId) => _ = ImportExport.ExportAsync(calendarId);

    /// <summary>Files to import from the command line or a second start (§6.4): the Import dialog with them.</summary>
    private void ImportFiles(IReadOnlyList<string> paths) => _ = ImportExport.ImportAsync(paths);

    // ---- Dropping files on the window (§2.17 step 1) ---------------------------------------------------

    private static IReadOnlyList<string> DroppedCalendarFiles(DragEventArgs e)
    {
#pragma warning disable CS0618 // Avalonia 11.3: IDataObject.GetFiles is the drop's file list.
        var files = e.Data.GetFiles();
#pragma warning restore CS0618
        if (files is null) return [];
        return files.Select(f => f.TryGetLocalPath()).OfType<string>().Where(ExternalRequest.IsImportFile).ToArray();
    }

    private void OnDragOver(object? sender, DragEventArgs e)
    {
        if (e.Handled) return;
#pragma warning disable CS0618
        if (!e.Data.Contains(DataFormats.Files)) return;
#pragma warning restore CS0618
        e.DragEffects = DroppedCalendarFiles(e).Count > 0 && _eventsModel?.Events is not null ? DragDropEffects.Copy : DragDropEffects.None;
        e.Handled = true;
    }

    private void OnDrop(object? sender, DragEventArgs e)
    {
        if (e.Handled) return;
#pragma warning disable CS0618
        if (!e.Data.Contains(DataFormats.Files)) return;
#pragma warning restore CS0618
        var paths = DroppedCalendarFiles(e);
        e.Handled = true;
        if (paths.Count > 0) ImportFiles(paths);
    }
}
