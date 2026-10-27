using System.ComponentModel;
using System.Globalization;
using System.Windows.Input;
using Avalonia.Media;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>Where a Month grid element sits in its week row (Controls/MonthEventGrid.cs lays the row out from it).</summary>
public interface IMonthPlacement
{
    /// <summary>The first column, 0 to 6.</summary>
    int Column { get; }

    /// <summary>How many columns it spans.</summary>
    int ColumnSpan { get; }

    /// <summary>The lane under the day header, or -1 for a whole day cell (behind the lanes).</summary>
    int Lane { get; }
}

/// <summary>
/// Calendar's Month mode at regular width (docs/EVENTS.md §2.4): a two-line weekday header (the 13-month weekday, then the
/// Gregorian weekday the column falls on this month), 4 week rows of day cells with the events in lanes from
/// <c>layoutThirteenMonthEvents</c> (bars across the days they cover inside a row, dots with their start time), "+N more"
/// where a day has more than fits, and the intercalary band under week 4. The view tells the model how many lanes fit
/// (<see cref="SetGeometry"/>). At 150 % text and above the grid becomes a list of the month's days with runs of empty
/// days (<see cref="DayList"/>, §2.4 "Accessibility text sizes").
/// </summary>
public sealed class MonthModeViewModel : CalendarModeViewModel
{
    private ThirteenMonthRef _month;
    private int? _maxLanes;
    private double _rowHeight = 132;
    private IReadOnlyList<MonthWeekdayHeader> _weekdays = [];
    private IReadOnlyList<MonthWeekRow> _weeks = [];
    private IReadOnlyList<MonthBand> _bands = [];
    private IReadOnlyList<object> _dayList = [];
    private string _gridName = "";
    private bool _built;

    /// <summary>Month mode of <paramref name="calendar"/>.</summary>
    public MonthModeViewModel(CalendarViewModel calendar) : base(calendar, CalendarMode.Month)
    {
        _month = CalendarPeriod.MonthOf(calendar.Date, calendar.State.System);
        calendar.PropertyChanged += OnCalendarChanged;
        State.PropertyChanged += OnStateChanged;
    }

    /// <summary>The month shown.</summary>
    public ThirteenMonthRef Month => _month;

    /// <summary>The 7 header cells.</summary>
    public IReadOnlyList<MonthWeekdayHeader> Weekdays
    {
        get => _weekdays;
        private set => SetProperty(ref _weekdays, value);
    }

    /// <summary>The 4 week rows.</summary>
    public IReadOnlyList<MonthWeekRow> Weeks
    {
        get => _weeks;
        private set => SetProperty(ref _weeks, value);
    }

    /// <summary>The intercalary days after week 4 (0, 1 or 2 bands).</summary>
    public IReadOnlyList<MonthBand> Bands
    {
        get => _bands;
        private set
        {
            if (SetProperty(ref _bands, value)) OnPropertyChanged(nameof(HasBands));
        }
    }

    /// <summary>Whether the month is followed by an intercalary day.</summary>
    public bool HasBands => _bands.Count > 0;

    /// <summary>
    /// The list of days at accessibility text sizes: <see cref="MonthListDay"/> rows and <see cref="MonthListEmptyRun"/>
    /// lines, in date order (<c>agenda(..., includeEmptyDays: true)</c>).
    /// </summary>
    public IReadOnlyList<object> DayList
    {
        get => _dayList;
        private set => SetProperty(ref _dayList, value);
    }

    /// <summary>The grid becomes the list of days (150 % text and above).</summary>
    public bool UsesDayList => State.UsesLargeText;

    /// <summary>The grid is shown.</summary>
    public bool UsesGrid => !State.UsesLargeText;

    /// <summary>Every calendar is hidden: the list of days says so with "Show calendars" (§2.4 "States").</summary>
    public bool ShowsAllHidden => Events?.AllHidden ?? false;

    /// <summary><c>calendar.allHidden</c></summary>
    public string AllHiddenText => CalendarStrings.AllHidden;

    /// <summary><c>calendar.allHidden.button</c></summary>
    public string ShowCalendarsText => CalendarStrings.AllHiddenButton;

    /// <summary>The grid's name for screen readers: "October 2026, IFC".</summary>
    public string GridName
    {
        get => _gridName;
        private set => SetProperty(ref _gridName, value);
    }

