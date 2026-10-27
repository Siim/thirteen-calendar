using System.Globalization;
using System.Windows.Input;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

// Read-only presentation models shared by several screens. Each is built from engine values in one go
// (a screen swaps in a new instance when its inputs change); only selection and the Gregorian overlay
// are observable, so a whole year of cells does not have to be rebuilt for them.

/// <summary>A day cell that arrow keys can move between (see Views/DayNavigation.cs).</summary>
public interface INavigableDay
{
    /// <summary>Position on a 7-column grid (up and down move by 7), or -1 when the cell is outside the grid.</summary>
    int NavIndex { get; }

    /// <summary>Chronological order (left and right move to the previous or next value).</summary>
    int NavOrder { get; }

    /// <summary>Today (where Tab enters a grid when no day is selected).</summary>
    bool IsToday { get; }

    /// <summary>The selected day (where Tab enters a grid).</summary>
    bool IsSelected { get; }
}

/// <summary>A day that can carry event dots and an event count (Calendar's Year mode, docs/EVENTS.md §2.3).</summary>
public interface IEventMarked
{
    /// <summary>The Gregorian day.</summary>
    GregorianDate Date { get; }

    /// <summary>
    /// Sets the day's events: <paramref name="showsRow"/> reserves the row the dots sit in (every day of a year with
    /// events shown, so the cells do not jump), <paramref name="colors"/> are up to three calendar colors, and
    /// <paramref name="count"/> the occurrences covering the day.
    /// </summary>
    void SetEvents(bool showsRow, IReadOnlyList<Avalonia.Media.Color> colors, int count);
}

/// <summary>
/// A date set like an almanac plate (Apple <c>DatePlate</c>): the fixed weekday as an eyebrow, a big day
/// numeral with month and year, and the other calendar's reading of the same day underneath. Normally the
/// 13-month date is primary; the converter flips it to show a Gregorian result.
/// </summary>
public sealed class DatePlateModel
{
    private DatePlateModel()
    {
    }

    /// <summary>"THURSDAY · MONTH 11 OF 13", "NO WEEKDAY · AFTER DECEMBER 28", "MONDAY · GREGORIAN".</summary>
    public string Eyebrow { get; private init; } = "";

    /// <summary>The eyebrow is in the foil colour (Gregorian primary) rather than the accent.</summary>
    public bool EyebrowIsFoil { get; private init; }

    /// <summary>A numeral face (a month date, or any Gregorian primary) rather than an intercalary name.</summary>
    public bool IsNumeral { get; private init; }

    /// <summary>The big day number.</summary>
    public string Numeral { get; private init; } = "";

    /// <summary>"October", "Sol", "Descartes".</summary>
    public string Month { get; private init; } = "";

    /// <summary>The display year: "2026", "238".</summary>
    public string Year { get; private init; } = "";

    /// <summary>"Gregorian 2026" under a Positivist year, else null.</summary>
    public string? YearNote { get; private init; }

    /// <summary>Whether <see cref="YearNote"/> is shown.</summary>
    public bool HasYearNote => YearNote is not null;

    /// <summary>"Year Day", "Festival of All the Dead" (intercalary face).</summary>
    public string IntercalaryName { get; private init; } = "";

    /// <summary>"GREGORIAN" or the system's short name.</summary>
    public string SecondaryTitle { get; private init; } = "";

    /// <summary>The secondary line is the Gregorian reading (foil) rather than the 13-month one (accent).</summary>
    public bool SecondaryIsFoil { get; private init; }

    /// <summary>"Monday, October 19, 2026".</summary>
    public string SecondaryText { get; private init; } = "";

    /// <summary>What a screen reader reads for the whole plate.</summary>
    public string AutomationName { get; private init; } = "";

