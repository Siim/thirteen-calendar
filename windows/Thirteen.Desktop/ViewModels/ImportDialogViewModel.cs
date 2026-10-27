using System.Diagnostics;
using Avalonia.Media;
using Avalonia.Media.Immutable;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>One choice of an "Add to" picker: a local calendar, or "New calendar: {name}".</summary>
/// <param name="Label">The calendar's name (user text), or <c>import.newCalendar</c>.</param>
/// <param name="CalendarId">The calendar, or null for a new one.</param>
public sealed record ImportTargetOption(string Label, string? CalendarId)
{
    /// <inheritdoc />
    public override string ToString() => Label;
}

/// <summary>A row of the Import dialog (one of the records below).</summary>
public abstract class ImportDialogRow : ViewModelBase
{
}

/// <summary>The name of a file, above its block, when several files were chosen (user text).</summary>
public sealed class ImportFileNameRow(string name) : ImportDialogRow
{
    /// <summary>The file's name.</summary>
    public string Name { get; } = name;
}

/// <summary>A file that cannot be imported: "This file isn't a calendar (.ics) file.", "This file has no events.", ...</summary>
public sealed class ImportErrorRow(string text) : ImportDialogRow
{
    /// <summary>The sentence.</summary>
    public string Text { get; } = text;
}

/// <summary>One document to import: "{n} events in {file}" and its "Add to" picker.</summary>
public sealed class ImportSourceRow : ImportDialogRow
{
    private ImportTargetOption _selected;

    internal ImportSourceRow(ImportSource source, IReadOnlyList<ImportTargetOption> calendars, string? defaultCalendarId)
    {
        Source = source;
        Summary = ImportStrings.Summary(source.Events, source.Name);
        var newOption = new ImportTargetOption(ImportStrings.NewCalendar(source.CalendarName), null);
        Targets = [.. calendars, newOption];
        _selected = source.Named || calendars.Count == 0
            ? newOption
            : calendars.FirstOrDefault(c => c.CalendarId == defaultCalendarId) ?? calendars[0];
    }

    /// <summary>The document.</summary>
    public ImportSource Source { get; }

    /// <summary><c>import.summary</c>: "48 events in eesti-puhad-2027.ics".</summary>
    public string Summary { get; }

    /// <summary><c>import.into</c></summary>
    public string IntoLabel => ImportStrings.Into;

    /// <summary>The local calendars, then "New calendar: {name}".</summary>
    public IReadOnlyList<ImportTargetOption> Targets { get; }

    /// <summary>Where it goes: "New calendar" when the file names its calendar, else the default calendar (§2.17 step 2).</summary>
    public ImportTargetOption SelectedTarget
    {
        get => _selected;
        set
        {
            if (value is not null) SetProperty(ref _selected, value);
        }
    }

    /// <summary>The "Add to" picker's accessible name: "Add to, for {file}".</summary>
    public string IntoAutomationName => $"{ImportStrings.Into}, {Source.Name}";

    /// <summary>The choice this row makes.</summary>
    public ImportChoice Choice => new(Source, SelectedTarget.CalendarId is { } id ? ImportTarget.Existing(id) : ImportTarget.New(Source.CalendarName));
}

/// <summary>"{n} calendars in {file}" above a file's calendars in the restore list.</summary>
public sealed class RestoreSummaryRow(string text) : ImportDialogRow
{
    /// <summary><c>import.restore.summary</c></summary>
    public string Text { get; } = text;
}

/// <summary>One calendar of a Thirteen export in the restore list: a checkbox with its name, color, kind and event count.</summary>
public sealed class RestoreCalendarRow : ImportDialogRow
{
    private bool _isChecked = true;
    private readonly Action _changed;

    internal RestoreCalendarRow(ImportSource source, Action changed)
    {
        Source = source;
        _changed = changed;
        var info = source.Thirteen!;
        Name = info.Name;
        Detail = ImportStrings.RestoreDetail(info.IsSubscription, source.Groups);
        Brush = info.Color is { } color && Color.TryParse(color, out var parsed) ? new ImmutableSolidColorBrush(parsed) : new ImmutableSolidColorBrush(Colors.Gray);
    }