    /// <summary>Lane height: 20 at 100 % text, scaled with it (§2.4).</summary>
    public double LaneHeight => Math.Round(20 * State.TextScale);

    /// <summary>The day header of a cell (the day number and the Gregorian day).</summary>
    public double DayHeaderHeight => Math.Round(30 * State.TextScale);

    /// <summary>Chip and bar text: 11 at 100 % text, scaled with it (§2.2 "Minimum sizes").</summary>
    public double ChipTextSize => Math.Round(11 * State.TextScale, 1);

    /// <summary>The time column of the list of days (sized for "12:30 PM" at the current text size, as List's).</summary>
    public double ListTimeWidth => ListModeViewModel.TimeWidth(State.TextScale);

    /// <summary>The height of an intercalary band.</summary>
    public double BandHeight => Math.Round(46 * State.TextScale);

    /// <summary>The smallest row that still shows the day header and two lanes; below it the rows scroll.</summary>
    public double MinRowHeight => DayHeaderHeight + 2 * LaneHeight + 4;

    /// <summary>The height of a week row (set by the view from the window).</summary>
    public double RowHeight
    {
        get => _rowHeight;
        private set => SetProperty(ref _rowHeight, value);
    }

    /// <summary>The lanes that fit a cell, null for unlimited (tests and before the first layout).</summary>
    public int? MaxLanes => _maxLanes;

    /// <summary>
    /// The view's geometry: the row height it gives each week and the lanes that fit
    /// (floor((cell height - day header) / lane height), §2.4). Re-lays the events when the lanes change.
    /// </summary>
    public void SetGeometry(double rowHeight, int? maxLanes)
    {
        RowHeight = rowHeight;
        if (maxLanes is < 1) maxLanes = 1;
        if (_maxLanes == maxLanes) return;
        _maxLanes = maxLanes;
        if (_built) Rebuild();
    }

    /// <inheritdoc />
    internal override void DateChanged()
    {
        var month = CalendarPeriod.MonthOf(Calendar.Date, State.System);
        if (month != _month || !_built)
        {
            Invalidate();
            return;
        }
        UpdateSelection();
    }

    /// <inheritdoc />
    protected override void Rebuild()
    {
        var system = State.System;
        _month = CalendarPeriod.MonthOf(Calendar.Date, system);
        OnPropertyChanged(nameof(Month));
        var (year, month) = (_month.Year, _month.Month);
        var layout = new ThirteenMonthLayout(year, month, system);
        var span = CalendarPeriod.MonthSpan(_month, system);
        var items = Events?.Items(span[0], span[^1]) ?? [];
        var byKey = items.ToDictionary(i => i.Key, StringComparer.Ordinal);
        var events = new ThirteenMonthEventLayout(year, month, items.Select(i => i.Occurrence), system, _maxLanes);
        var counts = YearMark.Marks(year, items.Select(i => i.Occurrence), maxCalendars: 0).ToDictionary(m => m.Gregorian, m => m.Count);
        var today = State.Today;

        Weekdays = layout.Weekdays.Select((w, i) => new MonthWeekdayHeader(w, events.ColumnGregorianWeekdays[i])).ToArray();
        GridName = $"{layout.MonthInfo.Name} {system.DisplayYear(year).ToString(CultureInfo.InvariantCulture)}, {system.ShortName()}";

        var weeks = new List<MonthWeekRow>();
        for (var w = 0; w < ThirteenDate.WeeksPerMonth; w++)
        {
            var row = events.Weeks[w];
            var elements = new List<object>();
            var cells = layout.Weeks[w].Select((cell, c) => new MonthDayCell(this, cell, w, c, counts.GetValueOrDefault(cell.Gregorian), today)).ToArray();
            elements.AddRange(cells);
            elements.AddRange(Chips(row.Items, row.VisibleLanes, byKey, year, c => cells[c].Date));
            for (var c = 0; c < ThirteenDate.DaysPerWeek; c++)
            {
                if (row.Hidden[c] > 0) elements.Add(new MonthMore(this, cells[c].Date, c, row.VisibleLanes[c], row.Hidden[c], items));
            }
            weeks.Add(new MonthWeekRow(w + 1, elements));
        }
        Weeks = weeks;

        Bands = events.Intercalary.Select(band =>
        {
            var chips = Chips(band.Items, [band.VisibleLanes], byKey, year, _ => band.Gregorian).OrderBy(c => c.Lane).ToArray();
            var more = band.Hidden > 0 ? new MonthMore(this, band.Gregorian, 0, band.VisibleLanes, band.Hidden, items) : null;
            return new MonthBand(this, band.Gregorian, system, chips, more, counts.GetValueOrDefault(band.Gregorian), today);
        }).ToArray();

        DayList = BuildDayList(items, span, system);
        _built = true;
        UpdateSelection();
        OnPropertyChanged(nameof(ShowsAllHidden));
    }

