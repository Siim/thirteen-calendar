using System.ComponentModel;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// What Week and Day share (docs/EVENTS.md §2.5, §2.6): the columns with their blocks and "+{n}" blocks, the all-day row,
/// the now line, the geometry at the current text size (hour height, lanes, the label column sized for "12 PM"), the
/// slots that fit a column (<c>maxSlots</c> = floor(column width / 48), Day / 64), and where the timeline scrolls on open
/// (07:00, or the first event of the period if earlier). Drag and drop is done by the views through
/// <see cref="CalendarViewModel.Mover"/>.
/// </summary>
public abstract class TimelineModeViewModel : CalendarModeViewModel
{
    private IReadOnlyList<TimelineColumn> _columns = [];
    private IReadOnlyList<object> _allDay = [];
    private int _allDayLanes = 1;
    private int? _maxSlots;
    private int _scrollMinute = 7 * 60;
    private int _scrollRequest;
    private string _scrollKey = "";
    private bool _built;
    private int? _nowMinute;

    /// <summary>A timeline mode of <paramref name="calendar"/>.</summary>
    protected TimelineModeViewModel(CalendarViewModel calendar, CalendarMode mode) : base(calendar, mode)
    {
        calendar.PropertyChanged += OnCalendarChanged;
        State.PropertyChanged += OnStateChanged;
    }

    /// <summary>The slot width a column is divided by for <c>maxSlots</c>: 48 in Week, 64 in Day (§2.5, §2.6).</summary>
    protected abstract double SlotWidth { get; }

    /// <summary>The columns: the week's days (plus intercalary days), or the one day.</summary>
    public IReadOnlyList<TimelineColumn> Columns
    {
        get => _columns;
        protected set
        {
            if (!SetProperty(ref _columns, value)) return;
            OnPropertyChanged(nameof(ColumnWeights));
            OnPropertyChanged(nameof(ColumnHatched));
        }
    }

    /// <summary>The columns' widths relative to a day's (an intercalary column is 0.6 in Week), for the panels that share them.</summary>
    public IReadOnlyList<double> ColumnWeights => _columns.Select(c => c.Weight).ToArray();

    /// <summary>Which columns are intercalary days (hatched, §2.2).</summary>
    public IReadOnlyList<bool> ColumnHatched => _columns.Select(c => c.IsIntercalary).ToArray();

    /// <summary>The grid's name for screen readers: the toolbar title ("October 2026, week 2"; "Thursday, October 12, 2026").</summary>
    public string GridName => Calendar.PeriodTitle;

    /// <summary>The now line's minute when the timeline shows today, else null (the label and dot on the time axis).</summary>
    public int? NowMinute
    {
        get => _nowMinute;
        private set
        {
            if (SetProperty(ref _nowMinute, value)) OnPropertyChanged(nameof(NowText));
        }
    }

    /// <summary>The now label on the time axis ("09:41"), or null.</summary>
    public string? NowText => _nowMinute is { } m ? Timeline.TimeText(m) : null;

    /// <summary>The all-day row: <see cref="AllDayBar"/>s and <see cref="AllDayMore"/>s.</summary>
    public IReadOnlyList<object> AllDay
    {
        get => _allDay;
        protected set => SetProperty(ref _allDay, value);
    }

    /// <summary>The all-day row's lanes (at least one, so the row can take a drop).</summary>
    public int AllDayLanes
    {
        get => _allDayLanes;
        protected set
        {
            if (SetProperty(ref _allDayLanes, value)) OnPropertyChanged(nameof(AllDayHeight));
        }
    }

    /// <summary>The all-day row's height.</summary>
    public double AllDayHeight => _allDayLanes * LaneHeight + 8;

    /// <summary>The slots a cluster may use before its "+{n}" block, or null (unlimited, before the view measured).</summary>
    public int? MaxSlots => _maxSlots;

    /// <summary>One hour of the timeline (48 at 100 % text; it grows with the text size, §2.20).</summary>
    public double HourHeight => Math.Round(Timeline.BaseHourHeight * State.TextScale);

    /// <summary>The whole day's height.</summary>
    public double DayHeight => HourHeight * 24;

    /// <summary>One lane of the all-day row.</summary>
    public double LaneHeight => Math.Round(Timeline.BaseLaneHeight * State.TextScale);

    /// <summary>Block and bar text: 11 at 100 % text (§2.2 "Minimum sizes").</summary>
    public double BlockTextSize => Math.Round(11 * State.TextScale, 1);

    /// <summary>The hour labels' size (Geist Mono).</summary>
    public double HourTextSize => Math.Round(10.5 * State.TextScale, 1);

    /// <summary>The label column: wide enough for "12 PM" (or "00:00") at the current text size (§2.5).</summary>
    public double LabelWidth => Math.Ceiling((EventStrings.Use24Hour ? 52 : 58) * State.TextScale);

    /// <summary>Whether the hour labels use the 24-hour clock (the OS setting).</summary>
    public bool Use24Hour => EventStrings.Use24Hour;

    /// <summary>Where the timeline scrolls when a new period opens: 07:00, or the first event of the period if earlier (§2.5).</summary>
    public int ScrollMinute
    {
        get => _scrollMinute;
        private set => SetProperty(ref _scrollMinute, value);
    }

    /// <summary>Counts the scroll requests: the view scrolls to <see cref="ScrollMinute"/> when it changes (a new period, not every refresh).</summary>
    public int ScrollRequest
    {
        get => _scrollRequest;
        private set => SetProperty(ref _scrollRequest, value);
    }