    /// <summary>The document.</summary>
    public ImportSource Source { get; }

    /// <summary>The calendar's name (user text).</summary>
    public string Name { get; }

    /// <summary>"local · 41 events" or "subscription".</summary>
    public string Detail { get; }

    /// <summary>The calendar's color.</summary>
    public IBrush Brush { get; }

    /// <summary>The checkbox's accessible name: "Personal, local · 41 events".</summary>
    public string AutomationName => $"{Name}, {Detail}";

    /// <summary>Restored (every calendar is checked at first; any can be unchecked).</summary>
    public bool IsChecked
    {
        get => _isChecked;
        set
        {
            if (SetProperty(ref _isChecked, value)) _changed();
        }
    }
}

/// <summary>
/// "Import events" and "Restore calendars" (docs/EVENTS.md §2.17 step 2, board I2): one block per chosen file ("{n}
/// events in {file}" with its "Add to" picker of the local calendars and "New calendar: {name}"), the errors of files
/// that cannot be read; or, when every file is a Thirteen export, its calendars as a checked list ("{n} calendars in
/// {file}"; name, "local" or "subscription", event count) with "Restore". Import and Restore write through the store;
/// <see cref="Finished"/> gives the result toast's text (null after Cancel).
/// </summary>
public sealed class ImportDialogViewModel : ViewModelBase
{
    private readonly IEventStore _store;
    private bool _isBusy;
    private string? _error;

    /// <summary>The dialog for <paramref name="plan"/> over <paramref name="store"/>; <paramref name="defaultCalendarId"/> is Settings' default calendar.</summary>
    public ImportDialogViewModel(IEventStore store, ImportPlan plan, string? defaultCalendarId = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        Plan = plan ?? throw new ArgumentNullException(nameof(plan));
        var calendars = store.Calendars.Where(c => c.IsWritable).Select(c => new ImportTargetOption(c.Name, c.Id)).ToArray();
        var several = plan.Files.Count > 1;
        var rows = new List<ImportDialogRow>();
        foreach (var file in plan.Files)
        {
            if (several) rows.Add(new ImportFileNameRow(file.Name));
            if (file.Error is { } error)
            {
                rows.Add(new ImportErrorRow(ImportStrings.Error(error)));
                continue;
            }
            if (plan.IsRestore)
            {
                rows.Add(new RestoreSummaryRow(ImportStrings.RestoreSummary(file.Sources.Count, file.Name)));
                rows.AddRange(file.Sources.Select(s => new RestoreCalendarRow(s, OnCheckedChanged)));
            }
            else
            {
                rows.AddRange(file.Sources.Select(s => new ImportSourceRow(s, calendars, defaultCalendarId)));
            }
        }
        Rows = rows;
        ImportCommand = new AsyncRelayCommand(SubmitAsync, CanSubmit);
        CancelCommand = new RelayCommand(() => Finished?.Invoke(null), () => !_isBusy);
    }

    /// <summary>The files read.</summary>
    public ImportPlan Plan { get; }

    /// <summary>Every readable file is a Thirteen export.</summary>
    public bool IsRestore => Plan.IsRestore;

    /// <summary><c>import.title</c> or <c>import.restore.title</c>.</summary>
    public string Title => IsRestore ? ImportStrings.RestoreTitle : ImportStrings.Title;

    /// <summary>The blocks of the dialog, in file order.</summary>
    public IReadOnlyList<ImportDialogRow> Rows { get; }

    /// <summary>A file could be read (else the dialog only lists the errors, with Cancel).</summary>
    public bool HasSources => Plan.Sources.Count > 0;

    /// <summary><c>import.button</c> or <c>import.restore.button</c>.</summary>
    public string SubmitText => IsRestore ? ImportStrings.RestoreButton : ImportStrings.ImportButton;

    /// <summary><c>editor.cancel</c></summary>
    public string CancelText => ImportStrings.Cancel;