    /// <summary>The chips of a row: each dot, and each bar split into the runs of columns where its lane is visible.</summary>
    private List<MonthChip> Chips(IEnumerable<MonthItem> items, IReadOnlyList<int> visibleLanes, Dictionary<string, CalendarItem> byKey, int rowYear, Func<int, GregorianDate> dayOf)
    {
        var chips = new List<MonthChip>();
        foreach (var item in items)
        {
            if (!byKey.TryGetValue(item.Key, out var source)) continue;
            var start = -1;
            for (var c = item.StartColumn; c <= item.EndColumn + 1; c++)
            {
                var visible = c <= item.EndColumn && item.Lane < visibleLanes[c];
                if (visible && start < 0) start = c;
                if (!visible && start >= 0)
                {
                    chips.Add(new MonthChip(this, source, item, start, c - 1, rowYear, dayOf(start)));
                    start = -1;
                }
            }
        }
        return chips;
    }

    private IReadOnlyList<object> BuildDayList(IReadOnlyList<CalendarItem> items, IReadOnlyList<GregorianDate> span, CalendarSystemId system)
    {
        var byKey = items.ToDictionary(i => i.Key, StringComparer.Ordinal);
        var days = AgendaDay.Days(items.Select(i => i.Occurrence), span[0], span[^1], system, includeEmptyDays: true);
        var list = new List<object>();
        var today = State.Today;
        for (var i = 0; i < days.Count; i++)
        {
            var day = days[i];
            if (day.Items.Count == 0)
            {
                var end = i;
                while (end + 1 < days.Count && days[end + 1].Items.Count == 0) end++;
                if (end > i)
                {
                    list.Add(new MonthListEmptyRun(this, day, days[end]));
                    i = end;
                    continue;
                }
            }
            var lines = day.Items.Take(3).Select(a => new CalendarRow(Calendar, byKey[a.Key], a, compactTime: false)).ToArray();
            list.Add(new MonthListDay(this, day, lines, day.Items.Count - lines.Length, today));
        }
        return list;
    }

    private void UpdateSelection()
    {
        var date = Calendar.Date;
        var key = Calendar.SelectedItem?.Key;
        foreach (var week in _weeks)
        {
            foreach (var element in week.Elements)
            {
                switch (element)
                {
                    case MonthDayCell cell:
                        cell.IsSelected = cell.Date == date;
                        break;
                    case MonthChip chip:
                        chip.IsSelected = chip.Item.Key == key;
                        break;
                }
            }
        }
        foreach (var band in _bands)
        {
            band.IsSelected = band.Date == date;
            foreach (var chip in band.Chips) chip.IsSelected = chip.Item.Key == key;
        }
        foreach (var entry in _dayList)
        {
            if (entry is MonthListDay day) day.IsSelected = day.Date == date;
        }
    }

    private void OnCalendarChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(CalendarViewModel.SelectedItem)) UpdateSelection();
    }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(AppState.TextScale)) return;
        OnPropertyChanged(nameof(UsesDayList));
        OnPropertyChanged(nameof(UsesGrid));
        OnPropertyChanged(nameof(LaneHeight));
        OnPropertyChanged(nameof(DayHeaderHeight));
        OnPropertyChanged(nameof(ChipTextSize));
        OnPropertyChanged(nameof(BandHeight));
        OnPropertyChanged(nameof(ListTimeWidth));
        OnPropertyChanged(nameof(MinRowHeight));
    }

    /// <summary>The lanes that fit a row of <paramref name="rowHeight"/>: floor((cell height - day header) / lane height), at least 1.</summary>
    public int LanesFor(double rowHeight) => Math.Max(1, (int)Math.Floor((rowHeight - DayHeaderHeight - 4) / LaneHeight));

    // ---- Actions of the elements -------------------------------------------------------------------

    internal void SelectDay(GregorianDate date) => Calendar.Date = date;

    internal void SelectItem(CalendarItem item) => Calendar.SelectedItem = item;
}

