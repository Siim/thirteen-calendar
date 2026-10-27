using System.ComponentModel;
using System.Windows.Input;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// One row of Up next or of the day details' Events section (docs/EVENTS.md §2.8, §2.9, board B1): the List row
/// (<see cref="CalendarRow"/>: the time column, the calendar dot, the title with its tag and the second line) and the
/// "Now" plate of an event in progress. A click opens the event's details.
/// </summary>
public sealed class EventListRow
{
    internal EventListRow(CalendarRow row, bool isNow)
    {
        Row = row;
        IsNow = isNow;
    }

    /// <summary>The row (texts, color, accessible name, Open).</summary>
    public CalendarRow Row { get; }

    /// <summary>A timed event running now: the "Now" plate in the accent (<c>today.now</c>).</summary>
    public bool IsNow { get; }

    /// <summary><c>today.now</c></summary>
    public string NowText => TodayStrings.Now;

    /// <summary>The Now plate as the row's item status for Narrator ("Now"), else empty.</summary>
    public string ItemStatus => IsNow ? TodayStrings.Now : "";

    /// <summary>Timed and running now (<c>start &lt;= now &lt; end</c>).</summary>
    public static bool InProgress(CalendarItem item, LocalDateTime now) =>
        !item.AllDay && item.Start.CompareTo(now) <= 0 && now.CompareTo(item.End) < 0;
}

/// <summary>A day of Up next: "Today", "Tomorrow", or "Saturday, October 14" with "Gregorian Wed, Oct 21".</summary>
public sealed class UpNextGroup
{
    internal UpNextGroup(string heading, string? caption, string automationName, IReadOnlyList<EventListRow> rows)
    {
        Heading = heading;
        Caption = caption;
        AutomationName = automationName;
        Rows = rows;
    }

    /// <summary>"Today", "Tomorrow", or the 13-month day ("Saturday, October 14"; "Year Day").</summary>
    public string Heading { get; }

    /// <summary>"Gregorian Wed, Oct 21" on later days, else null.</summary>
    public string? Caption { get; }

    /// <summary>Whether <see cref="Caption"/> is shown.</summary>
    public bool HasCaption => Caption is not null;

    /// <summary>The heading read as one line.</summary>
    public string AutomationName { get; }

    /// <summary>The rows, in the agenda's order (all-day items and middle parts first, then by start).</summary>
    public IReadOnlyList<EventListRow> Rows { get; }
}

/// <summary>
/// Today's "Up next" card (docs/EVENTS.md §2.8, board B1), under the hero: the next 7 days (today and the 6 after it)
/// from now, at most 6 rows, each event once, on the first day of the range it touches; events that ended earlier today
/// are left out, one running now keeps its row with the "Now" plate; the rows past the sixth are counted ("5 more in the
/// next 7 days"). "+" adds an event today, "Show all in Calendar" opens List from today. Empty: "Nothing else today."
/// when today has nothing left but later days do; "No events in the next 7 days." when the whole range is empty; every
/// calendar hidden: "All calendars are hidden." with "Show calendars". Windows rule (§2.8): the card appears once a local
/// calendar holds an event or a subscription exists. The same readings as the web's <c>upNext</c> and the Apple apps'
/// <c>UpNextAgenda</c>.
/// </summary>
public sealed class UpNextViewModel : ViewModelBase
{
    /// <summary>Today and the 6 days after it.</summary>
    public const int DayCount = 7;

    /// <summary>At most this many rows.</summary>
    public const int MaxRows = 6;

    private readonly MainViewModel _shell;
    private IReadOnlyList<UpNextGroup> _groups = [];
    private bool _isVisible;
    private int _more;
    private bool _todayLeft;
    private bool _isEmpty;
    private bool _allHidden;

