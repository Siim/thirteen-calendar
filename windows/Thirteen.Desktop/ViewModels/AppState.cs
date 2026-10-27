using Thirteen.Core;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Themes;

namespace Thirteen.Desktop.ViewModels;

/// <summary>The app's screens, in navigation order (Settings sits at the bottom of the pane).</summary>
public enum AppSection
{
    /// <summary>Today (Ctrl+1).</summary>
    Today,

    /// <summary>Calendar (Ctrl+2): Day, Week, Month, Year and List modes (docs/EVENTS.md §2.1); it replaces Year in the same place.</summary>
    Calendar,

    /// <summary>Convert (Ctrl+3).</summary>
    Convert,

    /// <summary>Compare (Ctrl+4).</summary>
    Compare,

    /// <summary>History (Ctrl+5).</summary>
    History,

    /// <summary>Settings (Ctrl+Comma).</summary>
    Settings,
}

/// <summary>Titles, icons and ids of <see cref="AppSection"/>.</summary>
public static class AppSections
{
    /// <summary>The five content screens, in navigation order.</summary>
    public static IReadOnlyList<AppSection> Content { get; } =
        [AppSection.Today, AppSection.Calendar, AppSection.Convert, AppSection.Compare, AppSection.History];

    /// <summary>"Today", "Calendar", ...</summary>
    public static string Title(this AppSection section) => section switch
    {
        AppSection.Today => "Today",
        AppSection.Calendar => Support.CalendarStrings.NavCalendar,
        AppSection.Convert => "Convert",
        AppSection.Compare => "Compare",
        AppSection.History => "History",
        _ => "Settings",
    };

    /// <summary>The Segoe Fluent Icons glyph of the navigation item.</summary>
    public static string Glyph(this AppSection section) => section switch
    {
        AppSection.Today => "",    // Brightness (sun)
        AppSection.Calendar => "",     // Calendar (the icon and place Year had, §2.1)
        AppSection.Convert => "",  // Switch
        AppSection.Compare => "",  // AreaChart
        AppSection.History => "",  // History
        _ => "",                   // Setting
    };

    /// <summary>"Ctrl+1" ... "Ctrl+5", "Ctrl+,".</summary>
    public static string Shortcut(this AppSection section) => section switch
    {
        AppSection.Settings => "Ctrl+,",
        _ => "Ctrl+" + ((int)section + 1).ToString(System.Globalization.CultureInfo.InvariantCulture),
    };

    /// <summary>"today", "calendar", ... (command line, tests).</summary>
    public static string Id(this AppSection section) => section.ToString().ToLowerInvariant();

    /// <summary>The section with this id, or null.</summary>
    public static AppSection? FromId(string? id) =>
        !int.TryParse(id, out _) && Enum.TryParse<AppSection>(id, ignoreCase: true, out var section) && Enum.IsDefined(section) ? section : null;
}

/// <summary>
/// App-wide state: the calendar system, the Year-grid overlay, the colour theme and light or dark (all
/// persisted to settings.json), and today's date, kept current by <see cref="RefreshToday"/>. Free of
/// Avalonia types; the theme reaches the UI through <see cref="IThemeService"/>.
/// </summary>
public sealed class AppState : ViewModelBase
{
    private readonly ISettingsStore _store;
    private readonly IThemeService _themes;
    private readonly Func<GregorianDate> _clock;
    private readonly AppSettings _settings;
    private CalendarSystemId _system;
    private bool _showsGregorianOverlay;
    private ThirteenTheme _theme;
    private AppearanceMode _appearance;
    private GregorianDate _today;
    private double _textScale = 1;

    /// <summary>Reads the stored settings and today's date.</summary>
    public AppState(ISettingsStore store, IThemeService themes, Func<GregorianDate>? clock = null)
    {
        _store = store;
        _themes = themes;
        _clock = clock ?? LocalClock.Today;
        _settings = store.Load();
        _system = CalendarSystemIdExtensions.TryParse(_settings.System?.ToLowerInvariant(), out var system) ? system : CalendarSystemId.Ifc;
        _showsGregorianOverlay = _settings.ShowsGregorianOverlay;
        _theme = ThemeTokens.FromId(_settings.Theme?.ToLowerInvariant());
        _appearance = AppearanceModes.FromId(_settings.Appearance);
        _today = _clock();
    }

    /// <summary>Raised when the local date changes (midnight, clock or time-zone change).</summary>
    public event EventHandler<TodayChangedEventArgs>? TodayChanged;

    /// <summary>The 13-month system every screen shows. Persisted.</summary>
    public CalendarSystemId System
    {
        get => _system;
        set
        {
            if (!SetProperty(ref _system, value)) return;
            _settings.System = value.RawValue();
            Save();
        }
    }

