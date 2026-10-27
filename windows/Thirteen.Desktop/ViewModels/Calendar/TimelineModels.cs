using System.Globalization;
using System.Windows.Input;
using Avalonia.Media;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// The parts of the Week and Day timelines (docs/EVENTS.md §2.5, §2.6; board F1, K2) that Week and Day share: the
/// columns with their headers and blocks, the "+{n}" overflow blocks, the all-day row's bars and "+N more", and the
/// geometry (hour height, label column) at the current text size. The engine lays the events out
/// (<c>layoutThirteenWeekEvents</c>, <c>layoutDayEvents</c>, §5.3); these models only name and place them.
/// </summary>
public static class Timeline
{
    /// <summary>The hour height at 100 % text (it grows with the text size, §2.20).</summary>
    public const double BaseHourHeight = 48;

    /// <summary>Minimum visual height of a block: 15 minutes (§2.5).</summary>
    public const int MinBlockMinutes = 15;

    /// <summary>Width of an intercalary column relative to a day's (60 %, §2.5).</summary>
    public const double IntercalaryWeight = 0.6;

    /// <summary>The all-day lanes shown before "+N more" takes the last one (§2.5: collapsible after 3 lanes).</summary>
    public const int AllDayLanes = 3;

    /// <summary>Height of one all-day lane at 100 % text.</summary>
    public const double BaseLaneHeight = 22;

    /// <summary>The time "+{n}" and the block labels name: "14:00" or "2:00 PM".</summary>
    public static string TimeText(int minute) => EventStrings.Time(minute);

    /// <summary>The bars of an all-day row: each bar split into the runs of columns where its lane is visible, and "+N more" where a column has more lanes than fit.</summary>
    internal static (List<AllDayBar> Bars, List<AllDayMore> More) AllDayRow(
        CalendarViewModel calendar,
        IReadOnlyList<MonthItem> items,
        int columnCount,
        IReadOnlyDictionary<string, CalendarItem> byKey,
        IReadOnlyList<CalendarItem> all,
        Func<int, GregorianDate> dayOf,
        int rowYear)
    {
        var used = new int[columnCount];
        foreach (var item in items)
        {
            for (var c = item.StartColumn; c <= item.EndColumn; c++) used[c] = Math.Max(used[c], item.Lane + 1);
        }
        var visible = used.Select(u => u > AllDayLanes ? AllDayLanes - 1 : u).ToArray();
        var bars = new List<AllDayBar>();
        foreach (var item in items)
        {
            if (!byKey.TryGetValue(item.Key, out var source)) continue;
            var start = -1;
            for (var c = item.StartColumn; c <= item.EndColumn + 1; c++)
            {
                var shown = c <= item.EndColumn && item.Lane < visible[c];
                if (shown && start < 0) start = c;
                if (!shown && start >= 0)
                {
                    bars.Add(new AllDayBar(calendar, source, item, start, c - 1, rowYear, dayOf(start)));
                    start = -1;
                }
            }
        }
        var more = new List<AllDayMore>();
        for (var c = 0; c < columnCount; c++)
        {
            if (used[c] <= AllDayLanes) continue;
            var hidden = items.Count(i => i.StartColumn <= c && c <= i.EndColumn && i.Lane >= visible[c]);
            if (hidden > 0) more.Add(new AllDayMore(calendar, dayOf(c), c, visible[c], hidden, all));
        }
        return (bars, more);
    }
}

/// <summary>Something laid out on the weighted columns of a timeline (headers, bars, column bodies).</summary>
public interface ITimelinePlacement
{
    /// <summary>The first column.</summary>
    int Column { get; }

    /// <summary>How many columns it spans.</summary>
    int ColumnSpan { get; }

    /// <summary>The lane of an all-day row, or -1.</summary>
    int Lane { get; }
}

/// <summary>
/// One column of a timeline: a day of the 13-month week (or an intercalary day after week 4, 60 % wide and hatched),
/// its header (<c>THU</c>, <c>12</c>, <c>Mon, Oct 19</c>; an intercalary day by its code plate and name), and its blocks
/// in start order. The column body is one accessibility container named <c>calendar.column.a11y</c> (§2.20); its header
/// is the day's focus stop (arrows between days, Enter or F2 into its events, §2.21).
/// </summary>
public sealed class TimelineColumn : ViewModelBase, INavigableDay, ITimelinePlacement
{
    private bool _isSelected;
    private int? _nowMinute;

