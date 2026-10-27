using System.ComponentModel;
using System.Globalization;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>A screen of the app, kept alive while the window is open so it keeps its position.</summary>
public abstract class PageViewModel : ViewModelBase
{
    private bool _isActive;
    private bool _wasActivated;

    /// <summary>Creates the page for <paramref name="shell"/>.</summary>
    protected PageViewModel(MainViewModel shell, AppSection section)
    {
        Shell = shell;
        Section = section;
    }

    /// <summary>The window's model.</summary>
    public MainViewModel Shell { get; }

    /// <summary>App-wide state.</summary>
    public AppState State => Shell.State;

    /// <summary>Which screen this is.</summary>
    public AppSection Section { get; }

    /// <summary>"Today", "Year", ...</summary>
    public string Title => Section.Title();

    /// <summary>
    /// The widest the page's content gets, in device-independent pixels. The content is left-aligned under
    /// the page title (Windows 11 Settings), and the window's header uses the same width, so the title, the
    /// header's commands and the content share their edges at every window size.
    /// </summary>
    public virtual double ContentMaxWidth => 1320;

    /// <summary>Whether the page is the visible one.</summary>
    public bool IsActive
    {
        get => _isActive;
        internal set
        {
            if (!SetProperty(ref _isActive, value)) return;
            if (value && !_wasActivated)
            {
                _wasActivated = true;
                OnPropertyChanged(nameof(Loaded));
            }
        }
    }

    /// <summary>The page once it has been shown (null before), so its view is only built when first needed.</summary>
    public PageViewModel? Loaded => _wasActivated ? this : null;
}

/// <summary>A navigation pane item.</summary>
public sealed class NavItemViewModel : ViewModelBase
{
    private readonly MainViewModel _shell;
    private bool _isSelected;

    internal NavItemViewModel(MainViewModel shell, AppSection section)
    {
        _shell = shell;
        Section = section;
    }

    /// <summary>The section it opens.</summary>
    public AppSection Section { get; }

    /// <summary>"Today".</summary>
    public string Title => Section.Title();

    /// <summary>Segoe Fluent Icons glyph.</summary>
    public string Glyph => Section.Glyph();

    /// <summary>"Today (Ctrl+1)".</summary>
    public string ToolTip => $"{Section.Title()} ({Section.Shortcut()})";

    /// <summary>Whether this section is shown. Setting it to true navigates.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set
        {
            if (value && _shell.Section != Section) _shell.Section = Section;
            SetProperty(ref _isSelected, _shell.Section == Section);
        }
    }

    internal void Refresh() => SetProperty(ref _isSelected, _shell.Section == Section, nameof(IsSelected));
}

/// <summary>
/// The window's model: navigation (the visible screen and each screen's position), the day-detail pane,
/// the calendar-system switch, keyboard commands and deep links. A port of the Apple apps' AppModel.
/// </summary>
public sealed class MainViewModel : ViewModelBase
{
    private AppSection _section = AppSection.Today;
    private DayDetailViewModel? _detail;
    private bool _isPaneOpen;