/// <summary>A weekday header cell: "Sun" over "Thu" (§2.4).</summary>
public sealed class MonthWeekdayHeader
{
    /// <summary>The header of a column whose 13-month weekday is <paramref name="weekday"/> and whose days fall on <paramref name="gregorian"/>.</summary>
    public MonthWeekdayHeader(Weekday weekday, Weekday gregorian)
    {
        Line1 = weekday.Name(NameStyle.Short);
        Line2 = gregorian.Name(NameStyle.Short);
        AutomationName = CalendarStrings.WeekdayA11y(weekday.Name(), gregorian.Name());
    }

    /// <summary>"Sun".</summary>
    public string Line1 { get; }

    /// <summary>"Thu" (the Gregorian weekday).</summary>
    public string Line2 { get; }

    /// <summary>"Sunday. Gregorian Thursday".</summary>
    public string AutomationName { get; }
}

/// <summary>One week row: 7 day cells, then the chips and "+N more" buttons over them.</summary>
/// <param name="Week">1 to 4.</param>
/// <param name="Elements"><see cref="MonthDayCell"/>s first (drawn behind), then <see cref="MonthChip"/>s and <see cref="MonthMore"/>s.</param>
public sealed record MonthWeekRow(int Week, IReadOnlyList<object> Elements)
{
    /// <summary>The day cells.</summary>
    public IEnumerable<MonthDayCell> Cells => Elements.OfType<MonthDayCell>();

    /// <summary>The chips.</summary>
    public IEnumerable<MonthChip> Chips => Elements.OfType<MonthChip>();
}

/// <summary>A day cell of the Month grid: the 13-month day, the Gregorian day (with the Gregorian month's label where one begins).</summary>
public sealed class MonthDayCell : ViewModelBase, INavigableDay, IMonthPlacement
{
    private bool _isSelected;

    internal MonthDayCell(MonthModeViewModel month, DayCell cell, int week, int column, int eventCount, GregorianDate today)
    {
        Date = cell.Gregorian;
        Thirteen = cell.Thirteen;
        Column = column;
        Week = week;
        Number = cell.Thirteen.Day.ToString(CultureInfo.InvariantCulture);
        GregorianDay = cell.Gregorian.Day.ToString(CultureInfo.InvariantCulture);
        GregorianMonthLabel = cell.IsGregorianMonthStart ? cell.Gregorian.MonthInfo.ShortName.ToUpperInvariant() : null;
        IsToday = cell.Gregorian == today;
        EventCount = eventCount;
        var name = CalendarStrings.CellA11y(CalendarStrings.ThirteenLong(cell.Thirteen), CalendarStrings.GregorianLong(cell.Gregorian));
        if (eventCount > 0) name += " " + CalendarStrings.CellEventsA11y(eventCount);
        if (cell.IsGregorianMonthStart) name += " " + CalendarStrings.GregorianMonthBeginsA11y(cell.Gregorian.MonthInfo.Name);
        AutomationName = name;
        NavIndex = week * 7 + column;
        NavOrder = cell.DayOfYear;
        SelectCommand = new RelayCommand(() => month.SelectDay(Date));
        NewEventCommand = new RelayCommand<object?>(anchor => month.Calendar.NewEvent(Date, anchor));
        OpenDayCommand = new RelayCommand(() => month.Calendar.OpenDay(Date));
        DayDetailsCommand = new RelayCommand(() => month.Shell.ShowDetail(Date));
    }

    /// <summary>The day.</summary>
    public GregorianDate Date { get; }

    /// <summary>The 13-month date.</summary>
    public ThirteenMonthDate Thirteen { get; }

    /// <summary>0 to 3.</summary>
    public int Week { get; }

    /// <inheritdoc />
    public int Column { get; }

    /// <inheritdoc />
    public int ColumnSpan => 1;

    /// <inheritdoc />
    public int Lane => -1;

    /// <summary>"12".</summary>
    public string Number { get; }

    /// <summary>"19" (the Gregorian day, small, Geist Mono).</summary>
    public string GregorianDay { get; }

    /// <summary>"NOV" above the Gregorian day where a Gregorian month begins, else null.</summary>
    public string? GregorianMonthLabel { get; }

    /// <summary>Whether a Gregorian month begins here.</summary>
    public bool HasGregorianMonthLabel => GregorianMonthLabel is not null;

    /// <summary>Today (the day number gets the accent fill).</summary>
    public bool IsToday { get; }