    internal TimelineColumn(CalendarViewModel calendar, WeekColumn column, int index, GregorianDate today, bool single)
    {
        Calendar = calendar;
        Date = column.Gregorian;
        Column = index;
        IsToday = column.Gregorian == today;
        IsIntercalary = column.Thirteen is ThirteenIntercalaryDate;
        Weight = IsIntercalary && !single ? Timeline.IntercalaryWeight : 1;
        GregorianText = column.Gregorian.Format(new FormatOptions(DateStyle.Short, IncludeWeekday: true));
        GregorianShortText = column.Gregorian.Format(new FormatOptions(DateStyle.Short));
        GregorianDayText = column.Gregorian.Day.ToString(CultureInfo.InvariantCulture);
        if (column.Thirteen is ThirteenMonthDate m)
        {
            WeekdayText = m.Weekday.Name(NameStyle.Short).ToUpperInvariant();
            DayText = m.Day.ToString(CultureInfo.InvariantCulture);
            ShortText = $"{m.Weekday.Name(NameStyle.Short)} {DayText}";
            AutomationName = CalendarStrings.ColumnA11y(CalendarStrings.ThirteenDayHeading(m), CalendarStrings.GregorianLongNoYear(column.Gregorian));
        }
        else
        {
            var i = (ThirteenIntercalaryDate)column.Thirteen;
            Code = i.Info.Code;
            WeekdayText = i.Info.Name;
            DayText = i.Info.Code;
            ShortText = i.Info.Name;
            AutomationName = CalendarStrings.ColumnIntercalaryA11y(i.Format(FormatOptions.Long), CalendarStrings.GregorianLongNoYear(column.Gregorian));
        }
        NavOrder = index;
        SelectCommand = new RelayCommand(() => calendar.Date = Date);
        OpenDayCommand = new RelayCommand(() => calendar.OpenDay(Date));
        NewEventCommand = new RelayCommand<object?>(anchor => NewEventAt(NextHalfHour?.Invoke() ?? 9 * 60, anchor));
        DayDetailsCommand = new RelayCommand(() => calendar.Shell.ShowDetail(Date));
    }

    /// <summary>The Calendar section.</summary>
    public CalendarViewModel Calendar { get; }

    /// <summary>The day.</summary>
    public GregorianDate Date { get; }

    /// <inheritdoc />
    public int Column { get; }

    /// <inheritdoc />
    public int ColumnSpan => 1;

    /// <inheritdoc />
    public int Lane => -1;

    /// <summary>Today: the header in the accent text color and the body tinted (board F1).</summary>
    public bool IsToday { get; }

    /// <summary>An intercalary day (hatched; 60 % wide in Week).</summary>
    public bool IsIntercalary { get; }

    /// <summary>Its width relative to a day's.</summary>
    public double Weight { get; }

    /// <summary>"THU" (Geist Mono, small caps), or the intercalary day's name.</summary>
    public string WeekdayText { get; }

    /// <summary>"12", or the intercalary day's code.</summary>
    public string DayText { get; }

    /// <summary>"Thu 12" (§2.5 header), or "Year Day".</summary>
    public string ShortText { get; }

    /// <summary>"Mon, Oct 19".</summary>
    public string GregorianText { get; }

    /// <summary>"Oct 19" (a narrow column).</summary>
    public string GregorianShortText { get; }

    /// <summary>"19" (a very narrow column).</summary>
    public string GregorianDayText { get; }

    /// <summary>"YD" on an intercalary column, else null.</summary>
    public string? Code { get; }

    /// <summary>Whether the code plate is shown.</summary>
    public bool HasCode => Code is not null;

    /// <summary>Whether the day number is shown (a day of the week, not an intercalary day).</summary>
    public bool HasDayNumber => Code is null;

    /// <summary><c>calendar.column.a11y</c> or <c>calendar.column.intercalary.a11y</c> (the container's and the header's name).</summary>
    public string AutomationName { get; }

    /// <summary>"Today" for screen readers on today's header, else null.</summary>
    public string? ItemStatus => IsToday ? CalendarStrings.Today : null;

