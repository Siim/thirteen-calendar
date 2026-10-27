namespace Thirteen.Core.Events;

// Layouts of event occurrences for the Calendar section (docs/EVENTS.md §2.3 to §2.8, §5.2, §5.3),
// mirroring packages/core/src/events/layout.ts: Month lanes and intercalary bands, the Week and Day timelines
// with their overflow blocks, the List agenda, Year marks, the Month header's Gregorian weekdays and the
// compact chip time.
//
// Every layout takes EventOccurrences in the DEVICE's wall clock, ends in end-of-day form. An occurrence
// touches every date from its start date to the date of its end-of-day form (a zero-length one its start
// date). An all-day occurrence or one of 24 hours or more is a bar; a shorter timed one is a dot in Month and
// a block on the timelines. Order key (§5.3): start, then all-day bars, timed bars, dots, then longer first,
// then title and key by Unicode code points. Interpretations pinned by the fixtures (see layout.ts): Month
// and all-day lanes sort by clipped start column, then bars before dots, then the order key; unlimited
// maxLanes reports the lanes the row uses; overflowed timeline items keep their cluster's slot; a timed
// occurrence whose end is before its start is laid out as zero-length.

/// <summary>Whether a Month item is a bar or a dot.</summary>
public enum MonthItemStyle
{
    /// <summary><c>bar</c>: all-day or 24 hours or more.</summary>
    Bar,
    /// <summary><c>dot</c>: a shorter timed occurrence (one item per day it touches).</summary>
    Dot,
}

/// <summary>One bar or dot in a Month week row, an intercalary band or the Week all-day row. TS: <c>MonthItem</c>.</summary>
/// <param name="Key">The occurrence key.</param>
/// <param name="Style">Bar or dot.</param>
/// <param name="StartColumn">0..6 in a week row (0 in a band; up to 8 in the Week all-day row).</param>
/// <param name="EndColumn">Inclusive.</param>
/// <param name="Lane">The lane.</param>
/// <param name="ContinuesBefore">The occurrence starts before the start column's day.</param>
/// <param name="ContinuesAfter">The occurrence ends after the end column's day.</param>
public sealed record MonthItem(string Key, MonthItemStyle Style, int StartColumn, int EndColumn, int Lane, bool ContinuesBefore, bool ContinuesAfter);

/// <summary>One week row of a Month layout. TS: <c>MonthWeekRow</c>.</summary>
/// <param name="Week">1..4.</param>
/// <param name="Items">In lane-assignment order.</param>
/// <param name="VisibleLanes">Per column (7): lanes that show items; with an overflow the next lane holds "+{hidden} more".</param>
/// <param name="Hidden">Per column (7): items not drawn in that column.</param>
public sealed record MonthWeekRow(int Week, ValueList<MonthItem> Items, ValueList<int> VisibleLanes, ValueList<int> Hidden);

/// <summary>An intercalary day drawn as a full-width band under week 4 of the month it follows. TS: <c>IntercalaryBand</c>.</summary>
public sealed record IntercalaryBand(IntercalaryDayId Id, GregorianDate Gregorian, ValueList<MonthItem> Items, int VisibleLanes, int Hidden);

/// <summary>A shorter timed occurrence on one Week or Day column. TS: <c>TimedItem</c>.</summary>
/// <param name="Key">The occurrence key.</param>
/// <param name="Column">The column.</param>
/// <param name="StartMinute">Clipped to the column's day, 0..1440.</param>
/// <param name="EndMinute">Clipped to the column's day, 0..1440.</param>
/// <param name="ClippedStart">The occurrence starts on an earlier day.</param>
/// <param name="ClippedEnd">The occurrence ends on a later day.</param>
/// <param name="Slot">Horizontal position inside its overlap cluster.</param>
/// <param name="SlotCount">x = Slot x column width / SlotCount.</param>
/// <param name="Hidden">Drawn only through its <see cref="TimedOverflow"/>.</param>
public sealed record TimedItem(string Key, int Column, int StartMinute, int EndMinute, bool ClippedStart, bool ClippedEnd, int Slot, int SlotCount, bool Hidden);

/// <summary>The "+{n}" block of §2.5: the items a cluster could not show. TS: <c>TimedOverflow</c>.</summary>
/// <param name="Column">The column.</param>
/// <param name="Slot">maxSlots - 1.</param>
/// <param name="SlotCount">maxSlots.</param>
/// <param name="StartMinute">The hidden items' earliest start.</param>
/// <param name="EndMinute">The hidden items' latest effective end.</param>
/// <param name="Keys">Hidden items in order-key order.</param>
public sealed record TimedOverflow(int Column, int Slot, int SlotCount, int StartMinute, int EndMinute, ValueList<string> Keys);

