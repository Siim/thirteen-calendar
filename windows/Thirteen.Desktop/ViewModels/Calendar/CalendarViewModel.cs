using System.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// The Calendar section (docs/EVENTS.md §2.1): its five modes, the day it is about, the toolbar ("‹", "›", "Today", the
/// title and subtitle, the "Subscriptions not updated" status button, the segmented mode control, "New event") and the
/// keyboard of §2.21. It replaces the Year section in the same place (Ctrl+2), and Year is one of its modes.
/// <para>
/// <b>Seams for the tasks after W5</b> (one file per view, so they can work in parallel):
/// </para>
/// <list type="bullet">
/// <item>W6, Week and Day timelines with drag and drop: <see cref="WeekModeViewModel"/> (ViewModels/Calendar/WeekModeViewModel.cs)
/// and <see cref="DayModeViewModel"/> with their views Views/Calendar/WeekModeView.axaml and DayModeView.axaml, plus
/// Controls/TimelinePanel.cs (new). Paging, titles and the toolbar are already done here; the mode models get the day
/// through <see cref="Date"/> and rebuild in <see cref="CalendarModeViewModel.Rebuild"/>. Month drag and drop of chips
/// goes into Views/Calendar/MonthModeView.axaml.cs (W6 owns the drag part of that file).</item>
/// <item>W7, details flyout, editor, date field, pickers, span dialogs, undo: implement <see cref="ICalendarActions"/>
/// in Views/Events/ and assign it to <see cref="Actions"/> (MainWindow or App); every request of the views (double-click,
/// Enter, Ctrl+E, Delete, Duplicate, Ctrl+N, Ctrl+Z / Ctrl+Y, the <c>new-event</c> route) already arrives there.</item>
/// <item>W8 and W9, import and export, files and links, toasts, Settings rows, Today's Up next, the day details' events:
/// read events through <see cref="MainViewModel.Events"/> (<see cref="EventsModel"/>); the Calendars pane's Import and
/// Export commands (Ctrl+O, Ctrl+Shift+E) are bound in MainWindow and enable once handlers attach; the "Show events in
/// Year view" setting is <see cref="AppState.ShowsYearEvents"/> (Year honours it) and the text scale is
/// <see cref="AppState.TextScale"/> (Month's list of days and Week's fallback to Day at 150 % and above).</item>
/// </list>
/// </summary>
public sealed class CalendarViewModel : PageViewModel
{
    private CalendarMode _mode = CalendarMode.Month;
    private GregorianDate _date;
    private string _title = "";
    private string? _subtitle;
    private string _announcement = "";
    private CalendarItem? _selectedItem;
    private ICalendarActions _actions = new PlaceholderCalendarActions();
    private bool _loadToastClosed;

    /// <summary>Creates the section on today, in Month mode (§2.1 "First launch: Month, today").</summary>
    public CalendarViewModel(MainViewModel shell) : base(shell, AppSection.Calendar)
    {
        _date = State.Today;
        YearMode = new YearViewModel(this);
        MonthMode = new MonthModeViewModel(this);
        WeekMode = new WeekModeViewModel(this);
        DayMode = new DayModeViewModel(this);
        ListMode = new ListModeViewModel(this);
        Modes = [DayMode, WeekMode, MonthMode, YearMode, ListMode];
        Mover = new EventMover(this);
        ModeOptions = CalendarModes.All.Select(m => new CalendarModeOption(this, m)).ToArray();

        PreviousCommand = new RelayCommand(() => Page(-1), () => CalendarPeriod.Step(_date, DisplayedMode, -1, State.System) is not null);
        NextCommand = new RelayCommand(() => Page(1), () => CalendarPeriod.Step(_date, DisplayedMode, 1, State.System) is not null);
        TodayCommand = new RelayCommand(ShowToday);
        NewEventCommand = new RelayCommand<object?>(anchor => NewEvent(null, anchor));
        SetModeCommand = new RelayCommand<CalendarMode>(m => Mode = m);
        ShowCalendarsCommand = new RelayCommand(() => Shell.ShowCalendarsPane(focusHidden: false));
        ShowHiddenCalendarsCommand = new RelayCommand(() => Shell.ShowCalendarsPane(focusHidden: true));
        RetryLoadCommand = new RelayCommand(() => _ = Shell.Events?.RetryLoadAsync());
        CloseLoadFailedCommand = new RelayCommand(() =>
        {
            _loadToastClosed = true;
            OnPropertyChanged(nameof(ShowsLoadFailed));
        });

        State.PropertyChanged += OnStateChanged;
        UpdateTitles(announce: false);
        UpdateActiveMode();
    }