    /// <summary>The plate for <paramref name="comparison"/>.</summary>
    public static DatePlateModel Create(Comparison comparison, bool gregorianPrimary = false)
    {
        var thirteen = comparison.Thirteen;
        var gregorian = comparison.Gregorian;
        var system = thirteen.System;
        const string Nbsp = " ";
        var withWeekday = new FormatOptions(DateStyle.Long, IncludeWeekday: true);

        if (gregorianPrimary)
        {
            var secondary = thirteen.IsIntercalary
                ? $"{thirteen.Format(FormatOptions.Long)} (no weekday)"
                : thirteen.Format(withWeekday);
            return new DatePlateModel
            {
                Eyebrow = $"{gregorian.Weekday.Name()}{Nbsp}· Gregorian".ToUpperInvariant(),
                EyebrowIsFoil = true,
                IsNumeral = true,
                Numeral = gregorian.Day.ToString(CultureInfo.InvariantCulture),
                Month = gregorian.MonthInfo.Name,
                Year = gregorian.Year.ToString(CultureInfo.InvariantCulture),
                SecondaryTitle = system.ShortName().ToUpperInvariant(),
                SecondaryIsFoil = false,
                SecondaryText = secondary,
                AutomationName = $"Gregorian {gregorian.Format(withWeekday)}. {system.ShortName()}: {thirteen.Format(withWeekday)}",
            };
        }

        var note = Phrasing.GregorianYearNote(gregorian.Year, system);
        var common = new DatePlateModel
        {
            SecondaryTitle = "GREGORIAN",
            SecondaryIsFoil = true,
            SecondaryText = gregorian.Format(withWeekday),
            AutomationName = Phrasing.BothDates(thirteen, gregorian),
            YearNote = note,
            Year = thirteen.DisplayYear.ToString(CultureInfo.InvariantCulture),
        };
        return thirteen switch
        {
            ThirteenMonthDate date => new DatePlateModel
            {
                Eyebrow = $"{date.Weekday.Name()}{Nbsp}· Month{Nbsp}{date.Month.ToString(CultureInfo.InvariantCulture)}{Nbsp}of{Nbsp}13".ToUpperInvariant(),
                IsNumeral = true,
                Numeral = date.Day.ToString(CultureInfo.InvariantCulture),
                Month = date.MonthInfo.Name,
                Year = common.Year,
                YearNote = note,
                SecondaryTitle = common.SecondaryTitle,
                SecondaryIsFoil = true,
                SecondaryText = common.SecondaryText,
                AutomationName = common.AutomationName,
            },
            ThirteenIntercalaryDate date => new DatePlateModel
            {
                Eyebrow = $"No weekday{Nbsp}· after {system.Months()[date.Info.AfterMonth - 1].Name}{Nbsp}28".ToUpperInvariant(),
                IsNumeral = false,
                IntercalaryName = date.Info.Name,
                Year = common.Year,
                YearNote = note,
                SecondaryTitle = common.SecondaryTitle,
                SecondaryIsFoil = true,
                SecondaryText = common.SecondaryText,
                AutomationName = common.AutomationName,
            },
            _ => common,
        };
    }
}

/// <summary>One weekday chip of a 7-day strip.</summary>
/// <param name="Text">"SU", "MO", ...</param>
/// <param name="IsMarked">The day's weekday.</param>
public sealed record WeekdayChip(string Text, bool IsMarked);

/// <summary>
/// Fixed vs real weekday (Apple <c>WeekdayShiftView</c>): two 7-day strips, 13-month above and Gregorian
/// below, each with its weekday marked, plus the shift in plain language.
/// </summary>
public sealed class WeekdayShiftModel
{
    /// <summary>Builds the strips for a comparison.</summary>
    public WeekdayShiftModel(Comparison comparison)
    {
        var system = comparison.Thirteen.System;
        var order = Weekdays.Ordered(system.WeekStartsOn());
        SystemLabel = system.ShortName().ToUpperInvariant();
        ThirteenChips = order.Select(w => new WeekdayChip(Chip(w), w == comparison.ThirteenWeekday)).ToArray();
        GregorianChips = order.Select(w => new WeekdayChip(Chip(w), w == comparison.GregorianWeekday)).ToArray();
        Sentence = Phrasing.WeekdayShift(comparison);
        AutomationName = $"{system.ShortName()} weekday: {comparison.ThirteenWeekday?.Name() ?? "none"}. Gregorian weekday: {comparison.GregorianWeekday.Name()}. {Sentence}";
    }

    private static string Chip(Weekday weekday) => weekday.Name(NameStyle.Short)[..2].ToUpperInvariant();