    /// <summary>Every calendar is hidden: the timeline without items and "All calendars are hidden." with "Show calendars" (§2.4 "States").</summary>
    public bool ShowsAllHidden => Events?.AllHidden ?? false;

    /// <summary><c>calendar.allHidden</c></summary>
    public string AllHiddenText => CalendarStrings.AllHidden;

    /// <summary><c>calendar.allHidden.button</c></summary>
    public string ShowCalendarsText => CalendarStrings.AllHiddenButton;

    /// <summary>The label of the all-day row (board F1), hidden from assistive tech.</summary>
    public string AllDayLabel => MoveStrings.AllDayRow;

    /// <summary>The 24 hour labels ("00:00" ... "23:00", or "12 AM" ... "11 PM").</summary>
    public IReadOnlyList<string> HourLabels => Enumerable.Range(0, 24).Select(h => MoveStrings.HourLabel(h, EventStrings.Use24Hour)).ToArray();

    /// <summary>
    /// The width the view gives a day column: <c>maxSlots</c> = floor(width / slot width), at least 1. Re-lays the events
    /// when it changes.
    /// </summary>
    public void SetColumnWidth(double width)
    {
        if (double.IsNaN(width) || double.IsInfinity(width) || width <= 0) return;
        var slots = Math.Max(1, (int)Math.Floor(width / SlotWidth));
        if (_maxSlots == slots) return;
        _maxSlots = slots;
        OnPropertyChanged(nameof(MaxSlots));
        if (_built) Rebuild();
    }

    /// <summary>
    /// Builds the columns from the engine layout's timed items and overflow blocks; the subclass gives the columns'
    /// days and the all-day row.
    /// </summary>
    protected void Build(
        IReadOnlyList<TimelineColumn> columns,
        IReadOnlyList<TimedItem> timed,
        IReadOnlyList<TimedOverflow> overflow,
        IReadOnlyDictionary<string, CalendarItem> byKey,
        IReadOnlyList<object> allDay,
        string periodKey)
    {
        var now = Events?.Now();
        var showsToday = now is { } n && columns.Any(c => c.Date == n.Date);
        NowMinute = showsToday ? now!.Value.Minute : null;
        foreach (var column in columns)
        {
            var blocks = timed.Where(t => t.Column == column.Column && !t.Hidden && byKey.ContainsKey(t.Key))
                .Select(t => new TimelineBlock(Calendar, byKey[t.Key], t, column.Date))
                .OrderBy(b => b.StartMinute).ThenBy(b => b.Slot)
                .ToArray();
            var more = overflow.Where(o => o.Column == column.Column)
                .Select(o => new TimelineOverflow(Calendar, o, o.Keys.Where(byKey.ContainsKey).Select(k => byKey[k]).ToArray(), column.Date))
                .ToArray();
            column.Blocks = blocks;
            column.Overflows = more;
            column.Elements = blocks.Cast<object>().Concat(more).OrderBy(e => e is TimelineBlock b ? b.StartMinute : ((TimelineOverflow)e).StartMinute).ToArray();
            column.NowMinute = showsToday ? now!.Value.Minute : null;
        }
        Columns = columns;
        AllDay = allDay;
        AllDayLanes = Math.Max(1, allDay.OfType<ITimelinePlacement>().Select(p => p.Lane + 1).DefaultIfEmpty(0).Max());
        if (periodKey != _scrollKey)
        {
            // A new period opens at 07:00, or at its first event if earlier (§2.5); refreshes keep the scroll position.
            _scrollKey = periodKey;
            var first = columns.SelectMany(c => c.Blocks).Where(b => !b.ClippedStart).Select(b => b.StartMinute).DefaultIfEmpty(7 * 60).Min();
            ScrollMinute = Math.Min(7 * 60, first);
            ScrollRequest++;
        }
        _built = true;
        UpdateSelection();
        OnPropertyChanged(nameof(ShowsAllHidden));
    }

    /// <summary>Moves the now line to the current minute (the view calls it every minute).</summary>
    public void RefreshNow()
    {
        var now = Events?.Now();
        var showsToday = now is { } n && _columns.Any(c => c.Date == n.Date);
        NowMinute = showsToday ? now!.Value.Minute : null;
        foreach (var column in _columns) column.NowMinute = NowMinute;
    }

    /// <summary>The selection marks: the selected day's header, the selected event's blocks and bars.</summary>
    protected virtual void UpdateSelection()
    {
        var key = Calendar.SelectedItem?.Key;
        var date = Calendar.Date;
        foreach (var column in _columns)
        {
            column.IsSelected = column.Date == date;
            foreach (var block in column.Blocks) block.IsSelected = block.Item.Key == key;
        }
        foreach (var bar in _allDay.OfType<AllDayBar>()) bar.IsSelected = bar.Item.Key == key;
    }

    private void OnCalendarChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(CalendarViewModel.SelectedItem) or nameof(CalendarViewModel.Date)) UpdateSelection();
        if (e.PropertyName == nameof(CalendarViewModel.PeriodTitle)) OnPropertyChanged(nameof(GridName));
    }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(AppState.TextScale)) return;
        OnPropertyChanged(nameof(HourHeight));
        OnPropertyChanged(nameof(DayHeight));
        OnPropertyChanged(nameof(LaneHeight));
        OnPropertyChanged(nameof(AllDayHeight));
        OnPropertyChanged(nameof(BlockTextSize));
        OnPropertyChanged(nameof(HourTextSize));
        OnPropertyChanged(nameof(LabelWidth));
    }
}