    /// <inheritdoc />
    public override double ContentMaxWidth => double.PositiveInfinity;

    /// <summary>Year mode (the existing Year screen with event dots).</summary>
    public YearViewModel YearMode { get; }

    /// <summary>Month mode.</summary>
    public MonthModeViewModel MonthMode { get; }

    /// <summary>Week mode (task W6).</summary>
    public WeekModeViewModel WeekMode { get; }

    /// <summary>Day mode (task W6).</summary>
    public DayModeViewModel DayMode { get; }

    /// <summary>List mode.</summary>
    public ListModeViewModel ListMode { get; }

    /// <summary>The five mode models, in segmented-control order.</summary>
    public IReadOnlyList<CalendarModeViewModel> Modes { get; }

    /// <summary>Drag edits of Month, Week and Day (task W6, §2.11 "Drag edits"): moves, Alt-drag copies, drafts from a dragged range.</summary>
    public EventMover Mover { get; }

    /// <summary>The segments of the mode control.</summary>
    public IReadOnlyList<CalendarModeOption> ModeOptions { get; }

    /// <summary>The events of this window, or null before they are attached (tests without a store).</summary>
    public EventsModel? Events => Shell.Events;

    /// <summary>
    /// The details, editor, delete and undo of task W7 (<see cref="ICalendarActions"/>); until it is attached, a
    /// <see cref="PlaceholderCalendarActions"/> logs each request.
    /// </summary>
    public ICalendarActions Actions
    {
        get => _actions;
        set => _actions = value ?? throw new ArgumentNullException(nameof(value));
    }

    /// <summary>The chosen mode (remembered while the window is open; Month on a new window).</summary>
    public CalendarMode Mode
    {
        get => _mode;
        set
        {
            if (!SetProperty(ref _mode, value)) return;
            foreach (var option in ModeOptions) option.Refresh();
            ModeChanged();
        }
    }

    /// <summary>The mode on screen: Week falls back to Day at 150 % text and above (§2.20 "Text size").</summary>
    public CalendarMode DisplayedMode => _mode == CalendarMode.Week && State.UsesLargeText ? CalendarMode.Day : _mode;

    /// <summary>The day the Calendar is about: the selected day (Year: its year; Month and Week: the period holding it; List: the first day).</summary>
    public GregorianDate Date
    {
        get => _date;
        set
        {
            if (!SetProperty(ref _date, value)) return;
            foreach (var mode in Modes) mode.DateChanged();
            UpdateTitles(announce: false);
            NotifyPaging();
        }
    }

    /// <summary>"October 2026", "2026", "October 2026, week 2", "Thursday, October 12, 2026", "Upcoming".</summary>
    public string PeriodTitle
    {
        get => _title;
        private set => SetProperty(ref _title, value);
    }

    /// <summary>"Gregorian Oct 8 to Nov 4", or null (IFC Year, List).</summary>
    public string? PeriodSubtitle
    {
        get => _subtitle;
        private set
        {
            if (SetProperty(ref _subtitle, value)) OnPropertyChanged(nameof(HasPeriodSubtitle));
        }
    }

    /// <summary>Whether there is a subtitle.</summary>
    public bool HasPeriodSubtitle => _subtitle is not null;

    private bool _showsNoWeekday;

    /// <summary>The Day title of an intercalary day carries the "No weekday" plate (§2.1 titles: "Year Day 2026" with <c>picker.noWeekday</c>).</summary>
    public bool ShowsNoWeekday
    {
        get => _showsNoWeekday;
        private set => SetProperty(ref _showsNoWeekday, value);
    }

    /// <summary><c>picker.noWeekday</c></summary>
    public string NoWeekdayText => EditorStrings.NoWeekday;

    /// <summary>
    /// The polite announcement after paging (<c>calendar.announce.page</c>, "November 2026. Gregorian Nov 5 to Dec 2."),
    /// read by Narrator from a live region in the toolbar.
    /// </summary>
    public string Announcement
    {
        get => _announcement;
        private set => SetProperty(ref _announcement, value);
    }

    /// <summary>"Today" is shown only while today is not on screen (§2.1).</summary>
    public bool ShowsTodayButton => !CalendarPeriod.Shows(State.Today, DisplayedMode, _date, State.System);

    /// <summary>"Previous month" (the "‹" button's name and the paging action).</summary>
    public string PreviousName => CalendarStrings.Previous(DisplayedMode.Unit());