    /// <summary>"IFC", "POSITIVIST".</summary>
    public string SystemLabel { get; }

    /// <summary>The 13-month strip.</summary>
    public IReadOnlyList<WeekdayChip> ThirteenChips { get; }

    /// <summary>The Gregorian strip.</summary>
    public IReadOnlyList<WeekdayChip> GregorianChips { get; }

    /// <summary><see cref="Phrasing.WeekdayShift"/>.</summary>
    public string Sentence { get; }

    /// <summary>Both strips and the sentence, for screen readers.</summary>
    public string AutomationName { get; }
}

/// <summary>
/// One day of a month grid: a 13-month cell (13-month day large, Gregorian date small) or a Gregorian
/// cell (Gregorian day large, 13-month date small), or a blank before day 1 of a Gregorian month.
/// </summary>
public sealed class DayCellViewModel : ViewModelBase, INavigableDay, IEventMarked
{
    private bool _isSelected;
    private bool _showsSub = true;
    private bool _showsEventRow;
    private IReadOnlyList<Avalonia.Media.Color> _eventColors = [];
    private string? _eventStatus;

    private DayCellViewModel()
    {
    }

    /// <summary>The Gregorian day the cell stands for (default for blanks).</summary>
    public GregorianDate Date { get; private init; }

    /// <summary>The big number.</summary>
    public string Number { get; private init; } = "";

    /// <summary>The other calendar's date in small type ("19", "Nov", "YD").</summary>
    public string Sub { get; private init; } = "";

    /// <summary>A blank cell before day 1 of a Gregorian month.</summary>
    public bool IsBlank { get; private init; }

    /// <summary>A Gregorian-month cell (colours swap: 13-month marks in the accent).</summary>
    public bool IsGregorianCell { get; private init; }

    /// <summary>Today.</summary>
    public bool IsToday { get; private init; }

    /// <summary>
    /// A red-letter day, as in the Apple and web grids: the big number is a Sunday of the cell's own calendar
    /// (its numeral in the accent text colour, bold in Mono).
    /// </summary>
    public bool IsSunday { get; private init; }

    /// <summary>A month of the other calendar begins here (bar on the leading edge).</summary>
    public bool IsMonthStart { get; private init; }

    /// <summary>The small text is bold (a month start or an intercalary code).</summary>
    public bool IsSubStrong { get; private init; }

    /// <summary>An intercalary day in a Gregorian grid (dashed outline).</summary>
    public bool IsIntercalary { get; private init; }

    /// <summary>What a screen reader reads.</summary>
    public string AutomationName { get; private init; } = "";

    /// <summary>Opens or picks the day; null for blanks and display-only grids.</summary>
    public ICommand? Command { get; private init; }

    /// <inheritdoc />
    public int NavIndex { get; private init; } = -1;

    /// <inheritdoc />
    public int NavOrder { get; private init; }

    /// <summary>The selected day (accent outline).</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    /// <summary>Whether the small date is shown (the Year screen's Gregorian overlay).</summary>
    public bool ShowsSub
    {
        get => _showsSub;
        set => SetProperty(ref _showsSub, value);
    }

    /// <summary>Whether the row of event dots is drawn (Year mode with events shown).</summary>
    public bool ShowsEventRow
    {
        get => _showsEventRow;
        private set => SetProperty(ref _showsEventRow, value);
    }

    /// <summary>Up to three calendar colors of the day's events (Year mode, §2.3).</summary>
    public IReadOnlyList<Avalonia.Media.Color> EventColors
    {
        get => _eventColors;
        private set => SetProperty(ref _eventColors, value);
    }

    /// <summary>The cell's value for screen readers, <c>year.cell.events</c> ("3 events"), or null on a day without events.</summary>
    public string? EventStatus
    {
        get => _eventStatus;
        private set => SetProperty(ref _eventStatus, value);
    }

    /// <inheritdoc />
    public void SetEvents(bool showsRow, IReadOnlyList<Avalonia.Media.Color> colors, int count)
    {
        ShowsEventRow = showsRow && !IsBlank;
        EventColors = colors;
        EventStatus = count > 0 ? CalendarStrings.YearCellEvents(count) : null;
    }