/// <summary>
/// A column of the Week timeline: a day of the 13-month week (<see cref="Thirteen"/> a
/// <see cref="ThirteenMonthDate"/>), or an intercalary day after week 4. TS: <c>WeekColumn</c>.
/// </summary>
public sealed record WeekColumn(GregorianDate Gregorian, ThirteenDate Thirteen)
{
    /// <summary><c>"day"</c> or <c>"intercalary"</c>.</summary>
    public string Kind => Thirteen is ThirteenMonthDate ? "day" : "intercalary";
}

/// <summary>Which part of a multi-day occurrence an agenda item is.</summary>
public enum AgendaPart
{
    /// <summary><c>single</c>.</summary>
    Single,
    /// <summary><c>first</c>.</summary>
    First,
    /// <summary><c>middle</c>.</summary>
    Middle,
    /// <summary><c>last</c>.</summary>
    Last,
}

/// <summary>One occurrence on one day of the agenda. TS: <c>AgendaItem</c>.</summary>
/// <param name="Key">The occurrence key.</param>
/// <param name="Part">Single, first, middle or last.</param>
/// <param name="DayIndex">1-based day of the occurrence ("Day 2 of 3").</param>
/// <param name="DayCount">Days the whole occurrence touches.</param>
/// <param name="StartMinute">The part's start on this day; null for all-day occurrences and middle parts.</param>
/// <param name="EndMinute">The part's end on this day (1440 at midnight); null for all-day occurrences and middle parts.</param>
public sealed record AgendaItem(string Key, AgendaPart Part, int DayIndex, int DayCount, int? StartMinute, int? EndMinute);

/// <summary>Shared preparation of the occurrences of one layout call (validation and the order key).</summary>
internal sealed class Prepared
{
    public const int RankAllDay = 0;
    public const int RankTimedBar = 1;
    public const int RankDot = 2;

    public required string Key { get; init; }
    public required string CalendarId { get; init; }
    public required string Title { get; init; }
    public required bool AllDay { get; init; }
    public required long Start { get; init; }
    public required long End { get; init; }
    public required long Duration { get; init; }
    public required long FirstDay { get; init; }
    public required long LastDay { get; init; }
    public required int Rank { get; init; }
    public required bool Bar { get; init; }
    public int Order { get; set; }

    /// <summary>Compares two strings by Unicode code points (UTF-16 unit order differs only for surrogates). TS: <c>compareCodePoints</c>.</summary>
    public static int CompareCodePoints(string a, string b)
    {
        if (string.Equals(a, b, StringComparison.Ordinal)) return 0;
        var length = Math.Min(a.Length, b.Length);
        for (var i = 0; i < length; i++)
        {
            int x = a[i];
            int y = b[i];
            if (x != y) return UnitRank(x) < UnitRank(y) ? -1 : 1;
        }
        return a.Length < b.Length ? -1 : 1;
    }

    private static int UnitRank(int unit) => unit < 0xd800 ? unit : unit >= 0xe000 ? unit - 0x800 : unit + 0x2000;

    private static int CompareOrderKey(Prepared a, Prepared b)
    {
        var c = a.Start.CompareTo(b.Start);
        if (c != 0) return c;
        c = a.Rank.CompareTo(b.Rank);
        if (c != 0) return c;
        c = b.Duration.CompareTo(a.Duration);
        if (c != 0) return c;
        c = CompareCodePoints(a.Title, b.Title);
        return c != 0 ? c : CompareCodePoints(a.Key, b.Key);
    }

    private static Prepared One(EventOccurrence value, int index, string context)
    {
        string Where() => $"{context}: occurrence {index.Inv()} (key {Ev.Show(value?.Key)})";
        if (value is null) throw Ev.Fail($"{context}: occurrence {index.Inv()} must be an EventOccurrence object, got null");
        if (value.Key is null) throw Ev.Fail($"{Where()}: key must be a string");
        if (value.CalendarId is null) throw Ev.Fail($"{Where()}: calendarId must be a string, got null");
        if (value.Title is null) throw Ev.Fail($"{Where()}: title must be a string, got null");
        EventTime.AssertPlain(value.Start, $"start of {Where()}");
        var start = value.Start.Absolute;
        var end = value.End.Absolute;
        if (value.AllDay)
        {
            if (value.Start.Minute != 0 || (value.End.Minute != 0 && value.End.Minute != Ev.Day))
            {
                throw Ev.Fail($"{Where()}: an all-day occurrence runs from T00:00 to T24:00 (or T00:00) of whole days");
            }
            if (end < start) throw Ev.Fail($"{Where()}: the end is before the start");
        }
        else if (end < start)
        {
            end = start; // a fall-back night: laid out as zero-length (§5.3 step 6)
        }
        var duration = end - start;
        var firstDay = Ev.FloorDiv(start, Ev.Day);
        var bar = value.AllDay || duration >= Ev.Day;
        return new Prepared
        {
            Key = value.Key,
            CalendarId = value.CalendarId,
            Title = value.Title,
            AllDay = value.AllDay,
            Start = start,
            End = end,
            Duration = duration,
            FirstDay = firstDay,
            LastDay = duration > 0 ? Ev.FloorDiv(end - 1, Ev.Day) : firstDay,
            Rank = value.AllDay ? RankAllDay : bar ? RankTimedBar : RankDot,
            Bar = bar,
        };
    }