    /// <summary>Writing: the buttons wait.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (!SetProperty(ref _isBusy, value)) return;
            ImportCommand.NotifyCanExecuteChanged();
            CancelCommand.NotifyCanExecuteChanged();
        }
    }

    /// <summary>Why the last write failed, or null.</summary>
    public string? Error
    {
        get => _error;
        private set
        {
            if (SetProperty(ref _error, value)) OnPropertyChanged(nameof(HasError));
        }
    }

    /// <summary>Whether <see cref="Error"/> is shown.</summary>
    public bool HasError => _error is not null;

    /// <summary>Import or Restore.</summary>
    public AsyncRelayCommand ImportCommand { get; }

    /// <summary>Cancel (Escape).</summary>
    public RelayCommand CancelCommand { get; }

    /// <summary>Raised with the result toast's text after Import or Restore, or null after Cancel.</summary>
    public event Action<string?>? Finished;

    /// <summary>The outcome of the last import (tests).</summary>
    public ImportOutcome? ImportOutcome { get; private set; }

    /// <summary>The outcome of the last restore (tests).</summary>
    public RestoreOutcome? RestoreOutcome { get; private set; }

    private void OnCheckedChanged() => ImportCommand.NotifyCanExecuteChanged();

    private bool CanSubmit() => !_isBusy && HasSources && (!IsRestore || Rows.OfType<RestoreCalendarRow>().Any(r => r.IsChecked));

    private async Task SubmitAsync()
    {
        if (!CanSubmit()) return;
        IsBusy = true;
        Error = null;
        try
        {
            string toast;
            if (IsRestore)
            {
                var sources = Rows.OfType<RestoreCalendarRow>().Where(r => r.IsChecked).Select(r => r.Source).ToArray();
                RestoreOutcome = await ImportExport.RestoreAsync(_store, sources);
                toast = ImportStrings.RestoreToast(RestoreOutcome);
            }
            else
            {
                var choices = Rows.OfType<ImportSourceRow>().Select(r => r.Choice).ToArray();
                ImportOutcome = await ImportExport.ImportAsync(_store, choices);
                toast = ImportStrings.ImportToast(ImportOutcome);
            }
            IsBusy = false;
            Finished?.Invoke(toast);
        }
        catch (EventStoreException e)
        {
            Trace.WriteLine($"Thirteen: import failed ({e.Failure})");
            Error = ImportStrings.WriteFailure(e.Failure);
            IsBusy = false;
        }
        catch (InvalidOperationException e)
        {
            Trace.WriteLine($"Thirteen: import failed ({e.GetType().Name})");
            Error = ImportStrings.TryAgainLater;
            IsBusy = false;
        }
    }
}

/// <summary>One calendar in the Export dialog: a checkbox with its name and color.</summary>
public sealed class ExportCalendarOption : ViewModelBase
{
    private bool _isChecked;
    private readonly Action _changed;

    internal ExportCalendarOption(CalendarState calendar, bool isChecked, Action changed)
    {
        Id = calendar.Id;
        Name = calendar.Name;
        IsSubscription = calendar.IsSubscription;
        Brush = Color.TryParse(calendar.Color, out var color) ? new ImmutableSolidColorBrush(color) : new ImmutableSolidColorBrush(Colors.Gray);
        _isChecked = isChecked;
        _changed = changed;
    }

    /// <summary>The calendar id.</summary>
    public string Id { get; }

    /// <summary>The calendar's name (user text).</summary>
    public string Name { get; }

    /// <summary>A subscription (its export carries its link).</summary>
    public bool IsSubscription { get; }

    /// <summary>The calendar's color.</summary>
    public IBrush Brush { get; }

    /// <summary>Exported.</summary>
    public bool IsChecked
    {
        get => _isChecked;
        set
        {
            if (SetProperty(ref _isChecked, value)) _changed();
        }
    }
}

