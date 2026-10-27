using System.Globalization;
using System.Windows.Input;
using Avalonia.Media;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// Calendar's Day mode at regular width (docs/EVENTS.md §2.6): the header strip (the day's 13-month week as small day
/// buttons, plus intercalary days, the selected one filled; on an intercalary day the week before it), the all-day row,
/// the timeline of Week with one column (<c>maxSlots</c> = floor(column width / 64)), and the details panel on the right:
/// the selected event, or the day's comparison when nothing is selected. Paging, titles and the toolbar are done by
/// <see cref="CalendarViewModel"/>; drag and drop by the view through <see cref="CalendarViewModel.Mover"/>.
/// </summary>
public sealed class DayModeViewModel : TimelineModeViewModel
{
    private GregorianDate _day;
    private IReadOnlyList<DayStripItem> _strip = [];
    private DayEventLayout? _layout;
    private IReadOnlyList<CalendarItem> _dayItems = [];
    private DayDetailContent? _comparison;
    private DayPanelEvent? _selectedEvent;
    private bool _built;

    /// <summary>Day mode of <paramref name="calendar"/>.</summary>
    public DayModeViewModel(CalendarViewModel calendar) : base(calendar, CalendarMode.Day)
    {
        _day = calendar.Date;
    }

    /// <inheritdoc />
    protected override double SlotWidth => 64;

    /// <summary>The day shown.</summary>
    public GregorianDate Day => _day;

    /// <summary>The header strip: the day's 13-month week (plus intercalary days), the day itself selected.</summary>
    public IReadOnlyList<DayStripItem> Strip
    {
        get => _strip;
        private set => SetProperty(ref _strip, value);
    }

    /// <summary>The engine layout of the day (null before the first build).</summary>
    public DayEventLayout? Layout
    {
        get => _layout;
        private set => SetProperty(ref _layout, value);
    }

    /// <summary>The day's occurrences.</summary>
    public IReadOnlyList<CalendarItem> DayItems => _dayItems;

    /// <summary>The day has no events: "No events." in the details panel (§2.4 "States").</summary>
    public bool IsEmpty => _dayItems.Count == 0;

    /// <summary><c>calendar.day.empty</c></summary>
    public string EmptyText => CalendarStrings.DayEmpty;

    /// <summary>The day's comparison (the details panel when no event is selected).</summary>
    public DayDetailContent? Comparison
    {
        get => _comparison;
        private set => SetProperty(ref _comparison, value);
    }

    /// <summary>The selected event of this day (the details panel), or null.</summary>
    public DayPanelEvent? SelectedEvent
    {
        get => _selectedEvent;
        private set
        {
            if (SetProperty(ref _selectedEvent, value)) OnPropertyChanged(nameof(HasSelectedEvent));
        }
    }

    /// <summary>Whether the panel shows an event rather than the comparison.</summary>
    public bool HasSelectedEvent => _selectedEvent is not null;

    private Events.EventDetailsViewModel? _selectedDetails;

    /// <summary>The selected event's details (§2.6: the details of §2.10 with Edit, Delete event and More), or null.</summary>
    public Events.EventDetailsViewModel? SelectedDetails
    {
        get => _selectedDetails;
        private set
        {
            if (SetProperty(ref _selectedDetails, value))
            {
                OnPropertyChanged(nameof(HasSelectedDetails));
                OnPropertyChanged(nameof(ShowsSummary));
            }
        }
    }

    /// <summary>The panel shows the selected event's full details.</summary>
    public bool HasSelectedDetails => _selectedDetails is not null;

    /// <summary>The panel shows the short summary (no event actions attached yet).</summary>
    public bool ShowsSummary => _selectedEvent is not null && _selectedDetails is null;

    /// <summary>The heading over the comparison: "Thursday, October 12".</summary>
    public string Heading => CalendarStrings.ThirteenDayHeading(ThirteenDate.FromGregorian(_day, State.System));

    /// <summary>"Gregorian Mon, Oct 19".</summary>
    public string Caption => CalendarStrings.GregorianDayCaption(_day);

    /// <inheritdoc />
    internal override void DateChanged()
    {
        if (Calendar.Date != _day || !_built) Invalidate();
    }

    /// <inheritdoc />
    protected override void Rebuild()
    {
        var system = State.System;
        _day = Calendar.Date;
        OnPropertyChanged(nameof(Day));
        var week = CalendarPeriod.WeekOf(_day, system);
        var span = CalendarPeriod.WeekSpan(week, system);
        // The strip shows the week of the day (the intercalary columns of week 4 included).
        Strip = span.Select((d, i) => new DayStripItem(Calendar, d, system, d == _day, State.Today, i)).ToArray();
        var items = Events?.Items(_day, _day) ?? [];
        _dayItems = items;
        var byKey = items.ToDictionary(i => i.Key, StringComparer.Ordinal);
        var layout = new DayEventLayout(_day, items.Select(i => i.Occurrence), Timeline.MinBlockMinutes, MaxSlots);
        Layout = layout;
        var thirteen = ThirteenDate.FromGregorian(_day, system);
        var column = new TimelineColumn(Calendar, new WeekColumn(_day, thirteen), 0, State.Today, single: true);
        // The all-day row: one lane per bar, in order-key order; "+N more" after 3 lanes.
        var allDayItems = layout.AllDay
            .Where(byKey.ContainsKey)
            .Select((key, lane) => new MonthItem(key, MonthItemStyle.Bar, 0, 0, lane, byKey[key].FirstDay < _day, byKey[key].LastDay > _day))
            .ToArray();
        var (bars, more) = Timeline.AllDayRow(Calendar, allDayItems, 1, byKey, items, _ => _day, _day.Year);
        Build([column], layout.Timed, layout.Overflow, byKey, bars.Cast<object>().Concat(more).ToArray(),
            string.Create(CultureInfo.InvariantCulture, $"day {_day.ToIsoString()} {system}"));
        Comparison = new DayDetailContent(_day, State.Today, system);
        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(Heading));
        OnPropertyChanged(nameof(Caption));
        UpdatePanel();
        _built = true;
    }

    /// <inheritdoc />
    protected override void UpdateSelection()
    {
        base.UpdateSelection();
        foreach (var item in _strip) item.IsSelected = item.Date == Calendar.Date;
        UpdatePanel();
    }

    private void UpdatePanel()
    {
        var selected = Calendar.SelectedItem is { } s ? _dayItems.FirstOrDefault(i => i.Key == s.Key) : null;
        SelectedEvent = selected is null ? null : new DayPanelEvent(Calendar, selected);
        SelectedDetails = selected is null ? null : Calendar.Actions.DetailsFor(selected);
        OnPropertyChanged(nameof(ShowsSummary));
    }
}