    /// <summary>Whether the Year grids show the Gregorian date in every cell. Persisted.</summary>
    public bool ShowsGregorianOverlay
    {
        get => _showsGregorianOverlay;
        set
        {
            if (!SetProperty(ref _showsGregorianOverlay, value)) return;
            _settings.ShowsGregorianOverlay = value;
            Save();
        }
    }

    /// <summary>
    /// "Show events in Year view" (docs/EVENTS.md §2.3, §2.18; on by default): Year mode draws event dots. Persisted. The
    /// Settings row is task W9's.
    /// </summary>
    public bool ShowsYearEvents
    {
        get => _settings.ShowsYearEvents;
        set
        {
            if (_settings.ShowsYearEvents == value) return;
            _settings.ShowsYearEvents = value;
            OnPropertyChanged();
            Save();
        }
    }

    /// <summary>
    /// "Default calendar" (docs/EVENTS.md §2.15, §2.18): the calendar the user chose for new events, or null for the
    /// platform default. Persisted. Resolve it with <see cref="Services.DefaultCalendar.Resolve"/>, which falls back
    /// silently when the chosen calendar is gone or cannot be written.
    /// </summary>
    public string? DefaultCalendarId
    {
        get => _settings.DefaultCalendarId;
        set
        {
            if (_settings.DefaultCalendarId == value) return;
            _settings.DefaultCalendarId = value;
            OnPropertyChanged();
            Save();
        }
    }

    /// <summary>
    /// The 13-month date picker opens on the tab last used on this device (docs/EVENTS.md §2.12): true for the Gregorian
    /// tab. Persisted with the other per-device view settings.
    /// </summary>
    public bool DatePickerOnGregorian
    {
        get => _settings.DatePickerTab == "gregorian";
        set
        {
            if (DatePickerOnGregorian == value) return;
            _settings.DatePickerTab = value ? "gregorian" : null;
            OnPropertyChanged();
            Save();
        }
    }

    /// <summary>
    /// The Windows text scale (1 = 100 %; <c>UISettings.TextScaleFactor</c> on the Windows target, read at start and on
    /// activation by task W9; <c>--text-scale</c> for QA). Not persisted.
    /// </summary>
    public double TextScale
    {
        get => _textScale;
        set
        {
            value = double.IsFinite(value) ? Math.Clamp(value, 1, 2.25) : 1;
            if (SetProperty(ref _textScale, value)) OnPropertyChanged(nameof(UsesLargeText));
        }
    }

    /// <summary>
    /// Accessibility text sizes (150 % and above, §2.4, §2.20): Month becomes a list of days and Week falls back to Day.
    /// </summary>
    public bool UsesLargeText => _textScale >= 1.5;

    /// <summary>The colour theme. Persisted; applied at once.</summary>
    public ThirteenTheme Theme
    {
        get => _theme;
        set
        {
            if (!SetProperty(ref _theme, value)) return;
            _settings.Theme = value.Id();
            Save();
            ApplyTheme();
        }
    }

    /// <summary>Light, dark or the Windows setting. Persisted; applied at once.</summary>
    public AppearanceMode Appearance
    {
        get => _appearance;
        set
        {
            if (!SetProperty(ref _appearance, value)) return;
            _settings.Appearance = value.Id();
            Save();
            ApplyTheme();
        }
    }

    /// <summary>Whether the navigation pane is expanded on wide windows. Persisted.</summary>
    public bool PaneExpanded
    {
        get => _settings.PaneExpanded;
        set
        {
            if (_settings.PaneExpanded == value) return;
            _settings.PaneExpanded = value;
            OnPropertyChanged();
            Save();
        }
    }

    /// <summary>Where the main window was last closed. Persisted.</summary>
    public WindowPlacement? WindowPlacement
    {
        get => _settings.Window;
        set
        {
            if (_settings.Window == value) return;
            _settings.Window = value;
            Save();
        }
    }

    /// <summary>Today's local date (Gregorian).</summary>
    public GregorianDate Today
    {
        get => _today;
        private set => SetProperty(ref _today, value);
    }

    /// <summary>Re-reads the clock; returns true (and raises <see cref="TodayChanged"/>) when the day changed.</summary>
    public bool RefreshToday()
    {
        var now = _clock();
        if (now == _today) return false;
        var previous = _today;
        Today = now;
        TodayChanged?.Invoke(this, new TodayChangedEventArgs(previous, now));
        return true;
    }

    /// <summary>Applies the current theme and appearance through the theme service.</summary>
    public void ApplyTheme() => _themes.Apply(_theme, _appearance);

    private void Save() => _store.Save(_settings);
}

/// <summary>The previous and the new local date.</summary>
public sealed class TodayChangedEventArgs(GregorianDate previous, GregorianDate now) : EventArgs
{
    /// <summary>The date before the change.</summary>
    public GregorianDate Previous { get; } = previous;

    /// <summary>The new date.</summary>
    public GregorianDate Now { get; } = now;
}