    /// <summary>A window model over <paramref name="state"/>, starting on Today.</summary>
    public MainViewModel(AppState state)
    {
        State = state;
        _isPaneOpen = state.PaneExpanded;
        NavItems = AppSections.Content.Select(s => new NavItemViewModel(this, s)).ToArray();
        SettingsItem = new NavItemViewModel(this, AppSection.Settings);

        TodayPage = new TodayViewModel(this);
        CalendarPage = new CalendarViewModel(this);
        ConvertPage = new ConvertViewModel(this);
        ComparePage = new CompareViewModel(this);
        HistoryPage = new HistoryViewModel(this);
        SettingsPage = new SettingsViewModel(this);

        NavigateCommand = new RelayCommand<AppSection>(s => Section = s);
        GoToTodayCommand = new RelayCommand(GoToToday);
        HomeCommand = new RelayCommand(Home);
        PreviousPeriodCommand = new RelayCommand(() => StepPeriod(-1));
        NextPeriodCommand = new RelayCommand(() => StepPeriod(1));
        SetCalendarModeCommand = new RelayCommand<CalendarMode>(mode =>
        {
            Section = AppSection.Calendar;
            CalendarPage.Mode = mode;
        });
        NewEventCommand = new RelayCommand(() =>
        {
            Section = AppSection.Calendar;
            CalendarPage.NewEvent(null, null);
        });
        ShowCalendarsPaneCommand = new RelayCommand(() => ShowCalendarsPane(focusHidden: false));
        RefreshSubscriptionsCommand = new RelayCommand(() => _ = RefreshSubscriptionsAsync());
        // Window key bindings run before the focused control sees the key (Avalonia), and pass it on while their command
        // cannot execute: these act only in Calendar with an event selected, so Delete, Ctrl+Z and Ctrl+Y keep working
        // in the text fields of the other screens.
        EditEventCommand = new RelayCommand(() => CalendarPage.EditSelected(null), () => _section == AppSection.Calendar && CalendarPage.SelectedItem is not null);
        DeleteEventCommand = new RelayCommand(() => CalendarPage.DeleteSelected(null), () => _section == AppSection.Calendar && CalendarPage.SelectedItem is not null);
        // Undo and Redo act on events, so they work in every section while the window's history has a change (an event
        // deleted from Today's Up next, §2.11); outside Calendar a focused text field keeps its own Ctrl+Z and Ctrl+Y.
        UndoCommand = new RelayCommand(() => CalendarPage.Actions.Undo(),
            () => _section == AppSection.Calendar || (CalendarPage.Actions.CanUndo && !TextInputFocused()));
        RedoCommand = new RelayCommand(() => CalendarPage.Actions.Redo(),
            () => _section == AppSection.Calendar || (CalendarPage.Actions.CanRedo && !TextInputFocused()));
        CloseDetailCommand = new RelayCommand(CloseDetail);
        TogglePaneCommand = new RelayCommand(() => IsPaneOpen = !IsPaneOpen);
        // Only while there is something to close, so Esc otherwise reaches the focused control (Month's chips, flyouts).
        EscapeCommand = new RelayCommand(Escape, () => HasDetail);

        state.PropertyChanged += OnStateChanged;
        state.TodayChanged += (_, e) => OnTodayChanged(e.Previous, e.Now);
        UpdateSelection();
    }

    /// <summary>App-wide state.</summary>
    public AppState State { get; }

    /// <summary>The five content sections.</summary>
    public IReadOnlyList<NavItemViewModel> NavItems { get; }

    /// <summary>Settings, at the bottom of the pane.</summary>
    public NavItemViewModel SettingsItem { get; }

    /// <summary>Today.</summary>
    public TodayViewModel TodayPage { get; }

    /// <summary>Calendar (its Year, Month, Week, Day and List modes).</summary>
    public CalendarViewModel CalendarPage { get; }

    /// <summary>Convert.</summary>
    public ConvertViewModel ConvertPage { get; }

    /// <summary>Compare.</summary>
    public CompareViewModel ComparePage { get; }

    /// <summary>History.</summary>
    public HistoryViewModel HistoryPage { get; }

    /// <summary>Settings.</summary>
    public SettingsViewModel SettingsPage { get; }

    /// <summary>Every page.</summary>
    public IEnumerable<PageViewModel> Pages => [TodayPage, CalendarPage, ConvertPage, ComparePage, HistoryPage, SettingsPage];

    /// <summary>The visible screen.</summary>
    public AppSection Section
    {
        get => _section;
        set
        {
            if (!SetProperty(ref _section, value)) return;
            UpdateSelection();
            OnPropertyChanged(nameof(CurrentPage));
            OnPropertyChanged(nameof(ShowsSystemSwitch));
            OnPropertyChanged(nameof(ShowsCalendarsPane));
            OnPropertyChanged(nameof(ShowsTodaySummary));
        }
    }

    /// <summary>The visible page.</summary>
    public PageViewModel CurrentPage => Pages.First(p => p.Section == _section);

    /// <summary>
    /// The IFC / Positivist switch is shown on the content screens. Settings has its own, and Calendar's toolbar has
    /// exactly the controls of docs/EVENTS.md §2.1 (boards A2, F1), so it stays on one line at 1280 px; the system is
    /// chosen in Settings or on the other screens there.
    /// </summary>
    public bool ShowsSystemSwitch => _section is not (AppSection.Settings or AppSection.Calendar);

