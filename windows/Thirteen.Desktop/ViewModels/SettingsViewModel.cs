using System.ComponentModel;
using System.Globalization;
using System.Reflection;
using Thirteen.Core;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.Themes;

namespace Thirteen.Desktop.ViewModels;

/// <summary>One theme in the picker.</summary>
public sealed class ThemeOption(ThirteenTheme theme)
{
    /// <summary>The theme.</summary>
    public ThirteenTheme Theme { get; } = theme;

    /// <summary>"Almanac".</summary>
    public string Name => Theme.DisplayName();

    /// <summary>One line describing the theme.</summary>
    public string Summary => Theme.Summary();

    /// <summary>"almanac".</summary>
    public string Id => Theme.Id();

    /// <inheritdoc />
    public override string ToString() => Name;
}

/// <summary>
/// A heading in the theme picker (design/DECISIONS.md): "Light and dark" (the themes that follow Windows or
/// the Appearance setting), then "Dark" (always dark). Each group is its own list, so arrow keys browse a
/// group and Tab moves to the next; one theme is chosen across both.
/// </summary>
public sealed class ThemeGroupOption : ViewModelBase
{
    private readonly SettingsViewModel _owner;

    internal ThemeGroupOption(SettingsViewModel owner, ThemeGroup group)
    {
        _owner = owner;
        Group = group;
        Themes = group.Themes().Select(t => new ThemeOption(t)).ToArray();
    }

    /// <summary>The group.</summary>
    public ThemeGroup Group { get; }

    /// <summary>"Light and dark", "Dark".</summary>
    public string Name => Group.DisplayName();

    /// <summary>"Follows the system, or the Appearance setting.", "Always dark, whatever the system or the Appearance setting."</summary>
    public string Summary => DisplayText.WithoutDashes(Group.Summary()).Replace("the system", "Windows", StringComparison.Ordinal);

    /// <summary>The group's themes, in token order.</summary>
    public IReadOnlyList<ThemeOption> Themes { get; }

    /// <summary>The chosen theme if it is in this group, else null (list selection; arrow keys move it).</summary>
    public ThemeOption? SelectedTheme
    {
        get => Themes.FirstOrDefault(t => t.Theme == _owner.State.Theme);
        set
        {
            if (value is not null) _owner.State.Theme = value.Theme;
        }
    }

    internal void Refresh() => OnPropertyChanged(nameof(SelectedTheme));
}

/// <summary>One appearance choice.</summary>
public sealed class AppearanceOption(SettingsViewModel owner, AppearanceMode mode) : ViewModelBase
{
    /// <summary>The mode.</summary>
    public AppearanceMode Mode { get; } = mode;

    /// <summary>"Use Windows setting", "Light", "Dark".</summary>
    public string Name => Mode.DisplayName();

    /// <summary>Selected (radio binding). While an always-dark theme is chosen, Dark shows as selected.</summary>
    public bool IsSelected
    {
        get => owner.IsAppearanceLocked ? Mode == AppearanceMode.Dark : owner.State.Appearance == Mode;
        set
        {
            if (value && !owner.IsAppearanceLocked) owner.State.Appearance = Mode;
        }
    }

    internal void Refresh() => OnPropertyChanged(nameof(IsSelected));
}

/// <summary>One calendar system choice.</summary>
public sealed class SystemOption(SettingsViewModel owner, CalendarSystemId system) : ViewModelBase
{
    /// <summary>The system.</summary>
    public CalendarSystemId System { get; } = system;

    /// <summary>"International Fixed Calendar".</summary>
    public string Name => DisplayText.WithoutDashes(System.Name());

    /// <summary>"Moses B. Cotsworth, 1902".</summary>
    public string Origin => $"{DisplayText.WithoutDashes(System.Definition().Inventor)}, {System.Definition().ProposedYear.ToString(CultureInfo.InvariantCulture)}";

    /// <summary>Selected (radio binding).</summary>
    public bool IsSelected
    {
        get => owner.State.System == System;
        set
        {
            if (value) owner.State.System = System;
        }
    }