    /// <summary>Validates the occurrences and returns them prepared, in order-key order.</summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for an invalid occurrence or a repeated key.</exception>
    public static List<Prepared> All(IEnumerable<EventOccurrence> occurrences, string context)
    {
        if (occurrences is null) throw Ev.Fail($"{context}: occurrences must be an array, got null");
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var prepared = new List<Prepared>();
        var index = 0;
        foreach (var occurrence in occurrences)
        {
            var item = One(occurrence, index++, context);
            if (!keys.Add(item.Key)) throw Ev.Fail($"{context}: the occurrence key {Ev.Show(item.Key)} is used twice (keys must be unique, §3.2)");
            prepared.Add(item);
        }
        Ev.StableSort(prepared, CompareOrderKey);
        for (var i = 0; i < prepared.Count; i++) prepared[i].Order = i;
        return prepared;
    }
}

/// <summary>Month lanes (§5.3 Month steps 1 to 3), shared by Month rows, intercalary bands and the Week all-day row.</summary>
internal static class Lanes
{
    internal sealed class Work(Prepared source, MonthItemStyle style, int startColumn, int endColumn, bool continuesBefore, bool continuesAfter)
    {
        public Prepared Source { get; } = source;
        public MonthItemStyle Style { get; } = style;
        public int StartColumn { get; } = startColumn;
        public int EndColumn { get; } = endColumn;
        public bool ContinuesBefore { get; } = continuesBefore;
        public bool ContinuesAfter { get; } = continuesAfter;
        public int Lane { get; set; } = -1;

        public MonthItem ToItem() => new(Source.Key, Style, StartColumn, EndColumn, Lane, ContinuesBefore, ContinuesAfter);
    }

    /// <summary>The items of <paramref name="p"/> for the contiguous days <paramref name="first"/>..<paramref name="last"/>: one clipped bar, or a dot per day touched.</summary>
    public static void Collect(Prepared p, long first, long last, bool withDots, List<Work> output)
    {
        if (p.LastDay < first || p.FirstDay > last) return;
        var from = Math.Max(p.FirstDay, first);
        var to = Math.Min(p.LastDay, last);
        if (p.Bar)
        {
            output.Add(new Work(p, MonthItemStyle.Bar, (int)(from - first), (int)(to - first), p.FirstDay < from, p.LastDay > to));
            return;
        }
        if (!withDots) return;
        for (var day = from; day <= to; day++)
        {
            output.Add(new Work(p, MonthItemStyle.Dot, (int)(day - first), (int)(day - first), p.FirstDay < day, p.LastDay > day));
        }
    }

    private static int Compare(Work a, Work b)
    {
        var c = a.StartColumn.CompareTo(b.StartColumn);
        if (c != 0) return c;
        if (a.Style != b.Style) return a.Style == MonthItemStyle.Bar ? -1 : 1;
        return a.Source.Order.CompareTo(b.Source.Order);
    }

    /// <summary>Sorts the items and gives each the lowest lane free in all of its columns. Returns the number of lanes used.</summary>
    public static int Assign(List<Work> items, int columnCount)
    {
        Ev.StableSort(items, Compare);
        var used = Enumerable.Range(0, columnCount).Select(_ => new List<bool>()).ToArray();
        var firstFree = new int[columnCount];
        bool IsUsed(int column, int lane) => lane < used[column].Count && used[column][lane];
        var laneCount = 0;
        foreach (var item in items)
        {
            var lane = 0;
            for (var c = item.StartColumn; c <= item.EndColumn; c++) lane = Math.Max(lane, firstFree[c]);
            for (; ; lane++)
            {
                var free = true;
                for (var c = item.StartColumn; c <= item.EndColumn && free; c++) free = !IsUsed(c, lane);
                if (free) break;
            }
            item.Lane = lane;
            for (var c = item.StartColumn; c <= item.EndColumn; c++)
            {
                var column = used[c];
                while (column.Count <= lane) column.Add(false);
                column[lane] = true;
                while (IsUsed(c, firstFree[c])) firstFree[c]++;
            }
            laneCount = Math.Max(laneCount, lane + 1);
        }
        return laneCount;
    }