    /// <summary>A 13-month grid cell.</summary>
    public static DayCellViewModel ForThirteen(DayCell cell, GregorianDate? today, Action<GregorianDate>? select)
    {
        var label = Phrasing.BothDates(cell.Thirteen, cell.Gregorian);
        if (cell.IsGregorianMonthStart) label += $". Gregorian {cell.Gregorian.MonthInfo.Name} begins";
        if (cell.Gregorian == today) label += ". Today";
        return new DayCellViewModel
        {
            Date = cell.Gregorian,
            Number = cell.Thirteen.Day.ToString(CultureInfo.InvariantCulture),
            Sub = cell.IsGregorianMonthStart ? cell.Gregorian.MonthInfo.ShortName : cell.Gregorian.Day.ToString(CultureInfo.InvariantCulture),
            IsToday = cell.Gregorian == today,
            IsSunday = cell.ThirteenWeekday == Weekday.Sunday,
            IsMonthStart = cell.IsGregorianMonthStart,
            IsSubStrong = cell.IsGregorianMonthStart,
            AutomationName = label,
            Command = select is null ? null : new RelayCommand(() => select(cell.Gregorian)),
            NavIndex = (cell.Thirteen.Month - 1) * ThirteenDate.DaysPerMonth + cell.Thirteen.Day - 1,
            NavOrder = cell.DayOfYear,
        };
    }

    /// <summary>A Gregorian grid cell.</summary>
    public static DayCellViewModel ForGregorian(GregorianDayCell cell, GregorianDate? today, Action<GregorianDate>? select)
    {
        var label = Phrasing.BothDates(cell.Gregorian, cell.Thirteen);
        if (cell.IsThirteenMonthStart && cell.Thirteen.MonthDate is { } month)
        {
            label += $". {month.System.ShortName()} {month.MonthInfo.Name} begins";
        }
        if (cell.Gregorian == today) label += ". Today";
        var sub = cell.Thirteen switch
        {
            ThirteenIntercalaryDate date => date.Info.Code,
            ThirteenMonthDate date => cell.IsThirteenMonthStart ? date.MonthInfo.ShortName : date.Day.ToString(CultureInfo.InvariantCulture),
            _ => "",
        };
        return new DayCellViewModel
        {
            Date = cell.Gregorian,
            Number = cell.Gregorian.Day.ToString(CultureInfo.InvariantCulture),
            Sub = sub,
            IsGregorianCell = true,
            IsToday = cell.Gregorian == today,
            IsSunday = cell.GregorianWeekday == Weekday.Sunday,
            IsMonthStart = cell.IsThirteenMonthStart,
            IsSubStrong = cell.IsThirteenMonthStart || cell.Thirteen.IsIntercalary,
            IsIntercalary = cell.Thirteen.IsIntercalary,
            AutomationName = label,
            Command = select is null ? null : new RelayCommand(() => select(cell.Gregorian)),
            NavIndex = cell.Gregorian.Day - 1,
            NavOrder = cell.DayOfYear,
        };
    }

    /// <summary>A blank before day 1.</summary>
    public static DayCellViewModel Blank() => new() { IsBlank = true, ShowsSub = false };
}

/// <summary>A month as a grid: weekday headers and day cells, row by row, 7 to a row.</summary>
public sealed class MonthGridModel
{
    private MonthGridModel(IReadOnlyList<string> weekdays, IReadOnlyList<DayCellViewModel> cells, int rows, string automationName)
    {
        Weekdays = weekdays;
        Cells = cells;
        Rows = rows;
        AutomationName = automationName;
    }

    /// <summary>Column headers: "SUN", "MON", ... (or "S", "M", ... when narrow).</summary>
    public IReadOnlyList<string> Weekdays { get; }

    /// <summary>Every cell, row by row.</summary>
    public IReadOnlyList<DayCellViewModel> Cells { get; }

    /// <summary>Number of rows (4 for a 13-month month, 4 to 6 for a Gregorian one).</summary>
    public int Rows { get; }

    /// <summary>The grid's name for screen readers.</summary>
    public string AutomationName { get; }

    /// <summary>Marks the cell of <paramref name="date"/> as selected (and no other).</summary>
    public void Select(GregorianDate? date)
    {
        foreach (var cell in Cells) cell.IsSelected = !cell.IsBlank && date is { } d && cell.Date == d;
    }