    /// <summary>The occurrences covering the day.</summary>
    public int EventCount { get; }

    /// <summary>"Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events." (§2.20).</summary>
    public string AutomationName { get; }

    /// <summary>"Today" for screen readers on today's cell (the trait of §2.20), else null.</summary>
    public string? ItemStatus => IsToday ? CalendarStrings.Today : null;

    /// <inheritdoc />
    public int NavIndex { get; }

    /// <inheritdoc />
    public int NavOrder { get; }

    /// <summary>The selected day (accent wash).</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    /// <summary>A click: selects the day.</summary>
    public ICommand SelectCommand { get; }

    /// <summary>A double-click on empty space, the menu's "New event": the editor on a draft that day.</summary>
    public ICommand NewEventCommand { get; }

    /// <summary>"Open day": Day mode.</summary>
    public ICommand OpenDayCommand { get; }

    /// <summary>"Day details": the comparison pane.</summary>
    public ICommand DayDetailsCommand { get; }

    /// <summary><c>calendar.newEvent</c></summary>
    public string NewEventText => CalendarStrings.NewEvent;

    /// <summary><c>calendar.menu.openDay</c></summary>
    public string OpenDayText => CalendarStrings.MenuOpenDay;

    /// <summary><c>calendar.menu.dayDetails</c></summary>
    public string DayDetailsText => CalendarStrings.MenuDayDetails;
}

/// <summary>A bar or dot of the Month grid (or of an intercalary band).</summary>
public sealed class MonthChip : ViewModelBase, IMonthPlacement
{
    private bool _isSelected;

    internal MonthChip(MonthModeViewModel month, CalendarItem item, MonthItem layout, int startColumn, int endColumn, int rowYear, GregorianDate day)
    {
        Item = item;
        Day = day;
        Column = startColumn;
        ColumnSpan = endColumn - startColumn + 1;
        Lane = layout.Lane;
        IsBar = layout.Style == MonthItemStyle.Bar;
        ContinuesBefore = startColumn > layout.StartColumn || layout.ContinuesBefore;
        ContinuesAfter = endColumn < layout.EndColumn || layout.ContinuesAfter;
        Time = IsBar ? null : ChipTime.Text(day == item.FirstDay ? item.Start.Minute : 0, EventStrings.Use24Hour);
        AutomationName = IsBar ? item.BarLabel(rowYear, layout.ContinuesBefore, layout.ContinuesAfter) : item.ItemLabel();
        SelectCommand = new RelayCommand(() => month.SelectItem(item));
        OpenCommand = new RelayCommand<object?>(anchor =>
        {
            month.SelectItem(item);
            month.Calendar.Actions.ShowDetails(item, anchor);
        });
        DuplicateCommand = new RelayCommand<object?>(anchor => month.Calendar.Actions.Duplicate(item, null, null, anchor));
        DeleteCommand = new RelayCommand<object?>(anchor => month.Calendar.Actions.Delete(item, anchor), _ => item.CanDelete);
        NewEventCommand = new RelayCommand<object?>(anchor => month.Calendar.NewEvent(day, anchor));
        OpenDayCommand = new RelayCommand(() => month.Calendar.OpenDay(day));
        DayDetailsCommand = new RelayCommand(() => month.Shell.ShowDetail(day));
    }

    /// <summary>The occurrence.</summary>
    public CalendarItem Item { get; }

    /// <summary>The first day the chip is drawn on (its menu's "Open day").</summary>
    public GregorianDate Day { get; }

    /// <inheritdoc />
    public int Column { get; }

    /// <inheritdoc />
    public int ColumnSpan { get; }

    /// <inheritdoc />
    public int Lane { get; }

    /// <summary>A bar rather than a dot.</summary>
    public bool IsBar { get; }

    /// <summary>Squared, notched start.</summary>
    public bool ContinuesBefore { get; }

    /// <summary>Squared, pointed end.</summary>
    public bool ContinuesAfter { get; }

    /// <summary>"09:30" or "9:30a" (dots only).</summary>
    public string? Time { get; }

    /// <summary>The title (user text).</summary>
    public string Title => Item.Title;

    /// <summary>The calendar color.</summary>
    public Color Color => Item.Color;

    /// <summary>Tentative.</summary>
    public bool IsTentative => Item.Status == EventStatus.Tentative;