    /// <summary>The card of <paramref name="shell"/>'s Today.</summary>
    public UpNextViewModel(MainViewModel shell)
    {
        _shell = shell ?? throw new ArgumentNullException(nameof(shell));
        NewEventCommand = new RelayCommand<object?>(anchor =>
        {
            _shell.Section = AppSection.Calendar;
            _shell.CalendarPage.NewEvent(_shell.State.Today, anchor);
        });
        ShowAllCommand = new RelayCommand(() =>
        {
            _shell.Section = AppSection.Calendar;
            _shell.CalendarPage.Mode = CalendarMode.List;
            _shell.CalendarPage.Date = _shell.State.Today;
        });
        ShowCalendarsCommand = new RelayCommand(() => _shell.ShowCalendarsPane(focusHidden: true));
        shell.EventsChanged += (_, _) => Refresh();
        shell.State.PropertyChanged += OnStateChanged;
        shell.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(MainViewModel.Events)) Refresh();
        };
        Refresh();
    }

    /// <summary><c>today.upNext</c></summary>
    public string Title => TodayStrings.UpNext;

    /// <summary><c>today.showAll</c></summary>
    public string ShowAllText => TodayStrings.ShowAll;

    /// <summary><c>calendar.newEvent</c>, the "+" button's accessible name.</summary>
    public string NewEventText => CalendarStrings.NewEvent;

    /// <summary>The card is shown: the calendars have loaded and a local calendar holds an event or a subscription exists.</summary>
    public bool IsVisible
    {
        get => _isVisible;
        private set => SetProperty(ref _isVisible, value);
    }

    /// <summary>The days with rows.</summary>
    public IReadOnlyList<UpNextGroup> Groups
    {
        get => _groups;
        private set => SetProperty(ref _groups, value);
    }

    /// <summary>Events past the row limit.</summary>
    public int More
    {
        get => _more;
        private set
        {
            if (!SetProperty(ref _more, value)) return;
            OnPropertyChanged(nameof(MoreText));
            OnPropertyChanged(nameof(HasMore));
        }
    }

    /// <summary><c>today.moreNext7</c>: "5 more in the next 7 days".</summary>
    public string MoreText => TodayStrings.MoreNext7(_more);

    /// <summary>Whether <see cref="MoreText"/> is shown.</summary>
    public bool HasMore => _more > 0;

    /// <summary>"Nothing else today." is shown above the later days.</summary>
    public bool ShowsEmptyToday => !_allHidden && !_isEmpty && !_todayLeft;

    /// <summary><c>today.emptyToday</c></summary>
    public string EmptyTodayText => TodayStrings.EmptyToday;

    /// <summary>"No events in the next 7 days." is shown.</summary>
    public bool ShowsEmptyWeek => !_allHidden && _isEmpty;

    /// <summary><c>today.emptyWeek</c></summary>
    public string EmptyWeekText => TodayStrings.EmptyWeek;

    /// <summary>Every calendar is hidden: "All calendars are hidden." with "Show calendars".</summary>
    public bool ShowsAllHidden => _allHidden;

    /// <summary><c>calendar.allHidden</c></summary>
    public string AllHiddenText => CalendarStrings.AllHidden;

    /// <summary><c>calendar.allHidden.button</c></summary>
    public string ShowCalendarsText => CalendarStrings.AllHiddenButton;

    /// <summary>"+": a new event today.</summary>
    public ICommand NewEventCommand { get; }

    /// <summary>"Show all in Calendar": List mode from today.</summary>
    public ICommand ShowAllCommand { get; }

    /// <summary>"Show calendars".</summary>
    public ICommand ShowCalendarsCommand { get; }

    /// <summary>The time column's width: room for "12:30 PM" at the current text size.</summary>
    public double TimeColumnWidth => ListModeViewModel.TimeWidth(_shell.State.TextScale);

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(AppState.Today) or nameof(AppState.System)) Refresh();
        if (e.PropertyName == nameof(AppState.TextScale)) OnPropertyChanged(nameof(TimeColumnWidth));
    }

    /// <summary>
    /// The wall clock the rows are cut at: the device's now when it is on the app's today; at the start of today when the
    /// two disagree (a pinned day, <c>--date</c>), so nothing of that day has ended yet.
    /// </summary>
    public static LocalDateTime NowFor(EventsModel events, GregorianDate today)
    {
        ArgumentNullException.ThrowIfNull(events);
        var now = events.Now();
        return now.Date == today ? now : new LocalDateTime(today, 0);
    }

    /// <summary>Builds the card again (the events, today or the system changed). Public for tests.</summary>
    public void Refresh()
    {
        var events = _shell.Events;
        if (events is null || !events.IsLoaded || !events.HasUserEvents)
        {
            IsVisible = false;
            Groups = [];
            More = 0;
            return;
        }
        var today = _shell.State.Today;
        var system = _shell.State.System;
        var now = NowFor(events, today);
        var last = today;
        for (var i = 1; i < DayCount && last < GregorianDate.MaxValue; i++) last = last.AddDays(1);
        var items = events.Items(today, last)
            .Where(i => !(i.End.CompareTo(now) <= 0 && i.Start.CompareTo(now) < 0))
            .ToList();
        var byKey = items.ToDictionary(i => i.Key, StringComparer.Ordinal);
        var agenda = AgendaDay.Days(items.Select(i => i.Occurrence), today, last, system);
        var tomorrow = today < GregorianDate.MaxValue ? today.AddDays(1) : today;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var groups = new List<UpNextGroup>();
        int shown = 0, total = 0;
        var todayLeft = false;
        foreach (var day in agenda)
        {
            var rows = new List<EventListRow>();
            foreach (var part in day.Items)
            {
                if (!seen.Add(part.Key)) continue;
                total++;
                if (day.Gregorian == today) todayLeft = true;
                if (shown >= MaxRows) continue;
                var item = byKey[part.Key];
                rows.Add(new EventListRow(new CalendarRow(_shell.CalendarPage, item, part, compactTime: false, rowLabel: true), EventListRow.InProgress(item, now)));
                shown++;
            }
            if (rows.Count == 0) continue;
            if (day.Gregorian == today)
            {
                groups.Add(new UpNextGroup(TodayStrings.Today, null, TodayStrings.Today, rows));
            }
            else if (day.Gregorian == tomorrow)
            {
                groups.Add(new UpNextGroup(TodayStrings.Tomorrow, null, TodayStrings.Tomorrow, rows));
            }
            else
            {
                var heading = CalendarStrings.ThirteenDayHeading(day.Thirteen);
                var caption = CalendarStrings.GregorianDayCaption(day.Gregorian);
                groups.Add(new UpNextGroup(heading, caption, $"{heading}. Gregorian {CalendarStrings.GregorianLongNoYear(day.Gregorian)}", rows));
            }
        }
        _allHidden = events.AllHidden;
        _isEmpty = total == 0;
        _todayLeft = todayLeft;
        Groups = _allHidden ? [] : groups;
        More = _allHidden ? 0 : total - shown;
        IsVisible = true;
        OnPropertyChanged(nameof(ShowsEmptyToday));
        OnPropertyChanged(nameof(ShowsEmptyWeek));
        OnPropertyChanged(nameof(ShowsAllHidden));
    }
}