    /// <summary>"Next month".</summary>
    public string NextName => CalendarStrings.Next(DisplayedMode.Unit());

    /// <summary>"Previous month (Ctrl+Left)".</summary>
    public string PreviousTip => PreviousName + " (Ctrl+Left)";

    /// <summary>"Next month (Ctrl+Right)".</summary>
    public string NextTip => NextName + " (Ctrl+Right)";

    /// <summary><c>calendar.today</c></summary>
    public string TodayText => CalendarStrings.Today;

    /// <summary>"Today (Ctrl+T)".</summary>
    public string TodayTip => CalendarStrings.Today + " (Ctrl+T)";

    /// <summary><c>calendar.newEvent</c></summary>
    public string NewEventText => CalendarStrings.NewEvent;

    /// <summary>"New event (Ctrl+N)".</summary>
    public string NewEventTip => CalendarStrings.NewEvent + " (Ctrl+N)";

    /// <summary><c>calendar.subscriptionsStale</c></summary>
    public string StaleText => CalendarStrings.SubscriptionsStale;

    /// <summary>"Calendar view" (the segmented control's group name; §2.19 has no id for it).</summary>
    public string ModesName => CalendarStrings.NavCalendar;

    /// <summary>The selected event (a click on a chip or row), for Ctrl+E and Delete; null when none.</summary>
    public CalendarItem? SelectedItem
    {
        get => _selectedItem;
        set => SetProperty(ref _selectedItem, value);
    }

    /// <summary>The store is still loading (the toolbar shows a small progress indicator after 300 ms, §2.4 "Loading").</summary>
    public bool IsLoading => Events is { } events && !events.IsLoaded && !events.LoadFailed;

    /// <summary>The calendars could not be read: "Couldn't load events." with "Try again" (§2.4).</summary>
    public bool LoadFailed => Events?.LoadFailed ?? false;

    /// <summary>The "Couldn't load events." toast is shown (a failure, until its Close button).</summary>
    public bool ShowsLoadFailed => LoadFailed && !_loadToastClosed;

    /// <summary>The toast's Close button (<c>toast.close</c>).</summary>
    public RelayCommand CloseLoadFailedCommand { get; }

    /// <summary><c>calendar.loadFailed</c></summary>
    public string LoadFailedText => CalendarStrings.LoadFailed;

    /// <summary><c>calendar.tryAgain</c></summary>
    public string TryAgainText => CalendarStrings.TryAgain;

    /// <summary><c>toast.close</c></summary>
    public string CloseText => CalendarStrings.ToastClose;

    /// <summary>"‹" (Ctrl+Left).</summary>
    public RelayCommand PreviousCommand { get; }

    /// <summary>"›" (Ctrl+Right).</summary>
    public RelayCommand NextCommand { get; }

    /// <summary>"Today" (Ctrl+T, Home).</summary>
    public RelayCommand TodayCommand { get; }

    /// <summary>"New event" (Ctrl+N): the editor on a draft on the selected day.</summary>
    public RelayCommand<object?> NewEventCommand { get; }

    /// <summary>A segment, or Ctrl+Shift+1 to 5.</summary>
    public RelayCommand<CalendarMode> SetModeCommand { get; }

    /// <summary>The "Subscriptions not updated" button and Ctrl+Shift+K: the Calendars pane.</summary>
    public RelayCommand ShowCalendarsCommand { get; }

    /// <summary>"Show calendars" (every calendar hidden): the Calendars pane, focus on the first hidden calendar.</summary>
    public RelayCommand ShowHiddenCalendarsCommand { get; }

    /// <summary>"Try again" after <see cref="LoadFailed"/>.</summary>
    public RelayCommand RetryLoadCommand { get; }

    /// <summary>Raised before "‹", "›", Ctrl+Left or Ctrl+Right moves the Calendar to another page (views note the focused grid position).</summary>
    public event EventHandler? Paging;

    /// <summary>Raised after the page changed (the views put the focus back on the same grid position, §2.1).</summary>
    public event EventHandler? Paged;