    /// <summary>§5.3 Month step 3: visible lanes and hidden counts per column.</summary>
    public static (int[] VisibleLanes, int[] Hidden) Visibility(List<Work> items, int columnCount, int laneCount, int? maxLanes)
    {
        if (maxLanes is not { } max) return (Enumerable.Repeat(laneCount, columnCount).ToArray(), new int[columnCount]);
        var highest = Enumerable.Repeat(-1, columnCount).ToArray();
        var atOrBeyondLast = new int[columnCount];
        foreach (var item in items)
        {
            for (var c = item.StartColumn; c <= item.EndColumn; c++)
            {
                if (item.Lane > highest[c]) highest[c] = item.Lane;
                if (item.Lane >= max - 1) atOrBeyondLast[c]++;
            }
        }
        var visible = new int[columnCount];
        var hidden = new int[columnCount];
        for (var c = 0; c < columnCount; c++)
        {
            var fits = highest[c] < max;
            visible[c] = fits ? max : max - 1;
            hidden[c] = fits ? 0 : atOrBeyondLast[c];
        }
        return (visible, hidden);
    }
}

/// <summary>The Week and Day timelines (§5.3 steps 4 and 5).</summary>
internal static class Timeline
{
    internal sealed class Work
    {
        public required Prepared Source { get; init; }
        public required int Column { get; init; }
        public required int StartMinute { get; init; }
        public required int EndMinute { get; init; }
        public required int EffectiveEnd { get; init; }
        public required bool ClippedStart { get; init; }
        public required bool ClippedEnd { get; init; }
        public int Slot { get; set; }
        public int SlotCount { get; set; } = 1;
        public bool Hidden { get; set; }
    }

    /// <summary>The part of a dot occurrence on a day, if it touches it.</summary>
    public static Work? Part(Prepared p, long day, int column, int minDuration)
    {
        if (p.Bar || p.LastDay < day || p.FirstDay > day) return null;
        var dayStart = day * Ev.Day;
        var startMinute = (int)(Math.Max(p.Start, dayStart) - dayStart);
        var endMinute = (int)(Math.Min(p.End, dayStart + Ev.Day) - dayStart);
        return new Work
        {
            Source = p,
            Column = column,
            StartMinute = startMinute,
            EndMinute = endMinute,
            EffectiveEnd = Math.Max(endMinute, startMinute + minDuration),
            ClippedStart = p.Start < dayStart,
            ClippedEnd = p.End > dayStart + Ev.Day,
        };
    }

    private static int Compare(Work a, Work b)
    {
        var c = a.StartMinute.CompareTo(b.StartMinute);
        if (c != 0) return c;
        c = (b.EndMinute - b.StartMinute).CompareTo(a.EndMinute - a.StartMinute);
        return c != 0 ? c : a.Source.Order.CompareTo(b.Source.Order);
    }

    /// <summary>Sorts one column's items, groups them in overlap clusters, gives each a slot, and hides what does not fit.</summary>
    public static void LayoutColumn(List<Work> items, int? maxSlots, List<TimedItem> timed, List<TimedOverflow> overflow)
    {
        Ev.StableSort(items, Compare);
        var cluster = new List<Work>();
        var slotEnds = new List<int>();
        var clusterEnd = 0;

        void Flush()
        {
            if (cluster.Count == 0) return;
            var slotCount = slotEnds.Count;
            var overflows = maxSlots is { } m && slotCount > m;
            var hiddenItems = new List<Work>();
            foreach (var item in cluster)
            {
                item.SlotCount = slotCount;
                if (overflows && item.Slot > maxSlots!.Value - 2)
                {
                    item.Hidden = true;
                    hiddenItems.Add(item);
                }
                else if (overflows)
                {
                    item.SlotCount = maxSlots!.Value;
                }
                timed.Add(new TimedItem(item.Source.Key, item.Column, item.StartMinute, item.EndMinute, item.ClippedStart, item.ClippedEnd, item.Slot, item.SlotCount, item.Hidden));
            }
            if (overflows)
            {
                Ev.StableSort(hiddenItems, (a, b) => a.Source.Order.CompareTo(b.Source.Order));
                overflow.Add(new TimedOverflow(
                    cluster[0].Column,
                    maxSlots!.Value - 1,
                    maxSlots.Value,
                    hiddenItems.Min(i => i.StartMinute),
                    hiddenItems.Max(i => i.EffectiveEnd),
                    hiddenItems.Select(i => i.Source.Key).ToValueList()));
            }
            cluster = [];
            slotEnds = [];
        }

        foreach (var item in items)
        {
            if (cluster.Count > 0 && item.StartMinute >= clusterEnd) Flush();
            var slot = slotEnds.FindIndex(end => end <= item.StartMinute);
            if (slot < 0)
            {
                slot = slotEnds.Count;
                slotEnds.Add(item.EffectiveEnd);
            }
            else
            {
                slotEnds[slot] = item.EffectiveEnd;
            }
            item.Slot = slot;
            clusterEnd = cluster.Count == 0 ? item.EffectiveEnd : Math.Max(clusterEnd, item.EffectiveEnd);
            cluster.Add(item);
        }
        Flush();
    }