    /// <inheritdoc />
    public int NavIndex => -1;

    /// <inheritdoc />
    public int NavOrder { get; }

    /// <summary>The selected day (Calendar's date).</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    /// <summary>The blocks of the column, in start order (the order they are focused in).</summary>
    public IReadOnlyList<TimelineBlock> Blocks { get; internal set; } = [];

    /// <summary>The "+{n}" blocks of the column.</summary>
    public IReadOnlyList<TimelineOverflow> Overflows { get; internal set; } = [];

    /// <summary>Blocks and overflow blocks together, in start order (the column body's children).</summary>
    public IReadOnlyList<object> Elements { get; internal set; } = [];

    /// <summary>The now line's minute when the timeline shows today (full strength in today's column, faint in the others), else null.</summary>
    public int? NowMinute
    {
        get => _nowMinute;
        internal set => SetProperty(ref _nowMinute, value);
    }

    /// <summary>The next half hour at the top of the visible timeline (set by the view), for the column's "New event" action (§2.6).</summary>
    public Func<int>? NextHalfHour { get; set; }

    /// <summary>A click on the header: selects the day.</summary>
    public ICommand SelectCommand { get; }

    /// <summary>"Open day".</summary>
    public ICommand OpenDayCommand { get; }

    /// <summary>The column's "New event" (the "Add event" action of §2.20): the editor at the next half hour on screen, one hour long.</summary>
    public ICommand NewEventCommand { get; }

    /// <summary>"Day details".</summary>
    public ICommand DayDetailsCommand { get; }

    /// <summary><c>calendar.newEvent</c></summary>
    public string NewEventText => CalendarStrings.NewEvent;

    /// <summary><c>calendar.menu.openDay</c></summary>
    public string OpenDayText => CalendarStrings.MenuOpenDay;

    /// <summary><c>calendar.menu.dayDetails</c></summary>
    public string DayDetailsText => CalendarStrings.MenuDayDetails;

    /// <summary>The editor on an unsaved one-hour draft at <paramref name="minute"/> of this day (nothing is stored until Add).</summary>
    public void NewEventAt(int minute, object? anchor)
    {
        minute = Math.Clamp(minute / 30 * 30, 0, 23 * 60);
        Calendar.Actions.NewEvent(Date, minute, minute + 60, anchor);
    }
}

/// <summary>
/// A timed event on a timeline column (§2.5): placed by the engine's slot and slot count, at least 15 minutes tall, in
/// the calendar's color with a 3 px edge (board F1). Named <c>calendar.item.a11y</c> + flags (§2.20).
/// </summary>
public sealed class TimelineBlock : ViewModelBase
{
    private bool _isSelected;

    internal TimelineBlock(CalendarViewModel calendar, CalendarItem item, TimedItem layout, GregorianDate day)
    {
        Item = item;
        Day = day;
        Column = layout.Column;
        StartMinute = layout.StartMinute;
        EndMinute = layout.EndMinute;
        Slot = layout.Slot;
        SlotCount = Math.Max(1, layout.SlotCount);
        ClippedStart = layout.ClippedStart;
        ClippedEnd = layout.ClippedEnd;
        TimeText = item.TimeRangeText;
        StartText = Timeline.TimeText(item.Start.Minute);
        var from = ClippedStart ? CalendarStrings.BarDate(item.FirstDay, day.Year) : null;
        var to = ClippedEnd ? CalendarStrings.BarDate(item.LastDay, day.Year) : null;
        AutomationName = item.ItemLabel(from, to);
        SelectCommand = new RelayCommand(() => calendar.SelectedItem = item);
        OpenCommand = new RelayCommand<object?>(anchor =>
        {
            calendar.SelectedItem = item;
            calendar.Actions.ShowDetails(item, anchor);
        });
        DuplicateCommand = new RelayCommand<object?>(anchor => calendar.Actions.Duplicate(item, null, null, anchor));
        DeleteCommand = new RelayCommand<object?>(anchor => calendar.Actions.Delete(item, anchor), _ => item.CanDelete);
        NewEventCommand = new RelayCommand<object?>(anchor => calendar.NewEvent(day, anchor));
        OpenDayCommand = new RelayCommand(() => calendar.OpenDay(day));
        DayDetailsCommand = new RelayCommand(() => calendar.Shell.ShowDetail(day));
    }