    /// <summary>Shows or hides the small dates.</summary>
    public void ShowSub(bool show)
    {
        foreach (var cell in Cells) cell.ShowsSub = show && !cell.IsBlank;
    }

    /// <summary>A 13-month month (the hero motif: a perfect 4 x 7 grid).</summary>
    public static MonthGridModel ForThirteen(
        ThirteenMonthLayout layout, GregorianDate? today, GregorianDate? selection, bool showsGregorian,
        Action<GregorianDate>? select, bool narrowHeaders = false)
    {
        var cells = layout.Days.Select(c => DayCellViewModel.ForThirteen(c, today, select)).ToArray();
        var grid = new MonthGridModel(
            layout.Weekdays.Select(w => Header(w, narrowHeaders)).ToArray(), cells, layout.Weeks.Count,
            $"{layout.MonthInfo.Name} {layout.System.DisplayYear(layout.Year).ToString(CultureInfo.InvariantCulture)}, {layout.System.ShortName()}");
        grid.Select(selection);
        grid.ShowSub(showsGregorian);
        return grid;
    }

    /// <summary>A Gregorian month, ragged as it is, every day carrying its 13-month date.</summary>
    public static MonthGridModel ForGregorian(GregorianMonthLayout layout, GregorianDate? today, GregorianDate? selection, Action<GregorianDate>? select)
    {
        var cells = layout.Weeks
            .SelectMany(week => week.Select(c => c is null ? DayCellViewModel.Blank() : DayCellViewModel.ForGregorian(c, today, select)))
            .ToArray();
        var grid = new MonthGridModel(
            layout.Weekdays.Select(w => Header(w, narrow: false)).ToArray(), cells, layout.Weeks.Count,
            $"Gregorian {layout.MonthInfo.Name} {layout.Year.ToString(CultureInfo.InvariantCulture)}");
        grid.Select(selection);
        return grid;
    }

    private static string Header(Weekday weekday, bool narrow) =>
        narrow ? weekday.Name(NameStyle.Narrow) : weekday.Name(NameStyle.Short).ToUpperInvariant();
}

/// <summary>
/// An intercalary day (Year Day, Leap Day, the Positivist festivals): a day that belongs to no month and no
/// week, drawn as a dashed "ticket" outside the 4 x 7 grids (Apple <c>IntercalaryDayBadge</c>).
/// </summary>
public sealed class IntercalaryBadgeModel : ViewModelBase, INavigableDay, IEventMarked
{
    private bool _isSelected;
    private bool _showsGregorian;
    private bool _showsEventRow;
    private IReadOnlyList<Avalonia.Media.Color> _eventColors = [];
    private string? _eventStatus;

    /// <summary>A badge for <paramref name="occurrence"/>.</summary>
    public IntercalaryBadgeModel(
        IntercalaryOccurrence occurrence, GregorianDate? today, bool showsGregorian, bool compact,
        Action<GregorianDate>? select)
    {
        var system = occurrence.Thirteen.System;
        Date = occurrence.Gregorian;
        Name = compact ? occurrence.ShortName : occurrence.Name;
        AfterText = $"No weekday · after {system.Months()[occurrence.AfterMonth - 1].Name} 28";
        GregorianText = "Gregorian " + occurrence.Gregorian.Format(new FormatOptions(DateStyle.Medium, IncludeYear: !compact, IncludeWeekday: true));
        IsToday = occurrence.Gregorian == today;
        IsCompact = compact;
        _showsGregorian = showsGregorian;
        Command = select is null ? null : new RelayCommand(() => select(occurrence.Gregorian));
        NavOrder = occurrence.DayOfYear;
        AutomationName = $"{Phrasing.BothDates(occurrence.Thirteen, occurrence.Gregorian)}. {DisplayText.WithoutDashes(occurrence.Description)}"
            + (IsToday ? ". Today" : "");
    }

    /// <summary>The Gregorian day.</summary>
    public GregorianDate Date { get; }

    /// <summary>"Year Day" ("All the Dead" when compact).</summary>
    public string Name { get; }

    /// <summary>"No weekday · after December 28".</summary>
    public string AfterText { get; }