/// <summary>A day button of Day mode's header strip (§2.6): weekday, 13-month day and Gregorian day; the selected one filled.</summary>
public sealed class DayStripItem : ViewModelBase, INavigableDay
{
    private bool _isSelected;

    internal DayStripItem(CalendarViewModel calendar, GregorianDate date, CalendarSystemId system, bool selected, GregorianDate today, int index)
    {
        Date = date;
        NavOrder = index;
        _isSelected = selected;
        IsToday = date == today;
        var thirteen = ThirteenDate.FromGregorian(date, system);
        GregorianText = date.Day.ToString(CultureInfo.InvariantCulture);
        if (thirteen is ThirteenMonthDate m)
        {
            WeekdayText = m.Weekday.Name(NameStyle.Short).ToUpperInvariant();
            DayText = m.Day.ToString(CultureInfo.InvariantCulture);
            AutomationName = CalendarStrings.ColumnA11y(CalendarStrings.ThirteenDayHeading(m), CalendarStrings.GregorianLongNoYear(date));
        }
        else
        {
            var i = (ThirteenIntercalaryDate)thirteen;
            WeekdayText = i.Info.Code;
            DayText = i.Info.Code;
            AutomationName = CalendarStrings.ColumnIntercalaryA11y(i.Format(FormatOptions.Long), CalendarStrings.GregorianLongNoYear(date));
        }
        SelectCommand = new RelayCommand(() => calendar.Date = date);
    }

    /// <summary>The day.</summary>
    public GregorianDate Date { get; }

    /// <summary>"THU", or the intercalary day's code.</summary>
    public string WeekdayText { get; }

    /// <summary>"12".</summary>
    public string DayText { get; }

    /// <summary>"19" (the Gregorian day, small).</summary>
    public string GregorianText { get; }

    /// <summary>Today.</summary>
    public bool IsToday { get; }

    /// <summary>The day shown (filled).</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    /// <summary>"Thursday, October 12. Gregorian Monday, October 19".</summary>
    public string AutomationName { get; }

    /// <summary>"Today" for screen readers on today, else null.</summary>
    public string? ItemStatus => IsToday ? CalendarStrings.Today : null;

    /// <summary>Whether this is an intercalary day (its code shown in place of the weekday and day).</summary>
    public bool IsIntercalary => WeekdayText == DayText;

    /// <inheritdoc />
    public int NavIndex => -1;

    /// <inheritdoc />
    public int NavOrder { get; }

    /// <summary>A click: Day mode on that day.</summary>
    public ICommand SelectCommand { get; }
}

/// <summary>
/// The selected event in Day mode's details panel (§2.6): its title (a button that opens the details flyout of task W7,
/// §2.10), time, calendar and location.
/// </summary>
public sealed class DayPanelEvent
{
    internal DayPanelEvent(CalendarViewModel calendar, CalendarItem item)
    {
        Item = item;
        OpenCommand = new RelayCommand<object?>(anchor => calendar.Actions.ShowDetails(item, anchor));
        EditCommand = new RelayCommand<object?>(anchor => calendar.EditSelected(anchor));
    }

    /// <summary>The occurrence.</summary>
    public CalendarItem Item { get; }

    /// <summary>The title (user text).</summary>
    public string Title => Item.Title;

    /// <summary>"09:30 to 10:30", or "All day".</summary>
    public string TimeText => Item.TimeRangeText;

    /// <summary>The calendar's name (user text).</summary>
    public string CalendarName => Item.CalendarName;

    /// <summary>The calendar color.</summary>
    public IBrush ColorBrush => new SolidColorBrush(Item.Color);

    /// <summary>The location (user text), or "".</summary>
    public string Location => Item.Location;

    /// <summary>Whether there is a location.</summary>
    public bool HasLocation => Item.Location.Length > 0;

    /// <summary>The panel's accessible name (<c>calendar.item.a11y</c> + flags).</summary>
    public string AutomationName => Item.ItemLabel();

    /// <summary>Its details (§2.10): the flyout of task W7.</summary>
    public ICommand OpenCommand { get; }

    /// <summary>Edit (Ctrl+E).</summary>
    public ICommand EditCommand { get; }

    /// <summary><c>event.edit</c></summary>
    public string EditText => EditorStrings.Edit;

    /// <summary>Whether Edit is offered (read-only events cannot be edited).</summary>
    public bool CanEdit => Item.CanEdit;
}