    /// <summary>Moves to the next (1) or previous (-1) page of the mode on screen, and announces it.</summary>
    public void Page(int delta)
    {
        if (CalendarPeriod.Step(_date, DisplayedMode, delta, State.System) is not { } target) return;
        Paging?.Invoke(this, EventArgs.Empty);
        Date = target;
        UpdateTitles(announce: true);
        Paged?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>"Today": today in the current mode (Year reveals today's month).</summary>
    public void ShowToday()
    {
        State.RefreshToday();
        Date = State.Today;
        if (DisplayedMode == CalendarMode.Year) YearMode.Reveal(State.Today);
        UpdateTitles(announce: true);
    }

    /// <summary>Sets the Gregorian year (Year mode's paging, <c>--year</c>, links): the same month and day, Feb 29 falling back to Feb 28.</summary>
    public void SetYear(int year)
    {
        year = MainViewModel.ClampYear(year);
        if (year == _date.Year) return;
        Date = new GregorianDate(year, _date.Month, Math.Min(_date.Day, GregorianDate.DaysInMonth(year, _date.Month)));
    }

    /// <summary>Month mode on <paramref name="month"/> of <paramref name="year"/> (a Year month title, the <c>month/</c> route): on today when it is in that month, else on day 1.</summary>
    public void ShowMonth(int year, int month)
    {
        var target = new ThirteenMonthRef(MainViewModel.ClampYear(year), Math.Clamp(month, 1, ThirteenDate.MonthsPerYear));
        Mode = CalendarMode.Month;
        Date = CalendarPeriod.MonthOf(State.Today, State.System) == target ? State.Today : CalendarPeriod.FirstDay(target, State.System) ?? _date;
    }

    /// <summary>Day mode on <paramref name="date"/> ("Open day", a "+N more" in the list of days).</summary>
    public void OpenDay(GregorianDate date)
    {
        Mode = CalendarMode.Day;
        Date = date;
    }

    /// <summary>
    /// The editor on an unsaved draft (§2.4): on <paramref name="date"/> (the selected day when null), at the next whole
    /// hour when it is today, else 09:00, one hour long.
    /// </summary>
    public void NewEvent(GregorianDate? date, object? anchor)
    {
        var day = date ?? _date;
        var start = 9 * 60;
        if (day == State.Today && Events is { } events)
        {
            var now = events.Now();
            if (now.Date == day) start = Math.Min(23 * 60, (now.Minute / 60 + 1) * 60);
        }
        Actions.NewEvent(day, start, start + 60, anchor);
    }

    /// <summary>Ctrl+E on the selected event: the editor, or its read-only reason announced (§2.20 "Read-only events").</summary>
    public void EditSelected(object? anchor)
    {
        if (_selectedItem is not { } item) return;
        if (!item.CanEdit)
        {
            Announce(CalendarStrings.ReadOnlyReason(item.ReadOnly) ?? "");
            return;
        }
        Actions.Edit(item, anchor);
    }

    /// <summary>Delete on the selected event: the delete question, or its read-only reason announced (historical events keep Delete).</summary>
    public void DeleteSelected(object? anchor)
    {
        if (_selectedItem is not { } item) return;
        if (!item.CanDelete)
        {
            Announce(CalendarStrings.ReadOnlyReason(item.ReadOnly) ?? "");
            return;
        }
        Actions.Delete(item, anchor);
    }

    /// <summary>Sets the polite announcement (paging, read-only reasons).</summary>
    public void Announce(string text)
    {
        // The same text twice is a change too: clear first so the live region fires again.
        Announcement = "";
        Announcement = text;
    }

    /// <summary>The events were attached or changed: every mode refreshes (the hidden ones when they are next shown).</summary>
    internal void EventsChanged()
    {
        if (_selectedItem is { } selected && Events is { } events
            && !events.Items(selected.FirstDay, selected.LastDay).Any(i => i.Key == selected.Key))
        {
            SelectedItem = null;
        }
        foreach (var mode in Modes) mode.Invalidate();
        if (!LoadFailed) _loadToastClosed = false;
        OnPropertyChanged(nameof(IsLoading));
        OnPropertyChanged(nameof(LoadFailed));
        OnPropertyChanged(nameof(ShowsLoadFailed));
        OnPropertyChanged(nameof(Events));
    }

    private void ModeChanged()
    {
        OnPropertyChanged(nameof(DisplayedMode));
        UpdateActiveMode();
        UpdateTitles(announce: false);
        NotifyPaging();
    }

    /// <summary>Called by the shell when the section is shown or hidden.</summary>
    internal void SectionShown() => UpdateActiveMode();

    private void UpdateActiveMode()
    {
        var shown = DisplayedMode;
        foreach (var mode in Modes) mode.IsActive = IsActive && mode.Mode == shown;
    }

    private void UpdateTitles(bool announce)
    {
        var (title, subtitle) = CalendarPeriod.Titles(DisplayedMode, _date, State.System);
        PeriodTitle = title;
        PeriodSubtitle = subtitle;
        ShowsNoWeekday = DisplayedMode == CalendarMode.Day && _date.ToThirteen(State.System) is ThirteenIntercalaryDate;
        if (announce) Announce(CalendarStrings.AnnouncePage(title, subtitle));
    }

    private void NotifyPaging()
    {
        OnPropertyChanged(nameof(ShowsTodayButton));
        OnPropertyChanged(nameof(PreviousName));
        OnPropertyChanged(nameof(NextName));
        OnPropertyChanged(nameof(PreviousTip));
        OnPropertyChanged(nameof(NextTip));
        PreviousCommand.NotifyCanExecuteChanged();
        NextCommand.NotifyCanExecuteChanged();
    }

    /// <inheritdoc />
    protected override void OnPropertyChanged(PropertyChangedEventArgs e)
    {
        base.OnPropertyChanged(e);
        if (e.PropertyName == nameof(IsActive)) UpdateActiveMode();
    }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(AppState.System):
                if (Events is { } events) events.Store.System = State.System;
                foreach (var mode in Modes) mode.Invalidate();
                UpdateTitles(announce: false);
                NotifyPaging();
                break;
            case nameof(AppState.Today):
                foreach (var mode in Modes) mode.Invalidate();
                NotifyPaging();
                break;
            case nameof(AppState.TextScale):
                ModeChanged();
                foreach (var mode in Modes) mode.Invalidate();
                break;
        }
    }

