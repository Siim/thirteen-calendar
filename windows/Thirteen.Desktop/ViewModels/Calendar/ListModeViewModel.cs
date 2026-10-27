using System.ComponentModel;
using System.Globalization;
using System.Windows.Input;
using Avalonia.Media;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// Calendar's List mode (docs/EVENTS.md §2.7): every event from the Calendar's day onward, grouped by 13-month month
/// (a sticky header, "October 2026") and day ("Thursday, October 12" with "Gregorian Mon, Oct 19"; an intercalary day
/// heads as "Year Day"), days without events skipped, multi-day events on every day they cover. It loads one Gregorian
/// year at a time: <see cref="LoadLater"/> at the end of the list, <see cref="LoadEarlier"/> when scrolled up past the
/// start. Empty: "No upcoming events." with "New event"; every calendar hidden: "All calendars are hidden." with "Show
/// calendars".
/// </summary>
public sealed class ListModeViewModel : CalendarModeViewModel
{
    private GregorianDate _from;
    private GregorianDate _to;
    private GregorianDate _anchor;
    private IReadOnlyList<object> _rows = [];

    /// <summary>List mode of <paramref name="calendar"/>.</summary>
    public ListModeViewModel(CalendarViewModel calendar) : base(calendar, CalendarMode.List)
    {
        _anchor = calendar.Date;
        _from = _anchor;
        _to = YearAfter(_anchor);
        calendar.PropertyChanged += OnCalendarChanged;
    }

    /// <summary>The rows: <see cref="ListMonthHeader"/>, <see cref="ListDayHeader"/> and <see cref="CalendarRow"/>, in date order.</summary>
    public IReadOnlyList<object> Rows
    {
        get => _rows;
        private set
        {
            if (!SetProperty(ref _rows, value)) return;
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(ShowsEmpty));
            OnPropertyChanged(nameof(ShowsAllHidden));
        }
    }

    /// <summary>The first day loaded.</summary>
    public GregorianDate From => _from;

    /// <summary>The last day loaded.</summary>
    public GregorianDate To => _to;

    /// <summary>No event in the loaded range.</summary>
    public bool IsEmpty => !_rows.OfType<CalendarRow>().Any();

    /// <summary>"No upcoming events." with "New event" is shown.</summary>
    public bool ShowsEmpty => IsEmpty && !(Events?.AllHidden ?? false) && (Events?.IsLoaded ?? true);

    /// <summary>"All calendars are hidden." with "Show calendars" is shown.</summary>
    public bool ShowsAllHidden => Events?.AllHidden ?? false;

    /// <summary><c>calendar.list.empty</c></summary>
    public string EmptyText => CalendarStrings.ListEmpty;

    /// <summary><c>calendar.newEvent</c></summary>
    public string NewEventText => CalendarStrings.NewEvent;

    /// <summary><c>calendar.allHidden</c></summary>
    public string AllHiddenText => CalendarStrings.AllHidden;

    /// <summary><c>calendar.allHidden.button</c></summary>
    public string ShowCalendarsText => CalendarStrings.AllHiddenButton;

    /// <summary>The time column, wide enough for "12:30 PM" (or "00:00") at the current text size (§2.7).</summary>
    public double TimeColumnWidth => TimeWidth(State.TextScale);

    /// <summary>The time column for a text scale: room for "12:30 PM" (or "All day", "Day 2 of 3" on two lines) in Geist Mono.</summary>
    public static double TimeWidth(double textScale) => Math.Round((EventStrings.Use24Hour ? 64 : 84) * textScale);

    /// <summary>Whether a year before <see cref="From"/> can still be loaded.</summary>
    public bool CanLoadEarlier => _from.Year > GregorianDate.MinYear || _from.DayOfYear > 1;

    /// <summary>Whether a year after <see cref="To"/> can still be loaded.</summary>
    public bool CanLoadLater => _to < GregorianDate.MaxValue;

    /// <summary>Loads the next Gregorian year of events (the end of the list was reached).</summary>
    public void LoadLater()
    {
        if (!CanLoadLater) return;
        _to = YearAfter(_to);
        Rebuild();
    }

    /// <summary>Loads the year before <see cref="From"/> (scrolled up past the start); returns whether anything was added.</summary>
    public bool LoadEarlier()
    {
        if (!CanLoadEarlier) return false;
        var before = _rows.Count;
        _from = _from.Year > GregorianDate.MinYear
            ? new GregorianDate(_from.Year - 1, _from.Month, Math.Min(_from.Day, GregorianDate.DaysInMonth(_from.Year - 1, _from.Month)))
            : new GregorianDate(GregorianDate.MinYear, 1, 1);
        Rebuild();
        return _rows.Count != before;
    }

    /// <summary>The day the list starts at (the Calendar's day).</summary>
    public GregorianDate Anchor => _anchor;

    private static GregorianDate YearAfter(GregorianDate date)
    {
        if (date.Year >= GregorianDate.MaxYear) return GregorianDate.MaxValue;
        var year = date.Year + 1;
        return new GregorianDate(year, date.Month, Math.Min(date.Day, GregorianDate.DaysInMonth(year, date.Month))).AddDays(-1);
    }

    /// <inheritdoc />
    internal override void DateChanged()
    {
        if (Calendar.Date == _anchor && _rows.Count > 0) return;
        _anchor = Calendar.Date;
        _from = _anchor;
        _to = YearAfter(_anchor);
        Invalidate();
    }

    /// <summary>Moves the "Now" plate to the events running now (the view calls it every 30 seconds).</summary>
    public void RefreshNow()
    {
        if (Events?.Now() is not { } now) return;
        foreach (var row in Rows.OfType<CalendarRow>()) row.IsNow = EventListRow.InProgress(row.Item, now);
    }

    /// <inheritdoc />
    protected override void Rebuild()
    {
        var system = State.System;
        var items = Events?.Items(_from, _to) ?? [];
        var byKey = items.ToDictionary(i => i.Key, StringComparer.Ordinal);
        var days = AgendaDay.Days(items.Select(i => i.Occurrence), _from, _to, system);
        var rows = new List<object>();
        ThirteenMonthRef? month = null;
        var selected = Calendar.SelectedItem?.Key;
        var now = Events?.Now();
        foreach (var day in days)
        {
            var dayMonth = CalendarPeriod.MonthOf(day.Gregorian, system);
            if (dayMonth != month)
            {
                month = dayMonth;
                rows.Add(new ListMonthHeader(dayMonth, system));
            }
            rows.Add(new ListDayHeader(day, State.Today));
            foreach (var part in day.Items)
            {
                var row = new CalendarRow(Calendar, byKey[part.Key], part, compactTime: false, rowLabel: true);
                row.IsSelected = row.Item.Key == selected;
                row.IsNow = now is { } n && EventListRow.InProgress(row.Item, n);
                rows.Add(row);
            }
        }
        Rows = rows;
        OnPropertyChanged(nameof(From));
        OnPropertyChanged(nameof(To));
        OnPropertyChanged(nameof(CanLoadEarlier));
        OnPropertyChanged(nameof(CanLoadLater));
        OnPropertyChanged(nameof(TimeColumnWidth));
    }

    /// <summary>The month header in force at a row (the sticky header shows it for the first visible row).</summary>
    public ListMonthHeader? MonthHeaderAt(int index)
    {
        for (var i = Math.Min(index, _rows.Count - 1); i >= 0; i--)
        {
            if (_rows[i] is ListMonthHeader header) return header;
        }
        return null;
    }

    private void OnCalendarChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(CalendarViewModel.SelectedItem)) return;
        var key = Calendar.SelectedItem?.Key;
        foreach (var row in _rows.OfType<CalendarRow>()) row.IsSelected = row.Item.Key == key;
    }
}