    /// <summary>Canceled.</summary>
    public bool IsCanceled => Item.Status == EventStatus.Canceled;

    /// <summary>"Sprint planning, 09:30 to 10:30, Work, repeats" (§2.20).</summary>
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

    /// <summary>"New event" on the chip's day.</summary>
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

/// <summary>"+N more" in a cell: opens a flyout titled with the day that lists the whole day (§2.4).</summary>
public sealed class MonthMore : IMonthPlacement
{
    private readonly MonthModeViewModel _month;
    private readonly IReadOnlyList<CalendarItem> _items;
    private IReadOnlyList<CalendarRow>? _rows;

    internal MonthMore(MonthModeViewModel month, GregorianDate day, int column, int lane, int hidden, IReadOnlyList<CalendarItem> items)
    {
        _month = month;
        _items = items;
        Day = day;
        Column = column;
        Lane = lane;
        Hidden = hidden;
        var thirteen = ThirteenDate.FromGregorian(day, month.State.System);
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

    /// <summary>The items not drawn in the cell.</summary>
    public int Hidden { get; }

    /// <summary>"+3 more".</summary>
    public string Text { get; }

    /// <summary>"3 more events on Thursday, October 12, 2026".</summary>
    public string AutomationName { get; }

    /// <summary>The flyout's title: "Thursday, October 12".</summary>
    public string Heading { get; }

    /// <summary>"Gregorian Mon, Oct 19".</summary>
    public string Caption { get; }

    /// <summary>The whole day in the rows of the day list: all-day items, then timed items in start order.</summary>
    public IReadOnlyList<CalendarRow> Rows => _rows ??= CalendarRow.ForDay(_month.Calendar, _items, Day, _month.State.System);
}

/// <summary>An intercalary day as a full-width band under week 4 (§2.2): its code plate, name and Gregorian date, then its events.</summary>
public sealed class MonthBand : ViewModelBase, INavigableDay
{
    private bool _isSelected;

    internal MonthBand(MonthModeViewModel month, GregorianDate date, CalendarSystemId system, IReadOnlyList<MonthChip> chips, MonthMore? more, int eventCount, GregorianDate today)
    {
        var thirteen = (ThirteenIntercalaryDate)ThirteenDate.FromGregorian(date, system);
        Date = date;
        Code = thirteen.Info.Code;
        Name = thirteen.Format(FormatOptions.Long);
        GregorianText = "Gregorian " + date.Format(new FormatOptions(DateStyle.Short, IncludeWeekday: true));
        IsToday = date == today;
        Chips = chips;
        More = more;
        var name = CalendarStrings.BandA11y(Name, CalendarStrings.GregorianLong(date));
        if (eventCount > 0) name += " " + CalendarStrings.CellEventsA11y(eventCount);
        AutomationName = name;
        NavOrder = date.DayOfYear;
        SelectCommand = new RelayCommand(() => month.SelectDay(date));
        NewEventCommand = new RelayCommand<object?>(anchor => month.Calendar.NewEvent(date, anchor));
        OpenDayCommand = new RelayCommand(() => month.Calendar.OpenDay(date));
        DayDetailsCommand = new RelayCommand(() => month.Shell.ShowDetail(date));
    }

    /// <summary>The day.</summary>
    public GregorianDate Date { get; }

    /// <summary>"YD", "LD".</summary>
    public string Code { get; }

    /// <summary>"Year Day 2026".</summary>
    public string Name { get; }

    /// <summary>"Gregorian Thu, Dec 31".</summary>
    public string GregorianText { get; }

    /// <summary><c>picker.noWeekday</c>: "No weekday".</summary>
    public string NoWeekdayText => "No weekday";

    /// <summary>Today.</summary>
    public bool IsToday { get; }

    /// <summary>Its events in lanes (top to bottom).</summary>
    public IReadOnlyList<MonthChip> Chips { get; }

    /// <summary>"+N more", or null.</summary>
    public MonthMore? More { get; }

    /// <summary>Whether there is a "+N more".</summary>
    public bool HasMore => More is not null;

    /// <summary>"Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026. 1 event."</summary>
    public string AutomationName { get; }

    /// <summary>"Today" on today's band, else null.</summary>
    public string? ItemStatus => IsToday ? CalendarStrings.Today : null;

    /// <inheritdoc />
    public int NavIndex => -1;

    /// <inheritdoc />
    public int NavOrder { get; }