/// <summary>
/// "Export" (docs/EVENTS.md §2.17): the calendars as checkboxes ("Calendars to export"; a calendar's own Export checks
/// just that one, every other entry point every calendar). One calendar gives one <c>{name}.ics</c> (a save picker),
/// several one file each in a folder ("Choose a folder"). When a subscription is chosen: "Exported subscriptions include
/// their links. Treat secret links like passwords." The writing is done by <see cref="Export"/>, which the window gives
/// (the pickers belong to it).
/// </summary>
public sealed class ExportDialogViewModel : ViewModelBase
{
    private bool _isBusy;
    private string? _error;

    /// <summary>The dialog over <paramref name="store"/>'s calendars; <paramref name="initial"/>: the calendars checked at first (null: all).</summary>
    public ExportDialogViewModel(IEventStore store, IReadOnlyCollection<string>? initial = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        Calendars = store.Calendars
            .Select(c => new ExportCalendarOption(c, initial is null || initial.Contains(c.Id), OnChanged))
            .ToArray();
        ExportCommand = new AsyncRelayCommand(SubmitAsync, () => !_isBusy && Chosen.Count > 0);
        CancelCommand = new RelayCommand(() => Finished?.Invoke(false), () => !_isBusy);
    }

    /// <summary>Every calendar, in the list's order.</summary>
    public IReadOnlyList<ExportCalendarOption> Calendars { get; }

    /// <summary>The checked calendars' ids, in order.</summary>
    public IReadOnlyList<string> Chosen => Calendars.Where(c => c.IsChecked).Select(c => c.Id).ToArray();

    /// <summary><c>export.title</c></summary>
    public string Title => ImportStrings.ExportTitle;

    /// <summary><c>export.calendars</c></summary>
    public string CalendarsLabel => ImportStrings.ExportCalendars;

    /// <summary><c>export.button</c></summary>
    public string ExportText => ImportStrings.ExportButton;

    /// <summary><c>editor.cancel</c></summary>
    public string CancelText => ImportStrings.Cancel;

    /// <summary><c>export.secretLinks</c></summary>
    public string SecretLinksText => ImportStrings.SecretLinks;

    /// <summary>A subscription is among the chosen calendars: the secret-links note is shown.</summary>
    public bool ShowsSecretLinks => Calendars.Any(c => c.IsChecked && c.IsSubscription);

    /// <summary>Picking and writing: the buttons wait.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (!SetProperty(ref _isBusy, value)) return;
            ExportCommand.NotifyCanExecuteChanged();
            CancelCommand.NotifyCanExecuteChanged();
        }
    }

    /// <summary>Why the export failed, or null.</summary>
    public string? Error
    {
        get => _error;
        private set
        {
            if (SetProperty(ref _error, value)) OnPropertyChanged(nameof(HasError));
        }
    }

    /// <summary>Whether <see cref="Error"/> is shown.</summary>
    public bool HasError => _error is not null;

    /// <summary>Export.</summary>
    public AsyncRelayCommand ExportCommand { get; }

    /// <summary>Cancel (Escape).</summary>
    public RelayCommand CancelCommand { get; }

    /// <summary>
    /// Picks where the chosen calendars go and writes them: true when written, false when the user canceled the picker
    /// (the dialog stays), or throws <see cref="IOException"/> / <see cref="UnauthorizedAccessException"/> on a failed write.
    /// </summary>
    public Func<IReadOnlyList<string>, Task<bool>>? Export { get; set; }

    /// <summary>Raised with true after a written export, false after Cancel.</summary>
    public event Action<bool>? Finished;

    private void OnChanged()
    {
        OnPropertyChanged(nameof(ShowsSecretLinks));
        ExportCommand.NotifyCanExecuteChanged();
    }

    private async Task SubmitAsync()
    {
        var chosen = Chosen;
        if (chosen.Count == 0 || Export is not { } export) return;
        IsBusy = true;
        Error = null;
        try
        {
            var written = await export(chosen);
            IsBusy = false;
            if (written) Finished?.Invoke(true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidOperationException or NotSupportedException)
        {
            Trace.WriteLine($"Thirteen: export failed ({e.GetType().Name})");
            Error = ImportStrings.TryAgainLater;
            IsBusy = false;
        }
    }
}