/// <summary>A 13-month month header of the list: "October 2026" (Positivist "Descartes 238").</summary>
public sealed class ListMonthHeader
{
    internal ListMonthHeader(ThirteenMonthRef month, CalendarSystemId system)
    {
        Month = month;
        Text = $"{system.Months()[month.Month - 1].Name} {system.DisplayYear(month.Year).ToString(CultureInfo.InvariantCulture)}";
    }

    /// <summary>The month.</summary>
    public ThirteenMonthRef Month { get; }

    /// <summary>"October 2026".</summary>
    public string Text { get; }
}

/// <summary>A day header of the list: "Thursday, October 12" with "Gregorian Mon, Oct 19".</summary>
public sealed class ListDayHeader
{
    internal ListDayHeader(AgendaDay day, GregorianDate today)
    {
        Date = day.Gregorian;
        Heading = CalendarStrings.ThirteenDayHeading(day.Thirteen);
        Caption = CalendarStrings.GregorianDayCaption(day.Gregorian);
        IsToday = day.Gregorian == today;
        AutomationName = $"{Heading}. {Caption}";
    }

    /// <summary>The day.</summary>
    public GregorianDate Date { get; }

    /// <summary>"Thursday, October 12" or "Year Day".</summary>
    public string Heading { get; }

    /// <summary>"Gregorian Mon, Oct 19".</summary>
    public string Caption { get; }

    /// <summary>Today.</summary>
    public bool IsToday { get; }

    /// <summary>The header read as one line.</summary>
    public string AutomationName { get; }
}

/// <summary>
/// One occurrence on one day in a list (List mode, the "+N more" flyout, the list of days at large text; the same row as
/// Today's Up next, §2.8): a time column (Geist Mono: the start, "All day", or "Day 2 of 3"), the calendar dot, the title,
/// and a second line with the location, "until 10:30" or "Day 1 of 7".
/// </summary>
public sealed class CalendarRow : ViewModelBase
{
    private bool _isSelected;