    /// <summary>The selected day.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    /// <summary>A click: selects the day.</summary>
    public ICommand SelectCommand { get; }

    /// <summary>"New event" (double-click or menu).</summary>
    public ICommand NewEventCommand { get; }

    /// <summary>"Open day".</summary>
    public ICommand OpenDayCommand { get; }

    /// <summary>"Day details".</summary>
    public ICommand DayDetailsCommand { get; }

    /// <summary><c>calendar.newEvent</c></summary>
    public string NewEventText => CalendarStrings.NewEvent;

    /// <summary><c>calendar.menu.openDay</c></summary>
    public string OpenDayText => CalendarStrings.MenuOpenDay;

    /// <summary><c>calendar.menu.dayDetails</c></summary>
    public string DayDetailsText => CalendarStrings.MenuDayDetails;
}

/// <summary>A day of the list of days (accessibility text sizes): its heading and up to three event lines, then "+{n} more".</summary>
public sealed class MonthListDay : ViewModelBase
{
    private bool _isSelected;

    internal MonthListDay(MonthModeViewModel month, AgendaDay day, IReadOnlyList<CalendarRow> lines, int more, GregorianDate today)
    {
        Date = day.Gregorian;
        Heading = CalendarStrings.ThirteenDayHeading(day.Thirteen);
        Caption = CalendarStrings.GregorianDayCaption(day.Gregorian);
        Lines = lines;
        IsToday = day.Gregorian == today;
        MoreCount = more;
        MoreText = more > 0 ? CalendarStrings.More(more) : null;
        MoreName = more > 0 ? CalendarStrings.MoreA11y(more, CalendarStrings.ThirteenLong(day.Thirteen)) : null;
        var name = CalendarStrings.CellA11y(CalendarStrings.ThirteenLong(day.Thirteen), CalendarStrings.GregorianLong(day.Gregorian));
        if (day.Items.Count > 0) name += " " + CalendarStrings.CellEventsA11y(day.Items.Count);
        AutomationName = name;
        SelectCommand = new RelayCommand(() => month.SelectDay(Date));
        OpenDayCommand = new RelayCommand(() => month.Calendar.OpenDay(Date));
    }

    /// <summary>The day.</summary>
    public GregorianDate Date { get; }

    /// <summary>"Thursday, October 12".</summary>
    public string Heading { get; }

    /// <summary>"Gregorian Mon, Oct 19".</summary>
    public string Caption { get; }

    /// <summary>Up to three event lines.</summary>
    public IReadOnlyList<CalendarRow> Lines { get; }

    /// <summary>Whether the day has events.</summary>
    public bool HasLines => Lines.Count > 0;

    /// <summary>Today.</summary>
    public bool IsToday { get; }

    /// <summary>The events not listed.</summary>
    public int MoreCount { get; }

    /// <summary>Whether "+{n} more" is shown.</summary>
    public bool HasMore => MoreCount > 0;

    /// <summary>"+2 more" (opens Day), or null.</summary>
    public string? MoreText { get; }

    /// <summary>"2 more events on Thursday, October 12, 2026", or null.</summary>
    public string? MoreName { get; }

    /// <summary>The day heading's name (the cell's name of §2.20).</summary>
    public string AutomationName { get; }

    /// <summary>The selected day.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    /// <summary>Selects the day.</summary>
    public ICommand SelectCommand { get; }

    /// <summary>"+{n} more": Day mode on the day.</summary>
    public ICommand OpenDayCommand { get; }
}

/// <summary>A run of two or more days without events: "No events, October 21 to October 23" (opens Day on the first).</summary>
public sealed class MonthListEmptyRun
{
    internal MonthListEmptyRun(MonthModeViewModel month, AgendaDay first, AgendaDay last)
    {
        First = first.Gregorian;
        Last = last.Gregorian;
        Text = CalendarStrings.EmptyRun(CalendarStrings.ThirteenShortName(first.Thirteen), CalendarStrings.ThirteenShortName(last.Thirteen));
        OpenDayCommand = new RelayCommand(() => month.Calendar.OpenDay(First));
    }

    /// <summary>The first day of the run.</summary>
    public GregorianDate First { get; }

    /// <summary>The last day of the run.</summary>
    public GregorianDate Last { get; }

    /// <summary>"No events, October 21 to October 23".</summary>
    public string Text { get; }

    /// <summary>Day mode on the first day.</summary>
    public ICommand OpenDayCommand { get; }
}