    /// <summary>"Gregorian Thu, Dec 31, 2026".</summary>
    public string GregorianText { get; }

    /// <summary>Today.</summary>
    public bool IsToday { get; }

    /// <summary>The small variant (Year screen).</summary>
    public bool IsCompact { get; }

    /// <summary>Opens the day.</summary>
    public ICommand? Command { get; }

    /// <summary>What a screen reader reads.</summary>
    public string AutomationName { get; }

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

    /// <summary>Whether the Gregorian line is shown.</summary>
    public bool ShowsGregorian
    {
        get => _showsGregorian;
        set => SetProperty(ref _showsGregorian, value);
    }

    /// <summary>Whether the badge has event dots (Year mode with events shown and events that day).</summary>
    public bool ShowsEventRow
    {
        get => _showsEventRow;
        private set => SetProperty(ref _showsEventRow, value);
    }

    /// <summary>Up to three calendar colors of the day's events.</summary>
    public IReadOnlyList<Avalonia.Media.Color> EventColors
    {
        get => _eventColors;
        private set => SetProperty(ref _eventColors, value);
    }

    /// <summary><c>year.cell.events</c> ("1 event"), or null.</summary>
    public string? EventStatus
    {
        get => _eventStatus;
        private set => SetProperty(ref _eventStatus, value);
    }

    /// <inheritdoc />
    public void SetEvents(bool showsRow, IReadOnlyList<Avalonia.Media.Color> colors, int count)
    {
        ShowsEventRow = showsRow && colors.Count > 0;
        EventColors = colors;
        EventStatus = count > 0 ? CalendarStrings.YearCellEvents(count) : null;
    }
}

/// <summary>A labelled code chip: "IFC" / "2026-M11-12".</summary>
/// <param name="Label">Upper-case label.</param>
/// <param name="Code">The code.</param>
public sealed record CodeChip(string Label, string Code);

/// <summary>
/// The full SPEC 3 comparison of one day as labelled facts with plain-language explanations (Apple
/// <c>ComparisonDetailView</c>). Used by the day-detail pane and the converter.
/// </summary>
public sealed class ComparisonDetailModel
{
    /// <summary>The facts for <paramref name="comparison"/>; <paramref name="relativeToToday"/> phrases drift as "was 7 days ago".</summary>
    public ComparisonDetailModel(Comparison comparison, bool relativeToToday)
    {
        Comparison = comparison;
        var system = comparison.Thirteen.System;
        var other = system == CalendarSystemId.Ifc ? CalendarSystemId.Positivist : CalendarSystemId.Ifc;
        var daysInYear = comparison.DaysIntoYear + 1 + comparison.DaysRemainingInYear;
        var untilYearDay = comparison.Gregorian.DaysUntilYearDay(system);
        var inv = CultureInfo.InvariantCulture;

        Weekday = new WeekdayShiftModel(comparison);
        DriftValue = Phrasing.DriftAmount(comparison.LabelDrift);
        DriftText = Phrasing.LabelDrift(comparison, relativeToToday);
        MonthLengthValue = comparison.ThirteenMonthDays is { } days
            ? $"{comparison.GregorianMonthDays.ToString(inv)} vs {days.ToString(inv)}"
            : $"{comparison.GregorianMonthDays.ToString(inv)} vs no month";
        var gregorianMonth = $"Gregorian {comparison.Gregorian.MonthInfo.Name} has {comparison.GregorianMonthDays.ToString(inv)} days";
        MonthLengthText = comparison.Thirteen switch
        {
            ThirteenMonthDate date => $"{gregorianMonth}; {date.System.ShortName()} {date.MonthInfo.Name} has 28, like every 13-month month: exactly four weeks.",
            ThirteenIntercalaryDate date => $"{gregorianMonth}; {date.Info.Name} belongs to no month at all.",
            _ => gregorianMonth,
        };
        DayOfYearValue = $"{comparison.DayOfYear.ToString(inv)} of {daysInYear.ToString(inv)}";
        var leap = comparison.IsLeapYear ? "a leap year of 366 days" : "a common year of 365 days";
        DayOfYearText = $"{comparison.DaysIntoYear.ToString(inv)} days done and {comparison.DaysRemainingInYear.ToString(inv)} to go in {leap}. Both calendars count from 1 January.";
        ProgressValue = Phrasing.Percent(comparison.YearProgress);
        ProgressAutomationName = YearProgressText(comparison);
        YearDayTitle = Phrasing.YearDayName(system);
        YearDayValue = untilYearDay == 0 ? "today" : $"in {Phrasing.Days(untilYearDay)}";
        Codes =
        [
            new CodeChip(system.ShortName().ToUpperInvariant(), comparison.Thirteen.Format(FormatOptions.Numeric)),
            new CodeChip("ISO 8601", comparison.Gregorian.ToIsoString()),
        ];
        OtherSystemTitle = DisplayText.WithoutDashes(other.Name());
        var converted = comparison.Thirteen.ConvertTo(other);
        OtherSystemText = converted.Format(FormatOptions.Long) + (converted.Weekday is { } w ? $", a {w.Name()}" : ", no weekday");
    }