    /// <summary>The row of <paramref name="item"/>'s part <paramref name="part"/>; <paramref name="rowLabel"/> names it with <c>calendar.row.a11y</c> (List, Up next), else <c>calendar.item.a11y</c> (day lists).</summary>
    public CalendarRow(CalendarViewModel calendar, CalendarItem item, AgendaItem part, bool compactTime, bool rowLabel = false)
    {
        ArgumentNullException.ThrowIfNull(calendar);
        Item = item ?? throw new ArgumentNullException(nameof(item));
        ArgumentNullException.ThrowIfNull(part);
        var multi = part.DayCount > 1;
        string Time(int minute) => compactTime ? ChipTime.Text(minute % 1440, EventStrings.Use24Hour) : EventStrings.Time(minute);
        TimeText = item.AllDay
            ? CalendarStrings.AllDay
            : part.Part is AgendaPart.Middle or AgendaPart.Last
                ? CalendarStrings.DayOfDays(part.DayIndex, part.DayCount)
                : Time(part.StartMinute ?? 0);
        // As the web's agendaRowDetail: an all-day event of several days says which day; else the location, else when a
        // timed event ends on this day.
        SubText = item.AllDay
            ? multi ? CalendarStrings.DayOfDays(part.DayIndex, part.DayCount) : ""
            : item.Location.Length > 0
                ? item.Location
                : part.Part is AgendaPart.Single or AgendaPart.Last
                    ? CalendarStrings.Until(EventStrings.Time(part.EndMinute ?? item.End.Minute))
                    : "";
        AutomationName = rowLabel
            ? item.RowLabel(TimeText, multi ? (part.DayIndex, part.DayCount) : null)
            : item.ItemLabel();
        SelectCommand = new RelayCommand(() => calendar.SelectedItem = item);
        OpenCommand = new RelayCommand<object?>(anchor =>
        {
            calendar.SelectedItem = item;
            calendar.Actions.ShowDetails(item, anchor);
        });
    }

    /// <summary>The rows of one day, in agenda order (all-day items, then timed items by start).</summary>
    public static IReadOnlyList<CalendarRow> ForDay(CalendarViewModel calendar, IReadOnlyList<CalendarItem> items, GregorianDate day, CalendarSystemId system)
    {
        ArgumentNullException.ThrowIfNull(items);
        var byKey = items.ToDictionary(i => i.Key, StringComparer.Ordinal);
        var agenda = AgendaDay.Days(items.Select(i => i.Occurrence), day, day, system);
        return agenda.Count == 0 ? [] : agenda[0].Items.Select(part => new CalendarRow(calendar, byKey[part.Key], part, compactTime: false)).ToArray();
    }

    /// <summary>The occurrence.</summary>
    public CalendarItem Item { get; }

    /// <summary>"09:30", "9:30 AM", "All day", "Day 2 of 3".</summary>
    public string TimeText { get; }

    /// <summary>The title (user text).</summary>
    public string Title => Item.Title;

    /// <summary>The calendar color.</summary>
    public Color Color => Item.Color;

    /// <summary>The calendar color as a brush (the row's dot).</summary>
    public IBrush ColorBrush => new Avalonia.Media.Immutable.ImmutableSolidColorBrush(Item.Color);

    /// <summary>The location, "until 10:30", "Day 1 of 7", or "".</summary>
    public string SubText { get; }

    /// <summary>Whether there is a second line.</summary>
    public bool HasSubText => SubText.Length > 0;

    /// <summary>Tentative: a "Tentative" tag.</summary>
    public bool IsTentative => Item.Status == EventStatus.Tentative;

    /// <summary>Canceled: a "Canceled" tag and a struck title.</summary>
    public bool IsCanceled => Item.Status == EventStatus.Canceled;

    /// <summary>The tag text ("Tentative", "Canceled"), or null.</summary>
    public string? Tag => IsCanceled ? CalendarStrings.Canceled : IsTentative ? CalendarStrings.Tentative : null;

    /// <summary>Whether a tag is shown.</summary>
    public bool HasTag => Tag is not null;

    /// <summary>The accessible name (§2.20).</summary>
    public string AutomationName { get; }

    /// <summary>The selected event.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    private bool _isNow;

    /// <summary>A timed event running now: the "Now" plate in List, as in Up next (§2.7, board J2).</summary>
    public bool IsNow
    {
        get => _isNow;
        set
        {
            if (SetProperty(ref _isNow, value)) OnPropertyChanged(nameof(ItemStatus));
        }
    }

    /// <summary><c>today.now</c></summary>
    public string NowText => TodayStrings.Now;

    /// <summary>The Now plate as the row's item status for Narrator ("Now"), else empty.</summary>
    public string ItemStatus => _isNow ? TodayStrings.Now : "";

    /// <summary>A click: selects the event.</summary>
    public ICommand SelectCommand { get; }

    /// <summary>A double-click or Enter: its details.</summary>
    public ICommand OpenCommand { get; }
}