    /// <summary>The open day-detail pane, or null.</summary>
    public DayDetailViewModel? Detail
    {
        get => _detail;
        private set
        {
            if (!SetProperty(ref _detail, value)) return;
            OnPropertyChanged(nameof(HasDetail));
            CalendarPage.YearMode.UpdateSelection(value?.Date);
        }
    }

    /// <summary>Whether the day-detail pane is open.</summary>
    public bool HasDetail => _detail is not null;

    /// <summary>Whether the navigation pane is expanded.</summary>
    public bool IsPaneOpen
    {
        get => _isPaneOpen;
        set
        {
            if (!SetProperty(ref _isPaneOpen, value)) return;
            OnPropertyChanged(nameof(PaneToggleName));
            OnPropertyChanged(nameof(ShowsCalendarsPane));
            OnPropertyChanged(nameof(ShowsTodaySummary));
        }
    }

    /// <summary>What the menu button does now, for its tooltip and screen readers (WinUI: Open / Close Navigation).</summary>
    public string PaneToggleName => _isPaneOpen ? "Close navigation" : "Open navigation";

    // ---- System switch ------------------------------------------------------------------------

    /// <summary>"IFC".</summary>
    public string IfcLabel => CalendarSystemId.Ifc.ShortName();

    /// <summary>"Positivist".</summary>
    public string PositivistLabel => CalendarSystemId.Positivist.ShortName();

    /// <summary>The IFC is selected (radio binding).</summary>
    public bool IsIfc
    {
        get => State.System == CalendarSystemId.Ifc;
        set
        {
            if (value) State.System = CalendarSystemId.Ifc;
        }
    }

    /// <summary>The Positivist calendar is selected (radio binding).</summary>
    public bool IsPositivist
    {
        get => State.System == CalendarSystemId.Positivist;
        set
        {
            if (value) State.System = CalendarSystemId.Positivist;
        }
    }

    // ---- Today summary in the pane ------------------------------------------------------------

    /// <summary>"Thu, Oct 12, 2026" (the 13-month date).</summary>
    public string SummaryThirteen
    {
        get
        {
            var thirteen = State.Today.ToThirteen(State.System);
            return thirteen.Format(new FormatOptions(DateStyle.Medium, IncludeWeekday: !thirteen.IsIntercalary));
        }
    }

    /// <summary>"Mon, Oct 19, 2026".</summary>
    public string SummaryGregorian => State.Today.Format(new FormatOptions(DateStyle.Medium, IncludeWeekday: true));

    /// <summary>"73 days until Year Day".</summary>
    public string SummaryCountdown => Phrasing.Countdown(State.Today.DaysUntilYearDay(State.System), State.System);

    /// <summary>The summary for screen readers.</summary>
    public string SummaryAutomationName => "Today: " + Phrasing.BothDates(State.Today.ToThirteen(State.System), State.Today);

    /// <summary>The window title: "Thirteen".</summary>
    public string WindowTitle => "Thirteen";

    // ---- Commands -----------------------------------------------------------------------------

    /// <summary>Ctrl+1..5, Ctrl+Comma, navigation pane.</summary>
    public RelayCommand<AppSection> NavigateCommand { get; }

    /// <summary>Ctrl+T: Today, and Year, Compare and Convert back to today.</summary>
    public RelayCommand GoToTodayCommand { get; }

    /// <summary>Home: today on the current screen.</summary>
    public RelayCommand HomeCommand { get; }

    /// <summary>Ctrl+Left: the previous page of Calendar's mode (or year of Compare).</summary>
    public RelayCommand PreviousPeriodCommand { get; }

    /// <summary>Ctrl+Right.</summary>
    public RelayCommand NextPeriodCommand { get; }

    /// <summary>Ctrl+Shift+1 to 5: Day, Week, Month, Year, List (§2.21).</summary>
    public RelayCommand<CalendarMode> SetCalendarModeCommand { get; }

    /// <summary>Ctrl+N: the editor on a new event on Calendar's day.</summary>
    public RelayCommand NewEventCommand { get; }

    /// <summary>Ctrl+Shift+K: the Calendars pane.</summary>
    public RelayCommand ShowCalendarsPaneCommand { get; }

    /// <summary>F5, Ctrl+R: updates every subscription now.</summary>
    public RelayCommand RefreshSubscriptionsCommand { get; }

