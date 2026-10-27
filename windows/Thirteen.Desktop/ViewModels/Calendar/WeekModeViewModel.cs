using System.Globalization;
using Thirteen.Core;
using Thirteen.Core.Events;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// Calendar's Week mode (docs/EVENTS.md §2.5, board F1): the 7 days of a 13-month week as timeline columns, plus a 60 %
/// wide hatched column for each intercalary day after week 4; headers in both calendars; the all-day row (bars across
/// columns, lanes, "+N more" after 3 lanes); the timeline 00:00 to 24:00 with blocks from <c>layoutThirteenWeekEvents</c>
/// (<c>maxSlots</c> = floor(column width / 48)), "+{n}" blocks, the now line under the blocks. Paging, titles and the
/// toolbar are done by <see cref="CalendarViewModel"/>; drag and drop by the view through <see cref="CalendarViewModel.Mover"/>.
/// </summary>
public sealed class WeekModeViewModel : TimelineModeViewModel
{
    private ThirteenWeekRef _week;
    private WeekEventLayout? _layout;
    private IReadOnlyDictionary<string, CalendarItem> _items = new Dictionary<string, CalendarItem>();

    /// <summary>Week mode of <paramref name="calendar"/>.</summary>
    public WeekModeViewModel(CalendarViewModel calendar) : base(calendar, CalendarMode.Week)
    {
        _week = CalendarPeriod.WeekOf(calendar.Date, calendar.State.System);
    }

    /// <inheritdoc />
    protected override double SlotWidth => 48;

    /// <summary>The week shown.</summary>
    public ThirteenWeekRef Week => _week;

    /// <summary>The engine layout of the week (null before the first build).</summary>
    public WeekEventLayout? Layout
    {
        get => _layout;
        private set => SetProperty(ref _layout, value);
    }

    /// <summary>The week's occurrences by key.</summary>
    public IReadOnlyDictionary<string, CalendarItem> Items => _items;

    /// <inheritdoc />
    internal override void DateChanged()
    {
        if (CalendarPeriod.WeekOf(Calendar.Date, State.System) != _week || Columns.Count == 0) Invalidate();
    }

    /// <inheritdoc />
    protected override void Rebuild()
    {
        var system = State.System;
        _week = CalendarPeriod.WeekOf(Calendar.Date, system);
        OnPropertyChanged(nameof(Week));
        var span = CalendarPeriod.WeekSpan(_week, system);
        var items = Events?.Items(span[0], span[^1]) ?? [];
        _items = items.ToDictionary(i => i.Key, StringComparer.Ordinal);
        var layout = new WeekEventLayout(_week.Year, _week.Month, _week.Week, items.Select(i => i.Occurrence), system, Timeline.MinBlockMinutes, MaxSlots);
        var today = State.Today;
        var columns = layout.Columns.Select((c, i) => new TimelineColumn(Calendar, c, i, today, single: false)).ToArray();
        var (bars, more) = Timeline.AllDayRow(Calendar, layout.AllDay, columns.Length, _items, items, c => columns[c].Date, span[0].Year);
        Layout = layout;
        Build(columns, layout.Timed, layout.Overflow, _items, bars.Cast<object>().Concat(more).ToArray(),
            string.Create(CultureInfo.InvariantCulture, $"week {_week.Year}-{_week.Month}-{_week.Week} {system}"));
    }
}