    internal void Refresh() => OnPropertyChanged(nameof(IsSelected));
}

/// <summary>A keyboard shortcut and what it does.</summary>
public sealed record ShortcutRow(string Keys, string Action);

/// <summary>One choice of Settings' "Default calendar": a writable local calendar (equal by id and name).</summary>
/// <param name="Name">The calendar's name (user text).</param>
/// <param name="Id">The calendar id.</param>
public sealed record DefaultCalendarChoice(string Name, string Id)
{
    /// <inheritdoc />
    public override string ToString() => Name;
}

/// <summary>
/// Settings: colour theme (eight swatches in two groups, with a live preview), light or dark, the calendar system and the
/// Year-grid overlay, plus version and licences. Every choice applies at once and is saved to
/// %APPDATA%\Thirteen\settings.json.
/// </summary>
public sealed class SettingsViewModel : PageViewModel
{
    private SettingsPreview _preview;

    /// <summary>Creates the page.</summary>
    public SettingsViewModel(MainViewModel shell) : base(shell, AppSection.Settings)
    {
        ThemeGroups = ThemeTokens.Groups.Select(g => new ThemeGroupOption(this, g)).ToArray();
        Themes = ThemeGroups.SelectMany(g => g.Themes).ToArray();
        Appearances = AppearanceModes.Ordered.Select(m => new AppearanceOption(this, m)).ToArray();
        Systems = CalendarSystemIdExtensions.All.Select(s => new SystemOption(this, s)).ToArray();
        _preview = new SettingsPreview(State.Today, State.System);
        State.PropertyChanged += OnStateChanged;
        OpenFolderCommand = new CommunityToolkit.Mvvm.Input.RelayCommand(
            () => Services.FolderLauncher.Open(Shell.Events?.Store.Folder),
            () => Shell.Events?.Store.Folder is not null);
        ExportAllCommand = new CommunityToolkit.Mvvm.Input.RelayCommand(
            () => Shell.CalendarsPane?.ExportCommand.Execute(null),
            () => Shell.CalendarsPane?.ExportCommand.CanExecute(null) == true && Shell.Events?.Store.Calendars.Count > 0);
        shell.EventsChanged += (_, _) => RefreshCalendar();
        shell.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName is nameof(MainViewModel.Events) or nameof(MainViewModel.CalendarsPane)) RefreshCalendar();
        };
        RefreshCalendar();
    }

    // ---- Calendar (docs/EVENTS.md §2.18) --------------------------------------------------------

    private IReadOnlyList<DefaultCalendarChoice> _defaultCalendars = [];

    /// <summary><c>settings.group</c>: "Calendar".</summary>
    public string CalendarGroupText => ImportStrings.SettingsGroup;

    /// <summary><c>settings.defaultCalendar</c></summary>
    public string DefaultCalendarText => ImportStrings.DefaultCalendar;

    /// <summary>The writable local calendars, in the list's order.</summary>
    public IReadOnlyList<DefaultCalendarChoice> DefaultCalendars
    {
        get => _defaultCalendars;
        private set => SetProperty(ref _defaultCalendars, value);
    }

    /// <summary>Whether there is a calendar to choose (none before the calendars load, or after every local one was deleted).</summary>
    public bool HasDefaultCalendars => _defaultCalendars.Count > 0;

    /// <summary>The calendar new events go to (the chosen one, else "Personal", the first local calendar).</summary>
    public DefaultCalendarChoice? SelectedDefaultCalendar
    {
        get
        {
            if (Shell.Events?.Store is not { } store || Services.DefaultCalendar.Resolve(store, State.DefaultCalendarId) is not { } calendar) return null;
            return _defaultCalendars.FirstOrDefault(c => c.Id == calendar.Id);
        }
        set
        {
            if (value is not null) State.DefaultCalendarId = value.Id;
        }
    }

    /// <summary><c>settings.defaultCalendar.footer</c>: "New events go to Personal."</summary>
    public string DefaultCalendarFooter => ImportStrings.DefaultCalendarFooter(
        Shell.Events?.Store is { } store ? Services.DefaultCalendar.NameOf(store, State.DefaultCalendarId) : Services.EventStoreBase.PersonalName);

    /// <summary><c>settings.yearDots</c></summary>
    public string YearDotsText => ImportStrings.YearDots;

    /// <summary>"Show events in Year view" (default on): Year mode draws event dots.</summary>
    public bool ShowsYearEvents
    {
        get => State.ShowsYearEvents;
        set => State.ShowsYearEvents = value;
    }

    /// <summary><c>event.alerts</c></summary>
    public string AlertsText => ImportStrings.Alerts;

    /// <summary><c>settings.alerts.windows.footer</c></summary>
    public string AlertsFooter => ImportStrings.AlertsFooter;

    /// <summary><c>settings.data</c></summary>
    public string YourDataText => ImportStrings.YourData;

    /// <summary><c>calendars.storage.windows</c></summary>
    public string StorageText => ImportStrings.StorageWindows;

    /// <summary><c>calendars.openFolder</c></summary>
    public string OpenFolderText => ImportStrings.OpenFolder;

    /// <summary><c>settings.exportAll</c></summary>
    public string ExportAllText => ImportStrings.ExportAll;

    /// <summary>"Open folder": the Calendars folder in Explorer.</summary>
    public CommunityToolkit.Mvvm.Input.RelayCommand OpenFolderCommand { get; }

    /// <summary>"Export all": the Export dialog with every calendar checked (§2.17; a folder of files).</summary>
    public CommunityToolkit.Mvvm.Input.RelayCommand ExportAllCommand { get; }

    private void RefreshCalendar()
    {
        DefaultCalendars = Shell.Events?.Store is { IsLoaded: true } store
            ? store.Calendars.Where(c => c.IsWritable).Select(c => new DefaultCalendarChoice(c.Name, c.Id)).ToArray()
            : [];
        OnPropertyChanged(nameof(HasDefaultCalendars));
        OnPropertyChanged(nameof(SelectedDefaultCalendar));
        OnPropertyChanged(nameof(DefaultCalendarFooter));
        OpenFolderCommand.NotifyCanExecuteChanged();
        ExportAllCommand.NotifyCanExecuteChanged();
    }

    /// <inheritdoc />
    public override double ContentMaxWidth => 920;

    /// <summary>The picker's groups: the five light-and-dark themes, then the three always-dark ones.</summary>
    public IReadOnlyList<ThemeGroupOption> ThemeGroups { get; }

    /// <summary>Every theme, in token order.</summary>
    public IReadOnlyList<ThemeOption> Themes { get; }

    /// <summary>The chosen theme (arrow keys in the picker move it, so the app re-themes as you browse).</summary>
    public ThemeOption? SelectedTheme
    {
        get => Themes.First(t => t.Theme == State.Theme);
        set
        {
            if (value is not null) State.Theme = value.Theme;
        }
    }

    /// <summary>"Almanac: Warm paper and iron-gall ink with a signal orange accent."</summary>
    public string ThemeSummary => $"{State.Theme.DisplayName()}: {DisplayText.WithoutDashes(State.Theme.Summary())}";

    /// <summary>An always-dark theme is chosen: the app is dark whatever the Appearance setting says.</summary>
    public bool IsAppearanceLocked => State.Theme.IsAlwaysDark();

    /// <summary>Whether the Appearance choices can be changed.</summary>
    public bool IsAppearanceEnabled => !IsAppearanceLocked;

    /// <summary>The line above the Appearance choices.</summary>
    public string AppearanceNote => IsAppearanceLocked
        ? $"{State.Theme.DisplayName()} is always dark. Pick a light and dark theme to use Appearance again."
        : "Light and dark follow Windows unless you pick one here.";

    /// <summary>System, Light, Dark.</summary>
    public IReadOnlyList<AppearanceOption> Appearances { get; }

    /// <summary>IFC, Positivist.</summary>
    public IReadOnlyList<SystemOption> Systems { get; }

    /// <summary>Whether the Year grids show Gregorian dates.</summary>
    public bool ShowsGregorianOverlay
    {
        get => State.ShowsGregorianOverlay;
        set => State.ShowsGregorianOverlay = value;
    }

    /// <summary>Today's plate and progress in the current theme.</summary>
    public SettingsPreview Preview
    {
        get => _preview;
        private set => SetProperty(ref _preview, value);
    }

    /// <summary>"Thirteen 1.0.0".</summary>
    public string VersionText => $"Thirteen {AppVersion}";

    /// <summary>"Version 1.0.0 (1.0.0.1)".</summary>
    public string VersionDetail
    {
        get
        {
            var file = typeof(SettingsViewModel).Assembly.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version ?? AppVersion;
            return $"Version {AppVersion} (build {file})";
        }
    }

    /// <summary>The product version, without build metadata.</summary>
    public static string AppVersion
    {
        get
        {
            var info = typeof(SettingsViewModel).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "1.0.0";
            var plus = info.IndexOf('+', StringComparison.Ordinal);
            return plus < 0 ? info : info[..plus];
        }
    }

    /// <summary>The keyboard shortcuts.</summary>
    public IReadOnlyList<ShortcutRow> Shortcuts { get; } =
    [
        new("Ctrl+1 to Ctrl+5", "Today, Calendar, Convert, Compare, History"),
        new("Ctrl+,", "Settings"),
        new("Ctrl+T", "Today, with every screen back on the current date; in Calendar, today in its view"),
        new("Home", "Today on the current screen"),
        new("Ctrl+Left, Ctrl+Right", "Previous or next page of Calendar's view, or year on Compare"),
        new("Ctrl+Shift+1 to Ctrl+Shift+5", "Day, Week, Month, Year, List"),
        new("Ctrl+N", "New event"),
        new("Arrow keys", "Move between days in a grid"),
        new("Enter or F2, Esc", "Into a day's events in Month, and back to the day"),
        new("Ctrl+E, Delete", "Edit or delete the selected event"),
        new("Ctrl+Z, Ctrl+Y", "Undo or redo a move, delete or save"),
        new("Ctrl+Shift+K", "Calendars"),
        new("F5, Ctrl+R", "Update subscriptions"),
        new("Ctrl+O, Ctrl+Shift+E", "Import or export calendars"),
        new("Alt+Left, Alt+Right", "Previous or next day in the day details"),
        new("Esc", "Close the day details"),
    ];

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(AppState.Theme):
                OnPropertyChanged(nameof(SelectedTheme));
                OnPropertyChanged(nameof(ThemeSummary));
                OnPropertyChanged(nameof(IsAppearanceLocked));
                OnPropertyChanged(nameof(IsAppearanceEnabled));
                OnPropertyChanged(nameof(AppearanceNote));
                foreach (var group in ThemeGroups) group.Refresh();
                foreach (var option in Appearances) option.Refresh();
                break;
            case nameof(AppState.Appearance):
                foreach (var option in Appearances) option.Refresh();
                break;
            case nameof(AppState.System):
                foreach (var option in Systems) option.Refresh();
                Preview = new SettingsPreview(State.Today, State.System);
                break;
            case nameof(AppState.Today):
                Preview = new SettingsPreview(State.Today, State.System);
                break;
            case nameof(AppState.ShowsGregorianOverlay):
                OnPropertyChanged(nameof(ShowsGregorianOverlay));
                break;
            case nameof(AppState.ShowsYearEvents):
                OnPropertyChanged(nameof(ShowsYearEvents));
                break;
            case nameof(AppState.DefaultCalendarId):
                OnPropertyChanged(nameof(SelectedDefaultCalendar));
                OnPropertyChanged(nameof(DefaultCalendarFooter));
                break;
        }
    }
}

/// <summary>The live preview in Settings: today's plate and year progress.</summary>
public sealed class SettingsPreview(GregorianDate today, CalendarSystemId system)
{
    /// <summary>Today's comparison.</summary>
    public Comparison Comparison { get; } = new(today, system);

    /// <summary>Today's plate.</summary>
    public DatePlateModel Plate { get; } = DatePlateModel.Create(new Comparison(today, system));
}