    /// <summary>Ctrl+E: edits the selected event.</summary>
    public RelayCommand EditEventCommand { get; }

    /// <summary>Delete: deletes the selected event.</summary>
    public RelayCommand DeleteEventCommand { get; }

    /// <summary>Ctrl+Z: undo (task W7's undo stack, through <see cref="CalendarViewModel.Actions"/>).</summary>
    public RelayCommand UndoCommand { get; }

    /// <summary>Ctrl+Y: redo.</summary>
    public RelayCommand RedoCommand { get; }

    /// <summary>Whether a text field has the keyboard focus (the window sets it; Ctrl+Z and Ctrl+Y then stay the field's outside Calendar).</summary>
    public Func<bool> TextInputFocused { get; set; } = static () => false;

    /// <summary>Closes the day-detail pane.</summary>
    public RelayCommand CloseDetailCommand { get; }

    /// <summary>Expands or collapses the navigation pane.</summary>
    public RelayCommand TogglePaneCommand { get; }

    /// <summary>Escape: closes the detail pane.</summary>
    public RelayCommand EscapeCommand { get; }

    // ---- Actions ------------------------------------------------------------------------------

    /// <summary>Opens the comparison pane for a day.</summary>
    public void ShowDetail(GregorianDate date)
    {
        if (_detail is { } open)
        {
            open.Date = date;
            CalendarPage.YearMode.UpdateSelection(date);
        }
        else
        {
            Detail = new DayDetailViewModel(this, date);
        }
    }

    /// <summary>Closes the comparison pane.</summary>
    public void CloseDetail() => Detail = null;

    /// <summary>Called by the detail pane when it steps to another day.</summary>
    internal void DetailDateChanged(GregorianDate date) => CalendarPage.YearMode.UpdateSelection(date);

    /// <summary>Opens Calendar's Year mode on <paramref name="date"/>'s year, revealing its month, optionally with its comparison ("Show in Year").</summary>
    public void ShowInYear(GregorianDate date, bool detail = true)
    {
        Section = AppSection.Calendar;
        CalendarPage.Mode = CalendarMode.Year;
        CalendarPage.Date = date;
        if (detail) ShowDetail(date);
        CalendarPage.YearMode.Reveal(date);
    }

    /// <summary>Opens the converter on a day, Gregorian side first.</summary>
    public void OpenInConverter(GregorianDate date)
    {
        ConvertPage.ConvertDay = date;
        ConvertPage.Direction = ConvertDirection.FromGregorian;
        Section = AppSection.Convert;
        CloseDetail();
    }

    /// <summary>
    /// Ctrl+T: in Calendar, today in the current mode (its toolbar's "Today", §2.21); elsewhere, shows Today and moves
    /// Calendar, Compare and Convert back to the current day.
    /// </summary>
    public void GoToToday()
    {
        State.RefreshToday();
        if (_section == AppSection.Calendar)
        {
            CalendarPage.ShowToday();
            return;
        }
        Section = AppSection.Today;
        CalendarPage.Date = State.Today;
        ComparePage.Year = State.Today.Year;
        ConvertPage.ConvertDay = State.Today;
    }

    /// <summary>Home: today in the current screen's own terms.</summary>
    public void Home()
    {
        State.RefreshToday();
        switch (_section)
        {
            case AppSection.Calendar:
                CalendarPage.ShowToday();
                break;
            case AppSection.Compare:
                ComparePage.Year = State.Today.Year;
                break;
            case AppSection.Convert:
                ConvertPage.ConvertDay = State.Today;
                break;
            case AppSection.Settings:
                break;
            default:
                Section = AppSection.Today;
                break;
        }
    }

    /// <summary>
    /// Ctrl+Left / Ctrl+Right: the previous or next page of Calendar's mode (§2.21, "now the mode's unit") or year of
    /// Compare; from Today, Convert and History it opens Calendar and pages it.
    /// </summary>
    public void StepPeriod(int delta)
    {
        switch (_section)
        {
            case AppSection.Compare:
                ComparePage.Year = ClampYear(ComparePage.Year + delta);
                break;
            case AppSection.Calendar:
                CalendarPage.Page(delta);
                break;
            case AppSection.Settings:
                break;
            default:
                Section = AppSection.Calendar;
                CalendarPage.Page(delta);
                break;
        }
    }