    public static void ValidateOptions(int minDurationMinutes, int? maxSlots, string context)
    {
        if (minDurationMinutes is < 0 or > Ev.Day) throw Ev.Fail($"{context} option 'minDurationMinutes' must be an integer 0..1440, got {minDurationMinutes.Inv()}");
        if (maxSlots is < 1) throw Ev.Fail($"{context} option 'maxSlots' must be an integer 1 or more, got {maxSlots.Value.Inv()}");
    }
}

/// <summary>
/// A 13-month month with its occurrences in lanes (§2.4, §5.3 "Month lanes"): bars become one item per week
/// row (and intercalary band) they touch, shorter timed occurrences a dot on each day they touch; each row
/// sorts by clipped start column, bars before dots, then the order key, and gives each item the lowest lane
/// free in all of its columns; with <c>maxLanes</c>, a full column shows <c>maxLanes - 1</c> lanes and reports the
/// rest in <c>Hidden</c> (default: unlimited). TS: <c>layoutThirteenMonthEvents</c>, <c>ThirteenMonthEventLayout</c>.
/// </summary>
public sealed class ThirteenMonthEventLayout
{
    /// <summary>Lays out <paramref name="occurrences"/> (device wall clock) on 13-month month <paramref name="month"/> of Gregorian year <paramref name="year"/>.</summary>
    /// <exception cref="ThirteenException">
    /// For an invalid year, month or system, and <see cref="ThirteenErrorKind.InvalidEvent"/> for an invalid
    /// occurrence, a repeated key or <paramref name="maxLanes"/> below 1.
    /// </exception>
    public ThirteenMonthEventLayout(int year, int month, IEnumerable<EventOccurrence> occurrences, CalendarSystemId system = CalendarSystemId.Ifc, int? maxLanes = null)
    {
        const string context = "layoutThirteenMonthEvents";
        _ = system.Definition();
        var days = ThirteenMonthDate.MonthDays(year, month, system);
        if (maxLanes is < 1) throw Ev.Fail($"{context} option 'maxLanes' must be an integer 1 or more, got {maxLanes.Value.Inv()}");
        var prepared = Prepared.All(occurrences, context);
        long firstDay = days[0].JulianDayNumber;

        var weeks = new List<MonthWeekRow>();
        for (var w = 0; w < ThirteenDate.WeeksPerMonth; w++)
        {
            var rowFirst = firstDay + w * ThirteenDate.DaysPerWeek;
            var work = new List<Lanes.Work>();
            foreach (var p in prepared) Lanes.Collect(p, rowFirst, rowFirst + ThirteenDate.DaysPerWeek - 1, true, work);
            var laneCount = Lanes.Assign(work, ThirteenDate.DaysPerWeek);
            var (visible, hidden) = Lanes.Visibility(work, ThirteenDate.DaysPerWeek, laneCount, maxLanes);
            weeks.Add(new MonthWeekRow(w + 1, work.Select(x => x.ToItem()).ToValueList(), visible, hidden));
        }

        var bands = new List<IntercalaryBand>();
        foreach (var occurrence in IntercalaryOccurrence.InYear(year, system))
        {
            if (occurrence.AfterMonth != month) continue;
            long day = occurrence.Gregorian.JulianDayNumber;
            var work = new List<Lanes.Work>();
            foreach (var p in prepared) Lanes.Collect(p, day, day, true, work);
            var laneCount = Lanes.Assign(work, 1);
            var (visible, hidden) = Lanes.Visibility(work, 1, laneCount, maxLanes);
            bands.Add(new IntercalaryBand(occurrence.Id, occurrence.Gregorian, work.Select(x => x.ToItem()).ToValueList(), visible[0], hidden[0]));
        }

        Year = year;
        Month = month;
        System = system;
        ColumnGregorianWeekdays = days.Take(ThirteenDate.DaysPerWeek).Select(d => d.Weekday).ToValueList();
        Weeks = weeks;
        Intercalary = bands;
    }

    /// <summary>Gregorian year.</summary>
    public int Year { get; }

    /// <summary>13-month month, 1..13.</summary>
    public int Month { get; }

    /// <summary>The system.</summary>
    public CalendarSystemId System { get; }

    /// <summary>The Gregorian weekday of each column this month (7 entries, §2.4 header line 2).</summary>
    public ValueList<Weekday> ColumnGregorianWeekdays { get; }