    /// <summary>The occurrence.</summary>
    public CalendarItem Item { get; }

    /// <summary>The column's day.</summary>
    public GregorianDate Day { get; }

    /// <summary>The column.</summary>
    public int Column { get; }

    /// <summary>Start on the column's day (0..1440).</summary>
    public int StartMinute { get; }

    /// <summary>End on the column's day (0..1440).</summary>
    public int EndMinute { get; }

    /// <summary>The drawn end: at least 15 minutes after the start (§2.5), within the day.</summary>
    public int VisualEndMinute => Math.Min(1440, Math.Max(EndMinute, StartMinute + Timeline.MinBlockMinutes));

    /// <summary>Its slot in its overlap cluster.</summary>
    public int Slot { get; }

    /// <summary>The cluster's slots (the block is 1 / SlotCount of the column wide).</summary>
    public int SlotCount { get; }

    /// <summary>It started on an earlier day.</summary>
    public bool ClippedStart { get; }

    /// <summary>It ends on a later day.</summary>
    public bool ClippedEnd { get; }

    /// <summary>The title (user text).</summary>
    public string Title => Item.Title;

    /// <summary>"09:30 to 10:30".</summary>
    public string TimeText { get; }

    /// <summary>"09:30" (the start, on one line with the title of a short block).</summary>
    public string StartText { get; }

    /// <summary>The location (user text), or "".</summary>
    public string Location => Item.Location;

    /// <summary>The calendar color.</summary>
    public Color Color => Item.Color;

    /// <summary>Tentative (a hatch).</summary>
    public bool IsTentative => Item.Status == EventStatus.Tentative;

    /// <summary>Canceled (the title struck through).</summary>
    public bool IsCanceled => Item.Status == EventStatus.Canceled;

    /// <summary>It can be dragged (read-only events show no grab handles, §2.2).</summary>
    public bool CanMove => Item.CanEdit;

    /// <summary>Its bottom edge can be dragged (it ends on this day).</summary>
    public bool CanResize => Item.CanEdit && !ClippedEnd;

    /// <summary><c>calendar.item.a11y</c> + flags: "Design review, 14:00 to 15:30, Work".</summary>
    public string AutomationName { get; }

    /// <summary>The selected event.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    /// <summary>A click: selects the event.</summary>
    public ICommand SelectCommand { get; }

    /// <summary>A double-click or Enter: its details.</summary>
    public ICommand OpenCommand { get; }

    /// <summary>"Duplicate".</summary>
    public ICommand DuplicateCommand { get; }

    /// <summary>"Delete" (absent on read-only events, kept on historical ones).</summary>
    public ICommand DeleteCommand { get; }

    /// <summary>"New event" on the block's day.</summary>
    public ICommand NewEventCommand { get; }

    /// <summary>"Open day".</summary>
    public ICommand OpenDayCommand { get; }

    /// <summary>"Day details".</summary>
    public ICommand DayDetailsCommand { get; }

    /// <summary>Whether "Delete" is offered.</summary>
    public bool CanDelete => Item.CanDelete;

    /// <summary><c>calendar.newEvent</c></summary>
    public string NewEventText => CalendarStrings.NewEvent;

    /// <summary><c>calendar.menu.openDay</c></summary>
    public string OpenDayText => CalendarStrings.MenuOpenDay;

    /// <summary><c>calendar.menu.dayDetails</c></summary>
    public string DayDetailsText => CalendarStrings.MenuDayDetails;

    /// <summary><c>calendar.menu.duplicate</c></summary>
    public string DuplicateText => CalendarStrings.MenuDuplicate;

    /// <summary><c>calendar.menu.delete</c></summary>
    public string DeleteText => CalendarStrings.MenuDelete;
}

/// <summary>
/// The "+{n}" block of a crowded cluster (§2.5): in the last slot, covering the hidden events' time range; its flyout
/// lists them. Named <c>calendar.moreAt.a11y</c> ("3 more events at 14:00").
/// </summary>
public sealed class TimelineOverflow
{
    private readonly CalendarViewModel _calendar;
    private readonly IReadOnlyList<CalendarItem> _hidden;
    private IReadOnlyList<CalendarRow>? _rows;