    /// <summary>The comparison (drives the year-progress bar).</summary>
    public Comparison Comparison { get; }

    /// <summary>Weekday strips and sentence.</summary>
    public WeekdayShiftModel Weekday { get; }

    /// <summary>"7 days behind".</summary>
    public string DriftValue { get; }

    /// <summary>The label drift sentence.</summary>
    public string DriftText { get; }

    /// <summary>"31 vs 28".</summary>
    public string MonthLengthValue { get; }

    /// <summary>The month length sentence.</summary>
    public string MonthLengthText { get; }

    /// <summary>"292 of 365".</summary>
    public string DayOfYearValue { get; }

    /// <summary>The day-of-year sentence.</summary>
    public string DayOfYearText { get; }

    /// <summary>"79.7%".</summary>
    public string ProgressValue { get; }

    /// <summary>The progress bar's screen-reader name.</summary>
    public string ProgressAutomationName { get; }

    /// <summary>"Year Day", "Festival of All the Dead".</summary>
    public string YearDayTitle { get; }

    /// <summary>"in 73 days", "today".</summary>
    public string YearDayValue { get; }

    /// <summary>Numeric 13-month code and ISO date.</summary>
    public IReadOnlyList<CodeChip> Codes { get; }

    /// <summary>"Positivist Calendar" (the other 13-month system).</summary>
    public string OtherSystemTitle { get; }

    /// <summary>"Descartes 12, 238, a Friday".</summary>
    public string OtherSystemText { get; }

    /// <summary>"Year progress: 79.7%, month 11 of 13, October, Day 292 of 365".</summary>
    public static string YearProgressText(Comparison comparison)
    {
        var position = comparison.Thirteen switch
        {
            ThirteenMonthDate date => $"month {date.Month.ToString(CultureInfo.InvariantCulture)} of 13, {date.MonthInfo.Name}",
            ThirteenIntercalaryDate date => date.Info.Name,
            _ => "",
        };
        return $"Year progress: {Phrasing.Percent(comparison.YearProgress)}, {position}, {Phrasing.DayOfYear(comparison)}";
    }
}

/// <summary>
/// A big year with previous and next buttons (Year and Compare): the system's display year and a caption
/// "Gregorian 2026 · Leap year · 366 days · 12 vs 13".
/// </summary>
public sealed class YearHeaderModel
{
    /// <summary>The header for Gregorian <paramref name="year"/>.</summary>
    public YearHeaderModel(int year, CalendarSystemId system, string? subtitle)
    {
        YearText = Phrasing.DisplayYear(year, system);
        var parts = new List<string>();
        if (Phrasing.GregorianYearNote(year, system) is { } note) parts.Add(note);
        parts.Add(GregorianDate.IsLeapYear(year) ? "Leap year · 366 days" : "365 days");
        if (subtitle is not null) parts.Add(subtitle);
        Caption = string.Join(" · ", parts);
        AutomationName = $"{YearText}, {Caption.Replace(' ', ' ')}";
    }

    /// <summary>"2026", "238".</summary>
    public string YearText { get; }

    /// <summary>The caption under the year.</summary>
    public string Caption { get; }

    /// <summary>Year and caption for screen readers.</summary>
    public string AutomationName { get; }
}