    /// <summary>Exactly 4 rows.</summary>
    public ValueList<MonthWeekRow> Weeks { get; }

    /// <summary>The intercalary days that follow this month, in chronological order (0, 1 or 2).</summary>
    public ValueList<IntercalaryBand> Intercalary { get; }
}

/// <summary>The Month header's Gregorian weekdays. TS: <c>monthColumnGregorianWeekdays</c>.</summary>
public static class MonthColumns
{
    /// <summary>
    /// The Gregorian weekday of each column of 13-month month <paramref name="month"/> of Gregorian year
    /// <paramref name="year"/> (7 entries, column 0 first). IFC October 2026: Thursday to Wednesday.
    /// </summary>
    public static IReadOnlyList<Weekday> GregorianWeekdays(int year, int month, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        _ = system.Definition();
        return ThirteenMonthDate.MonthDays(year, month, system).Take(ThirteenDate.DaysPerWeek).Select(d => d.Weekday).ToList();
    }
}

/// <summary>
/// A 13-month week with its all-day row and timeline (§2.5, §5.3 "Week and day timeline"): the week's 7 days
/// plus, for week 4, the intercalary days that follow the month; bars in lanes over the columns (no lane
/// limit); every shorter timed occurrence clipped to each day it touches, in overlap clusters with slots
/// (effective end = max(end, start + <c>minDurationMinutes</c>)); with <c>maxSlots</c>, a crowded cluster keeps slots
/// 0..maxSlots-2 visible and adds one <see cref="TimedOverflow"/>. TS: <c>layoutThirteenWeekEvents</c>, <c>WeekEventLayout</c>.
/// </summary>
public sealed class WeekEventLayout
{
    /// <summary>Lays out week <paramref name="week"/> (1..4) of 13-month month <paramref name="month"/> of Gregorian year <paramref name="year"/>.</summary>
    /// <exception cref="ThirteenException">
    /// For an invalid year, month or system, and <see cref="ThirteenErrorKind.InvalidEvent"/> for a week outside 1..4,
    /// an invalid occurrence, a repeated key or invalid options.
    /// </exception>
    public WeekEventLayout(int year, int month, int week, IEnumerable<EventOccurrence> occurrences, CalendarSystemId system = CalendarSystemId.Ifc, int minDurationMinutes = 15, int? maxSlots = null)
    {
        const string context = "layoutThirteenWeekEvents";
        _ = system.Definition();
        var days = ThirteenMonthDate.MonthDays(year, month, system);
        if (week is < 1 or > ThirteenDate.WeeksPerMonth) throw Ev.Fail($"{context}: week must be 1, 2, 3 or 4, got {week.Inv()}");
        Timeline.ValidateOptions(minDurationMinutes, maxSlots, context);
        var prepared = Prepared.All(occurrences, context);

        var columns = new List<WeekColumn>();
        for (var d = 0; d < ThirteenDate.DaysPerWeek; d++)
        {
            var day = (week - 1) * ThirteenDate.DaysPerWeek + d + 1;
            columns.Add(new WeekColumn(days[day - 1], new ThirteenMonthDate(system, year, month, day, true)));
        }
        if (week == ThirteenDate.WeeksPerMonth)
        {
            foreach (var occurrence in IntercalaryOccurrence.InYear(year, system))
            {
                if (occurrence.AfterMonth == month) columns.Add(new WeekColumn(occurrence.Gregorian, occurrence.Thirteen));
            }
        }
        // The columns are consecutive days: day 28 of a month is followed by its intercalary days.
        long first = columns[0].Gregorian.JulianDayNumber;
        var last = first + columns.Count - 1;

        var bars = new List<Lanes.Work>();
        foreach (var p in prepared) Lanes.Collect(p, first, last, false, bars);
        Lanes.Assign(bars, columns.Count);

        var timed = new List<TimedItem>();
        var overflow = new List<TimedOverflow>();
        for (var c = 0; c < columns.Count; c++)
        {
            var items = new List<Timeline.Work>();
            foreach (var p in prepared)
            {
                if (Timeline.Part(p, first + c, c, minDurationMinutes) is { } part) items.Add(part);
            }
            Timeline.LayoutColumn(items, maxSlots, timed, overflow);
        }
        Columns = columns;
        AllDay = bars.Select(b => b.ToItem()).ToValueList();
        Timed = timed;
        Overflow = overflow;
    }

    /// <summary>The week's 7 days, plus the intercalary days that follow week 4 of the month.</summary>
    public ValueList<WeekColumn> Columns { get; }

    /// <summary>Bars over the columns, in lanes (one row for the whole week).</summary>
    public ValueList<MonthItem> AllDay { get; }

    /// <summary>By column, then in the column's sort order.</summary>
    public ValueList<TimedItem> Timed { get; }