    private void Escape()
    {
        if (HasDetail) CloseDetail();
    }

    // ---- Events ---------------------------------------------------------------------------------

    /// <summary>The events of this window (null until <see cref="AttachEvents"/>; the UI tests attach the mockup data set).</summary>
    public EventsModel? Events { get; private set; }

    /// <summary>The Calendars pane, shown under the sections while Calendar is selected (§2.1, §2.15), or null.</summary>
    public CalendarsPaneViewModel? CalendarsPane { get; private set; }

    /// <summary>Whether the navigation pane shows the Calendars list (Calendar selected, pane open).</summary>
    public bool ShowsCalendarsPane => _section == AppSection.Calendar && CalendarsPane is not null && _isPaneOpen
        && Events is { IsLoaded: true } or { LoadFailed: true };

    /// <summary>Whether the navigation pane shows today at a glance (pane open, not the Calendars list).</summary>
    public bool ShowsTodaySummary => _isPaneOpen && !ShowsCalendarsPane;

    /// <summary>
    /// Raised when the Calendars pane should take the focus (Ctrl+Shift+K, "Subscriptions not updated", "Show calendars");
    /// the argument is true when the focus goes to the first hidden calendar's checkbox.
    /// </summary>
    public event Action<bool>? CalendarsPaneRequested;

    /// <summary>
    /// Gives the window its events (App, once the <see cref="Services.EventsHost"/> exists; tests with the mockup data
    /// set): the Calendar section, the Calendars pane and, for tasks W9, Today and the day details read them from here.
    /// </summary>
    public void AttachEvents(EventsModel events, CalendarsPaneViewModel? pane = null)
    {
        ArgumentNullException.ThrowIfNull(events);
        if (Events is { } old) old.Changed -= OnEventsChanged;
        Events = events;
        CalendarsPane = pane;
        events.Store.System = State.System;
        events.Changed += OnEventsChanged;
        OnPropertyChanged(nameof(Events));
        OnPropertyChanged(nameof(CalendarsPane));
        OnPropertyChanged(nameof(ShowsCalendarsPane));
        OnPropertyChanged(nameof(ShowsTodaySummary));
        CalendarPage.EventsChanged();
    }