    internal TimelineOverflow(CalendarViewModel calendar, TimedOverflow layout, IReadOnlyList<CalendarItem> hidden, GregorianDate day)
    {
        _calendar = calendar;
        _hidden = hidden;
        Day = day;
        Column = layout.Column;
        Slot = layout.Slot;
        SlotCount = Math.Max(1, layout.SlotCount);
        StartMinute = layout.StartMinute;
        EndMinute = Math.Min(1440, Math.Max(layout.EndMinute, layout.StartMinute + Timeline.MinBlockMinutes));
        Count = layout.Keys.Count;
        Text = MoveStrings.OverflowBlock(Count);
        AutomationName = CalendarStrings.MoreAtA11y(Count, Timeline.TimeText(layout.StartMinute));
    }

    /// <summary>The column's day.</summary>
    public GregorianDate Day { get; }

    /// <summary>The column.</summary>
    public int Column { get; }

    /// <summary>maxSlots - 1.</summary>
    public int Slot { get; }

    /// <summary>maxSlots.</summary>
    public int SlotCount { get; }

    /// <summary>The hidden events' earliest start.</summary>
    public int StartMinute { get; }

    /// <summary>The hidden events' latest end (at least 15 minutes after the start).</summary>
    public int EndMinute { get; }

    /// <summary>The drawn end.</summary>
    public int VisualEndMinute => EndMinute;

    /// <summary>The hidden events.</summary>
    public int Count { get; }

    /// <summary>"+3".</summary>
    public string Text { get; }

    /// <summary>"3 more events at 14:00" (the name, and the flyout's title).</summary>
    public string AutomationName { get; }

    /// <summary>The flyout's title (board K2: "8 more events at 14:00").</summary>
    public string Heading => AutomationName;

    /// <summary>The hidden events as rows of the day list.</summary>
    public IReadOnlyList<CalendarRow> Rows => _rows ??= CalendarRow.ForDay(_calendar, _hidden, Day, _calendar.State.System);
}

/// <summary>A bar of a timeline's all-day row (all-day events and timed ones of 24 hours or more, §2.2), across its columns.</summary>
public sealed class AllDayBar : ViewModelBase, ITimelinePlacement
{
    private bool _isSelected;

    internal AllDayBar(CalendarViewModel calendar, CalendarItem item, MonthItem layout, int startColumn, int endColumn, int rowYear, GregorianDate day)
    {
        Item = item;
        Day = day;
        Column = startColumn;
        ColumnSpan = endColumn - startColumn + 1;
        Lane = layout.Lane;
        ContinuesBefore = startColumn > layout.StartColumn || layout.ContinuesBefore;
        ContinuesAfter = endColumn < layout.EndColumn || layout.ContinuesAfter;
        AutomationName = item.BarLabel(rowYear, layout.ContinuesBefore, layout.ContinuesAfter);
        SelectCommand = new RelayCommand(() => calendar.SelectedItem = item);
        OpenCommand = new RelayCommand<object?>(anchor =>
        {
            calendar.SelectedItem = item;
            calendar.Actions.ShowDetails(item, anchor);
        });
        DuplicateCommand = new RelayCommand<object?>(anchor => calendar.Actions.Duplicate(item, null, null, anchor));
        DeleteCommand = new RelayCommand<object?>(anchor => calendar.Actions.Delete(item, anchor), _ => item.CanDelete);
        NewEventCommand = new RelayCommand<object?>(anchor => calendar.NewEvent(day, anchor));
        OpenDayCommand = new RelayCommand(() => calendar.OpenDay(day));
        DayDetailsCommand = new RelayCommand(() => calendar.Shell.ShowDetail(day));
    }

    /// <summary>The occurrence.</summary>
    public CalendarItem Item { get; }

    /// <summary>The first day the bar is drawn on.</summary>
    public GregorianDate Day { get; }

    /// <inheritdoc />
    public int Column { get; }

    /// <inheritdoc />
    public int ColumnSpan { get; }

    /// <inheritdoc />
    public int Lane { get; }

    /// <summary>A bar (the chip visual draws bars and dots).</summary>
    public bool IsBar => true;

    /// <summary>Squared, notched start.</summary>
    public bool ContinuesBefore { get; }