    /// <summary>By column, then in time order.</summary>
    public ValueList<TimedOverflow> Overflow { get; }
}

/// <summary>
/// One day for Day mode (§2.6, §5.3): <see cref="AllDay"/> lists the keys of the bars that touch the date in
/// order-key order; <see cref="Timed"/> and <see cref="Overflow"/> are the timeline of
/// <see cref="WeekEventLayout"/> with a single column (column 0). TS: <c>layoutDayEvents</c>.
/// </summary>
public sealed class DayEventLayout
{
    /// <summary>Lays out <paramref name="occurrences"/> on <paramref name="date"/>.</summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for an invalid occurrence, a repeated key or invalid options.</exception>
    public DayEventLayout(GregorianDate date, IEnumerable<EventOccurrence> occurrences, int minDurationMinutes = 15, int? maxSlots = null)
    {
        const string context = "layoutDayEvents";
        Timeline.ValidateOptions(minDurationMinutes, maxSlots, context);
        var prepared = Prepared.All(occurrences, context);
        long day = date.JulianDayNumber;
        var allDay = new List<string>();
        var items = new List<Timeline.Work>();
        foreach (var p in prepared)
        {
            if (p.LastDay < day || p.FirstDay > day) continue;
            if (p.Bar) allDay.Add(p.Key);
            else items.Add(Timeline.Part(p, day, 0, minDurationMinutes)!);
        }
        var timed = new List<TimedItem>();
        var overflow = new List<TimedOverflow>();
        Timeline.LayoutColumn(items, maxSlots, timed, overflow);
        AllDay = allDay;
        Timed = timed;
        Overflow = overflow;
    }

    /// <summary>Keys of the bars that touch the date, in order-key order.</summary>
    public ValueList<string> AllDay { get; }

    /// <summary>The timeline items.</summary>
    public ValueList<TimedItem> Timed { get; }

    /// <summary>The overflow blocks.</summary>
    public ValueList<TimedOverflow> Overflow { get; }
}

/// <summary>Month chip time (§2.19). TS: <c>formatChipTime</c>.</summary>
public static class ChipTime
{
    /// <summary>
    /// 24-hour <c>HH:MM</c> (<c>09:30</c>); 12-hour the hour without a leading zero, <c>:MM</c> only when the
    /// minutes are not 0, then <c>a</c> or <c>p</c> (<c>9:30a</c>, <c>2p</c>; noon <c>12p</c>, midnight <c>12a</c>).
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for a minute outside 0..1439.</exception>
    public static string Text(int minute, bool use24Hour)
    {
        if (minute is < 0 or >= Ev.Day) throw Ev.Fail($"Chip time minute must be an integer 0..1439, got {minute.Inv()}");
        var hour = minute / 60;
        var minutes = minute % 60;
        if (use24Hour) return $"{Ev.Pad(hour, 2)}:{Ev.Pad(minutes, 2)}";
        var clockHour = hour % 12 == 0 ? 12 : hour % 12;
        return $"{clockHour.Inv()}{(minutes == 0 ? "" : $":{Ev.Pad(minutes, 2)}")}{(hour < 12 ? "a" : "p")}";
    }
}

/// <summary>One day of the agenda (List mode, Up next, Month at accessibility sizes). TS: <c>AgendaDay</c>, <c>agenda</c>.</summary>
/// <param name="Gregorian">The date.</param>
/// <param name="Thirteen">The date in the selected system.</param>
/// <param name="Items">All-day items and middle parts (order key), then by start minute, then the order key.</param>
public sealed record AgendaDay(GregorianDate Gregorian, ThirteenDate Thirteen, ValueList<AgendaItem> Items)
{
    private sealed record Work(AgendaItem Item, int Order, int Group);

    private static Work Part(Prepared p, long day)
    {
        var dayCount = (int)(p.LastDay - p.FirstDay + 1);
        var dayIndex = (int)(day - p.FirstDay + 1);
        var part = dayCount == 1 ? AgendaPart.Single : dayIndex == 1 ? AgendaPart.First : dayIndex == dayCount ? AgendaPart.Last : AgendaPart.Middle;
        if (p.AllDay || part == AgendaPart.Middle) return new Work(new AgendaItem(p.Key, part, dayIndex, dayCount, null, null), p.Order, 0);
        var dayStart = day * Ev.Day;
        var startMinute = (int)(Math.Max(p.Start, dayStart) - dayStart);
        var endMinute = (int)(Math.Min(p.End, dayStart + Ev.Day) - dayStart);
        return new Work(new AgendaItem(p.Key, part, dayIndex, dayCount, startMinute, endMinute), p.Order, 1);
    }