/// <summary>
/// The day details' Events section (docs/EVENTS.md §2.9): the day's items as Up next draws them (the Now plate included),
/// "New event" and "Open in Calendar" (Day mode). A day without events: "No events." and "New event"; every calendar
/// hidden: "All calendars are hidden." and "Show calendars". Hidden until the calendars have loaded.
/// </summary>
public sealed class DayEventsViewModel : ViewModelBase
{
    private readonly MainViewModel _shell;
    private GregorianDate _date;
    private IReadOnlyList<EventListRow> _rows = [];
    private bool _isVisible;
    private bool _allHidden;

    /// <summary>The section of <paramref name="shell"/>'s day details on <paramref name="date"/>.</summary>
    public DayEventsViewModel(MainViewModel shell, GregorianDate date)
    {
        _shell = shell ?? throw new ArgumentNullException(nameof(shell));
        _date = date;
        NewEventCommand = new RelayCommand<object?>(anchor =>
        {
            _shell.Section = AppSection.Calendar;
            _shell.CalendarPage.NewEvent(_date, anchor);
        });
        OpenInCalendarCommand = new RelayCommand(() =>
        {
            var day = _date;
            _shell.CloseDetail();
            _shell.Section = AppSection.Calendar;
            _shell.CalendarPage.OpenDay(day);
        });
        ShowCalendarsCommand = new RelayCommand(() => _shell.ShowCalendarsPane(focusHidden: true));
        Refresh();
    }