    /// <summary>Squared, pointed end.</summary>
    public bool ContinuesAfter { get; }

    /// <summary>The title (user text).</summary>
    public string Title => Item.Title;

    /// <summary>The calendar color.</summary>
    public Color Color => Item.Color;

    /// <summary>Tentative.</summary>
    public bool IsTentative => Item.Status == EventStatus.Tentative;

    /// <summary>Canceled.</summary>
    public bool IsCanceled => Item.Status == EventStatus.Canceled;

    /// <summary>It can be dragged.</summary>
    public bool CanMove => Item.CanEdit;

    /// <summary><c>calendar.bar.a11y</c> + flags.</summary>
    public string AutomationName { get; }

    /// <summary>The selected event.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    /// <summary>A click: selects the event.</summary>
    public ICommand SelectCommand { get; }

    /// <summary>A double-click or Enter: its details.</summary>
    public ICommand OpenCommand { get; }

    /// <summary>"Duplicate".</summary>
    public ICommand DuplicateCommand { get; }

    /// <summary>"Delete".</summary>
    public ICommand DeleteCommand { get; }

    /// <summary>"New event".</summary>
    public ICommand NewEventCommand { get; }

    /// <summary>"Open day".</summary>
    public ICommand OpenDayCommand { get; }

    /// <summary>"Day details".</summary>
    public ICommand DayDetailsCommand { get; }

    /// <summary>Whether "Delete" is offered.</summary>
    public bool CanDelete => Item.CanDelete;

    /// <summary><c>calendar.newEvent</c></summary>
    public string NewEventText => CalendarStrings.NewEvent;

    /// <summary><c>calendar.menu.openDay</c></summary>
    public string OpenDayText => CalendarStrings.MenuOpenDay;

    /// <summary><c>calendar.menu.dayDetails</c></summary>
    public string DayDetailsText => CalendarStrings.MenuDayDetails;

    /// <summary><c>calendar.menu.duplicate</c></summary>
    public string DuplicateText => CalendarStrings.MenuDuplicate;

    /// <summary><c>calendar.menu.delete</c></summary>
    public string DeleteText => CalendarStrings.MenuDelete;
}

/// <summary>"+N more" in a column of the all-day row when it has more than 3 lanes: a flyout with the whole day's all-day events.</summary>
public sealed class AllDayMore : ITimelinePlacement
{
    private readonly CalendarViewModel _calendar;
    private readonly IReadOnlyList<CalendarItem> _items;
    private IReadOnlyList<CalendarRow>? _rows;

    internal AllDayMore(CalendarViewModel calendar, GregorianDate day, int column, int lane, int hidden, IReadOnlyList<CalendarItem> items)
    {
        _calendar = calendar;
        _items = items;
        Day = day;
        Column = column;
        Lane = lane;
        Hidden = hidden;
        var thirteen = ThirteenDate.FromGregorian(day, calendar.State.System);
        Text = CalendarStrings.More(hidden);
        AutomationName = CalendarStrings.MoreA11y(hidden, CalendarStrings.ThirteenLong(thirteen));
        Heading = CalendarStrings.ThirteenDayHeading(thirteen);
        Caption = CalendarStrings.GregorianDayCaption(day);
    }

    /// <summary>The day.</summary>
    public GregorianDate Day { get; }

    /// <inheritdoc />
    public int Column { get; }

    /// <inheritdoc />
    public int ColumnSpan => 1;

    /// <inheritdoc />
    public int Lane { get; }

    /// <summary>The bars not drawn in the column.</summary>
    public int Hidden { get; }

    /// <summary>"+3 more".</summary>
    public string Text { get; }

    /// <summary>"3 more events on Thursday, October 12, 2026".</summary>
    public string AutomationName { get; }

    /// <summary>"Thursday, October 12".</summary>
    public string Heading { get; }

    /// <summary>"Gregorian Mon, Oct 19".</summary>
    public string Caption { get; }

    /// <summary>The day's all-day events and bars as rows.</summary>
    public IReadOnlyList<CalendarRow> Rows => _rows ??= CalendarRow.ForDay(
        _calendar, _items.Where(i => i.IsBar && i.FirstDay <= Day && i.LastDay >= Day).ToArray(), Day, _calendar.State.System);
}