    /// <summary>The midnight roll-over: a Calendar on the old today follows to the new one (§2.1).</summary>
    internal void TodayChanged(GregorianDate previous, GregorianDate now)
    {
        if (_date == previous) Date = now;
    }
}

/// <summary>One segment of the mode control ("Day", ..., "List").</summary>
public sealed class CalendarModeOption : ViewModelBase
{
    private readonly CalendarViewModel _calendar;

    internal CalendarModeOption(CalendarViewModel calendar, CalendarMode mode)
    {
        _calendar = calendar;
        Mode = mode;
    }

    /// <summary>The mode.</summary>
    public CalendarMode Mode { get; }

    /// <summary>"Day".</summary>
    public string Title => Mode.Title();

    /// <summary>"Day (Ctrl+Shift+1)".</summary>
    public string ToolTip => $"{Mode.Title()} ({Mode.Shortcut()})";

    /// <summary>Whether this mode is chosen. Setting it to true switches.</summary>
    public bool IsSelected
    {
        get => _calendar.Mode == Mode;
        set
        {
            if (value) _calendar.Mode = Mode;
            OnPropertyChanged();
        }
    }

    internal void Refresh() => OnPropertyChanged(nameof(IsSelected));
}

/// <summary>
/// A Calendar mode's model: built when the mode is first shown, refreshed when the day, the system, today or the events
/// change while it is on screen (a hidden mode refreshes when it is shown again).
/// </summary>
public abstract class CalendarModeViewModel : ViewModelBase
{
    private bool _isActive;
    private bool _wasActivated;
    private bool _stale = true;

    /// <summary>A mode of <paramref name="calendar"/>.</summary>
    protected CalendarModeViewModel(CalendarViewModel calendar, CalendarMode mode)
    {
        Calendar = calendar;
        Mode = mode;
    }

    /// <summary>The Calendar section.</summary>
    public CalendarViewModel Calendar { get; }

    /// <summary>The window's model.</summary>
    public MainViewModel Shell => Calendar.Shell;

    /// <summary>App-wide state.</summary>
    public AppState State => Calendar.State;

    /// <summary>Which mode this is.</summary>
    public CalendarMode Mode { get; }

    /// <summary>The events, or null when none are attached.</summary>
    public EventsModel? Events => Calendar.Events;

    /// <summary>Whether this mode is on screen.</summary>
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
            if (value && _stale) Refresh();
        }
    }

    /// <summary>The mode once it has been shown (null before), so its view is only built when first needed.</summary>
    public CalendarModeViewModel? Loaded => _wasActivated ? this : null;

    /// <summary>The Calendar's day changed.</summary>
    internal virtual void DateChanged() => Invalidate();

    /// <summary>Marks the mode out of date; rebuilds at once when it is on screen.</summary>
    internal void Invalidate()
    {
        _stale = true;
        if (_isActive) Refresh();
    }

    /// <summary>Rebuilds now (tests call it on hidden modes too).</summary>
    public void Refresh()
    {
        _stale = false;
        Rebuild();
    }

    /// <summary>Builds the mode's content for <see cref="CalendarViewModel.Date"/>, the system, today and the events.</summary>
    protected abstract void Rebuild();
}