    private static int Compare(Work a, Work b)
    {
        var c = a.Group.CompareTo(b.Group);
        if (c != 0) return c;
        if (a.Group == 1)
        {
            c = a.Item.StartMinute!.Value.CompareTo(b.Item.StartMinute!.Value);
            if (c != 0) return c;
        }
        return a.Order.CompareTo(b.Order);
    }

    /// <summary>
    /// The agenda from <paramref name="from"/> to <paramref name="to"/> (inclusive) (§2.4, §2.7, §2.8, §5.3
    /// "Agenda"): one day per date that has items (every date with <paramref name="includeEmptyDays"/>). Each
    /// occurrence appears on every day it touches as a single, first, middle or last part.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for <paramref name="to"/> before <paramref name="from"/>, an invalid occurrence or a repeated key.</exception>
    public static IReadOnlyList<AgendaDay> Days(IEnumerable<EventOccurrence> occurrences, GregorianDate from, GregorianDate to, CalendarSystemId system = CalendarSystemId.Ifc, bool includeEmptyDays = false)
    {
        const string context = "agenda";
        _ = system.Definition();
        long first = from.JulianDayNumber;
        long last = to.JulianDayNumber;
        if (last < first) throw Ev.Fail($"{context}: to ({to}) is before from ({from})");
        var prepared = Prepared.All(occurrences, context);
        var byDay = new Dictionary<long, List<Work>>();
        foreach (var p in prepared)
        {
            var end = Math.Min(p.LastDay, last);
            for (var day = Math.Max(p.FirstDay, first); day <= end; day++)
            {
                if (!byDay.TryGetValue(day, out var list)) byDay[day] = list = [];
                list.Add(Part(p, day));
            }
        }
        var dayNumbers = includeEmptyDays ? Enumerable.Range(0, (int)(last - first + 1)).Select(i => first + i) : byDay.Keys.Order();
        return dayNumbers.Select(day =>
        {
            var gregorian = Ev.DateOf(day);
            var items = byDay.TryGetValue(day, out var list) ? list : [];
            Ev.StableSort(items, Compare);
            return new AgendaDay(gregorian, ThirteenDate.FromGregorian(gregorian, system), items.Select(w => w.Item).ToValueList());
        }).ToList();
    }
}

/// <summary>A day of the Gregorian year with events, for Year mode dots and the compact Month dots. TS: <c>YearMark</c>, <c>yearEventMarks</c>.</summary>
/// <param name="DayOfYear">1..366.</param>
/// <param name="Gregorian">The date.</param>
/// <param name="Count">Occurrences covering the day.</param>
/// <param name="CalendarIds">Distinct calendar ids of those occurrences in order-key order, at most maxCalendars.</param>
public sealed record YearMark(int DayOfYear, GregorianDate Gregorian, int Count, ValueList<string> CalendarIds)
{
    /// <summary>
    /// Event marks for Gregorian year <paramref name="year"/> (§2.3, §5.3 "Year marks"): for each day covered
    /// by at least one occurrence, ascending, the number of occurrences and up to <paramref name="maxCalendars"/>
    /// distinct calendar ids in order-key order (0 gives counts only).
    /// </summary>
    /// <exception cref="ThirteenException">For an invalid year, and <see cref="ThirteenErrorKind.InvalidEvent"/> for an invalid occurrence, a repeated key or a negative <paramref name="maxCalendars"/>.</exception>
    public static IReadOnlyList<YearMark> Marks(int year, IEnumerable<EventOccurrence> occurrences, int maxCalendars = 3)
    {
        const string context = "yearEventMarks";
        GregorianDate.ValidateYear(year);
        if (maxCalendars < 0) throw Ev.Fail($"{context} option 'maxCalendars' must be an integer 0 or more, got {maxCalendars.Inv()}");
        var prepared = Prepared.All(occurrences, context);
        long first = new GregorianDate(year, 1, 1).JulianDayNumber;
        long last = new GregorianDate(year, 12, 31).JulianDayNumber;
        var counts = new int[last - first + 1];
        var calendars = Enumerable.Range(0, counts.Length).Select(_ => new List<string>()).ToArray();
        foreach (var p in prepared)
        {
            var end = Math.Min(p.LastDay, last);
            for (var day = Math.Max(p.FirstDay, first); day <= end; day++)
            {
                var index = (int)(day - first);
                counts[index]++;
                var ids = calendars[index];
                if (ids.Count < maxCalendars && !ids.Contains(p.CalendarId)) ids.Add(p.CalendarId);
            }
        }
        var marks = new List<YearMark>();
        for (var index = 0; index < counts.Length; index++)
        {
            if (counts[index] == 0) continue;
            marks.Add(new YearMark(index + 1, Ev.DateOf(first + index), counts[index], calendars[index]));
        }
        return marks;
    }
}