    private void OnEventsChanged(object? sender, EventArgs e)
    {
        // The pane shows once the calendars have loaded (or failed to), not as empty groups before.
        OnPropertyChanged(nameof(ShowsCalendarsPane));
        OnPropertyChanged(nameof(ShowsTodaySummary));
        CalendarPage.EventsChanged();
        Detail?.Events.Refresh();
        EventsChanged?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Raised on the UI thread after the events changed (Today's Up next and the day details listen, task W9).</summary>
    public event EventHandler? EventsChanged;

    /// <summary>Opens the navigation pane on the Calendars list and asks the window to focus it.</summary>
    public void ShowCalendarsPane(bool focusHidden)
    {
        if (CalendarsPane is null) return;
        Section = AppSection.Calendar;
        IsPaneOpen = true;
        CalendarsPaneRequested?.Invoke(focusHidden);
    }

    /// <summary>F5, Ctrl+R: every subscription is updated now (one refresh per subscription at a time, §6.4).</summary>
    public async Task RefreshSubscriptionsAsync()
    {
        if (Events?.Subscriptions is not { } subscriptions) return;
        foreach (var calendar in Events.Store.Calendars.Where(c => c.IsSubscription).ToList())
        {
            try
            {
                await subscriptions.RefreshAsync(calendar.Id);
            }
            catch (Exception e) when (e is Services.EventStoreException or InvalidOperationException)
            {
                System.Diagnostics.Trace.WriteLine($"Thirteen: could not refresh {calendar.Id}: {e.Message}");
            }
        }
    }

    /// <summary>The day of a New event link that arrived before the window had its events (a cold start), or null.</summary>
    public GregorianDate? DeferredNewEvent { get; private set; }

    /// <summary>
    /// Opens the editor of a deferred New event link once the window has its event actions and the calendars have
    /// loaded; false while they are not there yet (the window tries again when they are).
    /// </summary>
    public bool OpenDeferredNewEvent()
    {
        if (DeferredNewEvent is not { } day || CalendarPage.Actions is PlaceholderCalendarActions || Events is not { IsLoaded: true }) return false;
        DeferredNewEvent = null;
        CalendarPage.NewEvent(day, null);
        return true;
    }

    /// <summary>Navigates to a deep link's destination.</summary>
    public void Open(DeepLink link)
    {
        if (link.System is { } system) State.System = system;
        CloseDetail();
        switch (link.Kind)
        {
            case DeepLinkKind.Today:
                State.RefreshToday();
                Section = AppSection.Today;
                break;
            case DeepLinkKind.Calendar:
                Section = AppSection.Calendar;
                break;
            case DeepLinkKind.Year:
                Section = AppSection.Calendar;
                CalendarPage.Mode = CalendarMode.Year;
                if (link.Day is { } yearDay && (link.Year is null || link.Year == yearDay.Year)) CalendarPage.Date = yearDay;
                else if (link.Year is { } year) CalendarPage.SetYear(year);
                if (link.Day is { } day)
                {
                    ShowDetail(day);
                    if (day.Year == CalendarPage.YearMode.Year) CalendarPage.YearMode.Reveal(day);
                }
                break;
            case DeepLinkKind.Month:
            {
                Section = AppSection.Calendar;
                var current = CalendarPeriod.MonthOf(CalendarPage.Date, State.System);
                var year = link.Year ?? current.Year;
                var month = link.Month ?? (year == current.Year ? current.Month : CalendarPeriod.MonthOf(State.Today, State.System).Month);
                CalendarPage.ShowMonth(year, month);
                break;
            }
            case DeepLinkKind.Week:
                Section = AppSection.Calendar;
                CalendarPage.Mode = CalendarMode.Week;
                CalendarPage.Date = link.Day ?? State.Today;
                break;
            case DeepLinkKind.Day:
                Section = AppSection.Calendar;
                CalendarPage.OpenDay(link.Day ?? State.Today);
                break;
            case DeepLinkKind.NewEvent:
                Section = AppSection.Calendar;
                CalendarPage.Date = link.Day ?? State.Today;
                // A cold start (thirteen://new-event, --route new-event) opens the link before the window has its event
                // actions and its calendars: the editor opens once they are there (§2.22).
                if (Events is not { IsLoaded: true }) DeferredNewEvent = CalendarPage.Date;
                else CalendarPage.NewEvent(CalendarPage.Date, null);
                break;
            case DeepLinkKind.Convert:
                Section = AppSection.Convert;
                if (link.Day is { } date) ConvertPage.ConvertDay = date;
                if (link.Direction is { } direction) ConvertPage.Direction = direction;
                break;
            case DeepLinkKind.Compare:
                Section = AppSection.Compare;
                if (link.Year is { } compareYear) ComparePage.Year = compareYear;
                break;
            case DeepLinkKind.History:
                Section = AppSection.History;
                break;
        }
    }

    /// <summary>Clamps to the supported years 1..9999.</summary>
    public static int ClampYear(int year) => Math.Clamp(year, GregorianDate.MinYear, GregorianDate.MaxYear);

    private void UpdateSelection()
    {
        foreach (var item in NavItems) item.Refresh();
        SettingsItem.Refresh();
        foreach (var page in Pages) page.IsActive = page.Section == _section;
    }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(AppState.System):
                OnPropertyChanged(nameof(IsIfc));
                OnPropertyChanged(nameof(IsPositivist));
                RaiseSummary();
                Detail?.Refresh();
                break;
            case nameof(AppState.Today):
                RaiseSummary();
                Detail?.Refresh();
                break;
        }
    }

    private void RaiseSummary()
    {
        OnPropertyChanged(nameof(SummaryThirteen));
        OnPropertyChanged(nameof(SummaryGregorian));
        OnPropertyChanged(nameof(SummaryCountdown));
        OnPropertyChanged(nameof(SummaryAutomationName));
    }

    /// <summary>Screens that were showing the old current year move on with it; a year or day the user picked stays.</summary>
    private void OnTodayChanged(GregorianDate previous, GregorianDate now)
    {
        CalendarPage.TodayChanged(previous, now);
        if (ComparePage.Year == previous.Year) ComparePage.Year = now.Year;
        if (ConvertPage.ConvertDay == previous) ConvertPage.ConvertDay = now;
    }

    internal static string Number(int value) => value.ToString(CultureInfo.InvariantCulture);
}