    /// <summary>The day.</summary>
    public GregorianDate Date
    {
        get => _date;
        set
        {
            if (_date == value) return;
            _date = value;
            Refresh();
        }
    }

    /// <summary>"EVENTS", the section's heading.</summary>
    public string Heading => TodayStrings.EventsHeading;

    /// <summary>Shown once the calendars have loaded.</summary>
    public bool IsVisible
    {
        get => _isVisible;
        private set => SetProperty(ref _isVisible, value);
    }

    /// <summary>The day's rows, in the agenda's order.</summary>
    public IReadOnlyList<EventListRow> Rows
    {
        get => _rows;
        private set
        {
            if (!SetProperty(ref _rows, value)) return;
            OnPropertyChanged(nameof(HasRows));
            OnPropertyChanged(nameof(ShowsEmpty));
        }
    }

    /// <summary>The day has events ("Open in Calendar" is shown).</summary>
    public bool HasRows => _rows.Count > 0;

    /// <summary>"No events." is shown.</summary>
    public bool ShowsEmpty => !HasRows && !_allHidden;

    /// <summary>"All calendars are hidden." is shown.</summary>
    public bool ShowsAllHidden => !HasRows && _allHidden;

    /// <summary><c>calendar.day.empty</c></summary>
    public string EmptyText => CalendarStrings.DayEmpty;

    /// <summary><c>calendar.allHidden</c></summary>
    public string AllHiddenText => CalendarStrings.AllHidden;

    /// <summary><c>calendar.allHidden.button</c></summary>
    public string ShowCalendarsText => CalendarStrings.AllHiddenButton;

    /// <summary><c>calendar.newEvent</c></summary>
    public string NewEventText => CalendarStrings.NewEvent;

    /// <summary><c>event.openInCalendar</c></summary>
    public string OpenInCalendarText => TodayStrings.OpenInCalendar;

    /// <summary>"New event" on this day.</summary>
    public ICommand NewEventCommand { get; }

    /// <summary>"Open in Calendar": Day mode on this day.</summary>
    public ICommand OpenInCalendarCommand { get; }

    /// <summary>"Show calendars".</summary>
    public ICommand ShowCalendarsCommand { get; }

    /// <summary>The time column's width.</summary>
    public double TimeColumnWidth => ListModeViewModel.TimeWidth(_shell.State.TextScale);

    /// <summary>Builds the section again.</summary>
    public void Refresh()
    {
        var events = _shell.Events;
        if (events is null || !events.IsLoaded)
        {
            IsVisible = false;
            Rows = [];
            return;
        }
        var items = events.Items(_date, _date);
        var now = UpNextViewModel.NowFor(events, _shell.State.Today);
        var byKey = items.ToDictionary(i => i.Key, StringComparer.Ordinal);
        var agenda = AgendaDay.Days(items.Select(i => i.Occurrence), _date, _date, _shell.State.System);
        var calendarRows = agenda.Count == 0
            ? []
            : agenda[0].Items.Select(part => new CalendarRow(_shell.CalendarPage, byKey[part.Key], part, compactTime: false, rowLabel: true)).ToArray();
        _allHidden = events.AllHidden;
        Rows = calendarRows.Select(r => new EventListRow(r, _date == _shell.State.Today && EventListRow.InProgress(r.Item, now))).ToArray();
        IsVisible = true;
        OnPropertyChanged(nameof(ShowsEmpty));
        OnPropertyChanged(nameof(ShowsAllHidden));
        OnPropertyChanged(nameof(TimeColumnWidth));
    }
}
